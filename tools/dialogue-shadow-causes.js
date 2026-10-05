"use strict";

// Reader Phase 1 -- CAUSES of shadow / production mismatches (developer tooling only).
//
// Every cause is a separate rule with (1) a CLASS, (2) an EVIDENCE test over the turn's recorded facts (the legacy
// value-level record, the adapter's conversion notes, the validator verdict, production's routing record, the
// finalized planner frame, the shadow resolution) and (3) the FIELDS it can explain. A mismatch gets every cause
// whose evidence holds AND whose field list covers it; a mismatch no cause covers is UNCLASSIFIED. Causes are never
// merged into one bucket: a turn can carry several, each named.
//
// Classes (the Phase-1 exit gate's three admissible dispositions, plus the two that block it):
//   OWNER_APPROVED   an owner ruling / owner-ratified decision makes the shadow differ on purpose
//   FENCED_RAW_TEXT  production decided from raw player words (a site in READER_RAW_TEXT_INVENTORY.md) that Phase 1
//                    does not migrate
//   FENCED_LEGACY    a legacy-only artifact of the production pipeline (not raw text), outside Phase-1 scope
//   PENDING_OWNER    needs an owner decision before it can be classified (a Phase-1 BLOCKER; none since ruling C1)
//   UNCLASSIFIED     no rule explains it (a Phase-1 BLOCKER)

const registry = require("./dialogue-registry");

const ANY = /^/;
const ROUTING = /^routing\./;
const TIER1_CLARIFY = new Set(["facet_weak", "force_uncertain", "addressee_no_evidence", "fragment_unresolved", "context_uncertain", "facet_unresolved", "addressee_ambiguous"]);
const SOCIAL_FN = Object.freeze({ greeting: "greet", farewell: "greet", self_introduction: "introduce_self", thanks: "acknowledge", social_acknowledgment: "acknowledge", sarcasm: "joke_or_sarcasm", statement: "make_statement" });

