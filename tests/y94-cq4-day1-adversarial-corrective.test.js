"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
const decisionScheduler = require("../tools/decision-scheduler");
const presentationBus = require("../tools/presentation-bus");

function createTestOpenerService(seed = "adversarial-corrective-test", nowFn = null) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opener-adv-"));
  const options = {
    appDataPath,
    defaultQ4Scenario: "day1-opener",
  };
  if (nowFn) options.nowFn = nowFn;
  const service = new DesktopService(options);
  const world = service.createWorld({ name: "Day 1 Opener Adversarial Test", seed }).world;
  return { appDataPath, service, world };
}

async function advanceToFieldOperation(service, worldId) {
  service.createQ4Personnel({ world_id: worldId, first_name: "Thorne, Marcus" });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" }); // STAGING
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "PROCEED" }); // FACILITY_TRANSIT
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "APPROACH" }); // THRESHOLD
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" }); // STANDARD_RADIO_CHECK
  await service.submitQ4CheckIn({ world_id: worldId, hold_duration_ms: 2050 }); // radio check
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CROSS" }); // FIELD_OPERATION
}

// -----------------------------------------------------------------------------
// Scenario 1: Service-Owned Radio Check-In Hold Timing
// -----------------------------------------------------------------------------
test("y94 — Scenario 1: Service-Owned Radio Check-In Hold Timing", async () => {
  let mockTime = 1000000;
  const { appDataPath, service, world } = createTestOpenerService("checkin-timing-seed", () => mockTime);

  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // STAGING
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }); // FACILITY_TRANSIT
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }); // THRESHOLD
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // STANDARD_RADIO_CHECK

    const entry = service.session(world.id, "field-researcher");

    // 1. Begin hold, verify pending hold state
    const beginRes = service.beginQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    assert.equal(beginRes.ok, true);
    assert.equal(service.checkInHolds.has(world.id), true);
    assert.equal(service.checkInHolds.get(world.id).startTime, 1000000);

    // 2. Complete hold before 2000ms: rejected with CHECK_IN_HOLD_INSUFFICIENT
    mockTime += 1500; // only 1500ms elapsed
    const prematureRes = await service.completeQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    assert.equal(prematureRes.ok, false);
    assert.equal(prematureRes.code, "CHECK_IN_HOLD_INSUFFICIENT");
    assert.equal(prematureRes.elapsed_ms, 1500);
    assert.equal(entry.run.expedition.day1_opener.check_in_held_seconds, 0);
    // Hold was consumed/cleared upon completion attempt
    assert.equal(service.checkInHolds.has(world.id), false);

    // 3. Cancel hold: cleared, no check-in recorded
    service.beginQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    assert.equal(service.checkInHolds.has(world.id), true);
    const cancelRes = service.cancelQ4CheckInHold({ world_id: world.id });
    assert.equal(cancelRes.ok, true);
    assert.equal(service.checkInHolds.has(world.id), false);
    assert.equal(entry.run.expedition.day1_opener.check_in_held_seconds, 0);

    // 4. Complete hold after >= 2000ms: succeeds, check-in recorded with service-calculated duration
    mockTime = 2000000;
    service.beginQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    mockTime += 2150; // 2150ms elapsed
    const successRes = await service.completeQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    assert.equal(successRes.ok, true);
    assert.equal(successRes.result.outcome, "check-in-acknowledged");
    assert.equal(successRes.result.check_in.hold_duration_ms, 2150);
    assert.equal(service.checkInHolds.has(world.id), false);
    assert.equal(entry.run.expedition.day1_opener.check_in_held_seconds, 2.15);

    // 5. Client-asserted hold_duration_ms ignored when service hold exists
    mockTime = 3000000;
    service.beginQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    mockTime += 2400; // 2400ms elapsed
    // Client tries to spoof hold_duration_ms: 99999
    const spoofedRes = await service.submitQ4CheckIn({
      world_id: world.id,
      mode: "field-researcher",
      hold_duration_ms: 99999
    });
    assert.equal(spoofedRes.ok, true);
    // Service-measured elapsed time (2400ms) overrides spoofed client parameter
    assert.equal(spoofedRes.result.check_in.hold_duration_ms, 2400);
    assert.equal(service.checkInHolds.has(world.id), false);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario 2: Delivery Feasibility != Automatic Delivery
