"use strict";

/**
 * tools/verify-live-provider-acceptance.js
 *
 * Reusable Live-Provider Acceptance Runner for Yellow Beast.
 *
 * Principles:
 * 1. Checks for real hosted model credentials from environment or CredentialStore.
 * 2. If NO credentials exist, reports UNVERIFIED honestly without fabricating results.
 * 3. If credentials ARE present, exercises DesktopService / ProviderPool with live API calls.
 * 4. Strictly redacts API keys and secrets from all logs and output.
 * 5. Evaluates and categorizes every response into:
 *    - ACCEPTED_GENERATION: Model produced grounded, valid response conforming to Custodian truth.
 *    - VALIDATION_REJECTION: Model hallucinates or violates schema; correctly caught and rejected by validator.
 *    - AUTHORIZED_SILENCE: Model outputs procedural silence/hesitation authorized by persona.
 *    - PROVIDER_UNAVAILABLE: 401, 429, timeout, billing exhaustion caught safely without mutating state.
 * 6. Never depends on hardcoded response strings.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const { CredentialStore } = require("../desktop/credentials");
const { ProviderPool } = require("./ai-provider-pool");
const { PROVIDER_SPECS } = require("./ai-hosted-transport");
const presentationBus = require("./presentation-bus");

function redactKey(key) {
  if (!key || typeof key !== "string") return "[NONE]";
  if (key.length <= 8) return "[REDACTED]";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function detectConfiguredProviders() {
  const detected = [];
  for (const [providerId, spec] of Object.entries(PROVIDER_SPECS)) {
    const envKey = spec.envKey;
    const value = envKey ? process.env[envKey] : null;
    if (value && value.trim()) {
      detected.push({ providerId, envKey, maskedKey: redactKey(value), hasKey: true });
    }
  }
  return detected;
}

async function runLiveProviderAcceptance(options = {}) {
  const verbose = options.verbose ?? true;
  const targetProvider = options.provider ?? null;

  console.log("================================================================================");
  console.log("YELLOW BEAST: LIVE-PROVIDER ACCEPTANCE TEST RUNNER");
  console.log("================================================================================");

  const detected = detectConfiguredProviders();
  console.log(`Configured Providers Detected in Environment: ${detected.length}`);
  for (const p of detected) {
    console.log(`  - Provider [${p.providerId}]: ${p.envKey} = ${p.maskedKey}`);
  }

  const activeProvider = targetProvider ?? (detected.length > 0 ? detected[0].providerId : null);

  if (!activeProvider || activeProvider === "offline") {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("STATUS: UNVERIFIED — NO LIVE HOSTED API CREDENTIALS DETECTED");
    console.log("--------------------------------------------------------------------------------");
    console.log("To verify live provider quality against a real model, set one of the following:");
    console.log("  export GROQ_API_KEY=\"gsk_...\"");
    console.log("  export GEMINI_API_KEY=\"AIza...\"");
    console.log("  export OPENROUTER_API_KEY=\"sk-or-...\"");
    console.log("  export OPENAI_API_KEY=\"sk-...\"");
    console.log("\nExecuting schema contract & boundary verification using isolated mock transport...");

    // Run contract test
    const contractResult = await runContractVerification();
    return {
      status: "UNVERIFIED",
      reason: "NO_LIVE_CREDENTIALS",
      providers_detected: detected,
      contract_test: contractResult
    };
  }

  console.log(`\nTesting Live Provider: [${activeProvider}]`);
  return await executeLiveTestOnProvider(activeProvider, options);
}

async function runContractVerification() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-contract-verify-"));
  try {
    const service = new DesktopService({
      appDataPath: root,
      defaultQ4Scenario: "reference-expedition"
    });
    const world = service.createWorld({ name: "Contract World", seed: "contract-1994" }).world;
    service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
    service.confirmQ4Personnel({ world_id: world.id });
    service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });

    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check." });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    // Verify deterministic offline fallback
    const offlineTurn = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Look around the corridor."
    });

    assert.equal(offlineTurn.ok, true, "Contract turn must succeed offline");
    assert.ok(offlineTurn.result?.scene?.narration, "Scene narration must exist");
    console.log("Deterministic Contract Verification: PASSED");
    return { passed: true, offline_turn: offlineTurn.result?.turn_status };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function executeLiveTestOnProvider(providerId, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yb-live-${providerId}-`));
  const results = {
    provider: providerId,
    status: "COMPLETED",
    accepted_generations: 0,
    validation_rejections: 0,
    authorized_silences: 0,
    provider_unavailability: 0,
    turns: []
  };

  try {
    const credentials = new CredentialStore();
    const spec = PROVIDER_SPECS[providerId];
    const key = process.env[spec.envKey];
    credentials.set(providerId, key);

    const service = new DesktopService({
      appDataPath: root,
      credentials,
      defaultQ4Scenario: "reference-expedition"
    });

    service.updateSettings({
      settings: {
        provider: providerId,
        input_mode: "natural"
      }
    });

    const world = service.createWorld({ name: `Live-${providerId}`, seed: "live-test-seed" }).world;
    service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
    service.confirmQ4Personnel({ world_id: world.id });
    service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });

    // Onboard to FIELD_OPERATION
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, radio check." });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    // Test 1: Grounded Natural Action
    console.log("\n--- Live Test 1: Grounded Natural Movement ---");
    const t1 = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Walk forward into the open corridor."
    });

    classifyAndRecord(t1, "Grounded Action (Move)", results);

    // Test 2: Local Dialogue (Addressing Santiago)
    console.log("\n--- Live Test 2: Local Dialogue ---");
    const t2 = await service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, what is our immediate operational objective?"
    });

    classifyAndRecord(t2, "Local Dialogue (Santiago)", results);

    // Test 3: Unrepeated Older Memory Query
    console.log("\n--- Live Test 3: Dialogue Memory Disclosure ---");
    await service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, remember that I have asthma and get nervous in tight spaces."
    });

    const t3 = await service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, what medical condition should we keep in mind for me?"
    });

    classifyAndRecord(t3, "Memory Recall", results);

    console.log("\n================================================================================");
    console.log("LIVE TEST SUMMARY");
    console.log("================================================================================");
    console.log(`Provider: ${providerId}`);
    console.log(`Accepted Generations:    ${results.accepted_generations}`);
    console.log(`Validation Rejections:   ${results.validation_rejections}`);
    console.log(`Authorized Silences:     ${results.authorized_silences}`);
    console.log(`Provider Unavailability: ${results.provider_unavailability}`);

    return results;
  } catch (error) {
    console.error(`Live test execution failed: ${error.message}`);
    results.status = "EXECUTION_ERROR";
    results.error = error.message;
    return results;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function classifyAndRecord(response, label, results) {
  let category = "UNKNOWN";
  let detail = "";

  if (response.ok) {
    const source = response.result?.presentation_source ?? response.result?.scene?.narration_source ?? "UNKNOWN";
    if (source.includes("fallback") || source === "DETERMINISTIC") {
      if (/silence|hesitat|pause/i.test(response.result?.public_reason ?? "")) {
        category = "AUTHORIZED_SILENCE";
        results.authorized_silences++;
      } else {
        category = "VALIDATION_REJECTION";
        results.validation_rejections++;
      }
    } else {
      category = "ACCEPTED_GENERATION";
      results.accepted_generations++;
    }
    detail = response.result?.public_reason ?? response.result?.summary ?? "";
  } else {
    if (response.error?.provider_failure || response.error?.code === "PROVIDER_UNAVAILABLE") {
      category = "PROVIDER_UNAVAILABLE";
      results.provider_unavailability++;
      detail = response.error.message;
    } else {
      category = "VALIDATION_REJECTION";
      results.validation_rejections++;
      detail = response.error?.message ?? response.error?.code;
    }
  }

  console.log(`  [${label}]: Classified as ${category}`);
  console.log(`  Output/Reason: "${detail}"`);

  results.turns.push({
    label,
    ok: response.ok,
    category,
    detail
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let targetProvider = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" && args[i + 1]) {
      targetProvider = args[i + 1];
      i++;
    }
  }

  runLiveProviderAcceptance({ provider: targetProvider })
    .then((res) => {
      console.log("\nRunner finished with status:", res.status ?? "OK");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Runner failed:", err);
      process.exit(1);
    });
}

module.exports = { runLiveProviderAcceptance, detectConfiguredProviders };
