"use strict";

// Reader Phase 0 / 0.5 -- seam construction and trust (no behaviour change):
//   ReaderFrame v1 contract + validators V0-V3 (incl. the Phase-0.5 evidence / licensing / non-asking gaps), the
//   observer-safe ReaderInput (synthetic AND real service state), the legacy adapter, the injectable reader seam
//   (legacy v0 / scripted oracle) and its inertness, the frame-driven resolveTurn (spec suite on gold frames), the
//   round-trip harness, the gold-DIS evaluator, and the PINNED characterization authority.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RF = require("../tools/dialogue-reader-frame");
const { buildReaderInput } = require("../tools/dialogue-reader-input");
const { frameFromLegacy } = require("../tools/dialogue-reader-legacy");
const reader = require("../tools/dialogue-reader");
const { resolveTurn, RESOLVER_OWNERSHIP } = require("../tools/dialogue-resolve-turn");
const dialogueTurn = require("../tools/dialogue-turn");
const C = require("../tools/dialogue-characterize");
const RT = require("../tools/dialogue-reader-roundtrip");
const E = require("../tools/dialogue-eval");
const H = require("./fixtures/ed30/harness");

const ROOT = path.join(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "docs", "acceptance", "reader-phase0");
// ── PINNED AUTHORITIES (governance): changing an artifact without updating these pins fails this suite; updating
// a pin changes this file's hash, which verification/verification-authority.json governs. ──
const CHARACTERIZATION_SHA256 = "cae21415ebc5a1a1af9d9dfe8c93e3b01276ad2ac8006f9e5f11df6dc0d06c88";
const ROUNDTRIP_SHA256 = "92bac0506c6c223e27e29f5bb2243953908d0f3733263841219eaf9488e0554b";
const BASELINE_FAILING_SHA256 = "cf4d4d86207e7b856fa3a8c08977e98ba49c863af39d8b70d556f54a4d9c40c0";

const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// A small canonical state: three requests (one superseded, one answered by Tonya, one half-answered), no inbound.
function ledgerFixture({ inbound = null } = {}) {
  const requests = [
    { request_id: "req-1", predicate: "person.nervousness", targets: [MALCOLM], state: "SUPERSEDED", slots: { [MALCOLM]: { state: "SUPERSEDED" } } },
    { request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: "q4-startup-materials-duffle-01" } },
    { request_id: "req-3", predicate: "person.wellbeing", targets: [GISELLE, MALCOLM], state: "OPEN", slots: { [GISELLE]: { state: "SATISFIED", responder_id: GISELLE }, [MALCOLM]: { state: "OPEN" } } }
  ];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-3", predicate: "person.wellbeing", request_text: "How are you all?", args: null }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: inbound, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
function inputFor(raw, { chip = null, inbound = null, discourse = null, snapshot: extra = {} } = {}) {
  const { ledger, snapshot } = ledgerFixture({ inbound });
  return buildReaderInput({ raw, chip_target_id: chip, present: sc.present, player: PLAYER, entities: sc.entities, snapshot: { ...snapshot, ...extra }, ledger, discourse });
}
function act(input, overrides = {}) {
  const last = input.line.tokens.length - 1;
  return { span: [0, last], speech_act: "question", question_form: "wh", facet: "item.contents", polarity: "positive", name_roles: [], address: { op: "NONE", names: [], relative_to: null, count: null }, relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [], ...overrides };
}
const frameOf = (...acts) => ({ version: RF.READER_FRAME_VERSION, acts });
const codes = (verdict) => Object.values(verdict.layers).flatMap((l) => l.errors ?? []).map((e) => e.code);
const op = (o, names = [], extra = {}) => ({ op: o, names, relative_to: null, count: null, ...extra });

// ─── contract ────────────────────────────────────────────────────────────────────────────────────────
test("ReaderFrame v1 expresses linguistic interpretation only: no ids, responders, cardinality or policy ops", () => {
  for (const policy of ["KEEP_RESPONDER", "SHARED", "ASKER_OF_INBOUND", "ANSWERER_OF"]) assert.ok(!RF.ADDRESS_OPS.includes(policy), policy);
  assert.deepEqual([...RF.ADDRESS_OPS], ["NAMED", "ALL", "OTHERS", "EXCEPT", "SECOND_PERSON", "NONE"]);
  // Reader Phase 2 (ReaderFrame v2): `conclude` is a linguistic relation; code alone decides any activity closure.
  assert.deepEqual([...RF.RELATIONS], ["new", "continuation", "repair", "topic_return", "attention", "answer", "withdraw", "conclude"]);
  assert.deepEqual([...RF.NAME_ROLES], ["vocative", "mention", "answer_to_inbound", "greeting_target", "repair_target"]);
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
  assert.ok(bad(frameOf(act(input, { address: op("KEEP_RESPONDER") }))).includes("enum"));
  assert.ok(bad(frameOf(act(input, { address: op("NAMED", [], { ids: ["x"] }) }))).includes("unknown_key"));
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
  assert.ok(v1(act(input, { facet: "NOT_APPLICABLE" })).includes("asking_act_without_facet"));
  assert.ok(v1(act(input, { referent: { span: null, candidate: "r99" } })).includes("unknown_referent"));
  const item = input.referent_candidates.find((r) => r.kind === "item").label;
  assert.deepEqual(v1(act(input, { facet: "item.location", referent: { span: "e1", candidate: item }, name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]) })), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf(act(input, { span: [0, 2] }), act(input, { span: [3, 6], relation: { kind: "continuation", target: "s1" } })), input)).includes("same_turn_forward_reference"));
});

