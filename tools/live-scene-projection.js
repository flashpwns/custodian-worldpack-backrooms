"use strict";

// Observer-safe, read-only input for future language presentation. This module
// deliberately allowlists projected facts; it never serializes the run/world.
const bootstrap = require("./run-bootstrap");
const objectRuntime = require("./object-runtime");
const environment = require("./q4-environment");

const VERSION = "yellow-beast-live-scene-packet@v1";
const CONCLUSION_KINDS = new Set(["observer-conclusion", "established-conclusion"]);
const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function failure(code, message) {
  return deepFreeze({ ok:false, error:{ code, message } });
}

function memberId(member) { return member?.personnel_id ?? member?.id ?? null; }
function memberLabel(member) { return member?.display_name ?? ([member?.first_name, member?.last_name].filter(Boolean).join(" ") || "Assigned teammate"); }
function ordered(values, key) { return values.sort((left, right) => String(key(left)).localeCompare(String(key(right)))); }

function observerMember(run, observerId) {
  return (run.expedition?.team?.members ?? []).find((member) => {
    const id = memberId(member);
    return id === observerId || id === `personnel-${observerId}` || observerId === `personnel-${id}`;
  }) ?? null;
}

function locationKnowledge(run, observerId, locationId) {
  return run.survey_frontier?.personnel?.[observerId]?.locations?.[locationId] ?? null;
}

function projectObjects(run, observerId, locationId) {
  if (!run.object_state || !run.spatial_pack_id) return [];
  const definition = bootstrap.interactionDefinitionFor(run.spatial_pack_id);
  return ordered(objectRuntime.projectLocation(run.object_state, definition, { observer:observerId, location:locationId })
    .map((object) => ({
      name:object.name,
      type:object.object_type,
      visible_condition:object.condition,
      observation:object.observation,
      known_properties:[...(object.known_properties ?? [])]
    })), (object) => object.name);
}

function currentCoordinatedRecord(run) {
  const now = run.expedition?.clock?.interval ?? 0;
  return (run.expedition?.coordinated_attempts ?? []).filter((record) => record.interval === now).at(-1) ?? null;
}

function projectRecentEvents(run, observerId, locationId) {
  const record = currentCoordinatedRecord(run);
  if (!record) return [];
  const personnelLocations = run.spatial?.personnel_locations ?? {};
  return record.outcomes
    .filter((outcome) => personnelLocations[outcome.actor] === locationId)
    .map((outcome) => ({
      kind:"coordinated-attempt-outcome",
      interval_id:record.interval_id,
      interval:record.interval,
      actor_id:outcome.actor,
      action:outcome.action,
      target:outcome.target,
      equipment:outcome.equipment ?? null,
      outcome:outcome.outcome,
      directly_observed_result:outcome.actor === observerId ? outcome.public_reason ?? null : null
    }));
}

function projectPersonnel(run, observerId, locationId) {
  const knownStatus = run.spatial?.personnel_known_status ?? {};
  return ordered((run.expedition?.team?.members ?? [])
    .filter((member) => run.spatial?.personnel_locations?.[memberId(member)] === locationId)
    .map((member) => {
      const id = memberId(member); const known = knownStatus[id] ?? {};
      return {
        observer_id:id,
        known_identity:memberLabel(member),
        role_if_known:member.role ?? null,
        visible_condition:known.condition ?? known.health ?? (id === observerId ? member.condition ?? member.health ?? member.status ?? null : member.status ?? null),
        // The current runtime records completed outcomes, not ongoing actions.
        // Those outcomes belong in recent_observable_events and must not be
        // promoted into invented continuous activity.
        current_visible_action:null,
        is_observer:id === observerId
      };
    }), (member) => member.observer_id);
}

function projectPriorRecords(run, observerId, member) {
  const player = run.session?.startup?.player?.observer_id;
  const explicit = new Set((member?.known_information ?? [])
    .filter((item) => item.kind === "prior-record-access" && typeof item.record_id === "string")
    .map((item) => item.record_id));
  if (observerId !== player && explicit.size === 0) return [];
  return ordered((run.expedition?.mission?.prior_history ?? [])
    .filter((record) => observerId === player || explicit.has(record.id))
    .map((record) => ({
      record_id:record.id,
      record_kind:record.kind ?? "prior-record",
      source:record.source ?? null,
      status:record.status ?? null,
      recorded_passage_depth_m:record.recorded_passage_depth_m ?? null,
      recorded_clearance_m:record.recorded_clearance_m ?? null,
      parallel_corridor_axis_interval_m:clone(record.parallel_corridor_axis_interval_m ?? null),
      record_text:record.text ?? null
    })), (record) => record.record_id);
}

