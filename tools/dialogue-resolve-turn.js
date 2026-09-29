"use strict";

// Reader Phase 0 / 0.5 -- the PURE RESOLUTION SEAM: resolveTurn(readerFrame, dialogueState, presentActors).
//
// CONTRACT (nothing here reads player language):
//   input   a ReaderFrame v1 (linguistic interpretation only), the canonical dialogue state
//           ({ snapshot, ledger }: the DIS snapshot and the PRE-TURN request ledger) and the present actors, plus
//           the ReaderInput and its bindings (label -> canonical id, code's own mapping).
//   output  effective acts in the shape the rest of the pipeline already consumes (analyzeTurn's `effective` /
//           `primary`), so finalizeFrame, openTurnRequests and the planner stay unchanged.
//
//   It OWNS (deterministic policy, never the reader's):
//     address-op resolution to ids (chip wins); responder priority (owner decision 2026-09-27 #1: explicit >
//     repair target > antecedent owner > activity > knower > rotation); inheritance vs rotation; "who has
//     answered" (ledger slot responders); cardinality (cardinalityFor); temporal defaults (registry
//     default_temporal); request reissue / reopen; inbound-answer routing; remark silence (cardinality none).
//
// TWO MODES
//   legacy passthrough  (options.legacy given) -- what PRODUCTION calls in Phase 0 / 0.5: returns the legacy
//                       analysis unchanged (identity). Production behaviour never depends on the frame.
//   frame-driven        (no legacy) -- a MEASUREMENT resolver used only by the round-trip harness and the gold-DIS
//                       evaluator. It is not wired into production. Where the ReaderFrame cannot carry what the
//                       legacy decision used (fragment subtypes, place basis, overrides, raw request text), it does
//                       not guess: the harnesses report the loss.

const registry = require("./dialogue-registry");
const dialogueTurn = require("./dialogue-turn");

const RESOLVE_TURN_VERSION = "yellow-beast-resolve-turn@v1";

/** The fields the resolver owns, each with the current legacy owner(s) it replaces. */
const RESOLVER_OWNERSHIP = Object.freeze({
  address_resolution: ["dialogue-turn.resolveAddressee", "dialogue-interpretation.parseAddressees", "dialogue-discourse.resolveAddressCorrection", "dialogue-discourse.resolveRecipientScope", "dialogue-interpretation.inferLocalRecipientType", "dialogue-turn.addressFromTurn", "desktop/service.js advisory addressee_text_span rescue"],
  responder_priority: ["dialogue-turn.resolveAddressee (inheritance)", "dialogue-turn.analyzeTurn (answer_owner / antecedent_owner / activity_remaining)", "dialogue-interpretation.resolveResponseOwners"],
  rotation: ["dialogue-turn.ownersByCardinality", "dialogue-interpretation.resolveResponseOwners (spokesperson)"],
  cardinality: ["dialogue-turn.cardinalityFor"],
  temporal_defaults: ["dialogue-turn.analyzeTurn (cue temporal)", "dialogue-turn.applyAdvisory (facet modal temporal)"],
  request_lifecycle: ["dialogue-state.openTurnRequests (unchanged; fed by the resolver's effective acts)"],
  inbound_answer_routing: ["dialogue-turn.analyzeTurn (inboundAnswer / REPLY_* / open_question_answer)"],
  remark_silence: ["dialogue-turn.cardinalityFor", "dialogue-interpretation.resolveResponseOwners (REMARK_ACTS, SOCIAL_UNTARGETED_PATTERNS)"]
});

const RANK = Object.freeze({ question: 3, request: 3, repair: 3, elliptical_continuation: 3, attention_call: 3, self_introduction: 2, greeting: 2, farewell: 2, sarcasm: 1, statement: 1, social_acknowledgment: 0, thanks: 0, answer: 1, aside: 0 });
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
const PENDING = new Set(["OPEN", "PARTIALLY_SATISFIED"]);
const REPAIR_BACK = Object.freeze({ addressee: "target", referent: "referent", facet: "facet", temporal: "temporal", unanswered: "unanswered" });
const OPTION_BACK = Object.freeze({ YES: "yes", NO: "no", BOTH: "both", EITHER: "either", NEITHER: "neither", NONE_OF_OFFERED: "none" });
const ABSTAIN_SLOT = Object.freeze({ address: "person", relation: "topic", referent: "referent", inbound_answer: "answer", facet: "topic", force: "topic", subject: "person", temporal: "topic" });

