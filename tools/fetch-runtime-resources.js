"use strict";

// Fetches the pinned LOCAL DIALOGUE RUNTIME (llama.cpp release asset + model) into vendor/ for a build
// machine that does not already hold them (CI, a fresh checkout). The pin (tools/local-runtime-pin.json)
// is the only authority: exact URLs, and every byte must match the pinned SHA-256 or nothing is kept.
// Players never run this -- a packaged application already carries its runtime. Platforms without a
// pinned runtime are skipped explicitly (their packages ship deterministic dialogue only).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(__dirname, "..");
const pin = require("./local-runtime-pin.json");

const platformKey = () => `${process.platform}-${process.arch}`;
const pinnedForPlatform = () => pin.llama_cpp?.platform === platformKey();

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(8 * 1024 * 1024);
    for (let n = fs.readSync(fd, chunk, 0, chunk.length, null); n > 0; n = fs.readSync(fd, chunk, 0, chunk.length, null)) hash.update(chunk.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

async function download(url, target, expectedSha, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const partial = `${target}.partial`;
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
      const actual = sha256File(partial);
      if (actual !== expectedSha) throw new Error(`SHA-256 mismatch for ${path.basename(target)}: ${actual}`);
      fs.renameSync(partial, target);
      return;
    } catch (error) {
      fs.rmSync(partial, { force: true });
      if (attempt === attempts) throw error;
      console.error(`retrying ${path.basename(target)} after: ${error.message}`);
    }
  }
}

async function fetchRuntime({ vendor = path.join(root, "vendor") } = {}) {
  if (!pinnedForPlatform()) return { skipped: true, reason: `no pinned local runtime for ${platformKey()}` };
  const llamaDir = path.join(vendor, "llama");
  const modelDir = path.join(vendor, "model");
  const modelTarget = path.join(modelDir, pin.model.internal_filename);
  fs.mkdirSync(llamaDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });

  const result = { runtime: "present", model: "present" };
  if (!fs.existsSync(path.join(llamaDir, "llama-server"))) {
    const archive = path.join(vendor, pin.llama_cpp.asset);
    await download(pin.llama_cpp.url, archive, pin.llama_cpp.asset_sha256);
    // The release archive holds one top-level directory (llama-<tag>/); its contents are the runtime.
    execFileSync("tar", ["-xzf", archive, "--strip-components", "1", "-C", llamaDir]);
    fs.rmSync(archive, { force: true });
    if (!fs.existsSync(path.join(llamaDir, "llama-server"))) throw new Error("pinned runtime archive did not contain llama-server");
    result.runtime = "fetched";
  }
  if (!fs.existsSync(modelTarget) || sha256File(modelTarget) !== pin.model.sha256) {
    await download(pin.model.url, modelTarget, pin.model.sha256);
    result.model = "fetched";
  }
  return { ...result, model_sha256: pin.model.sha256, runtime_tag: pin.llama_cpp.tag };
}

if (require.main === module) {
  fetchRuntime().then((result) => console.log(JSON.stringify({ runtime_fetch: result }))).catch((error) => { console.error(error.message); process.exit(1); });
}
module.exports = { fetchRuntime, pinnedForPlatform, platformKey };
