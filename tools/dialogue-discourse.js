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

const { interpretUtterance, detectTopic, parseNamedAddress, selfStateQuery, LANGUAGE_PATTERNS: LP } = require("./dialogue-interpretation");
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
  "ask_heard_confirmation",
  // "What's next?": the current procedure, from canonical phase/briefing authority only.
  "ask_next_step",
  // "Why?" / "What makes you say that?": the reason for the speaker's own preceding line, taken from
  // the semantic basis that line was authorized with -- never a rationale invented afterwards.
  "ask_explanation",
  // "What do you think?": the listener's own opinion -- only a canonical opinion may be stated.
  "ask_opinion"
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
  ask_heard_confirmation: "brief_hearing_confirmation",
  ask_next_step: "brief_procedure_answer",
  ask_explanation: "brief_basis_explanation",
  ask_opinion: "brief_opinion_stance"
});

const REQUESTED_CONTENT = Object.freeze({
  invite_self_description: "self_description",
  ask_role_or_assignment: "role_and_assignment",
  ask_item_ownership: "canonical_holder",
  ask_personal_experience: "personal_experience",
  clarify_previous: "preceding_exchange",
  request_repetition: "preceding_utterance",
  ask_heard_confirmation: "hearing_confirmation",
  ask_next_step: "current_procedure",
  ask_explanation: "basis_of_preceding_line",
  ask_opinion: "own_opinion"
});

// Functions whose reply is socially obliged once the speaker heard the line,
// independent of the salience-based reaction system and of any wording.
const ANSWERABLE_QUESTIONS = new Set(["ask_factual", "ask_personal_experience", "challenge", "make_request"]);
const OBLIGATING_FUNCTIONS = new Set(["invite_self_description", "ask_role_or_assignment", "clarify_previous", "request_repetition", "ambiguous_reference", "ask_next_step", "ask_explanation"]);

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
  // A question about the listeners' own feelings, asked of them directly or as a group, is theirs to
  // answer (each answer is individual; ownership decides how many speak).
  if (fn === "check_in" && (recipient_type === "group" || recipient_type === "direct")) return true;
  // So is any question whose answer is each listener's own (experience, opinion, role).
  if (["ask_personal_experience", "ask_opinion", "ask_role_or_assignment"].includes(fn) && (recipient_type === "group" || recipient_type === "direct")) return true;
  // A requested action is acknowledged (never performed) by someone who heard it.
  if (fn === "make_request" && frame?.requested_action) return true;
  // Answering a clarification ("Which thing?" -> "I mean the camera.") obliges the one who asked it.
  if (frame?.resumed_question?.responder_ids?.length && fn !== "ask_item_ownership") return frame.resumed_question.responder_ids.includes(responder_id);
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
function deriveDiscourseState({ interaction_history = [], dialogue_history = [], player_id, location_id = null, current_interval = null, window = RECENT_TURN_WINDOW, max_interval_gap = MAX_INTERVAL_GAP, equipment = null, receipts = [] } = {}) {
  // WHY each committed line was said: the plan it was authorized with, persisted in the turn's
  // communication receipt (never the wording). Keyed by submission, then speaker.
  const basisBySubmission = new Map();
  for (const receipt of receipts ?? []) {
    if (!receipt?.id || !Array.isArray(receipt.response_contexts)) continue;
    const bases = {};
    for (const context of receipt.response_contexts) if (context?.target_worker_id && context.response_plan) bases[context.target_worker_id] = responseBasisFromPlan(context.response_plan, context.semantic_frame ?? null);
    basisBySubmission.set(receipt.id, bases);
  }
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

    const bases = basisBySubmission.get(item.submission_id) ?? {};
    // An autonomous report only ever voices the speaker's own authorized observation.
    const responses = committed.map((e) => ({ speaker_id: e.speaker_id, speaker_name: e.speaker_name ?? null, text: cap(e.text), basis: bases[e.speaker_id] ?? (isReport ? { kind: "observation" } : null) }));
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
      _residual: residual,
      _committed: committed.length
    });
  }

  // Each prior player turn is re-framed CHRONOLOGICALLY with the open question and item antecedent as
  // they stood at that point, so a resumed fragment ("The camera.") reconstructs exactly as it was
  // framed live -- including after a cold reload. Everything is derived from persisted history.
  let openQuestion = null;
  let itemSoFar = null;
  for (const turn of turns) {
    const residual = turn._residual;
    const committedCount = turn._committed;
    delete turn._residual;
    delete turn._committed;
    if (turn.kind !== "player_exchange") { turn.discourse_function = null; turn.item_referent = null; turn.awaiting_clarification = false; openQuestion = null; continue; }
    const priorFrame = buildSemanticFrame({ text: residual, recipient_type: turn.recipient_type ?? "none", equipment: equipment ?? {}, discourse: { pending_question: openQuestion, last_item_referent: itemSoFar, turns: [] } });
    const priorItem = (priorFrame.referents ?? []).find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
    turn.discourse_function = priorFrame.discourse_function ?? null;
    turn.resolved_utterance = priorFrame.resolved_utterance ?? null;
    turn.item_referent = priorItem ? { id: priorItem.id, label: priorItem.label } : null;
    // The reply itself is the authority on whether a clarification was asked: its recorded basis when
    // the receipt exists, the re-derived frame otherwise (older saves).
    const recordedBases = turn.responses.map((r) => r.basis).filter(Boolean);
    turn.awaiting_clarification = committedCount > 0 && (recordedBases.length ? recordedBases.some((b) => b.kind === "clarification") : Boolean(priorFrame.unresolved_reference));
    if (turn.item_referent) itemSoFar = turn.item_referent;
    openQuestion = turn.awaiting_clarification && QUESTION_FUNCTIONS_RESUMABLE.has(turn.discourse_function)
      ? { discourse_function: turn.discourse_function, player_text: priorFrame.resolved_utterance ?? turn.player_text, interaction_id: turn.interaction_id, responder_ids: [...turn.responder_ids] }
      : null;
  }

  const last = turns[turns.length - 1] ?? null;
  const previous = turns[turns.length - 2] ?? null;
  // Topic stack: distinct conversational topics in order, each with its latest question (derived from
  // history, never stored and never chosen by the model). A topic is the resolved item, the procedure,
  // the speakers' own states, or the detected subject.
  const topicKeyOf = (turn) => (turn.item_referent ? `item:${turn.item_referent.id}` : turn.discourse_function === "ask_next_step" ? "procedure" : turn.discourse_function === "check_in" ? "self_state" : turn.topic ?? null);
  const topicStack = [];
  for (const turn of turns) {
    if (turn.kind !== "player_exchange" || ["clarify_previous", "request_repetition", "ask_explanation", "ask_heard_confirmation", "acknowledge", "close_topic"].includes(turn.discourse_function)) continue;
    const key = topicKeyOf(turn);
    if (!key || key === "unknown") continue;
    const existing = topicStack.findIndex((entry) => entry.topic === key);
    if (existing >= 0) topicStack.splice(existing, 1);
    topicStack.push({ topic: key, question: turn.resolved_utterance ?? turn.player_text, interaction_id: turn.interaction_id, closed: turn.discourse_function === "close_topic" });
  }
  // Open question: the immediately preceding player question was answered with a clarification
  // request, so a short follow-up naming the thing resumes THAT question (question -> clarification
  // -> answer). Derived from persisted history only; nothing is stored.
  const pending = openQuestion;
  const lastItem = itemSoFar;
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
    last_response_texts: (last?.responses ?? []).map((r) => r.text),
    pending_question: pending,
    topic_stack: topicStack,
    current_topic_key: topicStack.at(-1)?.topic ?? null,
    // The player's immediately preceding question when it was ANSWERED (not clarified): the target of an
    // explicit self-repair ("I mean for the day").
    last_question: last && last.kind === "player_exchange" && !last.awaiting_clarification && (last.responses ?? []).length && QUESTION_FUNCTIONS_RESUMABLE.has(last.discourse_function)
      ? { discourse_function: last.discourse_function, player_text: last.resolved_utterance ?? last.player_text, interaction_id: last.interaction_id, responder_ids: [...last.responder_ids] }
      : null,
    last_item_referent: lastItem
  });
}

