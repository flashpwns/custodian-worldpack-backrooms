"use strict";

const crypto = require("node:crypto");
const operationalTime = require("./operational-time");

const VERSION = "yellow-beast-consequence-runtime@v1";
const PERSONNEL_CONDITIONS = new Set(["uninjured", "minor injury", "serious injury", "incapacitated", "missing", "dead", "stabilized minor injury"]);
const EQUIPMENT_STATES = new Set(["operational", "serviceable", "damaged", "disabled", "depleted", "dropped", "lost", "recoverable", "destroyed"]);
const clone = (value) => structuredClone(value);
function memberId(member) { return member.personnel_id ?? member.id; }

function ensure(expedition) {
  const operational = operationalTime.ensure(expedition);
  operational.consequences ??= [];
  operational.consequence_revision = Number.isInteger(operational.consequence_revision) ? operational.consequence_revision : 0;
  return operational;
}

function validate(run, proposal) {
  if (!proposal || !Array.isArray(proposal.effects) || !proposal.effects.length) return { ok: false, code: "CONSEQUENCE_EMPTY" };
  const members = new Set((run.expedition?.team?.members ?? []).map(memberId)); const equipment = run.expedition?.equipment ?? {};
  for (const effect of proposal.effects) {
    if (effect.kind === "personnel-condition") { if (!members.has(effect.target) || !PERSONNEL_CONDITIONS.has(effect.condition)) return { ok: false, code: "CONSEQUENCE_PERSONNEL_INVALID" }; const current = run.expedition.team.members.find((entry) => memberId(entry) === effect.target); if (["dead", "missing"].includes(String(current?.condition).toLowerCase()) && effect.condition !== current.condition) return { ok: false, code: "CONSEQUENCE_PERSONNEL_IRREVERSIBLE" }; }
    else if (["equipment-dropped", "equipment-state"].includes(effect.kind)) { if (!equipment[effect.target] || (effect.state && !EQUIPMENT_STATES.has(effect.state))) return { ok: false, code: "CONSEQUENCE_EQUIPMENT_INVALID" }; if (equipment[effect.target].state === "destroyed" && effect.state && effect.state !== "destroyed") return { ok: false, code: "CONSEQUENCE_EQUIPMENT_IRREVERSIBLE" }; }
    else if (effect.kind === "route-blocked") { if (!run.spatial || typeof effect.connection_id !== "string") return { ok: false, code: "CONSEQUENCE_ROUTE_INVALID" }; }
    else if (effect.kind === "operational-delay") { if (!Number.isInteger(effect.amount) || effect.amount < 1) return { ok: false, code: "CONSEQUENCE_DELAY_INVALID" }; }
    else if (effect.kind === "evidence-state") { if (!(run.expedition?.evidence ?? []).some((item) => item.id === effect.target) || !["damaged", "lost", "destroyed"].includes(effect.state)) return { ok: false, code: "CONSEQUENCE_EVIDENCE_INVALID" }; }
    else return { ok: false, code: "CONSEQUENCE_EFFECT_INVALID" };
  }
  return { ok: true };
}

