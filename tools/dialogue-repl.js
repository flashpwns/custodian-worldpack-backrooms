#!/usr/bin/env node
"use strict";

// ED-30 I5 dialogue REPL: talk to the Day-1 coworkers through the REAL production dialogue service from a
// terminal, without the Electron UI.
//
//   npm run dialogue:repl -- [--provider fallback|real|garbage|throwing] [--endpoint http://127.0.0.1:PORT]
//                            [--seed S] [--names Giselle,Malcolm,Tonya] [--no-brief]
//                            [--save <app-data folder> --world <world id>] [--trace] [--script <file>]
//
// Lines you type are spoken aloud (LOCAL), exactly as the Electron composer sends them. Commands:
//   :trace on|off|full   show a compact trace per turn / hide it / print the whole developer trace
//   :why                 the full developer trace of the last turn
//   :state               the dialogue information state (requests, activity, active speaker, procedure)
//   :brief               run the Day-1 briefing (to reach the introductions)
//   :action NAME         submit a structured action (e.g. CONCLUDE_BRIEFING)
//   :export <file>       save this conversation as a replayable JSONL transcript
//   :quit
//
// --script <file> plays one line per turn non-interactively (lines starting with ':' are commands).

const fs = require("node:fs");
const readline = require("node:readline");
const { openSession, PROVIDERS } = require("./dialogue-session");
const dialogueState = require("./dialogue-state");

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);

function compact(result) {
  const s = result.semantic;
  const t = result.trace;
  const bits = [
    `act=${s.speech_act ?? "-"}`,
    `to=${s.address ? `${s.address.scope}:${s.address.to.join("+") || "-"}` : "-"}`,
    `P=${s.predicate ?? "-"}`,
    `fn=${s.fn ?? "-"}`,
    `card=${s.cardinality ?? "-"}`,
    s.temporal ? `T=${s.temporal}` : null,
    s.clarify ? "CLARIFY" : null,
    t.primary?.relation && t.primary.relation !== "new" ? `rel=${t.primary.relation}` : null,
    t.token_repairs.length ? `fix=${t.token_repairs.join(",")}` : null,
    t.completeness && !t.completeness.complete ? `incomplete=${(t.completeness.missing ?? []).join(",")}` : null,
    s.requests.length ? `ledger=${s.requests.map((r) => `${r.predicate ?? "?"}:${r.state}`).join(",")}` : null,
    t.lines.some((l) => l.fallback_used) ? `fallback=${t.lines.filter((l) => l.fallback_used).map((l) => l.speaker).join("+")}` : null,
    t.lines.some((l) => l.rejection_reason) ? `rejected=${t.lines.filter((l) => l.rejection_reason).map((l) => `${l.speaker}:${l.rejection_reason}`).join(",")}` : null,
    `${Math.round(result.ms)}ms`
  ].filter(Boolean);
  return `  · ${bits.join("  ")}`;
}

async function main() {
  const provider = arg("provider", "fallback");
  if (!PROVIDERS.includes(provider)) { console.error(`--provider must be one of ${PROVIDERS.join(", ")}`); process.exit(2); }
  let traceMode = flag("trace") ? "on" : "off";
  if (provider === "real" && !arg("endpoint")) console.log("Starting the local model (this takes a little while)...");
  const session = await openSession({ provider, endpoint: arg("endpoint"), seed: arg("seed", "ed30-repl"), save: arg("save"), world_id: arg("world"), names: arg("names") ? arg("names").split(",").map((s) => s.trim()) : null, brief: !flag("no-brief") });
  const names = session.coworkers().map((m) => m.first_name);
  console.log(`Yellow Beast dialogue REPL — provider: ${provider}; beat: ${session.run.expedition.day1_opener?.beat ?? "?"}; coworkers: ${names.join(", ")}. Type :quit to leave.`);
  let last = null;

  const handle = async (line) => {
    const text = line.trim();
    if (!text) return true;
    if (text.startsWith(":")) {
      const [cmd, ...rest] = text.slice(1).split(/\s+/);
      if (cmd === "quit" || cmd === "q") return false;
      if (cmd === "trace") { traceMode = rest[0] ?? (traceMode === "off" ? "on" : "off"); console.log(`trace ${traceMode}`); return true; }
      if (cmd === "why") { console.log(JSON.stringify(last?.trace ?? null, null, 2)); return true; }
      if (cmd === "state") { const snap = dialogueState.snapshot(session.run, { player_id: session.playerId, present_ids: session.coworkers().map((m) => m.personnel_id ?? m.id) }); console.log(JSON.stringify({ beat: session.run.expedition.day1_opener?.beat, ...snap, acquaintance: session.run.expedition.dialogue_state?.acquaintance ?? null }, null, 2)); return true; }
      if (cmd === "brief") { session.brief(); console.log(`beat: ${session.run.expedition.day1_opener?.beat}`); return true; }
      if (cmd === "action") { const r = session.action(rest[0]); console.log(r.ok === false ? `rejected: ${r.error?.message}` : `ok; beat: ${session.run.expedition.day1_opener?.beat}`); return true; }
      if (cmd === "export") { const file = rest[0] ?? `dialogue-${Date.now()}.jsonl`; fs.writeFileSync(file, `${session.transcript().map((r) => JSON.stringify(r)).join("\n")}\n`); console.log(`wrote ${file}`); return true; }
      console.log("commands: :trace on|off|full  :why  :state  :brief  :action NAME  :export FILE  :quit");
      return true;
    }
    last = await session.say(text);
    if (!last.ok) console.log(`  (${last.error?.message ?? "not delivered"})`);
    if (!last.lines.length && last.ok) console.log("  (no one answers)");
    for (const l of last.lines) console.log(`${l.speaker}: ${l.text}`);
    if (traceMode === "on") console.log(compact(last));
    if (traceMode === "full") console.log(JSON.stringify(last.trace, null, 2));
    return true;
  };

  try {
    const script = arg("script");
    if (script) {
      for (const line of fs.readFileSync(script, "utf8").split("\n")) {
        if (!line.trim() || line.startsWith("#")) continue;
        if (!line.startsWith(":")) console.log(`> ${line}`);
        if (!(await handle(line))) break;
      }
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
    rl.prompt();
    for await (const line of rl) {
      if (!(await handle(line))) break;
      rl.prompt();
    }
    rl.close();
  } finally {
    await session.close();
  }
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });
