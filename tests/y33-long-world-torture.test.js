"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("YB-33 long-world torture remains deterministic, persistent, and observer-safe", () => {
  const report = JSON.parse(execFileSync(process.execPath, ["tools/yb33-torture-report.js"], { encoding: "utf8" }));
  assert.equal(report.passed, true);
  assert.equal(report.deterministic, true);
  assert.ok(report.workload.canonical_events >= 2500);
  assert.equal(report.canonical.save_reload_equivalent, true);
  assert.equal(report.canonical.cache_invalidated_after_append, true);
  assert.equal(report.canonical.canonical_mutation_from_reads, true);
  assert.equal(report.canonical.dead_character, true);
  assert.equal(report.canonical.recovered_object_count, 1);
  assert.equal(report.canonical.unique_object_identity, true);
  assert.equal(report.desktop.no_player_leak, true);
  assert.equal(report.desktop.new_world_isolated, true);
  assert.equal(report.desktop.provider_failure_safe, true);
  assert.equal(report.stale_response_rejection, true);
});
