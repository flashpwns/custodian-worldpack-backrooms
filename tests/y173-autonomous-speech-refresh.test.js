"use strict";

// Pass 9C-2 — the main->renderer refresh/invalidation signal for a
// successfully committed, player-heard autonomous LOCAL report. Scheduler
// mechanics, reentrancy, and interaction-history commit itself are covered
// by y170/y171/y172 and are not re-tested here.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const speechScheduler = require("../tools/speech-scheduler");
const history = require("../tools/world-history");

const PLAYER = "player-1";
const NPC_A = "coworker-a";
const NPC_B = "coworker-b";

function buildBareService(notifyProjectionChanged) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y173-"));
  return new DesktopService({ appDataPath: root, notifyProjectionChanged });
}

function buildRun({ npcBLocation = "room-a", playerLocation = "room-a" } = {}) {
  return {
    run_id: "test-run-173",
    session: { startup: { player: { observer_id: PLAYER } } },
    spatial: {
      player_location: playerLocation,
      personnel_locations: { [PLAYER]: playerLocation, [NPC_A]: "room-a", [NPC_B]: npcBLocation },
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

function wireService({ run, world_id }) {
  const notifications = [];
  const service = buildBareService((wid) => notifications.push(wid));
  const entry = { run, phase: null };
  service.getWorld = () => history.createWorld({ seed: world_id, id: world_id });
  service.session = () => entry;
  service.persistSession = () => {};
  return { service, entry, notifications };
}

test("A: a heard autonomous report commit emits exactly one refresh notification for its world", async () => {
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-173-a";
  const { service, notifications } = wireService({ run, world_id });
  service.presentObservationReport = async () => "Found something odd with the case.";

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.deepEqual(notifications, [world_id]);
});

test("B: a report heard only by a coworker (not the player) emits no refresh notification", async () => {
  const run = buildRun({ playerLocation: "away-room" }); // player physically elsewhere; NPC_B stays with the speaker
  queueReportEntry(run);
  const world_id = "world-173-b";
  const { service, notifications } = wireService({ run, world_id });
  service.presentObservationReport = async () => "Found something odd with the case.";

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.equal(run.expedition.dialogue_history?.length, 1, "the report still canonically commits for the co-located coworker");
  assert.deepEqual(notifications, [], "no player-facing refresh for a report the player didn't hear");
});

test("C: provider failure/rejected candidate emits no refresh notification", async () => {
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-173-c";
  const { service, notifications } = wireService({ run, world_id });
  service.presentObservationReport = async () => null; // rejected/unavailable

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.equal(run.expedition.speech_queue.entries.length, 1);
  assert.deepEqual(notifications, []);
});

test("D: a stale run_id (postponed/superseded report) emits no refresh notification", async () => {
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-173-d";
  const { service, notifications } = wireService({ run, world_id });
  service.presentObservationReport = async () => "Found something odd with the case.";

  await service.processAutonomousSpeech(world_id, "a-different-run-that-already-moved-on");
  assert.deepEqual(notifications, []);
  assert.equal(run.expedition.speech_queue.entries.length, 1, "a stale-run continuation must not drain the current run's queue either");
});

test("D2: a world that became busy before commit (postponed) emits no refresh notification", async () => {
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-173-d2";
  const { service, notifications } = wireService({ run, world_id });
  service.presentObservationReport = async () => "Found something odd with the case.";
  service.communicationTurnInflight.set(world_id, { id: "local-in-flight" });

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.deepEqual(notifications, []);
  assert.equal(run.expedition.speech_queue.entries.length, 1);
});

test("E: the renderer wiring is invalidate-and-reread, never a second transcript authority", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "desktop", "preload.js"), "utf8");
  const rendererSrc = fs.readFileSync(path.join(__dirname, "..", "desktop", "renderer", "renderer.js"), "utf8");
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.js"), "utf8");

  assert.ok(preload.includes("onProjectionChanged"), "preload must expose the subscription");
  // The main-process send site must only ever pass a world_id -- never
  // dialogue/report content -- across this channel.
  const sendMatch = mainSrc.match(/webContents\.send\("yellow-beast:projectionChanged",\s*\{\s*world_id\s*\}\)/);
  assert.ok(sendMatch, "the push payload must be limited to { world_id }");

  const subscriptionBlock = rendererSrc.slice(rendererSrc.indexOf("onProjectionChanged(async"));
  assert.ok(subscriptionBlock.includes("getGameplayProjection"), "the renderer must re-read via the existing projection path");
  assert.ok(subscriptionBlock.includes("current.projection = refreshed.projection"), "the renderer must reuse the same projection assignment refresh-view already uses");
  assert.ok(!/dialogue_history|presentationBus|presentation_events/i.test(subscriptionBlock.slice(0, subscriptionBlock.indexOf("current.projection"))), "the subscription must not read/append raw dialogue state itself -- it only triggers the existing read path");
});

test("F: one committed report yields exactly one visible localHistory row across repeated projection reads", async () => {
  const run = buildRun();
  queueReportEntry(run);
  const world_id = "world-173-f";
  const { service } = wireService({ run, world_id });
  service.presentObservationReport = async () => "Found something odd with the case.";

  await service.processAutonomousSpeech(world_id, run.run_id);
  const q4Experience = require("../tools/q4-experience");
  const bootstrap = require("../tools/run-bootstrap");
  // A minimal, direct read of the same interaction_history the LOCAL rail
  // renders from (q4-experience.js's localHistory), read twice to prove a
  // re-read never duplicates the row.
  const interactions = require("../tools/q4-interactions");
  const first = interactions.history(run.expedition, "local").filter((row) => row.source === "autonomous-observation");
  const second = interactions.history(run.expedition, "local").filter((row) => row.source === "autonomous-observation");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  void q4Experience; void bootstrap;
});
