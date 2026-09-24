"use strict";

// Pass 9B-2 — connects the already-authorized speech queue (Pass 9B) to the
// live wordsmith provider path. These tests cover only the new connection:
// DesktopService.presentObservationReport (packet -> provider -> validation)
// and DesktopService.processAutonomousSpeech (transaction/staleness wiring).
// Scheduler behavior itself (classification, ownership, ordering, caps) is
// covered by tests/y170-speech-scheduler.test.js and is not re-tested here.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const history = require("../tools/world-history");
const speechScheduler = require("../tools/speech-scheduler");
const { CANDIDATE_VERSION } = require("../tools/ai-local-dialogue");

function buildBareService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y171-"));
  return new DesktopService({ appDataPath: root });
}

// A real, file-backed run/world at a real location (threshold-room), needed
// because buildObservationReportPacket -> projectObserverState ->
// projectLiveScene resolves real worldpack topology. Manufactures one
// report-worthy queue entry against a coworker's own (real) observation
// bucket -- the same bucket Pass 9B's recordCoworkerObservations already
// populated when setSpatialPhase ran.
function fixtureWithQueuedReport(seed) {
  const world = history.createWorld({ seed });
  const started = bootstrap.startRun({ profile: "field-researcher", seed, scenario: "procedural-survey", world, spatial_worldpack: "clear-q4" });
  let run = started.run;
  const player = run.session.startup.player.observer_id;
  run = bootstrap.setSpatialPhase(run, "THRESHOLD");
  run._world = world;
  const speaker = run.expedition.team.members.map((m) => m.personnel_id ?? m.id).find((id) => id !== player);
  const listener = run.expedition.team.members.map((m) => m.personnel_id ?? m.id).find((id) => id !== player && id !== speaker);
  // Give the speaker assignment relevance to the already-recognized landmark
  // so the deterministic classifier scores it REPORT_WHEN_CONVENIENT (a bare
  // landmark with no assignment tie scores too low to queue at all).
  run.expedition.team.members.find((m) => (m.personnel_id ?? m.id) === speaker).task = { target: "threshold-apparatus" };
  const featureId = "landmark:threshold-apparatus";
  const featureEntry = run.observation_state.observers[speaker].features[featureId];
  const delta = { feature_id: featureId, prior_state: null, new_state: featureEntry.state, change_token: featureEntry.seen_change_token, salience_at_notice: featureEntry.salience_at_notice, recognition: featureEntry.recognition };
  speechScheduler.processObservationDeltas(run, world, run.spatial.player_location, { [speaker]: [delta] }, { interval: run.expedition.clock.interval });
  const entry = run.expedition.speech_queue.entries[0];
  assert.ok(entry, "fixture must actually produce a queued report");
  return { world, run, player, speaker, listener, entry };
}

function validSpeechCandidate(observerId, text) {
  return { version: CANDIDATE_VERSION, observer_id: observerId, speech: text };
}

test("A: valid injected provider produces canonical committed speech, listener knowledge, queue removal, suppression marker", async () => {
  const service = buildBareService();
  const { run, speaker, listener, entry } = fixtureWithQueuedReport("y171-a");
  let receivedPacket = null;
  service.localDialogueProvider = {
    name: "test-provider",
    presentLocal: async (packet) => { receivedPacket = packet; return validSpeechCandidate(speaker, "Found the Threshold."); }
  };

  const result = await speechScheduler.drainSpeechQueue(run, run._world, {
    speak: (queueEntry, r) => service.presentObservationReport(queueEntry, r)
  });

  assert.equal(result.drained.length, 1);
  const event = result.drained[0];
  assert.equal(event.speaker_id, speaker, "the provider cannot choose the speaker -- it was fixed before presentLocal was ever called");
  assert.equal(receivedPacket.speaker.observer_id, speaker);
  assert.ok(!("run" in receivedPacket) && !("world" in receivedPacket), "packet must not carry raw run/world");

  const listenerMember = run.expedition.team.members.find((m) => (m.personnel_id ?? m.id) === listener);
  assert.ok((listenerMember.known_information ?? []).some((item) => item.source === "local-communication"), "co-located listener must gain reported knowledge");
  assert.equal(run.expedition.speech_queue.entries.length, 0, "committed entry must be removed from the queue");
  assert.ok(run.expedition.speech_queue.spoken[`${speaker}|${entry.feature_id}`], "a suppression marker must be written on commit");
});

test("B: malformed provider response falls back from the SAME plan and commits once", async () => {
  const service = buildBareService();
  const { run, speaker } = fixtureWithQueuedReport("y171-b");
  service.localDialogueProvider = {
    name: "test-provider",
    presentLocal: async () => ({ version: CANDIDATE_VERSION, observer_id: speaker }) // missing required "speech"
  };

  const result = await speechScheduler.drainSpeechQueue(run, run._world, {
    speak: (queueEntry, r) => service.presentObservationReport(queueEntry, r)
  });

  assert.equal(result.drained.length, 1, "an authorized speech act is never dropped");
  assert.equal(result.drained[0].text, "I'm at the Threshold now.", "deterministic wording from the authorized observation only");
  assert.equal(run.expedition.speech_queue.entries.length, 0);
});

