"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("YB-33 deterministic stranger flow passes without developer explanation", () => {
  const report = JSON.parse(execFileSync(process.execPath, ["tools/stranger-flow-report.js"], { encoding: "utf8" }));
  assert.equal(report.passed, true);
  assert.equal(report.launch.first_run_complete, false);
  assert.equal(report.launch.worlds, 0);
  assert.equal(report.mode_choices.count, 4);
  assert.equal(report.guided_introduction.player_surface, true);
  assert.equal(report.natural_language.accepted, true);
  assert.equal(report.save_resume.same_world, true);
  assert.equal(report.offline_provider_failure.can_continue_offline, true);
  assert.equal(report.settings_accessibility.maximum_text_size, true);
  assert.ok(report.mode_flows.every((mode) => mode.safe_surface && mode.has_natural_input));
});
