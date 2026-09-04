"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const {
  projectLiveScene,
  projectObserverState,
  validateNegativeConstraintsNoLeaks
} = require("../tools/live-scene-projection");
const {
  buildLocalDialoguePacket,
  validateLocalDialogue,
  validateDialogueClaims,
  validateSemanticClaims
} = require("../tools/ai-local-dialogue");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { executePlayerTurn } = require("../tools/player-turn");
const { createMockProvider } = require("../tools/ai-mock-provider");

function createUtilityFixture(seed = "ledger-epistemic-hardening") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-epistemic-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Ledger Epistemic Hardening", seed }).world;
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
    spatial: run.spatial
  });
}

test("1 Player ID cannot accidentally alias coworker ID", () => {
  const { run } = createUtilityFixture("epistemic-1");
  const playerId = run.session.startup.player.observer_id;
  assert.ok(playerId);

  const team = run.expedition.team.members;
  // Reference Expedition staffing: strictly 1 controlled player + 3 coworkers = 4 total
  assert.equal(team.length, 4);

  const controlledMembers = team.filter((m) => m.personnel_id === playerId || m.contact_category === "SELF");
  assert.equal(controlledMembers.length, 1);
  assert.equal(controlledMembers[0].personnel_id, playerId);
  assert.equal(controlledMembers[0].first_name, "Matthew");
  assert.equal(controlledMembers[0].last_name, "Murphy");
  assert.equal(controlledMembers[0].contact_category, "SELF");
  assert.equal(controlledMembers[0].mission_authority, "controlled field authority");

  const coworkers = team.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  assert.equal(coworkers.length, 3);
  for (const cw of coworkers) {
    assert.notEqual(cw.personnel_id, playerId);
    assert.equal(cw.contact_category, "LOCAL");
    assert.equal(cw.mission_authority, "assigned operational authority");
  }

  // Verify invariant validation enforces non-aliasing
  const normalInv = canonicalLedger.validateInvariants(run);
  assert.equal(normalInv.ok, true);
  assert.equal(normalInv.status, "PASS");

  // Adversarial check: aliasing triggers violation
  const aliasedRun = structuredClone(run);
  aliasedRun.expedition.team.members[1].personnel_id = playerId;
  const aliasedInv = canonicalLedger.validateInvariants(aliasedRun);
  assert.equal(aliasedInv.ok, false);
  assert.equal(aliasedInv.status, "FAIL");
  assert.ok(aliasedInv.violations.some((v) => v.code === "PLAYER_COWORKER_IDENTITY_ALIASED"));
});

test("2 Canonical causal records are deterministic", () => {
  const { run } = createUtilityFixture("epistemic-2");

  const entry1 = canonicalLedger.recordCausalTransition(run, {
    interval: 1,
    cause_action_id: "inspect-fixture",
    cause_attempt_id: "att-001",
    details: { target: "fluorescent-fixture", outcome: "observed" }
  });

  // Must not stamp non-deterministic Date.now()
  assert.equal(entry1.recorded_at, undefined);
  assert.equal(entry1.interval, 1);
  assert.equal(entry1.cause_action_id, "inspect-fixture");
  assert.equal(entry1.cause_attempt_id, "att-001");

  // Identical transition produces byte-for-byte identical record
  const freshRun = createUtilityFixture("epistemic-2-replay").run;
  const entry2 = canonicalLedger.recordCausalTransition(freshRun, {
    interval: 1,
    cause_action_id: "inspect-fixture",
    cause_attempt_id: "att-001",
    details: { target: "fluorescent-fixture", outcome: "observed" }
  });

  assert.deepEqual(entry1, entry2);
});

test("3 Invariant checker cannot silently pass unresolved topology", () => {
  const { run } = createUtilityFixture("epistemic-3");

  // Normal run passes
  const resValid = canonicalLedger.validateInvariants(run);
  assert.equal(resValid.ok, true);
  assert.equal(resValid.status, "PASS");

  // Missing spatial_pack_id -> UNVERIFIABLE
  const noPackRun = structuredClone(run);
  delete noPackRun.spatial_pack_id;
  const resNoPack = canonicalLedger.validateInvariants(noPackRun);
  assert.equal(resNoPack.ok, false);
  assert.equal(resNoPack.status, "UNVERIFIABLE");
  assert.ok(resNoPack.unverifiable.some((u) => u.code === "TOPOLOGY_UNAVAILABLE"));

  // Invalid location not in topology -> FAIL
  const badLocRun = structuredClone(run);
  badLocRun.spatial.personnel_locations[run.session.startup.player.observer_id] = "nonexistent-void-room";
  const resBadLoc = canonicalLedger.validateInvariants(badLocRun);
  assert.equal(resBadLoc.ok, false);
  assert.equal(resBadLoc.status, "FAIL");
  assert.ok(resBadLoc.violations.some((v) => v.code === "PERSONNEL_LOCATION_INVALID"));
});

