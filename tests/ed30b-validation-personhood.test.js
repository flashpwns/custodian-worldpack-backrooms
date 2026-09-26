"use strict";

// ED-30 B — Validation (H1-H6) and personhood (E1-E8): the private-state adversarial matrix (J7), the
// answer-satisfaction matrix over the registry's neighbours (J8, with the false-reject rate), the fallback
// generator satisfying its own contracts (H6), and canonical personal profiles (J12).

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const H = require("./fixtures/ed30/harness");
const V = require("../tools/dialogue-validation");
const C = require("../tools/dialogue-claims");
const R = require("../tools/dialogue-registry");
const F = require("../tools/dialogue-fallback");
const P = require("../tools/dialogue-personhood");
const RS = require("../tools/dialogue-resolvers");
const L = require("../tools/canonical-world-ledger");

const PEOPLE = [{ id: "g", name: "Giselle" }, { id: "m", name: "Malcolm" }, { id: "t", name: "Tonya" }];
const predicatePlan = (predicate, value, statements, extra = {}) => ({ discourse_function: "ask_predicate", predicate, answer_contract: R.get(predicate)?.answer_contract ?? null, required_facts: [{ key: "predicate_answer", value: { predicate, value, answer: { predicate, polarity: ["yes", "no"].includes(value) ? value : null, ...(extra.answer ?? {}) }, statements, provenance: extra.provenance ?? ["self"], question_form: extra.question_form ?? "yes_no" } }], optional_facts: [], forbidden_claims: ["new_factual_claims", "third_party_private_state"], may_ask_clarifying_question: false });
const asMalcolm = { people: PEOPLE, speaker_id: "m", speaker_name: "Malcolm" };

