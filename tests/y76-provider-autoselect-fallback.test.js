"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const { CredentialStore } = require("../desktop/credentials");
const { ProviderPool, DEFAULT_AUTO_PRIORITY } = require("../tools/ai-provider-pool");
const {
  FAILURE_CLASSES,
  classifyProviderError,
  createHostedProvider,
  PROVIDER_SPECS
} = require("../tools/ai-hosted-transport");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { createMockProvider } = require("../tools/ai-mock-provider");
const { PROPOSAL_VERSION } = require("../tools/ai-interpreter-boundary");
const { PRESENTATION_VERSION } = require("../tools/ai-living-turn");

function makeMoveProposal(target = "open passage") {
  return {
    version: PROPOSAL_VERSION,
    status: "proposal",
    noncanonical: true,
    relation: "single",
    attempts: [
      {
        actor: { kind: "player" },
        action: "MOVE",
        target_label: target,
        equipment_label: null,
        agency: "first-person",
        language_span: "I keep walking toward the passage."
      }
    ]
  };
}

function makePresentationCandidate(text = "You proceed forward along the passage.") {
  return {
    version: PRESENTATION_VERSION,
    scene_description: text,
    npc_presentations: [],
    presentation_claims: []
  };
}

function makeMockChatClient({ onCall = null, respondWith = null, errorToThrow = null } = {}) {
  return {
    chat: {
      completions: {
        create: async (request) => {
          if (onCall) onCall(request);
          if (errorToThrow) throw errorToThrow;
          const payload = typeof respondWith === "function" ? respondWith(request) : (respondWith ?? makeMoveProposal());
          return {
            id: `mock-chat-${Date.now()}`,
            choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }]
          };
        }
      }
    }
  };
}

function makeMockResponsesClient({ onCall = null, respondWith = null, errorToThrow = null } = {}) {
  return {
    responses: {
      create: async (request) => {
        if (onCall) onCall(request);
        if (errorToThrow) throw errorToThrow;
        const payload = typeof respondWith === "function" ? respondWith(request) : (respondWith ?? makeMoveProposal());
        return {
          id: `mock-resp-${Date.now()}`,
          output_text: typeof payload === "string" ? payload : JSON.stringify(payload)
        };
      }
    }
  };
}

function serviceFixture({ secure = false, provider = "auto" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y76-"));
  const credentials = new CredentialStore({
    directory: path.join(root, "credentials")
  });
  const service = new DesktopService({ appDataPath: root, credentials });
  service.updateSettings({ settings: { provider, input_mode: "natural" } });
  return { root, credentials, service };
}

function setupWorldAndSession(service, seed = "y76-test") {
  const world = service.createWorld({ name: "Failover Certification", seed }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Test", last_name: "Operator" });
  service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" });
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action });
  }
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  return world;
}

test("1. AUTO chooses first configured healthy provider according to priority", async () => {
  const { credentials } = serviceFixture();
  credentials.set("openai", "sk-openai-key");
  credentials.set("gemini", "gemini-test-key");
  credentials.set("groq", "gsk-groq-key");

  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "groq" || providerId === "gemini" || providerId === "openrouter") {
        return makeMockChatClient({ onCall: () => invocations.push(providerId) });
      }
      return makeMockResponsesClient({ onCall: () => invocations.push(providerId) });
    }
  });

  const candidates = pool.getCandidates({ preferredProvider: "auto" });
  assert.equal(candidates[0], "groq", "Groq is top priority when configured");
  assert.equal(candidates[1], "gemini");
  assert.equal(candidates[2], "openai");

  const autoProvider = pool.createAutoProvider();
  const proposal = await autoProvider.interpret({ player_text: "I walk into the passage.", context: {} });
  assert.ok(proposal);
  assert.equal(invocations[0], "groq", "First invocation must go to groq");
});

test("2. Missing credential skips provider without network attempt", async () => {
  const { credentials } = serviceFixture();
  // Groq and OpenRouter are NOT configured. Only Gemini is configured.
  credentials.set("gemini", "gemini-test-key");

  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      return makeMockChatClient({ onCall: () => invocations.push(providerId) });
    }
  });

  const candidates = pool.getCandidates({ preferredProvider: "auto" });
  assert.ok(!candidates.includes("groq"), "Groq must be excluded from candidates");
  assert.ok(!candidates.includes("openrouter"), "OpenRouter must be excluded from candidates");
  assert.equal(candidates[0], "gemini", "Gemini must be first configured candidate");

  const autoProvider = pool.createAutoProvider();
  await autoProvider.interpret({ player_text: "I move forward.", context: {} });

  assert.equal(invocations.length, 1);
  assert.equal(invocations[0], "gemini");
  assert.ok(!invocations.includes("groq"));
});

