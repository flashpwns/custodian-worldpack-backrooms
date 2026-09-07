"use strict";

const crypto = require("node:crypto");
const { INTENT_VERSION } = require("./ai-adapter");
const { PROPOSAL_VERSION } = require("./ai-interpreter-boundary");
const { PRESENTATION_VERSION } = require("./ai-living-turn");
const { CANDIDATE_VERSION: LOCAL_DIALOGUE_CANDIDATE_VERSION } = require("./ai-local-dialogue");

const FAILURE_CLASSES = Object.freeze({
  AUTH_MISSING: "AUTH_MISSING",
  AUTH_INVALID: "AUTH_INVALID",
  BILLING_EXHAUSTED: "BILLING_EXHAUSTED",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  NETWORK_UNAVAILABLE: "NETWORK_UNAVAILABLE",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  STRUCTURED_OUTPUT_UNSUPPORTED: "STRUCTURED_OUTPUT_UNSUPPORTED",
  MALFORMED_RESPONSE: "MALFORMED_RESPONSE",
  PROVIDER_SERVER_ERROR: "PROVIDER_SERVER_ERROR",
  UNKNOWN_PROVIDER_ERROR: "UNKNOWN_PROVIDER_ERROR"
});

const PROVIDER_SPECS = Object.freeze({
  groq: {
    id: "groq",
    displayName: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    envKey: "GROQ_API_KEY",
    capabilities: ["intent", "living-interpretation", "living-presentation", "local-dialogue"],
    protocol: "chat"
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    envKey: "GEMINI_API_KEY",
    capabilities: ["intent", "living-interpretation", "living-presentation", "local-dialogue"],
    protocol: "chat"
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter Free",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    envKey: "OPENROUTER_API_KEY",
    capabilities: ["intent", "living-interpretation", "living-presentation", "local-dialogue"],
    protocol: "chat"
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    envKey: "OPENAI_API_KEY",
    capabilities: ["intent", "living-interpretation", "living-presentation", "local-dialogue"],
    protocol: "responses"
  }
});

function classifyProviderError(error) {
  if (!error) return FAILURE_CLASSES.UNKNOWN_PROVIDER_ERROR;
  const status = Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.statusCode) ? error.statusCode : null;
  const message = String(error.message ?? "");
  const code = String(error.code ?? error.error?.code ?? "");
  const param = String(error.param ?? error.error?.param ?? "");
  const name = String(error.name ?? "");

  if (code === "AUTH_MISSING" || /not configured|missing.*(?:key|credential)/i.test(message)) {
    return FAILURE_CLASSES.AUTH_MISSING;
  }
  if (status === 401 || code === "invalid_api_key" || code === "authentication_error" || /invalid.*(?:api|access).*key|unauthorized/i.test(message)) {
    return FAILURE_CLASSES.AUTH_INVALID;
  }
  if (
    code === "credit_balance_exhausted" ||
    code === "insufficient_quota" ||
    code === "billing_not_active" ||
    /credit_balance_exhausted|insufficient_quota|quota.*exceeded|billing.*not.*active|check your plan and billing/i.test(message)
  ) {
    return FAILURE_CLASSES.BILLING_EXHAUSTED;
  }
  if (status === 429 || code === "rate_limit_exceeded" || code === "requests_per_minute_exceeded" || /rate.*limit/i.test(message)) {
    return FAILURE_CLASSES.RATE_LIMITED;
  }
  if (name === "AbortError" || code === "ETIMEDOUT" || code === "ECONNABORTED" || /timeout|timed out/i.test(message)) {
    return FAILURE_CLASSES.TIMEOUT;
  }
  if (
    ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code) ||
    /fetch failed|network|connection refused|getaddrinfo/i.test(message)
  ) {
    return FAILURE_CLASSES.NETWORK_UNAVAILABLE;
  }
  if (status === 404 || code === "model_not_found" || code === "model_unavailable" || /model.*not found|model.*does not exist/i.test(message)) {
    return FAILURE_CLASSES.MODEL_UNAVAILABLE;
  }
  if (
    (status === 400 && (param === "response_format" || param === "text.format" || /response_format|json_schema|strict.*json|schema not supported/i.test(message))) ||
    code === "STRUCTURED_OUTPUT_UNSUPPORTED"
  ) {
    return FAILURE_CLASSES.STRUCTURED_OUTPUT_UNSUPPORTED;
  }
  if (error instanceof SyntaxError || code === "MALFORMED_RESPONSE" || code === "NO_TEXT_OUTPUT" || /json|syntaxerror|had no text/i.test(message)) {
    return FAILURE_CLASSES.MALFORMED_RESPONSE;
  }
  if (typeof status === "number" && status >= 500 && status < 600) {
    return FAILURE_CLASSES.PROVIDER_SERVER_ERROR;
  }
  return FAILURE_CLASSES.UNKNOWN_PROVIDER_ERROR;
}

