"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const {
  ManagedInferenceAppliance,
  APPLIANCE_STATES,
  REQUIRED_RAM_BYTES,
  REQUIRED_DISK_BYTES,
  DEFAULT_MODEL_NAME
} = require("../tools/managed-inference-appliance");
const { DesktopService } = require("../desktop/service");

function createTestAppliance(options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yb-appliance-test-"));
  const appliance = new ManagedInferenceAppliance({
    appDataPath: tmpDir,
    overrideTotalMem: options.overrideTotalMem ?? 16 * 1024 * 1024 * 1024,
    overrideDiskFree: options.overrideDiskFree ?? 20 * 1024 * 1024 * 1024,
    overrideArch: options.overrideArch ?? "arm64",
    ...options
  });
  return { appliance, tmpDir };
}

test("y102 — Gate 2: Hardware inspection rejects insufficient RAM and unsupported architectures", () => {
  // Sub-test 1: Low RAM (< 6GB)
  const lowRam = createTestAppliance({ overrideTotalMem: 4 * 1024 * 1024 * 1024 });
  try {
    assert.equal(lowRam.appliance.state, APPLIANCE_STATES.UNSUPPORTED);
    assert.match(lowRam.appliance.statusMessage, /Insufficient system memory/);
    const status = lowRam.appliance.getStatus();
    assert.equal(status.hardware.supported, false);
  } finally {
    lowRam.appliance.shutdown();
    fs.rmSync(lowRam.tmpDir, { recursive: true, force: true });
  }

  // Sub-test 2: Unsupported Architecture (e.g. mips or ia32)
  const badArch = createTestAppliance({ overrideArch: "ia32" });
  try {
    assert.equal(badArch.appliance.state, APPLIANCE_STATES.UNSUPPORTED);
    assert.match(badArch.appliance.statusMessage, /Unsupported processor architecture/);
  } finally {
    badArch.appliance.shutdown();
    fs.rmSync(badArch.tmpDir, { recursive: true, force: true });
  }
});

test("y102 — Gate 2: Disk space check rejects installation if free space < 2.5 GB", async () => {
  const lowDisk = createTestAppliance({ overrideDiskFree: 1 * 1024 * 1024 * 1024 }); // 1 GB free
  try {
    assert.equal(lowDisk.appliance.state, APPLIANCE_STATES.NOT_INSTALLED);
    const installRes = await lowDisk.appliance.install();
    assert.equal(installRes.ok, false);
    assert.equal(installRes.error.code, "INSUFFICIENT_DISK_SPACE");
    assert.match(installRes.error.message, /Insufficient free storage space/);
  } finally {
    lowDisk.appliance.shutdown();
    fs.rmSync(lowDisk.tmpDir, { recursive: true, force: true });
  }
});

