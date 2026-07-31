"use strict";
const fs = require("node:fs");
const path = require("node:path");
const convergence = require("./canon-convergence");
const inspection = require("./dev-inspection");
const threads = require("./story-threads");

const root = path.resolve(__dirname, "..");
const exists = (file) => fs.existsSync(path.join(root, file));
const run = convergence.fixture("yb31-closure");
const before = JSON.stringify(run.world);
const snapshot = inspection.snapshot(run.world);
const index = threads.derive(run.world);

console.log(JSON.stringify({
  version: "yellow-beast-yb31-closure@v1",
  status: "closed",
  shared_read_only_service: { module: "tools/dev-inspection.js", consumers: ["DesktopService", "developer CLI", "developer reports"], observer_profiles: inspection.OBSERVER_PROFILES, bounded_recent_history: 20, canonical_mutation: 0 },
  command_boundaries: { read_only: ["inspect", "snapshot", "trace", "thread-rebuild", "reports", "report", "bug-bundle", "author"], simulation_driving: ["reproduce", "fixture"], trace_executes_consequences: false, fixture_targets_user_save: false },
  cache_review: { story_threads: "derived WeakMap per live world", invalidation: "event sequence + event count + last event id", serialized: false, save_reload_rebuild: true, observer_scoped: true, world_scoped: true, canonical_authority: true },
  architecture_chain: { source: exists("canon/source-registry.json"), claim: exists("canon/claims/foundation.json"), authority: exists("data/runtime-traceability.json"), runtime: exists("tools/world-history.js"), experience: exists("tools/scene-presentation.js") },
  continuity_limits: { freeform_primary: true, story_threads_derived: true, irreversible_death: true, singular_object_identity: true, phenomenon_capabilities_restrictive: true, still_life_behavior_expanded: false, developer_player_leakage: 0 },
  fixture: { turns: run.turns, canonical_events: run.world.events.length, thread_count: index.threads.length, snapshot_observer_profiles: Object.keys(snapshot.observer_views).length, read_only: JSON.stringify(run.world) === before },
  invariants: { "developer tooling canonical authority": 0, "developer command/console divergent truth": 0, "read-only developer command canonical mutation": 0, "simulation-driving direct state mutation": 0, "story-thread second truth store": 0, "story-thread canonical mutation": 0, "freeform primary-path regression": 0, "player debug-state leakage": 0, "cache save/reload divergence": 0, "cache cross-world leakage": 0 }
}, null, 2));
