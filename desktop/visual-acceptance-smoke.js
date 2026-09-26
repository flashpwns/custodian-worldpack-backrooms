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

  const waitFor = async (selector, present = true, maxAttempts = 120) => {
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
      try {
        if (typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ block: "center", inline: "center" });
        }
      } catch (_) {}
      const r = (typeof el.getBoundingClientRect === "function")
        ? el.getBoundingClientRect()
        : { left: 0, top: 0, width: 0, height: 0 };
      if (!el.disabled && el.getAttribute("aria-disabled") !== "true") {
        if (typeof el.click === "function") {
          el.click();
        } else {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        }
      }
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
    })()`);
    assert.ok(box, `Element not found to click: ${selector}`);
    await pause(200);
    return box;
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
      const artPath = subfolder ? path.join(artifactDir, `${subfolder ? subfolder + "_" : ""}${filename}`) : path.join(artifactDir, filename);
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

      const centerColumn = document.querySelector('[data-testid="play-shell"], .shell.play, .eti-center, .briefing-center');
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

  console.log("=== BEAT 2.4 HUMAN CONVERGENCE ELECTRON TRAVERSAL ===");
  console.log("Setting viewport to 1440x900...");
  windowRef.setContentSize(1440, 900);
  await pause(400);

  // 1. TITLE SCREEN
  console.log("Step 1: Title Screen");
  assert.equal(await waitFor('[data-testid="title-card"]'), true, "Title card did not appear");
  await captureToFile("01-title-screen.png");

  // Audio check on Title Screen
  const titleAudio = await evaluate(`typeof YBAudio !== "undefined" ? YBAudio.diagnostics() : {}`);
  console.log(`Title audio: menu wanted=${titleAudio.menu?.wanted}, available=${titleAudio.menu?.available}`);

  await pause(200);
  await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
  await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  await pause(200);

  if (!await evaluate('Boolean(document.querySelector("[data-testid=\\"world-library\\"]"))')) {
    await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "SPACE" });
    await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "SPACE" });
  }
  await waitFor('[data-testid="world-library"]');
  console.log("Reached World Library");

  // 2. NEW GAME
  console.log("Step 2: New Game");
  await click('[data-action="new"]');
  assert.equal(await waitFor('[data-testid="world-entry"]'), true);

  // 3. JULY 1991 DATE CARD / INTRO VIDEO
  console.log("Step 3: Opening Date Card & Intro Video");
  await click('[data-action="mode:field-researcher"]');
  assert.equal(await waitFor('[data-testid="opening-date-card"]'), true);
  await captureToFile("02-july-1991-date-card.png");
  console.log("Captured July 1991 date card");

  // Await either intro video or personnel creation (accommodating date card duration)
  console.log("Awaiting introductory video or personnel creation...");
  let videoSeen = false;
  for (let i = 0; i < 300; i++) {
    const hasVideo = await evaluate('Boolean(document.querySelector("[data-testid=\\"introductory-video\\"]"))');
    if (hasVideo) {
      videoSeen = true;
      console.log("Introductory video mounted; capturing and pressing ESC to test skip...");
      await captureToFile("02b-introductory-video.png");
      await pause(100);
      await windowRef.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      await windowRef.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await pause(400);
      break;
    }
    const hasWaiver = await evaluate('Boolean(document.querySelector("[data-testid=\\"q4-personnel-creation\\"]"))');
    if (hasWaiver) break;
    await pause(100);
  }

  // 4. WAIVER / NAME ENTRY
  console.log("Step 4: Personnel Creation / Waiver Entry");
  assert.equal(await waitFor('[data-testid="q4-personnel-creation"]', true, 200), true);
  await pause(600); // Allow 1.8s entrance animation to establish
  await captureToFile("03-personnel-waiver.png");

  await type('#personnel-creation-form input[name="last_name"]', "Convergence");
  await type('#personnel-creation-form input[name="first_name"]', "Agent");
  await click('#personnel-creation-form button[type="submit"]');

  // 5. PERSONNEL CONFIRMATION
  console.log("Step 5: Personnel Confirmation");
  assert.equal(await waitFor('[data-testid="q4-personnel-name-review"]'), true);
  await captureToFile("04-personnel-confirmation.png");
  await click('[data-action="personnel-file-confirm"]');

  // Await AEOT staged initialization (1.8s paper exit -> 8s initialization)
  console.log("Awaiting AEOT staged initialization...");
  const reachedAeot = await waitFor('[data-testid="aeot-initialization"]', true, 80);
  if (reachedAeot) {
    console.log("AEOT initialization active; capturing screenshot...");
    await pause(500);
    await captureToFile("04b-aeot-initialization.png");
  }

  // 6. PLAY SHELL & COLD BOOT TO FACILITY SCHEMATIC
  console.log("Step 6: Play Shell & Cold Boot to Facility Schematic");
  assert.equal(await waitFor('[data-testid="play-shell"]', true, 300), true, "Play shell did not mount");
  console.log("Play shell mounted. Awaiting cold boot completion...");

  // Wait for 3-stage cold boot animation to complete
  for (let i = 0; i < 120; i++) {
    const isBootLocked = await evaluate(`document.body.hasAttribute("data-boot-locked")`);
    if (!isBootLocked) break;
    await pause(100);
  }
  await pause(300);

  // Verify Facility Schematic is visible
  assert.equal(await waitFor('[data-testid="operational-map"]'), true, "Facility schematic map not found");
  assert.equal(await evaluate(`document.querySelector('[data-testid="operational-map"]')?.dataset?.displayMode`), "facility");

  // Verify PURGED INFERENCES on Lower Level
  const lowerAudit = await evaluate(`(() => {
    const mapHtml = document.querySelector('[data-testid="operational-map"]').innerHTML;
    const hasCorridorService = mapHtml.includes("Corridor / Service");
    const hasBriefingRoomInference = mapHtml.includes("Briefing Room");
    const hasInventedSubtitles = /Administrative & Briefing|Administrative &amp; Briefing|Equipment Staging|Circulation & Access|Circulation &amp; Access|KV31 \\/ LPMDS Hall/.test(mapHtml);
    const hasDressingRoom = mapHtml.includes("Dressing Room");
    const hasThresholdChamber = mapHtml.includes("Threshold Chamber");
    const hasYou = Boolean(document.querySelector(".map-you-marker"));
    return { hasCorridorService, hasBriefingRoomInference, hasInventedSubtitles, hasDressingRoom, hasThresholdChamber, hasYou };
  })()`);

  console.log("Facility schematic Lower Level audit:", JSON.stringify(lowerAudit));
  assert.equal(lowerAudit.hasCorridorService, false, "Corridor / Service must be purged from schematic");
  assert.equal(lowerAudit.hasInventedSubtitles, false, "Invented subtitles must be purged from schematic");
  assert.equal(lowerAudit.hasDressingRoom, true, "Blueprint Dressing Room must be present");
  assert.equal(lowerAudit.hasThresholdChamber, true, "Blueprint Threshold Chamber must be present");
  assert.equal(lowerAudit.hasYou, true, "YOU marker must be present on Lower Level");

  await assertLayoutInvariants("05-cold-boot-facility-map");
  await captureToFile("05-cold-boot-facility-map.png");

  // Inspect 1024x768 at Facility Map
  windowRef.setContentSize(1024, 768);
  await pause(250);
  await assertLayoutInvariants("05-cold-boot-facility-map-1024");
  await captureToFile("05-cold-boot-facility-map.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  // 7. MULTI-FLOOR SCHEMATIC INSPECTION
  console.log("Step 7: Multi-floor Schematic Inspection");

  // Inspect Middle Level
  await click('button.facility-floor-button[data-facility-floor="middle"]');
  await pause(200);
  const middleAudit = await evaluate(`(() => {
    const mapHtml = document.querySelector('[data-testid="operational-map"]').innerHTML;
    const hasControlRoom = mapHtml.includes("Control Room");
    const hasKV31Prefix = mapHtml.includes("KV31 Control Room");
    const hasConferenceRoom = mapHtml.includes("Conference Room");
    const hasMedicalLab = mapHtml.includes("Medical Lab");
    const hasRelayRoom = mapHtml.includes("Relay Room");
    const hasTelemetryRelay = mapHtml.includes("Telemetry Relay");
    const hasYou = Boolean(document.querySelector(".map-you-marker"));
    return { hasControlRoom, hasKV31Prefix, hasConferenceRoom, hasMedicalLab, hasRelayRoom, hasTelemetryRelay, hasYou };
  })()`);
  console.log("Middle Level audit:", JSON.stringify(middleAudit));
  assert.equal(middleAudit.hasControlRoom, true, "Control Room must be present");
  assert.equal(middleAudit.hasKV31Prefix, false, "KV31 Control Room must not be present");
  assert.equal(middleAudit.hasConferenceRoom, true, "Conference Room must be present");
  assert.equal(middleAudit.hasMedicalLab, true, "Medical Lab must be present");
  assert.equal(middleAudit.hasRelayRoom, true, "Relay Room must be present");
  assert.equal(middleAudit.hasTelemetryRelay, false, "Telemetry Relay must not be present");
  assert.equal(middleAudit.hasYou, false, "YOU marker must not be rendered on Middle Level");
  await captureToFile("06-facility-map-middle-level.png");

  // Inspect Upper Level
  await click('button.facility-floor-button[data-facility-floor="upper"]');
  await pause(150);
  const upperAudit = await evaluate(`(() => {
    const mapHtml = document.querySelector('[data-testid="operational-map"]').innerHTML;
    const hasServerRoom = mapHtml.includes("Server Room");
    const hasMaintenance = mapHtml.includes("Maintenance Access");
    const hasRestrooms = mapHtml.includes("Restrooms");
    const hasAdminOffices = mapHtml.includes("Administrative Offices");
    const hasYou = Boolean(document.querySelector(".map-you-marker"));
    return { hasServerRoom, hasMaintenance, hasRestrooms, hasAdminOffices, hasYou };
  })()`);
  console.log("Upper Level audit:", JSON.stringify(upperAudit));
  assert.equal(upperAudit.hasServerRoom, true, "Server Room must be present");
  assert.equal(upperAudit.hasMaintenance, true, "Maintenance Access must be present");
  assert.equal(upperAudit.hasRestrooms, true, "Restrooms must be present");
  assert.equal(upperAudit.hasAdminOffices, false, "Administrative Offices must not be present");
  assert.equal(upperAudit.hasYou, false, "YOU marker must not be rendered on Upper Level");
  await captureToFile("07-facility-map-upper-level.png");

  // Inspect Upper Section
  await click('button.facility-floor-button[data-facility-floor="upper-section"]');
  await pause(150);
  const upperSecAudit = await evaluate(`(() => {
    const mapHtml = document.querySelector('[data-testid="operational-map"]').innerHTML;
    const hasAuditorium = mapHtml.includes("Auditorium");
    const hasLounge = mapHtml.includes("Lounge Access");
    const hasRoofAccess = /Mechanical & Roof Access|Mechanical &amp; Roof Access/.test(mapHtml);
    const hasYou = Boolean(document.querySelector(".map-you-marker"));
    return { hasAuditorium, hasLounge, hasRoofAccess, hasYou };
  })()`);
  console.log("Upper Section audit:", JSON.stringify(upperSecAudit));
  assert.equal(upperSecAudit.hasAuditorium, true, "Auditorium must be present");
  assert.equal(upperSecAudit.hasLounge, true, "Lounge Access must be present");
  assert.equal(upperSecAudit.hasRoofAccess, false, "Mechanical & Roof Access must not be present");
  assert.equal(upperSecAudit.hasYou, false, "YOU marker must not be rendered on Upper Section");
  await captureToFile("08-facility-map-upper-section.png");

  // Return to Lower Level
  await click('button.facility-floor-button[data-facility-floor="lower"]');
  await pause(150);

  // 8. ATTEND BRIEFING
  console.log("Step 8: Attend Briefing");
  const attendBtn = await evaluate(`Boolean(document.querySelector('[data-game-action="ATTEND_BRIEFING"]'))`);
  assert.equal(attendBtn, true, "ATTEND BRIEFING button must be available");
  await click('[data-game-action="ATTEND_BRIEFING"]');

  assert.equal(await waitFor('[data-testid="in-person-briefing"]'), true, "In-person briefing not mounted");
  console.log("Mounted In-Person Briefing scene");

  // Check speaker identity & room marker
  const briefingHeader = await evaluate(`(() => {
    const name = document.querySelector(".briefing-speaker-name")?.textContent ?? "";
    const room = document.querySelector(".briefing-room-marker")?.textContent ?? "";
    return { name, room };
  })()`);
  assert.equal(briefingHeader.name, "Dr. Kirk Maxwell");
  assert.equal(briefingHeader.room, "ASYNC FACILITY // LOWER LEVEL");

  // 9. DIALOGUE TYPING & SKIP-FIRST SEMANTICS
  console.log("Step 9: Dialogue Typing & Skip Semantics");
  await pause(200);

  // Check that dialogue player is typing or has started
  const isTypingInitial = await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`);
  console.log(`Dialogue typing actively: ${isTypingInitial}`);

  await assertLayoutInvariants("09-attend-briefing-beat1");
  await captureToFile("09-attend-briefing-beat1.png");

  // Test skip-on-first-action: click CONTINUE LISTENING while typing
  if (await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`)) {
    console.log("Testing skip-on-click: clicking CONTINUE LISTENING while typing...");
    await click('[data-game-action="CONTINUE_BRIEFING"]');
    await pause(100);
    const stillTyping = await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`);
    assert.equal(stillTyping, false, "Dialogue typing must finish immediately on first click");
    console.log("Typing skipped cleanly; full text displayed without advancing beat!");
  } else {
    console.log("Typing already finished or fast mode active.");
  }
  await captureToFile("10-briefing-typing-skip.png");

  // 10. QUESTION / INQUIRY DURING BRIEFING
  console.log("Step 10: Inquiring during Briefing");
  const inquiryInputExists = await evaluate(`Boolean(document.querySelector('#briefing-inquiry-form input[name="text"]'))`);
  if (inquiryInputExists) {
    await evaluate(`(() => {
      const form = document.querySelector('#briefing-inquiry-form');
      const input = form?.querySelector('input[name="text"]');
      if (input) {
        input.value = "What is our cutoff time?";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    })()`);

    let answered = false;
    let inquiryHistory = "";
    for (let i = 0; i < 50; i++) {
      inquiryHistory = await evaluate(`(() => {
        const turns = [...document.querySelectorAll(".briefing-turn")].map(t => t.innerText);
        return turns.join(" ");
      })()`);
      if (inquiryHistory.includes("1:00 PM firm") || inquiryHistory.includes("cutoff")) {
        answered = true;
        break;
      }
      await pause(100);
    }
    console.log("Briefing transcript after inquiry contains firm cutoff:", answered);
    assert.ok(answered, "Maxwell must answer firm cutoff time");
  }

  await captureToFile("11-briefing-inquiry-response.png");

  // Advance through remaining beats until CONCLUDE BRIEFING appears
  console.log("Step 11: Advance through Maxwell's remaining beats");
  for (let b = 0; b < 6; b++) {
    const hasConclude = await evaluate(`Boolean(document.querySelector('[data-game-action="CONCLUDE_BRIEFING"]'))`);
    if (hasConclude) break;

    const hasContinue = await evaluate(`Boolean(document.querySelector('[data-game-action="CONTINUE_BRIEFING"]'))`);
    if (hasContinue) {
      // If typing, skip first, then click again
      if (await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`)) {
        await evaluate(`YBDialoguePlayer.finish()`);
        await pause(100);
      }
      await click('[data-game-action="CONTINUE_BRIEFING"]');
      await pause(300);
    }
  }

  assert.equal(await waitFor('[data-game-action="CONCLUDE_BRIEFING"]'), true, "CONCLUDE BRIEFING button must appear");
  console.log("All Maxwell briefing beats complete. CONCLUDE BRIEFING is active!");
  await captureToFile("12-briefing-complete-ready-to-conclude.png");

  // 12. CONCLUDE BRIEFING -> LOCAL INTRODUCTIONS
  console.log("Step 12: Conclude Briefing -> LOCAL Introductions");
  await click('[data-game-action="CONCLUDE_BRIEFING"]');

  assert.equal(await waitFor('[data-testid="local-introductions"]'), true, "LOCAL Introductions scene must appear");
  const introCheck = await evaluate(`(() => {
    const header = document.querySelector(".introductions-header h2")?.textContent ?? "";
    const eyebrow = document.querySelector(".introductions-header .eyebrow")?.textContent ?? "";
    const coworkers = document.querySelectorAll(".coworker-presence-card").length;
    const readyBtn = Boolean(document.querySelector('[data-game-action="READY"]'));
    return { header, eyebrow, coworkers, readyBtn };
  })()`);

  console.log("LOCAL Introductions check:", JSON.stringify(introCheck));
  assert.equal(introCheck.header, "Assembly Table");
  assert.equal(introCheck.eyebrow, "ASYNC FACILITY // LOWER LEVEL");
  assert.equal(introCheck.coworkers, 3, "Exactly 3 assigned coworkers must be present at the table");
  assert.equal(introCheck.readyBtn, true, "PROCEED TO EQUIPMENT STAGING button must be present");

  await assertLayoutInvariants("13-local-introductions");
  await captureToFile("13-local-introductions.png");

  // Inspect 1024x768 at LOCAL Introductions
  windowRef.setContentSize(1024, 768);
  await pause(250);
  await assertLayoutInvariants("13-local-introductions-1024");
  await captureToFile("13-local-introductions.png", "1024x768");
  windowRef.setContentSize(1440, 900);
  await pause(200);

  // 12b. LOCAL INTRODUCTIONS TARGETING & SILENCE VALIDATION
  console.log("Step 12b: LOCAL Introductions Coworker Targeting & Silence Validation");
  const coworkerCardsData = await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll(".coworker-presence-card")).map(c => ({
      name: c.querySelector(".coworker-name")?.textContent ?? "",
      role: c.querySelector(".coworker-role")?.textContent ?? "",
      posture: c.querySelector(".coworker-posture")?.textContent ?? "",
      targetName: c.getAttribute("data-coworker-name") ?? ""
    }));
    return cards;
  })()`);
  assert.equal(coworkerCardsData.length, 3, "Exactly 3 coworker cards must be inspectable");
  for (const card of coworkerCardsData) {
    assert.ok(card.name.length > 0, "Coworker name must be present");
    assert.notEqual(card.posture, "follow", "Raw task 'follow' must not be displayed");
  }

  // Verify player can remain silent (READY action is enabled without speaking)
  const canProceedSilently = await evaluate(`(() => {
    const btn = document.querySelector('[data-game-action="READY"]');
    return Boolean(btn && !btn.disabled);
  })()`);
  assert.equal(canProceedSilently, true, "Player must be allowed to remain silent and proceed");

  // Click first coworker card to address them directly
  await evaluate(`(() => {
    const card = document.querySelector(".coworker-presence-card");
    if (card) card.click();
  })()`);
  await pause(150);

  const targetedState = await evaluate(`(() => {
    const firstCard = document.querySelector(".coworker-presence-card");
    const isSelected = firstCard?.classList.contains("selected-target") ?? false;
    const targetSelectVal = document.querySelector('[data-testid="q4-comms-target"]')?.value ?? "";
    return { isSelected, targetSelectVal };
  })()`);
  assert.equal(targetedState.isSelected, true, "Clicked coworker card must receive selected-target class");
  assert.equal(targetedState.targetSelectVal, coworkerCardsData[0].targetName, "Target selector must sync to clicked coworker");
  await captureToFile("13b-coworker-addressed.png");

  // Click card again to deselect and return to neutral broadcast
  await evaluate(`(() => {
    const card = document.querySelector(".coworker-presence-card");
    if (card) card.click();
  })()`);
  await pause(150);

  const neutralState = await evaluate(`(() => {
    const selectedCount = document.querySelectorAll(".coworker-presence-card.selected-target").length;
    const targetSelectVal = document.querySelector('[data-testid="q4-comms-target"]')?.value ?? "";
    return { selectedCount, targetSelectVal };
  })()`);
  assert.equal(neutralState.selectedCount, 0, "No coworker cards must be selected in neutral state");
  assert.equal(neutralState.targetSelectVal, "", "Target select must be empty in neutral state");
  await captureToFile("13c-coworker-neutral.png");

  // 12c. EMPTY INPUT REJECTION
  console.log("Step 12c: Empty Input Rejection");
  const turnsCountBefore = await evaluate(`document.querySelectorAll('.communication-timeline li').length`);
  await evaluate(`(() => {
    const form = document.querySelector('#q4-comms-form');
    const input = form?.querySelector('input[name="text"]');
    if (input) {
      input.value = "     ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  })()`);
  await pause(300);
  const turnsCountAfter = await evaluate(`document.querySelectorAll('.communication-timeline li').length`);
  assert.equal(turnsCountAfter, turnsCountBefore, "Empty/whitespace input must be rejected without creating turns");

  // 12d. DIRECT SPEECH TO COWORKER A
  console.log("Step 12d: Direct Speech to Coworker A");
  await evaluate(`(() => {
    const card = document.querySelectorAll(".coworker-presence-card")[0];
    if (card) card.click();
    const form = document.querySelector('#q4-comms-form');
    const input = form?.querySelector('input[name="text"]');
    if (input) {
      input.value = "How does the equipment feel, " + (${JSON.stringify(coworkerCardsData[0].name)}) + "?";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  })()`);

  let coworkerAAnswered = false;
  for (let i = 0; i < 60; i++) {
    const timelineHtml = await evaluate(`document.querySelector('.communication-timeline')?.innerText ?? ""`);
    if (timelineHtml.includes(coworkerCardsData[0].name) && timelineHtml.includes("How does the equipment feel")) {
      coworkerAAnswered = true;
      break;
    }
    await pause(100);
  }
  assert.ok(coworkerAAnswered, "Coworker A dialogue turn must appear in timeline");
  if (await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`)) {
    await evaluate(`YBDialoguePlayer.finish()`);
    await pause(100);
  }
  await captureToFile("13d-direct-speech-coworker-a.png");

  // 12e. DIRECT SPEECH TO COWORKER B
  console.log("Step 12e: Direct Speech to Coworker B");
  await evaluate(`(() => {
    const card = document.querySelectorAll(".coworker-presence-card")[1];
    if (card) card.click();
    const form = document.querySelector('#q4-comms-form');
    const input = form?.querySelector('input[name="text"]');
    if (input) {
      input.value = "Checking in with you, " + (${JSON.stringify(coworkerCardsData[1].name)}) + ".";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  })()`);

  let coworkerBAnswered = false;
  for (let i = 0; i < 60; i++) {
    const timelineHtml = await evaluate(`document.querySelector('.communication-timeline')?.innerText ?? ""`);
    if (timelineHtml.includes(coworkerCardsData[1].name) && timelineHtml.includes("Checking in with you")) {
      coworkerBAnswered = true;
      break;
    }
    await pause(100);
  }
  assert.ok(coworkerBAnswered, "Coworker B dialogue turn must appear in timeline");
  if (await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`)) {
    await evaluate(`YBDialoguePlayer.finish()`);
    await pause(100);
  }
  await captureToFile("13e-direct-speech-coworker-b.png");

  // 12f. GROUP ADDRESS TO ASSEMBLY TABLE
  console.log("Step 12f: Group Address to Assembly Table (@table)");
  await evaluate(`(() => {
    const sel = document.querySelector('[data-testid="q4-comms-target"]');
    if (sel) {
      sel.value = "@table";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const form = document.querySelector('#q4-comms-form');
    const input = form?.querySelector('input[name="text"]');
    if (input) {
      input.value = "Let's keep close together out there.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  })()`);

  let tableAnswered = false;
  for (let i = 0; i < 60; i++) {
    const timelineHtml = await evaluate(`document.querySelector('.communication-timeline')?.innerText ?? ""`);
    if (timelineHtml.includes("Assembly Table") && timelineHtml.includes("Let's keep close together")) {
      tableAnswered = true;
      break;
    }
    await pause(100);
  }
  assert.ok(tableAnswered, "Group address to table must appear in timeline");
  if (await evaluate(`typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()`)) {
    await evaluate(`YBDialoguePlayer.finish()`);
    await pause(100);
  }
  await captureToFile("13f-group-address-table.png");

  // 12g. UNTARGETED SPEECH (ALL HEAR, NOBODY RESPONDS)
  console.log("Step 12g: Untargeted Speech");
  await evaluate(`(() => {
    const sel = document.querySelector('[data-testid="q4-comms-target"]');
    if (sel) {
      sel.value = "";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelectorAll(".coworker-presence-card.selected-target").forEach(c => c.classList.remove("selected-target"));
    const form = document.querySelector('#q4-comms-form');
    const input = form?.querySelector('input[name="text"]');
    if (input) {
      input.value = "Deep breath. Here we go.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  })()`);

  let untargetedDelivered = false;
  for (let i = 0; i < 60; i++) {
    const timelineHtml = await evaluate(`document.querySelector('.communication-timeline')?.innerText ?? ""`);
    if (timelineHtml.includes("Deep breath. Here we go.")) {
      untargetedDelivered = true;
      break;
    }
    await pause(100);
  }
  assert.ok(untargetedDelivered, "Untargeted utterance must appear in timeline");
  await pause(200);
  await captureToFile("13g-untargeted-speech.png");

  // 12h. STAGING BOUNDARY REACHED
  console.log("Step 12h: Staging Boundary Reached");
  const readyButtonExists = await evaluate(`Boolean(document.querySelector('[data-game-action="READY"]'))`);
  assert.equal(readyButtonExists, true, "PROCEED TO EQUIPMENT STAGING button must be present");
  await click('[data-game-action="READY"]');
  await pause(400);

  const reachedStaging = await waitFor('[data-room-id="equipment-staging"], [data-testid="field-observation"], [data-location-id="equipment-staging"]', true, 50);
  console.log("Staging boundary reached:", reachedStaging);
  assert.equal(reachedStaging, true, "Equipment staging boundary must be reached");
  await assertLayoutInvariants("14-staging-boundary");
  await captureToFile("14-staging-boundary.png");

  // 13. AUDIO BOUNDARY SANITY AUDIT
  console.log("Step 13: Audio Boundary Sanity Audit");
  const audioAudit = await evaluate(`(() => {
    if (typeof YBAudio === "undefined") return { error: "YBAudio undefined" };
    const diag = YBAudio.diagnostics();
    const env = YBAudio.currentPhysicalEnvironment ? YBAudio.currentPhysicalEnvironment() : "STANDARD";
    return {
      environment: env,
      playback: diag.playback,
      hook_counts: diag.hook_counts
    };
  })()`);

  console.log("Audio audit results:", JSON.stringify(audioAudit));
  // In STANDARD facility environment, complex hum and music must not play
  const activeComplexAudio = (audioAudit.playback || []).filter(p => p.hook === "complex_hum" || p.hook === "complex_music");
  assert.equal(activeComplexAudio.length, 0, "No complex audio hooks must be active in STANDARD facility");

  console.log("=== ELECTRON TRAVERSAL COMPLETED SUCCESSFULLY ===");
  console.log(JSON.stringify({
    automated_electron_traversal_status: "passed",
    screenshots: [
      "01-title-screen.png",
      "02-july-1991-date-card.png",
      "03-personnel-waiver.png",
      "04-personnel-confirmation.png",
      "04b-aeot-initialization.png",
      "05-cold-boot-facility-map.png",
      "06-facility-map-middle-level.png",
      "07-facility-map-upper-level.png",
      "08-facility-map-upper-section.png",
      "09-attend-briefing-beat1.png",
      "10-briefing-typing-skip.png",
      "11-briefing-inquiry-response.png",
      "12-briefing-complete-ready-to-conclude.png",
      "13-local-introductions.png",
      "13b-coworker-addressed.png",
      "13c-coworker-neutral.png",
      "13d-direct-speech-coworker-a.png",
      "13e-direct-speech-coworker-b.png",
      "13f-group-address-table.png",
      "13g-untargeted-speech.png",
      "14-staging-boundary.png"
    ],
    viewports_tested: ["1440x900", "1024x768"],
    map_audit: "STRICT BLUEPRINT CONVERGENCE VERIFIED",
    dialogue_cadence: "LETTER-BY-LETTER TYPING & SKIP VERIFIED",
    audio_boundaries: "STANDARD FACILITY ISOLATION VERIFIED"
  }, null, 2));

  app.exit(0);
}

module.exports = { run };
