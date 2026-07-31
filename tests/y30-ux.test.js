"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const { RequestGate } = require("../desktop/renderer/interaction");
const qol = require("../desktop/renderer/qol");
const surfaces = require("../desktop/renderer/surfaces");
const report = require("../tools/ux-report.js");
require("./y31-dev-workflow.test.js");
require("./y31-dev-console.test.js");

function fixture() {
  const service = new DesktopService({ appDataPath:fs.mkdtempSync(path.join(os.tmpdir(), "yb-ux-")) });
  const world = service.createWorld({ name:"First visit", seed:"ux-flow" }).world;
  return { service, world };
}

test("first-time and returning player flows keep one saved world and no request state", async () => {
  void report;
  const { service, world } = fixture();
  const before = service.loadWorld({ world_id:world.id }).summary;
  const q4 = service.startSession({ world_id:world.id, mode:"field-researcher", seed:"first" });
  assert.ok(q4.ok); const turn = await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:"look around" }); assert.ok(turn.ok);
  assert.ok(service.saveWorld({ world_id:world.id }).ok);
  const resumed = new DesktopService({ appDataPath:service.paths.root }).resumeSession({ world_id:world.id, mode:"field-researcher" });
  assert.ok(resumed.ok); assert.equal(resumed.projection.world.id, world.id);
  assert.notEqual(service.loadWorld({ world_id:world.id }).summary, undefined);
  assert.equal(before.world_id, service.loadWorld({ world_id:world.id }).summary.world_id);
});

test("all modes retain distinct safe surfaces and primary natural-language resolution", async () => {
  const { service, world } = fixture();
  const cases = [["field-researcher", "look around"], ["async-command", "review reports"], ["local-anomaly", "explore"], ["lost", "strand"]];
  for (const [mode, phrase] of cases) {
    const started = service.startSession({ world_id:world.id, mode, seed:`ux-${mode}` }); assert.ok(started.ok);
    const html = surfaces.render(started.projection); assert.doesNotMatch(html, /region-\d+|STORY THREAD|MYSTERY ID/i);
    const result = await service.submitNatural({ world_id:world.id, mode, text:phrase }); assert.ok(result.ok, `${mode} resolves a known natural-language phrase`);
  }
  const lost = service.getGameplayProjection({ world_id:world.id, mode:"lost" }).projection;
  assert.doesNotMatch(JSON.stringify(qol.recap(lost)), /institution|objective|map|thread|taxonomy/i);
});

test("observer-safe recap/search and presentation metadata cannot become world truth", () => {
  const { service, world } = fixture();
  const beck = service.startSession({ world_id:world.id, mode:"async-command", seed:"beck" }).projection;
  const safe = JSON.stringify(qol.recap(beck)); assert.doesNotMatch(safe, /hidden|dead|Still Life|region-\d+/i);
  const metadata = new qol.PresentationMetadata(); metadata.setDraft({ worldId:world.id, mode:"async-command" }, "review reports"); metadata.togglePin({ worldId:world.id, mode:"async-command" }, "report");
  const before = service.loadWorld({ world_id:world.id }).summary; service.updateSettings({ settings:{ theme:"high-contrast", text_scale:"extra-large", reduced_motion:true, guided_introductions:false } });
  assert.deepEqual(service.loadWorld({ world_id:world.id }).summary, before);
  assert.equal(metadata.draft({ worldId:"other-world", mode:"async-command" }), "");
});

test("150 mixed presentation interactions remain scoped, serial, and disposable", () => {
  const gate = new RequestGate(); const modes = ["field-researcher", "async-command", "local-anomaly", "lost"];
  for (let index = 0; index < 150; index += 1) {
    const context = { worldId:`world-${index % 3}`, mode:modes[index % modes.length] };
    const token = gate.begin(context); assert.ok(token); assert.equal(gate.begin(context), null);
    assert.equal(gate.settle(token, context), true);
  }
  const stale = gate.begin({ worldId:"one", mode:"lost" }); assert.ok(stale); assert.equal(gate.settle(stale, { worldId:"two", mode:"lost" }), false);
});

test("player renderer excludes debug and internal terminology while retaining accessible core controls", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /data-testid="natural-primary"/); assert.match(renderer, /aria-live="polite"/); assert.match(renderer, /Current scene/);
  assert.doesNotMatch(renderer, /CANONICAL_EFFECT|OBSERVER_PROJECTION|STORY_THREAD_V1|environment family|entity instance/);
});
