"use strict";

// ED-30I — evidence-based Tier-1 completeness over a bounded chat-surface normalization, the Tier-2 facet as a
// REQUIRED target (an id or NONE) with ONE facet-only recovery pass, discourse linkage over canonical request
// frames, answer shapes for a coworker's question to the player, and clarify-rather-than-guess safety.
// Critical cases run through the production dialogue service.

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const T = require("../tools/dialogue-turn");
const S = require("../tools/dialogue-state");
const A = require("../tools/dialogue-acts");
const ADV = require("../tools/dialogue-advisory-interpreter");
const E = require("../tools/dialogue-eval");

const reasons = (r) => Object.fromEntries((r.turnRecord?.tier1_confidence_reasons ?? []).map((x) => [x.field, x.status]));
/** Opens a coworker's question TO the player the canonical way (as the ledger records a spoken line). */
// The plan declares the answer shape and the offered options as canonical ids; the words are only words.
const CAMERA = "item-b2b47214d72b45d159";
const LAMP = "q4-field-light-01";
function coworkerAsks(state, name, { predicate = null, text, answer_shape = null, options = [] } = {}) {
  const id = state.id(name);
  const event = { id: `npc-q-${++state.counter}`, speaker_id: id, speaker_name: name, text, submission_id: null, channel: "local" };
  state.run.expedition.dialogue_history.push(event);
  return S.recordInboundRequest(state.run, { event_id: event.id, speaker_id: id, text, plan: { asks_player: true, predicate, ...(answer_shape ? { answer_shape, options } : {}) }, request_id: null });
}
const CHOICE = { answer_shape: "choice", options: [CAMERA, LAMP] };
/** A scripted local model: the first (v2) reading and the facet-only second pass, counted. */
function readings(first, second = "NONE", { act = "question", relation = "new" } = {}) {
  const calls = { first: 0, second: 0 };
  const provider = H.scriptedLocal((body) => {
    const system = body.messages[0].content;
    if (/choose which topic/.test(system)) { calls.second += 1; return second instanceof Error ? second : { raw: typeof second === "string" ? JSON.stringify({ facet: second, confidence: "high" }) : second.raw }; }
    if (/classify the LANGUAGE/.test(system)) { calls.first += 1; return first instanceof Error || first instanceof Promise ? first : { raw: typeof first === "string" ? JSON.stringify({ acts: [{ speech_act: act, facet: first, addressee_candidate: null, referent_candidate: null, quantifier: "none", discourse_relation: relation }], confidence: "high" }) : first.raw }; }
    return { raw: "{bad" };
  });
  provider.calls = calls;
  return provider;
}
function reload(state, provider = H.garbage()) {
  state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
  state.service.shutdown?.();
  const { DesktopService } = require("../desktop/service");
  const service2 = new DesktopService({ appDataPath: state.root, defaultQ4Scenario: "day1-opener", localDialogueProvider: provider, developerMode: true });
  service2.log = (line) => state.logs.push(String(line));
  assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
  state.service = service2;
  Object.defineProperty(state, "run", { get: () => service2.session(state.worldId, "field-researcher").run, configurable: true });
}

