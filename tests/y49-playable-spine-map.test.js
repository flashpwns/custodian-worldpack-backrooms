"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const spatial = require("../tools/spatial-runtime");
const q4Time = require("../tools/q4-time");

function fixture(seed = "playable-spine-map") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-spine-map-"));
  const service = new DesktopService({ appDataPath: root });
  const world = service.createWorld({ name: "ClearQ4est", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true });
  assert.equal(started.ok, true);
  return { root, service, world, started };
}

function phaseAction(service, world, action) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action });
  assert.equal(result.ok, true, `${action} should be accepted`);
  return result;
}

function reachRadio(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) phaseAction(service, world, action);
}

function reachField(service, world) {
  reachRadio(service, world);
  const checked = phaseAction(service, world, "RADIO_CHECK");
  assert.equal(checked.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  return phaseAction(service, world, "BEGIN_FIELD_OPERATION");
}

test("registered programs expose institutional availability without development copy", () => {
  const { service } = fixture("registry-copy");
  const modes = service.listModes().modes;
  assert.deepEqual(modes.map((mode) => [mode.program_name, mode.role, mode.availability]), [
    ["CLEAR-Q4", "Field Operations", "available"],
    ["LOST", "Survival", "unavailable"],
    ["BECK'S DESK", "Institutional Operations", "unavailable"],
    ["NULLZONE EXPOSURE", "Civilian Investigation", "unavailable"]
  ]);
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /Operational Records/);
  assert.match(renderer, /Authorized personnel may resume an existing operational record/);
  assert.doesNotMatch(renderer, /Playable now|Coming Soon|roadmap [234]|World Access \/ Personnel Entry/);
});

test("same-location coworkers authoritatively enable LOCAL and visually confirm equipment", () => {
  const { started } = fixture("proximity-equipment");
  const q4 = started.projection.q4;
  assert.equal(q4.channels.local.available, true);
  assert.deepEqual(q4.channels.local.targets, ["Nora", "Alex"]);
  assert.ok(q4.team.every((person) => person.contact_category === "LOCAL"));
  const coworkerGear = q4.equipment.required.filter((item) => ["Alex Morgan", "Nora Vale"].includes(item.holder));
  assert.equal(coworkerGear.length, 2);
  assert.ok(coworkerGear.every((item) => item.location === "carrying" && item.state === "Operational" && item.verification === "visually confirmed"));
});

test("separated personnel cannot remain within speaking range", () => {
  const { service, world } = fixture("separated-proximity");
  const entry = service.session(world.id, "field-researcher");
  entry.run.spatial.personnel_locations["yb-field-alex-morgan"] = "columned-corridor";
  entry.run.spatial.last_confirmed_personnel_positions["yb-field-alex-morgan"] = { location: "columned-corridor", at: 0, source: "visual" };
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const alex = projection.q4.team.find((member) => member.first_name === "Alex");
  assert.notEqual(alex.contact_category, "LOCAL");
  assert.equal(alex.local_eligible, false);
  assert.deepEqual(projection.q4.channels.local.targets, ["Nora"]);
});