function evidenceVisibleTo(run, observerId, evidence) {
  const player = run.session?.startup?.player?.observer_id;
  if (observerId === player) return evidence.available_to_player !== false;
  return [evidence.creator, evidence.operator, evidence.capturing_observer, evidence.custodian].includes(observerId)
    || (observerMember(run, observerId)?.known_information ?? []).some((item) => item.kind === "evidence-access" && item.evidence_id === evidence.id);
}

function projectMeasurements(run, observerId) {
  return ordered((run.expedition?.evidence ?? [])
    .filter((evidence) => evidence.valid === true && evidence.measurement && evidenceVisibleTo(run, observerId, evidence))
    .map((evidence) => ({
      evidence_id:evidence.id,
      record_kind:"current-measurement",
      evidence_type:evidence.type,
      location_name:evidence.source_location_name ?? null,
      measurement:{ kind:evidence.measurement.kind, value:evidence.measurement.value, unit:evidence.measurement.unit },
      method:evidence.method ?? null,
      equipment:evidence.device ?? null,
      captured_at:clone(evidence.captured_at ?? { interval:evidence.interval ?? null }),
      creator:evidence.creator ?? null,
      operator:evidence.operator ?? null,
      capturing_observer:evidence.capturing_observer ?? null,
      custodian:evidence.custodian ?? null,
      provenance:evidence.provenance ?? null,
      reporting_state:evidence.reporting_state ?? null
    })), (record) => record.evidence_id);
}

function projectObserverKnowledge(run, observerId, member) {
  const information = member?.known_information ?? [];
  const directObservations = information.filter((item) => item.source === "direct-observation" || ["coordinated-inspection", "location-investigated"].includes(item.kind)).map((item) => ({
    kind:item.kind,
    target:item.target ?? null,
    location:item.location ?? null,
    observed_at:item.at ?? null,
    source:"direct-observation",
    interval_id:item.interval_id ?? null
  }));
  const reportedKnowledge = information.filter((item) => item.kind === "reported-knowledge" || (item.source && item.source !== "direct-observation")).map((item) => ({
    kind: item.kind ?? "reported-knowledge",
    text: item.text ?? item.proposition ?? null,
    proposition: item.proposition ?? item.text ?? null,
    sender: item.sender ?? item.source_observer_id ?? null,
    source_observer_id: item.source_observer_id ?? item.sender ?? null,
    origin_observer_id: item.origin_observer_id ?? null,
    via_observer_id: item.via_observer_id ?? null,
    is_direct_witness: item.is_direct_witness ?? false,
    at: item.at ?? null,
    source: item.source ?? "local-communication",
    message_id: item.message_id ?? item.source_message_id ?? null
  }));
  const conclusions = information.filter((item) => CONCLUSION_KINDS.has(item.kind)).map((item) => ({
    kind:item.kind,
    conclusion:item.conclusion ?? null,
    basis_evidence_ids:Array.isArray(item.basis_evidence_ids) ? [...item.basis_evidence_ids] : [],
    established_at:item.established_at ?? item.at ?? null,
    source:item.source ?? null
  }));
  const mission = run.expedition?.mission;
  return {
    mission_context:mission ? { operation_id:mission.display_id ?? mission.id ?? null, assignment:mission.family_label ?? null, objective:mission.objective?.primary ?? null } : null,
    known_records:projectPriorRecords(run, observerId, member),
    established_measurements:projectMeasurements(run, observerId),
    direct_observations:directObservations,
    reported_knowledge:reportedKnowledge,
    unresolved_observations:directObservations,
    established_conclusions:conclusions
  };
}

function messageVisibleTo(message, observerId) {
  if (message.sender === observerId) return true;
  return (message.actual_recipients ?? []).includes(observerId);
}

function projectCommunication(run, observerId, locationId) {
  const members = new Map((run.expedition?.team?.members ?? []).map((member) => [memberId(member), member]));
  const label = (id) => id === "Standard" ? "Standard" : memberLabel(members.get(id));
  const local = ordered([...members.keys()].filter((id) => id !== observerId && run.spatial?.personnel_locations?.[id] === locationId)
    .map((id) => ({ observer_id:id, known_identity:label(id) })), (entry) => entry.observer_id);
  const messages = (run.expedition?.messages ?? []).filter((message) => messageVisibleTo(message, observerId)).slice(-12).map((message) => ({
    message_id:message.id,
    channel:message.channel,
    sender:label(message.sender),
    recipient:label(message.intended_recipient),
    text:message.text,
    state:message.state,
    sent_at:message.sent_at,
    delivered_at:message.delivered_at ?? null
  }));
  const player = run.session?.startup?.player?.observer_id;
  const controlsRadio = Object.values(run.expedition?.equipment ?? {}).some((item) => item.holder === observerId && item.capability === "field-radio");
  const radio = observerId === player || controlsRadio ? {
    state:run.expedition?.radio?.state ?? null,
    check_completed:run.expedition?.radio?.check_completed === true,
    authorized:run.expedition?.radio?.authorized === true
  } : null;
  return { local, standard:radio, recent_messages:messages };
}