// Questions a clarification exchange can be resumed into once the missing referent is named.
const QUESTION_FUNCTIONS_RESUMABLE = new Set(["ask_item_ownership", "make_request", "ask_factual", "ambiguous_reference", "ask_next_step", "ask_personal_experience", "ask_explanation", "check_in"]);

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
  if (discourse_function === "ask_explanation") {
    // "Why?" asks about the immediately preceding heard replies -- never an older topic.
    if (!last || !(last.responses ?? []).length) return { type: "none", resolved: false, reason: "no_preceding_reply" };
    return { ...resolveFromTurn(discourse_function, last), type: "prior_response" };
  }
  const item = referents.find((r) => r.type === "equipment");
  if (item) return { type: "equipment_entity", resolved: item.resolved !== false, entity_id: item.id ?? null };
  return { type: "none", resolved: true };
}

// ─── 3b. Temporal / event reference ─────────────────────────────────────────
// Canonical anchors a caller may supply ({ key: { interval } }), recognized by the interpretation
// module's anchor phrasings. An expression whose anchor is not canonical stays UNRESOLVED: code never
// picks "which time you meant".
const TEMPORAL_ANCHOR_KEYWORDS = LP.temporal_anchors;
/**
 * Deterministic resolution of a temporal expression to an interval window over canonical history.
 * `anchors`: { key: { interval } } from canonical event records; `now`: current interval.
 * Returns null when the text has no temporal expression.
 */
