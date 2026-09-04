"use strict";
// A-Sync Expedition Acoustic System (AEAS)
// Authoritative implementation of the Yellow Beast Audio/Acoustic Master Specification.
// Implements the 7-bus architecture, 35 frozen conceptual hooks, replaceable asset registry,
// spatial attenuation, and procedural Web Audio synthesis fallback.

(function (global) {
  const AUDIO_BUSES = Object.freeze({
    MASTER: "master",
    MUSIC: "music",
    ENVIRONMENT: "environment",
    MACHINERY: "machinery",
    COMMUNICATIONS: "communications",
    INTERFACE: "interface",
    CHARACTER: "character"
  });

  const CONCEPTUAL_HOOKS = Object.freeze([
    // Institutional / Boot
    "boot_power",
    "boot_drive",
    "boot_relay",
    "boot_confirm",

    // Opening Music (one of three chosen per session)
    "opening_music_01",
    "opening_music_02",
    "opening_music_03",

    // Workstation & UI Vocabulary
    "ui_hover",
    "ui_select",
    "ui_back",
    "ui_toggle",
    "ui_submit",
    "ui_error",
    "ui_panel_open",
    "ui_panel_close",

    // Facility, LPMDS & Threshold Room
    "facility_ambient",
    "lpmds_bed",
    "lpmds_twang_01",
    "lpmds_twang_02",
    "lpmds_twang_03",
    "threshold_cross_hum",

    // Blast Door Mechanics
    "blast_door_release",
    "blast_door_open",
    "blast_door_open_stop",
    "blast_door_close",
    "blast_door_close_impact",

    // Complex Expedition Track & Fluorescent Hum
    "complex_music",
    "complex_hum",
    "threshold_beacon",

    // Communications & Radio System
    "radio_tx_chirp",
    "radio_rx_cue",
    "radio_static",
    "radio_dropout",

    // Localized Anomalous Music
    "localized_music_01",
    "localized_music_02"
  ]);

  const HOOK_BUS_MAP = Object.freeze({
    boot_power: AUDIO_BUSES.INTERFACE,
    boot_drive: AUDIO_BUSES.INTERFACE,
    boot_relay: AUDIO_BUSES.INTERFACE,
    boot_confirm: AUDIO_BUSES.INTERFACE,

    opening_music_01: AUDIO_BUSES.MUSIC,
    opening_music_02: AUDIO_BUSES.MUSIC,
    opening_music_03: AUDIO_BUSES.MUSIC,

    ui_hover: AUDIO_BUSES.INTERFACE,
    ui_select: AUDIO_BUSES.INTERFACE,
    ui_back: AUDIO_BUSES.INTERFACE,
    ui_toggle: AUDIO_BUSES.INTERFACE,
    ui_submit: AUDIO_BUSES.INTERFACE,
    ui_error: AUDIO_BUSES.INTERFACE,
    ui_panel_open: AUDIO_BUSES.INTERFACE,
    ui_panel_close: AUDIO_BUSES.INTERFACE,

    facility_ambient: AUDIO_BUSES.ENVIRONMENT,
    lpmds_bed: AUDIO_BUSES.MACHINERY,
    lpmds_twang_01: AUDIO_BUSES.MACHINERY,
    lpmds_twang_02: AUDIO_BUSES.MACHINERY,
    lpmds_twang_03: AUDIO_BUSES.MACHINERY,
    threshold_cross_hum: AUDIO_BUSES.MACHINERY,

    blast_door_release: AUDIO_BUSES.MACHINERY,
    blast_door_open: AUDIO_BUSES.MACHINERY,
    blast_door_open_stop: AUDIO_BUSES.MACHINERY,
    blast_door_close: AUDIO_BUSES.MACHINERY,
    blast_door_close_impact: AUDIO_BUSES.MACHINERY,

    complex_music: AUDIO_BUSES.MUSIC,
    complex_hum: AUDIO_BUSES.ENVIRONMENT,
    threshold_beacon: AUDIO_BUSES.ENVIRONMENT,

    radio_tx_chirp: AUDIO_BUSES.COMMUNICATIONS,
    radio_rx_cue: AUDIO_BUSES.COMMUNICATIONS,
    radio_static: AUDIO_BUSES.COMMUNICATIONS,
    radio_dropout: AUDIO_BUSES.COMMUNICATIONS,

    localized_music_01: AUDIO_BUSES.MUSIC,
    localized_music_02: AUDIO_BUSES.MUSIC
  });

  let settings = {
    audio_muted: false,
    audio_master: 0.35,
    reduced_sensory: false,
    bus_volumes: {
      [AUDIO_BUSES.MASTER]: 1.0,
      [AUDIO_BUSES.MUSIC]: 0.7,
      [AUDIO_BUSES.ENVIRONMENT]: 0.8,
      [AUDIO_BUSES.MACHINERY]: 0.85,
      [AUDIO_BUSES.COMMUNICATIONS]: 0.9,
      [AUDIO_BUSES.INTERFACE]: 0.6,
      [AUDIO_BUSES.CHARACTER]: 0.8
    }
  };

  const assetRegistry = new Map();
  let audioContext = null;

  function getAudioContext() {
    if (!audioContext && typeof global.AudioContext !== "undefined") {
      audioContext = new global.AudioContext();
    }
    return audioContext;
  }

  function configure(next = {}) {
    if (next.bus_volumes) {
      settings.bus_volumes = { ...settings.bus_volumes, ...next.bus_volumes };
      delete next.bus_volumes;
    }
    settings = { ...settings, ...next };
  }

  function registerAsset(hookId, descriptor) {
    if (!CONCEPTUAL_HOOKS.includes(hookId)) {
      throw new Error(`Cannot register unknown acoustic hook: "${hookId}"`);
    }
    assetRegistry.set(hookId, descriptor);
  }

  function getRegisteredAsset(hookId) {
    return assetRegistry.get(hookId) ?? null;
  }

  function listRegisteredHooks() {
    return CONCEPTUAL_HOOKS.map((id) => ({
      id,
      bus: HOOK_BUS_MAP[id] ?? AUDIO_BUSES.INTERFACE,
      registered: assetRegistry.has(id),
      descriptor: assetRegistry.get(id) ?? null
    }));
  }

  function computeEffectiveGain(busName = AUDIO_BUSES.INTERFACE, extraGain = 1.0) {
    if (settings.audio_muted || settings.audio_master <= 0) return 0;
    if (settings.reduced_sensory) extraGain *= 0.5;
    const busMultiplier = settings.bus_volumes[busName] ?? 1.0;
    return Math.max(0, Math.min(1.0, settings.audio_master * busMultiplier * extraGain));
  }

  function calculateSpatialAttenuation(distanceMeters, occlusionWalls = 0, { maxAudibleDistance = 120, wallAttenuationDb = 6 } = {}) {
    if (distanceMeters >= maxAudibleDistance) return { audible: false, volume: 0, lowPassHz: 400 };
    const distanceFactor = Math.max(0, 1 - Math.pow(distanceMeters / maxAudibleDistance, 0.7));
    const wallPenalty = Math.pow(0.5, (occlusionWalls * wallAttenuationDb) / 6);
    const volume = Math.max(0, Math.min(1.0, distanceFactor * wallPenalty));
    const lowPassHz = Math.max(300, 8000 * Math.pow(0.7, occlusionWalls) * (1 - (distanceMeters / maxAudibleDistance) * 0.5));
    return {
      audible: volume > 0.005,
      volume,
      lowPassHz
    };
  }

  function triggerProceduralFallback(hookId, options = {}) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const bus = HOOK_BUS_MAP[hookId] ?? AUDIO_BUSES.INTERFACE;
    const gainLevel = computeEffectiveGain(bus, options.gain ?? 1.0);
    if (gainLevel <= 0.0001) return;

    const now = ctx.currentTime;

    switch (hookId) {
      case "radio_tx_chirp": {
        // High-low chirping signature of A-Sync field radio transmission
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(640, now);
        osc.frequency.setValueAtTime(880, now + 0.025);
        gain.gain.setValueAtTime(gainLevel * 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.065);
        break;
      }

      case "radio_rx_cue": {
        // Subtle incoming transmission carrier alert
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(740, now);
        gain.gain.setValueAtTime(gainLevel * 0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.045);
        break;
      }

      case "ui_select":
      case "ui_submit": {
        // Solid mechanical relay / terminal click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(hookId === "ui_submit" ? 520 : 440, now);
        gain.gain.setValueAtTime(gainLevel * 0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.055);
        break;
      }

      case "ui_error": {
        // Low-frequency institutional error notification
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, now);
        gain.gain.setValueAtTime(gainLevel * 0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.13);
        break;
      }

      case "boot_relay": {
        // Crisp hardware contact relay click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(320, now);
        gain.gain.setValueAtTime(gainLevel * 0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);
        break;
      }

      case "boot_confirm": {
        // CRT POST confirmation tone
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        gain.gain.setValueAtTime(gainLevel * 0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
        break;
      }

      case "threshold_cross_hum": {
        // Deep resonant electromagnetic boundary hum
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(65, now);
        osc.frequency.exponentialRampToValueAtTime(85, now + 0.35);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(gainLevel * 0.15, now + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.52);
        break;
      }

      case "threshold_beacon": {
        // Spatial navigation ping from the outpost Threshold
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(280, now);
        gain.gain.setValueAtTime(gainLevel * 0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.23);
        break;
      }

      default: {
        // Generic subtle operational blip
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 400;
        gain.gain.setValueAtTime(gainLevel * 0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.055);
        break;
      }
    }
  }

  function emitHook(hookId, options = {}) {
    if (!CONCEPTUAL_HOOKS.includes(hookId)) {
      console.warn(`[YBAudio] Unrecognized acoustic hook: ${hookId}`);
      return;
    }
    const registered = assetRegistry.get(hookId);
    if (registered && typeof registered.play === "function") {
      try {
        registered.play(options);
      } catch (err) {
        console.error(`[YBAudio] Error in registered asset for ${hookId}:`, err);
        triggerProceduralFallback(hookId, options);
      }
    } else {
      triggerProceduralFallback(hookId, options);
    }
  }

  // Legacy fallback compatibility with prior YBAudio.play(kind) interface
  function play(kind = "confirm") {
    const legacyMap = {
      confirm: "ui_select",
      select: "ui_select",
      error: "ui_error",
      radio: "radio_tx_chirp",
      threshold: "threshold_cross_hum"
    };
    const targetHook = legacyMap[kind] ?? "ui_select";
    emitHook(targetHook);
  }

  const api = Object.freeze({
    AUDIO_BUSES,
    CONCEPTUAL_HOOKS,
    HOOK_BUS_MAP,
    configure,
    registerAsset,
    getRegisteredAsset,
    listRegisteredHooks,
    calculateSpatialAttenuation,
    emitHook,
    play
  });

  global.YBAudio = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window === "undefined" ? globalThis : window);
