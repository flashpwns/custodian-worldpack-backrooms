#!/usr/bin/env node
"use strict";

// Reader Phase 1 -- the SHADOW COMPARATOR (developer tooling only).
//
// Plays every characterized fixture through the REAL production service with the Phase-1 shadow enabled, and for
// every player turn compares what PRODUCTION did (the authority) with what the SHADOW pipeline would have done:
//
//   legacy reader v0 frame --V0-V3--> disposition --resolveTurn (shadow)--> response policy --> frame assembly
//
// at four levels, each mismatch carrying reason codes (never one catch-all bucket):
//   A. ACT        speech act, facet, subject (third-party), relation (kind / target / reissue / reopen), temporal,
//                 repair kind
//   B. ROUTING    addressees, responders (the primary act's owners), recipients, listeners, cardinality, silence
//   C. LIFECYCLE  request intent (open / reopen / supersede / none) with target, predicate and targets; abandoned
//                 requests; activity start / continue / supersede / close; inbound-answer handling
//   D. FRAME      the planner-facing frame: discourse function, predicate, requested content, response shape,
//                 clarification slot, unresolved reference, knowledge query, referents, turn fields and routing
//                 args. request_text is EXCLUDED from equality and tracked separately.
// The shadow's DISPOSITION (ACCEPT / CLARIFY / REJECT_FIELDS / INVALID) is recorded per turn and every mismatch
// is read against it.
//
//   node tools/dialogue-shadow-compare.js [--out <file.json>] [--quick]

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./dialogue-registry");
const { collectFixtures, playFixture, normalizer } = require("./dialogue-characterize");
const { turnCauses, reasonsFor, CAUSES } = require("./dialogue-shadow-causes");

const COMPARATOR_VERSION = "yellow-beast-reader-shadow-compare@v1";
const ACTIVITY_OF = Object.freeze({ "person.self_description": "SELF_INTRODUCTION_ROUND", "person.wellbeing": "GROUP_CHECK_IN", "person.nervousness": "GROUP_CHECK_IN", "person.anticipation": "GROUP_CHECK_IN", "person.fatigue": "GROUP_CHECK_IN", "person.role": "ROLE_ROUND", "person.current_assignment": "ROLE_ROUND", "person.first_day_at_async": "EXPERIENCE_ROUND", "person.async_tenure": "EXPERIENCE_ROUND", "person.expedition_experience": "EXPERIENCE_ROUND", "person.complex_experience": "EXPERIENCE_ROUND" });
// Routing arguments compared one by one (item / place bindings are compared as "entity.bound").
const FRAME_ARGS = ["third_party_subject", "other_id", "answer_option", "reply_kind", "question_inverted", "question_negated"];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sorted = (ids) => [...(ids ?? [])].sort();

