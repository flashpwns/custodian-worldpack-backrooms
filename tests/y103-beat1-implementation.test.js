"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const menuMusic = require("../desktop/menu-music");
const nameRules = require("../desktop/shared/name-rules");

function fixture(seed = "beat1-fixture") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-beat1-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
  const created = service.createWorld({ name: "Beat 1 Test World", seed });
  assert.equal(created.ok, true);
  return { appDataPath, service, worldId: created.world.id };
}

test("Beat 1 Contract - Main Menu Music singleton bossa track", () => {
  assert.equal(menuMusic.applicationTrack.id, "bossa-diary");
  assert.equal(menuMusic.applicationTrack.file, "bossa-diary.mp3");
  assert.equal(menuMusic.TRACKS.length, 1);
  assert.equal(menuMusic.TRACKS[0].id, "bossa-diary");
  assert.equal(menuMusic.selectTrack().id, "bossa-diary");
  // Ensure the old 4-track pool is retired
  const poolIds = menuMusic.TRACKS.map(t => t.id);
  assert.equal(poolIds.includes("libets-delay"), false);
  assert.equal(poolIds.includes("chirp"), false);
  assert.equal(poolIds.includes("time-passages-kane"), false);
});

test("Beat 1 Contract - Two-Input Title Law and Typography in Renderer", () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(rendererSource, /VOICES OF THE THRESHOLD/);
  assert.match(rendererSource, /A Kane Pixels' Backrooms Simulacrum/);
  assert.match(rendererSource, /title-materializing/);
  assert.match(rendererSource, /title-materialized/);
  assert.match(rendererSource, /title-acknowledged/);
  assert.match(rendererSource, /PRESS AGAIN TO CONTINUE/);
  assert.match(rendererSource, /ui_select/);
  assert.match(rendererSource, /ui_submit/);
});

test("Beat 1 Contract - Title Card Two-Input state machine logic", () => {
  // Test the pure state machine logic of the Two-Input Title Law
  let isMaterialized = false;
  let gate1Acknowledged = false;
  let gate1HandledAt = 0;
  let homeCalled = false;
  const audioHooks = [];

  const simulateMaterializationTimer = () => {
    if (!isMaterialized) {
      isMaterialized = true;
    }
  };

  const handleInput = (timestamp) => {
    if (!gate1Acknowledged) {
      isMaterialized = true;
      gate1Acknowledged = true;
      gate1HandledAt = timestamp;
      audioHooks.push("ui_select");
      return;
    }
    if (timestamp - gate1HandledAt < 120) return; // Debounce
    audioHooks.push("ui_submit");
    homeCalled = true;
  };

  // Natural materialization completes before any input
  simulateMaterializationTimer();
  assert.equal(isMaterialized, true);
  assert.equal(gate1Acknowledged, false, "Natural timer must NEVER satisfy Gate 1");
  assert.equal(homeCalled, false);

  // Input 1 after natural materialization arms Gate 1, does NOT dismiss
  handleInput(3000);
  assert.equal(gate1Acknowledged, true);
  assert.equal(homeCalled, false, "Input 1 must not dismiss title card");
  assert.deepEqual(audioHooks, ["ui_select"]);

  // Rapid accidental duplicate event (<120ms) is blocked
  handleInput(3050);
  assert.equal(homeCalled, false, "Input within debounce window must not trigger Gate 2");
  assert.deepEqual(audioHooks, ["ui_select"]);

  // Input 2 after debounce advances to landing page
  handleInput(3200);
  assert.equal(homeCalled, true, "Input 2 after debounce must advance to landing page");
  assert.deepEqual(audioHooks, ["ui_select", "ui_submit"]);
});

