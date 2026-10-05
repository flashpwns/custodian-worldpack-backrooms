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
test("a rejected introduction gets one rewording with the same facts and commits only accepted speech", async () => {
  for (const repair of [true, false]) {
    const packets = [];
    const provider = { name: "local", model: "scripted", async presentLocal(packet) {
      packets.push(structuredClone(packet));
      const facts = packet.authorized_contribution.required_facts;
      const name = facts.find(f => f.key === "name").value;
      const role = facts.find(f => f.key === "role").value;
      return { version: VERSION, speech: `I'm ${name}, a ${role}.` + (repair && packets.length === 2 ? "" : " So I am still getting the hang of things.") };
    } };
    const state = setup(`ed25-intro-reword-${repair}`, provider);
    try {
      await say(state, "Tell me a little about yourself beyond today's assignments.", { target: state.ids[0], request_id: "intro-reword" });
      assert.equal(packets.length, 2, "one bounded attempt, even if the second candidate fails: " + state.logs.join("\n"));
      assert.deepEqual(packets[1].authorized_contribution, packets[0].authorized_contribution);
      assert.deepEqual(packets[1].context_capsule, packets[0].context_capsule);
      assert.equal(packets[1].presentation_feedback, "omit_unsupported_rationale");
      const speech = spokenFor(state.run, "intro-reword", state.playerId);
      assert.equal(speech.length, 1, "no rejected candidate is committed");
      assert.doesNotMatch(speech[0].text, /getting the hang/);
      assert.equal(speech[0].speaker_id, state.ids[0]);
      assert.ok(state.logs.some(line => line.includes(`validator_accepted=${repair}`) && line.includes(`fallback_used=${!repair}`)), "accepted repair uses model wording; rejected repair uses the same-plan fallback");
      assert.match(require('../tools/dialogue-prompt-contract').renderContributionTask(packets[1]), /Omit explanations of why/);
    } finally { state.service.shutdown(); cleanup(state); }
  }
});
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

test("screenshot regression — addressed name questions use each coworker's own name, never Maxwell", async () => {
  const state = setup('names-screenshot', garbage().provider);
  try {
    const peers=state.run.expedition.team.members.filter(m=>state.ids.includes(m.personnel_id??m.id));
    await say(state,'Hello and goodmorning, everyone.',{request_id:'names-greeting'});
    assert.equal(spokenFor(state.run,'names-greeting',state.playerId).length,3,'Combined group greeting reaches all three coworkers');
    const verify=(requestId,ids)=>{
      const speech=spokenFor(state.run,requestId,state.playerId);
      assert.deepEqual(speech.map(e=>e.speaker_id),ids,'Code owns the complete ordered responder set');
      for(const e of speech){const peer=peers.find(m=>(m.personnel_id??m.id)===e.speaker_id);assert.match(e.text,new RegExp(peer.first_name));assert.doesNotMatch(e.text,/Maxwell|Kirk|briefing|custody/i);}
      for(const c of contextsFor(state.run,requestId))assert.deepEqual(c.response_plan.required_facts.map(f=>f.key),['name'],'Name questions authorize only the speaker name');
    };
    await say(state,"What're everyone's names?",{request_id:'names-group'});verify('names-group',state.ids);
    await say(state,'Well yes, but I mean everyone at the table, here.',{request_id:'names-repair'});verify('names-repair',state.ids);
    const direct=peers.at(-1);await say(state,'WHAT ARE YOUR NAMES?',{request_id:'names-direct',target:direct.first_name});verify('names-direct',[direct.personnel_id??direct.id]);
    await say(state,'Who was that doctor who briefed us?',{request_id:'names-maxwell'});
    const report=spokenFor(state.run,'names-maxwell',state.playerId);assert.equal(report.length,1);assert.match(report[0].text,/Maxwell|Kirk/,'A question actually about Maxwell retains his briefing facts');
  }finally{state.service.shutdown();cleanup(state);}
});

