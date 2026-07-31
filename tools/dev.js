#!/usr/bin/env node
"use strict";
const commands = require("./dev-commands");
const authoring = require("./authoring");
const args = process.argv.slice(2); const command = args[0] ?? "help";
const value = (name, fallback = undefined) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const has = (name) => args.includes(name);
const json = has("--json");
const write = (value) => console.log(json ? JSON.stringify(value, null, 2) : JSON.stringify(value, null, 2));
const help = () => console.log(`Yellow Beast developer commands\n\nREAD_ONLY: inspect, snapshot, trace, thread-rebuild, reports, report, bug-bundle, author\nSIMULATION_DRIVING: reproduce, fixture\n\nExamples:\n  npm run dev -- inspect actor --id convergence-researcher --json\n  npm run dev -- trace --phrase "look around, then record the doorway" --json\n  npm run dev -- reproduce --seed case-12 --mode field-researcher --actions "look around|inspect fixture-1" --json\n  npm run dev -- fixtures --list\n  npm run dev -- reports --list\n  npm run dev -- author claim\n  npm run dev -- author validate\n\nRead-only commands change canonical state: NO. Reproduce/fixture create fresh isolated worlds and use normal session/action paths.`);
async function main() {
  if (has("--help") || has("-h") || command === "help") return help();
  if (command === "author") { const kind=args[1] ?? "help"; if (kind === "validate") return write(authoring.validate()); if (kind === "inspect" || kind === "preview") return write(authoring.preview(args[2])); if (kind === "asset") return write(authoring.assetCheck({ path:value("--path"), type:value("--type") })); if (kind === "help") return console.log("READ_ONLY author commands: source, claim, human, environment, phenomenon, scenario, asset (templates); validate; inspect <kind>. Templates are incomplete and never write files or worlds."); return write(authoring.preview(kind)); }
  if (["character","object","region","phenomenon","thread","event"].includes(command)) return write(commands.inspect({ target:command === "character" ? "actor" : command, id:value("--id", args[1]?.startsWith("--") ? undefined : args[1]), observer:value("--observer", "field-researcher"), seed:value("--seed"), fixture:value("--fixture") }));
  if (command === "inspect" || command === "snapshot") return write(commands.inspect({ target:command === "snapshot" ? "world" : args[1] ?? "world", id:value("--id"), observer:value("--observer", "field-researcher"), seed:value("--seed"), fixture:value("--fixture") }));
  if (command === "compare") return write(commands.compare({ target:value("--subject", "actor"), id:value("--id"), seed:value("--seed"), fixture:value("--fixture") }));
  if (command === "trace") return write(await commands.trace({ seed:value("--seed"), mode:value("--mode", "field-researcher"), phrase:value("--phrase", "look around") }));
  if (command === "thread-rebuild") return write(commands.threadRebuild({ seed:value("--seed"), fixture:value("--fixture") }));
  if (command === "bug-bundle") return write(commands.bugBundle({ seed:value("--seed"), fixture:value("--fixture"), subject:value("--subject", "world"), id:value("--id"), observer:value("--observer", "field-researcher"), mode:value("--mode", "field-researcher") }));
  if (command === "fixtures") return write({ version:"yellow-beast-dev-fixtures@v1", mutation:"READ_ONLY", fixtures:Object.entries(commands.fixtureRegistry).map(([name, entry]) => ({ name, category:entry.category, seed:entry.seed, turns:entry.turns, assertion:entry.assertion })) });
  if (command === "fixture") { const name = value("--name", "convergence"), seed = value("--seed"); const run = commands.fixtureRegistry[name]?.run(seed); if (!run) throw Object.assign(new Error(`Unknown fixture '${name}'.`), { code:"FIXTURE_UNKNOWN" }); return write({ version:"yellow-beast-dev-fixture@v1", mutation:"SIMULATION_DRIVING", isolated:true, name, seed:run.world.seed, turns:run.turns, snapshot:require("./dev-inspection").snapshot(run.world) }); }
  if (command === "reproduce") return write(await commands.reproduce({ seed:value("--seed"), mode:value("--mode", "field-researcher"), actions:(value("--actions", "").split("|").map((item) => item.trim()).filter(Boolean)) }));
  if (command === "reports") return write(commands.reports({ category:value("--category") }));
  if (command === "report") return write(value("--category") ? commands.runReports(value("--category")) : commands.runReport(value("--name", args[1])));
  if (command === "provider") return write(commands.providerStatus());
  if (command === "validate") { const area=value("--area"); const script=has("--fast") ? "dev:check" : has("--full") ? "validate" : area === "intent" ? "intent-report" : area === "world" ? "canon-convergence-report" : area === "ux" ? "ux-report" : null; if (!script) throw Object.assign(new Error("Use --fast, --full, or --area intent|world|ux."), { code:"VALIDATE_USAGE" }); return write(commands.runReport(script)); }
  throw Object.assign(new Error(`Unknown command '${command}'. Run 'dev help'.`), { code:"COMMAND_UNKNOWN" });
}
main().catch((error) => { console.error(`dev ${command}: ${error.message}\nState changed: NO${error.code ? `\nCode: ${error.code}` : ""}`); process.exitCode=2; });
