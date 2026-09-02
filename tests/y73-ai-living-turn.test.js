"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const equipment = require("../tools/q4-equipment");
const { projectLiveScene } = require("../tools/live-scene-projection");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { createOpenAIProvider } = require("../tools/ai-openai-provider");
const { PROPOSAL_VERSION } = require("../tools/ai-interpreter-boundary");
const { PRESENTATION_VERSION, buildProviderPacket, executeLivingTurn, validatePresentation } = require("../tools/ai-living-turn");
const { CANDIDATE_VERSION:LOCAL_CANDIDATE_VERSION } = require("../tools/ai-local-dialogue");

function fixture(seed = "living-turn", { openPassage = true, provider = null, localDialogueProvider = null } = {}) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-living-turn-"));
  const service = new DesktopService({ appDataPath, livingTurnProvider:provider, localDialogueProvider });
  const world = service.createWorld({ name:"Living Turn Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" }).ok, true);
  assert.equal(service.startSession({ world_id:world.id, mode:"field-researcher", seed, require_personnel:true, scenario:"reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"CROSS" }).ok, true);
  if (openPassage) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open passage" }).ok, true);
  const run = service.session(world.id, "field-researcher").run;
  return { appDataPath, service, world, run };
}

function player(run) { return run.session.startup.player.observer_id; }
function survey(run) { return run.expedition.team.members.find((member) => member.role === "survey technician"); }
function snapshot(run) {
  return structuredClone({ clock:run.expedition.clock, operational:run.expedition.operational, evidence:run.expedition.evidence, history:run.expedition.history, interactions:run.expedition.interaction_history, equipment:run.expedition.equipment, team:run.expedition.team, spatial:run.spatial, object_state:run.object_state });
}
function compoundText(run) { return `${survey(run).first_name}, check the descending grade while I measure the passage.`; }
function giveInstrumentToPlayer(run) { assert.equal(equipment.transfer(run.expedition, "survey-instrument", survey(run).personnel_id, player(run)).ok, true); }
function candidate(scene, npc = []) { return { version:PRESENTATION_VERSION, scene_description:scene, npc_presentations:npc, presentation_claims:[] }; }
function packet(run, resolution = { ok:true, outcome:"succeeded", result:{ public_reason:"The bounded procedure is complete.", time_advanced:1 } }) {
  const projected = projectLiveScene(run, { observer_id:player(run) }); assert.equal(projected.ok, true); return buildProviderPacket(projected.packet, resolution);
}

test("1 simple natural-language turn runs end-to-end through the production service seam", async () => {
  const { service, world, run } = fixture("living-simple", { openPassage:false });
  const before = run.expedition.clock.interval;
  const result = await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:"I keep walking toward the passage." });
  assert.equal(result.ok, true); assert.equal(result.result.living_turn.status, "resolved"); assert.equal(run.spatial.player_location, "open-passage"); assert.ok(run.expedition.clock.interval > before); assert.ok(result.result.scene.narration);
});

test("2 coordinated Reference Expedition turn resolves end-to-end", async () => {
  const { run } = fixture("living-coordinated"); giveInstrumentToPlayer(run);
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"living-coordinated" });
  assert.equal(result.status, "resolved"); assert.equal(result.resolution.outcome, "coordinated-interval-resolved"); assert.equal(result.validation.accepted, true); assert.ok(result.presentation.scene_description);
});

test("3 presentation rejects invented player speech or action", () => {
  const { run } = fixture("living-player-agency");
  assert.equal(validatePresentation(packet(run), candidate("You say that the passage is safe.")).code, "PRESENTATION_PLAYER_AGENCY_INVENTED");
  assert.equal(validatePresentation(packet(run), candidate("You decide to leave the team behind.")).code, "PRESENTATION_PLAYER_AGENCY_INVENTED");
});

test("4 ambiguity returns clarification without canonical mutation", async () => {
  const { run } = fixture("living-ambiguity"); const before = snapshot(run);
  const result = await executeLivingTurn({ run, player_text:"Put it over there.", interpreter:createLivingProvider(), request_id:"ambiguous" });
  assert.equal(result.status, "clarification"); assert.deepEqual(snapshot(run), before); assert.deepEqual(result.trace, ["interpreter"]);
});

test("5 both providers receive bounded safe input instead of a raw run", async () => {
  const { run } = fixture("living-safe-provider"); giveInstrumentToPlayer(run); const seen = {};
  const base = createLivingProvider(); const provider = { name:"capture", interpret(request) { seen.interpret = structuredClone(request); return base.interpret(request); }, present(request) { seen.present = structuredClone(request); return base.present(request); } };
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:provider, request_id:"safe-provider" });
  assert.equal(result.status, "resolved"); assert.equal(Object.hasOwn(seen.interpret.context, "expedition"), false); assert.equal(Object.hasOwn(seen.present, "run"), false); assert.equal(Object.hasOwn(seen.present, "_world"), false); assert.equal(seen.present.audience, "controlled-player");
});

