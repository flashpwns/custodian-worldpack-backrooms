"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("./world-history");
const convergence = require("./canon-convergence");
const threads = require("./story-threads");
const echoes = require("./consequence-echoes");
const inspection = require("./dev-inspection");
const qol = require("../desktop/renderer/qol");
const surfaces = require("../desktop/renderer/surfaces");
const { DesktopService, MODES } = require("../desktop/service");
const { RequestGate } = require("../desktop/renderer/interaction");

const TURN_COUNT = 2500;
const DERIVED_READS = 160;
const MODES_IN_ORDER = MODES.map(({ id }) => id);
const PHRASES = { "field-researcher": "look around", "async-command": "review reports", "local-anomaly": "explore", lost: "strand" };
const stable = (value) => JSON.stringify(value);
const forbiddenPlayerData = /(?:world|region|run|history|actor|object|phenomenon|thread)-[a-f0-9]{8,}/i;

function growCanonicalWorld(seed) {
  const fixture = convergence.fixture(seed);
  const run = fixture.beck;
  for (let turn = 0; turn < TURN_COUNT; turn += 1) {
    history.event(fixture.world, run, "report.filed", { subject: `long-subject-${turn % 41}`, claim: `long-claim-${turn % 13}`, relation: turn % 17 === 0 ? "contradicts" : undefined });
    if (turn % 100 === 0) history.mutateRegion(fixture.world, { run_id: fixture.q4, region_id: fixture.region_id, space_id: fixture.space_id, target_type: "node-property", target: "torture_marker", value: `state-${turn}` });
  }
  return fixture;
}

function deriveChecks(fixture) {
  const before = stable(fixture.world);
  const first = threads.derive(fixture.world);
  const firstEchoes = echoes.observerView(fixture.world, "field-researcher", { run_id: fixture.q4 });
  const firstRecap = threads.observerView(fixture.world, first, "field-researcher");
  let repeatedSameIdentity = true;
  for (let read = 0; read < DERIVED_READS; read += 1) {
    repeatedSameIdentity &&= threads.derive(fixture.world) === first;
    echoes.observerView(fixture.world, "field-researcher", { run_id: fixture.q4 });
    echoes.unfinishedBusiness(fixture.world, "field-researcher", { run_id: fixture.q4 });
    inspection.snapshot(fixture.world);
  }
  const after = stable(fixture.world);
  const eventCountBeforeAppend = fixture.world.events.length;
  history.event(fixture.world, fixture.beck, "report.filed", { subject: "cache-invalidation", claim: "new report" });
  const invalidated = threads.derive(fixture.world) !== first;
  const saved = stable(fixture.world);
  const saveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yb33-torture-history-"));
  const saveFile = path.join(saveRoot, "world.json");
  history.saveWorld(saveFile, fixture.world);
  let reloaded = history.loadWorld(saveFile);
  let reloadEquivalent = stable(reloaded) === saved;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const index = threads.derive(reloaded);
    echoes.observerView(reloaded, "async-command", { run_id: fixture.beck });
    echoes.observerView(reloaded, "local-anomaly", { run_id: fixture.nullzone });
    echoes.observerView(reloaded, "lost", { run_id: fixture.lost });
    history.saveWorld(saveFile, reloaded);
    reloaded = history.loadWorld(saveFile);
    reloadEquivalent &&= stable(reloaded) === saved;
    reloadEquivalent &&= threads.derive(reloaded).history_digest === index.history_digest;
  }
  fs.rmSync(saveRoot, { recursive: true, force: true });
  const modes = Object.fromEntries(["field-researcher", "async-command", "local-anomaly", "lost"].map((profile) => [profile, threads.observerView(fixture.world, first, profile)]));
  return {
    events: fixture.world.events.length,
    derived_threads: first.threads.length,
    repeated_reads: DERIVED_READS,
    repeated_same_identity: repeatedSameIdentity,
    derived_reads_event_free: after === before && fixture.world.events.length === eventCountBeforeAppend + 1,
    cache_invalidated_after_append: invalidated,
    save_reload_equivalent: reloadEquivalent,
    observer_views: Object.fromEntries(Object.entries(modes).map(([profile, view]) => [profile, { threads: view.threads.length, implicit_continuity: view.implicit_continuity }])),
    echo_bound: firstEchoes.echoes.length <= echoes.MAX_ECHOES,
    dead_character: fixture.world.characters["convergence-researcher"]?.status === "dead",
    recovered_object_count: Object.values(fixture.world.artifacts).filter((artifact) => artifact.state === "recovered").length,
    unique_object_identity: new Set(Object.keys(fixture.world.artifacts)).size === Object.keys(fixture.world.artifacts).length,
    phenomenon_count: Object.keys(fixture.world.phenomena).length,
    mutation_count: fixture.world.events.filter((event) => event.type === "region.mutated").length,
    canonical_mutation_from_reads: after === before
  };
}

