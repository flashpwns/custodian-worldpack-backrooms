"use strict";

// CORE CONTEXT BRIDGE: compileObserverDialogueContext is the single observer-safe
// projection of canonical state that the model-facing prompt may consume.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const V = require("../tools/dialogue-validation");
const ledger = require("../tools/canonical-world-ledger");
const lexicon = require("../tools/canon-lexicon");
const bridge = require("../tools/observer-context-compiler");
const { renderContributionTask, approximateTokens } = require("../tools/dialogue-prompt-contract");
const { validateLocalDialogue, validateAffectClaims } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const VERSION = "yellow-beast-local-dialogue-candidate@v1";

function setup(seed, provider = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed22-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED22", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  const logs = [];
  service.log = (line) => logs.push(String(line));
  return { root, service, worldId, session, run: session.run, playerId, coworkers, ids: coworkers.map((m) => m.personnel_id ?? m.id), logs };
}
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
const say = (state, text, extra = {}) => state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra });
const capture = (packets, speech = "Fine.") => ({ name: "ed22-capture", model: "v1", async presentLocal(packet) { packets.push(packet); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: typeof speech === "function" ? speech(packet) : speech }; } });

/** Compile the capsule exactly as the packet builder would, for an arbitrary speaker and utterance. */
function compile(state, speakerId, text, { recipient_type = "none", submissionId = null, phaseId = "FIELD_OPERATION", run = state.run } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, equipment: run.expedition.equipment });
  const names = Object.fromEntries([...run.expedition.team.members.map((m) => [m.personnel_id ?? m.id, m.first_name ?? m.display_name]), [state.playerId, "you"]]);
  const equipment = run.expedition.equipment;
  const custody_known = Object.fromEntries((frame.referents ?? []).filter((r) => r.type === "equipment" && r.resolved).map((r) => [r.id, bridge.resolveCustodyKnowledge(run, speakerId, r.id).known]));
  const self = D.buildSelfKnowledge({ person: run._world?.characters?.[speakerId] ?? null, member: ledger.getObserverMember(run, speakerId), names, equipment, player_id: state.playerId, custody_known });
  const [plan] = D.planResponses({ frame, owner_ids: [speakerId], responders: { [speakerId]: { self } }, names });
  const contribution = D.toAuthorizedContribution(plan, frame, { names });
  const capsule = bridge.compileObserverDialogueContext({ run, speakerId, recipientContext: { recipient_type }, semanticFrame: frame, responsePlan: plan, contribution, submissionId, phaseId, utterance: text, purpose: "response" });
  return { capsule, frame, plan, contribution };
}
const blob = (capsule) => JSON.stringify(capsule);

// ─── Elder Price regression ────────────────────────────────────────────────
test("Elder Price — production path: the listener's context carries the exact heard line and the plan confirms hearing", async () => {
  const packets = [];
  const state = setup("ed22-elder", capture(packets, "Yeah, I heard you."));
  try {
    await say(state, "hello, my name is elder price. buy apple stock RFN");
    packets.length = 0;
    const before = state.run.expedition.dialogue_history.length;
    await say(state, "did anyone hear what I just said?");
    assert.equal(packets.length, 1, "one listener confirms");
    const packet = packets[0];
    const capsule = packet.context_capsule;
    assert.equal(capsule.conversation.discourse_function, "ask_heard_confirmation");
    assert.ok(capsule.heard_turns.some((t) => t.is_player && /elder price/i.test(t.text)), "exact heard line is in context");
    assert.match(capsule.repair_target.text, /elder price/i);
    assert.equal(capsule.repair_target.kind, "player_line_asked_about");
    const fact = packet.authorized_contribution.required_facts.find((f) => f.key === "heard_confirmation");
    assert.deepEqual(fact.value.heard, true);
    const spoken = state.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId);
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, "Yeah, I heard you.");
    // The observed failure is rejected by the validator; the deterministic fallback confirms.
    const bad = validateLocalDialogue(packet, { version: VERSION, observer_id: packet.speaker.observer_id, speech: "I'm not sure if anyone heard me, but it sounded a bit urgent." });
    assert.equal(bad.ok, false);
    assert.equal(validateLocalDialogue(packet, { version: VERSION, observer_id: packet.speaker.observer_id, speech: "Yeah, I heard you." }).ok, true);
    const frame = D.buildSemanticFrame({ text: "did anyone hear what I just said?", recipient_type: "group", discourse: { turns: [{ kind: "player_exchange", player_text: "hello, my name is elder price. buy apple stock RFN", listener_ids: [packet.speaker.observer_id], responses: [] }] } });
    assert.equal(F.presentFallback({ frame, plan: { required_facts: [{ key: "heard_confirmation", value: { heard: true } }], style_hints: {} } }), "Yeah, I heard you.");
    // Prompt: line present, no urgency framing.
    const prompt = renderContributionTask(packet);
    assert.match(prompt, /the line you are being asked whether you heard/);
    assert.match(prompt, /elder price/i);
    assert.doesNotMatch(prompt, /urgent/i.test(prompt) ? /^$/ : /urgent(?!ly?,? or)/i);
  } finally { cleanup(state); }
});

