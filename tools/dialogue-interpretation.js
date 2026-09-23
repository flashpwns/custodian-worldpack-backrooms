"use strict";

// Bounded utterance interpretation for LOCAL coworker dialogue.
//
// This module is the ONLY place that classifies player speech for the purpose
// of dialogue routing. Its output is deterministic for the clear cases and
// resolves to "ambiguous" when confidence is insufficient. It does NOT mutate
// world state and holds no persistent references.
//
// Architecture invariant:
//   CODE determines the conversational situation.
//   The AI provider only wordsmiths the already-authorized response.

const INTERPRETATION_VERSION = "yellow-beast-dialogue-interpretation@v2";

// ─── Allowlisted speech acts ────────────────────────────────────────────────
const SPEECH_ACTS = Object.freeze([
  "factual_question",   // "What happens if we're not back by one?"
  "personal_question",  // "Have you been in there before?"
  "social_observation", // "You look nervous." / "This seems safe."
  "statement",          // declarative, informational, no response required
  "introduction",       // "I'm Jack." / "My name is Eleanor."
  "greeting",           // "Hey." / "Good morning."
  "acknowledgment",     // "Got it." / "Understood."
  "joke_or_sarcasm",    // "Well this seems incredibly safe."
  "request",            // "Can you hand me the spectrometer?"
  "warning",            // "Look out." / "Careful with that."
  "uncertainty",        // "I'm not sure what we're doing."
  "group_question",     // "@table — does anyone know the route?"
  "ambiguous"           // fallback when confidence is insufficient
]);

// ─── Topic hints — broad operational categories ───────────────────────────
// Used to drive relevance filtering. Not exhaustive.
const TOPICS = Object.freeze([
  "time_or_schedule",   // cutoff, noon, departure, clock
  "route_or_navigation",// tape, path, outpost, corridor, passage
  "equipment",          // camera, spectrometer, duffle, radio, flashlight
  "team_or_roster",     // who is here, coworker names, team size
  "mission_objective",  // outpost A, duffle, startup
  "personal_experience",// first time, before, nervous, claustrophobic
  "relationship",       // get along, trust, worried about
  "safety_or_risk",     // danger, hazard, warning, careful
  "location_or_space",  // room, threshold, kv31, facility
  "social",             // general social / phatic
  "unknown"
]);

// ─── Deterministic pattern tables ──────────────────────────────────────────
const SARCASM_PATTERNS = [
  /\b(?:incredibly|totally|definitely|obviously|surely|really)\s+(?:safe|fine|great|wonderful|fantastic|perfect|clear)\b/i,
  /\bwhat could (?:go wrong|possibly go wrong)\b/i,
  /\bno (?:problem|issue|concern)\s+(?:at all|whatsoever)\b/i,
  /\bsounds?\s+(?:totally|completely|absolutely)\s+(?:normal|fine|safe|good)\b/i
];

const GREETING_PATTERNS = /^(?:hey|hi|hello|good (?:morning|afternoon|evening)|howdy|yo|greetings)[\s!.,?]*$/i;

const INTRODUCTION_PATTERNS = /\b(?:I'?m|My name is|Call me|I am|You can call me)\s+[A-Z][A-Za-z'-]*/;

const ACKNOWLEDGMENT_PATTERNS = /^(?:got it|understood|copy|roger|alright|all right|okay|ok|sure|noted|good to know|thanks|thank you|appreciate it)[\s!.,]*$/i;

