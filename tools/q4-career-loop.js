"use strict";

// Canonical, bounded transition between completed Clear-Q4 operations.  This
// is deliberately a shift processor, not a background adventure simulator.
const crypto = require("node:crypto");
const history = require("./world-history");
const institutional = require("./institutional-runtime");
const outcomes = require("./q4-outcome-authority");

const VERSION = "yellow-beast-q4-career@v1";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function ensure(world) {
  history.assertWorld(world);
  world.q4_career_state ??= { version: VERSION, completed_operations: 0, operation_history: [], cycles: {}, recent_updates: [] };
  const state = world.q4_career_state;
  if (state.version !== VERSION) throw new Error("unsupported Clear-Q4 career state");
  state.operation_history ??= []; state.cycles ??= {}; state.recent_updates ??= []; state.completed_operations ??= 0;
  return state;
}

function cycleId(world, run, review) { return `q4-between-${digest([world.world_id, run.run_id, review.mission_id]).slice(0, 18)}`; }
function record(world, runId, cycle, kind, summary, cause) {
  const update = { id: `${cycle.id}:${kind}:${cycle.updates.length + 1}`, kind, summary, cause: clone(cause), cycle_id: cycle.id };
  cycle.updates.push(update); history.event(world, runId, "q4.between-operation.updated", update, "q4-bounded-career-processing"); return update;
}

function processEquipment(world, runId, cycle) {
  for (const item of Object.values(world.q4_equipment ?? {}).sort((a, b) => a.id.localeCompare(b.id))) {
    if (["missing", "abandoned"].includes(item.state)) continue; // Loss is never serviced away.
    if (item.state === "service") { item.state = "operational"; item.known_condition = "Operational"; item.service_completed_cycle = cycle.id; record(world, runId, cycle, "equipment-service-complete", `${item.label ?? item.id} — service complete.`, { equipment_id: item.id, prior_state: "service" }); }
    else if (["depleted", "damaged"].includes(item.state)) { item.state = "service"; item.service_started_cycle = cycle.id; record(world, runId, cycle, "equipment-service-started", `${item.label ?? item.id} — assigned to routine service.`, { equipment_id: item.id, prior_state: item.state }); }
  }
}

function processPersonnel(world, runId, cycle) {
  const now = world.q4_operations?.institutional_time ?? 0;
  for (const person of Object.values(world.characters ?? {}).sort((a, b) => a.identity.localeCompare(b.identity))) {
    if (person.status === "unavailable" && person.q4_available_after <= now) {
      history.setCharacterStatus(world, { run_id: runId, identity: person.identity, status: "active", reason: "temporary operational availability restored" });
      delete person.q4_available_after; record(world, runId, cycle, "personnel-available", `${person.display_name} — available for field assignment.`, { personnel_id: person.identity, prior_status: "unavailable" });
    }
  }
  const player = world.q4_operations?.controlled_player;
  const candidates = Object.values(world.characters ?? {}).filter((person) => person.identity !== player && person.status === "active" && person.role && person.clearance).sort((a, b) => a.identity.localeCompare(b.identity));
  // A sparse, deterministic scheduling change: never targets the player and
  // never creates a fatal/missing/injured state.
  if (candidates.length) {
    const person = candidates[parseInt(digest([cycle.id, candidates.map((item) => item.identity)]).slice(0, 8), 16) % candidates.length];
    person.q4_available_after = now + 2;
    history.setCharacterStatus(world, { run_id: runId, identity: person.identity, status: "unavailable", reason: "temporary support assignment" });
    record(world, runId, cycle, "personnel-temporarily-unavailable", `${person.display_name} — temporarily assigned to support.`, { personnel_id: person.identity, availability: "temporary-support", available_after: person.q4_available_after });
  }
}

function assertAgencyBoundary(world) {
  const illegal = Object.values(world.q4_career_state?.cycles ?? {}).flatMap((cycle) => cycle.updates ?? []).filter((update) => /death|missing|severe|permanent/i.test(`${update.kind} ${update.summary}`));
  if (illegal.length) throw new Error("bounded career processing attempted an irreversible personnel consequence");
  return true;
}

function process(world, definition, run, review) {
  outcomes.assertMutable(world, "between-operation processing");
  const state = ensure(world); if (!run?.run_id || !review?.mission_id) throw new Error("between-operation processing requires a closed canonical operation");
  const id = cycleId(world, run, review); if (state.cycles[id]?.status === "completed") return { ok: true, idempotent: true, cycle: clone(state.cycles[id]) };
  const cycle = state.cycles[id] ?? { id, run_id: run.run_id, mission_id: review.mission_id, status: "processing", order: ["reconcile-closure", "institutional-review", "equipment-service", "personnel-availability", "assignment-conditions"], updates: [] };
  state.cycles[id] = cycle;
  // Closure was ingested at operation end. This advances only its existing,
  // institutionally-known pending review; it cannot discover offscreen facts.
  const decisions = institutional.advance(world, definition, 1);
  if (decisions.length) record(world, run.run_id, cycle, "administrative-review", "Administrative review completed.", { closure_mission_id: review.mission_id, decisions: decisions.map((item) => item.decision?.id).filter(Boolean) });
  processEquipment(world, run.run_id, cycle);
  processPersonnel(world, run.run_id, cycle);
  world.q4_operations ??= { institutional_time: 0, last_review: null };
  world.q4_operations.institutional_time += 1;
  state.completed_operations += 1;
  state.operation_history.push({ mission_id: review.mission_id, run_id: run.run_id, outcome: review.outcome, cycle_id: id, institutional_time: world.q4_operations.institutional_time });
  cycle.status = "completed"; cycle.completed_at = world.q4_operations.institutional_time;
  state.recent_updates = cycle.updates.slice(-8); assertAgencyBoundary(world);
  history.event(world, run.run_id, "q4.between-operation.completed", { cycle_id: id, mission_id: review.mission_id, order: cycle.order, update_count: cycle.updates.length }, "q4-bounded-career-processing");
  return { ok: true, idempotent: false, cycle: clone(cycle) };
}

function projection(world) { const state = ensure(world); return { completed_operations: state.completed_operations, recent_updates: clone(state.recent_updates), history: clone(state.operation_history) }; }
module.exports = { VERSION, ensure, cycleId, process, projection, assertAgencyBoundary };
