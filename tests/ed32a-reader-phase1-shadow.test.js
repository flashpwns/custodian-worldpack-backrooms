"use strict";

// Reader Phase 1 -- SHADOW-ONLY resolver (no player-facing change):
//   dispositions (ACCEPT / CLARIFY / REJECT_FIELDS / INVALID) consumed by the pure resolveTurn; the table-driven
//   response policy; the pure frame assembly; the RAW-TEXT FENCE (static + runtime) over all three; fail-closed
//   clarification; the player's previous claim (c1) as reader state; opaque request_text and canonical request
//   identity; owner rulings 1-5 in the adapter / validator / resolver; the developer-gated service wiring; the
//   GOLD RESOLVER SPEC SUITE (100%); shadow INERTNESS on the scenario sessions incl. cold reload; and the PINNED
//   shadow-diff artifact (scenario replay; the full replay is tests/ed32b-reader-phase1-shadow-full.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RF = require("../tools/dialogue-reader-frame");
const { buildReaderInput } = require("../tools/dialogue-reader-input");
const { frameFromLegacy } = require("../tools/dialogue-reader-legacy");
const { resolveTurn } = require("../tools/dialogue-resolve-turn");
const policy = require("../tools/dialogue-response-policy");
const assembly = require("../tools/dialogue-frame-assembly");
const shadowRunner = require("../tools/dialogue-reader-shadow");
const reader = require("../tools/dialogue-reader");
const dialogueTurn = require("../tools/dialogue-turn");
const C = require("../tools/dialogue-characterize");
const SC = require("../tools/dialogue-shadow-compare");
const INERT = require("../tools/dialogue-shadow-inertness");
const G = require("../tools/dialogue-gold-eval");
const E = require("../tools/dialogue-eval");

const ROOT = path.join(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "docs", "acceptance", "reader-phase1");
// ── PINNED AUTHORITY (governance): the shadow-diff artifact; changing it without updating this pin fails this suite,
// and updating the pin changes this file's hash, which verification/verification-authority.json governs. ──
const SHADOW_DIFF_SHA256 = "838b17af783fe07e57c25b61508038480c2bfec51a3bf5a48573fbcff1540af5";

const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const frameOf = (...acts) => ({ version: RF.READER_FRAME_VERSION, acts });
const op = (o, names = [], extra = {}) => ({ op: o, names, relative_to: null, count: null, ...extra });
function act(input, overrides = {}) {
  return { span: [0, input.line.tokens.length - 1], speech_act: "question", question_form: "wh", facet: "item.contents", polarity: "positive", name_roles: [], address: op("NONE"), relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [], ...overrides };
}
function ledger() {
  const requests = [
    { request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: "q4-startup-materials-duffle-01" }, turns_since: 0 },
    { request_id: "req-3", predicate: "person.wellbeing", targets: [GISELLE, MALCOLM], state: "OPEN", slots: { [GISELLE]: { state: "SATISFIED", responder_id: GISELLE }, [MALCOLM]: { state: "OPEN" } }, turns_since: 3 }
  ];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-3", predicate: "person.wellbeing", request_text: "How are you all?", args: null }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: null, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
/** One shadow resolution of a hand-written frame against a small canonical state. */
function shadowOf(raw, acts, { chip = null, claim = null, snapshot: extra = {}, candidates = null, candidates_facet = null } = {}) {
  const { ledger: l, snapshot } = ledger();
  const snap = { ...snapshot, ...extra };
  const built = buildReaderInput({ raw, chip_target_id: chip, present: sc.present, player: PLAYER, entities: sc.entities, snapshot: snap, ledger: l, claim });
  const frame = frameOf(...acts(built.input));
  const verdict = RF.validateReaderFrame(frame, built.input);
  const out = resolveTurn(frame, { snapshot: snap, ledger: l }, sc.present, { verdict, input: built.input, bindings: built.bindings, opaque: { request_texts: shadowRunner.opaqueRequestTexts(frame, built.input) }, canonical: { candidates, candidates_facet } });
  return { out, built, frame, verdict };
}

