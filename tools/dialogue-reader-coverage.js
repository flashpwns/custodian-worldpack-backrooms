#!/usr/bin/env node
"use strict";

// Reader Phase 0 -- LEGACY ADAPTER COVERAGE (developer tooling only).
//
// Plays the existing deterministic fixtures (J15 scripts, checked-in transcripts, the dev corpora as
// context-free probes) through the REAL production service and reads the reader seam's receipts (legacy reader
// v0 = frameFromLegacy over what production decided). Reports how much of current behaviour ReaderFrame v1 can
// express exactly, and classifies every mismatch (reader-schema gap / resolver-policy concern / legacy-only
// artifact / needs-owner-decision), plus the raw-text dependencies the legacy decisions relied on.
//
//   node tools/dialogue-reader-coverage.js [--out <file.json>] [--quick]

const fs = require("node:fs");
const path = require("node:path");
const { collectFixtures, playFixture } = require("./dialogue-characterize");
const { CLASSES } = require("./dialogue-reader-legacy");

const COVERAGE_VERSION = "yellow-beast-reader-legacy-coverage@v1";
const EXAMPLES = 3;

async function collect({ quick = false, log = () => {} } = {}) {
  const rows = [];
  for (const spec of collectFixtures({ quick })) {
    const kind = spec.providers?.[0] ?? "fallback";
    await playFixture(spec, kind, async (s, requestId, step) => {
      rows.push({ fixture: spec.id, kind: spec.kind, text: step.text, record: s.service.readerReceipts.get(requestId) });
    });
    log(spec.id);
  }
  return rows;
}

function summarize(rows) {
  const turns = rows.length;
  const seamed = rows.filter((r) => r.record?.legacy_v0);
  const receipts = seamed.map((r) => r.record.legacy_v0);
  const withFrame = receipts.filter((x) => x.frame);
  const exact = withFrame.filter((x) => x.conversion?.exact);
  const acts = withFrame.reduce((n, x) => n + x.frame.acts.length, 0);
  const disposition = {};
  for (const x of withFrame) disposition[x.verdict?.disposition ?? "none"] = (disposition[x.verdict?.disposition ?? "none"] ?? 0) + 1;
  const validation = {};
  // Validator findings on legacy frames, split by whether the legacy pipeline itself also declined (abstained /
  // clarified) on that act: agreement means V0-V3 would have asked where legacy asked.
  const validationVsLegacy = {};
  for (const x of withFrame) for (const e of x.verdict?.errors ?? []) {
    const key = `${e.layer}:${e.code}`;
    validation[key] = (validation[key] ?? 0) + 1;
    const legacyDeclined = (x.frame.acts[e.act ?? 0]?.abstain ?? []).length > 0;
    validationVsLegacy[key] ??= { legacy_also_declined: 0, legacy_proceeded: 0, examples_legacy_proceeded: [] };
    if (legacyDeclined) validationVsLegacy[key].legacy_also_declined += 1;
    else { validationVsLegacy[key].legacy_proceeded += 1; }
  }
  rows.forEach((row) => { const x = row.record?.legacy_v0; for (const e of x?.verdict?.errors ?? []) { const v = validationVsLegacy[`${e.layer}:${e.code}`]; if (v && !(x.frame.acts[e.act ?? 0]?.abstain ?? []).length && v.examples_legacy_proceeded.length < EXAMPLES && !v.examples_legacy_proceeded.includes(row.text)) v.examples_legacy_proceeded.push(row.text); } });
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, { turns: 0, notes: 0, codes: {} }]));
  const deps = {};
  const multiClass = [];
  const derived = {};
  rows.forEach((row) => {
    const x = row.record?.legacy_v0;
    if (!x?.conversion) return;
    const classesHere = new Set();
    for (const n of x.conversion.notes) {
      const bucket = byClass[n.class] ?? (byClass[n.class] = { turns: 0, notes: 0, codes: {} });
      bucket.notes += 1;
      classesHere.add(n.class);
      const code = (bucket.codes[n.code] ??= { count: 0, examples: [] });
      code.count += 1;
      if (code.examples.length < EXAMPLES && !code.examples.includes(row.text)) code.examples.push(row.text);
    }
    for (const c of classesHere) byClass[c].turns += 1;
    if (classesHere.size > 1) multiClass.push({ fixture: row.fixture, text: row.text, classes: [...classesHere].sort(), codes: x.conversion.notes.map((n) => `${n.class}:${n.code}`) });
    for (const d of x.conversion.raw_text_dependencies ?? []) { const k = d.where; deps[k] ??= { count: 0, what: d.what, examples: [] }; deps[k].count += 1; if (deps[k].examples.length < EXAMPLES && !deps[k].examples.includes(row.text)) deps[k].examples.push(row.text); }
    for (const d of x.conversion.resolver_derived_addressees ?? []) derived[d.source] = (derived[d.source] ?? 0) + 1;
  });
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  const byKind = {};
  for (const row of rows) {
    const k = row.kind;
    byKind[k] ??= { turns: 0, exact: 0 };
    byKind[k].turns += 1;
    if (row.record?.legacy_v0?.conversion?.exact) byKind[k].exact += 1;
  }
  for (const v of Object.values(byKind)) v.exact_pct = pct(v.exact, v.turns);
  return {
    version: COVERAGE_VERSION,
    turns,
    seam_recorded: seamed.length,
    frames: withFrame.length,
    acts,
    exact_turns: exact.length,
    exact_pct: pct(exact.length, withFrame.length),
    by_fixture_kind: byKind,
    validation_disposition_of_legacy_frames: disposition,
    validation_errors_on_legacy_frames: Object.fromEntries(Object.entries(validation).sort((a, b) => b[1] - a[1])),
    validation_vs_legacy_decision: validationVsLegacy,
    mismatch_classes: byClass,
    // A non-exact turn may carry notes of more than one class: the class turn counts then sum to more than the
    // number of non-exact turns. Every such turn is listed (never hidden).
    non_exact_turns: withFrame.length - exact.length,
    class_turn_sum: Object.values(byClass).reduce((n, v) => n + v.turns, 0),
    multi_class_turns: multiClass,
    raw_text_dependencies: Object.fromEntries(Object.entries(deps).sort((a, b) => b[1].count - a[1].count)),
    resolver_derived_addressees: derived,
    resolution_passthrough_identity: seamed.every((r) => r.record.resolution?.same_analysis === true)
  };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const rows = await collect({ quick: process.argv.includes("--quick"), log: (l) => process.stderr.write(`${l}\n`) });
  const summary = summarize(rows);
  const out = arg("--out");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(summary, null, 1)}\n`); }
  console.log(JSON.stringify({ turns: summary.turns, frames: summary.frames, exact_pct: summary.exact_pct, by_fixture_kind: summary.by_fixture_kind, disposition: summary.validation_disposition_of_legacy_frames, classes: Object.fromEntries(Object.entries(summary.mismatch_classes).map(([k, v]) => [k, { turns: v.turns, notes: v.notes }])) }, null, 1));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { COVERAGE_VERSION, collect, summarize };
