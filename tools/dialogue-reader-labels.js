#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- GOLD LABEL TOOLING (docs/reader/READER_PHASE2_LABEL_GUIDE.md). Developer tooling only.
//
// Step 0.1 contract (before any gold label exists):
//   * The labelling UNIT is a distinct frozen render (render digest), never a source row: two providers or two
//     fixtures that produce the same render are ONE linguistic item (dialogue-reader-replay.js renderGroups).
//   * A gold label never exists merely because it parses. Every row declares its outcome:
//       ACCEPT            decode + V0 + V1 + V2 + V3 accept the frame, and resolveTurn resolves it (no clarification)
//       EXPECTED_CLARIFY  the frame decodes, names only legal labels (no V1 / V2 error), explicitly records the
//                         intended ambiguity (expected_clarify.field + slot) and resolveTurn clarifies on that slot
//     Anything else -- a V0 failure, a stale or nonexistent relation target, an illegal candidate, a surface
//     contradiction, an outcome that does not match -- is rejected with its reason, never silently kept or repaired.
//   * Label STATES: UNLABELED -> HUMAN_PRIMARY (first-pass human label, written blind) -> MODEL_ASSISTED_REVIEW (an
//     independent model may flag disagreement, only AFTER the human primary is committed) -> ADJUDICATED_GOLD (final
//     human adjudication). Only ADJUDICATED_GOLD counts for headline scoring.
//   * Duplicate label ids are rejected (every row carrying the id), never "last row wins".
//   * Independence (READER_PHASE2_LABELING_REGISTRY.json): the teacher's model family differs from the automated
//     reviewer's; teacher output is never a label source; an evaluated arm is never the label source of its own
//     evaluation; model suggestions are hidden from the human primary labeller until the primary label is committed.
//
//   node tools/dialogue-reader-labels.js --worksheet <capture.json> --out <worksheet.jsonl> [--stratum s] [--sample <sample.json>]
//   node tools/dialogue-reader-labels.js --validate <capture.json> <labels.jsonl>
//   node tools/dialogue-reader-labels.js --agreement <capture.json> <labels-a.jsonl> <labels-b.jsonl>

const fs = require("node:fs");
const path = require("node:path");
const W = require("./dialogue-reader-wire");
const RF = require("./dialogue-reader-frame");
const { renderReaderPrompt, RENDER_VERSION, SYSTEM_TEXT, SYSTEM_DIGEST } = require("./dialogue-reader-render");
const RP = require("./dialogue-reader-replay");

const LABELS_VERSION = "yellow-beast-reader-labels@v2";
const MIN_APPLICABLE_FOR_GATE = 60;
const LABEL_STATES = Object.freeze({ UNLABELED: "UNLABELED", HUMAN_PRIMARY: "HUMAN_PRIMARY", MODEL_ASSISTED_REVIEW: "MODEL_ASSISTED_REVIEW", ADJUDICATED_GOLD: "ADJUDICATED_GOLD" });
const GOLD_OUTCOMES = Object.freeze({ ACCEPT: "ACCEPT", EXPECTED_CLARIFY: "EXPECTED_CLARIFY" });
// The preregistered LABEL-LOSS record (teacher sample label_loss_rule): an adjudicator may declare a render unlabelable,
// with a written reason. It is never gold and never a third gold outcome; it only lets the headline contract account
// for the render (dialogue-reader-replay.js headlineVerdict).
const UNLABELABLE = "UNLABELABLE";
// The resolver's clarification slots (dialogue-resolve-turn.js) and the fields an intended ambiguity may sit in.
const CLARIFY_SLOTS = Object.freeze(["person", "referent", "location", "topic", "answer"]);
const CLARIFY_FIELDS = Object.freeze([...RF.ABSTAIN_FIELDS, "discourse_state"]);
const REGISTRY_FILE = path.join(__dirname, "..", "docs", "reader", "READER_PHASE2_LABELING_REGISTRY.json");
const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));

/**
 * The labelling worksheet: a header row carrying the FROZEN SYSTEM TEXT (the field definitions and conventions the
 * reader and the labeller share), then one row per distinct render with exactly the user render a reader sees. No
 * transcript, canonical state, legacy reading or model suggestion.
 */
function worksheet(groups) {
  const header = { kind: "worksheet_header", labels_version: LABELS_VERSION, render_version: RENDER_VERSION, system_digest: SYSTEM_DIGEST, system_text: SYSTEM_TEXT, states: Object.values(LABEL_STATES), outcomes: Object.values(GOLD_OUTCOMES), clarify_slots: CLARIFY_SLOTS, clarify_fields: CLARIFY_FIELDS };
  const rows = groups.map((g) => ({ kind: "item", id: g.id, render_digest: g.render_digest, system_digest: SYSTEM_DIGEST, render_user: renderReaderPrompt(g.item.input).user, label_state: LABEL_STATES.UNLABELED, gold_outcome: null, gold_wire: null, expected_clarify: null, labeler: null, notes: null }));
  return [header, ...rows];
}

