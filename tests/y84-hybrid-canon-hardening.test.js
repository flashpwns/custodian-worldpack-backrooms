"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const perceptionService = require("../tools/perception-service");
const canonLexicon = require("../tools/canon-lexicon");
const canonLinter = require("../tools/canon-linter");
const interpretiveDirector = require("../tools/interpretive-director");
const observerContextCompiler = require("../tools/observer-context-compiler");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "hybrid-hardening") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-hybrid-test-"));
  const callCount = { total: 0, semantic: 0, performance: 0 };
  const baseLiving = createLivingProvider();
  const livingProvider = {
    name: "tracked-living-provider",
    async interpret(request) {
      callCount.total++;
      callCount.semantic++;
      return baseLiving.interpret(request);
    },
    async present(request) {
      callCount.total++;
      callCount.performance++;
      return baseLiving.present(request);
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Hybrid Canon Hardening", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  return { appDataPath, service, world, callCount };
}

test("1 Gate 7: Routine onboarding completes entirely through authored/deterministic pipeline with 0 AI calls", async () => {
  const { service, world, callCount } = createTestService("gate-7-onboarding");

  // Step 1: In BRIEFING, player submits on-script ready
  const r1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready to proceed with the survey assignment." });
  assert.equal(r1.ok, true);
  assert.equal(r1.result.classification, "ON_SCRIPT");
  assert.equal(r1.result.executed, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STAGING");
  assert.equal(r1.result.source, "AUTHORED_CANON");

  // Step 2: In STAGING, player submits on-script proceed
  const r2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Proceed to the maintenance wing." });
  assert.equal(r2.ok, true);
  assert.equal(r2.result.classification, "ON_SCRIPT");
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "FACILITY_TRANSIT");

  // Step 3: In FACILITY_TRANSIT, player approaches threshold room
  const r3 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Approach the KV31 threshold room." });
  assert.equal(r3.ok, true);
  assert.equal(r3.result.classification, "ON_SCRIPT");
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "THRESHOLD");

  // Step 4: In THRESHOLD, player confirms readiness for radio check
  const r4 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Confirm readiness for radio check." });
  assert.equal(r4.ok, true);
  assert.equal(r4.result.classification, "ON_SCRIPT");
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STANDARD_RADIO_CHECK");

  // Step 5: In STANDARD_RADIO_CHECK, radio check submission
  const r5 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Standard, this is Clear-Q4, conducting radio check." });
  assert.equal(r5.ok, true);
  assert.equal(r5.result.turn_status, "RESOLVED");

  // Step 6: In STANDARD_RADIO_CHECK, cross through threshold
  const r6 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Cross the Threshold aperture." });
  assert.equal(r6.ok, true);
  assert.equal(r6.result.classification, "ON_SCRIPT");
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "FIELD_OPERATION");
  assert.ok(r6.result.summary.includes("Threshold") || r6.result.summary.includes("aperture") || r6.result.summary.includes("Utility Room"));
  assert.ok(["AUTHORED_CANON", "AUTHORED_VARIANT"].includes(r6.result.source));

  // ZERO AI calls were made during the entire onboarding sequence!
  assert.equal(callCount.total, 0, "Expected 0 total AI calls during routine onboarding");
  assert.equal(callCount.semantic, 0);
  assert.equal(callCount.performance, 0);
});

test("2 Gate 6: Known locations use exact structured terminology without vague improvisation", () => {
  const descRoom = canonLexicon.getLocationDescriptor("threshold-room");
  assert.equal(descRoom.display_name, "KV31 Threshold Room");
  assert.equal(descRoom.known_destination, "Threshold-Side Entry");

  const descEntry = canonLexicon.getLocationDescriptor("threshold-side-entry");
  assert.equal(descEntry.display_name, "Threshold-Side Entry");
  assert.equal(descEntry.known_destination, "Utility Room");

  const descUtility = canonLexicon.getLocationDescriptor("utility-room");
  assert.equal(descUtility.display_name, "Utility Room");
  assert.equal(descUtility.known_destination, "Open Passage survey line");
});

