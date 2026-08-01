"use strict";

const fs = require("node:fs");
const path = require("node:path");

const VERSION = "yellow-beast-operational-dynamics-worldpack@v1";
const root = path.resolve(__dirname, "..");
const HAZARD_CATEGORIES = new Set(["structural", "electrical", "environmental", "spatial", "communications", "equipment", "visibility", "navigation"]);
const HAZARD_STATES = new Set(["dormant", "active", "mitigated", "resolved"]);
const HAZARD_VISIBILITY = new Set(["hidden", "warning-signs", "known"]);
const HAZARD_SEVERITY = new Set(["low", "moderate", "serious", "critical"]);
const AFFECTED_TARGETS = new Set(["occupants", "one-coworker", "player", "equipment", "route"]);
const RECOVERABILITY = new Set(["recoverable", "partially-recoverable", "irrecoverable"]);
const PERSISTENCE = new Set(["transient", "persistent"]);
const PERSONNEL_CONDITIONS = new Set(["uninjured", "minor injury", "serious injury", "incapacitated", "missing", "dead", "stabilized minor injury"]);
const EQUIPMENT_STATES = new Set(["operational", "serviceable", "damaged", "disabled", "depleted", "dropped", "lost", "recoverable", "destroyed"]);
const MESSAGE_STATES = new Set(["composed", "queued", "transmitting", "delayed", "delivered", "acknowledged", "failed", "expired"]);
const CONDITION_SOURCES = Object.freeze({
  time: new Set(["interval_reached"]),
  spatial: new Set(["actor_at_location", "connection_traversed"]),
  hazard: new Set(["state_is", "unmitigated"]),
  personnel: new Set(["personnel_present"]),
  equipment: new Set(["equipment_present"]),
  communication: new Set(["message_state"])
});
const EFFECTS = new Set(["personnel-condition", "equipment-dropped", "equipment-state", "route-blocked", "operational-delay", "evidence-state"]);

function assertId(value, label) { if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`${label} has an invalid ID`); }
function unique(items, label) { if (new Set(items).size !== items.length) throw new Error(`${label} contains duplicate IDs`); }
function conditionLeaves(condition, result = []) {
  if (Array.isArray(condition?.all)) condition.all.forEach((entry) => conditionLeaves(entry, result));
  else if (Array.isArray(condition?.any)) condition.any.forEach((entry) => conditionLeaves(entry, result));
  else if (condition?.not) conditionLeaves(condition.not, result);
  else result.push(condition);
  return result;
}
function validateCondition(condition, catalogs, label) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error(`${label} must be structured data`);
  if (condition.all || condition.any) {
    const values = condition.all ?? condition.any;
    if (Object.keys(condition).length !== 1 || !Array.isArray(values) || !values.length) throw new Error(`${label} has invalid boolean composition`);
    values.forEach((entry, index) => validateCondition(entry, catalogs, `${label}[${index}]`)); return true;
  }
  if (condition.not) { if (Object.keys(condition).length !== 1) throw new Error(`${label}.not has unsupported fields`); return validateCondition(condition.not, catalogs, `${label}.not`); }
  if (!CONDITION_SOURCES[condition.source]?.has(condition.predicate)) throw new Error(`${label} uses an invalid condition operator`);
  const allowed = new Set(["source", "predicate", "amount", "location_id", "connection_id", "state", "hazard_id", "equipment_id", "message_state"]);
  if (Object.keys(condition).some((key) => !allowed.has(key))) throw new Error(`${label} contains an unsupported executable or data field`);
  if (condition.location_id && !catalogs.locations.has(condition.location_id)) throw new Error(`${label} location does not resolve: ${condition.location_id}`);
  if (condition.connection_id && !catalogs.connections.has(condition.connection_id)) throw new Error(`${label} connection does not resolve: ${condition.connection_id}`);
  if (condition.hazard_id && !catalogs.hazards.has(condition.hazard_id)) throw new Error(`${label} hazard does not resolve: ${condition.hazard_id}`);
  if (condition.equipment_id && !catalogs.equipment.has(condition.equipment_id)) throw new Error(`${label} equipment does not resolve: ${condition.equipment_id}`);
  if (condition.predicate === "interval_reached" && (!Number.isInteger(condition.amount) || condition.amount < 0)) throw new Error(`${label} interval is invalid`);
  if (condition.predicate === "actor_at_location" && !condition.location_id) throw new Error(`${label} requires a location`);
  if (condition.predicate === "connection_traversed" && !condition.connection_id) throw new Error(`${label} requires a connection`);
  if (["state_is", "unmitigated"].includes(condition.predicate) && !condition.hazard_id) throw new Error(`${label} requires a hazard`);
  if (condition.predicate === "state_is" && !HAZARD_STATES.has(condition.state)) throw new Error(`${label} has an invalid hazard state`);
  if (condition.predicate === "equipment_present" && !condition.equipment_id) throw new Error(`${label} requires equipment`);
  if (condition.predicate === "message_state" && !MESSAGE_STATES.has(condition.message_state)) throw new Error(`${label} has an invalid message state`);
  return true;
}

