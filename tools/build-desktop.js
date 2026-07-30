"use strict";

// Pass 1 desktop build is a deterministic staging check, not an installer.
// Native distribution is deliberately deferred to YB-26 Pass 4.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const required = ["desktop/main.js", "desktop/preload.js", "desktop/service.js", "desktop/renderer/index.html", "desktop/renderer/renderer.js", "desktop/renderer/surfaces.js", "desktop/renderer/styles.css"];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) throw new Error(`desktop build input missing: ${relative}`);
const output = path.join(root, "dist", "desktop-shell-manifest.json"); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify({ version: require("../package.json").version, framework: "electron", inputs: required }, null, 2)}\n`);
console.log(JSON.stringify({ desktop_build: "staged", framework: "electron", output }, null, 2));
