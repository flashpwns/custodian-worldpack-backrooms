"use strict";

const crypto = require("node:crypto");
const history = require("./world-history");

const VERSION = "yellow-beast-q4-trajectories@v1";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// These are bounded, conservative effects. None creates an entity, motive,
// pursuit, unsupported capability, or objective player-targeting behavior.
const CATALOG = Object.freeze([
  { id: "layout-divergence", label: "Layout divergence", compatible: ["layout-survey", "infrastructure-material", "personnel-recovery"], claims: ["async-identification-is-depicted-in-first-contact", "lighting-survey-depicts-protected-inspection"], gate: "layout-comparison", symptom: "The current observation does not reconcile with the available layout record.", evidence: "layout-comparison" },
  { id: "temporal-operational-inconsistency", label: "Temporal / operational inconsistency", compatible: ["layout-survey", "infrastructure-material", "personnel-recovery"], claims: ["motion-detected-states-alert-and-recording-behavior"], gate: "recorded-sequence", symptom: "The recorded sequence and the current operational timing do not reconcile.", evidence: "operational-record" },
  { id: "personnel-discontinuity", label: "Personnel discontinuity", compatible: ["personnel-recovery"], claims: ["async-identification-is-depicted-in-first-contact"], gate: "last-contact", symptom: "The available last-contact record does not establish the teammate's present location.", evidence: "personnel-contact-record" },
  { id: "evidence-inconsistency", label: "Evidence inconsistency", compatible: ["layout-survey", "infrastructure-material", "personnel-recovery"], claims: ["motion-detected-states-alert-and-recording-behavior", "damage-control-presents-recorded-surveillance-view"], gate: "record-review", symptom: "The field record does not fully reconcile with the direct observation.", evidence: "recording-comparison" },
  { id: "environmental-drift", label: "Environmental drift", compatible: ["layout-survey", "infrastructure-material"], claims: ["lighting-survey-depicts-protected-inspection"], gate: "revisit-or-measurement", symptom: "A documented environmental condition differs on the later observation.", evidence: "environmental-comparison" },
  { id: "access-threshold-instability", label: "Access / Threshold instability", compatible: ["layout-survey", "personnel-recovery"], claims: ["first-contact-depicts-staffed-threshold-apparatus", "lighting-survey-depicts-protected-inspection"], gate: "return-route-check", symptom: "The return relationship cannot be confirmed from the current route and records.", evidence: "route-record" }
]);
const INTENSITIES = Object.freeze(["QUIET", "SUBTLE", "SIGNIFICANT", "SEVERE"]);
const intensityFor = (value) => { const n = parseInt(digest(value).slice(0, 8), 16) % 100; return n < 55 ? "QUIET" : n < 85 ? "SUBTLE" : n < 97 ? "SIGNIFICANT" : "SEVERE"; };