test("own-name contract accepts ordinary variants without treating object or third-person names as self-introductions", () => {
  for(const text of ["What's your name?",'What is your name?',"What’re everybody’s names?","What are everyone's names?",'WHAT ARE YOUR NAMES?',"What's everyone's name?"]){
    const p=planFor(text);assert.equal(p.frame.requested_content,'name',text);assert.deepEqual(p.plan.required_facts.map(f=>f.key),['name'],text);assert.deepEqual(p.plan.optional_facts,[],text);
    const line=F.presentFallback({frame:p.frame,plan:p.plan});assert.match(line,/Omar/);assert.equal(verdict(p.contribution,line,text).ok,true);
    assert.equal(verdict(p.contribution,"That's Dr. Kirk Maxwell. He said we can call him Kirk.",text).ok,false,'A true fact about another person does not answer the question');
  }
  for(const text of ["What are your names for those instruments?","What's your doctor's name?",'Who was that doctor who briefed us?','Everyone at the table is here.'])assert.notEqual(planFor(text).frame.requested_content,'name',text);
});

test("group target repair without an earlier question clarifies instead of inventing names", async () => {
  const state=setup('names-repair-no-question',garbage().provider);
  try {await say(state,'I mean everyone at the table, here.',{request_id:'names-orphan-repair'});const speech=spokenFor(state.run,'names-orphan-repair',state.playerId);assert.equal(speech.length,1);const c=contextsFor(state.run,'names-orphan-repair')[0];assert.equal(c.response_plan.may_ask_clarifying_question,true);assert.equal(c.response_plan.required_facts.some(f=>f.key==='name'),false);}finally{state.service.shutdown();cleanup(state);}
});

test("ordinary introductions — wording families and fresh short questions answer the people present", async () => {
  const s = setup("natural-introductions", garbage().provider);
  try {
    const names = s.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== s.playerId).map((m) => m.first_name);
    for (const [i, text] of ["Hey folks, I don’t think we’ve met. What should I call you?", "Who is everyone?", "Could you remind me who everyone is?"].entries()) {
      const request_id = `natural-intro-${i}`;
      await say(s, text, { request_id });
      const lines = spokenFor(s.run, request_id, s.playerId);
      assert.equal(lines.length, 3, `${text}: everyone introduces themselves`);
      for (const [n, line] of lines.entries()) assert.ok(line.text.includes(names[n]), `${text}: ${line.text}`);
    }
    await say(s, "Wait, I meant you three, not Maxwell.", { request_id: "natural-target-repair" });
    const repaired = spokenFor(s.run, "natural-target-repair", s.playerId);
    assert.equal(repaired.length, 3);
    for (const [n, line] of repaired.entries()) assert.ok(line.text.includes(names[n]), line.text);
    await say(s, "Who am I working with today?", { request_id: "natural-roster" });
    const roster = spokenFor(s.run, "natural-roster", s.playerId);
    assert.equal(roster.length, 1);
    for (const name of names) assert.ok(roster[0].text.includes(name), `roster identifies ${name}: ${roster[0].text}`);
    assert.doesNotMatch(roster[0].text, /report to Equipment Staging/i);
    await say(s, "Nice to meet you all.", { request_id: "natural-meeting" });
    const meeting = spokenFor(s.run, "natural-meeting", s.playerId);
    assert.equal(meeting.length, 3);
    for (const line of meeting) assert.match(line.text, /meet you/i);
  } finally { s.service.shutdown(); cleanup(s); }
});

