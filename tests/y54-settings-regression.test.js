"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");

test("Settings preferences save, close, reopen, and persist independently", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-settings-regression-"));
  const first = new DesktopService({ appDataPath: root });
  const saved = first.updateSettings({ settings: { theme: "high-contrast", text_scale: "extra-large", reduced_motion: true, guided_introductions: false, visual_rendering: false } });
  assert.equal(saved.ok, true);
  assert.deepEqual(first.getSettings().settings, { ...first.getSettings().settings, theme: "high-contrast", text_scale: "extra-large", reduced_motion: true, guided_introductions: false, visual_rendering: false });

  const reopened = new DesktopService({ appDataPath: root });
  assert.equal(reopened.getSettings().settings.theme, "high-contrast");
  assert.equal(reopened.getSettings().settings.text_scale, "extra-large");
  assert.equal(reopened.getSettings().settings.reduced_motion, true);
  assert.equal(reopened.getSettings().settings.guided_introductions, false);
  assert.equal(reopened.getSettings().settings.visual_rendering, false);
});

test("Settings renderer uses explicit controls and guards unavailable settings responses", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "renderer", "renderer.js"), "utf8");
  assert.match(source, /result\.provider\?\.openai\?\.configured/);
  assert.match(source, /if \(resultIsError\(result\) \|\| !result\.settings\)/);
  assert.match(source, /const control = \(name\) => form\.querySelector/);
  assert.doesNotMatch(source, /form\.input_mode|form\.provider|form\.theme|form\.text_scale/);
  assert.match(source, /form\.addEventListener\("submit"/);
  assert.match(source, /button\("Back", "home"\)/);
});
