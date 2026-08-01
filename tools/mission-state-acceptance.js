"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "acceptance");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-mission-state-"));
const escape = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""} must succeed: ${result.error?.message ?? "unknown failure"}`);
  return result;
}

function safeFacts(projection) {
  const q4 = projection.q4;
  return {
    phase: projection.phase.phase_id,
    mission: q4.mission_record.display_id,
    lifecycle: q4.mission_progress.lifecycle,
    required: q4.mission_progress.required_objectives.map(({ name, state, summary, blocking_reason }) => ({ name, state, summary, blocking_reason })),
    optional: q4.mission_progress.optional_objectives.map(({ name, state, summary }) => ({ name, state, summary })),
    blockers: q4.mission_progress.blockers,
    recent_updates: q4.mission_progress.recent_updates,
    return_readiness: q4.mission_progress.return_readiness,
    result: q4.mission_progress.result,
    location: q4.current_location?.name ?? null,
    evidence: q4.evidence.map(({ id, type, source, condition, reporting_state }) => ({ id, type, source, condition, reporting_state })),
    equipment: q4.equipment.required.map(({ label, holder, state, verification, consumable }) => ({ label, holder, state, verification, remaining: consumable?.remaining })),
    personnel: q4.team.map(({ display_name, contact_category, condition, location }) => ({ display_name, contact_category, condition, location })),
    radio: { state: q4.channels.standard.state, check_completed: q4.radio_check.completed, history_count: q4.channels.standard.history.length },
    check_in: q4.check_in,
    time: q4.operational_time,
    map: q4.map ? { current_location: q4.map.current_location, nodes: q4.map.nodes.map(({ name, current, status }) => ({ name, current, status })), route_history: q4.map.route_history, unresolved_exits: q4.map.unresolved_exits } : null,
    review: q4.review
  };
}

function canonicalFacts(entry) {
  return {
    mission_state: structuredClone(entry.run.expedition.mission_state),
    result: structuredClone(entry.run.expedition.result),
    object_state: structuredClone(entry.run.object_state),
    evidence: structuredClone(entry.run.expedition.evidence),
    equipment: structuredClone(entry.run.expedition.equipment),
    personnel: structuredClone(entry.run.expedition.team),
    spatial: structuredClone(entry.run.spatial),
    radio: structuredClone(entry.run.expedition.radio),
    messages: structuredClone(entry.run.expedition.messages),
    clock: structuredClone(entry.run.expedition.clock)
  };
}

async function main() {
  const service = new DesktopService({ appDataPath: scratch });
  const world = service.createWorld({ name: "ClearQ4 Mission Runtime", seed: "mission-state-acceptance" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "mission-state-acceptance", require_personnel: true });
  assert.equal(started.ok, true);
  const briefing = started.projection;
  assert.equal(briefing.q4.mission_progress.required_objectives.length, 8);
  assert.equal(briefing.q4.mission_progress.optional_objectives.length, 1);

  action(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS"]) action(service, world, verb);
  const radio = action(service, world, "RADIO_CHECK");
  const field = action(service, world, "BEGIN_FIELD_OPERATION");
  assert.equal(field.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Report field evidence").state, "blocked");

  const inspected = action(service, world, "INSPECT", "fluorescent fixture");
  const tested = action(service, world, "TEST", "fluorescent fixture");
  assert.ok(tested.result.mission_updates.some((item) => item.headline === "Capture mission evidence complete"));
  action(service, world, "INSPECT", "scuffed floor");
  const secondEvidence = action(service, world, "PHOTOGRAPH", "scuffed floor");
  action(service, world, "MARK", "scuffed floor");
  const survey = action(service, world, "INSPECT", "service panel");
  assert.equal(survey.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Establish Utility Room conditions").state, "satisfied");
  assert.equal(secondEvidence.projection.q4.mission_progress.optional_objectives[0].state, "satisfied");

  const report = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled check-in: reporting the fixture and scuff evidence records." });
  assert.equal(report.ok, true);
  assert.equal(report.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Report field evidence").state, "satisfied");
  assert.equal(report.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Maintain the scheduled check-in").state, "satisfied");

  const movedAway = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move into the open passage." });
  assert.equal(movedAway.ok, true);
  const returnedToSurvey = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Return northwest to the utility room." });
  assert.equal(returnedToSurvey.ok, true);
  action(service, world, "MOVE", "back");
  action(service, world, "INSPECT", "return marker");
  const route = action(service, world, "SECURE", "return marker");
  assert.equal(route.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Verify the return route").state, "satisfied");
  assert.equal(route.projection.q4.mission_progress.return_readiness.ready, true);

  const returnBegun = action(service, world, "RETURN");
  assert.equal(returnBegun.projection.phase.phase_id, "RETURN");
  assert.equal(returnBegun.projection.q4.review, null);
  assert.equal(service.session(world.id, "field-researcher").run.expedition.result, null);
  const debrief = action(service, world, "COMPLETE_RETURN");
  assert.equal(debrief.projection.phase.phase_id, "DEBRIEF");
  assert.equal(debrief.projection.q4.review.outcome, "clean-completion-with-optional");
  assert.ok(debrief.projection.q4.review.institutional_consequence_hooks.includes("optional_success"));

  const beforeRestartSafe = safeFacts(debrief.projection);
  const beforeRestartCanonical = canonicalFacts(service.session(world.id, "field-researcher"));
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: scratch });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const afterRestartSafe = safeFacts(resumed.projection);
  const afterRestartCanonical = canonicalFacts(restarted.session(world.id, "field-researcher"));
  assert.deepEqual(afterRestartSafe, beforeRestartSafe);
  assert.deepEqual(afterRestartCanonical, beforeRestartCanonical);

  const checks = {
    briefing_required_and_optional: briefing.q4.mission_progress.required_objectives.length === 8 && briefing.q4.mission_progress.optional_objectives.length === 1,
    radio_condition_satisfied: radio.result.mission_updates.some((item) => item.headline === "Establish radio contact complete"),
    field_entry_from_traversal: field.result.mission_updates.some((item) => item.headline === "Enter the declared survey area complete"),
    dependency_block_visible: field.projection.q4.mission_progress.blockers.some((item) => item.name === "Report field evidence"),
    equipment_dependent_interaction: tested.projection.q4.equipment.required.some((item) => item.label === "Portable survey instrument" && item.state === "Depleted"),
    evidence_condition_satisfied: tested.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Capture mission evidence").state === "satisfied",
    optional_condition_satisfied: secondEvidence.projection.q4.mission_progress.optional_objectives[0].state === "satisfied",
    survey_condition_satisfied: survey.projection.q4.mission_progress.required_objectives.find((item) => item.name === "Establish Utility Room conditions").state === "satisfied",
    reporting_and_check_in_satisfied: report.projection.q4.mission_progress.required_objectives.filter((item) => ["Report field evidence", "Maintain the scheduled check-in"].includes(item.name)).every((item) => item.state === "satisfied"),
    movement_and_return_persisted: movedAway.projection.q4.current_location.name === "Open Passage" && returnedToSurvey.projection.q4.current_location.name === "Utility Room",
    route_and_readiness_derived: route.projection.q4.mission_progress.return_readiness.ready === true,
    return_not_instant_completion: returnBegun.projection.phase.phase_id === "RETURN" && returnBegun.projection.q4.review === null,
    combined_outcome_derived: debrief.projection.q4.review.outcome === "clean-completion-with-optional",
    exact_shutdown_restart: JSON.stringify(beforeRestartCanonical) === JSON.stringify(afterRestartCanonical) && JSON.stringify(beforeRestartSafe) === JSON.stringify(afterRestartSafe)
  };
  assert.ok(Object.values(checks).every(Boolean));

  const record = {
    version: "yellow-beast-mission-state-acceptance@v1",
    generated_at: new Date().toISOString(),
    evidence_kind: "deterministic renderer-backed and persisted authoritative-state capture",
    actions: ["review briefing", "READY", "select route-marker kit", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION", "INSPECT and TEST fixture", "PHOTOGRAPH and MARK floor", "INSPECT panel", "report evidence and check in", "move away and return", "verify and secure marker", "RETURN", "COMPLETE_RETURN", "shutdown", "restart", "resume final record"],
    stages: {
      briefing: safeFacts(briefing),
      radio_check: safeFacts(radio.projection),
      field_entry_blocked: safeFacts(field.projection),
      condition_driven_update: safeFacts(tested.projection),
      optional_evidence: safeFacts(secondEvidence.projection),
      survey_complete: safeFacts(survey.projection),
      evidence_reported_and_check_in: safeFacts(report.projection),
      route_verified_and_return_ready: safeFacts(route.projection),
      return_in_progress: safeFacts(returnBegun.projection),
      derived_debrief: beforeRestartSafe,
      post_restart_final_record: afterRestartSafe
    },
    checks
  };

  const frames = [
    ["Briefing objectives", surfaces.render(briefing)],
    ["Radio objective update", surfaces.render(radio.projection)],
    ["Active, optional, and blocked objectives", surfaces.render(field.projection)],
    ["Condition-driven evidence objective", surfaces.render(tested.projection)],
    ["Optional evidence objective", surfaces.render(secondEvidence.projection)],
    ["Evidence reporting and scheduled check-in", surfaces.render(report.projection)],
    ["Route verified and return readiness", surfaces.render(route.projection)],
    ["Return procedure in progress", surfaces.render(returnBegun.projection)],
    ["Derived debrief", surfaces.render(debrief.projection)],
    ["Successful post-restart mission record", surfaces.render(resumed.projection)]
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Beast Mission State Acceptance</title><link rel="stylesheet" href="../../desktop/renderer/styles.css"><style>body{padding:28px;background:#080d0d;color:#dce4dc}.evidence-note{max-width:80ch}.evidence-frame{margin:32px 0;padding:20px;border:1px solid #53635c;background:#101616}.evidence-frame>h2{font:700 14px/1.3 monospace;letter-spacing:.13em;text-transform:uppercase}</style></head><body><header><p class="eyebrow">ACCEPTANCE EVIDENCE · ${escape(record.generated_at)}</p><h1>Mission State and Condition-Driven Objectives</h1><p class="evidence-note">Every frame is generated from the observer-safe projection used by the desktop renderer. The final frame was produced after a full service shutdown, reconstruction, and disk-backed resume of the closed mission record.</p></header>${frames.map(([title, body]) => `<article class="evidence-frame"><h2>${escape(title)}</h2>${body}</article>`).join("")}</body></html>`;

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "MISSION_STATE_EVIDENCE.json"), `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "MISSION_STATE_ACCEPTANCE.html"), html);
  restarted.shutdown();
  console.log(JSON.stringify({ acceptance: "passed", evidence: path.relative(root, outputDirectory), checks }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
