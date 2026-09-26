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

const { interpretUtterance, detectTopic, parseNamedAddress, parseAddressees, selfStateQuery, meaningRequest, quotedSpan, addressesSecondPerson, reportedSpeechRequest, addressCorrection, LANGUAGE_PATTERNS: LP } = require("./dialogue-interpretation");
const canonLexicon = require("./canon-lexicon");
const canonicalKnowledge = require("./canonical-knowledge");

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
  "ask_opinion",
  // "What do you mean by 'staying with'?": the meaning of an earlier LINE, from the facts it was
  // authorized with (one's own line) -- never from its surface wording.
  "ask_meaning",
  // "Why didn't you answer me?": a recent conversational EVENT; only a character-knowable reason.
  "ask_response_event",
  // Knowledge questions answered from the speaker's canonical knowledge grants (canonical-knowledge),
  // never from the model: what ASYNC/this place is for, today's objective, who someone is, what an
  // assignment or item is for, what a named place/entity is.
  "ask_institution_purpose", "ask_mission_objective", "ask_person_identity", "ask_assignment_purpose", "ask_entity_definition",
  // "What did Clint say the materials were for?": attributed HEARD propositions (never promoted to truth).
  "ask_reported_speech",
  // "What are you doing right now?" (current action) and "What is this room for?" (location purpose).
  "ask_current_action", "ask_location_purpose",
  // ED-30: a Semantic Registry predicate answered by its deterministic resolver ("Is it your first day?",
  // "Where are we going?", "Are we all going together?"), and a brief response to an attention call
  // ("Tonya?", "Hello?") when no request is pending.
  "ask_predicate", "attend"
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
  ask_opinion: "brief_opinion_stance",
  ask_meaning: "brief_meaning_of_own_line",
  ask_response_event: "brief_account_of_conversation_event",
  ask_institution_purpose: "brief_grounded_answer",
  ask_mission_objective: "brief_grounded_answer",
  ask_person_identity: "brief_grounded_answer",
  ask_assignment_purpose: "brief_grounded_answer",
  ask_entity_definition: "brief_grounded_answer",
  ask_reported_speech: "brief_attributed_report",
  ask_current_action: "brief_grounded_answer",
  ask_location_purpose: "brief_grounded_answer",
  ask_predicate: "brief_predicate_answer",
  attend: "brief_attention_response"
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
  ask_opinion: "own_opinion",
  ask_meaning: "meaning_of_prior_line",
  ask_response_event: "account_of_response_event",
  ask_institution_purpose: "known_concept",
  ask_mission_objective: "known_concept",
  ask_person_identity: "known_concept",
  ask_assignment_purpose: "known_concept",
  ask_entity_definition: "known_concept",
  ask_reported_speech: "reported_speech",
  ask_current_action: "known_concept",
  ask_location_purpose: "known_concept",
  ask_predicate: "predicate_answer"
});
// Functions answered from a canonical knowledge query (the concept each asks by default; the frame's
// knowledge_query may narrow it, e.g. person_identity -> person_role / person_authority / person_relation).
const KNOWLEDGE_FUNCTIONS = Object.freeze({ ask_institution_purpose: "institution_purpose", ask_mission_objective: "mission_objective", ask_person_identity: "person_identity", ask_assignment_purpose: "assignment_purpose", ask_entity_definition: "entity_definition", ask_reported_speech: "reported_speech", ask_current_action: "current_action", ask_location_purpose: "location_purpose" });

// Functions whose reply is socially obliged once the speaker heard the line,
// independent of the salience-based reaction system and of any wording.
const ANSWERABLE_QUESTIONS = new Set(["ask_factual", "ask_personal_experience", "challenge", "make_request"]);
const OBLIGATING_FUNCTIONS = new Set(["ask_predicate", "attend", "invite_self_description", "ask_role_or_assignment", "clarify_previous", "request_repetition", "ambiguous_reference", "ask_next_step", "ask_explanation", "ask_meaning", "ask_response_event", "ask_institution_purpose", "ask_mission_objective", "ask_person_identity", "ask_assignment_purpose", "ask_entity_definition", "ask_reported_speech", "ask_current_action", "ask_location_purpose"]);

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
  if (["ask_personal_experience", "ask_opinion", "ask_role_or_assignment", "ask_current_action"].includes(fn) && (recipient_type === "group" || recipient_type === "direct")) return true;
  // "Ava, Josephine, you ready?": each addressee's own momentary readiness.
  if (frame?.addressee_state && (recipient_type === "group" || recipient_type === "direct")) return true;
  // A claim about the world, said to the room, is heard and acknowledged (as the player's claim).
  if (fn === "make_statement" && frame?.player_claim) return true;
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
function deriveDiscourseState({ interaction_history = [], dialogue_history = [], player_id, location_id = null, current_interval = null, window = RECENT_TURN_WINDOW, max_interval_gap = MAX_INTERVAL_GAP, equipment = null, receipts = [], people = [], log_window = EVENT_LOG_WINDOW, entities = [] } = {}) {
  // WHY each committed line was said: the plan it was authorized with, persisted in the turn's
  // communication receipt (never the wording). Keyed by submission, then speaker. The plan's facts (and
  // their structured semantics) are what an earlier line MEANT; a later "what do you mean by X?" maps the
  // quoted wording back onto them.
  const basisBySubmission = new Map();
  const factsBySubmission = new Map();
  for (const receipt of receipts ?? []) {
    if (!receipt?.id || !Array.isArray(receipt.response_contexts)) continue;
    const bases = {};
    const facts = {};
    for (const context of receipt.response_contexts) {
      if (!context?.target_worker_id || !context.response_plan) continue;
      bases[context.target_worker_id] = responseBasisFromPlan(context.response_plan, context.semantic_frame ?? null);
      facts[context.target_worker_id] = planFacts(context.response_plan);
    }
    basisBySubmission.set(receipt.id, bases);
    factsBySubmission.set(receipt.id, facts);
  }
  const bySubmission = new Map();
  for (const event of dialogue_history ?? []) {
    if (!event?.submission_id) continue;
    const list = bySubmission.get(event.submission_id) ?? [];
    list.push(event);
    bySubmission.set(event.submission_id, list);
  }
  const spoken = (sid) => (bySubmission.get(sid) ?? []).filter((e) => e.speaker_id && e.speaker_id !== player_id && e.kind === "speech" && ["delivered", "heard"].includes(e.delivery ?? "delivered"));
  const playerEvent = (sid) => (bySubmission.get(sid) ?? []).find((e) => e.speaker_id === player_id && e.kind === "speech") ?? null;
  const intervalOf = (sid) => {
    const values = (bySubmission.get(sid) ?? []).map((e) => Number(e.interval)).filter((n) => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) : null;
  };

  // The recent conversational EVENT log (same location, not stale): the last `log_window` exchanges. The
  // last `window` of them are the framing turns; the rest only serve event and utterance references.
  const turns = [];
  const limit = Math.max(window, log_window);
  for (const item of [...(interaction_history ?? [])].reverse()) {
    if (turns.length >= limit) break;
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
    const factMap = factsBySubmission.get(item.submission_id) ?? {};
    // An autonomous report only ever voices the speaker's own authorized observation.
    const responses = committed.map((e) => ({ speaker_id: e.speaker_id, speaker_name: e.speaker_name ?? null, text: cap(e.text), basis: bases[e.speaker_id] ?? (isReport ? { kind: "observation" } : null), event_id: e.id ?? null, facts: factMap[e.speaker_id] ?? null, listener_ids: [...(e.listeners ?? [])] }));
    const responderIds = [...new Set(committed.map((e) => e.speaker_id))];
    const playerText = isPlayerTurn ? cap(item.player_text) : null;
    // Who the line addressed: the canonical address record (new saves) or its legacy equivalent.
    const address = isPlayerTurn ? addressOfRecord(item) : { scope: "untargeted", addressee_ids: [], form: "report", utterance: null };
    // Interpretation of a prior turn uses the same residual utterance the live turn used (recorded with the
    // address), else the same named-address rule; stored text is untouched.
    const residual = playerText == null ? null : (address.utterance ?? (people?.length
      ? parseAddressees(playerText, { names: people, explicit_target: item.recipient_type === "direct" ? (item.targets?.[0] ?? null) : null }).residual_text
      : parseNamedAddress(playerText, { explicit_target: item.recipient_type === "direct" ? (item.targets?.[0] ?? null) : null }).residual_text));
    const ownerIds = [...new Set((item.response_owners ?? []).map((owner) => owner?.speaker_id).filter(Boolean))];
    const listenerIds = [...(item.listeners ?? [])];
    turns.unshift({
      kind: isPlayerTurn ? "player_exchange" : "autonomous_report",
      interaction_id: item.id ?? null,
      submission_id: item.submission_id ?? null,
      player_event_id: isPlayerTurn ? (playerEvent(item.submission_id)?.id ?? null) : null,
      player_text: playerText,
      recipient_scope: isPlayerTurn ? scopeOf(item.recipient_type) : "untargeted",
      recipient_type: isPlayerTurn ? (item.recipient_type ?? "none") : "none",
      recipient_id: isPlayerTurn ? (item.recipient_id ?? null) : null,
      recipient_ids: isPlayerTurn ? [...(item.recipient_ids ?? [])] : [],
      address,
      // The accepted advisory interpretation this turn was framed with (persisted; never re-requested).
      advice: isPlayerTurn && item.interpretation?.advice?.accepted ? item.interpretation.advice : null,
      responder_ids: responderIds,
      owner_ids: ownerIds,
      // Coworkers who heard the player's line (canonical interaction listeners).
      listener_ids: listenerIds,
      responses,
      // SIMULATION reason each hearing coworker stayed silent (never a character motive; see silenceBasis).
      silence: isPlayerTurn ? silenceBases({ listener_ids: listenerIds, address, owner_ids: ownerIds, responder_ids: responderIds, player_id }) : {},
      speech_act: residual ? interpretUtterance(residual).speech_act : null,
      // Talk ABOUT the conversation ("Why didn't you answer?", "What did you mean by X?", "When I greeted
      // her.") is never itself the event or line such talk refers to.
      meta: Boolean(residual) && isMetaConversation(residual),
      interval,
      topic: detectTopic(residual ?? responses.map((r) => r.text).join(" ")),
      _residual: residual,
      _committed: committed.length
    });
  }
  const logTurns = turns.splice(0, Math.max(0, turns.length - window));
  const allTurns = [...logTurns, ...turns];

  // Each prior player turn is re-framed CHRONOLOGICALLY with the open question and item antecedent as
  // they stood at that point, so a resumed fragment ("The camera.") reconstructs exactly as it was
  // framed live -- including after a cold reload. Everything is derived from persisted history.
  let openQuestion = null;
  let itemSoFar = null;
  for (const turn of allTurns) {
    const residual = turn._residual;
    const committedCount = turn._committed;
    delete turn._residual;
    delete turn._committed;
    turn.residual_text = residual;
    if (!turns.includes(turn)) continue; // log-only turn: address/response facts, no re-framing
    if (turn.kind !== "player_exchange") { turn.discourse_function = null; turn.item_referent = null; turn.awaiting_clarification = false; openQuestion = null; continue; }
    const earlier = allTurns.slice(0, allTurns.indexOf(turn));
    const priorFrame = buildSemanticFrame({ text: residual, recipient_type: turn.recipient_type ?? "none", addressee_ids: turn.address.addressee_ids, equipment: equipment ?? {}, discourse: { pending_question: openQuestion, last_item_referent: itemSoFar, turns: earlier.slice(-window), last_turn: earlier.at(-1) ?? null, event_log: earlier, utterance_log: utteranceLog(earlier, player_id) }, people, entities, advice: turn.advice ?? null });
    const priorItem = (priorFrame.referents ?? []).find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
    turn.discourse_function = priorFrame.discourse_function ?? null;
    turn.knowledge_key = priorFrame.knowledge_query ? `knowledge:${priorFrame.knowledge_query.concept}:${priorFrame.knowledge_query.entity?.id ?? priorFrame.knowledge_query.entity?.label ?? "-"}` : null;
    if (["ask_meaning", "ask_response_event", "ask_explanation", "clarify_previous", "request_repetition", "ask_heard_confirmation"].includes(turn.discourse_function) || priorFrame.slot_answer) turn.meta = true;
    turn.resolved_utterance = priorFrame.resolved_utterance ?? null;
    turn.item_referent = priorItem ? { id: priorItem.id, label: priorItem.label } : null;
    // The reply itself is the authority on whether a clarification was asked: its recorded basis when
    // the receipt exists, the re-derived frame otherwise (older saves).
    const recordedBases = turn.responses.map((r) => r.basis).filter(Boolean);
    const clarifying = recordedBases.find((b) => b.kind === "clarification") ?? null;
    turn.awaiting_clarification = committedCount > 0 && (recordedBases.length ? Boolean(clarifying) : Boolean(priorFrame.unresolved_reference));
    if (turn.item_referent) itemSoFar = turn.item_referent;
    // OPEN QUESTION: the reply asked the player something. It records what kind of answer would resolve
    // it (expected_slot), so a bare fragment ("Just now.", "The camera.", "By the table.") is read as the
    // answer to THAT question, not as a fresh statement.
    openQuestion = turn.awaiting_clarification && QUESTION_FUNCTIONS_RESUMABLE.has(turn.discourse_function)
      ? {
        question_id: `${turn.interaction_id}:clarification`,
        discourse_function: turn.discourse_function,
        player_text: priorFrame.resolved_utterance ?? turn.player_text,
        interaction_id: turn.interaction_id,
        responder_ids: [...turn.responder_ids],
        asker_ids: turn.responses.filter((r) => r.basis?.kind === "clarification" || !recordedBases.length).map((r) => r.speaker_id),
        addressee: player_id,
        expected_slot: clarifying?.expected_slot ?? clarificationSlot(priorFrame)
      }
      : null;
  }

  const last = turns[turns.length - 1] ?? null;
  const previous = turns[turns.length - 2] ?? null;
  // Topic stack: distinct conversational topics in order, each with its latest question (derived from
  // history, never stored and never chosen by the model). A topic is the resolved item, the procedure,
  // the speakers' own states, or the detected subject.
  const topicKeyOf = (turn) => (turn.item_referent ? `item:${turn.item_referent.id}` : turn.knowledge_key ? turn.knowledge_key : turn.discourse_function === "ask_next_step" ? "procedure" : turn.discourse_function === "check_in" ? "self_state" : turn.topic ?? null);
  const topicStack = [];
  for (const turn of turns) {
    if (turn.kind !== "player_exchange" || ["clarify_previous", "request_repetition", "ask_explanation", "ask_heard_confirmation", "acknowledge", "close_topic", "ask_meaning", "ask_response_event"].includes(turn.discourse_function)) continue;
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
    log_window: limit,
    max_interval_gap,
    same_location_required: true,
    location_id: location_id ?? null,
    turns,
    // Older exchanges kept only for references to recent conversational events and earlier wording.
    event_log: allTurns,
    utterance_log: utteranceLog(allTurns, player_id),
    last_turn: last,
    current_topic: last?.topic ?? null,
    previous_topic: previous?.topic ?? null,
    recipient_scope: last?.recipient_scope ?? null,
    active_participants: [...participants],
    // The thread the player is in: who their immediately preceding line addressed and who answered.
    active_thread: activeThreadOf(last),
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

// Exchanges kept for references to earlier events/wording (beyond the 4-turn framing window).
const EVENT_LOG_WINDOW = 12;

/** A line about the conversation itself (its events or wording), by its language alone. */
function isMetaConversation(text) {
  const raw = String(text ?? "").trim().replace(LP.discourse_marker, "");
  return LP.response_event.test(raw) || Boolean(meaningRequest(raw)) || LP.explanation_request.test(raw) || LP.bare_reaction.test(raw) || LP.repetition_request.test(raw) || /^(?:just now|when (?:i|you|we) (?:said|asked|greeted|told|mentioned|called|spoke|talked|addressed))\b/i.test(raw);
}

/** The address a recorded player turn made: the canonical record, or its legacy equivalent. */
function addressOfRecord(item) {
  if (item?.address?.scope) return { scope: item.address.scope, addressee_ids: [...(item.address.addressee_ids ?? [])], form: item.address.form ?? null, source: item.address.source ?? null, utterance: item.address.utterance ?? null };
  const type = item?.recipient_type ?? "none";
  if (type === "direct") return { scope: "direct", addressee_ids: [item.recipient_ids?.[0] ?? item.recipient_id].filter(Boolean), form: "legacy", source: null, utterance: null };
  if (type === "group") return { scope: "group", addressee_ids: [...(item.recipient_ids ?? [])], form: "legacy", source: null, utterance: null };
  return { scope: "untargeted", addressee_ids: [], form: "legacy", source: null, utterance: null };
}

/**
 * The SIMULATION reason each coworker who heard a player line did not answer it. This is engine
 * bookkeeping, not psychology: a character may voice only the character-knowable part of it
 * (characterSilenceReason), never the rest -- and never a parser/runtime outcome as a motive.
 *   not_a_listener                 did not hear the line
 *   response_policy_selected_other someone else was selected to answer (and did)
 *   not_selected_no_response       addressed/heard, but response policy selected nobody
 *   room_speech_no_response        spoken to the room; policy selected nobody
 *   reply_not_delivered            an owner whose reply never committed (provider/presentation failure,
 *                                  or still pending) -- NOT canonical silence
 */
function silenceBases({ listener_ids = [], address, owner_ids = [], responder_ids = [], player_id }) {
  const out = {};
  const ids = new Set([...listener_ids, ...(address?.addressee_ids ?? [])].filter((id) => id && id !== player_id));
  for (const id of ids) {
    if (responder_ids.includes(id)) continue;
    if (!listener_ids.includes(id)) out[id] = "not_a_listener";
    else if (owner_ids.includes(id)) out[id] = "reply_not_delivered";
    else if (responder_ids.length || owner_ids.some((owner) => owner !== id)) out[id] = "response_policy_selected_other";
    else out[id] = address?.scope === "untargeted" ? "room_speech_no_response" : "not_selected_no_response";
  }
  return out;
}

/** What a character can KNOW about why they did not answer: only what they perceived. */
function characterSilenceReason(basis) {
  if (basis === "not_a_listener") return "did_not_hear";
  if (basis === "response_policy_selected_other") return "another_answered";
  return "no_character_reason";
}

/** The active conversational thread established by the player's immediately preceding line. */
function activeThreadOf(last) {
  if (!last) return null;
  if (last.kind === "autonomous_report") return Object.freeze({ kind: "report", member_ids: [...last.responder_ids], responder_ids: [...last.responder_ids], interaction_id: last.interaction_id });
  const scope = last.address?.scope ?? last.recipient_scope;
  const members = scope === "direct" || scope === "subset" ? [...(last.address?.addressee_ids ?? [])] : scope === "group" ? [...new Set([...(last.address?.addressee_ids ?? []), ...last.recipient_ids])] : [];
  return Object.freeze({ kind: scope, member_ids: members, responder_ids: [...last.responder_ids], interaction_id: last.interaction_id });
}

/** Every line the player heard or said in the event log, chronologically (player lines included). */
function utteranceLog(turns, player_id) {
  const out = [];
  for (const turn of turns ?? []) {
    if (turn.kind === "player_exchange" && turn.player_text) out.push({ interaction_id: turn.interaction_id, event_id: turn.player_event_id ?? null, speaker_id: player_id, speaker_name: "you", is_player: true, text: turn.player_text, basis: null, facts: null, address: turn.address ?? null, interval: turn.interval, listener_ids: [...(turn.listener_ids ?? [])] });
    for (const response of turn.responses ?? []) out.push({ interaction_id: turn.interaction_id, event_id: response.event_id ?? null, speaker_id: response.speaker_id, speaker_name: response.speaker_name, is_player: false, text: response.text, basis: response.basis ?? null, facts: response.facts ?? null, interval: turn.interval, listener_ids: [...(response.listener_ids ?? [])] });
  }
  return out;
}

/** The facts (and their structured meaning) a line was authorized with -- what it MEANT. Bounded. */
function planFacts(plan) {
  if (!plan) return null;
  if (plan.discourse_function === "compound") { const parts = plan.parts.map((p) => planFacts(p.plan)).filter(Boolean); return { discourse_function: "compound", required: parts.flatMap((p) => p.required).slice(0, 12), optional: parts.flatMap((p) => p.optional).slice(0, 12), semantics: Object.assign({}, ...parts.map((p) => p.semantics ?? {})) }; }
  const keep = (list) => (list ?? []).filter((f) => f && f.key && !["uncertainty", "antecedent_responses", "antecedent_player_text"].includes(f.key)).slice(0, 8).map((f) => ({ key: f.key, value: f.value }));
  return { discourse_function: plan.discourse_function ?? null, required: keep(plan.required_facts), optional: keep(plan.optional_facts), semantics: plan.fact_semantics ? structuredClone(plan.fact_semantics) : null };
}

// Questions a clarification exchange can be resumed into once the missing referent is named.
const QUESTION_FUNCTIONS_RESUMABLE = new Set(["ask_item_ownership", "make_request", "ask_factual", "ambiguous_reference", "ask_next_step", "ask_personal_experience", "ask_explanation", "check_in", "ask_meaning", "ask_response_event", "make_statement"]);

// ─── 2. Scope inheritance ───────────────────────────────────────────────────
/**
 * Fixed precedence (Part 12 of the pragmatics pass):
 *   1. explicit target / named addressee set / group language            (caller: explicit_target, group_address)
 *   2. an answer to an OPEN QUESTION goes to the one(s) who asked it
 *   3. a reflexive follow-up / discourse-dependent line / second-person line continues the ACTIVE THREAD
 *      (direct -> that person; subset/group -> that set, or its single responder for a singular "you")
 *   4. untargeted room speech
 * A thread is only ever the player's immediately preceding exchange at this location; an intervening
 * report, a new explicit address or group language ends it. The model never takes part.
 */
function resolveRecipientScope({ text, explicit_target = null, group_address = false, discourse = null, present_ids = [], people = [], equipment = {} } = {}) {
  if (explicit_target) return { recipient_type: "direct", recipient_ids: [], inherited: false, source: "explicit_target" };
  if (group_address) return { recipient_type: "group", recipient_ids: [], inherited: false, source: "group_address" };
  const present = new Set(present_ids);
  const last = discourse?.last_turn ?? null;
  const raw = String(text ?? "").trim();
  // 2. An open question expects an answer from the player: a line that fills its slot answers the asker.
  const pending = discourse?.pending_question ?? null;
  if (pending && matchOpenQuestionSlot(raw, pending, { equipment, people, discourse })) {
    const askers = (pending.asker_ids?.length ? pending.asker_ids : pending.responder_ids ?? []).filter((id) => present.has(id));
    if (askers.length === 1) return { recipient_type: "direct", recipient_ids: askers, inherited: true, source: "open_question_answer", address_scope: "direct" };
    if (askers.length > 1) return { recipient_type: "group", recipient_ids: askers, inherited: true, source: "open_question_answer", address_scope: "subset" };
  }
  // 2b. A question about something the previous speaker's AUTHORIZED line introduced ("What exactly are
  // the startup materials for?" after "I'm delivering the startup materials.", or "What are those for?")
  // stays with that speaker. Only authorized facts create anchors; model wording alone never does.
  const lastResponses = last?.kind === "player_exchange" ? (last.responses ?? []) : [];
  if (lastResponses.length && LP.question_like.test(raw)) {
    const words = (raw.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/s$/, ""));
    const introducers = [...new Set(lastResponses.filter((r) => anchorTerms(r).some((t) => words.includes(t))).map((r) => r.speaker_id))].filter((id) => present.has(id));
    const pronounFollowUp = /\b(?:those|them|that|these|it)\b/i.test(raw) && lastResponses.length === 1 && anchorEntities(lastResponses[0]).length + anchorTerms(lastResponses[0]).length > 0;
    if (introducers.length === 1) return { recipient_type: "direct", recipient_ids: introducers, inherited: true, source: "anchored_follow_up", address_scope: "direct" };
    if (!introducers.length && pronounFollowUp && present.has(lastResponses[0].speaker_id)) return { recipient_type: "direct", recipient_ids: [lastResponses[0].speaker_id], inherited: true, source: "anchored_follow_up", address_scope: "direct" };
  }
  if (last && isFollowUpReflex(raw) && last.kind === "autonomous_report") {
    const reporter = last.responder_ids[0];
    if (reporter && present.has(reporter)) return { recipient_type: "direct", recipient_ids: [reporter], inherited: true, source: "prior_autonomous_report", address_scope: "direct" };
  }
  // 3. Active thread.
  const thread = discourse?.active_thread ?? null;
  if (thread && ["direct", "subset", "group"].includes(thread.kind)) {
    const reflex = isFollowUpReflex(raw);
    const dependent = threadDependent(raw);
    const secondPerson = addressesSecondPerson(raw);
    if (reflex || dependent || secondPerson) {
      const members = thread.member_ids.filter((id) => present.has(id));
      const source = reflex ? `prior_${thread.kind === "direct" ? "direct" : "group"}_exchange` : "active_thread";
      if (thread.kind === "direct" && members.length) return { recipient_type: "direct", recipient_ids: [members[0]], inherited: true, source, address_scope: "direct" };
      if (thread.kind !== "direct" && members.length) {
        // A singular "you" after a set exchange that only ONE of them answered is that one.
        const responders = thread.responder_ids.filter((id) => members.includes(id));
        if (secondPerson && !reflex && !dependent && responders.length === 1) return { recipient_type: "direct", recipient_ids: responders, inherited: true, source: "active_thread_responder", address_scope: "direct" };
        return { recipient_type: "group", recipient_ids: members, inherited: true, source, address_scope: thread.kind };
      }
    }
  }
  return { recipient_type: "none", recipient_ids: [], inherited: false, source: "untargeted", address_scope: "untargeted" };
}

/** Lines that only make sense against the preceding exchange ("Why?", "What do you mean by 'X'?"). */
function threadDependent(raw) {
  const text = String(raw ?? "").trim().replace(LP.discourse_marker, "");
  return LP.explanation_request.test(text) || LP.bare_wh_followup.test(text) || Boolean(meaningRequest(text)) || LP.response_event.test(text) || LP.self_repair_lead.test(text);
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

function resolveAntecedent({ discourse_function, discourse, referents = [], utterance_reference = null, event_reference = null } = {}) {
  const last = discourse?.last_turn ?? null;
  if (discourse_function === "ask_meaning") {
    const ref = utterance_reference;
    if (!ref?.resolved) return { type: "prior_utterance", resolved: false, reason: ref?.reason ?? "no_matching_line" };
    return { type: "prior_utterance", resolved: true, interaction_id: ref.interaction_id, player_text: ref.is_player ? ref.text : null, quoted: ref.span ?? null, responder_ids: ref.is_player ? [] : [ref.speaker_id], responses: ref.is_player ? [] : [{ speaker_id: ref.speaker_id, speaker_name: ref.speaker_name, text: ref.text, basis: ref.basis ?? null }] };
  }
  if (discourse_function === "ask_response_event") {
    const target = event_reference?.target ?? null;
    return { type: "conversation_event", resolved: Boolean(event_reference?.resolved), interaction_id: target?.interaction_id ?? null, player_text: target?.player_text ?? null, responder_ids: target?.responder_ids ?? [], responses: [], ...(event_reference?.resolved ? {} : { reason: event_reference?.reason ?? "no_matching_event" }) };
  }
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
    // "How do you know?" after a repeated answer asks how the ORIGINAL answer is known: skip the
    // repetition(s) back to the line that was repeated.
    const turns = discourse?.turns ?? [];
    let index = turns.length - 1;
    let target = last;
    while (index > 0 && turns[index] === target && ["clarify_previous", "request_repetition"].includes(turns[index]?.discourse_function) && turns[index - 1]?.responses?.length) { index -= 1; target = turns[index]; }
    return { ...resolveFromTurn(discourse_function, target), type: "prior_response" };
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
      // Frames carry only deterministic identity (no random event ids, no fact payloads).
      responses: last.responses.map((r) => ({ speaker_id: r.speaker_id, speaker_name: r.speaker_name ?? null, text: r.text, basis: r.basis ?? null }))
    };
  }
}

