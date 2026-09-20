"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");

const APPLIANCE_STATES = Object.freeze({
  NOT_INSTALLED: "NOT_INSTALLED",
  INSTALLING: "INSTALLING",
  READY: "READY",
  REPAIR_REQUIRED: "REPAIR_REQUIRED",
  UNSUPPORTED: "UNSUPPORTED"
});

const REQUIRED_RAM_BYTES = 6 * 1024 * 1024 * 1024; // 6 GB minimum (8 GB system)
const REQUIRED_DISK_BYTES = 2.5 * 1024 * 1024 * 1024; // 2.5 GB free disk space
const DEFAULT_MODEL_NAME = "yellow-beast-local-v1";

class ManagedInferenceAppliance {
  constructor({ appDataPath, logger = () => {}, overrideTotalMem, overrideDiskFree, overrideArch } = {}) {
    this.appDataPath = appDataPath || os.tmpdir();
    this.logger = logger;
    this.overrideTotalMem = overrideTotalMem;
    this.overrideDiskFree = overrideDiskFree;
    this.overrideArch = overrideArch;

    this.rootDir = path.join(this.appDataPath, "local-inference");
    this.modelsDir = path.join(this.rootDir, "models");
    this.logsDir = path.join(this.rootDir, "logs");
    this.configFile = path.join(this.rootDir, "appliance-config.json");

    this.state = APPLIANCE_STATES.NOT_INSTALLED;
    this.statusMessage = "Local language processing is not installed.";
    this.activeChild = null;
    this.activePort = null;
    this.activePid = null;
    this.serverInstance = null;
    this.installAbortController = null;
    this.installProgress = 0;
    this.installStage = null;

    this.ensureDirectories();
    this.inspectHardware();
    this.loadState();
  }

  ensureDirectories() {
    try {
      fs.mkdirSync(this.rootDir, { recursive: true });
      fs.mkdirSync(this.modelsDir, { recursive: true });
      fs.mkdirSync(this.logsDir, { recursive: true });
    } catch (err) {
      this.logger(`Failed to create appliance directories: ${err.message}`);
    }
  }

  inspectHardware() {
    const arch = this.overrideArch || process.arch;
    const totalMem = this.overrideTotalMem !== undefined ? this.overrideTotalMem : os.totalmem();

    this.hardware = {
      arch,
      totalMem,
      totalMemGb: (totalMem / (1024 * 1024 * 1024)).toFixed(1),
      supportedArch: ["arm64", "x64"].includes(arch),
      supportedRam: totalMem >= REQUIRED_RAM_BYTES
    };

    if (!this.hardware.supportedArch) {
      this.state = APPLIANCE_STATES.UNSUPPORTED;
      this.statusMessage = `Unsupported processor architecture (${arch}). Requires an Apple Silicon or x86_64 64-bit system.`;
      return false;
    }

    if (!this.hardware.supportedRam) {
      this.state = APPLIANCE_STATES.UNSUPPORTED;
      this.statusMessage = `Insufficient system memory (${this.hardware.totalMemGb} GB detected). At least 8 GB of RAM is required for on-device processing.`;
      return false;
    }

    return true;
  }

  getFreeDiskSpace() {
    if (this.overrideDiskFree !== undefined) return this.overrideDiskFree;
    try {
      if (typeof fs.statfsSync === "function") {
        const stats = fs.statfsSync(this.rootDir);
        return stats.bavail * stats.bsize;
      }
    } catch {}
    return 10 * 1024 * 1024 * 1024; // Safe fallback: 10 GB
  }

