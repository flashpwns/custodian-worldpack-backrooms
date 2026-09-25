"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const I = require("../tools/dialogue-interpretation");
const { validateLocalDialogue } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const PLAYER = "p-jack";

function setup(seed, provider = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed15-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED15", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  const logs = [];
  service.log = (line) => logs.push(String(line));
  return { root, service, worldId, session, playerId, coworkers, logs, ids: coworkers.map((m) => m.personnel_id ?? m.id) };
}
const capturingProvider = (packets, speech = "Fine.") => ({
  name: "ed15-capture",
  model: "v1",
  async presentLocal(packet) {
    packets.push(packet);
    return { version: "yellow-beast-local-dialogue-candidate@v1", observer_id: packet.speaker.observer_id, speech };
  }
});
const say = (state, text, extra = {}) => state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra });
const speakers = (state, before) => state.session.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId).map((e) => e.speaker_id);
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });

// ── pure fixtures ───────────────────────────────────────────────────────────
const EQUIPMENT = {
  "field-camera": { id: "field-camera", label: "Field camera", type: "field-camera", holder: "c-nora" },
  "camera-bag": { id: "camera-bag", label: "Camera bag", type: "camera-bag", holder: "c-omar" },
  "medical-kit": { id: "medical-kit", label: "Medical kit", type: "medical-kit", holder: "c-omar" }
};
const frameFor = (text, { recipient_type = "none", discourse = null, equipment = EQUIPMENT } = {}) => D.buildSemanticFrame({ text, recipient_type, interpretation: I.interpretUtterance(text, { isGroup: recipient_type === "group" }), discourse, equipment });
const cand = (id, eligible = true) => ({ id, response_eligible: eligible });
const turnEvents = (sid, speakerId, text, interval = 5) => [{ submission_id: sid, speaker_id: PLAYER, kind: "speech", text: "x", interval }, { submission_id: sid, speaker_id: speakerId, speaker_name: speakerId, kind: "speech", text, interval }];

// ── BLOCKER 1: wording never touches eligibility / owners ───────────────────
test("ED-1.5 A/B/C — fallback wording cannot change eligibility or owner count", async () => {
  const real = F.presentFallback;
  const run = async (label, impl) => {
    F.presentFallback = impl;
    const state = setup(`ed15-abc`);
    try {
      const before = state.session.run.expedition.dialogue_history.length;
      await say(state, "Mind telling me a bit about yourselves?");
      const first = speakers(state, before);
      const beforeWhat = state.session.run.expedition.dialogue_history.length;
      await say(state, "What?");
      return { first, second: speakers(state, beforeWhat), ids: state.ids };
    } finally { cleanup(state); }
  };
  try {
    const baseline = await run("baseline", real);
    const removed = await run("removed", () => null);
    const added = await run("added", () => "Always speaks.");
    assert.deepEqual(baseline.first, baseline.ids);
    assert.deepEqual(removed.first, baseline.first, "removing wording changes no owner");
    assert.deepEqual(added.first, baseline.first, "adding wording adds no owner");
    assert.deepEqual(removed.second, baseline.second);
    assert.deepEqual(added.second, baseline.second);
  } finally { F.presentFallback = real; }
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", "tools", f), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src("dialogue-discourse.js") + src("dialogue-interpretation.js"), /dialogue-fallback|presentFallback/, "no owner/eligibility code can read wording");
  assert.equal(D.frameObligatesResponse.length, 1 + 0, "eligibility rule takes only frame (+ optional responder id)");
});

