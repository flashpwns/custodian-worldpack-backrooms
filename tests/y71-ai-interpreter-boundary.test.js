"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const equipment = require("../tools/q4-equipment");
const {
  PROPOSAL_VERSION,
  SINGLE_SINK,
  COORDINATED_SINK,
  interpretPlayerLanguage,
  dispatchCandidate
} = require("../tools/ai-interpreter-boundary");

function fixture(seed = "ai-interpreter") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ai-interpreter-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "Interpreter Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open passage" }).ok, true);
  return { service, world, run: service.session(world.id, "field-researcher").run };
}

function canonicalSnapshot(run) {
  return structuredClone({
    clock: run.expedition.clock,
    operational: run.expedition.operational,
    evidence: run.expedition.evidence,
    history: run.expedition.history,
    interactions: run.expedition.interaction_history,
    object_state: run.object_state,
    equipment: run.expedition.equipment,
    team: run.expedition.team,
    team_runtime: run.expedition.team_runtime,
    spatial: run.spatial
  });
}

function languageAuthority(output, capture = null) {
  return {
    name: "focused-test-language-authority",
    async interpret(request) {
      if (capture) capture(request);
      return structuredClone(output);
    }
  };
}

function attempt({ actor = { kind: "player" }, action = "INSPECT", target = "descending grade", equipment_label = null, agency = "direct-player", span = "Inspect the descending grade" } = {}) {
  return { actor, action, target_label: target, equipment_label, agency, language_span: span };
}

function proposal(attempts, relation = "single") {
  return { version: PROPOSAL_VERSION, status: "proposal", noncanonical: true, relation, attempts };
}

