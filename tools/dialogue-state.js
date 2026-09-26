"use strict";

// DIALOGUE INFORMATION STATE (ED-30 C2, F1, F5, G2, C6).
//
// Durable, per-run conversational state that history alone cannot reconstruct cheaply or unambiguously:
//
//   requests      the Questions-Under-Discussion ledger: every player question/request, its target set,
//                 response cardinality, per-target answer slots and satisfaction state (F1)
//   repairs       repair relations (append-only): what was repaired, of which request/event, and how (F6/F7)
//   activities    structured conversational activities: SELF_INTRODUCTION_ROUND, GROUP_CHECK_IN, ... (F5)
//   acquaintance  deterministic completion state of the briefing's "get acquainted" step (G2)
//   learning      "actor X learned proposition P from source S at time T" events (C6 learning hook)
//
// Persistence class: all components live on run.expedition.dialogue_state and are saved with the session
// (they survive a full app close). The active speaker and addressee are DERIVED from dialogue_history on
// demand (session-class: recomputed identically after reload). Nothing here is ever rewritten: states move
// forward by appended transitions; stored player lines and NPC events are never touched (L5).
//
// Satisfaction is written only AFTER a line was delivered and its validator accepted it for that slot
// (L6: speech is not satisfaction). Nothing in this module consults a model.

const STATE_VERSION = "yellow-beast-dialogue-state@v1";
const REQUEST_STATES = Object.freeze(["OPEN", "PARTIALLY_SATISFIED", "SATISFIED", "ANSWERED_UNKNOWN", "ANSWERED_NOT_ESTABLISHED", "CLARIFYING", "SUPERSEDED", "ABANDONED"]);
const PENDING = new Set(["OPEN", "PARTIALLY_SATISFIED"]);
const TERMINAL = new Set(["SATISFIED", "ANSWERED_UNKNOWN", "ANSWERED_NOT_ESTABLISHED", "SUPERSEDED", "ABANDONED"]);
const ACTIVITY_KINDS = Object.freeze(["SELF_INTRODUCTION_ROUND", "GROUP_CHECK_IN", "ROLE_ROUND", "EXPERIENCE_ROUND", "EQUIPMENT_DISCUSSION", "MISSION_BRIEFING_FOLLOWUP", "CLARIFICATION"]);
// Deterministic staleness: an unsatisfied request is ABANDONED after this many later player turns that
// neither repair it nor share its predicate. NPC chatter never abandons a request.
const ABANDON_AFTER_TURNS = 4;
// A bounded hook log, not a knowledge store: the proposition itself stays in its source event's plan.
const LEARNING_LIMIT = 64;
const REQUEST_LIMIT = 80;

function stateOf(run) {
  const expedition = run?.expedition;
  if (!expedition) return null;
  expedition.dialogue_state ??= { version: STATE_VERSION, sequence: 0, requests: [], repairs: [], activities: [], acquaintance: { self_referential: {}, introduced: {}, closed_by_player_at: null, complete_at: null }, learning: [] };
  const state = expedition.dialogue_state;
  state.version ??= STATE_VERSION;
  state.sequence ??= 0;
  state.requests ??= [];
  state.repairs ??= [];
  state.activities ??= [];
  state.acquaintance ??= { self_referential: {}, introduced: {}, closed_by_player_at: null, complete_at: null };
  state.learning ??= [];
  return state;
}
const nextId = (state, prefix) => `${prefix}-${String(++state.sequence).padStart(4, "0")}`;
const now = (run) => run?.expedition?.clock?.interval ?? 0;

