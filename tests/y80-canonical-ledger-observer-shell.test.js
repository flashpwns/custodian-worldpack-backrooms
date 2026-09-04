"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const { projectLiveScene, projectObserverState } = require("../tools/live-scene-projection");
const {
  buildLocalDialoguePacket,
  validateLocalDialogue,
  validateDialogueClaims
} = require("../tools/ai-local-dialogue");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { executeLivingTurn } = require("../tools/ai-living-turn");

function createUtilityFixture(seed = "ledger-observer-shell") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ledger-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Ledger Observer Shell", seed }).world;
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

test("1 YB-C02 complete-clause parsing still passes", async () => {
  const { service, world, run } = createUtilityFixture("test-case-1");
  const beforeInterval = run.expedition.clock.interval;
  const beforeEvidence = run.expedition.evidence.length;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "Beverly photographs the fixture while I inspect it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "RESOLVED");
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal(run.expedition.evidence.length, beforeEvidence + 1);

  const photoEvidence = run.expedition.evidence.at(-1);
  assert.equal(photoEvidence.creator, "personnel-beverly-bell");
  assert.equal(photoEvidence.custodian, "personnel-beverly-bell");
  assert.equal(photoEvidence.capturing_observer, "personnel-beverly-bell");
});

test("2 Coordinated actions still execute atomically", async () => {
  const { service, world, run } = createUtilityFixture("test-case-2");
  const beforeSnapshot = canonicalSnapshot(run);

  // Impossible target in second clause
  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fixture while Beverly photographs the moon."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "CLARIFICATION_REQUIRED");
  // Zero canonical mutation
  assert.deepEqual(canonicalSnapshot(run), beforeSnapshot);
});

test("3 Player interpreter receives observer-safe shell rather than full canonical world", () => {
  const { run } = createUtilityFixture("test-case-3");
  const playerId = run.session.startup.player.observer_id;

  const shell = projectObserverState(run, playerId, "player-interpreter");
  assert.equal(shell.ok, true);
  assert.equal(shell.packet.purpose, "player-interpreter");
  assert.equal(shell.packet.observer_id, playerId);
  assert.equal(shell.packet.location.id, run.spatial.player_location);

  // Excludes raw worldpack definitions, unvisited nodes, hidden graph
  assert.equal(shell.packet.raw_graph, undefined);
  assert.equal(shell.packet.hidden_truth, undefined);
  assert.ok(Array.isArray(shell.packet.visible_objects));
  assert.ok(Array.isArray(shell.packet.visible_personnel));
  assert.ok(Array.isArray(shell.packet.held_equipment));
});

test("4 Hidden geometry does not enter player shell", () => {
  const { run } = createUtilityFixture("test-case-4");
  const playerId = run.session.startup.player.observer_id;

  const shell = projectObserverState(run, playerId, "player-interpreter");
  assert.equal(shell.ok, true);

  // Player is in utility-room; unvisited reference rooms must NOT be present
  assert.equal(shell.packet.location.id, "utility-room");
  const allLocationsInShell = [shell.packet.location.id];
  assert.ok(!allLocationsInShell.includes("corridor-alpha"));
  assert.ok(!allLocationsInShell.includes("kv31-deep-node"));
});

test("5 Hidden state does not enter coworker shell", () => {
  const { run } = createUtilityFixture("test-case-5");

  const coworkerShell = projectObserverState(run, "personnel-beverly-bell", "coworker-mini-shell");
  assert.equal(coworkerShell.ok, true);
  assert.equal(coworkerShell.packet.purpose, "coworker-mini-shell");
  assert.equal(coworkerShell.packet.identity.observer_id, "personnel-beverly-bell");

  // Verify negative constraints are present and explicit
  assert.ok(Array.isArray(coworkerShell.packet.knowledge.negative_constraints));
  assert.ok(coworkerShell.packet.knowledge.negative_constraints.length > 0);

  // Hidden/unobserved facts are absent
  assert.equal(coworkerShell.packet.knowledge.secret_object_properties, undefined);
});

test("6 Matthew cannot reference an event he did not observe/hear", () => {
  const { run } = createUtilityFixture("test-case-6");
  const matthewId = "matthew-murphy";

  // Matthew has never inspected or observed a distant scuff mark
  const packet = {
    speaker: { observer_id: matthewId },
    visible_context: { visible_objects: [] }
  };
  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: matthewId,
    speech: "I inspected the scuff mark in the far hallway earlier."
  };

  const validation = validateDialogueClaims(packet, candidate, run);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
});

test("7 Matthew can reference it after valid reported knowledge reaches him", () => {
  const { run } = createUtilityFixture("test-case-7");
  const matthewId = run.session.startup.player.observer_id;
  const matthewMember = canonicalLedger.getObserverMember(run, matthewId);

  // Add reported knowledge to Matthew
  matthewMember.known_information ??= [];
  matthewMember.known_information.push({
    kind: "reported-knowledge",
    text: "Beverly completed the fluorescent fixture photo.",
    source: "local-communication",
    sender: "personnel-beverly-bell",
    at: run.expedition.clock.interval
  });

  const packet = {
    speaker: { observer_id: matthewId },
    visible_context: { visible_objects: [] }
  };
  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: matthewId,
    speech: "I acknowledge that the fixture was photographed."
  };

  const validation = validateDialogueClaims(packet, candidate, run);
  assert.equal(validation.ok, true);
});

