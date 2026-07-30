"use strict";

const crypto = require("node:crypto");
const history = require("./world-history");
const clone = (value) => structuredClone(value);
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const VERSION = "yellow-beast-gameplay@v1";
const PROJECTION_VERSION = "yellow-beast-gameplay-projection@v1";
const MODES = new Set(["clear-q4", "nullzone", "lost", "beck"]);
const MAX_FOLLOW_UP_DEPTH = 2;

function modeForProfile(profile) { return ({ "field-researcher": "clear-q4", "local-anomaly": "nullzone", lost: "lost", "async-command": "beck" })[profile] ?? null; }
function event(world, run_id, type, payload) { return history.event(world, run_id, `gameplay.${type}`, payload, "pack-original-gameplay-simulation"); }
function state(world) {
  history.assertWorld(world);
  if (!world.gameplay) world.gameplay = { version: VERSION, objectives: {}, progression: Object.fromEntries([...MODES].map((mode) => [mode, { unlocks: [] }])), valuations: {}, summaries: {} };
  const s = world.gameplay; s.version ??= VERSION; s.objectives ??= {}; s.progression ??= {}; s.valuations ??= {}; s.summaries ??= {};
  for (const mode of MODES) { s.progression[mode] ??= { unlocks: [] }; s.progression[mode].unlocks ??= []; }
  return s;
}
function sourceKnown(world, mode, origin, run_id) {
  if (!origin?.kind || !origin.id) return false;
  if (origin.kind === "objective") return Boolean(state(world).objectives[origin.id]);
  if (origin.kind === "run") return origin.id === run_id && Boolean(world.runs[origin.id]);
  if (origin.kind === "evidence") {
    if (!world.evidence[origin.id]) return false;
    if (mode === "beck") return Boolean(world.knowledge.institutional.records[`institutional-evidence-${origin.id}`]);
    return world.evidence[origin.id].origin_run === run_id;
  }
  if (origin.kind === "artifact") {
    const item = world.artifacts[origin.id];
    if (!item) return false;
    if (mode === "nullzone") return Boolean(world.civilian?.base?.archive.includes(origin.id));
    return item.origin_run === run_id;
  }
  if (origin.kind === "institutional-record") return mode === "beck" && Boolean(world.knowledge.institutional.records[origin.id]);
  return false;
}
function createObjective(world, { run_id, mode, type, classification = "primary", origin, target = "known-opportunity", known_information = {}, reward = null, failure_condition = null, parent_id = null, depth = 0, authority = "scenario-optional", provenance = "pack-original-gameplay-objective" }) {
  const s = state(world); if (!MODES.has(mode) || !type || !["primary", "secondary", "deviation"].includes(classification) || !sourceKnown(world, mode, origin, run_id)) return { ok: false, code: "OBJECTIVE_SOURCE_UNKNOWN" };
  if (depth > MAX_FOLLOW_UP_DEPTH) return { ok: false, code: "FOLLOW_UP_DEPTH_EXCEEDED" };
  const id = `objective-${hash([world.world_id, mode, type, classification, origin, parent_id, depth]).slice(0, 16)}`;
  if (s.objectives[id]) return { ok: true, idempotent: true, objective: clone(s.objectives[id]) };
  const duplicate = Object.values(s.objectives).some((item) => item.mode === mode && item.type === type && JSON.stringify(item.origin) === JSON.stringify(origin) && item.status === "offered");
  if (duplicate) return { ok: false, code: "OBJECTIVE_DUPLICATE" };
  const objective = { id, mode, type, classification, origin: clone(origin), target, known_information: clone(known_information), status: "offered", completion: null, failure_condition, reward: clone(reward), parent_id, depth, authority, provenance };
  s.objectives[id] = objective; event(world, run_id, "objective_offered", { objective_id: id, mode, type, classification, origin: clone(origin), depth }); return { ok: true, objective: clone(objective) };
}
function unlock(world, run_id, mode, source_objective_id, type, summary) {
  const s = state(world); const id = `gameplay-unlock-${hash([mode, source_objective_id, type]).slice(0, 16)}`;
  if (!s.progression[mode].unlocks.some((item) => item.id === id)) { s.progression[mode].unlocks.push({ id, type, summary, source_objective_id }); event(world, run_id, "progression_unlocked", { mode, unlock_id: id, source_objective_id, type }); }
  return id;
}
function resolveObjective(world, { run_id, objective_id, outcome, follow_up = null }) {
  const s = state(world); const objective = s.objectives[objective_id]; if (!objective || !["completed", "partial", "failed", "aborted", "stranded"].includes(outcome)) return { ok: false, code: "OBJECTIVE_UNAVAILABLE" };
  if (objective.status !== "offered") return { ok: true, idempotent: true, objective: clone(objective) };
  objective.status = outcome; objective.completion = { run_id, outcome }; event(world, run_id, "objective_resolved", { objective_id, mode: objective.mode, outcome }); let follow = null;
  if (outcome === "completed" && objective.reward?.unlock) unlock(world, run_id, objective.mode, objective.id, objective.reward.unlock, objective.reward.summary ?? "A known operational option is now available.");
  if (follow_up && objective.depth < MAX_FOLLOW_UP_DEPTH) follow = createObjective(world, { run_id, mode: objective.mode, type: follow_up.type, classification: "secondary", origin: { kind: "objective", id: objective.id }, target: follow_up.target ?? "known follow-up", known_information: follow_up.known_information ?? {}, reward: follow_up.reward ?? null, parent_id: objective.id, depth: objective.depth + 1, authority: objective.authority, provenance: "pack-original-gameplay-follow-up" });
  return { ok: true, objective: clone(objective), follow_up: follow?.objective ?? null };
}
function valuationAccess(world, mode, source_id, run_id, artifact = false) { return sourceKnown(world, mode, { kind: artifact ? "artifact" : "evidence", id: source_id }, run_id); }
function assessValue(world, { run_id, mode, source_id, artifact = false }) {
  const s = state(world); if (!MODES.has(mode) || !valuationAccess(world, mode, source_id, run_id, artifact)) return { ok: false, code: "VALUE_SOURCE_UNKNOWN" };
  const item = artifact ? world.artifacts[source_id] : world.evidence[source_id]; const kind = item.type ?? "unknown"; const key = `${mode}:${artifact ? "artifact" : "evidence"}:${source_id}`;
  if (s.valuations[key]) return { ok: true, idempotent: true, value: clone(s.valuations[key]) };
  const prior = Object.values(s.valuations).some((value) => value.mode === mode && value.kind === kind && value.artifact === artifact && value.novelty === "new");
  const value = { id: `value-${hash([world.world_id, key]).slice(0, 16)}`, mode, source_kind: artifact ? "artifact" : "evidence", artifact, kind, novelty: prior ? "duplicate" : "new", relevance: prior ? "routine" : artifact ? "significant" : "useful", source_id };
  s.valuations[key] = value; event(world, run_id, "value_assessed", { mode, source_kind: value.source_kind, source_id, novelty: value.novelty, relevance: value.relevance }); return { ok: true, value: clone(value) };
}
function assessEvidence(world, input) { return assessValue(world, { ...input, artifact: false }); }
function assessArtifact(world, input) { return assessValue(world, { ...input, artifact: true }); }
function sessionSummary(world, { run_id, mode }) {
  const s = state(world); if (!MODES.has(mode) || !world.runs[run_id]) return { ok: false, code: "RUN_UNKNOWN" };
  const objectives = Object.values(s.objectives).filter((item) => item.completion?.run_id === run_id || item.origin.id === run_id).map((item) => ({ ref: item.id, type: item.type, classification: item.classification, outcome: item.status }));
  const values = Object.values(s.valuations).filter((item) => item.mode === mode).map(({ source_kind, kind, novelty, relevance }) => ({ source_kind, kind, novelty, relevance }));
  const summary = { version: PROJECTION_VERSION, run_id, mode, objectives, recovered_values: values, progression: clone(s.progression[mode].unlocks), follow_ups: Object.values(s.objectives).filter((item) => item.parent_id && item.mode === mode && item.status === "offered").map((item) => ({ ref: item.id, type: item.type })), persistent_consequences: world.events.filter((item) => item.run_id === run_id && /(?:remnant|artifact|region\.mutated|process_failed)/.test(item.type)).map((item) => item.type) };
  s.summaries[run_id] = clone(summary); event(world, run_id, "session_summarized", { mode, objective_count: objectives.length, follow_up_count: summary.follow_ups.length }); return { ok: true, summary };
}
function projection(world, { mode, run_id = null } = {}) {
  const s = state(world); if (!MODES.has(mode)) return { version: PROJECTION_VERSION, objectives: [], progression: [], timeline: [] };
  const objectives = Object.values(s.objectives).filter((item) => item.mode === mode).map(({ id, type, classification, target, known_information, status, reward, depth }) => ({ ref: id, type, classification, target, known_information: clone(known_information), status, reward: reward ? clone(reward) : null, depth }));
  const timeline = world.events.filter((item) => item.type.startsWith("gameplay.") && item.payload.mode === mode && (!run_id || item.run_id === run_id)).map((item) => ({ type: item.type.slice("gameplay.".length), sequence: item.sequence }));
  return { version: PROJECTION_VERSION, mode, objectives, progression: clone(s.progression[mode].unlocks), evidence_values: Object.values(s.valuations).filter((item) => item.mode === mode).map(({ source_kind, kind, novelty, relevance }) => ({ source_kind, kind, novelty, relevance })), timeline, session_summary: run_id ? clone(s.summaries[run_id] ?? null) : null };
}
module.exports = { VERSION, PROJECTION_VERSION, MAX_FOLLOW_UP_DEPTH, modeForProfile, state, createObjective, resolveObjective, assessEvidence, assessArtifact, sessionSummary, projection };
