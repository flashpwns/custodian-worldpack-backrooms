"use strict";

const crypto = require("node:crypto");
const definitions = require("../data/entity-definitions.json");
const history = require("./world-history");
const VERSION = "yellow-beast-entity-simulation@v1";
const PROJECTION_VERSION = "yellow-beast-entity-projection@v1";
const clone = (value) => structuredClone(value);
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stableId = (kind, values) => `${kind}-${hash(values).slice(0, 16)}`;
const entityId = (world, type, region_id, space_id, origin) => stableId("entity", [world.world_id, type, region_id, space_id, origin]);
const hazardId = (world, type, region_id, space_id, origin) => stableId("hazard", [world.world_id, type, region_id, space_id, origin]);
const encounterId = (world, run_id, observer, subject) => stableId("encounter", [world.world_id, run_id, observer, subject]);
const traceId = (world, entity_id, region_id, space_id, type) => stableId("trace", [world.world_id, entity_id, region_id, space_id, type]);

function state(world) { history.assertWorld(world); world.entities ??= {}; world.hazards ??= {}; world.encounters ??= {}; world.traces ??= {}; return world; }
function definition(id) { return definitions.definitions.find((item) => item.id === id) ?? null; }
function hazardDefinition(type) { return definitions.hazard_definitions.find((item) => item.id === type) ?? null; }
function behaviorRule(id) { return definitions.behavior_rules.find((item) => item.rule_id === id) ?? null; }
function validLocation(world, region_id, space_id) { return Boolean(world.regions[region_id]?.state.nodes[space_id]); }
function entityDefinitionFor({ type, definition_id }) { const entry = definition(definition_id); return entry?.entity_type === type ? entry : null; }

function addEntity(world, { run_id, type, region_id, space_id, definition_id, authority, provenance, behavior_state = "stationary", perception_channels = [] }) {
  state(world);
  const entry = entityDefinitionFor({ type, definition_id });
  if (!entry) return { ok: false, code: type === "still-life" ? "STILL_LIFE_BEHAVIOR_PROHIBITED" : "ENTITY_DEFINITION_UNAVAILABLE" };
  if (!validLocation(world, region_id, space_id)) return { ok: false, code: "ENTITY_LOCATION_UNKNOWN" };
  if (!entry.permitted_behavior_states.includes(behavior_state) || perception_channels.some((channel) => !entry.permitted_perception_channels.includes(channel))) return { ok: false, code: "ENTITY_CAPABILITY_PROHIBITED" };
  const id = entityId(world, type, region_id, space_id, definition_id);
  if (world.entities[id]) return { ok: true, idempotent: true, entity: clone(world.entities[id]) };
  const entity = { id, type, world_id: world.world_id, region_id, space_id, active: true, physical_state: "present", behavior_state, definition_id, authority, provenance, origin_run: run_id, perception: { channels: [...new Set(perception_channels)], status: "unaware" }, history: [] };
  world.entities[id] = entity;
  history.event(world, run_id, "entity.present", { entity_id: id, type, region_id, space_id, definition_id, authority, provenance }, authority);
  return { ok: true, entity: clone(entity) };
}

function addHazard(world, { run_id, type, region_id, space_id, authority, provenance, effect = "avoidance-required", warning = "local-warning", consequence = "route-unavailable" }) {
  state(world);
  const entry = hazardDefinition(type);
  if (!entry || !entry.allowed_consequences.includes(consequence)) return { ok: false, code: "HAZARD_CONSEQUENCE_PROHIBITED" };
  if (!validLocation(world, region_id, space_id)) return { ok: false, code: "HAZARD_LOCATION_UNKNOWN" };
  const id = hazardId(world, type, region_id, space_id, provenance);
  if (world.hazards[id]) return { ok: true, idempotent: true, hazard: clone(world.hazards[id]) };
  const hazard = { id, type, world_id: world.world_id, region_id, space_id, active: true, authority, provenance, effect, warning, consequence, origin_run: run_id, discoverability: "local-perception", persistent_effect: null };
  world.hazards[id] = hazard;
  history.event(world, run_id, "hazard.present", { hazard_id: id, type, region_id, space_id, authority, provenance, consequence }, authority);
  return { ok: true, hazard: clone(hazard) };
}

