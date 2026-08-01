"use strict";

// Generic worldpack-authored object behavior. This module intentionally owns
// no scenario-specific names, equipment catalog, or mission prose. Callers provide a
// validated definition plus small adapters for equipment and operational time.
const crypto = require("node:crypto");

const VERSION = "yellow-beast-object-state@v1";
const DEFINITION_VERSION = "yellow-beast-interaction-worldpack@v1";
const EVIDENCE_VERSION = "yellow-beast-object-evidence@v1";
const AFFORDANCES = Object.freeze([
  "inspect", "use", "activate", "deactivate", "open", "close", "move",
  "take", "place", "mark", "photograph", "record", "test", "repair",
  "damage", "secure", "release"
]);
const AFFORDANCE_SET = new Set(AFFORDANCES);
const clone = (value) => structuredClone(value);
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[.!?]+$/, "");
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const CORE_STATE_PATHS = new Set(["location", "condition", "open", "active", "intact", "marked", "moved", "holder", "container"]);

function validStatePath(path) {
  return CORE_STATE_PATHS.has(path) || /^custom\.[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/.test(String(path ?? ""));
}

function readPath(value, path) {
  return String(path ?? "").split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}

function writePath(value, path, next) {
  const keys = String(path).split(".");
  let current = value;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== "object" || Array.isArray(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys.at(-1)] = clone(next);
}

function predicateMatches(target, predicate) {
  if (!predicate) return true;
  if (Array.isArray(predicate.all)) return predicate.all.every((item) => predicateMatches(target, item));
  if (Array.isArray(predicate.any)) return predicate.any.some((item) => predicateMatches(target, item));
  if (predicate.not) return !predicateMatches(target, predicate.not);
  const actual = readPath(target, predicate.path);
  if (Object.hasOwn(predicate, "equals")) return actual === predicate.equals;
  if (Array.isArray(predicate.in)) return predicate.in.includes(actual);
  if (predicate.exists === true) return actual !== undefined && actual !== null;
  if (predicate.exists === false) return actual === undefined || actual === null;
  return false;
}

function validateTextRules(rules, label) {
  if (!Array.isArray(rules) || rules.length === 0 || rules.some((rule) => !rule || typeof rule.text !== "string" || !rule.text.trim())) throw new Error(`${label} requires condition-specific prose`);
  for (const rule of rules) for (const predicate of rule.when ?? []) if (!validStatePath(predicate.path)) throw new Error(`${label} uses an invalid state path`);
}

function validateDefinition(definition, spatialDefinition = null) {
  if (!definition || definition.version !== DEFINITION_VERSION || !definition.worldpack_id || !Array.isArray(definition.objects)) throw new Error("unsupported interaction worldpack");
  if (spatialDefinition && definition.worldpack_id !== spatialDefinition.worldpack_id) throw new Error("interaction worldpack does not match spatial worldpack");
  const locations = new Set((spatialDefinition?.locations ?? []).map((location) => location.id));
  const ids = new Set();
  for (const object of definition.objects) {
    if (!object?.id || ids.has(object.id)) throw new Error("duplicate interaction object id");
    ids.add(object.id);
    if (!object.display_name || !object.object_type || !object.location) throw new Error("interaction object identity is incomplete");
    if (spatialDefinition && !locations.has(object.location)) throw new Error(`interaction object location does not resolve: ${object.id}`);
    if (!object.initial_state || typeof object.initial_state.condition !== "string") throw new Error(`interaction object lacks an initial condition: ${object.id}`);
    validateTextRules(object.observation_text_by_condition, `${object.id} observation`);
    validateTextRules(object.inspection_text_by_condition, `${object.id} inspection`);
    const propertyIds = [...(object.visible_properties ?? []), ...(object.hidden_properties ?? [])].map((property) => property.id);
    if (propertyIds.some((id) => !id) || new Set(propertyIds).size !== propertyIds.length) throw new Error(`interaction object properties are invalid: ${object.id}`);
    const affordances = new Set();
    for (const affordance of object.affordances ?? []) {
      if (!AFFORDANCE_SET.has(affordance.type)) throw new Error(`invalid interaction affordance: ${affordance.type ?? "missing"}`);
      if (affordances.has(affordance.type)) throw new Error(`duplicate interaction affordance: ${object.id}/${affordance.type}`);
      affordances.add(affordance.type);
      if (!affordance.label || !affordance.result || !Number.isInteger(affordance.time_cost) || affordance.time_cost < 0) throw new Error(`interaction affordance is incomplete: ${object.id}/${affordance.type}`);
      for (const match of affordance.result.matchAll(/\{([^}]+)\}/g)) if (!["tool_holder_first_name", "actor_display_name", "team_lead_first_name"].includes(match[1])) throw new Error(`interaction result uses an unsupported actor template: ${object.id}/${match[1]}`);
      for (const requirement of affordance.requirements?.state ?? []) if (!validStatePath(requirement.path)) throw new Error(`invalid interaction requirement path: ${object.id}/${affordance.type}`);
      for (const mutation of affordance.mutations ?? []) if (!validStatePath(mutation.path)) throw new Error(`invalid interaction mutation path: ${object.id}/${affordance.type}`);
      for (const propertyId of affordance.reveals ?? []) if (!propertyIds.includes(propertyId)) throw new Error(`interaction reveal does not resolve: ${object.id}/${propertyId}`);
      if (affordance.evidence && !affordance.evidence.type) throw new Error(`interaction evidence type is missing: ${object.id}/${affordance.type}`);
    }
    for (const action of Object.keys(object.rejections ?? {})) if (!AFFORDANCE_SET.has(action)) throw new Error(`invalid authored rejection affordance: ${action}`);
  }
  return true;
}

