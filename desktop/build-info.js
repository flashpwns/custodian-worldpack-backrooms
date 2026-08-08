"use strict";

// Packaged builds receive this record immediately before electron-builder runs.
// Development uses a clearly marked source-tree record so the same app surface
// can always identify what it is executing.
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const packageVersion = require("../package.json").version;

const file = path.join(__dirname, "build-info.json");
function sourceCommit() {
  try { return childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim(); }
  catch { return "source-tree-unresolved"; }
}
function read() {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value?.version && value?.commit && value?.built_at) return value;
  } catch {}
  return { version: packageVersion, commit: sourceCommit(), built_at: "SOURCE_TREE", provenance: "development" };
}

module.exports = { read, file };
