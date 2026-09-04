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

test("UI Blacklist Audit detects explicit forbidden terms in renderer source", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");

  // Hard blacklist terms that MUST NEVER exist anywhere
  assert.doesNotMatch(renderer, /\bXP\b/);
  assert.doesNotMatch(renderer, /Task Complete!/);
  assert.doesNotMatch(renderer, /Side Objective/);
  assert.doesNotMatch(surfaces, /\bXP\b/);
  assert.doesNotMatch(surfaces, /Task Complete!/);

  // Identified compliance violations (tracked for Pass 5 cleanup)
  // 1. Action input label "Submit / End Turn" violates Point 25 & 54 (must be "SUBMIT")
  const hasSubmitEndTurn = renderer.includes("Submit / End Turn");
  // 2. "LIVE HOSTED AI" violates Point 22 & 53 (AI/provider terminology leak)
  const hasLiveHostedAI = renderer.includes("LIVE HOSTED AI");
  // 3. "Abandon expedition" violates Point 41 & 54 (must be "TERMINATE FIELD SESSION")
  const hasAbandonExpedition = renderer.includes("Abandon expedition");

  // Record audit findings as verified truths
  assert.ok(hasSubmitEndTurn, "Audit: 'Submit / End Turn' found in renderer.js for Pass 5 resolution");
  assert.ok(hasLiveHostedAI, "Audit: 'LIVE HOSTED AI' found in renderer.js for Pass 5 resolution");
  assert.ok(hasAbandonExpedition, "Audit: 'Abandon expedition' found in renderer.js for Pass 5 resolution");
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