// ─── production side (the authority) ────────────────────────────────────────────────────────────────────
function productionLifecycle(record, before, after) {
  const legacy = record.legacy;
  const primary = legacy?.primary_used ?? null;
  const beforeById = new Map((before?.requests ?? []).map((r) => [r.request_id, r]));
  const opened = (after.requests ?? []).filter((r) => !beforeById.has(r.request_id));
  const reopened = (after.requests ?? []).filter((r) => beforeById.has(r.request_id) && (r.reissued_by ?? []).length > (beforeById.get(r.request_id).reissued_by ?? []).length);
  const primaryOpened = opened.find((r) => r.act_index === legacy?.primary_index) ?? opened[0] ?? null;
  const request = reopened.length ? { intent: "reopen", target: reopened[0].request_id, predicate: reopened[0].predicate ?? null, targets: sorted(reopened[0].targets) }
    : primaryOpened ? { intent: primaryOpened.reissue_of ? "supersede_and_open" : "open", target: primaryOpened.reissue_of ?? null, predicate: primaryOpened.predicate ?? null, targets: sorted(primaryOpened.targets) }
      : { intent: "none", target: null, predicate: null, targets: [] };
  const abandons = (after.requests ?? []).filter((r) => r.state === "ABANDONED" && beforeById.has(r.request_id) && beforeById.get(r.request_id).state !== "ABANDONED").map((r) => r.request_id).sort();
  const activeBefore = [...(before?.activities ?? [])].reverse().find((a) => a.state === "active") ?? null;
  const newActivity = (after.activities ?? []).find((a) => !(before?.activities ?? []).some((b) => b.activity_id === a.activity_id)) ?? null;
  // closeActivity is a canonical no-op when nothing is active (dialogue-state.closeActivity): only a real closure
  // counts as production's "close" (Reader Phase 2).
  const activity = legacy?.closes_activity && activeBefore ? { intent: "close", kind: activeBefore.kind }
    : newActivity ? { intent: activeBefore && activeBefore.kind !== newActivity.kind ? "supersede" : "start", kind: newActivity.kind }
      : activeBefore && (after.activities ?? []).some((a) => a.activity_id === activeBefore.activity_id) && ACTIVITY_OF[request.predicate] === activeBefore.kind && request.intent !== "none" ? { intent: "continue", kind: activeBefore.kind }
        : { intent: "none", kind: null };
  const inbound = primary?.speech_act === "answer" ? { intent: primary.args?.reply_kind === "answer_repair" ? "answer_repair" : primary.args?.reply_kind ?? "answer", asker: primary.addressee?.ids?.[0] ?? null }
    : primary?.args?.reply_kind === "counter_question" && primary.relation === "continuation" ? { intent: "counter_question", asker: primary.addressee?.ids?.[0] ?? null } : { intent: "none", asker: null };
  return { request, abandons, activity, inbound };
}
function frameFields(frame) {
  if (!frame) return null;
  const t = frame.turn ?? {};
  const clarify = frame.discourse_function === "ambiguous_reference";
  return {
    discourse_function: frame.discourse_function ?? null,
    predicate: frame.predicate ?? null,
    requested_content: frame.requested_content ?? null,
    expected_response_shape: frame.expected_response_shape ?? null,
    expected_slot: clarify ? frame.expected_slot ?? null : null,
    unresolved_reference: Boolean(frame.unresolved_reference),
    knowledge_query: frame.knowledge_query ? { concept: frame.knowledge_query.concept ?? null, entity: frame.knowledge_query.entity?.id ?? null } : null,
    referents: (frame.referents ?? []).filter((r) => r.type === "equipment" && r.resolved).map((r) => `${r.id}@${r.holder ?? "-"}`).sort(),
    // WHICH thing the act is about, wherever the frame carries it (the act's argument, else the knowledge query's
    // entity): legacy keeps a named entity in knowledge_query, the shadow binds it into the argument slot.
    "entity.bound": t.args?.item_id ?? t.args?.place_id ?? frame.knowledge_query?.entity?.id ?? (frame.predicate && registry.get(frame.predicate)?.slots?.item ? (frame.referents ?? []).find((r) => r.type === "equipment" && r.resolved)?.id ?? null : null),
    "turn.speech_act": t.speech_act ?? null,
    "turn.relation": t.relation ?? null,
    "turn.relation_target": t.relation_target ?? null,
    "turn.reissue_of": t.reissue_of ?? null,
    "turn.cardinality": t.cardinality ?? null,
    "turn.temporal_scope": t.temporal_scope ?? null,
    "turn.addressee_ids": sorted(t.addressee_ids),
    ...Object.fromEntries(FRAME_ARGS.map((k) => [`args.${k}`, t.args?.[k] ?? null]))
  };
}

