"use strict";

const crypto = require("node:crypto");
const definition = require("../data/worldpacks/clear-q4/reference-expedition.json");

const VERSION = definition.version;
const SCENARIO = definition.scenario;
const RUNTIME_SCENARIO = "async-clear-q4-reference-expedition";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function validate() {
  if (VERSION !== "yellow-beast-reference-expedition@v1" || definition.id !== "clear-q4-reference-expedition") throw new Error("unsupported Reference Expedition specimen");
  if (definition.staffing.total !== 4 || definition.staffing.minimum_total !== 4 || definition.staffing.maximum_total !== 4 || definition.staffing.coworker_roles.length !== 3) throw new Error("Reference Expedition staffing must be player plus three coworkers");
  const current = definition.canonical_geometry.current_passage;
  const corridor = definition.canonical_geometry.parallel_corridor_volume;
  const prior = definition.prior_record;
  if (!(current.depth_m > corridor.axis_interval_m[0]) || !(prior.recorded_passage_depth_m < corridor.axis_interval_m[0])) throw new Error("Reference Expedition geometry does not encode the fixed discrepancy");
  return true;
}

function isReference(value) { return value === SCENARIO || value === RUNTIME_SCENARIO; }
function staffingRules(base = {}) { validate(); return { ...base, ...clone(definition.staffing) }; }

function mission({ run_id = null, seed = "reference-expedition", staffing = null } = {}) {
  validate();
  const authored = definition.mission;
  return {
    version: "yellow-beast-q4-missions@v2",
    id: `CQ4-REFERENCE-${digest([seed, run_id]).slice(0, 8).toUpperCase()}`,
    display_id: "CQ4-REFERENCE-001",
    specimen_id: definition.id,
    assignment_authority: "ASYNC / Standard",
    family: authored.family,
    family_label: authored.family_label,
    authority: { classification: "owner-ratified-reference-specimen", source_claim_ids: [], provenance: "reference-expedition-specimen-brief" },
    rationale: authored.rationale,
    site: clone(authored.site),
    objective: {
      primary: authored.primary,
      procedures: clone(authored.procedures),
      completion_criteria: ["Address the assigned survey line as far as access permits.", "Retain any current measurement or observation record actually acquired.", "Return or record an authorized abort."]
    },
    assigned_personnel: staffing?.team?.map((person) => person.identity) ?? [],
    required_equipment: ["field-light", "recording-device", "survey-instrument", "survey-radio"],
    reporting: {
      check_ins: ["Confirm departure at the Threshold.", "Transmit a field check-in within the declared operational window.", "Confirm return or report an authorized abort."],
      evidence: ["Retain measurements, photographs, and notes that were actually acquired."],
      abort_conditions: ["Return if personnel safety or equipment access prevents the assigned work."],
      summary: "Report current observations and personnel accountability separately from the prior layout record."
    },
    expected_duration: "within the declared operational window",
    risks: [{ text: "Access, lighting, equipment condition, and personnel contact may be uncertain.", knowledge_status: "known operational uncertainty" }],
    prior_history: [clone(definition.prior_record)],
    continuity: "fixed Reference Expedition specimen",
    status: "assigned",
    run_id,
    generated_from: { seed, specimen_id: definition.id }
  };
}

function instantiate(run) {
  validate();
  if (!isReference(run?.scenario) || !run.spatial) return run;
  run.spatial.reference_expedition ??= {
    version: VERSION,
    specimen_id: definition.id,
    canonical_geometry: clone(definition.canonical_geometry),
    prior_record_id: definition.prior_record.id
  };
  return run;
}

function measurementEvidence(run, operator = null) {
  if (!isReference(run?.scenario) || !run.spatial?.reference_expedition || run.spatial.player_location !== definition.measurement.location_id) return null;
  const existing = (run.expedition?.evidence ?? []).find((item) => item.type === definition.measurement.evidence_type && item.location === definition.measurement.location_id);
  if (existing) return null;
  const player = run.session.startup.player.observer_id;
  const actualOperator = operator ?? player;
  const geometry = run.spatial.reference_expedition.canonical_geometry.current_passage;
  return {
    id: `reference-measurement-${digest([run.run_id, actualOperator, geometry.id]).slice(0, 16)}`,
    type: definition.measurement.evidence_type,
    creator: actualOperator,
    operator: actualOperator,
    capturing_observer: actualOperator,
    custodian: actualOperator,
    location: definition.measurement.location_id,
    source_location: definition.measurement.location_id,
    source_location_name: "Open Passage",
    source_object: geometry.id,
    capture_event: "measurement.recorded",
    method: definition.measurement.method,
    device: "Portable survey instrument",
    device_id: definition.measurement.equipment_id,
    storage: "with the field survey record",
    captured_at: { interval: run.expedition.clock.interval },
    target_observation: `The Open Passage measures ${geometry.depth_m.toFixed(1)} metres from the recorded south-wall datum.`,
    visible_objects: ["Open Passage walls", "south-wall datum", "survey baseline"],
    condition_summary: `Instrument baseline: ${geometry.depth_m.toFixed(1)} metres from the south-wall datum.`,
    measurement: { kind: "passage-depth", value: geometry.depth_m, unit: "metre", datum_id: run.spatial.reference_expedition.canonical_geometry.datum.id },
    provenance: "observer-qualified-reference-expedition-measurement",
    valid: true,
    available_to_player: true,
    available_to_standard: false,
    reporting_state: "unreported",
    interval: run.expedition.clock.interval
  };
}

function deriveContradiction(run) {
  if (!isReference(run?.scenario) || !run.spatial?.reference_expedition) return { established: false, reason: "REFERENCE_EXPEDITION_INACTIVE" };
  const evidence = (run.expedition?.evidence ?? []).find((item) => item.type === definition.measurement.evidence_type && item.available_to_player !== false);
  if (!evidence?.measurement) return { established: false, reason: "CURRENT_MEASUREMENT_REQUIRED" };
  const prior = run.expedition.mission?.prior_history?.find((item) => item.id === definition.prior_record.id);
  if (!prior) return { established: false, reason: "PRIOR_RECORD_REQUIRED" };
  const corridorStart = prior.parallel_corridor_axis_interval_m[0];
  const overlap = Math.max(0, evidence.measurement.value - corridorStart);
  return overlap > 0
    ? { established: true, basis: { current_evidence_id: evidence.id, prior_record_id: prior.id }, relation: "measured-passage-intrudes-into-recorded-parallel-corridor-volume", overlap_depth_m: overlap }
    : { established: false, reason: "NO_DERIVABLE_CONTRADICTION" };
}

module.exports = { VERSION, SCENARIO, RUNTIME_SCENARIO, definition, validate, isReference, staffingRules, mission, instantiate, measurementEvidence, deriveContradiction };
