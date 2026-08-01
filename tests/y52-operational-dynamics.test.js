"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const personnel = require("../tools/personnel-generation");
const dynamics = require("../tools/operational-dynamics");
const operationalTime = require("../tools/operational-time");
const operationalCycle = require("../tools/operational-cycle");
const communications = require("../tools/communication-runtime");
const team = require("../tools/team-runtime");
const consequences = require("../tools/consequence-runtime");
const hazards = require("../tools/hazard-runtime");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const pools = read("data/personnel-name-pools.json");
const clearDynamics = read("data/worldpacks/clear-q4/dynamics.json");
const clearSpatial = read("data/worldpacks/clear-q4/spatial.json");
const minimalDynamics = read("data/worldpacks/minimal-mission/dynamics.json");
const minimalSpatial = read("data/worldpacks/minimal-mission/spatial.json");

function fixture(t, seed = "operational-dynamics") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-operational-dynamics-"));
  const service = new DesktopService({ appDataPath, logger() {} });
  const world = service.createWorld({ name: "Operational dynamics", seed: `${seed}-world` }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  assert.equal(started.ok, true);
  t.after(() => { service.shutdown(); fs.rmSync(appDataPath, { recursive: true, force: true }); });
  return { appDataPath, service, world, projection: started.projection };
}

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""}: ${result.error?.message ?? "rejected"}`);
  return result;
}

function reachField(service, world, { markerKit = false } = {}) {
  action(service, world, "READY");
  if (markerKit) assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) action(service, world, verb);
  return service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
}

function target(projection, verb, text) {
  const actionRecord = projection.available_actions.find((entry) => entry.type === verb);
  assert.ok(actionRecord, `${verb} is available`);
  const selected = actionRecord.targets.find((entry) => String(entry.label).includes(text));
  assert.ok(selected, `${verb} target containing ${text} is available`);
  return selected.ref;
}

test("validated name pools contain at least 500 distinct readable values", () => {
  assert.equal(personnel.validatePools(pools), true);
  assert.ok(pools.first_names.length >= 500 && pools.last_names.length >= 500);
  assert.equal(new Set(pools.first_names).size, pools.first_names.length);
  assert.equal(new Set(pools.last_names).size, pools.last_names.length);
});

test("staffing is seeded, unique, qualified, and bounded to three through five people", () => {
  const player = { display_name: "Taylor Morgan" };
  const first = personnel.generate({ seed: "staff-seed", world_id: "world-a", player, staffing: clearDynamics.staffing });
  const repeated = personnel.generate({ seed: "staff-seed", world_id: "world-a", player, staffing: clearDynamics.staffing });
  const other = personnel.generate({ seed: "staff-seed-two", world_id: "world-a", player, staffing: clearDynamics.staffing });
  assert.deepEqual(repeated, first);
  assert.ok(first.total >= 3 && first.total <= 5);
  assert.equal(first.coworkers.length, first.total - 1);
  assert.equal(new Set(first.coworkers.map((member) => member.display_name)).size, first.coworkers.length);
  assert.ok(first.coworkers.every((member) => member.identity.startsWith("yb-personnel-") && member.role));
  assert.notDeepEqual(other.coworkers.map((member) => member.display_name), first.coworkers.map((member) => member.display_name));
  assert.ok(!first.coworkers.some((member) => member.display_name === player.display_name));
});

test("new desktop runs persist generated identities and restart never rerolls them", (t) => {
  const { appDataPath, service, world, projection } = fixture(t, "persistent-roster");
  const before = projection.q4.team.map((member) => ({ id: member.personnel_id, name: member.display_name, role: member.role }));
  assert.ok(before.length >= 3 && before.length <= 5);
  assert.ok(before.slice(1).every((member) => !["Alex Morgan", "Nora Vale"].includes(member.name)));
  service.shutdown();
  const restarted = new DesktopService({ appDataPath, logger() {} });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.projection.q4.team.map((member) => ({ id: member.personnel_id, name: member.display_name, role: member.role })), before);
  restarted.shutdown();
});

test("migration preserves identities already named Alex or Nora", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "legacy-identities", spatial_worldpack: "clear-q4" }).run;
  Object.assign(run.expedition.team.members[1], { first_name: "Nora", last_name: "Vale", display_name: "Nora Vale" });
  Object.assign(run.expedition.team.members[2], { first_name: "Alex", last_name: "Morgan", display_name: "Alex Morgan" });
  const save = bootstrap.saveRun(run); save.version = "yellow-beast-save@v7";
  const resumed = bootstrap.resumeRun(save, { spatial_worldpack: "clear-q4" });
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.run.expedition.team.members.slice(1, 3).map((member) => member.display_name), ["Nora Vale", "Alex Morgan"]);
});

test("Clear-Q4 and a second minimal pack validate without executable predicates", () => {
  assert.equal(dynamics.validateDefinition(clearDynamics, { spatial: clearSpatial, equipment: ["survey-radio", "route-marker-kit", "survey-instrument", "recording-device", "field-light", "spare-battery", "evidence-sleeves"] }), true);
  assert.equal(dynamics.validateDefinition(minimalDynamics, { spatial: minimalSpatial, equipment: [] }), true);
  const executable = structuredClone(clearDynamics); executable.hazards[0].activation.all[0].javascript = "return true";
  assert.throws(() => dynamics.validateDefinition(executable, { spatial: clearSpatial, equipment: ["survey-radio", "route-marker-kit", "survey-instrument", "recording-device", "field-light", "spare-battery", "evidence-sleeves"] }), /unsupported executable or data field/);
  const unresolved = structuredClone(clearDynamics); unresolved.hazards[0].scope.location_id = "missing-place";
  assert.throws(() => dynamics.validateDefinition(unresolved, { spatial: clearSpatial, equipment: [] }), /does not resolve/);
});

test("one operational clock releases exact, delayed, repeating, and cancelled events once", () => {
  const expedition = { id: "clock-fixture", clock: { interval: 0 } };
  operationalTime.ensure(expedition);
  assert.equal(expedition.clock, expedition.operational.clock);
  operationalTime.schedule(expedition, { id: "exact", event_type: "environment.exact", scheduled_interval: 2, repeating: 2, payload: { value: 1 } });
  operationalTime.schedule(expedition, { id: "cancel-me", event_type: "environment.cancel", delay: 3 });
  assert.equal(operationalTime.cancel(expedition, "cancel-me", "no longer required").ok, true);
  operationalTime.advance(expedition, 1, "first-action");
  assert.deepEqual(operationalTime.resolveDue(expedition, () => ({ status: "completed" })), []);
  operationalTime.advance(expedition, 1, "second-action");
  assert.equal(operationalTime.resolveDue(expedition, () => ({ status: "completed", reason: "due" })).length, 1);
  assert.equal(operationalTime.resolveDue(expedition, () => ({ status: "completed" })).length, 0);
  assert.ok(expedition.operational.events.some((event) => event.id === "exact@4" && event.status === "scheduled"));
  assert.equal(expedition.operational.events.find((event) => event.id === "cancel-me").status, "cancelled");
});

test("an operational-delay consequence advances the shared clock and drains newly due events in the same cycle", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "consequence-delay", spatial_worldpack: "clear-q4" }).run;
  bootstrap.enterSpatialField(run);
  const definition = structuredClone(clearDynamics);
  definition.hazards[0].scope = { location_id: "utility-room" };
  definition.hazards[0].detection = { source: "spatial", predicate: "actor_at_location", location_id: "utility-room" };
  definition.hazards[0].activation = { source: "time", predicate: "interval_reached", amount: 1 };
  definition.hazards[0].exposure = { all: [{ source: "spatial", predicate: "actor_at_location", location_id: "utility-room" }, { source: "hazard", predicate: "state_is", hazard_id: "overhead-service-bracket", state: "active" }] };
  definition.consequence_sets[0].effects = [{ kind: "operational-delay", amount: 2, reason: "field stabilization delay" }];
  operationalTime.schedule(run.expedition, { id: "cascade-event", event_type: "environment.cascade", scheduled_interval: 2 });
  const resolved = operationalCycle.resolve(run, definition, clearSpatial, { action: "TEST_DELAY", cost: 1 });
  assert.equal(run.expedition.clock.interval, 3);
  assert.equal(resolved.clock.action_cost, 1);
  assert.equal(resolved.clock.consequence_delay, 2);
  assert.equal(resolved.clock.cost, 3);
  assert.equal(run.expedition.operational.events.find((event) => event.id === "cascade-event").status, "completed");
  assert.equal(resolved.scheduled_events.filter((event) => event.event_id === "cascade-event").length, 1);
});

test("teammates can assist and originate truthful LOCAL and radio messages", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "teammate-actions", spatial_worldpack: "clear-q4" }).run;
  bootstrap.enterSpatialField(run);
  const player = run.session.startup.player.observer_id;
  const assistant = run.expedition.team.members[1]; const injured = run.expedition.team.members[2];
  injured.condition = "minor injury"; injured.health = "minor injury";
  assert.equal(team.issueOrder(run, clearSpatial, { recipient: assistant.personnel_id, type: "assist", target: injured.personnel_id }).order.state, "accepted");
  team.decide(run, clearSpatial, clearDynamics);
  assert.equal(injured.condition, "stabilized minor injury");
  assert.equal(team.issueOrder(run, clearSpatial, { recipient: assistant.personnel_id, type: "communicate-local", target: player }).order.state, "accepted");
  team.decide(run, clearSpatial, clearDynamics);
  assert.equal(run.expedition.messages.at(-1).state, "delivered");
  assert.equal(communications.project(run.expedition).messages.at(-1).sender, assistant.display_name);
  run.expedition.equipment["survey-radio"].holder = assistant.personnel_id;
  assert.equal(team.issueOrder(run, clearSpatial, { recipient: assistant.personnel_id, type: "transmit-radio", target: "Standard" }).order.state, "accepted");
  team.decide(run, clearSpatial, clearDynamics);
  assert.equal(run.expedition.messages.at(-1).state, "queued");
  assert.equal(communications.project(run.expedition).messages.at(-1).sender, assistant.display_name);
});

test("accepted orders use a real route and last-known projection hides remote consequences", (t) => {
  const { service, world } = fixture(t, "team-separation");
  let projection = reachField(service, world);
  const orderTarget = target(projection, "ORDER_INVESTIGATE", "Columned Corridor");
  const ordered = action(service, world, "ORDER_INVESTIGATE", orderTarget);
  assert.equal(ordered.result.outcome, "accepted");
  projection = ordered.projection;
  const remote = projection.q4.team.find((member) => !member.controlled && member.contact_state === "CONTACT LOST");
  assert.ok(remote);
  assert.equal(remote.current_or_last_known_location, "columned-corridor");
  assert.equal(remote.condition.toLowerCase(), "normal", "remote injury is not leaked");
  const canonical = service.session(world.id, "field-researcher").run.expedition.team.members.find((member) => member.first_name === remote.first_name && member.last_name === remote.last_name);
  assert.equal(canonical.condition, "minor injury");
  assert.equal(canonical.movement_history.length, 1);
  assert.equal(canonical.movement_history[0].connection_id, "utility-to-corridor");
  assert.equal(projection.q4.hazards.length, 0, "remote hazard remains hidden");
});

test("LOCAL reaches only people in speaking range and failed delivery is persistent", (t) => {
  const { service, world } = fixture(t, "local-range");
  let projection = reachField(service, world);
  const orderTarget = target(projection, "ORDER_INVESTIGATE", "Columned Corridor");
  projection = action(service, world, "ORDER_INVESTIGATE", orderTarget).projection;
  const remote = projection.q4.team.find((member) => member.contact_state === "CONTACT LOST");
  const unheard = service.submitQ4Communication({ world_id: world.id, channel: "local", target: remote.personnel_id, text: "Report your status." });
  assert.equal(unheard.ok, false);
  const expedition = service.session(world.id, "field-researcher").run.expedition;
  assert.equal(expedition.messages.at(-1).state, "failed");
  const heard = service.submitQ4Communication({ world_id: world.id, channel: "local", target: "team", text: "Hold local accountability." });
  assert.equal(heard.ok, true);
  const localMessage = service.session(world.id, "field-researcher").run.expedition.messages.at(-1);
  assert.equal(localMessage.state, "delivered");
  assert.ok(localMessage.actual_recipients.length >= 1);
  assert.ok(!localMessage.actual_recipients.includes(remote.personnel_id));
});

test("reunion reveals the hazard consequence, supports a grounded delay, and permits recovery", (t) => {
  const { service, world } = fixture(t, "hazard-recovery");
  let projection = reachField(service, world, { markerKit: true });
  projection = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", "Columned Corridor")).projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Columned Corridor")).projection;
  const injured = projection.q4.team.find((member) => /injur/i.test(member.condition));
  assert.ok(injured);
  assert.match(projection.q4.hazards[0].observed_change, /shifted and struck/i);
  assert.ok(projection.available_actions.some((entry) => entry.type === "ASSIST"));
  assert.ok(projection.available_actions.some((entry) => entry.type === "RECOVER"));
  const delayedTarget = target(projection, "ORDER_INVESTIGATE", injured.first_name);
  const delayed = action(service, world, "ORDER_INVESTIGATE", delayedTarget);
  assert.equal(delayed.result.outcome, "delayed");
  assert.match(delayed.result.public_reason, /field assistance/i);
  projection = action(service, world, "ASSIST", target(delayed.projection, "ASSIST", injured.first_name)).projection;
  projection = action(service, world, "RECOVER", target(projection, "RECOVER", "survey instrument")).projection;
  const run = service.session(world.id, "field-researcher").run;
  assert.equal(run.expedition.equipment["survey-instrument"].state, "operational");
  assert.equal(run.expedition.equipment["survey-instrument"].holder, run.session.startup.player.observer_id);
  assert.ok(run.expedition.operational.consequences.some((record) => record.recovery));
});

test("interference delays a check-in past its deadline and a late delivery recovers the objective", (t) => {
  const { service, world } = fixture(t, "late-check-in");
  let projection = reachField(service, world);
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Columned Corridor")).projection;
  const sent = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled field status check-in." });
  assert.equal(sent.ok, true);
  assert.equal(sent.result.message.state, "delayed");
  assert.equal(sent.projection.q4.communications.check_ins[0].state, "transmitting");
  projection = sent.projection;
  const checkIn = sent.projection.q4.communications.check_ins[0];
  while (projection.q4.operational_clock.interval <= checkIn.due_at) projection = action(service, world, "WAIT").projection;
  assert.equal(projection.q4.communications.check_ins[0].state, "overdue");
  while (projection.q4.operational_clock.interval < checkIn.due_at + 2) projection = action(service, world, "WAIT").projection;
  assert.equal(projection.q4.communications.check_ins[0].state, "missed");
  assert.equal(service.session(world.id, "field-researcher").run.expedition.mission_state.objectives["maintain-check-ins"].state, "failed");
  const checkInMessageId = sent.result.message.id;
  while (projection.q4.communications.messages.find((message) => message.id === checkInMessageId).state !== "delivered") projection = action(service, world, "WAIT").projection;
  assert.equal(projection.q4.communications.check_ins[0].state, "completed");
  assert.equal(projection.q4.communications.messages.at(-1).state, "delivered");
  assert.equal(service.session(world.id, "field-researcher").run.expedition.mission_state.objectives["maintain-check-ins"].state, "satisfied");
  assert.ok(service.session(world.id, "field-researcher").run.expedition.communications.check_ins[0].history.some((entry) => entry.to === "missed"));
});

test("invalid consequence proposals commit nothing and irreversible outcomes cannot recover", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "atomic-consequence", spatial_worldpack: "clear-q4" }).run;
  bootstrap.enterSpatialField(run);
  const coworker = run.expedition.team.members[1].personnel_id;
  const before = structuredClone({ team: run.expedition.team, equipment: run.expedition.equipment, spatial: run.spatial });
  const invalid = consequences.apply(run, { source: "invalid", effects: [{ kind: "personnel-condition", target: coworker, condition: "minor injury" }, { kind: "equipment-state", target: "missing-device", state: "damaged" }] });
  assert.equal(invalid.ok, false);
  assert.deepEqual({ team: run.expedition.team, equipment: run.expedition.equipment, spatial: run.spatial }, before);
  assert.equal(consequences.apply(run, { source: "irreversible", classification: "irreversible-failure", effects: [{ kind: "personnel-condition", target: coworker, condition: "dead" }] }).ok, true);
  const revive = consequences.apply(run, { source: "invalid-recovery", effects: [{ kind: "personnel-condition", target: coworker, condition: "uninjured" }] });
  assert.equal(revive.code, "CONSEQUENCE_PERSONNEL_IRREVERSIBLE");
  assert.equal(run.expedition.team.members[1].condition, "dead");
});

test("route consequences block real movement and recoverable blocks can be cleared", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "route-block", spatial_worldpack: "clear-q4" }).run;
  bootstrap.enterSpatialField(run);
  const blocked = consequences.apply(run, { source: "route-test", effects: [{ kind: "route-blocked", connection_id: "utility-to-corridor", state: "temporarily-blocked", reason: "test obstruction" }] });
  assert.equal(blocked.ok, true);
  const move = bootstrap.act(run, "MOVE", "WEST — Columned Corridor");
  assert.equal(move.ok, false);
  assert.equal(consequences.clearRoute(run, "utility-to-corridor", run.session.startup.player.observer_id).ok, true);
  assert.equal(bootstrap.act(run, "MOVE", "WEST — Columned Corridor").ok, true);
});

test("operational state, identities, messages, hazards, decisions, and consequences survive restart exactly", (t) => {
  const { appDataPath, service, world } = fixture(t, "operational-restart");
  let projection = reachField(service, world);
  projection = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", "Columned Corridor")).projection;
  const beforeRun = service.session(world.id, "field-researcher").run;
  const before = structuredClone({ clock: beforeRun.expedition.operational.clock, events: beforeRun.expedition.operational.events, messages: beforeRun.expedition.messages, team: beforeRun.expedition.team, runtime: beforeRun.expedition.team_runtime, hazards: beforeRun.expedition.hazards, consequences: beforeRun.expedition.operational.consequences, spatial: beforeRun.spatial });
  service.shutdown();
  const restarted = new DesktopService({ appDataPath, logger() {} });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const afterRun = restarted.session(world.id, "field-researcher").run;
  assert.deepEqual({ clock: afterRun.expedition.operational.clock, events: afterRun.expedition.operational.events, messages: afterRun.expedition.messages, team: afterRun.expedition.team, runtime: afterRun.expedition.team_runtime, hazards: afterRun.expedition.hazards, consequences: afterRun.expedition.operational.consequences, spatial: afterRun.spatial }, before);
  assert.match(surfaces.render(resumed.projection), /CONTACT LOST/);
  assert.doesNotMatch(surfaces.render(resumed.projection), /minor injury/i, "post-restart renderer retains last-known filtering");
  restarted.shutdown();
});

test("observer projection and renderer presentation are side-effect free", (t) => {
  const { service, world } = fixture(t, "projection-purity");
  reachField(service, world);
  const before = bootstrap.saveRun(service.session(world.id, "field-researcher").run);
  const first = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const second = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  surfaces.render(first);
  surfaces.render(second);
  const after = bootstrap.saveRun(service.session(world.id, "field-researcher").run);
  assert.deepEqual(after, before);
});

test("message failure and observer-safe hazard projection never exist only as narration", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "state-not-prose", spatial_worldpack: "clear-q4" }).run;
  bootstrap.enterSpatialField(run);
  const failed = communications.failRadio(run.expedition, { sender: run.session.startup.player.observer_id, text: "Unable to transmit.", reason: "Radio disabled." });
  assert.equal(failed.message.state, "failed");
  assert.equal(failed.message.failure_reason, "Radio disabled.");
  const runtime = hazards.ensure(run, clearDynamics);
  assert.equal(hazards.project(run, clearDynamics).length, 0);
  assert.equal(runtime.states["overhead-service-bracket"].state, "dormant");
});