test("3. OpenAI credit_balance_exhausted triggers cooldown and failover", async () => {
  const { credentials } = serviceFixture();
  credentials.set("openai", "sk-openai-exhausted");

  const quotaError = Object.assign(new Error("You have exceeded your current quota, please check your plan and billing details."), {
    status: 400,
    code: "credit_balance_exhausted",
    type: "insufficient_quota"
  });

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "openai") {
        return makeMockResponsesClient({ errorToThrow: quotaError });
      }
      return null;
    }
  });

  const autoProvider = pool.createAutoProvider();
  // Groq, Gemini, OpenRouter not configured. OpenAI fails with credit_balance_exhausted.
  // AUTO must fall back to deterministic offline interpreter.
  const proposal = await autoProvider.interpret({
    player_text: "I keep walking toward the passage.",
    context: { sinks: { single_attempt: [{ type: "MOVE", target_labels: ["open passage"] }] } }
  });

  assert.ok(proposal);
  assert.equal(proposal.status, "proposal");

  const health = pool.getHealth("openai");
  assert.equal(health.last_failure_class, FAILURE_CLASSES.BILLING_EXHAUSTED);
  assert.ok(health.cooldown_until > Date.now() + 10 * 60 * 1000, "15 min cooldown expected");

  // Immediate subsequent candidate check skips OpenAI without network call
  const nextCandidates = pool.getCandidates({ preferredProvider: "auto" });
  assert.ok(!nextCandidates.includes("openai"), "OpenAI in cooldown must not be a candidate");
  assert.deepEqual(nextCandidates, ["offline"]);
});

test("4. HTTP 429 rate limit respects cooldown and Retry-After header", async () => {
  const { credentials } = serviceFixture();
  credentials.set("groq", "gsk-rate-limited");
  credentials.set("gemini", "gemini-backup");

  const rateLimitError = Object.assign(new Error("Rate limit exceeded. Please wait before retrying."), {
    status: 429,
    headers: { "retry-after": "50" }
  });

  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "groq") {
        return makeMockChatClient({
          onCall: () => invocations.push("groq"),
          errorToThrow: rateLimitError
        });
      }
      return makeMockChatClient({
        onCall: () => invocations.push("gemini")
      });
    }
  });

  const autoProvider = pool.createAutoProvider();
  await autoProvider.interpret({ player_text: "I move toward the opening.", context: {} });

  assert.deepEqual(invocations, ["groq", "gemini"], "Groq fails 429, immediately fails over to Gemini");
  const groqHealth = pool.getHealth("groq");
  assert.equal(groqHealth.last_failure_class, FAILURE_CLASSES.RATE_LIMITED);
  assert.ok(groqHealth.cooldown_until > Date.now() + 40 * 1000, "Respects retry-after >= 40s");

  // Subsequent call excludes Groq and invokes Gemini directly
  const nextCandidates = pool.getCandidates({ preferredProvider: "auto" });
  assert.equal(nextCandidates[0], "gemini");
});

test("5. Malformed structured result rejects provider and continues", async () => {
  const { credentials } = serviceFixture();
  credentials.set("groq", "gsk-malformed");
  credentials.set("gemini", "gemini-healthy");

  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "groq") {
        return makeMockChatClient({
          onCall: () => invocations.push("groq"),
          respondWith: "<<<INVALID JSON NON PARSABLE>>>"
        });
      }
      return makeMockChatClient({
        onCall: () => invocations.push("gemini"),
        respondWith: makeMoveProposal()
      });
    }
  });

  const autoProvider = pool.createAutoProvider();
  const proposal = await autoProvider.interpret({ player_text: "I walk forward.", context: {} });

  assert.ok(proposal);
  assert.deepEqual(invocations, ["groq", "gemini"]);
  assert.equal(pool.getHealth("groq").last_failure_class, FAILURE_CLASSES.MALFORMED_RESPONSE);
  assert.ok(pool.getHealth("groq").cooldown_until > Date.now(), "Quarantined with cooldown");
});

