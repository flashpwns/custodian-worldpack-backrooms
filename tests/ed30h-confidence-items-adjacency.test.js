"use strict";

// ED-30H — the Tier-1 completeness/confidence contract, item question roles (definition / purpose / use /
// holder / location / provenance), bidirectional adjacency pairs (a coworker asks the PLAYER), commentary-
// prefixed follow-ups, and short fragments read against the conversation. Critical cases run through the
// production dialogue service.

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const T = require("../tools/dialogue-turn");
const S = require("../tools/dialogue-state");
const ADV = require("../tools/dialogue-advisory-interpreter");
const E = require("../tools/dialogue-eval");

const reasons = (r) => Object.fromEntries((r.turnRecord?.tier1_confidence_reasons ?? []).map((x) => [x.field, x.status]));
/** Opens a coworker's question TO the player the canonical way: from a plan that asks the player. */
function coworkerAsks(state, name, { predicate = "person.expedition_experience", text = "Have you been on one of these before?" } = {}) {
  const id = state.id(name);
  const event = { id: `npc-q-${++state.counter}`, speaker_id: id, speaker_name: name, text, submission_id: null, channel: "local" };
  state.run.expedition.dialogue_history.push(event);
  return S.recordInboundRequest(state.run, { event_id: event.id, speaker_id: id, text, plan: { asks_player: true, predicate }, request_id: null });
}

// ─── TIER-1 CONFIDENCE ───────────────────────────────────────────────────────────────────────────────────
test("contract — the trace says WHY Tier 1 is or is not sufficient; escalation is selective", async () => {
  const state = H.setup("ed30h-contract", H.garbage());
  try {
    const clearQ = await H.turn(state, "where are we going");
    assert.equal(clearQ.turnRecord.tier1_complete, true, "a clear question without punctuation is complete");
    assert.equal(clearQ.turnRecord.tier2_required, false);
    assert.equal(reasons(clearQ).facet, "resolved");
    const clearS = await H.turn(state, "I'm Jack, by the way.");
    assert.equal(clearS.turnRecord.tier2_required, false, "a clear statement needs no reading");
    const resolved = await H.turn(state, "Tonya, have you been in the Complex before?");
    assert.equal(resolved.turnRecord.tier1_complete, true);
    const ambiguous = await H.turn(state, "the camera's still on you");
    assert.equal(reasons(ambiguous).speech_act, "uncertain", "an ambiguous declarative is not complete");
    assert.equal(ambiguous.turnRecord.tier2_required, true);
    assert.match(ambiguous.turnRecord.tier2_reason, /speech_act:uncertain/);
    const facet = await H.turn(state, "so whats the story");
    assert.equal(reasons(facet).facet, "unresolved");
    assert.equal(facet.turnRecord.tier2_required, true);
  } finally { H.cleanup(state); }
  // An unresolved target and an unresolved fragment, as the contract sees them.
  const present = [{ id: "g", name: "Giselle", names: ["Giselle"] }, { id: "m", name: "Malcolm", names: ["Malcolm"] }];
  const target = T.analyzeTurn({ raw: "Bob, how are you?", present, entities: [], dis: null });
  const c = T.tier1Contract(target, null, null, {});
  assert.ok(c.tier1_confidence_reasons.some((r) => r.field === "addressee" && r.status === "unresolved") || c.tier1_frame.addressee.length === 0);
  const frag = T.analyzeTurn({ raw: "the thing", present, entities: [], dis: null });
  assert.equal(T.tier1Contract(frag, null, null, {}).tier2_required, true, "an incomplete fragment is read, not assumed");
});

// ─── ITEM SEMANTICS ──────────────────────────────────────────────────────────────────────────────────────
test("items — changing ONLY the relation word changes the facet (definition / purpose / use / holder / location / provenance)", () => {
  const sc = E.scene();
  const role = (t) => T.itemRole(t, sc.entities, null)?.predicate ?? null;
  const pairs = [
    ["what is the lamp", "item.definition"], ["what's the lamp for", "item.purpose"], ["what's the lamp used for", "item.purpose"],
    ["what does the lamp do", "item.purpose"], ["why are we carrying the lamp", "item.purpose"], ["who has the lamp", "item.holder"],
    ["where is the lamp", "item.location"], ["where did the lamp come from", "item.provenance"], ["what's in the duffle", "item.contents"],
    ["what's the deal with the lamp", null]
  ];
  for (const [t, facet] of pairs) assert.equal(role(t), facet, t);
});

