"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const observationAuthority = require("../tools/observation-authority");
const worldHistory = require("../tools/world-history");
const phenomenonEcology = require("../tools/q4-phenomenon-ecology");
const q4Environment = require("../tools/q4-environment");

const PLAYER = "player-1";
const COWORKER_A = "coworker-a"; // survey technician: has "instrumentation" qualification
const COWORKER_B = "coworker-b"; // documentation specialist: does not

function definition() {
  return {
    locations: [
      { id: "room-a", landmarks: [{ id: "landmark-1", name: "Old Console", observation: "A dust-covered console.", inspection: "The console is unresponsive." }] },
      { id: "room-b", landmarks: [] }
    ],
    connections: [
      { id: "conn-a-b", from: "room-a", to: "room-b", bidirectional: true, visibility: "visible", direction: "east", reverse_direction: "west", relationship: "corridor" }
    ]
  };
}

function buildRun() {
  return {
    seed: "test-seed",
    run_id: "test-run",
    worldpack_id: "test-worldpack",
    _observationDefinition: definition(),
    session: { startup: { player: { observer_id: PLAYER } } },
    spatial: {
      player_location: "room-a",
      personnel_locations: { [PLAYER]: "room-a", [COWORKER_A]: "room-a", [COWORKER_B]: "room-b" },
      environment: q4Environment.create({ locations: [{ id: "room-a" }, { id: "room-b" }] })
    },
    object_state: { objects: { "obj-1": { location: "room-a", name: "Field Case", state: "closed" } } },
    expedition: {
      clock: { interval: 1 },
      equipment: {},
      team: {
        members: [
          { id: PLAYER, personnel_id: PLAYER, role: "field researcher", qualifications: ["field-research", "observation", "equipment-operation"], condition: "normal", status: "active" },
          { id: COWORKER_A, personnel_id: COWORKER_A, role: "survey technician", qualifications: ["instrumentation", "measurement", "radio-operation"], condition: "normal", status: "active" },
          { id: COWORKER_B, personnel_id: COWORKER_B, role: "documentation specialist", qualifications: ["photography", "logging", "sample-collection"], condition: "normal", status: "active" }
        ]
      }
    }
  };
}

function buildWorld() {
  return {
    version: worldHistory.VERSION,
    world_id: "test-world",
    phenomena: {
      "phen-1": {
        record_version: phenomenonEcology.RECORD_VERSION,
        id: "phen-1",
        location_id: "room-a",
        canonical_family: "STILL_LIFE",
        current_state: "ACTIVE",
        recognition_requirement: "instrumentation"
      }
    }
  };
}

test("enumerateFeatures produces a stable, sorted featureId order across repeated calls", () => {
  const run = buildRun();
  const world = buildWorld();
  const first = observationAuthority.enumerateFeatures(run, world, "room-a");
  const second = observationAuthority.enumerateFeatures(run, world, "room-a");
  const ids = first.map((item) => item.featureId);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, sorted, "features must already be sorted by featureId");
  assert.deepEqual(first, second, "repeated enumeration of unchanged canonical state must be byte-identical");
});

test("change_token is a stable digest of the same canonical slice", () => {
  const run = buildRun();
  const world = buildWorld();
  const a = observationAuthority.enumerateFeatures(run, world, "room-a");
  const b = observationAuthority.enumerateFeatures(run, world, "room-a");
  const tokenOf = (list, featureId) => list.find((item) => item.featureId === featureId).change_token;
  assert.equal(tokenOf(a, "landmark:landmark-1"), tokenOf(b, "landmark:landmark-1"));
  assert.equal(tokenOf(a, "object:obj-1"), tokenOf(b, "object:obj-1"));
  assert.equal(tokenOf(a, "phenomenon:phen-1"), tokenOf(b, "phenomenon:phen-1"));
});

test("unseen is represented by absence, never a stored state", () => {
  const run = buildRun();
  assert.equal(observationAuthority.stateOf(run, PLAYER, "landmark:landmark-1"), "unseen");
  observationAuthority.observe(run, buildWorld(), PLAYER, "room-a", { interval: 1 });
  // A feature no observer has ever touched must still read "unseen" and be omitted from projectFor.
  assert.equal(observationAuthority.stateOf(run, PLAYER, "phenomenon:does-not-exist"), "unseen");
  const projected = observationAuthority.projectFor(run, PLAYER, buildWorld());
  assert.ok(!projected.some((item) => item.featureId === "phenomenon:does-not-exist"));
});

test("visible but unnoticed produces no bucket entry when salience never crosses threshold", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1, threshold: 1000 });
  assert.equal(observationAuthority.stateOf(run, PLAYER, "landmark:landmark-1"), "unseen");
  assert.equal(observationAuthority.stateOf(run, PLAYER, "object:obj-1"), "unseen");
  const bucket = run.observation_state.observers[PLAYER];
  assert.ok(bucket, "observe() still creates the observer's bucket container");
  assert.deepEqual(Object.keys(bucket.features), []);
});

