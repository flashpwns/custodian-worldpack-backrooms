"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const RI = require("../tools/dialogue-reader-input");
const R = require("../tools/dialogue-reader-render");
const { observerErrors, repairRender } = require("../tools/dialogue-reader-local-repair");
test("repair feedback contains only frozen observer data, raw outputs and observer errors", () => {
  const { input } = RI.buildReaderInput({ raw: "Hi", present: [], entities: [] });
  const original = { wire: "bad", resolution: { answer: "SECRET_CANONICAL_ANSWER" }, expected_clarify: { note: "SECRET_RESOLVER_HINT" }, labeler: { human_label: "SECRET_HUMAN_LABEL" } };
  const prior = { wire: "greet - - new", resolution: { answer: "SECRET_PRIOR_HINT" } };
  const frozen = R.renderReaderPrompt(input);
  const render = repairRender(input, original, prior);
  assert.equal(render.system, frozen.system);
  assert.ok(render.user.startsWith(frozen.user));
  assert.equal(render.feedback.original_machine_output, "bad");
  assert.equal(render.feedback.previous_repair_output, "greet - - new");
  assert.deepEqual(render.feedback.exact_observer_mechanical_errors, observerErrors(input, "bad"));
  assert.ok(!JSON.stringify(render).includes("SECRET_"));
  assert.ok(render.feedback.exact_observer_mechanical_errors.every((e) => ["V0", "V1", "V2"].includes(e.layer)));
  assert.notEqual(render.render_digest, frozen.render_digest);
  assert.equal(render.frozen_render_digest, frozen.render_digest);
});
test("diagnostics do not include V3 ambiguity slots or resolver outcomes", () => {
  const { input } = RI.buildReaderInput({ raw: "Who?", present: [], entities: [] });
  const errors = observerErrors(input, "ask ? - new f=wh");
  assert.ok(errors.every((e) => ["V0", "V1", "V2"].includes(e.layer)));
  assert.ok(!errors.some((e) => e.layer === "V3"));
});
