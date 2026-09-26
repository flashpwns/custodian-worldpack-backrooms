"use strict";

// Canonical personal profiles for generated coworkers (ED-30 E1/E2).
//
// A coworker existed before the player spoke to them: ordinary human questions ("Is it your first day?",
// "Have you been in before?", "Do you two know each other?", "Are you nervous?") are answered from THIS
// simulation-owned record, never from a model and never from wording. The profile is deliberately small:
// employment/expedition/Complex experience as BANDS (the precision canon stores), familiarity with the
// people at the table, and self-state baselines. It never holds hometowns, families, childhoods, trauma,
// secret histories or prior anomaly encounters -- those belong to a future authored personnel system.
//
// Generation is deterministic from the run seed + actor identity, constrained by the authored archetype
// (data/worldpacks/clear-q4/personhood-constraints.json): a single allowed value is authored canon, several
// allowed values are chosen by hash. It is persisted on the team member (member.personhood), so it is stable
// across reload; a save without it is back-filled with exactly what a fresh world with the same seeds would
// generate (migration is translation, not retcon).

const crypto = require("node:crypto");
const defaultConstraints = require("../data/worldpacks/clear-q4/personhood-constraints.json");

const PERSONHOOD_VERSION = "yellow-beast-personhood@v1";
const HISTORY_LIMIT = 12;
const idOf = (member) => member?.personnel_id ?? member?.id ?? null;

function pick(seed, actorId, field, values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (values.length === 1) return values[0];
  const n = Number.parseInt(crypto.createHash("sha256").update([seed, actorId, field].map(String).join("\u001f")).digest("hex").slice(0, 12), 16);
  return values[n % values.length];
}

/**
 * The profile for one actor. Internally consistent by construction:
 *   first_day_at_async  <=> async_tenure = first_day
 *   first day           =>  no prior expedition or Complex entry
 *   complex_experience > none  =>  expedition_experience > none (one enters the Complex on an expedition)
 */
function generateProfile({ seed, actor_id, archetype = null, constraints = defaultConstraints, familiar_ids = {} } = {}) {
  const rule = (archetype && constraints.archetypes?.[archetype]) || constraints.default;
  let firstDay = pick(seed, actor_id, "first_day_at_async", rule.first_day_at_async);
  let tenure = firstDay ? "first_day" : pick(seed, actor_id, "async_tenure", (rule.async_tenure ?? []).filter((band) => band !== "first_day"));
  if (!tenure) { tenure = "first_day"; firstDay = true; }
  let expedition = firstDay ? "none" : pick(seed, actor_id, "expedition_experience", rule.expedition_experience);
  let complex = firstDay ? "none" : pick(seed, actor_id, "complex_experience", rule.complex_experience);
  if (complex !== "none" && expedition === "none") complex = "none";
  return Object.freeze({
    version: PERSONHOOD_VERSION,
    actor_id,
    archetype: archetype ?? null,
    constraint_source: rule.source ?? null,
    first_day_at_async: Boolean(firstDay),
    async_tenure: tenure,
    expedition_experience: expedition ?? "none",
    complex_experience: complex ?? "none",
    familiarity: Object.freeze({ ...familiar_ids }),
    baseline: Object.freeze({
      nervousness: pick(seed, actor_id, "nervousness", rule.nervousness) ?? "low",
      anticipation: pick(seed, actor_id, "anticipation", rule.anticipation) ?? "neutral",
      confidence: pick(seed, actor_id, "confidence", rule.confidence) ?? "steady"
    }),
    generated_from: Object.freeze({ seed_digest: crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 16), rule: archetype && constraints.archetypes?.[archetype] ? `archetype:${archetype}` : "default" })
  });
}

/** Familiarity bands with everyone at the table and with the briefing authority (canon: all meet today). */
function familiarityFor(run, actorId, constraints = defaultConstraints) {
  const out = {};
  const playerId = run?.session?.startup?.player?.observer_id ?? null;
  for (const member of run?.expedition?.team?.members ?? []) {
    const id = idOf(member);
    if (!id || id === actorId) continue;
    out[id] = constraints.familiarity?.coworkers ?? "just_met";
  }
  if (playerId && playerId !== actorId) out[playerId] = constraints.familiarity?.coworkers ?? "just_met";
  const authority = run?.expedition?.mission?.briefing_authority?.identity ?? (run?.expedition?.day1_opener ? "dr-kirk-maxwell" : null);
  if (authority) out[authority] = constraints.familiarity?.briefing_authority ?? "just_met";
  return out;
}

/**
 * Back-fills (or re-derives an outdated) personhood record on every non-player team member. Idempotent:
 * an existing current record is never changed. Returns the ids that were written.
 */
