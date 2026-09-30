"use strict";

// Reader Phase 2 -- the PINNED LOCAL RUNTIME for offline measurement (development only; never production).
//
// Starts an ISOLATED llama-server from the pinned runtime and bundled model (tools/local-runtime-pin.json) on a free
// port, with flags given by the caller. The managed appliance's production flags (tools/managed-inference-appliance.js)
// are never changed here; any flag set used for a measurement is recorded next to the result. Also: the pinned
// tokenizer (llama-server /tokenize on the same model), so token counts are the local model's own.

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const PIN = require("./local-runtime-pin.json");

const ROOT = path.join(__dirname, "..");
const BINARY = path.join(ROOT, "vendor", "llama", "llama-server");
const MODEL = path.join(ROOT, PIN.model.target);
const PRODUCTION_ARGS = Object.freeze(["--ctx-size", "4096", "--cache-ram", "0", "--no-webui"]);

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); }); }

/** The pin identity recorded with every local measurement (the byte size is checked; the SHA-256 is the pin's). */
function pinIdentity() {
  const present = fs.existsSync(BINARY) && fs.existsSync(MODEL);
  const bytes = present ? fs.statSync(MODEL).size : null;
  return { runtime: PIN.llama_cpp.tag, model: PIN.model.name, model_file: PIN.model.internal_filename, model_sha256: PIN.model.sha256, quantization: PIN.model.quantization, bytes_ok: bytes === PIN.model.bytes, present };
}

async function startServer(args = PRODUCTION_ARGS, { readyTimeoutMs = 240000 } = {}) {
  const pin = pinIdentity();
  if (!pin.present) throw Object.assign(new Error("pinned runtime/model not present under vendor/"), { code: "RUNTIME_ABSENT" });
  if (!pin.bytes_ok) throw Object.assign(new Error("bundled model does not match the pinned byte size"), { code: "MODEL_PIN_MISMATCH" });
  const port = await freePort();
  const child = spawn(BINARY, ["--model", MODEL, "--alias", "yellow-beast-local", "--host", "127.0.0.1", "--port", String(port), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const keep = (d) => { log += d; if (log.length > 200000) log = log.slice(-100000); };
  child.stdout.on("data", keep); child.stderr.on("data", keep);
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`llama-server exited (${child.exitCode}): ${log.slice(-800)}`);
    try { const r = await fetch(`${endpoint}/health`); if (r.ok) break; } catch {}
    if (Date.now() - started > readyTimeoutMs) { child.kill("SIGKILL"); throw new Error("llama-server not ready"); }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { endpoint, pid: child.pid, args: [...args], pin, load_ms: Date.now() - started, log: () => log, stop: () => new Promise((resolve) => { if (child.exitCode != null) return resolve(); child.once("exit", resolve); child.kill("SIGTERM"); setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000); }) };
}

/** Token count (and pieces) of raw content under the pinned model's tokenizer; no special tokens added. */
async function tokenize(endpoint, content, { pieces = false } = {}) {
  const r = await fetch(`${endpoint}/tokenize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, add_special: false, with_pieces: pieces }) });
  const json = await r.json();
  return json.tokens ?? [];
}

module.exports = { PRODUCTION_ARGS, pinIdentity, startServer, tokenize, freePort };