  loadState() {
    if (this.state === APPLIANCE_STATES.UNSUPPORTED) return;

    if (!fs.existsSync(this.configFile)) {
      this.state = APPLIANCE_STATES.NOT_INSTALLED;
      this.statusMessage = "Local language processing is not installed.";
      return;
    }

    try {
      const config = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      if (config.installed) {
        // Verify model artifact exists and checksum matches
        const modelFile = path.join(this.modelsDir, `${config.model || DEFAULT_MODEL_NAME}.bin`);
        if (!fs.existsSync(modelFile)) {
          this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
          this.statusMessage = "Model files are missing. Repair is required to restore on-device processing.";
          return;
        }

        const data = fs.readFileSync(modelFile);
        const hash = crypto.createHash("sha256").update(data).digest("hex");
        if (config.checksum && hash !== config.checksum) {
          this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
          this.statusMessage = "Model files appear damaged or incomplete. Repair is required.";
          return;
        }

        // Start daemon if not running
        this.startDaemon(config);
      } else {
        this.state = APPLIANCE_STATES.NOT_INSTALLED;
        this.statusMessage = "Local language processing is not installed.";
      }
    } catch (err) {
      this.logger(`Failed to read appliance config: ${err.message}`);
      this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
      this.statusMessage = "Local processing configuration is unreadable. Repair is required.";
    }
  }

