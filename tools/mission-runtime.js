"use strict";

// Generic, deterministic mission evaluation. Worldpacks supply all mission
// intent, conditions, references, and player-facing language. This module has
// no scenario, location, object, equipment, or personnel names.
const crypto = require("node:crypto");

const DEFINITION_VERSION = "yellow-beast-mission-worldpack@v1";
const STATE_VERSION = "yellow-beast-mission-state@v1";
const RESULT_VERSION = "yellow-beast-mission-result@v1";
const OBJECTIVE_STATES = Object.freeze(["inactive", "blocked", "active", "satisfied", "failed", "waived", "abandoned"]);
const MISSION_STATES = Object.freeze(["briefing", "authorized", "in_progress", "return_available", "returning", "completed", "failed", "aborted"]);
const OBJECTIVE_KINDS = Object.freeze(["required", "optional", "conditional"]);
const BEHAVIORS = Object.freeze(["sticky", "live", "recoverable", "irrecoverable"]);
const CLOSED_MISSION_STATES = new Set(["completed", "failed", "aborted"]);
const TERMINAL_OBJECTIVE_STATES = new Set(["satisfied", "failed", "waived", "abandoned"]);
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const SOURCE_PREDICATES = Object.freeze({
  object: new Set(["exists", "property_known", "state", "mutation", "interaction_completed"]),
  evidence: new Set(["exists", "retained", "reported", "count", "distinct_count", "created_after"]),
  spatial: new Set(["location_discovered", "location_visited", "current_location", "route_traversed", "connection_verified", "returned", "unresolved_exit_remains", "route_available"]),
  equipment: new Set(["assigned", "carried", "accessible", "operational", "damaged", "depleted", "lost", "stored", "transferred", "consumable_remaining"]),
  personnel: new Set(["alive", "active", "injured", "missing", "separated", "within_speaking_range", "returned", "accounted", "assigned_equipment_retained", "assigned_equipment_lost"]),
  communication: new Set(["radio_check_completed", "message_delivered", "report_sent", "evidence_reported", "check_in_completed", "check_in_missed", "check_in_ever_missed", "acknowledgment_received", "unavailable", "closure_delivered"]),
  time: new Set(["interval_reached", "deadline_pending", "deadline_due", "deadline_exceeded", "action_before", "action_after"]),
  mission: new Set(["objective_state", "minimum_objective_count", "required_group_complete", "return_authorized", "abort_condition", "phase_in", "lifecycle", "return_requested", "abort_requested", "closure_requested"])
});

const BASE_TRANSITIONS = Object.freeze({
  inactive: new Set(["active", "blocked", "satisfied", "failed", "waived", "abandoned"]),
  blocked: new Set(["inactive", "active", "satisfied", "failed", "waived", "abandoned"]),
  active: new Set(["inactive", "blocked", "satisfied", "failed", "waived", "abandoned"]),
  satisfied: new Set([]),
  failed: new Set([]),
  waived: new Set([]),
  abandoned: new Set([])
});

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value ?? {})) if (!allowed.has(key)) throw new Error(`${label} contains unsupported field: ${key}`);
}

function conditionReferences(condition, result = []) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return result;
  if (Array.isArray(condition.all)) for (const item of condition.all) conditionReferences(item, result);
  else if (Array.isArray(condition.any)) for (const item of condition.any) conditionReferences(item, result);
  else if (condition.not) conditionReferences(condition.not, result);
  else if (condition.source) result.push(condition);
  return result;
}

function validateCondition(condition, references, label = "condition") {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error(`${label} must be structured data`);
  if (Object.hasOwn(condition, "all")) {
    exactKeys(condition, new Set(["all"]), label);
    if (!Array.isArray(condition.all) || condition.all.length === 0) throw new Error(`${label}.all must contain conditions`);
    condition.all.forEach((item, index) => validateCondition(item, references, `${label}.all[${index}]`));
    return true;
  }
  if (Object.hasOwn(condition, "any")) {
    exactKeys(condition, new Set(["any"]), label);
    if (!Array.isArray(condition.any) || condition.any.length === 0) throw new Error(`${label}.any must contain conditions`);
    condition.any.forEach((item, index) => validateCondition(item, references, `${label}.any[${index}]`));
    return true;
  }
  if (Object.hasOwn(condition, "not")) {
    exactKeys(condition, new Set(["not"]), label);
    validateCondition(condition.not, references, `${label}.not`);
    return true;
  }
  if (Object.hasOwn(condition, "constant")) {
    exactKeys(condition, new Set(["constant"]), label);
    if (typeof condition.constant !== "boolean") throw new Error(`${label}.constant must be boolean`);
    return true;
  }
  const allowed = new Set(["source", "predicate", "object_id", "property", "path", "equals", "in", "exists", "action", "type", "source_object", "condition_fingerprint", "minimum", "distinct_by", "after", "location_id", "connection_id", "equipment_id", "capability", "state", "amount", "personnel_id", "role", "target", "purpose", "deadline", "objective_id", "objective_ids", "states", "count", "values", "visibility"]);
  exactKeys(condition, allowed, label);
  if (!SOURCE_PREDICATES[condition.source]?.has(condition.predicate)) throw new Error(`${label} uses an invalid condition operator`);
  if (condition.visibility !== undefined && !["public", "known", "hidden"].includes(condition.visibility)) throw new Error(`${label} has invalid visibility metadata`);
  const objectIds = references.objects ?? new Set();
  const locationIds = references.locations ?? new Set();
  const connectionIds = references.connections ?? new Set();
  const equipmentIds = references.equipment ?? new Set();
  const roles = references.personnel_roles ?? new Set();
  const personnelIds = references.personnel ?? new Set();
  const objectiveIds = references.objectives ?? new Set();
  if (condition.object_id && !objectIds.has(condition.object_id)) throw new Error(`${label} object reference does not resolve: ${condition.object_id}`);
  if (condition.source_object && !objectIds.has(condition.source_object)) throw new Error(`${label} evidence source does not resolve: ${condition.source_object}`);
  if (condition.location_id && !locationIds.has(condition.location_id)) throw new Error(`${label} location reference does not resolve: ${condition.location_id}`);
  if (condition.connection_id && !connectionIds.has(condition.connection_id)) throw new Error(`${label} connection reference does not resolve: ${condition.connection_id}`);
  if (condition.equipment_id && !equipmentIds.has(condition.equipment_id)) throw new Error(`${label} equipment reference does not resolve: ${condition.equipment_id}`);
  if (condition.personnel_id && personnelIds.size && !personnelIds.has(condition.personnel_id)) throw new Error(`${label} personnel reference does not resolve: ${condition.personnel_id}`);
  if (condition.role && !["player", "team", "all_assigned"].includes(condition.role) && !roles.has(condition.role)) throw new Error(`${label} personnel role does not resolve: ${condition.role}`);
  if (condition.objective_id && !objectiveIds.has(condition.objective_id)) throw new Error(`${label} objective reference does not resolve: ${condition.objective_id}`);
  for (const id of condition.objective_ids ?? []) if (!objectiveIds.has(id)) throw new Error(`${label} objective reference does not resolve: ${id}`);
  const requiredFields = {
    object: { exists: ["object_id"], property_known: ["object_id", "property"], state: ["object_id", "path"], mutation: ["object_id"], interaction_completed: ["object_id"] },
    evidence: {},
    spatial: { location_discovered: ["location_id"], location_visited: ["location_id"], current_location: ["location_id"], route_traversed: ["connection_id"], connection_verified: ["connection_id"], returned: ["location_id"], route_available: ["connection_id"] },
    equipment: {}, personnel: {}, communication: {},
    time: { interval_reached: ["amount"], deadline_pending: ["deadline"], deadline_due: ["deadline"], deadline_exceeded: ["deadline"], action_before: ["deadline"], action_after: ["deadline"] },
    mission: { objective_state: ["objective_id"], minimum_objective_count: ["objective_ids"], required_group_complete: ["objective_ids"], phase_in: ["values"], lifecycle: ["states"] }
  };
  for (const field of requiredFields[condition.source]?.[condition.predicate] ?? []) if (!Object.hasOwn(condition, field)) throw new Error(`${label} requires ${field}`);
  return true;
}

