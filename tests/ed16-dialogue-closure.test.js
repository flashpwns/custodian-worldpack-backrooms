"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const I = require("../tools/dialogue-interpretation");
const continuity = require("../tools/q4-personnel-continuity");
const { validateLocalDialogue, validateDialogueClaims } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const PLAYER = "p-jack";
const UNSAFE = /\[object|q4-player|yb-personnel|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;

function setup(seed, provider = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed16-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED16", seed }).world.id;
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
  return { root, service, worldId, session, playerId, coworkers, ids: coworkers.map((m) => m.personnel_id ?? m.id) };
}
const capture = (packets, speech = "Fine.") => ({ name: "ed16-capture", model: "v1", async presentLocal(packet) { packets.push(packet); return { version: "yellow-beast-local-dialogue-candidate@v1", observer_id: packet.speaker.observer_id, speech }; } });
const say = (state, text, extra = {}) => state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra });
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
const strings = (value, out = []) => { if (typeof value === "string") out.push(value); else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.push(`key:${k}`); strings(v, out); } return out; };

// ── A/B/C: assignment presentation ──────────────────────────────────────────
test("ED-1.6 A/B/C — assignments are rendered to safe phrases; raw task objects never leave the helper", async () => {
  // The follow task is worded literally, to the person it is spoken to ("staying with" read as lodging).
  assert.equal(D.presentAssignment({ task: { type: "follow", state: "active", target: PLAYER }, player_id: PLAYER }), "following you");
  assert.equal(D.presentAssignment({ task: { type: "follow", state: "active", target: "c-omar" }, names: { "c-omar": "Omar" } }), "following Omar");
  // The team runtime's DEFAULT follow posture is not an assignment: it never masks the assigned task;
  // an ORDERED follow is the current assignment.
  assert.equal(D.presentAssignment({ task: { type: "follow", state: "active", target: PLAYER }, primary_task: "verbal-recall", player_id: PLAYER }), "handling observation and verbal recall");
  assert.equal(D.presentAssignment({ task: { type: "follow", state: "active", target: PLAYER, order_id: "o-1" }, primary_task: "verbal-recall", player_id: PLAYER }), "following you");
  assert.equal(D.presentAssignment({ task: { type: "operate", state: "active", target: "survey-instrument" }, equipment: { "survey-instrument": { id: "survey-instrument", label: "Survey instrument" } } }), "operating the survey instrument");
  assert.equal(D.presentAssignment({ task: { type: "operate", state: "active", target: "unknown-thing" } }), null, "unresolvable carried/operated item -> null");
  assert.equal(D.presentAssignment({ task: { type: "teleport", state: "active" } }), null);
  assert.equal(D.presentAssignment({ task: "Handling the medical kit" }), "Handling the medical kit", "already-safe strings are kept");
  assert.equal(D.presentAssignment({ task: "q4-player-abc123def" }), null);
  assert.equal(D.presentAssignment({ task: null, primary_task: "verbal-recall" }), "handling observation and verbal recall");
  assert.equal(D.presentAssignment({ task: null, primary_task: "some-unmapped-slug" }), null);
  const self = D.buildSelfKnowledge({ person: { first_name: "Nora" }, task: { type: "follow", state: "active", target: PLAYER }, player_id: PLAYER });
  assert.equal(self.current_assignment, "following you");
  assert.equal(typeof D.buildSelfKnowledge({ person: { first_name: "Nora" }, task: { type: "x" } }).current_assignment, "object", "null, not a raw object");
  assert.equal(D.buildSelfKnowledge({ person: { first_name: "Nora" }, task: { type: "x" } }).current_assignment, null);

  const packets = [];
  const state = setup("ed16-a", capture(packets));
  try {
    const before = state.session.run.expedition.dialogue_history.length;
    await say(state, "Mind telling me a bit about yourselves?");
    const spoken = state.session.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId);
    assert.equal(spoken.length, state.ids.length);
    const mine = packets.filter((p) => p.authorized_contribution?.discourse_function === "invite_self_description");
    assert.equal(mine.length, state.ids.length);
    for (const packet of mine) {
      const contribution = packet.authorized_contribution;
      const bad = strings(contribution).filter((text) => UNSAFE.test(text));
      assert.deepEqual(bad, [], "no [object Object], internal ids or raw ids anywhere in the contribution");
      const assignment = contribution.required_facts.find((f) => f.key === "current_assignment");
      if (assignment) assert.equal(typeof assignment.value, "string");
    }
    for (const event of spoken) assert.doesNotMatch(event.text, UNSAFE);
    assert.ok(spoken.some((e) => /following you|handling observation and verbal recall|delivering the startup materials|compiling the layout record/.test(e.text)) || mine.some((p) => p.authorized_contribution.required_facts.some((f) => f.key === "current_assignment")), "the follow task renders as a phrase");
    // receipt snapshots are safe too
    const receipt = state.session.run.expedition.communication_receipts?.at(-1);
    if (receipt) assert.deepEqual(strings(receipt.response_contexts ?? []).filter((t) => /\[object|q4-player \[/.test(t)), []);
  } finally { cleanup(state); }
});

// ── D/E: same-turn wording has one model-visible authority ──────────────────
test("ED-1.6 D/E — accepted same-turn wording lives only in the contribution, without ids", async () => {
  const packets = [];
  let n = 0;
  const provider = { name: "ed16-seq", model: "v1", async presentLocal(packet) { packets.push(packet); n += 1; return { version: "yellow-beast-local-dialogue-candidate@v1", observer_id: packet.speaker.observer_id, speech: `Line ${n}.` }; } };
  const state = setup("ed16-de", provider);
  try {
    await say(state, "Hey everyone.");
    assert.equal(packets.length, state.ids.length);
    assert.deepEqual(packets[0].authorized_contribution.same_turn_prior_responses, []);
    const last = packets.at(-1).authorized_contribution.same_turn_prior_responses;
    assert.deepEqual(last.map((p) => p.text), packets.slice(0, -1).map((_, i) => `Line ${i + 1}.`), "accepted wording, in owner order");
    for (const packet of packets) {
      assert.equal("same_turn_prior_responses" in packet, false, "no duplicate top-level authority");
      assert.deepEqual(strings(packet.authorized_contribution).filter((t) => t === "key:speaker_id" || t === "key:responder_id" || UNSAFE.test(t)), []);
      for (const item of packet.authorized_contribution.same_turn_prior_responses) assert.deepEqual(Object.keys(item).sort(), ["speaker_name", "text"]);
    }
    assert.ok(!JSON.stringify(packets.at(-1)).includes("_same_turn_prior_responses"));
  } finally { cleanup(state); }
});

// ── F: direct ownership question to a non-holder ────────────────────────────
test("ED-1.6 F — a direct ownership question to a non-holder is still answered, without making them the owner", async () => {
  const packets = [];
  const state = setup("ed16-f", capture(packets));
  try {
    const equipment = state.session.run.expedition.equipment;
    const held = Object.values(equipment).find((item) => state.ids.includes(item.holder));
    const holderIdx = state.ids.indexOf(held.holder);
    const asked = state.coworkers[(holderIdx + 1) % state.coworkers.length];
    const holderName = state.coworkers[holderIdx].first_name;
    const before = state.session.run.expedition.dialogue_history.length;
    await say(state, `Who has the ${held.label.toLowerCase()}?`, { target: asked.first_name });
    const events = state.session.run.expedition.dialogue_history.slice(before);
    assert.deepEqual(events.slice(1).map((e) => e.speaker_id), [asked.personnel_id ?? asked.id], "the addressee answers");
    const contribution = packets.at(-1).authorized_contribution;
    const fact = contribution.required_facts.find((f) => f.key === "item_holder").value;
    assert.equal(fact.holder_is_self, false);
    assert.equal(fact.holder_name, holderName);
    // deterministic wording never claims the item
    assert.equal(D.frameObligatesResponse({ discourse_function: "ask_item_ownership", referents: [{ type: "equipment", resolved: true, holder: "c-nora" }] }, "c-omar", { recipient_type: "direct" }), true);
    assert.equal(D.frameObligatesResponse({ discourse_function: "ask_item_ownership", referents: [{ type: "equipment", resolved: true, holder: "c-nora" }] }, "c-omar", { recipient_type: "group" }), false);
    // The observer authority grants Omar knowledge of the camera's holder; without that grant custody is unknown.
    const plan = D.planResponses({ frame: { discourse_function: "ask_item_ownership", referents: [{ type: "equipment", id: "cam", resolved: true, label: "Field camera", holder: "c-nora" }] }, owner_ids: ["c-omar"], responders: { "c-omar": { self: { custody_known: { cam: true } } } }, names: { "c-nora": "Nora" } })[0];
    const ungranted = D.planResponses({ frame: { discourse_function: "ask_item_ownership", referents: [{ type: "equipment", id: "cam", resolved: true, label: "Field camera", holder: "c-nora" }] }, owner_ids: ["c-omar"], names: { "c-nora": "Nora" } })[0];
    assert.equal(F.presentFallback({ frame: { discourse_function: "ask_item_ownership", referents: [] }, plan: ungranted }), "I don't know who has the field camera.", "no observer grant: custody stays unknown (fail closed)");
    assert.equal(F.presentFallback({ frame: { discourse_function: "ask_item_ownership", referents: [] }, plan }), "The field camera is with Nora.");
  } finally { cleanup(state); }
});

// ── G: validator item authority ─────────────────────────────────────────────
test("ED-1.6 G — validator item identity comes from the canonical resolver / resolved referent facts", () => {
  const src = fs.readFileSync(path.join(__dirname, "../tools/ai-local-dialogue.js"), "utf8");
  assert.doesNotMatch(src, /EQUIPMENT_KEYWORDS|POSSESSION_PATTERNS|DISPOSAL_OR_LOCATION/, "no second item map in the validator");
  assert.match(fs.readFileSync(path.join(__dirname, "../tools/dialogue-validation.js"), "utf8"), /resolveEquipmentReferent/);
  const run = { expedition: { equipment: { cam: { id: "cam", label: "35mm field camera", type: "35mm-camera", holder: "c-nora" }, radio: { id: "radio", label: "Survey radio", type: "survey-radio", holder: "c-omar" } } } };
  const packet = (id) => ({ speaker: { observer_id: id }, visible_context: { visible_objects: [] } });
  const candidate = (id, speech) => ({ observer_id: id, speech });
  assert.equal(validateDialogueClaims(packet("c-omar"), candidate("c-omar", "I have the camera right here."), run).code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(validateDialogueClaims(packet("c-nora"), candidate("c-nora", "I have the camera right here."), run).ok, true);
  assert.equal(validateDialogueClaims(packet("c-omar"), candidate("c-omar", "I have a question about that."), run).ok, true);
  const twoCameras = { expedition: { equipment: { a: { id: "a", label: "Field camera", holder: "c-nora" }, b: { id: "b", label: "Camera bag", holder: "c-nora" } } } };
  assert.equal(validateDialogueClaims(packet("c-omar"), candidate("c-omar", "I have the camera."), twoCameras).ok, true, "an ambiguous item is not identified, so no false contradiction");
  // referent facts in the contribution
  const withFact = { speaker: { observer_id: "o1" }, authorized_contribution: { discourse_function: "ask_item_ownership", required_facts: [{ key: "item_holder", value: { label: "Field camera", holder_name: "Nora", holder_is_self: false } }] } };
  const cand = (speech) => ({ version: "yellow-beast-local-dialogue-candidate@v1", observer_id: "o1", speech });
  assert.equal(validateLocalDialogue(withFact, cand("I've got the field camera.")).code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(validateLocalDialogue(withFact, cand("The field camera is with Nora.")).ok, true);
});

// ── H/I/J: self-knowledge restraint ─────────────────────────────────────────
test("ED-1.6 H/I/J — facts offered for self-description, background and experience questions", () => {
  const person = { first_name: "Nora", role: "field medical doctor", identity_substrate: { social_expression: "dryly observant", region: "Great Lakes", education_or_trade: "emergency medical training", async_tenure: "first week", mundane_preference: "paper maps", pre_expedition_concern: "a parking meter" } };
  const responders = { "c-nora": { self: D.buildSelfKnowledge({ person, task: { type: "wait", state: "active" } }) } };
  const plan = (text, type = "group") => { const frame = D.buildSemanticFrame({ text, recipient_type: type }); return { frame, plan: D.planResponses({ frame, owner_ids: ["c-nora"], responders, names: {} })[0] }; };

  const intro = plan("Mind telling me a bit about yourselves?");
  assert.deepEqual(intro.plan.required_facts.map((f) => f.key), ["name", "role", "current_assignment"]);
  assert.deepEqual(intro.plan.optional_facts, []);
  const blob = JSON.stringify(D.toAuthorizedContribution(intro.plan, intro.frame));
  for (const secret of ["emergency medical training", "first week", "Great Lakes", "paper maps", "parking meter"]) assert.ok(!blob.includes(secret), secret);
  assert.equal(F.presentFallback(intro), "I'm Nora, a field medical doctor. I'm waiting here.");

  const background = plan("What's your background?", "direct");
  assert.equal(background.frame.discourse_function, "ask_personal_experience");
  assert.equal(background.frame.requested_content, "background");
  assert.deepEqual(background.plan.required_facts, [{ key: "identity_fact", value: { education_or_trade: "emergency medical training" } }]);
  assert.equal(F.presentFallback(background), "My background is emergency medical training.");
  const bgBlob = JSON.stringify(D.toAuthorizedContribution(background.plan, background.frame));
  assert.ok(!bgBlob.includes("Great Lakes") && !bgBlob.includes("paper maps") && !bgBlob.includes("parking meter"), "only authorized background facts");

  const experience = plan("Have you been in there before?", "direct");
  assert.equal(experience.frame.requested_content, "personal_experience");
  assert.deepEqual(experience.plan.required_facts, [{ key: "uncertainty", value: { kind: "no_established_personal_history" } }], "no experience fact; only which kind of not-knowing applies");
  assert.deepEqual(experience.plan.optional_facts, [], "async_tenure is not expedition experience");
  assert.equal(F.presentFallback(experience), "Not that I can think of.");
});

// ── K: prior-turn reclassification ──────────────────────────────────────────
test("ED-1.6 K — prior 'Nora, what?' is reconstructed from the residual utterance; stored text is untouched", () => {
  const state = D.deriveDiscourseState({
    interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Nora, what?", targets: ["Nora Vance"], recipient_type: "direct", recipient_id: "c-nora", recipient_ids: ["c-nora"], location_id: "hall" }],
    dialogue_history: [], player_id: PLAYER, location_id: "hall"
  });
  assert.equal(state.last_turn.player_text, "Nora, what?");
  assert.equal(state.last_turn.discourse_function, "clarify_previous");
  assert.equal(state.last_player_utterance, "Nora, what?");
});

// ── L: provider prompt contract ─────────────────────────────────────────────
test("ED-1.6 L — provider prompts treat authorized_contribution as the primary semantic authority", () => {
  const hosted = fs.readFileSync(path.join(__dirname, "../tools/ai-hosted-transport.js"), "utf8");
  const local = fs.readFileSync(path.join(__dirname, "../tools/ai-local-model-provider.js"), "utf8");
  const { LOCAL_DIALOGUE_WORDING_TEXT: contract } = require("../tools/dialogue-prompt-contract");
  // Both providers consume the ONE shared wording contract.
  assert.match(hosted, /LOCAL_DIALOGUE_WORDING_TEXT/);
  assert.match(local, /LOCAL_DIALOGUE_WORDING_LINES/);
  assert.match(contract, /authorized_contribution is the ONLY semantic authority/);
  assert.match(contract, /already-authorized contribution by a coworker who is physically present/);
  assert.match(contract, /not an assistant, guide, support agent or chatbot/);
  assert.match(contract, /never offer help or assistance/);
  assert.match(contract, /Do not invent biography, prior experience/);
  assert.match(contract, /Never call them 'the player'/);
  assert.doesNotMatch(hosted, /tendencies, relationship, memories, identity, role, condition, current task, equipment, qualifications, and shared history/);
});

// ── lean containment ────────────────────────────────────────────────────────
test("ED-1.6 — plan-carrying factual/personal turns lose unscored memory bags, shell, visible objects and recent tail", async () => {
  const packets = [];
  const state = setup("ed16-lean", capture(packets));
  try {
    await say(state, "Hey everyone.");
    packets.length = 0;
    await say(state, "What time do we leave?");
    const p = packets.at(-1);
    assert.equal(p.authorized_contribution.discourse_function, "ask_factual");
    assert.equal(p.speaker_shell, null);
    assert.deepEqual(p.visible_context.visible_objects, []);
    assert.deepEqual(p.speaker.memories.filter((m) => !m.relevance), [], "no unscored memory bag");
    assert.deepEqual(p.speaker.recent_dialogue, []);
    assert.deepEqual(p.speaker.shared_history, []);
    assert.deepEqual(p.speaker.held_equipment, []);
  } finally { cleanup(state); }
});

// ── M: knowledge relevance is semantic, not a wording function ──────────────
test("ED-1.6 M — known-answer relevance is structured data; wording cannot change owners", async () => {
  const original = continuity.presentKnownAnswer;
  const runWith = async (impl) => {
    continuity.presentKnownAnswer = impl;
    const state = setup("ed16-m");
    try {
      const target = state.coworkers[0].first_name;
      await say(state, "Call me Jack.", { target });
      const before = state.session.run.expedition.dialogue_history.length;
      await say(state, "Does anyone remember what I told you?");
      return state.session.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId).map((e) => e.speaker_id);
    } finally { cleanup(state); }
  };
  try {
    const a = await runWith(() => null);
    const b = await runWith((...args) => original(...args));
    const c = await runWith(() => "Someone: Always answers.");
    assert.deepEqual(a, b);
    assert.deepEqual(a, c, "owners do not depend on the string producer");
  } finally { continuity.presentKnownAnswer = original; }
  const structured = continuity.resolveKnownAnswer({ expedition: {}, _world: { characters: {} }, team: {} }, "x", "hello", null);
  assert.equal(structured, null);
});
