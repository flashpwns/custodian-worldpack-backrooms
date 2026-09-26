"use strict";

// Pass 8B-2 integration tests: run.observation_state persistence + wiring
// into observer-safe projection. Ground truth for the module itself is
// tests/y168-observation-authority.test.js (kept unmodified); these tests
// only cover the integration points listed in the pass brief.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const history = require("../tools/world-history");
const observationAuthority = require("../tools/observation-authority");
const canonicalLedger = require("../tools/canonical-world-ledger");
const liveScene = require("../tools/live-scene-projection");
const observerContextCompiler = require("../tools/observer-context-compiler");

// --- lightweight module-level fixture (mirrors tests/y58-assignment-engine.test.js) ---
function bootstrapFixture(seed) {
  const world = history.createWorld({ seed });
  const started = bootstrap.startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" });
  assert.equal(started.ok, true, started.error?.code);
  let run = started.run;
  const player = run.session.startup.player.observer_id;
  run = bootstrap.setSpatialPhase(run, "THRESHOLD"); // moves to threshold-room (has landmark: threshold-apparatus)
  return { world, run, player };
}

// --- full DesktopService fixture (mirrors tests/y69-reference-expedition.test.js) ---
function serviceFixture(seed) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-observation-integration-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Observation Integration", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Test", last_name: "Observer" }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "procedural-survey" });
  assert.equal(started.ok, true, started.error?.code);
  return { appDataPath, service, world };
}

test("1. a pre-existing (v9) save migrates to a valid, empty-shaped observation_state", () => {
  const { world, run } = bootstrapFixture("y169-migration");
  const save = bootstrap.saveRun(run);
  const legacy = structuredClone(save);
  legacy.version = "yellow-beast-save@v9";
  delete legacy.observation_state;

  const restored = bootstrap.resumeRun(legacy, { world, spatial_worldpack: "clear-q4", phase: "THRESHOLD" });
  assert.equal(restored.ok, true, restored.error?.code);
  assert.equal(observationAuthority.validateCurrent(restored.run.observation_state).ok, true);
  assert.equal(restored.run.observation_state.version, observationAuthority.VERSION);
});

test("2. save -> reload preserves per-observer observation_state (round-trip fidelity)", () => {
  const { world, run } = bootstrapFixture("y169-roundtrip");
  const save = bootstrap.saveRun(run);
  assert.ok(save.observation_state, "save must carry observation_state");
  const restored = bootstrap.resumeRun(save, { world, spatial_worldpack: "clear-q4", phase: "THRESHOLD" });
  assert.equal(restored.ok, true, restored.error?.code);
  assert.deepEqual(restored.run.observation_state, save.observation_state);
});

test("3. a malformed observation_state in a current-version save is rejected, not silently reset", () => {
  const { world, run } = bootstrapFixture("y169-malformed");
  const save = bootstrap.saveRun(run);
  const corrupted = structuredClone(save);
  corrupted.observation_state.observers.bad = { features: { "landmark:x": { state: "NOT_A_STATE", provenance: [] } } };

  const restored = bootstrap.resumeRun(corrupted, { world, spatial_worldpack: "clear-q4", phase: "THRESHOLD" });
  assert.equal(restored.ok, false);
  assert.equal(restored.error.code, "RUN_STATE_INVALID");

  // Also confirmed at the desktop/service.js save-validation boundary.
  const { service, world: svcWorld } = serviceFixture("y169-malformed-svc");
  const entry = service.session(svcWorld.id, "field-researcher");
  const worldNow = service.getWorld(svcWorld.id);
  const serialized = service.serializeSession(worldNow, "field-researcher", entry);
  const corruptedSave = structuredClone(serialized);
  corruptedSave.payload.observation_state.observers.bad = { features: { "landmark:x": { state: "NOT_A_STATE", provenance: [] } } };
  assert.equal(service.validateSessionSave(corruptedSave, "field-researcher"), "SESSION_SAVE_DAMAGED");
});

test("4. an unseen feature (no observation_state bucket entry) is omitted from live-scene-projection output", () => {
  const { run, player } = bootstrapFixture("y169-unseen-projection");
  const projected = liveScene.projectLiveScene(run, { observer_id: player });
  assert.equal(projected.ok, true);
  assert.ok(projected.packet.available_action_context.visible_targets.some((t) => t.label === "The Threshold"));

  delete run.observation_state.observers[player].features["landmark:threshold-apparatus"];
  const after = liveScene.projectLiveScene(run, { observer_id: player });
  assert.equal(after.ok, true);
  assert.ok(!after.packet.available_action_context.visible_targets.some((t) => t.label === "The Threshold"));
});

test("5. a noticed feature is visible in projection only to observers whose own observation actually crossed the notice threshold for it", () => {
  const { run, player } = bootstrapFixture("y169-observer-scoped");
  const coworker = run.expedition.team.members.map((m) => m.personnel_id ?? m.id).find((id) => id !== player);
  assert.ok(coworker);

  // As of Pass 9B, run-bootstrap.js runs the same observation ingress for
  // co-located, active NPC team members it already runs for the player
  // (tools/speech-scheduler.js's autonomous-report scheduling depends on
  // this). A co-located coworker may therefore now have their own bucket --
  // but per-feature visibility remains strictly per-observer: whether the
  // coworker recognized the threshold apparatus is independent of whether
  // the player did, and is never copied from one bucket to the other.
  const coworkerProjection = liveScene.projectLiveScene(run, { observer_id: coworker });
  assert.equal(coworkerProjection.ok, true);
  const coworkerState = observationAuthority.stateOf(run, coworker, "landmark:threshold-apparatus");
  const coworkerSeesIt = coworkerProjection.packet.available_action_context.visible_targets.some((t) => t.label === "The Threshold");
  assert.equal(coworkerSeesIt, coworkerState === "RECOGNIZED", "coworker projection must track the coworker's own bucket, not the player's");

  const playerProjection = liveScene.projectLiveScene(run, { observer_id: player });
  assert.ok(playerProjection.packet.available_action_context.visible_targets.some((t) => t.label === "The Threshold"));
});

