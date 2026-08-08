"use strict";

// Canonical Clear-Q4 work-order authority. It reads persistent world and
// institutional state; renderer projections never participate in selection.
const crypto = require("node:crypto");
const spatialRuntime = require("./spatial-runtime");
const surveyFrontier = require("./survey-frontier");
const trajectories = require("./q4-trajectories");
const spatialDefinition = require("../data/worldpacks/clear-q4/spatial.json");
const definition = require("../data/worldpacks/clear-q4/assignments.json");

const VERSION = "yellow-beast-assignment-state@v1";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const archetypeById = Object.fromEntries(definition.archetypes.map((item) => [item.id, item]));
const locationIndex = (world) => Object.fromEntries(spatialRuntime.canonicalDefinition(world?.q4_geography, spatialDefinition).locations.map((item) => [item.id, item]));
const connectionIndex = (world) => Object.fromEntries(spatialRuntime.canonicalDefinition(world?.q4_geography, spatialDefinition).connections.map((item) => [item.id, item]));

function validateDefinition() {
  if (definition.version !== "yellow-beast-assignment-worldpack@v1" || definition.worldpack_id !== "clear-q4") throw new Error("unsupported assignment worldpack");
  const ids = definition.archetypes.map((item) => item.id);
  if (new Set(ids).size !== ids.length || definition.archetypes.some((item) => !item.id || !Number.isInteger(item.priority) || !item.required_equipment?.length)) throw new Error("invalid Clear-Q4 assignment archetype");
  return true;
}

function ensure(world) {
  if (!world?.world_id) throw new Error("assignment state requires a persistent world");
  world.q4_assignment_state ??= { version: VERSION, next_work_order: 1, conditions: {}, work_orders: {}, history: [] };
  const state = world.q4_assignment_state;
  if (state.version !== VERSION) throw new Error("unsupported assignment state version");
  state.next_work_order ??= 1; state.conditions ??= {}; state.work_orders ??= {}; state.history ??= [];
  return state;
}

function institutionalInputs(world, type) { return (world?.institutional_response?.input_history ?? []).filter((item) => item.type === type); }
function standardRecord(world) { return world?.q4_survey_frontier ? surveyFrontier.standardMap(world.q4_survey_frontier, spatialRuntime.canonicalDefinition(world.q4_geography, spatialDefinition)) : { nodes: [], edges: [] }; }
function knownEquipmentLoss(world, item) {
  return institutionalInputs(world, "equipment-loss").some((input) => (input.facts ?? []).some((fact) => fact.id === item.id || fact.id === item.source_item_id));
}
function sourceStatus(world, id) { return world?.q4_assignment_state?.conditions?.[id]?.status ?? "unassigned"; }
function activeFor(world, id) { return Object.values(world?.q4_assignment_state?.work_orders ?? {}).some((order) => order.source_condition?.id === id && order.status === "active"); }
function candidate(archetype, source, target, justification, extra = {}) {
  return { version: "yellow-beast-assignment-candidate@v1", archetype: archetype.id, source_condition: source, target, institutional_justification: justification, required_objective_type: extra.required_objective_type ?? archetype.condition, prerequisites: extra.prerequisites ?? [], disqualifiers: extra.disqualifiers ?? [], priority: archetype.priority, authorized_equipment: clone(archetype.required_equipment), reporting_requirement: "Report observed findings and personnel accountability to Standard.", return_guidance: "Return by the safest confirmed route if the recorded work cannot be completed.", selection_key: `${archetype.id}:${source.id}` };
}

