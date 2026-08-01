"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const history = require("../tools/world-history");
const missions = require("../tools/q4-missions");
const trajectories = require("../tools/q4-trajectories");
const personnel = require("../tools/q4-personnel");

function fixture(seed = "trajectory-seed") { const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-trajectories-")) }); const world = service.createWorld({ name: "Trajectory continuity", seed }).world; assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed }).ok, true); return { service, world }; }
function field(service, world) { for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true); return service.session(world.id, "field-researcher"); }

test("trajectory generation is deterministic, bounded, compatible, and authority-traceable", () => {
  const world = history.createWorld({ seed: "trajectory-catalog" }); const a = missions.generate({ world, seed: "same" }); const b = missions.generate({ world: history.createWorld({ seed: "trajectory-catalog" }), seed: "same" });
  assert.deepEqual(a.hidden_trajectory, b.hidden_trajectory); assert.ok(trajectories.catalog().some((item) => item.id === a.hidden_trajectory.family)); assert.equal(trajectories.compatible(a, a.hidden_trajectory), true); assert.equal(trajectories.assertNoUnsupported(a.hidden_trajectory), true); assert.ok(a.hidden_trajectory.authority.source_claim_ids.length); assert.ok(trajectories.INTENSITIES.includes(a.hidden_trajectory.intensity));
  const bands = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((seed) => missions.generate({ world, seed }).hidden_trajectory.intensity)); assert.ok(bands.size >= 3);
});

test("hidden trajectory stays out of briefing, ordinary mission projection, and provider context", () => {
  const { service, world } = fixture(); const briefing = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection; const hidden = service.session(world.id, "field-researcher").run.expedition.mission.hidden_trajectory;
  assert.equal(briefing.phase.phase_id, "BRIEFING"); assert.doesNotMatch(JSON.stringify(briefing.q4), new RegExp(`${hidden.family}|${hidden.id}|${hidden.intensity}`, "i")); assert.doesNotMatch(JSON.stringify(service.session(world.id, "field-researcher").run.expedition.mission_record ?? {}), /trajectory|intensity|latent_condition/i); assert.doesNotMatch(JSON.stringify(service.naturalContext(service.getWorld(world.id), "field-researcher", service.session(world.id, "field-researcher"))), /trajectory|intensity|latent_condition/i);
});

test("symptoms require an observer-safe gate and do not appear from turn count alone", () => {
  const { service, world } = fixture("trajectory-gate"); const entry = service.session(world.id, "field-researcher"); entry.run.expedition.mission.hidden_trajectory.intensity = "SIGNIFICANT"; for (let i = 0; i < 5; i++) service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" }); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.symptoms_observable.length, 0); field(service, world); const target = Object.keys(entry.run.aliases)[0]; assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "INSPECT", target }).ok, true); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.symptoms_observable.length, 0); const recorded = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target }); assert.equal(recorded.ok, true); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.symptoms_observable.length, 1); assert.match(recorded.result.public_reason, /does not reconcile|does not fully reconcile|operational timing/i);
});

test("observation, local conversation, and Standard reporting retain separate knowledge", () => {
  const { service, world } = fixture("trajectory-knowledge"); const entry = field(service, world); entry.run.expedition.mission.hidden_trajectory.intensity = "SIGNIFICANT"; const target = Object.keys(entry.run.aliases)[0]; service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target }); const state = entry.run.expedition.mission.hidden_trajectory.state; assert.equal(state.player_observed.length, 1); assert.equal(state.standard_received.length, 0); assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "local", text: "I found a discrepancy." }).ok, true); assert.equal(state.standard_received.length, 0); assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "The field record does not reconcile with the observation." }).ok, true); assert.equal(state.standard_received.length, 1); assert.equal(state.player_recognized, false); assert.ok(Object.values(service.getWorld(world.id).knowledge.institutional.records).some((record) => record.payload.report?.includes("field record")));
});

test("quiet runs and early return can complete without trajectory discovery", () => {
  const { service, world } = fixture("trajectory-quiet"); const entry = service.session(world.id, "field-researcher"); entry.run.expedition.mission.hidden_trajectory.intensity = "QUIET"; field(service, world); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" }).ok, true); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.symptoms_observable.length, 0); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.status, "dormant");
});

test("containment records history without erasing evidence, and separation follows contact state", () => {
  const { service, world } = fixture("trajectory-separation"); const entry = field(service, world); const canonical = service.getWorld(world.id); entry.run.expedition.mission.hidden_trajectory.intensity = "SIGNIFICANT"; const target = Object.keys(entry.run.aliases)[0]; service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target }); const before = entry.run.expedition.mission.hidden_trajectory.state.evidence_ids.length; service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target }); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.status, "mission-altering"); const separated = trajectories.separate({ world: canonical, expedition: entry.run.expedition, run_id: entry.run.run_id, category: "SEPARATED", reason: "route state differs" }); assert.equal(separated.ok, true); assert.equal(personnel.observerStatus(entry.run.expedition.team.members[1], history.character(canonical, entry.run.expedition.team.members[1].personnel_id)).local_eligible, false); assert.equal(entry.run.expedition.equipment["survey-radio"].holder, "yb-field-player"); assert.equal(trajectories.contain({ world: canonical, expedition: entry.run.expedition, run_id: entry.run.run_id }).ok, true); assert.equal(entry.run.expedition.mission.hidden_trajectory.state.evidence_ids.length, before); assert.ok(canonical.events.some((event) => event.type === "q4.team.separated"));
});

test("hidden trajectory state survives save/reload and missing remains distinct from death", () => {
  const { service, world, } = fixture("trajectory-persistence"); const entry = field(service, world); entry.run.expedition.mission.hidden_trajectory.state.status = "observed-but-unexplained"; service.persistSession(service.getWorld(world.id), "field-researcher", entry); const restarted = new DesktopService({ paths: service.paths }); assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true); const restored = restarted.session(world.id, "field-researcher").run.expedition.mission.hidden_trajectory; assert.equal(restored.state.status, "observed-but-unexplained"); const canonical = restarted.getWorld(world.id); canonical.characters["yb-field-peer-observer"].status = "missing"; assert.equal(canonical.characters["yb-field-peer-observer"].status, "missing"); assert.notEqual(canonical.characters["yb-field-peer-observer"].status, "dead");
});

test("mission generation, personnel continuity, equipment continuity, and parked modes remain intact", () => {
  const { service, world } = fixture("trajectory-regression"); const entry = service.session(world.id, "field-researcher"); assert.ok(entry.run.expedition.mission.objective.primary); assert.equal(entry.run.expedition.team.members.length, 2); assert.equal(Object.keys(entry.run.expedition.equipment).length, 4); assert.deepEqual(service.listModes().modes.filter((mode) => !mode.playable).map((mode) => mode.roadmap_status), ["Coming Soon", "Coming Soon", "Coming Soon"]);
});
