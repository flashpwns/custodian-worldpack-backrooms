"use strict";

// Reader Phase 1 -- FULL shadow replay and FULL shadow inertness (long-world tier: several minutes).
//
// 1. Every characterized fixture turn (471) through the shadow comparator must match the pinned
//    docs/acceptance/reader-phase1/shadow-diff.json row for row (the aggregate tier, ed32a, pins its hash and
//    replays the scenario subset), and every mismatch must carry a known cause.
// 2. Every characterized session, under every wording provider the characterization uses for it, played with the
//    shadow OFF and ON: the whole canonical run, the world and the saved files are deep-equal at the end and again
//    after a cold reload.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SC = require("../tools/dialogue-shadow-compare");
const INERT = require("../tools/dialogue-shadow-inertness");
const { CAUSES } = require("../tools/dialogue-shadow-causes");

const ARTIFACT = path.join(__dirname, "..", "docs", "acceptance", "reader-phase1", "shadow-diff.json");

test("FULL shadow comparison: every characterized turn matches the pinned shadow-diff artifact; every mismatch has a known cause", { timeout: 1800000 }, async () => {
  const reference = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const rows = await SC.run();
  assert.equal(rows.length, reference.rows.length);
  rows.forEach((row, i) => assert.deepEqual(row, reference.rows[i], `row ${i}: ${row.fixture} ${row.text}`));
  const summary = SC.summarize(rows);
  assert.deepEqual(summary.levels, reference.levels);
  assert.equal(summary.unclassified_turns, 0, JSON.stringify(summary.unclassified, null, 1));
  for (const reason of Object.keys(summary.mismatch_reasons)) assert.ok(CAUSES[reason], reason);
});

test("FULL shadow inertness: shadow on vs off -- deep-equal canonical state, world and save payload, live and after a cold reload, every session and provider", { timeout: 3600000 }, async () => {
  const results = await INERT.run();
  const summary = INERT.summarize(results);
  assert.deepEqual(summary.differing, [], JSON.stringify(summary.differing, null, 1));
  assert.ok(summary.providers.includes("fallback") && summary.providers.includes("garbage"), "both wording providers");
  assert.ok(summary.with_mid_session_reloads >= 2, "sessions with mid-session cold reloads (plus an end-of-session cold reload everywhere)");
});
