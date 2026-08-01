"use strict";

// Standard's persistent operational response authority. It consumes only
// institutionally available records and never reads hidden world truth.
const crypto = require("node:crypto");
const operationalTime = require("./operational-time");
const communications = require("./communication-runtime");

const DEFINITION_VERSION = "yellow-beast-institutional-worldpack@v1";
const STATE_VERSION = "yellow-beast-institutional-state@v1";
const INPUT_TYPES = new Set(["normal-report", "incomplete-report", "contradictory-report", "silence", "late-report", "missed-check-in", "deviation-request", "unapproved-deviation", "equipment-damage", "equipment-loss", "evidence-report", "evidence-withholding", "recovered-complication", "personnel-injury", "personnel-separation", "missing-personnel", "confirmed-casualty", "controlled-abort", "mission-failure", "clean-completion", "enhanced-completion", "degraded-completion", "mission-closure"]);
const DECISIONS = new Set(["acknowledge-report", "request-clarification", "request-additional-evidence", "schedule-extra-check-in", "authorize-deviation", "deny-deviation", "issue-caution", "modify-return-instructions", "order-withdrawal", "authorize-controlled-abort", "restrict-optional-exploration", "authorize-additional-equipment", "deny-additional-equipment", "flag-damaged-equipment", "prioritize-evidence", "quarantine-evidence", "alter-future-staffing", "remove-unavailable-personnel", "assign-replacement", "increase-oversight", "reduce-oversight", "create-follow-up-assignment", "recommend-review"]);
const DIMENSIONS = Object.freeze({ support_posture: ["routine", "available", "prioritized", "emergency"], scrutiny_level: ["routine", "watch", "concerned", "restricted", "critical"], operational_confidence: ["provisional", "stable", "high", "reduced", "suspended"], information_confidence: ["uncertain", "provisional", "corroborated", "contradictory"], resource_posture: ["standard", "supported", "constrained", "restricted"], staffing_posture: ["standard", "reinforced", "review", "restricted"], equipment_restriction_level: ["none", "review", "restricted", "critical"], communication_concern: ["none", "watch", "concerned", "critical"], mission_review_status: ["none", "pending", "open", "closed"] });
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 18);
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

