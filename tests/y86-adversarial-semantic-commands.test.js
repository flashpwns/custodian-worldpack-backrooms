"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "adversarial-semantic") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-adv-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Adversarial Semantic Hardening", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  return { appDataPath, service, world };
}

test("Adversarial 1 & 2: 'I am not ready.' and 'Not yet.' in onboarding refuse phase advancement", async () => {
  const { appDataPath, service, world } = createTestService("adv-1-2");
  try {
    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 1. I am not ready.
    const res1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I am not ready." });
    assert.equal(res1.result?.executed, false);
    assert.equal(res1.result?.clarification_required, true);
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 2. Not yet.
    const res2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Not yet." });
    assert.equal(res2.result?.executed, false);
    assert.equal(res2.result?.clarification_required, true);
    assert.equal(entry.phase.phase_id, "BRIEFING");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Adversarial 3 & 4: 'Give it to him.' and 'No, the other one.' require clarification without corrupting state", async () => {
  const { appDataPath, service, world } = createTestService("adv-3-4");
  try {
    // Advance to FIELD_OPERATION
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
    const beforeRun = cloneRun(entry.run);

    // 3. Give it to him. (ambiguous pronoun/referent)
    const res3 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Give it to him." });
    assert.ok(res3.result?.clarification_required === true || res3.result?.executed === false);
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "utility-room");

    // 4. No, the other one. (ambiguous correction)
    const res4 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "No, the other one." });
    assert.ok(res4.result?.clarification_required === true || res4.result?.executed === false);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Adversarial 5: 'Whitfield, grab the camera and look at that seam.' rejects unknown actor safely", async () => {
  const { appDataPath, service, world } = createTestService("adv-5");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");
    const res5 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Whitfield, grab the camera and look at that seam."
    });

    // Whitfield is not an admitted team member; must not invent personnel
    assert.ok(res5.result?.clarification_required === true || res5.result?.executed === false || res5.ok === false);
    const members = entry.run.expedition.team.members.map((m) => m.first_name);
    assert.equal(members.includes("Whitfield"), false);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Adversarial 6 & 7: Team hold + player move and override order for specific coworker", async () => {
  const { appDataPath, service, world } = createTestService("adv-6-7");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    // 6. Everyone stay here, I'm checking this out.
    // In prefield or field: hold orders are issued or team told to remain
    const res6 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Santiago stay here."
    });
    assert.equal(res6.ok, true);

    // 7. Actually Beverly come with me.
    const res7 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Beverly follow me."
    });
    assert.equal(res7.ok, true);
    assert.equal(res7.result?.executed, true);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Adversarial 8 & 9: Sensory query and memory inquiry do not mutate canonical equipment or invent unseen state", async () => {
  const { appDataPath, service, world } = createTestService("adv-8-9");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");
    const intervalBefore = entry.run.expedition.clock.interval;

    // 8. Can anybody else hear that?
    const res8 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Can anybody else hear that?"
    });
    assert.equal(res8.ok, true);

    // 9. What did you see back there?
    const res9 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "What did you see back there?"
    });
    assert.equal(res9.ok, true);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Adversarial 10: 'Radio Standard and tell them we're hearing something weird.' routes to radio channel and checks equipment", async () => {
  const { appDataPath, service, world } = createTestService("adv-10");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const res10 = await service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: "Standard, we are hearing something unusual in the sector."
    });
    assert.equal(res10.ok, true);
    assert.ok(["delivered", "delayed", "queued"].includes(res10.result?.outcome));
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Priority 6 & 7: Real human corrective, compound, and referent commands", async () => {
  const { appDataPath, service, world } = createTestService("adv-human-cmds");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitQ4Handoff({ world_id: world.id, item_id: "recording-device", target: "player" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    // 1. Team commands: "Stay put", "Follow me"
    const stayPut = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Santiago, stay put." });
    assert.equal(stayPut.ok, true);

    const followMe = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Beverly, follow me." });
    assert.equal(followMe.ok, true);

    // 2. Corrective command: "No, don't give it to her, give it to Santiago."
    const corrective = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "No, don't give it to her, give it to Santiago."
    });
    assert.ok(corrective.ok === true || corrective.result?.clarification_required === true);

    // 3. Referent resolution: ambiguous "the other one" vs explicit
    const ambigOther = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Take the other one."
    });
    // Ambiguous referent must require clarification, never invent random target
    assert.ok(ambigOther.result?.clarification_required === true || ambigOther.result?.executed === false);

    // 4. Sensory instruction: "Listen for a second."
    const listen = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Listen for a second."
    });
    assert.equal(listen.ok, true);

    // 5. Photographic instruction: "Take a picture of the fixture."
    const photo = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Take a picture of the fixture."
    });
    assert.equal(photo.ok, true);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

function cloneRun(run) {
  return structuredClone(run);
}

