"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { RequestGate, applicationMessage, simulationMessage } = require("../desktop/renderer/interaction");
const report = require("../tools/interaction-report.js");
const context = (worldId = "world-one", mode = "field-researcher") => ({ worldId, mode });

test("rapid submit and repeated Enter share one presentation request", () => {
  const gate = new RequestGate(); const first = gate.begin(context());
  assert.ok(first); assert.equal(gate.begin(context()), null, "duplicate canonical request is not dispatched");
  assert.equal(gate.settle(first, context()), true);
});
test("fast and slow responses resolve only while their context remains current", async () => {
  const gate = new RequestGate(); const fast = gate.begin(context());
  await Promise.resolve(); assert.equal(gate.settle(fast, context()), true);
  const slow = gate.begin(context()); gate.invalidate();
  await Promise.resolve(); assert.equal(gate.settle(slow, context()), false, "late reply cannot replace the scene");
});
test("world and mode changes discard stale responses", () => {
  const gate = new RequestGate(); const world = gate.begin(context());
  assert.equal(gate.settle(world, context("world-two")), false);
  gate.invalidate(); const mode = gate.begin(context("world-two", "lost"));
  assert.equal(gate.settle(mode, context("world-two", "async-command")), false);
});
test("offline and technical feedback remain player-facing and distinct from in-world outcomes", () => {
  assert.match(applicationMessage(), /world was not changed/i);
  assert.match(simulationMessage(), /attempt cannot be completed/i);
  assert.doesNotMatch(applicationMessage(), /provider|model|latency|ACTION FAILED/i);
});
test("turn controls lock during resolution while presentation panels remain available", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /disableTurnForms/); assert.match(renderer, /#natural-form input/);
  assert.doesNotMatch(renderer, /querySelectorAll\("details"\).*disabled/);
  assert.match(renderer, /Submitted\./); assert.match(renderer, /Resolving…/);
});
test("motion has no fabricated horror, hidden phenomenon, or character-fate cue", () => {
  void report;
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/interaction.css"), "utf8");
  assert.doesNotMatch(css, /vhs|static|screen-tear|red-flash|threat-pulse|crt|scanline|particle/i);
  assert.match(css, /prefers-reduced-motion/);
});
test("long mixed interaction session remains serial and presentation-only", () => {
  const gate = new RequestGate();
  for (let turn = 0; turn < 80; turn += 1) {
    const active = context(`world-${turn % 2}`, ["field-researcher", "async-command", "local-anomaly", "lost"][turn % 4]);
    const token = gate.begin(active); assert.ok(token); assert.equal(gate.settle(token, active), true);
  }
});
