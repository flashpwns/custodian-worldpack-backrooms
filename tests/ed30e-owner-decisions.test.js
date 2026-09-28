"use strict";

// ED-30 E — the owner's decisions of 2026-09-27, pinned through the production service:
//   1. follow-up routing: a genuine semantic follow-up inherits its responder; only fresh shared questions rotate
//   2. remarks / sarcasm: no response required; silence is normal (an authored policy may pick one short ack)
//   3. the veteran's prior Complex experience is SOME, with no count, history or event
//   4. "there" is a place only when the exchange made one active; otherwise clarify
//   5. coworker genders are not established
//   6. an unsettled place history is answered with bounded wording ("I couldn't say for sure.")

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const T = require("../tools/dialogue-turn");
const V = require("../tools/dialogue-validation");

const answerOf = (plan) => plan?.required_facts?.find((f) => f.key === "predicate_answer")?.value ?? null;

test("1 follow-up routing — explicit > repair > antecedent owner > activity > knower > rotation", async () => {
  const state = H.setup("ed30e-routing", H.garbage());
  try {
    const holder = await H.turn(state, "Who has the startup materials?");
    assert.equal(holder.fn, "ask_item_ownership", "the item named by its label is an ownership question");
    assert.deepEqual(holder.ownerNames, ["Malcolm"]);
    // An anaphor picks up that reply: its speaker answers, however recently they spoke.
    const contents = await H.turn(state, "What's in it?");
    assert.deepEqual(contents.ownerNames, ["Malcolm"], "a follow-up is not rotated for fairness");
    assert.equal(contents.turnRecord.primary.addressee.source, "antecedent_owner");
    // A fresh shared question rotates away from the one who just spoke.
    const next = await H.turn(state, "What's next?");
    assert.equal(next.owners.length, 1);
    assert.notDeepEqual(next.ownerNames, ["Malcolm"], "a fresh untargeted question rotates");
    // A thing the reply named, asked about next, stays with that speaker.
    const spoke = next.ownerNames[0];
    const staging = await H.turn(state, "Where is Equipment Staging?");
    assert.deepEqual(staging.ownerNames, [spoke]);
    // An explicit addressee always wins.
    assert.deepEqual((await H.turn(state, "Tonya, what's in the duffle?")).ownerNames, ["Tonya"]);
    // A repair target outranks the antecedent owner.
    const repaired = await H.turn(state, "No, I was asking Malcolm.");
    assert.deepEqual(repaired.ownerNames, ["Malcolm"]);
  } finally { H.cleanup(state); }
});

