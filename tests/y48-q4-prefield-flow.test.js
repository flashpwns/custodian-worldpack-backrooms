"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

function fixture() {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-prefield-")) });
  const world = service.createWorld({ name: "Prefield flow", seed: "prefield-flow" }).world;
  return { service, world };
}
function start(service, world) {
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  return service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
}
function advance(service, world, action) {
  return service.submitAction({ world_id: world.id, mode: "field-researcher", action });
}

test("personnel creation persists a confirmation gate before assignment briefing", () => {
  const { service, world } = fixture();
  assert.equal(service.getQ4PersonnelStatus({ world_id: world.id }).required, true);
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  const status = service.getQ4PersonnelStatus({ world_id: world.id });
  assert.equal(status.confirmation_required, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).projection.phase.phase_id, "BRIEFING");
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  assert.equal(service.getQ4PersonnelStatus({ world_id: world.id }).confirmation_required, false);
});

test("dedicated pre-field surfaces contain no field action composer or generic scene receipt", () => {
  const { service, world } = fixture();
  const started = start(service, world);
  let html = surfaces.render(started.projection);
  assert.match(html, /q4-prefield-briefing/);
  assert.match(html, /Continue to Staging/);
  assert.match(html, /LOCAL COMMS/);
  assert.match(html, /FIELD RADIO CHANNEL NOT ACTIVE DURING BRIEFING/);
  assert.doesNotMatch(html, /What do you do\?|Nothing notable changes|natural-form|Structured controls/);
  html = surfaces.render(advance(service, world, "READY").projection);
  assert.match(html, /q4-prefield-staging/);
  assert.match(html, /Proceed to Threshold Room/);
  assert.doesNotMatch(html, /What do you do\?|Nothing notable changes/);
});

test("pre-field controls advance deterministically through threshold and radio check", () => {
  const { service, world } = fixture(); start(service, world);
  assert.equal(advance(service, world, "READY").projection.phase.phase_id, "STAGING");
  assert.equal(advance(service, world, "PROCEED").projection.phase.phase_id, "FACILITY_TRANSIT");
  assert.equal(advance(service, world, "APPROACH").projection.phase.phase_id, "THRESHOLD");
  let threshold = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(threshold.q4.channels.standard.available, false);
  assert.match(surfaces.render(threshold), /Cross Threshold/);
  const radio = advance(service, world, "CROSS");
  assert.equal(radio.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.match(surfaces.render(radio.projection), /Establish Radio Contact/);
  const field = advance(service, world, "RADIO_CHECK");
  assert.equal(field.projection.phase.phase_id, "FIELD_OPERATION");
  assert.doesNotMatch(surfaces.render(field.projection), /Nothing notable changes/);
});

test("LOCAL greeting records visible player text and deterministic coworker response", () => {
  const { service, world } = fixture(); const started = start(service, world);
  const result = service.submitQ4Communication({ world_id: world.id, channel: "local", target: "Nora", text: "Good morning, Nora." });
  assert.equal(result.ok, true);
  const html = surfaces.render(result.projection);
  assert.match(html, /Good morning, Nora\./);
  assert.match(html, /Nora:/);
  assert.match(html, /DELIVERED|HEARD/i);
});

test("pre-field resume preserves confirmation and current dedicated phase", () => {
  const { service, world } = fixture(); start(service, world);
  advance(service, world, "READY");
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "STAGING");
  assert.match(surfaces.render(resumed.projection), /Proceed to Threshold Room/);
});

test("renderer wires dedicated confirmation and suppresses pre-field generic inputs", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /confirmQ4Personnel/);
  assert.match(renderer, /q4Prefield/);
  assert.match(renderer, /q4Prefield \? ""/);
});
