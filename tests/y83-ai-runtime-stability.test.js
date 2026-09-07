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
const referentResolution = require("../tools/referent-resolution");
const affordanceService = require("../tools/affordance-service");
const communicationRouting = require("../tools/communication-routing");
const fieldNotes = require("../tools/field-notes");
const observerContextCompiler = require("../tools/observer-context-compiler");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { executeLivingTurn, validatePresentation, fallbackPresentation } = require("../tools/ai-living-turn");
const {
  PROPOSAL_VERSION,
  buildCustodianScope,
  interpretPlayerLanguage,
  validateAndResolve
} = require("../tools/ai-interpreter-boundary");

function createUtilityFixture(seed = "ai-stability-pass") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ai-stability-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "AI Runtime Stability", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) {
    assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  }
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, field team assembled at Threshold Room. Requesting link check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);
  const entry = service.session(world.id, "field-researcher");
  return { appDataPath, service, world, entry, run: entry.run, provider: livingProvider };
}

function canonicalSnapshot(run) {
  return structuredClone({
    clock: run.expedition.clock,
    operational: run.expedition.operational,
    evidence: run.expedition.evidence,
    history: run.expedition.history,
    object_state: run.object_state,
    equipment: run.expedition.equipment,
    team: run.expedition.team,
    spatial: run.spatial,
    causal_ledger: run.causal_ledger,
    tasks: run.coworker_tasks,
    field_notes: run.field_notes
  });
}

// =========================================================================
// SECTION 26: ACCEPTANCE TESTS
// =========================================================================

test("1 Pronoun and vague reference resolution in code", () => {
  const { run } = createUtilityFixture("test-case-1");
  const player = run.session.startup.player.observer_id;

  // Equipment resolution
  const camRes = referentResolution.resolveReferent("the camera", run, player);
  assert.equal(camRes.resolved, true);
  assert.equal(camRes.top_candidate?.id, "recording-device");

  const meterRes = referentResolution.resolveReferent("the instrument", run, player);
  assert.equal(meterRes.resolved, true);
  assert.equal(meterRes.top_candidate?.id, "survey-instrument");

  // Exit resolution: specific exit resolves; vague reference identifies multiple candidates
  const exitRes = referentResolution.resolveReferent("the open passage", run, player);
  assert.equal(exitRes.resolved, true);
  assert.equal(exitRes.top_candidate?.category, "exit");

  const vagueRes = referentResolution.resolveReferent("that way", run, player);
  assert.equal(vagueRes.resolved, false);
  assert.ok(vagueRes.candidates.length >= 2);

  // Salient fixture resolution
  const itRes = referentResolution.resolveReferent("the fixture", run, player);
  assert.equal(itRes.resolved, true);
  assert.ok(itRes.top_candidate?.id.includes("fluorescent-fixture"));
  assert.equal(itRes.top_candidate?.name, "fluorescent fixture");
});

test("2 Precondition validation before AI dispatch", () => {
  const { run } = createUtilityFixture("test-case-2");
  const player = run.session.startup.player.observer_id;

  // Unreachable door
  const moveCheck = affordanceService.validatePreconditions({ actor: player, action: "MOVE", target: "unreachable-distant-door" }, run);
  assert.equal(moveCheck.valid, false);
  assert.equal(moveCheck.reason, "exit_unreachable_or_blocked");

  // Using equipment not held by player (camera is held by Beverly)
  const photoCheck = affordanceService.validatePreconditions({ actor: player, action: "PHOTOGRAPH", target: "fluorescent-fixture" }, run);
  assert.equal(photoCheck.valid, false);
  assert.equal(photoCheck.reason, "camera_not_held");

  // Transferring equipment not held
  const transferCheck = affordanceService.validatePreconditions({ actor: player, action: "TRANSFER", target: "personnel-beverly-bell", equipment: "recording-device" }, run);
  assert.equal(transferCheck.valid, false);
  assert.equal(transferCheck.reason, "equipment_not_held");
});

