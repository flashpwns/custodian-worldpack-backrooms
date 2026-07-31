"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const phases = require("../tools/mode-phases");
const convergence = require("../tools/immersive-convergence");
const { DesktopService, MODES } = require("../desktop/service");
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-immersive-")); return { root, service: new DesktopService({ appDataPath: root }) }; }

test("all immersive modes project one canonical world without cross-mode presentation leakage", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Convergence", seed: "yb28-convergence" }).world;
  const identities = [];
  for (const { id } of MODES) {
    const started = service.startSession({ world_id: world.id, mode: id, seed: `mode-${id}` });
    assert.equal(started.ok, true, id);
    identities.push(convergence.verifyProjection(started.projection));
    assert.equal(started.projection.world.id, world.id);
  }
  assert.equal(new Set(identities.map((item) => item.world_id)).size, 1);
  assert.equal(new Set(identities.map((item) => item.observer)).size, 4);
});

test("physical history is shared while private labels and institutional knowledge are not", () => {
  const world = history.createWorld({ seed: "yb28-physical" });
  const run = history.beginRun(world, { profile: "lost", scenario: "fixture", seed: "fixture" });
  const region_id = "region-fixture"; const space_id = "space-fixture";
  world.regions[region_id] = { id: region_id, generator_version: history.GENERATOR_V2, region_seed: "fixture", baseline_state: { version: history.GENERATOR_V2, nodes: { [space_id]: {} }, edges: {} }, state: { version: history.GENERATOR_V2, nodes: { [space_id]: {} }, edges: {} }, discovery: [], provenance: {} };
  const bridge = convergence.physicalBridge(world, history, { run_id: run, region_id, space_id, type: "keys" });
  assert.equal(world.artifacts[bridge.artifact_id].type, "keys");
  assert.equal(Object.keys(world.knowledge.institutional.records).length, 0, "seeing a physical marker never writes institutional knowledge");
  assert.equal(world.civilian, undefined, "physical evidence does not create a civilian archive or label");
});

test("phase rules remain one noncanonical framework and guided preference changes no world truth", () => {
  const before = history.createWorld({ seed: "yb28-guided" }); const after = structuredClone(before);
  for (const mode of Object.keys(convergence.PROFILES)) {
    const on = phases.createPhase({ mode, guided: true }); const off = phases.createPhase({ mode, guided: false });
    assert.equal(on.phase_id, off.phase_id); assert.notEqual(on.tutorial_context.enabled, off.tutorial_context.enabled);
  }
  assert.deepEqual(after, before);
  assert.equal(phases.transition(phases.createPhase({ mode: "field-researcher" }), "FIELD_OPERATION", { guard: false }).ok, false);
});

test("sessions and their observer projections resume without cross-world cache reuse", () => {
  const { root, service } = fixture(); const one = service.createWorld({ name: "One", seed: "yb28-one" }).world; const two = service.createWorld({ name: "Two", seed: "yb28-two" }).world;
  for (const mode of MODES.map(({ id }) => id)) assert.equal(service.startSession({ world_id: one.id, mode, seed: `one-${mode}` }).ok, true);
  const resumed = new DesktopService({ appDataPath: root });
  for (const mode of MODES.map(({ id }) => id)) { const result = resumed.resumeSession({ world_id: one.id, mode }); assert.equal(result.ok, true); assert.equal(result.projection.world.id, one.id); }
  assert.equal(resumed.getGameplayProjection({ world_id: two.id, mode: "lost" }).ok, false);
});