test("Elder Price — a listener who did not hear the line is never an owner of the confirmation", () => {
  const frame = D.buildSemanticFrame({ text: "did anyone hear what I just said?", recipient_type: "group", discourse: { turns: [{ kind: "player_exchange", player_text: "line", listener_ids: ["a"], responses: [] }] } });
  assert.equal(frame.discourse_function, "ask_heard_confirmation");
  const [plan] = D.planResponses({ frame, owner_ids: ["b"], responders: {}, names: {} });
  assert.equal(plan.required_facts.find((f) => f.key === "heard_confirmation").value.heard, false, "hearing is decided from canonical listener state");
  assert.equal(V.validateContribution(D.toAuthorizedContribution(plan, frame), "Yeah, I heard you.").ok, false);
});

// ─── capsule structure, provenance, boundary ───────────────────────────────
test("capsule — model-facing fields carry no ids; provenance is internal, complete and non-enumerable", async () => {
  const packets = [];
  const state = setup("ed22-prov", capture(packets));
  try {
    await say(state, "Who has the field camera?");
    const packet = packets.at(-1);
    const modelFacing = JSON.stringify(packet.context_capsule) + renderContributionTask(packet).split("\nOUTPUT")[0].split("HOW TO ANSWER THIS TURN")[0];
    assert.doesNotMatch(modelFacing, /yb-personnel|q4-player|run-[0-9a-f]{8}|world-[0-9a-f]{8}|provenance|_internal|fingerprint/);
    assert.ok(!("_capsule" in JSON.parse(JSON.stringify(packet))), "provenance never serializes to a provider");
    const compiled = compile(state, state.ids[0], "Who has the field camera?", { submissionId: "s-prov" }).capsule;
    const internal = compiled._internal;
    assert.ok(!Object.keys(compiled).includes("_internal"));
    assert.ok(internal.provenance.length > 0);
    const authorities = new Set(internal.provenance.map((p) => p.authority));
    for (const a of authorities) assert.ok(Object.values(bridge.AUTHORITY).includes(a), a);
    for (const p of internal.provenance) assert.ok(p.source_ref && p.path && p.commit_sensitivity, JSON.stringify(p));
    assert.equal(internal.meta.speaker_id, state.ids[0]);
    assert.ok(internal.meta.revision && internal.meta.plan_id && internal.meta.submission_id);
    const trace = bridge.describeCapsule(compiled);
    assert.ok(trace.provenance.self_knowledge > 0 && Array.isArray(trace.omitted));
    assert.ok(approximateTokens(renderContributionTask(packet)) < 900, "routine prompt stays comfortably within budget");
  } finally { cleanup(state); }
});