test("items — through the service: a purpose question never gets a definition; unknown purpose / provenance stay bounded", async () => {
  const state = H.setup("ed30h-items", H.garbage());
  try {
    const def = await H.turn(state, "what is the spectrometer");
    assert.equal(def.predicate, "item.definition");
    const purpose = await H.turn(state, "what's the spectrometer for");
    assert.equal(purpose.predicate, "item.purpose");
    assert.match(purpose.lines.join(" "), /nobody's told me|not sure|don't know/i, "no authored purpose: bounded uncertainty, never the definition");
    const use = await H.turn(state, "what does the lamp do");
    assert.match(use.lines.join(" "), /illumination/i, "an authored capability answers what it does");
    const where = await H.turn(state, "where's the spectrometer");
    assert.equal(where.predicate, "item.location");
    const from = await H.turn(state, "where did the spectrometer come from");
    assert.equal(from.predicate, "item.provenance");
    assert.match(from.lines.join(" "), /don't know where it came from|no idea where it came from|couldn't tell you where/i);
  } finally { H.cleanup(state); }
});

// ─── BIDIRECTIONAL DIALOGUE ──────────────────────────────────────────────────────────────────────────────
test("adjacency — a coworker's question to the player: answer, uncertainty, refusal, counter-question, repair of the answer", async () => {
  const state = H.setup("ed30h-adjacency", H.garbage());
  try {
    await H.turn(state, "Tonya, how are you?");
    coworkerAsks(state, "Tonya");
    const requestsBefore = state.run.expedition.dialogue_state.requests.length;
    const yes = await H.turn(state, "yeah once");
    assert.equal(yes.turnRecord.primary.speech_act, "answer");
    assert.equal(yes.turnRecord.primary.args.reply_kind, "answer");
    assert.deepEqual(yes.turnRecord.primary.addressee.ids, [state.id("Tonya")], "the answer is for the one who asked");
    assert.equal(state.run.expedition.dialogue_state.requests.length, requestsBefore, "an answer opens no request of its own");
    // The player repairs their OWN answer right after.
    const fix = await H.turn(state, "I mean, twice actually");
    assert.equal(fix.turnRecord.primary.args.reply_kind, "answer_repair");
    for (const [line, kind] of [["honestly no idea", "uncertainty"], ["I'd rather not get into it", "refusal"]]) {
      coworkerAsks(state, "Malcolm", { predicate: null, text: "What do you do, anyway?" });
      const r = await H.turn(state, line);
      assert.equal(r.turnRecord.primary.args.reply_kind, kind, line);
      assert.deepEqual(r.turnRecord.primary.addressee.ids, [state.id("Malcolm")]);
    }
    coworkerAsks(state, "Giselle");
    const counter = await H.turn(state, "why do you ask");
    assert.equal(counter.predicate, "conversation.explanation", "a counter-question asks the asker's reason");
    assert.deepEqual(counter.ownerNames, ["Giselle"]);
    // An open question answered with a statement.
    coworkerAsks(state, "Giselle", { predicate: "person.role", text: "What's your job, anyway?" });
    const open = await H.turn(state, "I'm on camera");
    assert.equal(open.turnRecord.primary.speech_act, "answer");
    assert.equal(open.predicate, null, "the answer is heard, not re-asked as a question about anyone");
  } finally { H.cleanup(state); }
});

test("adjacency — a pending coworker question survives a cold reload; the answer after reload still answers it", async () => {
  const state = H.setup("ed30h-reload", H.garbage());
  try {
    await H.turn(state, "Malcolm, how are you?");
    coworkerAsks(state, "Malcolm");
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    state.service.shutdown?.();
    const { DesktopService } = require("../desktop/service");
    const service2 = new DesktopService({ appDataPath: state.root, defaultQ4Scenario: "day1-opener", localDialogueProvider: H.garbage(), developerMode: true });
    service2.log = (line) => state.logs.push(String(line));
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    state.service = service2;
    Object.defineProperty(state, "run", { get: () => service2.session(state.worldId, "field-researcher").run, configurable: true });
    const snap = S.snapshot(state.run, { player_id: state.playerId });
    assert.equal(snap.pending_inbound_request?.from, state.id("Malcolm"), "the expectation persisted (conversation state only)");
    const r = await H.turn(state, "nope, first time");
    assert.equal(r.turnRecord.primary.speech_act, "answer");
    assert.deepEqual(r.turnRecord.primary.addressee.ids, [state.id("Malcolm")]);
  } finally { H.cleanup(state); }
});

