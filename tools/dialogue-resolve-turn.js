"use strict";

// Reader Phase 0 / 0.5 / 1 -- the PURE RESOLUTION SEAM: resolveTurn(readerFrame, dialogueState, presentActors, options).
//
// CONTRACT (nothing here reads player language):
//   input   a ReaderFrame v1 (linguistic interpretation only) and its VALIDATOR VERDICT (V0-V3); the canonical
//           dialogue state ({ snapshot, ledger }: the real pre-turn DIS snapshot and the PRE-TURN request ledger);
//           the present actors; the ReaderInput and its bindings (label -> canonical id, code's own mapping);
//           OPAQUE presentation strings (the request_text cut from each validated act span -- carried, never read);
//           and canonical context for the response policy (per-listener knowledge flags, item custody).
//   output  a frozen shadow resolution: the effective acts (in the shape the rest of the pipeline consumes), the
//           routing (addressees, responders, recipients, listeners, cardinality, silence), the request /
//           activity / inbound LIFECYCLE INTENT, the clarification disposition, recorded conflicts and reasons.
//
//   It OWNS (deterministic policy, never the reader's): address-op resolution to ids (the chip wins); subject and
//   third-party subjects; relation / repair / continuation targets (incl. the player's previous claim, c1);
//   responder priority (owner decision 2026-09-27 #1 -- via the table-driven dialogue-response-policy.js);
//   cardinality (dialogue-turn.cardinalityFor); temporal defaults (registry default_temporal); deictic place
//   defaults (owner decision 2026-09-27 #4); activity-round ownership; inbound-answer routing; request lifecycle
//   intent; remark silence (owner decision #2); fail-closed clarification on the validator's verdict.
//
// TWO MODES
//   legacy passthrough  (options.legacy given) -- what PRODUCTION calls: returns the legacy analysis unchanged
//                       (identity). Production behaviour never depends on the frame (Reader Phase 1 is SHADOW-ONLY).
//   shadow              (options.verdict given) -- the Phase-1 resolver, run by the developer-gated shadow in the
//                       service seam and by the harnesses. Its output never feeds production.
//
// FAIL-CLOSED (Phase 1 item 8): INVALID -> no resolution. A rejected or unresolved ROUTING-CRITICAL field, a
// validator clarification, or a reader abstention -> the act clarifies: no inherited facet merely because one
// exists, no fabricated arguments, no default spokesperson (one clarifier asks). A rejected non-routing field
// (temporal, requested_action) is neutralized and recorded. Owner ruling 4: the chip contradicting a vocative
// keeps the chip (production's rule) and the conflict is recorded.

const registry = require("./dialogue-registry");
const dialogueTurn = require("./dialogue-turn");
const RF = require("./dialogue-reader-frame");
const policy = require("./dialogue-response-policy");

const RESOLVE_TURN_VERSION = "yellow-beast-resolve-turn@v3";

/** The fields the resolver owns, each with the current legacy owner(s) it replaces. */
const RESOLVER_OWNERSHIP = Object.freeze({
  address_resolution: ["dialogue-turn.resolveAddressee", "dialogue-interpretation.parseAddressees", "dialogue-discourse.resolveAddressCorrection", "dialogue-discourse.resolveRecipientScope", "dialogue-interpretation.inferLocalRecipientType", "dialogue-turn.addressFromTurn", "desktop/service.js advisory addressee_text_span rescue"],
  subject: ["dialogue-turn.finalizeFrame (thirdParty from request_text / body_expanded)", "dialogue-turn.analyzeTurn (mentions, other_id)"],
  responder_priority: ["dialogue-turn.resolveAddressee (inheritance)", "dialogue-turn.analyzeTurn (answer_owner / antecedent_owner / activity_remaining)", "dialogue-interpretation.resolveResponseOwners"],
  rotation: ["dialogue-turn.ownersByCardinality", "dialogue-interpretation.resolveResponseOwners (spokesperson)"],
  cardinality: ["dialogue-turn.cardinalityFor", "dialogue-turn.finalizeFrame (third-party / vacuous)"],
  temporal_defaults: ["dialogue-turn.analyzeTurn (cue temporal)", "dialogue-turn.applyAdvisory (facet modal temporal)", "dialogue-turn.finalizeFrame (default_temporal)"],
  deictic_place_defaults: ["dialogue-turn.placeOf (INSIDE_DEIXIS / THERE_DEIXIS regexes)"],
  continuation_ownership: ["dialogue-turn.antecedentOf", "dialogue-turn.isFollowUp", "dialogue-state.lastPlayerClaim (legacy clause predicates)"],
  activity_round_ownership: ["dialogue-turn.analyzeTurn (activity_remaining)"],
  request_lifecycle: ["dialogue-state.openTurnRequests (unchanged in production; the shadow records its INTENT)"],
  // Reader Phase 2: the reader's `conclude` / `withdraw` relation on the active activity (v1) -> close INTENT;
  // canonical closeActivity stays production's.
  activity_closure: ["dialogue-acts closes_activity ('that's that' marker regex) -> dialogue-state.closeActivity"],
  inbound_answer_routing: ["dialogue-turn.analyzeTurn (inboundAnswer / REPLY_* / open_question_answer)"],
  remark_silence: ["dialogue-turn.cardinalityFor", "dialogue-interpretation.resolveResponseOwners (REMARK_ACTS, SOCIAL_UNTARGETED_PATTERNS)"],
  clarification_disposition: ["dialogue-turn.finalizeFrame (clarify-over-guess)", "dialogue-turn.completenessWithFrame"]
});