test("1 follow-up routing — pure analysis: anaphor / fragment / reply-named thing inherit; dummy 'it' and fresh questions do not", () => {
  const present = [{ id: "g", name: "Giselle", names: ["Giselle"] }, { id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
  const dis = { active_speaker: { speaker_id: "m", speaker_ids: ["m"] }, last_request: { request_id: "r1", predicate: "item.holder", request_text: "Who has the duffle?", targets: [], answered_by: ["m"] }, salient_names: ["outpost a"] };
  const to = (raw) => { const a = T.analyzeTurn({ raw, present, entities: [], dis }).primary.addressee; return `${a.kind}:${a.ids.join("+")}`; };
  for (const raw of ["What's in it?", "is that heavy", "Since when?", "How far is Outpost A?", "which one"]) assert.equal(to(raw), "inherited:m", raw);
  for (const raw of ["What time is it?", "What's next?", "Where are we going?", "Is it just me or is it cold?"]) assert.equal(to(raw), "untargeted:", raw);
  // Several people just answered: no single antecedent owner, nothing is guessed.
  assert.equal(T.analyzeTurn({ raw: "What's in it?", present, entities: [], dis: { ...dis, active_speaker: { speaker_id: "m", speaker_ids: ["m", "t"] } } }).primary.addressee.kind, "untargeted");
});

test("2 remarks and sarcasm — no response required; silence is normal; a named remark gets its addressee's short ack", async () => {
  const state = H.setup("ed30e-remarks", H.garbage());
  try {
    for (const remark of ["Well, this seems incredibly safe.", "You guys, love how nobody explains anything.", "The paint in here is beige.", "Oh great, a mystery duffle."]) {
      const r = await H.turn(state, remark);
      assert.deepEqual(r.lines, [], `${remark} -> silence`);
    }
    const named = await H.turn(state, "Malcolm, this room gives me the creeps.");
    assert.deepEqual(named.speakers.map((s) => s.split(" ")[0]), ["Malcolm"], "one short acknowledgment from the one addressed");
    assert.equal(named.lines.length, 1);
    // Frame cardinality: a remark requires nothing.
    const present = [{ id: "g", name: "Giselle", names: ["Giselle"] }];
    assert.equal(T.analyzeTurn({ raw: "what could possibly go wrong lol", present, entities: [], dis: null }).primary.cardinality, "none");
  } finally { H.cleanup(state); }
});

test("3 the veteran's prior Complex experience is SOME — no count, no expedition history, no event", async () => {
  const state = H.setup("ed30e-tonya", H.garbage());
  try {
    const asked = await H.turn(state, "Tonya, have you been in the Complex before?");
    const profile = require("../tools/dialogue-personhood").profileOf(state.run, state.id("Tonya"));
    assert.equal(profile.complex_experience, "some");
    assert.equal(profile.archetype, "doctor-veteran");
    assert.equal(answerOf(asked.plan(state.id("Tonya"))).value, "yes");
    const count = await H.turn(state, "How many times?");
    assert.equal(answerOf(count.plan(state.id("Tonya"))).value, "not_established", "no count is established");
    // The validator refuses an invented count or a dated/specific prior event for her.
    const plan = count.plan(state.id("Tonya"));
    const yesPlan = asked.plan(state.id("Tonya"));
    for (const bad of ["Three times.", "I've been in twice before.", "Yes, a few years ago.", "Yes, back when I was at the other site."]) assert.equal(V.validateContribution(yesPlan, bad, { speaker_name: "Tonya" }).ok, false, bad);
    assert.equal(V.validateContribution(yesPlan, "Yes, I've been in before.", { speaker_name: "Tonya" }).ok, true);
    assert.equal(V.validateContribution(plan, "Four times.", { speaker_name: "Tonya" }).ok, false, "a count question is not licence for a number");
  } finally { H.cleanup(state); }
});

test("4 'there' — the Complex only with an active place antecedent; otherwise clarify", async () => {
  const cold = H.setup("ed30e-there-cold", H.garbage());
  try {
    const first = await H.turn(cold, "Have you been there before?");
    assert.equal(first.fn, "ambiguous_reference", "nothing anchors 'there' at the start");
    assert.equal(first.owners.length, 1);
    assert.match(first.lines[0], /where do you mean/i);
    // A conversation that is not about a place does not anchor it either.
    await H.turn(cold, "Giselle, how are you doing?");
    assert.equal((await H.turn(cold, "Have you been there before?")).fn, "ambiguous_reference");
  } finally { H.cleanup(cold); }
  const warm = H.setup("ed30e-there-warm", H.garbage());
  try {
    await H.turn(warm, "Tonya, are you nervous about going into the Complex?");
    const there = await H.turn(warm, "Have you been there before?");
    assert.equal(there.predicate, "person.complex_experience");
    assert.equal(there.frame.turn.args.place_id, "complex", "the player's own question made the Complex active");
    // A place named earlier in the same line is active too.
    const same = await H.turn(warm, "What about Outpost A? Been there?");
    assert.equal(same.frame.turn.args.place_id, "outpost-a");
  } finally { H.cleanup(warm); }
});

test("5 genders are not established — gendered pronouns for a coworker are rejected", () => {
  const people = [{ id: "t", name: "Tonya" }, { id: "m", name: "Malcolm" }];
  const plan = { discourse_function: "ask_reported_speech", required_facts: [{ key: "reported_speech", value: { speaker_name: "Tonya", claims: [{ speaker_id: "t", speaker_name: "Tonya", epistemic: "heard", reported: "they have been in the Complex before" }] } }], optional_facts: [] };
  const say = (text) => V.validateContribution(plan, text, { people, speaker_id: "m", speaker_name: "Malcolm" });
  for (const line of ["Tonya said she has been in the Complex before.", "Tonya said he has been in the Complex before."]) assert.equal(say(line).ok, false, line);
  assert.equal(say("Tonya said they have been in the Complex before.").ok, true);
});

test("6 an unsettled place history keeps bounded wording — 'I couldn't say for sure.'", async () => {
  const state = H.setup("ed30e-place", H.garbage());
  try {
    const r = await H.turn(state, "Tonya, have you been to Outpost A before?");
    assert.deepEqual(r.lines.map((l) => l.replace(/^[^:]+: /, "")), ["I couldn't say for sure."]);
  } finally { H.cleanup(state); }
});
