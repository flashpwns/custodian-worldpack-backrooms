"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { startRun, status, act, saveRun, resumeRun } = require("./run-bootstrap");
const args = process.argv.slice(2); const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const savePath = value("--save") ?? path.join(".saves", "yellow-beast-save.json");
let run;
if (value("--resume")) { const resumed = resumeRun(JSON.parse(fs.readFileSync(value("--resume"), "utf8"))); if (!resumed.ok) throw new Error("unable to restore save"); run = resumed.run; } else run = startRun({ profile: value("--profile") || "field-researcher", seed: value("--seed") || "demo" }).run;
const verb = value("--action"); const target = value("--target"); const result = verb ? act(run, verb, target) : { ok: true };
if (value("--save") || value("--save-default")) { fs.mkdirSync(path.dirname(savePath), { recursive: true }); fs.writeFileSync(savePath, JSON.stringify(saveRun(run), null, 2)); }
console.log(JSON.stringify({ status: status(run), result: result.ok ? { outcome: result.outcome, reason: result.reason, public_reason: result.result?.public_reason ?? null } : result.error, save: (value("--save") || value("--save-default")) ? savePath : null }, null, 2));
