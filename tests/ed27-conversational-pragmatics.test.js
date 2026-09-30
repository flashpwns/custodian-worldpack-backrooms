"use strict";

// ED-27 — conversational pragmatics convergence. Deterministic regressions for the human Electron trace:
// explicit addressee SETS, name mention vs address, active-thread inheritance, earlier wording (quotes,
// one's own lines), typed open questions and fragment answers, recent conversational events, silence
// semantics (simulation reason vs character-knowable reason), cold reload, provider independence and the
// developer trace. Every case runs over semantic classes with roster names taken from the seeded team --
// no repro string is special-cased.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const I = require("../tools/dialogue-interpretation");
const F = require("../tools/dialogue-fallback");
const V = require("../tools/dialogue-validation");
const { renderContributionTask } = require("../tools/dialogue-prompt-contract");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { DesktopService } = require("../desktop/service");

// ─── harness (production service path) ───────────────────────────────────────────────────────────
function setup(seed, provider = null, { offline = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed27-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  if (offline) service.updateSettings({ provider: "offline" });
  const worldId = service.createWorld({ name: "ED27", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Gooby", last_name: "Gooberson" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  return attach({ root, service, worldId, logs: [] });
}
function attach(state) {
  state.service.log = (line) => state.logs.push(String(line));
  Object.defineProperty(state, "run", { configurable: true, get: () => state.service.session(state.worldId, "field-researcher").run });
  state.playerId = state.run.session.startup.player.observer_id;
  state.team = state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  state.ids = state.team.map((m) => m.personnel_id ?? m.id);
  state.names = state.team.map((m) => m.first_name);
  return state;
}
function reopen(state, provider = garbage()) {
  state.service.shutdown?.();
  const service = new DesktopService({ appDataPath: state.root, localDialogueProvider: provider, developerMode: true });
  assert.equal(service.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
  return attach({ root: state.root, service, worldId: state.worldId, logs: [] });
}
const cleanup = (state) => { state.service.shutdown?.(); fs.rmSync(state.root, { recursive: true, force: true }); };
let counter = 0;
async function turn(state, text, extra = {}) {
  const id = extra.request_id ?? `p-${++counter}`;
  state.logs.length = 0;
  const result = await state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: id, ...extra });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const spoken = run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId);
  const interaction = run.expedition.interaction_history.find((i) => i.submission_id === id) ?? null;
  const traceLine = state.logs.find((line) => line.startsWith("[YB:DISCOURSE_TRACE]"));
  return { id, result, contexts, spoken, interaction, address: interaction?.address ?? null, frame: contexts[0]?.semantic_frame ?? null, fn: contexts[0]?.semantic_frame.discourse_function ?? null, owners: contexts.map((c) => c.target_worker_id), plan: (who) => contexts.find((c) => c.target_worker_id === who)?.response_plan ?? null, trace: traceLine ? JSON.parse(traceLine.slice("[YB:DISCOURSE_TRACE] ".length)) : null };
}
function scriptedLocal(responder) {
  const fetchImpl = (url, options) => Promise.resolve(responder(JSON.parse(options.body))).then((out) => {
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => ({ id: "t", choices: [{ message: { content: out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ speech: out }) } }] }) };
  });
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:8734", fetchImpl, timeout: 300 });
  return { name: "local", model: real.model, presentLocal: (packet) => real.presentLocal(packet) };
}
const garbage = () => scriptedLocal(() => ({ raw: "{bad" }));
const throwing = () => scriptedLocal(() => new Error("provider crashed"));
const fact = (plan, key) => plan?.required_facts?.find((f) => f.key === key)?.value ?? null;

