"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { READINESS_STATES, createDialogueRuntimeSupervisor } = require("../tools/dialogue-runtime-supervisor");

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function readyInspect() {
  return async () => ({ ok: true, runtime_available: true, model_available: true, models: ["fixture:9b"] });
}

function immediateTimers() {
  const timers = [];
  return {
    setTimeoutFn: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeoutFn: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    fire: () => { const t = timers.shift(); if (t) t.fn(); },
    pending: () => timers.length
  };
}

test("y166 — reaches ready after a successful warmup", async () => {
  const supervisor = createDialogueRuntimeSupervisor({
    inspect: readyInspect(),
    fetchImpl: async () => jsonResponse({ response: "" })
  });

  const status = await supervisor.start();
  assert.equal(status.state, READINESS_STATES.READY);
  assert.equal(status.ready, true);
  assert.equal(status.canAttempt, true);
});

test("y166 — becomes failed once retries are exhausted while the backend stays unavailable", async () => {
  const timers = immediateTimers();
  const supervisor = createDialogueRuntimeSupervisor({
    maxRetries: 2,
    autoRetry: true,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    inspect: async () => ({ ok: false, runtime_available: false, model_available: false, models: [], error_code: "NETWORK_UNAVAILABLE" })
  });

  let status = await supervisor.start();
  assert.equal(status.state, READINESS_STATES.UNAVAILABLE);
  assert.equal(status.retryCount, 1);

  // Drain the scheduled automatic retries until retries are exhausted.
  while (timers.pending() > 0) {
    timers.fire();
    // allow the retry's start() promise chain to settle
    await new Promise((resolve) => setImmediate(resolve));
  }

  status = supervisor.getStatus();
  assert.equal(status.state, READINESS_STATES.FAILED);
  assert.equal(status.ready, false);
  assert.equal(status.canAttempt, false);
});

test("y166 — retry() re-checks the backend and can recover to ready", async () => {
  let attempt = 0;
  const supervisor = createDialogueRuntimeSupervisor({
    autoRetry: false,
    inspect: async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, runtime_available: false, model_available: false, models: [] };
      return { ok: true, runtime_available: true, model_available: true, models: ["fixture:9b"] };
    },
    fetchImpl: async () => jsonResponse({ response: "" })
  });

  const first = await supervisor.start();
  assert.equal(first.state, READINESS_STATES.UNAVAILABLE);

  const second = await supervisor.retry();
  assert.equal(second.state, READINESS_STATES.READY);
});

test("y166 — deterministic dialogue fallback survives a failed model call", async () => {
  const supervisor = createDialogueRuntimeSupervisor({
    autoRetry: false,
    inspect: readyInspect(),
    fetchImpl: async () => jsonResponse({ response: "" })
  });
  await supervisor.start();
  assert.equal(supervisor.getStatus().state, READINESS_STATES.READY);

  const failingProvider = {
    async presentLocal() { throw new Error("model call exploded"); }
  };
  const fallbackCalls = [];
  const wrapped = supervisor.wrapProvider(failingProvider, {
    fallback: (packet) => { fallbackCalls.push(packet); return { speech: "deterministic fallback line", semantic_claims: [] }; }
  });

  const result = await wrapped.presentLocal({ packet: "example" });
  assert.equal(result.speech, "deterministic fallback line");
  assert.equal(fallbackCalls.length, 1);
  assert.equal(supervisor.getStatus().state, READINESS_STATES.DEGRADED);
});

test("y166 — fallback is used directly (no model attempt) while backend is not ready", async () => {
  const supervisor = createDialogueRuntimeSupervisor({
    autoRetry: false,
    inspect: async () => ({ ok: false, runtime_available: false, model_available: false, models: [] })
  });
  await supervisor.start();
  assert.equal(supervisor.getStatus().state, READINESS_STATES.UNAVAILABLE);

  let providerCalled = false;
  const provider = { async presentLocal() { providerCalled = true; return { speech: "should not be used" }; } };
  const wrapped = supervisor.wrapProvider(provider, {
    fallback: () => ({ speech: "deterministic fallback line" })
  });

  const result = await wrapped.presentLocal({ packet: "example" });
  assert.equal(providerCalled, false, "Provider must not be invoked while not ready");
  assert.equal(result.speech, "deterministic fallback line");
});

test("y166 — clean shutdown cancels pending retries and leaves state unavailable", async () => {
  const timers = immediateTimers();
  const supervisor = createDialogueRuntimeSupervisor({
    maxRetries: 5,
    autoRetry: true,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    inspect: async () => ({ ok: false, runtime_available: false, model_available: false, models: [] })
  });

  await supervisor.start();
  assert.ok(timers.pending() > 0, "A retry must be scheduled after an unavailable check");

  await supervisor.shutdown();
  assert.equal(timers.pending(), 0, "Shutdown must cancel the pending retry timer");
  assert.equal(supervisor.getStatus().state, READINESS_STATES.UNAVAILABLE);

  // Further automatic firing (if any timer survived) or manual start attempts
  // must not resurrect a ready/degraded state after shutdown.
  const afterShutdown = await supervisor.start();
  assert.equal(afterShutdown.state, READINESS_STATES.UNAVAILABLE);
});

test("y166 — readiness state is never present in any player-facing string", () => {
  // The supervisor's public surface must expose readiness only as a plain,
  // internal status object — never as prose that could leak into UI text —
  // and getStatus() must never include provider/model identity fields such
  // as endpoint, model name, or provider id.
  const supervisor = createDialogueRuntimeSupervisor({ inspect: readyInspect() });
  const status = supervisor.getStatus();
  const keys = Object.keys(status);
  const forbidden = ["endpoint", "model", "provider", "host", "ollama", "llama"];
  for (const key of keys) {
    assert.equal(forbidden.includes(key.toLowerCase()), false, `getStatus() must not expose "${key}"`);
  }
  const serialized = JSON.stringify(status).toLowerCase();
  assert.doesNotMatch(serialized, /ollama|llama|endpoint|model/i, "Serialized readiness status must carry no provider/model identity");
});
