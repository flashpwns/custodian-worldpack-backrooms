"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const speechScheduler = require("../tools/speech-scheduler");
const presentationBus = require("../tools/presentation-bus");
const decisionScheduler = require("../tools/decision-scheduler");
const { DesktopService } = require("../desktop/service");

const PLAYER = "player-1";
const NPC_A = "coworker-a";
const NPC_B = "coworker-b";

function buildRun({ npcALocation = "room-a", npcBLocation = "room-a", npcAStatus = "active" } = {}) {
  return {
    run_id: "test-run",
    session: { startup: { player: { observer_id: PLAYER } } },
    spatial: {
      player_location: "room-a",
      personnel_locations: { [PLAYER]: "room-a", [NPC_A]: npcALocation, [NPC_B]: npcBLocation },
      last_confirmed_personnel_positions: {}
    },
    expedition: {
      clock: { interval: 5 },
      equipment: {},
      messages: [],
      team: {
        members: [
          { id: PLAYER, personnel_id: PLAYER, role: "field researcher", qualifications: [], status: "active" },
          { id: NPC_A, personnel_id: NPC_A, first_name: "Alex", role: "survey technician", qualifications: ["instrumentation"], status: npcAStatus, task: { target: "obj-1" } },
          { id: NPC_B, personnel_id: NPC_B, first_name: "Bel", role: "documentation specialist", qualifications: ["photography"], status: "active" }
        ]
      }
    },
    observation_state: { version: "yellow-beast-observation-state@v1", observers: {} }
  };
}

function recognizedDelta(featureId, { priorState = "NOTICED", qualification = null } = {}) {
  return { feature_id: featureId, prior_state: priorState, new_state: "RECOGNIZED", change_token: "tok-1", salience_at_notice: 20, recognition: { qualification, at: 5 } };
}

function withObservationEntry(run, observerId, featureId, delta) {
  run.observation_state.observers[observerId] ??= { features: {} };
  run.observation_state.observers[observerId].features[featureId] = {
    state: delta.new_state,
    first_at: 5,
    last_at: 5,
    seen_change_token: delta.change_token,
    salience_at_notice: delta.salience_at_notice,
    recognition: delta.recognition,
    provenance: [{ source: "direct-observation", at: 5, direct: true }]
  };
}

test("1/2: low-priority recognized observation classifies NOTICE_ONLY and never queues", () => {
  const run = buildRun();
  const delta = recognizedDelta("landmark:old-console", { priorState: "NOTICED" });
  withObservationEntry(run, NPC_A, "landmark:old-console", delta);
  const disposition = speechScheduler.classifyReport(run, null, NPC_A, delta);
  assert.equal(disposition, "NOTICE_ONLY");
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  assert.equal(run.expedition.speech_queue?.entries.length ?? 0, 0);
});

test("3: assignment-relevant object observation is report-worthy and queues", () => {
  const run = buildRun();
  const delta = recognizedDelta("object:obj-1", { priorState: null });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  const disposition = speechScheduler.classifyReport(run, null, NPC_A, delta);
  assert.equal(disposition, "REPORT_WHEN_CONVENIENT");
  const enqueued = speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  assert.equal(enqueued.length, 1);
  assert.equal(run.expedition.speech_queue.entries[0].observer_id, NPC_A);
  assert.equal(run.expedition.speech_queue.entries[0].feature_id, "object:obj-1");
});

test("4/5: interrupt-worthy personnel condition interrupts only when no communication turn is inflight", async () => {
  const run = buildRun();
  run.expedition.team.members.push({ id: "field-tech-1", personnel_id: "field-tech-1", role: "route specialist", qualifications: [], status: "dead" });
  const delta = recognizedDelta("personnel:field-tech-1", { priorState: null });
  withObservationEntry(run, NPC_A, "personnel:field-tech-1", delta);
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  assert.equal(run.expedition.speech_queue.entries.length, 1);
  const entry = run.expedition.speech_queue.entries[0];
  assert.equal(entry.disposition, "INTERRUPT_NOW");

  const delayed = await speechScheduler.drainSpeechQueue(run, null, { communicationTurnInflight: true, speak: async () => "should not be reached" });
  assert.equal(delayed.drained.length, 0);
  assert.equal(run.expedition.speech_queue.entries.length, 1, "entry must remain queued while a communication turn is inflight");
});

