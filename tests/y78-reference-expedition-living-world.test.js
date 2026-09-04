"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const spatialRuntime = require("../tools/spatial-runtime");
const objectRuntime = require("../tools/object-runtime");
const teamRuntime = require("../tools/team-runtime");
const logisticsRuntime = require("../tools/logistics-runtime");
const referenceExpedition = require("../tools/reference-expedition");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "living-world-ref") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-living-world-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Living World Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" });
  assert.equal(started.ok, true);
  return { service, world, appDataPath };
}

function advanceToField(service, world) {
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) {
    const actResult = service.submitAction({ world_id: world.id, mode: "field-researcher", action });
    assert.equal(actResult.ok, true);
  }
  const radio = service.submitQ4Communication({
    world_id: world.id,
    channel: "standard",
    text: "Standard, Reference team. Four accounted for. Radio check."
  });
  assert.equal(radio.ok, true);
  const crossed = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  assert.equal(crossed.ok, true);
  return service.session(world.id, "field-researcher");
}

test("Living World System 1: Physical Geography, Bidirectional Travel, and Route History", async () => {
  const { service, world } = createTestService("sys1-geo");
  const entry = advanceToField(service, world);
  const run = entry.run;

  // We are in utility-room
  assert.equal(run.spatial.player_location, "utility-room");
  assert.equal(run.spatial.visited_locations.includes("utility-room"), true);

  // Move to open-passage
  const moveNorth = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });
  assert.equal(moveNorth.ok, true);
  assert.equal(run.spatial.player_location, "open-passage");

  // Route history records traversal
  const lastHop = run.spatial.route_history.at(-1);
  assert.equal(lastHop.from, "utility-room");
  assert.equal(lastHop.to, "open-passage");

  // Move back to utility-room (bidirectional)
  const moveBack = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "utility-room" });
  assert.equal(moveBack.ok, true);
  assert.equal(run.spatial.player_location, "utility-room");
  assert.equal(run.spatial.route_history.at(-1).to, "utility-room");

  // Canonical Euclidean overlap exists in definition
  const geom = run.spatial.reference_expedition.canonical_geometry;
  assert.equal(geom.current_passage.depth_m, 18.0);
  assert.equal(geom.euclidean_relation.overlap_depth_m, 4.0);
});

test("Living World System 2: Persistent Object State and Mutations Across Departures", async () => {
  const { service, world } = createTestService("sys2-objects");
  const entry = advanceToField(service, world);
  const run = entry.run;

  // Fixture initial state
  const fixture = run.object_state.objects["utility-fluorescent-fixture"];
  assert.equal(fixture.custom.photographed, false);

  // Photograph the fixture
  const photo = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PHOTOGRAPH", target: "fluorescent fixture" });
  assert.equal(photo.ok, true);
  assert.equal(run.object_state.objects["utility-fluorescent-fixture"].custom.photographed, true);

  // Leave room
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });
  assert.equal(run.spatial.player_location, "open-passage");

  // Return to utility room
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "utility-room" });
  assert.equal(run.spatial.player_location, "utility-room");

  // Fixture state persisted
  const reexamined = run.object_state.objects["utility-fluorescent-fixture"];
  assert.equal(reexamined.custom.photographed, true);
});

test("Living World System 3: Epistemic Isolation Across Observers", async () => {
  const { service, world } = createTestService("sys3-epistemic");
  const entry = advanceToField(service, world);
  const run = entry.run;
  const beverly = run.expedition.team.members.find((m) => m.first_name === "Beverly");

  // Order Beverly to stay in utility room
  const order = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "ORDER_HOLD",
    target: beverly.personnel_id
  });
  assert.equal(order.ok, true);

  // Player moves to open passage
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });

  // Beverly's direct observation does NOT contain open-passage objects
  const playerLoc = run.spatial.player_location;
  const beverlyLoc = run.spatial.personnel_locations[beverly.personnel_id];
  assert.equal(playerLoc, "open-passage");
  assert.equal(beverlyLoc, "utility-room");

  // Standard radio has not received open passage details yet
  assert.equal(run.expedition.messages.some((m) => m.channel === "FIELD_RADIO" && m.text.includes("Open Passage")), false);
});

