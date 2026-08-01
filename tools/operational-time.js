"use strict";

const crypto = require("node:crypto");

const VERSION = "yellow-beast-operational-time@v1";
const EVENT_STATES = Object.freeze(["scheduled", "cancelled", "completed", "missed"]);
const clone = (value) => structuredClone(value);

function ensure(expedition) {
  expedition.operational ??= {};
  const operational = expedition.operational;
  operational.version ??= VERSION;
  operational.clock ??= expedition.clock ?? { interval: 0 };
  operational.clock.interval = Number.isInteger(operational.clock.interval) && operational.clock.interval >= 0 ? operational.clock.interval : 0;
  operational.events ??= [];
  operational.event_history ??= [];
  operational.cycle_history ??= [];
  operational.evaluation_revision = Number.isInteger(operational.evaluation_revision) ? operational.evaluation_revision : 0;
  // Legacy callers read expedition.clock, but the object is the same authority.
  expedition.clock = operational.clock;
  return operational;
}

function eventId(spec) {
  if (spec.id) return spec.id;
  return `event-${crypto.createHash("sha256").update(JSON.stringify([spec.event_type, spec.scheduled_interval, spec.source, spec.target, spec.payload])).digest("hex").slice(0, 20)}`;
}

function schedule(expedition, spec) {
  const operational = ensure(expedition); const now = operational.clock.interval;
  const scheduledInterval = Number.isInteger(spec.scheduled_interval) ? spec.scheduled_interval : now + Number(spec.delay ?? 0);
  if (!Number.isInteger(scheduledInterval) || scheduledInterval < now) throw new Error("scheduled operational event cannot be in the past");
  const id = eventId({ ...spec, scheduled_interval: scheduledInterval });
  const existing = operational.events.find((event) => event.id === id);
  if (existing) return { event: existing, created: false };
  const entry = {
    id,
    event_type: spec.event_type,
    scheduled_interval: scheduledInterval,
    source: spec.source ?? "operational-runtime",
    target: spec.target ?? null,
    payload: clone(spec.payload ?? {}),
    visibility_policy: spec.visibility_policy ?? "known-when-resolved",
    status: "scheduled",
    repeating: Number.isInteger(spec.repeating) && spec.repeating > 0 ? spec.repeating : null,
    created_at: now,
    resolution_history: [],
    cancellation_reason: null
  };
  if (!entry.event_type || !EVENT_STATES.includes(entry.status)) throw new Error("scheduled operational event is invalid");
  operational.events.push(entry);
  operational.events.sort((a, b) => a.scheduled_interval - b.scheduled_interval || a.id.localeCompare(b.id));
  operational.event_history.push({ sequence: operational.event_history.length + 1, event_id: id, transition: "scheduled", at: now });
  return { event: entry, created: true };
}

function cancel(expedition, id, reason) {
  const operational = ensure(expedition); const entry = operational.events.find((event) => event.id === id);
  if (!entry || entry.status !== "scheduled") return { ok: false, code: "EVENT_NOT_CANCELLABLE" };
  entry.status = "cancelled"; entry.cancellation_reason = reason || "cancelled by authoritative state change";
  entry.resolution_history.push({ sequence: entry.resolution_history.length + 1, from: "scheduled", to: "cancelled", at: operational.clock.interval, reason: entry.cancellation_reason });
  operational.event_history.push({ sequence: operational.event_history.length + 1, event_id: id, transition: "cancelled", at: operational.clock.interval, reason: entry.cancellation_reason });
  return { ok: true, event: entry };
}

function advance(expedition, amount, source = "player-action") {
  const operational = ensure(expedition); const cost = Number(amount);
  if (!Number.isInteger(cost) || cost < 0) throw new Error("operational time cost must be a non-negative integer");
  const from = operational.clock.interval; operational.clock.interval += cost;
  if (cost > 0) operational.cycle_history.push({ sequence: operational.cycle_history.length + 1, kind: "clock-advanced", source, from, to: operational.clock.interval, cost });
  return { from, to: operational.clock.interval, cost };
}

function due(expedition) {
  const operational = ensure(expedition); return operational.events.filter((event) => event.status === "scheduled" && event.scheduled_interval <= operational.clock.interval).sort((a, b) => a.scheduled_interval - b.scheduled_interval || a.id.localeCompare(b.id));
}

function resolveDue(expedition, resolver, predicate = null) {
  const operational = ensure(expedition); const resolved = []; let guard = 0;
  while (guard < 1000) {
    const entry = due(expedition).find((candidate) => !predicate || predicate(candidate)); if (!entry) break; guard += 1;
    const outcome = resolver(entry) ?? { status: "completed" };
    if (outcome.defer === true) break;
    const nextStatus = outcome.status ?? "completed";
    if (!["completed", "missed", "cancelled"].includes(nextStatus)) throw new Error(`invalid scheduled-event resolution: ${nextStatus}`);
    entry.status = nextStatus;
    if (nextStatus === "cancelled") entry.cancellation_reason = outcome.reason ?? "cancelled during resolution";
    const record = { sequence: entry.resolution_history.length + 1, from: "scheduled", to: nextStatus, at: operational.clock.interval, reason: outcome.reason ?? null };
    entry.resolution_history.push(record);
    operational.event_history.push({ sequence: operational.event_history.length + 1, event_id: entry.id, transition: nextStatus, at: operational.clock.interval, reason: record.reason });
    resolved.push({ event_id: entry.id, event_type: entry.event_type, status: nextStatus, at: operational.clock.interval, result: clone(outcome.result ?? null) });
    if (nextStatus === "completed" && entry.repeating) schedule(expedition, { ...entry, id: `${entry.id}@${entry.scheduled_interval + entry.repeating}`, scheduled_interval: entry.scheduled_interval + entry.repeating, payload: entry.payload });
  }
  if (guard >= 1000) throw new Error("scheduled-event resolution did not converge");
  return resolved;
}

function migrate(expedition) {
  const operational = ensure(expedition); const legacy = expedition.clock ?? {};
  operational.clock.interval = Math.max(operational.clock.interval, Number(legacy.interval ?? 0));
  expedition.clock = operational.clock;
  return operational;
}

function project(expedition) {
  const operational = expedition.operational ?? { clock: expedition.clock ?? { interval: 0 }, events: [] };
  return {
    version: VERSION,
    interval: operational.clock.interval,
    label: `Operational interval ${operational.clock.interval}`,
    next_event: operational.events.filter((event) => event.status === "scheduled" && event.visibility_policy !== "hidden").sort((a, b) => a.scheduled_interval - b.scheduled_interval)[0]?.scheduled_interval ?? null
  };
}

module.exports = { VERSION, EVENT_STATES, ensure, schedule, cancel, advance, due, resolveDue, migrate, project };