test("6: exactly one primary reporter is selected deterministically for shared qualification", () => {
  const run = buildRun();
  const featureId = "personnel:someone";
  const owners = speechScheduler.selectReportOwners(run, null, [NPC_A, NPC_B], featureId, { [NPC_A]: 40, [NPC_B]: 35 });
  assert.deepEqual(owners, [NPC_A]);
});

test("6b: a second owner is added only for a materially distinct qualification", () => {
  const run = buildRun();
  const featureId = "phenomenon:phen-1";
  run.observation_state.observers[NPC_A] = { features: { [featureId]: { recognition: { qualification: "instrumentation" } } } };
  run.observation_state.observers[NPC_B] = { features: { [featureId]: { recognition: { qualification: "photography" } } } };
  const owners = speechScheduler.selectReportOwners(run, null, [NPC_A, NPC_B], featureId, { [NPC_A]: 40, [NPC_B]: 38 });
  assert.deepEqual(owners.sort(), [NPC_A, NPC_B].sort());
  assert.ok(owners.length <= 2);
});

test("7: duplicate same feature/change_token is suppressed after being spoken", () => {
  const run = buildRun();
  const delta = recognizedDelta("object:obj-1", { priorState: "NOTICED" });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  speechScheduler.ensureQueue(run);
  run.expedition.speech_queue.spoken[`${NPC_A}|object:obj-1`] = { change_token: "tok-1", at: 4 };
  const score = speechScheduler.scoreReport(run, null, NPC_A, delta);
  assert.equal(score, null);
  assert.equal(speechScheduler.classifyReport(run, null, NPC_A, delta), "NOTICE_ONLY");
});

test("8/9: provider failure preserves the queue entry; exhaustion after two failures silences it", async () => {
  const run = buildRun();
  const delta = recognizedDelta("object:obj-1", { priorState: null });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  assert.equal(run.expedition.speech_queue.entries.length, 1);

  const failing = async () => { throw new Error("provider down"); };
  await speechScheduler.drainSpeechQueue(run, null, { speak: failing });
  assert.equal(run.expedition.speech_queue.entries.length, 1, "first failure must not delete the queue entry");
  assert.equal(run.expedition.speech_queue.entries[0].attempts, 1);
  assert.equal((run.expedition.dialogue_history ?? []).length, 0, "observation and knowledge remain untouched on failure");

  await speechScheduler.drainSpeechQueue(run, null, { speak: failing });
  assert.equal(run.expedition.speech_queue.entries.length, 0, "exhaustion after two failures removes the entry -- silence, not a canned fallback");
});

test("10/11: a committed report routes only to actual LOCAL listeners and updates only their knowledge", async () => {
  const run = buildRun({ npcBLocation: "room-a" }); // NPC_B co-located, can hear
  const delta = recognizedDelta("object:obj-1", { priorState: null });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });

  const result = await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd with the case." });
  assert.equal(result.drained.length, 1);
  const event = result.drained[0];
  assert.equal(event.speaker_id, NPC_A);
  assert.ok(event.listeners.includes(PLAYER));
  assert.ok(event.listeners.includes(NPC_B));

  const npcBMember = run.expedition.team.members.find((m) => m.personnel_id === NPC_B);
  assert.ok((npcBMember.known_information ?? []).some((item) => item.source === "local-communication"));
});

test("12/13: reported knowledge never writes observation_state and cannot itself trigger a new report", () => {
  const run = buildRun({ npcBLocation: "room-a" });
  const delta = recognizedDelta("object:obj-1", { priorState: "NOTICED" });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  const before = JSON.stringify(run.observation_state.observers[NPC_B] ?? null);

  // Simulate the listener knowledge write routeAndDeliver performs -- no observation_state touch.
  run.expedition.team.members.find((m) => m.personnel_id === NPC_B).known_information = [
    { kind: "reported-knowledge", source: "local-communication", proposition: "Found something odd.", text: "Found something odd." }
  ];
  assert.equal(JSON.stringify(run.observation_state.observers[NPC_B] ?? null), before);

  // Reported knowledge has no feature_id/change_token shape, so it can never
  // be fed into processObservationDeltas as a new delta -- there is nothing
  // for it to enqueue.
  const enqueued = speechScheduler.processObservationDeltas(run, null, "room-a", {}, { interval: 5 });
  assert.deepEqual(enqueued, []);
});

