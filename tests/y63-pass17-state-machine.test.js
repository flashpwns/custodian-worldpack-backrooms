"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");

function fixture() {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-pass17-state-")), developerMode: true });
  const world = service.createWorld({ name: "Pass 17 repaired state", seed: "pass17-repaired-state" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "State", last_name: "Tester" });
  service.confirmQ4Personnel({ world_id: world.id });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "pass17-repaired-state" });
  return { service, world };
}

test("production opening has one deliberate deployment and no generated speech", () => {
  const { service, world } = fixture();
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.deepEqual(projection.available_actions[0], { type: "DEPLOY", target_required: false, targets: [] });
  assert.equal(projection.q4.operational_clock.interval, 0);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMMUNICATE", target: "standard" }).error.code, "PLAYER_TRANSMISSION_REQUIRED");
  const deployed = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "DEPLOY" });
  assert.equal(deployed.ok, true);
  assert.equal(deployed.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(deployed.projection.q4.operational_clock.interval, 1);
  assert.equal(deployed.projection.q4.channels.standard.history.length, 0);
  const nonce = `runtime-only-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sent = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: nonce });
  assert.equal(sent.ok, true);
  const record = sent.projection.q4.channels.standard.history.find((item) => item.speaker === "You" && item.text === nonce);
  assert.ok(record);
  assert.match(sent.projection.q4.channels.standard.history.at(-1).text, /Radio check/);
  assert.notEqual(sent.projection.q4.channels.standard.state, "awaiting-response");
  assert.ok(sent.projection.q4.operational_clock.interval > 1);
  const cycle = service.getDeveloperSnapshot({ world_id: world.id, mode: "field-researcher" });
  assert.ok(cycle.active.simulation_truth.event_queue);
  assert.ok(cycle.active.simulation_truth.authoritative_clock);
});

test("LOCAL uses the submitted statement and does not consume an interval", () => {
  const { service, world } = fixture();
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "DEPLOY" });
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "I am ready for the radio check." });
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.operational_clock.interval;
  const statement = "The west relay is quiet but the team remains together.";
  const result = service.submitQ4Communication({ world_id: world.id, channel: "local", text: statement });
  assert.equal(result.ok, true);
  assert.equal(result.projection.q4.operational_clock.interval, before);
  assert.match(result.result.public_reason, /west relay|team remains together/i);
});