test("language recovery — the shared gate honors uncertain force and complete short questions stay fresh", () => {
  const T = require("../tools/dialogue-turn");
  const analysis = T.analyzeTurn({ raw: "Something about this arrangement feels off.", present: [], entities: [] });
  const gate = T.advisoryGate({ message: analysis.raw, analysis, frame: { discourse_function: "make_statement" }, completeness: { complete: false, missing: ["force_uncertain"] } });
  assert.equal(gate.needed, true, "a gap detected by completeness must reach the language interpreter");
  assert.equal(gate.contract.tier1_complete, false);
  const fresh = T.analyzeTurn({ raw: "Who is everyone?", present: [{ id: "a", name: "Ava" }], entities: [] });
  const advice = { version: "yellow-beast-dialogue-advisory@v2", accepted: true, acts: [{ speech_act: "question", facet: "person.self_description", quantifier: "all", discourse_relation: "continuation" }], tier1_missing: ["facet_unresolved"] };
  assert.equal(T.assessAdvisory(advice, fresh, { dis: { last_request: { predicate: "mission.destination" } } }).accepted, true, "a complete short question does not require the previous topic to match");
});


test("open introductions allow stored personal detail without turning name questions into biographies", () => {
  const self = selfOf({ person: { first_name: "Omar", role: "field technician", identity_substrate: { education_or_trade: "industrial electrical work", async_tenure: "under six months" } } });
  const open = planFor("Tell me about yourself.", { self });
  assert.deepEqual(open.plan.optional_facts.filter(f => f.key === "identity_fact").map(f => f.value), [{ education_or_trade: "industrial electrical work" }]);
  assert.equal(verdict(open.contribution, "I'm Omar, a field technician. My background is industrial electrical work.").ok, true);
  for (const line of ["I'm Omar, a field technician. I've been with ASYNC ten years.", "I'm Omar, a field technician. My brother got me this job.", "I'm Omar, a field technician. I've been into the Complex three times.", "I'm Omar, a field technician. I've done industrial electrical work for under six months."]) assert.equal(verdict(open.contribution, line).ok, false, line);
  const name = planFor("What's your name?", { self });
  assert.equal(name.plan.optional_facts.some(f => f.key === "identity_fact"), false);
  assert.equal(verdict(name.contribution, "Omar. I've been with ASYNC under six months.").ok, false);
});

test("employment detail in introductions comes from canonical personhood, not a conflicting older identity seed", () => {
  const self = selfOf({ person: { first_name: "Omar", role: "field technician", identity_substrate: { async_tenure: "one to two years" } }, member: { personhood: { async_tenure: "weeks" } } });
  const { plan, contribution } = planFor("Tell me about yourself.", { self });
  assert.equal(plan.optional_facts.find(f => f.key === "predicate_answer")?.value.answer.band, "weeks");
  assert.equal(verdict(contribution, "I'm Omar, a field technician. My background is electrical work, and I've been with ASYNC for a few weeks.").ok, true);
  assert.equal(verdict(contribution, "I'm Omar, a field technician. I've been with ASYNC one to two years.").ok, false);
});

test("reciprocal check-ins are planned for one speaker and remain answerable after reload", () => {
  const S = require('../tools/dialogue-state');
  const self = selfOf({ person: { first_name: 'Omar', identity_substrate: { social_tendency: 'asks one practical follow-up' } } });
  const { frame, plan, contribution } = planFor('How are you feeling?', { self });
  assert.equal(plan.asks_player, true);
  assert.equal(plan.may_ask_clarifying_question, false, 'personal interest is not failure to understand');
  for (const good of ["I'm all right. How about you?", "Doing okay. How are you feeling?", "I’m doing all right. How are you feeling now?", "I'm doing all right. And how are things for you?"]) assert.equal(verdict(contribution, good).ok, true, good);
  for (const bad of ["I'm all right.", "I'm all right. Is Maxwell nervous?", "I'm all right. Can I help you?", "I'm all right. Where are we going?"]) assert.equal(verdict(contribution, bad).ok, false, bad);
  const line = F.presentFallback({ frame, plan });
  assert.equal(verdict(contribution, line).ok, true, line);
  const group = D.planResponses({ frame, owner_ids: ['c-nora', 'c-omar'], responders: { 'c-nora': { self }, 'c-omar': { self } } });
  assert.deepEqual(group.filter(p => p.asks_player).map(p => p.responder_id), ['c-omar']);
  const run = { expedition: { dialogue_history: [{ id: 'player-before', speaker_id: 'p-jack', text: 'How are you feeling?' }, { id: 'omar-check-in', speaker_id: 'c-omar', text: line }] } };
  S.recordInboundRequest(run, { event_id: 'omar-check-in', speaker_id: 'c-omar', text: line, plan });
  const restored = JSON.parse(JSON.stringify(run));
  assert.equal(S.inboundFor(restored, { player_id: 'p-jack' }).pending.from, 'c-omar');
  assert.equal(S.inboundFor(restored, { player_id: 'p-jack' }).pending.predicate, 'person.wellbeing');
  const T = require('../tools/dialogue-turn');
  const turn = T.analyzeTurn({ raw: "I'm a little nervous.", present: [{ id: 'c-omar', first_name: 'Omar' }], dis: { pending_inbound_request: S.inboundFor(restored, { player_id: 'p-jack' }).pending } });
  assert.equal(turn.primary.speech_act, 'answer');
  assert.deepEqual(turn.primary.addressee.ids, ['c-omar']);
});