function resolveTemporalReference({ text, anchors = null, now = null, discourse = null } = {}) {
  const match = String(text ?? "").match(LP.temporal_reference);
  if (!match) return null;
  const expression = match[0].trim();
  const current = Number.isFinite(Number(now)) && now !== null ? Number(now) : null;
  const done = (value) => Object.freeze({ expression, ...value });
  if (/^(?:just now|a (?:minute|moment|second|while) ago)/i.test(expression)) {
    const last = discourse?.last_turn?.interval ?? current;
    return done({ kind: "recent", resolved: true, anchor: "last_exchange", window: Object.freeze({ from: last, to: current }) });
  }
  if (/^(?:earlier|this morning)/i.test(expression)) return done({ kind: "operation_so_far", resolved: true, anchor: "operation_start", window: Object.freeze({ from: 0, to: current }) });
  if (/^(?:today|for the day)/i.test(expression)) return done({ kind: "operation_day", resolved: true, anchor: "operation_start", window: Object.freeze({ from: 0, to: current }) });
  // "When you said that": the preceding heard exchange is the canonical anchor.
  if (/^when (?:you|he|she|they) said/i.test(expression)) {
    const at = discourse?.last_turn?.interval ?? null;
    return at != null ? done({ kind: "utterance", resolved: true, anchor: "prior_utterance", window: Object.freeze({ from: at, to: at }) }) : done({ kind: "utterance", resolved: false, anchor: "prior_utterance", reason: "no_prior_utterance", window: null });
  }
  // A future event ("when we get back") is not in canonical history: never guessed.
  if (/^(?:when|after|until|once) we (?:get|come|go|head)\b/i.test(expression)) return done({ kind: "future", resolved: false, anchor: null, reason: "future_event_not_canonical", window: null });
  if (/^(?:last time|yesterday)/i.test(expression)) return done({ kind: "prior_operation", resolved: false, anchor: null, reason: "no_cross_operation_anchor", window: null });
  const relation = expression.match(/^(before|after|when|while|since|until)\b/i)?.[1]?.toLowerCase() ?? null;
  for (const [key, pattern] of Object.entries(TEMPORAL_ANCHOR_KEYWORDS)) {
    if (!pattern.test(expression)) continue;
    const at = Number(anchors?.[key]?.interval);
    if (anchors?.[key] && Number.isFinite(at)) {
      const window = relation === "before" ? { from: 0, to: at } : (relation === "after" || relation === "since") ? { from: at, to: current } : { from: at, to: at };
      return done({ kind: "anchored", relation, anchor: key, resolved: true, window: Object.freeze(window) });
    }
    return done({ kind: "anchored", relation, anchor: key, resolved: false, reason: "anchor_not_canonical", window: null });
  }
  return done({ kind: "anchored", relation, anchor: null, resolved: false, reason: "anchor_unrecognized", window: null });
}

// ─── 3c. Spatial selection (the future spatial runtime's reference event) ─────
const GENERIC_DEICTIC_NOUNS = new Set(["thing", "one", "shape", "figure"]);
/**
 * A deterministic selection supplied by the caller -- a player-selected target today, a
 * spatial_reference_selected event from the spatial runtime later -- resolves "that <noun>" only when
 * it is well-formed and compatible with the noun. Renderer state is never a selection.
 */
