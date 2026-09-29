#!/usr/bin/env node
"use strict";

// Reader Phase 0 -- CHARACTERIZATION of current production dialogue behaviour (developer tooling only).
//
// Drives the REAL production service (DesktopService, via dialogue-session) over the existing deterministic
// fixtures and records, per turn, what the shipped composition decided:
//   effective acts · selected responders · facet · relation · ledger mutation · clarification decision ·
//   planner input shape (the semantic frame each responder's plan was built from) · plan shape.
// Wording is never recorded (only a digest of the deterministic fallback lines), so the record is a statement
// about semantics, not prose.
//
// The committed snapshot (docs/acceptance/reader-phase0/characterization.json) is the EQUIVALENCE AUTHORITY
// for the Phase-1 resolver extraction: any later difference must be explicit and reviewed.
//
//   node tools/dialogue-characterize.js --out <file>      write a snapshot
//   node tools/dialogue-characterize.js --check <file>    re-run and diff against a snapshot (exit 1 on drift)
//   [--quick]                                            only the J15 + transcript sessions (no dev probes)

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { openSession } = require("./dialogue-session");
const dialogueState = require("./dialogue-state");

const ROOT = path.join(__dirname, "..");
const CHARACTERIZATION_VERSION = "yellow-beast-dialogue-characterization@v1";
const SCENE_NAMES = ["Giselle", "Malcolm", "Tonya"];
const PROVIDERS = ["fallback", "garbage"];
const FIXTURE_DIR = path.join(ROOT, "tests", "fixtures", "ed30");

const sha = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

/** The fixture sessions: J15 scripts, checked-in transcripts, and the dev corpora as single-turn probes. */
function collectFixtures({ quick = false } = {}) {
  const sessions = [];
  const j15 = path.join(FIXTURE_DIR, "j15");
  for (const file of fs.readdirSync(j15).filter((f) => f.endsWith(".txt")).sort()) {
    const lines = fs.readFileSync(path.join(j15, file), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith(":"));
    sessions.push({ id: `j15/${file}`, kind: "script", seed: `char-j15-${file}`, names: SCENE_NAMES, lines: lines.map((text) => ({ text })) });
  }
  const transcripts = path.join(FIXTURE_DIR, "transcripts");
  for (const file of fs.readdirSync(transcripts).filter((f) => f.endsWith(".jsonl")).sort()) {
    const records = readJsonl(path.join(transcripts, file));
    const header = records.find((r) => r.kind === "header") ?? {};
    sessions.push({ id: `transcripts/${file}`, kind: "transcript", seed: header.seed ?? "replay", names: (header.coworkers ?? []).map((c) => c.name), player: header.player ?? undefined, brief: false, lines: records.filter((r) => r.kind === "turn").map((t) => ({ text: t.player, beat: t.beat ?? null })) });
  }
  if (!quick) {
    // Dev-corpus items are characterized as context-free single-turn probes: production behaviour on that
    // line from a fresh post-briefing state. (Their authored context is NOT rebuilt by re-parsing prose.)
    for (const corpus of ["dev-corpus.jsonl", "dev-h.jsonl", "dev-novel.jsonl"]) {
      for (const item of readJsonl(path.join(FIXTURE_DIR, corpus))) {
        const c = item.context ?? {};
        const contextDependent = Boolean(c.last_npc_line || c.last_player_line || c.pending_unanswered_request || c.active_activity || c.active_speaker || (c.activity_done ?? []).length);
        sessions.push({ id: `${corpus}#${item.id}`, kind: "probe", seed: "char-probe", names: SCENE_NAMES, lines: [{ text: item.utterance }], context_dependent: contextDependent });
      }
    }
  }
  return sessions;
}

