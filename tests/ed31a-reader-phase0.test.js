"use strict";

// Reader Phase 0 -- seam construction only (no behaviour change):
//   ReaderFrame v1 contract + validators V0-V3, the observer-safe ReaderInput, the legacy adapter, the
//   injectable reader seam in DesktopService (legacy v0 / scripted oracle), the resolveTurn passthrough, and
//   the characterization equivalence authority.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RF = require("../tools/dialogue-reader-frame");
const { buildReaderInput } = require("../tools/dialogue-reader-input");
const { frameFromLegacy } = require("../tools/dialogue-reader-legacy");
const reader = require("../tools/dialogue-reader");
const { resolveTurn, RESOLVER_OWNERSHIP } = require("../tools/dialogue-resolve-turn");
const dialogueTurn = require("../tools/dialogue-turn");
const E = require("../tools/dialogue-eval");
const H = require("./fixtures/ed30/harness");

const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };

// A small canonical state: two requests (one answered by Malcolm, one superseded), a pending coworker question.
function ledgerFixture({ inbound = null } = {}) {
  const requests = [
    { request_id: "req-1", predicate: "person.nervousness", targets: [MALCOLM], state: "SUPERSEDED", slots: { [MALCOLM]: { state: "SUPERSEDED" } } },
    { request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: "q4-startup-materials-duffle-01" } },
    { request_id: "req-3", predicate: "person.wellbeing", targets: [GISELLE, MALCOLM], state: "OPEN", slots: { [GISELLE]: { state: "SATISFIED", responder_id: GISELLE }, [MALCOLM]: { state: "OPEN" } } }
  ];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-3", predicate: "person.wellbeing", request_text: "How are you all?", args: null }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: inbound, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
function inputFor(raw, { chip = null, inbound = null, discourse = null } = {}) {
  const { ledger, snapshot } = ledgerFixture({ inbound });
  return buildReaderInput({ raw, chip_target_id: chip, present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger, discourse });
}
function act(input, overrides = {}) {
  const last = input.line.tokens.length - 1;
  return { span: [0, last], speech_act: "question", question_form: "wh", facet: "item.contents", polarity: "positive", name_roles: [], address: { op: "NONE", names: [], relative_to: null, count: null }, relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [], ...overrides };
}
const frameOf = (...acts) => ({ version: RF.READER_FRAME_VERSION, acts });
const codes = (verdict) => Object.values(verdict.layers).flatMap((l) => l.errors ?? []).map((e) => e.code);

// ─── contract ────────────────────────────────────────────────────────────────────────────────────────
test("ReaderFrame v1 expresses linguistic interpretation only: no ids, responders, cardinality or policy ops", () => {
  for (const policy of ["KEEP_RESPONDER", "SHARED", "ASKER_OF_INBOUND", "ANSWERER_OF"]) assert.ok(!RF.ADDRESS_OPS.includes(policy), policy);
  assert.deepEqual([...RF.ADDRESS_OPS], ["NAMED", "ALL", "OTHERS", "EXCEPT", "SECOND_PERSON", "NONE"]);
  assert.deepEqual([...RF.RELATIONS], ["new", "continuation", "repair", "topic_return", "attention", "answer", "withdraw"]);
  for (const forbidden of ["responder_ids", "responders", "cardinality", "addressee_ids", "actor_id", "facts", "state_change", "knowledge", "outcome"]) assert.ok(!RF.ACT_KEYS.includes(forbidden), forbidden);
  const { input } = inputFor("Tonya, what's in the duffle?");
  const schema = JSON.stringify(RF.readerFrameSchema(input));
  assert.ok(!/yb-personnel|q4-|req-|dr-kirk/.test(schema), "the decoding schema carries labels, never canonical ids");
  assert.ok(!/KEEP_RESPONDER|SHARED|ANSWERER_OF|ASKER_OF_INBOUND|cardinality/.test(schema));
});

