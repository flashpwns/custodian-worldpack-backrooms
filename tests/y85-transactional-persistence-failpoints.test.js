"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const { createLivingProvider } = require("../tools/ai-living-provider");
const bootstrap = require("../tools/run-bootstrap");
const history = require("../tools/world-history");

function createTestContext(t, { phase = "FIELD_OPERATION" } = {}) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-persistence-failpoints-"));
  t.after(() => fs.rmSync(appDataPath, { recursive: true, force: true }));
  const service = new DesktopService({ appDataPath, livingTurnProvider: createLivingProvider(), defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Failpoint Test World", seed: "failpoint-world-seed" }).world;
  const input = { world_id: world.id, mode: "field-researcher" };

  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ ...input, seed: "failpoint-world-seed" }).ok, true);

  if (phase === "BRIEFING") {
    return { service, appDataPath, input, worldId: world.id };
  }

  // Advance to STAGING
  assert.equal(service.submitAction({ ...input, action: "READY" }).ok, true);
  if (phase === "STAGING") {
    return { service, appDataPath, input, worldId: world.id };
  }

  // Advance through onboarding to FIELD_OPERATION
  assert.equal(service.submitAction({ ...input, action: "PROCEED" }).ok, true);
  assert.equal(service.submitAction({ ...input, action: "APPROACH" }).ok, true);
  assert.equal(service.submitAction({ ...input, action: "READY" }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ ...input, action: "CROSS" }).ok, true);

  return { service, appDataPath, input, worldId: world.id };
}

function verifyRollback({ service, worldId, mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore }) {
  const currentRun = service.session(worldId, mode).run;
  const currentWorld = service.getWorld(worldId);

  // In-memory run and world must match exact pre-action snapshot
  assert.deepEqual(bootstrap.saveRun(currentRun), beforeRun, "In-memory run must be rolled back");
  assert.deepEqual(history.canonicalJson(currentWorld), beforeWorld, "In-memory world must be rolled back");

  // On-disk files must match exact pre-action contents
  const diskSessionAfter = fs.readFileSync(service.sessionFile(worldId, mode), "utf8");
  const diskWorldAfter = fs.readFileSync(service.worldFile(worldId), "utf8");
  assert.equal(diskSessionAfter, diskSessionBefore, "Disk session file must remain unchanged");
  assert.equal(diskWorldAfter, diskWorldBefore, "Disk world file must remain unchanged");
}

test("Failpoint 1: Movement mutation rolls back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  // Force commit failure
  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("disk storage full"), { code: "ENOSPC" });
  };

  const res = service.submitAction({ ...input, action: "MOVE", target: "open-passage" });
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(res.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });

  // Restore commit and verify operation now succeeds
  service.commitPersistencePair = originalCommit;
  const retry = service.submitAction({ ...input, action: "MOVE", target: "open-passage" });
  assert.equal(retry.ok, true);
  assert.equal(service.session(worldId, input.mode).run.spatial.player_location, "open-passage");
});

test("Failpoint 2: Equipment custody and loadout changes roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("simulated I/O write error"), { code: "EIO" });
  };

  // Attempt handoff of survey radio
  const handoffRes = service.submitQ4Handoff({ world_id: worldId, item_id: "survey-radio", target: "Santiago" });
  assert.equal(handoffRes.ok, false);
  assert.equal(handoffRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(handoffRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });

  // Restore and verify handoff succeeds
  service.commitPersistencePair = originalCommit;
  const retryHandoff = service.submitQ4Handoff({ world_id: worldId, item_id: "survey-radio", target: "Santiago" });
  assert.equal(retryHandoff.ok, true);
  assert.equal(service.session(worldId, input.mode).run.expedition.equipment["survey-radio"].holder, "personnel-santiago-stokes");
});

test("Failpoint 3: Tasks and orders roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("database lock timeout"), { code: "ELOCKED" });
  };

  const orderRes = service.submitQ4LocalIntent({ world_id: worldId, text: "Santiago, hold position" });
  assert.equal(orderRes.ok, false);
  assert.equal(orderRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(orderRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });

  // Restore and verify order succeeds
  service.commitPersistencePair = originalCommit;
  const retryOrder = service.submitQ4LocalIntent({ world_id: worldId, text: "Santiago, hold position" });
  assert.equal(retryOrder.ok, true);
  assert.equal(service.session(worldId, input.mode).run.expedition.team_runtime?.orders?.length > 0, true);
});

test("Failpoint 4: Knowledge and observation records roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("disk write fault"), { code: "EFAULT" });
  };

  const lookRes = service.submitAction({ ...input, action: "LOOK" });
  assert.equal(lookRes.ok, false);
  assert.equal(lookRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(lookRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });

  service.commitPersistencePair = originalCommit;
  const retryLook = service.submitAction({ ...input, action: "LOOK" });
  assert.equal(retryLook.ok, true);
});

test("Failpoint 5: Authored beat consumption and phase advancement roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "BRIEFING" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  assert.equal(entry.phase?.phase_id, "BRIEFING");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("storage medium removed"), { code: "ENOMEDIUM" });
  };

  const readyRes = service.submitAction({ ...input, action: "READY" });
  assert.equal(readyRes.ok, false);
  assert.equal(readyRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(readyRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });
  assert.equal(service.session(worldId, input.mode).phase?.phase_id, "BRIEFING");

  service.commitPersistencePair = originalCommit;
  const retryReady = service.submitAction({ ...input, action: "READY" });
  assert.equal(retryReady.ok, true);
  assert.equal(service.session(worldId, input.mode).phase?.phase_id, "STAGING");
});

