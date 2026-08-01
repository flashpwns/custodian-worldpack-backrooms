"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "acceptance");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-operational-dynamics-"));
const escape = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""} must succeed: ${result.error?.message ?? "unknown failure"}`);
  return result;
}

function target(projection, verb, label) {
  const actionRecord = projection.available_actions.find((entry) => entry.type === verb);
  const selected = actionRecord?.targets?.find((entry) => String(entry.label).toLowerCase().includes(label.toLowerCase()));
  assert.ok(selected, `${verb} target containing '${label}' must be available`);
  return selected.ref;
}

function safeFacts(projection) {
  const q4 = projection.q4;
  return {
    phase: projection.phase.phase_id,
    interval: q4.operational_clock.interval,
    next_known_event: q4.operational_clock.next_event,
    mission_lifecycle: q4.mission_progress.lifecycle,
    objectives: [...q4.mission_progress.required_objectives, ...q4.mission_progress.optional_objectives].map(({ name, state, required, summary, blocking_reason, recent_transition }) => ({ name, state, required, summary, blocking_reason, recent_transition })),
    return_readiness: q4.mission_progress.return_readiness,
    team: q4.team.map(({ display_name, role, contact_state, current_or_last_known_location, condition, last_contact, current_task, assigned_equipment, equipment_verification }) => ({ display_name, role, contact_state, current_or_last_known_location, condition, last_contact, current_task, assigned_equipment, equipment_verification })),
    check_ins: q4.communications.check_ins.map(({ label, state, due_at, completed_at, summary }) => ({ label, state, due_at, completed_at, summary })),
    messages: q4.communications.messages.map(({ sender, recipient, channel, purpose, sent_at, state, delivered_at, acknowledged_at, known_reason }) => ({ sender, recipient, channel, purpose, sent_at, state, delivered_at, acknowledged_at, known_reason })),
    hazards: q4.hazards.map(({ category, state, warning, observed_change, mitigation_available, summary }) => ({ category, state, warning, observed_change, mitigation_available, summary })),
    equipment: q4.equipment.required.map(({ label, holder, location, state, verification, consumable }) => ({ label, holder, location, state, verification, remaining: consumable?.remaining ?? null })),
    evidence: q4.evidence.map(({ type, source, condition, reporting_state, observer }) => ({ type, source, condition, reporting_state, observer })),
    location: q4.current_location?.name ?? null,
    operational_updates: q4.operational_updates,
    review: q4.review
  };
}

function canonicalFacts(entry) {
  const expedition = entry.run.expedition;
  return structuredClone({
    clock: expedition.operational.clock,
    scheduled_events: expedition.operational.events,
    event_history: expedition.operational.event_history,
    messages: expedition.messages,
    check_ins: expedition.communications.check_ins,
    team: expedition.team,
    team_runtime: expedition.team_runtime,
    hazards: expedition.hazards,
    consequences: expedition.operational.consequences,
    equipment: expedition.equipment,
    spatial: entry.run.spatial,
    evidence: expedition.evidence,
    mission_state: expedition.mission_state,
    result: expedition.result
  });
}

function createStaffedWorld(service, name, worldSeed, runSeed) {
  const world = service.createWorld({ name, seed: worldSeed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: runSeed, require_personnel: true });
  assert.equal(started.ok, true);
  return { world, started };
}

async function main() {
  const service = new DesktopService({ appDataPath: scratch, logger() {} });
  const { world, started } = createStaffedWorld(service, "Clear-Q4 Operational Dynamics", "operational-dynamics-acceptance-world", "operational-dynamics-acceptance");
  const briefing = started.projection;
  const primaryRoster = briefing.q4.team.map((member) => member.display_name.replace(/ · YOU$/, ""));
  assert.ok(primaryRoster.length >= 3 && primaryRoster.length <= 5);
  assert.ok(primaryRoster.slice(1).every((name) => !["Alex Morgan", "Nora Vale"].includes(name)));

  action(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS"]) action(service, world, verb);
  const radio = action(service, world, "RADIO_CHECK");
  let projection = action(service, world, "BEGIN_FIELD_OPERATION").projection;
  const scheduled = projection;

  for (const [verb, object] of [["INSPECT", "fluorescent fixture"], ["INSPECT", "scuffed floor"], ["PHOTOGRAPH", "scuffed floor"], ["MARK", "scuffed floor"], ["INSPECT", "service panel"]]) projection = action(service, world, verb, object).projection;
  const evidence = projection;

  const accepted = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", "Columned Corridor"));
  assert.equal(accepted.result.outcome, "accepted");
  const separated = accepted.projection;
  const lost = separated.q4.team.find((member) => member.contact_state === "CONTACT LOST");
  assert.ok(lost);
  const canonicalLost = service.session(world.id, "field-researcher").run.expedition.team.members.find((member) => member.first_name === lost.first_name && member.last_name === lost.last_name);
  assert.equal(lost.condition, "normal");
  assert.equal(canonicalLost.condition, "minor injury");
  const hiddenRemoteCondition = { projected: lost.condition, authoritative: canonicalLost.condition };
  assert.equal(separated.q4.hazards.length, 0);

  projection = action(service, world, "MOVE", target(separated, "MOVE", "Columned Corridor")).projection;
  const hazard = projection;
  const injured = projection.q4.team.find((member) => /injur/i.test(member.condition));
  assert.ok(injured);
  assert.match(projection.q4.hazards[0].observed_change, /shifted and struck/i);

  const delayed = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", injured.first_name));
  assert.equal(delayed.result.outcome, "delayed");
  const assisted = action(service, world, "ASSIST", target(delayed.projection, "ASSIST", injured.first_name));
  const recoveredEquipment = action(service, world, "RECOVER", target(assisted.projection, "RECOVER", "survey instrument"));
  const mitigated = action(service, world, "MITIGATE", target(recoveredEquipment.projection, "MITIGATE", "structural"));
  assert.equal(mitigated.projection.q4.hazards[0].state, "mitigated");

  const transmitted = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled check-in and evidence report: scuff field record retained." });
  assert.equal(transmitted.ok, true);
  assert.equal(transmitted.result.outcome, "delayed");
  assert.equal(transmitted.projection.q4.communications.check_ins[0].state, "missed");
  const missed = transmitted.projection;
  projection = missed;
  let guard = 0;
  while (projection.q4.communications.check_ins[0].state !== "completed" && guard < 32) { projection = action(service, world, "WAIT").projection; guard += 1; }
  assert.ok(guard < 32);
  const lateDelivery = projection;
  assert.equal(lateDelivery.q4.communications.check_ins[0].state, "completed");
  assert.equal(lateDelivery.q4.mission_progress.required_objectives.find((objective) => objective.name === "Maintain the scheduled check-in").state, "satisfied");

  projection = action(service, world, "ORDER_FOLLOW", target(projection, "ORDER_FOLLOW", injured.first_name)).projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Utility Room")).projection;
  const equipmentDependent = action(service, world, "TEST", "fluorescent fixture");
  projection = equipmentDependent.projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Threshold-Side Entry")).projection;
  projection = action(service, world, "INSPECT", "return marker").projection;
  const returnReady = action(service, world, "SECURE", "return marker");
  assert.equal(returnReady.projection.q4.mission_progress.return_readiness.ready, true);
  const returning = action(service, world, "RETURN");
  assert.equal(returning.projection.phase.phase_id, "RETURN");
  const debrief = action(service, world, "COMPLETE_RETURN");
  assert.equal(debrief.projection.phase.phase_id, "DEBRIEF");
  assert.equal(debrief.projection.q4.review.outcome, "recovered-complication");

  const beforeRestartSafe = safeFacts(debrief.projection);
  const beforeRestartCanonical = canonicalFacts(service.session(world.id, "field-researcher"));
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: scratch, logger() {} });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const afterRestartSafe = safeFacts(resumed.projection);
  const afterRestartCanonical = canonicalFacts(restarted.session(world.id, "field-researcher"));
  assert.deepEqual(afterRestartSafe, beforeRestartSafe);
  assert.deepEqual(afterRestartCanonical, beforeRestartCanonical);

  const second = createStaffedWorld(restarted, "Clear-Q4 Second Seed", "operational-dynamics-second-world", "operational-dynamics-second-seed");
  const secondRoster = second.started.projection.q4.team.map((member) => member.display_name.replace(/ · YOU$/, ""));
  assert.notDeepEqual(secondRoster.slice(1), primaryRoster.slice(1));
  restarted.shutdown();
  const secondRestart = new DesktopService({ appDataPath: scratch, logger() {} });
  const secondResumed = secondRestart.resumeSession({ world_id: second.world.id, mode: "field-researcher" });
  assert.equal(secondResumed.ok, true);
  const repeatedSecondRoster = secondResumed.projection.q4.team.map((member) => member.display_name.replace(/ · YOU$/, ""));
  assert.deepEqual(repeatedSecondRoster, secondRoster);

  const checks = {
    generated_team_bounded_and_persistent: primaryRoster.length >= 3 && primaryRoster.length <= 5 && JSON.stringify(afterRestartSafe.team.map((member) => member.display_name.replace(/ · YOU$/, ""))) === JSON.stringify(primaryRoster),
    second_seed_differs_but_is_deterministic: JSON.stringify(secondRoster.slice(1)) !== JSON.stringify(primaryRoster.slice(1)) && JSON.stringify(secondRoster) === JSON.stringify(repeatedSecondRoster),
    one_authoritative_clock_advanced: briefing.q4.operational_clock.interval === 0 && debrief.projection.q4.operational_clock.interval > briefing.q4.operational_clock.interval,
    scheduled_check_in_released_by_time: scheduled.q4.communications.check_ins.length === 1,
    accepted_order_and_independent_route_movement: accepted.result.outcome === "accepted" && lost.current_or_last_known_location === "columned-corridor",
    last_known_projection_hides_remote_injury: hiddenRemoteCondition.projected === "normal" && hiddenRemoteCondition.authoritative === "minor injury" && separated.q4.hazards.length === 0,
    delayed_order_has_grounded_reason: delayed.result.outcome === "delayed" && /field assistance/i.test(delayed.result.public_reason),
    hazard_and_consequence_are_persistent_state: hazard.q4.hazards.length === 1 && beforeRestartCanonical.consequences.some((record) => record.effects.some((effect) => effect.kind === "personnel-condition")),
    personnel_and_equipment_recovered: beforeRestartCanonical.consequences.some((record) => record.recovery) && beforeRestartCanonical.equipment["survey-instrument"].holder === beforeRestartCanonical.team.members[0].personnel_id,
    mitigation_persisted: beforeRestartCanonical.hazards.states["overhead-service-bracket"].state === "mitigated",
    interference_delayed_delivery_truthfully: missed.q4.communications.messages.at(-1).state === "delayed" && missed.q4.communications.check_ins[0].state === "missed",
    late_check_in_recovered_without_erasure: lateDelivery.q4.communications.check_ins[0].state === "completed" && beforeRestartCanonical.check_ins[0].history.some((entry) => entry.to === "missed"),
    equipment_dependent_interaction_completed: equipmentDependent.projection.q4.equipment.required.some((item) => item.label === "Portable survey instrument" && item.state === "Depleted"),
    return_and_outcome_are_condition_derived: returnReady.projection.q4.mission_progress.return_readiness.ready && returning.projection.phase.phase_id === "RETURN" && debrief.projection.q4.review.outcome === "recovered-complication",
    exact_shutdown_restart: JSON.stringify(beforeRestartCanonical) === JSON.stringify(afterRestartCanonical) && JSON.stringify(beforeRestartSafe) === JSON.stringify(afterRestartSafe)
  };
  assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));

  const record = {
    version: "yellow-beast-operational-dynamics-acceptance@v1",
    generated_at: new Date().toISOString(),
    evidence_kind: "deterministic renderer-backed and machine-readable authoritative-state capture",
    primary_seed: "operational-dynamics-acceptance",
    second_seed: "operational-dynamics-second-seed",
    primary_roster: primaryRoster,
    second_roster: secondRoster,
    stages: {
      generated_briefing: safeFacts(briefing),
      scheduled_check_in: safeFacts(scheduled),
      evidence_recorded: safeFacts(evidence),
      accepted_order_and_contact_loss: safeFacts(separated),
      observed_hazard_consequence: safeFacts(hazard),
      delayed_order: safeFacts(delayed.projection),
      recovery_and_mitigation: safeFacts(mitigated.projection),
      delayed_message_and_missed_window: safeFacts(missed),
      late_delivery_and_mission_recovery: safeFacts(lateDelivery),
      return_ready: safeFacts(returnReady.projection),
      derived_debrief: beforeRestartSafe,
      post_restart_final_record: afterRestartSafe,
      second_seed_generated_team: safeFacts(second.started.projection),
      second_seed_post_restart: safeFacts(secondResumed.projection)
    },
    checks
  };

  const frames = [
    ["Generated team and briefing", surfaces.render(briefing)],
    ["Operational time and scheduled check-in", surfaces.render(scheduled)],
    ["Accepted order, independent movement, and last-known status", surfaces.render(separated)],
    ["Observed hazard and consequence", surfaces.render(hazard)],
    ["Grounded delayed order", surfaces.render(delayed.projection)],
    ["Recovery and hazard mitigation", surfaces.render(mitigated.projection)],
    ["Radio interference and missed check-in", surfaces.render(missed)],
    ["Late delivery and condition-driven mission recovery", surfaces.render(lateDelivery)],
    ["Return readiness", surfaces.render(returnReady.projection)],
    ["Derived recovered-complication debrief", surfaces.render(debrief.projection)],
    ["Successful post-restart final record", surfaces.render(resumed.projection)],
    ["Second deterministic seed", surfaces.render(second.started.projection)]
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Beast Operational Dynamics Acceptance</title><link rel="stylesheet" href="../../desktop/renderer/styles.css"><style>body{padding:28px;background:#080d0d;color:#dce4dc}.evidence-note{max-width:82ch}.evidence-frame{margin:32px 0;padding:20px;border:1px solid #53635c;background:#101616}.evidence-frame>h2{font:700 14px/1.3 monospace;letter-spacing:.13em;text-transform:uppercase}</style></head><body><header><p class="eyebrow">ACCEPTANCE EVIDENCE · ${escape(record.generated_at)}</p><h1>Operational Dynamics</h1><p class="evidence-note">These frames come from the observer-safe desktop projection after deterministic simulation resolution. The final primary frame follows full shutdown and disk-backed resume; the second seed proves different, stable staffing.</p></header>${frames.map(([title, body]) => `<article class="evidence-frame"><h2>${escape(title)}</h2>${body}</article>`).join("")}</body></html>`;

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "OPERATIONAL_DYNAMICS_EVIDENCE.json"), `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "OPERATIONAL_DYNAMICS_ACCEPTANCE.html"), html);
  secondRestart.shutdown();
  console.log(JSON.stringify({ acceptance: "passed", evidence: path.relative(root, outputDirectory), checks }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
