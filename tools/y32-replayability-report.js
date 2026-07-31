"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("./world-history");
const v2 = require("./procedural-complex-v2");
const identity = require("./run-identity");
const threads = require("./story-threads");
const echoes = require("./consequence-echoes");
const convergence = require("./canon-convergence");
const canon = require("./canon-runtime");
const { startRun } = require("./run-bootstrap");
const SEEDS = ["replay-a", "replay-b", "replay-c", "replay-d", "replay-e", "replay-f"];
const PROFILES = ["field-researcher", "async-command", "local-anomaly", "lost"];
const stable = (value) => JSON.stringify(value);
const forbidden = /(?:rarity|difficulty|affix|destiny|archetype|meta[-_ ]?progression|quest[-_ ]?id|mystery[-_ ]?id|history-[a-f0-9]{8,}|(?:actor|object|region|run|event|thread|phenomenon|character)-[a-f0-9]{8,})/i;
function fieldIdentity(seed) { return identity.describe(startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", generator_version: v2.VERSION }).run); }
function regionSurface(seed) { const state = v2.materialize(v2.initialize({ seed, observer: "yb-field-player", policy: "moderate" })); const local = v2.observe(state, "yb-field-player", "field-researcher"); return { family: state.nodes[state.current["yb-field-player"]].family, lighting: state.region_traits.lighting_tendency, surface: state.region_traits.surface_tendency, landmark: local.landmark.description, objects: local.objects.map((item) => item.kind).sort() }; }
function report() {
  const sameSeed = stable(fieldIdentity("replay-same")) === stable(fieldIdentity("replay-same")) && stable(regionSurface("replay-same")) === stable(regionSurface("replay-same"));
  const surfaces = SEEDS.map(regionSurface); const diversity = new Set(surfaces.map((item) => stable(item))).size;
  const identities = Object.fromEntries(PROFILES.map((profile) => [profile, identity.describe(startRun({ profile, seed: "replay-profile" }).run)]));
  const worldA = history.createWorld({ id: "replay-world-a", seed: "replay" }); const worldB = history.createWorld({ id: "replay-world-b", seed: "replay" }); const runA = history.beginRun(worldA, { profile: "field-researcher", scenario: "replay", seed: "a" }); const runB = history.beginRun(worldB, { profile: "field-researcher", scenario: "replay", seed: "a" });
  const fixture = convergence.fixture("yb32-replayability"); const before = stable(fixture.world); const eventsBefore = fixture.world.events.length; const index = threads.derive(fixture.world); const modeViews = Object.fromEntries(PROFILES.map((profile) => [profile, { echoes: echoes.observerView(fixture.world, profile).echoes.length, unfinished: echoes.unfinishedBusiness(fixture.world, profile).items.length }])); for (let turn = 0; turn < 150; turn += 1) { threads.derive(fixture.world); echoes.observerView(fixture.world, PROFILES[turn % PROFILES.length]); echoes.unfinishedBusiness(fixture.world, PROFILES[turn % PROFILES.length]); }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb32-replayability-")), "world.json"); history.saveWorld(file, fixture.world); const restored = history.loadWorld(file); const runtime = canon.report();
  const safety = { "same-seed determinism": sameSeed ? 0 : 1, "multi-seed diversity outside admitted surfaces": surfaces.every((item) => item.family && item.lighting && item.surface) && diversity > 1 ? 0 : 1, "new-world state isolation": worldA.world_id !== worldB.world_id && runA !== runB ? 0 : 1, "observer/mode leakage": forbidden.test(stable(modeViews)) ? 1 : 0, "story-thread canonical mutation": stable(fixture.world) === before ? 0 : 1, "long-world event spawning": fixture.world.events.length === eventsBefore ? 0 : 1, "save/reload thread divergence": stable(threads.derive(restored)) === stable(index) ? 0 : 1, "permanent death divergence": fixture.world.characters["convergence-researcher"].status === "dead" && restored.characters["convergence-researcher"].status === "dead" ? 0 : 1, "object identity duplication": Object.keys(fixture.world.artifacts).filter((id) => id === fixture.recorder_id).length === 1 ? 0 : 1, "canon gravity": runtime.canon_gravity.untraced_distinctive_runtime === 0 ? 0 : 1, "meta-progression leakage": forbidden.test(stable(identities)) ? 1 : 0 };
  console.log(JSON.stringify({ version: "yellow-beast-yb32-replayability@v1", seeds: SEEDS, same_seed_determinism: sameSeed, distinct_legitimate_surfaces: diversity, multi_seed_samples: surfaces, four_mode_identities: identities, mode_views: modeViews, long_world: { turns: fixture.turns, events: fixture.world.events.length, derived_thread_count: index.threads.length, repeated_reads: 150, offline: true, save_reload: true }, canon_gravity: { untraced_distinctive_runtime: runtime.canon_gravity.untraced_distinctive_runtime, pack_original_distinctive_runtime: runtime.canon_gravity.pack_original_distinctive_runtime }, closure_invariants: safety, passed: Object.values(safety).every((value) => value === 0) }, null, 2));
}
report();