// ─── A. explicit addressee sets ──────────────────────────────────────────────────────────────────
const NAMES = [{ name: "Ava", id: "c-ava" }, { name: "Josephine", id: "c-jo" }, { name: "Roy", id: "c-roy" }, { name: "Elizabeth", id: "c-el" }];
test("A — addressee sets come from sentence structure: single, subset, group, trailing vocative, @mentions", () => {
  const cases = [
    ["Hello Ava.", "direct", ["c-ava"], "greeting"],
    ["Hello Ava and Josephine", "subset", ["c-ava", "c-jo"], "greeting"],
    ["hello ava and josephine", "subset", ["c-ava", "c-jo"], "greeting"],
    ["Good morning, Ava, Josephine!", "subset", ["c-ava", "c-jo"], "greeting"],
    ["Ava, Josephine, you ready?", "subset", ["c-ava", "c-jo"], "leading_vocative"],
    ["Ava and Josephine, come here.", "subset", ["c-ava", "c-jo"], "leading_vocative"],
    ["Roy, what do you think?", "direct", ["c-roy"], "leading_vocative"],
    ["What do you think, Roy?", "direct", ["c-roy"], "trailing_vocative"],
    ["Mind telling me a little bit about yourself, Elizabeth?", "direct", ["c-el"], "trailing_vocative"],
    ["@Ava @Josephine hi", "subset", ["c-ava", "c-jo"], "mention"],
    ["Hey guys.", "group", [], "greeting"]
  ];
  for (const [text, type, ids, form] of cases) {
    const parsed = I.parseAddressees(text, { names: NAMES });
    assert.equal(parsed.address_type, type, text);
    assert.deepEqual(parsed.addressee_ids, ids, text);
    assert.equal(parsed.address_form, form, text);
  }
  // Group language: plural address phrases anywhere; a bare group noun only as an address.
  assert.equal(I.inferLocalRecipientType("Everybody ready?"), "group");
  assert.equal(I.inferLocalRecipientType("Hey team, ready?"), "group");
  for (const text of ["By the table.", "Is that all?", "The team is here.", "I put it on the table."]) assert.equal(I.inferLocalRecipientType(text), "none", text);
  // A selected target widens to a spoken set only when the set names it.
  assert.equal(I.parseAddressees("Hello Ava and Josephine", { names: NAMES, explicit_target: "Ava" }).address_type, "subset");
  assert.equal(I.parseAddressees("Hello Roy and Josephine", { names: NAMES, explicit_target: "Ava" }).address_type, "direct");
});

test("A — 'Hello <A> and <B>' through the service: both named coworkers answer, nobody else, no model choice", async () => {
  const state = setup("ed27-a", garbage());
  try {
    const [, b, c] = state.names;
    const t = await turn(state, `Hello ${b} and ${c}`);
    assert.equal(t.fn, "greet");
    assert.equal(t.address.scope, "subset");
    assert.deepEqual(t.address.addressee_ids, [state.ids[1], state.ids[2]]);
    assert.equal(t.address.form, "greeting");
    assert.deepEqual(t.owners, [state.ids[1], state.ids[2]], "exactly the named set, in the order named");
    assert.ok(!t.owners.includes(state.ids[0]), "an unnamed coworker does not answer");
    assert.deepEqual(t.spoken.map((e) => e.speaker_id), [state.ids[1], state.ids[2]]);
    for (const context of t.contexts) assert.doesNotMatch(JSON.stringify(context.authorized_contribution), /yb-personnel|addressee_ids/, "the model sees no addressee selection");
    // Individual questions to the set: each addressee answers for themselves.
    const ready = await turn(state, `${b}, ${c}, you ready?`);
    assert.equal(ready.address.scope, "subset");
    assert.deepEqual(ready.owners, [state.ids[1], state.ids[2]]);
    assert.equal(ready.frame.addressee_state, true);
    // The interaction record keeps the named set (renderer shows "-> B, C", not the assembly table).
    const projected = require("../tools/q4-interactions").publicEntry(t.interaction);
    assert.equal(projected.address_scope, "subset");
  } finally { cleanup(state); }
});

// ─── B. mention is not address ───────────────────────────────────────────────────────────────────
test("B — a name mentioned about someone is not an address to them", async () => {
  const state = setup("ed27-b", garbage());
  try {
    const [a, b] = state.names;
    const t = await turn(state, `${a} told me ${b} has the camera.`);
    assert.equal(t.address.scope, "untargeted");
    assert.deepEqual(t.address.addressee_ids, []);
    assert.equal(t.interaction.recipient_type, "none");
    assert.equal(I.parseAddressees("Ava told me Josephine has the camera.", { names: NAMES }).address_type, "none");
  } finally { cleanup(state); }
});

