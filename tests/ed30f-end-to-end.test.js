"use strict";

// ED-30 F — end-to-end conversation: general novel-phrasing recovery in Tier 1, the ONE Tier-2 gate shared by
// the service and the end-to-end evaluator, code validation of Tier-2 readings, surface anchors for echo
// follow-ups ("Sealed how?"), and acknowledgments that fit adverse remarks ("I'm so tired.").

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const H = require("./fixtures/ed30/harness");
const R = require("../tools/dialogue-registry");
const T = require("../tools/dialogue-turn");
const D = require("../tools/dialogue-discourse");
const C = require("../tools/dialogue-claims");
const S = require("../tools/dialogue-state");
const ADV = require("../tools/dialogue-advisory-interpreter");
const E = require("../tools/dialogue-eval");

const PEOPLE = [{ id: "g", name: "Giselle", names: ["Giselle"] }, { id: "m", name: "Malcolm", names: ["Malcolm"] }, { id: "t", name: "Tonya", names: ["Tonya"] }];
const analyze = (raw, dis = null) => T.analyzeTurn({ raw, present: PEOPLE, entities: [], dis });

// ─── 2. Tier 1: general rules (no phrase lists) ───────────────────────────────────────────────────────────
test("Tier 1 — hedges carry no facet; a typo maps onto the closed cue lexicon only when that yields a cue", () => {
  assert.deepEqual(R.detectPredicates("so what is the actual job here").map((d) => d.id), ["mission.objective"]);
  assert.deepEqual(R.detectPredicates("what are we honestly doing here today").map((d) => d.id), ["mission.objective"]);
  const typo = R.detectPredicates("ok so where do we reprot after this");
  assert.equal(typo[0]?.id, "procedure.next_incomplete_step");
  assert.equal(typo[0]?.typo_repaired, true);
  // Real words are never "repaired" into cue words, and nothing matches that did not match a cue after repair.
  assert.deepEqual(R.detectPredicates("I tried the lamp"), []);
  assert.deepEqual(R.detectPredicates("the room feels sealed"), []);
  assert.ok(R.cueLexicon().includes("report") && !R.cueLexicon().some((w) => /[^a-z]/.test(w)), "a closed lexicon of cue words");
});

test("Tier 1 — an aux-dropped second-person line is asked even without a cue; a lead-in 'so' opens nothing", () => {
  const holding = analyze("Malcolm, you holding up ok").primary;
  assert.equal(holding.speech_act, "question", "asked, so the completeness gate hands its facet to Tier 2");
  assert.equal(analyze("you know Maxwell said that").primary.speech_act, "statement", "a finite verb with no cue stays a statement");
  assert.equal(analyze("so what's the plan today").primary.relation, "new", "no prior exchange: a lead-in, not a continuation");
});

// ─── 1/2. The Tier-2 gate and code validation of readings ────────────────────────────────────────────────
test("Tier-2 gate — one function for service and evaluator; incomplete turns are sent, complete ones are not", () => {
  const src = require("node:fs").readFileSync(path.join(__dirname, "../desktop/service.js"), "utf8");
  assert.match(src, /dialogueTurn\.advisoryGate\(/, "the service decides through the shared gate");
  const novel = E.gateFor({ utterance: "so what's the gig today", context: { phase: "introductions" } });
  assert.equal(novel.needed, true);
  assert.ok(novel.v2.facets.includes("mission.objective") && novel.v2.facet_guide["mission.objective"], "registry facets with glosses");
  assert.equal(E.gateFor({ utterance: "Where are we going?", context: { phase: "introductions" } }).needed, false, "Tier 1 complete: no model call");
  // Static prompt parts first (prefix caching), the turn last; the model sees labels, never ids.
  const prompt = ADV.buildAdvisoryV2Prompt(novel.v2);
  assert.ok(!/yb-personnel|q4-/.test(prompt), "no ids reach the model");
  assert.ok(prompt.indexOf("Facets:") < prompt.indexOf("The line:"));
});

test("Tier-2 validation — a guessed addressee is dropped; an implausible facet is not filled (clarify beats a wrong answer)", () => {
  const people = [{ label: "p1", id: "g", name: "Giselle", names: ["Giselle"] }];
  const guessed = ADV.validateAdvisoryV2({ acts: [{ speech_act: "question", facet: "mission.objective", addressee_candidate: "p1", referent_candidate: null, quantifier: "none", discourse_relation: "new" }], confidence: "high" }, "so whats the gig", { people, referents: [], facets: ["mission.objective"] });
  assert.equal(guessed.accepted, true);
  assert.equal(guessed.acts[0].addressee_id, null);
  const advise = (facet, raw) => {
    const analysis = analyze(raw);
    const advice = { version: ADV.ADVISORY_V2_VERSION, accepted: true, acts: [{ speech_act: "question", facet, addressee_id: null, referent_id: null, quantifier: "none", discourse_relation: "new" }], tier1_missing: ["facet_unresolved"] };
    return T.applyAdvisory(analysis, advice, { present: PEOPLE, entities: [] }).primary;
  };
  assert.equal(advise("mission.route", "where r we supposed to show up after this").predicate, null, "a 'where' question is never a route (how) question");
  assert.equal(advise("procedure.next_incomplete_step", "where r we supposed to show up after this").predicate, "procedure.next_incomplete_step");
  const entities = E.scene().entities;
  const item = T.applyAdvisory(analyze("whos in charge of the camera"), { version: ADV.ADVISORY_V2_VERSION, accepted: true, acts: [{ speech_act: "question", facet: "person.authority", addressee_id: null, referent_id: null, quantifier: "none", discourse_relation: "new" }], tier1_missing: ["facet_unresolved"] }, { present: PEOPLE, entities });
  assert.notEqual(item.primary.predicate, "person.authority", "a line naming only an item is not about a person's authority");
  // A filled facet takes its canonical time frame: "you holding up ok" is asked about now.
  assert.equal(advise("person.wellbeing", "Malcolm, you holding up ok").temporal_scope, "now");
});

test("full pipeline through the service — a scripted bounded reading fills the facet; a hostile one fills nothing", async () => {
  const reading = (facet) => H.scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: JSON.stringify({ acts: [{ speech_act: "question", facet, addressee_candidate: null, referent_candidate: null, quantifier: "none", discourse_relation: "new" }], confidence: "high" }) } : { raw: "{bad" }));
  const good = H.setup("ed30f-t2", reading("mission.objective"));
  try {
    const r = await H.turn(good, "so what's the gig today");
    assert.equal(r.predicate, "mission.objective");
    assert.equal(r.interaction.interpretation.advice?.accepted, true, "the reading is persisted with the turn");
    assert.match(r.lines.join(" "), /delivery|reconnaissance/i, "canonical resolvers answer");
  } finally { H.cleanup(good); }
  const hostile = H.setup("ed30f-t2x", reading("person.secret_history"));
  try {
    const r = await H.turn(hostile, "so what's the gig today");
    assert.notEqual(r.predicate, "person.secret_history", "facets outside the closed registry never enter");
  } finally { H.cleanup(hostile); }
});

