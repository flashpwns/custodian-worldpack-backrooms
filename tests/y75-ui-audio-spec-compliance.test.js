"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const audio = require("../desktop/renderer/audio");

test("Acoustic Architecture exports all 7 frozen audio buses", () => {
  assert.ok(audio.AUDIO_BUSES);
  assert.equal(audio.AUDIO_BUSES.MASTER, "master");
  assert.equal(audio.AUDIO_BUSES.MUSIC, "music");
  assert.equal(audio.AUDIO_BUSES.ENVIRONMENT, "environment");
  assert.equal(audio.AUDIO_BUSES.MACHINERY, "machinery");
  assert.equal(audio.AUDIO_BUSES.COMMUNICATIONS, "communications");
  assert.equal(audio.AUDIO_BUSES.INTERFACE, "interface");
  assert.equal(audio.AUDIO_BUSES.CHARACTER, "character");
});

test("Acoustic Architecture defines all 35 frozen conceptual hooks", () => {
  const expectedHooks = [
    "boot_power", "boot_drive", "boot_relay", "boot_confirm",
    "opening_music_01", "opening_music_02", "opening_music_03",
    "ui_hover", "ui_select", "ui_back", "ui_toggle", "ui_submit", "ui_error", "ui_panel_open", "ui_panel_close",
    "facility_ambient", "lpmds_bed", "lpmds_twang_01", "lpmds_twang_02", "lpmds_twang_03", "threshold_cross_hum",
    "blast_door_release", "blast_door_open", "blast_door_open_stop", "blast_door_close", "blast_door_close_impact",
    "complex_music", "complex_hum", "threshold_beacon",
    "radio_tx_chirp", "radio_rx_cue", "radio_static", "radio_dropout",
    "localized_music_01", "localized_music_02"
  ];

  assert.equal(audio.CONCEPTUAL_HOOKS.length, 35);
  for (const hook of expectedHooks) {
    assert.ok(audio.CONCEPTUAL_HOOKS.includes(hook), `Missing conceptual hook: ${hook}`);
    assert.ok(audio.HOOK_BUS_MAP[hook], `Hook ${hook} not mapped to an audio bus`);
  }
});

test("Replaceable asset registry allows dynamic binding without code modification", () => {
  let played = false;
  const mockAsset = {
    play: () => { played = true; }
  };
  audio.registerAsset("radio_tx_chirp", mockAsset);
  assert.equal(audio.getRegisteredAsset("radio_tx_chirp"), mockAsset);

  audio.emitHook("radio_tx_chirp");
  assert.equal(played, true);

  assert.throws(() => {
    audio.registerAsset("nonexistent_hook", mockAsset);
  }, /Cannot register unknown acoustic hook/);
});

test("Spatial attenuation calculates volume and low-pass filtering based on distance and walls", () => {
  const nearOpen = audio.calculateSpatialAttenuation(5, 0);
  const distantOpen = audio.calculateSpatialAttenuation(60, 0);
  const distantOccluded = audio.calculateSpatialAttenuation(60, 3);
  const outOfRange = audio.calculateSpatialAttenuation(150, 0);

  assert.equal(nearOpen.audible, true);
  assert.ok(nearOpen.volume > distantOpen.volume);
  assert.ok(distantOpen.volume > distantOccluded.volume);
  assert.ok(distantOpen.lowPassHz > distantOccluded.lowPassHz);
  assert.equal(outOfRange.audible, false);
  assert.equal(outOfRange.volume, 0);
});

test("UI Spec Compliance: Forbidden terms cause failure and frozen vocabulary is enforced", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../desktop/renderer/index.html"), "utf8");

  // Hard blacklist terms that MUST NEVER exist anywhere in player-facing code
  const forbiddenPatterns = [
    /\bXP\b/,
    /Task Complete!/,
    /Side Objective/,
    /\bQuest\b/,
    /Submit \/ End Turn/,
    /LIVE HOSTED AI/,
    /Abandon expedition/,
    /Leave session/,
    /MODEL INTERPRETATION/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(renderer, pattern, `Forbidden pattern ${pattern} found in renderer.js`);
    assert.doesNotMatch(surfaces, pattern, `Forbidden pattern ${pattern} found in surfaces.js`);
  }

  // index.html title must identify AEOT, not in-universe "Yellow Beast"
  assert.doesNotMatch(html, /<title>Yellow Beast<\/title>/);
  assert.match(html, /<title>ASYNC RESEARCH INSTITUTE · EXPEDITION TRACING INTERFACE<\/title>/);

  // Positive compliance checks
  assert.match(renderer, /<button type="submit"[^>]*>SUBMIT<\/button>/);
  assert.match(renderer, /TERMINATE FIELD SESSION/);
});

