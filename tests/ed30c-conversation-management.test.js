"use strict";

// ED-30 C — Conversation management through the production service: response cardinality (J9), repairs,
// attention calls and ellipsis (J10), procedure progress and movement participants (J11), the request
// ledger's states, legitimate silence vs failure (F13), and the living-NPC seams (C6).

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const S = require("../tools/dialogue-state");
const K = require("../tools/canonical-knowledge");
const AG = require("../tools/dialogue-agents");

const answerOf = (plan) => plan?.required_facts?.find((f) => f.key === "predicate_answer")?.value ?? null;
function moveAway(state, name) { state.run.expedition.team.members.find((m) => (m.personnel_id ?? m.id) === state.id(name)); state.run.spatial.personnel_locations[state.id(name)] = "equipment-staging"; }
const lastRequest = (state) => state.run.expedition.dialogue_state.requests.at(-1);

// ─── J9: cardinality matrix ──────────────────────────────────────────────────────────────────────────
const POLICIES = [
  ["each_self", "How are you all doing?", 3],
  ["each_self_concise", "Have any of you been inside before?", 3],
  ["one_knower", "Does anyone know where the startup materials are going?", 1],
  ["one_spokesperson", "Where are we going?", 1],
  ["collective", "Are we all going together?", 1],
  ["each_ack", "Morning, everyone. I'm Jack.", 3],
  ["none", "Good to hear.", 0]
];
test("J9 cardinality — all present / one absent / named subset: never 'group => one spokesperson' by default", async () => {
  for (const absent of [false, true]) {
    const state = H.setup(`ed30-card-${absent}`, H.garbage());
    try {
      if (absent) moveAway(state, "Giselle");
      for (const [policy, text, count] of POLICIES) {
        const t = await H.turn(state, text);
        const expected = absent && count === 3 ? 2 : count;
        assert.equal(t.owners.length, expected, `${absent ? "one absent" : "all present"} ${policy}: ${text} -> ${t.lines.join(" | ")}`);
        if (absent) assert.ok(!t.owners.includes(state.id("Giselle")), "an absent person never answers");
      }
    } finally { H.cleanup(state); }
  }
  const state = H.setup("ed30-card-subset", H.garbage());
  try {
    const each = await H.turn(state, "Malcolm and Tonya, how are you doing?");
    assert.deepEqual(each.owners.sort(), [state.id("Malcolm"), state.id("Tonya")].sort());
    const concise = await H.turn(state, "Malcolm and Tonya, have you been inside before?");
    assert.equal(concise.owners.length, 2);
    const shared = await H.turn(state, "Malcolm and Tonya, where are we going?");
    assert.equal(shared.owners.length, 1, "a shared fact from a named subset: one of them");
    assert.ok([state.id("Malcolm"), state.id("Tonya")].includes(shared.owners[0]));
  } finally { H.cleanup(state); }
});

test("J9 cardinality — the knower answers when one member lacks the knowledge; identical values never chorus", async () => {
  const state = H.setup("ed30-card-know", H.garbage());
  try {
    // Only Tonya heard the roster call (knowledge comes from what each person was present for).
    for (const beat of state.run.expedition.day1_opener.personnel_briefing.exchange_history) if (/roster|custody|Outpost/i.test(beat.text ?? "")) beat.listeners = [state.playerId, state.id("Tonya")];
    const t = await H.turn(state, "Does anyone know where the startup materials are going?");
    assert.deepEqual(t.owners, [state.id("Tonya")], "the one who knows answers");
    const excited = await H.turn(state, "Are you all excited?");
    const lines = excited.spoken.map((e) => e.text);
    assert.equal(new Set(lines).size, lines.length, "no two identical sentences");
    const firstDay = await H.turn(state, "Is it everyone's first day?");
    assert.deepEqual(firstDay.contexts.map((c) => answerOf(c.response_plan).value).sort(), ["no", "no", "yes"], "differing values each stated");
  } finally { H.cleanup(state); }
});

