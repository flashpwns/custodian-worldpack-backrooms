"use strict";

// ED-30G — punctuation-independent utterance force, Tier-2 semantic completeness (decoded / schema-valid /
// semantically complete / accepted), general discourse follow-ups and repairs, and fail-closed advisory
// failure. Critical cases run through the production dialogue service.

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const A = require("../tools/dialogue-acts");
const T = require("../tools/dialogue-turn");
const ADV = require("../tools/dialogue-advisory-interpreter");

const PEOPLE = [{ id: "g", name: "Giselle", names: ["Giselle"] }, { id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
const act = (raw) => A.parseActs(raw, { people: PEOPLE }).acts.at(-1);

/** One LOCAL turn through the production canonical path with a GIVEN advisory result (as the advisory stage hands it over). */
async function withAdvice(state, text, advice) {
  const id = `g-${++state.counter}`;
  state.logs.length = 0;
  await state.service.submitQ4CommunicationCanonical({ world_id: state.worldId, channel: "local", text, request_id: id, interpretation_advice: advice });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const interaction = run.expedition.interaction_history.find((i) => i.submission_id === id) ?? null;
  const spoken = run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId);
  return { fn: contexts[0]?.semantic_frame?.discourse_function ?? null, predicate: contexts[0]?.semantic_frame?.predicate ?? null, owners: contexts.map((c) => c.target_worker_id), lines: spoken.map((e) => e.text), turn: interaction?.turn ?? null };
}
const reading = (facet, extra = {}) => ({ version: ADV.ADVISORY_V2_VERSION, accepted: true, confidence: "high", acts: [{ speech_act: "question", facet, addressee_id: null, referent_id: null, quantifier: "none", discourse_relation: "new", polarity: "positive", temporal_text: null, ...extra }], latency_ms: 10 });

// ─── 1. utterance force ──────────────────────────────────────────────────────────────────────────────────
test("force — questionhood does not depend on '?': wh, aux, alternative, aux-dropped, tag, late-wh, fragment", () => {
  const cases = [
    ["where do we go now", "wh"], ["have u been inside before", "yes_no"], ["we going in together or not", null],
    ["y'all holding up alright", null], ["the camera is mine, right", null], ["ok and this spectrometer thing, what does it do", "wh"],
    ["how long", "wh"], ["anybody know who took the lamp", null], ["so like whats the plan", "wh"], ["tonya is today ur first day", "yes_no"]
  ];
  for (const [raw, form] of cases) {
    const a = act(raw);
    assert.ok(["question", "request", "elliptical_continuation"].includes(a.speech_act), `${raw} -> ${a.speech_act}`);
    if (form) assert.equal(a.question_form, form, raw);
  }
});

test("force — a '?' alone does not make a question of a claim or a report; sarcasm stays sarcasm", () => {
  assert.equal(act("I think we're done?").force.confidence, "uncertain", "a claim with a '?' is uncertain: the bounded reading decides");
  assert.equal(act("Maxwell said \"why us?\"").speech_act, "statement", "a quoted question is a report");
  assert.equal(act("this seems totally safe?").speech_act, "sarcasm");
  assert.equal(act("The paint is beige").speech_act, "statement");
  // Uncertainty alone earns the bounded reading.
  const analysis = T.analyzeTurn({ raw: "I think we're done?", present: PEOPLE, entities: [], dis: null });
  assert.ok(T.completenessWithFrame(analysis, null, analysis.primary).missing.includes("force_uncertain"));
});

test("force — unpunctuated questions through the service: wh, yes/no and alternative are answered, never taken as remarks", async () => {
  const state = H.setup("ed30g-force", H.garbage());
  try {
    const wh = await H.turn(state, "where we headed");
    assert.equal(wh.predicate, "mission.destination");
    assert.equal(wh.lines.length, 1);
    const yn = await H.turn(state, "tonya u been in the complex before");
    assert.equal(yn.predicate, "person.complex_experience");
    assert.deepEqual(yn.ownerNames, ["Tonya"]);
    const alt = await H.turn(state, "we all going in together or what");
    assert.equal(alt.predicate, "transition.participants");
    assert.equal(alt.lines.length, 1);
    const remark = await H.turn(state, "this seems totally safe?");
    assert.deepEqual(remark.lines, [], "a sarcastic remark ending in '?' is still a remark: silence");
  } finally { H.cleanup(state); }
});

// ─── 3. general follow-ups and repairs (through the service) ─────────────────────────────────────────────
test("follow-ups — 'since when?', 'how long', 'before?' keep the answered facet and its speaker; 'how do you know?' asks the basis", async () => {
  const state = H.setup("ed30g-follow", H.garbage());
  try {
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    for (const f of ["since when", "how long?"]) {
      const r = await H.turn(state, f);
      assert.equal(r.predicate, "person.async_tenure", f);
      assert.deepEqual(r.ownerNames, ["Malcolm"], f);
      await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    }
    await H.turn(state, "Who has the camera?");
    const basis = await H.turn(state, "how do you know?");
    assert.equal(basis.owners.length, 1);
    assert.ok(["ask_explanation", "ask_predicate"].includes(basis.fn));
  } finally { H.cleanup(state); }
});

test("follow-ups — 'and you?' continues a round with the one person left; ambiguity is clarified, never guessed", async () => {
  const state = H.setup("ed30g-andyou", H.garbage());
  try {
    await H.turn(state, "Tonya, have you been in the Complex before?");
    await H.turn(state, "Giselle, how about you?");
    const last = await H.turn(state, "and you?");
    assert.ok(last.owners.length === 1, "one responder");
    const analysis = T.analyzeTurn({ raw: "and you", present: PEOPLE, entities: [], dis: { active_speaker: { speaker_id: "m", speaker_ids: ["m"] }, last_request: { request_id: "r", predicate: "person.async_tenure", request_text: "Malcolm, how long have you been here?", targets: ["m"], answered_by: ["m"] } } });
    assert.ok(analysis.primary.clarify, "two people could be 'you': no unique antecedent -> clarify");
  } finally { H.cleanup(state); }
});

test("repairs — target, facet and referent corrections re-ask the SAME request of the right person / thing", async () => {
  const state = H.setup("ed30g-repair", H.garbage());
  try {
    const first = await H.turn(state, "Where are we going?");
    const other = ["Giselle", "Malcolm", "Tonya"].find((n) => !first.ownerNames.includes(n));
    const target = await H.turn(state, `no, ${other}`);
    assert.deepEqual(target.ownerNames, [other], "no, <name>: the same question, to them");
    assert.equal(target.predicate, "mission.destination");
    const not = await H.turn(state, `not you, ${first.ownerNames[0]}`);
    assert.deepEqual(not.ownerNames, [first.ownerNames[0]]);
    await H.turn(state, "Why are we going to Outpost A?");
    const facet = await H.turn(state, "I meant where, not why");
    assert.equal(facet.predicate, "mission.destination", "facet correction");
    await H.turn(state, "Who has the camera?");
    const ref = await H.turn(state, "no the lamp");
    assert.equal(ref.fn, "ask_item_ownership", "referent correction keeps the question, changes the thing");
    assert.match(ref.lines.join(" "), /lamp/i);
    const other2 = await H.turn(state, "the other bag");
    assert.equal(other2.fn, "ambiguous_reference", "an 'other' thing is asked about, never guessed");
  } finally { H.cleanup(state); }
});

// ─── 2/4. Tier-2 semantic completeness and fail-closed failure (through the service) ─────────────────────
test("Tier 2 — only a SEMANTICALLY COMPLETE reading is accepted; incomplete / incompatible / failed readings clarify", async () => {
  const state = H.setup("ed30g-t2", null, { offline: true });
  try {
    const gaps = { tier1_missing: ["facet_unresolved"] };
    const good = await withAdvice(state, "so what's the gig today", { ...reading("mission.objective"), ...gaps });
    assert.equal(good.predicate, "mission.objective");
    assert.deepEqual(good.turn.advisory_state, { decoded: true, schema_valid: true, semantically_complete: true, accepted: true, reason: "complete" });
    const cases = [
      ["valid schema, missing facet", { ...reading(null), ...gaps }, "missing_facet"],
      ["incompatible facet (a 'where' question is not a route)", { ...reading("mission.route"), ...gaps }, "incompatible_facet:facet_wh_incompatible"],
      ["malformed", { accepted: false, reason: "malformed", latency_ms: 5, ...gaps }, "malformed"],
      ["timeout", { accepted: false, reason: "timeout", latency_ms: 8000, ...gaps }, "timeout"],
      ["low confidence", { accepted: false, reason: "low_confidence", latency_ms: 5, ...gaps }, "low_confidence"]
    ];
    for (const [name, advice, reason] of cases) {
      const text = name.startsWith("incompatible") ? "where r we supposed to be showing up" : "so what's the gig today";
      const r = await withAdvice(state, text, advice);
      assert.equal(r.turn.advisory_state.accepted, false, name);
      assert.equal(r.turn.advisory_state.reason, reason, name);
      assert.notEqual(r.predicate, "mission.route", `${name}: nothing incompatible fills the facet`);
      if (!r.predicate) assert.equal(r.fn, "ambiguous_reference", `${name}: not understood -> a bounded clarification, never a guess`);
    }
  } finally { H.cleanup(state); }
});

test("Tier 2 — timeout and low confidence are rejected at the source; the model may not invent ids or facets", async () => {
  const hanging = { interpretDialogue: () => new Promise(() => {}) };
  const t = await ADV.requestAdvisoryV2(hanging, { utterance: "x", facets: ["mission.objective"], timeout_ms: 30 });
  assert.equal(t.accepted, false);
  assert.equal(t.reason, "timeout");
  const low = ADV.validateAdvisoryV2({ acts: [{ speech_act: "question", facet: "mission.objective", addressee_candidate: null, referent_candidate: null, quantifier: "none", discourse_relation: "new" }], confidence: "low" }, "x", { facets: ["mission.objective"] });
  assert.equal(low.reason, "low_confidence");
  const invented = ADV.validateAdvisoryV2({ acts: [{ speech_act: "question", facet: "person.secret", addressee_candidate: "p9", referent_candidate: null, quantifier: "none", discourse_relation: "new" }], confidence: "high" }, "x", { facets: ["mission.objective"], people: [{ label: "p1", id: "g", name: "Giselle" }] });
  assert.equal(invented.accepted, false);
  // A reading that contradicts what Tier 1 is SURE of (a clear question read as a remark) is not complete.
  const analysis = T.analyzeTurn({ raw: "where are we going", present: PEOPLE, entities: [], dis: null });
  const state = T.assessAdvisory({ ...reading("mission.destination", { speech_act: "statement" }), tier1_missing: ["facet_unresolved"] }, analysis, {});
  assert.equal(state.reason, "contradictory_speech_act");
});

// ─── provider independence + cold reload ──────────────────────────────────────────────────────────────────
test("provider independence — different surface wording, identical world truth; follow-up inheritance survives a cold reload", async () => {
  const words = () => H.scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: "{}" } : "A few months, give or take."));
  const truths = [];
  for (const provider of [H.garbage(), words()]) {
    const state = H.setup("ed30g-indep", provider);
    try {
      for (const line of ["Malcolm, how long have you been with ASYNC?", "since when", "yall doin ok", "I think we're done?"]) await H.turn(state, line);
      truths.push(H.truthDigest(state.run));
    } finally { H.cleanup(state); }
  }
  assert.equal(truths[0], truths[1]);
  // Cold reload between the answer and the follow-up: the follow-up still inherits the answered facet.
  const state = H.setup("ed30g-reload", H.garbage());
  try {
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    state.service.shutdown?.();
    const { DesktopService } = require("../desktop/service");
    const service2 = new DesktopService({ appDataPath: state.root, defaultQ4Scenario: "day1-opener", localDialogueProvider: H.garbage(), developerMode: true });
    service2.log = (line) => state.logs.push(String(line));
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    state.service = service2;
    Object.defineProperty(state, "run", { get: () => service2.session(state.worldId, "field-researcher").run, configurable: true });
    const r = await H.turn(state, "since when");
    assert.equal(r.predicate, "person.async_tenure");
    assert.deepEqual(r.ownerNames, ["Malcolm"]);
  } finally { H.cleanup(state); }
});