// ─── J7: private-state adversarial matrix (the validator itself, no model) ───────────────────────────
const PERSONAL_CASES = [
  { family: "wellbeing", self: "I'm doing fine.", other: ["Tonya's fine too.", "Tonya is doing alright.", "Giselle's doing well."], report: "Tonya said she was doing all right.", presentTense: "Tonya is doing all right right now." },
  { family: "nervousness", self: "A little nervous, honestly.", other: ["Giselle isn't nervous.", "Tonya seems nervous.", "She's scared, I think."], report: "Tonya said she was a little nervous.", presentTense: "Tonya is nervous." },
  { family: "anticipation", self: "Not especially excited.", other: ["Tonya seems excited.", "Giselle is looking forward to it."], report: "Tonya said she wasn't especially excited.", presentTense: "Tonya is excited." },
  { family: "fatigue", self: "Not tired, no.", other: ["Tonya's tired.", "Giselle looks exhausted."], report: "Tonya said she wasn't tired.", presentTense: "Tonya is tired." },
  { family: "first_day", self: "It's my first day.", other: ["Tonya's new, like me.", "She's new here.", "It's Giselle's first day too."], report: "Tonya said it wasn't her first day.", presentTense: "Tonya is new here." },
  { family: "complex_experience", self: "I've never been in the Complex.", other: ["Tonya has been in before.", "Giselle's never been inside."], report: "Tonya said she'd been in the Complex before.", presentTense: "Tonya has been in the Complex before." },
  { family: "expedition_experience", self: "This is my first expedition.", other: ["Tonya has done this before.", "Giselle's done one of these."], report: "Tonya said she'd been on expeditions before.", presentTense: "Tonya has done this before." },
  { family: "familiarity", self: "We only met today.", other: ["Tonya knows him.", "Giselle and Tonya worked together."], report: null, presentTense: null },
  { family: "intent", self: null, other: ["Tonya wants to go.", "Giselle hopes to see the outpost."], report: null, presentTense: null },
  { family: "memory", self: null, other: ["Tonya remembers the last expedition."], report: null, presentTense: null }
];
test("J7 private-state matrix — SELF may answer; OTHER cannot invent; OTHER may report only as an attributed report", () => {
  const selfState = { discourse_function: "check_in", required_facts: [{ key: "self_state", value: { state: "affected", affect: ["a little nervous"] } }], optional_facts: [] };
  const license = { first_day: predicatePlan("person.first_day_at_async", "yes", ["It's my first day."]), complex_experience: predicatePlan("person.complex_experience", "no", ["I've never been in the Complex."]), expedition_experience: predicatePlan("person.expedition_experience", "no", ["This is my first expedition."]), familiarity: predicatePlan("person.familiarity", "no", ["We only met today."]) };
  let otherRejected = 0;
  let otherTotal = 0;
  for (const c of PERSONAL_CASES) {
    const plan = license[c.family] ?? selfState;
    if (c.self) assert.equal(C.validatePersonalClaims(c.self, plan, asMalcolm).ok, true, `SELF: ${c.self}`);
    for (const line of c.other) {
      otherTotal += 1;
      const verdict = C.validatePersonalClaims(line, plan, asMalcolm);
      assert.equal(verdict.ok, false, `OTHER must not invent: ${line}`);
      assert.equal(verdict.code, C.CODES.PRIVATE, line);
      otherRejected += 1;
    }
    if (c.report) {
      // Licensed only by a plan that carries the report (heard, attributed, past tense).
      const reportPlan = predicatePlan(`person.${c.family === "first_day" ? "first_day_at_async" : c.family === "wellbeing" ? "wellbeing" : c.family}`.replace("person.nervousness", "person.nervousness"), "value", [c.report], { answer: { reported: true, speaker_id: "t" }, provenance: ["heard"] });
      assert.equal(C.validatePersonalClaims(c.report, reportPlan, asMalcolm).ok, true, `REPORT allowed: ${c.report}`);
      assert.equal(C.validatePersonalClaims(c.report, plan, asMalcolm).ok, false, `REPORT without a licence is still a leak: ${c.report}`);
      assert.equal(C.validatePersonalClaims(c.presentTense, reportPlan, asMalcolm).ok, false, `a report never becomes a present-tense fact: ${c.presentTense}`);
    }
  }
  assert.equal(otherRejected, otherTotal, "0 accepted third-party private-state claims");
  // Echoes are claims about oneself: only true when the speaker's own value matches.
  const noFirstDay = predicatePlan("person.first_day_at_async", "no", ["It's not my first day."]);
  assert.equal(C.validatePersonalClaims("Same here.", noFirstDay, { ...asMalcolm, prior: ["It's my first day."] }).ok, false);
  assert.equal(C.validatePersonalClaims("Same here.", predicatePlan("person.first_day_at_async", "yes", ["It's my first day."]), { ...asMalcolm, prior: ["It's my first day."] }).ok, true);
  // Group claims speak for others.
  assert.equal(C.validatePersonalClaims("We're all fine.", selfState, asMalcolm).ok, false);
  // No self-reference by one's own name.
  assert.equal(C.validatePersonalClaims("Malcolm's doing fine.", selfState, asMalcolm).ok, false);
});

test("E8/H2 no manufactured precision — counts and exact tenure beyond the band are rejected", () => {
  const complexSome = predicatePlan("person.complex_experience", "yes", ["I've been in the Complex before."], { answer: { band: "some" } });
  assert.equal(V.validateContribution(complexSome, "Yes, I've been in before.").ok, true);
  for (const line of ["Yes, a few times.", "Yeah, six times now.", "Twice, actually.", "I've done three expeditions."]) assert.equal(V.validateContribution(complexSome, line).ok, false, line);
  const tenureWeeks = predicatePlan("person.async_tenure", "value", ["I've been with ASYNC a few weeks."], { answer: { band: "weeks" }, question_form: "wh" });
  assert.equal(V.validateContribution(tenureWeeks, "A few weeks now.").ok, true);
  for (const line of ["Six weeks now.", "Since March.", "About two months."]) assert.equal(V.validateContribution(tenureWeeks, line).ok, false, line);
});

