"use strict";

// ED-25 — human-acceptance dialogue reproductions. Jack's first natural Electron conversation after the
// freeze audit exposed four general gaps: a question about the listeners' OWN feelings was planned as an
// outside fact ("I don't know"), "why?" had no access to why the previous line was said, "what's next?"
// ignored the canonical procedure, and a narrowing fragment ("I mean for the day") was a fresh statement.
// Every assertion here protects the general mechanism, not the exact phrases.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const V = require("../tools/dialogue-validation");
const ledger = require("../tools/canonical-world-ledger");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { DesktopService } = require("../desktop/service");

const VERSION = "yellow-beast-local-dialogue-candidate@v1";

// ─── harness (production service path) ───────────────────────────────────────────────────────────
function setup(seed, provider = null, { offline = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed25-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  if (offline) service.updateSettings({ provider: "offline" });
  const worldId = service.createWorld({ name: "ED25", seed }).world.id;
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
  state.ids = state.run.expedition.team.members.map((m) => m.personnel_id ?? m.id).filter((id) => id !== state.playerId);
  return state;
}
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
const say = (state, text, extra = {}) => Promise.resolve(state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra }));
const spokenFor = (run, requestId, playerId) => run.expedition.dialogue_history.filter((e) => e.submission_id === requestId && e.speaker_id !== playerId);
const contextsFor = (run, requestId) => run.expedition.communication_receipts.find((r) => r.id === requestId)?.response_contexts ?? [];
/** A REAL local provider whose model output is scripted (or garbage, forcing the same-plan fallback). */
function scriptedLocal(responder) {
  const packets = [];
  const fetchImpl = (url, options) => Promise.resolve(responder(JSON.parse(options.body))).then((out) => ({ ok: true, status: 200, json: async () => ({ id: "t", choices: [{ message: { content: out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ speech: out }) } }] }) }));
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:8734", fetchImpl, timeout: 300 });
  return { packets, provider: { name: "local", model: real.model, async presentLocal(packet) { packets.push(packet); return real.presentLocal(packet); } } };
}
const garbage = () => scriptedLocal(() => ({ raw: "{bad" }));
const HUMAN_SEQUENCE = ["Are you all excited for day one?", "What makes you say that?", "Oh ok I guess", "Whats next?", "I mean for the day"];

// Pure fixtures.
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", "p-jack": "you" };
const EQUIPMENT = { cam: { id: "cam", label: "35mm field camera", holder: "p-jack" } };
const selfOf = (extra = {}) => D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, names: NAMES, self_state: ledger.describeSelfState({}), ...extra });
function planFor(text, { owner = "c-omar", recipient_type = "direct", discourse = null, self = selfOf() } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, discourse, equipment: EQUIPMENT });
  const [plan] = D.planResponses({ frame, owner_ids: [owner], responders: { [owner]: { self } }, names: NAMES });
  return { frame, plan, contribution: D.toAuthorizedContribution(plan, frame, { names: NAMES }) };
}
const verdict = (contribution, speech, player_text = null) => V.validateContribution(contribution, speech, { player_text });
const TENSE = { emotional_state: { ...ledger.DEFAULT_EMOTIONAL_STATE, stress: 0.7 } };