function definitionIndex(definition) {
  validateDefinition(definition);
  return Object.fromEntries(definition.objects.map((object) => [object.id, object]));
}

function initialObjectState(object) {
  const initial = object.initial_state;
  return {
    location: initial.location ?? object.location,
    condition: initial.condition,
    open: initial.open ?? null,
    active: initial.active ?? null,
    intact: initial.intact ?? null,
    marked: initial.marked ?? false,
    moved: initial.moved ?? false,
    holder: initial.holder ?? null,
    container: initial.container ?? null,
    custom: clone(initial.custom ?? {}),
    knowledge: {},
    interaction_history: [],
    evidence_collected: []
  };
}

function createState(definition) {
  validateDefinition(definition);
  return {
    version: VERSION,
    worldpack_id: definition.worldpack_id,
    objects: Object.fromEntries(definition.objects.map((object) => [object.id, initialObjectState(object)])),
    interaction_history: [],
    revision: 0
  };
}

function migrate(state, definition) {
  validateDefinition(definition);
  if (state?.version !== VERSION || state.worldpack_id !== definition.worldpack_id || !state.objects) return createState(definition);
  for (const object of definition.objects) {
    const initial = initialObjectState(object);
    state.objects[object.id] ??= initial;
    const current = state.objects[object.id];
    for (const [key, value] of Object.entries(initial)) if (current[key] === undefined) current[key] = clone(value);
    current.knowledge ??= {};
    current.interaction_history ??= [];
    current.evidence_collected ??= [];
    current.custom ??= {};
  }
  state.interaction_history ??= [];
  state.revision ??= 0;
  return state;
}

function knowledgeFor(objectState, observer) {
  objectState.knowledge[observer] ??= { observed: false, inspected: false, observed_properties: [], known_properties: [], first_observed_at: null, last_observed_at: null };
  return objectState.knowledge[observer];
}

function observeLocation(state, definition, { observer, location, time = 0 } = {}) {
  const changed = [];
  for (const object of definition.objects.filter((item) => state.objects[item.id]?.location === location)) {
    const knowledge = knowledgeFor(state.objects[object.id], observer);
    const before = JSON.stringify(knowledge);
    knowledge.observed = true;
    knowledge.first_observed_at ??= time;
    knowledge.last_observed_at = time;
    for (const property of object.visible_properties ?? []) {
      if (!knowledge.observed_properties.includes(property.id)) knowledge.observed_properties.push(property.id);
      if (!knowledge.known_properties.includes(property.id)) knowledge.known_properties.push(property.id);
    }
    if (before !== JSON.stringify(knowledge)) changed.push(object.id);
  }
  if (changed.length) state.revision += 1;
  return changed;
}

function textFor(rules, objectState) {
  return rules.find((rule) => rule.default === true || (rule.when ?? []).every((predicate) => predicateMatches(objectState, predicate)))?.text ?? rules.at(-1)?.text ?? "The object's condition is not yet clear.";
}

function aliasesFor(object) {
  return [...new Set([object.display_name, ...(object.aliases ?? [])].map(normalize).filter(Boolean))];
}

function visibleObjects(state, definition, location) {
  return definition.objects.filter((object) => state.objects[object.id]?.location === location && predicateMatches(state.objects[object.id], object.visibility));
}

