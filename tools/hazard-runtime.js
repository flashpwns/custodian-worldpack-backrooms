"use strict";

const consequenceRuntime = require("./consequence-runtime");
const logisticsRuntime = require("./logistics-runtime");

const VERSION = "yellow-beast-hazard-runtime@v1";
const STATES = Object.freeze(["dormant", "active", "mitigated", "resolved"]);
const clone = (value) => structuredClone(value);
function memberId(member) { return member.personnel_id ?? member.id; }
function playerId(run) { return run.session?.startup?.player?.observer_id ?? null; }

function ensure(run, definition) {
  run.expedition.hazards ??= { version: VERSION, states: {}, exposure_history: [], transition_history: [], revision: 0 };
  const runtime = run.expedition.hazards; runtime.version ??= VERSION; runtime.states ??= {}; runtime.exposure_history ??= []; runtime.transition_history ??= []; runtime.revision ??= 0;
  for (const authored of definition.hazards ?? []) runtime.states[authored.id] ??= { state: authored.initial_state, detected_by: {}, mitigated_at: null, resolved_at: null, chosen_outcomes: {}, history: [{ sequence: 1, from: null, to: authored.initial_state, at: run.expedition.clock.interval, reason: "authored initial state" }] };
  return runtime;
}

function actorLocations(run, actor) {
  if (actor) return [run.spatial?.personnel_locations?.[actor]].filter(Boolean);
  return Object.values(run.spatial?.personnel_locations ?? {}).filter(Boolean);
}
function evaluateCondition(condition, run, runtime, actor = null) {
  if (Array.isArray(condition?.all)) return condition.all.every((entry) => evaluateCondition(entry, run, runtime, actor));
  if (Array.isArray(condition?.any)) return condition.any.some((entry) => evaluateCondition(entry, run, runtime, actor));
  if (condition?.not) return !evaluateCondition(condition.not, run, runtime, actor);
  if (condition.source === "time" && condition.predicate === "interval_reached") return run.expedition.clock.interval >= condition.amount;
  if (condition.source === "spatial" && condition.predicate === "actor_at_location") return actorLocations(run, actor).includes(condition.location_id);
  if (condition.source === "spatial" && condition.predicate === "connection_traversed") return (run.spatial?.route_history ?? []).some((entry) => entry.connection_id === condition.connection_id);
  if (condition.source === "hazard" && condition.predicate === "state_is") return runtime.states[condition.hazard_id]?.state === condition.state;
  if (condition.source === "hazard" && condition.predicate === "unmitigated") return !["mitigated", "resolved"].includes(runtime.states[condition.hazard_id]?.state);
  if (condition.source === "personnel" && condition.predicate === "personnel_present") return actorLocations(run).some((location) => !condition.location_id || location === condition.location_id);
  if (condition.source === "equipment" && condition.predicate === "equipment_present") { const item = run.expedition.equipment?.[condition.equipment_id]; return Boolean(item && (!condition.location_id || item.location === condition.location_id || run.spatial?.personnel_locations?.[item.holder] === condition.location_id)); }
  if (condition.source === "communication" && condition.predicate === "message_state") return (run.expedition.messages ?? []).some((message) => message.state === condition.message_state);
  return false;
}

function transition(run, runtime, id, to, reason) {
  const record = runtime.states[id]; if (!record || record.state === to) return false; if (!STATES.includes(to)) throw new Error("invalid hazard state");
  const from = record.state; record.state = to; const entry = { sequence: record.history.length + 1, from, to, at: run.expedition.clock.interval, reason }; record.history.push(entry); runtime.transition_history.push({ sequence: runtime.transition_history.length + 1, hazard_id: id, ...entry }); runtime.revision += 1; return true;
}

function consequenceEffects(run, authored, actor, set) {
  const held = Object.entries(run.expedition.equipment ?? {}).find(([, item]) => item.holder === actor && ["operational", "serviceable", "usable"].includes(String(item.state).toLowerCase()));
  return set.effects.flatMap((effect) => {
    if (effect.target === "exposed-coworker") return [{ ...effect, target: actor }];
    if (effect.target === "held-operational-equipment") return held ? [{ ...effect, target: held[0] }] : [];
    return [clone(effect)];
  });
}

