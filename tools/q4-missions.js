"use strict";

const crypto = require("node:crypto");
const history = require("./world-history");
const humanWorld = require("./human-world");
const equipment = require("./q4-equipment");
const trajectories = require("./q4-trajectories");

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
  { id: "hazard-aware", label: "Hazard-Aware Operation", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "layout-extension", label: "Layout Extension", authority: "admitted-runtime-plus-procedural-glue", claims: ["lighting-survey-depicts-protected-inspection"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "layout-comparison", label: "Layout Comparison", authority: "admitted-runtime-plus-procedural-glue", claims: ["async-identification-is-depicted-in-first-contact"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "layout-shift-verification", label: "Layout-Shift Verification", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "route-marker-audit", label: "Route-Marker Audit", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "lighting-material-survey", label: "Lighting / Material Survey", authority: "admitted-runtime-plus-procedural-glue", claims: ["lighting-survey-depicts-protected-inspection"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "equipment-recovery", label: "Equipment Recovery", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "outpost-inspection", label: "Outpost Inspection", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "contact-loss-investigation", label: "Contact-Loss Investigation", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "missing-person-search", label: "Missing-Person Search", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "prior-site-revisit", label: "Prior-Site Revisit", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "recovered-media-follow-up", label: "Recovered-Media Follow-Up", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "radio-dead-zone-verification", label: "Radio Dead-Zone Verification", authority: "recorded-world-history-only", claims: [], eligible: "history", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "environmental-discrepancy", label: "Environmental Discrepancy Documentation", authority: "admitted-observation-only", claims: ["lighting-survey-depicts-protected-inspection"], eligible: "admission", required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] },
  { id: "threshold-access-confirmation", label: "Threshold-Access Confirmation", authority: "admitted-runtime-plus-procedural-glue", claims: ["first-contact-depicts-staffed-threshold-apparatus"], eligible: true, required: ["field-light", "recording-device", "survey-instrument", "survey-radio"] }
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
  if (context.missing.length) return CATALOG.find((item) => item.id === "personnel-recovery");
  if (context.equipmentLoss.length && !context.regions.length) return CATALOG.find((item) => item.id === "equipment-recovery");
  const historyEligible = CATALOG.filter((item) => item.eligible === "history" && (context.missing.length || context.equipmentLoss.length || context.regions.length || context.reports.length || Object.keys(world?.q4_missions ?? {}).length));
  const admissionEligible = CATALOG.filter((item) => item.eligible === true || (item.eligible === "admission" && context.reports.length));
  const pool = [...admissionEligible, ...historyEligible];
  const recent = Object.values(world?.q4_missions ?? {}).slice(-4).map((mission) => mission.family);
  const alternatives = pool.filter((item) => !recent.includes(item.id));
  const eligible = alternatives.length ? alternatives : pool;
  return eligible[parseInt(digest([world?.world_id, seed, world?.next_run ?? 1]).slice(0, 8), 16) % Math.max(1, eligible.length)] ?? CATALOG[0];
}
function siteFor(world, family, seed) {
  const regions = Object.values(world?.regions ?? {}).sort((a, b) => a.id.localeCompare(b.id));
  const region = regions.length ? regions[parseInt(digest([seed, family.id]).slice(0, 8), 16) % regions.length] : null;
  if (region) return { label: `recorded survey site ${region.id}`, boundary: region.id, knowledge_status: "institutional record; current accessibility remains uncertain", region_id: region.id };
  return { label: family.id.includes("threshold") ? "the recorded Threshold access procedure" : "the declared survey boundary", boundary: "survey boundary", knowledge_status: "institutional assignment; accessibility remains uncertain" };
}
function shapeForFamily(family, site) {
  const shapes = {
    "layout-extension": ["Extend the recorded layout through the next accessible survey boundary.", ["Follow the last confirmed route.", "Record newly observed spaces and connections.", "Retain the field record for comparison."]],
    "layout-comparison": ["Compare the current observed layout with the prior institutional record.", ["Load the prior layout record.", "Record agreements and unresolved conflicts.", "Report the comparison to Standard."]],
    "layout-shift-verification": ["Verify whether the recorded layout discrepancy remains present at the assigned site.", ["Revisit the recorded route where access permits.", "Measure or record the conflicting point.", "Report whether the discrepancy was confirmed, unresolved, or contradicted."]],
    "route-marker-audit": ["Audit the condition and continuity of the established route markings.", ["Locate the last confirmed marker.", "Record marker condition and route continuation.", "Report missing or inaccessible sections separately."]],
    "lighting-material-survey": ["Inspect and document the declared lighting and material conditions.", ["Inspect accessible fixtures and surfaces.", "Record observable condition and measurements.", "Retain the field record for Standard."]],
    "equipment-recovery": ["Recover the identified field equipment if its recorded location remains accessible.", ["Follow the last recorded equipment location.", "Account for the item without treating recovery as guaranteed.", "Record custody and condition if recovered."]],
    "outpost-inspection": ["Inspect the established outpost and account for its recorded equipment and modifications.", ["Approach the recorded outpost location.", "Record present equipment, markings, and accessibility.", "Report absent or unrecovered material separately."]],
    "contact-loss-investigation": ["Establish the last confirmed route and circumstances of the recorded contact loss.", ["Follow the last confirmed route where possible.", "Separate contact evidence from death confirmation.", "Report personnel and equipment status independently."]],
    "missing-person-search": ["Search the recorded site for the missing personnel or evidence of their last route.", ["Search only the assigned boundary.", "Record observations, equipment, and remains separately.", "Report absence as unresolved unless death is confirmed."]],
    "prior-site-revisit": ["Revisit the prior site and determine what remains accessible and documentable.", ["Use prior records as comparison material.", "Record changed, unchanged, and inaccessible features.", "Retain a bounded follow-up record."]],
    "recovered-media-follow-up": ["Compare the recovered field media with the direct record from its originating assignment.", ["Review only returned media.", "Record agreements and discrepancies.", "Preserve damaged or incomplete media status."]],
    "radio-dead-zone-verification": ["Verify the recorded communication limitation at the assigned boundary.", ["Attempt the scheduled check-in from the assigned locations.", "Record successful, failed, or unreadable transmissions.", "Do not treat radio failure as personnel death."]],
    "environmental-discrepancy": ["Document the admitted environmental discrepancy at the recorded site.", ["Observe the specified material or lighting condition.", "Compare it with the institutional record.", "Report only the observed discrepancy."]],
    "threshold-access-confirmation": ["Confirm the accessibility of the recorded Threshold approach and return procedure.", ["Review the access procedure.", "Approach without assuming crossing or return success.", "Report the confirmed route state to Standard."]]
  };
  return shapes[family.id] ?? [family.id === "personnel-recovery" ? "Locate the missing team's last recorded site and recover identifying records or equipment where possible." : family.id === "infrastructure-material" ? "Inspect and document the declared lighting and material conditions within the survey boundary." : "Record the layout across the declared survey boundary and retain a field record for comparison.", ["Address the assigned boundary as far as access permits.", "Record required observations and measurements.", "Retain the field record and check in with Standard."]];
}
function missionId(world, family, seed) { return `CQ4-${family.id.toUpperCase().replace(/[^A-Z]+/g, "-")}-${String(world?.next_run ?? 1).padStart(3, "0")}-${digest([world?.world_id, seed, family.id]).slice(0, 4).toUpperCase()}`; }
function generate({ world = null, run_id = null, seed = "yellow-beast-q4", staffing = null } = {}) {
  const family = chooseFamily(world, seed);
  const prior = historyReferences(world);
  const continuity = prior.length ? "continuity assignment derived from recorded history" : "new institutional assignment with no prior-world dependency";
  const siteRecord = siteFor(world, family, seed); const [primary, procedures] = shapeForFamily(family, siteRecord);
  const mission = { version: VERSION, id: missionId(world, family, seed), assignment_authority: "ASYNC / Standard", family: family.id, family_label: family.label, authority: { classification: family.authority, source_claim_ids: [...family.claims], provenance: family.authority.includes("recorded") ? "world-history" : "admitted-runtime-and-procedural-glue" }, rationale: continuity === "new institutional assignment with no prior-world dependency" ? "ASYNC has assigned a bounded field record so the institution can maintain an observer-qualified account of the site." : "ASYNC has assigned a bounded follow-up to reconcile an existing institutional record.", site: siteRecord, objective: { primary, procedures, completion_criteria: ["The assigned boundary or recorded site has been addressed as far as access permits.", "Required observations, measurements, or recovery findings are recorded.", "A check-in and field record are delivered or the inability to deliver it is recorded."] }, discovery_opportunity: { kind: family.id.includes("layout") ? "new layout information" : family.id.includes("personnel") || family.id.includes("contact") ? "new personnel information" : "new evidence or record comparison", requirement: "legitimate observation or returned evidence; no new phenomenon required" }, assigned_personnel: staffing?.team?.map((person) => person.identity) ?? (staffing?.player && staffing?.peer ? [staffing.player.identity, staffing.peer.identity] : []), required_equipment: family.required, reporting: { check_ins: ["Confirm departure at the Threshold.", "Transmit a field check-in within the declared operational window.", "Confirm return or report an authorized abort."], evidence: ["Retain recordings, measurements, and written field notes where available."], abort_conditions: ["Return if personnel safety or equipment access prevents the assigned work."], summary: "Report observations and personnel accountability to Standard; a report remains an account, not objective truth." }, expected_duration: "within the declared operational window", risks: [{ text: "Access, lighting, equipment condition, and personnel contact may be uncertain.", knowledge_status: "known operational uncertainty" }], prior_history: prior, continuity, status: "assigned", run_id, generated_from: { seed, history_digest: digest([world?.world_id, prior]) } };
  return trajectories.attach(mission, { world, seed });
}
function catalog() { return CATALOG.map(clone); }
function validate(mission) { if (!mission?.id || !CATALOG.some((entry) => entry.id === mission.family)) throw new Error("Q4 mission is not cataloged"); if (!mission.objective?.primary || !mission.objective.completion_criteria?.length) throw new Error("Q4 mission lacks actionable objective or completion criteria"); if (/explore.*strange|anything strange|explore the complex/i.test(JSON.stringify(mission))) throw new Error("generic exploration mission rejected"); return true; }
function canReference(world, reference) { return historyReferences(world).some((item) => item.id === reference?.id && item.kind === reference.kind); }
module.exports = { VERSION, CATALOG, catalog, generate, validate, continuityContext, historyReferences, canReference };
