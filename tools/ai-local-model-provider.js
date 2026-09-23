"use strict";

const crypto = require("node:crypto");
const {
  classifyProviderError,
  INTENT_SCHEMA,
  LIVING_INTERPRETATION_SCHEMA,
  LIVING_PRESENTATION_SCHEMA,
  LOCAL_DIALOGUE_SCHEMA
} = require("./ai-hosted-transport");

const LOCAL_PROVIDER_SPEC = Object.freeze({
  id: "local",
  displayName: "Local model",
  // The real port is ephemeral (chosen at daemon start); this is a dev-only
  // fallback used when nothing else supplies an endpoint (e.g. direct unit
  // construction of this module without the managed appliance).
  defaultEndpoint: "http://127.0.0.1:8734",
  defaultModel: "yellow-beast-local-v1",
  capabilities: ["intent", "living-interpretation", "living-presentation", "local-dialogue"]
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizeLocalEndpoint(value = LOCAL_PROVIDER_SPEC.defaultEndpoint) {
  let parsed;
  try { parsed = new URL(String(value).trim()); }
  catch { throw Object.assign(new Error("Enter a valid local model address."), { code:"LOCAL_ENDPOINT_INVALID" }); }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error("The local model address must be an HTTP loopback address on this device."), { code:"LOCAL_ENDPOINT_INVALID" });
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/") {
    throw Object.assign(new Error("Use the local server root, such as http://127.0.0.1:8734."), { code:"LOCAL_ENDPOINT_INVALID" });
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function cleanJsonText(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error("The local model returned no text."), { code:"NO_TEXT_OUTPUT" });
  }
  let clean = value.trim();
  if (clean.startsWith("```json")) clean = clean.slice(7).replace(/```$/, "").trim();
  else if (clean.startsWith("```")) clean = clean.slice(3).replace(/```$/, "").trim();
  return clean;
}

function safeErrorField(value) {
  const text = typeof value === "string" ? value : "";
  return /^[a-z0-9_.-]{1,80}$/i.test(text) ? text : null;
}

async function fetchJson(url, options, { fetchImpl = globalThis.fetch, timeout = 120000 } = {}) {
  if (typeof fetchImpl !== "function") throw Object.assign(new Error("Local HTTP transport is unavailable."), { code:"NETWORK_UNAVAILABLE" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, { ...options, signal:controller.signal });
    let body;
    try { body = await response.json(); }
    catch { throw Object.assign(new Error("The local model returned an unreadable response."), { code:"MALFORMED_RESPONSE", status:response.status }); }
    if (!response.ok) {
      const error = Object.assign(new Error(typeof body?.error === "string" ? body.error : `Local model request failed with status ${response.status}.`), { status:response.status });
      if (response.status === 404 && /model|manifest/i.test(error.message)) error.code = "model_not_found";
      throw error;
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("The local model timed out."), { name:"AbortError", code:"ETIMEDOUT" });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function localSystemInstructions(taskInstructions) {
  return [
    "You are the private on-device language adapter for Yellow Beast.",
    "The supplied packet is the complete canon available to you for this response. Treat absent facts as unknown.",
    "Canonical engine state and validated public results outrank style, inference, genre expectations, and outside knowledge.",
    "Never create world facts, successful actions, perceptions, memories, relationships, equipment, locations, causes, or player speech.",
    "For prose, write restrained documentary horror in plain natural English. Prefer concrete sensory detail already present in the packet. Avoid melodrama, lore exposition, stock ominous phrases, and repeated sentence templates.",
    "For NPC dialogue, preserve the named speaker's tendencies and relationship history. Let personality affect word choice, directness, rhythm, and warmth without changing facts.",
    taskInstructions,
    "Return exactly one JSON object and no commentary."
  ].join("\n");
}

// llama.cpp's OpenAI-compatible /v1/chat/completions endpoint takes sampling
// parameters at the top level of the request body rather than nested under an
// "options" object. num_ctx moves to the daemon's --ctx-size launch flag
// (fixed for the whole process) instead of being sent per-request.
function generationOptions(kind) {
  const interpretation = kind === "intent" || kind === "living-interpretation";
  return {
    temperature: interpretation ? 0 : 0.45,
    top_p: interpretation ? 0.8 : 0.9,
    repeat_penalty: 1.08,
    max_tokens: interpretation ? 1800 : 900
  };
}

function sanitizeLocalDialogueCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || typeof candidate.speech !== "string") return candidate;
  const normalizedSpeech = candidate.speech.toLocaleLowerCase();
  const semanticClaims = Array.isArray(candidate.semantic_claims)
    ? candidate.semantic_claims.filter(claim => {
      const text = typeof claim?.text === "string" ? claim.text.trim() : "";
      if (text.length < 4 || !normalizedSpeech.includes(text.toLocaleLowerCase())) return false;
      if (claim.type === "direct-observation" && !(typeof claim.target === "string" && claim.target.trim())) return false;
      if (claim.type === "reported-claim" && !(typeof claim.proposition === "string" && claim.proposition.trim())) return false;
      if (claim.type === "measurement" && !(typeof claim.target === "string" && claim.target.trim())) return false;
      return true;
    })
    : [];
  return { ...candidate, semantic_claims:semanticClaims };
}

function sanitizeLocalLivingPresentationCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const version = candidate.version ?? "yellow-beast-presentation-candidate@v1";
  const scene_description = typeof candidate.scene_description === "string" ? candidate.scene_description : "";
  const npc_presentations = Array.isArray(candidate.npc_presentations)
    ? candidate.npc_presentations
        .filter(item => item && typeof item.observer_id === "string" && (Boolean(item.speech?.trim()) || Boolean(item.visible_action?.trim())))
        .map(item => ({
          observer_id: item.observer_id,
          speech: typeof item.speech === "string" && item.speech.trim() ? item.speech : null,
          visible_action: typeof item.visible_action === "string" && item.visible_action.trim() ? item.visible_action : null
        }))
    : [];
  const presentation_claims = Array.isArray(candidate.presentation_claims)
    ? candidate.presentation_claims
        .filter(claim => claim && typeof claim.source === "string" && typeof claim.text === "string" && claim.text.trim().length > 0)
        .map(claim => ({ source: claim.source, text: claim.text }))
    : [];
  return {
    version,
    scene_description,
    npc_presentations,
    presentation_claims
  };
}

