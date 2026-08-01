"use strict";

const crypto = require("node:crypto");
const history = require("./world-history");
const humanWorld = require("./human-world");
const equipment = require("./q4-equipment");

const VERSION = "yellow-beast-q4-missions@v1";
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = (value) => structuredClone(value);

// The catalog is deliberately finite. Entries without an admitted/recorded
// trigger remain visible to authoring and audit tools but cannot be selected.
const CATALOG = Object.freeze([
  { id: "layout-survey", label: "Layout / Survey", authority: "admitted-runtime-plus-procedural-glue", claims: ["async-identification-is-depicted-in-first-contact", "lighting-survey-depicts-protected-inspection"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "infrastructure-material", label: "Infrastructure / Material", authority: "admitted-runtime-plus-procedural-glue", claims: ["lighting-survey-depicts-protected-inspection", "motion-detected-states-alert-and-recording-behavior"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "personnel-recovery", label: "Personnel / Recovery", authority: "recorded-world-history-only", claims: ["async-identification-is-depicted-in-first-contact"], eligible: "history" , required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "civilian-response", label: "Civilian / Wanderer Response", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "reported-phenomenon", label: "Reported Phenomenon Investigation", authority: "admitted-observation-only", claims: ["motion-detected-states-alert-and-recording-behavior"], eligible: "admission", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "hazard-aware", label: "Hazard-Aware Operation", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] }
]);

function actualEvents(world, types) { return (world?.events ?? []).filter((entry) => types.includes(entry.type)); }
function continuityContext(world) {
  const events = world?.events ?? [];
  const equipmentLoss = Object.values(world?.q4_equipment ?? {}).filter((item) => ["missing", "abandoned"].includes(item.state));
  const missing = Object.values(world?.characters ?? {}).filter((person) => person.status === "missing");
  const regions = Object.values(world?.knowledge?.institutional?.records ?? {}).filter((record) => record.id.startsWith("institutional-region-"));
  return { equipmentLoss, missing, regions, contactLoss: events.filter((event) => /contact|unresponsive/i.test(event.type)), reports: events.filter((event) => ["q4.communication.reported", "q4.report.filed"].includes(event.type)) };
}
function historyReferences(world) {
  const context = continuityContext(world);
  return [
    ...context.regions.map((record) => ({ id: record.id, kind: "prior-layout-record", status: "confirmed institutional record", text: "A prior institutional layout record is available for comparison." })),
    ...context.equipmentLoss.map((item) => ({ id: item.id, kind: "equipment-history", status: "confirmed equipment record", text: "An identified field item is recorded as unrecovered or abandoned." })),
    ...context.missing.map((person) => ({ id: person.identity, kind: "personnel-history", status: "personnel status is missing, not confirmed dead", text: `${person.display_name} is recorded as missing from an earlier assignment.` }))
  ];
}
function chooseFamily(world, seed) {
  const context = continuityContext(world);
  if (context.missing.length || context.equipmentLoss.length) return CATALOG.find((item) => item.id === "personnel-recovery");
  const eligible = CATALOG.filter((item) => item.eligible === true);
  return eligible[parseInt(digest([world?.world_id, seed, world?.next_run ?? 1]).slice(0, 8), 16) % eligible.length];
}
function missionId(world, family, seed) { return `CQ4-${family.id.toUpperCase().replace(/[^A-Z]+/g, "-")}-${String(world?.next_run ?? 1).padStart(3, "0")}-${digest([world?.world_id, seed, family.id]).slice(0, 4).toUpperCase()}`; }
function generate({ world = null, run_id = null, seed = "yellow-beast-q4", staffing = null } = {}) {
  const family = chooseFamily(world, seed);
  const prior = historyReferences(world);
  const continuity = prior.length ? "continuity assignment derived from recorded history" : "new institutional assignment with no prior-world dependency";
  const site = prior.length ? "the recorded survey boundary and associated field records" : "the declared survey boundary";
  const primary = family.id === "infrastructure-material" ? "Inspect and document the declared lighting and material conditions within the survey boundary." : family.id === "personnel-recovery" ? "Locate the missing team's last recorded site and recover identifying records or equipment where possible." : "Record the layout across the declared survey boundary and retain a field record for comparison.";
  const procedures = family.id === "infrastructure-material" ? ["Inspect accessible lighting and material features.", "Record observable conditions and measurements.", "Retain the field record for Standard."] : family.id === "personnel-recovery" ? ["Follow the last recorded route where access permits.", "Account for personnel, records, and equipment separately.", "Report confirmed observations without treating absence as death."] : ["Record the mapped and unmapped portions of the survey boundary.", "Compare observations with available prior layout records.", "Retain the field record and check in with Standard."];
  const mission = { version: VERSION, id: missionId(world, family, seed), assignment_authority: "ASYNC / Standard", family: family.id, family_label: family.label, authority: { classification: family.authority, source_claim_ids: [...family.claims], provenance: family.authority.includes("recorded") ? "world-history" : "admitted-runtime-and-procedural-glue" }, rationale: continuity === "new institutional assignment with no prior-world dependency" ? "ASYNC has assigned a bounded field record so the institution can maintain an observer-qualified account of the site." : "ASYNC has assigned a bounded follow-up to reconcile an existing institutional record.", site: { label: site, boundary: "survey boundary", knowledge_status: "institutional assignment; accessibility remains uncertain" }, objective: { primary, procedures, completion_criteria: ["The assigned boundary or recorded site has been addressed as far as access permits.", "Required observations, measurements, or recovery findings are recorded.", "A check-in and field record are delivered or the inability to deliver them is recorded."] }, assigned_personnel: (staffing?.player && staffing?.peer) ? [staffing.player.identity, staffing.peer.identity] : [], required_equipment: family.required, reporting: { check_ins: ["Confirm departure at the Threshold.", "Transmit a field check-in within the declared operational window.", "Confirm return or report an authorized abort."], evidence: ["Retain recordings, measurements, and written field notes where available."], abort_conditions: ["Return if personnel safety or equipment access prevents the assigned work."], summary: "Report observations and personnel accountability to Standard; a report remains an account, not objective truth." }, expected_duration: "within the declared operational window", risks: [{ text: "Access, lighting, equipment condition, and personnel contact may be uncertain.", knowledge_status: "known operational uncertainty" }], prior_history: prior, continuity, status: "assigned", run_id, generated_from: { seed, history_digest: digest([world?.world_id, prior]) } };
  return mission;
}
function catalog() { return CATALOG.map(clone); }
function validate(mission) { if (!mission?.id || !CATALOG.some((entry) => entry.id === mission.family)) throw new Error("Q4 mission is not cataloged"); if (!mission.objective?.primary || !mission.objective.completion_criteria?.length) throw new Error("Q4 mission lacks actionable objective or completion criteria"); if (/explore.*strange|anything strange|explore the complex/i.test(JSON.stringify(mission))) throw new Error("generic exploration mission rejected"); return true; }
function canReference(world, reference) { return historyReferences(world).some((item) => item.id === reference?.id && item.kind === reference.kind); }
module.exports = { VERSION, CATALOG, catalog, generate, validate, continuityContext, historyReferences, canReference };
