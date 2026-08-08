"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const os = require("node:os");
const { DesktopService } = require("../desktop/service");
const frontier = require("../tools/survey-frontier");
const bootstrap = require("../tools/run-bootstrap");

const definition = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "worldpacks", "clear-q4", "spatial.json"), "utf8"));

test("Survey Frontier keeps player, teammate, Standard, and historical geography distinct", () => {
  const state = frontier.create(definition, { player: "jack", personnel: ["ellis"] });
  frontier.observe(state, definition, "jack", "utility-room", { at: 1 });
  assert.equal(frontier.known(state, "jack", "utility-room"), true);
  assert.equal(frontier.standardMap(state, definition).nodes.some((node) => node.id === "utility-room"), false);

  frontier.observe(state, definition, "ellis", "columned-corridor", { at: 2 });
  assert.equal(frontier.known(state, "ellis", "columned-corridor"), true);
  assert.equal(frontier.known(state, "jack", "columned-corridor"), false);
  frontier.share(state, "ellis", "jack", { at: 3 });
  assert.equal(frontier.map(state, definition, "jack").nodes.find((node) => node.id === "columned-corridor").provenance, "teammate-communication");

  const playerMap = frontier.map(state, definition, "jack", { current_location: "utility-room" });
  assert.equal(playerMap.historical_claims[0].status, "PRIOR_RECORD_ONLY");
  frontier.report(state, "jack", { at: 4, message_id: "reported-route" });
  assert.equal(frontier.standardMap(state, definition).nodes.find((node) => node.id === "utility-room").status, "REPORTED");
  assert.ok(frontier.frontier(state, definition, "jack").length > 0);
});

test("Survey Frontier persists and legacy saves migrate without fabricating teammate or Standard knowledge", () => {
  const started = bootstrap.startRun({ profile: "field-researcher", seed: "frontier-save", spatial_worldpack: "clear-q4" });
  assert.equal(started.ok, true);
  const run = bootstrap.enterSpatialField(started.run);
  const player = run.session.startup.player.observer_id;
  frontier.observe(run.survey_frontier, definition, player, "utility-room", { at: 1 });
  frontier.report(run.survey_frontier, player, { at: 2, message_id: "route-report" });
  const restored = bootstrap.resumeRun(bootstrap.saveRun(run), { spatial_worldpack: "clear-q4", phase: "FIELD_OPERATION" });
  assert.equal(restored.ok, true);
  assert.equal(frontier.known(restored.run.survey_frontier, player, "utility-room"), true);
  assert.equal(frontier.standardMap(restored.run.survey_frontier, definition).nodes.some((node) => node.id === "utility-room"), true);

  const old = bootstrap.saveRun(run); delete old.survey_frontier;
  const migrated = bootstrap.resumeRun(old, { spatial_worldpack: "clear-q4", phase: "FIELD_OPERATION" });
  const peer = migrated.run.expedition.team.members.find((member) => member.personnel_id !== player).personnel_id;
  assert.equal(frontier.known(migrated.run.survey_frontier, peer, "columned-corridor"), false);
});

test("a delivered Standard survey report, not player movement, updates the institutional spatial record", () => {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-frontier-radio-")) });
  const world = service.createWorld({ name: "Frontier radio", seed: "frontier-radio" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }); service.confirmQ4Personnel({ world_id: world.id });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "frontier-radio", require_personnel: true });
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "BEGIN_FIELD_OPERATION" }).ok, true);
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(projection.q4.map.nodes.some((node) => node.id === "utility-room"), true);
  assert.equal(projection.q4.standard_spatial_record.nodes.some((node) => node.id === "utility-room"), false);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Survey report: utility room and west corridor route observed." }).ok, true);
  for (let turns = 0; turns < 5; turns += 1) { projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection; if (projection.q4.standard_spatial_record.nodes.some((node) => node.id === "utility-room")) break; assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" }).ok, true); }
  assert.equal(projection.q4.standard_spatial_record.nodes.find((node) => node.id === "utility-room").status, "REPORTED");
});
