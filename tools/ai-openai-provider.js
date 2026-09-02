"use strict";
const crypto = require("node:crypto");
const { INTENT_VERSION } = require("./ai-adapter");
const { PROPOSAL_VERSION } = require("./ai-interpreter-boundary");
const { PRESENTATION_VERSION } = require("./ai-living-turn");
const { CANDIDATE_VERSION:LOCAL_DIALOGUE_CANDIDATE_VERSION } = require("./ai-local-dialogue");
const REF = { type: "object", additionalProperties: false, properties: { text: { type: "string" }, scope: { type: "string", enum: ["entity", "location", "person", "inventory", "phenomenon"] }, resolution: { type: "string", enum: ["unresolved", "contextual"] } }, required: ["text", "scope", "resolution"] };
const STEP = { type: "object", additionalProperties: false, properties: { id: { type: "string" }, relation: { type: "string", enum: ["sequence", "parallel"] }, attempt: { type: "string" }, goals: { type: "array", items: { type: "string" } }, methods: { type: "array", items: { type: "string" } }, references: { type: "array", items: REF }, constraints: { type: "array", items: { type: "string" } }, uncertain: { type: "boolean" } }, required: ["id", "relation", "attempt", "goals", "methods", "references", "constraints", "uncertain"] };
const INTENT_SCHEMA = { type: "object", additionalProperties: false, properties: { version: { type: "string", const: INTENT_VERSION }, status: { type: "string", const: "proposal" }, noncanonical: { type: "boolean", const: true }, actor: { type: ["string", "null"] }, goals: { type: "array", items: { type: "string" } }, steps: { type: "array", items: STEP, maxItems: 16 }, methods: { type: "array", items: { type: "string" } }, referenced_entities: { type: "array", items: REF }, referenced_locations: { type: "array", items: REF }, referenced_people: { type: "array", items: REF }, referenced_inventory: { type: "array", items: REF }, conditions: { type: "array", items: { type: "object", additionalProperties: false, properties: { when: { type: "string" }, then_steps: { type: "array", items: { type: "string" } }, otherwise_steps: { type: "array", items: { type: "string" } } }, required: ["when", "then_steps", "otherwise_steps"] } }, preferences: { type: "array", items: { type: "string" } }, social_intent: { type: "array", items: { type: "object", additionalProperties: false, properties: { kind: { type: "string" }, addressee: { type: ["string", "null"] }, tone: { type: ["string", "null"] }, deceptive_intent: { type: "boolean" } }, required: ["kind", "addressee", "tone", "deceptive_intent"] } }, communication_content: { type: "array", items: { type: "object", additionalProperties: false, properties: { kind: { type: "string" }, content: { type: "string" }, addressee: { type: ["string", "null"] } }, required: ["kind", "content", "addressee"] } }, temporal_order: { type: "array", items: { type: "object", additionalProperties: false, properties: { before: { type: "string" }, after: { type: "string" } }, required: ["before", "after"] } }, uncertainties: { type: "array", items: { type: "string" } }, assumptions: { type: "array", items: { type: "string" } }, clarification_required: { type: "boolean" }, clarification: { type: ["object", "null"], additionalProperties: false, properties: { question: { type: "string" }, candidate_reference_labels: { type: "array", items: { type: "string" } } }, required: ["question", "candidate_reference_labels"] } }, required: ["version", "status", "noncanonical", "actor", "goals", "steps", "methods", "referenced_entities", "referenced_locations", "referenced_people", "referenced_inventory", "conditions", "preferences", "social_intent", "communication_content", "temporal_order", "uncertainties", "assumptions", "clarification_required", "clarification"] };
const LIVING_ATTEMPT = { type:"object", additionalProperties:false, properties:{ actor:{ anyOf:[{ type:"object", additionalProperties:false, properties:{ kind:{ type:"string", const:"player" } }, required:["kind"] }, { type:"object", additionalProperties:false, properties:{ kind:{ type:"string", const:"coworker" }, reference:{ type:"string" } }, required:["kind","reference"] }] }, action:{ type:"string" }, target_label:{ type:["string","null"] }, equipment_label:{ type:["string","null"] }, agency:{ type:"string", enum:["direct-player","first-person","player-order"] }, language_span:{ type:"string" } }, required:["actor","action","target_label","equipment_label","agency","language_span"] };
const LIVING_INTERPRETATION_SCHEMA = { type:"object", additionalProperties:false, properties:{ version:{ type:"string", const:PROPOSAL_VERSION }, status:{ type:"string", const:"proposal" }, noncanonical:{ type:"boolean", const:true }, relation:{ type:"string", enum:["single","coordinated"] }, attempts:{ type:"array", minItems:1, maxItems:4, items:LIVING_ATTEMPT } }, required:["version","status","noncanonical","relation","attempts"] };
const LIVING_PRESENTATION_SCHEMA = { type:"object", additionalProperties:false, properties:{ version:{ type:"string", const:PRESENTATION_VERSION }, scene_description:{ type:"string" }, npc_presentations:{ type:"array", maxItems:12, items:{ type:"object", additionalProperties:false, properties:{ observer_id:{ type:"string" }, speech:{ type:["string","null"] }, visible_action:{ type:["string","null"] } }, required:["observer_id","speech","visible_action"] } }, presentation_claims:{ type:"array", maxItems:24, items:{ type:"object", additionalProperties:false, properties:{ source:{ type:"string" }, text:{ type:"string" } }, required:["source","text"] } } }, required:["version","scene_description","npc_presentations","presentation_claims"] };
const LOCAL_DIALOGUE_SCHEMA = { type:"object", additionalProperties:false, properties:{ version:{ type:"string", const:LOCAL_DIALOGUE_CANDIDATE_VERSION }, observer_id:{ type:"string" }, speech:{ type:"string" } }, required:["version","observer_id","speech"] };

