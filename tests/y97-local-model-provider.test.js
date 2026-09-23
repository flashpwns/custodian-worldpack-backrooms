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

test("local provider sends schema-constrained, non-streaming requests over the llama.cpp chat-completions transport", async () => {
  const calls = [];
  const events = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const required = body.response_format?.json_schema?.schema?.required ?? [];
    const wrap = (content) => response({ id:"fixture-response", model:body.model, choices:[{ message:{ role:"assistant", content:JSON.stringify(content) } }] });
    if (required.includes("observer_id")) return wrap({ version:"yellow-beast-local-dialogue-candidate@v1", observer_id:"coworker-1", speech:"Stay close. I can keep this simple.", semantic_claims:[] });
    if (required.includes("relation")) return wrap(waitProposal());
    if (required.includes("scene_description")) return wrap({ version:"yellow-beast-presentation-candidate@v1", scene_description:"The visible room remains still.", npc_presentations:[], presentation_claims:[] });
    return wrap(intentProposal);
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
    assert.equal(call.url, "http://127.0.0.1:8734/v1/chat/completions");
    assert.equal(call.body.stream, false);
    assert.equal(call.body.model, "fixture:9b");
    assert.equal(call.body.response_format.type, "json_schema");
    assert.equal(call.body.response_format.json_schema.strict, true);
    assert.equal(call.body.response_format.json_schema.schema.type, "object");
    assert.match(call.body.messages[0].content, /complete canon available/i);
    assert.match(call.body.messages[0].content, /personality affect word choice/i);
    assert.match(call.body.messages[1].content, /Required JSON schema/);
  }
  assert.equal(events.filter(event => event.status === "completed").length, 4);
  assert.ok(events.every(event => event.hosted_request === false && event.transport === "llamacpp-loopback"));
  assert.doesNotMatch(JSON.stringify(events), /inspect the light|Stay close/);
});

test("runtime inspection distinguishes a reachable server from one without the model loaded", async () => {
  const ready = await inspectLocalModel({
    model:"yellow-beast-local-v1",
    fetchImpl:async (url) => String(url).endsWith("/health") ? response({ status:"ok" }) : response({ data:[{ id:"yellow-beast-local-v1" }] })
  });
  assert.deepEqual(ready, { ok:true, runtime_available:true, model_available:true, models:["yellow-beast-local-v1"] });
  const unreachable = await inspectLocalModel({ model:"yellow-beast-local-v1", fetchImpl:async () => { throw new Error("connection refused"); } });
  assert.equal(unreachable.runtime_available, false);
  assert.equal(unreachable.model_available, false);
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
    return response({ id:"fixture", model:LOCAL_PROVIDER_SPEC.defaultModel, choices:[{ message:{ role:"assistant", content:JSON.stringify(waitProposal()) } }] });
  };
  // With no managed appliance wired, the pool falls back to the legacy
  // settings-driven loopback check so a bare ProviderPool remains testable.
  const settings = { provider:"local" };
  const pool = new ProviderPool({ settingsGetter:() => settings, localFetch:fetchImpl });
  assert.deepEqual(pool.getCandidates({ preferredProvider:"local" }), ["local", "offline"]);
  assert.equal(pool.getProviderInstance("local").model, LOCAL_PROVIDER_SPEC.defaultModel);

  // Through DesktopService, "local" is only actually usable once the managed
  // inference appliance is installed and its daemon reports READY -- the
  // endpoint/model are then sourced from the appliance, not from settings.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y97-local-"));
  const service = new DesktopService({ appDataPath:root });
  service.providerPool.localFetch = fetchImpl;
  const installed = await service.installInferenceAppliance();
  assert.equal(installed.ok, true);
  const saved = service.updateSettings({ settings:{ provider:"local" } });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.provider, "local");
  assert.equal(service.getProviderStatus().provider.entries[0].kind, "local");
  const tested = await service.testProvider({ provider:"local", live:true });
  assert.equal(tested.ok, true);
  assert.equal(tested.selected_provider, "local");
  assert.equal(requests.length, 1);
  assert.equal(service.getDiagnostics().diagnostics.local_ai.model, LOCAL_PROVIDER_SPEC.defaultModel);
});

test("desktop ignores legacy local-model settings instead of rejecting the update", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y97-remote-"));
  const service = new DesktopService({ appDataPath:root });
  const before = service.settings();
  // local_endpoint/local_model no longer control the production local
  // runtime (the managed inference appliance owns the real endpoint/model),
  // so a legacy client sending them is accepted and the values are ignored
  // rather than validated or persisted.
  const accepted = service.updateSettings({ settings:{ provider:"local", local_endpoint:"http://example.com:11434", local_model:"qwen3.5:9b" } });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.settings.local_endpoint, before.local_endpoint);
  assert.equal(accepted.settings.local_model, before.local_model);
});
