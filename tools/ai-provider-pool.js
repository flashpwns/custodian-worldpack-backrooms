"use strict";

const crypto = require("node:crypto");
const {
  createHostedProvider,
  classifyProviderError,
  FAILURE_CLASSES,
  PROVIDER_SPECS
} = require("./ai-hosted-transport");
const { createLivingProvider } = require("./ai-living-provider");
const { createMockProvider } = require("./ai-mock-provider");

const DEFAULT_AUTO_PRIORITY = Object.freeze(["groq", "gemini", "openrouter", "openai", "offline"]);

const COOLDOWN_DURATIONS_MS = Object.freeze({
  [FAILURE_CLASSES.BILLING_EXHAUSTED]: 15 * 60 * 1000, // 15 minutes
  [FAILURE_CLASSES.AUTH_INVALID]: 15 * 60 * 1000,     // 15 minutes
  [FAILURE_CLASSES.RATE_LIMITED]: 60 * 1000,           // 1 minute
  [FAILURE_CLASSES.TIMEOUT]: 30 * 1000,                // 30 seconds
  [FAILURE_CLASSES.NETWORK_UNAVAILABLE]: 30 * 1000,   // 30 seconds
  [FAILURE_CLASSES.PROVIDER_SERVER_ERROR]: 30 * 1000,  // 30 seconds
  [FAILURE_CLASSES.MODEL_UNAVAILABLE]: 15 * 60 * 1000, // 15 minutes
  [FAILURE_CLASSES.STRUCTURED_OUTPUT_UNSUPPORTED]: 15 * 60 * 1000, // 15 minutes
  [FAILURE_CLASSES.MALFORMED_RESPONSE]: 10 * 1000,     // 10 seconds
  [FAILURE_CLASSES.UNKNOWN_PROVIDER_ERROR]: 30 * 1000   // 30 seconds
});

function calculateCooldownMs(failureClass, error) {
  if (failureClass === FAILURE_CLASSES.RATE_LIMITED) {
    const retryAfter = error?.headers?.["retry-after"] ?? error?.retry_after ?? null;
    if (retryAfter) {
      const parsedSeconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        return Math.min(parsedSeconds * 1000, 15 * 60 * 1000);
      }
    }
  }
  return COOLDOWN_DURATIONS_MS[failureClass] || 30 * 1000;
}

class ProviderPool {
  constructor({ credentials = null, settingsGetter = null, onInvocation = null, onProvenance = null, clientFactory = null, providerFactory = null } = {}) {
    this.credentials = credentials;
    this.settingsGetter = typeof settingsGetter === "function" ? settingsGetter : () => ({ provider: "auto" });
    this.onInvocation = onInvocation;
    this.onProvenance = onProvenance;
    this.clientFactory = clientFactory;
    this.providerFactory = providerFactory;
    this.clients = new Map();
    this.health = new Map();
    this.instances = new Map();
    this.lastAttemptChain = [];
  }

  setClient(providerId, client) {
    this.clients.set(providerId, client);
  }

  isConfigured(providerId) {
    if (providerId === "offline") return true;
    if (this.credentials && typeof this.credentials.configured === "function") {
      if (this.credentials.configured(providerId)) return true;
    }
    const spec = PROVIDER_SPECS[providerId];
    if (spec?.envKey && process.env[spec.envKey]) return true;
    return false;
  }

  getKey(providerId) {
    if (providerId === "offline") return null;
    if (this.credentials && typeof this.credentials.get === "function") {
      const key = this.credentials.get(providerId);
      if (key) return key;
    }
    const spec = PROVIDER_SPECS[providerId];
    if (spec?.envKey && process.env[spec.envKey]) return process.env[spec.envKey];
    return null;
  }

  getModel(providerId) {
    const settings = this.settingsGetter();
    if (providerId === "openai" && settings.openai_model) return settings.openai_model;
    if (providerId === "groq" && settings.groq_model) return settings.groq_model;
    if (providerId === "gemini" && settings.gemini_model) return settings.gemini_model;
    if (providerId === "openrouter" && settings.openrouter_model) return settings.openrouter_model;
    return PROVIDER_SPECS[providerId]?.defaultModel ?? "default-model";
  }

