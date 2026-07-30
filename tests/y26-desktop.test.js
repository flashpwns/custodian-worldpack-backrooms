"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService, MODES } = require("../desktop/service");

function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-desktop-")); return { root, service: new DesktopService({ appDataPath: root }) }; }
test("desktop service supports offline first-run world and field lifecycle", () => {
  const { root, service } = fixture();
  assert.equal(service.getAppInfo().app.first_run_complete, false);
  const created = service.createWorld({ name: "Test World", seed: "desktop-test" }); assert.equal(created.ok, true);
  assert.equal(service.listWorlds().worlds.length, 1); assert.equal(service.listModes().modes.length, 4);
  const started = service.startSession({ world_id: created.world.id, mode: "field-researcher", seed: "field-test" }); assert.equal(started.ok, true); assert.equal(started.projection.gameplay.version, "yellow-beast-gameplay-projection@v1");
  const action = service.submitAction({ world_id: created.world.id, mode: "field-researcher", action: "LOOK" }); assert.equal(action.ok, true);
  assert.equal(service.saveWorld({ world_id: created.world.id }).ok, true);
  const resumed = new DesktopService({ appDataPath: root }).resumeSession({ world_id: created.world.id, mode: "field-researcher" }); assert.equal(resumed.ok, true); assert.equal(resumed.projection.world.id, created.world.id);
});
test("desktop world metadata, settings, export/import, and deletion stay isolated", () => {
  const { root, service } = fixture(); const one = service.createWorld({ name: "One", seed: "one" }); const two = service.createWorld({ name: "Two", seed: "two" });
  assert.notEqual(one.world.id, two.world.id); assert.equal(service.updateSettings({ settings: { theme: "dark", provider: "offline" } }).settings.theme, "dark");
  const exportFile = path.join(root, "one.yellow-beast.json"); assert.equal(service.exportWorld({ world_id: one.world.id, destination: exportFile }).ok, true);
  assert.equal(service.importWorld({ source: exportFile }).ok, false, "identity conflicts are rejected");
  assert.equal(service.deleteWorld({ world_id: one.world.id }).ok, false, "confirmation is required"); assert.equal(service.deleteWorld({ world_id: one.world.id, confirmed: true }).ok, true);
  assert.equal(service.listWorlds().worlds.length, 1); assert.equal(service.loadWorld({ world_id: two.world.id }).ok, true);
});
test("desktop service exposes only allowlisted modes and canonical action results", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Actions", seed: "actions" }).world;
  assert.deepEqual(MODES.map(({ id }) => id), ["async-command", "field-researcher", "local-anomaly", "lost"]);
  const started = service.startSession({ world_id: world.id, mode: "lost", seed: "lost" }); assert.equal(started.ok, true);
  const unavailable = service.submitAction({ world_id: world.id, mode: "lost", action: "ARBITRARY_FILESYSTEM" }); assert.equal(unavailable.ok, false); assert.equal(unavailable.error.code, "ACTION_UNAVAILABLE");
  assert.equal(service.getInstitutionProjection({ world_id: world.id }).ok, true);
});
