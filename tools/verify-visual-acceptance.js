"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const profiles = require("../desktop/profile-resolver");

const root = path.resolve(__dirname, "..");
const { executable, archive } = require("./desktop-artifact-paths").desktopArtifactPaths(root);

assert.ok(fs.existsSync(executable), `Packaged executable missing: ${executable}`);
assert.ok(fs.existsSync(archive), `Packaged archive missing: ${archive}`);

const productionUserData = profiles.defaultProductionUserDataRoot();
const beforeProduction = profiles.snapshotProfile(productionUserData);

const profile = profiles.createIsolatedTestProfile("visual-acceptance", { productionUserDataRoot: productionUserData });
let passed = false;

try {
  console.log(`Running packaged visual acceptance smoke against ${executable}...`);
  const result = spawnSync(executable, ["--visual-acceptance-smoke", "--test-profile", profile.paths.userDataRoot], {
    encoding: "utf8",
    timeout: 180000,
    windowsHide: true,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", REPO_ROOT: root, SCREENSHOT_DIR: path.join(root, "dist", "screenshots") }
  });

  if (result.status !== 0) {
    console.error("STDOUT:", result.stdout);
    console.error("STDERR:", result.stderr);
    assert.fail(`visual acceptance smoke exited with status ${result.status}`);
  }

  assert.match(result.stdout, /visual_acceptance_smoke/);
  assert.match(result.stdout, /01-facility-broadcast\.png/);
  assert.match(result.stdout, /06-settings-ready-after-install\.png/);

  const screenshotsDir = path.join(root, "dist", "screenshots");
  const expectedFiles = [
    "01-facility-broadcast.png",
    "02-personnel-briefing-first-frame.png",
    "03-coworker-local-interaction.png",
    "04-equipment-staging.png",
    "05-settings-before-install.png",
    "06-settings-ready-after-install.png"
  ];

  for (const filename of expectedFiles) {
    const p1440 = path.join(screenshotsDir, filename);
    const p1024 = path.join(screenshotsDir, "1024x768", filename);
    assert.ok(fs.existsSync(p1440), `Missing screenshot 1440x900: ${filename}`);
    assert.ok(fs.statSync(p1440).size > 1000, `Empty screenshot 1440x900: ${filename}`);
    assert.ok(fs.existsSync(p1024), `Missing screenshot 1024x768: ${filename}`);
    assert.ok(fs.statSync(p1024).size > 1000, `Empty screenshot 1024x768: ${filename}`);
  }

  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile after visual-acceptance");
  profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
  passed = true;

  console.log(JSON.stringify({
    visual_acceptance_verification: "passed",
    packaged_binary: executable,
    screenshots_verified: expectedFiles.length * 2,
    isolated_profile_cleaned: true
  }, null, 2));
} finally {
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile");
  if (!passed) process.stderr.write(`Visual acceptance test profile preserved: ${profile.paths.userDataRoot}\n`);
}