/** A stable, name-keyed view of the ledger (request ids -> ordinals, person ids -> names). */
function ledgerView(run, names) {
  const state = run.expedition.dialogue_state ?? {};
  const n = (id) => names[id] ?? id;
  return {
    requests: (state.requests ?? []).map((r) => ({ predicate: r.predicate ?? null, fn: r.fn ?? null, state: r.state, targets: (r.targets ?? []).map(n), answered_by: Object.values(r.slots ?? {}).filter((v) => v?.responder_id).map((v) => n(v.responder_id)), slots: Object.fromEntries(Object.entries(r.slots ?? {}).map(([k, v]) => [n(k), v?.state ?? v])), cardinality: r.cardinality ?? null, temporal: r.temporal ?? null, question_form: r.question_form ?? null })),
    repairs: (state.repairs ?? []).length,
    activities: (state.activities ?? []).map((a) => ({ kind: a.kind, state: a.state ?? null, completed: (a.completed ?? []).map(n), pending: (a.pending ?? []).map(n) })),
    inbound: (state.inbound_requests ?? []).length,
    acquaintance_complete: state.acquaintance?.complete_at != null,
    learning: (state.learning ?? []).length,
    anchors: (state.surface_anchors ?? []).length
  };
}

/** What one turn did to the ledger (opened / changed requests; counters). */
function ledgerDiff(before, after) {
  const opened = after.requests.slice(before.requests.length).map((r, i) => ({ r: before.requests.length + i, ...r }));
  const changed = [];
  before.requests.forEach((r, i) => {
    const a = after.requests[i];
    if (a && JSON.stringify(a) !== JSON.stringify(r)) changed.push({ r: i, state: r.state === a.state ? a.state : `${r.state}->${a.state}`, answered_by: a.answered_by, slots: a.slots });
  });
  const delta = {};
  for (const key of ["repairs", "inbound", "learning", "anchors"]) if (after[key] !== before[key]) delta[key] = after[key] - before[key];
  if (JSON.stringify(after.activities) !== JSON.stringify(before.activities)) delta.activities = after.activities;
  if (after.acquaintance_complete !== before.acquaintance_complete) delta.acquaintance_complete = after.acquaintance_complete;
  return { opened, changed, ...delta };
}

const REQUEST_ORDINAL = (run) => { const ids = (run.expedition.dialogue_state?.requests ?? []).map((r) => r.request_id); return (id) => (id == null ? null : ids.includes(id) ? `r${ids.indexOf(id)}` : "r?"); };
function actView(x, n, rid) {
  if (!x) return null;
  return {
    speech_act: x.speech_act ?? null, question_form: x.question_form ?? null, relation: x.relation ?? null, relation_target: rid(x.relation_target), reissue_of: rid(x.reissue_of),
    predicate: x.predicate ?? null, facet_source: x.facet_source ?? null,
    addressee: x.addressee ? { kind: x.addressee.kind, names: (x.addressee.ids ?? []).map(n), quantifier: x.addressee.quantifier ?? null, source: x.addressee.source ?? null } : null,
    cardinality: x.cardinality ?? null, temporal_scope: x.temporal_scope ?? null, clarify: x.clarify?.reason ?? (x.clarify ? true : null)
  };
}
// Planner-input key sets are recorded once (legend) and referenced by digest from every turn.
const KEY_SETS = new Map();
function keySet(keys) { const sorted = [...keys].sort(); const id = sha(sorted).slice(0, 10); KEY_SETS.set(id, sorted); return id; }
function frameView(f, n) {
  if (!f) return null;
  const turn = f.turn ?? {};
  return {
    keys: keySet(Object.keys(f)),
    discourse_function: f.discourse_function ?? null, predicate: f.predicate ?? null, speech_act: f.speech_act ?? null, target_scope: f.target_scope ?? null,
    referents: (f.referents ?? []).map((r) => ({ type: r.type, id: r.id ?? null, resolved: Boolean(r.resolved), source: r.source ?? null })),
    knowledge_query: f.knowledge_query ? { concept: f.knowledge_query.concept ?? null, entity: f.knowledge_query.entity?.id ?? null } : null,
    unresolved_reference: Boolean(f.unresolved_reference), expected_response_shape: f.expected_response_shape ?? null,
    requested_action: f.requested_action ? { kind: f.requested_action.kind ?? f.requested_action.action ?? null, actor: f.requested_action.actor_id ? n(f.requested_action.actor_id) : null } : null,
    resumed_question: Boolean(f.resumed_question), antecedent_resolved: f.antecedent ? Boolean(f.antecedent.resolved) : null,
    turn: { speech_act: turn.speech_act ?? null, relation: turn.relation ?? null, cardinality: turn.cardinality ?? null, temporal_scope: turn.temporal_scope ?? null, addressee: (turn.addressee_ids ?? []).map(n), args: turn.args ? Object.keys(turn.args).sort() : [] }
  };
}
function planView(p) {
  if (!p) return null;
  return { fn: p.discourse_function ?? null, required: (p.required_facts ?? []).map((f) => f.key), optional: (p.optional_facts ?? []).map((f) => f.key), clarify: Boolean(p.may_ask_clarifying_question), asks_player: Boolean(p.asks_player), expected_slot: p.expected_slot ?? null };
}

