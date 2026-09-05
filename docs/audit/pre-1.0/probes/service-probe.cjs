"use strict";
// Supporting forensic probe, not a replacement for the governed test tiers.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const root = path.resolve(__dirname, "../../../..");
const { DesktopService } = require(path.join(root, "desktop/service"));
const { createLivingProvider } = require(path.join(root, "tools/ai-living-provider"));
const bootstrap = require(path.join(root, "tools/run-bootstrap"));
const projections = require(path.join(root, "tools/live-scene-projection"));
const ledger = require(path.join(root, "tools/canonical-world-ledger"));
const mode = "field-researcher";
const clone = structuredClone;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(seed = "astra-audit", options = {}) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-astra-service-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition", livingTurnProvider: createLivingProvider(), ...options });
  const world = service.createWorld({ name: "Astra forensic audit", seed }).world;
  const input = { world_id: world.id, mode };
  const record = [];
  function step(action, target) {
    const result = service.submitAction({ ...input, action, target });
    record.push({ action, target, ok: result.ok, error: result.error });
    if (!result.ok) throw Error(JSON.stringify(record));
    return result;
  }
  service.createQ4Personnel({ world_id:world.id, first_name:"Matthew", last_name:"Murphy" });
  service.confirmQ4Personnel({ world_id:world.id });
  const start = service.startSession({ ...input, seed, require_personnel:true, scenario:"reference-expedition" });
  if (!start.ok) throw Error(JSON.stringify(start));
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) step(action);
  const radio = service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, four accounted for. Radio check." });
  if (!radio.ok) throw Error(JSON.stringify(radio));
  step("CROSS");
  return { service, world, input, appDataPath, step, get run() { return service.session(world.id, mode).run; } };
}
function state(f) {
  const r = f.run;
  return { phase:f.service.session(f.world.id, mode).phase?.phase_id, lifecycle:r.lifecycle, location:r.spatial?.player_location,
    locations:clone(r.spatial?.personnel_locations), clock:clone(r.expedition?.clock), evidence:clone(r.expedition?.evidence),
    objects:clone(r.object_state), equipment:clone(r.expedition?.equipment), logistics:clone(r.expedition?.logistics),
    team:clone(r.expedition?.team), causal:clone(r.causal_ledger ?? []), routes:clone(r.spatial?.route_history),
    event_count:r.session?.events?.length, world_events:r._world?.history?.events?.length };
}
function delta(before, after) {
  return { changed:Object.keys(before).filter(k => !isDeepStrictEqual(before[k], after[k])),
    from:before.location, to:after.location, intervals:(after.clock?.interval ?? 0)-(before.clock?.interval ?? 0),
    evidence:after.evidence.length-before.evidence.length, causal:after.causal.length-before.causal.length };
}
function publicResult(result) {
  return { ok:result.ok, error:result.error, status:result.result?.turn_status, executed:result.result?.executed,
    outcome:result.result?.outcome, summary:result.result?.summary ?? result.result?.public_reason,
    interpretation:result.result?.living_turn, phase:result.projection?.phase };
}
async function language() {
  const phrases = ["go forward", "head down the hall", "let's keep moving", "go back", "return to the previous room", "take the left passage", "head toward the Threshold", "look around", "check the walls", "look at the ceiling", "inspect that fixture", "what's over there", "take a closer look", "give Beverly the camera", "hand me the survey instrument", "check my lamp", "take a picture", "get a reading", "pass Santiago the radio", "Santiago stay here", "Beverly come with me", "everybody hold up", "follow me", "go check that", "wait here", "regroup", "hey Beverly, what do you think?", "everyone good?", "Standard, radio check", "tell Standard what we found", "let's head back", "take us home", "back to the Threshold", "we're done here"];
  const results = [];
  for (const text of phrases) {
    const f = fixture("astra-language-corpus");
    const before = state(f);
    const result = await f.service.submitNatural({ ...f.input, text });
    results.push({ text, result:publicResult(result), delta:delta(before,state(f)) });
  }
  return results;
}
async function equipment() {
  const cases = [
    ["photo while Beverly holds camera", "PHOTOGRAPH", "fluorescent fixture"],
    ["measure in wrong room", "USE", "survey-instrument"],
    ["take camera from Beverly", "TRANSFER", "recording-device|personnel-beverly-bell"],
    ["transfer nonexistent item", "TRANSFER", "nonexistent-camera|personnel-beverly-bell"],
  ];
  return cases.map(([name, action, target]) => {
    const f = fixture("astra-equipment"); const before = state(f);
    const result = f.service.submitAction({ ...f.input, action, target });
    return { name, request:{action,target}, holders:Object.fromEntries(Object.entries(before.equipment).map(([k,v])=>[k,v.holder])), result:publicResult(result), delta:delta(before,state(f)), evidence:f.run.expedition.evidence };
  });
}
async function retries() {
  const f = fixture("astra-repeat"); const before = state(f);
  const request = { ...f.input, text:"take a picture", request_id:"astra-identical-request" };
  const first = await f.service.submitNatural(request); const middle = state(f);
  const second = await f.service.submitNatural(request); const after = state(f);
  const g = fixture("astra-concurrent"); const beforeConcurrent=state(g);
  const parallel = await Promise.all([g.service.submitNatural({ ...g.input, text:"Santiago stay here", request_id:"astra-race-1" }),g.service.submitNatural({ ...g.input, text:"Santiago stay here", request_id:"astra-race-2" })]);
  return { sequential:{first:publicResult(first),second:publicResult(second),first_delta:delta(before,middle),second_delta:delta(middle,after)}, concurrent:{results:parallel.map(publicResult),delta:delta(beforeConcurrent,state(g))} };
}
async function continuity() {
  const f=fixture("astra-continuity");
  const crew=f.run.expedition.team.members.map(m=>({id:m.personnel_id,name:m.first_name,role:m.role}));
  const santiago=crew.find(m=>m.name==="Santiago");
  const beverly=crew.find(m=>m.name==="Beverly");
  const trace=[];
  const act=(action,target)=> { const before=state(f); const result=f.service.submitAction({...f.input,action,target});trace.push({action,target,result:publicResult(result),delta:delta(before,state(f))});return result; };
  act("ORDER_HOLD",santiago.id); act("MOVE","open-passage"); act("USE","survey-instrument");
  const separated=state(f);
  const shell={};
  for(const m of crew) shell[m.id]=projections.projectObserverState(f.run,m.id,"audit");
  const standard=ledger.getStandardKnowledge(f.run);
  const remoteTalk=f.service.submitQ4Communication({world_id:f.world.id,channel:"local",target:"Santiago",text:"Santiago, what do you see?"});
  const beforeSave=bootstrap.saveRun(f.run); f.service.shutdown();
  const next=new DesktopService({appDataPath:f.appDataPath,defaultQ4Scenario:"reference-expedition",livingTurnProvider:createLivingProvider()});
  const resumed=next.resumeSession(f.input); const nextRun=next.session(f.world.id,mode)?.run;
  const afterSave=nextRun?bootstrap.saveRun(nextRun):null;
  const firstDrift=afterSave?Object.keys(beforeSave).filter(k=>!isDeepStrictEqual(beforeSave[k],afterSave[k])):[];
  next.shutdown();
  const third=new DesktopService({appDataPath:f.appDataPath,defaultQ4Scenario:"reference-expedition",livingTurnProvider:createLivingProvider()});
  const resumed2=third.resumeSession(f.input); const thirdRun=third.session(f.world.id,mode)?.run;
  return { appDataPath:f.appDataPath,crew,trace,separated,shell,standard,remoteTalk:publicResult(remoteTalk),reload:{ok:resumed.ok,error:resumed.error,equal:isDeepStrictEqual(beforeSave,afterSave),changed:firstDrift,before:digest(beforeSave),after:digest(afterSave),second_ok:resumed2.ok,second_equal:isDeepStrictEqual(afterSave,thirdRun?bootstrap.saveRun(thirdRun):null)},invariants:ledger.validateInvariants(f.run) };
}
async function main() {
  const name=process.argv[2]??"all";
  const report={ source_head:require("node:child_process").execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), at:new Date().toISOString(),label:name };
  for(const [key,fn] of Object.entries({language,equipment,retries,continuity})) if(name==="all"||name===key) { try { report[key]=await fn(); } catch(error) {report[key]={probe_error:error.stack};} }
  process.stdout.write(JSON.stringify(report,null,2)+"\n");
}
if(require.main===module) main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture,state,delta,publicResult,root,mode};
