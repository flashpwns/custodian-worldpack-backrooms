"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const q4Personnel = require("../tools/q4-personnel");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
const presentationBus = require("../tools/presentation-bus");
const YBSurfaces = require("../desktop/renderer/surfaces");

function createTestOpenerService(seed = "opener-core-test") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opener-core-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "day1-opener",
  });
  const world = service.createWorld({ name: "Day 1 Opener Core Test", seed }).world;
  return { appDataPath, service, world };
}

test("y91 — CQ4 Day 1 Opener: Identity Verification, Format Parsing, and Rejection", () => {
  const { appDataPath, service, world } = createTestOpenerService("id-format-test");
  try {
    const canonicalWorld = service.getWorld(world.id);
    // 1. Valid "Last, First" input in first_name
    const res1 = q4Personnel.createPlayer(canonicalWorld, { first_name: "Thorne, Marcus" });
    assert.equal(res1.ok, true, "Valid Last, First string must succeed");
    assert.equal(res1.player.first_name, "Marcus");
    assert.equal(res1.player.last_name, "Thorne");
    assert.equal(res1.player.display_name, "Marcus Thorne");
    assert.ok(res1.player.identity.startsWith("q4-player-"));

    // 2. Hash determinism: same names yield identical identity hash
    const expectedIdentity = q4Personnel.identityFor("Marcus", "Thorne");
    assert.equal(res1.player.identity, expectedIdentity);

    // 3. Rejection of invalid names on fresh worlds
    const invalidWorld1 = service.createWorld({ name: "Invalid Name World 1" }).world;
    const inv1 = q4Personnel.createPlayer(service.getWorld(invalidWorld1.id), { first_name: "X" }); // Too short
    assert.equal(inv1.ok, false);
    assert.equal(inv1.code, "PLAYER_NAME_INVALID");

    const invalidWorld2 = service.createWorld({ name: "Invalid Name World 2" }).world;
    const inv2 = q4Personnel.createPlayer(service.getWorld(invalidWorld2.id), { first_name: "12345, 67890" }); // Numbers
    assert.equal(inv2.ok, false);
    assert.equal(inv2.code, "PLAYER_NAME_INVALID");

    const invalidWorld3 = service.createWorld({ name: "Invalid Name World 3" }).world;
    const inv3 = q4Personnel.createPlayer(service.getWorld(invalidWorld3.id), { first_name: "Special@Character!, John" }); // Illegal characters
    assert.equal(inv3.ok, false);
    assert.equal(inv3.code, "PLAYER_NAME_INVALID");

    const invalidWorld4 = service.createWorld({ name: "Invalid Name World 4" }).world;
    const inv4 = q4Personnel.createPlayer(service.getWorld(invalidWorld4.id), { first_name: "" }); // Empty
    assert.equal(inv4.ok, false);
    assert.equal(inv4.code, "PLAYER_NAME_INVALID");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("y91 — CQ4 Day 1 Opener: Dr. Kirk Maxwell Institutional Briefing and Archetypes", () => {
  const { appDataPath, service, world } = createTestOpenerService("maxwell-briefing-test");
  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    const started = service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true, "Opener session started");

    const entry = service.session(world.id, "field-researcher");
    assert.ok(entry, "Session entry present");

    // 1. Dr. Kirk Maxwell exists Standard-side, non-deployable, non-mortal
    const canonicalWorld = service.getWorld(world.id);
    const maxwell = canonicalWorld.characters["dr-kirk-maxwell"];
    assert.ok(maxwell, "Dr. Kirk Maxwell exists in canonical characters");
    assert.equal(maxwell.mortal, false, "Maxwell is non-mortal");
    assert.equal(maxwell.deployable, false, "Maxwell is non-deployable");

    // 2. Opener coworkers possess the 3 required archetypes
    const team = entry.run.expedition.team.members;
    assert.equal(team.length, 4, "Opener team must have exactly 4 members (Lead + 3 coworkers)");

    const coworker1 = team[1];
    const coworker2 = team[2];
    const coworker3 = team[3];

    assert.equal(coworker1.archetype, "first-day-observer");
    assert.equal(coworker1.personality, "nervous-first-day");
    assert.equal(coworker1.primary_task, "verbal-recall");

    assert.equal(coworker2.archetype, "intern-courier");
    assert.equal(coworker2.personality, "intern");
    assert.equal(coworker2.primary_task, "material-delivery");

    assert.equal(coworker3.archetype, "doctor-veteran");
    assert.equal(coworker3.personality, "veteran-doctor");
    assert.equal(coworker3.primary_task, "layout-compilation");

    // 3. Initial equipment distribution
    // Coworker 2 holds startup-materials-duffle
    const duffle = Object.values(entry.run.expedition.logistics.items).find((i) => i.template === "startup-materials-duffle");
    assert.ok(duffle, "Startup materials duffle exists");
    assert.equal(duffle.current_holder, coworker2.identity, "Coworker 2 has initial custody of startup duffle");

    // Coworker 3 holds layout-record
    const layout = Object.values(entry.run.expedition.logistics.items).find((i) => i.template === "layout-record");
    assert.ok(layout, "Layout record exists");
    assert.equal(layout.current_holder, coworker3.identity, "Coworker 3 has initial custody of layout record");

    // 4. Briefing event bus emissions
    const busEvents = presentationBus.inspectEvents(world.id);
    const maxwellEvents = busEvents.filter((e) => e.speaker === "DR. KIRK MAXWELL");
    assert.ok(maxwellEvents.length >= 1, "Maxwell spoken dialogue emitted to presentation bus");
    assert.match(maxwellEvents[0].text, /Good morning, Q4 assignees/);
    assert.equal(maxwellEvents[0].physical_room_voice, true);

    const datedBriefings = busEvents.filter((e) => e.type === "opener_briefing_card");
    assert.ok(datedBriefings.length >= 1, "Dated briefing card emitted");
    assert.match(datedBriefings[0].title, /, 1994 BRIEFING$/);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("y91 — CQ4 Day 1 Opener: Introductions Exit and Staging Flow", async () => {
  const { appDataPath, service, world } = createTestOpenerService("intro-exit-test");
  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    const entry = service.session(world.id, "field-researcher");

    // 1. Chat in BRIEFING
    const chat = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      text: "Everyone ready for today?",
    });
    assert.equal(chat.ok, true);
    assert.equal(entry.phase.phase_id, "BRIEFING", "Chat does not advance phase");

    // 2. Direct procedural exit via natural phrasing
    const exitAction = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Conclude introductions and proceed to equipment staging",
    });
    assert.equal(exitAction.ok, true);
    assert.equal(exitAction.result.executed, true);
    assert.equal(entry.phase.phase_id, "STAGING", "Advances to STAGING");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("y91 — CQ4 Day 1 Opener: Hard 2-Item Carrying Capacity Limit Enforcement", () => {
  const { appDataPath, service, world } = createTestOpenerService("capacity-limit-test");
  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    const entry = service.session(world.id, "field-researcher");

    // Advance to STAGING
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(entry.phase.phase_id, "STAGING");

    const player = entry.run.expedition.team.members[0];
    const coworker1 = entry.run.expedition.team.members[1];
    const coworker2 = entry.run.expedition.team.members[2];

    // Player already carries 2 items: field-camera and field-light
    const playerCarried = Object.values(entry.run.expedition.logistics.items).filter(
      (i) => i.current_holder === player.identity && i.condition !== "dropped"
    );
    assert.equal(playerCarried.length, 2, "Player starts with 2 equipment items");

    // Attempting to acquire a 3rd item via selectQ4OptionalStore must be rejected deterministically
    const thirdItemAttempt = service.selectQ4OptionalStore({
      world_id: world.id,
      item_id: "spare-battery",
    });
    assert.equal(thirdItemAttempt.ok, false, "3rd item must be rejected");
    assert.equal(thirdItemAttempt.error.code, "PERSONNEL_CAPACITY_EXCEEDED");
    assert.match(thirdItemAttempt.error.message, /maximum of 2 mission equipment items/);

    // Attempting to hand off coworker 2's duffle to player (who already has 2 items) must fail
    const duffle = Object.values(entry.run.expedition.logistics.items).find((i) => i.template === "startup-materials-duffle");
    const handoffToPlayer = service.submitQ4Handoff({
      world_id: world.id,
      item_id: duffle.id,
      target: player.identity,
    });
    assert.equal(handoffToPlayer.ok, false, "Handoff causing >2 items must fail");
    assert.equal(handoffToPlayer.error.code, "PERSONNEL_CAPACITY_EXCEEDED");

    // Coworker 1 has 0 items initially. Handoff of 1 item from player to coworker 1 succeeds
    const handoffToCw1 = service.submitQ4Handoff({
      world_id: world.id,
      item_id: playerCarried[0].id,
      target: coworker1.identity,
    });
    assert.equal(handoffToCw1.ok, true, "Handoff to teammate with space succeeds");

    // Now player has 1 item and coworker 1 has 1 item
    // Coworker 2 already has 1 item (duffle). Let's give coworker 2 a second item
    const handoffToCw2 = service.submitQ4Handoff({
      world_id: world.id,
      item_id: playerCarried[1].id,
      target: coworker2.identity,
    });
    assert.equal(handoffToCw2.ok, true, "Coworker 2 receives 2nd item");

    // Coworker 2 now has 2 items. Giving coworker 2 a 3rd item must fail
    const thirdToCw2 = service.submitQ4Handoff({
      world_id: world.id,
      item_id: playerCarried[0].id, // currently on coworker1
      target: coworker2.identity,
    });
    assert.equal(thirdToCw2.ok, false, "Coworker 2 cannot exceed 2 items");
    assert.equal(thirdToCw2.error.code, "PERSONNEL_CAPACITY_EXCEEDED");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("y91 — CQ4 Day 1 Opener: Formal 2-Second Hold Radio Check-In vs Chat", async () => {
  const { appDataPath, service, world } = createTestOpenerService("checkin-hold-test");
  try {
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    const entry = service.session(world.id, "field-researcher");

    // Advance to STANDARD_RADIO_CHECK: BRIEFING -> STAGING -> FACILITY_TRANSIT -> THRESHOLD -> STANDARD_RADIO_CHECK
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(entry.phase.phase_id, "STANDARD_RADIO_CHECK");

    // Verify initial check-in state is null
    assert.equal(entry.run.expedition.last_check_in ?? null, null, "Initially last_check_in is null");

    // 1. Normal chat on STANDARD does NOT update last_check_in
    const chatResult = service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Control, this is Team Lead Thorne on radio test.",
    });
    assert.equal(chatResult.ok, true, "Standard radio communication succeeds");
    assert.equal(entry.run.expedition.last_check_in ?? null, null, "Normal radio chat never updates last_check_in");

    // 2. Insufficient hold (< 2000ms) is rejected
    const shortHold = await service.submitQ4CheckIn({
      world_id: world.id,
      hold_duration_ms: 1900,
    });
    assert.equal(shortHold.ok, false, "Hold < 2000ms must fail");
    assert.equal(shortHold.error.code, "CHECK_IN_HOLD_INSUFFICIENT");
    assert.equal(entry.run.expedition.last_check_in ?? null, null, "Failed hold does not update last_check_in");

    // 3. Sufficient hold (>= 2000ms) succeeds
    const validHold = await service.submitQ4CheckIn({
      world_id: world.id,
      hold_duration_ms: 2050,
    });
    assert.equal(validHold.ok, true, "Hold >= 2000ms succeeds");
    assert.ok(entry.run.expedition.last_check_in, "last_check_in is updated");
    assert.equal(entry.run.expedition.last_check_in.source, "formal_radio_check_in");
    assert.equal(entry.run.expedition.radio_check_completed, true);

    // 4. Verify presentation bus received radio_chirp
    const busEvents = presentationBus.inspectEvents(world.id);
    const chirp = busEvents.find((e) => e.type === "radio_chirp");
    assert.ok(chirp, "radio_chirp event emitted on successful formal check-in");

    // 5. Verify action button is "CLEARED; CROSS?"
    const projection = service.projectionFor(world.id, "field-researcher");
    const actionsHtml = YBSurfaces.render(projection);
    assert.match(actionsHtml, /CLEARED; CROSS\?/, "Opener crossing action is labeled CLEARED; CROSS?");

    // 6. Execute CROSS and verify acoustic shift
    const crossRes = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "CROSS",
    });
    assert.equal(crossRes.ok, true);
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");

    const postCrossEvents = presentationBus.inspectEvents(world.id);
    const shift = postCrossEvents.find((e) => e.type === "crossing_acoustic_shift");
    assert.ok(shift, "crossing_acoustic_shift emitted upon crossing");
    assert.equal(shift.facility_ambient_cut, true);
    assert.equal(shift.metallic_tone, true);
    assert.equal(shift.complex_hum, true);
    assert.equal(shift.near_ringing, true);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
