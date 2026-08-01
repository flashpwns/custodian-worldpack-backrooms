"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const history = require("../tools/world-history");
const missions = require("../tools/q4-missions");
const equipment = require("../tools/q4-equipment");
const surfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "q4-mission") { const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-missions-")) }); const world = service.createWorld({ name: "Mission continuity", seed }).world; assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed }).ok, true); return { service, world }; }

test("Q4 assignments are stable, bounded, terminology-safe, and actionable", () => {
  const world = history.createWorld({ seed: "mission-seed" }); const a = missions.generate({ world, seed: "same" }); const b = missions.generate({ world: history.createWorld({ seed: "mission-seed" }), seed: "same" });
  assert.deepEqual(a, b); assert.ok(missions.catalog().some((entry) => entry.id === a.family)); assert.equal(missions.validate(a), true); assert.match(`${a.objective.primary} ${a.site.boundary}`, /layout|survey boundary|lighting|material/i); assert.ok(a.objective.completion_criteria.length); assert.doesNotMatch(JSON.stringify(a), /explore.*strange|anything strange|dungeon|quest/i); assert.ok(a.authority.source_claim_ids.length);
  const variants = new Set(["a", "b", "c", "d", "e", "f", "g"].map((seed) => missions.generate({ world, seed }).family)); assert.ok(variants.size > 1);
});

test("Clear-Q4 stores the assigned mission and the first screen is an actual briefing", () => {
  const { service, world } = fixture(); const entry = service.session(world.id, "field-researcher"); const mission = entry.run.expedition.mission; const stored = service.getWorld(world.id).q4_missions[mission.id];
  assert.equal(stored.family, mission.family); assert.equal(mission.status, "assigned"); assert.deepEqual(mission.required_equipment, entry.run.expedition.loadout.required); assert.equal(entry.run.expedition.team.members.length, 2);
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection; const html = surfaces.render(projection);
  assert.equal(projection.phase.phase_id, "BRIEFING"); assert.equal(projection.q4.mission_record.id, mission.id); assert.match(html, /Site objective|Expected procedures|Recorded prior history|Radio and reporting/); assert.doesNotMatch(html, /Declared survey remains|field-suroperation|Column Corridor|Ceiling Fixture/);
  assert.ok(!projection.available_actions.some((action) => /mission|assignment/i.test(action.type ?? action.label ?? "")));
});

test("mission equipment and staffing derive from the assigned record without adding a mission picker", () => {
  const { service, world } = fixture("mission-equipment"); const entry = service.session(world.id, "field-researcher"); const mission = entry.run.expedition.mission;
  assert.deepEqual(new Set(mission.required_equipment), new Set(Object.keys(entry.run.expedition.equipment))); assert.ok(mission.assigned_personnel.includes(entry.run.expedition.team.members[0].personnel_id)); assert.ok(Object.values(entry.run.expedition.equipment).every((item) => equipment.DEFINITIONS[Object.keys(equipment.DEFINITIONS).find((key) => equipment.DEFINITIONS[key].type === item.type)]));
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true); assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STAGING");
});

test("continuity missions reference only actual recorded history and do not turn missing into dead", () => {
  const world = history.createWorld({ seed: "history-grounding" }); const first = missions.generate({ world, seed: "first" }); history.recordQ4Mission(world, "run-history", first); world.q4_equipment = { "q4-camera-01": { id: "q4-camera-01", state: "abandoned", holder: "field-team", type: "35mm-camera" } }; const person = { identity: "person-missing", display_name: "Jamie Ellis", status: "missing" }; world.characters[person.identity] = person;
  const next = missions.generate({ world, seed: "next" }); assert.equal(next.family, "personnel-recovery"); assert.ok(next.prior_history.some((item) => item.id === person.identity)); assert.ok(next.prior_history.some((item) => item.id === "q4-camera-01")); assert.equal(next.prior_history.some((item) => item.status === "confirmed dead"), false); assert.equal(missions.canReference(world, { id: "invented-outpost", kind: "prior-layout-record" }), false);
});

test("mission conduct remains player-controlled and completion does not depend on a future X-factor", () => {
  const { service, world } = fixture("mission-conduct"); const entry = service.session(world.id, "field-researcher"); assert.equal(entry.run.expedition.mission.objective.completion_criteria.some((item) => /X-factor|anomaly escalation|discover/i.test(item)), false);
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "ABORT" }).ok, true);
  assert.equal(entry.run.expedition.mission_state.return.abort_requested, true);
  assert.equal(entry.run.expedition.mission_state.lifecycle, "returning");
  assert.ok(Object.values(entry.run.expedition.mission_state.objectives).some((objective) => objective.state === "abandoned"));
  assert.equal(service.getWorld(world.id).q4_missions[entry.run.expedition.mission.id].status, "assigned", "the immutable assignment record is not a second mission-state owner before closure");
});
