#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- the OFFLINE REPLAY HARNESS (the primary Phase-2 measurement; developer tooling only).
//
// CAPTURE plays DEVELOPMENT fixtures through the real production service (shadow on) and keeps, per LOCAL turn,
// exactly what every reader arm is allowed to see plus the code-side state needed to resolve it:
//   input      the observer-safe ReaderInput (v2) -- the player claim c1 in it comes from the captured production
//              chain, identically for every arm
//   bindings   code-side label -> id map (never rendered)
//   context    the real pre-turn DIS snapshot, pre-turn ledger, present actors and the response-policy context
//   l0         the legacy reader v0 frame (arm A) and production's routing record (secondary diagnostic only)
// Fixtures: J15 scripts, the checked-in human trace, the Phase-0.5 scripted scenarios and the ED-30 DEV corpora
// (tools/dialogue-characterize.js collectFixtures). The spent ED-30 blind held-out corpora are never read.
//
// RUN: every arm goes through the SAME pipeline --
//   renderReaderPrompt -> reader -> decodeWire -> nominated lookup -> V0-V3 -> resolveTurn (Phase-1 shadow resolver)
// and the PRIMARY metric compares resolveTurn(arm frame) with resolveTurn(GOLD frame) on the resolved-outcome
// signature (outcomeSignature). Legacy behaviour is not gold; production routing is reported only as a diagnostic.
//
//   node tools/dialogue-reader-replay.js --capture <out.json> [--quick]
//   node tools/dialogue-reader-replay.js --tokens <capture.json> --out <tokens.json>     (pinned tokenizer)
//   node tools/dialogue-reader-replay.js --manifest <capture.json> --out <dev-manifest.json>
//   node tools/dialogue-reader-replay.js --run <capture.json> --labels <gold.jsonl> --arm legacy|local|hosted --out <score.json>
//        [--output json] [--stratum s] [--limit n] [--server-args "..."] [--api openai-chat|anthropic-messages
//         --base-url U --model M --key-env ENV_VAR] [--receipts <file.jsonl>] [--weights '{"human_trace":3,...}']

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const C = require("./dialogue-characterize");
const RF = require("./dialogue-reader-frame");
const W = require("./dialogue-reader-wire");
const { renderReaderPrompt, RENDER_VERSION, SYSTEM_DIGEST } = require("./dialogue-reader-render");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { opaqueRequestTexts } = require("./dialogue-reader-shadow");
const { readTurnAsync, clarificationKind } = require("./dialogue-reader-async");
const { applyNominatedLookup } = require("./dialogue-reader-lexicon");
const { READER_INPUT_VERSION } = require("./dialogue-reader-input");

const REPLAY_VERSION = "yellow-beast-reader-replay@v1";
const sha = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

const RARE_STATE_FILE = path.join(__dirname, "..", "tests", "fixtures", "reader-phase2", "rare-state-scenarios.json");
/** The Phase-2 scripted rare-state stratum (inbound answers, chips, conclude, repairs), in the scenario format. */
function loadRareState() {
  const doc = JSON.parse(fs.readFileSync(RARE_STATE_FILE, "utf8"));
  const ids = doc.option_ids ?? {};
  const resolve = (o) => (typeof o === "string" && o.startsWith("@") ? ids[o.slice(1)] ?? o : o);
  return doc.scenarios.map((sc) => ({ id: `rare/${sc.id}`, kind: "scenario", seed: `p2-${sc.id}`, names: C.SCENE_NAMES, providers: [sc.provider], lines: sc.steps.map((st) => (st.say ? { text: st.say, target: st.target ?? null } : st.coworker_asks ? { coworker_asks: { ...st.coworker_asks, options: (st.coworker_asks.options ?? []).map(resolve) } } : st)) }));
}
/** Every development fixture: the characterized fixtures plus the Phase-2 rare-state stratum. */
function developmentFixtures({ quick = false } = {}) { return [...C.collectFixtures({ quick }), ...loadRareState()]; }
/** Development strata (docs/reader/READER_PHASE2_DATA_PROTOCOL.md). */
function stratumOf(fixtureId) {
  if (fixtureId.startsWith("rare/")) return "scripted_rare_state";
  if (fixtureId.startsWith("j15/4-human-trace") || fixtureId.startsWith("transcripts/")) return "human_trace";
  if (fixtureId.startsWith("j15/")) return "j15";
  if (fixtureId.startsWith("scenario/")) return "scripted_state";
  if (fixtureId.startsWith("dev-novel.jsonl")) return "ed30_dev_novel";
  if (fixtureId.startsWith("dev-corpus.jsonl") || fixtureId.startsWith("dev-h.jsonl")) return "ed30_dev";
  return "other";
}

