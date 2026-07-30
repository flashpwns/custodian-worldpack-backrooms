"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { startRun, status, act, saveRun, resumeRun } = require("./run-bootstrap");
const { executeNatural } = require("./ai-adapter");
const { createMockProvider } = require("./ai-mock-provider");
const { createOpenAIProvider } = require("./ai-openai-provider");
const { resolveAppPaths } = require("./launcher-paths");
const packageVersion = require("../package.json").version;

const defaults = Object.freeze({ input_mode: "structured", provider: "offline-mock", narration: true });
function providerForEnvironment() { return process.env.YELLOW_BEAST_AI_PROVIDER === "openai" ? createOpenAIProvider() : createMockProvider(); }
function safeProviderForEnvironment() {
  try { return { provider: providerForEnvironment(), warning: null }; }
  catch (error) { return { provider: createMockProvider(), warning: `OpenAI provider is unavailable; using Offline Interpreter. ${error.message}` }; }
}
function ensureData(paths) { fs.mkdirSync(paths.saves, { recursive: true }); fs.mkdirSync(paths.logs, { recursive: true }); }
function loadConfig(paths) {
  ensureData(paths);
  if (!fs.existsSync(paths.config)) { fs.writeFileSync(paths.config, `${JSON.stringify(defaults, null, 2)}\n`); return { config: { ...defaults }, warning: null }; }
  try {
    const value = JSON.parse(fs.readFileSync(paths.config, "utf8"));
    if (!value || typeof value !== "object" || !["structured", "natural"].includes(value.input_mode) || value.provider !== "offline-mock" || typeof value.narration !== "boolean") throw new Error("unsupported settings");
    return { config: value, warning: null };
  } catch { return { config: { ...defaults }, warning: "Configuration was invalid; Yellow Beast is using safe offline defaults." }; }
}
function log(paths, message) { ensureData(paths); fs.appendFileSync(paths.log, `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, " ")}\n`); }
function savePath(paths, slot = "clear-q4") { return path.join(paths.saves, `${String(slot).replace(/[^a-z0-9_-]/gi, "-")}.json`); }
function readSave(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function concise(result) { return result.ok ? { outcome: result.outcome, reason: result.reason, public_reason: result.result?.public_reason ?? null } : result.error; }
async function runCommand({ paths, profile = "field-researcher", seed = "alpha", resume, save, action, target, natural }) {
  const loaded = loadConfig(paths); let run;
  try {
    if (resume) { const restored = resumeRun(readSave(savePath(paths, resume))); if (!restored.ok) throw new Error("save is incompatible or corrupted"); run = restored.run; }
    else run = startRun({ profile, seed }).run;
    const selected = natural ? safeProviderForEnvironment() : null;
    const result = natural ? await executeNatural({ run, provider: selected.provider, player_text: natural }) : action ? act(run, action.toUpperCase(), target) : { ok: true };
    let saved = null;
    if (save) { saved = savePath(paths, save === true ? "clear-q4" : save); fs.writeFileSync(saved, `${JSON.stringify(saveRun(run), null, 2)}\n`); }
    return { ok: true, warning: loaded.warning || selected?.warning || null, version: `Yellow Beast ${packageVersion}`, custodian: "Custodian 1.5.0", status: status(run), result: natural ? { intent: result.intent, steps: result.steps } : concise(result), save: saved, paths: { saves: paths.saves, config: paths.config, logs: paths.logs } };
  } catch (error) { log(paths, `launch failure: ${error.message}`); return { ok: false, warning: loaded.warning, error: "Yellow Beast could not start that run. Check the save/configuration and try again.", detail: error.message, paths: { saves: paths.saves, config: paths.config, logs: paths.logs } }; }
}
async function interactive(paths) {
  console.log("YELLOW BEAST — Playable Alpha\nRecommended: Async: Clear-Q4 (PLAYABLE ALPHA)\nOther modes are experimental.");
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  ensureData(paths);
  const defaultSave = savePath(paths);
  let run;
  if (fs.existsSync(defaultSave) && (await prompt.question("Resume saved Async: Clear-Q4 run? [Y/n]: ")).trim().toLowerCase() !== "n") {
    const restored = resumeRun(readSave(defaultSave));
    if (restored.ok) run = restored.run;
    else console.log("Saved run is incompatible or corrupted; starting a new run.");
  }
  if (!run) {
    const profile = (await prompt.question("Mode [2 recommended: Async: Clear-Q4]: ")).trim();
    run = startRun({ profile: { "1": "async-command", "2": "field-researcher", "3": "local-anomaly", "4": "lost" }[profile] || "field-researcher", seed: "alpha" }).run;
  }
  console.log(JSON.stringify(status(run), null, 2));
  while (true) {
    const input = (await prompt.question("Command (LOOK, MOVE, INSPECT fixture-1, RECORD fixture-1, COMMUNICATE standard, WAIT, USE survey-instrument, RETURN, ABORT, SAVE, QUIT, or natural text): ")).trim();
    if (!input || input.toUpperCase() === "QUIT") break;
    if (input.toUpperCase() === "SAVE") { fs.writeFileSync(savePath(paths), `${JSON.stringify(saveRun(run), null, 2)}\n`); console.log(`Saved to ${savePath(paths)}`); continue; }
    const [verb, target] = input.split(/\s+/, 2); const structured = ["LOOK", "MOVE", "INSPECT", "USE"].includes(verb.toUpperCase());
    const selected = structured ? null : safeProviderForEnvironment();
    if (selected?.warning) console.log(selected.warning);
    const result = structured ? act(run, verb.toUpperCase(), target) : await executeNatural({ run, provider: selected.provider, player_text: input });
    console.log(JSON.stringify(structured ? concise(result) : { intent: result.intent, steps: result.steps }, null, 2));
    console.log(JSON.stringify(status(run), null, 2));
  }
  prompt.close();
}
function option(args, name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
async function main() {
  const paths = resolveAppPaths(); const args = process.argv.slice(2);
  if (args.includes("--interactive") || (!args.length && stdin.isTTY)) return interactive(paths);
  const output = await runCommand({ paths, profile: option(args, "--profile") || "field-researcher", seed: option(args, "--seed") || "alpha", resume: option(args, "--resume"), save: args.includes("--save") ? option(args, "--save") || true : false, action: option(args, "--action"), target: option(args, "--target"), natural: option(args, "--natural") });
  console.log(JSON.stringify(output, null, 2)); if (!output.ok) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error("Yellow Beast launcher failed safely:", error.message); process.exitCode = 1; });
module.exports = { resolveAppPaths, ensureData, loadConfig, savePath, runCommand, providerForEnvironment, safeProviderForEnvironment };