function catalog() { return CATALOG.map(clone); }
function chooseFamily(mission, seed) {
  const eligible = CATALOG.filter((item) => item.compatible.includes(mission?.family));
  return eligible[parseInt(digest([mission?.id, seed, "trajectory-family"]).slice(0, 8), 16) % eligible.length] ?? CATALOG[0];
}
function attach(mission, { world = null, seed = "yellow-beast-q4" } = {}) {
  const family = chooseFamily(mission, seed);
  const hidden = { version: VERSION, id: `q4-trajectory-${digest([mission.id, seed, family.id]).slice(0, 16)}`, family: family.id, authority: { classification: "admitted-runtime-plus-conservative-connective-effect", source_claim_ids: [...family.claims], provenance: "bounded-q4-trajectory-catalog" }, mission_id: mission.id, intensity: intensityFor([world?.world_id, mission.id, seed]), latent_condition: { exists: true, state: "persistent-unresolved-condition" }, observability_gates: [{ id: family.gate, condition: `legitimate-${family.gate}-observation`, turn_count_is_sufficient: false }], possible_symptoms: [{ id: `${family.id}-symptom`, public_shape: family.symptom, evidence_type: family.evidence }], escalation_conditions: ["continued traversal or comparison after an observed inconsistency", "missed communication or loss of usable equipment where applicable", "team separation or crossing an affected boundary"], containment_conditions: ["early return", "maintaining team cohesion", "completing the assignment without further traversal", "restoring communication"], state: { status: "dormant", objective_exists: true, symptoms_observable: [], player_observed: [], player_recognized: false, teammate_observed: [], player_reported: [], standard_received: [], standard_assessment: [], terminal_states: [], evidence_ids: [], separation: null, escalation_history: [] }, terminal_states: ["dormant", "unresolved", "contained", "observed-but-unexplained", "reported", "mission-altering", "personnel-separation", "equipment-loss", "continuing-world-condition"] };
  const next = clone(mission); next.hidden_trajectory = hidden; return next;
}
function hidden(expedition) { return expedition?.mission?.hidden_trajectory ?? null; }
function compatible(mission, trajectory) { return Boolean(trajectory && CATALOG.some((item) => item.id === trajectory.family && item.compatible.includes(mission?.family))); }
function gateOpen(trajectory, { phase, verb, observation_kind, equipment_available = true, comparison = false } = {}) {
  if (!trajectory || phase !== "FIELD_OPERATION") return false;
  const gate = trajectory.observability_gates?.[0]?.id;
  if (gate === "layout-comparison") return comparison || ["INSPECT", "RECORD"].includes(verb);
  if (gate === "recorded-sequence") return observation_kind === "record" || verb === "RECORD";
  if (gate === "last-contact") return observation_kind === "contact" || verb === "COMMUNICATE";
  if (gate === "record-review") return observation_kind === "record" || verb === "RECORD";
  if (gate === "revisit-or-measurement") return comparison || verb === "RECORD" || (verb === "USE" && equipment_available);
  if (gate === "return-route-check") return verb === "MOVE" || verb === "RETURN";
  return false;
}
function resolveAction({ world = null, expedition, run_id = null, phase = null, verb = null, result = null, observation_kind = null, comparison = false } = {}) {
  const trajectory = hidden(expedition); if (!trajectory || !result?.ok || !gateOpen(trajectory, { phase, verb, observation_kind, comparison })) return { observed: false, summary: null };
  const state = trajectory.state; const intensity = trajectory.intensity;
  if (state.status === "contained") return { observed: false, summary: null };
  if (state.symptoms_observable.length) {
    if (["SIGNIFICANT", "SEVERE"].includes(intensity) && ["MOVE", "RECORD", "USE"].includes(verb) && !state.escalation_history.length) {
      state.escalation_history.push({ reason: "continued work after an observed inconsistency", intensity }); state.status = "mission-altering"; state.terminal_states.push("mission-altering"); if (world) history.event(world, run_id, "q4.trajectory.condition.escalated", { mission_id: trajectory.mission_id, basis: "continued-work-after-observation" }, trajectory.authority.classification); return { observed: true, summary: "The discrepancy persists as the work continues." };
    }
    return { observed: false, summary: null };
  }
  if (intensity === "QUIET") return { observed: false, summary: null };
  if (intensity === "SUBTLE" && verb !== "RECORD" && !comparison) return { observed: false, summary: null };
  const family = CATALOG.find((item) => item.id === trajectory.family); const symptom = { id: `${trajectory.id}-symptom-1`, family: family.id, text: family.symptom, evidence_type: family.evidence, observed_by: "player", recognized: false };
  state.symptoms_observable.push(symptom); state.player_observed.push(symptom.id); state.status = "observed-but-unexplained"; state.terminal_states.push("observed-but-unexplained"); state.evidence_ids.push(`${trajectory.id}-evidence-1`);
  if (world) history.event(world, run_id, "q4.trajectory.symptom.observed", { mission_id: trajectory.mission_id, symptom_id: symptom.id, evidence_type: symptom.evidence_type }, trajectory.authority.classification);
  return { observed: true, summary: symptom.text, symptom: clone(symptom) };
}
function noteCommunication({ world = null, expedition, run_id = null, channel, delivered = false, text = "" } = {}) {
  const trajectory = hidden(expedition); if (!trajectory) return { reported: false };
  const state = trajectory.state;
  if (channel === "local") { if (state.symptoms_observable.length) state.teammate_observed.push(...state.symptoms_observable.map((item) => ({ ...clone(item), informed_by: "local" }))); return { reported: false }; }
  if (channel === "standard" && delivered) { state.player_reported.push(text); state.standard_received.push(text); state.status = state.status === "dormant" ? "reported" : state.status; if (world) history.event(world, run_id, "q4.trajectory.report.received", { mission_id: trajectory.mission_id, report: text, status: "reported" }, trajectory.authority.classification); return { reported: true, status: "reported" }; }
  return { reported: false };
}
function separate({ world = null, expedition, run_id = null, category = "SEPARATED", reason = "route/state difference" } = {}) {
  const peer = expedition?.team?.members?.find((member) => member.personnel_id !== expedition.team.members[0]?.personnel_id); if (!peer) return { ok: false, code: "TEAM_MEMBER_UNKNOWN" };
  peer.contact_category = category; peer.last_contact = peer.last_contact ?? "last confirmed before separation"; peer.observed_condition = peer.observed_condition ?? "appears-normal"; const trajectory = hidden(expedition); if (trajectory) { trajectory.state.separation = { category, reason, holder: peer.personnel_id }; trajectory.state.status = "personnel-separation"; }
  if (world) history.event(world, run_id, "q4.team.separated", { mission_id: trajectory?.mission_id ?? null, personnel_id: peer.personnel_id, category, reason }, "admitted-runtime-plus-conservative-connective-effect");
  return { ok: true, peer: clone(peer), local_eligible: false };
}
function contain({ world = null, expedition, run_id = null, reason = "early return" } = {}) { const trajectory = hidden(expedition); if (!trajectory) return { ok: false, code: "TRAJECTORY_UNKNOWN" }; trajectory.state.status = "contained"; trajectory.state.terminal_states.push("contained"); if (world) history.event(world, run_id, "q4.trajectory.contained", { mission_id: trajectory.mission_id, reason }, trajectory.authority.classification); return { ok: true, status: trajectory.state.status }; }
function publicState(expedition) { const trajectory = hidden(expedition); if (!trajectory) return null; return { status: trajectory.state.status === "dormant" ? "No unusual condition is recorded." : "An unresolved observation is part of the field record.", reported: trajectory.state.player_reported.length > 0, separation: trajectory.state.separation ? { category: trajectory.state.separation.category, last_contact: "last confirmed contact" } : null }; }
function syncWorld(world, expedition) { const mission = expedition?.mission; if (world && mission?.id) { world.q4_missions ??= {}; if (world.q4_missions[mission.id]) world.q4_missions[mission.id] = clone(mission); } }
function assertNoUnsupported(trajectory) { if (!trajectory?.authority?.source_claim_ids?.length) throw new Error("trajectory authority missing"); if (/entity|creature|pursuit|motive|intent|attack|speech/i.test(JSON.stringify(trajectory))) throw new Error("unsupported trajectory capability"); return true; }
module.exports = { VERSION, CATALOG, INTENSITIES, catalog, attach, hidden, compatible, gateOpen, resolveAction, noteCommunication, separate, contain, publicState, syncWorld, assertNoUnsupported };
