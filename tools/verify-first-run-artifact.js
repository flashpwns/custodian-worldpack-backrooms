"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const asar = require("@electron/asar");
const profiles = require("../desktop/profile-resolver");

const root = path.resolve(__dirname, "..");
const executable = path.join(root, "dist", "desktop", "win-unpacked", "Yellow Beast.exe");
const archive = path.join(root, "dist", "desktop", "win-unpacked", "resources", "app.asar");
assert.ok(fs.existsSync(executable) && fs.existsSync(archive), "build the packaged executable first");

const packagedEntry = (suffix) => asar.listPackage(archive).find((entry) => entry.replace(/\\/g, "/") === suffix);
const readPackagedJson = (suffix) => {
  const entry = packagedEntry(suffix);
  assert.ok(entry, `packaged archive missing ${suffix}`);
  return JSON.parse(asar.extractFile(archive, entry.replace(/^\\+/, "")).toString("utf8"));
};
const packagedPackage = readPackagedJson("/package.json");
const packagedBuild = readPackagedJson("/desktop/build-info.json");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(packagedPackage.version, require("../package.json").version, "packaged version differs from source");
assert.equal(packagedBuild.commit, sourceCommit, "packaged first-run executable differs from current HEAD");

const productionUserData = profiles.defaultProductionUserDataRoot();
const beforeProduction = profiles.snapshotProfile(productionUserData);
const profile = profiles.createIsolatedTestProfile("first-run", { productionUserDataRoot: productionUserData });
const profileRoot = profile.paths.userDataRoot;
const nonce = `recovery-first-run-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
let passed = false;

function launch(phase) {
  const result = spawnSync(executable, ["--first-run-smoke", "--first-run-phase", phase, "--world-name", nonce, "--test-profile", profileRoot], { encoding: "utf8", timeout: 90000, windowsHide: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /first_run_packaged_smoke/);
  assert.match(result.stdout, new RegExp(`"phase"\\s*:\\s*"${phase}"`));
  return result;
}

try {
  assert.ok(fs.existsSync(profile.markerPath), "test marker was not visible before launch");
  assert.equal(fs.existsSync(profile.paths.root), false, "new test profile contained application data before launch");
  const created = launch("create");
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile after first-run creation");

  const metadata = JSON.parse(fs.readFileSync(profile.paths.metadata, "utf8"));
  const indexed = Object.entries(metadata.worlds ?? {});
  assert.equal(indexed.length, 1, "first-run creation did not persist exactly one indexed world");
  assert.equal(indexed[0][1].name, nonce, "persisted indexed name differs from native input");
  const worldFiles = fs.readdirSync(profile.paths.worlds).filter((name) => name.endsWith(".json") && !name.endsWith(".previous-good"));
  assert.deepEqual(worldFiles, [`${indexed[0][0]}.json`], "first-run creation did not persist exactly one canonical world file");
  const canonical = JSON.parse(fs.readFileSync(path.join(profile.paths.worlds, worldFiles[0]), "utf8"));
  assert.equal(canonical.world_id, indexed[0][0], "canonical world identity differs from the index");

  const reopened = launch("reopen");
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile after first-run reopen");
  const reopenedMetadata = JSON.parse(fs.readFileSync(profile.paths.metadata, "utf8"));
  assert.deepEqual(Object.keys(reopenedMetadata.worlds ?? {}), [indexed[0][0]], "relaunch changed the persisted world set");
  assert.equal(reopenedMetadata.worlds[indexed[0][0]].name, nonce, "relaunch changed the persisted world name");
  profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
  passed = true;
  assert.equal(fs.existsSync(profileRoot), false, "successful first-run profile was not cleaned exactly");
  console.log(JSON.stringify({ first_run_packaged_regression: "passed", executable, packaged_commit: packagedBuild.commit, world_id: indexed[0][0], world_name_nonce: nonce, native_create_phase: /native_keyboard/.test(created.stdout), native_reopen_phase: /native_mouse/.test(reopened.stdout), production_profile: productionUserData, production_files_hashed: beforeProduction.length, production_unchanged: true, test_profile_root: profileRoot, test_profile_cleaned: true }, null, 2));
} finally {
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile");
  if (!passed) process.stderr.write(`First-run test profile preserved for diagnosis: ${profileRoot}\n`);
}
