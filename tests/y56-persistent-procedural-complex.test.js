"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const spatial = require("../tools/spatial-runtime");
const survey = require("../tools/survey-frontier");
const q4 = require("../tools/q4-experience");
const { DesktopService } = require("../desktop/service");

const definition = () => bootstrap.spatialDefinitionFor("clear-q4");
function expansionState(seed = "persistent-complex") {
  const state = spatial.createState(definition(), { player: "player", personnel: ["teammate"], phase: "FIELD_OPERATION", world_seed: seed });
  state.player_location = "records-annex"; state.personnel_locations.player = "records-annex"; state.personnel_locations.teammate = "records-annex";
  return state;
}
function reachAnnex(run) { bootstrap.enterSpatialField(run); for (const target of ["open passage", "records annex"]) assert.equal(bootstrap.act(run, "MOVE", target).ok, true); }
function followGeneratedPath(run) { for (const location of run.spatial.generated_locations) assert.equal(bootstrap.act(run, "MOVE", location.name).ok, true); }

test("identical world seed and request state produce stable IDs, topology, archetypes, and metadata", () => {
  const a = expansionState("same-seed"); const b = expansionState("same-seed");
  assert.equal(spatial.expand(a, definition()).ok, true); assert.equal(spatial.expand(b, definition()).ok, true);
  assert.deepEqual(a.generated_locations, b.generated_locations); assert.deepEqual(a.generated_connections, b.generated_connections); assert.deepEqual(a.generation, b.generation);
  const other = expansionState("different-seed"); assert.equal(spatial.expand(other, definition()).ok, true); assert.notDeepEqual(other.generated_locations, a.generated_locations);
});

test("generation is bounded and a failed request leaves prior canonical topology untouched", () => {
  const state = expansionState("bounded"); const before = structuredClone(state);
  assert.equal(spatial.expand(state, definition(), "not-a-frontier").ok, false); assert.deepEqual(state.generated_locations, before.generated_locations); assert.deepEqual(state.generated_connections, before.generated_connections);
  for (let index = 0; index < 12; index += 1) { const result = spatial.expand(state, definition()); assert.equal(result.ok, true); state.player_location = result.location.id; }
  assert.equal(spatial.expand(state, definition()).code, "GENERATION_BOUND_REACHED"); assert.equal(state.generated_locations.length, 12); assert.equal(spatial.validateState(state, definition()).length, 0);
});

test("objective generation does not grant player, teammate, or Standard knowledge", () => {
  const state = expansionState("knowledge"); const epistemic = survey.create(definition(), { player: "player", personnel: ["teammate"], spatial: state });
  const expanded = spatial.expand(state, definition()); assert.equal(expanded.ok, true); const topology = spatial.canonicalDefinition(state, definition());
  assert.equal(survey.map(epistemic, topology, "player").nodes.some((item) => item.id === expanded.location.id), false); assert.equal(survey.map(epistemic, topology, "teammate").nodes.some((item) => item.id === expanded.location.id), false); assert.equal(survey.standardMap(epistemic, topology).nodes.some((item) => item.id === expanded.location.id), false);
  survey.observe(epistemic, topology, "teammate", expanded.location.id, { at: 3 }); assert.equal(survey.map(epistemic, topology, "teammate").nodes.some((item) => item.id === expanded.location.id), true); assert.equal(survey.map(epistemic, topology, "player").nodes.some((item) => item.id === expanded.location.id), false);
  survey.share(epistemic, "teammate", "player", { at: 4 }); assert.equal(survey.map(epistemic, topology, "player").nodes.some((item) => item.id === expanded.location.id), true); assert.equal(survey.standardMap(epistemic, topology).nodes.some((item) => item.id === expanded.location.id), false);
});