test("3 Negative tests for hidden state isolation", () => {
  const { run } = createUtilityFixture("test-case-3");
  const scope = buildCustodianScope(run);
  const jsonContext = JSON.stringify(scope.context);

  // Hidden/unobserved facts must not appear in context
  assert.equal(jsonContext.includes("18m"), false);
  assert.equal(jsonContext.includes("anomaly_flag"), false);
  assert.equal(jsonContext.includes("secret_passageway"), false);
  assert.equal(jsonContext.includes("level_2"), false);

  // Raw internal UUIDs/personnel_ids must not appear in AI context
  assert.equal(jsonContext.includes(run.session.startup.player.observer_id), false);
  for (const member of run.expedition.team.members) {
    assert.equal(jsonContext.includes(member.personnel_id), false);
  }
});

test("4 Deterministic communication routing", () => {
  const { run } = createUtilityFixture("test-case-4");
  const player = run.session.startup.player.observer_id;

  // Radio transmission on standard channel
  const radioRes = communicationRouting.routeAndDeliver(run, {
    sender: player,
    type: "radio",
    channel: "standard",
    text: "Standard, this is Murphy. Link check."
  });
  assert.equal(radioRes.delivered, true);
  assert.ok(radioRes.recipients.length > 0);

  // Non-matching channel transmission
  const badChannel = communicationRouting.routeAndDeliver(run, {
    sender: player,
    type: "radio",
    channel: "unauthorized-private-freq",
    text: "Testing frequency"
  });
  assert.equal(badChannel.delivered, false);
  assert.equal(badChannel.recipients.length, 0);

  // Local speech delivered to present teammates
  const localSpeech = communicationRouting.routeAndDeliver(run, {
    sender: player,
    type: "local_speech",
    text: "Keep your eyes open."
  });
  assert.equal(localSpeech.delivered, true);
  assert.ok(localSpeech.recipients.includes("personnel-beverly-bell"));
});

test("5 Task continuity across turns in canonical ledger", () => {
  const { run } = createUtilityFixture("test-case-5");
  const cwId = "personnel-beverly-bell";

  // Assign task
  canonicalLedger.setCoworkerTask(run, cwId, "PHOTOGRAPH", "fluorescent-fixture", { priority: 2 });
  const task1 = canonicalLedger.getCoworkerTask(run, cwId);
  assert.equal(task1.action, "PHOTOGRAPH");
  assert.equal(task1.target, "fluorescent-fixture");
  assert.equal(task1.status, "assigned");

  // Progress task
  canonicalLedger.progressCoworkerTask(run, cwId, { progress: 0.5, status: "in_progress" });
  const task2 = canonicalLedger.getCoworkerTask(run, cwId);
  assert.equal(task2.progress, 0.5);
  assert.equal(task2.status, "in_progress");

  // Unrelated action on another member doesn't clear Beverly's task
  canonicalLedger.recordObservationMade(run, { observer: "player", target: "open passage", location: "Threshold Room", interval: 5 });
  const task3 = canonicalLedger.getCoworkerTask(run, cwId);
  assert.equal(task3.action, "PHOTOGRAPH");
  assert.equal(task3.progress, 0.5);
});

test("6 Deterministic field note generation", () => {
  const { run } = createUtilityFixture("test-case-6");
  const player = run.session.startup.player.observer_id;

  canonicalLedger.recordObservationMade(run, {
    observer: player,
    target: "fluorescent-fixture",
    location: "Bare Utility Room",
    interval: 6,
    observation: "Steady hum from overhead ballast."
  });

  fieldNotes.processCausalEventsForFieldNotes(run);
  const notes = fieldNotes.getFieldNotes(run);
  assert.ok(notes.length > 0);
  const note = notes[0];
  assert.equal(note.interval, 6);
  assert.ok(note.author);
  assert.ok(note.text.includes("fluorescent-fixture") || note.text.includes("Bare Utility Room"));
});