test("V1 referent licensing: only entity spans, salience, the active place or the anaphoric set -- never the whole candidate list", () => {
  // Salient (from the last request's args / required facts): the duffle; not named in this line.
  const { input } = inputFor("what's in it?", { snapshot: { last_request: { request_id: "req-2", predicate: "item.contents", request_text: "What's in the duffle?", args: { item_id: "q4-startup-materials-duffle-01" } } } });
  const duffle = input.referent_candidates.find((r) => /duffle/i.test(r.name));
  assert.ok(duffle, "the anaphoric set carries what the last request was about");
  assert.ok(input.conversation.anaphora_candidates.includes(duffle.label));
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf(act(input, { referent: { span: null, candidate: duffle.label } })), input)), []);
  // A candidate present only because the player named it in ANOTHER act is not licensed for this act.
  const two = inputFor("where's the camera? and what's in it?").input;
  const camera = two.referent_candidates.find((r) => /camera/i.test(r.name)).label;
  const verdict = RF.validateReaderFrame(frameOf(act(two, { span: [0, 4], facet: "item.location" }), act(two, { span: [5, two.line.tokens.length - 1], referent: { span: null, candidate: camera } })), two);
  assert.ok(!codes(verdict).includes("referent_not_licensed"), "a thing the line itself names (basis line) is licensed");
  // The candidate list is never the canonical index: an unrelated, unknown item is absent.
  assert.ok(!input.referent_candidates.some((r) => /spectrometer/i.test(r.name)), "a hidden / unrelated entity is not a candidate");
});

// ─── V2 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V2 surface: chip target wins; NAMED needs a name span; no invented or absent addressees; standalone names read against the DIS", () => {
  const withChip = inputFor("Tonya, how are you?", { chip: MALCOLM }).input;
  const v = (input, a) => RF.validateReaderFrame(frameOf(a), input);
  assert.ok(codes(v(withChip, act(withChip, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]) }))).includes("contradicts_chip_target"));
  assert.ok(!codes(v(withChip, act(withChip, { facet: "person.wellbeing", address: op("SECOND_PERSON") }))).includes("contradicts_chip_target"));
  const plain = inputFor("how are you all?").input;
  assert.ok(codes(v(plain, act(plain, { facet: "person.wellbeing", address: op("NAMED") }))).includes("named_without_name_span"));
  const absent = inputFor("Maxwell, are you there?").input;
  const maxwell = absent.features.name_spans.find((n) => n.non_present_person);
  assert.ok(maxwell, "an absent known person is a name span (feature), not an addressee");
  const verdict = v(absent, act(absent, { facet: "person.presence", question_form: "yes_no", name_roles: [{ name: maxwell.label, role: "vocative" }], address: op("NAMED", [maxwell.label]) }));
  assert.ok(codes(verdict).includes("addressee_not_present"));
  assert.ok(verdict.clarify_slots.includes("person"));
  const bare = inputFor("Tonya.").input;
  const bareName = bare.features.name_spans[0];
  assert.equal(bareName.standalone, true);
  assert.ok(codes(v(bare, act(bare, { speech_act: "statement", question_form: "none", facet: "NOT_APPLICABLE", name_roles: [{ name: bareName.label, role: "mention" }] }))).includes("standalone_name_as_mention"));
  assert.ok(codes(v(bare, act(bare, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", name_roles: [{ name: bareName.label, role: "answer_to_inbound" }] }))).includes("answer_role_without_inbound"));
  // repair_target: a NAMED mention allowed only on an addressee repair.
  const fix = inputFor("No, I was asking Malcolm.").input;
  const named = { facet: "person.wellbeing", speech_act: "repair", question_form: "none", name_roles: [{ name: "n1", role: "repair_target" }], address: op("NAMED", ["n1"]), relation: { kind: "repair", target: "q2" } };
  assert.ok(!codes(v(fix, act(fix, { ...named, repair_kind: "addressee" }))).includes("named_span_not_vocative"));
  assert.ok(codes(v(fix, act(fix, { ...named, repair_kind: "facet" }))).includes("named_span_not_vocative"));
});

test("V2 evidence: ALL / OTHERS / EXCEPT / SECOND_PERSON need surface evidence; respondent mode must be expressed and compatible; asking lines never silently become remarks", () => {
  const v = (raw, a) => { const { input } = inputFor(raw); return codes(RF.validateReaderFrame(frameOf(act(input, a(input))), input)); };
  assert.ok(v("how are you doing", () => ({ facet: "person.wellbeing", address: op("ALL") })).includes("all_without_evidence"));
  assert.ok(!v("how are you all doing", () => ({ facet: "person.wellbeing", address: op("ALL"), respondent_mode: "all" })).includes("all_without_evidence"));
  assert.ok(!v("is it everyone's first day?", () => ({ facet: "person.first_day_at_async", question_form: "yes_no", address: op("ALL"), respondent_mode: "each" })).includes("respondent_mode_without_evidence"), "possessives are evidence");
  assert.ok(!v("does anyone know where we're going?", () => ({ facet: "mission.destination", address: op("ALL"), respondent_mode: "any" })).includes("all_without_evidence"));
  assert.ok(v("how are you doing", () => ({ facet: "person.wellbeing", address: op("OTHERS"), relation: { kind: "continuation", target: "q3" } })).includes("others_without_evidence"));
  assert.ok(v("everyone but Tonya?", (i) => ({ facet: "person.wellbeing", address: op("EXCEPT", [i.features.name_spans[0].label]) })).length === 0);
  assert.ok(v("everyone with Tonya?", (i) => ({ facet: "person.wellbeing", address: op("EXCEPT", [i.features.name_spans[0].label]) })).includes("except_without_evidence"));
  assert.ok(v("how is Tonya", () => ({ facet: "person.wellbeing", address: op("SECOND_PERSON") })).includes("second_person_without_evidence"));
  assert.ok(v("Tonya, how are you?", (i) => ({ facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]), respondent_mode: "each" })).includes("respondent_mode_without_evidence"));
  assert.ok(v("Tonya, how are you all?", () => ({ facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]), respondent_mode: "all" })).includes("respondent_mode_contradicts_address"));
  assert.ok(v("what could possibly go wrong lol", () => ({ speech_act: "sarcasm", question_form: "none", facet: "NOT_APPLICABLE" })).includes("non_asking_reading_with_asking_features"));
  assert.ok(v("where's the duffle?", () => ({ speech_act: "aside", question_form: "none", facet: "NOT_APPLICABLE" })).includes("non_asking_reading_with_asking_features"));
  assert.ok(!v("where's the duffle?", () => ({ speech_act: "aside", question_form: "none", facet: "NOT_APPLICABLE", abstain: ["force"] })).includes("non_asking_reading_with_asking_features"), "an explicit abstention is not a silent remark");
});

