"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const { resolveModeAttempt } = require("../tools/mode-attempt-resolution");
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-beta-hotfix-")); return { root, service: new DesktopService({ appDataPath: root }) }; }
test("credential setup uses the real openai form submit wiring and reports safe failure", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /<form id="openai"/); assert.match(renderer, /button\("Save access key", "submit"\)/); assert.match(renderer, /document\.querySelector\("#openai"\)\.addEventListener\("submit"/);
  const { service } = fixture(); assert.equal(service.configureOpenAI({ api_key: "   " }).error.code, "CREDENTIAL_INVALID"); assert.equal(service.getProviderStatus().provider.openai.configured, false); assert.equal(service.configureOpenAI({ api_key: "sk-beta-persisted" }).ok, true); assert.equal(service.getProviderStatus().provider.openai.configured, true);
});
test("all four natural-language paths interpret freeform attempts before canonical mode resolution", async () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Beta paths", seed: "beta-paths" }).world;
  const cases = [["field-researcher", "I pause and take in the assigned survey area."], ["async-command", "I read the latest operational note before deciding."], ["local-anomaly", "I compare the access point with my notebook."], ["lost", "I move carefully while listening for changes in the passage."]];
  for (const [mode, text] of cases) { const started = service.startSession({ world_id: world.id, mode, seed: `beta-${mode}` }); assert.equal(started.ok, true); const result = await service.submitNatural({ world_id: world.id, mode, text }); assert.equal(result.ok, true, mode); assert.ok(result.result.scene.narration); assert.doesNotMatch(result.result.scene.narration, /Your attempt is resolved|Action accepted|bare system-result/i); }
  const source = fs.readFileSync(path.join(__dirname, "../desktop/service.js"), "utf8"); assert.doesNotMatch(source, /naturalActionFor|NATURAL_ACTION_HINTS/);
});
test("Clear-Q4 first scene is an operational briefing and legacy opaque labels stay suppressed", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Briefing", seed: "briefing" }).world; const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "first-run" });
  const scene = started.projection.scene; const html = surfaces.render(started.projection);
  assert.equal(started.projection.phase.phase_id, "BRIEFING");
  assert.match(scene.narration, /assignment|team|equipment|report|ready/i);
  assert.doesNotMatch(JSON.stringify(scene), /corridor|fixture|surface|passage|survey frontier|declared survey remains/i);
  assert.match(html, /surface-clear-q4-briefing|briefing-assignment|briefing-team|briefing-equipment|briefing-reporting/i);
  assert.doesNotMatch(html, /field-surroundings|field-risk|declared survey remains|\b(?:Corridor|Fixture|Surface|Passage)\b/);
  const staged = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  assert.equal(staged.ok, true); assert.equal(staged.projection.phase.phase_id, "STAGING");
  assert.doesNotMatch(staged.projection.scene.narration, /corridor|fixture|surface|passage/i);
  let field = staged;
  for (const action of ["PROCEED", "APPROACH", "CROSS"]) field = service.submitAction({ world_id: world.id, mode: "field-researcher", action });
  assert.equal(field.ok, true); assert.equal(field.projection.phase.phase_id, "FIELD_OPERATION");
  assert.match(field.projection.scene.narration, /You are at|Nearby|floor|ceiling|corridor/i);
});
test("compound grounded attempts resolve each step against available affordances", () => {
  const calls = []; const plan = { steps: [{ id: "step-1", attempted_behavior: "move toward the opening", capability_requirements: ["locomotion"], possible: true }, { id: "step-2", attempted_behavior: "move back", capability_requirements: ["locomotion"], possible: true }], grounded_intent: { grounded_references: [] }, clarification_required: false };
  const service = { submitAction(request) { calls.push(request); return { ok: true, result: { canonical_event_ids: [`event-${calls.length}`] } }; } };
  const result = resolveModeAttempt({ service, world_id: "world", mode: "lost", plan, available: [{ type: "MOVE", target_required: true, targets: [{ ref: "opening", label: "opening" }] }] });
  assert.deepEqual(calls.map((call) => call.action), ["MOVE", "MOVE"]);
  assert.deepEqual(result.result.completed_steps, ["step-1", "step-2"]);
  assert.equal(result.result.failed_steps.length, 0);
});
