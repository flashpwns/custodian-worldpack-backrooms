"use strict";

// Tier 2 of LOCAL dialogue interpretation: a BOUNDED, STRUCTURED, ADVISORY reading of the player's
// language, used only when the deterministic Tier 1 parse left an utterance generic (an untyped question
// or statement). Doctrine 7.5 / 7.26-7.28: language -> interpretation -> structured intent -> authority
// validation; low confidence -> clarification / deterministic fallback.
//
// The advisory interpreter classifies LANGUAGE only. It never sees world facts and may not determine:
// canonical actor ids, who heard what, the canonical referent, world facts, item holders, locations,
// phase, knowledge, emotional state, assignment truth, response owners or consequences. Every string it
// returns must be a span of the player's own words; code resolves each one against canonical state.
// Malformed, unsupported or low-confidence output is rejected (the Tier 1 reading stands).

const ADVISORY_VERSION = "yellow-beast-dialogue-advisory@v1";
const INTENTS = Object.freeze(["self_description", "role_or_assignment", "institution_purpose", "mission_objective", "next_step", "person_identity", "assignment_purpose", "entity_definition", "item_ownership", "personal_experience", "self_state", "opinion", "explanation", "social_statement", "greeting", "request", "factual_other", "unclear"]);
const SPEECH_ACTS = Object.freeze(["question", "statement", "request", "greeting", "reaction", "unclear"]);
const RELATIONS = Object.freeze(["new_topic", "follow_up", "answer", "repair", "none"]);
const TONES = Object.freeze(["neutral", "friendly", "uncertain", "sarcastic", "urgent", "frustrated"]);
const MIN_CONFIDENCE = 0.6;
const MAX_SPAN = 80;

const ADVISORY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  // Only what code consumes is required (every output token costs latency on the local model); the
  // remaining language fields are optional and validated when present.
  required: ["intent", "referent_text", "confidence"],
  properties: {
    speech_act: { type: "string", enum: [...SPEECH_ACTS] },
    intent: { type: "string", enum: [...INTENTS] },
    addressee_mentions: { type: "array", maxItems: 3, items: { type: "string" } },
    referent_text: { type: ["string", "null"] },
    discourse_relation: { type: "string", enum: [...RELATIONS] },
    tone: { type: "string", enum: [...TONES] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
});

// What each intent MEANS, for the model (language categories, no facts).
const INTENT_GUIDE = Object.freeze({
  self_description: "asks the listener to describe themselves",
  role_or_assignment: "asks what someone's job, role or assignment is",
  institution_purpose: "asks what this organisation/place/their work is for in general",
  mission_objective: "asks what today's trip or assignment is about",
  next_step: "asks what happens next or where to go next",
  person_identity: "asks who a named or described person is",
  assignment_purpose: "asks what a named thing or task is for, or why someone is doing it",
  entity_definition: "asks what a named place or thing is",
  item_ownership: "asks who has or carries an item",
  personal_experience: "asks about the listener's own past experience",
  self_state: "asks how the listener feels",
  opinion: "asks the listener's opinion",
  explanation: "asks why the listener said something",
  social_statement: "a remark or comment, not a question",
  greeting: "a greeting",
  request: "asks the listener to do something",
  factual_other: "a factual question that fits none of the above",
  unclear: "cannot tell what is meant"
});

const ADVISORY_SYSTEM_TEXT = [
  "You classify the LANGUAGE of one line a person said in a workplace conversation. You do not answer it.",
  "Choose the intent that best describes what the line is asking or doing. Copy referent_text and addressee_mentions EXACTLY from the line (a short span), or use null / [] when there is none.",
  "referent_text: the name of the person, place, item or task the line is about, copied exactly.",
  "confidence: how sure you are of the intent (0 to 1). Say unclear when you cannot tell.",
  "Reply with exactly one JSON object and nothing else."
].join("\n");