const RANK = Object.freeze({ question: 3, request: 3, repair: 3, elliptical_continuation: 3, attention_call: 3, self_introduction: 2, greeting: 2, farewell: 2, sarcasm: 1, statement: 1, social_acknowledgment: 0, thanks: 0, answer: 1, aside: 0 });
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
const PENDING = new Set(["OPEN", "PARTIALLY_SATISFIED"]);
const REPAIR_BACK = Object.freeze({ addressee: "target", referent: "referent", facet: "facet", temporal: "temporal", unanswered: "unanswered" });
const OPTION_BACK = Object.freeze({ YES: "yes", NO: "no", BOTH: "both", EITHER: "either", NEITHER: "neither", NONE_OF_OFFERED: "none" });
const ABSTAIN_SLOT = Object.freeze({ address: "person", relation: "topic", referent: "referent", inbound_answer: "answer", facet: "topic", force: "topic", subject: "person", temporal: "topic" });
// Fields whose loss changes WHO answers or WHAT is asked: a rejection here fails the act closed.
const ROUTING_CRITICAL = new Set(["speech_act", "facet", "address", "relation", "name_roles", "inbound_answer", "referent", "subject", "echo", "respondent_mode"]);
// Fields that only refine: a rejection neutralizes the field and is recorded.
const NEUTRALIZABLE = Object.freeze({ temporal: "unspecified", requested_action: null });
// Owner decision 2026-09-27 #4: "going in" / "inside" at this table is the Complex when no place is active.
const DEICTIC_INSIDE_DEFAULT = "complex";
const ACTIVITY_OF = Object.freeze({ "person.self_description": "SELF_INTRODUCTION_ROUND", "person.wellbeing": "GROUP_CHECK_IN", "person.nervousness": "GROUP_CHECK_IN", "person.anticipation": "GROUP_CHECK_IN", "person.fatigue": "GROUP_CHECK_IN", "person.role": "ROLE_ROUND", "person.current_assignment": "ROLE_ROUND", "person.first_day_at_async": "EXPERIENCE_ROUND", "person.async_tenure": "EXPERIENCE_ROUND", "person.expedition_experience": "EXPERIENCE_ROUND", "person.complex_experience": "EXPERIENCE_ROUND" });
const ABANDON_AFTER_TURNS = 4;

function primaryOf(effective) {
  let best = null;
  for (const e of effective) if (!best || (RANK[e.speech_act] ?? 1) >= (RANK[best.speech_act] ?? 1)) best = e;
  return best;
}
const answeredBy = (request) => Object.values(request?.slots ?? {}).filter((slot) => slot?.responder_id).map((slot) => slot.responder_id);
const deepFreeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };

/** The validator's per-act findings: rejected fields, clarifications (with slot), and the codes behind them. */
function findingsOf(verdict) {
  const errors = verdict?.errors ?? Object.values(verdict?.layers ?? {}).flatMap((l) => l?.errors ?? []);
  const byAct = new Map();
  const at = (i) => { if (!byAct.has(i)) byAct.set(i, { rejected: new Map(), clarify: [] }); return byAct.get(i); };
  for (const e of errors) {
    if (e.layer === "V0" || !Number.isInteger(e.act)) continue;
    const slot = at(e.act);
    if (e.layer === "V1" || e.disposition === "reject_field") { const list = slot.rejected.get(e.field) ?? []; list.push(e.code); slot.rejected.set(e.field, list); }
    else if (e.disposition === "clarify") slot.clarify.push({ code: e.code, field: e.field, slot: e.slot ?? "topic" });
  }
  return byAct;
}