test("off-duty small talk draws on a stored preference rather than reciting the current assignment", async () => {
  const self = selfOf({ person: { first_name: 'Omar', role: 'field technician', identity_substrate: { mundane_preference: 'radio baseball' } } });
  for (const text of ["What do you do when you're not working?", 'What are you into?', 'Do you have any hobbies?', 'What do you enjoy doing?', 'What do you do in your spare time?']) {
    const { frame, plan, contribution } = planFor(text, { self });
    assert.equal(frame.discourse_function, 'ask_personal_experience', text);
    assert.equal(frame.requested_content, 'preference', text);
    assert.deepEqual(plan.required_facts, [{ key: 'personal_preference', value: 'radio baseball' }]);
    assert.equal(verdict(contribution, F.presentFallback({ frame, plan }), text).ok, true);
    assert.equal(verdict(contribution, "I like radio baseball.", text).ok, true);
    assert.equal(verdict(contribution, "I don't like radio baseball.", text).ok, false);
    assert.equal(verdict(contribution, "I like radio baseball and fishing.", text).ok, false);
    assert.equal(verdict(contribution, "I enjoy radio baseball. I think the mission is dangerous.", text).ok, false);
    assert.equal(verdict(contribution, "I'm a field technician.", text).ok, false);
    assert.equal(verdict(contribution, 'My brother got me into radio baseball.', text).ok, false);
  }
  const s = setup('ed25-personal-small-talk', null, { offline: true });
  try {
    await say(s, "What're everyone's names?");
    const id = s.ids[0];
    const r = await say(s, "What do you do when you're not working?", { target: id });
    const context = contextsFor(s.run, r.request_id ?? r.receipt?.id ?? s.run.expedition.communication_receipts.at(-1).id).find(c => c.responder_id === id) ?? s.run.expedition.communication_receipts.at(-1).response_contexts[0];
    assert.equal(context.semantic_frame.requested_content, 'preference');
    assert.equal(context.response_plan.required_facts.some(f => f.key === 'personal_preference'), true);
  } finally { cleanup(s); }
});

test("natural wording of canonical first-day nerves is not rejected by a second affect check", () => {
  const { validateAffectClaims } = require('../tools/ai-local-dialogue');
  const packet = { context_capsule: { human_context: { affect: ['a little nervous'] } }, player_message: { text: 'How are you feeling?' } };
  for (const speech of ["I'm a little nervous right now.", "I feel a bit uneasy.", "I'm on edge."]) assert.equal(validateAffectClaims(packet, speech).ok, true, speech);
  assert.equal(validateAffectClaims(packet, "I'm furious.").ok, false);
  assert.equal(validateAffectClaims({ ...packet, context_capsule: { human_context: { affect: [] } } }, "I'm nervous.").ok, false);
});