// ─── V0 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V0 schema: accepts a well-formed frame; rejects unknown keys, bad enums, >3 acts and bad spans", () => {
  const { input } = inputFor("Tonya, what's in the duffle?");
  const ok = frameOf(act(input));
  assert.equal(RF.validateSchema(ok, input).ok, true, JSON.stringify(RF.validateSchema(ok, input).errors));
  const bad = (frame) => { const v = RF.validateReaderFrame(frame, input); assert.equal(v.disposition, "reject"); return codes(v); };
  assert.ok(bad({ ...ok, responders: ["p1"] }).includes("unknown_key"));
  assert.ok(bad(frameOf({ ...act(input), cardinality: "each_self" })).includes("unknown_key"));
  assert.ok(bad(frameOf(act(input, { address: { op: "KEEP_RESPONDER", names: [], relative_to: null, count: null } }))).includes("enum"));
  assert.ok(bad(frameOf(act(input, { address: { op: "NAMED", names: [], relative_to: null, count: null, ids: ["x"] } }))).includes("unknown_key"));
  assert.ok(bad(frameOf(act(input, { speech_act: "command" }))).includes("enum"));
  assert.ok(bad(frameOf(act(input, { span: [0, 1] }), act(input, { span: [2, 3] }), act(input, { span: [4, 5] }), act(input, { span: [6, 7] }))).includes("too_many_acts"));
  assert.ok(bad(frameOf(act(input, { span: [0, 3] }), act(input, { span: [2, 5] }))).includes("span_order"));
  assert.ok(bad(frameOf(act(input, { span: [0, 99] }))).includes("span_range"));
  assert.ok(bad(frameOf(act(input, { relation: { kind: "new", target: "yb-personnel-1" } }))).includes("label_shape"));
  assert.ok(bad({ version: "other", acts: [act(input)] }).includes("version"));
  assert.ok(bad(null).includes("not_an_object"));
});

// ─── V1 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V1 candidates: labels from the supplied lists; facet in registry and compatible with form, wh-word, time and referent kind", () => {
  const { input } = inputFor("Tonya, where is the duffle?");
  const v1 = (a) => codes(RF.validateReaderFrame(frameOf(a), input));
  assert.ok(v1(act(input, { name_roles: [{ name: "n9", role: "vocative" }] })).includes("unknown_name_span"));
  assert.ok(v1(act(input, { relation: { kind: "continuation", target: "q9" } })).includes("unknown_request"));
  assert.ok(v1(act(input, { relation: { kind: "answer", target: "i1" } })).includes("unknown_inbound"));
  assert.ok(v1(act(input, { facet: "item.flavour" })).includes("unknown_facet"));
  assert.ok(v1(act(input, { facet: "item.holder" })).includes("wh_incompatible"), "'where' cannot ask item.holder");
  assert.ok(v1(act(input, { facet: "item.contents", question_form: "yes_no" })).includes("question_form_incompatible"));
  assert.ok(v1(act(input, { facet: "person.nervousness", question_form: "yes_no", temporal: "ever" })).includes("temporal_unsupported"));
  const place = input.referent_candidates.find((r) => r.kind === "place").label;
  assert.ok(v1(act(input, { facet: "item.location", referent: { span: null, candidate: place } })).includes("referent_kind_incompatible"));
  assert.ok(v1(act(input, { facet: "NOT_APPLICABLE" })).includes("asking_act_without_facet"));
  assert.ok(v1(act(input, { referent: { span: null, candidate: "r99" } })).includes("unknown_referent"));
  const item = input.referent_candidates.find((r) => r.kind === "item").label;
  assert.deepEqual(v1(act(input, { facet: "item.location", referent: { span: "e1", candidate: item }, name_roles: [{ name: "n1", role: "vocative" }], address: { op: "NAMED", names: ["n1"], relative_to: null, count: null } })), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf(act(input, { span: [0, 2] }), act(input, { span: [3, 6], relation: { kind: "continuation", target: "s1" } })), input)).includes("same_turn_forward_reference"));
});

