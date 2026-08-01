"use strict";

const phases = require("./mode-phases");
const humanWorld = require("./human-world");
const interactions = require("./q4-interactions");
const personnel = require("./q4-personnel");
const equipmentModel = require("./q4-equipment");
const trajectories = require("./q4-trajectories");
const continuity = require("./q4-continuity");
const bootstrap = require("./run-bootstrap");
const q4Visuals = require("./q4-visuals");
const radioModel = require("./q4-radio");
const timeModel = require("./q4-time");
const spatialRuntime = require("./spatial-runtime");
const missionRuntime = require("./mission-runtime");
const teamRuntime = require("./team-runtime");
const communicationRuntime = require("./communication-runtime");
const operationalTime = require("./operational-time");
const hazardRuntime = require("./hazard-runtime");
const cloneUpdates = (value) => structuredClone(value ?? []);

const VERSION = "yellow-beast-clear-q4-experience@v3";
const copy = {
  BRIEFING: "Review the Clear-Q4 survey assignment and continue to staging.",
  STAGING: "Review issued equipment and proceed to the Threshold room.",
  FACILITY_TRANSIT: "Proceed with the accounted team toward the Threshold room.",
  THRESHOLD: "Confirm personnel accountability and cross when ready.",
  STANDARD_RADIO_CHECK: "Establish contact with Standard and wait for acknowledgment before departure.",
  FIELD_OPERATION: "Continue the declared survey. Record what you actually observe and report only what you choose to transmit.",
  RETURN: "Return with the equipment and evidence that remain with the team.",
  DEBRIEF: "Review the expedition record. What you report remains distinct from what occurred and what you observed."
};

function diegeticText(value) {
  return String(value ?? "").replace(/; a report remains an account, not objective truth\.?/gi, ".").replace(/observer-qualified account of the site/gi, "field record of the site").replace(/observer-qualified account/gi, "field record").replace(/an field record/gi, "a field record");
}

function personnelContext(world, team) {
  const names = {};
  const status = {};
  for (const member of team) {
    const id = member.personnel_id ?? member.id;
    names[id] = String(member.display_name ?? "Assigned teammate").replace(/ · YOU$/, "");
    const record = world?.characters?.[id];
    status[id] = { status: record?.status ?? "active", condition: record?.condition ?? "normal" };
  }
  return { names, status };
}

function missionProjection(run) {
  if (!run?.expedition?.mission_state || !run.spatial_pack_id) return null;
  return missionRuntime.project(run.expedition.mission_state, bootstrap.missionDefinitionFor(run.spatial_pack_id));
}

function canonicalObjectives(runOrExpedition) {
  const progress = runOrExpedition?.spatial_pack_id ? missionProjection(runOrExpedition) : null;
  if (!progress) return [];
  return [...progress.required_objectives, ...progress.optional_objectives].map((objective) => ({ label: objective.name, state: objective.state, required: objective.required, detail: objective.summary, next_requirement: objective.next_requirement, blocking_reason: objective.blocking_reason, recent_transition: objective.recent_transition }));
}