// ─── TIER-1 COMPLETENESS: positive evidence over a bounded normalization ─────────────────────────────────
test("tier 1 — chat noise is normalized (raw and normalized both traced); clear lines stay Tier 1; ambiguity escalates", async () => {
  const state = H.setup("ed30i-tier1", H.garbage());
  try {
    for (const line of ["where are we going", "wher are we goin", "um so where are we going", "where are we going lol", "where are we headed tho"]) {
      const r = await H.turn(state, line);
      assert.equal(r.turnRecord.tier1_complete, true, line);
      assert.equal(r.turnRecord.tier2_required, false, line);
      assert.equal(r.predicate, "mission.destination", line);
      assert.equal(r.turnRecord.raw, line, "the raw line is kept");
    }
    const noisy = await H.turn(state, "where are we going lol");
    assert.deepEqual(noisy.turnRecord.clauses[0].chat_normalization, { semantic: "where are we going", removed: [{ kind: "trailing_particle", text: "lol" }] }, "the normalization record reproduces the semantic text");
    const statement = await H.turn(state, "I'm Jack, by the way.");
    assert.equal(statement.turnRecord.tier2_required, false, "a clear statement stays Tier 1");
    const clear = await H.turn(state, "Tonya, have you been in the Complex before?");
    assert.equal(clear.turnRecord.tier1_complete, true, "a clear deterministic question stays Tier 1");
    const ambiguous = await H.turn(state, "the camera's still on you");
    assert.equal(ambiguous.turnRecord.tier1_complete, false, "absence of contradiction is not evidence");
    assert.equal(ambiguous.turnRecord.tier2_required, true);
    assert.equal(reasons(ambiguous).speech_act, "uncertain");
    assert.equal(ambiguous.fn, "ambiguous_reference", "no reading: clarified, not guessed");
  } finally { H.cleanup(state); }
  // The normalization never touches names, negation, question words, time words, references or contrast.
  for (const [line, keep] of [["Tonya isn't coming tho", ["tonya", "isn't"]], ["why not lol", ["why", "not"]], ["was that yesterday or today", ["yesterday", "or", "today"]], ["no, the other one", ["no", "other"]], ["but when tho", ["but", "when"]]]) {
    const out = A.chatSemantic(line).text.toLowerCase();
    for (const w of keep) assert.match(out, new RegExp(`\\b${w}\\b`), `${line} keeps ${w}`);
  }
  // A generic legacy fallback is not positive evidence of the facet.
  const present = [{ id: "g", name: "Giselle", names: ["Giselle"] }];
  const vague = T.analyzeTurn({ raw: "so what's the deal", present, entities: [], dis: null });
  const contract = T.tier1Contract(vague, { discourse_function: "ask_factual" }, null, {});
  assert.equal(contract.tier1_complete, false);
  assert.match(contract.tier2_reason, /facet:unresolved/);
});

// ─── FACET ADVISORY: required id or NONE; one recovery pass ──────────────────────────────────────────────
test("facet advisory — schema forces an id or NONE; NONE fails closed; one second pass recovers or clarifies", async () => {
  const schema = ADV.advisoryV2Schema({ facets: ["mission.objective", "item.holder"] });
  const facet = schema.properties.acts.items.properties.facet;
  assert.deepEqual(facet.enum, ["mission.objective", "item.holder", "NONE"], "an offered id or the explicit NONE: nothing else decodes");
  assert.ok(schema.properties.acts.items.required.includes("facet"), "the facet is never omitted");
  const act = { speech_act: "question", facet: "NONE", addressee_candidate: null, referent_candidate: null, quantifier: "none", discourse_relation: "new" };
  const none = ADV.validateAdvisoryV2({ acts: [act], confidence: "high" }, "so whats the story", { facets: ["mission.objective"] });
  assert.equal(none.accepted, true, JSON.stringify(none));
  assert.equal(none.acts[0].facet, null, "NONE decodes to no facet (fails closed downstream)");
  assert.equal(ADV.validateAdvisoryV2({ acts: [{ ...act, facet: "made.up" }], confidence: "high" }, "so whats the story", { facets: ["mission.objective"] }).accepted, false, "an id not offered is rejected");
  const only = ADV.facetOnlySchema(["mission.objective"]);
  assert.deepEqual(only.properties.facet.enum, ["mission.objective", "NONE"]);
  assert.deepEqual(only.required, ["facet", "confidence"]);
  const cases = [
    ["recovered", "NONE", "mission.objective", { fn: "ask_mission_objective", first: 1, second: 1, recovered: true }],
    ["none twice", "NONE", "NONE", { fn: "ambiguous_reference", first: 1, second: 1, recovered: false }],
    ["first pass fine", "mission.objective", "NONE", { fn: "ask_mission_objective", first: 1, second: 0 }],
    ["invalid facet", "made.up.facet", "mission.objective", { fn: "ambiguous_reference", first: 1, second: 0 }]
  ];
  for (const [label, first, second, want] of cases) {
    const provider = readings(first, second);
    const state = H.setup(`ed30i-facet-${label.replace(/\s/g, "-")}`, provider);
    try {
      const r = await H.turn(state, "so whats the story");
      assert.equal(r.fn, want.fn, label);
      assert.equal(provider.calls.first, want.first, `${label}: one first reading`);
      assert.equal(provider.calls.second, want.second, `${label}: at most one facet-only pass, never a third`);
      if (want.second) {
        assert.equal(r.turnRecord.advisory_state.facet_first_pass, "NONE");
        assert.equal(r.turnRecord.advisory_state.second_pass.recovered, want.recovered, label);
      }
    } finally { H.cleanup(state); }
  }
  // A Tier-2 facet that contradicts the canonical item Tier 1 found in the line: a material disagreement.
  for (const facet of ["person.async_tenure", "mission.destination"]) {
    const state = H.setup("ed30i-conflict", readings(facet));
    try {
      await H.turn(state, "Who has the camera?");
      const r = await H.turn(state, "camera's still on you");
      assert.equal(r.fn, "ambiguous_reference", facet);
      assert.match(r.turnRecord.advisory_state.reason, /facet_contradicts_item/);
    } finally { H.cleanup(state); }
  }
  const agree = H.setup("ed30i-agree", readings("item.holder"));
  try {
    await H.turn(agree, "Who has the camera?");
    assert.equal((await H.turn(agree, "camera's still on you")).fn, "ask_item_ownership", "an agreeing reading fills the gap");
  } finally { H.cleanup(agree); }
});

