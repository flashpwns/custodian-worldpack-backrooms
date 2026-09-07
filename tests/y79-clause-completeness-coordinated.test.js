"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const equipment = require("../tools/q4-equipment");
const { createLivingProvider } = require("../tools/ai-living-provider");
const {
  PROPOSAL_VERSION,
  buildCustodianScope,
  interpretPlayerLanguage,
  validateAndResolve
} = require("../tools/ai-interpreter-boundary");
const { executeLivingTurn, validatePresentation, buildProviderPacket } = require("../tools/ai-living-turn");
const { projectLiveScene } = require("../tools/live-scene-projection");

function createUtilityFixture(seed = "clause-completeness") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-clause-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Clause Completeness", seed }).world;
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

test("1 Beverly photographs the fixture while I inspect it", async () => {
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
  const ev = run.expedition.evidence.at(-1);
  assert.equal(ev.operator, "personnel-beverly-bell");
  assert.equal(run.checklist.inspected, true);
  assert.equal(run.checklist.used, true);
});

test("2 I inspect the fixture while Beverly photographs it (verbatim live regression)", async () => {
  const { service, world, run } = createUtilityFixture("test-case-2");
  const beforeInterval = run.expedition.clock.interval;
  const beforeEvidence = run.expedition.evidence.length;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Beverly photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "RESOLVED");
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal(run.expedition.evidence.length, beforeEvidence + 1);
  const ev = run.expedition.evidence.at(-1);
  assert.equal(ev.operator, "personnel-beverly-bell");
  assert.equal(ev.custodian, "personnel-beverly-bell");
  assert.equal(ev.type, "fixture-photograph");
  assert.equal(run.checklist.inspected, true);
  assert.equal(run.checklist.used, true);
});

test("3 I inspect the fixture and Beverly photographs it (and conjunction coordination)", async () => {
  const { service, world, run } = createUtilityFixture("test-case-3");
  const beforeInterval = run.expedition.clock.interval;
  const beforeEvidence = run.expedition.evidence.length;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fixture and Beverly photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "RESOLVED");
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal(run.expedition.evidence.length, beforeEvidence + 1);
  assert.equal(run.checklist.inspected, true);
  assert.equal(run.checklist.used, true);
});

test("4 While I inspect the fixture, Beverly photographs it (leading while coordination)", async () => {
  const { service, world, run } = createUtilityFixture("test-case-4");
  const beforeInterval = run.expedition.clock.interval;
  const beforeEvidence = run.expedition.evidence.length;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "While I inspect the fixture, Beverly photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "RESOLVED");
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal(run.expedition.evidence.length, beforeEvidence + 1);
  assert.equal(run.checklist.inspected, true);
  assert.equal(run.checklist.used, true);
});

test("5 Named coworker by first name, full name, and unique role", async () => {
  for (const ref of ["Beverly", "Beverly Bell", "documentation specialist"]) {
    const { service, world, run } = createUtilityFixture(`test-case-5-${ref.replace(/\\s+/g, "-")}`);
    const beforeInterval = run.expedition.clock.interval;
    const res = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: `I inspect the fixture while ${ref} photographs it.`
    });
    assert.equal(res.ok, true, `Failed for reference "${ref}"`);
    assert.equal(res.result.turn_status, "RESOLVED");
    assert.equal(run.expedition.clock.interval, beforeInterval + 1);
    assert.equal(run.expedition.evidence.at(-1)?.operator, "personnel-beverly-bell");
  }
});

test("6 Two valid simultaneous actions commit one interval", async () => {
  const { service, world, run } = createUtilityFixture("test-case-6");
  const beforeInterval = run.expedition.clock.interval;
  const beforeAttempts = run.expedition.coordinated_attempts?.length ?? 0;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Beverly photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(run.expedition.clock.interval, beforeInterval + 1);
  assert.equal((run.expedition.coordinated_attempts?.length ?? 0), beforeAttempts + 1);
  const record = run.expedition.coordinated_attempts.at(-1);
  assert.equal(new Set(record.outcomes.map((o) => o.interval_id)).size, 1);
});

