#!/usr/bin/env node
"use strict";

// Reader Phase 0 / 0.5 -- CHARACTERIZATION of current production dialogue behaviour (developer tooling only).
//
// Drives the REAL production service (DesktopService) over deterministic fixtures and records, per turn and at
// VALUE level, what the shipped composition decided:
//   the effective acts (speech act, question form, relation + target, facet, facet_source, addressee kind / ids /
//   quantifier / source, cardinality, temporal, polarity, args values, repair metadata, clarification,
//   overrides, reopen) -- from the reader seam's legacy record (the stored turn record drops facet_source and
//   overrides); responders; the planner input values (each responder's semantic frame); plans; subject; the
//   request-ledger mutation (requests opened / changed with args, targets, answered_by, slots, state);
//   inbound coworker questions (shape, options); surface anchors added (speaker, sentence, request);
//   the active activity; the canonical event sequence; a provider-independent semantic digest and a
//   persistence-relevant state digest.
// Wording is recorded only as a digest of the deterministic fallback lines. Timing is never recorded.
//
// Fixtures: the J15 scripts, the checked-in transcripts, the dev corpora as context-free probes, and the
// Phase-0.5 scenarios (tests/fixtures/reader-phase0/characterization-scenarios.json: ED-30 test scenarios with
// chip targets, coworker questions through the canonical ledger API, scripted Tier-2 readings, cold reloads).
//
// The committed snapshot (docs/acceptance/reader-phase0/characterization.json) is the EQUIVALENCE AUTHORITY for
// Phase 1; its file digest is pinned by tests/ed31a-reader-phase0.test.js (itself hash-governed in
// verification/verification-authority.json). Regenerating it is a governance change, never a silent refresh.
//
//   node tools/dialogue-characterize.js --out <file>      write a snapshot
//   node tools/dialogue-characterize.js --check <file>    re-run and diff against a snapshot (exit 1 on drift)
//   [--quick] only the J15 + transcript + scenario sessions (no dev probes)   [--census] print branch coverage

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DesktopService } = require("../desktop/service");
const { createLocalModelProvider } = require("./ai-local-model-provider");
const dialogueState = require("./dialogue-state");

const ROOT = path.join(__dirname, "..");
const CHARACTERIZATION_VERSION = "yellow-beast-dialogue-characterization@v2";
const SCENE_NAMES = ["Giselle", "Malcolm", "Tonya"];
const PROVIDERS = ["fallback", "garbage"];
const FIXTURE_DIR = path.join(ROOT, "tests", "fixtures", "ed30");
const SCENARIO_FILE = path.join(ROOT, "tests", "fixtures", "reader-phase0", "characterization-scenarios.json");

const sha = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
const readJsonl = (file) => fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

// ─── providers ─────────────────────────────────────────────────────────────────────────────────────────
/** The real local-provider code over a scripted HTTP layer (the ED-30 tests' `scriptedLocal`). */
function scriptedProvider(responder) {
  const fetchImpl = async (url, options) => {
    const out = await responder(JSON.parse(options.body));
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => ({ id: "c", choices: [{ message: { content: out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ speech: out }) } }] }) };
  };
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:9", fetchImpl, timeout: 300 });
  return { name: "local", model: real.model, presentLocal: (packet) => real.presentLocal(packet), interpretDialogue: (input) => real.interpretDialogue(input) };
}
/** Scripted Tier-2 readings exactly as tests/ed30i's `readings(first, second)`; wording is malformed (fallback). */
function scriptedAdvisory({ first = "NONE", second = "NONE", act = "question", relation = "new" } = {}) {
  return scriptedProvider((body) => {
    const system = body.messages[0].content;
    if (/choose which topic/.test(system)) return { raw: JSON.stringify({ facet: second, confidence: "high" }) };
    if (/classify the LANGUAGE/.test(system)) return { raw: JSON.stringify({ acts: [{ speech_act: act, facet: first, addressee_candidate: null, referent_candidate: null, quantifier: "none", discourse_relation: relation }], confidence: "high" }) };
    return { raw: "{bad" };
  });
}
function providerFor(spec, kind) {
  if (kind === "fallback") return null;
  if (kind === "garbage") return scriptedProvider(() => ({ raw: "{bad" }));
  if (kind === "scripted-advisory") return scriptedAdvisory(spec.advisory ?? {});
  throw new Error(`unknown provider ${kind}`);
}