// Which activity a request template belongs to (by predicate).
const ACTIVITY_OF = Object.freeze({ "person.self_description": "SELF_INTRODUCTION_ROUND", "person.wellbeing": "GROUP_CHECK_IN", "person.nervousness": "GROUP_CHECK_IN", "person.anticipation": "GROUP_CHECK_IN", "person.fatigue": "GROUP_CHECK_IN", "person.role": "ROLE_ROUND", "person.current_assignment": "ROLE_ROUND", "person.first_day_at_async": "EXPERIENCE_ROUND", "person.async_tenure": "EXPERIENCE_ROUND", "person.expedition_experience": "EXPERIENCE_ROUND", "person.complex_experience": "EXPERIENCE_ROUND" });
// Predicates whose delivered answer is "about oneself" (counts toward getting acquainted).
const SELF_REFERENTIAL = new Set(["person.self_description", "person.role", "person.current_assignment", "person.first_day_at_async", "person.async_tenure", "person.expedition_experience", "person.complex_experience", "person.wellbeing", "person.nervousness", "person.anticipation", "person.fatigue", "person.familiarity", "person.opinion"]);

/**
 * Opens a request (one per question/request act). `targets` are the actors expected to answer; with an
 * each_self cardinality every target gets its own slot, otherwise one shared slot.
 */
function openRequest(run, { interaction_id = null, submission_id = null, utterance_event_id = null, act_index = 0, predicate = null, fn = null, request_text = null, targets = [], cardinality = "one_spokesperson", question_form = null, temporal = null, alternatives = null, args = null, relation = "new", repair_of = null, reissue_of = null } = {}) {
  const state = stateOf(run);
  if (!state) return null;
  const perTarget = ["each_self", "each_self_concise", "each_ack"].includes(cardinality) && targets.length > 0;
  const slots = {};
  if (perTarget) for (const id of targets) slots[id] = { state: "OPEN", response_event_id: null, verdict: null };
  else slots.shared = { state: "OPEN", response_event_id: null, verdict: null, eligible: [...targets] };
  const request = {
    request_id: nextId(state, "req"), interaction_id, submission_id, utterance_event_id, act_index,
    predicate, fn, request_text, targets: [...targets], cardinality, question_form, temporal, alternatives: alternatives ? [...alternatives] : null, args: args ? structuredClone(args) : null,
    relation, repair_of, reissue_of, slots, state: "OPEN", created_at: now(run), updated_at: now(run), turns_since: 0, satisfaction_reason: null,
    history: [{ at: now(run), to: "OPEN", reason: relation === "new" ? "opened" : `opened:${relation}` }]
  };
  state.requests.push(request);
  if (state.requests.length > REQUEST_LIMIT) state.requests.splice(0, state.requests.length - REQUEST_LIMIT);
  return request;
}

function transition(run, request, to, reason) {
  if (!request || request.state === to) return request;
  request.history.push({ at: now(run), from: request.state, to, reason });
  request.state = to;
  request.updated_at = now(run);
  return request;
}

/** Re-opens a request's slots (repair / attention on a request that is still unsatisfied or was wrongly satisfied). */
function reopenRequest(run, requestId, { reason = "reopened", targets = null } = {}) {
  const request = findRequest(run, requestId);
  if (!request) return null;
  if (targets && targets.length) {
    const perTarget = ["each_self", "each_self_concise", "each_ack"].includes(request.cardinality);
    request.targets = [...targets];
    request.slots = perTarget ? Object.fromEntries(targets.map((id) => [id, request.slots?.[id]?.state === "SATISFIED" && reason !== "repair_reissue" ? request.slots[id] : { state: "OPEN", response_event_id: null, verdict: null }])) : { shared: { state: "OPEN", response_event_id: null, verdict: null, eligible: [...targets] } };
  } else for (const slot of Object.values(request.slots)) if (slot.state !== "OPEN") { slot.previous = { state: slot.state, response_event_id: slot.response_event_id }; slot.state = "OPEN"; slot.response_event_id = null; slot.verdict = null; }
  request.turns_since = 0;
  return transition(run, request, "OPEN", reason);
}

/**
 * Records the outcome of ONE delivered, validated line for a request slot. `verdict`:
 *   answered | unknown | not_established | clarifying | social
 * A rejected/undelivered/cancelled line never reaches here (the slot stays open).
 */
