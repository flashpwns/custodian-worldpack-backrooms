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
const INTENTS = Object.freeze(["self_description", "role_or_assignment", "institution_purpose", "mission_objective", "next_step", "person_identity", "person_role", "person_authority", "person_relation", "assignment_purpose", "entity_definition", "reported_speech", "current_action", "location_purpose", "item_ownership", "personal_experience", "self_state", "opinion", "explanation", "social_statement", "greeting", "request", "factual_other", "unclear"]);
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
    // Hole 7: the words (if any) the line uses to ADDRESS someone. Language only: code resolves it against
    // present personnel; the model never returns ids or chooses who answers.
    addressee_text_span: { type: ["string", "null"] },
    // Hole 3: when the line asks about something from the previous line, WHICH of the numbered candidates
    // (the facts that previous line was authorized with). A closed choice: it can never name a new referent.
    anchor_candidate: { type: ["integer", "null"], minimum: 1, maximum: 6 },
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
  person_role: "asks what a named or described person does (their job or role)",
  person_authority: "asks why a person is in charge of something, or who is in charge",
  person_relation: "asks whether the listener knows or has met a person",
  reported_speech: "asks what someone said or told them",
  current_action: "asks what the listener is doing right now",
  location_purpose: "asks what a room or place is for",
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

// The STATIC part of the prompt (instructions + the intent menu) lives in the system message, so the
// local runtime's prefix cache reuses it on every call; only the line itself is new per turn (latency).
const ADVISORY_SYSTEM_TEXT = [
  "You classify the LANGUAGE of one line a person said in a workplace conversation. You do not answer it.",
  "Choose the intent that best describes what the line is asking or doing. Copy referent_text and addressee_mentions EXACTLY from the line (a short span), or use null / [] when there is none.",
  "referent_text: the name of the person, place, item or task the line is about, copied exactly.",
  "confidence: how sure you are of the intent (0 to 1). Say unclear when you cannot tell.",
  `Intents:\n${INTENTS.map((intent) => `- ${intent}: ${INTENT_GUIDE[intent]}`).join("\n")}`,
  "Reply with exactly one compact JSON object on a single line, with no spaces or line breaks between fields, and nothing else."
].join("\n");

/**
 * The per-turn prompt: the line, the previous line (context for follow-ups) and -- only when code needs
 * them -- the addressee question and the closed list of anchor candidates. No facts.
 */
function buildAdvisoryPrompt({ utterance, previous_line = null, ask_addressee = false, anchor_candidates = [] }) {
  const anchors = (anchor_candidates ?? []).slice(0, 6);
  const fields = ['"intent":...', '"referent_text":...', '"confidence":...'];
  if (ask_addressee) fields.push('"addressee_text_span":...');
  if (anchors.length) fields.push('"anchor_candidate":...');
  return [
    previous_line ? `Previous line in the conversation: ${JSON.stringify(String(previous_line).slice(0, 200))}` : null,
    `The line to classify: ${JSON.stringify(String(utterance).slice(0, 400))}`,
    ask_addressee ? "addressee_text_span: if the line speaks TO someone by name, copy that name exactly from the line; otherwise null." : null,
    anchors.length ? `anchor_candidate: if the line asks about one of these things from the previous line, its number; otherwise null.\n${anchors.map((a, i) => `${i + 1}. ${String(a).slice(0, 80)}`).join("\n")}` : null,
    `Return JSON: {${fields.join(",")}}`
  ].filter(Boolean).join("\n");
}

const within = (span, text) => String(text).toLowerCase().includes(String(span).toLowerCase().trim());

/**
 * Validate a raw advisory candidate against the utterance. Returns
 * { accepted: true, intent, speech_act, addressee_mentions, referent_text, discourse_relation, tone, confidence }
 * or { accepted: false, reason }. Nothing outside the allowlist, and no text the player did not say.
 */
