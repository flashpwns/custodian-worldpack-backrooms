"use strict";

// ED-30 A — Compositional conversation: the human Electron trace (F1-F12) through the production service,
// the counterfactual trace, stage-level golden tests (normalize, segment, discourse layer, vocatives, acts,
// completeness gate, reconciliation, Tier-2 v2) and the canon-readiness plug-in (J14).

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./fixtures/ed30/harness");
const N = require("../tools/dialogue-normalize");
const A = require("../tools/dialogue-acts");
const T = require("../tools/dialogue-turn");
const R = require("../tools/dialogue-registry");
const RS = require("../tools/dialogue-resolvers");
const C = require("../tools/dialogue-claims");
const V = require("../tools/dialogue-validation");
const D = require("../tools/dialogue-discourse");
const ADV = require("../tools/dialogue-advisory-interpreter");
const P = require("../tools/dialogue-personhood");

const HUMAN_TRACE = [
  "Hello everyone!",
  "Is it everyone's first day here, at Async, today? Or just myself.",
  "How are you doing this morning Giselle?",
  "Good to hear! How about you two, Malcolm, and Tonya?",
  "Are you all looking forward to doing whatever it is were actually supposed to do in there?",
  "Interesting. Does anyone know anything about where were going?",
  "So youve been there before? this, complex?",
  "Interesting. Tonya, can you tell me a bit about yourself?",
  "I was speaking to Tonya",
  "Tonya, tell me about yourself",
  "Malcolm, your turn",
  "Introduce yourself",
  "Okay, well that's that, where do we head to next?",
  "Alright cool. Are we all going together?",
  "I asked if we were all going there together",
  "Hello?"
];
const answer = (plan) => plan?.required_facts?.find((f) => f.key === "predicate_answer")?.value ?? null;
const profileOf = (state, name) => P.profileOf(state.run, state.id(name));
const people = (state) => state.ids.map((id, i) => ({ id, name: state.names[i], names: [state.names[i]] }));
function noThirdPartyPrivateState(state, spokenEvents) {
  for (const e of spokenEvents) {
    const verdict = C.validatePersonalClaims(e.text, { discourse_function: "check_in", required_facts: [], optional_facts: [] }, { people: people(state), speaker_id: e.speaker_id, speaker_name: e.speaker_name });
    if (!verdict.ok) assert.notEqual(verdict.code, C.CODES.PRIVATE, `${e.speaker_name}: "${e.text}" states another person's private state`);
  }
}

