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
  assert.match(html, /Continue to Staging/);
  assert.match(html, /data-testid="q4-communications"/);
  assert.match(html, /data-testid="q4-comms-form"/);
  assert.doesNotMatch(html, /local-comms|standard-comms|Deploy to radio readiness/);
  assert.match(html, /data-radio-state="unavailable">LINK UNAVAILABLE/);
  assert.doesNotMatch(html, /What do you do\?|Nothing notable changes|natural-form|Structured controls/);
  html = surfaces.render(advance(service, world, "READY").projection);
  assert.match(html, /q4-preparation-surface/);
  assert.match(html, /deliberately depart Equipment Staging/);
  assert.match(html, /data-testid="select-store-route-marker-kit"/);
  assert.doesNotMatch(html, /What do you do\?|Nothing notable changes/);
});

test("fresh production briefing enters staging without crossing or starting Standard", () => {
  const { service, world } = fixture(); const started = start(service, world);
  assert.deepEqual(started.projection.available_actions[0], { type: "READY", target_required: false, targets: [] });
  assert.equal(advance(service, world, "DEPLOY").error.code, "PHASE_GUARD_REJECTED");

  const staged = advance(service, world, "READY");
  assert.equal(staged.ok, true);
  assert.equal(staged.projection.phase.phase_id, "STAGING");
  assert.equal(staged.projection.q4.current_location.name, "Equipment Staging");
  assert.equal(staged.projection.q4.radio_check.authorized, false);
  assert.equal(staged.projection.q4.radio_check.completed, false);
  assert.equal(staged.projection.q4.channels.standard.available, false);
  assert.equal(staged.projection.q4.channels.standard.history.length, 0);

  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.spatial.player_location, "equipment-staging");
  assert.deepEqual(entry.run.spatial.visited_locations, ["async-briefing-room", "equipment-staging"]);
  assert.equal(entry.run.spatial.route_history.some((item) => item.connection_id === "threshold-crossing"), false);
  const complexSide = new Set(["threshold-side-entry", "utility-room", "columned-corridor", "open-passage", "lower-level-transition", "level-2-boundary", "relay-alcove", "records-annex", "service-bypass"]);
  assert.equal(entry.run.spatial.visited_locations.some((id) => complexSide.has(id)), false);
  assert.equal(entry.run.spatial.authorizations["threshold-authorized"], false);
  assert.equal(entry.run.spatial.authorizations["radio-check-complete"], false);

  assert.ok(staged.projection.q4.equipment.optional.some((item) => item.ref === "route-marker-kit"));
  assert.match(surfaces.render(staged.projection), /data-testid="select-store-route-marker-kit"/);
  const selected = service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
  assert.equal(selected.ok, true);
  assert.ok(selected.projection.q4.equipment.required.some((item) => item.ref === "route-marker-kit"));
  assert.equal(selected.projection.q4.equipment.optional.some((item) => item.ref === "route-marker-kit"), false);
});

