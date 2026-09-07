"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const { CredentialStore } = require("../desktop/credentials");
const { ProviderPool } = require("../tools/ai-provider-pool");
const { createLivingProvider } = require("../tools/ai-living-provider");
const bootstrap = require("../tools/run-bootstrap");

function fixture(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-live-provider-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const credentials = new CredentialStore();
  credentials.set("openai", "fixture-secret-never-log");
  const logs = [];
  const service = new DesktopService({ appDataPath:root, credentials, logger:line => logs.push(line), defaultQ4Scenario:"reference-expedition" });
  service.updateSettings({ settings:{ provider:"openai", input_mode:"natural" } });
  const requests = [];
  service.providerPool.clientFactory = () => ({ responses:{ create:async request => { requests.push(request); return respond(request); } } });
  const world = service.createWorld({ name:"Provider failure regression", seed:"provider-failure" }).world;
  const input = { world_id:world.id, mode:"field-researcher" };
  service.createQ4Personnel({ world_id:world.id, first_name:"Test", last_name:"Lead" });
  assert.equal(service.startSession({ ...input, seed:"provider-failure" }).ok,true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ ...input, action }).ok,true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, radio check." }).ok,true);
  assert.equal(service.submitAction({ ...input, action:"CROSS" }).ok,true);
  return { service, root, input, requests, logs, get run() { return service.session(world.id, input.mode).run; } };
}