// ─── one turn ────────────────────────────────────────────────────────────────────────────────────────
function compareTurn(record, { after, norm = (x) => x } = {}) {
  if (!record?.shadow || !record.legacy || !record.production_routing) return { status: "no_shadow_record" };
  const sh = record.shadow;
  const res = sh.resolution;
  const prod = record.legacy.primary_used;
  const pr = record.production_routing;
  const ctx = record.context;
  const finalized = ctx.finalized_frame;
  const sp = res.primary ?? null;
  const shadowFrame = sh.frame ?? null;
  const out = { status: "ok", disposition: sh.disposition, outcome: res.outcome, levels: {}, request_text: null, conflicts: [...(res.conflicts ?? [])] };
  const level = (name, pairs) => {
    const diffs = pairs.filter(([, a, b]) => !same(a, b)).map(([field, a, b]) => ({ field, production: norm(a ?? null), shadow: norm(b ?? null) }));
    out.levels[name] = { equal: diffs.length === 0, diffs };
  };
  // A. ACT
  const prodThird = finalized?.turn?.args?.third_party_subject ?? null;
  level("act", [
    ["speech_act", prod?.speech_act, sp?.speech_act],
    // The facet production acted on: the finalized frame's (reconciled) predicate, else the act's.
    ["facet", finalized ? finalized.predicate ?? null : prod?.predicate, sp?.predicate],
    ["subject.third_party", prodThird, shadowFrame?.turn?.args?.third_party_subject ?? null],
    ["relation.kind", prod?.relation, sp?.relation],
    ["relation.target", prod?.relation_target, sp?.relation_target],
    ["relation.reissue_of", prod?.reissue_of, sp?.reissue_of],
    ["relation.reopen", Boolean(prod?.reopen), Boolean(sp?.reopen)],
    ["temporal", finalized?.turn?.temporal_scope ?? null, shadowFrame?.turn?.temporal_scope ?? null],
    ["repair.kind", prod?.repair?.kind ?? null, sp?.repair?.kind ?? null]
  ]);
  // B. ROUTING
  const prodResponders = pr.owner_ids ?? [];
  level("routing", [
    ["addressees", sorted(prod?.addressee?.ids), sorted(sp?.addressee?.ids)],
    ["responders", sorted(prodResponders), sorted(res.routing?.responders)],
    ["recipients", sorted(pr.recipient_ids), sorted(res.routing?.recipients)],
    ["listeners", sorted(pr.listener_ids), sorted(res.routing?.listeners)],
    ["cardinality", finalized?.turn?.cardinality ?? null, res.routing?.cardinality ?? null],
    ["silence", prodResponders.length === 0, Boolean(res.routing?.silence)]
  ]);
  out.multi_act_responders = !same(sorted(pr.responder_ids), sorted(pr.owner_ids)) ? norm(sorted(pr.responder_ids)) : null;
  // C. LIFECYCLE
  const pl = productionLifecycle(record, ctx.ledger, after);
  const sl = res.lifecycle ?? { request: { intent: "none" }, abandons: [], activity: { intent: "none" }, inbound: { intent: "none" } };
  const shadowIntent = sl.request?.intent === "open_clarifying" ? "open" : sl.request?.intent ?? "none";
  level("lifecycle", [
    ["request.intent", pl.request.intent, shadowIntent],
    ["request.target", pl.request.target, sl.request?.target ?? null],
    ["request.predicate", pl.request.predicate, sl.request?.predicate ?? null],
    ["request.targets", pl.request.targets, sorted(sl.request?.targets)],
    ["abandons", pl.abandons, sorted(sl.abandons)],
    ["activity", pl.activity.intent === "none" ? null : `${pl.activity.intent}:${pl.activity.kind}`, sl.activity?.intent === "none" ? null : `${sl.activity?.intent}:${sl.activity?.kind}`],
    ["inbound", pl.inbound.intent === "none" ? null : `${pl.inbound.intent}:${pl.inbound.asker}`, sl.inbound?.intent === "none" ? null : `${sl.inbound?.intent}:${sl.inbound?.asker}`]
  ]);
  // D. ASSEMBLED FRAME (request_text excluded; tracked below)
  const pf = frameFields(finalized);
  const sf = frameFields(shadowFrame);
  level("frame", Object.keys(pf ?? sf ?? {}).map((k) => [k, pf?.[k] ?? null, sf?.[k] ?? null]));
  out.request_text = { production: finalized?.turn?.request_text ?? prod?.request_text ?? null, shadow: sp?.request_text ?? null };
  out.request_text.equal = same(out.request_text.production, out.request_text.shadow);
  // Reasons for every mismatch.
  const causes = turnCauses(record, out, pl);
  for (const [name, lv] of Object.entries(out.levels)) for (const d of lv.diffs) d.reasons = reasonsFor(name, d, causes);
  out.causes = causes.filter((code) => Object.values(out.levels).some((lv) => lv.diffs.some((d) => d.reasons.includes(code))));
  out.equal = Object.values(out.levels).every((l) => l.equal);
  return out;
}

async function run({ quick = false, log = () => {}, fixtures = null } = {}) {
  const rows = [];
  for (const spec of fixtures ?? collectFixtures({ quick })) {
    const kind = spec.providers?.[0] ?? "fallback";
    await playFixture(spec, kind, async (s, requestId, step) => {
      const record = s.service.readerReceipts.get(requestId);
      const norm = normalizer(s);
      const cmp = compareTurn(record, { after: s.run.expedition.dialogue_state ?? { requests: [] }, norm });
      rows.push({ fixture: spec.id, kind: spec.kind, text: step.text, target: step.target ?? null, ...stable(cmp) });
    }, { serviceOptions: { readerShadow: true } });
    log(spec.id);
  }
  return rows;
}
/** Event ids embed a wall-clock timestamp (dlg-<ms>-<hex>); request ids and people are normalized by the caller. */
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stable(x)])) : typeof v === "string" && /^dlg-\d{10,}-[0-9a-f]+$/.test(v) ? "dlg-<event>" : v);