function recordSatisfaction(run, requestId, { responder_id, response_event_id, verdict, reason = null } = {}) {
  const request = findRequest(run, requestId);
  if (!request) return null;
  const key = request.slots[responder_id] ? responder_id : "shared";
  const slot = request.slots[key];
  if (!slot) return request;
  // L6 (review F4): a social reply ("Heard you.", "Okay.") answers nothing: a request asking a registry facet
  // stays open until a line carrying that answer is delivered. Social requests (greetings etc.) close.
  const asksFacet = request.predicate && !String(request.predicate).startsWith("conversation.");
  if (verdict === "social" && asksFacet) { slot.verdict = "social_not_an_answer"; slot.responder_id = responder_id ?? null; return request; }
  slot.state = verdict === "answered" || verdict === "social" ? "SATISFIED" : verdict === "unknown" ? "ANSWERED_UNKNOWN" : verdict === "not_established" ? "ANSWERED_NOT_ESTABLISHED" : verdict === "clarifying" ? "CLARIFYING" : slot.state;
  slot.response_event_id = response_event_id ?? null;
  slot.responder_id = responder_id ?? null;
  slot.verdict = verdict;
  request.satisfaction_reason = reason ?? request.satisfaction_reason;
  const states = Object.values(request.slots).map((s) => s.state);
  const next = states.every((s) => s === "SATISFIED") ? "SATISFIED"
    : states.some((s) => s === "CLARIFYING") ? "CLARIFYING"
      : states.every((s) => TERMINAL.has(s)) ? (states.includes("ANSWERED_UNKNOWN") ? "ANSWERED_UNKNOWN" : states.includes("ANSWERED_NOT_ESTABLISHED") ? "ANSWERED_NOT_ESTABLISHED" : "SATISFIED")
        : states.some((s) => s !== "OPEN") ? "PARTIALLY_SATISFIED" : "OPEN";
  return transition(run, request, next, reason ?? verdict);
}

function supersede(run, requestId, byRequestId, { repaired = false } = {}) {
  const request = findRequest(run, requestId);
  // A repair shows even a satisfied request answered the wrong question: it is superseded (never deleted).
  if (!request || ["SUPERSEDED", "ABANDONED"].includes(request.state) || (TERMINAL.has(request.state) && !repaired)) return request;
  return transition(run, request, "SUPERSEDED", `superseded_by:${byRequestId}`);
}

/**
 * Called once per committed player turn: ages open requests and abandons stale ones (deterministic rule:
 * ABANDON_AFTER_TURNS later turns that neither repair nor share the predicate).
 */
function ageRequests(run, { current_request_ids = [], current_predicates = [] } = {}) {
  const state = stateOf(run);
  if (!state) return [];
  const abandoned = [];
  for (const request of state.requests) {
    if (current_request_ids.includes(request.request_id) || !PENDING.has(request.state)) continue;
    if (current_predicates.includes(request.predicate)) continue;
    request.turns_since = (request.turns_since ?? 0) + 1;
    if (request.turns_since >= ABANDON_AFTER_TURNS) { transition(run, request, "ABANDONED", "stale"); abandoned.push(request.request_id); }
  }
  return abandoned;
}

function findRequest(run, requestId) { return stateOf(run)?.requests.find((r) => r.request_id === requestId) ?? null; }
function requestsOfInteraction(run, interactionId) { return (stateOf(run)?.requests ?? []).filter((r) => r.interaction_id === interactionId || r.submission_id === interactionId); }
function lastRequest(run, { exclude_states = ["SUPERSEDED"] } = {}) { return [...(stateOf(run)?.requests ?? [])].reverse().find((r) => !exclude_states.includes(r.state)) ?? null; }
function pendingRequests(run) { return (stateOf(run)?.requests ?? []).filter((r) => PENDING.has(r.state)); }

function lastPlayerClaim(run, lastReq) {
  const interactions = run?.expedition?.interaction_history ?? [];
  const latest = [...interactions].reverse().find((i) => i?.turn) ?? null;
  if (!latest || latest.turn.primary?.speech_act !== "statement") return null;
  if (lastReq && lastReq.interaction_id && lastReq.interaction_id === latest.id) return null;
  const predicate = latest.turn.clauses?.flatMap((c) => c.predicate_candidates ?? [])[0] ?? null;
  return predicate ? { predicate, text: latest.turn.primary?.request_text ?? latest.player_text ?? null, interaction_id: latest.id ?? null } : null;
}