async function desktopTorture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb33-torture-desktop-"));
  let service = new DesktopService({ appDataPath: root, developerMode: true });
  const created = service.createWorld({ name: "Long Beta World", seed: "yb33-desktop-long" });
  const worldId = created.world.id;
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yb33-torture-isolated-"));
  const isolatedService = new DesktopService({ appDataPath: isolatedRoot });
  const isolatedWorld = isolatedService.createWorld({ name: "Unchanged Twin", seed: "yb33-desktop-long" }).world;
  const isolatedBefore = stable(isolatedService.loadWorld({ world_id: isolatedWorld.id }).summary);
  const turns = [];
  let noPlayerLeak = true;
  for (let turn = 0; turn < 48; turn += 1) {
    const mode = MODES_IN_ORDER[turn % MODES_IN_ORDER.length];
    const entered = service.resumeSession({ world_id: worldId, mode });
    const started = entered.ok ? entered : service.startSession({ world_id: worldId, mode, seed: `yb33-mode-${mode}` });
    if (!started.ok) { turns.push({ mode, entered: false, action: false }); continue; }
    const action = await service.submitNatural({ world_id: worldId, mode, text: PHRASES[mode] });
    const projection = action.ok ? action.projection : service.getGameplayProjection({ world_id: worldId, mode }).projection;
    const html = projection ? surfaces.render(projection) : "";
    const recap = projection ? qol.recap(projection) : { sections: [] };
    noPlayerLeak &&= !forbiddenPlayerData.test(html) && !forbiddenPlayerData.test(JSON.stringify(recap));
    turns.push({ mode, entered: true, action: action.ok, saved_scene: Boolean(action.result?.scene?.narration), recap_sections: recap.sections.length });
    if (turn % 6 === 0) service.updateSettings({ settings: { theme: turn % 12 === 0 ? "high-contrast" : "system", text_scale: turn % 18 === 0 ? "extra-large" : "default", reduced_motion: turn % 2 === 0, guided_introductions: turn % 4 !== 0 } });
    if (turn % 5 === 0) { const snapshot = service.getDeveloperSnapshot({ world_id: worldId, mode }); if (!snapshot.ok) throw new Error("developer inspection failed during torture"); }
    if (turn % 8 === 7) { if (!service.saveWorld({ world_id: worldId }).ok) throw new Error("desktop save failed during torture"); service = new DesktopService({ appDataPath: root, developerMode: true }); }
  }
  const failure = service.updateSettings({ settings: { provider: "openai" } });
  const offline = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "look around" });
  const finalWorld = service.loadWorld({ world_id: worldId });
  const newWorldIsolated = isolatedBefore === stable(isolatedService.loadWorld({ world_id: isolatedWorld.id }).summary);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
  return { turns: turns.length, successful_actions: turns.filter((turn) => turn.action).length, mode_counts: Object.fromEntries(MODES_IN_ORDER.map((mode) => [mode, turns.filter((turn) => turn.mode === mode).length])), no_player_leak: noPlayerLeak, provider_failure_safe: failure.ok === false, offline_continues: offline.ok, final_world_load: finalWorld.ok, new_world_isolated: newWorldIsolated };
}

async function report() {
  const first = growCanonicalWorld("yb33-torture");
  const second = growCanonicalWorld("yb33-torture");
  const canonical = deriveChecks(first);
  deriveChecks(second);
  const deterministic = stable(first.world) === stable(second.world);
  const desktop = await desktopTorture();
  const gate = new RequestGate();
  let staleRejected = true;
  for (let turn = 0; turn < 160; turn += 1) { const context = { worldId: `world-${turn % 4}`, mode: MODES_IN_ORDER[turn % 4] }; const token = gate.begin(context); gate.invalidate(); staleRejected &&= gate.settle(token, context) === false; }
  return {
    version: "yellow-beast-yb33-long-world-torture@v1",
    workload: { canonical_turns: 150 + TURN_COUNT, canonical_events: canonical.events, derived_reads: DERIVED_READS, save_reload_cycles: 8, desktop_turns: desktop.turns, restart_cycles: 6, stale_response_checks: 160 },
    deterministic,
    canonical,
    desktop,
    stale_response_rejection: staleRejected,
    performance_reference: { existing_long_history_events: 5000, existing_cold_thread_median_ms: 10.92, timing_assertions: false },
    blockers: [],
    passed: deterministic && canonical.repeated_same_identity && canonical.cache_invalidated_after_append && canonical.save_reload_equivalent && canonical.derived_reads_event_free && canonical.echo_bound && canonical.dead_character && canonical.recovered_object_count === 1 && canonical.unique_object_identity && canonical.phenomenon_count > 0 && canonical.mutation_count > 0 && canonical.canonical_mutation_from_reads && desktop.successful_actions > 0 && desktop.no_player_leak && desktop.provider_failure_safe && desktop.offline_continues && desktop.final_world_load && desktop.new_world_isolated && staleRejected
  };
}

if (require.main === module) report().then((value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`));
module.exports = { report, growCanonicalWorld };
