"use strict";

// Compatibility facade for saves and older callers. Operational time has one
// authority in operational-time; check-in lifecycle lives in communications.
const operationalTime = require("./operational-time");
const communications = require("./communication-runtime");
const VERSION = "yellow-beast-q4-time@v3";

function ensure(expedition) { operationalTime.migrate(expedition); communications.ensure(expedition); return expedition.clock; }

function schedule(expedition, intervals = 3) {
  ensure(expedition); const existing = expedition.communications.check_ins[0];
  if (!existing) expedition.communications.check_ins.push({ id: "legacy-field-check-in", label: "Scheduled field status report", scheduled_at: expedition.clock.interval, due_at: expedition.clock.interval + Math.max(1, intervals), missed_at: expedition.clock.interval + Math.max(1, intervals) + 2, approaching_within: 1, state: "scheduled", completed_at: null, waived_at: null, message_id: null, history: [{ sequence: 1, from: null, to: "scheduled", at: expedition.clock.interval, reason: "explicit legacy check-in migration" }] });
  communications.updateCheckIns(expedition); return status(expedition);
}

function advance(expedition, amount = 1) { operationalTime.advance(expedition, Math.max(0, Number(amount) || 0), "legacy-time-facade"); communications.updateCheckIns(expedition); return status(expedition); }
function complete(expedition) {
  ensure(expedition); const checkIn = expedition.communications.check_ins[0]; if (!checkIn) return status(expedition);
  const message = { id: `legacy-check-in-${expedition.clock.interval}`, purpose: "scheduled-check-in", check_in_id: checkIn.id };
  communications.completeCheckIn(expedition, message); return status(expedition);
}
function status(expedition) {
  const projected = communications.project(expedition).check_ins[0];
  if (!projected) return { state: "not-scheduled", label: "NOT SCHEDULED", due_at: null, remaining: null };
  return { state: projected.state, label: projected.state_label.toUpperCase(), due_at: projected.due_at, remaining: projected.due_at - expedition.clock.interval, completed_at: projected.completed_at, summary: projected.summary };
}

module.exports = { VERSION, ensure, schedule, advance, complete, status };
