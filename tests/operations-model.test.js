"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { data, admission } = require("../tools/intake-lib");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const evidence = JSON.parse(fs.readFileSync(path.join(root, "operations/evidence-objects.json"), "utf8")).evidence[0];
const validEvidence = (item, observers, rules, records) => Boolean(item.creator && observers.has(item.creator) && observers.has(item.current_custodian) && item.creation_ref && (item.creation_ref.kind !== "execution-rule" || rules.has(item.creation_ref.id)) && item.transfer_history.every((transfer) => observers.has(transfer.from) && observers.has(transfer.to) && records.has(transfer.record_ref)));
test("valid evidence provenance and private receipt resolve", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("motion-detected-states-alert-and-recording-behavior")), { ok: true, code: "ADMITTED" });
  assert.deepEqual(admission({ use: "scenario-optional" }, claimById.get("threshold-baseline-beta-private-message-access")), { ok: true, code: "ADMITTED" });
});
test("unresolved and rejected operational claims cannot become objective dependencies", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("motion-detected-alert-recipient-is-unresolved")), { ok: false, code: "CLAIM_NOT_ADMITTED" });
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("motion-detected-does-not-prove-universal-recording-doctrine")), { ok: false, code: "PROHIBITED_CLAIM" });
});
test("evidence validation rejects missing creator, invalid custody, and broken origin", () => {
  const observers = new Set(["async-surveyor-alpha", "async-surveyor-beta"]);
  const rules = new Set(["record-baseline-measurement"]);
  const records = new Set(["yb-return-check-message"]);
  const transferred = { ...evidence, current_custodian: "async-surveyor-beta", transfer_history: [{ id: "test-handoff", from: "async-surveyor-alpha", to: "async-surveyor-beta", record_ref: "yb-return-check-message" }] };
  assert.equal(validEvidence(evidence, observers, rules, records), true);
  assert.equal(validEvidence(transferred, observers, rules, records), true, "valid custody transfer");
  assert.equal(validEvidence({ ...evidence, creator: "" }, observers, rules, records), false);
  assert.equal(validEvidence({ ...evidence, current_custodian: "unknown" }, observers, rules, records), false);
  assert.equal(validEvidence({ ...evidence, creation_ref: { kind: "execution-rule", id: "missing" } }, observers, rules, records), false);
  assert.equal(validEvidence({ ...transferred, transfer_history: [{ ...transferred.transfer_history[0], record_ref: "missing" }] }, observers, rules, records), false, "broken transfer reference");
});