// ─── C. active thread ────────────────────────────────────────────────────────────────────────────
test("C — a direct exchange stays the active thread; 'Why?' and second-person lines inherit it; group language and new names end it", async () => {
  const state = setup("ed27-c", garbage());
  try {
    const [a, b] = state.names;
    const hello = await turn(state, "hello?", { target: a });
    assert.equal(hello.address.scope, "direct");
    assert.equal(hello.address.form, "chip");
    assert.deepEqual(hello.owners, [state.ids[0]]);
    const why = await turn(state, "Why?");
    assert.equal(why.interaction.recipient_type, "direct", "'Why?' after a direct exchange is not room speech");
    assert.equal(why.address.form, "inherited");
    assert.deepEqual(why.owners, [state.ids[0]]);
    assert.equal(why.fn, "ask_explanation");
    assert.deepEqual(why.frame.antecedent.responder_ids, [state.ids[0]], "attached to her immediately prior contribution");
    const you = await turn(state, "Why wouldn't you say anything to me until I addressed you directly?");
    assert.equal(you.address.scope, "direct");
    assert.deepEqual(you.address.addressee_ids, [state.ids[0]], "second person inherits the active interlocutor");
    assert.equal(you.fn, "ask_response_event");
    // Group language outranks the thread; a new explicit name replaces it.
    const group = await turn(state, "Does anyone know where the radio is?");
    assert.equal(group.address.scope, "group");
    const other = await turn(state, `${b}, you okay?`);
    assert.deepEqual(other.address.addressee_ids, [state.ids[1]]);
    // A line that addresses no one and refers to nothing stays room speech.
    const room = await turn(state, "The lights are loud today.");
    assert.equal(room.address.scope, "untargeted");
  } finally { cleanup(state); }
});

test("C — a set exchange: 'Why?' keeps the set; a singular 'you' goes to the one who answered", () => {
  const discourse = { last_turn: { kind: "player_exchange", responder_ids: ["c-jo"], recipient_type: "group", recipient_ids: ["c-ava", "c-jo"] }, active_thread: { kind: "subset", member_ids: ["c-ava", "c-jo"], responder_ids: ["c-jo"] } };
  const present = ["c-ava", "c-jo", "c-roy"];
  const why = D.resolveRecipientScope({ text: "Why?", discourse, present_ids: present });
  assert.deepEqual([why.recipient_type, why.recipient_ids, why.address_scope], ["group", ["c-ava", "c-jo"], "subset"]);
  const singular = D.resolveRecipientScope({ text: "Are you sure you're okay?", discourse, present_ids: present });
  assert.deepEqual([singular.recipient_type, singular.recipient_ids], ["direct", ["c-jo"]]);
  // No thread: room speech; a report is not a thread for a second-person line.
  assert.equal(D.resolveRecipientScope({ text: "Are you okay?", discourse: { last_turn: null, active_thread: null }, present_ids: present }).recipient_type, "none");
  assert.equal(D.resolveRecipientScope({ text: "Are you okay?", discourse: { last_turn: { kind: "autonomous_report", responder_ids: ["c-roy"] }, active_thread: { kind: "report", member_ids: ["c-roy"], responder_ids: ["c-roy"] } }, present_ids: present }).recipient_type, "none");
});