function validateDefinitions(definitions, catalogsByWorldpack = {}) {
  const missionIds = new Set();
  for (const definition of definitions ?? []) {
    if (missionIds.has(definition?.mission?.id)) throw new Error(`duplicate mission id: ${definition?.mission?.id}`);
    missionIds.add(definition?.mission?.id);
    validateDefinition(definition, catalogsByWorldpack[definition.worldpack_id] ?? {});
  }
  return true;
}

function validateDefinition(definition, catalogs = {}) {
  if (!definition || definition.version !== DEFINITION_VERSION || !definition.worldpack_id || !definition.mission) throw new Error("unsupported mission worldpack");
  exactKeys(definition, new Set(["version", "worldpack_id", "mission", "known_limitations"]), "mission worldpack");
  const mission = definition.mission;
  exactKeys(mission, new Set(["id", "version", "display_name", "briefing", "operational_intent", "objectives", "return_policy", "completion_policy", "abort_policy", "outcome_rules", "public_progress", "migration"]), "mission");
  if (!mission.id || !Number.isInteger(mission.version) || mission.version < 1 || !mission.display_name || !mission.briefing || !mission.operational_intent) throw new Error("mission identity and intent are incomplete");
  if (!Array.isArray(mission.objectives) || mission.objectives.length === 0) throw new Error("mission requires objectives");
  const objectiveIds = new Set();
  for (const objective of mission.objectives) {
    if (!objective?.id || objectiveIds.has(objective.id)) throw new Error("duplicate objective id");
    objectiveIds.add(objective.id);
  }
  const references = {
    objects: new Set(catalogs.objects ?? []), locations: new Set(catalogs.locations ?? []), connections: new Set(catalogs.connections ?? []),
    equipment: new Set(catalogs.equipment ?? []), personnel_roles: new Set(catalogs.personnel_roles ?? []), personnel: new Set(catalogs.personnel ?? []), objectives: objectiveIds
  };
  for (const objective of mission.objectives) {
    exactKeys(objective, new Set(["id", "name", "kind", "behavior", "reversible", "initial_state", "dependencies", "activation", "satisfaction", "failure", "blocking", "waiver", "legal_transitions", "public"]), `objective ${objective.id}`);
    if (!objective.name || !OBJECTIVE_KINDS.includes(objective.kind) || !BEHAVIORS.includes(objective.behavior) || !OBJECTIVE_STATES.includes(objective.initial_state)) throw new Error(`objective ${objective.id} has invalid type or initial state`);
    if (TERMINAL_OBJECTIVE_STATES.has(objective.initial_state)) throw new Error(`objective ${objective.id} has impossible initial state`);
    if (objective.kind === "required" && objective.activation?.constant === false) throw new Error(`required objective ${objective.id} can never activate`);
    if (!objective.satisfaction) throw new Error(`objective ${objective.id} lacks a satisfaction condition`);
    for (const dependency of objective.dependencies ?? []) if (!objectiveIds.has(dependency)) throw new Error(`objective dependency does not resolve: ${objective.id}/${dependency}`);
    for (const key of ["activation", "satisfaction", "failure", "blocking", "waiver"]) if (objective[key]) validateCondition(objective[key], references, `objective ${objective.id}.${key}`);
    if (!objective.public?.active || !objective.public?.satisfied) throw new Error(`objective ${objective.id} lacks public progress language`);
    if (objective.legal_transitions) {
      for (const [from, targets] of Object.entries(objective.legal_transitions)) {
        if (!OBJECTIVE_STATES.includes(from) || !Array.isArray(targets) || targets.some((target) => !OBJECTIVE_STATES.includes(target))) throw new Error(`objective ${objective.id} has invalid transitions`);
        const permitted = objectiveTransitions({ ...objective, legal_transitions: null })[from];
        if (targets.some((target) => !permitted.has(target))) throw new Error(`objective ${objective.id} declares an incoherent transition`);
      }
    }
  }
  const visiting = new Set(); const visited = new Set();
  const byId = Object.fromEntries(mission.objectives.map((objective) => [objective.id, objective]));
  function visit(id) { if (visiting.has(id)) throw new Error("circular objective dependency"); if (visited.has(id)) return; visiting.add(id); for (const dependency of byId[id].dependencies ?? []) visit(dependency); visiting.delete(id); visited.add(id); }
  for (const id of objectiveIds) visit(id);
  if (!mission.return_policy?.route_available_when || !mission.return_policy?.ready_when || !mission.return_policy?.closure_available_when || !mission.return_policy?.completion_when) throw new Error("mission return policy is ambiguous");
  exactKeys(mission.return_policy, new Set(["return_location", "route_available_when", "ready_when", "closure_available_when", "completion_when", "public"]), "mission return policy");
  if (!references.locations.has(mission.return_policy.return_location)) throw new Error(`mission return location does not resolve: ${mission.return_policy.return_location}`);
  if (!mission.completion_policy || mission.completion_policy.required !== "all_terminal" || typeof mission.completion_policy.optional_blocks !== "boolean") throw new Error("ambiguous mission completion policy");
  exactKeys(mission.completion_policy, new Set(["required", "waived_counts", "optional_blocks"]), "mission completion policy");
  if (!mission.abort_policy?.available_when || !["abandoned", "failed"].includes(mission.abort_policy.unresolved_state)) throw new Error("mission abort policy is ambiguous");
  exactKeys(mission.abort_policy, new Set(["available_when", "unresolved_state", "keep_objectives", "public_reason", "public_unavailable"]), "mission abort policy");
  for (const id of mission.abort_policy.keep_objectives ?? []) if (!objectiveIds.has(id)) throw new Error(`abort policy objective does not resolve: ${id}`);
  for (const [key, value] of Object.entries({ ...mission.return_policy, abort_available: mission.abort_policy.available_when })) if (key.endsWith("when") || key === "abort_available") validateCondition(value, references, `mission.${key}`);
  if (!Array.isArray(mission.outcome_rules) || mission.outcome_rules.length === 0) throw new Error("mission requires outcome rules");
  const outcomeIds = new Set();
  for (const rule of mission.outcome_rules) {
    if (!rule?.id || outcomeIds.has(rule.id)) throw new Error("duplicate mission outcome rule id"); outcomeIds.add(rule.id);
    exactKeys(rule, new Set(["id", "priority", "when", "final_state", "classification", "public_summary", "institutional_hooks"]), `outcome ${rule.id}`);
    if (!MISSION_STATES.includes(rule.final_state) || !CLOSED_MISSION_STATES.has(rule.final_state) || !rule.classification || !rule.public_summary || !Array.isArray(rule.institutional_hooks)) throw new Error(`invalid mission outcome rule: ${rule.id}`);
    validateCondition(rule.when, references, `outcome ${rule.id}`);
  }
  return true;
}

