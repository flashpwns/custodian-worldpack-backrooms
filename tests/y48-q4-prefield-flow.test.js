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

test("one preparation surface preserves canonical pre-field transitions without repeated dashboards", () => {
  const { service, world } = fixture();
  const started = start(service, world);
  let html = surfaces.render(started.projection);
  assert.match(html, /q4-preparation-surface/);
  assert.match(html, /OPERATIONAL PREPARATION/);
  assert.match(html, /Confirm briefing/);
  assert.match(html, /data-testid="q4-communications"/);
  assert.match(html, /data-testid="q4-comms-form"/);
  assert.doesNotMatch(html, /local-comms|standard-comms|Continue to Staging/);
  assert.match(html, /data-radio-state="unavailable">LINK UNAVAILABLE/);
  assert.doesNotMatch(html, /What do you do\?|Nothing notable changes|natural-form|Structured controls/);
  html = surfaces.render(advance(service, world, "READY").projection);
  assert.match(html, /q4-preparation-surface/);
  assert.match(html, /Leave staging/);
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
  assert.match(surfaces.render(radio.projection), /Run radio check/);
  const rejected = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RADIO_CHECK" });
  assert.equal(rejected.ok, false);
  const checked = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." });
  assert.equal(checked.ok, true);
  assert.equal(checked.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.match(surfaces.render(checked.projection), /Radio check/);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" }).ok, true);
  assert.match(surfaces.render(service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection), /Begin field operation/);
  const field = advance(service, world, "BEGIN_FIELD_OPERATION");
  assert.equal(field.projection.phase.phase_id, "FIELD_OPERATION");
  assert.doesNotMatch(surfaces.render(field.projection), /Nothing notable changes/);
});

test("unified communications records LOCAL exchange without resolving a physical turn", () => {
  const { service, world } = fixture(); const started = start(service, world);
  const peer = started.projection.q4.team.find((member) => !member.controlled);
  const result = service.submitQ4Communication({ world_id: world.id, channel: "local", target: peer.first_name, text: `Good morning, ${peer.first_name}.` });
  assert.equal(result.ok, true);
  const html = surfaces.render(result.projection);
  assert.match(html, new RegExp(`Good morning, ${peer.first_name}\\.`));
  assert.match(html, new RegExp(`${peer.first_name}:`));
  assert.match(html, /DELIVERED|HEARD/i);
  assert.match(html, /communication-timeline/);
  assert.match(html, /message-channel">LOCAL/);
  assert.doesNotMatch(html, /local-comms|standard-comms/);
});

test("pre-field resume preserves confirmation and current dedicated phase", () => {
  const { service, world } = fixture(); start(service, world);
  advance(service, world, "READY");
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "STAGING");
  assert.match(surfaces.render(resumed.projection), /Leave staging/);
});

test("renderer wires dedicated confirmation and suppresses pre-field generic inputs", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /confirmQ4Personnel/);
  assert.match(renderer, /q4Prefield/);
  assert.match(renderer, /q4Prefield \? ""/);
});
