"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const history = require("../tools/world-history");
const surfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "q4-personnel") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-personnel-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Personnel continuity", seed }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  assert.equal(started.ok, true);
  return { service, appDataPath, world };
}
function reachField(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
}

test("Clear-Q4 assigns persistent player and teammate identities", () => {
  const { service, world } = fixture();
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.match(projection.q4.player.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.match(projection.q4.team[1].display_name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.notEqual(projection.q4.player.name, projection.q4.team[1].display_name);
  assert.doesNotMatch(JSON.stringify(projection.q4), /Survey Partner|Field researcher|\bResearcher\b/);
});

test("personnel identity and status survive world save/reload and app restart", () => {
  const { service, appDataPath, world } = fixture("q4-personnel-reload");
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4;
  const savedWorld = service.getWorld(world.id);
  const peerId = "yb-field-peer-observer";
  assert.ok(peerId);
  history.setCharacterStatus(savedWorld, { run_id: Object.keys(savedWorld.runs)[0], identity: peerId, status: "missing", reason: "contact lost" });
  service.saveCanonical(savedWorld);
  const restarted = new DesktopService({ appDataPath });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const after = resumed.projection.q4;
  assert.equal(after.team[1].display_name, before.team[1].display_name);
  assert.equal(after.team[1].contact_category, "CONTACT LOST");
  assert.notEqual(after.team[1].contact_category, "DEAD");
});

test("LOCAL uses the named person and follows coarse contact eligibility", () => {
  const { service, world } = fixture("q4-local-personnel");
  reachField(service, world);
  const field = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const peer = field.q4.team[1];
  assert.equal(field.q4.channels.local.available, true);
  assert.equal(field.q4.channels.local.target, peer.first_name);
  const heard = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Are you ready?", target: peer.first_name });
  assert.equal(heard.ok, true);
  assert.match(heard.result.public_reason, new RegExp(`^${peer.first_name}:`));
  const entry = service.session(world.id, "field-researcher");
  entry.run.expedition.team.members[1].contact_category = "SEPARATED";
  entry.run.expedition.team.members[1].status = "unavailable";
  const separated = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Can you hear me?", target: peer.first_name });
  assert.equal(separated.ok, false);
  assert.equal(separated.error.code, "LOCAL_TARGET_UNAVAILABLE");
  assert.equal(history.character(service.getWorld(world.id), "yb-field-peer-observer").status, "active");
});

test("confirmed death is permanent, non-local, and staffed by a different identity later", () => {
  const { service, world } = fixture("q4-death-continuity");
  const first = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const peerId = "yb-field-peer-observer";
  const runId = Object.keys(service.getWorld(world.id).runs)[0];
  const canonical = service.getWorld(world.id);
  assert.equal(history.setCharacterStatus(canonical, { run_id: runId, identity: peerId, status: "dead", reason: "confirmed in history" }).ok, true);
  service.saveCanonical(canonical);
  const restored = new DesktopService({ appDataPath: service.paths.root }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(restored.ok, true);
  assert.equal(restored.projection.q4.team[1].contact_category, "CONTACT LOST");
  assert.equal(restored.projection.q4.channels.local.available, false);
  const local = restored.projection.q4.channels.local;
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Nora?", target: local.target ?? peerId }).ok, false);
  const next = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "q4-next-expedition" });
  assert.equal(next.ok, true);
  const nextPeople = service.session(world.id, "field-researcher").run.expedition.team.members.map((member) => member.personnel_id);
  assert.equal(nextPeople.includes(peerId), false);
  assert.equal(history.character(service.getWorld(world.id), peerId).status, "dead");
  assert.ok(nextPeople.some((identity) => identity !== "yb-field-player"));
});

test("team status is observer-safe and keeps objective death separate from reported contact", () => {
  const { service, world } = fixture("q4-observer-status");
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const status = projection.q4.channels.team_status[1];
  assert.ok(["LOCAL", "NEARBY", "SEPARATED", "REMOTE", "CONTACT LOST", "UNKNOWN"].includes(status.contact_category));
  assert.ok(["Normal", "Appears normal", "Injured", "visibly injured", "Distressed", "Unresponsive", "Unknown"].includes(status.condition));
  assert.equal("position" in status, false);
  assert.equal("health" in status, false);
  const canonical = service.getWorld(world.id);
  const peerId = "yb-field-peer-observer";
  history.setCharacterStatus(canonical, { run_id: Object.keys(canonical.runs)[0], identity: peerId, status: "dead", reason: "objective history" });
  canonical.knowledge.institutional.records["q4-contact-report"] = { id: "q4-contact-report", source_run: Object.keys(canonical.runs)[0], payload: { identity: peerId, status: "contact-lost" } };
  service.saveCanonical(canonical);
  const view = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4;
  assert.equal(view.team[1].contact_category, "CONTACT LOST");
  assert.equal(view.team[1].condition, "Unknown");
  assert.doesNotMatch(surfaces.render(service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection), /dead|deceased|position|health/i);
});
