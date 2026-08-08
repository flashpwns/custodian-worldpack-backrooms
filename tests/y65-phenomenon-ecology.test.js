"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const phenomena = require("../tools/q4-phenomenon-ecology");
const environment = require("../tools/q4-environment");
const evidence = require("../tools/q4-evidence-authority");
const assignments = require("../tools/q4-assignment-engine");
const spatial = require("../tools/spatial-runtime");
const spatialDefinition = require("../data/worldpacks/clear-q4/spatial.json");
const { DesktopService } = require("../desktop/service");

function fixture(seed = "phenomenon") {
  const world = history.createWorld({ seed });
  const started = bootstrap.startRun({ profile:"field-researcher", seed:`${seed}-run`, scenario:"procedural-survey", world, spatial_worldpack:"clear-q4" });
  assert.equal(started.ok, true);
  const run = started.run; const player = run.session.startup.player.observer_id; const teammate = run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) !== player)?.personnel_id;
  run.spatial.player_location = "utility-room"; run.spatial.personnel_locations[player] = "utility-room";
  if (teammate) run.spatial.personnel_locations[teammate] = "utility-room";
  return { world, run, player, teammate };
}
function controlled(value, family, location_id, fixture_id, extra = {}) {
  const result = phenomena.instantiateFixture(value.world, { family, location_id, fixture_id, spatial:value.run.spatial, ...extra }, { control:phenomena.FIXTURE_TOKEN });
  assert.equal(result.ok, true); return result.phenomenon;
}

test("production rarity matrix makes ordinary worlds normal and enforces every cap", () => {
  let mundane = 0;
  for (let index=0; index<48; index++) {
    const value = fixture(`mundane-${index}`); value.run.spatial.generated_locations = Array.from({length:8},(_,depth)=>({ id:`generated-${depth}`, name:`Generated ${depth}`, type:"corridor", short_description:"Generated field geography.", landmarks:[], generation:{ depth:depth+5, region_id:`region-${Math.floor(depth/3)}` } }));
    const result = phenomena.materializeEligible(value.world,{spatial:value.run.spatial});
    if (!result.created.length) mundane += 1;
    assert.ok(result.created.length <= phenomena.config.production.world_cap);
    for (const region of new Set(result.created.map((item)=>item.region_id))) assert.ok(result.created.filter((item)=>item.region_id===region).length <= phenomena.config.production.region_cap);
  }
  assert.ok(mundane >= 40, `${mundane} of 48 deterministic worlds should remain entirely mundane`);
  const value=fixture("hard-caps");
  assert.equal(phenomena.instantiate(value.world,{family:"ACOUSTIC_ANOMALY",location_id:"utility-room",region_id:"a",spatial:value.run.spatial,provenance:"one"}).ok,true);
  assert.equal(phenomena.instantiate(value.world,{family:"SPATIAL_INCONSISTENCY",location_id:"columned-corridor",region_id:"a",spatial:value.run.spatial,provenance:"two"}).code,"PHENOMENON_REGION_CAP_REACHED");
  assert.equal(phenomena.instantiate(value.world,{family:"SPATIAL_INCONSISTENCY",location_id:"columned-corridor",region_id:"b",spatial:value.run.spatial,provenance:"three"}).ok,true);
  assert.equal(phenomena.instantiate(value.world,{family:"OBJECT_DISPLACEMENT",location_id:"open-passage",region_id:"c",spatial:value.run.spatial,provenance:"four"}).code,"PHENOMENON_WORLD_CAP_REACHED");
});

test("hidden canonical identities stay absent from observer, map, archive, and Standard surfaces", () => {
  const value=fixture("observer-boundary"); const still=controlled(value,"STILL_LIFE","columned-corridor","hidden-still",{profile_id:"BREATHING_PASSIVE"}); const bacteria=controlled(value,"BACTERIA","open-passage","hidden-bacteria");
  assert.deepEqual([phenomena.record(value.world,still.id).canonical_family,phenomena.record(value.world,bacteria.id).canonical_family],["STILL_LIFE","BACTERIA"]);
  assert.deepEqual(phenomena.projection(value.world,{observer:value.player,location_id:"utility-room"}),[]);
  const safe=JSON.stringify({look:bootstrap.look(value.run,{record:false}),map:spatial.project(value.run.spatial,spatialDefinition),archive:evidence.archive(value.world,{observer:"standard"}),conditions:assignments.deriveConditions(value.world)});
  assert.doesNotMatch(safe,/STILL_LIFE|BACTERIA|Still Life|Bacteria/); assert.equal(phenomena.record(value.world,still.id).institutional_designation,null);
});