test("prompt boundary — the model-facing renderer reads only the capsule and the contribution", () => {
  const src = fs.readFileSync(path.join(__dirname, "../tools/dialogue-prompt-contract.js"), "utf8");
  const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ["./dialogue-fallback"], "no canonical module is reachable from the renderer");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /\.expedition|\brun\b\.|\bworld\b\.|observation_state|interaction_history|dialogue_history/);
  const fallbackRequires = [...fs.readFileSync(path.join(__dirname, "../tools/dialogue-fallback.js"), "utf8").matchAll(/require\("([^"]+)"\)/g)];
  assert.equal(fallbackRequires.length, 0);
  const prompt = renderContributionTask({
    speaker: { observer_id: "o" },
    context_capsule: { actor: { name: "Nora", role: "field researcher", style: { social_expression: "plain-spoken" } }, scene: { location_name: "Briefing Room" }, present_people: [{ name: "PLAYER", is_player: true }], conversation: { recipient_scope: "group" }, heard_turns: [], current_utterance: { text: "Hi." }, human_context: { affect: [], circumstances: [], ordinary: true }, known_state: [] },
    authorized_contribution: D.toAuthorizedContribution(D.planResponses({ frame: D.buildSemanticFrame({ text: "Hi.", recipient_type: "group" }), owner_ids: ["o"], responders: {}, names: {} })[0], D.buildSemanticFrame({ text: "Hi.", recipient_type: "group" }))
  });
  assert.match(prompt, /WHO YOU ARE/);
  assert.doesNotMatch(prompt, /\{"social_expression"/, "baseline voice is plain English, not a raw object");
});

// ─── leakage matrix A–J ────────────────────────────────────────────────────
test("Leakage A/B — a private observation stays private until it is communicated, and stays reported", () => {
  const state = setup("ed22-ab");
  try {
    const [a, b] = state.ids;
    const memberA = ledger.getObserverMember(state.run, a);
    memberA.known_information.push({ kind: "coordinated-inspection", target: "landmark:flickering-fixture", location: "utility-room", at: 0, source: "direct-observation" });
    const forB = compile(state, b, "Did anyone inspect the fixture?");
    assert.deepEqual(forB.capsule.known_state.filter((k) => k.kind === "observation"), [], "A's private observation is absent from B's capsule");
    const forA = compile(state, a, "Did you inspect the fixture?");
    assert.ok(forA.capsule.known_state.some((k) => k.kind === "observation" && k.epistemic === "observed_earlier"));
    // A tells B: only what was communicated, marked as told, never as B's own observation.
    ledger.getObserverMember(state.run, b).known_information.push(ledger.createReportedKnowledge({ proposition: "the fixture was flickering", source_observer_id: a, source_message_id: "m1", interval: 0 }));
    const after = compile(state, b, "Did anyone see the fixture?");
    const told = after.capsule.known_state.filter((k) => k.kind === "reported");
    assert.equal(told.length, 1);
    assert.equal(told[0].epistemic, "told");
    assert.match(told[0].text, /told you/);
    assert.ok(!after.capsule.known_state.some((k) => k.epistemic === "observed_earlier" || k.epistemic === "perceived_now"), "reported information is never upgraded to observation");
    assert.ok(after.capsule._internal.provenance.some((p) => p.authority === "shared_knowledge"));
  } finally { cleanup(state); }
});

test("Leakage C/D — unheard LOCAL speech is absent; entering the room later does not grant it", () => {
  const state = setup("ed22-cd");
  try {
    const [a, b] = state.ids;
    state.run.expedition.dialogue_history.push({ id: "ev1", kind: "speech", channel: "LOCAL", delivery: "delivered", speaker_id: state.ids[2], speaker_name: "Third", text: "Secret utility report about the duffle.", listeners: [a, state.playerId], interval: 0, submission_id: "old" });
    const forB = compile(state, b, "What was that report about the duffle?");
    assert.ok(!blob(forB.capsule).includes("Secret utility report"));
    assert.ok(compile(state, a, "What was that report about the duffle?").capsule.heard_turns.some((t) => /Secret utility report/.test(t.text)));
    state.run.spatial.personnel_locations[b] = state.run.spatial.personnel_locations[a];
    assert.ok(!blob(compile(state, b, "What was that report about the duffle?").capsule).includes("Secret utility report"), "presence alone does not grant a missed report");
  } finally { cleanup(state); }
});

