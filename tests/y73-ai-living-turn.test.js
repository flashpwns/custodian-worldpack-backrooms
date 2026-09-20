"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const equipment = require("../tools/q4-equipment");
const { projectLiveScene } = require("../tools/live-scene-projection");
const { createLivingProvider } = require("../tools/ai-living-provider");
const { createOpenAIProvider } = require("../tools/ai-openai-provider");
const { PROPOSAL_VERSION } = require("../tools/ai-interpreter-boundary");
const { PRESENTATION_VERSION, buildProviderPacket, executeLivingTurn, validatePresentation } = require("../tools/ai-living-turn");
const { CANDIDATE_VERSION:LOCAL_CANDIDATE_VERSION } = require("../tools/ai-local-dialogue");
const q4Interactions = require("../tools/q4-interactions");
const aiLocalDialogue = require("../tools/ai-local-dialogue");
const personnelContinuity = require("../tools/q4-personnel-continuity");

// Execute the production composer listener, including request-ID lifetime,
// against the real service. The DOM shell is deliberately minimal; this is
// renderer/service integration evidence, not a native Electron acceptance run.
function communicationComposer(service, world) {
  const source = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const start = source.indexOf('  commsForm?.addEventListener("submit"');
  const end = source.indexOf('  app.querySelectorAll("[data-spatial-mode]")', start);
  assert.ok(start >= 0 && end > start, "Production communication listener must be present");
  let listener, completion, nextId = 0;
  const run = service.session(world.id, "field-researcher").run;
  const fields = { channel:"local", target:survey(run).first_name, text:"I get nervous around loud machinery." };
  const calls = [];
  const current = { world, pendingCommunication:null };
  vm.runInNewContext(source.slice(start, end), {
    current,
    commsForm:{ addEventListener(type, callback) { assert.equal(type, "submit"); listener = callback; } },
    FormData:class { get(key) { return fields[key]; } },
    crypto:{ randomUUID() { return `composer-recovery-${++nextId}`; } },
    yellowBeast:{ submitQ4Communication(input) { calls.push(structuredClone(input)); return service.submitQ4Communication(input); } },
    resultIsError:result => result?.ok === false || Boolean(result?.error),
    submitTurn(kind, request) { assert.equal(kind, "communication"); completion = request(); }
  });
  return { current, calls, fields, async submit() { listener({ preventDefault() {} }); return await completion; } };
}

function failNextDialogueFinalization(service) {
  const commit = service.commitPersistencePair.bind(service);
  let count = 0;
  service.commitPersistencePair = (...args) => {
    if (++count === 2) throw new Error("Injected reply finalization write failure");
    return commit(...args);
  };
  return () => { service.commitPersistencePair = commit; };
}

function deliveredDialogueState(service, world, workerId) {
  const run = service.session(world.id, "field-researcher").run;
  const person = service.getWorld(world.id).characters[workerId];
  return {
    messages:run.expedition.messages.length,
    interactions:run.expedition.interaction_history.length,
    trust:person.continuity.attitudes[player(run)].trust,
    reactions:person.continuity.reaction_history.length,
    receivedMemories:person.continuity.dialogue_memories.filter(memory => !memory.response).length
  };
}

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
  assert.match(surfaces.render(checked.projection), /<button\b[^>]*data-game-action="CROSS"[^>]*>Cross Threshold<\/button>/);
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

test("26a hosted LOCAL prose cannot omit grounding for a new factual claim", () => {
  const { service, world, run } = fixture("living-local-unsupported-fact");
  const coworker = survey(run);
  const packet = aiLocalDialogue.buildLocalDialoguePacket({
    run,
    player_text:"Do you know another way out?",
    speaker:coworker,
    person:service.getWorld(world.id).characters[coworker.personnel_id],
    reaction_context:{ worker:coworker, equipment:[] },
    reaction:{ category:"question" }
  });
  const validation = aiLocalDialogue.validateLocalDialogue(packet, {
    version:LOCAL_CANDIDATE_VERSION,
    observer_id:coworker.personnel_id,
    speech:"I served here for ten years; there is an exit behind that wall."
  }, run);
  assert.equal(validation.ok, false);
  assert.equal(validation.code, "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED");

  const unrelated = aiLocalDialogue.validateLocalDialogue(packet, {
    version:LOCAL_CANDIDATE_VERSION,
    observer_id:coworker.personnel_id,
    speech:"I served here for ten years; there is an exit behind that wall.",
    semantic_claims:[{ type:"location", subject:coworker.personnel_id, location_id:run.spatial.personnel_locations[coworker.personnel_id] }]
  }, run);
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.code, "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED", "An unrelated valid claim cannot cover unsupported factual prose");

  const unknownType = aiLocalDialogue.validateLocalDialogue(packet, {
    version:LOCAL_CANDIDATE_VERSION,
    observer_id:coworker.personnel_id,
    speech:"All right. I will stay with what I can verify.",
    semantic_claims:[{ type:"invented-history", text:"I served here" }]
  }, run);
  assert.equal(unknownType.ok, false);
  assert.equal(unknownType.code, "SEMANTIC_CLAIM_TYPE_UNSUPPORTED");
});