// ─── D/E. earlier wording and one's own speech ───────────────────────────────────────────────────
test("D/E — a quoted phrase resolves to the speaker's prior line and to the authorized fact it came from", async () => {
  const packets = [];
  const provider = { name: "local", model: "m", async presentLocal(packet) { packets.push(packet); return { speech: "{bad" }; } };
  const state = setup("ed27-d", provider);
  try {
    const [a] = state.names;
    const intro = await turn(state, `Mind telling me a little bit about yourself, ${a}?`);
    assert.equal(intro.address.form, "trailing_vocative");
    assert.deepEqual(intro.owners, [state.ids[0]]);
    const line = intro.spoken[0].text;
    const assignment = fact(intro.plan(state.ids[0]), "current_assignment");
    assert.ok(assignment && line.toLowerCase().includes(assignment.toLowerCase()), "the fallback worded the assignment");
    // Quote a sub-span of HER wording (the last three words of the assignment phrase).
    const span = assignment.split(/\s+/).slice(-3).join(" ");
    const asked = await turn(state, `what do you mean by "${span}?"`);
    assert.equal(asked.fn, "ask_meaning", "not a generic factual question");
    assert.equal(asked.frame.antecedent.type, "prior_utterance");
    assert.equal(asked.frame.antecedent.resolved, true);
    assert.equal(asked.frame.utterance_reference.match, "exact");
    assert.equal(asked.frame.utterance_reference.speaker_id, state.ids[0]);
    assert.deepEqual(asked.owners, [state.ids[0]], "the one who said it explains it");
    const meaning = fact(asked.plan(state.ids[0]), "utterance_meaning");
    assert.equal(meaning.own, true);
    assert.equal(meaning.match, "unique");
    assert.equal(meaning.meaning.key, "current_assignment");
    assert.ok(meaning.meaning.semantics?.phrase, "the fact's structured meaning, not its wording");
    assert.ok(!asked.plan(state.ids[0]).required_facts.some((f) => f.key === "uncertainty"), "never 'I don't know' about one's own words");
    // E: the model receives her own prior line as the line in question, with the fact it came from.
    const packet = packets.filter((p) => p.authorized_contribution?.discourse_function === "ask_meaning").at(-1);
    assert.equal(packet.context_capsule.repair_target.is_self, true);
    assert.equal(packet.context_capsule.repair_target.text, line);
    const prompt = renderContributionTask(packet);
    assert.match(prompt, /Your earlier line/);
    assert.doesNotMatch(prompt, /yb-personnel/);
    // Someone else asked about HER line points back to her (never interprets it).
    const [, b] = state.names;
    const other = await turn(state, `${b}, what did ${a} mean by "${span}"?`);
    assert.equal(other.fn, "ask_meaning");
    assert.deepEqual(other.owners, [state.ids[1]]);
    assert.equal(fact(other.plan(state.ids[1]), "utterance_meaning").own, false);
    assert.match(other.spoken[0].text, new RegExp(a));
  } finally { cleanup(state); }
});

test("D — the literal trace line: 'staying with' resolves to the recorded fact, never to an unknown fact", () => {
  const line = "I am Elizabeth; I work as a field researcher and am staying with the expedition lead.";
  const facts = { discourse_function: "invite_self_description", required: [{ key: "name", value: "Elizabeth" }, { key: "role", value: "field researcher" }, { key: "current_assignment", value: "staying with the expedition lead" }], optional: [], semantics: null };
  const discourse = { turns: [], last_turn: null, utterance_log: [{ interaction_id: "i1", speaker_id: "c-el", speaker_name: "Elizabeth", is_player: false, text: line, basis: { kind: "assignment" }, facts, listener_ids: ["P"] }] };
  const frame = D.buildSemanticFrame({ text: 'what do you mean by "staying with?"', recipient_type: "direct", discourse, addressee_ids: ["c-el"] });
  assert.equal(frame.discourse_function, "ask_meaning");
  assert.equal(frame.antecedent.type, "prior_utterance");
  assert.equal(frame.antecedent.resolved, true);
  const [plan] = D.planResponses({ frame, owner_ids: ["c-el"], responders: { "c-el": { self: D.buildSelfKnowledge({ person: { first_name: "Elizabeth" } }) } } });
  const meaning = fact(plan, "utterance_meaning");
  assert.equal(meaning.meaning.key, "current_assignment", "the quoted words map onto the one authorized fact they came from");
  assert.equal(plan.may_ask_clarifying_question, false);
  // A span matching two facts is clarified, never guessed; a span matching none is only wording.
  assert.equal(D.matchSpanToFacts("field", { required: [{ key: "role", value: "field researcher" }, { key: "current_assignment", value: "field survey" }] }).status, "ambiguous");
  assert.equal(D.matchSpanToFacts("gosh", facts).status, "wording_only");
  // Words the player never heard are never searched.
  const unheard = D.buildSemanticFrame({ text: 'What did you mean by "secret plan"?', discourse, addressee_ids: ["c-el"] });
  assert.equal(unheard.antecedent.resolved, false);
  assert.equal(unheard.unresolved_reference, true);
});

