"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");
const { DesktopService } = require(path.join(repoRoot, "desktop/service"));
const q4Career = require(path.join(repoRoot, "tools/q4-career-loop"));
const q4Continuity = require(path.join(repoRoot, "tools/q4-continuity"));
const procedural = require(path.join(repoRoot, "tools/procedural-complex"));
const proceduralV2 = require(path.join(repoRoot, "tools/procedural-complex-v2"));
const decisionScheduler = require(path.join(repoRoot, "tools/decision-scheduler"));
const spatialRuntime = require(path.join(repoRoot, "tools/spatial-runtime"));
const logisticsRuntime = require(path.join(repoRoot, "tools/logistics-runtime"));
const cq4Day1Opener = require(path.join(repoRoot, "tools/cq4-day1-opener"));

async function main() {
  console.log("=== BEGIN BROADER GAMEPLAY & SIMULATION AUDIT PROBE ===");
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-broader-audit-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "procedural-survey"
  });

  try {
    // 1. Multi-Expedition Lifecycle & Career Loop
    console.log("\n--- TEST 1: Procedural Survey Expedition Execution ---");
    const worldRes = service.createWorld({ name: "Broader Simulation World", seed: "emergent-seed-1" });
    const worldId = worldRes.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Miller, Frank" });

    const op1 = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "procedural-survey" });
    assert.equal(op1.ok, true, "Procedural survey session start must succeed");
    const entry1 = service.session(worldId, "field-researcher");
    console.log("Op 1 Mission ID:", entry1.run.expedition.mission?.id);
    console.log("Op 1 Mission Objective:", entry1.run.expedition.mission?.objective?.primary);
    console.log("Op 1 Team Roster:", entry1.run.expedition.team.members.map(m => `${m.display_name} (${m.role})`));

    // 2. Procedural Complex Generation
    console.log("\n--- TEST 2: Procedural Complex Generation ---");
    const v1State = procedural.initialize({ seed: "complex-seed-v1", observer: "test-observer" });
    const v1Nodes = Object.keys(v1State.nodes);
    console.log(`Procedural V1 generated ${v1Nodes.length} nodes from seed.`);
    console.log("Sample V1 nodes:", v1Nodes.slice(0, 5).map(id => ({ id, alias: v1State.nodes[id].alias, depth: v1State.nodes[id].depth })));

    const v2State = proceduralV2.initialize({ seed: "complex-seed-v2", observer: "test-observer", policy: "moderate" });
    const v2Nodes = Object.keys(v2State.nodes);
    console.log(`Procedural V2 generated ${v2Nodes.length} nodes from seed.`);
    console.log("Sample V2 nodes:", v2Nodes.slice(0, 5).map(id => ({ id, alias: v2State.nodes[id].alias, zone: v2State.nodes[id].zone })));

    // 3. Internal behavioral fixture exercised through the public turn loop.
    // The explicit state setup below is not player-facing reachability evidence.
    console.log("\n--- TEST 3: Internal Coworker Behavior Fixture Through Public Turn Resolution ---");
    const run1 = entry1.run;
    const expedition1 = run1.expedition;
    const player1 = run1.session.startup.player.observer_id;
    const cw = expedition1.team.members.find(m => m.personnel_id !== player1);

    // Onboard into field operation
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" }); // Staging
    service.selectQ4OptionalStore({ world_id: worldId, item_id: "spare-battery" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "PROCEED" }); // Transit
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "APPROACH" }); // Threshold
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" }); // Radio check
    service.submitQ4Communication({ world_id: worldId, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CROSS" }); // Field operation
    console.log("Entered FIELD_OPERATION in procedural survey at:", entry1.run.spatial.player_location);

    // 3A. Behavioral assertions: Fatigue accumulation under active non-wait task via public service.submitAction
    console.log("\n[3A] Testing fatigue resolution after explicit internal fixture setup:");
    cw.current_task = { type: "operate", state: "active", target: "survey-instrument" };
    cw.fatigue = 0;
    cw.stress = 0;
    cw.behavioral_state = "routine";

    for (let step = 1; step <= 8; step++) {
      cw.current_task = { type: "operate", state: "active", target: "survey-instrument" };
      const waitRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "WAIT" });
      assert.equal(waitRes.ok, true, `Turn ${step}: WAIT must succeed`);
      assert.equal(cw.fatigue, step, `Turn ${step}: expected fatigue ${step}, got ${cw.fatigue}`);
    }
    console.log(`Coworker fatigue after 8 active intervals: ${cw.fatigue} (Expected: 8)`);
    assert.equal(cw.fatigue, 8);
    assert.equal(cw.behavioral_state, "cautious", "Behavioral state must transition to cautious when stress+fatigue >= 8");
    console.log(`Coworker behavioral state transitioned to: ${cw.behavioral_state} (Expected: cautious)`);

    // 3B. Behavioral assertions: Fatigue recovery under resting/waiting via public service.submitAction
    console.log("\n[3B] Testing recovery resolution after explicit internal fixture setup:");
    cw.current_task = { type: "wait", state: "active", target: null };
    const waitDecay1 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "WAIT" });
    assert.equal(waitDecay1.ok, true);
    assert.equal(cw.fatigue, 7.5, "Fatigue must decay by 0.5 per wait interval");
    for (let r = 0; r < 8; r++) {
      cw.current_task = { type: "wait", state: "active", target: null };
      service.submitAction({ world_id: worldId, mode: "field-researcher", action: "WAIT" });
    }
    console.log(`Coworker fatigue after recovery: ${cw.fatigue}`);
    assert.ok(cw.fatigue <= 3.5, "Fatigue must have significantly recovered");
    assert.equal(cw.behavioral_state, "routine", "Behavioral state must recover to routine when stress+fatigue < 4");
    console.log(`Coworker behavioral state recovered to: ${cw.behavioral_state} (Expected: routine)`);

    // 3C. Behavioral assertions: Coworker Autonomy & Separation via public MOVE and WAIT
    console.log("\n[3C] Testing Autonomous Decision Scheduling (Lost Contact & Separation):");
    // Order coworker to hold position using public submitAction
    const holdOrder = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ORDER_HOLD", target: cw.personnel_id });
    assert.equal(holdOrder.ok, true, "ORDER_HOLD must succeed");
    assert.equal(cw.current_task?.type, "hold");

    // Player moves to open passage using public submitAction
    const moveAway = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "SOUTHEAST — Open Passage" });
    assert.equal(moveAway.ok, true, "Player MOVE away must succeed");
    assert.equal(entry1.run.spatial.player_location, "open-passage");
    assert.equal(entry1.run.spatial.personnel_locations[cw.personnel_id], "utility-room");

    // When coworker has follow task while separated, autonomous restore-contact is scheduled on next WAIT
    cw.current_task = { type: "follow", state: "active", target: player1 };
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "WAIT" });

    assert.equal(cw.current_task?.type, "restore-contact", "Autonomous decision scheduler must detect lost contact and schedule restore-contact");
    assert.equal(cw.current_intent, "restore contact with expedition lead");
    console.log("Autonomous decision triggered on separation:", {
      member: cw.personnel_id,
      updated_task: cw.current_task?.type,
      intent: cw.current_intent
    });

    // Move player back to utility-room
    const moveBack = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "NORTHWEST — Utility Room" });
    assert.equal(moveBack.ok, true, "Player MOVE back to utility room must succeed");
    // Order coworker to follow again via public submitAction
    const followOrder = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ORDER_FOLLOW", target: cw.personnel_id });
    assert.equal(followOrder.ok, true, "ORDER_FOLLOW must succeed");

    // 4. Logistics, Wear, & Consumable Depletion
    console.log("\n--- TEST 4: Logistics, Wear, & Consumable Depletion ---");

    // 4A. Radio battery depletion via actual public transmissions
    console.log("[4A] Testing Equipment Charge Depletion (via public submitQ4Communication):");
    const radio = expedition1.equipment["survey-radio"];
    console.log("Initial radio charges:", radio.charges);
    assert.equal(radio.charges, 8);

    // Transmit 8 actual standard radio messages through public entry point
    for (let t = 1; t <= 8; t++) {
      const txRes = service.submitQ4Communication({
        world_id: worldId,
        channel: "standard",
        text: `Standard, survey team status transmission ${t}.`
      });
      assert.equal(txRes.ok, true, `Transmission ${t} must succeed`);
      assert.equal(radio.charges, 8 - t, `After transmission ${t}, remaining charges must be ${8 - t}`);
    }
    console.log(`After 8 public radio transmissions: ${radio.charges} charges remaining (Expected: 0)`);
    assert.equal(radio.charges, 0);

    // 9th transmission attempt on depleted radio MUST be rejected with STANDARD_UNAVAILABLE
    const attempt9 = service.submitQ4Communication({
      world_id: worldId,
      channel: "standard",
      text: "Standard, 9th transmission attempt after battery depletion."
    });
    assert.equal(attempt9.ok, false, "Transmission with 0 charges must fail");
    assert.equal(attempt9.error.code, "STANDARD_UNAVAILABLE");
    console.log("Attempted 9th transmission rejected with code:", attempt9.error.code);

    // 4B. Consumable replenishment & film depletion via public submitQ4Logistics
    console.log("\n[4B] Testing Consumable Item Replenishment & Depletion (via public submitQ4Logistics):");
    const camHolder = expedition1.equipment["recording-device"].holder;
    const initialExposures = expedition1.equipment["recording-device"].charges;
    assert.equal(initialExposures, 24, "Camera begins with canonical 24 exposures");

    // Deplete camera by its assigned holder via public submitQ4Logistics
    const useCam = service.submitQ4Logistics({
      world_id: worldId,
      action: "USE",
      item_id: "recording-device",
      quantity: initialExposures,
      actor: camHolder
    });
    assert.equal(useCam.ok, true, "Depleting camera exposures via submitQ4Logistics must succeed");
    assert.equal(expedition1.equipment["recording-device"].charges, 0);
    console.log(`Camera exposures depleted from ${initialExposures} to 0!`);

    // Attempting further exposure when depleted MUST be rejected with ITEM_UNAVAILABLE
    const camDepletedFail = service.submitQ4Logistics({
      world_id: worldId,
      action: "USE",
      item_id: "recording-device",
      quantity: 1,
      actor: camHolder
    });
    assert.equal(camDepletedFail.ok, false);
    assert.equal(camDepletedFail.error.code, "ITEM_UNAVAILABLE");
    console.log("Attempted USE with 0 camera charges rejected with code:", camDepletedFail.error.code);

    // Replenish camera using spare-film via public submitQ4Logistics
    if (!expedition1.equipment["spare-film"]) {
      service.submitQ4Logistics({
        world_id: worldId,
        action: "CARRY",
        item_id: "spare-film",
        actor: player1
      });
    }
    const handOver = service.submitQ4Logistics({
      world_id: worldId,
      action: "HAND_OVER",
      item_id: "spare-film",
      actor: player1,
      target_holder: camHolder
    });
    assert.equal(handOver.ok, true, "Hand over spare film to camera technician must succeed");

    const replenishRes = service.submitQ4Logistics({
      world_id: worldId,
      action: "REPLENISH",
      item_id: "recording-device",
      source_item_id: "spare-film",
      actor: camHolder
    });
    assert.equal(replenishRes.ok, true, "Camera replenishment via submitQ4Logistics must succeed");
    assert.equal(expedition1.equipment["recording-device"].charges, 24, "Camera exposures restored to 24");
    assert.equal(expedition1.equipment["spare-film"].quantity, 0, "Spare film roll consumed to 0");
    console.log("Replenished camera exposures back to:", expedition1.equipment["recording-device"].charges);
    console.log("Spare film consumed quantity:", expedition1.equipment["spare-film"].quantity);

    const secondReplenishFail = service.submitQ4Logistics({
      world_id: worldId,
      action: "REPLENISH",
      item_id: "recording-device",
      source_item_id: "spare-film",
      actor: camHolder
    });
    assert.equal(secondReplenishFail.ok, false);
    assert.equal(secondReplenishFail.error.code, "REPLENISHMENT_UNAVAILABLE");
    console.log("Attempted replenishment with consumed film rejected with code:", secondReplenishFail.error.code);

    // 5. Complete Return and Advance Operations (Multi-Expedition Lifecycle)
    console.log("\n--- TEST 5: Complete Return, Debrief, and ADVANCE_OPERATIONS ---");
    const retRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "RETURN" });
    assert.equal(retRes.ok, true);
    const moveRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    assert.equal(moveRes.ok, true);

    // If any radio transmission is in-flight (delayed due to complex interference), wait until delivered
    while ((service.session(worldId, "field-researcher").run.expedition.messages ?? []).some(m => ["queued", "transmitting", "delayed"].includes(m.state))) {
      service.submitAction({ world_id: worldId, mode: "field-researcher", action: "WAIT" });
    }

    const completeReturnRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(completeReturnRes.ok, true, "COMPLETE_RETURN must succeed at threshold-side-entry");

    // In procedural-survey, verify prerequisites before advancing
    const freshEntry1 = service.session(worldId, "field-researcher");
    assert.equal(freshEntry1.kind, "bootstrap", "Prerequisite: entry.kind === bootstrap");
    assert.equal(freshEntry1.run.lifecycle, "completed", "Prerequisite: run.lifecycle === completed");
    assert.equal(freshEntry1.phase.phase_id, "DEBRIEF", "Prerequisite: phase === DEBRIEF");
    assert.equal(cq4Day1Opener.isOpener(freshEntry1.run?.scenario), false, "Prerequisite: not opener");
    console.log("Operation 1 prerequisites verified: lifecycle=completed, phase=DEBRIEF");

    // Advance operations to expedition 2!
    const advanceRes = service.advanceQ4Operations({ world_id: worldId });
    console.log("advanceQ4Operations result:", advanceRes);
    assert.equal(advanceRes.ok, true, "advanceQ4Operations must succeed");
    assert.equal(advanceRes.result?.outcome, "operations-advanced");

    const entry2 = service.session(worldId, "field-researcher");
    assert.notEqual(entry2.run.run_id, entry1.run.run_id, "Operation 2 must have a newly generated run ID");
    console.log("Expedition 2 Run ID:", entry2.run.run_id);
    console.log("Expedition 2 Mission ID:", entry2.run.expedition.mission?.id);
    console.log("Expedition 2 Mission Objective:", entry2.run.expedition.mission?.objective?.primary);
    console.log("Expedition 2 Roster:", entry2.run.expedition.team.members.map(m => `${m.display_name} (${m.role})`));

    console.log("\n=== BROADER SIMULATION AUDIT PROBE COMPLETED SUCCESSFULLY ===");
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