function localItems(world, region_id, space_id) { state(world); return { entities: Object.values(world.entities).filter((item) => item.active && item.region_id === region_id && item.space_id === space_id), hazards: Object.values(world.hazards).filter((item) => item.active && item.region_id === region_id && item.space_id === space_id), traces: Object.values(world.traces).filter((item) => item.active && item.region_id === region_id && item.space_id === space_id) }; }
function safeEntity(item) { return { kind: item.type, presence: "visible-physical-presence" }; }
function safeHazard(item) { return { type: item.type, warning: item.warning, effect: item.effect }; }
function safeTrace(item) { return { kind: item.type, description: item.description }; }
function resolveObserverPerception(world, { run_id, observer, region_id, space_id }) {
  const local = localItems(world, region_id, space_id);
  const visible_entities = local.entities.map(safeEntity); const local_hazards = local.hazards.map(safeHazard); const perceived_traces = local.traces.map(safeTrace);
  const perceived = { visible_entities, perceived_traces, local_hazards, available_responses: [...(visible_entities.length ? ["RETREAT", "WAIT", "OBSERVE"] : []), ...(local_hazards.length ? ["AVOID", "CONTINUE", "RETREAT", "WAIT"] : [])] };
  for (const item of local.entities) history.event(world, run_id, "entity.perceived", { entity_id: item.id, region_id, space_id, observer }, item.authority);
  for (const item of local.hazards) history.event(world, run_id, "hazard.perceived", { hazard_id: item.id, region_id, space_id, observer }, item.authority);
  for (const item of local.traces) history.event(world, run_id, "entity.trace.perceived", { trace_id: item.id, region_id, space_id, observer }, item.authority);
  return perceived;
}

function entityPerception(world, { entity_id, observer, region_id, space_id }) {
  const entity = world.entities?.[entity_id]; if (!entity) return { detected: false, code: "ENTITY_UNKNOWN" };
  const permitted = entity.perception.channels.includes("visual") && entity.region_id === region_id && entity.space_id === space_id;
  if (permitted) entity.perception.status = "detected-observer";
  return { detected: permitted };
}
function beginEncounter(world, { run_id, observer, region_id, space_id, subject_type, subject_id }) {
  state(world); const subject = subject_type === "entity" ? world.entities[subject_id] : world.hazards[subject_id];
  if (!subject || !subject.active || subject.region_id !== region_id || subject.space_id !== space_id) return { ok: false, code: "ENCOUNTER_TRIGGER_INVALID" };
  const id = encounterId(world, run_id, observer, subject_id); if (world.encounters[id]) return { ok: true, idempotent: true, encounter: clone(world.encounters[id]) };
  const entity_detection = subject_type === "entity" ? entityPerception(world, { entity_id: subject_id, observer, region_id, space_id }).detected : false;
  const encounter = { id, world_id: world.world_id, run_id, observer, region_id, space_id, subject_type, subject_id, observer_detected: true, entity_detected_observer: entity_detection, status: "active", options: subject_type === "entity" ? ["RETREAT", "WAIT", "OBSERVE"] : ["AVOID", "CONTINUE", "RETREAT", "WAIT"], outcome: null };
  world.encounters[id] = encounter; history.event(world, run_id, "encounter.started", { encounter_id: id, subject_type, subject_id, region_id, space_id, observer_detected: true, entity_detected_observer: entity_detection }, subject.authority);
  return { ok: true, encounter: clone(encounter) };
}

