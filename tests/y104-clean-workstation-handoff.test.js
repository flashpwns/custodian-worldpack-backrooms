"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
const presentationBus = require("../tools/presentation-bus");
const cinematicRegistry = require("../desktop/shared/cinematic-registry");

function createTestService(seed = "handoff-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y104-handoff-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  const created = service.createWorld({ name: "Workstation Handoff World", seed });
  assert.equal(created.ok, true);
  const worldId = created.world.id;

  assert.equal(service.createQ4Personnel({ world_id: worldId, first_name: "Marcus", last_name: "Thorne" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: worldId }).ok, true);

  return { service, root, worldId };
}

test("y104 — Clean Workstation Handoff: initial render is in operational standby", async () => {
  const { service, root, worldId } = createTestService("standby-clean-render");
  try {
    // 1. ASYNC initialization runs and completes
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    const projection = started.projection;
    assert.equal(projection.phase.phase_id, "BRIEFING");

    // 4. Workstation in clean operational state in KV31 briefing office
    assert.equal(projection.q4.current_location?.id, "async-briefing-room");
    assert.equal(projection.acoustic_scene.location_id, "async-briefing-room");

    // 5. Persistent player and exactly three coworkers loaded
    const team = projection.q4.team;
    assert.equal(team.length, 4, "Team must have exactly 4 personnel (player + 3 coworkers)");
    const player = team.find((m) => m.controlled);
    assert.ok(player, "Controlled player must be present");
    assert.equal(player.display_name, "Marcus Thorne · YOU");
    const coworkers = team.filter((m) => !m.controlled);
    assert.equal(coworkers.length, 3, "Exactly three coworkers must be loaded");

    function assertNoOperationalLeaks(html, stageName) {
      assert.match(html, /class="eti-cockpit briefing-workstation"/, `${stageName}: must mount briefing workstation layout`);
      assert.doesNotMatch(html, /class="eti-left-rail"/, `${stageName}: left rail (team/equipment/objective) must NOT be present`);
      assert.doesNotMatch(html, /class="eti-equipment"/, `${stageName}: equipment rail must NOT be present`);
      assert.doesNotMatch(html, /class="eti-objective"/, `${stageName}: objective rail must NOT be present`);
      assert.doesNotMatch(html, /class="eti-evidence"/, `${stageName}: evidence rail must NOT be present`);
      assert.doesNotMatch(html, /class="eti-comms"/, `${stageName}: comms chassis must NOT be present`);
      assert.doesNotMatch(html, /q4-comms-form/, `${stageName}: comms composer must NOT be present`);
      assert.doesNotMatch(html, /field-observation/, `${stageName}: field observation record must NOT be present`);
      assert.doesNotMatch(html, /OBSERVATION RECORD/, `${stageName}: OBSERVATION RECORD must NOT be present`);
      assert.doesNotMatch(html, /EVIDENCE \/ MEDIA/, `${stageName}: EVIDENCE / MEDIA must NOT be present`);
      assert.doesNotMatch(html, /eti-phase-record/, `${stageName}: phase record accordion must NOT be present`);
      assert.doesNotMatch(html, /Establish the required Standard exchange/, `${stageName}: Standard exchange fallback must NOT leak`);
      assert.doesNotMatch(html, /Use STANDARD in the communications panel to continue/, `${stageName}: Standard comms directive must NOT leak`);
      assert.doesNotMatch(html, /35mm camera/, `${stageName}: 35mm camera must NOT leak`);
      assert.doesNotMatch(html, /battery-powered lamp/, `${stageName}: battery lamp must NOT leak`);
      assert.doesNotMatch(html, /field radio/, `${stageName}: field radio must NOT leak`);
      assert.doesNotMatch(html, /survey notebook/, `${stageName}: survey notebook must NOT leak`);
      assert.doesNotMatch(html, /Required equipment/, `${stageName}: Required equipment must NOT leak`);
      assert.doesNotMatch(html, /Good morning, Q4 assignees/, `${stageName}: Maxwell speech must NOT leak`);
      assert.doesNotMatch(html, /The room has not gone quiet for you/, `${stageName}: Coworker introductions must NOT leak`);
      assert.doesNotMatch(html, /PROCEED TO EQUIPMENT STAGING/, `${stageName}: Staging button must NOT leak`);
    }

    // 6. Central display shows ASYNC facility schematic (not broadcast projector feed)
    const phaseRecord = YBSurfaces.render(projection);
    const rendered = YBSurfaces.expeditionCockpit(projection, { phaseRecord });
    assertNoOperationalLeaks(rendered, "Stage 1 (Standby)");
    assert.match(rendered, /data-display-mode="facility"/, "Central panel must show ASYNC facility schematic");
    assert.doesNotMatch(rendered, /data-display-mode="facility-feed"/, "Facility broadcast feed must NOT be rendered at standby");
    assert.match(rendered, /data-node-id="async-briefing-room"/, "Schematic must contain async-briefing-room");
    assert.match(rendered, /class="you-label"/, "YOU marker must be present on schematic");

    // Pre-briefing Interface Backend gating: Stage 1 (Standby)
    const headerStandby = YBSurfaces.asyncHeader(projection);
    assert.doesNotMatch(headerStandby, /Begin [Rr]eturn [Pp]rocedure/i, "Stage 1: Begin Return Procedure must be absent during standby");
    assert.doesNotMatch(headerStandby, /TERMINATE FIELD SESSION/, "Stage 1: TERMINATE FIELD SESSION must be absent during standby");
    assert.match(headerStandby, /<button[^>]*data-action="settings"[^>]*>Settings<\/button>/, "Stage 1: Settings must remain available during standby");
    assert.equal(projection.available_actions.some((a) => ["RETURN", "ABORT"].includes(a.type)), false, "Stage 1: RETURN/ABORT must be gated in available_actions");

    // Also test direct YBSurfaces.briefingWorkstation invocation
    const directWorkstation = YBSurfaces.briefingWorkstation(projection);
    assertNoOperationalLeaks(directWorkstation, "Stage 1 (Direct Briefing Workstation)");

    // 7. Facility broadcast completed before workstation entry; no Maxwell briefing/dialogue present; no introductions started
    assert.equal(projection.q4.facility_broadcast.status, "completed");
    assert.equal(projection.q4.facility_broadcast.visible, false);
    assert.equal(projection.q4.facility_broadcast.completed, true);
    assert.equal(projection.q4.beat, "PERSONNEL_BRIEFING", "Initial workstation beat is PERSONNEL_BRIEFING");
    assert.equal(projection.q4.introduction_pressure, null, "Coworker introduction pressure must be suppressed initially");
    assert.doesNotMatch(rendered, /class="opener-presentation"/, "No opener presentation card in operational workstation");
    assert.doesNotMatch(rendered, /class="introduction-pressure"/, "No introduction pressure UI initially");

    // Check no Maxwell dialogue exists in message history
    const entry = service.session(worldId, "field-researcher");
    const maxwellMsgs = (entry.run.expedition.messages ?? []).filter((m) => m.speaker === "DR. KIRK MAXWELL");
    assert.equal(maxwellMsgs.length, 0, "No Maxwell dialogue can be present initially");

    // 8. Workstation Opener State: Action dock shows BRIEFING PENDING (disabled); no STANDBY or FACILITY BROADCAST buttons
    assert.match(rendered, /<button[^>]*class="primary-action"[^>]*disabled[^>]*data-briefing-locked="true"[^>]*>BRIEFING PENDING<\/button>/, "Primary button must be disabled BRIEFING PENDING");
    assert.doesNotMatch(rendered, />STANDBY</, "No STANDBY button in workstation");
    assert.doesNotMatch(rendered, />FACILITY BROADCAST IN PROGRESS</, "No FACILITY BROADCAST IN PROGRESS button in workstation");

    // 9. Zero broadcast/radio chirps emitted on initial render
    const busEvents = presentationBus.inspectEvents(worldId);
    const chirps = busEvents.filter((e) => e.cue === "radio_chirp" || e.cue === "radio_tx_chirp" || e.cue === "radio_rx_cue");
    assert.equal(chirps.length, 0, "ZERO radio chirps may fire anywhere in opener");

    // Pre-briefing Interface Backend gating: Stage 3 (Personnel Briefing Pending)
    const headerPending = YBSurfaces.asyncHeader(projection);
    assert.doesNotMatch(headerPending, /Begin [Rr]eturn [Pp]rocedure/i, "Stage 3: Begin Return Procedure must be absent during personnel briefing");
    assert.doesNotMatch(headerPending, /TERMINATE FIELD SESSION/, "Stage 3: TERMINATE FIELD SESSION must be absent during personnel briefing");
    assert.match(headerPending, /<button[^>]*data-action="settings"[^>]*>Settings<\/button>/, "Stage 3: Settings must remain available during personnel briefing");
    assert.equal(projection.available_actions.some((a) => ["RETURN", "ABORT"].includes(a.type)), false, "Stage 3: RETURN/ABORT must be gated in available_actions");

    // Local channel and introductions remain gated awaiting Maxwell's briefing
    assert.equal(projection.q4.channels.local.available, false, "LOCAL channel must remain unavailable during personnel briefing");
    assert.equal(projection.q4.introduction_pressure, null, "Introduction pressure must remain unavailable");
    const actionsAfter = projection.available_actions ?? [];
    assert.equal(actionsAfter.some((a) => a.type === "READY"), false, "READY / Equipment Staging must be unavailable in projection");

    // Maxwell's briefing dialogue must NOT be injected into messages history
    const maxwellInHistory = (entry.run.expedition.messages ?? []).filter((m) => m.speaker === "DR. KIRK MAXWELL");
    assert.equal(maxwellInHistory.length, 0, "No Maxwell dialogue in messages upon broadcast completion");

    // Legacy Maxwell briefing material remains preserved under personnel_briefing awaiting dedicated pass
    const preservedBriefing = entry.run.expedition.day1_opener.personnel_briefing;
    assert.ok(preservedBriefing, "Legacy Maxwell briefing material must be preserved under personnel_briefing");
    assert.equal(preservedBriefing.speaker, "DR. KIRK MAXWELL");
    assert.match(preservedBriefing.text, /Good morning, Q4 assignees/);

    // Rendered UI in personnel briefing pending shows BRIEFING PENDING, facility schematic, and does not leak
    const renderedReleased = YBSurfaces.expeditionCockpit(projection, { phaseRecord: YBSurfaces.render(projection) });
    assertNoOperationalLeaks(renderedReleased, "Stage 3 (Personnel Briefing Pending)");
    assert.match(renderedReleased, /data-display-mode="facility"/, "Facility schematic restored upon broadcast completion");
    assert.doesNotMatch(renderedReleased, /data-display-mode="facility-feed"/, "Broadcast feed removed upon completion");
    assert.match(renderedReleased, /<h2>BRIEFING PENDING<\/h2>/, "Action dock shows briefing pending");
    assert.match(renderedReleased, /<button[^>]*class="primary-action"[^>]*disabled[^>]*data-briefing-locked="true"[^>]*>BRIEFING PENDING<\/button>/, "Primary button must remain locked during pending briefing");
    assert.doesNotMatch(renderedReleased, /PROCEED TO EQUIPMENT STAGING/, "Staging button must remain unavailable");
    assert.doesNotMatch(renderedReleased, /The room has not gone quiet for you/, "Coworker introductions must not be rendered");

    // Later valid states retain existing backend actions
    const fieldProj = {
      mode: { id: "field-researcher" },
      phase: { phase_id: "FIELD_OPERATION" },
      q4: { scenario: "day1-opener", day1_opener: true, operational_time: "T+15" },
      available_actions: [{ type: "RETURN" }]
    };
    const fieldHeader = YBSurfaces.asyncHeader(fieldProj);
    assert.match(fieldHeader, /Begin return procedure|Begin Return Procedure/i, "Later state: Begin Return Procedure is retained in FIELD_OPERATION");
    assert.match(fieldHeader, /TERMINATE FIELD SESSION/, "Later state: TERMINATE FIELD SESSION is retained in FIELD_OPERATION");
    assert.match(fieldHeader, /<button[^>]*data-action="settings"[^>]*>Settings<\/button>/, "Later state: Settings is retained in FIELD_OPERATION");

    // Simulate world reload / new session load
    const reopened = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
    const resumed = reopened.resumeSession({ world_id: worldId, mode: "field-researcher" });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.projection.q4.facility_broadcast.completed, true, "Completed broadcast must remain completed on reload");
    assert.equal(resumed.projection.q4.facility_broadcast.status, "completed");
    assert.equal(resumed.projection.q4.facility_broadcast.visible, false, "Broadcast feed must NOT be visible on reload");

    const reloadedRender = YBSurfaces.expeditionCockpit(resumed.projection, { phaseRecord: YBSurfaces.render(resumed.projection) });
    assertNoOperationalLeaks(reloadedRender, "Stage 4 (Cold Reload)");
    assert.match(reloadedRender, /data-display-mode="facility"/, "Schematic must be shown, not broadcast feed");
    assert.doesNotMatch(reloadedRender, /data-display-mode="facility-feed"/);
    assert.match(reloadedRender, /<h2>BRIEFING PENDING<\/h2>/, "Action dock still shows briefing pending after reload");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