// ─── V3 ──────────────────────────────────────────────────────────────────────────────────────────────
test("V3 discourse: answers need a pending inbound; continuations need an eligible antecedent; set ops resolve; withdraw targets open state", () => {
  const { input } = inputFor("the rest of you?");
  const v = (a) => RF.validateReaderFrame(frameOf(a), input);
  const superseded = input.conversation.requests.find((r) => r.state === "SUPERSEDED").label;
  const satisfied = input.conversation.requests.find((r) => r.state === "SATISFIED").label;
  const open = input.conversation.requests.find((r) => r.state === "OPEN").label;
  assert.ok(codes(v(act(input, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "answer", target: null } }))).includes("answer_without_pending_inbound"));
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: null } }))).includes("no_antecedent"));
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: superseded } }))).includes("antecedent_not_eligible"));
  const never = inputFor("never mind that").input;
  const w = (target) => codes(RF.validateReaderFrame(frameOf(act(never, { speech_act: "statement", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "withdraw", target } })), never));
  assert.ok(w(satisfied).includes("withdraw_of_closed_request"));
  assert.deepEqual(w(open), []);
  // OTHERS relative to the open wellbeing request: Giselle answered, Tonya spoke last -> Malcolm remains (one).
  assert.deepEqual(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: open }, address: op("OTHERS", [], { relative_to: open }) }))), []);
  assert.ok(codes(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: open }, address: op("OTHERS", [], { relative_to: open, count: 2 }) }))).includes("others_count_mismatch"));
  assert.ok(v(act(input, { facet: "person.wellbeing", relation: { kind: "continuation", target: null } })).clarify_slots.includes("topic"));
});

test("Relation targets may name the active activity round (v1) or a heard sentence (aN, heard channel only)", () => {
  const withActivity = inputFor("malcolm your turn", { snapshot: { activity: { activity_id: "act-1", kind: "SELF_INTRODUCTION_ROUND", template: { predicate: "person.self_description" }, completed: [GISELLE], eligible: [GISELLE, MALCOLM, TONYA] }, surface_anchors: [{ speaker_id: TONYA, event_id: "ev-1", spans: [{ text: "Nobody's told me what's in it.", request_id: "req-2", predicate: "item.contents" }] }] } }).input;
  assert.equal(withActivity.conversation.activity.label, "v1");
  assert.deepEqual(withActivity.conversation.activity.remaining, ["p2", "p3"]);
  const base = act(withActivity, { speech_act: "elliptical_continuation", question_form: "none", facet: "person.self_description", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]) });
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf({ ...base, relation: { kind: "continuation", target: "v1" } }), withActivity)), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf({ ...base, relation: { kind: "repair", target: "v1" } }), withActivity)).includes("activity_antecedent_only_continues"));
  assert.ok(!("surface_anchors" in withActivity.conversation), "anchor count and shape are provider-dependent: never in the canonical section");
  const anchor = withActivity.heard.anchors[0];
  assert.equal(anchor.text, "Nobody's told me what's in it.");
  assert.deepEqual(codes(RF.validateReaderFrame(frameOf(act(withActivity, { facet: "conversation.meaning_of", relation: { kind: "continuation", target: anchor.label } })), withActivity)), []);
  assert.ok(codes(RF.validateReaderFrame(frameOf(act(withActivity, { facet: "conversation.meaning_of", relation: { kind: "continuation", target: "a9" } })), withActivity)).includes("unknown_anchor"));
  const { input: none } = inputFor("your turn");
  assert.ok(codes(RF.validateReaderFrame(frameOf({ ...act(none, { speech_act: "elliptical_continuation", facet: "person.self_description", question_form: "none" }), relation: { kind: "continuation", target: "v1" } }), none)).includes("unknown_activity"));
});

