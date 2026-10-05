"use strict";

// Reader Phase 0 -- the ReaderFrame v1 contract and its NON-MODEL validators (V0-V3).
//
// A ReaderFrame is what ONE language reader (legacy reader v0 today; a pinned local model later) may say about
// ONE player line: linguistic interpretation only. It never names a canonical id, a final responder, a
// response cardinality, a fact, a state change, knowledge or hidden state. Every reference it makes is a
// label that code supplied in the ReaderInput (dialogue-reader-input.js) and that code alone maps back to
// canonical ids. Responder policy (who answers, inheritance, rotation, cardinality) is the resolver's
// (dialogue-resolve-turn.js), never the reader's.
//
// Validation layers (pure, deterministic, no calibration / logprob / agreement gating in Phase 0):
//   V0 schema      closed enums, <= 3 acts, ordered non-overlapping token spans, no unknown keys  -> reject frame
//   V1 candidates  every label from the supplied lists; facet in registry; form / temporal / referent-kind
//                  compatible with the facet                                                      -> reject field
//   V2 surface     chip target wins; NAMED needs a supplied name span; no invented or absent names; a standalone
//                  name is read against the DIS                                                   -> clarify / reject
//   V3 discourse   answer needs a pending inbound request; continuation / repair / topic_return need an eligible
//                  antecedent; OTHERS / EXCEPT resolve to non-empty sets; withdraw targets open state; conclude
//                  targets only the active activity                                              -> clarify
//
// v2 (Reader Phase 2): relation `conclude` ("Okay, that's that") -- the reader expresses the LINGUISTIC relation
// only; it may target the active activity label v1 (or nothing), and code (the resolver, then canonical
// closeActivity) remains the authority for any closure. `withdraw` may target v1. `referent.nominated` lets a
// reader point at a token span it could not bind; code gives it ONE bounded observer-safe lookup before
// validation (dialogue-reader-lexicon.lookupNominated via applyNominatedLookup).

const registry = require("./dialogue-registry");

const READER_FRAME_VERSION = "yellow-beast-reader-frame@v2";
const MAX_ACTS = 3;

const SPEECH_ACTS = Object.freeze(["greeting", "farewell", "self_introduction", "social_acknowledgment", "thanks", "attention_call", "statement", "sarcasm", "question", "request", "repair", "elliptical_continuation", "answer", "aside"]);
const QUESTION_FORMS = Object.freeze(["wh", "yes_no", "choice", "declarative", "indirect", "tag", "count", "none"]);
const FACET_SPECIAL = Object.freeze(["NONE_ASKING", "NOT_APPLICABLE"]);
const POLARITIES = Object.freeze(["positive", "negative", "inverted"]);
// repair_target: the person an addressee repair re-addresses ("No, I was asking Malcolm") -- named as a mention,
// meant as the new addressee.
const NAME_ROLES = Object.freeze(["vocative", "mention", "answer_to_inbound", "greeting_target", "repair_target"]);
// Language-level address operations ONLY. Responder policy values (KEEP_RESPONDER, SHARED, ASKER_OF_INBOUND,
// ANSWERER_OF) are resolver outcomes and are deliberately absent.
const ADDRESS_OPS = Object.freeze(["NAMED", "ALL", "OTHERS", "EXCEPT", "SECOND_PERSON", "NONE"]);
const RELATIONS = Object.freeze(["new", "continuation", "repair", "topic_return", "attention", "answer", "withdraw", "conclude"]);
const REPAIR_KINDS = Object.freeze(["addressee", "referent", "facet", "temporal", "unanswered", "own_answer"]);
// Deixis (Reader Phase 1): the act refers to a place deictically without naming it. DEIXIS_THERE ("there", "that
// place") needs an active place; DEIXIS_INSIDE ("going in", "inside") takes the canonical default (owner decision
// 2026-09-27 #4) when nothing is active. Which place it is stays the resolver's decision, never the reader's.
const DEIXIS_SPECIAL = Object.freeze(["DEIXIS_THERE", "DEIXIS_INSIDE"]);
const REFERENT_CHOICE_SPECIAL = Object.freeze(["NONE", "AMBIGUOUS", ...DEIXIS_SPECIAL]);
const TEMPORALS = Object.freeze(["unspecified", "now", "today", "earlier", "ever", "historical"]);
const RESPONDENT_MODES = Object.freeze(["unspecified", "each", "any", "all"]);
const INBOUND_KINDS = Object.freeze(["answer", "uncertainty", "refusal", "counter_question", "none"]);
const INBOUND_OPTION_SPECIAL = Object.freeze(["YES", "NO", "BOTH", "NEITHER", "EITHER", "NONE_OF_OFFERED"]);
const SUBJECT_KINDS = Object.freeze(["addressee", "speaker", "named", "group", "group_inclusive", "none"]);
// The families the existing LOCAL order path already backs (tools/q4-local-intent.js). The reader only says an
// action was requested and of which family, so the turn can be HANDED OFF; it never builds or issues the order.
const ACTION_FAMILIES = Object.freeze(["STAY", "FOLLOW", "WAIT", "MOVE", "RETURN", "REPORT", "ASSIST", "INVESTIGATE", "TRANSFER", "QUERY", "OTHER"]);
const ABSTAIN_FIELDS = Object.freeze(["force", "address", "facet", "relation", "referent", "subject", "temporal", "inbound_answer"]);

// Label shapes code supplies in the ReaderInput. A reader may use only labels present in the input.
// claim (Reader Phase 1, owner ruling 3): the player's own previous claim ("I've been in the Complex before." ->
// "Tonya, have you?"), from reader state, never from persisted legacy clause predicates.
const LABEL = Object.freeze({ name: /^n\d+$/, entity: /^e\d+$/, request: /^q\d+$/, inbound: /^i\d+$/, referent: /^r\d+$/, anchor: /^a\d+$/, option: /^o\d+$/, person: /^p\d+$/, same_turn: /^s[0-2]$/, activity: /^v\d+$/, claim: /^c\d+$/ });