const CAUSES = Object.freeze({
  // ── owner-approved ──
  owner_ruling_1: { class: "OWNER_APPROVED", title: "Ruling 1: 'we all going?' is subject group_inclusive, address NONE; resolver policy chooses the responder", fields: [/^routing\.(addressees|recipients|responders|silence)$/, /^lifecycle\.request\.targets$/, /^frame\.(turn\.addressee_ids|target_scope)$/] },
  owner_ruling_2: { class: "OWNER_APPROVED", title: "Ruling 2: a marker-led line without a compatible antecedent is NEW", fields: [/^act\.relation\./, /^frame\.turn\.relation/, ROUTING, /^lifecycle\.request\.targets$/, /^frame\.turn\.addressee_ids$/] },
  owner_ruling_5: { class: "OWNER_APPROVED", title: "Ruling 5: a wh-led / asking-looking line read as a remark fails closed (clarify), never silent", fields: [ANY] },
  owner_phase1_clarify: { class: "OWNER_APPROVED", title: "Phase-1 item 8: a clarifying act gets ONE clarifier (never a default spokesperson), no inherited predicate or addressee, no fabricated args", fields: [/^routing\.(cardinality|addressees|recipients)$/, /^frame\.turn\.addressee_ids$/, /^frame\.turn\.cardinality$/, /^act\.(facet|temporal)$/, /^frame\.(predicate|turn\.temporal_scope|entity\.bound|referents|knowledge_query|requested_content|expected_slot|args\.)/, /^lifecycle\.(request\.predicate|activity)$/] },
  owner_decision_priority: { class: "OWNER_APPROVED", title: "Owner decision 2026-09-27 #1: knower, else fairness rotation -- over legacy's first-eligible listener for an item whose holder is not present", fields: [/^routing\.responders$/, /^lifecycle\.request\.targets$/] },
  // ── fenced: raw player words decide production (READER_RAW_TEXT_INVENTORY.md) ──
  raw_C4_address_correction: { class: "FENCED_RAW_TEXT", site: "C4", title: "resolveAddressCorrection overlay (raw text) decided the addressee", fields: [ANY] },
  raw_C5_address_overlay: { class: "FENCED_RAW_TEXT", site: "C5/C6", title: "parseAddressees / inferLocalRecipientType over the raw line set the recipients the analysis did not", fields: [ROUTING, /^lifecycle\.request\.targets$/, /^act\.temporal$/, /^frame\./] },
  raw_polite_preamble_vocative: { class: "FENCED_RAW_TEXT", site: "C5/C6 (named polite preamble)", title: "Production carries the explicitly named polite preamble into its following question; the frozen Reader act only contains names inside its own token span", fields: [/^routing\.(addressees|recipients|responders)$/, /^lifecycle\.request\.targets$/, /^frame\.turn\.addressee_ids$/] },
  raw_C7_recipient_scope: { class: "FENCED_RAW_TEXT", site: "C7", title: "resolveRecipientScope inherited recipients from raw-word overlap", fields: [/^routing\.(recipients|addressees)$/] },
  raw_answer_address_record: { class: "FENCED_RAW_TEXT", site: "C5/C6", title: "an answer keeps the raw-text address parse (addressFromTurn skips answers): no recipient", fields: [/^routing\.recipients$/] },
  raw_C8_follow_up: { class: "FENCED_RAW_TEXT", site: "C8/C10", title: "legacy inherited the addressee through isFollowUp / echo regexes", fields: [ROUTING, /^act\.relation\.target$/, /^frame\.turn\./, /^lifecycle\.request\.targets$/] },
  raw_D2_half_a_function: { class: "FENCED_RAW_TEXT", site: "D1/D2", title: "production's discourse function came from the second reader (interpretUtterance / buildSemanticFrame LP.* regexes), not from the act's facet", fields: [/^frame\./, /^routing\.(responders|silence|cardinality|recipients|addressees)$/, /^lifecycle\.request\.(intent|targets|predicate)$/, /^act\.facet$/] },
  raw_D2_frame_clarify: { class: "FENCED_RAW_TEXT", site: "D2 (half A/B over text)", title: "the frame builder clarified on its own reading of the words (ambiguous-reference / antecedent regexes); the act itself did not", fields: [/^frame\./, /^routing\.(cardinality|responders|silence)$/] },
  raw_D4_tier2_advisory: { class: "FENCED_RAW_TEXT", site: "D4", title: "an accepted Tier-2 advisory reading (a second reader, retired with Tier 2) re-typed the act", fields: [/^act\.temporal$/, /^frame\.(turn\.temporal_scope|entity\.bound|referents|requested_content)$/] },
  raw_D2_player_claim: { class: "FENCED_RAW_TEXT", site: "D2/C1", title: "legacy acknowledges a 'player claim' found by LP.claim_predicate + entity mention over the raw line", fields: [/^routing\.(responders|silence)$/, /^lifecycle\.request\.targets$/, /^frame\.(referents|entity\.bound)$/] },
  raw_C14_tier1_completeness: { class: "FENCED_RAW_TEXT", site: "C14/C15", title: "Tier-1 completeness / finalizeFrame clarify-over-guess read the clause's words", fields: [ANY] },
  raw_request_identity: { class: "FENCED_RAW_TEXT", site: "E3 (request_text identity)", title: "openTurnRequests re-opens a request only when its request_text matches; the shadow's identity is canonical", fields: [/^lifecycle\.request\.(intent|target)$/] },
  raw_closes_activity: { class: "FENCED_RAW_TEXT", site: "E6 (closes_activity)", title: "the round is closed by a parseActs closes_activity regex ('that's that'); ReaderFrame v2 expresses it as relation conclude, the difference remains where the adapter could not", fields: [/^lifecycle\.activity$/] },
  raw_C11_C12_facet: { class: "FENCED_RAW_TEXT", site: "C11/C12", title: "the facet / temporal came from fragment or item-role regex tables", fields: [/^act\.(facet|temporal)$/, /^frame\./, /^lifecycle\.request\.predicate$/] },
  raw_C16_anaphora: { class: "FENCED_RAW_TEXT", site: "C16", title: "intra-turn pronoun anaphora (service regex) supplied the subject; a pronoun has no name span", fields: [/^act\.subject/, /^frame\.(discourse_function|knowledge_query|args\.third_party_subject|expected_response_shape|requested_content)$/] },
  raw_half_b_entity: { class: "FENCED_RAW_TEXT", site: "D2 (half B over text)", title: "the entity came from resolveEntityMentions over the request text and is not a ReaderInput referent candidate", fields: [/^frame\.(entity\.bound|knowledge_query|referents|unresolved_reference|discourse_function|expected_response_shape|requested_content|expected_slot)$/, /^routing\.(responders|cardinality)$/, /^lifecycle\.request\.targets$/] },
  raw_B3_reaction_eligibility: { class: "FENCED_RAW_TEXT", site: "B3", title: "production's response eligibility came from the keyword reaction system", fields: [/^routing\.(responders|silence)$/, /^lifecycle\.request\.targets$/] },
  B7_optional_salience: { class: "FENCED_RAW_TEXT", site: "B7 (salience from optional facts)", title: "legacy salience read optional (possibly unspoken) facts; the ReaderInput uses canonical salience only (owner decision B7)", fields: [/^frame\./, /^act\.(facet|temporal)$/, ROUTING] },
  // Owner decision B7 (approved for Reader Phase 2): a place a coworker only NAMED in delivered wording is heard
  // salience -- it may be referred to by label, but it never becomes the canonical active place a bare "there"
  // resolves to. Legacy's reply-fact salience made it the topic; the shadow clarifies which place is meant.
  owner_B7_heard_not_active_place: { class: "OWNER_APPROVED", title: "B7: a place only heard in coworker wording is not the canonical active place; deictic 'there' clarifies", fields: [/^frame\./, /^routing\.(cardinality|responders|silence)$/, /^lifecycle\.request\.(intent|predicate)$/] },
  // ── fenced: legacy artifacts ──
  legacy_ellipsis_form_label: { class: "FENCED_LEGACY", title: "legacy labels an elliptical continuation 'wh' by default ('Tonya, have you?'); V1 rejects that form for the facet and the shadow fails closed", fields: [ANY] },
  legacy_answer_frame_drops_args: { class: "FENCED_LEGACY", title: "finalizeFrame's answer frame drops the act's arguments (answer option, reply kind) and keeps the pre-finalize shape", fields: [/^frame\.(args\.(answer_option|reply_kind)|expected_response_shape)$/] },
  legacy_inherited_reply_kind: { class: "FENCED_LEGACY", title: "legacy carries a reply_kind inherited with a repaired request's arguments; the shadow carries the question's arguments only", fields: [/^frame\.args\.reply_kind$/, /^lifecycle\.inbound$/] },
  legacy_answer_repair_response: { class: "FENCED_LEGACY", title: "an own-answer repair gets an acknowledgment only because its address record is direct (answers get none)", fields: [/^routing\.(responders|silence)$/] },
  legacy_clarify_without_owner: { class: "FENCED_LEGACY", title: "legacy decided to clarify but no owner could ask (the answer's empty address record); the shadow's one clarifier asks", fields: [ROUTING, /^lifecycle\./] },
  // Owner ruling C1 (2026-09-29): the question-form gate licenses NEW questions (follow-ups / echoes that keep their
  // antecedent's facet are exempt; registry forms widened for transition.participants, mission.schedule,
  // mission.route). A form rejection that REMAINS is the approved gate failing closed.
  owner_C1_new_question_form_gate: { class: "OWNER_APPROVED", title: "Ruling C1: a NEW question whose form does not license its facet fails closed", fields: [ANY] }
});

