"use strict";
const { fixture,state,publicResult }=require('./service-probe.cjs');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs');
const f=fixture('astra-20-minute-session');
const start=performance.now();
const turns=[];
const duration=20*60*1000;
(async()=>{
 console.log(JSON.stringify({started_at:new Date().toISOString(),appDataPath:f.appDataPath,duration_ms:duration}));
 while(performance.now()-start<duration){
  const before=performance.now();
  const action=turns.length%4===0?'MOVE':'LOOK';
  const target=action==='MOVE'?(f.run.spatial.player_location==='utility-room'?'open-passage':'utility-room'):null;
  const result=f.service.submitAction({...f.input,action,target});
  const projection=f.service.getGameplayProjection(f.input);
  const record={turn:turns.length,elapsed_ms:Math.round(performance.now()-start),latency_ms:Math.round(performance.now()-before),action,ok:result.ok,error:result.error,phase:f.service.session(f.world.id,'field-researcher').phase.phase_id,location:f.run.spatial.player_location,interval:f.run.expedition.clock.interval,heap:process.memoryUsage().heapUsed,rss:process.memoryUsage().rss,run_bytes:JSON.stringify(f.run).length,projection_bytes:JSON.stringify(projection).length,causal_events:f.run.causal_ledger?.length??0};
  turns.push(record); console.log(JSON.stringify(record));
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 f.service.shutdown();
 console.log(JSON.stringify({completed_at:new Date().toISOString(),turns:turns.length,elapsed_ms:Math.round(performance.now()-start),first:turns[0],last:turns.at(-1),failed:turns.filter(t=>!t.ok).length}));
})().catch(error=>{console.error(error.stack);process.exitCode=1});
