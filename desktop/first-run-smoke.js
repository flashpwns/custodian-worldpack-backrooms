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
  const waitFor = async (selector, present = true, maxAttempts = 160) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    let target;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      target = await probe(selector);
      if (target?.connected && target.visible && target.topmost) {
        await pause(60);
        const second = await probe(selector);
        if (second?.connected && second.visible && second.topmost && Math.abs(second.y - target.y) < 2 && Math.abs(second.x - target.x) < 2) {
          target = second;
          break;
        }
      }
      await pause(40);
    }
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
    // Use Chromium's native edit command after focus, avoiding moving-field
    // hit coordinates while the rejection shake is still animating.
    windowRef.webContents.selectAll();
    await pause(40);
    const selection = await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); return [input.selectionStart, input.selectionEnd, input.value.length]; })()`);
    assert.deepEqual(selection.slice(0, 2), [0, selection[2]], `native text selection failed: ${selector}`);
    for (const character of value) {
      await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: character });
      await windowRef.webContents.sendInputEvent({ type: "char", keyCode: character });
      await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: character });
    }
    await pause(50);
  };
  const worlds = () => evaluate("window.yellowBeast.listWorlds()");
  const visibleWorlds = () => evaluate(`[...document.querySelectorAll(".worlds li[data-world-name]")].map((node) => ({ name: node.dataset.worldName, heading: node.querySelector("strong")?.textContent ?? "", hidden: node.hidden }))`);

  assert.equal(await waitFor('[data-testid="cold-launch"]'), true, "cold launch surface did not mount");
  assert.equal(await waitFor('[data-testid="title-card"]'), true, "title card did not materialize after initialization");
  await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  await pause(150);
  if (!await evaluate('Boolean(document.querySelector("[data-testid=\\"world-library\\"]"))')) {
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  }
  assert.equal(await waitFor('[data-testid="world-library"]'), true, "world library did not mount");

  if (phase === "create") {
    assert.equal((await worlds()).worlds.length, 0, "isolated first-run profile was not empty");
    assert.deepEqual(await visibleWorlds(), [], "empty profile displayed a seeded world");
    await evaluate(`window.__YB_TEST_WORLD_NAME__ = ${JSON.stringify(expectedName)}`);
    await click('[data-action="new"]');
    assert.equal(await waitFor('[data-testid="world-entry"]'), true, "program selector did not open after creation");
  }

  const persisted = await worlds();
  assert.equal(persisted.worlds.length, 1, `${phase} phase did not contain exactly one world`);
  assert.equal(persisted.worlds[0].name, expectedName, `${phase} phase loaded the wrong world name`);
  if (phase === "create") {
    await click('[data-action="home"]');
    assert.equal(await waitFor('[data-testid="world-library"]'), true, "create phase could not return to records");
  }
  const visible = await visibleWorlds();
  assert.equal(visible.length, 1, `${phase} phase displayed the world more than once`);
  assert.deepEqual(visible[0], { name: expectedName, heading: expectedName, hidden: false });
  await click(`[data-action="world:${persisted.worlds[0].id}"]`);
  assert.equal(await waitFor('[data-testid="world-entry"]'), true, `${phase} phase could not open the persisted world`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="world-entry"] .eyebrow')?.textContent.includes(${JSON.stringify(expectedName)})`), true, `${phase} phase opened the wrong world`);
  await evaluate('window.__YB_TEST_FAST_DATE_CARD__ = true; window.__YB_TEST_FAST_BRIEFING__ = true;');
  await click('[data-action="mode:field-researcher"]');
  if (phase === "create") {
    assert.equal(await waitFor('[data-testid="opening-date-card"]'), true, "create phase did not show the July 1991 date card");
    await pause(50);
    // Non-interactive: spacebar does not skip
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
    assert.equal(await waitFor('[data-testid="introductory-video"]'), true, "create phase did not transition to introductory video");
    assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true, "create phase could not open the personnel waiver");
    const nameLimits = await windowRef.webContents.executeJavaScript("[...document.querySelectorAll('#personnel-creation-form input')].map(input => input.maxLength)");
    assert.deepEqual(nameLimits, [12, 12], "Both waiver name fields must enforce the beatmap limit");
    await evaluate('window.__waiverAudio = []; window.__waiverOriginalAudio = YBAudio; window.YBAudio = { ...YBAudio, emitHook(hook, ...args) { window.__waiverAudio.push(hook); return window.__waiverOriginalAudio.emitHook(hook, ...args); } }; void 0;');
    await type('#personnel-creation-form input[name="last_name"]', "123");
    await type('#personnel-creation-form input[name="first_name"]', "Fuck");
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"ENTER" });
    await windowRef.webContents.sendInputEvent({ type:"char", keyCode:"\r" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"ENTER" });
    assert.equal(await waitFor('#personnel-creation-form input.name-rejected'), true, `Waiver rejection missing: ${JSON.stringify(await evaluate('({text:document.body.innerText, rules:typeof YBNameRules, noValidate:document.querySelector("#personnel-creation-form")?.noValidate})'))}`);
    assert.equal(await evaluate('document.querySelectorAll("#personnel-creation-form input[aria-invalid=true]").length'), 2);
    assert.equal(await evaluate('Boolean(document.querySelector("[data-testid=q4-personnel-name-review]"))'), false);
    assert.equal(await evaluate('window.__waiverAudio.filter(hook => hook === "ui_error").length'), 1, 'Invalid submission emits one synchronized error sound');
    await evaluate('window.YBAudio = window.__waiverOriginalAudio; delete window.__waiverOriginalAudio; delete window.__waiverAudio');
    await type('#personnel-creation-form input[name="last_name"]', "Morgan");
    await type('#personnel-creation-form input[name="first_name"]', "Casey");
    await click('#personnel-creation-form button[type="submit"]');
    assert.equal(await waitFor('[data-testid="q4-personnel-name-review"]'), true, "permanent-name review did not open");
    assert.match(await evaluate(`document.querySelector('[data-testid="q4-personnel-name-review"] h1')?.textContent`), /Morgan[,\s]+Casey/i, "name review did not preserve Last, First ordering");
    await click('[data-action="personnel-file-back"]');
    assert.equal(await waitFor('#personnel-creation-form'), true);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#personnel-creation-form input")].map(input => input.value)'), ['Morgan', 'Casey'], 'Returning to the waiver preserves both editable names');
  } else {
    assert.equal(await waitFor('[data-testid="opening-date-card"]'), true, "reopen phase did not show the July 1991 date card");
    assert.equal(await waitFor('[data-testid="introductory-video"]'), true, "reopen phase did not transition to introductory video");
    assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true, "reopen phase could not open the personnel waiver");
  }
  assert.deepEqual(errors, [], `renderer failures occurred during ${phase}`);

  console.log(JSON.stringify({ first_run_packaged_smoke: "passed", phase, world_id: persisted.worlds[0].id, world_name: expectedName, worlds: persisted.worlds.length, native_mouse: true, native_keyboard: true }, null, 2));
  await pause(50);
  app.quit();
}

module.exports = { run };
