"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");

const APPLIANCE_STATES = Object.freeze({
  NOT_INSTALLED: "NOT_INSTALLED",
  INSTALLING: "INSTALLING",
  READY: "READY",
  REPAIR_REQUIRED: "REPAIR_REQUIRED",
  UNSUPPORTED: "UNSUPPORTED"
});

// On-device wording targets 16 GB machines: the pinned model peaks near 5.2 GB resident. Below this the
// appliance reports UNSUPPORTED and dialogue uses the same-plan deterministic fallback (never swapping).
const REQUIRED_RAM_BYTES = 12 * 1024 * 1024 * 1024;
const REQUIRED_DISK_BYTES = 2.5 * 1024 * 1024 * 1024; // 2.5 GB free disk space
const DEFAULT_MODEL_NAME = "yellow-beast-local-v1";

// Streaming SHA-256: multi-GB models exceed Node's single-Buffer read limit, so never readFileSync a model.
function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(8 * 1024 * 1024);
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      hash.update(n === chunk.length ? chunk : chunk.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

// The runtime pin (tools/local-runtime-pin.json) is the authority on which model file the application may run.
function pinnedModelChecksum() {
  try { return require("./local-runtime-pin.json").model?.sha256 ?? null; } catch { return null; }
}
// Single internal model asset contract. Not player-visible.
const MODEL_FILENAME = "yellow-beast-local-v1.gguf";
const DAEMON_START_TIMEOUT_MS = 30000;
const STOP_GRACE_MS = 4000;
// READY means: server responding + model loaded + one tiny inference completed.
const WARMUP_TIMEOUT_MS = 90000;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Electron sets process.resourcesPath in dev too (pointing inside the Electron
// binary); only a packaged app (not process.defaultApp) ships bundled assets there.
function packagedResourcesPath() {
  return process.resourcesPath && !process.defaultApp ? process.resourcesPath : null;
}

class ManagedInferenceAppliance {
  constructor({
    appDataPath,
    logger = () => {},
    overrideTotalMem,
    overrideDiskFree,
    overrideArch,
    developerMode = process.env.YELLOW_BEAST_DEVELOPER_MODE === "1",
    spawnFn = spawn,
    // Told when a READY daemon exits on its own (crash, OOM kill), so the owner can respawn at once
    // instead of discovering the loss on the next dialogue request.
    onUnexpectedExit = null
  } = {}) {
    this.appDataPath = appDataPath || os.tmpdir();
    this.logger = logger;
    this.onUnexpectedExit = typeof onUnexpectedExit === "function" ? onUnexpectedExit : null;
    this.overrideTotalMem = overrideTotalMem;
    this.overrideDiskFree = overrideDiskFree;
    this.overrideArch = overrideArch;
    this.developerMode = developerMode === true;
    this.spawnFn = spawnFn;

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
    this.usingDevStub = false;
    this.installAbortController = null;
    this.installProgress = 0;
    this.installStage = null;

    this.ensureDirectories();
    this.inspectHardware();
    this.loadState();
    this.installExitHook();
  }

  // Synchronous backstop: Electron's before-quit does not await async work,
  // so a crash or a skipped shutdown() call could otherwise orphan the child
  // process. This only ever fires within this same process's lifetime.
  installExitHook() {
    if (this._exitHookInstalled) return;
    this._exitHookInstalled = true;
    process.on("exit", () => {
      if (this.activeChild && !this.activeChild.killed) {
        try { this.activeChild.kill("SIGKILL"); } catch {}
      }
    });
  }

  // --- Bundled asset resolution -------------------------------------------------

  resolveBinaryPath() {
    const base = packagedResourcesPath()
      ? path.join(process.resourcesPath, "llama")
      : path.join(__dirname, "..", "vendor", "llama");
    const name = process.platform === "win32" ? "llama-server.exe" : "llama-server";
    return path.join(base, name);
  }

  // The application's own bundled model (packaged resources, or vendor/ in a dev tree).
  bundledModelPath() {
    const base = packagedResourcesPath()
      ? path.join(process.resourcesPath, "model")
      : path.join(__dirname, "..", "vendor", "model");
    return path.join(base, MODEL_FILENAME);
  }

  resolveModelPath() {
    if (this.developerMode && process.env.YELLOW_BEAST_LOCAL_MODEL_PATH) {
      return process.env.YELLOW_BEAST_LOCAL_MODEL_PATH;
    }
    return this.bundledModelPath();
  }

  hasBundledAssets() {
    // Test seam: force the loopback stub even when real vendor/ assets exist.
    if (process.env.YELLOW_BEAST_LOCAL_RUNTIME === "stub") return false;
    try { return fs.existsSync(this.resolveBinaryPath()) && fs.existsSync(this.resolveModelPath()); }
    catch { return false; }
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
      this.statusMessage = `Insufficient system memory (${this.hardware.totalMemGb} GB detected). At least 16 GB of RAM is required for on-device processing.`;
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

  // --- Config / state -------------------------------------------------------

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
        const modelFile = config.model_path || path.join(this.modelsDir, `${config.model || DEFAULT_MODEL_NAME}.bin`);
        if (!fs.existsSync(modelFile)) {
          this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
          this.statusMessage = "Model files are missing. Repair is required to restore on-device processing.";
          return;
        }

        // A full-file hash of a multi-GB model must not run on every
        // construction. Trust size+mtime recorded at install time; only fall
        // back to a full hash when that metadata is absent or has drifted.
        const stat = fs.statSync(modelFile);
        let corrupted = false;
        if (config.model_size == null || config.model_mtime_ms == null || stat.size !== config.model_size || stat.mtimeMs !== config.model_mtime_ms) {
          const hash = sha256File(modelFile);
          if (config.checksum && hash !== config.checksum) {
            corrupted = true;
          } else {
            this.saveConfig({ model_size: stat.size, model_mtime_ms: stat.mtimeMs });
          }
        }

        if (corrupted) {
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

  // --- Install / repair / remove --------------------------------------------

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
    this.statusMessage = "Setting up local language processing...";
    this.installProgress = 0;
    this.installStage = "verifying";
    this.installAbortController = new AbortController();

    const checkCanceled = () => {
      if (signal?.aborted || this.installAbortController?.signal?.aborted) {
        throw Object.assign(new Error("Installation was cancelled."), { code: "INSTALL_CANCELLED" });
      }
    };

    try {
      // Stage 1: verify the runtime binary + model asset are present
      this.installProgress = 20;
      onProgress({ progress: 20, stage: "verifying" });
      checkCanceled();

      if (mockFailure === "download_error") {
        throw Object.assign(new Error("The local processing asset could not be verified."), { code: "DOWNLOAD_FAILED" });
      }

      const modelFile = this.hasBundledAssets()
        ? this.resolveModelPath()
        : this.writeDevStubModelAsset(mockFailure);

      this.installProgress = 60;
      onProgress({ progress: 60, stage: "verifying" });
      checkCanceled();

      const stat = fs.statSync(modelFile);
      const calculatedChecksum = sha256File(modelFile);
      this.assertPinnedModel(modelFile, calculatedChecksum);

      this.installProgress = 85;
      onProgress({ progress: 85, stage: "verifying" });
      await new Promise((r) => setTimeout(r, 30));
      checkCanceled();

      // Stage 2: start the loopback engine
      this.installStage = "initializing";
      this.installProgress = 95;
      onProgress({ progress: 95, stage: "initializing" });

      const startResult = await this.startDaemon({ model: DEFAULT_MODEL_NAME, checksum: calculatedChecksum, model_path: modelFile });
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
        model_path: modelFile,
        checksum: calculatedChecksum,
        model_size: stat.size,
        model_mtime_ms: stat.mtimeMs,
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

  // Dev/CI-only fallback used when no bundled llama-server binary and GGUF
  // asset are present on disk (this repository ships neither). Production
  // packaged builds always have hasBundledAssets() === true, so this path
  // never runs there. Keeps install/repair/remove lifecycle testable without
  // a multi-GB model artifact in the repo.
  writeDevStubModelAsset(mockFailure) {
    this.usingDevStub = true;
    const modelFile = path.join(this.modelsDir, `${DEFAULT_MODEL_NAME}.bin`);
    const payload = Buffer.from(mockFailure === "corrupt_checksum" ? "corrupted-payload-data" : "yellow-beast-local-model-weights-v1");
    fs.writeFileSync(modelFile, payload);
    return modelFile;
  }

  // Only the application's own bundled model is held to the pin; a developer-supplied override path is not.
  assertPinnedModel(modelFile, checksum) {
    if (path.resolve(modelFile) !== path.resolve(this.bundledModelPath())) return;
    const pinned = pinnedModelChecksum();
    if (pinned && checksum !== pinned) throw Object.assign(new Error("The local processing asset does not match the pinned version."), { code: "CHECKSUM_MISMATCH" });
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

  // --- Daemon lifecycle -------------------------------------------------------

  async startDaemon(config = {}) {
    await this.stopDaemon();
    if (this.hasBundledAssets()) {
      return this.startSpawnedDaemon(config);
    }
    return this.startDevStubDaemon(config);
  }

  // A hard crash of the application (SIGKILL, power loss) skips every exit hook, and macOS gives the
  // child no parent-death signal, so a multi-GB llama-server could outlive it until reboot. Each spawn
  // records its pid; the next start terminates that process ONLY if it is still alive and its command
  // line is this appliance's own binary serving this appliance's own model.
  daemonPidFile() { return path.join(this.rootDir, "daemon.pid.json"); }
  async reapStaleDaemon(binaryPath, modelPath) {
    let record = null;
    try { record = JSON.parse(fs.readFileSync(this.daemonPidFile(), "utf8")); } catch { return { reaped: false }; }
    try { fs.rmSync(this.daemonPidFile(), { force: true }); } catch {}
    const pid = Number(record?.pid);
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || process.platform === "win32") return { reaped: false };
    const command = await new Promise((resolve) => execFile("ps", ["-o", "command=", "-p", String(pid)], (err, out) => resolve(err ? "" : String(out).trim())));
    if (!command || !command.includes(binaryPath) || !command.includes(modelPath)) return { reaped: false };
    try { process.kill(pid, "SIGTERM"); } catch { return { reaped: false }; }
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); try { process.kill(pid, 0); } catch { return { reaped: true, pid }; } }
    try { process.kill(pid, "SIGKILL"); } catch {}
    this.logger(`Reaped stale local processing engine (pid ${pid}) left by an earlier session.`);
    return { reaped: true, pid };
  }

  async startSpawnedDaemon(config) {
    const binaryPath = this.resolveBinaryPath();
    const modelPath = config.model_path || this.resolveModelPath();
    try { await this.reapStaleDaemon(binaryPath, modelPath); } catch {}
    let requestedPort;
    try { requestedPort = await findFreePort(); } catch { requestedPort = 0; }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => { if (settled) return; settled = true; resolve(result); };

      let child;
      try {
        child = this.spawnFn(binaryPath, [
          "--model", modelPath,
          "--alias", DEFAULT_MODEL_NAME,
          "--host", "127.0.0.1",
          "--port", String(requestedPort),
          // Production prompts are <= ~800 tokens and replies <= 256; 4096 covers them with headroom and
          // halves the KV cache versus 8192 (measured -0.35..0.65 GB resident, no latency cost).
          "--ctx-size", "4096",
          // llama.cpp's host-RAM prompt cache defaults to 8 GiB. Dialogue prompts differ after the shared
          // system prefix (which slot-level prefix reuse already covers), so the cache bought no latency
          // in measurement while letting this process grow by gigabytes on a 16 GB machine. Disabled.
          "--cache-ram", "0",
          "--no-webui"
        ], { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
        this.statusMessage = `Local processing engine could not be started: ${err.message}`;
        finish({ ok: false, error: err });
        return;
      }

      this.activeChild = child;
      this.activePid = child.pid ?? null;
      this.usingDevStub = false;
      try { if (child.pid) fs.writeFileSync(this.daemonPidFile(), JSON.stringify({ pid: child.pid, binary: binaryPath, model: modelPath, started_at: new Date().toISOString() })); } catch {}

      const timeoutTimer = setTimeout(() => {
        finish({ ok: false, error: new Error("Local processing engine did not report ready in time.") });
      }, DAEMON_START_TIMEOUT_MS);
      if (timeoutTimer.unref) timeoutTimer.unref();

      let warming = false;
      const onLine = (line) => {
        const match = /127\.0\.0\.1:(\d{2,5})\b/.exec(line) || /listening[^0-9]*(\d{4,5})\b/i.exec(line);
        if (!match) return;
        const port = Number.parseInt(match[1], 10);
        if (!Number.isInteger(port) || port <= 0) return;
        if (warming) return;
        warming = true;
        clearTimeout(timeoutTimer);
        this.activePort = port;
        this.logger(`Appliance daemon listening on 127.0.0.1:${port}; warming up`);
        this.warmup().then((warm) => {
          if (settled) return;
          if (!warm.ok) {
            this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
            this.statusMessage = `Local processing engine failed its warmup check: ${warm.error}`;
            this.logger(`Appliance warmup failed: ${warm.error}`);
            try { child.kill("SIGTERM"); } catch {}
            finish({ ok: false, error: new Error(warm.error) });
            return;
          }
          this.state = APPLIANCE_STATES.READY;
          this.statusMessage = `Local processing active on 127.0.0.1:${port}.`;
          this.logger(`Appliance warmup succeeded (${warm.ms}ms); READY on 127.0.0.1:${port}`);
          finish({ ok: true, port });
        });
      };
      const onChunk = (chunk) => String(chunk).split(/\r?\n/).forEach(onLine);
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);

      child.on("error", (err) => {
        clearTimeout(timeoutTimer);
        this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
        this.statusMessage = `Local processing engine error: ${err.message}`;
        finish({ ok: false, error: err });
      });

      child.on("exit", (code) => {
        if (!settled) {
          clearTimeout(timeoutTimer);
          this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
          this.statusMessage = `Local processing engine exited unexpectedly (code ${code}).`;
          finish({ ok: false, error: new Error(`llama-server exited with code ${code}`) });
        }
        // Only the child we are still tracking counts: stopDaemon() clears activeChild before it kills.
        const crashedWhileReady = settled && this.activeChild === child && this.state === APPLIANCE_STATES.READY;
        if (this.activeChild === child) { this.activeChild = null; this.activePort = null; this.activePid = null; }
        if (crashedWhileReady) {
          // The status must not keep claiming READY with no process behind it.
          this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
          this.statusMessage = `Local processing engine stopped unexpectedly (code ${code}).`;
          this.logger(`Appliance daemon exited unexpectedly while ready (code ${code}).`);
          try { this.onUnexpectedExit?.({ code }); } catch {}
        }
      });
    });
  }

  // Dev/CI-only loopback stub standing in for a real llama-server child
  // process when no bundled binary/model is present on disk. See
  // writeDevStubModelAsset() above for why this path exists.
  async startDevStubDaemon(config = {}) {
    this.usingDevStub = true;
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", model: config.model || DEFAULT_MODEL_NAME, loopback: true }));
          return;
        }

        if (req.method === "POST" && req.url === "/v1/chat/completions") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              JSON.parse(body);
              const responseData = {
                model: config.model || DEFAULT_MODEL_NAME,
                choices: [{ message: { role: "assistant", content: "Understood. The team is accounted for and standing by." } }]
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
      const child = this.activeChild;
      this.activeChild = null;
      await this.terminateChild(child);
    }
    try { fs.rmSync(this.daemonPidFile(), { force: true }); } catch {}
    this.activePort = null;
    this.activePid = null;
  }

  async terminateChild(child) {
    if (!child || child.killed) return;
    if (process.platform === "win32" && child.pid) {
      try {
        await new Promise((resolve) => {
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => resolve());
        });
        return;
      } catch { /* fall through to signal-based termination */ }
    }
    try { child.kill("SIGTERM"); } catch {}
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), STOP_GRACE_MS);
      if (timer.unref) timer.unref();
      child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
    if (!exited) {
      try { child.kill("SIGKILL"); } catch {}
    }
  }

  // Bounded: health polling (model load) then one 1-token completion.
  async warmup({ timeoutMs = WARMUP_TIMEOUT_MS } = {}) {
    const started = Date.now();
    const deadline = started + timeoutMs;
    while (Date.now() < deadline) {
      const health = await this.healthcheck({ timeoutMs: 2000 });
      if (health.ok) break;
      if (!this.activeChild && !this.usingDevStub) return { ok: false, error: "engine exited during startup" };
      await new Promise((r) => setTimeout(r, 250));
    }
    if (Date.now() >= deadline) return { ok: false, error: "engine did not become healthy in time" };
    const postData = JSON.stringify({ model: DEFAULT_MODEL_NAME, messages: [{ role: "user", content: "Reply with one word." }], max_tokens: 4, temperature: 0, stream: false });
    return new Promise((resolve) => {
      const remaining = Math.max(1000, deadline - Date.now());
      const req = http.request({ hostname: "127.0.0.1", port: this.activePort, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) }, timeout: remaining }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const parsed = safeParseJson(data);
          if (res.statusCode === 200 && parsed?.choices?.length) resolve({ ok: true, ms: Date.now() - started });
          else resolve({ ok: false, error: `warmup inference returned ${res.statusCode}` });
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "warmup inference timed out" }); });
      req.on("error", (err) => resolve({ ok: false, error: err.message }));
      req.write(postData);
      req.end();
    });
  }

  async healthcheck({ timeoutMs = 2000 } = {}) {
    if (!this.activePort) return { ok: false, code: "NOT_RUNNING" };
    return new Promise((resolve) => {
      const req = http.get({ hostname: "127.0.0.1", port: this.activePort, path: "/health", timeout: timeoutMs }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) resolve({ ok: true, status: "ready", body: safeParseJson(body) });
          else if (res.statusCode === 503) resolve({ ok: false, status: "loading", body: safeParseJson(body) });
          else resolve({ ok: false, status: "error", code: res.statusCode });
        });
      });
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, code: "TIMEOUT" }); });
      req.on("error", (err) => resolve({ ok: false, code: "CONNECTION_FAILED", error: err.message }));
    });
  }

  // Crash recovery: restart the daemon on the already-installed model. Integrity follows loadState()'s
  // rule -- the size+mtime recorded at the last full verification must still match; any drift (or a
  // missing record) falls back to a full hash and pin check via repair(). Explicit repair always hashes.
  async respawn() {
    let config = null;
    try { config = JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch { config = null; }
    const modelFile = this.hasBundledAssets() ? this.resolveModelPath() : null;
    let stat = null;
    try { stat = modelFile ? fs.statSync(modelFile) : null; } catch { stat = null; }
    const unchanged = Boolean(config?.installed && stat && config.model_path && path.resolve(config.model_path) === path.resolve(modelFile) && config.model_size === stat.size && config.model_mtime_ms === stat.mtimeMs && config.checksum);
    if (!unchanged) return this.repair();
    await this.stopDaemon();
    const startResult = await this.startDaemon({ model: DEFAULT_MODEL_NAME, checksum: config.checksum, model_path: modelFile });
    if (!startResult.ok) return this.repair();
    this.state = APPLIANCE_STATES.READY;
    this.statusMessage = "Local language processing is ready and active.";
    return { ok: true, status: this.getStatus(), respawned: true };
  }

  async repair() {
    this.statusMessage = "Repairing local language model installation...";
    await this.stopDaemon();

    const modelFile = this.hasBundledAssets() ? this.resolveModelPath() : this.writeDevStubModelAsset(null);
    const stat = fs.statSync(modelFile);
    const checksum = sha256File(modelFile);
    try { this.assertPinnedModel(modelFile, checksum); }
    catch (err) {
      this.state = APPLIANCE_STATES.REPAIR_REQUIRED;
      this.statusMessage = `Repair failed: ${err.message}`;
      return { ok: false, error: { code: err.code || "CHECKSUM_MISMATCH", message: this.statusMessage } };
    }

    const startResult = await this.startDaemon({ model: DEFAULT_MODEL_NAME, checksum, model_path: modelFile });
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
      model_path: modelFile,
      checksum,
      model_size: stat.size,
      model_mtime_ms: stat.mtimeMs,
      repaired_at: new Date().toISOString()
    });

    return { ok: true, status: this.getStatus() };
  }

  async remove() {
    await this.stopDaemon();

    try {
      let modelFile = path.join(this.modelsDir, `${DEFAULT_MODEL_NAME}.bin`);
      if (fs.existsSync(this.configFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
          if (config.model_path) modelFile = config.model_path;
        } catch {}
      }
      // Never delete a bundled production asset outside our own managed
      // directory -- only the dev-stub fixture (or a leftover legacy file)
      // written into modelsDir is ours to remove.
      if (modelFile.startsWith(this.modelsDir) && fs.existsSync(modelFile)) fs.unlinkSync(modelFile);
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

    const postData = JSON.stringify({
      model: DEFAULT_MODEL_NAME,
      messages: [{ role: "user", content: typeof payload?.prompt === "string" ? payload.prompt : JSON.stringify(payload) }],
      stream: false
    });

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.activePort,
          path: "/v1/chat/completions",
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
              const content = parsed?.choices?.[0]?.message?.content ?? "";
              resolve({ ok: true, model: parsed?.model ?? DEFAULT_MODEL_NAME, output: { category: "inquiry", speech: content } });
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
  MODEL_FILENAME,
  ManagedInferenceAppliance
};