// ─── ReaderInput observer safety: synthetic ──────────────────────────────────────────────────────────
test("ReaderInput (synthetic): no ids, no optional-fact values, no plan fact makes anything salient, options never expose ids", () => {
  const discourse = { last_turn: { kind: "player_exchange", player_text: "Malcolm, how are you?", responses: [{ speaker_id: MALCOLM, text: "Doing fine, thanks.", facts: { required: [{ key: "self_state", value: "fine" }, { key: "roster", value: { people: [{ name: "Outpost A liaison", place: "Outpost A" }] } }], optional: [{ key: "held_equipment", value: ["Portable mass spectrometer"] }, { key: "agenda_mention", value: "OPTIONAL-ONLY-MARKER Outpost A" }] } }] } };
  const { input, bindings } = inputFor("what's that?", { discourse });
  const json = JSON.stringify(input);
  const ids = [...Object.values(bindings.people), ...Object.values(bindings.requests), ...Object.values(bindings.referents), ...Object.values(bindings.names), ...sc.entities.map((e) => e.id)].filter((x) => typeof x === "string" && x.length > 6 && !["complex", "threshold", "standard"].includes(x));
  for (const id of ids) assert.ok(!json.includes(id), `canonical id leaked: ${id}`);
  assert.ok(!json.includes("OPTIONAL-ONLY-MARKER"), "an optional fact's value never reaches the reader");
  const outpost = input.referent_candidates.find((r) => /Outpost A/.test(r.name))?.label ?? null;
  assert.ok(!input.conversation.salient_entities.includes(outpost), "neither an optional fact nor a nested structured required value makes an entity salient");
  // Reader Phase 2 (owner decision B7): canonical salience is the player's words and canonical interaction state only.
  assert.equal(input.conversation.salience_source, "player_words+canonical_state");
  for (const key of ["personhood", "async_tenure", "complex_experience", "self_state", "knowledge", "profile", "private", "system", "prompt", "schema", "instructions", "facts"]) assert.ok(!new RegExp(`"${key}"`).test(json), `unexpected key ${key}`);
  assert.deepEqual(Object.keys(input).sort(), ["chip_target", "conversation", "features", "heard", "line", "people", "referent_candidates", "version"]);
  assert.equal(input.heard.presentation_dependent, true);
  assert.ok(!JSON.stringify(input.conversation).includes("Doing fine"), "wording never enters the canonical conversation section");
  assert.deepEqual(input.conversation.requests.find((r) => r.facet === "person.wellbeing").answered_by, ["p1"]);
  // Options: a canonical id string -> the entity's name; an object -> its label only; an unknown id-like string -> nothing.
  const inbound = { event_id: "ev-q", from: GISELLE, kind: "question", answer_shape: "choice", options: ["item-b2b47214d72b45d159", { id: "q4-field-light-01", label: "the lamp" }, "q4-secret-thing-01"] };
  const opt = inputFor("the lamp", { inbound }).input;
  assert.deepEqual(opt.conversation.inbound.options.map((o) => o.text), ["35mm field camera", "the lamp", null]);
  assert.ok(!/item-b2b47214d72b45d159|q4-field-light-01|q4-secret-thing-01/.test(JSON.stringify(opt)), "option ids are mapped to opaque labels before the ReaderInput");
});

test("ReaderInput features are code facts (spans, token classes, possessives), never decisions", () => {
  const { input } = inputFor("malcolm ru tired");
  const n = input.features.name_spans[0];
  assert.deepEqual({ person: n.person, position: n.position, delimited: n.delimited, capitalized: n.capitalized, standalone: n.standalone }, { person: "p2", position: "initial", delimited: false, capitalized: false, standalone: false });
  assert.ok(!("role" in n) && !("vocative" in n), "the name's role is the reader's to decide");
  assert.equal(input.features.punctuation.terminal, "none");
  const wh = inputFor("Tonya, where did you put it?").input;
  assert.deepEqual(wh.features.wh.map((w) => w.word), ["where"]);
  assert.ok(wh.features.second_person.length === 1 && wh.features.deictics.some((d) => d.word === "it"));
  const poss = inputFor("giselle is it tonyas first day").input;
  assert.deepEqual(poss.features.name_spans.map((s) => [s.person, Boolean(s.possessive)]), [["p1", false], ["p3", true]]);
  assert.ok(!inputFor("tell me about the duffle").input.features.name_spans.length, "function words inside canonical names are never name spans");
});

