"use strict";
const VERSION = "yellow-beast-phase@v1";
const DEFINITIONS = Object.freeze({
  "field-researcher": ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN", "DEBRIEF"],
  "async-command": ["START_OF_DAY", "INBOX_REVIEW", "ACTIVE_DESK", "INTERRUPTION", "DECISION", "FOLLOWUP"],
  "local-anomaly": ["HOME", "EVIDENCE_REVIEW", "PREPARATION", "EXCURSION", "RETURN", "COMPARISON"],
  lost: ["ENTRY", "WANDERING", "SIGNIFICANT_DISCOVERY", "RECOVERY_OR_CONTINUATION"]
});
const initial = (mode) => ({ "field-researcher": "BRIEFING", "async-command": "START_OF_DAY", "local-anomaly": "HOME", lost: "ENTRY" })[mode];
const surfaces = (mode, phase) => mode === "field-researcher" && phase === "BRIEFING" ? ["scene", "mission", "team", "action", "local", "standard"] : mode === "field-researcher" ? ["scene", "action", "local", "standard", "inventory", "radio"] : ["scene", "context", "input"];
function validate(mode, phase) { if (!DEFINITIONS[mode]) throw new Error("unknown mode phase definition"); if (!DEFINITIONS[mode].includes(phase)) throw new Error("unknown phase"); }
function createPhase({ mode, guided = true } = {}) { const phase_id = initial(mode); validate(mode, phase_id); return { version: VERSION, mode_id: mode, phase_id, phase_type: phase_id, phase_index: DEFINITIONS[mode].indexOf(phase_id), completion_state: "active", available_ui_surfaces: surfaces(mode, phase_id), presentation_profile: `${mode}:${phase_id.toLowerCase()}`, tutorial_context: { enabled: guided, completed: false, skipped: false, step_id: guided ? "introduction" : null }, history: [] }; }
function transition(phase, next, { reason = "application-transition", guard = true } = {}) { validate(phase.mode_id, next); if (!guard) return { ok: false, code: "PHASE_GUARD_REJECTED", phase }; const allowed = DEFINITIONS[phase.mode_id]; if (allowed.indexOf(next) < phase.phase_index && !["async-command", "local-anomaly"].includes(phase.mode_id)) return { ok: false, code: "INVALID_PHASE_TRANSITION", phase }; const updated = { ...phase, phase_id: next, phase_type: next, phase_index: allowed.indexOf(next), available_ui_surfaces: surfaces(phase.mode_id, next), presentation_profile: `${phase.mode_id}:${next.toLowerCase()}`, history: [...phase.history.slice(-15), { type: "phase_entered", phase_id: next, reason }] }; return { ok: true, phase: updated }; }
function skipGuidance(phase) { return { ...phase, tutorial_context: { ...phase.tutorial_context, enabled: false, skipped: true, step_id: null } }; }
module.exports = { VERSION, DEFINITIONS, createPhase, transition, skipGuidance, validate };