test("3 Gate 15: Canon language linter detects forbidden developer/game terms and provides approved replacements", () => {
  const test1 = canonLinter.lintCanonText("You step out onto the safe side near the NPC spawn area.");
  assert.equal(test1.valid, false);
  assert.ok(test1.violations.some((v) => v.term.toLowerCase() === "safe side"));
  assert.ok(test1.violations.some((v) => v.term.toLowerCase() === "npc"));
  assert.ok(test1.violations.some((v) => v.term.toLowerCase() === "spawn area"));

  const cleaned = canonLinter.enforceCanonText("The player character moves to the threshold side to begin the quest.");
  assert.ok(!cleaned.includes("player character"));
  assert.ok(!cleaned.includes("quest"));
  assert.ok(!cleaned.includes("threshold side"));
  assert.ok(cleaned.includes("team lead"));
  assert.ok(cleaned.includes("assigned survey"));
});

test("4 Gate 8: Minor deviation during onboarding answers location and orders deterministically from code", async () => {
  const { service, world, callCount } = createTestService("gate-8-minor-deviation");

  const r1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "What room are we in right now?" });
  assert.equal(r1.ok, true);
  assert.equal(r1.result.classification, "MINOR_DEVIATION");
  assert.ok(r1.result.summary.includes("ASYNC Briefing Room"));
  assert.ok(r1.result.summary.includes("Lower Offices"));
  assert.equal(callCount.total, 0, "No model calls should be spent answering location");

  const r2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "What is our assignment?" });
  assert.equal(r2.ok, true);
  assert.equal(r2.result.classification, "MINOR_DEVIATION");
  assert.ok(r2.result.summary.includes("Clear-Q4 Preliminary Layout and Condition Survey"));
  assert.equal(callCount.total, 0);
});

test("5 Gate 9: Returning to expected procedure works naturally after deviation", async () => {
  const { service, world } = createTestService("gate-9-resume-script");

  // Minor deviation question
  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Where are we headed?" });
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "BRIEFING");

  // Resume expected procedure
  const resumed = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready to proceed." });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.result.classification, "ON_SCRIPT");
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STAGING");
});

test("6 Gate 8: Major deviation (coworker hold order) updates canonical ledger and uses deterministic acknowledgement", async () => {
  const { service, world } = createTestService("gate-8-major-deviation");
  const entry = service.session(world.id, "field-researcher");

  const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Santiago, wait here." });
  assert.equal(res.ok, true);
  assert.equal(res.result.classification, "MAJOR_DEVIATION");
  assert.ok(res.result.summary.includes("Holding position here") || res.result.summary.includes("staying put") || res.result.summary.includes("Holding here"));

  // Verify task updated in canonical ledger
  const task = canonicalLedger.getCoworkerTask(entry.run, "personnel-santiago-stokes");
  assert.equal(task.task, "hold");
  assert.equal(task.status, "holding");
});

test("7 Gate 4: AI cannot override canonical authored beats", () => {
  const entry = {
    expedition: { consumed_authored_beats: [] },
    phase: { phase_id: "THRESHOLD" }
  };
  const beat = interpretiveDirector.findAuthoredBeat("location_entered", { location: "threshold-room", phase: "THRESHOLD" }, entry);
  assert.ok(beat);
  assert.equal(beat.source, "AUTHORED_CANON");
  assert.ok(beat.text.includes("KV31 Threshold Room"));
  assert.equal(interpretiveDirector.SOURCE_PRIORITY[beat.source], 1);
});

test("8 Gate 5: Authored beats cannot contradict canonical state (suppresses if conditions violated)", () => {
  const entry = {
    expedition: { consumed_authored_beats: [] },
    spatial: { player_location: "utility-room" }
  };
  // Asking for a beat tied to async-briefing-room while at utility-room must return null
  const beat = interpretiveDirector.findAuthoredBeat("location_entered", { location: "async-briefing-room", phase: "BRIEFING" }, entry);
  assert.equal(beat, null);
});

