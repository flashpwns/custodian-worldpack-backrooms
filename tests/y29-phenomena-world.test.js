"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const v2 = require("../tools/procedural-complex-v2");
const entities = require("../tools/entity-simulation");
const phenomena = require("../tools/phenomena-world");
const { validateNarration } = require("../tools/scene-presentation");

function fixture(seed = "phenomena-fixture") {
  const world = history.createWorld({ seed });
  const run = history.beginRun(world, { profile: "field-researcher", scenario: "phenomena", seed });
  const state = v2.materialize(v2.initialize({ seed: `${seed}-region`, observer: "field", policy: "deep" }));
  const region_id = history.promoteRegion(world, run, state);
  const space_id = Object.entries(world.regions[region_id].state.objects).find(([, objects]) => objects.length)?.[0];
  return { world, run, region_id, space_id, object: world.regions[region_id].state.objects[space_id][0] };
}

test("source-backed phenomena are scenario-admitted once and expose only an observed condition", () => {
  const f = fixture();
  const first = phenomena.admit(f.world, { run_id: f.run, definition_id: "ff2-marked-surface-discontinuity", region_id: f.region_id, space_id: f.space_id });
  const second = phenomena.admit(f.world, { run_id: f.run, definition_id: "ff2-marked-surface-discontinuity", region_id: f.region_id, space_id: f.space_id });
  assert.equal(first.ok, true); assert.equal(second.idempotent, true); assert.equal(Object.keys(f.world.phenomena).length, 1);
  const view = phenomena.perceive(f.world, { run_id: f.run, observer: "lost-observer", region_id: f.region_id, space_id: f.space_id });
  assert.deepEqual(view.available_responses, ["OBSERVE", "RECORD", "REPORT"]);
  assert.doesNotMatch(JSON.stringify(view), /ff2|phenomenon-|destination|cause/i);
});

test("a source-backed physical outcome uses world history while institutional knowledge requires a report", () => {
  const f = fixture(); const admitted = phenomena.admit(f.world, { run_id: f.run, definition_id: "ff2-marked-surface-discontinuity", region_id: f.region_id, space_id: f.space_id }).phenomenon;
  assert.equal(phenomena.institutionalProjection(f.world).length, 0);
  const evidence = phenomena.recordEvidence(f.world, { run_id: f.run, phenomenon_id: admitted.id, observer: "q4", medium: "photograph" });
  assert.equal(evidence.ok, true); assert.deepEqual(evidence.evidence.observed, { category: "observed condition", description: "a blue-tape-marked area of floor" });
  const outcome = phenomena.applySurfaceInteraction(f.world, { run_id: f.run, phenomenon_id: admitted.id, object_id: f.object.id });
  assert.equal(outcome.ok, true); assert.equal(outcome.outcome.destination, "unresolved");
  assert.equal(f.world.regions[f.region_id].state.objects[f.space_id].some((item) => item.id === f.object.id), false);
  assert.equal(phenomena.report(f.world, { run_id: f.run, phenomenon_id: admitted.id, summary: "Nothing unusual." }).ok, true);
  assert.deepEqual(phenomena.institutionalProjection(f.world), [{ category: "reported observation", summary: "Nothing unusual." }]);
});

test("phenomenon identity and physical outcomes survive save/reload without replaying admission", () => {
  const f = fixture(); const admitted = phenomena.admit(f.world, { run_id: f.run, definition_id: "ff2-marked-surface-discontinuity", region_id: f.region_id, space_id: f.space_id }).phenomenon;
  phenomena.applySurfaceInteraction(f.world, { run_id: f.run, phenomenon_id: admitted.id, object_id: f.object.id });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb29-phenomena-")), "world.json"); history.saveWorld(file, f.world);
  const loaded = history.loadWorld(file);
  assert.equal(Object.keys(loaded.phenomena).length, 1);
  assert.equal(loaded.phenomena[admitted.id].outcomes[0].object_id, f.object.id);
  assert.equal(loaded.regions[f.region_id].state.objects[f.space_id].some((item) => item.id === f.object.id), false);
});

test("single-context admissions remain bounded and quiet locations create no idle anomaly", () => {
  const f = fixture();
  assert.deepEqual(phenomena.perceive(f.world, { run_id: f.run, observer: "lost", region_id: f.region_id, space_id: f.space_id }).phenomena, []);
  const transition = phenomena.admit(f.world, { run_id: f.run, definition_id: "ff2-local-transition-observation", region_id: f.region_id, space_id: f.space_id }).phenomenon;
  assert.equal(phenomena.applySurfaceInteraction(f.world, { run_id: f.run, phenomenon_id: transition.id, object_id: f.object.id }).code, "PHENOMENON_INTERACTION_UNAVAILABLE");
  assert.equal(phenomena.reportSummary().admission.source_backed_entities.length, 0);
});

test("Still Life remains nonreactive and provider prose cannot invent behavior", () => {
  const f = fixture(); const still = entities.addEntity(f.world, { run_id: f.run, type: "still-life", region_id: f.region_id, space_id: f.space_id, definition_id: "still-life-physical-presence", authority: "scenario-optional", provenance: "fixture" }).entity;
  assert.equal(entities.advanceEntity(f.world, { run_id: f.run, entity_id: still.id }).code, "ENTITY_TRANSITION_PROHIBITED");
  assert.equal(entities.entityPerception(f.world, { entity_id: still.id, observer: "field", region_id: f.region_id, space_id: f.space_id }).detected, false);
  assert.doesNotMatch(JSON.stringify(entities.localProjection(f.world, { region_id: f.region_id, space_id: f.space_id })), /still-life/i);
  assert.equal(validateNarration({ safe_facts: [], immediate_changes: [], context: [] }, { prose: "The figure turns its head toward you.", referenced_safe_fact_ids: [] }).ok, false);
});