function apply(run, proposal) {
  const valid = validate(run, proposal); if (!valid.ok) return valid;
  const startedAt = run.expedition.clock.interval;
  const draft = { team: clone(run.expedition.team), equipment: clone(run.expedition.equipment), spatial: clone(run.spatial), evidence: clone(run.expedition.evidence ?? []) };
  let additionalDelay = 0;
  for (const effect of proposal.effects) {
    if (effect.kind === "personnel-condition") {
      const member = draft.team.members.find((entry) => memberId(entry) === effect.target); member.condition = effect.condition; member.health = effect.condition; member.observed_condition = effect.condition;
      if (effect.status) member.status = effect.status; if (effect.condition === "incapacitated") member.status = "incapacitated"; if (["missing", "dead"].includes(effect.condition)) member.status = effect.condition;
      member.condition_history ??= []; member.condition_history.push({ sequence: member.condition_history.length + 1, condition: effect.condition, status: member.status, at: run.expedition.clock.interval, reason: effect.reason ?? proposal.source });
    } else if (effect.kind === "equipment-dropped") {
      const item = draft.equipment[effect.target]; item.state = "dropped"; item.location = effect.location_id ?? draft.spatial?.personnel_locations?.[item.holder] ?? "unknown"; const priorHolder = item.holder; item.holder = null; item.recoverable = true; item.history ??= []; item.history.push({ event: "dropped", from: priorHolder, location: item.location, at: run.expedition.clock.interval, reason: effect.reason ?? proposal.source });
    } else if (effect.kind === "equipment-state") {
      const item = draft.equipment[effect.target]; item.state = effect.state; if (["lost", "destroyed"].includes(effect.state)) item.holder = null; item.history ??= []; item.history.push({ event: `state-${effect.state}`, at: run.expedition.clock.interval, reason: effect.reason ?? proposal.source });
    } else if (effect.kind === "route-blocked") {
      draft.spatial.blocked_paths ??= {}; draft.spatial.blocked_paths[effect.connection_id] = { state: effect.state ?? "temporarily-blocked", at: run.expedition.clock.interval, reason: effect.reason ?? proposal.source, recoverable: effect.state !== "permanently-blocked" };
    } else if (effect.kind === "operational-delay") additionalDelay += effect.amount;
    else if (effect.kind === "evidence-state") { const evidence = draft.evidence.find((item) => item.id === effect.target); evidence.custody_state = effect.state; if (["lost", "destroyed"].includes(effect.state)) evidence.available_to_player = false; }
  }
  run.expedition.team = draft.team; run.expedition.equipment = draft.equipment; run.spatial = draft.spatial; run.expedition.evidence = draft.evidence;
  const operational = ensure(run.expedition); const record = { id: proposal.id ?? `consequence-${crypto.createHash("sha256").update(JSON.stringify([proposal.source, proposal.effects, startedAt, operational.consequences.length])).digest("hex").slice(0, 18)}`, source: proposal.source, classification: proposal.classification ?? "temporary-complication", effects: clone(proposal.effects), at: startedAt, observable_to: [...(proposal.observable_to ?? [])], public_summary: proposal.public_summary ?? "An operational consequence changed persistent state.", recovery: null, operational_delay: additionalDelay };
  if (additionalDelay > 0) operationalTime.advance(run.expedition, additionalDelay, `consequence:${proposal.source ?? "unspecified"}`);
  record.resolved_at = run.expedition.clock.interval;
  operational.consequences.push(record); operational.consequence_revision += 1;
  return { ok: true, consequence: clone(record), additional_delay: additionalDelay };
}

function recoverEquipment(run, key, actor) {
  const item = run.expedition?.equipment?.[key]; if (!item) return { ok: false, code: "EQUIPMENT_UNKNOWN", reason: "That equipment is not part of the field record." };
  if (item.state !== "dropped" || item.recoverable !== true) return { ok: false, code: "EQUIPMENT_NOT_RECOVERABLE", reason: "That equipment is not presently recoverable." };
  const actorLocation = run.spatial?.personnel_locations?.[actor]; if (!actorLocation || item.location !== actorLocation) return { ok: false, code: "EQUIPMENT_OUT_OF_RANGE", reason: "Reach the equipment's confirmed location before retrieving it." };
  const before = item.state; item.state = "operational"; item.holder = actor; item.assigned_to ??= actor; item.location = "carried"; item.recoverable = false; item.history.push({ event: "recovered", holder: actor, at: run.expedition.clock.interval });
  const operational = ensure(run.expedition); const source = [...operational.consequences].reverse().find((record) => record.effects.some((effect) => ["equipment-dropped", "equipment-state"].includes(effect.kind) && effect.target === key) && !record.recovery);
  if (source) source.recovery = { kind: "equipment-recovered", actor, at: run.expedition.clock.interval };
  return { ok: true, public_reason: `${item.label} recovered and returned to operational custody.`, before, after: item.state, item: clone(item) };
}

function clearRoute(run, connectionId, actor) {
  const block = run.spatial?.blocked_paths?.[connectionId]; if (!block) return { ok: false, code: "ROUTE_NOT_BLOCKED", reason: "No known route block requires clearing." };
  if (!block.recoverable) return { ok: false, code: "ROUTE_BLOCK_IRREVERSIBLE", reason: "The recorded route block cannot be cleared with field resources." };
  delete run.spatial.blocked_paths[connectionId]; const operational = ensure(run.expedition); operational.consequences.push({ id: `recovery-${operational.consequences.length + 1}`, source: "field-mitigation", classification: "recovered-complication", effects: [{ kind: "route-cleared", connection_id: connectionId }], at: run.expedition.clock.interval, observable_to: [actor], public_summary: "The temporary route obstruction was cleared.", recovery: { actor, at: run.expedition.clock.interval } });
  return { ok: true, public_reason: "The temporary route obstruction is cleared." };
}

module.exports = { VERSION, PERSONNEL_CONDITIONS, EQUIPMENT_STATES, ensure, validate, apply, recoverEquipment, clearRoute };
