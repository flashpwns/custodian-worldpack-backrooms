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
  const dis = { active_speaker: speakerId ? { speaker_id: speakerId, speaker_ids: [speakerId] } : null, last_request: lastRequest, pending_requests: pending, activity, npc_question: npcAsked };
  const discourse = context.last_player_line || context.last_npc_line ? { turns: [], last_turn: { kind: "player_exchange", interaction_id: "i-prior", player_text: context.last_player_line ?? null, responder_ids: speakerId ? [speakerId] : [], responses: speakerId && context.last_npc_line ? [{ speaker_id: speakerId, speaker_name: context.active_speaker, text: context.last_npc_line, basis: { kind: "social" }, facts: { required: [{ key: "known_fact", value: context.last_npc_line }], optional: [] } }] : [], address: { scope: speakerId ? "direct" : "untargeted", addressee_ids: speakerId ? [speakerId] : [] } }, active_thread: speakerId ? { kind: "direct", member_ids: [speakerId], responder_ids: [speakerId] } : null, pending_question: npcAsked ? { discourse_function: lastRequest?.fn ?? "ask_factual", player_text: context.last_player_line ?? "", responder_ids: speakerId ? [speakerId] : [], asker_ids: speakerId ? [speakerId] : [], expected_slot: "topic" } : null } : null;
  return { dis: dialogueTurn.withSalience(dis, discourse, sc.entities), discourse };
}

/** The labels the pipeline produces for one corpus item. */
function labelsFor(item, sc = scene()) {
  const { dis, discourse } = contextState(item.context ?? {}, sc);
  const analysis = dialogueTurn.analyzeTurn({ raw: item.utterance, present: sc.present, entities: sc.entities, dis });
  const e = analysis.primary;
  const socialOnly = !analysis.effective.some((x) => !["social_acknowledgment", "thanks"].includes(x.speech_act));
  const frame0 = dialogueDiscourse.buildSemanticFrame({ text: e?.request_text ?? item.utterance, recipient_type: e?.addressee?.kind === "group" ? "group" : e?.addressee?.ids?.length ? "direct" : "none", discourse, entities: sc.entities, equipment: sc.equipment, addressee_ids: e?.addressee?.ids ?? [], people: sc.present });
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
  const card = socialOnly ? "none" : (frame.turn?.cardinality ?? e?.cardinality ?? "none");
  return { speech_act: speech, question_form: qf, addressee_kind: kindOf(), addressees: ids.map((id) => sc.nameOf(id)).filter(Boolean), predicate, discourse_relation: relation, cardinality: card, temporal_scope: predicate ? (frame.turn?.temporal_scope ?? null) : (e?.temporal_scope ?? null), should_clarify: clarify, _fn: frame.discourse_function, _missing: completeness.missing };
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
/** Scores a corpus; returns per-field accuracy, clarify stats and the failures. */
function evaluate(items) {
  const sc = scene();
  const fields = ["speech_act", "addressee", "predicate", "discourse_relation", "cardinality", "temporal_scope", "question_form"];
  const hits = Object.fromEntries(fields.map((f) => [f, 0]));
  let clarified = 0;
  let confidentWrong = 0;
  let shouldClarifyMissed = 0;
  const failures = [];
  for (const item of items) {
    const got = labelsFor(item, sc);
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
    if (Object.values(ok).some((v) => !v) || got.should_clarify !== Boolean(exp.should_clarify)) failures.push({ id: item.id, utterance: item.utterance, context: item.context, got, expected: exp, wrong: fields.filter((f) => !ok[f]).concat(got.should_clarify !== Boolean(exp.should_clarify) ? ["should_clarify"] : []) });
  }
  const n = items.length || 1;
  const pct = (x) => Math.round((x / n) * 1000) / 10;
  return { n: items.length, accuracy: Object.fromEntries(fields.map((f) => [f, pct(hits[f])])), clarify_rate: pct(clarified), confident_wrong: pct(confidentWrong), should_clarify_missed: shouldClarifyMissed, failures };
}

function readCorpus(file) { return fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l)); }

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node tools/dialogue-eval.js <corpus.jsonl> [--failures] [--json]"); process.exit(2); }
  const result = evaluate(readCorpus(file));
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(JSON.stringify({ n: result.n, accuracy: result.accuracy, clarify_rate: result.clarify_rate, confident_wrong: result.confident_wrong, should_clarify_missed: result.should_clarify_missed }, null, 2));
    if (process.argv.includes("--failures")) for (const f of result.failures) console.log(`${f.id} [${f.wrong.join(",")}] ${f.utterance}\n   got ${JSON.stringify({ sa: f.got.speech_act, qf: f.got.question_form, to: `${f.got.addressee_kind}:${f.got.addressees.join("+")}`, P: f.got.predicate, rel: f.got.discourse_relation, card: f.got.cardinality, T: f.got.temporal_scope, clar: f.got.should_clarify, fn: f.got._fn })}\n   exp ${JSON.stringify({ sa: f.expected.speech_act, qf: f.expected.question_form, to: `${f.expected.addressee_kind}:${(f.expected.addressees ?? []).join("+")}`, P: f.expected.predicate, rel: f.expected.discourse_relation, card: f.expected.cardinality, T: f.expected.temporal_scope, clar: f.expected.should_clarify })}`);
  }
}

module.exports = { evaluate, labelsFor, contextState, readCorpus, scene };
