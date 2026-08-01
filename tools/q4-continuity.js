"use strict";

const crypto = require("node:crypto");
const history = require("./world-history");

const VERSION = "yellow-beast-q4-continuity@v1";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function canReturn(run) {
  const expedition = run?.expedition;
  if (!expedition) return false;
  if (run.return_state?.route_access === false) return false;
  if (expedition.team?.members?.some((member) => ["SEPARATED", "REMOTE", "CONTACT LOST", "UNKNOWN"].includes(member.contact_category))) return false;
  return Boolean(run.checklist?.moved || run.return_state?.orientation_confirmed);
}
function setReturnState(run, patch) { run.return_state = { route_access: true, orientation_confirmed: Boolean(run.checklist?.moved), threshold_access: Boolean(run.checklist?.moved), status: "return-available", ...clone(run.return_state ?? {}), ...clone(patch) }; return run.return_state; }
function personnelDisposition(run, outcome, world = null) {
  return (run.expedition?.team?.members ?? []).map((member) => { const canonical = history.character(world, member.personnel_id ?? member.id); const status = canonical?.status ?? member.status; return { identity: member.personnel_id ?? member.id, display_name: member.display_name, role: member.role, status: status === "dead" ? "deceased" : status === "missing" ? "missing" : ["SEPARATED", "REMOTE", "CONTACT LOST", "UNKNOWN"].includes(member.contact_category) ? member.contact_category.toLowerCase().replace(" ", "-") : outcome.startsWith("returned") ? "returned" : "unknown", last_contact: member.last_contact ?? null, provenance: "Q4 team status and canonical run history" }; });
}
function equipmentDisposition(run, outcome) {
  return Object.values(run.expedition?.equipment ?? {}).map((item) => { let status = item.state === "damaged" ? "damaged" : item.state === "depleted" ? "depleted" : item.state === "abandoned" ? "abandoned" : item.state === "missing" ? "missing" : outcome.startsWith("returned") && item.holder === run.session?.startup?.player?.observer_id ? "returned" : item.holder ? "carried-by-personnel" : "unknown"; return { id: item.id, label: item.label, status, holder: item.holder, location: item.location, origin_run: run.run_id, provenance: "persistent Q4 equipment record" }; });
}
function scars(run, outcome) {
  const expedition = run.expedition; const result = expedition?.result ?? {}; const entries = [];
  for (const evidence of result.evidence ?? []) entries.push({ id: `scar-evidence-${evidence.id}`, kind: "recorded-evidence", origin_event: "evidence.recorded", origin_run: run.run_id, originating_actor: evidence.creator, location: evidence.location ?? null, persistence: "archived-if-returned", discovery: "institutional-only-after-return-or-recovery", provenance: evidence.provenance ?? "observer-safe-record" });
  for (const item of equipmentDisposition(run, outcome).filter((item) => ["abandoned", "missing", "damaged", "carried-by-personnel"].includes(item.status))) entries.push({ id: `scar-equipment-${item.id}`, kind: "equipment-status", origin_event: "q4.equipment.status", origin_run: run.run_id, originating_actor: item.holder, location: item.location, persistence: item.status, discovery: "location-or-contact-bound", provenance: item.provenance });
  return entries;
}
function classify(run, decision) {
  if (decision === "RETURN") return canReturn(run) ? (run.expedition.objectives.return_decision.state === "satisfied" && Object.values(run.expedition.objectives).filter((item) => item.required).every((item) => item.state === "satisfied") ? "returned" : "returned-incomplete") : "failed-return";
  if (decision === "ABORT") return canReturn(run) ? "returned-incomplete" : "stranded";
  return "continuing-in-field";
}
function commitOutcome(world, run, decision) {
  history.assertWorld(world); const existingId = run.expedition.mission?.id ?? run.expedition.id; if (world.q4_reviews?.[existingId]) return { outcome: world.q4_reviews[existingId].outcome, review: clone(world.q4_reviews[existingId]), scars: Object.values(world.q4_scars ?? {}).filter((scar) => scar.origin_run === run.run_id).map(clone) }; const outcome = classify(run, decision); const personnel = personnelDisposition(run, outcome, world); const equipment = equipmentDisposition(run, outcome); const scarList = scars(run, outcome); const result = run.expedition.result ?? {};
  const review = { version: VERSION, mission_id: run.expedition.mission?.id ?? run.expedition.id, outcome, assignment: { objective: run.expedition.mission?.objective?.primary ?? run.expedition.order?.primary, completion_status: outcome === "returned" ? "complete" : "incomplete", deviations: clone(run.expedition.deviations ?? []) }, personnel, equipment, communications: { required_check_ins: run.expedition.mission?.reporting?.check_ins ?? [], delivered: (run.expedition.messages ?? []).filter((message) => message.delivery_status === "delivered"), missed: run.expedition.clock?.check_in_overdue ? ["declared check-in"] : [] }, evidence: clone(result.evidence ?? []), institutional_findings: { reported: (run.expedition.interaction_history ?? []).filter((item) => item.channel === "standard" && item.delivery === "delivered").map((item) => ({ text: item.player_text, status: "reported", provenance: item.id })), unresolved: run.expedition.mission?.hidden_trajectory?.state?.status === "observed-but-unexplained" ? ["An observed field inconsistency remains unresolved."] : [], recommendations: scarList.length ? ["Review the recorded personnel, equipment, and evidence status before the next assignment."] : [] }, knowledge_scope: { player: "recorded field history and personal observations", standard: "delivered reports and returned evidence only", objective: "canonical run/equipment/personnel records" }, provenance: "canonical Q4 run history" };
  world.q4_reviews ??= {}; world.q4_reviews[review.mission_id] = clone(review); world.q4_scars ??= {}; for (const scar of scarList) world.q4_scars[scar.id] = clone(scar); world.q4_knowledge ??= {}; for (const report of review.institutional_findings.reported) world.q4_knowledge[`report-${digest([review.mission_id, report.text])}`] = { claim: report.text, status: "uncorroborated report", provenance: report.provenance, source_run: run.run_id }; if (outcome.startsWith("returned")) for (const evidence of review.evidence) world.q4_knowledge[`evidence-${evidence.id}`] = { claim: `Returned ${evidence.type ?? "field evidence"}`, status: "confirmed returned material", provenance: evidence.provenance ?? "returned-evidence", source_run: run.run_id }; world.q4_operations ??= { institutional_time: 0, last_review: null }; world.q4_operations.last_review = review.mission_id; world.q4_operations.institutional_time += outcome === "returned" ? 1 : 2;
  history.event(world, run.run_id, "q4.expedition.concluded", { mission_id: review.mission_id, outcome, review_id: review.mission_id, personnel_count: personnel.length, equipment_count: equipment.length }, "q4-canonical-continuity");
  for (const scar of scarList) history.event(world, run.run_id, "q4.scar.persisted", { scar_id: scar.id, kind: scar.kind, origin_run: scar.origin_run, location: scar.location }, "q4-canonical-continuity");
  result.continuity = { outcome, review_id: review.mission_id, personnel: clone(personnel), equipment: clone(equipment), scars: clone(scarList) }; return { outcome, review: clone(review), scars: clone(scarList) };
}
function review(world, mission_id) { return clone(world?.q4_reviews?.[mission_id] ?? null); }
function advanceOperations(world) { history.assertWorld(world); world.q4_operations ??= { institutional_time: 0, last_review: null }; world.q4_operations.institutional_time += 1; history.event(world, "operations", "q4.operations.advanced", { institutional_time: world.q4_operations.institutional_time }, "q4-canonical-continuity"); return clone(world.q4_operations); }
function validScar(world, scar) { return Boolean(scar && world?.q4_scars?.[scar.id] && world.q4_scars[scar.id].origin_run === scar.origin_run); }
function nextSeed(world, priorMission) { return `q4-follow-up-${digest([world.world_id, priorMission, world.q4_operations?.institutional_time ?? 0]).slice(0, 16)}`; }
module.exports = { VERSION, canReturn, setReturnState, classify, personnelDisposition, equipmentDisposition, scars, commitOutcome, review, advanceOperations, validScar, nextSeed };
