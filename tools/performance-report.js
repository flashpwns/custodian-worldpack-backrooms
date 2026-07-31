"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const history = require("./world-history");
const convergence = require("./canon-convergence");
const threads = require("./story-threads");
const inspection = require("./dev-inspection");
const bootstrap = require("./run-bootstrap");
const { executePlayerTurn } = require("./player-turn");
const { createMockProvider } = require("./ai-mock-provider");
const { buildSafeScene } = require("./scene-presentation");
const { DesktopService } = require("../desktop/service");

const ROUNDS = 5;
const timed = async (name, fn) => {
  const values = [];
  let result;
  for (let round = 0; round < ROUNDS; round += 1) {
    global.gc?.();
    const start = performance.now();
    result = await fn();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { name, median_ms: Number(values[Math.floor(values.length / 2)].toFixed(2)), min_ms: Number(values[0].toFixed(2)), max_ms: Number(values.at(-1).toFixed(2)), result_bytes: Buffer.byteLength(JSON.stringify(result ?? null)) };
};

function longWorld(turns = 5000) {
  const world = history.createWorld({ seed: "yb31-performance-long" });
  const run = history.beginRun(world, { profile: "lost", scenario: "long-history", seed: "long" });
  for (let turn = 0; turn < turns; turn += 1) history.event(world, run, "report.filed", { subject: `subject-${turn % 100}`, claim: `claim-${turn % 7}` });
  return world;
}

async function report() {
  const shared = convergence.fixture("yb31-performance");
  const long = longWorld();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yb31-performance-"));
  const saveFile = path.join(temp, "world.json");
  const run = bootstrap.startRun({ profile: "field-researcher", scenario: "procedural-survey", seed: "yb31-performance-run" }).run;
  const freeformRun = bootstrap.startRun({ profile: "field-researcher", scenario: "procedural-survey", seed: "yb31-performance-freeform" }).run;
  const desktop = new DesktopService({ appDataPath: path.join(temp, "desktop"), developerMode: true });
  const created = desktop.createWorld({ name: "Performance World", seed: "yb31-performance-desktop" });
  const desktopWorld = history.loadWorld(desktop.worldFile(created.world.id));
  const started = desktop.startSession({ world_id: created.world.id, mode: "field-researcher", seed: "yb31-performance-desktop-run" });
  const entry = desktop.session(created.world.id, "field-researcher");
  history.saveWorld(saveFile, shared.world);
  const measurements = [];
  measurements.push(await timed("world creation", () => history.createWorld({ seed: "yb31-performance-create" })));
  measurements.push(await timed("150-turn shared-world fixture", () => convergence.fixture("yb31-performance-cold")));
  measurements.push(await timed("turn resolution", () => bootstrap.act(run, "LOOK")));
  measurements.push(await timed("freeform intent", () => executePlayerTurn({ run: freeformRun, provider: createMockProvider(), player_text: "look around", request_id: "yb31-performance-freeform" })));
  measurements.push(await timed("observer/scene projection", () => ({ snapshot: inspection.snapshot(shared.world), scene: buildSafeScene({ run, action: "LOOK" }) })));
  measurements.push(await timed("story threads (cold)", () => threads.derive(history.loadWorld(saveFile))));
  measurements.push(await timed("save", () => history.saveWorld(saveFile, shared.world)));
  measurements.push(await timed("load", () => history.loadWorld(saveFile)));
  measurements.push(await timed("long history (cold)", () => threads.derive(longWorld())));
  measurements.push(await timed("desktop rendering", () => desktop.projectionFor(desktopWorld, "field-researcher", entry)));
  measurements.push(await timed("developer tooling", () => inspection.snapshot(shared.world)));
  const memoryBefore = process.memoryUsage().heapUsed;
  const retained = Array.from({ length: 8 }, (_, index) => convergence.fixture(`yb31-memory-${index}`).world);
  const memoryAfter = process.memoryUsage().heapUsed;
  return { version: "yellow-beast-performance@v1", fixture: { seed: "yb31-performance", turns: shared.turns, long_history_events: long.events.length }, methodology: { rounds: ROUNDS, statistic: "median of wall-clock samples", gc: Boolean(global.gc), timing_assertions: false }, measurements, memory: { retained_worlds: retained.length, heap_delta_bytes: memoryAfter - memoryBefore }, semantic_safety: { canonical_events_shared_fixture: shared.world.events.length, cache_derived_only: true, canonical_state_authoritative: true, cache_scope: "WeakMap per live world", cache_invalidation: "event_sequence + event count + last event id", observer_modes: ["field-researcher", "async-command", "local-anomaly", "lost"], provider: "offline mock", fallback_primary_path: false } };
}

if (require.main === module) report().then((value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`));
module.exports = { report, longWorld };