test("4 Standard receives false player claim without world state becoming true", () => {
  const { service, world, run } = createUtilityFixture("epistemic-4");

  // Player sends ungrounded false report to Standard
  const res = service.submitQ4Communication({
    world_id: world.id,
    channel: "standard",
    text: "Standard, we have discovered an anomalous open passage leading to sector-theta."
  });
  assert.equal(res.ok, true);

  const stdKnowledge = canonicalLedger.getStandardKnowledge(run);
  assert.ok(stdKnowledge.received_claims.length > 0);

  const falseClaim = stdKnowledge.received_claims.find((c) =>
    c.semantic_claim?.text?.includes("sector-theta")
  );
  assert.ok(falseClaim);
  assert.equal(falseClaim.status, "unverified");

  // Canonical reality is unaffected
  assert.equal(run.spatial.personnel_locations[run.session.startup.player.observer_id], "utility-room");
  assert.equal(run.object_state["sector-theta"], undefined);
});

test("5 Coworker receives false player claim as reported claim, not direct fact", () => {
  const { run } = createUtilityFixture("epistemic-5");
  const playerId = run.session.startup.player.observer_id;
  const beverly = run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");

  // Matthew speaks a false claim to Beverly
  beverly.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "flooded staircase ahead",
    source_observer_id: playerId,
    source_message_id: "msg-local-1",
    interval: run.expedition.clock.interval
  }));

  const shell = projectObserverState(run, "personnel-beverly-bell", "coworker-mini-shell");
  assert.equal(shell.ok, true);

  // Exists in reported knowledge with is_direct_witness: false
  const reported = shell.packet.knowledge.reported_knowledge.find((k) =>
    String(k.proposition).includes("flooded staircase")
  );
  assert.ok(reported);
  assert.equal(reported.is_direct_witness, false);

  // Absent from direct observations
  const direct = (shell.packet.knowledge.direct_observations ?? []).filter((k) =>
    String(k.target ?? k.observation ?? "").includes("flooded staircase")
  );
  assert.equal(direct.length, 0);

  // Canonical world does NOT contain a flooded staircase
  assert.equal(run.object_state["flooded-staircase"], undefined);
});

test("6 A observes X, tells B, B tells C; provenance remains distinct", () => {
  const { run } = createUtilityFixture("epistemic-6");
  const playerId = run.session.startup.player.observer_id;
  const santiago = run.expedition.team.members.find((m) => m.personnel_id === "personnel-santiago-stokes");
  const beverly = run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");
  const matthew = run.expedition.team.members.find((m) => m.personnel_id === playerId);

  // 1. Santiago (A) directly observes X
  santiago.known_information.push(canonicalLedger.createDirectObservation({
    target: "wall-seam",
    location: "utility-room",
    interval: 1,
    observation: "horizontal seam displaced by 4mm"
  }));

  // 2. Santiago tells Beverly (B)
  beverly.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "wall-seam displaced by 4mm",
    source_observer_id: "personnel-santiago-stokes",
    source_message_id: "msg-s-to-b",
    interval: 2,
    origin_observer_id: "personnel-santiago-stokes"
  }));

  // 3. Beverly tells Matthew (C)
  matthew.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "wall-seam displaced by 4mm",
    source_observer_id: "personnel-beverly-bell",
    source_message_id: "msg-b-to-m",
    interval: 3,
    origin_observer_id: "personnel-santiago-stokes",
    via_observer_id: "personnel-beverly-bell"
  }));

  // Santiago: Direct witness
  const santiagoObs = canonicalLedger.getObserverObservations(run, "personnel-santiago-stokes");
  assert.ok(santiagoObs.some((o) => o.target === "wall-seam" && o.is_direct_witness === true));

  // Beverly: Reported from Santiago
  const beverlyReported = canonicalLedger.getObserverReportedKnowledge(run, "personnel-beverly-bell");
  const bItem = beverlyReported.find((r) => r.proposition.includes("wall-seam"));
  assert.ok(bItem);
  assert.equal(bItem.is_direct_witness, false);
  assert.equal(bItem.origin_observer_id, "personnel-santiago-stokes");
  assert.equal(bItem.via_observer_id, null);

  // Matthew: Reported via Beverly from Santiago
  const matthewReported = canonicalLedger.getObserverReportedKnowledge(run, playerId);
  const mItem = matthewReported.find((r) => r.proposition.includes("wall-seam"));
  assert.ok(mItem);
  assert.equal(mItem.is_direct_witness, false);
  assert.equal(mItem.origin_observer_id, "personnel-santiago-stokes");
  assert.equal(mItem.via_observer_id, "personnel-beverly-bell");

  // Invariant verification passes
  const inv = canonicalLedger.validateInvariants(run);
  assert.equal(inv.ok, true);
  assert.equal(inv.status, "PASS");
});