// ─── a scripted production session (rename, brief, say, chip, coworker question, cold reload) ──────────
function openScenario({ seed, names = SCENE_NAMES, player = { first_name: "Jack", last_name: "Tester" }, provider = null, offline = false, brief = true, serviceOptions = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-char-"));
  const make = () => {
    const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}), ...serviceOptions });
    if (offline) service.updateSettings({ provider: "offline" });
    service.log = () => {};
    return service;
  };
  const s = { root, service: make(), counter: 0 };
  s.worldId = s.service.createWorld({ name: "CHAR", seed }).world.id;
  s.service.createQ4Personnel({ world_id: s.worldId, first_name: player.first_name, last_name: player.last_name });
  s.service.confirmQ4Personnel({ world_id: s.worldId });
  s.service.startSession({ world_id: s.worldId, mode: "field-researcher", scenario: "day1-opener" });
  Object.defineProperty(s, "run", { get: () => s.service.session(s.worldId, "field-researcher").run });
  s.playerId = s.run.session.startup.player.observer_id;
  s.coworkers = () => s.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== s.playerId);
  s.id = (name) => s.coworkers().find((m) => m.first_name === name)?.personnel_id ?? null;
  const world = s.service.getWorld(s.worldId);
  s.coworkers().forEach((m, i) => {
    if (!names?.[i]) return;
    const id = m.personnel_id ?? m.id;
    m.first_name = names[i]; m.display_name = `${names[i]} ${m.last_name}`;
    for (const w of [world, s.run._world]) { const c = w?.characters?.[id]; if (c) { c.first_name = names[i]; c.display_name = `${names[i]} ${c.last_name}`; } }
  });
  s.service.persistSession(world, "field-researcher", s.service.session(s.worldId, "field-researcher"));
  s.brief = () => {
    if (s.run.expedition.day1_opener?.beat === "LOCAL_INTRODUCTIONS") return;
    const act = (action) => s.service.submitAction({ world_id: s.worldId, mode: "field-researcher", action });
    act("ATTEND_BRIEFING"); for (let b = 0; b < 3; b += 1) act("CONTINUE_BRIEFING"); act("CONCLUDE_BRIEFING");
  };
  if (brief) s.brief();
  s.reload = () => {
    s.service.persistSession(s.service.getWorld(s.worldId), "field-researcher", s.service.session(s.worldId, "field-researcher"));
    s.service.shutdown?.();
    s.service = make();
    const resumed = s.service.resumeSession({ world_id: s.worldId, mode: "field-researcher" });
    if (!resumed.ok) throw new Error(`resume failed: ${resumed.error?.message ?? "unknown"}`);
  };
  /** A coworker's question to the player, recorded the canonical way (the ED-30 tests' `coworkerAsks`). */
  s.coworkerAsks = ({ name, predicate = null, text, answer_shape = null, options = [] }) => {
    const id = s.id(name);
    const event = { id: `npc-q-${++s.counter}`, speaker_id: id, speaker_name: name, text, submission_id: null, channel: "local" };
    s.run.expedition.dialogue_history.push(event);
    return dialogueState.recordInboundRequest(s.run, { event_id: event.id, speaker_id: id, text, plan: { asks_player: true, predicate, ...(answer_shape ? { answer_shape, options } : {}) }, request_id: null });
  };
  /** A request nobody answered yet, opened the canonical way (the ED-30 J10 tests' `S.openRequest`). */
  s.openRequest = ({ predicate, fn = "ask_predicate", request_text, targets = "all", cardinality = "one_spokesperson" }) => {
    const ids = targets === "all" ? s.coworkers().map((m) => m.personnel_id ?? m.id) : targets.map(s.id);
    return dialogueState.openRequest(s.run, { predicate, fn, request_text, targets: ids, cardinality });
  };
  s.say = (text, { target = null, request_id = null } = {}) => s.service.submitQ4Communication({ world_id: s.worldId, channel: "local", text, request_id: request_id ?? `char-${++s.counter}`, ...(target ? { target } : {}) });
  s.close = () => { try { s.service.shutdown?.(); } catch {} fs.rmSync(root, { recursive: true, force: true }); };
  return s;
}

