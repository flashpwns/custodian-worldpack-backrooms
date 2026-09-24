"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const { interpretUtterance, inferLocalRecipientType, resolveResponseOwners } = require("../tools/dialogue-interpretation");
const { DesktopService } = require("../desktop/service");

const PLAYER = "p-jack";
const EQUIPMENT = {
  "medical-kit": { id: "medical-kit", label: "Medical kit", type: "medical-kit", holder: "c-nora" },
  "survey-radio": { id: "survey-radio", label: "Survey radio", type: "survey-radio", holder: PLAYER }
};
const SELF = {
  "c-nora": D.buildSelfKnowledge({ person: { first_name: "Nora", role: "field medical doctor", primary_task: "Handling the medical kit and staying with the team", identity_substrate: { social_expression: "quietly friendly" } }, held_equipment: [EQUIPMENT["medical-kit"]] }),
  "c-omar": D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, held_equipment: [] })
};
const RESP = Object.fromEntries(Object.entries(SELF).map(([id, self]) => [id, { self }]));
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", [PLAYER]: "you" };

// One prior group exchange: "Hey everyone." -> Nora, Omar.
function priorGroupExchange(location = "assembly-table") {
  return {
    interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Hey everyone.", recipient_type: "group", recipient_id: "@table", recipient_ids: ["c-nora", "c-omar"], response_owners: [{ order: 0, speaker_id: "c-nora" }, { order: 1, speaker_id: "c-omar" }], location_id: location }],
    dialogue_history: [
      { submission_id: "s1", speaker_id: PLAYER, text: "Hey everyone." },
      { submission_id: "s1", speaker_id: "c-nora", speaker_name: "Nora", kind: "speech", text: "Good morning." },
      { submission_id: "s1", speaker_id: "c-omar", speaker_name: "Omar", kind: "speech", text: "Hey." }
    ]
  };
}
const discourseAfterGroup = (location = "assembly-table") => D.deriveDiscourseState({ ...priorGroupExchange(location), player_id: PLAYER, location_id: location });
const emptyDiscourse = () => D.deriveDiscourseState({ player_id: PLAYER, location_id: "assembly-table" });

function frameFor(text, { recipient_type, discourse = emptyDiscourse(), equipment = EQUIPMENT } = {}) {
  const group = recipient_type ?? (inferLocalRecipientType(text) === "group" ? "group" : "none");
  return D.buildSemanticFrame({ text, recipient_type: group, interpretation: interpretUtterance(text, { isGroup: group === "group" }), discourse, equipment });
}

