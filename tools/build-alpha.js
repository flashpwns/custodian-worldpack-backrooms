"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const displayPlatform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
const requested = process.argv.includes("--platform") ? process.argv[process.argv.indexOf("--platform") + 1] : displayPlatform;
if (requested !== displayPlatform) throw new Error(`Build ${requested} on a ${requested} host so its bundled Node runtime is native.`);
const architecture = process.arch;
const nodeVersion = "20.19.5";
const artifact = path.join(root, "dist", requested, `Yellow-Beast-alpha-${pkg.version}-${requested}-${architecture}`);
const app = path.join(artifact, "app");
function copy(relative) { const from = path.join(root, relative); const to = path.join(app, relative); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); }
function command(program, args) { const result = spawnSync(program, args, { encoding: "utf8" }); if (result.status !== 0) throw new Error(`${program} failed: ${result.stderr || result.stdout}`); }
function pruneDependencyDevelopmentFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory() && [".github", "docs", "test", "tests", "templates", "external-fixtures"].includes(entry.name)) fs.rmSync(target, { recursive: true, force: true });
    else if (entry.isDirectory()) pruneDependencyDevelopmentFiles(target);
    else if (/^(?:README|CHANGELOG|CONTRIBUTING)(?:\..*)?$/i.test(entry.name)) fs.rmSync(target, { force: true });
  }
}
function nodeDistribution() {
  const nodePlatform = requested === "macos" ? "darwin" : "win";
  const extension = requested === "windows" ? "zip" : "tar.gz";
  const name = `node-v${nodeVersion}-${nodePlatform}-${architecture}.${extension}`;
  const cache = path.join(root, "dist", ".cache", `node-v${nodeVersion}-${nodePlatform}-${architecture}`);
  const archive = path.join(root, "dist", ".cache", name);
  const release = `https://nodejs.org/dist/v${nodeVersion}`;
  if (!fs.existsSync(path.join(cache, requested === "windows" ? "node.exe" : "bin/node"))) {
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    if (!fs.existsSync(archive)) command("curl", ["-fsSL", `${release}/${name}`, "-o", archive]);
    const checksums = path.join(root, "dist", ".cache", `SHASUMS256-v${nodeVersion}.txt`);
    if (!fs.existsSync(checksums)) command("curl", ["-fsSL", `${release}/SHASUMS256.txt`, "-o", checksums]);
    const expected = fs.readFileSync(checksums, "utf8").split(/\r?\n/).find((line) => line.endsWith(`  ${name}`))?.split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    if (!expected || actual !== expected) throw new Error(`official Node checksum mismatch for ${name}`);
    const extract = path.join(root, "dist", ".cache", "extract"); fs.rmSync(extract, { recursive: true, force: true }); fs.mkdirSync(extract, { recursive: true });
    command("tar", ["-xf", archive, "-C", extract]);
    fs.renameSync(path.join(extract, `node-v${nodeVersion}-${nodePlatform}-${architecture}`), cache);
  }
  return cache;
}
fs.rmSync(artifact, { recursive: true, force: true }); fs.mkdirSync(app, { recursive: true });
["manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "START-HERE.md", "package.json", "profiles", "scenarios/threshold-baseline.json", "data/procedural-grammar.json", "tools/expedition.js", "tools/procedural-complex.js", "tools/world-history.js", "tools/becks-desk.js", "tools/nullzone-exposure.js", "tools/lost.js", "tools/run-bootstrap.js", "tools/ai-adapter.js", "tools/ai-mock-provider.js", "tools/ai-openai-provider.js", "tools/launcher-paths.js", "tools/launcher.js", "node_modules"].forEach(copy);
pruneDependencyDevelopmentFiles(path.join(app, "node_modules"));
const runtime = path.join(artifact, "runtime"); fs.cpSync(nodeDistribution(), runtime, { recursive: true });
// Official Node archives place bundled package-manager files under lib/node_modules
// on Unix and node_modules on Windows. Neither is needed to run the game.
for (const relative of ["include", "share", "lib/node_modules", "node_modules"]) fs.rmSync(path.join(runtime, relative), { recursive: true, force: true });
if (requested === "windows") fs.writeFileSync(path.join(artifact, "Yellow Beast.bat"), "@echo off\r\nsetlocal\r\nif not defined YELLOW_BEAST_DATA_DIR set \"YELLOW_BEAST_DATA_DIR=%APPDATA%\\Yellow Beast\"\r\n\"%~dp0runtime\\node.exe\" \"%~dp0app\\tools\\launcher.js\" %*\r\n");
else { const launcher = path.join(artifact, "Yellow Beast.command"); fs.writeFileSync(launcher, "#!/bin/sh\nDIR=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\"\n: \"${YELLOW_BEAST_DATA_DIR:=$HOME/Library/Application Support/Yellow Beast}\"\nexport YELLOW_BEAST_DATA_DIR\nexec \"$DIR/runtime/bin/node\" \"$DIR/app/tools/launcher.js\" \"$@\"\n"); fs.chmodSync(launcher, 0o755); }
console.log(JSON.stringify({ artifact, platform: requested, architecture, bundled_node: nodeVersion, custodian: require("custodian/package.json").version }, null, 2));
