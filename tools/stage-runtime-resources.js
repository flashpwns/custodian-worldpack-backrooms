"use strict";

// Stages the pinned LOCAL DIALOGUE RUNTIME (llama.cpp llama-server + the pinned model) into resources/ so
// electron-builder's extraResources ship it inside the application. The pin (tools/local-runtime-pin.json)
// is the only authority on which model file may ship: the staged file's SHA-256 must equal the pin.
// vendor/ and resources/ are local build inputs/outputs and are gitignored; nothing here downloads.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const pin = require("./local-runtime-pin.json");
const { MODEL_FILENAME } = require("./managed-inference-appliance");

// Only what llama-server needs at run time; the other bundled example binaries are not shipped.
const SKIP_BINARIES = /^(?:llama-(?:cli|gemma3-cli|llava-cli|minicpmv-cli|mtmd-cli|qwen2vl-cli)|ggml-rpc-server|ggml-metal-tuning)$/;

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(8 * 1024 * 1024);
    for (let n = fs.readSync(fd, chunk, 0, chunk.length, null); n > 0; n = fs.readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function stage({ vendor = path.join(root, "vendor"), out = path.join(root, "resources"), platform = `${process.platform}-${process.arch}` } = {}) {
  // The pin names the one platform its runtime asset serves. Elsewhere nothing is staged (explicitly, not
  // silently): that platform's package ships deterministic dialogue only. Empty resource directories keep
  // the packaging configuration's extraResources satisfied.
  if (pin.llama_cpp?.platform && pin.llama_cpp.platform !== platform) {
    for (const dir of ["llama", "model"]) { fs.rmSync(path.join(out, dir), { recursive: true, force: true }); fs.mkdirSync(path.join(out, dir), { recursive: true }); }
    return { skipped: true, reason: `no pinned local runtime for ${platform}`, out };
  }
  const llamaSrc = path.join(vendor, "llama");
  const modelSrc = path.join(vendor, "model", MODEL_FILENAME);
  if (!fs.existsSync(path.join(llamaSrc, "llama-server"))) throw new Error(`local dialogue runtime missing: ${llamaSrc}/llama-server (see tools/local-runtime-pin.json)`);
  if (!fs.existsSync(modelSrc)) throw new Error(`local dialogue model missing: ${modelSrc} (see tools/local-runtime-pin.json)`);
  const actual = sha256File(modelSrc);
  if (actual !== pin.model.sha256) throw new Error(`local dialogue model does not match the pin (${actual})`);

  fs.rmSync(path.join(out, "llama"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "model"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "llama"), { recursive: true });
  fs.mkdirSync(path.join(out, "model"), { recursive: true });
  for (const name of fs.readdirSync(llamaSrc)) {
    if (SKIP_BINARIES.test(name)) continue;
    fs.cpSync(path.join(llamaSrc, name), path.join(out, "llama", name), { recursive: true, verbatimSymlinks: true });
  }
  fs.copyFileSync(modelSrc, path.join(out, "model", MODEL_FILENAME));
  // Notices required by the runtime and model licenses travel with the binaries.
  const licenseDir = path.join(root, "docs", "licenses");
  if (fs.existsSync(licenseDir)) for (const name of fs.readdirSync(licenseDir)) fs.copyFileSync(path.join(licenseDir, name), path.join(out, "model", name));
  return { model_sha256: actual, model_bytes: fs.statSync(modelSrc).size, out };
}

if (require.main === module) {
  try { console.log(JSON.stringify({ runtime_staged: stage() })); }
  catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { stage, sha256File };
