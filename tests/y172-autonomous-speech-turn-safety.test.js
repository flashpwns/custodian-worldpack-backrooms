"use strict";

// Pass 9C — closes the Beat 1 blockers from the Opus 5.5 audit:
//   B1 — autonomous speech commit could race/interleave with a player turn
//   S1 — heard autonomous LOCAL reports never reached the visible LOCAL rail
//   S2 — unheard LOCAL report metadata could leak through Expedition traffic
//
// Scheduler mechanics (classification, ownership, ordering, caps) and the
// live provider wiring itself are covered by y170/y171 and are not
// re-tested here.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const speechScheduler = require("../tools/speech-scheduler");
const communicationRuntime = require("../tools/communication-runtime");
const history = require("../tools/world-history");

const PLAYER = "player-1";
const NPC_A = "coworker-a";
const NPC_B = "coworker-b";

function buildBareService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y172-"));
  return new DesktopService({ appDataPath: root });
}

function buildRun({ npcBLocation = "room-a" } = {}) {
  return {
    run_id: "test-run-172",
    session: { startup: { player: { observer_id: PLAYER } } },
    spatial: {
      player_location: "room-a",
      personnel_locations: { [PLAYER]: "room-a", [NPC_A]: "room-a", [NPC_B]: npcBLocation },
      last_confirmed_personnel_positions: {}
    },
    expedition: {
      clock: { interval: 5 },
      equipment: {},
      messages: [],
      team: {
        members: [
          { id: PLAYER, personnel_id: PLAYER, role: "field researcher", qualifications: [], status: "active" },
          { id: NPC_A, personnel_id: NPC_A, first_name: "Alex", role: "survey technician", qualifications: ["instrumentation"], status: "active", task: { target: "obj-1" } },
          { id: NPC_B, personnel_id: NPC_B, first_name: "Bel", role: "documentation specialist", qualifications: ["photography"], status: "active" }
        ]
      }
    },
    observation_state: { version: "yellow-beast-observation-state@v1", observers: {} }
  };
}

function queueReportEntry(run) {
  const delta = { feature_id: "object:obj-1", prior_state: null, new_state: "RECOGNIZED", change_token: "tok-1", salience_at_notice: 20, recognition: { qualification: null, at: 5 } };
  run.observation_state.observers[NPC_A] = { features: { "object:obj-1": { state: "RECOGNIZED", first_at: 5, last_at: 5, seen_change_token: "tok-1", salience_at_notice: 20, recognition: { qualification: null, at: 5 }, provenance: [] } } };
  speechScheduler.processObservationDeltas(run, null, "room-a", { [NPC_A]: [delta] }, { interval: 5 });
  return run.expedition.speech_queue.entries[0];
}

test("A: a natural-language player turn in flight prevents the provider from ever being called", async () => {
  const service = buildBareService();
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-172-a";
  const entry = { run, phase: null };
  service.getWorld = () => ({ world_id });
  service.session = () => entry;
  let persistCalled = false;
  service.persistSession = () => { persistCalled = true; };
  service.naturalTurnInflight.set(world_id, { id: "nl-in-flight" });

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.equal(persistCalled, false);
  assert.equal(run.expedition.speech_queue.entries.length, 1);
});

test("B: a LOCAL player turn in flight prevents commit landing between the utterance and its hosted reply", async () => {
  const service = buildBareService();
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-172-b";
  const entry = { run, phase: null };
  service.getWorld = () => ({ world_id });
  service.session = () => entry;
  let persistCalled = false;
  service.persistSession = () => { persistCalled = true; };
  service.communicationTurnInflight.set(world_id, { id: "local-in-flight" });

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.equal(persistCalled, false);
  assert.equal(run.expedition.speech_queue.entries.length, 1);
});

test("C: the world becoming busy while the provider is working postpones the commit without penalty", async () => {
  const run = buildRun();
  queueReportEntry(run);
  let busy = false;
  const result = await speechScheduler.drainSpeechQueue(run, null, {
    speak: async (queueEntry) => { busy = true; return "Found something odd."; }, // becomes busy mid-flight
    canCommit: () => !busy
  });
  assert.equal(result.drained.length, 0, "postponed, not committed");
  assert.equal(run.expedition.speech_queue.entries.length, 1, "the entry must remain queued");
  assert.equal(run.expedition.speech_queue.entries[0].attempts, 0, "a postponement is not a provider failure -- attempts must not increase");
  assert.equal((run.expedition.dialogue_history ?? []).length, 0);
});

test("D: after the blocking player turn finishes, the queued report gets another drain opportunity", async () => {
  const service = buildBareService();
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-172-d";
  const entry = { run, phase: null };
  service.getWorld = () => history.createWorld({ seed: "y172-d", id: world_id });
  service.session = () => entry;
  let persistCalled = false;
  service.persistSession = () => { persistCalled = true; };
  service.presentObservationReport = async () => "Found something odd with the case.";

  // Simulate the finally-block follow-up call a real player turn would make.
  service.giveAutonomousSpeechAnotherChance(world_id);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(persistCalled, true, "the follow-up opportunity must actually drain and persist");
  assert.equal(run.expedition.speech_queue.entries.length, 0);
});

