"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "player-identity") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-player-")) });
  const world = service.createWorld({ name: "Player identity", seed }).world;
  return { service, world };
}
function createAndStart(service, world, first_name = "Jack", last_name = "Rocha") {
  const created = service.createQ4Personnel({ world_id: world.id, first_name, last_name });
  assert.equal(created.ok, true);
  return service.startSession({ world_id: world.id, mode: "field-researcher", seed: "player-identity", require_personnel: true });
}
function advanceTo(service, world, actions = ["READY", "PROCEED", "APPROACH", "CROSS"]) {
  let result;
  for (const action of actions) result = service.submitAction({ world_id: world.id, mode: "field-researcher", action });
  return result;
}

test("fresh Clear-Q4 requires personnel creation before assignment generation", () => {
  const { service, world } = fixture();
  assert.equal(service.getQ4PersonnelStatus({ world_id: world.id }).required, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).error.code, "PERSONNEL_CREATION_REQUIRED");
  assert.equal(Object.keys(service.getWorld(world.id).q4_missions ?? {}).length, 0);
  const started = createAndStart(service, world);
  assert.equal(started.projection.phase.phase_id, "BRIEFING");
  assert.equal(started.projection.q4.player.name, "Jack Rocha");
});

test("player is a distinct controlled person from Alex Morgan and Nora Vale", () => {
  const { service, world } = fixture(); const started = createAndStart(service, world); const team = started.projection.q4.team;
  assert.equal(team.length, 3);
  assert.equal(team[0].display_name, "Jack Rocha · YOU");
  assert.deepEqual(team.slice(1).map((person) => person.display_name), ["Nora Vale", "Alex Morgan"]);
  assert.ok(team.every((person) => person.display_name !== "Jack Rocha" || person.controlled));
});

test("created identity persists and equipment holders name the actual people", () => {
  const { service, world } = fixture("identity-persistence"); const started = createAndStart(service, world); const before = started.projection.q4;
  assert.deepEqual(before.q4?.player, undefined);
  const holders = before.equipment.required.map((item) => item.holder);
  assert.deepEqual(holders, ["You", "Alex Morgan", "Nora Vale", "You"]);
  const restarted = new DesktopService({ appDataPath: service.paths.root }); const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); assert.equal(resumed.projection.q4.player.name, "Jack Rocha");
});

test("LOCAL is delivered to Nora before field entry while Standard remains procedurally gated", () => {
  const { service, world } = fixture("communication-gates"); createAndStart(service, world);
  const local = service.submitQ4Communication({ world_id: world.id, channel: "local", target: "Nora", text: "Good morning, Nora." });
  assert.equal(local.ok, true); assert.match(local.result.public_reason, /^Nora:/);
  const standard = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Hello?" });
  assert.equal(standard.ok, false); assert.match(standard.error.message, /not active during briefing/i);
  advanceTo(service, world, ["READY", "PROCEED", "APPROACH"]);
  const threshold = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(threshold.phase.phase_id, "THRESHOLD"); assert.equal(threshold.q4.channels.standard.available, false);
  assert.match(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Hello?" }).error.message, /approach|contact/i);
  const crossed = advanceTo(service, world, ["CROSS"]); assert.equal(crossed.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(crossed.projection.q4.channels.standard.available, true);
  const field = advanceTo(service, world, ["RADIO_CHECK"]); assert.equal(field.projection.phase.phase_id, "FIELD_OPERATION");
});

test("phase copy and progression controls identify the destination", () => {
  const { service, world } = fixture("phase-copy"); createAndStart(service, world);
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.match(projection.q4.briefing, /continue to staging/i); assert.match(surfaces.render(projection), /Continue to Staging/);
  for (const [action, phase, copy] of [["READY", "STAGING", /proceed to the threshold room/i], ["PROCEED", "FACILITY_TRANSIT", /toward the Threshold room/i], ["APPROACH", "THRESHOLD", /cross when ready/i]]) {
    const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action }); assert.equal(result.projection.phase.phase_id, phase); assert.match(result.projection.q4.briefing, copy); projection = result.projection;
  }
  assert.match(surfaces.render(projection), /Cross Threshold/);
  const radio = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }); assert.match(radio.projection.q4.briefing, /Establish contact with Standard/i); assert.match(surfaces.render(radio.projection), /Establish Radio Contact/);
});

test("renderer exposes creation, confirmation, phase guidance, and direct progression wiring", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /Create your ASYNC personnel record/); assert.match(renderer, /Continue to Assignment Briefing/); assert.match(renderer, /createQ4Personnel/); assert.match(renderer, /phaseAction/); assert.match(renderer, /Hide guidance/); assert.doesNotMatch(renderer, /You are entering Clear-Q4/);
});