test("27 getRecentDialogue filters by participant provenance and preserves co-located overhearing", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-provenance-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Provenance", seed: "provenance-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;
  const expedition = run.expedition;
  const playerId = run.session.startup.player.observer_id;
  const santiago = expedition.team.members.find((m) => m.first_name === "Santiago");
  const beverly = expedition.team.members.find((m) => m.first_name === "Beverly");
  const matthew = expedition.team.members.find((m) => m.first_name === "Matthew") ?? { personnel_id: "personnel-matthew", display_name: "Matthew Vance" };

  // 1. Different listeners per side: Private statement to Beverly, reply heard by Beverly and Santiago
  q4Interactions.record(expedition, {
    channel: "local",
    speaker: "You",
    speaker_id: playerId,
    targets: [beverly.display_name],
    recipient_ids: [beverly.personnel_id],
    listeners: [beverly.personnel_id],
    player_text: "Beverly, confidential route note without Santiago.",
    presentation: { response: "Understood, Casey." },
    response_speaker: beverly.first_name,
    response_speaker_id: beverly.personnel_id,
    response_listeners: [playerId, santiago.personnel_id]
  });

  // Santiago heard only the reply, not the initiating statement:
  const santiagoTurns = aiLocalDialogue.getRecentDialogue(expedition, playerId, santiago.personnel_id);
  assert.equal(santiagoTurns.some((t) => (t.player_text || "").includes("confidential route note")), false, "Hearing the reply must not grant access to the original unheard statement");
  assert.equal(santiagoTurns.some((t) => t.response?.includes("Understood, Casey.")), true, "Santiago heard the reply");
  const santiagoHeardReplyTurn = santiagoTurns.find((t) => t.response?.includes("Understood, Casey."));
  assert.equal(santiagoHeardReplyTurn.player_text, null, "player_text must be null for unheard initiating statement");

  // Beverly was direct recipient of initiating statement and speaker of reply:
  const beverlyTurns = aiLocalDialogue.getRecentDialogue(expedition, playerId, beverly.personnel_id);
  assert.equal(beverlyTurns.some((t) => (t.player_text || "").includes("confidential route note")), true, "Beverly heard her direct message");
  assert.equal(beverlyTurns.some((t) => t.response?.includes("Understood, Casey.")), true, "Beverly spoke the reply");

  // 2. Absent NPC: Matthew was in another location during the entire exchange
  const matthewTurns = aiLocalDialogue.getRecentDialogue(expedition, playerId, matthew.personnel_id);
  assert.equal(matthewTurns.length, 0, "Absent NPC must not see conversations where they were neither participant nor listener");

  // 3. Arrival / departure: Teammate departs between utterances (heard initiating statement, departed before reply)
  q4Interactions.record(expedition, {
    channel: "local",
    speaker: "You",
    speaker_id: playerId,
    targets: [beverly.display_name],
    recipient_ids: [beverly.personnel_id],
    listeners: [beverly.personnel_id, santiago.personnel_id],
    player_text: "Santiago, note this corridor before you step out.",
    presentation: { response: "Copy that, I'm heading out." },
    response_speaker: santiago.first_name,
    response_speaker_id: santiago.personnel_id,
    response_listeners: [playerId]
  });
  const beverlyDepartedTurns = aiLocalDialogue.getRecentDialogue(expedition, playerId, beverly.personnel_id);
  const beverlySawStatementOnly = beverlyDepartedTurns.find((t) => (t.player_text || "").includes("step out"));
  assert.ok(beverlySawStatementOnly, "Beverly was present for initiating statement");
  assert.equal(beverlySawStatementOnly.response, null, "Beverly must not see reply spoken after departure");

  // 4. Room-wide speech: co-located overhearing
  q4Interactions.record(expedition, {
    channel: "local",
    speaker: "You",
    speaker_id: playerId,
    targets: [beverly.display_name],
    recipient_ids: [beverly.personnel_id],
    listeners: [beverly.personnel_id, santiago.personnel_id],
    player_text: "Beverly, speaking aloud in the room with Santiago.",
    presentation: { response: "I hear you, Casey." },
    response_speaker: beverly.first_name,
    response_speaker_id: beverly.personnel_id,
    response_listeners: [playerId, santiago.personnel_id]
  });
  const santiagoOverheard = aiLocalDialogue.getRecentDialogue(expedition, playerId, santiago.personnel_id);
  assert.equal(santiagoOverheard.some((t) => (t.player_text || "").includes("speaking aloud in the room")), true, "Santiago MUST see exchange he overheard as a co-located listener");

  // 5. Subsequent reporting: Beverly reports knowledge to Standard
  q4Interactions.record(expedition, {
    channel: "standard",
    speaker: "Beverly",
    speaker_id: beverly.personnel_id,
    targets: ["Standard"],
    recipient_ids: ["Standard"],
    listeners: ["Standard"],
    player_text: "Standard, Beverly reporting observed corridor status.",
    presentation: { result: "delivered" }
  });
  const reportInteraction = expedition.interaction_history.find((e) => e.channel === "standard");
  assert.ok(reportInteraction, "Radio report must be recorded");
  assert.equal(reportInteraction.speaker, "Beverly");
  assert.deepEqual(reportInteraction.targets, ["Standard"]);
  const beverlyRecentAfterReport = aiLocalDialogue.getRecentDialogue(expedition, playerId, beverly.personnel_id);
  assert.equal(beverlyRecentAfterReport.some((t) => (t.player_text || "").includes("reporting observed corridor")), false, "Radio transmission must not leak into LOCAL dialogue buffer");

  // 6. Separate-world isolation: Conversation in World 1 does not leak to World 2
  const world2 = service.createWorld({ name: "World 2", seed: "world2-seed" }).world;
  service.createQ4Personnel({ world_id: world2.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world2.id, mode: "field-researcher", require_personnel: true });
  const run2 = service.session(world2.id, "field-researcher").run;
  const world2SantiagoDialogue = aiLocalDialogue.getRecentDialogue(run2.expedition, playerId, santiago.personnel_id);
  assert.equal(world2SantiagoDialogue.length, 0, "Separate world must have isolated interaction history");
});