// ─── contract ─────────────────────────────────────────────────────────────────────────────────────────
test("Dispositions: ACCEPT / CLARIFY / REJECT_FIELDS / INVALID map from the validator; resolveTurn requires the verdict; production stays a passthrough", () => {
  assert.equal(RF.dispositionOf(null), "INVALID");
  assert.equal(RF.dispositionOf({ disposition: "reject" }), "INVALID");
  assert.equal(RF.dispositionOf({ disposition: "reject_fields" }), "REJECT_FIELDS");
  assert.equal(RF.dispositionOf({ disposition: "clarify" }), "CLARIFY");
  assert.equal(RF.dispositionOf({ disposition: "accept" }), "ACCEPT");
  const { built, frame } = shadowOf("Tonya, what's in the duffle?", (i) => [act(i)]);
  assert.throws(() => resolveTurn(frame, null, [], { input: built.input, bindings: built.bindings }), (e) => e.code === "RESOLVER_INPUT_MISSING", "no verdict, no shadow resolution");
  const legacy = { analysis: { effective: [], primary: null } };
  assert.equal(resolveTurn(frame, null, [], { legacy }).analysis, legacy.analysis, "production passthrough keeps identity");
  const invalid = resolveTurn({ version: RF.READER_FRAME_VERSION, acts: [{ bogus: 1 }] }, null, sc.present, { verdict: RF.validateReaderFrame({ version: RF.READER_FRAME_VERSION, acts: [{ bogus: 1 }] }, built.input), input: built.input, bindings: built.bindings });
  assert.deepEqual([invalid.disposition, invalid.outcome, invalid.routing], ["INVALID", "invalid", null], "an INVALID frame is never resolved");
  assert.ok(Object.isFrozen(invalid) && Object.isFrozen(shadowOf("Tonya, what's in the duffle?", (i) => [act(i)]).out.primary), "shadow output is deeply frozen");
});