test("direct observation creates safe terminology while exact identity remains canonical", () => {
  const value=fixture("terminology"); const still=controlled(value,"STILL_LIFE","utility-room","seen",{profile_id:"BREATHING_PASSIVE"});
  const seen=phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",co_observers:[value.teammate],has_field_light:true});
  assert.equal(seen.observations[0].designation,"HUMANOID FORM"); assert.doesNotMatch(JSON.stringify(seen),/STILL_LIFE|Still Life/); assert.equal(phenomena.record(value.world,still.id).canonical_family,"STILL_LIFE");
  assert.equal(phenomena.projection(value.world,{observer:"Standard",location_id:"utility-room"}).length,0);
});

test("legitimate co-observation enters personnel salience without universal commentary", () => {
  const value=fixture("personnel-salience"); controlled(value,"STILL_LIFE","utility-room","salience",{profile_id:"VOCAL_FEAR"}); value.run.expedition.mission_state.phase="FIELD_OPERATION";
  bootstrap.look(value.run); const reactions=value.run._last_phenomenon_reactions; assert.equal(reactions.length,1); assert.equal(value.world.characters[value.teammate].continuity.reaction_history.length,1); assert.doesNotMatch(JSON.stringify(reactions),/STILL_LIFE|Still Life/);
  bootstrap.look(value.run); assert.equal(value.world.characters[value.teammate].continuity.reaction_history.length,reactions.length);
});

test("encounter aliases retain provenance and observer scope across reload but not worlds", () => {
  const value=fixture("alias-world"); const still=controlled(value,"STILL_LIFE","utility-room","alias",{profile_id:"INERT"}); phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",has_field_light:true});
  const coined=phenomena.coinAlias(value.world,still.id,{alias:"MARVIN'S FRIEND",originator:value.player,at:2}); assert.equal(coined.ok,true); assert.deepEqual(coined.alias.known_by,[value.player]);
  assert.equal(phenomena.projection(value.world,{observer:value.player,location_id:"utility-room"})[0].designation,"MARVIN'S FRIEND"); assert.equal(phenomena.projection(value.world,{observer:value.teammate,location_id:"utility-room"}).length,0); assert.equal(phenomena.record(value.world,still.id).institutional_designation,null);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"yb16b-alias-")); const file=path.join(dir,"world.json"); history.saveWorld(file,value.world); const loaded=history.loadWorld(file); assert.equal(phenomena.record(loaded,still.id).aliases[0].value,"MARVIN'S FRIEND");
  assert.equal(JSON.stringify(history.createWorld({seed:"fresh-world"})).includes("MARVIN'S FRIEND"),false);
});

test("Still Life profiles are heterogeneous, persistent, stimulus-bound, and missable", () => {
  const value=fixture("still-life-profiles"); const ids=[];
  for (const profile_id of ["INERT","BREATHING_PASSIVE","VOCAL_FEAR","FLEEING","AGGRESSIVE","LIGHT_INTERACTIVE","HAZARD_SEEKING","LOW_REACTIVITY"]) ids.push(controlled(value,"STILL_LIFE","utility-room",profile_id,{profile_id}).id);
  assert.equal(new Set(ids.map((id)=>phenomena.record(value.world,id).behavior_profile_id)).size,8);
  const fleeing=ids.find((id)=>phenomena.record(value.world,id).behavior_profile_id==="FLEEING"); const before=phenomena.record(value.world,fleeing).location_id;
  const unseen=phenomena.stillLifeStimulus(value.world,value.run,fleeing,{kind:"approach",actor_location:"open-passage"}); assert.equal(unseen.perceived,false); assert.equal(phenomena.record(value.world,fleeing).location_id,before);
  const reacted=phenomena.stillLifeStimulus(value.world,value.run,fleeing,{kind:"approach",actor_location:"utility-room"}); assert.equal(reacted.changed,true); assert.notEqual(reacted.location_id,before);
  const low=ids.find((id)=>phenomena.record(value.world,id).behavior_profile_id==="LOW_REACTIVITY"); assert.equal(phenomena.stillLifeStimulus(value.world,value.run,low,{kind:"physical-interference",actor_location:"utility-room"}).changed,false);
  const stored=structuredClone(ids.map((id)=>phenomena.record(value.world,id).behavior_profile)); const loaded=structuredClone(value.world); assert.deepEqual(ids.map((id)=>phenomena.record(loaded,id).behavior_profile),stored);
  const hidden=fixture("missable"); controlled(hidden,"STILL_LIFE","columned-corridor","missed",{profile_id:"VOCAL_FEAR"}); const safe=bootstrap.status(hidden.run); assert.deepEqual(safe.view.observations.phenomena,[]); assert.doesNotMatch(JSON.stringify(safe),/STILL_LIFE|Still Life/); assert.equal(phenomena.assignmentConditions(hidden.world).length,0);
});