// ─── J10: repairs, attention calls, ellipsis ──────────────────────────────────────────────────────────
test("J10 target repairs — re-ask the SAME question of the intended person; the earlier reply stays in history", async () => {
  const state = H.setup("ed30-repair", H.garbage());
  try {
    const asked = await H.turn(state, "Giselle, what do you do?");
    const historyBefore = state.run.expedition.dialogue_history.length;
    const fixed = await H.turn(state, "I was speaking to Malcolm");
    assert.deepEqual(fixed.owners, [state.id("Malcolm")]);
    assert.equal(fixed.fn, asked.fn, "the same question");
    assert.equal(state.run.expedition.dialogue_history[historyBefore - 1].text, asked.spoken[0].text, "the mistaken/earlier reply is never rewritten");
    assert.ok(state.run.expedition.dialogue_state.repairs.some((r) => r.kind === "target_repair" || r.kind.endsWith("_repair")));
    const other = await H.turn(state, "Giselle and Tonya, where are we going?");
    const next = await H.turn(state, "No, the other one.");
    assert.deepEqual(next.owners, [[state.id("Giselle"), state.id("Tonya")].find((id) => id !== other.owners[0])]);
  } finally { H.cleanup(state); }
});

test("J10 facet / temporal / referent repairs keep the target and change only the repaired part", async () => {
  const state = H.setup("ed30-facet", H.garbage());
  try {
    await H.turn(state, "Where are we going?");
    const why = await H.turn(state, "I meant why, not where.");
    assert.equal(why.predicate, "mission.objective");
    await H.turn(state, "Tonya, have you done this before?");
    const complex = await H.turn(state, "I meant the Complex.");
    assert.deepEqual(complex.owners, [state.id("Tonya")]);
    assert.equal(complex.predicate, "person.complex_experience");
    const superseded = state.run.expedition.dialogue_state.requests.find((r) => r.predicate === "person.expedition_experience");
    assert.equal(superseded.state, "SUPERSEDED", "the repaired request is superseded, not deleted");
    await H.turn(state, "Tonya, have you been in the Complex today?");
    const ever = await H.turn(state, "Not today. Ever.");
    assert.deepEqual(ever.owners, [state.id("Tonya")]);
    assert.equal(ever.turnRecord.primary.temporal_scope, "ever");
  } finally { H.cleanup(state); }
});

test("J10 attention calls — pending request re-opened and answered; named attention; nothing pending -> brief attention", async () => {
  const state = H.setup("ed30-attn", H.garbage());
  try {
    const idle = await H.turn(state, "Hello?");
    assert.equal(idle.fn, "attend");
    assert.equal(idle.owners.length, 1);
    // A request nobody answered (opened on the ledger for the whole table).
    const pending = S.openRequest(state.run, { predicate: "transition.participants", fn: "ask_predicate", request_text: "Are we all going together?", targets: state.ids, cardinality: "one_spokesperson" });
    const hello = await H.turn(state, "Hello?");
    assert.equal(hello.turnRecord.primary.relation, "attention");
    assert.equal(hello.predicate, "transition.participants");
    assert.equal(S.findRequest(state.run, pending.request_id).state, "SATISFIED");
    const pending2 = S.openRequest(state.run, { predicate: "person.first_day_at_async", fn: "ask_predicate", request_text: "Is this your first day?", targets: [state.id("Tonya")], cardinality: "each_self" });
    const named = await H.turn(state, "Tonya?");
    assert.deepEqual(named.owners, [state.id("Tonya")]);
    assert.equal(S.findRequest(state.run, pending2.request_id).state, "SATISFIED");
    // Stale: four unrelated turns abandon an unanswered request; then "Hello?" is only an attention call.
    const stale = S.openRequest(state.run, { predicate: "mission.schedule", fn: "ask_predicate", request_text: "When do we leave?", targets: state.ids, cardinality: "one_spokesperson" });
    for (const text of ["Nice.", "Cool.", "Okay.", "Right."]) await H.turn(state, text);
    assert.equal(S.findRequest(state.run, stale.request_id).state, "ABANDONED");
    assert.equal((await H.turn(state, "Hello?")).fn, "attend");
  } finally { H.cleanup(state); }
});

test("J10 ellipsis — the antecedent's FRAME carries to new targets; ambiguous ellipsis clarifies", async () => {
  const state = H.setup("ed30-ellipsis", H.garbage());
  try {
    await H.turn(state, "How are you doing, Giselle?");
    const tonya = await H.turn(state, "What about Tonya?");
    assert.deepEqual(tonya.owners, [state.id("Tonya")]);
    assert.equal(tonya.predicate, "person.wellbeing");
    const others = await H.turn(state, "What about the others?");
    assert.ok(others.owners.includes(state.id("Malcolm")));
    await H.turn(state, "Giselle, have you been in the Complex before?");
    const same = await H.turn(state, "Same question, Malcolm.");
    assert.deepEqual(same.owners, [state.id("Malcolm")]);
    assert.equal(same.predicate, "person.complex_experience");
    const and = await H.turn(state, "And Tonya?");
    assert.deepEqual(and.owners, [state.id("Tonya")]);
    assert.equal(and.predicate, "person.complex_experience");
    // Self-introduction round: "Your turn." resolves only when one person is left.
    await H.turn(state, "Giselle, tell me about yourself.");
    const ambiguous = await H.turn(state, "Your turn.");
    assert.equal(ambiguous.plan().may_ask_clarifying_question, true, "two people are left: ask who");
    await H.turn(state, "Malcolm, your turn.");
    const last = await H.turn(state, "Your turn.");
    assert.deepEqual(last.owners, [state.id("Tonya")], "the one person left in the round");
    const why = await H.turn(state, "Why?");
    assert.equal(why.fn, "ask_explanation");
    assert.deepEqual(why.owners, [state.id("Tonya")]);
  } finally { H.cleanup(state); }
});