test("28 relevant-memory retrieval retrieves earlier NPC reply beyond last-six buffer", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-memory-retrieval-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Memory", seed: "memory-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;
  const expedition = run.expedition;
  const playerId = run.session.startup.player.observer_id;
  const santiago = expedition.team.members.find((m) => m.first_name === "Santiago");

  // Turn 1 exchange
  q4Interactions.record(expedition, {
    channel: "local",
    speaker: "You",
    speaker_id: playerId,
    targets: [santiago.display_name],
    recipient_ids: [santiago.personnel_id],
    listeners: [santiago.personnel_id],
    player_text: "Santiago, I get nervous in tight spaces.",
    presentation: { response: "We will keep that in mind and stay steady." },
    response_speaker: santiago.first_name,
    response_speaker_id: santiago.personnel_id,
    response_listeners: [playerId]
  });
  const canonicalWorld = service.getWorld(world.id);
  personnelContinuity.recordDialogueMemory(canonicalWorld, {
    run_id: run.run_id,
    identity: santiago.personnel_id,
    player_text: "Santiago, I get nervous in tight spaces.",
    response: "We will keep that in mind and stay steady.",
    source: "local-communication",
    sender: playerId,
    at: 0
  });
  service.saveCanonical(canonicalWorld);

  // Push 9 routine turns
  for (let i = 1; i <= 9; i++) {
    q4Interactions.record(expedition, {
      channel: "local",
      speaker: "You",
      speaker_id: playerId,
      targets: [santiago.display_name],
      recipient_ids: [santiago.personnel_id],
      listeners: [santiago.personnel_id],
      player_text: `Routine observation ${i}`,
      presentation: { response: `Acknowledged ${i}.` },
      response_speaker: santiago.first_name,
      response_speaker_id: santiago.personnel_id,
      response_listeners: [playerId]
    });
  }

  // Verify Turn 1 is absent from recent_dialogue buffer
  const recent = aiLocalDialogue.getRecentDialogue(expedition, playerId, santiago.personnel_id);
  assert.equal(recent.some((t) => t.player_text.includes("tight spaces")), false, "Turn 1 must be pushed out of 6-turn recent dialogue");

  // Build packet requesting earlier reply
  const packet = aiLocalDialogue.buildLocalDialoguePacket({
    run,
    player_text: "What was your reply when I told you I get nervous in tight spaces?",
    speaker: santiago,
    person: service.getWorld(world.id).characters[santiago.personnel_id],
    reaction_context: { worker: santiago, equipment: [] },
    reaction: { category: "acknowledgment" }
  });

  assert.ok(packet.speaker.relevant_memories.some((m) => m.response?.includes("We will keep that in mind and stay steady.")));
  assert.ok(packet.speaker.memories.some((m) => m.response?.includes("We will keep that in mind and stay steady.")));

  // Deterministic recall answer
  const answer = personnelContinuity.presentKnownAnswer(run, santiago.personnel_id, "What was your reply when I told you I get nervous in tight spaces?", service.getWorld(world.id));
  assert.match(answer, /Santiago: I replied: “We will keep that in mind and stay steady.”/);
});

