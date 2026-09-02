"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry } = require("../tools/authority-registry");
const { executeNatural } = require("../tools/ai-adapter");
const { createMockProvider } = require("../tools/ai-mock-provider");
const { startRun } = require("../tools/run-bootstrap");
const packageManifest = require("../package.json");

test("Pass 17 authority registry loads required doctrine and worldpack sources", () => {
  const registry = createRegistry();
  assert.equal(registry.healthy, true);
  assert.ok(registry.sourceMetadata().find((source) => source.id === "simulation-doctrine")?.sha256);
  assert.ok(registry.sourceMetadata().find((source) => source.id === "worldpack-clear-q4-institution")?.sha256);
});

test("desktop package includes every required runtime authority source", () => {
  const files = packageManifest.build.files;
  const includes = (relativePath) => files.reduce((included, entry) => {
    const excluded = entry.startsWith("!");
    const pattern = excluded ? entry.slice(1) : entry;
    const wildcard = pattern.indexOf("*");
    const prefix = wildcard >= 0 ? pattern.slice(0, wildcard) : pattern;
    const suffix = wildcard >= 0 ? pattern.slice(pattern.lastIndexOf("*") + 1) : "";
    const matches = pattern === relativePath || (wildcard >= 0 && (!prefix || relativePath.startsWith(prefix)) && (!suffix || relativePath.endsWith(suffix)));
    return matches ? !excluded : included;
  }, false);
  for (const source of createRegistry().sourceMetadata().filter((item) => item.required)) {
    assert.equal(includes(source.path), true, `desktop package omits required authority: ${source.path}`);
  }
});

test("final interpreter request contains ordered authority context and exact player submission", async () => {
  const run = startRun({ profile: "field-researcher", seed: "pass17-authority" }).run;
  let captured = null;
  const provider = { ...createMockProvider(), async interpret(input) { captured = input; return createMockProvider().interpret(input); } };
  const nonce = `runtime-authority-${Date.now()}`;
  await executeNatural({ run, provider, player_text: nonce, request_id: "pass17-authority-test" });
  assert.equal(captured.context.authority_context.order[0], "simulation-doctrine");
  assert.equal(captured.context.authority_context.sections.at(-2).content, nonce);
  assert.ok(captured.context.authority_context.sources.find((source) => source.id === "simulation-doctrine")?.sha256);
});