function objectiveTransitions(objective) {
  if (objective.legal_transitions) return Object.fromEntries(OBJECTIVE_STATES.map((state) => [state, new Set(objective.legal_transitions[state] ?? [])]));
  const transitions = Object.fromEntries(Object.entries(BASE_TRANSITIONS).map(([state, targets]) => [state, new Set(targets)]));
  if (objective.behavior === "live" || objective.reversible === true) for (const target of ["inactive", "blocked", "active", "failed", "waived", "abandoned"]) transitions.satisfied.add(target);
  if (objective.behavior === "recoverable") for (const target of ["inactive", "blocked", "active", "satisfied", "waived", "abandoned"]) transitions.failed.add(target);
  return transitions;
}

function normalizeLegacyState(state, initial) {
  if (state === "pending") return initial === "inactive" ? "inactive" : "active";
  if (state === "completed") return "satisfied";
  return OBJECTIVE_STATES.includes(state) ? state : initial;
}

function createState(definition, { instance_id = null, phase = "BRIEFING", legacy_objectives = null, at = 0 } = {}) {
  const mission = definition.mission;
  const legacyMap = mission.migration?.legacy_objective_map ?? {};
  const legacyByCurrent = {};
  for (const [legacy, current] of Object.entries(legacyMap)) if (legacy_objectives?.[legacy] && !legacyByCurrent[current]) legacyByCurrent[current] = legacy_objectives[legacy];
  const objectives = {};
  for (const authored of mission.objectives) {
    const legacy = legacy_objectives?.[authored.id] ?? legacyByCurrent[authored.id] ?? null;
    const initial = normalizeLegacyState(legacy?.state, authored.initial_state);
    objectives[authored.id] = {
      state: initial, kind: authored.kind, behavior: authored.behavior,
      history: (legacy?.history ?? []).map((entry, index) => ({ sequence: index + 1, from: null, to: normalizeLegacyState(entry.state, authored.initial_state), at: entry.at ?? at, reason: "Migrated prior objective history.", source: "explicit-save-migration" })),
      last_transition: null
    };
    if (legacy && !objectives[authored.id].history.some((entry) => entry.to === initial)) objectives[authored.id].history.push({ sequence: objectives[authored.id].history.length + 1, from: authored.initial_state, to: initial, at, reason: "Prior authoritative progress was retained during migration.", source: "explicit-save-migration" });
  }
  return {
    version: STATE_VERSION, definition_version: mission.version, definition_id: mission.id, instance_id: instance_id ?? mission.id,
    lifecycle: "briefing", phase, objectives, active_blockers: [], evaluation_revision: 0, transition_history: [], recent_updates: [],
    return: { requested: false, requested_at: null, abort_requested: false, abort_requested_at: null, closure_requested: false, closure_requested_at: null, route_available: false, ready: false, completed: false, summary: mission.return_policy.public?.unavailable ?? "Return conditions have not been established." },
    final_result: null, migrated_from: legacy_objectives ? "legacy-expedition-objectives" : null, last_evaluation_fingerprint: null
  };
}

function migrate(state, definition, options = {}) {
  if (!state || state.version !== STATE_VERSION || state.definition_id !== definition.mission.id) return createState(definition, options);
  state.phase ??= options.phase ?? "BRIEFING"; state.objectives ??= {}; state.active_blockers ??= []; state.transition_history ??= []; state.recent_updates ??= []; state.evaluation_revision ??= 0;
  state.return = { requested: false, requested_at: null, abort_requested: false, abort_requested_at: null, closure_requested: false, closure_requested_at: null, route_available: false, ready: false, completed: false, summary: definition.mission.return_policy.public?.unavailable ?? "Return conditions have not been established.", ...(state.return ?? {}) };
  for (const authored of definition.mission.objectives) state.objectives[authored.id] ??= { state: authored.initial_state, kind: authored.kind, behavior: authored.behavior, history: [], last_transition: null };
  for (const id of Object.keys(state.objectives)) if (!definition.mission.objectives.some((objective) => objective.id === id)) delete state.objectives[id];
  state.definition_version = definition.mission.version;
  return state;
}

function attachCompatibilityView(expedition) {
  if (!expedition || !expedition.mission_state) return expedition;
  const descriptor = Object.getOwnPropertyDescriptor(expedition, "objectives");
  if (!descriptor || descriptor.enumerable || descriptor.value) {
    if (descriptor?.configurable === false) return expedition;
    delete expedition.objectives;
    Object.defineProperty(expedition, "objectives", { enumerable: false, configurable: true, get() { return this.mission_state?.objectives ?? {}; } });
  }
  return expedition;
}

