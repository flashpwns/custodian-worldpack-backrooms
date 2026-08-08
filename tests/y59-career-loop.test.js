"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const history = require("../tools/world-history");
const career = require("../tools/q4-career-loop");
const institution = require("../tools/institutional-runtime");
const definition = require("../data/worldpacks/clear-q4/institution.json");
const assignments = require("../tools/q4-assignment-engine");

function fixture(seed = "career") {
  const world = history.createWorld({ seed }); world.q4_operations.controlled_player = "player";
  for (const [identity, name] of [["player", "Field Researcher"], ["worker-a", "Ellis May"], ["worker-b", "Jordan West"], ["worker-c", "Morgan Hale"]]) history.instantiateCharacter(world, { run_id: "setup", identity, display_name: name, role: identity === "player" ? "field researcher" : "survey technician", clearance: "Q4", authority: "institutional-personnel-record" });
  institution.ensure(world, definition); return world;
}
function closedRun(id) { return { run_id: `run-${id}`, expedition: { mission_state: { final_result: { classification: "clean-completion" } } } }; }
function review(id) { return { mission_id: `CQ4-WO-${id}`, outcome: "returned-complete", personnel: [], equipment: [], evidence: [], evidence_outcome: {} }; }

test("between-operation processing is ordered, persisted, and idempotent", () => {
  const world = fixture("idempotence"); world.q4_equipment = { lamp: { id: "lamp", label: "Field lamp", state: "depleted", holder: "player", location: "utility-room" } };
  const run = closedRun("one"), closed = review("0001"); const first = career.process(world, definition, run, closed);
  assert.equal(first.ok, true); assert.equal(first.idempotent, false); assert.deepEqual(first.cycle.order, ["reconcile-closure", "institutional-review", "equipment-service", "personnel-availability", "assignment-conditions"]);
  assert.equal(world.q4_equipment.lamp.state, "service"); const snapshot = structuredClone(world);
  const repeated = career.process(world, definition, run, closed); assert.equal(repeated.idempotent, true); assert.deepEqual(world, snapshot);
  const reloaded = history.loadWorld((() => { const fs = require("node:fs"), os = require("node:os"), path = require("node:path"); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb-career-")), "world.json"); history.saveWorld(file, world); return file; })());
  assert.equal(career.process(reloaded, definition, run, closed).idempotent, true);
});

test("lost equipment stays lost while recovery conditions remain assignable", () => {
  const world = fixture("loss"); world.q4_equipment = { camera: { id: "camera", label: "Camera", state: "missing", holder: "player", location: "utility-room" } };
  world.institutional_response.input_history.push({ id: "loss-record", type: "equipment-loss", facts: [{ id: "camera" }] });
  career.process(world, definition, closedRun("loss"), review("0002"));
  assert.equal(world.q4_equipment.camera.state, "missing"); assert.equal(assignments.deriveConditions(world).some((item) => item.archetype === "equipment-recovery"), true);
});

test("temporary staffing availability preserves personnel identity and the agency boundary", () => {
  const world = fixture("staffing"); const first = career.process(world, definition, closedRun("staffing-a"), review("0003"));
  const unavailable = Object.values(world.characters).find((person) => person.status === "unavailable"); assert.ok(unavailable); assert.notEqual(unavailable.identity, "player"); assert.equal(unavailable.death, null);
  career.process(world, definition, closedRun("staffing-b"), review("0004")); career.process(world, definition, closedRun("staffing-c"), review("0005"));
  assert.equal(world.characters[unavailable.identity].status, "active"); assert.ok(world.characters[unavailable.identity]); assert.equal(career.assertAgencyBoundary(world), true);
});

test("three closed operations retain one career history and deterministic institutional chronology", () => {
  const world = fixture("multi-operation");
  for (const id of ["0006", "0007", "0008"]) career.process(world, definition, closedRun(id), review(id));
  assert.equal(career.projection(world).completed_operations, 3); assert.equal(career.projection(world).history.length, 3); assert.equal(new Set(career.projection(world).history.map((item) => item.cycle_id)).size, 3);
  assert.equal(Object.values(world.characters).filter((person) => person.status === "dead" || person.status === "missing").length, 0);
});