test("radio check is a visible, persisted procedure before field departure", () => {
  const { root, service, world } = fixture("radio-procedure");
  reachRadio(service, world);
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.channels.standard.available, false);
  assert.equal(projection.q4.channels.standard.state, "establishing");
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Premature report." }).ok, false);
  const checked = phaseAction(service, world, "RADIO_CHECK");
  projection = checked.projection;
  assert.equal(projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(projection.q4.radio_check.completed, true);
  assert.equal(projection.q4.channels.standard.state, "available");
  assert.equal(projection.q4.channels.standard.available, true);
  assert.deepEqual(projection.q4.channels.standard.history.slice(-2).map((item) => item.speaker), ["YOU", "STANDARD"]);
  assert.match(projection.q4.channels.standard.history.at(-2).text, /3 personnel accounted for/);
  assert.match(projection.q4.channels.standard.history.at(-1).text, /contact established/);
  assert.match(surfaces.render(projection), /visible-radio-exchange[\s\S]*YOU[\s\S]*STANDARD/);
  service.shutdown();
  const resumed = new DesktopService({ appDataPath: root }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(resumed.projection.q4.radio_check.completed, true);
  assert.equal(resumed.projection.q4.channels.standard.state, "available");
});

test("field entry gives a concrete observation, truthful map, and canonical objectives", () => {
  const { service, world } = fixture("field-entry");
  const field = reachField(service, world).projection;
  assert.equal(field.q4.current_location.name, "Utility Room");
  assert.match(field.scene.narration, /utility room/i);
  assert.match(field.scene.narration, /fluorescent|corridor|passage/i);
  assert.doesNotMatch(field.scene.narration, /Nothing notable|utility-room|columned-corridor|\[object Object\]/);
  assert.equal(field.q4.map.nodes.some((node) => node.id === "utility-room" && node.current), true);
  assert.equal(field.q4.map.nodes.some((node) => node.id === "columned-corridor"), false);
  assert.equal(field.q4.map.unresolved_exits.some((exit) => /Columned Corridor/.test(exit.label)), true);
  assert.equal(new Set(field.q4.objectives.map((objective) => objective.label)).size, field.q4.objectives.length);
  assert.equal(new Set(field.q4.objectives.map((objective) => objective.label)).size, field.q4.objectives.length);
  const html = surfaces.render(field);
  assert.match(html, /Operational Map/);
  assert.match(html, /Observer record · discovered space only/);
  assert.doesNotMatch(html, /Next check-in:\s*0|Keep The Team Accounted For|Nothing notable/);
});

test("natural observation and movement alter spatial state, team state, time, and discovery", async () => {
  const { service, world } = fixture("movement");
  reachField(service, world);
  const oriented = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Orient myself." });
  assert.equal(oriented.ok, true);
  assert.match(oriented.result.scene.narration, /take stock of the utility room/i);
  assert.doesNotMatch(oriented.result.scene.narration, /utility-room|ceiling_fixture|\[object Object\]/);
  const beforeTime = oriented.projection.q4.operational_time;
  const moved = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Go west." });
  assert.equal(moved.ok, true);
  assert.equal(moved.projection.q4.current_location.name, "Columned Corridor");
  assert.match(moved.result.scene.narration, /lead the team west|arrive in the columned corridor/i);
  assert.notEqual(moved.projection.q4.operational_time, beforeTime);
  assert.ok(moved.projection.q4.team.every((member) => member.location === "columned-corridor"));
  assert.equal(moved.projection.q4.channels.local.available, true);
  assert.equal(moved.projection.q4.map.nodes.some((node) => node.id === "columned-corridor" && node.current), true);
  assert.equal(moved.projection.q4.map.route_history.at(-1).to, "columned-corridor");
  const invalid = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Go north." });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error.message, /No confirmed route leads north/);
  const unchanged = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(unchanged.q4.current_location.name, "Columned Corridor");
});

test("movement aliases cover passage, lower-level approach, return, and coworker checks", async () => {
  const { service, world } = fixture("movement-language");
  reachField(service, world);
  let result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Enter the open passage." });
  assert.equal(result.projection.q4.current_location.name, "Open Passage");
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Head toward the lower level." });
  assert.equal(result.projection.q4.current_location.name, "Lower-Level Transition");
  const blocked = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Enter Level 2." });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error.message, /blocked|not authorized/i);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Check on Alex." });
  assert.equal(result.ok, true);
  assert.match(result.result.scene.narration, /Alex is beside you/i);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Follow Nora." });
  assert.equal(result.ok, true);
  assert.match(result.result.scene.narration, /team remains together/i);
});

test("check-in schedule has explicit scheduled, due, overdue, complete, and unscheduled semantics", () => {
  const expedition = { clock: { interval: 0, check_in_due_at: null, check_in_overdue: false }, deviations: [] };
  assert.deepEqual(q4Time.status(expedition), { state: "not-scheduled", label: "NOT SCHEDULED", due_at: null, remaining: null });
  q4Time.schedule(expedition, 3);
  assert.equal(q4Time.status(expedition).label, "DUE IN 3 INTERVALS");
  q4Time.advance(expedition, 3);
  assert.equal(q4Time.status(expedition).label, "CHECK-IN DUE");
  q4Time.advance(expedition, 1);
  assert.equal(q4Time.status(expedition).label, "OVERDUE BY 1 INTERVAL");
  q4Time.complete(expedition);
  assert.match(q4Time.status(expedition).label, /^CHECK-IN COMPLETE/);
});

