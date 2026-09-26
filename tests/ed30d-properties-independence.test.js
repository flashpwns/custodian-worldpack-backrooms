"use strict";

// ED-30 D — properties and independence: metamorphic invariance (J5, fast-check with fixed seeds), minimal
// pairs (J6), the conversation fuzzer's invariants (J13), provider independence by semantic digest (J16),
// cold reload mid-conversation (J17), and the dev-corpus accuracy gate.

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const path = require("node:path");
const H = require("./fixtures/ed30/harness");
const E = require("../tools/dialogue-eval");
const { TRANSFORMS } = require("./fixtures/ed30/metamorphic");
const { PAIRS } = require("./fixtures/ed30/minimal-pairs");
const { runFuzz } = require("../tools/dialogue-fuzz");

const DEV = E.readCorpus(path.join(__dirname, "fixtures/ed30/dev-corpus.jsonl"));
const SCENE = E.scene();
const INTRO = { phase: "introductions" };
const labels = (utterance, context = INTRO) => E.labelsFor({ context, utterance }, SCENE);
const semantics = (l) => ({ speech_act: l.speech_act, addressee: `${l.addressee_kind}:${[...l.addressees].sort().join("+")}`, predicate: l.predicate, cardinality: l.cardinality, temporal: l.temporal_scope, clarify: l.should_clarify });

// ─── J5 metamorphic ──────────────────────────────────────────────────────────────────────────────────
test("J5 metamorphic — every single meaning-preserving transform of every dev item keeps its semantics", () => {
  let variants = 0;
  const broken = [];
  for (const item of DEV) {
    const base = semantics(E.labelsFor(item, SCENE));
    for (const [name, transform] of Object.entries(TRANSFORMS)) for (let pick = 0; pick < 3; pick += 1) {
      const variant = transform(item.utterance, pick);
      if (!variant || variant === item.utterance) continue;
      variants += 1;
      const got = semantics(E.labelsFor({ ...item, utterance: variant }, SCENE));
      if (JSON.stringify(got) !== JSON.stringify(base)) broken.push(`${item.id} ${name}: ${JSON.stringify(variant)} ${JSON.stringify(got)} != ${JSON.stringify(base)}`);
    }
  }
  assert.ok(variants > 1000, `only ${variants} variants`);
  assert.deepEqual(broken, []);
});

test("J5 metamorphic — composed transforms (fast-check, seed 30005) keep the semantics of the dev corpus", () => {
  const names = Object.keys(TRANSFORMS);
  fc.assert(fc.property(
    fc.integer({ min: 0, max: DEV.length - 1 }),
    fc.array(fc.tuple(fc.constantFrom(...names), fc.nat(8)), { minLength: 2, maxLength: 4 }),
    (index, steps) => {
      const item = DEV[index];
      let text = item.utterance;
      for (const [name, pick] of steps) text = TRANSFORMS[name](text, pick) ?? text;
      const got = semantics(E.labelsFor({ ...item, utterance: text }, SCENE));
      const base = semantics(E.labelsFor(item, SCENE));
      assert.deepEqual(got, base, `${item.id}: ${JSON.stringify(text)}`);
    }
  ), { seed: 30005, numRuns: 600 });
});

test("J5 seed families — vocative position/punctuation/casing, first day, experience, destination", () => {
  const same = (list, pick) => { const first = pick(labels(list[0])); for (const u of list.slice(1)) assert.deepEqual(pick(labels(u)), first, u); };
  same(["Tonya, tell me about yourself.", "Interesting. Tonya, tell me about yourself.", "Hey Tonya, tell me about yourself.", "Could you tell me about yourself, Tonya?", "Tonya, tell me about yourself?", "Tonya tell me about yourself", "tonya tell me about yourself.", "TONYA, tell me about yourself!"], (l) => [l.speech_act, l.addressee_kind, l.addressees, l.predicate]);
  same(["Is this your first day?", "First day here?", "You new here?"], (l) => l.predicate);
  // "Have you worked here before?" is the tenure family (inverted polarity): family asserted, not value.
  assert.match(labels("Have you worked here before?").predicate, /^person\.(?:async_tenure|first_day_at_async)$/);
  same(["Been in the Complex before?", "Have you ever been inside?", "Is this your first time going in?"], (l) => [l.predicate, l.temporal_scope]);
  assert.match(labels("You done this before?").predicate, /^person\.(?:expedition|complex)_experience$/);
  same(["Where are we going?", "Where are we headed?", "Where to?", "Where are they sending us?"], (l) => [l.predicate, l.cardinality]);
  // Politeness/hedging wrappers (D13) change nothing.
  same(["Where are we going?", "Quick question: where are we going?", "Sorry, but where are we going?", "Just wondering, where are we going?"], (l) => [l.predicate, l.addressee_kind, l.should_clarify]);
});