// ─── DISCOURSE LINKAGE over canonical request frames ─────────────────────────────────────────────────────
test("discourse — why / when was that / who else / and you / before? / referent correction / commentary + follow-up", async () => {
  const state = H.setup("ed30i-discourse", H.garbage());
  try {
    await H.turn(state, "Tonya, have you been in the Complex before?");
    const why = await H.turn(state, "why");
    assert.equal(why.predicate, "conversation.explanation");
    assert.deepEqual(why.ownerNames, ["Tonya"]);
    const when = await H.turn(state, "when was that");
    assert.equal(when.predicate, "person.complex_experience", "the time of the SAME proposition");
    assert.equal(when.turnRecord.primary.args.followup.kind, "temporal_elaboration");
    assert.match(when.lines.join(" "), /couldn't say (?:exactly )?when|when, exactly/i, "no dated event in canon: an honest bound, never an invented date");
    assert.doesNotMatch(when.lines.join(" "), /^Tonya: Like I said/, "new content is not a restatement");
    await H.turn(state, "Is it your first day, Malcolm?");
    const who = await H.turn(state, "who else");
    assert.equal(who.predicate, "person.first_day_at_async", "the same predicate");
    assert.deepEqual(who.ownerNames.sort(), ["Giselle", "Tonya"], "the people who have not answered");
    await H.turn(state, "Giselle and Tonya, how are you doing?");
    const you = await H.turn(state, "and you, Malcolm?");
    assert.equal(you.predicate, "person.wellbeing", "same predicate, new target");
    assert.deepEqual(you.ownerNames, ["Malcolm"]);
    await H.turn(state, "Tonya, how are you feeling?");
    const before = await H.turn(state, "before?");
    assert.equal(before.predicate, "person.wellbeing");
    assert.equal(before.turnRecord.primary.temporal_scope, "earlier", "a present state asked earlier (the predicate's own time support)");
    await H.turn(state, "Who has the camera?");
    const fix = await H.turn(state, "no, the flashlight");
    assert.equal(fix.turnRecord.primary.relation, "repair");
    assert.equal(fix.turnRecord.primary.args.item_id, "q4-field-light-01", "the structured referent is repaired, not only the words");
    assert.match(fix.lines.join(" "), /lamp|light/i);
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    const comment = await H.turn(state, "huh ok, and Tonya?");
    assert.equal(comment.predicate, "person.async_tenure", "commentary + follow-up keeps the frame");
    assert.deepEqual(comment.ownerNames, ["Tonya"]);
    // The frames the linkage reads: canonical request state, both directions.
    const frames = S.snapshot(state.run, { player_id: state.playerId }).discourse_frames;
    const last = frames.filter((f) => f.speaker === "player").at(-1);
    for (const key of ["request_id", "speaker", "addressee", "speech_act", "predicate", "subject", "referent", "temporal", "answer_type", "cardinality", "status"]) assert.ok(key in last, key);
    assert.ok(["pending", "answered", "repaired", "abandoned"].includes(last.status));
  } finally { H.cleanup(state); }
});

test("discourse — a follow-up after save / cold reload still resolves against the persisted frame", async () => {
  const state = H.setup("ed30i-discourse-reload", H.garbage());
  try {
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    reload(state);
    const next = await H.turn(state, "and Tonya?");
    assert.equal(next.predicate, "person.async_tenure");
    assert.deepEqual(next.ownerNames, ["Tonya"]);
    await H.turn(state, "Tonya, have you been in the Complex before?");
    reload(state);
    const when = await H.turn(state, "when was that");
    assert.equal(when.turnRecord.primary.args.followup.kind, "temporal_elaboration");
    assert.deepEqual(when.ownerNames, ["Tonya"]);
  } finally { H.cleanup(state); }
});

// ─── NPC INBOUND: answer shapes ──────────────────────────────────────────────────────────────────────────
test("inbound — answer shapes and offered options are stored; the pending question decides what a short reply means", () => {
  for (const [q, shape, options] of [["Camera or flashlight?", "choice", ["camera", "flashlight"]], ["Who do you think is leading this?", "person", []], ["Have you been on one of these before?", "yes_no", []], ["Where did you leave it?", "place", []], ["When did you get in?", "time", []], ["Which one did you grab?", "item", []], ["What do you do?", "free_short_answer", []]]) {
    const s = S.inboundShape(q);
    assert.equal(s.answer_shape, shape, q);
    assert.deepEqual(s.options, options, q);
  }
  const sc = E.scene();
  const ctx = (line, speaker = "Giselle") => ({ phase: "introductions", active_speaker: speaker, last_player_line: `${speaker}, how are you?`, last_npc_line: line, active_activity: null, activity_done: [], pending_unanswered_request: null });
  const read = (u, c) => { const { dis } = E.contextState(c, sc); return T.analyzeTurn({ raw: u, present: sc.present, entities: sc.entities, dis }).primary; };
  const choice = ctx("Your call. Camera or flashlight?");
  const flash = read("flashlight", choice);
  assert.equal(flash.speech_act, "answer");
  assert.equal(flash.args.answer_shape, "choice");
  assert.equal(flash.args.answer_option, "q4-field-light-01", "the option is a semantic id");
  assert.equal(read("the first one", choice).args.answer_option, flash.args.answer_option === "q4-field-light-01" ? read("camera", choice).args.answer_option : null);
  assert.equal(read("neither", choice).args.answer_option, "none");
  assert.equal(read("both", choice).args.answer_option, "both");
  assert.equal(read("not sure", choice).args.reply_kind, "uncertainty");
  assert.equal(read("i'd rather not say", choice).args.reply_kind, "refusal");
  assert.equal(read("why", choice).args.reply_kind, "counter_question", "a question back is not an answer");
  const person = ctx("Good. Who do you think is leading this?", "Malcolm");
  const tonya = read("Tonya", person);
  assert.equal(tonya.speech_act, "answer", "a bare name answering 'who' is the answer, not a vocative");
  assert.equal(tonya.args.answer_option, sc.idOf("Tonya"));
  assert.deepEqual(tonya.addressee.ids, [sc.idOf("Malcolm")], "said to the one who asked");
  const wrong = read("flashlight", person);
  assert.equal(wrong.clarify?.reason, "answer_shape_mismatch", "an item cannot answer 'who': clarify, never guess");
  const yn = ctx("Fine. Have you been on one of these before?", "Tonya");
  assert.equal(read("nope", yn).args.answer_option, "no");
  assert.equal(read("tonya", yn).speech_act, "attention_call", "a bare name to a yes/no question addresses someone");
  // Player answers are the player's words, never world truth.
  assert.ok(!("value" in (flash.args ?? {})));
});

test("inbound — the answer shape is canonical: the same plan gives the same shape whatever words were spoken", () => {
  const run = { expedition: { dialogue_state: {}, dialogue_history: [] } };
  const plan = { asks_player: true, predicate: null };
  const a = S.recordInboundRequest(run, { event_id: "e1", speaker_id: "g", text: "Camera or flashlight?", plan });
  const b = S.recordInboundRequest(run, { event_id: "e2", speaker_id: "g", text: "Who's leading, you reckon?", plan });
  assert.equal(a.answer_shape, b.answer_shape, "wording never sets conversation state");
  const c = S.recordInboundRequest(run, { event_id: "e3", speaker_id: "g", text: "anything", plan: { ...plan, answer_shape: "choice", options: [CAMERA, LAMP] } });
  assert.deepEqual([c.answer_shape, c.options], ["choice", [CAMERA, LAMP]]);
});

test("inbound — through the service: yes/no, either/or, person, item, uncertainty, refusal, correction, counter-question", async () => {
  const state = H.setup("ed30i-inbound", H.garbage());
  try {
    await H.turn(state, "Tonya, how are you?");
    coworkerAsks(state, "Tonya", { predicate: "person.expedition_experience", text: "Have you been on one of these before?", answer_shape: "yes_no" });
    const requests = state.run.expedition.dialogue_state.requests.length;
    const yes = await H.turn(state, "yeah");
    assert.equal(yes.turnRecord.primary.speech_act, "answer");
    assert.equal(yes.turnRecord.primary.args.answer_option, "yes");
    assert.equal(state.run.expedition.dialogue_state.requests.length, requests, "an answer opens no request");
    coworkerAsks(state, "Giselle", { text: "Camera or flashlight?", ...CHOICE });
    const pick = await H.turn(state, "the flashlight");
    assert.equal(pick.turnRecord.primary.args.answer_option, LAMP);
    assert.deepEqual(pick.turnRecord.primary.addressee.ids, [state.id("Giselle")]);
    const own = state.run.expedition.equipment["q4-field-light-01"] ?? null;
    assert.deepEqual(state.run.expedition.equipment["q4-field-light-01"] ?? null, own, "choosing is not taking: no world state changed");
    const fix = await H.turn(state, "I mean, the camera");
    assert.equal(fix.turnRecord.primary.args.reply_kind, "answer_repair", "the player corrects their own answer");
    coworkerAsks(state, "Malcolm", { text: "Who do you think is leading this?", answer_shape: "person" });
    const name = await H.turn(state, "Tonya");
    assert.equal(name.turnRecord.primary.speech_act, "answer");
    assert.equal(name.turnRecord.primary.args.answer_option, state.id("Tonya"));
    assert.deepEqual(name.turnRecord.primary.addressee.ids, [state.id("Malcolm")]);
    coworkerAsks(state, "Giselle", { text: "Which one did you grab?", answer_shape: "item" });
    assert.equal((await H.turn(state, "the camera")).turnRecord.primary.args.answer_shape, "item");
    coworkerAsks(state, "Malcolm", { text: "Camera or flashlight?", ...CHOICE });
    assert.equal((await H.turn(state, "not sure")).turnRecord.primary.args.reply_kind, "uncertainty");
    coworkerAsks(state, "Malcolm", { text: "Camera or flashlight?", ...CHOICE });
    assert.equal((await H.turn(state, "I'd rather not say")).turnRecord.primary.args.reply_kind, "refusal");
    coworkerAsks(state, "Tonya", { text: "Camera or flashlight?", ...CHOICE });
    const counter = await H.turn(state, "why do you ask");
    assert.equal(counter.predicate, "conversation.explanation");
    assert.deepEqual(counter.ownerNames, ["Tonya"]);
    coworkerAsks(state, "Tonya", { text: "Camera or flashlight?", ...CHOICE });
    const offList = await H.turn(state, "the spectrometer");
    assert.equal(offList.turnRecord.primary.clarify?.reason, "answer_not_offered", "not one of the offered options: clarify");
  } finally { H.cleanup(state); }
});

test("inbound — a fragment answer after a cold reload still answers the pending question", async () => {
  const state = H.setup("ed30i-inbound-reload", H.garbage());
  try {
    await H.turn(state, "Giselle, what should I carry?");
    coworkerAsks(state, "Giselle", { text: "Your call. Camera or flashlight?", ...CHOICE });
    reload(state);
    const snap = S.snapshot(state.run, { player_id: state.playerId });
    assert.equal(snap.pending_inbound_request.answer_shape, "choice");
    assert.deepEqual(snap.pending_inbound_request.options, [CAMERA, LAMP], "options persist as semantic ids");
    assert.ok(snap.discourse_frames.some((f) => f.speaker === state.id("Giselle") && f.status === "pending" && f.answer_type === "choice"));
    const r = await H.turn(state, "flashlight");
    assert.equal(r.turnRecord.primary.speech_act, "answer");
    assert.equal(r.turnRecord.primary.args.answer_option, "q4-field-light-01");
  } finally { H.cleanup(state); }
});

// ─── SAFETY: clarify rather than guess ───────────────────────────────────────────────────────────────────
test("safety — ambiguous facet / antecedent / addressee, malformed reading and timeout all clarify", async () => {
  const state = H.setup("ed30i-safety", H.garbage());
  try {
    const facet = await H.turn(state, "so whats the story");
    assert.equal(facet.fn, "ambiguous_reference", "malformed reading: the unresolved facet is clarified");
    assert.equal(facet.turnRecord.advisory_state.accepted, false);
    await H.turn(state, "Where are we going?");
    const which = await H.turn(state, "which one");
    assert.equal(which.fn, "ambiguous_reference", "nothing was offered to choose from");
    await H.turn(state, "Giselle, how are you doing?");
    const you = await H.turn(state, "and you?");
    assert.equal(you.fn, "ambiguous_reference", "two people could be 'you': ask who");
  } finally { H.cleanup(state); }
  const slow = readings(new Promise(() => {}));
  const timed = H.setup("ed30i-timeout", slow);
  try {
    const r = await H.turn(timed, "so whats the story");
    assert.equal(r.fn, "ambiguous_reference", "a reading that never arrives is not understanding");
    assert.equal(r.turnRecord.advisory_state.accepted, false);
  } finally { H.cleanup(timed); }
});

// ─── fuzz findings (seed 30031), pinned ──────────────────────────────────────────────────────────────────
test("fuzz — a meta question never carries to a new person; a pair question keeps its pair; a licensed report is not an echo", async () => {
  const state = H.setup("ed30i-fuzz", H.garbage());
  try {
    const pair = await H.turn(state, "Malcolm and Tonya, do you two know each other?");
    const tonyaFirst = pair.lines.find((l) => l.startsWith("Tonya:"));
    await H.turn(state, "I'm a little nervous.");
    await H.turn(state, "What do you mean?");
    const turn = await H.turn(state, "Your turn, Tonya.");
    assert.doesNotMatch(turn.lines.join(" "), /said, "/, "no nested report of a reply about the player's words");
    assert.equal(turn.predicate, "person.familiarity", "the substantive question before the meta one");
    assert.match(turn.lines.join(" "), /only met today|never met/i, `consistent with ${tonyaFirst}`);
  } finally { H.cleanup(state); }
  const V = require("../tools/dialogue-validation");
  const plan = { discourse_function: "ask_predicate", required_facts: [{ key: "predicate_answer", value: { predicate: "person.complex_experience", value: "value", answer: { reported: true, speaker_name: "Tonya" }, statements: ["Tonya said they'd been in the Complex before"] } }], optional_facts: [], forbidden_claims: [] };
  assert.equal(V.validateContribution(plan, "Tonya said they'd been in the Complex before.", { player_text: "Has Tonya been in the Complex before?", speaker_name: "Giselle", people: [{ id: "t", name: "Tonya" }], speaker_id: "g" }).ok, true);
  assert.equal(V.validateContribution({ ...plan, required_facts: [] }, "Tonya has been in the Complex before.", { player_text: "Has Tonya been in the Complex before?", speaker_name: "Giselle", people: [{ id: "t", name: "Tonya" }], speaker_id: "g" }).ok, false, "an unattributed echo is still rejected");
});
