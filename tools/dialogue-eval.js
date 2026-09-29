"use strict";

// Developer tool (ED-30 J2): scores the Tier-1 language pipeline against a labelled corpus.
//
//   node tools/dialogue-eval.js <corpus.jsonl> [--failures] [--json]
//
// Each corpus line: { id, context, utterance, expected } (the held-out schema). The context is turned into
// a synthetic dialogue-state snapshot and discourse; the utterance runs through the SAME production
// functions the service uses (analyzeTurn -> buildSemanticFrame -> reconcile -> finalizeFrame). Nothing
// here is player-facing and nothing touches a save.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const dialogueTurn = require("./dialogue-turn");
const dialogueDiscourse = require("./dialogue-discourse");
const registry = require("./dialogue-registry");
const canonicalKnowledge = require("./canonical-knowledge");
const dialogueAdvisory = require("./dialogue-advisory-interpreter");
const dialogueState = require("./dialogue-state");

const SCENE_NAMES = ["Giselle", "Malcolm", "Tonya"];
let sceneCache = null;

/** A real Day-1 run (after the briefing) with the corpus scene's names, for the canonical entity index. */
function scene() {
  if (sceneCache) return sceneCache;
  const { DesktopService } = require("../desktop/service");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-eval-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener" });
  service.log = () => {};
  const worldId = service.createWorld({ name: "EVAL", seed: "ed30-eval" }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Jack", last_name: "Tester" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  for (let b = 0; b < 3; b += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const run = service.session(worldId, "field-researcher").run;
  const playerId = run.session.startup.player.observer_id;
  const team = run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
  team.forEach((m, i) => { m.first_name = SCENE_NAMES[i]; m.display_name = `${SCENE_NAMES[i]} ${m.last_name}`; });
  const present = team.map((m) => ({ id: m.personnel_id ?? m.id, name: m.first_name, names: [m.first_name] }));
  const entities = canonicalKnowledge.entityIndex(run);
  service.shutdown?.();
  fs.rmSync(root, { recursive: true, force: true });
  sceneCache = { present, entities, equipment: run.expedition.equipment, idOf: (name) => present.find((p) => p.name === name)?.id ?? null, nameOf: (id) => present.find((p) => p.id === id)?.name ?? null };
  return sceneCache;
}

const ACTIVITY_TEMPLATE = Object.freeze({
  SELF_INTRODUCTION_ROUND: { predicate: "person.self_description", fn: "invite_self_description", request_text: "Tell me about yourself." },
  GROUP_CHECK_IN: { predicate: "person.wellbeing", fn: "check_in", request_text: "How are you doing?" },
  EXPERIENCE_ROUND: { predicate: "person.complex_experience", fn: "ask_predicate", request_text: "Have you been in the Complex before?" }
});

/** Context -> (DIS snapshot, discourse) using the production analyzer on the prior player line. */
function contextState(context = {}, sc = scene()) {
  const speakerId = context.active_speaker ? sc.idOf(context.active_speaker) : null;
  let lastRequest = null;
  if (context.last_player_line) {
    const prior = dialogueTurn.analyzeTurn({ raw: context.last_player_line, present: sc.present, entities: sc.entities, dis: null });
    const e = prior.primary;
    if (e && ["question", "request", "elliptical_continuation"].includes(e.speech_act)) {
      const frame = dialogueDiscourse.buildSemanticFrame({ text: e.request_text, entities: sc.entities, equipment: sc.equipment });
      const rec = dialogueTurn.reconcile(frame, e);
      const predicate = rec.predicate ?? registry.predicateForFrame(frame);
      const targets = e.addressee?.ids?.length ? e.addressee.ids : (speakerId ? [speakerId] : []);
      lastRequest = { request_id: "req-prior", predicate, fn: frame.discourse_function, request_text: e.request_text, targets, answered_by: speakerId && context.last_npc_line ? [speakerId] : [], state: context.last_npc_line ? "SATISFIED" : "OPEN", temporal: e.temporal_scope, question_form: e.question_form, args: e.args, slots: {} };
    }
  }
  let pending = [];
  if (context.pending_unanswered_request) {
    const prior = dialogueTurn.analyzeTurn({ raw: context.pending_unanswered_request, present: sc.present, entities: sc.entities, dis: null });
    const e = prior.primary;
    const frame = dialogueDiscourse.buildSemanticFrame({ text: e?.request_text ?? context.pending_unanswered_request, entities: sc.entities, equipment: sc.equipment });
    const predicate = dialogueTurn.reconcile(frame, e).predicate ?? registry.predicateForFrame(frame);
    const targets = e?.addressee?.ids?.length ? e.addressee.ids : sc.present.map((p) => p.id);
    pending = [{ request_id: "req-pending", predicate, fn: frame.discourse_function, request_text: e?.request_text ?? context.pending_unanswered_request, targets, answered_by: [], state: "OPEN", temporal: e?.temporal_scope ?? null, question_form: e?.question_form ?? null, args: e?.args ?? null, slots: Object.fromEntries(targets.map((id) => [id, "OPEN"])) }];
    if (!lastRequest) lastRequest = pending[0];
  }
  const activity = context.active_activity && ACTIVITY_TEMPLATE[context.active_activity] ? { activity_id: "act-1", kind: context.active_activity, template: { ...ACTIVITY_TEMPLATE[context.active_activity] }, completed: (context.activity_done ?? []).map((n) => sc.idOf(n)).filter(Boolean), pending: [], eligible: sc.present.map((p) => p.id), last_target: null } : null;
  const npcAsked = /\?\s*$/.test(context.last_npc_line ?? "");
  // The NPC line was actually spoken: its sentences are anchored to the request it answered, exactly as the
  // ledger anchors an accepted line (dialogue-state.anchorSpans).
  const answered = lastRequest && lastRequest.request_id === "req-prior" ? lastRequest : null;
  const surface_anchors = speakerId && context.last_npc_line ? [{ speaker_id: speakerId, event_id: "e-prior", spans: dialogueState.anchorSpans(context.last_npc_line, [{ request_id: answered?.request_id ?? null, predicate: answered?.predicate ?? null }]).map((span) => ({ ...span, request_text: answered?.request_text ?? null, args: answered?.args ? { ...answered.args } : null, temporal: answered?.temporal ?? null })) }] : [];
  // A coworker line ending in a question opens an inbound expectation (as the ledger records it).
  const pending_inbound_request = speakerId && npcAsked ? { kind: dialogueState.inboundKind(context.last_npc_line, null), from: speakerId, text: context.last_npc_line, predicate: registry.detectPredicates(String(context.last_npc_line).toLowerCase())[0]?.id ?? null, ...dialogueState.inboundShape(context.last_npc_line, null) } : null;
  const dis = { active_speaker: speakerId ? { speaker_id: speakerId, speaker_ids: [speakerId] } : null, last_request: lastRequest, pending_requests: pending, activity, surface_anchors, pending_inbound_request };
  const discourse = context.last_player_line || context.last_npc_line ? { turns: [], last_turn: { kind: "player_exchange", interaction_id: "i-prior", player_text: context.last_player_line ?? null, responder_ids: speakerId ? [speakerId] : [], responses: speakerId && context.last_npc_line ? [{ speaker_id: speakerId, speaker_name: context.active_speaker, text: context.last_npc_line, basis: { kind: "social" }, facts: { required: [{ key: "known_fact", value: context.last_npc_line }], optional: [] } }] : [], address: { scope: speakerId ? "direct" : "untargeted", addressee_ids: speakerId ? [speakerId] : [] } }, active_thread: speakerId ? { kind: "direct", member_ids: [speakerId], responder_ids: [speakerId] } : null, pending_question: npcAsked ? { discourse_function: lastRequest?.fn ?? "ask_factual", player_text: context.last_player_line ?? "", responder_ids: speakerId ? [speakerId] : [], asker_ids: speakerId ? [speakerId] : [], expected_slot: "topic" } : null } : null;
  return { dis: dialogueTurn.withSalience(dis, discourse, sc.entities), discourse };
}

/** The labels the pipeline produces for one corpus item. */
function labelsFor(item, sc = scene(), { advice = null } = {}) {
  const { dis, discourse } = contextState(item.context ?? {}, sc);
  let analysis = dialogueTurn.analyzeTurn({ raw: item.utterance, present: sc.present, entities: sc.entities, dis });
  // Full pipeline: an accepted v2 reading fills only what Tier 1 left incomplete (as the service does).
  // (applyAdvisory assesses every reading and applies only a semantically complete one.)
  if (advice) analysis = dialogueTurn.applyAdvisory(analysis, advice, { present: sc.present, entities: sc.entities, dis });
  const advisoryState = analysis.advisory?.state ?? null;
  if (advisoryState && !advisoryState.accepted) advice = null;
  const e = analysis.primary;
  const socialOnly = !analysis.effective.some((x) => !["social_acknowledgment", "thanks"].includes(x.speech_act));
  const frame0 = dialogueDiscourse.buildSemanticFrame({ text: e?.request_text ?? item.utterance, recipient_type: e?.addressee?.kind === "group" ? "group" : e?.addressee?.ids?.length ? "direct" : "none", discourse, entities: sc.entities, equipment: sc.equipment, addressee_ids: e?.addressee?.ids ?? [], people: sc.present, ...(advice?.accepted ? { advice } : {}) });
  const completeness = dialogueTurn.completenessWithFrame(analysis, frame0, e);
  const frame = e ? dialogueTurn.finalizeFrame(frame0, e, dialogueTurn.reconcile(frame0, e), { completeness, entities: sc.entities }) : frame0;
  const clarify = Boolean(e?.clarify) || frame.discourse_function === "ambiguous_reference" || (frame.discourse_function === "ask_factual" && frame.tier1_generic && completeness.missing.includes("facet_unresolved"));
  let speech = socialOnly ? (analysis.acts[0]?.speech_act ?? "social_acknowledgment") : e.speech_act;
  let relation = e?.relation ?? "new";
  if (dis?.npc_question && speech === "statement" && !clarify) { speech = "answer"; relation = "answer"; }
  const ids = e?.addressee?.ids ?? [];
  const kindOf = () => {
    if (!e?.addressee) return "untargeted";
    if (e.addressee.kind === "group" && e.addressee.source === "repair") return "group";
    if (["vocative", "vocative_not_present", "chip", "repair", "legacy_correction"].includes(e.addressee.source)) return "explicit";
    if (e.addressee.kind === "group" || (ids.length === sc.present.length && e.addressee.source !== "vocative")) return ids.length ? "group" : "untargeted";
    if (e.addressee.kind === "subset") return "subset";
    if (e.addressee.kind === "inherited" || ["active_speaker", "activity_remaining", "repaired_request", "pending_request"].includes(e.addressee.source)) return ids.length ? "inherited" : "untargeted";
    return e.addressee.kind;
  };
  const qf = { tag: "declarative" }[e?.question_form] ?? (["question", "elliptical_continuation", "repair", "attention_call"].includes(e?.speech_act) ? (e?.question_form ?? null) : null);
  const predicate = socialOnly || (e?.speech_act === "attention_call" && !e.request_text) || e?.repair?.vacuous ? null : (frame.predicate ?? null);
  // "each_self_concise" is a wording variant of each_self (a follow-up answered briefly), not a label.
  const card = socialOnly ? "none" : ({ each_self_concise: "each_self" }[frame.turn?.cardinality ?? e?.cardinality] ?? frame.turn?.cardinality ?? e?.cardinality ?? "none");
  return { _advisory_state: advisoryState, speech_act: speech, question_form: qf, addressee_kind: kindOf(), addressees: ids.map((id) => sc.nameOf(id)).filter(Boolean), predicate, discourse_relation: relation, cardinality: card, temporal_scope: predicate ? (frame.turn?.temporal_scope ?? null) : (e?.temporal_scope ?? null), should_clarify: clarify, _fn: frame.discourse_function, _missing: completeness.missing };
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
/** Scores a corpus with the Tier-1 pipeline only; returns per-field accuracy, clarify stats and failures. */
function evaluate(items) {
  const sc = scene();
  return score(items, items.map((item) => labelsFor(item, sc)));
}

/**
 * The production gate's view of one item (Tier 1 only): does the service send it to Tier 2, and with what
 * request? Uses dialogueTurn.advisoryGate -- the same function desktop/service.js calls.
 */
function gateFor(item, sc = scene()) {
  const { dis, discourse } = contextState(item.context ?? {}, sc);
  const analysis = dialogueTurn.analyzeTurn({ raw: item.utterance, present: sc.present, entities: sc.entities, dis });
  const e = analysis.primary;
  const frame = dialogueDiscourse.buildSemanticFrame({ text: e?.request_text ?? item.utterance, recipient_type: e?.addressee?.kind === "group" ? "group" : e?.addressee?.ids?.length ? "direct" : "none", discourse, entities: sc.entities, equipment: sc.equipment, addressee_ids: e?.addressee?.ids ?? [], people: sc.present });
  const completeness = dialogueTurn.completenessWithFrame(analysis, frame, e);
  const recent = [item.context?.last_player_line, item.context?.last_npc_line].filter(Boolean);
  const gate = dialogueTurn.advisoryGate({ message: item.utterance, analysis, frame, completeness, present: sc.present, entities: sc.entities, recent, dis });
  return { ...gate, completeness: { ...completeness, missing: [...gate.contract.missing] } };
}

/**
 * End-to-end production interpretation: Tier 1, the production Tier-2 gate, ONE bounded v2 reading from
 * the real local model where the gate asks for it (validated by the production validator), then the same
 * reconciliation. `provider` is the production local-model provider.
 */
async function evaluateFull(items, { provider, log = () => {} } = {}) {
  const sc = scene();
  const gots = [];
  const tier2 = { invoked: 0, accepted: 0, rejected: 0, decoded: 0, schema_valid: 0, semantically_complete: 0, timeouts: 0, first_pass_none: 0, second_pass: 0, second_pass_recovered: 0, second_pass_ms: [], reasons: {}, latency_ms: [], turn_ms: [] };
  for (const [i, item] of items.entries()) {
    const started = Date.now();
    const gate = gateFor(item, sc);
    let advice = null;
    if (gate.needed) {
      tier2.invoked += 1;
      const raw = await dialogueAdvisory.requestAdvisoryWithFacetRecovery(provider, gate.v2);
      if (raw?.facet_first_pass === "NONE") tier2.first_pass_none += 1;
      if (raw?.second_pass?.used) { tier2.second_pass += 1; if (raw.second_pass.recovered) tier2.second_pass_recovered += 1; tier2.second_pass_ms.push(raw.second_pass.latency_ms ?? 0); }
      advice = raw && typeof raw === "object" ? { ...raw, tier1_missing: [...(gate.completeness?.missing ?? [])] } : raw;
      tier2.latency_ms.push(advice?.latency_ms ?? 0);
    }
    const got = labelsFor(item, sc, { advice });
    const st = got._advisory_state;
    if (gate.needed) {
      if (st?.decoded) tier2.decoded += 1;
      if (st?.schema_valid) tier2.schema_valid += 1;
      if (st?.semantically_complete) tier2.semantically_complete += 1;
      if (advice?.reason === "timeout") tier2.timeouts += 1;
      if (st?.accepted) tier2.accepted += 1; else { tier2.rejected += 1; const why = st?.reason ?? advice?.reason ?? "unknown"; tier2.reasons[why] = (tier2.reasons[why] ?? 0) + 1; }
    }
    gots.push({ ...got, _tier2: gate.needed ? (st?.accepted ? "accepted" : `rejected:${st?.reason ?? advice?.reason ?? "unknown"}`) : "not_invoked" });
    tier2.turn_ms.push(Date.now() - started);
    log(`${i + 1}/${items.length}`);
  }
  const q = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : 0);
  const n = items.length || 1;
  const result = score(items, gots);
  const rate = (x) => (tier2.invoked ? Math.round((x / tier2.invoked) * 1000) / 10 : null);
  result.tier2 = { invocation_rate: Math.round((tier2.invoked / n) * 1000) / 10, invoked: tier2.invoked, decoded: tier2.decoded, schema_valid: tier2.schema_valid, semantically_complete: tier2.semantically_complete, accepted: tier2.accepted, rejected: tier2.rejected, accepted_rate: rate(tier2.accepted), completion_rate: rate(tier2.decoded), timeout_rate: rate(tier2.timeouts), rejection_reasons: tier2.reasons, first_pass_facet_none_rate: rate(tier2.first_pass_none), second_pass_invocations: tier2.second_pass, second_pass_rate: rate(tier2.second_pass), second_pass_recovered: tier2.second_pass_recovered, second_pass_recovery_rate: tier2.second_pass ? Math.round((tier2.second_pass_recovered / tier2.second_pass) * 1000) / 10 : null, second_pass_latency_ms: { p50: q(tier2.second_pass_ms, 0.5), p90: q(tier2.second_pass_ms, 0.9) }, advisory_latency_ms: { p50: q(tier2.latency_ms, 0.5), p90: q(tier2.latency_ms, 0.9) }, turn_latency_ms: { p50: q(tier2.turn_ms, 0.5), p90: q(tier2.turn_ms, 0.9) } };
  return result;
}

// Human-level release gate fields (a turn is correct only if ALL hold; a clarification is never a
// confident wrong answer).
const GATE_FIELDS = ["speech_act", "addressee", "predicate", "discourse_relation", "cardinality", "temporal_scope"];
function score(items, gots) {
  const fields = ["speech_act", "addressee", "predicate", "discourse_relation", "cardinality", "temporal_scope", "question_form"];
  const hits = Object.fromEntries(fields.map((f) => [f, 0]));
  let clarified = 0;
  let confidentWrong = 0;
  let shouldClarifyMissed = 0;
  let turnCorrect = 0;
  const outcomes = { true_positive: 0, correct_clarification: 0, false_clarification: 0, wrong_unclarified: 0 };
  const failures = [];
  for (const [index, item] of items.entries()) {
    const got = gots[index];
    const exp = item.expected;
    const ok = {
      speech_act: got.speech_act === exp.speech_act,
      addressee: got.addressee_kind === exp.addressee_kind && sameSet(got.addressees, exp.addressees ?? []),
      predicate: (got.predicate ?? null) === (exp.predicate ?? null),
      discourse_relation: got.discourse_relation === exp.discourse_relation,
      cardinality: got.cardinality === exp.cardinality,
      temporal_scope: (got.temporal_scope ?? null) === (exp.temporal_scope ?? null),
      question_form: (got.question_form ?? null) === (exp.question_form ?? null)
    };
    for (const f of fields) if (ok[f]) hits[f] += 1;
    if (got.should_clarify) clarified += 1;
    if (!got.should_clarify && exp.should_clarify) shouldClarifyMissed += 1;
    if (!got.should_clarify && (exp.should_clarify || !ok.addressee || !ok.predicate)) confidentWrong += 1;
    if (GATE_FIELDS.every((f) => ok[f]) && got.should_clarify === Boolean(exp.should_clarify)) turnCorrect += 1;
    // Safety outcomes (ED-30I): a true positive interpretation, a correct clarification, a false (unneeded)
    // clarification, or a confident wrong answer.
    if (!got.should_clarify && GATE_FIELDS.every((f) => ok[f]) && !exp.should_clarify) outcomes.true_positive += 1;
    else if (got.should_clarify && exp.should_clarify) outcomes.correct_clarification += 1;
    else if (got.should_clarify && !exp.should_clarify) outcomes.false_clarification += 1;
    else if (!got.should_clarify) outcomes.wrong_unclarified += 1;
    if (Object.values(ok).some((v) => !v) || got.should_clarify !== Boolean(exp.should_clarify)) failures.push({ id: item.id, utterance: item.utterance, context: item.context, got, expected: exp, wrong: fields.filter((f) => !ok[f]).concat(got.should_clarify !== Boolean(exp.should_clarify) ? ["should_clarify"] : []) });
  }
  const n = items.length || 1;
  const pct = (x) => Math.round((x / n) * 1000) / 10;
  return { n: items.length, accuracy: Object.fromEntries(fields.map((f) => [f, pct(hits[f])])), turn_correct: pct(turnCorrect), outcomes: Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, pct(v)])), clarify_rate: pct(clarified), confident_wrong: pct(confidentWrong), should_clarify_missed: shouldClarifyMissed, failures };
}

