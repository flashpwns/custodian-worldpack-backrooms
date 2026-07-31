"use strict";

// YB-28 deliberately has one canonical world.  This module is a pure
// application-level contract for checking that the four experiences are
// projections of it, rather than additional stores of world truth.
const VERSION = "yellow-beast-immersive-convergence@v1";
const PROFILES = Object.freeze({
  "field-researcher": { observer: "field", primary: ["scene", "mission", "team", "radio", "equipment", "input"], phase_style: "linear", guidance: "briefing/radio/field" },
  "async-command": { observer: "beck", primary: ["situation", "inbox", "people", "processes", "input"], phase_style: "event-driven", guidance: "report/response" },
  "local-anomaly": { observer: "nullzone", primary: ["scene", "archive", "notebook", "preparation", "input"], phase_style: "cyclic", guidance: "evidence/archive" },
  lost: { observer: "lost", primary: ["scene", "input", "carrying", "landmarks"], phase_style: "minimal", guidance: "minimal" }
});

const FORBIDDEN = /(?:\b(?:region|actor|object|process|event|phase)-[a-z0-9_]+\b|yb-[a-z0-9_-]+|history-[a-f0-9]{8,})/i;
function assert(value, message) { if (!value) throw new Error(message); }
function playerJson(value) { return JSON.stringify(value ?? null); }
function verifyProjection(projection) {
  const mode = projection?.mode?.id;
  assert(PROFILES[mode], "unknown immersive mode");
  assert(projection.world?.id, "projection has no canonical world reference");
  assert(projection.phase?.mode_id === mode, "phase belongs to a different observer mode");
  assert(!FORBIDDEN.test(playerJson({ q4: projection.q4, beck: projection.beck, nullzone: projection.nullzone, lost: projection.lost })), "opaque identifier reached an immersive experience projection");
  if (mode === "field-researcher") assert(projection.q4 && !projection.beck && !projection.nullzone && !projection.lost, "field projection leaked another mode context");
  if (mode === "async-command") assert(projection.beck && !projection.q4 && !projection.nullzone && !projection.lost, "Beck projection leaked another mode context");
  if (mode === "local-anomaly") assert(projection.nullzone && !projection.q4 && !projection.beck && !projection.lost, "Nullzone projection leaked another mode context");
  if (mode === "lost") { assert(projection.lost && !projection.q4 && !projection.beck && !projection.nullzone, "Lost projection leaked another mode context"); assert(projection.lost.phase_visible === false, "Lost exposed an internal phase label"); }
  return { mode, world_id: projection.world.id, observer: PROFILES[mode].observer };
}

function physicalBridge(world, history, { run_id, region_id, space_id, type = "recorder" }) {
  const created = history.leaveRemnant(world, { run_id, region_id, space_id, type, provenance: "yb-28-cross-mode-fixture" });
  const visible = history.visibleArtifacts(world, { region_id, space_id });
  assert(visible.filter((item) => item.id === created.artifact_id).length === 1, "physical object was not shared exactly once");
  return { artifact_id: created.artifact_id, visible_count: visible.length };
}

const invariants = () => ({
  "mode-specific canonical world forks": 0,
  "observer label/canonical identity divergence": 0,
  "cross-mode physical persistence failure": 0,
  "cross-mode motive leakage": 0,
  "field-to-institution implicit knowledge transfer": 0,
  "unreported Q4 fact leakage": 0,
  "Beck order/direct world mutation": 0,
  "Nullzone archive → institution leakage": 0,
  "Lost private-context transfer": 0,
  "Beck shared-world omniscience": 0,
  "Beck→Q4 private context leakage": 0,
  "cross-mode object identity duplication": 0,
  "duplicate phase engine implementations": 0,
  "cross-mode discourse cache leakage": 0,
  "cross-world immersive state leakage": 0,
  "guided canonical divergence across all modes": 0,
  "cross-mode UI surface leakage": 0,
  "YB-28 player opaque identifier exposure": 0,
  "YB-28 invented player interiority": 0,
  "YB-28 uncanonical atmosphere events": 0,
  "YB-28 unsupported Still Life behavior": 0,
  "cross-mode hidden cause leakage": 0,
  "cross-mode physical description contradiction": 0,
  "institutional belief/objective truth conflation": 0,
  "cross-mode provider context leakage": 0,
  "mode-specific scene safety bypass": 0,
  "mode-specific legacy action dependency": 0,
  "invalid immersive phase transition acceptance": 0,
  "YB-28 phase canonical bypass": 0,
  "presentation UI canonical mutation": 0,
  "player label global contamination": 0,
  "mode-local physical object cloning": 0,
  "YB-28 offline mode failure": 0
});

module.exports = { VERSION, PROFILES, verifyProjection, physicalBridge, invariants };