function presentation(run, phase, unfinished = null, world = null) {
  const expedition = run.expedition;
  const mission = expedition?.mission ?? null;
  const localHistory = interactions.history(expedition, "local").map(interactions.publicEntry);
  const standardHistory = interactions.history(expedition, "standard").map(interactions.publicEntry);
  const actionHistory = interactions.history(expedition, "action").map(interactions.publicEntry);
  const team = run.spatial_pack_id ? teamRuntime.project(run) : personnel.publicTeam(run, phase.phase_id, world);
  const safeTeam = team.map(({ id, personnel_id, ...member }) => member);
  const player = team.find((member) => member.controlled) ?? team[0] ?? null;
  const safePlayer = safeTeam.find((member) => member.controlled) ?? safeTeam[0] ?? null;
  const coworkers = team.filter((member) => !member.controlled);
  const localCoworkers = coworkers.filter((member) => member.local_eligible);
  const radio = expedition?.equipment?.["survey-radio"];
  const liveLayout = ["FIELD_OPERATION", "RETURN", "DEBRIEF"].includes(phase.phase_id);
  const playerId = run.session?.startup?.player?.observer_id ?? expedition?.team?.members?.[0]?.personnel_id;
  const safeStatus = run.session ? bootstrap.status(run) : {};
  const operationalMap = run.spatial ? spatialRuntime.project(run.spatial, bootstrap.spatialDefinitionFor(run.spatial_pack_id), {
    personnel: team.map((member) => ({ id: member.personnel_id, name: String(member.display_name).replace(/ · YOU$/, ""), known_location: member.current_or_last_known_location ?? member.location, confirmed_current: ["LOCAL", "SELF"].includes(member.contact_state ?? member.contact_category) })),
    mission_markers: [{ id: "assigned-survey-area", label: "Assigned survey area", location: bootstrap.spatialDefinitionFor(run.spatial_pack_id).field_entry_location }]
  }) : null;
  const publicMap = operationalMap ? { ...operationalMap, nodes: operationalMap.nodes.map((node) => ({ ...node, personnel: (node.personnel ?? []).map(({ name, status }) => ({ name, status })) })) } : null;
  const topology = operationalMap ?? safeStatus.discovered_topology ?? { spaces: [], connections: [], unknown_exits: [] };
  const context = personnelContext(world, team);
  const equip = equipmentModel.projection(expedition, playerId, context.names, { spatial: run.spatial, observer: playerId, personnel_status: context.status, radio_confirmed_holders: [] });
  const evidence = (expedition?.evidence ?? []).map((item) => ({ id: item.id, mission_id: mission?.id ?? null, type: item.type, capture_event: item.capture_event ?? "evidence.recorded", method: item.method ?? "field record", device: item.device ?? "field recording device", observer: (item.capturing_observer ?? item.creator) === playerId ? "YOU" : context.names[item.capturing_observer ?? item.creator] ?? "assigned personnel", source: item.source_name ?? item.target_alias ?? "observed field feature", condition: item.condition_summary ?? item.target_observation ?? "Condition recorded at capture", location: item.source_location_name ?? item.location?.alias ?? item.location ?? null, time: item.captured_at ?? { interval: item.interval ?? 0 }, provenance: item.provenance, storage: item.storage ?? "with field record", reporting_state: item.reporting_state ?? (item.available_to_standard ? "reported" : "unreported"), render: item.render ?? { status: "fallback-ready" }, visual: q4Visuals.mediaVisual(item), available_to_player: item.available_to_player !== false, available_to_standard: item.available_to_standard === true }));
  const mapNames = Object.fromEntries((operationalMap?.nodes ?? []).map((node) => [node.id, node.name]));
  const layout = {
    current: liveLayout ? (safeStatus.view?.location?.alias ?? "Current location") : "Prior survey boundary",
    observed_spaces: liveLayout ? (operationalMap ? operationalMap.nodes.map((node) => ({ id: node.id, alias: node.name, family: node.type, status: node.status, current: node.current })) : topology.spaces ?? []) : [],
    observed_connections: liveLayout ? (operationalMap ? operationalMap.edges.filter((edge) => edge.to).map((edge) => ({ id: edge.id, from: mapNames[edge.from], to: mapNames[edge.to], status: edge.status })) : topology.connections ?? []) : [],
    unknown_continuations: liveLayout ? (operationalMap ? operationalMap.unresolved_exits.map((exit) => exit.label) : topology.unknown_exits ?? []) : [],
    prior_records: (mission?.prior_history ?? []).filter((item) => item.kind === "prior-layout-record").map((item) => ({ text: item.text, status: "PRIOR SURVEY RECORD" })),
    confidence: liveLayout ? ((operationalMap?.unresolved_exits?.length ?? topology.unknown_exits?.length) ? "unresolved continuation" : "confirmed current observation") : "PRIOR SURVEY RECORD"
  };
  const radioState = radioModel.ensure(expedition);
  const radioEquipmentReady = equipmentModel.stateUsable(radio) && radio?.charges > 0 && radio?.holder === playerId;
  const standardAvailable = radioEquipmentReady && radioModel.available(expedition) && ["STANDARD_RADIO_CHECK", "FIELD_OPERATION", "RETURN"].includes(phase.phase_id);
  const standardReason = !radioEquipmentReady ? "FIELD RADIO NOT OPERATIONAL" : phase.phase_id === "BRIEFING" ? "FIELD RADIO CHANNEL NOT ACTIVE DURING BRIEFING" : phase.phase_id === "STAGING" || phase.phase_id === "FACILITY_TRANSIT" ? "STANDARD UNAVAILABLE UNTIL THE RADIO-CHECK PHASE" : phase.phase_id === "THRESHOLD" ? "STANDARD UNAVAILABLE UNTIL RADIO CHECK" : radioModel.label(expedition);
  const channels = {
    action: { history: actionHistory },
    team_status: safeTeam,
    local: { available: localCoworkers.length > 0, targets: localCoworkers.map((member) => member.first_name), target: localCoworkers[0]?.first_name ?? null, unavailable_reason: localCoworkers.length ? null : "No assigned personnel share the current speaking-range zone.", history: localHistory },
    standard: { available: standardAvailable, state: radioState.state, state_label: radioModel.label(expedition), endpoint: "Standard", unavailable_reason: standardAvailable ? null : standardReason, history: standardHistory }
  };
  const checkIn = timeModel.status(expedition);
  const communication = communicationRuntime.project(expedition);
  const operationalClock = operationalTime.project(expedition);
  const hazardView = run.spatial_pack_id ? hazardRuntime.project(run, bootstrap.dynamicsDefinitionFor(run.spatial_pack_id)) : [];
  const location = run.spatial ? spatialRuntime.currentLocation(run.spatial, bootstrap.spatialDefinitionFor(run.spatial_pack_id)) : null;
  const interactables = liveLayout ? (safeStatus.view?.observations?.objects ?? []) : [];
  const fieldObservation = location && liveLayout ? spatialRuntime.locationObservation(run.spatial, bootstrap.spatialDefinitionFor(run.spatial_pack_id), { mode: "orient", nearby: localCoworkers.map((member) => member.first_name), objects: interactables.map((object) => object.observation) }) : null;
  const missionProgress = missionProjection(run);
  return {
    version: VERSION,
    phase: phase.phase_id,
    briefing: copy[phase.phase_id],
    mission: mission?.objective?.primary ?? expedition?.order?.primary ?? null,
    mission_record: mission ? { id: mission.id, display_id: mission.id.replace(/^CQ4-[A-Z-]+-/, "CQ4-").replace(/-[A-Z0-9]{4,}$/, ""), family: mission.family_label, rationale: diegeticText(mission.rationale), site: mission.site, objective: mission.objective, reporting: { ...mission.reporting, summary: diegeticText(mission.reporting?.summary) }, expected_duration: mission.expected_duration, risks: mission.risks, prior_history: mission.prior_history, status: missionProgress?.lifecycle ?? mission.status } : null,
    display_mission: mission?.objective?.primary ?? "Review the assigned field work and return with a field record.",
    restrictions: mission?.objective?.procedures ?? expedition?.order?.constraints ?? [],
    reporting: diegeticText(mission?.reporting?.summary ?? expedition?.order?.reporting),
    operational_time: `T+${operationalClock.interval} intervals`,
    operational_clock: operationalClock,
    check_in: checkIn,
    radio_check: { completed: radioState.check_completed, authorized: radioState.authorized, state: radioState.state },
    objectives: canonicalObjectives(run),
    mission_progress: missionProgress,
    player: player ? { name: String(player.display_name).replace(/ · YOU$/, ""), first_name: player.first_name, role: String(player.role ?? "").replace(/ · YOU$/, ""), clearance: player.clearance, condition: player.condition, assignment: player.assignment, visual: q4Visuals.personnelVisual(safePlayer) } : null,
    team: safeTeam,
    equipment: equip,
    radio: communication.messages.slice(-5),
    communications: communication,
    channels,
    layout,
    map: publicMap,
    current_location: location ? { id: location.id, name: location.name, type: location.type, description: location.short_description, environment: location.environment } : null,
    field_observation: fieldObservation,
    interactables,
    evidence,
    hazards: hazardView,
    operational_updates: cloneUpdates(run._last_operational_updates),
    visuals: q4Visuals.projection({ team: safeTeam, equipment: equip, evidence, channels, layout, review: phase.phase_id === "DEBRIEF" }),
    field_conditions: phase.phase_id === "FIELD_OPERATION" ? trajectories.publicState(expedition) : null,
    review: phase.phase_id === "DEBRIEF" ? continuity.review(world, mission?.id) : null,
    operational_follow_up: (unfinished?.items ?? []).filter((item) => ["communication", "observation", "personnel", "report", "object"].includes(item.kind)),
    human_context: humanWorld.q4Context()
  };
}

function nextPhase(phase, { action, canonical_crossed = false, returned = false, radio_check_completed = false, legacy_flow = phase.legacy_flow !== false } = {}) {
  const current = phase.phase_id;
  const table = {
    BRIEFING: "STAGING",
    STAGING: "FACILITY_TRANSIT",
    FACILITY_TRANSIT: "THRESHOLD",
    THRESHOLD: canonical_crossed ? (legacy_flow ? "FIELD_OPERATION" : "STANDARD_RADIO_CHECK") : null,
    STANDARD_RADIO_CHECK: action === "BEGIN_FIELD_OPERATION" && radio_check_completed ? "FIELD_OPERATION" : null,
    FIELD_OPERATION: returned ? "RETURN" : null,
    RETURN: returned ? "DEBRIEF" : null
  };
  const next = table[current];
  return next ? phases.transition(phase, next, { reason: action ?? "q4-gameflow", guard: true }) : { ok: false, code: "PHASE_GUARD_REJECTED", phase };
}

module.exports = { VERSION, copy, presentation, nextPhase, canonicalObjectives, missionProjection };