test("E: a postponed entry survives untouched -- no ghost report, no premature suppression marker", async () => {
  const run = buildRun();
  const entry = queueReportEntry(run);
  const before = structuredClone(run.expedition.speech_queue);

  let busy = true;
  const result = await speechScheduler.drainSpeechQueue(run, null, {
    speak: async () => "Found something odd.",
    canCommit: () => !busy
  });

  assert.equal(result.drained.length, 0);
  assert.deepEqual(run.expedition.speech_queue.entries, before.entries, "the entry must be byte-identical to before the postponed attempt");
  assert.deepEqual(run.expedition.speech_queue.spoken, {}, "no suppression marker may be written for a postponed report");
  assert.equal((run.expedition.dialogue_history ?? []).length, 0);
  assert.equal((run.expedition.interaction_history ?? []).length, 0);

  // Now the world is free again: a later, ordinary drain must still succeed
  // exactly once -- proving postponement never corrupted the entry.
  busy = false;
  const retried = await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd.", canCommit: () => true });
  assert.equal(retried.drained.length, 1);
  assert.equal(run.expedition.speech_queue.entries.length, 0);
});

test("F: a heard autonomous report appears exactly once in the visible interaction history", async () => {
  const run = buildRun({ npcBLocation: "room-a" });
  queueReportEntry(run);
  const result = await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd with the case." });
  assert.equal(result.drained.length, 1);
  const rows = run.expedition.interaction_history.filter((item) => item.source === "autonomous-observation");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "local");
  assert.equal(rows[0].speaker_id, NPC_A);
  assert.equal(rows[0].listeners.includes(PLAYER), true);
  assert.equal(rows[0].presentation.response, "Found something odd with the case.");
});

test("G: a report the player did not hear never enters interaction history", async () => {
  // Isolate the speaker in a different room from everyone, including the
  // player, so routeAndDeliver's LOCAL routing yields zero actual hearers.
  const run = buildRun({ npcBLocation: "elsewhere" });
  run.spatial.player_location = "elsewhere";
  run.spatial.personnel_locations[PLAYER] = "elsewhere";
  const entry = queueReportEntry(run);
  entry.audience.required_listener_ids = [];
  const result = await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd with the case." });
  // No listeners heard it at all, so it can't commit -- but even in that
  // edge case, no interaction_history row may exist.
  assert.equal((run.expedition.interaction_history ?? []).length, 0);
  void result;
});

test("G2: a report heard by a coworker but not the player is committed but stays out of the player's interaction history", async () => {
  const run = buildRun({ npcBLocation: "room-a" });
  run.spatial.player_location = "away-room"; // player physically elsewhere
  run.spatial.personnel_locations[PLAYER] = "away-room";
  queueReportEntry(run);
  const result = await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd with the case." });
  assert.equal(result.drained.length, 1, "the report is still canonically heard by the co-located coworker");
  assert.equal((run.expedition.interaction_history ?? []).length, 0, "the player never heard it, so it must not appear in their rail");
});

test("H: unheard LOCAL message metadata is excluded from projected recent traffic", () => {
  const expedition = { clock: { interval: 5 }, communications: { check_ins: [], last_successful_contact: null }, team: { members: [{ personnel_id: PLAYER }, { personnel_id: NPC_A }, { personnel_id: NPC_B }] }, messages: [
    { id: "m1", sender: NPC_A, intended_recipient: NPC_B, channel: "LOCAL", purpose: "observation-report", sent_at: 5, actual_recipients: [NPC_B] } // player not a recipient, not sender
  ] };
  const projected = communicationRuntime.project(expedition, { playerId: PLAYER });
  assert.equal(projected.messages.length, 0, "LOCAL metadata the player could not receive must not leak through");
});

test("I: legitimate STANDARD/radio metadata remains visible regardless of LOCAL filtering", () => {
  const expedition = { clock: { interval: 5 }, communications: { check_ins: [], last_successful_contact: null }, team: { members: [{ personnel_id: PLAYER }] }, messages: [
    { id: "m2", sender: PLAYER, intended_recipient: "Standard", channel: "FIELD_RADIO", purpose: "scheduled-check-in", sent_at: 5, actual_recipients: ["Standard"] }
  ] };
  const projected = communicationRuntime.project(expedition, { playerId: PLAYER });
  assert.equal(projected.messages.length, 1, "STANDARD/radio records must never be hidden by the LOCAL visibility filter");
});

test("J: save/reload does not duplicate the visible report", async () => {
  const run = buildRun({ npcBLocation: "room-a" });
  queueReportEntry(run);
  await speechScheduler.drainSpeechQueue(run, null, { speak: async () => "Found something odd with the case." });
  const before = run.expedition.interaction_history.filter((item) => item.source === "autonomous-observation").length;
  assert.equal(before, 1);

  const reloaded = JSON.parse(JSON.stringify(run));
  const after = reloaded.expedition.interaction_history.filter((item) => item.source === "autonomous-observation").length;
  assert.equal(after, 1, "a JSON round-trip (save/reload) must not duplicate the committed row");
});
