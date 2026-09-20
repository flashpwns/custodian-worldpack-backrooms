"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const { ProviderPool } = require("../tools/ai-provider-pool");
const {
  LOCAL_PROVIDER_SPEC,
  createLocalModelProvider,
  inspectLocalModel,
  normalizeLocalEndpoint,
  sanitizeLocalDialogueCandidate
} = require("../tools/ai-local-model-provider");
const { INTENT_VERSION, validateIntent } = require("../tools/ai-adapter");
const { PROPOSAL_VERSION } = require("../tools/ai-interpreter-boundary");

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers:{ "content-type":"application/json" } });
}

function waitProposal() {
  return {
    version:PROPOSAL_VERSION,
    status:"proposal",
    noncanonical:true,
    relation:"single",
    attempts:[{
      actor:{ kind:"player" },
      action:"WAIT",
      target_label:null,
      equipment_label:null,
      agency:"direct-player",
      language_span:"Wait here."
    }]
  };
}

const intentProposal = {
  version:INTENT_VERSION,
  status:"proposal",
  noncanonical:true,
  actor:"player",
  goals:["inspect"],
  steps:[{ id:"step-1", relation:"sequence", attempt:"inspect the light", goals:["inspect"], methods:[], references:[], constraints:[], uncertain:false }],
  methods:[],
  referenced_entities:[],
  referenced_locations:[],
  referenced_people:[],
  referenced_inventory:[],
  conditions:[],
  preferences:[],
  social_intent:[],
  communication_content:[],
  temporal_order:[],
  uncertainties:[],
  assumptions:[],
  clarification_required:false,
  clarification:null
};

test("local provider accepts only on-device loopback endpoints", () => {
  assert.equal(normalizeLocalEndpoint("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(normalizeLocalEndpoint("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.throws(() => normalizeLocalEndpoint("https://example.com"), { code:"LOCAL_ENDPOINT_INVALID" });
  assert.throws(() => normalizeLocalEndpoint("http://192.168.1.7:11434"), { code:"LOCAL_ENDPOINT_INVALID" });
  assert.throws(() => normalizeLocalEndpoint("http://127.0.0.1:11434/proxy"), { code:"LOCAL_ENDPOINT_INVALID" });
});

test("local provider sends schema-constrained, non-streaming, non-thinking requests for interpretation and dialogue", async () => {
  const calls = [];
  const events = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const required = body.format?.required ?? [];
    if (required.includes("observer_id")) return response({ model:body.model, created_at:"dialogue", message:{ role:"assistant", content:JSON.stringify({ version:"yellow-beast-local-dialogue-candidate@v1", observer_id:"coworker-1", speech:"Stay close. I can keep this simple.", semantic_claims:[] }) }, done:true });
    if (required.includes("relation")) return response({ model:body.model, created_at:"living", message:{ role:"assistant", content:JSON.stringify(waitProposal()) }, done:true });
    if (required.includes("scene_description")) return response({ model:body.model, created_at:"presentation", message:{ role:"assistant", content:JSON.stringify({ version:"yellow-beast-presentation-candidate@v1", scene_description:"The visible room remains still.", npc_presentations:[], presentation_claims:[] }) }, done:true });
    return response({ model:body.model, created_at:"intent", message:{ role:"assistant", content:JSON.stringify(intentProposal) }, done:true });
  };
  const provider = createLocalModelProvider({ model:"fixture:9b", fetchImpl, onInvocation:event => events.push(event) });

  const intent = await provider.interpret({ player_text:"inspect the light", context:{ version:"safe@v1", visible_reference_labels:["the light"] } });
  assert.equal(validateIntent(intent, { raw_input:"inspect the light", provider:"local" }).status, "proposal");
  assert.deepEqual(await provider.interpretLiving({ player_text:"Wait here.", context:{ version:"safe@v1" } }), waitProposal());
  const presentation = await provider.presentLiving({ version:"yellow-beast-presentation-packet@v1", authoritative_resolution:{ action:"LOOK" }, player_scene:{ location:{ visible_description:"The visible room remains still." } } });
  assert.deepEqual(presentation.npc_presentations, []);
  const dialogue = await provider.presentLocal({ version:"yellow-beast-local-dialogue-packet@v1", speaker:{ observer_id:"coworker-1", tendencies:{ procedural_caution:80 } }, authorized_response:{ purpose:"acknowledge the player" } });
  assert.equal(dialogue.speech, "Stay close. I can keep this simple.");

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(call.body.stream, false);
    assert.equal(call.body.think, false);
    assert.equal(call.body.model, "fixture:9b");
    assert.equal(call.body.format.type, "object");
    assert.match(call.body.messages[0].content, /complete canon available/i);
    assert.match(call.body.messages[0].content, /personality affect word choice/i);
    assert.match(call.body.messages[1].content, /Required JSON schema/);
  }
  assert.equal(events.filter(event => event.status === "completed").length, 4);
  assert.ok(events.every(event => event.hosted_request === false && event.transport === "ollama-loopback"));
  assert.doesNotMatch(JSON.stringify(events), /inspect the light|Stay close/);
});

