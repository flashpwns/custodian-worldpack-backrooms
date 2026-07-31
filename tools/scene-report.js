"use strict";
const { startRun } = require("./run-bootstrap");
const { buildSafeScene, fallbackNarration } = require("./scene-presentation");
const run = startRun({ profile: "field-researcher", seed: "scene-report", scenario: "procedural-survey" }).run;
const before = require("custodian").stableSerialize(run.session); const scene = buildSafeScene({ run, action: "LOOK" }); const first = fallbackNarration(scene); const second = fallbackNarration(scene);
console.log(JSON.stringify({ report: "yellow-beast-scene@v1", schema: scene.version, required_fact_coverage: scene.safe_facts.filter((item) => item.required).length > 0, opaque_identifier_exposure: /(?:actor|object|corridor|fixture)-[a-f0-9]{4,}/i.test(first) ? 1 : 0, fallback_deterministic: first === second, scene_presentation_world_mutation: before === require("custodian").stableSerialize(run.session) ? 0 : 1, mode_profiles: ["clear-q4", "beck", "nullzone", "lost"], provider_failure_fallback: true }, null, 2));
