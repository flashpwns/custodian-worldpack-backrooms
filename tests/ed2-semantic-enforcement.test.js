"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const I = require("../tools/dialogue-interpretation");
const V = require("../tools/dialogue-validation");
const continuity = require("../tools/q4-personnel-continuity");
const { validateLocalDialogue, validateDialogueClaims } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const PLAYER = "p-jack";
const VERSION = "yellow-beast-local-dialogue-candidate@v1";

function setup(seed, provider = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed2-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED2", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  const logs = [];
  service.log = (line) => logs.push(String(line));
  return { root, service, worldId, session, playerId, coworkers, logs, ids: coworkers.map((m) => m.personnel_id ?? m.id) };
}
const capture = (packets, speech = "Fine.") => ({ name: "ed2-capture", model: "v1", async presentLocal(packet) { packets.push(packet); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: typeof speech === "function" ? speech(packet) : speech }; } });
const say = (state, text, extra = {}) => state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra });
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
const newEvents = (state, before) => state.session.run.expedition.dialogue_history.slice(before);
const coworkerEvents = (state, before) => newEvents(state, before).filter((e) => e.speaker_id !== state.playerId);

// ── pure fixtures ───────────────────────────────────────────────────────────
const EQUIPMENT = {
  cam: { id: "cam", label: "35mm field camera", type: "35mm-camera", holder: "c-nora" },
  radio: { id: "radio", label: "Survey radio", type: "survey-radio", holder: "c-omar" }
};
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", [PLAYER]: "you" };
const SELF = {
  "c-nora": D.buildSelfKnowledge({ person: { first_name: "Nora", role: "field medical doctor", identity_substrate: { social_expression: "dryly observant", region: "Great Lakes" } }, task: { type: "wait", state: "active" }, names: NAMES }),
  "c-omar": D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, names: NAMES })
};
const RESP = Object.fromEntries(Object.entries(SELF).map(([id, self]) => [id, { self }]));
function contributionFor(text, { recipient_type = "direct", owner = "c-omar", discourse = null, equipment = EQUIPMENT, responders = RESP } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, interpretation: I.interpretUtterance(text, { isGroup: recipient_type === "group" }), discourse, equipment });
  const [plan] = D.planResponses({ frame, owner_ids: [owner], responders, names: NAMES });
  return { frame, plan, contribution: D.toAuthorizedContribution(plan, frame, { names: NAMES }) };
}
const verdict = (contribution, speech) => validateLocalDialogue({ speaker: { observer_id: "o1" }, authorized_contribution: contribution }, { version: VERSION, observer_id: "o1", speech });

