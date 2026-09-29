#!/usr/bin/env node
"use strict";

// Reader Phase 0 -- the GOLD-DIS EVALUATOR (developer tooling only).
//
// Evaluates the ACTUAL shipped service composition (DesktopService, every overlay and owner rule included),
// never a re-implementation of it. Discourse context is built canonically: each item carries a scripted PREFIX
// that is played through the real service (real ledger APIs), with CHECKPOINTS asserted against the canonical
// ledger. An item whose prefix does not build the stated state is reported `prefix_invalid` and never scored --
// context is never rebuilt by re-parsing prose.
//
// The service runs with a scripted ORACLE reader that returns the item's gold ReaderFrame for the target turn;
// the legacy reader v0 is recorded alongside it through the same seam. Three measurements, kept separate:
//   reader     the reader under test (legacy v0 in Phase 0) vs the gold frame, per field
//   resolver   resolveTurn(gold frame, DIS) vs gold behaviour -- a SPEC SUITE expected to reach 100%. In Phase 0
//              the frame-driven resolver does not exist (RESOLVER_NOT_IMPLEMENTED); reported as such, plus the
//              conditional proxy: production behaviour on items whose legacy frame matched gold on routing fields
//   behaviour  what production actually did (responders, facet, clarification, silence) vs gold behaviour
//
// Item format (JSONL):
//   { id, names?: [..3], prefix: [{ text, checkpoint?: { requests?: [{ predicate, targets?, state? }], inbound?: bool } }],
//     utterance, gold: { frame?: ReaderFrame (symbolic refs allowed), behavior?: { responders?, facet?, clarify?, silence? } } }
// Symbolic references in a gold frame (resolved against the target turn's ReaderInput):
//   name "@Tonya" -> the name span with that text; request "req:<facet>" -> the latest request with that facet;
//   "req:latest" -> distance 0; referent "ref:<name>" -> the candidate with that name; "inbound" -> i1.
//
//   node tools/dialogue-gold-eval.js <items.jsonl> [--json] [--show-input <item id>]

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const RF = require("./dialogue-reader-frame");
const reader = require("./dialogue-reader");
const { resolveTurn } = require("./dialogue-resolve-turn");

const GOLD_EVAL_VERSION = "yellow-beast-reader-gold-eval@v1";
const SCENE_NAMES = ["Giselle", "Malcolm", "Tonya"];
const ROUTING_FIELDS = ["speech_act", "address", "facet", "relation"];
const FIELDS = ["speech_act", "question_form", "address", "facet", "relation", "subject", "referent", "temporal", "inbound_answer", "abstain"];

const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => JSON.parse(l));

/** Resolve symbolic references in a gold frame against one ReaderInput (labels are per-turn). */
function resolveGoldFrame(gold, input) {
  const name = (ref) => (typeof ref === "string" && ref.startsWith("@") ? input.features.name_spans.find((n) => n.text.toLowerCase() === ref.slice(1).toLowerCase())?.label ?? `UNRESOLVED:${ref}` : ref);
  const request = (ref) => {
    if (typeof ref !== "string" || !ref.startsWith("req:") && ref !== "inbound") return ref;
    if (ref === "inbound") return input.conversation.inbound?.label ?? "UNRESOLVED:inbound";
    const want = ref.slice(4);
    const pool = want === "latest" ? input.conversation.requests.filter((r) => r.distance === 0) : input.conversation.requests.filter((r) => r.facet === want);
    return pool.sort((a, b) => a.distance - b.distance)[0]?.label ?? `UNRESOLVED:${ref}`;
  };
  const referent = (ref) => (typeof ref === "string" && ref.startsWith("ref:") ? input.referent_candidates.find((r) => r.name.toLowerCase() === ref.slice(4).toLowerCase())?.label ?? `UNRESOLVED:${ref}` : ref);
  const acts = (gold.acts ?? []).map((a) => {
    const out = structuredClone(a);
    if (out.span === "all" || !out.span) out.span = [0, input.line.tokens.length - 1];
    if (out.address) { out.address = { op: out.address.op, names: (out.address.names ?? []).map(name), relative_to: request(out.address.relative_to ?? null), count: out.address.count ?? null }; }
    if (out.name_roles) out.name_roles = out.name_roles.map((r) => ({ name: name(r.name), role: r.role }));
    if (out.relation) out.relation = { kind: out.relation.kind, target: request(out.relation.target ?? null) };
    if (out.subject) out.subject = { kind: out.subject.kind, names: (out.subject.names ?? []).map(name) };
    if (out.referent) out.referent = { span: out.referent.span ?? null, candidate: referent(out.referent.candidate) };
    return out;
  });
  return { version: RF.READER_FRAME_VERSION, acts };
}

