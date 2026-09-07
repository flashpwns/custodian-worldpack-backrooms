"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const bootstrap = require("../tools/run-bootstrap");
const { DesktopService } = require("../desktop/service");

function createTestService(name) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), `yb-${name}-`));
  const service = new DesktopService({
    appDataPath,
    auto_save_delay_ms: 10,
    credentials: { openai: "test-key" },
    env: { OPENAI_API_KEY: "test-key" },
    livingTurnProvider: {
      name: "test-mock",
      model: "mock-model",
      interpretLiving() {
        return {
          code: "INTERPRETED",
          confidence: 0.95,
          sink: {
            channel: "action",
            payload: { action: "LOOK", target: null }
          }
        };
      },
      presentLiving() {
        return {
          source: "test-mock",
          scene_description: "Mock description of the scene."
        };
      }
    }
  });
  const world = service.createWorld({ name: "Negation Onboarding Test", seed: "test-seed" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed: "test-seed", require_personnel: true, scenario: "reference-expedition" }).ok, true);
  return { appDataPath, service, world };
}

test("Blocker 3: Explicit negation and refusal outranks positive keywords in onboarding", async () => {
  const refusalPhrases = [
    "I am not ready.",
    "Not yet.",
    "Don't move on.",
    "No.",
    "Wait, I need a second.",
    "Hold on, not ready.",
    "Negative, do not proceed.",
    "Stop.",
    "I refuse.",
    "Ready, but not yet sure about the radio.",
    "Confirm, but wait for Matthew first.",
    "Are we ready to proceed?"
  ];

  for (const text of refusalPhrases) {
    const { appDataPath, service, world } = createTestService("negation-check");
    try {
      const entry = service.session(world.id, "field-researcher");
      const beforeRun = bootstrap.saveRun(entry.run);
      const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text });

      assert.equal(res.ok, true, `Call failed for '${text}'`);
      assert.equal(res.result.executed, false, `Executed should be false for '${text}'`);
      assert.equal(res.result.clarification_required, true, `Clarification should be required for '${text}'`);
      assert.equal(entry.phase.phase_id, "BRIEFING", `Phase should remain BRIEFING for '${text}'`);
      assert.deepEqual(bootstrap.saveRun(entry.run), beforeRun, `Run state mutated on refusal for '${text}'`);
    } finally {
      service.shutdown();
      fs.rmSync(appDataPath, { recursive: true, force: true });
    }
  }
});

test("Blocker 3: Genuine readiness after refusal advances procedure to next phase", async () => {
  const { appDataPath, service, world } = createTestService("negation-then-ready");
  try {
    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 1. Refusal
    const r1 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I am not ready." });
    assert.equal(r1.result.executed, false);
    assert.equal(r1.result.clarification_required, true);
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 2. Pause
    const r2 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Wait, I need a second." });
    assert.equal(r2.result.executed, false);
    assert.equal(r2.result.clarification_required, true);
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // 3. Deliberate un-negated readiness
    const r3 = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Ready to proceed." });
    assert.equal(r3.ok, true);
    assert.equal(r3.result.executed, true);
    assert.equal(r3.result.classification, "ON_SCRIPT");
    assert.equal(entry.phase.phase_id, "STAGING");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Priority 5: All 12 required negative/hesitation forms reject advancement", async () => {
  const exactNegativeForms = [
    "I'm ready, but don't send us yet.",
    "Yeah no, I'm not ready.",
    "I don't think we're ready.",
    "We're definitely not ready.",
    "Don't proceed.",
    "Do not open it yet.",
    "I said I'm NOT ready.",
    "I'm not ready, are you?",
    "Ready? No.",
    "No, wait.",
    "Hold on.",
    "Give me a second."
  ];

  for (const text of exactNegativeForms) {
    const { appDataPath, service, world } = createTestService("exact-neg-check");
    try {
      const entry = service.session(world.id, "field-researcher");
      const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text });
      assert.equal(res.ok, true, `Call failed for '${text}'`);
      assert.equal(res.result.executed, false, `Executed must be false for '${text}'`);
      assert.equal(res.result.clarification_required, true, `Clarification must be required for '${text}'`);
      assert.equal(entry.phase.phase_id, "BRIEFING", `Phase must remain BRIEFING for '${text}'`);
    } finally {
      service.shutdown();
      fs.rmSync(appDataPath, { recursive: true, force: true });
    }
  }
});

test("Priority 5: All 7 required positive forms advance procedure", async () => {
  const exactPositiveForms = [
    "I'm ready.",
    "We're good.",
    "Go ahead.",
    "Proceed.",
    "Let's do it.",
    "Open it.",
    "Send us through."
  ];

  for (const text of exactPositiveForms) {
    const { appDataPath, service, world } = createTestService("exact-pos-check");
    try {
      const entry = service.session(world.id, "field-researcher");
      assert.equal(entry.phase.phase_id, "BRIEFING");
      const res = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text });
      assert.equal(res.ok, true, `Call failed for positive form '${text}'`);
      assert.equal(res.result.executed, true, `Executed must be true for positive form '${text}'`);
      assert.equal(res.result.classification, "ON_SCRIPT", `Classification must be ON_SCRIPT for '${text}'`);
      assert.equal(entry.phase.phase_id, "STAGING", `Phase must advance to STAGING for '${text}'`);
    } finally {
      service.shutdown();
      fs.rmSync(appDataPath, { recursive: true, force: true });
    }
  }
});