// -----------------------------------------------------------------------------
test("y94 — Scenario 2: Delivery Feasibility != Automatic Delivery", async () => {
  const { appDataPath, service, world } = createTestOpenerService("feasibility-not-delivery-seed");

  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");

    // Move along guidance tape: utility-room -> corridor -> outpost-a
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");

    const duffle = entry.run.expedition.logistics.items["startup-materials-duffle"];
    const internId = entry.run.expedition.team.members[2].personnel_id;

    // Intern is still holding the duffle upon entering Outpost A
    assert.equal(duffle.current_holder, internId);
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, false);
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false);

    // Feasibility produced delivery opportunity dialogue, but bag was NOT automatically dropped
    const events = presentationBus.inspectEvents(world.id);
    const oppDialogue = events.find((e) => /Ready to unload the materials duffle/i.test(e.text));
    assert.ok(oppDialogue, "Intern announced delivery opportunity upon arrival at Outpost A");
    assert.equal(duffle.current_holder, internId, "Duffle remains held despite reaching Outpost A");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Delivery is not complete while held");

    // Dropping duffle in wrong room (utility-room) does not complete delivery
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "back" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "west" });
    assert.equal(entry.run.spatial.player_location, "utility-room");

    // Drop duffle in utility-room
    service.submitQ4Logistics({ world_id: world.id, action: "DROP", item_id: "startup-materials-duffle", actor: internId });
    const droppedItem = entry.run.expedition.logistics.items["startup-materials-duffle"];
    assert.equal(droppedItem.current_location, "utility-room");
    assert.equal(droppedItem.current_holder, null);
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Drop in utility room must NOT complete delivery");

    // Pick it back up and return to Outpost A
    service.submitQ4Logistics({ world_id: world.id, action: "RECOVER", item_id: "startup-materials-duffle", actor: internId });
    const pickedItem = entry.run.expedition.logistics.items["startup-materials-duffle"];
    assert.equal(pickedItem.current_holder, internId);
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");

    // Player order to drop bag at Outpost A
    const orderRes = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Drop the materials duffle here."
    });
    assert.equal(orderRes.ok, true);
    const deliveredItem = entry.run.expedition.logistics.items["startup-materials-duffle"];
    assert.equal(deliveredItem.current_location, "outpost-a");
    assert.equal(deliveredItem.current_holder, null);

    // Delivery is now physically completed!
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true);
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true);

    // Test alternative: autonomous decision drops bag at Outpost A on subsequent cycle
    service.submitQ4Logistics({ world_id: world.id, action: "RECOVER", item_id: "startup-materials-duffle", actor: internId });
    const intern = entry.run.expedition.team.members[2];
    intern.ordered_to_deliver = false;
    intern.delivery_opportunity_noted = true;
    entry.run.expedition.day1_opener.delivery_completed = false;
    const decisions = decisionScheduler.scheduleDecisions(entry.run);
    assert.ok(decisions.scheduled.some((d) => d.action === "deliver-startup-materials"), "Autonomous decision drops bag when opportunity exists");
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true);
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario 3: Outpost A Canonical World Persistence
// -----------------------------------------------------------------------------
test("y94 — Scenario 3: Outpost A Canonical World Persistence", async () => {
  const { appDataPath, world } = createTestOpenerService("canonical-persistence-seed");
  let service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });

  try {
    await advanceToFieldOperation(service, world.id);
    let entry = service.session(world.id, "field-researcher");

    // Retrieve Outpost A coordinates and properties
    const outpostA = entry.run.spatial.generated_locations.find((l) => l.id === "outpost-a");
    assert.ok(outpostA, "Outpost A exists in spatial state");
    const originalCoords = { ...outpostA.coordinates };
    assert.ok(originalCoords.x > 0 && originalCoords.y !== undefined);

    // Verify placard mundane terminology
    const placard = outpostA.landmarks.find((lm) => lm.id === "outpost-a-placard");
    assert.ok(placard);
    assert.equal(placard.name, "stenciled equipment placard");

    // Mutate prop state: inspect folding tables and add custom tag
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");

    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "INSPECT", target: "folding tables" });
    outpostA.landmarks.find((lm) => lm.id === "folding-tables").custom_inspection_mark = "chalk-check";

    // Cold boot restart: simulate crash/exit and reconstruct from disk
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    const resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true);

    entry = service.session(world.id, "field-researcher");
    const reloadedOutposts = entry.run.spatial.generated_locations.filter((l) => l.id === "outpost-a");
    assert.equal(reloadedOutposts.length, 1, "No duplicate Outpost A created on reload");

    const reloadedOutpost = reloadedOutposts[0];
    assert.deepEqual(reloadedOutpost.coordinates, originalCoords, "Outpost A coordinates survive cold boot identically");

    const reloadedTables = reloadedOutpost.landmarks.find((lm) => lm.id === "folding-tables");
    assert.equal(reloadedTables.custom_inspection_mark, "chalk-check", "Prop state modification survives cold boot");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario 4: INCOMPLETE MISSION DOES NOT BLOCK EGRESS (Named Test)