/** The complete ReaderFrame an oracle returns (gold fields over neutral defaults, so V0 can validate it). */
function completeFrame(frame) {
  const defaults = { name_roles: [], question_form: "none", polarity: "positive", address: { op: "NONE", names: [], relative_to: null, count: null }, relation: { kind: "new", target: null }, repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [] };
  return { version: frame.version, acts: frame.acts.map((a) => ({ ...defaults, ...a })) };
}

const fieldValue = (act, field) => {
  if (!act) return null;
  if (field === "address") return act.address ? { op: act.address.op, names: [...(act.address.names ?? [])].sort() } : null;
  if (field === "relation") return act.relation ? { kind: act.relation.kind, target: act.relation.target ?? null } : null;
  if (field === "subject") return act.subject ? { kind: act.subject.kind, names: [...(act.subject.names ?? [])].sort() } : null;
  if (field === "referent") return act.referent ? act.referent.candidate : null;
  if (field === "abstain") return [...(act.abstain ?? [])].sort();
  return act[field] ?? null;
};
/** Per-field agreement between a reader's frame and the gold frame (only the fields gold specifies). */
function compareFrames(got, gold, goldSpecified) {
  const out = {};
  const primary = (f) => f?.acts?.at(-1) ?? null;
  for (const field of FIELDS) {
    if (!goldSpecified.has(field)) continue;
    out[field] = JSON.stringify(fieldValue(primary(got), field)) === JSON.stringify(fieldValue(primary(gold), field));
  }
  return out;
}

function behaviourOf(run, requestId, names) {
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const first = contexts[0]?.semantic_frame ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  return {
    responders: contexts.map((c) => names[c.target_worker_id] ?? c.target_worker_id).sort(),
    facet: first?.predicate ?? interaction?.turn?.primary?.predicate ?? null,
    clarify: contexts.some((c) => c.response_plan?.may_ask_clarifying_question) || first?.discourse_function === "ambiguous_reference",
    silence: contexts.length === 0
  };
}
function compareBehaviour(got, gold) {
  const out = {};
  for (const key of ["responders", "facet", "clarify", "silence"]) if (key in gold) out[key] = JSON.stringify(key === "responders" ? [...gold[key]].sort() : gold[key]) === JSON.stringify(got[key]);
  return out;
}