// ─── J6 minimal pairs ────────────────────────────────────────────────────────────────────────────────
test("J6 minimal pairs — one small edit apart, different meanings, each side labelled as specified", () => {
  for (const pair of PAIRS) {
    const got = pair.map((side) => labels(side.u, side.context ?? INTRO));
    pair.forEach((side, i) => {
      for (const [field, want] of Object.entries(side).filter(([k]) => !["u", "context"].includes(k))) {
        const value = field === "addressees" ? [...got[i].addressees].sort() : got[i][field];
        assert.deepEqual(value, field === "addressees" ? [...want].sort() : want, `${side.u} ${field}`);
      }
    });
    assert.notDeepEqual(semantics(got[0]), semantics(got[1]), `${pair[0].u} / ${pair[1].u} collapsed`);
  }
});

test("J6 minimal pairs from the brief — must stay distinct", () => {
  const distinct = (a, b, field, ctxA = INTRO, ctxB = INTRO) => { const la = labels(a, ctxA); const lb = labels(b, ctxB); assert.notDeepEqual(field(la), field(lb), `${a} / ${b}`); return [la, lb]; };
  const [tellAbout, toldAbout] = distinct("Tonya, tell me about Malcolm.", "Tonya told me about Malcolm.", (l) => l.speech_act);
  assert.equal(tellAbout.speech_act, "request");
  assert.deepEqual(tellAbout.addressees, ["Tonya"]);
  assert.equal(toldAbout.speech_act, "statement");
  const [where, why] = distinct("Where are we going?", "Why are we going?", (l) => l.predicate);
  assert.equal(where.predicate, "mission.destination");
  assert.equal(why.predicate, "mission.objective");
  distinct("What are the materials for?", "Where are the materials going?", (l) => l.predicate);
  const [beenThere, whatThere] = distinct("Have you been there?", "What is there?", (l) => l.predicate);
  assert.equal(beenThere.predicate, "person.complex_experience");
  assert.equal(whatThere.predicate, "place.definition");
  const [coming, whereIs] = distinct("Is Tonya coming?", "Where is Tonya?", (l) => l.predicate);
  assert.equal(coming.predicate, "transition.participants");
  assert.equal(whereIs.predicate, "person.presence");
  const [past, typo] = distinct("Where were we going?", "where were going", (l) => l.temporal_scope);
  assert.equal(past.predicate, "mission.destination");
  assert.equal(past.temporal_scope, "earlier");
  assert.equal(typo.predicate, "mission.destination");
  const [requestTell, ability] = distinct("Can you tell me about yourself?", "Can you even go in there?", (l) => l.speech_act);
  assert.equal(requestTell.speech_act, "request");
  assert.equal(ability.predicate, "place.access");
  const pending = { phase: "introductions", pending_unanswered_request: "Are we all going together?" };
  const [helloBare, helloPending] = distinct("Hello?", "Hello?", (l) => l.predicate, INTRO, pending);
  assert.equal(helloBare.predicate, null);
  assert.equal(helloPending.predicate, "transition.participants");
  const round = { phase: "introductions", active_speaker: "Tonya", last_player_line: "Tonya, tell me about yourself.", last_npc_line: "I'm Tonya, a field medical doctor.", active_activity: "SELF_INTRODUCTION_ROUND", activity_done: ["Tonya", "Giselle"] };
  const [turnNone, turnRound] = distinct("Your turn", "Your turn", (l) => [l.addressees, l.should_clarify], INTRO, round);
  assert.equal(turnNone.should_clarify, true);
  assert.deepEqual(turnRound.addressees, ["Malcolm"]);
  const after = { phase: "introductions", active_speaker: "Giselle", last_player_line: "Giselle, tell me about yourself.", last_npc_line: "I'm Giselle, a field researcher." };
  const [repair, report] = distinct("I was speaking to Tonya", "I was speaking to Tonya earlier and she said she was nervous.", (l) => l.speech_act, after, after);
  assert.equal(repair.speech_act, "repair");
  assert.deepEqual(repair.addressees, ["Tonya"]);
  assert.equal(report.speech_act, "statement");
});

// ─── J13 conversation fuzzer ─────────────────────────────────────────────────────────────────────────
test("J13 fuzzer — seeded random walks through the production service hold every invariant", async () => {
  // The gate run (5 sessions x 200 turns x 3 providers) is `node tools/dialogue-fuzz.js`; this pins a
  // smaller fixed-seed slice of the same walk in the suite.
  for (const [provider, seed] of [["garbage", 30013], ["leaky", 50013]]) {
    const out = await runFuzz({ seed, sessions: 1, turns: 60, provider });
    assert.equal(out.stats.turns, 60);
    assert.deepEqual(out.violations, [], `${provider} seed ${seed}`);
  }
});