// ─── raw-text fence ───────────────────────────────────────────────────────────────────────────────────
const FENCED = ["tools/dialogue-resolve-turn.js", "tools/dialogue-response-policy.js", "tools/dialogue-frame-assembly.js"];
const uncommented = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|[^:"'`\\])\/\/.*$/, "$1")).join("\n");
// Code only: comments removed and string literals emptied (the ownership table NAMES legacy functions as data).
const code = (file) => uncommented(file).replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
test("RAW-TEXT FENCE (static): resolveTurn, the response policy and frame assembly read no player text and call no reader", () => {
  const forbidden = [
    [/\.raw\b|\.normalized\b|\.tokens\b|line\s*\.\s*raw/, "the raw / normalized line or its tokens"],
    [/\bheard\b(?!\s*it)/, "the heard (presentation-dependent) channel"],
    [/\bplayer_text\b|\butterance\b|\bmessage\b|\bbody_expanded\b|\.body\b|\.text\b/, "a text field"],
    [/new RegExp|RegExp\(|\.match\(|\.exec\(|\.search\(/, "a regular expression over text"],
    [/(?<!LABEL\.[a-z_]+)\.test\(/, "a regex test other than a label-shape check"],
    [/buildSemanticFrame|interpretUtterance|interpretDialogueUtterance|analyzeTurn|parseActs|resolveEntityMentions|detectPredicates|legacyRoute|resolveAddressCorrection|parseAddressees|inferLocalRecipientType|resolveRecipientScope|isFollowUp|echoOf|itemRole|placeOf|withSalience/, "a legacy reader / raw-text router"],
    [/request_text\s*[.[]/, "an operation on the opaque request_text"]
  ];
  // Negative controls: each rule catches the read it forbids.
  for (const bad of ["const w = input.line.raw;", "if (/why/.test(words)) x();", "e.request_text.toLowerCase()", "const f = dialogueDiscourse.buildSemanticFrame({ text });", "const t = act.body_expanded;", "input.heard.lines.map((l) => l)", "canonicalKnowledge.resolveEntityMentions(q, entities)"]) assert.ok(forbidden.some(([re]) => re.test(bad)), `the fence catches: ${bad}`);
  for (const good of ["if (target && RF.LABEL.request.test(target)) x();", "request_text: opaque?.request_texts?.[i] ?? null,"]) assert.ok(!forbidden.some(([re]) => re.test(good)), `the fence allows: ${good}`);
  for (const file of FENCED) {
    const src = code(file);
    for (const [re, what] of forbidden) {
      const hit = src.split("\n").find((l) => re.test(l));
      assert.ok(!hit, `${file} reads ${what}: ${hit?.trim()}`);
    }
    const requires = [...uncommented(file).matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const r of requires) assert.ok(["./dialogue-registry", "./dialogue-turn", "./dialogue-reader-frame", "./dialogue-response-policy", "./dialogue-discourse"].includes(r), `${file} requires ${r}`);
    for (const m of src.matchAll(/dialogueTurn\.(\w+)/g)) assert.equal(m[1], "cardinalityFor", `${file} uses dialogue-turn.${m[1]} (only the pure cardinality table is allowed)`);
    if (requires.includes("./dialogue-discourse")) assert.match(uncommented(file), /const \{ EXPECTED_SHAPES \} = require\("\.\/dialogue-discourse"\)/, `${file} may take only the static EXPECTED_SHAPES table from dialogue-discourse`);
  }
});

test("RAW-TEXT FENCE (runtime): with the line, its tokens, heard wording, name text and referent names made unreadable, the shadow resolves identically", () => {
  const cases = [
    ["Tonya, how is Malcolm doing?", (i) => [act(i, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }, { name: "n2", role: "mention" }], address: op("NAMED", ["n1"]), subject: { kind: "named", names: ["n2"] } })]],
    ["the rest of you?", (i) => [act(i, { speech_act: "elliptical_continuation", question_form: "none", facet: "NONE_ASKING", address: op("OTHERS", [], { relative_to: "q2" }), relation: { kind: "continuation", target: "q2" } })]],
    ["what's in it?", (i) => [act(i, { referent: { span: null, candidate: i.referent_candidates.find((r) => /duffle/i.test(r.name)).label } })], { snapshot: { last_request: { request_id: "req-2", predicate: "item.contents", request_text: "What's in the duffle?", args: { item_id: "q4-startup-materials-duffle-01" } } } }]
  ];
  const trap = (what) => new Proxy({}, { get: (_, key) => { if (key === Symbol.toPrimitive || key === "toJSON") return undefined; throw new Error(`shadow read ${what}.${String(key)}`); } });
  const opaque = { toString() { throw new Error("request_text inspected"); }, valueOf() { throw new Error("request_text inspected"); }, [Symbol.toPrimitive]() { throw new Error("request_text inspected"); } };
  for (const [raw, acts, options] of cases) {
    const { out, built, frame, verdict } = shadowOf(raw, acts, options ?? {});
    const input = { ...built.input, line: trap("line"), heard: trap("heard"), features: { ...built.input.features, name_spans: built.input.features.name_spans.map((n) => Object.defineProperty({ ...n }, "text", { get() { throw new Error("name text read"); } })), entity_spans: built.input.features.entity_spans.map((n) => Object.defineProperty({ ...n }, "text", { get() { throw new Error("entity text read"); } })) }, referent_candidates: built.input.referent_candidates.map((r) => Object.defineProperty({ ...r }, "name", { get() { throw new Error("referent name read"); } })) };
    const { ledger: l, snapshot } = ledger();
    const snap = { ...snapshot, ...(options?.snapshot ?? {}) };
    const fenced = resolveTurn(frame, { snapshot: snap, ledger: l }, sc.present, { verdict, input, bindings: built.bindings, opaque: { request_texts: frame.acts.map(() => opaque) } });
    const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "request_text" ? null : v)));
    assert.deepEqual(strip(fenced), strip(out), `${raw}: same resolution without any readable text`);
    assert.equal(fenced.primary.request_text, opaque, "request_text is carried by identity, never read");
    const frameOut = assembly.assembleFrame({ resolution: fenced, canonical: assembly.canonicalContext({ entities: sc.entities }) });
    assert.equal(frameOut.turn.request_text, opaque, "the assembled frame carries the opaque string untouched");
  }
});

// ─── response policy ──────────────────────────────────────────────────────────────────────────────────
test("Response policy (table-driven, pure): owner priority explicit > repair > antecedent > activity > knower > rotation; remarks may be silent; clarify gets one clarifier", () => {
  const present = [GISELLE, MALCOLM, TONYA];
  const ask = (extra = {}) => policy.decideResponse({ act: { speech_act: "question", facet: "mission.destination" }, address: { kind: "untargeted", ids: [] }, present, cardinality: "one_spokesperson", ...extra });
  const flags = { [GISELLE]: { last_spoke_seq: 5 }, [MALCOLM]: { last_spoke_seq: 1, has_relevant_knowledge: true }, [TONYA]: { last_spoke_seq: 9, knows_fully: true } };
  assert.deepEqual(ask({ address: { kind: "explicit", ids: [GISELLE], source: "vocative" }, candidates: flags }).responders, [GISELLE], "explicit target first");
  assert.deepEqual(ask({ owners: { repair_target: [MALCOLM], antecedent_owner: [TONYA] }, candidates: flags }).responders, [MALCOLM], "repair target over antecedent owner");
  assert.deepEqual(ask({ owners: { antecedent_owner: [GISELLE], activity_target: [MALCOLM] }, candidates: flags }).responders, [GISELLE], "antecedent owner over activity target");
  assert.deepEqual(ask({ owners: { activity_target: [MALCOLM] }, candidates: flags }).responders, [MALCOLM], "activity target over knowers");
  assert.deepEqual(ask({ candidates: flags }).responders, [TONYA], "a full knower over rotation");
  const rot = ask({ candidates: { [GISELLE]: { last_spoke_seq: 5 }, [MALCOLM]: { last_spoke_seq: 1 }, [TONYA]: { last_spoke_seq: 9 } } });
  assert.deepEqual([rot.responders, rot.owner_basis], [[MALCOLM], "fairness_rotation"], "rotation: least recently spoken");
  assert.deepEqual(ask({ candidates: null }).owner_basis, "fairness_rotation", "no flags: never an invented knower");
  const remark = policy.decideResponse({ act: { speech_act: "statement" }, address: { kind: "untargeted", ids: [] }, present });
  assert.deepEqual([remark.responders, remark.silence, remark.silence_valid, remark.response_required], [[], true, true, false], "owner decision #2: a remark to the room may be silent");
  const named = policy.decideResponse({ act: { speech_act: "statement" }, address: { kind: "explicit", ids: [TONYA], source: "vocative" }, present });
  assert.deepEqual(named.responders, [TONYA], "a remark addressed by name is answered by that person");
  const clarify = policy.decideResponse({ act: { speech_act: "question", outcome: "clarify" }, address: null, owners: { active_speaker: [MALCOLM] }, present, cardinality: "one_spokesperson" });
  assert.deepEqual([clarify.cardinality, clarify.responders], ["one_clarifier", [MALCOLM]], "a clarification: one clarifier (the one the player is talking with), never the default spokesperson");
  const each = policy.decideResponse({ act: { speech_act: "question" }, address: { kind: "group", ids: present, source: "quantifier" }, present, cardinality: "each_self" });
  assert.deepEqual(each.responders, present, "each_self to the group: everyone answers for themselves");
  const answer = policy.decideResponse({ act: { speech_act: "answer" }, address: { kind: "inherited", ids: [GISELLE] }, present });
  assert.deepEqual([answer.recipients, answer.responders, answer.cardinality], [[GISELLE], [], "none"], "an answer is put to the asker and requires no response");
  assert.ok(Object.keys(policy.RESPONSE_TABLE).every((row) => typeof policy.RESPONSE_TABLE[row].silence_valid === "boolean"));
});

// ─── resolver: fail closed, subject, relation, rulings ─────────────────────────────────────────────────
test("Fail closed: a rejected routing field, a validator clarification or an abstention clarifies -- no default spokesperson, no inherited predicate, no fabricated args", () => {
  const rejected = shadowOf("the rest of you?", (i) => [act(i, { speech_act: "elliptical_continuation", question_form: "none", facet: "NONE_ASKING", relation: { kind: "continuation", target: "q9" } })]).out;
  assert.equal(rejected.disposition, "REJECT_FIELDS");
  assert.deepEqual([rejected.outcome, rejected.primary.predicate, rejected.primary.args, rejected.routing.cardinality], ["clarify", null, {}, "one_clarifier"]);
  const abstained = shadowOf("and the lamp?", (i) => [act(i, { speech_act: "elliptical_continuation", question_form: "none", facet: "NONE_ASKING", relation: { kind: "continuation", target: "q2" }, abstain: ["referent"] })]).out;
  assert.equal(abstained.outcome, "clarify");
  assert.equal(abstained.primary.predicate, null, "the request's predicate is NOT inherited merely because one exists");
  assert.deepEqual(abstained.primary.args, {}, "the request's item is NOT carried into a clarification");
  assert.equal(abstained.routing.cardinality, "one_clarifier");
  const temporal = shadowOf("Tonya, what's in the duffle today?", (i) => [act(i, { temporal: "earlier" })]).out;
  assert.ok(temporal.reasons.some((r) => r.includes("neutralized:temporal")), "a rejected refinement (temporal) is neutralized and recorded");
  assert.equal(temporal.outcome, "resolved");
});

test("Subject (item 7): kind respected, names bound through the ReaderInput, mentions recorded, third parties never addressees, group_inclusive never a group address", () => {
  const third = shadowOf("Tonya, how is Malcolm doing?", (i) => [act(i, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }, { name: "n2", role: "mention" }], address: op("NAMED", ["n1"]), subject: { kind: "named", names: ["n2"] } })]).out.primary;
  assert.deepEqual([third.addressee.ids, third.args.third_party_subject, third.mentions, third.cardinality], [[TONYA], MALCOLM, [MALCOLM], "one_spokesperson"]);
  const own = shadowOf("Malcolm, how are you?", (i) => [act(i, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]), subject: { kind: "addressee", names: [] } })]).out.primary;
  assert.equal(own.args.third_party_subject, undefined);
  const group = shadowOf("are we all going together?", (i) => [act(i, { facet: "transition.participants", question_form: "yes_no", subject: { kind: "group_inclusive", names: [] } })]).out;
  assert.deepEqual([group.primary.subject.kind, group.primary.addressee.ids, group.routing.addressees.length], ["group_inclusive", [], 0], "owner ruling 1");
  const familiar = shadowOf("Tonya, do you know Malcolm?", (i) => [act(i, { facet: "person.familiarity", question_form: "yes_no", name_roles: [{ name: "n1", role: "vocative" }, { name: "n2", role: "mention" }], address: op("NAMED", ["n1"]), subject: { kind: "addressee", names: [] } })]).out.primary;
  assert.deepEqual([familiar.args.other_id, familiar.mentions], [MALCOLM, [MALCOLM]], "a mention is never dropped");
});