function createOpenAIProvider({ apiKey = process.env.OPENAI_API_KEY, model = process.env.YELLOW_BEAST_AI_MODEL || "gpt-5.6-luna", client, timeout = 15000, onInvocation = null } = {}) {
  if (!apiKey && !client) throw new Error("OpenAI provider is not configured. Set OPENAI_API_KEY or use Offline Interpreter.");
  const hostedRequest = !client;
  const sdk = client || new (require("openai"))({ apiKey, timeout, maxRetries:0 });
  let invocationSequence = 0;
  function report(event) {
    if (typeof onInvocation !== "function") return;
    try { onInvocation(event); } catch {}
  }
  function safeErrorField(value) {
    const text = typeof value === "string" ? value : "";
    return /^[a-z0-9_.-]{1,80}$/i.test(text) ? text : null;
  }
  async function request(kind, instructions, payload, format) {
    const invocationId = `openai-invocation-${++invocationSequence}`;
    const startedAt = Date.now();
    const common = { invocation_id:invocationId, request_kind:kind, provider:"openai", model, transport:hostedRequest ? "openai-sdk" : "injected-client", hosted_request:hostedRequest, provider_call_attempted:true, store:false };
    report({ ...common, status:"started", response_received:false, response_parsed:false, duration_ms:0 });
    let response = null;
    try {
      response = await sdk.responses.create({ model, store:false, instructions, input:JSON.stringify(payload), text:{ format } });
      if (typeof response?.output_text !== "string") throw new Error("OpenAI response had no text output");
      const parsed = JSON.parse(response.output_text);
      report({ ...common, status:"completed", response_received:true, response_parsed:true, response_id_sha256:typeof response.id === "string" ? crypto.createHash("sha256").update(response.id).digest("hex") : null, duration_ms:Date.now()-startedAt });
      return parsed;
    } catch (error) {
      report({ ...common, status:"failed", response_received:Boolean(response), response_parsed:false, response_id_sha256:typeof response?.id === "string" ? crypto.createHash("sha256").update(response.id).digest("hex") : null, error_type:safeErrorField(error?.name) ?? "Error", error_status:Number.isInteger(error?.status) ? error.status : null, error_code:safeErrorField(error?.code ?? error?.error?.code), error_param:safeErrorField(error?.param ?? error?.error?.param), duration_ms:Date.now()-startedAt });
      throw error;
    }
  }
  return {
    name:"openai",
    model,
    async interpret({ player_text, context }) {
      return request("intent", "Return only JSON matching the schema. Interpret attempted behavior only. It is non-canonical: do not select engine actions, decide success, ground unresolved references, invent facts, or use information outside the supplied observer-safe context.", { player_text, context }, { type:"json_schema", name:"yellow_beast_freeform_intent", strict:true, schema:INTENT_SCHEMA });
    },
    async interpretLiving({ player_text, context }) {
      return request("living-interpretation", "Return only the bounded noncanonical interpretation proposal. Preserve explicit player agency and language spans exactly. Use only currently offered action, target, equipment, and coworker labels. Genuine ambiguity must remain unresolved.", { player_text, context }, { type:"json_schema", name:"yellow_beast_living_interpretation", strict:true, schema:LIVING_INTERPRETATION_SCHEMA });
    },
    async presentLiving(packet) {
      return request("living-presentation", "Return only an untrusted presentation candidate. Describe only the supplied controlled-player packet and resolved public result. Do not invent player speech, player action, NPC speech, NPC action, knowledge, conclusions, locations, equipment, future events, or hidden causes. Omit NPC presentation unless the packet explicitly supports it.", packet, { type:"json_schema", name:"yellow_beast_living_presentation", strict:true, schema:LIVING_PRESENTATION_SCHEMA });
    },
    async presentLocal(packet) {
      return request("local-dialogue", "Return only an untrusted LOCAL dialogue candidate spoken by the single authorized coworker in the packet. Give that coworker a concise voice grounded in their supplied identity, role, condition, current task, equipment, qualifications, and shared history. Fulfil only the authorized response purpose. Do not invent facts, observations, knowledge, actions, other speakers, quoted player speech, or any player action or dialogue.", packet, { type:"json_schema", name:"yellow_beast_local_dialogue", strict:true, schema:LOCAL_DIALOGUE_SCHEMA });
    }
  };
}
module.exports = { createOpenAIProvider, INTENT_SCHEMA, LIVING_INTERPRETATION_SCHEMA, LIVING_PRESENTATION_SCHEMA, LOCAL_DIALOGUE_SCHEMA };
