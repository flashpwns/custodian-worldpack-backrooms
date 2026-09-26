"use strict";

// Developer tool (ED-30 J13): seeded random-walk conversations through the PRODUCTION service, checking
// dialogue invariants after every turn.
//
//   node tools/dialogue-fuzz.js [--seed 30013] [--sessions 10] [--turns 200] [--provider fallback|garbage|leaky]
//
// Invariants (any violation is reported with its seed, session and turn so it can be pinned as a test):
//   I1 no accepted line states another person's private state (claims validator, empty licence)
//   I2 every committed line passes its own plan's contract (grounding, ceiling, responsiveness)
//   I3 no direct question is dropped: every request this turn opened ends answered / unknown / not
//      established / clarifying (or open only when nobody could hear it)
//   I4 ledger consistency: a satisfied slot points at a committed line
//   I5 no stored player line is ever mutated
//   I6 no world-state mutation originates from wording (custody, locations, phase unchanged by LOCAL talk)
//   I7 procedure advances only by the deterministic acquaintance rule

const { openSession } = require("./dialogue-session");
const V = require("./dialogue-validation");
const C = require("./dialogue-claims");

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

const NAMES = ["Giselle", "Malcolm", "Tonya"];
const GRAMMAR = {
  question: ["Is it everyone's first day?", "{N}, is this your first day?", "Have any of you been inside before?", "{N}, have you been in the Complex before?", "How are you doing, {N}?", "how's everyone doing", "Where are we going?", "Does anyone know where we're headed?", "What's next?", "Are we all going together?", "Is {N} coming?", "Who has the camera?", "What are the startup materials for?", "Where are the materials going?", "What is the Threshold?", "Who is Maxwell?", "What does ASYNC do?", "When do we leave?", "Do you two know each other?", "{N}, tell me about yourself.", "Excited?", "Nervous, {N}?", "{N}, what do you do?", "Who is Maxwell and what does he do?", "What did {N} say?", "{N}, is it {M}'s first day?", "What's on your mind, {N}?", "Can you even go in there?", "How is {N}?", "{N}, how is {M}?", "Is {M} okay?", "{N}, is {M} nervous?", "Has {M} been in the Complex before?"],
  followup: ["Why?", "How do you know?", "How about you two?", "What about {N}?", "And you?", "Your turn, {N}.", "Same question, {N}.", "What do you mean?", "Huh?", "Can you repeat that?", "What about the others?"],
  repair: ["I was speaking to {N}", "No, I meant {N}.", "I asked if we were all going there together", "That's not what I asked.", "I meant the Complex.", "Not today. Ever.", "The other one.", "You didn't answer me."],
  attention: ["Hello?", "{N}?", "Anyone?", "Guys?"],
  social: ["Good to hear.", "Interesting.", "Okay, well that's that.", "Nice.", "Thanks.", "Hello everyone!", "Morning, I'm Jack.", "Well, this seems incredibly safe."],
  claim: ["Maxwell said the Complex is an aquarium.", "The camera is broken.", "I heard Tonya has been in before.", "I'm a little nervous."],
  noise: ["blorp?", "the thing by the thing", "ok so like where", "you two?", "give him the thing"]
};
const MIX = [["question", 0.38], ["followup", 0.16], ["repair", 0.12], ["attention", 0.08], ["social", 0.14], ["claim", 0.06], ["noise", 0.06]];
function utterance(r) {
  let x = r();
  let kind = MIX[0][0];
  for (const [k, w] of MIX) { if (x < w) { kind = k; break; } x -= w; }
  const n = pick(r, NAMES);
  const m = pick(r, NAMES.filter((name) => name !== n));
  let text = pick(r, GRAMMAR[kind]).replace(/\{N\}/g, n).replace(/\{M\}/g, m);
  // Typing noise: lowercase / no punctuation / missing apostrophes.
  const style = r();
  if (style < 0.15) text = text.toLowerCase();
  else if (style < 0.25) text = text.replace(/[?.!]/g, "");
  else if (style < 0.32) text = text.replace(/'/g, "");
  return { kind, text };
}

const snapshotWorld = (run) => JSON.stringify({ custody: Object.fromEntries(Object.entries(run.expedition.equipment ?? {}).map(([k, v]) => [k, v?.holder ?? null])), locations: run.spatial?.personnel_locations ?? null, player: run.spatial?.player_location ?? null, radio: run.expedition.radio?.authorized ?? null, handoff: run.expedition.day1_opener?.esd_handoff?.status ?? null });

async function runFuzz({ seed = 30013, sessions = 4, turns = 100, provider = "garbage" } = {}) {
  const violations = [];
  const stats = { turns: 0, lines: 0, requests: 0, clarified: 0, by_kind: {} };
  for (let s = 0; s < sessions; s += 1) {
    const r = rng(seed + s * 7919);
    const session = await openSession({ provider, seed: `fuzz-${seed}-${s}`, names: NAMES });
    const state = {
      get run() { return session.run; },
      playerId: session.playerId,
      ids: session.coworkers().map((m) => m.personnel_id ?? m.id),
      names: session.coworkers().map((m) => m.first_name)
    };
    const turnOf = async (text) => {
      const out = await session.say(text);
      const receipt = session.run.expedition.communication_receipts.find((x) => x.id === out.request_id);
      const spoken = session.run.expedition.dialogue_history.filter((e) => e.submission_id === out.request_id && e.speaker_id !== state.playerId);
      return { id: out.request_id, result: out.ok ? { ok: true } : { ok: false, error: out.error }, contexts: receipt?.response_contexts ?? [], spoken };
    };
    try {
      const people = state.ids.map((id, i) => ({ id, name: state.names[i] }));
      for (let t = 0; t < turns; t += 1) {
        const { kind, text } = utterance(r);
        stats.by_kind[kind] = (stats.by_kind[kind] ?? 0) + 1;
        const worldBefore = snapshotWorld(state.run);
        const playerLinesBefore = state.run.expedition.dialogue_history.filter((e) => e.speaker_id === state.playerId).map((e) => e.text);
        const reqBefore = (state.run.expedition.dialogue_state?.requests ?? []).length;
        const res = await turnOf(text);
        stats.turns += 1;
        const where = { seed, session: s, turn: t, text };
        const fail = (code, detail) => violations.push({ ...where, code, detail });
        if (res.result?.ok === false && !["LOCAL_TARGET_UNAVAILABLE", "TARGET_NOT_FOUND"].includes(res.result?.error?.code)) fail("TURN_ERROR", res.result.error);
        for (const line of res.spoken) {
          stats.lines += 1;
          const ctx = res.contexts.find((c) => c.target_worker_id === line.speaker_id);
          const priv = C.validatePersonalClaims(line.text, ctx?.authorized_contribution ?? { required_facts: [] }, { people, speaker_id: line.speaker_id, speaker_name: line.speaker_name });
          if (!priv.ok && priv.code === C.CODES.PRIVATE) fail("I1_PRIVATE_STATE", `${line.speaker_name}: ${line.text}`);
          if (ctx?.authorized_contribution) {
            const verdict = V.validateContribution(ctx.authorized_contribution, line.text, { player_text: text, speaker_name: line.speaker_name, people, speaker_id: line.speaker_id });
            if (!verdict.ok) fail("I2_CONTRACT", `${line.speaker_name}: ${line.text} -> ${verdict.reason}`);
          }
          if (ctx?.response_plan?.may_ask_clarifying_question) stats.clarified += 1;
        }
        const requests = state.run.expedition.dialogue_state?.requests ?? [];
        const opened = requests.slice(reqBefore);
        stats.requests += opened.length;
        for (const q of requests.filter((q) => q.submission_id === res.id)) {
          if (["OPEN", "PARTIALLY_SATISFIED"].includes(q.state) && res.spoken.length === 0 && (q.targets ?? []).length) fail("I3_DROPPED_QUESTION", `${q.request_text} (${q.state})`);
        }
        for (const q of requests) for (const slot of Object.values(q.slots ?? {})) if (slot.state === "SATISFIED" && !state.run.expedition.dialogue_history.some((e) => e.id === slot.response_event_id)) fail("I4_LEDGER", q.request_id);
        const playerLinesAfter = state.run.expedition.dialogue_history.filter((e) => e.speaker_id === state.playerId).map((e) => e.text);
        if (playerLinesBefore.some((line, i) => playerLinesAfter[i] !== line)) fail("I5_PLAYER_LINE_MUTATED", "");
        if (snapshotWorld(state.run) !== worldBefore) fail("I6_WORLD_MUTATION", "");
        const acq = state.run.expedition.dialogue_state?.acquaintance;
        if (acq?.complete_at != null && !(acq.closed_by_player_at != null || state.ids.every((id) => acq.introduced?.[id] != null))) fail("I7_PROCEDURE", JSON.stringify(acq));
      }
    } finally { await session.close(); }
  }
  return { seed, sessions, turns_per_session: turns, provider, stats, violations };
}

if (require.main === module) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
  runFuzz({ seed: Number(arg("seed", 30013)), sessions: Number(arg("sessions", 10)), turns: Number(arg("turns", 200)), provider: arg("provider", "garbage") }).then((out) => {
    console.log(JSON.stringify({ ...out, violations: out.violations.slice(0, 40), violation_count: out.violations.length }, null, 2));
    process.exit(out.violations.length ? 1 : 0);
  });
}

module.exports = { runFuzz, utterance, rng, GRAMMAR };