  getHealth(providerId) {
    if (!this.health.has(providerId)) {
      this.health.set(providerId, {
        provider: providerId,
        configured: this.isConfigured(providerId),
        last_attempt: null,
        last_success: null,
        last_failure_class: null,
        cooldown_until: 0,
        consecutive_failures: 0
      });
    }
    const record = this.health.get(providerId);
    record.configured = this.isConfigured(providerId);
    return record;
  }

  resetHealth(providerId = null) {
    if (providerId) {
      this.health.delete(providerId);
      this.instances.delete(providerId);
    } else {
      this.health.clear();
      this.instances.clear();
    }
  }

  getProviderInstance(providerId, { onInvocation = null } = {}) {
    if (typeof this.providerFactory === "function") {
      const custom = this.providerFactory(providerId, { onInvocation });
      if (custom) return custom;
    }
    if (providerId === "offline") {
      return createLivingProvider();
    }
    const key = this.getKey(providerId);
    const model = this.getModel(providerId);
    const spec = PROVIDER_SPECS[providerId];
    const client = typeof this.clientFactory === "function"
      ? this.clientFactory(providerId)
      : (this.clients?.get(providerId) || undefined);
    return createHostedProvider({
      providerId,
      client,
      apiKey: key,
      baseURL: spec?.baseURL,
      model,
      timeout: 15000,
      onInvocation: (event) => {
        if (typeof onInvocation === "function") onInvocation(event);
        if (typeof this.onInvocation === "function") this.onInvocation(event);
      }
    });
  }

  getCandidates({ mode = "auto", preferredProvider = "auto" } = {}) {
    const chosen = preferredProvider || "auto";
    let list;
    if (chosen !== "auto") {
      // Manual selection: only chosen provider and deterministic offline fallback
      list = chosen === "offline" ? ["offline"] : [chosen, "offline"];
    } else {
      list = [...DEFAULT_AUTO_PRIORITY];
    }

    const now = Date.now();
    return list.filter((id) => {
      if (id === "offline") return true;
      if (!this.isConfigured(id)) return false;
      const health = this.getHealth(id);
      if (health.cooldown_until && now < health.cooldown_until) return false;
      return true;
    });
  }

  async executeWithFallback({
    requestKind = "turn",
    requestId = `pool-${Date.now()}`,
    route = "unknown",
    executeFn,
    preferredProvider = null
  }) {
    const settings = this.settingsGetter();
    const effectiveProvider = preferredProvider || settings.provider || "auto";
    const candidates = this.getCandidates({ preferredProvider: effectiveProvider });
    const attempts = [];
    let lastError = null;
    let selectedProvider = null;
    let result = null;

    for (let i = 0; i < candidates.length; i++) {
      const candidateId = candidates[i];
      const attemptNumber = i + 1;
      const model = candidateId === "offline" ? "deterministic" : this.getModel(candidateId);
      const startTime = Date.now();

      const attemptRecord = {
        attempt: attemptNumber,
        provider: candidateId,
        model,
        status: "started",
        failure_class: null,
        error_status: null,
        duration_ms: 0
      };

      const health = this.getHealth(candidateId);
      health.last_attempt = startTime;

      try {
        const providerInstance = this.getProviderInstance(candidateId, {
          onInvocation: (event) => {
            if (event.status === "failed") {
              attemptRecord.error_status = event.error_status ?? null;
            }
          }
        });

        result = await executeFn(providerInstance, candidateId);
        const duration = Date.now() - startTime;
        attemptRecord.status = "completed";
        attemptRecord.duration_ms = duration;
        attempts.push(attemptRecord);

        health.last_success = Date.now();
        health.consecutive_failures = 0;
        health.cooldown_until = 0;
        health.last_failure_class = null;

        selectedProvider = candidateId;
        break;
      } catch (error) {
        const duration = Date.now() - startTime;
        const failureClass = classifyProviderError(error);
        const cooldownMs = calculateCooldownMs(failureClass, error);

        health.consecutive_failures++;
        health.last_failure_class = failureClass;
        health.cooldown_until = Date.now() + cooldownMs;

        attemptRecord.status = "failed";
        attemptRecord.failure_class = failureClass;
        attemptRecord.error_status = Number.isInteger(error?.status) ? error.status : (attemptRecord.error_status ?? null);
        attemptRecord.duration_ms = duration;
        attempts.push(attemptRecord);
        lastError = error;
      }
    }

    this.lastAttemptChain = attempts;
    const chainSummary = {
      request_id: requestId,
      route,
      mode: effectiveProvider === "auto" ? "auto" : "manual",
      selected_provider: selectedProvider ?? "none",
      attempts,
      duration_ms: attempts.reduce((acc, a) => acc + a.duration_ms, 0)
    };

    if (typeof this.onProvenance === "function") {
      try { this.onProvenance(chainSummary); } catch {}
    }

    if (!selectedProvider) {
      throw lastError || new Error("All eligible providers in pool failed.");
    }

    return {
      ok: true,
      result,
      selected_provider: selectedProvider,
      attempts
    };
  }

