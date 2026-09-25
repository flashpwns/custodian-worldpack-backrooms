"use strict";

// ED-28 — semantic interpretation + canonical knowledge convergence. Paraphrase FAMILIES (not magic
// strings) converge on semantic intents; the Day-1 knowledge grants are source-backed and
// compartmentalized (who was present, what was actually said); knowing is not saying (the contribution is
// a hard output ceiling); unrequested questions are rejected; the bounded advisory interpreter re-types
// only generic readings, is validated, persisted, and fails closed; semantics are provider-independent.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const I = require("../tools/dialogue-interpretation");
const V = require("../tools/dialogue-validation");
const K = require("../tools/canonical-knowledge");
const A = require("../tools/dialogue-advisory-interpreter");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { DesktopService } = require("../desktop/service");

// ─── harness (production service path; the Electron flow delivers every briefing beat) ────────────
function setup(seed, provider = null, { beats = 3, before = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed28-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  const worldId = service.createWorld({ name: "ED28", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Gooby", last_name: "Gooberson" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  const runNow = () => service.session(worldId, "field-researcher").run;
  if (before) before(runNow());
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  for (let beat = 0; beat < beats; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const state = { root, service, worldId, logs: [] };
  service.log = (line) => state.logs.push(String(line));
  Object.defineProperty(state, "run", { get: runNow });
  state.playerId = state.run.session.startup.player.observer_id;
  state.team = state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  state.ids = state.team.map((m) => m.personnel_id ?? m.id);
  state.names = state.team.map((m) => m.first_name);
  return state;
}
const cleanup = (state) => { state.service.shutdown?.(); fs.rmSync(state.root, { recursive: true, force: true }); };
let counter = 0;
async function turn(state, text, extra = {}) {
  const id = extra.request_id ?? `k-${++counter}`;
  state.logs.length = 0;
  await state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: id, ...extra });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const interaction = run.expedition.interaction_history.find((i) => i.submission_id === id) ?? null;
  const traceLine = state.logs.find((line) => line.startsWith("[YB:DISCOURSE_TRACE]"));
  return { id, contexts, interaction, frame: contexts[0]?.semantic_frame ?? null, fn: contexts[0]?.semantic_frame.discourse_function ?? null, owners: contexts.map((c) => c.target_worker_id), plan: (who) => (contexts.find((c) => c.target_worker_id === who) ?? contexts[0])?.response_plan ?? null, spoken: run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId), trace: traceLine ? JSON.parse(traceLine.slice("[YB:DISCOURSE_TRACE] ".length)) : null };
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

// ─── Part 15: paraphrase families converge on semantic intents ───────────────────────────────────
test("paraphrase families — role, next procedure, mission/institution, person, follow-up, definition converge", () => {
  const state = setup("ed28-families");
  try {
    const entities = K.entityIndex(state.run);
    const frame = (text, addressee_ids = []) => D.buildSemanticFrame({ text, entities, addressee_ids });
    const families = {
      ask_role_or_assignment: ["What is your job?", "What do you do?", "What do you do here?", "What is your specific job?", "What are you supposed to be doing?", "What exactly is your role?"],
      ask_next_step: ["What's next?", "What do we do now?", "Where are we supposed to go next?", "Where are we headed next?", "What happens after this?"],
      ask_institution_purpose: ["What do we actually do around here?", "What is this place for?", "What are we doing here?", "What does ASYNC do?"],
      ask_mission_objective: ["What are we doing today?", "What are we going into the Complex to do today?", "What's the mission?"],
      ask_person_identity: ["Who is Kirk?", "Who's Maxwell?", "Who's that Maxwell guy?", "What does Maxwell do?", "Who was the doctor briefing us?"],
      ask_entity_definition: ["What is the Threshold?", "What is Standard?", "What is the Complex?", "Where is Equipment Staging?"]
    };
    for (const [fn, list] of Object.entries(families)) for (const text of list) assert.equal(frame(text).discourse_function, fn, text);
    for (const text of ["Who is Kirk?", "Who's Maxwell?", "What does Maxwell do?", "Who was the doctor briefing us?"]) assert.equal(frame(text).knowledge_query.entity.id, "dr-kirk-maxwell", text);
    assert.equal(frame("What does ASYNC do?").knowledge_query.entity.id, "async");
    // Vocatives, including no-comma: all identify the named coworker; a name merely mentioned does not.
    const names = state.team.flatMap((m) => [m.first_name].map((name) => ({ name, id: m.personnel_id })));
    const b = state.names[1];
    for (const text of [`${b}, tell me about yourself.`, `${b} tell me about yourself`, `Hey ${b}, what do you do?`, `Could you tell me about yourself, ${b}?`]) assert.deepEqual(I.parseAddressees(text, { names }).addressee_ids, [state.ids[1]], text);
    for (const text of [`${b} told me the camera is here.`, `${b} has the camera.`]) assert.equal(I.parseAddressees(text, { names }).address_type, "none", text);
  } finally { cleanup(state); }
});

// ─── Parts 3-6: the source-backed knowledge matrix and compartmentalization ──────────────────────
test("knowledge — every grant is sourced; briefing knowledge goes only to listeners of lines actually delivered", () => {
  const state = setup("ed28-matrix", null, { before: (run) => {
    // The third coworker is not in the briefing room while it is delivered.
    const absent = run.expedition.team.members[3].personnel_id;
    run.spatial.personnel_locations[absent] = "equipment-staging";
  } });
  try {
    const [present, , absent] = state.ids;
    const facts = K.knowledgeFor(state.run, present);
    for (const f of facts) for (const field of ["concept", "proposition", "authority_class", "source_ref", "grant_basis", "epistemic_mode", "valid_scope"]) assert.ok(f[field], `${f.key}.${field}: NO SOURCE -> NO GRANT`);
    const q = (actor, concept, entity = null) => K.queryKnowledge(state.run, { actor_id: actor, concept, entity });
    // A listener: mission, schedule, roster, dismissal, Maxwell.
    assert.equal(q(present, "mission_objective").status, "known");
    assert.equal(q(present, "mission_objective").facts[0].provenance, "briefing");
    assert.equal(q(present, "schedule").status, "known");
    assert.equal(q(present, "current_procedure").status, "known");
    assert.equal(q(present, "person_identity", { id: "dr-kirk-maxwell", kind: "person" }).status, "known");
    // Not in the room: none of it.
    for (const concept of ["mission_objective", "schedule", "current_procedure"]) assert.equal(q(absent, concept).status, "not_established", `${concept} never reaches someone who was not there`);
    assert.equal(q(absent, "person_identity", { id: "dr-kirk-maxwell", kind: "person" }).status, "not_established");
    // Canon that exists but is not granted: a truthful unknown with its reason.
    for (const id of ["threshold", "standard", "complex"]) {
      const result = q(present, "entity_definition", { id, kind: "entity" });
      assert.equal(result.status, "not_established", id);
      assert.equal(result.unknown_reason, K.UNKNOWN_CLASS.CANON_NOT_GRANTED, id);
    }
    assert.equal(q(present, "institution_purpose").status, "known", "'what do we do around here' is answered by what they were told about today");
    assert.equal(q(present, "institution_purpose", { id: "async", kind: "institution" }).status, "not_established", "what ASYNC as a whole does is not established by any delivered source");
    assert.equal(q(present, "entity_definition", { id: "async", kind: "institution" }).unknown_reason, K.UNKNOWN_CLASS.MISSING_STRUCTURE);
    // Unbriefed carry capacity / field light holder are not knowledge.
    const briefed = K.briefedCustody(state.run, present);
    const equipment = state.run.expedition.equipment;
    assert.ok(briefed.has(equipment["startup-materials-duffle"].id) && briefed.has(equipment["recording-device"].id) && briefed.has(equipment["layout-record"].id));
    assert.ok(!briefed.has(equipment["field-light"].id) && !briefed.has(equipment["mass-spectrometer"].id), "custody the roster call never stated is not granted");
    assert.equal(K.briefedCustody(state.run, absent).size, 0);
  } finally { cleanup(state); }
});

test("knowledge — a briefing concluded early grants only what was said; heard self-descriptions are reports", async () => {
  const short = setup("ed28-short", garbage(), { beats: 0 });
  try {
    const actor = short.ids[0];
    assert.equal(K.queryKnowledge(short.run, { actor_id: actor, concept: "mission_objective" }).status, "not_established", "the mission statement was never delivered");
    assert.equal(K.queryKnowledge(short.run, { actor_id: actor, concept: "current_procedure" }).status, "known", "the dismissal was");
    // A coworker hears another's self-description: known BY REPORT (heard), never first-hand.
    const [a, b] = short.names;
    await turn(short, `${a}, tell me about yourself.`);
    const report = K.knowledgeFor(short.run, short.ids[1]).find((f) => f.key === "heard_self_description" && f.entity_id === short.ids[0]);
    assert.ok(report, `${b} heard ${a}`);
    assert.equal(report.epistemic_mode, "heard");
    assert.match(report.proposition, new RegExp(`^${a} said`));
  } finally { cleanup(short); }
});

// ─── Parts 7-9: knowledge queries through the production service; non-present entities; threads ──
test("knowledge answers — owners, provenance, truthful unknowns, non-present entities, anchored follow-ups", async () => {
  const state = setup("ed28-service", garbage());
  try {
    const kirk = await turn(state, "Who is Kirk?");
    assert.equal(kirk.fn, "ask_person_identity");
    assert.deepEqual(fact(kirk.plan(), "known_concept").provenance.sort(), ["briefing", "observed"]);
    assert.equal(kirk.owners.length, 1, "one spokesperson, never a chorus of the same fact");
    const bob = await turn(state, "Who is Bob?");
    assert.equal(fact(bob.plan(), "uncertainty").kind, "unknown_person", "an unknown name stays unknown; nothing is invented");
    const threshold = await turn(state, "What is the Threshold?");
    assert.equal(fact(threshold.plan(), "uncertainty").kind, "not_told");
    assert.match(threshold.spoken[0].text, /told/i);
    const doctor = await turn(state, "Who was that doctor?");
    assert.equal(doctor.plan().may_ask_clarifying_question, true, "two canonical people fit; ask which");
    const next = await turn(state, "Where are we supposed to go next?");
    assert.equal(next.fn, "ask_next_step");
    assert.match(fact(next.plan(), "current_procedure").next_step, /Equipment Staging/);
    const mine = await turn(state, "What's my job?");
    assert.match(fact(mine.plan(), "known_concept").statements[0], /camera/);
    // Part 9: the courier's own line introduced the startup materials; the follow-up stays with them.
    const courier = state.names[1];
    await turn(state, `${courier}, tell me about yourself.`);
    for (const text of ["What exactly are the startup materials for?", "What are those for?", "Why are you delivering them?"]) {
      const follow = await turn(state, text);
      assert.equal(follow.fn, "ask_assignment_purpose", text);
      assert.deepEqual(follow.owners, [state.ids[1]], `${text}: stays with the one whose line introduced it`);
      assert.ok(fact(follow.plan(), "known_concept").statements.some((s) => /Outpost A/.test(s)), text);
      await turn(state, `${courier}, tell me about yourself.`);
    }
  } finally { cleanup(state); }
});

// ─── Part 10: semantic anchors ─────────────────────────────────────────────────────────────────────
test("anchors — a noun from the previous line's AUTHORIZED facts resolves back to that fact; wording alone never anchors", async () => {
  const state = setup("ed28-anchor", garbage());
  try {
    const first = state.names[0];
    await turn(state, `${first}, what's your job?`);
    for (const text of ["What recording?", "What recall?"]) {
      const asked = await turn(state, text);
      assert.equal(asked.fn, "ask_meaning", text);
      assert.deepEqual(asked.owners, [state.ids[0]], text);
      const meaning = fact(asked.plan(), "utterance_meaning");
      assert.equal(meaning.own, true);
      assert.equal(meaning.meaning.key, "current_assignment", `${text} -> the verbal-recall assignment`);
      await turn(state, `${first}, what's your job?`);
    }
    // Terms only a model might have used (not in any authorized fact) anchor nothing.
    const response = { facts: { required: [{ key: "self_state", value: { state: "ordinary", affect: [] } }], optional: [], semantics: null } };
    assert.deepEqual(D.anchorTerms(response), []);
  } finally { cleanup(state); }
});

// ─── Part 11: the authorized contribution is a hard output ceiling ────────────────────────────────
test("contribution ceiling — safe-to-know facts may not leak into a turn that does not authorize them", () => {
  const plan = (fn, required = [], extra = {}) => ({ discourse_function: fn, required_facts: required, optional_facts: [], forbidden_claims: [], may_ask_clarifying_question: false, ...extra });
  const selfState = plan("check_in", [{ key: "self_state", value: { state: "ordinary", affect: [] } }, { key: "self_state_answer", value: { asked: "positive", answer: "not_especially" } }]);
  const leaks = [
    [selfState, "Not especially either. Just compiling the layout record."],
    [selfState, "Just focused on the materials."],
    [plan("greet"), "Morning. Big delivery run to Outpost A today."],
    [plan("ask_item_ownership", [{ key: "item_holder", value: { label: "35mm field camera", holder_name: "you", holder_is_self: false } }]), "You've got the camera. After this we report to Equipment Staging."],
    [plan("ask_role_or_assignment", [{ key: "role", value: "field researcher" }, { key: "current_assignment", value: "handling observation and verbal recall" }]), "I'm a field researcher handling observation and verbal recall; I spotted markings on the survey line."],
    [plan("acknowledge"), "Got it. I've got the spectrometer ready."],
    [plan("ask_explanation", [{ key: "explanation_basis", value: { kind: "self_state", state: "ordinary", affect: [] } }]), "Just how I feel. Also the cutoff is 1:00 PM."]
  ];
  for (const [contribution, speech] of leaks) assert.equal(V.validateContribution(contribution, speech).ok, false, speech);
  // Licensed content passes.
  assert.equal(V.validateContribution(selfState, "Not especially.").ok, true);
  assert.equal(V.validateContribution(plan("ask_item_ownership", [{ key: "item_holder", value: { label: "35mm field camera", holder_name: "you", holder_is_self: false } }]), "You've got the 35mm field camera.").ok, true);
  const claims = V.unlicensedClaims("Not especially either. Just compiling the layout record.", selfState);
  for (const term of ["compiling", "layout", "record"]) assert.ok(claims.includes(term), term);
});

// ─── Part 12: response shape ───────────────────────────────────────────────────────────────────────
test("response shape — a plan without a clarification never produces a question, with or without '?'", () => {
  const statement = { discourse_function: "make_statement", required_facts: [], optional_facts: [], forbidden_claims: [], may_ask_clarifying_question: false };
  const player = "Well, I said Brady, but thats fine. Nice to meet you, Daisy.";
  for (const bad of ["Is there a specific procedure I should follow for this recording?", "Is there a specific procedure I should follow.", "Nice to meet you too. What should I do first?", "Let me know if you need anything."]) assert.equal(V.validateContribution(statement, bad, { player_text: player }).ok, false, bad);
  for (const good of ["Nice to meet you too.", "Ha, right?", "No worries."]) assert.equal(V.validateContribution(statement, good, { player_text: player }).ok, true, good);
  const clarify = { ...statement, discourse_function: "ambiguous_reference", may_ask_clarifying_question: true };
  assert.equal(V.validateContribution(clarify, "Sorry, which thing do you mean?").ok, true, "a clarification plan asks");
});

// ─── Parts 1-2: Tier 2 advisory interpretation ─────────────────────────────────────────────────────
test("advisory — strict validation: allowlisted intents, spans of the player's own words, confidence floor", () => {
  const u = "What's the story with Kirk?";
  assert.equal(A.validateAdvisory({ intent: "person_identity", referent_text: "Kirk", confidence: 0.9 }, u).accepted, true);
  assert.equal(A.validateAdvisory("{bad", u).accepted, false);
  assert.equal(A.validateAdvisory({ intent: "summon_entity", referent_text: null, confidence: 0.9 }, u).reason, "unsupported_intent");
  assert.equal(A.validateAdvisory({ intent: "person_identity", referent_text: "Dr. Kirk Maxwell", confidence: 0.9 }, u).reason, "referent_not_in_utterance", "the model may not name what the player did not say");
  assert.equal(A.validateAdvisory({ intent: "person_identity", referent_text: "Kirk", confidence: 0.3 }, u).reason, "low_confidence");
  assert.equal(A.validateAdvisory({ intent: "person_identity", referent_text: "Kirk", confidence: 0.9, holder: "Nora" }, u).reason, "unsupported_field", "no world-fact fields exist in the schema");
  // An accepted reading re-types ONLY a generic Tier 1 frame; a confident deterministic frame stands.
  const entities = [{ id: "dr-kirk-maxwell", kind: "person", label: "Dr. Kirk Maxwell", names: ["kirk", "maxwell"], non_present: true }];
  const advice = A.validateAdvisory({ intent: "person_identity", referent_text: "Kirk", confidence: 0.9 }, u);
  const typed = D.buildSemanticFrame({ text: u, entities, advice });
  assert.equal(typed.discourse_function, "ask_person_identity");
  assert.equal(typed.interpretation_source, "advisory");
  assert.equal(typed.knowledge_query.entity.id, "dr-kirk-maxwell", "code resolved the entity from the span");
  const confident = D.buildSemanticFrame({ text: "Who has the camera?", entities, advice: { ...advice, intent: "opinion" } });
  assert.equal(confident.interpretation_source, "deterministic");
  // Without an accepted reading, a generic question naming a known entity is clarified, not "I don't know".
  const failClosed = D.buildSemanticFrame({ text: u, entities, advice: null });
  assert.equal(failClosed.discourse_function, "ambiguous_reference");
  assert.equal(failClosed.tier1_generic, true);
});

test("advisory — one call per generic player turn, none for Tier 1 turns; persisted, and reload never re-asks", async () => {
  let advisoryCalls = 0;
  const provider = scriptedLocal((body) => {
    const system = body.messages.find((m) => m.role === "system").content;
    if (/classify the LANGUAGE/.test(system)) { advisoryCalls += 1; return { raw: JSON.stringify({ intent: "person_identity", referent_text: "Kirk", confidence: 0.9 }) }; }
    return "Hm.";
  });
  const state = setup("ed28-advisory", provider);
  try {
    await turn(state, "Who is Kirk?");
    assert.equal(advisoryCalls, 0, "Tier 1 typed it: no model interpretation");
    const story = await turn(state, "What's the story with Kirk?");
    assert.equal(advisoryCalls, 1, "one advisory reading for the player turn, not one per NPC");
    assert.equal(story.frame.interpretation_source, "advisory");
    assert.equal(story.fn, "ask_person_identity");
    assert.equal(story.interaction.interpretation.advice.intent, "person_identity");
    assert.equal(story.trace.pragmatics.advisory_validation, "accepted");
    assert.equal(story.trace.pragmatics.resolved_semantic_concept, "person_identity");
    assert.ok(story.trace.pragmatics.knowledge_results[0].facts.every((f) => /:(?:briefing|observed)$/.test(f)), "trace carries keys + provenance only");
    // Re-framing that turn from persisted history (as after a reload) uses the persisted advice.
    const discourse = D.deriveDiscourseState({ interaction_history: state.run.expedition.interaction_history, dialogue_history: state.run.expedition.dialogue_history, player_id: state.playerId, location_id: state.run.spatial.player_location, current_interval: state.run.expedition.clock.interval, equipment: state.run.expedition.equipment, receipts: state.run.expedition.communication_receipts, entities: K.entityIndex(state.run) });
    assert.equal(discourse.turns.at(-1).discourse_function, "ask_person_identity");
    assert.equal(advisoryCalls, 1);
  } finally { cleanup(state); }
});

// ─── Part 18: provider independence ────────────────────────────────────────────────────────────────
const SEQUENCE = (n) => ["Good morning everyone, excited for your first day?", "What is it that we actually do around here?", `${n[0]}, what is your specific job?`, `${n[1]} tell me a little about yourself`, "What exactly are the startup materials for?", "So who's got the camera today?", "Where are we supposed to go next?", "Who is Kirk?", "What does Maxwell actually do?", "What is the Threshold?", "What is Standard?", "What are we going into the Complex to do today?", `${n[2]}, what's your job?`, "What recording?", "Anyway, what's the plan for today?", "Back to what we were talking about."];
async function digestFor(provider) {
  const state = setup("ed28-indep", provider);
  try {
    for (const [i, text] of SEQUENCE(state.names).entries()) await turn(state, text, { request_id: `i-${i}` });
    const run = state.run;
    const WORDED = new Set(["text", "line", "own_reply"]);
    return crypto.createHash("sha256").update(JSON.stringify({
      interactions: run.expedition.interaction_history.map((i) => [i.recipient_type, i.recipient_ids, i.address ?? null, (i.response_owners ?? []).map((o) => o.speaker_id), i.interpretation?.source ?? null]),
      contexts: run.expedition.communication_receipts.map((r) => (r.response_contexts ?? []).map((c) => [c.target_worker_id, c.semantic_frame, c.response_plan, c.authorized_contribution])),
      custody: Object.fromEntries(Object.entries(run.expedition.equipment).map(([k, v]) => [k, v.holder])),
      knowledge: state.ids.map((id) => K.knowledgeFor(run, id).map((f) => [f.concept, f.key, f.entity_id ?? null, f.epistemic_mode]))
    }, (key, value) => (WORDED.has(key) && typeof value === "string" ? "<spoken>" : value))).digest("hex");
  } finally { cleanup(state); }
}
test("independence — fallback, garbage, throwing and wording providers: identical frames, knowledge, owners, contributions", async () => {
  const wording = scriptedLocal((body) => {
    const user = body.messages.find((m) => m.role === "user").content;
    const said = user.match(/say only this, plainly, in your own words, adding nothing:\n\s+"([^"]+)"/);
    if (said) return said[1];
    return "Hm.";
  });
  const reference = await digestFor(null);
  for (const [name, provider] of [["garbage", garbage()], ["throwing", throwing()], ["wording", wording]]) assert.equal(await digestFor(provider), reference, name);
});
