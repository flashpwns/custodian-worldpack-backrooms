"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");
const cq4Day1Opener = require("../tools/cq4-day1-opener");

function createTestService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y101-briefing-"));
  return {
    service: new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" }),
    root
  };
}

test("y101 — Gate 1: Facility Broadcast completed pre-waiver; workstation begins in PERSONNEL_BRIEFING with BRIEFING PENDING", async () => {
  const { service, root } = createTestService();
  try {
    const created = service.createWorld({ name: "Broadcast State World", seed: "test-broadcast-1991" });
    assert.equal(created.ok, true);
    const worldId = created.world.id;

    assert.equal(service.createQ4Personnel({ world_id: worldId, first_name: "Marcus", last_name: "Thorne" }).ok, true);
    assert.equal(service.confirmQ4Personnel({ world_id: worldId }).ok, true);

    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    const projection = started.projection;
    assert.equal(projection.phase.phase_id, "BRIEFING");
    assert.equal(projection.q4.beat, "PERSONNEL_BRIEFING", "Runtime beat must be PERSONNEL_BRIEFING upon workstation entry");
    assert.equal(projection.q4.facility_broadcast.status, "completed", "Facility broadcast status must be completed");
    assert.equal(projection.q4.facility_broadcast.visible, false, "Facility broadcast must not be visible");
    assert.equal(projection.q4.facility_broadcast.completed, true, "Facility broadcast must be completed");
    assert.equal(projection.q4.channels.local.available, false, "LOCAL channel must be unavailable before introductions");

    const entry = service.session(worldId, "field-researcher");

    // Guard 1: In-room Maxwell dialogue is NOT delivered in communications message history
    const maxwellMsgsBefore = (entry.run.expedition.messages ?? []).filter((m) => m.speaker === "DR. KIRK MAXWELL");
    assert.equal(maxwellMsgsBefore.length, 0, "No personnel briefing dialogue can be delivered before Maxwell arrives");

    // Guard 2: Equipment Staging (READY) transition is gated before briefing concludes
    assert.equal(
      projection.available_actions.some((a) => a.type === "READY"),
      false,
      "Equipment staging transition must be absent from available_actions during briefing pending"
    );

    // Guard 3: Legacy Maxwell briefing dialogue is preserved under personnel_briefing awaiting dedicated pass
    const preserved = entry.run.expedition.day1_opener.personnel_briefing;
    assert.ok(preserved, "Legacy Maxwell briefing material is preserved under personnel_briefing");
    assert.equal(preserved.speaker, "DR. KIRK MAXWELL");
    assert.match(preserved.text, /Good morning, Q4 assignees/);

    // Verify UI rendering: schematic restored, staging locked with BRIEFING PENDING
    const phaseRecord = YBSurfaces.render(projection);
    const lockedActionDock = `<footer class="eti-turn-controls"><section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>BRIEFING PENDING</h2></div><button type="button" class="primary-action" disabled data-briefing-locked="true">BRIEFING PENDING</button><p>Standing by for assignment briefing.</p></section></footer>`;
    const rendered = YBSurfaces.expeditionCockpit(projection, {
      phaseRecord,
      actionDock: lockedActionDock
    });

    assert.match(rendered, /data-display-mode="facility"/, "Central panel must show ASync facility schematic");
    assert.doesNotMatch(rendered, /data-display-mode="facility-feed"/, "Facility feed must not be rendered");
    assert.doesNotMatch(rendered, /class="eti-comms"/, "Comms panel must not be present in briefing workstation");
    assert.doesNotMatch(rendered, /PROCEED TO EQUIPMENT STAGING/, "Staging action must remain gated");
    assert.doesNotMatch(rendered, /The room has not gone quiet for you/, "Coworker introductions must remain gated");
    assert.match(rendered, /data-briefing-locked="true"/, "Action dock must remain locked");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y101 — communications panel layout maintains strict vertical ownership without grid collision", () => {
  const { service, root } = createTestService();
  try {
    const created = service.createWorld({ name: "Comms Layout World", seed: "test-comms-1991" });
    assert.equal(created.ok, true);
    const worldId = created.world.id;

    service.createQ4Personnel({ world_id: worldId, first_name: "Beatrice", last_name: "Adams" });
    service.confirmQ4Personnel({ world_id: worldId });
    const started = service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    const projection = started.projection;

    // Release feed to test full comms structure
    projection.briefing_feed_completed = true;
    projection.q4.channels.local.available = true;

    const commsHtml = YBSurfaces.communicationConsole(projection);

    // Assert presence of all strict vertical ownership layers:
    assert.match(commsHtml, /<aside class="eti-comms communications-surface"[^>]*><header>/);
    assert.match(commsHtml, /class="mechanical-channel-selector"/);
    assert.match(commsHtml, /class="mechanical-channel-switch"/);
    assert.match(commsHtml, /class="channel-routing-controls"/);
    assert.match(commsHtml, /data-testid="q4-channel"/);
    assert.match(commsHtml, /class="communication-timeline"/);
    assert.match(commsHtml, /class="comms-guidance"/);
    assert.match(commsHtml, /class="channel-explanation"/);
    assert.match(commsHtml, /class="local-communication-notice"/);
    assert.match(commsHtml, /<form id="q4-comms-form"/);
    assert.match(commsHtml, /<input name="text"[^>]*placeholder="Speak locally or transmit to Standard"/);
    assert.match(commsHtml, /class="comms-state"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