test("7 Equipment continuity across operations", () => {
  const { run } = createUtilityFixture("test-case-7");
  const player = run.session.startup.player.observer_id;

  // Invariant: each equipment item has a valid holder
  for (const [id, item] of Object.entries(run.expedition.equipment)) {
    assert.ok(item.holder, `Item ${id} must have a holder`);
    assert.ok(["personnel-beverly-bell", "personnel-autumn-tucker", "personnel-santiago-stokes", player].includes(item.holder));
  }

  // Camera held by Beverly Bell
  assert.equal(canonicalLedger.getEquipmentHolder(run, "recording-device"), "personnel-beverly-bell");

  // Attempting to transfer an item not in player custody fails
  const illegalTransfer = bootstrap.act(run, "TRANSFER", "recording-device|personnel-santiago-stokes");
  assert.equal(illegalTransfer.ok, false);

  // Invariants hold: holder didn't change
  assert.equal(canonicalLedger.getEquipmentHolder(run, "recording-device"), "personnel-beverly-bell");
  for (const [id, item] of Object.entries(run.expedition.equipment)) {
    assert.ok(item.holder, `Item ${id} must retain a holder`);
  }
});

test("8 Save / reload round-trip continuity", () => {
  const { service, world, run } = createUtilityFixture("test-case-8");

  // Record structured state before save
  canonicalLedger.setCoworkerTask(run, "personnel-beverly-bell", "PHOTOGRAPH", "fluorescent-fixture");
  canonicalLedger.recordObservationMade(run, { observer: "player", target: "fluorescent-fixture", location: "Threshold Room", interval: 6 });
  fieldNotes.processCausalEventsForFieldNotes(run);

  const beforeSnap = canonicalSnapshot(run);

  // Save session to disk
  service.shutdown();

  // Reload session
  const reloadedEntry = service.session(world.id, "field-researcher");
  assert.ok(reloadedEntry);
  const afterSnap = canonicalSnapshot(reloadedEntry.run);

  // Verify full fidelity
  assert.deepEqual(afterSnap.tasks, beforeSnap.tasks);
  assert.deepEqual(afterSnap.field_notes, beforeSnap.field_notes);
  assert.deepEqual(afterSnap.causal_ledger, beforeSnap.causal_ledger);
  assert.equal(afterSnap.clock.interval, beforeSnap.clock.interval);
});

test("9 Error resilience against provider failure", async () => {
  const { run } = createUtilityFixture("test-case-9");

  // Failing presentation provider
  const failingProvider = {
    name: "failing-test-provider",
    async interpret(req) {
      return createLivingProvider().interpret(req);
    },
    async present() {
      throw new Error("Simulated model timeout or network failure");
    }
  };

  const beforeClock = run.expedition.clock.interval;
  const res = await executeLivingTurn({
    run,
    player_text: "Beverly photographs the fixture while I inspect it.",
    interpreter: failingProvider,
    presentation_provider: failingProvider,
    request_id: "resilience-test"
  });

  assert.equal(res.status, "resolved");
  assert.equal(res.presentation.source, "deterministic-fallback");
  assert.ok(res.presentation.scene_description.length > 0);
  assert.equal(run.expedition.clock.interval, beforeClock + 1);
  assert.equal(res.canonical_mutation, true);
});

test("10 End-to-end multi-turn playable scenario", async () => {
  const { service, world, run } = createUtilityFixture("test-case-10");

  // Turn 1: Inspect fixture
  const t1 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Inspect the fluorescent fixture."
  });
  assert.equal(t1.ok, true);
  assert.equal(t1.result.turn_status, "RESOLVED");

  // Turn 2: Coordinated action
  const t2 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Beverly photographs the fixture while I inspect it."
  });
  assert.equal(t2.ok, true);
  assert.equal(t2.result.turn_status, "RESOLVED");

  // Turn 3: Movement through passage
  const t3 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Walk through the open passage."
  });
  assert.equal(t3.ok, true);
  assert.equal(t3.result.turn_status, "RESOLVED");

  // Turn 4: Inspect descending grade in new room
  const t4 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Inspect the descending grade."
  });
  assert.equal(t4.ok, true);
  assert.equal(t4.result.turn_status, "RESOLVED");

  // Turn 5: Movement back to utility room
  const t5 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Walk through the passage to the utility room."
  });
  assert.equal(t5.ok, true);
  assert.equal(t5.result.turn_status, "RESOLVED");

  // Verify interval advanced strictly
  assert.ok(run.expedition.clock.interval >= 7);
  assert.ok(run.causal_ledger.length >= 4);
});

// =========================================================================
// SECTION 27: ADVERSARIAL AND EDGE-CASE TESTS
// =========================================================================

