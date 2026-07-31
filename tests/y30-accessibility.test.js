"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const accessibility = require("../desktop/renderer/accessibility");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const report = require("../tools/accessibility-report.js");

test("presentation preferences normalize and apply only document attributes", () => {
  const root = { dataset:{} }; const document = { documentElement:root };
  const applied = accessibility.apply(document, { theme:"high-contrast", text_scale:"extra-large", reduced_motion:true, guided_introductions:false });
  assert.equal(root.dataset.theme, "high-contrast"); assert.equal(root.dataset.textScale, "extra-large"); assert.equal(root.dataset.reducedMotion, "true"); assert.equal(applied.guided_introductions, false);
  assert.equal(accessibility.normalize({ theme:"invalid", text_scale:"giant" }).theme, "system");
});
test("preferences persist independently of a world's canonical summary and reset safely", () => {
  void report;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-accessibility-")); const service = new DesktopService({ appDataPath:root }); const world = service.createWorld({ name:"Accessible", seed:"accessible" }).world;
  const before = service.loadWorld({ world_id:world.id }).summary;
  const saved = service.updateSettings({ settings:{ theme:"high-contrast", text_scale:"extra-large", reduced_motion:true, guided_introductions:false } }); assert.ok(saved.ok);
  const reopened = new DesktopService({ appDataPath:root }); const settings = reopened.getSettings().settings;
  assert.equal(settings.theme, "high-contrast"); assert.equal(settings.text_scale, "extra-large"); assert.equal(settings.reduced_motion, true); assert.equal(settings.guided_introductions, false);
  assert.deepEqual(reopened.loadWorld({ world_id:world.id }).summary, before);
  assert.ok(reopened.updateSettings({ settings:{ theme:"system", text_scale:"default", reduced_motion:false, guided_introductions:true } }).ok);
  assert.deepEqual(reopened.loadWorld({ world_id:world.id }).summary, before);
});
test("all mode surfaces retain semantic player-safe content under accessibility presentation", () => {
  const service = new DesktopService({ appDataPath:fs.mkdtempSync(path.join(os.tmpdir(), "yb-access-modes-")) }); const world = service.createWorld({ name:"Modes", seed:"modes" }).world;
  for (const mode of ["field-researcher", "async-command", "local-anomaly", "lost"]) { const projection = service.startSession({ world_id:world.id, mode, seed:mode }).projection; const html = surfaces.render(projection); assert.doesNotMatch(html, /region-\d+|STORY THREAD|MYSTERY ID/i); if (mode === "lost") assert.doesNotMatch(html, /institution|objective|personnel|report|taxonomy/i); }
});
test("accessibility CSS provides bounded text scale, contrast, visible focus, and reduced motion", () => {
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/accessibility.css"), "utf8");
  for (const scale of ["small", "default", "large", "extra-large"]) assert.match(css, new RegExp(`data-text-scale=\\"${scale}\\"`));
  assert.match(css, /high-contrast/); assert.match(css, /focus-visible/); assert.match(css, /data-reduced-motion/); assert.match(css, /sr-only/);
});
test("renderer provides named primary input, bounded polite status, and keyboard safety", () => {
  const source = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8"); const index = fs.readFileSync(path.join(__dirname, "../desktop/renderer/index.html"), "utf8");
  assert.match(source, /aria-live="polite" aria-atomic="true"/); assert.match(source, /Current scene/); assert.match(source, /event.target.matches\("input, textarea, select, button"\)/); assert.match(source, /aria-pressed/);
  assert.doesNotMatch(index, /aria-live="polite"/); assert.match(index, /<main id="app">/);
});