test("Safe interface audio hooks wired to runtime events", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // radio_tx_chirp wired to standard communication, never on local
  assert.match(renderer, /radio_tx_chirp/);
  // ui_submit wired to submission
  assert.match(renderer, /ui_submit/);
  // ui_select wired to interactions
  assert.match(renderer, /ui_select/);
  // ui_error wired to error state
  assert.match(renderer, /ui_error/);
  // boot_relay and boot_confirm wired to boot sequence
  assert.match(renderer, /boot_relay/);
  assert.match(renderer, /boot_confirm/);
});

test("Radio transmit audio contract: chirp on successful standard send only, never on local", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Verify the condition under which radio_tx_chirp is emitted
  assert.match(renderer, /channel === "standard"/);
  assert.match(renderer, /!resultIsError\(res\)\s*&&\s*channel === "standard"/);
  // Ensure radio_tx_chirp is not emitted for local
  assert.doesNotMatch(renderer, /channel === "local"[^;]*radio_tx_chirp/);
});

test("Input separation: natural action form and comms form remain distinct DOM structures", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Natural action form uses #natural-form
  assert.match(renderer, /id="natural-form"/);
  // Comms form uses #q4-comms-form
  assert.match(surfaces, /id="q4-comms-form"/);
  // Comms selector uses name="channel"
  assert.match(surfaces, /name="channel"/);
});

test("Mechanical channel switch presentation and audio toggle contract", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Visual mechanical slider/switch indicator
  assert.match(surfaces, /mechanical-channel-switch/);
  assert.match(surfaces, /\[■■□□\]/);
  assert.match(css, /\.mechanical-channel-switch/);
  assert.match(css, /\.switch-track/);

  // Audio wiring for toggle
  assert.match(renderer, /ui_toggle/);
});

