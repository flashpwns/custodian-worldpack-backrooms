"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ollamaTransport, selectPilot } = require("../tools/dialogue-reader-local-labeling");
test("Ollama receives only frozen render strings and explicit inference settings", async () => {
  let sent;
  const transport = ollamaTransport({ model: "installed:test", options: { temperature: 0, num_ctx: 4096 }, fetchImpl: async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ done: true, done_reason: "stop", model: "installed:test", message: { content: "ack - - new", thinking: "PRIVATE_REASONING_SENTINEL" }, load_duration: 1000000, prompt_eval_count: 10, eval_count: 4 }) };
  } });
  const reply = await transport({ system: "FROZEN_SYSTEM", user: "FROZEN_USER", context: { secret: "CANONICAL_SENTINEL" }, bindings: { hidden: "BINDING_SENTINEL" } });
  assert.equal(sent.url, "http://127.0.0.1:11434/api/chat");
  assert.deepEqual(sent.body.messages, [{ role: "system", content: "FROZEN_SYSTEM" }, { role: "user", content: "FROZEN_USER" }]);
  assert.equal(sent.body.think, false);
  assert.equal(sent.body.stream, false);
  assert.equal(reply.text, "ack - - new");
  assert.ok(!JSON.stringify(sent).includes("SENTINEL"));
  assert.ok(!JSON.stringify(reply).includes("PRIVATE_REASONING_SENTINEL"));
});
test("truncation is a failure, never a repaired/defaulted label", async () => {
  const transport = ollamaTransport({ model: "installed:test", options: {}, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ done: true, done_reason: "length", message: { content: "ask" } }) }) });
  await assert.rejects(transport({ system: "s", user: "u" }), { code: "LOCAL_TRUNCATED" });
});
test("pilot selection is deterministic, unique, and based only on observer input structure", () => {
  const groups = Array.from({ length: 8 }, (_, n) => ({ id: "test" + n, item: { input: { conversation: { inbound: n === 0 ? {} : null, requests: n === 1 ? [{}] : [] }, referent_candidates: n === 2 ? [{}, {}] : [], line: { tokens: new Array(n === 3 ? 15 : 4) } }, hidden: "DO_NOT_USE" } }));
  const a = selectPilot(groups); const b = selectPilot([...groups].reverse());
  assert.equal(a.length, 5);
  assert.equal(new Set(a.map((p) => p.group.id)).size, 5);
  assert.deepEqual(a.map((p) => p.group.id), b.map((p) => p.group.id));
});
