"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cinematicRegistry = require("../desktop/shared/cinematic-registry");
const cinematicPlayer = require("../desktop/renderer/cinematic-player");

const VIDEO_DIR = path.join(__dirname, "../desktop/assets/video");

test("y107 — Authored video assets exist on disk with valid headers and expected scale", () => {
  const assets = [
    {
      file: "DateCardNewPlayerClip.mov",
      minBytes: 5 * 1024 * 1024,
      id: "DATE_CARD_JULY_1991"
    },
    {
      file: "IntroductoryVideoVotT.mov",
      minBytes: 100 * 1024 * 1024,
      id: "BRIEFING_INFORMATIONAL_VIDEO"
    },
    {
      file: "CrossingIntoTheComplex.mov",
      minBytes: 25 * 1024 * 1024,
      id: "THRESHOLD_CROSSING_ENTRY_4"
    }
  ];

  for (const item of assets) {
    const filePath = path.join(VIDEO_DIR, item.file);
    assert.ok(fs.existsSync(filePath), `Asset ${item.file} must exist in desktop/assets/video`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size >= item.minBytes, `Asset ${item.file} must be at least ${item.minBytes} bytes, got ${stat.size}`);

    // Verify QuickTime / MP4 container signature (ftyp atom in header)
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, 32, 0);
    fs.closeSync(fd);

    const ftyp = header.indexOf("ftyp");
    assert.ok(ftyp >= 0 && ftyp <= 16, `Asset ${item.file} must contain ftyp box (QuickTime / MP4)`);

    // Verify registry resolution
    const resolved = cinematicRegistry.getResolvedPath(item.id);
    assert.ok(resolved, `Registry must resolve path for ${item.id}`);
    assert.match(resolved, new RegExp(item.file), `Resolved path must point to ${item.file}`);
  }
});

test("y107 — Cinematic registry maps all 3 default authored assets and supports drop-in replacement", () => {
  assert.equal(cinematicRegistry.DEFAULT_AUTHORED_ASSETS.DATE_CARD_JULY_1991, "../assets/video/DateCardNewPlayerClip.mov");
  assert.equal(cinematicRegistry.DEFAULT_AUTHORED_ASSETS.BRIEFING_INFORMATIONAL_VIDEO, "../assets/video/IntroductoryVideoVotT.mov");
  assert.equal(cinematicRegistry.DEFAULT_AUTHORED_ASSETS.THRESHOLD_CROSSING_ENTRY_4, "../assets/video/CrossingIntoTheComplex.mov");

  const resolved = cinematicRegistry.getResolvedPath("DATE_CARD_JULY_1991");
  assert.equal(resolved, "../assets/video/DateCardNewPlayerClip.mov");
});

test("y107 — Reusable cinematic player completes naturally on timer or ended event", async () => {
  let completedReason = null;
  let completions = 0;

  const handle = cinematicPlayer.playCinematic({
    placeholderId: "DATE_CARD_JULY_1991",
    testFast: true,
    fastDurationMs: 25,
    onComplete: (reason) => {
      completedReason = reason;
      completions++;
    }
  });

  assert.equal(cinematicPlayer.getActiveCinematic(), handle);
  assert.equal(handle.isFinished(), false);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(completions, 1, "Natural completion must invoke onComplete exactly once");
  assert.equal(completedReason, "ended", "Completion reason must be 'ended'");
  assert.equal(handle.isFinished(), true, "Handle must report finished");
  assert.equal(cinematicPlayer.getActiveCinematic(), null, "Active cinematic reference must be cleared");
});

