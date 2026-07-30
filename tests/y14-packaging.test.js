"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
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
  await runCommand({ paths, resume: "alpha", natural: "take a picture of the fixture", save: "alpha" });
  await runCommand({ paths, resume: "alpha", natural: "radio Standard", save: "alpha" });
  await runCommand({ paths, resume: "alpha", action: "USE", target: "survey-instrument", save: "alpha" });
  const done = await runCommand({ paths, resume: "alpha", action: "RETURN", save: "alpha" });
  assert.equal(done.ok, true); assert.equal(done.status.lifecycle, "completed"); assert.ok(fs.existsSync(path.join(paths.saves, "alpha.json")));
});
function launchInteractive(launcher, root, respond) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, "--interactive"], { env: { ...process.env, YELLOW_BEAST_DATA_DIR: root } });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; respond(output, child.stdin); });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}
test("interactive launcher offers the packaged Clear-Q4 save on relaunch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb14-interactive-"));
  const launcher = path.join(__dirname, "..", "tools", "launcher.js");
  let firstStage = 0;
  await launchInteractive(launcher, root, (output, input) => {
    if (firstStage === 0 && output.includes("Mode [2")) { firstStage = 1; input.write("2\n"); }
    else if (firstStage === 1 && output.includes("Command (")) { firstStage = 2; input.write("SAVE\n"); }
    else if (firstStage === 2 && output.includes("Saved to")) { firstStage = 3; input.write("QUIT\n"); }
  });
  assert.ok(fs.existsSync(path.join(root, "saves", "clear-q4.json")));
  let resumedStage = 0;
  const resumed = await launchInteractive(launcher, root, (output, input) => {
    if (resumedStage === 0 && output.includes("Resume saved Async: Clear-Q4 run")) { resumedStage = 1; input.write("\n"); }
    else if (resumedStage === 1 && output.includes("Command (")) { resumedStage = 2; input.write("QUIT\n"); }
  });
  assert.match(resumed, /Resume saved Async: Clear-Q4 run/);
});
