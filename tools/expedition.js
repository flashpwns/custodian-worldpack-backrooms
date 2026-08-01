"use strict";

const clone = (value) => structuredClone(value);
const FIELD_SCENARIO = "async-clear-q4-field-survey";

function fieldExpedition(player) {
  return {
    version: "yellow-beast-expedition@v1",
    id: "clear-q4-field-survey-alpha",
    title: "Clear-Q4 Field Survey Alpha",
    team: { id: "clear-q4-survey-team", members: [{ id: player, role: "field-surveyor", status: "active" }, { id: "yb-field-peer-observer", role: "survey-partner", status: "active" }] },
    order: { issuer: "Standard", primary: "Survey the declared fixture cluster and return with a field record.", constraints: ["Use declared equipment only.", "Check in before the second waiting interval."], reporting: "Transmit a check-in and retain evidence.", authority: "institutional-instruction-not-objective-truth" },
    objectives: {
      survey: { required: true, state: "active" }, evidence: { required: true, state: "pending" }, check_in: { required: true, state: "pending" }, return_decision: { required: true, state: "pending" }, optional_peer_status: { required: false, state: "pending" }
    },
    equipment: {
      "field-light": { custodian: player, state: "usable", charges: 1, used: 0 },
      "recording-device": { custodian: player, state: "usable", charges: 2, used: 0 },
      "survey-instrument": { custodian: player, state: "usable", charges: 1, used: 0 },
      "survey-radio": { custodian: player, state: "usable", charges: 2, used: 0 }
    },
    clock: { interval: 0, check_in_due_at: 2, check_in_overdue: false, communication_ticks: 0 },
    evidence: [], messages: [], interaction_history: [], deviations: [], history: [], outcome: null, result: null
  };
}
function event(expedition, kind, payload) { expedition.history.push({ sequence: expedition.history.length + 1, kind, payload: clone(payload) }); }
function equipment(expedition, id) { return expedition.equipment[id]; }
function useEquipment(expedition, id) { const item = equipment(expedition, id); if (!item || item.state !== "usable" || item.charges <= 0) return { ok: false, code: "EQUIPMENT_UNAVAILABLE" }; item.charges -= 1; item.used += 1; return { ok: true, item }; }
function safeSummary(expedition) { return { id: expedition.id, title: expedition.title, team: expedition.team.members.map(({ id, role, status }) => ({ id, role, status })), objectives: Object.fromEntries(Object.entries(expedition.objectives).map(([id, value]) => [id, { required: value.required, state: value.state }])), clock: clone(expedition.clock), equipment: Object.fromEntries(Object.entries(expedition.equipment).map(([id, value]) => [id, { state: value.state, charges: value.charges }])), evidence_count: expedition.evidence.length, message_count: expedition.messages.length, deviations: clone(expedition.deviations), outcome: expedition.outcome };
}
function finalize(expedition, decision) {
  expedition.objectives.return_decision.state = decision === "RETURN" ? "satisfied" : "abandoned";
  const required = Object.values(expedition.objectives).filter((objective) => objective.required);
  const smooth = decision === "RETURN" && required.every((objective) => objective.state === "satisfied");
  expedition.outcome = smooth ? "completed" : decision === "ABORT" ? "aborted" : "degraded";
  expedition.result = { version: "yellow-beast-expedition-result@v1", mission_id: expedition.id, mission_title: expedition.title, outcome: expedition.outcome, objectives: clone(expedition.objectives), team: clone(expedition.team), evidence: clone(expedition.evidence), resources: clone(expedition.equipment), messages: clone(expedition.messages), deviations: clone(expedition.deviations), clock: clone(expedition.clock), unresolved_findings: smooth ? [] : ["Declared survey outcome remains incomplete or overdue."], simulation_authority: "pack-original-expedition-result" };
  event(expedition, "mission.finalized", { decision, outcome: expedition.outcome });
  return expedition.result;
}
module.exports = { FIELD_SCENARIO, fieldExpedition, event, equipment, useEquipment, safeSummary, finalize };
