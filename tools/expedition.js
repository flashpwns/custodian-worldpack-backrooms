"use strict";

const clone = (value) => structuredClone(value);
const q4Equipment = require("./q4-equipment");
const personnelGeneration = require("./personnel-generation");
const FIELD_SCENARIO = "async-clear-q4-field-survey";

function fieldExpedition(player, staffing = null, loadout = null, mission = null, seed = "standalone-field-team", staffingRules = {}) {
  const playerPerson = staffing?.player ?? { identity: player, first_name: "Field", last_name: "Researcher", display_name: "Field Researcher", role: "field researcher", clearance: "field", condition: "normal", status: "active" };
  const generated = staffing ? null : personnelGeneration.generate({ seed, world_id: "standalone", player: playerPerson, staffing: staffingRules });
  const coworkers = staffing ? (staffing.coworkers ?? staffing.team?.filter((person) => person.identity !== playerPerson.identity) ?? [staffing.peer, staffing.assistant].filter(Boolean)) : generated.coworkers;
  const teamPeople = [playerPerson, ...coworkers].filter(Boolean);
  if (teamPeople.length < 3 || teamPeople.length > 5) throw new Error("field expedition staffing must contain three to five personnel");
  const assignedMission = mission ?? { id: "CQ4-LAYOUT-SURVEY-001", family: "layout-survey", family_label: "Layout / Survey", rationale: "ASYNC has assigned a bounded field record.", site: { label: "the declared survey boundary", boundary: "survey boundary" }, objective: { primary: "Record the layout across the declared survey boundary.", procedures: ["Record accessible layout and retain a field record."], completion_criteria: ["The assigned boundary is addressed and the field record is retained."] }, assigned_personnel: teamPeople.map((person) => person.identity), required_equipment: [...q4Equipment.REQUIRED], reporting: { summary: "Transmit a check-in and retain evidence." }, status: "assigned" };
  return {
    version: "yellow-beast-expedition@v3",
    id: "clear-q4-field-survey-alpha",
    title: "Clear-Q4 Field Survey Alpha",
    team: { id: "clear-q4-survey-team", generation: staffing?.generation ?? { version: personnelGeneration.VERSION, seed, total: teamPeople.length }, members: teamPeople.map((person) => ({ id: person.identity, personnel_id: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: person.display_name, role: person.role, clearance: person.clearance, status: "active", health: "uninjured", condition: "normal", contact_category: "NEARBY", observed_condition: "appears-normal", last_contact: "assigned" })) },
    mission: clone(assignedMission), mission_id: assignedMission.id,
    order: { issuer: "Standard", primary: assignedMission.objective.primary, constraints: assignedMission.objective.procedures, reporting: assignedMission.reporting.summary ?? "Transmit a check-in and retain evidence.", authority: "institutional-instruction-not-objective-truth" },
    equipment: loadout?.required ?? q4Equipment.expeditionEquipment(null, player),
    optional_stores: loadout?.optional ?? {},
    loadout: { required: [...(assignedMission.required_equipment ?? q4Equipment.REQUIRED)], optional: [...q4Equipment.OPTIONAL], phase: "BRIEFING" },
    clock: { interval: 0, check_in_due_at: null, check_in_overdue: false, check_in_missed: false, check_in_completed_at: null, communication_ticks: 0 },
    operational: { version: "yellow-beast-operational-time@v1", clock: { interval: 0, check_in_due_at: null, check_in_overdue: false, check_in_missed: false, check_in_completed_at: null, communication_ticks: 0 }, events: [], event_history: [], cycle_history: [], evaluation_revision: 0, consequences: [], consequence_revision: 0 },
    radio: { version: "yellow-beast-q4-radio@v1", state: "unavailable", check_completed: false, authorized: false, last_transition: "expedition-created", last_delivery: null },
    evidence: [], messages: [], interaction_history: [], deviations: [], history: [], outcome: null, result: null
  };
}
function event(expedition, kind, payload) { expedition.history.push({ sequence: expedition.history.length + 1, kind, payload: clone(payload) }); }
function equipment(expedition, id) { return expedition.equipment[id]; }
function useEquipment(expedition, id, holder = null) { return q4Equipment.use(expedition, id, holder ?? expedition.equipment[id]?.holder ?? null); }
function safeSummary(expedition) { return { id: expedition.id, mission_id: expedition.mission_id ?? expedition.mission?.id ?? expedition.id, title: expedition.title, team: expedition.team.members.map(({ id, role, status }) => ({ id, role, status })), objectives: Object.fromEntries(Object.entries(expedition.mission_state?.objectives ?? {}).map(([id, value]) => [id, { required: value.kind === "required", state: value.state }])), mission_lifecycle: expedition.mission_state?.lifecycle ?? null, return_readiness: clone(expedition.mission_state?.return ?? null), clock: clone(expedition.clock), equipment: Object.fromEntries(Object.entries(expedition.equipment).map(([id, value]) => [id, { state: value.state, charges: value.charges }])), evidence_count: expedition.evidence.length, message_count: expedition.messages.length, deviations: clone(expedition.deviations), outcome: expedition.outcome };
}
function finalize(expedition, decision, snapshot = {}) {
  // Compatibility-only procedural runs predate authored worldpack missions.  Keep
  // their terminal report condition-derived without recreating a second objective
  // state machine.  The desktop Clear-Q4 path always uses mission-runtime.
  const conditions = {
    survey_observed: snapshot.checklist?.inspected === true,
    survey_instrument_used: snapshot.checklist?.used === true,
    evidence_retained: expedition.evidence.some((item) => item.valid !== false && item.custodian),
    standard_contact: expedition.messages.some((item) => item.intended_recipient === "Standard" && item.delivery_status === "delivered")
  };
  const smooth = decision === "RETURN" && Object.values(conditions).every(Boolean);
  expedition.outcome = smooth ? "completed" : decision === "ABORT" ? "aborted" : "degraded";
  expedition.result = { version: "yellow-beast-expedition-result@v1", mission_id: expedition.mission.id, mission_title: expedition.title, outcome: expedition.outcome, conditions, objectives: {}, team: clone(expedition.team), evidence: clone(expedition.evidence), resources: clone(expedition.equipment), messages: clone(expedition.messages), deviations: clone(expedition.deviations), clock: clone(expedition.clock), unresolved_findings: smooth ? [] : ["The assigned field work remains incomplete or overdue."], simulation_authority: "legacy-procedural-compatibility-result" };
  event(expedition, "mission.finalized", { decision, outcome: expedition.outcome });
  return expedition.result;
}
module.exports = { FIELD_SCENARIO, fieldExpedition, event, equipment, useEquipment, safeSummary, finalize };