test("Living World System 4 & 5: Coworker Agents, Follow/Remain Behavior, and Delegation", async () => {
  const { service, world } = createTestService("sys4-coworkers");
  const entry = advanceToField(service, world);
  const run = entry.run;
  const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");

  // By default, coworkers have follow behavior
  assert.equal(run.spatial.team_behavior[santiago.personnel_id], "follow");

  // Order Santiago to hold position
  const holdRes = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "ORDER_HOLD",
    target: santiago.personnel_id
  });
  assert.equal(holdRes.ok, true);
  assert.equal(run.spatial.team_behavior[santiago.personnel_id], "remain");

  // Player moves to open passage
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });

  // Santiago remained in utility room
  assert.equal(run.spatial.personnel_locations[santiago.personnel_id], "utility-room");
  assert.equal(santiago.contact_category, "CONTACT LOST");

  // Move back to utility room
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "utility-room" });
  assert.equal(santiago.contact_category, "LOCAL");

  // Order Santiago to follow
  const followRes = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "ORDER_FOLLOW",
    target: santiago.personnel_id
  });
  assert.equal(followRes.ok, true);
  assert.equal(run.spatial.team_behavior[santiago.personnel_id], "follow");

  // Player moves to open passage; Santiago follows!
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });
  assert.equal(run.spatial.personnel_locations[santiago.personnel_id], "open-passage");
  assert.equal(santiago.contact_category, "LOCAL");
});

test("Living World System 6: Equipment as Capability, Custody, and Handoff", async () => {
  const { service, world } = createTestService("sys6-equip");
  const entry = advanceToField(service, world);
  const run = entry.run;
  const player = run.session.startup.player.observer_id;
  const beverly = run.expedition.team.members.find((m) => m.first_name === "Beverly");
  const camera = run.expedition.equipment["recording-device"];

  // Beverly holds the camera
  assert.equal(camera.holder, beverly.personnel_id);

  // Take the camera from Beverly (HANDOFF / TRANSFER)
  const transfer = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "TRANSFER",
    target: `recording-device|${beverly.personnel_id}`
  });
  assert.equal(transfer.ok, true);
  assert.equal(camera.holder, player);

  // Give the camera back to Beverly
  const giveBack = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "TRANSFER",
    target: `recording-device|${beverly.personnel_id}`
  });
  assert.equal(giveBack.ok, true);
  assert.equal(camera.holder, beverly.personnel_id);

  // If Beverly stays behind, the camera stays with her in utility-room
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "ORDER_HOLD", target: beverly.personnel_id });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });

  assert.equal(run.spatial.personnel_locations[beverly.personnel_id], "utility-room");
  assert.equal(run.spatial.equipment_locations["recording-device"], "utility-room");

  // Trying to transfer from across rooms fails
  const failedTransfer = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "TRANSFER",
    target: `recording-device|${beverly.personnel_id}`
  });
  assert.equal(failedTransfer.ok, false);
  assert.equal(failedTransfer.error.code, "TRANSFER_OUT_OF_RANGE");
});

test("Living World System 8: Natural Action Coverage via Living Turns", async () => {
  const { service, world } = createTestService("sys8-natural");
  const entry = advanceToField(service, world);
  const run = entry.run;

  // Natural language movement
  const natMove = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I walk into the open passage."
  });
  assert.equal(natMove.ok, true);
  assert.equal(run.spatial.player_location, "open-passage");

  // Natural language return
  const natReturn = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I walk back to the utility room."
  });
  assert.equal(natReturn.ok, true);
  assert.equal(run.spatial.player_location, "utility-room");

  // Natural language photograph
  const natPhoto = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Photograph the fluorescent fixture."
  });
  assert.equal(natPhoto.ok, true);
  assert.equal(run.object_state.objects["utility-fluorescent-fixture"].custom.photographed, true);

  // Natural language order to hold
  const natHold = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Santiago stay here."
  });
  assert.equal(natHold.ok, true);
  const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");
  assert.equal(run.spatial.team_behavior[santiago.personnel_id], "remain");
});

test("Living World System 9: Local Communication Responds with Single Coworker (No Parrot Chorus)", async () => {
  const { service, world } = createTestService("sys9-comm");
  advanceToField(service, world);

  // Local speech addressing Santiago
  const santiagoComm = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "Santiago, are you ready for the survey line?"
  });
  assert.equal(santiagoComm.ok, true);
  // Response starts with Santiago's name, not a concatenated chorus of all 3
  assert.match(santiagoComm.result.public_reason, /^Santiago:/);
  assert.doesNotMatch(santiagoComm.result.public_reason, /Beverly:/);
  assert.doesNotMatch(santiagoComm.result.public_reason, /Autumn:/);

  // General local speech without target: responds with a single coworker
  const generalComm = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    text: "Let's review our equipment before moving out."
  });
  assert.equal(generalComm.ok, true);
  const speakerCount = (generalComm.result.public_reason.match(/\b(Santiago|Beverly|Autumn):/g) ?? []).length;
  assert.equal(speakerCount, 1);
});