test("Owner ruling 4: a vocative contradicting the chip keeps the chip (production's rule) and the shadow records the conflict", () => {
  const { out, verdict } = shadowOf("Tonya, how are you?", (i) => [act(i, { facet: "person.wellbeing", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]) })], { chip: MALCOLM });
  assert.equal(verdict.disposition, "reject_fields");
  assert.deepEqual([out.outcome, out.primary.addressee.ids, out.routing.responders, out.conflicts], ["resolved", [MALCOLM], [MALCOLM], ["chip_vs_vocative"]]);
});

test("Owner ruling 5: a wh-led line read as sarcasm fails closed (CLARIFY), never silently a remark", () => {
  const { out } = shadowOf("what could possibly go wrong lol", (i) => [act(i, { speech_act: "sarcasm", question_form: "none", facet: "NOT_APPLICABLE" })]);
  assert.deepEqual([out.disposition, out.outcome, out.routing.silence, out.routing.responders.length], ["CLARIFY", "clarify", false, 1]);
});

test("Owner ruling 2: the adapter reads a marker-led continuation / topic return with no antecedent as NEW", () => {
  for (const raw of ["Anyway, where are we going?", "So where do we go next?"]) {
    const built = buildReaderInput({ raw, present: sc.present, player: PLAYER, entities: sc.entities, snapshot: { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] } }, ledger: { requests: [] } });
    const analysis = dialogueTurn.analyzeTurn({ raw, present: sc.present, entities: sc.entities, dis: { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: null } });
    const { frame, conversion } = frameFromLegacy(analysis, built);
    assert.equal(frame.acts.at(-1).relation.kind, "new", raw);
    if (analysis.primary.relation !== "new") assert.ok(conversion.notes.some((n) => n.code === "relation_without_antecedent"), `${raw}: the legacy quirk is recorded`);
  }
});

