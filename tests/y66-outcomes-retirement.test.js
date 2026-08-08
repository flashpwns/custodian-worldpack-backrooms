"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const outcomes = require("../tools/q4-outcome-authority");
const career = require("../tools/q4-career-loop");
const institution = require("../tools/institutional-runtime");
const institutionDefinition = require("../data/worldpacks/clear-q4/institution.json");
const phenomena = require("../tools/q4-phenomenon-ecology");
const { DesktopService } = require("../desktop/service");

function fixture(seed = "outcomes") { const world = history.createWorld({ seed }); const started = bootstrap.startRun({ profile:"field-researcher", seed:`${seed}-run`, scenario:"procedural-survey", world, spatial_worldpack:"clear-q4" }); assert.equal(started.ok,true); const player=started.run.session.startup.player.observer_id; const peer=started.run.expedition.team.members.find((member)=>(member.personnel_id??member.id)!==player).personnel_id; return {world,run:started.run,player,peer}; }
function member(run,id) { return run.expedition.team.members.find((item)=>(item.personnel_id??item.id)===id); }

test("outcomes preserve injury, missing, and objective death as distinct persistent records", () => {
  const value=fixture("conditions"); member(value.run,value.peer).condition="serious injury"; const injury=outcomes.resolve(value.world,value.run,{cause:{id:"hazard-structural-fall"}}); assert.equal(injury.classification,"SUCCESS_DEGRADED"); assert.equal(value.world.characters[value.peer].condition,"serious injury"); assert.equal(value.world.characters[value.peer].status,"unavailable");
  member(value.run,value.peer).condition="missing"; const missing=outcomes.resolve(value.world,value.run,{cause:{id:"contact-lost"}}); assert.equal(missing.classification,"PARTIAL_RETURN"); assert.equal(value.world.characters[value.peer].status,"missing"); assert.equal(value.world.characters[value.peer].death,null);
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"yb16c-")),"world.json"); history.saveWorld(file,value.world); const loaded=history.loadWorld(file); assert.equal(loaded.characters[value.peer].status,"missing"); assert.equal(loaded.characters[value.peer].condition,"missing");
  member(value.run,value.peer).condition="dead"; outcomes.resolve(value.world,value.run,{cause:{id:"authorized-fatal-incident"}}); assert.equal(value.world.characters[value.peer].status,"dead"); assert.ok(value.world.characters[value.peer].death); assert.notEqual(value.world.characters[value.peer].identity,value.player);
});

test("player death retires the world with an epistemically safe final record", () => {
  const value=fixture("retirement"); member(value.run,value.player).condition="dead"; const resolved=outcomes.resolve(value.world,value.run,{cause:{id:"unobserved-canonical-cause"}}); assert.equal(resolved.player_deceased,true); assert.equal(outcomes.lifecycle(value.world).status,"RETIREMENT_PENDING"); const retired=outcomes.retire(value.world,value.run); assert.equal(retired.ok,true); assert.equal(outcomes.isRetired(value.world),true); const archive=outcomes.archive(value.world); assert.equal(archive.read_only,true); assert.equal(archive.personnel.length,1); assert.match(archive.final_incident.presentation,/CONTACT LOST/); assert.equal(archive.final_incident.institutional_cause,null); assert.doesNotMatch(JSON.stringify(archive.final_incident),/Bacteria|Still Life/);
  assert.throws(()=>outcomes.assertMutable(value.world,"movement"),{code:"WORLD_RETIRED_IMMUTABLE"}); institution.ensure(value.world,institutionDefinition); assert.throws(()=>career.process(value.world,institutionDefinition,value.run,{mission_id:"closed"}),{code:"WORLD_RETIRED_IMMUTABLE"});
});

test("controlled terminal fixture persists retirement before ordinary resume and legacy archives do not transfer state", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"yb16c-desktop-")); const service=new DesktopService({appDataPath:root,developerMode:true}); const world=service.createWorld({name:"Terminal",seed:"terminal"}).world; assert.equal(service.startSession({world_id:world.id,mode:"field-researcher",seed:"terminal"}).ok,true);
  const fatal=service.controlQ4PhenomenonFixture({world_id:world.id,action:"fatal"}); assert.equal(fatal.ok,true); assert.equal(service.getWorld(world.id).q4_lifecycle.status,"RETIRED"); assert.equal(service.resumeSession({world_id:world.id,mode:"field-researcher"}).error.code,"WORLD_RETIRED"); const archive=service.getRetiredWorldArchive({world_id:world.id}); assert.equal(archive.ok,true); assert.equal(archive.archive.personnel.length,1); assert.equal(service.submitAction({world_id:world.id,mode:"field-researcher",action:"LOOK"}).error.code,"WORLD_RETIRED");
  const fresh=service.createWorld({name:"Fresh",seed:"fresh"}).world; assert.equal(JSON.stringify(service.getWorld(fresh.id)).includes("MARVIN'S FRIEND"),false); assert.equal(Object.keys(service.getWorld(fresh.id).q4_legacy_personnel).length,0);
});

test("interruption after terminal world commit cannot revive a dead controller", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"yb16c-atomic-")); const service=new DesktopService({appDataPath:root,developerMode:true}); const worldInfo=service.createWorld({name:"Atomic",seed:"atomic"}).world; service.startSession({world_id:worldInfo.id,mode:"field-researcher",seed:"atomic"}); const world=service.getWorld(worldInfo.id); const entry=service.session(worldInfo.id,"field-researcher"); const player=entry.run.session.startup.player.observer_id; member(entry.run,player).condition="dead"; member(entry.run,player).status="dead"; assert.equal(outcomes.resolve(world,entry.run,{cause:{id:"controlled-atomic-cause"}}).player_deceased,true);
  const normalSave=service.saveSession.bind(service); service.saveSession=()=>{ throw new Error("simulated termination after world commit"); }; assert.throws(()=>service.persistTerminalRetirement(world,"field-researcher",entry),/simulated termination/); service.saveSession=normalSave;
  assert.equal(service.getWorld(worldInfo.id).q4_lifecycle.status,"RETIRED"); assert.equal(service.resumeSession({world_id:worldInfo.id,mode:"field-researcher"}).error.code,"WORLD_RETIRED");
});

test("canonical entity identity remains independent of safe designations and aliases", () => {
  const value=fixture("ontology"); value.run.spatial.player_location="utility-room"; value.run.spatial.personnel_locations[value.player]="utility-room"; const still=phenomena.instantiateFixture(value.world,{family:"STILL_LIFE",location_id:"utility-room",fixture_id:"still",spatial:value.run.spatial},{control:phenomena.FIXTURE_TOKEN}).phenomenon; const bacteria=phenomena.instantiateFixture(value.world,{family:"BACTERIA",location_id:"utility-room",fixture_id:"bacteria",spatial:value.run.spatial},{control:phenomena.FIXTURE_TOKEN}).phenomenon;
  const seen=phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",has_field_light:true}); assert.equal(phenomena.record(value.world,still.id).canonical_family,"STILL_LIFE"); assert.equal(phenomena.record(value.world,bacteria.id).canonical_family,"BACTERIA"); assert.doesNotMatch(JSON.stringify(seen),/Still Life|Bacteria/); phenomena.coinAlias(value.world,still.id,{alias:"MARVIN'S FRIEND",originator:value.player}); assert.equal(phenomena.record(value.world,still.id).canonical_family,"STILL_LIFE"); assert.ok(phenomena.projection(value.world,{observer:value.player,location_id:"utility-room"}).some((item)=>item.designation==="MARVIN'S FRIEND")); assert.equal(phenomena.record(value.world,still.id).institutional_designation,null);
});