// ─── J4: the exact human trace ───────────────────────────────────────────────────────────────────────
test("J4 human trace — every F1-F12 failure now behaves per human intent (deterministic fallback)", async () => {
  const state = H.setup("ed30-trace", H.garbage());
  try {
    const t = [];
    for (const text of HUMAN_TRACE) t.push(await H.turn(state, text));
    const [giselle, malcolm, tonya] = ["Giselle", "Malcolm", "Tonya"].map((n) => state.id(n));
    // 1. group greeting: each acknowledges once
    assert.deepEqual(t[0].owners.sort(), [giselle, malcolm, tonya].sort());
    // F1 (G-1, G-2, G-3, G-5, G-15): group employment-history choice question; each answers their OWN history.
    assert.equal(t[1].predicate, "person.first_day_at_async");
    assert.equal(t[1].fn, "ask_predicate");
    assert.deepEqual(t[1].owners.sort(), [giselle, malcolm, tonya].sort());
    for (const name of ["Giselle", "Malcolm", "Tonya"]) {
      const a = answer(t[1].plan(state.id(name)));
      assert.equal(a.value, profileOf(state, name).first_day_at_async ? "yes" : "no", `${name} answers from their own profile`);
      assert.deepEqual(a.provenance, ["self"]);
    }
    assert.equal(t[1].turnRecord.primary.temporal_scope, "today");
    assert.deepEqual(t[1].turnRecord.primary.alternatives, ["everyone", "player_only"]);
    noThirdPartyPrivateState(state, t[1].spoken);
    // 3. direct wellbeing
    assert.deepEqual(t[2].owners, [giselle]);
    assert.equal(t[2].predicate, "person.wellbeing");
    // F2 (G-1, G-3, G-8): elliptical subset continuation; BOTH answer their own state; no third-party state.
    assert.equal(t[3].fn, "check_in");
    assert.equal(t[3].turnRecord.primary.relation, "continuation");
    assert.deepEqual(t[3].owners.sort(), [malcolm, tonya].sort());
    noThirdPartyPrivateState(state, t[3].spoken);
    assert.ok(t[3].spoken.every((e) => !/\b(?:Giselle|Tonya|Malcolm)\b/.test(e.text)), "nobody speaks about another person");
    assert.notEqual(t[3].spoken[0].text, t[3].spoken[1].text, "no chorus");
    // 5. group anticipation: each answers for themselves.
    assert.equal(t[4].predicate, "person.anticipation");
    assert.equal(t[4].owners.length, 3);
    // F3 (G-2, G-12): destination, not objective.
    assert.equal(t[5].predicate, "mission.destination");
    assert.equal(t[5].owners.length, 1, "one knower");
    assert.match(answer(t[5].plan()).statements.join(" "), /Outpost A|Equipment Staging/);
    assert.match(t[5].spoken[0].text, /Outpost A|Equipment Staging/);
    // F4 (G-7, G-14): "you" = the one who just answered; "there, this Complex" = the Complex; personal experience.
    assert.equal(t[6].predicate, "person.complex_experience");
    assert.deepEqual(t[6].owners, t[5].owners, "active-speaker inheritance");
    assert.equal(t[6].turnRecord.primary.args.place_id, "complex");
    const exp = answer(t[6].plan());
    assert.equal(exp.value, P.profileOf(state.run, t[6].owners[0]).complex_experience === "none" ? "no" : "yes");
    assert.notEqual(t[6].fn, "ask_entity_definition", "entity resolution never overwrites the facet");
    // F5 (G-6): vocative after a discourse marker.
    assert.deepEqual(t[7].owners, [tonya]);
    assert.equal(t[7].fn, "invite_self_description");
    // F6 (G-9): target repair; Tonya already answered -> a harmless acknowledgment, never a player "claim".
    assert.deepEqual(t[8].owners, [tonya]);
    assert.notEqual(t[8].fn, "make_statement");
    assert.equal(t[8].turnRecord.primary.relation, "repair");
    assert.doesNotMatch(t[8].spoken[0].text, /if you say so/i);
    // 10. an immediate re-ask of the same person: restated ("like I said"), not a second first introduction.
    assert.deepEqual(t[9].owners, [tonya]);
    assert.match(t[9].spoken[0].text, /^Like I said/);
    // F7 (G-8): activity continuation.
    assert.deepEqual(t[10].owners, [malcolm]);
    assert.equal(t[10].fn, "invite_self_description");
    assert.equal(t[10].turnRecord.primary.relation, "continuation");
    // 12. "Introduce yourself" goes to Malcolm (active speaker) and is a restatement.
    assert.deepEqual(t[11].owners, [malcolm]);
    // F8 (G-13): the lead closed introductions; the next INCOMPLETE step is Equipment Staging.
    assert.equal(t[12].fn, "ask_next_step");
    const proc = t[12].plan().required_facts.find((f) => f.key === "current_procedure").value;
    assert.equal(proc.next_step, "report to Equipment Staging");
    assert.equal(proc.current_step, null, "getting acquainted is no longer the current step");
    assert.doesNotMatch(t[12].spoken[0].text, /acquainted/i);
    assert.equal(state.run.expedition.dialogue_state.acquaintance.completed_by, "player_closed");
    // F9 (G-2, G-11, G-12): participant set of the next transition, answered from the briefing.
    assert.equal(t[13].predicate, "transition.participants");
    const who = answer(t[13].plan());
    assert.equal(who.value, "yes");
    assert.deepEqual(who.provenance, ["briefing"]);
    assert.match(t[13].spoken[0].text, /all of us|everyone|together/i);
    // F10 (G-9, G-11): repair pointing at the preceding request; it is re-opened and answered again.
    assert.equal(t[14].turnRecord.primary.relation, "repair");
    assert.equal(t[14].predicate, "transition.participants");
    assert.equal(t[14].turnRecord.primary.reissue_of, t[13].turnRecord.request_ids[0]);
    assert.ok(t[14].spoken.length >= 1);
    // F11 (G-10): nothing is pending any more -> an attention response, not a fresh greeting.
    assert.equal(t[15].fn, "attend");
    assert.notEqual(t[15].fn, "greet");
    // Ledger: every direct question was answered; nothing silently disappeared.
    for (const r of state.run.expedition.dialogue_state.requests) assert.ok(!["OPEN", "PARTIALLY_SATISFIED"].includes(r.state), `${r.request_text} is ${r.state}`);
  } finally { H.cleanup(state); }
});

