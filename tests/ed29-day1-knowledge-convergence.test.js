"use strict";

// ED-29 — Day-1 canon ratification + knowledge completion + dialogue convergence.
//
//   PROJECT TRUTH  !=  WHAT THIS CHARACTER KNOWS  !=  WHAT THIS CHARACTER MAY SAY ON THIS TURN
//
// The ratified Maxwell briefing, the owner-authorized baseline induction and field procedure, general HEARD
// propositions (from the plans that authorized each line, never re-parsed wording), attributed player
// claims that never become truth, partial knowledge, identity vs role vs authority vs relation, salience,
// corrections, fair spokespeople, advisory addressee/anchor recovery, definition vs current state, current
// vs historical custody, knowledge growth across reload, and provider independence -- all through the real
// production service.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const I = require("../tools/dialogue-interpretation");
const V = require("../tools/dialogue-validation");
const F = require("../tools/dialogue-fallback");
const K = require("../tools/canonical-knowledge");
const A = require("../tools/dialogue-advisory-interpreter");
const opener = require("../tools/cq4-day1-opener");
const ledger = require("../tools/canonical-world-ledger");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { DesktopService } = require("../desktop/service");

// ─── harness (production service path; the Electron flow delivers every briefing beat) ────────────
function setup(seed, provider = null, { beats = 3, before = null, brief = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed29-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED29", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Jack", last_name: "Tester" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  const runNow = () => service.session(worldId, "field-researcher").run;
  const state = { root, service, worldId, logs: [] };
  service.log = (line) => state.logs.push(String(line));
  Object.defineProperty(state, "run", { get: runNow });
  state.playerId = state.run.session.startup.player.observer_id;
  state.team = state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  state.ids = state.team.map((m) => m.personnel_id ?? m.id);
  state.names = state.team.map((m) => m.first_name);
  state.brief = () => {
    if (before) before(runNow());
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    for (let beat = 0; beat < beats; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  };
  if (brief) state.brief();
  return state;
}
const cleanup = (state) => { state.service.shutdown?.(); fs.rmSync(state.root, { recursive: true, force: true }); };
let counter = 0;
async function turn(state, text, extra = {}) {
  const id = extra.request_id ?? `z-${++counter}`;
  state.logs.length = 0;
  await state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: id, ...extra });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const interaction = run.expedition.interaction_history.find((i) => i.submission_id === id) ?? null;
  const traceLine = state.logs.find((line) => line.startsWith("[YB:DISCOURSE_TRACE]"));
  return {
    id, contexts, interaction,
    frame: contexts[0]?.semantic_frame ?? null,
    fn: contexts[0]?.semantic_frame?.discourse_function ?? null,
    owners: contexts.map((c) => c.target_worker_id),
    plan: (who) => (contexts.find((c) => c.target_worker_id === who) ?? contexts[0])?.response_plan ?? null,
    spoken: run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId),
    trace: traceLine ? JSON.parse(traceLine.slice("[YB:DISCOURSE_TRACE] ".length)) : null
  };
}
function scriptedLocal(responder) {
  const fetchImpl = (url, options) => Promise.resolve(responder(JSON.parse(options.body))).then((out) => {
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => ({ id: "t", choices: [{ message: { content: out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ speech: out }) } }] }) };
  });
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:8734", fetchImpl, timeout: 300 });
  return { name: "local", model: real.model, presentLocal: (packet) => real.presentLocal(packet), interpretDialogue: (input) => real.interpretDialogue(input) };
}
const garbage = () => scriptedLocal(() => ({ raw: "{bad" }));
const throwing = () => scriptedLocal(() => new Error("provider crashed"));
const fact = (plan, key) => plan?.required_facts?.find((f) => f.key === key)?.value ?? null;
const entityOf = (state, id) => K.entityIndex(state.run).find((e) => e.id === id);
const q = (state, actor, concept, entityId = null, extra = {}) => K.queryKnowledge(state.run, { actor_id: actor, concept, entity: entityId ? entityOf(state, entityId) : null, ...extra });
const say = (spoken) => spoken.map((e) => e.text).join(" ");

// ─── 1. canon ratification ──────────────────────────────────────────────────────────────────────────
test("ratification — the playable Maxwell briefing is ratified Day-1 canon; mission record and briefing agree", () => {
  const state = setup("ed29-ratify");
  try {
    const run = state.run;
    const briefing = run.expedition.day1_opener.personnel_briefing;
    assert.equal(briefing.authority_status, opener.BRIEFING_AUTHORITY_STATUS);
    assert.equal(briefing.authority_status, "ratified-day1-authored-canon");
    assert.notEqual(briefing.authority_status, "legacy_unreconciled_briefing_material");
    const mission = opener.mission({ run_id: run.run_id });
    assert.equal(mission.authority.provenance, briefing.authority_provenance, "same locked design law");
    assert.equal(mission.authority.briefing_status, briefing.authority_status, "the mission record says the briefing is canon too");
    // The authored scene is unchanged (metadata only).
    const authored = require("../data/worldpacks/clear-q4/cq4-day1-opener.json").briefing_authority.dialogue;
    assert.equal(briefing.dialogue.intro, authored.intro);
    assert.equal(briefing.dialogue.mission_statement, authored.mission_statement);
    assert.equal(briefing.dialogue.dismissal, authored.dismissal);
    // An older save's legacy label is migrated on instantiate; nothing else changes.
    briefing.authority_status = "legacy_unreconciled_briefing_material";
    opener.instantiate(run);
    assert.equal(run.expedition.day1_opener.personnel_briefing.authority_status, "ratified-day1-authored-canon");
  } finally { cleanup(state); }
});

// ─── 2-7. baseline induction, field procedure, ASYNC, Maxwell, startup materials, assignments ─────────
test("baseline — every Day-1 expedition member knows the owner-authorized orientation BEFORE the briefing, nothing more", () => {
  const state = setup("ed29-baseline", null, { brief: false });
  try {
    const actor = state.ids[1];
    const keys = K.knowledgeFor(state.run, actor).map((f) => `${f.key}:${f.epistemic_mode}`);
    for (const key of ["async_purpose", "async_employer", "complex_definition", "threshold_definition", "standard_definition", "standard_comms_definition", "local_definition", "expedition_assignment", "maxwell_identity", "maxwell_role", "maxwell_authority"]) assert.ok(keys.includes(`${key}:baseline_induction`), key);
    for (const key of ["crossing_radio_check", "return_procedure", "carry_capacity", "guidance_tape", "camera_purpose", "field_light_purpose", "verbal_recall_purpose", "layout_record_purpose"]) assert.ok(keys.includes(`${key}:baseline_field_procedure`), key);
    // Nothing from the briefing yet (no mission specifics, no "call me Kirk", no route or timing).
    for (const key of ["mission_statement", "operational_window", "briefed_assignment", "startup_material_destination", "briefing_dismissal", "maxwell_address_form"]) assert.ok(!keys.some((k) => k.startsWith(`${key}:`)), key);
    // Every grant is sourced; the owner-ratified ones say so.
    for (const f of K.knowledgeFor(state.run, actor)) for (const field of ["concept", "proposition", "authority_class", "source_ref", "grant_basis", "epistemic_mode", "valid_scope"]) assert.ok(f[field], `${f.key}.${field}`);
    assert.ok(K.baselineKnowledge(state.run, actor).every((f) => f.authority_class === K.AUTHORITY.OWNER));
    // ASYNC: exactly the one authorized sentence; bounded beyond it.
    const async = q(state, actor, "institution_purpose", "async");
    assert.equal(async.facts[0].statement, "ASYNC organizes and supports controlled research, documentation, logistics and expedition operations related to the Complex.");
    assert.ok(async.bounded_unknown);
    // The Threshold: fixed, not portable; no engineering; no current state.
    assert.match(q(state, actor, "entity_definition", "threshold").facts[0].statement, /fixed crossing between Standard and the Complex.*not equipment/);
    assert.equal(q(state, actor, "entity_definition", "threshold", { facet: "mechanism" }).status, "partial");
    assert.equal(q(state, actor, "entity_state", "threshold").status, "not_established");
    // Field procedure: basic form only (today's route/timing stay mission knowledge).
    const crossing = q(state, actor, "field_procedure", "procedure:crossing").facts[0].statement;
    assert.match(crossing, /radio check with Standard/);
    assert.match(crossing, /two seconds/);
    assert.doesNotMatch(crossing, /Outpost|10:00|noon|KV31/);
    assert.match(q(state, actor, "field_procedure", "procedure:carry-limit").facts[0].statement, /at most two/);
    assert.doesNotMatch(q(state, actor, "field_procedure", "procedure:guidance-tape").facts[0].statement, /Outpost/);
    // Maxwell: identity + authority, no relationship.
    assert.equal(q(state, actor, "person_relation", "dr-kirk-maxwell").status, "partial");
    // Baseline is scoped to expedition personnel: outside the Day-1 opener nobody gets it.
    assert.deepEqual(K.baselineKnowledge({ expedition: { team: state.run.expedition.team } }, actor), []);
  } finally { cleanup(state); }
});