test("29 attributable attitude changes modulate behavior, salience, and response tone", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-attitude-mod-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Attitude", seed: "attitude-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;
  const playerId = run.session.startup.player.observer_id;
  const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");

  const personBefore = service.getWorld(world.id).characters[santiago.personnel_id];
  const initialAttitude = personnelContinuity.getAttitude(personBefore, playerId);
  assert.equal(initialAttitude.trust, 55);
  assert.equal(initialAttitude.disposition, "cooperative");

  // Submit personal disclosure
  const commRes = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "I prefer being called Casey, and I get nervous in tight spaces."
  });
  assert.equal(commRes.ok, true);

  const personAfter = service.getWorld(world.id).characters[santiago.personnel_id];
  const updatedAttitude = personnelContinuity.getAttitude(personAfter, playerId);
  assert.ok(updatedAttitude.trust > initialAttitude.trust, "Trust must increase upon open disclosure");
  assert.equal(updatedAttitude.disposition, "supportive");
  assert.ok(updatedAttitude.attributions.length > 0);
  assert.match(updatedAttitude.attributions.at(-1).reason, /Player shared working preferences/);

  // Behavioral impact: decide risk compliance
  const baseDecisionContext = personnelContinuity.decisionContext({
    world: service.getWorld(world.id),
    run,
    phase: "FIELD_OPERATION",
    worker_id: santiago.personnel_id,
    request: { perceived_risk: 60 }
  });
  const decision = personnelContinuity.decide(baseDecisionContext);
  assert.equal(decision.state, "accepted", "Higher trust increases compliance threshold");

  // Tone check
  const supportiveReaction = personnelContinuity.presentReaction(personAfter, { category: "acknowledgment" }, "I get nervous in tight spaces.", playerId);
  assert.match(supportiveReaction, /You can count on me/);
  assert.doesNotMatch(supportiveReaction, /I heard you about/);
});

test("29a formal radio check-in changes only locally present coworker attitudes", () => {
  const { service, world, run } = fixture("check-in-attitude-observer-boundary", { openPassage:false });
  const coworker = survey(run);
  run.spatial.personnel_locations[coworker.personnel_id] = "relay-alcove";
  const person = service.getWorld(world.id).characters[coworker.personnel_id];
  const playerId = player(run);
  const before = structuredClone(personnelContinuity.getAttitude(person, playerId));
  const checked = service.submitQ4CheckIn({ world_id:world.id, hold_duration_ms:2050 });
  assert.equal(checked.ok, true);
  assert.deepEqual(personnelContinuity.getAttitude(person, playerId), before, "An absent coworker cannot gain trust from a check-in they did not hear");
});

test("30 attitude, relationship, and relevant memories survive persistence restart and new operation", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-attitude-restart-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Restart World", seed: "restart-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;
  const playerId = run.session.startup.player.observer_id;
  const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");

  service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "I prefer being called Casey."
  });

  const worldStateBefore = service.getWorld(world.id);
  const santiagoBefore = worldStateBefore.characters[santiago.personnel_id];
  const trustBefore = santiagoBefore.continuity.attitudes[playerId].trust;

  // Restart service with new instance on same storage
  const service2 = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const worldStateAfter = service2.getWorld(world.id);
  const santiagoAfter = worldStateAfter.characters[santiago.personnel_id];

  assert.equal(santiagoAfter.continuity.attitudes[playerId].trust, trustBefore, "Trust must survive restart");
  assert.equal(santiagoAfter.continuity.attitudes[playerId].disposition, "supportive", "Disposition must survive restart");

  // Start new operation with same NPC
  service2.startSession({ world_id: world.id, mode: "field-researcher", seed: "next-op-seed", require_personnel: true });
  const newRun = service2.session(world.id, "field-researcher").run;
  const sameSantiago = newRun.expedition.team.members.find((m) => m.personnel_id === santiago.personnel_id);
  assert.ok(sameSantiago);

  const packet = aiLocalDialogue.buildLocalDialoguePacket({
    run: newRun,
    player_text: "What did I ask you to call me on our last run?",
    speaker: sameSantiago,
    person: service2.getWorld(world.id).characters[sameSantiago.personnel_id],
    reaction_context: { worker: sameSantiago, equipment: [] },
    reaction: { category: "acknowledgment" }
  });

  assert.equal(packet.speaker.relationship.disposition, "supportive");
  assert.ok(packet.speaker.memories.some((m) => m.player_text.includes("prefer being called Casey")));
});

test("31 dialogue communication and attitude mutation are idempotent against retries", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-retry-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Retry World", seed: "retry-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;
  const playerId = run.session.startup.player.observer_id;
  const santiago = run.expedition.team.members.find((m) => m.first_name === "Santiago");

  const getTrust = () => service.getWorld(world.id).characters[santiago.personnel_id].continuity.attitudes[playerId].trust;

  const input = {
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "I get nervous around loud machinery.",
    request_id: "retry-id-01",
    submission_id: "retry-id-01"
  };

  const n0 = run.expedition.interaction_history.length;
  const res1 = service.submitQ4Communication(input);
  assert.equal(res1.ok, true);
  const n1 = run.expedition.interaction_history.length;
  const trust1 = getTrust();
  assert.equal(n1, n0 + 1, "First submission must record one interaction");
  assert.ok(trust1 > 55, "Personal disclosure must increase trust");

  // Immediate retry with same request_id and payload
  const res2 = service.submitQ4Communication(input);
  assert.equal(res2.ok, true);
  const n2 = run.expedition.interaction_history.length;
  const trust2 = getTrust();
  assert.equal(n2, n1, "Same request retry must not duplicate conversation interactions");
  assert.equal(trust2, trust1, "Same request retry must not apply attitude delta twice");
  assert.equal(res2.result?.duplicate, true, "Duplicate flag must be set on retry");

  // Persistence restart test: retry across new service instance on same storage
  const service2 = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const resRestartRetry = service2.submitQ4Communication(input);
  assert.equal(resRestartRetry.ok, true);
  assert.equal(resRestartRetry.result?.duplicate, true);
  const savedSession = JSON.parse(fs.readFileSync(service2.sessionFile(world.id, "field-researcher"), "utf8"));
  assert.equal(savedSession.payload.expedition.interaction_history.length, n1, "Retry after restart must not duplicate interaction entry");
  const trustRestart = service2.getWorld(world.id).characters[santiago.personnel_id].continuity.attitudes[playerId].trust;
  assert.equal(trustRestart, trust1, "Retry after restart must not apply attitude delta twice");
});

