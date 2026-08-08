"use strict";

// Canonical continuity and reaction authority.  This intentionally records
// small operational facts rather than biographies or relationship scores.
const crypto = require("node:crypto");
const history = require("./world-history");
const spatialRuntime = require("./spatial-runtime");

const VERSION = "yellow-beast-q4-personnel-continuity@v1";
const MAX_HISTORY = 80;
const FIELD_PHASES = new Set(["FIELD_OPERATION", "RETURN"]);
const VALID_PHASES = new Set(["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN", "DEBRIEF"]);
const clone = (value) => structuredClone(value);
const score = (parts) => Number.parseInt(crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 8), 16);
const bounded = (value) => Math.max(0, Math.min(100, Math.round(value)));

function tendencies(identity) {
  return {
    procedural_caution: 28 + (score([identity, "procedural-caution"]) % 53),
    communication_frequency: 18 + (score([identity, "communication-frequency"]) % 58),
    confirmation_preference: 24 + (score([identity, "confirmation-preference"]) % 57),
    separation_tolerance: 24 + (score([identity, "separation-tolerance"]) % 55),
    equipment_accountability: 32 + (score([identity, "equipment-accountability"]) % 50)
  };
}

function qualifications(person) {
  const role = String(person?.role ?? "").toLowerCase();
  const result = new Set(["field-operation", "local-communication"]);
  if (/survey|route|research/.test(role)) result.add("survey");
  if (/documentation|record/.test(role)) result.add("documentation");
  if (/safety/.test(role)) result.add("field-safety");
  if (/route/.test(role)) result.add("route-assessment");
  return [...result].sort();
}

function ensurePerson(world, runId, identity) {
  const person = history.character(world, identity);
  if (!person) return null;
  if (!person.continuity || person.continuity.version !== VERSION) {
    person.continuity = { version: VERSION, tendencies: tendencies(identity), qualifications: qualifications(person), shared_history: [], equipment_custody_history: [], reaction_history: [] };
    history.event(world, runId ?? "personnel-continuity-migration", "character.continuity.initialized", { identity, continuity: clone(person.continuity) }, "q4-personnel-continuity");
  } else {
    person.continuity.tendencies ??= tendencies(identity);
    person.continuity.qualifications ??= qualifications(person);
    person.continuity.shared_history ??= [];
    person.continuity.equipment_custody_history ??= [];
    person.continuity.reaction_history ??= [];
  }
  return person;
}

function ensureTeam(world, runId, members = []) { return members.map((member) => ensurePerson(world, runId, member.personnel_id ?? member.id ?? member.identity)).filter(Boolean); }
function limited(list, item) { list.push(clone(item)); if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY); }

function historyId(world, runId, kind, participants, refs) { return `q4-shared-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, runId, kind, [...participants].sort(), refs])).digest("hex").slice(0, 18)}`; }
function recordSharedHistory(world, { run_id, participants, kind, refs = {}, at = null }) {
  const identities = [...new Set((participants ?? []).filter(Boolean))].sort();
  if (identities.length < 2) return { ok: false, code: "SHARED_HISTORY_PARTICIPANTS_REQUIRED" };
  for (const identity of identities) if (!ensurePerson(world, run_id, identity)) return { ok: false, code: "PERSONNEL_UNKNOWN" };
  const id = historyId(world, run_id, kind, identities, refs);
  if (world.events.some((entry) => entry.type === "character.shared-history.recorded" && entry.payload?.id === id)) return { ok: true, idempotent: true, id };
  const fact = { id, run_id, kind, participants: identities, refs: clone(refs), at };
  for (const identity of identities) limited(history.character(world, identity).continuity.shared_history, fact);
  history.event(world, run_id, "character.shared-history.recorded", fact, "q4-personnel-continuity");
  return { ok: true, idempotent: false, id, fact: clone(fact) };
}

function recordCustody(world, { run_id, equipment_id, from, to, at = null }) {
  const participants = [from, to].filter(Boolean); if (!participants.length) return { ok: false, code: "CUSTODY_PARTICIPANTS_REQUIRED" };
  for (const identity of participants) if (!ensurePerson(world, run_id, identity)) return { ok: false, code: "PERSONNEL_UNKNOWN" };
  const id = `q4-custody-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, run_id, equipment_id, from, to, at])).digest("hex").slice(0, 18)}`;
  if (world.events.some((entry) => entry.type === "character.equipment-custody.recorded" && entry.payload?.id === id)) return { ok: true, idempotent: true, id };
  const record = { id, run_id, equipment_id, from: from ?? null, to: to ?? null, at };
  for (const identity of participants) limited(history.character(world, identity).continuity.equipment_custody_history, record);
  history.event(world, run_id, "character.equipment-custody.recorded", record, "q4-personnel-continuity");
  return { ok: true, idempotent: false, id };
}

