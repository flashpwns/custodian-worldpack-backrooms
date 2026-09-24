"use strict";

// Contract for the canonical events a future spatial runtime (Godot) must emit. Godot visualizes;
// the simulation decides. Point-and-click input produces intent, never a result. Nothing a renderer
// holds (positions, transforms, cameras, node paths, raycasts) is ever simulation truth, so an event
// carrying renderer state is rejected outright.
//
// This module does not move anyone or generate any world. It only (1) validates an event against the
// contract and (2) maps a validated event onto the INPUT an existing authority already consumes:
//   spatial_reference_selected -> dialogue-discourse spatial_selection ("that door")
//   handoff_witnessed          -> the custody-observation record resolveCustodyKnowledge reads,
//                                 written only if the canonical holder confirms the handoff happened
// Every other event type is defined here so the interface is fixed before movement exists; applying
// them stays with the owning authorities (spatial runtime, observation-authority, communication
// routing) once the runtime emits them.

const canonicalLedger = require("./canonical-world-ledger");

const VERSION = "yellow-beast-spatial-event-contract@v1";

const SPATIAL_EVENT_TYPES = Object.freeze({
  actor_entered_room: Object.freeze(["actor_id", "location_id"]),
  actor_left_room: Object.freeze(["actor_id", "location_id"]),
  person_present: Object.freeze(["observer_id", "person_id", "location_id"]),
  object_visible: Object.freeze(["observer_id", "object_id", "location_id"]),
  object_not_visible: Object.freeze(["observer_id", "object_id", "location_id"]),
  object_inspected: Object.freeze(["actor_id", "object_id"]),
  object_moved: Object.freeze(["actor_id", "object_id", "from_location_id", "to_location_id"]),
  handoff_witnessed: Object.freeze(["observer_id", "equipment_id", "from_id", "to_id"]),
  sound_heard: Object.freeze(["observer_id", "source_id", "location_id"]),
  spatial_reference_selected: Object.freeze(["observer_id", "entity_id", "entity_kind", "label"]),
  traversal_started: Object.freeze(["actor_id", "from_location_id", "to_location_id"]),
  traversal_completed: Object.freeze(["actor_id", "from_location_id", "to_location_id"]),
  traversal_interrupted: Object.freeze(["actor_id", "from_location_id", "to_location_id"]),
  portal_discovered: Object.freeze(["observer_id", "connection_id"]),
  movement_segment_completed: Object.freeze(["actor_id", "segment_id"])
});
// Common envelope every event carries; `at` is canonical simulation time (interval), never wall time.
const ENVELOPE = Object.freeze(["type", "at", "event_id", "source"]);
// Renderer state is never truth.
const RENDERER_FIELDS = Object.freeze(["position", "transform", "rotation", "camera", "mesh", "node", "node_path", "screen", "pixel", "raycast", "viewport", "velocity", "frame", "fps", "scene_tree"]);

function reject(code, detail = null) { return Object.freeze({ ok: false, code, ...(detail ? { detail } : {}) }); }

/** Validates one event against the contract. Fails closed on anything unknown or renderer-shaped. */
function validateSpatialEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return reject("SPATIAL_EVENT_MALFORMED");
  const required = SPATIAL_EVENT_TYPES[event.type];
  if (!required) return reject("SPATIAL_EVENT_TYPE_UNKNOWN", String(event.type ?? ""));
  if (!Number.isFinite(event.at)) return reject("SPATIAL_EVENT_TIME_INVALID");
  for (const key of Object.keys(event)) {
    if (RENDERER_FIELDS.includes(key)) return reject("SPATIAL_EVENT_RENDERER_STATE", key);
    if (!ENVELOPE.includes(key) && !required.includes(key)) return reject("SPATIAL_EVENT_FIELD_UNKNOWN", key);
  }
  for (const key of required) {
    if (typeof event[key] !== "string" || !event[key].trim()) return reject("SPATIAL_EVENT_FIELD_MISSING", key);
  }
  return Object.freeze({ ok: true, type: event.type });
}

/** spatial_reference_selected -> the selection dialogue-discourse resolves deixis from. */
function toSpatialSelection(event) {
  const valid = validateSpatialEvent(event);
  if (!valid.ok || event.type !== "spatial_reference_selected") return null;
  return Object.freeze({ entity_id: event.entity_id, kind: event.entity_kind, label: event.label });
}

/**
 * handoff_witnessed -> custody knowledge for the witness. The runtime may report that an observer SAW
 * a handoff; it cannot make one happen. The record is written only when canonical custody agrees
 * (the item really is with `to_id` now) and the witness is a team member.
 */
function recordWitnessedHandoff(run, event) {
  const valid = validateSpatialEvent(event);
  if (!valid.ok) return valid;
  if (event.type !== "handoff_witnessed") return reject("SPATIAL_EVENT_TYPE_MISMATCH");
  const equipment = run?.expedition?.equipment ?? {};
  const item = equipment[event.equipment_id] ?? Object.values(equipment).find((entry) => entry?.id === event.equipment_id) ?? null;
  if (!item) return reject("HANDOFF_ITEM_UNKNOWN");
  if (canonicalLedger.normalizePersonnelId(run, item.holder) !== canonicalLedger.normalizePersonnelId(run, event.to_id)) return reject("HANDOFF_NOT_CANONICAL");
  const witness = canonicalLedger.getObserverMember(run, event.observer_id);
  if (!witness) return reject("HANDOFF_WITNESS_UNKNOWN");
  witness.known_information ??= [];
  const entry = { kind: "custody-observed", source: "direct-observation", equipment_id: item.id, holder_id: item.holder, from_id: event.from_id, at: event.at, spatial_event_id: event.event_id ?? null };
  witness.known_information.push(entry);
  return Object.freeze({ ok: true, entry: Object.freeze({ ...entry }) });
}

module.exports = { VERSION, SPATIAL_EVENT_TYPES, RENDERER_FIELDS, validateSpatialEvent, toSpatialSelection, recordWitnessedHandoff };