function validateCondition(condition, label) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error(`${label} must be structured data`);
  if (condition.all || condition.any) { const list = condition.all ?? condition.any; if (Object.keys(condition).length !== 1 || !Array.isArray(list) || !list.length) throw new Error(`${label} has invalid composition`); list.forEach((entry, index) => validateCondition(entry, `${label}.${condition.all ? "all" : "any"}[${index}]`)); return true; }
  if (condition.not) { if (Object.keys(condition).length !== 1) throw new Error(`${label}.not contains unsupported fields`); return validateCondition(condition.not, `${label}.not`); }
  const allowed = new Set(["input_type", "purpose", "state", "outcome_family", "quality", "minimum_count", "has_fact"]); if (Object.keys(condition).some((key) => !allowed.has(key))) throw new Error(`${label} contains an unsupported executable or data field`);
  if (condition.input_type && !INPUT_TYPES.has(condition.input_type)) throw new Error(`${label}.input_type is invalid`);
  if (!Object.keys(condition).length) throw new Error(`${label} is empty`); return true;
}
function validateDefinition(definition, catalogs = {}) {
  if (!definition || definition.version !== DEFINITION_VERSION || !idPattern.test(definition.worldpack_id ?? "")) throw new Error("unsupported institutional worldpack");
  if (!Array.isArray(definition.response_rules) || !Array.isArray(definition.follow_up_assignments) || !definition.initial_state) throw new Error("institutional worldpack is incomplete");
  for (const [dimension, values] of Object.entries(DIMENSIONS)) if (!values.includes(definition.initial_state[dimension])) throw new Error(`invalid institutional initial state at initial_state.${dimension}`);
  const ruleIds = definition.response_rules.map((rule) => rule.id); if (new Set(ruleIds).size !== ruleIds.length) throw new Error("institutional response rules contain duplicate IDs");
  for (const rule of definition.response_rules) { if (!idPattern.test(rule.id ?? "") || !DECISIONS.has(rule.decision) || !Number.isInteger(rule.delay) || rule.delay < 0 || typeof rule.public_response !== "string" || !rule.public_response.trim() || typeof rule.private_rationale !== "string" || !rule.private_rationale.trim()) throw new Error(`invalid institutional response rule at response_rules.${rule.id ?? "unknown"}`); validateCondition(rule.when, `response_rules.${rule.id}.when`); for (const [dimension, value] of Object.entries(rule.state_changes ?? {})) if (!DIMENSIONS[dimension]?.includes(value)) throw new Error(`invalid institutional transition at response_rules.${rule.id}.state_changes.${dimension}`); }
  const followupIds = definition.follow_up_assignments.map((item) => item.id); if (new Set(followupIds).size !== followupIds.length) throw new Error("follow-up assignments contain duplicate IDs");
  const missionIds = new Set(catalogs.missions ?? []);
  for (const followup of definition.follow_up_assignments) { if (!idPattern.test(followup.id ?? "") || typeof followup.display_name !== "string" || typeof followup.public_summary !== "string") throw new Error(`invalid follow-up assignment at follow_up_assignments.${followup.id ?? "unknown"}`); validateCondition(followup.when, `follow_up_assignments.${followup.id}.when`); if (followup.mission_id && missionIds.size && !missionIds.has(followup.mission_id)) throw new Error(`follow-up assignment references unknown mission at follow_up_assignments.${followup.id}.mission_id`); }
  return true;
}
function createState(definition) { validateDefinition(definition); return { version: STATE_VERSION, definition_version: definition.version, worldpack_id: definition.worldpack_id, revision: 0, clock: 0, dimensions: clone(definition.initial_state), confirmed_knowledge: [], uncertain_claims: [], pending_reports: [], pending_decisions: [], decisions: [], follow_up_assignments: [], restrictions: { equipment: [], optional_exploration: false, extra_check_ins: 0 }, staffing_consequences: [], equipment_consequences: [], unavailable_personnel: [], input_history: [], transition_history: [], review_history: [], processed_provenance: [] }; }
function ensure(world, definition) {
  if (!world) throw new Error("institutional state requires a persistent world");
  if (!world.institutional_response) world.institutional_response = createState(definition);
  const state = world.institutional_response;
  if (state.version !== STATE_VERSION) {
    if (!state.version || state.version === "yellow-beast-institutional-state@v0") { const migrated = createState(definition); Object.assign(migrated, clone(state), { version: STATE_VERSION, migrated_from: state.version ?? "legacy-world-records" }); world.institutional_response = migrated; }
    else throw new Error(`unsupported institutional state version: ${state.version}`);
  }
  world.institutional_response.processed_provenance ??= []; world.institutional_response.unavailable_personnel ??= []; return world.institutional_response;
}
function conditionMatches(condition, input, state) {
  if (condition.all) return condition.all.every((entry) => conditionMatches(entry, input, state));
  if (condition.any) return condition.any.some((entry) => conditionMatches(entry, input, state));
  if (condition.not) return !conditionMatches(condition.not, input, state);
  if (condition.input_type && input.type !== condition.input_type) return false;
  if (condition.purpose && input.purpose !== condition.purpose) return false;
  if (condition.state && input.state !== condition.state) return false;
  if (condition.outcome_family && input.outcome_family !== condition.outcome_family) return false;
  if (condition.quality && input.quality !== condition.quality) return false;
  if (condition.has_fact && !(input.facts ?? []).some((fact) => fact.kind === condition.has_fact || fact.id === condition.has_fact)) return false;
  if (condition.minimum_count && state.input_history.filter((entry) => entry.type === (condition.input_type ?? input.type)).length < condition.minimum_count) return false;
  return true;
}
function knownInput(input) {
  if (!INPUT_TYPES.has(input?.type)) throw new Error(`unsupported institutional input: ${input?.type ?? "missing"}`);
  if (!input.provenance?.id || !input.provenance?.kind) throw new Error("institutional input requires provenance");
  if (input.provenance.kind === "communication" && !["delivered", "acknowledged"].includes(input.state)) throw new Error("undelivered communication cannot enter institutional knowledge");
  if (input.type === "silence" && input.state !== "missed") throw new Error("silence is knowable only after a missed expectation");
  return true;
}
function scheduleDecision(world, expedition, definition, rule, input) {
  const state = ensure(world, definition); const id = `institution-decision-${digest([state.worldpack_id, rule.id, input.provenance.id])}`; const existing = state.pending_decisions.find((item) => item.id === id) ?? state.decisions.find((item) => item.id === id); if (existing) return existing;
  const due = (expedition?.clock?.interval ?? state.clock) + rule.delay; const pending = { id, rule_id: rule.id, decision: rule.decision, status: "scheduled", scheduled_at: expedition?.clock?.interval ?? state.clock, due_at: due, trigger_provenance: clone(input.provenance), public_response: rule.public_response, private_rationale: rule.private_rationale, state_changes: clone(rule.state_changes ?? {}), follow_up_id: rule.follow_up_id ?? null, resolved_at: null }; state.pending_decisions.push(pending);
  if (expedition) operationalTime.schedule(expedition, { id: `institution-response-${id}`, event_type: "institution.response", scheduled_interval: due, source: "Standard", target: expedition.id, payload: { decision_id: id }, visibility_policy: "known-when-resolved" }); return pending;
}
function ingest(world, expedition, definition, input) {
  knownInput(input); const state = ensure(world, definition); if (state.processed_provenance.includes(input.provenance.id)) return { accepted: false, idempotent: true, scheduled: [] };
  const record = { id: `institution-input-${digest([input.type, input.provenance])}`, sequence: state.input_history.length + 1, type: input.type, purpose: input.purpose ?? null, state: input.state ?? "confirmed", outcome_family: input.outcome_family ?? null, quality: input.quality ?? null, summary: input.summary ?? "Institutional input received.", facts: clone(input.facts ?? []), provenance: clone(input.provenance), received_at: expedition?.clock?.interval ?? state.clock };
  state.input_history.push(record); state.processed_provenance.push(input.provenance.id); state.revision += 1;
  if ((input.provenance.kind === "communication" && input.quality !== "corroborated") || ["contradictory-report", "incomplete-report", "normal-report", "deviation-request"].includes(input.type)) state.uncertain_claims.push({ input_id: record.id, status: input.type === "contradictory-report" ? "contradictory" : "uncorroborated", summary: record.summary, provenance: clone(record.provenance) });
  else state.confirmed_knowledge.push({ input_id: record.id, type: input.type, summary: record.summary, facts: clone(record.facts), provenance: clone(record.provenance), confirmed_at: record.received_at });
  const scheduled = definition.response_rules.filter((rule) => conditionMatches(rule.when, record, state)).map((rule) => scheduleDecision(world, expedition, definition, rule, record)); state.pending_reports.push({ input_id: record.id, status: scheduled.length ? "review-scheduled" : "recorded", decision_ids: scheduled.map((item) => item.id) }); return { accepted: true, input: clone(record), scheduled: clone(scheduled) };
}
function applyStateChanges(state, decision, at) {
  for (const [dimension, next] of Object.entries(decision.state_changes ?? {})) { const previous = state.dimensions[dimension]; if (previous === next) continue; state.dimensions[dimension] = next; state.transition_history.push({ sequence: state.transition_history.length + 1, dimension, previous, next, at, triggering_evidence: clone(decision.trigger_provenance), public_explanation: decision.public_response, private_rationale: decision.private_rationale }); }
  if (decision.decision === "restrict-optional-exploration") state.restrictions.optional_exploration = true;
  if (decision.decision === "schedule-extra-check-in") state.restrictions.extra_check_ins += 1;
  if (decision.decision === "deny-additional-equipment") state.restrictions.equipment = [...new Set([...state.restrictions.equipment, "optional-stores"])];
}
function exposeFollowUp(state, definition, input, at) {
  for (const authored of definition.follow_up_assignments.filter((entry) => conditionMatches(entry.when, input, state))) if (!state.follow_up_assignments.some((item) => item.id === authored.id)) state.follow_up_assignments.push({ id: authored.id, mission_id: authored.mission_id ?? null, display_name: authored.display_name, public_summary: authored.public_summary, status: "available", created_at: at, trigger_provenance: clone(input.provenance), staffing_modifier: clone(authored.staffing_modifier ?? null), equipment_modifier: clone(authored.equipment_modifier ?? null) });
}
function resolveDecision(world, expedition, definition, decisionId) {
  const state = ensure(world, definition); const pending = state.pending_decisions.find((item) => item.id === decisionId); if (!pending) return { ok: false, code: "INSTITUTION_DECISION_UNKNOWN" }; if (pending.status === "completed") return { ok: true, idempotent: true, decision: clone(pending) };
  const at = expedition?.clock?.interval ?? state.clock; if (at < pending.due_at) return { ok: false, code: "INSTITUTION_DECISION_NOT_DUE" }; pending.status = "completed"; pending.resolved_at = at; state.decisions.push(clone(pending)); state.pending_decisions = state.pending_decisions.filter((item) => item.id !== pending.id); applyStateChanges(state, pending, at); state.review_history.push({ sequence: state.review_history.length + 1, decision_id: pending.id, at, public_explanation: pending.public_response, private_rationale: pending.private_rationale }); state.revision += 1;
  const sourceInput = state.input_history.find((item) => item.provenance.id === pending.trigger_provenance.id); if (sourceInput) exposeFollowUp(state, definition, sourceInput, at);
  let message = null; if (expedition) { message = communications.createMessage(expedition, { id: `standard-${pending.id}`, sender: "Standard", recipient: expedition.team?.members?.[0]?.personnel_id ?? "field-team", channel: "FIELD_RADIO", purpose: pending.decision, text: pending.public_response, provenance: `institutional-decision:${pending.id}` }); communications.transition(expedition, message, "delivered", "scheduled Standard response resolved", at); }
  return { ok: true, decision: clone(pending), message: clone(message) };
}
function handleEvent(run, definition, event) { if (event.event_type !== "institution.response") return null; const world = run._world; if (!world) return { status: "cancelled", reason: "persistent institutional world unavailable" }; const result = resolveDecision(world, run.expedition, definition, event.payload?.decision_id); return result.ok ? { status: "completed", reason: "scheduled institutional response delivered", result: { decision_id: result.decision.id, message_id: result.message?.id ?? null } } : { status: result.code === "INSTITUTION_DECISION_NOT_DUE" ? "scheduled" : "cancelled", reason: result.code };
}
function ingestDeliveredCommunications(run, definition) {
  if (!run._world) return []; const results = [];
  for (const message of run.expedition?.messages ?? []) {
    if (message.sender === "Standard" || !["delivered", "acknowledged"].includes(message.state) || message.intended_recipient !== "Standard") continue;
    const text = String(message.text ?? "").toLowerCase(); let type = message.purpose === "scheduled-check-in" ? ((message.delivered_at ?? 0) > (run.expedition.communications?.check_ins?.find((item) => item.message_id === message.id)?.due_at ?? Infinity) ? "late-report" : "normal-report") : message.purpose === "evidence-report" ? "evidence-report" : message.purpose === "deviation-request" ? "deviation-request" : /\b(dead|deceased|fatal|casualty)\b/.test(text) ? "confirmed-casualty" : /\bmissing\b/.test(text) ? "missing-personnel" : /\bseparat|lost contact\b/.test(text) ? "personnel-separation" : /\b(lost|abandon).*\b(equipment|radio|camera|instrument|lamp)\b|\b(equipment|radio|camera|instrument|lamp).*\b(lost|abandon)/.test(text) ? "equipment-loss" : /\b(damag|disable).*\b(equipment|radio|camera|instrument|lamp)\b|\b(equipment|radio|camera|instrument|lamp).*\b(damag|disable)/.test(text) ? "equipment-damage" : message.purpose === "emergency-report" ? "personnel-injury" : "normal-report";
    results.push(ingest(run._world, run.expedition, definition, { type, purpose: message.purpose, state: message.state, summary: message.text, quality: message.evidence_ids?.length ? "recorded" : "claim", facts: (message.evidence_ids ?? []).map((id) => ({ kind: "reported-evidence", id })), provenance: { kind: "communication", id: message.id, delivered_at: message.delivered_at } }));
  }
  for (const checkIn of run.expedition?.communications?.check_ins ?? []) if (checkIn.state === "missed") results.push(ingest(run._world, run.expedition, definition, { type: "silence", purpose: "scheduled-check-in", state: "missed", summary: `${checkIn.label} was missed.`, provenance: { kind: "missed-expectation", id: `missed-${run.run_id}-${checkIn.id}`, due_at: checkIn.due_at, missed_at: checkIn.missed_at } }));
  return results;
}
function ingestClosure(world, definition, run, review) {
  const result = run.expedition?.mission_state?.final_result ?? run.expedition?.result ?? {}; const family = result.classification ?? review?.outcome ?? "degraded-completion"; const map = { "clean-completion": "clean-completion", "enhanced-completion": "enhanced-completion", "recovered-complication": "recovered-complication", "degraded-completion": "degraded-completion", "controlled-abort": "controlled-abort", "mission-failure": "mission-failure", "personnel-loss": "confirmed-casualty" }; const type = map[family] ?? (String(family).includes("abort") ? "controlled-abort" : String(family).includes("fail") ? "mission-failure" : "mission-closure");
  const facts = [{ kind: "mission-outcome", id: family }, ...(review?.personnel ?? []).filter((item) => ["deceased", "missing"].includes(item.status)).map((item) => ({ kind: item.status === "deceased" ? "confirmed-casualty" : "missing-personnel", id: item.identity })), ...(review?.equipment ?? []).filter((item) => ["missing", "abandoned", "damaged"].includes(item.status)).map((item) => ({ kind: "equipment-outcome", id: item.id, state: item.status })), ...(review?.evidence ?? []).map((item) => ({ kind: "returned-evidence", id: item.id }))];
  const closureId = `closure-${run.run_id}-${review?.mission_id ?? result.mission_id}`;
  const input = { type, state: "confirmed", outcome_family: family, quality: (review?.evidence ?? []).length > 1 ? "corroborated" : (review?.evidence ?? []).length ? "recorded" : "claim", summary: review?.public_debrief_summary ?? `Mission closed as ${family}.`, facts, provenance: { kind: "mission-closure", id: closureId, mission_id: review?.mission_id ?? result.mission_id } };
  const ingested = ingest(world, null, definition, input); const state = ensure(world, definition); exposeFollowUp(state, definition, ingested.input ?? state.input_history.find((entry) => entry.provenance.id === closureId) ?? state.input_history.at(-1), state.clock);
  const derived = [];
  for (const person of review?.personnel ?? []) if (["deceased", "missing"].includes(person.status)) derived.push(ingest(world, null, definition, { type: person.status === "deceased" ? "confirmed-casualty" : "missing-personnel", state: "confirmed", summary: `${person.display_name ?? "Assigned personnel"} was reconciled as ${person.status}.`, facts: [{ kind: person.status === "deceased" ? "confirmed-casualty" : "missing-personnel", id: person.identity }], provenance: { kind: "returned-personnel-testimony", id: `${closureId}:person:${person.identity}` } }));
  for (const item of review?.equipment ?? []) if (["missing", "abandoned", "damaged"].includes(item.status)) derived.push(ingest(world, null, definition, { type: item.status === "damaged" ? "equipment-damage" : "equipment-loss", state: "confirmed", summary: `${item.label ?? "Issued equipment"} was reconciled as ${item.status}.`, facts: [{ kind: "equipment-outcome", id: item.id, state: item.status }], provenance: { kind: "recovered-equipment-record", id: `${closureId}:equipment:${item.id}` } }));
  for (const container of review?.containers ?? []) if (container.status === "lost") derived.push(ingest(world, null, definition, { type: "equipment-loss", state: "confirmed", summary: `${container.name ?? "Issued container"} and its recorded contents were reconciled as lost.`, facts: [{ kind: "container-outcome", id: container.id, state: container.status }], provenance: { kind: "recovered-equipment-record", id: `${closureId}:container:${container.id}` } }));
  if ((review?.evidence_outcome?.retained ?? 0) > (review?.evidence_outcome?.reported ?? 0)) derived.push(ingest(world, null, definition, { type: "evidence-withholding", state: "confirmed", summary: "Returned evidence was not reported during field operations.", facts: [{ kind: "evidence-outcome", id: "retained-unreported" }], provenance: { kind: "returned-evidence", id: `${closureId}:unreported-evidence` } }));
  for (const [index, deviation] of (review?.assignment?.deviations ?? []).entries()) derived.push(ingest(world, null, definition, { type: "unapproved-deviation", state: "confirmed", summary: String(deviation).replace(/-/g, " "), facts: [{ kind: "mission-deviation", id: String(deviation) }], provenance: { kind: "mission-closure", id: `${closureId}:deviation:${index}` } }));
  for (const fact of facts.filter((entry) => ["confirmed-casualty", "missing-personnel"].includes(entry.kind))) if (!state.unavailable_personnel.includes(fact.id)) state.unavailable_personnel.push(fact.id);
  return { ...ingested, derived };
}
function advance(world, definition, amount = 1) { const state = ensure(world, definition); if (!Number.isInteger(amount) || amount < 0) throw new Error("institutional time advance must be non-negative"); state.clock += amount; const due = state.pending_decisions.filter((item) => item.due_at <= state.clock).map((item) => resolveDecision(world, null, definition, item.id)); return due; }
function project(world, definition) { const state = ensure(world, definition); return { version: "yellow-beast-institutional-projection@v1", dimensions: clone(state.dimensions), restrictions: clone(state.restrictions), confirmed_knowledge: state.confirmed_knowledge.map(({ type, summary, confirmed_at }) => ({ type, summary, confirmed_at })), uncertainty: state.uncertain_claims.map(({ status, summary }) => ({ status, summary })), pending_reviews: state.pending_decisions.map(({ decision, due_at }) => ({ decision, due_at })), recent_decisions: state.decisions.slice(-5).map(({ decision, public_response, resolved_at }) => ({ decision, public_response, resolved_at })), follow_up_assignments: state.follow_up_assignments.map(({ id, display_name, public_summary, status }) => ({ id, display_name, public_summary, status })) };
}

module.exports = { DEFINITION_VERSION, STATE_VERSION, INPUT_TYPES, DECISIONS, DIMENSIONS, validateCondition, validateDefinition, createState, ensure, ingest, ingestDeliveredCommunications, ingestClosure, resolveDecision, handleEvent, advance, project };
