"use strict";

// ED-26 — human-conversation semantics convergence. Stateful, branching and bounded property-style tests
// over the deterministic conversation layer: self-state, response bases and explanations, the topic
// stack, procedural and temporal references, narrowing repairs, group ownership, kinds of not-knowing,
// the requested-action and spatial-selection interfaces, provider independence, cold reload and stale
// state. Later turns are chosen from the canonical state earlier turns produced.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const V = require("../tools/dialogue-validation");
const spatial = require("../tools/spatial-event-contract");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { DesktopService } = require("../desktop/service");

// ─── harness (production service path) ───────────────────────────────────────────────────────────
function setup(seed, provider = null, { offline = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed26-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  if (offline) service.updateSettings({ provider: "offline" });
  const worldId = service.createWorld({ name: "ED26", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const logs = [];
  service.log = (line) => logs.push(String(line));
  const state = { root, service, worldId, logs };
  Object.defineProperty(state, "run", { get: () => service.session(worldId, "field-researcher").run });
  state.playerId = state.run.session.startup.player.observer_id;
  state.team = state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  state.ids = state.team.map((m) => m.personnel_id ?? m.id);
  return state;
}
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
let counter = 0;
async function turn(state, text, extra = {}) {
  const id = extra.request_id ?? `t-${++counter}`;
  await state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: id, ...extra });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const spoken = run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId);
  return { id, contexts, spoken, fn: contexts[0]?.semantic_frame.discourse_function ?? null, owners: contexts.map((c) => c.target_worker_id), basis: (c) => D.responseBasisFromPlan(c.response_plan, c.semantic_frame) };
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

// ─── Blocker 15: stateful, branching conversation ────────────────────────────────────────────────
test("stateful — later turns are chosen from the canonical meaning of earlier ones", async () => {
  const state = setup("ed26-branch", garbage());
  try {
    // A subjective group question; branch on the recorded stance of the first answer.
    const q1 = await turn(state, "Are you all excited for day one?");
    assert.equal(q1.fn, "check_in");
    assert.equal(q1.owners.length, state.ids.length, "an individual group question: every present coworker");
    const stance = q1.contexts[0].response_plan.required_facts.find((f) => f.key === "self_state_answer").value.answer;
    const follow = await turn(state, stance === "not_especially" ? "What makes you say that?" : "Why?");
    assert.equal(follow.fn, "ask_explanation");
    assert.deepEqual(follow.owners, [q1.owners[0]], "the one who said it explains it");
    assert.equal(follow.contexts[0].response_plan.required_facts[0].value.kind, q1.basis(q1.contexts[0]).kind, "the explanation is the recorded basis, nothing else");
    // New topic: custody, then its provenance.
    const q2 = await turn(state, "Who has the field camera?");
    assert.equal(q2.fn, "ask_item_ownership");
    const how = await turn(state, "How do you know?");
    assert.equal(how.contexts[0].response_plan.required_facts[0].value.kind, "custody");
    // Return to the earlier topic without naming it: the earlier question is asked again.
    const back = await turn(state, "Anyway, back to what we were talking about.");
    assert.equal(back.fn, "check_in", "the topic stack returns to the self-state question");
    assert.equal(back.contexts[0].semantic_frame.topic_return.topic, "self_state");
    // An ambiguous procedural question (no canonical procedure) is clarified, then narrowed.
    state.run.expedition.day1_opener.personnel_briefing.status = "active";
    const next = await turn(state, "Whats next?");
    assert.equal(next.contexts[0].response_plan.may_ask_clarifying_question, true);
    const narrowed = await turn(state, "I mean for the day");
    assert.equal(narrowed.fn, "ask_next_step");
    assert.ok(narrowed.contexts[0].semantic_frame.resumed_question, "the fragment narrows the open question");
    assert.deepEqual(narrowed.owners, next.owners, "the one who asked for clarification answers");
    assert.equal(narrowed.contexts[0].response_plan.may_ask_clarifying_question, true, "still no canonical procedure: still a clarification, never a guess");
    // With the canonical procedure back, the same narrowing answers.
    state.run.expedition.day1_opener.personnel_briefing.status = "concluded";
    const again = await turn(state, "Whats next?");
    assert.equal(again.contexts[0].response_plan.required_facts[0].key, "current_procedure");
  } finally { cleanup(state); }
});

// ─── Blocker 16: bounded property-style checks ───────────────────────────────────────────────────
const BASES = [
  { kind: "self_state", state: "ordinary", affect: [] },
  { kind: "no_known_fact", uncertainty: "no_established_fact" },
  { kind: "no_known_fact", uncertainty: "not_told" },
  { kind: "no_known_fact", uncertainty: "did_not_perceive", past_perception: true },
  { kind: "no_known_fact", uncertainty: "no_established_personal_history" },
  { kind: "observation" },
  { kind: "briefing_instruction", current_step: "get acquainted with the team", next_step: "report to Equipment Staging", source: "the briefing" },
  { kind: "custody", label: "35mm field camera", holder_name: "you", holder_is_self: false },
  { kind: "clarification" }
];
const OTHER_BASIS_LINES = { observation: "I saw it myself.", briefing_instruction: "That's what Maxwell told us at the briefing.", no_known_fact: "Because nobody's told me.", self_state: "It's just how I feel.", custody: "Because it's with me." };
test("property — for every basis, an explanation states that basis and never another", () => {
  const discourseWith = (basis) => ({ turns: [], last_turn: { kind: "player_exchange", interaction_id: "i1", player_text: "Q?", responder_ids: ["c-a"], responses: [{ speaker_id: "c-a", speaker_name: "Ana", text: "Earlier line.", basis }] } });
  for (const basis of BASES) {
    const frame = D.buildSemanticFrame({ text: "Why do you say that?", discourse: discourseWith(basis) });
    const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
    assert.deepEqual(plan.required_facts, [{ key: "explanation_basis", value: basis }], basis.kind);
    const contribution = D.toAuthorizedContribution(plan, frame);
    const line = F.presentFallback({ frame, plan });
    assert.equal(V.validateContribution(contribution, line).ok, true, `${basis.kind}/${basis.uncertainty ?? ""}: fallback "${line}"`);
    for (const [kind, other] of Object.entries(OTHER_BASIS_LINES)) {
      if (kind === basis.kind) continue;
      assert.equal(V.validateContribution(contribution, other).ok, false, `${basis.kind} must not be explained as ${kind}: "${other}"`);
    }
  }
});

test("property — narrowing an unresolved reference resolves uniquely or stays a clarification", () => {
  const EQUIPMENT = { cam: { id: "cam", label: "35mm field camera", holder: "p" }, radio: { id: "radio", label: "Survey radio", holder: "c-a" } };
  const questions = ["Is that door open?", "Who has the thing?", "You know the thing by the thing?", "Whats next?"];
  const fragments = ["I mean the camera.", "No, the other one.", "The door.", "By the table.", "I mean for the day", "After the briefing."];
  for (const q of questions) {
    const first = D.buildSemanticFrame({ text: q, equipment: EQUIPMENT });
    for (const fragment of fragments) {
      const frame = D.buildSemanticFrame({ text: fragment, equipment: EQUIPMENT, discourse: { turns: [], pending_question: { discourse_function: first.discourse_function, player_text: q, interaction_id: "i1", responder_ids: ["c-a"] } } });
      assert.notEqual(frame.discourse_function, "make_statement", `${q} -> ${fragment}: never a disconnected statement`);
      const resolved = !frame.unresolved_reference && (frame.referents ?? []).every((r) => r.resolved !== false);
      assert.ok(resolved || frame.discourse_function === "ambiguous_reference" || frame.discourse_function === "ask_next_step" || frame.unresolved_reference, `${q} -> ${fragment}: ${frame.discourse_function}`);
    }
  }
});

test("property — response count follows the semantic group policy, not the phrase", async () => {
  const state = setup("ed26-owners", garbage());
  const all = () => state.ids.length;
  try {
    const cases = [
      ["Hello everyone", all()], ["Good morning, y'all.", all()],
      ["How are you guys feeling?", all()], ["Are you all nervous?", all()],
      ["Have any of you been there before?", all()], ["What do each of you think?", all()],
      ["What time do we leave?", 1], ["What's next, everyone?", 1],
      ["Well, this seems incredibly safe.", 1], ["Excited?", 1]
    ];
    for (const [text, expected] of cases) assert.equal((await turn(state, text)).owners.length, expected, text);
    const named = state.team[1].first_name;
    assert.deepEqual((await turn(state, `${named}, are you excited?`)).owners, [state.ids[1]], "direct question: only the addressee");
    assert.deepEqual((await turn(state, `${named}, have you been there before?`)).owners, [state.ids[1]]);
  } finally { cleanup(state); }
});

// ─── Blocker 17: provider independence after the new semantics ───────────────────────────────────
const SEQUENCE = ["Are you all excited for day one?", "What makes you say that?", "Who has the field camera?", "How do you know?", "Anyway, back to what we were talking about.", "Whats next?", "I mean for the day", "Have you been there before?", "Why do you say that?", "You know the thing by the thing?", "I mean the camera.", "Did you see anything before Maxwell left?", "What do each of you think?"];
async function semanticDigest(provider, { offline = false } = {}) {
  const state = setup("ed26-indep", provider, { offline });
  try {
    for (const [i, text] of SEQUENCE.entries()) await turn(state, text, { request_id: `s-${i}` });
    const run = state.run;
    const spokenNormalized = (key, value) => (key === "text" && typeof value === "string" ? "<spoken>" : value);
    return crypto.createHash("sha256").update(JSON.stringify({
      contexts: run.expedition.communication_receipts.map((r) => (r.response_contexts ?? []).map((c) => [c.target_worker_id, c.semantic_frame, c.response_plan, c.authorized_contribution])),
      interactions: run.expedition.interaction_history.map((i) => [i.recipient_type, (i.response_owners ?? []).map((o) => o.speaker_id ?? o), i.requested_action ?? null]),
      custody: Object.fromEntries(Object.entries(run.expedition.equipment).map(([k, v]) => [k, v.holder]))
    }, spokenNormalized)).digest("hex");
  } finally { cleanup(state); }
}
test("independence — fallback-only, malformed, throwing and wording providers yield identical semantics", async () => {
  const wording = scriptedLocal((body) => {
    const user = body.messages.find((m) => m.role === "user").content;
    if (/Why you said your previous line/.test(user)) return "It's just how I feel right now.";
    if (/What comes next/.test(user) || /whole day/.test(user)) return "Get acquainted, then report to Equipment Staging.";
    if (/They asked if you feel/.test(user)) return "Not especially.";
    return "Hm.";
  });
  const reference = await semanticDigest(null, { offline: true });
  for (const [name, provider] of [["garbage", garbage()], ["throwing", throwing()], ["wording", wording]]) assert.equal(await semanticDigest(provider), reference, name);
});

// ─── cold reload ─────────────────────────────────────────────────────────────────────────────────
test("cold reload — an open clarification and an answered question both survive a restart", async () => {
  const state = setup("ed26-reload", garbage());
  try {
    state.run.expedition.day1_opener.personnel_briefing.status = "active"; // no procedure: clarified
    const next = await turn(state, "Whats next?");
    assert.equal(next.contexts[0].response_plan.may_ask_clarifying_question, true);
    state.run.expedition.day1_opener.personnel_briefing.status = "concluded";
    state.service.persistSession?.(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    state.service.shutdown?.();
    const reopened = { ...state, service: new DesktopService({ appDataPath: state.root, localDialogueProvider: garbage(), developerMode: true }) };
    Object.defineProperty(reopened, "run", { get: () => reopened.service.session(state.worldId, "field-researcher").run });
    assert.equal(reopened.service.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    const narrowed = await turn(reopened, "I mean for the day");
    assert.equal(narrowed.fn, "ask_next_step");
    assert.ok(narrowed.contexts[0].semantic_frame.resumed_question, "the open clarification was reconstructed after restart");
    const q = await turn(reopened, "Who has the field camera?");
    reopened.service.shutdown?.();
    const third = { ...state, service: new DesktopService({ appDataPath: state.root, localDialogueProvider: garbage(), developerMode: true }) };
    Object.defineProperty(third, "run", { get: () => third.service.session(state.worldId, "field-researcher").run });
    assert.equal(third.service.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    const why = await turn(third, "How do you know?");
    assert.equal(why.contexts[0].response_plan.required_facts[0].value.kind, "custody");
    assert.deepEqual(why.owners, q.owners);
    third.service.shutdown?.();
  } finally { cleanup(state); }
});

// ─── stale state ─────────────────────────────────────────────────────────────────────────────────
test("stale state — a custody explanation invalidated during generation never commits its stale claim", async () => {
  let state = null;
  let moved = false;
  const provider = { name: "local", model: "m", async presentLocal(packet) {
    const c = packet.authorized_contribution;
    if (c.discourse_function === "ask_explanation" && !moved) {
      const camera = Object.values(state.run.expedition.equipment).find((item) => /camera/i.test(item.label));
      camera.holder = state.ids[2]; camera.history?.push?.({ event: "handed-over", holder: state.ids[2], at: 0 });
      moved = true;
      return { speech: "Because you've got it." };
    }
    return { speech: "Hm." };
  } };
  state = setup("ed26-stale", provider);
  try {
    await turn(state, "Who has the field camera?");
    const why = await turn(state, "How do you know?");
    for (const line of why.spoken) assert.doesNotMatch(line.text, /you'?ve got it|with you/i, "the stale custody claim was not committed");
    assert.ok(state.logs.some((l) => /pre-commit revalidation (?:rejected|cancelled)/.test(l)));
  } finally { cleanup(state); }
});

// ─── Blocker 8: temporal / event references ──────────────────────────────────────────────────────
test("temporal — canonical anchors resolve; future or unrecorded events are clarified", async () => {
  const state = setup("ed26-temporal", garbage());
  try {
    const before = await turn(state, "Did you see anything before Maxwell left?");
    const ref = before.contexts[0].semantic_frame.temporal_reference;
    assert.deepEqual([ref.anchor, ref.resolved], ["maxwell_departure", true], "Maxwell's departure is a recorded canonical event");
    const future = await turn(state, "When we get back, what then?");
    assert.equal(future.contexts[0].semantic_frame.temporal_reference.resolved, false);
    assert.equal(future.contexts[0].response_plan.may_ask_clarifying_question, true);
    const said = D.resolveTemporalReference({ text: "What did you mean when you said that?", discourse: { last_turn: { interval: 4 } }, now: 6 });
    assert.deepEqual([said.anchor, said.resolved, said.window.from], ["prior_utterance", true, 4]);
    assert.equal(D.resolveTemporalReference({ text: "for the day", now: 3 }).kind, "operation_day");
    // An older save without the recorded departure: unresolved, never guessed.
    delete state.run.expedition.day1_opener.personnel_briefing.concluded_at_interval;
    const old = await turn(state, "Did you notice anything before Maxwell left?");
    assert.equal(old.contexts[0].semantic_frame.temporal_reference.resolved, false);
  } finally { cleanup(state); }
});

// ─── Blockers 9 + 14: distinct kinds of not-knowing ──────────────────────────────────────────────
test("uncertainty — distinct kinds of not-knowing are planned and explained distinctly", () => {
  const kindOf = (text, recipient_type = "direct") => {
    const frame = D.buildSemanticFrame({ text, recipient_type });
    const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
    return plan.required_facts.find((f) => f.key === "uncertainty")?.value.kind ?? (plan.may_ask_clarifying_question ? "clarify" : null);
  };
  assert.equal(kindOf("Did you see anything earlier?"), "did_not_perceive");
  assert.equal(kindOf("What time do we leave?"), "not_told");
  assert.equal(kindOf("Have you been there before?"), "no_established_personal_history");
  assert.equal(kindOf("What do you think?"), "no_established_opinion");
  assert.equal(kindOf("Where is the exit?"), "no_established_fact");
  assert.equal(kindOf("Is that door open?"), "clarify");
  // Missing biography is neither positive nor negative experience.
  const frame = D.buildSemanticFrame({ text: "Have you been there before?", recipient_type: "direct" });
  const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
  const contribution = D.toAuthorizedContribution(plan, frame);
  for (const bad of ["Yeah, a couple of times.", "No, never.", "This is my first time."]) assert.equal(V.validateContribution(contribution, bad).ok, false, bad);
  assert.equal(V.validateContribution(contribution, "Not that I can think of.").ok, true);
});

// ─── Blocker 10: requested-action interface ──────────────────────────────────────────────────────
test("action interface — a request becomes structured, unexecuted intent; nothing happens", async () => {
  const state = setup("ed26-action", garbage());
  try {
    const [actor, recipient] = [state.team[0], state.team[1]];
    const custodyBefore = JSON.stringify(Object.fromEntries(Object.entries(state.run.expedition.equipment).map(([k, v]) => [k, v.holder])));
    const r = await turn(state, `${actor.first_name}, give ${recipient.first_name} the mass spectrometer.`);
    const record = state.run.expedition.interaction_history.at(-1);
    assert.equal(record.requested_action.action, "transfer_item");
    assert.match(record.requested_action.object.label, /spectrometer/i);
    assert.deepEqual(record.requested_action.recipient, { id: state.ids[1], name: recipient.first_name });
    assert.deepEqual([record.requested_action.status, record.requested_action.reason], ["not_executed", "no_action_authority"]);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(state.run.expedition.equipment).map(([k, v]) => [k, v.holder]))), custodyBefore, "custody is unchanged");
    const disposition = r.contexts[0].response_plan.required_facts.find((f) => f.key === "request_disposition").value;
    assert.equal(disposition.requested_action.status, "not_executed");
    for (const done of ["Here you go.", "Done, it's with him now.", "Sure thing."]) assert.equal(V.validateContribution(r.contexts[0].authorized_contribution, done).ok, false, done);
    const wait = await turn(state, "Wait here.");
    assert.equal(wait.owners.length, 1, "an untargeted request is acknowledged by one listener");
    assert.equal(state.run.expedition.interaction_history.at(-1).requested_action.action, "hold_position");
  } finally { cleanup(state); }
});

// ─── Blocker 11: spatial-selection interface ─────────────────────────────────────────────────────
test("spatial interface — a renderer selection is input, checked against canonical spatial state", async () => {
  const state = setup("ed26-spatial", garbage());
  try {
    const run = state.run;
    const now = run.expedition.clock?.interval ?? 0;
    const base = { type: "spatial_reference_selected", at: now, observer_id: state.playerId, entity_id: state.ids[0], entity_kind: "person", label: state.team[0].first_name };
    const ok = spatial.resolveSpatialReferenceSelection(run, { ...base, candidate_ids: [state.ids[0], state.ids[1]], relation: "beside", relation_target_id: state.ids[1], revision: 3 });
    assert.equal(ok.ok, true);
    assert.equal(ok.selection.location_id, run.spatial.player_location);
    assert.equal(spatial.resolveSpatialReferenceSelection(run, { ...base, position: [1, 2, 3] }).code, "SPATIAL_EVENT_RENDERER_STATE");
    assert.equal(spatial.resolveSpatialReferenceSelection(run, { ...base, entity_id: "ghost" }).code, "SPATIAL_SELECTION_NOT_PERCEIVABLE");
    assert.equal(spatial.resolveSpatialReferenceSelection(run, { ...base, candidate_ids: [state.ids[1]] }).code, "SPATIAL_SELECTION_NOT_AMONG_CANDIDATES");
    assert.equal(spatial.resolveSpatialReferenceSelection(run, { ...base, at: now - 10 }, { now }).code, "SPATIAL_SELECTION_STALE");
    assert.equal(spatial.resolveSpatialReferenceSelection(run, { ...base, relation: "teleported" }).code, "SPATIAL_EVENT_FIELD_INVALID");
    // In production a selection the canon cannot confirm leaves the reference unresolved (clarified).
    const r = await turn(state, "Is that door open?", { spatial_selection: { entity_id: "door-that-does-not-exist", kind: "door", label: "Blast door" } });
    assert.equal(r.fn, "ambiguous_reference");
    assert.ok(state.logs.some((l) => /\[YB:SPATIAL_TRACE\].*SPATIAL_SELECTION_NOT_PERCEIVABLE/.test(l)));
  } finally { cleanup(state); }
});

// ─── Blocker 12: developer observability ─────────────────────────────────────────────────────────
test("developer trace — each turn is correlatable end to end, bounded, never player-facing", async () => {
  const state = setup("ed26-trace", garbage());
  try {
    const r = await turn(state, "Who has the field camera?", { request_id: "trace-1" });
    const discourse = state.logs.find((l) => l.startsWith("[YB:DISCOURSE_TRACE]") && l.includes('"request_id":"trace-1"'));
    const commit = state.logs.find((l) => l.startsWith("[YB:COMMIT_TRACE]") && l.includes('"request_id":"trace-1"'));
    assert.ok(discourse && commit, "discourse and commit traces share the request id");
    const c = JSON.parse(commit.slice(commit.indexOf("{")));
    assert.equal(c.committed[0].event_id, r.spoken[0].id);
    assert.equal(c.turns[0].basis, "custody");
    assert.ok(Number.isFinite(c.turns[0].prompt_tokens_est));
    assert.ok(c.discourse_after && Array.isArray(c.discourse_after.topic_stack));
    assert.ok(commit.length < 4000, "bounded");
    const main = fs.readFileSync(path.join(__dirname, "../desktop/main.js"), "utf8");
    assert.match(main, /YELLOW_BEAST_DEVELOPER_MODE === "1" && !testMode/, "stdout mirroring is developer-mode only");
    // Player-facing projection carries no trace.
    const projection = JSON.stringify(state.service.getGameplayProjection({ world_id: state.worldId, mode: "field-researcher" }));
    assert.doesNotMatch(projection, /YB:COMMIT_TRACE|explanation_basis|response_plan/);
  } finally { cleanup(state); }
});

// ─── exact human regression sequences A–F (production path, fallback wording) ────────────────────
test("human sequences A–F — semantics through the production service", async () => {
  const state = setup("ed26-human", garbage());
  try {
    // A
    const a1 = await turn(state, "Are you all excited for day one?");
    assert.equal(a1.fn, "check_in");
    assert.equal(a1.owners.length, state.ids.length);
    for (const line of a1.spoken) assert.doesNotMatch(line.text, /don'?t know|excited|nervous|scared/i);
    const a2 = await turn(state, "What makes you say that?");
    assert.equal(a2.contexts[0].response_plan.required_facts[0].value.kind, "self_state");
    // B
    const b1 = await turn(state, "Whats next?");
    assert.equal(b1.contexts[0].response_plan.required_facts[0].value.next_step, "report to Equipment Staging");
    const b2 = await turn(state, "I mean for the day");
    assert.equal(b2.contexts[0].semantic_frame.procedure_scope, "day");
    // C
    const c1 = await turn(state, "Have you been there before?");
    assert.equal(c1.contexts[0].response_plan.required_facts[0].value.kind, "no_established_personal_history");
    const c2 = await turn(state, "Why do you say that?");
    assert.equal(c2.contexts[0].response_plan.required_facts[0].value.uncertainty, "no_established_personal_history");
    // D
    await turn(state, "Who has the field camera?");
    const d2 = await turn(state, "How do you know?");
    assert.equal(d2.contexts[0].response_plan.required_facts[0].value.kind, "custody");
    // E
    const e1 = await turn(state, "You know the thing by the thing?");
    assert.equal(e1.fn, "ambiguous_reference");
    const e2 = await turn(state, "I mean the camera.");
    assert.equal(e2.fn, "ask_item_ownership");
    assert.match(e2.spoken[0].text, /camera/i);
  } finally { cleanup(state); }
});

// ─── validator cases found by the real models (Gemma / Qwen3-4B) ─────────────────────────────────
test("real-model findings — wrong-basis, invented-history and honest-stance lines are judged correctly", () => {
  const explain = (basis, line) => {
    const frame = D.buildSemanticFrame({ text: "How do you know?", discourse: { turns: [], last_turn: { kind: "player_exchange", interaction_id: "i", player_text: "Q?", responder_ids: ["c-a"], responses: [{ speaker_id: "c-a", speaker_name: "Ana", text: "x", basis }] } } });
    const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
    return V.validateContribution(D.toAuthorizedContribution(plan, frame), line).ok;
  };
  const custody = { kind: "custody", label: "35mm field camera", holder_name: "you", holder_is_self: false };
  assert.equal(explain(custody, "I said that because I'm feeling exactly like that right now."), false, "a custody basis is not explained as a feeling");
  assert.equal(explain(custody, "That's where it is, as far as I know."), true);
  const history = { kind: "no_known_fact", uncertainty: "no_established_personal_history" };
  assert.equal(explain(history, "I haven't been there before, so I can't think of a time."), false, "no negative history is asserted");
  assert.equal(explain(history, "I just can't think of a time I have."), true);
  const feeling = { kind: "self_state", state: "ordinary", affect: [] };
  assert.equal(explain(feeling, "I just feel like neither of us is really going anywhere with this."), false, "no invented reason beyond the feeling");
  assert.equal(explain(feeling, "It is just how I feel right now. Nothing out of the ordinary."), true);
  // Sarcasm is not agreed with and turned into a world fact.
  const joke = D.buildSemanticFrame({ text: "Well, this seems incredibly safe." });
  const [jokePlan] = D.planResponses({ frame: joke, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
  assert.equal(V.validateContribution(D.toAuthorizedContribution(jokePlan, joke), "Yeah, it's got a good buffer zone.").ok, false);
  // One's own perception is self-knowledge.
  const seen = D.buildSemanticFrame({ text: "Did you see anything earlier?", recipient_type: "direct" });
  const [seenPlan] = D.planResponses({ frame: seen, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
  const seenContribution = D.toAuthorizedContribution(seenPlan, seen);
  assert.equal(V.validateContribution(seenContribution, "I don't know.").ok, false);
  assert.equal(V.validateContribution(seenContribution, "No, I didn't notice anything like that.").ok, true);
  // Honest no-opinion stances (and the fallback itself) pass; an invented opinion does not.
  const frame = D.buildSemanticFrame({ text: "What do each of you think?", recipient_type: "group" });
  const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "Ana" } }) } } });
  const contribution = D.toAuthorizedContribution(plan, frame);
  for (const line of ["No real opinion on it yet.", "I don't have a strong opinion yet.", "I don't have a particular take on it right now.", F.presentFallback({ frame, plan })]) assert.equal(V.validateContribution(contribution, line).ok, true, line);
  assert.equal(V.validateContribution(contribution, "It's definitely a great plan.").ok, false);
  assert.equal(V.validateContribution(contribution, "I\u2019m not sure. We\u2019ll need to check the data later.").ok, false, "a curly apostrophe does not bypass the invented-plan rule");
  assert.equal(V.validateContribution({ discourse_function: "make_statement", required_facts: [], optional_facts: [], forbidden_claims: [] }, "On it.").ok, false, "a real commitment is still caught");
});

// ─── presentation watch item: coworker speech is not echoed outside the LOCAL transcript ─────────
test("presentation — a communication turn that committed dialogue is not echoed into the feedback strip", async () => {
  // The service result for a model-worded turn carries the committed "Name: line" as narration ...
  const state = setup("ed26-echo", scriptedLocal(() => "Not especially."));
  try {
    await turn(state, "Excited?", { request_id: "echo-1" });
    const receipt = state.run.expedition.communication_receipts.find((r) => r.id === "echo-1");
    assert.match(receipt.cached_result.result.scene?.narration ?? receipt.cached_result.result.public_reason, /: /);
  } finally { cleanup(state); }
  // ... so the renderer must not play it into #interaction-feedback for communication turns.
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /const dialoguePresented = kind === "communication" && Boolean\(result\.result\?\.presentation_source\);/);
  assert.match(renderer, /const message = dialoguePresented \? "" : renderMessage\(result, kind === "natural"\);/);
});
