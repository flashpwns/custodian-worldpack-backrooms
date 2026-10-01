"use strict";

// Reader Phase 2 -- STEP 0 CONTRACT FREEZE (shadow-only; no production reader cutover):
//   B7 reader-facing salience (canonical vs heard; no plan fact is salient), the hidden-entity / observer rule, the
//   deterministic alias / typo candidate pipeline and the nominated-span lookup, relation `conclude` (and withdraw of
//   the activity), the versioned model-facing render, the compact wire codec (100% semantic round trip over every
//   gold frame; V0 failures), the async reader seam and its transports, and FAULT-INJECTION INERTNESS of the opt-in
//   developer model shadow. The contract identities are PINNED here (governance: this file's hash is registered).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RF = require("../tools/dialogue-reader-frame");
const RI = require("../tools/dialogue-reader-input");
const LX = require("../tools/dialogue-reader-lexicon");
const R = require("../tools/dialogue-reader-render");
const W = require("../tools/dialogue-reader-wire");
const A = require("../tools/dialogue-reader-async");
const RP = require("../tools/dialogue-reader-replay");
const { resolveTurn, RESOLVE_TURN_VERSION } = require("../tools/dialogue-resolve-turn");
const { frameFromLegacy } = require("../tools/dialogue-reader-legacy");
const shadowRunner = require("../tools/dialogue-reader-shadow");
const dialogueTurn = require("../tools/dialogue-turn");
const C = require("../tools/dialogue-characterize");
const G = require("../tools/dialogue-gold-eval");
const INERT = require("../tools/dialogue-shadow-inertness");
const E = require("../tools/dialogue-eval");

const ROOT = path.join(__dirname, "..");
// ── PINNED CONTRACT (Step 0 freeze): changing any of these without updating the pin fails this suite; updating a pin
// changes this file's hash, which verification/verification-authority.json governs. ──
const CONTRACT = Object.freeze({
  reader_input: "yellow-beast-reader-input@v3",
  frame: "yellow-beast-reader-frame@v2",
  resolve_turn: "yellow-beast-resolve-turn@v3",
  lexicon: "yellow-beast-reader-lexicon@v2",
  render: "yellow-beast-reader-render@v2",
  render_system_digest: "8c727a29383c0c4f32cb34323c82f29c05a15be9e2e9614962f39e6fd550d2f1",
  // Step 0.1B: the wire-vs-JSON control's system text is pinned too (a JSON-only drift fails here).
  render_system_digest_json: "c2542a45c6afe41eba1e8bf084abb1af5d60f4364e04e45e4ecac57c346f8aa3",
  wire: "yellow-beast-reader-wire@v1",
  wire_digest: "b18ac02f80bacbe221710c21ab0eb2616c1ba95c62378992f20706bae5d74cc8"
});
const TOKEN_ARTIFACT = path.join(ROOT, "docs", "acceptance", "reader-phase2", "token-distribution.json");
const TOKEN_ARTIFACT_SHA256 = "0c9684b7dfc5f828f3b990e3ec5d351b024c9d8bba8287792a1c16a4bfb385b8";

const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const deepFreeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };
const frameOf = (...acts) => ({ version: RF.READER_FRAME_VERSION, acts });
const op = (o, names = [], extra = {}) => ({ op: o, names, relative_to: null, count: null, ...extra });
function act(input, overrides = {}) {
  return { span: [0, input.line.tokens.length - 1], speech_act: "question", question_form: "wh", facet: "item.contents", polarity: "positive", name_roles: [], address: op("NONE"), relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [], ...overrides };
}
function state() {
  const requests = [{ request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: "q4-startup-materials-duffle-01" }, turns_since: 0 }];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-2", predicate: "item.contents", request_text: "Tonya, what's in the duffle?", args: { item_id: "q4-startup-materials-duffle-01" } }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: null, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
function build(raw, { entities = sc.entities, discourse = null, snapshot: extra = {}, observer_known_ids = [] } = {}) {
  const { ledger, snapshot } = state();
  return RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities, snapshot: { ...snapshot, ...extra }, ledger, discourse, observer_known_ids });
}
const reply = (text, facts = {}) => ({ last_turn: { kind: "player_exchange", player_text: "Tonya, what's in the duffle?", responses: [{ speaker_id: TONYA, text, facts }] } });
const refName = (input, re) => input.referent_candidates.find((r) => re.test(r.name)) ?? null;

// ─── contract freeze ─────────────────────────────────────────────────────────────────────────────────
test("Step 0 contract identities are frozen (input / frame / resolver / lexicon / render / wire versions and digests)", () => {
  assert.deepEqual({
    reader_input: RI.READER_INPUT_VERSION, frame: RF.READER_FRAME_VERSION, resolve_turn: RESOLVE_TURN_VERSION, lexicon: LX.LEXICON_VERSION,
    render: R.RENDER_VERSION, render_system_digest: R.SYSTEM_DIGEST, render_system_digest_json: R.SYSTEM_DIGEST_JSON, wire: W.WIRE_VERSION, wire_digest: W.WIRE_DIGEST
  }, CONTRACT);
  assert.deepEqual(W.facetCodeTableComplete(), { missing: [], extra: [], duplicate_codes: [] }, "every registry facet has exactly one wire code");
  const identity = RP.contractIdentity();
  assert.equal(identity.wire_digest, CONTRACT.wire_digest);
  assert.equal(identity.render_system_digest, CONTRACT.render_system_digest);
});

