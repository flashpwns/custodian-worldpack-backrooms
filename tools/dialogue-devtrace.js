"use strict";

// ED-30 M1 developer trace and I6 transcript records. DEVELOPER-ONLY: callers gate on developer mode; nothing
// here is ever part of the player-facing projection. Everything is read from what the turn already stored
// (turn record, response contexts, the request ledger, the wording trace) -- no second tracing system and
// no hidden world state beyond what the committed plans already carried.

const dialogueState = require("./dialogue-state");
const dialogueClaims = require("./dialogue-claims");
const personhood = require("./dialogue-personhood");

const TRANSCRIPT_VERSION = "yellow-beast-dialogue-transcript@v1";

const nameIndex = (run) => {
  const out = {};
  for (const m of run?.expedition?.team?.members ?? []) out[m.personnel_id ?? m.id] = m.first_name ?? m.display_name ?? null;
  return out;
};
const peopleOf = (run, playerId) => (run?.expedition?.team?.members ?? []).filter((m) => (m.personnel_id ?? m.id) !== playerId).map((m) => ({ id: m.personnel_id ?? m.id, name: m.first_name, names: [m.first_name, m.display_name].filter(Boolean) }));

/** The provider-independent semantic record of one turn (the transcript's `observed` and default `expect`). */
function semanticTurn(run, requestId) {
  const names = nameIndex(run);
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const first = contexts[0]?.semantic_frame ?? null;
  const requests = (run.expedition.dialogue_state?.requests ?? []).filter((r) => r.submission_id === requestId);
  return {
    address: interaction?.address ? { scope: interaction.address.scope, to: (interaction.address.addressee_ids ?? []).map((id) => names[id] ?? id) } : null,
    speech_act: interaction?.turn?.primary?.speech_act ?? null,
    predicate: first?.predicate ?? interaction?.turn?.primary?.predicate ?? null,
    fn: first?.discourse_function ?? null,
    cardinality: first?.turn?.cardinality ?? null,
    temporal: first?.turn?.temporal_scope ?? null,
    clarify: contexts.some((c) => c.response_plan?.may_ask_clarifying_question) || first?.discourse_function === "ambiguous_reference",
    owners: contexts.map((c) => names[c.target_worker_id] ?? c.target_worker_id),
    requests: requests.map((r) => ({ predicate: r.predicate, state: r.state }))
  };
}

