"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const phases = require("../tools/mode-phases");
const human = require("../tools/human-world");
const q4 = require("../tools/q4-experience");
const beck = require("../tools/beck-experience");
const desk = require("../tools/becks-desk");
const history = require("../tools/world-history");

test("human-world runtime entries are traced to admitted claims and do not invent a canon cast", () => {
  const report = human.report();
  assert.equal(report.named_character_admission.admitted.length, 0);
  assert.equal(report.canon_runtime.length, 5);
  assert.ok(report.canon_runtime.every((item) => item.claim_id && item.authority === "authoritative"));
  assert.equal(report.invariants["untraced canon-backed human runtime content"], 0);
  assert.equal(report.invariants["unlabeled pack-original human lore"], 0);
});

test("Q4 and Beck receive bounded human procedure context without provenance or knowledge leakage", () => {
  const q4View = q4.presentation({ expedition: { team: { members: [{ id: "yb-field-peer-observer", role: "field-researcher", status: "ready" }] }, equipment: {}, messages: [] } }, phases.createPhase({ mode: "field-researcher", guided: false }));
  const beckView = beck.presentation({}, { state: { reports: {} } }, phases.createPhase({ mode: "async-command", guided: false }));
  assert.match(q4View.human_context.background_presence, /Facility staff/);
  assert.match(beckView.human_context.institutional_context, /records/);
  assert.doesNotMatch(JSON.stringify({ q4View, beckView }), /claim_id|source_refs|authoritative|backrooms-/i);
  assert.equal(q4View.team[0].name, "Field researcher");
});

test("desk personnel are persistent procedural role occupants rather than an invented named cast", () => {
  const world = history.createWorld({ seed: "human-world" });
  const state = desk.state(world);
  const people = Object.values(state.personnel);
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.classification === "procedural-role-occupant" && person.provenance === "pack-original-human-glue" && person.named === false));
});