test("32 reused request_id with different payload is rejected without mutation", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-conflict-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "Conflict World", seed: "conflict-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;

  const res1 = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "First instruction",
    request_id: "conflict-id-01"
  });
  assert.equal(res1.ok, true);
  const n1 = run.expedition.interaction_history.length;

  // Reusing same request_id with DIFFERENT payload
  const res2 = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "Different instruction entirely",
    request_id: "conflict-id-01"
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.error?.code, "REQUEST_ID_REUSED");
  assert.equal(run.expedition.interaction_history.length, n1, "Conflicting request must not mutate interactions");
});

test("33 new request_id with identical text succeeds as a legitimate new utterance", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-newreq-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "reference-expedition" });
  const world = service.createWorld({ name: "NewReq World", seed: "newreq-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;

  const res1 = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "Can you hear me?",
    request_id: "req-01"
  });
  assert.equal(res1.ok, true);
  const n1 = run.expedition.interaction_history.length;

  // Same text, new request_id
  const res2 = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "Can you hear me?",
    request_id: "req-02"
  });
  assert.equal(res2.ok, true);
  assert.equal(run.expedition.interaction_history.length, n1 + 1, "New request_id with identical text must advance turn");
});

test("34 concurrent duplicate requests produce one canonical effect via in-flight tracking", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-concurrent-"));
  let providerCalls = 0;
  const mockProvider = {
    name: "async-test-provider",
    async presentLocal(packet) {
      providerCalls++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        version: aiLocalDialogue.CANDIDATE_VERSION,
        observer_id: packet.speaker.observer_id,
        speech: "Understood and acknowledged."
      };
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: mockProvider
  });
  const world = service.createWorld({ name: "Concurrent World", seed: "concurrent-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  const run = service.session(world.id, "field-researcher").run;

  const input = {
    world_id: world.id,
    channel: "local",
    target: "Santiago",
    text: "I get nervous in tight spaces.",
    request_id: "concurrent-req-01"
  };

  const [resA, resB] = await Promise.all([
    service.submitQ4Communication(input),
    service.submitQ4Communication(input)
  ]);

  assert.equal(resA.ok, true);
  assert.equal(resB.ok, true);
  assert.equal(providerCalls, 1, "Provider must be invoked only once for concurrent duplicate requests");
  assert.equal(run.expedition.interaction_history.length, 1, "Only one canonical interaction must be recorded");
});

test("35 delayed provider response does not overwrite a newer operation and commandBusy guards inflight turns", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-late-"));
  const reply = "All right. We can talk about that here.";
  let resolveReply, markStarted;
  const started = new Promise((r) => { markStarted = r; });
  const delayedProvider = {
    name: "delayed-provider",
    async presentLocal(packet) {
      markStarted();
      await new Promise((r) => { resolveReply = r; });
      return {
        version: aiLocalDialogue.CANDIDATE_VERSION,
        observer_id: packet.speaker.observer_id,
        speech: reply
      };
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: delayedProvider
  });
  const world = service.createWorld({ name: "Late World", seed: "late-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).ok, true);

  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);

  const oldRun = service.session(world.id, "field-researcher").run;
  const peer = oldRun.expedition.team.members.find((m) => m.role === "survey technician");

  const turn = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: peer.first_name,
    text: "I prefer straightforward answers.",
    request_id: "pending-op-01"
  });

  await started;
  assert.equal(service.commandBusy(world.id), true, "commandBusy must be true while communication is in flight");

  const busyAction = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
  assert.equal(busyAction.ok, false);
  assert.equal(busyAction.error?.code, "SESSION_BUSY");

  const busyStart = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "next-seed", require_personnel: true });
  assert.equal(busyStart.ok, false);
  assert.equal(busyStart.error?.code, "SESSION_BUSY");

  const next = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "next-seed", require_personnel: true, force: true });
  assert.equal(next.ok, true);
  const nextId = service.session(world.id, "field-researcher").run.run_id;
  assert.notEqual(nextId, oldRun.run_id, "New operation must have a different run_id");
  assert.ok(service.getWorld(world.id).runs[nextId], "New run must exist in world.runs before reply");

  resolveReply();
  const completed = await turn;
  assert.equal(completed.ok, false, "Late reply for superseded operation must not succeed");
  assert.equal(completed.error?.code, "OPERATION_SUPERSEDED");

  assert.ok(service.getWorld(world.id).runs[nextId], "New operation run must not be erased from world.runs");
  const disk = JSON.parse(fs.readFileSync(service.sessionFile(world.id, "field-researcher"), "utf8"));
  assert.equal(disk.payload.run_id, nextId, "Session file must remain pointing to the new operation");
});