const WARNING_PATTERNS = /\b(?:look out|watch out|careful|be careful|heads up|warning|danger|hazard|stop!|stop that|don't touch)\b/i;

const UNCERTAINTY_PATTERNS = /\b(?:i don'?t know|i'?m not sure|uncertain|unclear|i can'?t tell|no idea|beats me|hard to say)\b/i;

const FACTUAL_QUESTION_PATTERNS = [
  /\bwhat (?:happens?|is the|are the|do we|does|time|if)\b/i,
  /\bwhen (?:do we|should we|is the|does)\b/i,
  /\bhow (?:do we|does|long|far|many)\b/i,
  /\bwhere (?:do we|is|are|should)\b/i,
  /\bwhy (?:do|does|is|are|did)\b/i
];

const PERSONAL_QUESTION_PATTERNS = [
  /\b(?:have you|did you|do you|are you|were you)\b.*\b(?:been|done|seen|worked|know|feel|think|experience)\b/i,
  /\byou (?:been|done|seen|know|feel|ever|worked)\b/i,
  /\bfirst time\b/i,
  /\bhave you (?:ever|been)\b/i
];

const SOCIAL_OBSERVATION_PATTERNS = [
  /\byou (?:look|seem|appear|sound)\b/i,
  /\blooking?\s+(?:good|nervous|worried|tense|calm|ready|pale)\b/i,
  /\b(?:this|that|it) (?:seems?|looks?|feels?|sounds?)\b/i
];

const REQUEST_PATTERNS = /(?:\b(?:can you|could you|would you|please|pass me|hand me|give me|send me|bring me|lend me|help me)\b|^let(?:'s| us)\b)/i;

// Bare conversational reactions -- "What?", "Huh?", "Sorry?" -- are a reflex
// response to the immediately preceding exchange, not a fresh mission
// question. Anchored so a real question sharing the lead word ("What is the
// time?") is unaffected: only the bare word/phrase plus trailing punctuation
// matches.
const BARE_REACTION_PATTERNS = /^(?:what|huh|sorry|pardon|really|come again|say (?:that )?again|what was that|wait,?\s+what)[\s?!.]*$/i;

const GROUP_ADDRESS_PATTERNS = /(?:^|\b)(?:@?(?:table|team|everyone|everybody|all|crew|teammates?|folks)|anybody|anyone|does anyone|you all|all of you)(?:\b|$)/i;
const GROUP_GREETING_PATTERNS = /^(?:hey|hi|hello|good (?:morning|afternoon|evening)|howdy|yo|greetings)[\s,!-]+(?:everyone|everybody|all|team|crew|folks|you all)[\s!.,?]*$/i;
const AMBIGUOUS_REFERENCE_PATTERNS = /\b(?:the thing|that thing|do the thing|over there|you know what|whatever it is|that stuff)\b/i;
const SOCIAL_UNTARGETED_PATTERNS = /\b(?:i(?:'m| am) (?:so )?(?:tired|exhausted|beat)|fuck,? i(?:'m| am) tired|this sucks|long day|long morning)\b/i;

/**
 * Resolves only the player-supplied language signal for LOCAL routing. Physical
 * eligibility and exact personnel identities remain the caller's authority.
 */
function inferLocalRecipientType(text, { explicitTarget = null } = {}) {
  if (explicitTarget) return "direct";
  return GROUP_ADDRESS_PATTERNS.test(String(text ?? "").trim()) ? "group" : "none";
}

// ─── Topic detection ────────────────────────────────────────────────────────
function detectTopic(text) {
  const t = text.toLowerCase();
  if (/\bhow(?:'s| is| are) (?:everyone|everybody|you all|all of you) (?:doing|feeling)\b/.test(t)) return "social";
  if (/\b(?:cutoff|noon|departure|schedule|clock|hours?|time)\b/.test(t) || /1[:\s]?00/.test(t) || /\bby one\b/.test(t) || /\bback by\b/.test(t)) return "time_or_schedule";
  if (/\b(?:tape|route|path|outpost|corridor|passage|arrows?|guidance|direction|where to go)\b/.test(t)) return "route_or_navigation";
  if (/\b(?:camera|spectrometer|survey.?instrument|duffle|radio|flashlight|equipment|gear|kit|bag|manifest|carry|carrying|holding)\b/.test(t)) return "equipment";
  if (/\b(?:team|coworker|teammate|who is|who are|personnel|crew|member|roster)\b/.test(t)) return "team_or_roster";
  if (/\b(?:outpost a?|mission|objective|duffle|startup|what are we doing|the job)\b/.test(t)) return "mission_objective";
  if (/\b(?:been in there|first time|before|experience|nervous|claustrophobic|afraid|worried|prefer)\b/.test(t)) return "personal_experience";
  if (/\b(?:get along|trust|rapport|like|annoying|friendly|awkward)\b/.test(t)) return "relationship";
  if (/\b(?:danger|hazard|risk|careful|safe|unsafe|warning|look out)\b/.test(t)) return "safety_or_risk";
  if (/\b(?:room|threshold|kv31|facility|complex|upstairs|downstairs|here|this place)\b/.test(t)) return "location_or_space";
  if (/\b(?:hey|hi|hello|morning|good to|nice to|pleasure|meet you)\b/.test(t)) return "social";
  return "unknown";
}

// ─── Tone detection (light) ──────────────────────────────────────────────
function detectTone(text, speechAct) {
  if (speechAct === "joke_or_sarcasm") return "sarcastic";
  if (speechAct === "warning") return "urgent";
  if (speechAct === "greeting" || speechAct === "introduction") return "friendly";
  if (speechAct === "uncertainty") return "uncertain";
  if (/[!]{2,}/.test(text)) return "emphatic";
  if (/\bplease\b/i.test(text)) return "polite";
  return "neutral";
}

// ─── Core deterministic parse ────────────────────────────────────────────
/**
 * Deterministically classifies a player utterance for dialogue routing.
 * Returns a bounded interpretation object. Does not mutate any state.
 *
 * @param {string} text - Raw player utterance (pre-trimmed by caller)
 * @param {{ isGroup?: boolean }} opts
 * @returns {{ version, speech_act, topic, tone, literal_question, confidence }}
 */
function interpretUtterance(text, { isGroup = false } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return make("ambiguous", "unknown", "neutral", false, 0.0);
  }

  const looksQuestion = raw.endsWith("?") ||
    /^(?:what|where|who|when|why|how|can you|could you|do you|is there|are there|will you|have you|did you|does)\b/i.test(raw);

  const groupAddress = isGroup || GROUP_ADDRESS_PATTERNS.test(raw);

  // Bare reactive follow-ups ("What?", "Huh?", "Sorry?") are conversational
  // clarification, not a factual mission question -- classify them as
  // low-confidence ambiguous before any question/group-question branch can
  // claim them. Recipient scope (who this inherits from) is resolved by the
  // caller, not here; this module only judges the language.
  if (BARE_REACTION_PATTERNS.test(raw)) {
    return make("ambiguous", "unknown", "uncertain", looksQuestion, 0.4);
  }

  if (groupAddress && AMBIGUOUS_REFERENCE_PATTERNS.test(raw)) {
    return make("ambiguous", detectTopic(raw), "uncertain", looksQuestion, 0.72);
  }

  // Sarcasm check before literal question (overrides question classification)
  if (SARCASM_PATTERNS.some((p) => p.test(raw))) {
    return make("joke_or_sarcasm", detectTopic(raw), "sarcastic", false, 0.88);
  }

  // Warning
  if (WARNING_PATTERNS.test(raw)) {
    return make("warning", "safety_or_risk", "urgent", false, 0.95);
  }

  if (groupAddress && GROUP_GREETING_PATTERNS.test(raw)) {
    return make("greeting", "social", "friendly", false, 0.97);
  }

  if (groupAddress && looksQuestion) {
    return make("group_question", detectTopic(raw), "neutral", true, 0.93);
  }

  // Greeting (standalone)
  if (GREETING_PATTERNS.test(raw)) {
    return make("greeting", "social", "friendly", false, 0.97);
  }

  // Introduction
  if (INTRODUCTION_PATTERNS.test(raw) && !looksQuestion) {
    return make("introduction", "social", "friendly", false, 0.92);
  }

  // Acknowledgment (standalone)
  if (ACKNOWLEDGMENT_PATTERNS.test(raw)) {
    return make("acknowledgment", "social", "neutral", false, 0.97);
  }

  // Uncertainty statement
  if (UNCERTAINTY_PATTERNS.test(raw) && !looksQuestion) {
    return make("uncertainty", detectTopic(raw), "uncertain", false, 0.85);
  }

  // Social observation ("you look nervous", "this seems safe")
  if (SOCIAL_OBSERVATION_PATTERNS.some((p) => p.test(raw)) && !looksQuestion) {
    return make("social_observation", detectTopic(raw), "neutral", false, 0.88);
  }

  // Personal question ("have you been in there before?")
  if (looksQuestion && PERSONAL_QUESTION_PATTERNS.some((p) => p.test(raw))) {
    return make("personal_question", detectTopic(raw), "neutral", true, 0.85);
  }

  // Factual question
  if (looksQuestion && FACTUAL_QUESTION_PATTERNS.some((p) => p.test(raw))) {
    return make("factual_question", detectTopic(raw), "neutral", true, 0.82);
  }

  // Generic question not matched above
  if (looksQuestion) {
    return make("factual_question", detectTopic(raw), "neutral", true, 0.65);
  }

  // Request
  if (REQUEST_PATTERNS.test(raw)) {
    return make("request", detectTopic(raw), "polite", false, 0.87);
  }

  // Default: statement (declarative sentence)
  return make("statement", detectTopic(raw), "neutral", false, 0.70);
}

/**
 * Beat-scoped deterministic social response policy. Candidates MUST already be
 * ordered by canonical team order and filtered to personnel who heard the line.
 * The model never participates in this decision.
 */
function resolveResponseOwners({ recipient_type, interpretation, player_text, candidates = [] } = {}) {
  const eligible = candidates.filter((candidate) => candidate?.response_eligible && candidate?.id);
  if (recipient_type === "direct") return eligible.slice(0, 1).map((candidate) => candidate.id);
  if (eligible.length === 0) return [];

  const act = interpretation?.speech_act ?? "ambiguous";
  const topic = interpretation?.topic ?? "unknown";
  const text = String(player_text ?? "");

  if (recipient_type === "group") {
    if (act === "greeting") return eligible.map((candidate) => candidate.id);
    if (act === "group_question" && topic === "social" && /\b(?:everyone|everybody|you all|all of you)\b/i.test(text)) {
      return eligible.map((candidate) => candidate.id);
    }
    if (act === "group_question" && topic === "equipment") {
      const informed = eligible.filter((candidate) => candidate.has_relevant_knowledge);
      return (informed.length ? informed : eligible.slice(0, 1)).map((candidate) => candidate.id);
    }
    if (act === "group_question") {
      const informed = eligible.filter((candidate) => candidate.has_relevant_knowledge);
      return (informed.length ? informed : eligible.slice(0, 1)).map((candidate) => candidate.id);
    }
    if (act === "joke_or_sarcasm") return eligible.slice(0, 2).map((candidate) => candidate.id);
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }

  if (["warning", "uncertainty", "joke_or_sarcasm", "social_observation", "factual_question", "personal_question", "request", "ambiguous"].includes(act)) {
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  if (act === "statement" && SOCIAL_UNTARGETED_PATTERNS.test(text)) {
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  return [];
}

function make(speech_act, topic, tone, literal_question, confidence) {
  return Object.freeze({
    version: INTERPRETATION_VERSION,
    speech_act,
    topic,
    tone,
    literal_question: Boolean(literal_question),
    confidence
  });
}

// ─── Response-purpose resolution ──────────────────────────────────────────
/**
 * Maps a bounded interpretation to a deterministic response purpose.
 * This is the authoritative text that enters the wordsmith packet.
 * The AI model must not decide what kind of response to produce.
 *
 * @param {object} interpretation - from interpretUtterance()
 * @param {string} reactionCategory - from personnelContinuity.react() ("acknowledgment"|"question"|"warning"|"uncertainty")
 * @returns {string} response_purpose
 */
function resolveResponsePurpose(interpretation, reactionCategory) {
  const act = interpretation?.speech_act ?? "ambiguous";
  // Reaction category is an additional signal from the continuity system but
  // the speech act is the primary driver — prevents every question from
  // becoming a FAQ lookup.
  switch (act) {
    case "factual_question":
      // Only offer factual recall for genuinely operational queries
      return "acknowledge the question, then supply the single most relevant established fact from supplied known_facts if one is clearly applicable; otherwise ask for clarification";
    case "personal_question":
      return "answer using only facts from your supplied personal memories and experience; if none apply, say so honestly without inventing";
    case "social_observation":
      return "respond naturally to the social observation; do not convert it into an information exchange";
    case "joke_or_sarcasm":
      return "acknowledge socially — brief wry or dry response; do not treat as literal question or factual request";
    case "introduction":
      return "acknowledge the introduction appropriately; keep it brief and in character";
    case "greeting":
      return "return the greeting naturally and briefly";
    case "acknowledgment":
      return "acknowledge in kind; one short phrase is sufficient";
    case "request":
      // Requests are handled deterministically in the equipment-handoff path;
      // if it reaches wordsmithing it means a social/verbal request.
      return "respond to the request in character — confirm, decline, or ask for clarification based on your supplied context";
    case "warning":
      return "acknowledge the warning with urgency; do not add unrelated facts";
    case "uncertainty":
      return "acknowledge the uncertainty; share your own uncertainty if applicable; do not resolve with invented facts";
    case "statement":
      return "respond conversationally if a response is warranted; one or two sentences; do not convert statement into an interrogation";
    case "group_question":
      return interpretation?.topic === "social"
        ? "answer the social check-in briefly for yourself; do not speak for coworkers or introduce operational facts"
        : "answer only for yourself using supplied known_facts and held equipment; keep the answer brief and do not speak for coworkers";
    case "ambiguous":
    default:
      return "respond to the player's confusion or reaction to the immediately preceding exchange; clarify naturally if possible; do not volunteer unrelated task help or unrequested mission facts";
  }
}

// ─── Relevance filter ──────────────────────────────────────────────────────
/**
 * Selects memories and facts relevant to this utterance and speech act.
 * Conservative: returns fewer items rather than dumping everything.
 *
 * @param {object} interpretation - from interpretUtterance()
 * @param {Array}  memories        - already pre-filtered by retrieveRelevantMemories()
 * @param {Array}  knownFacts      - raw known_information items from member
 * @returns {{ relevant_memories, relevant_facts, forbidden_topics }}
 */
function selectRelevantContext(interpretation, memories = [], knownFacts = []) {
  const act = interpretation?.speech_act ?? "ambiguous";
  const topic = interpretation?.topic ?? "unknown";

  // Topics that are NEVER relevant for social/personal speech acts
  const SOCIAL_FORBIDDEN = new Set([
    "time_or_schedule", "route_or_navigation", "mission_objective"
  ]);
  // Topics always relevant regardless of speech act
  const ALWAYS_RELEVANT = new Set([
    "safety_or_risk"
  ]);

  // Determine which facts to surface
  let relevant_facts = [];
  let forbidden_topics = [];

  if (act === "personal_question") {
    // Personal questions: only personal-experience memories
    relevant_facts = knownFacts.filter((f) => {
      const text = String(f.text ?? "").toLowerCase();
      return /\b(?:been|experience|first|before|nervous|claustrophobic|prefer|afraid|worked)\b/.test(text);
    });
    forbidden_topics = ["time_or_schedule", "route_or_navigation", "team_or_roster", "mission_objective", "equipment"];
  } else if (act === "social_observation" || act === "joke_or_sarcasm" || act === "greeting" || act === "introduction" || act === "acknowledgment") {
    // Pure social — no factual context at all
    relevant_facts = knownFacts.filter((f) => ALWAYS_RELEVANT.has(detectTopic(String(f.text ?? ""))));
    forbidden_topics = [...SOCIAL_FORBIDDEN, "equipment", "team_or_roster"];
  } else if (act === "factual_question" || act === "group_question") {
    if (act === "factual_question" && topic === "unknown") {
      // Topic not detected — cannot meaningfully filter by subject.
      // Pass all available facts so the model can answer from whatever it
      // legitimately knows, rather than suppressing everything because no
      // topic matched. forbidden_topics is empty: no specific topic to protect.
      relevant_facts = knownFacts;
      forbidden_topics = [];
    } else {
      // Recognized topic: filter facts to topic match + always-relevant.
      relevant_facts = knownFacts.filter((f) => {
        const fTopic = detectTopic(String(f.text ?? ""));
        return fTopic === topic || ALWAYS_RELEVANT.has(fTopic);
      });
      forbidden_topics = Object.keys(
        Object.fromEntries(
          TOPICS.filter((t) => t !== topic && !ALWAYS_RELEVANT.has(t) && t !== "unknown").map((t) => [t, 1])
        )
      );
    }
  } else if (act === "statement" || act === "uncertainty") {
    // Statements: only facts directly matching topic
    relevant_facts = knownFacts.filter((f) => {
      const fTopic = detectTopic(String(f.text ?? ""));
      return fTopic === topic || ALWAYS_RELEVANT.has(fTopic);
    });
    forbidden_topics = [...SOCIAL_FORBIDDEN];
  } else {
    // Default: pass recent memories only, no raw facts
    relevant_facts = [];
    forbidden_topics = [];
  }

  // Memories: always use the already-scored set from retrieveRelevantMemories,
  // but additionally suppress social memories for social speech acts.
  const relevant_memories = (act === "social_observation" || act === "joke_or_sarcasm" || act === "greeting")
    ? [] // Social acts need no prior exchange history
    : memories.slice(0, 4); // cap at 4 to prevent context dumping

  return {
    relevant_memories,
    relevant_facts: relevant_facts.slice(0, 6), // hard cap
    forbidden_topics
  };
}

// ─── Maxwell hints (shared doctrine without shared call stack) ────────────
/**
 * Returns interpretation hints for Maxwell briefing Q&A.
 * Used to apply the same speech-act doctrine without routing Maxwell through
 * the coworker communication path.
 */
function buildMaxwellWordsmithHints(playerText) {
  return interpretUtterance(String(playerText ?? "").trim(), { isGroup: false });
}

// ─── Autonomous observation-report purpose resolution ─────────────────────
/**
 * Maps a code-selected, allowlisted report purpose (from speech-scheduler.js)
 * to a wording instruction for the model. The scheduler decides WHETHER and
 * WHY a report happens; this only tells the model HOW to phrase it. Mirrors
 * resolveResponsePurpose's role for player-directed dialogue.
 *
 * @param {string} purpose - one of speech-scheduler's REPORT_PURPOSES
 * @returns {string} wording instruction
 */
const REPORT_PURPOSE_INSTRUCTIONS = Object.freeze({
  hazard_warning: "report the hazard urgently and factually; state only the authorized observation, do not speculate about cause and do not downplay the risk",
  equipment_problem: "report the equipment problem factually and briefly; state only the authorized observation",
  anomaly_notice: "report the anomaly factually and briefly; describe only the authorized observation, no speculation",
  personnel_condition: "report the personnel condition factually and with appropriate concern; state only the authorized observation",
  assignment_blocker: "report the assignment blocker factually; state only the authorized observation",
  assignment_finding: "report the assignment finding briefly and factually; state only the authorized observation"
});

function resolveReportPurpose(purpose) {
  return REPORT_PURPOSE_INSTRUCTIONS[purpose] ?? REPORT_PURPOSE_INSTRUCTIONS.anomaly_notice;
}

module.exports = {
  INTERPRETATION_VERSION,
  SPEECH_ACTS,
  TOPICS,
  BARE_REACTION_PATTERN: BARE_REACTION_PATTERNS,
  interpretUtterance,
  inferLocalRecipientType,
  resolveResponseOwners,
  resolveResponsePurpose,
  selectRelevantContext,
  buildMaxwellWordsmithHints,
  resolveReportPurpose
};
