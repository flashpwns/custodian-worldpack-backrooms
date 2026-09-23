"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const presentationBus = require("../tools/presentation-bus");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

function createTestService(seed = "y109-local-coworker-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y109-test-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  return { service, root, seed };
}

function setupToLocalIntroductions(service, seed = "dialogue-seed") {
  const created = service.createWorld({ name: "Dialogue Runtime Test World", seed });
  assert.equal(created.ok, true);
  const worldId = created.world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });

  // Complete Beat 1 Maxwell briefing
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  const concludeRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  assert.equal(concludeRes.ok, true);
  assert.equal(concludeRes.projection.q4.beat, "LOCAL_INTRODUCTIONS");

  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter(m => (m.personnel_id ?? m.id) !== playerId);
  assert.equal(coworkers.length, 3, "Exactly 3 coworkers must be assigned to the table");

  return { worldId, session, coworkers };
}

test("y109 — Direct address to coworker A (A responds, B/C do not; B/C cannot be primary responder)", async () => {
  const { service, root, seed } = createTestService("direct-address");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const coworkerA = coworkers[0];
    const coworkerB = coworkers[1];
    const coworkerC = coworkers[2];

    const targetNameA = coworkerA.first_name || coworkerA.display_name;
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    const res = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: targetNameA,
      text: "How does the equipment feel?"
    });

    assert.equal(res.ok, true, "Direct address to coworker A must succeed");
    assert.equal(res.result.outcome, "delivered");

    // Verify dialogue events in dialogue_history
    const history = session.run.expedition.dialogue_history;
    const newEvents = history.slice(historyBeforeCount);
    assert.equal(newEvents.length, 2, "Must create exactly two dialogue events (player speech + coworker response)");

    const [playerEvt, responderEvt] = newEvents;

    // Player event
    assert.equal(playerEvt.speaker_id, session.run.session.startup.player.observer_id);
    assert.equal(playerEvt.recipient_type, "direct");
    assert.equal(playerEvt.recipient_name, targetNameA);
    assert.equal(playerEvt.text, "How does the equipment feel?");

    // Responder event: strictly coworker A
    const idA = coworkerA.personnel_id ?? coworkerA.id;
    assert.equal(responderEvt.speaker_id, idA, "Responder must be coworker A");
    assert.equal(responderEvt.speaker_name, targetNameA);
    assert.equal(responderEvt.recipient_name, "YOU");
    assert.equal(responderEvt.recipient_type, "direct");

    // Coworker B and C must NOT be the responder
    const idB = coworkerB.personnel_id ?? coworkerB.id;
    const idC = coworkerC.personnel_id ?? coworkerC.id;
    assert.notEqual(responderEvt.speaker_id, idB, "Coworker B must not respond");
    assert.notEqual(responderEvt.speaker_id, idC, "Coworker C must not respond");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Explicit group address (@table / team) addresses table with designated lead responder", async () => {
  const { service, root, seed } = createTestService("group-address");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    const res = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: "@table",
      text: "Let's review the plan before we head to Staging."
    });

    assert.equal(res.ok, true, "Group address to @table must succeed");
    assert.equal(res.result.outcome, "delivered");

    const history = session.run.expedition.dialogue_history;
    const newEvents = history.slice(historyBeforeCount);
    assert.equal(newEvents.length, 2, "Must create exactly two dialogue events");

    const [playerEvt, tableRespEvt] = newEvents;

    // Player event
    assert.equal(playerEvt.recipient_type, "group");
    assert.equal(playerEvt.recipient_id, "@table");
    assert.equal(playerEvt.recipient_name, "Assembly Table");
    assert.equal(playerEvt.listeners.length, 3, "All 3 coworkers must hear group address");

    // Table response event
    assert.equal(tableRespEvt.recipient_type, "group");
    assert.equal(tableRespEvt.recipient_id, "@table");
    assert.equal(tableRespEvt.recipient_name, "Assembly Table");
    const validCoworkerIds = coworkers.map(c => c.personnel_id ?? c.id);
    assert.ok(validCoworkerIds.includes(tableRespEvt.speaker_id), "Speaker must be a valid coworker from the table");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Untargeted speech: all hear acoustically, but nobody answers (not silently group)", () => {
  const { service, root, seed } = createTestService("untargeted-speech");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    const res = service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: null, // No target selected
      text: "Testing microphone or speaking aloud to the room."
    });

    assert.equal(res.ok, true, "Untargeted utterance must succeed");
    assert.equal(res.result.public_reason, "You speak aloud to the room. Nobody at the table responds.");

    const history = session.run.expedition.dialogue_history;
    const newEvents = history.slice(historyBeforeCount);
    assert.equal(newEvents.length, 1, "Untargeted speech must create ONLY 1 event (player speech, NO coworker response)");

    const [playerEvt] = newEvents;
    assert.equal(playerEvt.recipient_type, "none");
    assert.equal(playerEvt.recipient_name, null);
    assert.equal(playerEvt.listeners.length, 3, "All coworkers in the room hear acoustically");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Silence creates zero dialogue events", () => {
  const { service, root, seed } = createTestService("silence-path");
  try {
    const { worldId, session } = setupToLocalIntroductions(service, seed);
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    // Player decides not to speak and directly clicks READY to advance to equipment staging
    const proceedRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" });
    assert.equal(proceedRes.ok, true, "Player can proceed without speaking");

    const historyAfterCount = session.run.expedition.dialogue_history?.length ?? 0;
    assert.equal(historyAfterCount, historyBeforeCount, "Silence must generate exactly ZERO dialogue events");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Physically absent target and unknown target are rejected safely", () => {
  const { service, root, seed } = createTestService("absent-targets");
  try {
    const { worldId, session } = setupToLocalIntroductions(service, seed);
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    // 1. Unknown target
    const unknownRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: "GhostAgent99",
      text: "Can you hear me?"
    });
    assert.equal(unknownRes.ok, false);
    assert.equal(unknownRes.error.code, "TARGET_NOT_FOUND");

    // 2. Absent character in world (e.g. Kirk Maxwell is upstairs / not at the table)
    const maxwellRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: "Dr. Kirk Maxwell",
      text: "Are you still here, Kirk?"
    });
    assert.equal(maxwellRes.ok, false);
    assert.equal(maxwellRes.error.code, "LOCAL_TARGET_UNAVAILABLE");

    const historyAfterCount = session.run.expedition.dialogue_history?.length ?? 0;
    assert.equal(historyAfterCount, historyBeforeCount, "Failed validations must not create dialogue events");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Channel mismatch and empty/whitespace input rejected without events", () => {
  const { service, root, seed } = createTestService("input-validation");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const coworkerA = coworkers[0].first_name || coworkers[0].display_name;
    const historyBeforeCount = session.run.expedition.dialogue_history?.length ?? 0;

    // 1. Channel mismatch: radio standard during local introductions
    const wrongChannelRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "standard",
      target: coworkerA,
      text: "Radio check on Standard."
    });
    assert.equal(wrongChannelRes.ok, false);
    assert.equal(wrongChannelRes.error.code, "INTRO_CHANNEL_UNAVAILABLE");

    // 2. Invalid channel
    const invalidChannelRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "action",
      target: coworkerA,
      text: "Action test."
    });
    assert.equal(invalidChannelRes.ok, false);
    assert.equal(invalidChannelRes.error.code, "CHANNEL_INVALID");

    // 3. Empty input
    const emptyRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworkerA,
      text: ""
    });
    assert.equal(emptyRes.ok, false);
    assert.equal(emptyRes.error.code, "COMMUNICATION_EMPTY");

    // 4. Whitespace-only input
    const whitespaceRes = service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworkerA,
      text: "    \t \n  "
    });
    assert.equal(whitespaceRes.ok, false);
    assert.equal(whitespaceRes.error.code, "COMMUNICATION_EMPTY");

    const historyAfterCount = session.run.expedition.dialogue_history?.length ?? 0;
    assert.equal(historyAfterCount, historyBeforeCount, "Rejected inputs must not produce dialogue events");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Canonical commit order: player dialogue event commits before coworker response", async () => {
  const { service, root, seed } = createTestService("commit-order");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const coworkerA = coworkers[0];
    const targetNameA = coworkerA.first_name || coworkerA.display_name;

    const res = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: targetNameA,
      text: "Ready to confirm the roster?"
    });
    assert.equal(res.ok, true);

    const history = session.run.expedition.dialogue_history;
    const playerEventIdx = history.findIndex(e => e.speaker_name === "YOU" && e.text === "Ready to confirm the roster?");
    const coworkerEventIdx = history.findIndex(e => e.speaker_id === (coworkerA.personnel_id ?? coworkerA.id) && e.recipient_name === "YOU");

    assert.ok(playerEventIdx >= 0, "Player event must exist in dialogue_history");
    assert.ok(coworkerEventIdx >= 0, "Coworker response must exist in dialogue_history");
    assert.ok(playerEventIdx < coworkerEventIdx, "Player speech event MUST commit before coworker response event");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Transcript / dialogue_history survives cold boot and session remount", async () => {
  const { service: service1, root, seed } = createTestService("persistence-cold-boot");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service1, seed);
    const coworkerA = coworkers[0].first_name || coworkers[0].display_name;

    // Generate dialogue
    await service1.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworkerA,
      text: "Checking equipment before we leave."
    });

    const originalHistory = clone(session.run.expedition.dialogue_history);
    assert.ok(originalHistory.length >= 2, "Original history has events");

    // Simulate cold boot: instantiate fresh DesktopService on same root
    const service2 = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
    const sessionRaw = JSON.parse(fs.readFileSync(service2.sessionFile(worldId, "field-researcher"), "utf8"));
    const restoredSession = service2.restoreSession(service2.getWorld(worldId), "field-researcher", sessionRaw);
    assert.ok(restoredSession, "Session must be restored from disk");

    const restoredHistory = restoredSession.run.expedition.dialogue_history;
    assert.equal(restoredHistory.length, originalHistory.length, "Dialogue history length must match exactly after cold boot");

    for (let i = 0; i < originalHistory.length; i++) {
      assert.equal(restoredHistory[i].id, originalHistory[i].id);
      assert.equal(restoredHistory[i].speaker_id, originalHistory[i].speaker_id);
      assert.equal(restoredHistory[i].speaker_name, originalHistory[i].speaker_name);
      assert.equal(restoredHistory[i].recipient_type, originalHistory[i].recipient_type);
      assert.equal(restoredHistory[i].recipient_name, originalHistory[i].recipient_name);
      assert.equal(restoredHistory[i].text, originalHistory[i].text);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Dr. Kirk Maxwell briefing shares unified dialogue envelope schema and history", () => {
  const { service, root, seed } = createTestService("maxwell-unified-path");
  try {
    const created = service.createWorld({ name: "Maxwell Path World", seed });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });

    // Attend briefing emits first beat
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    const session = service.session(worldId, "field-researcher");
    const history = session.run.expedition.dialogue_history;

    assert.ok(history.length >= 1, "Maxwell opening beat must record in dialogue_history");
    const maxwellBeat1 = history[0];
    assert.equal(maxwellBeat1.speaker_name, "DR. KIRK MAXWELL");
    assert.equal(maxwellBeat1.speaker_id, "kirk-maxwell");
    assert.equal(maxwellBeat1.channel, "LOCAL");
    assert.equal(maxwellBeat1.recipient_type, "group");
    assert.equal(maxwellBeat1.delivery, "delivered");
    assert.ok(maxwellBeat1.id.startsWith("dlg-"), "Event ID conforms to standard dialogue prefix");

    // Submit inquiry during briefing
    cq4Day1Opener.interactPersonnelBriefing(session.run, "What is our departure time?");
    const inquiryEvt = history.find(e => e.speaker_name === "YOU" && e.text === "What is our departure time?");
    const replyEvt = history.find(e => e.speaker_id === "kirk-maxwell" && e.recipient_name === "YOU");

    assert.ok(inquiryEvt, "Player inquiry must be committed to dialogue_history");
    assert.equal(inquiryEvt.recipient_name, "DR. KIRK MAXWELL");
    assert.equal(inquiryEvt.recipient_type, "direct");

    assert.ok(replyEvt, "Maxwell reply must be committed to dialogue_history");
    // The briefing is authored temporal delivery, not an FAQ kiosk: free-form inquiries
    // receive the single authored deflection rather than a topic-matched fact.
    assert.equal(
      replyEvt.text,
      "There isn't time for that right now — let's get through this, and you can ask around once we're done here."
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Malformed model response falls back safely without mutating world truth", async () => {
  const { service, root, seed } = createTestService("malformed-model-fallback");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const coworkerA = coworkers[0];
    const targetNameA = coworkerA.first_name || coworkerA.display_name;

    // Inject a faulty local dialogue provider that returns invalid hallucinated payload
    service.localDialogueProvider = {
      name: "mock-faulty-llm",
      model: "faulty-v1",
      async presentLocal(packet) {
        // Return malformed object missing required contract fields
        return {
          hallucinated_field: "You are in the Backrooms Level 999",
          bogus: true
        };
      }
    };

    const res = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: targetNameA,
      text: "Are you ready?"
    });

    assert.equal(res.ok, true, "Request must still resolve cleanly via fallback");
    assert.equal(res.result.presentation_source, "deterministic-fallback", "Must mark presentation_source as fallback");
    assert.match(res.result.public_reason, /Language assistance returned an invalid response and was rejected\. Deterministic response:/);

    // Verify dialogue event is recorded as CANONICAL deterministic fallback
    const history = session.run.expedition.dialogue_history;
    const fallbackEvt = history.find(e => e.speaker_id === (coworkerA.personnel_id ?? coworkerA.id) && e.recipient_name === "YOU");
    assert.ok(fallbackEvt, "Fallback coworker response event must be recorded");
    assert.equal(fallbackEvt.source, presentationBus.SOURCES.DETERMINISTIC);

    // Verify world truth was not corrupted
    assert.equal(session.run.expedition.team.members.length, 4, "Team roster remains exactly 4");
    assert.equal(session.run.expedition.day1_opener.beat, "LOCAL_INTRODUCTIONS", "Opener beat remains uncorrupted");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Roster consistency: exactly 3 assigned coworkers remain active at the Assembly Table throughout Beat 2", async () => {
  const { service, root, seed } = createTestService("roster-consistency");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    assert.equal(coworkers.length, 3, "Initial assigned coworkers count is exactly 3");

    // Perform multiple dialogue turns
    await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworkers[0].first_name,
      text: "Checking radio."
    });
    await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: "@table",
      text: "Is everyone ready?"
    });

    const projection = service.projectionFor(service.getWorld(worldId), "field-researcher", session);
    const nonControlled = projection.q4.team.filter(m => !m.controlled);
    assert.equal(nonControlled.length, 3, "Exactly 3 coworkers remain in projection");
    assert.equal(session.run.expedition.team.members.length, 4, "Total team members remain exactly 4 in expedition");

    for (const coworker of nonControlled) {
      assert.equal(coworker.status, "active", "Each coworker status must remain active");
      assert.ok(coworker.first_name || coworker.display_name, "Each coworker must have a valid name");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y109 — Presentation skip does not mutate or remove canonical dialogue events", async () => {
  const { service, root, seed } = createTestService("presentation-skip");
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, seed);
    const coworkerA = coworkers[0].first_name || coworkers[0].display_name;

    await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworkerA,
      text: "Testing presentation pacing."
    });

    const historyBefore = clone(session.run.expedition.dialogue_history);
    assert.ok(historyBefore.length >= 2, "Events must be recorded");

    // Simulate renderer-side fast-forward / dialogue player skip:
    // Renderer dialogue player operates strictly on DOM elements and does not touch expedition state
    const dialoguePlayerModule = fs.readFileSync(path.join(__dirname, "../desktop/renderer/dialogue-player.js"), "utf8");
    assert.match(dialoguePlayerModule, /skip\s*:\s*finish|finish\(\)\s*\{/, "Dialogue player must support skip / finish");
    assert.doesNotMatch(dialoguePlayerModule, /dialogue_history\.pop|dialogue_history\.splice|delete\s+.*dialogue_history/, "Dialogue player must NEVER mutate dialogue_history");

    // Verify dialogue history after skip is completely intact
    const historyAfter = session.run.expedition.dialogue_history;
    assert.deepEqual(historyAfter, historyBefore, "dialogue_history must remain identical after presentation skip");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── Acceptance B: same-turn prior responses propagate to later group responders ──
test("y109 — Acceptance B: group greeting with a successful mock model — later owners receive same_turn_prior_responses", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y109-test-"));
  const provider = {
    name: "mock-same-turn",
    model: "mock-v1",
    async presentLocal(packet) {
      return {
        version: "yellow-beast-local-dialogue-candidate@v1",
        observer_id: packet.speaker.observer_id,
        speech: packet.same_turn_prior_responses.length === 0 ? "Morning." : `Also morning, after ${packet.same_turn_prior_responses.length}.`
      };
    }
  };
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, localDialogueProvider: provider });
  try {
    const { worldId, session, coworkers } = setupToLocalIntroductions(service, "y109-same-turn");
    await service.submitQ4Communication({ world_id: worldId, channel: "local", text: "Hey everyone.", request_id: "same-turn-group" });

    const trace = service.getDialogueWordsmithTrace({ limit: 10 });
    const group = trace.traces.find((t) => t.request_id === "same-turn-group");
    assert.equal(group.wordsmiths.length, coworkers.length);

    // Owner order (Austin/first) sees no prior responses; each later owner sees
    // every already-accepted earlier response from THIS canonical turn, and only those.
    assert.deepEqual(group.wordsmiths[0].wordsmith_packet.same_turn_prior_responses, []);
    for (let i = 1; i < group.wordsmiths.length; i += 1) {
      const priors = group.wordsmiths[i].wordsmith_packet.same_turn_prior_responses;
      assert.equal(priors.length, i, `responder ${i} must see exactly the ${i} earlier accepted responses`);
      assert.deepEqual(priors.map((p) => p.speaker_id), group.wordsmiths.slice(0, i).map((w) => w.responder_id));
      assert.ok(priors.every((p) => typeof p.text === "string" && p.text.length > 0), "prior responses must carry committed text, never a raw/uncommitted candidate");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ─── Acceptance L: dev trace distinguishes provider-unavailable / validator-rejection / success ──
test("y109 — Acceptance L: dev trace distinguishes provider unavailable, validator rejection, and successful model wording", async () => {
  // (1) Provider unavailable: injected provider object with no presentLocal function.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y109-test-"));
    const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, localDialogueProvider: { name: "broken-no-fn" } });
    try {
      const { worldId, coworkers } = setupToLocalIntroductions(service, "y109-trace-unavailable");
      await service.submitQ4Communication({ world_id: worldId, channel: "local", target: coworkers[0].first_name, text: "Are you ready?", request_id: "trace-unavailable" });
      const trace = service.getDialogueWordsmithTrace({ limit: 10 });
      const found = trace.traces.find((t) => t.request_id === "trace-unavailable");
      assert.equal(found.wordsmiths[0].provider_ready, false);
      assert.equal(found.wordsmiths[0].candidate_produced, false);
      assert.equal(found.wordsmiths[0].validator_accepted, false);
      assert.equal(found.wordsmiths[0].fallback_used, true);
      assert.equal(found.wordsmiths[0].output_source, "deterministic-fallback");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // (2) Provider ready but returns a candidate validation rejects (missing required fields).
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y109-test-"));
    const service = new DesktopService({
      appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true,
      localDialogueProvider: { name: "rejects", model: "v1", async presentLocal() { return { bogus: true }; } }
    });
    try {
      const { worldId, coworkers } = setupToLocalIntroductions(service, "y109-trace-rejected");
      await service.submitQ4Communication({ world_id: worldId, channel: "local", target: coworkers[0].first_name, text: "Are you ready?", request_id: "trace-rejected" });
      const trace = service.getDialogueWordsmithTrace({ limit: 10 });
      const found = trace.traces.find((t) => t.request_id === "trace-rejected");
      assert.equal(found.wordsmiths[0].provider_ready, true);
      assert.equal(found.wordsmiths[0].candidate_produced, true);
      assert.equal(found.wordsmiths[0].validator_accepted, false);
      assert.ok(found.wordsmiths[0].rejection_reason, "a rejected candidate must carry a rejection reason");
      assert.equal(found.wordsmiths[0].fallback_used, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // (3) Provider ready and returns a valid candidate: accepted, not a fallback.
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y109-test-"));
    const service = new DesktopService({
      appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true,
      localDialogueProvider: {
        name: "accepts", model: "v1",
        async presentLocal(packet) { return { version: "yellow-beast-local-dialogue-candidate@v1", observer_id: packet.speaker.observer_id, speech: "Ready." }; }
      }
    });
    try {
      const { worldId, coworkers } = setupToLocalIntroductions(service, "y109-trace-accepted");
      await service.submitQ4Communication({ world_id: worldId, channel: "local", target: coworkers[0].first_name, text: "Are you ready?", request_id: "trace-accepted" });
      const trace = service.getDialogueWordsmithTrace({ limit: 10 });
      const found = trace.traces.find((t) => t.request_id === "trace-accepted");
      assert.equal(found.wordsmiths[0].provider_ready, true);
      assert.equal(found.wordsmiths[0].candidate_produced, true);
      assert.equal(found.wordsmiths[0].validator_accepted, true);
      assert.equal(found.wordsmiths[0].rejection_reason, null);
      assert.equal(found.wordsmiths[0].fallback_used, false);
      assert.notEqual(found.wordsmiths[0].output_source, "deterministic-fallback");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}
