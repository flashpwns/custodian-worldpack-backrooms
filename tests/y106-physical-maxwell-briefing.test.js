"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const YBAudio = require("../desktop/renderer/audio");
const presentationBus = require("../tools/presentation-bus");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

function createTestService(seed = "maxwell-briefing-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y106-briefing-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  return { service, root, seed };
}

test("y106 — Beat 2: Physical Dr. Kirk Maxwell Briefing Lifecycle & Invariants", async (t) => {
  const { service, root, seed } = createTestService();

  try {
    // 1. Setup world and verified personnel
    const created = service.createWorld({ name: "Maxwell Briefing Test World", seed });
    assert.equal(created.ok, true);
    const worldId = created.world.id;

    assert.equal(service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" }).ok, true);
    assert.equal(service.confirmQ4Personnel({ world_id: worldId }).ok, true);

    // 2. Start session -> begins in PERSONNEL_BRIEFING pending
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    const initialProj = started.projection;
    assert.equal(initialProj.phase.phase_id, "BRIEFING");
    assert.equal(initialProj.q4.beat, "PERSONNEL_BRIEFING");
    assert.equal(initialProj.q4.personnel_briefing.status, "pending");
    assert.equal(initialProj.q4.channels.local.available, false, "Local communication must be unavailable while briefing is pending");
    assert.equal(initialProj.available_actions.some((a) => a.type === "READY"), false, "Staging transition must be gated while briefing pending");

    // Criteria A: BRIEFING PENDING exposes ATTEND_BRIEFING in available_actions
    assert.ok(
      initialProj.available_actions.some((a) => a.type === "ATTEND_BRIEFING"),
      "available_actions must contain ATTEND_BRIEFING when briefing is pending"
    );

    // UI rendering in pending state exposes ATTEND BRIEFING button with data-game-action="ATTEND_BRIEFING"
    const renderedPending = YBSurfaces.briefingWorkstation(initialProj);
    assert.match(renderedPending, /data-game-action="ATTEND_BRIEFING"/, "Rendered button must contain data-game-action='ATTEND_BRIEFING'");
    assert.match(renderedPending, /BRIEFING PENDING/, "Button text or heading must show BRIEFING PENDING during pending phase");
    assert.doesNotMatch(renderedPending, /class="in-person-briefing"/, "In-person briefing transcript must not appear while pending");

    // Criteria B: Activating the canonical action path (ATTEND_BRIEFING) advances state to active Maxwell briefing
    const attendRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    assert.equal(attendRes.ok, true, "ATTEND_BRIEFING action must succeed");
    assert.equal(attendRes.result.status, "active");

    // Criteria C: State advances to active Maxwell briefing
    const activeProj = attendRes.projection;
    const briefing = activeProj.q4.personnel_briefing;
    assert.equal(briefing.status, "active", "Briefing status must be active");
    assert.equal(briefing.speaker, "DR. KIRK MAXWELL", "Speaker must be DR. KIRK MAXWELL");
    assert.equal(briefing.room_id, "async-briefing-room", "Room must be async-briefing-room (Standard side)");

    // Criteria E: Persistence / rerender cycle does NOT return to BRIEFING PENDING
    const refreshedProj = service.getGameplayProjection({ world_id: worldId, mode: "field-researcher" });
    assert.equal(refreshedProj.ok, true);
    assert.equal(refreshedProj.projection.q4.personnel_briefing.status, "active", "Briefing status must remain active across getGameplayProjection");
    const reloadedEntry = service.restoreSession(service.getWorld(worldId), "field-researcher", JSON.parse(fs.readFileSync(service.sessionFile(worldId, "field-researcher"), "utf8")));
    assert.equal(reloadedEntry.run.expedition.day1_opener.personnel_briefing.status, "active", "Persisted session on disk must preserve active briefing status");

    // Invariant: Maxwell establishes working relationship including exact line "You can call me Kirk."
    const openingText = briefing.exchange_history[0]?.text ?? "";
    assert.match(openingText, /You can call me Kirk\./, "Opening remarks must contain exact line: 'You can call me Kirk.'");
    assert.match(openingText, /Good morning, Q4 assignees\./, "Opening remarks must include formal greeting");
    assert.match(openingText, /Eleanor, you're on camera\./, "Roster call must address player Eleanor on camera");

    // Invariant: Expedition team total is exactly 4 members
    const team = activeProj.q4.team ?? [];
    assert.equal(team.length, 4, "Expedition team total must be exactly 4 members");

    // Invariant: Zero radio chirps emitted during briefing
    const audioDiag = YBAudio.diagnostics();
    assert.equal(audioDiag.radio_tx_chirp_count ?? 0, 0, "Zero radio chirps may be emitted during physical briefing");

    // UI rendering in active state shows physical briefing header, transcript, and CONCLUDE button
    const renderedActive = YBSurfaces.expeditionCockpit(activeProj, { phaseRecord: YBSurfaces.render(activeProj) });
    assert.match(renderedActive, /class="in-person-briefing"/, "In-person briefing view must be rendered");
    assert.match(renderedActive, /Dr\. Kirk Maxwell/, "Dr. Kirk Maxwell header must be visible");
    assert.doesNotMatch(renderedActive, /Chief Expedition Briefing Authority/, "Gamified title badge must not be displayed");
    assert.doesNotMatch(renderedActive, />IN-PERSON BRIEFING</, "Gamified meta-mode badge must not be displayed");
    assert.match(renderedActive, /KV31 Lower Briefing Room/, "Standard-side briefing room must be identified");
    assert.match(renderedActive, /CONCLUDE BRIEFING/, "Action dock must feature CONCLUDE BRIEFING button");

    // Invariant: Staging transition (READY) remains strictly gated while briefing is active
    assert.equal(activeProj.available_actions.some((a) => a.type === "READY"), false, "READY must remain gated while briefing active");
    const prematureReady = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" });
    assert.equal(prematureReady.ok, false, "Submitting READY prematurely must fail");
    assert.equal(prematureReady.error.code, "BRIEFING_IN_PROGRESS");

    // 4. In-person question & answer: deterministic canonical facts
    // Inquiry A: Route and guidance tape
    const tapeInquiry = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "What route do we follow? How do the arrows work?" });
    assert.equal(tapeInquiry.ok, true);
    assert.match(tapeInquiry.result.reply, /neon-green adhesive tape/, "Must state neon-green adhesive tape");
    assert.match(tapeInquiry.result.reply, /forward toward Outpost A/, "Must state arrows point forward to Outpost A");
    assert.match(tapeInquiry.result.reply, /reverse arrows guide back to KV31/, "Must state reverse arrows guide back to KV31");

    // Inquiry B: Destination & Outpost A
    const outpostInquiry = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "Tell me about Outpost A." });
    assert.equal(outpostInquiry.ok, true);
    assert.match(outpostInquiry.result.reply, /Outpost A is our forward bastion along the guidance path, Bermuda branch\./, "Must state Outpost A forward bastion");
    assert.match(outpostInquiry.result.reply, /startup duffle/, "Must state primary delivery task");

    // Inquiry C: Operating times and cutoff
    const timeInquiry = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "What is the schedule and cutoff time?" });
    assert.equal(timeInquiry.ok, true);
    assert.match(timeInquiry.result.reply, /10:00 AM/, "Must confirm 10:00 AM departure");
    assert.match(timeInquiry.result.reply, /12:00 noon/, "Must confirm 12:00 noon expected return");
    assert.match(timeInquiry.result.reply, /1:00 PM firm/, "Must confirm 1:00 PM operational cutoff");

    // Inquiry D: Equipment roles
    const equipInquiry = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "What equipment are each of us carrying?" });
    assert.equal(equipInquiry.ok, true);
    assert.match(equipInquiry.result.reply, /startup duffle/, "Must mention courier with duffle");
    assert.match(equipInquiry.result.reply, /field camera and lamp/, "Must mention player on camera and lamp");
    assert.match(equipInquiry.result.reply, /spectrometer/, "Must mention coworker on spectrometer");
    assert.match(equipInquiry.result.reply, /layout record/, "Must mention coworker on layout record");

    // Invariant: Never fabricate player dialogue. Player's exact text is recorded under "YOU".
    const history = service.session(worldId, "field-researcher").run.expedition.day1_opener.personnel_briefing.exchange_history;
    const playerTurns = history.filter((t) => t.speaker === "YOU");
    assert.equal(playerTurns.length, 4, "Must have exactly 4 player statements recorded");
    assert.equal(playerTurns[0].text, "What route do we follow? How do the arrows work?");
    assert.equal(playerTurns[1].text, "Tell me about Outpost A.");
    assert.equal(playerTurns[2].text, "What is the schedule and cutoff time?");
    assert.equal(playerTurns[3].text, "What equipment are each of us carrying?");

    // 5. Conclude the briefing -> deterministic handoff to LOCAL_INTRODUCTIONS
    const concludeRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    assert.equal(concludeRes.ok, true);
    assert.equal(concludeRes.result.status, "concluded");
    assert.equal(concludeRes.result.beat, "LOCAL_INTRODUCTIONS");

    const concludedProj = concludeRes.projection;
    assert.equal(concludedProj.q4.beat, "LOCAL_INTRODUCTIONS", "Beat must transition to LOCAL_INTRODUCTIONS");
    assert.equal(concludedProj.q4.personnel_briefing.status, "concluded", "Briefing status must be concluded");

    // Dismissal dialogue was delivered
    const lastExchange = concludedProj.q4.personnel_briefing.exchange_history[concludedProj.q4.personnel_briefing.exchange_history.length - 1];
    assert.match(lastExchange.text, /There isn't time for questions here\. Get acquainted, then report to Equipment Staging\./, "Dismissal line must be recorded");

    // Invariant: Deterministic handoff to LOCAL_INTRODUCTIONS
    // - Coworker local communications channel is now available
    assert.equal(concludedProj.q4.channels.local.available, true, "Local channel must be unlocked after Maxwell departs");

    // - Coworker introduction pressure is now active
    assert.ok(Array.isArray(concludedProj.q4.introduction_pressure), "Introduction pressure must be active");
    assert.equal(concludedProj.q4.introduction_pressure.length, 3, "Introduction pressure must be present for all 3 coworkers");

    // - Equipment staging transition (READY) is now unlocked in available_actions
    assert.ok(
      concludedProj.available_actions.some((a) => a.type === "READY"),
      "PROCEED TO EQUIPMENT STAGING (READY) must now be available in available_actions"
    );

    // - Scope discipline: Do NOT auto-advance into STAGING; phase remains BRIEFING until player acts
    assert.equal(concludedProj.phase.phase_id, "BRIEFING", "Must remain at BRIEFING phase boundary awaiting player action");

    // Failure F & E: Rendered concluded state shows dedicated local introductions view with 3 coworkers and single un-duplicated action
    const renderedConcluded = YBSurfaces.expeditionCockpit(concludedProj, { phaseRecord: YBSurfaces.render(concludedProj) });
    assert.match(renderedConcluded, /class="local-introductions-scene"/, "Must render dedicated local-introductions-scene");
    assert.match(renderedConcluded, /coworker-presence-card/, "Must render coworker presence cards");
    assert.match(renderedConcluded, /PROCEED TO EQUIPMENT STAGING/, "Must feature PROCEED TO EQUIPMENT STAGING action");
    assert.doesNotMatch(renderedConcluded, /PROCEED TO ESD · PROCEED TO EQUIPMENT STAGING/, "Must not concatenate duplicated action labels");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y106 — Silence / decline to elaborate cleanly concludes briefing", async () => {
  const { service, root } = createTestService("silence-test");

  try {
    const created = service.createWorld({ name: "Silence Test World", seed: "silence-1991" });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Daniel", last_name: "Cross" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });

    // Start briefing
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });

    // Player submits silence / "no questions"
    const silenceRes = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "No questions." });
    assert.equal(silenceRes.ok, true);

    const proj = silenceRes.projection;
    assert.equal(proj.q4.beat, "LOCAL_INTRODUCTIONS", "Silence / 'No questions' must advance beat to LOCAL_INTRODUCTIONS");
    assert.equal(proj.q4.personnel_briefing.status, "concluded");
    assert.equal(proj.q4.channels.local.available, true);
    assert.ok(proj.available_actions.some((a) => a.type === "READY"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y106 — Natural text 'attend briefing' during pending state produces identical advance to button action", async () => {
  const { service, root } = createTestService("natural-attend-test");

  try {
    const created = service.createWorld({ name: "Natural Attend Test World", seed: "nat-1991" });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Sarah", last_name: "Connor" });
    service.confirmQ4Personnel({ world_id: worldId });
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.projection.q4.personnel_briefing.status, "pending");

    // Submit natural text 'attend briefing'
    const natRes = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "attend briefing" });
    assert.equal(natRes.ok, true);
    assert.equal(natRes.result.status, "active");
    assert.equal(natRes.projection.q4.personnel_briefing.status, "active");
    assert.equal(natRes.projection.q4.personnel_briefing.speaker, "DR. KIRK MAXWELL");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y106 — Criteria F, G, H: AEOT cold boot audio isolation, threshold activation hook, and physical briefing silence", () => {
  const made = [];
  const sandbox = { console, Audio: class {
    constructor(src) { this.src = src; this.paused = true; made.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }};
  require("node:vm").runInNewContext(fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8"), sandbox);
  const audio = sandbox.YBAudio;

  // Criteria F: AEOT cold boot hooks (boot_power, boot_drive, boot_relay) must NOT play Threshold_Activation_01.mp3
  audio.emitHook("boot_power");
  audio.emitHook("boot_drive");
  audio.emitHook("boot_relay");
  const thresholdActivationPlays = made.filter((item) => /Threshold_Activation_01\.mp3/.test(item.src));
  assert.equal(thresholdActivationPlays.length, 0, "Cold boot audio hooks must never trigger Threshold_Activation_01.mp3");

  // Criteria G: threshold_activation hook correctly triggers Threshold_Activation_01.mp3
  audio.emitHook("threshold_activation");
  const machineryPlays = made.filter((item) => /Threshold_Activation_01\.mp3/.test(item.src));
  assert.equal(machineryPlays.length, 1, "threshold_activation hook must trigger Threshold_Activation_01.mp3");
  assert.equal(machineryPlays[0].paused, false);

  // Criteria H: Zero radio chirps or operational SFX during physical briefing
  const diags = audio.diagnostics();
  assert.equal(diags.radio_tx_chirp_count ?? 0, 0, "No radio tx chirps may occur");

  // Failure A: Standard facility ambience must be silent (no Complex electrical buzz)
  audio.applyScene({ physical_environment: "STANDARD" });
  audio.emitHook("facility_ambient");
  const complexBuzzPlays = made.filter((item) => /FF1_Electrical_Buzz_01\.mp3/.test(item.src));
  assert.equal(complexBuzzPlays.length, 0, "Complex fluorescent hum must never play in Standard facility");
});

