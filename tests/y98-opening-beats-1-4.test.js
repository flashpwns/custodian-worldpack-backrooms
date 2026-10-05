"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "opening-beats") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opening-beats-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
  const created = service.createWorld({ name: "New assignment", seed });
  assert.equal(created.ok, true);
  return { appDataPath, service, worldId: created.world.id };
}

test("y98 — starter coworkers are generated once with compact durable identity substrates", () => {
  const f = fixture("starter-personnel");
  try {
    const world = f.service.getWorld(f.worldId);
    const starterIds = world.q4_operations?.starter_personnel;
    assert.equal(starterIds?.length, 3, "world creation must persist exactly three starter coworkers");
    assert.equal(new Set(starterIds).size, 3, "starter personnel identities must be unique");

    const required = [
      "age_band", "region", "education_or_trade", "async_tenure",
      "social_expression", "behavioral_disposition", "conversational_temperament",
      "mundane_preference", "irritation", "social_tendency", "pre_expedition_concern"
    ];
    for (const id of starterIds) {
      const person = world.characters[id];
      assert.ok(person, `starter personnel ${id} must exist canonically`);
      for (const key of required) assert.ok(person.identity_substrate?.[key], `${id} missing ${key}`);
      assert.ok(person.continuity?.relationships, `${id} must retain the supported relationship structure`);
      assert.ok(Array.isArray(person.continuity?.dialogue_memories), `${id} must retain the supported memory structure`);
    }

    const before = structuredClone(starterIds.map((id) => world.characters[id].identity_substrate));
    f.service.createQ4Personnel({ world_id: f.worldId, first_name: "Marcus", last_name: "Thorne" });
    const started = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);
    assert.deepEqual(f.service.getWorld(f.worldId).q4_operations.starter_personnel, starterIds);

    const reopened = new DesktopService({ appDataPath: f.appDataPath, defaultQ4Scenario: "day1-opener" });
    const resumed = reopened.resumeSession({ world_id: f.worldId, mode: "field-researcher" });
    assert.equal(resumed.ok, true);
    const afterWorld = reopened.getWorld(f.worldId);
    assert.deepEqual(afterWorld.q4_operations.starter_personnel, starterIds, "reload must not reroll the party");
    assert.deepEqual(starterIds.map((id) => afterWorld.characters[id].identity_substrate), before, "starter baselines must survive session creation and reload unchanged");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("y98 — mandatory briefing broadcast, LOCAL introductions, and ESD handoff use distinct canonical states", async () => {
  const f = fixture("broadcast-and-esd");
  try {
    assert.equal(f.service.createQ4Personnel({ world_id: f.worldId, first_name: "Marcus", last_name: "Thorne" }).ok, true);
    assert.equal(f.service.confirmQ4Personnel({ world_id: f.worldId }).ok, true);
    const started = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    // Verify clean initial workstation state: PERSONNEL_BRIEFING with BRIEFING PENDING
    const initialOpener = started.projection.q4;
    assert.equal(initialOpener.beat, "PERSONNEL_BRIEFING", "Session must begin in PERSONNEL_BRIEFING");
    assert.equal(initialOpener.facility_broadcast.status, "completed", "Facility broadcast must be completed before workstation");
    assert.equal(initialOpener.facility_broadcast.visible, false, "Broadcast feed must not be visible");
    assert.equal(initialOpener.facility_broadcast.completed, true, "Broadcast must be marked completed");
    assert.equal(initialOpener.channels.local.available, false, "Local communication unavailable before introductions");
    assert.equal(initialOpener.channels.standard.available, false);

    const canonicalWorld = f.service.getWorld(f.worldId);
    const maxwell = canonicalWorld.characters["dr-kirk-maxwell"];
    assert.equal(maxwell.mortal, true, "Maxwell is a normal person, not magically immortal");
    assert.equal(maxwell.deployable, false);
    assert.equal(maxwell.assignment_scope, "briefing-only");
    assert.equal(maxwell.expedition_mortality_eligible, false);

    const rendered = YBSurfaces.expeditionCockpit(started.projection, { phaseRecord: YBSurfaces.render(started.projection) });
    assert.match(rendered, /data-display-mode="facility"/, "Schematic must be shown");
    assert.doesNotMatch(rendered, /data-display-mode="facility-feed"/, "Facility feed must not be displayed");
    assert.doesNotMatch(rendered, /Restore Facility Map/, "No Restore Facility Map button in rendered workstation");
    assert.doesNotMatch(rendered, /FEED ACQUIRE/, "No FEED ACQUIRE tag in rendered workstation");
    assert.doesNotMatch(rendered, /About this feed/i, "No About this feed in rendered workstation");
    assert.doesNotMatch(rendered, /ASSIGNMENT BRIEFING/, "No legacy ASSIGNMENT BRIEFING in rendered workstation");
    assert.doesNotMatch(rendered, /data-action="release-briefing-feed"/, "No manual feed release button in rendered workstation");
    assert.match(rendered, /BRIEFING PENDING/, "Action dock shows BRIEFING PENDING");
    assert.doesNotMatch(rendered, /PROCEED TO EQUIPMENT STAGING/, "Staging action must remain gated during personnel briefing");
    for (const id of canonicalWorld.q4_operations.starter_personnel) {
      const privateConcern = canonicalWorld.characters[id].identity_substrate.pre_expedition_concern;
      assert.equal(rendered.includes(privateConcern), false, "unspoken coworker concerns must not leak into the player projection");
    }

    const standard = f.service.submitQ4Communication({ world_id: f.worldId, channel: "standard", text: "Standard, do you copy?" });
    assert.equal(standard.ok, false);

    const local = await f.service.submitQ4Communication({ world_id: f.worldId, channel: "local", text: "Good morning. How is everyone doing?" });
    assert.equal(local.ok, true);

    const advanced = f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });
    assert.equal(advanced.ok, true);
    assert.equal(advanced.projection.phase.phase_id, "STAGING");
    assert.deepEqual(advanced.projection.q4.esd_handoff, {
      status: "equipment-cooperation",
      destination: "Equipment Services Division",
      player_dialogue_input: "paused",
      coworker_activity: "active"
    });
    assert.equal(advanced.projection.q4.channels.local.available, false);
    const stagingRendered = YBSurfaces.expeditionCockpit(advanced.projection, { phaseRecord: YBSurfaces.render(advanced.projection) });
    const stagedComposers = stagingRendered.match(/<input name="text"[^>]*>/g) ?? [];
    assert.ok(stagedComposers.length >= 1 && stagedComposers.every((markup) => /\bdisabled\b/.test(markup)), "every visible communications composer must pause player input at the ESD handoff");
    const paused = f.service.submitQ4Communication({ world_id: f.worldId, channel: "local", text: "Can everyone still hear me?" });
    assert.equal(paused.ok, false);
    assert.equal(paused.error.code, "LOCAL_INPUT_PAUSED");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("y98 — name permanence and staged first-run/settings contract", () => {
  const f = fixture("identity-and-settings");
  try {
    const defaults = f.service.getSettings().settings;
    assert.equal(defaults.provider, "local", "fresh start must have a zero-configuration embedded provider");
    assert.equal(defaults.input_mode, "natural");
    assert.equal(defaults.guided_introductions, false, "interpretive guidance is optional rather than blocking");
    assert.ok(Number.isFinite(defaults.audio_sfx));
    assert.ok(Number.isFinite(defaults.audio_music));
    assert.equal(typeof defaults.audio_muted, "boolean");

    const first = f.service.createQ4Personnel({ world_id:f.worldId, first_name:"Marcus", last_name:"Thorne" });
    assert.equal(first.ok, true);
    const second = f.service.createQ4Personnel({ world_id:f.worldId, first_name:"Different", last_name:"Person" });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.player.identity, first.player.identity);
    assert.equal(second.player.display_name, "Marcus Thorne");

    assert.equal(f.service.updateSettings({ settings:{ audio_sfx:0.2, audio_music:0.4, audio_muted:true } }).ok, true);
    const reopened = new DesktopService({ appDataPath:f.appDataPath });
    assert.deepEqual(
      { audio_sfx:reopened.settings().audio_sfx, audio_music:reopened.settings().audio_music, audio_muted:reopened.settings().audio_muted },
      { audio_sfx:0.2, audio_music:0.4, audio_muted:true }
    );

    const source = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
    assert.match(source, /data-testid="cold-launch"/);
    assert.match(source, /data-testid="title-card"/);
    assert.match(source, /JULY, 1991/);
    assert.ok(source.indexOf('name="last_name"') < source.indexOf('name="first_name"'), "waiver asks for Last before First");
    assert.match(source, /cannot be changed after filing/);
    assert.match(source, /data-testid="aeot-initialization"/);
    for (const stage of ["SUBSYSTEM BUS VERIFICATION", "CLEARANCE VERIFICATION: Q4", "SUB-LEVEL TELEMETRY LINK", "FACILITY SCHEMATIC: SECTOR B1"]) assert.match(source, new RegExp(stage));
    assert.match(source, /NEW ASSIGNMENT/);
    assert.doesNotMatch(source, /name="(?:ui_)?color"/i, "unavailable color controls stay hidden");
  } finally {
    fs.rmSync(f.appDataPath, { recursive:true, force:true });
  }
});
