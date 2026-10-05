"use strict";

// Reader Phase 0.5 -- FULL characterization and round-trip replay (long-world tier: several minutes).
//
// Every fixture session of the pinned characterization authority (J15 scripts, transcripts, Phase-0.5 scenarios,
// dev-corpus probes; both wording providers where they apply) is replayed through the production service and
// must match docs/acceptance/reader-phase0/characterization.json turn for turn; the round trip over the same
// fixtures must match docs/acceptance/reader-phase0/roundtrip.json row for row. The aggregate tier
// (tests/ed31a-reader-phase0.test.js) pins both artifacts' hashes and replays the scenario subset.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../tools/dialogue-characterize");
const RT = require("../tools/dialogue-reader-roundtrip");

const ARTIFACTS = path.join(__dirname, "..", "docs", "acceptance", "reader-phase0");

test("FULL characterization: current production behaviour replays identically to the pinned equivalence authority", { timeout: 1800000 }, async () => {
  const reference = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, "characterization.json"), "utf8"));
  const now = await C.characterize();
  const diffs = C.diffSnapshots(reference, now, 10);
  assert.deepEqual(diffs, [], JSON.stringify(diffs, null, 1));
  assert.equal(now.digest, reference.digest);
});

test("FULL round trip: every fixture turn's legacy -> ReaderFrame -> resolver -> frame assembly result matches the pinned artifact", { timeout: 1800000 }, async () => {
  const reference = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, "roundtrip.json"), "utf8"));
  const rows = await RT.run();
  assert.equal(rows.length, reference.rows.length);
  rows.forEach((row, i) => assert.deepEqual(row, require("./fixtures/reader-owner-policy-overlay").currentRoundtrip(reference.rows[i]), `row ${i}: ${row.fixture} ${row.text}`));
  const summary = RT.summarize(rows);
  assert.equal(summary.behaviour_equivalent_pct, reference.behaviour_equivalent_pct);
  assert.equal(summary.exact_pct, reference.exact_pct);
});
