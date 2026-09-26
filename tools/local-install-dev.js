"use strict";

// Development helper: installs the already-present vendor/ runtime assets
// through the SAME ManagedInferenceAppliance.install() authority the game uses.
// Run with:  npm run desktop:local-install   (Electron, so userData matches desktop:dev)
// Verifies the pinned model checksum first. Downloads nothing.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const pin = require("./local-runtime-pin.json");
const { ManagedInferenceAppliance } = require("./managed-inference-appliance");

async function main() {
  const { app } = require("electron");
  await app.whenReady();
  const { resolveApplicationProfile } = require("../desktop/profile-resolver");
  const profile = resolveApplicationProfile({ argv: process.argv, testMode: false, productionUserDataRoot: app.getPath("userData") });
  const appliance = new ManagedInferenceAppliance({ appDataPath: profile.paths.root, developerMode: true, logger: (line) => console.log(`[appliance] ${line}`) });
  console.log(`appliance root: ${appliance.rootDir}`);
  if (!appliance.hasBundledAssets()) throw new Error(`missing assets: ${appliance.resolveBinaryPath()} / ${appliance.resolveModelPath()}`);
  const modelPath = appliance.resolveModelPath();
  const sha = crypto.createHash("sha256").update(fs.readFileSync(modelPath)).digest("hex");
  if (modelPath.startsWith(path.join(__dirname, "..", "vendor")) && sha !== pin.model.sha256) throw new Error(`model checksum mismatch: ${sha}`);
  const result = await appliance.install({ onProgress: ({ progress, stage }) => console.log(`[install] ${stage} ${progress}%`) });
  console.log(JSON.stringify({ ok: result.ok, error: result.error ?? null, status: appliance.getStatus() }));
  appliance.shutdown();
  app.exit(result.ok ? 0 : 1);
}
main().catch((error) => { console.error(error.message); require("electron").app.exit(1); });
