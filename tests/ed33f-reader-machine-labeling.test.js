"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { candidate, classify } = require("../tools/dialogue-reader-machine-labeling");
const { validateLabels } = require("../tools/dialogue-reader-labels");
const RI = require("../tools/dialogue-reader-input");
const R = require("../tools/dialogue-reader-render");

test("full-wire agreement is separate machine consensus, never human gold", () => {
  const c = { valid: true, outcome: "ACCEPT", semantic_wire: "ack - - new" };
  assert.equal(classify(c, { ...c }), "MODEL_CONSENSUS");
  const { input } = RI.buildReaderInput({ raw: "okay", present: [], entities: [] });
  const g = { id: "test", render_digest: R.renderReaderPrompt(input).render_digest, item: { input } };
  const v = validateLabels([g], [{ id: "test", render_digest: g.render_digest, provenance: "MODEL_CONSENSUS" }]);
  assert.equal(Object.keys(v.gold).length, 0);
  assert.ok(v.problems.length);
});
test("uncertainty, invalidity, absent providers, and secondary-act disagreement cannot auto-accept", () => {
  const c = { valid: true, outcome: "ACCEPT", semantic_wire: "ack - - new" };
  assert.equal(classify(c, null), "AWAITING_PROVIDER");
  assert.equal(classify(c, { ...c, valid: false, transport_status: "reader_unavailable" }), "AWAITING_PROVIDER");
  assert.equal(classify(c, { ...c, valid: false }), "INVALID_OR_UNAVAILABLE");
  assert.equal(classify(c, { ...c, semantic_wire: "ack - - new; ask role - new" }), "DISAGREEMENT");
  const unclear = { ...c, outcome: "EXPECTED_CLARIFY" };
  assert.equal(classify(unclear, { ...unclear }), "AGREED_UNCERTAIN");
  assert.equal(classify(c, unclear), "DISAGREEMENT");
});
test("candidate uses existing decoder and resolver validation without inventing confidence", () => {
  const built = RI.buildReaderInput({ raw: "okay", present: [], entities: [] });
  const group = { id: "synthetic", render_digest: R.renderReaderPrompt(built.input).render_digest, item: { input: built.input, bindings: built.bindings, context: { snapshot: null, ledger: { requests: [] }, present: [] } } };
  const identity = { role: "teacher", family: "synthetic-test", model: "mock" };
  const valid = candidate(group, { status: "read", raw_wire: "ack - - new" }, identity);
  assert.equal(valid.valid, true);
  assert.equal(valid.outcome, "ACCEPT");
  assert.equal(valid.confidence, null);
  assert.equal(valid.provenance, "MACHINE_CANDIDATE");
  assert.equal(candidate(group, { status: "read", raw_wire: "nonsense" }, identity).valid, false);
  assert.equal(candidate(group, { status: "reader_unavailable", reason: "timeout" }, identity).valid, false);
});
