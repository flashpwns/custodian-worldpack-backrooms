"use strict";
const phases = require("./mode-phases");
const VERSION = "yellow-beast-clear-q4-experience@v1";
const copy = {
  BRIEFING: "Clear-Q4 survey assignment: review the declared fixture survey, your team, and the reporting procedure. Confirm when you are ready to stage.",
  STAGING: "Your field kit and radio are ready. Operations is available for a check-in; you may inspect, prepare, or proceed.",
  FACILITY_TRANSIT: "The team is moving through the controlled facility toward the Threshold.",
  THRESHOLD: "The Threshold is ahead. You can proceed, wait, ask a question, or turn back; crossing remains your decision.",
  FIELD_OPERATION: "Continue the declared survey. Record what you actually observe and report only what you choose to transmit.",
  RETURN: "Return with the equipment and evidence that remain with the team.",
  DEBRIEF: "Review the expedition record. What you report remains distinct from what occurred and what you observed."
};
function presentation(run, phase) { const expedition = run.expedition; return { version: VERSION, phase: phase.phase_id, briefing: copy[phase.phase_id], mission: expedition?.order?.primary ?? null, restrictions: expedition?.order?.constraints ?? [], reporting: expedition?.order?.reporting ?? null, team: expedition?.team?.members.map(({ id, role, status }) => ({ name: id === "yb-field-peer-observer" ? "Ellis" : "You", role, status })) ?? [], equipment: Object.entries(expedition?.equipment ?? {}).map(([id, item]) => ({ label: id.replace(/-/g, " "), state: item.state, charges: item.charges })), radio: expedition?.messages?.slice(-1).map(({ intended_recipient, delivery_status }) => ({ recipient: intended_recipient === "Standard" ? "Operations" : "team", delivery_status })) ?? [] }; }
function nextPhase(phase, { action, canonical_crossed = false, returned = false } = {}) { const current = phase.phase_id; const table = { BRIEFING: "STAGING", STAGING: "FACILITY_TRANSIT", FACILITY_TRANSIT: "THRESHOLD", THRESHOLD: canonical_crossed ? "FIELD_OPERATION" : null, FIELD_OPERATION: returned ? "RETURN" : null, RETURN: returned ? "DEBRIEF" : null }; const next = table[current]; return next ? phases.transition(phase, next, { reason: action ?? "q4-gameflow", guard: true }) : { ok: false, code: "PHASE_GUARD_REJECTED", phase }; }
module.exports = { VERSION, presentation, nextPhase };