// ─── COMMENTARY FOLLOW-UPS ───────────────────────────────────────────────────────────────────────────────
test("commentary — acknowledgment / sarcasm / correction markers do not erase the link to the prior exchange", async () => {
  const state = H.setup("ed30h-commentary", H.garbage());
  try {
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    const since = await H.turn(state, "wow ok, since when");
    assert.equal(since.predicate, "person.async_tenure");
    assert.deepEqual(since.ownerNames, ["Malcolm"]);
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    const next = await H.turn(state, "cool cool, and Tonya?");
    assert.equal(next.predicate, "person.async_tenure");
    assert.deepEqual(next.ownerNames, ["Tonya"]);
    await H.turn(state, "Who has the camera?");
    const fix = await H.turn(state, "yeah no, I meant the lamp");
    assert.equal(fix.fn, "ask_item_ownership");
    assert.match(fix.lines.join(" "), /lamp|light/i);
    await H.turn(state, "Malcolm, how long have you been with ASYNC?");
    const sarcastic = await H.turn(state, "great, love that, and before that");
    assert.equal(sarcastic.predicate, "person.async_tenure");
  } finally { H.cleanup(state); }
});

// ─── SHORT FRAGMENTS ─────────────────────────────────────────────────────────────────────────────────────
test("fragments — unique / ambiguous / no antecedent; person, item, temporal and 'and you' fragments", async () => {
  // The deterministic compatibility check of a fragment reading.
  const present = [{ id: "g", name: "Giselle", names: ["Giselle"] }, { id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
  const analysis = T.analyzeTurn({ raw: "how long", present, entities: [], dis: null });
  const reading = (facet) => ({ version: ADV.ADVISORY_V2_VERSION, accepted: true, confidence: "high", acts: [{ speech_act: "question", facet, addressee_id: null, referent_id: null, quantifier: "none", discourse_relation: "continuation" }], tier1_missing: ["fragment_unresolved"] });
  const one = { last_substantive_request: { predicate: "person.async_tenure", answered_by: ["m"] } };
  const two = { ...one, pending_requests: [{ predicate: "mission.schedule", targets: ["g", "m", "t"] }] };
  assert.equal(T.assessAdvisory(reading("person.async_tenure"), analysis, { dis: one }).accepted, true, "unique compatible antecedent");
  assert.equal(T.assessAdvisory(reading("mission.route"), analysis, { dis: one }).reason, "no_compatible_antecedent");
  const both = T.assessAdvisory({ ...reading("person.async_tenure"), acts: [{ ...reading("person.async_tenure").acts[0] }] }, analysis, { dis: { ...two, pending_requests: [{ predicate: "person.async_tenure", targets: [] }, { predicate: "person.first_day_at_async", targets: [] }] } });
  assert.ok(both.accepted || both.reason === "ambiguous_antecedent");
  // The conversation state the reading gets: facets and labels only.
  const ctx = T.advisoryContext(analysis, one, { people: [{ label: "p2", id: "m", name: "Malcolm" }] });
  assert.deepEqual(ctx.last_question, { facet: "person.async_tenure", answered_by: ["p2"] });
  assert.ok(!JSON.stringify(ADV.buildAdvisoryV2Prompt({ utterance: "how long", facets: [], context: ctx })).includes("yb-personnel"));
  const state = H.setup("ed30h-fragments", H.garbage());
  try {
    const none = await H.turn(state, "which one");
    assert.equal(none.fn, "ambiguous_reference", "no antecedent: clarify");
    await H.turn(state, "Who has the camera?");
    const item = await H.turn(state, "the lamp?");
    assert.equal(item.fn, "ask_item_ownership", "an item fragment re-asks about that item");
    const person = await H.turn(state, "Tonya?");
    assert.deepEqual(person.ownerNames, ["Tonya"]);
    await H.turn(state, "Tonya, have you been in the Complex before?");
    const ever = await H.turn(state, "before?");
    assert.equal(ever.predicate, "person.complex_experience");
    await H.turn(state, "Tonya, have you been in the Complex before?");
    await H.turn(state, "Giselle, how about you?");
    const last = await H.turn(state, "and you");
    assert.equal(last.owners.length, 1, "one person left in the round");
  } finally { H.cleanup(state); }
});