// ─── the player's previous claim (owner ruling 3) ─────────────────────────────────────────────────────
test("Player claim (owner ruling 3): c1 is reader state with canonical freshness; V1/V3 validate eligibility; the shadow inherits its facet", () => {
  const claim = { facet: "person.complex_experience", polarity: "positive", subject_ids: [PLAYER.id], request_id: "t-1" };
  const fresh = shadowRunner.claimState(claim, { interactions: [{ submission_id: "t-1", channel: "local" }], ledger: { requests: [] } });
  const stale = shadowRunner.claimState(claim, { interactions: [{ submission_id: "t-1", channel: "local" }, { submission_id: "t-2", channel: "local" }], ledger: { requests: [] } });
  const opened = shadowRunner.claimState(claim, { interactions: [{ submission_id: "t-1", channel: "local" }], ledger: { requests: [{ submission_id: "t-1" }] } });
  assert.deepEqual([fresh.state, stale.state, opened.state], ["fresh", "stale", "stale"]);
  const ask = (c) => shadowOf("Tonya, have you?", (i) => [act(i, { speech_act: "elliptical_continuation", question_form: "yes_no", facet: "NONE_ASKING", name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]), relation: { kind: "continuation", target: "c1" } })], { claim: c });
  const ok = ask(fresh);
  assert.deepEqual(ok.built.input.conversation.player_claim, { label: "c1", facet: "person.complex_experience", polarity: "positive", subject: ["player"], state: "fresh" });
  assert.ok(!JSON.stringify(ok.built.input).includes("t-1"), "no request id reaches the reader");
  assert.equal(ok.verdict.disposition, "accept");
  assert.deepEqual([ok.out.primary.predicate, ok.out.primary.facet_source, ok.out.routing.responders, ok.out.lifecycle.activity.intent], ["person.complex_experience", "player_claim", [TONYA], "start"]);
  const late = ask(stale);
  assert.ok(RF.validateReaderFrame(late.frame, late.built.input).layers.V3.errors.some((e) => e.code === "claim_antecedent_not_eligible"));
  assert.equal(late.out.outcome, "clarify", "a stale claim is not an antecedent: fail closed");
  const none = ask(null);
  assert.ok(none.verdict.layers.V1.errors.some((e) => e.code === "unknown_claim"), "no reader state, no c1");
  // The claim comes from a validated READING of the statement (reader state), never from legacy clause records.
  const receipt = { frame: frameOf({ ...act({ line: { tokens: [1, 2, 3] } }, { span: [0, 2], speech_act: "statement", question_form: "none", facet: "person.complex_experience", subject: { kind: "speaker", names: [] } }) }), verdict: { disposition: "accept", rejected_fields: [] } };
  assert.deepEqual(shadowRunner.claimFromReading(receipt, { names: {} }, { player_id: "p", request_id: "t-9" }), { facet: "person.complex_experience", polarity: "positive", subject_ids: ["p"], request_id: "t-9" });
  assert.equal(shadowRunner.claimFromReading({ ...receipt, verdict: { disposition: "reject", rejected_fields: [] } }, {}, {}), null);
});

