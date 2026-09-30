"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cinematicPlayer = require("../desktop/renderer/cinematic-player");

function makeFakeDomEnv() {
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
  const fakeSurface = {
    parentNode: { removeChild() {} },
    setAttribute() {},
    appendChild() {}
  };
  const fakeDoc = {
    createElement(tag) {
      if (tag === "section") return fakeSurface;
      return { setAttribute() {}, appendChild() {}, classList: { add() {} } };
    },
    getElementById() {
      return { appendChild() {} };
    }
  };
  return { listeners, fakeWindow, fakeDoc };
}

function pressEscape(listeners) {
  const escEvent = {
    key: "Escape",
    preventDefault: () => {},
    stopPropagation: () => {},
    stopImmediatePropagation: () => {}
  };
  listeners.forEach((l) => l.fn(escEvent));
}

test("y166b — ESC skip is locked before local runtime readiness reports ready", () => {
  const { listeners, fakeWindow, fakeDoc } = makeFakeDomEnv();
  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completions = 0;
    let status = { ready: false, state: "starting" };
    const runtimeReadiness = { getStatus: () => status };

    const handle = cinematicPlayer.playCinematic({
      placeholderId: "THRESHOLD_CROSSING_ENTRY_4",
      testFast: false,
      fallbackDurationMs: 100000,
      runtimeReadiness,
      onComplete: () => { completions++; }
    });

    assert.equal(handle.isSkipAllowed(), false, "skip must be locked while runtime is not ready");

    pressEscape(listeners);
    assert.equal(completions, 0, "ESC must be swallowed while runtime is warming up");
    assert.equal(handle.isFinished(), false);

    // Now transition to ready.
    status = { ready: true, state: "ready" };
    assert.equal(handle.isSkipAllowed(), true, "skip must unlock immediately once ready() is true");

    pressEscape(listeners);
    assert.equal(completions, 1, "normal ESC skip must work immediately after READY");
    assert.equal(handle.isFinished(), true);
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y166b — terminal runtime failure unlocks ESC skip and preserves deterministic fallback flow", () => {
  const { listeners, fakeWindow, fakeDoc } = makeFakeDomEnv();
  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completions = 0;
    let completedReason = null;
    let status = { ready: false, state: "loading" };
    const runtimeReadiness = { getStatus: () => status };

    const handle = cinematicPlayer.playCinematic({
      placeholderId: "BRIEFING_INFORMATIONAL_VIDEO",
      testFast: false,
      fallbackDurationMs: 100000,
      runtimeReadiness,
      onComplete: (reason) => { completions++; completedReason = reason; }
    });

    pressEscape(listeners);
    assert.equal(completions, 0, "ESC must stay locked while runtime is still loading");

    // Runtime reaches terminal failure.
    status = { ready: false, state: "failed" };
    assert.equal(handle.isSkipAllowed(), true, "terminal failure must unlock ESC skip as a safety valve");

    pressEscape(listeners);
    assert.equal(completions, 1, "ESC must skip normally once runtime has terminally failed");
    assert.equal(completedReason, "skipped");
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y166b — bounded startup timeout unlocks ESC skip even if runtime never reports ready or failed", async () => {
  const { listeners, fakeWindow, fakeDoc } = makeFakeDomEnv();
  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completions = 0;
    const runtimeReadiness = { getStatus: () => ({ ready: false, state: "loading" }) };

    const handle = cinematicPlayer.playCinematic({
      placeholderId: "DATE_CARD_JULY_1991",
      testFast: false,
      fallbackDurationMs: 100000,
      runtimeReadiness,
      skipUnlockTimeoutMs: 20,
      onComplete: () => { completions++; }
    });

    pressEscape(listeners);
    assert.equal(completions, 0, "ESC must stay locked before the bounded timeout elapses");

    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(handle.isSkipAllowed(), true, "bounded startup timeout must unlock skip as a failure safety net");
    pressEscape(listeners);
    assert.equal(completions, 1, "ESC must skip normally once the startup timeout has elapsed");
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y166b — warm launch (already ready) unlocks skip immediately, no lock window", () => {
  const { listeners, fakeWindow, fakeDoc } = makeFakeDomEnv();
  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completions = 0;
    const runtimeReadiness = { getStatus: () => ({ ready: true, state: "ready" }) };

    const handle = cinematicPlayer.playCinematic({
      placeholderId: "THRESHOLD_CROSSING_ENTRY_4",
      testFast: false,
      fallbackDurationMs: 100000,
      runtimeReadiness,
      onComplete: () => { completions++; }
    });

    assert.equal(handle.isSkipAllowed(), true, "warm launch must unlock skip immediately");
    pressEscape(listeners);
    assert.equal(completions, 1, "ESC must skip immediately on a warm/subsequent launch");
  } finally {
    delete global.window;
    delete global.document;
  }
});

test("y166b — without runtimeReadiness, ESC skip behaves exactly as before (no gating)", () => {
  const { listeners, fakeWindow, fakeDoc } = makeFakeDomEnv();
  global.window = fakeWindow;
  global.document = fakeDoc;

  try {
    let completions = 0;
    const handle = cinematicPlayer.playCinematic({
      placeholderId: "THRESHOLD_CROSSING_ENTRY_4",
      testFast: false,
      fallbackDurationMs: 100000,
      onComplete: () => { completions++; }
    });

    assert.equal(handle.isSkipAllowed(), true);
    pressEscape(listeners);
    assert.equal(completions, 1);
  } finally {
    delete global.window;
    delete global.document;
  }
});
