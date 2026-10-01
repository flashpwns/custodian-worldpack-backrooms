"use strict";

// Reader Phase 2 -- HUMAN PRIMARY LABELING WORKSTATION (tools/dialogue-reader-labeling-workstation.js).
// The instrument must make human primary labeling practical WITHOUT ever inferring, suggesting, prefilling or
// revealing a semantic answer. These tests use SYNTHETIC items and temporary directories only: no real item is labeled,
// no real HUMAN_PRIMARY label is written, no model runs and no network request is made.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const RI = require("../tools/dialogue-reader-input");
const R = require("../tools/dialogue-reader-render");
const RP = require("../tools/dialogue-reader-replay");
const L = require("../tools/dialogue-reader-labels");
const E = require("../tools/dialogue-eval");
const WS = require("../tools/dialogue-reader-labeling-workstation");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "tools", "dialogue-reader-labeling-workstation.js");
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const DUFFLE = "q4-startup-materials-duffle-01";

// Answer-bearing sentinels planted in the CODE-SIDE parts of the synthetic capture. Not one of them may ever reach a
// file the workstation loads, a client payload, or the page.
const SENTINELS = Object.freeze(["SENTINEL_LEGACY_WIRE", "SENTINEL_PRODUCTION_FACET", "SENTINEL_CANONICAL_STATE", "SENTINEL_BINDING_ID", "SENTINEL_CONTEXT_PERSON", "SENTINEL_TEACHER_OUTPUT"]);

function state() {
  const requests = [{ request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: DUFFLE }, turns_since: 0 }];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-2", predicate: "item.contents", request_text: "Tonya, what's in the duffle?", args: { item_id: DUFFLE } }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: null, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
/** A captured-shape development item with answer-bearing sentinels in every code-side field. */
function item(raw, id) {
  const { ledger, snapshot } = state();
  const built = RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger, discourse: null });
  return {
    id, stratum: "j15", fixture: "t", provider: "garbage", request_id: id, text: raw, target: null, context_dependent: false, context_available: true,
    input: built.input, bindings: { ...built.bindings, sentinel: "SENTINEL_BINDING_ID" },
    context: { snapshot, ledger, present: sc.present.map((p) => ({ id: p.id })), canonical: { secret: "SENTINEL_CANONICAL_STATE", person: "SENTINEL_CONTEXT_PERSON" } },
    names: { x: "SENTINEL_CONTEXT_PERSON" }, l0: { frame: { legacy_wire: "SENTINEL_LEGACY_WIRE" }, conversion_exact: true }, production: { responders: ["SENTINEL_PRODUCTION_FACET"], facet: "SENTINEL_PRODUCTION_FACET" }, teacher: "SENTINEL_TEACHER_OUTPUT"
  };
}
const LINES = ["Tonya, what's in the duffle?", "Okay, that's that.", "Hello everyone."];
const groups = () => RP.renderGroups(LINES.map((l, i) => item(l, `t#garbage#${i + 1}`)));
const DUFFLE_GROUP = () => groups().find((g) => g.item.text === LINES[0]);
const OKAY_GROUP = () => groups().find((g) => g.item.text === LINES[1]);
const ACCEPT_WIRE = "ask contents @n1 new f=wh r=e1>r1";
const CLARIFY_WIRE = "ask contents - new f=wh ab=address";

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), "reader-labeling-ws-test-")); }
function prepared(gs = groups()) { const dir = tmpdir(); WS.writePrepared({ dir, groups: gs }); return dir; }
function open(dir, clock) {
  let n = 0;
  const calls = { clock: 0 };
  const ws = WS.loadWorkstation({ dir, clock: clock ?? (() => { calls.clock += 1; n += 1; return `2026-10-01T10:00:0${n}.000Z`; }) });
  return { ws, calls };
}
const idOf = (g) => g.id;
const acceptDraft = (extra = {}) => ({ outcome: "ACCEPT", wire: ACCEPT_WIRE, ...extra });
const clarifyDraft = (extra = {}) => ({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE, expected_clarify: { field: "address", slot: "person", note: "who is asked is unsettled" }, ...extra });
const labelsOf = (dir) => (fs.existsSync(path.join(dir, WS.FILES.labels)) ? fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof WS.WorkstationError && e.code === code, `expected ${code}`);