  createAutoProvider({ requestId = null, route = "auto-provider" } = {}) {
    const pool = this;
    return {
      name: "auto",
      model: "auto",
      pool,
      getAttempts() {
        return pool.lastAttemptChain;
      },
      async interpret({ player_text, context }) {
        const reqId = requestId || `auto-intent-${Date.now()}`;
        const res = await pool.executeWithFallback({
          requestKind: "intent",
          requestId: reqId,
          route: `${route}/intent`,
          executeFn: async (provider) => {
            if (typeof provider.interpret === "function") {
              return provider.interpret({ player_text, context });
            }
            const mock = createMockProvider();
            return mock.interpret({ player_text, context });
          }
        });
        return res.result;
      },
      async interpretLiving({ player_text, context }) {
        const reqId = requestId || `auto-living-interpret-${Date.now()}`;
        const res = await pool.executeWithFallback({
          requestKind: "living-interpretation",
          requestId: reqId,
          route: `${route}/living-interpretation`,
          executeFn: async (provider) => {
            if (typeof provider.interpretLiving === "function") {
              return provider.interpretLiving({ player_text, context });
            }
            if (typeof provider.interpret === "function") {
              return provider.interpret({ player_text, context });
            }
            const living = createLivingProvider();
            return living.interpret({ player_text, context });
          }
        });
        return res.result;
      },
      async presentLiving(packet) {
        const reqId = requestId || `auto-living-present-${Date.now()}`;
        const res = await pool.executeWithFallback({
          requestKind: "living-presentation",
          requestId: reqId,
          route: `${route}/living-presentation`,
          executeFn: async (provider) => {
            if (typeof provider.presentLiving === "function") {
              return provider.presentLiving(packet);
            }
            if (typeof provider.present === "function") {
              return provider.present(packet);
            }
            const living = createLivingProvider();
            return living.present(packet);
          }
        });
        return res.result;
      },
      async presentLocal(packet) {
        const reqId = requestId || `auto-local-dialogue-${Date.now()}`;
        const res = await pool.executeWithFallback({
          requestKind: "local-dialogue",
          requestId: reqId,
          route: `${route}/local-dialogue`,
          executeFn: async (provider) => {
            if (typeof provider.presentLocal === "function") {
              return provider.presentLocal(packet);
            }
            const living = createLivingProvider();
            if (typeof living.presentLocal === "function") return living.presentLocal(packet);
            throw new Error("Local dialogue presentation not supported by offline fallback");
          }
        });
        return res.result;
      }
    };
  }
}

module.exports = {
  ProviderPool,
  DEFAULT_AUTO_PRIORITY,
  COOLDOWN_DURATIONS_MS,
  calculateCooldownMs
};
