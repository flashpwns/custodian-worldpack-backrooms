"use strict";

// Discourse state + deterministic response planning for LOCAL dialogue.
//
//   interpretation -> DISCOURSE STATE -> SEMANTIC FRAME -> owners -> RESPONSE PLAN
//
// Pure and provider-independent. The model never chooses a listener, recipient,
// topic owner, responder, purpose, discourse function or fact; it only words a
// plan that code already authorized.
//
// Authority notes:
//  - Discourse state is DERIVED from canonical interaction_history (scope) and
//    dialogue_history (committed, heard speech). Nothing here is persisted and
//    no second transcript exists.
//  - Linguistic recognition patterns are owned by dialogue-interpretation.
//  - Wording lives in dialogue-fallback; nothing in this module reads wording.
//  - planResponses consumes owners; it never adds, removes or reorders speakers.

const { interpretUtterance, detectTopic, parseNamedAddress, LANGUAGE_PATTERNS: LP } = require("./dialogue-interpretation");
const canonLexicon = require("./canon-lexicon");

const DISCOURSE_VERSION = "yellow-beast-dialogue-discourse@v2";
const RECENT_TURN_WINDOW = 4;
// Simulation intervals after which a heard exchange stops being an antecedent.
const MAX_INTERVAL_GAP = 6;
// Sanity bound only (matches the packet's player_message cap). Texts that may
// later be repeated faithfully are never clipped below this.
const TEXT_CAP = 2000;
const FACT_TEXT_CAP = 400;

const DISCOURSE_FUNCTIONS = Object.freeze([
  "greet", "introduce_self", "invite_self_description", "ask_factual", "ask_personal_experience",
  "ask_role_or_assignment", "ask_item_ownership", "clarify_previous", "request_repetition", "acknowledge",
  "joke_or_sarcasm", "social_observation", "warn", "challenge", "express_uncertainty", "ambiguous_reference",
  "close_topic",
  // Bounded additions so every utterance lands on an explicit function.
  "check_in", "make_request", "make_statement",
  // The player asks whether listeners heard the PLAYER's own preceding words.
  "ask_heard_confirmation"
]);

const EXPECTED_SHAPES = Object.freeze({
  greet: "short_social_acknowledgment",
  introduce_self: "short_social_acknowledgment",
  invite_self_description: "brief_grounded_self_description",
  ask_factual: "brief_grounded_answer",
  ask_personal_experience: "brief_grounded_personal_answer",
  ask_role_or_assignment: "brief_role_statement",
  ask_item_ownership: "canonical_holder_answer",
  clarify_previous: "clarification_of_preceding_exchange",
  request_repetition: "repetition_of_preceding_utterance",
  acknowledge: "brief_acknowledgment",
  joke_or_sarcasm: "brief_wry_reaction",
  social_observation: "brief_social_reaction",
  warn: "urgent_acknowledgment",
  challenge: "brief_grounded_defense",
  express_uncertainty: "brief_acknowledgment",
  ambiguous_reference: "clarification_request",
  close_topic: "brief_acknowledgment",
  check_in: "short_social_acknowledgment",
  make_request: "brief_request_response",
  make_statement: "brief_conversational_response",
  ask_heard_confirmation: "brief_hearing_confirmation"
});

const REQUESTED_CONTENT = Object.freeze({
  invite_self_description: "self_description",
  ask_role_or_assignment: "role_and_assignment",
  ask_item_ownership: "canonical_holder",
  ask_personal_experience: "personal_experience",
  clarify_previous: "preceding_exchange",
  request_repetition: "preceding_utterance",
  ask_heard_confirmation: "hearing_confirmation"
});

// Functions whose reply is socially obliged once the speaker heard the line,
// independent of the salience-based reaction system and of any wording.
const ANSWERABLE_QUESTIONS = new Set(["ask_factual", "ask_personal_experience", "challenge", "make_request"]);
const OBLIGATING_FUNCTIONS = new Set(["invite_self_description", "ask_role_or_assignment", "clarify_previous", "request_repetition", "ambiguous_reference"]);

/**
 * Pure deterministic eligibility rule (listener state is the caller's input;
 * this decides only the semantic/duty part). Ownership questions oblige only
 * the canonical holder of a uniquely resolved item.
 */
function frameObligatesResponse(frame, responder_id = null, { recipient_type = null, holder_present = true } = {}) {
  const fn = frame?.discourse_function;
  if (fn === "ask_item_ownership") {
    // A directly addressed person owes an answer (holder, lack of knowledge, or
    // a clarification) even when they are not the item's holder. Answering does
    // not make them the owner; the holder fact is supplied by the plan.
    if (recipient_type === "direct") return true;
    const ref = (frame.referents ?? []).find((item) => item.type === "equipment");
    if (!ref?.resolved || !ref.holder) return false;
    // Untargeted/group: the present holder answers; when the holder is not a
    // present coworker anyone who heard may be the (single) speaker.
    return ref.holder === responder_id || !holder_present;
  }
  // Greetings and introductions are socially answered by someone who heard them.
  if (fn === "greet" || fn === "introduce_self") return true;
  // "Did anyone hear what I said?" is answered by a listener who heard it; the
  // per-listener hearing check belongs to the caller (listener state, not wording).
  if (fn === "ask_heard_confirmation") return true;
  // A directly addressed person owes an answer to an answerable question.
  if (recipient_type === "direct" && ANSWERABLE_QUESTIONS.has(fn)) return true;
  return OBLIGATING_FUNCTIONS.has(fn);
}