// ─── Part 7: current assignment semantics ────────────────────────────────────────────────────────
test("assignment — the default follow posture never masks the assigned task; the follow phrase is literal", () => {
  const P = "P";
  assert.equal(D.presentAssignment({ task: { type: "follow", state: "active", target: P }, primary_task: "verbal-recall", player_id: P }), "handling observation and verbal recall");
  const ordered = D.assignmentSemantics({ task: { type: "follow", state: "active", target: P, order_id: "o-1" }, primary_task: "verbal-recall", player_id: P });
  assert.deepEqual([ordered.source, ordered.task_type, ordered.phrase], ["order", "follow", "following you"]);
  assert.match(ordered.gloss, /moving with you/);
  const self = D.buildSelfKnowledge({ person: { first_name: "Ava", primary_task: "verbal-recall" }, task: { type: "follow", state: "active", target: P }, player_id: P });
  assert.equal(self.current_assignment, "handling observation and verbal recall");
  assert.equal(self.assignment_semantics.source, "assigned_task");
  // Wording may not turn an assignment into living arrangements.
  const contribution = { discourse_function: "ask_meaning", required_facts: [{ key: "utterance_meaning", value: { line: "I'm following you.", quoted: "following", own: true, match: "unique", meaning: { key: "current_assignment", value: "following you", semantics: ordered } } }], optional_facts: [], forbidden_claims: [], may_ask_clarifying_question: false };
  assert.equal(V.validateContribution(contribution, "I mean I'm following you: moving with you and keeping in contact with you.").ok, true);
  assert.equal(V.validateContribution(contribution, "I mean I'm living with you, following you around.").ok, false);
});

