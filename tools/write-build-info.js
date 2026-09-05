"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
const commit = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = childProcess.execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude)desktop/build-info.json"], { cwd:root, encoding:"utf8" }).trim().length > 0;
const output = path.join(root, "desktop", "build-info.json");
const record = { version, commit, dirty, built_at: new Date().toISOString(), provenance: "packaged" };
fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ build_info: record, output }, null, 2));