// ─── ReaderInput observer safety: REAL service-built state ───────────────────────────────────────────
test("ReaderInput from REAL service state: no ids, no unspoken optional facts, no private state; hidden entities and absent people handled", async () => {
  const s = C.openScenario({ seed: "rp05-real-safety", provider: C.providerFor({}, "garbage") });
  try {
    const optionalSeen = [];
    const lines = ["Hello everyone!", "Tonya, tell me about yourself", "Malcolm, your turn", "How are you doing this morning Giselle?", "Who has the camera?", "Maxwell, are you there?", "what's that for?"];
    let prev = null;
    for (const [i, text] of lines.entries()) {
      const id = `rs-${i}`;
      await s.say(text, { request_id: id });
      const record = s.service.readerReceipts.get(id);
      assert.ok(record?.input, `seam input for ${text}`);
      const json = JSON.stringify(record.input);
      const members = s.run.expedition.team.members;
      for (const m of members) assert.ok(!json.includes(m.personnel_id), `canonical person id leaked (${text})`);
      for (const r of s.run.expedition.dialogue_state.requests) assert.ok(!json.includes(r.request_id), "request id leaked");
      for (const key of ["personhood", "async_tenure", "complex_experience", "first_day_at_async", "self_state", "knowledge"]) assert.ok(!json.includes(`"${key}"`), `private key ${key}`);
      // Optional facts the PREVIOUS turn's replies were authorized with (but may not have said) never reach the reader,
      // except as words actually heard.
      if (prev) {
        const heard = JSON.stringify(record.input.heard).toLowerCase();
        for (const value of prev) if (!heard.includes(value.toLowerCase())) assert.ok(!JSON.stringify({ ...record.input, heard: null }).toLowerCase().includes(value.toLowerCase()), `unspoken optional fact reached the reader: ${value}`);
      }
      const receipt = s.run.expedition.communication_receipts.find((r) => r.id === id);
      prev = (receipt?.response_contexts ?? []).flatMap((c) => (c.response_plan?.optional_facts ?? []).flatMap((f) => (typeof f.value === "string" ? [f.value] : Array.isArray(f.value) ? f.value.filter((v) => typeof v === "string") : []))).filter((v) => v.length > 3);
      optionalSeen.push(...prev);
      // Hidden: an entity the player neither knows nor mentioned is never a candidate.
      assert.ok(!record.input.referent_candidates.some((r) => /spectrometer|Threshold Approach|Lower-Level/.test(r.name)), "hidden entities stay hidden");
      if (/Maxwell/.test(text)) {
        const span = record.input.features.name_spans.find((n) => n.text === "Maxwell");
        assert.equal(span.non_present_person, true);
        assert.equal(span.person, null, "an absent person is never a present label");
      }
    }
    assert.ok(optionalSeen.length > 0, "the real run produced optional facts, so the leak check is not vacuous");
  } finally { s.close(); }
});

test("ReaderInput from REAL state: surface anchors (count, shape, words) differ by wording; the canonical section does not; multiple heard sentences each become an anchor", async () => {
  // Real service-built canonical state; the SAME turn heard in two wordings (what two wording providers produce),
  // cut into anchors by the ledger's own anchorSpans.
  const S = require("../tools/dialogue-state");
  const s = C.openScenario({ seed: "rp05-anchors", provider: C.providerFor({}, "garbage") });
  try {
    await s.say("Malcolm, what's in the duffle?", { request_id: "a-1" });
    const run = s.run;
    const present = s.coworkers().map((m) => ({ id: m.personnel_id, name: m.first_name, names: [m.first_name] }));
    const snapshot = S.snapshot(run, { player_id: s.playerId, location_id: run.spatial?.player_location ?? null, present_ids: present.map((p) => p.id) });
    const discourse = require("../tools/dialogue-discourse").deriveDiscourseState({ interaction_history: run.expedition.interaction_history, dialogue_history: run.expedition.dialogue_history, player_id: s.playerId, location_id: run.spatial?.player_location ?? null, current_interval: run.expedition.clock?.interval ?? null, equipment: run.expedition.equipment, receipts: run.expedition.communication_receipts, people: present.map((p) => ({ name: p.name, id: p.id })), entities: require("../tools/canonical-knowledge").entityIndex(run) });
    const entities = require("../tools/canonical-knowledge").entityIndex(run);
    const anchor = snapshot.surface_anchors[0];
    const worded = (text) => {
      const spans = S.anchorSpans(text, [{ request_id: anchor.spans[0].request_id, predicate: anchor.spans[0].predicate }]);
      const snap = { ...snapshot, surface_anchors: [{ ...anchor, spans }] };
      const disc = { ...discourse, last_turn: { ...discourse.last_turn, responses: discourse.last_turn.responses.map((r) => ({ ...r, text })) } };
      return buildReaderInput({ raw: "sealed?", present, player: { id: s.playerId, names: ["jack"] }, entities, snapshot: snap, ledger: run.expedition.dialogue_state, discourse: disc }).input;
    };
    const a = worded("Couldn't tell you what's in it.");
    const b = worded("No idea what's in them. Nobody's told me.");
    assert.deepEqual(a.conversation, b.conversation, "the canonical conversation section is wording-independent");
    assert.notDeepEqual(a.heard, b.heard, "heard wording is provider-dependent (and marked so)");
    assert.equal(a.heard.anchor_count, 1);
    assert.equal(b.heard.anchor_count, 2, "two spoken sentences -> two anchors");
    assert.deepEqual(b.heard.anchors.map((x) => x.text), ["No idea what's in them.", "Nobody's told me."]);
    assert.ok(b.heard.anchors.every((x) => x.request === b.heard.anchors[0].request && x.speaker === "p2"), "each anchor still maps to the request it answered");
  } finally { s.close(); }
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
  const weOut = frameFromLegacy(dialogueTurn.analyzeTurn({ raw: "we all going in together?", present: sc.present, entities: sc.entities, dis: null }), we);
  assert.ok(weOut.conversion.notes.some((x) => x.class === "needs-owner-decision" && x.code === "collective_subject_routed_as_group_address"));
  assert.equal(weOut.frame.acts[0].address.op, "NONE", "ReaderFrame is not widened to encode the legacy convention");
  assert.equal(weOut.frame.acts[0].subject.kind, "group_inclusive");
});