function readCorpus(file) { return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l)); }

// CLI:
//   node tools/dialogue-eval.js <corpus.jsonl> [--failures] [--json]                 Tier 1 only
//   node tools/dialogue-eval.js <corpus.jsonl> --full [--endpoint URL] [--json]      full production pipeline
// --full uses the production local-model provider against the pinned runtime (launched here unless an
// --endpoint of a running one is given).
async function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: node tools/dialogue-eval.js <corpus.jsonl> [--full [--endpoint URL]] [--failures] [--json]"); process.exit(2); }
  const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  let result;
  if (process.argv.includes("--full")) {
    const { createLocalModelProvider } = require("./ai-local-model-provider");
    let runtime = null;
    let endpoint = argOf("--endpoint");
    if (!endpoint) { runtime = await require("./dialogue-session").startLocalModel(); endpoint = runtime.endpoint; }
    try { result = await evaluateFull(readCorpus(file), { provider: createLocalModelProvider({ endpoint }), log: (m) => process.stderr.write(`\r${m}`) }); }
    finally { if (runtime) await runtime.stop(); }
  } else result = evaluate(readCorpus(file));
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(JSON.stringify({ n: result.n, accuracy: result.accuracy, turn_correct: result.turn_correct, clarify_rate: result.clarify_rate, confident_wrong: result.confident_wrong, should_clarify_missed: result.should_clarify_missed, ...(result.tier2 ? { tier2: result.tier2 } : {}) }, null, 2));
    if (process.argv.includes("--failures")) for (const f of result.failures) console.log(`${f.id} [${f.wrong.join(",")}] ${f.utterance}\n   got ${JSON.stringify({ sa: f.got.speech_act, qf: f.got.question_form, to: `${f.got.addressee_kind}:${f.got.addressees.join("+")}`, P: f.got.predicate, rel: f.got.discourse_relation, card: f.got.cardinality, T: f.got.temporal_scope, clar: f.got.should_clarify, fn: f.got._fn })}\n   exp ${JSON.stringify({ sa: f.expected.speech_act, qf: f.expected.question_form, to: `${f.expected.addressee_kind}:${(f.expected.addressees ?? []).join("+")}`, P: f.expected.predicate, rel: f.expected.discourse_relation, card: f.expected.cardinality, T: f.expected.temporal_scope, clar: f.expected.should_clarify })}`);
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { evaluate, evaluateFull, gateFor, score, labelsFor, contextState, readCorpus, scene, GATE_FIELDS };