test("7 Unobserved coworker cannot truthfully assert X", () => {
  const { run } = createUtilityFixture("epistemic-7");

  // Autumn has neither direct observation nor reported knowledge of offset-conduit
  const packet = buildLocalDialoguePacket({
    run,
    player_text: "Autumn, did you see the conduit?",
    speaker: { personnel_id: "personnel-autumn-tucker" },
    person: { continuity: {} },
    reaction_context: {},
    reaction: { category: "acknowledgment" }
  });

  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-autumn-tucker",
    speech: "I observed the offset conduit near the ceiling."
  };

  const validation = validateLocalDialogue(packet, candidate, run);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
});

test("8 Reported coworker may say 'X occurred' without asserting direct witness", () => {
  const { run } = createUtilityFixture("epistemic-8");
  const beverly = run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");

  beverly.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "wall seam is displaced by 4mm",
    source_observer_id: "personnel-santiago-stokes",
    source_message_id: "msg-s-b",
    interval: 1,
    origin_observer_id: "personnel-santiago-stokes"
  }));

  const packet = buildLocalDialoguePacket({
    run,
    player_text: "Beverly, what did Santiago find?",
    speaker: { personnel_id: "personnel-beverly-bell" },
    person: { continuity: {} },
    reaction_context: {},
    reaction: { category: "acknowledgment" }
  });

  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-beverly-bell",
    speech: "Santiago reported the wall seam is displaced by 4mm.",
    semantic_claims: [
      { type: "reported-claim", proposition: "wall seam is displaced by 4mm" }
    ]
  };

  const validation = validateLocalDialogue(packet, candidate, run);
  assert.equal(validation.ok, true);
});

test("9 Semantic possession claim contradicting ledger fails", () => {
  const { run } = createUtilityFixture("epistemic-9");
  // Santiago Stokes holds survey-instrument, NOT recording-device (Beverly holds recording-device)
  const claim = {
    type: "equipment-possession",
    subject: "personnel-santiago-stokes",
    object: "recording-device"
  };

  const res = validateSemanticClaims([claim], "personnel-santiago-stokes", run);
  assert.equal(res.ok, false);
  assert.equal(res.code, "SEMANTIC_CLAIM_EQUIPMENT_MISMATCH");
});

test("10 Valid semantic possession claim succeeds", () => {
  const { run } = createUtilityFixture("epistemic-10");
  const holder = canonicalLedger.getEquipmentHolder(run, "recording-device");
  assert.ok(holder);

  const claim = {
    type: "equipment-possession",
    subject: holder,
    object: "recording-device"
  };

  const res = validateSemanticClaims([claim], holder, run);
  assert.equal(res.ok, true);
});

test("11 Semantic location claim contradicting ledger fails", () => {
  const { run } = createUtilityFixture("epistemic-11");
  // Santiago is at utility-room, not threshold-room
  const claim = {
    type: "location",
    subject: "personnel-santiago-stokes",
    location: "threshold-room"
  };

  const res = validateSemanticClaims([claim], "personnel-santiago-stokes", run);
  assert.equal(res.ok, false);
  assert.equal(res.code, "SEMANTIC_CLAIM_LOCATION_MISMATCH");
});

test("12 Semantic direct-observation claim without observation provenance fails", () => {
  const { run } = createUtilityFixture("epistemic-12");
  // Santiago has no observation of unseen distortion
  const claim = {
    type: "direct-observation",
    observer: "personnel-santiago-stokes",
    target: "unseen-distortion"
  };

  const res = validateSemanticClaims([claim], "personnel-santiago-stokes", run);
  assert.equal(res.ok, false);
  assert.equal(res.code, "SEMANTIC_CLAIM_UNOBSERVED_TARGET");
});