// ─── seam, oracle, resolver ──────────────────────────────────────────────────────────────────────────
test("Reader seam: production records a legacy-v0 receipt per LOCAL turn; resolveTurn is an identity passthrough; the trace hides code-side context; nothing is persisted", async () => {
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
    assert.equal(record.legacy.primary_used.facet_source, "item_role", "the value-level legacy record keeps facet_source");
    const trace = state.service.getDialogueTurnTrace({ world_id: state.worldId, request_id: t.id });
    assert.equal(trace.trace.reader.receipt.request_id, t.id, "developer trace carries the receipt");
    assert.ok(!("context" in trace.trace.reader), "bindings / canonical ids never reach the developer trace view");
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    const saved = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else saved.push(fs.readFileSync(p, "utf8")); } };
    walk(state.root);
    assert.ok(!saved.some((x) => x.includes("yellow-beast-reader-receipt") || x.includes("yellow-beast-reader-input")), "reader records are never written into the save");
  } finally { H.cleanup(state); }
  assert.throws(() => resolveTurn(null, null, []), (e) => e.code === "RESOLVER_INPUT_MISSING");
  assert.ok(Object.keys(RESOLVER_OWNERSHIP).includes("responder_priority"));
});

test("Resolver spec (frame-driven, measurement only): address ops, answers, activity rounds, anchors and chip resolve from the ReaderFrame + DIS, reading no words", () => {
  const people = sc.present;
  const run = (raw, frameActs, { snapshot = {}, chip = null } = {}) => {
    const { ledger, snapshot: base } = ledgerFixture();
    const snap = { ...base, ...snapshot };
    const built = buildReaderInput({ raw, chip_target_id: chip, present: people, player: PLAYER, entities: sc.entities, snapshot: snap, ledger });
    const frame = frameOf(...frameActs(built.input));
    return resolveTurn(frame, { snapshot: snap, ledger }, people, { verdict: RF.validateReaderFrame(frame, built.input), input: built.input, bindings: built.bindings }).primary;
  };
  const r1 = run("everyone but Tonya, how are you?", (i) => [act(i, { facet: "person.wellbeing", address: op("EXCEPT", [i.features.name_spans[0].label]) })]);
  assert.deepEqual([...r1.addressee.ids].sort(), [GISELLE, MALCOLM].sort());
  assert.equal(r1.cardinality, "each_self");
  const r2 = run("how are you?", (i) => [act(i, { facet: "person.wellbeing", address: op("SECOND_PERSON") })], { chip: MALCOLM });
  assert.deepEqual(r2.addressee, { kind: "explicit", ids: [MALCOLM], quantifier: null, source: "chip" }, "the chip wins");
  const r3 = run("the rest of you?", (i) => [act(i, { facet: "person.wellbeing", address: op("OTHERS", [], { relative_to: "q3" }), relation: { kind: "continuation", target: "q3" } })]);
  assert.deepEqual(r3.addressee.ids, [MALCOLM], "OTHERS: not those who answered, not the last speaker");
  const inbound = { event_id: "ev-q", from: GISELLE, kind: "question", answer_shape: "yes_no", options: [] };
  const r4 = run("yeah", (i) => [act(i, { speech_act: "answer", question_form: "none", facet: "NOT_APPLICABLE", relation: { kind: "answer", target: "i1" }, inbound_answer: { kind: "answer", option: "YES" } })], { snapshot: { pending_inbound_request: inbound } });
  assert.deepEqual([r4.speech_act, r4.addressee.source, r4.addressee.ids[0], r4.args.answer_option, r4.cardinality], ["answer", "open_question_answer", GISELLE, "yes", "none"]);
  const activity = { activity_id: "act-1", kind: "SELF_INTRODUCTION_ROUND", template: { predicate: "person.self_description", request_text: "Tell me about yourself." }, completed: [GISELLE, MALCOLM], eligible: [GISELLE, MALCOLM, TONYA] };
  const r5 = run("your turn", (i) => [act(i, { speech_act: "elliptical_continuation", question_form: "none", facet: "NONE_ASKING", address: op("SECOND_PERSON"), relation: { kind: "continuation", target: "v1" } })], { snapshot: { activity } });
  assert.deepEqual([r5.addressee.source, r5.addressee.ids[0], r5.predicate], ["activity_remaining", TONYA, "person.self_description"]);
  const anchors = [{ speaker_id: TONYA, event_id: "ev-1", spans: [{ text: "Nobody's told me what's in it.", request_id: "req-2", predicate: "item.contents" }] }];
  const r6 = run("why?", (i) => [act(i, { facet: "conversation.explanation", relation: { kind: "continuation", target: i.heard.anchors[0].label } })], { snapshot: { surface_anchors: anchors } });
  assert.deepEqual([r6.addressee.source, r6.addressee.ids[0], r6.relation_target], ["surface_anchor", TONYA, null], "a question about what was SAID links to the line, not its request");
  const r7 = run("why?", (i) => [act(i, { facet: "conversation.explanation", relation: { kind: "continuation", target: null }, abstain: ["relation"] })]);
  assert.equal(r7.clarify.slot, "topic", "an abstention fails closed to a clarification");
});

