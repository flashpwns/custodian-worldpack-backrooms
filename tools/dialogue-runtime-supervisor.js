"use strict";

// Internal runtime supervisor for the local dialogue backend.
//
// This module has no opinion about which backend is configured (the managed llama.cpp runtime today,
// something else later) and does not bundle or install anything. It only
// answers one question — "can the configured local backend take a dialogue
// request right now?" — and keeps that answer current via a small state
// machine, a single warmup probe, and bounded retry.
//
// Readiness is strictly internal. Nothing here is player-facing: no provider
// name, model name, endpoint, or AI/LLM terminology may cross into any
// player-visible surface. Callers that need to react to readiness (e.g. to
// choose between a model-backed reply and the deterministic dialogue
// fallback) read `getStatus().state` and `getStatus().ready` only.

const { inspectLocalModel, LOCAL_PROVIDER_SPEC } = require("./ai-local-model-provider");

const READINESS_STATES = Object.freeze({
  UNAVAILABLE: "unavailable",
  STARTING: "starting",
  LOADING: "loading",
  WARMING: "warming",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed"
});

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;
const DEFAULT_WARMUP_TIMEOUT_MS = 10000;

function createDialogueRuntimeSupervisor({
  // The daemon's port is ephemeral and changes on every respawn, so a frozen
  // endpoint string would go stale. endpointFn is called fresh on every
  // inspection/warmup to read whatever the appliance currently reports.
  endpointFn = () => LOCAL_PROVIDER_SPEC.defaultEndpoint,
  model = LOCAL_PROVIDER_SPEC.defaultModel,
  fetchImpl = globalThis.fetch,
  inspect = inspectLocalModel,
  maxRetries = DEFAULT_MAX_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  warmupTimeoutMs = DEFAULT_WARMUP_TIMEOUT_MS,
  autoRetry = true,
  logger = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  nowFn = () => Date.now(),
  // Process ownership stays entirely with the managed inference appliance.
  // This supervisor never spawns/kills anything itself -- when it lands in
  // DEGRADED/FAILED it only asks (via this callback) for a respawn.
  onRestartRequested = null
} = {}) {
  let state = READINESS_STATES.UNAVAILABLE;
  let retryCount = 0;
  let lastError = null;
  let lastTransitionAt = nowFn();
  let shuttingDown = false;
  let activeCycle = null;
  let retryTimer = null;

  function log(event, extra) {
    try { logger({ event, state, retryCount, at: nowFn(), ...extra }); } catch { /* logging must never break the supervisor */ }
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    lastTransitionAt = nowFn();
    log("dialogue_runtime_state_change");
    if ((next === READINESS_STATES.DEGRADED || next === READINESS_STATES.FAILED) && typeof onRestartRequested === "function") {
      try { onRestartRequested({ state: next, retryCount, lastErrorCode: lastError?.code ?? null }); } catch { /* never break the supervisor */ }
    }
  }

  function clearRetryTimer() {
    if (retryTimer) {
      clearTimeoutFn(retryTimer);
      retryTimer = null;
    }
  }

  // One small, cheap request used only to confirm the backend will actually
  // respond, not to produce dialogue content. Never surfaced to the player.
  async function warmup() {
    if (typeof fetchImpl !== "function") {
      throw Object.assign(new Error("local transport unavailable"), { code: "NETWORK_UNAVAILABLE" });
    }
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeoutFn(() => controller.abort(), warmupTimeoutMs) : null;
    try {
      const response = await fetchImpl(`${endpointFn()}/v1/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "", n_predict: 1, stream: false }),
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response || response.ok === false) {
        throw Object.assign(new Error(`warmup request failed${response ? ` with status ${response.status}` : ""}`), {
          status: response?.status ?? null
        });
      }
      if (typeof response.json === "function") await response.json().catch(() => null);
      return true;
    } finally {
      if (timer) clearTimeoutFn(timer);
    }
  }

  function scheduleRetryOrFail() {
    retryCount += 1;
    if (retryCount > maxRetries) {
      setState(READINESS_STATES.FAILED);
      return;
    }
    if (autoRetry && !shuttingDown) {
      clearRetryTimer();
      retryTimer = setTimeoutFn(() => {
        retryTimer = null;
        start().catch(() => {});
      }, retryDelayMs);
      if (retryTimer && typeof retryTimer.unref === "function") retryTimer.unref();
    }
  }

  async function runStartCycle() {
    setState(READINESS_STATES.STARTING);
    let inspection;
    try {
      inspection = await inspect({ endpoint: endpointFn(), model, fetchImpl });
    } catch (error) {
      lastError = error;
      setState(READINESS_STATES.UNAVAILABLE);
      scheduleRetryOrFail();
      return getStatus();
    }

    if (!inspection || inspection.ok === false || !inspection.runtime_available) {
      lastError = inspection?.error_code ? Object.assign(new Error("runtime unavailable"), { code: inspection.error_code }) : null;
      setState(READINESS_STATES.UNAVAILABLE);
      scheduleRetryOrFail();
      return getStatus();
    }

    if (!inspection.model_available) {
      setState(READINESS_STATES.LOADING);
      scheduleRetryOrFail();
      return getStatus();
    }

    setState(READINESS_STATES.WARMING);
    try {
      await warmup();
    } catch (error) {
      lastError = error;
      setState(READINESS_STATES.DEGRADED);
      scheduleRetryOrFail();
      return getStatus();
    }

    retryCount = 0;
    lastError = null;
    setState(READINESS_STATES.READY);
    return getStatus();
  }

  async function start() {
    if (shuttingDown) return getStatus();
    if (activeCycle) return activeCycle;
    activeCycle = runStartCycle().finally(() => { activeCycle = null; });
    return activeCycle;
  }

  // Explicit recovery entry point distinct from the automatic retry timer,
  // for callers (or tests) that want to force an immediate re-check.
  async function retry() {
    if (shuttingDown) return getStatus();
    clearRetryTimer();
    return start();
  }

  function getStatus() {
    return {
      state,
      ready: state === READINESS_STATES.READY,
      // "degraded" still allows an attempt; every other non-ready state must
      // fall back to deterministic dialogue.
      canAttempt: state === READINESS_STATES.READY || state === READINESS_STATES.DEGRADED,
      retryCount,
      lastTransitionAt,
      lastErrorCode: lastError?.code ?? null
    };
  }

  // Cleanly stop supervising: cancel any pending retry timer and any in-flight
  // start cycle's continuation, and leave state unavailable so no stale
  // "ready" status can be read after shutdown. Does not touch OS-level
  // processes — those belong to the backend's own installer/lifecycle, not
  // to this supervisor.
  async function shutdown() {
    shuttingDown = true;
    clearRetryTimer();
    if (activeCycle) {
      try { await activeCycle; } catch { /* already reported via state */ }
    }
    retryCount = 0;
    lastError = null;
    setState(READINESS_STATES.UNAVAILABLE);
  }

  // Wraps a provider so the caller keeps using DialogueProvider.presentLocal(packet)
  // exactly as before. Internally: attempt the model only while canAttempt is
  // true; on any failure (or when not ready), fall back to the supplied
  // deterministic fallback. The dialogue contract seen by callers never changes.
  function wrapProvider(provider, { fallback } = {}) {
    if (typeof fallback !== "function") {
      throw new Error("wrapProvider requires a deterministic fallback function");
    }
    return {
      // Advisory interpretation has no deterministic stand-in: unavailable means Tier 1 stands.
      async interpretDialogue(input) {
        if (!getStatus().canAttempt || typeof provider?.interpretDialogue !== "function") throw new Error("dialogue interpretation unavailable");
        try { return await provider.interpretDialogue(input); } catch (error) { lastError = error; throw error; }
      },
      async presentLocal(packet) {
        if (!getStatus().canAttempt || typeof provider?.presentLocal !== "function") {
          return fallback(packet);
        }
        try {
          return await provider.presentLocal(packet);
        } catch (error) {
          lastError = error;
          setState(READINESS_STATES.DEGRADED);
          scheduleRetryOrFail();
          return fallback(packet);
        }
      }
    };
  }

  return {
    READINESS_STATES,
    start,
    retry,
    shutdown,
    getStatus,
    wrapProvider
  };
}

module.exports = {
  READINESS_STATES,
  createDialogueRuntimeSupervisor
};