function resolveTarget(state, definition, target, location) {
  const query = normalize(target);
  const candidates = visibleObjects(state, definition, location);
  const exact = candidates.filter((object) => aliasesFor(object).some((alias) => query === alias));
  const matches = exact.length ? exact : candidates.filter((object) => aliasesFor(object).some((alias) => alias.length > 2 && query.includes(alias)));
  if (matches.length === 1) return { ok: true, object: matches[0], object_state: state.objects[matches[0].id] };
  if (matches.length > 1) return { ok: false, code: "INTERACTION_TARGET_AMBIGUOUS", reason: `More than one visible object matches that description: ${matches.map((item) => item.display_name).join(" or ")}.` };
  return { ok: false, code: "INTERACTION_TARGET_UNAVAILABLE", reason: "Nothing matching that description is within reach here." };
}

function stateRequirementFailure(objectState, affordance) {
  const failed = (affordance.requirements?.state ?? []).find((requirement) => !predicateMatches(objectState, requirement));
  return failed ? (failed.failure ?? affordance.failure ?? "The object's present condition does not permit that action.") : null;
}

function toolStatuses(affordance, context) {
  const statuses = [];
  for (const requirement of affordance.requirements?.equipment ?? []) {
    const status = context.resolveTool?.(requirement) ?? { ok: false, code: "EQUIPMENT_NOT_ACCESSIBLE", reason: "The required equipment is not accessible here." };
    if (!status.ok) return { ok: false, ...status };
    statuses.push({ requirement, status });
  }
  return { ok: true, statuses };
}

function conditionSnapshot(objectState, fields = null) {
  const selected = fields?.length ? fields : ["condition", "open", "active", "intact", "marked", "moved"];
  return Object.fromEntries(selected.map((path) => [path, clone(readPath(objectState, path))]));
}

function evidenceFor({ definition, object, objectState, affordance, observer, time, locationName, toolStatuses: tools, runRef }) {
  const evidence = affordance.evidence;
  if (!evidence) return null;
  const condition = conditionSnapshot(objectState, evidence.condition_fields);
  const conditionFingerprint = digest(condition).slice(0, 20);
  const device = tools.find(({ requirement }) => requirement.key === evidence.device_key || requirement.capability === evidence.device_capability)?.status ?? null;
  const creator = device?.holder ?? observer;
  return {
    version: EVIDENCE_VERSION,
    id: `object-evidence-${digest([definition.worldpack_id, runRef ?? "run", object.id, evidence.type, conditionFingerprint]).slice(0, 20)}`,
    type: evidence.type,
    source_object: object.id,
    source_name: object.display_name,
    source_location: objectState.location,
    source_location_name: locationName ?? objectState.location,
    location: objectState.location,
    creator,
    capturing_observer: creator,
    custodian: creator,
    capture_event: "object.evidence.captured",
    method: evidence.method ?? affordance.type,
    device_id: device?.item?.id ?? null,
    device: device?.item?.label ?? evidence.method ?? affordance.type,
    object_condition: condition,
    condition_fingerprint: conditionFingerprint,
    condition_summary: evidence.condition_summary ?? textFor(object.observation_text_by_condition, objectState),
    captured_at: { interval: time ?? 0 },
    interval: time ?? 0,
    available_to_player: true,
    available_to_standard: false,
    reporting_state: "unreported",
    storage: evidence.storage ?? "with field record",
    visible_objects: [object.display_name],
    target_observation: evidence.condition_summary ?? textFor(object.observation_text_by_condition, objectState),
    provenance: "worldpack-authored-object-interaction",
    valid: true
  };
}

function knownProperties(object, objectState, observer) {
  const known = new Set(objectState.knowledge?.[observer]?.known_properties ?? []);
  return [...(object.visible_properties ?? []), ...(object.hidden_properties ?? [])].filter((property) => known.has(property.id)).map((property) => property.text);
}

function affordanceProjection(object, objectState, observer, context = {}) {
  const knowledge = objectState.knowledge?.[observer] ?? {};
  return (object.affordances ?? []).filter((affordance) => affordance.type !== "inspect" && (affordance.known_when !== "inspected" || knowledge.inspected)).map((affordance) => {
    const stateFailure = stateRequirementFailure(objectState, affordance);
    const tools = stateFailure ? null : toolStatuses(affordance, context);
    return { action: affordance.type.toUpperCase(), label: affordance.label, target: object.display_name, available: !stateFailure && (tools?.ok ?? true), unavailable_reason: stateFailure ?? (tools?.ok === false ? tools.reason : null) };
  });
}