test("startup materials / assignments — destination is not purpose; minimal source-backed task definitions", () => {
  const state = setup("ed29-materials");
  try {
    const [c1, c2, c3] = state.ids;
    const materials = q(state, c1, "assignment_purpose", "task:material-delivery");
    assert.equal(materials.status, "partial");
    assert.equal(materials.missing_requested_detail, "purpose_and_contents");
    assert.ok(materials.facts.some((f) => f.facet === "destination" && /Outpost A, Bermuda branch/.test(f.statement)));
    assert.ok(!materials.facts.some((f) => f.facet === "purpose"), "no purpose is invented");
    const recall = q(state, c3, "assignment_purpose", "task:verbal-recall");
    assert.equal(recall.status, "known");
    assert.match(recall.facts[0].statement, /recording and preserving the expedition's field observations and verbal recall/);
    assert.match(q(state, c2, "assignment_purpose", "task:layout-compilation").facts[0].statement, /record of the layout we observe and explore/);
    // Fallback and validator both keep the distinction.
    const plan = { discourse_function: "ask_assignment_purpose", required_facts: [{ key: "known_concept", value: { concept: "assignment_purpose", statements: materials.facts.map((f) => f.statement), provenance: ["briefing"] } }, { key: "knowledge_gap", value: { missing: "purpose_and_contents", concept: "assignment_purpose" } }], optional_facts: [], forbidden_claims: [], may_ask_clarifying_question: false };
    const line = F.presentFallback({ frame: { discourse_function: "ask_assignment_purpose", referents: [] }, plan });
    assert.match(line, /Outpost A/);
    assert.match(line, /nobody's told me/);
    assert.equal(V.validateContribution(plan, line).ok, true, line);
    assert.equal(V.validateContribution(plan, "They're for Outpost A, Bermuda branch.").ok, false, "destination presented as purpose");
    assert.equal(V.validateContribution(plan, "The startup materials are cargo we're delivering to Outpost A, Bermuda branch.").ok, false, "partial knowledge must say what is not known");
  } finally { cleanup(state); }
});

// ─── 14. briefing beats -> deterministic grants; partial briefing ─────────────────────────────────────
test("briefing — each delivered beat grants its propositions to its listeners, with activation time; undelivered beats grant nothing", () => {
  const partial = setup("ed29-partial", null, { beats: 1 });
  try {
    const actor = partial.ids[0];
    const beats = K.deliveredBriefing(partial.run).map((b) => b.key);
    assert.deepEqual(beats, ["intro", "mission_statement", "dismissal"]);
    for (const beat of K.deliveredBriefing(partial.run)) assert.ok(Number.isFinite(beat.at_interval), `${beat.key} activation time`);
    const keys = K.knowledgeFor(partial.run, actor).filter((f) => f.epistemic_mode === "briefing").map((f) => f.key);
    for (const beat of ["intro", "mission_statement", "dismissal"]) for (const key of K.BRIEFING_BEAT_PROPOSITIONS[beat].filter((k) => !["maxwell_gave_briefing"].includes(k))) if (key !== "next_destination" && key !== "briefing_dismissal") assert.ok(keys.includes(key), `${beat}:${key}`);
    for (const key of ["operational_window", "briefed_assignment", "startup_material_destination"]) assert.ok(!keys.includes(key), `${key} was never delivered`);
    assert.ok(K.knowledgeFor(partial.run, actor).filter((f) => f.epistemic_mode === "briefing").every((f) => f.speaker_id === "dr-kirk-maxwell" && f.activated_at != null));
  } finally { cleanup(partial); }
});

// ─── 15. current procedure follows canonical state ──────────────────────────────────────────────────
test("current procedure — derived from canonical state each time: introductions, then staging, then the post-crossing radio check", () => {
  const state = setup("ed29-procedure");
  try {
    const actor = state.ids[0];
    const now = () => q(state, actor, "current_procedure");
    assert.equal(now().facts[0].next_step, "report to Equipment Staging");
    assert.equal(now().facts[0].current_step, "get acquainted with the team");
    // Staging advances (the canonical handoff state changes): "Equipment Staging" is no longer next.
    state.run.expedition.day1_opener.esd_handoff = { status: "equipment-cooperation", destination: "Equipment Services Division", player_dialogue_input: "paused", coworker_activity: "active" };
    assert.ok(!now().facts.some((f) => f.next_step === "report to Equipment Staging"));
    assert.equal(now().facts[0].key, "at_equipment_staging");
    // After crossing: basic field procedure makes the radio check the next step.
    state.run.expedition.radio = { ...state.run.expedition.radio, authorized: true, check_completed: false, state: "establishing" };
    assert.equal(now().facts.find((f) => f.key === "post_crossing_radio_check")?.next_step, "the radio check with Standard");
    state.run.expedition.radio.check_completed = true;
    assert.ok(!now().facts.some((f) => f.key === "post_crossing_radio_check"));
  } finally { cleanup(state); }
});

// ─── 1-2. HEARD knowledge: plan -> spoken contribution -> listeners -> attributed propositions ────────
test("heard — a line's AUTHORIZED propositions reach exactly its listeners, attributed to the speaker, retrievable by speaker and topic", async () => {
  const state = setup("ed29-heard", garbage(), { before: (run) => { run.spatial.personnel_locations[run.expedition.team.members[3].personnel_id] = "async-briefing-room"; } });
  try {
    const [c1, c2, c3] = state.ids;
    const courier = state.names[1];
    const answer = await turn(state, `${courier}, what are the startup materials for?`);
    assert.deepEqual(answer.owners, [c2]);
    assert.equal(fact(answer.plan(), "knowledge_gap").missing, "purpose_and_contents");
    const heard = K.heardPropositions(state.run, c1).filter((p) => p.speaker_id === c2);
    assert.ok(heard.length, "c1 heard c2");
    for (const p of heard) {
      assert.equal(p.epistemic_mode, "heard");
      assert.ok(p.source_event && p.listeners.includes(c1) && p.entity_ids.includes("task:material-delivery"), p.key);
      assert.ok(p.reported && !/[{}]/.test(p.reported));
    }
    assert.ok(heard.some((p) => /Outpost A, Bermuda branch/.test(p.reported)), "the destination proposition, from the plan (not the wording)");
    // Meaning is taken from the plan: rewriting the committed WORDING changes no heard proposition.
    const before = JSON.stringify(K.heardPropositions(state.run, c1).map((p) => [p.key, p.reported]));
    for (const e of state.run.expedition.dialogue_history.filter((e) => e.speaker_id === c2)) e.text = "Bananas are purple.";
    assert.equal(JSON.stringify(K.heardPropositions(state.run, c1).map((p) => [p.key, p.reported])), before);
    // Retrieval by speaker and topic; a non-listener holds nothing.
    const r = K.reportedSpeech(state.run, { actor_id: c1, speaker_id: c2, entity_ids: ["task:material-delivery"] });
    assert.equal(r.status, "known");
    assert.ok(r.claims.every((c) => c.speaker_id === c2 && c.source_event));
    // "Didn't Maxwell say noon?" -> Maxwell's schedule line (briefing, heard in the room).
    const noon = K.reportedSpeech(state.run, { actor_id: c1, speaker_id: "dr-kirk-maxwell", concept: "schedule" });
    assert.match(noon.claims[0].reported, /12:00 noon/);
    // "Who said we were going to Equipment Staging?"
    const who = K.reportedSpeech(state.run, { actor_id: c3, entity_ids: ["equipment-staging"] });
    assert.ok(who.claims.every((c) => c.speaker_name === "Maxwell"));
    // Canonical truth and heard provenance coexist; the heard report never replaces the actor's own grant.
    assert.ok(!q(state, c1, "assignment_purpose", "task:material-delivery").facts.some((f) => f.provenance === "heard"));
  } finally { cleanup(state); }
});

test("heard — reported-speech questions through the service: attributed, only if heard; the quoted person is not the spokesperson", async () => {
  const state = setup("ed29-reported", garbage());
  try {
    const [c1, c2, c3] = state.ids;
    const [n1, n2, n3] = state.names;
    await turn(state, `${n2}, what are the startup materials for?`);
    const asked = await turn(state, `${n1}, what did ${n2} say the materials were for?`);
    assert.equal(asked.fn, "ask_reported_speech");
    assert.equal(asked.frame.knowledge_query.speaker_id, c2);
    const reported = fact(asked.plan(), "reported_speech");
    assert.ok(reported.claims.every((c) => c.speaker_name === n2));
    assert.match(say(asked.spoken), new RegExp(`${n2} said`));
    assert.match(say(asked.spoken), /Outpost A/);
    // Untargeted: someone who heard it answers, not the one being quoted.
    const untargeted = await turn(state, `What did ${n2} say about the materials?`);
    assert.ok(!untargeted.owners.includes(c2));
    // A person never heard saying anything on a topic: truthful "didn't hear".
    const nothing = await turn(state, `${n1}, what did ${n3} say about the camera?`);
    assert.ok(["did_not_hear_speaker", "not_heard_on_topic"].includes(fact(nothing.plan(), "uncertainty").kind));
    assert.match(say(nothing.spoken), /didn't hear/);
  } finally { cleanup(state); }
});

// ─── 17/18. player claims ───────────────────────────────────────────────────────────────────────────
test("player claims — remembered as PLAYER SAID, recalled only by listeners, never promoted to canonical truth", async () => {
  const state = setup("ed29-claim", garbage());
  try {
    const before = JSON.stringify(state.ids.map((id) => q(state, id, "entity_definition", "complex")));
    const claim = await turn(state, "Actually, Maxwell told me the Complex is a giant aquarium.");
    assert.equal(claim.fn, "make_statement");
    assert.ok(claim.frame.player_claim);
    assert.equal(fact(claim.plan(), "player_claim").confirmed, false);
    assert.equal(claim.owners.length, 1, "one listener acknowledges");
    assert.doesNotMatch(say(claim.spoken), /\b(?:yes|right|true|exactly|aquarium)\b/i);
    // Canonical Complex truth for every listener is unchanged.
    assert.equal(JSON.stringify(state.ids.map((id) => q(state, id, "entity_definition", "complex"))), before);
    // Listeners remember it as the player's claim.
    for (const id of state.ids) {
      const claims = K.heardPropositions(state.run, id).filter((p) => p.epistemic_mode === "player_claim");
      assert.ok(claims.some((p) => /aquarium/.test(p.text) && p.entity_ids.includes("complex") && p.entity_ids.includes("dr-kirk-maxwell")));
      assert.ok(!K.knowledgeFor(state.run, id).some((f) => /aquarium/.test(f.statement)), "never a knowledge grant");
    }
    const recall = await turn(state, "What did I say Maxwell told me?");
    assert.equal(recall.fn, "ask_reported_speech");
    assert.match(say(recall.spoken), /You said, "Actually, Maxwell told me the Complex is a giant aquarium\."/);
    // Endorsement is rejected by the validator.
    const contribution = recall.contexts[0].authorized_contribution;
    assert.equal(V.validateContribution(contribution, "You said Maxwell told you the Complex is a giant aquarium, and that's right.").ok, false);
    const claimContribution = claim.contexts[0].authorized_contribution;
    assert.equal(V.validateContribution(claimContribution, "Yeah, it is a giant aquarium.", { player_text: "Actually, Maxwell told me the Complex is a giant aquarium." }).ok, false);
    assert.equal(V.validateContribution(claimContribution, "Huh. If you say so.", { player_text: "Actually, Maxwell told me the Complex is a giant aquarium." }).ok, true);
    // After a cold reload the claim is still attributed and still not truth.
    const reloaded = reload(state);
    assert.ok(K.heardPropositions(reloaded.run, state.ids[0]).some((p) => p.epistemic_mode === "player_claim" && /aquarium/.test(p.text)));
    assert.equal(JSON.stringify(state.ids.map((id) => K.queryKnowledge(reloaded.run, { actor_id: id, concept: "entity_definition", entity: K.entityIndex(reloaded.run).find((e) => e.id === "complex") }))), before);
    cleanup(reloaded);
  } finally { cleanup(state); }
});

// ─── 3. semantic anchors ─────────────────────────────────────────────────────────────────────────────
test("anchors — non-exact follow-ups resolve to the same authorized object; Tier 2 may only choose within the closed set", async () => {
  const state = setup("ed29-anchor", garbage());
  try {
    const recall = state.names[0];
    for (const text of ["What record?", "What recording?", "Why are you recording?", "What is the verbal record?", "What does that mean?"]) {
      await turn(state, `${recall}, what's your job?`);
      const follow = await turn(state, text);
      assert.deepEqual(follow.owners, [state.ids[0]], `${text}: stays with the speaker whose line introduced it`);
      const meaning = fact(follow.plan(), "utterance_meaning");
      const known = fact(follow.plan(), "known_concept");
      assert.ok(meaning?.meaning?.key === "current_assignment" || known?.statements?.some((s) => /verbal recall/.test(s)), `${text} -> the verbal-recall assignment (${follow.fn})`);
    }
    // Only facts the previous line was authorized with are candidates; model wording adds none.
    await turn(state, `${recall}, what's your job?`);
    const discourse = D.deriveDiscourseState({ interaction_history: state.run.expedition.interaction_history, dialogue_history: state.run.expedition.dialogue_history, player_id: state.playerId, location_id: state.run.spatial.player_location, current_interval: state.run.expedition.clock.interval, equipment: state.run.expedition.equipment, receipts: state.run.expedition.communication_receipts, entities: K.entityIndex(state.run) });
    const candidates = D.anchorCandidates(discourse).map((c) => c.label);
    assert.ok(candidates.includes("handling observation and verbal recall"));
    assert.equal(A.validateAdvisory({ intent: "factual_other", referent_text: null, confidence: 0.9, anchor_candidate: 9 }, "What's up with that?", { anchor_count: candidates.length }).reason, "anchor_out_of_range");
    const choice = A.validateAdvisory({ intent: "factual_other", referent_text: null, confidence: 0.9, anchor_candidate: candidates.indexOf("handling observation and verbal recall") + 1 }, "What's up with that?", { anchor_count: candidates.length });
    assert.equal(choice.accepted, true);
    const frame = D.buildSemanticFrame({ text: "What's up with what you're doing?", discourse, entities: K.entityIndex(state.run), advice: choice, addressee_ids: [state.ids[0]] });
    assert.equal(frame.discourse_function, "ask_meaning");
    assert.equal(frame.utterance_reference.speaker_id, state.ids[0]);
  } finally { cleanup(state); }
});

// ─── 4. active-thread follow-up ownership ─────────────────────────────────────────────────────────────
test("threads — a follow-up about the previous speaker's line stays with them (direct or answered-to-the-room)", async () => {
  const state = setup("ed29-thread", garbage());
  try {
    const [c1, c2] = state.ids;
    const [n1, n2] = state.names;
    await turn(state, `${n2}, what's your job?`);
    const follow = await turn(state, "What exactly are those for?");
    assert.deepEqual(follow.owners, [c2]);
    assert.equal(follow.fn, "ask_assignment_purpose");
    await turn(state, `${n1}, what's your job?`);
    const meaning = await turn(state, "What does that mean?");
    assert.deepEqual(meaning.owners, [c1]);
    // An explicit address still changes the target.
    const redirected = await turn(state, `${n2}, what does that mean?`);
    assert.deepEqual(redirected.owners, [c2]);
  } finally { cleanup(state); }
});

// ─── 5. identity vs role vs authority vs relation; 6. salience; 17. person knowledge ─────────────────
test("people — identity, role, authority and relation are distinct; salience resolves 'that doctor' only when unique", async () => {
  const state = setup("ed29-people", garbage());
  try {
    // Nothing said since the briefing: the departed briefing doctor is uniquely salient.
    const doctor = await turn(state, "Who was that doctor?");
    assert.equal(doctor.frame.knowledge_query.entity.id, "dr-kirk-maxwell");
    assert.equal(doctor.frame.knowledge_query.person_basis, "recent_departure");
    const role = await turn(state, "What does Maxwell do?");
    assert.equal(role.frame.semantic_intent, "person_role");
    assert.ok(fact(role.plan(), "known_concept").statements.every((s) => !/^That's Dr\. Kirk Maxwell\.$/.test(s)), "a role, not merely his name");
    assert.match(say(role.spoken), /Standard-side authority|assignment briefing/);
    const his = await turn(state, "What's his job?");
    assert.equal(his.frame.semantic_intent, "person_role");
    assert.equal(his.frame.knowledge_query.entity.id, "dr-kirk-maxwell");
    const why = await turn(state, "Why is he briefing us?");
    assert.equal(why.frame.semantic_intent, "person_authority");
    const charge = await turn(state, "Who's in charge here?");
    assert.equal(charge.frame.semantic_intent, "person_authority");
    assert.equal(fact(charge.plan(), "knowledge_gap").missing, "command", "authority known, overall command not");
    const relation = await turn(state, "Do you know Maxwell?");
    assert.equal(relation.frame.semantic_intent, "person_relation");
    assert.equal(fact(relation.plan(), "knowledge_gap").missing, "acquaintance");
    assert.doesNotMatch(say(relation.spoken), /friend|worked with|known him for|years/i);
    const identity = await turn(state, "Who is Maxwell?");
    assert.equal(identity.frame.semantic_intent, "person_identity");
    // After other topics Maxwell is no longer uniquely salient; a present field medical doctor exists: ask.
    await turn(state, "What is the Threshold?");
    const later = await turn(state, "Who was that doctor?");
    assert.equal(later.plan().may_ask_clarifying_question, true);
    // Known entity, canonical-but-unknown entity, unrecognized entity.
    const control = K.entityIndex(state.run).find((e) => e.world_only && e.kind === "person");
    if (control) {
      const unknownPerson = await turn(state, `Who is ${control.label}?`);
      assert.equal(fact(unknownPerson.plan(), "uncertainty").kind, "unknown_person");
      assert.equal(unknownPerson.trace.pragmatics.knowledge_results[0].entity_resolution, "canonical_entity_not_known_to_actor");
    }
    const bob = await turn(state, "Who is Bob?");
    assert.equal(fact(bob.plan(), "uncertainty").kind, "unknown_person");
    assert.equal(bob.trace.pragmatics.knowledge_results[0].entity_resolution, "unrecognized_entity");
  } finally { cleanup(state); }
});

// ─── 16. "what do we do here?" family distinctions ──────────────────────────────────────────────────
test("paraphrase families — institution / expedition / personal role / current action / procedure / location purpose", () => {
  const state = setup("ed29-families");
  try {
    const entities = K.entityIndex(state.run);
    const frame = (text) => D.buildSemanticFrame({ text, entities });
    const families = {
      institution_purpose: ["What does ASYNC do?", "What does ASYNC actually do?", "What do people do around here?", "What do we actually do around here?"],
      mission_objective: ["What are we doing here today?", "What is today's job?", "What are we doing today?", "What's the mission?"],
      role_or_assignment: ["What do you do here?", "What is your job?", "What exactly is your role?"],
      current_action: ["What are you doing right now?", "What are you up to right now?"],
      location_purpose: ["What is this room for?", "What's this room used for?"],
      entity_definition: ["What exactly is the Complex?", "What does Standard mean?", "What's LOCAL?", "What is the portal?", "What is the verbal record?"],
      entity_state: ["Is the Threshold on right now?", "Is the Threshold active?"],
      person_role: ["What does Maxwell do?", "What is Maxwell's role?"],
      person_authority: ["Who's in charge here?", "Who do we report to?"],
      person_relation: ["Do you know Maxwell?", "Have you met Kirk before?"]
    };
    for (const [concept, list] of Object.entries(families)) for (const text of list) {
      const f = frame(text);
      const got = f.knowledge_query?.concept ?? null;
      assert.equal(got, concept, `${text} -> ${f.discourse_function}/${got}`);
    }
    for (const text of ["What do we do now?", "Where do we go next?", "What happens next?"]) assert.equal(frame(text).discourse_function, "ask_next_step", text);
    // The player's synonym is understood; the entity is the canonical Threshold.
    assert.equal(frame("What is the portal?").knowledge_query.entity.id, "threshold");
  } finally { cleanup(state); }
});

// ─── 12. definitions vs current state; 13. terminology ──────────────────────────────────────────────
test("definition vs state + terminology — knowing what something IS never implies its current state; NPCs keep canonical terms", async () => {
  const state = setup("ed29-state", garbage());
  try {
    const on = await turn(state, "Is the Threshold on right now?");
    assert.equal(on.frame.semantic_intent, "entity_state");
    assert.equal(fact(on.plan(), "uncertainty").kind, "current_state_unknown");
    assert.doesNotMatch(say(on.spoken), /\b(?:yes|it is|active|on|energi[sz]ed)\b.*\bnow\b|^(?:yes|yeah)/i);
    const portal = await turn(state, "What is the portal?");
    assert.match(say(portal.spoken), /the Threshold/i);
    assert.doesNotMatch(say(portal.spoken), /portal/i);
    const contribution = portal.contexts[0].authorized_contribution;
    for (const bad of ["It's the portal between Standard and the Complex.", "The threshold device takes you across.", "It's a handheld threshold."]) assert.equal(V.validateContribution(contribution, bad).ok, false, bad);
  } finally { cleanup(state); }
});

// ─── 8/9. group self-introduction; social responses are not interviews ──────────────────────────────
test("social — a self-introduction to the team gets one short ack from each present teammate; acks never interview or brief", async () => {
  const state = setup("ed29-social", garbage());
  try {
    for (const text of ["Good morning everyone. I'm Jack. First day.", "Hi, I'm Jack. First day.", "Good morning, I'm your expedition lead."]) {
      const intro = await turn(state, text);
      assert.equal(intro.fn, "introduce_self", text);
      assert.equal(intro.owners.length, state.ids.length, `${text}: every present teammate`);
      for (const line of intro.spoken) assert.ok(line.text.split(/\s+/).length <= 10 && !/\?/.test(line.text), line.text);
    }
    // A greeting alone to the room is still one reply; a factual question to the room one spokesperson.
    assert.equal((await turn(state, "Morning.")).owners.length, 1);
    const plan = { discourse_function: "introduce_self", required_facts: [], optional_facts: [], forbidden_claims: ["unrequested_mission_briefing", "unrelated_task_offer"], may_ask_clarifying_question: false, expected_response_shape: "short_social_acknowledgment" };
    for (const bad of ["Is there a procedure I should follow?", "Should I write that down?", "What do you need from me?", "Would you like me to grab the camera?", "Nice to meet you. I'm compiling the layout record.", "Nice to meet you. Maxwell said we return at noon.", "First day for me too.", "How can I help?"]) assert.equal(V.validateContribution(plan, bad, { player_text: "Hi, I'm Jack. First day." }).ok, false, bad);
    for (const good of ["Nice to meet you, Jack.", "Welcome aboard.", "Good to meet you."]) assert.equal(V.validateContribution(plan, good, { player_text: "Hi, I'm Jack. First day." }).ok, true, good);
  } finally { cleanup(state); }
});

// ─── 25. response-owner fairness ─────────────────────────────────────────────────────────────────────
test("fairness — untargeted shared questions rotate to the least-recently-spoken knower, deterministically", async () => {
  const state = setup("ed29-fair", garbage());
  try {
    const owners = [];
    for (const text of ["What are we doing today?", "Where do we go next?", "What is the Threshold?", "What's LOCAL?", "What does ASYNC do?", "What is the Complex?"]) owners.push(...(await turn(state, text)).owners);
    assert.ok(new Set(owners).size >= 3, `spokespeople rotate: ${owners}`);
    for (let i = 1; i < owners.length; i += 1) assert.notEqual(owners[i], owners[i - 1], "the same coworker does not answer twice running without a semantic reason");
    // Pure policy: least recently spoken, ties in canonical order; no model input.
    assert.equal(I.spokesperson([{ id: "a", last_spoke_seq: 5 }, { id: "b", last_spoke_seq: 2 }, { id: "c", last_spoke_seq: 9 }]).id, "b");
    assert.equal(I.spokesperson([{ id: "a", last_spoke_seq: -1 }, { id: "b", last_spoke_seq: -1 }]).id, "a");
    // An active thread still overrides rotation.
    await turn(state, `${state.names[1]}, what's your job?`);
    assert.deepEqual((await turn(state, "What are those for?")).owners, [state.ids[1]]);
  } finally { cleanup(state); }
});

// ─── 24. player corrections ──────────────────────────────────────────────────────────────────────────
test("corrections — 'No, I meant Brady.' re-asks the same question of the intended person; identity facts never change", async () => {
  const state = setup("ed29-correct", garbage());
  try {
    const [c1, c2, c3] = state.ids;
    const [n1, n2, n3] = state.names;
    const asked = await turn(state, "What is the Threshold?");
    const answered = asked.owners[0];
    const other = state.ids.find((id) => id !== answered);
    const otherName = state.names[state.ids.indexOf(other)];
    const identityBefore = JSON.stringify(state.run.expedition.team.members.map((m) => [m.personnel_id, m.first_name, m.role]));
    for (const form of [`No, I meant ${otherName}.`, `I was asking ${otherName}.`, `No, ${otherName}.`]) {
      const fixed = await turn(state, form);
      assert.deepEqual(fixed.owners, [other], form);
      assert.equal(fixed.fn, "ask_entity_definition", `${form} re-asks the question`);
      assert.equal(fixed.interaction.address.form, "correction");
      await turn(state, "What is the Threshold?");
    }
    // A named pair: "No, the other one." resolves to the one who did not answer.
    const pair = await turn(state, `${n1} and ${n2}, what is LOCAL?`);
    const pairOther = [c1, c2].find((id) => !pair.owners.includes(id));
    if (pair.owners.length === 1 && pairOther) assert.deepEqual((await turn(state, "No, the other one.")).owners, [pairOther]);
    // Ambiguous: clarify who, then the bare name resolves the correction.
    const excluded = (await turn(state, "What is the Complex?")).owners[0];
    const unclear = await turn(state, `Not ${state.names[state.ids.indexOf(excluded)]}.`);
    assert.equal(unclear.plan().may_ask_clarifying_question, true);
    assert.equal(unclear.plan().expected_slot, "person");
    const intended = state.ids.find((id) => id !== excluded);
    const named = await turn(state, `${state.names[state.ids.indexOf(intended)]}.`);
    assert.deepEqual(named.owners, [intended]);
    assert.equal(named.fn, "ask_entity_definition");
    void c3; void n3;
    assert.equal(JSON.stringify(state.run.expedition.team.members.map((m) => [m.personnel_id, m.first_name, m.role])), identityBefore, "no identity fact was rewritten");
    assert.equal(I.addressCorrection("No, I'm Jack."), null, "not an address correction");
  } finally { cleanup(state); }
});

// ─── 7. advisory addressee recovery; 20. advisory stays bounded ─────────────────────────────────────
test("advisory — addressee span is language only: verbatim, resolved by code to a present coworker, never a mention", async () => {
  let calls = 0;
  let lastPrompt = null;
  const state = setup("ed29-addr", null);
  const [, c2] = state.ids;
  const [, n2] = state.names;
  const provider = scriptedLocal((body) => {
    const system = body.messages.find((m) => m.role === "system").content;
    if (/classify the LANGUAGE/.test(system)) { calls += 1; lastPrompt = body.messages.find((m) => m.role === "user").content; return { raw: JSON.stringify({ intent: "role_or_assignment", referent_text: null, confidence: 0.9, addressee_text_span: n2 }) }; }
    return "Hm.";
  });
  state.service.localDialogueProvider = provider;
  try {
    const recovered = await turn(state, `so what's the deal with your work ${n2}`);
    if (calls) {
      // ED-30: the v2 advisory offers the present people as opaque labels (the v1 prompt asked for a span);
      // either way the model's words are language only and code maps them to a present coworker. Tier 1
      // may now resolve the clause-final name itself (a trailing vocative).
      assert.match(lastPrompt, /addressee_text_span|People at the table \(addressee labels\): (?:p\d=\w+(?:, )?)+/);
      assert.doesNotMatch(lastPrompt, /yb-personnel|q4-player/, "no ids reach the advisory");
      assert.ok(["advisory_span", "trailing_vocative"].includes(recovered.interaction.address.form));
      assert.deepEqual(recovered.owners, [c2]);
    }
    // Tier 1 resolved address: no addressee question is asked of the model.
    calls = 0;
    await turn(state, `${n2}, what's your job?`);
    assert.equal(calls, 0);
    // Validation: verbatim spans only; no ids; a subject-mention is never an address.
    assert.equal(A.validateAdvisory({ intent: "role_or_assignment", referent_text: null, confidence: 0.9, addressee_text_span: "yb-personnel-1" }, "what does Clint do").reason, "addressee_not_in_utterance");
    assert.equal(A.validateAdvisory({ intent: "role_or_assignment", referent_text: null, confidence: 0.9, addressee_text_span: "Brady" }, "what does Clint do").reason, "addressee_not_in_utterance");
    assert.equal(A.validateAdvisory({ intent: "role_or_assignment", referent_text: null, confidence: 0.9, addressee_text_span: "Clint" }, "what does Clint do").accepted, true);
  } finally { cleanup(state); }
});

// ─── 11. reason taxonomy; developer trace ──────────────────────────────────────────────────────────
test("taxonomy + trace — machine reasons in the developer trace only; a parse failure is never voiced as ignorance", async () => {
  const state = setup("ed29-trace", garbage());
  try {
    const partial = await turn(state, "What are the startup materials for?");
    const p = partial.trace.pragmatics;
    assert.equal(p.semantic_reason, "partial_knowledge");
    assert.equal(p.semantic_intent, "assignment_purpose");
    assert.equal(p.canonical_entity.id, "task:material-delivery");
    assert.ok(p.response_owners.length === 1);
    assert.equal(p.partial_knowledge[0].missing_requested_detail, "purpose_and_contents");
    assert.ok(p.candidate_propositions[0].keys.length);
    assert.ok(p.knowledge_results[0].facts.every((f) => /^[a-z_]+:[a-z_]+$/.test(f)), "keys + provenance only");
    const camera = await turn(state, "Who has the camera?");
    assert.equal(camera.trace.pragmatics.current_vs_historical[0].resolution, "current");
    // An untypable question naming a canonical entity, with no advisory: clarified, never "I don't know".
    const generic = await turn(state, "Threshold stuff, huh, what's the story?");
    assert.ok(["interpretation_failure", "advisory_unavailable", "reference_ambiguity", null].includes(generic.trace.pragmatics.semantic_reason));
    for (const line of generic.spoken) assert.doesNotMatch(line.text, /don't know|nobody's told/i);
    // No machine label ever reaches player-visible text.
    for (const e of state.run.expedition.dialogue_history) assert.doesNotMatch(String(e.text), /partial_knowledge|legitimate_unknown|interpretation_failure|missing_structured_canon|reference_ambiguity|advisory_unavailable|knowledge_projection_failure/);
  } finally { cleanup(state); }
});

// ─── 22. epistemic contradiction; 23. knowledge revision ────────────────────────────────────────────
test("contradiction — two attributed claims coexist for a listener who heard both; nothing collapses into one truth", () => {
  const state = setup("ed29-contra");
  try {
    const [c1, c2, c3] = state.ids;
    const run = state.run;
    const camera = run.expedition.equipment["recording-device"];
    const planWith = (holder_name) => ({ discourse_function: "ask_item_ownership", required_facts: [{ key: "item_holder", value: { label: camera.label, holder_name, holder_is_self: false } }], optional_facts: [], fact_semantics: { custody: { resolution: "current", equipment_id: camera.id } } });
    run.expedition.communication_receipts ??= [];
    run.expedition.dialogue_history ??= [];
    const push = (sid, speaker, name, plan) => {
      run.expedition.communication_receipts.push({ id: sid, response_contexts: [{ target_worker_id: speaker, response_plan: plan }] });
      run.expedition.dialogue_history.push({ id: `${sid}-e`, submission_id: sid, speaker_id: speaker, speaker_name: name, listeners: [state.playerId, c3], channel: "LOCAL", kind: "speech", delivery: "delivered", text: "(wording irrelevant)", interval: 1 });
    };
    push("contra-1", c1, state.names[0], planWith("you"));
    push("contra-2", c2, state.names[1], planWith(state.names[0]));
    const r = K.reportedSpeech(run, { actor_id: c3, entity_ids: [camera.id] });
    assert.equal(r.claims.length, 2);
    assert.deepEqual(r.claims.map((c) => c.speaker_id).sort(), [c1, c2].sort());
    const line = F.presentFallback({ frame: { discourse_function: "ask_reported_speech", referents: [] }, plan: { discourse_function: "ask_reported_speech", required_facts: [{ key: "reported_speech", value: { claims: r.claims.map((c) => ({ speaker_name: c.speaker_name, epistemic: c.epistemic_mode, reported: c.reported })) } }] } });
    assert.match(line, new RegExp(`${state.names[0]} said .*, but ${state.names[1]} said`));
    // Someone who heard only one of them holds only that one.
    assert.equal(K.reportedSpeech(run, { actor_id: c2, entity_ids: [camera.id] }).claims.length, 0, "c2 was not a listener of either line (they spoke one)");
  } finally { cleanup(state); }
});

test("revision — current custody comes from canonical state; 'who had it earlier' from the listener's earlier snapshot", async () => {
  const state = setup("ed29-revision", garbage());
  try {
    const [c1, c2] = state.ids;
    const run = state.run;
    const camera = run.expedition.equipment["recording-device"];
    const at = run.expedition.clock.interval;
    ledger.recordCustodyObserved(run, { equipment_id: camera.id, holder_id: state.playerId, observers: [c1], interval: at });
    // The camera changes hands (canonical state), and c1 sees it.
    camera.holder = c2;
    ledger.recordCustodyObserved(run, { equipment_id: camera.id, holder_id: c2, from: state.playerId, observers: [c1], interval: at + 1 });
    run.expedition.clock.interval = at + 1;
    const grants = K.knowledgeFor(run, c1).filter((f) => f.concept === "custody");
    assert.ok(grants.some((f) => f.key === "observed_custody" && f.epistemic_mode === "observed"));
    const current = await turn(state, `${state.names[0]}, who has the camera?`);
    assert.equal(fact(current.plan(), "item_holder").holder_name, state.names[1], "current custody = canonical holder");
    const earlier = await turn(state, `${state.names[0]}, who had the camera earlier?`);
    assert.equal(earlier.frame.custody_time, "historical");
    const past = fact(earlier.plan(), "item_holder_history");
    assert.equal(past.holder_name, "you", "the earlier snapshot: it was with the player");
    assert.equal(earlier.trace.pragmatics.current_vs_historical[0].resolution, "historical");
    // Memory never overrides commit-sensitive current state.
    assert.ok(!fact(earlier.plan(), "item_holder"));
    // Real-model regression: wording may not move the earlier custody onto the speaker.
    const c = earlier.contexts[0].authorized_contribution;
    assert.equal(V.validateContribution(c, "I had the 35mm field camera earlier.").ok, false);
    assert.equal(V.validateContribution(c, "Earlier the 35mm field camera was with you.").ok, true);
  } finally { cleanup(state); }
});

// ─── 21. knowledge growth (baseline -> briefing -> heard -> observed -> reload) ───────────────────────
function reload(state) {
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed29-reload-"));
  fs.cpSync(state.root, root2, { recursive: true });
  const service = new DesktopService({ appDataPath: root2, defaultQ4Scenario: "day1-opener", developerMode: true });
  const world = service.getWorld(state.worldId);
  const entry = service.restoreSession(world, "field-researcher", JSON.parse(fs.readFileSync(service.sessionFile(state.worldId, "field-researcher"), "utf8")));
  return { root: root2, service, run: entry.run };
}
test("growth — the same actor's answer gets richer as canonical knowledge grows; the model sees only the selected slice; reload is identical", async () => {
  const state = setup("ed29-growth", garbage(), { brief: false });
  try {
    const [c1, c2] = state.ids;
    const snapshot = () => ({
      mission: q(state, c1, "mission_objective").facts.map((f) => `${f.key}:${f.provenance}`),
      materials: q(state, c1, "assignment_purpose", "task:material-delivery").facts.map((f) => `${f.key}:${f.provenance}`),
      heard: K.heardPropositions(state.run, c1).filter((p) => p.epistemic_mode === "heard").map((p) => p.key),
      custody: K.knowledgeFor(state.run, c1).filter((f) => f.concept === "custody").map((f) => f.key)
    });
    const s0 = snapshot();
    assert.deepEqual(s0.mission, ["expedition_assignment:baseline_induction"]);
    assert.deepEqual(s0.materials, []);
    state.brief();
    const s1 = snapshot();
    assert.ok(s1.mission.includes("mission_statement:briefing") && s1.mission.length > s0.mission.length);
    assert.ok(s1.materials.includes("startup_material_destination:briefing"));
    await turn(state, `${state.names[1]}, what are the startup materials for?`);
    const s2 = snapshot();
    assert.ok(s2.heard.length > s1.heard.length, "heard a teammate");
    const camera = state.run.expedition.equipment["recording-device"];
    ledger.recordCustodyObserved(state.run, { equipment_id: camera.id, holder_id: camera.holder, observers: [c1] });
    const s3 = snapshot();
    assert.deepEqual(s3.custody, ["observed_custody"]);
    // The model-facing slice stays bounded to the question (never the whole knowledge list).
    const asked = await turn(state, `${state.names[0]}, what are we doing today?`);
    const statements = fact(asked.plan(), "known_concept").statements;
    assert.ok(statements.length <= 3 && K.knowledgeFor(state.run, c1).length > 20);
    assert.ok(!JSON.stringify(asked.contexts[0].authorized_contribution).includes("carry at most"), "no unrelated grant leaks into the slice");
    // Cold reload: everything reconstructs identically from persisted canonical state.
    const reloaded = reload(state);
    try {
      const again = (run) => JSON.stringify(state.ids.map((id) => [K.knowledgeFor(run, id).map((f) => [f.key, f.epistemic_mode, f.entity_id ?? null, f.activated_at ?? null]), K.heardPropositions(run, id).map((p) => [p.speaker_id, p.key, p.reported ?? p.text])]));
      assert.equal(again(reloaded.run), again(state.run));
    } finally { cleanup(reloaded); }
    void c2;
  } finally { cleanup(state); }
});

// ─── 19. nested quotes ───────────────────────────────────────────────────────────────────────────────
test("quotes — fallback quotation never nests double quotes or doubles terminal punctuation; content is preserved", () => {
  assert.equal(F.quoteLine('I said, "Hey."'), `"I said, 'Hey.'"`);
  assert.equal(F.quoteLine('"Hey."'), '"Hey."');
  assert.equal(F.quoteLine("Hello"), '"Hello."');
  assert.equal(F.quoteLine("Wait, what?"), '"Wait, what?"');
  const plan = { required_facts: [{ key: "antecedent_responses", value: [{ speaker_name: "Ava", text: 'I said, "Hey."', is_self: true }] }] };
  const line = F.presentFallback({ frame: { discourse_function: "clarify_previous", antecedent: { resolved: true } }, plan });
  assert.equal(line, `I just said, "I said, 'Hey.'"`);
  assert.doesNotMatch(line, /"[^"]*"[^"]*"[^"]*"/, "one pair of double quotes");
  assert.doesNotMatch(line, /\."\./);
  assert.equal(F.presentFallback({ frame: { discourse_function: "request_repetition", antecedent: { resolved: true } }, plan: { required_facts: [{ key: "antecedent_responses", value: [{ speaker_name: "Roy", text: "Hey.", is_self: false }] }] } }), 'Roy said, "Hey."');
});

// ─── adversarial contribution ceiling ─────────────────────────────────────────────────────────────────
test("ceiling — safe-to-know facts never leak into a turn that does not authorize them", () => {
  const plan = (fn, required = []) => ({ discourse_function: fn, required_facts: required, optional_facts: [], forbidden_claims: ["unrequested_mission_briefing", "unrelated_task_offer"], may_ask_clarifying_question: false });
  const cases = [
    [plan("check_in", [{ key: "self_state", value: { state: "ordinary", affect: [] } }]), "I'm fine. I'm carrying the camera."],
    [plan("greet"), "Morning. We deploy at ten."],
    [plan("ask_item_ownership", [{ key: "item_holder", value: { label: "35mm field camera", holder_name: "you", holder_is_self: false } }]), "You've got the camera. Next we go to Equipment Staging."],
    [plan("ask_role_or_assignment", [{ key: "role", value: "field technician" }]), "I'm the field technician. I saw something strange earlier."],
    [plan("introduce_self"), "Nice to meet you. Maxwell said we return at noon."],
    [plan("ask_explanation", [{ key: "explanation_basis", value: { kind: "custody", label: "35mm field camera", holder_name: "you", holder_is_self: false, known_by: "briefing", known_from: "Maxwell at the briefing" } }]), "I know because I saw it, and ASYNC studies the Complex."]
  ];
  for (const [contribution, speech] of cases) assert.equal(V.validateContribution(contribution, speech).ok, false, speech);
  // Real-model regression: a speaker addressing THEMSELVES by name is rejected; a greeting with the player's name is not.
  const role = plan("ask_role_or_assignment", [{ key: "name", value: "Ann" }, { key: "role", value: "field technician" }, { key: "current_assignment", value: "delivering the startup materials" }]);
  assert.equal(V.validateContribution(role, "Ann, I'm a field technician. I'm delivering the startup materials.").ok, false);
  assert.equal(V.validateContribution(role, "I'm a field technician. I'm delivering the startup materials.", { speaker_name: "Ann" }).ok, true);
  // Licensed versions pass.
  assert.equal(V.validateContribution(cases[2][0], "You've got the 35mm field camera.").ok, true);
  assert.equal(V.validateContribution(cases[5][0], "Maxwell said so at the briefing.").ok, true);
});

// ─── provider independence ────────────────────────────────────────────────────────────────────────────
const SEQUENCE = (n) => ["Good morning everyone. I'm Jack. First day.", "What does ASYNC actually do?", "What exactly is the Complex?", "What is the Threshold?", "How does the Threshold work?", "What does Standard mean?", "What's LOCAL?", "What are we doing today?", "Where do we go next?", "Who was that doctor who briefed us?", "What does Maxwell do?", `${n[1]}, what is your job?`, "What are the startup materials for?", "Who has the camera?", "How do you know?", `${n[0]}, what did ${n[1]} say the materials were for?`, "Actually, Maxwell told me the Complex is a giant aquarium.", "What did I say Maxwell told me?", `No, I meant ${n[2]}.`, "What's the plan for today?", "Where are we headed next?", "Who's in charge here?"];
async function digestFor(provider) {
  const state = setup("ed29-indep", provider);
  try {
    for (const [i, text] of SEQUENCE(state.names).entries()) await turn(state, text, { request_id: `s-${i}` });
    const run = state.run;
    const WORDED = new Set(["text", "line", "own_reply", "quote"]);
    return crypto.createHash("sha256").update(JSON.stringify({
      interactions: run.expedition.interaction_history.map((i) => [i.recipient_type, i.recipient_ids, i.address ?? null, (i.response_owners ?? []).map((o) => o.speaker_id)]),
      contexts: run.expedition.communication_receipts.map((r) => (r.response_contexts ?? []).map((c) => [c.target_worker_id, c.semantic_frame, c.response_plan, c.authorized_contribution])),
      custody: Object.fromEntries(Object.entries(run.expedition.equipment).map(([k, v]) => [k, v.holder])),
      knowledge: state.ids.map((id) => K.knowledgeFor(run, id).map((f) => [f.concept, f.key, f.entity_id ?? null, f.epistemic_mode])),
      heard: state.ids.map((id) => K.heardPropositions(run, id).map((p) => [p.speaker_id, p.key, p.epistemic_mode]))
    }, (key, value) => (WORDED.has(key) && typeof value === "string" ? "<spoken>" : value))).digest("hex");
  } finally { cleanup(state); }
}
test("independence — fallback, malformed, throwing, wording and advisory-unavailable providers: identical semantics and truth", async () => {
  const wording = scriptedLocal((body) => {
    const user = body.messages.find((m) => m.role === "user")?.content ?? "";
    if (/classify the LANGUAGE/.test(body.messages.find((m) => m.role === "system").content)) return { raw: "{bad" };
    const said = user.match(/say only this, plainly, in your own words, adding nothing:\n\s+"([^"]+)"/);
    return said ? said[1] : "Hm.";
  });
  const reference = await digestFor(null);
  for (const [name, provider] of [["malformed", garbage()], ["throwing", throwing()], ["wording", wording]]) assert.equal(await digestFor(provider), reference, name);
});

// ─── the 20-turn human acceptance sequence (fallback path; the real model runs it in the report) ─────
test("acceptance — the owner's 20-turn sequence meets every expected semantic outcome", async () => {
  const state = setup("ed29-acceptance", garbage());
  try {
    const n = state.names;
    const r = [];
    for (const text of SEQUENCE(n)) r.push(await turn(state, text));
    const [intro, async, complex, threshold, how, standard, local, today, next, doctor, maxwell, job, materials, camera, howKnow, reported, claim, recall, correction] = r;
    assert.equal(intro.owners.length, 3);
    assert.match(say(async.spoken), /^ASYNC organizes and supports controlled research, documentation, logistics and expedition operations related to the Complex\./);
    assert.match(say(complex.spoken), /environment our expedition operates in/);
    assert.match(say(threshold.spoken), /fixed crossing between Standard and the Complex/);
    assert.match(say(how.spoken), /nobody's told me/);
    assert.match(say(standard.spoken), /Standard is the ASYNC side/);
    assert.match(say(local.spoken), /LOCAL is talking with the team in person/);
    assert.match(say(today.spoken), /delivery and introductory reconnaissance/);
    assert.match(say(next.spoken), /Equipment Staging/);
    assert.equal(doctor.frame.knowledge_query.entity.id, "dr-kirk-maxwell");
    assert.match(say(maxwell.spoken), /Standard-side authority|assignment briefing/);
    assert.deepEqual(job.owners, [state.ids[1]]);
    assert.match(say(job.spoken), /field technician.*startup materials/);
    assert.match(say(materials.spoken), /Outpost A/);
    assert.match(say(materials.spoken), /nobody's told me/);
    assert.match(say(camera.spoken), /You've got the 35mm field camera/);
    assert.match(say(howKnow.spoken), /briefing/);
    assert.deepEqual(reported.owners, [state.ids[0]]);
    assert.match(say(reported.spoken), new RegExp(`${n[1]} said`));
    assert.doesNotMatch(say(claim.spoken), /aquarium/i);
    assert.match(say(recall.spoken), /aquarium/);
    assert.deepEqual(correction.owners, [state.ids[2]]);
    assert.equal(correction.fn, "ask_reported_speech");
  } finally { cleanup(state); }
});

// ═══ Amendment regressions: classes found while recovering the initial ed29 failures ═══════════════

// Provenance integrity: six sources for ONE actor never collapse into a generic "knows" bit.
test("provenance — baseline, briefing, heard, observed, remembered and current canonical state stay distinct for one actor", async () => {
  const state = setup("ed29-prov", garbage(), { before: (run) => { run.spatial.personnel_locations[run.expedition.team.members[1].personnel_id] = "equipment-staging"; } });
  try {
    const [c1, c2] = state.ids;
    // c1 missed the briefing; brought back to the table afterwards.
    state.run.spatial.personnel_locations[c1] = state.run.spatial.player_location;
    const modes = () => new Set(K.knowledgeFor(state.run, c1).map((f) => f.epistemic_mode));
    assert.ok(modes().has("baseline_induction") && !modes().has("briefing"), "baseline only: c1 did not hear Maxwell");
    await turn(state, `${state.names[1]}, what are we doing today?`);
    const heard = K.knowledgeFor(state.run, c1).filter((f) => f.epistemic_mode === "heard");
    assert.ok(heard.some((f) => f.reported_origin === "Maxwell" && /^Maxwell said/.test(f.reported)), "a relayed briefing stays a report of a report");
    assert.equal(K.reportedSpeech(state.run, { actor_id: c1, speaker_id: "dr-kirk-maxwell" }).claims.length, 0, "c1 never heard Maxwell himself");
    const camera = state.run.expedition.equipment["recording-device"];
    ledger.recordCustodyObserved(state.run, { equipment_id: camera.id, holder_id: camera.holder, observers: [c1] });
    assert.ok(modes().has("observed"));
    camera.holder = c2;
    assert.ok(K.knowledgeFor(state.run, c1).some((f) => f.key === "remembered_custody" && f.epistemic_mode === "remembered"), "superseded observation is only remembered");
    // Current canonical state is separate from all of the above (the observer authority decides it).
    assert.equal(camera.holder, c2);
  } finally { cleanup(state); }
});

test("chains + own speech — 'Daisy said Maxwell said X'; asking someone what THEY said is their own speech, never 'heard myself'", async () => {
  const state = setup("ed29-chain", garbage());
  try {
    const [c1, c2] = state.ids;
    const [n1, n2] = state.names;
    await turn(state, `${n2}, what are the startup materials for?`);
    const own = K.reportedSpeech(state.run, { actor_id: c2, speaker_id: c2 });
    assert.equal(own.own_speech, true);
    assert.ok(own.claims.length && own.claims.every((c) => c.epistemic_mode === "own_speech"));
    assert.ok(!K.heardPropositions(state.run, c2).some((p) => p.speaker_id === c2), "nobody hears themselves");
    const asked = await turn(state, `${n2}, what did you say about the materials?`);
    assert.deepEqual(asked.owners, [c2]);
    assert.doesNotMatch(say(asked.spoken), new RegExp(`heard (?:myself|${n2})|${n2} said`, "i"));
    void c1; void n1;
  } finally { cleanup(state); }
});

test("claims + repetition — a false claim repeated never becomes truth or 'Maxwell said'; frequency is counted, not promoted", async () => {
  const state = setup("ed29-repeat", garbage());
  try {
    await turn(state, "Maxwell said the Complex is a giant aquarium.");
    await turn(state, "Seriously, Maxwell definitely said the Complex is a giant aquarium.");
    await turn(state, "Maxwell said the Complex is a giant aquarium.");
    for (const id of state.ids) {
      assert.ok(!K.knowledgeFor(state.run, id).some((f) => /aquarium/i.test(f.statement)), "never a grant");
      assert.ok(!K.reportedSpeech(state.run, { actor_id: id, speaker_id: "dr-kirk-maxwell" }).claims.some((c) => /aquarium/i.test(c.reported ?? "")), "never 'Maxwell said'");
      const mine = K.reportedSpeech(state.run, { actor_id: id, speaker_id: state.playerId });
      assert.ok(mine.claims.some((c) => c.times === 2 && c.epistemic_mode === "player_claim"), "remembered as the player's repeated claim");
    }
    const told = await turn(state, "What did Maxwell tell us?");
    assert.doesNotMatch(say(told.spoken), /aquarium/i);
    const complex = await turn(state, "What is the Complex?");
    assert.doesNotMatch(say(complex.spoken), /aquarium/i);
  } finally { cleanup(state); }
});

test("facets — destination, contents, who delivers, origin, mechanism, history: the asked facet, or a partial answer that says what is unknown", async () => {
  const state = setup("ed29-facets", garbage());
  try {
    await turn(state, "What are the startup materials for?");
    const where = await turn(state, "Where do they go?");
    assert.equal(where.frame.knowledge_query.facet, "destination");
    assert.ok(!fact(where.plan(), "knowledge_gap"), "destination is known");
    assert.match(say(where.spoken), /Outpost A/);
    const inside = await turn(state, "What's inside them?");
    assert.equal(fact(inside.plan(), "knowledge_gap").missing, "contents");
    const who = await turn(state, "Who is delivering them?");
    assert.equal(who.frame.knowledge_query.facet, "custody");
    assert.ok(!fact(who.plan(), "knowledge_gap"));
    for (const [text, missing] of [["Why does the Complex exist?", "origin"], ["Who built the Threshold?", "origin"], ["What powers the Threshold?", "mechanism"], ["What's the history of ASYNC?", "history"]]) {
      const r = await turn(state, text);
      assert.equal(fact(r.plan(), "knowledge_gap")?.missing, missing, text);
      assert.match(say(r.spoken), /nobody's told me|don't know/i, text);
      assert.doesNotMatch(say(r.spoken), /\b(?:built by|powered by|created by|founded)\b/i, `${text}: no invented lore`);
    }
    // A verb question with a determiner is not a bare-noun follow-up ("What recording?").
    assert.notEqual(D.buildSemanticFrame({ text: "What powers the Threshold?", entities: K.entityIndex(state.run), discourse: { last_turn: { responses: [{ speaker_id: "x", facts: { required: [{ key: "known_concept", value: { statements: ["The Threshold is the fixed crossing."] } }] } }] } } }).discourse_function, "ask_meaning");
    // A plural pronoun after a topic change does not attach to a singular topic.
    await turn(state, "What is the Threshold?");
    assert.equal((await turn(state, "What's inside them?")).plan().may_ask_clarifying_question, true);
    // "How do you know that?" after a partial answer names the source of the KNOWN part and keeps the gap.
    await turn(state, "What are the startup materials for?");
    const how = await turn(state, "How do you know that?");
    const basis = fact(how.plan(), "explanation_basis");
    assert.equal(basis.kind, "known_information");
    assert.equal(basis.partial, true);
    assert.ok(basis.provenance.includes("briefing"));
    assert.match(say(how.spoken), /briefing/);
  } finally { cleanup(state); }
});

test("presence + state — 'Is Maxwell here?' / 'Was he just here?' / 'Are we on Standard?' / 'Where is local?' are not definitions", async () => {
  const state = setup("ed29-presence", garbage());
  try {
    const now = await turn(state, "Is Maxwell here?");
    assert.equal(now.frame.semantic_intent, "person_presence");
    assert.equal(now.frame.knowledge_query.facet, "current_presence");
    assert.match(say(now.spoken), /not here/);
    const recent = await turn(state, "Was Maxwell just here?");
    assert.equal(recent.frame.knowledge_query.facet, "recent_presence");
    assert.match(say(recent.spoken), /left/);
    const self = await turn(state, `Is ${state.names[0]} here?`);
    assert.match(say(self.spoken), /right here/);
    const side = await turn(state, "Are we on Standard?");
    assert.equal(side.frame.semantic_intent, "entity_state");
    assert.ok(fact(side.plan(), "known_concept").provenance.every((p) => p === "observed"), "where we stand is observed, not defined");
    assert.equal(D.buildSemanticFrame({ text: "What does LOCAL mean?", entities: K.entityIndex(state.run) }).knowledge_query.concept, "entity_definition");
    assert.notEqual(D.buildSemanticFrame({ text: "Where is local?", entities: K.entityIndex(state.run) }).knowledge_query?.concept, "entity_definition", "a comms term is not a place");
  } finally { cleanup(state); }
});

test("activation — 'call me Kirk' only after the intro beat is heard; identity is not familiarity", () => {
  const state = setup("ed29-kirk", null, { brief: false });
  try {
    const actor = state.ids[0];
    const keys = () => K.knowledgeFor(state.run, actor).map((f) => f.key);
    assert.ok(keys().includes("maxwell_identity") && !keys().includes("maxwell_address_form"), "knows the name, not the permission");
    state.service.submitAction({ world_id: state.worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    assert.ok(keys().includes("maxwell_address_form"), "the intro beat was delivered");
    assert.ok(!keys().includes("mission_statement") && !keys().includes("dismissal_instruction"), "later beats are not granted early");
  } finally { cleanup(state); }
});

test("procedure history — after staging, 'what did Maxwell tell us to do' is still answerable; 'what's next' is not Equipment Staging", () => {
  const state = setup("ed29-proc-hist");
  try {
    const actor = state.ids[0];
    state.run.expedition.day1_opener.esd_handoff = { status: "equipment-cooperation" };
    const told = K.reportedSpeech(state.run, { actor_id: actor, speaker_id: "dr-kirk-maxwell", concept: "current_procedure" });
    assert.match(told.claims.map((c) => c.reported).join(" "), /report to Equipment Staging/);
    assert.ok(!K.queryKnowledge(state.run, { actor_id: actor, concept: "current_procedure" }).facts.some((f) => f.next_step === "report to Equipment Staging"));
  } finally { cleanup(state); }
});

test("supports — hearing what one already knows adds a provenance support, not a second truth record", async () => {
  const state = setup("ed29-supports", garbage());
  try {
    const [c1] = state.ids;
    await turn(state, `${state.names[1]}, what are the startup materials for?`);
    const grants = K.knowledgeFor(state.run, c1);
    const destination = grants.filter((f) => /startup_material_destination$/.test(f.key));
    assert.equal(destination.length, 1, "one record");
    assert.ok(destination[0].supports?.some((x) => x.epistemic_mode === "heard" && x.speaker_id === state.ids[1]), "the teammate's line is an extra support");
    const keys = grants.map((f) => `${f.key}|${f.speaker_id ?? ""}|${f.reported ?? ""}`);
    assert.equal(new Set(keys).size, keys.length, "no duplicate grants");
  } finally { cleanup(state); }
});

test("fairness — knowledge beats rotation; the owner sequence is identical after a cold reload", async () => {
  const state = setup("ed29-fair-reload", garbage(), { before: (run) => { run.spatial.personnel_locations[run.expedition.team.members[2].personnel_id] = "equipment-staging"; } });
  try {
    const missed = state.ids[1];
    state.run.spatial.personnel_locations[missed] = state.run.spatial.player_location;
    // The one who missed the briefing never speaks for what only the briefing said, however often it rotates.
    for (const text of ["Where do we go next?", "Where are we headed next?", "What's next?", "Where do we go now?"]) assert.ok(!(await turn(state, text)).owners.includes(missed), text);
    // Shared baseline facts: everyone knows them, so they rotate.
    await turn(state, "What is the Threshold?", { request_id: "fr-1" });
    // Cold reload at this point; then the SAME questions in the live and in the reloaded service.
    const reloaded = reload(state);
    try {
      const rest = ["What's LOCAL?", "What is the Complex?", "What does ASYNC do?", "What is Standard?"];
      const live = [];
      for (const [i, text] of rest.entries()) live.push((await turn(state, text, { request_id: `fr-next-${i}` })).owners.join());
      const again = [];
      for (const [i, text] of rest.entries()) {
        await reloaded.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: `fr-next-${i}` });
        again.push(reloaded.service.session(state.worldId, "field-researcher").run.expedition.communication_receipts.find((r) => r.id === `fr-next-${i}`).response_contexts.map((c) => c.target_worker_id).join());
      }
      assert.deepEqual(again, live, "reload does not reset the spokesperson sequence");
      assert.ok(new Set(live).size >= 2, `rotation among knowers: ${live}`);
    } finally { cleanup(reloaded); }
  } finally { cleanup(state); }
});

test("anchors across providers and reload — the antecedent comes from the committed plan, not the model's words", async () => {
  const fancy = scriptedLocal((body) => {
    const system = body.messages.find((m) => m.role === "system").content;
    if (/classify the LANGUAGE/.test(system)) return { raw: "{bad" };
    return "Mostly I keep track of what we see and say out there.";
  });
  const state = setup("ed29-anchor-swap", fancy);
  try {
    const recall = state.names[0];
    await turn(state, `${recall}, what's your job?`);
    // Swap to the deterministic path for the follow-up.
    state.service.localDialogueProvider = null;
    const follow = await turn(state, "What recording?");
    assert.deepEqual(follow.owners, [state.ids[0]]);
    assert.equal(fact(follow.plan(), "utterance_meaning").meaning.key, "current_assignment");
    // Cold reload, then a non-exact follow-up: the same authorized fact, no model re-run.
    await turn(state, `${recall}, what's your job?`);
    const reloaded = reload(state);
    try {
      await reloaded.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text: "What record?", request_id: "an-reload" });
      const run = reloaded.service.session(state.worldId, "field-researcher").run;
      const plan = run.expedition.communication_receipts.find((r) => r.id === "an-reload").response_contexts[0];
      assert.equal(plan.target_worker_id, state.ids[0]);
      assert.equal(plan.response_plan.required_facts.find((f) => f.key === "utterance_meaning").value.meaning.key, "current_assignment");
    } finally { cleanup(reloaded); }
  } finally { cleanup(state); }
});

test("advisory safety — an accepted reading is the interpretation of the player's line, never knowledge; duplicate names fail closed", async () => {
  const provider = scriptedLocal((body) => {
    const system = body.messages.find((m) => m.role === "system").content;
    if (/classify the LANGUAGE/.test(system)) return { raw: JSON.stringify({ intent: "person_role", referent_text: "Maxwell", confidence: 0.9 }) };
    return "Hm.";
  });
  const state = setup("ed29-adv-safe", provider);
  try {
    const before = JSON.stringify(state.ids.map((id) => K.knowledgeFor(state.run, id).filter((f) => f.entity_id === "dr-kirk-maxwell").map((f) => f.key)));
    const r = await turn(state, "like, what's Maxwell's whole thing anyway?");
    assert.equal(r.frame.interpretation_source, "advisory");
    assert.equal(r.frame.semantic_intent, "person_role", "the reading typed the LANGUAGE; code resolved Maxwell");
    assert.equal(r.interaction.interpretation.advice.referent_text, "Maxwell");
    const after = JSON.stringify(state.ids.map((id) => K.knowledgeFor(state.run, id).filter((f) => f.entity_id === "dr-kirk-maxwell" && f.epistemic_mode !== "heard").map((f) => f.key)));
    assert.equal(after, before, "the advisory reading created no knowledge about Maxwell");
    assert.ok(!JSON.stringify(state.ids.map((id) => K.knowledgeFor(state.run, id))).includes("advice"), "no grant cites an advisory reading");
    // Code, not the model, decides what a resolved entity can be asked (real-model regression).
    const entities = K.entityIndex(state.run);
    // A deictic span ("this place") is not a name: the one entity the line actually names decides.
    assert.equal(D.applyAdvice({ accepted: true, intent: "entity_definition", referent_text: "this place", confidence: 0.9 }, { entities, raw: "what even is this place we're going into, the backrooms thing?" }).query.entity.id, "complex");
    assert.equal(D.applyAdvice({ accepted: true, intent: "person_relation", referent_text: "Outpost A", confidence: 0.9 }, { entities, raw: "you know much about Outpost A?" }).query.concept, "entity_definition");
    assert.equal(D.applyAdvice({ accepted: true, intent: "assignment_purpose", referent_text: "Kirk", confidence: 0.9 }, { entities, raw: "what's Kirk's whole thing anyway?" }).query.concept, "person_role");
    // Duplicate canonical names: the advisory span cannot pick one (fail closed; no address is made).
    const twin = state.run.expedition.team.members[2];
    const original = twin.first_name;
    twin.first_name = state.names[0];
    const dup = scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages.find((m) => m.role === "system").content) ? { raw: JSON.stringify({ intent: "role_or_assignment", referent_text: null, confidence: 0.9, addressee_text_span: state.names[0] }) } : "Hm."));
    state.service.localDialogueProvider = dup;
    const ambiguous = await turn(state, `so what's the deal with your work ${state.names[0]}`);
    assert.notEqual(ambiguous.interaction?.address?.form, "advisory_span", "two people share the name: not an address");
    twin.first_name = original;
  } finally { cleanup(state); }
});

test("trace — empty knowledge results keep their internal class", async () => {
  const state = setup("ed29-classes", garbage());
  try {
    assert.equal(q(state, state.ids[0], "entity_definition", "threshold", { facet: "mechanism" }).unknown_detail, "facet_unknown");
    assert.equal(K.queryKnowledge(state.run, { actor_id: state.ids[0], concept: "person_identity", entity: { id: null, kind: "person", label: "Bob", unknown: true } }).status, "unknown_entity");
    const world = K.entityIndex(state.run).find((e) => e.world_only && e.kind === "person");
    if (world) assert.equal(K.queryKnowledge(state.run, { actor_id: state.ids[0], concept: "person_identity", entity: world }).unknown_detail, "not_granted_to_actor");
    assert.equal(q(state, state.ids[0], "entity_state", "threshold").unknown_detail, "legitimate_unknown");
  } finally { cleanup(state); }
});