// ─── 1. B7 salience ──────────────────────────────────────────────────────────────────────────────────
test("B7: a REQUIRED plan fact authorized but not delivered by the wording is absent from the reader's view", () => {
  const { input } = build("is it heavy?", { discourse: reply("Just some gear, I think.", { required: [{ key: "predicate_answer", value: "the 35mm field camera" }] }) });
  const json = JSON.stringify(input);
  assert.ok(!/camera/i.test(json), "an unspoken required fact never reaches the reader (not salient, not a candidate, not heard)");
});
test("B7: an OPTIONAL plan fact not delivered is absent", () => {
  const { input } = build("is it heavy?", { discourse: reply("Just some gear, I think.", { optional: [{ key: "held_equipment", value: "Battery field lamp" }, { key: "agenda_mention", value: "Outpost A" }] }) });
  assert.ok(!/lamp|outpost/i.test(JSON.stringify(input)));
});
test("B7: a fact actually delivered appears ONLY through heard salience (and may license a conversational reference)", () => {
  const { input, bindings } = build("is it heavy?", { discourse: reply("The camera is in the duffle.", { required: [{ key: "predicate_answer", value: "the 35mm field camera" }] }) });
  const camera = refName(input, /camera/i);
  assert.ok(camera, "the heard thing is a candidate");
  assert.equal(camera.basis, "heard");
  assert.equal(camera.name, "camera", "shown with the words actually heard");
  assert.ok(input.heard.salient_entities.includes(camera.label));
  assert.ok(!input.conversation.salient_entities.includes(camera.label), "heard salience never enters the canonical conversation state");
  assert.equal(bindings.referents[camera.label], "item-b2b47214d72b45d159");
  // Licensing: a pronoun may pick the heard thing.
  const verdict = RF.validateReaderFrame(frameOf(act(input, { speech_act: "question", question_form: "yes_no", facet: "item.status", referent: { span: null, candidate: camera.label } })), input);
  assert.ok(!Object.values(verdict.layers).flatMap((l) => l.errors ?? []).some((e) => e.code === "referent_not_licensed"), "heard salience licenses the reference");
  // ... and the canonical anaphora (the duffle the request was about) stays licensed and canonical.
  const duffle = refName(input, /duffle/i);
  assert.equal(duffle.basis, "salient", "the player's own earlier words make the duffle canonically salient");
});
test("B7: the canonical projection is identical across wording providers; only the heard projection differs", async () => {
  const S = require("../tools/dialogue-state");
  const s = C.openScenario({ seed: "rp2-b7", provider: C.providerFor({}, "garbage") });
  try {
    await s.say("Malcolm, what's in the duffle?", { request_id: "b7-1" });
    const run = s.run;
    const present = s.coworkers().map((m) => ({ id: m.personnel_id, name: m.first_name, names: [m.first_name] }));
    const entities = require("../tools/canonical-knowledge").entityIndex(run);
    const snapshot = S.snapshot(run, { player_id: s.playerId, location_id: run.spatial?.player_location ?? null, present_ids: present.map((p) => p.id) });
    const discourse = require("../tools/dialogue-discourse").deriveDiscourseState({ interaction_history: run.expedition.interaction_history, dialogue_history: run.expedition.dialogue_history, player_id: s.playerId, location_id: run.spatial?.player_location ?? null, current_interval: run.expedition.clock?.interval ?? null, equipment: run.expedition.equipment, receipts: run.expedition.communication_receipts, people: present.map((p) => ({ name: p.name, id: p.id })), entities });
    const anchor = snapshot.surface_anchors[0];
    const worded = (text) => {
      const spans = S.anchorSpans(text, [{ request_id: anchor.spans[0].request_id, predicate: anchor.spans[0].predicate }]);
      return RI.buildReaderInput({ raw: "is it heavy?", present, player: { id: s.playerId, names: ["Jack"] }, entities, snapshot: { ...snapshot, surface_anchors: [{ ...anchor, spans }] }, ledger: run.expedition.dialogue_state, discourse: { ...discourse, last_turn: { ...discourse.last_turn, responses: discourse.last_turn.responses.map((r) => ({ ...r, text })) } } }).input;
    };
    const a = worded("Startup materials. The flashlight is on top.");
    const b = worded("Honestly? No idea what's in it. Sealed.");
    assert.deepEqual(a.conversation, b.conversation, "canonical conversation state is provider-independent");
    assert.deepEqual(a.referent_candidates.filter((r) => r.basis !== "heard"), b.referent_candidates.filter((r) => r.basis !== "heard"), "canonical candidates (and their labels) are provider-independent");
    assert.notDeepEqual(a.heard, b.heard, "the heard projection may differ");
    assert.ok(a.heard.salient_entities.length === 1 && b.heard.salient_entities.length === 0, "only delivered wording creates heard salience");
  } finally { s.close(); }
});
test("B7: heard entities create no facts and mutate nothing (all builder inputs deeply frozen)", () => {
  const { ledger, snapshot } = state();
  const args = deepFreeze(structuredClone({ raw: "is it heavy?", present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger, discourse: reply("The camera and the flashlight are in the duffle.", { required: [{ key: "k", value: "x" }] }) }));
  const before = JSON.stringify(args);
  const { input, bindings } = RI.buildReaderInput(args);
  assert.equal(JSON.stringify(args), before, "nothing the builder read changed");
  assert.equal(input.heard.salient_entities.length, 3, "camera, flashlight and duffle were heard");
  for (const key of ["facts", "knowledge", "grants", "propositions"]) { assert.ok(!(key in input) && !(key in input.heard) && !(key in bindings), key); assert.ok(!JSON.stringify(input).includes(`"${key}"`), key); }
});