test("noticed but unrecognized is a possible outcome", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1 });
  assert.equal(observationAuthority.stateOf(run, PLAYER, "phenomenon:phen-1"), "NOTICED");
  const entry = run.observation_state.observers[PLAYER].features["phenomenon:phen-1"];
  assert.equal(entry.recognition, null);
});

test("qualification affects recognition only, not visibility or notice", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1 });
  observationAuthority.observe(run, world, COWORKER_A, "room-a", { interval: 1 });

  const playerState = observationAuthority.stateOf(run, PLAYER, "phenomenon:phen-1");
  const coworkerState = observationAuthority.stateOf(run, COWORKER_A, "phenomenon:phen-1");
  // Both observers noticed it (visibility/notice were identical circumstances at that location).
  assert.notEqual(playerState, "unseen");
  assert.notEqual(coworkerState, "unseen");
  // Only the qualified coworker actually recognized it.
  assert.equal(playerState, "NOTICED");
  assert.equal(coworkerState, "RECOGNIZED");
  assert.equal(run.observation_state.observers[COWORKER_A].features["phenomenon:phen-1"].recognition.qualification, "instrumentation");
});

test("two observers can differ on the same canonical feature", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1 });
  observationAuthority.observe(run, world, COWORKER_A, "room-a", { interval: 1 });
  assert.notEqual(
    observationAuthority.stateOf(run, PLAYER, "phenomenon:phen-1"),
    observationAuthority.stateOf(run, COWORKER_A, "phenomenon:phen-1")
  );
});

test("all observers can miss a feature entirely when salience never crosses threshold for anyone", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, COWORKER_B, "room-b", { interval: 1, threshold: 1000 });
  assert.equal(observationAuthority.stateOf(run, COWORKER_B, "connection:conn-a-b"), "unseen");
  assert.equal(observationAuthority.stateOf(run, PLAYER, "connection:conn-a-b"), "unseen");
  assert.ok(!run.observation_state.observers[PLAYER]);
});

test("observe() for one observer never creates or modifies another observer's bucket", () => {
  const run = buildRun();
  const world = buildWorld();
  observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1 });
  assert.ok(run.observation_state.observers[PLAYER]);
  assert.ok(!run.observation_state.observers[COWORKER_A]);
  assert.ok(!run.observation_state.observers[COWORKER_B]);
});

test("identical observe() sequences against fresh clones produce byte-identical observation_state", () => {
  const runA = buildRun();
  const runB = buildRun();
  const worldA = buildWorld();
  const worldB = buildWorld();
  for (const [run, world] of [[runA, worldA], [runB, worldB]]) {
    observationAuthority.observe(run, world, PLAYER, "room-a", { interval: 1 });
    observationAuthority.observe(run, world, COWORKER_A, "room-a", { interval: 1 });
    observationAuthority.observe(run, world, COWORKER_B, "room-b", { interval: 2 });
  }
  assert.equal(JSON.stringify(runA.observation_state), JSON.stringify(runB.observation_state));
});

test("provenance arrays are capped across many repeated observe() intervals", () => {
  const run = buildRun();
  const world = buildWorld();
  for (let interval = 1; interval <= 20; interval += 1) {
    observationAuthority.observe(run, world, PLAYER, "room-a", { interval });
  }
  const entry = run.observation_state.observers[PLAYER].features["landmark:landmark-1"];
  assert.ok(entry.provenance.length <= 8, "provenance must stay bounded");
  assert.ok(entry.provenance.length >= 1);
});

test("validateCurrent accepts a state produced by observe() and rejects a malformed one", () => {
  const run = buildRun();
  observationAuthority.observe(run, buildWorld(), PLAYER, "room-a", { interval: 1 });
  assert.deepEqual(observationAuthority.validateCurrent(run.observation_state), { ok: true });

  const broken = observationAuthority.create({ worldpack_id: "x" });
  broken.observers.bad = { features: { "landmark:x": { state: "NOT_A_STATE", provenance: [] } } };
  const result = observationAuthority.validateCurrent(broken);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
});

test("migrate tolerates undefined/null and is idempotent on a current-shape state", () => {
  assert.deepEqual(observationAuthority.migrate(undefined), observationAuthority.create({ worldpack_id: null }));
  const run = buildRun();
  observationAuthority.observe(run, buildWorld(), PLAYER, "room-a", { interval: 1 });
  const migratedOnce = observationAuthority.migrate(run.observation_state);
  const migratedTwice = observationAuthority.migrate(migratedOnce);
  assert.deepEqual(migratedOnce, migratedTwice);
});

test("tools/observation-authority.js has no dialogue/ai/model/provider dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "observation-authority.js"), "utf8");
  const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(requires.length > 0);
  for (const specifier of requires) {
    assert.doesNotMatch(specifier, /dialogue|\bai-|llm|model|provider/i, `unexpected dependency: ${specifier}`);
  }
});