/** Plays one item through a fresh production service. */
async function evaluateItem(item, { log = () => {}, onInput = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-gold-"));
  const script = new Map();
  const oracle = reader.createOracleReader(script);
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, dialogueReader: oracle });
  service.updateSettings({ provider: "offline" });
  service.log = () => {};
  try {
    const worldId = service.createWorld({ name: "GOLD", seed: item.seed ?? `gold-${item.id}` }).world.id;
    service.createQ4Personnel({ world_id: worldId, first_name: "Jack", last_name: "Tester" });
    service.confirmQ4Personnel({ world_id: worldId });
    service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
    const run = () => service.session(worldId, "field-researcher").run;
    const playerId = run().session.startup.player.observer_id;
    const team = () => run().expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId);
    const wanted = item.names ?? SCENE_NAMES;
    const world = service.getWorld(worldId);
    team().forEach((m, i) => {
      if (!wanted[i]) return;
      const id = m.personnel_id ?? m.id;
      m.first_name = wanted[i];
      m.display_name = `${wanted[i]} ${m.last_name}`;
      for (const w of [world, run()._world]) { const c = w?.characters?.[id]; if (c) { c.first_name = wanted[i]; c.display_name = `${wanted[i]} ${c.last_name}`; } }
    });
    service.persistSession(world, "field-researcher", service.session(worldId, "field-researcher"));
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    for (let b = 0; b < 3; b += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
    const names = Object.fromEntries(team().map((m) => [m.personnel_id ?? m.id, m.first_name]));
    // Prefix: real turns, real ledger. Checkpoints are canonical assertions, not re-parsing.
    let n = 0;
    for (const step of item.prefix ?? []) {
      await service.submitQ4Communication({ world_id: worldId, channel: "local", text: step.text, request_id: `p-${++n}` });
      const problem = checkpointProblem(step.checkpoint, run(), names);
      if (problem) return { id: item.id, status: "prefix_invalid", at: n, problem };
    }
    // Target turn: the oracle returns the gold frame (resolved against this turn's own ReaderInput labels).
    const targetId = "target";
    script.set(targetId, (input) => { onInput?.(input); return item.gold?.frame ? completeFrame(resolveGoldFrame(item.gold.frame, input)) : null; });
    await service.submitQ4Communication({ world_id: worldId, channel: "local", text: item.utterance, request_id: targetId });
    const record = service.readerReceipts.get(targetId);
    if (!record) return { id: item.id, status: "no_seam_record" };
    const goldFrame = record.receipt.frame;
    const goldSpecified = new Set(Object.keys(item.gold?.frame?.acts?.at(-1) ?? {}));
    const readerCompare = goldFrame ? compareFrames(record.legacy_v0.frame, goldFrame, goldSpecified) : {};
    const gotBehaviour = behaviourOf(run(), targetId, names);
    const behaviour = item.gold?.behavior ? compareBehaviour(gotBehaviour, item.gold.behavior) : {};
    let resolver;
    try { resolveTurn(goldFrame, null, [], {}); resolver = { status: "evaluated" }; } catch (e) { resolver = { status: e.code === "RESOLVER_NOT_IMPLEMENTED" ? "not_implemented" : "error", detail: e.message }; }
    return {
      id: item.id, status: "scored", utterance: item.utterance,
      gold_frame_verdict: record.receipt.verdict,
      reader: { id: record.legacy_v0.reader.id, fields: readerCompare, routing_match: ROUTING_FIELDS.filter((f) => f in readerCompare).every((f) => readerCompare[f]) },
      resolver,
      behaviour: { got: gotBehaviour, fields: behaviour, correct: Object.values(behaviour).every(Boolean) }
    };
  } finally {
    try { service.shutdown?.(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    log(item.id);
  }
}

function checkpointProblem(checkpoint, run, names) {
  if (!checkpoint) return null;
  const requests = run.expedition.dialogue_state?.requests ?? [];
  for (const want of checkpoint.requests ?? []) {
    const hit = [...requests].reverse().find((r) => r.predicate === want.predicate && (!want.targets || JSON.stringify(r.targets.map((id) => names[id] ?? id).sort()) === JSON.stringify([...want.targets].sort())) && (!want.state || r.state === want.state));
    if (!hit) return { expected: want, ledger: requests.slice(-4).map((r) => ({ predicate: r.predicate, targets: r.targets.map((id) => names[id] ?? id), state: r.state })) };
  }
  if ("inbound" in checkpoint) {
    const pending = (run.expedition.dialogue_state?.inbound_requests ?? []).length > 0;
    if (pending !== checkpoint.inbound) return { expected: { inbound: checkpoint.inbound }, got: { inbound: pending } };
  }
  return null;
}

function summarize(results) {
  const scored = results.filter((r) => r.status === "scored");
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
  const field = {};
  for (const r of scored) for (const [k, v] of Object.entries(r.reader.fields)) { field[k] ??= { n: 0, correct: 0 }; field[k].n += 1; if (v) field[k].correct += 1; }
  for (const v of Object.values(field)) v.pct = pct(v.correct, v.n);
  const withBehaviour = scored.filter((r) => Object.keys(r.behaviour.fields).length);
  const routingMatched = withBehaviour.filter((r) => r.reader.routing_match);
  return {
    version: GOLD_EVAL_VERSION,
    items: results.length,
    scored: scored.length,
    prefix_invalid: results.filter((r) => r.status === "prefix_invalid").map((r) => r.id),
    gold_frames_rejected_by_validators: scored.filter((r) => r.gold_frame_verdict && !r.gold_frame_verdict.ok).map((r) => ({ id: r.id, verdict: r.gold_frame_verdict.disposition })),
    reader: { id: scored[0]?.reader.id ?? null, fields: field },
    resolver_spec: { status: scored.every((r) => r.resolver.status === "not_implemented") ? "not_implemented (Phase 1)" : "evaluated", conditional_proxy: { note: "production behaviour on items whose legacy frame matched gold on routing fields", n: routingMatched.length, correct: routingMatched.filter((r) => r.behaviour.correct).length, pct: pct(routingMatched.filter((r) => r.behaviour.correct).length, routingMatched.length) } },
    behaviour: { n: withBehaviour.length, correct: withBehaviour.filter((r) => r.behaviour.correct).length, pct: pct(withBehaviour.filter((r) => r.behaviour.correct).length, withBehaviour.length) }
  };
}

async function evaluateGold(items, { log = () => {} } = {}) {
  const results = [];
  for (const item of items) results.push(await evaluateItem(item, { log }));
  return { summary: summarize(results), results };
}

/** The ReaderInput a labeler sees for an item's target turn (label space for writing a gold frame). */
async function showInput(item) {
  let captured = null;
  await evaluateItem({ ...item, gold: {} }, { onInput: (input) => { captured = input; } });
  return captured;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node tools/dialogue-gold-eval.js <items.jsonl> [--json] [--show-input <id>]"); process.exit(2); }
  const items = readJsonl(file);
  const show = process.argv.indexOf("--show-input");
  if (show >= 0) { const item = items.find((x) => x.id === process.argv[show + 1]); console.log(JSON.stringify(await showInput(item), null, 2)); return; }
  const { summary, results } = await evaluateGold(items, { log: (l) => process.stderr.write(`${l}\n`) });
  console.log(JSON.stringify(process.argv.includes("--json") ? { summary, results } : summary, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { GOLD_EVAL_VERSION, evaluateGold, evaluateItem, resolveGoldFrame, completeFrame, compareFrames, summarize, readJsonl, showInput };
