'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const WS=require('../tools/dialogue-reader-labeling-workstation'),X=require('../tools/dialogue-reader-exception-workstation');
const full=WS.loadWorkstation({});const q=X.buildQueue(full);const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'reader-exception-test-'));
const pure=WS.CLIENT_HTML.slice(WS.CLIENT_HTML.indexOf('/*PURE-BEGIN*/'),WS.CLIENT_HTML.indexOf('/*PURE-END*/'));
const UI=new Function(pure+';return {blank,chooseOutcome,collectDraft};')();
const draft=()=>{const d=UI.blank();UI.chooseOutcome(d,'ACCEPT');d.exception_parts='1';Object.assign(d.easy.acts[0],{speech:'ask',facet:'identity',addr:'none',rel:'new'});return d;};
test('queue exactly excludes 412 valid rows; deterministic batches and observer-only payload',()=>{
 assert.equal(q.items.length,10);assert.deepEqual(q.counts,{address:0,force:0,relation:0,facet:0,full:9,policy:1});assert.deepEqual(X.buildQueue(full).items.map(x=>x.id),q.items.map(x=>x.id));
 const mode=X.makeMode(full,q,{choicesDir:temp()});for(const i of q.items){const p=mode.item(WS.itemPayload(mode.ws,i.id));assert.equal(p.human_choices.draft,null);assert.deepEqual(p.label,WS.itemPayload(mode.ws,i.id).label);assert.ok(!JSON.stringify(p).includes('observer_errors'));assert.ok(!JSON.stringify(p).includes('candidate'));}
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
 const m=X.makeMode(full,q,{choicesDir:temp()}),id=X.POLICY,remaining=m.state().remaining;assert.throws(()=>m.post('/api/check',{id,draft:{}}),/policy decision/);
 m.post('/api/policy',{id,explicit:true,revision:0,decision:'defer'});assert.equal(m.state().remaining,remaining);
 m.post('/api/policy',{id,explicit:true,revision:1,decision:'spoken_address_separate'});assert.equal(m.state().remaining,remaining-1);assert.equal(m.state().primary_committed,WS.summary(m.ws).committed);assert.equal(m.choices.get(id).policy.human_gold,false);assert.equal(m.ws.labels.length,full.labels.length);
});
test('primary submit uses saved human form, existing validator and preserves earlier human rows',()=>{
 const dir=temp();for(const name of [WS.FILES.worksheet,WS.FILES.pack,WS.FILES.labels])if(fs.existsSync(path.join(full.dir,name)))fs.copyFileSync(path.join(full.dir,name),path.join(dir,name));
 const local=WS.loadWorkstation({dir}),m=X.makeMode(local,q,{choicesDir:path.join(dir,'choices')}),id=q.items.find(i=>WS.check(m.ws,i.id,UI.collectDraft(draft())).ok).id,d=draft();
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
 const state=await fetch(started.url+'api/state',{headers}).then(r=>r.json());assert.equal(state.total,10);assert.equal(state.parked_machine_valid,412);
 const response=await fetch(started.url+'api/item?n=11',{headers});assert.notEqual(response.status,200);
 }finally{await new Promise(r=>server.server.close(r));}
});

test('old out-of-scope history is preserved and excluded from resume and progress',()=>{
 const dir=temp(),file=path.join(dir,'human-exception-choices.jsonl');
 const original=Buffer.from(fs.readFileSync(path.join(full.dir,'exception-work','human-exception-choices.jsonl'),'utf8').split('\n').filter(line=>line&&JSON.parse(line).id==='rg-00d773c28a1704af').join('\n')+'\n');
 fs.writeFileSync(file,original);const m=X.makeMode(full,q,{choicesDir:dir});
 assert.equal(m.choices.events.length,14);assert.equal(m.choices.get('rg-00d773c28a1704af'),null);
 assert.equal(m.state().committed,WS.summary(m.ws).committed);assert.equal(m.state().remaining,10-WS.summary(m.ws).committed);
 for(const i of q.items)assert.equal(m.item(WS.itemPayload(m.ws,i.id)).human_choices.draft,null);
 assert.deepEqual(fs.readFileSync(file),original);
 m.post('/api/choice',{id:q.items[0].id,explicit:true,revision:0,draft:draft()});
 assert.ok(fs.readFileSync(file).subarray(0,original.length).equals(original));
 assert.equal(X.makeMode(full,q,{choicesDir:dir}).choices.get(q.items[0].id).revision,1);
});
test('final ordinary scope agrees with selected validation attempts and leaks no semantic hints',()=>{
 const run=path.join(path.dirname(full.dir),'reader-phase2-blind-model-run-2026-10-05T02-27-43-090Z');
 const rows=fs.readFileSync(path.join(run,'final-annotations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(q.items.filter(x=>x.id!==X.POLICY).map(x=>x.id),rows.filter(x=>!x.mechanically_valid).map(x=>x.id).sort());
 for(const r of rows.filter(x=>x.mechanically_valid))assert.ok(!q.items.some(x=>x.id===r.id));
 assert.ok(q.items.filter(x=>x.id!==X.POLICY).every(x=>x.batch==='full'));
});

test('second-person contractions license address in frozen inputs without changing their bytes',()=>{
 const wires='ask beeninside you new f=yn t=ever r=e1>r1 ; repair ? - fix:s0 at=6 r=e1>r1 rk=what';
 for(const id of ['rg-f95fad9ce8faba79','rg-fce6af0e2871cec7']){
  const i=full.byId.get(id),before=JSON.stringify(i.input);
  assert.deepEqual(i.input.features.second_person,[]);
  assert.equal(WS.check(full,id,{outcome:'ACCEPT',wire:wires}).ok,true);
  assert.equal(JSON.stringify(i.input),before);
 }
});
test('fresh contraction features and frozen fallback remain bounded to the act',()=>{
 const I=require('../tools/dialogue-reader-input'),F=require('../tools/dialogue-reader-frame'),Wire=require('../tools/dialogue-reader-wire');
 for(const word of ["you've","you're","you'll","you'd",'youve','you’re']){
  const {input}=I.buildReaderInput({raw:word+' been inside?',present:[],entities:[]});
  assert.deepEqual(input.features.second_person,[0],word);
 }
 const source=structuredClone(full.byId.get('rg-f95fad9ce8faba79').input);
 source.line.tokens[1].text='they\'ve';
 const absent=Wire.decodeWire('ask beeninside you new f=yn t=ever r=e1>r1',source);
 assert.equal(absent.ok,true);assert.ok(F.validateReaderFrame(absent.frame,source).layers.V2.errors.some(e=>e.code==='second_person_without_evidence'));
 const scoped=Wire.decodeWire('ack - - new ; ask beeninside you new at=6 f=yn r=e1>r1',full.byId.get('rg-f95fad9ce8faba79').input);
 assert.equal(scoped.ok,true);assert.ok(F.validateReaderFrame(scoped.frame,full.byId.get('rg-f95fad9ce8faba79').input).layers.V2.errors.some(e=>e.code==='second_person_without_evidence'&&e.act===1));
});