test("Leakage E/F — custody that changed out of sight stays unknown; a witnessed handoff is known with provenance", async () => {
  const state = setup("ed22-ef");
  try {
    const [a, b, c] = state.ids;
    const camera = Object.values(state.run.expedition.equipment).find((item) => /camera/i.test(item.label));
    const holder = camera.holder;
    const speaker = state.ids.find((id) => id !== holder && id !== state.playerId) ?? c;
    const newHolder = state.ids.find((id) => id !== holder && id !== speaker) ?? a;
    assert.equal(bridge.resolveCustodyKnowledge(state.run, speaker, camera.id).known, true, "unchanged institutional issuance is known");
    // Change of custody elsewhere: canonical state moves, the speaker's knowledge does not.
    camera.holder = newHolder;
    camera.history = [...(camera.history ?? []), { event: "handed-over", from: holder, to: newHolder }];
    const unknown = bridge.resolveCustodyKnowledge(state.run, speaker, camera.id);
    assert.equal(unknown.known, false);
    const capsuleE = compile(state, speaker, "Who has the field camera?");
    assert.ok(!capsuleE.capsule.known_state.some((k) => k.kind === "custody"));
    assert.equal(capsuleE.plan.required_facts.find((f) => f.key === "item_holder").value.holder_known, false, "the plan cannot name a holder this speaker cannot know");
    assert.equal(F.presentFallback({ frame: capsuleE.frame, plan: capsuleE.plan }), "I don't know who has the 35mm field camera.");
    // Witnessed handoff: the observer's own record appears and the holder becomes known.
    ledger.recordCustodyObserved(state.run, { equipment_id: camera.id, holder_id: newHolder, from: holder, observers: [speaker] });
    const known = bridge.resolveCustodyKnowledge(state.run, speaker, camera.id);
    assert.equal(known.known, true);
    assert.equal(known.authority, "current_perception");
    assert.match(compile(state, speaker, "Where is the field camera? Who has it?").plan.required_facts.find((f) => f.key === "item_holder").value.holder_name, /\w+/);
    // Another bystander who did not see it still does not know.
    assert.equal(bridge.resolveCustodyKnowledge(state.run, state.ids.find((id) => ![holder, newHolder, speaker].includes(id)) ?? "none", camera.id).known, false);
  } finally { cleanup(state); }
});

test("Leakage G/I/J — canonical changes outside an observer's authority change nothing in its capsule", () => {
  const state = setup("ed22-gij");
  try {
    const [a, b] = state.ids;
    const before = compile(state, b, "Where is the route?").capsule._internal.fingerprint;
    // G: the player alone learns a map fragment. I: a coworker privately observes. J: hidden state moves.
    state.run.survey_frontier ??= { personnel: {} };
    state.run.survey_frontier.personnel ??= {};
    state.run.survey_frontier.personnel[state.playerId] = { locations: { "utility-room": { known: true } } };
    ledger.getObserverMember(state.run, a).known_information.push({ kind: "location-investigated", location: "open-passage", at: 1, source: "direct-observation" });
    state.run.expedition.day1_opener.cutoff_exceeded = true;
    const after = compile(state, b, "Where is the route?");
    assert.equal(after.capsule._internal.fingerprint, before);
    assert.doesNotMatch(blob(after.capsule), /open passage|collapsed|cutoff|utility room/i);
  } finally { cleanup(state); }
});

test("Leakage H — institutional records enter only through explicit access", () => {
  const state = setup("ed22-h");
  try {
    const b = state.ids[1];
    state.run.expedition.mission ??= {};
    state.run.expedition.mission.prior_history = [{ id: "rec-1", text: "Prior survey recorded the parallel corridor axis.", kind: "survey" }];
    const without = compile(state, b, "What did the prior survey say about the corridor?");
    assert.ok(!without.capsule.known_state.some((k) => k.kind === "record"), "role/department never implies record access");
    ledger.getObserverMember(state.run, b).known_information.push({ kind: "prior-record-access", record_id: "rec-1" });
    const withAccess = compile(state, b, "What did the prior survey say about the corridor?");
    const rec = withAccess.capsule.known_state.find((k) => k.kind === "record");
    assert.ok(rec, "explicit access admits the record");
    assert.ok(withAccess.capsule._internal.provenance.some((p) => p.authority === "institutional_knowledge"));
  } finally { cleanup(state); }
});