test("complete FIELD_OPERATION identity, assignment, equipment, dialogue, radio, location, and map survive restart", async () => {
  const { root, service, world } = fixture("field-persistence");
  reachField(service, world);
  const local = service.submitQ4Communication({ world_id: world.id, channel: "local", target: "Alex", text: "Stay with the route record, Alex." });
  assert.equal(local.ok, true);
  const moved = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move into the corridor." });
  assert.equal(moved.ok, true);
  const missionId = moved.projection.q4.mission_record.id;
  const holders = moved.projection.q4.equipment.required.map((item) => [item.id, item.holder]);
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const q4 = resumed.projection.q4;
  assert.equal(resumed.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(q4.player.name, "Jack Rocha");
  assert.equal(q4.team.find((member) => member.controlled).display_name, "Jack Rocha · YOU");
  assert.deepEqual(q4.team.filter((member) => !member.controlled).map((member) => member.display_name), ["Nora Vale", "Alex Morgan"]);
  assert.equal(q4.mission_record.id, missionId);
  assert.deepEqual(q4.equipment.required.map((item) => [item.id, item.holder]), holders);
  assert.equal(q4.channels.local.history.some((item) => /Stay with the route record/.test(item.text)), true);
  assert.equal(q4.radio_check.completed, true);
  assert.equal(q4.channels.standard.state, "available");
  assert.equal(q4.current_location.name, "Columned Corridor");
  assert.equal(q4.map.nodes.some((node) => node.id === "columned-corridor" && node.current), true);
  assert.ok(q4.team.every((member) => member.location === "columned-corridor"));
  assert.equal(q4.channels.local.available, true);
  assert.equal(q4.check_in.remaining, 2);
});

test("legacy session and run envelopes migrate into a usable spatial field record", () => {
  const { root, service, world } = fixture("legacy-spatial-migration");
  reachField(service, world);
  service.shutdown();
  const saveFile = service.sessionFile(world.id, "field-researcher");
  const legacy = JSON.parse(fs.readFileSync(saveFile, "utf8"));
  legacy.version = 2;
  legacy.schema = "yellow-beast-session@2";
  legacy.payload.version = "yellow-beast-save@v4";
  delete legacy.payload.spatial_pack_id;
  delete legacy.payload.spatial;
  fs.writeFileSync(saveFile, `${JSON.stringify(legacy, null, 2)}\n`);
  const resumed = new DesktopService({ appDataPath: root }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(resumed.projection.q4.player.name, "Jack Rocha");
  assert.equal(resumed.projection.q4.current_location.name, "Utility Room");
  assert.equal(resumed.projection.q4.map.nodes.some((node) => node.id === "utility-room" && node.current), true);
});

test("generic spatial runtime accepts a non-Clear-Q4 worldpack without embedded topology", () => {
  const runtimeSource = fs.readFileSync(path.join(__dirname, "../tools/spatial-runtime.js"), "utf8");
  assert.doesNotMatch(runtimeSource, /clear-q4|utility-room|columned-corridor|Nora|Alex/);
  const definition = {
    version: spatial.DEFINITION_VERSION,
    worldpack_id: "minimal-test-pack",
    initial_location: "alpha",
    field_entry_location: "alpha",
    phase_locations: { FIELD_OPERATION: "alpha" },
    locations: [
      { id: "alpha", name: "Alpha", type: "test-zone", short_description: "A first test zone.", environment: {}, landmarks: [], coordinates: { x: 10, y: 10, level: 0 }, entry_state: "mapped", hazards: [], tags: [] },
      { id: "beta", name: "Beta", type: "test-zone", short_description: "A second test zone.", environment: {}, landmarks: [], coordinates: { x: 80, y: 10, level: 0 }, entry_state: "unmapped", hazards: [], tags: [] }
    ],
    connections: [{ id: "alpha-beta", from: "alpha", to: "beta", direction: "east", reverse_direction: "west", relationship: "test route", transition: "You move east.", reverse_transition: "You move west.", requirements: [], lock_state: "open", hazard_state: "clear", visibility: "visible", discovery: "on-traversal", bidirectional: true, aliases: ["beta"] }],
    mission_markers: []
  };
  assert.equal(spatial.validateDefinition(definition), true);
  const state = spatial.createState(definition, { player: "player", personnel: ["peer"], phase: "FIELD_OPERATION" });
  assert.equal(spatial.project(state, definition).nodes.some((node) => node.id === "beta"), false);
  const moved = spatial.move(state, definition, "east", { player: "player", personnel: ["peer"], personnel_records: [{ id: "peer", first_name: "Peer" }] });
  assert.equal(moved.ok, true);
  assert.equal(state.player_location, "beta");
  assert.equal(state.personnel_locations.peer, "beta");
  assert.equal(spatial.project(state, definition).nodes.some((node) => node.id === "beta"), true);
});