// ─── fixtures ──────────────────────────────────────────────────────────────────────────────────────────
function loadScenarios() {
  const doc = JSON.parse(fs.readFileSync(SCENARIO_FILE, "utf8"));
  const ids = doc.option_ids ?? {};
  const resolve = (o) => (typeof o === "string" && o.startsWith("@") ? ids[o.slice(1)] ?? o : o);
  return doc.scenarios.map((sc) => ({
    id: `scenario/${sc.id}`, kind: "scenario", source: sc.source, seed: `char-${sc.id}`, names: SCENE_NAMES, providers: [sc.provider], advisory: sc.advisory ?? null,
    lines: sc.steps.map((st) => (st.say ? { text: st.say, target: st.target ?? null } : st.coworker_asks ? { coworker_asks: { ...st.coworker_asks, options: (st.coworker_asks.options ?? []).map(resolve) } } : st.open_request ? { open_request: { ...st.open_request } } : st.reload ? { reload: true } : st))
  }));
}
/** J15 scripts, checked-in transcripts, scenarios, and (unless quick) the dev corpora as single-turn probes. */
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
  sessions.push(...loadScenarios());
  if (!quick) {
    // Dev-corpus items: context-free single-turn probes (their authored context is NOT rebuilt from prose).
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

// ─── value-level recording ───────────────────────────────────────────────────────────────────────────
/** Canonical ids -> stable names / ordinals, deep (people by first name, requests rN, events eN). */
function normalizer(session) {
  const people = Object.fromEntries(session.run.expedition.team.members.map((m) => [m.personnel_id ?? m.id, (m.personnel_id ?? m.id) === session.playerId ? "player" : m.first_name]));
  const requests = new Map((session.run.expedition.dialogue_state?.requests ?? []).map((r, i) => [r.request_id, `r${i}`]));
  const events = new Map((session.run.expedition.dialogue_history ?? []).map((e, i) => [e.id, `e${i}`]));
  const map = (v) => (typeof v === "string" ? people[v] ?? requests.get(v) ?? events.get(v) ?? v : v);
  const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : map(v));
  return deep;
}
function ledgerView(run) {
  const state = run.expedition.dialogue_state ?? {};
  return {
    requests: (state.requests ?? []).map((r) => ({ request_id: r.request_id, predicate: r.predicate ?? null, fn: r.fn ?? null, state: r.state, targets: [...(r.targets ?? [])], answered_by: Object.values(r.slots ?? {}).filter((v) => v?.responder_id).map((v) => v.responder_id), slots: Object.fromEntries(Object.entries(r.slots ?? {}).map(([k, v]) => [k, v?.state ?? v])), cardinality: r.cardinality ?? null, temporal: r.temporal ?? null, question_form: r.question_form ?? null, relation: r.relation ?? null, reissue_of: r.reissue_of ?? null, args: r.args ? structuredClone(r.args) : null })),
    repairs: (state.repairs ?? []).length,
    activities: (state.activities ?? []).map((a) => ({ kind: a.kind, state: a.state ?? null, completed: [...(a.completed ?? [])], pending: [...(a.pending ?? [])] })),
    inbound: (state.inbound_requests ?? []).map((x) => ({ event_id: x.event_id, from: x.speaker_id, kind: x.kind, predicate: x.predicate ?? null, answer_shape: x.answer_shape ?? null, options: [...(x.options ?? [])] })),
    anchors: (state.surface_anchors ?? []).map((a) => ({ event_id: a.event_id, speaker: a.speaker_id, spans: (a.spans ?? []).map((s) => ({ text: s.text, request: s.request_id ?? null, predicate: s.predicate ?? null })) })),
    acquaintance_complete: state.acquaintance?.complete_at != null,
    learning: (state.learning ?? []).length
  };
}
function ledgerDiff(before, after) {
  const beforeIds = new Set(before.requests.map((r) => r.request_id));
  const opened = after.requests.filter((r) => !beforeIds.has(r.request_id));
  const changed = after.requests.filter((r) => beforeIds.has(r.request_id)).map((r) => ({ r, was: before.requests.find((x) => x.request_id === r.request_id) })).filter(({ r, was }) => JSON.stringify(r) !== JSON.stringify(was)).map(({ r, was }) => ({ request_id: r.request_id, state: was.state === r.state ? r.state : `${was.state}->${r.state}`, answered_by: r.answered_by, slots: r.slots }));
  const known = new Set(before.inbound.map((x) => x.event_id));
  const anchorsKnown = new Set(before.anchors.map((x) => x.event_id));
  const out = { opened, changed, inbound_added: after.inbound.filter((x) => !known.has(x.event_id)), anchors_added: after.anchors.filter((a) => !anchorsKnown.has(a.event_id)) };
  if (after.repairs !== before.repairs) out.repairs = after.repairs - before.repairs;
  if (after.learning !== before.learning) out.learning = after.learning - before.learning;
  if (JSON.stringify(after.activities) !== JSON.stringify(before.activities)) out.activities = after.activities;
  if (after.acquaintance_complete !== before.acquaintance_complete) out.acquaintance_complete = after.acquaintance_complete;
  return out;
}
function frameValues(f) {
  if (!f) return null;
  const t = f.turn ?? {};
  return {
    discourse_function: f.discourse_function ?? null, predicate: f.predicate ?? null, speech_act: f.speech_act ?? null, target_scope: f.target_scope ?? null,
    requested_content: f.requested_content ?? null, expected_response_shape: f.expected_response_shape ?? null, expected_slot: f.expected_slot ?? null,
    referents: (f.referents ?? []).map((r) => ({ type: r.type, id: r.id ?? null, resolved: Boolean(r.resolved), source: r.source ?? null, holder: r.holder ?? null })),
    knowledge_query: f.knowledge_query ? { concept: f.knowledge_query.concept ?? null, entity: f.knowledge_query.entity?.id ?? null, subject: f.knowledge_query.subject ?? null, facet: f.knowledge_query.facet ?? null } : null,
    unresolved_reference: Boolean(f.unresolved_reference), resumed_question: Boolean(f.resumed_question), antecedent_resolved: f.antecedent ? Boolean(f.antecedent.resolved) : null,
    requested_action: f.requested_action ? { kind: f.requested_action.kind ?? f.requested_action.action ?? null, actor: f.requested_action.actor_id ?? null } : null,
    self_state_query: f.self_state_query ?? null, player_claim: Boolean(f.player_claim), topic_return: Boolean(f.topic_return),
    turn: { speech_act: t.speech_act ?? null, relation: t.relation ?? null, relation_target: t.relation_target ?? null, reissue_of: t.reissue_of ?? null, cardinality: t.cardinality ?? null, temporal_scope: t.temporal_scope ?? null, quantifier: t.quantifier ?? null, clarify_reason: t.clarify_reason ?? null, addressee: [...(t.addressee_ids ?? [])], args: t.args ? structuredClone(t.args) : {}, overrides: (t.overrides ?? []).map((o) => ({ ...o })) }
  };
}
function planValues(p) {
  if (!p) return null;
  return { fn: p.discourse_function ?? null, required: (p.required_facts ?? []).map((f) => f.key), optional: (p.optional_facts ?? []).map((f) => f.key), clarify: Boolean(p.may_ask_clarifying_question), asks_player: Boolean(p.asks_player), expected_slot: p.expected_slot ?? null, answer: (p.required_facts ?? []).find((f) => f.key === "predicate_answer")?.value?.value ?? null };
}
function subjectOf(frame) {
  const args = frame?.turn?.args ?? {};
  if (args.third_party_subject) return { kind: "named", id: args.third_party_subject };
  if (args.subject_ids?.length) return { kind: "named", ids: [...args.subject_ids] };
  if (frame?.knowledge_query?.entity?.kind === "person") return { kind: "named", id: frame.knowledge_query.entity.id };
  return frame?.predicate && String(frame.predicate).startsWith("person.") ? { kind: "addressee" } : null;
}

