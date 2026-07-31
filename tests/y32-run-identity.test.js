"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { startRun, saveRun, resumeRun } = require("../tools/run-bootstrap");
const { describe } = require("../tools/run-identity");
const v2 = require("../tools/procedural-complex-v2");

const start = (seed) => startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", generator_version: v2.VERSION }).run;
test("same seed produces the same descriptive starting identity", () => {
  assert.deepEqual(describe(start("yb32-same")), describe(start("yb32-same")));
  assert.deepEqual(start("yb32-same").identity, start("yb32-same").identity);
});

test("different seeds vary only through observer-safe admitted starting surfaces", () => {
  const one = describe(start("a")); const two = describe(start("b"));
  assert.notDeepEqual(one, two);
  for (const item of [one, two]) { assert.equal(item.derived, true); assert.equal(item.provenance, "derived-from-seed-observer-safe-starting-conditions-and-run-history"); assert.ok(item.environment.realization); assert.ok(item.operational.initial_questions.length >= 1); assert.doesNotMatch(JSON.stringify(item), /rarity|difficulty|affix|destiny|archetype|plot|modifier/i); }
});

test("identity is reconstructed across run save/resume and does not alter the session", () => {
  const run = start("yb32-save"); const saved = saveRun(run); const restored = resumeRun(saved).run;
  assert.deepEqual(restored.identity, run.identity);
  assert.doesNotMatch(JSON.stringify(saved), /rarity|difficulty|affix|destiny|archetype|hidden plot|stat modifier/i);
});