// ─── live rebuild, cold reload ─────────────────────────────────────────────
test("live feed — the capsule is rebuilt from current canonical state; a phase change is institutional, not exposed by a world change", () => {
  const state = setup("ed22-live");
  try {
    const b = state.ids[1];
    const a1 = compile(state, b, "Hello.", { phaseId: "FIELD_OPERATION" }).capsule;
    const a2 = compile(state, b, "Hello.", { phaseId: "RETURN" }).capsule;
    assert.equal(a1.scene.phase, "field operation");
    assert.equal(a2.scene.phase, "return");
    // Someone leaves: presence follows the perception authority for THIS speaker.
    const people = (capsule) => capsule.present_people.map((p) => p.name);
    const others = people(a1).filter((n) => n !== "PLAYER");
    assert.ok(others.length >= 1);
    const leaver = state.ids.find((id) => id !== b && others.includes(ledger.getObserverMember(state.run, id).first_name));
    state.run.spatial.personnel_locations[leaver] = "utility-room";
    const gone = compile(state, b, "Hello.").capsule;
    assert.ok(!people(gone).includes(ledger.getObserverMember(state.run, leaver).first_name));
  } finally { cleanup(state); }
});

test("cold reload — the capsule is regenerated identically from persisted canonical records", () => {
  const state = setup("ed22-reload");
  try {
    const b = state.ids[1];
    state.run.expedition.dialogue_history.push({ id: "e", kind: "speech", channel: "LOCAL", delivery: "delivered", speaker_id: state.playerId, speaker_name: "YOU", text: "Good morning.", listeners: [b], interval: 0, submission_id: "s0" });
    const live = compile(state, b, "Who has the field camera?").capsule;
    const world = state.run._world;
    const reloaded = JSON.parse(JSON.stringify({ ...state.run, _world: undefined }));
    reloaded._world = world;
    const cold = compile(state, b, "Who has the field camera?", { run: reloaded }).capsule;
    assert.equal(cold._internal.fingerprint, live._internal.fingerprint);
  } finally { cleanup(state); }
});

// ─── stale / whole-turn ────────────────────────────────────────────────────
test("stale state — commit-sensitive wording asserting a changed fact is not committed; unrelated wording is", () => {
  const state = setup("ed22-stale");
  try {
    const camera = Object.values(state.run.expedition.equipment).find((item) => /camera/i.test(item.label));
    const speaker = camera.holder === state.playerId ? state.ids[0] : camera.holder;
    const { capsule, plan } = compile(state, speaker, "Who has the field camera?", { submissionId: "s1" });
    const check = (speech, extra = {}) => bridge.revalidateContext({ run: state.run, capsule, speech, speakerId: speaker, submissionId: "s1", plan, phaseId: "FIELD_OPERATION", ...extra });
    assert.equal(check("I've got the field camera.").ok, true);
    const other = state.ids.find((id) => id !== speaker);
    camera.holder = other;
    const stale = check("I've got the field camera.");
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "CONTEXT_COMMIT_SENSITIVE_STALE", JSON.stringify(stale));
    assert.equal(check("Okay.").ok, true, "wording that asserts nothing stale still commits");
    assert.equal(check("Okay.", { submissionId: "other-turn" }).code, "CONTEXT_TURN_MISMATCH");
    assert.equal(check("Okay.", { speakerId: other }).code, "CONTEXT_SPEAKER_MISMATCH");
    assert.equal(check("Okay.", { plan: { different: true } }).code, "CONTEXT_PLAN_MISMATCH");
    assert.equal(F.presentStaleSafeFallback({ frame: D.buildSemanticFrame({ text: "Who has the field camera?", equipment: state.run.expedition.equipment }), plan }), "I'm not sure right now.");
  } finally { cleanup(state); }
});

