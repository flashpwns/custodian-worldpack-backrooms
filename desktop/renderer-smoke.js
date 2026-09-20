"use strict";

// Packaged interaction probe. It uses Chromium hit testing and native input
// dispatch through webContents; DOM .click(), requestSubmit(), and synthetic
// KeyboardEvent are intentionally not used as acceptance substitutes.
const assert = require("node:assert/strict");
const { app } = require("electron");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run(windowRef, service) {
  const errors = [];
  windowRef.show(); windowRef.focus();
  windowRef.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(`console:${message}`); });
  windowRef.webContents.on("render-process-gone", (_event, details) => errors.push(`render-process-gone:${details.reason}`));
  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));
  const waitFor = async (selector, present = true, maxAttempts = 160) => { for (let i = 0; i < maxAttempts; i += 1) { if (Boolean(await windowRef.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) === present) return true; await pause(25); } return false; };
  const rect = async (selector) => windowRef.webContents.executeJavaScript(`(() => { const nodes=[...document.querySelectorAll(${JSON.stringify(selector)})]; const node=nodes.find(candidate => { const r=candidate.getBoundingClientRect(); const style=getComputedStyle(candidate); return r.width>0 && r.height>0 && style.display!=="none" && style.visibility!=="hidden" && (!candidate.closest("details:not([open])") || candidate.matches("details:not([open]) > summary")); }); if(!node) return null; const scrollables=()=>{ const found=[]; for (let parent=node.parentElement; parent; parent=parent.parentElement) { const style=getComputedStyle(parent); if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight>parent.clientHeight) found.push(parent); } return found; }; node.scrollIntoView({block:"nearest", inline:"nearest"}); for (const parent of scrollables()) { const nr=node.getBoundingClientRect(); const pr=parent.getBoundingClientRect(); if (nr.bottom>pr.bottom) parent.scrollTop += nr.bottom-pr.bottom+12; else if (nr.top<pr.top) parent.scrollTop -= pr.top-nr.top+12; } let r=node.getBoundingClientRect(); if (r.bottom>window.innerHeight || r.top<0) { node.scrollIntoView({block:"center", inline:"nearest"}); r=node.getBoundingClientRect(); } for (let i=0; i<5; i+=1) { const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); if (hit===node || node.contains(hit)) break; const parent=scrollables()[0]; if (!parent) break; const stickyBottom=node.closest(".settings-surface")?.querySelector(":scope > header")?.getBoundingClientRect().bottom ?? 0; if (r.top < stickyBottom + 8) node.scrollIntoView({block:"center", inline:"nearest"}); else parent.scrollTop += 96; r=node.getBoundingClientRect(); } const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,tag:node.tagName,disabled:node.disabled??false,pointer:getComputedStyle(node).pointerEvents,top:hit?.tagName,topClass:hit?.className,hitHTML:hit?.outerHTML?.slice(0, 150),same:hit===node || node.contains(hit)}; })()`);
  const click = async (selector) => { const r = await rect(selector); if (!r) { const state = await windowRef.webContents.executeJavaScript(`({phase:document.querySelector('[data-testid="play-shell"]')?.dataset?.phase ?? null, actions:[...document.querySelectorAll('[data-game-action]')].map(node=>({action:node.dataset.gameAction,display:getComputedStyle(node).display,rect:(()=>{const box=node.getBoundingClientRect();return [box.width,box.height]})()})), body:document.body.innerText.slice(-1800)})`); assert.fail(`not hit-testable: ${selector} ${JSON.stringify(state)}`); } assert.equal(r.pointer, "auto", `pointer events blocked: ${selector}`); assert.notEqual(r.top, "BODY", `surface not attached: ${selector}`); assert.equal(r.same, true, `control is covered: ${selector} ${JSON.stringify(r)}`); const before = selector.includes("data-game-action") ? await windowRef.webContents.executeJavaScript("document.body.innerHTML") : null; await windowRef.webContents.sendInputEvent({ type:"mouseMove", x:Math.round(r.x), y:Math.round(r.y) }); await windowRef.webContents.sendInputEvent({ type:"mouseDown", x:Math.round(r.x), y:Math.round(r.y), button:"left", clickCount:1 }); await windowRef.webContents.sendInputEvent({ type:"mouseUp", x:Math.round(r.x), y:Math.round(r.y), button:"left", clickCount:1 }); if (before !== null) { let changed=false; for (let i=0; i<60; i+=1) { await pause(50); const after = await windowRef.webContents.executeJavaScript("document.body.innerHTML"); if (after !== before) { changed=true; break; } } assert.ok(changed, `native action did not produce a new render: ${selector} ${JSON.stringify(r)}`); } else await pause(80); return r; };
  const hold = async (selector, milliseconds) => { const r = await rect(selector); assert.ok(r?.same && !r.disabled, `not holdable: ${selector} ${JSON.stringify(r)}`); const point = { x:Math.round(r.x), y:Math.round(r.y) }; await windowRef.webContents.sendInputEvent({ type:"mouseMove", ...point }); await windowRef.webContents.sendInputEvent({ type:"mouseDown", ...point, button:"left", clickCount:1 }); await pause(milliseconds); await windowRef.webContents.sendInputEvent({ type:"mouseUp", ...point, button:"left", clickCount:1 }); await pause(150); };
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
  assert.equal(await waitFor('[data-testid="cold-launch"]'), true, "cold launch surface did not mount");
  assert.equal(await waitFor('[data-testid="title-card"]'), true, "title card did not materialize");
  const result = { boot:"title-card" };
  let titleAudio;
  for (let attempt = 0; attempt < 60; attempt++) {
    titleAudio = await windowRef.webContents.executeJavaScript("YBAudio.diagnostics()");
    const music = titleAudio.playback.find(item => item.hook === "menu_music");
    if (titleAudio.menu.track && (!titleAudio.menu.available || (music && !music.paused && music.ready_state >= 2 && music.current_time > 0))) break;
    await pause(100);
  }
  assert.ok(titleAudio.menu.track, "The application must select one weighted menu slot");
  if (titleAudio.menu.available) {
    const music = titleAudio.playback.find(item => item.hook === "menu_music");
    assert.ok(music && !music.paused && music.ready_state >= 2 && music.current_time > 0, `Packaged menu recording must decode and advance: ${JSON.stringify(titleAudio)}`);
    assert.equal(music.room_filter_nodes, 6, "Menu recording must pass through the distant-room graph");
  }
  result.title_audio = titleAudio;

  await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"SPACE" });
  await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"SPACE" });
  await pause(150);
  if (!await windowRef.webContents.executeJavaScript('Boolean(document.querySelector("[data-testid=\\"world-library\\"]"))')) {
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"SPACE" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"SPACE" });
  }
  await waitFor('[data-testid="world-library"]');
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
  const localNonce = `qwen-local-fixture-${Date.now()}:9b`;
  const localOption = await windowRef.webContents.executeJavaScript("(() => { const option=document.querySelector('#settings [name=provider] option[value=local]'); return { present:Boolean(option), disabled:Boolean(option?.disabled) }; })()");
  assert.deepEqual(localOption, { present:true, disabled:false });
  await type('#settings [name="local_model"]', localNonce);
  await click('[data-provider-use-local]');
  assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#settings [name=provider]').value"), "local");
  await click('#settings button[type="submit"]'); await waitForText('#settings-message', "saved and applied");
  const localSaved = await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()");
  assert.equal(localSaved.settings.provider, "local");
  assert.equal(localSaved.settings.local_model, localNonce);

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
  await click('[data-action="new"]'); assert.equal(await waitFor('[data-testid="world-entry"]'), true); const createdWorlds = await windowRef.webContents.executeJavaScript("window.yellowBeast.listWorlds()"); assert.equal(createdWorlds.worlds.length, 1);
  await windowRef.webContents.executeJavaScript('window.__YB_TEST_FAST_DATE_CARD__ = true; window.__YB_TEST_FAST_BRIEFING__ = true; window.__YB_TEST_FAST_BOOT__ = true;');
  await click('[data-action="mode:field-researcher"]'); assert.equal(await waitFor('[data-testid="opening-date-card"]'), true);
  assert.equal(await waitFor('[data-testid="introductory-video"]'), true);
  assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true);
  await type('#personnel-creation-form input[name="last_name"]', "probe"); await type('#personnel-creation-form input[name="first_name"]', "native"); await click('#personnel-creation-form button[type="submit"]'); const personnelCreated = await waitFor('[data-testid="q4-personnel-name-review"]'); assert.equal(personnelCreated, true, await windowRef.webContents.executeJavaScript("JSON.stringify({body:document.body.innerText.slice(0,1200), first:document.querySelector('[name=first_name]')?.value, last:document.querySelector('[name=last_name]')?.value})"));
  await click('[data-action="personnel-file-confirm"]'); assert.equal(await waitFor('[data-testid="aeot-initialization"]'), true); assert.equal(await waitFor('[data-testid="play-shell"]'), true);
  assert.equal(await waitFor('.eti-turn-controls.eti-cold-boot-energized'), true, "AEOT controls did not energize after cold boot");
  assert.equal(await waitFor('body:not([data-boot-locked])'), true, "Cold boot lock was not released");
  if (process.argv.includes("--day1-opener")) {
    assert.equal(await waitFor('[data-testid="opener-presentation"]'), true, "Day 1 opener presentation did not reach the native UI");
    const openerText = await windowRef.webContents.executeJavaScript("document.querySelector('[data-testid=opener-presentation]')?.innerText ?? ''");
    assert.match(openerText, /JULY 17, 1991/);
    assert.match(openerText, /DR\. KIRK MAXWELL/);
    assert.match(openerText, /Good morning, Q4 assignees/);
    assert.equal(await waitFor('[data-action="release-briefing-feed"]'), true, "Feed release button not found");
    await click('[data-action="release-briefing-feed"]');
  }
  await click('[data-game-action="READY"]');
  if (process.argv.includes("--day1-opener")) {
    assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#q4-comms-form input[name=text]')?.disabled"), true, "ESD handoff must pause dialogue only at the player-input layer");
  }
  await click('[data-game-action="PROCEED"]'); await click('[data-game-action="APPROACH"]'); await click('[data-game-action="READY"]'); assert.equal(await waitFor('#q4-comms-form'), true);
  if (process.argv.includes("--day1-opener")) {
    await hold('[data-q4-check-in="true"]', 2200);
    assert.equal(await waitFor('[data-game-action="CROSS"]'), true, "Formal check-in did not unlock the Threshold crossing");
  }
  const channel = await windowRef.webContents.executeJavaScript("document.querySelector('[data-testid=q4-channel]')?.value"); assert.equal(channel, "standard"); assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#q4-comms-form input[name=text]')?.value"), "");
  if (process.argv.includes("--day1-opener")) {
    assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#q4-comms-form input[name=text]')?.disabled"), true, "STANDARD input must remain unavailable during LOCAL-only introductions");
    await click('[data-game-action="CROSS"]'); assert.equal(await waitFor('#natural-form'), true);
  } else {
    const standardNonce = `standard-runtime-${Date.now()}`; await type('#q4-comms-form input[name="text"]', standardNonce); await click('#q4-comms-form button[type="submit"]'); await waitForText('.communication-timeline', standardNonce); const standardResult = await windowRef.webContents.executeJavaScript(`({ exact:[...document.querySelectorAll('.communication-timeline li, .communication-timeline article')].some((node)=>node.textContent.includes(${JSON.stringify(standardNonce)})), awaiting:document.querySelector('[data-radio-state="awaiting-response"]')!==null })`); assert.equal(standardResult.exact, true); assert.equal(standardResult.awaiting, false); await click('[data-game-action="CROSS"]'); assert.equal(await waitFor('#natural-form'), true);
  }
  const postCrossProjection = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
  assert.equal(postCrossProjection.projection.acoustic_scene.phase_id, "FIELD_OPERATION");
  assert.equal(postCrossProjection.projection.acoustic_scene.ambient_loop, "complex_hum");
  const fieldAudio = await windowRef.webContents.executeJavaScript("YBAudio.diagnostics()");
  assert.ok(fieldAudio.active_loops.includes("complex_hum"));
  assert.ok(!fieldAudio.active_loops.includes("facility_ambient"));
  assert.ok(!fieldAudio.active_loops.includes("lpmds_bed"));
  assert.ok(!fieldAudio.active_loops.includes("threshold_cross_hum"));
  assert.equal(fieldAudio.menu.track, titleAudio.menu.track);
  assert.equal(fieldAudio.menu.wanted, false);
  result.field_audio = fieldAudio;
  let selectedLocalTarget = { value:"" };
  let localMessageNonce = `local-runtime-${Date.now()}`;
  await click('[data-testid="q4-channel"]'); await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"HOME" }); await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"HOME" }); await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"ENTER" }); await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"ENTER" }); await pause(30);
  assert.equal(await waitFor('[data-testid="q4-comms-target"]'), true, "LOCAL recipient selector was not rendered");
  const targetKey = await windowRef.webContents.executeJavaScript("document.querySelector('[data-testid=q4-comms-target]')?.options?.[1]?.value?.[0] ?? ''");
  assert.ok(targetKey, "LOCAL recipient selector had no coworker option");
  await click('[data-testid="q4-comms-target"]'); await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:targetKey }); await windowRef.webContents.sendInputEvent({ type:"char", keyCode:targetKey }); await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:targetKey }); await pause(30);
  selectedLocalTarget = await windowRef.webContents.executeJavaScript("(() => { const node=document.querySelector('[data-testid=q4-comms-target]'); return { value:node?.value ?? '', disabled:Boolean(node?.disabled), options:[...(node?.options ?? [])].map(option => option.value), channel:document.querySelector('[data-testid=q4-channel]')?.value ?? '' }; })()");
  assert.ok(selectedLocalTarget.value, `Native recipient selection did not choose a coworker: ${JSON.stringify(selectedLocalTarget)}`);
  localMessageNonce = `local-runtime-${Date.now()}`; await type('#q4-comms-form input[name="text"]', localMessageNonce); await click('#q4-comms-form button[type="submit"]'); await waitForText('.communication-timeline', localMessageNonce); const localResult = await windowRef.webContents.executeJavaScript(`({ exact:[...document.querySelectorAll('.communication-timeline li, .communication-timeline article')].some((node)=>node.textContent.includes(${JSON.stringify(localMessageNonce)}) && node.textContent.includes(${JSON.stringify(" → ")})), channel:document.querySelector('[data-testid=q4-channel]')?.value, body:document.body.innerText.slice(-1600) })`); assert.equal(localResult.exact, true, JSON.stringify(localResult));
  assert.equal(await waitFor('#natural-form'), true);
  const beforeNatural = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
  const communicationsBeforeNatural = beforeNatural.projection.q4.channels.standard.history.length + beforeNatural.projection.q4.channels.local.history.length;
  assert.equal(beforeNatural.projection.q4.current_location.name, "Utility Room");
  if (process.argv.includes("--day1-opener")) {
    // Beat 7: Navigate along green tape into intermediate corridor and forward to Outpost A
    await type('#natural-form [name="text"]', "move east");
    await click('#natural-form button[type="submit"]');
    let atCorridor = null;
    for (let i = 0; i < 120; i++) {
      atCorridor = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (atCorridor.projection.q4.current_location.id?.startsWith("corridor")) break;
      await pause(50);
    }
    assert.ok(atCorridor.projection.q4.current_location.id?.startsWith("corridor"), "Did not reach corridor");

    await type('#natural-form [name="text"]', "move forward");
    await click('#natural-form button[type="submit"]');
    let atOutpost = null;
    for (let i = 0; i < 120; i++) {
      atOutpost = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (atOutpost.projection.q4.current_location.id === "outpost-a") break;
      await pause(50);
    }
    assert.equal(atOutpost.projection.q4.current_location.id, "outpost-a", "Did not reach outpost-a");

    // Beat 7 delivery: Deliver startup materials duffle at Outpost A
    await type('#natural-form [name="text"]', "deliver startup duffle");
    await click('#natural-form button[type="submit"]');
    let delivered = null;
    for (let i = 0; i < 120; i++) {
      delivered = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (delivered.projection.q4.day1_opener?.delivery_completed) break;
      await pause(50);
    }
    assert.equal(delivered.projection.q4.day1_opener?.delivery_completed, true, "Duffle delivery was not verified");

    // Beat 8: Retrace back to KV31 (threshold-side-entry)
    await type('#natural-form [name="text"]', "move back");
    await click('#natural-form button[type="submit"]');
    await pause(100);
    await type('#natural-form [name="text"]', "move west");
    await click('#natural-form button[type="submit"]');
    await pause(100);
    await type('#natural-form [name="text"]', "move to threshold-side-entry");
    await click('#natural-form button[type="submit"]');
    let atKV31 = null;
    for (let i = 0; i < 120; i++) {
      atKV31 = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (atKV31.projection.q4.current_location.id === "threshold-side-entry") break;
      await pause(50);
    }
    assert.equal(atKV31.projection.q4.current_location.id, "threshold-side-entry", "Did not reach threshold-side-entry");

    // Beat 9: Initiate RETURN phase
    await type('#natural-form [name="text"]', "begin return");
    await click('#natural-form button[type="submit"]');
    let inReturn = null;
    for (let i = 0; i < 120; i++) {
      inReturn = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (inReturn.projection.phase.phase_id === "RETURN") break;
      await pause(50);
    }
    assert.equal(inReturn.projection.phase.phase_id, "RETURN", "Did not enter RETURN phase");

    // Beat 9 surveillance: Transmit radio message to verify return surveillance
    await windowRef.webContents.executeJavaScript(`window.yellowBeast.submitQ4Communication({
      world_id: ${JSON.stringify(createdWorlds.worlds[0].id)},
      channel: "standard",
      text: "Clear-Q4 team returned to KV31. Outpost A delivery completed."
    })`);
    let surveillance = null;
    for (let i = 0; i < 120; i++) {
      surveillance = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (surveillance.projection.q4.day1_opener?.return_surveillance_verified) break;
      await pause(50);
    }
    assert.equal(surveillance.projection.q4.day1_opener?.return_surveillance_verified, true, "Surveillance verification failed");

    // Beat 9 completion: Complete return to enter REPORT phase
    await type('#natural-form [name="text"]', "complete return");
    await click('#natural-form button[type="submit"]');
    let inReport = null;
    for (let i = 0; i < 120; i++) {
      inReport = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (inReport.projection.phase.phase_id === "REPORT") break;
      await pause(50);
    }
    assert.equal(inReport.projection.phase.phase_id, "REPORT", "Did not enter REPORT phase");
    assert.equal(await waitFor('textarea[name="text"]'), true, "Written report textarea not rendered in REPORT phase");

    // Beat 10: Submit Written Expedition Report via UI to enter DEBRIEF phase
    const writtenAccount = "Field Expedition CQ4-DAY1-001 Official Observer Report: Staged at 10:00 and crossed into KV31. Guidance tape observed intact along Bermuda Access Corridor. Startup materials duffle delivered and secured at Outpost A. Completed return under standard surveillance.";
    await type('#natural-form textarea[name="text"]', writtenAccount);
    await click('#natural-form button[type="submit"]');

    let inDebrief = null;
    for (let i = 0; i < 120; i++) {
      inDebrief = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
      if (inDebrief.projection.phase.phase_id === "DEBRIEF") break;
      await pause(50);
    }
    assert.equal(inDebrief.projection.phase.phase_id, "DEBRIEF", "Did not enter DEBRIEF phase");

    // Assert End-of-Shift Notice card in DOM
    assert.equal(await waitFor('[data-testid="end-of-shift-notice"]'), true, "End-of-Shift Notice card not mounted in DOM");
    const noticeText = await windowRef.webContents.executeJavaScript("document.querySelector('[data-testid=end-of-shift-notice]')?.innerText ?? ''");
    assert.match(noticeText, /END OF SHIFT/);
    assert.match(noticeText, /JULY 17, 1991/);
    assert.match(noticeText, /EXPEDITION RECORD COMMITTED/);
    assert.match(noticeText, /NO FURTHER ASSIGNMENT ISSUED/);
    assert.match(noticeText, /AEOT RECORDS REMAIN AVAILABLE/);

    // Assert AEOT inspection surface with all 6 views and interactive tab switching
    assert.equal(await waitFor('[data-testid="aeot-inspection-surface"]'), true, "AEOT inspection surface not mounted");
    assert.equal(await waitFor('[data-testid="aeot-inspection-tabs"]'), true, "AEOT inspection tabs not mounted");

    const expectedViews = ["report", "personnel", "evidence", "photographs", "map", "institutional_records"];
    for (const viewId of expectedViews) {
      const tabSelector = `[data-aeot-view="${viewId}"]`;
      const panelSelector = `[data-testid="aeot-view-${viewId}"]`;
      assert.equal(await waitFor(tabSelector), true, `Tab ${tabSelector} not found`);
      assert.equal(await waitFor(panelSelector), true, `Panel ${panelSelector} not found`);
      await click(tabSelector);
      const isVisible = await windowRef.webContents.executeJavaScript(`(() => {
        const p = document.querySelector(${JSON.stringify(panelSelector)});
        return p && getComputedStyle(p).display !== "none";
      })()`);
      assert.equal(isVisible, true, `Panel ${panelSelector} not visible after clicking tab`);
    }

    // UI-driven report PDF export
    assert.equal(await waitFor('[data-testid="button-export-report-pdf"]'), true, "Export Report PDF button not found");
    await click('[data-testid="button-export-report-pdf"]');
    const feedback = await waitForText('#interaction-feedback', "Report exported to");
    assert.match(feedback, /Report exported to (.+\.pdf)/i);
    const pdfPath = feedback.replace(/^.*Report exported to\s+/i, "").trim();
    const fsMod = require("node:fs");
    assert.equal(fsMod.existsSync(pdfPath), true, `Exported PDF does not exist at ${pdfPath}`);
    const pdfBytes = fsMod.readFileSync(pdfPath);
    assert.ok(pdfBytes.length > 1000, `PDF size too small: ${pdfBytes.length} bytes`);
    assert.equal(pdfBytes.slice(0, 8).toString("latin1"), "%PDF-1.4", "PDF header invalid");

    // Validate quit/relaunch persistence
    const reloaded = await windowRef.webContents.executeJavaScript(`window.yellowBeast.resumeSession({ world_id: ${JSON.stringify(createdWorlds.worlds[0].id)}, mode: "field-researcher" })`);
    assert.equal(reloaded.ok, true, "resumeSession after debrief failed");
    assert.equal(reloaded.projection.phase.phase_id, "DEBRIEF");
    assert.equal(reloaded.projection.aeot_inspection?.active, true);
    assert.equal(reloaded.projection.end_of_shift_notice?.title, "END OF SHIFT");
  } else {
    const naturalInput = `Move west action-runtime-${Date.now()}`;
    await type('#natural-form [name="text"]', naturalInput); await click('#natural-form button[type="submit"]');
    await waitForText('#interaction-feedback', "No usable access key");
    const rejectedNatural = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(createdWorlds.worlds[0].id)},mode:"field-researcher"})`);
    assert.equal(rejectedNatural.projection.q4.current_location.name, "Utility Room", "missing hosted access must not mutate natural movement");
    await click('.backend-menu > summary'); await click('[data-action="settings"]'); assert.equal(await waitFor('[data-testid="settings-surface"]'), true);
    await windowRef.webContents.executeJavaScript("document.querySelector('#settings [name=provider]').focus()");
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"E" });
    await windowRef.webContents.sendInputEvent({ type:"char", keyCode:"E" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"E" });
    await pause(50);
    assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#settings [name=provider]').value"), "offline");
    await click('#settings button[type="submit"]'); await waitForText('#settings-message', "saved and applied");
    await click('[data-action="close-settings"]'); assert.equal(await waitFor('#natural-form'), true);
    assert.equal(await windowRef.webContents.executeJavaScript("document.querySelector('#natural-form [name=text]').value"), naturalInput, "rejected natural input must remain available for retry");
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
  }
  console.log(JSON.stringify({ packaged_input_probe:{boot:result.boot,audio:{title:result.title_audio,field:result.field_audio},initialFocus,controls:controls.length,settingsNonce,persisted,saved,errors} }, null, 2));
  assert.ok(initialFocus); assert.ok(controls.length >= 12); assert.equal(persisted.model, settingsNonce); assert.match(saved, /saved and applied/i); assert.deepEqual(errors, []);
  const naturalCommandEvidence = process.argv.includes("--day1-opener") ? "scripted_interpreter_resolved" : "auto_missing-key_rejected_then_offline_retry_resolved";
  if (process.argv.includes("--day1-opener")) {
    // A persisted terminal fixture isolates presentation/reopen acceptance;
    // y99 separately exercises the actual cutoff and return trigger.
    const world = service.createWorld({ name:"Terminal record verification", seed:"native-terminal-record" }).world;
    assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Morgan", last_name:"Vale" }).ok, true);
    assert.equal(service.confirmQ4Personnel({ world_id:world.id }).ok, true);
    assert.equal(service.startSession({ world_id:world.id, mode:"field-researcher", scenario:"day1-opener" }).ok, true);
    const entry = service.session(world.id, "field-researcher");
    require("../tools/cq4-day1-opener").triggerCatastrophicEnding(service.getWorld(world.id), entry);
    service.persistSession(service.getWorld(world.id), "field-researcher", entry);
    await windowRef.webContents.executeJavaScript("home()");
    await click(`[data-action="world:${world.id}"]`);
    await click('[data-action="mode:field-researcher"]');
    assert.equal(await waitFor('[data-ending-stage="nonfunctional_threshold"]'), true);
    for (let i = 0; i < 200; i++) {
      if (await windowRef.webContents.executeJavaScript('Boolean(document.querySelector(".ending-newspaper"))')) break;
      await pause(50);
    }
    assert.equal(await waitFor('.ending-newspaper'), true);
    const finalCopy = await windowRef.webContents.executeJavaScript('document.querySelector(".ending-newspaper").textContent');
    assert.match(finalCopy, /TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA/);
    assert.equal(await windowRef.webContents.executeJavaScript('document.querySelectorAll("[data-game-action], #natural-form").length'), 0);
    await click('[data-ending-skip]');
    assert.equal(await waitFor('[data-testid="title-card"]'), true);
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"SPACE" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"SPACE" });
    await pause(150);
    if (!await windowRef.webContents.executeJavaScript(`Boolean(document.querySelector('[data-action="world:${world.id}"]'))`)) {
      await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"SPACE" });
      await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"SPACE" });
    }
    assert.equal(await waitFor(`[data-action="world:${world.id}"]`), true, "terminal title transition must reopen the library");
    await click(`[data-action="world:${world.id}"]`);
    await click('[data-action="mode:field-researcher"]');
    assert.equal(await waitFor('[data-testid="catastrophic-ending"]'), true);
    await click('[data-ending-skip]');
    assert.equal(await waitFor('[data-testid="title-card"]'), true);
    assert.equal(service.getWorld(world.id).q4_operations.terminal_outcome.outcome, "catastrophic-failure");
    console.log(JSON.stringify({ catastrophic_native_record:"passed", newspaper:"visible", title_return:"passed", reopen_terminal:"passed" }));
  }
  console.log(JSON.stringify({ renderer_settings_smoke:"passed", packaged_native_input:"passed", provider_manager:"native_local_select_and_hosted_key_lifecycle_verified", local_model:localNonce, natural_command:naturalCommandEvidence, local_recipient:selectedLocalTarget.value, controls:controls.length }, null, 2)); await pause(20); app.exit(0);
}
module.exports = { run };
