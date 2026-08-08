"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const frontier = require("../tools/survey-frontier");
const personnel = require("../tools/q4-personnel");
const continuity = require("../tools/q4-personnel-continuity");

function operation(seed = "continuity") {
  const world = history.createWorld({ seed });
  const started = bootstrap.startRun({ profile: "field-researcher", seed: `${seed}-a`, scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" });
  assert.equal(started.ok, true); const run = bootstrap.enterSpatialField(started.run);
  const player = run.session.startup.player.observer_id;
  const worker = run.expedition.team.members.find((member) => member.personnel_id !== player).personnel_id;
  return { world, run, player, worker };
}
function knownEvent(run, worker, extra = {}) {
  return { id: "known-fixture", category: "fixture", summary: "A documented field condition.", novelty_key: "fixture-condition", operational_importance: 84, perceived_risk: 70, scene: "field", location: run.spatial.personnel_locations[worker], observed_by: [worker], participants: [worker], ...extra };
}

test("repeat coworker retains identity, tendencies, shared history, and legitimately shared geography after an absence", () => {
  const { world, run, player, worker } = operation("repeat-roster");
  const before = structuredClone(history.character(world, worker).continuity.tendencies);
  continuity.recordSharedHistory(world, { run_id: run.run_id, participants: [player, worker], kind: "equipment-transferred", refs: { equipment_id: "field-lamp" }, at: 1 });
  frontier.observe(run.survey_frontier, bootstrap.topologyFor(run), worker, "columned-corridor", { at: 2 });
  world.q4_survey_frontier = structuredClone(run.survey_frontier);

  history.setCharacterStatus(world, { run_id: run.run_id, identity: worker, status: "unavailable", reason: "temporary support assignment" });
  const missed = bootstrap.startRun({ profile: "field-researcher", seed: "repeat-roster-b", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run;
  assert.equal(missed.expedition.team.members.some((member) => member.personnel_id === worker), false);
  const absentOnly = "generated-during-absence";
  frontier.observe(missed.survey_frontier, bootstrap.topologyFor(missed), player, absentOnly, { at: 3 });
  assert.equal(frontier.known(missed.survey_frontier, worker, absentOnly), false);

  history.setCharacterStatus(world, { run_id: missed.run_id, identity: worker, status: "active", reason: "temporary support assignment completed" });
  const returned = bootstrap.startRun({ profile: "field-researcher", seed: "repeat-roster-c", scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" }).run;
  assert.equal(returned.expedition.team.members.some((member) => member.personnel_id === worker), true);
  const record = history.character(world, worker);
  assert.deepEqual(record.continuity.tendencies, before);
  assert.ok(record.continuity.shared_history.some((fact) => fact.kind === "equipment-transferred"));
  assert.equal(frontier.known(returned.survey_frontier, worker, "columned-corridor"), true);
  assert.equal(frontier.known(returned.survey_frontier, worker, absentOnly), false);
});

test("reaction context is observer-safe and only becomes eligible after a legitimate knowledge path", () => {
  const { world, run, player, worker } = operation("observer-boundary");
  const playerOnly = { ...knownEvent(run, player, { id: "player-only", location: run.spatial.personnel_locations[player], observed_by: [player], participants: [player], hidden_objective_state: "must-not-leak" }) };
  const hidden = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: playerOnly });
  assert.equal(hidden.valid, false); assert.equal(hidden.code, "REACTION_EVENT_UNKNOWN");
  assert.equal(JSON.stringify(hidden), JSON.stringify(hidden).replace(/must-not-leak/g, ""));
  const delivered = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: { ...playerOnly, delivered_to: [worker] } });
  assert.equal(delivered.valid, true); assert.doesNotMatch(JSON.stringify(delivered), /hidden_objective_state|must-not-leak/);
  assert.equal(continuity.salience(delivered).eligible, true);
});

test("FAILRP guards reject wrong phase, false co-presence, title state, and undocumented memory", () => {
  const { world, run, player, worker } = operation("failrp");
  const event = knownEvent(run, worker);
  assert.equal(continuity.reactionContext({ world, run, phase: "BRIEFING", worker_id: worker, player_id: player, event }).code, "REACTION_WRONG_PHASE");
  assert.equal(continuity.reactionContext({ world, run, phase: "TITLE", worker_id: worker, player_id: player, event }).code, "REACTION_CONTEXT_UNAVAILABLE");
  run.spatial.personnel_locations[worker] = "columned-corridor";
  const distant = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: { ...event, location: run.spatial.personnel_locations[player], observed_by: [player] } });
  assert.equal(distant.code, "REACTION_EVENT_UNKNOWN");
  const record = history.character(world, worker);
  assert.equal(record.continuity.shared_history.some((fact) => fact.refs?.event_id === "unrecorded"), false);
});

