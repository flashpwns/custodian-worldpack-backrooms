"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

function createTestOpenerService(seed = "opener-coldboot-test") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opener-coldboot-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "day1-opener",
  });
  const world = service.createWorld({ name: "Day 1 Opener Cold Boot Test", seed }).world;
  return { appDataPath, service, world };
}

test("y93 — CQ4 Day 1 Opener: Cold-Boot Persistence Across All 6 Phases Without Entity Duplication", async () => {
  const { appDataPath, world } = createTestOpenerService("coldboot-six-phases");
  let service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Introductions / Briefing (BRIEFING)
    // -------------------------------------------------------------------------
    service.createQ4Personnel({ world_id: world.id, first_name: "Thorne, Marcus" });
    const started = service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    let entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // Cold boot restart 1
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    let resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot in BRIEFING succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");
    assert.equal(entry.run.expedition.team.members.length, 4, "Exact 4-person team preserved");
    const canonicalWorld1 = service.getWorld(world.id);
    assert.ok(canonicalWorld1.characters["dr-kirk-maxwell"], "Maxwell persists Standard-side");
    assert.equal(canonicalWorld1.characters["dr-kirk-maxwell"].deployable, false);

    // -------------------------------------------------------------------------
    // Phase 2: Equipment Staging (STAGING)
    // -------------------------------------------------------------------------
    const readyRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(readyRes.ok, true);
    assert.equal(entry.phase.phase_id, "STAGING");

    // Cold boot restart 2
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot in STAGING succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "STAGING");

    // Verify carrying capacities across all 4 personnel
    for (const member of entry.run.expedition.team.members) {
      const carried = Object.values(entry.run.expedition.logistics.items).filter(
        (i) => i.current_holder === member.identity && !["dropped", "lost", "abandoned"].includes(i.condition)
      );
      assert.ok(carried.length <= 2, `Member ${member.identity} carries ${carried.length} items (<= 2)`);
    }

    // -------------------------------------------------------------------------
    // Phase 3: KV31 Threshold Chamber Radio Check (STANDARD_RADIO_CHECK)
    // -------------------------------------------------------------------------
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }); // FACILITY_TRANSIT
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }); // THRESHOLD
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // STANDARD_RADIO_CHECK
    assert.equal(entry.phase.phase_id, "STANDARD_RADIO_CHECK");

    // Perform 2-second hold radio check
    const checkIn = await service.submitQ4CheckIn({ world_id: world.id, hold_duration_ms: 2050 });
    assert.equal(checkIn.ok, true);
    assert.equal(entry.run.expedition.radio_check_completed, true);
    assert.ok(entry.run.expedition.last_check_in, "last_check_in recorded");

    // Cold boot restart 3
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot in STANDARD_RADIO_CHECK succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "STANDARD_RADIO_CHECK");
    assert.equal(entry.run.expedition.radio_check_completed, true, "Radio check remains completed");
    assert.ok(entry.run.expedition.last_check_in, "last_check_in remains intact");

    // -------------------------------------------------------------------------
    // Phase 4: In the Complex along the green tape (FIELD_OPERATION)
    // -------------------------------------------------------------------------
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
    assert.equal(entry.run.spatial.player_location, "utility-room");

    // Move along green tape into access corridor
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "east" });
    const corridorId = entry.run.spatial.player_location;
    assert.ok(corridorId.startsWith("corridor-bermuda-"));

    // Cold boot restart 4
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot in FIELD_OPERATION succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
    assert.equal(entry.run.spatial.player_location, corridorId, "Player location restored");

    // Verify coworkers remain colocated with team lead
    for (const member of entry.run.expedition.team.members) {
      assert.equal(entry.run.spatial.personnel_locations[member.identity], corridorId, `Coworker ${member.identity} colocated`);
    }

    // Verify route markers and connections
    const markers = entry.run.spatial.route_markers;
    assert.equal(markers.length, 3, "All 3 neon green tape route markers persisted");

    // -------------------------------------------------------------------------
    // Phase 5: At Outpost A after delivery
    // -------------------------------------------------------------------------
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "forward" });
    assert.equal(entry.run.spatial.player_location, "outpost-a");
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true, "Delivery completed");

    // Cold boot restart 5
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot at Outpost A succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.run.spatial.player_location, "outpost-a");
    assert.equal(entry.run.expedition.day1_opener.delivery_completed, true, "Delivery completed flag persisted");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true, "verifyDelivery remains true");

    const duffle = entry.run.expedition.logistics.items["startup-materials-duffle"];
    assert.equal(duffle.current_location, "outpost-a");
    assert.equal(duffle.current_holder, null);

    // -------------------------------------------------------------------------
    // Phase 6: Debrief with demo_termination
    // -------------------------------------------------------------------------
    // Initiate return and retrace route back to KV31
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "back" }); // to corridor
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "west" }); // to utility-room
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" }); // to threshold
    assert.equal(entry.run.spatial.player_location, "threshold-side-entry");

    // Standard surveillance check via radio
    service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Control Room, Team Lead Thorne at KV31. Materials delivered to Outpost A. Requesting visual surveillance log.",
    });
    assert.equal(entry.run.expedition.day1_opener.return_surveillance_verified, true);

    // Complete return -> transitions to REPORT
    const closeRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(closeRes.ok, true);
    assert.equal(entry.phase.phase_id, "REPORT");

    // Submit written report -> transitions to DEBRIEF
    const reportRes = service.submitReferenceWrittenReport({
      world_id: world.id,
      text: "Field Lead Marcus Thorne reporting. Outpost A delivery completed. Guidance route retraced cleanly without casualties.",
    });
    assert.equal(reportRes.ok, true);
    assert.equal(entry.phase.phase_id, "DEBRIEF");

    // Cold boot restart 6
    service.shutdown();
    service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
    assert.equal(resumed.ok, true, "Cold boot in DEBRIEF succeeds");

    entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "DEBRIEF");
    assert.equal(entry.run.lifecycle, "completed");

    // Verify demo_termination in projection
    const projection = service.projectionFor(world.id, "field-researcher");
    assert.ok(projection.demo_termination, "demo_termination present in projection after cold boot");
    assert.equal(projection.demo_termination.status_text, "NO FURTHER ASSIGNMENTS AVAILABLE");

    // Verify advanceQ4Operations rejection
    const advanceRes = service.advanceQ4Operations({ world_id: world.id });
    assert.equal(advanceRes.ok, false);
    assert.equal(advanceRes.error.code, "NO_FURTHER_ASSIGNMENTS");
    assert.equal(advanceRes.error.message, "NO FURTHER ASSIGNMENTS AVAILABLE");

    // Verify no character duplication in canonical world
    const finalWorld = service.getWorld(world.id);
    const playerPersonnel = Object.values(finalWorld.characters).filter((c) => c.role?.includes("Team Lead") || c.identity.startsWith("q4-player-"));
    assert.equal(playerPersonnel.length, 1, "Exactly one player record exists in canonical world");
    const coworkers = entry.run.expedition.team.members.slice(1);
    assert.equal(coworkers.length, 3, "Exactly 3 coworkers in team");
    for (const coworker of coworkers) {
      assert.ok(finalWorld.characters[coworker.identity], `Coworker ${coworker.identity} exists in canonical world characters`);
    }
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
