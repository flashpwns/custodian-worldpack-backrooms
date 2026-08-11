"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TEST_PROFILE_MARKER = "yellow-beast-test-profile.json";
const TEST_PROFILE_VERSION = "yellow-beast-test-profile@v1";
const APPLICATION_DATA_DIRECTORY = "yellow-beast";

function absolute(value, label) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(value);
}

function comparable(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameOrWithin(candidate, parent) {
  const relative = path.relative(comparable(parent), comparable(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function strictChild(candidate, parent) {
  return comparable(candidate) !== comparable(parent) && sameOrWithin(candidate, parent);
}

function defaultProductionUserDataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === "win32") {
    if (!env.APPDATA) throw new Error("APPDATA is required to resolve the Windows production profile.");
    return path.resolve(env.APPDATA, "yellow-beast");
  }
  if (platform === "darwin") return path.resolve(home, "Library", "Application Support", "yellow-beast");
  return path.resolve(env.XDG_CONFIG_HOME || path.join(home, ".config"), "yellow-beast");
}

function profilePaths(userDataRoot) {
  const resolvedUserData = absolute(userDataRoot, "Electron userData");
  const root = path.join(resolvedUserData, APPLICATION_DATA_DIRECTORY);
  return Object.freeze({
    userDataRoot: resolvedUserData,
    root,
    worlds: path.join(root, "worlds"),
    saves: path.join(root, "saves"),
    logs: path.join(root, "logs"),
    media: path.join(root, "media"),
    credentials: path.join(root, "credentials"),
    config: path.join(root, "config.json"),
    settings: path.join(root, "desktop-settings.json"),
    metadata: path.join(root, "desktop-worlds.json")
  });
}

function readMarker(userDataRoot) {
  const markerPath = path.join(userDataRoot, TEST_PROFILE_MARKER);
  if (!fs.existsSync(markerPath)) throw new Error(`Test profile marker is missing: ${markerPath}`);
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { throw new Error(`Test profile marker is invalid: ${markerPath}`); }
  if (marker?.version !== TEST_PROFILE_VERSION || marker?.purpose !== "automated-test-only" || marker?.test_only !== true) throw new Error(`Test profile marker is not authoritative: ${markerPath}`);
  if (comparable(marker.user_data_root) !== comparable(userDataRoot)) throw new Error("Test profile marker does not match its resolved root.");
  if (typeof marker.run_id !== "string" || !marker.run_id) throw new Error("Test profile marker has no run identity.");
  return { marker, markerPath };
}

function validateTestProfile(userDataRoot, { productionUserDataRoot = defaultProductionUserDataRoot(), temporaryRoot = os.tmpdir() } = {}) {
  const requested = absolute(userDataRoot, "Test profile");
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) throw new Error("Test profile must be an existing directory created by its launcher.");
  const resolved = fs.realpathSync.native(requested);
  const resolvedTemporary = fs.realpathSync.native(absolute(temporaryRoot, "Temporary root"));
  const production = absolute(productionUserDataRoot, "Production userData");
  if (!strictChild(resolved, resolvedTemporary)) throw new Error("Test profile must be a strict child of the OS temporary directory.");
  if (sameOrWithin(resolved, production) || sameOrWithin(production, resolved)) throw new Error("Test profile overlaps the production profile.");
  const { marker, markerPath } = readMarker(resolved);
  return Object.freeze({ kind: "test", test: true, runId: marker.run_id, markerPath, paths: profilePaths(resolved) });
}

function argumentValue(argv, flag) {
  const indexes = argv.map((value, index) => value === flag ? index : -1).filter((index) => index >= 0);
  if (indexes.length > 1) throw new Error(`${flag} may be supplied only once.`);
  if (!indexes.length) return null;
  const value = argv[indexes[0] + 1];
  if (!value || String(value).startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function resolveApplicationProfile({ argv = process.argv, testMode = false, productionUserDataRoot } = {}) {
  const productionRoot = absolute(productionUserDataRoot ?? defaultProductionUserDataRoot(), "Production userData");
  const requestedTestProfile = argumentValue(argv, "--test-profile");
  if (testMode && !requestedTestProfile) throw new Error("Packaged test mode requires an explicit --test-profile.");
  if (!testMode && requestedTestProfile) throw new Error("--test-profile is available only to an explicit packaged test mode.");
  if (testMode) return validateTestProfile(requestedTestProfile, { productionUserDataRoot: productionRoot });
  const paths = profilePaths(productionRoot);
  if (fs.existsSync(path.join(paths.userDataRoot, TEST_PROFILE_MARKER)) || fs.existsSync(path.join(paths.root, TEST_PROFILE_MARKER))) throw new Error("Production launch refused: test profile marker detected.");
  return Object.freeze({ kind: "production", test: false, runId: null, markerPath: null, paths });
}

function createIsolatedTestProfile(label, { productionUserDataRoot = defaultProductionUserDataRoot(), temporaryRoot = os.tmpdir() } = {}) {
  if (typeof label !== "string" || !/^[a-z0-9-]{1,40}$/i.test(label)) throw new Error("Test profile label is invalid.");
  const resolvedTemporary = fs.realpathSync.native(absolute(temporaryRoot, "Temporary root"));
  const requested = fs.mkdtempSync(path.join(resolvedTemporary, `yellow-beast-${label}-${process.pid}-`));
  const resolved = fs.realpathSync.native(requested);
  const production = absolute(productionUserDataRoot, "Production userData");
  if (!strictChild(resolved, resolvedTemporary) || sameOrWithin(resolved, production) || sameOrWithin(production, resolved)) throw new Error("Created test profile failed isolation checks.");
  const runId = crypto.randomUUID();
  const markerPath = path.join(resolved, TEST_PROFILE_MARKER);
  fs.writeFileSync(markerPath, `${JSON.stringify({ version: TEST_PROFILE_VERSION, purpose: "automated-test-only", test_only: true, run_id: runId, label, created_at: new Date().toISOString(), user_data_root: resolved, application_data_root: path.join(resolved, APPLICATION_DATA_DIRECTORY) }, null, 2)}\n`, { flag: "wx" });
  return Object.freeze({ kind: "test", test: true, runId, markerPath, createdByLauncher: true, paths: profilePaths(resolved) });
}

function cleanupIsolatedTestProfile(profile, { productionUserDataRoot = defaultProductionUserDataRoot(), temporaryRoot = os.tmpdir() } = {}) {
  if (!profile?.createdByLauncher || profile?.kind !== "test") throw new Error("Cleanup requires the exact profile object created by this launcher.");
  const validated = validateTestProfile(profile.paths.userDataRoot, { productionUserDataRoot, temporaryRoot });
  if (validated.runId !== profile.runId || comparable(validated.paths.userDataRoot) !== comparable(profile.paths.userDataRoot)) throw new Error("Cleanup profile identity changed.");
  fs.rmSync(validated.paths.userDataRoot, { recursive: true, force: false });
  if (fs.existsSync(validated.paths.userDataRoot)) throw new Error("Test profile cleanup did not complete.");
}

function snapshotProfile(userDataRoot) {
  const root = absolute(userDataRoot, "Profile snapshot root");
  if (!fs.existsSync(root)) return [];
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isSymbolicLink()) records.push({ relative: path.relative(root, full).split(path.sep).join("/"), kind: "symlink", target: fs.readlinkSync(full) });
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(full);
        records.push({ relative: path.relative(root, full).split(path.sep).join("/"), kind: "file", bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      }
    }
  };
  visit(root);
  return records.sort((left, right) => left.relative.localeCompare(right.relative));
}

function assertSnapshotUnchanged(before, after, label = "profile") {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${label} changed during isolated packaged testing.`);
}

module.exports = {
  APPLICATION_DATA_DIRECTORY,
  TEST_PROFILE_MARKER,
  TEST_PROFILE_VERSION,
  argumentValue,
  assertSnapshotUnchanged,
  cleanupIsolatedTestProfile,
  createIsolatedTestProfile,
  defaultProductionUserDataRoot,
  profilePaths,
  resolveApplicationProfile,
  sameOrWithin,
  snapshotProfile,
  strictChild,
  validateTestProfile
};
