#!/usr/bin/env node
"use strict";

// Reader Phase 0.5 -- the ROUND-TRIP harness (developer tooling only).
//
//   legacy analysis --frameFromLegacy--> ReaderFrame --resolveTurn (frame-driven)--> effective act
//                   --finalizeFrame (the real pre-finalize semantic frame)--> planner frame
//
// compared against what production actually decided for the same turn (the seam's legacy record and the
// finalized frame). "Exact expressibility" (Phase 0's 92.6%) only says the legacy decision can be WRITTEN as a
// ReaderFrame; this measures whether it can be READ BACK into the same behaviour -- the Phase-1 migration
// question. Every difference is classified:
//   schema-loss            information the ReaderFrame cannot carry (fragment subtype, time_asked, place basis,
//                          echo span, overrides, the request's own words ...)
//   resolver-policy        the frame-driven resolver's policy differs from legacy (addressee, cardinality,
//                          temporal default, relation target, facet inheritance ...)
//   legacy-quirk           the legacy decision is a legacy-only artifact (adapter note)
//   owner-decision         the convention is contested (adapter note: needs-owner-decision)
//   validator-only         the frame fails V0-V3 but the round trip preserves behaviour
//   frame-assembly-text    finalizeFrame itself reads raw request text (subjects, legacy route) and the resolved
//                          act carries no words
//   legacy-overlay         the service's address-correction overlay (a separate raw-text reader) decided the turn
//
//   node tools/dialogue-reader-roundtrip.js [--out <file.json>] [--quick]

const fs = require("node:fs");
const path = require("node:path");
const dialogueTurn = require("./dialogue-turn");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { legacyActRecord } = require("./dialogue-reader");
const { collectFixtures, playFixture } = require("./dialogue-characterize");

const ROUNDTRIP_VERSION = "yellow-beast-reader-roundtrip@v1";
const SCHEMA_LOSS_ARGS = new Set(["followup", "time_asked", "place_basis", "count_asked", "asks_split", "asked_among", "mutual", "other_non_present", "echo", "item_anaphoric", "alternatives", "subject_ids"]);
const ROUTING_ARGS = ["item_id", "place_id", "third_party_subject", "other_id", "answer_option", "reply_kind"];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sortIds = (ids) => [...(ids ?? [])].sort();

/** Field-level differences between two value-level effective acts. */
function diffActs(legacy, resolved) {
  const diffs = [];
  const check = (field, a, b) => { if (!same(a, b)) diffs.push({ field, legacy: a ?? null, resolved: b ?? null }); };
  for (const f of ["speech_act", "question_form", "relation", "relation_target", "reissue_of", "reopen", "predicate", "cardinality", "temporal_scope", "polarity"]) check(f, legacy?.[f], resolved?.[f]);
  check("addressee.ids", sortIds(legacy?.addressee?.ids), sortIds(resolved?.addressee?.ids));
  check("addressee.kind", legacy?.addressee?.kind, resolved?.addressee?.kind);
  check("addressee.source", legacy?.addressee?.source, resolved?.addressee?.source);
  check("addressee.quantifier", legacy?.addressee?.quantifier, resolved?.addressee?.quantifier);
  check("repair.kind", legacy?.repair?.kind, resolved?.repair?.kind);
  check("clarify.slot", legacy?.clarify?.slot ?? null, resolved?.clarify?.slot ?? null);
  const keys = new Set([...Object.keys(legacy?.args ?? {}), ...Object.keys(resolved?.args ?? {})]);
  for (const k of keys) check(`args.${k}`, legacy?.args?.[k], resolved?.args?.[k]);
  if ((legacy?.overrides ?? []).length) diffs.push({ field: "overrides", legacy: legacy.overrides.map((o) => o.reason ?? o.field), resolved: [] });
  check("request_text", legacy?.request_text, resolved?.request_text);
  return diffs;
}

