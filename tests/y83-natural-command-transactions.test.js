"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const { createLivingProvider } = require("../tools/ai-living-provider");
const bootstrap = require("../tools/run-bootstrap");

function field(t, provider = createLivingProvider()) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-command-transaction-"));
  t.after(() => fs.rmSync(appDataPath, { recursive:true, force:true }));
  const service = new DesktopService({ appDataPath, livingTurnProvider:provider, defaultQ4Scenario:"reference-expedition" });
  const world = service.createWorld({ name:"Command transactions", seed:"command-transactions" }).world;
  const input = { world_id:world.id, mode:"field-researcher" };
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Matthew", last_name:"Murphy" }).ok,true);
  assert.equal(service.startSession({ ...input, seed:"command-transactions" }).ok,true);
  for (const action of ["READY","PROCEED","APPROACH","READY"]) assert.equal(service.submitAction({ ...input, action }).ok,true);
  assert.equal(service.submitQ4Communication({ world_id:world.id,channel:"standard",text:"Standard, four accounted for. Radio check." }).ok,true);
  assert.equal(service.submitAction({ ...input, action:"CROSS" }).ok,true);
  return { service, appDataPath, input, get run() { return service.session(world.id,input.mode).run; } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve=done; }); return { promise, resolve }; }

test("retrying an accepted movement, including after reload, never travels twice", async t => {
  const f=field(t); const command={ ...f.input, text:"walk toward the open passage", request_id:"travel-once" };
  assert.equal((await f.service.submitNatural(command)).result?.executed,true);
  assert.equal(f.run.spatial.player_location,"open-passage");
  const committed=bootstrap.saveRun(f.run);
  const duplicate=await f.service.submitNatural(command);
  assert.equal(duplicate.result?.duplicate,true);
  assert.deepEqual(bootstrap.saveRun(f.run),committed);
  const resumed=new DesktopService({ appDataPath:f.appDataPath,livingTurnProvider:createLivingProvider() });
  assert.equal(resumed.resumeSession(f.input).ok,true);
  assert.equal((await resumed.submitNatural(command)).result?.duplicate,true);
  assert.deepEqual(bootstrap.saveRun(resumed.session(f.input.world_id,f.input.mode).run),committed);
  assert.equal((await resumed.submitNatural({ ...command,text:"go back" })).error?.code,"REQUEST_ID_REUSED");
});

test("accepted action is durable while narration is pending; concurrent commands cannot race it", { timeout:15000 }, async t => {
  const entered=deferred(), release=deferred(); let presentations=0;
  const provider=createLivingProvider(); provider.present=async () => { presentations++; entered.resolve(); await release.promise; throw Error("narrator offline"); };
  t.after(() => release.resolve());
  const f=field(t,provider); const command={ ...f.input,text:"walk toward the open passage",request_id:"pending-presentation" };
  const first=f.service.submitNatural(command); await entered.promise;
  const retry=f.service.submitNatural(command);
  assert.equal((await f.service.submitNatural({ ...command,request_id:"other" })).error?.code,"SESSION_BUSY");
  assert.equal(f.service.submitAction({ ...f.input,action:"MOVE",target:"utility-room" }).error?.code,"SESSION_BUSY");
  assert.equal(f.service.submitQ4Communication({ world_id:f.input.world_id,channel:"local",text:"Everyone good?" }).error?.code,"SESSION_BUSY");
  const next=new DesktopService({ appDataPath:f.appDataPath,livingTurnProvider:createLivingProvider() });
  assert.equal(next.resumeSession(f.input).ok,true);
  assert.equal(next.session(f.input.world_id,f.input.mode).run.spatial.player_location,"open-passage");
  assert.equal((await next.submitNatural(command)).result?.duplicate,true);
  release.resolve(); const [result,repeated]=await Promise.all([first,retry]);
  assert.deepEqual(result,repeated); assert.equal(result.result?.executed,true); assert.equal(presentations,1);
  assert.equal(result.result?.scene.narration_source,"deterministic-fallback");
});

test("a failed canonical save rolls the attempted movement back and permits a deliberate retry", async t => {
  const f=field(t); const before=bootstrap.saveRun(f.run);
  const disk=fs.readFileSync(f.service.sessionFile(f.input.world_id,f.input.mode),"utf8");
  const commit=f.service.commitPersistencePair;
  f.service.commitPersistencePair=() => { throw Error("injected storage failure"); };
  const command={ ...f.input,text:"walk toward the open passage",request_id:"storage-retry" };
  assert.equal((await f.service.submitNatural(command)).error?.code,"PERSISTENCE_COMMIT_FAILED");
  assert.deepEqual(bootstrap.saveRun(f.run),before);
  assert.equal(fs.readFileSync(f.service.sessionFile(f.input.world_id,f.input.mode),"utf8"),disk);
  f.service.commitPersistencePair=commit;
  assert.equal((await f.service.submitNatural(command)).result?.executed,true);
});

test("natural return updates the operational phase and retains physical return requirements", async t => {
  const f=field(t);
  const result=await f.service.submitNatural({ ...f.input,text:"let's head back" });
  assert.equal(result.result?.executed,true);
  assert.equal(f.service.session(f.input.world_id,f.input.mode).phase.phase_id,"RETURN");
  assert.equal(f.run.spatial.player_location,"utility-room");
  assert.equal(f.service.submitAction({ ...f.input,action:"COMPLETE_RETURN" }).ok,false);
  assert.equal((await f.service.submitNatural({ ...f.input,text:"go back" })).result?.executed,true);
  assert.equal(f.run.spatial.player_location,"threshold-side-entry");
  const returned=f.service.submitAction({ ...f.input,action:"COMPLETE_RETURN" });
  assert.equal(returned.ok,true,JSON.stringify(returned.error));
  assert.equal(f.service.session(f.input.world_id,f.input.mode).phase.phase_id,"REPORT");
});

test("equipment nouns and unsupported directions cannot authorize unrelated actions", async t => {
  const f=field(t); const original=bootstrap.saveRun(f.run);
  const wrongCustody=await f.service.submitNatural({ ...f.input,text:"give Beverly the camera" });
  assert.equal(wrongCustody.error?.code,"ITEM_NOT_IN_CUSTODY");
  assert.deepEqual(bootstrap.saveRun(f.run),original);
  for (const text of ["take the left passage","go check that","camera","take a picture"]) {
    const result=await f.service.submitNatural({ ...f.input,text });
    assert.equal(result.result?.executed,false,text);
    assert.deepEqual(bootstrap.saveRun(f.run),original,text);
  }
  const received=await f.service.submitNatural({ ...f.input,text:"hand me the survey instrument" });
  assert.equal(received.result?.executed,true);
  assert.equal(f.run.expedition.equipment["survey-instrument"].holder,f.run.session.startup.player.observer_id);
  const before=bootstrap.saveRun(f.run);
  assert.equal((await f.service.submitNatural({ ...f.input,text:"hand me the survey instrument" })).error?.code,"ITEM_ALREADY_HELD");
  assert.deepEqual(bootstrap.saveRun(f.run),before);
});