/** The resolution of one validated act (shadow). Pure: reads only structured inputs. */
function resolveAct(actIn, i, ctx, effective) {
  const { input, bindings, snap, requests, presentIds, opaque, findings } = ctx;
  const f = findings.get(i) ?? { rejected: new Map(), clarify: [] };
  const conflicts = [];
  const reasons = [];
  // Rejected fields: chip conflicts keep the chip (owner ruling 4); refinements are neutralized; routing-critical
  // fields fail the act closed.
  const act = { ...actIn };
  let chipConflict = false;
  let criticalRejected = null;
  for (const [field, codes] of f.rejected) {
    if (field === "address" && codes.every((c) => c === "contradicts_chip_target") && input.chip_target) { chipConflict = true; conflicts.push("chip_vs_vocative"); continue; }
    if (field in NEUTRALIZABLE) { act[field] = NEUTRALIZABLE[field]; reasons.push(`neutralized:${field}:${codes.join("+")}`); continue; }
    if (ROUTING_CRITICAL.has(field) && !criticalRejected) criticalRejected = { field, code: codes[0] };
  }
  const kind = act.relation?.kind ?? "new";
  const facetOk = registry.get(act.facet) && !f.rejected.has("facet") ? act.facet : null;
  const nameOf = (label) => { const span = input.features.name_spans.find((n) => n.label === label); return span ? { id: bindings.names[label] ?? null, present: presentIds.includes(bindings.names[label]), person: Boolean(span.person) } : null; };
  const e = {
    index: i,
    speech_act: act.speech_act === "aside" ? "statement" : act.speech_act,
    reader_speech_act: act.speech_act,
    question_form: act.question_form === "none" ? null : act.question_form,
    relation: kind, relation_target: null, reissue_of: null, reopen: false,
    predicate: facetOk, facet_source: facetOk ? "reader" : null,
    // OPAQUE: the words of the validated act span, for presentation and legacy-equivalence measurement only.
    request_text: opaque?.request_texts?.[i] ?? null,
    addressee: null, cardinality: null, temporal_scope: null, polarity: act.polarity === "negative" ? "negative" : "positive",
    args: {}, repair: null, clarify: null, overrides: [], outcome: "resolved",
    subject: null, mentions: [], claim_facet: null, conflicts, reasons
  };
  // Mentions are recorded, never silently dropped (present or absent persons, by canonical id).
  e.mentions = (act.name_roles ?? []).filter((r) => r.role === "mention").map((r) => nameOf(r.name)?.id).filter(Boolean);
  // A statement's facet is the CLAIM it makes (ReaderFrame v1): kept apart from the asked predicate.
  if (!ASKING.has(e.speech_act) && e.speech_act !== "answer" && facetOk) { e.claim_facet = facetOk; e.predicate = null; e.facet_source = null; }

  // ── the antecedent the reader named (never another one) ──
  const target = act.relation?.target ?? null;
  const requestOf = (label) => (bindings.requests?.[label] ? requests.find((r) => r.request_id === bindings.requests[label]) ?? null : null);
  let ante = null;
  if (target && RF.LABEL.request.test(target)) ante = { kind: "request", request: requestOf(target) };
  else if (target === "i1") ante = { kind: "inbound", inbound: snap?.pending_inbound_request ?? null };
  else if (target === "i0") ante = { kind: "inbound", inbound: snap?.just_answered_inbound ?? null };
  else if (target && RF.LABEL.same_turn.test(target)) ante = { kind: "same", e: effective[Number(target.slice(1))] ?? null };
  else if (target === "v1") ante = { kind: "activity", activity: snap?.activity ?? null };
  else if (target && RF.LABEL.claim.test(target)) ante = { kind: "claim", claim: bindings.claims?.[target] ?? null };
  else if (target && RF.LABEL.anchor.test(target)) {
    const where = bindings.anchors?.[target] ?? null;
    const anchor = (snap?.surface_anchors ?? []).find((a) => a.event_id === where?.event_id) ?? null;
    const span = anchor?.spans?.[where?.span ?? 0] ?? null;
    ante = { kind: "anchor", speaker_id: anchor?.speaker_id ?? null, request: span?.request_id ? requests.find((r) => r.request_id === span.request_id) ?? null : null, predicate: span?.predicate ?? null };
  }
  const sameAsk = ante?.kind === "same" && ante.e ? (ante.e.predicate ? ante.e : ante.e.claim_facet ? { ...ante.e, predicate: ante.e.claim_facet } : ante.e) : null;
  const source = ante?.request ? { request_id: ante.request.request_id, predicate: ante.request.predicate, args: ante.request.args, temporal: ante.request.temporal, targets: ante.request.targets ?? [] }
    : sameAsk ? { request_id: null, predicate: sameAsk.predicate, args: sameAsk.args, temporal: sameAsk.temporal_scope, targets: sameAsk.addressee?.ids ?? [] }
      : ante?.kind === "activity" && ante.activity ? { request_id: null, predicate: ante.activity.template?.predicate ?? null, args: null, temporal: null, targets: [...(ante.activity.completed ?? [])] }
        : ante?.kind === "claim" && ante.claim ? { request_id: null, predicate: ante.claim.facet, args: null, temporal: null, targets: [] }
          : ante?.kind === "anchor" ? { request_id: null, predicate: ante.predicate, args: null, temporal: null, targets: [] } : null;
  const failClosed = Boolean(criticalRejected || f.clarify.length || (act.abstain ?? []).length);
  // The relation the reader NAMED stands when that field itself was validated (it is the reader's reading, not an
  // inheritance); what it would carry over (facet, arguments) does not when the act fails closed.
  const relationValid = !f.rejected.has("relation") && !f.clarify.some((c) => c.field === "relation") && !(act.abstain ?? []).includes("relation");
  if (failClosed && relationValid && source?.request_id && ["continuation", "repair", "topic_return", "attention"].includes(kind) && !(ante.kind === "anchor" && !act.echo)) e.relation_target = source.request_id;
  // The KIND of repair is the reader's reading of this line, whether or not its antecedent resolves.
  if ((kind === "repair" || act.speech_act === "repair") && act.repair_kind && act.repair_kind !== "own_answer") e.repair = { kind: REPAIR_BACK[act.repair_kind] ?? act.repair_kind };
  if (["continuation", "repair", "topic_return", "attention"].includes(kind) && source && !failClosed) {
    // A question about what was SAID (a heard sentence) links to the line, not to its request -- unless it echoes
    // the sentence's words (a surface-anchor re-ask of that request).
    e.relation_target = ante.kind === "anchor" && !act.echo ? null : source.request_id ?? null;
    if (!e.predicate && source.predicate && ASKING.has(e.speech_act)) { e.predicate = source.predicate; e.facet_source = ante.kind === "anchor" ? "surface_anchor" : ante.kind === "activity" ? "inherited_activity" : ante.kind === "claim" ? "player_claim" : "inherited_request"; }
    // The question's own arguments carry over; how the player's line replied to a coworker does not.
    if (e.predicate && e.predicate === source.predicate) { const { reply_kind, answer_option, inbound_kind, answers_predicate, answer_shape, ...args } = source.args ?? {}; e.args = args; e.temporal_scope = source.temporal ?? null; }
  }
  if (kind === "repair" && source && act.repair_kind !== "own_answer" && !failClosed && (ASKING.has(e.speech_act) || act.speech_act === "repair")) {
    e.reissue_of = source.request_id ?? null;
    e.repair = { kind: REPAIR_BACK[act.repair_kind] ?? act.repair_kind ?? null };
    if (act.repair_kind === "unanswered") e.reopen = true;
    e.question_form = null;
  }
  if (kind === "attention" && ante?.request && PENDING.has(ante.request.state) && !failClosed) { e.reissue_of = ante.request.request_id; e.reopen = true; e.predicate = ante.request.predicate; e.question_form = null; e.args = { ...(ante.request.args ?? {}) }; }
  if (kind === "withdraw" && ante?.request) e.withdraw_of = ante.request.request_id;
  // conclude / withdraw of the ACTIVE activity (Reader Phase 2): the reader expressed the relation; whether anything
  // closes is decided here from canonical state -- only an activity that exists and is active can close. With
  // nothing active the line is a social no-op (never a fabricated closure).
  if ((kind === "conclude" || kind === "withdraw") && !failClosed) {
    if (ante?.kind === "activity" && ante.activity && (ante.activity.state ?? "active") === "active") { e.closes_activity = ante.activity.activity_id ?? true; reasons.push(`${kind}:active_activity`); }
    else if (kind === "conclude") reasons.push(target ? "conclude:target_not_active" : "conclude:no_active_activity");
  }

  // ── inbound answers (routing to the asker is the resolver's) ──
  const inbound = snap?.pending_inbound_request ?? null;
  const answerPerson = (act.name_roles ?? []).find((r) => r.role === "answer_to_inbound");
  const optionOf = () => {
    const o = act.inbound_answer?.option ?? null;
    if (o && RF.LABEL.option.test(o)) return bindings.options?.[o] ?? null;
    if (o && OPTION_BACK[o]) return OPTION_BACK[o];
    if (answerPerson) return nameOf(answerPerson.name)?.id ?? null;
    // A thing named as the answer to a question that takes a thing or a place ("the flashlight").
    const ref = act.referent?.candidate && RF.LABEL.referent.test(act.referent.candidate) ? bindings.referents?.[act.referent.candidate] ?? null : null;
    return ref && ["item", "place"].includes(inbound?.answer_shape) ? ref : null;
  };
  if (act.repair_kind === "own_answer" && !failClosed) {
    e.speech_act = "answer"; e.relation = "repair"; e.predicate = null; e.facet_source = null; e.repair = null;
    e.args = { reply_kind: "answer_repair" };
  } else if (!failClosed && (kind === "answer" || (act.inbound_answer && act.inbound_answer.kind !== "counter_question" && act.inbound_answer.kind !== "none"))) {
    const option = optionOf();
    e.speech_act = "answer"; e.relation = "answer"; e.predicate = null; e.facet_source = null; e.question_form = null; e.claim_facet = null;
    e.args = { reply_kind: act.inbound_answer?.kind ?? "answer", inbound_kind: inbound?.kind ?? "question", ...(inbound?.predicate ? { answers_predicate: inbound.predicate } : {}), ...(inbound?.answer_shape ? { answer_shape: inbound.answer_shape } : {}), ...(option != null ? { answer_option: option } : {}) };
  } else if (!failClosed && act.inbound_answer?.kind === "counter_question") {
    e.relation = "continuation";
    e.args = { ...e.args, reply_kind: "counter_question" };
  }

  // ── temporal: what the line expressed, else the antecedent's, else the facet's default ──
  if (act.temporal && act.temporal !== "unspecified" && !ASKING.has(e.speech_act) && e.speech_act !== "answer") e.claim_temporal = act.temporal;
  else if (act.temporal && act.temporal !== "unspecified") e.temporal_scope = act.temporal;
  else if (!e.temporal_scope && e.predicate && ASKING.has(e.speech_act)) e.temporal_scope = registry.get(e.predicate)?.default_temporal ?? null;

  // ── arguments from the reader's structured choices (never fabricated) ──
  const entry = e.predicate ? registry.get(e.predicate) : null;
  const slots = Object.values(entry?.slots ?? {});
  const referentKind = (label) => input.referent_candidates.find((r) => r.label === label)?.kind ?? null;
  const candidate = act.referent?.candidate ?? null;
  if (!failClosed && candidate && RF.LABEL.referent.test(candidate)) {
    const id = bindings.referents?.[candidate] ?? null;
    // Bound into the facet's argument slot when it takes that kind; otherwise the act still NAMES the thing
    // (a remark about the camera): kept as a referent, never dropped.
    if (id && referentKind(candidate) === "item" && (slots.includes("equipment") || String(e.predicate).startsWith("item."))) e.args.item_id = id;
    else if (id && referentKind(candidate) === "place" && slots.includes("place")) { e.args.place_id = id; e.args.place_basis = act.referent.span ? "named" : "salient_topic"; }
    else if (id) e.referent_ids = [id];
  }
  if (!failClosed && RF.DEIXIS_SPECIAL.includes(candidate) && slots.includes("place")) {
    // Deictic place (owner decision #4): the active place the conversation made salient (observer-safe
    // salience); otherwise "inside" is the canonical default and "there" has no antecedent -> clarify.
    const active = input.conversation.active_place ? bindings.referents?.[input.conversation.active_place] ?? null : null;
    if (active) { e.args.place_id = active; e.args.place_basis = "salient_topic"; reasons.push("deixis:active_place"); }
    else if (candidate === "DEIXIS_INSIDE") { e.args.place_id = ctx.deicticInsideDefault; e.args.place_basis = "domain_default_inside"; reasons.push("deixis:inside_default"); }
    else { e.clarify = { reason: "deixis_without_antecedent", slot: "location" }; reasons.push("deixis:no_antecedent"); }
  }
  if (e.predicate && act.polarity === "inverted") e.args.question_inverted = true;
  if (e.predicate && act.polarity === "negative" && ["yes_no", "declarative"].includes(act.question_form)) e.args.question_negated = true;
  if (act.echo?.anchor && !failClosed) { const where = bindings.anchors?.[act.echo.anchor]; if (where?.event_id) e.args.echo = { event_id: where.event_id }; }

  // ── address -> ids (policy; the chip wins) ──
  e.addressee = resolveAddress(act, e, ante, { input, bindings, snap, presentIds, requestOf, nameOf, inbound, chipConflict, failed: Boolean(criticalRejected && criticalRejected.field === "address") || (act.abstain ?? []).includes("address") || f.clarify.some((c) => c.field === "address") });

  // ── subject: who the facet is about (kept apart from the address; owner ruling 1) ──
  const subjectIds = (act.subject?.names ?? []).map((l) => nameOf(l)?.id).filter(Boolean);
  e.subject = act.subject ? { kind: act.subject.kind, ids: subjectIds } : null;
  if (!failClosed && entry?.domain === "person" && act.subject?.kind === "named" && subjectIds.length) {
    const third = subjectIds.find((id) => !(e.addressee?.ids ?? []).includes(id)) ?? null;
    if (third) { e.args.third_party_subject = third; reasons.push("subject:third_party"); }
    else reasons.push("subject:named_addressee");
    if (subjectIds.length > 1) e.args.subject_ids = [...subjectIds];
  }
  if (!failClosed && e.predicate === "person.familiarity") {
    const other = e.mentions.find((id) => id !== e.args.third_party_subject && !(e.addressee?.ids ?? []).includes(id)) ?? null;
    if (other) e.args.other_id = other;
  }
  if (!failClosed && act.subject?.kind === "group_inclusive") reasons.push("subject:group_inclusive_no_address");
  // A reported-speech facet's named subject is the SPEAKER quoted (never a third-party subject).
  if (!failClosed && entry?.slots?.speaker && (subjectIds.length || e.mentions.length)) { e.quoted_speaker = subjectIds[0] ?? e.mentions[0]; delete e.args.third_party_subject; }

  // ── fail closed: rejected routing field / validator clarification / abstention / unresolved set ──
  const abstained = (act.abstain ?? []).map((field) => ABSTAIN_SLOT[field]).find(Boolean) ?? null;
  if (criticalRejected) e.clarify = { reason: `rejected:${criticalRejected.field}:${criticalRejected.code}`, slot: criticalRejected.field === "address" || criticalRejected.field === "subject" || criticalRejected.field === "name_roles" ? "person" : criticalRejected.field === "referent" ? "referent" : criticalRejected.field === "inbound_answer" ? "answer" : "topic" };
  else if (f.clarify.length) e.clarify = { reason: `validator:${f.clarify[0].code}`, slot: f.clarify[0].slot };
  else if (abstained) e.clarify = { reason: "reader_abstained", slot: abstained };
  else if (e.addressee?.mismatch) e.clarify = { reason: "quantifier_mismatch", slot: "person" };
  else if (e.addressee?.source === "ellipsis_unresolved") e.clarify = { reason: "ellipsis_target_unresolved", slot: "person" };
  else if (e.addressee?.source === "active_speakers_several") e.clarify = { reason: "addressee_ambiguous", slot: "person" };
  else if (["continuation", "repair", "topic_return"].includes(kind) && !source && act.repair_kind !== "own_answer" && !ante) e.clarify = { reason: kind === "repair" ? "repair_no_target" : "ellipsis_no_antecedent", slot: "topic" };
  // A question about something SAID ("What makes you say that?") needs a line it is about: a heard sentence, a
  // coworker's question, a request -- or, failing all of those, the exchange the player is in.
  else if (ASKING.has(e.speech_act) && (entry?.slots?.anchor === "utterance" || ["conversation.repetition", "conversation.response_event"].includes(e.predicate)) && !ante && !snap?.active_speaker?.speaker_id && !(snap?.surface_anchors ?? []).length) e.clarify = { reason: "no_utterance_antecedent", slot: "topic" };
  if (e.clarify) {
    e.outcome = "clarify";
    // The planner's slot vocabulary: an unresolved place of a place-taking facet is a "location" clarification.
    const clarifyEntry = registry.get(act.facet) ?? entry;
    if (e.clarify.slot === "referent" && Object.values(clarifyEntry?.slots ?? {}).includes("place") && !Object.values(clarifyEntry?.slots ?? {}).includes("equipment")) e.clarify = { ...e.clarify, slot: "location" };
    // No inherited predicate merely because one exists, no fabricated arguments (Phase 1 item 8).
    if (e.facet_source !== "reader") { e.predicate = null; e.facet_source = null; }
    if (criticalRejected || f.clarify.length || abstained) e.args = {};
    e.reissue_of = null; e.reopen = false;
  }
  // A vacuous addressee repair ("I was speaking to Tonya" -- and Tonya, the only one asked, already answered)
  // re-asks nothing: an acknowledgment, no re-issue.
  const repaired = ante?.request ?? null;
  if (!e.clarify && kind === "repair" && act.repair_kind === "addressee" && repaired && (e.addressee?.ids ?? []).length === 1 && (repaired.targets ?? []).length === 1 && repaired.targets[0] === e.addressee.ids[0] && answeredBy(repaired).includes(e.addressee.ids[0])) {
    e.repair = { kind: "target", vacuous: true }; e.reissue_of = null; e.reopen = false; e.predicate = null; e.facet_source = null; e.args = {}; e.speech_act = "social_acknowledgment";
    reasons.push("repair:vacuous");
  }
  // ── cardinality (registry, via the existing deterministic function) ──
  if (e.outcome === "clarify") e.cardinality = "one_clarifier";
  else if (e.repair?.vacuous) e.cardinality = "each_ack";
  else if (e.args.third_party_subject && ASKING.has(e.speech_act)) e.cardinality = "one_spokesperson";
  else e.cardinality = dialogueTurn.cardinalityFor(e.predicate, e.addressee ?? { kind: "untargeted", ids: [], quantifier: null }, e);
  return e;
}