test("6 hidden Reference geometry is structurally unavailable to presentation", () => {
  const { run } = fixture("living-hidden-geometry"); const exposed = JSON.stringify(packet(run));
  for (const value of ["canonical_geometry", "euclidean_relation", "overlap_depth_m", "canonical_family", "future_schedule"]) assert.equal(exposed.includes(value), false);
});

test("7 leaked 18m truth before measurement is rejected", () => {
  const { run } = fixture("living-premature-measurement");
  const checked = validatePresentation(packet(run), candidate("The passage is 18 metres deep."));
  assert.equal(checked.ok, false); assert.equal(checked.code, "PRESENTATION_UNOBSERVED_MEASUREMENT");
});

test("8 derived contradiction language is rejected before observer conclusion", async () => {
  const { run } = fixture("living-premature-conclusion"); giveInstrumentToPlayer(run);
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"conclusion-base" });
  assert.equal(result.observer_packets[player(run)].observer_knowledge.established_conclusions.length, 0);
  const checked = validatePresentation(result.provider_packet, candidate("The measurement proves a contradiction and geometric overlap."));
  assert.equal(checked.code, "PRESENTATION_UNESTABLISHED_CONCLUSION");
});

test("9 coworker-only observation cannot become player presentation or knowledge", async () => {
  const { run } = fixture("living-private-coworker"); giveInstrumentToPlayer(run);
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"private-coworker" });
  const coworker = survey(run); assert.ok(result.observer_packets[coworker.personnel_id].observer_knowledge.unresolved_observations.length); assert.equal(result.observer_packets[player(run)].observer_knowledge.unresolved_observations.length, 0);
  assert.equal(validatePresentation(result.provider_packet, candidate(`${coworker.display_name} noticed a hidden break in the grade.`)).code, "PRESENTATION_PRIVATE_OBSERVER_KNOWLEDGE");
});

test("10 absent NPC cannot speak", () => {
  const { run } = fixture("living-absent-speaker");
  assert.equal(validatePresentation(packet(run), candidate("The room remains quiet.", [{ observer_id:"absent-person", speech:"I found it." }])).code, "PRESENTATION_SPEAKER_IMPOSSIBLE");
});

test("11 impossible NPC location or action is rejected", () => {
  const { run } = fixture("living-impossible-action"); const coworker = survey(run);
  assert.equal(validatePresentation(packet(run), candidate("The interval ends.", [{ observer_id:coworker.personnel_id, visible_action:`${coworker.display_name} enters the Utility Room.` }])).code, "PRESENTATION_ACTION_IMPOSSIBLE");
  assert.equal(validatePresentation(packet(run), candidate(`${coworker.display_name} carries a camera.`)).ok, false);
  assert.equal(validatePresentation(packet(run), candidate("A hidden chamber opens beyond the passage.")).ok, false);
  assert.equal(validatePresentation(packet(run), candidate("A creature waits beyond the visible route.")).ok, false);
});

test("12 malformed presentation falls back deterministically", async () => {
  const { run } = fixture("living-malformed-output"); giveInstrumentToPlayer(run); const base = createLivingProvider();
  const provider = { name:"malformed", interpret:(request) => base.interpret(request), present:async () => ({ nope:true }) };
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:provider, request_id:"malformed-output" });
  assert.equal(result.status, "resolved"); assert.equal(result.presentation.source, "deterministic-fallback"); assert.equal(result.validation.code, "PRESENTATION_SCHEMA_INVALID");
});

test("13 provider failure falls back", async () => {
  const { run } = fixture("living-provider-failure"); giveInstrumentToPlayer(run); const base = createLivingProvider();
  const provider = { name:"failure", interpret:(request) => base.interpret(request), async present() { throw new Error("offline"); } };
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:provider, request_id:"provider-failure" });
  assert.equal(result.presentation.source, "deterministic-fallback"); assert.equal(result.validation.code, "PRESENTATION_SCHEMA_INVALID");
});

test("14 canonical action remains committed after generation failure", async () => {
  const { run } = fixture("living-commit-before-generation"); giveInstrumentToPlayer(run); const base = createLivingProvider(); const before = run.expedition.clock.interval;
  const provider = { name:"failure", interpret:(request) => base.interpret(request), async present() { throw new Error("failed"); } };
  await executeLivingTurn({ run, player_text:compoundText(run), interpreter:provider, request_id:"commit-before-generation" });
  assert.equal(run.expedition.clock.interval, before + 1); assert.equal(run.expedition.evidence.some((item) => item.measurement?.value === 18), true);
});

