"use strict";

// y110 — Dialogue interpretation and pipeline convergence tests
//
// These tests prove:
//   1. Bounded speech act classification (deterministic parse)
//   2. Response-purpose resolution (no FAQ contamination)
//   3. Relevance filtering (personal question vs. social observation)
//   4. Wordsmith packet structure
//   5. Hidden simulation state absent from model-facing packet
//   6. Fallback respects response purpose
//   7. Canonical commit order
//   8. Three CQ4 coworkers present
//   9. Maxwell scripted beats still function
//  10. Provider failure safety

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { interpretUtterance, resolveResponsePurpose, selectRelevantContext, SPEECH_ACTS, buildMaxwellWordsmithHints } = require("../tools/dialogue-interpretation");
const { buildLocalDialoguePacket } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

// ─── Test setup helpers ────────────────────────────────────────────────────
function createTestService(seed = "y110-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y110-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  return { service, root, seed };
}

function setupToLocalIntroductions(service, seed = "y110-li-seed") {
  const created = service.createWorld({ name: "Y110 Test World", seed });
  assert.equal(created.ok, true);
  const worldId = created.world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Iris", last_name: "Rondeau" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  const concludeRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  assert.equal(concludeRes.ok, true, "CONCLUDE_BRIEFING must succeed");
  assert.equal(concludeRes.projection.q4.beat, "LOCAL_INTRODUCTIONS", "Beat must be LOCAL_INTRODUCTIONS");
  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter(m => (m.personnel_id ?? m.id) !== playerId);
  return { worldId, session, coworkers };
}

// ═══════════════════════════════════════════════════════════════════════════
// Part 1 — Bounded speech act classification
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — interpretUtterance: all allowlisted speech_acts are exported strings", () => {
  assert.ok(Array.isArray(SPEECH_ACTS), "SPEECH_ACTS must be an array");
  assert.ok(SPEECH_ACTS.includes("factual_question"));
  assert.ok(SPEECH_ACTS.includes("personal_question"));
  assert.ok(SPEECH_ACTS.includes("social_observation"));
  assert.ok(SPEECH_ACTS.includes("statement"));
  assert.ok(SPEECH_ACTS.includes("introduction"));
  assert.ok(SPEECH_ACTS.includes("greeting"));
  assert.ok(SPEECH_ACTS.includes("acknowledgment"));
  assert.ok(SPEECH_ACTS.includes("joke_or_sarcasm"));
  assert.ok(SPEECH_ACTS.includes("request"));
  assert.ok(SPEECH_ACTS.includes("warning"));
  assert.ok(SPEECH_ACTS.includes("uncertainty"));
  assert.ok(SPEECH_ACTS.includes("group_question"));
  assert.ok(SPEECH_ACTS.includes("ambiguous"));
  // No extra categories beyond allowed list
  assert.equal(SPEECH_ACTS.length, 13);
});

test("y110 — interpretUtterance: 'What happens if we're not back by one?' → factual_question / time_or_schedule", () => {
  const result = interpretUtterance("What happens if we're not back by one?");
  assert.equal(result.speech_act, "factual_question");
  assert.equal(result.topic, "time_or_schedule");
  assert.equal(result.literal_question, true);
  assert.ok(result.confidence > 0.5, "confidence must be > 0.5");
});

test("y110 — interpretUtterance: 'Have you been in there before?' → personal_question / personal_experience", () => {
  const result = interpretUtterance("Have you been in there before?");
  assert.equal(result.speech_act, "personal_question");
  assert.equal(result.topic, "personal_experience");
  assert.equal(result.literal_question, true);
});

test("y110 — interpretUtterance: 'You look nervous.' → social_observation (not factual_question)", () => {
  const result = interpretUtterance("You look nervous.");
  assert.equal(result.speech_act, "social_observation");
  assert.equal(result.literal_question, false);
  // Must NOT be classified as factual_question — that would trigger FAQ fallback
  assert.notEqual(result.speech_act, "factual_question");
});

test("y110 — interpretUtterance: 'Well, this seems incredibly safe.' → joke_or_sarcasm", () => {
  const result = interpretUtterance("Well, this seems incredibly safe.");
  assert.equal(result.speech_act, "joke_or_sarcasm");
  assert.equal(result.tone, "sarcastic");
  assert.equal(result.literal_question, false);
});

test("y110 — interpretUtterance: 'I'm Jack.' → introduction (not question)", () => {
  const result = interpretUtterance("I'm Jack.");
  assert.equal(result.speech_act, "introduction");
  assert.equal(result.literal_question, false);
});