test("13 Approved semantic claim can be surfaced in multiple wording variants", () => {
  const { run } = createUtilityFixture("epistemic-13");

  const packet = buildLocalDialoguePacket({
    run,
    player_text: "Check recording device.",
    speaker: { personnel_id: "personnel-beverly-bell" },
    person: { continuity: {} },
    reaction_context: {},
    reaction: { category: "acknowledgment" }
  });

  // Assign recording-device to Beverly for this test
  run.expedition.equipment["recording-device"].holder = "personnel-beverly-bell";

  const claim = [{ type: "equipment-possession", subject: "personnel-beverly-bell", object: "recording-device" }];

  const variant1 = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-beverly-bell",
    speech: "I have the recording device in my field pack.",
    semantic_claims: claim
  };

  const variant2 = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-beverly-bell",
    speech: "The recording device is secure with me.",
    semantic_claims: claim
  };

  assert.equal(validateLocalDialogue(packet, variant1, run).ok, true);
  assert.equal(validateLocalDialogue(packet, variant2, run).ok, true);
});

test("14 Wording variants do not change semantic observer knowledge", () => {
  const { run } = createUtilityFixture("epistemic-14");

  // Phrasing A vs Phrasing B in communication log
  const logA = structuredClone(run);
  logA.expedition.messages = logA.expedition.messages ?? [];
  logA.expedition.messages.push({
    id: "m-var-a",
    sender: "personnel-beverly-bell",
    text: "Wall seam is 4mm displaced.",
    channel: "LOCAL"
  });

  const logB = structuredClone(run);
  logB.expedition.messages = logB.expedition.messages ?? [];
  logB.expedition.messages.push({
    id: "m-var-b",
    sender: "personnel-beverly-bell",
    text: "There is an offset of 4mm on the seam.",
    channel: "LOCAL"
  });

  const shellA = projectObserverState(logA, "personnel-beverly-bell", "coworker-mini-shell");
  const shellB = projectObserverState(logB, "personnel-beverly-bell", "coworker-mini-shell");

  // Knowledge content is identical across phrasing variants
  assert.deepEqual(shellA.packet.knowledge, shellB.packet.knowledge);
  assert.deepEqual(shellA.packet.physical, shellB.packet.physical);
});

test("15 Negative constraints leak zero hidden IDs", () => {
  const { run } = createUtilityFixture("epistemic-15");
  const shell = projectObserverState(run, "personnel-santiago-stokes", "coworker-mini-shell");
  assert.equal(shell.ok, true);

  const constraints = shell.packet.knowledge.negative_constraints;
  assert.ok(Array.isArray(constraints));
  assert.ok(constraints.length > 0);

  // Default projection constraints leak zero hidden identifiers
  const cleanCheck = validateNegativeConstraintsNoLeaks(constraints, run);
  assert.equal(cleanCheck.ok, true);
  assert.equal(cleanCheck.leaked.length, 0);

  // Adversarial leak check: internal pattern leaked
  const leakyConstraints = [
    ...constraints,
    "Santiago must not mention open-passage-corridor-03"
  ];
  const leakCheck = validateNegativeConstraintsNoLeaks(leakyConstraints, run);
  assert.equal(leakCheck.ok, false);
  assert.ok(leakCheck.leaked.includes("open-passage-corridor-03"));
});

test("16 Actual player interpreter provider envelope excludes hidden state", async () => {
  const { run } = createUtilityFixture("epistemic-16");

  let capturedContext = null;
  const interceptingProvider = {
    name: "envelope-interceptor",
    interpret: async ({ player_text, context }) => {
      capturedContext = structuredClone(context);
      return createMockProvider().interpret({ player_text, context });
    }
  };

  await executePlayerTurn({
    run,
    provider: interceptingProvider,
    player_text: "Look around.",
    request_id: "test-envelope-16"
  });

  assert.ok(capturedContext);
  const serialized = JSON.stringify(capturedContext);

  // Does not expose raw internal worldpack geometry, unvisited rooms, or full simulation state
  assert.equal(serialized.includes("raw_graph"), false);
  assert.equal(serialized.includes("causal_ledger"), false);
  assert.equal(serialized.includes("secret_vault"), false);

  // Only observer-safe context present
  assert.equal(capturedContext.version, "yellow-beast-interpretation-context@v1");
  assert.ok(Array.isArray(capturedContext.visible_reference_labels));
});

test("17 Actual coworker provider envelope excludes other coworkers' private knowledge", () => {
  const { run } = createUtilityFixture("epistemic-17");

  // Give Beverly a private thought/diary entry in known_information
  const beverly = run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");
  beverly.known_information.push({
    kind: "private-note",
    text: "CONFIDENTIAL_BEVERLY_LOG_ALPHA_99"
  });

  // Build Santiago's packet
  const packet = buildLocalDialoguePacket({
    run,
    player_text: "Santiago, status check.",
    speaker: { personnel_id: "personnel-santiago-stokes" },
    person: { continuity: {} },
    reaction_context: {},
    reaction: { category: "acknowledgment" }
  });

  const serialized = JSON.stringify(packet);
  // Santiago's envelope must NOT leak Beverly's private information
  assert.equal(serialized.includes("CONFIDENTIAL_BEVERLY_LOG_ALPHA_99"), false);
});