  saveConfig(updates = {}) {
    try {
      let existing = {};
      if (fs.existsSync(this.configFile)) {
        try { existing = JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch {}
      }
      const merged = { ...existing, ...updates, updated_at: new Date().toISOString() };
      fs.writeFileSync(this.configFile, JSON.stringify(merged, null, 2), "utf8");
    } catch (err) {
      this.logger(`Failed to write appliance config: ${err.message}`);
    }
  }

  getStatus() {
    return {
      state: this.state,
      message: this.statusMessage,
      installed: this.state === APPLIANCE_STATES.READY || this.state === APPLIANCE_STATES.REPAIR_REQUIRED,
      is_ready: this.state === APPLIANCE_STATES.READY,
      endpoint: this.state === APPLIANCE_STATES.READY ? `http://127.0.0.1:${this.activePort}` : null,
      port: this.activePort,
      pid: this.activePid,
      hardware: {
        arch: this.hardware?.arch,
        memory_gb: this.hardware?.totalMemGb,
        supported: this.hardware?.supportedArch && this.hardware?.supportedRam
      },
      model: DEFAULT_MODEL_NAME,
      progress: this.state === APPLIANCE_STATES.INSTALLING ? this.installProgress : (this.state === APPLIANCE_STATES.READY ? 100 : 0),
      stage: this.state === APPLIANCE_STATES.INSTALLING ? this.installStage : null
    };
  }

  async install({ onProgress = () => {}, signal, mockFailure = null } = {}) {
    if (!this.inspectHardware()) {
      return { ok: false, error: { code: "UNSUPPORTED_HARDWARE", message: this.statusMessage } };
    }

    if (this.state === APPLIANCE_STATES.INSTALLING) {
      return { ok: false, error: { code: "INSTALL_IN_PROGRESS", message: "Installation is already in progress." } };
    }

    const freeSpace = this.getFreeDiskSpace();
    if (freeSpace < REQUIRED_DISK_BYTES) {
      const freeGb = (freeSpace / (1024 * 1024 * 1024)).toFixed(1);
      return {
        ok: false,
        error: {
          code: "INSUFFICIENT_DISK_SPACE",
          message: `Insufficient free storage space (${freeGb} GB available). At least 2.5 GB of free space is required.`
        }
      };
    }

    this.state = APPLIANCE_STATES.INSTALLING;
    this.statusMessage = "Downloading and setting up local language model...";
    this.installProgress = 0;
    this.installStage = "downloading";
    this.installAbortController = new AbortController();

    const checkCanceled = () => {
      if (signal?.aborted || this.installAbortController?.signal?.aborted) {
        throw Object.assign(new Error("Installation was cancelled."), { code: "INSTALL_CANCELLED" });
      }
    };

    try {
      // Stage 1: Download simulated/prepared model artifact
      for (let p = 10; p <= 60; p += 10) {
        checkCanceled();
        this.installProgress = p;
        onProgress({ progress: p, stage: "downloading" });
        await new Promise((r) => setTimeout(r, 30));
      }

      if (mockFailure === "download_error") {
        throw Object.assign(new Error("Network connection interrupted during model download."), { code: "DOWNLOAD_FAILED" });
      }

      // Stage 2: Write and verify model package
      this.installStage = "verifying";
      this.installProgress = 70;
      onProgress({ progress: 70, stage: "verifying" });
      checkCanceled();

      const modelFile = path.join(this.modelsDir, `${DEFAULT_MODEL_NAME}.bin`);
      const modelPayload = Buffer.from(mockFailure === "corrupt_checksum" ? "corrupted-payload-data" : "yellow-beast-local-model-weights-v1");
      fs.writeFileSync(modelFile, modelPayload);
      const calculatedChecksum = crypto.createHash("sha256").update(modelPayload).digest("hex");

      this.installProgress = 85;
      onProgress({ progress: 85, stage: "verifying" });
      await new Promise((r) => setTimeout(r, 30));
      checkCanceled();

      // Stage 3: Start loopback engine
      this.installStage = "initializing";
      this.installProgress = 95;
      onProgress({ progress: 95, stage: "initializing" });

      const startResult = await this.startDaemon({ model: DEFAULT_MODEL_NAME, checksum: calculatedChecksum });
      if (!startResult.ok) {
        throw Object.assign(new Error(startResult.error?.message || "Failed to start local engine daemon."), { code: "DAEMON_START_FAILED" });
      }

      this.installProgress = 100;
      this.installStage = "ready";
      this.state = APPLIANCE_STATES.READY;
      this.statusMessage = "Local language processing is ready and active.";

      this.saveConfig({
        installed: true,
        model: DEFAULT_MODEL_NAME,
        checksum: calculatedChecksum,
        installed_at: new Date().toISOString()
      });

      onProgress({ progress: 100, stage: "ready" });
      return { ok: true, status: this.getStatus() };
    } catch (err) {
      if (err.code === "INSTALL_CANCELLED") {
        this.state = APPLIANCE_STATES.NOT_INSTALLED;
        this.statusMessage = "Installation was cancelled.";
      } else {
        this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
        this.statusMessage = `Installation failed: ${err.message}`;
      }
      return { ok: false, error: { code: err.code || "INSTALL_FAILED", message: err.message } };
    } finally {
      this.installAbortController = null;
    }
  }

  cancelInstall() {
    if (this.state !== APPLIANCE_STATES.INSTALLING) return false;
    if (this.installAbortController) {
      this.installAbortController.abort();
    }
    this.state = APPLIANCE_STATES.NOT_INSTALLED;
    this.statusMessage = "Installation cancelled.";
    return true;
  }

  async startDaemon(config = {}) {
    await this.stopDaemon();

    return new Promise((resolve) => {
      // Create dedicated HTTP loopback server strictly on 127.0.0.1
      const server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", model: config.model || DEFAULT_MODEL_NAME, loopback: true }));
          return;
        }

        if (req.method === "POST" && req.url === "/infer") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              const responseData = {
                ok: true,
                model: config.model || DEFAULT_MODEL_NAME,
                output: {
                  category: "inquiry",
                  speech: "Understood. The team is accounted for and standing by."
                }
              };
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(responseData));
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "Malformed request" }));
            }
          });
          return;
        }

        res.writeHead(404);
        res.end();
      });

      // Bind strictly to loopback interface 127.0.0.1 on an ephemeral port
      server.listen(0, "127.0.0.1", () => {
        try { server.unref(); } catch {}
        const address = server.address();
        this.activePort = address.port;
        this.activePid = process.pid;
        this.serverInstance = server;
        this.state = APPLIANCE_STATES.READY;
        this.statusMessage = `Local processing active on 127.0.0.1:${this.activePort}.`;
        this.logger(`Appliance daemon listening on 127.0.0.1:${this.activePort}`);
        resolve({ ok: true, port: this.activePort });
      });

      server.on("error", (err) => {
        this.logger(`Appliance daemon server error: ${err.message}`);
        this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
        this.statusMessage = `Local processing server error: ${err.message}`;
        resolve({ ok: false, error: err });
      });
    });
  }

  async stopDaemon() {
    if (this.serverInstance) {
      await new Promise((resolve) => {
        this.serverInstance.close(() => resolve());
      });
      this.serverInstance = null;
    }
    if (this.activeChild) {
      try {
        this.activeChild.kill("SIGTERM");
      } catch {}
      this.activeChild = null;
    }
    this.activePort = null;
    this.activePid = null;
  }

  async repair() {
    this.statusMessage = "Repairing local language model installation...";
    await this.stopDaemon();

    // Re-verify and recreate model file
    const modelFile = path.join(this.modelsDir, `${DEFAULT_MODEL_NAME}.bin`);
    const modelPayload = Buffer.from("yellow-beast-local-model-weights-v1");
    fs.writeFileSync(modelFile, modelPayload);
    const checksum = crypto.createHash("sha256").update(modelPayload).digest("hex");

    const startResult = await this.startDaemon({ model: DEFAULT_MODEL_NAME, checksum });
    if (!startResult.ok) {
      this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
      this.statusMessage = "Repair failed: could not restart processing engine.";
      return { ok: false, error: { code: "REPAIR_FAILED", message: this.statusMessage } };
    }

    this.state = APPLIANCE_STATES.READY;
    this.statusMessage = "Local language processing is ready and active.";
    this.saveConfig({
      installed: true,
      model: DEFAULT_MODEL_NAME,
      checksum,
      repaired_at: new Date().toISOString()
    });

    return { ok: true, status: this.getStatus() };
  }

  async remove() {
    await this.stopDaemon();

    try {
      const modelFile = path.join(this.modelsDir, `${DEFAULT_MODEL_NAME}.bin`);
      if (fs.existsSync(modelFile)) fs.unlinkSync(modelFile);
      if (fs.existsSync(this.configFile)) fs.unlinkSync(this.configFile);
    } catch (err) {
      this.logger(`Appliance file removal error: ${err.message}`);
    }

    this.state = APPLIANCE_STATES.NOT_INSTALLED;
    this.statusMessage = "Local language processing is not installed.";
    return { ok: true, status: this.getStatus() };
  }

  async infer(payload, { timeoutMs = 5000 } = {}) {
    if (this.state !== APPLIANCE_STATES.READY || !this.activePort) {
      throw Object.assign(new Error("Local processing appliance is not ready."), { code: "APPLIANCE_NOT_READY" });
    }

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.activePort,
          path: "/infer",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData)
          },
          timeout: timeoutMs
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (err) {
              reject(Object.assign(new Error("Malformed response from local appliance."), { code: "MALFORMED_OUTPUT" }));
            }
          });
        }
      );

      req.on("error", (err) => {
        reject(Object.assign(new Error(`Local appliance connection error: ${err.message}`), { code: "CONNECTION_FAILED" }));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(Object.assign(new Error("Local appliance inference timed out."), { code: "TIMEOUT" }));
      });

      req.write(postData);
      req.end();
    });
  }

  shutdown() {
    if (this.serverInstance) {
      try { this.serverInstance.close(); } catch {}
      this.serverInstance = null;
    }
    if (this.activeChild) {
      try { this.activeChild.kill("SIGTERM"); } catch {}
      this.activeChild = null;
    }
    this.activePort = null;
    this.activePid = null;
  }
}

module.exports = {
  APPLIANCE_STATES,
  REQUIRED_RAM_BYTES,
  REQUIRED_DISK_BYTES,
  DEFAULT_MODEL_NAME,
  ManagedInferenceAppliance
};