test("Still Life lighting behavior mutates only through persistent environment authority", () => {
  const value=fixture("still-light"); const still=controlled(value,"STILL_LIFE","utility-room","light",{profile_id:"LIGHT_INTERACTIVE"}); const prior=environment.current(value.run.spatial.environment,"utility-room").lighting;
  const result=phenomena.stillLifeStimulus(value.world,value.run,still.id,{kind:"approach",actor_location:"utility-room"}); assert.equal(result.changed,true); assert.notEqual(environment.current(value.run.spatial.environment,"utility-room").lighting,prior); assert.match(value.run.spatial.environment.history.at(-1).source,/entity:/);
  const restored=bootstrap.resumeRun(bootstrap.saveRun(value.run),{world:value.world,spatial_worldpack:"clear-q4"}); assert.equal(environment.current(restored.run.spatial.environment,"utility-room").lighting,"dark"); assert.equal(phenomena.record(value.world,still.id).current_state,"LIGHT_INTERACTION");
});

test("Bacteria acquires real speech, mimics only to eligible observers, and pursues over legal routes", () => {
  const value=fixture("bacteria-behavior"); const entity=controlled(value,"BACTERIA","columned-corridor","bacteria");
  phenomena.recordSpeech(value.world,value.run,{speaker:value.player,text:"Can anyone hear me?",location_id:"utility-room"});
  const mimic=phenomena.bacteriaMimic(value.world,value.run,entity.id,{observers:[value.player,value.teammate,"Standard"]}); assert.equal(mimic.ok,true); assert.equal(mimic.event.text,"Can anyone hear me?"); assert.deepEqual(new Set(mimic.event.heard_by),new Set([value.player,value.teammate])); assert.equal(mimic.event.source_attribution,"uncertain");
  assert.equal(phenomena.acquireBacteria(value.world,value.run,entity.id,{target_id:value.player,signal:"acoustic"}).ok,true); const pursued=phenomena.bacteriaPursue(value.world,value.run,entity.id); assert.equal(pursued.ok,true); assert.ok(pursued.moves.length<=2); assert.ok(pursued.moves.every((id)=>spatialDefinition.connections.some((edge)=>edge.id===id))); assert.equal(pursued.captured,true);
  assert.equal(bootstrap.act(value.run,"MOVE","utility-to-passage").error.code,"PERSONNEL_CAPTURED"); assert.equal(JSON.stringify(bootstrap.status(value.run)).includes("ATTACK"),false); assert.equal(JSON.stringify(phenomena.record(value.world,entity.id)).includes("hit_points"),false);
});

test("Bacteria capture and slamming hand off physical impact to consequence authority without mortality", () => {
  const value=fixture("bacteria-slam"); const entity=controlled(value,"BACTERIA","utility-room","slam"); assert.equal(phenomena.bacteriaCapture(value.world,value.run,entity.id,{target_id:value.teammate}).ok,true);
  const first=phenomena.bacteriaSlam(value.world,value.run,entity.id,{surface_id:"utility-room wall",witnesses:[value.player,"Standard"]}); assert.equal(first.ok,true); assert.equal(value.run.expedition.team.members.find((item)=>item.personnel_id===value.teammate).condition,"serious injury"); assert.deepEqual(first.incident.witnesses,[value.player]);
  const second=phenomena.bacteriaSlam(value.world,value.run,entity.id,{surface_id:"utility-room wall",witnesses:[value.player]}); assert.equal(second.ok,true); assert.equal(value.run.expedition.team.members.find((item)=>item.personnel_id===value.teammate).condition,"incapacitated"); assert.notEqual(value.run.expedition.team.members.find((item)=>item.personnel_id===value.teammate).condition,"dead"); assert.equal(phenomena.record(value.world,entity.id).institutional_designation,null);
});