// ─── J11: procedure and participants ──────────────────────────────────────────────────────────────────
test("J11 procedure — briefing ends -> pending; partial introductions -> pending; all introduced -> Equipment Staging; history kept", async () => {
  const state = H.setup("ed30-proc", H.garbage());
  try {
    const next = async () => (await H.turn(state, "What's next?")).plan().required_facts.find((f) => f.key === "current_procedure")?.value;
    assert.equal((await next()).current_step, "get acquainted with the team");
    await H.turn(state, "Giselle, tell me about yourself.");
    await H.turn(state, "Malcolm, tell me about yourself.");
    assert.equal((await next()).current_step, "get acquainted with the team", "two of three introduced: still acquainting");
    await H.turn(state, "Tonya, tell me about yourself.");
    const after = await next();
    assert.equal(after.current_step, null);
    assert.equal(after.next_step, "report to Equipment Staging");
    assert.equal(state.run.expedition.dialogue_state.acquaintance.completed_by, "every_coworker_introduced");
    // The instruction itself is still queryable as history.
    const history = await H.turn(state, "What did Maxwell tell us to do after the briefing?");
    assert.match(JSON.stringify(history.plan().required_facts), /acquainted/);
    // Entering staging changes the procedure again (knowledge query; LOCAL is paused at staging).
    state.run.expedition.day1_opener.esd_handoff = { status: "equipment-cooperation" };
    const staged = K.queryKnowledge(state.run, { actor_id: state.id("Tonya"), concept: "current_procedure" });
    assert.ok(staged.facts.some((f) => f.key === "at_equipment_staging"));
    assert.ok(!staged.facts.some((f) => f.key === "report_to_next_destination"));
  } finally { H.cleanup(state); }
});

test("J11 participants — from the briefing, never invented; split-up questions answered honestly", async () => {
  const state = H.setup("ed30-part", H.garbage());
  try {
    const all = await H.turn(state, "Are we all going together?");
    assert.equal(answerOf(all.plan()).value, "yes");
    assert.deepEqual(answerOf(all.plan()).provenance, ["briefing"]);
    const coming = await H.turn(state, "Is Tonya coming?");
    assert.equal(coming.predicate, "transition.participants");
    assert.equal(answerOf(coming.plan()).value, "yes");
    const split = await H.turn(state, "Do we split up?");
    assert.match(split.spoken[0].text, /splitting up|all of us/i);
    const where = await H.turn(state, "Where is Tonya?");
    assert.notEqual(where.predicate, "transition.participants", "presence is not participation");
  } finally { H.cleanup(state); }
});

// ─── ledger + silence ─────────────────────────────────────────────────────────────────────────────────
test("F1 ledger — satisfaction states follow delivered, validated lines; legitimate silence opens nothing", async () => {
  const state = H.setup("ed30-ledger", H.garbage());
  try {
    await H.turn(state, "Where are we going?");
    assert.equal(lastRequest(state).state, "SATISFIED");
    await H.turn(state, "Who has the thing?");
    assert.equal(lastRequest(state).state, "CLARIFYING");
    await H.turn(state, "What's Tonya's favourite colour?");
    assert.ok(["CLARIFYING", "ANSWERED_UNKNOWN"].includes(lastRequest(state).state));
    const before = state.run.expedition.dialogue_state.requests.length;
    const quiet = await H.turn(state, "Good to hear.");
    assert.equal(quiet.spoken.length, 0, "silence is legitimate after a filler");
    assert.equal(state.run.expedition.dialogue_state.requests.length, before, "no request was opened");
    assert.equal(quiet.turnRecord.primary.speech_act, "social_acknowledgment");
    for (const r of state.run.expedition.dialogue_state.requests) for (const slot of Object.values(r.slots)) if (slot.state === "SATISFIED") assert.ok(state.run.expedition.dialogue_history.some((e) => e.id === slot.response_event_id), "every satisfied slot points at a committed line");
  } finally { H.cleanup(state); }
});