test("36 persisted completed receipts replay fresh projection containing generated reply after restart", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-restart-"));
  const reply = "All right. We can talk about that here.";
  const mockProvider = {
    name: "audit-mock",
    async presentLocal(packet) {
      return {
        version: aiLocalDialogue.CANDIDATE_VERSION,
        observer_id: packet.speaker.observer_id,
        speech: reply
      };
    }
  };
  let service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: mockProvider
  });
  const world = service.createWorld({ name: "Restart World", seed: "restart-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).ok, true);

  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);

  const peer = service.session(world.id, "field-researcher").run.expedition.team.members.find((m) => m.role === "survey technician");
  const input = {
    world_id: world.id,
    channel: "local",
    target: peer.first_name,
    text: "I prefer straightforward answers.",
    request_id: "hosted-restart-01"
  };

  const first = await service.submitQ4Communication(input);
  assert.equal(first.ok, true);
  assert.equal(first.result.presentation_source, "hosted-model");
  assert.ok(surfaces.render(first.projection).includes(reply));

  service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: mockProvider
  });
  assert.equal(service.resumeSession({ world_id: world.id, mode: "field-researcher" }).ok, true);

  const retry = await service.submitQ4Communication(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.result.duplicate, true);
  assert.equal(retry.result.public_reason, `${peer.display_name}: ${reply}`);
  assert.equal(retry.result.scene.narration, `${peer.display_name}: ${reply}`);
  assert.equal(retry.result.scene.narration_source, "hosted-model");
  assert.ok(surfaces.render(retry.projection).includes(reply), "Rendered projection on retry must include generated reply");

  const fresh = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" });
  assert.ok(surfaces.render(fresh.projection).includes(reply), "Fresh gameplay projection must include generated reply");
});

test("37 finalization persistence failure rolls back reply state without undoing player delivery", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-atomic-"));
  const reply = "Understood, Casey. Message received.";
  const mockProvider = {
    name: "atomic-mock",
    async presentLocal(packet) {
      return {
        version: aiLocalDialogue.CANDIDATE_VERSION,
        observer_id: packet.speaker.observer_id,
        speech: reply
      };
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: mockProvider
  });
  const world = service.createWorld({ name: "Atomic World", seed: "atomic-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).ok, true);

  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);

  const peer = service.session(world.id, "field-researcher").run.expedition.team.members.find((m) => m.role === "survey technician");

  let saveCount = 0;
  const originalCommit = service.commitPersistencePair.bind(service);
  service.commitPersistencePair = (...args) => {
    saveCount++;
    if (saveCount === 2) {
      throw new Error("Simulated storage write error during dialogue finalization");
    }
    return originalCommit(...args);
  };

  const input = {
    world_id: world.id,
    channel: "local",
    target: peer.first_name,
    text: "I get nervous in tight spaces.",
    request_id: "atomic-req-01"
  };

  const res = await service.submitQ4Communication(input);
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.doesNotMatch(res.error?.message, /Language assistance is unavailable/i, "Must not relabel storage failure as provider outage");

  const run = service.session(world.id, "field-researcher").run;
  const receipt = run.expedition.communication_receipts.find((r) => r.id === "atomic-req-01");
  assert.ok(receipt, "Player communication receipt must remain committed");
  assert.equal(receipt.status, "failed", "Receipt status must be marked as failed");

  const peerPerson = service.getWorld(world.id).characters[peer.personnel_id];
  const memories = peerPerson?.continuity?.dialogue_memories ?? [];
  const replyCommitted = memories.some((m) => m.response === reply);
  assert.equal(replyCommitted, false, "Uncommitted reply must be rolled back from dialogue memory");

  service.commitPersistencePair = originalCommit;
  const retry = await service.submitQ4Communication(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.result.presentation_source, "hosted-model");
});

test("38 communication requests without IDs do not bypass transaction boundary", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-dialogue-noid-"));
  let resolveReply, markStarted;
  const started = new Promise((r) => { markStarted = r; });
  const delayedProvider = {
    name: "delayed-noid-provider",
    async presentLocal(packet) {
      markStarted();
      await new Promise((r) => { resolveReply = r; });
      return {
        version: aiLocalDialogue.CANDIDATE_VERSION,
        observer_id: packet.speaker.observer_id,
        speech: "Understood."
      };
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    localDialogueProvider: delayedProvider
  });
  const world = service.createWorld({ name: "NoID World", seed: "noid-seed" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).ok, true);

  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);

  const peer = service.session(world.id, "field-researcher").run.expedition.team.members.find((m) => m.role === "survey technician");

  const turn = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: peer.first_name,
    text: "Checking in."
  });

  await started;
  assert.equal(service.commandBusy(world.id), true, "commandBusy must be true even without user-provided request_id");

  const concurrent = service.submitQ4Communication({
    world_id: world.id,
    channel: "local",
    target: peer.first_name,
    text: "Another message while busy."
  });
  assert.equal(concurrent.ok, false);
  assert.equal(concurrent.error?.code, "SESSION_BUSY");

  resolveReply();
  const completed = await turn;
  assert.equal(completed.ok, true);

  const run = service.session(world.id, "field-researcher").run;
  const receipts = run.expedition.communication_receipts;
  assert.ok(receipts && receipts.length > 0, "Receipt must be recorded even when request_id was omitted");
  const lastReceipt = receipts[receipts.length - 1];
  assert.ok(lastReceipt.id.startsWith("desktop-comms-"), "Authoritative ID must be generated for receipt");
  assert.equal(lastReceipt.status, "completed");
});