function resolve(run, definition) {
  const runtime = ensure(run, definition); const observer = playerId(run); const updates = []; const consequences = [];
  for (const authored of definition.hazards ?? []) {
    const state = runtime.states[authored.id];
    if (!state.detected_by[observer] && evaluateCondition(authored.detection, run, runtime, observer)) { state.detected_by[observer] = { at: run.expedition.clock.interval, description: authored.public.warning }; updates.push({ kind: "hazard-detected", hazard_id: authored.id, summary: authored.public.warning, at: run.expedition.clock.interval }); }
    for (const exposure of runtime.exposure_history.filter((entry) => entry.hazard_id === authored.id && !entry.observed_by_player)) {
      if (run.spatial?.personnel_locations?.[observer] !== run.spatial?.personnel_locations?.[exposure.actor]) continue;
      exposure.observed_by_player = true; exposure.observed_at = run.expedition.clock.interval; state.detected_by[observer] ??= { at: run.expedition.clock.interval, description: authored.public.warning };
      const set = definition.consequence_sets.find((entry) => entry.id === authored.consequence_set);
      updates.push({ kind: "hazard-consequence-observed", hazard_id: authored.id, summary: authored.public.observed, consequence: set?.public_summary ?? "A persistent operational consequence is now visible.", at: run.expedition.clock.interval });
    }
    if (state.state === "dormant" && evaluateCondition(authored.activation, run, runtime)) { transition(run, runtime, authored.id, "active", "authored activation conditions became true"); if (state.detected_by[observer]) updates.push({ kind: "hazard-active", hazard_id: authored.id, summary: authored.public.observed, at: run.expedition.clock.interval }); }
    if (state.state !== "active") continue;
    if (authored.affected_targets === "one-coworker" && runtime.exposure_history.some((entry) => entry.hazard_id === authored.id)) continue;
    const coworkers = (run.expedition.team?.members ?? []).filter((member) => memberId(member) !== observer && member.status === "active").sort((a, b) => memberId(a).localeCompare(memberId(b)));
    const candidates = authored.affected_targets === "player" ? [run.expedition.team.members.find((member) => memberId(member) === observer)].filter(Boolean) : authored.affected_targets === "one-coworker" ? coworkers : run.expedition.team.members;
    for (const member of candidates) {
      const actor = memberId(member); if (runtime.exposure_history.some((entry) => entry.hazard_id === authored.id && entry.actor === actor)) continue;
      if (!evaluateCondition(authored.exposure, run, runtime, actor)) continue;
      const set = definition.consequence_sets.find((entry) => entry.id === authored.consequence_set); const effects = consequenceEffects(run, authored, actor, set);
      const sameLocation = run.spatial.personnel_locations[observer] === run.spatial.personnel_locations[actor];
      const proposal = { source: authored.id, classification: "temporary-complication", effects, observable_to: sameLocation ? [observer, actor] : [actor], public_summary: set.public_summary };
      const applied = consequenceRuntime.apply(run, proposal); if (!applied.ok) throw Object.assign(new Error("hazard consequence could not be committed atomically"), { code: applied.code });
      const exposure = { sequence: runtime.exposure_history.length + 1, hazard_id: authored.id, actor, at: run.expedition.clock.interval, consequence_id: applied.consequence.id, observed_by_player: sameLocation, outcome_digest: applied.consequence.id };
      runtime.exposure_history.push(exposure); state.chosen_outcomes[actor] = applied.consequence.id; consequences.push(applied.consequence);
      if (sameLocation) { state.detected_by[observer] ??= { at: run.expedition.clock.interval, description: authored.public.observed }; updates.push({ kind: "hazard-consequence", hazard_id: authored.id, summary: authored.public.observed, consequence: set.public_summary, at: run.expedition.clock.interval }); }
      break;
    }
  }
  return { updates, consequences };
}