// ─── V2 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V2 surface: chip target wins; NAMED needs a name span; no invented or absent addressees; standalone names read against the DIS", () => {
  const withChip = inputFor("Tonya, how are you?", { chip: MALCOLM }).input;
  const named = (names) => ({ op: "NAMED", names, relative_to: null, count: null });
  const v = (input, a) => RF.validateReaderFrame(frameOf(a), input);
  assert.ok(codes(v(withChip, act(withChip, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: named(["n1"]) }))).includes("contradicts_chip_target"));
  assert.ok(!codes(v(withChip, act(withChip, { facet: "person.wellbeing", address: { op: "SECOND_PERSON", names: [], relative_to: null, count: null } }))).includes("contradicts_chip_target"));
  const plain = inputFor("how are you all?").input;
  assert.ok(codes(v(plain, act(plain, { facet: "person.wellbeing", address: named([]) }))).includes("named_without_name_span"));
  const absent = inputFor("Maxwell, are you there?").input;
  const maxwell = absent.features.name_spans.find((n) => n.non_present_person);
  assert.ok(maxwell, "an absent known person is a name span (feature), not an addressee");
  const verdict = v(absent, act(absent, { facet: "person.presence", question_form: "yes_no", name_roles: [{ name: maxwell.label, role: "vocative" }], address: named([maxwell.label]) }));
  assert.ok(codes(verdict).includes("addressee_not_present"));
  assert.ok(verdict.clarify_slots.includes("person"));
  const bare = inputFor("Tonya.").input;
  const bareName = bare.features.name_spans[0];
  assert.equal(bareName.standalone, true);
  assert.ok(codes(v(bare, act(bare, { speech_act: "statement", question_form: "none", facet: "NOT_APPLICABLE", name_roles: [{ name: bareName.label, role: "mention" }] }))).includes("standalone_name_as_mention"));
  assert.ok(codes(v(bare, act(bare, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", name_roles: [{ name: bareName.label, role: "answer_to_inbound" }] }))).includes("answer_role_without_inbound"));
  const ask = inputFor("Tonya.", { inbound: { event_id: "ev-9", speaker_id: MALCOLM, kind: "question", predicate: "item.holder", answer_shape: "person", options: [] } }).input;
  assert.deepEqual(codes(v(ask, act(ask, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", name_roles: [{ name: "n1", role: "answer_to_inbound" }], relation: { kind: "answer", target: "i1" }, inbound_answer: { kind: "answer", option: null } }))), []);
});

// ─── V3 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V3 discourse: answers need a pending inbound; continuations need an eligible antecedent; set ops resolve; withdraw targets open state", () => {
  const { input } = inputFor("the rest of you?");
  const v = (a) => RF.validateReaderFrame(frameOf(a), input);
  const q = (label) => input.conversation.requests.find((r) => r.label === label);
  const superseded = input.conversation.requests.find((r) => r.state === "SUPERSEDED").label;
  const satisfied = input.conversation.requests.find((r) => r.state === "SATISFIED").label;
  const open = input.conversation.requests.find((r) => r.state === "OPEN").label;
  assert.ok(q(open) && q(satisfied) && q(superseded));
  assert.ok(codes(v(act(input, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "answer", target: null } }))).includes("answer_without_pending_inbound"));
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: null } }))).includes("no_antecedent"));
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: superseded } }))).includes("antecedent_not_eligible"));
  assert.ok(codes(v(act(input, { speech_act: "statement", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "withdraw", target: satisfied } }))).includes("withdraw_of_closed_request"));
  assert.deepEqual(codes(v(act(input, { speech_act: "statement", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "withdraw", target: open } }))), []);
  const tonya = inputFor("everyone except Tonya?").input;
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf(act(tonya, { facet: "person.wellbeing", address: { op: "EXCEPT", names: ["n1"], relative_to: null, count: null } })), tonya)), []);
  // OTHERS relative to the open wellbeing request: Giselle answered, Tonya spoke last -> Malcolm remains (one).
  assert.deepEqual(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: open }, address: { op: "OTHERS", names: [], relative_to: open, count: null } }))), []);
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: open }, address: { op: "OTHERS", names: [], relative_to: open, count: 2 } }))).includes("others_count_mismatch"));
  assert.ok(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: null } })).clarify_slots.includes("topic"));
});

