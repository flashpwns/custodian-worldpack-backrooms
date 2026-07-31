"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const environment = require("../tools/environment-world");
const v2 = require("../tools/procedural-complex-v2");
const history = require("../tools/world-history");

test("environment vocabulary is claim-traceable or explicitly mundane procedural fill", () => {
  const report = environment.report();
  assert.ok(environment.VOCABULARY.every((item) => item.claim_id || item.provenance === "generic-procedural"));
  assert.equal(report.canon_gravity.untraced_distinctive, 0);
  assert.equal(report.invariants["untraced newly admitted distinctive environment content"], 0);
  assert.equal(report.invariants["single-context canon overgeneralization"], 0);
});

test("same seed composes one bounded grammar and source-local features stay bounded", () => {
  const a = v2.materialize(v2.initialize({ seed: "environment-seed", observer: "field", policy: "deep" }));
  const b = v2.materialize(v2.initialize({ seed: "environment-seed", observer: "field", policy: "deep" }));
  assert.deepEqual(a, b);
  const openingSpaces = Object.values(a.nodes).filter((node) => node.environment.flooring.vocabulary_id === "grid-floor-openings");
  assert.ok(openingSpaces.length <= 1);
  assert.ok(openingSpaces.every((node) => node.depth === 0));
  for (const vocabularyId of ["column-corridor", "furnished-room", "stair-transition", "ceiling-tile", "local-fixture"]) assert.ok(Object.values(a.nodes).filter((node) => Object.values(node.environment).some((item) => item?.vocabulary_id === vocabularyId)).length <= 1);
});

test("environment mutations remain history over stable generated baseline through save/reload", () => {
  const world = history.createWorld({ seed: "environment-history" }); const run = history.beginRun(world, { profile: "field-researcher", scenario: "environment", seed: "run" });
  const state = v2.materialize(v2.initialize({ seed: "environment-history-region", observer: "field" })); const region = history.promoteRegion(world, run, state); const space = state.current.field;
  const baseline = structuredClone(world.regions[region].baseline_state.nodes[space].environment);
  assert.equal(history.mutateRegion(world, { run_id: run, region_id: region, space_id: space, target: "lighting", value: "off" }).ok, true);
  assert.equal(world.regions[region].state.nodes[space].persistent.lighting, "off");
  assert.deepEqual(world.regions[region].baseline_state.nodes[space].environment, baseline);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb29-environment-")), "world.json"); history.saveWorld(file, world); const loaded = history.loadWorld(file);
  assert.equal(loaded.regions[region].state.nodes[space].persistent.lighting, "off");
  assert.deepEqual(history.rebuildRegion(loaded, region), loaded.regions[region].state);
});

test("long bounded exploration preserves one physical environment across observer presentations", () => {
  const state = v2.materialize(v2.initialize({ seed: "environment-long", observer: "field", policy: "deep" }));
  for (let turn = 0; turn < 50; turn++) {
    v2.materialize(state); v2.observe(state, "field", "field-researcher");
    const exit = v2.visible(state, "field").exits[0];
    if (exit) v2.move(state, "field", exit.alias);
  }
  v2.materialize(state);
  const space = state.current.field; state.current.civilian = space; state.current.lost = space;
  const field = v2.observe(state, "field", "field-researcher"); const civilian = v2.observe(state, "civilian", "local-anomaly"); const lost = v2.observe(state, "lost", "lost");
  assert.deepEqual(field.environment, civilian.environment);
  assert.deepEqual(field.environment, lost.environment);
  assert.notEqual(field.landmark.alias, civilian.landmark.alias);
  assert.ok(Object.values(state.edges).every((edge) => state.nodes[edge.from] && (!edge.to || state.nodes[edge.to])));
});
