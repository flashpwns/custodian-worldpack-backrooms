"use strict";

// Runs inside the actual Electron renderer through BrowserWindow.webContents.
// This covers DOM creation, pointer/keyboard activation, focus, save, close,
// reopen, and persisted preference state; it is deliberately not a source
// pattern check.
const assert = require("node:assert/strict");
const { app } = require("electron");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(windowRef) {
  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));
  const result = await windowRef.webContents.executeJavaScript(`(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const waitFor = async (selector, present = true) => { for (let i = 0; i < 30; i += 1) { if (Boolean(document.querySelector(selector)) === present) return true; await pause(25); } return false; };
    document.querySelector('[data-action="skip-boot"]')?.click(); await pause(40);
    document.querySelector('[data-action="settings"]')?.click(); await pause(40);
    const form = document.querySelector('#settings'); const initialFocus = document.activeElement?.name;
    const controls = [...form.querySelectorAll('input, select, button')];
    const theme = form.querySelector('[name="theme"]'); theme.value = 'high-contrast'; theme.dispatchEvent(new Event('change', { bubbles:true }));
    const finalControl = controls.at(-1); finalControl?.focus(); finalControl?.scrollIntoView(); const reachedFinalControl = document.activeElement === finalControl || finalControl?.getBoundingClientRect().bottom <= window.innerHeight;
    form.requestSubmit(); await pause(40); const saved = document.querySelector('#settings-message')?.textContent;
    document.querySelector('[data-action="close-settings"]')?.click(); const closed = await waitFor('[data-testid="world-library"]');
    document.dispatchEvent(new KeyboardEvent('keydown', { key:',', altKey:true, bubbles:true })); const reopened = await waitFor('#settings');
    const settings = await window.yellowBeast.getSettings();
    return { form: Boolean(form), initialFocus, controls: controls.length, reachedFinalControl, saved, closed, reopened, theme: settings.settings.theme };
  })()`);
  console.log(JSON.stringify({ renderer_settings_probe: result }, null, 2)); assert.equal(result.form, true); assert.ok(result.initialFocus); assert.ok(result.controls >= 12); assert.match(result.saved, /saved and applied/i); assert.equal(result.closed, true); assert.equal(result.reopened, true); assert.equal(result.theme, "high-contrast");
  assert.equal(result.reachedFinalControl, true); console.log(JSON.stringify({ renderer_settings_smoke: "passed", controls: result.controls }, null, 2));
  await pause(10); app.exit(0);
}
module.exports = { run };
