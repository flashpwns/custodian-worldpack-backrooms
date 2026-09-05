"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Resolve the executable and archive from one host-architecture package. Never
// pair a stale archive from a different platform with the executable under test.
function desktopArtifactPaths(root, platform = process.platform, arch = process.arch) {
  const dist = path.join(root, "dist", "desktop");
  let executable, archive;
  if (platform === "darwin") {
    const app = path.join(dist, arch === "x64" ? "mac" : `mac-${arch}`, "Yellow Beast.app", "Contents");
    executable = path.join(app, "MacOS", "Yellow Beast");
    archive = path.join(app, "Resources", "app.asar");
  } else if (platform === "win32") {
    const app = path.join(dist, arch === "x64" ? "win-unpacked" : `win-${arch}-unpacked`);
    executable = path.join(app, "Yellow Beast.exe");
    archive = path.join(app, "resources", "app.asar");
  } else {
    throw new Error("desktop artifact verification runs on macOS or Windows");
  }
  if (!fs.existsSync(executable) || !fs.existsSync(archive)) throw new Error(`Build the ${platform}/${arch} desktop artifact first; expected ${executable} and its app.asar.`);
  return { executable, archive };
}
module.exports = { desktopArtifactPaths };