test("6. Provider 5xx server error continues safely", async () => {
  const { credentials } = serviceFixture();
  credentials.set("groq", "gsk-500");
  credentials.set("gemini", "gemini-healthy");

  const serverError = Object.assign(new Error("Internal Server Error"), { status: 500 });
  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "groq") {
        return makeMockChatClient({ onCall: () => invocations.push("groq"), errorToThrow: serverError });
      }
      return makeMockChatClient({ onCall: () => invocations.push("gemini") });
    }
  });

  const autoProvider = pool.createAutoProvider();
  await autoProvider.interpret({ player_text: "I advance.", context: {} });

  assert.deepEqual(invocations, ["groq", "gemini"]);
  assert.equal(pool.getHealth("groq").last_failure_class, FAILURE_CLASSES.PROVIDER_SERVER_ERROR);
});

test("7. Provider timeout continues safely", async () => {
  const { credentials } = serviceFixture();
  credentials.set("groq", "gsk-timeout");
  credentials.set("gemini", "gemini-healthy");

  const timeoutError = Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT", status: 408 });
  const invocations = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => ({ provider: "auto" }),
    clientFactory: (providerId) => {
      if (providerId === "groq") {
        return makeMockChatClient({ onCall: () => invocations.push("groq"), errorToThrow: timeoutError });
      }
      return makeMockChatClient({ onCall: () => invocations.push("gemini") });
    }
  });

  const autoProvider = pool.createAutoProvider();
  await autoProvider.interpret({ player_text: "I proceed.", context: {} });

  assert.deepEqual(invocations, ["groq", "gemini"]);
  assert.equal(pool.getHealth("groq").last_failure_class, FAILURE_CLASSES.TIMEOUT);
});

test("8. Successful fallback candidate executes canonical action EXACTLY ONCE", async () => {
  const { service, credentials } = serviceFixture();
  credentials.set("groq", "gsk-fail");
  credentials.set("gemini", "gemini-success");

  let groqCalls = 0;
  let geminiCalls = 0;

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: (providerId) => {
      if (providerId === "groq") {
        return makeMockChatClient({
          onCall: () => { groqCalls++; },
          errorToThrow: Object.assign(new Error("Service Unavailable"), { status: 503 })
        });
      }
      return makeMockChatClient({
        onCall: () => { geminiCalls++; },
        respondWith: (req) => {
          if (JSON.stringify(req).toLowerCase().includes("proposal")) return makeMoveProposal();
          return makePresentationCandidate("The team enters the open passage as its floor begins to descend.");
        }
      });
    }
  });

  service.providerPool = pool;
  const world = setupWorldAndSession(service, "canonical-once-test");
  const run = service.session(world.id, "field-researcher").run;
  const beforeInterval = run.expedition.clock.interval;
  const beforeHistoryLength = run.expedition.history.length;

  const result = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I keep walking toward the passage."
  });

  assert.equal(result.ok, true);
  assert.equal(groqCalls, 1, "Groq was attempted once and failed");
  assert.ok(geminiCalls >= 1, "Gemini succeeded");

  const afterInterval = run.expedition.clock.interval;
  const afterHistoryLength = run.expedition.history.length;

  // Exact single execution assertions
  assert.equal(afterInterval, beforeInterval + 1, "Canonical clock must advance by EXACTLY 1 interval");
  assert.equal(afterHistoryLength, beforeHistoryLength + 1, "Canonical history must record EXACTLY 1 action");
  assert.equal(run.spatial.player_location, "open-passage", "Canonical player location mutated once");
});

test("9. No provider receives hidden canonical state", async () => {
  const { service, credentials } = serviceFixture();
  credentials.set("groq", "gsk-inspect-payload");

  const capturedRequests = [];
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: () => makeMockChatClient({
      onCall: (req) => capturedRequests.push(JSON.stringify(req)),
      respondWith: makeMoveProposal()
    })
  });
  service.providerPool = pool;

  const world = setupWorldAndSession(service, "hidden-state-safety");
  await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I keep walking toward the passage."
  });

  assert.ok(capturedRequests.length > 0, "Requests must have been dispatched to provider");
  const combined = capturedRequests.join("\n");

  // Invariant assertions: no unmeasured true geometry, no raw secret state
  assert.doesNotMatch(combined, /"untrusted-truth"/, "Must not leak internal truth flags");
  assert.doesNotMatch(combined, /"scenario_secrets"/, "Must not leak raw scenario secrets");
  assert.doesNotMatch(combined, /gsk-inspect-payload/, "Must never leak API keys to model payload");
});