// ─── ReaderInput observer safety ────────────────────────────────────────────────────────────────────
test("ReaderInput is observer-safe: no canonical ids, no optional (unspoken) fact values, no private state, no prompt internals", () => {
  const discourse = { last_turn: { kind: "player_exchange", player_text: "Malcolm, how are you?", responses: [{ speaker_id: MALCOLM, text: "Doing fine, thanks.", facts: { required: [{ key: "self_state", value: "fine" }], optional: [{ key: "held_equipment", value: ["Portable mass spectrometer"] }, { key: "agenda_mention", value: "OPTIONAL-ONLY-MARKER Outpost A" }] } }] } };
  const { input, bindings } = inputFor("what's that?", { discourse });
  const json = JSON.stringify(input);
  const ids = [...Object.values(bindings.people), ...Object.values(bindings.requests), ...Object.values(bindings.referents), ...Object.values(bindings.names), ...sc.entities.map((e) => e.id)].filter((x) => typeof x === "string" && x.length > 6 && !["complex", "threshold", "standard"].includes(x));
  for (const id of ids) assert.ok(!json.includes(id), `canonical id leaked: ${id}`);
  assert.ok(!json.includes("OPTIONAL-ONLY-MARKER"), "an optional fact's value never reaches the reader");
  const spectrometer = input.referent_candidates.find((r) => /spectrometer/i.test(r.name))?.label;
  const outpost = input.referent_candidates.find((r) => /Outpost A/.test(r.name))?.label;
  assert.ok(!input.conversation.salient_entities.includes(spectrometer), "salience never comes from optional facts");
  assert.ok(!input.conversation.salient_entities.includes(outpost));
  assert.equal(input.conversation.salience_source, "player_words+required_facts");
  for (const key of ["personhood", "async_tenure", "complex_experience", "self_state", "knowledge", "profile", "private", "system", "prompt", "schema", "instructions", "facts"]) assert.ok(!new RegExp(`"${key}"`).test(json), `unexpected key ${key}`);
  assert.deepEqual(Object.keys(input).sort(), ["chip_target", "conversation", "features", "heard", "line", "people", "referent_candidates", "version"]);
  assert.equal(input.heard.presentation_dependent, true);
  assert.ok(input.heard.lines.some((l) => l.text === "Doing fine, thanks."), "spoken wording travels only in the heard channel");
  assert.ok(!JSON.stringify(input.conversation).includes("Doing fine"), "wording never enters the canonical conversation section");
  // Requests: who answered comes from the ledger's own slots (not the prose).
  const wellbeing = input.conversation.requests.find((r) => r.facet === "person.wellbeing");
  assert.deepEqual(wellbeing.answered_by, ["p1"]);
});

test("ReaderInput features are code facts (spans, token classes), never decisions", () => {
  const { input } = inputFor("malcolm ru tired");
  const n = input.features.name_spans[0];
  assert.deepEqual({ person: n.person, position: n.position, delimited: n.delimited, capitalized: n.capitalized, standalone: n.standalone }, { person: "p2", position: "initial", delimited: false, capitalized: false, standalone: false });
  assert.ok(!("role" in n) && !("vocative" in n), "the name's role is the reader's to decide");
  assert.equal(input.features.punctuation.terminal, "none");
  const wh = inputFor("Tonya, where did you put it?").input;
  assert.deepEqual(wh.features.wh.map((w) => w.word), ["where"]);
  assert.ok(wh.features.second_person.length === 1 && wh.features.deictics.some((d) => d.word === "it"));
});

// ─── legacy adapter ──────────────────────────────────────────────────────────────────────────────────
test("frameFromLegacy expresses the current parser's decisions as a valid ReaderFrame and classifies what it cannot", () => {
  const { ledger, snapshot } = ledgerFixture();
  const readerInput = buildReaderInput({ raw: "Tonya, what is in the duffle?", present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger });
  const analysis = dialogueTurn.analyzeTurn({ raw: "Tonya, what is in the duffle?", present: sc.present, entities: sc.entities, dis: null });
  const { frame, conversion } = frameFromLegacy(analysis, readerInput);
  assert.equal(frame.acts[0].address.op, "NAMED");
  assert.equal(frame.acts[0].facet, "item.contents");
  assert.equal(RF.validateReaderFrame(frame, readerInput.input).ok, true, JSON.stringify(RF.validateReaderFrame(frame, readerInput.input)));
  assert.equal(conversion.exact, true, JSON.stringify(conversion.notes));
  const we = buildReaderInput({ raw: "we all going in together?", present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger });
  const weAnalysis = dialogueTurn.analyzeTurn({ raw: "we all going in together?", present: sc.present, entities: sc.entities, dis: null });
  const weOut = frameFromLegacy(weAnalysis, we);
  assert.ok(weOut.conversion.notes.some((x) => x.class === "needs-owner-decision" && x.code === "collective_subject_routed_as_group_address"));
  assert.equal(weOut.frame.acts[0].address.op, "NONE", "ReaderFrame is not widened to encode the legacy convention");
  assert.equal(weOut.frame.acts[0].subject.kind, "group_inclusive");
});