// A reflexive follow-up is a bare reaction ("What?") or a repetition request.
// Only these may inherit the immediately preceding exchange's scope.
function isFollowUpReflex(text) {
  const raw = String(text ?? "").trim();
  return LP.bare_reaction.test(raw) || LP.repetition_request.test(raw);
}

const cap = (value, n = TEXT_CAP) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const scopeOf = (recipientType) => (recipientType === "direct" ? "direct" : recipientType === "group" ? "group" : "untargeted");

// ─── 1. Discourse state (derived, bounded, not persisted) ──────────────────
/**
 * Bounded conversational context BEFORE the current utterance. Responders come
 * from COMMITTED heard speech only (dialogue_history); an owner whose reply was
 * cancelled or failed never becomes a responder. Heard autonomous LOCAL reports
 * count as exchanges. Only same-location turns within `max_interval_gap`
 * simulation intervals count, at most `window` of them.
 */
function deriveDiscourseState({ interaction_history = [], dialogue_history = [], player_id, location_id = null, current_interval = null, window = RECENT_TURN_WINDOW, max_interval_gap = MAX_INTERVAL_GAP } = {}) {
  const bySubmission = new Map();
  for (const event of dialogue_history ?? []) {
    if (!event?.submission_id) continue;
    const list = bySubmission.get(event.submission_id) ?? [];
    list.push(event);
    bySubmission.set(event.submission_id, list);
  }
  const spoken = (sid) => (bySubmission.get(sid) ?? []).filter((e) => e.speaker_id && e.speaker_id !== player_id && e.kind === "speech" && ["delivered", "heard"].includes(e.delivery ?? "delivered"));
  const intervalOf = (sid) => {
    const values = (bySubmission.get(sid) ?? []).map((e) => Number(e.interval)).filter((n) => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) : null;
  };

  const turns = [];
  for (const item of [...(interaction_history ?? [])].reverse()) {
    if (turns.length >= window) break;
    if (item?.channel !== "local") continue;
    if (item.delivery && !["heard", "delivered"].includes(item.delivery)) continue;
    const source = item.source ?? "player";
    const isPlayerTurn = item.speaker_id === player_id && source === "player";
    const isReport = source === "autonomous-observation" && (item.listeners ?? []).includes(player_id);
    if (!isPlayerTurn && !isReport) continue;
    if ((item.location_id ?? null) !== (location_id ?? null)) break; // the conversation moved
    const committed = spoken(item.submission_id);
    if (isReport && committed.length === 0) continue; // never heard -> not an antecedent
    const interval = intervalOf(item.submission_id);
    if (current_interval != null && interval != null && current_interval - interval > max_interval_gap) break; // stale

    const responses = committed.map((e) => ({ speaker_id: e.speaker_id, speaker_name: e.speaker_name ?? null, text: cap(e.text) }));
    const responderIds = [...new Set(committed.map((e) => e.speaker_id))];
    const playerText = isPlayerTurn ? cap(item.player_text) : null;
    // Interpretation of a prior turn uses the same residual-utterance rule as the
    // live turn (vocative naming the direct target stripped); stored text is untouched.
    const residual = playerText == null ? null : parseNamedAddress(playerText, { explicit_target: item.recipient_type === "direct" ? (item.targets?.[0] ?? null) : null }).residual_text;
    turns.unshift({
      kind: isPlayerTurn ? "player_exchange" : "autonomous_report",
      interaction_id: item.id ?? null,
      submission_id: item.submission_id ?? null,
      player_text: playerText,
      recipient_scope: isPlayerTurn ? scopeOf(item.recipient_type) : "untargeted",
      recipient_type: isPlayerTurn ? (item.recipient_type ?? "none") : "none",
      recipient_id: isPlayerTurn ? (item.recipient_id ?? null) : null,
      recipient_ids: isPlayerTurn ? [...(item.recipient_ids ?? [])] : [],
      responder_ids: responderIds,
      // Coworkers who heard the player's line (canonical interaction listeners).
      listener_ids: [...(item.listeners ?? [])],
      responses,
      interval,
      topic: detectTopic(residual ?? responses.map((r) => r.text).join(" ")),
      discourse_function: isPlayerTurn ? buildSemanticFrame({ text: residual, recipient_type: item.recipient_type ?? "none" }).discourse_function : null
    });
  }

  const last = turns[turns.length - 1] ?? null;
  const previous = turns[turns.length - 2] ?? null;
  const participants = new Set();
  for (const turn of turns) {
    for (const id of turn.recipient_ids) participants.add(id);
    for (const id of turn.responder_ids) participants.add(id);
  }
  return Object.freeze({
    version: DISCOURSE_VERSION,
    window,
    max_interval_gap,
    same_location_required: true,
    location_id: location_id ?? null,
    turns,
    last_turn: last,
    current_topic: last?.topic ?? null,
    previous_topic: previous?.topic ?? null,
    recipient_scope: last?.recipient_scope ?? null,
    active_participants: [...participants],
    last_player_utterance: last?.player_text ?? null,
    last_responder_ids: last?.responder_ids ?? [],
    last_response_texts: (last?.responses ?? []).map((r) => r.text)
  });
}

// ─── 2. Scope inheritance ───────────────────────────────────────────────────
/**
 * Fixed precedence: explicit target > language group address > reflexive
 * follow-up inheriting the preceding same-location exchange > untargeted.
 */