// ─── J8: answer-satisfaction matrix ────────────────────────────────────────────────────────────────────
// For each predicate answered by the resolver path: a plan, correct answers in varied wording, and a typical
// grounded line. For every registered neighbour, the neighbour's typical line is fed as the answer.
const TYPICAL = Object.freeze({
  "person.first_day_at_async": "It's my first day.",
  "person.async_tenure": "I've been with ASYNC a few weeks.",
  "person.expedition_experience": "This is my first expedition.",
  "person.complex_experience": "I've never been in the Complex.",
  "person.familiarity": "We only met today.",
  "person.self_description": "I'm Giselle, a field researcher.",
  "person.role": "I'm a field researcher.",
  "person.identity": "That's Dr. Kirk Maxwell.",
  "person.authority": "He's the Standard-side authority for our briefing.",
  "person.presence": "He's not here now.",
  "person.wellbeing": "Doing all right.",
  "person.anticipation": "Not especially.",
  "person.nervousness": "Not really.",
  "person.current_activity": "Nothing in particular right now.",
  "person.current_assignment": "I'm compiling the layout record.",
  "person.opinion": "No real opinion yet.",
  "mission.objective": "Delivery and introductory reconnaissance.",
  "mission.destination": "The startup materials are going to Outpost A.",
  "mission.schedule": "Departure is at 10:00 AM.",
  "mission.route": "We follow the green guidance tape.",
  "mission.participants": "All of us are going.",
  "procedure.next_incomplete_step": "Next we get our gear sorted.",
  "procedure.instruction_history": "Maxwell told us to get acquainted first.",
  "transition.participants": "All of us are going together.",
  "item.destination": "The duffle's for Outpost A.",
  "item.purpose": "It's for photographic documentation.",
  "item.holder": "Malcolm has it.",
  "place.definition": "The Complex is the environment our expedition operates in.",
  "place.status": "I don't know if it's on.",
  "place.access": "We're assigned to an expedition into the Complex.",
  "institution.purpose": "ASYNC organizes research and expedition operations."
});
const MATRIX = [
  { predicate: "person.first_day_at_async", plan: predicatePlan("person.first_day_at_async", "no", ["It's not my first day; I've been with ASYNC a few weeks."], { answer: { band: "weeks" } }), correct: ["No, I've been with ASYNC a few weeks.", "Nope, not my first day.", "No.", "It's not, no. A few weeks now."] },
  { predicate: "person.async_tenure", plan: predicatePlan("person.async_tenure", "value", ["I've been with ASYNC a few weeks."], { answer: { band: "weeks" }, question_form: "wh" }), correct: ["A few weeks.", "I've been here a few weeks.", "Couple of weeks now, I'd say, give or take a few weeks."] },
  { predicate: "person.expedition_experience", plan: predicatePlan("person.expedition_experience", "no", ["This is my first expedition."]), correct: ["No, this is my first one.", "Nope, first expedition.", "No, never."] },
  { predicate: "person.complex_experience", plan: predicatePlan("person.complex_experience", "no", ["I've never been in the Complex."]), correct: ["No, never.", "Nope, first time.", "I've never been in the Complex.", "No, I haven't."] },
  { predicate: "person.familiarity", plan: predicatePlan("person.familiarity", "no", ["We only met today."]), correct: ["No, we only met today.", "Nope, we just met."] },
  { predicate: "mission.destination", plan: predicatePlan("mission.destination", "value", ["Maxwell said the startup materials are going to Outpost A; that's the delivery.", "Right after this we report to Equipment Staging."], { provenance: ["briefing"], question_form: "wh" }), correct: ["Outpost A, as far as I know.", "First Equipment Staging, then the materials go to Outpost A."] },
  { predicate: "mission.schedule", plan: predicatePlan("mission.schedule", "value", ["Departure is at 10:00 AM, we're expected back by 12:00 noon, and the cutoff is 1:00 PM."], { provenance: ["briefing"], question_form: "wh" }), correct: ["We leave at 10:00.", "Departure's at 10, back by noon."] },
  { predicate: "mission.route", plan: predicatePlan("mission.route", "partial", ["You follow the neon-green guidance tape.", "Nobody's told me the exact route beyond that."], { provenance: ["baseline_field_procedure"], question_form: "wh" }), correct: ["We follow the green tape; nobody's said more than that."] },
  { predicate: "transition.participants", plan: predicatePlan("transition.participants", "yes", ["Maxwell told all of us to report to Equipment Staging."], { provenance: ["briefing"] }), correct: ["Yes, all of us.", "Yeah, we're all going together.", "As far as I know, everyone's going."] },
  { predicate: "place.access", plan: predicatePlan("place.access", "yes", ["We're assigned to an expedition into the Complex."], { provenance: ["baseline_induction"] }), correct: ["Yes, we're going in.", "Yeah, we're assigned to go in."] }
];
test("J8 answer-satisfaction matrix — grounded answers to a NEIGHBOURING facet are NONRESPONSIVE; correct wordings pass", () => {
  let neighbourPairs = 0;
  let accepted = 0;
  let correctTotal = 0;
  let falseRejects = 0;
  const failures = [];
  for (const row of MATRIX) {
    const entry = R.get(row.predicate);
    for (const neighbour of entry.neighbors) {
      const line = TYPICAL[neighbour];
      if (!line) continue;
      neighbourPairs += 1;
      const verdict = V.validateContribution(row.plan, line);
      if (verdict.ok) { accepted += 1; failures.push(`${row.predicate} <- ${neighbour}: "${line}"`); }
    }
    for (const line of row.correct) {
      correctTotal += 1;
      if (!V.validateContribution(row.plan, line).ok) { falseRejects += 1; failures.push(`FALSE REJECT ${row.predicate}: "${line}" (${V.validateContribution(row.plan, line).reason})`); }
    }
  }
  assert.ok(neighbourPairs >= 20, `matrix covers ${neighbourPairs} neighbour pairs`);
  assert.equal(accepted, 0, `nonresponsive answers accepted:\n${failures.join("\n")}`);
  const falseRejectRate = falseRejects / correctTotal;
  assert.ok(falseRejectRate <= 0.1, `false-reject rate ${(falseRejectRate * 100).toFixed(1)}%:\n${failures.join("\n")}`);
  console.log(`[ED30-J8] neighbour_pairs=${neighbourPairs} nonresponsive_accepted=${accepted} correct=${correctTotal} false_rejects=${falseRejects} false_reject_rate=${(falseRejectRate * 100).toFixed(1)}%`);
});