function safeErrorField(value) {
  const text = typeof value === "string" ? value : "";
  return /^[a-z0-9_.-]{1,80}$/i.test(text) ? text : null;
}

function cleanResponseText(rawText, providerId) {
  if (typeof rawText !== "string") {
    throw Object.assign(new Error(`${providerId} response had no text output`), { code: "NO_TEXT_OUTPUT" });
  }
  let clean = rawText.trim();
  if (clean.startsWith("```json")) {
    clean = clean.slice(7).replace(/```$/, "").trim();
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3).replace(/```$/, "").trim();
  }
  return clean;
}

const REF = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    scope: { type: "string", enum: ["entity", "location", "person", "inventory", "phenomenon"] },
    resolution: { type: "string", enum: ["unresolved", "contextual"] }
  },
  required: ["text", "scope", "resolution"]
};

const STEP = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    relation: { type: "string", enum: ["sequence", "parallel"] },
    attempt: { type: "string" },
    goals: { type: "array", items: { type: "string" } },
    methods: { type: "array", items: { type: "string" } },
    references: { type: "array", items: REF },
    constraints: { type: "array", items: { type: "string" } },
    uncertain: { type: "boolean" }
  },
  required: ["id", "relation", "attempt", "goals", "methods", "references", "constraints", "uncertain"]
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: INTENT_VERSION },
    status: { type: "string", const: "proposal" },
    noncanonical: { type: "boolean", const: true },
    actor: { type: ["string", "null"] },
    goals: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: STEP, maxItems: 16 },
    methods: { type: "array", items: { type: "string" } },
    referenced_entities: { type: "array", items: REF },
    referenced_locations: { type: "array", items: REF },
    referenced_people: { type: "array", items: REF },
    referenced_inventory: { type: "array", items: REF },
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          when: { type: "string" },
          then_steps: { type: "array", items: { type: "string" } },
          otherwise_steps: { type: "array", items: { type: "string" } }
        },
        required: ["when", "then_steps", "otherwise_steps"]
      }
    },
    preferences: { type: "array", items: { type: "string" } },
    social_intent: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          addressee: { type: ["string", "null"] },
          tone: { type: ["string", "null"] },
          deceptive_intent: { type: "boolean" }
        },
        required: ["kind", "addressee", "tone", "deceptive_intent"]
      }
    },
    communication_content: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string" },
          content: { type: "string" },
          addressee: { type: ["string", "null"] }
        },
        required: ["kind", "content", "addressee"]
      }
    },
    temporal_order: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          before: { type: "string" },
          after: { type: "string" }
        },
        required: ["before", "after"]
      }
    },
    uncertainties: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    clarification_required: { type: "boolean" },
    clarification: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        question: { type: "string" },
        candidate_reference_labels: { type: "array", items: { type: "string" } }
      },
      required: ["question", "candidate_reference_labels"]
    }
  },
  required: [
    "version", "status", "noncanonical", "actor", "goals", "steps", "methods",
    "referenced_entities", "referenced_locations", "referenced_people", "referenced_inventory",
    "conditions", "preferences", "social_intent", "communication_content", "temporal_order",
    "uncertainties", "assumptions", "clarification_required", "clarification"
  ]
};

const LIVING_ATTEMPT = {
  type: "object",
  additionalProperties: false,
  properties: {
    actor: {
      anyOf: [
        { type: "object", additionalProperties: false, properties: { kind: { type: "string", const: "player" } }, required: ["kind"] },
        { type: "object", additionalProperties: false, properties: { kind: { type: "string", const: "coworker" }, reference: { type: "string" } }, required: ["kind", "reference"] }
      ]
    },
    action: { type: "string" },
    target_label: { type: ["string", "null"] },
    equipment_label: { type: ["string", "null"] },
    agency: { type: "string", enum: ["direct-player", "first-person", "player-order"] },
    language_span: { type: "string" }
  },
  required: ["actor", "action", "target_label", "equipment_label", "agency", "language_span"]
};