function validateAdvisory(raw, utterance, { anchor_count = 0 } = {}) {
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
  const addressee = typeof raw.addressee_text_span === "string" && raw.addressee_text_span.trim() ? raw.addressee_text_span.trim() : null;
  if (addressee && (addressee.length > 40 || !within(addressee, utterance) || /[^A-Za-z .'-]/.test(addressee))) return { accepted: false, reason: "addressee_not_in_utterance" };
  const anchor = raw.anchor_candidate == null ? null : Number(raw.anchor_candidate);
  if (anchor != null && (!Number.isInteger(anchor) || anchor < 1 || anchor > anchor_count)) return { accepted: false, reason: "anchor_out_of_range" };
  return Object.freeze({ version: ADVISORY_VERSION, accepted: true, intent: raw.intent, speech_act: raw.speech_act ?? null, addressee_mentions: mentions.map((m) => m.trim()), referent_text: referent, addressee_text_span: addressee, anchor_candidate: anchor, discourse_relation: raw.discourse_relation ?? null, tone: raw.tone ?? null, confidence: Math.round(confidence * 100) / 100 });
}

/**
 * Ask the provider for an advisory reading, bounded by a timeout. Never throws: an unavailable, failing,
 * slow or invalid provider yields { accepted: false, reason }.
 */
async function requestAdvisory(provider, { utterance, previous_line = null, ask_addressee = false, anchor_candidates = [], timeout_ms = 8000 } = {}) {
  if (!provider || typeof provider.interpretDialogue !== "function") return { accepted: false, reason: "advisory_unavailable", latency_ms: 0 };
  const started = Date.now();
  let timer = null;
  try {
    const raw = await Promise.race([
      provider.interpretDialogue({ system: ADVISORY_SYSTEM_TEXT, user: buildAdvisoryPrompt({ utterance, previous_line, ask_addressee, anchor_candidates }), schema: ADVISORY_SCHEMA }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("advisory timeout"), { code: "TIMEOUT" })), timeout_ms); })
    ]);
    const verdict = validateAdvisory(raw, utterance, { anchor_count: (anchor_candidates ?? []).slice(0, 6).length });
    return { ...verdict, latency_ms: Date.now() - started, ...(verdict.accepted ? {} : { raw_intent: typeof raw?.intent === "string" ? raw.intent.slice(0, 40) : null }) };
  } catch (error) {
    return { accepted: false, reason: error?.code === "TIMEOUT" ? "timeout" : "provider_error", latency_ms: Date.now() - started };
  } finally { if (timer) clearTimeout(timer); }
}

// ─── v2 (ED-30 D15): multi-act, opaque candidates, registry facets, constrained decoding ────────────────
// The runtime's OpenAI-compatible `response_format: json_schema` (strict) is compiled by llama.cpp into a
// grammar, so malformed output cannot be sampled at all; validation below still checks every field.
const ADVISORY_V2_VERSION = "yellow-beast-dialogue-advisory@v2";
const V2_SPEECH_ACTS = Object.freeze(["greeting", "farewell", "self_introduction", "social_acknowledgment", "thanks", "attention_call", "statement", "sarcasm", "question", "request", "repair", "elliptical_continuation", "answer"]);
const V2_RELATIONS = Object.freeze(["new", "continuation", "repair", "topic_return", "attention", "answer"]);
const V2_QUANTIFIERS = Object.freeze(["none", "one", "each", "any", "all", "subset", "except"]);
const V2_CONFIDENCE = Object.freeze(["low", "medium", "high"]);
const MAX_ACTS = 4;