test("y107 — Hard Cinematic Input Law: ESC triggers immediate, idempotent skip with resource disposal", () => {
  // Mock window and document DOM environment
  const listeners = [];
  const fakeWindow = {
    addEventListener(event, fn, opts) {
      listeners.push({ event, fn, opts });
    },
    removeEventListener(event, fn, opts) {
      const idx = listeners.findIndex((l) => l.fn === fn && l.event === event);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  };

  const fakeVideo = {
    paused: false,
    src: "dummy.mov",
    pauseCount: 0,
    loadCount: 0,
    attributes: { src: "dummy.mov" },
    pause() {
      this.paused = true;
      this.pauseCount++;
    },
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "src") this.src = "";
    },
    load() {
      this.loadCount++;
    },
    addEventListener() {},
    removeEventListener() {}
  };

  let surfaceRemoved = false;
  const fakeSurface = {
    parentNode: {
      removeChild(child) {
        if (child === fakeSurface) surfaceRemoved = true;
      }
    },
    setAttribute() {},
    appendChild() {}
  };

  const fakeDoc = {
    createElement(tag) {
      if (tag === "section") return fakeSurface;
      if (tag === "video") return fakeVideo;
      return {
        setAttribute() {},
        appendChild() {},
        classList: { add() {} }
      };
    },
    getElementById() {
      return { appendChild() {} };
    }
  };

  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completedReason = null;
    let completions = 0;

    const handle = cinematicPlayer.playCinematic({
      placeholderId: "BRIEFING_INFORMATIONAL_VIDEO",
      videoSrc: "../assets/video/IntroductoryVideoVotT.mov",
      fallbackDurationMs: 100000,
      testFast: false,
      onComplete: (reason) => {
        completedReason = reason;
        completions++;
      }
    });

    assert.equal(handle.isFinished(), false);
    assert.equal(listeners.length, 1, "Must attach keydown capture listener");
    assert.equal(listeners[0].event, "keydown");
    assert.equal(listeners[0].opts?.capture, true, "Listener MUST use capture phase");

    // Simulate ESC press
    let prevented = false;
    let stoppedProp = false;
    let stoppedImmediate = false;

    const escEvent = {
      key: "Escape",
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stoppedProp = true; },
      stopImmediatePropagation: () => { stoppedImmediate = true; }
    };

    listeners[0].fn(escEvent);

    assert.equal(prevented, true, "ESC must call preventDefault()");
    assert.equal(stoppedProp, true, "ESC must call stopPropagation()");
    assert.equal(stoppedImmediate, true, "ESC must call stopImmediatePropagation() to prevent leakage");

    // Verify instant skip completion
    assert.equal(completions, 1, "Skip must invoke callback exactly once");
    assert.equal(completedReason, "skipped", "Reason must be 'skipped'");
    assert.equal(handle.isFinished(), true);

    // Verify audio and video disposal
    assert.equal(fakeVideo.pauseCount, 1, "Video must be paused immediately");
    assert.equal(fakeVideo.src, "", "Video src must be cleared");
    assert.equal(fakeVideo.loadCount, 1, "video.load() must be called to release decoders");
    assert.equal(surfaceRemoved, true, "Cinematic surface must be removed from DOM");

    // Verify listener removal
    assert.equal(listeners.length, 0, "Keydown listener must be removed synchronously");

    // Verify idempotency on repeated ESC
    listeners.forEach((l) => l.fn(escEvent));
    handle.finishCinematic("skipped");
    handle.skip();
    assert.equal(completions, 1, "Repeated skip calls must never double-invoke callback");

  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y107 — Race condition safety: simultaneous natural ended and ESC skip execute idempotently", () => {
  let completions = 0;
  let finalReason = null;

  const handle = cinematicPlayer.playCinematic({
    placeholderId: "THRESHOLD_CROSSING_ENTRY_4",
    testFast: false,
    onComplete: (reason) => {
      completions++;
      finalReason = reason;
    }
  });

  // Call ended and skip simultaneously
  handle.finishCinematic("ended");
  handle.skip();
  handle.finishCinematic("skipped");

  assert.equal(completions, 1, "Simultaneous completion events must only invoke onComplete once");
  assert.equal(finalReason, "ended", "First arriving event resolves the promise/callback");
  assert.equal(handle.isFinished(), true);
});