// ─── 3. Echo follow-ups through surface anchors ──────────────────────────────────────────────────────────
test("surface anchors — accepted spoken lines are anchored to the request that licensed them (ids, never facts)", async () => {
  const state = H.setup("ed30f-anchor", H.garbage());
  try {
    await H.turn(state, "Malcolm, what's in the duffle?");
    const anchors = state.run.expedition.dialogue_state.surface_anchors;
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].speaker_id, state.id("Malcolm"));
    for (const span of anchors[0].spans) {
      assert.deepEqual(Object.keys(span).sort(), ["predicate", "request_id", "text", "tokens"]);
      assert.equal(span.predicate, "item.contents");
    }
    const echo = await H.turn(state, "cargo?");
    assert.equal(echo.turnRecord.primary.addressee.source, "surface_anchor");
    assert.deepEqual(echo.ownerNames, ["Malcolm"]);
    assert.equal(echo.predicate, "item.contents", "the echo re-asks the EXISTING anchored request");
    assert.match(echo.lines[0], /That's all I can tell you about it\.$/, "an elaboration adds nothing that is not established");
    const worldBefore = JSON.stringify(state.run.expedition.equipment);
    // The player spoke since: the anchors of that exchange are no longer the immediately relevant ones.
    await H.turn(state, "Okay.");
    assert.equal(S.snapshot(state.run, { player_id: state.playerId }).surface_anchors.length, 0, "stale after the player speaks");
    assert.equal(JSON.stringify(state.run.expedition.equipment), worldBefore, "talk never mutates the world");
  } finally { H.cleanup(state); }
});

test("echo shape — fragments and trailing-wh echo a word; full questions and wh-initial meaning questions do not", () => {
  const dis = { active_speaker: { speaker_id: "m", speaker_ids: ["m"] }, last_request: { request_id: "r1", predicate: "item.contents", request_text: "What's in the duffle?", targets: ["m"], answered_by: ["m"] }, surface_anchors: [{ speaker_id: "m", event_id: "e1", spans: S.anchorSpans("Couldn't tell you. The case is sealed.", [{ request_id: "r1", predicate: "item.contents" }]).map((s) => ({ ...s, request_text: "What's in the duffle?", args: null, temporal: null })) }] };
  const echo = (raw) => analyze(raw, dis).primary;
  for (const raw of ["Sealed how?", "sealed??", "wait, sealed?", "the case is sealed?"]) {
    const e = echo(raw);
    assert.equal(e.addressee.source, "surface_anchor", raw);
    assert.equal(e.predicate, "item.contents", raw);
  }
  assert.equal(echo("Sealed how?").question_form, "wh");
  assert.equal(echo("sealed??").question_form, "yes_no");
  for (const raw of ["Who has the case?", "What sealed?", "Is the case sealed or not, Malcolm?"]) assert.notEqual(echo(raw).addressee?.source, "surface_anchor", raw);
  // Several speakers used the word: ambiguous, no echo.
  const two = { ...dis, surface_anchors: [...dis.surface_anchors, { speaker_id: "t", event_id: "e2", spans: S.anchorSpans("Mine is sealed too.", [{ request_id: "r2", predicate: "item.contents" }]) }] };
  assert.notEqual(analyze("sealed?", two).primary.addressee?.source, "surface_anchor");
});

