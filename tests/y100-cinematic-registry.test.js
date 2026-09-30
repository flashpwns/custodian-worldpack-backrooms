"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cinematicRegistry = require("../tools/cinematic-registry");

test("y100 — Section 24 visual/cinematic placeholder integration registry contains all 14 canonical identifiers", () => {
  assert.equal(cinematicRegistry.CANONICAL_PLACEHOLDER_IDS.length, 14);

  const expectedIds = [
    "DATE_CARD_JULY_1991",
    "WAIVER_RESPONSIBILITY",
    "ASYNC_BOOT",
    "BRIEFING_FEED_ACQUIRE",
    "BRIEFING_INFORMATIONAL_VIDEO",
    "BRIEFING_FEED_RELEASE",
    "THRESHOLD_ROOM_ENVIRONMENT",
    "THRESHOLD_CROSSING_ENTRY_4",
    "KV31_STATIC_TRANSITION",
    "KV31_BLAST_DOOR_OPEN",
    "THRESHOLD_RETURN_1_TO_4",
    "END_OF_SHIFT_NOTICE",
    "CATASTROPHIC_THRESHOLD_FAILURE",
    "CATASTROPHIC_NEWSPAPER"
  ];

  for (const id of expectedIds) {
    assert.ok(cinematicRegistry.isRegistered(id), `Expected ${id} to be registered`);
    const placeholder = cinematicRegistry.getPlaceholder(id);
    assert.ok(placeholder, `Placeholder ${id} must return definition`);
    assert.equal(placeholder.id, id);
    assert.ok(placeholder.slot && placeholder.slot.length > 3, `${id} must define runtime slot`);
    assert.ok(placeholder.trigger && placeholder.trigger.length > 3, `${id} must define trigger`);
    assert.ok(placeholder.completion_contract && placeholder.completion_contract.length > 5, `${id} must define completion contract`);
    assert.ok(placeholder.interruption_policy && placeholder.interruption_policy.length > 5, `${id} must define interruption policy`);
    assert.ok(placeholder.save_boundary && placeholder.save_boundary.length > 5, `${id} must define save boundary`);
    assert.ok(placeholder.fallback && typeof placeholder.fallback === "object", `${id} must define diegetic fallback`);
    assert.ok(placeholder.asset_interface && typeof placeholder.asset_interface === "object", `${id} must define asset interface`);
    assert.ok(placeholder.asset_interface.asset_id, `${id} asset interface must define asset_id`);
    assert.ok(placeholder.asset_interface.format, `${id} asset interface must define format`);
    assert.equal(placeholder.asset_interface.is_final, false, `${id} initial state must be development placeholder`);
  }
});

test("y100 — Catastrophic newspaper placeholder enforces project-owner boundary and return-to-title contract", () => {
  const news = cinematicRegistry.getPlaceholder("CATASTROPHIC_NEWSPAPER");
  assert.equal(news.asset_interface.is_final, false, "Catastrophic newspaper artwork is uncanonized development placeholder");
  assert.equal(news.fallback.is_final_artwork, false);
  assert.equal(news.fallback.location, "Santa Clarita");
  assert.equal(news.fallback.return_to_title_required, true);

  const failure = cinematicRegistry.getPlaceholder("CATASTROPHIC_THRESHOLD_FAILURE");
  assert.equal(failure.fallback.error_code, "THRESHOLD_NONFUNCTIONAL");
});

test("y100 — Replaceable asset interface enables project-owner final media drop-in", () => {
  const updated = cinematicRegistry.registerAsset("BRIEFING_INFORMATIONAL_VIDEO", "/assets/final/kane_briefing_video.mp4");
  assert.equal(updated.asset_interface.is_final, true);
  assert.equal(updated.asset_interface.resolved_path, "/assets/final/kane_briefing_video.mp4");
});

test("y100 — Shared cinematic registry loads identically in Node and browser UMD environments", () => {
  const sharedRegistry = require("../desktop/shared/cinematic-registry");
  assert.equal(sharedRegistry.CANONICAL_PLACEHOLDER_IDS.length, 14);
  assert.deepEqual(sharedRegistry.CANONICAL_PLACEHOLDER_IDS, cinematicRegistry.CANONICAL_PLACEHOLDER_IDS);

  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const sharedSource = fs.readFileSync(path.join(__dirname, "../desktop/shared/cinematic-registry.js"), "utf8");

  const browserWindow = {};
  const context = vm.createContext({ window: browserWindow });
  vm.runInContext(sharedSource, context);
  assert.ok(browserWindow.YBCinematicRegistry, "Browser window must receive YBCinematicRegistry global");
  assert.equal(browserWindow.YBCinematicRegistry.CANONICAL_PLACEHOLDER_IDS.length, 14);
  assert.equal(browserWindow.YBCinematicRegistry.isRegistered("DATE_CARD_JULY_1991"), true);
  assert.equal(browserWindow.YBCinematicRegistry.isRegistered("CATASTROPHIC_NEWSPAPER"), true);
});

