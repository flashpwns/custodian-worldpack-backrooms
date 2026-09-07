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
const spatialRuntime = require("../tools/spatial-runtime");
const runBootstrap = require("../tools/run-bootstrap");

function createTestOpenerService(seed = "opener-geography-test") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opener-geo-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "day1-opener",
  });
  const world = service.createWorld({ name: "Day 1 Opener Geography Test", seed }).world;
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

test("y92 — CQ4 Day 1 Opener: Procedural Geography, Outpost A Coordinates & Props, Neon-Green Tape", async () => {
  const { appDataPath, service, world } = createTestOpenerService("geo-seed-1");
  const { appDataPath: appData2, service: service2, world: world2 } = createTestOpenerService("geo-seed-2");
  try {
    await advanceToFieldOperation(service, world.id);
    await advanceToFieldOperation(service2, world2.id);

    const entry1 = service.session(world.id, "field-researcher");
    const entry2 = service2.session(world2.id, "field-researcher");

    // 1. Procedural geography: Outpost A coordinates differ between distinct seeds
    const outpost1 = entry1.run.spatial.generated_locations.find((l) => l.id === "outpost-a");
    const outpost2 = entry2.run.spatial.generated_locations.find((l) => l.id === "outpost-a");

    assert.ok(outpost1, "Outpost A exists in seed 1");
    assert.ok(outpost2, "Outpost A exists in seed 2");
    assert.notDeepEqual(outpost1.coordinates, outpost2.coordinates, "Coordinates must differ across different seeds");

    // 2. Geography is identical across save and reload for the same seed
    const saved = runBootstrap.saveRun(entry1.run);
    const reloaded = runBootstrap.resumeRun(saved, world);
    const reloadedOutpost = reloaded.run.spatial.generated_locations.find((l) => l.id === "outpost-a");
    assert.deepEqual(outpost1.coordinates, reloadedOutpost.coordinates, "Coordinates must match exactly after save/reload");

    // 3. Physical neon-green guidance tape inspectable at utility-room
    const inspectTapeUtil = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "green tape",
    });
    assert.equal(inspectTapeUtil.ok, true, "Inspect green tape at utility room succeeds");
    assert.match(inspectTapeUtil.result.turn_status ?? inspectTapeUtil.result.public_reason, /neon-green/i);

    // 4. Move along guidance tape: east into access corridor
    const moveCorridor = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "east",
    });
    assert.equal(moveCorridor.ok, true, "Move east into corridor succeeds");
    assert.ok(entry1.run.spatial.player_location.startsWith("corridor-bermuda-"));

    // 5. Inspect neon-green tape in corridor
    const inspectTapeCorr = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "tape",
    });
    assert.equal(inspectTapeCorr.ok, true);
    assert.match(inspectTapeCorr.result.turn_status ?? inspectTapeCorr.result.public_reason, /directional arrows/i);

    // 6. Move forward into Outpost A
    const moveOutpost = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "forward",
    });
    assert.equal(moveOutpost.ok, true, "Move forward into Outpost A succeeds");
    assert.equal(entry1.run.spatial.player_location, "outpost-a");

    // 7. Verify Outpost A mundane props and placard
    const inspectPlacard = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "placard",
    });
    assert.equal(inspectPlacard.ok, true);
    assert.match(inspectPlacard.result.turn_status ?? inspectPlacard.result.public_reason, /A-SYNC OUTPOST A \/\/ BERMUDA BRANCH/);

    const inspectTables = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "folding tables",
    });
    assert.equal(inspectTables.ok, true);
    assert.match(inspectTables.result.turn_status ?? inspectTables.result.public_reason, /folding tables/i);

    const inspectSlats = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "wooden slats",
    });
    assert.equal(inspectSlats.ok, true);
    assert.match(inspectSlats.result.turn_status ?? inspectSlats.result.public_reason, /pine slats/i);

    const inspectRadio = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "radio interface",
    });
    assert.equal(inspectRadio.ok, true);
    assert.match(inspectRadio.result.turn_status ?? inspectRadio.result.public_reason, /radio interface/i);

    const inspectBoxes = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "emptied boxes",
    });
    assert.equal(inspectBoxes.ok, true);
    assert.match(inspectBoxes.result.turn_status ?? inspectBoxes.result.public_reason, /corrugated boxes/i);

    const inspectScrewdrivers = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "screwdrivers",
    });
    assert.equal(inspectScrewdrivers.ok, true);
    assert.match(inspectScrewdrivers.result.turn_status ?? inspectScrewdrivers.result.public_reason, /screwdrivers/i);

    const inspectTapeOutpost = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "INSPECT",
      target: "green tape",
    });
    assert.equal(inspectTapeOutpost.ok, true);
    assert.match(inspectTapeOutpost.result.turn_status ?? inspectTapeOutpost.result.public_reason, /terminates|ends/i);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
    fs.rmSync(appData2, { recursive: true, force: true });
  }
});