function summarize(rows) {
  const ok = rows.filter((r) => r.status === "ok");
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const count = (pred) => ok.filter(pred).length;
  const levels = ["act", "routing", "lifecycle", "frame"];
  const byLevel = Object.fromEntries(levels.map((l) => [l, { equal: count((r) => r.levels[l].equal), pct: pct(count((r) => r.levels[l].equal), ok.length) }]));
  const byDisposition = {};
  for (const r of ok) byDisposition[r.disposition] = (byDisposition[r.disposition] ?? 0) + 1;
  const fields = {};
  const reasons = {};
  const causeClass = {};
  for (const r of ok) for (const l of levels) for (const d of r.levels[l].diffs) {
    const key = `${l}.${d.field}`;
    fields[key] = (fields[key] ?? 0) + 1;
    for (const reason of d.reasons) { reasons[reason] = (reasons[reason] ?? 0) + 1; const cls = CAUSES[reason]?.class ?? "UNCLASSIFIED"; causeClass[cls] = (causeClass[cls] ?? 0) + 1; }
  }
  // Turn-level classification: a turn is fully classified when every mismatch carries a known cause.
  const turnClasses = {};
  const unclassified = [];
  for (const r of ok) {
    const diffs = levels.flatMap((l) => r.levels[l].diffs);
    const classes = [...new Set(diffs.flatMap((d) => d.reasons.map((x) => CAUSES[x]?.class ?? "UNCLASSIFIED")))].sort();
    const key = diffs.length ? classes.join("+") : "equivalent";
    turnClasses[key] = (turnClasses[key] ?? 0) + 1;
    if (classes.includes("UNCLASSIFIED")) unclassified.push({ fixture: r.fixture, text: r.text, diffs: diffs.filter((d) => d.reasons.some((x) => !CAUSES[x])).map((d) => ({ field: d.field, production: d.production, shadow: d.shadow, reasons: d.reasons })) });
  }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
  return {
    version: COMPARATOR_VERSION,
    turns: rows.length,
    evaluated: ok.length,
    not_evaluated: rows.filter((r) => r.status !== "ok").map((r) => ({ fixture: r.fixture, text: r.text, status: r.status })),
    dispositions: byDisposition,
    levels: byLevel,
    all_levels_equal: { n: count((r) => r.equal), pct: pct(count((r) => r.equal), ok.length) },
    act_and_routing_equal: { n: count((r) => r.levels.act.equal && r.levels.routing.equal), pct: pct(count((r) => r.levels.act.equal && r.levels.routing.equal), ok.length) },
    request_text: { equal: count((r) => r.request_text?.equal), differs: count((r) => !r.request_text?.equal), only_difference: count((r) => r.equal && !r.request_text?.equal) },
    conflicts: ok.filter((r) => r.conflicts.length).map((r) => ({ fixture: r.fixture, text: r.text, conflicts: r.conflicts })),
    multi_act_turns: count((r) => r.multi_act_responders),
    mismatch_fields: sortObj(fields),
    mismatch_reasons: sortObj(reasons),
    mismatch_cause_classes: sortObj(causeClass),
    turn_classes: sortObj(turnClasses),
    unclassified_turns: unclassified.length,
    unclassified
  };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const rows = await run({ quick: process.argv.includes("--quick"), log: (l) => process.stderr.write(`${l}\n`) });
  const summary = summarize(rows);
  const out = arg("--out");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, serialize({ ...summary, rows })); }
  const { unclassified, conflicts, ...head } = summary;
  console.log(JSON.stringify({ ...head, conflicts: conflicts.length }, null, 1));
}
/** One row per line (reviewable diffs), header first. */
function serialize(doc) {
  const { rows, ...head } = doc;
  return `{${Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",\n")},\n"rows":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { COMPARATOR_VERSION, compareTurn, productionLifecycle, frameFields, run, summarize, serialize };