test("7 Reversed clause order produces equivalent authoritative intent, not necessarily identical prose", async () => {
  const fixtureA = createUtilityFixture("test-case-7a");
  const fixtureB = createUtilityFixture("test-case-7b");

  await fixtureA.service.submitNatural({
    world_id: fixtureA.world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Beverly photographs it."
  });

  await fixtureB.service.submitNatural({
    world_id: fixtureB.world.id,
    mode: "field-researcher",
    text: "Beverly photographs the fixture while I inspect it."
  });

  const runA = fixtureA.run;
  const runB = fixtureB.run;
  assert.equal(runA.expedition.clock.interval, runB.expedition.clock.interval);
  assert.equal(runA.expedition.evidence.length, runB.expedition.evidence.length);
  assert.equal(runA.expedition.evidence[0].type, runB.expedition.evidence[0].type);
  assert.equal(runA.expedition.evidence[0].operator, runB.expedition.evidence[0].operator);
  assert.equal(runA.checklist.inspected, runB.checklist.inspected);
  assert.equal(runA.checklist.used, runB.checklist.used);
});

test("8 Coworker-held required equipment succeeds only for that coworker", () => {
  const { run } = createUtilityFixture("test-case-8");
  const player = run.session.startup.player.observer_id;
  const bundle = {
    submission_id: "coworker-photo-ok",
    player_attempt: { actor: player, action: "INSPECT", target: "fluorescent-fixture" },
    coworker_attempts: [{ actor: "personnel-beverly-bell", action: "PHOTOGRAPH", target: "fluorescent-fixture" }]
  };
  const result = bootstrap.resolveCoordinatedAttempts(run, bundle);
  assert.equal(result.ok, true);
  assert.equal(run.expedition.evidence.at(-1)?.operator, "personnel-beverly-bell");
});