test("10. Switching providers preserves single canonical session", async () => {
  const { service, credentials } = serviceFixture();
  credentials.set("groq", "gsk-step1");
  credentials.set("openai", "sk-step2");

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: (providerId) => {
      if (providerId === "groq") return makeMockChatClient({ respondWith: makeMoveProposal() });
      return makeMockResponsesClient({
        respondWith: (req) => {
          if (JSON.stringify(req).toLowerCase().includes("proposal")) {
            return {
              version: PROPOSAL_VERSION,
              status: "proposal",
              noncanonical: true,
              relation: "single",
              attempts: [{
                actor: { kind: "player" },
                action: "INSPECT",
                target_label: "descending grade",
                equipment_label: null,
                agency: "first-person",
                language_span: "I inspect the descending grade."
              }]
            };
          }
          return makePresentationCandidate("The floor slopes downward into the corridor.");
        }
      });
    }
  });
  service.providerPool = pool;

  const world = setupWorldAndSession(service, "session-preservation");
  const sessionBefore = service.session(world.id, "field-researcher");
  const originalRun = sessionBefore.run;

  // Turn 1 on Groq
  service.updateSettings({ settings: { provider: "groq" } });
  const turn1 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I keep walking toward the passage."
  });
  assert.equal(turn1.ok, true);
  assert.equal(sessionBefore.run.spatial.player_location, "open-passage");

  // Switch settings to OpenAI
  service.updateSettings({ settings: { provider: "openai" } });
  const sessionAfterSwitch = service.session(world.id, "field-researcher");
  assert.equal(sessionAfterSwitch.run, originalRun, "Run reference preserved across provider switch");

  // Turn 2 on OpenAI
  const turn2 = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I inspect the descending grade."
  });
  assert.equal(turn2.ok, true);
  assert.equal(turn2.result.turn_status, "RESOLVED");
  assert.equal(sessionAfterSwitch.run.session.session_id, originalRun.session.session_id);
});

test("11. Switching providers does not alter persistence schema", async () => {
  const { service, credentials, root } = serviceFixture();
  credentials.set("groq", "gsk-persist-test");
  credentials.set("gemini", "gemini-persist-test");

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: () => makeMockChatClient({ respondWith: makeMoveProposal() })
  });
  service.providerPool = pool;

  const world = setupWorldAndSession(service, "persistence-schema");
  const saveFile = path.join(root, "saves", `${world.id}-field-researcher.json`);

  // Save under Groq
  service.updateSettings({ settings: { provider: "groq" } });
  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I walk forward." });
  const groqSaveData = JSON.parse(fs.readFileSync(saveFile, "utf8"));

  // Save under Gemini
  service.updateSettings({ settings: { provider: "gemini" } });
  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I walk forward." });
  const geminiSaveData = JSON.parse(fs.readFileSync(saveFile, "utf8"));

  assert.deepEqual(Object.keys(groqSaveData).sort(), Object.keys(geminiSaveData).sort(), "Save schema keys match exactly");
  assert.ok(!JSON.stringify(groqSaveData).includes("gsk-persist-test"), "No provider credentials in save");
  assert.ok(!JSON.stringify(geminiSaveData).includes("gemini-persist-test"), "No provider credentials in save");
});

test("12. Provider and model metadata appears in diagnostics while secrets never do", async () => {
  const { service, credentials } = serviceFixture();
  const groqSecret = "gsk-super-secret-key-xyz-123";
  credentials.set("groq", groqSecret);
  service.updateSettings({ settings: { provider: "groq" } });

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    onInvocation: (event) => service.recordProviderInvocation(event),
    clientFactory: () => makeMockChatClient({ respondWith: makeMoveProposal() })
  });
  service.providerPool = pool;

  const world = setupWorldAndSession(service, "diag-secrets-test");
  await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "I walk into the passage." });

  const diagnostics = service.getDiagnostics();
  const diagString = JSON.stringify(diagnostics);

  assert.match(diagString, /"provider":\s*"groq"/, "Diagnostic records provider metadata");
  assert.match(diagString, /"model":\s*"openai\/gpt-oss-120b"/, "Diagnostic records model metadata");
  assert.doesNotMatch(diagString, new RegExp(groqSecret), "Secret key must NEVER appear in diagnostics");

  const report = service.exportTesterReport({ world_id: world.id, mode: "field-researcher" });
  assert.equal(report.ok, true);
  const reportContent = fs.readFileSync(report.file, "utf8");
  assert.doesNotMatch(reportContent, new RegExp(groqSecret), "Secret key must NEVER appear in exported tester report");
});