/** M1: the full developer trace of one committed turn. */
function turnTrace(run, requestId, { wordsmith = null } = {}) {
  const names = nameIndex(run);
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const people = peopleOf(run, playerId);
  const receipt = (run.expedition.communication_receipts ?? []).find((r) => r.id === requestId) ?? null;
  const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === requestId) ?? null;
  const contexts = receipt?.response_contexts ?? [];
  const spoken = (run.expedition.dialogue_history ?? []).filter((e) => e.submission_id === requestId && e.speaker_id !== playerId);
  const record = interaction?.turn ?? null;
  const dis = dialogueState.snapshot(run, { player_id: playerId, present_ids: people.map((p) => p.id) });
  const requests = (run.expedition.dialogue_state?.requests ?? []).filter((r) => r.submission_id === requestId || (record?.request_ids ?? []).includes(r.request_id));
  const wordsmiths = wordsmith?.wordsmiths ?? [];
  const lines = spoken.map((event) => {
    const context = contexts.find((c) => c.target_worker_id === event.speaker_id) ?? null;
    const contribution = context?.authorized_contribution ?? { required_facts: context?.response_plan?.required_facts ?? [], optional_facts: context?.response_plan?.optional_facts ?? [] };
    const ws = wordsmiths.find((w) => w.responder_id === event.speaker_id) ?? null;
    return {
      speaker: names[event.speaker_id] ?? event.speaker_id,
      text: event.text,
      propositions: dialogueClaims.extractPropositions(event.text, { people, speaker_id: event.speaker_id, speaker_name: names[event.speaker_id] }).map((p) => ({ clause: p.clause, subject: p.subject, families: p.families, polarity: p.polarity, reported: p.reported })),
      private_state_check: dialogueClaims.validatePersonalClaims(event.text, contribution, { people, speaker_id: event.speaker_id, speaker_name: names[event.speaker_id] }),
      responsiveness: dialogueClaims.validateResponsiveness(event.text, contribution, { people, speaker_id: event.speaker_id, speaker_name: names[event.speaker_id] }),
      candidate_produced: ws ? ws.candidate_produced : null,
      validator_accepted: ws ? ws.validator_accepted : null,
      rejection_reason: ws?.rejection_reason ?? null,
      rejection_detail: ws?.validation_reason ?? null,
      candidate: typeof ws?.raw_candidate === "string" ? ws.raw_candidate : (ws?.raw_candidate?.speech ?? null),
      replans: ws && !ws.validator_accepted && ws.candidate_produced ? 1 : 0,
      fallback_used: ws ? ws.fallback_used : true,
      source: ws?.output_source ?? "deterministic"
    };
  });
  return {
    developer_only: true,
    request_id: requestId,
    raw: receipt?.text ?? interaction?.player_text ?? null,
    normalized: record?.normalized ?? null,
    token_repairs: record?.repairs_applied ?? [],
    clauses: record?.clauses ?? [],
    primary: record?.primary ? { ...record.primary, addressee: record.primary.addressee ? { ...record.primary.addressee, names: record.primary.addressee.ids.map((id) => names[id] ?? id) } : null } : null,
    extra_acts: record?.extra_acts ?? [],
    completeness: record?.completeness ?? null,
    // Tier 2: why it was consulted (the Tier-1 gaps), what it returned and whether code accepted it.
    tier2: interaction?.interpretation ? { escalated: Boolean(interaction.interpretation.advisory_validation), validation: interaction.interpretation.advisory_validation ?? null, tier1_gaps: interaction.interpretation.advice?.tier1_missing ?? record?.completeness?.missing ?? [], spans: (interaction.interpretation.advice?.acts ?? []).map((a) => ({ facet: a.facet ?? null, addressee_text: a.addressee_text ?? null, referent_text: a.referent_text ?? null, quantifier: a.quantifier ?? null })), latency_ms: interaction.interpretation.advisory_latency_ms ?? null } : null,
    closes_activity: record?.closes_activity ?? false,
    responders: contexts.map((c) => {
      const f = c.semantic_frame ?? {};
      const plan = c.response_plan ?? {};
      const answer = (plan.required_facts ?? []).find((x) => x.key === "predicate_answer")?.value ?? null;
      return {
        speaker: names[c.target_worker_id] ?? c.target_worker_id,
        discourse_function: f.discourse_function ?? null,
        predicate: f.predicate ?? null,
        cardinality: f.turn?.cardinality ?? null,
        temporal: f.turn?.temporal_scope ?? null,
        polarity_asked: f.question_form ?? null,
        alternatives: f.turn?.alternatives ?? null,
        args: f.turn?.args ?? null,
        deixis: (f.referents ?? []).map((r) => ({ text: r.text ?? r.noun ?? null, type: r.type, resolved: Boolean(r.resolved), id: r.id ?? null })),
        reconciliation_overrides: f.turn?.overrides ?? [],
        tier2: f.advice ? { used: true, accepted: f.advice.accepted ?? null } : null,
        authorized_facts: (plan.required_facts ?? []).map((x) => x.key),
        authorized_entities: [...new Set([f.knowledge_query?.entity?.id, ...(f.referents ?? []).filter((r) => r.resolved).map((r) => r.id)].filter(Boolean))],
        optional_facts: (plan.optional_facts ?? []).map((x) => x.key),
        answer_value: answer ? answer.value : null,
        profile_keys_consulted: answer?.answer ? Object.keys(answer.answer) : [],
        clarify: Boolean(plan.may_ask_clarifying_question),
        request_ids: c.request_ids ?? (c.request_id ? [c.request_id] : [])
      };
    }),
    requests: requests.map((r) => ({ request_id: r.request_id, predicate: r.predicate, state: r.state, targets: r.targets.map((id) => names[id] ?? id), unsatisfied: Object.entries(r.slots ?? {}).filter(([, s]) => !["SATISFIED", "ANSWERED_UNKNOWN", "NOT_ESTABLISHED"].includes(s.state)).map(([id]) => names[id] ?? id), repair_of: r.repair_of ?? null, reissue_of: r.reissue_of ?? null })),
    active_speaker: dis.active_speaker ? (dis.active_speaker.speaker_ids ?? [dis.active_speaker.speaker_id]).map((id) => names[id] ?? id) : null,
    activity: dis.activity ? { kind: dis.activity.kind, template: dis.activity.template?.predicate ?? null, completed: dis.activity.completed.map((id) => names[id] ?? id), pending: dis.activity.pending.map((id) => names[id] ?? id) } : null,
    procedure: { acquaintance: run.expedition.dialogue_state?.acquaintance ? { complete: run.expedition.dialogue_state.acquaintance.complete_at != null, introduced: Object.keys(run.expedition.dialogue_state.acquaintance.introduced ?? {}).map((id) => names[id] ?? id), completed_by: run.expedition.dialogue_state.acquaintance.completed_by ?? null } : null, beat: run.expedition.day1_opener?.beat ?? null },
    lines
  };
}

