"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const objects = require("../tools/object-runtime");
const surfaces = require("../desktop/renderer/surfaces");

const read = (relative) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"));
const clearInteractions = read("data/worldpacks/clear-q4/interactions.json");
const clearSpatial = read("data/worldpacks/clear-q4/spatial.json");

function fixture(seed = "structured-interactions") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-structured-interactions-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Structured interaction acceptance", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true }).ok, true);
  return { appDataPath, service, world };
}

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""}: ${result.error?.message ?? "must succeed"}`);
  return result;
}

function reachField(service, world, { markerKit = true } = {}) {
  action(service, world, "READY");
  if (markerKit) assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) action(service, world, verb);
  return service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
}

function minimalDefinition() {
  return {
    version: objects.DEFINITION_VERSION,
    worldpack_id: "minimal-object-pack",
    objects: [{
      id: "sample-panel",
      display_name: "sample panel",
      aliases: ["panel"],
      location: "alpha",
      object_type: "panel",
      initial_state: { condition: "closed", open: false, active: null, intact: true, marked: false, moved: false, holder: null, container: null, custom: {} },
      visible_properties: [{ id: "visible-cover", text: "The cover is visible.", reveal_by: ["inspect"] }],
      hidden_properties: [{ id: "hidden-latch", text: "The latch is dry.", reveal_by: ["inspect"] }],
      affordances: [
        { type: "inspect", label: "Inspect panel", time_cost: 0, result: "The panel is visible." },
        { type: "open", label: "Open panel", time_cost: 1, result: "The panel opens.", requirements: { state: [{ path: "open", equals: false, failure: "The panel is already open." }] }, mutations: [{ path: "open", value: true }, { path: "condition", value: "open" }] }
      ],
      rejections: { move: "The panel is fixed in place." },
      observation_text_by_condition: [{ when: [{ path: "open", equals: true }], text: "The panel is open." }, { default: true, text: "The panel is closed." }],
      inspection_text_by_condition: [{ when: [{ path: "open", equals: true }], text: "The open panel is empty." }, { default: true, text: "The dry latch is visible." }],
      hazard_hooks: [],
      persistence: "persistent"
    }],
    objective_predicates: []
  };
}

const minimalSpatial = {
  version: "yellow-beast-spatial-worldpack@v1",
  worldpack_id: "minimal-object-pack",
  initial_location: "alpha",
  field_entry_location: "alpha",
  phase_locations: { FIELD_OPERATION: "alpha" },
  locations: [{ id: "alpha", name: "Alpha", type: "test", short_description: "A test room.", environment: {}, landmarks: [], coordinates: { x: 0, y: 0, level: 0 } }],
  connections: []
};

test("generic interaction definitions validate IDs, locations, affordances, and a second worldpack", () => {
  assert.equal(objects.validateDefinition(clearInteractions, clearSpatial), true);
  assert.equal(objects.validateDefinition(minimalDefinition(), minimalSpatial), true);
  const source = fs.readFileSync(path.join(__dirname, "../tools/object-runtime.js"), "utf8");
  assert.doesNotMatch(source, /clear-q4|utility-room|fluorescent fixture|Nora|Alex/i);

  const duplicate = minimalDefinition(); duplicate.objects.push(structuredClone(duplicate.objects[0]));
  assert.throws(() => objects.validateDefinition(duplicate, minimalSpatial), /duplicate interaction object id/);
  const unresolved = minimalDefinition(); unresolved.objects[0].location = "missing";
  assert.throws(() => objects.validateDefinition(unresolved, minimalSpatial), /location does not resolve/);
  const invalid = minimalDefinition(); invalid.objects[0].affordances[1].type = "solve-everything";
  assert.throws(() => objects.validateDefinition(invalid, minimalSpatial), /invalid interaction affordance/);
});

test("visibility and observer knowledge expose current objects without hidden state or internal references", () => {
  const { service, world } = fixture("object-visibility");
  const field = reachField(service, world);
  assert.deepEqual(field.q4.interactables.map((item) => item.name), ["fluorescent fixture", "scuffed floor", "service panel"]);
  assert.equal(field.q4.interactables.some((item) => item.name === "return marker"), false);
  const fixtureView = field.q4.interactables.find((item) => item.name === "fluorescent fixture");
  assert.equal(fixtureView.known_properties.some((text) => /stable under direct observation/i.test(text)), false);
  const publicObjects = JSON.stringify(field.q4.interactables);
  assert.doesNotMatch(publicObjects, /utility-fluorescent-fixture|utility-route-surface|threshold-return-marker|output-stability|survey_tagged|bracket_alignment/);
  assert.match(surfaces.render(field), /Visible objects[\s\S]*fluorescent fixture[\s\S]*scuffed floor[\s\S]*service panel/);
});

test("inspection returns condition prose, reveals declared facts, and leaves unrelated conditions unchanged", () => {
  const { service, world } = fixture("object-inspection"); reachField(service, world);
  const entry = service.session(world.id, "field-researcher");
  const floorBefore = structuredClone(entry.run.object_state.objects["utility-route-surface"]);
  const first = action(service, world, "INSPECT", "fluorescent fixture");
  assert.match(first.result.public_reason, /housing is intact|output is steady/i);
  assert.equal(first.projection.q4.interactables.find((item) => item.name === "fluorescent fixture").known_properties.some((text) => /output remains stable/i.test(text)), true);
  assert.equal(first.projection.q4.objectives.find((item) => item.label === "Capture mission evidence").state, "active");
  assert.equal(first.projection.q4.objectives.find((item) => item.label === "Verify the return route").state, "active");
  assert.deepEqual(entry.run.object_state.objects["utility-route-surface"], floorBefore);
  const repeated = action(service, world, "INSPECT", "fluorescent fixture");
  assert.equal(repeated.result.public_reason, first.result.public_reason);
});

test("valid mutations, repeated-state rejection, unsupported actions, and ambiguity are grounded", () => {
  const { service, world } = fixture("object-mutation"); reachField(service, world);
  action(service, world, "INSPECT", "service panel");
  const opened = action(service, world, "OPEN", "service panel");
  assert.match(opened.projection.q4.field_observation, /panel stands open/i);
  const entry = service.session(world.id, "field-researcher");
  const beforeRepeat = structuredClone(entry.run.object_state);
  const repeated = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "OPEN", target: "service panel" });
  assert.equal(repeated.ok, false); assert.match(repeated.error.message, /already open/i);
  assert.deepEqual(entry.run.object_state, beforeRepeat);
  const fixed = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "fluorescent fixture" });
  assert.equal(fixed.ok, false); assert.match(fixed.error.message, /fixed to the ceiling/i);

  const ambiguous = minimalDefinition();
  const second = structuredClone(ambiguous.objects[0]); second.id = "other-panel"; second.display_name = "other panel"; ambiguous.objects.push(second);
  const state = objects.createState(ambiguous); objects.observeLocation(state, ambiguous, { observer: "player", location: "alpha" });
  assert.match(objects.inspection(state, ambiguous, { observer: "player", location: "alpha", target: "panel" }).reason, /More than one visible object/);
});

test("nearby team-held equipment permits declared team use and consumes the actual item", () => {
  const { service, world } = fixture("team-tool-use"); reachField(service, world);
  const entry = service.session(world.id, "field-researcher");
  const instrument = entry.run.expedition.equipment["survey-instrument"];
  const holder = instrument.holder; const before = instrument.charges;
  const holderName = entry.run.expedition.team.members.find((member) => member.personnel_id === holder).first_name;
  assert.notEqual(holder, entry.run.session.startup.player.observer_id);
  action(service, world, "INSPECT", "fluorescent fixture");
  const tested = action(service, world, "TEST", "fluorescent fixture");
  assert.match(tested.result.public_reason, new RegExp(`${holderName} holds the survey instrument`, "i"));
  assert.equal(instrument.holder, holder);
  assert.equal(instrument.charges, before - 1);
  assert.equal(instrument.state, "depleted");
  assert.equal(tested.projection.q4.equipment.required.find((item) => item.label === "Portable survey instrument").state, "Depleted");
});

test("absent, separated, damaged, and depleted equipment block without mutation", () => {
  for (const mode of ["absent", "separated", "damaged", "depleted"]) {
    const { service, world } = fixture(`tool-block-${mode}`); reachField(service, world);
    const entry = service.session(world.id, "field-researcher"); const expedition = entry.run.expedition; const instrument = expedition.equipment["survey-instrument"];
    action(service, world, "INSPECT", "fluorescent fixture");
    if (mode === "absent") delete expedition.equipment["survey-instrument"];
    if (mode === "separated") { entry.run.spatial.team_behavior[instrument.holder] = "independent"; entry.run.spatial.personnel_locations[instrument.holder] = "threshold-side-entry"; }
    if (mode === "damaged") instrument.state = "damaged";
    if (mode === "depleted") { instrument.state = "depleted"; instrument.charges = 0; }
    const before = structuredClone(entry.run.object_state.objects["utility-fluorescent-fixture"]);
    const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "TEST", target: "fluorescent fixture" });
    assert.equal(result.ok, false, mode);
    assert.match(result.error.code, /EQUIPMENT/);
    assert.deepEqual(entry.run.object_state.objects["utility-fluorescent-fixture"], before);
  }
});

test("evidence is object-, location-, observer-, device-, condition-, and time-specific without duplicates", () => {
  const { service, world } = fixture("object-evidence"); reachField(service, world);
  const entry = service.session(world.id, "field-researcher"); const camera = entry.run.expedition.equipment["recording-device"]; const before = camera.charges;
  action(service, world, "INSPECT", "scuffed floor");
  action(service, world, "PHOTOGRAPH", "scuffed floor");
  const evidence = entry.run.expedition.evidence[0];
  assert.equal(evidence.source_object, "utility-route-surface");
  assert.equal(evidence.source_location, "utility-room");
  assert.equal(evidence.source_location_name, "Utility Room");
  assert.equal(evidence.capturing_observer, camera.holder);
  assert.equal(evidence.device_id, camera.id);
  assert.equal(evidence.method, "35mm photograph");
  assert.equal(evidence.object_condition.marked, false);
  assert.equal(evidence.available_to_player, true);
  assert.equal(evidence.available_to_standard, false);
  assert.equal(evidence.reporting_state, "unreported");
  assert.equal(camera.charges, before - 1);
  const repeated = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PHOTOGRAPH", target: "scuffed floor" });
  assert.equal(repeated.ok, false); assert.equal(repeated.error.code, "EVIDENCE_REDUNDANT");
  assert.equal(entry.run.expedition.evidence.length, 1); assert.equal(camera.charges, before - 1);
  const cameraHolder = entry.run.expedition.team.members.find((member) => member.personnel_id === camera.holder).display_name;
  assert.equal(service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.evidence[0].observer, cameraHolder);
  const reported = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Reporting the scuffed-floor photograph and its evidence condition." });
  assert.equal(reported.ok, true);
  assert.equal(evidence.available_to_standard, true);
  assert.equal(evidence.reporting_state, "reported-to-standard");
});

test("changed object conditions produce a distinct later record while objectives remain nonduplicative", () => {
  const { service, world } = fixture("changed-evidence"); reachField(service, world);
  action(service, world, "INSPECT", "scuffed floor");
  action(service, world, "PHOTOGRAPH", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  action(service, world, "PHOTOGRAPH", "scuffed floor");
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.expedition.evidence.length, 2);
  assert.notEqual(entry.run.expedition.evidence[0].id, entry.run.expedition.evidence[1].id);
  assert.notEqual(entry.run.expedition.evidence[0].condition_fingerprint, entry.run.expedition.evidence[1].condition_fingerprint);
  assert.deepEqual(entry.run.expedition.evidence.map((item) => item.object_condition.marked), [false, true]);
  const evidenceObjective = entry.run.expedition.objectives["capture-field-evidence"];
  assert.equal(evidenceObjective.state, "satisfied");
  assert.equal(evidenceObjective.history.filter((item) => item.to === "satisfied").length, 1);
});

test("route verification derives from the authored marker state", () => {
  const { service, world } = fixture("route-verification"); reachField(service, world);
  action(service, world, "MOVE", "back");
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.current_location.name, "Threshold-Side Entry");
  assert.equal(projection.q4.objectives.find((item) => item.label === "Verify the return route").state, "active");
  action(service, world, "INSPECT", "return marker");
  projection = action(service, world, "SECURE", "return marker").projection;
  assert.equal(projection.q4.objectives.find((item) => item.label === "Verify the return route").state, "satisfied");
  assert.match(projection.q4.field_observation, /intact and secured/i);
});

test("natural language selects only authored visible interactions and returns in-world failures", async () => {
  const { service, world } = fixture("natural-objects"); reachField(service, world);
  let result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Inspect the fluorescent fixture." });
  assert.equal(result.ok, true); assert.match(result.result.public_reason, /housing is intact/i);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Photograph the scuffs." });
  assert.equal(result.ok, true); assert.match(result.result.public_reason, /photographs the crossing scuffs/i);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Inspect the scuffs." }); assert.equal(result.ok, true);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Mark this route." });
  assert.equal(result.ok, true); assert.match(result.result.public_reason, /numbered survey tab/i);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Inspect the panel." }); assert.equal(result.ok, true);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Open the panel." }); assert.equal(result.ok, true);
  result = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move the fluorescent fixture aside." });
  assert.equal(result.ok, false); assert.match(result.error.message, /fixed to the ceiling/i);
  assert.doesNotMatch(result.error.message, /affordance|parser|object[_-]state|utility-fluorescent/i);
});

test("movement, return, shutdown, and resume preserve the entire interaction loop coherently", async () => {
  const { appDataPath, service, world } = fixture("interaction-persistence");
  const initial = reachField(service, world);
  assert.equal(initial.q4.interactables.length, 3);
  action(service, world, "INSPECT", "fluorescent fixture");
  action(service, world, "TEST", "fluorescent fixture");
  action(service, world, "INSPECT", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  action(service, world, "INSPECT", "service panel");
  action(service, world, "OPEN", "service panel");
  const moved = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move into the corridor." }); assert.equal(moved.ok, true);
  const returned = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Return east to the utility room." }); assert.equal(returned.ok, true);
  assert.match(returned.projection.q4.field_observation, /tagged in the survey record/);
  assert.match(returned.projection.q4.field_observation, /route marker you placed/);
  assert.match(returned.projection.q4.field_observation, /panel stands open/);
  const entry = service.session(world.id, "field-researcher");
  const before = {
    object_state: structuredClone(entry.run.object_state),
    evidence: structuredClone(entry.run.expedition.evidence),
    objectives: structuredClone(entry.run.expedition.objectives),
    equipment: structuredClone(entry.run.expedition.equipment),
    location: returned.projection.q4.current_location,
    map: returned.projection.q4.map,
    team: returned.projection.q4.team,
    radio: returned.projection.q4.channels.standard,
    time: returned.projection.q4.operational_time
  };
  service.shutdown();
  const restarted = new DesktopService({ appDataPath });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); const resumedEntry = restarted.session(world.id, "field-researcher");
  assert.deepEqual(resumedEntry.run.object_state, before.object_state);
  assert.deepEqual(resumedEntry.run.expedition.evidence, before.evidence);
  assert.deepEqual(resumedEntry.run.expedition.objectives, before.objectives);
  assert.deepEqual(resumedEntry.run.expedition.equipment, before.equipment);
  assert.deepEqual(resumed.projection.q4.current_location, before.location);
  assert.deepEqual(resumed.projection.q4.map, before.map);
  assert.deepEqual(resumed.projection.q4.team, before.team);
  assert.deepEqual(resumed.projection.q4.channels.standard, before.radio);
  assert.equal(resumed.projection.q4.operational_time, before.time);
  assert.match(resumed.projection.q4.field_observation, /route marker you placed/);
});

test("v5 run and v3 desktop saves migrate object state without losing spatial continuity", () => {
  const { appDataPath, service, world } = fixture("object-save-migration"); reachField(service, world); service.shutdown();
  const file = service.sessionFile(world.id, "field-researcher"); const legacy = JSON.parse(fs.readFileSync(file, "utf8"));
  legacy.version = 3; legacy.schema = "yellow-beast-session@3"; legacy.payload.version = "yellow-beast-save@v5"; delete legacy.payload.object_state;
  fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
  const resumed = new DesktopService({ appDataPath }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.q4.current_location.name, "Utility Room");
  assert.deepEqual(resumed.projection.q4.interactables.map((item) => item.name), ["fluorescent fixture", "scuffed floor", "service panel"]);
  assert.equal(new Set(resumed.projection.q4.objectives.map((item) => item.label)).size, resumed.projection.q4.objectives.length);
});