// ─── 2. hidden entities / observer ─────────────────────────────────────────────────────────────────────
const HIDDEN_PERSON = { id: "yb-world-rhodes-9f1", kind: "person", label: "Eleanor", names: ["eleanor", "rhodes", "eleanor rhodes"], non_present: true, world_only: true };
const HIDDEN_ITEM = { id: "q4-sealed-specimen-canister-01", kind: "equipment", label: "Sealed specimen canister", names: ["sealed specimen canister", "canister"], observer_hidden: true };
test("Hidden entity typed by the player: the literal survives, the canonical label / id / metadata never reach the reader; identical to a word naming nobody", () => {
  const raw = "rhodes, is the canister still sealed?";
  const withHidden = build(raw, { entities: [...sc.entities, HIDDEN_PERSON, HIDDEN_ITEM] });
  const without = build(raw, { entities: sc.entities });
  assert.deepEqual(withHidden.input, without.input, "hidden entries are indistinguishable from nonexistent ones");
  const { lexicon: l1, ...b1 } = withHidden.bindings; const { lexicon: l2, ...b2 } = without.bindings;
  assert.deepEqual(b1, b2);
  assert.deepEqual(l1, l2, "the code-side lexicon excludes hidden entries");
  assert.equal(withHidden.input.line.raw, raw, "the player's literal words are preserved");
  assert.deepEqual(withHidden.input.features.name_spans, [], "no name span: no observer-safe binding exists");
  assert.deepEqual(withHidden.input.features.entity_spans, [], "the span remains unresolved");
  const rendered = R.renderReaderPrompt(withHidden.input);
  for (const leak of ["Eleanor", "yb-world-rhodes", "specimen", "q4-sealed", "world_only", "hidden", "not here"]) assert.ok(!`${rendered.system}\n${rendered.user}`.includes(leak), `render leaks ${leak}`);
  // A real world-only canonical person ("Control") behaves the same way.
  assert.deepEqual(build("Control, do you copy?").input.features.name_spans, []);
});
test("player_literal vs canonical_candidate: a binding is emitted only when code can legally expose it", () => {
  const known = build("Rhodes, how are you?", { entities: [...sc.entities, HIDDEN_PERSON], observer_known_ids: [HIDDEN_PERSON.id] }).input;
  assert.deepEqual(known.features.name_spans.map((n) => [n.text, n.refers_to]), [["Rhodes", "absent_person"]], "once code establishes the observer knows the person, the name binds");
  const item = build("what's in the camra?").input.features.entity_spans[0];
  assert.deepEqual([item.player_literal, item.basis, Boolean(item.canonical_candidate)], ["camra", "fuzzy", true]);
  const unbound = build("is the case heavy?").input;
  assert.deepEqual(unbound.features.entity_spans, [], "an unauthored word binds to nothing");
  const named = build("where's the flashlight?").input;
  assert.equal(refName(named, /flashlight/).name, "flashlight", "a line-named thing is shown with the player's literal words, not the canonical name");
});

// ─── 3. alias / typo candidates ───────────────────────────────────────────────────────────────────────
test("Candidates: exact -> authored alias -> bounded fuzzy (Damerau <=1 for 4-6, <=2 for >=7), unique nearest only, observer-visible only", () => {
  const lex = LX.observerLexicon([...sc.entities, HIDDEN_ITEM]);
  const bind = (line) => { const t = [...line.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*|[^\sA-Za-z0-9]/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length })); return LX.bindLine(t, lex, { raw: line }); };
  const one = (line) => bind(line).map((s) => ({ lit: s.player_literal, basis: s.basis, score: s.score, id: s.bound }));
  assert.deepEqual(one("grab the bag"), [{ lit: "the bag", basis: "alias", score: 0, id: "q4-startup-materials-duffle-01" }], "bag -> the duffle (authored alias; the item wins over the delivery task)");
  assert.deepEqual(one("the duffel bag"), [{ lit: "duffel bag", basis: "alias", score: 0, id: "q4-startup-materials-duffle-01" }]);
  assert.deepEqual(one("is the case heavy"), [], "case: no authored alias, no unique near name -> unresolved");
  assert.deepEqual(one("the camra"), [{ lit: "camra", basis: "fuzzy", score: 1, id: "item-b2b47214d72b45d159" }]);
  assert.deepEqual(one("the camrea"), [{ lit: "camrea", basis: "fuzzy", score: 1, id: "item-b2b47214d72b45d159" }], "a transposition is one edit");
  assert.deepEqual(one("the cxmxra"), [], "length 6: two edits is too far");
  assert.deepEqual(one("the flashlght"), [{ lit: "flashlght", basis: "fuzzy", score: 1, id: "q4-field-light-01" }]);
  assert.deepEqual(one("the spctrmeter"), [{ lit: "spctrmeter", basis: "fuzzy", score: 2, id: "item-61d51797cf8afcee0d" }], "length >= 7: two edits allowed");
  assert.deepEqual(one("Battery field lamp please"), [{ lit: "Battery field lamp", basis: "exact", score: 0, id: "q4-field-light-01" }]);
  assert.deepEqual(one("the canister"), [], "a hidden entity is never matched");
  assert.deepEqual(one("the canistr"), [], "not even fuzzily");
  assert.deepEqual(one("the KV31 threshold room"), [{ lit: "KV31 threshold room", basis: "exact", score: 0, id: "threshold-room" }]);
  // Ambiguous nearest: two observer-visible things one edit away -> no candidate (never a guess).
  const tied = LX.observerLexicon([{ id: "q-rope", kind: "equipment", label: "Rope", names: ["rope"] }, { id: "q-robe", kind: "equipment", label: "Robe", names: ["robe"] }]);
  const t = [{ text: "the", start: 0, end: 3 }, { text: "rooe", start: 4, end: 8 }];
  const amb = LX.bindLine(t, tied, { raw: "the rooe" });
  assert.equal(amb.length, 1);
  assert.deepEqual([amb[0].bound, amb[0].ambiguous, amb[0].candidates.map((c) => c.id)], [null, true, ["q-robe", "q-rope"]], "stable order: basis -> score -> canonical id");
  // The ReaderInput shows the ambiguity without a candidate.
  const ambInput = RI.buildReaderInput({ raw: "the rooe", present: sc.present, entities: [...sc.entities, { id: "q-rope", kind: "equipment", label: "Rope", names: ["rope"] }, { id: "q-robe", kind: "equipment", label: "Robe", names: ["robe"] }] }).input;
  assert.deepEqual(ambInput.features.entity_spans.map((e) => [e.player_literal, e.canonical_candidate, Boolean(e.ambiguous)]), [["rooe", null, true]]);
});
test("Nominated span: ONE bounded looser lookup (edit <= 2 / plural stem), observer-visible lexicon only, unique only", () => {
  const lex = LX.observerLexicon([...sc.entities, HIDDEN_ITEM]);
  assert.equal(LX.lookupNominated("the lampz", lex).id, "q4-field-light-01");
  assert.equal(LX.lookupNominated("spectrometers", lex).id, "item-61d51797cf8afcee0d", "plural stem");
  assert.equal(LX.lookupNominated("thing", lex).id, null);
  assert.equal(LX.lookupNominated("canister", lex).id, null, "hidden stays hidden");
  const tied = LX.observerLexicon([{ id: "q-rope", kind: "equipment", label: "Rope", names: ["rope"] }, { id: "q-robe", kind: "equipment", label: "Robe", names: ["robe"] }]);
  assert.deepEqual(LX.lookupNominated("the rooe", tied), { id: null, reason: "not_unique", count: 2 });
  // Through the frame: a nominated span with no candidate binds code-side before validation.
  const { input, bindings } = build("hand me that lampzz thing");
  assert.deepEqual(input.features.entity_spans, [], "two edits at length 6: beyond the line-level fuzzy bound");
  const frame = frameOf(act(input, { speech_act: "request", question_form: "none", facet: "item.holder", referent: { span: null, candidate: "NONE", nominated: [3, 3] } }));
  const looked = LX.applyNominatedLookup(frame, input, bindings);
  const label = looked.frame.acts[0].referent.candidate;
  assert.equal(looked.bindings.referents[label], "q4-field-light-01");
  assert.equal(looked.input.referent_candidates.find((r) => r.label === label).basis, "nominated");
  assert.ok(!input.referent_candidates.some((r) => r.label === label && r.basis === "nominated"), "the original input is never mutated");
  assert.ok(!Object.values(RF.validateReaderFrame(looked.frame, looked.input).layers).flatMap((l) => l.errors ?? []).some((e) => /referent/.test(e.code)), "the bound nominated referent is licensed");
  assert.ok(RF.validateSchema(frameOf(act(input, { referent: { span: null, candidate: "NONE", nominated: [0, 99] } })), input).errors.some((e) => e.code === "span_range"), "an out-of-range nominated span fails V0");
});

