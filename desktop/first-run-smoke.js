"use strict";

// Packaged first-run acceptance. Canonical writes happen only through controls
// reached by Chromium hit testing and Electron native input dispatch.
const assert = require("node:assert/strict");
const { app } = require("electron");
const { argumentValue } = require("./profile-resolver");

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function run(windowRef) {
  const phase = argumentValue(process.argv, "--first-run-phase");
  const expectedName = argumentValue(process.argv, "--world-name");
  assert.ok(["create", "reopen"].includes(phase), "first-run smoke requires create or reopen phase");
  assert.ok(expectedName && expectedName.length <= 80, "first-run smoke requires a runtime world name");

  const errors = [];
  windowRef.show();
  windowRef.focus();
  windowRef.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(`console:${message}`); });
  windowRef.webContents.on("render-process-gone", (_event, details) => errors.push(`render-process-gone:${details.reason}`));
  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));

  const evaluate = (source) => windowRef.webContents.executeJavaScript(source);
  const waitFor = async (selector, present = true) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (Boolean(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) === present) return true;
      await pause(25);
    }
    return false;
  };
  const probe = async (selector) => evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      connected: node.isConnected,
      width: rect.width,
      height: rect.height,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0,
      pointer: style.pointerEvents,
      inert: Boolean(node.closest("[inert]")),
      disabled: Boolean(node.disabled),
      ariaDisabled: node.getAttribute("aria-disabled"),
      topmost: top === node || node.contains(top),
      topTag: top?.tagName ?? null
    };
  })()`);
  const click = async (selector) => {
    const target = await probe(selector);
    assert.ok(target?.connected && target.width > 0 && target.height > 0 && target.visible, `not visible: ${selector}`);
    assert.equal(target.pointer, "auto", `pointer events blocked: ${selector}`);
    assert.equal(target.inert, false, `inert state blocked: ${selector}`);
    assert.equal(target.disabled, false, `disabled control: ${selector}`);
    assert.notEqual(target.ariaDisabled, "true", `aria-disabled control: ${selector}`);
    assert.equal(target.topmost, true, `another layer intercepts ${selector}; top=${target.topTag}`);
    const point = { x: Math.round(target.x), y: Math.round(target.y) };
    await windowRef.webContents.sendInputEvent({ type: "mouseMove", ...point });
    await windowRef.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    await windowRef.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await pause(100);
  };
  const type = async (selector, value) => {
    await click(selector);
    assert.equal(await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true, `input did not receive focus: ${selector}`);
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "CTRL" });
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "CTRL" });
    for (const character of value) {
      await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: character });
      await windowRef.webContents.sendInputEvent({ type: "char", keyCode: character });
      await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: character });
    }
    await pause(50);
  };
  const worlds = () => evaluate("window.yellowBeast.listWorlds()");
  const visibleWorlds = () => evaluate(`[...document.querySelectorAll(".worlds li[data-world-name]")].map((node) => ({ name: node.dataset.worldName, heading: node.querySelector("strong")?.textContent ?? "", hidden: node.hidden }))`);

  await click('[data-action="skip-boot"]');
  assert.equal(await waitFor('[data-testid="world-library"]'), true, "world library did not mount");

  if (phase === "create") {
    assert.equal((await worlds()).worlds.length, 0, "isolated first-run profile was not empty");
    assert.deepEqual(await visibleWorlds(), [], "empty profile displayed a seeded world");
    await click('[data-action="new"]');
    assert.equal(await waitFor('[data-testid="create-world"]'), true, "naming surface did not mount");
    const surface = await probe('[data-testid="create-world"]');
    assert.ok(surface?.visible && surface.topmost, "naming surface was not visible and topmost");
    const input = '#new-world input[name="name"]';
    const inputState = await probe(input);
    assert.ok(inputState?.visible && inputState.topmost, "visible name input was not topmost");
    await type(input, expectedName);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(input)})?.value`), expectedName, "visible input did not retain native keyboard text");
    assert.equal((await worlds()).worlds.length, 0, "world was created before deliberate confirmation");
    await click('#new-world [data-action="submit"]');
    assert.equal(await waitFor('[data-testid="create-world"]', false), true, "naming surface did not close");
    assert.equal(await waitFor('[data-testid="world-library"]'), true, "world library did not refresh after creation");
  }

  const persisted = await worlds();
  assert.equal(persisted.worlds.length, 1, `${phase} phase did not contain exactly one world`);
  assert.equal(persisted.worlds[0].name, expectedName, `${phase} phase loaded the wrong world name`);
  const visible = await visibleWorlds();
  assert.equal(visible.length, 1, `${phase} phase displayed the world more than once`);
  assert.deepEqual(visible[0], { name: expectedName, heading: expectedName, hidden: false });
  await click(`[data-action="world:${persisted.worlds[0].id}"]`);
  assert.equal(await waitFor('[data-testid="world-entry"]'), true, `${phase} phase could not open the persisted world`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="world-entry"] .eyebrow')?.textContent.includes(${JSON.stringify(expectedName)})`), true, `${phase} phase opened the wrong world`);
  await click('[data-action="mode:field-researcher"]');
  assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true, `${phase} phase could not open the created world's authorized program`);
  assert.deepEqual(errors, [], `renderer failures occurred during ${phase}`);

  console.log(JSON.stringify({ first_run_packaged_smoke: "passed", phase, world_id: persisted.worlds[0].id, world_name: expectedName, worlds: persisted.worlds.length, native_mouse: true, native_keyboard: true }, null, 2));
  await pause(50);
  app.quit();
}

module.exports = { run };