function memberFor(run, identity) { return (run?.expedition?.team?.members ?? []).find((member) => (member.personnel_id ?? member.id) === identity) ?? null; }
function knownEvent(workerId, event = {}) { return (event.observed_by ?? []).includes(workerId) || (event.delivered_to ?? []).includes(workerId) || event.actor === workerId; }
function roleRelevance(person, event) {
  const role = String(person?.role ?? "").toLowerCase(); const tags = event.role_tags ?? [];
  if (!tags.length) return 0;
  if (tags.includes("equipment") && /documentation|safety/.test(role)) return 18;
  if (tags.includes("route") && /survey|route/.test(role)) return 22;
  if (tags.includes("documentation") && /documentation/.test(role)) return 25;
  if (tags.includes("safety") && /safety/.test(role)) return 25;
  return 0;
}

// The returned object is deliberately a safe projection: no objective topology,
// unseen event payload, private UI state, or other observer's knowledge escapes.
function reactionContext({ world, run, phase, worker_id, player_id, event = {} }) {
  const worker = ensurePerson(world, run?.run_id, worker_id);
  const member = memberFor(run, worker_id); const playerMember = memberFor(run, player_id);
  if (!worker || !member || !VALID_PHASES.has(phase)) return { valid: false, code: "REACTION_CONTEXT_UNAVAILABLE", reaction: null };
  const workerLocation = run?.spatial?.personnel_locations?.[worker_id] ?? null;
  const playerLocation = run?.spatial?.personnel_locations?.[player_id] ?? null;
  const proximity = run?.spatial && player_id ? spatialRuntime.proximity(run.spatial, player_id, worker_id) : { category: "LOCAL", speaking_range: true };
  const delivered = (event.delivered_to ?? []).includes(worker_id);
  const direct = knownEvent(worker_id, event) && (!event.location || event.location === workerLocation || delivered);
  const fieldEvent = event.scene === "field" || Boolean(event.location);
  if (fieldEvent && !FIELD_PHASES.has(phase)) return { valid: false, code: "REACTION_WRONG_PHASE", reaction: null };
  if (!direct) return { valid: false, code: "REACTION_EVENT_UNKNOWN", reaction: null };
  const safeEvent = { id: String(event.id ?? "known-event"), category: String(event.category ?? "operational"), summary: String(event.summary ?? "known condition").slice(0, 240), novelty_key: String(event.novelty_key ?? event.id ?? "known-event"), operational_importance: bounded(event.operational_importance ?? 0), perceived_risk: bounded(event.perceived_risk ?? 0), role_tags: [...(event.role_tags ?? [])], direct_involvement: (event.participants ?? []).includes(worker_id), delivered };
  const relevantHistory = worker.continuity.shared_history.filter((fact) => event.history_keys?.some((key) => Object.values(fact.refs ?? {}).includes(key))).slice(-4).map((fact) => ({ id: fact.id, kind: fact.kind }));
  return { version: "yellow-beast-personnel-reaction-context@v1", valid: true, operation: { run_id: run?.run_id ?? null, phase }, worker: { identity: worker.identity, role: worker.role, qualifications: clone(worker.continuity.qualifications), tendencies: clone(worker.continuity.tendencies), condition: worker.condition, task: clone(member.current_task ?? member.assignment ?? null), location: workerLocation, reaction_history: clone(worker.continuity.reaction_history) }, player: { contact: proximity.category, location: proximity.speaking_range ? playerLocation : null }, assignment: clone(worker.current_assignment ?? member.assignment ?? null), equipment: Object.values(run?.expedition?.equipment ?? {}).filter((item) => item.holder === worker_id).map((item) => ({ id: item.id, label: item.label, state: item.state })), event: safeEvent, relevant_history: relevantHistory, allowable_reactions: ["silence", "acknowledgment", "warning", "question", "uncertainty"] };
}

function salience(context) {
  if (!context?.valid) return { eligible: false, score: 0, reason: context?.code ?? "REACTION_CONTEXT_UNAVAILABLE", category: "silence" };
  const event = context.event; const tendency = context.worker.tendencies;
  const prior = (context.worker.reaction_history ?? []); // retained only for standalone callers; canonical lookup follows below.
  const base = event.operational_importance * .55 + event.perceived_risk * .35 + roleRelevance(context.worker, event) + (event.direct_involvement ? 16 : 0) + context.relevant_history.length * 5 + tendency.communication_frequency * .18;
  const repetitions = prior.filter((entry) => entry.novelty_key === event.novelty_key).length;
  const scoreValue = bounded(base - repetitions * 65);
  const threshold = 58 - tendency.communication_frequency * .12;
  const category = event.perceived_risk >= 65 ? "warning" : event.operational_importance >= 62 ? "question" : event.delivered ? "acknowledgment" : "uncertainty";
  return { eligible: scoreValue >= threshold, score: scoreValue, threshold: bounded(threshold), repetitions, category: scoreValue >= threshold ? category : "silence", reason: scoreValue >= threshold ? "SALIENCE_THRESHOLD_MET" : "SALIENCE_BELOW_THRESHOLD" };
}