/** The v2 JSON schema for one scene: facet enum = registry ids offered, candidate enums = opaque labels. */
function advisoryV2Schema({ facets = [], people = [], referents = [] } = {}) {
  const nullableEnum = (values) => ({ anyOf: [{ type: "string", enum: values.length ? values : ["none"] }, { type: "null" }] });
  return {
    type: "object",
    additionalProperties: false,
    required: ["acts", "confidence"],
    properties: {
      acts: {
        type: "array", minItems: 1, maxItems: MAX_ACTS,
        items: {
          type: "object", additionalProperties: false,
          required: ["speech_act", "facet", "addressee_candidate", "referent_candidate", "quantifier", "discourse_relation"],
          properties: {
            speech_act: { type: "string", enum: [...V2_SPEECH_ACTS] },
            addressee_text: { type: ["string", "null"] },
            addressee_candidate: nullableEnum(people.map((p) => p.label)),
            referent_text: { type: ["string", "null"] },
            referent_candidate: nullableEnum(referents.map((r) => r.label)),
            facet: nullableEnum(facets),
            polarity: { type: "string", enum: ["positive", "negative"] },
            temporal_text: { type: ["string", "null"] },
            quantifier: { type: "string", enum: [...V2_QUANTIFIERS] },
            discourse_relation: { type: "string", enum: [...V2_RELATIONS] }
          }
        }
      },
      turn_relation: { type: "string", enum: [...V2_RELATIONS] },
      confidence: { type: "string", enum: [...V2_CONFIDENCE] }
    }
  };
}

const ADVISORY_V2_SYSTEM_TEXT = [
  "You classify the LANGUAGE of one line a person said at a work table. You do not answer it and you know nothing about the world.",
  "Split the line into at most four acts. For each act choose: speech_act; facet (what is asked about, from the list, or null); who is addressed (addressee_candidate label, or null); what place/thing it is about (referent_candidate label, or null); quantifier; discourse_relation.",
  "Every *_text field must be copied EXACTLY from the line, or null. Use only the labels given. If you cannot tell, say confidence low.",
  "Reply with exactly one compact JSON object and nothing else."
].join("\n");

function buildAdvisoryV2Prompt({ utterance, recent = [], people = [], referents = [], facets = [], facet_guide = {} }) {
  return [
    recent.length ? `Recent lines (words only):\n${recent.slice(-3).map((l) => `- ${String(l).slice(0, 160)}`).join("\n")}` : null,
    `The line: ${JSON.stringify(String(utterance).slice(0, 400))}`,
    people.length ? `People at the table (addressee labels): ${people.map((p) => `${p.label}=${p.name}`).join(", ")}` : null,
    referents.length ? `Places/things (referent labels): ${referents.map((r) => `${r.label}=${r.name}`).join(", ")}` : null,
    `Facets:\n${facets.map((f) => `- ${f}${facet_guide[f] ? `: ${facet_guide[f]}` : ""}`).join("\n")}`
  ].filter(Boolean).join("\n");
}

const within2 = (span, utterance, repaired) => { const s = String(span).toLowerCase().trim(); return String(utterance).toLowerCase().replace(/[’‘]/g, "'").includes(s) || String(repaired ?? "").toLowerCase().includes(s); };
/**
 * Validates a v2 candidate. Labels must come from the offered sets, facets from the offered enum, spans
 * from the player's own words (raw or repaired). Low confidence is not accepted (understand -> clarify).
 */
