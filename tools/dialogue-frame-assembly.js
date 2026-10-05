"use strict";

// Reader Phase 1 -- PURE FRAME ASSEMBLY for the SHADOW path.
//
//   assembleFrame({ resolution, canonical }) -> the planner-facing semantic frame (the outer shape
//                                              dialogue-turn.finalizeFrame produces), or null
//
// It replaces, for the shadow only, the RAW-TEXT interpretation production's frame builder performs
// (dialogue-discourse.buildSemanticFrame half A: ~25 LP.* regexes; dialogue-turn.finalizeFrame's legacyRoute
// regex, requestLower name positions and second-person regex; canonical-knowledge.resolveEntityMentions over the
// request text). Everything it uses is explicit and structured:
//   resolution   resolveTurn's shadow output: the resolved primary act (facet, subject, referent bindings as
//                canonical ids, temporal, relation, cardinality, clarification) and the responder-policy result
//   canonical    { entities: { [id]: { kind, label } }, items: { [item_id]: { holder, label } } } -- the canonical
//                entity index and custody the seam hands over (frozen)
// The act's request_text is an OPAQUE presentation string: copied onto the frame, never inspected.
//
// It does NOT regex player text, infer a facet / addressee / relation from text, use legacyRoute, call
// resolveEntityMentions or buildSemanticFrame, or read a model. The planner is not rewritten: the frame keeps the
// fields the planner reads (discourse_function, predicate, requested_content, expected_response_shape,
// expected_slot, referents, knowledge_query, self_state_query, unresolved_reference, turn).

const registry = require("./dialogue-registry");
const { EXPECTED_SHAPES } = require("./dialogue-discourse");

const ASSEMBLY_VERSION = "yellow-beast-frame-assembly@v1";
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
// Non-asking speech acts -> the planner's discourse function (the reader's act, not a regex over the line).
const SOCIAL_FUNCTION = Object.freeze({ greeting: "greet", farewell: "greet", self_introduction: "introduce_self", thanks: "acknowledge", social_acknowledgment: "acknowledge", sarcasm: "joke_or_sarcasm", statement: "make_statement", aside: "make_statement" });
const PLACE_KINDS = new Set(["location", "entity"]);

const entityRef = (canonical, id, fallbackKind = null) => {
  if (!id) return null;
  const e = canonical?.entities?.[id] ?? null;
  return { id, kind: e?.kind ?? fallbackKind, label: e?.label ?? null };
};

/** The referents the act resolved (reader-chosen, code-bound): items with their canonical holder, places. */
function referentsOf(primary, canonical) {
  const out = [];
  const item = primary?.args?.item_id ?? null;
  if (item) out.push({ type: "equipment", id: item, resolved: true, source: "reader_referent", holder: canonical?.items?.[item]?.holder ?? null });
  const place = primary?.args?.place_id ?? null;
  if (place) out.push({ type: "location", id: place, resolved: true, source: primary.args.place_basis ?? "reader_referent", holder: null });
  // A thing the act names outside any argument slot (a remark about the camera).
  for (const id of primary?.referent_ids ?? []) {
    const kind = canonical?.entities?.[id]?.kind ?? null;
    if (canonical?.items?.[id] || kind === "equipment") out.push({ type: "equipment", id, resolved: true, source: "reader_referent", holder: canonical?.items?.[id]?.holder ?? null });
    else out.push({ type: "location", id, resolved: true, source: "reader_referent", holder: null });
  }
  return out;
}

/** The planner-facing turn record (finalizeFrame's `turn`), from the resolved act. */
function turnOf(primary, routing) {
  return {
    relation: primary.relation, relation_target: primary.relation_target, reissue_of: primary.reissue_of, repair: primary.repair ?? null,
    speech_act: primary.speech_act, cardinality: routing?.cardinality ?? primary.cardinality, temporal_scope: primary.temporal_scope ?? (primary.predicate && ASKING.has(primary.speech_act) ? registry.get(primary.predicate)?.default_temporal ?? null : null),
    alternatives: null, args: { ...(primary.args ?? {}) }, addressee_kind: primary.addressee?.kind ?? null, addressee_ids: [...(primary.addressee?.ids ?? [])],
    quantifier: primary.addressee?.quantifier ?? null, clarify_reason: primary.clarify?.reason ?? null,
    request_text: primary.request_text ?? null, // opaque presentation string
    overrides: [], facet_source: primary.facet_source ?? null
  };
}

