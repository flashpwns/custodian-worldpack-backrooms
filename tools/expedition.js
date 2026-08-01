"use strict";

const clone = (value) => structuredClone(value);
const q4Equipment = require("./q4-equipment");
const FIELD_SCENARIO = "async-clear-q4-field-survey";

function fieldExpedition(player, staffing = null, loadout = null, mission = null) {
  const playerPerson = staffing?.player ?? { identity: player, first_name: "Alex", last_name: "Morgan", display_name: "Alex Morgan", role: "field surveyor", clearance: "field", condition: "normal", status: "active" };
  const peerPerson = staffing?.peer ?? { identity: "yb-field-peer-observer", first_name: "Nora", last_name: "Vale", display_name: "Nora Vale", role: "survey technician", clearance: "field", condition: "normal", status: "active" };
  const assistantPerson = staffing ? staffing.assistant : { identity: "yb-field-alex-morgan", first_name: "Alex", last_name: "Morgan", display_name: "Alex Morgan", role: "field surveyor", clearance: "field", condition: "normal", status: "active" };
  const assignedMission = mission ?? { id: "CQ4-LAYOUT-SURVEY-001", family: "layout-survey", family_label: "Layout / Survey", rationale: "ASYNC has assigned a bounded field record.", site: { label: "the declared survey boundary", boundary: "survey boundary" }, objective: { primary: "Record the layout across the declared survey boundary.", procedures: ["Record accessible layout and retain a field record."], completion_criteria: ["The assigned boundary is addressed and the field record is retained."] }, assigned_personnel: [playerPerson.identity, peerPerson.identity, assistantPerson.identity], required_equipment: [...q4Equipment.REQUIRED], reporting: { summary: "Transmit a check-in and retain evidence." }, status: "assigned" };
  return {
    version: "yellow-beast-expedition@v1",
    id: "clear-q4-field-survey-alpha",
    title: "Clear-Q4 Field Survey Alpha",
    team: { id: "clear-q4-survey-team", members: [playerPerson, peerPerson, assistantPerson].filter(Boolean).map((person) => ({ id: person.identity, personnel_id: person.identity, first_name: person.first_name, last_name: person.last_name, display_name: person.display_name, role: person.role, clearance: person.clearance, status: "active", contact_category: "NEARBY", observed_condition: "appears-normal", last_contact: "assigned" })) },
    mission: clone(assignedMission), mission_id: assignedMission.id,
    order: { issuer: "Standard", primary: assignedMission.objective.primary, constraints: assignedMission.objective.procedures, reporting: assignedMission.reporting.summary ?? "Transmit a check-in and retain evidence.", authority: "institutional-instruction-not-objective-truth" },
    objectives: {
      survey: { required: true, state: "active" }, evidence: { required: true, state: "pending" }, check_in: { required: true, state: "pending" }, return_decision: { required: true, state: "pending" }, optional_peer_status: { required: false, state: "pending" }
    },
    equipment: loadout?.required ?? q4Equipment.expeditionEquipment(null, player),
    optional_stores: loadout?.optional ?? {},
    loadout: { required: [...(assignedMission.required_equipment ?? q4Equipment.REQUIRED)], optional: [...q4Equipment.OPTIONAL], phase: "BRIEFING" },
    clock: { interval: 0, check_in_due_at: 2, check_in_overdue: false, communication_ticks: 0 },
    evidence: [], messages: [], interaction_history: [], deviations: [], history: [], outcome: null, result: null
  };
}
function event(expedition, kind, payload) { expedition.history.push({ sequence: expedition.history.length + 1, kind, payload: clone(payload) }); }
function equipment(expedition, id) { return expedition.equipment[id]; }
function useEquipment(expedition, id, holder = null) { return q4Equipment.use(expedition, id, holder ?? expedition.equipment[id]?.holder ?? null); }
function safeSummary(expedition) { return { id: expedition.id, mission_id: expedition.mission_id ?? expedition.mission?.id ?? expedition.id, title: expedition.title, team: expedition.team.members.map(({ id, role, status }) => ({ id, role, status })), objectives: Object.fromEntries(Object.entries(expedition.objectives).map(([id, value]) => [id, { required: value.required, state: value.state }])), clock: clone(expedition.clock), equipment: Object.fromEntries(Object.entries(expedition.equipment).map(([id, value]) => [id, { state: value.state, charges: value.charges }])), evidence_count: expedition.evidence.length, message_count: expedition.messages.length, deviations: clone(expedition.deviations), outcome: expedition.outcome };
}
function finalize(expedition, decision) {
  expedition.objectives.return_decision.state = decision === "RETURN" ? "satisfied" : "abandoned";
  const required = Object.values(expedition.objectives).filter((objective) => objective.required);
  const smooth = decision === "RETURN" && required.every((objective) => objective.state === "satisfied");
  expedition.outcome = smooth ? "completed" : decision === "ABORT" ? "aborted" : "degraded";
  expedition.mission.status = expedition.outcome === "completed" ? "completed" : decision === "ABORT" ? "aborted" : "incomplete";
  expedition.result = { version: "yellow-beast-expedition-result@v1", mission_id: expedition.mission.id, mission_title: expedition.title, outcome: expedition.outcome, objectives: clone(expedition.objectives), team: clone(expedition.team), evidence: clone(expedition.evidence), resources: clone(expedition.equipment), messages: clone(expedition.messages), deviations: clone(expedition.deviations), clock: clone(expedition.clock), unresolved_findings: smooth ? [] : ["The assigned field work remains incomplete or overdue."], simulation_authority: "pack-original-expedition-result" };
  event(expedition, "mission.finalized", { decision, outcome: expedition.outcome });
  return expedition.result;
}
module.exports = { FIELD_SCENARIO, fieldExpedition, event, equipment, useEquipment, safeSummary, finalize };