test("Reader seam: an injected scripted oracle is read and validated, legacy v0 still recorded, and the turn's behaviour is identical", async () => {
  const play = async (dialogueReader) => {
    const s = C.openScenario({ seed: "rp0-oracle", provider: C.providerFor({}, "garbage"), serviceOptions: dialogueReader ? { dialogueReader } : {} });
    try {
      for (const [i, line] of ["Hello everyone!", "how are you all?", "the rest of you?"].entries()) await s.say(line, { request_id: `o-${i + 1}` });
      return { digest: H.semanticDigest(s.run), receipts: [1, 2, 3].map((i) => s.service.readerReceipts.get(`o-${i}`)) };
    } finally { s.close(); }
  };
  const oracle = reader.createOracleReader({ "o-2": (input) => frameOf(act(input, { facet: "person.wellbeing", address: op("ALL"), respondent_mode: "all", subject: { kind: "addressee", names: [] } })) });
  const legacy = await play(null);
  const withOracle = await play(oracle);
  assert.equal(withOracle.digest.digest, legacy.digest.digest, "the reader choice never changes behaviour");
  assert.equal(withOracle.digest.truth, legacy.digest.truth);
  assert.equal(withOracle.receipts[1].receipt.reader.id, "oracle");
  assert.equal(withOracle.receipts[1].receipt.verdict.disposition, "accept", JSON.stringify(withOracle.receipts[1].receipt.verdict));
  assert.equal(withOracle.receipts[1].legacy_v0.reader.id, "legacy-v0");
  assert.equal(withOracle.receipts[0].receipt.frame, null, "an oracle with no script for a turn reads nothing (no guess)");
  assert.equal(oracle.seen.length, 3);
});

// ─── seam inertness ──────────────────────────────────────────────────────────────────────────────────
const INERT_LINES = ["Hello everyone!", "Tonya, tell me about yourself", "Malcolm, your turn", "How are you doing this morning Giselle?", "Who has the camera?", "Why?"];
async function digestWith(serviceOptions = {}, { provider = "garbage", reloadAt = null } = {}) {
  const s = C.openScenario({ seed: "rp05-inert", provider: C.providerFor({}, provider), offline: provider === "fallback", serviceOptions });
  const out = { traces: [] };
  try {
    for (const [i, line] of INERT_LINES.entries()) {
      if (reloadAt === i) s.reload();
      await s.say(line, { request_id: `in-${i}` });
      out.traces.push(s.service.getDialogueTurnTrace({ world_id: s.worldId, request_id: `in-${i}` }));
    }
    out.digest = H.semanticDigest(s.run);
    out.size = s.service.readerReceipts.size();
    out.first = s.service.readerReceipts.get("in-0");
    out.last = s.service.readerReceipts.get(`in-${INERT_LINES.length - 1}`);
    out.files = (() => { const all = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else all.push(fs.readFileSync(p, "utf8")); } }; walk(s.root); return all; })();
  } finally { s.close(); }
  return out;
}

test("Seam inertness: a throwing / malformed reader, a throwing ReaderInput builder, receipt overflow and developer mode off never change canonical state or dialogue", async () => {
  const baseline = await digestWith();
  const throwing = { id: "boom", kind: "model", version: "t", read() { throw new Error("reader exploded"); } };
  const malformed = [
    { id: "m1", kind: "model", version: "t", read: () => ({ frame: "not a frame" }) },
    { id: "m2", kind: "model", version: "t", read: () => ({ frame: { version: RF.READER_FRAME_VERSION, acts: [{}] } }) },
    { id: "m3", kind: "model", version: "t", read: () => undefined }
  ];
  const cases = {
    throwing_reader: await digestWith({ dialogueReader: throwing }),
    throwing_input_builder: await digestWith({ readerInputBuilder: () => { throw new Error("builder exploded"); } }),
    receipt_overflow: await digestWith({ readerReceiptLimit: 2 }),
    developer_mode_off: await digestWith({ developerMode: false }),
    ...Object.fromEntries(await Promise.all(malformed.map(async (r) => [`malformed_${r.id}`, await digestWith({ dialogueReader: r })])))
  };
  for (const [name, run] of Object.entries(cases)) {
    assert.equal(run.digest.digest, baseline.digest.digest, `${name}: dialogue behaviour changed`);
    assert.equal(run.digest.truth, baseline.digest.truth, `${name}: canonical state changed`);
  }
  assert.ok(cases.throwing_reader.last.receipt.error.includes("reader exploded"), "a reader failure is recorded, not raised");
  assert.equal(cases.throwing_input_builder.size, 0, "no input -> no reading, and the turn is untouched");
  assert.equal(cases.malformed_m1.last.receipt.verdict.disposition, "reject");
  assert.equal(cases.malformed_m2.last.receipt.verdict.disposition, "reject");
  assert.equal(cases.malformed_m3.last.receipt.frame, null);
  assert.equal(cases.receipt_overflow.size, 2, "the receipt store is bounded");
  assert.equal(cases.receipt_overflow.first, null, "the oldest receipt is evicted");
  assert.ok(cases.developer_mode_off.traces.every((t) => t.ok === false && t.error?.code === "DEVELOPER_DISABLED"), "the trace is developer-only");
});

test("Seam inertness: save / cold reload and provider variation -- receipts are never persisted and behaviour is identical", async () => {
  const straight = await digestWith();
  const reloaded = await digestWith({}, { reloadAt: 3 });
  assert.equal(reloaded.digest.digest, straight.digest.digest, "a cold reload mid-conversation continues exactly as the uninterrupted run");
  assert.ok(!reloaded.files.some((x) => /yellow-beast-reader-(?:receipt|input|frame)/.test(x)), "no reader record in any saved file");
  assert.equal(reloaded.size, 3, "receipts are in-memory only: the new service holds only its own turns");
  const throwing = { id: "boom", kind: "model", version: "t", read() { throw new Error("x"); } };
  const fallback = await digestWith({ dialogueReader: throwing }, { provider: "fallback" });
  const garbage = await digestWith({ dialogueReader: throwing }, { provider: "garbage" });
  assert.equal(fallback.digest.truth, garbage.digest.truth, "world truth never depends on the wording provider");
  if (!fallback.digest.anchored_turns.length && !garbage.digest.anchored_turns.length) assert.equal(fallback.digest.digest, garbage.digest.digest, "J16 provider independence holds with the seam failing");
});