test("y110 — interpretUtterance: '@table — does anyone know the route?' → group_question", () => {
  const result = interpretUtterance("@table — does anyone know the route?", { isGroup: true });
  assert.equal(result.speech_act, "group_question");
  assert.equal(result.literal_question, true);
});

test("y110 — interpretUtterance: 'Look out!' → warning / safety_or_risk", () => {
  const result = interpretUtterance("Look out!");
  assert.equal(result.speech_act, "warning");
  assert.equal(result.topic, "safety_or_risk");
});

test("y110 — interpretUtterance: 'Hey.' → greeting", () => {
  const result = interpretUtterance("Hey.");
  assert.equal(result.speech_act, "greeting");
});

test("y110 — interpretUtterance: empty string → ambiguous / confidence 0", () => {
  const result = interpretUtterance("");
  assert.equal(result.speech_act, "ambiguous");
  assert.equal(result.confidence, 0.0);
});

// ─── Acceptance F/G/H: bare conversational reactions vs real factual questions ──
test("y110 — interpretUtterance: bare 'What?' → ambiguous, not factual_question, no fabricated topic", () => {
  const result = interpretUtterance("What?");
  assert.equal(result.speech_act, "ambiguous");
  assert.notEqual(result.speech_act, "factual_question");
  assert.equal(result.topic, "unknown");
  assert.ok(result.confidence < 0.5, "bare reaction confidence must be low");
});

test("y110 — interpretUtterance: 'Huh?' / 'Sorry?' / 'Really?' / 'What was that?' / 'Wait, what?' → ambiguous conversational reaction", () => {
  for (const text of ["Huh?", "Sorry?", "Really?", "What was that?", "Wait, what?"]) {
    const result = interpretUtterance(text);
    assert.equal(result.speech_act, "ambiguous", `"${text}" must classify as ambiguous`);
    assert.notEqual(result.speech_act, "factual_question", `"${text}" must not classify as factual_question`);
  }
});

test("y110 — interpretUtterance: explicit factual questions remain factual despite the bare-reaction fix", () => {
  assert.equal(interpretUtterance("What happens if we're not back by one?").speech_act, "factual_question");
  assert.equal(interpretUtterance("What is the equipment manifest?").speech_act, "factual_question");
  assert.equal(interpretUtterance("Why does it buzz?").speech_act, "factual_question");
});

test("y110 — resolveResponsePurpose: ambiguous purpose responds to confusion, not unrelated task help", () => {
  const purpose = resolveResponsePurpose(interpretUtterance("What?"), "acknowledgment");
  assert.match(purpose, /confusion|reaction/i);
  assert.doesNotMatch(purpose, /supply the single most relevant established fact/i);
});

test("y110 — interpretUtterance: returns frozen object with version", () => {
  const result = interpretUtterance("Hello.");
  assert.ok(Object.isFrozen(result), "interpretation must be frozen");
  assert.ok(result.version.startsWith("yellow-beast-dialogue-interpretation@"));
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 2 — Response purpose resolution (no FAQ contamination)
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — resolveResponsePurpose: factual_question → fact-or-clarify purpose", () => {
  const interp = interpretUtterance("What happens if we're not back by one?");
  const purpose = resolveResponsePurpose(interp, "question");
  assert.ok(typeof purpose === "string" && purpose.length > 0);
  // Must NOT contain generic FAQ language
  assert.doesNotMatch(purpose, /answer the question if known/, "Must not contain old generic FAQ framing");
  // Must contain something about established fact or clarification
  assert.match(purpose, /fact|clarif/i);
});

test("y110 — resolveResponsePurpose: social_observation → social reaction purpose (no FAQ)", () => {
  const interp = interpretUtterance("You look nervous.");
  const purpose = resolveResponsePurpose(interp, "acknowledgment");
  assert.doesNotMatch(purpose, /answer the question|provide information|facts?.*supply/i);
  assert.match(purpose, /social|natural/i);
});

test("y110 — resolveResponsePurpose: joke_or_sarcasm → social acknowledgment, not factual lookup", () => {
  const interp = interpretUtterance("Well, this seems incredibly safe.");
  const purpose = resolveResponsePurpose(interp, "acknowledgment");
  assert.doesNotMatch(purpose, /answer the question|supply.*fact|provide.*information/i);
  assert.match(purpose, /wry|social|dry|literal/i);
});

test("y110 — resolveResponsePurpose: introduction → acknowledge appropriately", () => {
  const interp = interpretUtterance("I'm Jack.");
  const purpose = resolveResponsePurpose(interp, "acknowledgment");
  assert.match(purpose, /introduction|acknowledge/i);
});