/**
 * Where the turn's final facet came from, using production's own labels (tier1_registry, item_role,
 * discourse_followup, surface_anchor, tier2_advisory, inbound_counter) and, where production leaves the label
 * empty: the ledger antecedent it was inherited from (inherited_request / inherited_activity), the legacy
 * semantic frame's route (legacy_frame), or none. Attribution only -- never a production decision.
 */
function facetAttribution(primary, frame) {
  const facet = frame?.predicate ?? primary?.predicate ?? null;
  if (!facet) return null;
  if (primary?.predicate && primary.facet_source && primary.facet_source !== "unattributed") return primary.facet_source;
  if (primary?.predicate) {
    if (primary.activity) return "inherited_activity";
    if (primary.relation_target || primary.reissue_of || ["repair", "continuation", "attention"].includes(primary.relation)) return "inherited_request";
    return "legacy_other";
  }
  return "legacy_frame";
}

function turnRecordOf(session, requestId, before, step, result) {
  const run = session.run;
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const seam = session.service.readerReceipts.get(requestId);
  const first = contexts[0]?.semantic_frame ?? null;
  const after = ledgerView(run);
  const snap = dialogueState.snapshot(run, { player_id: session.playerId, location_id: run.spatial?.player_location ?? null, present_ids: session.coworkers().map((m) => m.personnel_id ?? m.id) });
  const events = (run.expedition.dialogue_history ?? []).filter((e) => e.submission_id === requestId).map((e) => ({ id: e.id, kind: e.kind ?? null, speaker: e.speaker_id, channel: e.channel ?? null }));
  const spoken = (run.expedition.dialogue_history ?? []).filter((e) => e.submission_id === requestId && e.speaker_id !== session.playerId);
  const legacy = seam?.legacy ?? null;
  const primary = legacy?.primary_used ?? null;
  const record = {
    text: step.text, target: step.target ?? null,
    ok: result?.ok !== false, error: result?.ok === false ? (result.error?.code ?? "error") : null,
    address: interaction?.address ? { scope: interaction.address.scope ?? null, to: [...(interaction.address.addressee_ids ?? [])], form: interaction.address.address_form ?? null, source: interaction.address.source ?? null } : null,
    effective: legacy ? { primary, acts: legacy.effective, primary_index: legacy.primary_index, social: legacy.social, completeness: legacy.completeness, advisory: legacy.advisory } : null,
    speech_act: primary?.speech_act ?? interaction?.turn?.primary?.speech_act ?? null,
    facet: first?.predicate ?? primary?.predicate ?? null,
    facet_source: facetAttribution(primary, first),
    subject: subjectOf(first),
    responders: contexts.map((c) => c.target_worker_id),
    cardinality: first?.turn?.cardinality ?? primary?.cardinality ?? null,
    relation: { kind: primary?.relation ?? null, target: primary?.relation_target ?? null, reissue_of: primary?.reissue_of ?? null, reopen: primary?.reopen ?? false },
    polarity: primary?.polarity ?? null,
    repair: primary?.repair ?? null,
    overrides: first?.turn?.overrides ?? primary?.overrides ?? [],
    temporal_scope: first?.turn?.temporal_scope ?? primary?.temporal_scope ?? null,
    args: first?.turn?.args ?? primary?.args ?? {},
    clarify: { decided: contexts.some((c) => c.response_plan?.may_ask_clarifying_question) || first?.discourse_function === "ambiguous_reference", reason: primary?.clarify?.reason ?? first?.turn?.clarify_reason ?? null, slot: primary?.clarify?.slot ?? first?.expected_slot ?? null },
    ledger: ledgerDiff(before, after),
    active_activity: snap.activity ? { kind: snap.activity.kind, completed: [...snap.activity.completed], pending: [...snap.activity.pending] } : null,
    active_speaker: snap.active_speaker ? [...(snap.active_speaker.speaker_ids ?? [])] : null,
    pending_inbound: snap.pending_inbound_request ? { from: snap.pending_inbound_request.from ?? snap.pending_inbound_request.speaker_id ?? null, kind: snap.pending_inbound_request.kind, answer_shape: snap.pending_inbound_request.answer_shape ?? null, options: [...(snap.pending_inbound_request.options ?? [])] } : null,
    planner_input: contexts.map((c) => ({ who: c.target_worker_id, frame: frameValues(c.semantic_frame) })),
    plans: contexts.map((c) => ({ who: c.target_worker_id, plan: planValues(c.response_plan) })),
    events,
    tier2: legacy?.advisory ?? null,
    lines_digest: sha(spoken.map((e) => `${e.speaker_id}|${e.text}`))
  };
  const norm = normalizer(session);
  const out = norm(record);
  // Provider-independent semantics (no wording, no anchors, no events) and the persistence-relevant state.
  out.semantic_digest = sha({ e: out.effective?.primary, r: out.responders, f: out.facet, c: out.cardinality, t: out.temporal_scope, cl: out.clarify, rel: out.relation, l: { o: out.ledger.opened, c: out.ledger.changed, i: out.ledger.inbound_added } });
  out.persistence_digest = sha(norm({ dialogue_state: { requests: after.requests, inbound: after.inbound, activities: after.activities, repairs: after.repairs, acquaintance: after.acquaintance_complete, learning: after.learning }, equipment: Object.fromEntries(Object.entries(run.expedition.equipment ?? {}).map(([k, v]) => [k, v?.holder ?? null])), personhood: (run.expedition.team?.members ?? []).map((m) => m.personhood ? { tenure: m.personhood.async_tenure, first: m.personhood.first_day_at_async, complex: m.personhood.complex_experience, expedition: m.personhood.expedition_experience } : null) }));
  return out;
}

