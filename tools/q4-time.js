"use strict";

const VERSION = "yellow-beast-q4-time@v2";

function ensure(expedition) {
  expedition.clock ??= {};
  expedition.clock.interval = Number.isFinite(expedition.clock.interval) ? expedition.clock.interval : 0;
  expedition.clock.check_in_due_at = Number.isFinite(expedition.clock.check_in_due_at) ? expedition.clock.check_in_due_at : null;
  expedition.clock.check_in_overdue = Boolean(expedition.clock.check_in_overdue);
  expedition.clock.check_in_missed = Boolean(expedition.clock.check_in_missed);
  expedition.clock.check_in_completed_at = Number.isFinite(expedition.clock.check_in_completed_at) ? expedition.clock.check_in_completed_at : null;
  return expedition.clock;
}

function schedule(expedition, intervals = 3) {
  const clock = ensure(expedition);
  if (clock.check_in_due_at === null || clock.check_in_due_at <= clock.interval) clock.check_in_due_at = clock.interval + Math.max(1, intervals);
  clock.check_in_overdue = false;
  clock.check_in_missed = false;
  clock.check_in_completed_at = null;
  return status(expedition);
}

function advance(expedition, amount = 1) {
  const clock = ensure(expedition);
  clock.interval += Math.max(0, amount);
  if (clock.check_in_due_at !== null && clock.interval > clock.check_in_due_at && clock.check_in_completed_at === null) {
    clock.check_in_overdue = true;
    clock.check_in_missed = true;
    if (!expedition.deviations?.includes("missed-declared-check-in")) expedition.deviations?.push("missed-declared-check-in");
  }
  return status(expedition);
}

function complete(expedition) {
  const clock = ensure(expedition);
  if (clock.check_in_due_at === null) return status(expedition);
  clock.check_in_completed_at ??= clock.interval;
  if (clock.interval > clock.check_in_due_at) {
    clock.check_in_overdue = true;
    clock.check_in_missed = true;
    if (!expedition.deviations?.includes("missed-declared-check-in")) expedition.deviations?.push("missed-declared-check-in");
  }
  return status(expedition);
}

function status(expedition) {
  const clock = ensure(expedition);
  if (clock.check_in_due_at === null) return { state: "not-scheduled", label: "NOT SCHEDULED", due_at: null, remaining: null };
  const remaining = clock.check_in_due_at - clock.interval;
  if (clock.check_in_completed_at !== null) {
    const late = Math.max(0, clock.check_in_completed_at - clock.check_in_due_at);
    return { state: late ? "completed-late" : "completed", label: late ? `CHECK-IN COMPLETE · LATE BY ${late} ${late === 1 ? "INTERVAL" : "INTERVALS"}` : "CHECK-IN COMPLETE", due_at: clock.check_in_due_at, remaining, completed_at: clock.check_in_completed_at };
  }
  if (clock.check_in_overdue || remaining < 0) return { state: "overdue", label: `OVERDUE BY ${Math.abs(remaining)} ${Math.abs(remaining) === 1 ? "INTERVAL" : "INTERVALS"}`, due_at: clock.check_in_due_at, remaining };
  if (remaining === 0) return { state: "due", label: "CHECK-IN DUE", due_at: clock.check_in_due_at, remaining: 0 };
  return { state: "scheduled", label: `DUE IN ${remaining} ${remaining === 1 ? "INTERVAL" : "INTERVALS"}`, due_at: clock.check_in_due_at, remaining };
}

module.exports = { VERSION, ensure, schedule, advance, complete, status };