function primaryOf(effective) {
  let best = null;
  for (const e of effective) if (!best || (RANK[e.speech_act] ?? 1) >= (RANK[best.speech_act] ?? 1)) best = e;
  return best;
}
const answeredBy = (request) => Object.values(request?.slots ?? {}).filter((slot) => slot?.responder_id).map((slot) => slot.responder_id);

/** The frame-driven resolution of one validated ReaderFrame (measurement only; see the header). */
function resolveFromFrame(frame, state, present, { input, bindings }) {
  const snap = state?.snapshot ?? null;
  const ledger = state?.ledger ?? { requests: [] };
  const presentIds = present.map((p) => p.id);
  const requests = ledger.requests ?? [];
  const requestById = (id) => requests.find((r) => r.request_id === id) ?? null;
  const requestOf = (label) => (bindings.requests?.[label] ? requestById(bindings.requests[label]) : null);
  const nameSpan = (label) => input.features.name_spans.find((n) => n.label === label) ?? null;
  const personOf = (label) => { const span = nameSpan(label); return span ? { id: bindings.names[label] ?? null, present: presentIds.includes(bindings.names[label]), text: span.text } : null; };
  const speaker = snap?.active_speaker ?? null;
  const effective = [];

  for (const act of frame.acts) {
    const kind = act.relation?.kind ?? "new";
    const facet = registry.get(act.facet) ? act.facet : null;
    const e = {
      speech_act: act.speech_act === "aside" ? "statement" : act.speech_act,
      question_form: act.question_form === "none" ? null : act.question_form,
      relation: kind, relation_target: null, reissue_of: null, reopen: false,
      predicate: facet, facet_source: facet ? "reader" : null, request_text: null,
      addressee: null, cardinality: null, temporal_scope: null, polarity: act.polarity === "negative" ? "negative" : "positive",
      args: {}, repair: null, clarify: null, overrides: [],
      // Structural stand-in for the clause (names only, never words): what finalizeFrame reads for subjects.
      act: { mentions: (act.subject?.names ?? []).map((l) => personOf(l)).filter((p) => p?.id).map((p) => ({ id: p.id, name: p.text })), vocatives: (act.address?.names ?? []).map((l) => personOf(l)).filter((p) => p?.id).map((p) => ({ id: p.id, name: p.text })), body_expanded: "", polarity: act.polarity }
    };
    // ── the antecedent the reader named ──
    const target = act.relation?.target ?? null;
    let ante = null;
    if (target && /^q\d+$/.test(target)) ante = { kind: "request", request: requestOf(target) };
    else if (target === "i1") ante = { kind: "inbound", inbound: snap?.pending_inbound_request ?? null };
    else if (target === "i0") ante = { kind: "inbound", inbound: snap?.just_answered_inbound ?? null };
    else if (target && /^s\d$/.test(target)) ante = { kind: "same", e: effective[Number(target.slice(1))] ?? null };
    else if (target === "v1") ante = { kind: "activity", activity: snap?.activity ?? null };
    else if (target && /^a\d+$/.test(target)) {
      const where = bindings.anchors?.[target] ?? null;
      const anchor = (snap?.surface_anchors ?? []).find((a) => a.event_id === where?.event_id) ?? null;
      const span = anchor?.spans?.[where?.span ?? 0] ?? null;
      ante = { kind: "anchor", speaker_id: anchor?.speaker_id ?? null, request: span?.request_id ? requestById(span.request_id) : null, predicate: span?.predicate ?? null };
    }
    const source = ante?.request ?? (ante?.kind === "same" && ante.e ? { request_id: null, predicate: ante.e.predicate, args: ante.e.args, temporal: ante.e.temporal_scope, request_text: ante.e.request_text, targets: ante.e.addressee?.ids ?? [] } : ante?.kind === "activity" && ante.activity ? { request_id: null, predicate: ante.activity.template?.predicate ?? null, args: null, temporal: null, request_text: ante.activity.template?.request_text ?? null, targets: [...(ante.activity.completed ?? [])] } : ante?.kind === "anchor" ? { request_id: null, predicate: ante.predicate, args: null, temporal: null, request_text: null, targets: [] } : null);
    if (["continuation", "repair", "topic_return", "attention"].includes(kind) && source) {
      // A question about what was SAID (a heard sentence) links to the line, not to its request -- unless it
      // echoes the sentence's words (a surface-anchor re-ask of that request).
      e.relation_target = ante.kind === "anchor" && !act.echo ? null : source.request_id ?? null;
      if (!e.predicate && source.predicate) { e.predicate = source.predicate; e.facet_source = ante.kind === "anchor" ? "surface_anchor" : "inherited_request"; }
      if (e.predicate && e.predicate === source.predicate) { e.args = { ...(source.args ?? {}) }; e.temporal_scope = source.temporal ?? null; e.request_text = source.request_text ?? null; }
    }
    if (kind === "repair" && source && act.repair_kind !== "own_answer") {
      e.reissue_of = source.request_id ?? null;
      e.repair = { kind: REPAIR_BACK[act.repair_kind] ?? act.repair_kind ?? null };
      if (act.repair_kind === "unanswered") e.reopen = true;
      e.question_form = null;
    }
    if (kind === "attention" && ante?.request && PENDING.has(ante.request.state)) { e.reissue_of = ante.request.request_id; e.reopen = true; e.predicate = ante.request.predicate; e.question_form = null; e.request_text = ante.request.request_text; e.args = { ...(ante.request.args ?? {}) }; }
    // ── inbound answers (routing to the asker is the resolver's) ──
    const inbound = snap?.pending_inbound_request ?? null;
    const answerPerson = (act.name_roles ?? []).find((r) => r.role === "answer_to_inbound");
    const optionOf = () => {
      const o = act.inbound_answer?.option ?? null;
      if (o && /^o\d+$/.test(o)) return bindings.options?.[o] ?? null;
      if (o && OPTION_BACK[o]) return OPTION_BACK[o];
      return answerPerson ? personOf(answerPerson.name)?.id ?? null : null;
    };
    if (act.repair_kind === "own_answer") {
      e.speech_act = "answer"; e.relation = "repair"; e.predicate = null; e.facet_source = null; e.repair = null;
      e.args = { ...e.args, reply_kind: "answer_repair" };
    } else if (kind === "answer" || (act.inbound_answer && act.inbound_answer.kind !== "counter_question" && act.inbound_answer.kind !== "none")) {
      const option = optionOf();
      e.speech_act = "answer"; e.relation = "answer"; e.predicate = null; e.facet_source = null; e.question_form = null;
      e.args = { ...e.args, reply_kind: act.inbound_answer?.kind ?? "answer", inbound_kind: inbound?.kind ?? "question", ...(inbound?.predicate ? { answers_predicate: inbound.predicate } : {}), ...(inbound?.answer_shape ? { answer_shape: inbound.answer_shape } : {}), ...(option != null ? { answer_option: option } : {}) };
    } else if (act.inbound_answer?.kind === "counter_question") {
      e.relation = "continuation";
      e.args = { ...e.args, reply_kind: "counter_question" };
    }
    // ── temporal: what the line expressed, else the antecedent's, else the facet's default ──
    if (act.temporal && act.temporal !== "unspecified") e.temporal_scope = act.temporal;
    else if (!e.temporal_scope && e.predicate && ASKING.has(e.speech_act)) e.temporal_scope = registry.get(e.predicate)?.default_temporal ?? null;
    // ── arguments from the reader's structured choices ──
    const entry = e.predicate ? registry.get(e.predicate) : null;
    const candidate = act.referent?.candidate && /^r\d+$/.test(act.referent.candidate) ? act.referent.candidate : null;
    if (candidate) {
      const id = bindings.referents?.[candidate] ?? null;
      const kindOf = input.referent_candidates.find((r) => r.label === candidate)?.kind ?? null;
      const slots = Object.values(entry?.slots ?? {});
      if (id && kindOf === "item" && (slots.includes("equipment") || String(e.predicate).startsWith("item."))) e.args.item_id = id;
      if (id && kindOf === "place" && slots.includes("place")) e.args.place_id = id;
    }
    if (e.predicate && act.polarity === "inverted") e.args.question_inverted = true;
    if (e.predicate && act.polarity === "negative" && ["yes_no", "declarative"].includes(act.question_form)) e.args.question_negated = true;
    if (act.echo?.anchor) { const where = bindings.anchors?.[act.echo.anchor]; if (where?.event_id) e.args.echo = { event_id: where.event_id }; }
    // ── address -> ids (policy) ──
    e.addressee = resolveAddress(act, e, ante, { input, bindings, snap, presentIds, requestOf, personOf, speaker, inbound });
    // ── abstention / unresolved set -> clarification (fail closed) ──
    const slot = (act.abstain ?? []).map((f) => ABSTAIN_SLOT[f]).find(Boolean) ?? null;
    if (slot) e.clarify = { reason: "reader_abstained", slot };
    else if (e.addressee?.mismatch) e.clarify = { reason: "quantifier_mismatch", slot: "person" };
    else if (e.addressee?.source === "ellipsis_unresolved") e.clarify = { reason: "ellipsis_target_unresolved", slot: "person" };
    else if (["continuation", "repair", "topic_return"].includes(kind) && !source && act.repair_kind !== "own_answer" && !ante) e.clarify = { reason: kind === "repair" ? "repair_no_target" : "ellipsis_no_antecedent", slot: "topic" };
    e.cardinality = e.addressee ? dialogueTurn.cardinalityFor(e.predicate, e.addressee, e) : "none";
    effective.push(e);
  }
  return { effective, primary: primaryOf(effective) };
}

