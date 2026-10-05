#!/usr/bin/env node
"use strict";

// Reader Phase 0 / 0.5 -- the GOLD-DIS EVALUATOR (developer tooling only).
//
// Evaluates the ACTUAL shipped service composition (DesktopService, every overlay and owner rule included). The
// discourse state each item needs is BUILT canonically and VERIFIED: a scripted prefix is played through the real
// service (say / chip target / coworker question via dialogue-state.recordInboundRequest / an unanswered request
// via dialogue-state.openRequest / cold reload), and CHECKPOINTS assert the canonical state it produced. Context is
// never rebuilt by re-parsing prose. An item whose prefix does not build its stated state is `prefix_invalid`; an
// item whose gold frame depends on state its checkpoints do not verify is `incomplete_state_verification`.
// Neither is scored.
//
// The service runs with a scripted ORACLE reader returning the item's gold ReaderFrame for the target turn; the
// legacy reader v0 is recorded alongside it through the same seam. Three measurements, kept separate:
//   reader     legacy v0 frame vs gold frame, every routing-relevant field the gold specifies
//   resolver   resolveTurn(gold frame, the REAL pre-turn DIS + ledger, the REAL present actors, input + bindings)
//              vs the gold resolution -- a SPEC SUITE expected to reach 100% (frame-driven resolver, measurement
//              only; production still uses the legacy passthrough)
//   behaviour  what production actually did: responders, facet, relation, cardinality, clarification, silence,
//              request lifecycle (opened / changed), inbound routing, ledger effects
//
// Item format (JSONL; lines starting // are comments):
//   { id, provider?: "fallback"|"garbage", prefix: [ step & { checkpoint? } ], utterance, target?,
//     checks?: { salient?: [names], active_place?: name, inbound_options?: n },
//     gold: { frame?: ReaderFrame (symbolic refs allowed), resolution?: { addressees, facet, relation, cardinality,
//             clarify, source }, behavior?: { responders, facet, relation, cardinality, clarify, silence,
//             requests_opened: [{predicate, state?}], requests_changed: [{predicate, state}], answered_to } } }
//   step: { say, target? } | { coworker_asks: {...} } | { open_request: {...} } | { reload: true }
//   checkpoint: { requests?: [{ predicate, targets?, state?, answered_by? }], activity?: { kind, done? },
//                 anchors?: { speaker, contains? }, inbound?: { from, answer_shape?, options? } | false,
//                 active_speaker?: [names] }
// Symbolic references in a gold frame (resolved against the target turn's own ReaderInput):
//   "@Tonya" -> the name span with that text; "req:<facet>" / "req:latest" -> a request label; "inbound" -> i1;
//   "ref:<name>" -> a referent candidate; "anchor:<speaker>" -> that speaker's latest heard sentence; "activity" -> v1;
//   inbound_answer.option "opt:<option text>" -> that offered option's label.
//
//   node tools/dialogue-gold-eval.js <items.jsonl> [--json] [--show-input <item id>]

const fs = require("node:fs");
const RF = require("./dialogue-reader-frame");
const reader = require("./dialogue-reader");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { openScenario, providerFor, ledgerView } = require("./dialogue-characterize");

const GOLD_EVAL_VERSION = "yellow-beast-reader-gold-eval@v4";
const ROUTING_FIELDS = ["speech_act", "address", "facet", "relation"];
const FIELDS = ["speech_act", "question_form", "address", "name_roles", "facet", "relation", "repair_kind", "subject", "referent", "temporal", "respondent_mode", "inbound_answer", "abstain"];