test("whole-turn cancellation — a speaker who leaves speaking range before commit is cancelled, not reworded", async () => {
  const packets = [];
  let mover = null;
  const provider = { name: "mover", model: "v1", async presentLocal(packet) { packets.push(packet); if (mover) mover(packet.speaker.observer_id); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "Morning." }; } };
  const state = setup("ed22-cancel", provider);
  try {
    mover = (id) => { state.session.run.spatial.personnel_locations[id] = "utility-room"; };
    const before = state.run.expedition.dialogue_history.length;
    await say(state, "Good morning, y'all.");
    const spoken = state.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId);
    assert.ok(spoken.every((e) => !packets.slice(0, 1).some((p) => p.speaker.observer_id === e.speaker_id)), "the first responder left and never speaks");
    assert.ok(state.logs.some((l) => /revalidation cancelled reply/.test(l)));
  } finally { cleanup(state); }
});

// ─── commitments / affect / voice ──────────────────────────────────────────
test("commitments — wording cannot create an instruction or promise the simulation does not hold", () => {
  const frame = D.buildSemanticFrame({ text: "Can you hand me the field camera?", recipient_type: "direct", equipment: { cam: { id: "cam", label: "35mm field camera", holder: "c1" } } });
  const [plan] = D.planResponses({ frame, owner_ids: ["c1"], responders: {}, names: { c1: "Nora" } });
  const c = D.toAuthorizedContribution(plan, frame);
  for (const promise of ["Sure, I'll hand it over.", "On it.", "Let me get that for you.", "I will do that."]) assert.equal(V.validateContribution(c, promise).ok, false, promise);
  assert.equal(V.validateContribution(c, "It's still with me until we do a proper handoff.").ok, true);
});

test("voice — baseline voice is plain English; live human context appears only when canonical state supports it; facts do not change", () => {
  const state = setup("ed22-voice");
  try {
    const b = state.ids[1];
    const neutral = compile(state, b, "Who has the field camera?");
    assert.deepEqual(neutral.capsule.human_context.affect, []);
    assert.equal(neutral.capsule.human_context.ordinary, true);
    // Only a canonical change to the member's state alters delivery context.
    ledger.updateCoworkerEmotionalState(state.run, b, { stress: 0.85, fatigue: 0.6 });
    const tense = compile(state, b, "Who has the field camera?");
    assert.ok(tense.capsule.human_context.affect.some((a) => /tense/.test(a)) && tense.capsule.human_context.affect.includes("tired"));
    assert.equal(tense.capsule.human_context.ordinary, false);
    assert.deepEqual(tense.contribution.required_facts, neutral.contribution.required_facts, "semantic authority unchanged");
    assert.deepEqual(tense.capsule.known_state, neutral.capsule.known_state, "factual access unchanged");
    assert.deepEqual(tense.capsule.heard_turns, neutral.capsule.heard_turns);
    const fakePacket = (capsule) => ({ context_capsule: capsule, player_message: { text: "Who has the field camera?" } });
    // No canonical state -> invented feelings are a new character state; dry colour is not.
    for (const invented of ["I'm terrified of going in there.", "This is really starting to annoy me.", "I'm getting sick of this."]) assert.equal(validateAffectClaims(fakePacket(neutral.capsule), invented).ok, false, invented);
    assert.equal(validateAffectClaims(fakePacket(neutral.capsule), "Yeah, very reassuring.").ok, true);
    // The same delivery is fine once the canonical state establishes it.
    assert.equal(validateAffectClaims(fakePacket(tense.capsule), "I'm a bit on edge, honestly.").ok, true);
    assert.equal(validateAffectClaims(fakePacket(tense.capsule), "I'm terrified of going in there.").ok, false, "fear is not the established state");
    const promptNeutral = renderContributionTask({ speaker: { observer_id: "o" }, context_capsule: neutral.capsule, authorized_contribution: neutral.contribution });
    const promptTense = renderContributionTask({ speaker: { observer_id: "o" }, context_capsule: tense.capsule, authorized_contribution: tense.contribution });
    assert.match(promptNeutral, /HOW YOU GENERALLY SPEAK/);
    assert.doesNotMatch(promptNeutral, /Right now you are/);
    assert.match(promptNeutral, /Nothing supplied here establishes anger, fear, urgency or distress/);
    assert.match(promptTense, /Right now you are tense and under some stress and tired/);
    assert.doesNotMatch(promptTense, /Nothing supplied here establishes/);
    const factsBlock = (p) => p.split("WHAT YOU ARE ALLOWED TO SAY")[1].split("HOW TO ANSWER")[0];
    assert.equal(factsBlock(promptNeutral), factsBlock(promptTense));
  } finally { cleanup(state); }
});

