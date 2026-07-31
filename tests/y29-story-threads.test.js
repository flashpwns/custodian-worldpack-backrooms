"use strict";
const assert = require("node:assert/strict"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const history = require("../tools/world-history"); const v2 = require("../tools/procedural-complex-v2"); const phenomena = require("../tools/phenomena-world"); const threads = require("../tools/story-threads");
function fixture(seed = "story-threads") {
  const world = history.createWorld({ seed }); const q4 = history.beginRun(world, { profile: "field-researcher", scenario: "field", seed: "q4" }); const beck = history.beginRun(world, { profile: "async-command", scenario: "desk", seed: "beck" }); const nullzone = history.beginRun(world, { profile: "local-anomaly", scenario: "archive", seed: "nullzone" }); const lost = history.beginRun(world, { profile: "lost", scenario: "lost", seed: "lost" });
  const state = v2.materialize(v2.initialize({ seed: `${seed}-region`, observer: "q4", policy: "deep" })); const region_id = history.promoteRegion(world, q4, state); const space_id = state.current.q4;
  const artifact_id = history.leaveRemnant(world, { run_id: q4, region_id, space_id, type: "recorder", provenance: "player-history" }).artifact_id; history.recoverArtifact(world, { run_id: nullzone, artifact_id, holder: "nullzone" });
  const phenomenon = phenomena.admit(world, { run_id: q4, definition_id: "ff2-local-transition-observation", region_id, space_id }).phenomenon; phenomena.perceive(world, { run_id: q4, observer: "q4", region_id, space_id }); phenomena.perceive(world, { run_id: nullzone, observer: "nullzone", region_id, space_id });
  history.instantiateCharacter(world, { run_id: q4, identity: "fixture-researcher", display_name: "Fixture Researcher", role: "field researcher" }); history.setCharacterStatus(world, { run_id: q4, identity: "fixture-researcher", status: "dead", reason: "fixture" });
  history.event(world, beck, "report.filed", { subject: "door-fixture", claim: "sealed" }); history.event(world, beck, "report.filed", { subject: "door-fixture", claim: "open" });
  return { world, q4, beck, nullzone, lost, region_id, artifact_id };
}
test("thread derivation is pure, deterministic, and anchored to existing canonical history", () => {
  const f = fixture(); const before = structuredClone(f.world); const first = threads.derive(f.world); const second = threads.derive(f.world);
  assert.deepEqual(first, second); assert.deepEqual(f.world, before); assert.ok(first.threads.some((thread) => thread.type === "RECOVERED_OBJECT" && thread.anchor === f.artifact_id)); assert.ok(first.threads.some((thread) => thread.type === "REPEATED_PHENOMENON")); assert.ok(first.threads.some((thread) => thread.type === "PERSONNEL_DISAPPEARANCE")); assert.ok(first.threads.some((thread) => thread.type === "CONTRADICTORY_REPORTS")); assert.equal(threads.reportSummary(first).invariants["story-thread canonical mutation"], 0);
});
test("observer views preserve shared anchors without leaking cross-mode knowledge or opaque IDs", () => {
  const f = fixture(); const index = threads.derive(f.world); const q4 = threads.observerView(f.world, index, "field-researcher"); const beck = threads.observerView(f.world, index, "async-command"); const nullzone = threads.observerView(f.world, index, "local-anomaly"); const lost = threads.observerView(f.world, index, "lost");
  assert.ok(q4.threads.some((thread) => thread.type === "RECOVERED_OBJECT")); assert.ok(beck.threads.some((thread) => thread.type === "CONTRADICTORY_REPORTS")); assert.ok(nullzone.threads.some((thread) => thread.type === "REPEATED_PHENOMENON")); assert.deepEqual(lost.threads, []);
  for (const view of [q4, beck, nullzone, lost]) assert.doesNotMatch(JSON.stringify(view), /(?:thread|artifact|phenomenon)-[a-f0-9]{4,}/i);
});
test("save reload and import-style reconstruction retain relations without a thread cache", () => {
  const f = fixture(); const expected = threads.derive(f.world); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb29-thread-")), "world.json"); history.saveWorld(file, f.world); const imported = history.loadWorld(file); assert.deepEqual(threads.derive(imported), expected);
});
test("provider summaries cannot invent causes, culprits, or future events and fallback remains deterministic", async () => {
  const f = fixture(); const view = threads.observerView(f.world, threads.derive(f.world), "field-researcher"); const first = await threads.summarize({ view, provider: { summarize: async () => ({ prose: "The recorder was taken by the Still Life." }) } }); const second = await threads.summarize({ view, provider: { summarize: async () => { throw new Error("offline"); } } });
  assert.equal(first.source, "fallback"); assert.equal(second.source, "fallback"); assert.equal(first.prose, threads.fallbackSummary(view)); assert.equal(second.prose, threads.fallbackSummary(view));
});
test("long quiet history never triggers events or resurrects a dead character", () => {
  const f = fixture(); const before = f.world.events.length; const index = threads.derive(f.world); for (let turn = 0; turn < 100; turn++) { threads.derive(f.world); threads.observerView(f.world, index, turn % 2 ? "lost" : "async-command"); }
  assert.equal(f.world.events.length, before); assert.equal(f.world.characters["fixture-researcher"].status, "dead"); assert.equal(history.instantiateCharacter(f.world, { run_id: f.q4, identity: "fixture-researcher", display_name: "Fixture Researcher" }).code, "CHARACTER_IDENTITY_UNAVAILABLE");
});