function projectLocation(state, definition, { observer, location, toolContext = {} } = {}) {
  return visibleObjects(state, definition, location).map((object) => {
    const objectState = state.objects[object.id];
    return {
      name: object.display_name,
      object_type: object.object_type,
      observation: textFor(object.observation_text_by_condition, objectState),
      condition: textFor(object.observation_text_by_condition, objectState),
      known_properties: knownProperties(object, objectState, observer),
      actions: affordanceProjection(object, objectState, observer, toolContext)
    };
  });
}

function inspection(state, definition, { observer, location, target, time = 0, toolContext = {} } = {}) {
  const resolved = resolveTarget(state, definition, target, location);
  if (!resolved.ok) return resolved;
  const { object, object_state: objectState } = resolved;
  const knowledge = knowledgeFor(objectState, observer);
  knowledge.observed = true;
  knowledge.inspected = true;
  knowledge.first_observed_at ??= time;
  knowledge.last_observed_at = time;
  for (const property of [...(object.visible_properties ?? []), ...(object.hidden_properties ?? [])]) {
    if ((property.reveal_by ?? ["inspect"]).includes("inspect") && !knowledge.known_properties.includes(property.id)) knowledge.known_properties.push(property.id);
  }
  const entry = { sequence: state.interaction_history.length + 1, object_id: object.id, action: "inspect", observer, at: time, result: "observed" };
  state.interaction_history.push(entry);
  objectState.interaction_history.push(entry.sequence);
  state.revision += 1;
  return { ok: true, action: "inspect", target: object.display_name, narration: textFor(object.inspection_text_by_condition, objectState), known_properties: knownProperties(object, objectState, observer), actions: affordanceProjection(object, objectState, observer, toolContext), time_cost: 0, state_changed: true };
}

function interact(state, definition, { observer, location, location_name = null, target, action, time = 0, run_ref = null, evidence = [], resolveTool = null, consumeTool = null, advanceTime = null, onEvidence = null, renderText = null } = {}) {
  const type = normalize(action);
  if (type === "inspect") return inspection(state, definition, { observer, location, target, time, toolContext: { resolveTool } });
  if (!AFFORDANCE_SET.has(type)) return { ok: false, code: "INTERACTION_UNSUPPORTED", reason: "That action does not describe a supported physical interaction here." };
  const resolved = resolveTarget(state, definition, target, location);
  if (!resolved.ok) return resolved;
  const { object, object_state: objectState } = resolved;
  const affordance = (object.affordances ?? []).find((item) => item.type === type);
  if (!affordance) return { ok: false, code: "INTERACTION_UNSUPPORTED", reason: object.rejections?.[type] ?? `The ${object.display_name.toLowerCase()} does not support that action.` };
  const stateFailure = stateRequirementFailure(objectState, affordance);
  if (stateFailure) return { ok: false, code: "INTERACTION_STATE_BLOCKED", reason: stateFailure };
  const knowledge = objectState.knowledge?.[observer];
  if (affordance.requirements?.inspected === true && !knowledge?.inspected) return { ok: false, code: "INTERACTION_KNOWLEDGE_REQUIRED", reason: affordance.requirements.inspection_failure ?? `Inspect the ${object.display_name.toLowerCase()} before attempting that.` };
  const tools = toolStatuses(affordance, { resolveTool });
  if (!tools.ok) return tools;

  const preview = clone(objectState);
  for (const mutation of affordance.mutations ?? []) writePath(preview, mutation.path, mutation.value);
  const proposedEvidence = evidenceFor({ definition, object, objectState: preview, affordance, observer, time: time + affordance.time_cost, locationName: location_name, toolStatuses: tools.statuses, runRef: run_ref });
  if (proposedEvidence && evidence.some((item) => item.valid !== false && item.source_object === object.id && item.type === proposedEvidence.type && item.condition_fingerprint === proposedEvidence.condition_fingerprint)) return { ok: false, code: "EVIDENCE_REDUNDANT", reason: affordance.evidence.repeat_failure ?? `The existing record already captures the ${object.display_name.toLowerCase()} in this condition.` };

  for (const tool of tools.statuses) {
    const consumed = consumeTool?.(tool.requirement, tool.status) ?? { ok: true };
    if (!consumed.ok) return { ok: false, code: consumed.code ?? "EQUIPMENT_UNAVAILABLE", reason: consumed.reason ?? "The required equipment is not operational." };
  }
  state.objects[object.id] = preview;
  const committed = state.objects[object.id];
  const committedKnowledge = knowledgeFor(committed, observer);
  committedKnowledge.observed = true;
  committedKnowledge.last_observed_at = time + affordance.time_cost;
  for (const propertyId of affordance.reveals ?? []) if (!committedKnowledge.known_properties.includes(propertyId)) committedKnowledge.known_properties.push(propertyId);
  if (proposedEvidence) {
    evidence.push(proposedEvidence);
    committed.evidence_collected.push(proposedEvidence.id);
    onEvidence?.(proposedEvidence);
  }
  const before = conditionSnapshot(objectState, [...new Set((affordance.mutations ?? []).map((mutation) => mutation.path))]);
  const after = conditionSnapshot(committed, [...new Set((affordance.mutations ?? []).map((mutation) => mutation.path))]);
  const entry = { sequence: state.interaction_history.length + 1, object_id: object.id, action: type, observer, at: time + affordance.time_cost, time_cost: affordance.time_cost, state_before: before, state_after: after, evidence_id: proposedEvidence?.id ?? null };
  state.interaction_history.push(entry);
  committed.interaction_history.push(entry.sequence);
  state.revision += 1;
  if (affordance.time_cost) advanceTime?.(affordance.time_cost);
  return { ok: true, action: type, target: object.display_name, narration: renderText ? renderText(affordance.result, tools.statuses) : affordance.result, time_cost: affordance.time_cost, state_changed: true, evidence: proposedEvidence ? clone(proposedEvidence) : null, interaction_sequence: entry.sequence };
}