function connected(world, region_id, from, to) { const region = world.regions[region_id]; return Object.values(region?.state.edges ?? {}).some((edge) => edge.traversable && ((edge.from === from && edge.to === to) || (edge.to === from && edge.from === to))); }
function neighbors(world, region_id, space_id) { return Object.values(world.regions[region_id]?.state.edges ?? {}).filter((edge) => edge.traversable && edge.to).map((edge) => edge.from === space_id ? { edge, space_id: edge.to } : edge.to === space_id ? { edge, space_id: edge.from } : null).filter(Boolean).sort((a, b) => a.edge.id.localeCompare(b.edge.id)); }
function applyHazardConsequence(world, { run_id, hazard, encounter }) {
  const result = { consequence: hazard.consequence, region_id: hazard.region_id, space_id: hazard.space_id };
  if (hazard.consequence === "route-unavailable") { const edge = neighbors(world, hazard.region_id, hazard.space_id)[0]?.edge; if (edge) { edge.persistent_state = "unavailable"; edge.traversable = false; result.edge_id = edge.id; } }
  if (hazard.consequence === "incapacitated" || hazard.consequence === "run-failed") { const run = world.runs[run_id]; if (run) { run.actor_state = hazard.consequence === "incapacitated" ? "incapacitated" : "failed"; if (hazard.consequence === "run-failed") run.status = "failed"; } result.actor_state = world.runs[run_id]?.actor_state; }
  hazard.persistent_effect = clone(result); history.event(world, run_id, "hazard.consequence", { hazard_id: hazard.id, encounter_id: encounter.id, ...result, authority: hazard.authority, provenance: hazard.provenance }, hazard.authority);
  if (result.actor_state === "incapacitated") history.event(world, run_id, "actor.incapacitated", { encounter_id: encounter.id, hazard_id: hazard.id, region_id: hazard.region_id, space_id: hazard.space_id }, hazard.authority);
  return result;
}
function resolveEncounter(world, { run_id, encounter_id, action, retreat_space_id = null, known_spaces = [] }) {
  const encounter = world.encounters?.[encounter_id]; if (!encounter || encounter.status !== "active" || encounter.run_id !== run_id) return { ok: false, code: "ENCOUNTER_UNAVAILABLE" };
  if (!encounter.options.includes(action)) return { ok: false, code: "ENCOUNTER_OPTION_UNAVAILABLE" };
  if ((action === "RETREAT" || action === "AVOID") && (!retreat_space_id || !known_spaces.includes(retreat_space_id) || !connected(world, encounter.region_id, encounter.space_id, retreat_space_id))) return { ok: false, code: "RETREAT_ROUTE_UNKNOWN" };
  encounter.status = "resolved"; encounter.outcome = action === "WAIT" ? "observed-no-authorized-change" : action === "OBSERVE" ? "observed" : action === "CONTINUE" ? "exposed" : "avoided";
  const subject = encounter.subject_type === "entity" ? world.entities[encounter.subject_id] : world.hazards[encounter.subject_id];
  let consequence = null;
  if (action === "CONTINUE" && encounter.subject_type === "hazard") { history.event(world, run_id, "hazard.exposed", { encounter_id, hazard_id: encounter.subject_id, outcome: encounter.outcome }, subject.authority); consequence = applyHazardConsequence(world, { run_id, hazard: subject, encounter }); }
  else history.event(world, run_id, action === "WAIT" ? "encounter.waited" : action === "OBSERVE" ? "encounter.observed" : action === "RETREAT" ? "encounter.retreat" : "hazard.avoided", { encounter_id, subject_type: encounter.subject_type, subject_id: encounter.subject_id, outcome: encounter.outcome }, subject.authority);
  return { ok: true, encounter: clone(encounter), location: retreat_space_id ?? encounter.space_id, consequence };
}

function changeEntityState(world, { run_id, entity, rule, destination_state }) { entity.behavior_state = destination_state; entity.history.push({ rule_id: rule.rule_id, state: destination_state }); history.event(world, run_id, "entity.state_changed", { entity_id: entity.id, region_id: entity.region_id, space_id: entity.space_id, rule_id: rule.rule_id, destination_state, authority: rule.authority, provenance: rule.provenance }, rule.authority); }
function createTrace(world, { run_id, entity, type = "movement-record", description = "a local trace", persistent = true }) { const entry = definition(entity.definition_id); if (!entry?.interaction_capabilities.includes("leave-trace")) return { ok: false, code: "ENTITY_INTERACTION_PROHIBITED" }; const id = traceId(world, entity.id, entity.region_id, entity.space_id, type); if (world.traces[id]) return { ok: true, idempotent: true, trace: clone(world.traces[id]) }; const trace = { id, type, description, world_id: world.world_id, entity_id: entity.id, region_id: entity.region_id, space_id: entity.space_id, active: true, persistent, authority: entity.authority, provenance: entity.provenance }; world.traces[id] = trace; history.event(world, run_id, "entity.trace_created", { trace_id: id, entity_id: entity.id, region_id: entity.region_id, space_id: entity.space_id, type, authority: entity.authority, provenance: entity.provenance }, entity.authority); return { ok: true, trace: clone(trace) };
}
function moveEntity(world, { run_id, entity_id, destination_space_id, rule_id }) {
  const entity = world.entities?.[entity_id]; const entry = entity && definition(entity.definition_id); const rule = behaviorRule(rule_id);
  if (!entity || !entry || !rule) return { ok: false, code: "ENTITY_OR_RULE_UNKNOWN" };
  if (!entry.permitted_movement_modes.includes("edge") || !entry.behavior_rule_ids.includes(rule_id) || rule.action !== "move-first-valid-edge") return { ok: false, code: "ENTITY_MOVEMENT_PROHIBITED" };
  if (!connected(world, entity.region_id, entity.space_id, destination_space_id)) return { ok: false, code: "ENTITY_MOVEMENT_INVALID_EDGE" };
  const from_space_id = entity.space_id; entity.space_id = destination_space_id; entity.history.push({ rule_id, from_space_id, destination_space_id }); history.event(world, run_id, "entity.moved", { entity_id, region_id: entity.region_id, from_space_id, destination_space_id, rule_id, authority: rule.authority, provenance: rule.provenance }, rule.authority); createTrace(world, { run_id, entity, description: "a movement record" }); return { ok: true, entity: clone(entity) };
}
function advanceEntity(world, { run_id, entity_id, trigger = "advance" }) {
  const entity = world.entities?.[entity_id]; const entry = entity && definition(entity.definition_id); if (!entity || !entry) return { ok: false, code: "ENTITY_UNKNOWN" };
  const candidates = entry.behavior_rule_ids.map(behaviorRule).filter((rule) => rule && rule.source_state === entity.behavior_state && rule.trigger === trigger && (!rule.required_perception_state || rule.required_perception_state === entity.perception.status)).sort((a, b) => a.priority - b.priority || a.rule_id.localeCompare(b.rule_id));
  const rule = candidates[0]; if (!rule) return { ok: false, code: "ENTITY_TRANSITION_PROHIBITED" };
  if (rule.action === "move-first-valid-edge") { const next = neighbors(world, entity.region_id, entity.space_id)[0]; if (!next) return { ok: false, code: "ENTITY_MOVEMENT_NO_ROUTE" }; changeEntityState(world, { run_id, entity, rule, destination_state: rule.destination_state }); return moveEntity(world, { run_id, entity_id, destination_space_id: next.space_id, rule_id: rule.rule_id }); }
  changeEntityState(world, { run_id, entity, rule, destination_state: rule.destination_state }); return { ok: true, entity: clone(entity) };
}