// ─── request_text (item 6) ────────────────────────────────────────────────────────────────────────────
test("request_text is an opaque string cut from the validated act span; request identity (re-ask, repair, duplicate) is canonical, never textual", () => {
  const built = buildReaderInput({ raw: "Hi all. Tonya, what's in the duffle?", present: sc.present, player: PLAYER, entities: sc.entities, snapshot: null, ledger: { requests: [] } });
  const tokens = built.input.line.tokens;
  const split = tokens.findIndex((t) => t.text === "Tonya");
  const texts = shadowRunner.opaqueRequestTexts(frameOf(act(built.input, { span: [0, split - 1] }), act(built.input, { span: [split, tokens.length - 1] })), built.input);
  assert.deepEqual(texts, ["Hi all.", "Tonya, what's in the duffle?"]);
  // An unanswered re-ask in DIFFERENT words re-opens the same request (canonical identity: target + predicate).
  const reask = shadowOf("You still haven't said.", (i) => [act(i, { speech_act: "repair", question_form: "none", facet: "NONE_ASKING", relation: { kind: "repair", target: "q2" }, repair_kind: "unanswered" })]).out;
  assert.deepEqual([reask.lifecycle.request.intent, reask.lifecycle.request.target, reask.primary.predicate, reask.primary.request_text], ["reopen", "req-3", "person.wellbeing", "You still haven't said."]);
  // The same canonical question already answered by the chosen responder is a duplicate (not a new topic).
  const again = shadowOf("Tonya what is inside the duffle", (i) => [act(i, { name_roles: [{ name: "n1", role: "vocative" }], address: op("NAMED", ["n1"]), referent: { span: "e1", candidate: i.features.entity_spans[0].candidate } })]).out;
  assert.deepEqual([again.lifecycle.request.intent, again.lifecycle.duplicate_of], ["open", "req-2"]);
  // Deterministic staleness is computed without touching the ledger.
  assert.deepEqual(again.lifecycle.abandons, ["req-3"]);
});

