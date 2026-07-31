"use strict";
// Developer command service. Read-only helpers derive from normal world data;
// the isolated replay path uses the ordinary run and freeform consequence APIs.
const { spawnSync } = require("node:child_process");
const inspection = require("./dev-inspection");
const convergence = require("./canon-convergence");
const history = require("./world-history");
const { startRun, status } = require("./run-bootstrap");
const { executeNatural } = require("./ai-adapter");
const { createMockProvider } = require("./ai-mock-provider");
const packageInfo = require("../package.json");

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const failure = (code, message) => Object.assign(new Error(message), { code });
const fixtureRegistry = Object.freeze({
  convergence: { category:"world", seed:"yb31-convergence", turns:150, assertion:"cross-mode convergence, continuity, phenomena, derived threads", run:(seed) => convergence.fixture(seed) }
});
const reportRegistry = Object.freeze({
  "canon-runtime-report": { category:"canon", purpose:"runtime canon authority" },
  "canon-convergence-report": { category:"world", purpose:"cross-mode deterministic convergence" },
  "character-continuity-report": { category:"world", purpose:"singular character identity and death" },
  "story-thread-report": { category:"world", purpose:"derived thread safety" },
  "freeform-report": { category:"world", purpose:"freeform interpretation and consequence boundary" },
  "intent-report": { category:"world", purpose:"intent grounding and planning" },
  "q4-report": { category:"mode", purpose:"Clear-Q4 mode invariants" },
  "beck-report": { category:"mode", purpose:"Beck mode invariants" },
  "nullzone-report": { category:"mode", purpose:"Nullzone mode invariants" },
  "lost-report": { category:"mode", purpose:"Lost mode invariants" },
  "navigation-report": { category:"ux", purpose:"player navigation" },
  "reactive-ui-report": { category:"ux", purpose:"observer-safe reactive presentation" },
  "interaction-report": { category:"ux", purpose:"request lifecycle and race safety" },
  "qol-report": { category:"ux", purpose:"observer-safe quality of life" },
  "accessibility-report": { category:"ux", purpose:"presentation accessibility" },
  "ux-report": { category:"ux", purpose:"YB-30 closure" },
  "dev-workflow-report": { category:"developer", purpose:"developer workflow audit" },
  "dev-console-report": { category:"developer", purpose:"read-only inspector contract" },
  "dev-command-report": { category:"developer", purpose:"safe command contract" },
  "authoring-report": { category:"developer", purpose:"canon-safe content authoring validation" },
  "y31-closure-report": { category:"developer", purpose:"YB-31 architecture closure and invariant aggregate" },
  "dev:check": { category:"developer", purpose:"fast validation path" },
  validate: { category:"developer", purpose:"full validation path" }
});
function isolatedFixture(name = "convergence", seed = fixtureRegistry.convergence.seed) {
  const entry = fixtureRegistry[name]; if (!entry) throw failure("FIXTURE_UNKNOWN", `Unknown fixture '${name}'. Run 'fixtures --list'.`);
  return entry.run(seed);
}
function inspect({ target = "world", id = null, observer = "field-researcher", seed, fixture } = {}) {
  const run = isolatedFixture(fixture, seed); const snapshot = inspection.snapshot(run.world);
  return stable({ version:"yellow-beast-dev-inspect@v1", mutation:"READ_ONLY", fixture:fixture ?? "convergence", subject:target, value:inspection.subject(snapshot, target, id, observer, run.world.events) });
}
function compare({ target = "actor", id, seed, fixture } = {}) { const run=isolatedFixture(fixture, seed), snapshot=inspection.snapshot(run.world); return stable({ version:"yellow-beast-dev-compare@v1", mutation:"READ_ONLY", objective:inspection.subject(snapshot, target, id, "field-researcher", run.world.events), observer_views:snapshot.observer_views, note:"Observer views are filtered projections; they are not objective truth." }); }
async function trace({ seed = "yb31-trace", mode = "field-researcher", phrase = "look around" } = {}) {
  const started = startRun({ profile:mode, seed }); if (!started.ok) throw failure("SESSION_UNAVAILABLE", `Unable to start '${mode}' trace session.`);
  const before = JSON.stringify(started.run); const result = await inspection.intentTrace({ run:started.run, provider:createMockProvider(), player_text:phrase });
  if (JSON.stringify(started.run) !== before) throw failure("TRACE_MUTATED", "Trace changed a run unexpectedly.");
  return stable({ version:"yellow-beast-dev-trace@v1", mutation:"READ_ONLY", path:"PRIMARY FREEFORM PATH", fallback:"OFFLINE / COMPATIBILITY FALLBACK is not the authoritative model", trace:result });
}
async function reproduce({ seed = "yb31-reproduce", mode = "field-researcher", actions = [] } = {}) {
  const world = history.createWorld({ seed }); const started = startRun({ profile:mode, seed, world }); if (!started.ok) throw failure("SESSION_UNAVAILABLE", `Unable to start '${mode}' reproduction.`);
  const results = []; for (const player_text of actions) { const resolved = await executeNatural({ run:started.run, provider:createMockProvider(), player_text }); results.push({ player_text, outcome:resolved.executed ? "resolved" : "not-applied", public_reason:resolved.consequence?.result?.public_reason ?? resolved.consequence?.error?.code ?? null }); }
  return stable({ version:"yellow-beast-dev-reproduce@v1", mutation:"SIMULATION_DRIVING", path:"fresh world → normal session → freeform interpretation → normal consequence resolution", seed, mode, actions:results, session:status(started.run), snapshot:inspection.snapshot(world) });
}
function threadRebuild({ seed, fixture } = {}) { const run = isolatedFixture(fixture, seed); const before = JSON.stringify(run.world); const first = inspection.snapshot(run.world).objective.threads.index, second = inspection.snapshot(run.world).objective.threads.index; if (JSON.stringify(run.world) !== before) throw failure("THREAD_REBUILD_MUTATED", "Derived thread rebuild changed canonical state."); return stable({ version:"yellow-beast-dev-thread-rebuild@v1", mutation:"READ_ONLY", derived:true, equivalent:JSON.stringify(first) === JSON.stringify(second), thread_count:first.threads?.length ?? 0 }); }
function bugBundle({ seed, fixture, subject:target = "world", id = null, observer = "field-researcher", mode = "field-researcher" } = {}) { const run = isolatedFixture(fixture, seed), snapshot = inspection.snapshot(run.world); return stable({ version:"yellow-beast-dev-bug-bundle@v1", diagnostic_only:true, importable:false, commit:process.env.GIT_COMMIT ?? "local", app_version:packageInfo.version, seed:run.world.seed, mode, observer, selected_subject:inspection.subject(snapshot, target, id, observer, run.world.events), recent_events:inspection.recentHistory(run.world).map(({ id:event_id, sequence, type, run_id }) => ({ event_id, sequence, type, run_id })), provider:{ mode:"offline", credential_values:"redacted/not collected" } }); }
function fixture({ name = "convergence", seed } = {}) { const entry = fixtureRegistry[name]; if (!entry) throw failure("FIXTURE_UNKNOWN", `Unknown fixture '${name}'. Run 'fixtures --list'.`); const run = entry.run(seed); return { version:"yellow-beast-dev-fixture@v1", mutation:"SIMULATION_DRIVING", isolated:true, name, seed:run.world.seed, turns:run.turns, snapshot:inspection.snapshot(run.world) }; }
function reports({ category = null } = {}) { return stable({ version:"yellow-beast-dev-reports@v1", mutation:"READ_ONLY", reports:Object.entries(reportRegistry).filter(([, entry]) => !category || category === "all" || entry.category === category).map(([name, entry]) => ({ name, ...entry, json:"report-defined" })) }); }
function runReport(name) { if (!reportRegistry[name]) throw failure("REPORT_UNKNOWN", `Unknown report '${name}'. Run 'reports --list'.`); const result = spawnSync("npm", ["run", name], { encoding:"utf8" }); if (result.status !== 0) throw failure("REPORT_FAILED", `Report '${name}' failed (state changed: NO).`); return { version:"yellow-beast-dev-report-run@v1", mutation:"READ_ONLY", name, status:"passed", output:result.stdout.trim() }; }
function runReports(category = "all") { const names=Object.entries(reportRegistry).filter(([, entry]) => category === "all" || entry.category === category).map(([name]) => name).filter((name) => !["dev:check", "validate"].includes(name)); if (!names.length) throw failure("REPORT_CATEGORY_UNKNOWN", `Unknown report category '${category}'.`); return stable({ version:"yellow-beast-dev-report-group@v1", mutation:"READ_ONLY", category, reports:names.map(runReport) }); }
function providerStatus() { return { version:"yellow-beast-dev-provider@v1", mutation:"READ_ONLY", enabled:false, status:"offline", last_request:"unavailable in standalone CLI", safe_context:"obtain with 'trace'; no credentials are read" }; }
module.exports = { stable, fixtureRegistry, reportRegistry, inspect, compare, trace, reproduce, threadRebuild, bugBundle, fixture, reports, runReport, runReports, providerStatus };
