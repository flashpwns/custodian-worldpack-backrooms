"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");

function fieldFixture(developerMode = false) {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-pass17-")), developerMode });
  const world = service.createWorld({ name: "Pass 17 human gate", seed: "pass17-human-gate" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" });
  service.confirmQ4Personnel({ world_id: world.id });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "pass17-human-gate" });
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  return { service, world };
}

test("radio check never invents player speech and accepts the actual submitted transmission", () => {
  const { service, world } = fieldFixture();
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.channels.standard.history;
  const rejected = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RADIO_CHECK" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "PLAYER_TRANSMISSION_REQUIRED");
  const after = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4.channels.standard.history;
  assert.deepEqual(after, before);
  const submitted = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4. Team accounted for. Radio check." });
  assert.equal(submitted.ok, true);
  assert.match(submitted.projection.q4.channels.standard.history.at(-1).text, /Radio check/);
});

test("LOCAL broadcasts to nearby personnel without a recipient selector and does not resolve an interval", () => {
  const { service, world } = fieldFixture();
  const before = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection.q4;
  const result = service.submitQ4Communication({ world_id: world.id, channel: "local", text: "Is everyone ready?" });
  assert.equal(result.ok, true);
  assert.equal(result.result.message.state, "delivered");
  assert.equal(result.projection.q4.channels.local.history.at(-1).targets.length, 3);
  assert.equal(result.projection.q4.operational_clock.interval, before.operational_clock.interval);
  assert.match(result.projection.q4.channels.local.history.at(-1).text, /Is everyone ready/);
});

test("developer provenance proves live doctrine source and bounded provider context", async () => {
  const { service, world } = fieldFixture(true);
  const submitted = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I consider the room." });
  assert.equal(submitted.ok, true);
  const records = service.getInterpretationProvenance().records;
  assert.ok(records.length >= 1);
  assert.equal(records.at(-1).provider, "deterministic-mock");
  assert.match(records.at(-1).doctrine, /^[a-f0-9]{64}$/);
  const snapshot = service.getDeveloperSnapshot({ world_id: world.id, mode: "field-researcher" });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.doctrine.source, "SIMULATION_DOCTRINE.md");
  assert.equal(snapshot.doctrine.sha256, records.at(-1).doctrine);
  assert.ok(snapshot.provider_safe_context);
});