// ─── 4. Acknowledgments that fit adverse remarks ─────────────────────────────────────────────────────────
test("adverse remarks — a licensed acknowledgment fits fatigue, fear, discomfort or a negative verdict; never 'Sounds good.'", async () => {
  assert.deepEqual(D.playerAffectOf("I'm so tired."), { valence: "adverse", kind: "fatigue" });
  assert.equal(D.playerAffectOf("I'm not tired at all."), null, "negated");
  assert.equal(D.playerAffectOf("You look tired."), null, "about someone else: an observation");
  assert.equal(D.playerAffectOf("Are you tired?"), null, "a question asks; it does not report");
  const state = H.setup("ed30f-affect", H.garbage());
  try {
    for (const [line, fits] of [["I'm so tired.", /hang in there/i], ["Malcolm, this room gives me the creeps.", /fair|blame|understandable/i], ["Tonya, I'm freezing.", /no fun|rough|hang in there/i], ["Giselle, this sucks.", /hear you|fair enough/i]]) {
      const r = await H.turn(state, line);
      assert.equal(r.lines.length, 1, line);
      assert.doesNotMatch(r.lines[0], /sounds good|great|glad|same here|me too/i, line);
      assert.match(r.lines[0], fits, line);
    }
  } finally { H.cleanup(state); }
});

test("validator — restating one's own answer ('Like I said, no, ...') is not a report or a contradiction; a restated leak still is", () => {
  const plan = { discourse_function: "ask_predicate", required_facts: [{ key: "predicate_answer", value: { predicate: "person.familiarity", value: "no", answer: { predicate: "person.familiarity", polarity: "no", band: "just_met", others: ["o"] }, statements: ["We only met today."], provenance: ["self"], question_form: "yes_no" } }], optional_facts: [{ key: "repeat_of_own_answer", value: true }] };
  const people = [{ id: "m", name: "Malcolm" }, { id: "o", name: "Tonya" }];
  assert.equal(C.validatePersonalClaims("Like I said, no, we only met today.", plan, { speaker_name: "Malcolm", speaker_id: "m", people }).ok, true);
  assert.equal(C.validatePersonalClaims("Like I said, Tonya is nervous.", plan, { speaker_name: "Malcolm", speaker_id: "m", people }).ok, false);
});

// ─── 1. The evaluator reports Tier 1 and the full pipeline separately ─────────────────────────────────────
test("evaluator — Tier-1 and full-pipeline scores are separate; Tier-2 invocation / acceptance / latency are reported", async () => {
  const items = E.readCorpus(path.join(__dirname, "fixtures/ed30/dev-novel.jsonl"));
  const tier1 = E.evaluate(items);
  const provider = H.scriptedLocal(() => ({ raw: "{bad" }));
  const full = await E.evaluateFull(items, { provider });
  for (const key of ["accuracy", "turn_correct", "clarify_rate", "confident_wrong"]) assert.ok(key in tier1 && key in full, key);
  assert.ok(full.tier2.invoked > 0 && full.tier2.invocation_rate > 0);
  assert.equal(full.tier2.accepted, 0, "a broken provider is rejected every time");
  assert.deepEqual(full.accuracy, tier1.accuracy, "with every reading rejected, the full pipeline IS Tier 1 (fails closed)");
  assert.ok("p50" in full.tier2.advisory_latency_ms && "p90" in full.tier2.turn_latency_ms);
});

test("fuzz findings (seed 30028) — echo replies keep their contract; conversational words are not echoes", async () => {
  const F = require("../tools/dialogue-fallback");
  // An echo of a brief social check-in stays brief; a clarification never gets the "that's all" suffix.
  const checkIn = { discourse_function: "check_in", expected_response_shape: "short_social_acknowledgment", required_facts: [], optional_facts: [{ key: "elaboration_request", value: { matched: "nervous" } }] };
  const said = F.presentFallback({ frame: { discourse_function: "check_in" }, plan: checkIn });
  assert.doesNotMatch(String(said ?? ""), /all I can tell you/);
  const clarify = { discourse_function: "ambiguous_reference", may_ask_clarifying_question: true, required_facts: [], optional_facts: [{ key: "elaboration_request", value: { matched: "thing" } }] };
  assert.doesNotMatch(String(F.presentFallback({ frame: { discourse_function: "ambiguous_reference" }, plan: clarify }) ?? ""), /all I can tell you/);
  // "thanks" / "mean" / "said" carry no echo.
  for (const w of ["thanks", "mean", "said", "sorry"]) assert.ok(!S.echoTokens(`${w}?`).length, w);
  const state = H.setup("ed30f-fuzz", H.garbage());
  try {
    await H.turn(state, "Giselle, are you nervous?");
    const echo = await H.turn(state, "nervous?");
    assert.equal(echo.turnRecord.primary.addressee.source, "surface_anchor");
    assert.doesNotMatch(echo.lines.join(" "), /all I can tell you/, "a social check-in echo stays a brief social line");
  } finally { H.cleanup(state); }
});
