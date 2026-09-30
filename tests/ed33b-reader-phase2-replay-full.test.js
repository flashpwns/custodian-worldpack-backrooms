"use strict";

// Reader Phase 2 -- FULL development-corpus replay (long-world tier): every characterized fixture under every wording
// provider it uses is captured through the real service; then
//   - the compact wire round-trips every legacy frame exactly (G1 codec, beyond the gold frames of ed33a);
//   - every model-facing render is pure, carries no canonical id and matches the pinned development manifest (the
//     frozen dev inputs the teacher / E4B arms and labelers will see);
//   - the replay harness is self-consistent (legacy arm scored against itself = 100%; every turn resolves).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const W = require("../tools/dialogue-reader-wire");
const R = require("../tools/dialogue-reader-render");
const RP = require("../tools/dialogue-reader-replay");

const MANIFEST = path.join(__dirname, "..", "docs", "acceptance", "reader-phase2", "dev-manifest.json");
const MANIFEST_SHA256 = "968e677b2f43f76dea8d0c94cb2544723b28b5ab6c9c5712413aecc1960f7cb9";
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("Full dev-corpus replay: wire round trip, render safety, pinned manifest and harness self-consistency", { timeout: 3600000 }, async () => {
  assert.equal(sha256(MANIFEST), MANIFEST_SHA256, "the development manifest changed without a governance pin update");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const items = await RP.captureCorpus();
  assert.equal(items.length, manifest.items.length, "the same replayed turns");
  const pinned = new Map(manifest.items.map((m) => [m.id, m]));
  let wire = 0;
  for (const item of items) {
    const frozen = RP.freezeItem(item);
    const want = pinned.get(item.id);
    assert.ok(want, `unknown turn ${item.id}`);
    assert.equal(frozen.render_digest, want.render_digest, `${item.id}: the model-facing render changed`);
    assert.equal(frozen.stratum, want.stratum);
    const render = R.renderReaderPrompt(item.input);
    assert.deepEqual(render, R.renderReaderPrompt(structuredClone(item.input)), `${item.id}: render is pure`);
    for (const id of [...Object.values(item.bindings.people), ...Object.values(item.bindings.requests), ...Object.values(item.bindings.referents)].filter((x) => typeof x === "string" && x.length > 8 && /[-:]/.test(x))) assert.ok(!render.user.includes(id), `${item.id}: canonical id in render (${id})`);
    if (item.l0.frame) {
      const text = W.encodeWire(item.l0.frame, item.input);
      const back = W.decodeWire(text, item.input);
      assert.ok(back.ok, `${item.id}: ${text}`);
      assert.deepEqual(back.frame, W.canonicalFrame(item.l0.frame), `${item.id}: ${text}`);
      wire += 1;
    }
  }
  assert.equal(wire, items.filter((i) => i.l0.frame).length);
  // Harness self-consistency: the legacy arm scored against its own frames is exact on every turn.
  const arm = RP.legacyArm(items);
  const gold = Object.fromEntries(items.filter((i) => i.l0.frame).map((i) => [i.id, i.l0.frame]));
  const { summary } = RP.scoreArm(items, arm, gold);
  assert.equal(summary.resolved_outcome.pct, 100);
  for (const [field, v] of Object.entries(summary.routing_fields)) assert.equal(v.pct, 100, field);
});