/** The behaviour a turn's planner frame determines (what the player experiences). */
function behaviourOf(frame, primary) {
  const t = frame?.turn ?? {};
  return {
    discourse_function: frame?.discourse_function ?? null,
    predicate: frame?.predicate ?? null,
    speech_act: t.speech_act ?? primary?.speech_act ?? null,
    addressee: sortIds(primary?.addressee?.ids),
    cardinality: t.cardinality ?? null,
    temporal: t.temporal_scope ?? null,
    clarify: frame?.discourse_function === "ambiguous_reference" || Boolean(frame?.unresolved_reference),
    relation_target: t.relation_target ?? null,
    reissue_of: t.reissue_of ?? null,
    routing_args: Object.fromEntries(ROUTING_ARGS.map((k) => [k, t.args?.[k] ?? null]).filter(([, v]) => v != null))
  };
}

function classifyField(d, notes) {
  if (d.field === "overrides" || d.field === "request_text") return "schema-loss";
  if (d.field.startsWith("args.")) return SCHEMA_LOSS_ARGS.has(d.field.slice(5)) ? "schema-loss" : "resolver-policy";
  if (d.field.startsWith("addressee") && notes.some((n) => n.class === "needs-owner-decision")) return "owner-decision";
  if (d.field === "predicate" && notes.some((n) => n.code === "legacy_route_without_registry_facet")) return "schema-loss";
  return "resolver-policy";
}

/** Event ids embed a wall-clock timestamp (dlg-<ms>-<hex>): normalized so the report is deterministic. */
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stable(x)])) : typeof v === "string" && /^dlg-\d{10,}-[0-9a-f]+$/.test(v) ? "dlg-<event>" : v);

/** One turn through the round trip. */
function roundTrip(record) { return stable(roundTripRaw(record)); }
function roundTripRaw(record) {
  const receipt = record?.legacy_v0;
  const ctx = record?.context;
  if (!receipt?.frame || !ctx || !record.legacy) return { status: "no_seam_record" };
  const notes = receipt.conversion?.notes ?? [];
  let resolved;
  try { resolved = resolveTurn(receipt.frame, { snapshot: ctx.snapshot, ledger: ctx.ledger ?? { requests: [] } }, ctx.present, { input: record.input, bindings: ctx.bindings }); }
  catch (error) { return { status: "resolver_error", error: error.message }; }
  const legacyPrimary = record.legacy.primary_used;
  const resolvedPrimary = legacyActRecord(resolved.primary);
  const effectiveDiffs = diffActs(legacyPrimary, resolvedPrimary);
  // Frame assembly: the SAME pre-finalize frame, finalized with the resolved act.
  let rtFrame = null;
  let assemblyError = null;
  try {
    const completeness = dialogueTurn.completenessWithFrame({ completeness: { missing: [...(record.legacy.completeness?.missing ?? [])] } }, ctx.raw_frame, resolved.primary);
    rtFrame = ctx.raw_frame ? dialogueTurn.finalizeFrame(ctx.raw_frame, resolved.primary, dialogueTurn.reconcile(ctx.raw_frame, resolved.primary), { completeness, entities: ctx.entities ?? [] }) : null;
  } catch (error) { assemblyError = error.message; }
  const legacyBehaviour = behaviourOf(ctx.finalized_frame, ctx.primary ? { addressee: ctx.primary.addressee } : { addressee: legacyPrimary?.addressee });
  const rtBehaviour = behaviourOf(rtFrame, resolved.primary);
  const behaviourDiffs = Object.keys(legacyBehaviour).filter((k) => !same(legacyBehaviour[k], rtBehaviour[k])).map((k) => ({ field: k, legacy: legacyBehaviour[k], resolved: rtBehaviour[k] }));
  const classes = new Set(effectiveDiffs.map((d) => classifyField(d, notes)));
  for (const n of notes) { if (n.class === "legacy-only artifact") classes.add("legacy-quirk"); if (n.class === "needs-owner-decision") classes.add("owner-decision"); if (n.class === "reader-schema gap") classes.add("schema-loss"); }
  // finalizeFrame reads the clause itself (its words, force, mentions) for subjects, legacy routes and the
  // clarify-over-guess rules: when the resolved ACT matches but the planner frame does not, only those reads
  // can explain it.
  const meaningful = effectiveDiffs.filter((d) => classifyField(d, notes) !== "schema-loss");
  if (behaviourDiffs.length && (!meaningful.length || (behaviourDiffs.some((d) => ["discourse_function", "routing_args"].includes(d.field)) && (legacyPrimary?.request_text ?? "") && !resolved.primary?.request_text))) classes.add("frame-assembly-text");
  // The service's address-correction overlay (resolveAddressCorrection: a separate raw-text reader) replaced the
  // analysis primary; it records no request antecedent a frame could name.
  if (legacyPrimary?.addressee?.source === "legacy_correction" && behaviourDiffs.length) classes.add("legacy-overlay");
  const validatorOnly = receipt.verdict && !receipt.verdict.ok && !behaviourDiffs.length;
  if (validatorOnly) classes.add("validator-only");
  return {
    status: "ok",
    exact: effectiveDiffs.length === 0,
    behaviour_equivalent: behaviourDiffs.length === 0 && !assemblyError,
    classes: [...classes].sort(),
    effective_diffs: effectiveDiffs,
    behaviour_diffs: behaviourDiffs,
    verdict: receipt.verdict ? { ok: receipt.verdict.ok, disposition: receipt.verdict.disposition, errors: (receipt.verdict.errors ?? []).map((e) => `${e.layer}:${e.code}`) } : null,
    adapter_notes: notes.map((n) => `${n.class}:${n.code}`),
    assembly_error: assemblyError
  };
}