function recordRepair(run, { kind, of_request_id = null, of_event_id = null, new_targets = null, facet = null, interaction_id = null, text = null } = {}) {
  const state = stateOf(run);
  if (!state) return null;
  const repair = { repair_id: nextId(state, "rep"), kind, of_request_id, of_event_id, new_targets: new_targets ? [...new_targets] : null, facet, interaction_id, at: now(run), text: text ? String(text).slice(0, 300) : null };
  state.repairs.push(repair);
  return repair;
}

// ─── activities (F5) ──────────────────────────────────────────────────────────────────────────────────
function activeActivity(run) { return [...(stateOf(run)?.activities ?? [])].reverse().find((a) => a.state === "active") ?? null; }
/** Starts or continues the activity a request template belongs to; returns the activity or null. */
function noteActivityRequest(run, { predicate, request_text, fn, targets = [], eligible = [], group = false } = {}) {
  const kind = ACTIVITY_OF[predicate];
  if (!kind) return null;
  const state = stateOf(run);
  let activity = activeActivity(run);
  if (activity && activity.kind !== kind) { activity.state = "superseded"; activity = null; }
  if (!activity) {
    activity = { activity_id: nextId(state, "act"), kind, template: { predicate, request_text, fn }, eligible: [...eligible], completed: [], pending: [...targets], last_target: null, state: "active", started_at: now(run), started_by: group ? "group_request" : "single_request" };
    state.activities.push(activity);
  } else {
    activity.pending = [...new Set([...activity.pending.filter((id) => !activity.completed.includes(id)), ...targets])];
    if (!activity.eligible.length) activity.eligible = [...eligible];
  }
  activity.last_target = targets.at(-1) ?? activity.last_target;
  return activity;
}
function completeActivitySlot(run, predicate, responderId) {
  const activity = activeActivity(run);
  if (!activity || activity.template.predicate !== predicate) return null;
  if (!activity.completed.includes(responderId)) activity.completed.push(responderId);
  activity.pending = activity.pending.filter((id) => id !== responderId);
  if (activity.eligible.length && activity.eligible.every((id) => activity.completed.includes(id))) activity.state = "complete";
  return activity;
}
function closeActivity(run, reason = "player_closed") {
  const activity = activeActivity(run);
  if (activity) { activity.state = "closed"; activity.closed_reason = reason; activity.closed_at = now(run); }
  return activity;
}

// ─── acquaintance (G2) ────────────────────────────────────────────────────────────────────────────────
/**
 * Getting acquainted is complete when every present coworker has told the lead who they are (a delivered
 * self-introduction, role or assignment answer), or when the lead closes it ("Okay, that's that") --
 * the briefing said "report ... when you're ready". Deterministic; the model never decides it.
 * Completion advances the procedure QUERY only.
 */
// Answers that tell the lead WHO someone is (name, role, assignment): what "get acquainted" requires.
const INTRODUCING = new Set(["person.self_description", "person.role", "person.current_assignment"]);
function noteSelfReferentialAnswer(run, { predicate, responder_id, coworker_ids = [] } = {}) {
  if (!SELF_REFERENTIAL.has(predicate)) return null;
  const acquaintance = stateOf(run).acquaintance;
  acquaintance.self_referential[responder_id] ??= now(run);
  if (INTRODUCING.has(predicate)) acquaintance.introduced[responder_id] ??= now(run);
  return evaluateAcquaintance(run, coworker_ids);
}
function noteAcquaintanceClosed(run, coworker_ids = []) {
  const acquaintance = stateOf(run).acquaintance;
  acquaintance.closed_by_player_at ??= now(run);
  return evaluateAcquaintance(run, coworker_ids);
}
function evaluateAcquaintance(run, coworker_ids = []) {
  const acquaintance = stateOf(run).acquaintance;
  if (acquaintance.complete_at != null) return acquaintance;
  const everyone = coworker_ids.length > 0 && coworker_ids.every((id) => acquaintance.introduced[id] != null);
  if (everyone || acquaintance.closed_by_player_at != null) {
    acquaintance.complete_at = now(run);
    acquaintance.completed_by = everyone ? "every_coworker_introduced" : "player_closed";
  }
  return acquaintance;
}
function acquaintanceComplete(run) { return run?.expedition?.dialogue_state?.acquaintance?.complete_at != null; }

