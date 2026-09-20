/* Authored, presentation-only title flow. No world/session mutations. */
(function (global) {
  "use strict";
  function play({ mount, onComplete, reducedMotion = false, reducedSensory = false }) {
    mount.innerHTML = `<section class="title-card authored-title" data-testid="title-card" tabindex="0" role="button" aria-label="Voices of the Threshold. A Kane Pixels' Backrooms Simulacrum. Double-click to begin, or press Enter."><video class="title-video title-loop" src="../assets/video/voices-refined-loop-4k.mp4" muted playsinline loop preload="auto" aria-hidden="true"></video><video class="title-video title-transition" src="../assets/video/voices-vintage-crt-fast-4k.mp4" muted playsinline preload="auto" aria-hidden="true"></video><small class="title-begin-prompt">DOUBLE CLICK TO BEGIN</small></section>`;
    const card = mount.querySelector(".authored-title");
    const loop = card.querySelector(".title-loop");
    const transition = card.querySelector(".title-transition");
    let started = false;
    let finished = false;
    let watchdog;
    let revealTimer;
    const unload = video => { video.pause(); video.removeAttribute("src"); video.load(); };
    const detach = () => {
      global.removeEventListener("keydown", keydown, true);
      card.removeEventListener("dblclick", begin);
      global.clearTimeout(watchdog);
    };
    const cleanup = () => {
      detach();
      global.clearTimeout(revealTimer);
      unload(loop); unload(transition); card.remove();
    };
    const finish = async () => {
      if (finished) return;
      finished = true;
      detach();
      loop.pause(); transition.pause();
      // Keep the final CRT frame above the menu while its records load.
      card.classList.add("title-handoff");
      document.body.appendChild(card);
      try {
        await onComplete();
        if (reducedMotion || reducedSensory) { cleanup(); return; }
        card.classList.add("title-reveal-menu");
        revealTimer = global.setTimeout(cleanup, 240);
      } catch (error) { cleanup(); throw error; }
    };
    function begin(event) {
      event?.preventDefault();
      if (started || finished) return;
      started = true;
      card.classList.add("title-playing-transition");
      card.removeAttribute("role");
      loop.pause(); // Never wait for the current three-second cycle to end.
      if (reducedSensory || transition.error) { void finish(); return; }
      transition.currentTime = 0;
      watchdog = global.setTimeout(finish, 8000);
      transition.play().catch(finish);
    }
    function keydown(event) {
      if (event.repeat) return;
      if (event.key === "Escape" && started) {
        event.preventDefault(); event.stopImmediatePropagation();
        void finish();
      } else if (!started && ["Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        begin();
      }
    }
    transition.addEventListener("ended", finish);
    transition.addEventListener("error", () => { if (started) void finish(); });
    transition.addEventListener("playing", () => card.classList.add("title-transition-visible"));
    loop.muted = transition.muted = true;
    if (!reducedMotion && !reducedSensory) loop.play().catch(() => {});
    card.addEventListener("dblclick", begin);
    global.addEventListener("keydown", keydown, true);
    card.focus({ preventScroll: true });
    return { cancel() { finished = true; cleanup(); } };
  }
  global.YBTitlePlayer = { play };
})(window);