async function characterizeSession(spec, providerKind, { onTurn = null } = {}) {
  const s = openScenario({ seed: spec.seed, names: spec.names?.length ? spec.names : SCENE_NAMES, player: spec.player, provider: providerFor(spec, providerKind), offline: providerKind === "fallback", brief: spec.brief !== false });
  const turns = [];
  try {
    for (const step of spec.lines) {
      if (step.reload) { s.reload(); turns.push({ step: "reload" }); continue; }
      if (step.open_request) { const r = s.openRequest(step.open_request); turns.push({ step: "open_request", request: normalizer(s)({ request_id: r?.request_id ?? null, predicate: r?.predicate ?? null, targets: [...(r?.targets ?? [])], state: r?.state ?? null }) }); continue; }
      if (step.coworker_asks) { const ib = s.coworkerAsks(step.coworker_asks); turns.push({ step: "coworker_asks", inbound: normalizer(s)({ from: ib?.speaker_id ?? null, kind: ib?.kind ?? null, answer_shape: ib?.answer_shape ?? null, options: [...(ib?.options ?? [])] }) }); continue; }
      if (step.beat === "LOCAL_INTRODUCTIONS" && s.run.expedition.day1_opener?.beat !== "LOCAL_INTRODUCTIONS") s.brief();
      const before = ledgerView(s.run);
      const requestId = `char-t${turns.length + 1}`;
      const result = await s.say(step.text, { target: step.target ?? null, request_id: requestId });
      turns.push(turnRecordOf(s, requestId, before, step, result));
      if (onTurn) await onTurn(s, requestId, step, result);
    }
  } finally { s.close(); }
  return turns;
}