function resolveAddress(act, e, ante, { input, bindings, snap, presentIds, requestOf, personOf, speaker, inbound }) {
  const op = act.address?.op ?? "NONE";
  const chip = input.chip_target ? bindings.people?.[input.chip_target] ?? null : null;
  if (chip && presentIds.includes(chip)) return { kind: "explicit", ids: [chip], quantifier: null, source: "chip" };
  if (op === "NAMED") {
    const persons = (act.address.names ?? []).map(personOf).filter(Boolean);
    const here = persons.filter((p) => p.present).map((p) => p.id);
    if (!here.length) return { kind: "explicit", ids: [], quantifier: null, source: "vocative_not_present", absent: persons.map((p) => p.text) };
    const repairTarget = (act.name_roles ?? []).some((r) => r.role === "repair_target");
    return { kind: here.length > 1 ? "subset" : "explicit", ids: here, quantifier: null, source: repairTarget ? "legacy_correction" : e.relation === "repair" ? "repair" : "vocative" };
  }
  if (op === "ALL") return { kind: "group", ids: [...presentIds], quantifier: act.respondent_mode === "each" ? "each" : act.respondent_mode === "any" ? "any" : "all", source: e.relation === "repair" ? "repair" : "quantifier" };
  if (op === "EXCEPT") {
    const excluded = (act.address.names ?? []).map(personOf).filter(Boolean).map((p) => p.id);
    return { kind: "subset", ids: presentIds.filter((id) => !excluded.includes(id)), quantifier: "except", source: "quantifier" };
  }
  if (op === "OTHERS") {
    const basis = (act.address.relative_to && requestOf(act.address.relative_to)) || ante?.request || null;
    const answered = answeredBy(basis ?? snap?.last_request);
    // "The other one": the rest of the people the question was PUT to; otherwise the rest of the table.
    const asked = (basis?.targets ?? []).filter((id) => presentIds.includes(id));
    const pool = e.relation === "repair" && asked.length ? asked : presentIds;
    const excluded = new Set([...answered, ...(e.relation === "repair" && asked.length ? [] : [speaker?.speaker_id])].filter(Boolean));
    const ids = pool.filter((id) => !excluded.has(id));
    const quantifier = act.address.count === 2 ? "two" : act.address.count === 3 ? "three" : "rest";
    return ids.length ? { kind: "subset", ids, quantifier, source: "quantifier" } : { kind: "group", ids: [...presentIds], quantifier, source: "quantifier", mismatch: true };
  }
  // SECOND_PERSON / NONE: inheritance policy from the ledger (owner decision 2026-09-27 #1).
  const secondPerson = op === "SECOND_PERSON";
  if (e.args.reply_kind === "answer_repair") { const from = snap?.just_answered_inbound?.speaker_id ?? snap?.just_answered_inbound?.from ?? null; return from && presentIds.includes(from) ? { kind: "inherited", ids: [from], quantifier: null, source: "answer_repair" } : { kind: "untargeted", ids: [], quantifier: null, source: "none" }; }
  const asker = inbound?.speaker_id ?? inbound?.from ?? null;
  if (e.relation === "answer" && asker && presentIds.includes(asker)) return { kind: "inherited", ids: [asker], quantifier: null, source: "open_question_answer" };
  if (e.args.reply_kind === "counter_question" && asker && presentIds.includes(asker)) return { kind: "inherited", ids: [asker], quantifier: null, source: "inbound_asker" };
  if (ante?.kind === "anchor" && ante.speaker_id && presentIds.includes(ante.speaker_id)) return { kind: "inherited", ids: [ante.speaker_id], quantifier: null, source: "surface_anchor" };
  if (ante?.kind === "activity" && ante.activity) {
    const done = new Set(ante.activity.completed ?? []);
    const remaining = presentIds.filter((id) => !done.has(id));
    return remaining.length === 1 ? { kind: "inherited", ids: remaining, quantifier: null, source: "activity_remaining" } : { kind: "inherited", ids: [], quantifier: null, source: "ellipsis_unresolved", ambiguous: remaining };
  }
  if (e.relation === "repair" && ante?.request) {
    const targets = (ante.request.targets ?? []).filter((id) => presentIds.includes(id));
    const answered = answeredBy(ante.request).filter((id) => presentIds.includes(id));
    if (targets.length && op !== "OTHERS") return { kind: targets.length > 1 ? "subset" : "explicit", ids: targets, quantifier: null, source: "repaired_request" };
    if (answered.length) return { kind: "inherited", ids: answered.slice(0, 1), quantifier: null, source: "repaired_request" };
  }
  if (e.relation === "attention" && ante?.request && PENDING.has(ante.request.state)) {
    const open = (ante.request.targets ?? []).filter((id) => presentIds.includes(id) && ante.request.slots?.[id]?.state !== "SATISFIED");
    return { kind: open.length > 1 ? "group" : "explicit", ids: open.length ? open : [...presentIds], quantifier: null, source: "pending_request" };
  }
  if (e.relation === "continuation" && ante?.request) {
    const answered = answeredBy(ante.request).filter((id) => presentIds.includes(id));
    if (answered.length === 1) return { kind: "inherited", ids: answered, quantifier: null, source: "answer_owner" };
  }
  if (speaker?.speaker_id && presentIds.includes(speaker.speaker_id) && (secondPerson || e.relation === "continuation") && (speaker.speaker_ids?.length ?? 1) <= 1) return { kind: "inherited", ids: [speaker.speaker_id], quantifier: null, source: "active_speaker" };
  if (secondPerson && (speaker?.speaker_ids?.length ?? 0) > 1) return { kind: "inherited", ids: [], quantifier: null, source: "active_speakers_several", ambiguous: speaker.speaker_ids.filter((id) => presentIds.includes(id)) };
  return { kind: "untargeted", ids: [], quantifier: null, source: "none", ...(secondPerson ? { second_person: true } : {}) };
}