function react(world, context) {
  const result = salience(context); if (!context?.valid || !result.eligible) return { ...result, reaction: null };
  const worker = ensurePerson(world, context.operation.run_id, context.worker.identity);
  const prior = worker.continuity.reaction_history.filter((entry) => entry.novelty_key === context.event.novelty_key).length;
  const reevaluated = { ...context, worker: { ...context.worker, reaction_history: worker.continuity.reaction_history } };
  const final = { ...salience(reevaluated), prior_reactions: prior };
  if (!final.eligible) return { ...final, reaction: null };
  const reaction = { id: `q4-reaction-${crypto.createHash("sha256").update(JSON.stringify([context.operation.run_id, worker.identity, context.event.id, final.category, prior])).digest("hex").slice(0, 18)}`, novelty_key: context.event.novelty_key, event_id: context.event.id, category: final.category, at: context.operation.run_id, basis: { role_relevance: roleRelevance(worker, context.event), relevant_history: context.relevant_history.map((item) => item.id), score: final.score } };
  limited(worker.continuity.reaction_history, reaction);
  history.event(world, context.operation.run_id, "character.reaction.recorded", { identity: worker.identity, reaction }, "q4-personnel-salience");
  return { ...final, reaction: clone(reaction) };
}

function presentReaction(person, reaction) {
  if (!reaction) return null;
  const name = person?.first_name ?? person?.display_name ?? "Assigned teammate";
  const lines = { acknowledgment: "Acknowledged. I have the same report.", warning: "Hold on. This crosses my current safety threshold.", question: "I want confirmation before we continue under that condition.", uncertainty: "I cannot confirm more than what is in front of us." };
  return `${name}: ${lines[reaction.category] ?? "Acknowledged."}`;
}

function decisionContext({ world, run, phase, worker_id, request = {} }) {
  const worker = ensurePerson(world, run?.run_id, worker_id); const member = memberFor(run, worker_id);
  const location = run?.spatial?.personnel_locations?.[worker_id] ?? null;
  return { valid: Boolean(worker && member), worker, member, phase, location, request: clone(request), equipment: Object.values(run?.expedition?.equipment ?? {}), run };
}

function decide(context) {
  if (!context?.valid) return { state: "unheard", reason: "PERSONNEL_UNKNOWN" };
  const { worker, member, request, phase, location, equipment } = context;
  if (request.received === false) return { state: "unheard", reason: "ORDER_NOT_RECEIVED" };
  if (!FIELD_PHASES.has(phase)) return { state: "cannot-comply", reason: "WRONG_OPERATIONAL_PHASE" };
  if (worker.status !== "active" || member.status !== "active") return { state: "cannot-comply", reason: "PERSONNEL_UNAVAILABLE" };
  if (request.qualification && !worker.continuity.qualifications.includes(request.qualification)) return { state: "cannot-comply", reason: "QUALIFICATION_REQUIRED" };
  if (request.target_location && request.reachable === false) return { state: "cannot-comply", reason: "ROUTE_UNAVAILABLE" };
  if (request.required_equipment && !equipment.some((item) => item.holder === worker.identity && (item.id === request.required_equipment || item.instance_id === request.required_equipment) && ["operational", "serviceable", "usable"].includes(String(item.state).toLowerCase()))) return { state: "cannot-comply", reason: "EQUIPMENT_REQUIRED" };
  if (request.procedural_conflict) return { state: "refused", reason: "PROCEDURE_CONFLICT" };
  if (member.current_task?.state === "active" && !["follow", "wait", "player-directed"].includes(member.current_task.type) && request.type !== "assist") return { state: "delayed", reason: "HIGHER_PRIORITY_TASK" };
  const riskThreshold = 76 - worker.continuity.tendencies.procedural_caution * .32;
  if (bounded(request.perceived_risk ?? 0) >= riskThreshold) return { state: "refused", reason: "RISK_THRESHOLD", threshold: bounded(riskThreshold) };
  return { state: "accepted", reason: "QUALIFIED_OPERATIONAL_COMPLIANCE" };
}

function publicRecord(person, playerId = null) {
  if (!person) return null; const continuity = person.continuity ?? {};
  const shared = (continuity.shared_history ?? []).filter((fact) => fact.participants?.includes(playerId));
  return { role: person.role, qualifications: clone(continuity.qualifications ?? qualifications(person)), status: person.status, assignment_count: person.assignment_history?.length ?? 0, shared_assignment_count: shared.filter((fact) => fact.kind === "served-together").length, relevant_history: shared.slice(-4).map((fact) => ({ kind: fact.kind, refs: clone(fact.refs) })) };
}

module.exports = { VERSION, tendencies, qualifications, ensurePerson, ensureTeam, recordSharedHistory, recordCustody, reactionContext, salience, react, presentReaction, decisionContext, decide, publicRecord };