test("Failpoint 6: Evidence and written report submission roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;

  // Move into return and report phase
  assert.equal(service.submitAction({ ...input, action: "RETURN" }).ok, true);
  assert.equal(service.submitAction({ ...input, action: "MOVE", target: "threshold-side-entry" }).ok, true);
  assert.equal(service.submitAction({ ...input, action: "COMPLETE_RETURN" }).ok, true);
  assert.equal(service.session(worldId, input.mode).phase?.phase_id, "REPORT");

  const entry = service.session(worldId, input.mode);
  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("disk quota exceeded"), { code: "EDQUOT" });
  };

  const reportRes = service.submitReferenceWrittenReport({ world_id: worldId, text: "Traversed threshold and surveyed the passage according to reference specifications." });
  assert.equal(reportRes.ok, false);
  assert.equal(reportRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(reportRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });
  assert.equal(service.session(worldId, input.mode).phase?.phase_id, "REPORT");

  service.commitPersistencePair = originalCommit;
  const retryReport = service.submitReferenceWrittenReport({ world_id: worldId, text: "Traversed threshold and surveyed the passage according to reference specifications." });
  assert.equal(retryReport.ok, true);
  assert.equal(service.session(worldId, input.mode).phase?.phase_id, "DEBRIEF");
});

test("Failpoint 7: Clock and operational interval advancement roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const initialClock = entry.run.expedition.clock.interval;
  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("filesystem read-only"), { code: "EROFS" });
  };

  const moveRes = service.submitAction({ ...input, action: "MOVE", target: "open-passage" });
  assert.equal(moveRes.ok, false);
  assert.equal(moveRes.error?.code, "PERSISTENCE_COMMIT_FAILED");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });
  assert.equal(service.session(worldId, input.mode).run.expedition.clock.interval, initialClock, "Clock must remain unchanged on failpoint");

  service.commitPersistencePair = originalCommit;
  const retryMove = service.submitAction({ ...input, action: "MOVE", target: "open-passage" });
  assert.equal(retryMove.ok, true);
  assert.equal(service.session(worldId, input.mode).run.expedition.clock.interval > initialClock, true, "Clock advances on successful commit");
});

test("Failpoint 8: Ledger and historical events roll back on persistence failure", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const initialEventCount = service.getWorld(worldId).events?.length ?? 0;
  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("unexpected transactional abort"), { code: "EABORT" });
  };

  // Submit standard communication that produces world history events
  const commRes = service.submitQ4Communication({ world_id: worldId, channel: "standard", text: "Standard, reporting current status." });
  assert.equal(commRes.ok, false);
  assert.equal(commRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(commRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });
  assert.equal(service.getWorld(worldId).events?.length ?? 0, initialEventCount, "Event count must not grow on failed persist");

  service.commitPersistencePair = originalCommit;
  const retryComm = service.submitQ4Communication({ world_id: worldId, channel: "standard", text: "Standard, reporting current status." });
  assert.equal(retryComm.ok, true);
  assert.equal((service.getWorld(worldId).events?.length ?? 0) > initialEventCount, true, "Event count grows on successful persist");
});

test("Failpoint 9: Natural language action mutation rolls back on persistence failure and does not misreport PROVIDER_UNAVAILABLE", async t => {
  const ctx = createTestContext(t, { phase: "FIELD_OPERATION" });
  const { service, worldId, input } = ctx;
  const entry = service.session(worldId, input.mode);

  const beforeRun = JSON.parse(JSON.stringify(bootstrap.saveRun(entry.run)));
  const beforeWorld = history.canonicalJson(service.getWorld(worldId));
  const diskSessionBefore = fs.readFileSync(service.sessionFile(worldId, input.mode), "utf8");
  const diskWorldBefore = fs.readFileSync(service.worldFile(worldId), "utf8");

  const originalCommit = service.commitPersistencePair;
  service.commitPersistencePair = () => {
    throw Object.assign(new Error("simulated disk crash"), { code: "EIO" });
  };

  const naturalRes = await service.submitNatural({ ...input, text: "walk toward the open passage" });
  assert.equal(naturalRes.ok, false);
  assert.equal(naturalRes.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.notEqual(naturalRes.error?.code, "PROVIDER_UNAVAILABLE", "Must not misreport PROVIDER_UNAVAILABLE on persistence failure");
  assert.equal(naturalRes.error?.message, "The action could not be saved and was not committed. Check the operation record storage before retrying.");

  verifyRollback({ service, worldId, mode: input.mode, beforeRun, beforeWorld, diskSessionBefore, diskWorldBefore });

  service.commitPersistencePair = originalCommit;
  const retry = await service.submitNatural({ ...input, text: "walk toward the open passage" });
  assert.equal(retry.ok, true);
  assert.equal(retry.result?.executed, true);
  assert.equal(service.session(worldId, input.mode).run.spatial.player_location, "open-passage");
});