function resolveSpatialSelection(selection, noun = null) {
  if (!selection || typeof selection !== "object") return null;
  const { entity_id: entityId, kind, label } = selection;
  if (typeof entityId !== "string" || !entityId || typeof kind !== "string" || !kind || typeof label !== "string" || !label.trim()) return null;
  if (noun && !GENERIC_DEICTIC_NOUNS.has(noun)) {
    const stem = noun.replace(/s$/, "").replace(/way$/, "");
    if (!kind.toLowerCase().includes(stem) && !label.toLowerCase().includes(stem)) return null;
  }
  return Object.freeze({ entity_id: entityId, kind, label: label.trim() });
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
function buildSemanticFrame({ text, recipient_type = "none", interpretation = null, discourse = null, equipment = {}, scope_inherited = false, spatial_selection = null, temporal_anchors = null, now = null, people = [] } = {}) {
  // Leading discourse markers ("Anyway, ...") carry no content; an explicit topic return ("Back to X, ...")
  // is recorded, and classification sees the rest of the utterance.
  let raw = String(text ?? "").trim();
  let topicReturn = false;
  for (let guard = 0; guard < 3; guard += 1) {
    const before = raw;
    raw = raw.replace(LP.discourse_marker, "");
    if (LP.topic_return.test(raw)) { raw = raw.replace(LP.topic_return, ""); topicReturn = true; }
    if (raw === before) break;
  }
  raw = raw.replace(/^[,\s]+/, "") || String(text ?? "").trim();
  // "Back to what we were talking about": the most recent earlier topic's question is asked again.
  if (topicReturn && LP.topic_return_generic.test(raw)) {
    const earlier = [...(discourse?.topic_stack ?? [])].reverse().find((entry) => entry.topic !== discourse?.current_topic_key && entry.question) ?? null;
    if (earlier) {
      const reframed = buildSemanticFrame({ text: earlier.question, recipient_type, discourse: { ...(discourse ?? {}), pending_question: null, last_question: null }, equipment, scope_inherited, spatial_selection, temporal_anchors, now, people });
      return Object.freeze({ ...reframed, topic_return: { topic: earlier.topic, question: earlier.question }, resolved_utterance: earlier.question });
    }
  }
  const interp = interpretation?.version ? interpretation : interpretUtterance(raw, { isGroup: recipient_type === "group" });
  const referents = [];
  let fn = null;
  let unresolved = false;
  let background = false;
  const isQuestion = LP.question_like.test(raw);

  const ownership = LP.item_ownership.test(raw) && LP.item_noun.test(raw);
  // A question about the listener's OWN current feeling: answered from canonical self-state.
  const selfQuery = selfStateQuery(raw);

  if (LP.explanation_request.test(raw) || LP.bare_wh_followup.test(raw)) fn = "ask_explanation";
  else if (LP.bare_reaction.test(raw)) fn = "clarify_previous";
  else if (LP.repetition_request.test(raw)) fn = "request_repetition";
  else if (LP.heard_confirmation.test(raw)) fn = "ask_heard_confirmation";
  else if (LP.opinion_question.test(raw)) fn = "ask_opinion";
  else if (LP.personal_experience.test(raw) && !ownership && !LP.past_perception.test(raw)) fn = "ask_personal_experience";
  else if (LP.next_step.test(raw)) fn = "ask_next_step";
  else if (selfQuery && !ownership) fn = "check_in";
  else if (LP.ambiguous_reference.test(raw)) { fn = "ambiguous_reference"; unresolved = true; }
  else if (ownership) fn = "ask_item_ownership";
  else if (LP.invite_self_description.test(raw)) fn = "invite_self_description";
  else if (LP.background.test(raw)) { fn = "ask_personal_experience"; background = true; }
  else if (LP.role_or_assignment.test(raw)) fn = "ask_role_or_assignment";
  else if (LP.close_topic.test(raw)) fn = "close_topic";
  else if (LP.challenge.test(raw)) fn = "challenge";
  else if (LP.check_in.test(raw)) fn = "check_in";
  else if (LP.handoff_request.test(raw) && LP.request_cue.test(raw)) fn = "make_request";
  else if (!isQuestion && interp.speech_act !== "warning" && LP.order_imperative.test(raw)) fn = "make_request";
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

  // A question about an item's whereabouts/holder ("Is the camera here?", "Have you seen the radio?")
  // is an ownership question once the item resolves, whatever its surface form.
  const custodyQuestion = isQuestion && LP.custody_predicate.test(raw) && LP.item_noun.test(raw) && ["ask_factual", "ask_personal_experience"].includes(fn);
  // The single canonical item resolution for this utterance.
  const item = resolveEquipmentReferent(raw, equipment, { loose: fn === "ask_item_ownership" || fn === "make_request" || custodyQuestion || LP.handoff_request.test(raw) });
  if (item.status === "unique") {
    referents.push({ type: "equipment", id: item.item.id, label: item.item.label ?? item.item.id, holder: item.item.holder ?? null, resolved: true });
    if (custodyQuestion) fn = "ask_item_ownership";
  } else if (item.status === "ambiguous") {
    referents.push({ type: "equipment", id: null, label: null, holder: null, resolved: false, reason: "multiple_matches" });
    unresolved = true;
  } else if (fn === "ask_item_ownership") {
    referents.push({ type: "equipment", id: null, label: null, holder: null, resolved: false, reason: "no_canonical_match" });
    unresolved = true;
  }

  // ── Anaphora: "Who has it?" / "Is it here?" points back to the last resolved item of THIS
  // conversation (canonical antecedent), never to a guess. No antecedent -> clarification.
  let resumed = null;
  if (!referents.length && isQuestion && LP.item_anaphor.test(raw) && !["clarify_previous", "request_repetition", "ask_heard_confirmation", "ask_explanation", "ask_next_step", "check_in"].includes(fn)) {
    const ante = discourse?.last_item_referent ?? null;
    const item2 = ante ? Object.values(equipment ?? {}).find((entry) => entry && (entry.id === ante.id)) ?? null : null;
    if (item2) {
      referents.push({ type: "equipment", id: item2.id, label: item2.label ?? item2.id, holder: item2.holder ?? null, resolved: true, source: "antecedent" });
      if (["ask_factual", "ask_personal_experience", "ambiguous_reference"].includes(fn)) { fn = "ask_item_ownership"; unresolved = false; }
    } else {
      referents.push({ type: "equipment", id: null, label: null, holder: null, resolved: false, reason: "no_antecedent" });
      fn = "ambiguous_reference"; unresolved = true;
    }
  }

  // ── Open question resumed: the previous question drew a clarification request and this short
  // follow-up names the missing item ("Who has the thing?" -> "Which thing?" -> "The camera.").
  const pending = discourse?.pending_question ?? null;
  if (pending && !isQuestion && raw.split(/\s+/).length <= 6 && ["make_statement", "acknowledge", "make_request", "ambiguous_reference"].includes(fn)) {
    const named = resolveEquipmentReferent(raw, equipment, { loose: true });
    // The open question keeps its own function; an unspecific one ("You know the thing by the thing?")
    // becomes a question about the now-named item, whose canonical fact is its custody.
    const underlying = pending.discourse_function === "ambiguous_reference"
      ? (LP.handoff_request.test(pending.player_text ?? "") && !LP.item_ownership.test(pending.player_text ?? "") ? "make_request" : "ask_item_ownership")
      : pending.discourse_function;
    if (named.status === "unique" && underlying) {
      referents.length = 0;
      referents.push({ type: "equipment", id: named.item.id, label: named.item.label ?? named.item.id, holder: named.item.holder ?? null, resolved: true, source: "clarification_answer" });
      fn = underlying; unresolved = false;
      resumed = { player_text: pending.player_text, interaction_id: pending.interaction_id, responder_ids: [...(pending.responder_ids ?? [])] };
    }
  }

  // ── Repair of an open clarification in general ("What's next?" -> "What do you mean?" -> "I mean for
  // the day"; "Is that door open?" -> "Which door?" -> "No, the other one."). The fragment NARROWS the
  // open question: the question is re-framed with the fragment added, by the same rules as any turn. If
  // it still does not resolve, the result is another clarification -- never a guess, never a fresh
  // disconnected statement.
  // The same holds for an explicit self-repair of the player's own just-ANSWERED question ("What's next?"
  // -> answer -> "I mean for the day"): the question is re-asked, narrowed.
  const repairTarget = pending ?? (LP.self_repair_lead.test(raw) ? discourse?.last_question ?? null : null);
  if (repairTarget && !resumed && repairTarget.player_text && LP.repair_fragment.test(raw) && ["make_statement", "acknowledge", "ambiguous_reference", "make_request", "express_uncertainty", "social_observation"].includes(fn)) {
    const core = raw.replace(LP.repair_lead, "").replace(/[.!?\s]+$/, "").trim();
    const combined = `${String(repairTarget.player_text).replace(/[?.!\s]+$/, "")} ${core}?`;
    const reframed = buildSemanticFrame({ text: combined, recipient_type, discourse: { ...(discourse ?? {}), pending_question: null, last_question: null }, equipment, scope_inherited, spatial_selection, temporal_anchors, now });
    if (!["make_statement", "acknowledge"].includes(reframed.discourse_function)) {
      return Object.freeze({ ...reframed, resolved_utterance: combined, resumed_question: { player_text: repairTarget.player_text, interaction_id: repairTarget.interaction_id, responder_ids: [...(repairTarget.responder_ids ?? [])] } });
    }
  }

  // ── Spatial deixis: "that door" / "What's this?" is resolved only by a deterministic selection
  // (player-selected target / future spatial runtime event); otherwise it stays unresolved and the
  // turn becomes a clarification. Prose intuition never resolves it.
  const deictic = raw.match(LP.deictic_object);
  if ((deictic || LP.bare_demonstrative.test(raw)) && !referents.some((ref) => ref.resolved) && !["clarify_previous", "request_repetition", "ask_heard_confirmation", "close_topic", "greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "warn", "ask_explanation", "ask_next_step", "check_in"].includes(fn)) {
    const noun = deictic ? deictic[1].toLowerCase() : null;
    const selection = resolveSpatialSelection(spatial_selection, noun);
    if (selection) referents.push({ type: "spatial", id: selection.entity_id, label: selection.label, kind: selection.kind, resolved: true, source: "spatial_selection" });
    else {
      referents.push({ type: "spatial", id: null, label: null, noun, resolved: false, reason: "deictic_unresolved" });
      if (isQuestion || fn === "make_request") { fn = "ambiguous_reference"; unresolved = true; }
    }
  }

  // ── Temporal / event reference ("earlier", "before we crossed"): resolved deterministically
  // against canonical anchors, or left unresolved (the plan then claims nothing about that time).
  const temporal = LP.temporal_reference.test(raw) ? resolveTemporalReference({ text: raw, anchors: temporal_anchors, now, discourse }) : null;

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
    // A yes/no question about the addressee's own momentary READINESS ("Are you ready?", "All set?").
    // Past perception, presence, plans and feelings are never momentary state: a "yes" to them
    // would assert an observation, commitment or affect nothing canonical supports.
    addressee_state: (question_form_yes_no(raw) && /\byou(?:'re| are)?\b/i.test(raw) || /^(?:all set|ready|good to go)\b/i.test(raw)) && LP.addressee_readiness.test(raw) && !LP.not_momentary_state.test(raw),
    // The speaker's own past perception is asked about ("Did you see anything?").
    past_perception: LP.past_perception.test(raw),
    // A remark about the addressee's own look/manner ("You look nervous.").
    about_addressee: fn === "social_observation" && LP.about_addressee.test(raw),
    // What a request asks for: an item handoff, an action (order), or something general. Code decides
    // what that request means in conversation (see planResponses); wording never accepts it.
    request_kind: fn === "make_request" ? ((LP.handoff_request.test(raw) || LP.take_grab.test(raw)) && referents.some((ref) => ref.type === "equipment") ? "handoff" : (LP.order_imperative.test(raw) ? "order" : "general")) : null,
    temporal_reference: temporal,
    resumed_question: resumed,
    // A request for someone to DO something: the structured intent a future action authority consumes.
    // Conversation never performs it (see planResponses).
    requested_action: fn === "make_request" ? requestedAction(raw, referents, people) : null,
    // Information only an institution/instruction supplies (a schedule, a time): not knowing it is "not told".
    asks_institutional_info: LP.institutional_info.test(raw),
    // "Back to the camera, ...": an explicit return to an earlier topic.
    topic_return: topicReturn ? { topic: null, question: null } : null,
    // "Where?" / "When?": which aspect of the previous line was asked about.
    explanation_aspect: fn === "ask_explanation" && LP.bare_wh_followup.test(raw) ? raw.replace(/[\s?!.]+$/, "").toLowerCase() : null,
    // "Are you excited?": which feeling was asked about; the answer comes from canonical self-state.
    self_state_query: fn === "check_in" ? selfQuery : null,
    // "What's next (for the day)?": the span of procedure asked about, when stated.
    procedure_scope: fn === "ask_next_step" ? (/\b(?:for (?:the day|today)|today|this morning)\b/i.test(raw) ? "day" : "current") : null,
    // The utterance actually framed (a repair fragment combined with the question it narrows).
    resolved_utterance: null,
    tone: interp.tone,
    confidence: interp.confidence,
    unresolved_reference: unresolved
  };

  frame.antecedent = resolveAntecedent({ discourse_function: fn, discourse, referents });
  if (!frame.antecedent.resolved && (fn === "clarify_previous" || fn === "request_repetition" || fn === "ask_heard_confirmation" || fn === "ask_explanation")) {
    // Nothing to clarify or repeat: never guess. Degrade to a clarification request.
    frame.unresolved_reference = true;
    frame.expected_response_shape = EXPECTED_SHAPES.ambiguous_reference;
  }
  return Object.freeze(frame);
}

/**
 * The structured intent of a request ("Give Roy the camera", "Wait here"). Code resolves the object and
 * the named person against canonical equipment and personnel; nothing is executed here.
 */
const ACTION_VERBS = Object.freeze([
  ["transfer_item", /\b(?:give|hand|pass|bring|take|grab|toss)\b/i],
  ["hold_position", /\b(?:wait|stay|hold (?:on|up|here)|stop)\b/i],
  ["follow", /\b(?:come with|follow|come here|come on)\b/i],
  ["move", /\b(?:go|head|move|walk|run|get over)\b/i],
  ["inspect", /\b(?:check|look at|inspect|examine)\b/i],
  ["report", /\b(?:tell|report|radio|call)\b/i]
]);
function requestedAction(raw, referents = [], people = []) {
  const action = ACTION_VERBS.find(([, pattern]) => pattern.test(raw))?.[0] ?? "general";
  const item = referents.find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
  const named = (people ?? []).filter((person) => person?.id && person?.name && new RegExp(`\\b${String(person.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(raw));
  // "Give Roy the camera": Roy is the RECIPIENT; the actor is whoever is asked (the addressee).
  const recipient = /\b(?:me|myself)\b/i.test(raw) ? { id: "player", name: "you" } : (action === "transfer_item" && named[0] ? { id: named[0].id, name: named[0].name } : null);
  return Object.freeze({
    action,
    object: item ? { id: item.id, label: item.label } : null,
    recipient,
    actor_id: item?.holder && action === "transfer_item" ? item.holder : null,
    status: "not_executed",
    reason: "no_action_authority"
  });
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

function buildSelfKnowledge({ person = null, member = null, task = null, held_equipment = [], relationships = [], known_facts = [], known_answer = null, names = {}, equipment = {}, player_id = null, custody_known = {}, self_state = null, procedure = null } = {}) {
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
    // Canonical self-state (from the emotional-state authority): what a check-in answer may say.
    self_state: self_state ? { state: self_state.state, affect: [...(self_state.affect ?? [])] } : null,
    // The current procedure THIS speaker knows (from canonical phase/briefing authority), or null.
    procedure: procedure ? { current_step: procedure.current_step ?? null, next_step: procedure.next_step ?? null, source: procedure.source ?? null } : null,
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
  ask_heard_confirmation: "confirm plainly that you heard what they just said; you may briefly acknowledge what they said but add no interpretation, urgency, motive or action, and do not ask whether anyone heard you",
  ask_next_step: "state the current next step exactly as supplied; if none is supplied, ask what they mean; do not invent a plan",
  ask_explanation: "explain your previous line using only the supplied basis; do not invent a reason, experience, danger or plan",
  ask_opinion: "give your own view only as supplied; with no view supplied, say you have no particular opinion yet, without inventing one"
});

/**
 * The answer a canonical self-state gives to a question about one feeling. Canonical affect is the only
 * authority: an ordinary state holds no elevated feeling (so "excited?" / "nervous?" is "not especially"),
 * and a moved state answers with what actually moved.
 */
function selfStateAnswer(query, selfState) {
  if (!query || !selfState) return null;
  const keys = (selfState.affect ?? []).map((a) => (/tired/i.test(a) ? "tired" : /tense|stress/i.test(a) ? "tense" : /pressed|time/i.test(a) ? "pressed" : null)).filter(Boolean);
  const affected = selfState.state === "affected" && keys.length > 0;
  let answer;
  if (query.asked === "wellbeing") answer = affected ? "affected" : "fine";
  else if (query.asked === "tense" || query.asked === "tired") answer = keys.includes(query.asked) ? "yes" : (affected ? "affected_instead" : "not_especially");
  else answer = affected ? "affected_instead" : "not_especially"; // positive affect is never canonically established
  return Object.freeze({ asked: query.asked, polarity: query.polarity, answer, affect: affected ? keys : [] });
}

/**
 * WHY a committed line was authorized, derived from the plan it was worded from (persisted in the turn's
 * receipt). This is the only thing an explanation request may explain; wording is never the basis.
 */
/**
 * Which KIND of not-knowing a no-fact answer is (deterministic, from the frame): a person who did not
 * perceive something, was not told, has no established history or opinion, or faces an unclear
 * referent says so differently. The model words the kind; it never picks it.
 */
function uncertaintyKind(frame, fn) {
  if (frame?.unresolved_reference) return "referent_unclear";
  if (frame?.temporal_reference && !frame.temporal_reference.resolved) return "time_unclear";
  if (frame?.past_perception) return "did_not_perceive";
  if (fn === "ask_personal_experience") return frame?.requested_content === "background" ? "background_not_shared" : "no_established_personal_history";
  if (fn === "ask_opinion") return "no_established_opinion";
  if (fn === "ask_next_step") return "procedure_not_known";
  if (frame?.asks_institutional_info) return "not_told";
  return "no_established_fact";
}

function responseBasisFromPlan(plan, frame = null) {
  if (!plan) return null;
  const fn = plan.discourse_function;
  const facts = plan.required_facts ?? [];
  const value = (key) => facts.find((f) => f.key === key)?.value ?? null;
  if (value("explanation_basis")) return value("explanation_basis");
  if (fn === "check_in" || value("self_state")) {
    const self = value("self_state");
    if (self) return { kind: "self_state", state: self.state, affect: [...(self.affect ?? [])], answer: value("self_state_answer")?.answer ?? null };
  }
  if (value("current_procedure")) return { kind: "briefing_instruction", ...value("current_procedure") };
  if (value("item_holder")) return { kind: "custody", ...value("item_holder"), equipment_id: (frame?.referents ?? []).find((ref) => ref.type === "equipment" && ref.resolved)?.id ?? null };
  if (value("known_answer") || facts.some((f) => f.key === "known_fact")) return { kind: "known_information", facts: facts.filter((f) => f.key === "known_fact").map((f) => f.value?.text).filter(Boolean).slice(0, 2), known_answer: value("known_answer") };
  if (value("heard_confirmation")) return { kind: "heard", heard: value("heard_confirmation").heard !== false };
  if (value("antecedent_responses")) return { kind: "restatement" };
  if (value("request_disposition")) return { kind: "request_policy", disposition: value("request_disposition").disposition, requested_action: value("request_disposition").requested_action ?? null };
  if (value("name") || value("role") || value("current_assignment")) return { kind: "assignment", role: value("role"), assignment: value("current_assignment") };
  if (plan.may_ask_clarifying_question) return { kind: "clarification" };
  if (["ask_factual", "ask_personal_experience", "challenge", "ask_next_step", "ask_opinion"].includes(fn)) return { kind: "no_known_fact", past_perception: Boolean(frame?.past_perception), uncertainty: value("uncertainty")?.kind ?? uncertaintyKind(frame, fn) };
  return { kind: "social", discourse_function: fn };
}

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
      // Fail closed: custody is known only through self-custody or an explicit observer-authority grant.
      const known = ref.holder === responder_id || self?.custody_known?.[ref.id] === true;
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
      for (const ref of frame.referents ?? []) if (ref.resolved && ref.type === "equipment") required.push({ key: "item_holder", value: holderFact(ref) });
      // What the request MEANS is decided here, never by wording. LOCAL conversation performs no
      // handoff or order: a handoff needs the structured transfer, an order the structured order
      // authority. Until one of those resolves it, the reply acknowledges without committing.
      const kind = frame.request_kind ?? "general";
      const action = frame.requested_action ? { action: frame.requested_action.action, object: frame.requested_action.object?.label ?? null, recipient: frame.requested_action.recipient ? (names[frame.requested_action.recipient.id] ?? frame.requested_action.recipient.name) : null, status: "not_executed" } : null;
      required.push({ key: "request_disposition", value: { kind, disposition: kind === "handoff" ? "requires_structured_handoff" : "heard_no_commitment", order_routing: "not_routed", ...(action ? { requested_action: action } : {}) } });
      forbidden.push("acceptance_or_commitment");
    }
    // A check-in, or a remark about the speaker's own look, is answered from canonical self-state only.
    if ((fn === "check_in" || (fn === "social_observation" && frame.about_addressee)) && self?.self_state) required.push({ key: "self_state", value: self.self_state });
    // A question about ONE feeling ("Excited?", "Nervous?") gets the stance that canonical state gives.
    if (fn === "check_in" && frame.self_state_query && self?.self_state) required.push({ key: "self_state_answer", value: selfStateAnswer(frame.self_state_query, self.self_state) });
    if (fn === "ask_next_step") {
      // Only a procedure this speaker canonically knows answers "what's next"; otherwise it is asked about.
      if (self?.procedure?.next_step) required.push({ key: "current_procedure", value: { ...self.procedure, scope: frame.procedure_scope ?? "current" } });
    }
    // No fact answers an answerable question: which KIND of not-knowing it is (the model words that kind).
    if (["ask_factual", "ask_personal_experience", "challenge", "ask_opinion"].includes(fn) && !required.length && !(frame.addressee_state)) required.push({ key: "uncertainty", value: { kind: uncertaintyKind(frame, fn) } });
    if (fn === "ask_explanation") {
      const ante = frame.antecedent ?? {};
      const own = ante.resolved ? repairTargets(ante.responses ?? [], responder_id).find((r) => r.speaker_id === responder_id) ?? null : null;
      if (own) required.push({ key: "explanation_basis", value: own.basis ?? { kind: "unavailable" } });
      else if (ante.resolved) required.push({ key: "explanation_basis", value: { kind: "not_own_line", speaker_name: repairTargets(ante.responses ?? [], responder_id)[0]?.speaker_name ?? null } });
      forbidden.push("invented_rationale");
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
      // An unresolved time ("before Maxwell left") is asked about only when no authorized fact answers
      // the question anyway (a known answer already fixes which event is meant).
      // (The uncertainty descriptor states which kind of not-knowing applies; it is not an answering fact.)
      may_ask_clarifying_question: fn === "ambiguous_reference" || Boolean(frame?.unresolved_reference) || (Boolean(frame?.temporal_reference) && !frame.temporal_reference.resolved && ["ask_factual", "ask_personal_experience"].includes(fn) && required.every((f) => f.key === "uncertainty")) || (fn === "ask_next_step" && required.length === 0),
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
    referents: (frame?.referents ?? []).map((ref) => ({ type: ref.type, label: ref.label ?? null, resolved: Boolean(ref.resolved), ...(ref.reason ? { reason: ref.reason } : {}), ...(ref.noun ? { noun: ref.noun } : {}) })),
    past_perception: Boolean(frame?.past_perception),
    about_addressee: Boolean(frame?.about_addressee),
    temporal_reference: frame?.temporal_reference ? { expression: frame.temporal_reference.expression, resolved: Boolean(frame.temporal_reference.resolved) } : null,
    // The question a clarification answer resumes ("Who has the thing?"), so the reply answers IT.
    resumed_question: frame?.resumed_question?.player_text ?? null,
    self_state_query: frame?.self_state_query ? { asked: frame.self_state_query.asked, polarity: frame.self_state_query.polarity } : null,
    procedure_scope: frame?.procedure_scope ?? null,
    antecedent: !["clarify_previous", "request_repetition", "ask_explanation"].includes(plan.discourse_function)
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
function formatDiscourseTrace({ raw_utterance, utterance = null, recipient_scope, frame, discourse_summary, owner_ids = [], plans = [], grounded_facts = [], provider_result = null, fallback_used = null, committed_event_ids = null, request_id = null, listener_ids = null } = {}) {
  return JSON.stringify({
    request_id: request_id ?? undefined,
    utterance: raw_utterance,
    residual: utterance && utterance !== raw_utterance ? utterance : undefined,
    scope: recipient_scope,
    frame: frame ? { fn: frame.discourse_function, speech_act: frame.speech_act, topic: frame.topic, shape: frame.expected_response_shape, requested: frame.requested_content, unresolved: frame.unresolved_reference, inherited: frame.scope_inherited, conf: frame.confidence } : null,
    listeners: listener_ids ?? undefined,
    antecedent: frame?.antecedent ? { type: frame.antecedent.type, resolved: frame.antecedent.resolved, basis: (frame.antecedent.responses ?? []).map((r) => r.basis?.kind ?? null).filter(Boolean) } : null,
    resolved_utterance: frame?.resolved_utterance ?? undefined,
    resumed: frame?.resumed_question ? true : undefined,
    self_state_query: frame?.self_state_query ?? undefined,
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
  resolveTemporalReference,
  resolveSpatialSelection,
  TEMPORAL_ANCHOR_KEYWORDS,
  buildSemanticFrame,
  summarizeDiscourse,
  buildSelfKnowledge,
  selfStateAnswer,
  responseBasisFromPlan,
  presentAssignment,
  planResponses,
  selectKnownFacts,
  toKnownAnswerFact,
  toAuthorizedContribution,
  formatDiscourseTrace
};