/** The knowledge query a registry route asks, from structured arguments only. */
function knowledgeQueryFor(route, primary, canonical) {
  const args = primary.args ?? {};
  const third = args.third_party_subject ?? null;
  const item = args.item_id ?? null;
  const place = args.place_id ?? null;
  const mention = (primary.mentions ?? [])[0] ?? null;
  switch (route.fn) {
    case "ask_mission_objective": return { concept: "mission_objective", entity: null };
    case "ask_person_identity": { const who = args.other_id ?? third ?? (primary.subject?.kind === "named" ? primary.subject.ids?.[0] : null) ?? mention; return { concept: route.concept, entity: entityRef(canonical, who, "person") }; }
    case "ask_assignment_purpose": return { concept: "assignment_purpose", entity: entityRef(canonical, item, "equipment"), ...(route.facet ? { facet: route.facet } : {}) };
    case "ask_entity_definition": return { concept: route.concept ?? "entity_definition", entity: entityRef(canonical, item ?? place, item ? "equipment" : "entity") };
    case "ask_current_action": return { concept: "current_action", entity: third ? entityRef(canonical, third, "person") : null, subject: third ? "other" : "addressee" };
    case "ask_institution_purpose": { const inst = Object.entries(canonical?.entities ?? {}).find(([, e]) => e.kind === "institution"); return { concept: "institution_purpose", entity: inst ? { id: inst[0], kind: "institution", label: inst[1].label ?? null } : null }; }
    case "ask_role_or_assignment": return third ? { concept: "person_role", entity: entityRef(canonical, third, "person"), subject: "other" } : { concept: "role_or_assignment", entity: null, subject: "addressee" };
    case "ask_reported_speech": return { concept: route.concept ?? "reported_speech", entity: null, speaker_id: third ?? mention ?? null, ...(route.topic_concept ? { topic_concept: route.topic_concept } : {}) };
    default: return null;
  }
}

// What each route asks for (finalizeFrame's route switch, plus the legacy table for the conversation routes);
// the response shape is the planner's own table (EXPECTED_SHAPES: static data, no reading).
const CONTENT = Object.freeze({
  ask_predicate: "predicate_answer", check_in: null, invite_self_description: "self_description", ask_next_step: "current_procedure", ask_mission_objective: "known_concept",
  ask_person_identity: "known_concept", ask_assignment_purpose: "known_concept", ask_entity_definition: "known_concept", ask_current_action: "known_concept", ask_institution_purpose: "known_concept",
  ask_opinion: "own_opinion", ask_item_ownership: "canonical_holder", ask_role_or_assignment: "role_and_assignment", ask_meaning: "meaning_of_prior_line", ask_explanation: "basis_of_preceding_line",
  ask_reported_speech: "reported_speech", ask_response_event: "account_of_response_event", request_repetition: "preceding_utterance"
});

/**
 * The planner frame for the shadow resolution's primary act. Mirrors finalizeFrame's outer shape and routing
 * rules (answer, clarification, attention, vacuous repair, registry route, third-party and past-state
 * re-routing) without reading any words.
 */