test("fresh production completes Standard outside before one explicit Threshold crossing", () => {
  const { service, world } = fixture(); start(service, world);
  advance(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);

  let result = advance(service, world, "PROCEED");
  assert.equal(result.projection.phase.phase_id, "FACILITY_TRANSIT");
  assert.equal(result.projection.q4.current_location.name, "Threshold Approach");
  assert.deepEqual(result.projection.available_actions[0], { type: "APPROACH", target_required: false, targets: [] });

  result = advance(service, world, "APPROACH");
  assert.equal(result.projection.phase.phase_id, "THRESHOLD");
  assert.equal(result.projection.q4.current_location.name, "Threshold Room");
  assert.deepEqual(result.projection.available_actions[0], { type: "READY", target_required: false, targets: [] });

  result = advance(service, world, "READY");
  assert.equal(result.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(result.projection.q4.current_location.name, "Threshold Room");
  assert.equal(result.projection.q4.radio_check.authorized, true);
  assert.equal(result.projection.q4.radio_check.completed, false);
  assert.equal(result.projection.q4.channels.standard.available, true);
  assert.equal(advance(service, world, "CROSS").error.code, "PHASE_GUARD_REJECTED");

  let entry = service.session(world.id, "field-researcher");
  const complexSide = new Set(["threshold-side-entry", "utility-room", "columned-corridor", "open-passage", "lower-level-transition", "level-2-boundary", "relay-alcove", "records-annex", "service-bypass"]);
  assert.equal(entry.run.spatial.route_history.some((item) => item.connection_id === "threshold-crossing"), false);
  assert.equal(entry.run.spatial.visited_locations.some((id) => complexSide.has(id)), false);

  const statement = "Standard, Clear-Q4 team accounted for outside the Threshold. Radio check.";
  const checked = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: statement });
  assert.equal(checked.ok, true);
  assert.equal(checked.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(checked.projection.q4.current_location.name, "Threshold Room");
  assert.equal(checked.projection.q4.radio_check.completed, true);
  assert.ok(checked.projection.q4.channels.standard.history.some((item) => item.speaker === "You" && item.text === statement));
  assert.deepEqual(checked.projection.available_actions[0], { type: "CROSS", target_required: false, targets: [] });
  entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.spatial.route_history.some((item) => item.connection_id === "threshold-crossing"), false);
  assert.equal(entry.run.spatial.visited_locations.some((id) => complexSide.has(id)), false);

  const beforeRestart = structuredClone({ phase: entry.phase, spatial: entry.run.spatial, radio: entry.run.expedition.radio, statement });
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  entry = restarted.session(world.id, "field-researcher");
  assert.deepEqual({ phase: entry.phase, spatial: entry.run.spatial, radio: entry.run.expedition.radio, statement }, beforeRestart);

  const crossed = restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  assert.equal(crossed.ok, true);
  assert.equal(crossed.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(crossed.projection.q4.current_location.name, "Utility Room");
  entry = restarted.session(world.id, "field-researcher");
  assert.equal(entry.run.spatial.route_history.filter((item) => item.connection_id === "threshold-crossing").length, 1);
  assert.equal(entry.run.spatial.route_history.filter((item) => item.connection_id === "entry-to-utility").length, 1);
  assert.ok(entry.run.spatial.visited_locations.includes("threshold-side-entry"));
  assert.ok(entry.run.spatial.visited_locations.includes("utility-room"));
  assert.ok(Object.values(entry.run.spatial.personnel_locations).every((location) => location === "utility-room"));
  assert.equal(restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).error.code, "PHASE_GUARD_REJECTED");
  assert.equal(entry.run.spatial.route_history.filter((item) => item.connection_id === "threshold-crossing").length, 1);
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

test("staging and its deliberate equipment choice survive shutdown and restart without progress", () => {
  const { service, world } = fixture(); start(service, world);
  advance(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  const beforeEntry = service.session(world.id, "field-researcher");
  const before = structuredClone({
    phase: beforeEntry.phase,
    player_location: beforeEntry.run.spatial.player_location,
    visited_locations: beforeEntry.run.spatial.visited_locations,
    route_history: beforeEntry.run.spatial.route_history,
    authorizations: beforeEntry.run.spatial.authorizations,
    radio: beforeEntry.run.expedition.radio,
    clock: beforeEntry.run.expedition.clock,
    equipment: beforeEntry.run.expedition.equipment,
    optional_stores: beforeEntry.run.expedition.optional_stores
  });
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "STAGING");
  assert.equal(resumed.projection.q4.current_location.name, "Equipment Staging");
  const afterEntry = restarted.session(world.id, "field-researcher");
  assert.deepEqual({
    phase: afterEntry.phase,
    player_location: afterEntry.run.spatial.player_location,
    visited_locations: afterEntry.run.spatial.visited_locations,
    route_history: afterEntry.run.spatial.route_history,
    authorizations: afterEntry.run.spatial.authorizations,
    radio: afterEntry.run.expedition.radio,
    clock: afterEntry.run.expedition.clock,
    equipment: afterEntry.run.expedition.equipment,
    optional_stores: afterEntry.run.expedition.optional_stores
  }, before);
  assert.match(surfaces.render(resumed.projection), /data-testid="q4-preparation-surface"/);
});

test("a legacy-marked briefing save remains loadable and follows the new fresh-run boundary", () => {
  const { service, world } = fixture(); start(service, world);
  const entry = service.session(world.id, "field-researcher");
  entry.legacy_flow = true;
  entry.phase.legacy_flow = true;
  service.persistSession(service.getWorld(world.id), "field-researcher", entry);
  service.shutdown();

  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.projection.phase.phase_id, "BRIEFING");
  assert.deepEqual(resumed.projection.available_actions[0], { type: "READY", target_required: false, targets: [] });
  const staged = restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  assert.equal(staged.ok, true);
  assert.equal(staged.projection.phase.phase_id, "STAGING");
  assert.equal(staged.projection.q4.current_location.name, "Equipment Staging");
  assert.equal(restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }).ok, true);
  assert.equal(restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }).ok, true);
  const legacyCrossed = restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  assert.equal(legacyCrossed.ok, true);
  assert.equal(legacyCrossed.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(legacyCrossed.projection.q4.current_location.name, "Threshold-Side Entry");
  assert.equal(restarted.session(world.id, "field-researcher").run.spatial.route_history.filter((item) => item.connection_id === "threshold-crossing").length, 1);
});

test("renderer wires dedicated confirmation and suppresses pre-field generic inputs", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /confirmQ4Personnel/);
  assert.match(renderer, /q4Prefield/);
  assert.match(renderer, /q4Prefield \? ""/);
});
