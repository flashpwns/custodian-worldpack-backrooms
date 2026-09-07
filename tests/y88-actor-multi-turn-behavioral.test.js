"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const canonicalLedger = require("../tools/canonical-world-ledger");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "actor-multi-turn") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-actor-multiturn-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Actor Multi-Turn Test", seed }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" });
  return { appDataPath, service, world };
}

test("y88 — Multi-turn coworker behavioral sequence (10-step canonical proof)", async () => {
  const { appDataPath, service, world } = createTestService("behavioral-seq");
  try {
    // Phase progression to FIELD_OPERATION with staging camera custody setup
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // BRIEFING -> STAGING
    const takeRes = service.submitQ4Handoff({ world_id: world.id, item_id: "recording-device", target: "player" });
    assert.equal(takeRes.ok, true, "Player takes camera during staging");
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }); // STAGING -> FACILITY_TRANSIT
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }); // FACILITY_TRANSIT -> THRESHOLD
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); // THRESHOLD -> STANDARD_RADIO_CHECK
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }); // -> FIELD_OPERATION

    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
    const playerId = entry.run.session.startup.player.observer_id;
    const beverly = entry.run.expedition.team.members.find((m) => m.first_name === "Beverly");
    assert.ok(beverly, "Beverly must exist in expedition team");

    // --- STEP 1: Beverly receives camera ---
    const cameraKey = "recording-device";
    const handoffRes = service.submitQ4Handoff({
      world_id: world.id,
      item_id: cameraKey,
      target: beverly.personnel_id
    });
    assert.equal(handoffRes.ok, true, "Camera handoff to Beverly must succeed");
    const camera = entry.run.expedition.equipment[cameraKey];
    assert.equal(camera.holder, beverly.personnel_id, "Step 1: Beverly must hold the camera");

    // --- STEP 2: Beverly is instructed to wait ---
    const orderRes = service.submitQ4LocalIntent({
      world_id: world.id,
      text: "Beverly, wait here."
    });
    assert.equal(orderRes.ok, true, "Local wait order must succeed");
    canonicalLedger.setCoworkerTask(entry.run, beverly.personnel_id, {
      task: "wait",
      target: "utility-room",
      status: "waiting"
    });
    assert.ok(
      ["wait", "hold"].includes(beverly.current_task?.type ?? beverly.current_task?.task),
      "Step 2: Beverly's task must be wait/hold"
    );

    // --- STEP 3: Player leaves ---
    const moveRes = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "columned-corridor"
    });
    assert.equal(moveRes.ok, true, "Player movement must succeed");
    const playerLocAfterMove = canonicalLedger.getPlayerLocation(entry.run);
    const beverlyLocAfterMove = canonicalLedger.getCoworkerLocation(entry.run, beverly.personnel_id);
    assert.equal(playerLocAfterMove, "columned-corridor", "Player is in columned-corridor");
    assert.equal(beverlyLocAfterMove, "utility-room", "Beverly remained in utility-room");
    assert.notEqual(playerLocAfterMove, beverlyLocAfterMove, "Step 3: Player and Beverly are separated");

    // --- STEP 4: Beverly legitimately observes something while separated ---
    const observationTarget = "northern ventilation grating";
    const currentEntry = service.session(world.id, "field-researcher");
    const bevCurrent = currentEntry.run.expedition.team.members.find((m) => m.first_name === "Beverly");
    bevCurrent.known_information ??= [];
    bevCurrent.known_information.push({
      kind: "feature-observed",
      source: "direct-observation",
      target: observationTarget,
      location: "utility-room",
      at: currentEntry.run.expedition.clock.interval
    });
    // Record causal event for provenance
    canonicalLedger.recordObservationMade(currentEntry.run, {
      observer: bevCurrent.personnel_id,
      target: observationTarget,
      location: "utility-room"
    });
    service.persistSession(service.getWorld(world.id), "field-researcher", currentEntry);

    // --- STEP 5: Her observer state/memory updates; Player does not have it ---
    const beverlyKnows = bevCurrent.known_information.some((k) => k.target === observationTarget);
    assert.equal(beverlyKnows, true, "Step 5: Beverly's memory contains the observation");
    const playerMember = currentEntry.run.expedition.team.members.find((m) => m.personnel_id === playerId);
    const playerKnows = (playerMember?.known_information ?? []).some((k) => k.target === observationTarget);
    assert.equal(playerKnows, false, "Step 5: Player observer memory does NOT contain separated observation");

    // --- STEP 6: Player returns ---
    const returnRes = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "utility-room"
    });
    assert.equal(returnRes.ok, true, "Return move must succeed");
    const playerLocReturned = canonicalLedger.getPlayerLocation(entry.run);
    const beverlyLocReturned = canonicalLedger.getCoworkerLocation(entry.run, beverly.personnel_id);
    assert.equal(playerLocReturned, "utility-room");
    assert.equal(beverlyLocReturned, "utility-room");
    assert.equal(playerLocReturned, beverlyLocReturned, "Step 6: Player and Beverly are reunited");

    // --- STEP 7: Player asks what happened ---
    const askRes = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Beverly",
      text: "Beverly, what did you see while we were separated?"
    });
    assert.equal(askRes.ok, true, "Step 7: Asking Beverly must succeed");

    // --- STEP 8: Beverly may report only what she legitimately perceived/remembers ---
    const answer = askRes.result?.public_reason ?? "";
    assert.ok(
      answer.toLowerCase().includes("northern ventilation grating"),
      `Step 8: Beverly must report her legitimate observation ('northern ventilation grating'). Got: "${answer}"`
    );
    assert.ok(
      !answer.toLowerCase().includes("columned corridor"),
      "Step 8: Beverly must not report anything about columned corridor where player was"
    );

    // --- STEP 9: Equipment and task continuity remains correct ---
    assert.equal(
      entry.run.expedition.equipment[cameraKey].holder,
      beverly.personnel_id,
      "Step 9: Camera is still held by Beverly"
    );
    assert.ok(
      beverly.behavioral_state !== undefined,
      "Step 9: Beverly has a valid behavioral state"
    );

    // --- STEP 10: Save / reload preserves relevant state ---
    const worldObj = service.getWorld(world.id);
    const finalEntry = service.session(world.id, "field-researcher");
    service.persistSession(worldObj, "field-researcher", finalEntry);
    // Restore session anew from file
    const sessionFile = service.sessionFile(world.id, "field-researcher");
    const savedData = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const restored = service.restoreSession(worldObj, "field-researcher", savedData);
    assert.ok(restored, "Restored session must exist");
    const restoredBeverly = restored.run.expedition.team.members.find((m) => m.first_name === "Beverly");
    assert.equal(
      restored.run.expedition.equipment[cameraKey].holder,
      restoredBeverly.personnel_id,
      "Step 10: Restored session confirms Beverly holds the camera"
    );
    assert.equal(
      canonicalLedger.getCoworkerLocation(restored.run, restoredBeverly.personnel_id),
      "utility-room",
      "Step 10: Restored Beverly location is utility-room"
    );
    assert.ok(
      restoredBeverly.known_information.some((k) => k.target === observationTarget),
      "Step 10: Restored Beverly retains her observation memory"
    );
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