test("phenomenon evidence is downstream, observer-safe, immutable in truth, and reportable into work", () => {
  const value=fixture("evidence-chain"); const still=controlled(value,"STILL_LIFE","utility-room","evidence",{profile_id:"BREATHING_PASSIVE"}); const observed=phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",has_field_light:true}).observations[0];
  const record=evidence.capture(value.world,value.run,{id:"phenomenon-photo",type:"photograph",creator:value.player,source_location:"utility-room",target_observation:observed.description,visible_objects:observed.observed_properties,phenomenon_observation_ref:observed.observation_ref,captured_at:{interval:1}}); assert.equal(phenomena.linkEvidence(value.world,still.id,{observer:value.player,evidence_id:record.id}).ok,true);
  assert.doesNotMatch(JSON.stringify(record.render_spec),/STILL_LIFE|Still Life/); const identity=phenomena.record(value.world,still.id).canonical_family; record.render_spec.facts.observation="invented output"; assert.equal(phenomena.record(value.world,still.id).canonical_family,identity);
  const delivered=phenomena.deliverReport(value.world,still.id,{observer:value.player,message_id:"delivered-1",summary:"Unidentified breathing humanoid form observed.",at:2}); assert.equal(delivered.ok,true); const candidate=assignments.deriveConditions(value.world).find((item)=>item.source_condition.type==="reported-phenomenon"); assert.ok(candidate); assert.doesNotMatch(JSON.stringify(candidate),/STILL_LIFE|Still Life/);
});

test("all bounded non-entity families preserve authority-owned state", () => {
  const value=fixture("families");
  const spatialItem=controlled(value,"SPATIAL_INCONSISTENCY","columned-corridor","space"); assert.equal(phenomena.applySpatialState(value.world,spatialItem.id,{spatial:value.run.spatial,definition:spatialDefinition,effect:{action:"suppress-connection",connection_id:"corridor-to-relay"}}).ok,true); assert.equal(spatial.canonicalDefinition(value.run.spatial,spatialDefinition).connections.some((edge)=>edge.id==="corridor-to-relay"),false);
  const transient=controlled(value,"TRANSIENT_ARCHITECTURE","columned-corridor","transient"); assert.equal(phenomena.applySpatialState(value.world,transient.id,{spatial:value.run.spatial,definition:spatialDefinition,effect:{action:"add-transient-connection",from:"columned-corridor",to:"open-passage"}}).ok,true);
  const restoredSpatial=spatial.migrate(spatial.canonicalSnapshot(value.run.spatial),spatialDefinition,{player:value.player,personnel:[value.teammate],phase:"FIELD_OPERATION",world_seed:value.world.seed}); assert.equal(spatial.canonicalDefinition(restoredSpatial,spatialDefinition).connections.some((edge)=>edge.id==="corridor-to-relay"),false); assert.ok(spatial.canonicalDefinition(restoredSpatial,spatialDefinition).connections.some((edge)=>edge.phenomenon_id===transient.id)); assert.deepEqual(spatial.validateState(restoredSpatial,spatialDefinition),[]);
  const discontinuity=controlled(value,"ENVIRONMENTAL_DISCONTINUITY","utility-room","environment"); assert.equal(phenomena.applyEnvironmentalDiscontinuity(value.world,discontinuity.id,{environment_state:value.run.spatial.environment,patch:{lighting:"emergency"}}).ok,true); assert.equal(environment.current(value.run.spatial.environment,"utility-room").lighting,"emergency");
  const displaced=controlled(value,"OBJECT_DISPLACEMENT","utility-room","object"); assert.equal(phenomena.displaceObject(value.world,displaced.id,{object_state:value.run.object_state,definition:bootstrap.interactionDefinitionFor("clear-q4"),spatial:value.run.spatial,object_id:"utility-route-surface",to_location:"open-passage"}).ok,true); assert.equal(value.run.object_state.objects["utility-route-surface"].location,"open-passage");
  const acoustic=controlled(value,"ACOUSTIC_ANOMALY","utility-room","acoustic"); const sound=phenomena.emitAcousticAnomaly(value.world,value.run,acoustic.id,{observers:[value.player,value.teammate,"Standard"],description:"three measured knocks"}); assert.deepEqual(new Set(sound.event.heard_by),new Set([value.player,value.teammate])); assert.equal(sound.event.source_attribution,"uncertain");
  const conflict=controlled(value,"EVIDENCE_INCONSISTENCY","utility-room","evidence-conflict"); for(const id of ["record-a","record-b"])evidence.capture(value.world,value.run,{id,type:"field-note",creator:value.player,target_observation:id,visible_objects:[id],captured_at:{interval:1}}); const inconsistent=phenomena.establishEvidenceInconsistency(value.world,conflict.id,{evidence_a:"record-a",evidence_b:"record-b",basis:"recorded properties disagree"}); assert.equal(inconsistent.ok,true); assert.equal(phenomena.record(value.world,conflict.id).evidence_ids.length,2);
});

