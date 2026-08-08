"use strict";
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("actual Electron renderer opens, focuses, saves, closes, and reopens Settings", { timeout: 30000 }, () => {
  const electron = require("electron");
  const result = childProcess.spawnSync(electron, [path.join(__dirname, "..", "desktop", "main.js"), "--renderer-smoke"], { cwd: path.join(__dirname, ".."), encoding: "utf8", timeout: 30000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /renderer_settings_smoke/);
});
