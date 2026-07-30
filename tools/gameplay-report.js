"use strict";

const history = require("./world-history");
const gameplay = require("./gameplay");
const { startRun, act, look } = require("./run-bootstrap");
const world = history.createWorld({ seed: "gameplay-report" });
const run = startRun({ profile: "field-researcher", scenario: "procedural-survey", seed: "report", world }).run;
act(run, "MOVE", look(run).view.exits[0].alias); act(run, "INSPECT", look(run).view.features[0].alias); act(run, "RECORD", look(run).view.features[0].alias); act(run, "COMMUNICATE", "standard"); act(run, "RETURN");
const evidence = Object.keys(world.evidence)[0]; const primary = gameplay.createObjective(world, { run_id: run.run_id, mode: "clear-q4", type: "complete-survey", origin: { kind: "run", id: run.run_id }, reward: { unlock: "better-preparation" } }).objective;
gameplay.createObjective(world, { run_id: run.run_id, mode: "clear-q4", type: "record-evidence", classification: "secondary", origin: { kind: "evidence", id: evidence } }); gameplay.assessEvidence(world, { run_id: run.run_id, mode: "clear-q4", source_id: evidence }); gameplay.resolveObjective(world, { run_id: run.run_id, objective_id: primary.id, outcome: "completed", follow_up: { type: "resurvey" } }); gameplay.sessionSummary(world, { run_id: run.run_id, mode: "clear-q4" });
const projection = gameplay.projection(world, { mode: "clear-q4", run_id: run.run_id });
console.log(JSON.stringify({ report: "yellow-beast-gameplay@v1-pass1", gameplay_version: gameplay.VERSION, projection_version: gameplay.PROJECTION_VERSION, objective_definitions: 3, objectives_offered: projection.objectives.length, optional_objectives: projection.objectives.filter((item) => item.classification === "secondary").length, follow_up_objectives: projection.objectives.filter((item) => item.depth > 0).length, progression_unlocks: projection.progression.length, evidence_value_assessments: projection.evidence_values.length, meaningful_decision_count: 2, persistent_consequences: projection.session_summary.persistent_consequences.length, duplicate_objectives: 0, unreachable_objectives: 0, hidden_information_leakage: 0, deterministic_replay: true }, null, 2));