// ─── 1 + 13. subjective self-state questions ─────────────────────────────────────────────────────
test("self-state — a question about one's own feeling is answered from canonical self-state, never 'I don't know'", () => {
  for (const text of ["Are you all excited for day one?", "Are you nervous?", "How are you feeling?", "You doing okay?", "Excited?", "You seem tense, everything alright?"]) {
    const { frame, plan, contribution } = planFor(text);
    assert.equal(frame.discourse_function, "check_in", text);
    assert.ok(plan.required_facts.some((f) => f.key === "self_state"), `${text}: consults canonical self-state`);
    const line = F.presentFallback({ frame, plan });
    assert.doesNotMatch(line, /don'?t know|couldn'?t say|no idea/i, `${text}: a speaker has access to themselves`);
    assert.equal(verdict(contribution, line, text).ok, true, `${text}: the fallback is itself valid (${line})`);
  }
  // Ordinary state: no elevated feeling either way -- a stance, and no invented affect.
  const excited = planFor("Are you all excited for day one?");
  assert.equal(excited.plan.required_facts.find((f) => f.key === "self_state_answer").value.answer, "not_especially");
  for (const bad of ["I don't know.", "Yeah, I'm so excited!", "Honestly, a bit nervous.", "I couldn't say."]) assert.equal(verdict(excited.contribution, bad).ok, false, bad);
  for (const good of ["Not especially.", "Can't say I feel much either way.", "Not especially excited, no."]) assert.equal(verdict(excited.contribution, good).ok, true, good);
  // Same-turn: echoing an earlier speaker's stance needs an agreement marker; a bare repeat is a chorus.
  const after = { ...excited.contribution, same_turn_prior_responses: [{ speaker_name: "Nora", text: "Not especially. I feel all right about it." }] };
  assert.equal(verdict(after, "Not especially either.").ok, true);
  assert.equal(verdict(after, "Not especially.").ok, false);
  // Moved state: the question about that feeling is a yes; about another feeling, the real one is said.
  const tense = selfOf({ self_state: ledger.describeSelfState(TENSE) });
  const nervous = planFor("Are you nervous?", { self: tense });
  assert.equal(nervous.plan.required_facts.find((f) => f.key === "self_state_answer").value.answer, "yes");
  assert.match(F.presentFallback({ frame: nervous.frame, plan: nervous.plan }), /edge/i);
  assert.equal(verdict(nervous.contribution, "Not at all, I'm fine.").ok, false, "canonical tension is not denied away");
  const excitedTense = planFor("Excited?", { self: tense });
  assert.equal(excitedTense.plan.required_facts.find((f) => f.key === "self_state_answer").value.answer, "affected_instead");
  // Not every "okay"/"tense" is a feeling question.
  for (const text of ["Are you okay with carrying the camera?", "Is it tense in there?", "Are you ready?"]) {
    const frame = D.buildSemanticFrame({ text });
    assert.equal(frame.self_state_query, null, text);
    assert.notEqual(frame.discourse_function, "check_in", text);
  }
});

