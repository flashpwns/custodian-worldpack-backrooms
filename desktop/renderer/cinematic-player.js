(function (root, factory) {
  const player = factory();
  if (typeof module === "object" && module.exports) module.exports = player;
  root.YBCinematicPlayer = player;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /**
   * desktop/renderer/cinematic-player.js
   *
   * Hard Cinematic Input Law & Reusable Playback Contract:
   *
   * 1. Every non-interactive cinematic MUST be immediately skippable via ESC.
   * 2. ESC stops video and audio immediately, clears source, unloads media pipeline,
   *    removes DOM surface, and invokes deterministic completion callback:
   *    finishCinematic(reason = "ended" | "skipped").
   * 3. Capture-phase key handling (useCapture: true) with stopImmediatePropagation()
   *    to prevent leakage into newly revealed screens or Electron window handlers.
   * 4. Idempotent: multiple ESC presses or simultaneous ended+ESC must not cause races.
   * 5. Hard input law: ESC key skips immediately (visual prompt purged per Beat 2.4).
   * 6. Preserves natural completion if not skipped; exactly one invocation of onComplete per playback.
   * 7. Optional warmup gate (options.runtimeReadiness, a duck-typed object exposing
   *    getStatus() -> { ready, state }): while supplied and not ready, ESC is swallowed
   *    (still capture-phase, still stops propagation) instead of skipping, so the
   *    cinematic can serve as silent warmup time. The gate lifts the moment
   *    getStatus().ready is true, on getStatus().state === "failed" (terminal failure),
   *    or once a bounded options.skipUnlockTimeoutMs elapses — whichever comes first.
   *    Without options.runtimeReadiness, ESC skip behaves exactly as before.
   */

  let currentActiveCinematic = null;

  const CINEMATIC_GAIN_COMPENSATION = Object.freeze({
    DATE_CARD_JULY_1991: 1.0,
    BRIEFING_INFORMATIONAL_VIDEO: 0.55, // -5.2 dB non-destructive compensation to tame ~10.4 dB loudness jump and prevent clipping while preserving bolder broadcast dynamics
    THRESHOLD_CROSSING_ENTRY_4: 1.0
  });

  function computePlaybackVolume(placeholderId, customGain = 1.0) {
    let masterGain = 1.0;
    let isMuted = false;
    const audioModule = (typeof YBAudio !== "undefined")
      ? YBAudio
      : ((typeof window !== "undefined" && window.YBAudio)
      ? window.YBAudio
      : (typeof globalThis !== "undefined" && globalThis.YBAudio)
      ? globalThis.YBAudio
      : null);

    if (audioModule) {
      if (typeof audioModule.computeEffectiveGain === "function") {
        masterGain = audioModule.computeEffectiveGain(audioModule.AUDIO_BUSES?.MASTER ?? "master", 1.0);
      }
      if (typeof audioModule.diagnostics === "function") {
        const diag = audioModule.diagnostics();
        if (diag?.settings?.audio_muted) isMuted = true;
      }
    }
    if (isMuted || masterGain <= 0) return 0;
    const relativeGain = CINEMATIC_GAIN_COMPENSATION[placeholderId] ?? 1.0;
    return Math.max(0, Math.min(1.0, masterGain * relativeGain * customGain));
  }

  function getRegistry() {
    if (typeof window !== "undefined" && window.YBCinematicRegistry) {
      return window.YBCinematicRegistry;
    }
    if (typeof globalThis !== "undefined" && globalThis.YBCinematicRegistry) {
      return globalThis.YBCinematicRegistry;
    }
    if (typeof require !== "undefined") {
      try {
        return require("../shared/cinematic-registry");
      } catch {}
    }
    return null;
  }

  function playCinematic(options = {}) {
    const registry = getRegistry();
    const placeholderId = options.placeholderId;
    const placeholder = registry?.getPlaceholder ? registry.getPlaceholder(placeholderId) : null;

    // Resolve video source
    let resolvedVideo = options.videoSrc;
    if (!resolvedVideo && registry) {
      if (typeof registry.getResolvedPath === "function") {
        resolvedVideo = registry.getResolvedPath(placeholderId);
      } else if (placeholder?.asset_interface?.is_final) {
        resolvedVideo = placeholder.asset_interface.resolved_path;
      }
    }

    // Abort any existing active cinematic cleanly before starting a new one
    if (currentActiveCinematic) {
      try {
        currentActiveCinematic.skip();
      } catch (err) {
        console.error("Error skipping previous cinematic:", err);
      }
    }

    const doc = (typeof document !== "undefined") ? document : null;
    let container = options.container;
    if (!container && doc) {
      container = doc.getElementById("app") || doc.body;
    }

    // Fast-test detection
    const isFastTest = Boolean(
      options.testFast ||
      ((typeof window !== "undefined") && (
        window.__YB_TEST_FAST_DATE_CARD__ ||
        window.__YB_TEST_FAST_BRIEFING__ ||
        window.__YB_TEST_FAST_CROSSING__ ||
        window.__YB_TEST_FAST_FADE__
      ))
    );

    let finished = false;
    let fallbackTimer = null;
    let videoElement = null;
    let surfaceElement = null;

    // Warmup gate: absent options.runtimeReadiness, skip is always allowed
    // (unchanged behavior). When present, ESC is swallowed until ready,
    // terminally failed, or the bounded unlock timeout fires.
    const runtimeReadiness = (options.runtimeReadiness && typeof options.runtimeReadiness.getStatus === "function")
      ? options.runtimeReadiness
      : null;
    let skipUnlockTimer = null;
    let skipUnlockTimeoutElapsed = false;

    function isRuntimeReady() {
      try {
        const status = runtimeReadiness.getStatus();
        return Boolean(status && status.ready);
      } catch (err) {
        return true; // fail-open: never let an internal readiness error block skip
      }
    }

    function isRuntimeTerminallyFailed() {
      try {
        const status = runtimeReadiness.getStatus();
        return Boolean(status && status.state === "failed");
      } catch (err) {
        return true; // fail-open
      }
    }

    function skipAllowed() {
      if (!runtimeReadiness) return true;
      if (skipUnlockTimeoutElapsed) return true;
      if (isRuntimeTerminallyFailed()) return true;
      return isRuntimeReady();
    }

    function clearSkipUnlockTimer() {
      if (skipUnlockTimer !== null) {
        clearTimeout(skipUnlockTimer);
        skipUnlockTimer = null;
      }
    }

    if (runtimeReadiness && !isRuntimeReady()) {
      const skipUnlockTimeoutMs = options.skipUnlockTimeoutMs || 15000;
      skipUnlockTimer = setTimeout(() => {
        skipUnlockTimer = null;
        skipUnlockTimeoutElapsed = true;
      }, skipUnlockTimeoutMs);
    }

    function finishCinematic(reason = "ended") {
      if (finished) return;
      finished = true;

      // 1. Remove keyboard event listener synchronously (capture phase)
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("keydown", onKeyDown, { capture: true });
      }

      // 2. Clear timers
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      clearSkipUnlockTimer();

      // 3. Immediately halt audio and video, unload video pipeline
      if (videoElement) {
        try {
          videoElement.pause();
          videoElement.removeAttribute("src");
          if (typeof videoElement.load === "function") {
            videoElement.load();
          }
        } catch (e) {}
      }

      // 4. Remove surface from DOM
      if (surfaceElement && surfaceElement.parentNode) {
        try {
          surfaceElement.parentNode.removeChild(surfaceElement);
        } catch (e) {}
      }

      // 5. Clear global active reference
      if (currentActiveCinematic && currentActiveCinematic.finishCinematic === finishCinematic) {
        currentActiveCinematic = null;
      }

      // 6. Invoke deterministic completion callback
      if (typeof options.onComplete === "function") {
        try {
          options.onComplete(reason);
        } catch (err) {
          console.error("Error in cinematic onComplete:", err);
        }
      }
    }

    function onKeyDown(event) {
      if (!event) return;
      if (event.key === "Escape" || event.code === "Escape") {
        if (typeof event.preventDefault === "function") event.preventDefault();
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        if (!skipAllowed()) {
          // Warmup still in progress: swallow the key without skipping.
          return;
        }
        finishCinematic("skipped");
      }
    }

    // Attach capture-phase keydown listener
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("keydown", onKeyDown, { capture: true });
    }

    // Emit optional audio cue
    if (options.cueAudioHook && typeof YBAudio !== "undefined") {
      try {
        if (options.cueAudioHook === "date_presentation" && typeof YBAudio.emitDatePresentationCue === "function") {
          YBAudio.emitDatePresentationCue();
        } else if (typeof YBAudio.emitHook === "function") {
          YBAudio.emitHook(options.cueAudioHook);
        }
      } catch (err) {
        console.error("Error emitting cinematic audio hook:", err);
      }
    }

    // Build DOM surface if in DOM environment
    if (doc && container) {
      surfaceElement = doc.createElement("section");
      const surfaceClass = options.surfaceClass || "cinematic-surface";
      surfaceElement.className = surfaceClass;
      surfaceElement.setAttribute("data-testid", options.testId || "cinematic-surface");
      if (placeholderId) {
        surfaceElement.setAttribute("data-placeholder-id", placeholderId);
      }
      surfaceElement.setAttribute("tabindex", "-1");

      if (resolvedVideo) {
        const vid = doc.createElement("video");
        vid.className = options.videoClass || "cinematic-video-element";
        vid.src = resolvedVideo;
        vid.autoplay = true;
        vid.playsInline = true;
        if (typeof vid.setAttribute === "function") {
          vid.setAttribute("playsinline", "");
        }
        const effectiveVolume = computePlaybackVolume(placeholderId, options.gain ?? 1.0);
        vid.volume = effectiveVolume;
        vid.muted = effectiveVolume <= 0;
        videoElement = vid;

        if (typeof vid.addEventListener === "function") {
          vid.addEventListener("ended", () => {
            finishCinematic("ended");
          }, { once: true });

          vid.addEventListener("error", () => {
            // If video fails to load, gracefully fall back
            if (!finished) {
              const fallbackMs = isFastTest ? 50 : (options.fallbackDurationMs || 2000);
              fallbackTimer = setTimeout(() => finishCinematic("ended"), fallbackMs);
            }
          }, { once: true });
        }

        surfaceElement.appendChild(vid);
      } else {
        const placeholderDiv = doc.createElement("div");
        placeholderDiv.className = options.placeholderClass || "cinematic-placeholder-fallback";
        placeholderDiv.setAttribute("aria-label", options.placeholderLabel || "Cinematic playback");
        if (options.overlayText) {
          const p = doc.createElement("p");
          p.className = options.overlayClass || "opening-date-text";
          p.textContent = options.overlayText;
          placeholderDiv.appendChild(p);
        }
        surfaceElement.appendChild(placeholderDiv);
      }

      container.appendChild(surfaceElement);
    }

    // Set duration timer for fast tests or placeholder playback
    if (isFastTest) {
      const fastMs = options.fastDurationMs || (placeholderId === "DATE_CARD_JULY_1991" ? 100 : 50);
      fallbackTimer = setTimeout(() => {
        finishCinematic("ended");
      }, fastMs);
    } else if (!resolvedVideo) {
      const durationMs = options.fallbackDurationMs || (placeholderId === "DATE_CARD_JULY_1991" ? 10000 : 2000);
      fallbackTimer = setTimeout(() => {
        finishCinematic("ended");
      }, durationMs);
    }

    const cinematicHandle = {
      placeholderId,
      videoSrc: resolvedVideo,
      surfaceElement,
      videoElement,
      finishCinematic,
      skip: () => finishCinematic("skipped"),
      isFinished: () => finished,
      isSkipAllowed: () => skipAllowed()
    };

    currentActiveCinematic = cinematicHandle;
    return cinematicHandle;
  }

  function getActiveCinematic() {
    return currentActiveCinematic;
  }

  function skipActiveCinematic() {
    if (currentActiveCinematic) {
      currentActiveCinematic.skip();
      return true;
    }
    return false;
  }

  return {
    CINEMATIC_GAIN_COMPENSATION,
    computePlaybackVolume,
    playCinematic,
    getActiveCinematic,
    skipActiveCinematic
  };
});