function resolveAddress(act, e, ante, { input, bindings, snap, presentIds, requestOf, nameOf, inbound, chipConflict, failed }) {
  const op = act.address?.op ?? "NONE";
  const speaker = snap?.active_speaker ?? null;
  const chip = input.chip_target ? bindings.people?.[input.chip_target] ?? null : null;
  if (chip && presentIds.includes(chip)) return { kind: "explicit", ids: [chip], quantifier: null, source: "chip", ...(chipConflict ? { conflict: "chip_vs_vocative" } : {}) };
  if (failed) return null;
  if (op === "NAMED") {
    const persons = (act.address.names ?? []).map(nameOf).filter(Boolean);
    const here = persons.filter((p) => p.present).map((p) => p.id);
    if (!here.length) return { kind: "explicit", ids: [], quantifier: null, source: "vocative_not_present" };
    const repairTarget = (act.name_roles ?? []).some((r) => r.role === "repair_target");
    return { kind: here.length > 1 ? "subset" : "explicit", ids: here, quantifier: null, source: repairTarget || e.relation === "repair" ? "repair" : "vocative" };
  }
  // "Anyone?" / "Can I have everyone's attention?": a room attention call summons nobody in particular.
  if (op === "ALL" && e.speech_act === "attention_call" && !e.predicate) return { kind: "untargeted", ids: [], quantifier: null, source: "room_attention" };
  if (op === "ALL") return { kind: "group", ids: [...presentIds], quantifier: act.respondent_mode === "each" ? "each" : act.respondent_mode === "any" ? "any" : "all", source: e.relation === "repair" ? "repair" : "quantifier" };
  if (op === "EXCEPT") {
    const excluded = (act.address.names ?? []).map(nameOf).filter(Boolean).map((p) => p.id);
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
    return ids.length ? { kind: "subset", ids, quantifier, source: "quantifier" } : { kind: "subset", ids: [], quantifier, source: "quantifier", mismatch: true };
  }
  // SECOND_PERSON / NONE: only antecedents the reader NAMED (or the canonical active speaker for "you") carry an
  // addressee -- never a discourse marker (owner ruling 2).
  const secondPerson = op === "SECOND_PERSON";
  if (e.args.reply_kind === "answer_repair") { const from = snap?.just_answered_inbound?.speaker_id ?? snap?.just_answered_inbound?.from ?? null; return from && presentIds.includes(from) ? { kind: "inherited", ids: [from], quantifier: null, source: "answer_repair" } : { kind: "untargeted", ids: [], quantifier: null, source: "none" }; }
  const asker = inbound?.speaker_id ?? inbound?.from ?? null;
  if (e.relation === "answer" && asker && presentIds.includes(asker)) return { kind: "inherited", ids: [asker], quantifier: null, source: "open_question_answer" };
  if (e.args.reply_kind === "counter_question" && asker && presentIds.includes(asker)) return { kind: "inherited", ids: [asker], quantifier: null, source: "inbound_asker" };
  if (ante?.kind === "anchor" && ante.speaker_id && presentIds.includes(ante.speaker_id)) return { kind: "inherited", ids: [ante.speaker_id], quantifier: null, source: "surface_anchor" };
  // An activity ROUND passes to its remaining member only for a continuation ("your turn"); concluding or withdrawing
  // the round addresses nobody by it (Reader Phase 2).
  if (ante?.kind === "activity" && ante.activity && e.relation === "continuation") {
    const done = new Set(ante.activity.completed ?? []);
    const remaining = presentIds.filter((id) => !done.has(id));
    return remaining.length === 1 ? { kind: "inherited", ids: remaining, quantifier: null, source: "activity_remaining" } : { kind: "inherited", ids: [], quantifier: null, source: "ellipsis_unresolved", ambiguous: remaining };
  }
  if (e.relation === "repair" && ante?.request) {
    const targets = (ante.request.targets ?? []).filter((id) => presentIds.includes(id));
    const answered = answeredBy(ante.request).filter((id) => presentIds.includes(id));
    if (targets.length) return { kind: targets.length > 1 ? "subset" : "explicit", ids: targets, quantifier: null, source: "repaired_request" };
    if (answered.length) return { kind: "inherited", ids: answered.slice(0, 1), quantifier: null, source: "repaired_request" };
  }
  if (e.relation === "attention" && ante?.request && PENDING.has(ante.request.state)) {
    const open = (ante.request.targets ?? []).filter((id) => presentIds.includes(id) && ante.request.slots?.[id]?.state !== "SATISFIED");
    return { kind: open.length > 1 ? "group" : "explicit", ids: open.length ? open : [...presentIds], quantifier: null, source: "pending_request" };
  }
  if (["continuation", "topic_return"].includes(e.relation) && ante?.request) {
    const answered = answeredBy(ante.request).filter((id) => presentIds.includes(id));
    if (answered.length === 1) return { kind: "inherited", ids: answered, quantifier: null, source: "answer_owner" };
  }
  if (secondPerson && speaker?.speaker_id && presentIds.includes(speaker.speaker_id) && (speaker.speaker_ids?.length ?? 1) <= 1) return { kind: "inherited", ids: [speaker.speaker_id], quantifier: null, source: "active_speaker" };
  if (secondPerson && (speaker?.speaker_ids?.length ?? 0) > 1) return { kind: "inherited", ids: [], quantifier: null, source: "active_speakers_several", ambiguous: speaker.speaker_ids.filter((id) => presentIds.includes(id)) };
  return { kind: "untargeted", ids: [], quantifier: null, source: "none", ...(secondPerson ? { second_person: true } : {}) };
}

