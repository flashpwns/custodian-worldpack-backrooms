"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { startRun, act, look, resumeRun } = require("./run-bootstrap");

const root = path.resolve(__dirname, ".."); const pkg = require(path.join(root, "package.json"));
const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
const artifact = process.argv[2] || path.join(root, "dist", platform, `Yellow-Beast-alpha-${pkg.version}-${platform}-${process.arch}`);
const node = path.join(artifact, "runtime", platform === "windows" ? "node.exe" : "bin/node"); const launcher = path.join(artifact, "app", "tools", "launcher.js");
for (const required of [node, launcher, path.join(artifact, "app", "tools", "ai-openai-provider.js"), path.join(artifact, "app", "tools", "procedural-complex.js"), path.join(artifact, "app", "tools", "world-history.js"), path.join(artifact, "app", "tools", "becks-desk.js"), path.join(artifact, "app", "tools", "nullzone-exposure.js"), path.join(artifact, "app", "tools", "lost.js"), path.join(artifact, "app", "data", "procedural-grammar.json"), path.join(artifact, "app", "node_modules", "custodian", "index.js"), path.join(artifact, "app", "node_modules", "openai", "index.js"), path.join(artifact, "app", "START-HERE.md"), path.join(artifact, "app", "LICENSE"), path.join(artifact, "app", "THIRD_PARTY_NOTICES.md")]) assert.ok(fs.existsSync(required), `missing ${required}`);
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const file = path.join(dir, entry.name); return entry.isDirectory() ? walk(file) : [file]; }); }
for (const file of walk(artifact)) {
  const relative = path.relative(artifact, file); assert.ok(!/(^|[/\\])\.git([/\\]|$)|(^|[/\\])\.env$/.test(relative), `forbidden packaged file: ${relative}`);
  assert.ok(!/(^|[/\\])node_modules[/\\].*[/\\](?:\.github|docs|test|tests|templates|external-fixtures)(?:[/\\]|$)/.test(relative), `development dependency file: ${relative}`);
  assert.ok(!/(^|[/\\])node_modules[/\\].*[/\\](?:README|CHANGELOG|CONTRIBUTING)(?:\..*)?$/i.test(relative), `dependency documentation file: ${relative}`);
  if (fs.statSync(file).size < 1_000_000 && /\.(js|json|md|command|bat|txt)$/.test(file)) { const text = fs.readFileSync(file, "utf8"); assert.ok(!/(\/Users\/|C:\\Users\\|YELLOW_BEAST_AI_API_KEY=sk-)/.test(text), `development path or secret in ${relative}`); }
}
const data = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-alpha-"));
function run(args) { const out = spawnSync(node, [launcher, ...args], { encoding: "utf8", env: { ...process.env, YELLOW_BEAST_DATA_DIR: data } }); assert.equal(out.status, 0, out.stderr); return JSON.parse(out.stdout); }
run(["--profile", "field-researcher", "--seed", "packaged", "--action", "LOOK", "--save", "cert"]);
run(["--resume", "cert", "--action", "MOVE", "--save", "cert"]);
run(["--resume", "cert", "--natural", "check the fixture", "--save", "cert"]);
run(["--resume", "cert", "--natural", "take a picture of the fixture", "--save", "cert"]);
run(["--resume", "cert", "--natural", "radio Standard", "--save", "cert"]);
run(["--resume", "cert", "--action", "USE", "--target", "survey-instrument", "--save", "cert"]);
const completed = run(["--resume", "cert", "--action", "RETURN", "--save", "cert"]); assert.equal(completed.status.lifecycle, "completed");
let dev = startRun({ profile: "field-researcher", seed: "packaged" }).run; act(dev, "MOVE"); const target = look(dev).aliases[0].alias; act(dev, "INSPECT", target); act(dev, "RECORD", target); act(dev, "COMMUNICATE", "standard"); act(dev, "USE", "survey-instrument"); act(dev, "RETURN");
const restored = resumeRun(JSON.parse(fs.readFileSync(path.join(data, "saves", "cert.json"), "utf8"))).run; assert.equal(restored.lifecycle, dev.lifecycle); assert.deepEqual(restored.checklist, dev.checklist);
console.log(JSON.stringify({ artifact, smoke: "passed", save_restore: "passed", deterministic_wrapper: "passed" }, null, 2));
