"use strict";
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const profiles = require("../desktop/profile-resolver");

test("actual Electron renderer opens, focuses, saves, closes, and reopens Settings", { timeout: 30000 }, () => {
  const electron = require("electron");
  const productionUserData = profiles.defaultProductionUserDataRoot();
  const beforeProduction = profiles.snapshotProfile(productionUserData);
  const profile = profiles.createIsolatedTestProfile("source-renderer", { productionUserDataRoot: productionUserData });
  let passed = false;
  try {
    const result = childProcess.spawnSync(electron, [path.join(__dirname, "..", "desktop", "main.js"), "--renderer-smoke", "--test-profile", profile.paths.userDataRoot], { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 30000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /renderer_settings_smoke/);
    profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile after source renderer smoke");
    passed = true;
  } finally {
    profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile");
    if (passed) profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
  }
});
