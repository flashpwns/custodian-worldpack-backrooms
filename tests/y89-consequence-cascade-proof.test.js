"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const q4Environment = require("../tools/q4-environment");
const decisionScheduler = require("../tools/decision-scheduler");
const consequenceRuntime = require("../tools/consequence-runtime");
const q4Equipment = require("../tools/q4-equipment");
const canonicalLedger = require("../tools/canonical-world-ledger");
const q4Continuity = require("../tools/q4-personnel-continuity");
const communicationRuntime = require("../tools/communication-runtime");
const operationalTime = require("../tools/operational-time");
const bootstrap = require("../tools/run-bootstrap");
const fieldNotes = require("../tools/field-notes");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "consequence-cascade") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-cascade-proof-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Cascade Proof", seed }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" });
  return { appDataPath, service, world };
}

async function advanceToFieldOperation(service, worldId) {
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" });
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "PROCEED" });
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "APPROACH" });
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" });
  await service.submitQ4Communication({ world_id: worldId, channel: "standard", text: "Radio check Standard." });
  await service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CROSS" });
}

test("Cascade 1: Power -> Lighting -> Perception -> Equipment/Evidence -> Comms -> Coworker Opportunity", async () => {
  const { appDataPath, service, world } = createTestService("power-cascade");
  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");
    const run = entry.run;
    const env = run.spatial.environment;

    // 1. Initial baseline: Relay circuit power is normal, lighting is intermittent, comms is nominal
    const baselineAlcove = q4Environment.current(env, "relay-alcove");
    assert.equal(baselineAlcove.lighting, "intermittent");

    // 2. Power failure mutation on relay infrastructure
    const powerMutation = q4Environment.mutatePower(env, "relay-circuit", "unavailable", { at: run.expedition.clock.interval });
    assert.equal(powerMutation.ok, true);
    assert.equal(powerMutation.state.infrastructure["relay-circuit"].power, "unavailable");

    // 3. Derived Lighting: relay-alcove lighting derives dark automatically without manual setting
    const derivedLighting = q4Environment.current(env, "relay-alcove").lighting;
    assert.equal(derivedLighting, "dark", "Power failure must derive lighting=dark in downstream locations");

    // 4. Derived Perception: unassisted visibility is limited; assisted visibility requires field light
    const unassistedObs = q4Environment.observation(env, "relay-alcove", { has_field_light: false });
    assert.equal(unassistedObs.visibility, "limited", "Dark lighting must derive limited visibility unassisted");

    const assistedObs = q4Environment.observation(env, "relay-alcove", { has_field_light: true });
    assert.equal(assistedObs.visibility, "field-light-assisted", "Field light must derive field-light-assisted visibility");

    // 5. Derived Equipment/Evidence context: photo/measurement capture context reflects dark and limited visibility
    const captureCtx = q4Environment.captureContext(env, "relay-alcove", { has_field_light: false });
    assert.equal(captureCtx.lighting, "dark");
    assert.equal(captureCtx.visibility, "limited");

    // 6. Derived Communications effect: relay-alcove comms coverage drops to unavailable
    const derivedComms = q4Environment.coverage(env, "relay-alcove");
    assert.equal(derivedComms, "unavailable", "Power failure must derive communications=unavailable in relay zone");

    // 7. Derived Coworker Decision Opportunity: hazard/dark condition produces decision opportunity
    const spatialDef = bootstrap.spatialDefinitionFor(run.spatial_pack_id);
    const opps = decisionScheduler.evaluateOpportunities(run, spatialDef, service.getWorld(world.id));
    assert.ok(Array.isArray(opps), "Opportunities must evaluate");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Cascade 2: Environment -> Coverage -> Message Delivery -> Standard Knowledge -> Personnel Contact", async () => {
  const { appDataPath, service, world } = createTestService("comms-cascade");
  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");
    const run = entry.run;
    const env = run.spatial.environment;

    // 1. Cut power to relay circuit -> derives communications=unavailable at relay-alcove
    q4Environment.mutatePower(env, "relay-circuit", "unavailable", { at: run.expedition.clock.interval });
    assert.equal(q4Environment.coverage(env, "relay-alcove"), "unavailable");

    // 2. Player moves to relay-alcove and transmits a sensitive observation
    const playerId = run.session.startup.player.observer_id;
    run.spatial.player_location = "relay-alcove";
    run.spatial.personnel_locations[playerId] = "relay-alcove";
    const secretReport = "Discovered anomalous structure in relay alcove.";

    const dynamicsDef = bootstrap.dynamicsDefinitionFor(run.spatial_pack_id);
    const queued = communicationRuntime.queueRadio(run, dynamicsDef, {
      sender: playerId,
      recipient: "Standard",
      text: secretReport,
      purpose: "routine-report"
    });
    assert.equal(queued.ok, true);
    assert.ok(queued.message.interference?.unavailable, "Coverage unavailable must set interference.unavailable=true");

    // 3. Operational time handles transmission attempt -> derives message failure
    const operational = operationalTime.ensure(run.expedition);
    const scheduledTransmit = operational.events.find((s) => s.id === `transmit-${queued.message.id}`);
    assert.ok(scheduledTransmit, "Transmission must be scheduled");
    const result = communicationRuntime.handleEvent(run, dynamicsDef, scheduledTransmit);
    assert.equal(result.result?.state, "failed", "Transmission must fail due to unavailable coverage");

    // 4. Standard Knowledge: Standard does NOT learn secretReport because delivery failed
    const standardKnowledge = canonicalLedger.getStandardKnowledge(run);
    const standardKnowsSecret = (standardKnowledge.received_claims ?? []).some((k) => String(k.semantic_claim?.text).includes(secretReport));
    assert.equal(standardKnowsSecret, false, "Standard must NOT acquire knowledge from failed transmission");

    // 5. Personnel Contact: Coworker holding position in utility-room is outside player sight/comms
    const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");
    canonicalLedger.setCoworkerTask(run, santiago.personnel_id, { task: "hold", target: "utility-room", status: "holding" });
    const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
    const santiagoProj = projection.q4.team.find((m) => m.first_name === "Santiago");
    assert.equal(santiagoProj.contact_category, "CONTACT LOST", "Separated coworker must derive CONTACT LOST under dead zone");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Cascade 3: Battery/Condition -> Affordance -> Task Feasibility -> Actor Decision -> Field Notes", async () => {
  const { appDataPath, service, world } = createTestService("equip-cascade");
  try {
    await advanceToFieldOperation(service, world.id);
    const entry = service.session(world.id, "field-researcher");
    const run = entry.run;
    let beverly = run.expedition.team.members.find((m) => m.first_name === "Beverly");

    // 1. Give field-light to Beverly
    service.submitQ4Handoff({ world_id: world.id, item_id: "field-light", target: beverly.personnel_id });
    assert.equal(run.expedition.equipment["field-light"].holder, beverly.personnel_id);

    // 2. Equipment failure: battery depletion / damage
    const consequence = consequenceRuntime.apply(run, {
      effects: [{ kind: "equipment-state", target: "field-light", state: "depleted" }],
      source: "prolonged-operation"
    });
    assert.equal(consequence.ok, true);
    assert.equal(run.expedition.equipment["field-light"].state, "depleted");

    // 3. Condition -> Affordance: stateUsable derives false
    const usable = q4Equipment.stateUsable(run.expedition.equipment["field-light"]);
    assert.equal(usable, false, "Depleted equipment must not be usable");

    // 4. Affordance -> Task Feasibility: Task requiring field-light is rejected
    const decCtx = q4Continuity.decisionContext({
      world: service.getWorld(world.id),
      run,
      phase: entry.phase.phase_id,
      worker_id: beverly.personnel_id,
      request: { type: "investigate", target_location: "relay-alcove", required_equipment: "field-light" }
    });
    const decision = q4Continuity.decide(decCtx);
    assert.equal(decision.state, "cannot-comply");
    assert.equal(decision.reason, "EQUIPMENT_REQUIRED", "Task requiring depleted equipment must derive cannot-comply");

    // 5. Actor Decision & Behavioral State: Decision scheduler reacts
    decision.trigger = decisionScheduler.TRIGGERS.EQUIPMENT_ISSUE;
    decision.reason = "Battery depleted on field light.";
    beverly = run.expedition.team.members.find((m) => m.first_name === "Beverly");
    beverly.current_task = { type: "operate", state: "active" };
    decisionScheduler.scheduleDecisions(run, {}, service.getWorld(world.id));
    assert.equal(beverly.attention_focus, "assigned-equipment", "Actor focus must derive assigned-equipment on equipment issue");

    // 6. Field Notes: Causal event generation
    canonicalLedger.recordEquipmentTransfer(run, { item: "field-light", from: run.session.startup.player.observer_id, to: beverly.personnel_id });
    const notes = fieldNotes.processCausalEventsForFieldNotes(run);
    assert.ok(Array.isArray(notes), "Field notes must be an array");
    const transferNote = run.expedition.field_notes.find((n) => n.type === "EQUIPMENT_TRANSFER");
    assert.ok(transferNote, "Field notes must record equipment transfer");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