// ─── service wiring ───────────────────────────────────────────────────────────────────────────────────
test("Service wiring: the shadow runs developer-gated after production decided, on frozen inputs; it is never consumed, never in the trace view, never persisted", async () => {
  const s = C.openScenario({ seed: "rp1-wiring", provider: C.providerFor({}, "garbage") });
  try {
    await s.say("Tonya, what's in the duffle?", { request_id: "w-1" });
    const record = s.service.readerReceipts.get("w-1");
    assert.ok(record.shadow && record.production_routing, "developer mode: shadow + production routing recorded");
    assert.equal(record.shadow.consumed, false);
    assert.ok(Object.isFrozen(record.shadow) && Object.isFrozen(record.shadow.resolution.primary));
    assert.deepEqual(record.production_routing.owner_ids, record.shadow.resolution.routing.responders);
    const trace = s.service.getDialogueTurnTrace({ world_id: s.worldId, request_id: "w-1" });
    assert.ok(!("shadow" in trace.trace.reader) && !("production_routing" in trace.trace.reader), "no UI / trace exposure");
    s.service.persistSession(s.service.getWorld(s.worldId), "field-researcher", s.service.session(s.worldId, "field-researcher"));
    const saved = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else saved.push(fs.readFileSync(p, "utf8")); } }; walk(s.root);
    assert.ok(!saved.some((x) => /yellow-beast-(?:reader-shadow|resolve-turn|response-policy|frame-assembly)/.test(x)), "nothing of the shadow is saved");
  } finally { s.close(); }
  const off = C.openScenario({ seed: "rp1-wiring", provider: C.providerFor({}, "garbage"), serviceOptions: { readerShadow: false } });
  try { await off.say("Tonya, what's in the duffle?", { request_id: "w-1" }); assert.equal(off.service.readerReceipts.get("w-1").shadow, undefined, "shadow off: nothing runs"); } finally { off.close(); }
  const boom = C.openScenario({ seed: "rp1-wiring", provider: C.providerFor({}, "garbage"), serviceOptions: { readerInputBuilder: (a) => { const b = require("../tools/dialogue-reader-input").buildReaderInput(a); return { ...b, bindings: new Proxy(b.bindings, { get: (t, k) => (k === "claims" ? (() => { throw new Error("shadow exploded"); })() : t[k]) }) }; } } });
  try {
    const r = await boom.say("Tonya, what's in the duffle?", { request_id: "w-1" });
    assert.equal(r.ok, true, "a throwing shadow never affects the turn");
    assert.equal(boom.service.readerReceipts.get("w-1").shadow, undefined, "the failed shadow left no record");
  } finally { boom.close(); }
});