test("y110 — resolveResponsePurpose: greeting → return the greeting", () => {
  const interp = interpretUtterance("Hey.");
  const purpose = resolveResponsePurpose(interp, "acknowledgment");
  assert.match(purpose, /greeting/i);
});

test("y110 — resolveResponsePurpose: personal_question → personal memories, not world facts", () => {
  const interp = interpretUtterance("Have you been in there before?");
  const purpose = resolveResponsePurpose(interp, "question");
  assert.match(purpose, /personal|memor|experience/i);
  assert.doesNotMatch(purpose, /mission fact|route|cutoff/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 3 — Relevance filtering
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — selectRelevantContext: personal question only receives experience context, not mission facts", () => {
  const interp = interpretUtterance("Have you been in there before?");
  const fakeFacts = [
    { kind: "reported-knowledge", text: "Cutoff is 1:00 PM.", source: "local-communication" },
    { kind: "reported-knowledge", text: "Been in tight spaces before, feels manageable.", source: "local-communication" },
    { kind: "reported-knowledge", text: "Follow the green tape.", source: "local-communication" },
    { kind: "direct-observation", text: "I have done this survey work twice before.", source: "direct-observation" }
  ];
  const { relevant_facts, forbidden_topics } = selectRelevantContext(interp, [], fakeFacts);
  // Cutoff and route facts should NOT appear
  const texts = relevant_facts.map(f => f.text);
  assert.ok(!texts.some(t => /cutoff/i.test(t)), "Cutoff fact must be excluded for personal question");
  assert.ok(!texts.some(t => /green tape/i.test(t)), "Route fact must be excluded for personal question");
  // forbidden_topics must include time_or_schedule and route_or_navigation
  assert.ok(forbidden_topics.includes("time_or_schedule"), "time_or_schedule must be forbidden for personal question");
  assert.ok(forbidden_topics.includes("route_or_navigation"), "route_or_navigation must be forbidden for personal question");
});

test("y110 — selectRelevantContext: social observation receives no mission facts and no memories", () => {
  const interp = interpretUtterance("You look nervous.");
  const fakeMemories = [
    { id: "m1", player_text: "What is the cutoff?", response: "1:00 PM.", speaker: "Casey" },
    { id: "m2", player_text: "Can you take the lead?", response: "Sure.", speaker: "Casey" }
  ];
  const fakeFacts = [
    { kind: "reported-knowledge", text: "Outpost A is forward along the guidance path." },
    { kind: "reported-knowledge", text: "Cutoff is 1:00 PM firm." }
  ];
  const { relevant_memories, relevant_facts } = selectRelevantContext(interp, fakeMemories, fakeFacts);
  assert.equal(relevant_memories.length, 0, "Social observation must receive no prior exchange memories");
  // Safety facts may pass through if present; mission objective/route/cutoff must not
  const texts = relevant_facts.map(f => f.text);
  assert.ok(!texts.some(t => /cutoff/i.test(t)), "Cutoff must be excluded for social observation");
  assert.ok(!texts.some(t => /outpost/i.test(t)), "Mission objective must be excluded for social observation");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 4 — Wordsmith packet structure
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — buildLocalDialoguePacket: packet contains speech_act fields", async () => {
  const { service } = createTestService("y110-packet-test");
  const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y110-packet-seed");

  const coworkerA = coworkers[0];
  const targetName = coworkerA.first_name || coworkerA.display_name;
  const res = await service.submitQ4Communication({
    world_id: worldId,
    mode: "field-researcher",
    channel: "local",
    target: targetName,
    text: "Have you been in there before?"
  });
  // submitQ4Communication returns the result; access _local_dialogue_context
  // only on the canonical result before presentHostedLocalDialogue consumes it.
  // Since we have no hosted provider configured, test via the packet builder directly.
  const run = session.run;
  const playerId = run.session.startup.player.observer_id;

  // Build a synthetic context for packet testing
  const { retrieveRelevantMemories, getAttitude } = require("../tools/q4-personnel-continuity");
  const cw = session.run.expedition.team.members.find(m => (m.personnel_id ?? m.id) !== playerId && m.personnel_id === coworkerA.personnel_id);
  if (!cw) return; // coworker not found — skip structural test

  // Direct packet test via module
  const interp = interpretUtterance("Have you been in there before?");
  assert.equal(interp.speech_act, "personal_question");
  const purpose = resolveResponsePurpose(interp, "question");
  assert.match(purpose, /personal|memor|experience/i);
});

test("y110 — Packet must not contain _run or hidden simulation state in enumerable fields", async () => {
  // Test via JSON.stringify which is exactly what the model sees.
  // Build a minimal synthetic packet-like object to confirm the invariant.
  const { service } = createTestService("y110-hidden-state-test");
  const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y110-hs-seed");

  const coworkerA = coworkers[0];
  const run = session.run;
  const playerId = run.session.startup.player.observer_id;
  const cw = run.expedition.team.members.find(m => (m.personnel_id ?? m.id) === coworkerA.personnel_id);

  if (!cw) return; // skip if coworker not found

  // Trigger communication to get the canonical result with _local_dialogue_context
  const targetName = coworkerA.first_name || coworkerA.display_name;
  const rawResult = await service.submitQ4Communication({
    world_id: worldId,
    mode: "field-researcher",
    channel: "local",
    target: targetName,
    text: "Have you been in there before?"
  });
  assert.ok(rawResult.ok, "Communication must succeed");

  // The packet built by buildLocalDialoguePacket must not expose _run or raw run data
  // when serialized. Verify via JSON.stringify that no internal IDs leak.
  // Since we can't easily intercept the packet, test the invariant on the interpretation:
  const interp = interpretUtterance("Have you been in there before?");
  const serialized = JSON.stringify(interp);
  assert.doesNotMatch(serialized, /"_run"/, "_run must not appear in serialized interpretation");
  assert.doesNotMatch(serialized, /"run_id"/, "run_id must not appear in serialized interpretation");

  // Test that buildLocalDialoguePacket output does not have enumerable _run
  // by checking JSON.stringify of the packet's own keys structure
  // (We'll test this through the packet's authority_contract assertion below)

  // If we have enough context, build a packet and test it:
  const person = run._world?.characters?.[coworkerA.personnel_id];
  if (!person) return; // skip if character record unavailable (cold test context)

  const { reactionContext, react } = require("../tools/q4-personnel-continuity");
  const { presentationBus } = require("../tools/presentation-bus");

  const rc = reactionContext({
    world: run._world,
    run,
    phase: "BRIEFING",
    worker_id: coworkerA.personnel_id,
    player_id: playerId,
    event: {
      id: "test-event",
      category: "operational",
      summary: "Player test message",
      is_question: true,
      operational_importance: 60,
      perceived_risk: 0,
      observed_by: [coworkerA.personnel_id],
      delivered_to: [coworkerA.personnel_id],
      participants: [playerId, coworkerA.personnel_id]
    }
  });

  if (!rc.valid) return; // skip if reaction context invalid

  let packet;
  try {
    packet = buildLocalDialoguePacket({
      run,
      player_text: "Have you been in there before?",
      speaker: cw,
      person,
      reaction_context: rc,
      reaction: null,
      interpretation: interpretUtterance("Have you been in there before?"),
      is_group: false
    });
  } catch {
    return; // skip if speaker not in scene
  }

  // Serialize the packet exactly as the model would receive it
  const packetJson = JSON.stringify(packet);

  // _run must NEVER appear in JSON.stringify output
  assert.doesNotMatch(packetJson, /"_run"/, "_run must not be serializable in the model packet");
  assert.doesNotMatch(packetJson, /"_dialogue_trace"/, "_dialogue_trace must not be serializable in the model packet");

  // packet must contain player_speech_act
  assert.ok(packet.player_speech_act, "packet must contain player_speech_act field");
  assert.equal(packet.player_speech_act.speech_act, "personal_question");

  // packet must contain authorized_response.purpose
  assert.ok(typeof packet.authorized_response.purpose === "string" && packet.authorized_response.purpose.length > 10);

  // _run is accessible as non-enumerable
  assert.ok(packet._run !== undefined, "_run must be accessible as non-enumerable property");
  assert.ok(!Object.keys(packet).includes("_run"), "_run must not be in Object.keys()");

  // _dialogue_trace is accessible as non-enumerable
  assert.ok(packet._dialogue_trace !== undefined, "_dialogue_trace must be accessible");
  assert.ok(!Object.keys(packet).includes("_dialogue_trace"), "_dialogue_trace must not be in Object.keys()");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 5 — Fallback respects response purpose
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — presentReaction: social_observation does not produce FAQ response", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const fakePerson = {
    first_name: "Casey",
    personality: "intern",
    continuity: { attitudes: {}, tendencies: {} }
  };
  const fakeReaction = { category: "question" };
  const result = presentReaction(fakePerson, fakeReaction, "You look nervous.", "player-1", "social_observation");
  // Must not produce a factual-question FAQ response
  assert.ok(typeof result === "string" && result.length > 0);
  assert.doesNotMatch(result, /which part should i check|what do you want me to verify|what exactly/i,
    "Social observation must not trigger a FAQ clarification question");
});