function projectActionContext(run, observerId, location, objects, visiblePersonnel) {
  const held = ordered(Object.entries(run.expedition?.equipment ?? {}).filter(([, item]) => item.holder === observerId).map(([id, item]) => ({
    equipment_id:id,
    label:item.label ?? item.model ?? "Assigned equipment",
    capability:item.capability ?? null,
    state:item.state ?? null,
    charges:item.charges ?? null
  })), (item) => item.equipment_id);
  const visibleTargets = ordered([
    ...(location.landmarks ?? []).map((landmark) => landmark.name),
    ...objects.map((object) => object.name)
  ].filter(Boolean).map((label) => ({ label })), (target) => target.label);
  return {
    visible_targets:visibleTargets,
    held_equipment:held,
    local_coworkers:visiblePersonnel.filter((person) => person.observer_id !== observerId).map((person) => ({ observer_id:person.observer_id, known_identity:person.known_identity, role_if_known:person.role_if_known }))
  };
}

function projectLiveScene(runValue, { observer_id:observerId } = {}) {
  if (!runValue || typeof runValue !== "object" || Array.isArray(runValue) || !runValue.expedition || !runValue.spatial) return failure("LIVE_SCENE_RUN_INVALID", "An active authoritative spatial run is required.");
  if (typeof observerId !== "string" || !observerId.trim()) return failure("LIVE_SCENE_OBSERVER_INVALID", "A valid observer identity is required.");

  // Work only over a clone so even lazy/defaulting behavior in a reused read
  // helper cannot alter canonical state.
  const run = clone(runValue);
  const member = observerMember(run, observerId);
  const id = member ? memberId(member) : observerId;
  const locationId = run.spatial?.personnel_locations?.[id] ?? run.spatial?.personnel_locations?.[observerId];
  if (!member || !locationId) return failure("LIVE_SCENE_OBSERVER_UNKNOWN", "The observer is not assigned and physically located in the active scene.");

  let topology; try { topology = bootstrap.topologyFor(run); } catch { return failure("LIVE_SCENE_WORLD_UNAVAILABLE", "The active spatial authority could not be projected."); }
  const location = topology.locations.find((entry) => entry.id === locationId);
  if (!location) return failure("LIVE_SCENE_LOCATION_UNKNOWN", "The observer's authoritative location is unavailable.");

  const knownLocation = locationKnowledge(run, observerId, locationId);
  const objects = projectObjects(run, observerId, locationId);
  const events = projectRecentEvents(run, observerId, locationId);
  const personnel = projectPersonnel(run, observerId, locationId);
  const effective = environment.current(run.spatial.environment, locationId);
  const packet = {
    version:VERSION,
    observer_id:observerId,
    interval:{ operational:run.expedition.clock?.interval ?? 0, coordinated_interval_id:events[0]?.interval_id ?? null },
    location:{
      id:knownLocation ? location.id : null,
      known_name:knownLocation ? location.name : null,
      visible_description:location.short_description ?? null
    },
    visible_environment:{
      lighting:location.environment?.lighting ?? effective?.lighting ?? null,
      audible_conditions:location.environment?.sound ?? null,
      visible_conditions:[location.environment?.surface, effective?.structural && effective.structural !== "stable" ? `Structure: ${effective.structural}.` : null, effective?.moisture && effective.moisture !== "dry" ? `Surface moisture: ${effective.moisture}.` : null].filter(Boolean)
    },
    visible_objects:objects,
    visible_personnel:personnel,
    recent_observable_events:events,
    observer_knowledge:projectObserverKnowledge(run, observerId, member),
    communication_context:projectCommunication(run, observerId, locationId),
    available_action_context:projectActionContext(run, observerId, location, objects, personnel)
  };
  return deepFreeze({ ok:true, packet });
}