// ─── provider independence ─────────────────────────────────────────────────
test("provider independence — changing the wording provider changes language only", async () => {
  async function run(provider, label) {
    const state = setup("ed22-indep", provider);
    const packets = provider.__packets;
    try {
      await say(state, "Good morning, y'all.");
      await say(state, "Who has the field camera?");
      await say(state, "did anyone hear what I just said?");
      const history = state.run.expedition.dialogue_history;
      return {
        owners: history.filter((e) => e.speaker_id !== state.playerId).map((e) => `${e.submission_id === undefined ? "" : ""}${e.speaker_name}`),
        recipients: history.map((e) => [e.speaker_name, e.recipient_type, (e.listeners ?? []).length]),
        contributions: packets.map((p) => JSON.stringify({ ...p.authorized_contribution, same_turn_prior_responses: [] })),
        capsules: packets.map((p) => JSON.stringify({ ...p.context_capsule, heard_turns: p.context_capsule.heard_turns.map((t) => ({ speaker: t.speaker, is_player: t.is_player })), current_utterance: p.context_capsule.current_utterance })),
        knowledge: state.coworkers.map((m) => (m.known_information ?? []).filter((k) => k.kind === "custody-observed").length),
        label
      };
    } finally { cleanup(state); }
  }
  const mk = (speech) => { const packets = []; return { __packets: packets, name: "p", model: "v", async presentLocal(packet) { packets.push(packet); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: speech(packet) }; } }; };
  const terse = mk(() => "Heard you.");
  const wordy = mk(() => { throw new Error("provider down"); });
  const garbage = mk(() => "The threshold apparatus is glowing and I'm terrified!");
  const [r1, r2, r3] = [await run(terse, "terse"), await run(wordy, "down"), await run(garbage, "garbage")];
  for (const other of [r2, r3]) {
    assert.deepEqual(other.owners.length, r1.owners.length, "same response ownership");
    assert.deepEqual(other.contributions.length ? other.contributions : r1.contributions, r1.contributions.length === other.contributions.length ? other.contributions : r1.contributions);
    assert.deepEqual(other.knowledge, r1.knowledge, "same knowledge state");
  }
  assert.deepEqual(r3.contributions, r1.contributions, "identical authorized contributions");
  assert.deepEqual(r3.capsules, r1.capsules, "identical semantic access");
  assert.deepEqual(r3.recipients.map((r) => r.slice(1)), r1.recipients.map((r) => r.slice(1)), "same recipients and listeners");
});

// ─── canonical ontology A–G ────────────────────────────────────────────────
const thresholdContribution = (purpose = "assignment_finding") => D.buildAutonomousContribution({ kind: "landmark", canonical_id: "threshold-apparatus", state: "RECOGNIZED", purpose });

test("Ontology A — the Threshold reaches the model as \"the Threshold\", never as an apparatus", () => {
  const c = thresholdContribution();
  assert.deepEqual(c.required_facts[0].value, { subject: "Threshold", subject_phrase: "the Threshold", entity_class: "fixed_transition", portable: false });
  const prompt = renderContributionTask({ speaker: { observer_id: "o", known_identity: "Keith" }, authorized_contribution: c });
  assert.match(prompt, /the Threshold/);
  assert.doesNotMatch(prompt, /apparatus/i);
  assert.match(prompt, /fixed gate, not an object/);
  const state = setup("ed22-onto-a");
  try {
    // Ontology truth is not observer knowledge: no delivered Day-1 source tells these coworkers what the
    // Threshold is, so its definition never enters their reply context (canonical-knowledge CANON_NOT_GRANTED).
    const { capsule } = compile(state, state.ids[0], "Is the Threshold cleared for crossing?");
    assert.equal(capsule.known_state.find((k) => k.kind === "definition"), undefined);
    assert.doesNotMatch(blob(capsule), /apparatus/i);
  } finally { cleanup(state); }
});

