"use strict";

// Packaged interaction probe. It uses Chromium hit testing and native input
// dispatch through webContents; DOM .click(), requestSubmit(), and synthetic
// KeyboardEvent are intentionally not used as acceptance substitutes.
const assert = require("node:assert/strict");
const { app } = require("electron");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(windowRef) {
  const errors = [];
  windowRef.show(); windowRef.focus();
  windowRef.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(`console:${message}`); });
  windowRef.webContents.on("render-process-gone", (_event, details) => errors.push(`render-process-gone:${details.reason}`));
  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));
  const waitFor = async (selector, present = true) => { for (let i = 0; i < 80; i += 1) { if (Boolean(await windowRef.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) === present) return true; await pause(25); } return false; };
  const rect = async (selector) => windowRef.webContents.executeJavaScript(`(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})]; const node=nodes.find(candidate => { const r=candidate.getBoundingClientRect(); const style=getComputedStyle(candidate); return r.width>0 && r.height>0 && style.display!=="none" && style.visibility!=="hidden" && (!candidate.closest("details:not([open])") || candidate.matches("details:not([open]) > summary")); }); if(!node) return null; const scrollables=()=>{ const found=[]; for (let parent=node.parentElement; parent; parent=parent.parentElement) { const style=getComputedStyle(parent); if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight>parent.clientHeight) found.push(parent); } return found; }; node.scrollIntoView({block:"nearest", inline:"nearest"}); for (const parent of scrollables()) { const nr=node.getBoundingClientRect(); const pr=parent.getBoundingClientRect(); if (nr.bottom>pr.bottom) parent.scrollTop += nr.bottom-pr.bottom+12; else if (nr.top<pr.top) parent.scrollTop -= pr.top-nr.top+12; } let r=node.getBoundingClientRect(); if (r.bottom>window.innerHeight || r.top<0) { node.scrollIntoView({block:"center", inline:"nearest"}); r=node.getBoundingClientRect(); } for (let i=0; i<5; i+=1) { const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); if (hit===node || node.contains(hit)) break; const parent=scrollables()[0]; if (!parent) break; const stickyBottom=node.closest(".settings-surface")?.querySelector(":scope > header")?.getBoundingClientRect().bottom ?? 0; if (r.top < stickyBottom + 8) node.scrollIntoView({block:"center", inline:"nearest"}); else parent.scrollTop += 96; r=node.getBoundingClientRect(); } const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,tag:node.tagName,disabled:node.disabled??false,pointer:getComputedStyle(node).pointerEvents,top:hit?.tagName,same:hit===node || node.contains(hit)}; })()`);
  const click = async (selector) => { const r = await rect(selector); if (!r) { const state = await windowRef.webContents.executeJavaScript(`({phase:document.querySelector('[data-testid="play-shell"]')?.dataset?.phase ?? null, actions:[...document.querySelectorAll('[data-game-action]')].map(node=>({action:node.dataset.gameAction,display:getComputedStyle(node).display,rect:(()=>{const box=node.getBoundingClientRect();return [box.width,box.height]})()})), body:document.body.innerText.slice(-1800)})`); assert.fail(`not hit-testable: ${selector} ${JSON.stringify(state)}`); } assert.equal(r.pointer, "auto", `pointer events blocked: ${selector}`); assert.notEqual(r.top, "BODY", `surface not attached: ${selector}`); assert.equal(r.same, true, `control is covered: ${selector} ${JSON.stringify(r)}`); const before = selector.includes("data-game-action") ? await windowRef.webContents.executeJavaScript("document.body.innerHTML") : null; await windowRef.webContents.sendInputEvent({ type:"mouseMove", x:Math.round(r.x), y:Math.round(r.y) }); await windowRef.webContents.sendInputEvent({ type:"mouseDown", x:Math.round(r.x), y:Math.round(r.y), button:"left", clickCount:1 }); await windowRef.webContents.sendInputEvent({ type:"mouseUp", x:Math.round(r.x), y:Math.round(r.y), button:"left", clickCount:1 }); if (before !== null) { let changed=false; for (let i=0; i<60; i+=1) { await pause(50); const after = await windowRef.webContents.executeJavaScript("document.body.innerHTML"); if (after !== before) { changed=true; break; } } assert.ok(changed, `native action did not produce a new render: ${selector} ${JSON.stringify(r)}`); } else await pause(80); return r; };
  const type = async (selector, value) => {
    await click(selector);
    // Native triple-click selects the input's complete text without relying
    // on menu accelerators that webContents key injection does not dispatch.
    const r = await rect(selector);
    for (const eventType of ["mouseDown", "mouseUp"]) await windowRef.webContents.sendInputEvent({ type:eventType, x:Math.round(r.x), y:Math.round(r.y), button:"left", clickCount:3 });
    await pause(40);
    const selection = await windowRef.webContents.executeJavaScript(`(() => { const input=document.querySelector(${JSON.stringify(selector)}); return [input.selectionStart,input.selectionEnd,input.value.length]; })()`);
    assert.deepEqual(selection.slice(0,2), [0,selection[2]], `native text selection failed: ${selector}`);
    for (const character of value) {
      await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:character });
      await windowRef.webContents.sendInputEvent({ type:"char", keyCode:character });
      await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:character });
    }
    await pause(30);
  };
  const waitForText = async (selector, text) => {
    for (let i=0;i<120;i++) {
      const value = await windowRef.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
      if (value.includes(text)) return value;
      await pause(50);
    }
    assert.fail(`Missing feedback at ${selector}: ${text}`);
  };
  const result = await windowRef.webContents.executeJavaScript(`(async () => { document.querySelector('[data-action="skip-boot"]')?.focus(); return { boot:document.activeElement?.dataset?.action ?? null }; })()`);
  await click('[data-action="skip-boot"]'); await waitFor('[data-testid="world-library"]');
  await click('[data-action="settings"]'); assert.equal(await waitFor('[data-testid="settings-surface"]'), true);
  const initialFocus = await windowRef.webContents.executeJavaScript("document.activeElement?.name ?? null");
  const controls = await windowRef.webContents.executeJavaScript("[...document.querySelector('#settings').querySelectorAll('input,select,button')].map(n=>({name:n.name||n.textContent.trim(),type:n.type||n.tagName,disabled:n.disabled}))");
  const settingsNonce = `settings-runtime-${Date.now()}`;
  await click('[data-provider-edit="groq"]');
  await type('#openai [name="model"]', settingsNonce);
  assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#openai [name=model]').value"), settingsNonce);
  await click('[data-provider-save-model]');
  await waitForText('#provider-manager-message', "Model saved");
  assert.equal((await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()")).settings.groq_model, settingsNonce);
  await click('[name="input_mode"]');
  await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"DOWN" });
  await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"DOWN" });
  await click('[name="theme"]');
  await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"DOWN" });
  await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"DOWN" });
  for (const setting of ["reduced_motion", "guided_introductions", "visual_rendering", "automatic_evidence_rendering", "retry_failed_renders"]) {
    const hit = await click(`[name="${setting}"]`);
    assert.equal(await waitFor('[data-testid="settings-surface"]'), true, `settings closed while toggling ${setting} at ${JSON.stringify(hit)}`);
  }
  await click('#settings button[type="submit"]');
  const saved = await waitForText('#settings-message', "saved and applied");
  const savedSettings = await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()");
  assert.equal(savedSettings.settings.groq_model, settingsNonce);
  await click('[data-action="close-settings"]');
  assert.equal(await waitFor('[data-testid="world-library"]'), true);
  await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:",", modifiers:["alt"] });
  await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:",", modifiers:["alt"] });
  assert.equal(await waitFor('[data-testid="settings-surface"]'), true);
  const persisted = await windowRef.webContents.executeJavaScript("({model:document.querySelector('[name=model]').value,theme:document.querySelector('[name=theme]').value})");
  assert.equal(persisted.model, settingsNonce);
  assert.match(saved, /saved and applied/i);

  // These are test-only keys in the launcher's isolated profile. Never send
  // them to a provider: this section proves native storage/menu interactions.
  for (const provider of ["groq", "gemini"]) {
    await click(`[data-provider-edit="${provider}"]`);
    await type('#openai [name="api_key"]', `native-fixture-${provider}-key`);
    await click('#openai [name="auto_after_save"]');
    await click('#openai button[type="submit"]');
    await waitForText('#provider-manager-message', `Key stored for ${provider}`);
    const entry = (await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()")).provider.entries.find(item => item.id === provider);
    assert.equal(entry.configured, true);
    assert.equal(entry.persistent, true, "native key was not encrypted and saved");
    assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#openai [name=api_key]').value"), "");
    assert.equal(await windowRef.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(`native-fixture-${provider}-key`)})`), false);
  }
  await click('[data-provider-delete="groq"]');
  await waitForText('#provider-manager-message', "Saved key deleted");
  const oneDeleted = await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()");
  assert.equal(oneDeleted.provider.groq.configured, false);
  assert.equal(oneDeleted.provider.gemini.configured, true, "deleting Groq changed Gemini");
  await click('[data-provider-delete="gemini"]');
  await waitForText('#provider-manager-message', "Saved key deleted");
  await click('[data-provider-auto]');
  await waitForText('#provider-manager-message', "AUTO fallback order enabled");
  await click('[data-action="close-settings"]');
  assert.equal(await waitFor('[data-testid="world-library"]'), true);
  await click('[data-action="about"]'); await pause(80); await click('[data-action="home"]'); assert.equal(await waitFor('[data-testid="world-library"]'), true);
  await click('[data-action="new"]'); assert.equal(await waitFor('[data-testid="create-world"]'), true);
  await type('#new-world input[name="name"]', `native-world-${Date.now()}`); await click('#new-world [data-action="submit"]'); assert.equal(await waitFor('[data-testid="world-entry"]'), true); const createdWorlds = await windowRef.webContents.executeJavaScript("window.yellowBeast.listWorlds()"); assert.equal(createdWorlds.worlds.length, 1); await click('[data-action="mode:field-researcher"]'); assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true);
  await type('#personnel-creation-form input[name="first_name"]', "native"); await type('#personnel-creation-form input[name="last_name"]', "probe"); await click('#personnel-creation-form button[type="submit"]'); const personnelCreated = await waitFor('[data-testid="q4-personnel-confirmation"]'); assert.equal(personnelCreated, true, await windowRef.webContents.executeJavaScript("JSON.stringify({body:document.body.innerText.slice(0,1200), first:document.querySelector('[name=first_name]')?.value, last:document.querySelector('[name=last_name]')?.value})"));
  await click('[data-action="personnel-confirm-continue"]'); assert.equal(await waitFor('[data-testid="play-shell"]'), true);
  await click('[data-game-action="READY"]'); await click('[data-game-action="PROCEED"]'); await click('[data-game-action="APPROACH"]'); await click('[data-game-action="READY"]'); assert.equal(await waitFor('#q4-comms-form'), true);
  const standardNonce = `standard-runtime-${Date.now()}`; const channel = await windowRef.webContents.executeJavaScript("document.querySelector('[data-testid=q4-channel]')?.value"); assert.equal(channel, "standard"); assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#q4-comms-form input[name=text]')?.value"), "");
  await type('#q4-comms-form input[name="text"]', standardNonce); await click('#q4-comms-form button[type="submit"]'); assert.equal(await waitFor(`[data-testid="q4-comms-form"]`), true); const standardResult = await windowRef.webContents.executeJavaScript(`({ exact:[...document.querySelectorAll('.communication-timeline li, .communication-timeline article')].some((node)=>node.textContent.includes(${JSON.stringify(standardNonce)})), awaiting:document.querySelector('[data-radio-state="awaiting-response"]')!==null })`); assert.equal(standardResult.exact, true); assert.equal(standardResult.awaiting, false); await click('[data-game-action="CROSS"]'); assert.equal(await waitFor('#natural-form'), true);
  await click('[data-testid="q4-channel"]'); await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"HOME" }); await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"HOME" }); await pause(30); const localNonce = `local-runtime-${Date.now()}`; await type('#q4-comms-form input[name="text"]', localNonce); await click('#q4-comms-form button[type="submit"]'); await pause(1000); const localResult = await windowRef.webContents.executeJavaScript(`({ exact:[...document.querySelectorAll('.communication-timeline li, .communication-timeline article')].some((node)=>node.textContent.includes(${JSON.stringify(localNonce)})), channel:document.querySelector('[data-testid=q4-channel]')?.value, body:document.body.innerText.slice(-1600) })`); assert.equal(localResult.exact, true, JSON.stringify(localResult));
  assert.equal(await waitFor('#natural-form'), true);
  const beforeNatural = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
  const communicationsBeforeNatural = beforeNatural.projection.q4.channels.standard.history.length + beforeNatural.projection.q4.channels.local.history.length;
  assert.equal(beforeNatural.projection.q4.current_location.name, "Utility Room");
  const naturalInput = `Move west action-runtime-${Date.now()}`;
  await type('#natural-form [name="text"]', naturalInput); await click('#natural-form button[type="submit"]');
  await waitForText('#interaction-feedback', "no world state changed");
  const failedProjection = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
  assert.equal(failedProjection.projection.q4.current_location.name, "Utility Room");
  assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#natural-form [name=text]').value"), naturalInput, "failed turn lost its draft");
  assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#natural-form button[type=submit]').disabled"), false);
  await click('.backend-menu > summary');
  await click('[data-action="settings"]');
  await click('#settings [name="provider"]');
  for (let i = 0; i < 6; i++) {
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"UP" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"UP" });
    await pause(20);
  }
  await windowRef.webContents.executeJavaScript("(() => { const sel = document.querySelector('#settings [name=\"provider\"]'); if (sel) { sel.value = 'offline'; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.blur(); } })()");
  await pause(50);
  await click('#settings button[type="submit"]');
  await waitForText('#settings-message', "saved and applied");
  await click('[data-action="close-settings"]');
  assert.equal(await waitFor('#natural-form'), true);
  assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#natural-form [name=text]').value"), naturalInput);
  await click('#natural-form button[type="submit"]');
  let afterNatural = null;
  for (let index = 0; index < 120; index += 1) {
    afterNatural = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
    if (afterNatural.projection.q4.current_location.name === "Columned Corridor") break;
    await pause(50);
  }
  const expectedNaturalLocation = "Columned Corridor"; // The observed WEST exit in both admitted layouts.
  assert.equal(afterNatural.projection.q4.current_location.name, expectedNaturalLocation, "player-authored natural movement did not change the visible field location");
  const communicationsAfterNatural = afterNatural.projection.q4.channels.standard.history.length + afterNatural.projection.q4.channels.local.history.length;
  assert.equal(communicationsAfterNatural, communicationsBeforeNatural, "natural movement was fabricated as player speech");
  assert.equal(await waitFor('#natural-form'), true, "natural input surface did not remain playable after movement");
  console.log(JSON.stringify({ packaged_input_probe:{boot:result.boot,initialFocus,controls:controls.length,settingsNonce,persisted,saved,errors} }, null, 2));
  assert.ok(initialFocus); assert.ok(controls.length >= 12); assert.equal(persisted.model, settingsNonce); assert.match(saved, /saved and applied/i); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ renderer_settings_smoke:"passed", packaged_native_input:"passed", provider_manager:"native_save_model_store_mask_delete_verified", provider_failure_retry:"draft_preserved_explicit_offline_retry", controls:controls.length }, null, 2)); await pause(20); app.exit(0);
}
module.exports = { run };