/** One characterized turn: read from what the production service committed. */
function turnRecordOf(session, requestId, before, text, result) {
  const run = session.run;
  const names = Object.fromEntries(session.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
  const n = (id) => names[id] ?? (id === session.playerId ? "player" : id);
  const rid = REQUEST_ORDINAL(run);
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const record = interaction?.turn ?? null;
  const spoken = (run.expedition.dialogue_history ?? []).filter((e) => e.submission_id === requestId && e.speaker_id !== session.playerId);
  const after = ledgerView(run, names);
  const primary = record?.primary ?? null;
  const first = contexts[0]?.semantic_frame ?? null;
  return {
    text,
    ok: result?.ok !== false,
    error: result?.ok === false ? (result.error?.code ?? "error") : null,
    address: interaction?.address ? { scope: interaction.address.scope ?? null, to: (interaction.address.addressee_ids ?? []).map(n), form: interaction.address.address_form ?? null } : null,
    effective: { primary: actView(primary, n, rid), extra: (record?.extra_acts ?? []).map((x) => ({ speech_act: x.speech_act, predicate: x.predicate ?? null })) },
    responders: contexts.map((c) => n(c.target_worker_id)),
    facet: first?.predicate ?? primary?.predicate ?? null,
    relation: primary?.relation ?? null,
    ledger: ledgerDiff(before, after),
    clarify: { decided: contexts.some((c) => c.response_plan?.may_ask_clarifying_question) || first?.discourse_function === "ambiguous_reference", reason: primary?.clarify?.reason ?? null },
    planner_input: contexts.map((c) => ({ who: n(c.target_worker_id), frame: frameView(c.semantic_frame, n) })),
    plans: contexts.map((c) => ({ who: n(c.target_worker_id), plan: planView(c.response_plan) })),
    tier2: record?.advisory_state ? { accepted: Boolean(record.advisory_state.accepted), reason: record.advisory_state.reason ?? null } : null,
    lines_digest: sha(spoken.map((e) => `${n(e.speaker_id)}|${e.text}`))
  };
}

async function characterizeSession(spec, provider) {
  const session = await openSession({ provider, seed: spec.seed, names: spec.names?.length ? spec.names : null, player: spec.player, brief: spec.brief !== false });
  const turns = [];
  try {
    let i = 0;
    for (const line of spec.lines) {
      if (line.beat === "LOCAL_INTRODUCTIONS" && session.run.expedition.day1_opener?.beat !== "LOCAL_INTRODUCTIONS") session.brief();
      const names = Object.fromEntries(session.coworkers().map((m) => [m.personnel_id ?? m.id, m.first_name]));
      const before = ledgerView(session.run, names);
      const requestId = `char-${++i}`;
      const result = await session.service.submitQ4Communication({ world_id: session.worldId, channel: "local", text: line.text, request_id: requestId });
      turns.push(turnRecordOf(session, requestId, before, line.text, result));
    }
  } finally { await session.close(); }
  return turns;
}

async function characterize({ quick = false, providers = PROVIDERS, log = () => {} } = {}) {
  const fixtures = collectFixtures({ quick });
  const out = { version: CHARACTERIZATION_VERSION, ledger_version: dialogueState.STATE_VERSION, providers, sessions: [] };
  for (const spec of fixtures) {
    const byProvider = {};
    for (const provider of providers) byProvider[provider] = await characterizeSession(spec, provider);
    out.sessions.push({ id: spec.id, kind: spec.kind, ...(spec.kind === "probe" ? { context_dependent_item: spec.context_dependent } : {}), turns: byProvider });
    log(`${spec.id}: ${spec.lines.length} turn(s)`);
  }
  out.turn_count = out.sessions.reduce((sum, s) => sum + s.turns[providers[0]].length, 0);
  out.planner_input_key_sets = Object.fromEntries([...KEY_SETS.entries()].sort());
  out.digest = sha(out.sessions);
  return out;
}

/** First differences between two snapshots (bounded), for review. */
function diffSnapshots(a, b, limit = 25) {
  const diffs = [];
  const index = new Map((b.sessions ?? []).map((s) => [s.id, s]));
  for (const s of a.sessions ?? []) {
    const other = index.get(s.id);
    if (!other) { diffs.push({ session: s.id, missing: "in second snapshot" }); continue; }
    for (const provider of Object.keys(s.turns)) {
      (s.turns[provider] ?? []).forEach((t, i) => {
        const u = other.turns?.[provider]?.[i];
        if (JSON.stringify(t) !== JSON.stringify(u) && diffs.length < limit) {
          const fields = Object.keys(t).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(u?.[k]));
          diffs.push({ session: s.id, provider, turn: i + 1, text: t.text, fields, was: Object.fromEntries(fields.map((k) => [k, t[k]])), now: Object.fromEntries(fields.map((k) => [k, u?.[k]])) });
        }
      });
    }
  }
  return diffs;
}