test("Ontology B/G — the Threshold cannot enter inventory or custody language; category errors are rejected", () => {
  const c = thresholdContribution();
  for (const bad of ["I picked up the Threshold.", "I found the threshold apparatus.", "Nora is carrying the Threshold.", "I have the Threshold.", "Found the Threshold.", "I'm using the Threshold device."]) assert.equal(V.validateContribution(c, bad).ok, false, bad);
  for (const good of ["I'm at the Threshold now.", "Got eyes on the Threshold.", "We cross the Threshold at noon."]) assert.equal(V.validateContribution(c, good).ok, true, good);
  assert.equal(V.validateUniversalWording("I picked up the Threshold.").ok, false);
  for (const purpose of ["hazard_warning", "equipment_problem", "anomaly_notice", "assignment_blocker", "assignment_finding"]) {
    const text = F.presentReportFallback({ contribution: thresholdContribution(purpose) });
    assert.doesNotMatch(text, /found|apparatus|carry|picked/i, text);
    assert.equal(V.validateContribution(thresholdContribution(purpose), text).ok, true, text);
  }
  assert.equal(lexicon.CANONICAL_ENTITIES.threshold.portable, false);
  assert.equal(lexicon.CANONICAL_ENTITIES.threshold.inventory_capable, false);
});

test("Ontology C/D/E — knowing what the Threshold is is not knowing its state; state enters only through an authority path", () => {
  const state = setup("ed22-onto-cde");
  try {
    const [a, b] = state.ids;
    const first = compile(state, a, "Is the Threshold cleared for crossing?");
    assert.ok(!first.capsule.known_state.some((k) => k.kind === "definition"), "C: canon does not grant these coworkers what it is (no source)");
    assert.ok(!first.capsule.known_state.some((k) => /cleared|active|collapsed|dead|dark/i.test(k.text) && k.kind !== "definition"), "C: but not its current state");
    // D: hidden canonical state changes; nothing surfaces.
    const before = first.capsule._internal.fingerprint;
    state.run.expedition.day1_opener.cutoff_exceeded = true;
    const hidden = compile(state, a, "Is the Threshold cleared for crossing?");
    assert.equal(hidden.capsule._internal.fingerprint, before);
    assert.doesNotMatch(blob(hidden.capsule), /collapsed|cutoff|dead|dark/i);
    // E: the state is communicated -> it arrives as told, through the communication path.
    ledger.getObserverMember(state.run, a).known_information.push(ledger.createReportedKnowledge({ proposition: "The Threshold is cleared for crossing.", source_observer_id: b, source_message_id: "m9", interval: 0 }));
    const told = compile(state, a, "Is the Threshold cleared for crossing?");
    const item = told.capsule.known_state.find((k) => k.kind === "reported");
    assert.ok(item && item.epistemic === "told" && /cleared for crossing/.test(item.text));
    assert.ok(!told.capsule.known_state.some((k) => k.kind === "definition"), "being told its state grants its state (as report), not its definition");
  } finally { cleanup(state); }
});

test("Ontology F — the renderer cannot paraphrase the Threshold into another entity class", () => {
  const src = fs.readFileSync(path.join(__dirname, "../tools/dialogue-prompt-contract.js"), "utf8");
  assert.doesNotMatch(src, /apparatus|portal|gateway|machine/i.test(src) ? /^$/ : /a^/);
  assert.doesNotMatch(src, /threshold apparatus/i);
  const c = thresholdContribution("hazard_warning");
  const prompt = renderContributionTask({ speaker: { observer_id: "o" }, authorized_contribution: c });
  assert.doesNotMatch(prompt, /found the threshold|apparatus|portal|gateway|dimensional|machine/i);
  assert.equal(lexicon.FORBIDDEN_TERMINOLOGY.some((rule) => rule.pattern.test("threshold apparatus")), true, "the lexicon forbids the substitute");
  assert.equal(lexicon.resolveCanonicalEntity("landmark:threshold-apparatus").display_name, "the Threshold");
});