test("Visual hierarchy: Map -> Interpretive Output -> Comms dominates operational field", () => {
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Map is positioned at grid row 1 (center-top)
  assert.match(css, /\.operational-field>\.operational-map\{grid-row:1/);
  // Field observation / Interpretive Output is positioned at grid row 2 (center-bottom)
  assert.match(css, /\.operational-field>\.field-observation\{grid-row:2\}/);
  // Interactables at row 3
  assert.match(css, /\.operational-field>\[data-testid="field-interactables"\]\{grid-row:3\}/);
  // Objectives and operational status at row 4
  assert.match(css, /\.operational-field>\.field-priority-grid\{grid-row:4\}/);
  // Comms surface occupies column 2 spanning rows (right rail)
  assert.match(css, /\.operational-field>\.communications-surface\{[^}]*grid-column:2;grid-row:1 \/ span 4/);
});

test("AEOT Palette: cold blue tokens and epistemic accents exist in CSS stylesheets", () => {
  const palette = fs.readFileSync(path.join(__dirname, "../desktop/renderer/aeot-palette.css"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Palette tokens
  assert.match(palette, /--aeot-navy-deep:\s*#060a12/);
  assert.match(palette, /--aeot-midnight-desaturated:\s*#0b1320/);
  assert.match(palette, /--aeot-line-blue:\s*#2c476d/);
  assert.match(palette, /--aeot-pale-blue:\s*#7b9ec9/);
  assert.match(palette, /--aeot-epistemic-observed-now:\s*#3ebd68/);
  assert.match(palette, /--aeot-epistemic-alert:\s*#d94b4b/);

  // Stylesheet uses cold blue vars
  assert.match(styles, /var\(--aeot-navy-deep/);
  assert.match(styles, /var\(--aeot-midnight-desaturated/);
});

test("Interpretive Heading: Dominant prose uses OBSERVATION RECORD and purges RESOLUTION", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Dominant prose heading is OBSERVATION RECORD
  assert.match(renderer, /<h2 id="current-scene-heading">OBSERVATION RECORD<\/h2>/);
  assert.match(renderer, /<span class="sr-only">Current scene observation record<\/span>/);

  // RESOLUTION is purged from player-facing scene resolution
  assert.doesNotMatch(renderer, /<h2 id="current-scene-heading">RESOLUTION<\/h2>/);
});

test("Natural action and comms input specifications: textarea and keyboard shortcuts", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Natural action form uses textarea
  assert.match(renderer, /<textarea name="text" rows="3"/);
  // Ctrl+Enter / Cmd+Enter submits natural action
  assert.match(renderer, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  // Enter without Shift submits comms
  assert.match(renderer, /event\.key === "Enter" && !event\.shiftKey/);

  // Textarea styling
  assert.match(css, /\.natural-action textarea/);
});

test("Expedition loading motif: restrained 3-person walking pictogram with rear glance", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // 3-person walking pictogram: lead camera [▣], middle case [■], rear lamp/tape [◌↩]
  assert.match(renderer, /expeditionLoadingMotif/);
  assert.match(renderer, /\[▣\]/);
  assert.match(renderer, /\[■\]/);
  assert.match(renderer, /\[◌↩\]/);

  // CSS animations
  assert.match(css, /\.expedition-loading-motif/);
  assert.match(css, /@keyframes rear-glance/);
  assert.match(css, /animation:\s*rear-glance/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("Institutional Consequence Portal for session termination forbids videogame popups", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Zero instances of videogame popups like "Are you sure?"
  assert.doesNotMatch(renderer, /are you sure\?/i);
  assert.doesNotMatch(surfaces, /are you sure\?/i);
  assert.doesNotMatch(renderer, /are you sure you want to quit/i);

  // Strict institutional consequence vocabulary
  assert.match(renderer, /showTerminationPortal/);
  assert.match(renderer, /\[RETURN TO EXPEDITION\]/);
  assert.match(renderer, /\[CONFIRM SESSION TERMINATION\]/);
  assert.match(renderer, /A-SYNC PROTOCOL KV31-C/);
  assert.match(renderer, /Institutional Consequence Warning/);

  // Styling for consequence portal
  assert.match(css, /\.termination-portal/);
  assert.match(css, /\.termination-dialog/);
  assert.match(css, /\.termination-consequence/);
});

test("Ceremonial phase audio sequencing across deployment and return lifecycle", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const audio = fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8");

  // Audio sequencing function exists and is hooked to phase changes
  assert.match(renderer, /playCeremonialPhaseAudio/);
  assert.match(renderer, /prevPhase !== nextPhase/);

  // Key ceremonial hooks are wired to corresponding phases
  assert.match(renderer, /YBAudio\.emitHook\("facility_ambient"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("lpmds_bed"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("threshold_cross_hum"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("blast_door_open"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("complex_music"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("threshold_beacon"\)/);
  assert.match(renderer, /YBAudio\.emitHook\("blast_door_close"\)/);

  // Procedural audio synthesizers defined in audio.js
  assert.match(audio, /case "facility_ambient":/);
  assert.match(audio, /case "lpmds_bed":/);
  assert.match(audio, /case "blast_door_open":/);
  assert.match(audio, /case "blast_door_close":/);
  assert.match(audio, /case "complex_music":/);
  assert.match(audio, /case "complex_hum":/);
});

test("Multipurpose Spatial / Visual Display modes: facility schematic, field survey, and media playback", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Supports facility, field-survey, and media modes
  assert.match(surfaces, /data-display-mode="facility"/);
  assert.match(surfaces, /data-display-mode="field-survey"/);
  assert.match(surfaces, /data-display-mode="media"/);

  // Interlock status displayed in facility mode
  assert.match(surfaces, /South: \$\{interlock\.south_barrier/);

  // CSS rules for spatial display
  assert.match(css, /\.spatial-visual-display/);
  assert.match(css, /\.facility-edge/);
  assert.match(css, /\.media-display-surface/);
});