test("y102 — Gate 2: Installation cancellation restores NOT_INSTALLED cleanly", async () => {
  const { appliance, tmpDir } = createTestAppliance();
  try {
    const installPromise = appliance.install();
    const cancelled = appliance.cancelInstall();
    assert.equal(cancelled, true);
    const result = await installPromise;
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INSTALL_CANCELLED");
    assert.equal(appliance.state, APPLIANCE_STATES.NOT_INSTALLED);
  } finally {
    appliance.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("y102 — Gate 2: End-to-end appliance lifecycle (install, loopback check, infer, restart, repair, remove)", async () => {
  const { appliance, tmpDir } = createTestAppliance();
  try {
    // 1. Initial status
    assert.equal(appliance.state, APPLIANCE_STATES.NOT_INSTALLED);
    const initStatus = appliance.getStatus();
    assert.equal(initStatus.installed, false);
    assert.equal(initStatus.is_ready, false);

    // 2. Install
    const progressUpdates = [];
    const installRes = await appliance.install({
      onProgress: (p) => progressUpdates.push(p.progress)
    });
    assert.equal(installRes.ok, true);
    assert.equal(appliance.state, APPLIANCE_STATES.READY);
    assert.ok(progressUpdates.length >= 3);
    assert.equal(progressUpdates.at(-1), 100);

    // Verify config persisted
    const configPath = path.join(tmpDir, "local-inference", "appliance-config.json");
    assert.ok(fs.existsSync(configPath));
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.installed, true);
    assert.equal(config.model, DEFAULT_MODEL_NAME);

    // 3. Loopback binding verification (strictly 127.0.0.1, never 0.0.0.0)
    const port = appliance.activePort;
    assert.ok(port > 1024, "Port must be an ephemeral unprivileged port");
    assert.equal(appliance.getStatus().endpoint, "http://127.0.0.1:" + port);

    // Verify /health via HTTP loopback
    const healthData = await new Promise((resolve, reject) => {
      http.get("http://127.0.0.1:" + port + "/health", (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve(JSON.parse(body)));
      }).on("error", reject);
    });
    assert.equal(healthData.status, "ok");
    assert.equal(healthData.loopback, true);

    // 4. Run inference request
    const inferRes = await appliance.infer({ prompt: "Status report?" });
    assert.equal(inferRes.ok, true);
    assert.ok(inferRes.output.speech.length > 0);

    // 5. Restart resilience: create new appliance pointing to same appDataPath
    await appliance.stopDaemon();
    const restarted = new ManagedInferenceAppliance({
      appDataPath: tmpDir,
      overrideTotalMem: 16 * 1024 * 1024 * 1024,
      overrideDiskFree: 20 * 1024 * 1024 * 1024,
      overrideArch: "arm64"
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(restarted.state, APPLIANCE_STATES.READY);
    assert.ok(restarted.activePort > 0);

    // 6. Corruption recovery: corrupt model file and verify REPAIR_REQUIRED
    await restarted.stopDaemon();
    const modelFile = path.join(tmpDir, "local-inference", "models", DEFAULT_MODEL_NAME + ".bin");
    fs.writeFileSync(modelFile, "corrupted-file-content");

    const corrupted = new ManagedInferenceAppliance({
      appDataPath: tmpDir,
      overrideTotalMem: 16 * 1024 * 1024 * 1024,
      overrideDiskFree: 20 * 1024 * 1024 * 1024,
      overrideArch: "arm64"
    });
    assert.equal(corrupted.state, APPLIANCE_STATES.REPAIR_REQUIRED);
    assert.match(corrupted.statusMessage, /damaged or incomplete/);

    // 7. Repair
    const repairRes = await corrupted.repair();
    assert.equal(repairRes.ok, true);
    assert.equal(corrupted.state, APPLIANCE_STATES.READY);

    // 8. Removal
    const removeRes = await corrupted.remove();
    assert.equal(removeRes.ok, true);
    assert.equal(corrupted.state, APPLIANCE_STATES.NOT_INSTALLED);
    assert.equal(fs.existsSync(modelFile), false);
  } finally {
    appliance.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("y102 — Gate 2: DesktopService appliance integration and clean shutdown", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yb-service-appliance-"));
  const service = new DesktopService({
    appDataPath: tmpDir,
    defaultQ4Scenario: "day1-opener"
  });

  try {
    // 1. Initial status via service
    const statusRes = service.getInferenceApplianceStatus();
    assert.equal(statusRes.ok, true);
    assert.equal(statusRes.appliance.state, APPLIANCE_STATES.NOT_INSTALLED);

    // 2. Install via service
    const installRes = await service.installInferenceAppliance();
    assert.equal(installRes.ok, true);
    assert.equal(service.inferenceAppliance.state, APPLIANCE_STATES.READY);

    // 3. Settings projection includes appliance status
    const settingsRes = service.getSettings();
    assert.equal(settingsRes.ok, true);
    const localEntry = settingsRes.provider.entries.find((e) => e.kind === "local");
    assert.ok(localEntry);
    assert.equal(localEntry.configured, true);

    // 4. Shutdown cleanly releases port
    const activePort = service.inferenceAppliance.activePort;
    service.shutdown();
    assert.equal(service.inferenceAppliance.activePort, null);

    // Verify port is closed
    await new Promise((resolve) => {
      const client = http.get("http://127.0.0.1:" + activePort + "/health", () => {
        assert.fail("Server should have terminated upon shutdown");
      });
      client.on("error", () => {
        resolve();
      });
    });
  } finally {
    service.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