test("39 renderer retries failed reply persistence with the original ID and no repeat delivery", async () => {
  const reply = "All right. We can talk about that here.";
  const provider = { name:"renderer-recovery", async presentLocal(packet) {
    return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id, speech:reply };
  } };
  const { service, world, run } = fixture("renderer-recovery", { localDialogueProvider:provider });
  const composer = communicationComposer(service, world);
  const restoreStorage = failNextDialogueFinalization(service);
  const failed = await composer.submit();
  assert.equal(failed.error?.code, "PERSISTENCE_COMMIT_FAILED");
  assert.equal(composer.calls[0].target, survey(run).first_name, "The visible recipient selector must reach the service boundary");
  const before = deliveredDialogueState(service, world, survey(run).personnel_id);
  const originalId = composer.calls[0].request_id;
  assert.equal(composer.current.pendingCommunication?.id, originalId, "Recoverable error must retain the composer request ID");
  restoreStorage();
  const recovered = await composer.submit();
  assert.equal(recovered.result?.presentation_source, "hosted-model");
  assert.equal(composer.calls[1].request_id, originalId);
  assert.deepEqual(deliveredDialogueState(service, world, survey(run).personnel_id), before);
  assert.equal(composer.current.pendingCommunication, null);
  assert.ok(surfaces.render(recovered.projection).includes(reply));
  await composer.submit();
  assert.notEqual(composer.calls[2].request_id, originalId, "Deliberate new speech may repeat the same words");
  assert.equal(run.expedition.interaction_history.length, before.interactions + 1);
});

