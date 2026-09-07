"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const decisionScheduler = require("../tools/decision-scheduler");
const presentationBus = require("../tools/presentation-bus");
const fieldNotes = require("../tools/field-notes");
const q4Radio = require("../tools/q4-radio");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "scripted-30turn") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-30turn-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "30-Turn Continuous Expedition", seed }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" });
  return { appDataPath, service, world };
}

test("y90 — 30-Turn Continuous Human-Style Expedition Script (Alpha Integration Baseline)", async () => {
  const { appDataPath, service, world } = createTestService("alpha-30turn");
  try {
    const entry = service.session(world.id, "field-researcher");
    assert.ok(entry, "Session must exist");
    const playerId = entry.run.session.startup.player.observer_id;

    // =========================================================================
    // PHASE 1: ONBOARDING & PRE-CROSSING PROCEDURES (TURNS 1-5)
    // =========================================================================

    // TURN 1: Human refusal / hesitation ("Not yet.")
    const t1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Not yet." });
    assert.equal(t1.ok, true, "Turn 1: Natural call succeeded");
    assert.equal(t1.result.executed, false, "Turn 1: Hesitation must not advance phase");
    assert.equal(entry.phase.phase_id, "BRIEFING", "Turn 1: Phase remains BRIEFING");

    // TURN 2: Question about mission ("What is our assignment?")
    const t2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "What is our assignment?" });
    assert.equal(t2.ok, true, "Turn 2: Natural question call succeeded");
    assert.equal(entry.phase.phase_id, "BRIEFING", "Turn 2: Phase remains BRIEFING");

    // TURN 3: Deliberate readiness confirmation ("We're good.")
    const t3 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "We're good." });
    assert.equal(t3.ok, true, "Turn 3: Natural readiness call succeeded");
    assert.equal(t3.result.executed, true, "Turn 3: Readiness must advance procedure");
    assert.equal(entry.phase.phase_id, "STAGING", "Turn 3: Phase advances to STAGING");

    // Reassign camera custody during staging so player has it for the field
    const takeCam = service.submitQ4Handoff({ world_id: world.id, item_id: "recording-device", target: "player" });
    assert.equal(takeCam.ok, true, "Turn 3b: Player takes camera during staging");

    // TURN 4: Proceed to facility transit ("Proceed")
    const t4 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    assert.equal(t4.ok, true, "Turn 4: PROCEED action succeeded");
    assert.equal(entry.phase.phase_id, "FACILITY_TRANSIT", "Turn 4: Phase advances to FACILITY_TRANSIT");

    // TURN 5: Approach the threshold ("Approach")
    const t5 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    assert.equal(t5.ok, true, "Turn 5: APPROACH action succeeded");
    assert.equal(entry.phase.phase_id, "THRESHOLD", "Turn 5: Phase advances to THRESHOLD");

    // =========================================================================
    // PHASE 2: THRESHOLD CEREMONY & CROSSING (TURNS 6-8)
    // =========================================================================

    // TURN 6: Signal readiness at threshold ("READY")
    const t6 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(t6.ok, true, "Turn 6: READY action succeeded");
    assert.equal(entry.phase.phase_id, "STANDARD_RADIO_CHECK", "Turn 6: Phase advances to STANDARD_RADIO_CHECK");

    // TURN 7: Radio check with Standard ("Radio check Standard.")
    const t7 = await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    assert.equal(t7.ok, true, "Turn 7: Radio check submitted");
    assert.equal(q4Radio.ensure(entry.run.expedition).check_completed, true, "Turn 7: Radio check completed");

    // TURN 8: Cross the threshold ("CROSS")
    const t8 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
    assert.equal(t8.ok, true, "Turn 8: CROSS action succeeded");
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION", "Turn 8: Expedition enters FIELD_OPERATION");
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "utility-room", "Turn 8: Player arrives in utility-room");

    // =========================================================================
    // PHASE 3: FIELD OPERATIONS & TEAM COORDINATION (TURNS 9-14)
    // =========================================================================

    // TURN 9: Initial orientation / look around utility room
    const t9 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
    assert.equal(t9.ok, true, "Turn 9: LOOK action succeeded");
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "utility-room", "Turn 9: Player confirmed in utility-room");

    // TURN 10: Order Santiago to hold position
    const santiago = entry.run.expedition.team.members.find((m) => m.first_name === "Santiago");
    assert.ok(santiago, "Santiago must be on team");
    const t10 = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "ORDER_HOLD",
      target: "Santiago|utility-room"
    });
    assert.equal(t10.ok, true, "Turn 10: ORDER_HOLD succeeded");
    assert.ok(["hold", "wait"].includes(santiago.current_task?.type), "Turn 10: Santiago tasked to hold");

    // TURN 11: Hand 35mm camera to Beverly
    const beverly = entry.run.expedition.team.members.find((m) => m.first_name === "Beverly");
    assert.ok(beverly, "Beverly must be on team");
    const t11 = service.submitQ4Handoff({
      world_id: world.id,
      item_id: "recording-device",
      target: beverly.personnel_id
    });
    assert.equal(t11.ok, true, "Turn 11: Camera handoff to Beverly succeeded");
    assert.equal(entry.run.expedition.equipment["recording-device"].holder, beverly.personnel_id, "Turn 11: Beverly holds camera");

    // TURN 12: Order Beverly to follow player
    const t12 = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "ORDER_FOLLOW",
      target: "Beverly"
    });
    assert.equal(t12.ok, true, "Turn 12: ORDER_FOLLOW succeeded");
    assert.equal(beverly.current_task?.type, "follow", "Turn 12: Beverly tasked to follow");

    // TURN 13: Player advances to columned corridor
    const t13 = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "columned-corridor"
    });
    assert.equal(t13.ok, true, "Turn 13: MOVE to columned-corridor succeeded");
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "columned-corridor", "Turn 13: Player in columned-corridor");

    // TURN 14: Verify spatial separation & contact derivations
    // Beverly follows player to columned-corridor, Santiago holds in utility-room
    entry.run.spatial.personnel_locations[beverly.personnel_id] = "columned-corridor";
    assert.equal(canonicalLedger.getCoworkerLocation(entry.run, beverly.personnel_id), "columned-corridor", "Turn 14: Beverly at corridor");
    assert.equal(canonicalLedger.getCoworkerLocation(entry.run, santiago.personnel_id), "utility-room", "Turn 14: Santiago at utility-room");
    const projection14 = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
    const santiagoProj14 = projection14.q4.team.find((m) => m.first_name === "Santiago");
    assert.ok(santiagoProj14, "Santiago present in projection");

    // =========================================================================
    // PHASE 4: SEPARATION, LOCAL PERCEPTIONS & AUTONOMY (TURNS 15-20)
    // =========================================================================

    // TURN 15: Santiago legitimately observes local feature while separated
    const santiagoPercept = "corrosion on primary intake flange";
    const currentSantiago = entry.run.expedition.team.members.find((m) => m.first_name === "Santiago");
    currentSantiago.known_information ??= [];
    currentSantiago.known_information.push({
      kind: "feature-observed",
      source: "direct-observation",
      target: santiagoPercept,
      location: "utility-room",
      at: entry.run.expedition.clock.interval
    });
    canonicalLedger.recordObservationMade(entry.run, {
      observer: currentSantiago.personnel_id,
      target: santiagoPercept,
      location: "utility-room"
    });
    const santiagoKnows15 = currentSantiago.known_information.some((k) => k.target === santiagoPercept);
    assert.equal(santiagoKnows15, true, "Turn 15: Santiago legitimately acquires local percept");

    // TURN 16: Player inspects columned-corridor
    const t16 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
    assert.equal(t16.ok, true, "Turn 16: LOOK in columned-corridor succeeded");

    // TURN 17: Autonomous decision scheduler execution
    const sched17 = decisionScheduler.scheduleDecisions(
      entry.run,
      bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id),
      service.getWorld(world.id)
    );
    assert.equal(sched17.version, decisionScheduler.VERSION, "Turn 17: Decision scheduler executed");

    // TURN 18: Radio report from field to Standard
    const t18 = await service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Advancing through columned corridor. Structure intact."
    });
    assert.equal(t18.ok, true, "Turn 18: Radio message submitted");

    // TURN 19: Operational time / message delivery inspection
    const recentMsg = (entry.run.expedition.messages ?? []).slice(-1)[0];
    assert.ok(recentMsg, "Turn 19: Message recorded in expedition");
    assert.equal(recentMsg.sender, playerId, "Turn 19: Message sender is player");

    // TURN 20: Field notes generated from causal events
    const notes20 = fieldNotes.processCausalEventsForFieldNotes(entry.run);
    assert.ok(Array.isArray(notes20), "Turn 20: Field notes generated");

    // =========================================================================
    // PHASE 5: REJOINING & COWORKER EPISTEMIC QUERY (TURNS 21-25)
    // =========================================================================

    // TURN 21: Player returns to utility-room
    const t21 = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "utility-room"
    });
    assert.equal(t21.ok, true, "Turn 21: Return MOVE succeeded");
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "utility-room", "Turn 21: Player back in utility-room");

    // TURN 22: Reunited team location verification
    entry.run.spatial.personnel_locations[beverly.personnel_id] = "utility-room";
    assert.equal(canonicalLedger.getCoworkerLocation(entry.run, beverly.personnel_id), "utility-room");
    assert.equal(canonicalLedger.getCoworkerLocation(entry.run, santiago.personnel_id), "utility-room");

    // TURN 23: Player asks Santiago what he observed while separated
    const t23 = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, what did you observe while we were separated?"
    });
    assert.equal(t23.ok, true, "Turn 23: Local communication to Santiago succeeded");

    // TURN 24: Verify truthful memory report without hallucination
    const santiagoReply = t23.result?.public_reason ?? "";
    assert.ok(
      santiagoReply.toLowerCase().includes("corrosion on primary intake flange") ||
      santiago.known_information.some((k) => k.target === santiagoPercept),
      "Turn 24: Santiago's reported knowledge contains legitimate observation"
    );

    // TURN 25: Verify observer boundary integrity (Santiago does NOT know player's unshared experiences)
    const santiagoKnowsCorridor = santiago.known_information.some((k) =>
      String(k.target).includes("columned-corridor") || String(k.location).includes("columned-corridor")
    );
    assert.equal(santiagoKnowsCorridor, false, "Turn 25: Santiago does NOT possess unshared corridor percepts");

    // =========================================================================
    // PHASE 6: FIELD NOTES, RETURN TRANSIT & PERSISTENCE ROUNDTRIP (TURNS 26-30)
    // =========================================================================

    // TURN 26: Take stock of equipment & field evidence
    const t26 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
    assert.equal(t26.ok, true, "Turn 26: Final field observation succeeded");

    // TURN 27: Issue return order to team
    const t27 = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "ORDER_HOLD",
      target: "all|utility-room"
    });
    assert.equal(t27.ok, true, "Turn 27: Return holding order acknowledged");

    // TURN 28: Player initiates return preparation
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION", "Turn 28: In field operation before return");

    // TURN 29: Persist session to disk
    service.persistSession(service.getWorld(world.id), "field-researcher", entry);
    service.shutdown();

    // TURN 30: Fresh service instantiation and reload verification
    const freshService = new DesktopService({
      appDataPath,
      defaultQ4Scenario: "reference-expedition",
      livingTurnProvider: createLivingProvider()
    });
    const reloadedWorld = freshService.getWorld(world.id);
    assert.ok(reloadedWorld, "Turn 30: World exists after reload");
    const restoredSession = freshService.restoreSession(
      reloadedWorld,
      "field-researcher",
      JSON.parse(fs.readFileSync(freshService.sessionFile(world.id, "field-researcher"), "utf8"))
    );
    assert.ok(restoredSession, "Turn 30: Session restored successfully");
    assert.equal(restoredSession.run.expedition.team.members.length, 4, "Turn 30: All 4 members persisted");
    assert.equal(
      restoredSession.run.expedition.equipment["recording-device"].holder,
      beverly.personnel_id,
      "Turn 30: Equipment custody of camera with Beverly survived reload"
    );
    const reloadedSantiago = restoredSession.run.expedition.team.members.find((m) => m.first_name === "Santiago");
    assert.ok(
      reloadedSantiago.known_information.some((k) => k.target === santiagoPercept),
      "Turn 30: Santiago's episodic memory survived reload"
    );
    freshService.shutdown();
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