test("15 generation and validation do not add canonical mutation", async () => {
  const { run } = fixture("living-read-purity"); giveInstrumentToPlayer(run); const base = createLivingProvider(); let atPresentation;
  const provider = { name:"mutation-attempt", interpret:(request) => base.interpret(request), present(request) { atPresentation = snapshot(run); request.player_scene.location.known_name = "Invented"; return base.present(request); } };
  await executeLivingTurn({ run, player_text:compoundText(run), interpreter:provider, request_id:"read-purity" });
  assert.deepEqual(snapshot(run), atPresentation);
});

test("16 coordinated attempts share one authoritative interval", async () => {
  const { run } = fixture("living-one-interval"); giveInstrumentToPlayer(run); const before = run.expedition.clock.interval;
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"one-interval" });
  const record = run.expedition.coordinated_attempts.at(-1); assert.equal(run.expedition.clock.interval, before + 1); assert.equal(new Set(record.outcomes.map((item) => item.interval_id)).size, 1); assert.equal(result.resolution.interval_id, record.interval_id);
});

test("17 evidence provenance records the actual player operator", async () => {
  const { run } = fixture("living-provenance"); giveInstrumentToPlayer(run);
  await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"provenance" });
  const record = run.expedition.evidence.find((item) => item.measurement?.value === 18); assert.equal(record.operator, player(run)); assert.equal(record.creator, player(run)); assert.equal(record.capturing_observer, player(run)); assert.equal(record.custodian, player(run));
});

test("18 presentation validation is deterministic", () => {
  const { run } = fixture("living-validator-determinism"); const safePacket = packet(run); const value = candidate("An open passage slopes away from the utility room.");
  assert.deepEqual(validatePresentation(safePacket, structuredClone(value)), validatePresentation(safePacket, structuredClone(value)));
});

test("19 interpreter resolution projection presentation validation ordering is enforced", async () => {
  const { run } = fixture("living-ordering"); giveInstrumentToPlayer(run);
  const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:createLivingProvider(), request_id:"ordering" });
  assert.deepEqual(result.trace, ["interpreter", "resolution", "projection", "presentation", "validation"]);
});

test("20 player input is preserved while the player sees one coherent resulting moment", async () => {
  const { run } = fixture("living-player-input"); giveInstrumentToPlayer(run); const text = compoundText(run);
  const result = await executeLivingTurn({ run, player_text:text, interpreter:createLivingProvider(), request_id:"player-input" });
  assert.equal(result.player_input, text); assert.equal(typeof result.presentation.scene_description, "string"); assert.equal(result.presentation.scene_description.length > 0, true); assert.equal(result.presentation.npc_presentations.length, 0);
});

test("21 optional OpenAI seam uses strict interpretation and presentation requests without network", async () => {
  const { run } = fixture("living-openai-seam"); giveInstrumentToPlayer(run); const calls = [];
  const client = { responses:{ create:async (request) => {
    calls.push(request); const input = JSON.parse(request.input);
    if (request.text.format.name === "yellow_beast_living_interpretation") {
      const coworker = input.context.local_coworkers[0]; const first = coworker.label.split(" ")[0]; const playerAction = input.context.sinks.coordinated_attempt.player_actions[0]; const coworkerAction = input.context.sinks.coordinated_attempt.coworker_actions[0];
      return { output_text:JSON.stringify({ version:PROPOSAL_VERSION, status:"proposal", noncanonical:true, relation:"coordinated", attempts:[{ actor:{ kind:"coworker", reference:first }, action:coworkerAction.type, target_label:coworkerAction.target_labels[0], equipment_label:null, agency:"player-order", language_span:`${first}, check the descending grade` }, { actor:{ kind:"player" }, action:playerAction.type, target_label:playerAction.target_labels[0], equipment_label:playerAction.equipment_labels[0], agency:"first-person", language_span:"I measure the passage" }] }) };
    }
    return { output_text:JSON.stringify(candidate(input.player_scene.location.visible_description)) };
  } } };
  const provider = createOpenAIProvider({ client, model:"test-living-model" }); const result = await executeLivingTurn({ run, player_text:compoundText(run), interpreter:{ name:provider.name, interpret:(request) => provider.interpretLiving(request) }, presentation_provider:{ name:provider.name, present:(request) => provider.presentLiving(request) }, request_id:"openai-seam" });
  assert.equal(result.status, "resolved"); assert.equal(result.validation.accepted, true); assert.deepEqual(calls.map((call) => call.text.format.name), ["yellow_beast_living_interpretation", "yellow_beast_living_presentation"]); assert.ok(calls.every((call) => call.store === false));
});

