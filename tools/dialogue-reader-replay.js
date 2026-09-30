#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- the OFFLINE REPLAY HARNESS (the primary Phase-2 measurement; developer tooling only).
//
// CAPTURE plays DEVELOPMENT fixtures through the real production service (shadow on) and keeps, per LOCAL turn,
// exactly what every reader arm is allowed to see plus the code-side state needed to resolve it:
//   input      the observer-safe ReaderInput -- the player claim c1 in it comes from the captured production chain,
//              identically for every arm
//   bindings   code-side label -> id map (never rendered)
//   context    the real pre-turn DIS snapshot, pre-turn ledger, present actors and the response-policy context
//   l0         the legacy reader v0 frame (arm A) and production's routing record (secondary diagnostic only)
//   context_dependent / context_available   an ED-30 probe authored to need prior conversation is replayed WITHOUT
//              it (context_available false); such items are diagnostic only, never headline
// Fixtures: J15 scripts, the checked-in human trace, the Phase-0.5 scripted scenarios, the ED-30 DEV corpora
// (tools/dialogue-characterize.js collectFixtures) and the Phase-2 rare-state stratum. The spent ED-30 blind held-out
// corpora are never read.
//
// Step 0.1:
//   * The measurement UNIT is a DISTINCT FROZEN RENDER (renderGroups): source rows that render identically (two
//     wording providers, a repeated scenario line) are one linguistic item; every occurrence is kept in the mapping.
//   * Sampling is deterministic and STRATIFIED (never "the first N capture rows"). The headline teacher sample is a
//     frozen, preregistered file (teacherDevSample; docs/acceptance/reader-phase2/teacher-dev-sample.json).
//   * Scoring never gives INVALID output outcome credit; transport failure is not a semantic error; gold is
//     re-validated against the frozen contract (dialogue-reader-labels.js validateGoldFrame) before any comparison.
//
// RUN: every arm goes through the SAME pipeline --
//   renderReaderPrompt -> reader -> decodeWire -> nominated lookup -> V0-V3 -> resolveTurn (Phase-1 shadow resolver)
// and the PRIMARY metric compares resolveTurn(arm frame) with resolveTurn(GOLD frame) on the resolved-outcome
// signature (outcomeSignature). Legacy behaviour is not gold; production routing is reported only as a diagnostic.
//
//   node tools/dialogue-reader-replay.js --capture <out.json> [--quick]
//   node tools/dialogue-reader-replay.js --tokens <capture.json> --out <tokens.json>     (pinned tokenizer)
//   node tools/dialogue-reader-replay.js --manifest <capture.json> --out <dev-manifest.json>
//   node tools/dialogue-reader-replay.js --teacher-sample <capture.json> --out <teacher-dev-sample.json>
//   node tools/dialogue-reader-replay.js --shapes <capture.json>                          (rare-state shape counts)
//   node tools/dialogue-reader-replay.js --run <capture.json> --labels <gold.jsonl> --arm legacy|local|hosted --out <score.json>
//        (--sample <teacher-dev-sample.json> | --limit n [stratified, non-headline]) [--output json] [--stratum s]
//        hosted: --api openai-chat|anthropic-messages --base-url U --model M --key-env ENV_VAR --family F
//                --receipts <file.jsonl> --confirm-egress [--include-human-trace] [--retention "<text>"]
//                [--max-output-tokens n] [--temperature t] [--reasoning-effort e] [--reasoning-budget n]
//                [--max-tokens-param max_tokens|max_completion_tokens]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const C = require("./dialogue-characterize");
const RF = require("./dialogue-reader-frame");
const W = require("./dialogue-reader-wire");
const { renderReaderPrompt, RENDER_VERSION, SYSTEM_DIGEST, SYSTEM_TEXT } = require("./dialogue-reader-render");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { opaqueRequestTexts } = require("./dialogue-reader-shadow");
const { readTurnAsync, clarificationKind } = require("./dialogue-reader-async");
const { applyNominatedLookup, LEXICON_VERSION } = require("./dialogue-reader-lexicon");
const { READER_INPUT_VERSION } = require("./dialogue-reader-input");

const REPLAY_VERSION = "yellow-beast-reader-replay@v2";
const sha = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