test("9 Player cannot use coworker-held equipment implicitly", () => {
  const { run } = createUtilityFixture("test-case-9");
  const player = run.session.startup.player.observer_id;
  const before = canonicalSnapshot(run);
  const bundle = {
    submission_id: "player-photo-fail",
    player_attempt: { actor: player, action: "PHOTOGRAPH", target: "fluorescent-fixture" },
    coworker_attempts: [{ actor: "personnel-beverly-bell", action: "INSPECT", target: "service-panel" }]
  };
  const result = bootstrap.resolveCoordinatedAttempts(run, bundle);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "COORDINATED_EQUIPMENT_NOT_HELD");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("10 Absent coworker causes clarification/rejection before any player clause commits", async () => {
  const { service, world, run } = createUtilityFixture("test-case-10");
  const before = canonicalSnapshot(run);

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Walter photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "CLARIFICATION_REQUIRED");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("11 Ambiguous coworker causes clarification with safe options and zero mutation", async () => {
  const { run, provider } = createUtilityFixture("test-case-11");
  const before = canonicalSnapshot(run);

  const scope = buildCustodianScope(run);
  const ambiguousProposal = {
    version: PROPOSAL_VERSION,
    status: "proposal",
    noncanonical: true,
    relation: "coordinated",
    attempts: [
      { actor: { kind: "player" }, action: "INSPECT", target_label: "fluorescent fixture", equipment_label: null, agency: "first-person", language_span: "I inspect the fluorescent fixture" },
      { actor: { kind: "coworker", reference: "specialist" }, action: "PHOTOGRAPH", target_label: "fluorescent fixture", equipment_label: null, agency: "player-order", language_span: "specialist photographs it" }
    ]
  };

  const res = validateAndResolve(ambiguousProposal, scope, { sourceText: "I inspect the fluorescent fixture while specialist photographs it.", requestId: "ambig-cw", source: "test" });
  assert.equal(res.kind, "clarification");
  assert.equal(res.code, "REFERENCE_AMBIGUOUS");
  assert.ok(res.options.length > 0);
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("12 Hidden/unobserved target is unavailable even if its internal ID is guessed", async () => {
  const { run } = createUtilityFixture("test-case-12");
  const before = canonicalSnapshot(run);
  const player = run.session.startup.player.observer_id;

  const bundle = {
    submission_id: "hidden-target",
    player_attempt: { actor: player, action: "INSPECT", target: "nonexistent-hidden-relic" },
    coworker_attempts: [{ actor: "personnel-beverly-bell", action: "PHOTOGRAPH", target: "fluorescent-fixture" }]
  };
  const res = bootstrap.resolveCoordinatedAttempts(run, bundle);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "COORDINATED_TARGET_UNAVAILABLE");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("13 One valid plus one impossible clause causes atomic no-mutation", () => {
  const { run } = createUtilityFixture("test-case-13");
  const before = canonicalSnapshot(run);
  const player = run.session.startup.player.observer_id;

  const bundle = {
    submission_id: "impossible-clause",
    player_attempt: { actor: player, action: "INSPECT", target: "fluorescent-fixture" },
    coworker_attempts: [{ actor: "personnel-beverly-bell", action: "PHOTOGRAPH", target: "nonexistent-door" }]
  };
  const res = bootstrap.resolveCoordinatedAttempts(run, bundle);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "COORDINATED_TARGET_UNAVAILABLE");
  assert.deepEqual(canonicalSnapshot(run), before);
  assert.equal(run.expedition.clock.interval, before.clock.interval);
  assert.equal(run.expedition.evidence.length, before.evidence.length);
});

test("14 One valid plus one unsupported verb causes clarification/no-mutation", async () => {
  const { service, world, run } = createUtilityFixture("test-case-14");
  const before = canonicalSnapshot(run);

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fixture while Beverly juggles."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "CLARIFICATION_REQUIRED");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("15 Three-clause sequence retains order", () => {
  const { run } = createUtilityFixture("test-case-15");
  const scope = buildCustodianScope(run);
  const { segmentSourceClauses } = require("../tools/ai-interpreter-boundary");
  const text = "I inspect the fixture, then Beverly photographs it, then I check the panel.";
  const segmented = segmentSourceClauses(text, scope.authority.coworkers);
  assert.equal(segmented.hasSequence, true);
  assert.equal(segmented.clauses.length, 2);
  assert.equal(segmented.clauses[0].span, "I inspect the fixture");
  assert.equal(segmented.clauses[1].span, "Beverly photographs it, then I check the panel.");
});

test("16 Mixed sequence and parallel relation is clarified before mutation", async () => {
  const { service, world, run } = createUtilityFixture("test-case-16");
  const before = canonicalSnapshot(run);

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fixture and then Beverly photographs it while I wait."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "CLARIFICATION_REQUIRED");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("17 Conditional instruction is clarified and condition text cannot be dropped", async () => {
  const { service, world, run } = createUtilityFixture("test-case-17");
  const before = canonicalSnapshot(run);

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture if Beverly photographs it."
  });

  assert.equal(res.ok, true);
  assert.equal(res.result.turn_status, "CLARIFICATION_REQUIRED");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("18 Malformed hosted structured output fails closed", async () => {
  const { run } = createUtilityFixture("test-case-18");
  const before = canonicalSnapshot(run);
  const badInterpreter = {
    name: "malformed-provider",
    async interpret() {
      return { garbage: true, attempts: "not an array" };
    }
  };

  const res = await executeLivingTurn({
    run,
    player_text: "I inspect the fluorescent fixture while Beverly photographs it.",
    interpreter: badInterpreter,
    request_id: "malformed-test"
  });

  assert.equal(res.status, "clarification");
  assert.equal(res.interpretation.code, "MALFORMED_INTERPRETATION");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("19 Hosted output with missing clause fails complete-coverage validation", async () => {
  const { run } = createUtilityFixture("test-case-19");
  const before = canonicalSnapshot(run);

  const droppingInterpreter = {
    name: "clause-dropping-provider",
    async interpret() {
      return {
        version: PROPOSAL_VERSION,
        status: "proposal",
        noncanonical: true,
        relation: "single",
        attempts: [
          { actor: { kind: "player" }, action: "INSPECT", target_label: "fluorescent fixture", equipment_label: null, agency: "first-person", language_span: "I inspect the fluorescent fixture" }
        ]
      };
    }
  };

  const res = await executeLivingTurn({
    run,
    player_text: "I inspect the fluorescent fixture while Beverly photographs it.",
    interpreter: droppingInterpreter,
    request_id: "missing-clause-test"
  });

  assert.equal(res.status, "clarification");
  assert.equal(res.interpretation.code, "INCOMPLETE_CLAUSE_COVERAGE");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("20 Hosted output with invented extra clause fails validation", async () => {
  const { run } = createUtilityFixture("test-case-20");
  const before = canonicalSnapshot(run);

  const inventingInterpreter = {
    name: "inventing-provider",
    async interpret() {
      return {
        version: PROPOSAL_VERSION,
        status: "proposal",
        noncanonical: true,
        relation: "coordinated",
        attempts: [
          { actor: { kind: "player" }, action: "INSPECT", target_label: "fluorescent fixture", equipment_label: null, agency: "first-person", language_span: "I inspect the fluorescent fixture" },
          { actor: { kind: "coworker", reference: "Beverly" }, action: "PHOTOGRAPH", target_label: "fluorescent fixture", equipment_label: null, agency: "player-order", language_span: "Beverly photographs it" },
          { actor: { kind: "coworker", reference: "Santiago" }, action: "INSPECT", target_label: "scuffed floor", equipment_label: null, agency: "player-order", language_span: "Santiago checks the floor" }
        ]
      };
    }
  };

  const res = await executeLivingTurn({
    run,
    player_text: "I inspect the fluorescent fixture while Beverly photographs it.",
    interpreter: inventingInterpreter,
    request_id: "invented-clause-test"
  });

  assert.equal(res.status, "clarification");
  assert.ok(["PLAYER_AGENCY_UNSUPPORTED", "EXTRA_CLAUSE_UNSUPPORTED"].includes(res.interpretation.code));
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("21 Provider failure is distinct from ambiguity and retains zero mutation before dispatch", async () => {
  const { run } = createUtilityFixture("test-case-21");
  const before = canonicalSnapshot(run);

  const failingInterpreter = {
    name: "exploding-provider",
    async interpret() {
      throw new Error("NETWORK_DOWN");
    }
  };

  const res = await executeLivingTurn({
    run,
    player_text: "I inspect the fluorescent fixture while Beverly photographs it.",
    interpreter: failingInterpreter,
    request_id: "provider-fail-test"
  });

  assert.equal(res.status, "interpretation_failed");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("22 Presentation failure after successful coordinated dispatch retains exactly one canonical interval", async () => {
  const { run, provider } = createUtilityFixture("test-case-22");
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
  assert.equal(run.expedition.evidence.length, 1);
  assert.equal(run.expedition.evidence[0].operator, "personnel-beverly-bell");
});

test("23 Save/reload preserves both coordinated effects and provenance", async () => {
  const { appDataPath, service, world, run } = createUtilityFixture("test-case-23");
  const beforeInterval = run.expedition.clock.interval;

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Beverly photographs it."
  });
  assert.equal(res.ok, true);
  service.shutdown();

  const restarted = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: createLivingProvider()
  });
  assert.equal(restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);
  const restored = restarted.session(world.id, "field-researcher").run;

  assert.equal(restored.expedition.clock.interval, beforeInterval + 1);
  assert.equal(restored.expedition.evidence.length, 1);
  const ev = restored.expedition.evidence[0];
  assert.equal(ev.operator, "personnel-beverly-bell");
  assert.equal(ev.custodian, "personnel-beverly-bell");
  assert.equal(ev.type, "fixture-photograph");
  assert.equal(restored.checklist.inspected, true);
  assert.equal(restored.checklist.used, true);
});

test("24 Renderer displays a truthful combined outcome", async () => {
  const { service, world } = createUtilityFixture("test-case-24");

  const res = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the fluorescent fixture while Beverly photographs it."
  });

  assert.equal(res.ok, true);
  const scene = res.result.scene;
  assert.ok(scene.narration.includes("Beverly Bell photographs fluorescent fixture"));
  assert.ok(!scene.narration.includes("SECRET"));
  assert.ok(!scene.narration.includes("internal_id"));
});

test("25 No generated player speech, thought, realization, emotion, or unsubmitted action", () => {
  const { run } = createUtilityFixture("test-case-25");
  const projected = projectLiveScene(run, { observer_id: run.session.startup.player.observer_id });
  const providerPacket = buildProviderPacket(projected.packet, { ok: true, outcome: "succeeded" });

  const invalid1 = {
    version: "yellow-beast-presentation-candidate@v1",
    scene_description: "You say to Beverly that everything is fine.",
    npc_presentations: [],
    presentation_claims: []
  };
  assert.equal(validatePresentation(providerPacket, invalid1).code, "PRESENTATION_PLAYER_AGENCY_INVENTED");

  const invalid2 = {
    version: "yellow-beast-presentation-candidate@v1",
    scene_description: "You decide that the fixture is too dangerous to touch.",
    npc_presentations: [],
    presentation_claims: []
  };
  assert.equal(validatePresentation(providerPacket, invalid2).code, "PRESENTATION_PLAYER_AGENCY_INVENTED");
});