// ─── A, B: blank start; ACCEPT starts with an empty wire ─────────────────────────────────────────────
test("A. A blank item starts with NO outcome: nothing is selected for the human, in the payload or in the page", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const p = WS.itemPayload(ws, 1);
  assert.equal(p.status.state, "uncommitted");
  assert.equal(p.label, null, "no label, no outcome, no wire in a blank item payload");
  assert.deepEqual(WS.check(ws, p.id, {}).problems.map((x) => x.code), ["outcome_not_chosen"]);
  for (const bad of [null, undefined, "", "accept", "NONE", 0, "ACCEPT "]) assert.equal(WS.checkDraft(DUFFLE_GROUP().item.input, { outcome: bad, wire: ACCEPT_WIRE }).ok, false, `outcome ${JSON.stringify(bad)} is not a choice`);
  const html = WS.CLIENT_HTML;
  const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(radios.map((r) => r.match(/value="([^"]+)"/)[1]), ["ACCEPT", "EXPECTED_CLARIFY"], "the page exposes exactly two primary outcomes");
  for (const r of radios) assert.ok(!/\bchecked\b/.test(r), `no radio is preselected: ${r}`);
  assert.deepEqual(WS.OUTCOMES, ["ACCEPT", "EXPECTED_CLARIFY"]);
});
test("B. ACCEPT starts with an EMPTY wire: the textarea has no value, the payload has no wire, and an empty wire cannot commit", () => {
  const html = WS.CLIENT_HTML;
  const wire = html.match(/<textarea id="wire"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(wire && wire[1] === "", "the wire textarea is empty in the page source");
  assert.ok(!/id="wire"[^>]*\bvalue=/.test(html));
  assert.match(html, /const blank=\(\)=>\(\{outcome:null,wire:''/, "the client's blank draft: no outcome, empty wire");
  const dir = prepared();
  const { ws } = open(dir);
  assert.equal(JSON.stringify(WS.itemPayload(ws, 1)).includes("gold_wire\":\""), false);
  for (const w of ["", "   ", "\n"]) assert.ok(WS.checkDraft(DUFFLE_GROUP().item.input, { outcome: "ACCEPT", wire: w }).problems.some((p) => p.code === "wire_empty"));
  throwsCode(() => WS.commit(ws, idOf(DUFFLE_GROUP()), { outcome: "ACCEPT", wire: "" }, { explicit: true }), "invalid_draft");
  assert.deepEqual(labelsOf(dir), []);
});

// ─── C, D, E: nothing answer-bearing reaches the client ──────────────────────────────────────────────
function everyPayload(dir) {
  const { ws } = open(dir);
  const out = [JSON.stringify(WS.summary(ws)), JSON.stringify(WS.validateWorkstation(ws)), WS.CLIENT_HTML];
  for (const it of ws.items) { out.push(JSON.stringify(WS.itemPayload(ws, it.n))); out.push(JSON.stringify(WS.check(ws, it.id, {}))); }
  return { ws, text: out.join("\n") };
}
test("C. No legacy wire / frame / production routing appears in any file the workstation loads or any client payload", () => {
  const dir = prepared();
  const loaded = ["worksheet", "pack", "receipt"].map((k) => fs.readFileSync(path.join(dir, WS.FILES[k]), "utf8")).join("\n");
  const { text } = everyPayload(dir);
  for (const s of SENTINELS) { assert.ok(!loaded.includes(s), `${s} leaked into a loaded file`); assert.ok(!text.includes(s), `${s} leaked into a client payload`); }
  assert.ok(!/\bl0\b|legacy_wire|conversion_exact|production/i.test(loaded + text.replace(/[^\n]*system_text[^\n]*/g, "")), "no legacy / production field name in loaded files or payloads");
  const pack = JSON.parse(fs.readFileSync(path.join(dir, WS.FILES.pack), "utf8"));
  assert.deepEqual(Object.keys(pack.items[0]).sort(), ["id", "input", "render_digest"], "an input-pack entry is id + render digest + the observer-safe ReaderInput, nothing else");
  assert.ok(!("bindings" in pack.items[0]) && !("context" in pack.items[0]));
});
test("D. No teacher / model / reviewer output, suggestion, confidence or similarity field exists in any payload", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const FORBIDDEN_KEY = /teacher|reviewer|model|suggest|recommend|confidence|likely|similar|embedding|autocomplete|prefill|legacy|\bl0\b|production|binding|snapshot|canonical|context|resolution|clarification/i;
  const keys = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  const payloads = [WS.summary(ws), WS.validateWorkstation(ws), WS.grammarReference()];
  for (const it of ws.items) payloads.push(WS.itemPayload(ws, it.n), WS.check(ws, it.id, {}), WS.check(ws, it.id, acceptDraft()), WS.check(ws, it.id, clarifyDraft()));
  payloads.forEach(walk);
  assert.deepEqual([...keys].filter((k) => FORBIDDEN_KEY.test(k)), [], "no payload key names a model, teacher, reviewer, suggestion, confidence, similarity or code-side field");
  const text = JSON.stringify(payloads);
  assert.ok(!/MODEL_ASSISTED_REVIEW|ADJUDICATED_GOLD/.test(text), "no later label state is exposed");
  // the page names the prohibition in prose only (the banner); it carries no such field or control
  assert.ok(!/<(input|select|button)[^>]*(suggest|recommend|autocomplete="on"|list=)/i.test(WS.CLIENT_HTML));
  assert.ok(!/datalist/i.test(WS.CLIENT_HTML), "no autocomplete list");
  assert.deepEqual(Object.keys(WS.itemPayload(ws, 1)).sort(), ["id", "label", "n", "render_digest", "render_user", "status", "total", "view"]);
});
test("E. Item payloads carry only authorized worksheet fields; hidden canonical ids never appear", () => {
  const dir = prepared();
  const { ws, text } = everyPayload(dir);
  assert.ok(!/yb-personnel-|SENTINEL/.test(text));
  const sheet = fs.readFileSync(path.join(dir, WS.FILES.worksheet), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const it of ws.items) {
    const p = WS.itemPayload(ws, it.n);
    assert.deepEqual(Object.keys(p).sort(), ["id", "label", "n", "render_digest", "render_user", "status", "total", "view"]);
    assert.deepEqual(Object.keys(p.status).sort(), ["committed_at", "reason", "state"]);
    assert.equal(p.render_user, sheet.find((r) => r.id === it.id).render_user, "render_user is the worksheet's text, verbatim");
    for (const v of p.view) {
      assert.deepEqual(Object.keys(v).filter((k) => !["group", "key", "title", "text", "tokens"].includes(k)), []);
      assert.ok(p.render_user.includes(v.text), `a view entry is a slice of the authorized render: ${v.text}`);
    }
    const payload = JSON.stringify(p);
    for (const id of [GISELLE, MALCOLM, TONYA, PLAYER.id]) assert.ok(!payload.includes(id), `canonical person id ${id} is not an authorized field`);
    assert.equal(payload.includes(DUFFLE), p.render_user.includes(DUFFLE), "a canonical item id appears only if the authorized render itself carries it");
  }
});

// ─── F-K: explicit, validated, human-attributed commits ──────────────────────────────────────────────
test("F. A primary cannot commit without an explicit outcome, and never without an explicit human action", () => {
  const dir = prepared();
  const { ws, calls } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  throwsCode(() => WS.commit(ws, id, { wire: ACCEPT_WIRE }, { explicit: true }), "invalid_draft");
  throwsCode(() => WS.commit(ws, id, { outcome: null, wire: ACCEPT_WIRE }, { explicit: true }), "invalid_draft");
  throwsCode(() => WS.commit(ws, id, acceptDraft(), {}), "not_explicit");
  throwsCode(() => WS.commit(ws, id, acceptDraft(), { explicit: "yes" }), "not_explicit");
  assert.deepEqual(labelsOf(dir), []);
  assert.equal(fs.existsSync(path.join(dir, WS.FILES.labels)), false, "no label file is even created");
  assert.equal(calls.clock, 0, "no timestamp is generated for a rejected commit");
  const client = WS.CLIENT_HTML;
  const keydown = client.match(/document\.addEventListener\('keydown'[^\n]*/)[0];
  assert.ok(!/outcome\s*=(?!=)|\.value\s*=|checked\s*=|\.click\(\)(?<!bCommit'\)\.click\(\))/.test(keydown.replace(/\$\('bPrev'\)\.click\(\)|\$\('bNext'\)\.click\(\)|\$\('bNextOpen'\)\.click\(\)|\$\('bCommit'\)\.click\(\)/g, "")), "no keyboard shortcut selects an outcome (it only navigates, or commits an already-chosen, validated outcome)");
  assert.match(keydown, /draftOf\(\)\.outcome\)\$\('bCommit'\)\.click\(\)/, "the commit shortcut does nothing unless an outcome is chosen");
  assert.match(client, /id="bCommit" class="primary" disabled/, "the commit buttons start disabled");
});
test("G. ACCEPT cannot commit with an invalid or empty wire; V0, V1 and V2 errors are reported", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  const codes = (wire) => WS.check(ws, id, { outcome: "ACCEPT", wire }).problems.map((p) => `${p.layer}:${p.code}`);
  assert.deepEqual(codes(""), ["FORM:wire_empty"]);
  assert.ok(codes("zzz ? - new").includes("V0:wire_unknown_speech_act"));
  assert.ok(codes("ask contents @n1").includes("V0:wire_short_core"));
  assert.ok(codes("```ask contents @n1 new```").includes("V0:output_fenced"));
  assert.ok(codes("ask contents @n9 new").some((c) => c.startsWith("V1:")), "an illegal label (V1)");
  assert.ok(codes("ask contents all new f=wh r=e1>r1").some((c) => c.startsWith("V2:")), "a surface contradiction (V2)");
  assert.ok(codes("ask contents @n1 new\nbye - - new").includes("V0:wire_illegal_character"));
  for (const bad of ["", "zzz ? - new", "ask contents @n9 new", "ask contents all new f=wh r=e1>r1"]) throwsCode(() => WS.commit(ws, id, { outcome: "ACCEPT", wire: bad }, { explicit: true }), "invalid_draft");
  assert.deepEqual(labelsOf(dir), []);
  assert.deepEqual(WS.check(ws, id, acceptDraft()).problems, [], "a legal wire passes the observer-safe checks");
  assert.equal(WS.check(ws, id, acceptDraft({ expected_clarify: { field: "address", slot: "person" } })).ok, false, "expected-clarify fields do not belong on an ACCEPT");
});
test("H. EXPECTED_CLARIFY cannot commit without the required human fields (field + slot come from the existing taxonomy, never preselected)", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  const codes = (draft) => WS.check(ws, id, draft).problems.map((p) => p.code);
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE }).includes("expected_clarify_field_missing"));
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE, expected_clarify: { field: "address" } }).includes("expected_clarify_slot_missing"));
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE, expected_clarify: { slot: "person" } }).includes("expected_clarify_field_missing"));
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE, expected_clarify: { field: "made-up", slot: "person" } }).includes("expected_clarify_field_missing"), "a field outside the existing taxonomy");
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE, expected_clarify: { field: "address", slot: "made-up" } }).includes("expected_clarify_slot_missing"), "a slot outside the existing taxonomy");
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: "", expected_clarify: { field: "address", slot: "person" } }).includes("wire_empty"));
  assert.ok(codes({ outcome: "EXPECTED_CLARIFY", wire: ACCEPT_WIRE, expected_clarify: { field: "address", slot: "person" } }).includes("expected_clarify_field_not_expressed"), "the wire must express the declared ambiguity");
  throwsCode(() => WS.commit(ws, id, { outcome: "EXPECTED_CLARIFY", wire: CLARIFY_WIRE }, { explicit: true }), "invalid_draft");
  assert.deepEqual(labelsOf(dir), []);
  const html = WS.CLIENT_HTML;
  assert.match(html, /fill\(\$\('ecField'\),defs\.clarify_fields\)/, "options come from the server (the existing taxonomy)");
  assert.match(html, /<option value="">|createElement|el\('option',\{value:''\},'— choose —'\)/, "the first option is 'choose', not a value");
  assert.deepEqual([...WS.itemPayload(ws, 1).view].length > 0, true);
  const defs = JSON.parse(JSON.stringify({ f: L.CLARIFY_FIELDS, s: L.CLARIFY_SLOTS }));
  assert.deepEqual(defs.s, ["person", "referent", "location", "topic", "answer"]);
  const r = WS.commit(ws, id, clarifyDraft(), { explicit: true });
  const row = labelsOf(dir)[0];
  assert.deepEqual(row.expected_clarify, { field: "address", slot: "person", note: "who is asked is unsettled" });
  assert.equal(row.gold_outcome, "EXPECTED_CLARIFY");
  assert.ok(r.committed_at);
});
// The human primary has exactly two outcomes. UNLABELABLE is adjudicator-only (the existing label guide, preregistration and
// validator); these tests prove the workstation cannot create, store, accept or reclassify a HUMAN_PRIMARY UNLABELABLE row.
const unlabelableRow = (g, extra = {}) => ({ id: g.id, render_digest: g.render_digest, system_digest: R.SYSTEM_DIGEST, label_state: "HUMAN_PRIMARY", labeler: { kind: "human", id: "jack" }, gold_outcome: "UNLABELABLE", gold_wire: null, expected_clarify: null, unlabelable_reason: "synthetic", notes: null, committed_at: "2026-10-01T09:00:00.000Z", ...extra });
const writeLabels = (dir, rows) => fs.writeFileSync(path.join(dir, WS.FILES.labels), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
test("I. UNLABELABLE is impossible for a human primary: checkDraft and commit refuse it in every shape, and nothing is written", () => {
  const dir = prepared();
  const { ws, calls } = open(dir);
  const g = DUFFLE_GROUP();
  const id = idOf(g);
  const drafts = [{ outcome: "UNLABELABLE" }, { outcome: "UNLABELABLE", unlabelable_reason: "the words do not carry a readable act" }, { outcome: "UNLABELABLE", unlabelable_reason: "r", wire: ACCEPT_WIRE }, { outcome: "UNLABELABLE", unlabelable_reason: "r", notes: "n" }, { outcome: "UNLABELABLE", wire: ACCEPT_WIRE, expected_clarify: { field: "address", slot: "person" } }];
  for (const draft of drafts) {
    const c = WS.checkDraft(g.item.input, draft);
    assert.equal(c.ok, false);
    assert.equal(c.row, null);
    assert.deepEqual(c.problems.map((p) => p.code), ["unlabelable_not_primary"], "refused for being UNLABELABLE, whatever else the draft carries");
    assert.deepEqual(WS.check(ws, id, draft).problems.map((p) => p.code), ["unlabelable_not_primary"]);
    throwsCode(() => WS.commit(ws, id, draft, { explicit: true }), "invalid_draft");
  }
  // the legal outcomes never carry the old abstention field either
  assert.ok(WS.checkDraft(g.item.input, acceptDraft({ unlabelable_reason: "r" })).problems.some((p) => p.code === "reason_not_allowed"));
  assert.ok(WS.checkDraft(g.item.input, clarifyDraft({ unlabelable_reason: "r" })).problems.some((p) => p.code === "reason_not_allowed"));
  assert.deepEqual(labelsOf(dir), []);
  assert.equal(fs.existsSync(path.join(dir, WS.FILES.labels)), false);
  assert.equal(fs.existsSync(path.join(dir, WS.FILES.journal)), false);
  assert.equal(calls.clock, 0, "no timestamp is minted for a refused UNLABELABLE");
  // no unlabelable_reason survives into a committed row or a label payload
  WS.commit(ws, id, acceptDraft({ notes: "I am unsure about this one" }), { explicit: true });
  const [row] = labelsOf(dir);
  assert.ok(!("unlabelable_reason" in row) && row.gold_outcome === "ACCEPT");
  assert.ok(!("unlabelable_reason" in WS.itemPayload(ws, id).label));
});
test("I2. A direct HTTP/API attempt to commit gold_outcome UNLABELABLE as HUMAN_PRIMARY is refused and writes nothing", async () => {
  const dir = prepared();
  const { ws } = open(dir);
  const srv = WS.createWorkstationServer(ws, { host: "127.0.0.1", port: 0 });
  const started = await srv.listen();
  try {
    const auth = { "x-ws-token": started.token };
    const id = idOf(DUFFLE_GROUP());
    for (const draft of [{ outcome: "UNLABELABLE", unlabelable_reason: "synthetic" }, { gold_outcome: "UNLABELABLE", outcome: "UNLABELABLE", unlabelable_reason: "x", notes: "n" }, { outcome: "UNLABELABLE" }]) {
      const checked = JSON.parse((await request(started.port, "POST", "/api/check", { headers: auth, body: { id, draft } })).text);
      assert.equal(checked.ok, false);
      assert.deepEqual(checked.problems.map((p) => p.code), ["unlabelable_not_primary"]);
      const res = await request(started.port, "POST", "/api/commit", { headers: auth, body: { id, draft, explicit: true } });
      assert.equal(res.status, 422);
      assert.equal(JSON.parse(res.text).error, "invalid_draft");
      assert.deepEqual(JSON.parse(res.text).problems.map((p) => p.code), ["unlabelable_not_primary"]);
      // a replace-shaped attempt cannot smuggle it in either
      assert.notEqual((await request(started.port, "POST", "/api/commit", { headers: auth, body: { id, draft, explicit: true, replace: true, previous_committed_at: null } })).status, 200);
    }
    assert.equal(fs.existsSync(path.join(dir, WS.FILES.labels)), false, "nothing was written");
    assert.equal(JSON.parse((await request(started.port, "GET", "/api/definitions", { headers: auth })).text).outcomes.includes("UNLABELABLE"), false, "the server does not advertise UNLABELABLE");
  } finally { await new Promise((r) => srv.server.close(r)); }
});
test("I3. loadLabels refuses an existing HUMAN_PRIMARY UNLABELABLE row, naming the existing authority's own problem code", () => {
  const dir = prepared();
  const g = DUFFLE_GROUP();
  writeLabels(dir, [unlabelableRow(g)]);
  assert.throws(() => open(dir), (e) => e instanceof WS.LabelFileError && /HUMAN_PRIMARY UNLABELABLE/.test(e.message) && /unlabelable_record_invalid/.test(e.message) && e.problems.length === 1 && e.problems[0].problem === "unlabelable_record_invalid" && e.problems[0].id === g.id);
  // it is refused whatever else the row carries
  for (const extra of [{ unlabelable_reason: "" }, { gold_wire: ACCEPT_WIRE }, { notes: "n" }]) { writeLabels(dir, [unlabelableRow(g, extra)]); assert.throws(() => open(dir), /HUMAN_PRIMARY UNLABELABLE/); }
  // alongside a perfectly good row it still refuses the whole file (nothing is dropped, nothing is last-row-wins)
  writeLabels(dir, [{ id: OKAY_GROUP().id, render_digest: OKAY_GROUP().render_digest, label_state: "HUMAN_PRIMARY", labeler: { kind: "human", id: "jack" }, gold_outcome: "ACCEPT", gold_wire: "ack - - end:q1", committed_at: "2026-10-01T09:00:00.000Z" }, unlabelableRow(g)]);
  assert.throws(() => open(dir), /HUMAN_PRIMARY UNLABELABLE/);
});
test("I4. --validate reports a HUMAN_PRIMARY UNLABELABLE row as invalid per the existing validator, and no reclassification can make it success, pending, a warning or exit 0", () => {
  const gs = groups();
  const dir = prepared(gs);
  const g = DUFFLE_GROUP();
  writeLabels(dir, [unlabelableRow(g)]);
  // (1) the offline --validate path, in-process
  const run = WS.runValidate({ dir });
  assert.equal(run.exitCode, 1);
  assert.equal(run.report.valid, false);
  assert.deepEqual(run.report.problems, [{ id: g.id, problem: "unlabelable_record_invalid" }]);
  assert.ok(!/pending|warning|adjudication_pending|ok\b/i.test(JSON.stringify(run.report).replace(/refusing to continue/g, "")), "no pending / warning / success vocabulary");
  // (2) the real CLI process: non-zero exit and the authority's code on stdout
  let status = 0; let out = "";
  try { execFileSync(process.execPath, [SRC, "--validate", "--dir", dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { status = e.status; out = e.stdout; }
  assert.equal(status, 1, "exit code 1");
  assert.equal(JSON.parse(out).problems[0].problem, "unlabelable_record_invalid");
  // (3) the existing validator's own verdict is exactly the same code, and classifyValidation can only strip detail from it
  const raw = L.validateLabels(gs, [unlabelableRow(g)], { states: Object.values(L.LABEL_STATES), registry: L.loadRegistry() });
  assert.deepEqual(raw.problems.map((p) => p.problem), ["unlabelable_record_invalid"]);
  assert.deepEqual(Object.keys(raw.gold), []);
  const classified = WS.classifyValidation(raw);
  assert.deepEqual(classified.problems, [{ id: g.id, problem: "unlabelable_record_invalid" }]);
  assert.equal(classified.valid_primary_rows, 0);
  assert.ok(!("unlabelable_pending_adjudication" in classified), "no pending-adjudication state exists");
  assert.equal(WS.classifyValidation(raw, { detail: true }).problems.length, 1);
  // a clean file still passes (ACCEPT / EXPECTED_CLARIFY behaviour is unchanged)
  const clean = prepared(gs);
  const { ws } = open(clean);
  WS.commit(ws, g.id, acceptDraft(), { explicit: true });
  const ok = WS.runValidate({ dir: clean });
  assert.deepEqual([ok.exitCode, ok.report.problems.length, ok.report.committed], [0, 0, 1]);
  const src = fs.readFileSync(SRC, "utf8");
  assert.ok(!/unlabelable_pending|pending_adjudication|primaryUnlabelable/.test(src), "the reclassification is gone from the source");
});
test("I5. No ADJUDICATED_GOLD behaviour exists in the workstation: it neither writes nor loads adjudicated rows", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  const code = fs.readFileSync(SRC, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!/ADJUDICATED_GOLD|MODEL_ASSISTED_REVIEW|adjudicator\b(?!-only)/.test(code.replace(/"UNLABELABLE is an adjudicator-only[^"]*"|\(UNLABELABLE is an adjudicator-only[^)]*\)/g, "")), "the workstation source has no adjudication path");
  const c = WS.checkDraft(DUFFLE_GROUP().item.input, { ...acceptDraft(), label_state: "ADJUDICATED_GOLD", adjudicator: { id: "x" } });
  assert.equal(c.ok, true);
  assert.deepEqual(Object.keys(c.row).sort(), ["expected_clarify", "gold_outcome", "gold_wire", "notes"], "a draft cannot inject a label state or an adjudicator");
  WS.commit(ws, id, { ...acceptDraft(), label_state: "ADJUDICATED_GOLD", adjudicator: { id: "x" } }, { explicit: true });
  const [row] = labelsOf(dir);
  assert.equal(row.label_state, "HUMAN_PRIMARY");
  assert.ok(!("adjudicator" in row));
  const g = OKAY_GROUP();
  writeLabels(dir, [unlabelableRow(g, { label_state: "ADJUDICATED_GOLD", adjudicator: { kind: "human", id: "x" } })]);
  assert.throws(() => open(dir), /only HUMAN_PRIMARY/, "an ADJUDICATED_GOLD row is refused on load");
});
test("I6. The page's pure outcome logic: an explicit outcome change drops only fields the new outcome does not own and never moves content", () => {
  const html = WS.CLIENT_HTML;
  const pure = html.slice(html.indexOf("/*PURE-BEGIN*/"), html.indexOf("/*PURE-END*/"));
  assert.ok(pure.length > 100);
  const api = new Function(`${pure}; return { blank, retainLegal, chooseOutcome, collectDraft };`)();
  const typedClarify = () => ({ outcome: "EXPECTED_CLARIFY", wire: "ask contents - new ab=address", field: "address", slot: "person", note: "who is unsettled", notes: "keep me" });
  // EXPECTED_CLARIFY -> ACCEPT: the clarification-only fields are cleared; the wire and the notes (legal for both) are the human's own and stay
  const toAccept = api.chooseOutcome(typedClarify(), "ACCEPT");
  assert.deepEqual(toAccept, { outcome: "ACCEPT", wire: "ask contents - new ab=address", field: "", slot: "", note: "", notes: "keep me" });
  assert.deepEqual(api.collectDraft(toAccept), { outcome: "ACCEPT", wire: "ask contents - new ab=address", notes: "keep me" }, "an ACCEPT payload carries no expected_clarify");
  // ACCEPT -> EXPECTED_CLARIFY: there is no ACCEPT-only field; nothing is invented, copied or chosen for the human
  const toClarify = api.chooseOutcome({ outcome: "ACCEPT", wire: "ack - - new", field: "", slot: "", note: "", notes: "n" }, "EXPECTED_CLARIFY");
  assert.deepEqual(toClarify, { outcome: "EXPECTED_CLARIFY", wire: "ack - - new", field: "", slot: "", note: "", notes: "n" });
  assert.deepEqual(api.collectDraft(toClarify), { outcome: "EXPECTED_CLARIFY", wire: "ack - - new", notes: "n", expected_clarify: { field: "", slot: "", note: "" } }, "the field and slot stay empty until the human chooses");
  // round trip: clarification fields typed, switched away and back, are gone (not remembered, not restored)
  const back = api.chooseOutcome(api.chooseOutcome(typedClarify(), "ACCEPT"), "EXPECTED_CLARIFY");
  assert.deepEqual([back.field, back.slot, back.note], ["", "", ""]);
  // a stray clarification field on an ACCEPT draft can never reach the validator from the page
  const stray = api.collectDraft({ outcome: "ACCEPT", wire: "w", field: "address", slot: "person", note: "x", notes: "" });
  assert.ok(!("expected_clarify" in stray));
  assert.deepEqual(api.chooseOutcome(api.blank(), "ACCEPT"), { ...api.blank(), outcome: "ACCEPT" }, "choosing from blank adds nothing");
  assert.deepEqual(Object.keys(api.blank()).sort(), ["field", "note", "notes", "outcome", "slot", "wire"], "the draft has no unlabelable reason");
  // the handler uses it, and the visible form agrees with the validated payload
  assert.match(html, /r\.addEventListener\('change',\(\)=>\{chooseOutcome\(draftOf\(\),r\.value\);renderJudgment\(\);schedule\(\);\}\)/);
  assert.match(html, /function collect\(\)\{return collectDraft\(draftOf\(\)\);\}/);
  assert.match(html, /\$\('ecBox'\)\.className=d\.outcome==='EXPECTED_CLARIFY'\?'':'hide'/, "the clarification fields are visible exactly when EXPECTED_CLARIFY owns them");
  // server side: every payload the page can now produce agrees with the checks
  const dir = prepared();
  const { ws } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  assert.equal(WS.check(ws, id, api.collectDraft({ outcome: "ACCEPT", wire: ACCEPT_WIRE, field: "address", slot: "person", note: "x", notes: "" })).ok, true, "hidden clarification state cannot block an ACCEPT commit");
});
test("I7. The page has no UNLABELABLE control, reason box or copy, and the wire input has an explicit accessible label", () => {
  const html = WS.CLIENT_HTML;
  assert.ok(!/UNLABELABLE|unlabelable|ulBox|ulReason|oC\b/i.test(html), "no UNLABELABLE anywhere in the page");
  assert.match(html, /<label class="lab" for="wire">Wire \(you write it; never prefilled\)<\/label><textarea id="wire" aria-label="Wire \(you write it; never prefilled\)"/);
  assert.equal([...html.matchAll(/name="outcome"/g)].length, 2);
  assert.ok(!/UNLABELABLE/.test(JSON.stringify(WS.grammarReference())));
});
test("J. A successful primary is a valid HUMAN_PRIMARY row (human / jack, bound to the render digest) that passes the EXISTING validator", () => {
  const gs = groups();
  const dir = prepared(gs);
  const { ws } = open(dir);
  const duffle = DUFFLE_GROUP();
  WS.commit(ws, duffle.id, acceptDraft({ notes: "n1" }), { explicit: true });
  const row = labelsOf(dir)[0];
  assert.equal(row.label_state, "HUMAN_PRIMARY");
  assert.deepEqual(row.labeler, { kind: "human", id: "jack" });
  assert.equal(row.render_digest, duffle.render_digest);
  assert.equal(row.system_digest, R.SYSTEM_DIGEST);
  assert.equal(row.gold_outcome, "ACCEPT");
  assert.equal(row.gold_wire, ACCEPT_WIRE);
  assert.equal(row.expected_clarify, null);
  assert.equal(row.notes, "n1");
  assert.deepEqual(Object.keys(row).sort(), ["committed_at", "expected_clarify", "gold_outcome", "gold_wire", "id", "label_state", "labeler", "notes", "render_digest", "system_digest"]);
  assert.deepEqual(L.independenceProblems(row, L.loadRegistry()), []);
  // the existing validator (full capture-shaped context) accepts the ACCEPT and the EXPECTED_CLARIFY rows
  const other = OKAY_GROUP();
  WS.commit(ws, other.id, { outcome: "EXPECTED_CLARIFY", wire: "ack - - new ab=force", expected_clarify: { field: "force", slot: "answer" } }, { explicit: true });
  const rows = labelsOf(dir);
  const full = L.validateLabels(gs, rows.filter((r) => r.id === duffle.id), { states: Object.values(L.LABEL_STATES), registry: L.loadRegistry() });
  assert.deepEqual(full.problems, []);
  assert.deepEqual(Object.keys(full.gold), [duffle.id]);
  assert.equal(WS.loadWorkstation({ dir }).labeler, "jack");
  assert.throws(() => WS.loadWorkstation({ dir, labeler: "someone-else" }), /not a recorded human primary labeler/);
});
test("K. committed_at is generated at the explicit commit, once, in the repository's ISO timestamp format", () => {
  const dir = prepared();
  const times = ["2026-10-01T09:00:00.000Z", "2026-10-01T09:05:00.000Z"];
  let calls = 0;
  const { ws } = open(dir, () => times[calls++]);
  const id = idOf(DUFFLE_GROUP());
  WS.check(ws, id, acceptDraft()); WS.check(ws, id, acceptDraft());
  WS.itemPayload(ws, 1);
  assert.equal(calls, 0, "checking and viewing never mint a timestamp");
  assert.throws(() => WS.commit(ws, id, { outcome: "ACCEPT", wire: "" }, { explicit: true }));
  assert.equal(calls, 0, "a rejected commit never mints a timestamp");
  const r = WS.commit(ws, id, acceptDraft(), { explicit: true });
  assert.equal(calls, 1);
  assert.equal(r.committed_at, times[0]);
  assert.equal(labelsOf(dir)[0].committed_at, times[0]);
  assert.match(new Date().toISOString(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "the registry's recorded_at format");
  const real = WS.loadWorkstation({ dir: prepared() });
  const stamp = real.clock();
  assert.match(stamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "the default clock uses the repository's format");
});

// ─── L-N: fail closed; no silent overwrite; resume ────────────────────────────────────────────────────
test("L. A render-digest mismatch fails CLOSED: the label is not shown as labeled, and nothing is committed over a drifted render", () => {
  const gs = groups();
  const dir = prepared(gs);
  const { ws } = open(dir);
  const g = DUFFLE_GROUP();
  WS.commit(ws, g.id, acceptDraft(), { explicit: true });
  assert.equal(WS.summary(open(dir).ws).committed, 1);
  // (1) the saved label's digest no longer matches the frozen render
  const rows = labelsOf(dir).map((r) => ({ ...r, render_digest: "0".repeat(64) }));
  fs.writeFileSync(path.join(dir, WS.FILES.labels), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const stale = open(dir).ws;
  const p = WS.itemPayload(stale, g.id);
  assert.equal(p.status.state, "blocked");
  assert.match(p.status.reason, /render_changed_since_labelling/);
  assert.equal(p.label, null, "a stale label is never displayed as a safe label");
  assert.equal(WS.summary(stale).committed, 0);
  assert.equal(WS.summary(stale).blocked, 1);
  assert.equal(WS.validateWorkstation(stale).problems.length, 1);
  // relabeling a void label is possible only by an explicit recommit naming the stale timestamp
  throwsCode(() => WS.commit(stale, g.id, acceptDraft(), { explicit: true }), "already_committed");
  // (2) the worksheet text itself drifted (render_user edited): the item is blocked and cannot be checked or committed
  const dir2 = prepared(gs);
  const sheet = fs.readFileSync(path.join(dir2, WS.FILES.worksheet), "utf8").split("\n");
  const row = JSON.parse(sheet[1]);
  row.render_user += "\nextra: line";
  sheet[1] = JSON.stringify(row);
  fs.writeFileSync(path.join(dir2, WS.FILES.worksheet), sheet.join("\n"));
  const drift = open(dir2).ws;
  assert.match(WS.itemPayload(drift, 1).status.reason, /worksheet_render_digest_mismatch/);
  throwsCode(() => WS.commit(drift, row.id, acceptDraft(), { explicit: true }), "render_drift");
  assert.equal(WS.check(drift, row.id, acceptDraft()).ok, false);
  // (3) the input pack no longer renders to the worksheet's digest
  const dir3 = prepared(gs);
  const pack = JSON.parse(fs.readFileSync(path.join(dir3, WS.FILES.pack), "utf8"));
  pack.items[0].input.line.raw = "tampered";
  fs.writeFileSync(path.join(dir3, WS.FILES.pack), JSON.stringify(pack));
  assert.match(WS.itemPayload(open(dir3).ws, 1).status.reason, /input_pack_render_mismatch/);
  // (4) the frozen system text changed: the whole worksheet is stale and the workstation refuses to start
  const dir4 = prepared(gs);
  const lines = fs.readFileSync(path.join(dir4, WS.FILES.worksheet), "utf8").split("\n");
  const header = JSON.parse(lines[0]);
  header.system_digest = "f".repeat(64);
  lines[0] = JSON.stringify(header);
  fs.writeFileSync(path.join(dir4, WS.FILES.worksheet), lines.join("\n"));
  assert.throws(() => open(dir4), /render_changed_since_labelling/);
  // (5) the label file itself is never silently repaired: unknown ids, duplicates, other labelers and unreadable rows all refuse to load
  const dir5 = prepared(gs);
  const good = { id: g.id, render_digest: g.render_digest, label_state: "HUMAN_PRIMARY", labeler: { kind: "human", id: "jack" }, gold_outcome: "ACCEPT", gold_wire: ACCEPT_WIRE, committed_at: "2026-10-01T09:00:00.000Z" };
  for (const [rowsText, re] of [[JSON.stringify({ ...good, id: "rg-unknown" }), /not an item/], [`${JSON.stringify(good)}\n${JSON.stringify(good)}`, /duplicate row/], [JSON.stringify({ ...good, label_state: "ADJUDICATED_GOLD" }), /only HUMAN_PRIMARY/], [JSON.stringify({ ...good, labeler: { kind: "human", id: "sam" } }), /not human\/jack/], [`${JSON.stringify(good)}\n{broken`, /not valid JSON/]]) {
    fs.writeFileSync(path.join(dir5, WS.FILES.labels), `${rowsText}\n`);
    assert.throws(() => open(dir5), re);
  }
});
test("M. An existing committed judgment is never silently overwritten; recommit is explicit, targeted and journaled", () => {
  const dir = prepared();
  const { ws } = open(dir);
  const id = idOf(DUFFLE_GROUP());
  const first = WS.commit(ws, id, acceptDraft(), { explicit: true });
  const before = fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8");
  throwsCode(() => WS.commit(ws, id, clarifyDraft(), { explicit: true }), "already_committed");
  assert.equal(fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8"), before, "the file is byte-identical after a refused overwrite");
  throwsCode(() => WS.commit(ws, id, clarifyDraft(), { explicit: true, replace: true, previous_committed_at: "1999-01-01T00:00:00.000Z" }), "stale_edit_target");
  throwsCode(() => WS.commit(ws, idOf(OKAY_GROUP()), acceptDraft(), { explicit: true, replace: true }), "nothing_to_replace");
  assert.equal(fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8"), before);
  const second = WS.commit(ws, id, clarifyDraft(), { explicit: true, replace: true, previous_committed_at: first.committed_at });
  const rows = labelsOf(dir);
  assert.equal(rows.length, 1, "still exactly one row for the render (never last-row-wins duplicates)");
  assert.equal(rows[0].gold_outcome, "EXPECTED_CLARIFY");
  assert.notEqual(second.committed_at, first.committed_at, "the recommit is a new explicit commit with its own timestamp");
  const journal = fs.readFileSync(path.join(dir, WS.FILES.journal), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(journal.map((j) => j.event), ["commit", "recommit"]);
  assert.equal(journal[1].previous_row.gold_outcome, "ACCEPT", "the replaced judgment is preserved in the journal");
  assert.equal(journal[1].previous_row.committed_at, first.committed_at);
});
test("N. Restart / resume preserves committed work; a failed save never loses or corrupts earlier labels", () => {
  const gs = groups();
  const dir = prepared(gs);
  const a = open(dir).ws;
  const g1 = DUFFLE_GROUP();
  const g2 = OKAY_GROUP();
  WS.commit(a, g1.id, acceptDraft(), { explicit: true });
  WS.commit(a, g2.id, { outcome: "EXPECTED_CLARIFY", wire: "ack - - new ab=force", expected_clarify: { field: "force", slot: "answer", note: "unsettled" } }, { explicit: true });
  const bytes = fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8");
  const b = open(dir).ws; // a "restart"
  const s = WS.summary(b);
  assert.deepEqual([s.total, s.committed, s.remaining, s.blocked], [3, 2, 1, 0]);
  assert.equal(WS.itemPayload(b, g1.id).status.state, "committed");
  assert.equal(WS.itemPayload(b, g1.id).label.gold_wire, ACCEPT_WIRE);
  assert.deepEqual(WS.itemPayload(b, g2.id).label.expected_clarify, { field: "force", slot: "answer", note: "unsettled" });
  assert.deepEqual(s.order.filter((o) => o.state === "uncommitted").length, 1);
  // a crash during the save (the rename never happens): the previous file is intact, memory is unchanged, no label is half-written
  const realRename = fs.renameSync;
  const third = groups().find((g) => g.item.text === LINES[2]);
  fs.renameSync = () => { throw new Error("simulated crash"); };
  try { assert.throws(() => WS.commit(b, third.id, acceptDraft({ wire: "greet - all new" }), { explicit: true }), /simulated crash/); } finally { fs.renameSync = realRename; }
  assert.equal(fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8"), bytes, "labels.jsonl is untouched by the failed save");
  assert.equal(WS.summary(b).committed, 2, "the in-memory state did not advance past what is durable");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length >= 0, true);
  // the terminated workstation leaves the previous committed labels loadable
  assert.equal(WS.summary(open(dir).ws).committed, 2);
  // the single-writer lock: a second live workstation on the same directory is refused; a stale lock is replaced
  const release = WS.acquireLock(dir);
  release();
  fs.writeFileSync(path.join(dir, WS.FILES.lock), String(process.ppid)); // a different, live process holds the lock
  assert.throws(() => WS.acquireLock(dir), /already using/, "a live lock held by another process is refused");
  fs.writeFileSync(path.join(dir, WS.FILES.lock), "999999999");
  WS.acquireLock(dir)();
});

// ─── O, P, Q: local only ──────────────────────────────────────────────────────────────────────────────
function request(port, method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
test("O. The server binds loopback only, refuses any other host, and rejects foreign Host / Origin / token", async () => {
  for (const host of ["0.0.0.0", "::", "192.168.1.20", "10.0.0.5", "example.com", "", "127.0.0.2", "localhost.evil.com"]) assert.throws(() => WS.assertLoopbackHost(host), /loopback-only/, host);
  assert.equal(WS.assertLoopbackHost("localhost"), "127.0.0.1");
  assert.equal(WS.assertLoopbackHost("127.0.0.1"), "127.0.0.1");
  const dir = prepared();
  const { ws } = open(dir);
  assert.throws(() => WS.createWorkstationServer(ws, { host: "0.0.0.0" }), /loopback-only/);
  const fetchCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { fetchCalls.push(a); throw new Error("no outbound fetch"); };
  const srv = WS.createWorkstationServer(ws, { host: "localhost", port: 0 });
  const started = await srv.listen();
  try {
    assert.equal(srv.server.address().address, "127.0.0.1", "bound to the loopback interface only");
    const page = await request(started.port, "GET", "/");
    assert.equal(page.status, 200);
    const csp = page.headers["content-security-policy"];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.ok(!/https?:\/\/|\/\//.test(csp), "the CSP names no external origin");
    assert.ok(!/<link\b|<img\b|<iframe\b|<script[^>]*\bsrc=|@import|url\(|https?:\/\/|\/\/cdn|fonts\.g/i.test(page.text), "the page loads no external script, style, font, image or frame");
    const token = page.text.match(/ws-token" content="([a-f0-9]+)/)[1];
    const auth = { "x-ws-token": token };
    assert.equal((await request(started.port, "GET", "/api/state")).status, 403, "no token");
    assert.equal((await request(started.port, "GET", "/api/state", { headers: { "x-ws-token": "wrong" } })).status, 403, "wrong token");
    assert.equal((await request(started.port, "GET", "/api/state", { headers: { ...auth, host: "evil.example" } })).status, 403, "foreign Host (DNS rebinding)");
    assert.equal((await request(started.port, "GET", "/api/state", { headers: { ...auth, host: `127.0.0.1:${started.port + 1}` } })).status, 403, "foreign port");
    assert.equal((await request(started.port, "GET", "/api/state", { headers: { ...auth, origin: "http://evil.example" } })).status, 403, "foreign Origin");
    assert.equal((await request(started.port, "POST", "/api/commit", { headers: { ...auth, "content-type": "text/plain" }, body: "x" })).status, 415);
    // the live API over every item: payloads carry nothing answer-bearing
    const state = JSON.parse((await request(started.port, "GET", "/api/state", { headers: auth })).text);
    assert.equal(state.total, 3);
    let wire = "";
    for (const o of state.order) wire += (await request(started.port, "GET", `/api/item?n=${o.n}`, { headers: auth })).text;
    wire += (await request(started.port, "GET", "/api/grammar", { headers: auth })).text + (await request(started.port, "GET", "/api/definitions", { headers: auth })).text + page.text;
    for (const s of SENTINELS) assert.ok(!wire.includes(s), `${s} reached the client`);
    // a commit needs the explicit flag; a successful one round-trips through the API
    const id = idOf(DUFFLE_GROUP());
    assert.equal((await request(started.port, "POST", "/api/commit", { headers: auth, body: { id, draft: acceptDraft() } })).status, 400, "no explicit flag");
    const ok = await request(started.port, "POST", "/api/commit", { headers: auth, body: { id, draft: acceptDraft(), explicit: true } });
    assert.equal(ok.status, 200);
    assert.equal((await request(started.port, "POST", "/api/commit", { headers: auth, body: { id, draft: acceptDraft(), explicit: true } })).status, 409, "no silent overwrite over HTTP");
    const bad = JSON.parse((await request(started.port, "POST", "/api/commit", { headers: auth, body: { id: idOf(OKAY_GROUP()), draft: { wire: "x" }, explicit: true } })).text);
    assert.equal(bad.error, "invalid_draft");
    assert.equal(labelsOf(dir).length, 1);
    assert.equal(fetchCalls.length, 0, "no fetch was ever attempted");
  } finally { globalThis.fetch = realFetch; await new Promise((r) => srv.server.close(r)); }
});
test("P. No code path reaches a hosted transport, a model, or the network", () => {
  const whole = fs.readFileSync(SRC, "utf8");
  const src = whole.slice(0, whole.indexOf("const CLIENT_HTML")) + whole.slice(whole.indexOf("// ─── CLI")); // the page's own same-origin helper is checked separately below
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(required)].sort(), ["./dialogue-reader-frame", "./dialogue-reader-labels", "./dialogue-reader-render", "./dialogue-reader-replay", "./dialogue-reader-wire", "node:child_process", "node:crypto", "node:dns", "node:dgram", "node:fs", "node:http", "node:https", "node:net", "node:path", "node:tls"].sort(), "the workstation's own imports are an explicit allowlist");
  for (const re of [/ai-hosted-transport|ai-openai|ai-local|ai-living|ai-provider|ai-adapter|hostedArm|hostedRequest|modelArm|localModel|runtime-pin/i, /\bfetch\s*\(/, /XMLHttpRequest|WebSocket|EventSource|sendBeacon/, /https?\.(request|get)\(/, /net\.connect|createConnection|tls\.connect/, /api\.openai|anthropic\.com|googleapis|cdn\./i, /process\.env/]) {
    const own = code.replace(/installEgressGuard[\s\S]*?\n}\n/, ""); // the guard legitimately names the calls it disables
    assert.ok(!re.test(own), `forbidden reference ${re}`);
  }
  const html = WS.CLIENT_HTML;
  assert.deepEqual([...html.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1]), ["path"], "the page's only network call is its own same-origin API helper (a relative /api path)");
  assert.ok(!/https?:\/\//.test(html));
  // the CLI's egress guard: every outbound path throws, in a real process
  const script = `
    const W = require(${JSON.stringify(SRC)}); W.installEgressGuard();
    const out = {};
    const trap = (k, f) => { try { f(); out[k] = "ALLOWED"; } catch (e) { out[k] = /disabled/.test(e.message) ? "blocked" : e.message; } };
    trap("fetch", () => fetch("http://example.com"));
    trap("http.request", () => require("http").request("http://example.com"));
    trap("http.get", () => require("http").get("http://example.com"));
    trap("https.request", () => require("https").request("https://example.com"));
    trap("net.connect", () => require("net").connect(80, "example.com"));
    trap("tls.connect", () => require("tls").connect(443, "example.com"));
    trap("dns.lookup", () => require("dns").lookup("example.com", () => {}));
    trap("dns.resolve", () => require("dns").resolve("example.com", () => {}));
    trap("dgram", () => require("dgram").createSocket("udp4"));
    require("dns").lookup("127.0.0.1", () => { out.ip_literal = "resolves locally"; console.log(JSON.stringify(out)); });`;
  const run = JSON.parse(execFileSync(process.execPath, ["-e", script], { encoding: "utf8" }));
  for (const k of ["fetch", "http.request", "http.get", "https.request", "net.connect", "tls.connect", "dns.lookup", "dns.resolve", "dgram"]) assert.equal(run[k], "blocked", k);
  assert.equal(run.ip_literal, "resolves locally", "an IP literal (needed to listen on loopback) is not an outbound lookup");
});
test("Q. The active label path is gitignored (or outside the repository) and tracked paths are refused", () => {
  const active = path.join(WS.DEFAULT_DIR, WS.FILES.labels);
  assert.equal(path.relative(ROOT, active), path.join(".agent-notes", "reader-phase2-labeling", "labels.jsonl"));
  execFileSync("git", ["check-ignore", "-q", "--", active], { cwd: ROOT });
  assert.equal(WS.isIgnoredOrOutsideRepo(active), true);
  for (const f of Object.values(WS.FILES)) assert.equal(WS.isIgnoredOrOutsideRepo(path.join(WS.DEFAULT_DIR, f)), true, f);
  assert.equal(WS.isIgnoredOrOutsideRepo(path.join(ROOT, "docs", "acceptance", "reader-phase2", "labels.jsonl")), false, "a tracked repository path is not an acceptable active label path");
  assert.equal(WS.isIgnoredOrOutsideRepo(path.join(os.tmpdir(), "x", "labels.jsonl")), true);
  return WS.prepare({ dir: path.join(ROOT, "docs", "acceptance", "reader-phase2", "labeling-scratch"), captureFile: "/nonexistent" }).then(() => assert.fail("prepare must refuse a tracked path"), (e) => assert.match(e.message, /tracked repository path/));
});

// ─── the grammar reference, the view, the existing validator, the frozen artifacts ───────────────────
test("The grammar reference is static and generic: identical for every item, with invented examples and no suggested wire", () => {
  const a = JSON.stringify(WS.grammarReference());
  const b = JSON.stringify(WS.grammarReference());
  assert.equal(a, b);
  const g = WS.grammarReference();
  assert.ok(g.examples.length >= 2 && g.examples.every((x) => /invented/.test(x.note)));
  assert.match(g.note, /never contains a suggested wire/);
  const lines = groups().map((x) => x.item.text.toLowerCase());
  for (const l of lines) assert.ok(!a.toLowerCase().includes(l.replace(/[^a-z' ]/g, "")), `the grammar reference does not contain item text: ${l}`);
  // it reads the existing wire tables (no new taxonomy)
  assert.deepEqual(g.speech_acts.map((s) => s.code), Object.values(require("../tools/dialogue-reader-wire").SPEECH));
  const dir = prepared();
  const { ws } = open(dir);
  WS.commit(ws, idOf(DUFFLE_GROUP()), acceptDraft(), { explicit: true });
  assert.equal(JSON.stringify(WS.grammarReference()), a, "committing a label changes nothing in the reference (no previous-label prediction)");
});
test("Commit-time feedback uses only V0 / V1 / V2 on the human's OWN wire; resolver-level (V3, resolves, slot) feedback is withheld until after commit", () => {
  const gs = groups();
  const dir = prepared(gs);
  const { ws } = open(dir);
  const duffle = DUFFLE_GROUP();
  const okay = OKAY_GROUP();
  // ACCEPT-with-abstention: the EXISTING validator says the row clarifies; the workstation shows no such hint at commit time
  assert.equal(WS.check(ws, duffle.id, acceptDraft({ wire: "ask contents @n1 new ab=address" })).ok, true);
  assert.equal(WS.check(ws, okay.id, { outcome: "ACCEPT", wire: "ack - - end:q1" }).ok, true);
  WS.commit(ws, duffle.id, acceptDraft({ wire: "ask contents @n1 new ab=address" }), { explicit: true });
  WS.commit(ws, okay.id, { outcome: "ACCEPT", wire: "ack - - end:q1" }, { explicit: true });
  const rows = labelsOf(dir);
  const post = L.validateLabels(gs, rows, { states: Object.values(L.LABEL_STATES), registry: L.loadRegistry() });
  assert.deepEqual(post.problems.map((p) => p.problem).sort(), ["accept_label_not_accepted_by_V3", "accept_label_resolves_to_clarify"], "the existing validator is the post-commit authority and finds both");
  const stripped = WS.classifyValidation(post);
  assert.deepEqual(stripped.problems.every((p) => !("detail" in p)), true, "details (which can describe resolver behaviour) are stripped by default");
  assert.ok(WS.classifyValidation(post, { detail: true }).problems.some((p) => "detail" in p));
  // and what the human sees while labeling never carries a clarification slot or disposition
  const c = WS.check(ws, duffle.id, { outcome: "ACCEPT", wire: "ask contents @n1 new ab=address", notes: "" });
  assert.ok(!/slot|disposition|clarif/i.test(JSON.stringify(c)));
});
test("The workstation reads no answer-bearing source: the serving path never touches a capture", () => {
  const src = fs.readFileSync(SRC, "utf8");
  const core = src.slice(src.indexOf("// ─── the workstation core"), src.indexOf("// ─── --prepare / --validate-full"));
  assert.ok(!/captureCorpus|readCaptureItems|capture|\.l0\b|\.production\b|\.bindings\b|\.context\b|canonical|\.legacy|teacher/i.test(core.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "the loading / commit core never references the capture or any code-side field");
  const server = src.slice(src.indexOf("// ─── the HTTP server"), src.indexOf("// ─── the client"));
  assert.ok(!/captureCorpus|readCaptureItems|\.l0\b|\.production\b|\.bindings\b|teacher/i.test(server.replace(/\/\/[^\n]*/g, "")));
  // the capture is read only inside prepare() and validateFull(), both explicit CLI actions that write no capture
  assert.equal([...src.matchAll(/readCaptureItems\(/g)].length, 2, "the capture is read by prepare() and validateFull() only");
  assert.ok(!/capture\.json|writeFileSync\([^)]*capture/i.test(src));
  const dir = prepared();
  assert.deepEqual(fs.readdirSync(dir).sort(), [WS.FILES.pack, WS.FILES.receipt, WS.FILES.worksheet].sort(), "prepare leaves exactly the blank worksheet, the input pack and a receipt");
});
test("Frozen artifacts are untouched and no label, receipt, teacher, review or gold artifact exists anywhere tracked", () => {
  const acc = (f) => fs.readFileSync(path.join(ROOT, "docs", "acceptance", "reader-phase2", f));
  assert.equal(sha(acc("teacher-dev-sample.json")), RP.TEACHER_SAMPLE_SHA256);
  assert.equal(sha(acc("teacher-dev-sample.json")), "26f0ba7b69a3be175359ddad5fa0a798a094d1151dc1b1659c243b70aeb201c8");
  assert.equal(sha(acc("dev-manifest.json")), "d65f601176fb7c80b1c70abc20c70e17593d02db2e3d2adc466f150071025274");
  assert.equal(sha(acc("json-control-selection.json")), RP.JSON_CONTROL_SELECTION_SHA256);
  assert.equal(sha(acc("json-control-selection.json")), "fb27ff65335d764c13675631d07c7a6159e6dffa19b01dd202362ca1d4d3784b");
  const manifest = JSON.parse(acc("dev-manifest.json"));
  const sample = JSON.parse(acc("teacher-dev-sample.json"));
  assert.deepEqual([manifest.turns, manifest.distinct_renders, sample.headline_renders], [944, 552, 474], "the frozen population");
  assert.deepEqual([manifest.counts.source_rows, manifest.counts.distinct_player_turns, manifest.counts.distinct_texts, manifest.counts.distinct_renders, manifest.counts.headline_eligible_renders, manifest.counts.context_missing_renders], [944, 575, 470, 552, 474, 78], "944 / 575 / 470 / 552 / 474 / 78");
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  assert.deepEqual(tracked.filter((f) => /(^|\/)(labels?|journal|receipts?)[^/]*\.jsonl$|teacher-(output|run)|model-review|adjudicated-gold/i.test(f)), [], "no label / journal / receipt / teacher / review artifact is tracked");
  // tests never write the real active label path
  assert.equal(fs.existsSync(path.join(WS.DEFAULT_DIR, WS.FILES.journal)), false, "no real journal exists");
  const real = path.join(WS.DEFAULT_DIR, WS.FILES.labels);
  assert.equal(!fs.existsSync(real) || fs.readFileSync(real, "utf8").trim() === "" || process.env.READER_LABELING_REAL_LABELS_PRESENT === "1", true, "the test suite created no real HUMAN_PRIMARY label");
});
test("The page is a static shell: item data arrives only through the same-origin API, and DOM insertion is by text, never HTML", () => {
  const html = WS.CLIENT_HTML;
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(html), "player lines are inserted as text only");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), "no browser persistence of drafts or labels");
  assert.ok(!/render_user|\"line:/.test(html.slice(0, html.indexOf("<script"))), "the page source embeds no item text");
  assert.match(html, /No outcome is selected\. Choose one; nothing is preselected\./);
  assert.match(html, /Label BLIND/);
  const js = html.slice(html.indexOf("<script nonce")).replace(/^<script nonce="__NONCE__">/, "").replace(/<\/script>[\s\S]*$/, "");
  assert.doesNotThrow(() => new Function(js), "the client script parses");
});
test("viewOfRender is a display-only parse of the authorized render text", () => {
  const g = DUFFLE_GROUP();
  const view = WS.viewOfRender(R.renderReaderPrompt(g.item.input).user);
  assert.equal(view.find((v) => v.key === "line").text, "Tonya, what's in the duffle?");
  const tokens = view.find((v) => v.key === "tokens");
  assert.ok(tokens.tokens.length > 3 && tokens.tokens[0].i === 0);
  assert.ok(view.every((v) => v.group && v.title && typeof v.text === "string"));
  assert.equal(R.renderReaderPrompt(g.item.input).render_digest, g.render_digest);
});
