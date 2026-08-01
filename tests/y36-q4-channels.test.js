"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

function fixture() {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-channels-")) });
  const world = service.createWorld({ name: "Three channels", seed: "three-channels" }).world;
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "three-channels" });
  return { service, world };
}
function reachField(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  return service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
}

test("Clear-Q4 exposes dominant ACTION plus LOCAL and STANDARD lanes", () => {
  const { service, world } = fixture();
  const briefing = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const briefingHtml = surfaces.render(briefing);
  assert.equal(briefing.phase.phase_id, "BRIEFING");
  assert.match(briefingHtml, /q4-communication-lanes|local-comms|standard-comms/);
  assert.match(fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8"), /data-testid="natural-primary"/); // ACTION remains the primary composer.
  const field = reachField(service, world);
  const fieldHtml = surfaces.render(field);
  assert.match(fieldHtml, /data-testid="local-comms"/);
  assert.match(fieldHtml, /data-testid="standard-comms"/);
});

test("Q4 channels write distinguishable records and preserve physical continuity", () => {
  const { service, world } = fixture();
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
  const before = reachField(service, world);
  const location = before.scene.location; const phase = before.phase.phase_id; const interval = before.surface.expedition.clock.interval;
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Are you ready?" }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "We have an unmarked doorway." }).ok, true);
  const after = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(after.phase.phase_id, phase); assert.equal(after.scene.location, location); assert.equal(after.surface.expedition.clock.interval, interval + 1);
  assert.ok(after.q4.channels.action.history.length >= 1);
  assert.equal(after.q4.channels.local.history.at(-1).delivery, "heard");
  assert.equal(after.q4.channels.standard.history.at(-1).delivery, "delivered");
  assert.deepEqual(new Set(after.q4.channels.action.history.map((item) => "action").concat(after.q4.channels.local.history.map((item) => "local"), after.q4.channels.standard.history.map((item) => "standard"))), new Set(["action", "local", "standard"]));
  assert.ok(after.surface.expedition.clock.communication_ticks >= 2);
});

test("LOCAL follows same-location personnel and does not grant Standard knowledge", () => {
  const { service, world } = fixture();
  const unavailable = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Can you hear me?" });
  assert.equal(unavailable.ok, true);
  reachField(service, world);
  const beforeRecords = Object.keys(service.getWorld(world.id).knowledge.institutional.records).length;
  const entry = service.session(world.id, "field-researcher"); entry.run.expedition.team.members[1].status = "unavailable";
  const outOfRange = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Can you hear me?" });
  assert.equal(outOfRange.ok, false); assert.equal(outOfRange.error.code, "LOCAL_TARGET_UNAVAILABLE");
  assert.equal(Object.keys(service.getWorld(world.id).knowledge.institutional.records).length, beforeRecords);
});

test("STANDARD requires radio availability and transfers only reported knowledge", () => {
  const { service, world } = fixture(); reachField(service, world);
  const beforeRecords = Object.keys(service.getWorld(world.id).knowledge.institutional.records).length;
  const entry = service.session(world.id, "field-researcher"); entry.run.expedition.equipment["survey-radio"].charges = 0;
  const blocked = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "We have an unmarked doorway." });
  assert.equal(blocked.ok, false); assert.equal(blocked.error.code, "STANDARD_UNAVAILABLE");
  entry.run.expedition.equipment["survey-radio"].charges = 1;
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "local", text: "I saw an unmarked doorway." }).ok, true);
  assert.equal(Object.keys(service.getWorld(world.id).knowledge.institutional.records).length, beforeRecords);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "We have an unmarked doorway." }).ok, true);
  const records = Object.values(service.getWorld(world.id).knowledge.institutional.records);
  assert.equal(records.length, beforeRecords + 1); const report = records.find((record) => record.payload.report === "We have an unmarked doorway."); assert.ok(report); assert.match(report.payload.status, /delivered|acknowledged/);
  assert.doesNotMatch(JSON.stringify(service.getWorld(world.id).events), /objective\.doorway|doorway\.exists/);
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.channels.local.history.at(-1).text, "I saw an unmarked doorway.");
  assert.equal(projection.q4.channels.standard.history.at(-1).text, "We have an unmarked doorway.");
});