// ─── 4. conclude ──────────────────────────────────────────────────────────────────────────────────────
test("conclude: the reader expresses the relation; V3 validates the target; code derives closure only for an active activity", () => {
  const activity = { activity_id: "act-1", kind: "SELF_INTRODUCTION_ROUND", state: "active", template: { predicate: "person.self_description" }, completed: [GISELLE], eligible: [GISELLE, MALCOLM, TONYA], pending: [MALCOLM, TONYA] };
  const run = (raw, rel, extra = {}) => {
    const { ledger, snapshot } = state();
    const snap = { ...snapshot, ...extra };
    const built = RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities: sc.entities, snapshot: snap, ledger });
    const frame = frameOf(act(built.input, { speech_act: "social_acknowledgment", question_form: "none", facet: "NOT_APPLICABLE", relation: rel }));
    const verdict = RF.validateReaderFrame(frame, built.input);
    return { verdict, out: resolveTurn(frame, { snapshot: snap, ledger }, sc.present, { verdict, input: built.input, bindings: built.bindings }) };
  };
  const closed = run("Okay, that's that.", { kind: "conclude", target: "v1" }, { activity });
  assert.deepEqual([closed.verdict.disposition, closed.out.lifecycle.activity], ["accept", { intent: "close", kind: "SELF_INTRODUCTION_ROUND" }]);
  const nothing = run("Okay, that's that.", { kind: "conclude", target: null });
  assert.deepEqual([nothing.out.outcome, nothing.out.lifecycle.activity.intent, nothing.out.routing.silence], ["resolved", "none", true], "nothing active: a social no-op, never a fabricated closure");
  assert.ok(nothing.out.reasons.includes("act0:conclude:no_active_activity"));
  const ghost = run("Okay, that's that.", { kind: "conclude", target: "v1" });
  assert.ok(ghost.verdict.layers.V1.errors.some((e) => e.code === "unknown_activity"), "v1 cannot be named when no activity exists");
  assert.equal(ghost.out.lifecycle.activity.intent, "none");
  const wrong = run("Okay, that's that.", { kind: "conclude", target: "q1" }, { activity });
  assert.ok(wrong.verdict.layers.V3.errors.some((e) => e.code === "conclude_target_not_activity"));
  assert.deepEqual([wrong.out.outcome, wrong.out.lifecycle.activity.intent], ["clarify", "none"]);
  const dropped = run("Never mind the introductions.", { kind: "withdraw", target: "v1" }, { activity });
  assert.deepEqual(dropped.out.lifecycle.activity, { intent: "close", kind: "SELF_INTRODUCTION_ROUND" }, "withdraw may target the activity");
  assert.ok(!RF.ACT_KEYS.some((k) => /activity|close/.test(k)), "no model-owned activity mutation field");
});
test("conclude: the legacy adapter expresses legacy's 'that's that' close (split off an asking clause when needed)", () => {
  const snapshot = { active_speaker: { speaker_id: GISELLE, speaker_ids: [GISELLE] }, last_request: null, activity: { activity_id: "a", kind: "SELF_INTRODUCTION_ROUND", state: "active", template: { predicate: "person.self_description" }, completed: [GISELLE], eligible: [GISELLE, MALCOLM, TONYA], pending: [] } };
  for (const [raw, expect] of [["Okay, well that's that, where do we head to next?", [["social_acknowledgment", "conclude", "v1"], ["question", "new", null]]], ["I think that's everyone introduced now.", [["social_acknowledgment", "conclude", "v1"]]]]) {
    const built = RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger: { requests: [] } });
    const analysis = dialogueTurn.analyzeTurn({ raw, present: sc.present, entities: sc.entities, dis: snapshot });
    assert.ok(analysis.closes_activity, raw);
    const { frame } = frameFromLegacy(analysis, built);
    assert.deepEqual(frame.acts.map((a) => [a.speech_act, a.relation.kind, a.relation.target]), expect, raw);
    assert.equal(RF.validateReaderFrame(frame, built.input).disposition, "accept");
  }
});