// ─── seam in DesktopService ──────────────────────────────────────────────────────────────────────────
test("Reader seam: production records a legacy-v0 receipt per LOCAL turn; resolveTurn is an identity passthrough; nothing is persisted", async () => {
  const state = H.setup("rp0-seam", H.garbage());
  try {
    const t = await H.turn(state, "Tonya, what's in the duffle?");
    const record = state.service.readerReceipts.get(t.id);
    assert.ok(record, "receipt recorded");
    assert.equal(record.receipt.reader.id, "legacy-v0");
    assert.equal(record.legacy_v0, record.receipt, "default reader IS the legacy reader v0");
    assert.equal(record.receipt.consumed, false);
    assert.equal(record.resolution.source, "legacy_passthrough");
    assert.equal(record.resolution.same_analysis, true);
    assert.equal(record.receipt.verdict.disposition, "accept");
    const trace = state.service.getDialogueTurnTrace({ world_id: state.worldId, request_id: t.id });
    assert.equal(trace.trace.reader.receipt.request_id, t.id, "developer trace carries the receipt");
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    const saved = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else saved.push(fs.readFileSync(p, "utf8")); } };
    walk(state.root);
    assert.ok(!saved.some((s) => s.includes("yellow-beast-reader-receipt") || s.includes("yellow-beast-reader-input")), "Phase 0 never writes reader records into the save");
  } finally { H.cleanup(state); }
  assert.throws(() => resolveTurn(null, null, []), (e) => e.code === "RESOLVER_NOT_IMPLEMENTED");
  assert.ok(Object.keys(RESOLVER_OWNERSHIP).includes("responder_priority"));
});

test("Reader seam: an injected scripted oracle is read and validated, legacy v0 still recorded, and the turn's behaviour is identical", async () => {
  const { DesktopService } = require("../desktop/service");
  const run = async (dialogueReader) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-rp0-"));
    const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, localDialogueProvider: H.garbage(), ...(dialogueReader ? { dialogueReader } : {}) });
    service.log = () => {};
    const state = { root, service, counter: 0, logs: [] };
    const worldId = service.createWorld({ name: "RP0", seed: "rp0-oracle" }).world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Jack", last_name: "Tester" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    Object.assign(state, { worldId });
    Object.defineProperty(state, "run", { get: () => service.session(worldId, "field-researcher").run });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    for (let b = 0; b < 3; b += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    for (const line of ["Hello everyone!", "how are you all?", "the rest of you?"]) await service.submitQ4Communication({ world_id: worldId, channel: "local", text: line, request_id: `o-${++state.counter}` });
    const digest = H.semanticDigest(state.run);
    const receipts = [1, 2, 3].map((i) => service.readerReceipts.get(`o-${i}`));
    try { service.shutdown?.(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    return { digest, receipts };
  };
  const oracle = reader.createOracleReader({
    "o-2": (input) => ({ version: RF.READER_FRAME_VERSION, acts: [{ span: [0, input.line.tokens.length - 1], speech_act: "question", question_form: "wh", facet: "person.wellbeing", polarity: "positive", name_roles: [], address: { op: "ALL", names: [], relative_to: null, count: null }, relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "all", inbound_answer: null, subject: { kind: "addressee", names: [] }, self_intro: null, echo: null, requested_action: null, abstain: [] }] })
  });
  const legacy = await run(null);
  const withOracle = await run(oracle);
  assert.equal(withOracle.digest.digest, legacy.digest.digest, "Phase 0: the reader choice never changes behaviour");
  assert.equal(withOracle.digest.truth, legacy.digest.truth);
  const r2 = withOracle.receipts[1];
  assert.equal(r2.receipt.reader.id, "oracle");
  assert.equal(r2.receipt.verdict.disposition, "accept", JSON.stringify(r2.receipt.verdict));
  assert.equal(r2.legacy_v0.reader.id, "legacy-v0", "legacy v0 is recorded alongside an injected reader");
  assert.equal(withOracle.receipts[0].receipt.frame, null, "an oracle with no script for a turn reads nothing (no guess)");
  assert.equal(oracle.seen.length, 3, "the oracle saw every LOCAL turn's input");
});