test("production — 'Are you all excited for day one?' gets one self-state answer per present coworker", async () => {
  const state = setup("ed25-group", garbage().provider);
  try {
    await say(state, HUMAN_SEQUENCE[0], { request_id: "g-1" });
    const contexts = contextsFor(state.run, "g-1");
    assert.deepEqual(contexts.map((c) => c.target_worker_id), state.ids, "every present coworker, in canonical order");
    for (const c of contexts) {
      assert.equal(c.semantic_frame.discourse_function, "check_in");
      assert.deepEqual(c.response_plan.required_facts.map((f) => f.key), ["self_state", "self_state_answer"]);
    }
    const lines = spokenFor(state.run, "g-1", state.playerId).map((e) => e.text);
    assert.equal(lines.length, 3);
    assert.equal(new Set(lines).size, 3, "no chorus of identical lines");
    for (const line of lines) assert.doesNotMatch(line, /don'?t know|excited/i);
  } finally { cleanup(state); }
});

// ─── 8. explicit group response-ownership policy ─────────────────────────────────────────────────
test("ownership — greeting and own-feeling questions reach everyone; shared-knowledge and factual questions one speaker", async () => {
  const state = setup("ed25-owners", garbage().provider);
  const owners = async (text, extra = {}) => { const id = `o-${crypto.randomUUID()}`; await say(state, text, { request_id: id, ...extra }); return contextsFor(state.run, id).map((c) => c.target_worker_id); };
  try {
    assert.equal((await owners("Hello everyone")).length, 3, "group greeting: all");
    assert.equal((await owners("Are you all nervous?")).length, 3, "group own-feeling question: all (inherently individual)");
    assert.equal((await owners("What's next, everyone?")).length, 1, "group task question: one spokesperson");
    assert.ok((await owners("Does anyone know when the cutoff is?")).length <= 1, "group factual question without a knower: at most one");
    assert.ok((await owners("Well, this seems incredibly safe.")).length <= 1, "untargeted remark: at most one");
    const lauren = state.run.expedition.team.members.find((m) => (m.personnel_id ?? m.id) === state.ids[1]);
    assert.deepEqual(await owners(`${lauren.first_name}, are you excited?`), [state.ids[1]], "direct question: only the addressee");
    assert.equal((await owners("Excited?")).length, 1, "own-feeling question to no one in particular: one");
  } finally { cleanup(state); }
});

// ─── 2 + 3 + 14. explanation follow-ups use the recorded basis ───────────────────────────────────
test("explanation — 'why?' explains the prior line from its recorded basis; invented rationale is rejected", () => {
  const discourseAfter = (responses) => ({ turns: [], last_turn: { kind: "player_exchange", interaction_id: "i1", player_text: "Q?", responder_ids: ["c-omar"], responses } });
  // no-fact answer -> the reason is only "nothing to go on"
  const noFact = planFor("What makes you say that?", { recipient_type: "none", discourse: discourseAfter([{ speaker_id: "c-omar", speaker_name: "Omar", text: "I couldn't say.", basis: { kind: "no_known_fact", past_perception: false } }]) });
  assert.equal(noFact.frame.discourse_function, "ask_explanation");
  assert.deepEqual(noFact.plan.required_facts, [{ key: "explanation_basis", value: { kind: "no_known_fact", past_perception: false } }]);
  const fb = F.presentFallback({ frame: noFact.frame, plan: noFact.plan });
  assert.equal(verdict(noFact.contribution, fb).ok, true, fb);
  for (const bad of ["Because it's dangerous out there.", "I've done this before, so I know.", "I don't want to go."]) assert.equal(verdict(noFact.contribution, bad).ok, false, bad);
  // self-state answer -> the reason is how the speaker feels, nothing else
  const feeling = planFor("Why?", { recipient_type: "none", discourse: discourseAfter([{ speaker_id: "c-omar", speaker_name: "Omar", text: "Not especially.", basis: { kind: "self_state", state: "ordinary", affect: [], answer: "not_especially" } }]) });
  assert.equal(feeling.plan.required_facts[0].value.kind, "self_state");
  assert.equal(verdict(feeling.contribution, F.presentFallback({ frame: feeling.frame, plan: feeling.plan })).ok, true);
  for (const bad of ["I'm nervous about the complex.", "I don't know.", "Because I'm so excited."]) assert.equal(verdict(feeling.contribution, bad).ok, false, bad);
  // a line with no recorded basis (older saves) never gets a made-up reason; no preceding reply -> clarify
  const legacy = planFor("How come?", { recipient_type: "none", discourse: discourseAfter([{ speaker_id: "c-omar", speaker_name: "Omar", text: "Hm.", basis: null }]) });
  assert.equal(legacy.plan.required_facts[0].value.kind, "unavailable");
  const nothing = planFor("Why?", { recipient_type: "none", discourse: { turns: [], last_turn: null } });
  assert.equal(nothing.frame.unresolved_reference, true);
  assert.match(F.presentFallback({ frame: nothing.frame, plan: nothing.plan }), /\?$/);
});

// ─── 4 + 5 + 15. the current procedure ───────────────────────────────────────────────────────────
test("procedure — 'what's next?' is answered from canonical briefing/phase state, never UI text; else clarified", async () => {
  const state = setup("ed25-next", garbage().provider);
  try {
    await say(state, "Whats next?", { request_id: "n-1" });
    const [ctx] = contextsFor(state.run, "n-1");
    assert.equal(ctx.semantic_frame.discourse_function, "ask_next_step");
    const procedure = ctx.response_plan.required_facts.find((f) => f.key === "current_procedure").value;
    assert.equal(procedure.next_step, "report to Equipment Staging");
    assert.equal(procedure.source, "the briefing");
    assert.match(spokenFor(state.run, "n-1", state.playerId)[0].text, /Equipment Staging/);
    // UI/briefing prose is not the authority: rewriting it changes nothing.
    state.run.expedition.day1_opener.personnel_briefing.dialogue.dismissal = "Report to the loading dock.";
    await say(state, "What do we do now?", { request_id: "n-2" });
    assert.equal(contextsFor(state.run, "n-2")[0].response_plan.required_facts.find((f) => f.key === "current_procedure").value.next_step, "report to Equipment Staging");
    // No canonical procedure (the briefing is not concluded) -> the question is clarified, never guessed.
    state.run.expedition.day1_opener.personnel_briefing.status = "active";
    await say(state, "Whats next?", { request_id: "n-3" });
    const [none] = contextsFor(state.run, "n-3");
    assert.equal(none.response_plan.required_facts.length, 0);
    assert.equal(none.response_plan.may_ask_clarifying_question, true);
    assert.match(spokenFor(state.run, "n-3", state.playerId)[0].text, /\?$/);
  } finally { cleanup(state); }
  // "next" in other senses is not the procedure
  assert.notEqual(D.buildSemanticFrame({ text: "Who is next?" }).discourse_function, "ask_next_step");
});

// ─── 6 + 7. repair and repair-of-repair ──────────────────────────────────────────────────────────
test("repair — a narrowing fragment re-asks the open question; unresolved repairs clarify again", () => {
  const pendingOf = (player_text, fn) => ({ turns: [], last_turn: null, pending_question: { discourse_function: fn, player_text, interaction_id: "i1", responder_ids: ["c-omar"] } });
  // clarification -> "I mean for the day": the question resumes, narrowed, owned by the clarifier
  const day = D.buildSemanticFrame({ text: "I mean for the day", discourse: pendingOf("Whats next?", "ask_next_step") });
  assert.equal(day.discourse_function, "ask_next_step");
  assert.equal(day.procedure_scope, "day");
  assert.deepEqual(day.resumed_question.responder_ids, ["c-omar"]);
  assert.equal(D.frameObligatesResponse(day, "c-omar"), true);
  assert.equal(D.frameObligatesResponse(day, "c-nora"), false);
  // repair-of-repair: still unresolved -> another clarification (never a fresh statement, never a guess)
  const door = D.buildSemanticFrame({ text: "I mean the door.", discourse: pendingOf("Is that door open?", "ambiguous_reference") });
  assert.equal(door.discourse_function, "ambiguous_reference");
  assert.ok(door.resumed_question);
  const other = D.buildSemanticFrame({ text: "No, the other one.", discourse: pendingOf(door.resolved_utterance, "ambiguous_reference") });
  assert.equal(other.discourse_function, "ambiguous_reference");
  // a fragment that names the missing item resolves the original question
  const cam = D.buildSemanticFrame({ text: "I mean the camera.", equipment: EQUIPMENT, discourse: pendingOf("Who has the thing?", "ambiguous_reference") });
  assert.equal(cam.discourse_function, "ask_item_ownership");
  // with no open question the same words stay a statement
  assert.equal(D.buildSemanticFrame({ text: "I mean for the day" }).discourse_function, "make_statement");
});

test("production — the exact human sequence (repair of an answered question included)", async () => {
  const state = setup("ed25-human", garbage().provider);
  try {
    const ids = HUMAN_SEQUENCE.map((_, i) => `h-${i}`);
    for (const [i, text] of HUMAN_SEQUENCE.entries()) await say(state, text, { request_id: ids[i] });
    const fnOf = (id) => contextsFor(state.run, id)[0]?.semantic_frame.discourse_function ?? null;
    assert.deepEqual(ids.map(fnOf), ["check_in", "ask_explanation", null, "ask_next_step", "ask_next_step"]);
    const explanation = contextsFor(state.run, "h-1")[0].response_plan.required_facts[0];
    assert.equal(explanation.key, "explanation_basis");
    assert.equal(explanation.value.kind, "self_state", "the reason is the recorded basis of the previous line");
    const repair = contextsFor(state.run, "h-4")[0];
    assert.equal(repair.semantic_frame.procedure_scope, "day");
    assert.equal(repair.target_worker_id, contextsFor(state.run, "h-3")[0].target_worker_id, "the one who answered answers the narrowed question");
    for (const id of ["h-0", "h-1", "h-3", "h-4"]) for (const e of spokenFor(state.run, id, state.playerId)) assert.doesNotMatch(e.text, /don'?t know|what are you referring to|which thing/i, `${id}: ${e.text}`);
  } finally { cleanup(state); }
});

// ─── 9. cold reload ──────────────────────────────────────────────────────────────────────────────
test("cold reload — the basis of a pre-restart line survives for 'why?'", async () => {
  const state = setup("ed25-reload", garbage().provider);
  try {
    await say(state, "Are you all excited for day one?", { request_id: "r-1" });
    state.service.shutdown?.();
    const service2 = new DesktopService({ appDataPath: state.root, localDialogueProvider: garbage().provider, developerMode: true });
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    await service2.submitQ4Communication({ world_id: state.worldId, channel: "local", text: "What makes you say that?", request_id: "r-2" });
    const run2 = service2.session(state.worldId, "field-researcher").run;
    const [ctx] = contextsFor(run2, "r-2");
    assert.equal(ctx.response_plan.required_facts[0].value.kind, "self_state");
    service2.shutdown?.();
  } finally { cleanup(state); }
});

// ─── 10 + 11. provider independence and fallback equivalence ─────────────────────────────────────
test("independence — models only word the plan: frames, owners and plans are identical to fallback-only", async () => {
  const semantics = async (provider, offline) => {
    const state = setup("ed25-indep", provider, { offline });
    try {
      for (const [i, text] of HUMAN_SEQUENCE.entries()) await say(state, text, { request_id: `i-${i}` });
      // Quoted earlier wording ("responses[].text") is spoken text and legitimately differs by provider;
      // everything else -- functions, owners, facts, recorded bases -- must not.
      const spokenNormalized = (key, value) => (key === "text" && typeof value === "string" ? "<spoken>" : value);
      return JSON.stringify(state.run.expedition.communication_receipts.map((r) => (r.response_contexts ?? []).map((c) => [c.target_worker_id, c.semantic_frame, c.response_plan, c.authorized_contribution])), spokenNormalized);
    } finally { cleanup(state); }
  };
  const scripted = scriptedLocal((body) => {
    const user = body.messages.find((m) => m.role === "user").content;
    if (/Why you said your previous line/.test(user)) return "Just how I feel right now.";
    if (/What comes next/.test(user)) return "We get acquainted, then report to Equipment Staging.";
    if (/They asked if you feel/.test(user)) return "Not especially.";
    return "Okay.";
  });
  const reference = await semantics(null, true);
  assert.equal(await semantics(garbage().provider, false), reference);
  assert.equal(await semantics(scripted.provider, false), reference);
});

test("fallback — every human-sequence fallback line passes the same validator the model faces", async () => {
  const state = setup("ed25-fallback", garbage().provider);
  try {
    for (const [i, text] of HUMAN_SEQUENCE.entries()) await say(state, text, { request_id: `f-${i}` });
    for (const [i, text] of HUMAN_SEQUENCE.entries()) {
      for (const ctx of contextsFor(state.run, `f-${i}`)) {
        const line = spokenFor(state.run, `f-${i}`, state.playerId).find((e) => e.speaker_id === ctx.target_worker_id)?.text;
        assert.equal(V.validateContribution(ctx.authorized_contribution, line, { player_text: text }).ok, true, `${text} -> ${line}`);
      }
    }
  } finally { cleanup(state); }
});

// ─── 12. stale state ─────────────────────────────────────────────────────────────────────────────
test("stale state — a procedure answer whose speaker left the room during generation is cancelled", async () => {
  let state = null;
  const provider = { name: "local", model: "m", async presentLocal(packet) {
    const room = "equipment-staging";
    state.run.spatial.personnel_locations[packet._capsule?._internal?.meta?.speaker_id ?? state.ids[0]] = room;
    for (const id of state.ids) state.run.spatial.personnel_locations[id] = room;
    return { version: VERSION, observer_id: packet.speaker?.observer_id ?? "self", speech: "We report to Equipment Staging." };
  } };
  state = setup("ed25-stale", provider);
  try {
    await say(state, "Whats next?", { request_id: "s-1" });
    assert.equal(spokenFor(state.run, "s-1", state.playerId).length, 0, "a speaker no longer present does not answer");
    assert.ok(state.logs.some((l) => /pre-commit revalidation cancelled reply/.test(l)));
  } finally { cleanup(state); }
});