test("save and reload preserves instance identity, profile, state, observations, evidence, and alias", () => {
  const value=fixture("round-trip"); const still=controlled(value,"STILL_LIFE","utility-room","round-trip",{profile_id:"VOCAL_FEAR"}); phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",has_field_light:true}); phenomena.stillLifeStimulus(value.world,value.run,still.id,{kind:"approach",actor_location:"utility-room"}); phenomena.coinAlias(value.world,still.id,{alias:"THE CALLER",originator:value.player});
  const before=structuredClone(phenomena.record(value.world,still.id)); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"yb16b-save-")); const file=path.join(dir,"world.json"); history.saveWorld(file,value.world); delete value.world.phenomena[still.id]; const loaded=history.loadWorld(file); assert.deepEqual(phenomena.record(loaded,still.id),before);
  assert.equal(phenomena.diagnostics(loaded,{developer:true}).controlled_fixture_status,"token-gated"); assert.equal(phenomena.projection(loaded,{observer:value.player,location_id:"utility-room"})[0].designation,"THE CALLER");
});

test("old worlds migrate with empty population and reduced sensory presentation changes no truth", () => {
  const old=history.createWorld({seed:"old"}); delete old.q4_phenomenon_ecology; const migrated=phenomena.migrate(old,{existing_locations:spatialDefinition.locations}); assert.equal(migrated.migrated_conservatively,true); assert.equal(phenomena.records(old).length,0); assert.equal(migrated.evaluated_locations.length,spatialDefinition.locations.length);
  const value=fixture("sensory-parity"); const still=controlled(value,"STILL_LIFE","utility-room","parity",{profile_id:"BREATHING_PASSIVE"}); const first=phenomena.observe(value.world,{run:value.run,observer:value.player,location_id:"utility-room",has_field_light:true}).observations[0]; const second=phenomena.projection(value.world,{observer:value.player,location_id:"utility-room"})[0]; assert.deepEqual(first,second); assert.equal(phenomena.record(value.world,still.id).canonical_family,"STILL_LIFE");
});

test("controlled desktop fixtures are developer-gated and persist without changing production rarity", () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"yb16b-desktop-")); const normal=new DesktopService({appDataPath:path.join(root,"normal")}); const normalWorld=normal.createWorld({name:"Normal",seed:"normal"}).world; normal.startSession({world_id:normalWorld.id,mode:"field-researcher",seed:"normal"}); assert.equal(normal.controlQ4PhenomenonFixture({world_id:normalWorld.id,family:"STILL_LIFE"}).error.code,"DEVELOPER_DISABLED");
  const service=new DesktopService({appDataPath:path.join(root,"developer"),developerMode:true}); const world=service.createWorld({name:"Controlled",seed:"controlled"}).world; service.startSession({world_id:world.id,mode:"field-researcher",seed:"controlled"}); const created=service.controlQ4PhenomenonFixture({world_id:world.id,family:"STILL_LIFE",profile_id:"INERT"}); assert.equal(created.ok,true); assert.equal(created.diagnostics.fixture_count,1); assert.equal(created.diagnostics.production_count,0); assert.equal(phenomena.records(service.getWorld(world.id)).length,1); const snapshot=service.getDeveloperSnapshot({world_id:world.id,mode:"field-researcher"}); assert.equal(snapshot.snapshot.objective.phenomena[0].canonical_family,"STILL_LIFE"); const report=service.exportTesterReport({world_id:world.id}); assert.equal(report.ok,true); assert.doesNotMatch(JSON.stringify(report.report),/STILL_LIFE|Still Life/); assert.equal("instantiated_count" in report.report.phenomenon_diagnostics,false);
});
