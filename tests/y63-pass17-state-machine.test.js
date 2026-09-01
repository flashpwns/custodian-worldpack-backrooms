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

test("production opening reaches staging without deployment or generated speech", () => {
  const { service, world } = fixture();
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.deepEqual(projection.available_actions[0], { type: "READY", target_required: false, targets: [] });
  assert.equal(projection.q4.operational_clock.interval, 0);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMMUNICATE", target: "standard" }).error.code, "PLAYER_TRANSMISSION_REQUIRED");
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "DEPLOY" }).error.code, "PHASE_GUARD_REJECTED");
  const staged = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  assert.equal(staged.ok, true);
  assert.equal(staged.projection.phase.phase_id, "STAGING");
  assert.equal(staged.projection.q4.current_location.name, "Equipment Staging");
  assert.equal(staged.projection.q4.operational_clock.interval, 0);
  assert.equal(staged.projection.q4.channels.standard.history.length, 0);
  assert.equal(staged.projection.q4.radio_check.authorized, false);
  assert.equal(staged.projection.q4.radio_check.completed, false);
  const cycle = service.getDeveloperSnapshot({ world_id: world.id, mode: "field-researcher" });
  assert.ok(cycle.active.simulation_truth.event_queue);
  assert.ok(cycle.active.simulation_truth.authoritative_clock);
});

test("LOCAL uses the submitted statement and does not consume an interval", () => {
  const { service, world } = fixture();
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.operational_clock.interval;
  const statement = "The west relay is quiet but the team remains together.";
  const result = service.submitQ4Communication({ world_id: world.id, channel: "local", text: statement });
  assert.equal(result.ok, true);
  assert.equal(result.projection.q4.operational_clock.interval, before);
  assert.match(result.result.public_reason, /west relay|team remains together/i);
});
