"use strict";
const profiles = require("./profile-resolver");
const { DesktopService } = require("./service");

const productionUserData = profiles.defaultProductionUserDataRoot();
const beforeProduction = profiles.snapshotProfile(productionUserData);
const profile = profiles.createIsolatedTestProfile("package-service", { productionUserDataRoot: productionUserData });
let passed = false;
try {
  const service = new DesktopService({ appDataPath: profile.paths.root });
  const world = service.createWorld({ name: "Packaged smoke", seed: "desktop-package" }).world;
  for (const mode of ["async-command", "field-researcher", "local-anomaly", "lost"]) {
    const started = service.startSession({ world_id: world.id, mode, seed: mode });
    if (!started.ok) throw new Error(`unable to start ${mode}`);
    const action = started.projection.available_actions[0];
    const result = service.submitAction({ world_id: world.id, mode, action: action.type, target: action.targets?.[0]?.ref ?? null });
    if (!result.ok) throw new Error(`unable to act in ${mode}`);
  }
  service.shutdown();
  const reopened = new DesktopService({ appDataPath: profile.paths.root });
  const resumed = reopened.resumeSession({ world_id: world.id, mode: "field-researcher" });
  reopened.shutdown();
  if (!resumed.ok) throw new Error("packaged session did not resume");
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile after package service smoke");
  profiles.cleanupIsolatedTestProfile(profile, { productionUserDataRoot: productionUserData });
  passed = true;
  console.log(JSON.stringify({ desktop_smoke: "passed", world_id: world.id, offline: true, test_profile: profile.runId, test_profile_cleaned: true }));
} finally {
  profiles.assertSnapshotUnchanged(beforeProduction, profiles.snapshotProfile(productionUserData), "production profile");
  if (!passed) process.stderr.write(`Package service smoke profile preserved for diagnosis: ${profile.paths.userDataRoot}\n`);
}