test("14: the player renderer only receives an autonomous LOCAL dialogue line when listed as a listener", () => {
  const run = buildRun();
  const heardByPlayer = { id: "dlg-1", type: presentationBus.EVENT_TYPES.DIALOGUE, channel: "LOCAL", listeners: [PLAYER, NPC_B], speaker_id: NPC_A, text: "heads up" };
  const notHeardByPlayer = { id: "dlg-2", type: presentationBus.EVENT_TYPES.DIALOGUE, channel: "LOCAL", listeners: [NPC_B], speaker_id: NPC_A, text: "aside to Bel only" };
  const nonDialogue = { id: "pevt-1", type: presentationBus.EVENT_TYPES.PERSONNEL_STATUS, channel: "LOCAL", text: "status" };
  const legacyNoListeners = { id: "dlg-3", type: presentationBus.EVENT_TYPES.DIALOGUE, channel: "LOCAL", text: "authored briefing beat" };

  const filtered = DesktopService.prototype.filterAutonomousDialogueForPlayer.call({}, [heardByPlayer, notHeardByPlayer, nonDialogue, legacyNoListeners], run);
  const ids = filtered.map((e) => e.id);
  assert.ok(ids.includes("dlg-1"));
  assert.ok(!ids.includes("dlg-2"), "a LOCAL dialogue event that omits the player from listeners[] must not reach the renderer");
  assert.ok(ids.includes("pevt-1"), "non-dialogue events must pass through unfiltered");
  assert.ok(ids.includes("dlg-3"), "events with no listeners[] recorded (legacy authored narration) must pass through unchanged");
});

test("15: save/reload (JSON round-trip) preserves queue ordering and suppression state", () => {
  const run = buildRun();
  const delta1 = recognizedDelta("object:obj-1", { priorState: null });
  withObservationEntry(run, NPC_A, "object:obj-1", delta1);
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta1] }, { interval: 5 });
  speechScheduler.markSpoken(run, run.expedition.speech_queue.entries[0]);

  const reserialized = JSON.parse(JSON.stringify(run.expedition.speech_queue));
  const migrated = speechScheduler.migrate(reserialized);
  assert.deepEqual(speechScheduler.validateCurrent(migrated), { ok: true });
  assert.equal(migrated.seq, run.expedition.speech_queue.seq);
  assert.deepEqual(Object.keys(migrated.spoken), Object.keys(run.expedition.speech_queue.spoken));
});

test("16: decision-scheduler's former hardcoded DIALOGUE bypass no longer emits unrouted speech", () => {
  const run = buildRun();
  run.expedition.day1_opener = {};
  run.spatial.personnel_locations[NPC_A] = "outpost-a";
  run.expedition.equipment["duffle-1"] = { id: "startup-materials-duffle", holder: NPC_A, label: "Startup Materials Duffle" };
  run.expedition.team.members.find((m) => m.personnel_id === NPC_A).delivery_opportunity_noted = false;
  run.expedition.team.members.find((m) => m.personnel_id === NPC_A).ordered_to_deliver = false;

  decisionScheduler.scheduleDecisions(run, {}, null);
  const dialogueEvents = (run.expedition.presentation_bus?.events ?? []).filter((e) => e.type === presentationBus.EVENT_TYPES.DIALOGUE);
  assert.equal(dialogueEvents.length, 0, "the delivery-opportunity path must no longer emit an unrouted DIALOGUE event");
});

test("17: the wordsmith function only supplies text -- it cannot select speaker, feature, or eligibility", async () => {
  const run = buildRun();
  const delta = recognizedDelta("object:obj-1", { priorState: null });
  withObservationEntry(run, NPC_A, "object:obj-1", delta);
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  const preselectedObserver = run.expedition.speech_queue.entries[0].observer_id;
  const preselectedFeature = run.expedition.speech_queue.entries[0].feature_id;

  let observedEntry = null;
  const result = await speechScheduler.drainSpeechQueue(run, null, {
    speak: async (entry) => { observedEntry = entry; return "arbitrary model wording, irrelevant to selection"; }
  });
  assert.equal(observedEntry.observer_id, preselectedObserver);
  assert.equal(observedEntry.feature_id, preselectedFeature);
  assert.equal(result.drained[0].speaker_id, preselectedObserver);
});