// ─── learning hook (C6.4) ─────────────────────────────────────────────────────────────────────────────
/** "actor X learned proposition P from source S at time T" -- emitted at commit for every listener. */
function recordLearning(run, { actor_id, proposition, source_actor_id = null, source_event_id = null, at = null, provenance = "heard" } = {}) {
  const state = stateOf(run);
  if (!state || !actor_id || !proposition) return null;
  // Reference only (which proposition, from which committed line): canonical knowledge derives the content
  // from that line's authorizing plan, so this log never becomes a second knowledge authority.
  const event = { actor_id, proposition: { key: proposition.key ?? null, concept: proposition.concept ?? null, predicate: proposition.predicate ?? null }, source_actor_id, source_event_id, provenance, at: at ?? now(run) };
  state.learning.push(event);
  if (state.learning.length > LEARNING_LIMIT) state.learning.splice(0, state.learning.length - LEARNING_LIMIT);
  return event;
}

// ─── derived: active speaker / addressee (session class) ──────────────────────────────────────────────
/** The last coworker who spoke to the player at this location (from committed dialogue history only). */
function activeSpeaker(run, { player_id, location_id = null, present_ids = null } = {}) {
  const history = run?.expedition?.dialogue_history ?? [];
  const interactions = run?.expedition?.interaction_history ?? [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (event?.kind !== "speech" || String(event.channel ?? "LOCAL").toLowerCase() !== "local") continue;
    if (event.speaker_id === player_id) {
      // The player's own line: the speaker of the replies to it (if exactly one) is the active speaker.
      const replies = history.filter((e) => e.submission_id === event.submission_id && e.speaker_id !== player_id && e.kind === "speech");
      if (!replies.length) continue;
      const speakers = [...new Set(replies.map((e) => e.speaker_id))];
      const interaction = interactions.find((it) => it.submission_id === event.submission_id);
      if (location_id != null && interaction && (interaction.location_id ?? null) !== location_id) return null;
      const present = present_ids ? speakers.filter((id) => present_ids.includes(id)) : speakers;
      return { speaker_id: present.length === 1 ? present[0] : null, speaker_ids: present, submission_id: event.submission_id };
    }
  }
  return null;
}

/** Bounded, observer-safe snapshot for the turn analyzer (ids and request metadata only). */
function snapshot(run, { player_id, location_id = null, present_ids = [] } = {}) {
  const state = stateOf(run);
  const last = lastRequest(run);
  const pending = pendingRequests(run).slice(-4);
  const activity = activeActivity(run);
  const speaker = activeSpeaker(run, { player_id, location_id, present_ids });
  const brief = (r) => (r ? { request_id: r.request_id, predicate: r.predicate, fn: r.fn, request_text: r.request_text, targets: [...r.targets], cardinality: r.cardinality, state: r.state, question_form: r.question_form, temporal: r.temporal, args: r.args ? structuredClone(r.args) : null, interaction_id: r.interaction_id, answered_by: Object.values(r.slots ?? {}).filter((s) => s.responder_id).map((s) => s.responder_id), slots: Object.fromEntries(Object.entries(r.slots ?? {}).map(([k, s]) => [k, s.state])) } : null);
  return Object.freeze({
    version: STATE_VERSION,
    active_speaker: speaker,
    last_request: brief(last),
    // The most recent request about the world or a person (not a meta question such as "Why?"): what
    // "What about Tonya?" carries when the last request was only about the conversation.
    last_substantive_request: brief([...(state?.requests ?? [])].reverse().find((r) => r.state !== "SUPERSEDED" && r.predicate && !String(r.predicate).startsWith("conversation.")) ?? null),
    // The player's own most recent line, when it was a claim carrying a registry predicate ("I heard Tonya
    // has never been in the Complex." -> "Tonya, have you?").
    last_player_claim: lastPlayerClaim(run, last),
    pending_requests: pending.map(brief),
    activity: activity ? { activity_id: activity.activity_id, kind: activity.kind, template: { ...activity.template }, completed: [...activity.completed], pending: [...activity.pending], eligible: [...activity.eligible], last_target: activity.last_target } : null,
    acquaintance_complete: state?.acquaintance?.complete_at != null
  });
}