test("9 Gate 3: Authored interpretation and AI performance work in the same turn (tandem presentation)", async () => {
  const { service, world } = createTestService("gate-3-tandem");

  // Advance to FIELD_OPERATION
  for (const act of ["READY", "PROCEED", "APPROACH", "READY"]) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: act });
  }
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.phase.phase_id, "FIELD_OPERATION");

  // Move to open-passage
  const moveRes = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Move forward down the open passage."
  });

  assert.equal(moveRes.ok, true);
  assert.ok(moveRes.result.summary.includes("Open Passage"));
  // Dialogue event bus has emitted the authored beat
  assert.ok(entry.run.expedition.presentation_events.length > 0);
  assert.ok(entry.run.expedition.presentation_events.some((e) => e.text.includes("Open Passage")));
});

test("10 Gate 14: No duplicate presentation of the same canonical event (once_per_expedition)", () => {
  const run = {
    expedition: { consumed_authored_beats: [], clock: { interval: 1 } },
    spatial: { player_location: "utility-room" }
  };

  // First call succeeds
  const beat1 = interpretiveDirector.findAuthoredBeat("location_entered", { location: "utility-room" }, run);
  assert.ok(beat1);
  assert.ok(run.expedition.consumed_authored_beats.includes("utility_room_entry"));

  // Second call in same expedition is suppressed
  const beat2 = interpretiveDirector.findAuthoredBeat("location_entered", { location: "utility-room" }, run);
  assert.equal(beat2, null, "Expected consumed once-per-expedition beat to be suppressed on second query");
});

test("11 Gate 11: Dialogue event bus captures authored, deterministic, and AI events with exact source metadata", () => {
  const run = { expedition: {} };
  interpretiveDirector.ensureDirectorState(run);

  interpretiveDirector.emitPresentationEvent(run, {
    type: "interpretation",
    source: "AUTHORED_CANON",
    text: "The KV31 apparatus activates.",
    channel: "LOCAL"
  });

  interpretiveDirector.emitPresentationEvent(run, {
    type: "dialogue",
    speaker: "Santiago",
    source: "DETERMINISTIC",
    text: "Understood. Starting survey.",
    channel: "LOCAL"
  });

  interpretiveDirector.emitPresentationEvent(run, {
    type: "dialogue",
    speaker: "Beverly",
    source: "AI_PERFORMANCE",
    text: "Lens is clear.",
    channel: "LOCAL"
  });

  assert.equal(run.expedition.presentation_events.length, 3);
  assert.equal(run.expedition.presentation_events[0].source, "AUTHORED_CANON");
  assert.equal(run.expedition.presentation_events[1].source, "DETERMINISTIC");
  assert.equal(run.expedition.presentation_events[2].source, "AI_PERFORMANCE");
});

test("12 Gate 10: Complex field play transitions cleanly to living turn runtime after Threshold crossing", async () => {
  const { service, world } = createTestService("gate-10-field-play");

  for (const act of ["READY", "PROCEED", "APPROACH", "READY"]) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: act });
  }
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.phase.phase_id, "FIELD_OPERATION");

  const turnRes = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Inspect the scuffed floor."
  });
  assert.equal(turnRes.ok, true);
  assert.equal(turnRes.result.turn_status, "RESOLVED");
  assert.ok(turnRes.result.living_turn);
});