/** Contract validation of ONE gold frame on its representative item. Returns { ok, problem?, detail?, frame, resolution }. */
function validateGoldFrame(item, wire, outcome, expected = null) {
  if (!Object.values(GOLD_OUTCOMES).includes(outcome)) return { ok: false, problem: "gold_outcome_missing_or_unknown" };
  const d = W.decodeWire(wire, item.input);
  if (!d.ok) return { ok: false, problem: "label_fails_V0", detail: d.errors.map((e) => e.code) };
  const r = RP.resolveFrame(item, d.frame);
  const errors = Object.values(r.verdict?.layers ?? {}).flatMap((l) => l.errors ?? []);
  const v1 = errors.filter((e) => e.layer === "V1");
  if (v1.length) return { ok: false, problem: "label_fails_V1", detail: v1.map((e) => e.code) };
  const v2 = errors.filter((e) => e.layer === "V2");
  if (v2.length) return { ok: false, problem: "label_fails_V2", detail: v2.map((e) => e.code) };
  const res = r.resolution;
  if (!res || res.outcome === "invalid") return { ok: false, problem: "label_does_not_resolve" };
  if (outcome === GOLD_OUTCOMES.ACCEPT) {
    if (r.verdict.disposition !== "accept") return { ok: false, problem: "accept_label_not_accepted_by_V3", detail: errors.map((e) => e.code) };
    if (res.outcome !== "resolved") return { ok: false, problem: "accept_label_resolves_to_clarify", detail: [res.clarification?.reason ?? null] };
    return { ok: true, frame: r.frame, resolution: res };
  }
  if (!expected || !CLARIFY_SLOTS.includes(expected.slot) || !CLARIFY_FIELDS.includes(expected.field)) return { ok: false, problem: "expected_clarify_unspecified", detail: [expected ?? null] };
  if (res.outcome !== "clarify") return { ok: false, problem: "expected_clarify_label_resolves", detail: [res.outcome] };
  if (res.clarification?.slot !== expected.slot) return { ok: false, problem: "expected_clarify_slot_mismatch", detail: [res.clarification?.slot ?? null, expected.slot] };
  const act = RP.primaryAct(r.frame);
  if (expected.field !== "discourse_state" && !(act?.abstain ?? []).includes(expected.field) && !(expected.field === "referent" && act?.referent?.candidate === "AMBIGUOUS")) return { ok: false, problem: "expected_clarify_field_not_expressed", detail: [expected.field] };
  return { ok: true, frame: r.frame, resolution: res };
}

/** The labelling registry (families chosen before labelling begins). */
function loadRegistry(file = REGISTRY_FILE) { return JSON.parse(fs.readFileSync(file, "utf8")); }
/** Independence rules that do not depend on the evaluated arm. Returns a list of problems. */
function independenceProblems(label, registry) {
  const out = [];
  const teacher = registry?.teacher?.family ?? null;
  const reviewer = registry?.automated_reviewer?.family ?? null;
  const state = label.label_state;
  const human = (who) => who?.kind === "human" && typeof who.id === "string" && who.id.length > 0;
  if (state === LABEL_STATES.HUMAN_PRIMARY && !human(label.labeler)) out.push("primary_label_not_human");
  if (state === LABEL_STATES.MODEL_ASSISTED_REVIEW) {
    if (label.labeler?.kind !== "model" || !label.labeler?.family) out.push("review_labeler_not_a_recorded_model");
    if (!teacher || !reviewer) out.push("families_not_recorded_before_labelling");
    if (teacher && label.labeler?.family === teacher) out.push("review_family_equals_teacher_family");
  }
  if (state === LABEL_STATES.ADJUDICATED_GOLD) {
    if (!human(label.adjudicator)) out.push("adjudicator_not_human");
    if (!human(label.primary?.labeler) || !label.primary?.committed_at) out.push("adjudicated_without_committed_human_primary");
    for (const review of label.reviews ?? []) {
      if (review.labeler?.kind !== "model" || !review.labeler?.family) out.push("review_without_model_family");
      if (teacher && review.labeler?.family === teacher) out.push("review_family_equals_teacher_family");
      if (!review.created_at || !label.primary?.committed_at || !(Date.parse(review.created_at) > Date.parse(label.primary.committed_at))) out.push("review_visible_before_primary_committed");
    }
  }
  if (label.source === "teacher" || label.labeler?.role === "teacher" || label.adjudicator?.role === "teacher") out.push("teacher_output_is_never_gold");
  return [...new Set(out)];
}