/** The request (among the last `window`) in which this responder already answered this predicate, or null. */
function recentlyAnswered(run, predicate, responderId, window = 3) {
  if (!predicate || !responderId) return null;
  const recent = (stateOf(run)?.requests ?? []).slice(-window);
  return [...recent].reverse().find((r) => r.predicate === predicate && Object.entries(r.slots ?? {}).some(([key, slot]) => (key === responderId || slot.responder_id === responderId) && slot.state === "SATISFIED")) ?? null;
}

// ─── turn-level ledger operations (called by the production service) ─────────────────────────────────
const NON_REQUEST_FUNCTIONS = new Set(["attend", "acknowledge", "greet", "introduce_self", "joke_or_sarcasm", "social_observation", "close_topic", "warn", "express_uncertainty"]);
const REQUEST_ACTS = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);

/**
 * Opens the request(s) a committed player turn makes, or re-opens the request a repair / attention call /
 * re-ask points at. Returns the request ids (the primary act's first). Deterministic.
 */
function openTurnRequests(run, { analysis = null, frame = null, interaction = null, player_event_id = null, owner_ids = [], present_ids = [], submission_id = null } = {}) {
  if (!analysis || !run?.expedition) return [];
  const registry = require("./dialogue-registry");
  if (analysis.closes_activity) { closeActivity(run, "player_closed"); noteAcquaintanceClosed(run, present_ids); }
  const e = analysis.primary;
  const fn = frame?.discourse_function ?? null;
  const isRequest = e && REQUEST_ACTS.has(e.speech_act) && !NON_REQUEST_FUNCTIONS.has(fn) && !e.repair?.vacuous && !(fn === "make_statement" && !/\?\s*$/.test(e.act?.text ?? ""));
  if (!isRequest) { ageRequests(run, {}); return []; }
  const predicate = frame?.predicate ?? registry.predicateForFrame(frame) ?? null;
  const cardinality = frame?.turn?.cardinality ?? e.cardinality ?? "one_spokesperson";
  const targets = owner_ids.length ? [...owner_ids] : [...(e.addressee?.ids ?? [])];
  const base = { interaction_id: interaction?.id ?? null, submission_id, utterance_event_id: player_event_id, act_index: analysis.effective.indexOf(e), predicate, fn, request_text: e.request_text ?? null, targets, cardinality, question_form: e.question_form ?? null, temporal: e.temporal_scope ?? null, alternatives: e.alternatives ?? null, args: frame?.turn?.args ?? e.args ?? null };
  let request = null;
  const prior = e.reissue_of ? findRequest(run, e.reissue_of) : null;
  if (prior && prior.predicate === predicate && prior.request_text === e.request_text) {
    request = reopenRequest(run, prior.request_id, { reason: e.relation === "attention" ? "attention_reopen" : "repair_reissue", targets });
    request.utterance_event_id = player_event_id;
    request.reissued_by = [...(request.reissued_by ?? []), interaction?.id ?? submission_id];
    recordRepair(run, { kind: e.relation === "attention" ? "attention_to_pending_request" : `${e.repair?.kind ?? "repair"}_repair`, of_request_id: prior.request_id, of_event_id: prior.utterance_event_id ?? null, new_targets: targets, interaction_id: interaction?.id ?? null, text: e.act?.text ?? null });
  } else {
    request = openRequest(run, { ...base, relation: e.relation, repair_of: prior?.request_id ?? null, reissue_of: prior?.request_id ?? null });
    if (prior) { supersede(run, prior.request_id, request.request_id, { repaired: e.relation === "repair" }); recordRepair(run, { kind: `${e.repair?.kind ?? "facet"}_repair`, of_request_id: prior.request_id, of_event_id: prior.utterance_event_id ?? null, new_targets: targets, facet: predicate, interaction_id: interaction?.id ?? null, text: e.act?.text ?? null }); }
  }
  noteActivityRequest(run, { predicate, request_text: e.request_text, fn, targets, eligible: present_ids, group: targets.length > 1 });
  ageRequests(run, { current_request_ids: [request.request_id], current_predicates: [predicate] });
  return [request.request_id];
}