// -----------------------------------------------------------------------------
test("INCOMPLETE MISSION DOES NOT BLOCK EGRESS", async () => {
  const { appDataPath, service, world } = createTestOpenerService("incomplete-mission-egress-seed");

  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");

    // 1. Team moves east into corridor, but does NOT reach Outpost A and does NOT deliver materials
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    assert.ok(entry.run.spatial.player_location.startsWith("corridor-bermuda-"));
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, false, "Delivery is incomplete");

    // 2. Team decides to abort and returns west to KV31
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    assert.equal(entry.phase.phase_id, "RETURN");

    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "west" });
    assert.equal(entry.run.spatial.player_location, "utility-room");

    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    assert.equal(entry.run.spatial.player_location, "threshold-side-entry");

    // 3. Request return surveillance verification via radio
    const commsRes = service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Control Room, Team Lead Thorne at KV31. Aborting forward transit; standing by for return surveillance logging."
    });
    assert.equal(commsRes.ok, true);
    assert.equal(entry.run.expedition.day1_opener.return_surveillance_verified, true, "Surveillance logged despite undelivered mission");

    // 4. COMPLETE_RETURN must NOT be blocked by delivery_completed === false
    const returnRes = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "COMPLETE_RETURN"
    });
    assert.equal(returnRes.ok, true, "COMPLETE_RETURN must succeed when delivery is incomplete");
    assert.equal(entry.run.lifecycle, "completed", "Run lifecycle completes successfully");
    assert.equal(entry.phase.phase_id, "REPORT", "Transitions to REPORT phase");

    // 5. Submit written report
    const reportRes = service.submitReferenceWrittenReport({
      world_id: world.id,
      text: "Field Lead Marcus Thorne reporting. Incomplete mission due to operational caution. Returned to KV31 with all equipment and personnel."
    });
    assert.equal(reportRes.ok, true);
    assert.equal(entry.phase.phase_id, "DEBRIEF");

    // 6. Verify institutional assessment outcomes differentiate all scenarios:
    // Case A: Materials brought back to KV31 (delivery-undelivered)
    const recordA = cq4Day1Opener.assessInstitutionalRecord({
      report: entry.run.expedition.written_report,
      run: entry.run
    });
    assert.equal(recordA.status, "delivery-undelivered");
    assert.match(recordA.summary, /brought back to KV31/i);

    // Case B: Materials abandoned in complex (delivery-lost-materials)
    const duffle = entry.run.expedition.logistics.items["startup-materials-duffle"];
    duffle.current_location = "corridor-bermuda-abandoned";
    duffle.current_holder = null;
    duffle.holder = null;
    if (entry.run.expedition.equipment?.["startup-materials-duffle"]) {
      entry.run.expedition.equipment["startup-materials-duffle"].current_location = "corridor-bermuda-abandoned";
      entry.run.expedition.equipment["startup-materials-duffle"].location = "corridor-bermuda-abandoned";
      entry.run.expedition.equipment["startup-materials-duffle"].current_holder = null;
      entry.run.expedition.equipment["startup-materials-duffle"].holder = null;
    }
    const recordB = cq4Day1Opener.assessInstitutionalRecord({
      report: entry.run.expedition.written_report,
      run: entry.run
    });
    assert.equal(recordB.status, "delivery-lost-materials");
    assert.match(recordB.summary, /unaccounted or abandoned/i);

    // Case C: Late return beyond scheduled window (late-return)
    entry.run.expedition.clock = { interval: 30 };
    const recordC = cq4Day1Opener.assessInstitutionalRecord({
      report: entry.run.expedition.written_report,
      run: entry.run
    });
    assert.equal(recordC.status, "late-return");
    assert.match(recordC.summary, /past scheduled operational window/i);

    // Case D: Successful delivery (delivery-confirmed)
    entry.run.expedition.day1_opener.delivery_completed = true;
    entry.run.expedition.clock = { interval: 10 };
    const recordD = cq4Day1Opener.assessInstitutionalRecord({
      report: entry.run.expedition.written_report,
      run: entry.run
    });
    assert.equal(recordD.status, "delivery-confirmed");
    assert.match(recordD.summary, /confirmed delivered to Outpost A/i);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario 5: 18 One-Shot Presentations Survive Cold Boot