function ensurePersonhood(run, { constraints = defaultConstraints } = {}) {
  const written = [];
  if (!run?.expedition?.team?.members) return written;
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const seed = run.seed ?? run._world?.seed ?? run.world_id ?? "world";
  for (const member of run.expedition.team.members) {
    const id = idOf(member);
    if (!id || id === playerId) continue;
    if (member.personhood?.version === PERSONHOOD_VERSION) continue;
    const profile = generateProfile({ seed, actor_id: id, archetype: member.archetype ?? null, constraints, familiar_ids: familiarityFor(run, id, constraints) });
    member.personhood = { ...structuredClone(profile), self_state_history: [] };
    recordSelfStateSnapshot(run, id, { at: run.expedition.clock?.interval ?? 0, source: "profile_initialised" });
    written.push(id);
  }
  return written;
}

function memberOf(run, actorId) { return (run?.expedition?.team?.members ?? []).find((m) => idOf(m) === actorId) ?? null; }
function profileOf(run, actorId) { return memberOf(run, actorId)?.personhood ?? null; }

const moved = (state, base, key) => state && typeof state[key] === "number" && Math.round(Math.abs(state[key] - base[key]) * 100) >= 20;
/**
 * Self-state DIMENSIONS for one member, from canonical state only: the affect ledger (member.emotional_state,
 * written only by deterministic affect events) over the profile's authored baselines.
 */
function selfStateDimensions(member) {
  // The affect ledger owns the defaults (required lazily: the ledger reads profiles in describeSelfState).
  const base = { ...require("./canonical-world-ledger").DEFAULT_EMOTIONAL_STATE };
  const state = member?.emotional_state ?? null;
  const baseline = member?.personhood?.baseline ?? {};
  const stressed = moved(state, base, "stress") && state.stress > base.stress;
  const tired = moved(state, base, "fatigue") && state.fatigue > base.fatigue;
  const pressed = moved(state, base, "urgency") && state.urgency > base.urgency;
  const nervous = baseline.nervousness === "elevated" || stressed;
  return Object.freeze({
    wellbeing: stressed || tired || pressed ? "affected" : (nervous ? "fine_but_nervous" : "fine"),
    nervousness: nervous ? "elevated" : "low",
    anticipation: baseline.anticipation ?? "neutral",
    fatigue: tired ? "elevated" : "low",
    confidence: baseline.confidence ?? "steady",
    pressed: pressed ? "elevated" : "low"
  });
}

/** Appends a snapshot to the bounded self-state history when the dimensions changed. */
function recordSelfStateSnapshot(run, actorId, { at = null, source = null } = {}) {
  const member = memberOf(run, actorId);
  if (!member?.personhood) return null;
  const dims = selfStateDimensions(member);
  const history = member.personhood.self_state_history ??= [];
  const last = history.at(-1)?.dimensions ?? null;
  if (last && JSON.stringify(last) === JSON.stringify(dims)) return null;
  const entry = { at: at ?? run?.expedition?.clock?.interval ?? 0, dimensions: { ...dims }, source: source ?? "canonical_state" };
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  return entry;
}

/** The dimensions as they stood at (or before) an interval ("Weren't you nervous earlier?"). */
function selfStateAt(member, interval = null) {
  const history = member?.personhood?.self_state_history ?? [];
  if (interval == null) return history[0]?.dimensions ?? null;
  return [...history].reverse().find((h) => Number(h.at) <= Number(interval))?.dimensions ?? history[0]?.dimensions ?? null;
}

/** Consistency violations across a run's profiles (property tests; never used to repair a save). */
function profileViolations(run) {
  const out = [];
  for (const member of run?.expedition?.team?.members ?? []) {
    const p = member.personhood;
    if (!p) continue;
    const id = idOf(member);
    if (p.first_day_at_async !== (p.async_tenure === "first_day")) out.push(`${id}: first_day vs tenure`);
    if (p.first_day_at_async && (p.expedition_experience !== "none" || p.complex_experience !== "none")) out.push(`${id}: first day with prior experience`);
    if (p.complex_experience !== "none" && p.expedition_experience === "none") out.push(`${id}: Complex entry without an expedition`);
    if (member.archetype === "intern-courier" && ["years"].includes(p.async_tenure)) out.push(`${id}: intern with years of tenure`);
    for (const [other, band] of Object.entries(p.familiarity ?? {})) {
      const theirs = memberOf(run, other)?.personhood;
      if (band !== "just_met" && (p.first_day_at_async || theirs?.first_day_at_async)) out.push(`${id}: familiarity ${band} with ${other} on a first day`);
    }
  }
  return out;
}

module.exports = { PERSONHOOD_VERSION, generateProfile, ensurePersonhood, familiarityFor, profileOf, selfStateDimensions, recordSelfStateSnapshot, selfStateAt, profileViolations, defaultConstraints };
