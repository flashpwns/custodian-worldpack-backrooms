"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { data, admission, read } = require("../tools/intake-lib");
const record = read("records/recovered-records.json").records[0];
const report = read("records/derived-reports.json").reports[0];
const validRecord = (item, evidence, observers, fixture, reports) => Boolean(evidence.has(item.origin_evidence_id) && observers.has(item.creator) && observers.has(item.recovery.recovering_actor) && observers.has(item.current_custodian) && fixture.recovery_events.includes(item.recovery.record_ref) && item.access_history.every(({ actor, record_ref }) => observers.has(actor) && fixture.access_events.includes(record_ref)) && item.review_history.every(({ actor, record_ref }) => observers.has(actor) && fixture.review_events.includes(record_ref)) && item.derived_report_refs.every((id) => reports.has(id)));
test("valid recovered record keeps recovery, access, and review distinct", () => {
  const fixture = read("records/record-review-smoke-test.json");
  assert.equal(validRecord(record, new Set(["threshold-baseline-instrument-measurement"]), new Set(["async-surveyor-alpha", "async-surveyor-beta"]), fixture, new Set([report.id])), true);
  assert.notEqual(record.access_history[0].record_ref, record.review_history[0].record_ref);
});
test("recovered record validation rejects missing origin, recovery, reviewer, and report input", () => {
  const fixture = read("records/record-review-smoke-test.json");
  const evidence = new Set(["threshold-baseline-instrument-measurement"]);
  const observers = new Set(["async-surveyor-alpha", "async-surveyor-beta"]);
  const reports = new Set([report.id]);
  assert.equal(validRecord({ ...record, origin_evidence_id: "missing" }, evidence, observers, fixture, reports), false);
  assert.equal(validRecord({ ...record, recovery: { ...record.recovery, record_ref: "missing" } }, evidence, observers, fixture, reports), false);
  assert.equal(validRecord({ ...record, review_history: [{ ...record.review_history[0], actor: "missing" }] }, evidence, observers, fixture, reports), false);
  assert.equal(report.evidence_inputs.includes(record.id), true);
  assert.equal(report.evidence_inputs.includes("missing"), false);
});
test("institutional interpretation cannot become authoritative truth", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("record-review-smoke-test-institutional-report-is-not-objective")), { ok: false, code: "INSUFFICIENT_AUTHORITY" });
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("damage-control-does-not-prove-universal-archive-system")), { ok: false, code: "PROHIBITED_CLAIM" });
});
