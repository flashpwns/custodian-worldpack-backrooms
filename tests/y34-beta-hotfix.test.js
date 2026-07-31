"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
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
  assert.equal(started.projection.phase.phase_id, "BRIEFING"); assert.match(started.projection.scene.narration, /assignment|team|next/i); assert.doesNotMatch(started.projection.scene.narration, /Continue the declared survey\.$/); assert.doesNotMatch(surfaces.render(started.projection), /(?:Corridor|Fixture|Surface|Passage)[ _-][0-9a-f]{5,}/i);
});