test("11 Ambiguous pronoun with multiple male candidates returns clarification without mutation", async () => {
  const { run } = createUtilityFixture("test-case-11");
  const before = canonicalSnapshot(run);
  const scope = buildCustodianScope(run);

  // Proposal using ambiguous "specialist" when multiple coworkers are specialists
  const ambiguousProposal = {
    version: PROPOSAL_VERSION,
    status: "proposal",
    noncanonical: true,
    relation: "single",
    attempts: [
      {
        actor: { kind: "player" },
        action: "ORDER_FOLLOW",
        target_label: "specialist",
        equipment_label: null,
        agency: "direct-player",
        language_span: "follow specialist"
      }
    ]
  };

  const res = validateAndResolve(ambiguousProposal, scope, {
    sourceText: "follow specialist",
    requestId: "ambig-spec",
    source: "test"
  });

  assert.equal(res.kind, "clarification");
  assert.equal(res.code, "REFERENCE_AMBIGUOUS");
  assert.ok(res.options.length >= 2);
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("12 Pronoun with zero antecedent returns clarification", () => {
  const { run } = createUtilityFixture("test-case-12");
  const res = referentResolution.resolveReferent("that non-existent relic", run, "player");
  assert.equal(res.resolved, false);
  assert.equal(res.top_candidate, null);
});

test("13 Conflicting compound command is clarified before mutation", () => {
  const { run } = createUtilityFixture("test-case-13");
  const scope = buildCustodianScope(run);

  // Mixed relation sequence + coordinated without proper temporal order
  const conflictingProposal = {
    version: PROPOSAL_VERSION,
    status: "proposal",
    noncanonical: true,
    relation: "coordinated",
    attempts: [
      {
        actor: { kind: "player" },
        action: "MOVE",
        target_label: "open passage",
        equipment_label: null,
        agency: "first-person",
        language_span: "I walk through the passage"
      },
      {
        actor: { kind: "player" },
        action: "INSPECT",
        target_label: "fluorescent fixture",
        equipment_label: null,
        agency: "first-person",
        language_span: "and stay here to inspect the fixture"
      }
    ]
  };

  const res = validateAndResolve(conflictingProposal, scope, {
    sourceText: "I walk through the passage and stay here to inspect the fixture.",
    requestId: "conflict-cmd",
    source: "test"
  });

  assert.equal(res.kind, "clarification");
});

test("14 Illegal out-of-order action rejected before dispatch", () => {
  const { run } = createUtilityFixture("test-case-14");
  const player = run.session.startup.player.observer_id;

  // Preconditions require camera possession for PHOTOGRAPH
  const check = affordanceService.validatePreconditions({
    actor: player,
    action: "PHOTOGRAPH",
    target: "fluorescent-fixture"
  }, run);

  assert.equal(check.valid, false);
  assert.equal(check.reason, "camera_not_held");
  assert.ok(check.alternatives.length > 0);
});

test("15 Invisible / hidden entity reference rejected", () => {
  const { run } = createUtilityFixture("test-case-15");
  const player = run.session.startup.player.observer_id;

  const canSee = perceptionService.canSee(player, "hidden-entity-room-99", run);
  assert.equal(canSee, false);

  const check = affordanceService.validatePreconditions({
    actor: player,
    action: "INSPECT",
    target: "hidden-entity-room-99"
  }, run);

  assert.equal(check.valid, false);
  assert.equal(check.reason, "target_not_visible");
});

test("16 Spatial telepathy attempt rejected without radio", () => {
  const { run } = createUtilityFixture("test-case-16");
  const player = run.session.startup.player.observer_id;

  // Move Beverly away into another zone for test
  run.spatial.personnel_locations["personnel-beverly-bell"] = "sub-basement-zone-b";

  const hearCheck = perceptionService.canHear("personnel-beverly-bell", player, run);
  assert.equal(hearCheck, false);

  const orderCheck = affordanceService.validatePreconditions({
    actor: player,
    action: "ORDER_HOLD",
    target: "personnel-beverly-bell"
  }, run);

  assert.equal(orderCheck.valid, false);
  assert.equal(orderCheck.reason, "coworker_cannot_hear_order");
  assert.ok(orderCheck.alternatives.includes("use(radio)"));
});

test("17 Entity creation / hallucinated item rejected", () => {
  const { run } = createUtilityFixture("test-case-17");
  const scope = buildCustodianScope(run);

  const proposal = {
    version: PROPOSAL_VERSION,
    status: "proposal",
    noncanonical: true,
    relation: "single",
    attempts: [
      {
        actor: { kind: "player" },
        action: "INSPECT",
        target_label: "magic plasma sword",
        equipment_label: null,
        agency: "direct-player",
        language_span: "inspect the magic plasma sword"
      }
    ]
  };

  const res = validateAndResolve(proposal, scope, {
    sourceText: "inspect the magic plasma sword",
    requestId: "hallucinated-sword",
    source: "test"
  });

  assert.equal(res.kind, "clarification");
  assert.equal(res.code, "REFERENCE_NOT_OBSERVER_SAFE");
  assert.ok(!res.options.includes("magic plasma sword"));
});

test("18 Rapid turn submission handled deterministically", async () => {
  const { service, world, run } = createUtilityFixture("test-case-18");

  const results = [];
  results.push(await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Inspect the fluorescent fixture."
  }));

  results.push(await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Beverly photographs the fixture while I inspect it."
  }));

  for (const r of results) {
    assert.equal(r.ok, true);
    assert.equal(r.result.turn_status, "RESOLVED");
  }

  // Interval monotonically increased
  assert.ok(run.expedition.clock.interval >= 6);
});

