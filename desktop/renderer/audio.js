"use strict";
(function (global) {
  let settings = { audio_muted: false, audio_master: 0.35, reduced_sensory: false };
  function configure(next = {}) { settings = { ...settings, ...next }; }
  function play(kind = "confirm") {
    if (settings.audio_muted || settings.reduced_sensory || settings.audio_master <= 0 || !global.AudioContext) return;
    try {
      const context = new global.AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
      const frequency = kind === "error" ? 180 : kind === "radio" ? 620 : kind === "threshold" ? 260 : 440;
      oscillator.frequency.value = frequency; gain.gain.setValueAtTime(Math.min(0.08, settings.audio_master * 0.2), context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.07);
      oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.08); oscillator.addEventListener("ended", () => context.close());
    } catch { /* audio is optional and never affects canonical state */ }
  }
  global.YBAudio = { configure, play };
})(typeof window === "undefined" ? globalThis : window);