test("J13 pinned shrinks — failures the fuzzer found stay fixed", async () => {
  const state = H.setup("ed30-pinned", H.leaky());
  try {
    await H.turn(state, "Hello everyone!");
    await H.turn(state, "Giselle, how are you?");
    // (1) An attributed report of a heard self-state is licensed; the report plan names its speaker.
    const report = await H.turn(state, "Malcolm, what did Giselle say?");
    assert.equal(report.speakers[0], "Malcolm");
    assert.match(report.spoken[0].text, /Giselle said/);
    // (2) A repetition quoting one's own earlier line re-asserts nothing new (no unlicensed self-claim).
    await H.turn(state, "Giselle, how are you?");
    const again = await H.turn(state, "Huh?");
    assert.ok(again.spoken.length >= 1);
    // (3) A third-person state question is never answered with the responder's OWN state.
    const other = await H.turn(state, "Malcolm, how is Tonya?");
    assert.equal(other.fn, "ask_predicate");
    assert.doesNotMatch(other.spoken[0].text, /^I'm |^Honestly, a little nervous/);
    const self = await H.turn(state, "How is Tonya?");
    assert.deepEqual(self.speakers, ["Tonya"]);
    assert.equal(self.fn, "check_in");
  } finally { H.cleanup(state); }
});

// ─── J16 provider independence ───────────────────────────────────────────────────────────────────────
const SCRIPT = [
  "Hello everyone!",
  "Is it everyone's first day here, at Async, today? Or just myself.",
  "How are you doing this morning Giselle?",
  "Good to hear! How about you two, Malcolm, and Tonya?",
  "Does anyone know anything about where were going?",
  "So youve been there before? this, complex?",
  "Tonya, tell me about yourself",
  "Malcolm, your turn",
  "Who is Maxwell and what does he do?",
  "Okay, well that's that, where do we head to next?",
  "Are we all going together?",
  "Malcolm, how is Tonya?",
  "Who has the camera?",
  "Why?",
  "Hello?"
];
async function digestWith(provider, { offline = false } = {}) {
  const state = H.setup("ed30-independence", provider, { offline });
  try {
    for (const line of SCRIPT) await H.turn(state, line);
    return H.semanticDigest(state.run);
  } finally { H.cleanup(state); }
}

test("J16 provider independence — identical semantic digests across fallback / garbage / throwing / scripted / leaky wording", async () => {
  const constant = () => H.scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: "{}" } : "I don't know."));
  const runs = {
    fallback: await digestWith(null, { offline: true }),
    garbage: await digestWith(H.garbage()),
    throwing: await digestWith(H.throwing()),
    scripted: await digestWith(constant()),
    leaky: await digestWith(H.leaky())
  };
  const reference = runs.fallback;
  for (const [name, run] of Object.entries(runs)) assert.equal(run.digest, reference.digest, `${name} digest differs:\n${run.json}\n---\n${reference.json}`);
});

test("J16 advisory unavailable or malformed — only understand→clarify may differ; here nothing does (Tier 1 complete)", async () => {
  // A valid-shaped but EMPTY advisory, a malformed one and a crashing one all fail closed to Tier 1.
  const emptyAdvice = () => H.scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: JSON.stringify({ acts: [] }) } : { raw: "{bad" }));
  const a = await digestWith(emptyAdvice());
  const b = await digestWith(H.garbage());
  const c = await digestWith(H.throwing());
  assert.equal(a.digest, b.digest);
  assert.equal(b.digest, c.digest);
});

// ─── J17 cold reload ─────────────────────────────────────────────────────────────────────────────────
test("J17 cold reload mid-conversation — profiles, self-state history, activity, requests, heard propositions, procedure all survive", async () => {
  const split = 7;
  const straight = await digestWith(H.garbage());
  const state = H.setup("ed30-independence", H.garbage());
  try {
    for (const line of SCRIPT.slice(0, split)) await H.turn(state, line);
    const before = structuredClone({ personhood: state.run.expedition.team.members.map((m) => m.personhood ?? null), dis: state.run.expedition.dialogue_state });
    state.service.persistSession(state.service.getWorld(state.worldId), "field-researcher", state.service.session(state.worldId, "field-researcher"));
    state.service.shutdown?.();
    // Close and reopen: a NEW service instance over the same save.
    const { DesktopService } = require("../desktop/service");
    const service2 = new DesktopService({ appDataPath: state.root, defaultQ4Scenario: "day1-opener", localDialogueProvider: H.garbage(), developerMode: true });
    service2.log = (line) => state.logs.push(String(line));
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    state.service = service2;
    Object.defineProperty(state, "run", { get: () => service2.session(state.worldId, "field-researcher").run, configurable: true });
    const after = { personhood: state.run.expedition.team.members.map((m) => m.personhood ?? null), dis: state.run.expedition.dialogue_state };
    assert.deepEqual(after.personhood, before.personhood, "profiles + self-state history");
    assert.deepEqual(after.dis, before.dis, "requests, activities, repairs, acquaintance, learning");
    for (const line of SCRIPT.slice(split)) await H.turn(state, line);
    // The reloaded conversation continues EXACTLY as the uninterrupted one.
    assert.equal(H.semanticDigest(state.run).digest, straight.digest);
  } finally { H.cleanup(state); }
});