/** The canonical owners the response policy ranks (resolver-derived; ids only). */
function ownersOf(e, ctx) {
  const src = e.addressee?.source ?? null;
  const ids = e.addressee?.ids ?? [];
  const inbound = ctx.snap?.pending_inbound_request ?? null;
  const asker = inbound?.speaker_id ?? inbound?.from ?? ctx.snap?.just_answered_inbound?.speaker_id ?? ctx.snap?.just_answered_inbound?.from ?? null;
  return {
    explicit: ["chip", "vocative", "quantifier"].includes(src) ? ids : [],
    repair_target: ["repair", "repaired_request"].includes(src) ? ids : [],
    antecedent_owner: ["answer_owner", "surface_anchor", "active_speaker", "inbound_asker", "open_question_answer", "answer_repair", "pending_request"].includes(src) ? ids : [],
    activity_target: src === "activity_remaining" ? ids : [],
    inbound_asker: asker ? [asker] : [],
    // The one the player is talking with (canonical: the last single coworker who answered them).
    active_speaker: ctx.snap?.active_speaker?.speaker_id && ctx.presentIds.includes(ctx.snap.active_speaker.speaker_id) ? [ctx.snap.active_speaker.speaker_id] : []
  };
}

/** Request / activity / inbound lifecycle INTENT of the primary act (the ledger is not touched). */
function lifecycleOf(primary, routing, ctx) {
  const requests = ctx.requests;
  const out = { request: { intent: "none", target: null, predicate: null, targets: [] }, duplicate_of: null, abandons: [], activity: { intent: "none", kind: null }, inbound: { intent: "none", asker: null }, withdraw: null };
  if (!primary) return out;
  // An attention call that asks nothing ("Hello?") gets attention, not a request (legacy NON_REQUEST_FUNCTIONS: attend).
  const isRequest = ASKING.has(primary.speech_act) && !primary.repair?.vacuous && !(primary.speech_act === "attention_call" && !primary.predicate && primary.outcome !== "clarify");
  let currentPredicate = null;
  if (isRequest) {
    const prior = primary.reissue_of ? requests.find((r) => r.request_id === primary.reissue_of) ?? null : null;
    currentPredicate = primary.predicate ?? null;
    // Identity is CANONICAL: the re-issued request and its predicate -- never the request's words.
    const intent = primary.outcome === "clarify" ? "open_clarifying" : prior && prior.predicate === primary.predicate ? "reopen" : prior ? "supersede_and_open" : "open";
    out.request = { intent, target: prior?.request_id ?? null, predicate: currentPredicate, targets: [...routing.responders] };
    // A duplicate: the same canonical question (predicate, args, temporal) already answered by the responder.
    if (intent === "open" && currentPredicate) {
      const key = JSON.stringify([currentPredicate, primary.args?.item_id ?? null, primary.args?.place_id ?? null, primary.args?.third_party_subject ?? null, primary.temporal_scope ?? null]);
      const recent = requests.slice(-3).reverse().find((r) => JSON.stringify([r.predicate, r.args?.item_id ?? null, r.args?.place_id ?? null, r.args?.third_party_subject ?? null, r.temporal ?? null]) === key && answeredBy(r).some((id) => routing.responders.includes(id)));
      out.duplicate_of = recent?.request_id ?? null;
    }
  }
  // Deterministic staleness (dialogue-state.ageRequests): pending requests the turn neither re-issues nor shares.
  for (const r of requests) {
    if (!PENDING.has(r.state) || r.request_id === primary.reissue_of || (currentPredicate && r.predicate === currentPredicate)) continue;
    if ((r.turns_since ?? 0) + 1 >= ABANDON_AFTER_TURNS) out.abandons.push(r.request_id);
  }
  const activityKind = currentPredicate ? ACTIVITY_OF[currentPredicate] ?? null : null;
  const active = ctx.snap?.activity ?? null;
  if (activityKind) out.activity = { intent: !active ? "start" : active.kind === activityKind ? "continue" : "supersede", kind: activityKind };
  // Reader Phase 2: an act of this turn that concludes / withdraws the active activity closes it (INTENT only),
  // unless the primary act itself starts, continues or supersedes an activity (recorded as a conflict).
  const closing = (ctx.effective ?? []).find((x) => x.closes_activity);
  if (closing && active) {
    if (out.activity.intent === "none") out.activity = { intent: "close", kind: active.kind };
    else out.activity_conflict = { close_requested_by_act: closing.index, kept: out.activity.intent };
  }
  if (primary.speech_act === "answer") out.inbound = { intent: primary.args?.reply_kind === "answer_repair" ? "answer_repair" : primary.args?.reply_kind ?? "answer", asker: primary.addressee?.ids?.[0] ?? null };
  else if (primary.args?.reply_kind === "counter_question") out.inbound = { intent: "counter_question", asker: primary.addressee?.ids?.[0] ?? null };
  if (primary.withdraw_of) out.withdraw = primary.withdraw_of;
  return out;
}