// Validator dispositions (Reader Phase 1): what the shadow resolver consumes. INVALID = no frame, or a frame that
// failed V0 (not a reading at all).
const DISPOSITIONS = Object.freeze({ ACCEPT: "ACCEPT", CLARIFY: "CLARIFY", REJECT_FIELDS: "REJECT_FIELDS", INVALID: "INVALID" });
function dispositionOf(verdict) {
  if (!verdict) return DISPOSITIONS.INVALID;
  return { accept: DISPOSITIONS.ACCEPT, clarify: DISPOSITIONS.CLARIFY, reject_fields: DISPOSITIONS.REJECT_FIELDS, reject: DISPOSITIONS.INVALID }[verdict.disposition] ?? DISPOSITIONS.INVALID;
}

// Keys allowed at each level (additionalProperties: false). Anything else is rejected at V0.
const FRAME_KEYS = ["version", "acts"];
const ACT_KEYS = ["span", "speech_act", "question_form", "facet", "polarity", "name_roles", "address", "relation", "repair_kind", "referent", "temporal", "respondent_mode", "inbound_answer", "subject", "self_intro", "echo", "requested_action", "abstain"];
const REQUIRED_ACT_KEYS = ["span", "speech_act", "question_form", "facet", "polarity", "address", "relation", "temporal", "respondent_mode", "abstain"];
const NESTED_KEYS = {
  address: ["op", "names", "relative_to", "count"],
  relation: ["kind", "target"],
  referent: ["span", "candidate", "nominated"],
  inbound_answer: ["kind", "option"],
  subject: ["kind", "names"],
  self_intro: ["span"],
  echo: ["anchor"],
  requested_action: ["family", "object"],
  name_role: ["name", "role"]
};