function resolveRecipientScope({ text, explicit_target = null, group_address = false, discourse = null, present_ids = [] } = {}) {
  if (explicit_target) return { recipient_type: "direct", recipient_ids: [], inherited: false, source: "explicit_target" };
  if (group_address) return { recipient_type: "group", recipient_ids: [], inherited: false, source: "group_address" };
  const last = discourse?.last_turn ?? null;
  if (last && isFollowUpReflex(text)) {
    const present = new Set(present_ids);
    if (last.kind === "autonomous_report") {
      const reporter = last.responder_ids[0];
      if (reporter && present.has(reporter)) return { recipient_type: "direct", recipient_ids: [reporter], inherited: true, source: "prior_autonomous_report" };
    } else if (last.recipient_type === "group") {
      const ids = last.recipient_ids.filter((id) => present.has(id));
      if (ids.length > 0) return { recipient_type: "group", recipient_ids: ids, inherited: true, source: "prior_group_exchange" };
    } else if (last.recipient_type === "direct" && last.recipient_id && present.has(last.recipient_id)) {
      return { recipient_type: "direct", recipient_ids: [last.recipient_id], inherited: true, source: "prior_direct_exchange" };
    }
  }
  return { recipient_type: "none", recipient_ids: [], inherited: false, source: "untargeted" };
}

// ─── 3. Referent resolution (the ONE canonical item resolver) ───────────────
const STOP = new Set(["the", "who", "was", "were", "has", "have", "had", "got", "assigned", "carrying", "holding", "responsible", "which", "that", "this", "with", "for", "kit", "item", "gear", "equipment"]);
// Words too generic to identify an item on their own.
const GENERIC = new Set(["record", "device", "field", "survey", "layout", "startup", "materials", "stores"]);

/**
 * Resolves a named item against canonical equipment. Only a UNIQUE match
 * resolves. Exact phrase matches always count; single-word matches only when
 * `loose` (ownership / handoff / request wording).
 */
