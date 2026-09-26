"use strict";

// ED-30 I5/I6/J15: a headless conversation over the REAL production service (DesktopService), for the
// dialogue REPL, transcript replay and real-model sessions. Nothing here stubs interpretation, planning,
// validation or commit; only the wording provider is chosen:
//
//   real      the production local-model provider code against the pinned llama.cpp runtime + bundled model
//             (launched here with the appliance's arguments; or an already-running `--endpoint`)
//   fallback  no language model at all (deterministic wording only)
//   garbage   a provider whose every reply is malformed (exercises reject -> fallback)
//   throwing  a provider that crashes on every call
//
// Developer tooling only: it runs with developer mode on so the dev trace is available.

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DesktopService } = require("../desktop/service");
const { createLocalModelProvider } = require("./ai-local-model-provider");
const { DEFAULT_MODEL_NAME } = require("./managed-inference-appliance");
const devtrace = require("./dialogue-devtrace");

const ROOT = path.join(__dirname, "..");
const PROVIDERS = Object.freeze(["real", "fallback", "garbage", "throwing", "leaky"]);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

/** Launches the pinned llama-server with the bundled model (the appliance's own arguments). */
async function startLocalModel({ timeoutMs = 180000, log = () => {} } = {}) {
  const binary = path.join(ROOT, "vendor", "llama", process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const model = path.join(ROOT, "vendor", "model", "yellow-beast-local-v1.gguf");
  if (!fs.existsSync(binary) || !fs.existsSync(model)) throw new Error("the pinned runtime/model is not present under vendor/ (run the runtime fetch tool first)");
  const port = await freePort();
  const child = spawn(binary, ["--model", model, "--alias", DEFAULT_MODEL_NAME, "--host", "127.0.0.1", "--port", String(port), "--ctx-size", "4096", "--cache-ram", "0", "--no-webui"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => log(String(d)));
  child.stderr.on("data", (d) => log(String(d)));
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`llama-server exited with code ${child.exitCode}`);
    try { const res = await fetch(`${endpoint}/health`); if (res.ok) break; } catch {}
    if (Date.now() - started > timeoutMs) { child.kill("SIGKILL"); throw new Error("llama-server did not become ready in time"); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { endpoint, pid: child.pid, load_ms: Date.now() - started, stop: () => new Promise((resolve) => { if (child.exitCode != null) return resolve(); child.once("exit", () => resolve()); child.kill("SIGTERM"); setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000).unref(); }) };
}

// Broken wording providers run the REAL provider code over a scripted HTTP layer: malformed JSON, a crash,
// or (leaky) a well-formed line that always tries the worst leak -- another person's private state.
function brokenProvider(kind) {
  const fetchImpl = async (url, options) => {
    if (kind === "throwing") throw new Error("provider crashed");
    let content = "{bad";
    if (kind === "leaky") content = /classify the LANGUAGE/.test(JSON.parse(options.body).messages[0].content) ? "{}" : JSON.stringify({ speech: "Not too bad myself. Tonya's doing alright too." });
    return { ok: true, status: 200, json: async () => ({ id: "x", choices: [{ message: { content } }] }) };
  };
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:9", fetchImpl, timeout: 300 });
  return { name: "local", model: real.model, presentLocal: (packet) => real.presentLocal(packet), interpretDialogue: (input) => real.interpretDialogue(input) };
}

/**
 * Opens a session. `save` + `world_id` resume an existing save (an Electron profile's app-data folder);
 * otherwise a fresh Day-1 world is created from `seed`. `names` (optional) renames the coworkers in slot
 * order (a replayed transcript's names).
 */
async function openSession({ provider = "fallback", endpoint = null, seed = "ed30-repl", save = null, world_id = null, names = null, player = { first_name: "Jack", last_name: "Tester" }, brief = true, log = null } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`provider must be one of ${PROVIDERS.join(", ")}`);
  let runtime = null;
  let localDialogueProvider = null;
  if (provider === "real") {
    if (!endpoint) runtime = await startLocalModel({ log: log ?? (() => {}) });
    localDialogueProvider = createLocalModelProvider({ endpoint: endpoint ?? runtime.endpoint });
  } else if (provider !== "fallback") localDialogueProvider = brokenProvider(provider);
  const root = save ?? fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(localDialogueProvider ? { localDialogueProvider } : {}) });
  if (provider === "fallback") service.updateSettings({ provider: "offline" });
  const logs = [];
  service.log = (line) => { logs.push(String(line)); if (logs.length > 400) logs.shift(); };
  let worldId = world_id;
  if (worldId) {
    const resumed = service.resumeSession({ world_id: worldId, mode: "field-researcher" });
    if (!resumed.ok) throw new Error(`could not resume ${worldId}: ${resumed.error?.message ?? "unknown"}`);
  } else {
    worldId = service.createWorld({ name: "Dialogue session", seed }).world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: player.first_name, last_name: player.last_name });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  }
  const session = {
    provider, service, root, worldId, logs, runtime, counter: 0,
    get run() { return service.session(worldId, "field-researcher").run; },
    get playerId() { return this.run.session.startup.player.observer_id; },
    coworkers() { return this.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== this.playerId); },
    action(action) { return service.submitAction({ world_id: worldId, mode: "field-researcher", action }); },
    brief() {
      if (this.run.expedition.day1_opener?.beat === "LOCAL_INTRODUCTIONS") return;
      this.action("ATTEND_BRIEFING");
      for (let beat = 0; beat < 3; beat += 1) this.action("CONTINUE_BRIEFING");
      this.action("CONCLUDE_BRIEFING");
    },
    rename(list) {
      const world = service.getWorld(worldId);
      this.coworkers().forEach((m, i) => {
        if (!list[i] || m.first_name === list[i]) return;
        const id = m.personnel_id ?? m.id;
        m.first_name = list[i];
        m.display_name = `${list[i]} ${m.last_name}`;
        for (const w of [world, this.run._world]) { const c = w?.characters?.[id]; if (c) { c.first_name = list[i]; c.display_name = `${list[i]} ${c.last_name}`; } }
      });
      service.persistSession(world, "field-researcher", service.session(worldId, "field-researcher"));
    },
    /** One LOCAL line, exactly as the Electron composer sends it. Returns the committed lines + dev trace. */
    async say(text) {
      const request_id = `s-${Date.now().toString(36)}-${++this.counter}`;
      const started = process.hrtime.bigint();
      const result = await service.submitQ4Communication({ world_id: worldId, channel: "local", text, request_id });
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const names = Object.fromEntries(this.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
      const spoken = this.run.expedition.dialogue_history.filter((e) => e.submission_id === request_id && e.speaker_id !== this.playerId);
      const wordsmith = service.dialogueWordsmithTraces.find((t) => t.request_id === request_id) ?? null;
      return {
        request_id, ms, ok: result?.ok !== false, error: result?.ok === false ? result.error : null,
        lines: spoken.map((e) => ({ speaker: names[e.speaker_id] ?? e.speaker_name ?? e.speaker_id, text: e.text })),
        semantic: devtrace.semanticTurn(this.run, request_id),
        trace: devtrace.turnTrace(this.run, request_id, { wordsmith })
      };
    },
    transcript() { return devtrace.transcriptRecords(this.run, { world: service.getWorld(worldId), wordsmithTraces: service.dialogueWordsmithTraces }); },
    async close({ keep = false } = {}) {
      try { service.shutdown?.(); } catch {}
      if (runtime) await runtime.stop();
      if (!keep && !save) fs.rmSync(root, { recursive: true, force: true });
    }
  };
  if (names?.length) session.rename(names);
  if (brief && !world_id) session.brief();
  return session;
}

module.exports = { PROVIDERS, openSession, startLocalModel };