/**
 * Validates a label file against the frozen render groups. Returns { gold: {id -> { frame, outcome, expected_clarify,
 * resolution, state, label }}, problems: [...], counts }. `states` selects the label states returned as gold
 * (headline: ADJUDICATED_GOLD only). Rows failing any rule are rejected with the reason.
 */
function validateLabels(groups, labels, { states = [LABEL_STATES.ADJUDICATED_GOLD], registry = null } = {}) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const gold = {};
  const problems = [];
  const unlabelable = [];
  const idCount = new Map();
  for (const l of labels) idCount.set(l?.id, (idCount.get(l?.id) ?? 0) + 1);
  for (const l of labels) {
    const reject = (problem, extra = {}) => problems.push({ id: l?.id ?? null, problem, ...extra });
    if (!l || typeof l.id !== "string") { reject("label_without_id"); continue; }
    if (idCount.get(l.id) > 1) { reject("duplicate_label_id", { rows: idCount.get(l.id) }); continue; }
    const group = byId.get(l.id);
    if (!group) { reject("unknown_item"); continue; }
    if (!l.render_digest) { reject("render_digest_missing"); continue; }
    if (l.render_digest !== group.render_digest || renderReaderPrompt(group.item.input).render_digest !== l.render_digest) { reject("render_changed_since_labelling"); continue; }
    if (!Object.values(LABEL_STATES).includes(l.label_state) || l.label_state === LABEL_STATES.UNLABELED) { reject("label_state_missing_or_unlabeled"); continue; }
    const independence = independenceProblems(l, registry);
    if (independence.length) { reject("independence_violation", { detail: independence }); continue; }
    if (l.gold_outcome === UNLABELABLE) {
      if (l.label_state !== LABEL_STATES.ADJUDICATED_GOLD || typeof l.unlabelable_reason !== "string" || !l.unlabelable_reason.trim() || l.gold_wire != null) { reject("unlabelable_record_invalid"); continue; }
      unlabelable.push({ id: l.id, reason: l.unlabelable_reason, adjudicator: l.adjudicator?.id ?? null });
      continue;
    }
    const v = validateGoldFrame(group.item, l.gold_wire, l.gold_outcome, l.expected_clarify ?? null);
    if (!v.ok) { reject(v.problem, { detail: v.detail ?? null }); continue; }
    if (!states.includes(l.label_state)) continue;
    gold[l.id] = { frame: v.frame, wire: l.gold_wire, outcome: l.gold_outcome, expected_clarify: l.expected_clarify ?? null, resolution: v.resolution, state: l.label_state, label: l };
  }
  const counts = { rows: labels.length, accepted: Object.keys(gold).length, unlabelable: unlabelable.length, rejected: problems.length, by_state: {} };
  for (const l of labels) counts.by_state[l?.label_state ?? "none"] = (counts.by_state[l?.label_state ?? "none"] ?? 0) + 1;
  return { gold, problems, unlabelable, counts };
}

/** Rejects gold whose labeller shares the evaluated arm's model family (an arm never labels its own evaluation). */
function excludeSelfLabelled(gold, armFamily) {
  if (!armFamily) return { gold, excluded: [] };
  const excluded = [];
  const out = {};
  for (const [id, g] of Object.entries(gold)) {
    const sources = [g.label.labeler, g.label.primary?.labeler, g.label.adjudicator, ...(g.label.reviews ?? []).map((r) => r.labeler)];
    if (sources.some((s) => s?.family && s.family === armFamily)) excluded.push(id); else out[id] = g;
  }
  return { gold: out, excluded };
}