test("13. Deterministic fallback operates when all hosted providers fail", async () => {
  const { service, credentials } = serviceFixture();
  credentials.set("groq", "gsk-failing");
  credentials.set("gemini", "gemini-failing");
  credentials.set("openrouter", "openrouter-failing");
  credentials.set("openai", "sk-openai-failing");

  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: (id) => {
      if (id === "openai") {
        return makeMockResponsesClient({ errorToThrow: Object.assign(new Error("OpenAI down"), { status: 500 }) });
      }
      return makeMockChatClient({ errorToThrow: Object.assign(new Error(`${id} down`), { status: 500 }) });
    }
  });
  service.providerPool = pool;

  const auto = pool.createAutoProvider();
  const proposal = await auto.interpretLiving({
    player_text: "I keep walking toward the passage.",
    context: { sinks: { single_attempt: [{ type: "MOVE", target_labels: ["open passage"] }] } }
  });
  assert.ok(proposal);
  assert.equal(pool.lastAttemptChain.length, 5, "All 4 hosted providers plus offline fallback attempted");
  assert.equal(pool.lastAttemptChain[4].provider, "offline");
  assert.equal(pool.lastAttemptChain[4].status, "completed");

  const world = setupWorldAndSession(service, "all-fail-fallback");
  const result = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I keep walking toward the passage."
  });

  assert.equal(result.ok, true, "Turn must succeed via deterministic offline interpreter");
  assert.equal(result.result.executed, true);
  assert.ok(result.result.scene.narration);
});

test("14. Manual provider mode does NOT silently use a different hosted provider", async () => {
  const { service, credentials } = serviceFixture({ provider: "openai" });
  credentials.set("openai", "sk-openai-manual-fail");
  credentials.set("groq", "gsk-healthy-groq");

  let groqCalled = false;
  const pool = new ProviderPool({
    credentials,
    settingsGetter: () => service.settings(),
    clientFactory: (id) => {
      if (id === "groq") {
        return makeMockChatClient({ onCall: () => { groqCalled = true; } });
      }
      return makeMockResponsesClient({
        errorToThrow: Object.assign(new Error("OpenAI 503"), { status: 503 })
      });
    }
  });
  service.providerPool = pool;

  const candidates = pool.getCandidates({ preferredProvider: "openai" });
  assert.deepEqual(candidates, ["openai", "offline"], "Manual mode candidates are only chosen provider and offline");

  const world = setupWorldAndSession(service, "manual-mode-isolation");
  const result = await service.submitNatural({
    world_id: world.id,
    mode: "field-researcher",
    text: "I keep walking toward the passage."
  });

  assert.equal(groqCalled, false, "Manual OpenAI mode must NOT silently invoke Groq");
  assert.equal(result.ok, true, "Offline fallback resolved the turn");
});

test("15. AUTO behavior is deterministic under mocked provider health", async () => {
  const runTrial = async () => {
    const { credentials } = serviceFixture();
    credentials.set("groq", "gsk-key");
    credentials.set("gemini", "gemini-key");

    const pool = new ProviderPool({
      credentials,
      settingsGetter: () => ({ provider: "auto" }),
      clientFactory: (id) => {
        if (id === "groq") {
          return makeMockChatClient({ errorToThrow: Object.assign(new Error("Groq 429"), { status: 429 }) });
        }
        return makeMockChatClient({ respondWith: makeMoveProposal() });
      }
    });

    const auto = pool.createAutoProvider();
    await auto.interpret({ player_text: "I proceed.", context: {} });
    return pool.lastAttemptChain.map((a) => `${a.provider}:${a.status}`);
  };

  const baseline = await runTrial();
  for (let i = 0; i < 4; i++) {
    const trial = await runTrial();
    assert.deepEqual(trial, baseline, "Attempt chain must be identical across trials");
  }
});

test("16. Existing OpenAI tests continue to pass and backwards compatibility is preserved", () => {
  const { createOpenAIProvider } = require("../tools/ai-openai-provider");
  assert.equal(typeof createOpenAIProvider, "function");
  assert.throws(() => createOpenAIProvider({ apiKey: "" }), /not configured/);

  const mockOpenAI = createOpenAIProvider({
    client: makeMockResponsesClient({ respondWith: makeMoveProposal() }),
    model: "gpt-5.6-luna"
  });

  assert.equal(mockOpenAI.name, "openai");
  assert.equal(mockOpenAI.model, "gpt-5.6-luna");
  assert.equal(typeof mockOpenAI.interpret, "function");
});
