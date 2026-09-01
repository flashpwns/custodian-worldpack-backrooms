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

test("production state machine completes radio outside and crosses only on player CROSS", () => {
  const { service, world } = fixture();
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(projection.q4.current_location.name, "Threshold Room");
  assert.equal(projection.q4.radio_check.authorized, true);
  assert.equal(projection.q4.radio_check.completed, false);
  assert.equal(service.session(world.id, "field-researcher").run.spatial.route_history.some((item) => item.connection_id === "threshold-crossing"), false);

  const statement = "State Tester to Standard. Team accounted for outside the Threshold. Radio check.";
  const sent = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: statement });
  assert.equal(sent.ok, true);
  assert.ok(sent.projection.q4.channels.standard.history.some((item) => item.speaker === "You" && item.text === statement));
  assert.deepEqual(sent.projection.available_actions[0], { type: "CROSS", target_required: false, targets: [] });

  const crossed = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  assert.equal(crossed.ok, true);
  assert.equal(crossed.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(crossed.projection.q4.current_location.name, "Utility Room");
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.spatial.route_history.filter((item) => item.connection_id === "threshold-crossing").length, 1);
  assert.ok(Object.values(entry.run.spatial.personnel_locations).every((location) => location === "utility-room"));
});