test("J4 counterfactual trace — the repairs are not needed when the engine is right, and the rest is unchanged", async () => {
  const state = H.setup("ed30-trace", H.garbage());
  try {
    const skip = new Set([8, 9, 11, 14, 15]);
    const t = {};
    for (const [i, text] of HUMAN_TRACE.entries()) if (!skip.has(i)) t[i] = await H.turn(state, text);
    assert.deepEqual(t[7].owners, [state.id("Tonya")], "turn 9 is unnecessary: Tonya answered turn 8");
    assert.deepEqual(t[10].owners, [state.id("Malcolm")], "turn 12 is unnecessary: Malcolm introduced himself at turn 11");
    assert.equal(answer(t[13].plan()).value, "yes", "turns 15-16 are unnecessary: turn 14 was answered");
    assert.equal(t[12].plan().required_facts.find((f) => f.key === "current_procedure").value.next_step, "report to Equipment Staging");
    for (const r of state.run.expedition.dialogue_state.requests) assert.ok(!["OPEN", "PARTIALLY_SATISFIED"].includes(r.state));
  } finally { H.cleanup(state); }
});

test("F12 (G-4) — the contribution ceiling sees another person's private state: Malcolm cannot say how Tonya is", async () => {
  // Directly: the validator rejects the exact trace line against Malcolm's own check-in plan.
  const plan = { discourse_function: "check_in", required_facts: [{ key: "self_state", value: { state: "ordinary", affect: [] } }], optional_facts: [], forbidden_claims: [] };
  const verdict = V.validateContribution(plan, "Not too bad myself. Tonya's doing alright too.", { player_text: "Good to hear! How about you two, Malcolm, and Tonya?", speaker_name: "Malcolm", people: [{ id: "t", name: "Tonya" }], speaker_id: "m" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, C.CODES.PRIVATE);
  assert.equal(V.validateContribution(plan, "Not too bad myself.", { speaker_name: "Malcolm" }).ok, true);
  // Through production: a wording provider that always leaks is rejected for every owner; the plan fallback is committed.
  const state = H.setup("ed30-leak", H.leaky());
  try {
    await H.turn(state, "How are you doing this morning Giselle?");
    const t = await H.turn(state, "Good to hear! How about you two, Malcolm, and Tonya?");
    assert.equal(t.spoken.length, 2);
    for (const e of t.spoken) assert.doesNotMatch(e.text, /Tonya's doing/);
    noThirdPartyPrivateState(state, t.spoken);
  } finally { H.cleanup(state); }
});

// ─── J3: stage-level golden tests ─────────────────────────────────────────────────────────────────────
test("A normalize — raw line preserved; apostrophes, slang and closed-vocabulary names repaired; 'were' by syntax", () => {
  const raw = "So youve been there before? this, complex?";
  const n = N.normalizeUtterance(raw, { names: ["Giselle"] });
  assert.equal(n.raw, raw);
  assert.equal(n.repaired, "So you've been there before? this, complex?");
  assert.match(n.expanded, /you have been there before/);
  const span = N.rawSpanOf(n, n.repaired.indexOf("you've"), n.repaired.indexOf("you've") + 6);
  assert.equal(span.text, "youve", "token map back to the raw line");
  assert.equal(N.normalizeUtterance("where were going?").repaired, "where we're going?");
  assert.equal(N.normalizeUtterance("Where were we going?").repaired, "Where were we going?", "past tense with a subject is untouched");
  assert.equal(N.normalizeUtterance("whatever it is were actually supposed to do").repaired, "whatever it is we're actually supposed to do");
  assert.equal(N.normalizeUtterance("they were going").repaired, "they were going");
  assert.equal(N.normalizeUtterance("gonna be fun, u ready?").repaired, "going to be fun, you ready?");
  assert.equal(N.normalizeUtterance("tanya tell me", { names: ["Tonya", "Giselle"] }).repaired, "Tonya tell me");
  assert.equal(N.normalizeUtterance("maclom?", { names: ["Malcolm"] }).repaired, "Malcolm?");
  // Never across a first letter, never an inflection, never a protected canonical word; ambiguity is reported.
  assert.equal(N.normalizeUtterance("the camera", { names: ["Tamara"] }).repaired, "the camera");
  assert.equal(N.normalizeUtterance("the lights", { vocabulary: ["light"] }).repaired, "the lights");
  const amb = N.normalizeUtterance("Dana?", { names: ["Dara", "Dina"] });
  assert.equal(amb.repaired, "Dana?");
  assert.equal(amb.ambiguous_repairs.length, 1);
  assert.equal(N.editDistance("maclom", "malcolm"), 2);
});

test("B/C segment + discourse layer — choice alternatives, appositions, coordinated questions, markers", () => {
  const seg = A.segment("Is it everyone's first day here, at Async, today? Or just myself.");
  assert.equal(seg.length, 1, "the alternative joins its question");
  assert.equal(A.segment("So you've been there before? this, complex?")[0].apposition, "this complex", "the fragment elaborates the question");
  assert.equal(A.segment("Who is Maxwell and what does he do?").length, 2);
  assert.equal(A.segment("Is this your first day, and have you been in there before?").length, 2);
  const acts = A.parseActs("Interesting. Tonya, can you tell me a bit about yourself?", { people: [{ id: "t", name: "Tonya" }] }).acts;
  assert.deepEqual(acts.map((a) => a.speech_act), ["social_acknowledgment", "request"]);
  assert.equal(acts[1].vocatives[0].id, "t", "the discourse marker never hides the vocative");
  const close = A.parseActs("Okay, well that's that, where do we head to next?", {}).acts;
  assert.equal(close[0].closes_activity, true);
  assert.equal(A.parseActs("Huh?", {}).acts[0].speech_act, "question", "a lone asked marker is a reflex follow-up");
});

test("D4 vocatives vs mentions — position and syntax, never a bare name match", () => {
  const people = [{ id: "t", name: "Tonya" }, { id: "m", name: "Malcolm" }];
  const voc = (text) => A.parseActs(text, { people }).acts.flatMap((a) => a.vocatives.map((v) => v.id));
  const men = (text) => A.parseActs(text, { people }).acts.flatMap((a) => a.mentions.map((v) => v.id));
  for (const text of ["Tonya, tell me about yourself.", "Interesting. Tonya, tell me about yourself.", "Hey Tonya, tell me about yourself.", "Could you tell me about yourself, Tonya?", "tonya tell me about yourself", "Good morning, Tonya", "Tonya?", "is this your first day tonya"]) assert.deepEqual(voc(text), ["t"], text);
  for (const text of ["Tonya told me about Malcolm.", "What did Tonya say?", "the work Tonya does is hard", "Did you see Tonya?", "Is Tonya coming?"]) assert.deepEqual(voc(text), [], text);
  assert.ok(men("Tonya told me about Malcolm.").includes("m"));
  assert.deepEqual(voc("How about you two, Malcolm, and Tonya?").sort(), ["m", "t"]);
  assert.equal(A.parseActs("Hey Tonya", { people }).acts[0].speech_act, "greeting");
  assert.equal(A.parseActs("Tonya?", { people }).acts[0].speech_act, "attention_call");
});

test("D5/D6 speech acts and question forms — request vs ability, declarative, tag, indirect, choice", () => {
  const act = (text) => A.parseActs(text, {}).acts.at(-1);
  assert.equal(act("Can you tell me about yourself?").speech_act, "request");
  assert.equal(act("Can you even go in there?").speech_act, "question");
  assert.equal(act("You've been there before?").question_form, "declarative");
  assert.equal(act("It's your first day, right?").question_form, "tag");
  assert.equal(act("I wonder where we're headed").question_form, "indirect");
  assert.equal(act("Is it everyone's first day, or just mine?").question_form, "choice");
  assert.equal(act("Well, this seems incredibly safe.").speech_act, "sarcasm");
  assert.equal(act("Hello?").speech_act, "attention_call");
  assert.equal(act("Hello!").speech_act, "greeting");
  assert.equal(act("you done this before malcolm").speech_act, "question", "an aux-dropped second-person predicate is a question even unpunctuated");
  assert.equal(act("you said it was fine").speech_act, "statement");
  assert.equal(A.parseActs("you done this before malcolm", { people: [{ id: "m", name: "Malcolm" }] }).acts[0].speech_act, "question");
});

test("D8/D11 quantifiers and temporal scope", () => {
  const q = (text) => A.quantifierOf(N.normalizeUtterance(text).expanded)?.kind ?? null;
  assert.equal(q("How about you two?"), "two");
  assert.equal(q("Does anyone know?"), "any");
  assert.equal(q("everyone except Tonya"), "except");
  assert.equal(q("the rest of you"), "rest");
  assert.equal(q("just now"), "just", "the language layer sees it; the turn layer rejects a non-name");
  const t = (text) => A.temporalOf(N.normalizeUtterance(text).expanded);
  assert.equal(t("Have you ever been there?"), "ever");
  assert.equal(t("Have you been there today?"), "today");
  assert.equal(t("Who had the camera earlier?"), "earlier");
  assert.equal(t("Are you nervous at all"), null);
});

test("E/G reconciliation — the registry facet survives entity lookup; every override is traced (D16, F4)", () => {
  const present = [{ id: "g", name: "Giselle" }];
  const analysis = T.analyzeTurn({ raw: "So youve been there before? this, complex?", present, entities: [], dis: { active_speaker: { speaker_id: "g", speaker_ids: ["g"] } } });
  const legacy = { discourse_function: "ask_entity_definition", knowledge_query: { concept: "entity_definition", entity: { id: "complex" } }, referents: [] };
  const rec = T.reconcile(legacy, analysis.primary);
  assert.equal(rec.predicate, "person.complex_experience");
  assert.equal(rec.route.fn, "ask_predicate");
  assert.equal(rec.override.reason, "registry_facet:person.complex_experience");
  // Structurally stronger legacy functions are never overwritten.
  const meaning = T.reconcile({ discourse_function: "ask_meaning", referents: [] }, { ...analysis.primary, predicate: "person.complex_experience" });
  assert.equal(meaning.route, null);
});

test("D14 completeness gate — incomplete when the parse is only confident, not complete", () => {
  const present = [{ id: "g", name: "Giselle" }, { id: "m", name: "Malcolm" }, { id: "t", name: "Tonya" }];
  const gate = (raw, frame, dis = null) => { const a = T.analyzeTurn({ raw, present, entities: [], dis }); return T.completenessWithFrame(a, frame, a.primary); };
  assert.deepEqual(gate("What's the weather like?", { discourse_function: "ask_factual", tier1_generic: true }).missing, ["facet_unresolved"]);
  assert.ok(gate("you two?", { discourse_function: "ambiguous_reference" }).missing.includes("ellipsis_no_antecedent"));
  assert.equal(gate("Is it everyone's first day?", { discourse_function: "make_statement", tier1_generic: true }).complete, true, "the registry typed it: no advisory call");
  assert.ok(gate("How about you two?", { discourse_function: "ambiguous_reference" }).missing.includes("ellipsis_no_antecedent"));
  assert.equal(gate("Hey Dana, you ready?", { discourse_function: "ask_factual", addressee_state: true }, null).complete, true, "readiness is addressee state, typed by the legacy rule");
});

test("D15 Tier-2 v2 — opaque labels, spans from the player's words, registry facets, fail closed", () => {
  const people = [{ label: "p1", id: "yb-personnel-1", name: "Giselle", names: ["Giselle"] }, { label: "p2", id: "yb-personnel-2", name: "Tonya", names: ["Tonya"] }];
  const referents = [{ label: "r1", id: "complex", name: "the Complex" }];
  const facets = R.advisoryFacets();
  const schema = ADV.advisoryV2Schema({ facets, people, referents });
  assert.deepEqual(schema.properties.acts.items.properties.addressee_candidate.anyOf[0].enum, ["p1", "p2"], "only opaque labels");
  assert.ok(!JSON.stringify(schema).includes("yb-personnel"), "no ids reach the model");
  const prompt = ADV.buildAdvisoryV2Prompt({ utterance: "so you been there tonya", people, referents, facets });
  assert.doesNotMatch(prompt, /yb-personnel|complex_experience\(|first_day_at_async\s*=/);
  const ok = ADV.validateAdvisoryV2({ acts: [{ speech_act: "question", facet: "person.complex_experience", addressee_candidate: "p2", referent_candidate: "r1", quantifier: "one", discourse_relation: "continuation", addressee_text: "tonya", referent_text: null }], confidence: "high" }, "so you been there tonya", { people, referents, facets });
  assert.equal(ok.accepted, true);
  assert.equal(ok.acts[0].addressee_id, "yb-personnel-2");
  const bad = (patch) => ADV.validateAdvisoryV2({ acts: [{ speech_act: "question", facet: "person.complex_experience", addressee_candidate: "p2", referent_candidate: null, quantifier: "one", discourse_relation: "new", ...patch }], confidence: "high" }, "so you been there tonya", { people, referents, facets });
  assert.equal(bad({ addressee_candidate: "p9" }).reason, "unknown_candidate");
  assert.equal(bad({ facet: "person.secret_trauma" }).reason, "unsupported_facet");
  assert.equal(bad({ referent_text: "the Backrooms" }).reason, "referent_text_not_in_utterance");
  assert.equal(bad({ addressee_candidate: "p1" }).reason, "addressee_not_in_utterance", "a label for someone not named in the line");
  assert.equal(ADV.validateAdvisoryV2({ acts: [], confidence: "low" }, "x", {}).accepted, false);
  // Reconciliation fills only what Tier 1 left missing.
  const analysis = T.analyzeTurn({ raw: "so what about in there", present: [{ id: "yb-personnel-2", name: "Tonya" }], entities: [], dis: null });
  const applied = T.applyAdvisory(analysis, { ...ok, version: ADV.ADVISORY_V2_VERSION }, { present: [{ id: "yb-personnel-2", name: "Tonya" }] });
  assert.equal(applied.primary.predicate, "person.complex_experience");
  assert.ok(applied.primary.overrides.some((o) => o.reason === "advisory_filled_missing_facet"));
  const typed = T.analyzeTurn({ raw: "Where are we going?", present: [], entities: [], dis: null });
  assert.equal(T.applyAdvisory(typed, { ...ok, version: ADV.ADVISORY_V2_VERSION }, {}).primary.predicate, "mission.destination", "a complete Tier-1 facet is never overwritten");
  // J15 real-model finding: with Tier 1's gaps attached, a reading fills nothing Tier 1 did not report
  // missing -- "wat does async do" (typed by the legacy frame) never becomes a tenure question, and an
  // untargeted question never becomes a group question from a model's "any".
  const untyped = T.analyzeTurn({ raw: "wat does async do", present: [{ id: "yb-personnel-2", name: "Tonya" }], entities: [], dis: null });
  const tenure = { ...ok, version: ADV.ADVISORY_V2_VERSION, acts: [{ ...ok.acts[0], facet: "person.async_tenure", addressee_id: null, quantifier: "any" }] };
  const noGap = T.applyAdvisory(untyped, { ...tenure, tier1_missing: [] }, { present: [{ id: "yb-personnel-2", name: "Tonya" }] });
  assert.equal(noGap.primary.predicate, untyped.primary.predicate);
  assert.equal((noGap.primary.addressee?.ids ?? []).length, 0);
});

test("J15 finding — the Tier-2 precheck reads normalized text, so typed chat never escalates spuriously", async () => {
  // The advisory provider here always answers with a WRONG facet; a turn Tier 1 already understands must be
  // unaffected by it (the reading is either not requested or fills nothing).
  const wrong = H.scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: JSON.stringify({ acts: [{ speech_act: "question", facet: "person.async_tenure", addressee_candidate: null, referent_candidate: null, quantifier: "any", discourse_relation: "new", addressee_text: null, referent_text: null }], confidence: "high" }) } : { raw: "{bad" }));
  const state = H.setup("ed30-precheck", wrong);
  try {
    const t = await H.turn(state, "wat does async do");
    assert.equal(t.predicate, "institution.purpose");
    assert.equal(t.owners.length, 1);
    const w = await H.turn(state, "whens departure");
    assert.equal(w.predicate, "mission.schedule");
  } finally { H.cleanup(state); }
});