function validateAdvisoryV2(raw, utterance, { people = [], referents = [], facets = [], repaired = null } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.acts)) return { accepted: false, reason: "malformed" };
  if (Object.keys(raw).some((k) => !["acts", "turn_relation", "confidence"].includes(k))) return { accepted: false, reason: "unsupported_field" };
  if (!V2_CONFIDENCE.includes(raw.confidence)) return { accepted: false, reason: "malformed_confidence" };
  if (raw.confidence === "low") return { accepted: false, reason: "low_confidence" };
  if (!raw.acts.length || raw.acts.length > MAX_ACTS) return { accepted: false, reason: "act_count" };
  const peopleLabels = new Map(people.map((p) => [p.label, p]));
  const refLabels = new Map(referents.map((r) => [r.label, r]));
  const acts = [];
  for (const act of raw.acts) {
    if (!act || typeof act !== "object") return { accepted: false, reason: "malformed_act" };
    if (!V2_SPEECH_ACTS.includes(act.speech_act) || !V2_RELATIONS.includes(act.discourse_relation) || !V2_QUANTIFIERS.includes(act.quantifier)) return { accepted: false, reason: "unsupported_value" };
    if (act.facet != null && !facets.includes(act.facet)) return { accepted: false, reason: "unsupported_facet" };
    if (act.addressee_candidate != null && !peopleLabels.has(act.addressee_candidate)) return { accepted: false, reason: "unknown_candidate" };
    if (act.referent_candidate != null && !refLabels.has(act.referent_candidate)) return { accepted: false, reason: "unknown_candidate" };
    for (const key of ["addressee_text", "referent_text", "temporal_text"]) if (act[key] != null && (typeof act[key] !== "string" || act[key].length > MAX_SPAN || !within2(act[key], utterance, repaired))) return { accepted: false, reason: `${key}_not_in_utterance` };
    // A named addressee must actually be named in the line (code maps the label; the words must be the player's).
    const person = act.addressee_candidate ? peopleLabels.get(act.addressee_candidate) : null;
    if (person && !(person.names ?? [person.name]).some((n) => within2(n, utterance, repaired)) && !(act.addressee_text && within2(act.addressee_text, utterance, repaired))) return { accepted: false, reason: "addressee_not_in_utterance" };
    // A referent the player never named (neither its name nor a verbatim span) is dropped: the model may not
    // choose a place or thing the line does not mention (review F12).
    const ref = act.referent_candidate ? refLabels.get(act.referent_candidate) : null;
    // A deictic span ("there", "it", "that place") names nothing: only the referent's own name counts, or a
    // span that contains a word of that name (review F12 residual).
    const nameWords = String(ref?.name ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !["the", "and"].includes(w));
    const refNamed = ref && (within2(String(ref.name ?? ""), utterance, repaired) || (act.referent_text && within2(act.referent_text, utterance, repaired) && nameWords.some((w) => String(act.referent_text).toLowerCase().includes(w))));
    acts.push(Object.freeze({ speech_act: act.speech_act, facet: act.facet ?? null, addressee_id: person?.id ?? null, referent_id: refNamed ? ref.id : null, quantifier: act.quantifier, discourse_relation: act.discourse_relation, polarity: act.polarity ?? "positive", temporal_text: act.temporal_text ?? null }));
  }
  return Object.freeze({ version: ADVISORY_V2_VERSION, accepted: true, acts, turn_relation: raw.turn_relation ?? null, confidence: raw.confidence });
}

/** One bounded v2 advisory call (never throws; timeout/malformed/unavailable -> not accepted). */
async function requestAdvisoryV2(provider, { utterance, repaired = null, recent = [], people = [], referents = [], facets = [], facet_guide = {}, timeout_ms = 8000 } = {}) {
  if (!provider || typeof provider.interpretDialogue !== "function") return { accepted: false, reason: "advisory_unavailable", latency_ms: 0 };
  const started = Date.now();
  let timer = null;
  try {
    const raw = await Promise.race([
      provider.interpretDialogue({ system: ADVISORY_V2_SYSTEM_TEXT, user: buildAdvisoryV2Prompt({ utterance, recent, people, referents, facets, facet_guide }), schema: advisoryV2Schema({ facets, people, referents }) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("advisory timeout"), { code: "TIMEOUT" })), timeout_ms); })
    ]);
    // A v1-shaped reply (older scripted providers) is still validated by the v1 rules.
    const verdict = raw && Array.isArray(raw.acts) ? validateAdvisoryV2(raw, utterance, { people, referents, facets, repaired }) : validateAdvisory(raw, utterance, {});
    return { ...verdict, latency_ms: Date.now() - started };
  } catch (error) {
    return { accepted: false, reason: error?.code === "TIMEOUT" ? "timeout" : "provider_error", latency_ms: Date.now() - started };
  } finally { if (timer) clearTimeout(timer); }
}

module.exports = { ADVISORY_V2_VERSION, advisoryV2Schema, ADVISORY_V2_SYSTEM_TEXT, buildAdvisoryV2Prompt, validateAdvisoryV2, requestAdvisoryV2, ADVISORY_VERSION, INTENTS, ADVISORY_SCHEMA, ADVISORY_SYSTEM_TEXT, MIN_CONFIDENCE, buildAdvisoryPrompt, validateAdvisory, requestAdvisory };
