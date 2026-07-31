"use strict";
// Presentation preference helpers. They write only document attributes and
// never read or mutate a world projection.
(function (global) {
  const DEFAULTS = Object.freeze({ theme:"system", text_scale:"default", reduced_motion:false, guided_introductions:true });
  const SCALE = new Set(["small", "default", "large", "extra-large"]);
  const THEME = new Set(["system", "light", "dark", "high-contrast"]);
  const normalize = (settings = {}) => ({ ...DEFAULTS, ...settings, text_scale:SCALE.has(settings.text_scale) ? settings.text_scale : DEFAULTS.text_scale, theme:THEME.has(settings.theme) ? settings.theme : DEFAULTS.theme, reduced_motion:Boolean(settings.reduced_motion), guided_introductions:settings.guided_introductions !== false });
  function apply(document, settings) { const value = normalize(settings); const root = document.documentElement; root.dataset.textScale = value.text_scale; root.dataset.theme = value.theme; root.dataset.reducedMotion = String(value.reduced_motion); return value; }
  const api = { DEFAULTS, normalize, apply };
  global.YBAccessibility = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
