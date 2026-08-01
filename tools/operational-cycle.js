"use strict";

const operationalTime = require("./operational-time");
const communications = require("./communication-runtime");
const team = require("./team-runtime");
const hazards = require("./hazard-runtime");
const institutional = require("./institutional-runtime");

const VERSION = "yellow-beast-operational-cycle@v1";
const clone = (value) => structuredClone(value);

function ensure(run, dynamics) {
  operationalTime.migrate(run.expedition);
  communications.ensure(run.expedition);
  team.ensure(run);
  hazards.ensure(run, dynamics);
  run.expedition.operational.cycle_version = VERSION;
  if (run.spatial) run.spatial.time = run.expedition.clock.interval;
  return run.expedition.operational;
}

function resolve(run, dynamics, spatialDefinition, { action, cost = 0, source = "player-action", evaluateMission = null, syncEquipment = null, institutionalDefinition = null } = {}) {
  const operational = ensure(run, dynamics); const before = operational.clock.interval;
  const clock = operationalTime.advance(run.expedition, cost, `${source}:${String(action ?? "ACTION").toLowerCase()}`);
  if (run.spatial) run.spatial.time = operational.clock.interval;

  const scheduled = [];
  const resolveEnvironment = () => operationalTime.resolveDue(run.expedition, (event) => {
    if (event.event_type.startsWith("hazard.") || event.event_type.startsWith("environment.")) return { status: "completed", reason: "environmental scheduled event released", result: { event_type: event.event_type } };
    return { defer: true };
  }, (event) => event.event_type.startsWith("hazard.") || event.event_type.startsWith("environment."));
  const resolveCommunications = () => operationalTime.resolveDue(run.expedition, (event) => {
    const outcome = communications.handleEvent(run, dynamics, event); return outcome ?? { status: "completed", reason: "scheduled operational event released" };
  }, (event) => event.event_type.startsWith("communication.") || event.event_type.startsWith("check-in."));
  const resolveInstitution = () => operationalTime.resolveDue(run.expedition, (event) => institutionalDefinition ? institutional.handleEvent(run, institutionalDefinition, event) : { status: "cancelled", reason: "institutional definition unavailable" }, (event) => event.event_type.startsWith("institution."));
  scheduled.push(...resolveEnvironment(), ...resolveCommunications());
  communications.updateCheckIns(run.expedition);
  if (institutionalDefinition) institutional.ingestDeliveredCommunications(run, institutionalDefinition);
  scheduled.push(...resolveInstitution());

  const decisions = cost > 0 ? team.decide(run, spatialDefinition, dynamics) : [];
  const hazardResolution = cost > 0 ? hazards.resolve(run, dynamics) : { updates: [], consequences: [] };
  // Consequences may advance the same clock. Drain anything newly due before mission evaluation.
  scheduled.push(...resolveEnvironment(), ...resolveCommunications());
  if (institutionalDefinition) institutional.ingestDeliveredCommunications(run, institutionalDefinition);
  scheduled.push(...resolveInstitution());
  syncEquipment?.(run.spatial, run.expedition);
  team.observe(run);
  communications.updateCheckIns(run.expedition);
  const missionUpdates = evaluateMission?.() ?? [];
  operational.evaluation_revision += 1;
  const updates = [
    ...scheduled.map((entry) => ({ kind: "scheduled-event", summary: entry.status === "completed" ? `${entry.event_type.replace(/[.-]/g, " ")} resolved.` : `${entry.event_type.replace(/[.-]/g, " ")} ${entry.status}.`, at: entry.at })),
    ...hazardResolution.updates
  ];
  clock.to = operational.clock.interval; clock.action_cost = cost; clock.consequence_delay = operational.clock.interval - clock.from - cost; clock.cost = operational.clock.interval - clock.from;
  const record = { sequence: operational.cycle_history.length + 1, kind: "operational-cycle", action: action ?? null, source, from: before, to: operational.clock.interval, cost: clock.cost, action_cost: cost, consequence_delay: clock.consequence_delay, scheduled_event_ids: scheduled.map((entry) => entry.event_id), decision_count: decisions.length, consequence_ids: hazardResolution.consequences.map((entry) => entry.id), mission_transition_count: missionUpdates.length };
  operational.cycle_history.push(record);
  operational.recent_public_updates = clone(updates);
  run._last_operational_updates = updates; run._last_mission_updates = missionUpdates;
  return { version: VERSION, clock, scheduled_events: scheduled, team_decisions: clone(decisions), hazard_updates: clone(hazardResolution.updates), consequences: clone(hazardResolution.consequences), mission_updates: clone(missionUpdates), public_updates: clone(updates) };
}

module.exports = { VERSION, ensure, resolve };