function validateDefinition(definition, { spatial, equipment = [] } = {}) {
  if (!definition || definition.version !== VERSION || !definition.worldpack_id) throw new Error("unsupported operational dynamics worldpack");
  const locations = new Set((spatial?.locations ?? []).map((item) => item.id));
  const connections = new Set((spatial?.connections ?? []).map((item) => item.id));
  const equipmentIds = new Set(equipment);
  const hazardIds = (definition.hazards ?? []).map((item) => item.id); unique(hazardIds, "hazards");
  const consequenceIds = (definition.consequence_sets ?? []).map((item) => item.id); unique(consequenceIds, "consequence sets");
  const catalogs = { locations, connections, equipment: equipmentIds, hazards: new Set(hazardIds) };
  const staffing = definition.staffing ?? {};
  if (!Number.isInteger(staffing.minimum_total) || !Number.isInteger(staffing.maximum_total) || staffing.minimum_total < 3 || staffing.maximum_total > 5 || staffing.minimum_total > staffing.maximum_total) throw new Error("invalid operational staffing bounds");
  if (staffing.total !== undefined && (!Number.isInteger(staffing.total) || staffing.total < staffing.minimum_total || staffing.total > staffing.maximum_total)) throw new Error("invalid declared operational staffing size");
  if (!Array.isArray(staffing.coworker_roles) || staffing.coworker_roles.length < staffing.maximum_total - 1 || new Set(staffing.coworker_roles).size !== staffing.coworker_roles.length) throw new Error("operational staffing roles are incomplete");
  for (const [action, cost] of Object.entries(definition.action_costs ?? {})) if (!/^[A-Z][A-Z_]*$/.test(action) || !Number.isInteger(cost) || cost < 0) throw new Error("invalid authored action cost");
  if (!Number.isInteger(definition.communications?.standard_delivery_delay) || definition.communications.standard_delivery_delay < 0 || !Number.isInteger(definition.communications?.standard_acknowledgment_delay) || definition.communications.standard_acknowledgment_delay < 0) throw new Error("invalid Standard communication delay");
  const checkIds = (definition.communications?.check_ins ?? []).map((item) => item.id); unique(checkIds, "check-ins");
  for (const check of definition.communications?.check_ins ?? []) { assertId(check.id, "check-in"); if (!Number.isInteger(check.due_after) || check.due_after < 1 || !Number.isInteger(check.miss_after) || check.miss_after < 1 || !Number.isInteger(check.approaching_within) || check.approaching_within < 0 || typeof check.public_label !== "string" || !check.public_label.trim()) throw new Error("invalid check-in schedule"); }
  const interferenceIds = (definition.communications?.interference_zones ?? []).map((item) => item.id); unique(interferenceIds, "interference zones");
  for (const zone of definition.communications?.interference_zones ?? []) { assertId(zone.id, "interference zone"); for (const id of zone.locations ?? []) if (!locations.has(id)) throw new Error(`interference location does not resolve: ${id}`); for (const id of zone.connections ?? []) if (!connections.has(id)) throw new Error(`interference connection does not resolve: ${id}`); if (!Number.isInteger(zone.additional_delay) || zone.additional_delay < 1) throw new Error("invalid interference delay"); }
  for (const hazard of definition.hazards ?? []) {
    assertId(hazard.id, "hazard"); if (!HAZARD_CATEGORIES.has(hazard.category)) throw new Error(`invalid hazard category: ${hazard.id}`);
    if (!hazard.scope || Object.keys(hazard.scope).length < 1 || Object.keys(hazard.scope).some((key) => !["location_id", "connection_id"].includes(key))) throw new Error(`invalid hazard scope: ${hazard.id}`);
    if (hazard.scope?.location_id && !locations.has(hazard.scope.location_id)) throw new Error(`hazard location does not resolve: ${hazard.scope.location_id}`);
    if (hazard.scope?.connection_id && !connections.has(hazard.scope.connection_id)) throw new Error(`hazard connection does not resolve: ${hazard.scope.connection_id}`);
    if (!HAZARD_STATES.has(hazard.initial_state) || !HAZARD_VISIBILITY.has(hazard.visibility) || !HAZARD_SEVERITY.has(hazard.severity) || !AFFECTED_TARGETS.has(hazard.affected_targets) || !RECOVERABILITY.has(hazard.recoverability) || !PERSISTENCE.has(hazard.persistence)) throw new Error(`invalid hazard behavior: ${hazard.id}`);
    if (!Array.isArray(hazard.avoidance_options) || !Array.isArray(hazard.mitigation_options) || !hazard.public || ["warning", "observed", "mitigated"].some((key) => typeof hazard.public[key] !== "string" || !hazard.public[key].trim())) throw new Error(`invalid hazard public contract: ${hazard.id}`);
    if (hazard.mitigation_requirements?.equipment_id && !equipmentIds.has(hazard.mitigation_requirements.equipment_id)) throw new Error(`hazard mitigation equipment does not resolve: ${hazard.mitigation_requirements.equipment_id}`);
    validateCondition(hazard.detection, catalogs, `hazard ${hazard.id}.detection`); validateCondition(hazard.activation, catalogs, `hazard ${hazard.id}.activation`); validateCondition(hazard.exposure, catalogs, `hazard ${hazard.id}.exposure`);
    if (!consequenceIds.includes(hazard.consequence_set)) throw new Error(`hazard consequence does not resolve: ${hazard.consequence_set}`);
  }
  for (const set of definition.consequence_sets ?? []) { assertId(set.id, "consequence set"); if (!Array.isArray(set.effects) || !set.effects.length || typeof set.public_summary !== "string" || !set.public_summary.trim()) throw new Error(`consequence set has no effects: ${set.id}`); for (const effect of set.effects) { if (!EFFECTS.has(effect.kind)) throw new Error(`invalid consequence effect: ${effect.kind}`); if (effect.location_id && !locations.has(effect.location_id)) throw new Error(`consequence location does not resolve: ${effect.location_id}`); if (effect.connection_id && !connections.has(effect.connection_id)) throw new Error(`consequence connection does not resolve: ${effect.connection_id}`); if (effect.kind === "personnel-condition" && (effect.target !== "exposed-coworker" || !PERSONNEL_CONDITIONS.has(effect.condition))) throw new Error("invalid personnel consequence"); if (["equipment-dropped", "equipment-state"].includes(effect.kind) && effect.target !== "held-operational-equipment" && !equipmentIds.has(effect.target)) throw new Error(`consequence equipment does not resolve: ${effect.target}`); if (effect.kind === "equipment-state" && !EQUIPMENT_STATES.has(effect.state)) throw new Error("invalid equipment consequence state"); if (effect.kind === "route-blocked" && (!effect.connection_id || !connections.has(effect.connection_id) || !["temporarily-blocked", "permanently-blocked"].includes(effect.state))) throw new Error("invalid route-block consequence"); if (effect.kind === "operational-delay" && (!Number.isInteger(effect.amount) || effect.amount < 1)) throw new Error("invalid operational consequence delay"); if (effect.kind === "evidence-state" && (typeof effect.target !== "string" || !["damaged", "lost", "destroyed"].includes(effect.state))) throw new Error("invalid evidence consequence"); } }
  return true;
}

function load(worldpackId, catalogs = {}) {
  if (typeof worldpackId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(worldpackId)) throw new Error("invalid dynamics worldpack ID");
  const definition = JSON.parse(fs.readFileSync(path.join(root, "data", "worldpacks", worldpackId, "dynamics.json"), "utf8"));
  validateDefinition(definition, catalogs); return definition;
}

function actionCost(definition, action, authored = null) { return Number.isInteger(authored) ? authored : Number(definition?.action_costs?.[String(action).toUpperCase()] ?? definition?.action_costs?.DEFAULT ?? 1); }
function interference(definition, location, connection = null) { return (definition?.communications?.interference_zones ?? []).find((zone) => zone.locations?.includes(location) || (connection && zone.connections?.includes(connection))) ?? null; }

module.exports = { VERSION, EFFECTS, conditionLeaves, validateCondition, validateDefinition, load, actionCost, interference };