function assembleFrame({ resolution, canonical = {} } = {}) {
  const primary = resolution?.primary ?? null;
  if (!primary) return null;
  const routing = resolution.routing ?? null;
  const predicate = primary.predicate ?? null;
  const entry = predicate ? registry.get(predicate) : null;
  const turn = turnOf(primary, routing);
  const base = {
    version: ASSEMBLY_VERSION, source: "shadow_assembly",
    predicate, answer_contract: entry?.answer_contract ?? null, turn,
    target_scope: (routing?.addressees ?? []).length > 1 ? "group" : (routing?.addressees ?? []).length === 1 ? "direct" : "room",
    referents: referentsOf(primary, canonical), knowledge_query: null, requested_content: null, expected_response_shape: null, expected_slot: null,
    unresolved_reference: false, literal_question: ASKING.has(primary.speech_act), self_state_query: null, player_claim: primary.claim_facet ? { facet: primary.claim_facet, confirmed: false } : null,
    speech_act: primary.speech_act, discourse_function: null
  };
  // The player ANSWERED a coworker's question: nothing is asked; the words are their answer, heard by the asker.
  // (An own-answer repair keeps the thing it now names; a plain answer names nothing to look up.)
  if (primary.speech_act === "answer") return Object.freeze({ ...base, predicate: null, answer_contract: null, referents: primary.args?.reply_kind === "answer_repair" ? base.referents : [], literal_question: false, discourse_function: "make_statement", expected_response_shape: EXPECTED_SHAPES.make_statement ?? null, turn: { ...turn, speech_act: "answer", relation: primary.relation === "repair" ? "repair" : "answer", cardinality: "none", reply_kind: primary.args?.reply_kind ?? "answer" } });
  // Fail closed: the reading was not settled -> ONE clarification, never a guess.
  if (primary.outcome === "clarify" || primary.clarify) return Object.freeze({ ...base, discourse_function: "ambiguous_reference", unresolved_reference: true, expected_slot: primary.clarify?.slot ?? "topic", expected_response_shape: "clarification_request", literal_question: false });
  if (primary.speech_act === "attention_call" && !predicate) return Object.freeze({ ...base, predicate: null, discourse_function: "attend", expected_response_shape: "brief_attention_response", literal_question: false });
  if (!ASKING.has(primary.speech_act)) {
    const fn = SOCIAL_FUNCTION[primary.reader_speech_act ?? primary.speech_act] ?? "make_statement";
    return Object.freeze({ ...base, predicate: null, answer_contract: null, discourse_function: fn, expected_response_shape: EXPECTED_SHAPES[fn] ?? null, literal_question: false });
  }
  // Asking, but no registry facet the reader could name: no route exists without reading words -> clarify.
  if (!entry) return Object.freeze({ ...base, discourse_function: "ambiguous_reference", unresolved_reference: true, expected_slot: "topic", expected_response_shape: "clarification_request", literal_question: false, turn: { ...turn, clarify_reason: "no_registry_facet" } });
  let route = entry.route ?? { fn: "ask_predicate" };
  const third = primary.args?.third_party_subject ?? null;
  // A third-person state question goes through the predicate path (its resolver knows whose state it is); a
  // past-state question too (the check-in only knows how the speaker feels now); another person's opinion too.
  if (third && ["check_in", "ask_opinion"].includes(route.fn)) route = { fn: "ask_predicate" };
  if (route.fn === "check_in" && turn.temporal_scope === "earlier") route = { fn: "ask_predicate" };
  const content = route.fn in CONTENT ? CONTENT[route.fn] : "predicate_answer";
  const shape = EXPECTED_SHAPES[route.fn] ?? "brief_predicate_answer";
  const kq = knowledgeQueryFor(route, primary, canonical);
  const out = { ...base, discourse_function: route.fn, requested_content: content, expected_response_shape: shape, knowledge_query: kq, literal_question: true };
  if (route.fn === "ask_predicate") Object.assign(out, { semantic_intent: predicate, expected_slot: "topic" });
  if (route.fn === "check_in") Object.assign(out, { self_state_query: { asked: route.self_state, polarity: primary.question_form === "wh" ? "open" : "yes_no" } });
  if (route.fn === "ask_next_step") Object.assign(out, { procedure_scope: "current" });
  // A route that needs an entity the act did not bind stays unresolved (it is clarified, never guessed).
  if (["ask_assignment_purpose", "ask_entity_definition"].includes(route.fn) && !kq?.entity) Object.assign(out, { unresolved_reference: true });
  if (route.fn === "ask_item_ownership" && !out.referents.some((r) => r.type === "equipment")) Object.assign(out, { unresolved_reference: true });
  return Object.freeze(out);
}

/** The canonical context the assembly reads, built by the seam from canonical state (ids, kinds, labels, holders). */
function canonicalContext({ entities = [], equipment = {} } = {}) {
  const ents = {};
  for (const e of entities) if (e?.id) ents[e.id] = { kind: e.kind ?? null, label: e.label ?? null };
  const items = {};
  for (const item of Object.values(equipment ?? {})) if (item?.id) items[item.id] = { holder: item.holder ?? null, label: item.label ?? item.name ?? null };
  return { entities: ents, items, place_kinds: [...PLACE_KINDS] };
}

module.exports = { ASSEMBLY_VERSION, assembleFrame, canonicalContext, referentsOf, knowledgeQueryFor };
