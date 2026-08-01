"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const missions = require("../tools/q4-missions");
const personnel = require("../tools/q4-personnel");
const cognition = require("../tools/q4-cognition");
const replay = require("../tools/q4-replayability");
const { DesktopService } = require("../desktop/service");

test("Q4 catalog is bounded, authority-traceable, and structurally varied", () => {
  const catalog = missions.catalog();
  assert.ok(catalog.length >= 15 && catalog.length <= 20);
  assert.ok(catalog.every((family) => family.authority && Array.isArray(family.required)));
  const world = history.createWorld({ seed: "catalog-variation" });
  const generated = [];
  for (let i = 0; i < 30; i += 1) { const mission = missions.generate({ world, seed: `catalog-${i}` }); missions.validate(mission); generated.push(mission); history.recordQ4Mission(world, `catalog-${i}`, mission); }
  assert.ok(new Set(generated.map((mission) => mission.family)).size >= 10);
  assert.ok(new Set(generated.map((mission) => mission.objective.primary)).size >= 10);
  assert.ok(generated.every((mission) => mission.discovery_opportunity?.kind));
});

test("replay diagnostics expose structural fingerprints and keep quiet/subtle runs common", () => {
  const report = replay.report({ seed: "stress-q4", sample: 120 });
  assert.equal(report.sample, 120);
  assert.ok(report.catalog_count >= 15);
  assert.ok(report.unique_fingerprints > 1);
  assert.ok(report.quiet_or_subtle > report.severe);
  assert.ok(report.mission_family_distribution);
});

test("bounded cognition uses personal context, varies by identity, and cannot invent state", () => {
  const a = cognition.respond({ person: { identity: "a", role: "survey partner", condition: "normal" }, observation: "the route marker is not where I expected", relationship_history: [] });
  const b = cognition.respond({ person: { identity: "b", role: "survey partner", condition: "normal" }, observation: "the route marker is not where I expected", relationship_history: [{ kind: "shared-mission", mission_id: "m1" }] });
  assert.notEqual(a.decision.text, b.decision.text);
  assert.deepEqual(a.canonical_effects, []);
  assert.doesNotMatch(JSON.stringify(a), /hidden|trajectory|objective truth|unobserved entity/i);
});

test("dead controlled personnel receive explicit succession without inheriting private knowledge", () => {
  const world = history.createWorld({ seed: "succession" });
  const run = history.beginRun(world, { profile: "field-researcher", scenario: "q4", seed: "succession" });
  const created = personnel.createPlayer(world, { first_name: "Taylor", last_name: "Morgan" }); assert.equal(created.ok, true); const playerId = created.player.identity;
  personnel.staffQ4(world, run, playerId, "succession");
  world.q4_operations.controlled_player = playerId;
  assert.equal(history.setCharacterStatus(world, { run_id: run, identity: playerId, status: "dead", reason: "confirmed field loss" }).ok, true);
  const handover = personnel.selectSuccessor(world, run, "succession");
  assert.equal(handover.ok, true);
  assert.notEqual(handover.successor.identity, playerId);
  assert.equal(handover.handover.former_status, "dead");
  assert.equal(world.q4_operations.controlled_player, handover.successor.identity);
  assert.doesNotMatch(JSON.stringify(handover), /private LOCAL|hidden trajectory|unreported observation/i);
});

test("controlled identity and mission selection survive save/reload without rerolling", () => {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-replay-")) });
  const world = service.createWorld({ name: "Replay world", seed: "reopen-replay" }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "reopen-replay" });
  const missionId = started.projection.q4.mission_record.id;
  const reopened = new DesktopService({ appDataPath: service.paths.root }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(reopened.projection.q4.mission_record.id, missionId);
  assert.equal(reopened.projection.q4.player.name, started.projection.q4.player.name);
  assert.equal(reopened.projection.q4.hidden_trajectory, undefined);
});