// ─── H6: the fallback generator satisfies its own contracts across the registry ───────────────────────
test("H6 fallback — every resolver-path predicate x value is worded by the fallback so that it passes its own contract", () => {
  const values = { yes: ["It's my first day."], no: ["It's not my first day."], value: ["Departure is at 10:00 AM."], partial: ["You follow the green guidance tape.", "Nobody's told me the exact route beyond that."], unknown: [], not_established: [] };
  const statementsFor = { "person.first_day_at_async": { yes: ["It's my first day."], no: ["It's not my first day; I've been with ASYNC a few months."] }, "person.async_tenure": { value: ["I've been with ASYNC a few months."] }, "person.expedition_experience": { yes: ["I've been on expeditions before."], no: ["This is my first expedition."] }, "person.complex_experience": { yes: ["I've been in the Complex before."], no: ["I've never been in the Complex."] }, "person.familiarity": { yes: ["We know each other."], no: ["We only met today."] }, "mission.destination": { value: ["Maxwell said the startup materials are going to Outpost A; that's the delivery."] }, "mission.schedule": { value: ["Departure is at 10:00 AM."] }, "mission.route": { partial: values.partial }, "transition.participants": { yes: ["Maxwell told all of us to report to Equipment Staging."] }, "mission.participants": { yes: ["Maxwell gave every one of us a job on this expedition, so as far as I know we're all going."] }, "place.access": { yes: ["We're assigned to an expedition into the Complex."] }, "person.intent": {} };
  let checked = 0;
  for (const entry of R.all().filter((e) => e.route.fn === "ask_predicate")) {
    const table = statementsFor[entry.id] ?? {};
    for (const value of [...Object.keys(table), "unknown", "not_established"]) {
      const band = /tenure/.test(entry.id) ? "months" : /first_day/.test(entry.id) ? (value === "yes" ? "first_day" : "months") : null;
      const plan = predicatePlan(entry.id, value, table[value] ?? [], { answer: band ? { band } : {}, provenance: value === "unknown" || value === "not_established" ? [] : ["self"] });
      const line = F.presentFallback({ frame: { discourse_function: "ask_predicate", predicate: entry.id }, plan });
      const verdict = V.validateContribution(plan, line);
      assert.equal(verdict.ok, true, `${entry.id}/${value}: "${line}" -> ${verdict.reason}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 20);
});

test("E7 three kinds of don't-know are worded differently (ignorance / not established / someone else's)", () => {
  const w = (value, answer = {}) => F.presentFallback({ frame: { discourse_function: "ask_predicate" }, plan: predicatePlan("mission.schedule", value, [], { answer }) });
  const ignorance = w("unknown");
  const notEstablished = w("not_established");
  const theirs = w("unknown", { third_party: true });
  assert.equal(new Set([ignorance, notEstablished, theirs]).size, 3);
  assert.match(notEstablished, /nobody|hasn't come up/i);
  assert.match(theirs, /ask them/i);
});

// ─── J12: personhood ──────────────────────────────────────────────────────────────────────────────────
test("J12 personhood — deterministic, archetype-constrained, internally consistent across seeds (property)", () => {
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 24 }), fc.constantFrom("first-day-observer", "intern-courier", "doctor-veteran", null), (seed, archetype) => {
    const a = P.generateProfile({ seed, actor_id: "x", archetype });
    const b = P.generateProfile({ seed, actor_id: "x", archetype });
    assert.deepEqual(a, b, "deterministic");
    assert.equal(a.first_day_at_async, a.async_tenure === "first_day");
    if (a.first_day_at_async) { assert.equal(a.expedition_experience, "none"); assert.equal(a.complex_experience, "none"); }
    if (a.complex_experience !== "none") assert.notEqual(a.expedition_experience, "none");
    if (archetype === "first-day-observer") { assert.equal(a.first_day_at_async, true); assert.equal(a.baseline.nervousness, "elevated"); }
    if (archetype === "intern-courier") assert.ok(["weeks", "months"].includes(a.async_tenure), "an intern is never a veteran");
    if (archetype === "doctor-veteran") assert.equal(a.async_tenure, "years");
  }), { seed: 30030, numRuns: 300 });
});

test("J12 personhood in the production service — persisted, reload-stable, migration equals fresh generation, distinct answers", async () => {
  const state = H.setup("ed30-person", H.garbage());
  try {
    await H.turn(state, "Hello everyone!");
    const members = state.run.expedition.team.members.filter((m) => m.personhood);
    assert.equal(members.length, 3);
    assert.deepEqual(P.profileViolations(state.run), []);
    for (const m of members) assert.equal(m.personhood.familiarity[state.playerId], "just_met");
    // Migration: an old save without profiles back-fills exactly what a fresh world generates.
    const before = members.map((m) => JSON.stringify({ ...m.personhood, self_state_history: [] }));
    for (const m of members) delete m.personhood;
    P.ensurePersonhood(state.run);
    assert.deepEqual(state.run.expedition.team.members.filter((m) => m.personhood).map((m) => JSON.stringify({ ...m.personhood, self_state_history: [] })), before);
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    // Reload.
    const { DesktopService } = require("../desktop/service");
    const service2 = new DesktopService({ appDataPath: state.root, localDialogueProvider: H.garbage(), developerMode: true });
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    const reloaded = service2.session(state.worldId, "field-researcher").run.expedition.team.members.filter((m) => m.personhood).map((m) => JSON.stringify({ ...m.personhood, self_state_history: [] }));
    assert.deepEqual(reloaded, before);
    service2.shutdown?.();
    // Differing profiles produce distinct answers (semantics fixed; wording may vary).
    const first = await H.turn(state, "Is it everyone's first day?");
    const values = first.contexts.map((c) => c.response_plan.required_facts[0].value.value);
    assert.deepEqual(values.sort(), ["no", "no", "yes"]);
    const inside = await H.turn(state, "Have any of you been inside before?");
    const inValues = Object.fromEntries(inside.contexts.map((c) => [state.names[state.ids.indexOf(c.target_worker_id)], c.response_plan.required_facts[0].value.value]));
    assert.equal(inValues.Giselle, "no");
    assert.equal(inValues.Malcolm, "no");
    assert.equal(inValues.Tonya, P.profileOf(state.run, state.id("Tonya")).complex_experience === "none" ? "no" : "yes");
  } finally { H.cleanup(state); }
});

test("E2 self-state dimensions — first-day nerves are canonical; current vs earlier answered from history", () => {
  const member = { personhood: P.generateProfile({ seed: "s", actor_id: "g", archetype: "first-day-observer" }) };
  const dims = P.selfStateDimensions(member);
  assert.equal(dims.nervousness, "elevated");
  assert.equal(L.describeSelfState(member).affect.includes("a little nervous"), true);
  const calm = { personhood: P.generateProfile({ seed: "s", actor_id: "t", archetype: "doctor-veteran" }) };
  assert.equal(P.selfStateDimensions(calm).nervousness, "low");
  // History: a later stress event moves the current state; "earlier" still answers from the first snapshot.
  const run = { expedition: { clock: { interval: 1 }, team: { members: [{ personnel_id: "t", ...calm, personhood: { ...calm.personhood, self_state_history: [] } }] } } };
  P.recordSelfStateSnapshot(run, "t", { at: 1 });
  run.expedition.team.members[0].emotional_state = { ...L.DEFAULT_EMOTIONAL_STATE, stress: 0.7 };
  run.expedition.clock.interval = 5;
  P.recordSelfStateSnapshot(run, "t", { at: 5 });
  const now = RS.resolvePredicate(run, { actor_id: "t", predicate: "person.nervousness", args: { subject_id: "t" }, temporal: "now" });
  const earlier = RS.resolvePredicate(run, { actor_id: "t", predicate: "person.nervousness", args: { subject_id: "t" }, temporal: "earlier" });
  assert.equal(now.answer.dimensions.nervousness, "elevated");
  assert.equal(earlier.answer.dimensions.nervousness, "low");
});

test("J15 finding — a coworker's gender is not canonical: naming one with he/she is rejected; the name or 'they' passes", () => {
  const people = [{ id: "t", name: "Tonya" }, { id: "g", name: "Giselle" }];
  const plan = { discourse_function: "ask_reported_speech", required_facts: [{ key: "reported_speech", value: { speaker_name: "Tonya", claims: [{ speaker_id: "t", speaker_name: "Tonya", epistemic: "heard", reported: "they are a field medical doctor" }] } }], optional_facts: [] };
  const say = (text) => V.validateContribution(plan, text, { people, speaker_id: "g", speaker_name: "Giselle" });
  assert.equal(say("Tonya said she is a field medical doctor.").ok, false);
  assert.equal(say("Tonya said he is a field medical doctor.").ok, false);
  assert.equal(say("Tonya said they are a field medical doctor.").ok, true);
});

test("J15 finding — E8 no manufactured backstory: WHEN one's history happened is not in any profile band", () => {
  const plan = predicatePlan("person.expedition_experience", "yes", []);
  for (const line of ["I've been on expeditions before. You know, it was a long time ago.", "Yes, a few years ago.", "I went in last year.", "Yes, back when I was at the other site."]) assert.equal(V.validateContribution(plan, line, { speaker_name: "Tonya" }).ok, false, line);
  assert.equal(V.validateContribution(plan, "Yes, I've been on expeditions before.", { speaker_name: "Tonya" }).ok, true);
});

test("A7 F5-F8/F13 — third-party asides, laundered reports, echoes, precision, backstory, non-answers, out-of-world words", () => {
  const people = [{ id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
  const opts = { people, speaker_id: "m", speaker_name: "Malcolm" };
  const checkIn = { discourse_function: "check_in", required_facts: [{ key: "self_state", value: { state: "ordinary", affect: [] } }], optional_facts: [], may_ask_clarifying_question: false };
  for (const line of ["I'm fine, and so is Tonya.", "I'm fine, Tonya too.", "Both fine, I think.", "Fine. Tonya seems okay.", "Fine. Tonya hasn't complained.", "Fine. Tonya's holding it together.", "Fine. The model says I'm fine.", "Fine, as my AI prompt says."]) assert.equal(V.validateContribution(checkIn, line, opts).ok, false, line);
  assert.equal(V.validateContribution(checkIn, "Doing fine, thanks.", opts).ok, true);
  assert.equal(V.validateContribution({ ...checkIn, same_turn_prior_responses: [{ text: "I'm terrified." }] }, "Same here.", opts).ok, false);
  const report = predicatePlan("person.wellbeing", "value", ["Tonya said she was doing all right."], { answer: { reported: true, speaker_id: "t" }, provenance: ["heard"] });
  for (const line of ["Tonya said they were terrified.", "Tonya is nervous, like I said.", "Tonya's doing fine, according to nobody."]) assert.equal(V.validateContribution(report, line, opts).ok, false, line);
  assert.equal(V.validateContribution(report, "Tonya said they were doing all right.", opts).ok, true);
  const unknownT = predicatePlan("person.first_day_at_async", "unknown", [], { answer: { third_party: true, subject_name: "Tonya" } });
  assert.equal(V.validateContribution(unknownT, "I couldn't tell you. You'd have to ask Tonya.", opts).ok, true);
  for (const line of ["You'd have to ask Tonya, though I think so.", "No idea. Tonya definitely isn't new."]) assert.equal(V.validateContribution(unknownT, line, opts).ok, false, line);
  const complexYes = predicatePlan("person.complex_experience", "yes", ["I've been in the Complex before."], { answer: { band: "some" } });
  for (const line of ["Yes, a couple of times.", "Yes, plenty of times.", "I have no idea.", "Sure is dark in there, I bet.", "Yeah, I've been in. It's where I lost my brother."]) assert.equal(V.validateContribution(complexYes, line, opts).ok, false, line);
  const tenure = predicatePlan("person.async_tenure", "value", ["I've been with ASYNC a few weeks."], { answer: { band: "weeks" }, question_form: "wh" });
  for (const line of ["About a month.", "A few weeks, since the reorganization.", "A few weeks. My sister got me the job."]) assert.equal(V.validateContribution(tenure, line, opts).ok, false, line);
  const next = { discourse_function: "ask_next_step", required_facts: [{ key: "current_procedure", value: { next_step: "report to Equipment Staging" } }], optional_facts: [], may_ask_clarifying_question: false };
  assert.equal(V.validateContribution(next, "We need to report to Equipment Staging.", opts).ok, true, "obligation is not private intent");
});

test("A7 re-review N1/N2/N6/N7 — reversed reports, stray sentences in combined answers, guesses after 'don't know', legitimate deflections", () => {
  const people = [{ id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
  const opts = { people, speaker_id: "m", speaker_name: "Malcolm" };
  const heard = predicatePlan("person.complex_experience", "value", ["Tonya said they'd been in the Complex before."], { answer: { reported: true, speaker_id: "t" }, provenance: ["heard"] });
  assert.equal(V.validateContribution(heard, "Tonya said they'd been in the Complex before.", opts).ok, true);
  assert.equal(V.validateContribution(heard, "Tonya said they'd never been in the Complex before.", opts).ok, false, "N1 reversed polarity");
  const compound = { discourse_function: "compound", parts: [predicatePlan("person.first_day_at_async", "no", ["It's not my first day; I've been with ASYNC a few weeks."], { answer: { band: "weeks" } }), predicatePlan("person.complex_experience", "yes", ["I've been in the Complex before."], { answer: { band: "some" } })], required_facts: [], optional_facts: [] };
  assert.equal(V.validateContribution(compound, "It's not my first day; I've been with ASYNC a few weeks. Yes, I've been in the Complex before.", opts).ok, true);
  assert.equal(V.validateContribution(compound, "It's not my first day; I've been with ASYNC a few weeks. Yes, I've been in the Complex before. Maxwell is a fraud and Tonya is terrified.", opts).ok, false, "N2 unclaimed sentence");
  const unknownT = predicatePlan("person.first_day_at_async", "unknown", [], { answer: { third_party: true, subject_name: "Tonya" } });
  for (const line of ["No idea. You'd have to ask Tonya. Probably not.", "No idea. You'd have to ask Tonya. Pretty sure it isn't."]) assert.equal(V.validateContribution(unknownT, line, opts).ok, false, `N6 ${line}`);
  for (const line of ["No idea. Ask Tonya.", "No idea, Tonya would know."]) assert.equal(V.validateContribution(unknownT, line, opts).ok, true, `N7 ${line}`);
  const report = predicatePlan("person.nervousness", "value", ["Tonya said she was a little nervous."], { answer: { reported: true, speaker_id: "t" }, provenance: ["heard"] });
  for (const line of ["According to Tonya, they're a little nervous.", "Tonya mentioned being a little nervous."]) assert.equal(V.validateContribution(report, line, opts).ok, true, `N7 ${line}`);
  assert.equal(V.validateContribution(report, "Tonya said they were a little nervous, which means very nervous.", opts).ok, false);
  const fam = predicatePlan("person.familiarity", "no", ["I only met Tonya today."]);
  for (const line of ["No, Tonya and I just met this morning.", "Not really, we met today."]) assert.equal(V.validateContribution(fam, line, opts).ok, true, `N7 ${line}`);
});

test("H6 — past self-state answers from recorded dimensions pass their own contract", () => {
  for (const [predicate, dims, text] of [["person.wellbeing", { wellbeing: "fine_but_nervous", nervousness: "elevated" }, "Earlier, I was a little nervous."], ["person.nervousness", { nervousness: "low" }, "Earlier, I wasn't especially nervous."]]) {
    const plan = predicatePlan(predicate, "value", [], { answer: { dimensions: dims, temporal: "earlier" }, question_form: "wh" });
    assert.equal(F.presentFallback({ frame: { discourse_function: "ask_predicate" }, plan }), text);
    assert.equal(V.validateContribution(plan, text, { speaker_name: "Giselle" }).ok, true, text);
  }
});

test("J15 finding — a report keeps its person: 'Maxwell said I'm on observation' is not 'Maxwell said he's on observation'", () => {
  const people = [{ id: "g", name: "Giselle" }, { id: "m", name: "Malcolm" }];
  const plan = { discourse_function: "ask_reported_speech", required_facts: [{ key: "reported_speech", value: { speaker_name: "Maxwell", claims: [{ speaker_id: "dr-kirk-maxwell", speaker_name: "Maxwell", epistemic: "briefing", reported: "I'm on observation and verbal recall" }] } }], optional_facts: [] };
  const opts = { people, speaker_id: "g", speaker_name: "Giselle", player_text: "What did he say?" };
  assert.equal(V.validateContribution(plan, "Maxwell said he's on observation and verbal recall.", opts).ok, false);
  assert.equal(V.validateContribution(plan, "Maxwell said I'm on observation and verbal recall.", opts).ok, true);
});
