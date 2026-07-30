"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveAppPaths } = require("../tools/launcher-paths");
const { loadConfig, runCommand } = require("../tools/launcher");

test("platform paths use external application data directories", () => {
  assert.equal(resolveAppPaths({ platform: "darwin", home: "/tmp/home" }).root, "/tmp/home/Library/Application Support/Yellow Beast");
  assert.equal(resolveAppPaths({ platform: "win32", home: "C:\\Home", env: { APPDATA: "C:\\Users\\Player\\AppData\\Roaming" } }).root, "C:\\Users\\Player\\AppData\\Roaming\\Yellow Beast");
});
test("launcher creates safe config, survives corruption, and completes an offline save/resume run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb14-launcher-")); const paths = resolveAppPaths({ env: { YELLOW_BEAST_DATA_DIR: root } });
  const initial = loadConfig(paths); assert.equal(initial.config.provider, "offline-mock");
  fs.writeFileSync(paths.config, "not json"); assert.ok(loadConfig(paths).warning);
  await runCommand({ paths, seed: "launcher", action: "LOOK", save: "alpha" });
  await runCommand({ paths, resume: "alpha", action: "MOVE", save: "alpha" });
  await runCommand({ paths, resume: "alpha", natural: "check the fixture", save: "alpha" });
  const done = await runCommand({ paths, resume: "alpha", natural: "use my light", save: "alpha" });
  assert.equal(done.ok, true); assert.equal(done.status.lifecycle, "completed"); assert.ok(fs.existsSync(path.join(paths.saves, "alpha.json")));
});
