'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const WS=require('../tools/dialogue-reader-labeling-workstation'),X=require('../tools/dialogue-reader-exception-workstation');
const full=WS.loadWorkstation({});const q=X.buildQueue(full);const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'reader-exception-test-'));
const pure=WS.CLIENT_HTML.slice(WS.CLIENT_HTML.indexOf('/*PURE-BEGIN*/'),WS.CLIENT_HTML.indexOf('/*PURE-END*/'));
const UI=new Function(pure+';return {blank,chooseOutcome,collectDraft};')();
const draft=()=>{const d=UI.blank();UI.chooseOutcome(d,'ACCEPT');d.exception_parts='1';Object.assign(d.easy.acts[0],{speech:'ask',facet:'identity',addr:'none',rel:'new'});return d;};
test('queue exactly excludes 412 valid rows; deterministic batches and observer-only payload',()=>{
 assert.equal(q.items.length,62);assert.deepEqual(q.counts,{address:20,force:19,relation:8,facet:2,full:12,policy:1});assert.deepEqual(X.buildQueue(full).items.map(x=>x.id),q.items.map(x=>x.id));
 const mode=X.makeMode(full,q,{choicesDir:temp()});for(const i of q.items){const p=mode.item(WS.itemPayload(mode.ws,i.id));assert.equal(p.human_choices.draft,null);assert.equal(p.label,null);assert.ok(!JSON.stringify(p).includes('observer_errors'));assert.ok(!JSON.stringify(p).includes('candidate'));}
 const parked=full.items.find(x=>!q.items.some(i=>i.id===x.id));assert.throws(()=>mode.post('/api/choice',{id:parked.id,explicit:true,revision:0,draft:draft()}),/not unresolved/);
});
test('explicit choices atomic resume, stale protection, undo history and failed writes',()=>{
 const dir=temp(),m=X.makeMode(full,q,{choicesDir:dir}),id=q.items[0].id,d=draft();
 assert.throws(()=>m.post('/api/choice',{id,revision:0,draft:d}),/explicit/);
 m.post('/api/choice',{id,explicit:true,revision:0,draft:d});const changed=structuredClone(d);changed.easy.acts[0].facet='role';m.post('/api/choice',{id,explicit:true,revision:1,draft:changed});
 assert.throws(()=>m.post('/api/choice',{id,explicit:true,revision:1,draft:d}),/changed/);
 assert.equal(m.post('/api/undo',{id,explicit:true,revision:2}).draft.easy.acts[0].facet,'identity');
 assert.equal(X.makeMode(full,q,{choicesDir:dir}).choices.get(id).revision,3);
 const bytes=fs.readFileSync(m.choices.file);const old=WS.atomicWrite;WS.atomicWrite=()=>{throw Error('simulated pre-rename failure');};try{assert.throws(()=>m.post('/api/choice',{id,explicit:true,revision:3,draft:d}),/simulated/);}finally{WS.atomicWrite=old;}
 assert.deepEqual(fs.readFileSync(m.choices.file),bytes);assert.equal(m.choices.get(id).revision,3);
});
test('policy isolated and defer remains pending; no primary row is written',()=>{
 const m=X.makeMode(full,q,{choicesDir:temp()}),id=X.POLICY;assert.throws(()=>m.post('/api/check',{id,draft:{}}),/policy decision/);
 m.post('/api/policy',{id,explicit:true,revision:0,decision:'defer'});assert.equal(m.state().remaining,62);
 m.post('/api/policy',{id,explicit:true,revision:1,decision:'spoken_address_separate'});assert.equal(m.state().remaining,61);assert.equal(m.state().primary_committed,0);assert.equal(m.choices.get(id).policy.human_gold,false);assert.equal(m.ws.labels.length,full.labels.length);
});
test('primary submit uses saved human form, existing validator and preserves earlier human rows',()=>{
 const dir=temp();for(const name of [WS.FILES.worksheet,WS.FILES.pack,WS.FILES.labels])if(fs.existsSync(path.join(full.dir,name)))fs.copyFileSync(path.join(full.dir,name),path.join(dir,name));
 const local=WS.loadWorkstation({dir}),m=X.makeMode(local,q,{choicesDir:path.join(dir,'choices')}),id=q.items[0].id,d=draft();
 m.post('/api/choice',{id,explicit:true,revision:0,draft:d});const row=UI.collectDraft(d);assert.equal(WS.check(m.ws,id,row).ok,true);
 assert.throws(()=>m.post('/api/commit',{id,explicit:true,choice_revision:0,human_form:d,draft:row}),/differs/);
 m.post('/api/commit',{id,explicit:true,choice_revision:1,human_form:d,draft:row});assert.equal(m.ws.labelsById.get(id).label_state,'HUMAN_PRIMARY');for(const old of full.labels)assert.deepEqual(m.ws.labelsById.get(old.id),old);
 assert.deepEqual(m.choices.events.map(x=>x.kind),['choice','commit_intent','primary_committed']);
});
test('extension JS compiles, blank defaults and held/stale key protection retained',()=>{
 const html=X.exceptionPage();new vm.Script(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);assert.ok(html.includes('held.has(key)||e.repeat'));assert.ok(html.includes('S.item.id!==id||!S.check?.ok'));assert.ok(html.includes('choice_revision:revision'));assert.ok(html.includes('if(!draftOf().outcome)return'));assert.equal(UI.blank().outcome,null);assert.ok(!UI.blank().easy.acts[0].addr);assert.ok(!html.includes('window.confirm('));
});
test('loopback HTTP exception hooks retain authentication and queue-only scope',async()=>{
 const m=X.makeMode(full,q,{choicesDir:temp()}),server=WS.createWorkstationServer(m.ws,{port:0,interfaceMode:m}),started=await server.listen();
 try{const page=await fetch(started.url).then(r=>r.text()),token=page.match(/name="ws-token" content="([^"]+)"/)[1];
 const headers={'x-ws-token':token};assert.equal((await fetch(started.url+'api/state')).status,403);
 const state=await fetch(started.url+'api/state',{headers}).then(r=>r.json());assert.equal(state.total,62);assert.equal(state.parked_machine_valid,412);
 const response=await fetch(started.url+'api/item?n=63',{headers});assert.notEqual(response.status,200);
 }finally{await new Promise(r=>server.server.close(r));}
});