test("18 Causal ledger does not become competing current-state authority", () => {
  const { run } = createUtilityFixture("epistemic-18");

  // Canonical location is utility-room
  const actualLocBefore = canonicalLedger.getPersonnelLocation(run, "personnel-santiago-stokes");
  assert.equal(actualLocBefore, "utility-room");

  // Inject a conflicting entry into causal_ledger
  run.causal_ledger = run.causal_ledger ?? [];
  run.causal_ledger.push({
    interval: 99,
    cause_action_id: "spurious-teleport",
    details: {
      personnel: "personnel-santiago-stokes",
      location: "fictional-hyper-corridor"
    }
  });

  // Current state query continues to read canonical state, NOT the causal log
  const actualLocAfter = canonicalLedger.getPersonnelLocation(run, "personnel-santiago-stokes");
  assert.equal(actualLocAfter, "utility-room");
});

test("19 Modifying cloned ledger query result cannot mutate canonical state", () => {
  const { run } = createUtilityFixture("epistemic-19");
  const playerId = run.session.startup.player.observer_id;

  // 1. Observations query
  const obs = canonicalLedger.getObserverObservations(run, playerId);
  obs.push({ target: "mutated-fake-target", is_direct_witness: true });

  const freshObs = canonicalLedger.getObserverObservations(run, playerId);
  assert.equal(freshObs.some((o) => o.target === "mutated-fake-target"), false);

  // 2. Standard knowledge query
  const std = canonicalLedger.getStandardKnowledge(run);
  std.received_claims.push({ claim_id: "fake-claim-999" });

  const freshStd = canonicalLedger.getStandardKnowledge(run);
  assert.equal(freshStd.received_claims.some((c) => c.claim_id === "fake-claim-999"), false);
});

test("20 Save/reload preserves knowledge provenance chains", () => {
  const { appDataPath, service, world, run } = createUtilityFixture("epistemic-20");
  const playerId = run.session.startup.player.observer_id;
  const santiago = run.expedition.team.members.find((m) => m.personnel_id === "personnel-santiago-stokes");
  const beverly = run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");
  const matthew = run.expedition.team.members.find((m) => m.personnel_id === playerId);

  // Build provenance chain: Santiago -> Beverly -> Matthew
  santiago.known_information.push(canonicalLedger.createDirectObservation({
    target: "acoustic-resonance-point",
    location: "utility-room",
    interval: 1,
    observation: "harmonic vibration at 60Hz"
  }));

  beverly.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "acoustic resonance at 60Hz",
    source_observer_id: "personnel-santiago-stokes",
    source_message_id: "msg-chain-1",
    interval: 2,
    origin_observer_id: "personnel-santiago-stokes"
  }));

  matthew.known_information.push(canonicalLedger.createReportedKnowledge({
    proposition: "acoustic resonance at 60Hz",
    source_observer_id: "personnel-beverly-bell",
    source_message_id: "msg-chain-2",
    interval: 3,
    origin_observer_id: "personnel-santiago-stokes",
    via_observer_id: "personnel-beverly-bell"
  }));

  assert.equal(canonicalLedger.validateInvariants(run).ok, true);

  // Save session and restart
  service.shutdown();
  const restarted = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: createLivingProvider()
  });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restoredRun = restarted.session(world.id, "field-researcher").run;

  // Invariants hold after reload
  const restoredInv = canonicalLedger.validateInvariants(restoredRun);
  assert.equal(restoredInv.ok, true);
  assert.equal(restoredInv.status, "PASS");

  // Provenance chains fully preserved
  const restoredSantiago = canonicalLedger.getObserverObservations(restoredRun, "personnel-santiago-stokes");
  assert.ok(restoredSantiago.some((o) => o.target === "acoustic-resonance-point" && o.is_direct_witness === true));

  const restoredMatthew = canonicalLedger.getObserverReportedKnowledge(restoredRun, playerId);
  const chainItem = restoredMatthew.find((r) => r.proposition.includes("acoustic resonance"));
  assert.ok(chainItem);
  assert.equal(chainItem.is_direct_witness, false);
  assert.equal(chainItem.origin_observer_id, "personnel-santiago-stokes");
  assert.equal(chainItem.via_observer_id, "personnel-beverly-bell");
});