const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Resolve symbolic references in a gold frame against one ReaderInput (labels are per-turn). `ctx` (harness-side,
 * never a reader's) gives the code-side bindings and entity index, so "ref:<canonical label>" resolves even when the
 * reader is shown the player's literal words for a line-named thing (Reader Phase 2).
 */
function referentLabelFor(ref, input, ctx = {}) {
  const want = ref.slice(4).toLowerCase();
  const byName = input.referent_candidates.find((r) => String(r.name).toLowerCase() === want);
  if (byName) return byName.label;
  const entity = (ctx.entities ?? []).find((e) => String(e.label ?? "").toLowerCase() === want);
  const label = entity ? Object.entries(ctx.bindings?.referents ?? {}).find(([, id]) => id === entity.id)?.[0] : null;
  return label ?? `UNRESOLVED:${ref}`;
}
function resolveGoldFrame(gold, input, ctx = {}) {
  const name = (ref) => (typeof ref === "string" && ref.startsWith("@") ? input.features.name_spans.find((n) => n.text.toLowerCase() === ref.slice(1).toLowerCase())?.label ?? `UNRESOLVED:${ref}` : ref);
  const target = (ref) => {
    if (typeof ref !== "string") return ref ?? null;
    if (ref === "inbound") return input.conversation.inbound?.label ?? "UNRESOLVED:inbound";
    if (ref === "activity") return input.conversation.activity?.label ?? "UNRESOLVED:activity";
    if (ref === "claim") return input.conversation.player_claim?.label ?? "UNRESOLVED:claim";
    if (ref.startsWith("anchor:")) { const who = input.people.find((p) => p.name.toLowerCase() === ref.slice(7).toLowerCase())?.label; return input.heard.anchors.filter((a) => a.speaker === who).at(-1)?.label ?? `UNRESOLVED:${ref}`; }
    if (!ref.startsWith("req:")) return ref;
    const want = ref.slice(4);
    const pool = want === "latest" ? input.conversation.requests.filter((r) => r.distance === 0) : input.conversation.requests.filter((r) => r.facet === want);
    return pool.sort((a, b) => a.distance - b.distance)[0]?.label ?? `UNRESOLVED:${ref}`;
  };
  const referent = (ref) => (typeof ref === "string" && ref.startsWith("ref:") ? referentLabelFor(ref, input, ctx) : ref);
  const acts = (gold.acts ?? []).map((a) => {
    const out = structuredClone(a);
    if (out.span === "all" || !out.span) out.span = [0, input.line.tokens.length - 1];
    if (out.address) out.address = { op: out.address.op, names: (out.address.names ?? []).map(name), relative_to: target(out.address.relative_to ?? null), count: out.address.count ?? null };
    if (out.name_roles) out.name_roles = out.name_roles.map((r) => ({ name: name(r.name), role: r.role }));
    if (out.relation) out.relation = { kind: out.relation.kind, target: target(out.relation.target ?? null) };
    if (out.subject) out.subject = { kind: out.subject.kind, names: (out.subject.names ?? []).map(name) };
    if (out.referent) out.referent = { span: out.referent.span ?? null, candidate: referent(out.referent.candidate) };
    if (out.echo?.anchor) out.echo = { anchor: target(out.echo.anchor) };
    if (out.inbound_answer?.option && String(out.inbound_answer.option).startsWith("opt:")) out.inbound_answer = { ...out.inbound_answer, option: (input.conversation.inbound?.options ?? []).find((o) => String(o.text ?? "").toLowerCase() === out.inbound_answer.option.slice(4).toLowerCase())?.label ?? `UNRESOLVED:${out.inbound_answer.option}` };
    return out;
  });
  return { version: RF.READER_FRAME_VERSION, acts };
}

/** The complete ReaderFrame an oracle returns (gold fields over neutral defaults, so V0 can validate it). */
function completeFrame(frame) {
  const defaults = { name_roles: [], question_form: "none", polarity: "positive", address: { op: "NONE", names: [], relative_to: null, count: null }, relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [] };
  return { version: frame.version, acts: frame.acts.map((a) => ({ ...defaults, ...a })) };
}

const fieldValue = (act, field) => {
  if (!act) return null;
  if (field === "address") return act.address ? { op: act.address.op, names: [...(act.address.names ?? [])].sort(), relative_to: act.address.relative_to ?? null } : null;
  if (field === "relation") return act.relation ? { kind: act.relation.kind, target: act.relation.target ?? null } : null;
  if (field === "subject") return act.subject ? { kind: act.subject.kind, names: [...(act.subject.names ?? [])].sort() } : null;
  if (field === "referent") return act.referent ? act.referent.candidate : null;
  if (field === "name_roles") return [...(act.name_roles ?? [])].map((r) => `${r.name}:${r.role}`).sort();
  if (field === "abstain") return [...(act.abstain ?? [])].sort();
  return act[field] ?? null;
};
/** Per-field agreement between a reader's frame and the gold frame (only the fields gold specifies). */
function compareFrames(got, gold, goldSpecified) {
  const out = {};
  const primary = (f) => f?.acts?.at(-1) ?? null;
  for (const field of FIELDS) if (goldSpecified.has(field)) out[field] = same(fieldValue(primary(got), field), fieldValue(primary(gold), field));
  return out;
}

// ─── state verification ────────────────────────────────────────────────────────────────────────────────
function checkpointProblem(checkpoint, s) {
  if (!checkpoint) return null;
  const run = s.run;
  const names = Object.fromEntries(s.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
  const n = (ids) => (ids ?? []).map((id) => names[id] ?? id).sort();
  const view = ledgerView(run);
  for (const want of checkpoint.requests ?? []) {
    const hit = [...view.requests].reverse().find((r) => r.predicate === want.predicate && (!want.targets || same(n(r.targets), [...want.targets].sort())) && (!want.state || r.state === want.state) && (!want.answered_by || same(n(r.answered_by), [...want.answered_by].sort())));
    if (!hit) return { check: "requests", expected: want, ledger: view.requests.slice(-4).map((r) => ({ predicate: r.predicate, targets: n(r.targets), state: r.state, answered_by: n(r.answered_by) })) };
  }
  const snap = require("./dialogue-state").snapshot(run, { player_id: s.playerId, location_id: run.spatial?.player_location ?? null, present_ids: s.coworkers().map((m) => m.personnel_id ?? m.id) });
  if (checkpoint.activity === false) { if (snap.activity) return { check: "activity", expected: false, got: { kind: snap.activity.kind } }; }
  else if (checkpoint.activity) {
    const a = snap.activity;
    if (!a || a.kind !== checkpoint.activity.kind || (checkpoint.activity.done && !same(n(a.completed), [...checkpoint.activity.done].sort()))) return { check: "activity", expected: checkpoint.activity, got: a ? { kind: a.kind, done: n(a.completed) } : null };
  }
  if (checkpoint.anchors) {
    const who = s.id(checkpoint.anchors.speaker);
    const anchors = (snap.surface_anchors ?? []).filter((a) => a.speaker_id === who);
    const text = anchors.flatMap((a) => a.spans.map((x) => x.text)).join(" ");
    if (!anchors.length || (checkpoint.anchors.contains && !text.toLowerCase().includes(checkpoint.anchors.contains.toLowerCase()))) return { check: "anchors", expected: checkpoint.anchors, got: text || null };
  }
  if ("inbound" in checkpoint) {
    const ib = snap.pending_inbound_request;
    if (checkpoint.inbound === false) { if (ib) return { check: "inbound", expected: false, got: true }; }
    else if (!ib || names[ib.from ?? ib.speaker_id] !== checkpoint.inbound.from || (checkpoint.inbound.answer_shape && ib.answer_shape !== checkpoint.inbound.answer_shape) || (checkpoint.inbound.options != null && (ib.options ?? []).length !== checkpoint.inbound.options)) return { check: "inbound", expected: checkpoint.inbound, got: ib ? { from: names[ib.from ?? ib.speaker_id], answer_shape: ib.answer_shape, options: (ib.options ?? []).length } : null };
  }
  // Reader state (owner ruling 3): the player's previous claim, as the seam will offer it to the next reading.
  if (checkpoint.claim) { const c = s.service.readerClaimFor?.(run) ?? null; if (!c || c.facet !== checkpoint.claim.facet || (checkpoint.claim.state && c.state !== checkpoint.claim.state)) return { check: "claim", expected: checkpoint.claim, got: c ? { facet: c.facet, state: c.state } : null }; }
  if (checkpoint.active_speaker && !same(n(snap.active_speaker?.speaker_ids ?? []), [...checkpoint.active_speaker].sort())) return { check: "active_speaker", expected: checkpoint.active_speaker, got: n(snap.active_speaker?.speaker_ids ?? []) };
  return null;
}
/** Which checkpoint kinds a gold frame's claims depend on; an item that verifies none of them is incomplete. */
function requiredVerification(goldFrame) {
  const act = goldFrame?.acts?.at(-1) ?? null;
  if (!act) return [];
  const need = [];
  const kind = act.relation?.kind;
  const target = String(act.relation?.target ?? "");
  if (kind === "answer" || (act.inbound_answer && act.inbound_answer.kind !== "none") || target === "inbound") need.push(["inbound"]);
  if (["continuation", "repair", "topic_return", "attention"].includes(kind) && target && target !== "inbound") need.push(target === "activity" ? ["activity"] : target === "claim" ? ["claim"] : target.startsWith("anchor:") ? ["anchors"] : ["requests", "activity", "anchors"]);
  if (["OTHERS", "SECOND_PERSON"].includes(act.address?.op)) need.push(["requests", "active_speaker", "activity"]);
  // Reader Phase 2: a conclude / withdraw rests on the activity state (active, or verifiably none).
  if (["conclude", "withdraw"].includes(kind) && (target === "activity" || kind === "conclude")) need.push(["activity"]);
  return need;
}

function behaviourOf(s, requestId, before) {
  const run = s.run;
  const names = Object.fromEntries(s.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const first = contexts[0]?.semantic_frame ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  const after = ledgerView(run);
  const beforeIds = new Set(before.requests.map((r) => r.request_id));
  return {
    responders: contexts.map((c) => names[c.target_worker_id] ?? c.target_worker_id).sort(),
    facet: first?.predicate ?? interaction?.turn?.primary?.predicate ?? null,
    relation: interaction?.turn?.primary?.relation ?? null,
    cardinality: first?.turn?.cardinality ?? null,
    clarify: contexts.some((c) => c.response_plan?.may_ask_clarifying_question) || first?.discourse_function === "ambiguous_reference",
    silence: contexts.length === 0,
    requests_opened: after.requests.filter((r) => !beforeIds.has(r.request_id)).map((r) => ({ predicate: r.predicate, state: r.state })),
    requests_changed: after.requests.filter((r) => beforeIds.has(r.request_id)).map((r) => ({ r, was: before.requests.find((x) => x.request_id === r.request_id) })).filter(({ r, was }) => r.state !== was.state).map(({ r, was }) => ({ predicate: r.predicate, state: `${was.state}->${r.state}` })),
    // Inbound routing: who the player's line was put to (the effective act's addressee).
    answered_to: (interaction?.turn?.primary?.addressee?.ids ?? interaction?.address?.addressee_ids ?? []).map((id) => names[id] ?? id).sort()
  };
}
function compareBehaviour(got, gold) {
  const out = {};
  for (const key of ["responders", "facet", "relation", "cardinality", "clarify", "silence", "answered_to"]) if (key in gold) out[key] = same(Array.isArray(gold[key]) ? [...gold[key]].sort() : gold[key], got[key]);
  for (const key of ["requests_opened", "requests_changed"]) if (key in gold) out[key] = gold[key].every((want) => got[key].some((x) => x.predicate === want.predicate && (!want.state || x.state === want.state))) && (gold[key].length > 0 || got[key].length === 0);
  return out;
}
function compareResolution(resolved, gold, names, ledger, bindings) {
  const p = resolved?.primary ?? null;
  const out = {};
  if ("addressees" in gold) out.addressees = same((p?.addressee?.ids ?? []).map((id) => names[id] ?? id).sort(), [...gold.addressees].sort());
  if ("source" in gold) out.source = (p?.addressee?.source ?? null) === gold.source;
  if ("facet" in gold) out.facet = (p?.predicate ?? null) === gold.facet;
  if ("relation" in gold) {
    const target = p?.relation_target ? (ledger?.requests ?? []).find((r) => r.request_id === p.relation_target)?.predicate ?? "unknown" : null;
    out.relation = (p?.relation ?? null) === gold.relation.kind && (!("target_facet" in gold.relation) || target === gold.relation.target_facet);
  }
  if ("cardinality" in gold) out.cardinality = (p?.cardinality ?? null) === gold.cardinality;
  if ("clarify" in gold) out.clarify = Boolean(p?.clarify) === gold.clarify;
  if ("args" in gold) out.args = Object.entries(gold.args).every(([k, v]) => same(p?.args?.[k], v));
  return out;
}

/**
 * The Phase-1 RESOLVER SPEC: the shadow resolution of the gold frame against doctrine / owner-ruling gold (never
 * legacy output). Names are compared by first name; spec keys are optional and only the ones given are checked.
 */
function shadowView(shadow, names) {
  const res = shadow?.resolution ?? {};
  const p = res.primary ?? {};
  const n = (id) => names[id] ?? id;
  const ns = (ids) => (ids ?? []).map(n).sort();
  const lc = res.lifecycle ?? {};
  return {
    disposition: res.disposition ?? null, outcome: res.outcome ?? null,
    addressees: ns(p.addressee?.ids), responders: ns(res.routing?.responders), responders_count: (res.routing?.responders ?? []).length,
    recipients: ns(res.routing?.recipients), owner_basis: res.routing?.owner_basis ?? null, cardinality: res.routing?.cardinality ?? null,
    silence: res.routing ? Boolean(res.routing.silence) : null, response_required: res.routing ? Boolean(res.routing.response_required) : null,
    speech_act: p.speech_act ?? null, facet: p.predicate ?? null, facet_source: p.facet_source ?? null, claim_facet: p.claim_facet ?? null,
    relation: p.relation ?? null, relation_target_facet: p.relation_target ? "(request)" : null, reissue: Boolean(p.reissue_of),
    clarify: Boolean(res.clarification), clarify_slot: res.clarification?.slot ?? null,
    subject_kind: p.subject?.kind ?? null, third_party: p.args?.third_party_subject ? n(p.args.third_party_subject) : null, quoted_speaker: p.quoted_speaker ? n(p.quoted_speaker) : null, other: p.args?.other_id ? n(p.args.other_id) : null, mentions: ns(p.mentions),
    temporal: shadow?.frame?.turn?.temporal_scope ?? p.temporal_scope ?? null, place: p.args?.place_id ?? null, place_basis: p.args?.place_basis ?? null, item: p.args?.item_id ?? null,
    reply_kind: p.args?.reply_kind ?? null, answer_option: p.args?.answer_option != null ? (names[p.args.answer_option] ?? p.args.answer_option) : null,
    request: lc.request?.intent ?? null, duplicate: Boolean(lc.duplicate_of), abandons: (lc.abandons ?? []).length, activity: lc.activity && lc.activity.intent !== "none" ? `${lc.activity.intent}:${lc.activity.kind}` : null, activity_conflict: Boolean(lc.activity_conflict), inbound: lc.inbound && lc.inbound.intent !== "none" ? lc.inbound.intent : null,
    conflicts: [...(res.conflicts ?? [])].sort(), discourse_function: shadow?.frame?.discourse_function ?? null, request_text: p.request_text ?? null
  };
}
function compareShadow(shadow, spec, names) {
  if (!shadow) return { status: "no_shadow", correct: false, fields: {} };
  const got = shadowView(shadow, names);
  const fields = {};
  for (const [k, want] of Object.entries(spec)) fields[k] = same(Array.isArray(want) ? [...want].sort() : want, got[k]);
  return { status: "evaluated", correct: Object.values(fields).every(Boolean), fields, got };
}

/** Plays one item through a fresh production service with an oracle reader. */
async function evaluateItem(item, { onInput = null } = {}) {
  const script = new Map();
  const oracle = reader.createOracleReader(script);
  // Harness-side capture of the code-side bindings / entity index of the latest reading (for symbolic references
  // only; the oracle reader itself still sees the ReaderInput alone).
  const built = { last: null };
  const { buildReaderInput } = require("./dialogue-reader-input");
  const readerInputBuilder = (args) => { const b = buildReaderInput(args); built.last = { bindings: b.bindings, entities: args.entities ?? [] }; return b; };
  const s = openScenario({ seed: item.seed ?? `gold-${item.id}`, names: item.names, provider: providerFor(item, item.provider ?? "fallback"), offline: (item.provider ?? "fallback") === "fallback", serviceOptions: { dialogueReader: oracle, readerShadow: true, readerInputBuilder } });
  try {
    const verified = new Set();
    let n = 0;
    for (const step of item.prefix ?? []) {
      if (step.reload) s.reload();
      else if (step.open_request) s.openRequest(step.open_request);
      else if (step.coworker_asks) s.coworkerAsks(step.coworker_asks);
      else if (step.say) {
        const id = `p-${++n}`;
        // A prefix line may carry its own gold frame (reader state the target turn depends on, e.g. a claim).
        if (step.frame) script.set(id, (input) => completeFrame(resolveGoldFrame(step.frame, input, built.last ?? {})));
        await s.say(step.say, { target: step.target ?? null, request_id: id });
      }
      const problem = checkpointProblem(step.checkpoint, s);
      if (problem) return { id: item.id, status: "prefix_invalid", at: n, problem };
      for (const k of Object.keys(step.checkpoint ?? {})) verified.add(k);
    }
    // An item-level checkpoint verifies the state right before the target turn (e.g. a fresh conversation).
    if (item.checkpoint) { const problem = checkpointProblem(item.checkpoint, s); if (problem) return { id: item.id, status: "prefix_invalid", at: "target", problem }; for (const k of Object.keys(item.checkpoint)) verified.add(k); }
    // The gold frame's claims must rest on verified canonical state.
    const need = item.gold?.frame ? requiredVerification(item.gold.frame) : [];
    const missing = need.filter((alternatives) => !alternatives.some((k) => verified.has(k)));
    if (missing.length) return { id: item.id, status: "incomplete_state_verification", missing: missing.map((m) => m.join("|")) };
    const targetId = "target";
    script.set(targetId, (input) => { onInput?.(input, built.last); return item.gold?.frame ? completeFrame(resolveGoldFrame(item.gold.frame, input, built.last ?? {})) : null; });
    const before = ledgerView(s.run);
    await s.say(item.utterance, { target: item.target ?? null, request_id: targetId });
    const record = s.service.readerReceipts.get(targetId);
    if (!record) return { id: item.id, status: "no_seam_record" };
    // Target-time checks against what the reader was given (observer-safe state).
    const checkFailures = [];
    const refCtx = { bindings: record.context.bindings, entities: record.context.entities ?? [] };
    if (item.checks?.salient) for (const nm of item.checks.salient) { const label = referentLabelFor(`ref:${nm}`, record.input, refCtx); if (!record.input.conversation.salient_entities.includes(label)) checkFailures.push(`salient:${nm}`); }
    if (item.checks?.heard_salient) for (const nm of item.checks.heard_salient) { const label = referentLabelFor(`ref:${nm}`, record.input, refCtx); if (!record.input.heard.salient_entities.includes(label)) checkFailures.push(`heard_salient:${nm}`); }
    if (item.checks?.active_place) { const label = referentLabelFor(`ref:${item.checks.active_place}`, record.input, refCtx); if (record.input.conversation.active_place !== label) checkFailures.push(`active_place:${item.checks.active_place}`); }
    if (item.checks?.inbound_options != null && (record.input.conversation.inbound?.options ?? []).length !== item.checks.inbound_options) checkFailures.push("inbound_options");
    if (checkFailures.length) return { id: item.id, status: "prefix_invalid", problem: { check: "target_state", failed: checkFailures } };
    const goldFrame = record.receipt.frame;
    const goldSpecified = new Set(Object.keys(item.gold?.frame?.acts?.at(-1) ?? {}));
    const readerCompare = goldFrame ? compareFrames(record.legacy_v0.frame, goldFrame, goldSpecified) : {};
    const names = Object.fromEntries(s.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
    let resolver = null;
    if (goldFrame && item.gold?.resolution) {
      try {
        const ctx = record.context;
        // The Phase-1 shadow resolution the service computed for the oracle's gold frame (real pre-turn DIS, real
        // present actors, real bindings, the validator verdict, canonical knowledge flags).
        const resolved = record.shadow?.resolution ?? resolveTurn(goldFrame, { snapshot: ctx.snapshot, ledger: ctx.ledger ?? { requests: [] } }, ctx.present, { verdict: record.receipt.verdict, input: record.input, bindings: ctx.bindings });
        const fields = compareResolution(resolved, item.gold.resolution, names, ctx.ledger, ctx.bindings);
        resolver = { status: "evaluated", fields, correct: Object.values(fields).every(Boolean), got: { addressees: (resolved.primary?.addressee?.ids ?? []).map((id) => names[id] ?? id), source: resolved.primary?.addressee?.source ?? null, facet: resolved.primary?.predicate ?? null, relation: resolved.primary?.relation ?? null, cardinality: resolved.primary?.cardinality ?? null, clarify: resolved.primary?.clarify ?? null } };
      } catch (error) { resolver = { status: "error", detail: error.message }; }
    }
    const shadow = item.gold?.shadow ? compareShadow(record.shadow, item.gold.shadow, names) : null;
    const gotBehaviour = behaviourOf(s, targetId, before);
    const behaviour = item.gold?.behavior ? compareBehaviour(gotBehaviour, item.gold.behavior) : {};
    return {
      id: item.id, status: "scored", utterance: item.utterance,
      gold_frame_verdict: record.receipt.verdict,
      // Reader Phase 2: the validated gold frame and the ReaderInput it was written against (wire round trip).
      target: { frame: record.receipt.frame, input: record.input },
      reader: { id: record.legacy_v0.reader.id, fields: readerCompare, routing_match: ROUTING_FIELDS.filter((f) => f in readerCompare).every((f) => readerCompare[f]) },
      resolver,
      shadow,
      behaviour: { got: gotBehaviour, fields: behaviour, correct: Object.values(behaviour).every(Boolean) }
    };
  } finally { s.close(); }
}

function summarize(results) {
  const scored = results.filter((r) => r.status === "scored");
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const field = {};
  for (const r of scored) for (const [k, v] of Object.entries(r.reader.fields)) { field[k] ??= { n: 0, correct: 0 }; field[k].n += 1; if (v) field[k].correct += 1; }
  for (const v of Object.values(field)) v.pct = pct(v.correct, v.n);
  const resolved = scored.filter((r) => r.resolver?.status === "evaluated");
  const withBehaviour = scored.filter((r) => Object.keys(r.behaviour.fields).length);
  return {
    version: GOLD_EVAL_VERSION,
    items: results.length,
    scored: scored.length,
    prefix_invalid: results.filter((r) => r.status === "prefix_invalid").map((r) => r.id),
    incomplete_state_verification: results.filter((r) => r.status === "incomplete_state_verification").map((r) => ({ id: r.id, missing: r.missing })),
    gold_frames_rejected_by_validators: scored.filter((r) => r.gold_frame_verdict && !r.gold_frame_verdict.ok).map((r) => ({ id: r.id, verdict: r.gold_frame_verdict.disposition, errors: (r.gold_frame_verdict.errors ?? []).map((e) => e.code) })),
    reader: { id: scored[0]?.reader.id ?? null, fields: field },
    shadow_spec: (() => { const ev = scored.filter((r) => r.shadow); return { n: ev.length, correct: ev.filter((r) => r.shadow.correct).length, pct: pct(ev.filter((r) => r.shadow.correct).length, ev.length), failures: ev.filter((r) => !r.shadow.correct).map((r) => ({ id: r.id, fields: Object.fromEntries(Object.entries(r.shadow.fields).filter(([, v]) => !v)), got: r.shadow.got })) }; })(),
    resolver_spec: { n: resolved.length, correct: resolved.filter((r) => r.resolver.correct).length, pct: pct(resolved.filter((r) => r.resolver.correct).length, resolved.length), errors: scored.filter((r) => r.resolver?.status === "error").map((r) => ({ id: r.id, detail: r.resolver.detail })), failures: resolved.filter((r) => !r.resolver.correct).map((r) => ({ id: r.id, fields: r.resolver.fields, got: r.resolver.got })) },
    behaviour: { n: withBehaviour.length, correct: withBehaviour.filter((r) => r.behaviour.correct).length, pct: pct(withBehaviour.filter((r) => r.behaviour.correct).length, withBehaviour.length), failures: withBehaviour.filter((r) => !r.behaviour.correct).map((r) => ({ id: r.id, fields: r.behaviour.fields, got: r.behaviour.got })) }
  };
}

async function evaluateGold(items, { log = () => {} } = {}) {
  const results = [];
  for (const item of items) { results.push(await evaluateItem(item)); log(item.id); }
  return { summary: summarize(results), results };
}

/** The ReaderInput a labeler sees for an item's target turn (label space for writing a gold frame). */
async function showInput(item) {
  let captured = null;
  await evaluateItem({ ...item, gold: {} }, { onInput: (input) => { captured = input; } });
  return captured;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node tools/dialogue-gold-eval.js <items.jsonl> [--json] [--show-input <id>]"); process.exit(2); }
  const items = readJsonl(file);
  const show = process.argv.indexOf("--show-input");
  if (show >= 0) { const item = items.find((x) => x.id === process.argv[show + 1]); console.log(JSON.stringify(await showInput(item), null, 2)); return; }
  const { summary, results } = await evaluateGold(items, { log: (l) => process.stderr.write(`${l}\n`) });
  console.log(JSON.stringify(process.argv.includes("--json") ? { summary, results } : summary, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { referentLabelFor, shadowView, compareShadow, GOLD_EVAL_VERSION, evaluateGold, evaluateItem, resolveGoldFrame, completeFrame, compareFrames, requiredVerification, checkpointProblem, summarize, readJsonl, showInput };