// ─── capture ─────────────────────────────────────────────────────────────────────────────────────────
async function captureCorpus({ quick = false, fixtures = null, log = () => {} } = {}) {
  const items = [];
  for (const spec of fixtures ?? developmentFixtures({ quick })) {
    for (const provider of spec.providers ?? ["fallback", "garbage"]) {
      let turn = 0;
      await C.playFixture(spec, provider, async (s, requestId, step) => {
        turn += 1;
        const record = s.service.readerReceipts.get(requestId);
        if (!record?.input || !record?.context) return;
        const names = Object.fromEntries(s.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
        items.push({
          id: `${spec.id}#${provider}#${requestId}`, stratum: stratumOf(spec.id), fixture: spec.id, provider, request_id: requestId, text: step.text, target: step.target ?? null,
          input: record.input, bindings: record.context.bindings,
          context: { snapshot: record.context.snapshot ?? null, ledger: record.context.ledger ?? { requests: [] }, present: (record.context.present ?? []).map((p) => ({ id: p.id })), canonical: record.canonical ?? {} },
          names,
          l0: { frame: record.receipt?.frame ?? null, conversion_exact: record.receipt?.conversion?.exact ?? null },
          production: record.production_routing ? { responders: [...(record.production_routing.responder_ids ?? [])].sort(), facet: record.production_routing.frame_predicate ?? null } : null
        });
      }, { serviceOptions: { readerShadow: true } });
    }
    log(spec.id);
  }
  return items;
}

// ─── resolution and the resolved-outcome signature ────────────────────────────────────────────────────
/** resolveTurn for one frame on one captured item, through the same validation path as a model reading. */
function resolveFrame(item, frame) {
  if (!frame) return { verdict: null, resolution: resolveTurn(null, { snapshot: item.context.snapshot, ledger: item.context.ledger }, item.context.present, { verdict: null, input: item.input, bindings: item.bindings }) };
  const looked = applyNominatedLookup(frame, item.input, item.bindings);
  const verdict = RF.validateReaderFrame(looked.frame, looked.input);
  const resolution = resolveTurn(looked.frame, { snapshot: item.context.snapshot, ledger: item.context.ledger }, item.context.present, { verdict, input: looked.input, bindings: looked.bindings, opaque: { request_texts: opaqueRequestTexts(looked.frame, looked.input) }, canonical: item.context.canonical ?? {} });
  return { verdict, resolution, frame: looked.frame };
}
const ARG_KEYS = ["item_id", "place_id", "third_party_subject", "answer_option", "reply_kind", "question_negated", "question_inverted", "subject_ids", "other_id"];
/**
 * The RESOLVED-OUTCOME signature (the Phase-2 primary metric compares these for exact equality): what the turn
 * would DO -- outcome, primary act, facet / claim, relation and its canonical target, addressees, responders,
 * recipients, cardinality, silence, clarification slot, temporal scope, bound arguments, quoted speaker and the
 * request / activity / inbound lifecycle intent. The opaque request_text, reasons and receipts are excluded.
 */
function outcomeSignature(res) {
  if (!res) return { outcome: "none" };
  if (res.disposition === "INVALID" || res.outcome === "invalid") return { outcome: "invalid" };
  const p = res.primary ?? {};
  const lc = res.lifecycle ?? {};
  const sorted = (a) => [...(a ?? [])].sort();
  const args = Object.fromEntries(ARG_KEYS.filter((k) => p.args?.[k] !== undefined).map((k) => [k, Array.isArray(p.args[k]) ? sorted(p.args[k]) : p.args[k]]));
  return {
    outcome: res.outcome, speech_act: p.speech_act ?? null, facet: p.predicate ?? null, claim_facet: p.claim_facet ?? null,
    relation: p.relation ?? null, relation_target: p.relation_target ?? null, reissue_of: p.reissue_of ?? null, reopen: Boolean(p.reopen),
    addressees: sorted(p.addressee?.ids), responders: sorted(res.routing?.responders), recipients: sorted(res.routing?.recipients),
    cardinality: res.routing?.cardinality ?? null, silence: Boolean(res.routing?.silence), clarify_slot: res.clarification?.slot ?? null,
    temporal: p.temporal_scope ?? null, args, quoted_speaker: p.quoted_speaker ?? null,
    lifecycle: { request: lc.request?.intent ?? "none", target: lc.request?.target ?? null, duplicate_of: lc.duplicate_of ?? null, activity: `${lc.activity?.intent ?? "none"}:${lc.activity?.kind ?? ""}`, inbound: lc.inbound?.intent ?? "none", withdraw: lc.withdraw ?? null }
  };
}
function compareOutcomes(a, b) {
  const sa = outcomeSignature(a);
  const sb = outcomeSignature(b);
  const fields = {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) fields[k] = JSON.stringify(sa[k] ?? null) === JSON.stringify(sb[k] ?? null);
  return { equal: Object.values(fields).every(Boolean), fields };
}

// ─── reader field agreement (model frame vs gold frame) ─────────────────────────────────────────────────
const RANK = { question: 3, request: 3, repair: 3, elliptical_continuation: 3, attention_call: 3, self_introduction: 2, greeting: 2, farewell: 2, sarcasm: 1, statement: 1, social_acknowledgment: 0, thanks: 0, answer: 1, aside: 0 };
function primaryAct(frame) { let best = null; for (const a of frame?.acts ?? []) if (!best || (RANK[a.speech_act] ?? 1) >= (RANK[best.speech_act] ?? 1)) best = a; return best; }
const ROUTING_FIELDS = ["speech_act", "address", "facet", "relation", "repair_kind", "referent", "subject", "inbound_answer", "respondent_mode", "abstention"];
const DIAGNOSTIC_FIELDS = ["question_form", "temporal", "polarity", "name_roles", "requested_action", "self_intro", "echo"];
/** Per-field agreement on the primary act. `applicable` follows READER_PHASE2_LABEL_GUIDE.md §4. */
function fieldAgreement(got, gold, input) {
  const g = primaryAct(gold);
  const m = primaryAct(got);
  const out = {};
  const put = (field, applicable, a, b) => { if (applicable) out[field] = JSON.stringify(a ?? null) === JSON.stringify(b ?? null); };
  if (!g) return out;
  const addr = (x) => (x ? { op: x.address?.op ?? "NONE", names: [...(x.address?.names ?? [])].sort() } : null);
  put("speech_act", true, m?.speech_act, g.speech_act);
  put("address", true, addr(m), addr(g));
  put("facet", true, m?.facet, g.facet);
  put("relation", true, m ? { kind: m.relation?.kind, target: m.relation?.target ?? null } : null, { kind: g.relation?.kind, target: g.relation?.target ?? null });
  put("repair_kind", Boolean(g.repair_kind) || g.relation?.kind === "repair", m?.repair_kind ?? null, g.repair_kind ?? null);
  put("referent", Boolean(g.referent), m?.referent?.candidate ?? null, g.referent?.candidate ?? null);
  put("subject", Boolean(g.subject) && g.subject.kind !== "addressee", m?.subject ? { kind: m.subject.kind, names: [...m.subject.names].sort() } : null, { kind: g.subject?.kind, names: [...(g.subject?.names ?? [])].sort() });
  put("inbound_answer", Boolean(input?.conversation?.inbound), m?.inbound_answer ?? null, g.inbound_answer ?? null);
  put("respondent_mode", (g.respondent_mode ?? "unspecified") !== "unspecified", m?.respondent_mode, g.respondent_mode);
  put("abstention", true, (m?.abstain ?? []).length > 0, (g.abstain ?? []).length > 0);
  put("question_form", true, m?.question_form, g.question_form);
  put("temporal", true, m?.temporal, g.temporal);
  put("polarity", true, m?.polarity, g.polarity);
  put("name_roles", true, [...(m?.name_roles ?? [])].map((r) => `${r.name}:${r.role}`).sort(), [...(g.name_roles ?? [])].map((r) => `${r.name}:${r.role}`).sort());
  put("requested_action", true, m?.requested_action?.family ?? null, g.requested_action?.family ?? null);
  put("self_intro", g.speech_act === "self_introduction", m?.self_intro ?? null, g.self_intro ?? null);
  put("echo", Boolean(g.echo), m?.echo ?? null, g.echo ?? null);
  return out;
}

// ─── arms ────────────────────────────────────────────────────────────────────────────────────────────
/** Arm A: legacy reader v0 (the captured frames), through the same validators and resolver. */
function legacyArm(items) {
  return items.map((item) => { const r = resolveFrame(item, item.l0.frame); return { id: item.id, frame: r.frame ?? null, verdict: r.verdict, resolution: r.resolution, raw_wire: item.l0.frame ? W.encodeWire(item.l0.frame, item.input) : null, latency_ms: 0 }; });
}
/** A model arm: readTurnAsync per item (bounded concurrency), receipts kept. */
async function modelArm(items, readerConfig, { concurrency = 1, onItem = null } = {}) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= items.length) return;
      const item = items[i];
      const receipt = await readTurnAsync({ input: item.input, bindings: item.bindings, request_id: item.id, context: item.context }, readerConfig);
      out[i] = { id: item.id, frame: receipt.frame, verdict: receipt.verdict, resolution: receipt.resolution, receipt, raw_wire: receipt.raw_wire, latency_ms: receipt.latency_ms };
      onItem?.(out[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

/** Scores an arm against gold frames ({ id -> gold frame }); production is a secondary diagnostic. */
function scoreArm(items, arm, gold, { weights = null } = {}) {
  const byId = new Map(arm.map((r) => [r.id, r]));
  const rows = [];
  for (const item of items) {
    const goldFrame = gold[item.id];
    if (!goldFrame) continue;
    const got = byId.get(item.id);
    const goldRes = resolveFrame(item, goldFrame).resolution;
    const outcome = compareOutcomes(got?.resolution ?? null, goldRes);
    const fields = got?.frame ? fieldAgreement(got.frame, goldFrame, item.input) : Object.fromEntries(Object.keys(fieldAgreement(goldFrame, goldFrame, item.input)).map((k) => [k, false]));
    const prodDiag = item.production ? { responders: JSON.stringify(outcomeSignature(got?.resolution).responders ?? []) === JSON.stringify(item.production.responders), facet: (outcomeSignature(got?.resolution).facet ?? null) === item.production.facet } : null;
    rows.push({ id: item.id, stratum: item.stratum, outcome_equal: outcome.equal, outcome_fields: outcome.fields, fields, disposition: got?.resolution?.disposition ?? "INVALID", clarification_kind: got?.resolution ? clarificationKind(got.resolution) : null, production: prodDiag, latency_ms: got?.latency_ms ?? null });
  }
  return { rows, summary: summarizeRows(rows, weights) };
}
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
function quantile(list, p) { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; }
/** Percentile bootstrap CI of a quantile (deterministic seed). */
function bootstrapQuantile(list, p, { reps = 2000, seed = 7 } = {}) {
  if (!list.length) return null;
  let x = seed >>> 0;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const qs = [];
  for (let r = 0; r < reps; r += 1) { const sample = Array.from({ length: list.length }, () => list[Math.floor(rnd() * list.length)]); qs.push(quantile(sample, p)); }
  return { estimate: quantile(list, p), lo95: quantile(qs, 0.025), hi95: quantile(qs, 0.975), reps };
}
function summarizeRows(rows, weights = null) {
  const field = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.fields)) { field[k] ??= { n: 0, correct: 0 }; field[k].n += 1; if (v) field[k].correct += 1; }
  for (const v of Object.values(field)) v.pct = pct(v.correct, v.n);
  const strata = {};
  for (const r of rows) { strata[r.stratum] ??= { n: 0, outcome_equal: 0 }; strata[r.stratum].n += 1; if (r.outcome_equal) strata[r.stratum].outcome_equal += 1; }
  for (const v of Object.values(strata)) v.pct = pct(v.outcome_equal, v.n);
  const weighted = weights ? (() => { let num = 0; let den = 0; for (const [k, v] of Object.entries(strata)) { const w = weights[k] ?? 0; if (!v.n || !w) continue; num += w * (v.outcome_equal / v.n); den += w; } return den ? Math.round((1000 * num) / den) / 10 : null; })() : null;
  const lat = rows.map((r) => r.latency_ms).filter((x) => typeof x === "number" && x > 0);
  const disp = {};
  for (const r of rows) disp[r.disposition] = (disp[r.disposition] ?? 0) + 1;
  const kinds = {};
  for (const r of rows) if (r.clarification_kind) kinds[r.clarification_kind] = (kinds[r.clarification_kind] ?? 0) + 1;
  return {
    n: rows.length, resolved_outcome: { correct: rows.filter((r) => r.outcome_equal).length, pct: pct(rows.filter((r) => r.outcome_equal).length, rows.length), weighted_pct: weighted },
    routing_fields: Object.fromEntries(ROUTING_FIELDS.filter((k) => field[k]).map((k) => [k, field[k]])),
    diagnostic_fields: Object.fromEntries(DIAGNOSTIC_FIELDS.filter((k) => field[k]).map((k) => [k, field[k]])),
    strata, dispositions: disp, clarification_kinds: kinds,
    latency_ms: lat.length ? { n: lat.length, p50: quantile(lat, 0.5), p90: quantile(lat, 0.9), p90_bootstrap: bootstrapQuantile(lat, 0.9) } : null
  };
}