// ─── C6 seams ──────────────────────────────────────────────────────────────────────────────────────────
test("C6 seams — agenda (empty; cannot introduce unlicensed propositions), beliefs, needs, learning hook", async () => {
  const state = H.setup("ed30-seams", H.garbage());
  try {
    const tonya = state.id("Tonya");
    assert.deepEqual(AG.speakerAgenda(state.run, tonya), []);
    const { admitted, dropped } = AG.admitAgenda(state.run, tonya, [{ kind: "mention", proposition_key: "mission_statement" }, { kind: "mention", proposition_key: "invented_secret_mission" }, { kind: "confess" }]);
    assert.equal(admitted.length, 1);
    assert.match(admitted[0].value.statement, /assignment/i);
    assert.deepEqual(dropped.map((d) => d.reason), ["unlicensed_proposition", "unsupported_kind"]);
    const beliefs = AG.beliefsOf(state.run, tonya);
    assert.ok(beliefs.length > 0 && beliefs.every((b) => b.provenance && b.source_ref !== undefined));
    assert.throws(() => AG.reviseBelief(), { code: "BELIEF_REVISION_DEFERRED" });
    assert.equal(AG.currentConcern(state.run, tonya).status, "not_established");
    const mind = await H.turn(state, "Tonya, what's on your mind?");
    assert.equal(mind.predicate, "person.intent");
    assert.equal(answerOf(mind.plan()).value, "not_established");
    const learned = state.run.expedition.dialogue_state.learning.filter((e) => e.source_actor_id === tonya);
    assert.ok(learned.every((e) => e.actor_id !== tonya));
    await H.turn(state, "Is it everyone's first day?");
    assert.ok(state.run.expedition.dialogue_state.learning.some((e) => e.proposition.predicate === "person.first_day_at_async" && e.actor_id === state.id("Giselle") && e.source_actor_id === tonya), "Giselle learned what Tonya said about herself, from Tonya");
    // ...and can report it later, attributed and in the past tense, never as a present fact.
    const report = await H.turn(state, "Giselle, is it Tonya's first day?");
    const a = answerOf(report.plan(state.id("Giselle")));
    assert.equal(a.answer.reported, true);
    assert.match(report.spoken[0].text, /Tonya said/);
  } finally { H.cleanup(state); }
});

// ─── Independent review (A7) findings, pinned ────────────────────────────────────────────────────────
test("A7 F1 — a question about someone else (present or not) is never answered about the responder", async () => {
  const state = H.setup("ed30-f1", H.garbage());
  try {
    for (const q of ["Is Maxwell nervous?", "Is it Maxwell's first day?", "Has Maxwell been in the Complex?", "Tonya, is Maxwell tired?"]) {
      const t = await H.turn(state, q);
      assert.equal(t.fn, "ask_predicate", q);
      assert.equal(answerOf(t.plan()).value, "unknown", q);
      assert.ok(answerOf(t.plan()).answer.third_party, q);
      assert.doesNotMatch(t.spoken[0].text, /^(?:Yes|No)?,?\s*I(?:'m|'ve| am| have)\b/, q);
    }
    const tonya = await H.turn(state, "Does anyone know if Tonya has been here long?");
    assert.deepEqual(tonya.owners, [state.id("Tonya")], "the subject answers for herself, once");
  } finally { H.cleanup(state); }
});

test("A7 F2 — an inverted question ('Is this your first time going in?') gets the right yes/no", async () => {
  const state = H.setup("ed30-f2", H.garbage());
  try {
    const tonya = await H.turn(state, "Tonya, is this your first time going in?");
    assert.equal(answerOf(tonya.plan()).inverted, true);
    assert.match(tonya.spoken[0].text, /^No\b/);
    const malcolm = await H.turn(state, "Malcolm, is this your first time in the Complex?");
    assert.match(malcolm.spoken[0].text, /^Yes\b/);
    const giselle = await H.turn(state, "Giselle is it your first expedition");
    assert.match(giselle.spoken[0].text, /^Yes\b/);
  } finally { H.cleanup(state); }
});

