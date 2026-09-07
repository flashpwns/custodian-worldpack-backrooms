"use strict";

const VERSION = "yellow-beast-acoustic-director@v1";

const BUSES = Object.freeze({
  MASTER: "master",
  MUSIC: "music",
  ENVIRONMENT: "environment",
  MACHINERY: "machinery",
  COMMUNICATIONS: "communications",
  INTERFACE: "interface",
  CHARACTER: "character"
});

const HOOKS = Object.freeze({
  BOOT_POWER: "boot_power",
  BOOT_DRIVE: "boot_drive",
  BOOT_RELAY: "boot_relay",
  BOOT_CONFIRM: "boot_confirm",
  OPENING_MUSIC_01: "opening_music_01",
  OPENING_MUSIC_02: "opening_music_02",
  OPENING_MUSIC_03: "opening_music_03",
  UI_SELECT: "ui_select",
  UI_SUBMIT: "ui_submit",
  UI_ERROR: "ui_error",
  FACILITY_AMBIENT: "facility_ambient",
  LPMDS_BED: "lpmds_bed",
  LPMDS_TWANG_01: "lpmds_twang_01",
  LPMDS_TWANG_02: "lpmds_twang_02",
  LPMDS_TWANG_03: "lpmds_twang_03",
  THRESHOLD_CROSS_HUM: "threshold_cross_hum",
  BLAST_DOOR_RELEASE: "blast_door_release",
  BLAST_DOOR_OPEN: "blast_door_open",
  BLAST_DOOR_CLOSE: "blast_door_close",
  COMPLEX_MUSIC: "complex_music",
  COMPLEX_HUM: "complex_hum",
  THRESHOLD_BEACON: "threshold_beacon",
  RADIO_TX_CHIRP: "radio_tx_chirp",
  RADIO_RX_CUE: "radio_rx_cue",
  RADIO_STATIC: "radio_static",
  RADIO_DROPOUT: "radio_dropout",
  LOCALIZED_MUSIC_01: "localized_music_01",
  LOCALIZED_MUSIC_02: "localized_music_02"
});

/**
 * Deterministically evaluates the complete acoustic soundscape for the current turn.
 * Governed strictly by canonical location, phase, environment, and recent events.
 */
function evaluateAcousticScene(run, spatialDefinition = {}, world = null) {
  const phaseId = run?.phase?.phase_id ?? run?.expedition?.phase ?? "BRIEFING";
  const playerLoc = run?.spatial?.player_location ?? "async-briefing-room";
  const interval = run?.expedition?.clock?.interval ?? 0;

  let ambientLoop = HOOKS.FACILITY_AMBIENT;
  let machineryBed = null;
  let musicCue = null;
  const activeCues = [];

  const profile = {
    reverberation: 0.2,
    fluorescent_hum_level: 0.1,
    attenuation_distance: 1,
    radio_static_level: 0.0
  };

  // Phase & Location-based deterministic soundscape mapping
  if (["BRIEFING", "STAGING", "FACILITY_TRANSIT"].includes(phaseId)) {
    ambientLoop = HOOKS.FACILITY_AMBIENT;
    if (phaseId === "BRIEFING" && interval <= 1) {
      musicCue = HOOKS.OPENING_MUSIC_01;
    }
  } else if (["THRESHOLD", "STANDARD_RADIO_CHECK"].includes(phaseId) || playerLoc === "threshold-room") {
    ambientLoop = HOOKS.LPMDS_BED;
    machineryBed = HOOKS.THRESHOLD_CROSS_HUM;
    profile.reverberation = 0.6;
    profile.fluorescent_hum_level = 0.4;
  } else if (["FIELD_OPERATION", "RETURN"].includes(phaseId)) {
    ambientLoop = HOOKS.COMPLEX_HUM;
    profile.fluorescent_hum_level = 0.85;
    profile.reverberation = 0.75;

    if (playerLoc === "threshold-side-entry" || playerLoc === "utility-room") {
      machineryBed = HOOKS.THRESHOLD_BEACON;
    }

    if (phaseId === "FIELD_OPERATION" && interval % 10 === 0) {
      musicCue = HOOKS.COMPLEX_MUSIC;
    }

    // Phenomenon proximity
    if (world?.phenomena && Object.keys(world.phenomena).length > 0) {
      for (const phenom of Object.values(world.phenomena)) {
        if (phenom.location_id === playerLoc) {
          musicCue = HOOKS.LOCALIZED_MUSIC_01;
          profile.radio_static_level = 0.4;
          break;
        }
      }
    }
  } else if (["REPORT", "DEBRIEF"].includes(phaseId)) {
    ambientLoop = HOOKS.FACILITY_AMBIENT;
    profile.reverberation = 0.2;
  }

  // Event-derived one-shot cues
  const recentEvents = (run?.expedition?.presentation_events ?? []).slice(-3);
  for (const evt of recentEvents) {
    if (evt.interval === interval || (Date.now() - (evt.timestamp ?? 0)) < 3000) {
      if (evt.type === "radio" || evt.channel === "FIELD_RADIO") {
        if (evt.speaker === "You" || evt.speaker === "EXPEDITION LEAD") {
          activeCues.push(HOOKS.RADIO_TX_CHIRP);
        } else {
          activeCues.push(HOOKS.RADIO_RX_CUE);
        }
      }
    }
  }

  return {
    version: VERSION,
    phase_id: phaseId,
    location_id: playerLoc,
    ambient_loop: ambientLoop,
    machinery_bed: machineryBed,
    music_cue: musicCue,
    active_cues: [...new Set(activeCues)],
    acoustic_profile: profile,
    bus_volumes: {
      [BUSES.MASTER]: 1.0,
      [BUSES.MUSIC]: 0.5,
      [BUSES.ENVIRONMENT]: 0.8,
      [BUSES.MACHINERY]: 0.7,
      [BUSES.COMMUNICATIONS]: 0.9,
      [BUSES.INTERFACE]: 0.8,
      [BUSES.CHARACTER]: 0.8
    }
  };
}

module.exports = {
  VERSION,
  BUSES,
  HOOKS,
  evaluateAcousticScene
};