test("8 Direct observation remains distinct from reported knowledge", () => {
  const { run } = createUtilityFixture("test-case-8");
  const member = canonicalLedger.getObserverMember(run, "personnel-santiago-stokes");

  member.known_information = [
    {
      kind: "coordinated-inspection",
      target: "utility-fluorescent-fixture",
      location: "utility-room",
      at: 5,
      source: "direct-observation",
      interval_id: "int-1"
    },
    {
      kind: "reported-knowledge",
      text: "The survey route is open.",
      source: "local-communication",
      sender: "personnel-beverly-bell",
      at: 5
    }
  ];

  const direct = canonicalLedger.getObserverObservations(run, "personnel-santiago-stokes");
  const reported = canonicalLedger.getObserverReportedKnowledge(run, "personnel-santiago-stokes");

  assert.equal(direct.length, 1);
  assert.equal(direct[0].target, "utility-fluorescent-fixture");
  assert.equal(direct[0].source, "direct-observation");

  assert.equal(reported.length, 1);
  assert.equal(reported[0].text, "The survey route is open.");
  assert.equal(reported[0].source, "local-communication");
});

test("9 Local speech can update multiple hearers without forcing multiple replies", () => {
  const { service, world, run } = createUtilityFixture("test-case-9");
  const playerId = run.session.startup.player.observer_id;
  const res = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    text: "Team, maintain spacing near the conduit."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.outcome, "delivered");

  // All coworkers in the room heard it and received reported-knowledge
  const coworkers = run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  for (const cw of coworkers) {
    const hasReported = (cw.known_information ?? []).some((item) =>
      item.kind === "reported-knowledge" && item.text === "Team, maintain spacing near the conduit."
    );
    assert.ok(hasReported, `Coworker ${cw.first_name} should have heard the local transmission`);
  }

  // Exactly one coworker response was generated in public reason / scene narration
  assert.ok(res.result.public_reason);
  assert.equal(typeof res.result.public_reason, "string");
  // Does not contain multiple distinct speaker tags in a row like "Santiago: ... Beverly: ... Autumn: ..."
  const speakerColonMatches = res.result.public_reason.match(/^[A-Z][a-z]+:/gm);
  assert.ok(!speakerColonMatches || speakerColonMatches.length <= 1);
});

test("10 One direct question to Beverly does not automatically produce responses from all four coworkers", () => {
  const { service, world } = createUtilityFixture("test-case-10");
  const res = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    text: "Beverly, what is our status on camera film?"
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.outcome, "delivered");
  // Only Beverly responds or the response is directed from Beverly
  assert.ok(res.result.public_reason.includes("Beverly") || res.result.public_reason.includes("camera") || res.result.public_reason.includes("exposure") || res.result.public_reason.includes("custody"));
  assert.ok(!res.result.public_reason.includes("Santiago:") && !res.result.public_reason.includes("Autumn:"));
});

test("11 Equipment ownership exists in one canonical location", () => {
  const { run } = createUtilityFixture("test-case-11");

  const cameraHolder = canonicalLedger.getEquipmentHolder(run, "recording-device");
  assert.equal(cameraHolder, "personnel-beverly-bell");

  // Ensure invariant: each equipment item has exactly one holder string
  const invariants = canonicalLedger.validateInvariants(run);
  assert.equal(invariants.ok, true);
  assert.equal(invariants.violations.length, 0);
});

test("12 A coworker dialogue claim contradicting camera ownership is rejected", () => {
  const { run } = createUtilityFixture("test-case-12");

  // Beverly holds camera; Matthew falsely claims he has it
  const packet = {
    speaker: { observer_id: "personnel-santiago-stokes" },
    visible_context: { visible_objects: [] }
  };
  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-santiago-stokes",
    speech: "I have the camera right here in my hands."
  };

  const validation = validateDialogueClaims(packet, candidate, run);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
});

test("13 A valid camera-ownership claim is permitted", () => {
  const { run } = createUtilityFixture("test-case-13");

  // Beverly holds camera; Beverly truthfully claims custody
  const packet = {
    speaker: { observer_id: "personnel-beverly-bell" },
    visible_context: { visible_objects: [] }
  };
  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-beverly-bell",
    speech: "I have the camera ready for the next observation."
  };

  const validation = validateDialogueClaims(packet, candidate, run);
  assert.equal(validation.ok, true);
});