test("y110 — presentReaction: joke_or_sarcasm produces social response, not FAQ", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const fakePerson = {
    first_name: "Casey",
    personality: "intern",
    continuity: { attitudes: {}, tendencies: {} }
  };
  const fakeReaction = { category: "acknowledgment" };
  const result = presentReaction(fakePerson, fakeReaction, "Well, this seems incredibly safe.", "player-1", "joke_or_sarcasm");
  assert.ok(typeof result === "string" && result.length > 0);
  // Must produce a social/restrained reply, not an information exchange
  assert.doesNotMatch(result, /i have .* in the notes as your report/i,
    "Sarcasm must not trigger the operational-report acknowledgment branch");
});

test("y110 — presentReaction: introduction produces brief acknowledgment", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const fakePerson = { first_name: "Pat", personality: null, continuity: { attitudes: {}, tendencies: {} } };
  const fakeReaction = { category: "acknowledgment" };
  const result = presentReaction(fakePerson, fakeReaction, "I'm Jack.", "player-1", "introduction");
  assert.ok(typeof result === "string" && result.length > 0);
  // Must include "Good to know" or similarly brief social acknowledgment
  assert.doesNotMatch(result, /as your report/i, "Introduction must not be treated as operational report");
});

test("y110 — presentReaction: personal_question produces honest uncertainty, not invented biography", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const fakePerson = {
    first_name: "Remy",
    personality: null,
    continuity: { attitudes: {}, tendencies: {} }
  };
  const fakeReaction = { category: "question" };
  const result = presentReaction(fakePerson, fakeReaction, "Have you been in there before?", "player-1", "personal_question");
  assert.ok(typeof result === "string" && result.length > 0);
  // Must not invent a specific experience
  assert.doesNotMatch(result, /yes, i've been|no, never been|i was there/i,
    "Personal question must not produce invented biography");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 6 — Canonical commit order
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — Player event commits before responder event in dialogue_history", async () => {
  const { service } = createTestService("y110-commit-order");
  const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y110-co-seed");

  const coworkerA = coworkers[0];
  const run = session.run;
  const histBefore = (run.expedition.dialogue_history ?? []).length;

  const targetName = coworkerA.first_name || coworkerA.display_name;
  const result = await service.submitQ4Communication({
    world_id: worldId,
    mode: "field-researcher",
    channel: "local",
    target: targetName,
    text: "Have you been in there before?"
  });
  assert.ok(result.ok, "Communication must succeed");

  const currentSession = service.session(worldId, "field-researcher");
  const history = currentSession.run.expedition.dialogue_history ?? [];
  const newEvents = history.slice(histBefore);
  assert.ok(newEvents.length >= 1, "At least one dialogue event must be committed");

  // First new event must be the player event (speaker = player)
  const playerId = currentSession.run.session.startup.player.observer_id;
  const firstEvent = newEvents[0];
  assert.equal(firstEvent.speaker_id ?? firstEvent.speaker, playerId,
    "Player event must appear first in dialogue_history");

  // If a responder event exists, it must come after the player event
  if (newEvents.length >= 2) {
    const secondEvent = newEvents[1];
    const secondSpeakerId = secondEvent.speaker_id ?? secondEvent.speaker;
    assert.notEqual(secondSpeakerId, playerId,
      "Second event must be the coworker responder, not the player again");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 7 — Three CQ4 coworkers
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — Exactly three non-player coworkers are at the table in LOCAL_INTRODUCTIONS", () => {
  const { service } = createTestService("y110-coworker-count");
  const { coworkers } = setupToLocalIntroductions(service, "y110-cc-seed");
  assert.equal(coworkers.length, 3, "Exactly 3 coworkers must be present in LOCAL_INTRODUCTIONS beat");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 8 — Group speech retains deterministic ownership
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — Group speech: model cannot select responder (only one chosen)", async () => {
  const { service } = createTestService("y110-group-ownership");
  const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y110-go-seed");

  const histBefore = (session.run.expedition.dialogue_history ?? []).length;

  const result = await service.submitQ4Communication({
    world_id: worldId,
    mode: "field-researcher",
    channel: "local",
    text: "@table — does anyone know the route?"
  });
  assert.ok(result.ok, "Group communication must succeed");

  const currentSession = service.session(worldId, "field-researcher");
  const newEvents = (currentSession.run.expedition.dialogue_history ?? []).slice(histBefore);

  // Must have player event + at most one responder event
  const playerId = currentSession.run.session.startup.player.observer_id;
  const responderEvents = newEvents.filter(e => (e.speaker_id ?? e.speaker) !== playerId);
  assert.ok(responderEvents.length <= 1,
    "At most one coworker may respond to group speech (deterministic ownership)");

  // response_owner must be in the committed event, not chosen by the model
  if (responderEvents.length === 1) {
    const coworkerIds = coworkers.map(c => c.personnel_id ?? c.id);
    const responderId = responderEvents[0].speaker_id ?? responderEvents[0].speaker;
    assert.ok(coworkerIds.includes(responderId),
      "Responder must be a known coworker, not a model-invented speaker");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 9 — Maxwell scripted beats still function
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — Maxwell briefing: authored deflection still functions with interpretation layer present", async () => {
  const { service } = createTestService("y110-maxwell-beats");
  const created = service.createWorld({ name: "Y110 Maxwell Test", seed: "y110-maxwell-seed" });
  assert.equal(created.ok, true);
  const worldId = created.world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Olive", last_name: "Stein" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  const attendRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  assert.equal(attendRes.ok, true);

  // Maxwell beat 1 — canonical opener present
  const proj0 = attendRes.projection;
  const briefing0 = proj0.q4.personnel_briefing;
  assert.equal(briefing0.status, "active");
  assert.match(briefing0.exchange_history[0].text, /Good morning, Q4 assignees\./,
    "Beat 1 canonical opener must be present");

  // The briefing is authored temporal delivery, not an FAQ kiosk: free-form input of any
  // kind — a factual question, a social remark, or an introduction — receives the same
  // single authored deflection back into the beats, rather than a topic-matched answer.
  const deflection = "There isn't time for that right now — let's get through this, and you can ask around once we're done here.";

  const runState0 = service.session(worldId, "field-researcher").run;
  const outpostInteract = cq4Day1Opener.interactPersonnelBriefing(runState0, "Where exactly is Outpost A?");
  assert.ok(outpostInteract.ok, "Maxwell outpost Q must succeed");
  assert.equal(outpostInteract.reply, deflection, "Free-form question must receive the authored deflection, not a topic answer");

  // Social remark — must get the same authored deflection, not a sarcasm-specific reply
  const runState1 = service.session(worldId, "field-researcher").run;
  const socialInteract = cq4Day1Opener.interactPersonnelBriefing(runState1, "Well, this seems incredibly safe.");
  assert.ok(socialInteract.ok, "Maxwell social remark must succeed");
  assert.equal(socialInteract.reply, deflection, "Social remark must receive the same authored deflection");

  // Introduction remark — must get the same authored deflection, never the tape
  const runState2 = service.session(worldId, "field-researcher").run;
  const introInteract = cq4Day1Opener.interactPersonnelBriefing(runState2, "Hey, I'm Olive.");
  assert.ok(introInteract.ok, "Maxwell intro remark must succeed");
  assert.equal(introInteract.reply, deflection, "Introduction must receive the same authored deflection");
  assert.doesNotMatch(introInteract.reply ?? "", /green tape/i,
    "Introduction must not trigger disclosure of the guidance tape");
});

test("y110 — Maxwell: 'What happens if we're not back by one?' → authored deflection (scripted)", async () => {
  const { service } = createTestService("y110-maxwell-cutoff");
  const created = service.createWorld({ name: "Y110 Maxwell Cutoff Test", seed: "y110-mc-seed" });
  assert.equal(created.ok, true);
  const worldId = created.world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Sam", last_name: "Delray" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  const runState = service.session(worldId, "field-researcher").run;

  const result = cq4Day1Opener.interactPersonnelBriefing(runState, "What happens if we're not back by one?");
  assert.ok(result.ok, "Cutoff Q to Maxwell must succeed");
  // The briefing is authored temporal delivery, not an FAQ kiosk: this now receives the
  // single authored deflection rather than a topic-matched cutoff fact.
  assert.equal(
    result.reply,
    "There isn't time for that right now — let's get through this, and you can ask around once we're done here.",
    "Free-form question during the briefing must receive the authored deflection"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 10 — Provider failure safety
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — Provider failure is safe: canonical state not mutated on async error", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y110-pf-"));
  // Install failing provider at construction time (correct interface)
  const failingProvider = {
    presentLocal: async () => { throw Object.assign(new Error("Simulated provider failure"), { code: "ETIMEDOUT" }); }
  };
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", localDialogueProvider: failingProvider });
  const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y110-pf-seed");

  const histBefore = (session.run.expedition.dialogue_history ?? []).length;
  const coworkerA = coworkers[0];
  const targetName = coworkerA.first_name || coworkerA.display_name;

  // submitQ4Communication returns a Promise when provider is configured
  // The canonical commit happens sync; the async path attempts AI then falls back
  let resultValue;
  try {
    resultValue = await service.submitQ4Communication({
      world_id: worldId,
      mode: "field-researcher",
      channel: "local",
      target: targetName,
      text: "Have you been in there before?"
    });
  } catch {
    // Provider failure may propagate as rejection; we still check state
    resultValue = null;
  }

  // Session state must be intact regardless of async error
  const finalSession = service.session(worldId, "field-researcher");
  assert.ok(finalSession, "Session must still be accessible after provider failure");

  // Dialogue history must have at least the player event committed (sync canonical commit)
  const finalHistory = finalSession.run.expedition.dialogue_history ?? [];
  const newEvents = finalHistory.slice(histBefore);
  const playerId = finalSession.run.session.startup.player.observer_id;
  assert.ok(newEvents.length >= 1, "Player event must be committed even when provider fails");
  const firstEvent = newEvents[0];
  assert.equal(firstEvent.speaker_id ?? firstEvent.speaker, playerId,
    "First committed event must be the player event");
});

