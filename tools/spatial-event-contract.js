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
// Optional fields a type may carry. A selection may say WHERE the player was pointing (a canonical
// anchor/location id, never coordinates), which canonical candidates were visible, a canonical spatial
// relation ("beside" another entity) and the renderer's selection revision. All are INPUT: the
// resolver below checks each against canonical state.
const OPTIONAL_FIELDS = Object.freeze({
  spatial_reference_selected: Object.freeze(["anchor_id", "candidate_ids", "relation", "relation_target_id", "revision"])
});
const SPATIAL_RELATIONS = Object.freeze(["at", "beside", "behind", "in_front_of", "on", "under", "near", "inside"]);
// A selection older than this many simulation intervals is stale and never resolves a reference.
const MAX_SELECTION_AGE = 2;
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
    if (!ENVELOPE.includes(key) && !required.includes(key) && !(OPTIONAL_FIELDS[event.type] ?? []).includes(key)) return reject("SPATIAL_EVENT_FIELD_UNKNOWN", key);
  }
  if (event.candidate_ids !== undefined && (!Array.isArray(event.candidate_ids) || event.candidate_ids.some((id) => typeof id !== "string" || !id.trim()))) return reject("SPATIAL_EVENT_FIELD_INVALID", "candidate_ids");
  if (event.relation !== undefined && !SPATIAL_RELATIONS.includes(event.relation)) return reject("SPATIAL_EVENT_FIELD_INVALID", "relation");
  if (event.revision !== undefined && !Number.isInteger(event.revision)) return reject("SPATIAL_EVENT_FIELD_INVALID", "revision");
  for (const key of ["anchor_id", "relation_target_id"]) if (event[key] !== undefined && (typeof event[key] !== "string" || !event[key].trim())) return reject("SPATIAL_EVENT_FIELD_INVALID", key);
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
 * A renderer selection checked against CANONICAL spatial state before it may resolve any reference:
 * the observer exists and is somewhere; the selected entity is a canonical person, item or place the
 * observer can currently perceive (same location); any anchor/relation target is canonical and present;
 * a supplied candidate set contains the selection; and the selection is not stale. Accepts the full
 * event or the legacy {entity_id, kind, label} shape (then the player is the observer, now the time).
 */
function resolveSpatialReferenceSelection(run, input, { observer_id = null, now = null } = {}) {
  if (!input || typeof input !== "object") return reject("SPATIAL_SELECTION_MISSING");
  const current = Number.isFinite(Number(now)) ? Number(now) : Number(run?.expedition?.clock?.interval ?? 0);
  const event = input.type ? input : { type: "spatial_reference_selected", at: current, observer_id: observer_id ?? run?.session?.startup?.player?.observer_id ?? "", entity_id: input.entity_id, entity_kind: input.kind ?? input.entity_kind, label: input.label };
  const valid = validateSpatialEvent(event);
  if (!valid.ok) return valid;
  if (event.type !== "spatial_reference_selected") return reject("SPATIAL_EVENT_TYPE_MISMATCH");
  if (event.at > current || current - event.at > MAX_SELECTION_AGE) return reject("SPATIAL_SELECTION_STALE");
  const where = (id) => canonicalLedger.getPersonnelLocation(run, id);
  const here = where(event.observer_id);
  if (!here) return reject("SPATIAL_SELECTION_OBSERVER_UNPLACED");
  const presentHere = (id) => {
    if (!id) return false;
    if (where(id)) return where(id) === here;
    const equipment = run?.expedition?.equipment ?? {};
    const item = equipment[id] ?? Object.values(equipment).find((entry) => entry?.id === id) ?? null;
    if (item) return (item.holder && where(item.holder) === here) || run?.spatial?.equipment_locations?.[id] === here;
    // A place: the room itself, or a discovered/known connection from it.
    // (discovered_connections is keyed by connection id; tolerate a list shape too.)
    const connections = run?.spatial?.discovered_connections ?? {};
    const known = Array.isArray(connections) ? connections.map((c) => c?.id ?? c) : Object.keys(connections);
    return id === here || known.includes(id);
  };
  if (!presentHere(event.entity_id)) return reject("SPATIAL_SELECTION_NOT_PERCEIVABLE", event.entity_id);
  if (event.anchor_id && event.anchor_id !== here && !presentHere(event.anchor_id)) return reject("SPATIAL_SELECTION_ANCHOR_INVALID", event.anchor_id);
  if (event.relation_target_id && !presentHere(event.relation_target_id)) return reject("SPATIAL_SELECTION_RELATION_TARGET_INVALID", event.relation_target_id);
  if (event.candidate_ids && !event.candidate_ids.includes(event.entity_id)) return reject("SPATIAL_SELECTION_NOT_AMONG_CANDIDATES");
  return Object.freeze({ ok: true, selection: Object.freeze({ entity_id: event.entity_id, kind: event.entity_kind, label: event.label, observer_id: event.observer_id, location_id: here, anchor_id: event.anchor_id ?? null, relation: event.relation ?? null, relation_target_id: event.relation_target_id ?? null, at: event.at, revision: event.revision ?? null }) });
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

module.exports = { VERSION, SPATIAL_EVENT_TYPES, OPTIONAL_FIELDS, SPATIAL_RELATIONS, MAX_SELECTION_AGE, RENDERER_FIELDS, validateSpatialEvent, toSpatialSelection, resolveSpatialReferenceSelection, recordWitnessedHandoff };