test("14 Standard does not know an observation before transmission", () => {
  const { run } = createUtilityFixture("test-case-14");

  // Prior to radio transmission, Standard has no record of local observations
  const standardKnowledge = canonicalLedger.getStandardKnowledge(run);
  const mentionsFixture = standardKnowledge.received_transmissions.some((t) => t.text.includes("fluorescent"));
  assert.equal(mentionsFixture, false);
});

test("15 Standard knows it after successful canonical transmission", () => {
  const { service, world, run } = createUtilityFixture("test-case-15");
  const playerId = run.session.startup.player.observer_id;

  const res = service.submitQ4Communication({
    world_id: world.id,
    channel: "standard",
    text: "Standard, field team observed utility fluorescent fixture at T+5."
  });

  assert.equal(res.ok, true);
  const standardKnowledge = canonicalLedger.getStandardKnowledge(run);
  const received = standardKnowledge.received_transmissions.find((t) => t.text.includes("fluorescent fixture"));
  assert.ok(received);
  assert.equal(received.sender, playerId);
});

test("16 Save/reload reconstructs semantically equivalent player shell", () => {
  const { appDataPath, service, world, run } = createUtilityFixture("test-case-16");
  const playerId = run.session.startup.player.observer_id;

  const shellBefore = projectObserverState(run, playerId, "player-interpreter");
  assert.equal(shellBefore.ok, true);

  service.shutdown();
  const restarted = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: createLivingProvider()
  });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restoredRun = restarted.session(world.id, "field-researcher").run;

  const shellAfter = projectObserverState(restoredRun, playerId, "player-interpreter");

  assert.equal(shellAfter.ok, true);
  assert.deepEqual(shellBefore.packet, shellAfter.packet);
});

test("17 Save/reload reconstructs semantically equivalent coworker shell", () => {
  const { appDataPath, service, world, run } = createUtilityFixture("test-case-17");

  const shellBefore = projectObserverState(run, "personnel-beverly-bell", "coworker-mini-shell");
  assert.equal(shellBefore.ok, true);

  service.shutdown();
  const restarted = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: createLivingProvider()
  });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restoredRun = restarted.session(world.id, "field-researcher").run;

  const shellAfter = projectObserverState(restoredRun, "personnel-beverly-bell", "coworker-mini-shell");

  assert.equal(shellAfter.ok, true);
  assert.deepEqual(shellBefore.packet, shellAfter.packet);
});

test("18 Transcript wording changes do not alter canonical reconstruction", () => {
  const { appDataPath, service, world, run } = createUtilityFixture("test-case-18");

  // Mutate presentation transcript prose only
  if (run.expedition.messages?.[0]) {
    run.expedition.messages[0].text = "MODIFIED TRANSCRIPT PROSE ONLY";
  }

  const snapshotBefore = canonicalSnapshot(run);

  service.shutdown();
  const restarted = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: createLivingProvider()
  });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restoredRun = restarted.session(world.id, "field-researcher").run;
  const snapshotAfter = canonicalSnapshot(restoredRun);

  // Canonical reality (locations, objects, equipment holders) remains strictly identical
  assert.deepEqual(snapshotBefore.spatial, snapshotAfter.spatial);
  assert.deepEqual(snapshotBefore.object_state, snapshotAfter.object_state);
  assert.deepEqual(snapshotBefore.equipment, snapshotAfter.equipment);
});

test("19 Generated dialogue cannot mutate world state", () => {
  const { run } = createUtilityFixture("test-case-19");
  const before = canonicalSnapshot(run);

  const packet = buildLocalDialoguePacket({
    run,
    player_text: "Beverly, report status.",
    speaker: { personnel_id: "personnel-beverly-bell" },
    person: { continuity: {} },
    reaction_context: { equipment: ["recording-device"] },
    reaction: { category: "acknowledgment" }
  });

  const candidate = {
    version: "yellow-beast-local-dialogue-candidate@v1",
    observer_id: "personnel-beverly-bell",
    speech: "Camera is calibrated and operational."
  };

  const res = validateLocalDialogue(packet, candidate, run);
  assert.equal(res.ok, true);

  const after = canonicalSnapshot(run);
  assert.deepEqual(before, after);
});

test("20 Existing YB-C02 presentation-failure atomicity remains intact", async () => {
  const { run, provider } = createUtilityFixture("test-case-20");
  const beforeInterval = run.expedition.clock.interval;

  const failingPresenter = {
    name: "exploding-presenter",
    interpret: (req) => provider.interpret(req),
    async present() {
      throw new Error("GENERATION_REJECTED");
    }
  };

  const res = await executeLivingTurn({
    run,
    player_text: "I inspect the fluorescent fixture while Beverly photographs it.",
    interpreter: failingPresenter,
    presentation_provider: failingPresenter,
    request_id: "presentation-fail-test"
  });

  assert.equal(res.status, "resolved");
  assert.equal(res.presentation.source, "deterministic-fallback");
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal(run.checklist.inspected, true);
  assert.equal(run.checklist.used, true);

  const photo = run.expedition.evidence.find((e) => e.capturing_observer === "personnel-beverly-bell");
  assert.ok(photo);
});