test("save/load and three operations preserve old geography, marker state, and fixed Threshold entry", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yb-pass12b-")); const file = path.join(temp, "world.json");
  try {
    let world = history.createWorld({ seed: "three-operation-world" }); const operationA = bootstrap.startRun({ profile: "field-researcher", seed: "operation-a", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run;
    reachAnnex(operationA); assert.equal(bootstrap.act(operationA, "EXPAND").ok, true); const firstIds = operationA.spatial.generated_locations.map((item) => item.id); const marker = bootstrap.act(operationA, "MARK").result.marker;
    world.q4_geography = spatial.canonicalSnapshot(operationA.spatial); world.q4_survey_frontier = structuredClone(operationA.survey_frontier); history.saveWorld(file, world); world = history.loadWorld(file);
    const operationB = bootstrap.startRun({ profile: "field-researcher", seed: "operation-b", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run;
    assert.equal(operationB.spatial.player_location, definition().initial_location); reachAnnex(operationB); followGeneratedPath(operationB); assert.equal(operationB.spatial.route_markers.some((item) => item.id === marker.id), true); assert.equal(q4.presentation(operationB, { phase_id: "FIELD_OPERATION" }, null, world).map.nodes.some((node) => node.mission_markers?.some((item) => item.label === "Survey marker")), true); assert.equal(bootstrap.act(operationB, "EXPAND").ok, true); assert.deepEqual(operationB.spatial.generated_locations.slice(0, firstIds.length).map((item) => item.id), firstIds);
    const secondIds = operationB.spatial.generated_locations.map((item) => item.id); world.q4_geography = spatial.canonicalSnapshot(operationB.spatial); world.q4_survey_frontier = structuredClone(operationB.survey_frontier); history.saveWorld(file, world); world = history.loadWorld(file);
    const operationC = bootstrap.startRun({ profile: "field-researcher", seed: "operation-c", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run;
    assert.deepEqual(operationC.spatial.generated_locations.map((item) => item.id), secondIds); assert.equal(definition().phase_locations.THRESHOLD, "threshold-room"); assert.equal(definition().procedural_expansion.fixed_threshold_anchor, "threshold-side-entry"); assert.equal(definition().field_entry_location, "utility-room"); reachAnnex(operationC); followGeneratedPath(operationC); assert.equal(bootstrap.act(operationC, "EXPAND").ok, true); assert.deepEqual(operationC.spatial.generated_locations.slice(0, secondIds.length).map((item) => item.id), secondIds);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("Clear-Q4 interpretation context is specific, ordered, and observer-safe", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yb-context-"));
  try {
    const service = new DesktopService({ appDataPath: temp }); const world = history.createWorld({ seed: "context-world" }); const run = bootstrap.startRun({ profile: "field-researcher", seed: "context-op", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run; const entry = { kind: "bootstrap", run, phase: { phase_id: "FIELD_OPERATION", mode_id: "field-researcher" } };
    reachAnnex(run); const hidden = spatial.expand(run.spatial, definition()).location; const context = service.q4InterpretationContext(world, entry); const serialized = JSON.stringify(context);
    assert.deepEqual(context.authority_contract.order, ["canonical-world", "simulation", "institution", "observation", "presentation"]); assert.equal(context.worldpack_authority.id, "clear-q4"); assert.ok(context.assignment.objective); assert.ok(context.observer.name); assert.ok(context.personnel_boundaries.co_present.length > 0); assert.ok(context.institution);
    assert.equal(serialized.includes(hidden.id), false); assert.equal(serialized.includes(hidden.name), false); assert.equal(serialized.includes("generated_locations"), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("unsupported interpreted intent records no manufactured consequence", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yb-interpret-"));
  try {
    const service = new DesktopService({ appDataPath: temp }); const world = history.createWorld({ seed: "interpret-world" }); const run = bootstrap.startRun({ profile: "field-researcher", seed: "interpret-op", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run; const entry = { kind: "bootstrap", run, phase: { phase_id: "FIELD_OPERATION", mode_id: "field-researcher" } }; bootstrap.enterSpatialField(run); const before = spatial.canonicalSnapshot(run.spatial);
    const resolved = service.resolveQ4Attempt({ world_id: world.world_id, mode: "field-researcher", entry, plan: { intent: { goals: ["push through the solid wall"], methods: [] }, steps: [{ id: "step-1", attempted_behavior: "push through the solid wall" }] } });
    assert.equal(resolved.result.accepted, false); assert.match(resolved.result.observer_safe_summary, /Nothing in the current Utility Room supports/); assert.deepEqual(spatial.canonicalSnapshot(run.spatial), before); assert.match(entry.run.interpretation_state.unresolved_intent, /push through the solid wall/); assert.match(bootstrap.resumeRun(bootstrap.saveRun(run), { world, spatial_worldpack: "clear-q4", phase: "FIELD_OPERATION" }).run.interpretation_state.unresolved_intent, /push through the solid wall/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("desktop hierarchy keeps observation, action, communication, and resolution distinct", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8"); const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  assert.match(renderer, /Current scene resolution/); assert.match(renderer, />ACTION</); assert.match(renderer, /LOCAL and STANDARD communication remain separate/); assert.match(renderer, /CURRENT LOCATION/); assert.match(renderer, /OBSERVED LOCATION/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 310px/); assert.match(css, /operations-main>\.natural-action\{grid-row:3/); assert.match(css, /operations-main>\.mode-surface\{grid-row:2/); assert.match(css, /q4-communications-dock/);
});