for (const responseKind of ["generated", "provider-error", "invalid-response", "missing-key"]) {
  test(`40 ${responseKind} finalization save failure remains recoverable after restart`, async () => {
    const reply = "All right. We can talk about that here.";
    let providerCalls = 0;
    const provider = { name:"restart-recovery", async presentLocal(packet) {
      providerCalls++;
      if (responseKind === "provider-error") throw new Error("Injected transport timeout");
      return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id,
        speech:responseKind === "invalid-response" ? "You decide to leave the team behind." : reply };
    } };
    const { service, appDataPath, world, run } = fixture(`recovery-${responseKind}`, {
      localDialogueProvider:responseKind === "missing-key" ? null : provider
    });
    if (responseKind === "missing-key") {
      const settings = service.settings();
      service.settings = () => ({ ...settings, provider:"openai" });
      service.credentials = { get:() => null };
    }
    const input = { world_id:world.id, channel:"local", target:survey(run).first_name,
      text:"I get nervous around loud machinery.", request_id:`restart-recovery-${responseKind}` };
    const restoreStorage = failNextDialogueFinalization(service);
    const failed = await service.submitQ4Communication(input);
    assert.equal(failed.ok, false, "No finalization branch may hide a storage failure");
    assert.equal(failed.error?.code, "PERSISTENCE_COMMIT_FAILED");
    assert.match(failed.error.message, /message.*delivered/i);
    const before = deliveredDialogueState(service, world, survey(run).personnel_id);
    assert.equal(run.expedition.communication_receipts.find(r => r.id === input.request_id).status, "failed");
    assert.equal(service.getWorld(world.id).characters[survey(run).personnel_id].continuity.dialogue_memories.some(m => m.response === reply), false);
    restoreStorage();

    // Read only what was durable when the process failed; do not flush the old service.
    const restarted = new DesktopService({ appDataPath, localDialogueProvider:provider });
    assert.equal(restarted.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
    const recovered = await restarted.submitQ4Communication(input);
    assert.equal(recovered.ok, true);
    const expectedSource = ["generated", "missing-key"].includes(responseKind) ? "hosted-model" : "deterministic-fallback";
    assert.equal(recovered.result.presentation_source, expectedSource);
    assert.equal(providerCalls, responseKind === "missing-key" ? 1 : 2, "Unfinished reply must be finalized again after restart");
    assert.deepEqual(deliveredDialogueState(restarted, world, survey(run).personnel_id), before);
    const finalRun = restarted.session(world.id, "field-researcher").run;
    assert.equal(finalRun.expedition.communication_receipts.find(r => r.id === input.request_id).status, "completed");
    const reopened = new DesktopService({ appDataPath, localDialogueProvider:provider });
    assert.equal(reopened.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
    const duplicate = await reopened.submitQ4Communication(input);
    assert.equal(duplicate.result.duplicate, true);
    assert.equal(duplicate.result.public_reason, recovered.result.public_reason);
    assert.equal(duplicate.result.presentation_source, recovered.result.presentation_source);
    assert.equal(providerCalls, responseKind === "missing-key" ? 1 : 2);
    assert.deepEqual(deliveredDialogueState(reopened, world, survey(run).personnel_id), before);
  });
}

for (const recoveryMode of ["legacy-authorization", "switched-offline"]) {
  test(`41 pending reply recovers with ${recoveryMode} without replaying its reaction`, async () => {
    const categories = [];
    const provider = { name:"pending-recovery", async presentLocal(packet) {
      categories.push(packet.authorized_response.category);
      return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id, speech:"All right. We can talk about that here." };
    } };
    const { service, appDataPath, world, run } = fixture(`pending-${recoveryMode}`, { localDialogueProvider:provider });
    const input = { world_id:world.id, channel:"local", target:survey(run).first_name,
      text:"How do you feel about loud machinery?", request_id:`pending-${recoveryMode}` };
    const restore = failNextDialogueFinalization(service);
    assert.equal((await service.submitQ4Communication(input)).error.code, "PERSISTENCE_COMMIT_FAILED");
    restore();
    const before = deliveredDialogueState(service, world, survey(run).personnel_id);
    if (recoveryMode === "legacy-authorization") {
      // Existing saves predate response_category. Their original canonical
      // reaction still authorizes this reply; a retry must not react again.
      const receipt = run.expedition.communication_receipts.find(item => item.id === input.request_id);
      delete receipt.response_category;
      receipt.status = "pending";
      service.persistSession(service.getWorld(world.id), "field-researcher", service.session(world.id, "field-researcher"));
    }
    const restarted = new DesktopService({ appDataPath,
      localDialogueProvider:recoveryMode === "switched-offline" ? null : provider });
    assert.equal(restarted.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
    const result = await restarted.submitQ4Communication(input);
    assert.equal(result.ok, true);
    assert.equal(result.result.presentation_source, recoveryMode === "switched-offline" ? "deterministic-fallback" : "hosted-model");
    assert.deepEqual(categories, recoveryMode === "switched-offline" ? ["question"] : ["question", "question"]);
    assert.deepEqual(deliveredDialogueState(restarted, world, survey(run).personnel_id), before);
    const reopened = new DesktopService({ appDataPath });
    assert.equal(reopened.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
    const duplicate = await reopened.submitQ4Communication(input);
    assert.equal(duplicate.result.duplicate, true);
    assert.equal(duplicate.result.public_reason, result.result.public_reason);
  });
}

test('Remembered preferences retain speaker attribution and never become a fabricated name', () => {
  const original = 'Please call me Morgan. When I get nervous I prefer short, clear instructions.';
  const run = { expedition: { team: { members: [{ personnel_id: 'coworker', first_name: 'Carolyn', known_information: [{ kind: 'reported-knowledge', text: original }] }] } } };
  const answer = personnelContinuity.presentKnownAnswer(run, 'coworker', 'Remember my preference?');
  assert.equal(answer, `Carolyn: I remember what you told me: “${original}”.`);
  assert.doesNotMatch(answer, /called Morgan\. When I/);
});

test('LOCAL recall after restart exposes delivered history, not its own pending fallback', async () => {
  const seen = [];
  const provider = { name:'history-probe', async presentLocal(packet) {
    seen.push(structuredClone(packet));
    return { version:LOCAL_CANDIDATE_VERSION, observer_id:packet.speaker.observer_id, speech:'Short and clear. Understood.', semantic_claims:[] };
  } };
  const { service, appDataPath, world, run } = fixture('recall-pending-history', { localDialogueProvider:provider });
  const coworker = survey(run);
  const preference = 'Please call me Morgan. When I get nervous I prefer short, clear instructions.';
  await service.submitQ4Communication({ world_id:world.id, channel:'local', target:coworker.first_name, text:preference });
  service.shutdown();
  const restarted = new DesktopService({ appDataPath, localDialogueProvider:provider });
  assert.equal(restarted.resumeSession({ world_id:world.id, mode:'field-researcher' }).ok, true);
  const question = 'What did I ask you to remember about how I like instructions?';
  const result = await restarted.submitQ4Communication({ world_id:world.id, channel:'local', target:coworker.first_name, text:question });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 2);
  const packet = seen[1];
  assert.equal(packet.player_message.text, question);
  assert.ok(packet.speaker.recent_dialogue.some(item => item.player_text === preference && item.response === 'Short and clear. Understood.'));
  assert.ok(packet.speaker.memories.some(item => item.player_text === preference));
  assert.equal(packet.speaker.recent_dialogue.some(item => item.player_text === question), false, 'The pending response is not delivered dialogue history');
  assert.doesNotMatch(JSON.stringify(packet), /I remember what you told me/);
  restarted.shutdown();
});
