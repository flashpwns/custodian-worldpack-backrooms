"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { createOpenAIProvider } = require("../tools/ai-openai-provider"); const { validateIntent } = require("../tools/ai-adapter"); const { safeProviderForEnvironment } = require("../tools/launcher");
const context = { available_verbs: ["LOOK", "INSPECT"], aliases: [{ alias: "fixture-1" }] };
test("OpenAI provider sends strict observer-safe structured requests", async () => {
  const calls = []; const client = { responses: { create: async (request) => { calls.push(request); return { output_text: JSON.stringify({ kind: "action", actions: [{ verb: "INSPECT", target_alias: "fixture-1", parameters: {} }], clarification: null, public_reason: null }) }; } } };
  const provider = createOpenAIProvider({ client, model: "test-model" }); const intent = await provider.interpret({ player_text: "inspect fixture", context });
  assert.equal(validateIntent(intent, context).kind, "action"); assert.equal(calls[0].store, false); assert.equal(calls[0].text.format.type, "json_schema");
});
test("OpenAI provider rejects missing credentials", () => assert.throws(() => createOpenAIProvider({ apiKey: "" }), /not configured/));
test("OpenAI selection without a key falls back to the offline interpreter", () => {
  const provider = process.env.YELLOW_BEAST_AI_PROVIDER; const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; process.env.YELLOW_BEAST_AI_PROVIDER = "openai";
  try { const selected = safeProviderForEnvironment(); assert.equal(selected.provider.name, "deterministic-mock"); assert.match(selected.warning, /Offline Interpreter/); }
  finally { if (provider === undefined) delete process.env.YELLOW_BEAST_AI_PROVIDER; else process.env.YELLOW_BEAST_AI_PROVIDER = provider; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