/**
 * Plays one fixture through production and calls onTurn(session, requestId, step, result) after every player
 * turn (the shared driver of the characterization, coverage, round-trip and inertness harnesses).
 */
async function playFixture(spec, providerKind, onTurn, { serviceOptions = {}, onEnd = null } = {}) {
  const s = openScenario({ seed: spec.seed, names: spec.names?.length ? spec.names : SCENE_NAMES, player: spec.player, provider: providerFor(spec, providerKind), offline: providerKind === "fallback", brief: spec.brief !== false, serviceOptions });
  let n = 0;
  try {
    for (const step of spec.lines) {
      n += 1; // the same request-id scheme as characterizeSession (char-t<step>), so runs are comparable
      if (step.reload) { s.reload(); continue; }
      if (step.open_request) { s.openRequest(step.open_request); continue; }
      if (step.coworker_asks) { s.coworkerAsks(step.coworker_asks); continue; }
      if (step.beat === "LOCAL_INTRODUCTIONS" && s.run.expedition.day1_opener?.beat !== "LOCAL_INTRODUCTIONS") s.brief();
      const requestId = `char-t${n}`;
      const result = await s.say(step.text, { target: step.target ?? null, request_id: requestId });
      await onTurn(s, requestId, step, result);
    }
    if (onEnd) await onEnd(s);
  } finally { s.close(); }
}

async function characterize({ quick = false, log = () => {} } = {}) {
  const fixtures = collectFixtures({ quick });
  const out = { version: CHARACTERIZATION_VERSION, ledger_version: dialogueState.STATE_VERSION, providers: PROVIDERS, sessions: [] };
  for (const spec of fixtures) {
    const kinds = spec.providers ?? PROVIDERS;
    const byProvider = {};
    for (const provider of kinds) byProvider[provider] = await characterizeSession(spec, provider);
    out.sessions.push({ id: spec.id, kind: spec.kind, ...(spec.source ? { source: spec.source } : {}), ...(spec.kind === "probe" ? { context_dependent_item: spec.context_dependent } : {}), turns: byProvider });
    log(`${spec.id}: ${spec.lines.length} step(s)`);
  }
  out.turn_count = out.sessions.reduce((sum, s) => sum + Object.values(s.turns)[0].filter((t) => t.text != null).length, 0);
  out.census = census(out);
  out.digest = sha(out.sessions);
  return out;
}