function createLocalModelProvider({
  endpoint = LOCAL_PROVIDER_SPEC.defaultEndpoint,
  model = LOCAL_PROVIDER_SPEC.defaultModel,
  timeout = 120000,
  fetchImpl = globalThis.fetch,
  onInvocation = null
} = {}) {
  const resolvedEndpoint = normalizeLocalEndpoint(endpoint);
  const resolvedModel = typeof model === "string" && model.trim() ? model.trim() : LOCAL_PROVIDER_SPEC.defaultModel;
  let invocationSequence = 0;

  function report(event) {
    if (typeof onInvocation !== "function") return;
    try { onInvocation(event); } catch {}
  }

  async function request(kind, taskInstructions, payload, format) {
    const invocationId = `local-invocation-${++invocationSequence}`;
    const startedAt = Date.now();
    const common = {
      invocation_id:invocationId,
      request_kind:kind,
      provider:"local",
      model:resolvedModel,
      transport:"llamacpp-loopback",
      hosted_request:false,
      local_request:true,
      provider_call_attempted:true,
      context_sha256:crypto.createHash("sha256").update(JSON.stringify(payload.context ?? payload)).digest("hex"),
      context_sections:Object.keys(payload.context ?? payload),
      context_version:payload.context?.version ?? payload.version ?? null,
      store:false
    };
    report({ ...common, status:"started", response_received:false, response_parsed:false, duration_ms:0 });
    let responseReceived = false;
    try {
      const body = await fetchJson(`${resolvedEndpoint}/v1/chat/completions`, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify({
          model:resolvedModel,
          messages:[
            { role:"system", content:localSystemInstructions(taskInstructions) },
            { role:"user", content:`Required JSON schema:\n${JSON.stringify(format.schema)}\n\nObserver-safe input packet:\n${JSON.stringify(payload)}` }
          ],
          response_format:{
            type:"json_schema",
            json_schema:{ name:format.name || kind.replace(/-/g, "_"), strict:true, schema:format.schema }
          },
          stream:false,
          ...generationOptions(kind)
        })
      }, { fetchImpl, timeout });
      responseReceived = true;
      let parsed;
      try { parsed = JSON.parse(cleanJsonText(body?.choices?.[0]?.message?.content)); }
      catch (error) {
        if (error?.code) throw error;
        throw Object.assign(new Error(`Failed to parse JSON response from the local model: ${error.message}`), { code:"MALFORMED_RESPONSE" });
      }
      report({
        ...common,
        status:"completed",
        response_received:true,
        response_parsed:true,
        response_id_sha256:crypto.createHash("sha256").update(`${body?.model ?? resolvedModel}:${body?.id ?? invocationId}`).digest("hex"),
        duration_ms:Date.now() - startedAt
      });
      return parsed;
    } catch (error) {
      report({
        ...common,
        status:"failed",
        response_received:responseReceived,
        response_parsed:false,
        error_type:safeErrorField(error?.name) ?? "Error",
        error_status:Number.isInteger(error?.status) ? error.status : null,
        error_code:safeErrorField(error?.code),
        failure_class:classifyProviderError(error),
        duration_ms:Date.now() - startedAt
      });
      throw error;
    }
  }

  return {
    name:"local",
    model:resolvedModel,
    endpoint:resolvedEndpoint,
    async interpret({ player_text, context }) {
      return request("intent", "Interpret attempted behavior only as a noncanonical proposal. Preserve every explicit clause and uncertainty. Do not select engine outcomes or resolve references beyond the supplied labels.", { player_text, context }, { schema:INTENT_SCHEMA });
    },
    async interpretLiving({ player_text, context }) {
      return request("living-interpretation", [
        "Return a bounded noncanonical interpretation proposal. Preserve explicit player agency and language spans.",
        "Choose action only from context.sinks and copy its uppercase action label exactly. Copy target and equipment labels exactly from their offered lists.",
        "Use LOOK for look around, observe the area, scan, or check surroundings when no specific target is named. Use INSPECT only when the player names a specific visible target. Use WAIT for wait, pause, or hold position. Use MOVE only with an offered destination or direction.",
        "A clear request for an offered action is not ambiguous. Leave genuinely missing required targets or unclear actors unresolved.",
        "For 'Look around.' the proposal action is LOOK with null target_label and null equipment_label."
      ].join("\n"), { player_text, context }, { schema:LIVING_INTERPRETATION_SCHEMA });
    },
    async presentLiving(packet) {
      const candidate = await request("living-presentation", [
        "Describe only the controlled-player packet and resolved public result. The prose may improve voice and flow, but it cannot add an event, observation, conclusion, speaker, action, or fact.",
        "Use npc_presentations as an empty array unless the packet contains an exact delivered NPC line or exact supported visible NPC action that must be presented.",
        "Never add placeholder NPC entries. Every npc_presentations item must contain non-empty supported speech or a non-empty supported visible_action.",
        "Do not paraphrase NPC speech or NPC actions. Do not narrate a player action beyond authoritative_resolution.action.",
        "Keep presentation_claims empty unless a supplied source phrase must be cited."
      ].join("\n"), packet, { schema:LIVING_PRESENTATION_SCHEMA });
      return sanitizeLocalLivingPresentationCandidate(candidate);
    },
    async presentLocal(packet) {
      const candidate = await request("local-dialogue", [
        "Write one concise response by the single authorized coworker. Fulfil only authorized_response.purpose.",
        "Answer the player's social or personal meaning directly. Do not add scene description, atmospheric detail, or an unrelated observation to dialogue.",
        "Prefer speech with no factual world claim; then semantic_claims must be an empty array.",
        "When a factual answer is necessary, use only facts explicitly supplied in the packet. Every semantic_claim.text must be an exact contiguous phrase copied from speech. Never list a claim that the speech does not state.",
        "For direct-observation claims, target must be the exact supplied visible target label. For reported-claim, proposition must match the supplied remembered or reported proposition. Never use null for a field required to prove the selected claim type.",
        "Do not echo the player's sentence as a quotation. Natural paraphrase is allowed when the packet supplies the memory.",
        "Keep remembered preferences attributed to the player: their first-person I does not become the coworker's I. State the supplied preference itself (for example, 'Short, clear instructions when you feel nervous. Understood.'). Do not narrate player acts using 'you asked', 'you said', or 'you told'; do not invent a preference absent from this speaker's supplied memories."
      ].join("\n"), packet, { schema:LOCAL_DIALOGUE_SCHEMA });
      // Small local models often copy unused facts into the claim list even
      // when those facts never appear in their speech. Removing such claims
      // cannot authorize prose; the canonical validator still checks every
      // retained claim against the run before accepting the candidate.
      return sanitizeLocalDialogueCandidate(candidate);
    }
  };
}