/** I6: one exportable transcript (JSONL records) of every LOCAL player turn so far. */
function transcriptRecords(run, { world = null, wordsmithTraces = [] } = {}) {
  const names = nameIndex(run);
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const player = (run.expedition.team?.members ?? []).find((m) => (m.personnel_id ?? m.id) === playerId) ?? null;
  const coworkers = (run.expedition.team?.members ?? []).filter((m) => (m.personnel_id ?? m.id) !== playerId);
  const header = {
    kind: "header",
    version: TRANSCRIPT_VERSION,
    scenario: run.scenario ?? null,
    seed: world?.seed ?? run.seed ?? null,
    player: player ? { first_name: player.first_name ?? null, last_name: player.last_name ?? null } : null,
    coworkers: coworkers.map((m, slot) => ({ slot, name: m.first_name, archetype: m.archetype ?? null, profile: personhood.profileOf ? (() => { const p = personhood.profileOf(run, m.personnel_id ?? m.id); return p ? { async_tenure: p.async_tenure, expedition_experience: p.expedition_experience, complex_experience: p.complex_experience } : null; })() : null })),
    exported_at: new Date().toISOString(),
    note: "expect = what the engine should do on each turn (frame fields, never wording). Edit a turn's expect to the intended behaviour to turn it into a failing regression; see docs/dialogue/TRANSCRIPT_REGRESSION.md."
  };
  const turns = (run.expedition.communication_receipts ?? []).filter((r) => String(r.channel ?? "local").toLowerCase() === "local" && r.text).map((receipt, index) => {
    const observed = semanticTurn(run, receipt.id);
    const spoken = (run.expedition.dialogue_history ?? []).filter((e) => e.submission_id === receipt.id && e.speaker_id !== playerId);
    const wordsmith = wordsmithTraces.find((t) => t.request_id === receipt.id) ?? null;
    const interaction = (run.expedition.interaction_history ?? []).find((i) => i.submission_id === receipt.id) ?? null;
    return { kind: "turn", n: index + 1, request_id: receipt.id, beat: interaction?.turn?.beat ?? null, player: receipt.text, npc: spoken.map((e) => ({ speaker: names[e.speaker_id] ?? e.speaker_id, text: e.text })), observed, expect: structuredClone(observed), trace: turnTrace(run, receipt.id, { wordsmith }) };
  });
  return [header, ...turns];
}

module.exports = { TRANSCRIPT_VERSION, semanticTurn, turnTrace, transcriptRecords };