// -----------------------------------------------------------------------------
test("y94 — Scenario 5: 18 One-Shot Presentations Survive Cold Boot", () => {
  const { appDataPath, world } = createTestOpenerService("oneshot-events-seed");
  let service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });

  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    let entry = service.session(world.id, "field-researcher");

    // 1. Verify authoritative list of 18 events
    const expectedEvents = [
      "briefing_date_card",
      "maxwell_opening_briefing",
      "intern_greets_player",
      "surveyor_greets_player",
      "doctor_greets_player",
      "radio_check_initial_cue",
      "radio_check_tone_feedback",
      "threshold_approach_rumble",
      "threshold_door_parting",
      "crossing_cutscene",
      "complex_acoustic_transition",
      "tape_discovery_cue",
      "outpost_a_revealed",
      "duffle_drop_acknowledge",
      "intern_completion_quip",
      "return_route_familiarity_cue",
      "kv31_return_chime",
      "cold_boot_state_preserved"
    ];

    assert.equal(cq4Day1Opener.ONE_SHOT_EVENTS.length, 18);
    for (const evt of expectedEvents) {
      assert.ok(cq4Day1Opener.ONE_SHOT_EVENTS.includes(evt), `Event ${evt} must be registered`);
    }

    // 2. Mark initial ones consumed
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "briefing_date_card"), true);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "maxwell_opening_briefing"), true);

    // Consume a subset
    cq4Day1Opener.markOneShotConsumed(entry.run, "intern_greets_player");
    cq4Day1Opener.markOneShotConsumed(entry.run, "crossing_cutscene");
    cq4Day1Opener.markOneShotConsumed(entry.run, "complex_acoustic_transition");

    // Unconsumed events are false
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "outpost_a_revealed"), false);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "duffle_drop_acknowledge"), false);

    // 3. Cold boot restart
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    const resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true);

    entry = service.session(world.id, "field-researcher");

    // Verify consumed one-shots survived cold boot without reset
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "briefing_date_card"), true);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "maxwell_opening_briefing"), true);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "intern_greets_player"), true);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "crossing_cutscene"), true);
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "complex_acoustic_transition"), true);

    // Verify unconsumed one-shots can still fire
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "outpost_a_revealed"), false);
    cq4Day1Opener.markOneShotConsumed(entry.run, "outpost_a_revealed");
    assert.equal(cq4Day1Opener.isOneShotConsumed(entry.run, "outpost_a_revealed"), true);

    // 4. Verify presentation failure does not alter canonical simulation state
    const canonicalStateBefore = JSON.stringify(entry.run.spatial);
    // Emit invalid presentation event
    try {
      presentationBus.emit(entry.run, { type: "malformed_event", broken: () => {} });
    } catch {
      // Ignored or caught
    }
    const canonicalStateAfter = JSON.stringify(entry.run.spatial);
    assert.equal(canonicalStateBefore, canonicalStateAfter, "Presentation failure must never alter canonical simulation state");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario 6: Continuous Adversarial Regression Scenario