function resolveEquipmentReferent(text, equipment = {}, { loose = false } = {}) {
  const normalized = String(text ?? "").toLowerCase().replace(/-/g, " ");
  const items = Object.entries(equipment ?? {}).map(([key, item]) => (item && typeof item === "object" ? (item.id ? item : { ...item, id: key }) : null)).filter(Boolean);
  const phrases = (item) => [item.label, item.type, item.id].filter(Boolean).map((v) => String(v).toLowerCase().replace(/-/g, " "));
  const hasPhrase = (p) => new RegExp(`(?:^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(normalized);
  let matches = items.filter((item) => phrases(item).some(hasPhrase));
  if (matches.length === 0 && loose) {
    const words = normalized.match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [];
    matches = items.filter((item) => phrases(item).some((p) => p.split(/\s+/).some((term) => term.length >= 4 && !STOP.has(term) && !GENERIC.has(term) && words.includes(term))));
  }
  const unique = [...new Map(matches.map((item) => [item.id, item])).values()];
  if (unique.length === 1) return { status: "unique", item: unique[0] };
  if (unique.length > 1) return { status: "ambiguous", items: unique };
  return { status: "none" };
}

function resolveAntecedent({ discourse_function, discourse, referents = [] } = {}) {
  const last = discourse?.last_turn ?? null;
  if (discourse_function === "ask_heard_confirmation") {
    // The line being asked about is the player's own most recent heard line,
    // never a coworker report and never the current utterance.
    const turns = discourse?.turns ?? [];
    const prior = [...turns].reverse().find((turn) => turn.kind === "player_exchange" && turn.player_text) ?? null;
    if (!prior) return { type: "none", resolved: false, reason: "no_prior_player_utterance" };
    return { type: "prior_player_utterance", resolved: true, interaction_id: prior.interaction_id, player_text: prior.player_text, listener_ids: [...(prior.listener_ids ?? [])] };
  }
  if (discourse_function === "clarify_previous" || discourse_function === "request_repetition") {
    if (!last) return { type: "none", resolved: false, reason: "no_preceding_exchange" };
    // Repair of a repair points at the ORIGINAL line being repaired, never at
    // the earlier repair's own restatement.
    const turns = discourse?.turns ?? [];
    let index = turns.length - 1;
    while (index > 0 && ["clarify_previous", "request_repetition"].includes(turns[index]?.discourse_function) && turns[index - 1]?.responses?.length) index -= 1;
    const target = turns[index] ?? last;
    return resolveFromTurn(discourse_function, target);
  }
  const item = referents.find((r) => r.type === "equipment");
  if (item) return { type: "equipment_entity", resolved: item.resolved !== false, entity_id: item.id ?? null };
  return { type: "none", resolved: true };
}

/** A repair turn concerns the responder's OWN preceding line when it has one; otherwise only the last heard line. Never every speaker's lines. */
function repairTargets(responses = [], responder_id = null) {
  const own = responses.filter((r) => r.speaker_id === responder_id);
  return own.length ? own.slice(-1) : responses.slice(-1);
}

const question_form_yes_no = (raw) => /^(?:are|is|do|does|did|can|could|will|would|have|has|should|was|were)\b/i.test(raw) || /^(?:you\b.*\?)$/i.test(raw);

function resolveFromTurn(discourse_function, last) {
  {
    const lastResponse = last.responses[last.responses.length - 1] ?? null;
    return {
      type: last.kind === "autonomous_report" ? "prior_report" : (discourse_function === "request_repetition" && lastResponse ? "prior_response" : "prior_exchange"),
      resolved: true,
      interaction_id: last.interaction_id,
      player_text: last.player_text,
      responder_ids: last.responder_ids,
      responses: last.responses
    };
  }
}

// ─── 4. Semantic frame ──────────────────────────────────────────────────────
/**
 * Deterministic frame for the RESIDUAL utterance (named address already
 * stripped by the caller). `discourse` may be null (context-free classification).
 */
function buildSemanticFrame({ text, recipient_type = "none", interpretation = null, discourse = null, equipment = {}, scope_inherited = false } = {}) {
  const raw = String(text ?? "").trim();
  const interp = interpretation?.version ? interpretation : interpretUtterance(raw, { isGroup: recipient_type === "group" });
  const referents = [];
  let fn = null;
  let unresolved = false;
  let background = false;

  const ownership = LP.item_ownership.test(raw) && LP.item_noun.test(raw);

  if (LP.bare_reaction.test(raw)) fn = "clarify_previous";
  else if (LP.repetition_request.test(raw)) fn = "request_repetition";
  else if (LP.heard_confirmation.test(raw)) fn = "ask_heard_confirmation";
  else if (LP.ambiguous_reference.test(raw)) { fn = "ambiguous_reference"; unresolved = true; }
  else if (ownership) fn = "ask_item_ownership";
  else if (LP.invite_self_description.test(raw)) fn = "invite_self_description";
  else if (LP.background.test(raw)) { fn = "ask_personal_experience"; background = true; }
  else if (LP.role_or_assignment.test(raw)) fn = "ask_role_or_assignment";
  else if (LP.close_topic.test(raw)) fn = "close_topic";
  else if (LP.challenge.test(raw)) fn = "challenge";
  else if (LP.check_in.test(raw)) fn = "check_in";
  else if (LP.handoff_request.test(raw) && LP.request_cue.test(raw)) fn = "make_request";
  else {
    switch (interp.speech_act) {
      case "greeting": fn = "greet"; break;
      case "introduction": fn = "introduce_self"; break;
      case "acknowledgment": fn = "acknowledge"; break;
      case "joke_or_sarcasm": fn = "joke_or_sarcasm"; break;
      case "social_observation": fn = "social_observation"; break;
      case "warning": fn = "warn"; break;
      case "uncertainty": fn = "express_uncertainty"; break;
      case "personal_question": fn = "ask_personal_experience"; break;
      case "factual_question": case "group_question": fn = "ask_factual"; break;
      case "request": fn = "make_request"; break;
      case "statement": fn = "make_statement"; break;
      default: fn = "ambiguous_reference"; unresolved = true;
    }
  }

  // The single canonical item resolution for this utterance.
  const item = resolveEquipmentReferent(raw, equipment, { loose: fn === "ask_item_ownership" || fn === "make_request" || LP.handoff_request.test(raw) });
  if (item.status === "unique") {
    referents.push({ type: "equipment", id: item.item.id, label: item.item.label ?? item.item.id, holder: item.item.holder ?? null, resolved: true });
  } else if (item.status === "ambiguous") {
    referents.push({ type: "equipment", id: null, label: null, holder: null, resolved: false, reason: "multiple_matches" });
    unresolved = true;
  } else if (fn === "ask_item_ownership") {
    referents.push({ type: "equipment", id: null, label: null, holder: null, resolved: false, reason: "no_canonical_match" });
    unresolved = true;
  }

  const frame = {
    version: DISCOURSE_VERSION,
    speech_act: interp.speech_act,
    discourse_function: fn,
    topic: interp.topic,
    target_scope: scopeOf(recipient_type),
    scope_inherited: Boolean(scope_inherited),
    referents,
    requested_content: background ? "background" : (REQUESTED_CONTENT[fn] ?? null),
    expected_response_shape: EXPECTED_SHAPES[fn],
    literal_question: fn === "ambiguous_reference" ? false : interp.literal_question,
    question_form: /^(?:who|what|where|when|why|how|which)\b/i.test(raw) ? "wh" : (/^(?:are|is|do|does|did|can|could|will|would|have|has|should|was|were)\b/i.test(raw) ? "yes_no" : null),
    // A yes/no question about the addressee's own momentary state ("Are you ready?").
    addressee_state: question_form_yes_no(raw) && /\byou(?:'re| are)?\b/i.test(raw) && !/\b(?:know|seen|been|heard|remember|think|tell|any|carry|carrying|have|got|route|outpost)\b/i.test(raw),
    tone: interp.tone,
    confidence: interp.confidence,
    unresolved_reference: unresolved
  };

  frame.antecedent = resolveAntecedent({ discourse_function: fn, discourse, referents });
  if (!frame.antecedent.resolved && (fn === "clarify_previous" || fn === "request_repetition" || fn === "ask_heard_confirmation")) {
    // Nothing to clarify or repeat: never guess. Degrade to a clarification request.
    frame.unresolved_reference = true;
    frame.expected_response_shape = EXPECTED_SHAPES.ambiguous_reference;
  }
  return Object.freeze(frame);
}

/** Thread state + summary for the current turn. */
function summarizeDiscourse(discourse, frame) {
  const prior = discourse?.last_turn ?? null;
  let thread_state = "continuing";
  if (!prior) thread_state = "opened";
  else if (["clarify_previous", "request_repetition", "ambiguous_reference"].includes(frame?.discourse_function)) thread_state = "repairing";
  else if (frame?.discourse_function === "close_topic") thread_state = "closing";
  return {
    thread_state,
    current_topic: frame?.topic ?? null,
    previous_topic: discourse?.current_topic ?? null,
    recipient_scope: frame?.target_scope ?? null,
    active_participants: discourse?.active_participants ?? [],
    last_player_utterance: discourse?.last_player_utterance ?? null,
    last_responder_ids: discourse?.last_responder_ids ?? [],
    last_response_texts: discourse?.last_response_texts ?? [],
    antecedent_type: frame?.antecedent?.type ?? "none",
    unresolved_reference: Boolean(frame?.unresolved_reference),
    same_location_required: true,
    window: discourse?.window ?? RECENT_TURN_WINDOW,
    recent_turns: discourse?.turns?.length ?? 0
  };
}

// ─── 5. Character self-knowledge (bounded projection) ───────────────────────
// Identity substrate is split. STYLE keys shape wording only and are never
// facts. FACT keys are surfaced only when a plan explicitly authorizes them.
const IDENTITY_STYLE_KEYS = Object.freeze(["social_expression", "conversational_temperament", "social_tendency", "behavioral_disposition"]);
const PLAN_AUTHORIZABLE_IDENTITY_FACTS = Object.freeze(["education_or_trade", "async_tenure"]);
const pick = (source, keys) => Object.fromEntries(keys.filter((key) => source?.[key] != null).map((key) => [key, source[key]]));

// ─── Assignment presentation (the ONE task -> player-safe phrase helper) ────
const INTERNAL_ID = /\b(?:q4|yb-personnel|coordinated|open-passage|clear-q4|item|actor|node|edge|entity)-[a-z0-9][a-z0-9:-]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\[object /i;
// Bounded phrases for the archetype-authored primary_task slugs.
const PRIMARY_TASK_PHRASES = Object.freeze({
  "verbal-recall": "keeping the verbal record",
  "material-delivery": "delivering the startup materials",
  "layout-compilation": "compiling the layout record"
});

/**
 * Renders a canonical task/assignment into a bounded player-safe phrase, or
 * null. Never exposes ids, state names or raw object structure. `names` maps
 * personnel ids to spoken names ("you" for the player); `equipment` is the
 * canonical equipment map used only to name an operated item.
 */
function presentAssignment({ task = null, primary_task = null, names = {}, equipment = {}, player_id = null } = {}) {
  const fromTask = (() => {
    if (typeof task === "string") return task.trim() && !INTERNAL_ID.test(task) && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(task.trim()) ? sentence(task) : (PRIMARY_TASK_PHRASES[task.trim()] ?? null);
    if (!task || typeof task !== "object" || !["active", "pending"].includes(task.state ?? "active")) return null;
    switch (task.type) {
      case "follow": {
        if (!task.target || task.target === player_id || names[task.target] === "you") return "staying with the expedition lead";
        return names[task.target] ? `staying with ${names[task.target]}` : "staying with the team";
      }
      case "wait": return "waiting here";
      case "hold": return "holding position";
      case "assist": return "assisting a teammate";
      case "operate": {
        const item = Object.values(equipment ?? {}).find((entry) => entry?.id === task.target || entry?.instance_id === task.target) ?? equipment?.[task.target] ?? null;
        return item?.label ? `operating the ${String(item.label).toLowerCase()}` : null;
      }
      default: return null;
    }
  })();
  if (fromTask) return fromTask;
  if (typeof primary_task === "string") return PRIMARY_TASK_PHRASES[primary_task.trim()] ?? (!INTERNAL_ID.test(primary_task) && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(primary_task.trim()) ? sentence(primary_task) : null);
  return null;
}
function sentence(value) { return String(value ?? "").trim().replace(/[.!?\s]+$/, ""); }

const safePhrase = (value) => (typeof value === "string" && value.trim() && !INTERNAL_ID.test(value) ? cap(String(value).replace(/-/g, " "), FACT_TEXT_CAP) : null);

/**
 * Structured semantic form of a resolved known answer (from
 * personnelContinuity.resolveKnownAnswer). Never wording: the fallback and the
 * model both read THIS fact, and owner relevance is decided from the same answer.
 */
function toKnownAnswerFact(resolved) {
  if (!resolved) return null;
  if (resolved.kind === "recalled-player-statement" || resolved.kind === "recalled-own-reply") return { kind: resolved.kind, text: cap(resolved.text, FACT_TEXT_CAP) };
  if (resolved.kind === "own-report") {
    const direct = resolved.direct ?? {};
    const condition = resolved.condition ?? {};
    const report = {
      kind: "own-report",
      checked_location: direct.kind === "location-investigated" ? safePhrase(direct.location) : null,
      inspected_target: direct.kind !== "location-investigated" ? safePhrase(direct.target) : null,
      condition_reason: safePhrase(condition.reason),
      condition: condition.condition && String(condition.condition).toLowerCase() !== "normal" ? safePhrase(condition.condition) : null
    };
    // A report with nothing presentable (internal ids only) is not an answer.
    return report.checked_location || report.inspected_target || report.condition_reason || report.condition ? report : null;
  }
  return null;
}

function buildSelfKnowledge({ person = null, member = null, task = null, held_equipment = [], relationships = [], known_facts = [], known_answer = null, names = {}, equipment = {}, player_id = null, custody_known = {} } = {}) {
  const source = person ?? member ?? {};
  const substrate = source.identity_substrate ?? null;
  return Object.freeze({
    name: source.first_name ?? source.display_name ?? member?.first_name ?? member?.display_name ?? null,
    role: source.role ?? member?.role ?? null,
    current_assignment: presentAssignment({ task, primary_task: source.primary_task ?? member?.primary_task ?? null, names, equipment, player_id }),
    current_activity: typeof (source.current_activity ?? member?.current_activity) === "string" ? presentAssignment({ task: source.current_activity ?? member.current_activity }) : null,
    held_equipment: held_equipment.map((item) => (typeof item === "string" ? item : item?.label ?? item?.id)).filter(Boolean),
    prior_expedition_experience: source.prior_expedition_experience ?? null,
    identity_style: pick(substrate, IDENTITY_STYLE_KEYS),
    identity_facts: pick(substrate, PLAN_AUTHORIZABLE_IDENTITY_FACTS),
    established_relationships: relationships.slice(0, 3),
    known_answer,
    // equipment id -> whether THIS speaker can know its holder (observer authority).
    custody_known: { ...custody_known },
    known_facts: known_facts.map((f) => ({ kind: f.kind ?? null, text: cap(f.text, FACT_TEXT_CAP) })).filter((f) => f.text)
  });
}

// ─── 6. Response plan ───────────────────────────────────────────────────────
const COMMON_FORBIDDEN = Object.freeze(["invented_biography", "future_knowledge", "hidden_state", "state_mutation", "speaking_for_other_coworkers"]);
const NO_TASK_HELP = Object.freeze(["unrequested_mission_briefing", "unrelated_task_offer"]);
// Functions that must never become mission help.
const SOCIAL_FUNCTIONS = new Set(["greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "check_in", "close_topic", "clarify_previous", "request_repetition", "ambiguous_reference", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience", "ask_heard_confirmation"]);

const PURPOSES = Object.freeze({
  greet: "return the greeting briefly and socially; add no operational content",
  introduce_self: "acknowledge the player's introduction briefly; do not ask questions or start a questionnaire",
  invite_self_description: "briefly identify yourself and your current role or assignment in one or two short sentences; add only supplied optional facts",
  ask_factual: "answer only from supplied required_facts; if there are none, say you do not know without inventing",
  ask_personal_experience: "answer only from supplied required_facts; if there are none, say honestly that you have nothing established to share",
  ask_role_or_assignment: "state your role and current assignment from supplied required_facts, briefly",
  ask_item_ownership: "state the canonical holder of the named item exactly as supplied; if the item is unresolved, ask which item is meant; do not speculate",
  clarify_previous: "clarify or restate the immediately preceding exchange using only its supplied text; do not volunteer a mission briefing or unrelated task help",
  request_repetition: "repeat the immediately preceding relevant utterance using only its supplied text",
  acknowledge: "acknowledge in kind with one short phrase",
  joke_or_sarcasm: "react socially with a brief wry or dry line in your own style; do not treat it as a literal question, redirect, or offer task help",
  social_observation: "react naturally to the remark; do not convert it into an information exchange or briefing",
  warn: "acknowledge the warning with urgency; add no unrelated facts",
  challenge: "respond to the challenge briefly using only supplied required_facts; do not invent support",
  express_uncertainty: "acknowledge the uncertainty; do not resolve it with invented facts",
  ambiguous_reference: "ask the player what they mean; do not guess or invent a meaning",
  close_topic: "acknowledge the topic being dropped in one short phrase",
  check_in: "answer the social check-in briefly for yourself only; add no operational facts",
  make_request: "respond to the request in character using only supplied required_facts",
  make_statement: "respond conversationally only if warranted; do not interrogate",
  ask_heard_confirmation: "confirm plainly that you heard what they just said; you may briefly acknowledge what they said but add no interpretation, urgency, motive or action, and do not ask whether anyone heard you"
});

/** Known facts relevant to the frame's topic; an unknown topic dumps nothing. */
function selectKnownFacts(frame, knownFacts = [], limit = 3) {
  const topic = frame?.topic ?? "unknown";
  if (topic === "unknown") return [];
  return knownFacts
    .map((fact) => ({ topic: detectTopic(String(fact.text ?? "")), text: fact.text }))
    .filter((fact) => fact.topic === topic || fact.topic === "safety_or_risk")
    .slice(0, limit)
    .map((fact) => ({ key: "known_fact", value: { topic: fact.topic, text: fact.text } }));
}

/**
 * One plan per already-authorized owner. `responders[id]` = { self, } where
 * self is a buildSelfKnowledge projection. `names[id]` maps ids to spoken
 * names ("you" for the player) so model-facing facts never carry internal ids.
 */
function planResponses({ frame, owner_ids = [], responders = {}, names = {} } = {}) {
  const fn = frame?.discourse_function ?? "ambiguous_reference";
  const planned = [];
  for (const responder_id of owner_ids) {
    const self = responders[responder_id]?.self ?? null;
    const required = [];
    const optional = [];
    const forbidden = [...COMMON_FORBIDDEN, ...(SOCIAL_FUNCTIONS.has(fn) ? NO_TASK_HELP : [])];
    const identity = self?.identity_facts ?? {};
    // Custody the responder cannot know stays unknown: the plan names the holder only
    // when the observer/knowledge authority allows this speaker to know it.
    const holderFact = (ref) => {
      const known = ref.holder === responder_id || self?.custody_known?.[ref.id] !== false;
      return { label: ref.label, holder_name: known ? (names[ref.holder] ?? null) : null, holder_is_self: ref.holder === responder_id, ...(known ? {} : { holder_known: false }) };
    };

    if (fn === "invite_self_description" || fn === "ask_role_or_assignment") {
      if (self?.name) required.push({ key: "name", value: self.name });
      if (self?.role) required.push({ key: "role", value: self.role });
      if (self?.current_assignment) required.push({ key: "current_assignment", value: self.current_assignment });
      if (self?.held_equipment?.length) optional.push({ key: "held_equipment", value: self.held_equipment });
      // Generic self-description stays minimal: no background, tenure, region,
      // age, preferences or concerns unless the player actually asks.
      if (fn === "invite_self_description" && self?.current_activity) optional.push({ key: "current_activity", value: self.current_activity });
    } else if (fn === "ask_personal_experience") {
      if (self?.known_answer) required.push({ key: "known_answer", value: self.known_answer });
      if (frame.requested_content === "background") {
        // Explicit background question: the authorized background facts only.
        if (identity.education_or_trade) required.push({ key: "identity_fact", value: { education_or_trade: identity.education_or_trade } });
        if (identity.async_tenure) optional.push({ key: "identity_fact", value: { async_tenure: identity.async_tenure } });
      } else if (self?.prior_expedition_experience) {
        // Company tenure is not expedition experience and is never a substitute.
        required.push({ key: "prior_expedition_experience", value: self.prior_expedition_experience });
      }
    } else if (fn === "ask_item_ownership") {
      for (const ref of frame.referents ?? []) {
        if (ref.resolved) required.push({ key: "item_holder", value: holderFact(ref) });
      }
    } else if (fn === "ask_heard_confirmation") {
      const ante = frame.antecedent ?? {};
      if (ante.resolved) {
        // Hearing is decided from canonical listener state, never by the model.
        const heard = (ante.listener_ids ?? []).includes(responder_id);
        required.push({ key: "heard_confirmation", value: { heard, line: ante.player_text ?? null } });
      }
      forbidden.push("unrequested_interpretation", "invented_urgency");
    } else if (fn === "clarify_previous" || fn === "request_repetition") {
      const ante = frame.antecedent ?? {};
      if (ante.resolved) {
        if (ante.player_text) required.push({ key: "antecedent_player_text", value: ante.player_text });
        required.push({ key: "antecedent_responses", value: repairTargets(ante.responses ?? [], responder_id).map((r) => ({ speaker_name: r.speaker_name, text: r.text, is_self: r.speaker_id === responder_id })) });
      }
      forbidden.push("new_factual_claims");
    } else if (fn === "ask_factual" || fn === "challenge") {
      if (self?.known_answer) required.push({ key: "known_answer", value: self.known_answer });
      required.push(...selectKnownFacts(frame, self?.known_facts));
      const referent = (frame.referents ?? []).find((ref) => ref.resolved);
      if (referent && referent.holder === responder_id) required.push({ key: "item_holder", value: holderFact(referent) });
      else if (frame.topic === "equipment" && !(frame.referents ?? []).length && self?.held_equipment?.length) required.push({ key: "held_equipment", value: self.held_equipment });
    } else if (fn === "make_statement") {
      if (self?.known_answer) required.push({ key: "known_answer", value: self.known_answer });
    } else if (fn === "make_request") {
      for (const ref of frame.referents ?? []) if (ref.resolved) required.push({ key: "item_holder", value: holderFact(ref) });
    }

    planned.push({
      responder_id,
      recipient_scope: frame?.target_scope ?? "untargeted",
      discourse_function: fn,
      purpose: PURPOSES[fn],
      requested_content: frame?.requested_content ?? null,
      expected_response_shape: frame?.expected_response_shape ?? EXPECTED_SHAPES[fn],
      required_facts: required,
      optional_facts: optional,
      forbidden_claims: forbidden,
      may_ask_clarifying_question: fn === "ambiguous_reference" || Boolean(frame?.unresolved_reference),
      same_turn_prior_responses: planned.map((p) => p.responder_id),
      // STYLE-ONLY: shapes wording, never a factual claim.
      style_hints: { ...(self?.identity_style ?? {}) }
    });
  }
  return planned;
}

/**
 * The model-facing projection of a plan: exactly what is needed to word the
 * authorized contribution, with no internal ids and no implementation fields.
 */
function toAuthorizedContribution(plan, frame, { names = {} } = {}) {
  if (!plan) return null;
  const ante = frame?.antecedent ?? { type: "none", resolved: true };
  return {
    discourse_function: plan.discourse_function,
    purpose: plan.purpose,
    expected_response_shape: plan.expected_response_shape,
    requested_content: plan.requested_content,
    topic: frame?.topic ?? null,
    question_form: frame?.question_form ?? null,
    addressee_state: Boolean(frame?.addressee_state),
    referents: (frame?.referents ?? []).map((ref) => ({ type: ref.type, label: ref.label ?? null, resolved: Boolean(ref.resolved), ...(ref.reason ? { reason: ref.reason } : {}) })),
    antecedent: !["clarify_previous", "request_repetition"].includes(plan.discourse_function)
      ? null
      : { type: ante.type, resolved: Boolean(ante.resolved), ...(ante.resolved && ante.responses ? { player_text: ante.player_text ?? null, responses: repairTargets(ante.responses, plan.responder_id).map((r) => ({ speaker_name: r.speaker_name ?? names[r.speaker_id] ?? null, text: r.text })) } : {}) },
    required_facts: plan.required_facts,
    optional_facts: plan.optional_facts,
    forbidden_claims: plan.forbidden_claims,
    may_ask_clarifying_question: plan.may_ask_clarifying_question,
    // Filled at packet build time with already-ACCEPTED wording only.
    same_turn_prior_responses: [],
    style_hints: plan.style_hints
  };
}

// ─── 7. Dev trace (concise; never player-facing, never canonical) ───────────
function formatDiscourseTrace({ raw_utterance, utterance = null, recipient_scope, frame, discourse_summary, owner_ids = [], plans = [], grounded_facts = [], provider_result = null, fallback_used = null, committed_event_ids = null } = {}) {
  return JSON.stringify({
    utterance: raw_utterance,
    residual: utterance && utterance !== raw_utterance ? utterance : undefined,
    scope: recipient_scope,
    frame: frame ? { fn: frame.discourse_function, speech_act: frame.speech_act, topic: frame.topic, shape: frame.expected_response_shape, requested: frame.requested_content, unresolved: frame.unresolved_reference, inherited: frame.scope_inherited, conf: frame.confidence } : null,
    antecedent: frame?.antecedent ? { type: frame.antecedent.type, resolved: frame.antecedent.resolved } : null,
    discourse: discourse_summary ? { thread: discourse_summary.thread_state, topic: discourse_summary.current_topic, prev_topic: discourse_summary.previous_topic, last_responders: discourse_summary.last_responder_ids } : null,
    owners: owner_ids,
    plans: plans.map((p) => ({ responder: p.responder_id, fn: p.discourse_function, purpose: p.purpose, required: p.required_facts.map((f) => f.key), clarify: p.may_ask_clarifying_question })),
    grounded_facts,
    provider_result,
    fallback_used,
    committed: committed_event_ids
  });
}

/**
 * Autonomous NPC speech plan: the speech scheduler already decided WHETHER,
 * WHO and WHEN; this only builds the same authorized_contribution shape the
 * player-response path uses so wording, validation and fallback are shared.
 * The only authorized fact is the observation the observer actually holds.
 */
const REPORT_PURPOSE_TEXT = Object.freeze({
  hazard_warning: "say briefly and urgently that you have noticed this; state only the authorized observation, do not speculate about cause and do not downplay it",
  equipment_problem: "say briefly that something about this needs attention; state only the authorized observation",
  anomaly_notice: "say briefly that you noticed this; describe only the authorized observation, no speculation",
  personnel_condition: "say briefly, with appropriate concern, that you noticed something about a teammate; state only the authorized observation",
  assignment_blocker: "say briefly that this is in the way of your assignment; state only the authorized observation",
  assignment_finding: "say briefly what you found on your assignment; state only the authorized observation"
});
function buildAutonomousContribution({ kind = null, canonical_id = null, state = null, purpose = "anomaly_notice", disposition = null, identity_substrate = null } = {}) {
  // A canonical world entity keeps its canonical name and class; the wording layer never invents a label.
  const entity = canonLexicon.resolveCanonicalEntity(canonical_id);
  const subject = entity ? entity.bare_name : safePhrase(String(canonical_id ?? "").replace(/[:_]/g, " "));
  const key = REPORT_PURPOSE_TEXT[purpose] ? purpose : "anomaly_notice";
  return {
    discourse_function: "report_observation",
    purpose: REPORT_PURPOSE_TEXT[key],
    expected_response_shape: "brief_grounded_report",
    requested_content: null,
    topic: null,
    question_form: null,
    addressee_state: false,
    referents: [],
    antecedent: null,
    // Model-visible fact: only what was noticed. The scheduler's bookkeeping
    // (state, purpose key, disposition) stays out of the wording surface.
    report_purpose: key,
    required_facts: [{ key: "observation", value: entity ? { subject, subject_phrase: entity.display_name, entity_class: entity.entity_class, portable: entity.portable } : { subject } }],
    optional_facts: [],
    forbidden_claims: [...COMMON_FORBIDDEN, ...NO_TASK_HELP, "unsupported_sensory_claims", "invented_anomaly_properties"],
    may_ask_clarifying_question: false,
    same_turn_prior_responses: [],
    style_hints: pick(identity_substrate, IDENTITY_STYLE_KEYS)
  };
}

const KNOWN_ANSWER_FUNCTIONS = Object.freeze(["ask_personal_experience", "ask_factual", "challenge", "make_statement"]);

module.exports = {
  buildAutonomousContribution,
  safePhrase,
  repairTargets,
  INTERNAL_ID,
  KNOWN_ANSWER_FUNCTIONS,
  DISCOURSE_VERSION,
  RECENT_TURN_WINDOW,
  MAX_INTERVAL_GAP,
  DISCOURSE_FUNCTIONS,
  EXPECTED_SHAPES,
  IDENTITY_STYLE_KEYS,
  PLAN_AUTHORIZABLE_IDENTITY_FACTS,
  frameObligatesResponse,
  isFollowUpReflex,
  deriveDiscourseState,
  resolveRecipientScope,
  resolveEquipmentReferent,
  resolveAntecedent,
  buildSemanticFrame,
  summarizeDiscourse,
  buildSelfKnowledge,
  presentAssignment,
  planResponses,
  selectKnownFacts,
  toKnownAnswerFact,
  toAuthorizedContribution,
  formatDiscourseTrace
};