test("runtime inspection distinguishes an installed model from a reachable server without it", async () => {
  const ready = await inspectLocalModel({ model:"qwen3.5:9b", fetchImpl:async () => response({ models:[{ name:"qwen3.5:9b" }] }) });
  assert.deepEqual(ready, { ok:true, runtime_available:true, model_available:true, models:["qwen3.5:9b"] });
  const missing = await inspectLocalModel({ model:"qwen3.5:9b", fetchImpl:async () => response({ models:[{ name:"other:latest" }] }) });
  assert.equal(missing.runtime_available, true);
  assert.equal(missing.model_available, false);
});

test("local dialogue sanitation removes unused model claims without authorizing new prose", () => {
  const candidate = sanitizeLocalDialogueCandidate({
    version:"yellow-beast-local-dialogue-candidate@v1",
    observer_id:"coworker-1",
    speech:"We can take this slowly.",
    semantic_claims:[{ type:"direct-observation", text:"A fixture hums overhead.", subject:null, object:null, location_id:"room", target:null, proposition:null }]
  });
  assert.equal(candidate.speech, "We can take this slowly.");
  assert.deepEqual(candidate.semantic_claims, []);
});

test("provider pool and desktop settings select local generation without an API key", async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response({ model:"qwen3.5:9b", created_at:"test", message:{ role:"assistant", content:JSON.stringify(waitProposal()) }, done:true });
  };
  const settings = { provider:"local", local_endpoint:"http://127.0.0.1:11434", local_model:"qwen3.5:9b" };
  const pool = new ProviderPool({ settingsGetter:() => settings, localFetch:fetchImpl });
  assert.deepEqual(pool.getCandidates({ preferredProvider:"local" }), ["local", "offline"]);
  assert.equal(pool.getProviderInstance("local").model, "qwen3.5:9b");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y97-local-"));
  const service = new DesktopService({ appDataPath:root });
  service.providerPool.localFetch = fetchImpl;
  const saved = service.updateSettings({ settings });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.provider, "local");
  assert.equal(service.getProviderStatus().provider.entries[0].kind, "local");
  const tested = await service.testProvider({ provider:"local", live:true });
  assert.equal(tested.ok, true);
  assert.equal(tested.selected_provider, "local");
  assert.equal(requests.length, 1);
  assert.equal(service.getDiagnostics().diagnostics.local_ai.model, LOCAL_PROVIDER_SPEC.defaultModel);
});

test("desktop rejects remote local-model addresses without changing saved settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y97-remote-"));
  const service = new DesktopService({ appDataPath:root });
  const before = service.settings();
  const rejected = service.updateSettings({ settings:{ provider:"local", local_endpoint:"http://example.com:11434", local_model:"qwen3.5:9b" } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "LOCAL_ENDPOINT_INVALID");
  assert.deepEqual(service.settings(), before);
});
