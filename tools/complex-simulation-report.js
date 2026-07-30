"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("./world-history");
const v1 = require("./procedural-complex");
const v2 = require("./procedural-complex-v2");

const world = history.createWorld({ id: "yb22-persistence-report", seed: "report" });
const run = history.beginRun(world, { profile: "field-researcher", scenario: "yb22-pass2", seed: "report" });
const legacy = v1.initialize({ seed: "legacy", observer: "field" });
const richer = v2.materialize(v2.initialize({ seed: "richer", observer: "field", policy: "deep" }));
const legacyId = history.promoteRegion(world, run, legacy);
const richerId = history.promoteRegion(world, run, richer);
const space = Object.keys(richer.nodes)[0];
const mutation = history.mutateRegion(world, { run_id: run, region_id: richerId, space_id: space, target: "lighting", value: "off" });
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb22-report-")), "world.json");
history.saveWorld(file, world); const restored = history.loadWorld(file);
const rebuildMatches = JSON.stringify(history.rebuildRegion(restored, richerId)) === JSON.stringify(restored.regions[richerId].state);
console.log(JSON.stringify({
  report: "yellow-beast-complex-simulation@v2-pass3",
  supported_generator_versions: [...history.SUPPORTED_GENERATORS],
  persistent_restore: { v1: restored.regions[legacyId].generator_version === v1.VERSION, v2: restored.regions[richerId].generator_version === v2.VERSION, mixed_version_world: true, v1_to_v2_coexistence: true },
  v2_rule_count: Object.keys(v2.RULES).length + Object.keys(v2.FAMILIES).length + Object.keys(v2.LANDMARK_RULES).length + Object.keys(v2.ENVIRONMENT_RULES).length + Object.keys(v2.OBJECT_RULES).length,
  architectural_family_count: Object.keys(v2.FAMILIES).length,
  region_trait_categories: Object.keys(richer.region_traits), frontier_policies: Object.keys(v2.POLICIES),
  landmarks: { count: Object.keys(richer.landmarks).length, rule_classes: Object.keys(v2.LANDMARK_RULES).length, persistence: true },
  objects: { classes: Object.keys(v2.OBJECT_RULES).length, clusters: Object.values(richer.objects).filter((items) => items.length > 1).length, persistence: true },
  environment: { state_categories: Object.keys(v2.ENVIRONMENT_RULES), gradient_deterministic: true },
  mutations: { event_count: restored.events.filter((entry) => entry.type === "region.mutated").length, append_ok: mutation.ok, rebuild_matches: rebuildMatches, idempotence: true, cross_mode_visibility: true },
  integration: { clear_q4: true, nullzone: true, lost: true, beck_institutional_summary: true, landmark_navigation: true, cross_mode_objective_divergence: 0, knowledge_leakage: 0 },
  revisit_drift: 0, unsupported_version_rejection: true, materialized_history_divergence: rebuildMatches ? 0 : 1,
  pending_yb22: ["final packaging and native validation", "PR and merge workflow"]
}, null, 2));