async function run({ quick = false, log = () => {} } = {}) {
  const rows = [];
  for (const spec of collectFixtures({ quick })) {
    const kind = spec.providers?.[0] ?? "fallback";
    await playFixture(spec, kind, async (s, requestId, step) => {
      const record = s.service.readerReceipts.get(requestId);
      rows.push({ fixture: spec.id, kind: spec.kind, text: step.text, ...roundTrip(record) });
    });
    log(spec.id);
  }
  return rows;
}

function summarize(rows) {
  const ok = rows.filter((r) => r.status === "ok");
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const byClass = {};
  const byField = {};
  for (const r of ok) {
    for (const c of r.classes) byClass[c] = (byClass[c] ?? 0) + 1;
    for (const d of r.effective_diffs) byField[d.field] = (byField[d.field] ?? 0) + 1;
  }
  const behaviourByField = {};
  for (const r of ok) for (const d of r.behaviour_diffs) behaviourByField[d.field] = (behaviourByField[d.field] ?? 0) + 1;
  const unresolved = ok.filter((r) => !r.behaviour_equivalent).map((r) => ({ fixture: r.fixture, text: r.text, classes: r.classes, behaviour_diffs: r.behaviour_diffs, effective_diffs: r.effective_diffs.filter((d) => !d.field.startsWith("args.") || !SCHEMA_LOSS_ARGS.has(d.field.slice(5))) }));
  return {
    version: ROUNDTRIP_VERSION,
    turns: rows.length,
    evaluated: ok.length,
    not_evaluated: rows.filter((r) => r.status !== "ok").map((r) => ({ fixture: r.fixture, text: r.text, status: r.status, error: r.error ?? null })),
    exact: ok.filter((r) => r.exact).length,
    exact_pct: pct(ok.filter((r) => r.exact).length, ok.length),
    behaviour_equivalent: ok.filter((r) => r.behaviour_equivalent).length,
    behaviour_equivalent_pct: pct(ok.filter((r) => r.behaviour_equivalent).length, ok.length),
    classes_turns: byClass,
    effective_diff_fields: Object.fromEntries(Object.entries(byField).sort((a, b) => b[1] - a[1])),
    behaviour_diff_fields: Object.fromEntries(Object.entries(behaviourByField).sort((a, b) => b[1] - a[1])),
    unresolved
  };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const rows = await run({ quick: process.argv.includes("--quick"), log: (l) => process.stderr.write(`${l}\n`) });
  const summary = summarize(rows);
  const out = arg("--out");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify({ ...summary, rows }, null, 1)}\n`); }
  const { unresolved, ...head } = summary;
  console.log(JSON.stringify({ ...head, unresolved_count: unresolved.length }, null, 1));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { ROUNDTRIP_VERSION, SCHEMA_LOSS_ARGS, diffActs, behaviourOf, roundTrip, run, summarize };
