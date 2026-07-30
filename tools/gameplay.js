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
  if (!world.gameplay) world.gameplay = { version: VERSION, objectives: {}, progression: Object.fromEntries([...MODES].map((mode) => [mode, { unlocks: [] }])), valuations: {}, summaries: {}, risks: {}, decisions: {}, revisits: {}, callbacks: {} };
  const s = world.gameplay; s.version ??= VERSION; s.objectives ??= {}; s.progression ??= {}; s.valuations ??= {}; s.summaries ??= {}; s.risks ??= {}; s.decisions ??= {}; s.revisits ??= {}; s.callbacks ??= {};
  for (const mode of MODES) { s.progression[mode] ??= { unlocks: [] }; s.progression[mode].unlocks ??= []; }
  return s;
}
function riskLevel(factors) { return factors.length === 0 ? "low" : factors.length === 1 ? "elevated" : factors.length >= 3 ? "high" : "elevated"; }
function evaluateKnownRisk(world, { run_id, mode, route = {}, resources = [], team = {}, communications = {}, incidents = [] }) {
  const s = state(world); if (!MODES.has(mode) || !world.runs[run_id]) return { ok: false, code: "RISK_CONTEXT_UNKNOWN" };
  // Inputs are intentionally caller-scoped observations. This resolver never reads
  // objective hazards, entities, topology, or another observer's private records.
  const factors = [];
  if (route.known === false) factors.push("route beyond the current landmark is unmapped");
  if (route.retreat_available === false) factors.push("no known retreat route is available");
  for (const item of resources.filter((item) => item && item.known !== false)) if (Number.isFinite(item.remaining) && Number.isFinite(item.caution_at) && item.remaining <= item.caution_at) factors.push(`${item.label ?? item.kind ?? "equipment"} is limited`);
  if (["impaired", "recovering", "unavailable"].includes(team.known_status)) factors.push("known team condition may complicate withdrawal");
  if (["pending", "unavailable", "delayed"].includes(communications.known_status)) factors.push("communication is not presently reliable");
  for (const incident of incidents.filter((item) => item?.known !== false)) if (incident.summary) factors.push(incident.summary);
  const id = `risk-${hash([world.world_id, run_id, mode, route, resources, team, communications, incidents]).slice(0, 16)}`;
  const risk = { id, run_id, mode, level: riskLevel(factors), factors: [...new Set(factors)].sort(), resources: resources.filter((item) => item?.known !== false).map(({ label, kind, remaining, caution_at }) => ({ label: label ?? kind ?? "resource", remaining, caution_at })) };
  s.risks[id] = risk; event(world, run_id, "risk_assessed", { mode, risk_id: id, level: risk.level, factor_count: risk.factors.length }); return { ok: true, risk: clone(risk) };
}
function createDecision(world, { run_id, mode, objective_id = null, context, options }) {
  const s = state(world); const objective = objective_id ? s.objectives[objective_id] : null;
  if (!MODES.has(mode) || !world.runs[run_id] || !context || !Array.isArray(options) || options.length < 2 || (objective && objective.mode !== mode)) return { ok: false, code: "DECISION_UNAVAILABLE" };
  if (options.some((option) => !option?.action || !option?.rationale || !option?.known_upside || !option?.known_cost)) return { ok: false, code: "DECISION_CONTEXT_INCOMPLETE" };
  const keys = options.map((option) => option.consequence_key ?? option.action);
  if (new Set(keys).size !== keys.length) return { ok: false, code: "MEANINGLESS_DUPLICATE_CHOICE" };
  const id = `decision-${hash([world.world_id, run_id, mode, objective_id, context, options.map(({ action, consequence_key }) => [action, consequence_key ?? action])]).slice(0, 16)}`;
  if (s.decisions[id]) return { ok: true, idempotent: true, decision: clone(s.decisions[id]) };
  const decision = { id, run_id, mode, objective_id, context, status: "offered", options: options.map((option, index) => ({ ref: `choice-${index + 1}`, action: option.action, rationale: option.rationale, known_upside: option.known_upside, known_cost: option.known_cost, risk_factors: clone(option.risk_factors ?? []), consequence_key: option.consequence_key ?? option.action, resolution: clone(option.resolution ?? null) })) };
  s.decisions[id] = decision; event(world, run_id, "decision_offered", { mode, decision_id: id, objective_id, option_count: options.length }); return { ok: true, decision: clone(decision) };
}
function resolveDecision(world, { run_id, decision_id, choice_ref }) {
  const s = state(world); const decision = s.decisions[decision_id]; if (!decision || decision.run_id !== run_id || decision.status !== "offered") return { ok: false, code: "DECISION_UNAVAILABLE" };
  const choice = decision.options.find((item) => item.ref === choice_ref); if (!choice) return { ok: false, code: "CHOICE_UNAVAILABLE" };
  let objective = null;
  if (choice.resolution?.outcome && decision.objective_id) objective = resolveObjective(world, { run_id, objective_id: decision.objective_id, outcome: choice.resolution.outcome, follow_up: choice.resolution.follow_up ?? null }).objective;
  decision.status = "resolved"; decision.selected_ref = choice.ref; decision.resolved_at = world.event_sequence + 1;
  event(world, run_id, "decision_resolved", { mode: decision.mode, decision_id, choice_ref, consequence_key: choice.consequence_key });
  return { ok: true, decision: safeDecision(decision), objective };
}
function createRevisitOpportunity(world, { run_id, mode, origin, region_ref, reason, objective_id = null }) {
  const s = state(world); if (!MODES.has(mode) || !sourceKnown(world, mode, origin, run_id) || !region_ref || !reason) return { ok: false, code: "REVISIT_SOURCE_UNKNOWN" };
  const id = `revisit-${hash([world.world_id, mode, origin, region_ref, reason, objective_id]).slice(0, 16)}`;
  if (s.revisits[id]) return { ok: true, idempotent: true, revisit: clone(s.revisits[id]) };
  const revisit = { id, mode, origin: clone(origin), region_ref, reason, objective_id, status: "available" }; s.revisits[id] = revisit;
  event(world, run_id, "revisit_available", { mode, revisit_id: id, objective_id }); return { ok: true, revisit: clone(revisit) };
}
function safeDecision(item) { return { ref: item.id, context: item.context, status: item.status, objective_ref: item.objective_id, choices: item.options.map(({ ref, action, rationale, known_upside, known_cost, risk_factors }) => ({ ref, action, rationale, known_upside, known_cost, risk_factors: clone(risk_factors) })) }; }
function progressionUtility(mode, type) {
  const known = { "better-preparation": "preparation option", "follow-up-review": "institutional follow-up", "route-knowledge": "known-route planning", "archive-comparison": "archive comparison", "landmark-memory": "landmark context", "safer-preparation": "safer preparation" };
  return known[type] ?? `${mode} operational option`;
}
function sourceKnown(world, mode, origin, run_id) {
  if (!origin?.kind || !origin.id) return false;
  if (origin.kind === "objective") return state(world).objectives[origin.id]?.mode === mode;
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
    if (mode === "clear-q4") return item.custody.some((entry) => entry.run_id === run_id && entry.holder === "yb-field-player");
    return item.origin_run === run_id;
  }
  if (origin.kind === "institutional-record") return mode === "beck" && Boolean(world.knowledge.institutional.records[origin.id]);
  if (origin.kind === "report") return mode === "beck" && Boolean(world.management?.reports?.some((item) => item.id === origin.id && item.lifecycle === "reviewed"));
  return false;
}
function originExists(world, origin) {
  if (!origin?.kind || !origin.id) return false;
  if (origin.kind === "event") return world.events.some((item) => item.id === origin.id);
  if (origin.kind === "artifact") return Boolean(world.artifacts[origin.id]);
  if (origin.kind === "objective") return Boolean(state(world).objectives[origin.id]);
  if (origin.kind === "institutional-record") return Boolean(world.knowledge.institutional.records[origin.id]);
  if (origin.kind === "report") return Boolean(world.management?.reports?.some((item) => item.id === origin.id && item.lifecycle === "reviewed"));
  if (origin.kind === "infrastructure") return Object.values(world.management?.infrastructure ?? {}).some((item) => item.id === origin.id && item.status === "completed");
  return false;
}
function callbackRecognition(mode, recognition, origin) {
  if (!recognition || recognition === "unrecognized") return "unrecognized";
  if (recognition === "domain-recognized" && mode !== "lost") return "domain-recognized";
  if (recognition === "specifically-linked" && mode === "beck" && origin.kind === "institutional-record") return "specifically-linked";
  return "unrecognized";
}
function registerCallback(world, { run_id, mode, origin, physical_target = null, description, recognition = "unrecognized", region_ref = null, observed = false }) {
  const s = state(world); if (!MODES.has(mode) || !world.runs[run_id] || !originExists(world, origin) || !description || observed !== true) return { ok: false, code: "CALLBACK_SOURCE_UNKNOWN" };
  const id = `callback-${hash([world.world_id, run_id, mode, origin, physical_target, description]).slice(0, 16)}`;
  if (s.callbacks[id]) return { ok: true, idempotent: true, callback: safeCallback(s.callbacks[id]) };
  const callback = { id, run_id, mode, origin: clone(origin), physical_target: physical_target ? clone(physical_target) : null, description, recognition: callbackRecognition(mode, recognition, origin), region_ref, provenance: "pack-original-gameplay-callback" };
  s.callbacks[id] = callback; event(world, run_id, "callback_recognized", { mode, callback_id: id, recognition: callback.recognition, origin_kind: origin.kind }); return { ok: true, callback: safeCallback(callback) };
}
function safeCallback(item) { return { ref: item.id, description: item.description, recognition: item.recognition, region_ref: item.region_ref }; }
function scopedTimeline(world, { mode, run_id = null } = {}) {
  const s = state(world); if (!MODES.has(mode)) return [];
  const own = world.events.filter((item) => item.type.startsWith("gameplay.") && item.type !== "gameplay.callback_recognized" && item.payload.mode === mode && (!run_id || item.run_id === run_id)).map((item) => ({ type: item.type.slice("gameplay.".length), sequence: item.sequence }));
  const callbacks = Object.values(s.callbacks).filter((item) => item.mode === mode && (!run_id || item.run_id === run_id)).map((item) => ({ type: "callback", ref: item.id, description: item.description, recognition: item.recognition }));
  return [...own, ...callbacks].sort((a, b) => `${a.sequence ?? ""}:${a.ref ?? ""}`.localeCompare(`${b.sequence ?? ""}:${b.ref ?? ""}`));
}
function actionsFor(mode) { return { "clear-q4": ["MOVE", "INSPECT", "USE", "RECORD", "COMMUNICATE", "WAIT", "RETURN", "ABORT", "CHOOSE"], nullzone: ["PREPARE", "ENTER", "INSPECT", "RECOVER", "RETURN", "ARCHIVE", "CHOOSE"], lost: ["MOVE", "INSPECT", "DROP", "RETURN", "CHOOSE"], beck: ["REVIEW_REPORT", "APPROVE_RECOVERY", "START_RESEARCH", "APPROVE_INFRASTRUCTURE", "CHOOSE"] }[mode] ?? []; }
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
  const decisions = Object.values(s.decisions).filter((item) => item.run_id === run_id).map(safeDecision);
  const callbacks = Object.values(s.callbacks).filter((item) => item.run_id === run_id && item.mode === mode).map(safeCallback);
  const summary = { version: PROJECTION_VERSION, run_id, mode, objectives, recovered_values: values, progression: clone(s.progression[mode].unlocks).map((item) => ({ type: item.type, summary: item.summary, utility: progressionUtility(mode, item.type) })), decisions, callbacks, follow_ups: Object.values(s.objectives).filter((item) => item.parent_id && item.mode === mode && item.status === "offered").map((item) => ({ ref: item.id, type: item.type })), revisit_opportunities: Object.values(s.revisits).filter((item) => item.mode === mode && item.status === "available").map(({ id, region_ref, reason, objective_id }) => ({ ref: id, region_ref, reason, objective_ref: objective_id })), persistent_consequences: world.events.filter((item) => item.run_id === run_id && /(?:remnant|artifact|region\.mutated|process_failed)/.test(item.type)).map((item) => item.type) };
  s.summaries[run_id] = clone(summary); event(world, run_id, "session_summarized", { mode, objective_count: objectives.length, follow_up_count: summary.follow_ups.length }); return { ok: true, summary };
}
function projection(world, { mode, run_id = null } = {}) {
  const s = state(world); if (!MODES.has(mode)) return { version: PROJECTION_VERSION, objectives: [], progression: [], timeline: [] };
  const objectives = Object.values(s.objectives).filter((item) => item.mode === mode).map(({ id, type, classification, target, known_information, status, reward, depth }) => ({ ref: id, type, classification, target, known_information: clone(known_information), status, reward: reward ? clone(reward) : null, depth }));
  const timeline = scopedTimeline(world, { mode, run_id });
  const risks = Object.values(s.risks).filter((item) => item.mode === mode && (!run_id || item.run_id === run_id)).map(({ id, level, factors, resources }) => ({ ref: id, level, factors: clone(factors), resources: clone(resources) }));
  const decisions = Object.values(s.decisions).filter((item) => item.mode === mode && (!run_id || item.run_id === run_id)).map(safeDecision);
  const revisits = Object.values(s.revisits).filter((item) => item.mode === mode && item.status === "available").map(({ id, region_ref, reason, objective_id }) => ({ ref: id, region_ref, reason, objective_ref: objective_id }));
  return { version: PROJECTION_VERSION, mode, role: ({ "clear-q4": "Async: Clear-Q4", nullzone: "Nullzone Exposure", lost: "Lost", beck: "Async: Beck's Desk" })[mode], available_actions: actionsFor(mode), objectives, progression: clone(s.progression[mode].unlocks).map((item) => ({ type: item.type, summary: item.summary, utility: progressionUtility(mode, item.type) })), evidence_values: Object.values(s.valuations).filter((item) => item.mode === mode).map(({ source_kind, kind, novelty, relevance }) => ({ source_kind, kind, novelty, relevance })), known_risk: risks, choices: decisions, callbacks: Object.values(s.callbacks).filter((item) => item.mode === mode && (!run_id || item.run_id === run_id)).map(safeCallback), revisit_opportunities: revisits, timeline, session_summary: run_id ? clone(s.summaries[run_id] ?? null) : null };
}
module.exports = { VERSION, PROJECTION_VERSION, MAX_FOLLOW_UP_DEPTH, modeForProfile, state, createObjective, resolveObjective, assessEvidence, assessArtifact, evaluateKnownRisk, createDecision, resolveDecision, createRevisitOpportunity, registerCallback, scopedTimeline, sessionSummary, projection };