test("A7 F3/F4 — never 'yes' to splitting up; a reply that does not answer leaves the question open", async () => {
  const state = H.setup("ed30-f3", H.garbage());
  try {
    for (const q of ["Are we splitting up?", "Are we all going together or splitting up?"]) {
      const t = await H.turn(state, q);
      assert.ok(answerOf(t.plan()).asks_split, q);
      assert.doesNotMatch(t.spoken[0].text, /^(?:Yes|As far as I know, yes)\b/, q);
    }
    // L6: a social reply to a facet question satisfies nothing.
    const req = S.openRequest(state.run, { predicate: "person.complex_experience", fn: "ask_predicate", request_text: "Have you been in?", targets: [state.id("Malcolm")], cardinality: "each_self" });
    S.recordSatisfaction(state.run, req.request_id, { responder_id: state.id("Malcolm"), response_event_id: "x", verdict: "social" });
    assert.equal(S.findRequest(state.run, req.request_id).state, "OPEN");
    const told = await H.turn(state, "Tell me whether you've been in the Complex before, Malcolm.");
    assert.equal(told.predicate, "person.complex_experience");
  } finally { H.cleanup(state); }
});

test("A7 F10 — an unanchored 'there' asks; a topic nobody reported is 'can't tell', never 'didn't say'", async () => {
  const state = H.setup("ed30-f10", H.garbage());
  try {
    const there = await H.turn(state, "Tonya, have you been there before?");
    assert.equal(there.plan().may_ask_clarifying_question, true);
    const topic = await H.turn(state, "Did Maxwell say anything about splitting up?");
    assert.match(topic.spoken[0].text, /couldn't tell you what/i);
    assert.doesNotMatch(topic.spoken[0].text, /didn't (?:say|mention)|said nothing/i);
  } finally { H.cleanup(state); }
});

test("A7 F11 — understanding gaps closed: unpunctuated coordination, indirect 'what time', delivery, third-party familiarity, 'meant to ask', 'what about earlier', 'you and X'", async () => {
  const state = H.setup("ed30-f11", H.garbage());
  try {
    const two = await H.turn(state, "Malcolm how long have you worked here and have you been on an expedition");
    assert.deepEqual(two.turnRecord.request_ids.map((id) => S.findRequest(state.run, id).predicate).sort(), ["person.async_tenure", "person.expedition_experience"]);
    assert.equal((await H.turn(state, "Do you know what time we leave?")).predicate, "mission.schedule");
    assert.equal((await H.turn(state, "Where are we delivering the materials?")).predicate, "item.destination");
    const fam = await H.turn(state, "Giselle, does Tonya know Malcolm?");
    assert.ok(answerOf(fam.plan()).answer.third_party);
    assert.match(fam.spoken[0].text, /ask Tonya/);
    await H.turn(state, "Giselle, are you nervous?");
    const meant = await H.turn(state, "Wait, sorry, I meant to ask Malcolm that.");
    assert.deepEqual(meant.owners, [state.id("Malcolm")]);
    assert.equal(meant.predicate, "person.nervousness");
    const earlier = await H.turn(state, "what about earlier");
    assert.equal(earlier.frame.turn.temporal_scope, "earlier");
    assert.doesNotMatch(earlier.spoken[0].text, /^Like I said/);
    const both = await H.turn(state, "Giselle, have you and Tonya been in the Complex?");
    assert.deepEqual(both.owners.sort(), [state.id("Giselle"), state.id("Tonya")].sort());
  } finally { H.cleanup(state); }
});

test("A7 re-review N3/N4/N5 + residuals — counts, per-question addressees, no repair of real words, pair-specific acquaintance, negative questions", async () => {
  const state = H.setup("ed30-n", H.garbage());
  try {
    await H.turn(state, "Tonya, have you been in the Complex?");
    const count = await H.turn(state, "How many times?");
    assert.equal(answerOf(count.plan()).value, "not_established");
    assert.ok(answerOf(count.plan()).answer.count_asked);
    assert.match(count.spoken[0].text, /how many/i);
    const two = await H.turn(state, "Malcolm, is it your first day? And Tonya, are you tired?");
    assert.deepEqual(two.spoken.map((e) => e.speaker_id), [state.id("Malcolm"), state.id("Tonya")], "each answers their own question, in order");
    const staying = await H.turn(state, "Giselle, how long are you staying?");
    assert.ok(!staying.turnRecord.repairs_applied.some((r) => /staying>staging/.test(r)));
    await H.turn(state, "Does Tonya know Maxwell?");
    const other = await H.turn(state, "Giselle, does Tonya know Malcolm?");
    assert.ok(answerOf(other.plan()).answer?.third_party, "a report about Maxwell says nothing about Malcolm");
    const neg = await H.turn(state, "Are we not going together?");
    assert.doesNotMatch(neg.spoken[0].text, /^Yes\b/);
  } finally { H.cleanup(state); }
});
