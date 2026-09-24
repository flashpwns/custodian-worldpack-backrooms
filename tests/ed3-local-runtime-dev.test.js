"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { ManagedInferenceAppliance } = require("../tools/managed-inference-appliance");

function fakeLlama({ completionStatus = 200 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"status":"ok"}'); return; }
    if (req.url === "/v1/chat/completions") { req.resume(); req.on("end", () => { res.writeHead(completionStatus, { "content-type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: "Ok." } }] })); }); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function harness({ completionStatus } = {}) {
  const server = await fakeLlama({ completionStatus });
  const port = server.address().port;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed3-"));
  const spawned = [];
  const child = Object.assign(new EventEmitter(), { pid: 4242, stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false, kill() { this.killed = true; return true; } });
  const appliance = new ManagedInferenceAppliance({
    appDataPath: root, developerMode: true, overrideTotalMem: 16 * 1024 ** 3, overrideDiskFree: 50 * 1024 ** 3,
    spawnFn: (bin, args) => { spawned.push({ bin, args }); setTimeout(() => child.stderr.emit("data", `main: server is listening on http://127.0.0.1:${port} - starting the main loop\n`), 20); return child; }
  });
  appliance.hasBundledAssets = () => true;
  const cleanup = () => { try { appliance.shutdown(); } catch {} server.close(); fs.rmSync(root, { recursive: true, force: true }); };
  return { appliance, spawned, child, port, root, cleanup };
}

test("ED-3 — daemon spawn: loopback-only, no web UI, model alias, port parsed from the real host:port (not '127')", async () => {
  const h = await harness();
  try {
    const result = await h.appliance.startSpawnedDaemon({ model_path: "/tmp/model.gguf" });
    assert.equal(result.ok, true);
    assert.equal(result.port, h.port, "port is the listening port, never the leading 127 of the address");
    const { args } = h.spawned[0];
    assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
    assert.ok(args.includes("--no-webui"));
    assert.equal(args[args.indexOf("--alias") + 1], "yellow-beast-local-v1");
    assert.equal(args[args.indexOf("--model") + 1], "/tmp/model.gguf");
    assert.notEqual(args[args.indexOf("--port") + 1], "0");
  } finally { h.cleanup(); }
});

test("ED-3 — READY only after the bounded warmup inference completes", async () => {
  const h = await harness();
  try {
    const pending = h.appliance.startSpawnedDaemon({ model_path: "/tmp/model.gguf" });
    assert.notEqual(h.appliance.getStatus().is_ready, true, "spawned but not yet warmed up");
    const result = await pending;
    assert.equal(result.ok, true);
    assert.equal(h.appliance.getStatus().is_ready, true);
  } finally { h.cleanup(); }
});

test("ED-3 — failed warmup leaves the appliance NOT ready, kills the child, and reports repair", async () => {
  const h = await harness({ completionStatus: 500 });
  try {
    const result = await h.appliance.startSpawnedDaemon({ model_path: "/tmp/model.gguf" });
    assert.equal(result.ok, false);
    assert.equal(h.appliance.getStatus().is_ready, false);
    assert.equal(h.appliance.state, "REPAIR_REQUIRED");
    assert.equal(h.child.killed, true);
    await assert.rejects(() => h.appliance.infer({ prompt: "x" }), { code: "APPLIANCE_NOT_READY" });
  } finally { h.cleanup(); }
});

test("ED-3 — install() from local files records checksum/size and writes appliance-config.json under the given data root", async () => {
  const h = await harness();
  try {
    const model = path.join(h.root, "m.gguf");
    fs.writeFileSync(model, "gguf-test-bytes");
    h.appliance.resolveModelPath = () => model;
    const result = await h.appliance.install();
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const config = JSON.parse(fs.readFileSync(path.join(h.root, "local-inference", "appliance-config.json"), "utf8"));
    assert.equal(config.installed, true);
    assert.equal(config.model_path, model);
    assert.equal(config.model_size, 15);
    assert.match(config.checksum, /^[0-9a-f]{64}$/);
    // a fresh appliance on the same root detects the installed state and starts the daemon itself
    assert.equal(h.appliance.getStatus().is_ready, true);
  } finally { h.cleanup(); }
});

test("ED-3 — dev Electron (process.defaultApp) resolves vendor/ assets, never the Electron binary's resources dir", () => {
  const original = { resourcesPath: process.resourcesPath, defaultApp: process.defaultApp };
  const appliance = new ManagedInferenceAppliance({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed3p-")), overrideTotalMem: 16 * 1024 ** 3 });
  try {
    process.resourcesPath = "/Applications/Electron.app/Contents/Resources";
    process.defaultApp = true;
    assert.match(appliance.resolveBinaryPath(), /vendor\/llama\/llama-server$/);
    assert.match(appliance.resolveModelPath(), /vendor\/model\/yellow-beast-local-v1\.gguf$/);
    process.defaultApp = undefined;
    assert.match(appliance.resolveBinaryPath(), /^\/Applications\/Electron\.app\/Contents\/Resources\/llama\/llama-server$/, "packaged app keeps bundled resources");
  } finally { process.resourcesPath = original.resourcesPath; process.defaultApp = original.defaultApp; appliance.shutdown(); }
});

test("ED-3 — pinned runtime metadata records exact release, checksums and the chosen model", () => {
  const pin = require("../tools/local-runtime-pin.json");
  assert.equal(pin.llama_cpp.tag, "b11146");
  assert.match(pin.llama_cpp.asset_sha256, /^[0-9a-f]{64}$/);
  assert.equal(pin.model.repository, "unsloth/gemma-4-E4B-it-GGUF");
  assert.match(pin.model.revision, /^[0-9a-f]{40}$/);
  assert.equal(pin.model.quantization, "Q4_K_M");
  assert.equal(pin.model.internal_filename, "yellow-beast-local-v1.gguf");
  assert.match(pin.model.sha256, /^[0-9a-f]{64}$/);
  assert.equal(pin.model.license, "Apache-2.0", "no licensing ambiguity for a shipped model");
  assert.ok(require("node:fs").existsSync(require("node:path").join(__dirname, "..", pin.model.license_notice)));
  assert.equal(pin.model.request_options.chat_template_kwargs.enable_thinking, false, "hybrid reasoning mode is disabled for wording");
});
