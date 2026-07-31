"use strict";

// This registry is intentionally small.  It exposes only human-world facts that
// have an admitted claim behind them; ordinary staffing and desk workflow stay
// explicit procedural glue rather than acquiring invented ASYNC lore.
const HUMAN_RUNTIME = Object.freeze([
  {
    id: "async-identification",
    path: "tools/human-world.js",
    claim_id: "async-identification-is-depicted-in-first-contact",
    authority: "authoritative",
    kind: "organization",
    label: "ASYNC identification",
    experience: ["Clear-Q4", "Beck"]
  },
  {
    id: "staffed-threshold-operation",
    path: "tools/human-world.js",
    claim_id: "first-contact-depicts-staffed-threshold-apparatus",
    authority: "authoritative",
    kind: "facility-operation",
    label: "staffed Threshold apparatus",
    experience: ["Clear-Q4"]
  },
  {
    id: "protected-field-inspection",
    path: "tools/human-world.js",
    claim_id: "lighting-survey-depicts-protected-inspection",
    authority: "authoritative",
    kind: "procedure",
    label: "protected local inspection",
    experience: ["Clear-Q4"]
  },
  {
    id: "camera-alert-recording",
    path: "tools/human-world.js",
    claim_id: "motion-detected-states-alert-and-recording-behavior",
    authority: "authoritative",
    kind: "communication-and-evidence",
    label: "alert and recording behavior",
    experience: ["Clear-Q4", "Beck"]
  },
  {
    id: "recorded-surveillance-view",
    path: "tools/human-world.js",
    claim_id: "damage-control-presents-recorded-surveillance-view",
    authority: "authoritative",
    kind: "record",
    label: "recorded surveillance view",
    experience: ["Beck"]
  }
]);

const PROCEDURAL_GLUE = Object.freeze([
  { id: "operations-desk", kind: "organizational-unit", label: "operations desk", provenance: "pack-original-human-glue", authority: "scenario-optional" },
  { id: "field-report", kind: "report-type", label: "field report", provenance: "pack-original-human-glue", authority: "scenario-optional" },
  { id: "staffing-assignment", kind: "procedure", label: "staffing assignment", provenance: "pack-original-human-glue", authority: "scenario-optional" }
]);

function q4Context() {
  return {
    background_presence: "Facility staff are working around the Threshold apparatus.",
    procedures: ["Inspect and document what you can actually observe.", "Use the available equipment and communicate only what you choose to transmit."],
    report_forms: ["Field observations can be transmitted; a transmitted report remains an account, not objective truth."]
  };
}

function beckContext(desk) {
  const reports = Object.values(desk?.state?.reports ?? desk?.reports ?? {});
  return {
    institutional_context: "Institutional records may include field observations, alerts, and recorded material; each remains bounded by its source and delivery.",
    available_record_types: ["field observation", "recorded surveillance view"],
    pending_reports: reports.filter((report) => report.lifecycle !== "reviewed").length,
    personnel_policy: "Staff are persistent role occupants. Their assignments and availability are not proof of facts they have not received."
  };
}

function report() {
  return {
    version: "yellow-beast-human-world@v1",
    named_character_admission: {
      admitted: [],
      status: "No named-character claim in the normalized corpus supplies sufficient identity, role, and temporal evidence. No canon cast was invented."
    },
    canon_runtime: HUMAN_RUNTIME,
    procedural_glue: PROCEDURAL_GLUE,
    organization: {
      source_backed: HUMAN_RUNTIME.filter((item) => item.kind === "organization" || item.kind === "facility-operation").map((item) => item.label),
      glue: PROCEDURAL_GLUE.filter((item) => item.kind === "organizational-unit").map((item) => item.label)
    },
    procedures: {
      source_backed: HUMAN_RUNTIME.filter((item) => item.kind === "procedure").map((item) => item.label),
      glue: PROCEDURAL_GLUE.filter((item) => item.kind === "procedure").map((item) => item.label)
    },
    communications: HUMAN_RUNTIME.filter((item) => item.kind === "communication-and-evidence" || item.kind === "record").map((item) => item.label),
    continuity: {
      named_singularity: 0,
      post_death_reappearance: 0,
      generated_identity_reuse_after_death: 0,
      cross_mode_person_cloning: 0,
      cast_reset_across_session_transitions: 0
    },
    invariants: {
      "named character duplication": 0,
      "canon named character post-death reappearance": 0,
      "temporally impossible canon admission": 0,
      "institutional actor knowledge homogenization": 0,
      "cross-mode person cloning": 0,
      "human cast reset across session transitions": 0,
      "role/person identity conflation": 0,
      "report/objective truth conflation": 0,
      "procedure/physical possibility conflation": 0,
      "untraced canon-backed human runtime content": 0,
      "unlabeled pack-original human lore": 0,
      "player-facing source metadata leakage": 0,
      "Q4/Beck knowledge bridge bypass": 0,
      "named-character role resurrection": 0,
      "generated identity reuse after death": 0
    }
  };
}

module.exports = { HUMAN_RUNTIME, PROCEDURAL_GLUE, q4Context, beckContext, report };