function mitigate(run, definition, hazardId, actor) {
  const runtime = ensure(run, definition); const authored = definition.hazards.find((entry) => entry.id === hazardId); const state = runtime.states[hazardId];
  if (!authored || !state) return { ok: false, code: "HAZARD_UNKNOWN", reason: "No known hazard matches that warning." };
  if (!state.detected_by[actor]) return { ok: false, code: "HAZARD_UNDETECTED", reason: "No observable warning supports that mitigation." };
  if (["mitigated", "resolved"].includes(state.state)) return { ok: true, idempotent: true, public_reason: authored.public.mitigated };
  const actorLocation = run.spatial?.personnel_locations?.[actor]; if (actorLocation !== authored.scope.location_id) return { ok: false, code: "HAZARD_OUT_OF_RANGE", reason: "Reach the observed warning location before attempting mitigation." };
  const requirement = authored.mitigation_requirements ?? {}; const match = Object.entries(run.expedition.equipment ?? {}).find(([id, item]) => (requirement.equipment_id ? id === requirement.equipment_id : requirement.capability ? item.capability === requirement.capability : true) && item.holder === actor); const kit = match?.[1]; if (!kit || !["operational", "serviceable", "usable"].includes(String(kit.state).toLowerCase()) || kit.charges < Number(requirement.consume ?? 0)) return { ok: false, code: "MITIGATION_EQUIPMENT_REQUIRED", reason: authored.public.mitigation_unavailable ?? "The declared mitigation equipment is not available in operational custody." };
  const consume = Number(requirement.consume ?? 0); if (consume > 0) { kit.charges -= consume; kit.used = (kit.used ?? 0) + consume; kit.history ??= []; kit.history.push({ event: "hazard-mitigation", hazard_id: hazardId, holder: actor, at: run.expedition.clock.interval }); const authoritative = run.expedition.logistics?.items?.[match[0]]; if (authoritative) { authoritative.charges = kit.charges; authoritative.history.push({ action: "MITIGATE", actor, hazard_id: hazardId, at: run.expedition.clock.interval }); logisticsRuntime.attach(run.expedition); } }
  transition(run, runtime, hazardId, "mitigated", "the declared field mitigation was completed"); state.mitigated_at = run.expedition.clock.interval; return { ok: true, public_reason: authored.public.mitigated };
}

function applyInteractionHook(run, definition, hook, action, actor) {
  if (!hook || hook.when_action !== action || !["mitigated", "resolved"].includes(hook.transition)) return { ok: false, code: "HAZARD_HOOK_NOT_APPLICABLE" };
  const authored = definition.hazards.find((entry) => entry.id === hook.hazard_id); if (!authored) return { ok: false, code: "HAZARD_UNKNOWN" };
  const runtime = ensure(run, definition); const state = runtime.states[hook.hazard_id];
  const wasTerminal = ["mitigated", "resolved"].includes(state.state);
  let recovery = null;
  if (hook.recovery_effects?.length) {
    recovery = consequenceRuntime.recover(run, { source: hook.hazard_id, actor, effects: hook.recovery_effects, public_summary: authored.public.mitigated, observable_to: [actor] });
    if (!recovery.ok && recovery.code !== "ROUTE_NOT_BLOCKED") return recovery;
  }
  if (!["mitigated", "resolved"].includes(state.state)) { transition(run, runtime, hook.hazard_id, hook.transition, `authored ${action} interaction completed the declared mitigation`); state.mitigated_at = run.expedition.clock.interval; }
  state.detected_by[actor] ??= { at: run.expedition.clock.interval, description: authored.public.warning };
  return { ok: true, idempotent: wasTerminal && !recovery?.ok, recovery: recovery?.recovery ?? null, public_reason: authored.public.mitigated };
}

function project(run, definition) {
  const runtime = run.expedition?.hazards; const observer = playerId(run);
  if (!runtime) return [];
  return (definition.hazards ?? []).flatMap((authored) => { const state = runtime.states?.[authored.id]; const known = state?.detected_by?.[observer]; if (!known) return []; const exposures = runtime.exposure_history.filter((entry) => entry.hazard_id === authored.id && entry.observed_by_player); return [{ id: authored.id, category: authored.category, state: state.state, warning: known.description, observed_change: exposures.length ? authored.public.observed : null, mitigation_available: !["mitigated", "resolved"].includes(state.state), mitigation_options: [...authored.mitigation_options], summary: state.state === "mitigated" ? authored.public.mitigated : exposures.length ? authored.public.observed : authored.public.warning }]; });
}

module.exports = { VERSION, STATES, ensure, evaluateCondition, transition, resolve, mitigate, applyInteractionHook, project };