function deriveConditions(world) {
  validateDefinition();
  const candidates = []; const locations = locationIndex(world); const connections = connectionIndex(world);
  const route = archetypeById["route-verification"];
  for (const edge of standardRecord(world).edges.filter((item) => item.status === "REPORTED")) {
    const connection = connections[edge.id]; if (!connection || world?.q4_geography?.blocked_paths?.[edge.id]) continue;
    const source = { id: `unconfirmed-route:${edge.id}`, type: "unconfirmed-route", status: sourceStatus(world, `unconfirmed-route:${edge.id}`), institutional_fact: { connection_id: edge.id, state: "REPORTED" } };
    if (source.status === "unassigned" && !activeFor(world, source.id)) candidates.push(candidate(route, source, { kind: "route", connection_id: edge.id, known_location_ids: [connection.from, connection.to].filter((id) => standardRecord(world).nodes.some((node) => node.id === id)) }, "Standard has a delivered but unconfirmed field report for this recorded route.", { required_objective_type: "corroborate-reported-route" }));
  }
  const recovery = archetypeById["equipment-recovery"];
  for (const item of Object.values(world?.q4_equipment ?? {}).filter((entry) => ["missing", "abandoned"].includes(entry.state) && entry.location && locations[entry.location] && knownEquipmentLoss(world, entry))) {
    const source = { id: `lost-equipment:${item.id}`, type: "lost-equipment", status: sourceStatus(world, `lost-equipment:${item.id}`), institutional_fact: { equipment_id: item.id, location: item.location, state: item.state } };
    if (source.status === "unassigned" && !activeFor(world, source.id)) candidates.push(candidate(recovery, source, { kind: "equipment", equipment_id: item.id, location_id: item.location, location_label: locations[item.location].name }, `Standard's returned equipment record identifies ${item.label ?? "issued equipment"} as unrecovered at a recorded location.`, { required_objective_type: "recover-recorded-equipment" }));
  }
  const layout = archetypeById["layout-verification"];
  for (const input of institutionalInputs(world, "contradictory-report")) {
    const target = definition.routine_targets.find((id) => locations[id]); if (!target) continue;
    const source = { id: `prior-record-discrepancy:${input.id}`, type: "prior-record-discrepancy", status: sourceStatus(world, `prior-record-discrepancy:${input.id}`), institutional_fact: { input_id: input.id } };
    if (source.status === "unassigned" && !activeFor(world, source.id)) candidates.push(candidate(layout, source, { kind: "known-area", location_id: target, location_label: locations[target].name }, "Standard has a recorded discrepancy that requires a bounded comparison against the next accessible field record.", { required_objective_type: "compare-institutional-record" }));
  }
  const routine = archetypeById["routine-survey"]; const target = definition.routine_targets.find((id) => locations[id]);
  const period = world?.q4_operations?.institutional_time ?? Object.values(world?.q4_missions ?? {}).filter((mission) => mission.status === "completed").length;
  if (target) {
    const source = { id: `routine-frontier:${period}:${target}`, type: "routine-frontier", status: sourceStatus(world, `routine-frontier:${period}:${target}`), institutional_fact: { location_id: target, basis: "declared institutional survey boundary" } };
    if (source.status === "unassigned" && !activeFor(world, source.id)) candidates.push(candidate(routine, source, { kind: "known-area", location_id: target, location_label: locations[target].name }, "The declared Survey Frontier requires an ordinary bounded field record from the fixed Threshold approach.", { required_objective_type: "survey-established-frontier" }));
  }
  return candidates.sort((a, b) => b.priority - a.priority || a.selection_key.localeCompare(b.selection_key));
}

function validateCandidate(world, item) {
  const locations = locationIndex(world); const connections = connectionIndex(world); const source = item?.source_condition;
  if (!item || sourceStatus(world, source?.id) !== "unassigned" || activeFor(world, source?.id) || !archetypeById[item.archetype]) return false;
  if (source.type === "lost-equipment") { const equipment = world?.q4_equipment?.[item.target?.equipment_id]; return Boolean(equipment && ["missing", "abandoned"].includes(equipment.state) && equipment.location === item.target.location_id && locations[equipment.location] && knownEquipmentLoss(world, equipment)); }
  if (source.type === "unconfirmed-route") return Boolean(connections[item.target?.connection_id] && !world?.q4_geography?.blocked_paths?.[item.target.connection_id] && standardRecord(world).edges.some((edge) => edge.id === item.target.connection_id && edge.status === "REPORTED"));
  if (source.type === "prior-record-discrepancy") return institutionalInputs(world, "contradictory-report").some((input) => input.id === source.institutional_fact.input_id) && Boolean(locations[item.target?.location_id]);
  return source.type === "routine-frontier" && Boolean(locations[item.target?.location_id]);
}

