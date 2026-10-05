"use strict";

// Reader Phase 2 -- FULL development-corpus replay (long-world tier): every characterized fixture under every wording
// provider it uses is captured through the frozen-source real service; then
//   - the compact wire round-trips every legacy frame exactly (G1 codec, beyond the gold frames of ed33a);
//   - every model-facing render is pure, carries no canonical id and matches the pinned development manifest (the
//     frozen dev inputs the teacher / E4B arms and labelers will see);
//   - the replay harness is self-consistent (legacy arm scored against its contract-valid frames = 100%);
//   - Step 0.1: the distinct-render grouping, context tags, the frozen teacher sample and the rare-state shape counts
//     reproduce from the capture, and no ungrounded request argument is shown as canonical salience.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const W = require("../tools/dialogue-reader-wire");
const R = require("../tools/dialogue-reader-render");
const RP = require("../tools/dialogue-reader-replay");

const MANIFEST = path.join(__dirname, "..", "docs", "acceptance", "reader-phase2", "dev-manifest.json");
const MANIFEST_SHA256 = "d65f601176fb7c80b1c70abc20c70e17593d02db2e3d2adc466f150071025274";
const SAMPLE = path.join(__dirname, "..", "docs", "acceptance", "reader-phase2", "teacher-dev-sample.json");
const SAMPLE_SHA256 = "26f0ba7b69a3be175359ddad5fa0a798a094d1151dc1b1659c243b70aeb201c8";
const SHAPES = path.join(__dirname, "..", "docs", "acceptance", "reader-phase2", "rare-state-shapes.json");
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("Full dev-corpus replay: wire round trip, render safety, pinned manifest (distinct renders, occurrences, context tags), frozen teacher sample, rare-state shapes and harness self-consistency", { timeout: 3600000 }, async () => {
  assert.equal(sha256(MANIFEST), MANIFEST_SHA256, "the development manifest changed without a governance pin update");
  assert.equal(sha256(SAMPLE), SAMPLE_SHA256, "the preregistered teacher sample changed without a governance pin update");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const items = await require("./fixtures/reader-frozen-source").captureFrozenCorpus();
  assert.equal(items.length, manifest.items.length, "the same replayed turns");
  const pinned = new Map(manifest.items.map((m) => [m.id, m]));
  let wire = 0;
  for (const item of items) {
    const frozen = RP.freezeItem(item);
    const want = pinned.get(item.id);
    assert.ok(want, `unknown turn ${item.id}`);
    assert.equal(frozen.render_digest, want.render_digest, `${item.id}: the model-facing render changed`);
    assert.equal(frozen.stratum, want.stratum);
    assert.equal(Boolean(item.context_dependent), want.context_dependent, `${item.id}: context tag`);
    const render = R.renderReaderPrompt(item.input);
    assert.deepEqual(render, R.renderReaderPrompt(structuredClone(item.input)), `${item.id}: render is pure`);
    for (const id of [...Object.values(item.bindings.people), ...Object.values(item.bindings.requests), ...Object.values(item.bindings.referents)].filter((x) => typeof x === "string" && x.length > 8 && /[-:]/.test(x))) assert.ok(!render.user.includes(id), `${item.id}: canonical id in render (${id})`);
    // B7 indirect (Step 0.1): no canonical active place / anaphora candidate the observer's own words never grounded.
    const shown = [item.input.conversation.active_place, ...item.input.conversation.anaphora_candidates].filter(Boolean).map((l) => item.bindings.referents[l]);
    for (const omitted of item.bindings.salience_filter?.omitted ?? []) assert.ok(!shown.includes(omitted.id), `${item.id}: ungrounded ${omitted.arg} shown as canonical salience`);
    if (item.l0.frame) {
      const text = W.encodeWire(item.l0.frame, item.input);
      const back = W.decodeWire(text, item.input);
      assert.ok(back.ok, `${item.id}: ${text}`);
      assert.deepEqual(back.frame, W.canonicalFrame(item.l0.frame), `${item.id}: ${text}`);
      wire += 1;
    }
  }
  assert.equal(wire, items.filter((i) => i.l0.frame).length);
  const groups = RP.renderGroups(items);
  assert.deepEqual(RP.corpusCounts(items, groups), manifest.counts, "distinctness counts");
  assert.deepEqual(groups.map((g) => [g.id, g.occurrences.map((o) => o.id)]), manifest.groups.map((g) => [g.id, g.occurrences]), "render -> occurrence mapping");
  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  assert.deepEqual(RP.teacherDevSample(groups).headline.map((h) => h.id), sample.headline.map((h) => h.id), "the frozen teacher sample is reproducible from the capture");
  assert.deepEqual(RP.shapeCounts(items), JSON.parse(fs.readFileSync(SHAPES, "utf8")), "rare-state machine shape counts");
  // The pinned JSON-control selection (100 of the frozen 474) regenerates exactly from this capture, byte for byte.
  const controlText = fs.readFileSync(RP.JSON_CONTROL_SELECTION_FILE, "utf8");
  assert.equal(crypto.createHash("sha256").update(controlText).digest("hex"), "fb27ff65335d764c13675631d07c7a6159e6dffa19b01dd202362ca1d4d3784b", "the JSON-control selection changed without a governance pin update");
  assert.deepEqual(RP.jsonControlSelectionProblems(controlText, groups), [], "the pinned JSON-control selection regenerates from the capture");
  assert.equal(`${JSON.stringify(RP.jsonControlSelection(groups), null, 1)}\n`, controlText, "byte-identical regeneration");
  // Harness self-consistency: the legacy arm scored against its own CONTRACT-VALID frames is exact; a legacy frame that
  // is not contract-valid gold is excluded (gold_invalid), never compared.
  const arm = RP.legacyArm(groups);
  const L = require("../tools/dialogue-reader-labels");
  const gold = {};
  for (const g of groups.filter((x) => x.item.l0.frame)) {
    const wireText = W.encodeWire(g.item.l0.frame, g.item.input);
    const res = RP.resolveFrame(g.item, W.decodeWire(wireText, g.item.input).frame).resolution;
    const outcome = res.outcome === "clarify" ? "EXPECTED_CLARIFY" : "ACCEPT";
    const expected = outcome === "EXPECTED_CLARIFY" ? { field: "discourse_state", slot: res.clarification?.slot } : null;
    if (L.validateGoldFrame(g.item, wireText, outcome, expected).ok) gold[g.id] = { wire: wireText, outcome, expected_clarify: expected };
  }
  assert.ok(Object.keys(gold).length > 400, `${Object.keys(gold).length} contract-valid legacy frames`);
  const { summary } = RP.scoreArm(groups, arm, gold);
  assert.equal(summary.resolved_outcome.pct, 100, JSON.stringify(summary.status));
  assert.equal(summary.invalid_output, 0);
  for (const [field, v] of Object.entries(summary.routing_fields)) assert.equal(v.pct, 100, field);
});


test("CURRENT production replay: every live render matches the separately sealed engineering manifest, with exact codec and observer-safe pure rendering", { timeout: 3600000 }, async () => {
  const edition = require("./fixtures/reader-natural-conversation-edition").loadEdition();
  const items = await RP.captureCorpus();
  assert.deepEqual(items.map(i => { const frozen=RP.freezeItem(i); delete frozen.render_user; return frozen; }), edition.live_render_items);
  for (const item of items) {
    const render = R.renderReaderPrompt(item.input);
    assert.deepEqual(render,R.renderReaderPrompt(structuredClone(item.input)),item.id);
    for (const id of [...Object.values(item.bindings.people),...Object.values(item.bindings.requests),...Object.values(item.bindings.referents)].filter(x => typeof x === "string" && x.length > 8 && /[-:]/.test(x))) assert.ok(!render.user.includes(id),`${item.id}: canonical id leaked`);
    if (item.l0.frame) {
      const back = W.decodeWire(W.encodeWire(item.l0.frame,item.input),item.input);
      assert.ok(back.ok,item.id);
      assert.deepEqual(back.frame,W.canonicalFrame(item.l0.frame),item.id);
    }
  }
});