// ─── 3d. Conversational pragmatics: open questions, earlier wording, conversational events ────
// Plain-text comparison of wording: case, quotes and punctuation never decide a match.
const normalizeWords = (text) => String(text ?? "").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
// Person/aux words that change when a line is reported ("I am staying" -> "you were staying").
const REPORTING_WORDS = new Set(["i", "i'm", "im", "am", "me", "my", "mine", "you", "you're", "youre", "your", "yours", "are", "was", "were", "is", "be", "been", "the", "a", "an", "that", "said", "say", "just"]);
const spanWords = (text) => normalizeWords(text).split(" ").filter((w) => w && !REPORTING_WORDS.has(w));
/** Does a line contain the quoted/paraphrased span? "exact" (normalized substring) or "paraphrase". */
function spanMatch(span, line) {
  const a = normalizeWords(span);
  const b = normalizeWords(line);
  if (!a || !b) return null;
  if (` ${b} `.includes(` ${a} `)) return "exact";
  const words = spanWords(span);
  if (words.length < 2) return null;
  const lineWords = new Set(spanWords(line));
  return words.filter((w) => lineWords.has(w)).length / words.length >= 0.75 ? "paraphrase" : null;
}
const peopleNamedIn = (text, people = []) => (people ?? []).filter((p) => p?.id && p?.name && new RegExp(`\\b${String(p.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(String(text ?? "")));

/** The reference an open question leaves for the turn that answers it (trace/receipt; bounded). */
function openQuestionRef(q) {
  return q ? Object.freeze({ question_id: q.question_id ?? null, expected_slot: q.expected_slot ?? null, asker_ids: [...(q.asker_ids ?? q.responder_ids ?? [])], interaction_id: q.interaction_id ?? null }) : null;
}

/**
 * What kind of answer would resolve the clarification this frame's reply asks (if it asks one). Only
 * enough structure to make ordinary clarification compositional; never a linguistic ontology.
 */
const EXPECTED_SLOTS = Object.freeze(["referent", "person", "location", "spatial_selection", "temporal", "reason", "yes_no", "topic"]);
function clarificationSlot(frame) {
  if (!frame) return "topic";
  const fn = frame.discourse_function;
  if (frame.correction && !frame.correction.resolved) return "person";
  if (fn === "ask_response_event") return "temporal";
  if (fn === "ask_meaning") return "topic";
  if (fn === "ask_person_identity") return "person";
  if (fn === "ask_assignment_purpose" || fn === "ask_entity_definition") return "referent";
  if (frame.temporal_reference && !frame.temporal_reference.resolved) return "temporal";
  const refs = frame.referents ?? [];
  if (refs.some((r) => r.type === "spatial" && !r.resolved && r.noun && !GENERIC_DEICTIC_NOUNS.has(r.noun))) return "spatial_selection";
  if (refs.some((r) => (r.type === "equipment" && !r.resolved) || r.reason === "no_antecedent")) return "referent";
  if (fn === "ambiguous_reference") return frame.ambiguous_place ? "location" : "referent";
  return "topic";
}

/**
 * Does this line ANSWER the open question (fill its expected slot)? Returns the slot answer or null. A new
 * question, an explanation/meaning request or a response-event question is never an answer.
 */
function matchOpenQuestionSlot(raw, pending, { equipment = {}, people = [], discourse = null, spatial_selection = null } = {}) {
  if (!pending) return null;
  const text = String(raw ?? "").trim().replace(LP.discourse_marker, "");
  const core = text.replace(LP.repair_lead, "").replace(/^[,\s]+/, "").trim();
  const count = (core.match(/[A-Za-z0-9']+/g) ?? []).length;
  if (!core || count === 0 || count > 14) return null;
  if (meaningRequest(core) || LP.response_event.test(core) || LP.explanation_request.test(core) || LP.bare_reaction.test(core)) return null;
  if (/^(?:who|what|where|why|how|which|are|is|do|does|did|can|could|will|would|have|has|should|was|were)\b/i.test(core) && count > 3) return null;
  const slot = pending.expected_slot ?? "topic";
  const SA = LP.slot_answers;
  const answer = (extra = {}) => Object.freeze({ slot, text: core.slice(0, 200), ...extra });
  switch (slot) {
    case "temporal": {
      const event = resolveEventReference({ text: core, discourse, people });
      const temporal = LP.temporal_reference.test(core) ? resolveTemporalReference({ text: core, discourse }) : null;
      return SA.temporal.test(core) || event || temporal ? answer({ event: event ?? null, temporal: temporal ?? null }) : null;
    }
    case "location":
      return SA.location.test(core) ? answer({ expression: core.replace(/[.!?\s]+$/, "") }) : null;
    case "spatial_selection":
      return SA.location.test(core) || LP.repair_fragment.test(text) || resolveSpatialSelection(spatial_selection) ? answer() : null;
    case "reason":
      return SA.reason.test(core) ? answer({ status: "player_claim" }) : null;
    case "yes_no":
      return SA.yes_no.test(core) ? answer({ polarity: /^(?:no|nope|nah|not really|i don'?t|i didn'?t)\b/i.test(core) ? "no" : "yes" }) : null;
    case "person": {
      const named = peopleNamedIn(core, people);
      return named.length === 1 && count <= 6 ? answer({ person_id: named[0].id }) : null;
    }
    default: {
      const item = resolveEquipmentReferent(core, equipment, { loose: true });
      if (item.status === "unique") return answer({ referent: { id: item.item.id, label: item.item.label ?? item.item.id } });
      return LP.repair_fragment.test(text) || SA.location.test(core) ? answer() : null;
    }
  }
}

/**
 * A recent conversational event named by what the player did ("when I greeted Ava and Josephine", "when I
 * said hello", "until I addressed you directly", a quotation of the player's own words) or by recency
 * ("just now"). Resolved against the event log only; a description that fits several exchanges is
 * unresolved (unless recency picks the latest), never guessed.
 */
function resolveEventReference({ text, discourse, addressee_ids = [], people = [] } = {}) {
  const raw = String(text ?? "");
  const log = (discourse?.event_log ?? discourse?.turns ?? []).filter((t) => t.kind === "player_exchange" && t.player_text && !t.meta);
  const recency = /\b(?:just now|just then|a (?:minute|moment|second) ago)\b/i.test(raw);
  const done = (relation, hits, extra = {}) => {
    if (!hits.length) return Object.freeze({ relation, resolved: false, recency, turn: null, candidates: 0, reason: "no_matching_event", ...extra });
    if (hits.length > 1 && !recency && !["until", "before"].includes(relation)) return Object.freeze({ relation, resolved: false, recency, turn: null, candidates: hits.length, reason: "several_matching_events", ...extra });
    return Object.freeze({ relation, resolved: true, recency, turn: hits.at(-1).interaction_id, candidates: hits.length, ...extra });
  };
  const match = raw.match(LP.event_reference);
  if (!match) {
    const quoted = quotedSpan(raw);
    if (quoted) return done("when", log.filter((t) => spanMatch(quoted, t.player_text)), { quoted });
    return recency ? Object.freeze({ relation: "recent", resolved: true, recency: true, turn: null, candidates: 0 }) : null;
  }
  const relation = match[0].split(/\s+/)[0].toLowerCase();
  const actor = match[1].toLowerCase();
  const verb = match[2].toLowerCase();
  const rest = String(match[3] ?? "");
  const quoted = quotedSpan(rest) ?? (/^(?:said|say|asked|told|mentioned)$/.test(verb) ? rest.replace(/^\s*(?:to\s+[A-Za-z]+\s*)?[,:]?\s*/, "").replace(/(?:\.{2,}|…|[.!?,\s])+$/, "").trim() || null : null);
  if (actor === "you") {
    // "when you said X": the exchange in which THEY said it.
    return done(relation, quoted ? log.filter((t) => (t.responses ?? []).some((r) => spanMatch(quoted, r.text))) : [], { quoted });
  }
  let hits = log;
  if (quoted && normalizeWords(quoted).split(" ").length >= 1 && !/^(?:hello|hi|hey)$/i.test(quoted)) hits = hits.filter((t) => spanMatch(quoted, t.player_text));
  const named = peopleNamedIn(rest, people).map((p) => p.id);
  const you = /\byou\b/i.test(rest) ? addressee_ids : [];
  const wanted = [...new Set([...named, ...you])];
  if (wanted.length) {
    hits = hits.filter((t) => t.address?.scope === "group" || wanted.every((id) => (t.address?.addressee_ids ?? []).includes(id)));
    // Naming the people prefers the exchange explicitly addressed to them over a greeting of everyone.
    const named = hits.filter((t) => t.address?.scope !== "group");
    if (named.length) hits = named;
  }
  if (/\bdirectly\b/i.test(rest)) hits = hits.filter((t) => t.address?.scope === "direct");
  if (/^(?:greeted|said hello|said hi)$/.test(verb) || (quoted && /^(?:hello|hi|hey)$/i.test(quoted))) hits = hits.filter((t) => t.speech_act === "greeting" || /^(?:hi|hey|hello|hiya|good ?morning|morning|howdy)\b/i.test(t.player_text));
  if (verb === "asked") hits = hits.filter((t) => /\?\s*$/.test(t.player_text) || ["factual_question", "personal_question", "group_question"].includes(t.speech_act));
  if (/^introduced/.test(verb)) hits = hits.filter((t) => t.speech_act === "introduction");
  return done(relation, hits, { quoted: quoted ?? null, named });
}

/** The exchange a "Why didn't you answer?" question is about, plus bounded candidates for each responder. */
function responseEventReference({ text, discourse, addressee_ids = [], people = [], slot_constraint = null } = {}) {
  const log = (discourse?.event_log ?? discourse?.turns ?? []).filter((t) => t.kind === "player_exchange" && !t.meta);
  const supplied = slot_constraint?.slot === "temporal";
  const ev = supplied ? (slot_constraint.event ?? (slot_constraint.temporal?.resolved ? Object.freeze({ relation: "recent", resolved: true, recency: true, turn: null, candidates: 0 }) : null)) : resolveEventReference({ text, discourse, addressee_ids, people });
  const summarize = (t) => ({ interaction_id: t.interaction_id, player_text: cap(t.player_text, 300), address_scope: t.address?.scope ?? t.recipient_scope ?? null, addressee_ids: [...(t.address?.addressee_ids ?? [])], listener_ids: [...(t.listener_ids ?? [])], responder_ids: [...(t.responder_ids ?? [])], responses: (t.responses ?? []).map((r) => ({ speaker_id: r.speaker_id, speaker_name: r.speaker_name ?? null, text: cap(r.text, 300) })), silence: { ...(t.silence ?? {}) } });
  let candidates = [...log];
  let target = null;
  if (ev?.resolved && ev.turn) {
    const index = log.findIndex((t) => t.interaction_id === ev.turn);
    if (["when", "recent"].includes(ev.relation)) target = log[index] ?? null;
    else if (["until", "before"].includes(ev.relation)) candidates = log.slice(0, Math.max(0, index));
    else if (["after", "since"].includes(ev.relation)) candidates = log.slice(index + 1);
  }
  const explicit = Boolean(ev) && !ev.recency;
  return Object.freeze({
    explicit,
    relation: ev?.relation ?? null,
    recency: Boolean(ev?.recency),
    resolved: ev ? Boolean(ev.resolved) : true,
    ...(ev && !ev.resolved ? { reason: ev.reason ?? "no_matching_event" } : {}),
    target: target ? summarize(target) : null,
    // Most recent first, bounded: each responder's own unanswered exchange is picked from these.
    candidates: target ? [] : candidates.reverse().slice(0, 6).map(summarize)
  });
}

/**
 * The earlier LINE a meaning request refers to, among lines the player heard or said: explicit quotation
 * first, then the named/addressed speaker, then the most recent line of that speaker. Never unheard speech.
 */
function resolveUtteranceReference({ speaker_ref = "you", span = null, discourse = null, addressee_ids = [], people = [], target = null } = {}) {
  const log = discourse?.utterance_log ?? [];
  if (!log.length) return Object.freeze({ resolved: false, reason: "no_prior_line", span });
  const npc = log.filter((l) => !l.is_player);
  let pool;
  let preferred = [];
  if (speaker_ref === "i") pool = log.filter((l) => l.is_player);
  else if (speaker_ref === "you") { pool = npc; preferred = addressee_ids.length === 1 ? npc.filter((l) => l.speaker_id === addressee_ids[0]) : []; }
  else if (["she", "he", "they"].includes(speaker_ref)) pool = npc.filter((l) => !(addressee_ids.length === 1 && l.speaker_id === addressee_ids[0]));
  else {
    const person = (people ?? []).find((p) => String(p.name ?? "").toLowerCase() === speaker_ref);
    pool = person ? npc.filter((l) => l.speaker_id === person.id) : npc;
  }
  const pickTarget = (target) => log.filter((l) => l.interaction_id === target.interaction_id && l.speaker_id === target.speaker_id);
  const pick = (lines, how) => {
    const line = lines.at(-1);
    return Object.freeze({ resolved: true, match: how, span, candidates: lines.length, interaction_id: line.interaction_id, speaker_id: line.speaker_id, speaker_name: line.speaker_name ?? null, is_player: line.is_player, text: line.text, basis: line.basis ?? null, facts: line.facts ?? null, listener_ids: [...(line.listener_ids ?? [])] });
  };
  // An anchored noun question names the exact line whose authorized facts introduced the term.
  if (target) { const lines = pickTarget(target); if (lines.length) return pick(lines, "anchor"); }
  if (!span) {
    const lines = preferred.length ? preferred : pool;
    return lines.length ? pick(lines, "latest") : Object.freeze({ resolved: false, reason: "no_prior_line", span });
  }
  for (const lines of [preferred, pool, speaker_ref === "you" ? log : []]) {
    const exact = lines.filter((l) => spanMatch(span, l.text) === "exact");
    if (exact.length) return pick(exact, "exact");
    const loose = lines.filter((l) => spanMatch(span, l.text));
    if (loose.length) return pick(loose, "paraphrase");
  }
  return Object.freeze({ resolved: false, reason: "no_matching_line", span });
}

/**
 * Which authorized fact of an earlier line explains a quoted span of its wording (Part 6): the surface
 * phrase is never itself a fact. unique -> that fact; several -> ambiguous (clarify); none -> the span was
 * only wording, so the line's basis is what it meant.
 */
function matchSpanToFacts(span, facts) {
  const all = [...(facts?.required ?? []), ...(facts?.optional ?? [])];
  if (!span) return { status: "whole_line", facts: all.map((f) => f.key) };
  const textOf = (value) => (typeof value === "string" ? value : value && typeof value === "object" ? Object.values(value).filter((v) => typeof v === "string").join(" ") : String(value ?? ""));
  // A span matches a fact when it is (a paraphrase of) part of that fact's wording, or when most of its
  // content words come from that fact ("verbal record duty" ~ "keeping the verbal record").
  const partial = (value) => { const words = spanWords(span).filter((w) => w.length >= 4); const own = new Set(spanWords(value)); return words.length >= 1 && words.filter((w) => own.has(w)).length / words.length >= 0.5; };
  // A task's lexical aliases (language, not facts) let "recording" reach the verbal-recall assignment.
  const aliasesOf = (f) => (facts?.semantics?.[f.key]?.task ? (canonicalKnowledge.TASK_ALIASES[facts.semantics[f.key].task] ?? []).join(" ") : "");
  const hits = all.filter((f) => spanMatch(span, textOf(f.value)) || partial(textOf(f.value)) || (aliasesOf(f) && partial(aliasesOf(f))));
  const keys = [...new Set(hits.map((f) => f.key))];
  if (keys.length === 1) return { status: "unique", fact: hits[0], semantics: facts?.semantics?.[keys[0]] ?? null };
  if (keys.length > 1) return { status: "ambiguous", keys };
  return { status: "wording_only" };
}

// ─── 3e. Semantic knowledge intents, anchors and advisory merge ────────────────────────────────
// Terms a committed line's AUTHORIZED FACTS introduced (plus the lexical aliases of an authorized task).
// Model wording never becomes an anchor on its own: only what licensed the line does.
const ANCHOR_STOP = new Set(["with", "that", "this", "your", "have", "been", "from", "they", "them", "what", "field", "keeping", "handling", "right", "now", "just", "said", "maxwell"]);
const NON_ANCHOR_FACTS = new Set(["self_state", "self_state_answer", "uncertainty", "heard_confirmation", "request_disposition", "explanation_basis", "conversation_event", "name"]);
function anchorTerms(response) {
  const facts = response?.facts;
  if (!facts) return [];
  // Only facts with operational CONTENT anchor; states, stances and bookkeeping never do.
  const texts = [...(facts.required ?? []), ...(facts.optional ?? [])].filter((f) => !NON_ANCHOR_FACTS.has(f.key)).flatMap((f) => (typeof f.value === "string" ? [f.value] : Array.isArray(f.value) ? f.value.filter((v) => typeof v === "string") : f.value && typeof f.value === "object" ? Object.values(f.value).filter((v) => typeof v === "string") : []));
  const task = facts.semantics?.current_assignment?.task ?? null;
  const aliases = task ? (canonicalKnowledge.TASK_ALIASES[task] ?? []) : [];
  const words = [...(texts.join(" ").toLowerCase().match(/[a-z]{4,}/g) ?? []), ...aliases.flatMap((a) => a.toLowerCase().split(/\s+/)).filter((w) => w.length >= 4)];
  return [...new Set(words.map((w) => w.replace(/s$/, "")))].filter((w) => !ANCHOR_STOP.has(w));
}
/** Canonical entities a line's authorized facts introduced (its task, items, places). */
function anchorEntities(response, entities = []) {
  const facts = response?.facts;
  if (!facts) return [];
  const text = [...(facts.required ?? []), ...(facts.optional ?? [])].map((f) => (typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? ""))).join(" ");
  const found = canonicalKnowledge.resolveEntityMentions(text, entities).filter((e) => ["task", "equipment", "location", "entity"].includes(e.kind));
  const task = facts.semantics?.current_assignment?.task ?? null;
  const taskEntity = task ? entities.find((e) => e.id === `task:${task}`) : null;
  return [...(taskEntity ? [{ id: taskEntity.id, kind: taskEntity.kind, label: taskEntity.label }] : []), ...found.filter((e) => e.id !== taskEntity?.id)];
}
/**
 * "No, I said Brady." / "I meant Brady." / "Not Daisy." / "No, the other one.": a correction of WHO the
 * player's previous line was for. Resolved against that line's canonical address and responders only; a
 * correction never rewrites any identity fact, it only re-asks the same question of the intended person.
 * Returns null (not a correction), or { kind, resolved, target_id, question_text, of_interaction }.
 */
function resolveAddressCorrection({ text, discourse = null, people = [], present_ids = [] } = {}) {
  let c = addressCorrection(text);
  let last = discourse?.last_turn ?? null;
  // "No, the other one." -> "Sorry, who do you mean?" -> "Brady.": the name answers the open correction,
  // and the question being corrected is the one before it.
  if (!c && last?.kind === "player_exchange" && last.awaiting_clarification && addressCorrection(last.player_text)) {
    const bare = String(text ?? "").trim().replace(/^(?:i mean(?:t)?|um+|uh+)\s*,?\s*/i, "").replace(/[.!?\s]+$/, "");
    const turns = discourse?.turns ?? [];
    if (LP.bare_name.test(bare) && turns.length >= 2) { c = { kind: "retarget", name: bare }; last = turns[turns.length - 2]; }
  }
  if (!c) return null;
  if (!last || last.kind !== "player_exchange" || !last.player_text || last.meta) return null;
  const byName = (name) => (people ?? []).find((p) => p?.name && String(p.name).toLowerCase() === String(name).toLowerCase()) ?? null;
  const pending = discourse?.pending_question ?? null;
  const responders = last.responder_ids ?? [];
  const addressed = last.address?.addressee_ids ?? [];
  let target = null;
  if (c.kind === "retarget") {
    const person = byName(c.name);
    if (!person) return null;
    // "No, Brady." answering Brady's own open question is an answer, not a correction.
    if (pending && (pending.asker_ids ?? []).includes(person.id)) return null;
    target = person.id;
  } else if (c.kind === "exclude") {
    const person = byName(c.name);
    if (!person) return null;
    const pool = (addressed.length > 1 ? addressed : responders.length ? [] : []).filter((id) => id !== person.id);
    target = pool.length === 1 ? pool[0] : null;
  } else {
    const pool = addressed.length === 2 ? addressed.filter((id) => !responders.includes(id)) : [];
    target = pool.length === 1 ? pool[0] : null;
  }
  if (target && !present_ids.includes(target)) target = null;
  return Object.freeze({ kind: c.kind, resolved: Boolean(target), target_id: target, question_text: last.residual_text ?? last.player_text, of_interaction: last.interaction_id, prior_responder_ids: [...responders] });
}
/**
 * The most recent canonical entity a knowledge question in THIS conversation was about (topic stack, newest
 * first), skipping meta turns ("How do you know that?"). Deterministic; never a guess across a topic change.
 */
function recentTopicEntity(discourse, entities = [], kinds = []) {
  for (const turn of [...(discourse?.turns ?? [])].reverse()) {
    if (turn.kind !== "player_exchange") continue;
    if (turn.meta || turn.awaiting_clarification || ["ask_explanation", "clarify_previous", "request_repetition", "acknowledge", "close_topic", "ambiguous_reference"].includes(turn.discourse_function)) continue;
    const key = turn.knowledge_key ?? null;
    const entity = key ? entities.find((e) => kinds.includes(e.kind) && key.endsWith(`:${e.id}`)) ?? null : null;
    return entity; // the latest substantive question fixes the topic (null = it was about something else)
  }
  return null;
}
/** The task the immediately preceding (single) line's authorized facts introduced, or null. */
function anchorTaskOfLastLine(discourse, entities = []) {
  const responses = discourse?.last_turn?.responses ?? [];
  if (!responses.length) return null;
  const line = responses.length === 1 ? responses[0] : responses.find((r) => (discourse?.active_thread?.member_ids ?? []).includes(r.speaker_id)) ?? null;
  const task = anchorEntities(line, entities).find((e) => e.kind === "task") ?? null;
  return task ? entities.find((e) => e.id === task.id) ?? null : null;
}
/** "What recording?" -- a bare noun question about a term the previous speaker's facts introduced. */
function anchoredNounQuestion(raw, discourse) {
  const noun = String(raw ?? "").trim().match(LP.bare_noun_question)?.[1]?.trim();
  if (!noun || LP.not_a_noun.test(noun)) return null;
  const words = (noun.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/s$/, ""));
  if (!words.length) return null;
  const last = discourse?.last_turn ?? null;
  for (const response of [...(last?.responses ?? [])].reverse()) {
    const terms = anchorTerms(response);
    if (words.some((w) => terms.some((t) => t === w || (t.length >= 5 && w.length >= 5 && t.slice(0, 5) === w.slice(0, 5))))) return Object.freeze({ speaker_ref: "you", span: noun, target: { interaction_id: last.interaction_id, speaker_id: response.speaker_id }, anchored: true });
  }
  return null;
}
/** An entity plus the entities that are the same assignment (the duffle IS the startup materials task). */
function withRelated(entity, entities = []) {
  if (!entity) return null;
  const related = [];
  for (const [task, pattern] of Object.entries(canonicalKnowledge.TASK_ITEMS)) {
    if (!pattern) continue;
    if (entity.id === `task:${task}`) related.push(...entities.filter((e) => e.kind === "equipment" && pattern.test(e.label ?? "")).map((e) => e.id));
    if (entity.kind === "equipment" && pattern.test(entity.label ?? "")) related.push(`task:${task}`);
  }
  return { ...entity, related_ids: [...new Set(related)] };
}
/**
 * The person a pronoun ("he", "his", "him") or a bare description refers to, by deterministic
 * conversational salience only: the person the immediately preceding question was about, else a person
 * who just spoke and left (Maxwell, when nothing has been said since the briefing ended). Never a guess.
 */
function salientPerson(discourse, entities = [], { description = null } = {}) {
  const last = discourse?.last_turn ?? null;
  const key = last?.knowledge_key ?? null;
  const fromTopic = key ? entities.find((e) => e.kind === "person" && !e.is_player && key.endsWith(`:${e.id}`)) ?? null : null;
  if (fromTopic) return { entity: fromTopic, basis: "prior_question_topic" };
  // Nothing said at this table since the briefing: its departed speaker is the salient person.
  const departed = entities.find((e) => e.kind === "person" && e.non_present && !e.world_only && e.title) ?? null;
  if (departed && !(discourse?.turns ?? []).length && (!description || /\b(?:doctor|guy|man|fellow|person)\b/i.test(description))) return { entity: departed, basis: "recent_departure" };
  return null;
}
const PERSON_PRONOUN = LP.person_pronoun;
const SCHEDULE_WORDS = LP.schedule_words;

/**
 * Tier 1 semantic knowledge intent: the question TYPE (by structure) and the canonical entity it is
 * about (resolved by code, present or not). Returns { fn, query, unresolved? } or null. Identity, role,
 * authority and relation to a person are distinct concepts; so are a definition and a current state.
 */
function semanticKnowledgeIntent(raw, { entities = [], addressee_ids = [], ownership = false, discourse = null } = {}) {
  const SI = LP.semantic_intents;
  const mentions = canonicalKnowledge.resolveEntityMentions(raw, entities);
  const first = (kinds) => mentions.find((m) => kinds.includes(m.kind)) ?? null;
  const query = (concept, entity = null, extra = {}) => ({ concept, entity: entity ? withRelated(entity, entities) : null, ...extra });
  const DEFINABLE = ["location", "entity", "institution", "procedure", "task", "equipment"];
  // A third person named or pointed at ("Maxwell", "he", "that doctor").
  const thirdPerson = () => {
    const named = mentions.find((m) => m.kind === "person" && !addressee_ids.includes(m.id) && !m.is_player);
    if (named) return { entity: named, basis: "named" };
    // Described by the event they took part in ("the guy who gave the talk"): the briefing's speaker.
    if (LP.briefing_person_description.test(raw)) { const speaker = entities.find((e) => e.kind === "person" && e.non_present && !e.world_only) ?? null; if (speaker) return { entity: speaker, basis: "described_event" }; }
    if (PERSON_PRONOUN.test(raw) || LP.departed_person_description.test(raw)) return salientPerson(discourse, entities, { description: raw });
    return null;
  };
  // What someone SAID (attributed, heard): speaker + topic, both resolved by code.
  const reported = reportedSpeechRequest(raw);
  if (reported) {
    const player = entities.find((e) => e.is_player) ?? null;
    let speaker = null;
    let unresolved = false;
    if (reported.speaker_ref === "i") speaker = player;
    else if (reported.speaker_ref && ["he", "she", "they"].includes(reported.speaker_ref)) { speaker = salientPerson(discourse, entities)?.entity ?? null; unresolved = !speaker; }
    else if (reported.speaker_ref) { speaker = canonicalKnowledge.resolveEntityMentions(reported.speaker_ref, entities).find((m) => m.kind === "person") ?? null; unresolved = !speaker; }
    const topicText = reported.topic_text ?? "";
    const topic = canonicalKnowledge.resolveEntityMentions(topicText, entities).find((m) => m.id !== speaker?.id && !m.is_player) ?? null;
    const schedule = !topic && SCHEDULE_WORDS.test(topicText);
    const procedure = !topic && !schedule && LP.procedure_words.test(topicText);
    return { fn: "ask_reported_speech", query: query("reported_speech", topic, { speaker_id: speaker?.id ?? null, speaker_label: speaker?.is_player ? "you" : (speaker?.label ?? null), ...(schedule ? { topic_concept: "schedule" } : procedure ? { topic_concept: "current_procedure" } : {}) }), unresolved };
  }
  // Presence is current (or recent) STATE of a person, not who they are.
  if (SI.person_presence.test(raw)) {
    const who = thirdPerson();
    if (who) return { fn: "ask_person_identity", query: query("person_presence", who.entity, { facet: /^(?:so,?\s+|and\s+|wait,?\s+)?was\b|\bwhere did\b|\bjust\b/i.test(raw) ? "recent_presence" : "current_presence", person_basis: who.basis }) };
  }
  const whereWeAre = String(raw).match(SI.where_we_are);
  if (whereWeAre) {
    const place = canonicalKnowledge.resolveEntityMentions(whereWeAre[1], entities).find((m) => ["entity", "location"].includes(m.kind)) ?? null;
    if (place) return { fn: "ask_entity_definition", query: query("entity_state", place) };
  }
  // Facets beyond a definition (origin, mechanism, contents, destination, who delivers, institutional history).
  const facetOf = [["origin", SI.facet_origin], ["mechanism", SI.facet_mechanism], ["contents", SI.facet_contents], ["destination", SI.facet_destination], ["custody", SI.facet_custody], ["history", SI.facet_history]].find(([, pattern]) => pattern.test(raw))?.[0] ?? null;
  if (facetOf) {
    let thing = first(DEFINABLE);
    if (!thing && /\b(?:it|that|this|they|them|those|these|there)\b/i.test(raw)) thing = anchorEntities((discourse?.last_turn?.responses ?? []).at(-1), entities)[0] ?? recentTopicEntity(discourse, entities, DEFINABLE);
    // A plural pronoun ("them", "those") never picks up a singular topic ("the Threshold"), and cargo facets
    // (contents, destination, who delivers) apply only to things that are carried.
    if (thing && !first(DEFINABLE) && /\b(?:they|them|those|these)\b/i.test(raw) && !/s$/i.test(String(thing.label ?? ""))) thing = null;
    if (thing && ["contents", "destination", "custody"].includes(facetOf) && !["task", "equipment"].includes(thing.kind)) thing = null;
    if (facetOf === "history") return { fn: "ask_institution_purpose", query: query("institution_purpose", mentions.find((m) => m.id === "async") ?? entities.find((e) => e.id === "async") ?? null, { facet: "history" }) };
    // Who has a piece of EQUIPMENT is custody (its holder), not what the assignment is for.
    if (facetOf === "custody" && thing?.kind === "equipment") return null;
    if (thing) {
      const itemLike = ["task", "equipment"].includes(thing.kind);
      return { fn: itemLike ? "ask_assignment_purpose" : "ask_entity_definition", query: query(itemLike ? "assignment_purpose" : "entity_definition", thing, { facet: facetOf }) };
    }
    if (["contents", "destination", "custody"].includes(facetOf)) return { fn: "ask_assignment_purpose", query: query("assignment_purpose", null, { facet: facetOf }), unresolved: true };
  }
  if (SI.location_purpose.test(raw)) {
    const place = first(["location"]) ?? entities.find((e) => e.id === "async-briefing-room") ?? null;
    return { fn: "ask_location_purpose", query: query("location_purpose", place) };
  }
  if (SI.current_action.test(raw) && !mentions.some((m) => m.kind === "person" && !addressee_ids.includes(m.id))) return { fn: "ask_current_action", query: query("current_action", null, { subject: "addressee" }) };
  if (SI.person_authority.test(raw)) {
    const who = thirdPerson();
    const command = LP.command_words.test(raw);
    if (!who && !command) return { fn: "ask_person_identity", query: query("person_authority", null), unresolved: true };
    return { fn: "ask_person_identity", query: query("person_authority", who?.entity ?? null, { ...(command ? { facet: "command" } : {}), ...(who ? { person_basis: who.basis } : {}) }) };
  }
  if (SI.person_relation.test(raw)) {
    const who = thirdPerson();
    if (!who && PERSON_PRONOUN.test(raw)) return { fn: "ask_person_identity", query: query("person_relation", null), unresolved: true };
    if (who && !who.entity.non_present && !who.entity.world_only) return { fn: "ask_personal_experience", query: null };
    if (who) return { fn: "ask_person_identity", query: query("person_relation", who.entity, { person_basis: who.basis }) };
  }
  if (SI.person_role.test(raw)) {
    const who = thirdPerson();
    if (who?.entity && !who.entity.non_present) return { fn: "ask_role_or_assignment", query: query("role_or_assignment", who.entity, { subject: "other" }) };
    if (who?.entity) return { fn: "ask_person_identity", query: query("person_role", who.entity, { person_basis: who.basis }) };
    if (PERSON_PRONOUN.test(raw)) return { fn: "ask_person_identity", query: query("person_role", null), unresolved: true };
  }
  if (SI.entity_state.test(raw)) {
    const thing = first(["entity", "location", "procedure"]);
    if (thing) return { fn: "ask_entity_definition", query: query("entity_state", thing) };
  }
  if (SI.mechanism.test(raw)) {
    let thing = first(DEFINABLE);
    if (!thing && /\b(?:it|that|this)\b/i.test(raw)) thing = (discourse?.last_turn?.knowledge_key ? entities.find((e) => DEFINABLE.includes(e.kind) && discourse.last_turn.knowledge_key.endsWith(`:${e.id}`)) : null) ?? null;
    if (thing) return { fn: "ask_entity_definition", query: query("entity_definition", thing, { facet: "mechanism" }) };
  }
  if (SI.institution_purpose.test(raw)) return { fn: "ask_institution_purpose", query: query("institution_purpose", mentions.find((m) => m.id === "async") ?? null) };
  if (SI.mission_objective.test(raw)) return { fn: "ask_mission_objective", query: query("mission_objective") };
  if (SI.assignment_purpose.test(raw)) {
    let entity = first(["task", "equipment"]);
    // "What are those for?": the thing the previous speaker's authorized line introduced.
    if (!entity && /\b(?:those|that|these|this|them|it|they)\b/i.test(raw)) {
      entity = anchorEntities((discourse?.last_turn?.responses ?? []).at(-1), entities).find((e) => ["task", "equipment"].includes(e.kind)) ?? recentTopicEntity(discourse, entities, ["task", "equipment"]);
      // A plural pronoun never attaches to a singular thing.
      if (entity && /\b(?:they|them|those|these)\b/i.test(raw) && !/s$/i.test(String(entity.label ?? ""))) entity = null;
    }
    return { fn: "ask_assignment_purpose", query: query("assignment_purpose", entity), unresolved: !entity };
  }
  if (SI.role_or_assignment.test(raw)) {
    const person = mentions.find((m) => m.kind === "person" && !addressee_ids.includes(m.id) && !m.is_player);
    if (/\bmy\b/i.test(raw)) return { fn: "ask_role_or_assignment", query: query("role_or_assignment", mentions.find((m) => m.is_player) ?? entities.find((e) => e.is_player) ?? null, { subject: "player" }) };
    if (person) return person.non_present ? { fn: "ask_person_identity", query: query("person_role", person) } : { fn: "ask_role_or_assignment", query: query("role_or_assignment", person, { subject: "other" }) };
    return { fn: "ask_role_or_assignment", query: query("role_or_assignment", null, { subject: "addressee" }) };
  }
  if (!ownership && SI.person_identity.test(raw)) {
    let person = first(["person"]);
    let basis = person ? "named" : null;
    // "Who was that doctor who briefed us?": the event named in the question identifies him.
    if (!person && LP.briefing_person_description.test(raw)) { person = entities.find((e) => e.kind === "person" && e.non_present && !e.world_only) ?? null; basis = "described_event"; }
    // "Who was that doctor?": the person who just spoke and left, when nothing else is salient.
    if (!person && LP.departed_person_description.test(raw)) { const salient = salientPerson(discourse, entities, { description: raw }); if (salient) { person = salient.entity; basis = salient.basis; } }
    if (person) return { fn: "ask_person_identity", query: query("person_identity", person, { person_basis: basis }) };
    const place = first(["location", "entity", "institution"]);
    if (place) return { fn: "ask_entity_definition", query: query("entity_definition", place) };
    const name = String(raw).match(LP.who_is_name)?.[1];
    if (name && !["You", "I", "He", "She", "That", "This", "It", "There", "They", "We"].includes(name)) return { fn: "ask_person_identity", query: query("person_identity", { id: null, kind: "person", label: name, unknown: true }) };
    // "Who was that doctor?": more than one canonical person fits and nothing makes one salient; ask which.
    if (LP.person_description.test(raw)) return { fn: "ask_person_identity", query: query("person_identity", null), unresolved: true };
    return null;
  }
  // "What does Standard mean?" / "What's LOCAL?" / "What is the verbal record?": a definition.
  const meansWhat = String(raw).match(LP.means_what);
  if (meansWhat && !LP.pronoun_term.test(meansWhat[1].trim())) {
    const thing = canonicalKnowledge.resolveEntityMentions(meansWhat[1], entities).find((m) => DEFINABLE.includes(m.kind)) ?? null;
    if (thing) return { fn: "ask_entity_definition", query: query("entity_definition", thing) };
  }
  if (SI.entity_definition.test(raw)) {
    const place = first(DEFINABLE);
    // "Where is local?" asks a LOCATION: only a place answers it (a comms term is not somewhere).
    if (place && LP.where_question.test(raw) && place.kind !== "location") return null;
    if (place) return { fn: "ask_entity_definition", query: query("entity_definition", place) };
  }
  return null;
}
// Bounded advisory intents -> discourse functions (Tier 2). Advice classifies LANGUAGE only.
const ADVISORY_INTENT_FUNCTIONS = Object.freeze({
  self_description: "invite_self_description", role_or_assignment: "ask_role_or_assignment", institution_purpose: "ask_institution_purpose", mission_objective: "ask_mission_objective", next_step: "ask_next_step", person_identity: "ask_person_identity", person_role: "ask_person_identity", person_authority: "ask_person_identity", person_relation: "ask_person_identity", assignment_purpose: "ask_assignment_purpose", entity_definition: "ask_entity_definition", reported_speech: "ask_reported_speech", current_action: "ask_current_action", location_purpose: "ask_location_purpose", item_ownership: "ask_item_ownership", personal_experience: "ask_personal_experience", self_state: "check_in", opinion: "ask_opinion", explanation: "ask_explanation", social_statement: "make_statement", greeting: "greet", request: "make_request", factual_other: "ask_factual", unclear: "ambiguous_reference"
});
const ADVISORY_CONCEPTS = Object.freeze({ person_role: "person_role", person_authority: "person_authority", person_relation: "person_relation" });
/**
 * The CLOSED set of things the previous line was authorized to say (its facts), as numbered labels an
 * advisory reading may choose among. Model wording never adds a candidate.
 */
function anchorCandidates(discourse) {
  const last = discourse?.last_turn ?? null;
  const responses = last?.responses ?? [];
  const line = responses.length === 1 ? responses[0] : responses.find((r) => (discourse?.active_thread?.member_ids ?? []).includes(r.speaker_id)) ?? responses.at(-1) ?? null;
  if (!line?.facts) return [];
  const out = [];
  for (const f of [...(line.facts.required ?? []), ...(line.facts.optional ?? [])]) {
    if (NON_ANCHOR_FACTS.has(f.key)) continue;
    const label = typeof f.value === "string" ? f.value : Array.isArray(f.value) ? f.value.filter((v) => typeof v === "string").join(", ") : (f.value && typeof f.value === "object" ? (f.value.about ?? f.value.label ?? null) : null);
    if (label && !out.some((o) => o.label === label)) out.push({ label: String(label).slice(0, 80), key: f.key, speaker_id: line.speaker_id, interaction_id: last.interaction_id });
  }
  return out.slice(0, 6);
}
/** Map a validated advisory frame onto a discourse function; every entity is resolved by code. */
function applyAdvice(advice, { entities = [], raw = "", addressee_ids = [], discourse = null } = {}) {
  // A closed-set anchor choice: the line asks about one of the previous line's authorized facts.
  if (advice?.anchor_candidate) {
    const candidate = anchorCandidates(discourse)[advice.anchor_candidate - 1] ?? null;
    if (candidate) return { fn: "ask_meaning", query: null, meaning: Object.freeze({ speaker_ref: "you", span: candidate.label, target: { interaction_id: candidate.interaction_id, speaker_id: candidate.speaker_id }, anchored: true, via: "advisory_anchor" }) };
  }
  const fn = ADVISORY_INTENT_FUNCTIONS[advice?.intent];
  if (!fn) return null;
  const concept = ADVISORY_CONCEPTS[advice.intent] ?? KNOWLEDGE_FUNCTIONS[fn] ?? (fn === "ask_role_or_assignment" ? "role_or_assignment" : null);
  if (!concept) return { fn, query: null, unresolved: fn === "ambiguous_reference" };
  const text = advice.referent_text ?? "";
  let entity = text ? (canonicalKnowledge.resolveEntityMentions(text, entities)[0] ?? null) : null;
  // The span named nothing canonical: the one canonical entity the player's line itself names, if unique.
  if (!entity && text) { const named = canonicalKnowledge.resolveEntityMentions(raw, entities).filter((e) => !e.is_player); if (named.length === 1) entity = named[0]; }
  if (fn === "ask_reported_speech") {
    const speaker = entity?.kind === "person" ? entity : null;
    return { fn, query: { concept, entity: null, speaker_id: speaker?.id ?? null, speaker_label: speaker?.label ?? null }, unresolved: !speaker };
  }
  if (fn === "ask_current_action" || fn === "ask_location_purpose") return { fn, query: { concept, entity: fn === "ask_location_purpose" ? (entity ?? entities.find((e) => e.id === "async-briefing-room") ?? null) : null, ...(fn === "ask_current_action" ? { subject: "addressee" } : {}) } };
  if (fn === "ask_role_or_assignment" && (!entity || addressee_ids.includes(entity.id))) return { fn, query: { concept, entity: null, subject: "addressee" } };
  if (fn === "ask_person_identity" && !entity && /^[A-Z][a-z]+$/.test(text.trim())) return { fn, query: { concept, entity: { id: null, kind: "person", label: text.trim(), unknown: true } } };
  // Code decides what the resolved entity can be asked: a person-intent about a place is a definition
  // question; a purpose/definition-intent about a person is a role question. (The model typed language only.)
  if (entity && ["person_identity", "person_role", "person_authority", "person_relation"].includes(concept) && entity.kind !== "person") {
    return ["location", "entity", "institution", "procedure", "task", "equipment"].includes(entity.kind) ? { fn: "ask_entity_definition", query: { concept: "entity_definition", entity: withRelated(entity, entities) } } : { fn: "ambiguous_reference", query: null, unresolved: true };
  }
  if (entity?.kind === "person" && ["assignment_purpose", "entity_definition"].includes(concept)) {
    return entity.non_present || entity.world_only ? { fn: "ask_person_identity", query: { concept: "person_role", entity: withRelated(entity, entities) } } : { fn: "ask_role_or_assignment", query: { concept: "role_or_assignment", entity: withRelated(entity, entities), subject: addressee_ids.includes(entity.id) ? "addressee" : "other" } };
  }
  const needsEntity = ["ask_person_identity", "ask_assignment_purpose", "ask_entity_definition"].includes(fn) && !(concept === "person_authority" && !text);
  const anchoredEntity = !entity && fn === "ask_assignment_purpose" ? anchorEntities((discourse?.last_turn?.responses ?? []).at(-1), entities)[0] ?? null : null;
  const resolved = entity ?? anchoredEntity;
  return { fn: fn === "ask_role_or_assignment" && entity?.non_present ? "ask_person_identity" : fn, query: { concept: fn === "ask_role_or_assignment" && entity?.non_present ? "person_role" : concept, entity: resolved ? withRelated(resolved, entities) : null }, unresolved: needsEntity && !resolved };
}

// ─── 4. Semantic frame ──────────────────────────────────────────────────────
/**
 * Deterministic frame for the RESIDUAL utterance (named address already
 * stripped by the caller). `discourse` may be null (context-free classification).
 */
function buildSemanticFrame({ text, recipient_type = "none", interpretation = null, discourse = null, equipment = {}, scope_inherited = false, spatial_selection = null, temporal_anchors = null, now = null, people = [], addressee_ids = [], slot_constraint = null, entities = [], advice = null, correction = null } = {}) {
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
      const reframed = buildSemanticFrame({ text: earlier.question, recipient_type, discourse: { ...(discourse ?? {}), pending_question: null, last_question: null }, equipment, scope_inherited, spatial_selection, temporal_anchors, now, people, addressee_ids, entities });
      return Object.freeze({ ...reframed, topic_return: { topic: earlier.topic, question: earlier.question }, resolved_utterance: earlier.question });
    }
  }

  // ── An ANSWER TO AN OPEN QUESTION outranks a fresh reading of the words (a bare "Just now." or "By the
  // table." is not a new statement, and "table" is not a group). The open question records the kind of
  // answer it expects; a matching fragment resumes the question with that constraint.
  const pendingQ = slot_constraint ? null : (discourse?.pending_question ?? null);
  const slotAnswer = pendingQ ? matchOpenQuestionSlot(raw, pendingQ, { equipment, people, discourse, spatial_selection }) : null;
  const resumedFrom = (q) => ({ player_text: q.player_text, interaction_id: q.interaction_id, responder_ids: [...(q.responder_ids ?? [])], question_id: q.question_id ?? null, expected_slot: q.expected_slot ?? null });
  const reframeWith = (question, extra = {}) => buildSemanticFrame({ text: question, recipient_type, discourse: { ...(discourse ?? {}), pending_question: null, last_question: null }, equipment, scope_inherited, spatial_selection, temporal_anchors, now, people, addressee_ids, entities, ...extra });
  if (slotAnswer && pendingQ.player_text && slotAnswer.slot === "temporal") {
    // "When do you mean?" -> "Just now." / "When I greeted Ava and Josephine.": the SAME question, now
    // anchored to that time or conversational event.
    // The supplied time is resolved against the same canonical anchors as any temporal expression.
    const anchored = LP.temporal_reference.test(slotAnswer.text) ? resolveTemporalReference({ text: slotAnswer.text, anchors: temporal_anchors, now, discourse }) : null;
    const answer = Object.freeze({ ...slotAnswer, temporal: anchored ?? slotAnswer.temporal });
    const reframed = reframeWith(pendingQ.player_text, { slot_constraint: answer });
    return Object.freeze({ ...reframed, resolved_utterance: pendingQ.player_text, resumed_question: resumedFrom(pendingQ), slot_answer: answer, open_question: openQuestionRef(pendingQ) });
  }
  if (slotAnswer && pendingQ.player_text && slotAnswer.slot === "location") {
    // "Where?" -> "By the table.": the answer replaces the unresolved place in the question.
    const core = raw.replace(LP.repair_lead, "").replace(/[.!?\s]+$/, "").trim();
    const base = String(pendingQ.player_text).replace(/[?.!\s]+$/, "");
    const combined = /\b(?:over )?there\b/i.test(base) ? base.replace(/\b(?:over )?there\b/i, core) : `${base} ${core}`;
    const reframed = reframeWith(`${combined}${/\?\s*$/.test(pendingQ.player_text) ? "?" : "."}`);
    return Object.freeze({ ...reframed, resolved_utterance: combined, resumed_question: resumedFrom(pendingQ), slot_answer: slotAnswer, open_question: openQuestionRef(pendingQ) });
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

  // "What do you mean by 'staying with'?": the meaning of an earlier LINE (quotation / phrase / speaker).
  let knowledgeIntent = null;
  // Tier 1 could only give the utterance a GENERIC reading (an untyped question/statement): the bounded
  // advisory interpreter may classify its language; code still resolves every entity and fact.
  let tier1Generic = false;
  let knowledgeQuery = null;
  let interpretationSource = "deterministic";
  // "What recording?" / "Which record?": a bare noun question about a term the previous speaker's
  // authorized facts introduced is a question about that line's meaning (semantic anchor), not trivia.
  const anchored = anchoredNounQuestion(raw, discourse);
  const meaning = meaningRequest(raw) ?? anchored;
  // "What does that mean?" right after a line whose AUTHORIZED facts introduced a task: the task's
  // definition (its purpose), from the speaker's knowledge -- not a restatement of the line.
  const thatMeaning = !meaning && LP.that_means.test(raw) ? anchorTaskOfLastLine(discourse, entities) : null;
  // An unresolved correction of the conversational target ("No, the other one." when two are possible).
  if (correction && !correction.resolved) { fn = "ambiguous_reference"; unresolved = true; }
  else if (thatMeaning) { fn = "ask_entity_definition"; knowledgeQuery = { concept: "entity_definition", entity: withRelated(thatMeaning, entities) }; }
  else if (meaning) fn = "ask_meaning";
  // "Why didn't you answer me?": a recent conversational EVENT (who answered, who stayed silent).
  else if (LP.response_event.test(raw)) fn = "ask_response_event";
  else if (LP.explanation_request.test(raw) || LP.bare_wh_followup.test(raw)) fn = "ask_explanation";
  else if (LP.bare_reaction.test(raw)) fn = "clarify_previous";
  else if (LP.repetition_request.test(raw)) fn = "request_repetition";
  else if (LP.heard_confirmation.test(raw)) fn = "ask_heard_confirmation";
  else if (LP.opinion_question.test(raw)) fn = "ask_opinion";
  else if (LP.personal_experience.test(raw) && !ownership && !LP.past_perception.test(raw)) fn = "ask_personal_experience";
  // "What are we doing today?" asks today's objective, not only the next step.
  else if (LP.semantic_intents.mission_objective.test(raw)) { fn = "ask_mission_objective"; knowledgeQuery = { concept: "mission_objective", entity: null }; }
  else if (LP.next_step.test(raw) || LP.semantic_intents.next_step.test(raw)) fn = "ask_next_step";
  else if ((knowledgeIntent = semanticKnowledgeIntent(raw, { entities, addressee_ids, ownership, discourse }))) { fn = knowledgeIntent.fn; knowledgeQuery = knowledgeIntent.query; }
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
      case "factual_question": case "group_question": fn = "ask_factual"; tier1Generic = true; break;
      case "request": fn = "make_request"; break;
      case "statement": fn = "make_statement"; tier1Generic = isQuestion; break;
      default: fn = "ambiguous_reference"; unresolved = true; tier1Generic = true;
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
  const fragmentAnswer = slotAnswer && ["referent", "topic", "spatial_selection", "person"].includes(slotAnswer.slot) && !["ask_meaning", "ask_response_event"].includes(fn);
  if (pending && ((!isQuestion && raw.split(/\s+/).length <= 6 && ["make_statement", "acknowledge", "make_request", "ambiguous_reference"].includes(fn)) || fragmentAnswer)) {
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
      resumed = resumedFrom(pending);
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
    const reframed = reframeWith(combined);
    if (!["make_statement", "acknowledge"].includes(reframed.discourse_function)) {
      return Object.freeze({ ...reframed, resolved_utterance: combined, resumed_question: resumedFrom(repairTarget), ...(slotAnswer ? { slot_answer: slotAnswer, open_question: openQuestionRef(repairTarget) } : {}) });
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
  let temporal = LP.temporal_reference.test(raw) ? resolveTemporalReference({ text: raw, anchors: temporal_anchors, now, discourse }) : null;

  // ── Recent conversational event ("Why didn't you answer me?"): which exchange is meant, from the event
  // log only. The event named in the question ("until I addressed you directly") is its time anchor; an
  // answer to "When do you mean?" supplies it.
  let eventReference = null;
  if (fn === "ask_response_event") {
    eventReference = responseEventReference({ text: raw, discourse, addressee_ids, people, slot_constraint });
    if (!eventReference.resolved) unresolved = true;
    if (temporal && (eventReference.explicit || slot_constraint)) temporal = Object.freeze({ expression: temporal.expression, kind: "conversation_event", resolved: eventReference.resolved, anchor: "conversation_event", window: null });
  } else if (slot_constraint?.slot === "temporal") {
    // A supplied time answers the question's unresolved time.
    const supplied = slot_constraint.temporal ?? (slot_constraint.event?.turn ? { expression: slot_constraint.text, kind: "conversation_event", resolved: true, anchor: "conversation_event", window: null } : null);
    if (supplied) temporal = Object.freeze({ ...supplied });
  }
  if (knowledgeIntent?.unresolved) unresolved = true;
  // A generic reading that referents, time or perception already typed is not generic.
  if (tier1Generic && (referents.length || temporal || LP.past_perception.test(raw) || resumed)) tier1Generic = false;
  // ── Tier 2: an accepted advisory frame (validated upstream, persisted with the turn) re-types ONLY a
  // generic Tier 1 reading. It never overrides a confident deterministic frame, and it names no fact.
  let adviceApplied = null;
  let advisoryMeaning = null;
  if (tier1Generic && advice?.accepted) {
    const mapped = applyAdvice(advice, { entities, raw, addressee_ids, discourse });
    if (mapped) { fn = mapped.fn; knowledgeQuery = mapped.query ?? knowledgeQuery; unresolved = Boolean(mapped.unresolved); interpretationSource = "advisory"; adviceApplied = { intent: advice.intent, confidence: advice.confidence, ...(advice.anchor_candidate ? { anchor_candidate: advice.anchor_candidate } : {}) }; if (mapped.meaning) advisoryMeaning = mapped.meaning; }
  }
  // ── Earlier wording ("What do you mean by 'staying with'?"): the exact prior LINE, from what the player
  // heard or said; the line's own authorized facts say what it meant. Hidden speech is never searched.
  const utteranceReference = fn === "ask_meaning" && (meaning || advisoryMeaning) ? resolveUtteranceReference({ ...(meaning ?? advisoryMeaning), discourse, addressee_ids, people }) : null;
  if (utteranceReference && !utteranceReference.resolved) unresolved = true;
  // Doctrine 7.26: a question the parser could not type that names a canonical entity is a PARSE limit,
  // not the character's ignorance -- without an accepted advisory reading it is clarified, never "I don't know".
  const tier1WasGeneric = tier1Generic;
  if (tier1Generic && interpretationSource === "deterministic" && isQuestion && canonicalKnowledge.resolveEntityMentions(raw, entities).some((e) => e.kind !== "equipment")) { fn = "ambiguous_reference"; unresolved = true; }
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
    addressee_state: (question_form_yes_no(raw) && /\byou(?:'re| are)?\b/i.test(raw) || /^(?:all set|ready|good to go)\b/i.test(raw) || /^(?:(?:is|are)\s+)?(?:everybody|everyone|you all|y'?all|you guys|you two|both of you)\s+(?:ready|all set|set|good to go)\b/i.test(raw)) && LP.addressee_readiness.test(raw) && !LP.not_momentary_state.test(raw),
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
    // Which tier typed this utterance, and whether Tier 1 left it generic (advisory candidate).
    interpretation_source: interpretationSource,
    tier1_generic: tier1WasGeneric && interpretationSource === "deterministic",
    advice: adviceApplied,
    // The canonical knowledge concept (and entity, resolved by code) a knowledge question asks.
    knowledge_query: knowledgeQuery ? { concept: knowledgeQuery.concept, entity: knowledgeQuery.entity ? { id: knowledgeQuery.entity.id, kind: knowledgeQuery.entity.kind, label: knowledgeQuery.entity.label, ...(knowledgeQuery.entity.unknown ? { unknown: true } : {}), ...(knowledgeQuery.entity.non_present ? { non_present: true } : {}), ...(knowledgeQuery.entity.world_only ? { world_only: true } : {}), ...(knowledgeQuery.entity.related_ids?.length ? { related_ids: knowledgeQuery.entity.related_ids } : {}) } : null, ...(knowledgeQuery.subject ? { subject: knowledgeQuery.subject } : {}), ...(knowledgeQuery.facet ? { facet: knowledgeQuery.facet } : {}), ...(knowledgeQuery.speaker_id !== undefined ? { speaker_id: knowledgeQuery.speaker_id, speaker_label: knowledgeQuery.speaker_label ?? null } : {}), ...(knowledgeQuery.topic_concept ? { topic_concept: knowledgeQuery.topic_concept } : {}), ...(knowledgeQuery.person_basis ? { person_basis: knowledgeQuery.person_basis } : {}) } : null,
    // The semantic intent (the concept actually asked: identity vs role vs authority vs relation, etc.).
    semantic_intent: knowledgeQuery?.concept ?? null,
    // A statement asserting something about the world: the player's CLAIM, heard and remembered as theirs,
    // never canonical truth (listeners do not confirm it).
    player_claim: fn === "make_statement" && !isQuestion && canonicalKnowledge.resolveEntityMentions(raw, entities).some((e) => !e.is_player) && LP.claim_predicate.test(raw) && !LP.self_statement_lead.test(raw) ? { status: "player_claim", entity_ids: canonicalKnowledge.resolveEntityMentions(raw, entities).filter((e) => !e.is_player).map((e) => e.id) } : null,
    // "Who had the camera earlier?": custody at an earlier time (the actor's own snapshots), never current.
    custody_time: fn === "ask_item_ownership" && LP.custody_past.test(raw) && LP.custody_earlier.test(raw) ? "historical" : (fn === "ask_item_ownership" ? "current" : null),
    // A correction of the previous line's conversational target (never of identity facts).
    correction: correction ? { kind: correction.kind, resolved: Boolean(correction.resolved), of_interaction: correction.of_interaction ?? null } : null,
    // The line whose meaning is asked about, and the conversational event asked about.
    utterance_reference: utteranceReference,
    event_reference: eventReference,
    // The open question this line answers (with the answer's slot), when it answers one.
    slot_answer: slotAnswer ?? null,
    open_question: slotAnswer && pendingQ ? openQuestionRef(pendingQ) : null,
    // "I left it over there": an unresolved PLACE (answered by a location), not an unresolved thing.
    ambiguous_place: fn === "ambiguous_reference" && /\b(?:over )?there\b/i.test(raw) && !/\bthing\b/i.test(raw),
    // "What's next (for the day)?": the span of procedure asked about, when stated.
    procedure_scope: fn === "ask_next_step" ? (/\b(?:for (?:the day|today)|today|this morning)\b/i.test(raw) ? "day" : "current") : null,
    // The utterance actually framed (a repair fragment combined with the question it narrows).
    resolved_utterance: null,
    tone: interp.tone,
    confidence: interp.confidence,
    unresolved_reference: unresolved
  };

  // A fragment that answered an open question but resumed nothing more specific ("Because I saw it.")
  // is still an answer to it: the one who asked hears it as such.
  if (slotAnswer && !frame.resumed_question) frame.resumed_question = resumedFrom(pendingQ);
  frame.antecedent = resolveAntecedent({ discourse_function: fn, discourse, referents, utterance_reference: utteranceReference, event_reference: eventReference });
  if (!frame.antecedent.resolved && ["clarify_previous", "request_repetition", "ask_heard_confirmation", "ask_explanation", "ask_meaning", "ask_response_event"].includes(fn)) {
    // Nothing to clarify or repeat: never guess. Degrade to a clarification request.
    frame.unresolved_reference = true;
    frame.expected_response_shape = EXPECTED_SHAPES.ambiguous_reference;
  }
  // What an answer to THIS turn's clarification (if it asks one) would have to supply.
  frame.expected_slot = clarificationSlot(frame);
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
  // Worded as the authored roster call assigns it ("observation and verbal recall"); "verbal record" was a
  // presentation drift from the source.
  "verbal-recall": "handling observation and verbal recall",
  "material-delivery": "delivering the startup materials",
  "layout-compilation": "compiling the layout record"
});

/**
 * Renders a canonical task/assignment into a bounded player-safe phrase, or
 * null. Never exposes ids, state names or raw object structure. `names` maps
 * personnel ids to spoken names ("you" for the player); `equipment` is the
 * canonical equipment map used only to name an operated item.
 */
function presentAssignment(args = {}) {
  return assignmentSemantics(args)?.phrase ?? null;
}

/**
 * The structured MEANING of a coworker's current assignment (what "what do you mean by ..." explains),
 * and its phrase. Precedence: an explicitly ordered task, then the assigned primary task, then the
 * team runtime's DEFAULT posture. The default posture ({type: "follow", target: player} with no order,
 * intent "maintain team contact") is how every coworker moves with the lead; it is not an assignment and
 * never masks the task they were assigned. Its phrase is literal ("following you"): the listener IS the
 * expedition lead, and "staying with" read as living/lodging with someone.
 */
function assignmentSemantics({ task = null, primary_task = null, names = {}, equipment = {}, player_id = null } = {}) {
  const defaultPosture = Boolean(task && typeof task === "object" && task.type === "follow" && !task.order_id);
  const fromTask = (() => {
    if (typeof task === "string") {
      if (task.trim() && !INTERNAL_ID.test(task) && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(task.trim())) return { source: "stated", phrase: sentence(task) };
      return PRIMARY_TASK_PHRASES[task.trim()] ? { source: "assigned_task", task: task.trim(), phrase: PRIMARY_TASK_PHRASES[task.trim()] } : null;
    }
    if (!task || typeof task !== "object" || !["active", "pending"].includes(task.state ?? "active")) return null;
    const source = task.order_id ? "order" : (defaultPosture ? "team_posture" : "task");
    switch (task.type) {
      case "follow": {
        const toLead = !task.target || task.target === player_id || names[task.target] === "you";
        if (toLead) return { source, task_type: "follow", target: "you", phrase: task.target || names[task.target] === "you" ? "following you" : "keeping with the team", gloss: task.target || names[task.target] === "you" ? "moving with you and keeping in contact with you" : "moving with the team" };
        return names[task.target] ? { source, task_type: "follow", target: names[task.target], phrase: `following ${names[task.target]}`, gloss: `moving with ${names[task.target]} and keeping in contact with them` } : { source, task_type: "follow", target: "the team", phrase: "keeping with the team", gloss: "moving with the team" };
      }
      case "wait": return { source, task_type: "wait", phrase: "waiting here" };
      case "hold": return { source, task_type: "hold", phrase: "holding position" };
      case "assist": return { source, task_type: "assist", phrase: "assisting a teammate" };
      case "operate": {
        const item = Object.values(equipment ?? {}).find((entry) => entry?.id === task.target || entry?.instance_id === task.target) ?? equipment?.[task.target] ?? null;
        return item?.label ? { source, task_type: "operate", phrase: `operating the ${String(item.label).toLowerCase()}` } : null;
      }
      default: return null;
    }
  })();
  const fromPrimary = (() => {
    if (typeof primary_task !== "string" || !primary_task.trim()) return null;
    const slug = primary_task.trim();
    if (PRIMARY_TASK_PHRASES[slug]) return { source: "assigned_task", task: slug, phrase: PRIMARY_TASK_PHRASES[slug] };
    return !INTERNAL_ID.test(slug) && !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug) ? { source: "assigned_task", phrase: sentence(slug) } : null;
  })();
  const chosen = fromTask && !defaultPosture ? fromTask : (fromPrimary ?? fromTask);
  return chosen ? Object.freeze({ ...chosen, gloss: chosen.gloss ?? (chosen.source === "assigned_task" ? `the task I was assigned: ${chosen.phrase}` : chosen.phrase) }) : null;
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

function buildSelfKnowledge({ person = null, member = null, task = null, held_equipment = [], relationships = [], known_facts = [], known_answer = null, names = {}, equipment = {}, player_id = null, custody_known = {}, custody_basis = {}, self_state = null, procedure = null } = {}) {
  const source = person ?? member ?? {};
  const substrate = source.identity_substrate ?? null;
  return Object.freeze({
    name: source.first_name ?? source.display_name ?? member?.first_name ?? member?.display_name ?? null,
    role: source.role ?? member?.role ?? null,
    current_assignment: presentAssignment({ task, primary_task: source.primary_task ?? member?.primary_task ?? null, names, equipment, player_id }),
    // What that assignment MEANS (never model-facing as such; it answers "what do you mean by ...").
    assignment_semantics: assignmentSemantics({ task, primary_task: source.primary_task ?? member?.primary_task ?? null, names, equipment, player_id }),
    current_activity: typeof (source.current_activity ?? member?.current_activity) === "string" ? presentAssignment({ task: source.current_activity ?? member.current_activity }) : null,
    held_equipment: held_equipment.map((item) => (typeof item === "string" ? item : item?.label ?? item?.id)).filter(Boolean),
    prior_expedition_experience: source.prior_expedition_experience ?? null,
    identity_style: pick(substrate, IDENTITY_STYLE_KEYS),
    identity_facts: pick(substrate, PLAN_AUTHORIZABLE_IDENTITY_FACTS),
    established_relationships: relationships.slice(0, 3),
    known_answer,
    // equipment id -> whether THIS speaker can know its holder (observer authority).
    custody_known: { ...custody_known },
    // equipment id -> how this speaker knows its holder ("briefing" | "self" | "seen" | "seen_earlier" | "record").
    custody_basis: { ...custody_basis },
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
const SOCIAL_FUNCTIONS = new Set(["attend", "greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "check_in", "close_topic", "clarify_previous", "request_repetition", "ambiguous_reference", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience", "ask_heard_confirmation", "ask_meaning", "ask_response_event"]);

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
  make_statement: "react briefly to what they said, the way a coworker would; ask them nothing and bring up nothing new",
  ask_heard_confirmation: "confirm plainly that you heard what they just said; you may briefly acknowledge what they said but add no interpretation, urgency, motive or action, and do not ask whether anyone heard you",
  ask_next_step: "state the current next step exactly as supplied; if none is supplied, ask what they mean; do not invent a plan",
  ask_explanation: "explain your previous line using only the supplied basis; do not invent a reason, experience, danger or plan",
  ask_opinion: "give your own view only as supplied; with no view supplied, say you have no particular opinion yet, without inventing one",
  ask_meaning: "say what your earlier line meant using only the supplied meaning; if it was someone else's line, say they would have to explain it; add nothing new",
  ask_institution_purpose: "say what you know about what this work is for, using only the supplied known facts; if none are supplied, say plainly you haven't been told",
  ask_mission_objective: "say what you know about today's assignment, using only the supplied known facts; if none are supplied, say plainly you haven't been told",
  ask_person_identity: "say who that person is using only the supplied known facts; if none are supplied, say plainly you don't know",
  ask_assignment_purpose: "say what that assignment or item is for using only the supplied known facts; if none are supplied, say plainly you haven't been told",
  ask_entity_definition: "say what you know about that place or thing using only the supplied known facts; if none are supplied, say plainly you haven't been told",
  ask_reported_speech: "say what that person said, attributed to them, using only the supplied reported claims; do not confirm, correct or add to it; if you did not hear it, say so",
  ask_current_action: "say what you are doing right now using only the supplied fact; add nothing",
  ask_location_purpose: "say what you know about this place using only the supplied known facts; if none are supplied, say plainly you haven't been told",
  ask_response_event: "account for what happened in that exchange using only the supplied event; give only the supplied reason, and if none is supplied give no reason at all (no motive, feeling or excuse)",
  ask_predicate: "answer exactly the question asked, from the supplied predicate_answer only: give its value plainly (yes or no, or the value) about yourself when it is about you; if its value is unknown say you don't know, if not established say nobody has said; say nothing about anyone else's feelings or history and add nothing new",
  attend: "respond in a word or two that you're listening; add nothing else"
});

/**
 * The answer a canonical self-state gives to a question about one feeling. Canonical affect is the only
 * authority: an ordinary state holds no elevated feeling (so "excited?" / "nervous?" is "not especially"),
 * and a moved state answers with what actually moved.
 */
function selfStateAnswer(query, selfState) {
  if (!query || !selfState) return null;
  const keys = (selfState.affect ?? []).map((a) => (/tired/i.test(a) ? "tired" : /tense|stress/i.test(a) ? "tense" : /nervous/i.test(a) ? "nervous" : /pressed|time/i.test(a) ? "pressed" : null)).filter(Boolean);
  const affected = selfState.state === "affected" && keys.length > 0;
  let answer;
  if (query.asked === "wellbeing") answer = affected ? "affected" : "fine";
  else if (query.asked === "tense") answer = keys.includes("tense") || keys.includes("nervous") ? "yes" : (affected ? "affected_instead" : "not_especially");
  else if (query.asked === "tired") answer = keys.includes("tired") ? "yes" : (affected ? "affected_instead" : "not_especially");
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
  if (plan.discourse_function === "compound") { const last = plan.parts.at(-1); return responseBasisFromPlan(last?.plan, last?.frame ?? frame); }
  const fn = plan.discourse_function;
  const facts = plan.required_facts ?? [];
  const value = (key) => facts.find((f) => f.key === key)?.value ?? null;
  if (value("explanation_basis")) return value("explanation_basis");
  if (value("predicate_answer")) { const a = value("predicate_answer"); return { kind: "predicate_answer", predicate: a.predicate, value: a.value, provenance: [...(a.provenance ?? [])], ...(a.answer?.reported ? { heard_from: [a.answer.speaker_name ?? "someone"] } : {}) }; }
  if (plan.may_ask_clarifying_question) return { kind: "clarification", expected_slot: plan.expected_slot ?? null };
  // The basis a knowledge answer was given on: WHERE the known part came from (briefing, baseline
  // orientation, training, what they saw, whom they heard) and, for a partial answer, that the rest is unknown.
  if (value("known_concept")) return { kind: "known_information", facts: [...(value("known_concept").statements ?? [])].slice(0, 2), provenance: value("known_concept").provenance ?? [], ...(value("known_concept").heard_from ? { heard_from: value("known_concept").heard_from } : {}), ...(value("knowledge_gap") ? { partial: true, missing: value("knowledge_gap").missing } : {}) };
  if (value("item_holder_history")) return { kind: "custody_history", ...value("item_holder_history") };
  if (value("reported_speech")) return { kind: "heard_report", speakers: [...new Set((value("reported_speech").claims ?? []).map((c) => c.speaker_name).filter(Boolean))] };
  if (value("utterance_meaning")) return { kind: "meaning_of_line", own: Boolean(value("utterance_meaning").own), match: value("utterance_meaning").match ?? null };
  if (value("conversation_event")) return { kind: "conversation_event", reason: value("conversation_event").reason };
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
  if (value("name") || value("role") || value("current_assignment")) return { kind: "assignment", role: value("role"), assignment: value("current_assignment"), ...(plan.fact_semantics?.current_assignment ? { meaning: plan.fact_semantics.current_assignment } : {}) };
  // Any answer that was only "I don't know" (of whatever kind) is explained by having nothing to go on.
  if (value("uncertainty") && !["ask_reported_speech"].includes(fn)) return { kind: "no_known_fact", past_perception: Boolean(frame?.past_perception), uncertainty: value("uncertainty").kind === "current_state_unknown" ? "not_told" : value("uncertainty").kind };
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
    // Structured meaning of facts whose phrase alone is not their meaning (never model-facing as such).
    const semantics = {};
    let clarifyMeaning = false;
    // Custody the responder cannot know stays unknown: the plan names the holder only
    // when the observer/knowledge authority allows this speaker to know it.
    const holderFact = (ref) => {
      // Fail closed: custody is known only through self-custody or an explicit observer-authority grant.
      const known = ref.holder === responder_id || self?.custody_known?.[ref.id] === true;
      const knownBy = ref.holder === responder_id ? "self" : (self?.custody_basis?.[ref.id] ?? null);
      return { label: ref.label, holder_name: known ? (names[ref.holder] ?? null) : null, holder_is_self: ref.holder === responder_id, ...(known ? (knownBy ? { known_by: knownBy, ...(knownBy === "briefing" ? { known_from: "Maxwell at the briefing" } : {}) } : {}) : { holder_known: false }) };
    };

    const kq = frame?.knowledge_query ?? null;
    const aboutSelf = kq?.entity?.id && kq.entity.id === responder_id;
    const selfRoleQuestion = fn === "ask_role_or_assignment" && (!kq || kq.subject === "addressee" || aboutSelf);
    // Asked who/what THEY are, a person answers from their own record; asked whether they're here, from
    // perception (presence is state, not identity).
    const selfIdentity = fn === "ask_person_identity" && aboutSelf && ["person_identity", "person_role"].includes(kq?.concept ?? "person_identity");
    if (fn === "invite_self_description" || selfRoleQuestion || selfIdentity) {
      if (self?.name) required.push({ key: "name", value: self.name });
      if (self?.role) required.push({ key: "role", value: self.role });
      if (self?.current_assignment) {
        required.push({ key: "current_assignment", value: self.current_assignment });
        if (self.assignment_semantics) semantics.current_assignment = { ...self.assignment_semantics };
      }
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
    } else if (fn === "ask_predicate") {
      // A registry predicate, answered by THIS responder's own resolver result (self profile, briefing
      // grants, observation). The result is the whole of what the line may say about the question.
      const r = responders[responder_id]?.predicate_result ?? null;
      if (!r) clarifyMeaning = true;
      else {
        required.push({ key: "predicate_answer", value: { predicate: frame.predicate, value: r.value, answer: r.answer ? structuredClone(r.answer) : null, statements: [...(r.statements ?? [])], provenance: [...(r.provenance ?? [])], question_form: frame.question_form ?? null, alternatives: frame.turn?.alternatives ?? null, temporal: frame.turn?.temporal_scope ?? null, inverted: Boolean(frame.turn?.args?.question_inverted), asks_split: Boolean(frame.turn?.args?.asks_split), negated: Boolean(frame.turn?.args?.question_negated) } });
        semantics.predicate = { predicate: frame.predicate, value: r.value, resolver: r.resolver ?? null, sources: [...(r.sources ?? [])], provenance: [...(r.provenance ?? [])] };
      }
      forbidden.push("new_factual_claims", "third_party_private_state");
    } else if (fn === "attend") {
      forbidden.push("new_factual_claims");
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
      // "What do you mean?" right after this speaker's OWN clarifying question: the question is asked again
      // in other words, never quoted back at the player.
      const ownLast = ante.resolved ? repairTargets(ante.responses ?? [], responder_id).find((r) => r.speaker_id === responder_id) ?? null : null;
      if (fn === "clarify_previous" && ownLast?.basis?.kind === "clarification") { clarifyMeaning = true; optional.push({ key: "reclarify", value: true }); }
      else if (ante.resolved) {
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
    // The same person asked the same thing they just answered: the plan marks it so the reply restates
    // ("Like I said, ...") instead of performing a second first-time answer.
    if (responders[responder_id]?.repeat_of) optional.push({ key: "repeat_of_own_answer", value: true });
    // C6 speaker agenda: only already-licensed propositions, only as optional facts (empty today).
    for (const item of responders[responder_id]?.agenda ?? []) if (item?.key === "agenda_mention") optional.push(item);
    // A check-in, or a remark about the speaker's own look, is answered from canonical self-state only.
    if ((fn === "check_in" || (fn === "social_observation" && frame.about_addressee)) && self?.self_state) required.push({ key: "self_state", value: self.self_state });
    // A question about ONE feeling ("Excited?", "Nervous?") gets the stance that canonical state gives.
    if (fn === "check_in" && frame.self_state_query && self?.self_state) required.push({ key: "self_state_answer", value: selfStateAnswer(frame.self_state_query, self.self_state) });
    if (fn === "ask_next_step") {
      // Only a procedure this speaker canonically knows answers "what's next"; otherwise it is asked about.
      if (self?.procedure?.next_step) required.push({ key: "current_procedure", value: { ...self.procedure, scope: frame.procedure_scope ?? "current" } });
      // Where we are is known but nothing canonical says what follows: a truthful "not told yet".
      else if (self?.procedure?.current_step) required.push({ key: "uncertainty", value: { kind: "next_step_not_told", current_step: self.procedure.current_step } });
    }
    // ED-30 (E7): a question Tier 1 could not type, that no accepted advisory reading completed, and that
    // no fact answers is a PARSE limit -- it is clarified, never voiced as "I don't know".
    if (fn === "ask_factual" && !required.length && !frame.addressee_state && !frame.past_perception && frame.tier1_generic && (frame.turn?.completeness?.missing ?? []).includes("facet_unresolved")) clarifyMeaning = true;
    // No fact answers an answerable question: which KIND of not-knowing it is (the model words that kind).
    else if (["ask_factual", "ask_personal_experience", "challenge", "ask_opinion"].includes(fn) && !required.length && !(frame.addressee_state)) required.push({ key: "uncertainty", value: { kind: uncertaintyKind(frame, fn) } });
    if (fn === "ask_explanation") {
      const ante = frame.antecedent ?? {};
      const own = ante.resolved ? repairTargets(ante.responses ?? [], responder_id).find((r) => r.speaker_id === responder_id) ?? null : null;
      if (own) required.push({ key: "explanation_basis", value: own.basis ?? { kind: "unavailable" } });
      else if (ante.resolved) required.push({ key: "explanation_basis", value: { kind: "not_own_line", speaker_name: repairTargets(ante.responses ?? [], responder_id)[0]?.speaker_name ?? null } });
      forbidden.push("invented_rationale");
    }

    // Knowledge questions: the answer material is THIS responder's own canonical knowledge query result
    // (provenance kept). Knowing it is what the plan authorizes to say; nothing else about the world is.
    // PARTIAL knowledge keeps both halves: what is known, and which requested detail is not.
    if ((KNOWLEDGE_FUNCTIONS[fn] || (fn === "ask_role_or_assignment" && !selfRoleQuestion)) && !selfIdentity && fn !== "ask_reported_speech") {
      const k = frame?.unresolved_reference ? null : (responders[responder_id]?.knowledge ?? null);
      const factMeta = (f) => ({ key: f.key, concept: f.concept ?? null, facet: f.facet ?? null, entity_id: f.entity_id ?? null, reported: f.reported ?? null, provenance: f.provenance, authority_class: f.authority_class ?? null, source_ref: f.source_ref });
      if (k?.status === "known" || k?.status === "partial") {
        const heardFrom = [...new Set(k.facts.filter((f) => f.provenance === "heard" && f.speaker_id).map((f) => names[f.speaker_id]).filter(Boolean))];
        required.push({ key: "known_concept", value: { concept: k.concept, about: k.entity?.label ?? null, statements: k.facts.map((f) => f.statement), provenance: [...new Set(k.facts.map((f) => f.provenance))], ...(heardFrom.length ? { heard_from: heardFrom } : {}), ...(k.bounded_unknown ? { limit: k.bounded_unknown } : {}) } });
        if (k.status === "partial") required.push({ key: "knowledge_gap", value: { missing: k.missing_requested_detail ?? "detail", about: k.entity?.label ?? null, concept: k.concept } });
        semantics.knowledge = { concept: k.concept, entity_id: k.entity?.id ?? null, status: k.status, requested_facet: k.requested_facet ?? null, missing_requested_detail: k.missing_requested_detail ?? null, facts: k.facts.map(factMeta), ...(k.status === "partial" ? { unknown_reason: k.unknown_reason } : {}) };
      } else if (!frame?.unresolved_reference && k) {
        required.push({ key: "uncertainty", value: { kind: k.status === "unknown_entity" || (k.entity?.world_only && k.concept === "person_identity") ? "unknown_person" : (k.concept === "entity_state" ? "current_state_unknown" : "not_told") } });
        semantics.knowledge = { concept: k.concept ?? KNOWLEDGE_FUNCTIONS[fn] ?? "role_or_assignment", entity_id: k.entity?.id ?? null, status: k.status, facts: [], unknown_reason: k.unknown_reason ?? null, ...(k.entity?.world_only ? { entity_resolution: "canonical_entity_not_known_to_actor" } : k.status === "unknown_entity" ? { entity_resolution: "unrecognized_entity" } : {}) };
      } else if (!frame?.unresolved_reference) {
        // No query result at all is a projection failure: never voiced as in-world ignorance.
        semantics.knowledge = { concept: frame?.knowledge_query?.concept ?? KNOWLEDGE_FUNCTIONS[fn] ?? null, entity_id: frame?.knowledge_query?.entity?.id ?? null, status: "projection_failure", facts: [], unknown_reason: canonicalKnowledge.SEMANTIC_REASON.KNOWLEDGE_PROJECTION_FAILURE };
        clarifyMeaning = true;
      }
      forbidden.push("new_factual_claims");
    }
    // "What are you doing right now?" with no canonical activity to report: the speaker's own record
    // (assignment posture) or plainly nothing in particular -- never "nobody told me".
    if (fn === "ask_current_action" && !required.some((f) => f.key === "known_concept")) {
      for (let i = required.length - 1; i >= 0; i -= 1) if (required[i].key === "uncertainty") required.splice(i, 1);
      required.push({ key: "current_action", value: { activity: self?.current_activity ?? null } });
    }
    // "What did Clint say ...?": attributed claims this responder HEARD (a player's claim stays the player's).
    if (fn === "ask_reported_speech" && !frame?.unresolved_reference) {
      const k = responders[responder_id]?.knowledge ?? null;
      const r = k?.reported ?? null;
      const speakerName = frame?.knowledge_query?.speaker_label ?? null;
      // "Did Maxwell say anything about splitting up?": only claims about that topic answer it (review F10).
      const aboutText = String(frame?.turn?.request_text ?? "").match(/\babout\s+([^?.!]+)/i)?.[1] ?? null;
      const topicWords = aboutText && !k?.entity ? aboutText.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !/^(?:that|this|what|them|those|these|anything|something|today|earlier)$/.test(w)).map((w) => w.replace(/(?:ting|ing|s)$/, "")) : [];
      const onTopic = (c) => !topicWords.length || topicWords.some((w) => String(c.reported ?? c.text ?? "").toLowerCase().includes(w));
      const selfName = names[responder_id] ?? null;
      // One's own name inside a report is said as "I"/"me" ("Maxwell said I'm on observation").
      const firstPerson = (text) => (selfName && text ? String(text).replace(new RegExp(`\\b${selfName}\\s+is\\b`, "g"), "I'm").replace(new RegExp(`\\b${selfName}\\s+has\\b`, "g"), "I've").replace(new RegExp(`\\b${selfName}\\b`, "g"), "me") : text);
      if (r?.status === "known" && !r.claims.some(onTopic)) {
        // Never "he didn't say that": the reports this speaker holds don't cover the topic, and that is all.
        required.push({ key: "uncertainty", value: { kind: "report_topic_not_held", speaker_name: speakerName } });
        semantics.knowledge = { concept: "reported_speech", entity_id: k.entity?.id ?? null, status: "report_topic_not_held", speaker_id: frame?.knowledge_query?.speaker_id ?? null, facts: [], unknown_reason: canonicalKnowledge.SEMANTIC_REASON.LEGITIMATE_UNKNOWN };
      } else if (r?.status === "known") {
        required.push({ key: "reported_speech", value: { speaker_name: speakerName, about: k.entity?.label ?? null, claims: r.claims.filter(onTopic).slice(-3).map((c) => ({ ...c, reported: firstPerson(c.reported) })).map((c) => ({ speaker_id: c.speaker_id ?? null, speaker_name: c.speaker_name ?? names[c.speaker_id] ?? null, epistemic: c.epistemic_mode, ...(c.epistemic_mode === "player_claim" ? { quote: c.text } : c.epistemic_mode === "own_speech" && c.line ? { quote: c.line } : { reported: c.reported }) })).filter((c, i, all) => !c.quote || all.findIndex((x) => x.quote === c.quote) === i) } });
        semantics.knowledge = { concept: "reported_speech", entity_id: k.entity?.id ?? null, status: "known", speaker_id: frame?.knowledge_query?.speaker_id ?? null, facts: r.claims.map((c) => ({ key: c.key, speaker_id: c.speaker_id, provenance: c.epistemic_mode, source_ref: c.source_ref })) };
      } else {
        required.push({ key: "uncertainty", value: { kind: r?.heard_speaker ? "not_heard_on_topic" : "did_not_hear_speaker", speaker_name: speakerName } });
        semantics.knowledge = { concept: "reported_speech", entity_id: k?.entity?.id ?? null, status: r?.status ?? "not_heard", speaker_id: frame?.knowledge_query?.speaker_id ?? null, facts: [], unknown_reason: canonicalKnowledge.SEMANTIC_REASON.LEGITIMATE_UNKNOWN };
      }
      forbidden.push("new_factual_claims", "confirming_player_claims");
    }
    // A historical custody question is answered from the responder's own earlier snapshots only.
    if (fn === "ask_item_ownership" && frame?.custody_time === "historical") {
      const past = responders[responder_id]?.custody_history ?? [];
      const current = (frame.referents ?? []).find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
      const earlier = [...past].reverse().find((h) => h.holder_id && h.holder_id !== current?.holder) ?? past[0] ?? null;
      for (let i = required.length - 1; i >= 0; i -= 1) if (required[i].key === "item_holder") required.splice(i, 1);
      required.push({ key: "item_holder_history", value: earlier ? { label: current?.label ?? null, holder_name: earlier.holder_id === responder_id ? "me" : (names[earlier.holder_id] ?? null), holder_is_self: earlier.holder_id === responder_id, when: earlier.when, basis: earlier.epistemic_mode } : { label: current?.label ?? null, holder_name: null, known: false } });
      semantics.custody = { resolution: "historical", equipment_id: current?.id ?? null, snapshot: earlier ? { holder_id: earlier.holder_id, at: earlier.at, source_ref: earlier.source_ref } : null };
    } else if (fn === "ask_item_ownership") {
      const current = (frame.referents ?? []).find((ref) => ref.type === "equipment" && ref.resolved) ?? null;
      if (current) semantics.custody = { resolution: "current", equipment_id: current.id };
    }
    // A player's statement about the world: heard as THEIR claim (remembered as such), never confirmed.
    if (fn === "make_statement" && frame?.player_claim) {
      required.push({ key: "player_claim", value: { status: "player_claim", confirmed: false } });
      forbidden.push("confirming_player_claims");
    }
    if (fn === "ask_meaning") {
      // What an earlier LINE meant. One's own line: the authorized fact the quoted words came from (its
      // structured meaning), or -- when the words were only wording -- the basis the line was said on.
      // Someone else's line: only they can say what they meant. The quotation itself is never a fact.
      const ref = frame.utterance_reference ?? null;
      if (ref?.resolved) {
        const own = ref.speaker_id === responder_id;
        // Observer boundary: another person's line is given only to a responder who heard it.
        const heardLine = own || (ref.listener_ids ?? []).includes(responder_id);
        const value = { line: heardLine ? ref.text : null, quoted: ref.span ?? null, own, speaker_name: own ? null : (ref.is_player ? "you" : (ref.speaker_name ?? names[ref.speaker_id] ?? null)) };
        if (own) {
          const matched = matchSpanToFacts(ref.span, ref.facts);
          value.match = matched.status;
          if (matched.status === "unique") value.meaning = { key: matched.fact.key, value: matched.fact.value, ...(matched.semantics ? { semantics: matched.semantics } : {}) };
          else if (matched.status === "ambiguous") clarifyMeaning = true;
          // The words were the wording of an assignment answer: its recorded meaning is what they meant.
          else if (ref.basis?.kind === "assignment" && ref.basis.meaning) { value.match = "basis"; value.meaning = { key: "current_assignment", value: ref.basis.assignment ?? ref.basis.meaning.phrase, semantics: ref.basis.meaning }; }
          else value.basis = ref.basis ?? { kind: "unavailable" };
        }
        required.push({ key: "utterance_meaning", value });
      }
      forbidden.push("new_factual_claims", "invented_rationale");
    }
    if (fn === "ask_response_event") {
      // A recent conversational EVENT, per responder: the exchange they did not answer (or the one named),
      // what they perceived of it, and only a CHARACTER-KNOWABLE reason. The simulation's own reason
      // (policy, parser outcome, provider failure) stays in the plan's bookkeeping, never in speech.
      const ref = frame.event_reference ?? null;
      const target = ref?.target ?? (ref?.candidates ?? []).find((t) => !(t.responder_ids ?? []).includes(responder_id) && ((t.listener_ids ?? []).includes(responder_id) || (t.addressee_ids ?? []).includes(responder_id))) ?? null;
      if (ref?.resolved && target) {
        const heard = (target.listener_ids ?? []).includes(responder_id);
        const responded = (target.responder_ids ?? []).includes(responder_id);
        const simulation = responded ? "responded" : (target.silence?.[responder_id] ?? (heard ? "not_selected_no_response" : "not_a_listener"));
        const addressedYou = (target.addressee_ids ?? []).includes(responder_id) || target.address_scope === "group";
        const others = (target.responses ?? []).filter((r) => r.speaker_id !== responder_id).map((r) => r.speaker_name ?? names[r.speaker_id]).filter(Boolean);
        required.push({ key: "conversation_event", value: {
          // Observer boundary: the player's line itself only for someone who heard it.
          player_line: heard ? target.player_text : null,
          addressed: addressedYou ? ((target.addressee_ids ?? []).length > 1 || target.address_scope === "group" ? "you_and_others" : "you") : (target.address_scope === "untargeted" ? "no_one_by_name" : "someone_else"),
          heard,
          responded,
          own_reply: responded ? ((target.responses ?? []).find((r) => r.speaker_id === responder_id)?.text ?? null) : null,
          others_responded: [...new Set(others)],
          // "Someone else answered" is knowable only when that answer was actually heard.
          reason: responded ? "responded" : (simulation === "response_policy_selected_other" && !others.length ? "no_character_reason" : characterSilenceReason(simulation))
        } });
        semantics.conversation_event = { interaction_id: target.interaction_id, simulation_basis: simulation };
      }
      forbidden.push("invented_rationale", "invented_motive");
    }
    // An answer to the speaker's own open "Why?" is the player's CLAIM: heard, never canonical truth.
    if (frame.slot_answer?.slot === "reason") required.push({ key: "stated_reason", value: { text: frame.slot_answer.text, status: "player_claim" } });

    const clarifying = fn === "ambiguous_reference" || Boolean(frame?.unresolved_reference) || clarifyMeaning || (fn === "ask_response_event" && !required.some((f) => f.key === "conversation_event")) || (Boolean(frame?.temporal_reference) && !frame.temporal_reference.resolved && ["ask_factual", "ask_personal_experience"].includes(fn) && required.every((f) => f.key === "uncertainty")) || (fn === "ask_next_step" && required.length === 0);
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
      may_ask_clarifying_question: clarifying,
      // What an answer to that clarification must supply (persisted: the open question survives a reload).
      expected_slot: clarifying ? (clarifyMeaning ? (fn === "ask_factual" ? "topic" : "referent") : (fn === "ask_response_event" ? "temporal" : (frame?.expected_slot ?? clarificationSlot(frame)))) : null,
      // Structured meaning of the facts above (bookkeeping, not model-facing).
      ...(Object.keys(semantics).length ? { fact_semantics: semantics } : {}),
      same_turn_prior_responses: planned.map((p) => p.responder_id),
      // STYLE-ONLY: shapes wording, never a factual claim.
      style_hints: { ...(self?.identity_style ?? {}) }
    });
  }
  return planned;
}

/**
 * ED-30 F12: one responder answering several acts of one turn in ONE line. Each part keeps its own plan and
 * frame (validated, satisfied and explained separately); the union of their facts is what the line may say.
 */
function compoundPlan(parts = []) {
  const plans = parts.map((p) => p.plan).filter(Boolean);
  const first = plans[0] ?? {};
  const uniq = (list) => { const seen = new Set(); return list.filter((f) => { const k = JSON.stringify(f); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    responder_id: first.responder_id ?? null,
    recipient_scope: first.recipient_scope ?? null,
    discourse_function: "compound",
    purpose: "answer each of their questions, in the order they asked, each only from its own facts below; keep it to one or two short sentences",
    requested_content: "compound",
    expected_response_shape: "brief_multi_answer",
    required_facts: uniq(plans.flatMap((p) => p.required_facts ?? [])),
    optional_facts: uniq(plans.flatMap((p) => p.optional_facts ?? [])),
    forbidden_claims: [...new Set(plans.flatMap((p) => p.forbidden_claims ?? []))],
    may_ask_clarifying_question: plans.some((p) => p.may_ask_clarifying_question),
    expected_slot: plans.find((p) => p.may_ask_clarifying_question)?.expected_slot ?? null,
    parts: parts.map((p) => ({ plan: p.plan, frame: p.frame })),
    same_turn_prior_responses: [],
    style_hints: { ...(first.style_hints ?? {}) }
  };
}

/**
 * The model-facing projection of a plan: exactly what is needed to word the
 * authorized contribution, with no internal ids and no implementation fields.
 */
function toAuthorizedContribution(plan, frame, { names = {} } = {}) {
  if (!plan) return null;
  if (plan.discourse_function === "compound") {
    const parts = plan.parts.map((p) => toAuthorizedContribution(p.plan, p.frame, { names }));
    return { discourse_function: "compound", purpose: plan.purpose, expected_response_shape: plan.expected_response_shape, requested_content: "compound", parts, required_facts: plan.required_facts, optional_facts: plan.optional_facts, forbidden_claims: plan.forbidden_claims, may_ask_clarifying_question: plan.may_ask_clarifying_question, expected_slot: plan.expected_slot ?? null, referents: parts.flatMap((p) => p.referents ?? []), antecedent: null, same_turn_prior_responses: [], style_hints: plan.style_hints };
  }
  const ante = frame?.antecedent ?? { type: "none", resolved: true };
  return {
    discourse_function: plan.discourse_function,
    purpose: plan.purpose,
    expected_response_shape: plan.expected_response_shape,
    requested_content: plan.requested_content,
    // ED-30: the registry predicate asked (and what a responsive answer must contain).
    ...(frame?.predicate ? { predicate: frame.predicate, answer_contract: frame.answer_contract ?? null } : {}),
    topic: frame?.topic ?? null,
    question_form: frame?.question_form ?? null,
    addressee_state: Boolean(frame?.addressee_state),
    referents: (frame?.referents ?? []).map((ref) => ({ type: ref.type, label: ref.label ?? null, resolved: Boolean(ref.resolved), ...(ref.reason ? { reason: ref.reason } : {}), ...(ref.noun ? { noun: ref.noun } : {}) })),
    past_perception: Boolean(frame?.past_perception),
    about_addressee: Boolean(frame?.about_addressee),
    temporal_reference: frame?.temporal_reference ? { expression: frame.temporal_reference.expression, resolved: Boolean(frame.temporal_reference.resolved) } : null,
    // The question a clarification answer resumes ("Who has the thing?"), so the reply answers IT.
    resumed_question: frame?.resumed_question?.player_text ?? null,
    // Which kind of answer the player just supplied to the speaker's clarification, if any.
    answered_slot: frame?.slot_answer?.slot ?? null,
    self_state_query: frame?.self_state_query ? { asked: frame.self_state_query.asked, polarity: frame.self_state_query.polarity } : null,
    procedure_scope: frame?.procedure_scope ?? null,
    // What a clarification asks the player to supply ("when", "which", "where").
    expected_slot: plan.may_ask_clarifying_question ? (plan.expected_slot ?? null) : null,
    antecedent: !["clarify_previous", "request_repetition", "ask_explanation", "ask_meaning"].includes(plan.discourse_function)
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
/**
 * Pragmatics section of the dev trace: who was addressed (explicitly or by inheritance), the active thread,
 * the open question and its slot, the earlier line or conversational event referred to, and each plan's
 * response/silence basis. Ids and bounded text only -- never broad world state.
 */
function pragmaticsTrace({ address = null, frame = null, discourse = null, plans = [], interpretation = null, owner_ids = [] } = {}) {
  const inherited = address?.form === "inherited";
  const ref = frame?.utterance_reference ?? null;
  const ev = frame?.event_reference ?? null;
  return {
    explicit_addressees: address && !inherited && address.scope !== "untargeted" ? { scope: address.scope, ids: address.addressee_ids, form: address.form } : null,
    inherited_addressees: inherited ? { scope: address.scope, ids: address.addressee_ids, via: address.source } : null,
    active_thread: discourse?.active_thread ? { kind: discourse.active_thread.kind, members: discourse.active_thread.member_ids, responders: discourse.active_thread.responder_ids } : null,
    open_question: discourse?.pending_question ? { id: discourse.pending_question.question_id ?? null, expected_slot: discourse.pending_question.expected_slot ?? null, askers: discourse.pending_question.asker_ids ?? [] } : null,
    slot_answer: frame?.slot_answer ? { slot: frame.slot_answer.slot, text: frame.slot_answer.text, event: frame.slot_answer.event?.turn ?? null } : null,
    prior_utterance: ref ? { resolved: ref.resolved, interaction_id: ref.interaction_id ?? null, speaker: ref.speaker_id ?? null, match: ref.match ?? ref.reason ?? null } : null,
    quoted_span: ref?.span ?? null,
    conversational_event: ev ? { resolved: ev.resolved, relation: ev.relation, target: ev.target?.interaction_id ?? null, candidates: (ev.candidates ?? []).map((c) => c.interaction_id) } : null,
    response_basis: plans.map((p) => ({ responder: p.responder_id, basis: responseBasisFromPlan(p, frame)?.kind ?? null, expected_slot: p.expected_slot ?? null, ...(p.fact_semantics?.conversation_event ? { silence_basis: p.fact_semantics.conversation_event.simulation_basis } : {}) })),
    interpretation_source: frame?.interpretation_source ?? "deterministic",
    tier1_generic: Boolean(frame?.tier1_generic),
    advisory_frame: interpretation?.advice ? { intent: interpretation.advice.intent, referent_text: interpretation.advice.referent_text, relation: interpretation.advice.discourse_relation, confidence: interpretation.advice.confidence } : null,
    advisory_validation: interpretation?.advisory_validation ?? null,
    advisory_latency_ms: interpretation?.advisory_latency_ms ?? null,
    resolved_semantic_concept: frame?.knowledge_query?.concept ?? null,
    knowledge_query: frame?.knowledge_query ? { concept: frame.knowledge_query.concept, entity: frame.knowledge_query.entity?.id ?? frame.knowledge_query.entity?.label ?? null } : null,
    // Fact keys and provenance only -- never the facts' content.
    knowledge_results: plans.filter((p) => p.fact_semantics?.knowledge).map((p) => ({ responder: p.responder_id, status: p.fact_semantics.knowledge.status ?? null, facts: p.fact_semantics.knowledge.facts.map((f) => `${f.key}:${f.provenance}`), unknown_reason: p.fact_semantics.knowledge.unknown_reason ?? null, ...(p.fact_semantics.knowledge.entity_resolution ? { entity_resolution: p.fact_semantics.knowledge.entity_resolution } : {}) })),
    contribution_fact_keys: plans.map((p) => ({ responder: p.responder_id, required: (p.required_facts ?? []).map((f) => f.key), optional: (p.optional_facts ?? []).map((f) => f.key) })),
    // The concept actually asked (identity vs role vs authority vs relation; definition vs current state).
    semantic_intent: frame?.semantic_intent ?? null,
    canonical_entity: frame?.knowledge_query?.entity ? { id: frame.knowledge_query.entity.id ?? null, label: frame.knowledge_query.entity.label ?? null, basis: frame.knowledge_query.person_basis ?? null } : null,
    response_owners: owner_ids,
    partial_knowledge: plans.filter((p) => p.fact_semantics?.knowledge?.status === "partial").map((p) => ({ responder: p.responder_id, missing_requested_detail: p.fact_semantics.knowledge.missing_requested_detail ?? null })),
    // Why an answer is incomplete or unknown (machine labels: trace only, never player UI).
    semantic_reason: frame?.unresolved_reference ? (frame?.tier1_generic ? (interpretation?.advisory_validation === "rejected:advisory_unavailable" ? "advisory_unavailable" : "interpretation_failure") : "reference_ambiguity") : ([...new Set(plans.map((p) => p.fact_semantics?.knowledge?.unknown_reason).filter(Boolean))][0] ?? null),
    // Propositions the planned replies would communicate (what listeners will hold as HEARD), keys only.
    candidate_propositions: plans.map((p) => ({ responder: p.responder_id, keys: canonicalKnowledge.propositionsOfPlan(p, { speaker_id: p.responder_id }).map((x) => `${x.concept}:${x.key}`) })),
    semantic_anchors: frame?.utterance_reference?.match === "anchor" || frame?.knowledge_query?.entity?.id?.startsWith?.("task:") ? { anchored: frame?.utterance_reference?.match === "anchor", entity: frame?.knowledge_query?.entity?.id ?? null } : null,
    current_vs_historical: plans.map((p) => p.fact_semantics?.custody ? { responder: p.responder_id, resolution: p.fact_semantics.custody.resolution, item: p.fact_semantics.custody.equipment_id } : null).filter(Boolean),
    correction: frame?.correction ?? null,
    player_claim: frame?.player_claim ? { entities: frame.player_claim.entity_ids } : null
  };
}

function formatDiscourseTrace({ raw_utterance, utterance = null, recipient_scope, frame, discourse_summary, owner_ids = [], plans = [], grounded_facts = [], provider_result = null, fallback_used = null, committed_event_ids = null, request_id = null, listener_ids = null, address = null, discourse = null, interpretation = null } = {}) {
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
    committed: committed_event_ids,
    pragmatics: pragmaticsTrace({ address, frame, discourse, plans, interpretation, owner_ids })
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
  compoundPlan,
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
  formatDiscourseTrace,
  pragmaticsTrace,
  KNOWLEDGE_FUNCTIONS,
  semanticKnowledgeIntent,
  anchorTerms,
  anchorEntities,
  anchorCandidates,
  anchorTaskOfLastLine,
  resolveAddressCorrection,
  salientPerson,
  applyAdvice,
  ADVISORY_INTENT_FUNCTIONS,
  matchOpenQuestionSlot,
  clarificationSlot,
  resolveEventReference,
  resolveUtteranceReference,
  matchSpanToFacts,
  assignmentSemantics,
  characterSilenceReason,
  EXPECTED_SLOTS
};
