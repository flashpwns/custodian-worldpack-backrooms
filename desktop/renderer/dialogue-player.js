(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.YBDialoguePlayer = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let activeTimer = null;
  let activeElement = null;
  let fullTargetText = "";
  let currentIndex = 0;
  let onCompleteCallback = null;
  let typingState = false;

  const PUNCTUATION_PAUSES = {
    ",": 130,
    ";": 130,
    ":": 130,
    "—": 180,
    "-": 80,
    ".": 260,
    "!": 260,
    "?": 260,
    "\n": 200
  };

  function isFastMode() {
    const g = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : (typeof globalThis !== "undefined" ? globalThis : null));
    if (!g) return false;
    if (g.__YB_TEST_FAST_BOOT__ === true ||
        g.__YB_TEST_FAST_FADE__ === true ||
        g.__YB_TEST_FAST_DIALOGUE__ === true) {
      return true;
    }
    if (typeof g.matchMedia === "function" && g.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return true;
    }
    return false;
  }

  function cleanup() {
    if (activeTimer !== null) {
      if (typeof clearTimeout === "function") {
        clearTimeout(activeTimer);
      }
      activeTimer = null;
    }
    if (activeElement && activeElement.classList) {
      activeElement.classList.remove("dialogue-typing");
    }
    activeElement = null;
    fullTargetText = "";
    currentIndex = 0;
    typingState = false;
  }

  function isTyping() {
    return typingState;
  }

  function cancel() {
    cleanup();
    onCompleteCallback = null;
  }

  function finish() {
    if (!typingState && !activeElement) return;
    const el = activeElement;
    const text = fullTargetText;
    const cb = onCompleteCallback;

    cleanup();

    if (el && el.isConnected !== false) {
      el.textContent = text;
    }
    if (typeof cb === "function") {
      try {
        cb();
      } catch (err) {
        console.error("[YBDialoguePlayer] Error in onComplete callback:", err);
      }
    }
  }

  function step(options) {
    if (!typingState || !activeElement) return;

    // Detached DOM safeguard: abort cleanly without modifying detached nodes
    if (activeElement.isConnected === false) {
      cancel();
      return;
    }

    if (currentIndex >= fullTargetText.length) {
      const cb = onCompleteCallback;
      cleanup();
      if (typeof cb === "function") {
        try {
          cb();
        } catch (err) {
          console.error("[YBDialoguePlayer] Error in onComplete callback:", err);
        }
      }
      return;
    }

    currentIndex++;
    activeElement.textContent = fullTargetText.slice(0, currentIndex);

    if (typeof options.onChar === "function") {
      try {
        options.onChar(fullTargetText[currentIndex - 1], currentIndex);
      } catch (_) {}
    }

    if (currentIndex >= fullTargetText.length) {
      const cb = onCompleteCallback;
      cleanup();
      if (typeof cb === "function") {
        try {
          cb();
        } catch (err) {
          console.error("[YBDialoguePlayer] Error in onComplete callback:", err);
        }
      }
      return;
    }

    const nextChar = fullTargetText[currentIndex - 1];
    let delay = options.charDelay ?? 36;
    if (PUNCTUATION_PAUSES[nextChar]) {
      delay = PUNCTUATION_PAUSES[nextChar];
    }

    activeTimer = setTimeout(() => step(options), delay);
  }

  function type(element, text, options = {}) {
    cancel();

    if (!element || typeof text !== "string") {
      if (typeof options.onComplete === "function") options.onComplete();
      return;
    }

    // Fast mode / reduced-motion bypass: reveal instantly
    if (isFastMode()) {
      element.textContent = text;
      if (typeof options.onComplete === "function") {
        options.onComplete();
      }
      return;
    }

    activeElement = element;
    fullTargetText = text;
    currentIndex = 0;
    onCompleteCallback = options.onComplete ?? null;
    typingState = true;

    if (element.classList) {
      element.classList.add("dialogue-typing");
    }
    element.textContent = "";

    const initialDelay = options.initialDelay ?? 60;
    activeTimer = setTimeout(() => step(options), initialDelay);
  }

  return {
    type,
    finish,
    skip: finish,
    cancel,
    isTyping
  };
});