test("conversation memory records spoken optional details, never the unused contents of a character packet", () => {
  const K = require('../tools/canonical-knowledge');
  const plan = { discourse_function: 'invite_self_description', required_facts: [{ key: 'name', value: 'Omar' }], optional_facts: [{ key: 'identity_fact', value: { education_or_trade: 'industrial electrical work' } }, { key: 'personal_preference', value: 'radio baseball' }] };
  const empty = K.propositionsOfPlan(plan, { speaker_id: 'omar', spoken_text: "I'm Omar." });
  assert.equal(empty.some(p => p.key === 'personal_background' || p.key === 'personal_preference'), false);
  const said = K.propositionsOfPlan(plan, { speaker_id: 'omar', spoken_text: "I'm Omar. I like radio baseball." });
  assert.equal(said.some(p => p.key === 'personal_preference'), true);
  assert.equal(said.some(p => p.key === 'personal_background'), false);
  const restored = JSON.parse(JSON.stringify(plan));
  assert.deepEqual(K.propositionsOfPlan(restored, { speaker_id: 'omar', spoken_text: "I'm Omar. I like radio baseball." }), said);
});

test("plain plural job questions and conversation recall use actual ongoing speech", async () => {
  for (const text of ['What are your jobs?', 'What are your roles?', 'What are your assignments?']) {
    const { frame, plan } = planFor(text);
    assert.equal(frame.discourse_function, 'ask_role_or_assignment', text);
    assert.equal(plan.required_facts.some(f => f.key === 'role'), true, text);
  }
  const s = setup('ed25-conversation-recap', null, { offline: true });
  try {
    await say(s, 'What do we do next?');
    const fresh = new DesktopService({ appDataPath: s.root, defaultQ4Scenario: 'day1-opener', developerMode: true });
    fresh.updateSettings({ provider: 'offline' });
    assert.equal(fresh.resumeSession({ world_id: s.worldId, mode: 'field-researcher' }).ok, true);
    const r = await fresh.submitQ4Communication({ world_id: s.worldId, channel: 'local', text: 'What were we talking about?' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const restored = fresh.session(s.worldId, 'field-researcher').run;
    const receipt = restored.expedition.communication_receipts.at(-1);
    const ctx = receipt.response_contexts[0];
    assert.equal(ctx.semantic_frame.discourse_function, 'ask_reported_speech');
    assert.deepEqual(ctx.response_plan.required_facts.find(f => f.key === 'reported_speech').value.claims.map(c => c.quote), ['What do we do next?']);
    assert.equal(receipt.response_contexts[0].response_plan.may_ask_clarifying_question, false);
    assert.match(restored.expedition.dialogue_history.at(-1).text, /what do we do next/i);
    fresh.shutdown();
  } finally { cleanup(s); }
});

test("a player's answer to a reciprocal check-in is acknowledged by its asker after cold service reload", async () => {
  const s = setup('natural-persistent-2026-10-05', null, { offline: true });
  try {
    const world = s.service.getWorld(s.worldId);
    const asker = s.ids.find(id => ['asks one practical follow-up', 'fills silence with small talk'].includes(world.characters[id]?.identity_substrate?.social_tendency));
    assert.ok(asker, 'fixture has a canonically sociable coworker');
    await say(s, 'How are you feeling?', { target: asker, request_id: 'reciprocal-before-reload' });
    const S = require('../tools/dialogue-state');
    assert.equal(S.inboundFor(s.run, { player_id: s.playerId }).pending?.from, asker);
    const fresh = new DesktopService({ appDataPath: s.root, defaultQ4Scenario: 'day1-opener', developerMode: true });
    fresh.updateSettings({ provider: 'offline' });
    assert.equal(fresh.resumeSession({ world_id: s.worldId, mode: 'field-researcher' }).ok, true);
    const r = await fresh.submitQ4Communication({ world_id: s.worldId, channel: 'local', text: "I'm honestly a bit nervous.", request_id: 'reciprocal-after-reload' });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const run = fresh.session(s.worldId, 'field-researcher').run;
    const spoken = spokenFor(run, 'reciprocal-after-reload', s.playerId);
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].speaker_id, asker);
    assert.equal(S.inboundFor(run, { player_id: s.playerId }).pending, null);
    fresh.shutdown();
  } finally { cleanup(s); }
});

