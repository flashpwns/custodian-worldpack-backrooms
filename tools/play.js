"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { startRun, status, act, saveRun, resumeRun } = require("./run-bootstrap");
const { executeNatural } = require("./ai-adapter");
const { createMockProvider } = require("./ai-mock-provider");
const args = process.argv.slice(2); const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const savePath = value("--save") ?? path.join(".saves", "yellow-beast-save.json");
async function main() {
  let run;
  if (value("--resume")) { const resumed = resumeRun(JSON.parse(fs.readFileSync(value("--resume"), "utf8"))); if (!resumed.ok) throw new Error("unable to restore save"); run = resumed.run; } else run = startRun({ profile: value("--profile") || "field-researcher", seed: value("--seed") || "demo" }).run;
  const verb = value("--action"); const natural = value("--natural");
  const result = natural ? await executeNatural({ run, provider: createMockProvider(), player_text: natural }) : verb ? act(run, verb, value("--target")) : { ok: true };
  if (value("--save") || value("--save-default")) { fs.mkdirSync(path.dirname(savePath), { recursive: true }); fs.writeFileSync(savePath, JSON.stringify(saveRun(run), null, 2)); }
  const presented = natural ? { intent: result.intent, steps: result.steps, narration: result.narration ?? null } : result.ok ? { outcome: result.outcome, reason: result.reason, public_reason: result.result?.public_reason ?? null } : result.error;
  console.log(JSON.stringify({ status: status(run), result: presented, save: (value("--save") || value("--save-default")) ? savePath : null }, null, 2));
}
main().catch((error) => { console.error("AI/command input failed safely:", error.message); process.exitCode = 1; });