const RARE_STATE_FILE = path.join(__dirname, "..", "tests", "fixtures", "reader-phase2", "rare-state-scenarios.json");
/** The Phase-2 scripted rare-state stratum (inbound answers, chips, conclude, repairs), in the scenario format. */
function loadRareState() {
  const doc = JSON.parse(fs.readFileSync(RARE_STATE_FILE, "utf8"));
  const ids = doc.option_ids ?? {};
  const resolve = (o) => (typeof o === "string" && o.startsWith("@") ? ids[o.slice(1)] ?? o : o);
  return doc.scenarios.map((sc) => ({ id: `rare/${sc.id}`, kind: "scenario", seed: `p2-${sc.id}`, names: C.SCENE_NAMES, providers: [sc.provider], lines: sc.steps.map((st) => (st.say ? { text: st.say, target: st.target ?? null, ...(st.reply ? { coverage_tag: st.reply } : {}) } : st.coworker_asks ? { coworker_asks: { ...st.coworker_asks, options: (st.coworker_asks.options ?? []).map(resolve) } } : st)) }));
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
const PROBE_STRATA = Object.freeze(["ed30_dev", "ed30_dev_novel"]);

// ─── capture ─────────────────────────────────────────────────────────────────────────────────────────
async function captureCorpus({ quick = false, fixtures = null, log = () => {} } = {}) {
  const items = [];
  for (const spec of fixtures ?? developmentFixtures({ quick })) {
    for (const provider of spec.providers ?? ["fallback", "garbage"]) {
      await C.playFixture(spec, provider, async (s, requestId, step) => {
        const record = s.service.readerReceipts.get(requestId);
        if (!record?.input || !record?.context) return;
        const names = Object.fromEntries(s.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
        items.push({
          id: `${spec.id}#${provider}#${requestId}`, stratum: stratumOf(spec.id), fixture: spec.id, provider, request_id: requestId, text: step.text, target: step.target ?? null,
          // An ED-30 probe authored to need prior conversation is replayed without it (collectFixtures).
          context_dependent: Boolean(spec.context_dependent), context_available: spec.kind !== "probe",
          coverage_tag: step.coverage_tag ?? null,
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

// ─── distinct renders (the labelling / measurement unit) ──────────────────────────────────────────────
// A render seen in several strata takes the first stratum of this order as its primary stratum (closest to real
// play first); every stratum it occurs in is kept.
const STRATUM_PRIORITY = Object.freeze(["human_trace", "j15", "scripted_state", "scripted_rare_state", "ed30_dev_novel", "ed30_dev", "other"]);
/** Frozen, serializable development item (what a labeler / teacher / local reader sees, plus code-side state). */
function freezeItem(item) {
  const render = renderReaderPrompt(item.input);
  return { id: item.id, stratum: item.stratum, fixture: item.fixture, provider: item.provider, text: item.text, input_digest: sha(item.input), render_user: render.user, render_digest: render.render_digest };
}
/**
 * Groups source rows by frozen render digest. Each group: { id, render_digest, item (representative: the first
 * occurrence by id; its code-side context resolves every reading of the group), occurrences [{id, stratum, fixture,
 * provider}], strata, primary_stratum, clusters (fixtures), context_missing (every occurrence is a context-dependent
 * probe replayed without its context) }.
 */
function renderGroups(items) {
  const map = new Map();
  for (const item of items) {
    const digest = renderReaderPrompt(item.input).render_digest;
    if (!map.has(digest)) map.set(digest, []);
    map.get(digest).push(item);
  }
  const groups = [...map.entries()].map(([digest, list]) => {
    const occ = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const strata = [...new Set(occ.map((o) => o.stratum))].sort((a, b) => STRATUM_PRIORITY.indexOf(a) - STRATUM_PRIORITY.indexOf(b));
    return {
      id: `rg-${digest.slice(0, 16)}`, render_digest: digest, item: occ[0],
      occurrences: occ.map((o) => ({ id: o.id, stratum: o.stratum, fixture: o.fixture, provider: o.provider })),
      strata, primary_stratum: strata[0], clusters: [...new Set(occ.map((o) => o.fixture))].sort(),
      context_dependent: occ.some((o) => o.context_dependent), context_missing: occ.every((o) => o.context_dependent && !o.context_available)
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (new Set(groups.map((g) => g.id)).size !== groups.length) throw new Error("render group id collision");
  return groups;
}
const normText = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** Distinctness report: source rows vs player turns vs texts vs renders (definitions recorded with the numbers). */
function corpusCounts(items, groups = renderGroups(items)) {
  const byStratum = {};
  for (const i of items) { byStratum[i.stratum] ??= { source_rows: 0 }; byStratum[i.stratum].source_rows += 1; }
  for (const g of groups) { const s = byStratum[g.primary_stratum]; s.distinct_renders = (s.distinct_renders ?? 0) + 1; if (headlineEligible(g)) s.headline_eligible_renders = (s.headline_eligible_renders ?? 0) + 1; }
  return {
    definitions: {
      source_rows: "captured LOCAL turns (every fixture x wording provider)",
      distinct_player_turns: "distinct (fixture, typed text, chip target): the same line typed at the same place in a fixture under another provider or repeated is one player turn",
      distinct_player_turn_positions: "distinct (fixture, request position)",
      distinct_texts: "distinct typed lines after trim, lower case and whitespace collapse",
      distinct_renders: "distinct frozen render digests (system digest + model-facing user render)",
      headline_eligible_renders: "distinct renders excluding context-dependent probes replayed without their authored context"
    },
    source_rows: items.length,
    distinct_player_turns: new Set(items.map((i) => `${i.fixture}\u0000${i.text}\u0000${i.target ?? ""}`)).size,
    distinct_player_turn_positions: new Set(items.map((i) => `${i.fixture}#${i.request_id}`)).size,
    distinct_texts: new Set(items.map((i) => normText(i.text))).size,
    distinct_texts_raw: new Set(items.map((i) => i.text)).size,
    distinct_renders: groups.length,
    headline_eligible_renders: groups.filter(headlineEligible).length,
    context_dependent_source_rows: items.filter((i) => i.context_dependent && !i.context_available).length,
    context_dependent_probes: new Set(items.filter((i) => i.context_dependent && !i.context_available).map((i) => i.fixture)).size,
    context_missing_renders: groups.filter((g) => g.context_missing).length,
    by_stratum: byStratum
  };
}

// ─── deterministic stratified sampling ────────────────────────────────────────────────────────────────
const SAMPLE_SEED = "yellow-beast-reader-phase2-step0.1";
/** Stable pseudo-random order of groups within a stratum: SHA-256(seed, render digest). */
const orderKey = (g, seed = SAMPLE_SEED) => sha(`${seed}\u0000${g.render_digest}`);
function stratumOrder(groups, seed = SAMPLE_SEED) {
  const by = {};
  for (const g of groups) (by[g.primary_stratum] ??= []).push(g);
  for (const k of Object.keys(by)) by[k].sort((a, b) => (orderKey(a, seed) < orderKey(b, seed) ? -1 : 1));
  return by;
}
/**
 * Deterministic proportional-allocation stratified sample of n distinct renders (largest remainder; at least one per
 * non-empty stratum when n allows). This is what --limit means: NEVER the first n capture rows. A --limit run is a
 * smoke / diagnostic run, never a headline measurement.
 */
function stratifiedSample(groups, n, { seed = SAMPLE_SEED } = {}) {
  const by = stratumOrder(groups, seed);
  const strata = Object.keys(by).sort((a, b) => STRATUM_PRIORITY.indexOf(a) - STRATUM_PRIORITY.indexOf(b));
  const total = groups.length;
  const take = Math.min(n, total);
  const quota = Object.fromEntries(strata.map((s) => [s, Math.min(by[s].length, take >= strata.length ? 1 : 0)]));
  let left = take - Object.values(quota).reduce((a, b) => a + b, 0);
  const ideal = Object.fromEntries(strata.map((s) => [s, (take * by[s].length) / total]));
  for (const s of strata) { const add = Math.max(0, Math.min(by[s].length - quota[s], Math.floor(ideal[s]) - quota[s], left)); quota[s] += add; left -= add; }
  const rem = strata.map((s) => [s, ideal[s] - Math.floor(ideal[s])]).sort((a, b) => b[1] - a[1] || STRATUM_PRIORITY.indexOf(a[0]) - STRATUM_PRIORITY.indexOf(b[0]));
  while (left > 0) { let moved = false; for (const [s] of rem) { if (left > 0 && quota[s] < by[s].length) { quota[s] += 1; left -= 1; moved = true; } } if (!moved) break; }
  return strata.flatMap((s) => by[s].slice(0, quota[s]));
}
/** Headline-eligible: not a context-dependent probe replayed without its authored context. */
function headlineEligible(g) { return !g.context_missing; }

/**
 * The PREREGISTERED development teacher sample (READER_PHASE2_PREREGISTRATION.md §3). Frozen BEFORE any teacher is
 * chosen or run. Rule: a CENSUS of every headline-eligible distinct render (inclusion probability 1 in every stratum),
 * each render counted once (unweighted) -- no stratum is up-weighted, so a stratum's influence is its share of
 * distinct renders. Context-missing probes are listed as diagnostic-only.
 */
const TEACHER_SAMPLE_PLAN = Object.freeze({
  version: "yellow-beast-reader-teacher-dev-sample@v1",
  unit: "distinct frozen render (render digest)",
  selection: "census of every headline-eligible distinct render: inclusion probability 1 in every stratum",
  exclusions: "context-dependent ED-30 probes replayed without their authored context (diagnostic only)",
  minimum_valid_adjudicated: 300,
  estimator: "unweighted proportion over headline renders with ADJUDICATED_GOLD (each distinct render counts once)",
  interval: "Wilson 95% (reported) and a cluster bootstrap 95% (2,000 reps, seed 7) resampling fixtures (sessions / probes), which accounts for renders of one session being correlated; the cluster interval is the one interpreted",
  per_stratum: "unweighted per-stratum proportions with Wilson intervals are always reported; strata with < 60 renders are reported, never interpreted alone",
  label_loss_rule: "every headline render gets an adjudicated label (ACCEPT or EXPECTED_CLARIFY); a render the adjudicator declares UNLABELABLE is excluded with its written reason; if fewer than 300 remain the run does not start",
  transport_rule: "transport failures are retried under the preregistered policy; if more than 2% of headline renders are transport_unavailable after retries the run is VOID (not scored) and is repeated in full",
  stop_rule: "one run over the whole frozen sample, no interim looks. STOP (no E4B work) if the cluster-bootstrap point estimate of resolved-outcome accuracy < 80% or primary speech-act accuracy < 85%; G2 requires the point estimates in §5",
  seed: SAMPLE_SEED
});
function teacherDevSample(groups) {
  const headline = groups.filter(headlineEligible);
  const excluded = groups.filter((g) => !headlineEligible(g));
  const counts = {};
  for (const g of headline) counts[g.primary_stratum] = (counts[g.primary_stratum] ?? 0) + 1;
  const row = (g) => ({ id: g.id, render_digest: g.render_digest, primary_stratum: g.primary_stratum, strata: g.strata, clusters: g.clusters, occurrences: g.occurrences.length });
  return {
    ...TEACHER_SAMPLE_PLAN, contract: contractIdentity(), frozen_at: "Reader Phase 2 Step 0.1 (before any gold label, teacher choice or teacher run)",
    headline_renders: headline.length, by_stratum: counts, shares: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round((1000 * v) / headline.length) / 10])),
    headline: headline.map(row), diagnostic_only: excluded.map((g) => ({ ...row(g), reason: "context_dependent_probe_without_context" }))
  };
}

/**
 * The independent ~100-item doctrine review of resolveTurn(gold) (data protocol §6), drawn after adjudication. It
 * OVERSAMPLES renders whose gold primary facet differs from the legacy (L0) primary facet -- the capture's knowledge
 * flags were generated for the legacy facet, so knower selection may be under-specified there -- taking all of them up
 * to `cap`, then fills to `size` with a stratified sample of the rest. The two groups are returned apart.
 */
function doctrineReviewSample(groups, gold, { size = 100, cap = 60, seed = SAMPLE_SEED } = {}) {
  const labelled = groups.filter((g) => gold[g.id]?.frame);
  const legacyFacet = (g) => primaryAct(g.item.l0?.frame)?.facet ?? null;
  const differs = labelled.filter((g) => primaryAct(gold[g.id].frame)?.facet !== legacyFacet(g)).sort((a, b) => (orderKey(a, seed) < orderKey(b, seed) ? -1 : 1));
  const facetDiffers = differs.slice(0, cap);
  const rest = labelled.filter((g) => !facetDiffers.includes(g));
  const others = stratifiedSample(rest, Math.max(0, size - facetDiffers.length), { seed });
  const row = (g) => ({ id: g.id, primary_stratum: g.primary_stratum, gold_facet: primaryAct(gold[g.id].frame)?.facet ?? null, legacy_facet: legacyFacet(g) });
  return { facet_differs: facetDiffers.map(row), facet_differs_total: differs.length, others: others.map(row) };
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
 * The RESOLVED-OUTCOME signature: what the turn would DO -- outcome, primary act, facet / claim, relation and its
 * canonical target, addressees, responders, recipients, cardinality, silence, clarification slot, temporal scope,
 * bound arguments, quoted speaker and the request / activity / inbound lifecycle intent. The opaque request_text,
 * reasons and receipts are excluded. An INVALID resolution has NO signature (null): it is never comparable.
 */
function outcomeSignature(res) {
  if (!res || res.disposition === "INVALID" || res.outcome === "invalid") return null;
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
/** Compares two resolutions. Either side invalid -> never equal (comparable: false). */
function compareOutcomes(a, b) {
  const sa = outcomeSignature(a);
  const sb = outcomeSignature(b);
  if (!sa || !sb) return { equal: false, comparable: false, fields: {} };
  const fields = {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) fields[k] = JSON.stringify(sa[k] ?? null) === JSON.stringify(sb[k] ?? null);
  return { equal: Object.values(fields).every(Boolean), comparable: true, fields };
}

// ─── reader field agreement (model frame vs gold frame) ─────────────────────────────────────────────────
const RANK = { question: 3, request: 3, repair: 3, elliptical_continuation: 3, attention_call: 3, self_introduction: 2, greeting: 2, farewell: 2, sarcasm: 1, statement: 1, social_acknowledgment: 0, thanks: 0, answer: 1, aside: 0 };
function primaryAct(frame) { let best = null; for (const a of frame?.acts ?? []) if (!best || (RANK[a.speech_act] ?? 1) >= (RANK[best.speech_act] ?? 1)) best = a; return best; }
// Routing fields are reported per field with Wilson intervals on the development set; the teacher G2 thresholds
// apply to them where n_applicable >= 60. On the sealed set they are DIAGNOSTIC (preregistration §6). The diagnostic
// fields are never gated anywhere.
const ROUTING_FIELDS = ["speech_act", "address", "facet", "relation", "repair_kind", "referent", "subject", "inbound_answer", "respondent_mode", "abstention"];
const DIAGNOSTIC_FIELDS = ["question_form", "temporal", "polarity", "name_roles", "requested_action", "self_intro", "echo"];
/** Per-field agreement on the primary act. `applicable` follows READER_PHASE2_LABEL_GUIDE.md §4. */
function fieldAgreement(got, gold, input) {
  const g = primaryAct(gold);
  const m = primaryAct(got);
  const out = {};
  const put = (field, applicable, a, b) => { if (applicable) out[field] = Boolean(m) && JSON.stringify(a ?? null) === JSON.stringify(b ?? null); };
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
// Units are render groups ({ id, item }) or raw items ({ id, input, ... }); a group reads its representative item.
const unitItem = (u) => u.item ?? u;
/** Arm A: legacy reader v0 (the captured frames), through the same validators and resolver. */
function legacyArm(units) {
  return units.map((u) => {
    const item = unitItem(u);
    if (!item.l0.frame) return { id: u.id, status: "invalid", reason: "no_legacy_frame", frame: null, verdict: null, resolution: null, raw_wire: null, latency_ms: 0, attempts: 1 };
    const r = resolveFrame(item, item.l0.frame);
    return { id: u.id, status: "read", frame: r.frame ?? null, verdict: r.verdict, resolution: r.resolution, raw_wire: W.encodeWire(item.l0.frame, item.input), latency_ms: 0, attempts: 1 };
  });
}

/**
 * PREREGISTERED TRANSPORT RETRY POLICY (Step 0.1): a transient transport failure -- timeout, network error, HTTP 408 /
 * 409 / 425 / 429 / 5xx -- is retried up to 3 more times after 2 s, 4 s and 8 s. A non-transient failure (HTTP 400 /
 * 401 / 403 / 404 / 422, missing credential) is not retried. After the last attempt the unit is
 * `transport_unavailable`: a transport outcome, never a semantic error. A decoded-but-wrong or undecodable reply is
 * never retried (that would select among samples). A PROVIDER TERMINATION (Step 0.1B: truncation / max-token
 * exhaustion, refusal / content filter) is not retried either: it is a `provider_void`, accounted with transport voids.
 */
const RETRY_POLICY = Object.freeze({ max_retries: 3, backoff_ms: [2000, 4000, 8000], transient: ["timeout", "network", "HTTP_408", "HTTP_409", "HTTP_425", "HTTP_429", "HTTP_5xx"] });
function transientFailure(receipt) {
  if (receipt?.status !== "reader_unavailable") return false;
  if (receipt.reason === "timeout") return true;
  if (receipt.reason === "provider_termination") return false;
  const code = String(receipt.error ?? "");
  if (/^HTTP_(408|409|425|429|5\d\d)$/.test(code)) return true;
  if (/^HTTP_\d+$/.test(code) || /^PROVIDER_/.test(code) || code === "AUTH_MISSING" || code === "BUDGET_MISSING" || receipt.reason === "no_transport") return false;
  return true; // network-level failures (ECONNRESET, fetch failed, ...)
}
/** A model arm: readTurnAsync per unit (bounded concurrency) under the retry policy; receipts kept. */
async function modelArm(units, readerConfig, { concurrency = 1, onItem = null, onAttempt = null, retry = RETRY_POLICY, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const out = new Array(units.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next; next += 1;
      if (i >= units.length) return;
      const u = units[i];
      const item = unitItem(u);
      let receipt = null;
      let attempts = 0;
      const tries = [];
      for (;;) {
        attempts += 1;
        receipt = await readTurnAsync({ input: item.input, bindings: item.bindings, request_id: u.id, context: item.context }, readerConfig);
        tries.push({ status: receipt.status, reason: receipt.reason ?? null, error: receipt.error ?? null, latency_ms: receipt.latency_ms });
        // Per-request hook (hosted receipts are made durable here, before the next request is sent).
        if (onAttempt) await onAttempt({ unit: u, item, receipt, attempt: attempts });
        if (!transientFailure(receipt) || attempts > (retry?.max_retries ?? 0)) break;
        await sleep(retry.backoff_ms[Math.min(attempts - 1, retry.backoff_ms.length - 1)]);
      }
      out[i] = { id: u.id, status: receipt.status, reason: receipt.reason ?? null, frame: receipt.frame, verdict: receipt.verdict, resolution: receipt.resolution, receipt, raw_wire: receipt.raw_wire, latency_ms: receipt.latency_ms, attempts, retry_count: attempts - 1, tries };
      onItem?.(out[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

/** How an arm reading is classified before any semantic comparison. */
function armStatus(got) {
  if (!got) return "missing";
  if (got.status === "reader_unavailable") return got.reason === "provider_termination" || got.receipt?.reason === "provider_termination" ? "provider_void" : "transport_unavailable";
  if (got.status === "invalid" || !got.frame || !got.resolution || got.resolution.error || got.resolution.outcome === "invalid" || RF.dispositionOf(got.verdict) === RF.DISPOSITIONS.INVALID) return "invalid_output";
  return "read";
}

/**
 * Scores an arm against VALIDATED gold ({ id -> { frame, outcome: ACCEPT|EXPECTED_CLARIFY, expected_clarify } } from
 * dialogue-reader-labels.js validateLabels). Gold is re-validated here; a gold row that no longer passes the frozen
 * contract is excluded (gold_invalid), never compared. Per row:
 *   transport_unavailable  no semantic credit and not a semantic error: excluded from the semantic denominator,
 *                          counted and reported separately (and as wrong in the conservative figure)
 *   provider_void          the provider did not complete the reply (truncation / max tokens, refusal / content filter;
 *                          Step 0.1B): accounted exactly like transport_unavailable, in the void rate
 *   invalid_output         decode / V0 failure: WRONG, never outcome credit, every field wrong
 *   read, gold ACCEPT      correct iff the arm resolved (no clarification) with an identical outcome signature;
 *                          an accepted-but-different reading is FALSE-CONFIDENT
 *   read, gold EXPECTED_CLARIFY  correct iff the arm clarifies on the expected slot; an accepted reading is FALSE-CONFIDENT
 */
function scoreArm(units, arm, gold, { weights = null, clusterOf = (u) => u.clusters?.[0] ?? unitItem(u).fixture ?? u.id } = {}) {
  const { validateGoldFrame } = require("./dialogue-reader-labels");
  const byId = new Map(arm.map((r) => [r.id, r]));
  const rows = [];
  for (const u of units) {
    const g = gold[u.id];
    if (!g) continue;
    const item = unitItem(u);
    const stratum = u.primary_stratum ?? item.stratum;
    const base = { id: u.id, stratum, cluster: clusterOf(u), gold_outcome: g.outcome ?? null };
    const wire = g.wire ?? g.label?.gold_wire ?? (g.frame ? W.encodeWire(g.frame, item.input) : null);
    const gv = wire ? validateGoldFrame(item, wire, g.outcome, g.expected_clarify ?? null) : { ok: false, problem: "gold_frame_missing" };
    if (!gv.ok) { rows.push({ ...base, status: "gold_invalid", gold_problem: gv.problem, correct: false, scored: false }); continue; }
    const got = byId.get(u.id);
    const status = armStatus(got);
    const emptyFields = Object.fromEntries(Object.keys(fieldAgreement(gv.frame, gv.frame, item.input)).map((k) => [k, false]));
    if (status === "transport_unavailable" || status === "provider_void" || status === "missing") { rows.push({ ...base, status, correct: false, scored: false, accepted: false, false_confident: false, fields: emptyFields, retry_count: got?.retry_count ?? 0, ...(status === "provider_void" ? { provider_termination: got?.receipt?.transport?.termination ?? null } : {}) }); continue; }
    if (status === "invalid_output") { rows.push({ ...base, status, correct: false, scored: true, accepted: false, false_confident: false, outcome_equal: false, fields: emptyFields, disposition: "INVALID", latency_ms: got?.latency_ms ?? null, retry_count: got?.retry_count ?? 0 }); continue; }
    const res = got.resolution;
    const accepted = res.outcome === "resolved";
    const clarified = res.outcome === "clarify";
    const cmp = compareOutcomes(res, gv.resolution);
    const correct = g.outcome === "ACCEPT" ? accepted && cmp.equal : clarified && res.clarification?.slot === g.expected_clarify?.slot;
    const prodDiag = item.production ? { responders: JSON.stringify(outcomeSignature(res)?.responders ?? []) === JSON.stringify(item.production.responders), facet: (outcomeSignature(res)?.facet ?? null) === item.production.facet } : null;
    rows.push({ ...base, status, scored: true, correct, outcome_equal: correct, accepted, false_confident: accepted && !correct, outcome_fields: cmp.fields, fields: fieldAgreement(got.frame, gv.frame, item.input), disposition: RF.dispositionOf(got.verdict), clarification_kind: clarificationKind(res), production: prodDiag, latency_ms: got.latency_ms ?? null, retry_count: got.retry_count ?? 0 });
  }
  return { rows, summary: summarizeRows(rows, weights) };
}
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
function quantile(list, p) { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; }
function xorshift(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
/** Percentile bootstrap CI of a quantile (deterministic seed). */
function bootstrapQuantile(list, p, { reps = 2000, seed = 7 } = {}) {
  if (!list.length) return null;
  const rnd = xorshift(seed);
  const qs = [];
  for (let r = 0; r < reps; r += 1) { const sample = Array.from({ length: list.length }, () => list[Math.floor(rnd() * list.length)]); qs.push(quantile(sample, p)); }
  return { estimate: quantile(list, p), lo95: quantile(qs, 0.025), hi95: quantile(qs, 0.975), reps };
}
/** Wilson score interval (95%) for k successes of n. */
function wilson(k, n, z = 1.959964) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const r = (x) => Math.round(x * 1000) / 10;
  return { lo95: r((c - h) / d), hi95: r((c + h) / d) };
}
/** Cluster bootstrap (resample clusters with replacement) of a proportion; deterministic seed. */
function clusterBootstrap(rows, pick, { reps = 2000, seed = 7 } = {}) {
  const clusters = new Map();
  for (const r of rows) { const c = clusters.get(r.cluster) ?? { k: 0, n: 0 }; c.n += 1; if (pick(r)) c.k += 1; clusters.set(r.cluster, c); }
  const list = [...clusters.values()];
  if (!list.length) return null;
  const rnd = xorshift(seed);
  const est = [];
  for (let i = 0; i < reps; i += 1) { let k = 0; let n = 0; for (let j = 0; j < list.length; j += 1) { const c = list[Math.floor(rnd() * list.length)]; k += c.k; n += c.n; } est.push(n ? k / n : 0); }
  const r = (x) => Math.round(x * 1000) / 10;
  const k = list.reduce((s, c) => s + c.k, 0); const n = list.reduce((s, c) => s + c.n, 0);
  return { estimate: r(k / n), lo95: r(quantile(est, 0.025)), hi95: r(quantile(est, 0.975)), clusters: list.length, reps };
}
function summarizeRows(rows, weights = null) {
  const scored = rows.filter((r) => r.scored);
  const count = (list, f) => list.filter(f).length;
  const field = {};
  for (const r of scored) for (const [k, v] of Object.entries(r.fields ?? {})) { field[k] ??= { n: 0, correct: 0 }; field[k].n += 1; if (v) field[k].correct += 1; }
  for (const v of Object.values(field)) { v.pct = pct(v.correct, v.n); v.wilson = wilson(v.correct, v.n); }
  const strata = {};
  for (const r of scored) { strata[r.stratum] ??= { n: 0, correct: 0 }; strata[r.stratum].n += 1; if (r.correct) strata[r.stratum].correct += 1; }
  for (const v of Object.values(strata)) { v.pct = pct(v.correct, v.n); v.wilson = wilson(v.correct, v.n); }
  const weighted = weights ? (() => { let num = 0; let den = 0; for (const [k, v] of Object.entries(strata)) { const w = weights[k] ?? 0; if (!v.n || !w) continue; num += w * (v.correct / v.n); den += w; } return den ? Math.round((1000 * num) / den) / 10 : null; })() : null;
  const lat = scored.map((r) => r.latency_ms).filter((x) => typeof x === "number" && x > 0);
  const status = {};
  for (const r of rows) status[r.status] = (status[r.status] ?? 0) + 1;
  const disp = {};
  for (const r of scored) disp[r.disposition] = (disp[r.disposition] ?? 0) + 1;
  const kinds = {};
  for (const r of scored) if (r.clarification_kind) kinds[r.clarification_kind] = (kinds[r.clarification_kind] ?? 0) + 1;
  const goldValid = rows.filter((r) => r.status !== "gold_invalid");
  const accepted = scored.filter((r) => r.accepted);
  const correct = count(scored, (r) => r.correct);
  const byGold = {};
  for (const r of scored) { byGold[r.gold_outcome] ??= { n: 0, correct: 0 }; byGold[r.gold_outcome].n += 1; if (r.correct) byGold[r.gold_outcome].correct += 1; }
  return {
    n_rows: rows.length, n_gold_valid: goldValid.length, n_scored: scored.length, status,
    transport: { unavailable: status.transport_unavailable ?? 0, provider_void: status.provider_void ?? 0, missing: status.missing ?? 0, voids: (status.transport_unavailable ?? 0) + (status.provider_void ?? 0) + (status.missing ?? 0), rate_pct: pct((status.transport_unavailable ?? 0) + (status.provider_void ?? 0) + (status.missing ?? 0), goldValid.length), retried: count(rows, (r) => (r.retry_count ?? 0) > 0) },
    invalid_output: status.invalid_output ?? 0,
    resolved_outcome: { correct, pct: pct(correct, scored.length), wilson: wilson(correct, scored.length), cluster_bootstrap: clusterBootstrap(scored, (r) => r.correct), conservative_pct_transport_as_wrong: pct(correct, goldValid.length), weighted_pct: weighted },
    by_gold_outcome: byGold,
    coverage: { accepted: accepted.length, pct: pct(accepted.length, scored.length) },
    false_confident: { n: count(accepted, (r) => r.false_confident), pct_of_accepted: pct(count(accepted, (r) => r.false_confident), accepted.length), wilson: wilson(count(accepted, (r) => r.false_confident), accepted.length) },
    routing_fields: Object.fromEntries(ROUTING_FIELDS.filter((k) => field[k]).map((k) => [k, field[k]])),
    diagnostic_fields: Object.fromEntries(DIAGNOSTIC_FIELDS.filter((k) => field[k]).map((k) => [k, field[k]])),
    strata, dispositions: disp, clarification_kinds: kinds,
    latency_ms: lat.length ? { n: lat.length, p50: quantile(lat, 0.5), p90: quantile(lat, 0.9), p90_bootstrap: bootstrapQuantile(lat, 0.9) } : null
  };
}

/** The identity every score artifact carries: input / lexicon / render / wire / frame versions and digests. */
function contractIdentity() {
  return { replay: REPLAY_VERSION, reader_input: READER_INPUT_VERSION, lexicon: LEXICON_VERSION, render: RENDER_VERSION, render_system_digest: SYSTEM_DIGEST, wire: W.WIRE_VERSION, wire_digest: W.WIRE_DIGEST, frame: RF.READER_FRAME_VERSION };
}

// ─── rare-state machine shape counts ──────────────────────────────────────────────────────────────────
const SHAPE_KEYS = Object.freeze(["yes_no", "choice", "person", "time", "item", "free_short", "uncertainty", "refusal", "counter_question", "answer_follow_up", "own_answer_correction", "not_an_answer"]);
/**
 * Exact machine counts of coworker-question turns: every captured turn with a PENDING coworker question (i1), by
 * shape. Shape = the authored coverage tag (rare-state fixture `reply`) -- uncertainty / refusal / counter-question /
 * answer + follow-up -- or, for a plain answer, the canonical answer shape of the pending question; a pending-question
 * turn with no authored reply tag is `not_an_answer` (a line said while a question was pending, not a reply to it).
 * Own-answer corrections are counted over just-answered (i0) turns. Development coverage only; never gold.
 */
function shapeCounts(items) {
  const shapeOf = (i) => {
    const tag = i.coverage_tag;
    if (tag === "own_answer_correction") return "own_answer_correction";
    if (!tag) return "not_an_answer";
    if (tag !== "answer") return tag;
    const s = i.input.conversation.inbound?.answer_shape ?? null;
    return s === "free_short_answer" ? "free_short" : s ?? "free_short";
  };
  const out = {};
  for (const scope of ["scripted_rare_state", "all_strata"]) {
    const list = items.filter((i) => scope === "all_strata" || i.stratum === scope);
    const pending = list.filter((i) => i.input.conversation.inbound);
    const shapes = Object.fromEntries(SHAPE_KEYS.map((k) => [k, 0]));
    for (const i of pending) { const s = i.stratum === "scripted_rare_state" ? shapeOf(i) : "untagged_other_stratum"; shapes[s] = (shapes[s] ?? 0) + 1; }
    const i0 = list.filter((i) => i.input.conversation.just_answered_inbound);
    shapes.own_answer_correction = i0.filter((i) => i.coverage_tag === "own_answer_correction").length;
    out[scope] = { pending_coworker_question_turns: pending.length, authored_replies: pending.filter((i) => i.coverage_tag && i.coverage_tag !== "own_answer_correction").length, just_answered_turns: i0.length, shapes };
  }
  out.note = "Aggregate >= 60 does not give per-shape statistical power: every shape below 60 is report-only.";
  return out;
}

// ─── tokens (pinned tokenizer) ───────────────────────────────────────────────────────────────────────
/** Token classes for G1 (Step 0.1): reported separately so context-free probes do not dilute the headline. */
const TOKEN_CLASSES = Object.freeze({
  context_free: { rule: "ED-30 development probes (single turn, no conversation state)", test: (i) => PROBE_STRATA.includes(i.stratum) },
  discourse_bearing: { rule: "turns whose render carries prior conversation (previous player line, requests, a coworker question, an activity round or heard anchors)", test: (i) => { const c = i.input.conversation ?? {}; return Boolean(c.previous_player_line || (c.requests ?? []).length || c.inbound || c.just_answered_inbound || c.activity || (i.input.heard?.anchors ?? []).length); } },
  real_scenario: { rule: "j15 scripts, the human trace and the scripted-state scenarios", test: (i) => ["j15", "human_trace", "scripted_state"].includes(i.stratum) },
  human_trace: { rule: "the human trace", test: (i) => i.stratum === "human_trace" }
});
const G1_RULE = Object.freeze({ codec_round_trip: "100%", discourse_bearing_p90_max: 300, human_trace_p90_max: 300, guardrails_reported: ["p99", "max"], note: "context is never cut or padded to pass" });
function tokenStats(list) { return list.length ? { n: list.length, min: Math.min(...list), p50: quantile(list, 0.5), mean: Math.round(list.reduce((a, b) => a + b, 0) / list.length), p90: quantile(list, 0.9), p95: quantile(list, 0.95), p99: quantile(list, 0.99), max: Math.max(...list), over_300: list.filter((x) => x > 300).length } : null; }
async function tokenDistribution(items, { log = () => {} } = {}) {
  const runtime = require("./dialogue-reader-runtime");
  const server = await runtime.startServer(["--ctx-size", "2048", "--cache-ram", "0", "--no-webui", "--parallel", "1"]);
  try {
    const counts = [];
    const bySignature = new Map();
    for (const item of items) {
      const render = renderReaderPrompt(item.input);
      const n = bySignature.get(render.user) ?? (await runtime.tokenize(server.endpoint, render.user)).length;
      bySignature.set(render.user, n);
      counts.push({ id: item.id, stratum: item.stratum, dynamic_tokens: n, chars: render.user.length, classes: Object.keys(TOKEN_CLASSES).filter((k) => TOKEN_CLASSES[k].test(item)) });
    }
    const system = (await runtime.tokenize(server.endpoint, SYSTEM_TEXT)).length;
    const systemJson = (await runtime.tokenize(server.endpoint, require("./dialogue-reader-render").SYSTEM_TEXT_JSON)).length;
    const wire = [];
    for (const item of items) if (item.l0.frame) wire.push((await runtime.tokenize(server.endpoint, W.encodeWire(item.l0.frame, item.input))).length);
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
    const classes = Object.fromEntries(Object.entries(TOKEN_CLASSES).map(([k, v]) => [k, { rule: v.rule, ...tokenStats(counts.filter((c) => c.classes.includes(k)).map((c) => c.dynamic_tokens)) }]));
    const g1 = { rule: G1_RULE, discourse_bearing_p90: classes.discourse_bearing.p90, human_trace_p90: classes.human_trace.p90, pass: classes.discourse_bearing.p90 <= G1_RULE.discourse_bearing_p90_max && classes.human_trace.p90 <= G1_RULE.human_trace_p90_max };
    return {
      version: "yellow-beast-reader-token-distribution@v2", tokenizer: server.pin, contract: contractIdentity(), turns: counts.length, distinct_renders: bySignature.size,
      g1, classes,
      all_turns: { ...tokenStats(dyn), within_150_250: pct(dyn.filter((x) => x >= 150 && x <= 250).length, dyn.length), note: "all replayed turns together; diluted by context-free probes -- G1 is read on the classes above" },
      by_stratum: Object.fromEntries(Object.entries(strata).map(([k, v]) => [k, tokenStats(v)])),
      static_system_tokens: system, static_system_tokens_json: systemJson,
      wire_tokens_legacy_frames: { n: wire.length, p50: quantile(wire, 0.5), p90: quantile(wire, 0.9), max: Math.max(...wire) },
      early_branch: branch,
      histogram: (() => { const h = {}; for (const x of dyn) { const b = `${Math.floor(x / 25) * 25}-${Math.floor(x / 25) * 25 + 24}`; h[b] = (h[b] ?? 0) + 1; } return Object.fromEntries(Object.entries(h).sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]))); })(),
      top10: [...counts].sort((a, b) => b.dynamic_tokens - a.dynamic_tokens).slice(0, 10).map(({ id, dynamic_tokens }) => ({ id, dynamic_tokens }))
    };
  } finally { await server.stop(); }
}

// ─── hosted egress gate ───────────────────────────────────────────────────────────────────────────────
/**
 * Hosted runs transmit actual player text. Consent is EXPLICIT (never inferred from an API key): `--confirm-egress`
 * is required, and human-trace renders are excluded unless `--include-human-trace` is also given. Returns
 * { ok, units, summary, refusal? }; the summary is printed before any request is sent.
 */
function egressPlan(units, { confirm = false, includeHumanTrace = false, provider, baseURL, model, family, retention = null, receipts = null, params = {}, maxOutputTokens = params?.max_output_tokens ?? null } = {}) {
  const human = (u) => (u.strata ?? [unitItem(u).stratum]).includes("human_trace");
  const kept = includeHumanTrace ? units : units.filter((u) => !human(u));
  const strata = {};
  for (const u of kept) { const s = u.primary_stratum ?? unitItem(u).stratum; strata[s] = (strata[s] ?? 0) + 1; }
  let bytes = 0; let chars = 0;
  for (const u of kept) { const r = renderReaderPrompt(unitItem(u).input); bytes += Buffer.byteLength(r.system) + Buffer.byteLength(r.user); chars += r.system.length + r.user.length; }
  let host = null;
  try { host = new URL(baseURL).host; } catch { host = baseURL ?? null; }
  const summary = {
    provider, endpoint_host: host, model, family: family ?? null, renders: kept.length, strata,
    human_trace_included: includeHumanTrace && units.some(human), human_trace_excluded: includeHumanTrace ? 0 : units.filter(human).length,
    bytes_estimated: bytes, tokens_estimated: Math.round(chars / 4), tokens_note: "~4 characters per token; the system prefix is sent with every request",
    retries: `up to ${RETRY_POLICY.max_retries} per render (transient failures only)`, params,
    retention_training: retention ?? "unknown: not configured (pass --retention to record the provider's retention / training setting)",
    receipts: receipts ?? null
  };
  if (!(Number.isInteger(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0)) return { ok: false, units: kept, summary, refusal: "hosted run refused: an explicit output-token budget (--max-output-tokens) is required; there is no hosted default" };
  if (!confirm) return { ok: false, units: kept, summary, refusal: "hosted egress refused: pass --confirm-egress to send player text to the provider (consent is never inferred from an API key)" };
  if (!receipts) return { ok: false, units: kept, summary, refusal: "hosted run refused: --receipts <file.jsonl> is mandatory for hosted runs" };
  return { ok: true, units: kept, summary };
}
/** Provider termination metadata of one reading (finish / stop reason, kind, usage); never any reasoning text. */
function terminationOf(r) {
  const t = r?.transport?.termination ?? null;
  return { finish_reason: t?.finish_reason ?? null, stop_reason: t?.stop_reason ?? null, termination: t?.kind ?? (r?.status === "read" || r?.status === "invalid" ? "completed" : null), refusal: Boolean(t?.refusal), usage: t?.usage ?? r?.transport?.usage ?? null };
}
/** One receipt per hosted REQUEST (never any provider chain-of-thought). */
function hostedRequestReceipt({ unit, item, receipt, attempt }) {
  const r = receipt ?? {};
  const t = r.transport?.transmitted ?? null;
  let host = null;
  try { host = t?.url ? new URL(t.url).host : null; } catch { host = null; }
  return {
    id: unit.id, attempt, retry_count: attempt - 1, render_digest: r.render_digest ?? renderReaderPrompt(item.input).render_digest, system_digest: r.system_digest ?? null,
    provider: r.reader?.provider ?? null, endpoint_host: host, model: r.reader?.model ?? t?.model ?? null, response_model: r.transport?.model ?? null,
    params: t?.params ?? null, request_bytes: t?.bytes ?? null, system_sha256: t?.system_sha256 ?? null, user_sha256: t?.user_sha256 ?? null,
    response_status: r.transport?.response_status ?? (r.status === "reader_unavailable" ? r.error ?? r.reason : null),
    latency_ms: r.latency_ms ?? null, output_digest: typeof r.raw_wire === "string" ? sha(r.raw_wire) : null, status: r.status ?? null,
    ...terminationOf(r),
    transport_failure: r.status === "reader_unavailable" ? { reason: r.reason ?? null, error: r.error ?? null } : null
  };
}
/** Per-unit summary receipt (all attempts). */
function hostedReceipt(row, item) {
  const last = hostedRequestReceipt({ unit: { id: row.id }, item, receipt: row.receipt, attempt: row.attempts ?? 1 });
  return { ...last, retry_count: row.retry_count ?? 0, tries: row.tries ?? [] };
}

/**
 * DURABLE RECEIPT LOG (Step 0.1B). Opened BEFORE any hosted request: the destination is created exclusively (an existing
 * file is never overwritten or mixed into) and a failure to prepare it throws RECEIPTS_UNWRITABLE, so no request is
 * sent. Each completed request is appended and fsync'd before the arm proceeds, so a crash after request N leaves the
 * receipts of requests 1..N on disk.
 */
function openReceiptLog(file) {
  let fd;
  try { fd = fs.openSync(file, "wx"); } catch (error) { throw Object.assign(new Error(`receipts destination cannot be prepared (${error.code ?? error.message}): ${file}`), { code: "RECEIPTS_UNWRITABLE" }); }
  return {
    file,
    append(record) { fs.writeSync(fd, `${JSON.stringify(record)}\n`); fs.fsyncSync(fd); },
    close() { try { fs.closeSync(fd); } catch {} }
  };
}
/**
 * The hosted teacher arm. Order is fail-closed: explicit budget -> receipt log prepared -> transport -> requests, each
 * request's receipt durably appended as it completes. Throws BUDGET_MISSING / RECEIPTS_UNWRITABLE before any egress.
 */
async function hostedArm(units, { api = "openai-chat", baseURL, apiKey, model, provider = api, family = null, maxOutputTokens = null, temperature = null, reasoningEffort = null, reasoningBudgetTokens = null, maxTokensParam, output = "wire", timeoutMs = 120000, concurrency = 2, receipts, fetchImpl, sleep, onItem = null } = {}) {
  if (!(Number.isInteger(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0)) throw Object.assign(new Error("hosted run refused: an explicit output-token budget is required"), { code: "BUDGET_MISSING" });
  if (!receipts) throw Object.assign(new Error("hosted run refused: a receipts destination is mandatory"), { code: "RECEIPTS_UNWRITABLE" });
  const log = openReceiptLog(receipts);
  try {
    const transport = require("./dialogue-reader-async").hostedChatTransport({ api, baseURL, apiKey, model, maxOutputTokens: Number(maxOutputTokens), temperature, reasoningEffort, reasoningBudgetTokens, maxTokensParam, ...(fetchImpl ? { fetchImpl } : {}) });
    return await modelArm(units, { id: "teacher", provider, model, family, output, max_tokens: Number(maxOutputTokens), temperature, timeout_ms: timeoutMs, transport }, { concurrency, onItem, ...(sleep ? { sleep } : {}), onAttempt: (a) => log.append(hostedRequestReceipt(a)) });
  } finally { log.close(); }
}

// ─── the headline contract (Step 0.1B) ───────────────────────────────────────────────────────────────
// A run is HEADLINE only when it measures exactly the preregistered teacher population under the preregistered rules.
// The canonical population is bound by the pinned SHA-256 of the frozen sample file (also pinned in ed33b), its
// contract identity, and deterministic regeneration from the capture being scored.
const TEACHER_SAMPLE_FILE = path.join(__dirname, "..", "docs", "acceptance", "reader-phase2", "teacher-dev-sample.json");
const TEACHER_SAMPLE_SHA256 = "26f0ba7b69a3be175359ddad5fa0a798a094d1151dc1b1659c243b70aeb201c8";
const TEACHER_POPULATION = 474;
const TRANSPORT_VOID_MAX = 0.02;
/**
 * Returns { headline, reasons }. Every condition must hold:
 *   the sample file is byte-identical to the pinned canonical file, carries the current contract identity, has the
 *   474-render population, and regenerates exactly from the scored capture; the run scored exactly that population
 *   (no --limit, stratum filter, human-trace exclusion or diagnostic label states; wire output); every id has valid
 *   ADJUDICATED_GOLD or a recorded UNLABELABLE adjudication, with at least 300 valid adjudicated (label-loss rule); the
 *   voids (transport_unavailable + provider_void + missing) are at most 2% (transport-void rule).
 */
function headlineVerdict({ sampleText = null, capturedGroups = [], runIds = [], validated = null, gold = null, rows = [], limit = false, stratum = false, diagnosticStates = false, humanTraceExcluded = 0, output = "wire" } = {}) {
  const reasons = [];
  let doc = null;
  if (sampleText == null) reasons.push("no_preregistered_sample");
  else {
    if (sha(sampleText) !== TEACHER_SAMPLE_SHA256) reasons.push("sample_identity_mismatch");
    try { doc = JSON.parse(sampleText); } catch { reasons.push("sample_unreadable"); }
  }
  const ids = doc?.headline?.map((h) => h.id) ?? [];
  if (doc) {
    if (JSON.stringify(doc.contract) !== JSON.stringify(contractIdentity())) reasons.push("sample_contract_mismatch");
    if (doc.version !== TEACHER_SAMPLE_PLAN.version || ids.length !== TEACHER_POPULATION || doc.headline_renders !== TEACHER_POPULATION || new Set(ids).size !== ids.length) reasons.push("sample_population_not_canonical");
    const regenerated = teacherDevSample(capturedGroups).headline.map((h) => h.id);
    if (JSON.stringify(regenerated) !== JSON.stringify(ids)) reasons.push("sample_not_regenerated_from_capture");
  }
  if (limit) reasons.push("limit_run");
  if (stratum) reasons.push("stratum_filtered_run");
  if (diagnosticStates) reasons.push("diagnostic_label_states");
  if (output !== "wire") reasons.push("json_control_run");
  if (humanTraceExcluded > 0) reasons.push("human_trace_excluded");
  const run = new Set(runIds);
  if (run.size !== ids.length || ids.some((id) => !run.has(id))) reasons.push("run_population_differs_from_sample");
  const goldIds = new Set(Object.keys(gold ?? {}));
  const unlabelable = new Set((validated?.unlabelable ?? []).map((u) => u.id));
  const invalid = new Set((validated?.problems ?? []).map((p) => p.id));
  const missing = ids.filter((id) => !goldIds.has(id) && !unlabelable.has(id));
  if (ids.some((id) => invalid.has(id))) reasons.push("invalid_labels_in_population");
  if (missing.length) reasons.push("labels_missing");
  const validAdjudicated = ids.filter((id) => goldIds.has(id)).length;
  if (validAdjudicated < (TEACHER_SAMPLE_PLAN.minimum_valid_adjudicated ?? 300)) reasons.push("label_loss_rule_fewer_than_300_valid_adjudicated");
  const voids = rows.filter((r) => ["transport_unavailable", "provider_void", "missing"].includes(r.status)).length;
  const population = rows.filter((r) => r.status !== "gold_invalid").length;
  if (!population || voids / population > TRANSPORT_VOID_MAX) reasons.push(population ? "transport_void_rule_exceeded" : "nothing_scored");
  return { headline: reasons.length === 0, reasons: [...new Set(reasons)], valid_adjudicated: validAdjudicated, unlabelable: unlabelable.size, missing: missing.length, voids, void_rate_pct: pct(voids, population) };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const flag = (name) => process.argv.includes(name);
  const log = (l) => process.stderr.write(`${l}\n`);
  const load = (file) => JSON.parse(fs.readFileSync(file, "utf8")).items;
  if (arg("--capture")) {
    const items = await captureCorpus({ quick: flag("--quick"), log });
    fs.writeFileSync(arg("--capture"), JSON.stringify({ version: REPLAY_VERSION, contract: contractIdentity(), items }));
    log(`captured ${items.length} turns`);
    return;
  }
  if (arg("--manifest")) {
    // The frozen development manifest: which turns, which stratum, and the digest of exactly what a reader sees;
    // the distinct-render groups with every occurrence.
    const items = load(arg("--manifest"));
    const groups = renderGroups(items);
    const strata = {};
    for (const i of items) strata[i.stratum] = (strata[i.stratum] ?? 0) + 1;
    const groupOf = new Map(groups.flatMap((g) => g.occurrences.map((o) => [o.id, g.id])));
    const doc = {
      version: "yellow-beast-reader-dev-manifest@v2", contract: contractIdentity(), counts: corpusCounts(items, groups), turns: items.length, distinct_renders: groups.length, strata,
      items: items.map((i) => ({ id: i.id, stratum: i.stratum, fixture: i.fixture, provider: i.provider, render_digest: renderReaderPrompt(i.input).render_digest, group: groupOf.get(i.id), context_dependent: Boolean(i.context_dependent), context_available: Boolean(i.context_available) })),
      groups: groups.map((g) => ({ id: g.id, render_digest: g.render_digest, primary_stratum: g.primary_stratum, strata: g.strata, context_dependent: g.context_dependent, context_missing: g.context_missing, headline_eligible: headlineEligible(g), occurrences: g.occurrences.map((o) => o.id) }))
    };
    fs.writeFileSync(arg("--out"), `${JSON.stringify(doc, null, 1)}\n`);
    log(`manifest: ${items.length} turns, ${groups.length} distinct renders`);
    return;
  }
  if (arg("--teacher-sample")) {
    const doc = teacherDevSample(renderGroups(load(arg("--teacher-sample"))));
    fs.writeFileSync(arg("--out"), `${JSON.stringify(doc, null, 1)}\n`);
    log(`teacher dev sample: ${doc.headline_renders} headline renders ${JSON.stringify(doc.by_stratum)}`);
    return;
  }
  if (arg("--shapes")) { console.log(JSON.stringify(shapeCounts(load(arg("--shapes"))), null, 1)); return; }
  if (arg("--counts")) { console.log(JSON.stringify(corpusCounts(load(arg("--counts"))), null, 1)); return; }
  if (arg("--tokens")) {
    const dist = await tokenDistribution(load(arg("--tokens")), { log });
    const out = arg("--out");
    if (out) fs.writeFileSync(out, `${JSON.stringify(dist, null, 1)}\n`);
    console.log(JSON.stringify({ g1: dist.g1, classes: dist.classes }, null, 1));
    return;
  }
  if (arg("--run")) {
    const L = require("./dialogue-reader-labels");
    const allGroups = renderGroups(load(arg("--run")));
    let groups = allGroups;
    const labels = fs.readFileSync(arg("--labels"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));
    // Headline scoring uses ADJUDICATED_GOLD only; other states only with --diagnostic-states (never headline).
    const states = arg("--diagnostic-states") ? arg("--diagnostic-states").split(",") : [L.LABEL_STATES.ADJUDICATED_GOLD];
    const registry = L.loadRegistry();
    let sampleNote = "all labelled renders";
    let sampleText = null;
    if (arg("--sample")) { sampleText = fs.readFileSync(arg("--sample"), "utf8"); const ids = new Set(JSON.parse(sampleText).headline.map((h) => h.id)); groups = groups.filter((g) => ids.has(g.id)); sampleNote = `sample ${path.basename(arg("--sample"))}`; }
    if (arg("--stratum")) { groups = groups.filter((g) => g.primary_stratum === arg("--stratum")); sampleNote += `; stratum ${arg("--stratum")}`; }
    const validated = L.validateLabels(groups, labels, { states, registry });
    groups = groups.filter((g) => validated.gold[g.id]);
    if (arg("--limit")) { groups = stratifiedSample(groups, Number(arg("--limit"))); sampleNote += `; stratified --limit ${arg("--limit")} (non-headline)`; }
    const armName = arg("--arm");
    const output = arg("--output") === "json" ? "json" : "wire";
    let arm; let identity; let server = null; let egress = null; let armFamily = null;
    try {
      if (armName === "legacy") { arm = legacyArm(groups); identity = { arm: "L0", reader: "legacy-v0" }; }
      else if (armName === "local") {
        const runtime = require("./dialogue-reader-runtime");
        const serverArgs = arg("--server-args") ? arg("--server-args").split(" ") : runtime.PRODUCTION_ARGS;
        server = await runtime.startServer(serverArgs);
        identity = { arm: "E4B", provider: "local-llama.cpp", ...server.pin, server_args: serverArgs, grammar: output === "wire", logprobs: true };
        armFamily = "gemma";
        arm = await modelArm(groups, { id: "e4b", provider: "local", model: server.pin.model_file, model_hash: server.pin.model_sha256, quantization: server.pin.quantization, output, grammar: output === "wire", logprobs: true, top_logprobs: 10, timeout_ms: Number(arg("--timeout-ms") ?? 30000), transport: require("./dialogue-reader-async").llamaTransport({ endpoint: server.endpoint }) }, { concurrency: Number(arg("--concurrency") ?? 1), onItem: (r, i) => log(`${i + 1}/${groups.length} ${r.status} ${r.latency_ms}ms`) });
      } else if (armName === "hosted") {
        // DEVELOPMENT-ONLY teacher. The key is read from the named environment variable and never written anywhere.
        const api = arg("--api") ?? "openai-chat";
        armFamily = arg("--family");
        const teacher = registry.teacher ?? {};
        if (!armFamily || !teacher.family || armFamily !== teacher.family) throw new Error(`hosted run refused: --family must name the teacher family recorded in ${path.relative(process.cwd(), L.REGISTRY_FILE)} before labelling (recorded: ${teacher.family ?? "none"})`);
        if (registry.automated_reviewer?.family && registry.automated_reviewer.family === armFamily) throw new Error("hosted run refused: the teacher family equals the automated review-labeler family");
        const params = { max_output_tokens: arg("--max-output-tokens") ? Number(arg("--max-output-tokens")) : null, temperature: arg("--temperature") != null ? Number(arg("--temperature")) : null, reasoning_effort: arg("--reasoning-effort"), reasoning_budget_tokens: arg("--reasoning-budget") ? Number(arg("--reasoning-budget")) : null, max_tokens_param: arg("--max-tokens-param") };
        egress = egressPlan(groups, { confirm: flag("--confirm-egress"), includeHumanTrace: flag("--include-human-trace"), provider: arg("--provider") ?? api, baseURL: arg("--base-url") ?? (api === "anthropic-messages" ? "https://api.anthropic.com" : null), model: arg("--model"), family: armFamily, retention: arg("--retention"), receipts: arg("--receipts"), params });
        log(`HOSTED EGRESS PLAN\n${JSON.stringify(egress.summary, null, 1)}`);
        if (!egress.ok) { log(egress.refusal); process.exitCode = 2; return; }
        groups = egress.units;
        const key = process.env[arg("--key-env") ?? ""] ?? null;
        identity = { arm: "T", provider: egress.summary.provider, api, endpoint_host: egress.summary.endpoint_host, model: arg("--model"), family: armFamily, params, retry_policy: RETRY_POLICY, egress: egress.summary, transmitted: "renderReaderPrompt(input) system + user only; no transcript, world state, private state, repository or canon", ...(output === "json" ? { json_system_digest: require("./dialogue-reader-render").SYSTEM_DIGEST_JSON } : {}) };
        // Budget and receipt log are established before the first request; each request's receipt is durable on completion.
        arm = await hostedArm(groups, { api, baseURL: arg("--base-url") ?? undefined, apiKey: key, model: identity.model, provider: identity.provider, family: armFamily, maxOutputTokens: params.max_output_tokens, temperature: params.temperature, reasoningEffort: params.reasoning_effort, reasoningBudgetTokens: params.reasoning_budget_tokens, maxTokensParam: params.max_tokens_param ?? undefined, output, timeoutMs: Number(arg("--timeout-ms") ?? 120000), concurrency: Number(arg("--concurrency") ?? 2), receipts: arg("--receipts"), onItem: (r, i) => log(`${i + 1}/${groups.length} ${r.status}${r.retry_count ? ` (retries ${r.retry_count})` : ""}`) });
      } else throw new Error("--arm legacy|local|hosted");
    } finally { if (server) await server.stop(); }
    // An evaluated arm is never the label source of its own evaluation.
    const own = L.excludeSelfLabelled(validated.gold, armFamily);
    const scored = scoreArm(groups, arm, own.gold, { weights: JSON.parse(arg("--weights") ?? "null") });
    // headline:true only when the whole preregistered contract holds (Step 0.1B).
    const verdict = headlineVerdict({ sampleText, capturedGroups: allGroups, runIds: groups.map((g) => g.id), validated, gold: own.gold, rows: scored.rows, limit: Boolean(arg("--limit")), stratum: Boolean(arg("--stratum")), diagnosticStates: Boolean(arg("--diagnostic-states")), humanTraceExcluded: egress?.summary?.human_trace_excluded ?? 0, output });
    const byId = new Map(arm.map((r) => [r.id, r]));
    const doc = { version: REPLAY_VERSION, measured_at: new Date().toISOString(), authoritative: false, headline: verdict.headline, headline_verdict: verdict, sample: sampleNote, contract: contractIdentity(), output, identity, labels: { file: path.basename(arg("--labels")), states, counts: validated.counts, problems: validated.problems, unlabelable: validated.unlabelable, excluded_self_labelled: own.excluded }, summary: scored.summary, rows: scored.rows.map((r) => ({ ...r, raw_wire: byId.get(r.id)?.raw_wire ?? null })) };
    fs.writeFileSync(arg("--out"), `${JSON.stringify(doc, null, 1)}\n`);
    if (armName !== "hosted" && arg("--receipts")) fs.writeFileSync(arg("--receipts"), arm.map((r) => JSON.stringify({ id: r.id, receipt: r.receipt ?? null })).join("\n"));
    console.log(JSON.stringify({ headline: verdict.headline, headline_reasons: verdict.reasons, ...scored.summary }, null, 1));
    return;
  }
  console.error("usage: --capture <out.json> [--quick] | --tokens <capture.json> --out <file> | --manifest <capture.json> --out <file> | --teacher-sample <capture.json> --out <file> | --shapes <capture.json> | --counts <capture.json> | --run <capture.json> --labels <labels.jsonl> --arm legacy|local|hosted --out <score.json>");
  process.exit(2);
}

module.exports = { headlineVerdict, hostedArm, hostedRequestReceipt, openReceiptLog, terminationOf, TEACHER_SAMPLE_FILE, TEACHER_SAMPLE_SHA256, TEACHER_POPULATION, TRANSPORT_VOID_MAX, doctrineReviewSample, REPLAY_VERSION, RETRY_POLICY, TOKEN_CLASSES, G1_RULE, TEACHER_SAMPLE_PLAN, STRATUM_PRIORITY, SHAPE_KEYS, loadRareState, developmentFixtures, stratumOf, captureCorpus, freezeItem, renderGroups, corpusCounts, stratifiedSample, stratumOrder, headlineEligible, teacherDevSample, resolveFrame, outcomeSignature, compareOutcomes, fieldAgreement, primaryAct, legacyArm, modelArm, transientFailure, armStatus, scoreArm, summarizeRows, bootstrapQuantile, clusterBootstrap, wilson, quantile, contractIdentity, shapeCounts, tokenStats, tokenDistribution, egressPlan, hostedReceipt, ROUTING_FIELDS, DIAGNOSTIC_FIELDS };

// Entry point last: dialogue-reader-labels.js requires this module, so its exports must exist before main() runs.
if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });
