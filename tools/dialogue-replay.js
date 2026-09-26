#!/usr/bin/env node
"use strict";

// ED-30 I6 transcript replay: plays an exported conversation (JSONL, see tools/dialogue-devtrace.js) through the
// production service and checks every turn against the `expect` written alongside it -- frame fields, never
// wording. A turn whose expect was edited to the intended behaviour fails until the engine does that.
//
//   npm run dialogue:replay -- <transcript.jsonl> [--provider fallback|garbage|throwing|real] [--update] [--json]
//
// expect fields (all optional; only what is present is checked):
//   address {scope, to[]} · speech_act · predicate · fn · cardinality · temporal · clarify · owners[] ·
//   requests[{predicate, state}] · lines[{speaker?, match?, not?}] (regex sources) · forbid[] (regex sources
//   no NPC line may match)
// --update rewrites every turn's expect to what the engine does now (re-baselining; review the diff).

const fs = require("node:fs");
const { openSession } = require("./dialogue-session");
const { TRANSCRIPT_VERSION } = require("./dialogue-devtrace");

const sorted = (list) => [...(list ?? [])].sort();
function compareTurn(expect = {}, observed, lines) {
  const problems = [];
  const check = (field, want, got) => { if (JSON.stringify(want) !== JSON.stringify(got)) problems.push({ field, want, got }); };
  if ("address" in expect) check("address", expect.address ? { scope: expect.address.scope, to: sorted(expect.address.to) } : null, observed.address ? { scope: observed.address.scope, to: sorted(observed.address.to) } : null);
  for (const field of ["speech_act", "predicate", "fn", "cardinality", "temporal", "clarify"]) if (field in expect) check(field, expect[field], observed[field]);
  if ("owners" in expect) check("owners", sorted(expect.owners), sorted(observed.owners));
  if ("requests" in expect) check("requests", expect.requests, observed.requests);
  for (const want of expect.lines ?? []) {
    const pool = want.speaker ? lines.filter((l) => l.speaker === want.speaker) : lines;
    if (want.speaker && !pool.length) { problems.push({ field: "lines", want, got: "speaker did not speak" }); continue; }
    if (want.match && !pool.some((l) => new RegExp(want.match, "i").test(l.text))) problems.push({ field: "lines.match", want, got: pool.map((l) => l.text) });
    if (want.not && pool.some((l) => new RegExp(want.not, "i").test(l.text))) problems.push({ field: "lines.not", want, got: pool.map((l) => l.text) });
  }
  for (const pattern of expect.forbid ?? []) if (lines.some((l) => new RegExp(pattern, "i").test(l.text))) problems.push({ field: "forbid", want: pattern, got: lines.map((l) => `${l.speaker}: ${l.text}`) });
  return problems;
}

/** Replays one transcript; returns { header, turns: [{ n, player, ok, problems, lines, observed }] }. */
async function replayTranscript(records, { provider = "fallback", endpoint = null } = {}) {
  const header = records.find((r) => r.kind === "header");
  if (!header || header.version !== TRANSCRIPT_VERSION) throw new Error(`not a ${TRANSCRIPT_VERSION} transcript`);
  const session = await openSession({ provider, endpoint, seed: header.seed ?? "replay", names: (header.coworkers ?? []).map((c) => c.name), player: header.player ?? undefined, brief: false });
  const out = [];
  try {
    for (const turn of records.filter((r) => r.kind === "turn")) {
      // The opener's beats are reached through the same structured actions the player used.
      if (turn.beat === "LOCAL_INTRODUCTIONS" && session.run.expedition.day1_opener?.beat !== "LOCAL_INTRODUCTIONS") session.brief();
      if (turn.beat && session.run.expedition.day1_opener?.beat !== turn.beat) { out.push({ n: turn.n, player: turn.player, ok: false, skipped: true, problems: [{ field: "beat", want: turn.beat, got: session.run.expedition.day1_opener?.beat ?? null }] }); continue; }
      const result = await session.say(turn.player);
      const problems = compareTurn(turn.expect ?? {}, result.semantic, result.lines);
      out.push({ n: turn.n, player: turn.player, ok: problems.length === 0, problems, lines: result.lines, observed: result.semantic });
    }
  } finally { await session.close(); }
  return { header, turns: out };
}

const readTranscript = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && !["fallback", "garbage", "throwing", "real"].includes(a));
  if (!file) { console.error("usage: npm run dialogue:replay -- <transcript.jsonl> [--provider fallback|garbage|throwing|real] [--update] [--json]"); process.exit(2); }
  const i = process.argv.indexOf("--provider");
  const provider = i >= 0 ? process.argv[i + 1] : "fallback";
  const records = readTranscript(file);
  const result = await replayTranscript(records, { provider });
  if (process.argv.includes("--update")) {
    const byN = new Map(result.turns.map((t) => [t.n, t]));
    const updated = records.map((r) => (r.kind === "turn" && byN.get(r.n)?.observed ? { ...r, expect: { ...byN.get(r.n).observed, ...(r.expect?.lines ? { lines: r.expect.lines } : {}), ...(r.expect?.forbid ? { forbid: r.expect.forbid } : {}) } } : r));
    fs.writeFileSync(file, `${updated.map((r) => JSON.stringify(r)).join("\n")}\n`);
    console.log(`re-baselined ${result.turns.length} turns in ${file}`);
    return;
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const t of result.turns) {
      console.log(`${t.ok ? "PASS" : t.skipped ? "SKIP" : "FAIL"} ${String(t.n).padStart(3)}  ${t.player}`);
      for (const l of t.lines ?? []) console.log(`        ${l.speaker}: ${l.text}`);
      for (const p of t.problems) console.log(`        ✗ ${p.field}: want ${JSON.stringify(p.want)} got ${JSON.stringify(p.got)}`);
    }
    const failed = result.turns.filter((t) => !t.ok).length;
    console.log(`\n${result.turns.length - failed}/${result.turns.length} turns as expected (${provider})`);
  }
  process.exit(result.turns.every((t) => t.ok) ? 0 : 1);
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { replayTranscript, compareTurn, readTranscript };
