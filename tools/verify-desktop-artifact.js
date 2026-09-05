"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const profiles = require("../desktop/profile-resolver");

const root = path.resolve(__dirname, "..");
const { executable, archive } = require("./desktop-artifact-paths").desktopArtifactPaths(root);

const entry = (suffix) => asar.listPackage(archive).find((item) => item.replace(/\\/g, "/") === suffix);
const readEntry = (suffix) => {
  const item = entry(suffix);
  assert.ok(item, `packaged archive missing ${suffix}`);
  return JSON.parse(asar.extractFile(archive, item.replace(/^[/\\]+/, "")).toString("utf8"));
};
const packagedPackage = readEntry("/package.json");
const packagedBuild = readEntry("/desktop/build-info.json");
const sourceVersion = require("../package.json").version;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(packagedPackage.version, sourceVersion, "packaged application version differs from current source");
assert.equal(packagedBuild.version, sourceVersion, "packaged build record version differs from current source");
assert.equal(packagedBuild.commit, sourceCommit, "packaged build record commit differs from current HEAD");
assert.match(packagedBuild.built_at, /^\d{4}-\d{2}-\d{2}T/);

const productionUserData = profiles.defaultProductionUserDataRoot();
const beforeProduction = profiles.snapshotProfile(productionUserData);

function runIsolated(label, flags, expected, timeout) {
  const profile = profiles.createIsolatedTestProfile(label, { productionUserDataRoot: productionUserData });
  let passed = false;
  try {
    const launchFlags = Array.isArray(flags) ? flags : [flags];
    const result = spawnSync(executable, [...launchFlags, "--test-profile", profile.paths.userDataRoot], { encoding: "utf8", timeout, windowsHide: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, expected);
    profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), `production profile after ${label}`);
    profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
    passed = true;
    return { profile: profile.paths.userDataRoot, output: result.stdout };
  } finally {
    profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile");
    if (!passed) process.stderr.write(`Packaged ${label} profile preserved for diagnosis: ${profile.paths.userDataRoot}\n`);
  }
}

const desktop = runIsolated("desktop", "--desktop-smoke", /desktop_smoke/, 60000);
console.log(JSON.stringify({ desktop_artifact: executable, version: packagedBuild.version, commit: packagedBuild.commit, built_at: packagedBuild.built_at, offline_smoke: "passed", profile: desktop.profile, profile_cleaned: true, production_files_hashed: beforeProduction.length, production_unchanged: true }, null, 2));
const renderer = runIsolated("renderer", ["--renderer-smoke", "--reference-expedition"], /renderer_settings_smoke/, 90000);
console.log(JSON.stringify({ packaged_renderer_interaction: "passed", profile: renderer.profile, profile_cleaned: true, production_unchanged: true }, null, 2));