test("19 Context budget boundary enforcement", () => {
  const { run } = createUtilityFixture("test-case-19");
  const player = run.session.startup.player.observer_id;

  const compiled = observerContextCompiler.compileObserverContext(run, player);
  const serialized = JSON.stringify(compiled);

  // Packet must be compact (under 800 tokens approx 3200 characters)
  assert.ok(serialized.length < 3500, `Context packet length ${serialized.length} must be under 3500 bytes`);
  assert.ok(Object.keys(compiled.team).length <= 4);
  assert.ok(compiled.recent_events.length <= 4);
});

test("20 Model hallucination in presentation caught by validation", () => {
  const { run } = createUtilityFixture("test-case-20");
  const player = run.session.startup.player.observer_id;
  const scope = buildCustodianScope(run);

  const providerPacket = {
    version: "yellow-beast-presentation-packet@v1",
    audience: "controlled-player",
    authority_contract: {
      presentation: "candidate-only",
      canonical_mutation: "forbidden",
      player_speech_or_action_invention: "forbidden",
      hidden_state: "structurally-absent"
    },
    player_scene: {
      version: "yellow-beast-live-scene-packet@v1",
      observer_id: player,
      location: { known_name: "Threshold Room", visible_description: "A bare utility room." },
      visible_environment: { visible_conditions: ["fluorescent hum"] },
      visible_personnel: [
        { observer_id: "personnel-beverly-bell", known_identity: "Beverly Bell" }
      ],
      recent_observable_events: [],
      observer_knowledge: { established_conclusions: [] },
      communication_context: { recent_messages: [] }
    },
    authoritative_resolution: { action: "INSPECT", outcome: "resolved" }
  };

  // Hallucinated candidate asserting unobserved 18.5 meters measurement and invented player words
  const hallucinatedCandidate = {
    version: "yellow-beast-presentation-candidate@v1",
    scene_description: "The room is 18.5 meters wide. You say 'We found the anomaly!'",
    npc_presentations: [],
    presentation_claims: []
  };

  const validation = validatePresentation(providerPacket, hallucinatedCandidate);
  assert.equal(validation.ok, false);
  assert.ok(["PRESENTATION_UNOBSERVED_MEASUREMENT", "PRESENTATION_PLAYER_AGENCY_INVENTED", "PRESENTATION_OBJECT_OR_GEOGRAPHY_UNKNOWN"].includes(validation.code));

  // Fallback presentation generated cleanly
  const fallback = fallbackPresentation(providerPacket, validation.code);
  assert.equal(fallback.source, "deterministic-fallback");
  assert.ok(fallback.scene_description.includes("bare utility room") || fallback.scene_description.includes("fluorescent hum"));
});
