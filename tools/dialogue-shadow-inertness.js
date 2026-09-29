#!/usr/bin/env node
"use strict";

// Reader Phase 1 -- SHADOW INERTNESS (developer tooling only).
//
// Plays every characterized fixture twice through the real production service -- once with the Phase-1 shadow
// OFF, once ON -- under every wording provider the characterization uses for it, and compares the WHOLE canonical
// result at the end of the session and again after a COLD RELOAD (a fresh service resuming the saved session):
//   the run (dialogue ledger, canonical dialogue / interaction history, activities, inbound, anchors, knowledge,
//   personnel continuity, trust / rapport, shared history incl. geography_shared, equipment custody, progression)
//   and the world, plus every byte of the saved files (the save payload).
// Only nondeterministic values are normalized: ISO timestamps, ms epoch numbers, the random suffix of presentation
// event ids, derived SHA-256 digests (their content is compared directly), wall-clock durations (*_ms, *latency)
// and the temp root.
// Any other difference is a Phase-1 blocker.
//
//   node tools/dialogue-shadow-inertness.js [--quick]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { collectFixtures, playFixture } = require("./dialogue-characterize");

const PROVIDERS = ["fallback", "garbage"];

function normalizer(root) {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootRe = new RegExp(escaped, "g");
  const text = (s) => s.replace(rootRe, "<root>").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<iso>").replace(/\b(dlg|pevt)-(\d{1,9})-[0-9a-f]{6,8}\b/g, "$1-$2-<rand>").replace(/dlg-\d{10,}-[0-9a-f]+/g, "dlg-<event>").replace(/\b1[6-9]\d{11}\b/g, "<epoch>").replace(/\b[0-9a-f]{64}\b/g, "<sha256>");
  // Wall-clock durations (advisory latency, elapsed times) are timing, not state.
  const timing = (k) => /(?:_ms|latency)$/.test(k);
  const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "_world").map(([k, x]) => [k, timing(k) && typeof x === "number" ? "<ms>" : deep(x)])) : typeof v === "string" ? text(v) : typeof v === "number" && v > 1.6e12 && v < 2e12 ? "<epoch>" : v);
  return { deep, text };
}
function savedFiles(root) {
  const out = {};
  const walk = (dir) => { for (const f of fs.readdirSync(dir).sort()) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, "utf8"); } };
  walk(root);
  return out;
}
/** The canonical end state of one session (and, after a cold reload, the resumed state). */
function captureState(s) {
  const { deep, text } = normalizer(s.root);
  const session = () => s.service.session(s.worldId, "field-researcher");
  s.service.persistSession(s.service.getWorld(s.worldId), "field-researcher", session());
  // Saved files are compared as parsed JSON when they are JSON (every field, normalized alike), else as text.
  const parsed = (v) => { try { return deep(JSON.parse(v)); } catch { return text(v); } };
  const live = { run: deep(s.run), world: deep(s.service.getWorld(s.worldId)), files: Object.fromEntries(Object.entries(savedFiles(s.root)).map(([k, v]) => [text(k), parsed(v)])) };
  s.reload();
  const reloaded = { run: deep(s.run), world: deep(s.service.getWorld(s.worldId)) };
  return { live, reloaded };
}
const digest = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** The first differing path between two values (for a readable failure). */
function firstDiff(a, b, where = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) { const d = firstDiff(a[k], b[k], `${where}.${k}`); if (d) return d; }
  }
  return { where, off: JSON.stringify(a)?.slice(0, 300), on: JSON.stringify(b)?.slice(0, 300) };
}

async function sessionState(spec, provider, shadow) {
  let state = null;
  await playFixture(spec, provider, async () => {}, { serviceOptions: { readerShadow: shadow }, onEnd: async (s) => { state = captureState(s); } });
  return state;
}

async function run({ quick = false, fixtures = null, log = () => {} } = {}) {
  const results = [];
  for (const spec of fixtures ?? collectFixtures({ quick })) {
    for (const provider of spec.providers ?? PROVIDERS) {
      const off = await sessionState(spec, provider, false);
      const on = await sessionState(spec, provider, true);
      const diff = firstDiff(off, on);
      results.push({ fixture: spec.id, provider, reloads: spec.lines.filter((l) => l.reload).length, equal: !diff, digest: digest(off), ...(diff ? { first_difference: diff } : {}) });
    }
    log(spec.id);
  }
  return results;
}

function summarize(results) {
  return { sessions: results.length, equal: results.filter((r) => r.equal).length, differing: results.filter((r) => !r.equal).map((r) => ({ fixture: r.fixture, provider: r.provider, first_difference: r.first_difference })), with_mid_session_reloads: results.filter((r) => r.reloads > 0).length, providers: [...new Set(results.map((r) => r.provider))].sort() };
}

async function main() {
  const results = await run({ quick: process.argv.includes("--quick"), log: (l) => process.stderr.write(`${l}\n`) });
  console.log(JSON.stringify(summarize(results), null, 1));
  if (results.some((r) => !r.equal)) process.exit(1);
}
if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { run, summarize, sessionState, captureState, firstDiff };