test("6. a remembered feature (noticed previously, not currently visible) projects with present:false", () => {
  const { run, player } = bootstrapFixture("y169-remembered");
  const before = liveScene.projectLiveScene(run, { observer_id: player });
  assert.deepEqual(before.packet.remembered_features, []);

  // Move away from threshold-room without losing the prior notice.
  run.spatial.player_location = "threshold-approach";
  run.spatial.personnel_locations[player] = "threshold-approach";
  const after = liveScene.projectLiveScene(run, { observer_id: player });
  assert.equal(after.ok, true);
  const remembered = after.packet.remembered_features.find((item) => item.feature_id === "landmark:threshold-apparatus");
  assert.ok(remembered, "the previously-noticed landmark must still be reported as remembered");
  assert.equal(remembered.present, false);
});

test("7. compileObserverContext output never contains an unseen canonical feature", () => {
  const { run, player } = bootstrapFixture("y169-context-compiler");
  const before = observerContextCompiler.compileObserverContext(run, player);
  assert.ok(before.perception.visible.some((line) => line.startsWith("The Threshold")));

  delete run.observation_state.observers[player].features["landmark:threshold-apparatus"];
  const after = observerContextCompiler.compileObserverContext(run, player);
  assert.ok(!after.perception.visible.some((line) => line.startsWith("The Threshold")));
  assert.ok(!after.available_referents.object.includes("The Threshold"));
});

test("8. the direct-observation ledger invariant holds, and catches a bucket/known_information mismatch", () => {
  const { run, player } = bootstrapFixture("y169-ledger-invariant");
  assert.equal(canonicalLedger.validateInvariants(run).ok, true);

  delete run.observation_state.observers[player].features["landmark:threshold-apparatus"];
  const result = canonicalLedger.validateInvariants(run);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === "DIRECT_OBSERVATION_MISSING_OBSERVATION_STATE" && v.message.includes("landmark:threshold-apparatus")));
});

test("9. observing at a location writes only the buckets of observers actually co-located there, and never another observer's feature entries", () => {
  const { service, world } = serviceFixture("y169-no-fanout");
  const entry = service.session(world.id, "field-researcher");
  const player = entry.run.session.startup.player.observer_id;
  const coworkers = entry.run.expedition.team.members.map((m) => m.personnel_id ?? m.id).filter((id) => id !== player);
  assert.ok(coworkers.length > 0);

  // Pass 9B: co-located, active NPCs now go through the same observation
  // ingress as the player (see recordCoworkerObservations in
  // tools/run-bootstrap.js), so their buckets may legitimately exist. The
  // invariant that must hold is narrower: a bucket is only ever written for
  // its own observer_id, at that observer's own location -- never fan-out
  // into a bucket keyed by a different id.
  bootstrap.setSpatialPhase(entry.run, "THRESHOLD");
  const observerIds = Object.keys(entry.run.observation_state.observers);
  assert.ok(observerIds.includes(player));
  for (const id of observerIds) {
    assert.ok(id === player || coworkers.includes(id), `observation_state must never contain an unknown observer id: ${id}`);
  }
  // Snapshot each bucket, then look() again: only observers actually
  // co-located with the player may be touched (the player, plus any
  // co-located coworker via recordCoworkerObservations); anyone elsewhere
  // must be left byte-identical.
  const before = structuredClone(entry.run.observation_state.observers);
  const coLocated = new Set(coworkers.filter((id) => entry.run.spatial?.personnel_locations?.[id] === entry.run.spatial?.player_location));
  bootstrap.look(entry.run);
  for (const id of Object.keys(before)) {
    if (id === player || coLocated.has(id)) continue;
    assert.deepEqual(entry.run.observation_state.observers[id], before[id], `observing at ${player}'s location must never modify ${id}'s bucket -- that observer was not co-located`);
  }
});

test("10. existing (pre-observation_state) saves still load successfully end-to-end through desktop/service.js", () => {
  const { service, world } = serviceFixture("y169-legacy-load");
  const file = service.sessionFile(world.id, "field-researcher");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const legacy = structuredClone(raw);
  legacy.payload.version = "yellow-beast-save@v9";
  delete legacy.payload.observation_state;
  delete legacy.persistence_pair;

  const worldNow = service.getWorld(world.id);
  if (worldNow.persistence_pairs) delete worldNow.persistence_pairs["field-researcher"];

  assert.equal(service.validateSessionSave(legacy, "field-researcher"), null);
  const restored = service.restoreSession(worldNow, "field-researcher", legacy);
  assert.ok(restored, "a legacy save missing observation_state must still restore");
  assert.equal(restored.run.observation_state.version, observationAuthority.VERSION);
  assert.equal(observationAuthority.validateCurrent(restored.run.observation_state).ok, true);
});