function readPath(value, path) { return String(path ?? "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value); }
function compare(value, condition) {
  if (Object.hasOwn(condition, "equals") && value !== condition.equals) return false;
  if (Array.isArray(condition.in) && !condition.in.includes(value)) return false;
  if (Object.hasOwn(condition, "exists") && (value !== undefined && value !== null) !== condition.exists) return false;
  if (Number.isFinite(condition.minimum) && !(Number(value) >= condition.minimum)) return false;
  return true;
}
function playerId(context) { return context.player ?? context.run?.session?.startup?.player?.observer_id ?? null; }
function objectRecord(context, id) { return context.run?.object_state?.objects?.[id] ?? null; }
function evidenceMatches(item, condition) { return item?.valid !== false && (!condition.source_object || item.source_object === condition.source_object) && (!condition.type || item.type === condition.type) && (!condition.condition_fingerprint || item.condition_fingerprint === condition.condition_fingerprint); }
function equipmentRecord(context, condition) { return context.run?.expedition?.equipment?.[condition.equipment_id] ?? Object.values(context.run?.expedition?.equipment ?? {}).find((item) => !condition.capability || item.capability === condition.capability) ?? null; }
function personnelRecords(context, condition) {
  const members = context.run?.expedition?.team?.members ?? [];
  const player = playerId(context);
  if (condition.personnel_id) return members.filter((member) => (member.personnel_id ?? member.id) === condition.personnel_id);
  if (condition.role === "player") return members.filter((member) => (member.personnel_id ?? member.id) === player);
  if (condition.role === "team" || condition.role === "all_assigned") return members;
  if (condition.role) return members.filter((member) => member.role === condition.role);
  return members;
}
function memberStatus(member) { return String(member?.status ?? "unknown").toLowerCase(); }
function memberCondition(member) { return String(member?.condition ?? member?.observed_condition ?? "unknown").toLowerCase(); }

function evaluateLeaf(condition, context, objectiveSnapshot) {
  const run = context.run ?? {}; const expedition = run.expedition ?? {}; const spatial = run.spatial ?? {}; const missionState = context.mission_state; const predicate = condition.predicate;
  if (condition.source === "object") {
    const object = objectRecord(context, condition.object_id);
    if (predicate === "exists") return Boolean(object) === (condition.exists ?? true);
    if (predicate === "property_known") { const observer = playerId(context); return Boolean(object?.knowledge?.[observer]?.known_properties?.includes(condition.property)); }
    if (predicate === "state") return Boolean(object && compare(readPath(object, condition.path), condition));
    if (predicate === "mutation") return (object?.interaction_history ?? []).some((sequence) => { const entry = run.object_state?.interaction_history?.find((item) => item.sequence === sequence); return (!condition.action || entry?.action === condition.action) && (!condition.path || compare(readPath(entry?.state_after, condition.path), condition)); });
    if (predicate === "interaction_completed") return (object?.interaction_history ?? []).some((sequence) => { const entry = run.object_state?.interaction_history?.find((item) => item.sequence === sequence); return !condition.action || entry?.action === condition.action; });
  }
  if (condition.source === "evidence") {
    const records = (expedition.evidence ?? []).filter((item) => evidenceMatches(item, condition));
    if (predicate === "exists") return records.length > 0;
    if (predicate === "retained") return records.some((item) => item.available_to_player !== false && item.custodian && !["lost", "destroyed", "abandoned"].includes(String(item.custody_state ?? "retained").toLowerCase()));
    if (predicate === "reported") return records.some((item) => item.available_to_standard === true || /^reported/.test(item.reporting_state ?? ""));
    if (predicate === "count") return compare(records.length, condition);
    if (predicate === "distinct_count") { const field = condition.distinct_by ?? "source_object"; return compare(new Set(records.map((item) => readPath(item, field)).filter((value) => value !== undefined)).size, condition); }
    if (predicate === "created_after") return records.some((item) => Number(item.captured_at?.interval ?? item.interval ?? -1) > Number(condition.after ?? -1));
  }
  if (condition.source === "spatial") {
    if (predicate === "location_discovered") return Boolean(spatial.discovered_locations?.[condition.location_id]);
    if (predicate === "location_visited") return spatial.visited_locations?.includes(condition.location_id) || spatial.player_location === condition.location_id;
    if (predicate === "current_location" || predicate === "returned") return spatial.player_location === condition.location_id;
    if (predicate === "route_traversed") return spatial.route_history?.some((entry) => (!condition.connection_id || entry.connection_id === condition.connection_id) && (!condition.location_id || entry.to === condition.location_id));
    if (predicate === "connection_verified") return spatial.discovered_connections?.[condition.connection_id]?.status === "confirmed";
    if (predicate === "unresolved_exit_remains") return Object.values(spatial.discovered_connections ?? {}).some((entry) => entry.status !== "confirmed");
    if (predicate === "route_available") return Boolean(spatial.discovered_connections?.[condition.connection_id]) && !spatial.blocked_paths?.[condition.connection_id];
  }
  if (condition.source === "equipment") {
    const item = equipmentRecord(context, condition); const state = String(item?.state ?? "missing").toLowerCase(); const player = playerId(context);
    if (predicate === "assigned") return Boolean(item?.assigned_to);
    if (predicate === "carried") return Boolean(item?.holder);
    if (predicate === "accessible") return Boolean(item && (item.holder === player || spatial.personnel_locations?.[item.holder] === spatial.player_location));
    if (predicate === "operational") return Boolean(item && ["operational", "serviceable", "usable"].includes(state) && Number(item.charges ?? 1) > 0);
    if (predicate === "damaged") return state === "damaged";
    if (predicate === "depleted") return state === "depleted" || Number(item?.charges ?? 1) <= 0;
    if (predicate === "lost") return ["missing", "lost", "abandoned"].includes(state);
    if (predicate === "stored") return Boolean(item?.container) && /store|locker|case/i.test(`${item.container} ${item.location}`);
    if (predicate === "transferred") return (item?.history ?? []).some((entry) => /transfer|assigned-to-team-member|handoff|handed-over/.test(entry.event ?? ""));
    if (predicate === "consumable_remaining") return compare(Number(item?.charges ?? 0), condition);
  }
  if (condition.source === "personnel") {
    const members = personnelRecords(context, condition); const player = playerId(context); const returnLocation = condition.location_id;
    const tests = members.map((member) => { const id = member.personnel_id ?? member.id; const status = memberStatus(member); const personCondition = memberCondition(member); const location = spatial.personnel_locations?.[id];
      if (predicate === "alive") return status !== "dead";
      if (predicate === "active") return status === "active";
      if (predicate === "injured") return /injur|wound|incapac/.test(personCondition);
      if (predicate === "missing") return status === "missing";
      if (predicate === "separated") return location !== spatial.personnel_locations?.[player];
      if (predicate === "within_speaking_range") return Boolean(location && location === spatial.personnel_locations?.[player]);
      if (predicate === "returned") return location === returnLocation;
      if (predicate === "accounted") return Boolean(location) && !["missing", "unknown"].includes(status);
      if (predicate === "assigned_equipment_retained") return Object.values(expedition.equipment ?? {}).filter((item) => item.assigned_to === id).every((item) => Boolean(item.holder) && !["missing", "lost", "abandoned", "destroyed", "dropped"].includes(String(item.state).toLowerCase()));
      if (predicate === "assigned_equipment_lost") return Object.values(expedition.equipment ?? {}).filter((item) => item.assigned_to === id).some((item) => ["missing", "lost", "abandoned", "destroyed"].includes(String(item.state).toLowerCase()));
      return false;
    });
    return condition.role === "all_assigned" ? tests.length > 0 && tests.every(Boolean) : tests.some(Boolean);
  }
  if (condition.source === "communication") {
    const radio = expedition.radio ?? {}; const clock = expedition.clock ?? {}; const messages = expedition.messages ?? []; const interactions = expedition.interaction_history ?? []; const checkIns = expedition.communications?.check_ins ?? [];
    if (predicate === "radio_check_completed" || predicate === "acknowledgment_received") return radio.check_completed === true;
    if (predicate === "message_delivered") return messages.some((item) => item.delivery_status === "delivered" && (!condition.target || String(item.intended_recipient).toLowerCase() === String(condition.target).toLowerCase()) && (!condition.purpose || item.purpose === condition.purpose));
    if (predicate === "report_sent") return interactions.some((item) => item.channel === "standard" && item.delivery === "delivered" && (!condition.purpose || item.purpose === condition.purpose));
    if (predicate === "evidence_reported") return (expedition.evidence ?? []).some((item) => item.available_to_standard === true || /^reported/.test(item.reporting_state ?? ""));
    if (predicate === "check_in_completed") return checkIns.length ? checkIns.some((item) => item.state === "completed") : Number.isFinite(clock.check_in_completed_at);
    if (predicate === "check_in_missed") return checkIns.length ? checkIns.some((item) => item.state === "missed") : clock.check_in_missed === true || clock.check_in_overdue === true;
    if (predicate === "check_in_ever_missed") return checkIns.length ? checkIns.some((item) => item.history?.some((entry) => entry.to === "missed")) : clock.check_in_missed === true;
    if (predicate === "unavailable") {
      const item = condition.equipment_id ? equipmentRecord(context, condition) : null;
      const itemUnavailable = condition.equipment_id && (!item || !["operational", "serviceable", "usable"].includes(String(item.state ?? "missing").toLowerCase()) || Number(item.charges ?? 1) <= 0);
      if (messages.some((message) => (message.check_in_id || message.purpose === "scheduled-check-in") && ["queued", "transmitting", "delayed"].includes(message.state))) return false;
      return ["unavailable", "lost", "intentionally-silent"].includes(radio.state) || radio.authorized === false || itemUnavailable;
    }
    if (predicate === "closure_delivered") return messages.some((item) => item.delivery_status === "delivered" && item.purpose === "mission-closure");
  }
  if (condition.source === "time") {
    const clock = expedition.clock ?? {}; const interval = Number(clock.interval ?? 0); const deadline = condition.deadline === "check_in" ? clock.check_in_due_at : Number(condition.deadline);
    if (predicate === "interval_reached") return interval >= Number(condition.amount ?? 0);
    if (predicate === "deadline_pending") return Number.isFinite(deadline) && interval < deadline;
    if (predicate === "deadline_due") return Number.isFinite(deadline) && interval === deadline;
    if (predicate === "deadline_exceeded") return Number.isFinite(deadline) && interval > deadline;
    const matching = (expedition.history ?? []).filter((entry) => !condition.action || entry.kind === condition.action);
    if (predicate === "action_before") return matching.some((entry) => Number(entry.payload?.interval ?? entry.at ?? 0) < Number(deadline));
    if (predicate === "action_after") return matching.some((entry) => Number(entry.payload?.interval ?? entry.at ?? 0) > Number(deadline));
  }
  if (condition.source === "mission") {
    if (predicate === "objective_state") return (condition.states ?? [condition.state]).includes(objectiveSnapshot[condition.objective_id]);
    if (predicate === "minimum_objective_count") { const ids = condition.objective_ids ?? Object.keys(objectiveSnapshot); return ids.filter((id) => (condition.states ?? ["satisfied"]).includes(objectiveSnapshot[id])).length >= Number(condition.count ?? condition.minimum ?? 1); }
    if (predicate === "required_group_complete") { const ids = condition.objective_ids ?? []; return ids.every((id) => (condition.states ?? ["satisfied", "waived"]).includes(objectiveSnapshot[id])); }
    if (predicate === "return_authorized") return missionState.return.route_available === true;
    if (predicate === "abort_condition") return missionState.return.abort_requested === true;
    if (predicate === "phase_in") return (condition.values ?? []).includes(missionState.phase);
    if (predicate === "lifecycle") return (condition.states ?? [condition.state]).includes(missionState.lifecycle);
    if (predicate === "return_requested") return missionState.return.requested === true;
    if (predicate === "abort_requested") return missionState.return.abort_requested === true;
    if (predicate === "closure_requested") return missionState.return.closure_requested === true;
  }
  return false;
}

function evaluateCondition(condition, context, objectiveSnapshot = {}) {
  if (Array.isArray(condition?.all)) return condition.all.every((item) => evaluateCondition(item, context, objectiveSnapshot));
  if (Array.isArray(condition?.any)) return condition.any.some((item) => evaluateCondition(item, context, objectiveSnapshot));
  if (condition?.not) return !evaluateCondition(condition.not, context, objectiveSnapshot);
  if (Object.hasOwn(condition ?? {}, "constant")) return condition.constant;
  return evaluateLeaf(condition, context, objectiveSnapshot);
}

function proposedObjectiveStates(state, definition, context) {
  const proposed = Object.fromEntries(Object.entries(state.objectives).map(([id, objective]) => [id, objective.state]));
  let blockers = [];
  let converged = false;
  for (let pass = 0; pass <= definition.mission.objectives.length; pass += 1) {
    const before = JSON.stringify(proposed); blockers = [];
    for (const authored of definition.mission.objectives) {
      const current = state.objectives[authored.id].state;
      if (current === "abandoned" || current === "waived" || (current === "satisfied" && authored.behavior !== "live" && authored.reversible !== true) || (current === "failed" && authored.behavior === "irrecoverable")) continue;
      const active = authored.activation ? evaluateCondition(authored.activation, context, proposed) : true;
      if (!active) { proposed[authored.id] = "inactive"; continue; }
      const unmet = (authored.dependencies ?? []).filter((id) => !["satisfied", "waived"].includes(proposed[id]));
      if (unmet.length) { proposed[authored.id] = "blocked"; blockers.push({ objective_id: authored.id, kind: "dependency", references: unmet }); continue; }
      if (authored.waiver && evaluateCondition(authored.waiver, context, proposed)) { proposed[authored.id] = "waived"; continue; }
      if (authored.failure && evaluateCondition(authored.failure, context, proposed)) { proposed[authored.id] = "failed"; continue; }
      if (authored.blocking && evaluateCondition(authored.blocking, context, proposed)) { proposed[authored.id] = "blocked"; blockers.push({ objective_id: authored.id, kind: "world-condition", references: [] }); continue; }
      proposed[authored.id] = evaluateCondition(authored.satisfaction, context, proposed) ? "satisfied" : "active";
    }
    if (before === JSON.stringify(proposed)) { converged = true; break; }
  }
  if (!converged) throw new Error("mission objective evaluation did not converge");
  return { proposed, blockers };
}

function stateReason(authored, stateName, blocker = null) {
  if (stateName === "blocked" && blocker?.kind === "dependency") return authored.public?.dependency_blocked ?? authored.public?.blocked ?? authored.public?.active ?? "A required predecessor remains unresolved.";
  if (stateName === "blocked" && blocker?.kind === "world-condition") return authored.public?.condition_blocked ?? authored.public?.blocked ?? authored.public?.active ?? "A known operational condition prevents progress.";
  return authored.public?.[stateName] ?? authored.public?.active ?? "Mission conditions changed.";
}
function stateHeadline(authored, stateName) { return `${authored.name} ${stateName === "satisfied" ? "complete" : stateName}`; }

function publicSnapshotFromProposed(definition, proposed) {
  return Object.fromEntries(definition.mission.objectives.map((objective) => [objective.id, proposed[objective.id]]));
}

function classifyOutcome(definition, context, objectiveSnapshot) {
  const ordered = [...definition.mission.outcome_rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return ordered.find((rule) => evaluateCondition(rule.when, context, objectiveSnapshot)) ?? ordered.at(-1);
}

function buildResult(state, definition, context, objectiveSnapshot, rule) {
  const expedition = context.run?.expedition ?? {}; const player = playerId(context); const required = definition.mission.objectives.filter((item) => item.kind === "required"); const optional = definition.mission.objectives.filter((item) => item.kind !== "required");
  const listBy = (items, target) => items.filter((item) => objectiveSnapshot[item.id] === target).map((item) => item.name);
  const personnel = (expedition.team?.members ?? []).map((member) => { const id = member.personnel_id ?? member.id; return { name: member.display_name ?? member.first_name ?? "Assigned personnel", role: member.role ?? "assigned personnel", status: memberStatus(member), condition: memberCondition(member), returned: context.run?.spatial?.personnel_locations?.[id] === definition.mission.return_policy.return_location }; });
  const equipment = Object.values(expedition.equipment ?? {}).map((item) => ({ label: item.label ?? item.type, state: item.state, retained: !["missing", "lost", "abandoned", "destroyed"].includes(String(item.state).toLowerCase()), holder: item.holder === player ? "player" : item.holder ? "assigned personnel" : null }));
  const evidence = expedition.evidence ?? []; const clock = expedition.clock ?? {}; const checkIns = expedition.communications?.check_ins ?? [];
  const consequences = expedition.operational?.consequences ?? []; const hazards = expedition.hazards ?? {};
  const derivedHooks = [
    ...(personnel.some((item) => /injur|incapac/i.test(item.condition)) ? ["personnel_injury"] : []),
    ...(personnel.some((item) => ["missing", "dead"].includes(item.status)) ? ["missing_personnel"] : []),
    ...(equipment.some((item) => ["damaged", "disabled", "lost", "destroyed"].includes(String(item.state).toLowerCase())) ? ["equipment_consequence"] : []),
    ...(checkIns.some((item) => item.history?.some((entry) => entry.to === "missed")) ? ["missed_check_in"] : []),
    ...(Object.keys(context.run?.spatial?.blocked_paths ?? {}).length ? ["route_compromise"] : []),
    ...(consequences.some((item) => item.recovery) ? ["recovered_complication"] : [])
  ];
  const debriefDetails = [
    ...(personnel.some((item) => /injur|incapac/i.test(item.condition)) ? ["A teammate returned with a recorded injury."] : []),
    ...(consequences.some((item) => item.recovery) ? ["A field complication was recovered before closure."] : []),
    ...(equipment.some((item) => ["damaged", "disabled", "lost", "destroyed"].includes(String(item.state).toLowerCase())) ? ["The equipment record includes damage or loss."] : []),
    ...(checkIns.some((item) => item.history?.some((entry) => entry.to === "missed")) ? ["The scheduled communication record includes a missed reporting window."] : []),
    ...(evidence.length && !evidence.some((item) => item.available_to_standard === true) ? ["Retained field evidence was not delivered to Standard."] : [])
  ];
  return {
    version: RESULT_VERSION, mission_id: state.instance_id, final_mission_state: rule.final_state, classification: rule.classification,
    required_objectives_satisfied: listBy(required, "satisfied"), required_objectives_failed: listBy(required, "failed"), required_objectives_waived: listBy(required, "waived"), required_objectives_abandoned: listBy(required, "abandoned"),
    optional_objectives_satisfied: listBy(optional, "satisfied"), optional_objectives_failed_or_abandoned: optional.filter((item) => ["failed", "abandoned"].includes(objectiveSnapshot[item.id])).map((item) => item.name),
    objective_outcomes: definition.mission.objectives.map((item) => ({ name: item.name, kind: item.kind, state: objectiveSnapshot[item.id] })),
    personnel_outcome: personnel, equipment_outcome: equipment,
    evidence_outcome: { captured: evidence.filter((item) => item.valid !== false).length, retained: evidence.filter((item) => item.available_to_player !== false).length, reported: evidence.filter((item) => item.available_to_standard === true).length, quality: evidence.some((item) => item.condition_fingerprint) ? "condition-specific" : evidence.length ? "field-record" : "none" },
    communication_outcome: { radio_check_completed: expedition.radio?.check_completed === true, check_in_completed: checkIns.length ? checkIns.some((item) => item.state === "completed") : Number.isFinite(clock.check_in_completed_at), check_in_missed: checkIns.length ? checkIns.some((item) => item.history?.some((entry) => entry.to === "missed")) : clock.check_in_missed === true || clock.check_in_overdue === true, check_ins: checkIns.map((item) => ({ id: item.id, state: item.state, due_at: item.due_at, completed_at: item.completed_at })), messages: (expedition.messages ?? []).map((item) => ({ purpose: item.purpose, state: item.state ?? item.delivery_status, sent_at: item.sent_at ?? item.interval, delivered_at: item.delivered_at ?? null, acknowledged_at: item.acknowledged_at ?? null })), closure_delivered: (expedition.messages ?? []).some((item) => item.purpose === "mission-closure" && item.delivery_status === "delivered") },
    return_outcome: { requested: state.return.requested, controlled_abort: state.return.abort_requested, route_available: state.return.route_available, return_ready: state.return.ready, completed: true, location: context.run?.spatial?.player_location ?? null },
    operational_time: Number(clock.interval ?? 0), operational_outcome: { consequence_count: consequences.length, consequences: consequences.map((item) => ({ classification: item.classification, public_summary: item.public_summary, recovered: Boolean(item.recovery) })), hazard_states: Object.fromEntries(Object.entries(hazards.states ?? {}).map(([id, value]) => [id, value.state])), team_decisions: expedition.team_runtime?.decision_history?.length ?? 0 }, public_debrief_summary: [rule.public_summary, ...debriefDetails].join(" "), institutional_consequence_hooks: [...new Set([...rule.institutional_hooks, ...derivedHooks])], evaluation_revision: state.evaluation_revision + 1
  };
}

function evaluate(state, definition, context = {}) {
  if (!state || state.version !== STATE_VERSION) throw new Error("mission state version unsupported");
  const missionState = state; const fullContext = { ...context, mission_state: missionState };
  const { proposed, blockers } = proposedObjectiveStates(state, definition, fullContext);
  const routeAvailable = evaluateCondition(definition.mission.return_policy.route_available_when, fullContext, proposed);
  const ready = evaluateCondition(definition.mission.return_policy.ready_when, { ...fullContext, mission_state: { ...missionState, return: { ...missionState.return, route_available: routeAvailable } } }, proposed);
  const returnState = { ...state.return, route_available: routeAvailable, ready, summary: ready ? definition.mission.return_policy.public.ready : routeAvailable ? definition.mission.return_policy.public.available : definition.mission.return_policy.public.unavailable };
  let lifecycle;
  if (CLOSED_MISSION_STATES.has(state.lifecycle)) lifecycle = state.lifecycle;
  else if (returnState.requested || returnState.abort_requested) lifecycle = "returning";
  else if (state.phase === "BRIEFING") lifecycle = "briefing";
  else if (["STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK"].includes(state.phase)) lifecycle = "authorized";
  else lifecycle = routeAvailable ? "return_available" : "in_progress";
  const closureContext = { ...fullContext, mission_state: { ...missionState, lifecycle, return: returnState } };
  let finalResult = state.final_result; let closureTransitions = [];
  if (!finalResult && returnState.closure_requested && evaluateCondition(definition.mission.return_policy.completion_when, closureContext, proposed)) {
    for (const authored of definition.mission.objectives) if (!TERMINAL_OBJECTIVE_STATES.has(proposed[authored.id])) {
      const target = state.return.abort_requested ? definition.mission.abort_policy.unresolved_state : "abandoned";
      proposed[authored.id] = target; closureTransitions.push({ objective_id: authored.id, to: target });
    }
    const ruleContext = { ...closureContext, mission_state: { ...closureContext.mission_state, lifecycle: state.return.abort_requested ? "aborted" : "completed" } };
    const rule = classifyOutcome(definition, ruleContext, proposed);
    lifecycle = rule.final_state; returnState.completed = true;
    finalResult = buildResult(state, definition, ruleContext, proposed, rule);
  }
  const transitions = [];
  for (const authored of definition.mission.objectives) {
    const from = state.objectives[authored.id].state; const to = proposed[authored.id]; if (from === to) continue;
    if (!objectiveTransitions(authored)[from]?.has(to)) throw new Error(`illegal objective transition: ${authored.id} ${from} -> ${to}`);
    const blocker = blockers.find((item) => item.objective_id === authored.id) ?? null;
    transitions.push({ objective_id: authored.id, from, to, reason: stateReason(authored, to, blocker), headline: stateHeadline(authored, to), source: "authoritative-condition-evaluation" });
  }
  const fingerprint = digest({ proposed, blockers, returnState, lifecycle, final: finalResult?.classification ?? null });
  return { proposed, blockers, return_state: returnState, lifecycle, transitions, final_result: finalResult, fingerprint, changed: fingerprint !== state.last_evaluation_fingerprint };
}

function commit(state, definition, proposal, { at = 0 } = {}) {
  if (!proposal || !proposal.proposed) throw new Error("mission proposal is incomplete");
  const changes = proposal.transitions ?? [];
  for (const transition of changes) {
    const authored = definition.mission.objectives.find((item) => item.id === transition.objective_id);
    const current = state.objectives[transition.objective_id];
    if (!authored || !current || current.state !== transition.from || !objectiveTransitions(authored)[transition.from]?.has(transition.to)) throw new Error("mission proposal contains an illegal transition");
  }
  for (const transition of changes) {
    const objective = state.objectives[transition.objective_id];
    objective.state = transition.to;
    const entry = { sequence: objective.history.length + 1, from: transition.from, to: transition.to, at, reason: transition.reason, source: transition.source };
    objective.history.push(entry); objective.last_transition = clone(entry);
    state.transition_history.push({ sequence: state.transition_history.length + 1, kind: "objective", objective_id: transition.objective_id, from: transition.from, to: transition.to, at, reason: transition.reason });
  }
  const lifecycleChanged = state.lifecycle !== proposal.lifecycle;
  if (lifecycleChanged) state.transition_history.push({ sequence: state.transition_history.length + 1, kind: "mission", from: state.lifecycle, to: proposal.lifecycle, at, reason: proposal.final_result?.public_debrief_summary ?? proposal.return_state.summary });
  state.lifecycle = proposal.lifecycle; state.active_blockers = clone(proposal.blockers); state.return = clone(proposal.return_state); state.final_result = clone(proposal.final_result); state.last_evaluation_fingerprint = proposal.fingerprint; state.evaluation_revision += 1;
  state.recent_updates = changes.slice(-5).map((transition) => ({ headline: transition.headline, summary: transition.reason, state: transition.to, at }));
  return { changed: changes.length > 0 || lifecycleChanged, transitions: clone(changes), lifecycle_changed: lifecycleChanged, final_result: clone(state.final_result) };
}

function evaluateAndCommit(state, definition, context = {}, options = {}) {
  const proposal = evaluate(state, definition, context);
  const noMaterialChange = proposal.transitions.length === 0 && state.lifecycle === proposal.lifecycle && JSON.stringify(state.return) === JSON.stringify(proposal.return_state) && JSON.stringify(state.active_blockers) === JSON.stringify(proposal.blockers) && Boolean(state.final_result) === Boolean(proposal.final_result);
  if (noMaterialChange) { state.last_evaluation_fingerprint = proposal.fingerprint; return { changed: false, transitions: [], lifecycle_changed: false, final_result: clone(state.final_result) }; }
  return commit(state, definition, proposal, options);
}

function requestReturn(state, definition, context = {}, { at = 0 } = {}) {
  if (CLOSED_MISSION_STATES.has(state.lifecycle)) return { ok: false, code: "MISSION_CLOSED", reason: "This mission record is already closed." };
  const snapshot = Object.fromEntries(Object.entries(state.objectives).map(([id, objective]) => [id, objective.state]));
  if (!evaluateCondition(definition.mission.return_policy.route_available_when, { ...context, mission_state: state }, snapshot)) return { ok: false, code: "RETURN_ROUTE_UNAVAILABLE", reason: definition.mission.return_policy.public.unavailable };
  if (!state.return.requested) { state.return.requested = true; state.return.requested_at = at; state.transition_history.push({ sequence: state.transition_history.length + 1, kind: "return-request", from: state.lifecycle, to: "returning", at, reason: definition.mission.return_policy.public.requested }); }
  return { ok: true, reason: definition.mission.return_policy.public.requested };
}

function requestAbort(state, definition, context = {}, { at = 0 } = {}) {
  if (CLOSED_MISSION_STATES.has(state.lifecycle)) return { ok: false, code: "MISSION_CLOSED", reason: "This mission record is already closed." };
  const snapshot = Object.fromEntries(Object.entries(state.objectives).map(([id, objective]) => [id, objective.state]));
  if (!evaluateCondition(definition.mission.abort_policy.available_when, { ...context, mission_state: state }, snapshot)) return { ok: false, code: "ABORT_UNAVAILABLE", reason: definition.mission.abort_policy.public_unavailable ?? "A controlled abort is not available from this operational state." };
  const keep = new Set(definition.mission.abort_policy.keep_objectives ?? []);
  const changes = [];
  for (const authored of definition.mission.objectives) {
    const objective = state.objectives[authored.id]; if (keep.has(authored.id) || TERMINAL_OBJECTIVE_STATES.has(objective.state)) continue;
    const to = definition.mission.abort_policy.unresolved_state;
    if (!objectiveTransitions(authored)[objective.state]?.has(to)) throw new Error(`illegal abort transition: ${authored.id} ${objective.state} -> ${to}`);
    changes.push({ authored, objective, to });
  }
  state.return.requested = true; state.return.requested_at ??= at; state.return.abort_requested = true; state.return.abort_requested_at ??= at;
  const transitions = [];
  for (const { authored, objective, to } of changes) {
    const entry = { sequence: objective.history.length + 1, from: objective.state, to, at, reason: definition.mission.abort_policy.public_reason, source: "declared-abort-policy" };
    objective.state = to; objective.history.push(entry); objective.last_transition = clone(entry);
    state.transition_history.push({ sequence: state.transition_history.length + 1, kind: "objective", objective_id: authored.id, from: entry.from, to, at, reason: entry.reason });
    transitions.push({ objective_id: authored.id, from: entry.from, to, at, reason: entry.reason, headline: stateHeadline(authored, to), source: entry.source });
  }
  state.transition_history.push({ sequence: state.transition_history.length + 1, kind: "abort-request", from: state.lifecycle, to: "returning", at, reason: definition.mission.abort_policy.public_reason });
  state.recent_updates = transitions.slice(-5).map((transition) => ({ headline: transition.headline, summary: transition.reason, state: transition.to, at }));
  return { ok: true, reason: definition.mission.abort_policy.public_reason, transitions };
}

function requestClosure(state, definition, context = {}, { at = 0 } = {}) {
  if (!state.return.requested) return { ok: false, code: "RETURN_NOT_REQUESTED", reason: "Begin the return procedure before attempting mission closure." };
  if (state.final_result) return { ok: true, idempotent: true, reason: state.final_result.public_debrief_summary };
  const snapshot = Object.fromEntries(Object.entries(state.objectives).map(([id, objective]) => [id, objective.state]));
  if (!evaluateCondition(definition.mission.return_policy.closure_available_when, { ...context, mission_state: state }, snapshot)) return { ok: false, code: "RETURN_RECONCILIATION_INCOMPLETE", reason: definition.mission.return_policy.public.closure_unavailable ?? state.return.summary };
  state.return.closure_requested = true; state.return.closure_requested_at ??= at;
  return { ok: true, reason: definition.mission.return_policy.public.closure_requested };
}

function project(state, definition) {
  const objectives = definition.mission.objectives.map((authored) => {
    const current = state.objectives[authored.id]; const blocked = state.active_blockers.find((item) => item.objective_id === authored.id);
    const summary = stateReason(authored, current.state, blocked);
    return { name: authored.name, state: current.state, state_label: current.state.replace(/\b\w/g, (letter) => letter.toUpperCase()), required: authored.kind === "required", kind: authored.kind, summary, next_requirement: ["active", "blocked"].includes(current.state) ? authored.public.next_requirement ?? null : null, blocking_reason: current.state === "blocked" && blocked ? summary : null, recent_transition: current.last_transition ? { state: current.last_transition.to, summary: current.last_transition.reason, at: current.last_transition.at } : null };
  });
  const unresolved = objectives.filter((item) => !["satisfied", "waived"].includes(item.state)).map((item) => ({ name: item.name, state: item.state, summary: item.summary }));
  const result = state.final_result ? clone(state.final_result) : null;
  if (result?.return_outcome) delete result.return_outcome.location;
  return { display_name: definition.mission.display_name, briefing: definition.mission.briefing, operational_intent: definition.mission.operational_intent, lifecycle: state.lifecycle, lifecycle_label: state.lifecycle.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), required_objectives: objectives.filter((item) => item.required), optional_objectives: objectives.filter((item) => !item.required), blockers: objectives.filter((item) => item.state === "blocked").map((item) => ({ name: item.name, reason: item.blocking_reason ?? item.summary })), recent_updates: clone(state.recent_updates), return_readiness: { route_available: state.return.route_available, ready: state.return.ready, returning: state.return.requested, closure_ready: state.return.requested && state.return.ready, summary: state.return.summary, unresolved }, result };
}

module.exports = {
  DEFINITION_VERSION, STATE_VERSION, RESULT_VERSION, OBJECTIVE_STATES, MISSION_STATES, OBJECTIVE_KINDS, BEHAVIORS,
  validateDefinition, validateDefinitions, validateCondition, conditionReferences, createState, migrate, attachCompatibilityView,
  evaluateCondition, evaluate, commit, evaluateAndCommit, requestReturn, requestAbort, requestClosure, project
};