async function inspectLocalModel({ endpoint = LOCAL_PROVIDER_SPEC.defaultEndpoint, model = LOCAL_PROVIDER_SPEC.defaultModel, fetchImpl = globalThis.fetch, timeout = 3000 } = {}) {
  const resolvedEndpoint = normalizeLocalEndpoint(endpoint);
  let runtimeAvailable = false;
  try {
    await fetchJson(`${resolvedEndpoint}/health`, { method:"GET", headers:{ accept:"application/json" } }, { fetchImpl, timeout });
    runtimeAvailable = true;
  } catch (error) {
    return { ok:false, runtime_available:false, model_available:false, models:[], error_code:classifyProviderError(error) };
  }
  try {
    const body = await fetchJson(`${resolvedEndpoint}/v1/models`, { method:"GET", headers:{ accept:"application/json" } }, { fetchImpl, timeout });
    const models = Array.isArray(body?.data) ? body.data.map(item => item?.id).filter(id => typeof id === "string") : [];
    const available = models.length === 0 || models.includes(model);
    return { ok:true, runtime_available:runtimeAvailable, model_available:available, models };
  } catch (error) {
    // The daemon is reachable (health succeeded) but model listing failed;
    // a running llama-server always serves exactly the one loaded model, so
    // treat this as "runtime up, model identity unconfirmed" rather than a
    // hard failure.
    return { ok:true, runtime_available:runtimeAvailable, model_available:true, models:[], error_code:classifyProviderError(error) };
  }
}

module.exports = {
  LOCAL_PROVIDER_SPEC,
  normalizeLocalEndpoint,
  createLocalModelProvider,
  inspectLocalModel,
  sanitizeLocalDialogueCandidate,
  sanitizeLocalLivingPresentationCandidate
};