test("Beat 1 Contract - Menu Music Gain and Distant Room Acoustics", () => {
  const audioSrc = fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8");
  assert.match(audioSrc, /high\.frequency\.value\s*=\s*(?:100|350)/);
  assert.match(audioSrc, /low\.frequency\.value\s*=\s*(?:6000|4200)/);
  assert.match(audioSrc, /playAudioFile\("menu_music",\s*menuTrack\.src,\s*\{\s*bus:\s*AUDIO_BUSES\.MUSIC,\s*gain:\s*1\.0/);
  assert.match(audioSrc, /gain\.gain\.setValueAtTime\(gainLevel\s*\*\s*0\.35,\s*now\)/);
});

test("Beat 1 Contract - World Selection Exit Game Affordance and Escape Handling", () => {
  const preloadSrc = fs.readFileSync(path.join(__dirname, "../desktop/preload.js"), "utf8");
  assert.match(preloadSrc, /"exitApplication"/);

  const mainSrc = fs.readFileSync(path.join(__dirname, "../desktop/main.js"), "utf8");
  assert.match(mainSrc, /ipcMain\.handle\("yellow-beast:exitApplication",\s*\(\)\s*=>/);

  const rendererSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(rendererSource, /data-action="exit-game"/);
  assert.match(rendererSource, /data-testid="exit-game-button"/);
  assert.match(rendererSource, /data-testid="exit-game-dialog"/);
  assert.match(rendererSource, /data-action="cancel-exit"/);
  assert.match(rendererSource, /data-action="confirm-exit"/);
  assert.match(rendererSource, /event\.key\s*===\s*"Escape"[\s\S]*?data-testid="world-library"/);
});

test("Beat 1 Contract - Deterministic Name Validation Rules", () => {
  // 1-12 characters, letters, hyphens, apostrophes
  assert.equal(nameRules.valid("Casey"), true);
  assert.equal(nameRules.valid("Morgan"), true);
  assert.equal(nameRules.valid("Jean-Luc"), true);
  assert.equal(nameRules.valid("O'Connor"), true);
  assert.deepEqual(nameRules.invalidFields({ first_name: "Casey", last_name: "Morgan" }), []);

  // Over 12 characters rejected
  assert.equal(nameRules.valid("Maximilianus1"), false);
  assert.equal(nameRules.valid("Bartholomewson"), false);
  assert.deepEqual(nameRules.invalidFields({ first_name: "Maximilianus1", last_name: "Smith" }), ["first_name"]);

  // Blanks rejected
  assert.equal(nameRules.valid(""), false);
  assert.deepEqual(nameRules.invalidFields({ first_name: "", last_name: "Morgan" }), ["first_name"]);
  assert.deepEqual(nameRules.invalidFields({ first_name: "Casey", last_name: "" }), ["last_name"]);

  // Numbers & punctuation rejected
  assert.equal(nameRules.valid("Casey1"), false);
  assert.equal(nameRules.valid("Morgan!"), false);

  // Profanity rejected
  assert.equal(nameRules.valid("Fuck"), false);

  // Simultaneous invalid fields detection
  const invalidBoth = nameRules.invalidFields({ first_name: "123", last_name: "Fuck" });
  assert.deepEqual(invalidBoth, ["last_name", "first_name"], "Both invalid fields must be identified simultaneously");
});

test("Beat 1 Contract - Personnel Confirmation Semantics and Single Commit", () => {
  const f = fixture("personnel-confirmation");
  try {
    const statusBefore = f.service.getQ4PersonnelStatus({ world_id: f.worldId });
    assert.equal(statusBefore.required, true, "Fresh world requires personnel creation");
    assert.equal(statusBefore.player, null);

    // Create draft
    const created = f.service.createQ4Personnel({
      world_id: f.worldId,
      first_name: "Morgan",
      last_name: "Casey"
    });
    assert.equal(created.ok, true);
    assert.equal(created.player.first_name, "Morgan");
    assert.equal(created.player.last_name, "Casey");

    // Status is now confirmation_required
    const statusPending = f.service.getQ4PersonnelStatus({ world_id: f.worldId });
    assert.equal(statusPending.required, false);
    assert.equal(statusPending.confirmation_required, true);

    // Confirm commits permanently
    const confirmed = f.service.confirmQ4Personnel({ world_id: f.worldId });
    assert.equal(confirmed.ok, true);

    const statusConfirmed = f.service.getQ4PersonnelStatus({ world_id: f.worldId });
    assert.equal(statusConfirmed.required, false);
    assert.equal(statusConfirmed.confirmation_required, false);
    assert.equal(statusConfirmed.player.first_name, "Morgan");
    assert.equal(statusConfirmed.player.last_name, "Casey");

    // Persisted in world
    const world = f.service.getWorld(f.worldId);
    const playerId = world.q4_operations.controlled_player;
    const playerChar = world.characters[playerId];
    assert.equal(playerChar.first_name, "Morgan");
    assert.equal(playerChar.last_name, "Casey");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("Beat 1 Contract - Downstairs KV31 Meeting Room and 4-Member Party Assembly", () => {
  const f = fixture("party-and-room");
  try {
    // Register player
    f.service.createQ4Personnel({ world_id: f.worldId, first_name: "Morgan", last_name: "Casey" });
    f.service.confirmQ4Personnel({ world_id: f.worldId });

    // Start session in field-researcher mode
    const session = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", require_personnel: true });
    assert.equal(session.ok, true);
    const projection = session.projection;

    // Phase is BRIEFING
    assert.equal(projection.phase.phase_id, "BRIEFING");

    // Location is downstairs KV31 briefing room
    const locId = projection.q4.current_location?.id ?? projection.q4.spatial?.location_id;
    assert.equal(locId, "async-briefing-room");

    // Exact team count: 1 player + 3 coworkers = 4 total
    const team = projection.q4.team;
    assert.equal(team.length, 4, "Team must have exactly 4 members");

    const controlled = team.filter(m => m.controlled === true);
    assert.equal(controlled.length, 1, "Exactly 1 member must be controlled player");
    assert.equal(controlled[0].first_name, "Morgan");
    assert.equal(controlled[0].last_name, "Casey");

    const coworkers = team.filter(m => !m.controlled);
    assert.equal(coworkers.length, 3, "Exactly 3 coworkers must be assigned");

    // Coworkers have unique names, distinct roles, and personality baselines
    const coworkerNames = coworkers.map(c => c.display_name);
    assert.equal(new Set(coworkerNames).size, 3, "All coworkers must have distinct names");
    const coworkerRoles = coworkers.map(c => c.role);
    assert.equal(new Set(coworkerRoles).size, 3, "All coworkers must have distinct roles");
    for (const coworker of coworkers) {
      assert.ok(coworker.display_name, "Coworker must have display name");
      assert.ok(coworker.role, "Coworker must have role");
    }

    // Radio channels: during briefing broadcast, LOCAL is unavailable and STANDARD is unavailable
    assert.equal(projection.q4.channels.local.available, false, "Local communication unavailable during broadcast");
    assert.equal(projection.q4.channels.standard.available, false, "STANDARD radio channel must be locked during briefing");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("Beat 1 Contract - Beat 1 Exit Contract Guard Function", () => {
  const f = fixture("exit-guard");
  try {
    f.service.createQ4Personnel({ world_id: f.worldId, first_name: "Morgan", last_name: "Casey" });
    f.service.confirmQ4Personnel({ world_id: f.worldId });

    const session = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", require_personnel: true });
    assert.equal(session.ok, true);

    const world = f.service.getWorld(f.worldId);
    const projection = session.projection;

    // Simulate verifyBeat1ExitContract logic
    function verifyBeat1ExitContract(w, p) {
      const errors = [];
      const worldId = w?.id || w?.world_id;
      if (!w || !worldId) errors.push("World missing or invalid ID");
      if (w && "seed" in w && w.seed == null) errors.push("World missing seed");
      if (!p) errors.push("Gameplay projection missing");
      if (p?.mode?.id !== "field-researcher") errors.push(`Expected mode field-researcher, got ${p?.mode?.id}`);
      if (p?.phase?.phase_id !== "BRIEFING") errors.push(`Expected initial phase BRIEFING, got ${p?.phase?.phase_id}`);

      const team = p?.q4?.team ?? [];
      if (team.length !== 4) errors.push(`Expected exactly 4 team members, got ${team.length}`);
      const controlled = team.filter(m => m.controlled === true);
      if (controlled.length !== 1) errors.push(`Expected exactly 1 controlled player, got ${controlled.length}`);
      const coworkers = team.filter(m => !m.controlled);
      if (coworkers.length !== 3) errors.push(`Expected exactly 3 coworkers, got ${coworkers.length}`);

      const locationId = p?.q4?.current_location?.id ?? p?.q4?.spatial?.location_id ?? p?.location?.id;
      if (!locationId || !locationId.includes("briefing")) {
        errors.push(`Expected initial location to be KV31 briefing room, got ${locationId}`);
      }

      if (!p?.q4?.mission_record && !p?.q4?.display_mission) {
        errors.push("Missing mission record or display mission");
      }

      const opTime = p?.q4?.operational_time;
      if (typeof opTime !== "string" || !opTime.startsWith("T+0")) {
        errors.push(`Expected operational time T+0, got ${opTime}`);
      }

      return { ok: errors.length === 0, errors };
    }

    // Canonical projection must pass
    const canonicalCheck = verifyBeat1ExitContract(world, projection);
    assert.equal(canonicalCheck.ok, true, `Canonical state failed check: ${JSON.stringify(canonicalCheck.errors)}`);
    assert.equal(canonicalCheck.errors.length, 0);

    // Tampered state: missing coworker -> fails
    const tamperedTeam = structuredClone(projection);
    tamperedTeam.q4.team.pop();
    const tamperedCheck = verifyBeat1ExitContract(world, tamperedTeam);
    assert.equal(tamperedCheck.ok, false);
    assert.match(tamperedCheck.errors.join(" "), /Expected exactly 4 team members/);

    // Tampered state: wrong phase -> fails
    const tamperedPhase = structuredClone(projection);
    tamperedPhase.phase.phase_id = "STAGING";
    const phaseCheck = verifyBeat1ExitContract(world, tamperedPhase);
    assert.equal(phaseCheck.ok, false);
    assert.match(phaseCheck.errors.join(" "), /Expected initial phase BRIEFING/);
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("Beat 1 Contract - World Isolation Between Multiple Saves", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-isolation-"));
  try {
    const service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
    const world1 = service.createWorld({ name: "World Alpha", seed: "alpha-seed" });
    const world2 = service.createWorld({ name: "World Beta", seed: "beta-seed" });

    // Register player only on World Alpha
    service.createQ4Personnel({ world_id: world1.world.id, first_name: "Alice", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: world1.world.id });

    // World Beta must remain unregistered and unaffected
    const statusAlpha = service.getQ4PersonnelStatus({ world_id: world1.world.id });
    const statusBeta = service.getQ4PersonnelStatus({ world_id: world2.world.id });

    assert.equal(statusAlpha.required, false);
    assert.equal(statusAlpha.player.first_name, "Alice");

    assert.equal(statusBeta.required, true, "World Beta must still require personnel creation");
    assert.equal(statusBeta.player, null);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Beat 1 Contract - Audio Settings Persistence", () => {
  const f = fixture("audio-settings");
  try {
    const original = f.service.getSettings().settings;
    assert.equal(typeof original.audio_sfx, "number");
    assert.equal(typeof original.audio_music, "number");

    // Update audio settings
    const updated = f.service.updateSettings({
      settings: {
        audio_sfx: 0.45,
        audio_music: 0.35,
        audio_muted: true
      }
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.settings.audio_sfx, 0.45);
    assert.equal(updated.settings.audio_music, 0.35);
    assert.equal(updated.settings.audio_muted, true);

    // Reopen service from the same data directory
    const reopened = new DesktopService({ appDataPath: f.appDataPath });
    const loaded = reopened.getSettings().settings;
    assert.equal(loaded.audio_sfx, 0.45, "audio_sfx must persist across reload");
    assert.equal(loaded.audio_music, 0.35, "audio_music must persist across reload");
    assert.equal(loaded.audio_muted, true, "audio_muted must persist across reload");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});