test("normal player language produces a typed noncanonical single-action candidate without mutating canon", async () => {
  const { run } = fixture("ai-normal");
  const before = canonicalSnapshot(run);
  let suppliedContext;
  const result = await interpretPlayerLanguage({
    run,
    player_text: "Inspect the descending grade.",
    request_id: "normal-001",
    interpreter: languageAuthority(proposal([attempt()]), ({ context }) => { suppliedContext = context; })
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.noncanonical, true);
  assert.equal(result.sink.kind, SINGLE_SINK);
  assert.deepEqual(result.sink.payload, { action: "INSPECT", target: "descending grade" });
  assert.equal(result.validation.canonical_state, "unmodified");
  assert.deepEqual(canonicalSnapshot(run), before);
  assert.equal(suppliedContext.authority_contract.canonical_resolution, "Custodian-only");
  const exposed = JSON.stringify(suppliedContext);
  assert.equal(exposed.includes(run.session.startup.player.observer_id), false);
  for (const member of run.expedition.team.members) assert.equal(exposed.includes(member.personnel_id), false);
});

test("an ambiguous local coworker reference returns only observer-safe clarification options", async () => {
  const { run } = fixture("ai-ambiguous");
  const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  const text = "Have the specialist inspect the descending grade while I measure the open passage with the survey instrument.";
  const result = await interpretPlayerLanguage({
    run,
    player_text: text,
    interpreter: languageAuthority(proposal([
      attempt({ actor: { kind: "coworker", reference: "specialist" }, agency: "player-order", span: "Have the specialist inspect the descending grade" }),
      attempt({ action: "USE", target: "open passage", equipment_label: "survey instrument", agency: "first-person", span: "I measure the open passage with the survey instrument" })
    ], "coordinated"))
  });

  assert.equal(result.kind, "clarification");
  assert.equal(result.code, "REFERENCE_AMBIGUOUS");
  assert.equal(result.options.length, 2);
  assert.ok(result.options.every((label) => run.expedition.team.members.some((member) => member.display_name === label)));
});

test("malformed interpreter output fails closed as a clarification and mutates nothing", async () => {
  const { run } = fixture("ai-malformed");
  const before = canonicalSnapshot(run);
  const result = await interpretPlayerLanguage({ run, player_text: "Inspect the descending grade.", interpreter: languageAuthority({ status: "proposal" }) });
  assert.equal(result.kind, "clarification");
  assert.equal(result.code, "MALFORMED_INTERPRETATION");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("a correct authored but unobserved hidden reference remains invalid", async () => {
  const { run } = fixture("ai-hidden");
  const before = canonicalSnapshot(run);
  const result = await interpretPlayerLanguage({
    run,
    player_text: "Inspect the relay bank.",
    interpreter: languageAuthority(proposal([attempt({ target: "relay bank", span: "Inspect the relay bank" })]))
  });

  assert.equal(result.kind, "clarification");
  assert.equal(result.code, "REFERENCE_NOT_OBSERVER_SAFE");
  assert.equal(result.options.includes("relay bank"), false);
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("the interpreter cannot invent a player action to complete a coworker-only instruction", async () => {
  const { run } = fixture("ai-player-agency");
  const before = canonicalSnapshot(run);
  const text = "Have the survey technician inspect the descending grade.";
  const result = await interpretPlayerLanguage({
    run,
    player_text: text,
    interpreter: languageAuthority(proposal([
      attempt({ actor: { kind: "coworker", reference: "survey technician" }, agency: "player-order", span: "Have the survey technician inspect the descending grade" }),
      attempt({ action: "USE", target: "open passage", equipment_label: "survey instrument", agency: "first-person", span: text })
    ], "coordinated"))
  });

  assert.equal(result.kind, "clarification");
  assert.equal(result.code, "PLAYER_AGENCY_UNSUPPORTED");
  assert.deepEqual(canonicalSnapshot(run), before);
});

test("an explicit coordinated interpretation targets the existing Custodian executor and dispatch is separately authoritative", async () => {
  const { run } = fixture("ai-coordinated");
  const player = run.session.startup.player.observer_id;
  const survey = run.expedition.team.members.find((member) => member.role === "survey technician");
  assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey.personnel_id, player).ok, true);
  const beforeInterpretation = canonicalSnapshot(run);
  const text = "Have the survey technician inspect the descending grade while I measure the open passage with the survey instrument.";
  const result = await interpretPlayerLanguage({
    run,
    player_text: text,
    request_id: "coordinated-001",
    interpreter: languageAuthority(proposal([
      attempt({ actor: { kind: "coworker", reference: "survey technician" }, agency: "player-order", span: "Have the survey technician inspect the descending grade" }),
      attempt({ action: "USE", target: "open passage", equipment_label: "survey instrument", agency: "first-person", span: "I measure the open passage with the survey instrument" })
    ], "coordinated"))
  });

  assert.equal(result.kind, "candidate");
  assert.equal(result.sink.kind, COORDINATED_SINK);
  assert.deepEqual(result.sink.payload.player_attempt, { actor: player, action: "USE", target: "open-passage", equipment: "survey-instrument" });
  assert.deepEqual(result.sink.payload.coworker_attempts, [{ actor: survey.personnel_id, action: "INSPECT", target: "descending grade" }]);
  assert.deepEqual(canonicalSnapshot(run), beforeInterpretation);

  const committed = dispatchCandidate(run, result);
  assert.equal(committed.ok, true);
  assert.equal(run.expedition.clock.interval, beforeInterpretation.clock.interval + 1);
  assert.equal(committed.result.outcomes.length, 2);
});

test("dispatch rejects a forged candidate instead of trusting generated structure", async () => {
  const { run } = fixture("ai-forged");
  const before = canonicalSnapshot(run);
  const rejected = dispatchCandidate(run, {
    version: "yellow-beast-interpreter-result@v1",
    kind: "candidate",
    sink: { kind: SINGLE_SINK, payload: { action: "MOVE", target: "relay-alcove" } }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "UNVALIDATED_INTERPRETATION");
  assert.deepEqual(canonicalSnapshot(run), before);
});