test("y92 — CQ4 Day 1 Opener: Delivery Mechanics (Room Entry Alone Does Not Complete; Duffle Deposit Required)", async () => {
  const { appDataPath, service, world } = createTestOpenerService("delivery-mechanics-test");
  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");
    const coworker2 = entry.run.expedition.team.members[2];

    // 1. Duffle is held by Coworker 2 initially in utility-room
    const duffle = Object.values(entry.run.expedition.logistics.items).find((i) => i.template === "startup-materials-duffle");
    assert.ok(duffle, "Duffle exists in logistics");
    assert.equal(duffle.current_holder, coworker2.identity, "Duffle starts with Coworker 2");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Delivery is false at start");

    // 2. Dropping duffle in wrong room (utility-room) does not complete delivery
    const wrongRoomDrop = service.submitQ4Logistics({
      world_id: world.id,
      action: "DROP",
      item_id: duffle.id,
      actor: coworker2.identity,
    });
    assert.equal(wrongRoomDrop.ok, true);
    assert.equal(duffle.current_location, "utility-room");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Dropping in wrong room does not satisfy delivery");

    // Pick duffle back up
    const pickUp = service.submitQ4Logistics({
      world_id: world.id,
      action: "CARRY",
      item_id: duffle.id,
      actor: coworker2.identity,
    });
    assert.equal(pickUp.ok, true, "Coworker 2 carries duffle again");
    assert.equal(duffle.current_holder, coworker2.identity);

    // 3. Move team to intermediate corridor
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Delivery is false in corridor");

    // 4. Entering Outpost A alone does NOT complete delivery while duffle is still held
    // Move to Outpost A: Coworker 2 enters with duffle
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");

    // Entering Outpost A produces opportunity but does NOT automatically drop the bag
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, false, "Entering Outpost A alone does NOT complete delivery");
    assert.equal(duffle.current_holder, coworker2.identity, "Coworker 2 is still holding the duffle upon arrival");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), false, "Delivery is false while duffle is held");

    // Autonomous delivery decision or explicit turn executes drop at Outpost A
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true, "Autonomous delivery marked delivery_completed");
    const currentDuffle = entry.run.expedition.logistics.items[duffle.id];
    assert.equal(currentDuffle.current_location, "outpost-a", "Duffle location is outpost-a");
    assert.equal(currentDuffle.current_holder, null, "Duffle is unheld");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true, "verifyDelivery is true once duffle is placed unheld at Outpost A");

    // Verify dialogue event from coworker 2 on delivery
    const events = presentationBus.inspectEvents(world.id);
    const deliveryDialogue = events.find((e) => e.type === "dialogue" && /startup materials duffle/i.test(e.text));
    assert.ok(deliveryDialogue, "Coworker 2 emitted delivery dialogue");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("y92 — CQ4 Day 1 Opener: Surveillance Return, Written Report, and Demo Termination", async () => {
  const { appDataPath, service, world } = createTestOpenerService("surveillance-return-test");
  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");

    // Move to Outpost A along the green tape
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true, "Delivery confirmed at Outpost A");

    // 1. Begin Return: initiate return procedure
    const beginReturn = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "RETURN",
    });
    assert.equal(beginReturn.ok, true);
    assert.equal(entry.phase.phase_id, "RETURN");

    // 2. Retrace route along green tape back to KV31
    // From Outpost A to corridor
    const retrace1 = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "back",
    });
    assert.equal(retrace1.ok, true);
    assert.ok(entry.run.spatial.player_location.startsWith("corridor-bermuda-"));

    // From corridor to utility-room
    const retrace2 = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "west",
    });
    assert.equal(retrace2.ok, true);
    assert.equal(entry.run.spatial.player_location, "utility-room");

    // From utility-room to threshold-side-entry
    const retrace3 = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "threshold-side-entry",
    });
    assert.equal(retrace3.ok, true);
    assert.equal(entry.run.spatial.player_location, "threshold-side-entry");

    // 3. COMPLETE_RETURN before radio surveillance verification MUST fail
    assert.equal(entry.run.expedition.day1_opener.return_surveillance_verified, false);
    const prematureReturn = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "COMPLETE_RETURN",
    });
    assert.equal(prematureReturn.ok, false, "COMPLETE_RETURN before surveillance verification must fail");
    assert.equal(prematureReturn.error.code, "RETURN_SURVEILLANCE_UNVERIFIED");

    // 4. Radio contact at KV31 boundary receives Control Room confirmation
    const radioContact = service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Control Room, Team Lead Thorne at KV31. Materials delivered to Outpost A. Standing by for return logging.",
    });
    assert.equal(radioContact.ok, true);
    assert.equal(entry.run.expedition.day1_opener.return_surveillance_verified, true, "Surveillance verified via radio at KV31");

    const events = presentationBus.inspectEvents(world.id);
    const controlMessage = events.find((e) => e.type === "radio" && e.speaker === "CONTROL ROOM" && /logging the return/i.test(e.text));
    assert.ok(controlMessage, "Control room surveillance confirmation emitted");

    // 5. COMPLETE_RETURN now succeeds and transitions to REPORT phase
    const completeReturn = service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "COMPLETE_RETURN",
    });
    assert.equal(completeReturn.ok, true, "COMPLETE_RETURN succeeds");
    assert.equal(entry.run.lifecycle, "completed", "Run lifecycle is completed");
    assert.equal(entry.phase.phase_id, "REPORT", "Transitions to REPORT phase");

    // 6. Submit written expedition report
    const reportSubmission = service.submitReferenceWrittenReport({
      world_id: world.id,
      text: "Field Lead Marcus Thorne reporting. Startup materials duffle successfully deposited at Outpost A Bermuda Branch. Route marked by green tape traversed and retraced without incident. Full team accounted for at KV31.",
    });
    assert.equal(reportSubmission.ok, true, "Written report accepted");
    assert.equal(entry.phase.phase_id, "DEBRIEF", "Transitions to DEBRIEF phase");

    // 7. Check projection for demo_termination in DEBRIEF
    const projection = service.projectionFor(world.id, "field-researcher");
    assert.ok(projection.demo_termination, "demo_termination is present in projection");
    assert.equal(projection.demo_termination.status_text, "NO FURTHER ASSIGNMENTS AVAILABLE");

    // 8. Attempting to advance operations returns NO_FURTHER_ASSIGNMENTS
    const advanceAttempt = service.advanceQ4Operations({ world_id: world.id });
    assert.equal(advanceAttempt.ok, false, "advanceQ4Operations must be rejected for opener demo");
    assert.equal(advanceAttempt.error.code, "NO_FURTHER_ASSIGNMENTS");
    assert.equal(advanceAttempt.error.message, "NO FURTHER ASSIGNMENTS AVAILABLE");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