// ─── characterization authority ──────────────────────────────────────────────────────────────────────
test("Characterization: current production behaviour on the J15 chain replays identically to the committed equivalence authority", async () => {
  const { characterizeSession, collectFixtures } = require("../tools/dialogue-characterize");
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/acceptance/reader-phase0/characterization.json"), "utf8"));
  const spec = collectFixtures({ quick: true }).find((s) => s.id === "j15/5-chain.txt");
  const reference = snapshot.sessions.find((s) => s.id === spec.id);
  assert.ok(reference, "the snapshot covers the chain");
  const now = await characterizeSession(spec, "fallback");
  assert.deepEqual(now, reference.turns.fallback);
});

// ─── gold-DIS evaluator (mechanics only; the fixture is a harness self-test, not a corpus) ─────────────
test("Gold-DIS evaluator drives the shipped service with an oracle, builds context canonically, and keeps the three measurements separate", async () => {
  const G = require("../tools/dialogue-gold-eval");
  const items = G.readJsonl(path.join(__dirname, "fixtures/reader-phase0/gold-harness-selftest.jsonl"));
  const { summary, results } = await G.evaluateGold(items);
  assert.deepEqual(summary.prefix_invalid, ["s4"], "a prefix that does not build its stated canonical state is never scored");
  assert.equal(summary.scored, 4);
  assert.deepEqual(summary.gold_frames_rejected_by_validators, [], "every gold frame passes V0-V3 against its own ReaderInput");
  assert.equal(summary.resolver_spec.status, "not_implemented (Phase 1)", "the frame-driven resolver is reported as absent, never faked");
  for (const r of results.filter((x) => x.status === "scored")) {
    assert.equal(r.reader.id, "legacy-v0");
    assert.ok(Object.keys(r.reader.fields).length > 0);
    assert.ok("fields" in r.behaviour && "got" in r.behaviour);
  }
  const s1 = results.find((r) => r.id === "s1");
  assert.deepEqual(s1.behaviour.got.responders, ["Tonya"], "behaviour is read from what production committed");
});

test("Relation targets may name the active activity round (v1) or a heard sentence (aN), validated like any label", () => {
  const { ledger, snapshot } = ledgerFixture();
  const withActivity = buildReaderInput({ raw: "malcolm your turn", present: sc.present, player: PLAYER, entities: sc.entities, ledger, snapshot: { ...snapshot, activity: { activity_id: "act-1", kind: "SELF_INTRODUCTION_ROUND", template: { predicate: "person.self_description" }, completed: [GISELLE], eligible: [GISELLE, MALCOLM, TONYA] }, surface_anchors: [{ speaker_id: TONYA, event_id: "ev-1", spans: [{ text: "Nobody's told me what's in it.", request_id: "req-2", predicate: "item.contents" }] }] } }).input;
  assert.equal(withActivity.conversation.activity.label, "v1");
  assert.deepEqual(withActivity.conversation.activity.remaining, ["p2", "p3"]);
  const base = act(withActivity, { speech_act: "elliptical_continuation", question_form: "none", facet: "person.self_description", name_roles: [{ name: "n1", role: "vocative" }], address: { op: "NAMED", names: ["n1"], relative_to: null, count: null } });
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf({ ...base, relation: { kind: "continuation", target: "v1" } }), withActivity)), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf({ ...base, relation: { kind: "repair", target: "v1" } }), withActivity)).includes("activity_antecedent_only_continues"));
  const anchor = withActivity.conversation.surface_anchors[0].label;
  assert.equal(withActivity.heard.anchors[0].anchor, anchor, "the anchor's words travel only in the heard channel");
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf(act(withActivity, { facet: "conversation.meaning_of", relation: { kind: "continuation", target: anchor } })), withActivity)), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf(act(withActivity, { facet: "conversation.meaning_of", relation: { kind: "continuation", target: "a9" } })), withActivity)).includes("unknown_anchor"));
  const { input: none } = inputFor("your turn");
  assert.ok(codes(RF.validateReaderFrame(frameOf({ ...act(none, { speech_act: "elliptical_continuation", facet: "person.self_description", question_form: "none" }), relation: { kind: "continuation", target: "v1" } }), none)).includes("unknown_activity"));
});