test("y107 — Skip affordance UI contains restrained 'ESC · SKIP' hint", () => {
  let createdHint = null;
  const fakeDoc = {
    createElement(tag) {
      const el = {
        tag,
        attributes: {},
        textContent: "",
        setAttribute(k, v) { this.attributes[k] = v; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        pause() {},
        load() {},
        appendChild(child) {
          if (child.className === "cinematic-skip-hint") {
            createdHint = child;
          }
        },
        parentNode: {
          removeChild() {}
        }
      };
      return el;
    },
    getElementById() {
      return { appendChild() {} };
    }
  };

  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = fakeDoc;

  try {
    const handle = cinematicPlayer.playCinematic({
      placeholderId: "DATE_CARD_JULY_1991",
      testFast: true,
      fastDurationMs: 10
    });

    assert.equal(createdHint, null, "No visible cinematic-skip-hint element may be created (removed per Beat 2.4)");

    handle.skip();
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y107 — Crossing cinematic is gated exclusively to successful CROSS action transition", () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Verify THRESHOLD_CROSSING_ENTRY_4 reference exists in renderer
  assert.match(rendererSource, /THRESHOLD_CROSSING_ENTRY_4/, "Renderer must reference THRESHOLD_CROSSING_ENTRY_4");

  // Verify transition condition requires leaving for FIELD_OPERATION
  assert.match(rendererSource, /prevPhase !== "FIELD_OPERATION" && nextPhase === "FIELD_OPERATION"/, "Crossing cinematic must trigger only when transitioning into FIELD_OPERATION");

  // Verify complex audio is delayed until completeTransition
  const submitTurnFn = rendererSource.slice(rendererSource.indexOf("async function submitTurn("), rendererSource.indexOf("function applyAcousticScene("));
  assert.match(submitTurnFn, /cinematicPlayer\.playCinematic/, "submitTurn must invoke playCinematic on crossing");
  assert.match(submitTurnFn, /completeTransition\(\)/, "completeTransition must be called on completion");
});

test("y107 — Cinematic Loudness Audit: Non-destructive playback gain compensation and master volume integration", () => {
  const YBAudio = require("../desktop/renderer/audio");

  // 1. Verify relative gain compensation constants
  assert.equal(cinematicPlayer.CINEMATIC_GAIN_COMPENSATION.DATE_CARD_JULY_1991, 1.0);
  assert.equal(cinematicPlayer.CINEMATIC_GAIN_COMPENSATION.BRIEFING_INFORMATIONAL_VIDEO, 0.55, "Introductory video must apply non-destructive gain compensation (~-5.2 dB)");
  assert.equal(cinematicPlayer.CINEMATIC_GAIN_COMPENSATION.THRESHOLD_CROSSING_ENTRY_4, 1.0);

  // 2. Verify effective volume computation with YBAudio master volume
  const defaultMaster = YBAudio.computeEffectiveGain(YBAudio.AUDIO_BUSES.MASTER, 1.0); // 0.35
  const dateCardVol = cinematicPlayer.computePlaybackVolume("DATE_CARD_JULY_1991");
  const introVol = cinematicPlayer.computePlaybackVolume("BRIEFING_INFORMATIONAL_VIDEO");
  const crossingVol = cinematicPlayer.computePlaybackVolume("THRESHOLD_CROSSING_ENTRY_4");

  assert.ok(Math.abs(dateCardVol - (defaultMaster * 1.0)) < 0.001);
  assert.ok(Math.abs(introVol - (defaultMaster * 0.55)) < 0.001);
  assert.ok(Math.abs(crossingVol - (defaultMaster * 1.0)) < 0.001);

  // 3. Verify volume applied to video element upon initialization
  let assignedVolume = null;
  let assignedMuted = null;
  const fakeDoc = {
    createElement(tag) {
      return {
        tag,
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        pause() {},
        load() {},
        appendChild() {},
        set volume(v) { assignedVolume = v; },
        get volume() { return assignedVolume; },
        set muted(m) { assignedMuted = m; },
        get muted() { return assignedMuted; }
      };
    },
    getElementById() {
      return { appendChild() {} };
    }
  };

  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = fakeDoc;

  try {
    const handle = cinematicPlayer.playCinematic({
      placeholderId: "BRIEFING_INFORMATIONAL_VIDEO",
      videoSrc: "../assets/video/IntroductoryVideoVotT.mov",
      testFast: true,
      fastDurationMs: 10
    });

    assert.ok(Math.abs(assignedVolume - introVol) < 0.001, "Video element volume must be calibrated with gain compensation");
    assert.equal(assignedMuted, false, "Video must not be muted under default settings");
    handle.skip();
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y107 — Date Card visual purity: authored video contains no redundant text overlay", () => {
  const appendedTags = [];
  const fakeSurface = {
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(child) {
      appendedTags.push(child.className || child.tag);
    },
    parentNode: { removeChild() {} }
  };

  const fakeDoc = {
    createElement(tag) {
      return {
        tag,
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        pause() {},
        load() {},
        appendChild() {}
      };
    },
    getElementById() {
      return { appendChild() {} };
    }
  };

  // Mock document to return fakeSurface for section
  fakeDoc.createElement = (tag) => {
    if (tag === "section") return fakeSurface;
    return {
      tag,
      className: "",
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute() {},
      addEventListener() {},
      removeEventListener() {},
      pause() {},
      load() {},
      appendChild() {}
    };
  };

  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = fakeDoc;

  try {
    const handle = cinematicPlayer.playCinematic({
      placeholderId: "DATE_CARD_JULY_1991",
      videoSrc: "../assets/video/DateCardNewPlayerClip.mov",
      overlayText: "JULY, 1991",
      testFast: true,
      fastDurationMs: 10
    });

    // Appended to surface should only be video element, NO skip hint, NO paragraph or text overlay
    assert.deepEqual(appendedTags, ["cinematic-video-element"], "Authored date card must contain only the video element");
    handle.skip();
  } finally {
    delete global.window;
    delete global.document;
  }
});
