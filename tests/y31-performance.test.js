"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const history = require("../tools/world-history");
const threads = require("../tools/story-threads");

test("thread cache is derived, repeatable, and invalidates after canonical history append", () => {
  const world = history.createWorld({ seed: "yb31-thread-cache" });
  const run = history.beginRun(world, { profile: "async-command", scenario: "cache", seed: "cache" });
  const first = threads.derive(world);
  assert.strictEqual(threads.derive(world), first);
  history.event(world, run, "report.filed", { subject: "door", claim: "sealed", relation: "contradicts" });
  history.event(world, run, "report.filed", { subject: "door", claim: "open", relation: "contradicts" });
  const second = threads.derive(world);
  assert.notStrictEqual(second, first);
  assert.equal(second.threads.some((thread) => thread.type === "CONTRADICTORY_REPORTS"), true);
  assert.equal(world.events.length, 3);
});

test("cached observer views remain mode-scoped and do not mutate canonical history", () => {
  const world = history.createWorld({ seed: "yb31-observer-cache" });
  const field = history.beginRun(world, { profile: "field-researcher", scenario: "cache", seed: "field" });
  const desk = history.beginRun(world, { profile: "async-command", scenario: "cache", seed: "desk" });
  history.event(world, field, "report.filed", { subject: "shared", claim: "field" });
  history.event(world, desk, "report.filed", { subject: "shared", claim: "desk" });
  const index = threads.derive(world); const before = JSON.stringify(world);
  const fieldView = threads.observerView(world, index, "field-researcher");
  const deskView = threads.observerView(world, index, "async-command");
  assert.deepEqual(threads.observerView(world, index, "field-researcher"), fieldView);
  assert.deepEqual(threads.observerView(world, index, "async-command"), deskView);
  assert.equal(JSON.stringify(world), before);
});
