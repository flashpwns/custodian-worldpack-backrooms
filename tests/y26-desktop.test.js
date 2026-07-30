"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService, MODES } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

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
test("mode-specific surfaces render only their safe desktop projections", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Surfaces", seed: "surfaces" }).world;
  for (const mode of MODES.map(({ id }) => id)) {
    const started = service.startSession({ world_id: world.id, mode, seed: `${mode}-seed` }); assert.equal(started.ok, true, mode);
    const html = surfaces.render(started.projection); assert.match(html, new RegExp(`surface-${mode === "async-command" ? "beck" : mode === "field-researcher" ? "clear-q4" : mode === "local-anomaly" ? "nullzone" : mode}`));
    assert.doesNotMatch(html, /<pre>/, `${mode} never renders a raw JSON dump`);
  }
  const lostProjection = service.getGameplayProjection({ world_id: world.id, mode: "lost" }).projection;
  const lostHtml = surfaces.render(lostProjection); assert.doesNotMatch(lostHtml, /Task tray|Institutional timeline|research|personnel/i, "Lost receives no institutional workstation data");
  const nullzoneProjection = service.getGameplayProjection({ world_id: world.id, mode: "local-anomaly" }).projection;
  assert.doesNotMatch(surfaces.render(nullzoneProjection), /Task tray|Institutional timeline|personnel/i, "Nullzone receives no Beck data");
  assert.deepEqual(Object.keys(surfaces.CAPABILITIES), MODES.map(({ id }) => id));
});
test("safe action targets travel from projection to canonical runtime without command parsing", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Action targets", seed: "targets" }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "targets" }); const move = started.projection.available_actions.find((item) => item.type === "MOVE");
  assert.ok(move.targets.length > 0); const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: move.type, target: move.targets[0].ref }); assert.equal(result.ok, true);
  assert.equal(result.projection.version, "yellow-beast-desktop-projection@v1");
});
test("one desktop world retains canonical state while every mode uses an offline structured action", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Shared desktop world", seed: "shared" }).world;
  const field = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "field" }); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" }).ok, true);
  const beck = service.startSession({ world_id: world.id, mode: "async-command", seed: "beck" }); assert.equal(service.submitAction({ world_id: world.id, mode: "async-command", action: "ADVANCE" }).ok, true);
  const civilian = service.startSession({ world_id: world.id, mode: "local-anomaly", seed: "civilian" }); assert.equal(service.submitAction({ world_id: world.id, mode: "local-anomaly", action: "DISCOVER" }).ok, true);
  const stranded = service.startSession({ world_id: world.id, mode: "lost", seed: "lost" }); assert.equal(service.submitAction({ world_id: world.id, mode: "lost", action: "STRAND" }).ok, true);
  assert.equal(field.projection.world.id, beck.projection.world.id); assert.equal(beck.projection.world.id, civilian.projection.world.id); assert.equal(civilian.projection.world.id, stranded.projection.world.id);
  const reopened = new DesktopService({ appDataPath: root }); assert.equal(reopened.loadWorld({ world_id: world.id }).ok, true); assert.equal(reopened.listWorlds().worlds.length, 1);
});
