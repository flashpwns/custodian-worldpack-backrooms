"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const standard = require("../tools/q4-standard-operator");
const team = require("../tools/team-runtime");
const bootstrap = require("../tools/run-bootstrap");

function fixture(seed = "local-standard") { const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-local-standard-")); const service = new DesktopService({ appDataPath }); const world = service.createWorld({ name: "LOCAL and Standard", seed }).world; service.startSession({ world_id: world.id, mode: "field-researcher", seed }); for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true); assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." }).ok, true); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" }).ok, true); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "BEGIN_FIELD_OPERATION" }).ok, true); const entry = service.session(world.id, "field-researcher"); const player = entry.run.session.startup.player.observer_id; const worker = entry.run.expedition.team.members.find((member) => member.personnel_id !== player); return { service, world, entry, player, worker, appDataPath }; }

test("offline LOCAL command becomes a canonical order, is idempotent, and has structured parity", () => {
  const { service, world, entry, worker } = fixture("simple");
  const local = service.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, stay here.`, request_id: "local-simple" });
  assert.equal(local.ok, true); assert.equal(local.result.proposal.noncanonical, true); assert.equal(local.result.results[0].state, "accepted");
  assert.equal(entry.run.expedition.team.members.find((member) => member.personnel_id === worker.personnel_id).current_task.type, "hold");
  const count = entry.run.expedition.team_runtime.orders.length;
  assert.equal(service.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, stay here.`, request_id: "local-simple" }).result.duplicate, true);
  assert.equal(entry.run.expedition.team_runtime.orders.length, count);
  const parallel = fixture("simple-parity"); const direct = team.issueOrder(parallel.entry.run, bootstrap.spatialDefinitionFor(parallel.entry.run.spatial_pack_id), { recipient: parallel.worker.personnel_id, type: "hold", channel: "LOCAL" });
  assert.equal(direct.order.state, local.result.results[0].state);
});

test("an active LOCAL order survives reload without being applied twice", () => {
  const { service, world, worker, appDataPath } = fixture("local-reload");
  const initial = service.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, stay here.`, request_id: "local-reload-order" });
  assert.equal(initial.ok, true);
  const restarted = new DesktopService({ appDataPath });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restored = restarted.session(world.id, "field-researcher");
  const member = restored.run.expedition.team.members.find((item) => item.personnel_id === worker.personnel_id);
  assert.equal(member.current_task.type, "hold");
  const orderCount = restored.run.expedition.team_runtime.orders.length;
  const duplicate = restarted.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, stay here.`, request_id: "local-reload-order" });
  assert.equal(duplicate.ok, true); assert.equal(duplicate.result.duplicate, true);
  assert.equal(restored.run.expedition.team_runtime.orders.length, orderCount);
});

test("LOCAL transfer obeys custody and compound input remains truthful", () => {
  const { service, world, entry, player, worker } = fixture("transfer");
  const lamp = Object.values(entry.run.expedition.equipment).find((item) => item.holder === player && /lamp/i.test(item.label));
  const result = service.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, take the lamp, then wait here.`, request_id: "local-transfer" });
  assert.equal(result.ok, true); assert.equal(result.result.results[0].state, "completed"); assert.equal(lamp.holder, worker.personnel_id);
  assert.ok(result.result.results.some((item) => item.action === "WAIT"));
  assert.equal(service.submitQ4LocalIntent({ world_id: world.id, text: "Take that back there." }).ok, false);
});

test("LOCAL ambiguity and unknown route clarify without mutation", () => {
  const { service, world, entry, worker } = fixture("ambiguity");
  const before = structuredClone(entry.run.expedition.team_runtime.orders);
  const ambiguous = service.submitQ4LocalIntent({ world_id: world.id, text: "Stay here." });
  assert.equal(ambiguous.ok, false); assert.equal(ambiguous.error.code, "LOCAL_RECIPIENT_REQUIRED");
  const unknown = service.submitQ4LocalIntent({ world_id: world.id, text: `${worker.first_name}, go to the columned corridor.` });
  assert.equal(unknown.ok, false); assert.ok(["LOCAL_LOCATION_REQUIRED", "LOCAL_LOCATION_AMBIGUOUS"].includes(unknown.error.code));
  assert.deepEqual(entry.run.expedition.team_runtime.orders, before);
});

test("malformed external LOCAL proposal cannot target hidden state or mutate a team", () => {
  const { entry, worker } = fixture("invalid-proposal"); const localIntent = require("../tools/q4-local-intent");
  const before = structuredClone(entry.run.expedition.team_runtime.orders);
  const result = localIntent.validateProposal({ version: localIntent.VERSION, noncanonical: true, recipient: worker.personnel_id, actions: [{ type: "MOVE", relation: "sequence", location_id: "hidden-objective-room" }] }, { local: [worker], inventory: [], locations: [] });
  assert.equal(result.ok, false); assert.equal(result.code, "LOCAL_LOCATION_INVALID"); assert.deepEqual(entry.run.expedition.team_runtime.orders, before);
});

test("one Standard operator persists and knows only delivered contact", () => {
  const { service, world, entry, appDataPath } = fixture("standard");
  const operator = standard.ensure(service.getWorld(world.id), entry.run.run_id); const initialIdentity = operator.identity;
  const delivered = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled field status check-in." });
  assert.equal(delivered.ok, true); const state = service.getWorld(world.id).q4_standard_operator; assert.equal(state.identity, initialIdentity); assert.ok(state.contacts.length >= 1);
  const context = standard.context(service.getWorld(world.id), { confirmed_knowledge: [{ summary: "Delivered field status" }] });
  assert.doesNotMatch(JSON.stringify(context), /unreported-player-observation/i);
  const radio = entry.run.expedition.equipment["survey-radio"]; radio.holder = "not-player";
  const failed = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Unreported player observation." });
  assert.equal(failed.ok, false); assert.doesNotMatch(JSON.stringify(service.getWorld(world.id).q4_standard_operator.contacts), /Unreported player observation/i);
  const restarted = new DesktopService({ appDataPath }); const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); assert.equal(restarted.getWorld(world.id).q4_standard_operator.identity, initialIdentity);
});

test("legacy Clear-Q4 sessions acquire one deterministic Standard operator on resume", () => {
  const { service, world, appDataPath } = fixture("standard-migration");
  const legacy = service.getWorld(world.id); delete legacy.q4_standard_operator; service.saveCanonical(legacy);
  const restarted = new DesktopService({ appDataPath });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const migrated = restarted.getWorld(world.id).q4_standard_operator;
  assert.ok(migrated?.identity); assert.equal(migrated.contacts.length, 0);
  assert.equal(migrated.identity, standard.ensure(restarted.getWorld(world.id)).identity);
});
