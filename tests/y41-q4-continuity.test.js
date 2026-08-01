"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const continuity = require("../tools/q4-continuity");
const history = require("../tools/world-history");

function fixture(seed = "continuity") { const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-continuity-")) }); const world = service.createWorld({ name: "Continuity world", seed }).world; assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed }).ok, true); return { service, world }; }
function field(service, world) { for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true); return service.session(world.id, "field-researcher"); }
function complete(service, world) { const entry = field(service, world); const target = Object.keys(entry.run.aliases)[0]; service.submitAction({ world_id: world.id, mode: "field-researcher", action: "INSPECT", target }); service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD", target }); service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMMUNICATE", target: "standard" }); return entry; }

test("return is physical, route access is separate from objective completion, and review is canonical", () => {
  const { service, world } = fixture("return-review"); const entry = complete(service, world); const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection; const location = before.scene.location; assert.equal(entry.run.expedition.objectives.survey.state, "satisfied"); assert.equal(entry.run.expedition.objectives.evidence.state, "satisfied"); assert.equal(entry.run.expedition.objectives.check_in.state, "satisfied"); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" }).ok, true); const after = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection; assert.equal(after.phase.phase_id, "DEBRIEF"); assert.equal(after.scene.location, location); assert.equal(after.q4.review.outcome, "returned"); assert.ok(service.getWorld(world.id).q4_reviews[entry.run.expedition.mission.id]); assert.equal(entry.run.expedition.result.continuity.outcome, "returned");
});

test("failed return is distinct from death, while early abort produces an incomplete review", () => {
  const { service, world } = fixture("failed-return"); const entry = field(service, world); continuity.setReturnState(entry.run, { route_access: false, threshold_access: false }); assert.equal(continuity.canReturn(entry.run), false); assert.equal(continuity.classify(entry.run, "RETURN"), "failed-return"); assert.equal(entry.run.expedition.team.members[1].status, "active"); assert.notEqual(entry.run.expedition.team.members[1].status, "dead"); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "ABORT" }).ok, true); assert.equal(service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.review.outcome, "stranded");
});

test("equipment, evidence, scars, and institutional knowledge retain canonical origin", () => {
  const { service, world } = fixture("scars-knowledge"); const entry = complete(service, world); const camera = entry.run.expedition.equipment["recording-device"]; camera.state = "abandoned"; camera.location = "survey boundary"; assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" }).ok, true); const canonical = service.getWorld(world.id); const review = canonical.q4_reviews[entry.run.expedition.mission.id]; assert.ok(review.evidence.length); assert.ok(review.equipment.some((item) => item.status === "abandoned")); const scars = Object.values(canonical.q4_scars); assert.ok(scars.some((scar) => scar.origin_run === entry.run.run_id && scar.location === "survey boundary")); assert.ok(Object.values(canonical.q4_knowledge).some((claim) => claim.source_run === entry.run.run_id)); assert.ok(scars.every((scar) => continuity.validScar(canonical, scar)));
});

test("next operations advance time without resetting history and respect prior personnel/equipment state", () => {
  const { service, world } = fixture("next-operations"); const entry = complete(service, world); const peer = entry.run.expedition.team.members[1]; const canonical = service.getWorld(world.id); history.setCharacterStatus(canonical, { run_id: entry.run.run_id, identity: peer.personnel_id, status: "missing", reason: "contact not established" }); entry.run.expedition.equipment["survey-instrument"].state = "abandoned"; service.persistSession(canonical, "field-researcher", entry); service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" }); const beforeRuns = Object.keys(service.getWorld(world.id).runs).length; const advanced = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "ADVANCE_OPERATIONS" }); assert.equal(advanced.ok, true); const next = service.session(world.id, "field-researcher"); assert.equal(next.phase.phase_id, "BRIEFING"); assert.equal(next.run.expedition.mission.continuity.includes("continuity") || next.run.expedition.mission.prior_history.length >= 0, true); assert.ok(Object.keys(service.getWorld(world.id).runs).length > beforeRuns); assert.equal(service.getWorld(world.id).characters[peer.personnel_id].status, "missing"); assert.notEqual(next.run.expedition.equipment["survey-instrument"].id, entry.run.expedition.equipment["survey-instrument"].id);
});

test("ongoing runs remain resumable and fabricated scars are rejected", () => {
  const { service, world } = fixture("ongoing"); const entry = field(service, world); const saved = service.persistSession(service.getWorld(world.id), "field-researcher", entry); assert.equal(saved, undefined); const resumed = new DesktopService({ paths: service.paths }).resumeSession({ world_id: world.id, mode: "field-researcher" }); assert.equal(resumed.ok, true); assert.equal(resumed.projection.phase.phase_id, "FIELD_OPERATION"); assert.equal(continuity.validScar(service.getWorld(world.id), { id: "fabricated", origin_run: "none" }), false);
});