// ─── gold resolver spec suite ─────────────────────────────────────────────────────────────────────────
test("GOLD RESOLVER SPEC SUITE: doctrine / owner-ruling gold on the real pre-turn DIS -- 100%", { timeout: 600000 }, async () => {
  const items = G.readJsonl(path.join(__dirname, "fixtures/reader-phase1/gold-resolver-spec.jsonl"));
  const { summary } = await G.evaluateGold(items);
  assert.equal(summary.items, 36);
  assert.deepEqual(summary.prefix_invalid, [], "every prefix builds its stated canonical state");
  assert.deepEqual(summary.incomplete_state_verification, [], "every gold frame rests on verified state");
  assert.equal(summary.shadow_spec.n, 36);
  assert.equal(summary.shadow_spec.pct, 100, JSON.stringify(summary.shadow_spec.failures, null, 1));
  const covered = new Set(items.map((i) => i.id.replace(/^r\d+[a-z]?-/, "")));
  for (const need of ["explicit-named-question", "untargeted-shared-question", "group-subject-no-address", "and-you", "who-else", "the-rest-of-you", "repair-target", "prior-player-claim", "activity-round-named", "inbound-yes-no", "inbound-choice", "inbound-person", "inbound-item", "inbound-uncertainty", "inbound-refusal", "counter-question", "echo-surface-anchor", "deixis-with-antecedent", "deixis-without-antecedent", "temporal-follow-up", "clarification-frame", "rejected-routing-field", "invalid-frame", "silence-valid-remark"]) assert.ok(covered.has(need), `gold suite covers ${need}`);
});

// ─── inertness (scenario sessions; the full set is ed32b) ─────────────────────────────────────────────
test("Shadow INERTNESS: shadow on vs off gives deep-equal canonical state and save payload, and after a cold reload, on every scenario session", { timeout: 1200000 }, async () => {
  const results = await INERT.run({ fixtures: C.loadScenarios() });
  const summary = INERT.summarize(results);
  assert.deepEqual(summary.differing, [], JSON.stringify(summary.differing, null, 1));
  assert.equal(summary.equal, summary.sessions);
  assert.ok(summary.with_mid_session_reloads >= 2, "sessions with mid-session cold reloads are exercised (3 reloads in 2 scenarios), plus a cold reload at the end of every session");
});

// ─── pinned shadow-diff artifact ──────────────────────────────────────────────────────────────────────
test("Shadow-diff artifact is pinned; every mismatch carries a known cause; the scenario sessions replay identically", { timeout: 1200000 }, async () => {
  const file = path.join(ARTIFACTS, "shadow-diff.json");
  assert.equal(sha256(file), SHADOW_DIFF_SHA256, "the shadow-diff artifact changed without a governance pin update");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.evaluated, 471);
  const causes = require("../tools/dialogue-shadow-causes").CAUSES;
  for (const r of doc.rows) for (const lv of Object.values(r.levels)) for (const d of lv.diffs) for (const reason of d.reasons) assert.ok(causes[reason], `${r.fixture} ${r.text}: ${lv} ${d.field} has no known cause (${reason})`);
  const scenarios = C.loadScenarios();
  const rows = await SC.run({ fixtures: scenarios });
  const pinned = doc.rows.filter((r) => scenarios.some((s) => s.id === r.fixture));
  assert.equal(rows.length, pinned.length);
  rows.forEach((row, i) => assert.deepEqual(row, pinned[i], `row ${i}: ${row.fixture} ${row.text}`));
});