// -----------------------------------------------------------------------------
test("y94 — Scenario 6: Continuous Adversarial Regression Scenario", async () => {
  let mockTime = 5000000;
  const { appDataPath, service, world } = createTestOpenerService("adversarial-full-journey-seed", () => mockTime);

  try {
    // 1. Identity & Briefing
    const personRes = service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    assert.equal(personRes.ok, true);

    const startRes = service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(startRes.ok, true);
    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 2. Capacity Limit Enforcement
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // STAGING
    assert.equal(entry.phase.phase_id, "STAGING");

    // Attempting to acquire a 3rd item via selectQ4OptionalStore must be rejected deterministically
    const thirdItemAttempt = service.selectQ4OptionalStore({
      world_id: world.id,
      item_id: "spare-battery"
    });
    assert.equal(thirdItemAttempt.ok, false, "3rd item must be rejected");
    assert.equal(thirdItemAttempt.error.code, "PERSONNEL_CAPACITY_EXCEEDED");

    // 3. Radio Check-In with Service-Owned Hold
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }); // FACILITY_TRANSIT
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }); // THRESHOLD
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // STANDARD_RADIO_CHECK

    service.beginQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    mockTime += 2200;
    const checkInRes = await service.completeQ4CheckInHold({ world_id: world.id, mode: "field-researcher" });
    assert.equal(checkInRes.ok, true);
    assert.equal(checkInRes.result.outcome, "check-in-acknowledged");

    // 4. Crossing with Acoustic Shift
    const crossRes = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
    assert.equal(crossRes.ok, true);
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");

    const events = presentationBus.inspectEvents(world.id);
    const acousticEvent = events.find((e) => e.type === "complex_acoustic_transition" || e.type === "crossing_acoustic_shift");
    assert.ok(acousticEvent, "Acoustic transition emitted upon crossing");
    assert.equal(acousticEvent.text, "Standard-side environmental bed ceases. Low fluorescent hum and Threshold acoustics commence.");

    // 5. Navigation along neon-green tape to Outpost A
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");

    // Delivery is not automatically done on room entry
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, false);

    // 6. Deliver materials at Outpost A via natural command
    const deliverOrder = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Intern, unload the startup materials duffle."
    });
    assert.equal(deliverOrder.ok, true);
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true);
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true);

    // 7. Retrace back to KV31
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "back" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "west" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    assert.equal(entry.run.spatial.player_location, "threshold-side-entry");

    // 8. Surveillance Verification & Completion
    const survRes = service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Control Room, Team Lead Thorne at KV31. Materials delivered to Outpost A. Standing by for return logging."
    });
    assert.equal(survRes.ok, true);
    assert.equal(entry.run.expedition.day1_opener.return_surveillance_verified, true);

    const closeRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(closeRes.ok, true);
    assert.equal(entry.run.lifecycle, "completed");
    assert.equal(entry.phase.phase_id, "REPORT");

    // 9. Written Report Submission
    const repRes = service.submitReferenceWrittenReport({
      world_id: world.id,
      text: "Field Lead Marcus Thorne reporting. Startup materials duffle delivered to Outpost A. Guidance tape route followed both ways. Team intact."
    });
    assert.equal(repRes.ok, true);
    assert.equal(entry.phase.phase_id, "DEBRIEF");

    // 10. Institutional Adjudication & Demo Termination
    const projection = service.projectionFor(world.id, "field-researcher");
    assert.ok(projection.demo_termination);
    assert.equal(projection.demo_termination.status_text, "NO FURTHER ASSIGNMENTS AVAILABLE");

    const record = cq4Day1Opener.assessInstitutionalRecord({
      report: entry.run.expedition.written_report,
      run: entry.run
    });
    assert.equal(record.status, "delivery-confirmed");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