// ─── F/G. open temporal slot and event anchors ───────────────────────────────────────────────────
test("F/G — 'When do you mean?' opens a temporal slot; 'Just now.' and 'When I greeted <B> and <C>.' fill it", async () => {
  const state = setup("ed27-f", garbage());
  try {
    const [a, b, c] = state.names;
    await turn(state, `Hello ${b} and ${c}`);
    const asked = await turn(state, `${b}, why didn't you answer me when I asked about the radio?`);
    assert.equal(asked.fn, "ask_response_event");
    assert.equal(asked.plan(state.ids[1]).may_ask_clarifying_question, true);
    assert.equal(asked.plan(state.ids[1]).expected_slot, "temporal");
    assert.match(asked.spoken[0].text, /when/i);
    // G: the answer names the event; it resolves to that exchange (unique), in which B DID answer.
    const when = await turn(state, `When I greeted ${b} and ${c}.`);
    assert.equal(when.address.source, "open_question_answer");
    assert.deepEqual(when.owners, [state.ids[1]]);
    assert.equal(when.fn, "ask_response_event", "the fragment resumes the original question");
    assert.equal(when.frame.slot_answer.slot, "temporal");
    assert.ok(when.frame.resumed_question);
    const event = fact(when.plan(state.ids[1]), "conversation_event");
    assert.equal(event.responded, true, "B did answer that greeting");
    assert.match(when.spoken[0].text, /did answer/i);
    // F: "Just now." with a real non-response to find.
    await turn(state, "The lights are loud today.");
    await turn(state, "hello?", { target: a });
    const again = await turn(state, "Why didn't you answer me when I asked about the radio?");
    assert.equal(again.plan(state.ids[0]).expected_slot, "temporal");
    const now = await turn(state, "Just now.");
    assert.equal(now.fn, "ask_response_event");
    assert.equal(now.frame.slot_answer.slot, "temporal");
    const silent = fact(now.plan(state.ids[0]), "conversation_event");
    assert.equal(silent.responded, false);
    assert.equal(silent.reason, "no_character_reason", "room speech that drew no reply: no character-level reason exists");
    assert.doesNotMatch(now.spoken[0].text, /because|didn't realize|thought|nervous|busy/i);
  } finally { cleanup(state); }
});

// ─── H/I/J. entity, location and reason slots ────────────────────────────────────────────────────
test("H/I — 'Which thing?' -> 'The camera.' resumes the question; 'Where?' -> 'By the table.' is an answer, not a group address", async () => {
  const state = setup("ed27-h", garbage());
  try {
    const which = await turn(state, "Who has the thing?");
    assert.equal(which.plan(which.owners[0]).expected_slot, "referent");
    const camera = await turn(state, "The camera.");
    assert.equal(camera.fn, "ask_item_ownership");
    assert.ok(camera.frame.resumed_question);
    assert.deepEqual(camera.owners, which.owners, "the one who asked answers");
    const where = await turn(state, "I left it over there.");
    assert.equal(where.plan(where.owners[0]).expected_slot, "location");
    assert.match(where.spoken[0].text, /where/i);
    const table = await turn(state, "By the table.");
    assert.equal(table.interaction.recipient_type, "direct", "'table' is not a group address here");
    assert.equal(table.address.source, "open_question_answer");
    assert.deepEqual(table.owners, where.owners);
    assert.equal(table.frame.slot_answer.slot, "location");
    assert.match(table.frame.resolved_utterance, /^I left it by the table$/i);
  } finally { cleanup(state); }
});

test("J — 'Why?' -> 'Because I saw it.': the reason slot is filled with the player's CLAIM, never canonical truth", () => {
  const pending = { question_id: "i4:clarification", discourse_function: "make_statement", player_text: "We should go left.", interaction_id: "i4", responder_ids: ["c-ava"], asker_ids: ["c-ava"], expected_slot: "reason" };
  const discourse = { pending_question: pending, turns: [], last_turn: { kind: "player_exchange", responder_ids: ["c-ava"], responses: [] } };
  assert.equal(D.matchOpenQuestionSlot("Because I saw it.", pending, { discourse }).slot, "reason");
  assert.equal(D.matchOpenQuestionSlot("Who has the radio?", pending, { discourse }), null, "a new question is not an answer");
  const frame = D.buildSemanticFrame({ text: "Because I saw it.", discourse });
  assert.equal(frame.slot_answer.slot, "reason");
  assert.deepEqual(frame.resumed_question.responder_ids, ["c-ava"]);
  const [plan] = D.planResponses({ frame, owner_ids: ["c-ava"], responders: { "c-ava": { self: D.buildSelfKnowledge({ person: { first_name: "Ava" } }) } } });
  assert.deepEqual(fact(plan, "stated_reason"), { text: "Because I saw it.", status: "player_claim" });
  assert.equal(I.resolveResponseOwners({ recipient_type: "none", interpretation: I.interpretUtterance("Because I saw it."), player_text: "Because I saw it.", candidates: [{ id: "c-roy", response_eligible: true }, { id: "c-ava", response_eligible: true }], frame }).join(), "c-ava");
  // Every slot class has a clarification wording and a recognizer.
  for (const slot of D.EXPECTED_SLOTS) assert.ok(F.CLARIFY_BY_SLOT[slot], slot);
  assert.equal(D.matchOpenQuestionSlot("Yes.", { ...pending, expected_slot: "yes_no" }, {}).polarity, "yes");
  assert.equal(D.matchOpenQuestionSlot("Roy.", { ...pending, expected_slot: "person" }, { people: [{ id: "c-roy", name: "Roy" }] }).person_id, "c-roy");
});

// ─── Part 10/11: conversational events and silence semantics ─────────────────────────────────────
test("silence — simulation reasons are distinguished; only a character-knowable reason reaches speech", () => {
  const address = { scope: "subset", addressee_ids: ["c-ava", "c-jo"] };
  assert.equal(D.characterSilenceReason("not_a_listener"), "did_not_hear");
  assert.equal(D.characterSilenceReason("response_policy_selected_other"), "another_answered");
  for (const basis of ["room_speech_no_response", "not_selected_no_response", "reply_not_delivered"]) assert.equal(D.characterSilenceReason(basis), "no_character_reason", `${basis} never becomes a motive`);
  // Derivation over canonical records: not a listener / someone else answered / provider failure.
  const state = D.deriveDiscourseState({
    player_id: "P", location_id: "room",
    interaction_history: [
      { id: "i1", channel: "local", speaker_id: "P", source: "player", player_text: "Hello Ava and Josephine", recipient_type: "group", recipient_ids: ["c-ava", "c-jo"], listeners: ["c-ava"], response_owners: [{ speaker_id: "c-ava" }], location_id: "room", submission_id: "s1", delivery: "heard", address },
      { id: "i2", channel: "local", speaker_id: "P", source: "player", player_text: "Anyone?", recipient_type: "group", recipient_ids: ["c-ava", "c-jo"], listeners: ["c-ava", "c-jo"], response_owners: [{ speaker_id: "c-jo" }], location_id: "room", submission_id: "s2", delivery: "heard" }
    ],
    dialogue_history: [
      { id: "d1", submission_id: "s1", speaker_id: "P", kind: "speech", text: "Hello Ava and Josephine", interval: 1 },
      { id: "d2", submission_id: "s1", speaker_id: "c-ava", speaker_name: "Ava", kind: "speech", text: "Hey.", interval: 1, listeners: ["P"] }
    ]
  });
  const [first, second] = state.event_log;
  assert.equal(first.silence["c-jo"], "not_a_listener");
  assert.equal(second.silence["c-ava"], "response_policy_selected_other");
  assert.equal(second.silence["c-jo"], "reply_not_delivered", "an owner whose reply never committed is a failure, not canonical silence");
  // Validation: invented motives, false answers and false deafness are rejected.
  const event = (value) => ({ discourse_function: "ask_response_event", required_facts: [{ key: "conversation_event", value }], optional_facts: [], forbidden_claims: ["invented_rationale", "invented_motive"], may_ask_clarifying_question: false });
  const none = event({ player_line: "Hi.", addressed: "you", heard: true, responded: false, own_reply: null, others_responded: [], reason: "no_character_reason" });
  assert.equal(V.validateContribution(none, "You're right, I didn't answer. Sorry about that.").ok, true);
  for (const bad of ["Sorry, I didn't realize you were talking to me.", "I was nervous.", "I thought you meant Roy.", "Sorry, I didn't hear you.", "I did answer you."]) assert.equal(V.validateContribution(none, bad).ok, false, bad);
  const other = event({ player_line: "Hi.", addressed: "you_and_others", heard: true, responded: false, own_reply: null, others_responded: ["Josephine"], reason: "another_answered" });
  assert.equal(V.validateContribution(other, "Josephine answered you then.").ok, true);
  assert.equal(F.presentConversationEvent({ responded: false, reason: "did_not_hear" }), "Sorry, I didn't hear you then.");
});

// ─── K. cold reload ──────────────────────────────────────────────────────────────────────────────
test("K — an open clarification survives a restart; the fragment answer resolves identically", async () => {
  const run = async (reload) => {
    let state = setup("ed27-k", garbage());
    try {
      const [, b, c] = state.names;
      await turn(state, `Hello ${b} and ${c}`, { request_id: "k-1" });
      await turn(state, "I left it over there.", { request_id: "k-2" });
      if (reload) state = reopen(state);
      const answer = await turn(state, "By the table.", { request_id: "k-3" });
      await turn(state, `${b}, why didn't you answer me when I asked about the radio?`, { request_id: "k-4" });
      if (reload) state = reopen(state);
      const when = await turn(state, `When I greeted ${b} and ${c}.`, { request_id: "k-5" });
      return { answer: [answer.address, answer.owners, answer.frame, answer.contexts.map((x) => x.response_plan)], when: [when.address, when.owners, when.frame, when.contexts.map((x) => x.response_plan)] };
    } finally { cleanup(state); }
  };
  const live = await run(false);
  const reloaded = await run(true);
  assert.equal(live.answer[2].slot_answer.slot, "location");
  assert.equal(live.when[2].slot_answer.slot, "temporal");
  assert.deepEqual(reloaded, live, "same deterministic resolution after cold reload");
});

// ─── L. provider independence ────────────────────────────────────────────────────────────────────
const SEQUENCE = (n) => [
  ["Goodmorning everyone, I'm Gooby Gooberson, today's my first day."],
  [`Mind telling me a little bit about yourself, ${n[0]}?`],
  ['What do you mean by "field researcher"?'],
  [`Hello ${n[1]} and ${n[2]}`],
  ["Why?"],
  ["What do you mean?"],
  ["The lights are loud today."],
  [`${n[1]}, why didn't you answer me when I asked about the radio?`],
  [`When I greeted ${n[1]} and ${n[2]}.`],
  ["Who has the thing?"],
  ["The camera."],
  ["I left it over there."],
  ["By the table."],
  [`${n[0]} told me ${n[1]} has the camera.`]
];
async function pragmaticsDigest(provider, { offline = false } = {}) {
  const state = setup("ed27-indep", provider, { offline });
  try {
    for (const [i, [text]] of SEQUENCE(state.names).entries()) await turn(state, text, { request_id: `l-${i}` });
    const run = state.run;
    const WORDED = new Set(["text", "line", "own_reply"]);
    const snapshot = {
      interactions: run.expedition.interaction_history.map((i) => [i.recipient_type, i.recipient_ids, i.address ?? null, (i.response_owners ?? []).map((o) => o.speaker_id)]),
      contexts: run.expedition.communication_receipts.map((r) => (r.response_contexts ?? []).map((c) => [c.target_worker_id, c.semantic_frame, c.response_plan, c.authorized_contribution])),
      custody: Object.fromEntries(Object.entries(run.expedition.equipment).map(([k, v]) => [k, v.holder]))
    };
    return { digest: crypto.createHash("sha256").update(JSON.stringify(snapshot, (key, value) => (WORDED.has(key) && typeof value === "string" ? "<spoken>" : value))).digest("hex"), snapshot };
  } finally { cleanup(state); }
}
test("L — fallback, garbage, throwing and wording providers: identical addresses, threads, open questions, antecedents, frames, owners, plans and effects", async () => {
  const wording = scriptedLocal((body) => {
    const user = body.messages.find((m) => m.role === "user").content;
    const name = user.match(/name: your own name is "(\w+)"/);
    const role = user.match(/role: you are an? ([a-z ]+); say so/);
    if (name && role) return `I'm ${name[1]}, a ${role[1]}.`;
    if (/Ask ONE short question about when/.test(user)) return "Sorry, when do you mean?";
    if (/Ask ONE short question/.test(user)) return "Sorry, which one do you mean?";
    return "Hm.";
  });
  const reference = await pragmaticsDigest(null, { offline: true });
  for (const [name, provider] of [["garbage", garbage()], ["throwing", throwing()], ["wording", wording]]) {
    const other = await pragmaticsDigest(provider);
    assert.equal(other.digest, reference.digest, name);
  }
  // The reference itself exercised every pragmatics class.
  const frames = reference.snapshot.contexts.flat().map((c) => c[1]);
  assert.ok(frames.some((f) => f.discourse_function === "ask_meaning" && f.antecedent.resolved));
  assert.ok(frames.some((f) => f.slot_answer?.slot === "temporal" && f.event_reference?.target), "naming the greeted pair resolves that exchange, not the earlier greeting of everyone");
  assert.ok(frames.some((f) => f.slot_answer?.slot === "location"));
  assert.ok(reference.snapshot.interactions.some((i) => i[2]?.scope === "subset"));
  assert.ok(reference.snapshot.interactions.some((i) => i[2]?.form === "inherited"));
});

// ─── Part 13. developer trace ────────────────────────────────────────────────────────────────────
test("trace — the discourse trace exposes addressees, thread, open question, slot, prior utterance, event and bases", async () => {
  const state = setup("ed27-trace", garbage());
  try {
    const [a, b, c] = state.names;
    const set = await turn(state, `Hello ${b} and ${c}`);
    assert.deepEqual(set.trace.pragmatics.explicit_addressees, { scope: "subset", ids: [state.ids[1], state.ids[2]], form: "greeting" });
    const why = await turn(state, "Why?");
    assert.equal(why.trace.pragmatics.inherited_addressees.scope, "subset");
    assert.equal(why.trace.pragmatics.active_thread.kind, "subset");
    await turn(state, `Tell me about yourself, ${a}.`);
    const quoted = await turn(state, `What do you mean by "${state.run.expedition.dialogue_history.filter((e) => e.speaker_id === state.ids[0]).at(-1).text.split(/\s+/).slice(1, 3).join(" ").replace(/[.,]/g, "")}"?`);
    assert.equal(quoted.trace.pragmatics.prior_utterance.speaker, state.ids[0]);
    assert.ok(quoted.trace.pragmatics.quoted_span);
    const asked = await turn(state, "Why didn't you answer me when I asked about the radio?");
    assert.equal(asked.trace.pragmatics.conversational_event.resolved, false);
    assert.equal(asked.trace.pragmatics.response_basis[0].expected_slot, "temporal");
    const now = await turn(state, "Just now.");
    assert.equal(now.trace.pragmatics.open_question.expected_slot, "temporal");
    assert.equal(now.trace.pragmatics.slot_answer.slot, "temporal");
    assert.ok("silence_basis" in (now.trace.pragmatics.response_basis[0] ?? {}) || now.contexts[0].response_plan.may_ask_clarifying_question);
    assert.doesNotMatch(JSON.stringify(now.trace.pragmatics), /known_information|custody|equipment/, "no broad hidden world state");
  } finally { cleanup(state); }
});
