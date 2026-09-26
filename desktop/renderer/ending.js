(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YBEnding = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const stages = Object.freeze([
    { id:"nonfunctional_threshold", duration:2200, text:"The Threshold is unresponsive." },
    { id:"coworker_panic", duration:1800, text:"The return route is severed. The team begins to panic." },
    { id:"aeot_power_failure", duration:800, text:"" },
    { id:"async_logo_display", duration:1800, text:"ASYNC" },
    { id:"newspaper_record", duration:12000, text:"" }
  ].map(Object.freeze));
  function markup(stage, record) {
    const placeholderAttr = stage.id === "nonfunctional_threshold" ? ' data-placeholder-id="CATASTROPHIC_THRESHOLD_FAILURE"' : "";
    const body = stage.id === "newspaper_record"
      ? `<article class="ending-newspaper" data-asset-id="ending.catastrophic.newspaper" data-placeholder-id="CATASTROPHIC_NEWSPAPER"><p class="ending-dateline">${escape(record.date)}</p><hr><h1>${escape(record.headline)}</h1><p>${escape(record.location)}</p></article>`
      : `<div class="ending-frame ending-${stage.id}"${placeholderAttr}><h1>${escape(stage.text)}</h1></div>`;
    return `<section class="terminal-ending" data-testid="catastrophic-ending" data-ending-stage="${stage.id}" aria-label="Final sequence"><div role="status" aria-live="polite">${body}</div><button type="button" data-ending-skip>${stage.id === "newspaper_record" ? "Return to title" : "Skip sequence"}</button></section>`;
  }
  function start({ element, record, complete, reducedMotion = false, schedule = setTimeout, unschedule = clearTimeout }) {
    let index = 0, timer = null, finished = false;
    function cancel() { if (timer !== null) unschedule(timer); timer = null; finished = true; }
    function finish() { if (finished) return; cancel(); complete(); }
    function draw() {
      if (finished) return;
      const stage = stages[index];
      element.innerHTML = markup(stage, record);
      const skip = element.querySelector("[data-ending-skip]");
      skip.addEventListener("click", finish, { once:true });
      skip.focus({ preventScroll:true });
      timer = schedule(() => { if (finished) return; if (++index === stages.length) finish(); else draw(); }, reducedMotion && index < 4 ? 250 : stage.duration);
    }
    draw();
    return { cancel, finish };
  }
  return { stages, markup, start };
});