// ─── 5. render ────────────────────────────────────────────────────────────────────────────────────────
test("Render: pure and versioned; static system prefix; implementation noise omitted; required context kept", () => {
  const { input } = build("Tonya, whats in the camra?", { discourse: reply("The camera is in the duffle."), snapshot: { surface_anchors: [{ speaker_id: TONYA, event_id: "ev-1", spans: [{ text: "The camera is in the duffle.", request_id: "req-2", predicate: "item.contents" }] }] } });
  const a = R.renderReaderPrompt(input);
  const b = R.renderReaderPrompt(structuredClone(input));
  assert.deepEqual(a, b, "pure");
  assert.equal(a.version, CONTRACT.render);
  assert.equal(a.system, R.renderReaderPrompt(build("hi").input).system, "the system text is static");
  assert.ok(Object.isFrozen(a));
  for (const noise of ["\"start\"", "word_count", "salience_source", "presentation_dependent", "anchor_count", "freshness", "requests_in_window", "second_person", "quantifiers", "deictics", "punctuation", "eligible"]) assert.ok(!a.user.includes(noise), `noise rendered: ${noise}`);
  assert.ok(!a.user.includes("heard p3:"), "heard lines are not repeated when anchors carry them");
  for (const need of ["line: Tonya, whats in the camra?", "read as: Tonya, what's in the camra?", "0:Tonya", "names typed: n1 \"Tonya\"@0=p3", "things typed: e1 \"camra\"@5=r", "q1: asked contents to p3; answered by p3 (latest)", "heard a1 p3 re q1: \"The camera is in the duffle.\""]) assert.ok(a.user.includes(need), `missing: ${need}\n${a.user}`);
  for (const id of [GISELLE, MALCOLM, TONYA, "req-2", "q4-startup", "item-b2b"]) assert.ok(!a.user.includes(id), `id rendered: ${id}`);
});

// ─── 6. wire codec ────────────────────────────────────────────────────────────────────────────────────
test("Wire: 100% semantic encode/decode round trip over EVERY gold ReaderFrame (gold resolver spec + harness self-test)", { timeout: 600000 }, async () => {
  const items = [...G.readJsonl(path.join(__dirname, "fixtures/reader-phase1/gold-resolver-spec.jsonl")), ...G.readJsonl(path.join(__dirname, "fixtures/reader-phase0/gold-harness-selftest.jsonl"))];
  const { results } = await G.evaluateGold(items);
  let n = 0;
  for (const r of results.filter((x) => x.status === "scored" && x.target?.frame)) {
    const text = W.encodeWire(r.target.frame, r.target.input);
    const back = W.decodeWire(text, r.target.input);
    assert.ok(back.ok, `${r.id}: ${text} -> ${JSON.stringify(back.errors)}`);
    assert.deepEqual(back.frame, W.canonicalFrame(r.target.frame), `${r.id}: ${text}`);
    assert.equal(W.encodeWire(back.frame, r.target.input), text, `${r.id}: encoding is canonical`);
    n += 1;
  }
  assert.ok(n >= 40, `round-tripped ${n} gold frames`);
});
test("Wire: round trip over the legacy frames of every scenario session; malformed / unknown / duplicate fail V0; illegal labels fail V1", { timeout: 600000 }, async () => {
  const items = await RP.captureCorpus({ fixtures: C.loadScenarios() });
  let n = 0;
  for (const item of items.filter((x) => x.l0.frame)) {
    const text = W.encodeWire(item.l0.frame, item.input);
    const back = W.decodeWire(text, item.input);
    assert.ok(back.ok && JSON.stringify(back.frame) === JSON.stringify(W.canonicalFrame(item.l0.frame)), `${item.id}: ${text}`);
    n += 1;
  }
  assert.ok(n > 50);
  const { input } = build("Tonya, what's in the duffle?");
  const ok = W.decodeWire("ask contents @n1 new f=wh r=e1>r1", input);
  assert.ok(ok.ok);
  const bad = (text, code) => { const d = W.decodeWire(text, input); assert.equal(d.ok, false, text); assert.ok(d.errors.every((e) => e.layer === "V0"), text); assert.ok(d.errors.some((e) => e.code === code), `${text}: ${JSON.stringify(d.errors)}`); };
  bad("", "wire_empty");
  bad("ask contents @n1", "wire_short_core");
  bad("ask  contents @n1 new", "wire_empty_field");
  bad("wonder contents @n1 new", "wire_unknown_speech_act");
  bad("ask person.wellbeing @n1 new", "wire_unknown_facet_code");
  bad("ask contents @n1 sideways", "wire_unknown_relation");
  bad("ask contents @n1 new f=wh f=yn", "wire_duplicate_tag");
  bad("ask contents @n1 new zz=1", "wire_unknown_tag");
  bad("ask contents @n1 new t=tomorrow", "wire_unknown_temporal");
  bad("ask contents @n1 new ; ask contents - new ; ack - - new ; ack - - new", "wire_too_many_acts");
  bad("ask contents @n1 new ; ack - - new", "wire_missing_act_start");
  bad("ask contents @Tonya new", "wire_bad_name_label");
  bad("ask contents @n1 new r=q4-startup-materials-duffle-01", "wire_bad_referent");
  { const d = W.decodeWire("```ask contents @n1 new```", input); assert.deepEqual(d.errors.map((e) => e.code), ["output_fenced"], "fences: invalid output, identically for wire and JSON (Step 0.1)"); }
  bad("ask contents @n1 new\nmore", "wire_illegal_character");
  // A well-formed but ILLEGAL candidate decodes, then fails downstream validation.
  const illegal = W.decodeWire("ask contents @n9 new r=r99", input);
  assert.ok(illegal.ok);
  const v = RF.validateReaderFrame(illegal.frame, input);
  assert.ok(v.layers.V1.errors.some((e) => e.code === "unknown_name_span") && v.layers.V1.errors.some((e) => e.code === "unknown_referent"));
  assert.ok(!/q4-|yb-personnel|req-/.test(W.encodeWire(illegal.frame, input)), "the wire carries labels, never canonical ids");
  assert.match(W.wireGrammar(input), /^root ::= act/);
  assert.ok(W.wireGrammar(input).includes('"n1"') && !W.wireGrammar(input).includes("q4-"), "the grammar closes labels to this input and names no id");
});