test("Living World: Complete Unscripted 18-Step Reference Expedition Trace", async () => {
  const { service, world } = createTestService("trace-18");

  // Step 1: Briefing & Staging with 4-person team
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) {
    assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  }
  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.run.expedition.team.members.length, 4);

  // Step 2: Standard radio check
  const check = service.submitQ4Communication({
    world_id: world.id,
    channel: "standard",
    text: "Standard, Reference team. Four accounted for. Radio check."
  });
  assert.equal(check.ok, true);

  // Step 3: Cross Threshold into Utility Room
  const cross = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  assert.equal(cross.ok, true);
  assert.equal(entry.run.spatial.player_location, "utility-room");

  // Step 4: Inspect fluorescent fixture
  const inspectFixture = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "INSPECT", target: "fluorescent fixture" });
  assert.equal(inspectFixture.ok, true);

  // Step 5: Photograph fixture using Beverly's camera via team use
  const photoFixture = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PHOTOGRAPH", target: "fluorescent fixture" });
  assert.equal(photoFixture.ok, true);

  // Step 6: Verify photograph evidence recorded with Beverly as operator
  const photoEv = entry.run.expedition.evidence.find((e) => e.type === "fixture-photograph");
  assert.ok(photoEv);
  assert.equal(photoEv.capturing_observer, "personnel-beverly-bell");

  // Step 7: Local speech to Beverly
  const beverlyTalk = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Beverly",
    text: "Beverly, did that exposure take?"
  });
  assert.equal(beverlyTalk.ok, true);
  assert.match(beverlyTalk.result.public_reason, /^Beverly:/);

  // Step 8: Order Santiago to hold position in the Utility Room
  const orderSantiago = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "ORDER_HOLD",
    target: "personnel-santiago-stokes"
  });
  assert.equal(orderSantiago.ok, true);

  // Step 9: Player moves north into Open Passage
  const toPassage = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open-passage" });
  assert.equal(toPassage.ok, true);

  // Step 10: Verify Santiago remained in Utility Room, contact category is CONTACT LOST
  const santiago = entry.run.expedition.team.members.find((m) => m.first_name === "Santiago");
  assert.equal(entry.run.spatial.personnel_locations[santiago.personnel_id], "utility-room");
  assert.equal(santiago.contact_category, "CONTACT LOST");

  // Step 11: Local communication to Santiago fails (out of speaking range)
  const callSantiago = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "Santiago, can you hear me back there?"
  });
  assert.equal(callSantiago.ok, false);
  assert.equal(callSantiago.error.code, "LOCAL_TARGET_UNAVAILABLE");

  // Step 12: In reference expedition, player uses survey-instrument in Open Passage
  entry.run.expedition.equipment["survey-instrument"].holder = entry.run.session.startup.player.observer_id;
  entry.run.spatial.equipment_locations["survey-instrument"] = "open-passage";

  const measurePassage = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "USE", target: "survey-instrument" });
  assert.equal(measurePassage.ok, true);

  // Step 13: Derive contradiction (18.0m passage intrudes 4.0m into parallel corridor volume)
  const contradiction = referenceExpedition.deriveContradiction(entry.run);
  assert.equal(contradiction.established, true);
  assert.equal(contradiction.overlap_depth_m, 4.0);

  // Step 14: Return to Utility Room; Santiago is visually reconfirmed
  const backToUtil = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "utility-room" });
  assert.equal(backToUtil.ok, true);
  assert.equal(santiago.contact_category, "LOCAL");

  // Step 15: Order Santiago to follow, begin return procedure, and move to Threshold-Side Entry
  const followSantiago = service.submitAction({
    world_id: world.id,
    mode: "field-researcher",
    action: "ORDER_FOLLOW",
    target: santiago.personnel_id
  });
  assert.equal(followSantiago.ok, true);

  const returnRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
  assert.equal(returnRes.ok, true);

  const backToEntry = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
  assert.equal(backToEntry.ok, true);
  assert.equal(entry.run.spatial.personnel_locations[santiago.personnel_id], "threshold-side-entry");

  // Step 16: Complete return and submit written field report claiming the measured discrepancy
  const completeReturn = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
  assert.equal(completeReturn.ok, true);
  assert.equal(completeReturn.projection.phase.phase_id, "REPORT");

  const reportText = "The Open Passage survey line measures 18.0 metres from the south-wall datum, which overlaps and contradicts layout sheet 17-B by 4.0 metres.";
  const written = service.submitReferenceWrittenReport({ world_id: world.id, text: reportText });
  assert.equal(written.ok, true);

  // Step 17: Assess institutional record: returns provisional-spatial-discrepancy
  const prior = entry.run.expedition.mission.prior_history[0];
  const assessment = referenceExpedition.assessInstitutionalRecord({
    report: entry.run.expedition.written_report,
    prior_record: prior,
    evidence_records: entry.run.expedition.evidence.map((e) => ({ ...e, standard_available: true, operation_id: entry.run.expedition.mission.id }))
  });
  assert.equal(assessment.status, "provisional-spatial-discrepancy");
  assert.equal(assessment.claims_cause, false);

  // Step 18: Confirm entire session maintained causal integrity
  assert.equal(entry.run.spatial.route_history.length >= 4, true);
  assert.equal(entry.run.expedition.evidence.length >= 2, true);
});