// ─── gold-DIS evaluator (mechanics; the fixture is a harness self-test, not a corpus) ──────────────────
test("Gold-DIS evaluator: canonical prefixes with checkpoints, incomplete items refused, resolver-on-gold-frame spec at 100%, end-to-end behaviour from production", async () => {
  const G = require("../tools/dialogue-gold-eval");
  const items = G.readJsonl(path.join(__dirname, "fixtures/reader-phase0/gold-harness-selftest.jsonl"));
  const { summary, results } = await G.evaluateGold(items);
  assert.deepEqual(summary.prefix_invalid, ["s4"], "a prefix that does not build its stated canonical state is never scored");
  assert.deepEqual(summary.incomplete_state_verification.map((x) => x.id), ["s8"], "a gold frame resting on unverified state is refused");
  assert.equal(summary.scored, 7);
  assert.deepEqual(summary.gold_frames_rejected_by_validators, [], "every gold frame passes V0-V3 against its own ReaderInput");
  assert.equal(summary.resolver_spec.n, 7);
  assert.equal(summary.resolver_spec.pct, 100, JSON.stringify(summary.resolver_spec.failures));
  assert.equal(summary.behaviour.pct, 100, JSON.stringify(summary.behaviour.failures));
  assert.deepEqual(results.find((r) => r.id === "s6").behaviour.got.answered_to, ["Giselle"], "inbound routing: the answer goes to the asker");
  assert.deepEqual(results.find((r) => r.id === "s7").resolver.got.addressees, ["Tonya"], "the activity round's one remaining person");
});

// ─── pinned authorities ──────────────────────────────────────────────────────────────────────────────
test("Characterization authority is pinned; the scenario sessions replay identically; the round trip on them matches its pinned artifact", async () => {
  const charFile = path.join(ARTIFACTS, "characterization.json");
  const rtFile = path.join(ARTIFACTS, "roundtrip.json");
  assert.equal(sha256(charFile), CHARACTERIZATION_SHA256, "the characterization artifact changed without a governance pin update");
  assert.equal(sha256(rtFile), ROUNDTRIP_SHA256, "the round-trip artifact changed without a governance pin update");
  const snapshot = JSON.parse(fs.readFileSync(charFile, "utf8"));
  const roundtrip = JSON.parse(fs.readFileSync(rtFile, "utf8"));
  const census = snapshot.census;
  for (const source of ["answer_owner", "activity_remaining", "person_set_continuation", "open_question_answer", "surface_anchor", "pending_request", "answer_repair", "repair_asker", "antecedent_owner", "inbound_asker", "chip"]) assert.ok(census.addressee_source.includes(source), `characterization exercises addressee.source ${source}`);
  for (const source of ["tier1_registry", "item_role", "discourse_followup", "surface_anchor", "tier2_advisory", "inbound_counter", "inherited_request", "inherited_activity", "legacy_frame"]) assert.ok(census.facet_source.includes(source), `characterization exercises facet_source ${source}`);
  for (const act of ["answer"]) assert.ok(census.speech_act.includes(act));
  assert.ok(census.relation.includes("answer") && census.reloads >= 3 && census.chip_turns >= 4 && census.coworker_questions >= 9 && census.reopen_acts > 0);
  assert.ok(census.tier2.includes("accepted:complete"), "accepted Tier-2 behaviour is characterized");
  for (const state of ["OPEN->SATISFIED", "OPEN->ABANDONED", "SATISFIED->SUPERSEDED", "CLARIFYING"]) assert.ok(census.request_state.includes(state), `lifecycle ${state}`);
  const rows = new Map();
  for (const r of roundtrip.rows) { const key = r.fixture; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(r); }
  for (const spec of C.loadScenarios()) {
    const kind = spec.providers[0];
    const rt = [];
    const turns = await C.characterizeSession(spec, kind, { onTurn: (s, requestId, step) => { rt.push({ fixture: spec.id, kind: spec.kind, text: step.text, ...RT.roundTrip(s.service.readerReceipts.get(requestId)) }); } });
    assert.deepEqual(turns, snapshot.sessions.find((x) => x.id === spec.id).turns[kind], `${spec.id}: characterization drift`);
    assert.deepEqual(rt, rows.get(spec.id), `${spec.id}: round-trip drift`);
  }
});

test("The baseline failing-test set is a committed, pinned artifact that the comparison tool reads mechanically", () => {
  const file = path.join(ARTIFACTS, "baseline-failing-tests.json");
  assert.equal(sha256(file), BASELINE_FAILING_SHA256, "the baseline failing set changed without a governance pin update");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.count, doc.failing.length);
  const { failingNames, compare } = require("../tools/compare-failing-tests");
  const run = `✖ ${doc.failing[0].name} (1.2ms)\n✖ a brand new failure (3ms)\nnot ok 7 - ${doc.failing[1].name}\n`;
  assert.deepEqual(failingNames(run).sort(), [doc.failing[0].name, doc.failing[1].name, "a brand new failure"].sort());
  const result = compare(run, doc);
  assert.deepEqual(result.new_failures, ["a brand new failure"]);
  assert.equal(result.fixed.length, doc.count - 2);
});