// ─── dev corpus gate ─────────────────────────────────────────────────────────────────────────────────
test("Dev corpus gate — accuracy ≥ the held-out gates, confident-wrong ≤ 1%, clarify ≤ 8%", () => {
  const result = E.evaluate(DEV);
  assert.ok(result.n >= 100);
  assert.ok(result.accuracy.addressee >= 98, JSON.stringify(result.accuracy));
  for (const field of ["speech_act", "predicate", "discourse_relation"]) assert.ok(result.accuracy[field] >= 95, `${field} ${result.accuracy[field]}`);
  assert.ok(result.confident_wrong <= 1, `confident-wrong ${result.confident_wrong}`);
  assert.ok(result.clarify_rate <= 8, `clarify ${result.clarify_rate}`);
});

// ─── I6 transcript regressions ───────────────────────────────────────────────────────────────────────
test("I6 transcript regressions — every checked-in transcript replays to its expectations (fallback and garbage wording)", async () => {
  const fs = require("node:fs");
  const { replayTranscript, readTranscript } = require("../tools/dialogue-replay");
  const dir = path.join(__dirname, "fixtures/ed30/transcripts");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(files.length >= 1);
  for (const file of files) for (const provider of ["fallback", "garbage"]) {
    const result = await replayTranscript(readTranscript(path.join(dir, file)), { provider });
    const failed = result.turns.filter((t) => !t.ok).map((t) => `${t.n} ${t.player}: ${JSON.stringify(t.problems)}`);
    assert.deepEqual(failed, [], `${file} (${provider})`);
  }
});

// ─── M1 developer trace ──────────────────────────────────────────────────────────────────────────────
test("M1 dev trace — every per-turn field is present; trace and transcript export are developer-only", async () => {
  const state = H.setup("ed30-devtrace", H.garbage());
  try {
    await H.turn(state, "Hello everyone!");
    const t = await H.turn(state, "tonya u been in there b4");
    const out = state.service.getDialogueTurnTrace({ world_id: state.worldId, request_id: t.id });
    assert.equal(out.ok, true);
    const tr = out.trace;
    for (const field of ["normalized", "token_repairs", "clauses", "primary", "completeness", "tier2", "responders", "requests", "active_speaker", "activity", "procedure", "lines"]) assert.ok(field in tr, field);
    assert.ok(tr.token_repairs.some((r) => /b4>before/.test(r)));
    const c = tr.clauses[0];
    for (const field of ["speech_act", "question_form", "markers", "vocatives", "quantifier", "temporal", "polarity"]) assert.ok(field in c, field);
    const r = tr.responders[0];
    for (const field of ["predicate", "cardinality", "temporal", "alternatives", "deixis", "reconciliation_overrides", "authorized_facts", "authorized_entities", "profile_keys_consulted", "request_ids"]) assert.ok(field in r, field);
    const line = tr.lines[0];
    for (const field of ["propositions", "private_state_check", "responsiveness", "replans", "fallback_used"]) assert.ok(field in line, field);
    const file = path.join(state.service.paths.logs, "dialogue-transcripts", "t.jsonl");
    assert.equal(state.service.exportDialogueTranscript({ world_id: state.worldId, destination: file }).ok, true);
    // The renderer cannot aim the write elsewhere (review F15): not even at a save inside the profile.
    assert.equal(state.service.exportDialogueTranscript({ world_id: state.worldId, destination: path.join(state.root, "worlds", "x.jsonl") }).error.code, "TRANSCRIPT_DESTINATION_INVALID");
    // Developer mode off: both refuse.
    state.service.developerMode = false;
    assert.equal(state.service.getDialogueTurnTrace({ world_id: state.worldId }).error.code, "DEVELOPER_DISABLED");
    assert.equal(state.service.exportDialogueTranscript({ world_id: state.worldId }).error.code, "DEVELOPER_DISABLED");
  } finally { H.cleanup(state); }
});
