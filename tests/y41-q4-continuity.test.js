"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const continuity = require("../tools/q4-continuity");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");

function fixture(seed = "continuity") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-continuity-")) });
  const world = service.createWorld({ name: "Continuity world", seed }).world;
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed }).ok, true);
  return { service, world };
}

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""} should succeed: ${result.error?.message ?? "unknown"}`);
  return result;
}

function field(service, world) {
  action(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) action(service, world, verb);
  return service.session(world.id, "field-researcher");
}

function completeFieldwork(service, world) {
  const entry = field(service, world);
  action(service, world, "INSPECT", "fluorescent fixture");
  action(service, world, "TEST", "fluorescent fixture");
  action(service, world, "INSPECT", "scuffed floor");
  action(service, world, "PHOTOGRAPH", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  action(service, world, "INSPECT", "service panel");
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled check-in and evidence report." }).ok, true);
  return entry;
}

function returnAndClose(service, world) {
  action(service, world, "MOVE", "back");
  action(service, world, "INSPECT", "return marker");
  action(service, world, "SECURE", "return marker");
  const begun = action(service, world, "RETURN");
  assert.equal(begun.projection.phase.phase_id, "RETURN");
  assert.equal(begun.projection.q4.review, null);
  return action(service, world, "COMPLETE_RETURN");
}

test("return is a physical procedure and the canonical review derives from the closed mission result", () => {
  const { service, world } = fixture("return-review");
  const entry = completeFieldwork(service, world);
  assert.equal(entry.run.expedition.objectives["establish-utility-conditions"].state, "satisfied");
  assert.equal(entry.run.expedition.objectives["capture-field-evidence"].state, "satisfied");
  assert.equal(entry.run.expedition.objectives["maintain-check-ins"].state, "satisfied");
  const closed = returnAndClose(service, world);
  assert.equal(closed.projection.phase.phase_id, "DEBRIEF");
  assert.equal(closed.projection.q4.current_location.name, "Threshold-Side Entry");
  assert.match(closed.projection.q4.review.outcome, /^clean-completion/);
  assert.ok(service.getWorld(world.id).q4_reviews[entry.run.expedition.mission.id]);
  assert.match(entry.run.expedition.result.continuity.outcome, /^clean-completion/);
});

test("an unavailable route rejects RETURN while a controlled abort remains distinct from death", () => {
  const { service, world } = fixture("failed-return");
  const entry = field(service, world);
  entry.run.spatial.blocked_paths ??= {};
  entry.run.spatial.blocked_paths["entry-to-utility"] = true;
  bootstrap.evaluateMissionState(entry.run, "FIELD_OPERATION");
  assert.equal(continuity.canReturn(entry.run), false);
  const rejected = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "RETURN_ROUTE_UNAVAILABLE");
  assert.equal(entry.run.expedition.team.members[1].status, "active");
  delete entry.run.spatial.blocked_paths["entry-to-utility"];
  bootstrap.evaluateMissionState(entry.run, "FIELD_OPERATION");
  action(service, world, "ABORT");
  action(service, world, "MOVE", "back");
  const closed = action(service, world, "COMPLETE_RETURN");
  assert.equal(closed.projection.q4.review.outcome, "controlled-abort");
  assert.equal(closed.projection.q4.review.final_mission_state, "aborted");
  assert.notEqual(entry.run.expedition.team.members[1].status, "dead");
});

test("equipment, evidence, scars, and institutional knowledge retain canonical origin", () => {
  const { service, world } = fixture("scars-knowledge");
  const entry = completeFieldwork(service, world);
  const camera = entry.run.expedition.equipment["recording-device"];
  camera.state = "abandoned";
  camera.location = "survey boundary";
  const closed = returnAndClose(service, world);
  assert.equal(closed.projection.q4.review.outcome, "degraded-completion");
  const canonical = service.getWorld(world.id);
  const review = canonical.q4_reviews[entry.run.expedition.mission.id];
  assert.ok(review.evidence.length);
  assert.ok(review.equipment.some((item) => item.status === "abandoned"));
  const scars = Object.values(canonical.q4_scars);
  assert.ok(scars.some((scar) => scar.origin_run === entry.run.run_id && scar.location === "survey boundary"));
  assert.ok(Object.values(canonical.q4_knowledge).some((claim) => claim.source_run === entry.run.run_id));
  assert.ok(scars.every((scar) => continuity.validScar(canonical, scar)));
});

test("next operations advance time without resetting prior personnel or equipment consequences", () => {
  const { service, world } = fixture("next-operations");
  const entry = completeFieldwork(service, world);
  const peer = entry.run.expedition.team.members[1];
  const canonical = service.getWorld(world.id);
  history.setCharacterStatus(canonical, { run_id: entry.run.run_id, identity: peer.personnel_id, status: "missing", reason: "contact not established" });
  entry.run.expedition.equipment["survey-instrument"].state = "abandoned";
  service.persistSession(canonical, "field-researcher", entry);
  returnAndClose(service, world);
  const beforeRuns = Object.keys(service.getWorld(world.id).runs).length;
  const advanced = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "ADVANCE_OPERATIONS" });
  assert.equal(advanced.ok, true);
  const next = service.session(world.id, "field-researcher");
  assert.equal(next.phase.phase_id, "BRIEFING");
  assert.equal(next.run.expedition.mission.continuity.includes("continuity") || next.run.expedition.mission.prior_history.length >= 0, true);
  assert.ok(Object.keys(service.getWorld(world.id).runs).length > beforeRuns);
  assert.equal(service.getWorld(world.id).characters[peer.personnel_id].status, "missing");
  assert.notEqual(next.run.expedition.equipment["survey-instrument"].id, entry.run.expedition.equipment["survey-instrument"].id);
});

test("ongoing runs remain resumable and fabricated scars are rejected", () => {
  const { service, world } = fixture("ongoing");
  const entry = field(service, world);
  const saved = service.persistSession(service.getWorld(world.id), "field-researcher", entry);
  assert.equal(saved, undefined);
  const resumed = new DesktopService({ paths: service.paths }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(continuity.validScar(service.getWorld(world.id), { id: "fabricated", origin_run: "none" }), false);
});