/** The discourse function a production frame WOULD have if its facet alone decided it (finalizeFrame's rules). */
function facetFunction(frame, speechAct) {
  const predicate = frame?.predicate ?? null;
  const entry = predicate ? registry.get(predicate) : null;
  if (!entry) return SOCIAL_FN[speechAct] ?? null;
  let fn = entry.route?.fn ?? "ask_predicate";
  if (frame?.turn?.args?.third_party_subject && ["check_in", "ask_opinion"].includes(fn)) fn = "ask_predicate";
  if (fn === "check_in" && frame?.turn?.temporal_scope === "earlier") fn = "ask_predicate";
  return fn;
}

/** The causes whose evidence holds for one turn. */
function turnCauses(record, out, pl) {
  const found = new Set();
  const notes = (record.legacy_v0?.conversion?.notes ?? []).map((n) => n.code);
  const verdict = (record.receipt?.verdict?.errors ?? []).map((e) => e.code);
  const prod = record.legacy?.primary_used ?? {};
  const fin = record.context?.finalized_frame ?? null;
  const pr = record.production_routing ?? {};
  const res = record.shadow?.resolution ?? {};
  const sp = res.primary ?? {};
  const legacyFrameAct = record.legacy_v0?.frame?.acts?.[Math.max(0, (record.legacy_v0?.frame?.acts?.length ?? 1) - 1)] ?? null;
  const prodClarify = fin?.discourse_function === "ambiguous_reference" || Boolean(prod.clarify);
  const shadowClarify = res.outcome === "clarify";
  const add = (code) => found.add(code);

  if (notes.includes("collective_subject_routed_as_group_address")) add("owner_ruling_1");
  if (notes.includes("relation_without_antecedent")) add("owner_ruling_2");
  if (verdict.includes("non_asking_reading_with_asking_features")) add("owner_ruling_5");
  if (shadowClarify && prodClarify) add("owner_phase1_clarify");
  if (verdict.includes("question_form_incompatible")) {
    if (prod.speech_act === "elliptical_continuation" || legacyFrameAct?.speech_act === "elliptical_continuation") add("legacy_ellipsis_form_label");
    else add("owner_C1_new_question_form_gate");
  }
  // Item ownership with the holder absent: legacy answers with the first eligible listener; the shadow follows the
  // ratified priority (knower, else rotation).
  const holder = (fin?.referents ?? []).find((r) => r.type === "equipment" && r.resolved)?.holder ?? null;
  if (fin?.discourse_function === "ask_item_ownership" && holder && !(pr.listener_ids ?? []).includes(holder) && ["knowledgeable_responder", "fairness_rotation"].includes(res.routing?.owner_basis)) add("owner_decision_priority");

  if (prod.addressee?.source === "legacy_correction") add("raw_C4_address_correction");
  const analysisIds = [...(prod.addressee?.ids ?? [])].sort().join(",");
  if ((pr.recipient_ids ?? []).length && pr.address_source === "explicit" && [...pr.recipient_ids].sort().join(",") !== analysisIds && prod.addressee?.source !== "collective") add("raw_C5_address_overlay");
  if (prod.addressee?.source === "vocative" && (prod.addressee.ids ?? []).length === 1 && !(sp.addressee?.ids ?? []).length && /,\s*(?:I hope you (?:don't|do not) mind me asking|may I ask|can I ask)[\s\S]*\b(?:but|and)\s+(?:are|have|do|is|can|will)\b/i.test(record.input?.line?.raw ?? "")) add("raw_polite_preamble_vocative");
  if (pr.address_form === "inherited") add("raw_C7_recipient_scope");
  if (prod.speech_act === "answer" && !(pr.recipient_ids ?? []).length) add("raw_answer_address_record");
  if (["antecedent_owner", "surface_anchor"].includes(prod.addressee?.source)) add("raw_C8_follow_up");
  const expectedFn = facetFunction(fin, prod.speech_act);
  if (fin && !prodClarify && fin.discourse_function !== "attend" && !(prod.speech_act === "answer") && expectedFn && fin.discourse_function !== expectedFn) add("raw_D2_half_a_function");
  if (fin && !fin.predicate && ["question", "request"].includes(prod.speech_act) && !prodClarify) add("raw_D2_half_a_function");
  if ((fin?.discourse_function === "ambiguous_reference" || fin?.unresolved_reference) && !prod.clarify && !fin?.turn?.clarify_reason) add("raw_D2_frame_clarify");
  // A reply kind the act merely INHERITED with a repaired request's arguments (how an earlier line replied).
  if (fin?.turn?.args?.reply_kind && prod.relation !== "answer" && !(prod.relation === "continuation" && prod.addressee?.source === "inbound_asker")) add("legacy_inherited_reply_kind");
  if (prod.facet_source === "tier2_advisory") add("raw_D4_tier2_advisory");
  if (prod.speech_act === "answer") add("legacy_answer_frame_drops_args");
  if (fin?.player_claim && (pr.owner_ids ?? []).length && !(res.routing?.responders ?? []).length) add("raw_D2_player_claim");
  const tier1 = fin?.turn?.clarify_reason ?? prod.clarify?.reason ?? null;
  if ((tier1 && TIER1_CLARIFY.has(tier1) && !shadowClarify) || (prodClarify && TIER1_CLARIFY.has(tier1) && shadowClarify)) add("raw_C14_tier1_completeness");
  if (pl?.request?.intent === "supersede_and_open" && res.lifecycle?.request?.intent === "reopen") add("raw_request_identity");
  if (record.legacy?.closes_activity) add("raw_closes_activity");
  if (["discourse_followup", "item_role", "inbound_counter"].includes(prod.facet_source)) add("raw_C11_C12_facet");
  if (notes.includes("subject_without_name_span")) add("raw_C16_anaphora");
  const prodEntity = fin?.knowledge_query?.entity?.id ?? null;
  const shadowEntity = record.shadow?.frame?.knowledge_query?.entity?.id ?? null;
  const textReferent = (fin?.referents ?? []).find((r) => r.type === "equipment" && r.resolved)?.id ?? null;
  if (textReferent && fin?.turn?.args?.item_id && textReferent !== fin.turn.args.item_id) add("raw_half_b_entity");
  if ((!prodEntity && shadowEntity && fin?.discourse_function === record.shadow?.frame?.discourse_function) || notes.includes("referent_not_in_candidates") || (prodEntity && !Object.values(record.context?.bindings?.referents ?? {}).includes(prodEntity) && !Object.values(record.context?.bindings?.names ?? {}).includes(prodEntity))) add("raw_half_b_entity");
  const flags = pr.candidate_flags ?? {};
  if ((res.routing?.responders ?? []).some((id) => flags[id] && !flags[id].response_eligible) || ((pr.owner_ids ?? []).length === 0 && Object.values(flags).every((f) => !f.response_eligible) && Object.keys(flags).length)) add("raw_B3_reaction_eligibility");
  if (notes.includes("salient_place_from_legacy_salience")) add("B7_optional_salience");
  const heardIds = (record.input?.heard?.salient_entities ?? []).map((l) => record.context?.bindings?.referents?.[l]).filter(Boolean);
  const prodPlace = fin?.turn?.args?.place_id ?? fin?.knowledge_query?.entity?.id ?? null;
  if (res.clarification?.reason === "deixis_without_antecedent" && !record.input?.conversation?.active_place && prodPlace && heardIds.includes(prodPlace)) add("owner_B7_heard_not_active_place");
  if (prod.args?.reply_kind === "answer_repair" && (pr.owner_ids ?? []).length) add("legacy_answer_repair_response");
  if (prodClarify && !(pr.owner_ids ?? []).length && shadowClarify) add("legacy_clarify_without_owner");
  return [...found];
}

/** The reason codes for one mismatch (a field of a level), given the turn's causes. */
function reasonsFor(level, diff, causes) {
  const key = `${level}.${diff.field}`;
  const hits = causes.filter((code) => CAUSES[code].fields.some((re) => re.test(key)));
  return hits.length ? hits : ["UNCLASSIFIED"];
}

module.exports = { CAUSES, turnCauses, reasonsFor, facetFunction };