/** Cohen's kappa and PABAK over paired categorical labels. */
function kappa(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, agreement: null, kappa: null, pabak: null, categories: 0 };
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  const k = cats.length;
  const round = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
  return { n, agreement: round(po), kappa: pe === 1 ? null : round((po - pe) / (1 - pe)), pabak: k > 1 ? round((k * po - 1) / (k - 1)) : round(2 * po - 1), categories: k };
}
const FIELD_VALUE = {
  gold_outcome: null,
  speech_act: (a) => a?.speech_act ?? null,
  address: (a) => (a ? `${a.address?.op}:${[...(a.address?.names ?? [])].sort().join("+")}` : null),
  facet: (a) => a?.facet ?? null,
  relation: (a) => (a ? `${a.relation?.kind}:${a.relation?.target ?? ""}` : null),
  repair_kind: (a) => a?.repair_kind ?? "none",
  referent: (a) => a?.referent?.candidate ?? "none",
  subject: (a) => (a?.subject ? `${a.subject.kind}:${[...a.subject.names].sort().join("+")}` : "none"),
  inbound_answer: (a) => (a?.inbound_answer ? `${a.inbound_answer.kind}:${a.inbound_answer.option ?? ""}` : "none"),
  respondent_mode: (a) => a?.respondent_mode ?? "unspecified",
  abstention: (a) => ((a?.abstain ?? []).length ? "abstain" : "commit"),
  question_form: (a) => a?.question_form ?? "none", temporal: (a) => a?.temporal ?? "unspecified", polarity: (a) => a?.polarity ?? "positive"
};
/** Applicability per field (label guide §4): on the item and EITHER labeler's reading. */
function applicable(field, a, b, input) {
  if (field === "repair_kind") return Boolean(a?.repair_kind || b?.repair_kind || a?.relation?.kind === "repair" || b?.relation?.kind === "repair");
  if (field === "referent") return Boolean(a?.referent || b?.referent);
  if (field === "subject") return Boolean((a?.subject && a.subject.kind !== "addressee") || (b?.subject && b.subject.kind !== "addressee"));
  if (field === "inbound_answer") return Boolean(input?.conversation?.inbound);
  if (field === "respondent_mode") return (a?.respondent_mode ?? "unspecified") !== "unspecified" || (b?.respondent_mode ?? "unspecified") !== "unspecified";
  return true;
}
function agreement(groups, goldA, goldB) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ids = Object.keys(goldA).filter((id) => goldB[id] && byId.has(id));
  const out = { version: LABELS_VERSION, items: ids.length, fields: {} };
  for (const field of Object.keys(FIELD_VALUE)) {
    const pairs = [];
    for (const id of ids) {
      if (field === "gold_outcome") { pairs.push([goldA[id].outcome, goldB[id].outcome]); continue; }
      const a = RP.primaryAct(goldA[id].frame); const b = RP.primaryAct(goldB[id].frame);
      if (!applicable(field, a, b, byId.get(id).item.input)) continue;
      pairs.push([FIELD_VALUE[field](a), FIELD_VALUE[field](b)]);
    }
    const k = kappa(pairs);
    out.fields[field] = { ...k, routing_critical: RP.ROUTING_FIELDS.includes(field), gate_eligible: RP.ROUTING_FIELDS.includes(field) && k.n >= MIN_APPLICABLE_FOR_GATE };
  }
  return out;
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const groupsOf = (file) => RP.renderGroups(JSON.parse(fs.readFileSync(file, "utf8")).items);
  if (arg("--worksheet")) {
    let groups = groupsOf(arg("--worksheet"));
    if (arg("--stratum")) groups = groups.filter((g) => g.strata.includes(arg("--stratum")));
    if (arg("--sample")) { const ids = new Set(JSON.parse(fs.readFileSync(arg("--sample"), "utf8")).headline.map((h) => h.id)); groups = groups.filter((g) => ids.has(g.id)); }
    fs.writeFileSync(arg("--out"), `${worksheet(groups).map((r) => JSON.stringify(r)).join("\n")}\n`);
    return;
  }
  if (arg("--validate")) {
    const i = process.argv.indexOf("--validate");
    const groups = groupsOf(process.argv[i + 1]);
    const r = validateLabels(groups, readJsonl(process.argv[i + 2]), { states: Object.values(LABEL_STATES), registry: loadRegistry() });
    console.log(JSON.stringify({ counts: r.counts, problems: r.problems }, null, 1));
    process.exit(r.problems.length ? 1 : 0);
  }
  if (arg("--agreement")) {
    const i = process.argv.indexOf("--agreement");
    const groups = groupsOf(process.argv[i + 1]);
    const states = Object.values(LABEL_STATES);
    const a = validateLabels(groups, readJsonl(process.argv[i + 2]), { states, registry: loadRegistry() });
    const b = validateLabels(groups, readJsonl(process.argv[i + 3]), { states, registry: loadRegistry() });
    console.log(JSON.stringify({ problems_a: a.problems, problems_b: b.problems, ...agreement(groups, a.gold, b.gold) }, null, 1));
    return;
  }
  console.error("usage: --worksheet <capture.json> --out <file> [--stratum s] [--sample <sample.json>] | --validate <capture.json> <labels.jsonl> | --agreement <capture.json> <a.jsonl> <b.jsonl>");
  process.exit(2);
}
if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { UNLABELABLE, LABELS_VERSION, MIN_APPLICABLE_FOR_GATE, LABEL_STATES, GOLD_OUTCOMES, CLARIFY_SLOTS, CLARIFY_FIELDS, REGISTRY_FILE, worksheet, validateGoldFrame, validateLabels, independenceProblems, excludeSelfLabelled, loadRegistry, kappa, agreement, applicable, FIELD_VALUE };