for (const [label, error, feedback] of [
  ["authentication", { status:401, code:"invalid_api_key" }, /rejected its saved access key/],
  ["billing", { status:429, code:"credit_balance_exhausted" }, /no available API credit/],
  ["timeout", { name:"AbortError" }, /did not respond in time/],
  ["rate limit", { status:429, code:"rate_limit_exceeded" }, /rate limited/]
]) test(`${label} failure does not execute or save; cooldown retry remains truthful`, async t => {
  const f = fixture(t, () => { throw Object.assign(new Error("fixture-secret-never-log"), error); });
  const before = bootstrap.saveRun(f.run);
  const worldBefore = JSON.stringify(f.service.getWorld(f.input.world_id));
  const diskBefore = fs.readFileSync(f.service.sessionFile(f.input.world_id,f.input.mode), "utf8");
  const command = { ...f.input, text:"Walk toward the open passage.", request_id:`failed-${label}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.service.submitNatural(command);
    assert.equal(result.ok,false);
    assert.equal(result.result.executed,false);
    assert.equal(result.error.provider_failure,true);
    assert.match(result.error.message,feedback);
    assert.match(result.error.message,/no world state changed/);
    assert.deepEqual(bootstrap.saveRun(f.run),before);
    assert.equal(JSON.stringify(f.service.getWorld(f.input.world_id)),worldBefore);
    assert.equal(fs.readFileSync(f.service.sessionFile(f.input.world_id,f.input.mode),"utf8"),diskBefore);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret-never-log/);
  }
  assert.equal(f.requests.length,1,"Cooldown avoids another rejected request");
  assert.equal(f.service.naturalTurnInflight.size,0,"Next input is accepted");
  f.service.updateSettings({ settings:{ provider:"offline" } });
  const offline = await f.service.submitNatural(command);
  assert.equal(offline.result.executed,true);
  assert.equal(f.run.spatial.player_location,"open-passage");
  assert.match(offline.result.language_assistance.message,/no live AI/);
});

test("unconfigured AUTO cannot silently become a successful hosted turn", async t => {
  const f = fixture(t, () => { throw new Error("Should not call"); });
  f.service.providerPool.isConfigured = () => false;
  f.service.updateSettings({ settings:{ provider:"auto" } });
  const before = bootstrap.saveRun(f.run);
  const result = await f.service.submitNatural({ ...f.input,text:"Walk toward the open passage." });
  assert.equal(result.ok,false);
  assert.match(result.error.message,/No usable access key/);
  assert.equal(f.requests.length,0);
  assert.deepEqual(bootstrap.saveRun(f.run),before);
});

test("presentation failure after hosted interpretation preserves committed action and warns outside speech", async t => {
  const base = createLivingProvider();
  const f = fixture(t, async request => {
    if (request.text.format.name.includes("interpretation")) return { id:"fixture-response", output_text:JSON.stringify(await base.interpret(JSON.parse(request.input))) };
    throw Object.assign(new Error("fixture-secret-never-log"), { status:429, code:"credit_balance_exhausted" });
  });
  const command = { ...f.input,text:"Walk toward the open passage.",request_id:"presentation-fails" };
  const result = await f.service.submitNatural(command);
  assert.equal(result.result.executed,true);
  assert.equal(result.result.language_assistance.interpretation_provider,"openai");
  assert.equal(result.result.language_assistance.hosted_interpretation,false,"Injected transport is not live AI proof");
  assert.match(result.result.language_assistance.message,/action was saved/);
  assert.equal(result.result.language_assistance.presentation_fallback,true);
  const restored = new DesktopService({ appDataPath:f.root });
  assert.equal(restored.resumeSession(f.input).ok,true);
  assert.equal(restored.session(f.input.world_id,f.input.mode).run.spatial.player_location,"open-passage");
  assert.equal((await restored.submitNatural(command)).result.duplicate,true);
  assert.equal(f.requests.length,2);
});

test("transport diagnostics correlate the input and safe context without logging secrets or prompts", async t => {
  const previous = process.env.YELLOW_BEAST_TURN_TRACE;
  process.env.YELLOW_BEAST_TURN_TRACE = "1";
  t.after(() => { if (previous === undefined) delete process.env.YELLOW_BEAST_TURN_TRACE; else process.env.YELLOW_BEAST_TURN_TRACE = previous; });
  const f = fixture(t, () => { throw Object.assign(new Error("fixture-secret-never-log"), { status:401,code:"invalid_api_key" }); });
  await f.service.submitNatural({ ...f.input,text:"Walk toward the open passage.",request_id:"trace-correlated" });
  const records = f.logs.map(line => JSON.parse(line));
  const calls = records.filter(item => item.stage === "provider-invocation");
  assert.equal(calls.length,2);
  for (const call of calls) {
    assert.equal(call.request_id,"trace-correlated");
    assert.equal(call.route,"submitNatural/living-turn/living-interpretation");
    assert.match(call.context_sha256,/^[a-f0-9]{64}$/);
    assert.ok(call.context_sections.includes("observer"));
    assert.ok(call.context_sections.includes("local_coworkers"));
    assert.equal(call.hosted_request,false);
  }
  assert.doesNotMatch(f.logs.join("\n"),/fixture-secret-never-log|Walk toward the open passage/);
  assert.ok(records.some(item => item.stage === "turn-result" && item.canonical_mutation === false));
  assert.ok(!records.some(item => item.stage === "canonical-commit"));
});

test("turn-local provider provenance is not overwritten by another concurrent request", async () => {
  const pool = new ProviderPool({ settingsGetter:() => ({ provider:"offline" }) });
  const a = pool.createAutoProvider({ requestId:"a" });
  const b = pool.createAutoProvider({ requestId:"b" });
  const request = { player_text:"walk forward",context:{ sinks:{single_attempt:[{type:"MOVE",target_labels:["forward"]}]} } };
  await Promise.all([a.interpretLiving(request),b.interpretLiving(request)]);
  assert.deepEqual(a.getExecutions().map(item => item.request_id),["a"]);
  assert.deepEqual(b.getExecutions().map(item => item.request_id),["b"]);
});

test("empty and malformed input never invokes a provider or changes reality", async t => {
  const f = fixture(t, () => { throw Error("Must not call"); });
  const before = bootstrap.saveRun(f.run);
  for (const text of [null,{},"", "  ","x".repeat(4001)]) assert.equal((await f.service.submitNatural({ ...f.input,text })).error.code,"ACTION_TEXT_INVALID");
  assert.deepEqual(bootstrap.saveRun(f.run),before);
  assert.equal(f.requests.length,0);
});

test("provider manager stores independent keys and models, reloads metadata, and deletes only the selected key", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"yb-provider-store-"));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  // Simulated OS encryption tests the store contract, not native encryption.
  const safeStorage={ isEncryptionAvailable:()=>true, encryptString:value=>Buffer.from(value.split("").reverse().join("")), decryptString:value=>value.toString().split("").reverse().join("") };
  const make=()=>new DesktopService({appDataPath:root,credentials:new CredentialStore({directory:path.join(root,"credentials"),safeStorage})});
  const service=make();
  for(const [provider,model] of [["openai","openai-fixture-model"],["groq","groq-fixture-model"],["gemini","gemini-fixture-model"]]) {
    assert.equal(service.configureProvider({provider,model,api_key:`fixture-${provider}-secret`,activate:false}).ok,true);
  }
  service.updateSettings({settings:{provider:"auto"}});
  const restored=make(); const entries=restored.getSettings().provider.entries;
  for(const id of ["openai","groq","gemini"]) {
    const entry=entries.find(item=>item.id===id);
    assert.equal(entry.configured,true); assert.equal(entry.persistent,true);
    assert.equal(entry.model,`${id}-fixture-model`);
  }
  assert.doesNotMatch(JSON.stringify(restored.getSettings()),/fixture-(?:groq|gemini|openai)-secret/);
  assert.equal(restored.removeProviderKey({provider:"groq"}).ok,true);
  const again=make();
  assert.equal(again.credentials.configured("groq"),false);
  assert.equal(again.credentials.configured("gemini"),true);
  assert.equal(again.credentials.configured("openai"),true);
  assert.equal(again.settings().provider,"auto");
  for(const provider of ["../openai","unknown"]) {
    assert.equal(again.configureProvider({provider,api_key:"fixture"}).ok,false);
    assert.equal(again.removeProviderKey({provider}).ok,false);
  }
});

test("connection test invokes transport, classifies quota, and leaves expedition saves unchanged",async t=>{
  const f=fixture(t,()=>{throw Object.assign(new Error("fixture-secret-never-log"),{status:429,code:"credit_balance_exhausted"});});
  const before=bootstrap.saveRun(f.run);
  const failed=await f.service.testProvider({provider:"openai",live:true});
  assert.equal(failed.ok,false); assert.match(failed.error.message,/API credit/);
  assert.equal(f.requests.length,1); assert.deepEqual(bootstrap.saveRun(f.run),before);
  assert.match(f.service.providerEntries().find(item=>item.id==="openai").status,/API credit/);
  f.service.providerPool.clientFactory=()=>({responses:{create:async()=>({id:"test-response",output_text:JSON.stringify({status:"proposal",noncanonical:true,attempts:[{actor:{kind:"player"},action:"WAIT"}]})})}});
  const succeeded=await f.service.testProvider({provider:"openai",live:true});
  assert.equal(succeeded.ok,true); assert.equal(succeeded.status,"response-received");
  assert.deepEqual(bootstrap.saveRun(f.run),before);
});
