"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const path = require("node:path");
test("YB-32 aggregate replayability closure passes", () => { const output = execFileSync(process.execPath, [path.join(__dirname, "../tools/y32-replayability-report.js")], { encoding: "utf8" }); const report = JSON.parse(output); assert.equal(report.passed, true); assert.equal(report.same_seed_determinism, true); assert.ok(report.distinct_legitimate_surfaces > 1); assert.equal(Object.values(report.closure_invariants).every((value) => value === 0), true); assert.equal(report.long_world.turns, 150); });