/** The Phase-1 SHADOW resolution of one ReaderFrame under its verdict. */
function resolveShadow(frame, state, present, { verdict, input, bindings, opaque = null, canonical = {} }) {
  const disposition = RF.dispositionOf(verdict);
  const snap = state?.snapshot ?? null;
  const requests = state?.ledger?.requests ?? [];
  const presentIds = present.map((p) => p.id);
  if (disposition === RF.DISPOSITIONS.INVALID || !frame?.acts?.length) {
    return deepFreeze({ version: RESOLVE_TURN_VERSION, source: "shadow", disposition: RF.DISPOSITIONS.INVALID, outcome: "invalid", acts: [], primary_index: -1, primary: null, routing: null, lifecycle: null, clarification: null, conflicts: [], reasons: [frame ? "validator:V0" : "no_frame"] });
  }
  const ctx = { input, bindings, snap, requests, presentIds, opaque, findings: findingsOf(verdict), deicticInsideDefault: canonical.deictic_inside_default ?? DEICTIC_INSIDE_DEFAULT };
  const effective = [];
  frame.acts.forEach((act, i) => effective.push(resolveAct(act, i, ctx, effective)));
  ctx.effective = effective;
  const primary = primaryOf(effective);
  const primaryIndex = effective.indexOf(primary);
  const routing = policy.decideResponse({
    act: { speech_act: primary.speech_act, facet: primary.predicate, claim_facet: primary.claim_facet, quoted_speaker: primary.quoted_speaker ?? null, assignment_question: registry.get(primary.predicate)?.route?.fn === "ask_assignment_purpose", relation: primary.relation, reply_kind: primary.args?.reply_kind ?? null, address_op: frame.acts[primaryIndex]?.address?.op ?? "NONE", respondent_mode: frame.acts[primaryIndex]?.respondent_mode ?? "unspecified", third_party_subject: primary.args?.third_party_subject ?? null, outcome: primary.outcome, vacuous: Boolean(primary.repair?.vacuous) },
    address: primary.addressee,
    owners: { ...ownersOf(primary, ctx), item_holder: ["ask_item_ownership"].includes(registry.get(primary.predicate)?.route?.fn) && primary.args?.item_id && canonical.items?.[primary.args.item_id]?.holder ? [canonical.items[primary.args.item_id].holder] : [] },
    present: presentIds,
    // Canonical knowledge flags are valid only for the facet production computed them for; for any other facet
    // the policy gets none (it never invents a knower) and the reason is recorded.
    candidates: canonical.candidates && (canonical.candidates_facet ?? null) === (primary.predicate ?? null) ? canonical.candidates : null,
    cardinality: primary.cardinality
  });
  const lifecycle = lifecycleOf(primary, routing, ctx);
  const conflicts = [...new Set(effective.flatMap((e) => e.conflicts))];
  return deepFreeze({
    version: RESOLVE_TURN_VERSION,
    source: "shadow",
    disposition,
    outcome: primary.outcome,
    acts: effective,
    primary_index: primaryIndex,
    primary,
    routing,
    lifecycle,
    clarification: primary.clarify ? { ...primary.clarify } : null,
    conflicts,
    reasons: [...effective.flatMap((e) => e.reasons.map((r) => `act${e.index}:${r}`)), ...routing.reasons, ...(canonical.candidates && (canonical.candidates_facet ?? null) !== (primary.predicate ?? null) ? ["knowledge_flags_unavailable_for_facet"] : [])]
  });
}

/**
 * Production passes `legacy` and gets it back unchanged (identity). The shadow and the harnesses pass the
 * validator verdict, { input, bindings }, opaque presentation strings and canonical context.
 */
function resolveTurn(readerFrame, dialogueState, presentActors = [], { legacy = null, verdict = undefined, input = null, bindings = null, opaque = null, canonical = {} } = {}) {
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
  if (verdict === undefined || !input || !bindings) throw Object.assign(new Error("resolveTurn: a shadow resolution needs the validator verdict, the ReaderInput and its bindings"), { code: "RESOLVER_INPUT_MISSING" });
  const state = dialogueState?.snapshot || dialogueState?.ledger ? dialogueState : { snapshot: dialogueState, ledger: { requests: [] } };
  const out = resolveShadow(readerFrame, state, presentActors, { verdict, input, bindings, opaque, canonical });
  // Compatibility with the Phase-0.5 harness shape.
  return Object.freeze({ ...out, effective: out.acts });
}

module.exports = { RESOLVE_TURN_VERSION, RESOLVER_OWNERSHIP, ROUTING_CRITICAL, DEICTIC_INSIDE_DEFAULT, resolveTurn, resolveShadow, primaryOf, findingsOf };
