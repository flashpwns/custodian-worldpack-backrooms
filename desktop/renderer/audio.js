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

  const EXTENDED_HOOKS = Object.freeze([
    "threshold_activation",
    "paper_sheet_enter",
    "paper_sheet_exit"
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
    threshold_activation: AUDIO_BUSES.MACHINERY,

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
    localized_music_02: AUDIO_BUSES.MUSIC,

    paper_sheet_enter: AUDIO_BUSES.CHARACTER,
    paper_sheet_exit: AUDIO_BUSES.CHARACTER
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

  const DEFAULT_SOUND_MAP = Object.freeze({
    radio_tx_chirp: "../assets/audio/Radio/Radio_Beep_01.mp3",
    radio_rx_cue: "../assets/audio/Radio/Radio_Beep_01.mp3",
    threshold_cross_hum: "../assets/audio/Anomalies/Noclip_01.mp3",
    threshold_beacon: "../assets/audio/Equipment/Threshold_Ringing_01.mp3",
    lpmds_twang_01: "../assets/audio/Equipment/Threshold_Ringing_01.mp3",
    lpmds_twang_02: "../assets/audio/Equipment/Threshold_Ringing_01.mp3",
    lpmds_twang_03: "../assets/audio/Equipment/Threshold_Ringing_01.mp3",
    lpmds_bed: "../assets/audio/Ambience/Threshold_Ambience_01.mp3",
    complex_hum: "../assets/audio/Ambience/Outpost_Ambience_01.mp3",
    facility_ambient: "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA", // Standard facility ambient audio resolves strictly to silence until an approved asset exists. Complex hum must NEVER be substituted.
    threshold_activation: "../assets/audio/Equipment/Threshold_Activation_01.mp3",
    blast_door_release: "../assets/audio/Equipment/Threshold_Door_Tumble_01.mp3",
    blast_door_open: "../assets/audio/Equipment/Outpost_Door_01.mp3",
    blast_door_close: "../assets/audio/Equipment/Outpost_Lights_Out_01.mp3",
    localized_music_01: "../assets/audio/Ambience/Poolrooms_Ambience_01.mp3",
    localized_music_02: "../assets/audio/Anomalies/Green_Crackle_01.mp3"
  });

  const assetRegistry = new Map();
  const activeAudioElements = new Map();
  const playbacks = new Set();
  // A bus controls volume, not duration. Mechanical actions are one-shots.
  const LOOP_HOOKS = new Set(["facility_ambient", "lpmds_bed", "complex_hum", "threshold_beacon", "localized_music_01", "localized_music_02"]);
  let audioContext = null;
  let menuTrack = null;
  let menuWanted = false;
  const playbackFailures = [];

  function getAudioContext() {
    if (!audioContext && typeof global.AudioContext !== "undefined") audioContext = new global.AudioContext();
    return audioContext;
  }

  function updatePlayback(record) {
    const volume = computeEffectiveGain(record.bus, record.gain) * record.fade;
    record.audio.volume = volume;
    if (volume <= 0.0001) record.audio.pause();
    else if (record.audio.paused && !record.audio.ended && record.audio.loop) {
      const promise = record.audio.play();
      promise?.catch?.(error => {
        playbackFailures.push({ hook: record.hookId, reason: String(error?.name ?? "playback-failed") });
        if (playbackFailures.length > 20) playbackFailures.shift();
      });
    }
  }

  function configure(next = {}) {
    const { bus_volumes, ...rest } = next;
    settings = { ...settings, ...rest, bus_volumes: { ...settings.bus_volumes, ...bus_volumes } };
    playbacks.forEach(updatePlayback);
  }

  function dispose(record) {
    if (record.timer) global.clearInterval(record.timer);
    record.audio.pause();
    record.nodes?.forEach(node => node.disconnect());
    playbacks.delete(record);
    if (activeAudioElements.get(record.hookId) === record) activeAudioElements.delete(record.hookId);
  }

  function stopHook(hookId, fadeMs = 0) {
    for (const record of [...playbacks]) {
      if (record.hookId !== hookId) continue;
      if (!fadeMs || typeof global.setInterval !== "function") {
        if (record.timer) global.clearInterval(record.timer);
        dispose(record);
        continue;
      }
      if (record.timer) continue;
      const started = Date.now();
      const startFade = typeof record.fade === "number" ? record.fade : 1;
      record.timer = global.setInterval(() => {
        record.fade = Math.max(0, startFade * (1 - (Date.now() - started) / fadeMs));
        updatePlayback(record);
        if (!record.fade) dispose(record);
      }, 25);
    }
  }

  function stopAll(options = {}) {
    for (const record of [...playbacks]) {
      if (record.hookId === "menu_music" && menuWanted && options.stopMenu !== true) {
        continue;
      }
      dispose(record);
    }
  }

  function startupTannoyGraph(audio) {
    const ctx = getAudioContext();
    if (!ctx?.createMediaElementSource) return [];
    const source = ctx.createMediaElementSource(audio);
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = "explicit";
    const high = ctx.createBiquadFilter(); high.type = "highpass"; high.frequency.value = 250;
    high.Q.value = 0.707;
    const low = ctx.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 4000;
    low.Q.value = 0.707;
    const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1500; mid.Q.value = 1.1; mid.gain.value = 5;
    const saturation = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = 2 * i / (curve.length - 1) - 1;
      curve[i] = Math.tanh(2 * x) / Math.tanh(2);
    }
    // Web Audio copies this array on assignment: populate it BEFORE assigning.
    saturation.curve = curve;
    saturation.oversample = "2x";
    const compression = ctx.createDynamicsCompressor();
    compression.threshold.value = -20; compression.knee.value = 12; compression.ratio.value = 2.5;
    compression.attack.value = 0.008; compression.release.value = 0.18;
    const dry = ctx.createGain(); dry.gain.value = 0.88;
    const wet = ctx.createGain(); wet.gain.value = 0.12;
    const room = ctx.createConvolver();
    const impulse = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.14), ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 1.71) * Math.pow(1 - i / samples.length, 5) * 0.035;
      for (const [seconds, gain] of [[0.018, 0.22], [0.041, 0.12], [0.073, 0.06]]) samples[Math.floor(seconds * ctx.sampleRate)] += gain;
    }
    room.buffer = impulse;
    source.connect(mono).connect(high).connect(mid).connect(saturation).connect(low).connect(compression);
    compression.connect(dry).connect(ctx.destination);
    compression.connect(room).connect(wet).connect(ctx.destination);
    ctx.resume()?.catch?.(() => {});
    return [source, mono, high, low, mid, saturation, compression, dry, wet, room];
  }

  function playAudioFile(hookId, srcPath, options = {}) {
    if (typeof global.Audio === "undefined") return false;
    const bus = options.bus ?? HOOK_BUS_MAP[hookId] ?? AUDIO_BUSES.INTERFACE;
    const isLoop = options.loop ?? LOOP_HOOKS.has(hookId);
    const existing = isLoop && activeAudioElements.get(hookId);
    if (existing) {
      if (existing.timer) { global.clearInterval(existing.timer); existing.timer = null; }
      existing.fade = 1; existing.gain = options.gain ?? 1;
      updatePlayback(existing); return true;
    }
    // Remember muted loops so unmuting starts the current scene. Drop muted one-shots.
    if (!isLoop && computeEffectiveGain(bus, options.gain ?? 1) <= 0) return false;
    try {
      const audio = new global.Audio(srcPath);
      audio.loop = Boolean(isLoop);
      const record = { audio, hookId, bus, gain: options.gain ?? 1, fade: 1, nodes: [], processing: null };
      if (options.startupTannoy) {
        record.nodes = startupTannoyGraph(audio);
        if (record.nodes.length) record.processing = "startup-tannoy";
      }
      if (isLoop) activeAudioElements.set(hookId, record);
      playbacks.add(record);
      audio.onended = () => { if (!isLoop) dispose(record); };
      audio.onerror = () => { playbackFailures.push({ hook: hookId, reason: "media-error" }); dispose(record); };
      updatePlayback(record);
      if (record.audio.paused && !record.audio.ended && record.audio.volume > 0.0001) {
        const promise = record.audio.play();
        promise?.catch?.(error => {
          playbackFailures.push({ hook: record.hookId, reason: String(error?.name ?? "playback-failed") });
          if (playbackFailures.length > 20) playbackFailures.shift();
        });
      }
      return true;
    } catch (_) { return false; }
  }

  function playCameraClick(options = {}) {
    return playAudioFile("camera_shutter_click", "../assets/audio/Equipment/Camera_Click_01.mp3", { ...options, bus: AUDIO_BUSES.CHARACTER, gain: options.gain ?? 0.8, loop: false });
  }

  function startMenuMusic(track) {
    if (!menuTrack && track) menuTrack = Object.freeze({ ...track });
    menuWanted = true;
    for (const record of [...playbacks]) {
      if (record.hookId !== "menu_music") dispose(record);
    }
    // Missing approved media remains an explicit silent slot; never reroll or substitute.
    if (menuTrack?.src) playAudioFile("menu_music", menuTrack.src, { bus: AUDIO_BUSES.MUSIC, gain: 1.0, loop: true, startupTannoy: true });
  }

  function stopMenuMusic(fadeMs = 1500) { menuWanted = false; stopHook("menu_music", fadeMs); }

  let currentPhysicalEnvironment = "STANDARD";

  function applyScene(scene) {
    if (!scene) return;
    if (scene.physical_environment) {
      currentPhysicalEnvironment = scene.physical_environment;
    } else if (scene.phase_id) {
      currentPhysicalEnvironment = ["FIELD_OPERATION", "RETURN"].includes(scene.phase_id) ? "COMPLEX" : "STANDARD";
    } else if (scene.ambient_loop === "complex_hum" || scene.ambient_loop === "complex_music") {
      currentPhysicalEnvironment = "COMPLEX";
    } else if (scene.ambient_loop === "facility_ambient") {
      currentPhysicalEnvironment = "STANDARD";
    }
    const isStandard = currentPhysicalEnvironment === "STANDARD";
    const wanted = new Set([scene.ambient_loop, scene.machinery_bed].filter(hook => {
      if (!hook || !LOOP_HOOKS.has(hook)) return false;
      if (isStandard && (hook === "complex_hum" || hook === "complex_music")) return false;
      return true;
    }));
    for (const hook of [...activeAudioElements.keys()]) if (hook !== "menu_music" && !wanted.has(hook)) stopHook(hook);
    for (const hook of wanted) emitHook(hook, { loop: true, gain: hook === "threshold_beacon" ? scene.beacon_gain ?? 1 : 1 });
  }

  const hookCounts = {};

  function diagnostics() {
    const menuRecord = [...playbacks].find(r => r.hookId === "menu_music") || activeAudioElements.get("menu_music") || null;
    return {
      menu: {
        track: menuTrack?.id ?? null,
        available: Boolean(menuTrack?.src),
        wanted: menuWanted,
        active: Boolean(menuRecord),
        fading: Boolean(menuRecord?.timer),
        fade: menuRecord ? (typeof menuRecord.fade === "number" ? menuRecord.fade : 1) : null,
        volume: menuRecord?.audio?.volume ?? 0
      },
      active_loops: [...activeAudioElements.keys()],
      failures: playbackFailures.slice(-20),
      context_state: audioContext?.state ?? null,
      hook_counts: { ...hookCounts },
      radio_tx_chirp_count: hookCounts["radio_tx_chirp"] || 0,
      playback: [...playbacks].map(record => ({
        hook: record.hookId,
        loop: record.audio.loop,
        paused: record.audio.paused,
        ready_state: record.audio.readyState,
        current_time: record.audio.currentTime,
        volume: record.audio.volume,
        processing: record.processing,
        room_filter_nodes: record.nodes.length
      }))
    };
  }

  function registerAsset(hookId, descriptor) {
    if (!CONCEPTUAL_HOOKS.includes(hookId) && !EXTENDED_HOOKS.includes(hookId) && hookId !== "date_presentation_cue") {
      throw new Error(`Cannot register unknown acoustic hook: "${hookId}"`);
    }
    assetRegistry.set(hookId, descriptor);
  }

  function emitDatePresentationCue() {
    hookCounts["date_presentation_cue"] = (hookCounts["date_presentation_cue"] || 0) + 1;
    const registered = assetRegistry.get("date_presentation_cue");
    if (registered && typeof registered.play === "function") {
      try {
        registered.play();
      } catch (err) {
        console.error(`[YBAudio] Error in registered asset for date_presentation_cue:`, err);
      }
    }
    // Dedicated cue asset has not been provided. Remains silent without procedural fallback.
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
        gain.gain.setValueAtTime(gainLevel * 0.35, now);
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

      case "boot_power":
      case "boot_drive":
      case "paper_sheet_enter":
      case "paper_sheet_exit":
        // No dedicated audio asset provided. Remains silent without procedural fallback.
        break;

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

      case "facility_ambient": {
        // Standard facility ambience resolves strictly to silence until an authentic approved asset is provided.
        break;
      }

      case "lpmds_bed": {
        // Low mechanical low-frequency distortion bed from LPMDS
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(45, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(gainLevel * 0.14, now + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.72);
        break;
      }

      case "blast_door_release": {
        // Pneumatic pressure relief and solenoid latch
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(240, now);
        gain.gain.setValueAtTime(gainLevel * 0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.085);
        break;
      }

      case "blast_door_open": {
        // Heavy mechanical door motor and track travel
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(75, now);
        osc.frequency.linearRampToValueAtTime(115, now + 0.4);
        gain.gain.setValueAtTime(gainLevel * 0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.46);
        break;
      }

      case "blast_door_open_stop":
      case "blast_door_close_impact": {
        // Heavy steel contact thud / impact
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(hookId === "blast_door_close_impact" ? 55 : 70, now);
        gain.gain.setValueAtTime(gainLevel * 0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.19);
        break;
      }

      case "blast_door_close": {
        // Heavy mechanical door closure movement
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(115, now);
        osc.frequency.linearRampToValueAtTime(75, now + 0.4);
        gain.gain.setValueAtTime(gainLevel * 0.11, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.46);
        break;
      }

      case "complex_hum": {
        // 60Hz fluorescent transformer ballast buzz
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(60, now);
        gain.gain.setValueAtTime(gainLevel * 0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.62);
        break;
      }

      case "complex_music": {
        // Cold minimalist expedition sine chimes
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.4);
        gain.gain.setValueAtTime(gainLevel * 0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.82);
        break;
      }

      case "ui_toggle": {
        // Crisp selector snap
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(480, now);
        gain.gain.setValueAtTime(gainLevel * 0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
        break;
      }

      case "ui_panel_open":
      case "ui_panel_close": {
        // Sliding mechanical console latch
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hookId === "ui_panel_open" ? 360 : 480, now);
        osc.frequency.linearRampToValueAtTime(hookId === "ui_panel_open" ? 480 : 360, now + 0.05);
        gain.gain.setValueAtTime(gainLevel * 0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.065);
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
    if (!CONCEPTUAL_HOOKS.includes(hookId) && !EXTENDED_HOOKS.includes(hookId)) {
      console.warn(`[YBAudio] Unrecognized acoustic hook: ${hookId}`);
      return;
    }
    // Complex environmental ambience must never play while physically in Standard facility
    if (currentPhysicalEnvironment === "STANDARD" && (hookId === "complex_hum" || hookId === "complex_music")) {
      return;
    }
    hookCounts[hookId] = (hookCounts[hookId] || 0) + 1;
    const registered = assetRegistry.get(hookId);
    if (registered && typeof registered.play === "function") {
      try {
        registered.play(options);
        return;
      } catch (err) {
        console.error(`[YBAudio] Error in registered asset for ${hookId}:`, err);
        triggerProceduralFallback(hookId, options);
        return;
      }
    }
    const soundPath = DEFAULT_SOUND_MAP[hookId];
    if (soundPath && typeof global.Audio !== "undefined") {
      const played = playAudioFile(hookId, soundPath, options);
      if (played) return;
    }
    triggerProceduralFallback(hookId, options);
  }

  function emitThresholdActivation(options = {}) {
    emitHook("threshold_activation", { bus: AUDIO_BUSES.MACHINERY, ...options });
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
    DEFAULT_SOUND_MAP,
    configure,
    stopHook,
    stopAll,
    applyScene,
    startMenuMusic,
    stopMenuMusic,
    diagnostics,
    registerAsset,
    getRegisteredAsset,
    listRegisteredHooks,
    calculateSpatialAttenuation,
    computeEffectiveGain,
    emitHook,
    emitDatePresentationCue,
    emitThresholdActivation,
    playCameraClick,
    play
  });

  global.YBAudio = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window === "undefined" ? globalThis : window);