const VERB_PATTERNS = Object.freeze([
  ["photograph", /\b(photograph|photo|picture|camera|snapshot)\b/],
  ["deactivate", /\b(deactivate|switch off|turn off)\b/],
  ["activate", /\b(activate|switch on|turn on)\b/],
  ["inspect", /\b(inspect|examine|look at|check|observe)\b/],
  ["record", /\b(record|document|write down|note)\b/],
  ["repair", /\b(repair|fix|mend)\b/],
  ["secure", /\b(secure|fasten|brace)\b/],
  ["release", /\b(release|unfasten)\b/],
  ["open", /\bopen\b/], ["close", /\bclose\b/], ["mark", /\b(mark|tag|draw)\b/],
  ["test", /\b(test|measure|meter)\b/], ["take", /\b(take|pick up)\b/],
  ["place", /\b(place|put|set)\b/], ["move", /\b(move|shift|push|pull)\b/],
  ["damage", /\b(damage|break)\b/], ["use", /\buse\b/]
]);

function interpret(state, definition, text, { location } = {}) {
  const phrase = normalize(text);
  const action = VERB_PATTERNS.find(([, pattern]) => pattern.test(phrase))?.[0];
  if (!action) return { kind: "invalid", reason: "That instruction does not identify a reasonable interaction with anything visible here." };
  const visible = visibleObjects(state, definition, location);
  const mentioned = visible.filter((object) => aliasesFor(object).some((alias) => alias.length > 2 && phrase.includes(alias)));
  let candidates = mentioned;
  if (!candidates.length && /\b(this|that|it)\b/.test(phrase)) candidates = visible.filter((object) => (object.affordances ?? []).some((affordance) => affordance.type === action));
  if (candidates.length === 1) return { kind: "interaction", action, target: candidates[0].display_name };
  if (candidates.length > 1) return { kind: "ambiguous", reason: `More than one visible object could be ${action === "mark" ? "marked" : `${action}ed`}: ${candidates.map((object) => object.display_name).join(" or ")}. Name the one you mean.` };
  const named = mentioned[0];
  if (named) return { kind: "interaction", action, target: named.display_name };
  return { kind: "invalid", reason: `Nothing visible here supports that ${action} attempt.` };
}

function validateState(state, definition) {
  const errors = [];
  const objects = definitionIndex(definition);
  if (state?.version !== VERSION || state.worldpack_id !== definition.worldpack_id) errors.push("OBJECT_STATE_VERSION_UNSUPPORTED");
  for (const id of Object.keys(state?.objects ?? {})) if (!objects[id]) errors.push(`OBJECT_STATE_UNKNOWN:${id}`);
  for (const id of Object.keys(objects)) if (!state?.objects?.[id]) errors.push(`OBJECT_STATE_MISSING:${id}`);
  return errors;
}

module.exports = {
  VERSION, DEFINITION_VERSION, EVIDENCE_VERSION, AFFORDANCES,
  validateDefinition, createState, migrate, observeLocation, projectLocation,
  resolveTarget, inspection, interact,
  interpret, validateState, conditionSnapshot
};