test("ED-1 A — 'Mind telling me a bit about yourselves?' is a group self-description with per-owner plans", () => {
  const text = "Mind telling me a bit about yourselves?";
  assert.equal(inferLocalRecipientType(text), "group");
  const frame = frameFor(text);
  assert.equal(frame.discourse_function, "invite_self_description");
  assert.equal(frame.target_scope, "group");
  assert.equal(frame.requested_content, "self_description");
  assert.equal(frame.expected_response_shape, "brief_grounded_self_description");

  const candidates = [{ id: "c-nora", response_eligible: true }, { id: "c-omar", response_eligible: true }];
  const owners = resolveResponseOwners({ recipient_type: "group", interpretation: interpretUtterance(text, { isGroup: true }), player_text: text, candidates, frame });
  assert.deepEqual(owners, ["c-nora", "c-omar"]);

  const plans = D.planResponses({ frame, owner_ids: owners, responders: RESP, names: NAMES });
  assert.equal(plans.length, 2);
  for (const plan of plans) {
    assert.equal(plan.discourse_function, "invite_self_description");
    assert.match(plan.purpose, /identify yourself/);
    assert.doesNotMatch(plan.purpose, /task help|mission|check/i);
    assert.deepEqual(plan.required_facts.map((f) => f.key), plan.responder_id === "c-nora" ? ["name", "role", "current_assignment"] : ["name", "role"]);
    assert.ok(plan.forbidden_claims.includes("invented_biography"));
    assert.ok(plan.forbidden_claims.includes("unrequested_mission_briefing"));
  }
  assert.deepEqual(plans[1].same_turn_prior_responses, ["c-nora"]);
  const nora = F.presentFallback({ frame, plan: plans[0] });
  assert.match(nora, /^I'm Nora, a field medical doctor\./);
  assert.doesNotMatch(nora, /which part|check/i);
});

test("ED-1 B — 'What?' after a group exchange clarifies it and preserves group scope", () => {
  const discourse = discourseAfterGroup();
  const scope = D.resolveRecipientScope({ text: "What?", discourse, present_ids: ["c-nora", "c-omar"] });
  assert.deepEqual([scope.recipient_type, scope.inherited], ["group", true]);
  const frame = frameFor("What?", { recipient_type: "group", discourse });
  assert.equal(frame.discourse_function, "clarify_previous");
  assert.equal(frame.target_scope, "group");
  assert.equal(frame.antecedent.type, "prior_exchange");
  assert.equal(frame.antecedent.player_text, "Hey everyone.");
  assert.deepEqual(frame.antecedent.responder_ids, ["c-nora", "c-omar"]);
  assert.equal(frame.expected_response_shape, "clarification_of_preceding_exchange");
  const [plan] = D.planResponses({ frame, owner_ids: ["c-nora"], responders: RESP, names: NAMES });
  assert.deepEqual(plan.required_facts.map((f) => f.key), ["antecedent_player_text", "antecedent_responses"]);
  assert.ok(plan.forbidden_claims.includes("unrelated_task_offer"));
  assert.match(F.presentFallback({ frame, plan }), /I (?:just )?said, "Good morning\."/);
  const summary = D.summarizeDiscourse(discourse, frame);
  assert.equal(summary.thread_state, "repairing");
});

test("ED-1 B2 — 'What?' with no same-location antecedent never guesses", () => {
  const elsewhere = discourseAfterGroup("somewhere-else");
  const frame = frameFor("What?", { recipient_type: "none", discourse: D.deriveDiscourseState({ ...priorGroupExchange("somewhere-else"), player_id: PLAYER, location_id: "assembly-table" }) });
  assert.equal(elsewhere.last_turn?.player_text, "Hey everyone.");
  assert.equal(frame.antecedent.resolved, false);
  assert.equal(frame.unresolved_reference, true);
  assert.equal(frame.expected_response_shape, "clarification_request");
});

test("ED-1 C — 'Can you repeat that?' resolves its antecedent and is not a factual question", () => {
  const discourse = discourseAfterGroup();
  const frame = frameFor("Can you repeat that?", { recipient_type: "group", discourse });
  assert.equal(frame.discourse_function, "request_repetition");
  assert.notEqual(frame.discourse_function, "ask_factual");
  assert.equal(frame.antecedent.type, "prior_response");
  assert.equal(frame.antecedent.resolved, true);
  const owners = resolveResponseOwners({ recipient_type: "group", interpretation: interpretUtterance("Can you repeat that?"), player_text: "Can you repeat that?", candidates: [{ id: "c-omar", response_eligible: true }, { id: "c-nora", response_eligible: true }], frame });
  assert.deepEqual(owners, ["c-omar"], "first eligible candidate (canonical order) among the previous responders owns the repetition");
  const [plan] = D.planResponses({ frame, owner_ids: ["c-omar"], responders: RESP, names: NAMES });
  assert.equal(plan.expected_response_shape, "repetition_of_preceding_utterance");
  assert.match(F.presentFallback({ frame, plan }), /I (?:just )?said, "Hey\."/);
});

test("ED-1 D — 'Who was assigned the medical kit?' binds the canonical item and holder", () => {
  const frame = frameFor("Who was assigned the medical kit?");
  assert.equal(frame.discourse_function, "ask_item_ownership");
  assert.equal(frame.requested_content, "canonical_holder");
  assert.equal(frame.referents[0].id, "medical-kit");
  assert.equal(frame.referents[0].holder, "c-nora");
  assert.equal(frame.unresolved_reference, false);
  const plans = D.planResponses({ frame, owner_ids: ["c-nora"], responders: RESP, names: NAMES });
  assert.deepEqual(plans[0].required_facts[0].value, { label: "Medical kit", holder_name: "Nora", holder_is_self: true });
  assert.equal(F.presentFallback({ frame, plan: plans[0] }), "I've got the medical kit.");
  // Unknown item: never invent a holder.
  const unknown = frameFor("Who was assigned the oxygen tank?");
  assert.equal(unknown.unresolved_reference, true);
  assert.equal(D.planResponses({ frame: unknown, owner_ids: ["c-nora"], responders: RESP, names: NAMES })[0].required_facts.length, 0);
});

test("ED-1 E — 'You know the thing by the thing?' is an unresolved reference with a clarification plan", () => {
  for (const type of ["direct", "group", "none"]) {
    const frame = frameFor("You know the thing by the thing?", { recipient_type: type, discourse: discourseAfterGroup() });
    assert.equal(frame.discourse_function, "ambiguous_reference");
    assert.equal(frame.unresolved_reference, true);
    assert.equal(frame.expected_response_shape, "clarification_request");
    const [plan] = D.planResponses({ frame, owner_ids: ["c-nora"], responders: RESP, names: NAMES });
    assert.equal(plan.may_ask_clarifying_question, true);
    assert.equal(plan.required_facts.length, 0, "no meaning is supplied for the model to invent");
    assert.equal(F.presentFallback({ frame, plan }), "Sorry, which thing do you mean?");
  }
});

test("ED-1 F — 'I'm Jack.' is self-introduction, not a question", () => {
  const frame = frameFor("I'm Jack.");
  assert.equal(frame.discourse_function, "introduce_self");
  assert.equal(frame.literal_question, false);
  assert.equal(frame.expected_response_shape, "short_social_acknowledgment");
  const [plan] = D.planResponses({ frame, owner_ids: ["c-nora"], responders: RESP, names: NAMES });
  assert.match(plan.purpose, /do not ask questions/);
  assert.equal(plan.required_facts.length, 0);
});

test("ED-1 G — sarcasm gets a social plan and no task help", () => {
  const frame = frameFor("Well, this seems incredibly safe.");
  assert.equal(frame.discourse_function, "joke_or_sarcasm");
  const [plan] = D.planResponses({ frame, owner_ids: ["c-nora"], responders: RESP, names: NAMES });
  assert.match(plan.purpose, /do not .*offer task help/);
  assert.ok(plan.forbidden_claims.includes("unrequested_mission_briefing"));
  assert.equal(plan.required_facts.length, 0);
  const observation = frameFor("You look a little nervous.");
  assert.equal(observation.discourse_function, "social_observation");
  assert.doesNotMatch(F.presentFallback({ frame, plan }), /focused/i, "sarcasm never becomes a redirect");
  assert.equal(F.presentFallback({ frame: observation, plan: D.planResponses({ frame: observation, owner_ids: ["c-nora"], responders: RESP, names: NAMES })[0] }), "Fair enough.", "social observation is plan-aware and non-directive");
});

test("ED-1 H — direct, group and untargeted scope stay deterministic", () => {
  assert.equal(frameFor("Are you ready?", { recipient_type: "direct" }).target_scope, "direct");
  assert.equal(frameFor("Hello, everyone.").target_scope, "group");
  assert.equal(frameFor("Hello, everyone.").discourse_function, "greet");
  assert.equal(frameFor("Long morning.").target_scope, "untargeted");
  const twice = [frameFor("Mind telling me a bit about yourselves?"), frameFor("Mind telling me a bit about yourselves?")];
  assert.deepEqual(twice[0], twice[1]);
  assert.equal(D.resolveRecipientScope({ text: "Long morning.", discourse: discourseAfterGroup(), present_ids: ["c-nora"] }).recipient_type, "none", "only reflex follow-ups inherit scope");
});

test("ED-1 I — explicit target and group address override inherited discourse scope", () => {
  const discourse = discourseAfterGroup();
  const present = ["c-nora", "c-omar"];
  assert.equal(D.resolveRecipientScope({ text: "What?", explicit_target: "Omar", discourse, present_ids: present }).recipient_type, "direct");
  assert.equal(D.resolveRecipientScope({ text: "What?", explicit_target: "Omar", discourse, present_ids: present }).inherited, false);
  assert.equal(D.resolveRecipientScope({ text: "What?", group_address: true, discourse, present_ids: present }).inherited, false);
  // A direct prior exchange is inherited only while that person is still present.
  const direct = D.deriveDiscourseState({ interaction_history: [{ id: "i9", channel: "local", speaker_id: PLAYER, delivery: "heard", player_text: "Are you ready?", recipient_type: "direct", recipient_id: "c-omar", recipient_ids: ["c-omar"], response_owners: [{ order: 0, speaker_id: "c-omar" }], location_id: "assembly-table" }], player_id: PLAYER, location_id: "assembly-table" });
  assert.equal(D.resolveRecipientScope({ text: "What?", discourse: direct, present_ids: ["c-omar"] }).recipient_type, "direct");
  assert.equal(D.resolveRecipientScope({ text: "What?", discourse: direct, present_ids: ["c-nora"] }).recipient_type, "none");
});

test("ED-1 J — discourse state is a bounded derived projection, not a transcript authority", () => {
  const many = { interaction_history: [], dialogue_history: [] };
  for (let i = 0; i < 20; i += 1) many.interaction_history.push({ id: `i${i}`, channel: "local", speaker_id: PLAYER, delivery: "heard", submission_id: `s${i}`, player_text: `line ${i}`, recipient_type: "none", location_id: "assembly-table", response_owners: [] });
  const before = JSON.stringify(many);
  const state = D.deriveDiscourseState({ ...many, player_id: PLAYER, location_id: "assembly-table" });
  assert.equal(state.turns.length, D.RECENT_TURN_WINDOW);
  assert.equal(state.last_player_utterance, "line 19");
  assert.equal(JSON.stringify(many), before, "derivation never mutates canonical history");
  assert.ok(Object.isFrozen(state));
  // Derived only: the module owns no persistence surface.
  const source = fs.readFileSync(path.join(__dirname, "../tools/dialogue-discourse.js"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /require\("(?:node:)?fs"\)|writeFile|localStorage|(?:interaction|dialogue)_history\.push|expedition\s*\./);
  // A move to another location closes the thread.
  assert.equal(D.deriveDiscourseState({ ...many, player_id: PLAYER, location_id: "elsewhere" }).last_turn, null);
});

test("ED-1 — every discourse function is bounded and has an expected shape; model cannot extend either", () => {
  for (const fn of ["greet", "introduce_self", "invite_self_description", "ask_factual", "ask_personal_experience", "ask_role_or_assignment", "ask_item_ownership", "clarify_previous", "request_repetition", "acknowledge", "joke_or_sarcasm", "social_observation", "warn", "challenge", "express_uncertainty", "ambiguous_reference", "close_topic"]) {
    assert.ok(D.DISCOURSE_FUNCTIONS.includes(fn), fn);
    assert.ok(D.EXPECTED_SHAPES[fn], fn);
  }
  assert.ok(Object.isFrozen(D.DISCOURSE_FUNCTIONS));
  for (const text of ["Careful with that.", "I'm not sure what we're doing.", "Got it.", "Never mind.", "Are you sure about that?", "What's your job here?", "Have you been in there before?", "How's everyone doing?", "Please hand me the radio."]) {
    assert.ok(D.DISCOURSE_FUNCTIONS.includes(frameFor(text).discourse_function), text);
  }
});

test("ED-1 — service integration: self-description turn plans, fans out to every owner, and traces", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed1-"));
  try {
    const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
    const worldId = service.createWorld({ name: "ED1", seed: "ed1-seed" }).world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    const session = service.session(worldId, "field-researcher");
    const playerId = session.run.session.startup.player.observer_id;
    const coworkerIds = session.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId).map((m) => m.personnel_id ?? m.id);

    const logs = [];
    service.developerMode = true;
    service.log = (line) => logs.push(String(line));
    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id: worldId, channel: "local", text: "Mind telling me a bit about yourselves?" });
    let events = session.run.expedition.dialogue_history.slice(before);
    assert.equal(events[0].recipient_type, "group");
    assert.deepEqual(events.slice(1).map((e) => e.speaker_id), coworkerIds);
    for (const event of events.slice(1)) assert.match(event.text, /^I'm \w+/, "fallback carries the self-description semantics");
    const trace = logs.find((line) => line.includes("[YB:DISCOURSE_TRACE]"));
    assert.ok(trace, "dev-only discourse trace emitted");
    assert.match(trace, /"fn":"invite_self_description"/);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id: worldId, channel: "local", text: "What?" });
    events = session.run.expedition.dialogue_history.slice(before);
    assert.equal(events[0].recipient_type, "group", "scope inherited from the preceding group exchange");
    assert.equal(events.length, 2, "one responder clarifies");
    assert.equal(events[1].speaker_id, coworkerIds[0]);
    assert.match(events[1].text, /^I (?:just )?said, "I'm /);
    assert.equal(session.run.expedition.discourse_state, undefined, "no persisted discourse authority");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
