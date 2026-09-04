"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..");

test("Y77-INV-1: Startup hygiene — no build-info.json in working tree and build-info prioritizes git", () => {
  const buildInfoJsonPath = path.join(REPO_ROOT, "desktop/build-info.json");
  assert.equal(
    fs.existsSync(buildInfoJsonPath),
    false,
    "desktop/build-info.json should not exist in working directory"
  );

  const buildInfoModule = require("../desktop/build-info");
  const info = buildInfoModule.read();
  assert.ok(info.commit, "build-info read() returns commit from git");
  assert.notEqual(info.commit, "SOURCE_RECORD", "git repo should not return SOURCE_RECORD placeholder");
  assert.ok(info.built_at, "build-info read() returns built_at");
});

test("Y77-INV-2: Settings consolidation — single canonical #openai form, no duplicate #provider-config", () => {
  const renderer = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/renderer.js"), "utf8");

  // Single credentials form
  assert.match(renderer, /<form id="openai"/, "canonical #openai form must exist");
  assert.doesNotMatch(renderer, /<form id="provider-config"/, "duplicate #provider-config form must be purged");

  // Supported providers in dropdown
  assert.match(renderer, /name="credential_provider"/, "credential provider selector exists in #openai");
  assert.match(renderer, /value="groq"/, "groq provider supported");
  assert.match(renderer, /value="gemini"/, "gemini provider supported");
  assert.match(renderer, /value="openrouter"/, "openrouter provider supported");
  assert.match(renderer, /value="openai"/, "openai provider supported");

  // Action buttons
  assert.match(renderer, /button\("Save access key", "submit"\)/, "Save access key button preserved for test compatibility");
  assert.match(renderer, /button\("Remove selected key", "remove-key"\)/, "Remove selected key button present");
  assert.match(renderer, /button\("Reset to defaults", "reset-preferences"\)/, "Reset to defaults button present");

  // Wiring routes
  assert.match(renderer, /document\.querySelector\("#openai"\)\.addEventListener\("submit"/);
  assert.match(renderer, /yellowBeast\.configureOpenAI/, "routes openai to configureOpenAI");
  assert.match(renderer, /yellowBeast\.configureProvider/, "routes other providers to configureProvider");
});

test("Y77-INV-3: Diagnostic record gated behind developer mode; empty worlds list clean", () => {
  const renderer = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/renderer.js"), "utf8");

  // Diagnostic record button gated
  assert.match(
    renderer,
    /current\.developer \? button\("Export diagnostic record", `diagnostic:\${world\.id}`\) : ""/,
    "Export diagnostic record must be gated to developer mode"
  );

  // Empty worlds list does not duplicate Create world button
  assert.doesNotMatch(
    renderer,
    /<li>\${button\("Create world", "new"\)}<\/li>/,
    "Empty worlds list must not render duplicate Create world button"
  );
  assert.match(
    renderer,
    /<li class="empty">No field files registered yet\.<\/li>/,
    "Empty worlds list renders clean status message"
  );
});

test("Y77-INV-4: Turn input control harmonized — input for physical turns, textarea for report", () => {
  const renderer = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/renderer.js"), "utf8");

  assert.match(renderer, /const naturalControl = isReport/, "naturalControl conditionally renders based on isReport");
  assert.match(renderer, /<textarea name="text" rows="6"/, "report phase uses textarea");
  assert.match(renderer, /<input type="text" name="text"/, "operational turn uses input[type=text]");
});

test("Y77-INV-5: Zombie surfaces purged from surfaces.js", () => {
  const surfacesSource = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/surfaces.js"), "utf8");

  assert.doesNotMatch(surfacesSource, /\blegacyCommunicationLanes\b/, "legacyCommunicationLanes must be purged");
  assert.doesNotMatch(surfacesSource, /\bfunction preField\b/, "dead preField function must be purged");
  assert.doesNotMatch(surfacesSource, /\bfunction field\b/, "dead field function must be purged");
  assert.doesNotMatch(surfacesSource, /\bphasePresentation\b/, "dead phasePresentation helper must be purged");

  const surfacesModule = require("../desktop/renderer/surfaces");
  assert.equal(typeof surfacesModule.render, "function");
  assert.equal(typeof surfacesModule.communicationLanes, "function");
  assert.equal(typeof surfacesModule.expeditionCockpit, "function");
});

test("Y77-INV-6: Consolidated click dispatcher — dead personnel-continue bypass removed", () => {
  const renderer = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/renderer.js"), "utf8");

  assert.doesNotMatch(renderer, /action === "personnel-continue"/, "dead personnel-continue bypass must be purged");
  assert.match(renderer, /action === "personnel-confirm-continue"/, "personnel confirmation handled in main dispatcher");
  assert.match(renderer, /action\.startsWith\("diagnostic:"\)/, "diagnostic export handled in main dispatcher");

  // Confirm no duplicate document.addEventListener("click" listeners
  const clickListeners = (renderer.match(/document\.addEventListener\("click"/g) || []).length;
  assert.equal(clickListeners, 1, "There must be exactly one document click listener in renderer.js");
});

test("Y77-INV-7: Packaging dependencies complete in tools/build-desktop.js", () => {
  const buildSource = fs.readFileSync(path.join(REPO_ROOT, "tools/build-desktop.js"), "utf8");

  const requiredAdditions = [
    "desktop/renderer/aeot-palette.css",
    "desktop/renderer/audio.js",
    "tools/ai-hosted-transport.js",
    "tools/ai-provider-pool.js",
    "tools/ai-openai-provider.js",
    "tools/ai-mock-provider.js",
    "tools/ai-living-provider.js",
    "tools/ai-living-turn.js"
  ];

  for (const dep of requiredAdditions) {
    assert.ok(buildSource.includes(dep), `tools/build-desktop.js must include ${dep}`);
  }
});

test("Y77-INV-8: Expedition-facing markup rejects inference provenance and implementation labels", () => {
  const surfaces = require("../desktop/renderer/surfaces");
  const rendererSource = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/renderer.js"), "utf8");
  const surfacesSource = fs.readFileSync(path.join(REPO_ROOT, "desktop/renderer/surfaces.js"), "utf8");

  const forbiddenExpeditionLabels = [
    /LIVE HOSTED AI/,
    /PROVIDER FAILURE/,
    /DETERMINISTIC FIELD RECORD/,
    /OBSERVER-SAFE PRESENTATION/,
    /OBSERVER-SAFE RECORD/
  ];

  for (const pattern of forbiddenExpeditionLabels) {
    assert.doesNotMatch(rendererSource, pattern, `renderer.js must not contain ${pattern}`);
    assert.doesNotMatch(surfacesSource, pattern, `surfaces.js must not contain ${pattern}`);
  }

  const mockProjection = {
    mode: { id: "field-researcher" },
    phase: { phase_id: "FIELD_OPERATION" },
    q4: { current_location: { name: "Utility Room" }, team: [], evidence: [] },
    scene: { narration: "Floor tiles and dim light.", narration_source: "hosted-model" },
    available_actions: []
  };
  const html = surfaces.expeditionCockpit(mockProjection, {});
  assert.match(html, /CURRENT FIELD RECORD/);
  for (const pattern of forbiddenExpeditionLabels) {
    assert.doesNotMatch(html, pattern, `Rendered cockpit must not contain ${pattern}`);
  }
});
