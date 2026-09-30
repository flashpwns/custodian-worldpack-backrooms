#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- GOLD LABEL TOOLING (docs/reader/READER_PHASE2_LABEL_GUIDE.md). Developer tooling only.
//
//   worksheet   export the frozen development items a labeler sees: the SAME model-facing render the readers get
//               (renderReaderPrompt), nothing else -- no transcript, no canonical state, no legacy reading
//   validate    import a label file ({ id, labeler, gold_wire, abstain_ok? } JSONL): every label must decode (V0)
//               against the item's frozen ReaderInput; the frozen render digest must match
//   agreement   per-field agreement between two labelers on the SAME items: raw agreement, Cohen's kappa and the
//               prevalence-adjusted bias-adjusted kappa (PABAK), with applicable counts; fields < 60 applicable are
//               marked report-only (never acceptance-gated)
//
//   node tools/dialogue-reader-labels.js --worksheet <capture.json> --out <worksheet.jsonl> [--stratum s]
//   node tools/dialogue-reader-labels.js --agreement <capture.json> <labels-a.jsonl> <labels-b.jsonl>

const fs = require("node:fs");
const W = require("./dialogue-reader-wire");
const { renderReaderPrompt } = require("./dialogue-reader-render");
const RP = require("./dialogue-reader-replay");

const LABELS_VERSION = "yellow-beast-reader-labels@v1";
const MIN_APPLICABLE_FOR_GATE = 60;
const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));

function worksheet(items) {
  return items.map((item) => { const r = renderReaderPrompt(item.input); return { id: item.id, stratum: item.stratum, render_digest: r.render_digest, render_user: r.user, gold_wire: null, labeler: null, notes: null }; });
}

/** Decodes every label against its frozen item; returns { frames: {id -> frame}, problems: [...] }. */
function validateLabels(items, labels) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const frames = {};
  const problems = [];
  for (const l of labels) {
    const item = byId.get(l.id);
    if (!item) { problems.push({ id: l.id, problem: "unknown_item" }); continue; }
    if (l.render_digest && l.render_digest !== renderReaderPrompt(item.input).render_digest) { problems.push({ id: l.id, problem: "render_changed_since_labelling" }); continue; }
    const d = W.decodeWire(l.gold_wire, item.input);
    if (!d.ok) { problems.push({ id: l.id, problem: "label_fails_V0", errors: d.errors.map((e) => e.code) }); continue; }
    frames[l.id] = d.frame;
  }
  return { frames, problems };
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
function agreement(items, framesA, framesB) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ids = Object.keys(framesA).filter((id) => framesB[id] && byId.has(id));
  const out = { version: LABELS_VERSION, items: ids.length, fields: {} };
  for (const field of Object.keys(FIELD_VALUE)) {
    const pairs = [];
    for (const id of ids) {
      const a = RP.primaryAct(framesA[id]); const b = RP.primaryAct(framesB[id]);
      if (!applicable(field, a, b, byId.get(id).input)) continue;
      pairs.push([FIELD_VALUE[field](a), FIELD_VALUE[field](b)]);
    }
    const k = kappa(pairs);
    out.fields[field] = { ...k, routing_critical: RP.ROUTING_FIELDS.includes(field), gate_eligible: k.n >= MIN_APPLICABLE_FOR_GATE };
  }
  return out;
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  if (arg("--worksheet")) {
    let { items } = JSON.parse(fs.readFileSync(arg("--worksheet"), "utf8"));
    if (arg("--stratum")) items = items.filter((i) => i.stratum === arg("--stratum"));
    fs.writeFileSync(arg("--out"), `${worksheet(items).map((r) => JSON.stringify(r)).join("\n")}\n`);
    return;
  }
  if (arg("--agreement")) {
    const i = process.argv.indexOf("--agreement");
    const { items } = JSON.parse(fs.readFileSync(process.argv[i + 1], "utf8"));
    const a = validateLabels(items, readJsonl(process.argv[i + 2]));
    const b = validateLabels(items, readJsonl(process.argv[i + 3]));
    console.log(JSON.stringify({ problems_a: a.problems, problems_b: b.problems, ...agreement(items, a.frames, b.frames) }, null, 1));
    return;
  }
  console.error("usage: --worksheet <capture.json> --out <file> | --agreement <capture.json> <a.jsonl> <b.jsonl>");
  process.exit(2);
}
if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { LABELS_VERSION, MIN_APPLICABLE_FOR_GATE, worksheet, validateLabels, kappa, agreement, FIELD_VALUE };
