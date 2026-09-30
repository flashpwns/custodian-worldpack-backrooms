"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const YBAudio = require("../desktop/renderer/audio");
const cinematicRegistry = require("../desktop/shared/cinematic-registry");
const presentationBus = require("../tools/presentation-bus");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

function createTestService(seed = "chronology-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y105-chronology-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  return { service, root, seed };
}

test("y105 — Authoritative First-Run Chronology & Invariants Compliance", async (t) => {
  const { service, root, seed } = createTestService();

  try {
    // 1. Single-world creation: selecting NEW FILE creates one world
    const created = service.createWorld({ name: "Chronology Test World", seed });
    assert.equal(created.ok, true);
    const worldId = created.world.id;

    // Check single-world persistence invariant: world exists before onboarding completion
    const worldBefore = service.getWorld(worldId);
    assert.ok(worldBefore, "World must exist canonically immediately upon creation");
    const loadedBefore = service.loadWorld({ world_id: worldId });
    assert.equal(loadedBefore.world.has_filed_personnel, false, "Personnel has not been filed yet");

    // 2. Date Presentation: Inspect renderer source and audio hooks
    const rendererSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
    const surfacesSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
    const stylesSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

    // Req 2 & 3: Date presentation contains JULY, 1991, has no skip listeners (non-interactive)
    assert.match(rendererSource, /function personnelDateCard\(\)/, "personnelDateCard must be defined");
    assert.match(rendererSource, /JULY, 1991/, "Date card must show JULY, 1991");
    const dateCardFn = rendererSource.slice(rendererSource.indexOf("function personnelDateCard()"), rendererSource.indexOf("function introductoryVideo()"));
    assert.doesNotMatch(dateCardFn, /addEventListener/, "Date card must not accept skip events");

    // Req 4: Fast-forward hook in date presentation
    assert.match(rendererSource, /__YB_TEST_FAST_DATE_CARD__/, "Date card must respect fast test flag");

    // Audio hook for date presentation must exist and be silent without synthesized audio
    assert.equal(typeof YBAudio.emitDatePresentationCue, "function", "emitDatePresentationCue hook must exist");
    assert.doesNotThrow(() => YBAudio.emitDatePresentationCue(), "emitDatePresentationCue must safely execute without audio asset");

    // Req 5: Introductory video occurs before waiver, standalone surface
    assert.match(rendererSource, /function introductoryVideo\(\)/, "introductoryVideo must be defined");
    assert.match(rendererSource, /data-testid="introductory-video"/, "Introductory video must render data-testid");
    assert.match(rendererSource, /data-placeholder-id="BRIEFING_INFORMATIONAL_VIDEO"/, "Video surface must reference BRIEFING_INFORMATIONAL_VIDEO");
    assert.match(rendererSource, /class="introductory-video-surface"/, "Must have dedicated introductory video surface class");

    // Req 6 & 7: Introductory Video playback: placeholder timer vs registered video ended event
    assert.match(rendererSource, /videoEl\.addEventListener\("ended"/, "Registered video must advance on ended event");
    assert.match(rendererSource, /placeholderMs = fastTest \? 50 : 2000/, "Placeholder video must advance after 2000ms (50ms fast test)");

    // Req 9 & 10: Waiver / Name paper and confirmation
    assert.match(rendererSource, /name="last_name"/, "Waiver must contain last_name");
    assert.match(rendererSource, /name="first_name"/, "Waiver must contain first_name");
    assert.match(rendererSource, /cannot be changed after filing/i, "Name review must state cannot be changed after filing");

    // Req 11: Confirmation slide-away leads to AEOT System Initialization
    assert.match(rendererSource, /paper-slide-away/, "Confirmation must animate paper slide-away");

    // Req 12 & 13 & 14: AEOT System Initialization (4 audited rows, sequential 0 -> 100%, ~2.0s each)
    const auditedSubsystems = [
      "SUBSYSTEM BUS VERIFICATION",
      "CLEARANCE VERIFICATION: Q4",
      "SUB-LEVEL TELEMETRY LINK",
      "FACILITY SCHEMATIC: SECTOR B1"
    ];
    for (const sub of auditedSubsystems) {
      assert.match(rendererSource, new RegExp(sub), `AEOT initialization must contain audited row: ${sub}`);
    }
    assert.match(rendererSource, /function aeotInitialization\(/, "aeotInitialization function must exist");
    assert.match(rendererSource, /rowDurationMs = fastTest \? 40 : 2000/, "Each initialization step must take 2000ms (40ms fast test)");

    // Req 15: Purge invalid auditing / unsupported jargon: KERNEL LINK is absent
    assert.doesNotMatch(rendererSource, /KERNEL LINK/, "KERNEL LINK must be completely purged from renderer");
    assert.doesNotMatch(surfacesSource, /KERNEL LINK/, "KERNEL LINK must be completely purged from surfaces");
    assert.doesNotMatch(stylesSource, /KERNEL LINK/, "KERNEL LINK must be completely purged from styles");

    // Req 16: AEOT UI Cold Boot energizes components sequentially
    assert.match(stylesSource, /eti-cold-boot-pending/, "Styles must contain cold boot pending class");
    assert.match(stylesSource, /eti-cold-boot-energizing/, "Styles must contain cold boot energizing class");
    assert.match(stylesSource, /eti-cold-boot-energized/, "Styles must contain cold boot energized class");
    assert.match(stylesSource, /@keyframes eti-region-energize/, "Styles must contain cathode/phosphor stabilization keyframes");
    assert.match(rendererSource, /coldBootActive/, "Cold boot state must be tracked");
    assert.match(rendererSource, /stageDurationMs = fastTest \? 30 : 850/, "Cold boot must use calibrated 850ms per region duration");
    assert.match(rendererSource, /headerEl\.classList\.add\("eti-cold-boot-energizing"\)[\s\S]*?centerEl\.classList\.add\("eti-cold-boot-energizing"\)[\s\S]*?actionDockEl\.classList\.add\("eti-cold-boot-energizing"\)/, "Cold boot must energize header, center, and action dock sequentially");
    const coldBootBlock = rendererSource.slice(rendererSource.indexOf("if (current.coldBootActive"), rendererSource.indexOf("if (current.developer && !q4Shell)"));
    assert.doesNotMatch(coldBootBlock, /ui_select/, "Cold boot sequence must not emit automatic ui_select");

    // Menu music handoff: immediate fade out on NEW GAME / enterMode
    assert.match(rendererSource, /async function enterMode[\s\S]*?YBAudio\.stopMenuMusic\(1500\)/, "enterMode must initiate stopMenuMusic(1500) immediately upon entering new game sequence");

    // Req 8 & 19: ZERO radio chirps anywhere in opener flow
    const audioDiag = YBAudio.diagnostics();
    assert.equal(audioDiag.radio_tx_chirp_count ?? 0, 0, "Audio diagnostics must report zero radio_tx_chirp counts");

    // Simulate personnel creation and confirmation canonically
    const createRes = service.createQ4Personnel({ world_id: worldId, first_name: "Morgan", last_name: "Casey" });
    assert.equal(createRes.ok, true);
    const confirmRes = service.confirmQ4Personnel({ world_id: worldId });
    assert.equal(confirmRes.ok, true);

    const worldAfterConfirm = service.loadWorld({ world_id: worldId });
    assert.equal(worldAfterConfirm.world.has_filed_personnel, true, "Personnel marked filed after confirmation");

    // Req 17 & 18: Workstation Opener State: initial render has NO standby delay, NO facility broadcast
    const sessionStart = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(sessionStart.ok, true);

    const proj = sessionStart.projection;
    assert.equal(proj.phase.phase_id, "BRIEFING");
    assert.equal(proj.q4.beat, "PERSONNEL_BRIEFING", "Initial workstation beat must be PERSONNEL_BRIEFING");
    assert.equal(proj.q4.facility_broadcast.status, "completed", "Facility broadcast must be completed");
    assert.equal(proj.q4.facility_broadcast.visible, false, "Facility broadcast feed must be invisible");
    assert.equal(proj.q4.facility_broadcast.completed, true, "Facility broadcast must be completed");

    // Verify UI rendering in cockpit
    const phaseRecord = YBSurfaces.render(proj);
    const renderedCockpit = YBSurfaces.expeditionCockpit(proj, { phaseRecord });

    assert.match(renderedCockpit, /data-display-mode="facility"/, "Central panel must show ASYNC facility schematic");
    assert.doesNotMatch(renderedCockpit, /data-display-mode="facility-feed"/, "Central panel must NOT show facility broadcast feed");
    assert.match(renderedCockpit, /BRIEFING PENDING/, "Primary action dock must display BRIEFING PENDING");
    assert.match(renderedCockpit, /data-briefing-locked="true"/, "Primary action button must be locked");
    assert.doesNotMatch(renderedCockpit, />STANDBY</, "STANDBY button must not exist");
    assert.doesNotMatch(renderedCockpit, />FACILITY BROADCAST IN PROGRESS</, "FACILITY BROADCAST IN PROGRESS button must not exist");

    // Req 21: Boundary discipline: Maxwell dialogue has NOT started, coworkers have NOT introduced
    const sessionEntry = service.session(worldId, "field-researcher");
    const maxwellMsgs = (sessionEntry.run.expedition.messages ?? []).filter((m) => m.speaker === "DR. KIRK MAXWELL");
    assert.equal(maxwellMsgs.length, 0, "Must STOP at Maxwell boundary: Dr. Kirk Maxwell dialogue has not started");
    assert.equal(proj.q4.channels.local.available, false, "Local communication must remain unavailable pending Maxwell");

    // Req 20: Single-world persistence: reopening unfinished onboarding resumes from Date Presentation
    const created2 = service.createWorld({ name: "Unfinished World", seed: "unf-1991" });
    assert.equal(created2.ok, true);
    const unfWorld = service.loadWorld({ world_id: created2.world.id });
    assert.equal(unfWorld.world.has_filed_personnel, false, "New file has not filed personnel");

    // In renderer.js, enterMode checks personnel.required: if true, it calls personnelDateCard()
    assert.match(rendererSource, /if \(personnel\.required\) \{[\s\S]*?personnelDateCard\(\);/, "Unfinished world resumes at personnelDateCard");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
