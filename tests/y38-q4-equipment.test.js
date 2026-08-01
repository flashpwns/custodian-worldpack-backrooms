"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const history = require("../tools/world-history");
const equipment = require("../tools/q4-equipment");
const surfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "q4-equipment") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-equipment-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Equipment continuity", seed }).world;
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed }).ok, true);
  return { service, world, appDataPath };
}
function reach(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
}

test("Q4 loadout matches the assignment and staging presents required and optional gear", () => {
  const { service, world } = fixture();
  const briefing = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.deepEqual(briefing.q4.equipment.required.map((item) => item.label), ["Battery field lamp", "35mm field camera", "Portable survey instrument", "Handheld field radio"]);
  assert.equal(briefing.q4.equipment.optional.length, 2);
  assert.equal(briefing.q4.equipment.readiness, true);
  assert.match(surfaces.render(briefing), /Required field kit|Optional stores|Operational/);
  assert.doesNotMatch(surfaces.render(briefing), /charges|durability|HP/);
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  const staging = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(staging.phase.phase_id, "STAGING");
  assert.ok(staging.q4.equipment.required.every((item) => item.location === "staging locker"));
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "field-notebook" }).ok, true);
  const selected = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.ok(selected.q4.equipment.required.some((item) => item.label === "Field notebook"));
});

test("equipment items have persistent identities, holder/location state, and period authority", () => {
  const { service, world, appDataPath } = fixture("q4-equipment-persistence");
  const entry = service.session(world.id, "field-researcher");
  const player = entry.run.session.startup.player.observer_id;
  const ids = Object.values(entry.run.expedition.equipment).map((item) => item.id);
  assert.equal(new Set(ids).size, 4);
  assert.ok(Object.values(service.getWorld(world.id).q4_equipment).every((item) => item.holder && item.location && item.period_authority.includes("1985-1995")));
  const camera = entry.run.expedition.equipment["recording-device"];
  camera.known_condition = "Intermittent";
  service.persistSession(service.getWorld(world.id), "field-researcher", entry);
  const restarted = new DesktopService({ appDataPath });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  assert.equal(restarted.session(world.id, "field-researcher").run.expedition.equipment["recording-device"].known_condition, "Intermittent");
  assert.equal(camera.holder, player);
});

test("LOCAL request does not transfer gear; physical handoff changes holder and costs modest time", () => {
  const { service, world } = fixture("q4-handoff"); reach(service, world);
  const entry = service.session(world.id, "field-researcher"); const camera = entry.run.expedition.equipment["recording-device"]; const peer = entry.run.expedition.team.members[1];
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const request = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Nora, hand me the camera.", target: peer.first_name });
  assert.equal(request.ok, true); assert.equal(camera.holder, "yb-field-player"); assert.match(request.result.public_reason, /remains with me/);
  const handoff = service.submitQ4Handoff({ world_id: world.id, item_id: "recording-device", target: peer.first_name });
  assert.equal(handoff.ok, true); assert.equal(camera.holder, peer.personnel_id); assert.equal(camera.location, "with teammate");
  const after = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(after.scene.location, before.scene.location); assert.equal(after.phase.phase_id, before.phase.phase_id); assert.equal(after.surface.expedition.clock.communication_ticks, before.surface.expedition.clock.communication_ticks + 2);
  const target = service.session(world.id, "field-researcher").run.aliases[Object.keys(service.session(world.id, "field-researcher").run.aliases)[0]];
  const blocked = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target });
  assert.equal(blocked.ok, false); assert.equal(blocked.error.code, "EQUIPMENT_NOT_ACCESSIBLE");
});

test("missing, damaged, and depleted gear constrain ACTION without regenerating", () => {
  const { service, world } = fixture("q4-equipment-capability"); reach(service, world);
  const entry = service.session(world.id, "field-researcher"); const instrument = entry.run.expedition.equipment["survey-instrument"];
  instrument.state = "damaged";
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "USE", target: "survey-instrument" }).error.code, "EQUIPMENT_UNAVAILABLE");
  instrument.state = "operational"; instrument.charges = 0;
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "USE", target: "survey-instrument" }).error.code, "EQUIPMENT_UNAVAILABLE");
  const itemId = instrument.id; instrument.state = "abandoned"; instrument.holder = "yb-field-peer-observer"; service.persistSession(service.getWorld(world.id), "field-researcher", entry);
  const next = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "q4-equipment-reissue" });
  assert.equal(next.ok, true); const nextEntry = service.session(world.id, "field-researcher"); const replacement = nextEntry.run.expedition.equipment["survey-instrument"];
  assert.notEqual(replacement.id, itemId); assert.equal(service.getWorld(world.id).q4_equipment[itemId].state, "abandoned");
});

test("equipment held by dead personnel remains there and player sees qualified condition", () => {
  const { service, world } = fixture("q4-equipment-death"); reach(service, world);
  const entry = service.session(world.id, "field-researcher"); const peer = entry.run.expedition.team.members[1]; const lamp = entry.run.expedition.equipment["field-light"];
  lamp.holder = peer.personnel_id; lamp.location = "with teammate";
  const canonical = service.getWorld(world.id); history.setCharacterStatus(canonical, { run_id: Object.keys(canonical.runs)[0], identity: peer.personnel_id, status: "dead", reason: "confirmed history" }); service.persistSession(canonical, "field-researcher", entry);
  const view = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const visible = view.q4.equipment.required.find((item) => item.label === "Battery field lamp");
  assert.equal(visible.holder, "Assigned teammate"); assert.equal(visible.location, "Known only by last contact"); assert.equal(visible.state, "Last observed operational");
  const next = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "q4-equipment-dead-reissue" });
  assert.equal(next.ok, true); const nextEntry = service.session(world.id, "field-researcher"); assert.notEqual(nextEntry.run.expedition.equipment["field-light"].id, lamp.id); assert.equal(service.getWorld(world.id).q4_equipment[lamp.id].holder, peer.personnel_id);
});

test("default field equipment stays within the period boundary", () => {
  assert.ok(Object.values(equipment.DEFINITIONS).every((item) => !/smartphone|led|touchscreen|bluetooth|wireless consumer|digital tablet/i.test(`${item.label} ${item.model}`)));
});