test("salience admits silence, suppresses repetitions, and respects role relevance without knowledge leakage", () => {
  const { world, run, player, worker } = operation("salience");
  const colleague = run.expedition.team.members.find((member) => member.personnel_id !== player && member.personnel_id !== worker && !/survey|route/.test(member.role)).personnel_id;
  const mundane = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: knownEvent(run, worker, { id: "mundane", novelty_key: "mundane", operational_importance: 4, perceived_risk: 0 }) });
  assert.equal(continuity.salience(mundane).category, "silence");
  const significant = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: knownEvent(run, worker, { id: "significant", novelty_key: "significant", role_tags: ["route"] }) });
  assert.ok(continuity.react(world, significant).reaction);
  const repeated = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: knownEvent(run, worker, { id: "significant-again", novelty_key: "significant", role_tags: ["route"] }) });
  assert.equal(continuity.react(world, repeated).reaction, null);
  const unknownToColleague = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: colleague, player_id: player, event: knownEvent(run, worker, { id: "role-event", role_tags: ["route"] }) });
  assert.equal(unknownToColleague.code, "REACTION_EVENT_UNKNOWN");
  const sharedRoute = knownEvent(run, worker, { id: "shared-route", novelty_key: "shared-route", role_tags: ["route"], observed_by: [worker, colleague] });
  const routeSpecialist = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: sharedRoute });
  const nonSpecialist = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: colleague, player_id: player, event: sharedRoute });
  assert.ok(continuity.salience(routeSpecialist).score > continuity.salience(nonSpecialist).score);
});

test("refusal and compliance are deterministic consequences of context", () => {
  const { world, run, worker } = operation("decisions");
  const base = { world, run, phase: "FIELD_OPERATION", worker_id: worker };
  assert.equal(continuity.decide(continuity.decisionContext({ ...base, request: { type: "hold", perceived_risk: 0 } })).state, "accepted");
  assert.equal(continuity.decide(continuity.decisionContext({ ...base, request: { type: "move-to", target_location: "unreachable", reachable: false } })).reason, "ROUTE_UNAVAILABLE");
  assert.equal(continuity.decide(continuity.decisionContext({ ...base, request: { type: "operate", qualification: "nuclear-physics" } })).reason, "QUALIFICATION_REQUIRED");
  assert.equal(continuity.decide(continuity.decisionContext({ ...base, request: { type: "investigate", perceived_risk: 100 } })).reason, "RISK_THRESHOLD");
  assert.equal(continuity.decide(continuity.decisionContext({ ...base, request: { type: "hold", received: false } })).reason, "ORDER_NOT_RECEIVED");
});

test("continuity survives world and run save/reload without rerolling tendencies or reaction suppression", () => {
  const { world, run, player, worker } = operation("reload");
  const context = continuity.reactionContext({ world, run, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: knownEvent(run, worker, { id: "reload-event", novelty_key: "reload-event" }) });
  continuity.react(world, context); const tendencies = structuredClone(history.character(world, worker).continuity.tendencies);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb-personnel-continuity-")), "world.json"); history.saveWorld(file, world);
  const loaded = history.loadWorld(file); const restored = bootstrap.resumeRun(bootstrap.saveRun(run), { world: loaded, spatial_worldpack: "clear-q4", phase: "FIELD_OPERATION" }).run;
  assert.deepEqual(history.character(loaded, worker).continuity.tendencies, tendencies);
  const repeat = continuity.reactionContext({ world: loaded, run: restored, phase: "FIELD_OPERATION", worker_id: worker, player_id: player, event: knownEvent(restored, worker, { id: "reload-event-2", novelty_key: "reload-event" }) });
  assert.equal(continuity.react(loaded, repeat).reaction, null);
});