const LIVING_INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: PROPOSAL_VERSION },
    status: { type: "string", const: "proposal" },
    noncanonical: { type: "boolean", const: true },
    relation: { type: "string", enum: ["single", "coordinated"] },
    attempts: { type: "array", minItems: 1, maxItems: 4, items: LIVING_ATTEMPT }
  },
  required: ["version", "status", "noncanonical", "relation", "attempts"]
};

const LIVING_PRESENTATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: PRESENTATION_VERSION },
    scene_description: { type: "string" },
    npc_presentations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          observer_id: { type: "string" },
          speech: { type: ["string", "null"] },
          visible_action: { type: ["string", "null"] }
        },
        required: ["observer_id", "speech", "visible_action"]
      }
    },
    presentation_claims: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string" },
          text: { type: "string" }
        },
        required: ["source", "text"]
      }
    }
  },
  required: ["version", "scene_description", "npc_presentations", "presentation_claims"]
};

const LOCAL_DIALOGUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: LOCAL_DIALOGUE_CANDIDATE_VERSION },
    observer_id: { type: "string" },
    speech: { type: "string" }
  },
  required: ["version", "observer_id", "speech"]
};

function createHostedProvider({
  providerId = "openai",
  apiKey = null,
  baseURL = null,
  model = null,
  client = null,
  timeout = 15000,
  onInvocation = null
} = {}) {
  const spec = PROVIDER_SPECS[providerId] || {
    id: providerId,
    displayName: providerId,
    baseURL: null,
    defaultModel: "default-model",
    envKey: `${providerId.toUpperCase()}_API_KEY`,
    protocol: "chat"
  };
  const resolvedKey = apiKey !== undefined && apiKey !== null ? apiKey : (spec.envKey ? process.env[spec.envKey] : null);
  const resolvedModel = model || (providerId === "openai" ? (process.env.YELLOW_BEAST_AI_MODEL || spec.defaultModel) : spec.defaultModel);
  const resolvedBaseURL = baseURL || spec.baseURL || undefined;

  if (!resolvedKey && !client) {
    throw Object.assign(new Error(`${spec.displayName || providerId} provider is not configured. Set ${spec.envKey} or use Offline Interpreter.`), {
      code: "AUTH_MISSING"
    });
  }

  const hostedRequest = !client;
  let sdk = client;
  if (!sdk) {
    const OpenAI = require("openai");
    const options = { apiKey: resolvedKey, timeout, maxRetries: 0 };
    if (resolvedBaseURL) options.baseURL = resolvedBaseURL;
    sdk = new OpenAI(options);
  }

  let invocationSequence = 0;
  function report(event) {
    if (typeof onInvocation !== "function") return;
    try { onInvocation(event); } catch {}
  }

  async function request(kind, instructions, payload, format) {
    const invocationId = `${providerId}-invocation-${++invocationSequence}`;
    const startedAt = Date.now();
    const transportType = hostedRequest ? `${providerId}-sdk` : "injected-client";
    const common = {
      invocation_id: invocationId,
      request_kind: kind,
      provider: providerId,
      model: resolvedModel,
      transport: transportType,
      hosted_request: hostedRequest,
      provider_call_attempted: true,
      context_sha256: crypto.createHash("sha256").update(JSON.stringify(payload.context ?? payload)).digest("hex"),
      context_sections: Object.keys(payload.context ?? payload),
      context_version: payload.context?.version ?? payload.version ?? null,
      store: false
    };

    report({ ...common, status: "started", response_received: false, response_parsed: false, duration_ms: 0 });
    let response = null;

    try {
      let rawText = null;
      // If sdk provides responses.create (e.g. injected client or OpenAI Responses API)
      if (typeof sdk.responses?.create === "function" && (providerId === "openai" || !sdk.chat?.completions?.create)) {
        response = await sdk.responses.create({
          model: resolvedModel,
          store: false,
          instructions,
          input: JSON.stringify(payload),
          text: { format }
        });
        rawText = response?.output_text;
      } else if (typeof sdk.chat?.completions?.create === "function") {
        const messages = [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(payload) }
        ];
        const body = {
          model: resolvedModel,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: format.name,
              strict: format.strict !== false,
              schema: format.schema
            }
          }
        };
        response = await sdk.chat.completions.create(body);
        rawText = response?.choices?.[0]?.message?.content;
      } else {
        throw new Error(`Client does not support responses or chat completions for ${providerId}`);
      }

      const cleanText = cleanResponseText(rawText, providerId);
      let parsed;
      try {
        parsed = JSON.parse(cleanText);
      } catch (parseError) {
        throw Object.assign(new Error(`Failed to parse JSON response from ${providerId}: ${parseError.message}`), {
          code: "MALFORMED_RESPONSE"
        });
      }

      report({
        ...common,
        status: "completed",
        response_received: true,
        response_parsed: true,
        response_id_sha256: typeof response?.id === "string" ? crypto.createHash("sha256").update(response.id).digest("hex") : null,
        duration_ms: Date.now() - startedAt
      });
      return parsed;
    } catch (error) {
      const failureClass = classifyProviderError(error);
      report({
        ...common,
        status: "failed",
        response_received: Boolean(response),
        response_parsed: false,
        response_id_sha256: typeof response?.id === "string" ? crypto.createHash("sha256").update(response.id).digest("hex") : null,
        error_type: safeErrorField(error?.name) ?? "Error",
        error_status: Number.isInteger(error?.status) ? error.status : null,
        error_code: safeErrorField(error?.code ?? error?.error?.code),
        error_param: safeErrorField(error?.param ?? error?.error?.param),
        failure_class: failureClass,
        duration_ms: Date.now() - startedAt
      });
      throw error;
    }
  }

  return {
    name: providerId,
    model: resolvedModel,
    async interpret({ player_text, context }) {
      return request(
        "intent",
        "Return only JSON matching the schema. Interpret attempted behavior only. It is non-canonical: do not select engine actions, decide success, ground unresolved references, invent facts, or use information outside the supplied observer-safe context.",
        { player_text, context },
        { type: "json_schema", name: "yellow_beast_freeform_intent", strict: true, schema: INTENT_SCHEMA }
      );
    },
    async interpretLiving({ player_text, context }) {
      return request(
        "living-interpretation",
        "Return only the bounded noncanonical interpretation proposal. Preserve explicit player agency and language spans exactly. Use only currently offered action, target, equipment, and coworker labels. Genuine ambiguity must remain unresolved.",
        { player_text, context },
        { type: "json_schema", name: "yellow_beast_living_interpretation", strict: true, schema: LIVING_INTERPRETATION_SCHEMA }
      );
    },
    async presentLiving(packet) {
      return request(
        "living-presentation",
        "Return only an untrusted presentation candidate. Describe only the supplied controlled-player packet and resolved public result. Do not invent player speech, player action, NPC speech, NPC action, knowledge, conclusions, locations, equipment, future events, or hidden causes. Omit NPC presentation unless the packet explicitly supports it.",
        packet,
        { type: "json_schema", name: "yellow_beast_living_presentation", strict: true, schema: LIVING_PRESENTATION_SCHEMA }
      );
    },
    async presentLocal(packet) {
      return request(
        "local-dialogue",
        "Return only an untrusted LOCAL dialogue candidate spoken by the single authorized coworker in the packet. Give that coworker a concise voice grounded in their supplied identity, role, condition, current task, equipment, qualifications, and shared history. Fulfil only the authorized response purpose. Do not invent facts, observations, knowledge, actions, other speakers, quoted player speech, or any player action or dialogue.",
        packet,
        { type: "json_schema", name: "yellow_beast_local_dialogue", strict: true, schema: LOCAL_DIALOGUE_SCHEMA }
      );
    }
  };
}

module.exports = {
  createHostedProvider,
  classifyProviderError,
  FAILURE_CLASSES,
  PROVIDER_SPECS,
  INTENT_SCHEMA,
  LIVING_INTERPRETATION_SCHEMA,
  LIVING_PRESENTATION_SCHEMA,
  LOCAL_DIALOGUE_SCHEMA
};