/** The identity every score artifact carries: input / render / wire / frame versions and digests. */
function contractIdentity() {
  return { replay: REPLAY_VERSION, reader_input: READER_INPUT_VERSION, render: RENDER_VERSION, render_system_digest: SYSTEM_DIGEST, wire: W.WIRE_VERSION, wire_digest: W.WIRE_DIGEST, frame: RF.READER_FRAME_VERSION };
}

/** Frozen, serializable development item (what a labeler / teacher / local reader sees, plus code-side state). */
function freezeItem(item) {
  const render = renderReaderPrompt(item.input);
  return { id: item.id, stratum: item.stratum, fixture: item.fixture, provider: item.provider, text: item.text, input_digest: sha(item.input), render_user: render.user, render_digest: render.render_digest };
}

// ─── tokens (pinned tokenizer) ───────────────────────────────────────────────────────────────────────
async function tokenDistribution(items, { log = () => {} } = {}) {
  const runtime = require("./dialogue-reader-runtime");
  const server = await runtime.startServer(["--ctx-size", "2048", "--cache-ram", "0", "--no-webui", "--parallel", "1"]);
  try {
    const counts = [];
    const bySignature = new Map();
    for (const item of items) {
      const render = renderReaderPrompt(item.input);
      // Identical renders (the same turn under two wording providers with identical heard wording) count once each
      // anyway: the distribution is over replayed turns.
      const n = bySignature.get(render.user) ?? (await runtime.tokenize(server.endpoint, render.user)).length;
      bySignature.set(render.user, n);
      counts.push({ id: item.id, stratum: item.stratum, dynamic_tokens: n, chars: render.user.length });
    }
    const system = (await runtime.tokenize(server.endpoint, require("./dialogue-reader-render").SYSTEM_TEXT)).length;
    // Wire cost of the legacy frames (the only frames available for every turn before labelling).
    const wire = [];
    for (const item of items) if (item.l0.frame) wire.push((await runtime.tokenize(server.endpoint, W.encodeWire(item.l0.frame, item.input))).length);
    // Early-branch uniqueness: the first token of each routing enum code (with its leading space, as it follows a
    // space on the wire; the speech act starts the line).
    const firstTokens = async (codes, lead) => { const out = {}; for (const c of codes) out[c] = (await runtime.tokenize(server.endpoint, `${lead}${c}`, { pieces: true }))[0]?.piece ?? null; return out; };
    const branch = {};
    for (const [name, codes, lead] of [["speech_act", Object.values(W.SPEECH), ""], ["relation", Object.values(W.RELATION), " "], ["address", Object.values(W.ADDRESS), " "], ["facet", Object.values({ ...W.FACET_CODES, ...W.FACET_SPECIAL_CODES }), " "]]) {
      const first = await firstTokens(codes, lead);
      const groups = {};
      for (const [code, piece] of Object.entries(first)) (groups[piece] ??= []).push(code);
      branch[name] = { codes: codes.length, distinct_first_tokens: Object.keys(groups).length, shared_prefix: Object.values(groups).filter((g) => g.length > 1) };
    }
    const dyn = counts.map((c) => c.dynamic_tokens);
    const strata = {};
    for (const c of counts) (strata[c.stratum] ??= []).push(c.dynamic_tokens);
    return {
      version: "yellow-beast-reader-token-distribution@v1", tokenizer: server.pin, contract: contractIdentity(), turns: counts.length, distinct_renders: bySignature.size,
      dynamic_tokens: { min: Math.min(...dyn), p50: quantile(dyn, 0.5), mean: Math.round(dyn.reduce((a, b) => a + b, 0) / dyn.length), p90: quantile(dyn, 0.9), p95: quantile(dyn, 0.95), max: Math.max(...dyn), within_150_250: pct(dyn.filter((x) => x >= 150 && x <= 250).length, dyn.length), over_300: dyn.filter((x) => x > 300).length },
      by_stratum: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, { n: v.length, p50: quantile(v, 0.5), p90: quantile(v, 0.9), max: Math.max(...v) }])),
      static_system_tokens: system,
      wire_tokens_legacy_frames: { n: wire.length, p50: quantile(wire, 0.5), p90: quantile(wire, 0.9), max: Math.max(...wire) },
      early_branch: branch,
      histogram: (() => { const h = {}; for (const x of dyn) { const b = `${Math.floor(x / 25) * 25}-${Math.floor(x / 25) * 25 + 24}`; h[b] = (h[b] ?? 0) + 1; } return Object.fromEntries(Object.entries(h).sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]))); })(),
      top10: [...counts].sort((a, b) => b.dynamic_tokens - a.dynamic_tokens).slice(0, 10).map(({ id, dynamic_tokens }) => ({ id, dynamic_tokens }))
    };
  } finally { await server.stop(); }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const log = (l) => process.stderr.write(`${l}\n`);
  if (arg("--capture")) {
    const items = await captureCorpus({ quick: process.argv.includes("--quick"), log });
    fs.writeFileSync(arg("--capture"), JSON.stringify({ version: REPLAY_VERSION, contract: contractIdentity(), items }));
    log(`captured ${items.length} turns`);
    return;
  }
  if (arg("--manifest")) {
    // The frozen development manifest: which turns, which stratum, and the digest of exactly what a reader sees.
    const { items } = JSON.parse(fs.readFileSync(arg("--manifest"), "utf8"));
    const frozen = items.map((item) => { const f = freezeItem(item); return { id: f.id, stratum: f.stratum, fixture: f.fixture, provider: f.provider, render_digest: f.render_digest }; });
    const strata = {};
    for (const f of frozen) strata[f.stratum] = (strata[f.stratum] ?? 0) + 1;
    const doc = { version: "yellow-beast-reader-dev-manifest@v1", contract: contractIdentity(), turns: frozen.length, distinct_renders: new Set(frozen.map((f) => f.render_digest)).size, strata, items: frozen };
    fs.writeFileSync(arg("--out"), `${JSON.stringify(doc, null, 1)}\n`);
    log(`manifest: ${frozen.length} turns`);
    return;
  }
  if (arg("--tokens")) {
    const { items } = JSON.parse(fs.readFileSync(arg("--tokens"), "utf8"));
    const dist = await tokenDistribution(items, { log });
    const out = arg("--out");
    if (out) fs.writeFileSync(out, `${JSON.stringify(dist, null, 1)}\n`);
    console.log(JSON.stringify(dist, null, 1));
    return;
  }
  if (arg("--run")) {
    // One bake-off arm over frozen development items with adjudicated (or provisional) gold labels.
    const { items: all } = JSON.parse(fs.readFileSync(arg("--run"), "utf8"));
    const labels = fs.readFileSync(arg("--labels"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));
    const { validateLabels } = require("./dialogue-reader-labels");
    let items = all.filter((i) => labels.some((l) => l.id === i.id));
    if (arg("--stratum")) items = items.filter((i) => i.stratum === arg("--stratum"));
    if (arg("--limit")) items = items.slice(0, Number(arg("--limit")));
    const { frames: gold, problems } = validateLabels(items, labels);
    const armName = arg("--arm");
    const output = arg("--output") === "json" ? "json" : "wire";
    let arm; let identity; let server = null;
    try {
      if (armName === "legacy") { arm = legacyArm(items); identity = { arm: "L0", reader: "legacy-v0" }; }
      else if (armName === "local") {
        const runtime = require("./dialogue-reader-runtime");
        const serverArgs = arg("--server-args") ? arg("--server-args").split(" ") : runtime.PRODUCTION_ARGS;
        server = await runtime.startServer(serverArgs);
        identity = { arm: "E4B", provider: "local-llama.cpp", ...server.pin, server_args: serverArgs, grammar: output === "wire", logprobs: true };
        arm = await modelArm(items, { id: "e4b", provider: "local", model: server.pin.model_file, model_hash: server.pin.model_sha256, quantization: server.pin.quantization, output, grammar: output === "wire", logprobs: true, top_logprobs: 10, timeout_ms: Number(arg("--timeout-ms") ?? 30000), transport: require("./dialogue-reader-async").llamaTransport({ endpoint: server.endpoint }) }, { concurrency: Number(arg("--concurrency") ?? 1), onItem: (r, i) => log(`${i + 1}/${items.length} ${r.receipt.status} ${r.latency_ms}ms`) });
      } else if (armName === "hosted") {
        // DEVELOPMENT-ONLY teacher. The key is read from the named environment variable and never written anywhere.
        const key = process.env[arg("--key-env") ?? ""] ?? null;
        const api = arg("--api") ?? "openai-chat";
        identity = { arm: "T", provider: arg("--provider") ?? api, api, base_url: arg("--base-url") ?? null, model: arg("--model"), temperature: 0, transmitted: "renderReaderPrompt(input) system + user only; no transcript, world state, private state, repository or canon" };
        arm = await modelArm(items, { id: "teacher", provider: identity.provider, model: identity.model, output, timeout_ms: Number(arg("--timeout-ms") ?? 60000), transport: require("./dialogue-reader-async").hostedChatTransport({ api, baseURL: arg("--base-url") ?? undefined, apiKey: key, model: identity.model }) }, { concurrency: Number(arg("--concurrency") ?? 2), onItem: (r, i) => log(`${i + 1}/${items.length} ${r.receipt.status}`) });
      } else throw new Error("--arm legacy|local|hosted");
    } finally { if (server) await server.stop(); }
    const scored = scoreArm(items, arm, gold, { weights: JSON.parse(arg("--weights") ?? "null") });
    const byId = new Map(arm.map((r) => [r.id, r]));
    const doc = { version: REPLAY_VERSION, measured_at: new Date().toISOString(), authoritative: false, contract: contractIdentity(), output, identity, labels: { file: path.basename(arg("--labels")), items: Object.keys(gold).length, problems }, summary: scored.summary, rows: scored.rows.map((r) => ({ ...r, raw_wire: byId.get(r.id)?.raw_wire ?? null, status: byId.get(r.id)?.receipt?.status ?? "read", reason: byId.get(r.id)?.receipt?.reason ?? null })) };
    fs.writeFileSync(arg("--out"), `${JSON.stringify(doc, null, 1)}\n`);
    if (arg("--receipts")) fs.writeFileSync(arg("--receipts"), arm.map((r) => JSON.stringify({ id: r.id, receipt: r.receipt ?? null })).join("\n"));
    console.log(JSON.stringify(scored.summary, null, 1));
    return;
  }
  console.error("usage: --capture <out.json> [--quick] | --tokens <capture.json> --out <file> | --manifest <capture.json> --out <file> | --run <capture.json> --labels <labels.jsonl> --arm legacy|local|hosted --out <score.json>");
  process.exit(2);
}
if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { REPLAY_VERSION, loadRareState, developmentFixtures, stratumOf, captureCorpus, resolveFrame, outcomeSignature, compareOutcomes, fieldAgreement, primaryAct, legacyArm, modelArm, scoreArm, summarizeRows, bootstrapQuantile, quantile, contractIdentity, freezeItem, tokenDistribution, ROUTING_FIELDS, DIAGNOSTIC_FIELDS };