test("C3 Semantic Registry — every entry is complete and self-consistent", () => {
  for (const entry of R.all()) {
    assert.ok(R.validateEntry(entry));
    assert.ok(Array.isArray(entry.neighbors));
    for (const n of entry.neighbors) assert.ok(R.get(n), `${entry.id} neighbour ${n} is registered`);
    if (entry.route.fn === "ask_predicate") assert.ok(RS.RESOLVERS[entry.resolver], `${entry.id} resolver ${entry.resolver}`);
  }
  const byDomain = {};
  for (const entry of R.all()) byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
  assert.ok(Object.keys(byDomain).length >= 7);
});

// ─── J14: canon readiness ─────────────────────────────────────────────────────────────────────────────
test("J14 canon readiness — a new facet is registry data + one resolver; no parser/planner change", async () => {
  // TEST-ONLY synthetic canon: a fake facility fact behind a fake canonical flag. Not lore.
  R.registerPredicate({ id: "facility.test_coffee_status", domain: "facility", slots: {}, question_forms: ["yes_no"], resolver: "test_coffee_status", route: { fn: "ask_predicate" }, epistemic_class: R.EPISTEMIC.OBSERVABLE, default_cardinality: "one_spokesperson", temporal_support: ["now"], granularity: "boolean", answer_contract: { kind: "known_statement" }, neighbors: [], priority: 70, cues: [{ re: "\\bcoffee\\b[^?]*\\b(?:on|ready|made|brewing)\\b", form: "yes_no" }], lexicon: [] });
  RS.registerResolver("test_coffee_status", (run) => ({ value: run.expedition.test_fixture_coffee_on ? "yes" : "no", answer: { predicate: "facility.test_coffee_status" }, statements: [run.expedition.test_fixture_coffee_on ? "The coffee's on." : "The coffee isn't on."], provenance: ["observed"], sources: ["expedition.test_fixture_coffee_on"] }));
  const state = H.setup("ed30-canon", H.garbage());
  try {
    state.run.expedition.test_fixture_coffee_on = true;
    const t = await H.turn(state, "Is the coffee on yet?");
    assert.equal(t.fn, "ask_predicate");
    assert.equal(t.predicate, "facility.test_coffee_status");
    assert.equal(answer(t.plan()).value, "yes");
    assert.equal(t.owners.length, 1);
    assert.equal(t.spoken[0].text, "The coffee's on.");
    assert.equal(V.validateContribution(t.contexts[0].authorized_contribution, t.spoken[0].text).ok, true);
    const req = state.run.expedition.dialogue_state.requests.at(-1);
    assert.equal(req.predicate, "facility.test_coffee_status");
    assert.equal(req.state, "SATISFIED");
  } finally {
    R.unregisterPredicate("facility.test_coffee_status");
    RS.unregisterResolver("test_coffee_status");
    H.cleanup(state);
  }
});

test("F12 multi-question turns — each question is its own request; one responder answers both in one line", async () => {
  const state = H.setup("ed30-multi", H.garbage());
  try {
    const t = await H.turn(state, "Who is Maxwell and what does he do?");
    assert.equal(t.owners.length, 1);
    const plan = t.plan();
    assert.equal(plan.discourse_function, "compound");
    assert.equal(plan.parts.length, 2);
    assert.doesNotMatch(t.spoken[0].text, /who do you mean/i, "the pronoun resolves to the earlier act's person");
    assert.equal(V.validateContribution(t.contexts[0].authorized_contribution, t.spoken[0].text).ok, true);
    const requests = state.run.expedition.dialogue_state.requests.filter((r) => r.submission_id === t.id);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((r) => r.state === "SATISFIED"));
    const u = await H.turn(state, "Tonya, is this your first day, and have you been in there before?");
    assert.deepEqual(u.owners, [state.id("Tonya")]);
    const parts = u.plan().parts.map((p) => p.frame.predicate);
    assert.deepEqual(parts, ["person.first_day_at_async", "person.complex_experience"]);
  } finally { H.cleanup(state); }
});