// ── BLOCKER 2: one canonical referent resolver ──────────────────────────────
test("ED-1.5 D — 'Who has the field camera?' uses one resolved item for frame, knowledge, owner and plan", async () => {
  const packets = [];
  const state = setup("ed15-d", capturingProvider(packets));
  try {
    const held = Object.values(state.session.run.expedition.equipment).find((item) => state.ids.includes(item.holder));
    assert.ok(held, "a coworker holds canonical equipment");
    const before = state.session.run.expedition.dialogue_history.length;
    await say(state, `Who has the ${held.label.toLowerCase()}?`);
    assert.deepEqual(speakers(state, before), [held.holder], "only the canonical holder owns the answer");
    const packet = packets.at(-1);
    assert.equal(packet.speaker.observer_id, held.holder);
    assert.equal(packet.authorized_contribution.discourse_function, "ask_item_ownership");
    assert.equal(packet.authorized_contribution.referents[0].label, held.label);
    assert.equal(packet.authorized_contribution.required_facts[0].value.holder_is_self, true);
    assert.doesNotMatch(JSON.stringify(packet.authorized_contribution), /yb-personnel/, "no internal ids in the contribution");
    const trace = state.logs.find((l) => l.includes("[YB:DISCOURSE_TRACE]"));
    assert.match(trace, /"owners":\["[^"]+"\]/);
  } finally { cleanup(state); }
});

test("ED-1.5 E — ambiguous or unmatched item yields no false owner", () => {
  const ambiguous = frameFor("Who has the camera?");
  assert.equal(ambiguous.referents[0].reason, "multiple_matches");
  assert.equal(ambiguous.unresolved_reference, true);
  const unmatched = frameFor("Who was assigned the oxygen tank?");
  assert.equal(unmatched.referents[0].reason, "no_canonical_match");
  const eligible = [cand("c-nora"), cand("c-omar")];
  for (const frame of [ambiguous, unmatched]) {
    assert.deepEqual(I.resolveResponseOwners({ recipient_type: "group", interpretation: I.interpretUtterance("x"), player_text: "x", candidates: eligible, frame }), []);
    assert.equal(D.frameObligatesResponse(frame, "c-nora"), false);
  }
  const unique = frameFor("Who has the medical kit?");
  assert.deepEqual(I.resolveResponseOwners({ recipient_type: "none", interpretation: I.interpretUtterance("x"), player_text: "x", candidates: eligible, frame: unique }), ["c-omar"]);
  assert.equal(D.frameObligatesResponse(unique, "c-omar"), true);
  assert.equal(D.frameObligatesResponse(unique, "c-nora"), false);
  // Direct scope: the addressee answers, with a clarification plan for the unresolved item.
  const [plan] = D.planResponses({ frame: ambiguous, owner_ids: ["c-nora"], responders: {}, names: {} });
  assert.equal(plan.may_ask_clarifying_question, true);
  assert.equal(F.presentFallback({ frame: ambiguous, plan }), "Which thing do you mean?");
});

// ── BLOCKER 3 + containment ─────────────────────────────────────────────────
test("ED-1.5 F/G/H/I/P — packet carries the authorized contribution and structurally lacks broad context", async () => {
  const packets = [];
  const state = setup("ed15-fghip", capturingProvider(packets));
  try {
    await say(state, "Mind telling me a bit about yourselves?");
    const intro = packets.filter((p) => p.authorized_contribution?.discourse_function === "invite_self_description");
    assert.equal(intro.length, state.ids.length);
    const c = intro[0].authorized_contribution;
    assert.ok(Object.keys(intro[0]).includes("authorized_contribution"), "enumerable model-facing field");
    for (const key of ["discourse_function", "purpose", "expected_response_shape", "requested_content", "referents", "antecedent", "required_facts", "optional_facts", "forbidden_claims", "may_ask_clarifying_question", "same_turn_prior_responses", "style_hints"]) assert.ok(key in c, key);
    assert.equal(c.expected_response_shape, "brief_grounded_self_description");
    assert.ok(c.required_facts.some((f) => f.key === "name") && c.required_facts.some((f) => f.key === "role"));
    assert.ok(c.forbidden_claims.includes("invented_biography"));
    assert.equal(c.antecedent, null);
    assert.doesNotMatch(JSON.stringify(c), /responder_id|yb-personnel/);
    assert.deepEqual(intro[1].authorized_contribution.same_turn_prior_responses.length, 1);

    packets.length = 0;
    await say(state, "What?");
    const what = packets.at(-1);
    const wc = what.authorized_contribution;
    assert.equal(wc.discourse_function, "clarify_previous");
    assert.equal(wc.antecedent.type, "prior_exchange");
    assert.ok(wc.antecedent.responses.length >= 1 && wc.antecedent.responses[0].text);
    assert.ok(wc.forbidden_claims.includes("unrelated_task_offer"));
    // H/I: no broad context
    assert.deepEqual(what.known_facts, []);
    assert.deepEqual(what.speaker.memories, []);
    assert.deepEqual(what.speaker.relevant_memories, []);
    assert.deepEqual(what.speaker.recent_dialogue, []);
    assert.deepEqual(what.speaker.shared_history, []);
    assert.deepEqual(what.visible_context.visible_objects, []);
    assert.equal(what.speaker_shell, null);
    assert.equal(what.speaker.current_task, null);
    assert.deepEqual(what.speaker.held_equipment, []);
    assert.deepEqual(what.speaker.qualifications, []);
    assert.equal(what.authorized_response.purpose, wc.purpose);
    // P: identity is style-only; factual substrate fields never appear
    const person = state.session.run._world.characters[what.speaker.observer_id];
    const substrate = person.identity_substrate ?? {};
    assert.deepEqual(Object.keys(what.speaker.characterization.style).sort(), Object.keys(what.speaker.characterization.style).filter((k) => D.IDENTITY_STYLE_KEYS.includes(k)).sort());
    assert.ok(!("identity_substrate" in what.speaker.characterization));
    assert.ok(!("primary_task" in what.speaker.characterization));
    const json = JSON.stringify(what);
    for (const key of ["region", "age_band", "mundane_preference", "irritation", "pre_expedition_concern", "education_or_trade", "async_tenure"]) {
      if (substrate[key]) assert.ok(!json.includes(String(substrate[key])), `${key} value must not reach the model`);
    }
  } finally { cleanup(state); }
});

test("ED-1.5 I — repetition and ambiguous-reference turns receive no mission context", async () => {
  const packets = [];
  const state = setup("ed15-i", capturingProvider(packets));
  try {
    await say(state, "Hey everyone.");
    for (const [text, fn] of [["Can you repeat that?", "request_repetition"], ["You know the thing by the thing?", "ambiguous_reference"]]) {
      packets.length = 0;
      await say(state, text);
      const packet = packets.at(-1);
      assert.equal(packet.authorized_contribution.discourse_function, fn);
      assert.equal(packet.speaker_shell, null);
      assert.deepEqual(packet.known_facts, []);
      assert.deepEqual(packet.speaker.recent_dialogue, []);
      assert.doesNotMatch(JSON.stringify(packet), /Outpost|duffle|cutoff|Maxwell/i, `${fn}: no mission surface`);
    }
  } finally { cleanup(state); }
});

test("ED-1.5 — factual turns receive only plan facts, never the speaker's broad knowledge", async () => {
  const packets = [];
  const state = setup("ed15-facts", capturingProvider(packets));
  try {
    const member = state.coworkers[0];
    member.known_information.push({ kind: "direct-observation", text: "The departure cutoff is at one o'clock.", source: "direct-observation" }, { kind: "direct-observation", text: "There is a loose cable near the north wall.", source: "direct-observation" });
    await say(state, `${member.first_name}, what time do we leave?`);
    const packet = packets.at(-1);
    assert.deepEqual(packet.known_facts, [], "no duplicate top-level fact surface");
    const facts = packet.authorized_contribution.required_facts.filter((f) => f.key === "known_fact").map((f) => f.value.text);
    assert.deepEqual(facts, ["The departure cutoff is at one o'clock."], "only the topic-matched fact is authorized");
    assert.ok(!JSON.stringify(packet).includes("loose cable"));
    assert.equal(packet.authorized_contribution.required_facts[0].key, "known_fact");
  } finally { cleanup(state); }
});

// ── Language / address ──────────────────────────────────────────────────────
test("ED-1.5 J — 'Nora, what?' is a direct clarification, not a factual question", async () => {
  const packets = [];
  const state = setup("ed15-j", capturingProvider(packets));
  try {
    await say(state, "Hey everyone.");
    const name = state.coworkers[1].first_name;
    packets.length = 0;
    const before = state.session.run.expedition.dialogue_history.length;
    await say(state, `${name}, what?`);
    const events = state.session.run.expedition.dialogue_history.slice(before);
    assert.equal(events[0].recipient_type, "direct");
    assert.deepEqual(speakers(state, before), [state.ids[1]]);
    assert.equal(packets.at(-1).authorized_contribution.discourse_function, "clarify_previous");
    assert.notEqual(packets.at(-1).player_speech_act.speech_act, "factual_question");
  } finally { cleanup(state); }
  assert.equal(I.stripNamedAddress("Nora, what?", "Nora"), "what?");
  assert.equal(I.stripNamedAddress("Nora Vance: what?", "Nora"), "what?");
  assert.equal(I.stripNamedAddress("Omar, what?", "Nora"), "Omar, what?", "a different name is not address to the target");
});

test("ED-1.5 K/L — tightened language recognition", () => {
  const fn = (t) => frameFor(t).discourse_function;
  // "that noise" points at something only a deterministic selection could resolve: it is a clarification
  // (Part 7 spatial deixis), and still never a repair of the previous line.
  assert.equal(fn("What was that noise?"), "ambiguous_reference");
  assert.notEqual(fn("What was that noise?"), "clarify_previous");
  assert.notEqual(fn("Can you repeat the route?"), "request_repetition");
  assert.equal(fn("Can you repeat that?"), "request_repetition");
  assert.equal(fn("Could you say it again?"), "request_repetition");
  assert.notEqual(fn("Can you tell me about the door you saw?"), "invite_self_description");
  assert.notEqual(fn("Who are you talking to?"), "invite_self_description");
  assert.equal(fn("Tell me a bit about yourself."), "invite_self_description");
  assert.equal(fn("Mind telling me a bit about yourselves?"), "invite_self_description");
  // one pattern owner
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../tools/dialogue-discourse.js"), "utf8").replace(/\/\/.*$/gm, "").split("\n").filter((line) => !line.includes("INTERNAL_ID")).join("\n"), /=\s*\/[^/\n]{12,}\/[gimsuy]*\s*;/, "dialogue-discourse defines no linguistic recognition patterns (the id-safety pattern is not linguistic)");
});

// ── Owner rule gaps ─────────────────────────────────────────────────────────
test("ED-1.5 — self-description fan-out is group-only; planner never changes owners", () => {
  const eligible = [cand("c-nora"), cand("c-omar")];
  const group = frameFor("Tell us about yourselves.", { recipient_type: "group" });
  const single = frameFor("Tell me about yourself.", { recipient_type: "none" });
  const owners = (frame, type) => I.resolveResponseOwners({ recipient_type: type, interpretation: I.interpretUtterance("x"), player_text: "x", candidates: eligible, frame });
  assert.deepEqual(owners(group, "group"), ["c-nora", "c-omar"]);
  assert.deepEqual(owners(single, "none"), ["c-nora"]);
  assert.deepEqual(owners(single, "direct"), ["c-nora"]);
  const plans = D.planResponses({ frame: group, owner_ids: ["c-omar"], responders: {}, names: {} });
  assert.deepEqual(plans.map((p) => p.responder_id), ["c-omar"], "plans are one-to-one with supplied owners");
});

// ── Antecedent derivation ───────────────────────────────────────────────────
test("ED-1.5 N — a heard autonomous LOCAL report is a valid antecedent and scope source", () => {
  const state = D.deriveDiscourseState({
    interaction_history: [{ id: "r1", channel: "local", source: "autonomous-observation", speaker_id: "c-omar", listeners: [PLAYER, "c-nora"], delivery: "heard", submission_id: "rep1", location_id: "hall" }],
    dialogue_history: turnEvents("rep1", "c-omar", "There's a mark on the wall.").slice(1),
    player_id: PLAYER, location_id: "hall"
  });
  assert.equal(state.last_turn.kind, "autonomous_report");
  const scope = D.resolveRecipientScope({ text: "What?", discourse: state, present_ids: ["c-omar", "c-nora"] });
  assert.deepEqual([scope.recipient_type, scope.recipient_ids, scope.inherited], ["direct", ["c-omar"], true]);
  const frame = frameFor("What?", { recipient_type: "direct", discourse: state });
  assert.equal(frame.antecedent.type, "prior_report");
  assert.equal(frame.antecedent.responses[0].text, "There's a mark on the wall.");
  const unheard = D.deriveDiscourseState({ interaction_history: [{ id: "r2", channel: "local", source: "autonomous-observation", speaker_id: "c-omar", listeners: ["c-nora"], delivery: "heard", submission_id: "rep2", location_id: "hall" }], dialogue_history: turnEvents("rep2", "c-omar", "x").slice(1), player_id: PLAYER, location_id: "hall" });
  assert.equal(unheard.last_turn, null, "a report the player did not hear is no antecedent");
});

test("ED-1.5 O — non-spoken owners are not responders; stale and long text handled", () => {
  const long = "word ".repeat(300).trim();
  const base = {
    interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Hey everyone.", recipient_type: "group", recipient_id: "@table", recipient_ids: ["c-nora", "c-omar"], response_owners: [{ order: 0, speaker_id: "c-nora" }, { order: 1, speaker_id: "c-omar" }], location_id: "hall" }],
    dialogue_history: [{ submission_id: "s1", speaker_id: PLAYER, kind: "speech", text: "Hey everyone.", interval: 5 }, { submission_id: "s1", speaker_id: "c-nora", speaker_name: "Nora", kind: "speech", text: long, interval: 5 }],
    player_id: PLAYER, location_id: "hall"
  };
  const state = D.deriveDiscourseState({ ...base, current_interval: 6 });
  assert.deepEqual(state.last_responder_ids, ["c-nora"], "Omar was an authorized owner but never spoke");
  assert.equal(state.last_response_texts[0], long, "repeatable text is not clipped");
  const pending = D.deriveDiscourseState({ ...base, dialogue_history: base.dialogue_history.slice(0, 1), current_interval: 6 });
  assert.deepEqual(pending.last_responder_ids, [], "no committed speech -> no responders");
  assert.equal(D.deriveDiscourseState({ ...base, current_interval: 5 + D.MAX_INTERVAL_GAP + 1 }).last_turn, null, "ancient dialogue is not an antecedent");
  assert.notEqual(D.deriveDiscourseState({ ...base, current_interval: 5 + D.MAX_INTERVAL_GAP }).last_turn, null);
});

// ── Plan facts + plan-aware fallback ────────────────────────────────────────
test("ED-1.5 — plans own fact selection; fallback respects the plan", () => {
  const self = (over = {}) => ({ "c-nora": { self: D.buildSelfKnowledge({ person: { first_name: "Nora", role: "field medical doctor", identity_substrate: { social_expression: "dryly observant", region: "Great Lakes", education_or_trade: "emergency medical training", async_tenure: "first week" }, ...over.person }, known_facts: over.facts ?? [], held_equipment: over.held ?? [] }) } });
  const plan = (text, over = {}, opts = {}) => { const frame = frameFor(text, opts); return { frame, plan: D.planResponses({ frame, owner_ids: ["c-nora"], responders: self(over), names: { "c-nora": "Nora" } })[0] }; };

  // ask_factual: authorized fact or honest "I don't know"; unrelated knowledge never leaks in
  const facts = [{ kind: "direct-observation", text: "The departure cutoff is at one o'clock." }, { kind: "direct-observation", text: "There is a loose cable near the north wall." }];
  const time = plan("What time do we leave?", { facts });
  assert.deepEqual(time.plan.required_facts.map((f) => f.value.text), ["The departure cutoff is at one o'clock."]);
  assert.equal(F.presentFallback(time), "The departure cutoff is at one o'clock.");
  const none = plan("Where did Kirk go?", { facts });
  // No answering fact; only the descriptor of which kind of not-knowing applies.
  assert.deepEqual(none.plan.required_facts, [{ key: "uncertainty", value: { kind: "no_established_fact" } }]);
  assert.equal(F.presentFallback(none), "I don't know.");
  assert.doesNotMatch(F.presentFallback(none), /which part|check/i);

  // personal experience: no invented "first time"
  const personal = plan("Have you been in there before?");
  assert.doesNotMatch(F.presentFallback(personal), /first time/i);
  assert.match(F.presentFallback(personal), /not that i (?:know of|can think of)|don't know/i);
  const withExp = plan("Have you been in there before?", { person: { prior_expedition_experience: "Two prior surveys of the lower levels" } });
  assert.equal(F.presentFallback(withExp), "Two prior surveys of the lower levels.");

  // sarcasm: style-based, never a redirect
  const joke = plan("Well, this seems incredibly safe.");
  assert.equal(F.presentFallback(joke), "Reassuring, isn't it.");
  assert.doesNotMatch(F.presentFallback(joke), /focused/i);

  // role, check-in, challenge
  const role = plan("What's your job here?");
  assert.equal(F.presentFallback(role), "I'm a field medical doctor.");
  assert.match(F.presentFallback(plan("How's everyone doing?", {}, { recipient_type: "group" })), /\S/);
  assert.equal(F.presentFallback(plan("Are you sure about that?")), "I'm only going by what I know.");

  // identity: style hints only; factual substrate values are absent unless authorized
  assert.deepEqual(role.plan.style_hints, { social_expression: "dryly observant" });
  const intro = plan("Tell me about yourself.");
  const introJson = JSON.stringify(D.toAuthorizedContribution(intro.plan, intro.frame, { names: {} }));
  assert.ok(!introJson.includes("emergency medical training") && !introJson.includes("Great Lakes") && !introJson.includes("first week"), "generic self-description offers no background facts");
});

// ── Validation wiring ───────────────────────────────────────────────────────
test("ED-1.5 — validator receives the contribution and enforces the unresolved-reference question", () => {
  const packet = { speaker: { observer_id: "o1" }, authorized_contribution: { discourse_function: "ambiguous_reference" } };
  const candidate = (speech) => ({ version: "yellow-beast-local-dialogue-candidate@v1", observer_id: "o1", speech });
  assert.equal(validateLocalDialogue(packet, candidate("Sure, I know the one.")).code, "LOCAL_PRESENTATION_CONTRIBUTION_UNMET");
  assert.equal(validateLocalDialogue(packet, candidate("Which thing do you mean?")).ok, true);
});

// ── Recovery ────────────────────────────────────────────────────────────────
test("ED-1.5 M — recovery retains the exact frame, plan and contribution", async () => {
  const provider = { name: "never-called", model: "v1", async presentLocal() { throw new Error("offline"); } };
  const state = setup("ed15-m", provider);
  try {
    const call = (text) => state.service.submitQ4CommunicationCanonical({ world_id: state.worldId, channel: "local", text, request_id: "recover-1" });
    await say(state, "Hey everyone.");
    const first = call("Mind telling me a bit about yourselves?");
    const original = first._local_dialogue_contexts;
    assert.equal(original.length, state.ids.length);
    const second = call("Mind telling me a bit about yourselves?");
    const recovered = second._local_dialogue_contexts;
    assert.ok(recovered, "pending receipt recovers its contexts");
    assert.equal(recovered.length, original.length);
    recovered.forEach((context, i) => {
      assert.deepEqual(context.semantic_frame, original[i].semantic_frame);
      assert.deepEqual(context.response_plan, original[i].response_plan);
      assert.deepEqual(context.authorized_contribution, original[i].authorized_contribution);
      assert.equal(context.fallback_text, original[i].fallback_text, "same fallback wording");
      assert.equal(context.recipient_type, original[i].recipient_type);
      assert.equal(context.speaker.personnel_id ?? context.speaker.id, original[i].speaker.personnel_id ?? original[i].speaker.id);
      assert.equal(context.authorized_contribution.discourse_function, "invite_self_description");
    });
  } finally { cleanup(state); }
});
