"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const profiles = require("../desktop/profile-resolver");
const { DesktopService } = require("../desktop/service");

function sandbox(t, label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yellow-beast-profile-unit-${label}-`));
  t.after(() => { if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: false }); });
  const temporary = path.join(root, "temporary");
  const production = path.join(root, "production-user-data");
  fs.mkdirSync(temporary);
  fs.mkdirSync(production);
  return { root, temporary, production };
}

test("profile resolver requires an explicit marked unique temporary root for packaged tests", (t) => {
  const fixture = sandbox(t, "resolve");
  assert.throws(() => profiles.resolveApplicationProfile({ argv: ["electron", "app", "--renderer-smoke"], testMode: true, productionUserDataRoot: fixture.production }), /explicit --test-profile/);

  const created = profiles.createIsolatedTestProfile("renderer", { productionUserDataRoot: fixture.production, temporaryRoot: fixture.temporary });
  const resolved = profiles.resolveApplicationProfile({ argv: ["electron", "app", "--renderer-smoke", "--test-profile", created.paths.userDataRoot], testMode: true, productionUserDataRoot: fixture.production });
  assert.equal(resolved.kind, "test");
  assert.equal(resolved.runId, created.runId);
  assert.equal(resolved.paths.root, path.join(created.paths.userDataRoot, "yellow-beast"));
  assert.ok(fs.existsSync(created.markerPath));
  assert.equal(JSON.parse(fs.readFileSync(created.markerPath, "utf8")).test_only, true);
  assert.throws(() => profiles.resolveApplicationProfile({ argv: ["electron", "app", "--test-profile", created.paths.userDataRoot], testMode: false, productionUserDataRoot: fixture.production }), /explicit packaged test mode/);

  profiles.cleanupIsolatedTestProfile(created, { productionUserDataRoot: fixture.production, temporaryRoot: fixture.temporary });
  assert.equal(fs.existsSync(created.paths.userDataRoot), false);
});

test("test profiles reject production overlap and cleanup requires launcher identity", (t) => {
  const fixture = sandbox(t, "overlap");
  const nested = path.join(fixture.production, "nested-test");
  fs.mkdirSync(nested);
  assert.throws(() => profiles.validateTestProfile(nested, { productionUserDataRoot: fixture.production, temporaryRoot: fixture.root }), /overlaps the production profile/);
  assert.throws(() => profiles.cleanupIsolatedTestProfile({ kind: "test", paths: { userDataRoot: fixture.temporary } }, { productionUserDataRoot: fixture.production, temporaryRoot: fixture.root }), /exact profile object/);
});

test("one isolated profile persists exactly one world across service restart", (t) => {
  const fixture = sandbox(t, "persistence");
  const createdProfile = profiles.createIsolatedTestProfile("persistence", { productionUserDataRoot: fixture.production, temporaryRoot: fixture.temporary });
  const beforeProduction = profiles.snapshotProfile(fixture.production);
  const first = new DesktopService({ appDataPath: createdProfile.paths.root });
  assert.equal(first.listWorlds().worlds.length, 0);
  const created = first.createWorld({ name: "Runtime profile persistence", seed: "recovery-profile-persistence" });
  assert.equal(created.ok, true);
  assert.equal(first.listWorlds().worlds.length, 1);
  first.shutdown();

  const reopened = new DesktopService({ appDataPath: createdProfile.paths.root });
  const worlds = reopened.listWorlds().worlds;
  assert.equal(worlds.length, 1);
  assert.equal(worlds[0].id, created.world.id);
  assert.equal(worlds[0].name, "Runtime profile persistence");
  assert.equal(reopened.loadWorld({ world_id: created.world.id }).ok, true);
  reopened.shutdown();
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(fixture.production), "unit production fixture");

  profiles.cleanupIsolatedTestProfile(createdProfile, { productionUserDataRoot: fixture.production, temporaryRoot: fixture.temporary });
});

test("profile snapshots detect byte changes without exposing file contents", (t) => {
  const fixture = sandbox(t, "snapshot");
  const file = path.join(fixture.production, "settings.json");
  fs.writeFileSync(file, "one");
  const before = profiles.snapshotProfile(fixture.production);
  assert.deepEqual(Object.keys(before[0]).sort(), ["bytes", "kind", "relative", "sha256"]);
  fs.writeFileSync(file, "two");
  const after = profiles.snapshotProfile(fixture.production);
  assert.throws(() => profiles.assertSnapshotUnchanged(before, after, "production fixture"), /changed/);
});