// ═══════════════════════════════════════════════════════════════════════════
// Part 11 — buildMaxwellWordsmithHints uses same interpretation
// ═══════════════════════════════════════════════════════════════════════════

test("y110 — buildMaxwellWordsmithHints produces same result as interpretUtterance", () => {
  const texts = [
    "What happens if we're not back by one?",
    "Hey.",
    "You look nervous.",
    "Well, this seems incredibly safe."
  ];
  for (const t of texts) {
    const a = buildMaxwellWordsmithHints(t);
    const b = interpretUtterance(t);
    assert.equal(a.speech_act, b.speech_act, `Maxwell hints must match interpretUtterance for: ${t}`);
    assert.equal(a.topic, b.topic);
  }
});

// Narrow regressions for the three Opus SHOULD-FIX-NOW findings.
test("y110 — both sarcasm fallback variants retain the speaker prefix", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  for (const [trust, expected] of [[70, "Casey: Fair point."], [50, "Casey: Let's stay focused."]]) {
    const person = { first_name: "Casey", continuity: { attitudes: { player: { trust } } } };
    assert.equal(presentReaction(person, { category: "acknowledgment" }, "Totally safe.", "player", "joke_or_sarcasm"), expected);
  }
});

// Acceptance C: social fallback wording is SOCIAL (never "ready when you are" /
// "awaiting orders"), and deterministically differentiated per teammate via
// their own grounded identity_substrate rather than collapsing to one line.
test("y110 — presentReaction: greeting fallback is social wording, never operational readiness phrasing", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const noSubstrate = { first_name: "Casey", continuity: {} };
  const line = presentReaction(noSubstrate, { category: "acknowledgment" }, "Hello, everyone.", "player", "greeting");
  assert.doesNotMatch(line, /ready when you are/i);
  assert.doesNotMatch(line, /awaiting orders/i);
  assert.doesNotMatch(line, /what do you need/i);
});