/**
 * Production (Phase 0 / 0.5) passes `legacy` and gets it back unchanged. The harnesses pass { input, bindings }
 * and a { snapshot, ledger } state to get the frame-driven resolution.
 */
function resolveTurn(readerFrame, dialogueState, presentActors = [], { legacy = null, input = null, bindings = null } = {}) {
  if (legacy?.analysis) {
    const analysis = legacy.analysis;
    return Object.freeze({
      version: RESOLVE_TURN_VERSION,
      source: "legacy_passthrough",
      analysis, // the SAME object: callers keep using it; identity is asserted by tests
      effective: analysis.effective,
      primary: analysis.primary,
      handed: Object.freeze({ frame_acts: readerFrame?.acts?.length ?? 0, present: presentActors.length, has_dis: Boolean(dialogueState) })
    });
  }
  if (!readerFrame?.acts?.length || !input || !bindings) throw Object.assign(new Error("resolveTurn: a frame-driven resolution needs a ReaderFrame, the ReaderInput and its bindings"), { code: "RESOLVER_INPUT_MISSING" });
  const state = dialogueState?.snapshot || dialogueState?.ledger ? dialogueState : { snapshot: dialogueState, ledger: { requests: [] } };
  const out = resolveFromFrame(readerFrame, state, presentActors, { input, bindings });
  return Object.freeze({ version: RESOLVE_TURN_VERSION, source: "frame", effective: out.effective, primary: out.primary });
}

module.exports = { RESOLVE_TURN_VERSION, RESOLVER_OWNERSHIP, resolveTurn, resolveFromFrame, primaryOf };