// ─── 7. async reader seam ─────────────────────────────────────────────────────────────────────────────
test("Async reader: wire -> decode -> V0-V3 -> resolveTurn -> receipt; failures are inert reader-unavailable results", async () => {
  const { input, bindings } = build("Tonya, what's in the duffle?");
  const { ledger, snapshot } = state();
  const context = { snapshot, ledger, present: sc.present.map((p) => ({ id: p.id })), canonical: {} };
  const read = (transport, extra = {}) => A.readTurnAsync({ input, bindings, request_id: "t1", context }, { id: "test", provider: "scripted", transport, timeout_ms: 200, ...extra });
  const good = await read(A.scriptedTransport(() => "ask contents @n1 new f=wh r=e1>r1"));
  assert.deepEqual([good.status, good.disposition, good.resolution.primary.predicate, good.resolution.routing.responders], ["read", "ACCEPT", "item.contents", [TONYA]]);
  for (const key of ["input_digest", "render_digest", "system_digest", "wire_version", "wire_digest", "frame_version", "raw_wire", "decode", "verdict", "frame", "abstentions", "clarification_kind", "latency_ms", "reader"]) assert.ok(key in good, key);
  assert.equal(good.consumed, false);
  assert.ok(Object.isFrozen(good));
  const cases = [
    ["throw", A.scriptedTransport(() => { throw new Error("boom"); }), "reader_unavailable", "error"],
    ["hang", () => new Promise(() => {}), "reader_unavailable", "timeout"],
    ["slow", () => new Promise((r) => setTimeout(() => r({ text: "ask contents @n1 new" }), 400)), "reader_unavailable", "timeout"],
    ["malformed", A.scriptedTransport(() => "{\"acts\":[]}"), "invalid", "wire_decode"],
    ["server down", A.llamaTransport({ endpoint: "http://127.0.0.1:9" }), "reader_unavailable", "error"],
    ["no transport", null, "reader_unavailable", "no_transport"]
  ];
  for (const [name, transport, status, reason] of cases) {
    const r = await read(transport);
    assert.deepEqual([r.status, r.reason], [status, reason], name);
    assert.equal(r.resolution ?? null, null, `${name}: nothing resolved`);
  }
  const abstain = await read(A.scriptedTransport(() => "ask contents - new f=wh ab=address"));
  assert.deepEqual([abstain.resolution.outcome, abstain.clarification_kind, abstain.abstentions[0].fields], ["clarify", "READER_UNCERTAINTY", ["address"]]);
});
test("Async transports: the hosted teacher sends ONLY the render; the local transport decodes at temperature 0 under the grammar", async () => {
  const { input, bindings } = build("Tonya, what's in the duffle?");
  const rendered = R.renderReaderPrompt(input);
  assert.throws(() => A.hostedChatTransport({ api: "openai-chat", baseURL: "https://example.invalid", model: "m" }), (e) => e.code === "AUTH_MISSING");
  let sent = null;
  const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body), headers: opts.headers }; return { ok: true, json: async () => ({ model: "teacher-x", choices: [{ message: { content: "ask contents @n1 new f=wh r=e1>r1" } }] }) }; };
  const r = await A.readTurnAsync({ input, bindings, rendered }, { id: "teacher", provider: "test", transport: A.hostedChatTransport({ baseURL: "https://example.invalid/v1", apiKey: "test-key", model: "teacher-x", fetchImpl, maxOutputTokens: 256 }) });
  assert.equal(r.status, "read");
  assert.deepEqual(sent.body.messages, [{ role: "system", content: rendered.system }, { role: "user", content: rendered.user }], "exactly the frozen render");
  assert.equal("temperature" in sent.body, false, "Step 0.1: temperature is sent only when configured");
  assert.deepEqual(Object.keys(sent.body).sort(), ["max_tokens", "messages", "model", "store"], "openai-chat always carries store:false (pre-labelling unblock)");
  assert.equal(sent.body.store, false);
  const all = JSON.stringify(sent.body);
  for (const id of [GISELLE, MALCOLM, TONYA, "q4-startup", "req-2", ...Object.values(bindings.referents)]) assert.ok(!all.includes(id), `transmitted a canonical id: ${id}`);
  assert.equal(r.transport.transmitted.user_sha256, crypto.createHash("sha256").update(rendered.user).digest("hex"), "what was transmitted is recorded");
  let anth = null;
  await A.readTurnAsync({ input, bindings, rendered }, { transport: A.hostedChatTransport({ api: "anthropic-messages", apiKey: "k", model: "m", maxOutputTokens: 256, fetchImpl: async (url, opts) => { anth = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ content: [{ type: "text", text: "ask contents @n1 new" }] }) }; } }) });
  assert.deepEqual([anth.body.system, anth.body.messages, "temperature" in anth.body], [rendered.system, [{ role: "user", content: rendered.user }], false]);
  let local = null;
  const lr = await A.readTurnAsync({ input, bindings }, { grammar: true, logprobs: true, top_logprobs: 8, transport: A.llamaTransport({ endpoint: "http://local", fetchImpl: async (url, opts) => { local = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: "ask contents @n1 new f=wh r=e1>r1" }, logprobs: { content: [{ token: "ask", logprob: -0.01, top_logprobs: [] }] } }] }) }; } }) });
  assert.deepEqual([local.temperature, local.top_k, Boolean(local.grammar), local.logprobs, local.top_logprobs], [0, 1, true, true, 8]);
  assert.equal(lr.grammar_digest, crypto.createHash("sha256").update(W.wireGrammar(input)).digest("hex"));
  assert.ok(Array.isArray(lr.logprobs), "raw token logprobs are kept");
});
test("Logprobs (offline only): raw pre-grammar alternatives are kept; field margins renormalize over grammar-legal first tokens", () => {
  const lp = (token, alts) => ({ token, logprob: Math.log(alts.find((a) => a[0] === token)[1]), top_logprobs: alts.map(([t, p]) => ({ token: t, logprob: Math.log(p) })) });
  const logprobs = [lp("ask", [["SPE", 0.5], ["ask", 0.3], ["request", 0.1], ["{", 0.1]]), lp(" contents", [[" contents", 0.6], [" holder", 0.2], [" banana", 0.2]]), lp(" -", [[" -", 0.9], [" all", 0.1]]), lp(" new", [[" new", 1]])];
  const m = A.wireFieldMargins(logprobs);
  assert.deepEqual(m.map((x) => [x.field, x.chosen_legal, x.legal_alternatives, x.illegal_in_top]), [["speech_act", true, 2, 2], ["facet", true, 2, 1], ["address", true, 2, 0], ["relation", true, 1, 0]]);
  assert.equal(m[0].renormalized_margin, 0.5, "0.3 / 0.4 - 0.1 / 0.4: the illegal 'SPE' and '{' are excluded before renormalizing");
  assert.equal(A.wireFieldMargins(null), null);
});

