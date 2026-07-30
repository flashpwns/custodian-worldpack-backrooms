"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { read } = require("../tools/intake-lib");
const { startRun, status, act } = require("../tools/run-bootstrap");

test("stable IDs retain intentional display titles", () => {
  const profiles = read("profiles/profiles.json").profiles;
  assert.deepEqual(profiles.map((profile) => profile.id), ["async-command", "field-researcher", "local-anomaly", "lost"]);
  assert.deepEqual(profiles.map((profile) => profile.title), ["Async: Beck's Desk", "Async: Clear-Q4", "Nullzone Exposure", "Lost"]);
});
test("Clear-Q4 public action output is observer safe", () => {
  const run = startRun({ profile: "field-researcher", seed: "alpha" }).run;
  const current = status(run);
  assert.equal(current.profile_id, "field-researcher");
  assert.equal(current.profile_title, "Async: Clear-Q4");
  assert.ok(current.available_verbs.includes("MOVE"));
  assert.equal("projection" in current, false);
  assert.equal(act(run, "MOVE").outcome, "succeeded");
});