function projectObserverState(runValue, observerId, purpose = "presentation") {
  if (observerId === "Standard") {
    const run = clone(runValue);
    const messages = (run.expedition?.messages ?? []).filter((m) =>
      m.intended_recipient === "Standard" && ["delivered", "acknowledged"].includes(m.state)
    );
    const evidence = (run.expedition?.evidence ?? []).filter((e) => e.reported_to_standard === true);
    const mission = run.expedition?.mission;
    return deepFreeze({
      ok: true,
      packet: {
        version: VERSION,
        observer_id: "Standard",
        purpose: "standard-operator",
        mission_parameters: mission ? {
          id: mission.id,
          family_label: mission.family_label,
          objective: mission.objective
        } : null,
        received_transmissions: messages.map((m) => ({
          message_id: m.id,
          sender: m.sender,
          text: m.text,
          purpose: m.purpose,
          delivered_at: m.delivered_at,
          evidence_ids: [...(m.evidence_ids ?? [])]
        })),
        confirmed_evidence: evidence.map((e) => ({
          evidence_id: e.id,
          type: e.type,
          measurement: e.measurement ?? null
        }))
      }
    });
  }

  const projected = projectLiveScene(runValue, { observer_id: observerId });
  if (!projected.ok) return projected;
  const p = projected.packet;

  if (purpose === "player-interpreter") {
    const shell = {
      version: VERSION,
      purpose: "player-interpreter",
      observer_id: observerId,
      location: {
        id: p.location.id,
        known_name: p.location.known_name,
        visible_description: p.location.visible_description
      },
      visible_environment: p.visible_environment,
      visible_objects: p.visible_objects.map((obj) => ({
        name: obj.name,
        type: obj.type,
        visible_condition: obj.visible_condition,
        observation: obj.observation
      })),
      visible_personnel: p.visible_personnel.map((pers) => ({
        observer_id: pers.observer_id,
        known_identity: pers.known_identity,
        role_if_known: pers.role_if_known,
        visible_condition: pers.visible_condition
      })),
      held_equipment: p.available_action_context.held_equipment,
      visible_targets: p.available_action_context.visible_targets,
      local_coworkers: p.available_action_context.local_coworkers,
      recent_observable_events: p.recent_observable_events,
      observer_knowledge: {
        direct_observations: p.observer_knowledge.direct_observations ?? p.observer_knowledge.unresolved_observations,
        reported_knowledge: p.observer_knowledge.reported_knowledge ?? [],
        established_measurements: p.observer_knowledge.established_measurements
      }
    };
    return deepFreeze({ ok: true, packet: shell });
  }

  if (purpose === "coworker-mini-shell") {
    const member = observerMember(runValue, observerId);
    const shell = {
      version: VERSION,
      purpose: "coworker-mini-shell",
      identity: {
        observer_id: observerId,
        known_identity: memberLabel(member),
        role: member?.role ?? null
      },
      physical: {
        location: p.location,
        nearby_personnel: p.visible_personnel.filter((pers) => pers.observer_id !== observerId),
        visible_objects: p.visible_objects,
        held_equipment: p.available_action_context.held_equipment
      },
      operational: {
        current_task: member?.task ?? null,
        task_history: member?.task_history?.slice(-3) ?? []
      },
      knowledge: {
        direct_observations: p.observer_knowledge.direct_observations ?? p.observer_knowledge.unresolved_observations,
        reported_knowledge: p.observer_knowledge.reported_knowledge ?? [],
        known_records: p.observer_knowledge.known_records,
        negative_constraints: [
          "Do not claim knowledge of locations not present in this observer shell.",
          "Do not claim possession or perception of equipment held by offscreen personnel without prior communication.",
          "Do not access or claim awareness of uncommunicated player thoughts or untransmitted Standard logs.",
          "Do not assert unobserved events or offscreen phenomena as direct witness."
        ]
      },
      conversation: {
        recent_messages: p.communication_context.recent_messages
      }
    };
    return deepFreeze({ ok: true, packet: shell });
  }

  return projected;
}

function validateNegativeConstraintsNoLeaks(constraints, run) {
  if (!Array.isArray(constraints)) return { ok: false, leaked: [], reason: "Constraints must be an array" };
  const leaked = [];

  // Internal ID pattern
  const internalIdRegex = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;

  let hiddenLocationIds = [];
  if (run?.spatial_pack_id) {
    try {
      const topology = bootstrap.topologyFor(run);
      if (topology && Array.isArray(topology.locations)) {
        hiddenLocationIds = topology.locations.map((loc) => loc.id).filter(Boolean);
      }
    } catch {}
  }

  let hiddenObjectIds = [];
  if (run?.object_state) {
    hiddenObjectIds = Object.keys(run.object_state).filter(Boolean);
  }

  for (const c of constraints) {
    const text = String(c);
    const match = text.match(internalIdRegex);
    if (match && !leaked.includes(match[0])) {
      leaked.push(match[0]);
    }
    for (const locId of hiddenLocationIds) {
      if (locId && text.toLowerCase().includes(locId.toLowerCase()) && !leaked.includes(locId)) {
        leaked.push(locId);
      }
    }
    for (const objId of hiddenObjectIds) {
      if (objId && text.toLowerCase().includes(objId.toLowerCase()) && !leaked.includes(objId)) {
        leaked.push(objId);
      }
    }
  }

  return {
    ok: leaked.length === 0,
    leaked,
    reason: leaked.length > 0 ? `Negative constraints leaked internal/hidden identifiers: ${leaked.join(", ")}` : null
  };
}

module.exports = {
  VERSION,
  projectLiveScene,
  projectObserverState,
  validateNegativeConstraintsNoLeaks
};