// ── 1 / A: known answers are plan facts read by fallback AND model ──────────
test("ED-2 A — a resolved known answer reaches the plan, the model packet and the fallback", async () => {
  const packets = [];
  const withModel = setup("ed2-a", capture(packets, "I checked the utility room."));
  const bare = setup("ed2-a");
  try {
    for (const state of [withModel, bare]) {
      state.coworkers[0].known_information.push({ kind: "location-investigated", location: "utility-room", source: "direct-observation" });
    }
    const before = withModel.session.run.expedition.dialogue_history.length;
    await say(withModel, "What happened while we were apart?");
    const spoken = coworkerEvents(withModel, before);
    assert.deepEqual(spoken.map((e) => e.speaker_id), [withModel.ids[0]], "owner selected because of the report");
    const contribution = packets.at(-1).authorized_contribution;
    const fact = contribution.required_facts.find((f) => f.key === "known_answer");
    assert.deepEqual(fact.value, { kind: "own-report", checked_location: "utility room", inspected_target: null, condition_reason: null, condition: null });
    assert.deepEqual(JSON.stringify(contribution).match(/q4-player|yb-personnel|\[object/g), null);
    assert.equal(spoken[0].text, "I checked the utility room.", "accepted model wording");

    const beforeBare = bare.session.run.expedition.dialogue_history.length;
    await say(bare, "What happened while we were apart?");
    assert.equal(coworkerEvents(bare, beforeBare)[0].text, "I checked the utility room.", "fallback reads the same plan fact");
    assert.equal(F.presentFallback({ frame: { discourse_function: "ask_factual" }, plan: { required_facts: [{ key: "known_answer", value: fact.value }], style_hints: {} } }), "I checked the utility room.");
  } finally { cleanup(withModel); cleanup(bare); }
  // structured -> fact conversion, no wording
  assert.equal(D.toKnownAnswerFact(null), null);
  assert.deepEqual(D.toKnownAnswerFact({ kind: "recalled-player-statement", text: "Call me Jack." }), { kind: "recalled-player-statement", text: "Call me Jack." });
});

// ── 2 / B / C: style-only character shaping ─────────────────────────────────
test("ED-2 B/C — plan-carrying packets carry style only; no personality lore can imply experience", async () => {
  const packets = [];
  const state = setup("ed2-bc", capture(packets, "First time for me."));
  try {
    const before = state.session.run.expedition.dialogue_history.length;
    await say(state, "Have you been in there before?", { target: state.coworkers[0].first_name });
    const packet = packets.at(-1);
    const json = JSON.stringify(packet);
    for (const banned of ["personality", "archetype", "recent_attribution", "sentiment", "primary_task", "nervous-first-day", "first-day-observer"]) assert.ok(!json.includes(banned), `${banned} must not be model-visible`);
    assert.deepEqual(Object.keys(packet.speaker.characterization), ["style"]);
    assert.deepEqual(packet.speaker.tendencies, {});
    assert.equal(packet.speaker.relationship, null);
    assert.equal(packet.speaker.role, null);
    assert.deepEqual(packet.authorized_contribution.required_facts, []);
    // the candidate that invents "first time" is rejected; the honest fallback is committed
    const spoken = coworkerEvents(state, before)[0];
    assert.equal(spoken.text, "Not that I know of.");
    const trace = state.service.getDialogueWordsmithTrace({ limit: 5 }).traces.at(-1).wordsmiths[0];
    assert.equal(trace.validator_accepted, false);
    assert.equal(trace.fallback_used, true);
    assert.equal(trace.output_source, "deterministic-fallback");
    assert.equal(trace.rejection_reason, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
    assert.deepEqual([trace.discourse_function, trace.requested_content, trace.expected_response_shape], ["ask_personal_experience", "personal_experience", "brief_grounded_personal_answer"]);
    assert.ok(state.logs.some((l) => l.includes("[YB:DIALOGUE_TRACE]") && l.includes("validation_reason=") && l.includes("candidate=\"First time for me.\"")));
  } finally { cleanup(state); }
});

// ── 3 / D / E: plan-relevant history only ───────────────────────────────────
test("ED-2 D/E — unrelated memory never reaches a factual packet; topic-relevant history arrives only inside the contribution", async () => {
  const packets = [];
  const state = setup("ed2-de", capture(packets));
  try {
    const target = state.coworkers[0].first_name;
    await say(state, "Call me Jack.", { target });
    packets.length = 0;
    await say(state, "What time do we leave?", { target });
    let packet = packets.at(-1);
    const unrelated = JSON.stringify(packet);
    assert.ok(!unrelated.includes("Call me Jack"), "unrelated memory/recent row is omitted");
    assert.deepEqual(packet.authorized_contribution.recent_context, []);
    assert.deepEqual(packet.authorized_contribution.relevant_memories, []);

    await say(state, "We leave at one o'clock.", { target });
    packets.length = 0;
    await say(state, "What time do we leave?", { target });
    packet = packets.at(-1);
    const rows = [...packet.authorized_contribution.recent_context, ...packet.authorized_contribution.relevant_memories];
    assert.ok(rows.some((row) => /one o'clock/.test(row.player_text ?? "")), "topic-relevant history is authorized inside the contribution");
    assert.deepEqual(packet.speaker.memories, []);
    assert.deepEqual(packet.speaker.recent_dialogue, []);
    assert.deepEqual(packet.known_facts, []);
  } finally { cleanup(state); }
});

// ── 4 / F-J: semantic validation ────────────────────────────────────────────
test("ED-2 F/G — unresolved references must be asked about, not answered", () => {
  const { contribution } = contributionFor("You know the thing by the thing?");
  assert.equal(verdict(contribution, "Sure, the door by the stairs is locked.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
  assert.equal(verdict(contribution, "Yes, I know the one. It's fine?").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET", "a question that does not ask what is meant is not a clarification");
  assert.equal(verdict(contribution, "Which thing do you mean?").ok, true);
  assert.equal(verdict(contribution, "Which thing? The one by the door? Or the stairs? Or the hall?").code, "LOCAL_PRESENTATION_SHAPE_VIOLATION");
});

test("ED-2 H/I — self-description: supplied identity accepted, invented biography rejected", () => {
  const { contribution } = contributionFor("Mind telling me a bit about yourselves?", { recipient_type: "group", owner: "c-nora" });
  assert.equal(verdict(contribution, "I'm Nora, a field medical doctor.").ok, true);
  assert.equal(verdict(contribution, "I'm Nora, a field medical doctor. I'm waiting here.").ok, true);
  assert.equal(verdict(contribution, "I'm Nora. I grew up in Ohio and went to college for nursing.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(contribution, "I'm Nora, my family is from Maine.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(contribution, "The outpost route is on the tape.").ok, false, "mission content instead of self-description");
  assert.equal(verdict(contribution, "I'm Nora. Do you want me to check the outpost?").ok, false, "an unrelated task offer / counter-question is rejected");
  assert.equal(verdict(contribution, "We're all doctors here, I'm Nora.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
});

test("ED-2 J — item ownership: a wrong or missing holder is rejected", () => {
  const { contribution } = contributionFor("Who has the field camera?", { owner: "c-omar" });
  assert.equal(contribution.required_facts[0].value.holder_name, "Nora");
  assert.equal(verdict(contribution, "Omar has the field camera.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
  assert.equal(verdict(contribution, "I've got the field camera.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(verdict(contribution, "The field camera is with Nora.").ok, true);
  assert.equal(verdict(contribution, "Nora has it.").ok, true);
});

test("ED-2 — repetition/clarification, experience, factual and shape checks", () => {
  const discourse = D.deriveDiscourseState({
    interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Hey everyone.", recipient_type: "group", recipient_id: "@table", recipient_ids: ["c-nora", "c-omar"], location_id: "hall" }],
    dialogue_history: [{ submission_id: "s1", speaker_id: "c-nora", speaker_name: "Nora", kind: "speech", text: "Good morning, glad everyone made it." }],
    player_id: PLAYER, location_id: "hall"
  });
  const repeat = contributionFor("Can you repeat that?", { recipient_type: "direct", owner: "c-nora", discourse }).contribution;
  assert.equal(verdict(repeat, "I said good morning, glad everyone made it.").ok, true);
  assert.equal(verdict(repeat, "The outpost is north and the cutoff is at one.").ok, false);
  const clarify = contributionFor("What?", { recipient_type: "direct", owner: "c-nora", discourse }).contribution;
  assert.equal(verdict(clarify, "Just saying good morning.").ok, true);
  assert.equal(verdict(clarify, "Nothing about the weather.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");

  const experience = contributionFor("Have you been in there before?", { owner: "c-nora" }).contribution;
  assert.equal(verdict(experience, "First time for me.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
  assert.equal(verdict(experience, "Not that I know of.").ok, true);

  const time = contributionFor("What time do we leave?", { owner: "c-nora" }).contribution;
  assert.equal(verdict(time, "One o'clock sharp.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET", "no departure fact is authorized, so an answer must be a lack of knowledge");
  assert.equal(verdict(time, "I don't know.").ok, true);

  const greet = contributionFor("Hello, everyone.", { recipient_type: "group", owner: "c-nora" }).contribution;
  assert.equal(verdict(greet, "Morning.").ok, true);
  assert.equal(verdict(greet, "Hello there. It's good to see everyone. I hope the morning treats you well. Ready when you are.").ok, false, "long greeting with a task offer is rejected");
  assert.equal(verdict(contributionFor("Please hand me the survey radio.", { owner: "c-nora" }).contribution, "Here you go.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
});

// ── 6 / K / L: possession precision ─────────────────────────────────────────
test("ED-2 K/L — possession claims are parsed per subject and per item", () => {
  const run = { expedition: { equipment: EQUIPMENT, team: { members: [{ personnel_id: "c-nora", first_name: "Nora" }, { personnel_id: "c-omar", first_name: "Omar" }] } }, session: { startup: { player: { observer_id: PLAYER } } } };
  const check = (speaker, speech) => validateDialogueClaims({ speaker: { observer_id: speaker }, visible_context: { visible_objects: [] } }, { speech }, run);
  // third person is never read as first person
  assert.equal(check("c-omar", "Nora's holding the field camera.").ok, true);
  assert.equal(check("c-omar", "Nora has the camera.").ok, true);
  assert.equal(check("c-omar", "Nora's holding the survey radio.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  // first person
  assert.equal(check("c-omar", "I've got the survey radio.").ok, true);
  assert.equal(check("c-omar", "I've got the field camera.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(check("c-omar", "The radio is with me.").ok, true);
  assert.equal(check("c-nora", "The radio is with me.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  // two claims in one sentence are independent
  assert.equal(check("c-omar", "I've got the radio and Nora has the camera.").ok, true);
  assert.equal(check("c-omar", "I've got the radio and Nora has the radio.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(check("c-omar", "I've got the camera and Nora has the camera.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  // wording that is not a custody claim
  assert.equal(check("c-omar", "I have a question about the camera.").ok, true);
  assert.equal(check("c-omar", "She has the camera.").ok, true, "an unresolved pronoun subject is not validated");
  assert.equal(check("c-omar", "You have the radio.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION", "the player is not the holder");
});

// ── 7: unresolved ownership ─────────────────────────────────────────────────
test("ED-2 M — unresolved ownership asks which item, never claims the speaker lacks it", () => {
  const { frame, plan, contribution } = contributionFor("Who was assigned the oxygen tank?");
  assert.equal(F.presentFallback({ frame, plan }), "Which thing do you mean?");
  assert.equal(verdict(contribution, "I don't have anything by that name.").code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
  assert.equal(verdict(contribution, "Which thing do you mean?").ok, true);
});

// ── 9 / N / O: address parsing ──────────────────────────────────────────────
test("ED-2 N/O — one named-address parser; 'What did you say?' is a repetition request", async () => {
  const known = (name) => ["nora", "omar"].includes(name.toLowerCase());
  const parse = (text, target = null) => I.parseNamedAddress(text, { explicit_target: target, is_known: known });
  for (const [text, target] of [["Nora, what?", null], ["@Nora what?", null], ["@Nora, what?", null], ["what?", "Nora"], ["Nora, what?", "Nora"], ["@Nora what?", "Nora"]]) {
    const parsed = parse(text, target);
    assert.equal(parsed.residual_text, "what?", `${text}/${target}`);
    assert.equal(parsed.explicit_target_name.toLowerCase(), "nora");
    assert.equal(parsed.address_type, "direct");
  }
  assert.equal(parse("Omar, what?", "Nora").residual_text, "Omar, what?", "a vocative for someone else never overrides the chip");
  assert.equal(parse("Team, what?").address_type, "group");
  assert.equal(parse("Hello, everyone.").address_type, "none");
  assert.equal(parse("Hello, everyone.").residual_text, "Hello, everyone.");

  const frame = (t) => D.buildSemanticFrame({ text: t, recipient_type: "direct" });
  assert.equal(frame("What did you say?").discourse_function, "request_repetition");
  assert.equal(frame("What did you say to Kirk?").discourse_function, "ask_factual");
  assert.equal(D.isFollowUpReflex("What did you say?"), true);

  const packets = [];
  const state = setup("ed2-o", capture(packets));
  try {
    await say(state, "Hey everyone.");
    const name = state.coworkers[1].first_name;
    const outcomes = [];
    for (const [text, extra] of [[`${name}, what?`, {}], [`@${name} what?`, {}], ["what?", { target: name }], [`@${name}, what?`, {}]]) {
      packets.length = 0;
      const before = state.session.run.expedition.dialogue_history.length;
      await say(state, text, extra);
      const events = newEvents(state, before);
      outcomes.push({ scope: events[0].recipient_type, speakers: coworkerEvents(state, before).map((e) => e.speaker_id), fn: packets.at(-1)?.authorized_contribution?.discourse_function });
    }
    for (const outcome of outcomes) assert.deepEqual(outcome, { scope: "direct", speakers: [state.ids[1]], fn: "clarify_previous" });
  } finally { cleanup(state); }
});

// ── 10 / P: provider rejection -> same-plan fallback ───────────────────────
test("ED-2 P — a rejected candidate is replaced by the fallback of the SAME plan; owners, scope and text match the no-provider run", async () => {
  const packets = [];
  const rejecting = setup("ed2-p", capture(packets, "I'm from a small town in Ohio and studied nursing."));
  const baseline = setup("ed2-p");
  try {
    const run = async (state) => {
      const before = state.session.run.expedition.dialogue_history.length;
      await say(state, "Mind telling me a bit about yourselves?");
      return newEvents(state, before).map((e) => ({ speaker: e.speaker_id, scope: e.recipient_type, text: e.text }));
    };
    const a = await run(rejecting);
    const b = await run(baseline);
    assert.deepEqual(a, b, "provider failure changes style richness only");
    assert.equal(packets.length, rejecting.ids.length);
    const trace = rejecting.service.getDialogueWordsmithTrace({ limit: 5 }).traces.at(-1);
    for (const w of trace.wordsmiths) {
      assert.equal(w.validator_accepted, false);
      assert.equal(w.fallback_used, true);
      assert.equal(w.output_source, "deterministic-fallback");
      assert.equal(w.rejection_reason, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
      assert.match(w.validation_reason, /biography/);
      assert.deepEqual(w.required_fields.slice(0, 2), ["name", "role"]);
    }
    // the canonical dialogue receipt keeps the plan snapshot the fallback came from
    const receipt = rejecting.session.run.expedition.communication_receipts.at(-1);
    assert.equal(receipt.response_contexts[0].response_plan.discourse_function, "invite_self_description");
  } finally { cleanup(rejecting); cleanup(baseline); }
});

// ── 8 / Q: fallback parity ──────────────────────────────────────────────────
test("ED-2 Q — plan-carrying turns never route through legacy presentReaction", async () => {
  const original = continuity.presentReaction;
  let calls = 0;
  continuity.presentReaction = (...args) => { calls += 1; return original(...args); };
  const state = setup("ed2-q");
  try {
    const target = state.coworkers[0].first_name;
    const utterances = ["Hello, everyone.", "I'm Jack.", "Got it.", "You look nervous.", "Careful with that.", "I'm not sure what we're doing.", "Never mind.", "Could you hand me the survey radio?", "Alright, thanks.", "Well, this seems incredibly safe.", "How's everyone doing?", "What's your job here?", "Are you sure about that?"];
    let spoke = 0;
    for (const text of utterances) {
      const before = state.session.run.expedition.dialogue_history.length;
      await say(state, text, text === "Hello, everyone." || text === "How's everyone doing?" ? {} : { target });
      spoke += coworkerEvents(state, before).length;
    }
    assert.ok(spoke >= 6, "the covered functions actually answer");
    assert.equal(calls, 0, "legacy presentReaction is not consulted");
  } finally { continuity.presentReaction = original; cleanup(state); }
  const plan = (fn, style = {}, extra = {}) => ({ frame: { discourse_function: fn, referents: [] }, plan: { required_facts: [], optional_facts: [], style_hints: style, ...extra } });
  const say1 = (fn, style, prior) => F.presentFallback({ ...plan(fn, style), prior });
  assert.equal(say1("greet", { social_expression: "quietly friendly" }), "Hi there.");
  assert.notEqual(say1("greet", { social_expression: "quietly friendly" }, ["Hi there."]), "Hi there.", "same-turn prior wording is avoided");
  for (const fn of ["greet", "introduce_self", "acknowledge", "social_observation", "warn", "express_uncertainty", "close_topic", "make_statement", "make_request"]) {
    const text = say1(fn, {});
    assert.ok(text && !/let'?s keep moving|let'?s stay focused|ready when you are/i.test(text), fn);
  }
});

// ── 5/R: model/fallback wording never changes who speaks ────────────────────
test("ED-2 R — replacing or removing fallback wording cannot change owners across the covered functions", async () => {
  const real = F.presentFallback;
  const run = async (impl) => {
    F.presentFallback = impl;
    const state = setup("ed2-r");
    try {
      const out = [];
      for (const text of ["Hello, everyone.", "Mind telling me a bit about yourselves?", "What did you say?", "Who has the survey radio?", "How's everyone doing?"]) {
        const before = state.session.run.expedition.dialogue_history.length;
        await say(state, text);
        out.push(coworkerEvents(state, before).map((e) => e.speaker_id));
      }
      return out;
    } finally { cleanup(state); }
  };
  try {
    const baseline = await run(real);
    assert.deepEqual(await run(() => null), baseline);
    assert.deepEqual(await run(() => "Always speaks."), baseline);
  } finally { F.presentFallback = real; }
});

// ── structural audit ────────────────────────────────────────────────────────
test("ED-2 — validator holds no item map; contribution validator is deterministic and model-free", () => {
  const validation = fs.readFileSync(path.join(__dirname, "../tools/dialogue-validation.js"), "utf8");
  const dialogue = fs.readFileSync(path.join(__dirname, "../tools/ai-local-dialogue.js"), "utf8");
  assert.doesNotMatch(dialogue, /EQUIPMENT_KEYWORDS|POSSESSION_PATTERNS|resolveEquipmentReferent/);
  assert.match(validation, /resolveEquipmentReferent/);
  assert.doesNotMatch(validation, /presentLocal|fetch\(|provider/i, "no model in validation");
  assert.equal(V.validateContribution(null, "anything").ok, true);
  assert.ok(V.coverage("I trained in emergency medicine", "emergency medical training") >= 0.5);
});