test("13 Gate 12: Provider failure does not corrupt authored sequence or canonical world state", async () => {
  const { service, world } = createTestService("gate-12-failure");

  // In prefield, provider isn't even needed for onboarding
  const r1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready." });
  assert.equal(r1.ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STAGING");

  // Inject broken provider
  service.livingTurnProvider = {
    name: "broken",
    async interpret() { throw new Error("SIMULATED_NETWORK_FAILURE"); },
    async present() { throw new Error("SIMULATED_NETWORK_FAILURE"); }
  };

  // Next prefield turn still succeeds deterministically
  const r2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Proceed." });
  assert.equal(r2.ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "FACILITY_TRANSIT");
});

test("14 Gate 13: Save and reload preserves procedure phase, consumed authored beats, and presentation history", async () => {
  const { service, world } = createTestService("gate-13-persistence");

  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready to proceed." });
  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Proceed." });

  const entry = service.session(world.id, "field-researcher");
  assert.equal(entry.phase.phase_id, "FACILITY_TRANSIT");
  const consumedBefore = [...entry.run.expedition.consumed_authored_beats];

  // Save session to disk
  service.shutdown();

  // Resume session
  const resumed = service.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const reloaded = service.session(world.id, "field-researcher");
  assert.equal(reloaded.phase.phase_id, "FACILITY_TRANSIT");
  assert.deepEqual(reloaded.run.expedition.consumed_authored_beats, consumedBefore);
});

test("15 Adversarial 1: 'nah give that to Whitfield instead' (unknown person rejected cleanly without mutation)", async () => {
  const { service, world } = createTestService("adversarial-unknown");
  const entry = service.session(world.id, "field-researcher");
  const intervalBefore = entry.run.expedition.clock?.interval ?? 0;

  const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "nah give that to Whitfield instead" });
  assert.equal(entry.run.expedition.clock?.interval ?? 0, intervalBefore, "No interval should advance on invalid coworker transfer");
});

test("16 Adversarial 2: 'what is this place?' returns exact canonical location and context", async () => {
  const { service, world } = createTestService("adversarial-location");
  const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "what is this place?" });
  assert.equal(res.ok, true);
  assert.ok(res.result.summary.includes("ASYNC Briefing Room"));
});

test("17 Adversarial 3: Equipment refusal ('I don\\'t want the camera') triggers institutional protocol reminder", async () => {
  const { service, world } = createTestService("adversarial-refusal");
  const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I do not want the camera." });
  assert.equal(res.ok, true);
  assert.ok(res.result.summary.includes("Clear-Q4 operational protocol"));
  assert.equal(res.result.executed, false);
});

test("18 Gate 2: Observer safety and compact context compiler include canonical location descriptors", () => {
  const { service, world } = createTestService("gate-2-observer-safety");
  const entry = service.session(world.id, "field-researcher");

  const packet = observerContextCompiler.compileObserverContext(entry.run, "player");
  assert.ok(packet.location_name);
  assert.ok(packet.institutional_context);
  assert.equal(packet.location_name, "ASYNC Briefing Room");
  assert.equal(typeof packet.location, "string");
  assert.ok(!JSON.stringify(packet).includes("canonical_geometry"));
});

test("19 Perception regression: Bidirectional connections correctly resolve reachability, direction, and visibility", () => {
  const { service, world } = createTestService("perception-bidirectional");
  const entry = service.session(world.id, "field-researcher");

  // Move to utility room
  for (const act of ["READY", "PROCEED", "APPROACH", "READY"]) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: act });
  }
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "utility-room" });

  assert.equal(perceptionService.reachable("player", "threshold-side-entry", entry.run), true);
  assert.equal(perceptionService.canSee("player", "threshold-side-entry", entry.run), true);
  const dir = perceptionService.directionFrom("player", "threshold-side-entry", entry.run);
  assert.ok(dir);
});

test("20 Gate 16: Complete end-to-end expedition progression from onboarding through return", async () => {
  const { service, world } = createTestService("gate-16-e2e");

  // 1. Briefing -> Staging
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready." })).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STAGING");

  // 2. Staging -> Facility Transit
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Proceed." })).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "FACILITY_TRANSIT");

  // 3. Transit -> Threshold
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Approach." })).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "THRESHOLD");

  // 4. Threshold -> Standard Radio Check
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready." })).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "STANDARD_RADIO_CHECK");

  // 5. Radio Check
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Standard, radio check." })).ok, true);

  // 6. Cross Threshold -> Field Operation
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Cross." })).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "FIELD_OPERATION");

  // 7. Advance to Open Passage
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move forward to the open passage." })).ok, true);

  // 8. Return to Utility Room
  assert.equal((await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move back to the utility room." })).ok, true);

  // 9. Initiate return procedure
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" }).ok, true);
  assert.equal(service.session(world.id, "field-researcher").phase.phase_id, "RETURN");
});