/** One session per line (reviewable diffs), header fields first. */
function serialize(snapshot) {
  const { sessions, ...head } = snapshot;
  return `{${Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(",")},"sessions":[\n${sessions.map((s) => JSON.stringify(s)).join(",\n")}\n]}\n`;
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const quick = process.argv.includes("--quick");
  const snapshot = await characterize({ quick, log: (l) => process.stderr.write(`${l}\n`) });
  const out = arg("--out");
  const check = arg("--check");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, serialize(snapshot)); console.log(`wrote ${out}: ${snapshot.sessions.length} sessions, ${snapshot.turn_count} turns, digest ${snapshot.digest}`); }
  if (check) {
    const reference = JSON.parse(fs.readFileSync(check, "utf8"));
    const scoped = quick ? { ...reference, sessions: reference.sessions.filter((s) => s.kind !== "probe") } : reference;
    const diffs = diffSnapshots(scoped, snapshot);
    if (diffs.length) { console.log(JSON.stringify(diffs, null, 2)); console.log(`DRIFT: ${diffs.length} difference(s) against ${check}`); process.exit(1); }
    console.log(`identical to ${check} (${snapshot.sessions.length} sessions, ${snapshot.turn_count} turns${quick ? ", quick" : ""})`);
  }
  if (!out && !check) console.log(JSON.stringify({ sessions: snapshot.sessions.length, turns: snapshot.turn_count, digest: snapshot.digest }));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { CHARACTERIZATION_VERSION, serialize, collectFixtures, characterize, characterizeSession, diffSnapshots, ledgerView, ledgerDiff };