/** What a delivered line did for its slot, from its plan (never from wording). */
function verdictOf(plan) {
  if (!plan) return "social";
  if (plan.may_ask_clarifying_question) return "clarifying";
  const facts = plan.required_facts ?? [];
  const answer = facts.find((f) => f.key === "predicate_answer")?.value ?? null;
  if (answer) return answer.value === "unknown" ? "unknown" : answer.value === "not_established" ? "not_established" : "answered";
  if (NON_REQUEST_FUNCTIONS.has(plan.discourse_function) || plan.discourse_function === "make_statement") return "social";
  if (facts.some((f) => f.key === "uncertainty") && !facts.some((f) => ["known_concept", "current_procedure", "item_holder", "reported_speech"].includes(f.key))) return "unknown";
  return "answered";
}

/**
 * After commit: satisfaction for each DELIVERED line's slot, activity/acquaintance progress, self-state
 * history, and learning events for every listener. Undelivered items change nothing.
 */
function commitTurnLines(run, items = [], { present_ids = [] } = {}) {
  const knowledge = require("./canonical-knowledge");
  const personhood = require("./dialogue-personhood");
  const results = [];
  for (const item of items) {
    if (!item?.delivered || !item.speaker_id) continue;
    // A compound line satisfies each of its parts' requests separately, by each part's own plan.
    const parts = item.plan?.discourse_function === "compound" ? item.plan.parts.map((part, i) => ({ plan: part.plan, frame: part.frame, request_id: item.request_ids?.[i] ?? (i === 0 ? item.request_id : null) })) : [{ plan: item.plan, frame: item.frame, request_id: item.request_id }];
    for (const part of parts) {
      const verdict = verdictOf(part.plan);
      const predicate = part.frame?.predicate ?? null;
      if (part.request_id) results.push(recordSatisfaction(run, part.request_id, { responder_id: item.speaker_id, response_event_id: item.event_id, verdict, reason: `${verdict}:${part.plan?.discourse_function ?? "?"}` })?.state ?? null);
      if (verdict === "answered" && predicate) {
        noteSelfReferentialAnswer(run, { predicate, responder_id: item.speaker_id, coworker_ids: present_ids });
        completeActivitySlot(run, predicate, item.speaker_id);
      }
    }
    personhood.recordSelfStateSnapshot(run, item.speaker_id, { source: "turn_commit" });
    for (const proposition of knowledge.propositionsOfPlan(item.plan, { speaker_id: item.speaker_id })) {
      for (const listener of new Set(item.listeners ?? [])) {
        if (!listener || listener === item.speaker_id) continue;
        recordLearning(run, { actor_id: listener, proposition: { concept: proposition.concept ?? null, key: proposition.key ?? null, predicate: proposition.predicate ?? null, reported: proposition.reported ?? null }, source_actor_id: item.speaker_id, source_event_id: item.event_id ?? null });
      }
    }
  }
  return results;
}

module.exports = { recentlyAnswered, openTurnRequests, commitTurnLines, verdictOf, STATE_VERSION, REQUEST_STATES, ACTIVITY_KINDS, ABANDON_AFTER_TURNS, PENDING, TERMINAL, SELF_REFERENTIAL, ACTIVITY_OF, stateOf, openRequest, reopenRequest, recordSatisfaction, supersede, ageRequests, findRequest, requestsOfInteraction, lastRequest, pendingRequests, recordRepair, activeActivity, noteActivityRequest, completeActivitySlot, closeActivity, noteSelfReferentialAnswer, noteAcquaintanceClosed, evaluateAcquaintance, acquaintanceComplete, recordLearning, activeSpeaker, snapshot };