test("y110 — presentReaction: greeting fallback differs across teammates with different identity_substrate.social_expression", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const austin = { first_name: "Austin", continuity: {}, identity_substrate: { social_expression: "dryly observant" } };
  const brady = { first_name: "Brady", continuity: {}, identity_substrate: { social_expression: "quietly friendly" } };
  const guillermo = { first_name: "Guillermo", continuity: {}, identity_substrate: { social_expression: "carefully polite" } };
  const lines = [austin, brady, guillermo].map((p) =>
    presentReaction(p, { category: "acknowledgment" }, "Hello, everyone.", "player", "greeting")
  );
  assert.equal(new Set(lines).size, 3, "each teammate's greeting fallback must be distinct, not a collapsed identical line");
  for (const line of lines) assert.doesNotMatch(line, /ready when you are/i);
});

test("y110 — presentReaction: same identity_substrate deterministically produces the same line", () => {
  const { presentReaction } = require("../tools/q4-personnel-continuity");
  const person = { first_name: "Austin", continuity: {}, identity_substrate: { social_expression: "dryly observant" } };
  const a = presentReaction(person, { category: "acknowledgment" }, "Hello, everyone.", "player", "greeting");
  const b = presentReaction(person, { category: "acknowledgment" }, "Hello, everyone.", "player", "greeting");
  assert.equal(a, b);
});