/** Which production branches the snapshot exercises (value sets across all turns). */
function census(snapshot) {
  const sets = { speech_act: new Set(), relation: new Set(), addressee_source: new Set(), facet_source: new Set(), clarify_reason: new Set(), request_state: new Set(), reply_kind: new Set(), discourse_function: new Set(), cardinality: new Set(), repair_kind: new Set(), tier2: new Set() };
  let chip = 0, reload = 0, inbound = 0, anchors = 0, reopen = 0;
  for (const s of snapshot.sessions) for (const turns of Object.values(s.turns)) for (const t of turns) {
    if (t.step === "reload") { reload += 1; continue; }
    if (t.step === "coworker_asks") { inbound += 1; continue; }
    if (t.step === "open_request") continue;
    for (const e of t.effective?.acts ?? []) {
      sets.speech_act.add(e.speech_act); sets.relation.add(e.relation);
      if (e.addressee?.source) sets.addressee_source.add(e.addressee.source);
      if (e.facet_source) sets.facet_source.add(e.facet_source);
      if (e.clarify?.reason) sets.clarify_reason.add(e.clarify.reason);
      if (e.args?.reply_kind) sets.reply_kind.add(e.args.reply_kind);
      if (e.repair?.kind) sets.repair_kind.add(e.repair.kind);
      if (e.reopen) reopen += 1;
    }
    if (t.facet_source) sets.facet_source.add(t.facet_source); // turn-level attribution (incl. inherited / legacy frame)
    for (const r of t.ledger?.opened ?? []) sets.request_state.add(r.state);
    for (const c of t.ledger?.changed ?? []) sets.request_state.add(c.state);
    for (const p of t.planner_input ?? []) if (p.frame?.discourse_function) sets.discourse_function.add(p.frame.discourse_function);
    if (t.cardinality) sets.cardinality.add(t.cardinality);
    if (t.tier2) sets.tier2.add(`${t.tier2.accepted ? "accepted" : "rejected"}:${t.tier2.reason}`);
    if (t.target) chip += 1;
    if ((t.ledger?.anchors_added ?? []).length) anchors += 1;
  }
  return { ...Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, [...v].filter((x) => x != null).sort()])), chip_turns: chip, reloads: reload, coworker_questions: inbound, turns_adding_anchors: anchors, reopen_acts: reopen };
}

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
          const fields = Object.keys({ ...t, ...(u ?? {}) }).filter((k) => JSON.stringify(t[k]) !== JSON.stringify(u?.[k]));
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
const fileDigest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const quick = process.argv.includes("--quick");
  const snapshot = await characterize({ quick, log: (l) => process.stderr.write(`${l}\n`) });
  const out = arg("--out");
  const check = arg("--check");
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, serialize(snapshot)); console.log(`wrote ${out}: ${snapshot.sessions.length} sessions, ${snapshot.turn_count} turns, digest ${snapshot.digest}, file sha256 ${fileDigest(out)}`); }
  if (check) {
    const reference = JSON.parse(fs.readFileSync(check, "utf8"));
    const scoped = quick ? { ...reference, sessions: reference.sessions.filter((s) => s.kind !== "probe") } : reference;
    const diffs = diffSnapshots(scoped, snapshot);
    if (diffs.length) { console.log(JSON.stringify(diffs, null, 2)); console.log(`DRIFT: ${diffs.length} difference(s) against ${check}`); process.exit(1); }
    console.log(`identical to ${check} (${snapshot.sessions.length} sessions, ${snapshot.turn_count} turns${quick ? ", quick" : ""})`);
  }
  if (process.argv.includes("--census")) console.log(JSON.stringify(snapshot.census, null, 1));
  if (!out && !check) console.log(JSON.stringify({ sessions: snapshot.sessions.length, turns: snapshot.turn_count, digest: snapshot.digest }));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { CHARACTERIZATION_VERSION, SCENE_NAMES, playFixture, serialize, fileDigest, collectFixtures, loadScenarios, openScenario, providerFor, scriptedAdvisory, characterize, characterizeSession, census, diffSnapshots, ledgerView, ledgerDiff, normalizer };
