#!/usr/bin/env node
"use strict";
// Human observations only. This tool never submits dialogue, creates labels or changes game state.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const APP=path.join(ROOT,'dist/desktop/mac-arm64/Yellow Beast.app');
const SOURCE_FILES=['desktop/service.js','tools/dialogue-personhood.js','tools/q4-continuity.js','tools/ai-local-dialogue.js','tools/canonical-knowledge.js','tools/dialogue-state.js','tools/dialogue-claims.js','tools/dialogue-validation.js','tools/dialogue-reader-frame.js','tools/dialogue-discourse.js','tools/dialogue-interpretation.js','tools/dialogue-acts.js','tools/dialogue-turn.js','tools/dialogue-advisory-interpreter.js','tools/dialogue-fallback.js','tools/dialogue-prompt-contract.js','tools/dialogue-resolvers.js','tools/dialogue-resolve-turn.js','tools/live-scene-projection.js','tools/speech-scheduler.js'];
const STEPS=Object.freeze([
 {id:'briefing',title:'1. Maxwell briefing',action:'Start a fresh Day 1 operation as Jack. During the briefing, ask: “What is the schedule and cutoff time?” Then finish the briefing normally.'},
 {id:'introduction',title:'2. Assembly Table introduction',action:'At the Assembly Table, confirm the visible team is you plus three coworkers. Use LOCAL. Say “Hello and goodmorning, everyone.” Ask “What\'re everyone\'s names?” Then “Well yes, but I mean everyone at the table, here.” Select one coworker and ask “WHAT ARE YOUR NAMES?” Clear the selection and say “I’m Jack.” Then talk naturally for five turns: ask about them, follow up on something they actually said, and share how you feel. Judge substance and differences between their voices.'},
 {id:'experience',title:'3. Direct experience and clarification',action:'Select the doctor and ask “Have you been inside the Complex before?” Then ask “So youve been there before? this, complex?” Repeat the latter question with the field technician selected. Record anything confusing in the two replies.'},
 {id:'social',title:'4. Social observation and sarcasm',action:'Select a coworker and say “You look nervous.” Clear the selected recipient and say “Well, this seems incredibly safe.”'},
 {id:'carrying',title:'5. Group carrying question',action:'With the group addressed, ask “What are you all carrying?” Observe who responds, their equipment claims, and the order of the exchange.'},
 {id:'ambiguity',title:'6. Ambiguity and silence',action:'Say “You know the thing by the thing?” Observe the clarification. Leave the composer empty and wait without sending anything. Note any invented player speech or empty message.'},
 {id:'continuity',title:'7. Presentation and restart',action:'Throughout the run, watch whether your submitted words appear before the replies, LOCAL stays in the comms rail, and technical model labels leak into speech. Quit normally, reopen Yellow Beast and resume this operation; inspect the exchange order and your team again. Continue the conversation: ask “What were we talking about?” and follow up on something a coworker previously told you. Judge whether it still feels like the same conversation.'}
]);
function observations(value){
 if(!value||typeof value!=='object'||value.observer!=='Jack'||!Array.isArray(value.steps)||value.steps.length!==STEPS.length)throw new Error('Enter Jack and an observation for every row.');
 const steps=STEPS.map((step,i)=>{const row=value.steps[i];if(row?.id!==step.id||!['PASS','FAIL','NOT_TESTED'].includes(row.verdict)||typeof row.note!=='string'||row.note.length>2000)throw new Error('Every row requires an explicit PASS, FAIL or NOT TESTED.');if(row.verdict!=='PASS'&&!row.note.trim())throw new Error('Describe failures and anything not tested.');return {id:step.id,verdict:row.verdict,note:row.note.trim()};});
 return {observer:'Jack',steps,observed_all_pass:steps.every(s=>s.verdict==='PASS'),authority:'HUMAN_ELECTRON_OBSERVATIONS_NOT_READER_LABELS_OR_BENCHMARK_GOLD'};
}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function page(token){return `<!doctype html><meta charset="utf-8"><title>Jack’s final dialogue test</title><style>body{max-width:850px;margin:32px auto;padding:0 20px;font:17px system-ui;background:#faf8f1;color:#242521}section{padding:15px 0;border-bottom:1px solid #ccc}textarea{display:block;width:96%;min-height:55px;margin:10px 0}select,input,button{font:inherit;padding:8px}h2{font-size:20px}</style><h1>Final Electron dialogue acceptance</h1><p>Test in the packaged Yellow Beast window. This checklist records only your observations. No step has a default verdict. Use a fresh operation; leave the app’s configured language provider unchanged. If its wording fails or is unavailable, record what happened.</p><p>Mark PASS when the exchange feels coherent and obeys the behavior described in each step; mark FAIL for a problem. You may save an incomplete run as NOT TESTED. Your receipt does not approve Reader candidates or authorize cutover.</p><label>Observer <input id="observer" placeholder="Jack" autocomplete="off"></label>${STEPS.map(s=>`<section data-id="${s.id}"><h2>${escape(s.title)}</h2><p>${escape(s.action)}</p><select aria-label="${escape(s.title)} verdict"><option value="">Choose a verdict</option><option>PASS</option><option>FAIL</option><option value="NOT_TESTED">NOT TESTED</option></select><textarea aria-label="${escape(s.title)} observations" placeholder="What you observed; required for FAIL or NOT TESTED"></textarea></section>`).join('')}<p><button id="save">Save my observations</button></p><p id="result" role="status"></p><script>document.getElementById('save').onclick=async()=>{const result=document.getElementById('result');try{const payload={observer:document.getElementById('observer').value,steps:[...document.querySelectorAll('section')].map(s=>({id:s.dataset.id,verdict:s.querySelector('select').value,note:s.querySelector('textarea').value}))};const r=await fetch('/save?token=${token}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();result.textContent=data.message;if(r.ok)document.getElementById('save').disabled=true;}catch(e){result.textContent='Could not save: '+e.message;}};</script>`;}
async function start({root=ROOT,launch=true}={}){
 const token=crypto.randomBytes(24).toString('hex'),run=crypto.randomUUID();
 const head=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
 const provenance={head,app:APP,started_at:new Date().toISOString(),source_hashes:Object.fromEntries(SOURCE_FILES.map(f=>[f,sha(f)]))};
 if(launch){
  const archive=path.join(APP,'Contents/Resources/app.asar');
  if(!fs.existsSync(archive))throw new Error('Packaged ARM64 app missing. Run npm run desktop:build first.');
  const asar=require('@electron/asar');
  const build=JSON.parse(asar.extractFile(archive,'desktop/build-info.json').toString('utf8'));
  if(build.commit!==head){
   // A later documentation-only evidence commit does not invalidate verified runtime bytes.
   const ancestor=cp.spawnSync('git',['merge-base','--is-ancestor',build.commit,head],{cwd:ROOT});
   const changed=cp.execFileSync('git',['diff','--name-only',build.commit,head],{cwd:ROOT,encoding:'utf8'}).trim().split('\n').filter(Boolean);
   if(ancestor.status!==0||changed.some(f=>!f.startsWith('docs/')||!f.endsWith('.md')))throw new Error('Packaged runtime is from another source revision. Run npm run desktop:build first.');
  }
  for(const file of SOURCE_FILES)if(!asar.extractFile(archive,file).equals(fs.readFileSync(path.join(ROOT,file))))throw new Error('Packaged source differs: '+file+'. Run npm run desktop:build first.');
  provenance.packaged_build=build;
  provenance.packaged_asar_sha256=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
 }
 let saved=false,port;
 const server=http.createServer((req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.headers.host!==`127.0.0.1:${port}`){reply(403,{message:'Invalid host.'});return;}
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(url.searchParams.get('token')!==token){reply(403,{message:'Invalid session.'});return;}
  if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(page(token));return;}
  if(req.method!=='POST'||url.pathname!=='/save'||req.headers.origin!==`http://127.0.0.1:${port}`||req.headers['content-type']!=='application/json'){reply(403,{message:'Invalid request.'});return;}
  let body='',oversized=false;req.on('data',chunk=>{body+=chunk;if(body.length>20000){oversized=true;req.destroy();}});req.on('end',()=>{if(oversized)return;try{if(saved)throw new Error('This run was already saved. Start another run to record another observation.');const capture=observations(JSON.parse(body));const directory=path.join(root,'.agent-notes/dialogue-final-human-acceptance');fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,`${run}.json`);fs.writeFileSync(file,JSON.stringify({version:'yellow-beast-final-dialogue-human-observation@v1',...provenance,captured_at:new Date().toISOString(),...capture},null,2)+'\n',{flag:'wx',mode:0o600});saved=true;reply(200,{message:`Saved to ${file}. ${capture.observed_all_pass?'All seven observations marked PASS by Jack.':'Acceptance remains incomplete or failed.'}`});}catch(e){reply(400,{message:e.message});}});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;const url=`http://127.0.0.1:${port}/?token=${token}`;
 if(launch){if(!fs.existsSync(APP)){server.close();throw new Error('Packaged ARM64 app missing. Run npm run desktop:build first.');}cp.execFileSync('open',[APP]);cp.execFileSync('open',[url]);console.log('Yellow Beast and the checklist are open. Save your observations, then press Ctrl-C here to close the checklist.');}
 return {server,url};
}
if(require.main===module)start().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={STEPS,observations,start};