test("22 developer launch scenario enters the Reference Expedition through the ordinary shell service path", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-living-launch-")); const service = new DesktopService({ appDataPath, defaultQ4Scenario:"reference-expedition" });
  const world = service.createWorld({ name:"Reference launch", seed:"reference-launch" }).world; service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" });
  const started = service.startSession({ world_id:world.id, mode:"field-researcher", require_personnel:true });
  assert.equal(started.ok, true); assert.equal(service.session(world.id, "field-researcher").run.scenario, "async-clear-q4-reference-expedition");
});

test("23 ordinary staging can assign the player the instrument needed for the compound playable turn", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-living-manual-")); const service = new DesktopService({ appDataPath, defaultQ4Scenario:"reference-expedition" });
  const world = service.createWorld({ name:"Manual living turn", seed:"manual-living-turn" }).world; service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" }); service.startSession({ world_id:world.id, mode:"field-researcher", require_personnel:true });
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"READY" }).ok, true);
  const received = service.submitQ4Handoff({ world_id:world.id, item_id:"survey-instrument", target:"player" }); assert.equal(received.ok, true);
  for (const action of ["PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }).ok, true); assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"CROSS" }).ok, true);
  assert.equal((await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:"I keep walking toward the passage." })).ok, true);
  const run = service.session(world.id, "field-researcher").run; const result = await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:compoundText(run) });
  assert.equal(result.ok, true); assert.equal(result.result.living_turn.status, "resolved"); assert.equal(run.expedition.evidence.find((item) => item.measurement?.value === 18)?.operator, player(run));
});

test("24 radio-ready Cross Threshold control carries the advertised production action", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-living-cross-control-")); const service = new DesktopService({ appDataPath, defaultQ4Scenario:"reference-expedition" });
  const world = service.createWorld({ name:"Cross control", seed:"cross-control" }).world; service.createQ4Personnel({ world_id:world.id, first_name:"Casey", last_name:"Morgan" }); service.startSession({ world_id:world.id, mode:"field-researcher", require_personnel:true });
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  const checked = service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }); assert.equal(checked.ok, true);
  assert.ok(checked.projection.available_actions.some((action) => action.type === "CROSS"));
  assert.match(surfaces.render(checked.projection), /data-game-action="CROSS">Cross Threshold<\/button>/);
});

test("25 hosted LOCAL presentation is reachable only after canonical personnel authorization", async () => {
  let packetSeen = null;
  const localDialogueProvider = { name:"injected-local", async presentLocal(packet) { packetSeen = structuredClone(packet); return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id, speech:"I have the route notes here. Which segment should I verify?" }; } };
  const { service, world, run } = fixture("living-local-hosted", { localDialogueProvider });
  const coworker = run.expedition.team.members.find((member) => member.personnel_id !== player(run));
  const beforeMessages = run.expedition.messages.length;
  const result = await service.submitQ4Communication({ world_id:world.id, channel:"local", target:coworker.first_name, text:"Can you verify the route notes?" });
  assert.equal(result.ok, true);
  assert.equal(run.expedition.messages.length, beforeMessages + 1);
  assert.equal(result.result.presentation_source, "hosted-model");
  assert.equal(result.result.public_reason, `${coworker.display_name}: I have the route notes here. Which segment should I verify?`);
  assert.equal(packetSeen.speaker.observer_id, coworker.personnel_id);
  assert.equal(packetSeen.authority_contract.response_authorization, "personnel-continuity-only");
  assert.doesNotMatch(JSON.stringify(packetSeen), /canonical_geometry|overlap_depth|future_event|random_seed/i);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "_local_dialogue_context"), false);
  assert.doesNotMatch(JSON.stringify(result), /reaction_context|_local_dialogue_context/i);
});

test("26 invalid hosted LOCAL prose falls back without retracting canonical delivery", async () => {
  const localDialogueProvider = { name:"invalid-local", async presentLocal(packet) { return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id, speech:"You decide to measure the hidden overlap depth." }; } };
  const { service, world, run } = fixture("living-local-fallback", { localDialogueProvider });
  const coworker = run.expedition.team.members.find((member) => member.personnel_id !== player(run));
  const beforeMessages = run.expedition.messages.length;
  const result = await service.submitQ4Communication({ world_id:world.id, channel:"local", target:coworker.first_name, text:"Can you verify the route notes?" });
  assert.equal(result.ok, true);
  assert.equal(run.expedition.messages.length, beforeMessages + 1);
  assert.equal(result.result.provider_unavailable, true);
  assert.equal(result.result.presentation_source, "deterministic-fallback");
  assert.match(result.result.public_reason, /invalid response.*Deterministic response:/i);
  assert.doesNotMatch(result.result.public_reason, /hidden overlap depth/i);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "_local_dialogue_context"), false);
});
