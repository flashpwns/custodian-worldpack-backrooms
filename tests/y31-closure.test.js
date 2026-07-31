"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const inspection = require("../tools/dev-inspection");
const commands = require("../tools/dev-commands");

test("YB-31 read-only consumers use the shared inspection service", () => {
  assert.deepEqual(inspection.OBSERVER_PROFILES, ["field-researcher", "async-command", "local-anomaly", "lost"]);
  assert.equal(typeof inspection.subject, "function");
  assert.equal(typeof inspection.recentHistory, "function");
  assert.equal(typeof commands.fixture, "function");
  assert.match(fs.readFileSync(require.resolve("../desktop/service"), "utf8"), /developerInspection\.recentHistory/);
});

test("YB-31 closure keeps trace read-only and fixture simulation isolated", () => {
  const fixture = commands.fixture({ name: "convergence", seed: "yb31-closure-test" });
  assert.equal(fixture.mutation, "SIMULATION_DRIVING");
  assert.equal(fixture.isolated, true);
  assert.equal(fixture.snapshot.derived, true);
  assert.match(fs.readFileSync(require.resolve("../tools/dev-commands"), "utf8"), /path:"PRIMARY FREEFORM PATH"/);
});
