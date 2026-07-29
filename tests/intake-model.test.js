"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { data, admission } = require("../tools/intake-lib");

test("authoritative scenario use requires an admitted authoritative claim", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ claim_id: "threshold-baseline-is-pack-original", use: "authoritative-world-state" }, claimById.get("threshold-baseline-is-pack-original")), { ok: true, code: "ADMITTED" });
  assert.deepEqual(admission({ claim_id: "institutional-assertion-requires-separate-truth-evidence", use: "authoritative-world-state" }, claimById.get("institutional-assertion-requires-separate-truth-evidence")), { ok: false, code: "CLAIM_NOT_ADMITTED" });
});

test("prohibited and rejected material cannot become a scenario dependency", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ claim_id: "production-gallery-is-production-context", use: "reference" }, claimById.get("production-gallery-is-production-context")), { ok: false, code: "PROHIBITED_CLAIM" });
  assert.deepEqual(admission({ claim_id: "missing-claim", use: "reference" }, undefined), { ok: false, code: "MISSING_CLAIM" });
});
