"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const root = path.resolve(__dirname, "..");
const required = ["desktop/main.js", "desktop/preload.js", "desktop/service.js", "desktop/credentials.js", "desktop/profile-resolver.js", "desktop/package-smoke.js", "desktop/renderer-smoke.js", "desktop/first-run-smoke.js", "desktop/hosted-ai-smoke.js", "desktop/renderer/index.html", "desktop/renderer/renderer.js", "desktop/renderer/surfaces.js", "desktop/renderer/styles.css", "desktop/renderer/aeot-palette.css", "desktop/renderer/audio.js", "desktop/renderer/interaction.js", "desktop/renderer/interaction.css", "desktop/renderer/qol.js", "desktop/renderer/qol.css", "desktop/renderer/accessibility.js", "desktop/renderer/accessibility.css", "tools/spatial-runtime.js", "tools/object-runtime.js", "tools/mission-runtime.js", "tools/operational-cycle.js", "tools/logistics-runtime.js", "tools/institutional-runtime.js", "tools/worldpack-authoring.js", "tools/q4-radio.js", "tools/q4-time.js", "tools/ai-hosted-transport.js", "tools/ai-provider-pool.js", "tools/ai-openai-provider.js", "tools/ai-mock-provider.js", "tools/ai-living-provider.js", "tools/ai-living-turn.js", "data/worldpacks/registry.json", "data/worldpacks/clear-q4/spatial.json", "data/worldpacks/clear-q4/interactions.json", "data/worldpacks/clear-q4/mission.json", "data/worldpacks/clear-q4/dynamics.json", "data/worldpacks/clear-q4/logistics.json", "data/worldpacks/clear-q4/institution.json", "data/worldpacks/clear-q4/operation.json", "data/worldpacks/minimal-mission/spatial.json", "data/worldpacks/minimal-mission/interactions.json", "data/worldpacks/minimal-mission/mission.json", "data/worldpacks/authoring-fixture/worldpack.json", "SIMULATION_DOCTRINE.md", "docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md", "docs/ai-interface-contract.md", "docs/ai-provider.md", "canon/terminology.json", "canon/operational-spatial-schema.json", "canon/operational-interaction-schema.json", "canon/operational-mission-schema.json", "canon/operational-dynamics-schema.json", "canon/operational-logistics-schema.json", "canon/institutional-response-schema.json", "canon/complete-operation-schema.json", "tools/verify-desktop-artifact.js", "tools/verify-first-run-artifact.js"];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) throw new Error(`desktop build input missing: ${relative}`);
const buildInfoPath = path.join(root, "desktop", "build-info.json");
const previousBuildInfo = fs.existsSync(buildInfoPath) ? fs.readFileSync(buildInfoPath) : null;
try {
childProcess.execFileSync(process.execPath, [path.join(root, "tools", "write-build-info.js")], { stdio: "inherit" });
const args = process.argv.slice(2);
if (!args.some(arg => ["--win", "--mac", "--linux", "-w", "-m", "-l"].includes(arg))) {
  const nativeTarget = { darwin:"--mac", win32:"--win", linux:"--linux" }[process.platform];
  if (!nativeTarget) throw new Error(`unsupported desktop build host: ${process.platform}`);
  args.unshift(nativeTarget);
}
// A local build must not publish merely because CI/tag credentials are present.
if (!args.some(arg => arg === "--publish" || arg.startsWith("--publish="))) args.push("--publish", "never");
const output = path.join(root, "dist", "desktop-shell-manifest.json"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify({ version: require("../package.json").version, framework: "electron", inputs: required, packaging: ["electron-builder", ...args].join(" ") }, null, 2)}\n`);
const builder = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
const packaged = childProcess.spawnSync(builder, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (packaged.status !== 0) throw new Error("electron-builder failed");
console.log(JSON.stringify({ desktop_build: "packaged", framework: "electron", output }, null, 2));
} finally {
  if (previousBuildInfo) fs.writeFileSync(buildInfoPath, previousBuildInfo);
  else if (fs.existsSync(buildInfoPath)) fs.unlinkSync(buildInfoPath);
}
