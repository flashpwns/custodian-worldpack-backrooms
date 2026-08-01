"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DesktopService, MODES } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const report = require("../tools/reactive-ui-report.js");

function projection(mode) {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(require("node:os").tmpdir(), "yb-reactive-ui-")) });
  const world = service.createWorld({ name: "Reactive surface", seed: "reactive-ui" }).world;
  return service.startSession({ world_id: world.id, mode, seed: `${mode}-surface` }).projection;
}

test("reactive surfaces keep their presentation identities without crossing private contexts", () => {
  void report;
  const field = surfaces.render(projection("field-researcher"));
  assert.match(field, /ASSIGNMENT BRIEFING/); assert.match(field, /RADIO/i); assert.match(field, /equipment/i);
  const beck = surfaces.render(projection("async-command"));
  assert.match(beck, /Reports and calls/); assert.match(beck, /On the desk/); assert.doesNotMatch(beck, /desk-grid/);
  const nullzone = surfaces.render(projection("local-anomaly"));
  assert.match(nullzone, /Notebook/); assert.match(nullzone, /Comparison/); assert.doesNotMatch(nullzone, /ASYNC|Task tray|Institutional timeline/i);
  const lost = surfaces.render(projection("lost"));
  assert.match(lost, /What you remember/); assert.doesNotMatch(lost, /objective|institution|personnel|report|map|thread|taxonomy/i);
});

test("renderer remains projection-only and keeps natural language ahead of structured fallback", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  assert.match(renderer, /data-testid="natural-primary"/);
  assert.ok(renderer.indexOf('data-testid="natural-primary"') < renderer.indexOf("Structured controls"));
  assert.doesNotMatch(ui, /world_history|canonical_effect|observer_projection|story_thread/i);
  assert.deepEqual(Object.keys(surfaces.CAPABILITIES).sort(), MODES.map(({ id }) => id).sort());
});
