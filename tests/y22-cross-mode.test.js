"use strict";
const assert = require("node:assert/strict"); const test = require("node:test");
const history = require("../tools/world-history"); const v2 = require("../tools/procedural-complex-v2"); const nullzone = require("../tools/nullzone-exposure"); const lost = require("../tools/lost"); const becks = require("../tools/becks-desk");

test("v2 landmarks, environment, and objects are rule-backed and observer-safe", () => {
  const state = v2.materialize(v2.initialize({ seed: "visible", observer: "field", policy: "moderate" }));
  const local = v2.observe(state, "field", "field-researcher"); const landmark = Object.values(state.landmarks)[0]; const object = state.objects[state.current.field][0];
  assert.ok(Object.values(v2.LANDMARK_RULES).every((rule) => rule.rule_id && rule.authority && rule.source_basis.length && rule.constraints));
  assert.ok(Object.values(v2.ENVIRONMENT_RULES).every((rule) => rule.rule_id && rule.authority));
  assert.ok(Object.values(v2.OBJECT_RULES).every((rule) => rule.rule_id && rule.authority));
  assert.equal(landmark.generator_version, v2.VERSION); assert.ok(local.landmark.alias); assert.equal("id" in local.landmark, false); assert.ok(object.rule_id); assert.ok(local.route_character);
  assert.equal(v2.landmarkNavigation(state, "field", landmark.description).ok, true);
  assert.equal(v2.landmarkNavigation(state, "field", landmark.id).code, "LANDMARK_UNKNOWN");
});

test("one persistent v2 region is shared across Clear-Q4, Nullzone, Lost, and Beck scopes", () => {
  const world = history.createWorld({ seed: "cross-mode" }); const clearRun = history.beginRun(world, { profile: "field-researcher", scenario: "v2", seed: "clear" });
  const state = v2.materialize(v2.initialize({ seed: "shared", observer: "yb-field-player", policy: "moderate" }));
  const regionId = history.promoteRegion(world, clearRun, state); const field = v2.observe(world.regions[regionId].state, "yb-field-player", "field-researcher");
  const fieldSummary = v2.scopedSummary(world.regions[regionId].state, "yb-field-player", "field-researcher");
  assert.equal(history.recordInstitutionalRegionSummary(world, clearRun, regionId, fieldSummary).ok, true);
  const landmarkId = world.regions[regionId].state.landmarks[world.regions[regionId].state.current["yb-field-player"]].id;
  const civilianRun = history.beginRun(world, { profile: "local-anomaly", scenario: "v2", seed: "civilian" });
  assert.equal(nullzone.prepare(world, civilianRun, ["field-light"], regionId).ok, true); assert.equal(nullzone.enter(world, civilianRun).ok, true);
  const civilian = nullzone.observeRegion(world); assert.ok(civilian.landmark.alias.startsWith("the ")); assert.notEqual(civilian.landmark.alias, field.landmark.alias);
  const space = world.civilian.active.region_id && world.regions[regionId].state.current["yb-local-player"]; const removed = world.regions[regionId].state.objects[space][0];
  assert.equal(history.mutateRegion(world, { run_id: civilianRun, region_id: regionId, space_id: space, target_type: "object", target: removed.id, operation: "remove", value: null }).ok, true);
  const lostRun = lost.start(world, "lost-shared", { region_id: regionId }); const lostProjection = lost.projection(lostRun);
  assert.equal(lostRun.region_id, regionId); assert.ok(lostProjection.surroundings.landmark); assert.equal(world.regions[regionId].state.landmarks[space].id, landmarkId); assert.equal(world.regions[regionId].state.objects[space].some((object) => object.id === removed.id), false);
  const beck = becks.projection(world); assert.equal(beck.archive.region_summaries.length, 1); assert.equal(JSON.stringify(beck).includes("civilian"), false); assert.equal(JSON.stringify(beck).includes("yb-lost-player"), false);
  assert.equal(JSON.stringify(nullzone.projection(world)).includes("survey "), false); assert.equal(JSON.stringify(lostProjection).includes("survey "), false);
});

test("v2 object mutation survives restart and does not expose internal target identifiers", () => {
  const world = history.createWorld({ seed: "restart-visible" }); const run = history.beginRun(world, { profile: "field-researcher", scenario: "v2", seed: "r" }); const state = v2.materialize(v2.initialize({ seed: "r", observer: "field", policy: "moderate" })); const id = history.promoteRegion(world, run, state); const space = state.current.field; const object = state.objects[space][0];
  history.mutateRegion(world, { run_id: run, region_id: id, space_id: space, target_type: "object", target: object.id, operation: "remove", value: null });
  const rebuilt = history.rebuildRegion(world, id); assert.equal(rebuilt.objects[space].some((entry) => entry.id === object.id), false); const local = v2.observe(rebuilt, "field", "field-researcher"); assert.equal(JSON.stringify(local).includes(object.id), false);
});