test("C: provider unavailable uses the same-plan fallback", async () => {
  const service = buildBareService();
  const { run } = fixtureWithQueuedReport("y171-c");
  service.localDialogueProvider = null; // no injected override
  const settingsFn = service.settings.bind(service);
  service.settings = () => ({ ...settingsFn(), provider: "offline" }); // not in the "configured" allowlist

  const result = await speechScheduler.drainSpeechQueue(run, run._world, {
    speak: (queueEntry, r) => service.presentObservationReport(queueEntry, r)
  });

  assert.equal(result.drained.length, 1);
  assert.equal(result.drained[0].text, "I'm at the Threshold now.");
  assert.equal(run.expedition.speech_queue.entries.length, 0);
});

test("D: a provider error still commits the deterministic same-plan report; observation truth is untouched", async () => {
  const service = buildBareService();
  const { run, speaker } = fixtureWithQueuedReport("y171-d");
  service.localDialogueProvider = { name: "test-provider", presentLocal: async () => { throw new Error("model down"); } };

  await speechScheduler.drainSpeechQueue(run, run._world, { speak: (e, r) => service.presentObservationReport(e, r) });
  assert.equal(run.expedition.speech_queue.entries.length, 0);
  assert.equal((run.expedition.dialogue_history ?? []).length, 1);
  assert.equal(run.expedition.dialogue_history[0].text, "I'm at the Threshold now.");
  assert.equal(run.observation_state.observers[speaker].features["landmark:threshold-apparatus"].state, "RECOGNIZED", "observation truth is untouched by provider failure");
});

test("E: appliance-backed (auto-selected) provider path is gated by the dialogue runtime supervisor", async () => {
  const service = buildBareService();
  const { run } = fixtureWithQueuedReport("y171-e");
  service.localDialogueProvider = null;
  const settingsFn = service.settings.bind(service);
  service.settings = () => ({ ...settingsFn(), provider: "auto" });
  let wrapCalled = false;
  service.dialogueRuntime.wrapProvider = (provider, opts) => { wrapCalled = true; return { presentLocal: () => opts.fallback() }; };
  service.providerPool.createAutoProvider = () => ({ name: "auto", presentLocal: async () => { throw new Error("unused"); } });

  await speechScheduler.drainSpeechQueue(run, run._world, { speak: (e, r) => service.presentObservationReport(e, r) });
  assert.ok(wrapCalled, "the auto-selected provider must be routed through dialogueRuntime.wrapProvider");
});

test("F: an explicitly injected provider bypasses appliance readiness gating but is still fully validated", async () => {
  const service = buildBareService();
  const { run, speaker } = fixtureWithQueuedReport("y171-f");
  let wrapCalled = false;
  service.dialogueRuntime.wrapProvider = () => { wrapCalled = true; return { presentLocal: async () => null }; };
  // "there is ..." trips the unsupported-factual-speech gate with no
  // semantic_claims array -- proves injection bypasses readiness, not
  // validation.
  service.localDialogueProvider = { name: "injected", presentLocal: async () => validSpeechCandidate(speaker, "There is definitely something wrong here and it is dangerous.") };

  const result = await speechScheduler.drainSpeechQueue(run, run._world, { speak: (e, r) => service.presentObservationReport(e, r) });
  assert.equal(wrapCalled, false, "an explicitly injected provider must not be routed through the supervisor");
  assert.equal(result.drained.length, 1);
  assert.equal(result.drained[0].text, "I'm at the Threshold now.", "an invented anomaly property is rejected and replaced by the same-plan fallback");
});

test("G: a player LOCAL turn in flight prevents an autonomous commit", async () => {
  const service = buildBareService();
  const { run } = fixtureWithQueuedReport("y171-g");
  const world_id = "world-171-g";
  const entry = { run, phase: null };
  service.getWorld = () => ({ world_id });
  service.session = () => entry;
  let persistCalled = false;
  service.persistSession = () => { persistCalled = true; };
  service.communicationTurnInflight.set(world_id, { id: "in-flight" });

  await service.processAutonomousSpeech(world_id, run.run_id);
  assert.equal(persistCalled, false, "autonomous speech must not commit while a player communication turn is in flight");
  assert.equal(run.expedition.speech_queue.entries.length, 1, "the queue entry must remain untouched");
});

test("H: a stale run_id cannot be committed into the current run", async () => {
  const service = buildBareService();
  const { run } = fixtureWithQueuedReport("y171-h");
  const world_id = "world-171-h";
  const staleRunId = run.run_id;
  run.run_id = "a-different-run-now"; // the session moved on since dispatch
  const entry = { run, phase: null };
  service.getWorld = () => ({ world_id });
  service.session = () => entry;
  let persistCalled = false;
  service.persistSession = () => { persistCalled = true; };

  await service.processAutonomousSpeech(world_id, staleRunId);
  assert.equal(persistCalled, false, "a superseded run_id must never be committed into");
  assert.equal(run.expedition.speech_queue.entries.length, 1, "the stale continuation must not have drained the current run's queue");
});