const FACETS = () => registry.ids();
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
// Request states a discourse relation may still point at (ledger vocabulary, tools/dialogue-state.js).
const ELIGIBLE_ANTECEDENT_STATES = new Set(["OPEN", "PARTIALLY_SATISFIED", "SATISFIED", "ANSWERED_UNKNOWN", "ANSWERED_NOT_ESTABLISHED", "CLARIFYING"]);
const OPEN_STATES = new Set(["OPEN", "PARTIALLY_SATISFIED", "CLARIFYING"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const err = (layer, code, detail = {}) => Object.freeze({ layer, code, ...detail });

/**
 * The JSON schema a grammar-constrained reader would decode against, built from ONE ReaderInput's labels
 * (closed enums everywhere, additionalProperties false). Used by the runtime spike; nothing in production
 * decodes with it in Phase 0.
 */
function readerFrameSchema(input = {}) {
  const labels = (list) => (list ?? []).map((x) => x.label);
  const nameLabels = labels(input.features?.name_spans);
  const entityLabels = labels(input.features?.entity_spans);
  const requestLabels = labels(input.conversation?.requests);
  const inboundLabels = [input.conversation?.inbound?.label, input.conversation?.just_answered_inbound?.label].filter(Boolean);
  const referentLabels = labels(input.referent_candidates);
  const anchorLabels = labels(input.heard?.anchors);
  const optionLabels = labels(input.conversation?.inbound?.options);
  const tokenMax = Math.max(0, (input.line?.tokens?.length ?? 1) - 1);
  const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
  const enumOrNull = (values) => (values.length ? nullable({ type: "string", enum: values }) : { type: "null" });
  const strict = (properties, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
  const span = { type: "array", items: { type: "integer", minimum: 0, maximum: tokenMax }, minItems: 2, maxItems: 2 };
  const act = strict({
    span,
    speech_act: { type: "string", enum: [...SPEECH_ACTS] },
    question_form: { type: "string", enum: [...QUESTION_FORMS] },
    facet: { type: "string", enum: [...FACETS(), ...FACET_SPECIAL] },
    polarity: { type: "string", enum: [...POLARITIES] },
    name_roles: { type: "array", maxItems: 6, items: strict({ name: { type: "string", enum: nameLabels.length ? nameLabels : ["n0"] }, role: { type: "string", enum: [...NAME_ROLES] } }) },
    address: strict({ op: { type: "string", enum: [...ADDRESS_OPS] }, names: { type: "array", maxItems: 4, items: { type: "string", enum: nameLabels.length ? nameLabels : ["n0"] } }, relative_to: enumOrNull(requestLabels), count: nullable({ type: "integer", minimum: 2, maximum: 6 }) }),
    // A relation's antecedent: a ledger request, a coworker question, an earlier act of this line, the active
    // activity round ("your turn"), or a heard line (a surface anchor: "what do you mean?").
    relation: strict({ kind: { type: "string", enum: [...RELATIONS] }, target: enumOrNull([...requestLabels, ...inboundLabels, "s0", "s1", ...(input.conversation?.activity?.label ? [input.conversation.activity.label] : []), ...anchorLabels, ...(input.conversation?.player_claim?.label ? [input.conversation.player_claim.label] : [])]) }),
    repair_kind: nullable({ type: "string", enum: [...REPAIR_KINDS] }),
    referent: nullable(strict({ span: enumOrNull(entityLabels), candidate: { type: "string", enum: [...referentLabels, ...REFERENT_CHOICE_SPECIAL] }, nominated: nullable(span) }, ["span", "candidate"])),
    temporal: { type: "string", enum: [...TEMPORALS] },
    respondent_mode: { type: "string", enum: [...RESPONDENT_MODES] },
    inbound_answer: nullable(strict({ kind: { type: "string", enum: [...INBOUND_KINDS] }, option: enumOrNull([...optionLabels, ...INBOUND_OPTION_SPECIAL]) })),
    subject: nullable(strict({ kind: { type: "string", enum: [...SUBJECT_KINDS] }, names: { type: "array", maxItems: 4, items: { type: "string", enum: nameLabels.length ? nameLabels : ["n0"] } } })),
    self_intro: nullable(strict({ span })),
    echo: nullable(strict({ anchor: { type: "string", enum: anchorLabels.length ? anchorLabels : ["a0"] } })),
    requested_action: nullable(strict({ family: { type: "string", enum: [...ACTION_FAMILIES] }, object: enumOrNull(referentLabels) })),
    abstain: { type: "array", maxItems: ABSTAIN_FIELDS.length, items: { type: "string", enum: [...ABSTAIN_FIELDS] } }
  }, REQUIRED_ACT_KEYS);
  return strict({ version: { type: "string", enum: [READER_FRAME_VERSION] }, acts: { type: "array", minItems: 1, maxItems: MAX_ACTS, items: act } });
}

// ─── V0 schema ───────────────────────────────────────────────────────────────────────────────────────
function unknownKeys(obj, allowed) { return Object.keys(obj).filter((k) => !allowed.includes(k)); }
function checkEnum(errors, value, list, where) { if (!list.includes(value)) errors.push(err("V0", "enum", { where, value })); }
function checkLabelList(errors, list, pattern, where, max = 6) {
  if (!Array.isArray(list)) { errors.push(err("V0", "type", { where })); return; }
  if (list.length > max) errors.push(err("V0", "too_many", { where }));
  for (const v of list) if (typeof v !== "string" || !pattern.test(v)) errors.push(err("V0", "label_shape", { where, value: v }));
}
function checkNullableLabel(errors, v, patterns, where, specials = []) {
  if (v === null || v === undefined) return;
  if (typeof v !== "string" || !(specials.includes(v) || patterns.some((p) => p.test(v)))) errors.push(err("V0", "label_shape", { where, value: v }));
}
function checkNested(errors, value, name, where) {
  if (value === null || value === undefined) return false;
  if (!isObj(value)) { errors.push(err("V0", "type", { where })); return false; }
  const extra = unknownKeys(value, NESTED_KEYS[name]);
  if (extra.length) errors.push(err("V0", "unknown_key", { where, keys: extra }));
  return true;
}
function checkTokenSpan(errors, span, tokenCount, where) {
  if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isInteger)) { errors.push(err("V0", "span_shape", { where })); return null; }
  const [a, b] = span;
  if (a < 0 || b < a || b >= tokenCount) { errors.push(err("V0", "span_range", { where, span })); return null; }
  return [a, b];
}

function validateSchema(frame, input = {}) {
  const errors = [];
  if (!isObj(frame)) return { ok: false, errors: [err("V0", "not_an_object")] };
  const extra = unknownKeys(frame, FRAME_KEYS);
  if (extra.length) errors.push(err("V0", "unknown_key", { where: "frame", keys: extra }));
  if (frame.version !== READER_FRAME_VERSION) errors.push(err("V0", "version", { value: frame.version }));
  if (!Array.isArray(frame.acts) || !frame.acts.length) return { ok: false, errors: [...errors, err("V0", "no_acts")] };
  if (frame.acts.length > MAX_ACTS) errors.push(err("V0", "too_many_acts", { count: frame.acts.length }));
  const tokenCount = input.line?.tokens?.length ?? Infinity;
  let previousEnd = -1;
  frame.acts.forEach((act, i) => {
    const at = (field) => `acts[${i}].${field}`;
    if (!isObj(act)) { errors.push(err("V0", "type", { where: `acts[${i}]` })); return; }
    const unknown = unknownKeys(act, ACT_KEYS);
    if (unknown.length) errors.push(err("V0", "unknown_key", { where: `acts[${i}]`, keys: unknown }));
    for (const key of REQUIRED_ACT_KEYS) if (!(key in act)) errors.push(err("V0", "missing", { where: at(key) }));
    const span = checkTokenSpan(errors, act.span, tokenCount, at("span"));
    if (span) { if (span[0] <= previousEnd) errors.push(err("V0", "span_order", { where: at("span") })); previousEnd = span[1]; }
    checkEnum(errors, act.speech_act, SPEECH_ACTS, at("speech_act"));
    checkEnum(errors, act.question_form, QUESTION_FORMS, at("question_form"));
    if (typeof act.facet !== "string") errors.push(err("V0", "type", { where: at("facet") }));
    checkEnum(errors, act.polarity, POLARITIES, at("polarity"));
    checkEnum(errors, act.temporal, TEMPORALS, at("temporal"));
    checkEnum(errors, act.respondent_mode, RESPONDENT_MODES, at("respondent_mode"));
    if (act.name_roles !== undefined) {
      if (!Array.isArray(act.name_roles)) errors.push(err("V0", "type", { where: at("name_roles") }));
      else act.name_roles.forEach((r, j) => { if (checkNested(errors, r, "name_role", at(`name_roles[${j}]`))) { checkNullableLabel(errors, r.name, [LABEL.name], at(`name_roles[${j}].name`)); checkEnum(errors, r.role, NAME_ROLES, at(`name_roles[${j}].role`)); } });
    }
    if (checkNested(errors, act.address, "address", at("address"))) {
      checkEnum(errors, act.address.op, ADDRESS_OPS, at("address.op"));
      checkLabelList(errors, act.address.names ?? [], LABEL.name, at("address.names"), 4);
      checkNullableLabel(errors, act.address.relative_to, [LABEL.request], at("address.relative_to"));
      if (act.address.count != null && !(Number.isInteger(act.address.count) && act.address.count >= 2 && act.address.count <= 6)) errors.push(err("V0", "range", { where: at("address.count") }));
    } else if ("address" in act) errors.push(err("V0", "missing", { where: at("address") }));
    if (checkNested(errors, act.relation, "relation", at("relation"))) {
      checkEnum(errors, act.relation.kind, RELATIONS, at("relation.kind"));
      checkNullableLabel(errors, act.relation.target, [LABEL.request, LABEL.inbound, LABEL.same_turn, LABEL.activity, LABEL.anchor, LABEL.claim], at("relation.target"));
    } else if ("relation" in act) errors.push(err("V0", "missing", { where: at("relation") }));
    if (act.repair_kind != null) checkEnum(errors, act.repair_kind, REPAIR_KINDS, at("repair_kind"));
    if (checkNested(errors, act.referent, "referent", at("referent"))) {
      checkNullableLabel(errors, act.referent.span, [LABEL.entity], at("referent.span"));
      checkNullableLabel(errors, act.referent.candidate, [LABEL.referent], at("referent.candidate"), REFERENT_CHOICE_SPECIAL);
      if (act.referent.nominated != null) checkTokenSpan(errors, act.referent.nominated, tokenCount, at("referent.nominated"));
    }
    if (checkNested(errors, act.inbound_answer, "inbound_answer", at("inbound_answer"))) {
      checkEnum(errors, act.inbound_answer.kind, INBOUND_KINDS, at("inbound_answer.kind"));
      checkNullableLabel(errors, act.inbound_answer.option, [LABEL.option], at("inbound_answer.option"), INBOUND_OPTION_SPECIAL);
    }
    if (checkNested(errors, act.subject, "subject", at("subject"))) {
      checkEnum(errors, act.subject.kind, SUBJECT_KINDS, at("subject.kind"));
      checkLabelList(errors, act.subject.names ?? [], LABEL.name, at("subject.names"), 4);
    }
    if (checkNested(errors, act.self_intro, "self_intro", at("self_intro"))) checkTokenSpan(errors, act.self_intro.span, tokenCount, at("self_intro.span"));
    if (checkNested(errors, act.echo, "echo", at("echo"))) checkNullableLabel(errors, act.echo.anchor, [LABEL.anchor], at("echo.anchor"));
    if (checkNested(errors, act.requested_action, "requested_action", at("requested_action"))) {
      checkEnum(errors, act.requested_action.family, ACTION_FAMILIES, at("requested_action.family"));
      checkNullableLabel(errors, act.requested_action.object, [LABEL.referent], at("requested_action.object"));
    }
    if (!Array.isArray(act.abstain)) errors.push(err("V0", "type", { where: at("abstain") }));
    else for (const f of act.abstain) checkEnum(errors, f, ABSTAIN_FIELDS, at("abstain"));
  });
  return { ok: errors.length === 0, errors };
}

// ─── V1 candidates ───────────────────────────────────────────────────────────────────────────────────
// Reader question forms -> the registry's question_forms vocabulary.
const FORM_TO_REGISTRY = Object.freeze({ wh: "wh", yes_no: "yes_no", declarative: "yes_no", tag: "yes_no", choice: "choice", count: "count" });
const SLOT_KIND = Object.freeze({ equipment: "item", place: "place" });

/**
 * Why an act's facet is INHERITED rather than asked anew (owner ruling C1), or null: an echo whose anchored heard
 * sentence carries this facet ("echo"), or a continuation / repair / topic return / attention whose named
 * antecedent (request, coworker question, earlier act of the line, activity round, heard sentence, player claim)
 * carries this facet ("continuation"). Label existence and eligibility are checked elsewhere (V1 / V3); an
 * unknown label yields no antecedent facet here, so the gate applies.
 */
function inheritedFacetBasis(act, i, frame, input = {}) {
  const conv = input.conversation ?? {};
  const anchors = input.heard?.anchors ?? [];
  if (act.echo?.anchor) { const anchor = anchors.find((a) => a.label === act.echo.anchor); if (anchor?.facet && anchor.facet === act.facet) return "echo"; }
  const kind = act.relation?.kind;
  const target = act.relation?.target ?? null;
  if (!target || !["continuation", "repair", "topic_return", "attention"].includes(kind)) return null;
  const facet = LABEL.request.test(target) ? (conv.requests ?? []).find((r) => r.label === target)?.facet
    : target === conv.inbound?.label ? conv.inbound?.facet
      : LABEL.same_turn.test(target) && Number(target.slice(1)) < i ? frame.acts[Number(target.slice(1))]?.facet
        : LABEL.activity.test(target) && conv.activity?.label === target ? conv.activity.facet
          : LABEL.anchor.test(target) ? anchors.find((a) => a.label === target)?.facet
            : LABEL.claim.test(target) && conv.player_claim?.label === target ? conv.player_claim.facet : null;
  return facet && facet === act.facet ? "continuation" : null;
}

function validateCandidates(frame, input = {}) {
  const errors = [];
  const exemptions = [];
  const has = (list, label) => (list ?? []).some((x) => x.label === label);
  const names = input.features?.name_spans ?? [];
  const entities = input.features?.entity_spans ?? [];
  const requests = input.conversation?.requests ?? [];
  const inbound = [input.conversation?.inbound, input.conversation?.just_answered_inbound].filter(Boolean);
  const referents = input.referent_candidates ?? [];
  const anchors = input.heard?.anchors ?? [];
  const options = input.conversation?.inbound?.options ?? [];
  const facets = new Set(FACETS());
  frame.acts.forEach((act, i) => {
    const at = (field) => `acts[${i}].${field}`;
    const reject = (field, code, detail = {}) => errors.push(err("V1", code, { act: i, field, ...detail }));
    for (const r of act.name_roles ?? []) if (!has(names, r.name)) reject("name_roles", "unknown_name_span", { value: r.name });
    for (const n of act.address?.names ?? []) if (!has(names, n)) reject("address", "unknown_name_span", { value: n });
    if (act.address?.relative_to && !has(requests, act.address.relative_to)) reject("address", "unknown_request", { value: act.address.relative_to });
    for (const n of act.subject?.names ?? []) if (!has(names, n)) reject("subject", "unknown_name_span", { value: n });
    const target = act.relation?.target ?? null;
    if (target && LABEL.request.test(target) && !has(requests, target)) reject("relation", "unknown_request", { value: target });
    if (target && LABEL.inbound.test(target) && !inbound.some((x) => x.label === target)) reject("relation", "unknown_inbound", { value: target });
    if (target && LABEL.same_turn.test(target) && Number(target.slice(1)) >= i) reject("relation", "same_turn_forward_reference", { value: target });
    if (target && LABEL.activity.test(target) && input.conversation?.activity?.label !== target) reject("relation", "unknown_activity", { value: target });
    if (target && LABEL.anchor.test(target) && !has(anchors, target)) reject("relation", "unknown_anchor", { value: target });
    if (target && LABEL.claim.test(target) && input.conversation?.player_claim?.label !== target) reject("relation", "unknown_claim", { value: target });
    if (act.referent?.span && !has(entities, act.referent.span)) reject("referent", "unknown_entity_span", { value: act.referent.span });
    if (act.referent?.candidate && !REFERENT_CHOICE_SPECIAL.includes(act.referent.candidate) && !has(referents, act.referent.candidate)) reject("referent", "unknown_referent", { value: act.referent.candidate });
    if (act.echo?.anchor && !has(anchors, act.echo.anchor)) reject("echo", "unknown_anchor", { value: act.echo.anchor });
    if (act.inbound_answer?.option && !INBOUND_OPTION_SPECIAL.includes(act.inbound_answer.option) && !has(options, act.inbound_answer.option)) reject("inbound_answer", "unknown_option", { value: act.inbound_answer.option });
    if (act.requested_action?.object && !has(referents, act.requested_action.object)) reject("requested_action", "unknown_referent", { value: act.requested_action.object });
    // A referent is LICENSED only by an entity span in this act, conversation salience (incl. the active place)
    // or the explicit anaphoric set -- never merely because a candidate exists.
    const licensed = licensedReferents(act, input);
    if (act.referent?.candidate && !REFERENT_CHOICE_SPECIAL.includes(act.referent.candidate) && has(referents, act.referent.candidate) && !licensed.has(act.referent.candidate)) reject("referent", "referent_not_licensed", { value: act.referent.candidate });
    if (act.requested_action?.object && has(referents, act.requested_action.object) && !licensed.has(act.requested_action.object)) reject("requested_action", "referent_not_licensed", { value: act.requested_action.object });
    // Facet: in the registry, or one of the two special values.
    const special = FACET_SPECIAL.includes(act.facet);
    if (!special && !facets.has(act.facet)) { reject("facet", "unknown_facet", { value: act.facet }); return; }
    if (special) {
      if (act.facet === "NOT_APPLICABLE" && ASKING.has(act.speech_act) && act.speech_act !== "attention_call" && act.speech_act !== "repair" && !act.abstain.includes("facet")) reject("facet", "asking_act_without_facet", { at: at("facet") });
      return;
    }
    const entry = registry.get(act.facet);
    // Owner ruling C1 (2026-09-29): the question-form gate (form and wh-word <-> facet) licenses a NEW question.
    // A continuation / follow-up that keeps its named antecedent's facet ("when was that", "who else", "Not today.
    // Ever.") and an echo of a heard sentence that keeps the anchored facet ("cargo?") inherit the facet: the
    // shortened surface form need not license it on its own. The relation / anchor itself is still validated (V1
    // labels, V3 eligibility), and a facet that DIFFERS from the antecedent's is a new question and meets the gate.
    const inherited = inheritedFacetBasis(act, i, frame, input);
    if (inherited) exemptions.push({ act: i, code: `form_gate_${inherited}`, facet: act.facet });
    else {
      // Question form <-> facet.
      const form = FORM_TO_REGISTRY[act.question_form] ?? null;
      if (form && ASKING.has(act.speech_act) && Array.isArray(entry.question_forms) && entry.question_forms.length && !entry.question_forms.includes(form)) reject("facet", "question_form_incompatible", { facet: act.facet, form: act.question_form });
      // The act's own wh-word (a code feature) must be one the facet can be asked with.
      const wh = whWordOf(act, input);
      if (wh && act.question_form === "wh" && !registry.whCompatible(act.facet, wh)) reject("facet", "wh_incompatible", { facet: act.facet, wh });
    }
    // Temporal scope the facet supports.
    if (act.temporal !== "unspecified" && Array.isArray(entry.temporal_support) && !entry.temporal_support.includes(act.temporal)) reject("temporal", "temporal_unsupported", { facet: act.facet, temporal: act.temporal });
    // Referent kind <-> the facet's slots.
    const candidate = act.referent?.candidate && !REFERENT_CHOICE_SPECIAL.includes(act.referent.candidate) ? referents.find((r) => r.label === act.referent.candidate) : null;
    const slotKinds = Object.values(entry.slots ?? {}).map((k) => SLOT_KIND[k]).filter(Boolean);
    if (candidate && slotKinds.length && !slotKinds.includes(candidate.kind)) reject("referent", "referent_kind_incompatible", { facet: act.facet, kind: candidate.kind });
    // A deictic place reference needs a facet that takes a place.
    if (DEIXIS_SPECIAL.includes(act.referent?.candidate) && !slotKinds.includes("place")) reject("referent", "deixis_without_place_slot", { facet: act.facet });
  });
  return { ok: errors.length === 0, errors, exemptions };
}

/**
 * Referent labels an act may choose: entity spans inside the act, things the line named, canonical salience (the
 * player's words and canonical interaction state), the active place, anaphora -- and (Reader Phase 2, owner
 * decision B7) HEARD salience: a thing delivered coworker wording named may be referred to conversationally.
 */
function licensedReferents(act, input) {
  const [a, b] = Array.isArray(act.span) ? act.span : [0, -1];
  const conv = input.conversation ?? {};
  return new Set([
    ...(input.features?.entity_spans ?? []).filter((e) => e.tokens[0] >= a && e.tokens[1] <= b).map((e) => e.canonical_candidate ?? e.candidate),
    // Things the player's own line named, incl. the items a named task canonically carries (basis "line").
    ...(input.referent_candidates ?? []).filter((r) => r.basis === "line" || r.basis === "nominated").map((r) => r.label),
    ...(conv.salient_entities ?? []), conv.active_place, ...(conv.anaphora_candidates ?? []),
    ...(input.heard?.salient_entities ?? [])
  ].filter(Boolean));
}
/** Lower-cased words of an act's span (code features: the tokens the input already carries). */
function wordsIn(act, input) {
  const [a, b] = Array.isArray(act.span) ? act.span : [0, -1];
  // Possessives count as the word itself ("everyone's first day" is evidence for "everyone").
  return (input.line?.tokens ?? []).slice(a, b + 1).map((t) => String(t.text).toLowerCase().replace(/['\u2019]s$/, ""));
}
// Room-wide address evidence, universal ("everyone") or existential ("anyone", "someone": respondent mode any).
const ALL_WORDS = new Set(["all", "everyone", "everybody", "both", "guys", "team", "whole", "yall", "y'all", "anyone", "anybody", "any", "someone", "somebody", "each", "every", "yourselves", "folks"]);
const OTHERS_WORDS = new Set(["rest", "others", "other", "else"]);
const EXCEPT_WORDS = new Set(["except", "besides", "excluding", "apart"]);
const MODE_WORDS = new Set(["each", "every", "everyone", "everybody", "all", "any", "anyone", "anybody", "someone", "somebody", "both", "whole", "yall", "y'all", "guys", "yourselves", "folks"]);
const NON_ASKING = new Set(["statement", "aside", "sarcasm", "social_acknowledgment"]);
const WH_WORDS = new Set(["who", "whom", "whose", "what", "where", "when", "why", "how", "which"]);

/** The first wh-word token inside an act's span (a code feature, never a reader output). */
function whWordOf(act, input) {
  const [a, b] = Array.isArray(act.span) ? act.span : [0, -1];
  const hit = (input.features?.wh ?? []).find((w) => w.token >= a && w.token <= b);
  return hit ? hit.word : null;
}

// ─── V2 surface guards ────────────────────────────────────────────────────────────────────────────────
function validateSurface(frame, input = {}) {
  const errors = [];
  const names = new Map((input.features?.name_spans ?? []).map((n) => [n.label, n]));
  const chip = input.chip_target ?? null;
  const inboundPending = Boolean(input.conversation?.inbound);
  const inboundWantsPerson = input.conversation?.inbound?.answer_shape === "person";
  frame.acts.forEach((act, i) => {
    const flag = (field, code, disposition, detail = {}) => errors.push(err("V2", code, { act: i, field, disposition, ...detail }));
    const op = act.address?.op;
    const addressed = (act.address?.names ?? []).map((l) => names.get(l)).filter(Boolean);
    // The chip (explicit UI target) wins: a reading that addresses anyone else contradicts it.
    if (chip) {
      const agrees = op === "NONE" || op === "SECOND_PERSON" || (op === "NAMED" && addressed.length === 1 && addressed[0].person === chip);
      if (!agrees) flag("address", "contradicts_chip_target", "reject_field", { chip });
    }
    if (op === "NAMED" && !addressed.length) flag("address", "named_without_name_span", "reject_field");
    if (op !== "NAMED" && op !== "EXCEPT" && (act.address?.names ?? []).length) flag("address", "names_on_non_named_op", "reject_field", { op });
    if (op === "EXCEPT" && !addressed.length) flag("address", "except_without_name_span", "reject_field");
    // No invented names: every addressed span must be a person; an absent person is not addressable.
    for (const span of addressed) {
      if (!span.person && !span.non_present_person) flag("address", "addressed_span_is_not_a_person", "reject_field", { name: span.label });
      else if (span.non_present_person) flag("address", "addressee_not_present", "clarify", { name: span.label, slot: "person" });
    }
    // Name-role consistency with the address: a NAMED name must be read as a vocative / greeting target.
    const roleOf = new Map((act.name_roles ?? []).map((r) => [r.name, r.role]));
    if (op === "NAMED") for (const l of act.address.names) if (roleOf.has(l) && !["vocative", "greeting_target", ...(act.repair_kind === "addressee" ? ["repair_target"] : [])].includes(roleOf.get(l))) flag("address", "named_span_not_vocative", "reject_field", { name: l });
    // A standalone name ("Tonya.") is read against the DIS: never a passing mention; an answer only when a
    // coworker's question that takes a person is pending.
    for (const [label, role] of roleOf) {
      const span = names.get(label);
      if (!span) continue;
      if (span.standalone && role === "mention") flag("name_roles", "standalone_name_as_mention", "clarify", { name: label, slot: "person" });
      if (role === "answer_to_inbound" && !inboundPending) flag("name_roles", "answer_role_without_inbound", "reject_field", { name: label });
      if (span.standalone && role === "answer_to_inbound" && inboundPending && !inboundWantsPerson && input.conversation.inbound.answer_shape !== "free_short_answer") flag("name_roles", "name_answer_shape_mismatch", "clarify", { name: label, slot: "answer" });
    }
    // Set-valued and second-person address operations need surface evidence in the act itself.
    const words = wordsIn(act, input);
    const [a0, b0] = Array.isArray(act.span) ? act.span : [0, -1];
    // Older frozen packs omitted contraction features. Recognize only explicit you-contractions
    // inside this act; never infer address from the interface delivery target or another clause.
    const secondPerson = (input.features?.second_person ?? []).some((t) => t >= a0 && t <= b0)
      || (input.line?.tokens ?? []).some((t) => t.i >= a0 && t.i <= b0 && /^you['’](?:re|ve|ll|d)$/i.test(t.text));
    const has = (set) => words.some((w) => set.has(w));
    if (op === "ALL" && !has(ALL_WORDS) && !(secondPerson && words.includes("all"))) flag("address", "all_without_evidence", "clarify", { slot: "person" });
    if (op === "OTHERS" && !has(OTHERS_WORDS) && !((words.includes("two") || words.includes("three")) && secondPerson)) flag("address", "others_without_evidence", "clarify", { slot: "person" });
    if (op === "EXCEPT") {
      const excludedSpans = (act.address?.names ?? []).map((l) => names.get(l)).filter(Boolean);
      const cue = has(EXCEPT_WORDS) || excludedSpans.some((n) => ["but", "not"].includes(String(input.line?.tokens?.[n.tokens[0] - 1]?.text ?? "").toLowerCase()));
      if (!cue) flag("address", "except_without_evidence", "clarify", { slot: "person" });
    }
    if (op === "SECOND_PERSON" && !secondPerson) flag("address", "second_person_without_evidence", "clarify", { slot: "person" });
    // Deixis needs a deictic place word in the act (a code feature).
    const deixis = (input.features?.place_deixis ?? []).filter((t) => t.token >= a0 && t.token <= b0).map((t) => t.kind);
    if (act.referent?.candidate === "DEIXIS_THERE" && !deixis.includes("there")) flag("referent", "deixis_without_evidence", "clarify", { slot: "referent" });
    if (act.referent?.candidate === "DEIXIS_INSIDE" && !deixis.includes("inside")) flag("referent", "deixis_without_evidence", "clarify", { slot: "referent" });
    // The respondent mode the player EXPRESSED must be expressed, and must not contradict the address.
    if (act.respondent_mode && act.respondent_mode !== "unspecified") {
      if (!has(MODE_WORDS)) flag("respondent_mode", "respondent_mode_without_evidence", "clarify", { slot: "person" });
      if (op === "NAMED" && (act.address?.names ?? []).length === 1 && ["each", "all"].includes(act.respondent_mode)) flag("respondent_mode", "respondent_mode_contradicts_address", "reject_field");
    }
    // A line with asking features never silently becomes a remark (a statement / aside is silence by policy).
    const firstWord = words.find((w) => /^[a-z]/.test(w));
    if (NON_ASKING.has(act.speech_act) && (words.includes("?") || WH_WORDS.has(firstWord)) && !(act.abstain ?? []).includes("force")) flag("speech_act", "non_asking_reading_with_asking_features", "clarify", { slot: "topic" });
  });
  return { ok: errors.length === 0, errors };
}

// ─── V3 discourse guards ──────────────────────────────────────────────────────────────────────────────
function validateDiscourse(frame, input = {}) {
  const errors = [];
  const conv = input.conversation ?? {};
  const requests = new Map((conv.requests ?? []).map((r) => [r.label, r]));
  const people = (input.people ?? []).filter((p) => p.present);
  const names = new Map((input.features?.name_spans ?? []).map((n) => [n.label, n]));
  frame.acts.forEach((act, i) => {
    const flag = (field, code, slot, detail = {}) => errors.push(err("V3", code, { act: i, field, disposition: "clarify", slot, ...detail }));
    const kind = act.relation?.kind;
    const target = act.relation?.target ?? null;
    const request = target && requests.get(target);
    if (kind === "answer") {
      if (!conv.inbound) flag("relation", "answer_without_pending_inbound", "answer");
      else if (target && target !== conv.inbound.label) flag("relation", "answer_targets_other_inbound", "answer", { target });
    }
    if (act.inbound_answer && act.inbound_answer.kind !== "none" && !conv.inbound && !(act.repair_kind === "own_answer" && conv.just_answered_inbound)) flag("inbound_answer", "inbound_answer_without_inbound", "answer");
    if (["continuation", "repair", "topic_return"].includes(kind)) {
      const sameTurn = target && LABEL.same_turn.test(target);
      if (!target && !(kind === "repair" && act.repair_kind === "own_answer" && conv.just_answered_inbound)) flag("relation", "no_antecedent", "topic", { kind });
      else if (request && !ELIGIBLE_ANTECEDENT_STATES.has(request.state)) flag("relation", "antecedent_not_eligible", "topic", { target, state: request.state });
      else if (!sameTurn && target && !request && !LABEL.inbound.test(target) && !LABEL.activity.test(target) && !LABEL.anchor.test(target) && !LABEL.claim.test(target)) flag("relation", "antecedent_unknown", "topic", { target });
      if (target && LABEL.activity.test(target) && kind !== "continuation") flag("relation", "activity_antecedent_only_continues", "topic", { kind });
      if (target && LABEL.anchor.test(target) && kind === "topic_return") flag("relation", "topic_return_to_a_heard_line", "topic");
      // The player's own previous claim is an antecedent only for an ellipsis over it ("Tonya, have you?"), only
      // while it is fresh (the immediately previous player line, which opened no request), and only for a facet a
      // person can be asked back.
      if (target && LABEL.claim.test(target)) {
        const claim = conv.player_claim?.label === target ? conv.player_claim : null;
        if (kind !== "continuation") flag("relation", "claim_antecedent_only_continues", "topic", { kind });
        else if (!claim || claim.state !== "fresh") flag("relation", "claim_antecedent_not_eligible", "topic", { state: claim?.state ?? null });
        else if (registry.get(claim.facet)?.domain !== "person") flag("relation", "claim_antecedent_not_askable", "topic", { facet: claim.facet });
      }
      if (kind === "repair" && act.repair_kind === "unanswered" && request && !OPEN_STATES.has(request.state) && request.state !== "SATISFIED") flag("relation", "unanswered_repair_of_closed_request", "topic", { target });
      if (kind === "topic_return" && request && request.distance === 0) flag("relation", "topic_return_to_current_request", "topic", { target });
    }
    // withdraw: an open request, or (v2) the active activity round.
    if (kind === "withdraw") {
      const activityTarget = target && LABEL.activity.test(target);
      if (activityTarget) { if (conv.activity?.label !== target) flag("relation", "withdraw_of_unknown_activity", "topic", { target }); }
      else if (!request) flag("relation", "withdraw_without_target", "topic");
      else if (!OPEN_STATES.has(request.state)) flag("relation", "withdraw_of_closed_request", "topic", { target, state: request.state });
    }
    // conclude (v2): the reader says the line concludes something; it may point only at the ACTIVE activity (v1)
    // or at nothing (a closing remark with nothing open -- the resolver makes it a social no-op, never a closure).
    if (kind === "conclude" && target) {
      if (!LABEL.activity.test(target)) flag("relation", "conclude_target_not_activity", "topic", { target });
      else if (conv.activity?.label !== target) flag("relation", "conclude_of_unknown_activity", "topic", { target });
    }
    if (kind === "attention" && target && request && !OPEN_STATES.has(request.state)) flag("relation", "attention_to_closed_request", "topic", { target });
    // Set-valued address operations must name somebody.
    const op = act.address?.op;
    if (op === "EXCEPT") {
      const excluded = new Set((act.address.names ?? []).map((l) => names.get(l)?.person).filter(Boolean));
      if (!people.some((p) => !excluded.has(p.label))) flag("address", "except_resolves_to_nobody", "person");
    }
    if (op === "OTHERS") {
      const basis = act.address.relative_to ? requests.get(act.address.relative_to) : (conv.requests ?? []).find((r) => r.distance === 0) ?? null;
      const excluded = new Set([...(basis?.answered_by ?? []), ...(conv.last_responders ?? [])]);
      const rest = people.filter((p) => !excluded.has(p.label));
      if (!rest.length) flag("address", "others_resolves_to_nobody", "person");
      else if (act.address.count && act.address.count !== rest.length) flag("address", "others_count_mismatch", "person", { count: act.address.count, remaining: rest.length });
    }
    if (op === "SECOND_PERSON" && !people.length) flag("address", "second_person_with_nobody_present", "person");
  });
  return { ok: errors.length === 0, errors };
}

/**
 * All four layers. V1-V3 run only on a frame that passed V0. The verdict never repairs a frame: a field that
 * fails is rejected (reject_field), a discourse or surface gap asks (clarify, with the slot), and a frame that
 * fails V0 is not a reading at all (reject).
 */
function validateReaderFrame(frame, input = {}) {
  const v0 = validateSchema(frame, input);
  if (!v0.ok) return Object.freeze({ version: READER_FRAME_VERSION, ok: false, disposition: "reject", layers: { V0: v0 }, clarify_slots: [], rejected_fields: [] });
  const v1 = validateCandidates(frame, input);
  const v2 = validateSurface(frame, input);
  const v3 = validateDiscourse(frame, input);
  const all = [...v1.errors, ...v2.errors, ...v3.errors];
  const clarify = all.filter((e) => e.disposition === "clarify");
  const rejected = all.filter((e) => e.layer === "V1" || e.disposition === "reject_field");
  const disposition = !all.length ? "accept" : rejected.length ? "reject_fields" : "clarify";
  return Object.freeze({
    version: READER_FRAME_VERSION,
    ok: all.length === 0,
    disposition,
    layers: { V0: v0, V1: v1, V2: v2, V3: v3 },
    clarify_slots: [...new Set(clarify.map((e) => e.slot).filter(Boolean))],
    // Owner ruling C1: acts whose facet was inherited past the new-question form gate (recorded, never silent).
    form_gate_exemptions: [...(v1.exemptions ?? [])],
    rejected_fields: [...new Set(rejected.map((e) => `acts[${e.act}].${e.field}`))]
  });
}

module.exports = {
  READER_FRAME_VERSION, MAX_ACTS, SPEECH_ACTS, QUESTION_FORMS, FACET_SPECIAL, POLARITIES, NAME_ROLES, ADDRESS_OPS, RELATIONS, REPAIR_KINDS, DEIXIS_SPECIAL, REFERENT_CHOICE_SPECIAL, DISPOSITIONS, dispositionOf,
  TEMPORALS, RESPONDENT_MODES, INBOUND_KINDS, INBOUND_OPTION_SPECIAL, SUBJECT_KINDS, ACTION_FAMILIES, ABSTAIN_FIELDS, LABEL, ACT_KEYS,
  ELIGIBLE_ANTECEDENT_STATES, OPEN_STATES, inheritedFacetBasis,
  readerFrameSchema, validateSchema, validateCandidates, validateSurface, validateDiscourse, validateReaderFrame, whWordOf, licensedReferents, wordsIn
};
