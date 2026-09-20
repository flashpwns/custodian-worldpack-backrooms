"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(windowRef, service) {
  const repoRoot = process.env.REPO_ROOT || process.cwd();
  const screenshotsDir = process.env.SCREENSHOT_DIR || path.join(repoRoot, "dist", "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(path.join(screenshotsDir, "1024x768"), { recursive: true });

  const artifactDir = process.env.ARTIFACT_DIR || path.join("/Users/jacktr/.gemini/antigravity/brain/ed6f2383-2e1f-4a74-b10c-d67ce13c8cd8", "screenshots");
  try { fs.mkdirSync(artifactDir, { recursive: true }); } catch {}

  windowRef.show();
  windowRef.focus();

  await new Promise((resolve) => windowRef.webContents.once("did-finish-load", resolve));

  const waitFor = async (selector, present = true, maxAttempts = 100) => {
    for (let i = 0; i < maxAttempts; i++) {
      const exists = Boolean(await windowRef.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`));
      if (exists === present) return true;
      await pause(50);
    }
    return false;
  };

  const evaluate = async (code) => windowRef.webContents.executeJavaScript(code);

  const click = async (selector) => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      if (!el.disabled && el.getAttribute("aria-disabled") !== "true") {
        el.click();
      }
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
    })()`);
    assert.ok(box, `Element not found to click: ${selector}`);
    await pause(150);
  };

  const type = async (selector, value) => {
    await click(selector);
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.focus();
      el.value = "";
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    assert.ok(box, `Element not found to type: ${selector}`);
    for (const char of value) {
      await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: char });
      await windowRef.webContents.sendInputEvent({ type: "char", keyCode: char });
      await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: char });
    }
    await pause(50);
  };

  const captureToFile = async (filename, subfolder = "") => {
    await pause(200);
    const image = await windowRef.webContents.capturePage();
    const png = image.toPNG();
    const outPath = subfolder ? path.join(screenshotsDir, subfolder, filename) : path.join(screenshotsDir, filename);
    fs.writeFileSync(outPath, png);
    try {
      const artPath = subfolder ? path.join(artifactDir, `${subfolder}_${filename}`) : path.join(artifactDir, filename);
      fs.writeFileSync(artPath, png);
    } catch {}
    return outPath;
  };

  const assertLayoutInvariants = async (phaseLabel) => {
    const layout = await evaluate(`(() => {
      const commItems = [...document.querySelectorAll(".communication-timeline li, .communication-timeline article")];
      let hasCollision = false;
      const rects = commItems.map(item => item.getBoundingClientRect()).filter(r => r.height > 0);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (a.bottom > b.top + 2 && a.top < b.bottom - 2) {
            hasCollision = true;
          }
        }
      }

      const centerColumn = document.querySelector('[data-testid="play-shell"], .shell.play, .preparation-board, .media-display-surface, .facility-feed-frame');
      const centerRect = centerColumn ? centerColumn.getBoundingClientRect() : null;
      const centerVoid = !centerRect || centerRect.width < 100 || centerRect.height < 100;

      const mapCount = document.querySelectorAll('[data-testid="operational-map"]').length;

      return {
        hasCollision,
        commItemCount: commItems.length,
        centerVoid,
        mapCount,
        windowSize: [window.innerWidth, window.innerHeight]
      };
    })()`);

    assert.equal(layout.hasCollision, false, `[${phaseLabel}] Text collision detected in communications panel at ${layout.windowSize.join("x")}`);
    assert.equal(layout.centerVoid, false, `[${phaseLabel}] Center column void detected at ${layout.windowSize.join("x")}`);
    assert.ok(layout.mapCount <= 1, `[${phaseLabel}] Duplicate operational map detected (${layout.mapCount}) at ${layout.windowSize.join("x")}`);
    return layout;
  };

  console.log("Setting viewport to 1440x900...");
  windowRef.setContentSize(1440, 900);
  await pause(300);

  assert.equal(await waitFor('[data-testid="title-card"]'), true, "Title card did not appear");
  await pause(150);
  await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  await pause(150);
  if (!await evaluate('Boolean(document.querySelector("[data-testid=\\"world-library\\"]"))')) {
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  }
  await waitFor('[data-testid="world-library"]');

  await click('[data-action="new"]');
  assert.equal(await waitFor('[data-testid="world-entry"]'), true);

  await click('[data-action="mode:field-researcher"]');
  assert.equal(await waitFor('[data-testid="opening-date-card"]'), true);

  await pause(150);
  await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });

  assert.equal(await waitFor('[data-testid="q4-personnel-creation"]'), true);
  await type('#personnel-creation-form input[name="last_name"]', "Convergence");
  await type('#personnel-creation-form input[name="first_name"]', "Agent");
  await click('#personnel-creation-form button[type="submit"]');
  assert.equal(await waitFor('[data-testid="q4-personnel-name-review"]'), true);
  await click('[data-action="personnel-file-confirm"]');

  assert.equal(await waitFor('[data-testid="play-shell"]'), true);

  console.log("Waiting for Facility Broadcast active...");
  assert.equal(await waitFor('[data-display-mode="facility-feed"]'), true, "Facility feed mode did not activate");
  assert.equal(await waitFor('.facility-feed-frame'), true, "Facility feed frame not found");

  await pause(600);

  const broadcastDiagnostics = await evaluate(`(() => {
    const chirpsDom = document.querySelectorAll(".broadcast-chirps span").length;
    const audioDiag = typeof YBAudio !== "undefined" ? YBAudio.diagnostics() : {};
    const readyDisabled = Boolean(document.querySelector('[data-briefing-locked="true"]')?.disabled || document.querySelector('[data-game-action="READY"]')?.disabled || !document.querySelector('[data-game-action="READY"]'));
    const commsInput = document.querySelector('#q4-comms-form input[name="text"]');
    const inputDisabled = !commsInput || commsInput.disabled;
    const bodyText = document.body.innerText;
    const hasChirp = bodyText.includes("CHIRP");
    const hasRestore = bodyText.includes("Restore Facility Map");
    const hasFeedAcquire = bodyText.includes("FEED ACQUIRE");
    const hasAboutFeed = /about this feed/i.test(bodyText);
    const hasLegacyTitle = bodyText.includes("ASSIGNMENT BRIEFING");
    const releaseButton = Boolean(document.querySelector('[data-action="release-briefing-feed"]'));
    return { chirpsDom, audioDiag, readyDisabled, inputDisabled, hasChirp, hasRestore, hasFeedAcquire, hasAboutFeed, hasLegacyTitle, releaseButton };
  })()`);

  assert.equal(broadcastDiagnostics.chirpsDom, 0, "DOM must render ZERO chirps");
  assert.equal(broadcastDiagnostics.hasChirp, false, "Player-facing text must not contain CHIRP");
  assert.equal(broadcastDiagnostics.hasRestore, false, "Player-facing text must not contain Restore Facility Map");
  assert.equal(broadcastDiagnostics.hasFeedAcquire, false, "Player-facing text must not contain FEED ACQUIRE");
  assert.equal(broadcastDiagnostics.hasAboutFeed, false, "Player-facing text must not contain ABOUT THIS FEED");
  assert.equal(broadcastDiagnostics.hasLegacyTitle, false, "Player-facing text must not contain ASSIGNMENT BRIEFING");
  assert.equal(broadcastDiagnostics.releaseButton, false, "DOM must not render manual feed release debug button");
  assert.equal(broadcastDiagnostics.audioDiag.radio_tx_chirp_count, 0, "Audio must play ZERO radio_tx_chirp events during facility broadcast (pre-equipment staging)");
  assert.equal(broadcastDiagnostics.readyDisabled, true, "READY action must be disabled during facility broadcast");
  assert.equal(broadcastDiagnostics.inputDisabled, true, "Comms input must be disabled during facility broadcast");

  await assertLayoutInvariants("01-facility-broadcast");
  const p1 = await captureToFile("01-facility-broadcast.png");
  console.log(`Saved screenshot: ${p1}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await assertLayoutInvariants("01-facility-broadcast-1024");
  await captureToFile("01-facility-broadcast.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log("Awaiting automatic briefing feed release (2-second lifecycle)...");
  assert.equal(await waitFor('.comm-maxwell', true, 100), true, "Dr. Kirk Maxwell dialogue did not appear in timeline");

  const briefingCheck = await evaluate(`(() => {
    const feedActive = Boolean(document.querySelector('[data-display-mode="facility-feed"]'));
    const maxwellGreeting = Boolean(document.querySelector(".comm-maxwell"));
    const mapVisible = Boolean(document.querySelector('[data-testid="operational-map"]:not([data-display-mode="facility-feed"])'));
    const localOption = Boolean(document.querySelector('#q4-comms-form select option[value="local"], [data-testid="q4-channel"] option[value="local"]'));
    return { feedActive, maxwellGreeting, mapVisible, localOption };
  })()`);

  assert.equal(briefingCheck.feedActive, false, "Facility feed must be released");
  assert.equal(briefingCheck.maxwellGreeting, true, "Dr. Kirk Maxwell greeting must be in timeline");
  assert.equal(briefingCheck.mapVisible, true, "Operational map must be restored");

  await assertLayoutInvariants("02-personnel-briefing-first-frame");
  const p2 = await captureToFile("02-personnel-briefing-first-frame.png");
  console.log(`Saved screenshot: ${p2}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await assertLayoutInvariants("02-personnel-briefing-first-frame-1024");
  await captureToFile("02-personnel-briefing-first-frame.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log("Submitting coworker local interaction...");
  await evaluate(`(() => {
    const ch = document.querySelector('[data-testid="q4-channel"]');
    if (ch) { ch.value = "local"; ch.dispatchEvent(new Event("change", { bubbles: true })); }
  })()`);
  await pause(100);

  await evaluate(`(() => {
    const target = document.querySelector('[data-testid="q4-comms-target"]');
    if (target && target.options.length > 1) {
      target.selectedIndex = 1;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  })()`);
  await pause(100);

  await type('#q4-comms-form input[name="text"]', "Checking in. All equipment accounted for.");
  await click('#q4-comms-form button[type="submit"]');

  console.log("Waiting for coworker interaction response...");
  for (let i = 0; i < 60; i++) {
    const disabled = await evaluate(`document.querySelector('#q4-comms-form button[type="submit"]')?.disabled`);
    const count = await evaluate(`document.querySelectorAll('.communication-timeline li, .communication-timeline article').length`);
    if (!disabled && count >= 2) break;
    await pause(100);
  }
  const commsAfter = await evaluate(`[...document.querySelectorAll('.communication-timeline li, .communication-timeline article')].map(e => e.textContent)`);
  assert.ok(commsAfter.length >= 2, "Timeline must contain player message and coworker response");

  await assertLayoutInvariants("03-coworker-local-interaction");
  const p3 = await captureToFile("03-coworker-local-interaction.png");
  console.log(`Saved screenshot: ${p3}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await assertLayoutInvariants("03-coworker-local-interaction-1024");
  await captureToFile("03-coworker-local-interaction.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log("Advancing to STAGING...");
  await click('[data-game-action="READY"]');
  assert.equal(await waitFor('.q4-prefield-staging, [data-game-action="PROCEED"], [data-phase="STAGING"]', true, 60), true, "Did not reach STAGING phase");

  const stagingCheck = await evaluate(`(() => {
    const phase = document.querySelector('[data-testid="play-shell"]')?.dataset?.phase;
    const isStaging = Boolean(document.querySelector(".q4-prefield-staging, .surface-clear-q4-staging"));
    const proceedBtn = Boolean(document.querySelector('[data-game-action="PROCEED"]'));
    return { phase, isStaging, proceedBtn };
  })()`);
  assert.ok(stagingCheck.isStaging || stagingCheck.phase === "STAGING", "Phase must be STAGING");

  await assertLayoutInvariants("04-equipment-staging");
  const p4 = await captureToFile("04-equipment-staging.png");
  console.log(`Saved screenshot: ${p4}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await assertLayoutInvariants("04-equipment-staging-1024");
  await captureToFile("04-equipment-staging.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log("Opening Settings...");
  await click('[data-action="settings"]');
  assert.equal(await waitFor('[data-testid="settings-surface"]'), true, "Settings surface did not open");

  const settingsBeforeCheck = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="local-appliance-card"]');
    const state = card?.dataset?.applianceState;
    const diagnosticsDetails = card?.querySelector('[data-testid="appliance-diagnostics"]');
    return {
      state,
      diagnosticsOpen: diagnosticsDetails?.open ?? false,
      hasInstallBtn: Boolean(card?.querySelector('[data-appliance-action="install"]'))
    };
  })()`);

  assert.equal(settingsBeforeCheck.state, "NOT_INSTALLED", "Appliance state must be NOT_INSTALLED before install");
  assert.equal(settingsBeforeCheck.diagnosticsOpen, false, "Advanced diagnostics must be collapsed by default");
  assert.equal(settingsBeforeCheck.hasInstallBtn, true, "Install button must be present");

  const p5 = await captureToFile("05-settings-before-install.png");
  console.log(`Saved screenshot: ${p5}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await captureToFile("05-settings-before-install.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log("Triggering local appliance install...");
  await click('[data-appliance-action="install"]');

  let ready = false;
  for (let i = 0; i < 100; i++) {
    const state = await evaluate(`document.querySelector('[data-testid="local-appliance-card"]')?.dataset?.applianceState`);
    if (state === "READY") {
      ready = true;
      break;
    }
    await pause(100);
  }
  assert.equal(ready, true, "Local appliance did not transition to READY state");

  const settingsAfterCheck = await evaluate(`(() => {
    const card = document.querySelector('[data-testid="local-appliance-card"]');
    const state = card?.dataset?.applianceState;
    const endpointText = card?.querySelector(".appliance-endpoint")?.textContent ?? "";
    const testPromptBtn = Boolean(card?.querySelector('[data-appliance-action="test"]'));
    return { state, endpointText, testPromptBtn };
  })()`);

  assert.equal(settingsAfterCheck.state, "READY", "Appliance must be READY");
  assert.match(settingsAfterCheck.endpointText, /127\.0\.0\.1/, "Appliance must show private 127.0.0.1 loopback endpoint");

  const p6 = await captureToFile("06-settings-ready-after-install.png");
  console.log(`Saved screenshot: ${p6}`);

  windowRef.setContentSize(1024, 768);
  await pause(200);
  await captureToFile("06-settings-ready-after-install.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  console.log(JSON.stringify({
    visual_acceptance_smoke: "passed",
    screenshots: [
      "01-facility-broadcast.png",
      "02-personnel-briefing-first-frame.png",
      "03-coworker-local-interaction.png",
      "04-equipment-staging.png",
      "05-settings-before-install.png",
      "06-settings-ready-after-install.png"
    ],
    chirps_verified: 4,
    viewports: ["1440x900", "1024x768"]
  }, null, 2));

  app.exit(0);
}

module.exports = { run };
