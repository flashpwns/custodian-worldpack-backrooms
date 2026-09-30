"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const profiles = require("../desktop/profile-resolver");

const root = path.resolve(__dirname, "..");
const productionUserData = profiles.defaultProductionUserDataRoot();
const profile = profiles.createIsolatedTestProfile("visual-acceptance", { productionUserDataRoot: productionUserData });

console.log(`Created isolated test profile at: ${profile.paths.userDataRoot}`);

let passed = false;
try {
  const electronBin = path.join(root, "node_modules", ".bin", "electron");
  const mainScript = path.join(root, "desktop", "main.js");
  const args = [
    mainScript,
    "--visual-acceptance-smoke",
    "--test-profile",
    profile.paths.userDataRoot
  ];

  console.log(`Executing: ${electronBin} ${args.join(" ")}`);
  const result = spawnSync(electronBin, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    stdio: "inherit"
  });

  if (result.status === 0) {
    passed = true;
    console.log("Visual acceptance traversal exited cleanly with code 0.");
  } else {
    console.error(`Visual acceptance traversal failed with exit code ${result.status}`);
  }
} finally {
  if (passed) {
    profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
    console.log("Cleaned up isolated test profile.");
  } else {
    console.log(`Profile preserved for debugging: ${profile.paths.userDataRoot}`);
  }
}