// ─── 10. fault-injection inertness of the opt-in developer model shadow ────────────────────────────────
const FAULT_LINES = [{ text: "Hi everyone." }, { text: "Giselle, tell me about yourself." }, { text: "Malcolm, your turn." }, { text: "Okay, that's that. Where are we going?" }, { text: "Tonya, what's in the camra?" }];
const FAULTS = Object.freeze({
  throw: { transport: () => { throw new Error("reader exploded"); }, timeout_ms: 300 },
  malformed: { transport: async () => ({ text: "{\"acts\": [\"garbage\"]" }), timeout_ms: 300 },
  hang: { transport: () => new Promise(() => {}), timeout_ms: 250 },
  timeout: { transport: () => new Promise((r) => setTimeout(() => r({ text: "ack - - new" }), 600)), timeout_ms: 200 },
  server_down: { transport: A.llamaTransport({ endpoint: "http://127.0.0.1:9" }), timeout_ms: 1000 },
  well_formed: { transport: async () => ({ text: "ask contents - new f=wh" }), timeout_ms: 300 }
});
async function faultSession(fault, { settle = 900 } = {}) {
  let state = null;
  const shadow = { stats: null, receipts: [], turns: [] };
  const spec = { id: `fault-${fault ?? "off"}`, seed: "rp2-fault", names: C.SCENE_NAMES, lines: FAULT_LINES };
  await C.playFixture(spec, "garbage", async (s) => { shadow.turns.push(s.service.modelShadowInflight ? "inflight" : "idle"); }, {
    serviceOptions: fault ? { modelShadow: { reader: { id: `fault:${fault}`, ...FAULTS[fault] } } } : {},
    onEnd: async (s) => { await new Promise((r) => setTimeout(r, settle)); shadow.stats = { ...s.service.modelShadowStats }; shadow.receipts = s.service.modelShadowReceipts.all(); shadow.trace = s.service.getDialogueTurnTrace({ world_id: s.worldId, request_id: "char-t1" }); state = INERT.captureState(s); }
  });
  return { state, shadow };
}
test("FAULT-INJECTION INERTNESS: throw / malformed / hang / timeout / server down / well-formed shadow readings leave canonical state, save and dialogue history identical (live and after cold reload)", { timeout: 600000 }, async () => {
  const off = await faultSession(null);
  assert.equal(off.shadow.stats.scheduled, 0, "off by default: nothing is scheduled");
  for (const fault of Object.keys(FAULTS)) {
    const on = await faultSession(fault);
    const diff = INERT.firstDiff(off.state, on.state);
    assert.equal(diff, null, `${fault}: ${JSON.stringify(diff)}`);
    assert.ok(on.shadow.stats.scheduled >= 1, `${fault}: the shadow was exercised`);
    assert.equal(on.shadow.stats.completed + on.shadow.stats.unavailable + on.shadow.stats.dropped_busy, on.shadow.stats.scheduled, `${fault}: every scheduled reading is accounted for (read, unavailable or dropped busy)`);
    assert.equal(on.shadow.receipts.length, on.shadow.stats.completed + on.shadow.stats.unavailable);
    for (const r of on.shadow.receipts) assert.equal(r.consumed, false);
    if (["throw", "hang", "timeout", "server_down"].includes(fault)) assert.ok(on.shadow.receipts.every((r) => r.status === "reader_unavailable"), `${fault}: inert reader-unavailable receipts`);
    if (fault === "malformed") assert.ok(on.shadow.receipts.every((r) => r.status === "invalid"));
    assert.ok(!JSON.stringify(on.shadow.trace ?? {}).includes("yellow-beast-reader-async-receipt"), `${fault}: never in the trace view`);
    assert.ok(!JSON.stringify(on.state.live.files).includes("yellow-beast-reader-async"), `${fault}: never saved`);
  }
});
test("FAULT-INJECTION: a 5-second sleeping shadow reader never delays the production turn; busy drops; late / duplicate replies are ignored", { timeout: 120000 }, async () => {
  const timings = async (serviceOptions) => {
    const out = [];
    const s = C.openScenario({ seed: "rp2-latency", provider: C.providerFor({}, "garbage"), serviceOptions });
    try {
      for (const [i, line] of FAULT_LINES.entries()) { const t = Date.now(); await s.say(line.text, { request_id: `lat-${i}` }); out.push(Date.now() - t); }
      return { out, service: s.service, close: () => s.close() };
    } catch (e) { s.close(); throw e; }
  };
  const base = await timings({});
  base.close();
  let calls = 0;
  const sleeping = { transport: () => { calls += 1; return new Promise((r) => setTimeout(() => r({ text: "ack - - new" }), 5000)); }, timeout_ms: 5000 };
  const on = await timings({ modelShadow: { reader: sleeping } });
  try {
    assert.equal(on.service.modelShadowInflight?.request_id, "lat-0", "the first reading is still sleeping");
    assert.ok(on.service.modelShadowStats.dropped_busy >= FAULT_LINES.length - 1, "one in flight: every later turn was dropped while busy");
    const slowest = Math.max(...on.out);
    const baseline = Math.max(...base.out);
    assert.ok(slowest < 1500 && slowest - baseline < 500, `production turns were not delayed (on ${JSON.stringify(on.out)}, off ${JSON.stringify(base.out)})`);
    // Late / duplicate: schedule the same request again after it finishes -> ignored, first receipt kept.
    await new Promise((r) => setTimeout(r, 5400));
    assert.equal(on.service.modelShadowInflight, null);
    const first = on.service.modelShadowReceipts.get("lat-0");
    assert.equal(first.status, "reader_unavailable", "5 s hard timeout");
    on.service.modelShadow.reader = { transport: async () => ({ text: "ask contents - new" }), timeout_ms: 300 };
    on.service.scheduleModelShadow("lat-0");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(on.service.modelShadowReceipts.get("lat-0"), first, "a duplicate / late reply never replaces the receipt");
    assert.ok(on.service.modelShadowStats.late_or_duplicate >= 1);
    assert.equal(calls, 1);
  } finally { on.close(); }
});
test("Model shadow is OFF unless developer mode AND an explicit reader are configured", () => {
  const { DesktopService } = require("../desktop/service");
  const os = require("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-p2-off-"));
  try {
    const reader = { transport: async () => ({ text: "ack - - new" }) };
    assert.equal(new DesktopService({ appDataPath: root, developerMode: false, modelShadow: { reader } }).modelShadow, null, "developer mode off");
    assert.equal(new DesktopService({ appDataPath: root, developerMode: true }).modelShadow, null, "not configured");
    assert.equal(new DesktopService({ appDataPath: root, developerMode: true, modelShadow: { reader: {} } }).modelShadow, null, "no transport");
    assert.equal(new DesktopService({ appDataPath: root, developerMode: true, modelShadow: { reader } }).modelShadow.reader.timeout_ms, 5000, "5 s hard timeout by default");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ─── gold spec (expanded) + token artifact ────────────────────────────────────────────────────────────
test("Expanded gold resolver spec (conclude / withdraw added) stays 100%", { timeout: 600000 }, async () => {
  const items = G.readJsonl(path.join(__dirname, "fixtures/reader-phase1/gold-resolver-spec.jsonl"));
  const { summary } = await G.evaluateGold(items);
  assert.equal(summary.items, 42);
  assert.deepEqual([summary.prefix_invalid, summary.incomplete_state_verification], [[], []]);
  assert.equal(summary.shadow_spec.pct, 100, JSON.stringify(summary.shadow_spec.failures, null, 1));
  for (const id of ["r28a-conclude-active-activity", "r28b-conclude-no-activity", "r28c-conclude-target-not-activity", "r28d-withdraw-activity", "r28e-conclude-then-question", "r28f-conclude-while-starting-activity"]) assert.ok(items.some((i) => i.id === id), id);
});
test("Token-distribution artifact (pinned tokenizer, every replayed ReaderInput) is pinned and meets G1 by class (discourse-bearing and human-trace p90 <= 300)", () => {
  assert.equal(sha256(TOKEN_ARTIFACT), TOKEN_ARTIFACT_SHA256, "the token artifact changed without a governance pin update");
  const doc = JSON.parse(fs.readFileSync(TOKEN_ARTIFACT, "utf8"));
  assert.equal(doc.contract.render, CONTRACT.render);
  assert.equal(doc.contract.render_system_digest, CONTRACT.render_system_digest);
  assert.equal(doc.contract.wire_digest, CONTRACT.wire_digest);
  assert.equal(doc.contract.reader_input, CONTRACT.reader_input);
  assert.ok(doc.turns >= 900, `${doc.turns} replayed turns`);
  assert.equal(doc.g1.pass, true, JSON.stringify(doc.g1));
  assert.ok(doc.classes.discourse_bearing.p90 <= 300 && doc.classes.human_trace.p90 <= 300, JSON.stringify(doc.classes));
  for (const k of ["context_free", "discourse_bearing", "real_scenario", "human_trace"]) assert.ok(doc.classes[k].p99 != null && doc.classes[k].max != null, `${k}: p99 / max guardrails reported`);
  assert.equal(doc.tokenizer.model_sha256, require("../tools/local-runtime-pin.json").model.sha256);
});
