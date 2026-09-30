"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const YBAudio = require("../desktop/renderer/audio");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
const cinematicRegistry = require("../desktop/shared/cinematic-registry");

function createTestService(seed = "y108-repair-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y108-repair-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  return { service, root, seed };
}

test("y108 — Failure A & B: Menu music lifecycle continuity & institutional PA / Tannoy DSP", () => {
  // 1. Audio bus and hook verification
  assert.equal(YBAudio.AUDIO_BUSES.MUSIC, "music");
  assert.equal(YBAudio.AUDIO_BUSES.CHARACTER, "character");

  // 2. Menu music persistence across stopAll without options.stopMenu
  const sourceCode = fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8");
  assert.match(sourceCode, /stopAll\(options\s*=\s*\{\}\)/, "stopAll must support options parameter");
  assert.match(sourceCode, /record\.hookId\s*===\s*["']menu_music["']\s*&&\s*menuWanted\s*&&\s*options\.stopMenu\s*!==\s*true/, "stopAll must preserve menu music while menuWanted is true");

  // 3. Tannoy / institutional PA speaker DSP chain verification
  assert.match(sourceCode, /high\.type\s*=\s*["']highpass["'];\s*high\.frequency\.value\s*=\s*350/, "Highpass filter set to 350 Hz");
  assert.match(sourceCode, /low\.type\s*=\s*["']lowpass["'];\s*low\.frequency\.value\s*=\s*4200/, "Lowpass filter set to 4200 Hz");
  assert.match(sourceCode, /mid\.type\s*=\s*["']peaking["'];\s*mid\.frequency\.value\s*=\s*1600/, "Peaking horn filter center frequency set to 1600 Hz");
  assert.match(sourceCode, /mid\.gain\.value\s*=\s*3\.5/, "Horn resonance peaking gain set to +3.5 dB");
  assert.match(sourceCode, /mid\.Q\.value\s*=\s*1\.2/, "Horn resonance Q set to 1.2");
  assert.match(sourceCode, /dry\.gain\.value\s*=\s*0\.68/, "Institutional room dry gain set to 0.68");
  assert.match(sourceCode, /wet\.gain\.value\s*=\s*0\.32/, "Institutional room wet gain set to 0.32");
});

test("y108 — Failure C & D: Physical document 1.8s transitions and silent audio hooks", () => {
  // 1. CSS animation durations slowed down to 1.8s
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  assert.match(css, /\.personnel-creation\.async-document[\s\S]*?animation:\s*waiver-slide-down 1\.8s/, "Document entrance animation must be 1.8s");
  assert.match(css, /\.personnel-confirmation\.async-document[\s\S]*?animation:\s*waiver-slide-down 1\.8s/, "Document confirmation entrance animation must be 1.8s");
  assert.match(css, /\.waiver-slide-out[\s\S]*?animation:\s*waiver-slide-out 1\.8s/, "Document exit animation must be 1.8s");

  // 2. Deterministic silent audio hooks registered on CHARACTER bus
  assert.equal(YBAudio.HOOK_BUS_MAP.paper_sheet_enter, YBAudio.AUDIO_BUSES.CHARACTER, "paper_sheet_enter mapped to character bus");
  assert.equal(YBAudio.HOOK_BUS_MAP.paper_sheet_exit, YBAudio.AUDIO_BUSES.CHARACTER, "paper_sheet_exit mapped to character bus");

  // 3. Emitting hooks executes without error
  const initialEnterCount = YBAudio.diagnostics().hook_counts?.paper_sheet_enter || 0;
  YBAudio.emitHook("paper_sheet_enter");
  assert.equal(YBAudio.diagnostics().hook_counts?.paper_sheet_enter, initialEnterCount + 1, "paper_sheet_enter emission must be recorded");

  const initialExitCount = YBAudio.diagnostics().hook_counts?.paper_sheet_exit || 0;
  YBAudio.emitHook("paper_sheet_exit");
  assert.equal(YBAudio.diagnostics().hook_counts?.paper_sheet_exit, initialExitCount + 1, "paper_sheet_exit emission must be recorded");
});

test("y108 — Failure E: Cinematic skip prompt removal with instant ESC skip preserved", () => {
  const cinematicPlayerCode = fs.readFileSync(path.join(__dirname, "../desktop/renderer/cinematic-player.js"), "utf8");
  assert.doesNotMatch(cinematicPlayerCode, /cinematic-skip-hint/, "cinematic-skip-hint element creation must be purged");
  assert.doesNotMatch(cinematicPlayerCode, /ESC\s*·\s*SKIP/, "ESC · SKIP prompt text must be purged");
  assert.match(cinematicPlayerCode, /event\.key\s*===\s*["']Escape["']/, "ESC key handling must remain wired");
  assert.match(cinematicPlayerCode, /finishCinematic\(["']skipped["']\)/, "finishCinematic('skipped') must be called on skip");
  assert.match(cinematicPlayerCode, /surfaceElement\.parentNode\.removeChild/, "DOM surface must be removed on finish");
});

test("y108 — Failure F: Dr. Kirk Maxwell temporal conversational delivery", async () => {
  const { service, root, seed } = createTestService("maxwell-beats-test");
  try {
    const created = service.createWorld({ name: "Maxwell Beats Test World", seed });
    assert.equal(created.ok, true);
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });

    // 1. Attend briefing
    const attendRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    assert.equal(attendRes.ok, true);

    const proj0 = attendRes.projection;
    const briefing0 = proj0.q4.personnel_briefing;
    assert.equal(briefing0.status, "active");
    assert.equal(briefing0.exchange_history.length, 1, "Initial briefing must contain exactly first conversational beat");
    assert.match(briefing0.exchange_history[0].text, /Good morning, Q4 assignees\./, "Beat 1 must include formal greeting");
    assert.match(briefing0.exchange_history[0].text, /You can call me Kirk\./, "Beat 1 must include 'You can call me Kirk.'");
    assert.doesNotMatch(briefing0.exchange_history[0].text, /Eleanor, you're on camera\./, "Beat 1 must NOT dump the full roster call prematurely");

    // Check UI rendering for Beat 0: CONTINUE LISTENING is primary action
    const uiBeat0 = YBSurfaces.briefingWorkstation(proj0);
    assert.match(uiBeat0, /class="briefing-turn briefing-current-turn/, "Current beat must be prominent");
    assert.match(uiBeat0, /NOW SPEAKING/, "Maxwell speaking indicator must be displayed");
    assert.match(uiBeat0, /CONTINUE LISTENING/, "Primary button must be CONTINUE LISTENING while beats remain");

    // 2. Advance to Beat 1 via CONTINUE_BRIEFING
    const continue1 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    assert.equal(continue1.ok, true);
    const proj1 = continue1.projection;
    const briefing1 = proj1.q4.personnel_briefing;
    assert.equal(briefing1.exchange_history.length, 2, "Second beat must be added to exchange history");

    // Check UI rendering for Beat 1: Prior beat in history, current beat in focus
    const uiBeat1 = YBSurfaces.briefingWorkstation(proj1);
    assert.match(uiBeat1, /class="briefing-turn briefing-history-turn/, "Prior turns must move to history");
    assert.match(uiBeat1, /class="briefing-turn briefing-current-turn/, "New beat must be in current focus");

    // 3. Advance through remaining beats
    const continue2 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    assert.equal(continue2.ok, true);
    const continue3 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    assert.equal(continue3.ok, true);
    const proj3 = continue3.projection;
    const briefing3 = proj3.q4.personnel_briefing;

    // Roster call delivered in beat 3
    const fullHistoryText = briefing3.exchange_history.map((h) => h.text).join(" ");
    assert.match(fullHistoryText, /Eleanor, you're on camera\./, "Roster call must be delivered during subsequent beat");

    // UI when beats are complete: CONCLUDE BRIEFING becomes primary action
    const uiBeatComplete = YBSurfaces.briefingWorkstation(proj3);
    assert.match(uiBeatComplete, /CONCLUDE BRIEFING/, "CONCLUDE BRIEFING must be available once beats have unfolded");

    // 4. Free-form questions during the authored briefing receive the single authored
    // deflection, not a topic-matched FAQ answer (the briefing is authored temporal
    // delivery, not an FAQ kiosk).
    const qRes = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "What is our cutoff time?" });
    assert.equal(qRes.ok, true);
    assert.equal(
      qRes.result.reply,
      "There isn't time for that right now — let's get through this, and you can ask around once we're done here.",
      "Natural inquiry receives the single authored deflection, not a topic-matched FAQ answer"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y108 — Failure G, H, I: Facility map reconciliation & 4-floor schematic inspection", async () => {
  const { service, root, seed } = createTestService("facility-map-test");
  try {
    const created = service.createWorld({ name: "Facility Map Test World", seed });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    const projection = started.projection;

    // 1. Render Lower Level (default)
    const lowerHtml = YBSurfaces.layoutMap(projection, null, { inspectedFacilityFloor: "lower" });

    // Failure G: Reconciliation audits against source screenshot
    assert.doesNotMatch(lowerHtml, /RM-L01|RM-L02|RM-L05|HALL-L1/, "Invented room codes must not be present in schematic");
    assert.doesNotMatch(lowerHtml, />AIRLOCK</, "Invented separate AIRLOCK room box must not be present");
    assert.doesNotMatch(lowerHtml, /Corridor \/ Service/, "Invented Corridor / Service label must not be present");
    assert.doesNotMatch(lowerHtml, /Administrative &amp; Briefing|Administrative & Briefing|Equipment Staging|Circulation &amp; Access|Circulation & Access/, "Invented subtitles must not be present");
    assert.match(lowerHtml, /Dressing Room/, "Blueprint Dressing Room must be present");
    assert.match(lowerHtml, /Threshold Chamber/, "Blueprint Threshold Chamber must be present");

    // Failure H: Deterministic navigation IDs
    assert.match(lowerHtml, /data-location-id="async-briefing-room"/, "Stable data-location-id on Briefing Room");
    assert.match(lowerHtml, /data-location-id="equipment-staging"/, "Stable data-location-id on Dressing Room");
    assert.match(lowerHtml, /data-location-id="threshold-room"/, "Stable data-location-id on Threshold Chamber");

    // Invariant: YOU marker present on Lower Level
    assert.match(lowerHtml, /class="map-you-marker"/, "YOU marker must be present on Lower Level");

    // Failure I: All 4 facility floor plans inspectable immediately without moving player
    // Floor 2: Middle Level
    const middleHtml = YBSurfaces.layoutMap(projection, null, { inspectedFacilityFloor: "middle" });
    assert.match(middleHtml, /MIDDLE LEVEL \(LEVEL 2\)/, "Middle level title must be displayed");
    assert.match(middleHtml, /Control Room/, "Middle level must feature Control Room");
    assert.doesNotMatch(middleHtml, /KV31 Control Room/, "Inferred prefix KV31 Control Room must not be present");
    assert.match(middleHtml, /Conference Room/, "Middle level must feature Conference Room");
    assert.match(middleHtml, /Medical Lab/, "Middle level must feature Medical Lab");
    assert.match(middleHtml, /Relay Room/, "Middle level must feature Relay Room");
    assert.doesNotMatch(middleHtml, /Telemetry Relay/, "Inferred Telemetry Relay must not be present");
    assert.doesNotMatch(middleHtml, /Corridor \/ Circulation|Middle Level Hallway|Staff Briefing &amp; Analysis|Staff Briefing & Analysis/, "Invented middle level labels and subtitles must not be present");
    assert.match(middleHtml, /data-location-id="async-kv31-control"/, "Stable location ID on Control Room");
    assert.doesNotMatch(middleHtml, /class="map-you-marker"/, "YOU marker must NOT be rendered on Middle Level");

    // Floor 3: Upper Level
    const upperHtml = YBSurfaces.layoutMap(projection, null, { inspectedFacilityFloor: "upper" });
    assert.match(upperHtml, /UPPER LEVEL \(LEVEL 3\)/, "Upper level title must be displayed");
    assert.match(upperHtml, /Server Room/, "Upper level must feature Server Room");
    assert.match(upperHtml, /Maintenance Access/, "Upper level must feature Maintenance Access");
    assert.match(upperHtml, /Restrooms/, "Upper level must feature Restrooms");
    assert.doesNotMatch(upperHtml, /Administrative Offices|Service Circulation|Tape Archive|Utility Conduits/, "Invented upper level labels must be purged");
    assert.match(upperHtml, /data-location-id="async-server-room"/, "Stable location ID on Server Room");
    assert.doesNotMatch(upperHtml, /class="map-you-marker"/, "YOU marker must NOT be rendered on Upper Level");

    // Floor 4: Upper Section
    const upperSecHtml = YBSurfaces.layoutMap(projection, null, { inspectedFacilityFloor: "upper-section" });
    assert.match(upperSecHtml, /UPPER SECTION \(LEVEL 4\)/, "Upper section title must be displayed");
    assert.match(upperSecHtml, /Auditorium/, "Upper section must feature Auditorium");
    assert.match(upperSecHtml, /Lounge Access/, "Upper section must feature Lounge Access");
    assert.doesNotMatch(upperSecHtml, /Mechanical &amp; Roof Access|Mechanical & Roof Access|Institutional Presentation Hall|Staff Access &amp; Overlook/, "Invented upper section labels must be purged");
    assert.match(upperSecHtml, /data-location-id="async-auditorium"/, "Stable location ID on Auditorium");
    assert.doesNotMatch(upperSecHtml, /class="map-you-marker"/, "YOU marker must NOT be rendered on Upper Section");

    // Interactive floor selector pills and buttons exist across all views
    assert.match(lowerHtml, /data-facility-floor="lower"/, "Floor selector must have lower tab");
    assert.match(lowerHtml, /data-facility-floor="middle"/, "Floor selector must have middle tab");
    assert.match(lowerHtml, /data-facility-floor="upper"/, "Floor selector must have upper tab");
    assert.match(lowerHtml, /data-facility-floor="upper-section"/, "Floor selector must have upper-section tab");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y108 — Failure J & K: Software language purge and de-gamified LOCAL introductions", async () => {
  const { service, root, seed } = createTestService("degamify-test");
  try {
    const created = service.createWorld({ name: "De-gamify Test World", seed });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    const projection = started.projection;

    // 1. Failure J: Software language purges
    const headerHtml = YBSurfaces.asyncHeader(projection);
    assert.doesNotMatch(headerHtml, /Interface Backend/, "Software label 'Interface Backend' must be purged");
    assert.match(headerHtml, /Workstation Controls/, "'Workstation Controls' must replace Interface Backend");

    const mapHtml = YBSurfaces.layoutMap(projection);
    assert.doesNotMatch(mapHtml, /ECHOMAPPING DISABLED IN STANDARD/, "Meta-indicator 'ECHOMAPPING DISABLED IN STANDARD' must be purged");
    assert.doesNotMatch(mapHtml, /High institutional confidence/, "Epistemic decoration 'High institutional confidence' must be purged");
    assert.match(mapHtml, /Standard ASYNC Facility · Sector B1/, "Clean institutional facility heading must be present");

    const commsHtml = YBSurfaces.communicationConsole(projection);
    assert.doesNotMatch(commsHtml, /Speaking does not advance the phase/, "Patronizing tutorial prompt must be purged");

    // 2. Failure K: De-gamified LOCAL_INTRODUCTIONS
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    const concludeRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    assert.equal(concludeRes.ok, true);

    const introProj = concludeRes.projection;
    assert.equal(introProj.q4.beat, "LOCAL_INTRODUCTIONS");

    const introUi = YBSurfaces.briefingWorkstation(introProj);
    assert.match(introUi, /<h2>Assembly Table<\/h2>/, "Scene heading must be 'Assembly Table'");
    assert.match(introUi, /ASYNC FACILITY \/\/ LOWER LEVEL/, "Institutional location must be 'ASYNC FACILITY // LOWER LEVEL'");
    assert.match(introUi, /Three assigned coworkers remain seated at the table\./, "Atmospheric descriptive text must be present");
    assert.match(introUi, /class="coworker-presence-item/, "Coworkers presented as people seated at table");
    assert.doesNotMatch(introUi, /Assigned Expedition Coworkers/, "Gamified party header must be purged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y108 — Fix Streak 1: Reusable progressive dialogue renderer contract", async () => {
  const YBDialoguePlayer = require("../desktop/renderer/dialogue-player");

  assert.equal(typeof YBDialoguePlayer.type, "function");
  assert.equal(typeof YBDialoguePlayer.finish, "function");
  assert.equal(typeof YBDialoguePlayer.cancel, "function");
  assert.equal(typeof YBDialoguePlayer.isTyping, "function");

  // Mock DOM element
  class MockElement {
    constructor() {
      this.textContent = "";
      this.classList = {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      };
      this.isConnected = true;
    }
  }

  // 1. Fast mode / test bypass completes synchronously
  global.__YB_TEST_FAST_FADE__ = true;
  const fastEl = new MockElement();
  let fastCompleted = false;
  YBDialoguePlayer.type(fastEl, "Good morning, Q4 assignees.", {
    onComplete: () => { fastCompleted = true; }
  });
  assert.equal(fastEl.textContent, "Good morning, Q4 assignees.");
  assert.equal(fastCompleted, true);
  assert.equal(YBDialoguePlayer.isTyping(), false);
  delete global.__YB_TEST_FAST_FADE__;

  // 2. Real-time typing and skip-on-first-action semantics
  const el = new MockElement();
  let completed = false;
  YBDialoguePlayer.type(el, "Good morning, assignees. You can call me Kirk.", {
    initialDelay: 10,
    charDelay: 5,
    onComplete: () => { completed = true; }
  });
  assert.equal(YBDialoguePlayer.isTyping(), true);
  assert.equal(el.classList.contains("dialogue-typing"), true);

  // Skip immediately via finish()
  YBDialoguePlayer.finish();
  assert.equal(el.textContent, "Good morning, assignees. You can call me Kirk.");
  assert.equal(completed, true);
  assert.equal(YBDialoguePlayer.isTyping(), false);
  assert.equal(el.classList.contains("dialogue-typing"), false);

  // 3. Detached DOM safeguard cancels without crashing
  const detachedEl = new MockElement();
  detachedEl.isConnected = false;
  YBDialoguePlayer.type(detachedEl, "Detached test text", {
    initialDelay: 10,
    charDelay: 5
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(YBDialoguePlayer.isTyping(), false);
  assert.equal(detachedEl.textContent, "");

  // 4. Clean timer teardown on cancel()
  const cancelEl = new MockElement();
  YBDialoguePlayer.type(cancelEl, "Cancelling test", {
    initialDelay: 50,
    charDelay: 10
  });
  assert.equal(YBDialoguePlayer.isTyping(), true);
  YBDialoguePlayer.cancel();
  assert.equal(YBDialoguePlayer.isTyping(), false);
  assert.equal(cancelEl.classList.contains("dialogue-typing"), false);
});

test("y108 — Fix Streak 2: Briefing layout, typography, and action dock styling rules", () => {
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // 1. in-person-briefing flexbox setup
  assert.match(css, /\.in-person-briefing[\s\S]*?flex:\s*1 1 auto;[\s\S]*?min-height:\s*0;/, "in-person-briefing must flex and have min-height: 0");

  // 2. briefing-transcript scroll setup
  assert.match(css, /\.briefing-transcript[\s\S]*?flex:\s*1 1 auto;[\s\S]*?overflow-y:\s*auto;[\s\S]*?min-height:\s*0;/, "briefing-transcript must scroll and flex properly");

  // 3. briefing-action-dock flex-wrap override avoiding rigid 3-column collision
  assert.match(css, /\.eti-turn-controls\s*>\s*\.briefing-action-dock[\s\S]*?display:\s*flex !important;[\s\S]*?flex-wrap:\s*wrap !important;[\s\S]*?grid-template-columns:\s*none !important;/, "briefing-action-dock must override rigid grid with flex-wrap");

  // 4. dialogue-typing caret animation
  assert.match(css, /\.dialogue-typing::after[\s\S]*?content:\s*"▮";/, "dialogue-typing must display caret motif");
  assert.match(css, /@keyframes dialogue-caret-blink/, "dialogue-caret-blink keyframe animation must be defined");
});

test("y108 — Fix Streak 4: Audio boundary sanity check (STANDARD vs COMPLEX)", () => {
  // 1. Complex hum strictly blocked in STANDARD physical environment
  YBAudio.stopAll();
  const initialHumCount = YBAudio.diagnostics().hook_counts?.complex_hum || 0;

  // Emit in Standard environment
  YBAudio.applyScene({ phase_id: "BRIEFING", physical_environment: "STANDARD" });
  YBAudio.emitHook("complex_hum");
  assert.equal(YBAudio.diagnostics().hook_counts?.complex_hum || 0, initialHumCount, "complex_hum must NEVER play in Standard facility");

  // 2. applyScene in Standard environment suppresses complex ambient loops
  YBAudio.applyScene({ phase_id: "BRIEFING", physical_environment: "STANDARD", ambient_loop: "complex_hum" });
  const activeLoops = YBAudio.diagnostics().active_loops;
  assert.equal(activeLoops.includes("complex_hum"), false, "complex_hum loop must not be active in Standard");

  // 3. facility_ambient resolves strictly to silent placeholder
  const soundMap = fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8");
  assert.match(soundMap, /facility_ambient:\s*"data:audio\/wav;base64,/, "facility_ambient must be explicit silent data URI");

  // 4. threshold_activation is not played on boot or landing
  assert.equal(YBAudio.diagnostics().hook_counts?.threshold_activation || 0, 0, "threshold_activation must not have played during standard boot");
});

test("y108 — Dialogue Data Contract & Presentation Bus Envelopes", () => {
  const presentationBus = require("../tools/presentation-bus");
  assert.equal(typeof presentationBus.createDialogueEvent, "function", "createDialogueEvent must be exported");

  const evt = presentationBus.createDialogueEvent({
    speaker_id: "kirk-maxwell",
    speaker_name: "Dr. Kirk Maxwell",
    speaker_title: "Chief Expedition Briefing Authority · Standard Side",
    recipient_name: "YOU",
    channel: "LOCAL",
    text: "Follow the physical neon-green guidance tape to Outpost A.",
    kind: "speech"
  });

  assert.ok(evt.id.startsWith("dlg-"), "Event ID must have stable prefix");
  assert.equal(evt.speaker_name, "Dr. Kirk Maxwell");
  assert.equal(evt.channel, "LOCAL");
  assert.equal(evt.kind, "speech");
  assert.equal(evt.delivery, "delivered");
  assert.equal(evt.source, "DETERMINISTIC");
  assert.ok(typeof evt.timestamp === "number");
});

test("y108 — LOCAL Introductions Coworker Presence, Silence, and Recipient Targeting", async () => {
  const { service, root, seed } = createTestService("dialogue-target");
  try {
    const created = service.createWorld({ name: "Dialogue Test World", seed });
    const worldId = created.world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });

    // Reach LOCAL_INTRODUCTIONS
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    const concludeRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    assert.equal(concludeRes.ok, true);
    assert.equal(concludeRes.projection.q4.beat, "LOCAL_INTRODUCTIONS");

    const introHtml = YBSurfaces.briefingWorkstation(concludeRes.projection);

    // 1. Exactly 3 coworkers present at the table with human postures (no raw "follow")
    const team = concludeRes.projection.q4.team.filter(m => !m.controlled);
    assert.equal(team.length, 3, "Exactly 3 assigned coworkers must be present at the table");
    const coworker1 = team[0].first_name ?? team[0].display_name;
    const coworker2 = team[1].first_name ?? team[1].display_name;
    const coworker3 = team[2].first_name ?? team[2].display_name;

    assert.match(introHtml, new RegExp(`data-coworker-name="${coworker1}"`));
    assert.match(introHtml, new RegExp(`data-coworker-name="${coworker2}"`));
    assert.match(introHtml, new RegExp(`data-coworker-name="${coworker3}"`));
    assert.doesNotMatch(introHtml, /<small class="coworker-posture">follow<\/small>/, "Raw internal task 'follow' must not be displayed");
    assert.match(introHtml, /Seated across table · Reviewing site layout notes|Seated at table/);

    // 2. Targeted communication to valid recipient
    const targetRes = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: coworker1,
      text: `Ready for the run, ${coworker1}?`
    });
    assert.equal(targetRes.ok, true, "Targeted speech to coworker must succeed");
    assert.equal(targetRes.result.outcome, "delivered");

    // 3. Targeting non-present or invalid recipient fails safely
    const invalidTargetRes = await service.submitQ4Communication({
      world_id: worldId,
      channel: "local",
      target: "NonexistentPerson",
      text: "Hello?"
    });
    assert.equal(invalidTargetRes.ok, false);
    assert.equal(invalidTargetRes.error.code, "TARGET_NOT_FOUND");

    // 4. Silence / No-forced-dialogue path: proceeding to Equipment Staging works directly
    const proceedRes = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "READY" });
    assert.equal(proceedRes.ok, true, "Player must be allowed to proceed without speaking");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