/** The whole prompt: the line, the previous line (context for follow-ups), and the intent menu. No facts. */
function buildAdvisoryPrompt({ utterance, previous_line = null }) {
  const menu = INTENTS.map((intent) => `- ${intent}: ${INTENT_GUIDE[intent]}`).join("\n");
  return [
    previous_line ? `Previous line in the conversation: ${JSON.stringify(String(previous_line).slice(0, 200))}` : null,
    `The line to classify: ${JSON.stringify(String(utterance).slice(0, 400))}`,
    `Intents:\n${menu}`,
    'Return JSON: {"intent":..., "referent_text":..., "confidence":...}'
  ].filter(Boolean).join("\n\n");
}

const within = (span, text) => String(text).toLowerCase().includes(String(span).toLowerCase().trim());

/**
 * Validate a raw advisory candidate against the utterance. Returns
 * { accepted: true, intent, speech_act, addressee_mentions, referent_text, discourse_relation, tone, confidence }
 * or { accepted: false, reason }. Nothing outside the allowlist, and no text the player did not say.
 */
function validateAdvisory(raw, utterance) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { accepted: false, reason: "malformed" };
  const keys = Object.keys(raw);
  if (keys.some((k) => !ADVISORY_SCHEMA.properties[k])) return { accepted: false, reason: "unsupported_field" };
  if (!INTENTS.includes(raw.intent)) return { accepted: false, reason: "unsupported_intent" };
  if ((raw.speech_act !== undefined && !SPEECH_ACTS.includes(raw.speech_act)) || (raw.discourse_relation !== undefined && !RELATIONS.includes(raw.discourse_relation)) || (raw.tone !== undefined && !TONES.includes(raw.tone))) return { accepted: false, reason: "unsupported_value" };
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { accepted: false, reason: "malformed_confidence" };
  if (confidence < MIN_CONFIDENCE || raw.intent === "unclear") return { accepted: false, reason: "low_confidence" };
  const mentions = Array.isArray(raw.addressee_mentions) ? raw.addressee_mentions.filter((m) => typeof m === "string" && m.trim()) : [];
  if (mentions.length > 3 || mentions.some((m) => m.length > MAX_SPAN || !within(m, utterance))) return { accepted: false, reason: "addressee_not_in_utterance" };
  const referent = typeof raw.referent_text === "string" && raw.referent_text.trim() ? raw.referent_text.trim() : null;
  if (referent && (referent.length > MAX_SPAN || !within(referent, utterance))) return { accepted: false, reason: "referent_not_in_utterance" };
  return Object.freeze({ version: ADVISORY_VERSION, accepted: true, intent: raw.intent, speech_act: raw.speech_act ?? null, addressee_mentions: mentions.map((m) => m.trim()), referent_text: referent, discourse_relation: raw.discourse_relation ?? null, tone: raw.tone ?? null, confidence: Math.round(confidence * 100) / 100 });
}

/**
 * Ask the provider for an advisory reading, bounded by a timeout. Never throws: an unavailable, failing,
 * slow or invalid provider yields { accepted: false, reason }.
 */
async function requestAdvisory(provider, { utterance, previous_line = null, timeout_ms = 8000 } = {}) {
  if (!provider || typeof provider.interpretDialogue !== "function") return { accepted: false, reason: "advisory_unavailable", latency_ms: 0 };
  const started = Date.now();
  let timer = null;
  try {
    const raw = await Promise.race([
      provider.interpretDialogue({ system: ADVISORY_SYSTEM_TEXT, user: buildAdvisoryPrompt({ utterance, previous_line }), schema: ADVISORY_SCHEMA }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("advisory timeout"), { code: "TIMEOUT" })), timeout_ms); })
    ]);
    const verdict = validateAdvisory(raw, utterance);
    return { ...verdict, latency_ms: Date.now() - started, ...(verdict.accepted ? {} : { raw_intent: typeof raw?.intent === "string" ? raw.intent.slice(0, 40) : null }) };
  } catch (error) {
    return { accepted: false, reason: error?.code === "TIMEOUT" ? "timeout" : "provider_error", latency_ms: Date.now() - started };
  } finally { if (timer) clearTimeout(timer); }
}

module.exports = { ADVISORY_VERSION, INTENTS, ADVISORY_SCHEMA, ADVISORY_SYSTEM_TEXT, MIN_CONFIDENCE, buildAdvisoryPrompt, validateAdvisory, requestAdvisory };