test("a personal disclosure can elicit a coworker's established state, never a manufactured shared mood", () => {
  const make = state => {
    const frame = { ...D.buildSemanticFrame({ text: "I'm honestly a bit nervous.", recipient_type: 'direct' }), turn: { speech_act: 'answer', answers_predicate: 'person.wellbeing', addressee_ids: ['c-omar'] } };
    return D.toAuthorizedContribution(D.planResponses({ frame, owner_ids: ['c-omar'], responders: { 'c-omar': { self: selfOf({ self_state: state }) } }, names: NAMES })[0]);
  };
  const known = make({ state: 'affected', affect: ['a little nervous'] });
  assert.equal(known.optional_facts.some(f => f.key === 'self_state'), true);
  assert.equal(verdict(known, "I'm a little nervous too.", "I'm honestly a bit nervous.").ok, true);
  // Production also checks the observer capsule before accepting wording.
  const { validateAffectClaims } = require('../tools/ai-local-dialogue');
  const packet = { context_capsule: { human_context: { affect: ['a little nervous'] } }, player_message: { text: "I'm honestly a bit nervous." } };
  assert.equal(validateAffectClaims(packet, "I'm furious too.").ok, false);
  assert.equal(validateAffectClaims(packet, "I'm a little nervous. I'm furious too.").ok, false);
  const ordinary = make({ state: 'ordinary', affect: [] });
  assert.equal(ordinary.optional_facts.some(f => f.key === 'self_state'), false);
  const ordinaryPacket = { ...packet, context_capsule: { human_context: { affect: [] } } };
  assert.equal(verdict(ordinary, "I'm a little nervous too.", "I'm honestly a bit nervous.").ok && validateAffectClaims(ordinaryPacket, "I'm a little nervous too.").ok, false);
});

test("A named polite question supersedes the previous reciprocal asker; mentions do not", () => {
  const T = require("../tools/dialogue-turn");
  const present = [{id:"c-malcolm",name:"Malcolm",names:["Malcolm"]},{id:"c-tonya",name:"Tonya",names:["Tonya"]}];
  const dis = {pending_inbound_request:{from:"c-tonya",kind:"question",predicate:"person.wellbeing",answer_shape:"free_short_answer"}};
  const named = T.analyzeTurn({raw:"Malcolm, I hope you don't mind me asking, but are you nervous at all?",present,dis});
  assert.deepEqual(named.primary.addressee.ids,["c-malcolm"]);
  assert.equal(named.primary.args.reply_kind,undefined);
  const mention = T.analyzeTurn({raw:"I spoke with Malcolm, but are you nervous at all?",present,dis});
  assert.notDeepEqual(mention.primary.addressee.ids,["c-malcolm"]);
});

test("Conversation recall may quote the actual player question without asserting private state", () => {
  const C = require("../tools/dialogue-claims");
  const contribution = {discourse_function:"ask_reported_speech",required_facts:[{key:"reported_speech",value:{claims:[{epistemic:"player_claim",speaker_name:"you",quote:"Cecilia, how are you feeling?"}]}}],optional_facts:[]};
  const options = {people:[{id:"c-cecilia",name:"Cecilia"}],speaker_id:"c-other",speaker_name:"Gordon"};
  assert.equal(C.validatePersonalClaims('You said, "Cecilia, how are you feeling?"',contribution,options).ok,true);
  assert.equal(C.validatePersonalClaims('You said, "Cecilia, how are you feeling?" Cecilia is nervous.',contribution,options).ok,false);
  assert.equal(C.validatePersonalClaims('You said, "Cecilia is nervous."',contribution,options).ok,false);
});
