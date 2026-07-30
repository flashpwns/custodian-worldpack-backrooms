"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const v1 = require("../tools/procedural-complex");
const v2 = require("../tools/procedural-complex-v2");
const { startRun, look, saveRun, resumeRun } = require("../tools/run-bootstrap");

function tempWorld() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb22-persistence-")), "world.json"); }
function mixedWorld() {
  const world = history.createWorld({ seed: "yb22-mixed" });
  const run = history.beginRun(world, { profile: "lost", scenario: "persistence", seed: "yb22" });
  const oldRegion = v1.initialize({ seed: "legacy-region", observer: "old-observer" });
  const newRegion = v2.materialize(v2.initialize({ seed: "new-region", observer: "new-observer", policy: "moderate" }));
  return { world, run, oldRegion, newRegion, oldId: history.promoteRegion(world, run, oldRegion), newId: history.promoteRegion(world, run, newRegion) };
}

test("v1 and v2 persistent regions coexist without reinterpretation", () => {
  const fixture = mixedWorld(); const file = tempWorld();
  const beforeV1 = structuredClone(fixture.world.regions[fixture.oldId].state);
  history.saveWorld(file, fixture.world); const restored = history.loadWorld(file);
  assert.equal(restored.regions[fixture.oldId].generator_version, v1.VERSION);
  assert.equal(restored.regions[fixture.newId].generator_version, v2.VERSION);
  assert.deepEqual(restored.regions[fixture.oldId].state, beforeV1);
  assert.equal(restored.regions[fixture.oldId].state.region_traits, undefined);
  assert.equal(restored.regions[fixture.oldId].state.landmarks, undefined);
  assert.deepEqual(history.restoreRegion(restored, fixture.newId).state, restored.regions[fixture.newId].state);
});

test("v2 mutations append history, rebuild deterministically, and are idempotent", () => {
  const fixture = mixedWorld(); const space = Object.keys(fixture.newRegion.nodes)[0];
  const originalObject = fixture.world.regions[fixture.newId].state.objects[space][0];
  const first = history.mutateRegion(fixture.world, { run_id: fixture.run, region_id: fixture.newId, space_id: space, target: "lighting", value: "off" });
  const duplicate = history.mutateRegion(fixture.world, { run_id: fixture.run, region_id: fixture.newId, space_id: space, target: "lighting", value: "off" });
  const removed = history.mutateRegion(fixture.world, { run_id: fixture.run, region_id: fixture.newId, space_id: space, target_type: "object", target: originalObject.id, operation: "remove", value: null });
  const added = history.mutateRegion(fixture.world, { run_id: fixture.run, region_id: fixture.newId, space_id: space, target_type: "object", target: "survey-marker", operation: "add", value: { id: "survey-marker", kind: "survey-marker", provenance: "pack-original" } });
  assert.equal(first.ok, true); assert.equal(duplicate.idempotent, true);
  assert.equal(removed.ok, true); assert.equal(added.ok, true);
  assert.equal(fixture.world.events.filter((entry) => entry.type === "region.mutated").length, 3);
  assert.equal(fixture.world.regions[fixture.newId].state.nodes[space].persistent.lighting, "off");
  assert.deepEqual(fixture.world.regions[fixture.newId].state.objects[space].map((object) => object.id), ["survey-marker"]);
  assert.deepEqual(history.rebuildRegion(fixture.world, fixture.newId), fixture.world.regions[fixture.newId].state);
  assert.equal(history.mutateRegion(fixture.world, { run_id: fixture.run, region_id: fixture.oldId, space_id: Object.keys(fixture.oldRegion.nodes)[0], target: "lighting", value: "off" }).code, "REGION_VERSION_UNSUPPORTED");
  const file = tempWorld(); history.saveWorld(file, fixture.world); const restored = history.loadWorld(file);
  assert.deepEqual(history.rebuildRegion(restored, fixture.newId), restored.regions[fixture.newId].state);
});

test("unsupported and corrupt versioned region persistence fails safely", () => {
  assert.throws(() => history.generatorVersion({ generator_version: "yellow-beast-complex-generator@v999" }), { code: "GENERATOR_VERSION_UNSUPPORTED" });
  const fixture = mixedWorld(); fixture.world.regions[fixture.newId].state.edges.bad = { id: "bad", from: "missing", to: null };
  const file = tempWorld(); history.saveWorld(file, fixture.world);
  assert.throws(() => history.loadWorld(file), { code: "REGION_GRAPH_INVALID" });
});

test("an active v2 procedural run resumes through the version dispatcher", () => {
  const started = startRun({ profile: "field-researcher", scenario: "procedural-survey", seed: "v2-active", generator_version: v2.VERSION });
  assert.equal(started.ok, true); assert.equal(started.run.procedural.version, v2.VERSION);
  const saved = saveRun(started.run); const resumed = resumeRun(saved);
  assert.equal(resumed.ok, true); assert.equal(resumed.run.procedural.version, v2.VERSION);
  assert.deepEqual(look(resumed.run).view, look(started.run).view);
});