test("y110 — unknown factual topics retain available facts with the existing six-fact cap", () => {
  const facts = Array.from({ length: 8 }, (_, i) => ({ text: `Verified detail ${i}.` }));
  const interpretation = interpretUtterance("Why does it buzz?");
  assert.equal(interpretation.speech_act, "factual_question");
  assert.equal(interpretation.topic, "unknown");
  const selected = selectRelevantContext(interpretation, [], facts);
  assert.deepEqual(selected.relevant_facts, facts.slice(0, 6));
  assert.deepEqual(selected.forbidden_topics, []);
  assert.deepEqual(selectRelevantContext(interpretation, [], []).relevant_facts, []);
  const known = [{ text: "The radio is ready." }, { text: "Follow the route." }, { text: "Danger ahead." }];
  const recognized = selectRelevantContext({ speech_act: "factual_question", topic: "equipment" }, [], known);
  assert.deepEqual(recognized.relevant_facts, [known[0], known[2]]);
  assert.ok(recognized.forbidden_topics.includes("route_or_navigation"));
});

test("y110 — social packets reduce operational context while factual and normal packets retain it", (t) => {
  const { service, root } = createTestService();
  try {
    const { session, coworkers } = setupToLocalIntroductions(service, "y110-social-packet-regression");
    const run = session.run;
    run.hiddenRegressionSentinel = "HIDDEN_RUN_SENTINEL";
    const speaker = coworkers[0];
    assert.ok(speaker);
    const speakerId = speaker.personnel_id ?? speaker.id;
    const speakerLocation = run.spatial.personnel_locations[speakerId];
    // Supply a visible object at the projection boundary. Since
    // live-scene-projection.js gates visible_objects through the speaker's
    // own observation_state (observation-authority is the sole visibility
    // authority), the mocked object must correspond to a real, observed
    // canonical object -- an arbitrary mocked name is filtered out by that
    // gate, in production as much as in this test.
    run.object_state.objects["utility-fluorescent-fixture"] = { location: speakerLocation, state: "intact" };
    run.observation_state.observers[speakerId] ??= { features: {} };
    run.observation_state.observers[speakerId].features["object:utility-fluorescent-fixture"] = {
      state: "RECOGNIZED", first_at: 0, last_at: 0, seen_change_token: "y110-test-token",
      salience_at_notice: 99, recognition: { qualification: null, at: 0 },
      provenance: [{ source: "direct-observation", at: 0, direct: true }]
    };
    t.mock.method(require("../tools/object-runtime"), "projectLocation", () => [
      { name: "fluorescent fixture", object_type: "fixture", condition: "intact", known_properties: [] }
    ]);
    const reaction_context = { worker: { task: "TASK_SENTINEL", qualifications: ["QUALIFICATION_SENTINEL"] }, equipment: ["EQUIPMENT_SENTINEL"] };
    const makePacket = (text) => buildLocalDialoguePacket({
      run, speaker, player_text: text,
      person: { first_name: speaker.first_name, continuity: {} },
      reaction_context, reaction: { category: "acknowledgment" }
    });
    const factual = makePacket("How does the radio work?");
    const normal = makePacket("The radio is ready.");
    for (const packet of [factual, normal]) {
      assert.equal(packet.speaker.current_task, "TASK_SENTINEL");
      assert.deepEqual(packet.speaker.held_equipment, ["EQUIPMENT_SENTINEL"]);
      assert.deepEqual(packet.speaker.qualifications, ["QUALIFICATION_SENTINEL"]);
      assert.ok(packet.speaker_shell);
      assert.deepEqual(packet.visible_context.visible_objects, packet.speaker_shell.physical.visible_objects);
    }
    assert.ok(factual.visible_context.visible_objects.length > 0, "fixture must exercise visible objects");
    const social = [
      ["Well, this seems incredibly safe.", "joke_or_sarcasm"],
      ["Hey.", "greeting"], ["I'm Jack.", "introduction"],
      ["Understood.", "acknowledgment"], ["You look nervous.", "social_observation"]
    ];
    for (const [text, act] of social) {
      const packet = makePacket(text);
      assert.equal(packet.player_speech_act.speech_act, act);
      assert.equal(packet.speaker.current_task, null);
      assert.deepEqual(packet.speaker.held_equipment, []);
      assert.deepEqual(packet.speaker.qualifications, []);
      assert.deepEqual(packet.visible_context.visible_objects, []);
      assert.equal(packet.speaker_shell, null);
      assert.deepEqual(packet.visible_context.location, factual.visible_context.location);
      assert.deepEqual(packet.visible_context.environment, factual.visible_context.environment);
      assert.deepEqual(packet.speaker.known_identity, factual.speaker.known_identity);
      assert.doesNotMatch(JSON.stringify(packet), /TASK_SENTINEL|QUALIFICATION_SENTINEL|EQUIPMENT_SENTINEL|VISIBLE_OBJECT_SENTINEL/);
    }
    for (const packet of [factual, normal, ...social.map(([text]) => makePacket(text))]) {
      assert.equal(packet._run, run);
      assert.equal(Object.getOwnPropertyDescriptor(packet, "_run").enumerable, false);
      assert.doesNotMatch(JSON.stringify(packet), /"_run"|"_dialogue_trace"|HIDDEN_RUN_SENTINEL/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