function rebuildEntityState(world) {
  state(world); const rebuilt = {};
  for (const event of [...world.events].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))) {
    const payload = event.payload;
    if (event.type === "entity.present") { const entry = definition(payload.definition_id); if (!entry) throw Object.assign(new Error("entity definition unavailable during rebuild"), { code: "ENTITY_DEFINITION_UNAVAILABLE" }); rebuilt[payload.entity_id] = { id: payload.entity_id, type: payload.type, region_id: payload.region_id, space_id: payload.space_id, definition_id: payload.definition_id, behavior_state: "stationary", perception_channels: clone(entry.permitted_perception_channels) }; }
    else if (event.type === "entity.state_changed" && rebuilt[payload.entity_id]) rebuilt[payload.entity_id].behavior_state = payload.destination_state;
    else if (event.type === "entity.moved" && rebuilt[payload.entity_id]) rebuilt[payload.entity_id].space_id = payload.destination_space_id;
  }
  return rebuilt;
}

function localProjection(world, { region_id, space_id, encounter_id = null }) { const local = localItems(world, region_id, space_id); const encounter = encounter_id && world.encounters?.[encounter_id]; const visible_entities = local.entities.map(safeEntity); const local_hazards = local.hazards.map(safeHazard); return { version: PROJECTION_VERSION, visible_entities, perceived_traces: local.traces.map(safeTrace), local_hazards, encounter_state: encounter ? { status: encounter.status, observer_detected: encounter.observer_detected, available_responses: encounter.status === "active" ? encounter.options : [] } : null, available_responses: [...(visible_entities.length ? ["RETREAT", "WAIT", "OBSERVE"] : []), ...(local_hazards.length ? ["AVOID", "CONTINUE", "RETREAT", "WAIT"] : [])] }; }
function institutionalProjection(world) { state(world); return Object.values(world.knowledge.institutional.records).filter((record) => record.id.startsWith("institutional-entity-") || record.id.startsWith("institutional-hazard-")).map((record) => clone(record.payload)); }
function reportEntity(world, { run_id, entity_id, summary }) { const entity = world.entities?.[entity_id]; if (!entity) return { ok: false, code: "ENTITY_UNKNOWN" }; const id = `institutional-entity-${entity_id}`; if (!world.knowledge.institutional.records[id]) { world.knowledge.institutional.records[id] = { id, source_run: run_id, status: "archived-operational", payload: { type: entity.type, summary } }; history.event(world, run_id, "entity.reported", { entity_id, summary }, "scenario-optional"); } return { ok: true }; }

module.exports = { VERSION, PROJECTION_VERSION, definitions, state, definition, behaviorRule, addEntity, addHazard, resolveObserverPerception, entityPerception, beginEncounter, resolveEncounter, advanceEntity, moveEntity, createTrace, rebuildEntityState, localProjection, institutionalProjection, reportEntity };
