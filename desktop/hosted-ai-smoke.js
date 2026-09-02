"use strict";

// Explicit, opt-in packaged acceptance probe for hosted interpretation. The
// launcher must provide an isolated marked profile with an already configured
// credential file. This module never reads, prints, or copies that credential.
const assert = require("node:assert/strict");
const { app } = require("electron");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(windowRef) {
  const errors = [];
  windowRef.show();
  windowRef.focus();
  windowRef.webContents.on("console-message", (_event, level, message) => { if (level >= 2) errors.push(`console:${message}`); });
  windowRef.webContents.on("render-process-gone", (_event, details) => errors.push(`render-process-gone:${details.reason}`));
  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));

  const waitFor = async (selector, present = true, attempts = 120) => {
    for (let index = 0; index < attempts; index += 1) {
      if (Boolean(await windowRef.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) === present) return true;
      await pause(50);
    }
    return false;
  };
  const waitForHostedCompletion = async () => {
    let diagnostics = null;
    for (let index = 0; index < 600; index += 1) {
      diagnostics = await windowRef.webContents.executeJavaScript("window.yellowBeast.getDiagnostics()");
      if (diagnostics?.diagnostics?.hosted_ai?.invocation_status === "completed") return diagnostics;
      if (diagnostics?.diagnostics?.hosted_ai?.invocation_status === "failed") return diagnostics;
      if (index === 25 && diagnostics?.diagnostics?.hosted_ai?.invocation_status === "not-observed") return diagnostics;
      await pause(200);
    }
    return diagnostics;
  };
  const rect = async (selector) => windowRef.webContents.executeJavaScript(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node) return null; const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,pointer:getComputedStyle(node).pointerEvents,top:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.tagName}; })()`);
  const click = async (selector) => {
    await windowRef.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"center", inline:"nearest"})`);
    const bounds = await rect(selector);
    assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `not hit-testable: ${selector}`);
    assert.equal(bounds.pointer, "auto", `pointer events blocked: ${selector}`);
    assert.notEqual(bounds.top, "BODY", `surface not attached: ${selector}`);
    await windowRef.webContents.sendInputEvent({ type:"mouseMove", x:Math.round(bounds.x), y:Math.round(bounds.y) });
    await windowRef.webContents.sendInputEvent({ type:"mouseDown", x:Math.round(bounds.x), y:Math.round(bounds.y), button:"left", clickCount:1 });
    await windowRef.webContents.sendInputEvent({ type:"mouseUp", x:Math.round(bounds.x), y:Math.round(bounds.y), button:"left", clickCount:1 });
    await pause(80);
  };
  const type = async (selector, value) => {
    await click(selector);
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"CTRL" });
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"A", modifiers:["control"] });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"A", modifiers:["control"] });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"CTRL" });
    for (const character of value) {
      await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:character });
      await windowRef.webContents.sendInputEvent({ type:"char", keyCode:character });
      await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:character });
    }
    await pause(30);
  };
  const chooseSecond = async (selector) => {
    await click(selector);
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"HOME" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"HOME" });
    await windowRef.webContents.sendInputEvent({ type:"keyDown", keyCode:"DOWN" });
    await windowRef.webContents.sendInputEvent({ type:"keyUp", keyCode:"DOWN" });
    await pause(30);
  };

  await click('[data-action="skip-boot"]');
  assert.equal(await waitFor('[data-testid="world-library"]'), true);
  await click('[data-action="settings"]');
  assert.equal(await waitFor('[data-testid="settings-surface"]'), true);
  const providerStatus = await windowRef.webContents.executeJavaScript("window.yellowBeast.getProviderStatus()");
  assert.equal(providerStatus.provider.openai.configured, true, "isolated acceptance profile has no configured hosted credential");
  await chooseSecond('[name="input_mode"]');
  await chooseSecond('[name="provider"]');
  await windowRef.webContents.executeJavaScript("document.querySelector('.settings-surface').scrollTop=document.querySelector('.settings-surface').scrollHeight");
  await click('#settings button[type="submit"]');
  let configured = null;
  for (let index = 0; index < 120; index += 1) {
    configured = await windowRef.webContents.executeJavaScript("window.yellowBeast.getSettings()");
    if (configured.settings.provider === "openai" && configured.settings.input_mode === "natural") break;
    await pause(50);
  }
  assert.equal(configured.settings.provider, "openai");
  assert.equal(configured.settings.input_mode, "natural");
  await click('[data-action="close-settings"]');

  await click('[data-action="new"]');
  assert.equal(await waitFor('[data-testid="create-world"]'), true);
  await type('#new-world input[name="name"]', `hosted-runtime-${Date.now()}`);
  await click('#new-world [data-action="submit"]');
  assert.equal(await waitFor('[data-testid="world-entry"]'), true);
  await click('[data-action="mode:field-researcher"]');
  assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true);
  await type('#personnel-creation-form input[name="first_name"]', "Hosted");
  await type('#personnel-creation-form input[name="last_name"]', "Probe");
  await click('#personnel-creation-form button[type="submit"]');
  assert.equal(await waitFor('[data-testid="q4-personnel-confirmation"]'), true);
  await click('[data-action="personnel-confirm-continue"]');
  assert.equal(await waitFor('[data-testid="play-shell"]'), true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) await click(`[data-game-action="${action}"]`);

  const radioText = `Standard, hosted acceptance team accounted for. Radio check ${Date.now()}.`;
  await type('#q4-comms-form input[name="text"]', radioText);
  await click('#q4-comms-form button[type="submit"]');
  await click('[data-game-action="CROSS"]');
  assert.equal(await waitFor('#natural-form'), true);
  const worlds = await windowRef.webContents.executeJavaScript("window.yellowBeast.listWorlds()");
  const worldId = worlds.worlds[0].id;
  const before = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(worldId)},mode:"field-researcher"})`);
  const communicationsBefore = before.projection.q4.channels.standard.history.length + before.projection.q4.channels.local.history.length;
  assert.equal(before.projection.phase.phase_id, "FIELD_OPERATION");
  assert.equal(before.projection.q4.current_location.name, "Utility Room");

  const playerInput = "I commit to a careful transit through the open passage.";
  await type('#natural-form input[name="text"]', playerInput);
  await click('#natural-form button[type="submit"]');
  const hosted = await waitForHostedCompletion();
  assert.ok(hosted?.diagnostics?.hosted_ai, "hosted invocation produced no diagnostic record");
  if (hosted.diagnostics.hosted_ai.invocation_status !== "completed") {
    const rendererState = await windowRef.webContents.executeJavaScript("({feedback:document.querySelector('#interaction-feedback')?.textContent,input:document.querySelector('#natural-form input[name=text]')?.value,phase:document.querySelector('[data-phase]')?.dataset?.phase??null})");
    assert.fail(`hosted invocation did not complete: ${JSON.stringify({ hosted:hosted.diagnostics.hosted_ai, renderer:rendererState })}`);
  }
  assert.deepEqual(hosted.diagnostics.hosted_ai, {
    ...hosted.diagnostics.hosted_ai,
    invocation_status:"completed",
    hosted_request:true,
    response_received:true,
    response_parsed:true
  });
  assert.equal(await waitFor('#natural-form'), true);
  const after = await windowRef.webContents.executeJavaScript(`window.yellowBeast.getGameplayProjection({world_id:${JSON.stringify(worldId)},mode:"field-researcher"})`);
  const communicationsAfter = after.projection.q4.channels.standard.history.length + after.projection.q4.channels.local.history.length;
  assert.equal(after.projection.q4.current_location.name, "Open Passage");
  assert.equal(communicationsAfter, communicationsBefore, "hosted interpretation invented player speech");
  const provenance = await windowRef.webContents.executeJavaScript("window.yellowBeast.getInterpretationProvenance({limit:20})");
  const completed = provenance.records.filter((record) => record.provider === "openai" && record.invocation_status === "completed");
  assert.ok(completed.some((record) => record.hosted_request === true && record.response_received === true && record.response_parsed === true));
  assert.deepEqual(errors, []);

  console.log(JSON.stringify({ hosted_ai_smoke:"passed", provider:"openai", model:hosted.diagnostics.hosted_ai.model, request_kind:hosted.diagnostics.hosted_ai.request_kind, response_received:true, response_parsed:true, threshold:"crossed", world_behavior:{ from:"Utility Room", to:"Open Passage" }, player_authorship:{ submitted:playerInput, invented_communications:false }, credential_exposed:false }, null, 2));
  await pause(20);
  app.exit(0);
}

module.exports = { run };
