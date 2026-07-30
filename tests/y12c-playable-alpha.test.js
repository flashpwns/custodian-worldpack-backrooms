"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { stableSerialize, inspectSessionObserver } = require("custodian");
const { startRun, status, act, saveRun, resumeRun, look } = require("../tools/run-bootstrap");

function fullRun(withSave) {
  let run = startRun({ profile: "field-researcher", seed: "yb12-certification" }).run;
  const before = status(run); const firstLook = look(run);
  assert.equal(before.profile_id, "field-researcher");
  assert.equal(before.profile_title, "Async: Clear-Q4");
  assert.equal(firstLook.view.location, "threshold-transition");
  assert.equal(firstLook.targets.length, 0);
  assert.equal(act(run, "MOVE").outcome, "succeeded");
  const afterMove = look(run); const alias = afterMove.aliases[0].alias;
  assert.equal(afterMove.view.location, "complex-side-controlled-area");
  assert.equal(act(run, "INSPECT", alias).outcome, "succeeded");
  if (withSave) {
    run = resumeRun(saveRun(run)).run;
    assert.equal(run.profile_id, "field-researcher");
    assert.equal(run.profile_title, "Async: Clear-Q4");
  }
  assert.equal(act(run, "USE").outcome, "succeeded");
  assert.equal(run.lifecycle, "completed");
  assert.equal(act(run, "USE").error.code, "RUN_COMPLETE");
  assert.equal(look(run).outcome, "succeeded", "read-only LOOK remains available after completion");
  assert.equal(status(run).available_verbs.includes("USE"), false, "completed runs do not advertise rejected mutations");
  return run;
}

test("Async: Clear-Q4 completes through public-only LOOK, MOVE, INSPECT, save, restore, and USE", () => {
  const uninterrupted = fullRun(false);
  const restored = fullRun(true);
  assert.equal(stableSerialize(uninterrupted.session.projection), stableSerialize(restored.session.projection));
  assert.equal(uninterrupted.lifecycle, restored.lifecycle);
  assert.deepEqual(uninterrupted.checklist, restored.checklist);
});
test("LOOK and INSPECT aliases remain observer-safe and stale references are rejected", () => {
  const run = startRun({ profile: "field-researcher", seed: "stale" }).run;
  act(run, "MOVE"); const alias = look(run).aliases[0].alias; const staleRef = run.aliases[alias]; act(run, "INSPECT", alias); act(run, "USE");
  const other = startRun({ profile: "field-researcher", seed: "other" }).run;
  assert.equal(act(other, "INSPECT", staleRef).result.public_reason, "target unavailable");
  assert.equal(act(run, "INSPECT", staleRef).result.public_reason, "target unavailable", "an alias becomes stale after canonical state changes");
  assert.equal(act(run, "INSPECT", "controlled-light").result.public_reason, "target unavailable");
  assert.equal(JSON.stringify(status(run)).includes("objective"), false);
});
test("profile separation and opaque references do not expose another observer's view", () => {
  const run = startRun({ profile: "field-researcher", seed: "isolation" }).run;
  act(run, "MOVE"); const ref = look(run).aliases[0].ref;
  const foreign = inspectSessionObserver({ session: run.session, observer: "yb-field-peer-observer", request: { kind: "inspect", target: ref } });
  assert.equal(foreign.public_reason, "target unavailable");
  for (const profile of ["lost", "local-anomaly"]) {
    const safe = JSON.stringify(status(startRun({ profile, seed: "separation" }).run)).toLowerCase();
    assert.equal(safe.includes("async"), false, `${profile} must not gain ASYNC information without a basis`);
    assert.equal(safe.includes("controlled-light"), false, `${profile} must not gain the field interaction target`);
  }
});
