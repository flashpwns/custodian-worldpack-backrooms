#!/usr/bin/env node
'use strict';
// Blind, exception-only HUMAN_PRIMARY collection. No model transport and no mixed-provenance label writer.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const WS=require('./dialogue-reader-labeling-workstation');
const RECOVERY='machine-run-recovery-2026-10-03T11-02-35-398Z';
const BLIND_RUN='reader-phase2-blind-model-run-2026-10-05T02-27-43-090Z';
const POLICY='rg-f28a6267643a2772';
const BATCHES={address:'Address',force:'Speech force / clause split',relation:'Relation',facet:'Facet / referent',full:'Full Easy',policy:'Contract policy'};
const ORDER=Object.keys(BATCHES);
const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function batch(input,errors,id){
 if(id===POLICY)return 'policy';
 const fields=new Set(errors.map(e=>e.field).filter(Boolean));
 if(errors.some(e=>e.layer==='V0'))return 'force';
 if(fields.size!==1)return 'full';
 if(fields.has('speech_act'))return (input.line.tokens.length<=6?'full':'force');
 if(fields.has('address')){
  if(errors.some(e=>e.code==='addressee_not_present')||input.line.tokens.some(t=>/^you['’]/i.test(t.text)))return 'full';
  return 'address';
 }
 if(fields.has('relation'))return 'relation';
 if(fields.has('referent')||fields.has('facet'))return 'facet';
 return 'full';
}
function buildQueue(ws,{history=WS.DEFAULT_DIR}={}){
 const file=path.join(history,RECOVERY,'final-labels.jsonl'),rows=read(file);
 if(rows.length!==474||new Set(rows.map(x=>x.id)).size!==474||rows.filter(x=>x.candidate.valid).length!==412)throw Error('Expected frozen 474 population with 412 valid machine rows');
 const byId=new Map(ws.items.map(x=>[x.id,x]));
 for(const r of rows){const i=byId.get(r.id);if(!i||i.render_digest!==r.render_digest||i.integrity.length)throw Error('Frozen queue binding failed: '+r.id);}
 // Read provenance server-side only. Never attach answers, errors or semantic batch hints to items.
 const run=path.join(path.dirname(history),BLIND_RUN);
 const summary=JSON.parse(fs.readFileSync(path.join(run,'summary.json'),'utf8'));
 const annotations=read(path.join(run,'final-annotations.jsonl'));
 const first=JSON.parse(fs.readFileSync(path.join(run,'validation-attempt1.json'),'utf8')).results;
 const retry=JSON.parse(fs.readFileSync(path.join(run,'validation-retry-attempt2.json'),'utf8')).results;
 const validated=new Map([...first,...retry].map(x=>[x.id,x]));
 const unresolved=new Set(rows.filter(r=>!r.candidate.valid).map(r=>r.id));
 if(summary.final.mechanically_valid!==52||summary.final.by_status.MODEL_INVALID!==9||
    !summary.scope.policy_case_excluded.startsWith(POLICY+' ')||annotations.length!==61||
    new Set(annotations.map(x=>x.id)).size!==61||validated.size!==61)throw Error('Blind run scope differs');
 for(const r of annotations){
  const i=byId.get(r.id),v=validated.get(r.id);
  if(!unresolved.has(r.id)||r.id===POLICY||!i||r.render_digest!==i.render_digest||r.human_gold!==false||
     typeof r.mechanically_valid!=='boolean'||!v||r.mechanically_valid!==(v.status==='MECHANICALLY_VALID')||
     (r.annotation_status==='MODEL_INVALID')===r.mechanically_valid)throw Error('Blind run validation binding failed: '+r.id);
 }
 if(annotations.filter(r=>r.mechanically_valid).length!==52)throw Error('Expected 52 parked Opus candidates');
 const selected=annotations.filter(r=>!r.mechanically_valid).map(r=>({...byId.get(r.id),batch:'full'}));
 selected.push({...byId.get(POLICY),batch:'policy'});
 if(selected.length!==10||!unresolved.has(POLICY))throw Error('Expected nine ordinary items and one policy case');
 const policy=selected.find(x=>x.id===POLICY);if(!policy||policy.input.chip_target!=='p2'||!policy.input.features.name_spans.some(x=>x.person==='p3'))throw Error('Policy case observer binding differs');
 selected.sort((a,b)=>ORDER.indexOf(a.batch)-ORDER.indexOf(b.batch)||a.id.localeCompare(b.id));
 const counts=Object.fromEntries(ORDER.map(k=>[k,selected.filter(x=>x.batch===k).length]));
 const indices={};const items=selected.map((x,k)=>({...x,n:k+1,batch_index:(indices[x.batch]=(indices[x.batch]??0)+1),batch_total:counts[x.batch]}));
 return {items,counts,source_file:file,source_sha256:hash(fs.readFileSync(file)),parked:412};
}
const DRAFT_KEYS=['outcome','wire','field','slot','note','notes','mode','ecPart','easy','exception_parts','exception_ref_done'];
const ACT_KEYS=['speech','facet','addr','names','rel','target','start','qform','pol','time','respm','refc','refspan','subj','subjnames','ia','iaopt','rk','ab','extra'];
function cleanDraft(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!DRAFT_KEYS.includes(k)))throw new WS.WorkstationError(400,'bad_choice','Only explicit human form choices are accepted');
 if(!['easy','raw'].includes(d.mode)||!d.easy||!Array.isArray(d.easy.acts)||d.easy.acts.length<1||d.easy.acts.length>3)throw new WS.WorkstationError(400,'bad_choice','Invalid form');
 for(const a of d.easy.acts){if(Object.keys(a).some(k=>!ACT_KEYS.includes(k)))throw new WS.WorkstationError(400,'bad_choice','Unexpected act field');for(const[k,v]of Object.entries(a)){if(['names','subjnames','ab'].includes(k)){if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||x.length>80))throw Error('Invalid choice list');}else if(typeof v!=='string'||v.length>2000)throw Error('Invalid choice text');}}
 if(JSON.stringify(d).length>16000)throw Error('Choice too large');
 return JSON.parse(JSON.stringify(d));
}
class Choices{
 constructor(dir,{labeler,queue}){this.file=path.join(dir,'human-exception-choices.jsonl');this.labeler=labeler;this.queue=new Set(queue.items.map(x=>x.id));this.bytes=fs.existsSync(this.file)?fs.readFileSync(this.file,'utf8'):'';this.events=read(this.file);this.current=new Map();for(const e of this.events){if(e.labeler!==labeler||!e.revision||!['choice','undo','commit_intent','primary_committed','policy','defer'].includes(e.kind))throw Error('Exception choice history drift');const previous=this.current.get(e.id);if(e.revision!==(previous?.revision??0)+1)throw Error('Nonsequential choice history');this.current.set(e.id,e);}}
 get(id){return this.queue.has(id)?this.current.get(id)??null:null;}
 write(id,kind,payload,revision){if(!this.queue.has(id))throw new WS.WorkstationError(404,'not_in_exception_queue','This item is parked outside the exception queue');const previous=this.get(id);if(revision!==(previous?.revision??0))throw new WS.WorkstationError(409,'stale_choice','The saved human choices changed; reload before deciding');const e={kind,id,labeler:this.labeler,revision:revision+1,created_at:new Date().toISOString(),provenance:'EXPLICIT_HUMAN_WORK_IN_PROGRESS_NOT_GOLD',...payload};const bytes=this.bytes+(this.bytes&&!this.bytes.endsWith('\n')?'\n':'')+JSON.stringify(e)+'\n';WS.atomicWrite(this.file,bytes);this.bytes=bytes;this.events.push(e);this.current.set(id,e);return e;}
}
function makeMode(full,queue,{choicesDir=path.join(full.dir,'exception-work'),scratch=false}={}){
 const ws={...full,items:queue.items,byId:new Map(queue.items.map(x=>[x.id,x]))};
 const choices=new Choices(choicesDir,{labeler:ws.labeler,queue});
 const state=()=>{const s=WS.summary(ws);s.batches=queue.counts;s.parked_machine_valid=412;s.mode='exceptions';s.synthetic=scratch;s.primary_committed=s.committed;s.deferred=0;s.policy_recorded=!!choices.get(POLICY)?.policy;
 s.order=s.order.map(x=>{const saved=choices.get(x.id);return {...x,batch:ws.byId.get(x.id).batch,...(x.id===POLICY&&saved?.policy?{state:saved.policy.decision==='defer'?'deferred':'committed'}:saved?.kind==='defer'?{state:'deferred'}:{})};});
 s.committed=s.order.filter(x=>x.state==='committed').length;s.remaining=queue.items.length-s.committed;s.deferred=s.order.filter(x=>x.state==='deferred').length;return s;};
 const item=p=>{const i=ws.byId.get(p.id),own=choices.get(p.id);return {...p,batch:{key:i.batch,title:BATCHES[i.batch],index:i.batch_index,total:i.batch_total},policy:p.id===POLICY,human_choices:own?{revision:own.revision,draft:own.draft??null,policy:own.policy??null,deferred:own.kind==='defer'}:{revision:0,draft:null,policy:null,deferred:false},synthetic:scratch};};
 const failPolicy=id=>{if(id===POLICY)throw new WS.WorkstationError(409,'policy_not_a_label','This is a policy decision, not an ordinary label');};
 const post=(route,b)=>{
  const id=String(b.id??'');if(!ws.byId.has(id))throw new WS.WorkstationError(404,'not_in_exception_queue','This item is not unresolved');
  if(b.explicit!==true&&route!=='/api/check')throw new WS.WorkstationError(400,'not_explicit','An explicit human action is required');
  if(route==='/api/check'){failPolicy(id);return WS.check(ws,id,b.draft??{});}
  if(route==='/api/choice'){failPolicy(id);const d=cleanDraft(b.draft);return {revision:choices.write(id,'choice',{draft:d,step:String(b.step??''),previous_draft:choices.get(id)?.draft??null},b.revision).revision};}
  if(route==='/api/undo'){failPolicy(id);const old=choices.get(id);const undone=new Set(choices.events.filter(e=>e.id===id&&e.kind==='undo').map(e=>e.undone_revision));const previous=[...choices.events].reverse().find(e=>e.id===id&&e.kind==='choice'&&!undone.has(e.revision)&&JSON.stringify(e.draft)!==JSON.stringify(e.previous_draft));if(!previous?.previous_draft)throw new WS.WorkstationError(409,'nothing_to_undo','No previous choice on this item');const e=choices.write(id,'undo',{draft:previous.previous_draft,undone_revision:previous.revision,previous_draft:old?.draft??null},b.revision);return {revision:e.revision,draft:e.draft};}
  if(route==='/api/defer'){failPolicy(id);return {revision:choices.write(id,'defer',{draft:cleanDraft(b.draft),reason:String(b.reason??'Human judgment retained for later validation/adjudication')},b.revision).revision,summary:state()};}
  if(route==='/api/policy'){
   if(id!==POLICY||!['spoken_address_separate','delivery_controls_address','defer'].includes(b.decision))throw new WS.WorkstationError(400,'bad_policy','Choose an explicit policy option');
   const e=choices.write(id,'policy',{policy:{decision:b.decision,note:String(b.note??'').slice(0,4000),implementation_status:'RECORDED_ONLY_NO_VALIDATOR_OR_CONTRACT_CHANGE',human_gold:false}},b.revision);return {revision:e.revision,summary:state()};
  }
  if(route==='/api/commit'){
   failPolicy(id);const own=choices.get(id);if(!own||b.choice_revision!==own.revision||JSON.stringify(cleanDraft(b.human_form))!==JSON.stringify(own.draft))throw new WS.WorkstationError(409,'stale_choice','Submission differs from the saved explicit human choices');
   const check=WS.check(ws,id,b.draft??{});if(!check.ok)throw new WS.WorkstationError(422,'invalid_draft','Your choices are saved, but validation blocks this primary label',{problems:check.problems});
   const intent=choices.write(id,'commit_intent',{draft:own.draft,previous_row:ws.labelsById.get(id)??null},own.revision);
   const r=WS.commit(ws,id,b.draft,{explicit:true,replace:b.replace===true,previous_committed_at:b.previous_committed_at??null});
   const done=choices.write(id,'primary_committed',{draft:own.draft,committed_at:r.committed_at},intent.revision);return {...r,choice_revision:done.revision,summary:state()};
  }
  throw Error('Unknown exception operation');
 };
 return {ws,choices,state,item,post,handles:['/api/check','/api/commit','/api/choice','/api/undo','/api/defer','/api/policy'],page:({nonce,token})=>exceptionPage().replace(/__NONCE__/g,nonce).replace('__TOKEN__',token)};
}
function exceptionPage(){
 const html=WS.CLIENT_HTML.replace('init().catch','exceptionInit();\ninit().catch');
 const code=CLIENT_EXTENSION.toString().replace(/^function CLIENT_EXTENSION\(\) \{\n?/,'').replace(/\n?\}$/,'');
 return html.replace('exceptionInit();',code+'\nexceptionInit();').replace('</style>',EXCEPTION_CSS+'\n</style>');
}
const EXCEPTION_CSS=`body main{max-width:1150px;margin:auto}#meta,.term,.chip .s,#jump,#bJump{display:none}.line{font-size:28px!important}#know{max-height:180px;overflow:auto}#probs{font-size:13px}#exceptionBanner{padding:12px 16px;background:#263449;border-bottom:1px solid #59718c;font-size:17px}#exceptionKeys{padding:8px;font-size:13px;color:#c5d5e8}.hotkey{display:inline-block;min-width:22px;margin-right:8px;border:1px solid #67809a;border-radius:4px;text-align:center}.policyCard{padding:12px}.policyCard p{line-height:1.5}.policyCard label{display:block;padding:12px;margin:8px 0;background:#263449;border-radius:6px}#savedChoices{font-size:13px;color:#a8e3ba}.hide{display:none!important}`;
function CLIENT_EXTENSION() {
function exceptionInit(){
 const oldSteps=stepsOf,oldMissing=missingEasy,oldControls=stepControls,oldQuestion=questionOf,oldRender=renderEasy,oldItem=renderItem,oldHeader=renderHeader,oldLoad=load,oldCheck=runCheck;
 let revision=0,saveChain=Promise.resolve(),saving=false,loadEpoch=0,policyChoice='',policyEditing=false;const held=new Set();
 const banner=el('div',{id:'exceptionBanner'});document.querySelector('header').after(banner);
 const batchNav=el('div',{id:'batchNav'});banner.after(batchNav);
 const hint=el('div',{id:'exceptionKeys'},'1–9 / A–Z choose · Enter next / submit preview · Backspace previous question · Alt+Z undo choice · Alt+E edit saved judgment · Alt+J/K previous/next item');banner.after(hint);
 const saved=el('div',{id:'savedChoices',role:'status'});$('form').prepend(saved);
 const park=el('button',{id:'bPark'},'Park saved choices for later');park.onclick=async()=>{await persist('defer');const r=await api('/api/defer',{id:S.item.id,explicit:true,revision,draft:structuredClone(draftOf())});revision=r.revision;S.sum=r.summary;const n=nextOpen(S.item.n);if(n)await load(n);};$('bCommit').after(park);
 const panel=el('div',{id:'policyPanel',class:'policyCard hide'});$('form').parentElement.append(panel);
 const diagnostics=el('details',{});diagnostics.append(el('summary',{},'Technical validation details'));$('probs').before(diagnostics);diagnostics.append($('probs'));
 const keyFor=n=>n<9?String(n+1):String.fromCharCode(97+n-9);
 function controls(){const scope=S.item?.policy?panel:(!draftOf().outcome?document.querySelector('.choices'):$('stepCard'));return [...scope.querySelectorAll('input[type=radio]:not(:disabled),input[type=checkbox]:not(:disabled)')];}
 function decorate(){const c=controls();for(let n=0;n<c.length;n++){const label=c[n].closest('label');if(label&&!label.querySelector('.hotkey'))label.prepend(el('span',{class:'hotkey'},keyFor(n).toUpperCase()));}}
 function status(){saved.textContent=saving?'Saving explicit choice…':revision?'Your explicit choices are saved locally.':'No choices yet. Each question starts blank.';}
 async function persist(step){if(!S.item||S.item.policy||!isOpen())return;const id=S.item.id,draft=structuredClone(draftOf()),epoch=loadEpoch;saving=true;status();saveChain=saveChain.then(async()=>{if(id!==S.item.id||epoch!==loadEpoch)return;const r=await api('/api/choice',{id,explicit:true,revision,step,draft});revision=r.revision;});try{await saveChain;}catch(e){saved.textContent='Not saved: '+e.message;throw e;}finally{saving=false;if(epoch===loadEpoch&&revision&&saved.textContent.indexOf('Not saved:')!==0)status();}}
 const oldChanged=changed;changed=function(){oldChanged();persist(currentStep(draftOf())).catch(()=>{});decorate();};
 document.addEventListener('change',e=>{if(e.target.name==='outcome'||e.target.closest('#form')&&!e.target.closest('#stepCard'))queueMicrotask(()=>persist('explicit-form-choice').catch(()=>{}));});
 stepsOf=function(d){let steps=oldSteps(d);const key=S.item?.batch?.key;const priority=key==='address'?'addr':key==='relation'?'rel':key==='facet'?'facet':'speech';const rank={};[priority,...['speech','facet','addr','rel'].filter(x=>x!==priority)].forEach((k,i)=>rank[k]=i);
 const prefix=steps.filter(x=>x.startsWith('ec'));const acts=[];d.easy.acts.forEach((a,i)=>{if(i)acts.push('start:'+i);acts.push(...['speech','facet','addr','rel'].sort((a,b)=>rank[a]-rank[b]).map(k=>k+':'+i));if(key==='facet')acts.push('ref:'+i);});return ['parts',...prefix.filter(x=>x!=='ecpart'),...acts,...prefix.filter(x=>x==='ecpart'),'preview'];};
 missingEasy=function(d){const missing=oldMissing(d);if(!d.exception_parts)missing.unshift('how many distinct parts');if(S.item?.batch?.key==='facet')d.easy.acts.forEach((a,i)=>{if(!d.exception_ref_done?.[i])missing.push('the thing meant in Part '+(i+1));});return missing;};
 const oldDone=stepDone;stepDone=function(d,id){if(id==='parts')return !!d.exception_parts;if(id.startsWith('ref:'))return !!d.exception_ref_done?.[Number(id.split(':')[1])];return oldDone(d,id);};
 questionOf=function(d,id){if(id==='parts')return {q:'How many distinct things does the player do in this line?',hint:'A statement followed by a question can be two parts. You decide the split; nothing is preselected.'};if(id.startsWith('ref:'))return{q:'Which thing or place does this part mean, if any?',hint:'Use only what is shown in the observer-safe context.'};return oldQuestion(d,id);};
 stepControls=function(d,id){if(id==='parts'){const box=el('div',{});box.append(chipGroup('parts',[1,2,3].map(n=>({v:String(n),t:n===1?'One part':n+' separate parts'})),d.exception_parts||'',v=>{const n=Number(v);d.exception_parts=v;while(d.easy.acts.length<n)d.easy.acts.push(blankAct());d.easy.acts=d.easy.acts.slice(0,n);changed();advance();}));return box;}if(id.startsWith('ref:')){const i=Number(id.split(':')[1]),a=d.easy.acts[i],box=el('div',{});box.append(chipGroup('ref'+i,[...S.P.things.map(t=>({v:t.label,t:t.name+' ('+t.kind+')'})),...Object.entries(S.easy.optional.refc.special).map(([v,t])=>({v,t}))],a.refc,v=>{a.refc=v;d.exception_ref_done=d.exception_ref_done||{};d.exception_ref_done[i]=true;changed();}));if(a.refc&&/^r/.test(a.refc))box.append(selectBox([{v:'none',t:'Not a typed phrase'},...S.P.typed.map(t=>({v:t.label,t:quote(t.text)}))],a.refspan||'',v=>{a.refspan=v==='none'?'':v;changed();},'— link a typed phrase if appropriate —','Typed phrase'));return box;}return oldControls(d,id);};
 renderEasy=function(){oldRender();decorate();};
 renderHeader=function(){oldHeader();batchNav.textContent='';for(const [key,count]of Object.entries(S.sum.batches||{})){const first=S.sum.order.find(x=>x.batch===key);if(!first)continue;const button=el('button',{},({address:'Address',force:'Speech force',relation:'Relation',facet:'Facet',full:'Full Easy',policy:'Policy'}[key])+' ('+count+')');button.onclick=()=>load(first.n);batchNav.append(button);}if(S.item?.batch)banner.textContent=(S.sum.synthetic?'SYNTHETIC SCRATCH · ':'')+S.item.batch.title+' '+S.item.batch.index+' / '+S.item.batch.total+' · '+S.sum.remaining+' / '+S.sum.total+' unresolved human tasks remain · '+S.sum.primary_committed+' primary judgments · '+S.sum.deferred+' parked';};
 function renderPolicy(){panel.textContent='';panel.append(el('h2',{},'Spoken address versus interface delivery'),el('p',{},'The player says “Tonya, how are you?” while the interface delivers the line to Malcolm.'),el('p',{},'Convention B records spoken address separately from delivery. The current validator rejects a spoken addressee that differs from the delivery choice. Decide the policy explicitly; this screen does not create a label or change either rule.'));
 const own=S.item.human_choices.policy;if(own&&!policyEditing){panel.append(el('p',{},'Your recorded decision: '+({spoken_address_separate:'Keep spoken address separate from delivery',delivery_controls_address:'Let delivery control address',defer:'Defer this policy decision'}[own.decision])),el('p',{},'Recorded only. No validator or frozen contract was changed.'));const edit=el('button',{},'Edit policy decision');edit.onclick=()=>{policyEditing=true;policyChoice='';renderPolicy();};panel.append(edit);return;}
 panel.append(chipGroup('policy',[{v:'spoken_address_separate',t:'Keep spoken address separate; align validation in a future authorized change'},{v:'delivery_controls_address',t:'Let delivery control address; amend the contract in a future authorized change'},{v:'defer',t:'Defer this policy decision'}],policyChoice,v=>{policyChoice=v;renderPolicy();}));const note=el('input',{type:'text',placeholder:'Optional policy reason'});note.id='policyNote';panel.append(note);const button=el('button',{id:'policyCommit',class:'primary'},'Record policy decision');button.disabled=!policyChoice;button.onclick=async()=>{const r=await api('/api/policy',{id:S.item.id,explicit:true,revision,decision:policyChoice,note:note.value});revision=r.revision;S.sum=r.summary;policyEditing=false;await load(S.item.n);};panel.append(button);decorate();}
 renderItem=function(){revision=S.item.human_choices.revision;const own=S.item.human_choices.draft;if(own&&!S.drafts.has(S.item.id))S.drafts.set(S.item.id,structuredClone(own));policyChoice='';policyEditing=false;oldItem();const context=$('know'),people=context.querySelector('.people');const expanded=el('details',{});expanded.append(el('summary',{},'Expand full observer-safe context'));for(const child of [...context.childNodes])if(child!==people)expanded.append(child);context.append(expanded);panel.classList.toggle('hide',!S.item.policy);$('form').classList.toggle('hide',S.item.policy);$('committedBox').classList.toggle('hide',S.item.policy||!S.item.label);if(S.item.policy)renderPolicy();status();renderHeader();decorate();};
 load=async function(ref){await saveChain;loadEpoch++;S.checkSeq++;clearTimeout(S.timer);document.activeElement?.blur();await oldLoad(ref);};
 nextOpen=function(from){const o=S.sum.order;for(let k=1;k<=o.length;k++){const x=o[(from-1+k)%o.length];if(x.state!=='committed'&&x.state!=='deferred')return x.n;}return null;};
 startEdit=function(){const own=S.item.human_choices.draft;if(!own){$('actMsg').textContent='No Easy choices were saved for this judgment; use the normal workstation to edit it.';return;}S.drafts.set(S.item.id,structuredClone(own));S.editing.add(S.item.id);renderJudgment();runCheck();decorate();};
 commit=async function(andNext){if(!isOpen()||S.item.policy)return;const id=S.item.id;try{await persist('explicit-primary-submit');await oldCheck();if(S.item.id!==id||!S.check?.ok){$('actMsg').textContent='Choices saved. Complete or correct the form, or park it for later.';return;}const edit=editing();const r=await api('/api/commit',{id,draft:collect(),human_form:structuredClone(draftOf()),choice_revision:revision,explicit:true,replace:edit,previous_committed_at:edit?S.item.status.committed_at:null});revision=r.choice_revision;S.drafts.delete(id);S.editing.delete(id);S.sum=r.summary;const n=andNext?nextOpen(S.item.n):null;await load(n||S.item.n);toast('Human primary saved.');}catch(e){$('actMsg').textContent='Not submitted: '+e.message;}};
 document.addEventListener('keydown',async e=>{if(e.isComposing)return;const key=e.key.toLowerCase();const typing=e.target.matches('textarea,input[type=text],select');if(e.altKey&&key==='z'){e.preventDefault();e.stopImmediatePropagation();if(S.item.policy)return;await saveChain;try{const r=await api('/api/undo',{id:S.item.id,explicit:true,revision});revision=r.revision;S.drafts.set(S.item.id,r.draft);if(S.item.status.state==='committed')S.editing.add(S.item.id);S.step.delete(S.item.id);renderJudgment();schedule();decorate();}catch(err){$('actMsg').textContent=err.message;}return;}
 if(e.altKey&&key==='e'){e.preventDefault();e.stopImmediatePropagation();if(S.item.policy){policyEditing=true;policyChoice='';renderPolicy();}else startEdit();return;}
 if(e.altKey||e.ctrlKey||e.metaKey||typing)return;
 if(held.has(key)||e.repeat){if(key==='enter'||/^\w$/.test(key))e.preventDefault();return;}
 const choice=controls().find((x,i)=>keyFor(i)===key);if(choice){held.add(key);e.preventDefault();e.stopImmediatePropagation();choice.click();decorate();return;}
 if(key==='enter'){held.add(key);e.preventDefault();e.stopImmediatePropagation();if(S.item.policy){if(!$('policyCommit')?.disabled)$('policyCommit')?.click();return;}if(!draftOf().outcome)return;const step=currentStep(draftOf());if(step==='preview'){await commit(true);return;}if(stepDone(draftOf(),step)){await saveChain;advance();decorate();}return;}
 if(key==='backspace'&&draftOf().outcome){held.add(key);e.preventDefault();e.stopImmediatePropagation();back();decorate();}
 },true);
 document.addEventListener('keyup',e=>held.delete(e.key.toLowerCase()),true);
 window.addEventListener('blur',()=>held.clear());
 // Every render keeps technical notation secondary; ordinary choices are plain English.
 const oldJudgment=renderJudgment;renderJudgment=function(){oldJudgment();decorate();};
}
}
async function main(argv=process.argv.slice(2)){
 const arg=(k,f)=>argv.includes(k)?argv[argv.indexOf(k)+1]:f;
 const source=path.resolve(arg('--dir',WS.DEFAULT_DIR));let dir=source,labeler='jack',registry;
 if(argv.includes('--scratch')){dir=fs.mkdtempSync(path.join(os.tmpdir(),'reader-exception-usability-'));for(const name of [WS.FILES.worksheet,WS.FILES.pack])fs.copyFileSync(path.join(source,name),path.join(dir,name));labeler='synthetic-usability';const L=require('./dialogue-reader-labels');registry=JSON.parse(JSON.stringify(L.loadRegistry()));registry.human.primary_labelers.push(labeler);}
 const full=WS.loadWorkstation({dir,labeler,...(registry?{registry}:{})});const queue=buildQueue(full,{history:source});
 if(argv.includes('--inspect')){console.log(JSON.stringify({unresolved:queue.items.length,parked_valid:412,counts:queue.counts,human_primary_existing:full.labels.length,minimum_semantic_choices:9*6+1,source_sha256:queue.source_sha256},null,2));return;}
 const mode=makeMode(full,queue,{scratch:argv.includes('--scratch')});const release=WS.acquireLock(dir);WS.installEgressGuard();
 const {server,listen}=WS.createWorkstationServer(mode.ws,{port:Number(arg('--port','47475')),interfaceMode:mode});const started=await listen();console.log(JSON.stringify({url:started.url,source:dir,choices_file:mode.choices.file,labeler,synthetic:argv.includes('--scratch'),counts:queue.counts,unresolved:queue.items.length,parked_machine_valid:412}));
 const stop=()=>{release();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500).unref();};process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',release);
 if(argv.includes('--open'))require('node:child_process').execFile('/usr/bin/open',[started.url]);
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={buildQueue,batch,makeMode,Choices,cleanDraft,exceptionPage,main,POLICY,BATCHES};