function select(candidates, selection_context = "default") {
  const eligible = candidates.filter(Boolean); if (!eligible.length) return null;
  const priority = Math.max(...eligible.map((item) => item.priority)); const pool = eligible.filter((item) => item.priority === priority).sort((a, b) => a.selection_key.localeCompare(b.selection_key));
  return clone(pool[parseInt(digest([selection_context, pool.map((item) => item.selection_key)]).slice(0, 8), 16) % pool.length]);
}
function phrase(candidate) {
  if (candidate.archetype === "equipment-recovery") return `Recover the identified equipment if its recorded location remains accessible.`;
  if (candidate.archetype === "route-verification") return "Reverify the reported route and distinguish confirmed access from an unresolved field account.";
  if (candidate.archetype === "layout-verification") return "Compare the current observed layout with the institutional record and report only what is re-established.";
  return "Survey the declared frontier from the fixed Threshold approach and retain an accountable field record.";
}
function instantiate(state, candidate, { run_id = null, seed = "default", staffing = null } = {}) {
  const id = `CQ4-WO-${String(state.next_work_order++).padStart(4, "0")}`;
  const work = { version: "yellow-beast-work-order@v1", id, display_id: id, status: "active", archetype: candidate.archetype, family: candidate.archetype, family_label: archetypeById[candidate.archetype].label, source_condition: clone(candidate.source_condition), target: clone(candidate.target), institutional_justification: candidate.institutional_justification, authorized_equipment: clone(candidate.authorized_equipment), reporting_requirement: candidate.reporting_requirement, return_guidance: candidate.return_guidance, selection: { seed, key: candidate.selection_key }, assigned_personnel: staffing?.team?.map((person) => person.identity) ?? [], run_id };
  state.conditions[candidate.source_condition.id] = { ...clone(candidate.source_condition), status: "assigned", assigned_work_order_id: id };
  state.work_orders[id] = work; state.history.push({ type: "issued", id, source_condition: candidate.source_condition.id });
  return work;
}
function missionFromWorkOrder(work, { staffing = null, world = null } = {}) {
  const mission = { version: "yellow-beast-q4-missions@v2", id: work.id, display_id: work.display_id, assignment_authority: "ASYNC / Standard", family: work.family, family_label: work.family_label, work_order_id: work.id, source_condition: clone(work.source_condition), authority: { classification: "state-derived-institutional-work-order", source_claim_ids: [work.source_condition.id], provenance: "canonical-world-and-institutional-state" }, rationale: work.institutional_justification, site: clone(work.target), objective: { primary: phrase(work), procedures: ["Use only confirmed routes and recorded locations.", "Record the condition actually observed at the assigned target.", "Deliver a field report or record why delivery was unavailable."], completion_criteria: ["Address the recorded work where access permits.", "Retain an accountable observation or recovery record.", "Return or record an authorized abort."] }, assigned_personnel: work.assigned_personnel.length ? clone(work.assigned_personnel) : staffing?.team?.map((person) => person.identity) ?? [], required_equipment: clone(work.authorized_equipment), reporting: { check_ins: ["Confirm departure at the Threshold.", "Transmit a field check-in within the declared operational window.", "Confirm return or report an authorized abort."], evidence: ["Retain recordings, measurements, and written field notes where available."], abort_conditions: [work.return_guidance], summary: work.reporting_requirement }, expected_duration: "within the declared operational window", risks: [{ text: "Access, equipment condition, and personnel contact may remain uncertain.", knowledge_status: "known operational uncertainty" }], prior_history: [{ id: work.source_condition.id, kind: "work-producing-condition", status: "institutionally recorded", text: work.institutional_justification }], continuity: "state-derived institutional work order", status: "assigned", run_id: work.run_id, generated_from: { seed: work.selection.seed, work_order_id: work.id } };
  const trajectoryFamily = work.family === "routine-survey" ? "infrastructure-material" : work.family;
  return { ...mission, hidden_trajectory: trajectories.attach({ ...mission, family: trajectoryFamily }, { world, seed: work.selection.seed }).hidden_trajectory };
}
function issue(world, options = {}) {
  const state = ensure(world); const candidates = deriveConditions(world); let chosen = select(candidates, options.selection_context ?? options.seed ?? "default");
  if (typeof options.before_commit === "function") options.before_commit(world, clone(chosen));
  if (!chosen || !validateCandidate(world, chosen)) chosen = select(deriveConditions(world).filter((item) => validateCandidate(world, item)), options.selection_context ?? options.seed ?? "default");
  if (!chosen) {
    const active = Object.values(state.work_orders).find((item) => item.status === "active");
    if (active) {
      const restaffed = { ...active, assigned_personnel: options.staffing?.team?.map((person) => person.identity) ?? active.assigned_personnel };
      return { ok: true, reused: true, work_order: clone(active), mission: missionFromWorkOrder(restaffed, { ...options, world }), candidates: clone(candidates) };
    }
    return { ok: false, code: "NO_ACTIONABLE_WORK" };
  }
  const work_order = instantiate(state, chosen, options); return { ok: true, work_order: clone(work_order), mission: missionFromWorkOrder(work_order, { ...options, world }), candidates: clone(candidates) };
}
function resolve(world, workOrderId, outcome = {}) {
  const state = ensure(world); const work = state.work_orders[workOrderId]; if (!work || work.status !== "active") return { ok: false, code: "WORK_ORDER_UNAVAILABLE" };
  const source = state.conditions[work.source_condition.id]; let resolved = outcome.resolved === true;
  if (work.source_condition.type === "lost-equipment") { const item = world?.q4_equipment?.[work.target.equipment_id]; resolved ||= Boolean(item && !["missing", "abandoned"].includes(item.state)); }
  if (work.source_condition.type === "unconfirmed-route") resolved ||= standardRecord(world).edges.some((edge) => edge.id === work.target.connection_id && edge.status === "CONFIRMED");
  if (work.source_condition.type === "routine-frontier") resolved ||= outcome.completed === true;
  if (work.source_condition.type === "prior-record-discrepancy") resolved ||= outcome.completed === true;
  work.status = resolved ? "completed" : (outcome.aborted ? "aborted" : "unresolved"); source.status = resolved ? "resolved" : "unassigned"; source.resolved_by = resolved ? work.id : null; state.history.push({ type: work.status, id: work.id, source_condition: source.id }); return { ok: true, resolved, work_order: clone(work) };
}
function projection(world, workOrderId) { const work = world?.q4_assignment_state?.work_orders?.[workOrderId]; return work ? { id: work.display_id, archetype: work.family_label, target: clone(work.target), justification: work.institutional_justification, status: work.status } : null; }

module.exports = { VERSION, definition, validateDefinition, ensure, deriveConditions, validateCandidate, select, issue, resolve, missionFromWorkOrder, projection, supportedArchetypes: () => definition.archetypes.map(clone) };
