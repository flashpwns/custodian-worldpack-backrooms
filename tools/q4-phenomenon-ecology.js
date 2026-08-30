"use strict";

// Pass 16B canonical authority for rare Clear-Q4 phenomena and entities.
// Instances live in world.phenomena. Presentation receives only projections
// built from explicit observer records; canonical_family is developer-only.
const crypto = require("node:crypto");
const config = require("../data/worldpacks/clear-q4/phenomena.json");
const spatialRuntime = require("./spatial-runtime");
const environment = require("./q4-environment");
const objectRuntime = require("./object-runtime");
const evidenceAuthority = require("./q4-evidence-authority");
const consequenceRuntime = require("./consequence-runtime");
const history = require("./world-history");

const VERSION = "yellow-beast-q4-phenomenon-ecology@v1";
const RECORD_VERSION = "yellow-beast-q4-phenomenon-record@v1";
const FIXTURE_TOKEN = "PASS_16B_CONTROLLED_FIXTURE";
const CANONICAL_FAMILIES = Object.freeze(config.production.families.map((item) => item.id));
const ENTITY_FAMILIES = new Set(["STILL_LIFE", "BACTERIA"]);
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stableId = (world, family, location, provenance) => `q4-phenomenon-${digest([world.world_id, family, location, provenance]).slice(0, 20)}`;
const now = (run) => run?.expedition?.clock?.interval ?? 0;
const plainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
function invalidState(reason) { throw Object.assign(new Error(`invalid Q4 phenomenon ecology state: ${reason}`), { code:"Q4_ECOLOGY_INVALID" }); }

const STILL_PROFILES = Object.freeze({
  INERT: { apparent_vitality:"lifeless", breathing:false, mobility:"none", vocalization:"none", fear_response:"none", aggression:"none", avoidance:"none", environmental_interaction:"none", light_interaction:"none", approach_response:"none", physical_interference_response:"none", self_directed_hazard_movement:false, perception:[] },
  BREATHING_PASSIVE: { apparent_vitality:"uncertain", breathing:true, mobility:"none", vocalization:"none", fear_response:"none", aggression:"none", avoidance:"none", environmental_interaction:"none", light_interaction:"none", approach_response:"minimal", physical_interference_response:"minimal", self_directed_hazard_movement:false, perception:["visual-near"] },
  VOCAL_FEAR: { apparent_vitality:"active", breathing:true, mobility:"limited", vocalization:"distressed", fear_response:"strong", aggression:"none", avoidance:"withdraw", environmental_interaction:"none", light_interaction:"none", approach_response:"vocalize", physical_interference_response:"fear", self_directed_hazard_movement:false, perception:["visual-near", "acoustic-local"] },
  FLEEING: { apparent_vitality:"active", breathing:true, mobility:"edge", vocalization:"variable", fear_response:"strong", aggression:"none", avoidance:"flee", environmental_interaction:"movement", light_interaction:"none", approach_response:"flee", physical_interference_response:"flee", self_directed_hazard_movement:false, perception:["visual-near", "acoustic-local"] },
  AGGRESSIVE: { apparent_vitality:"active", breathing:false, mobility:"edge", vocalization:"variable", fear_response:"none", aggression:"contact", avoidance:"none", environmental_interaction:"movement", light_interaction:"none", approach_response:"approach", physical_interference_response:"approach", self_directed_hazard_movement:false, perception:["visual-near", "acoustic-local"] },
  LIGHT_INTERACTIVE: { apparent_vitality:"uncertain", breathing:true, mobility:"limited", vocalization:"none", fear_response:"low", aggression:"none", avoidance:"none", environmental_interaction:"lighting", light_interaction:"toggle", approach_response:"light-interaction", physical_interference_response:"minimal", self_directed_hazard_movement:false, perception:["visual-near"] },
  HAZARD_SEEKING: { apparent_vitality:"active", breathing:true, mobility:"edge", vocalization:"screaming", fear_response:"unclear", aggression:"none", avoidance:"none", environmental_interaction:"movement", light_interaction:"none", approach_response:"hazard-seeking", physical_interference_response:"vocalize", self_directed_hazard_movement:true, perception:["visual-near", "acoustic-local"] },
  LOW_REACTIVITY: { apparent_vitality:"uncertain", breathing:true, mobility:"none", vocalization:"none", fear_response:"none", aggression:"none", avoidance:"none", environmental_interaction:"none", light_interaction:"none", approach_response:"none", physical_interference_response:"none", self_directed_hazard_movement:false, perception:[] }
});

function validateConfig() {
  if (config.version !== "yellow-beast-q4-phenomenon-config@v1" || config.worldpack_id !== "clear-q4") throw new Error("unsupported phenomenon worldpack config");
  const ids = config.production.families.map((item) => item.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => !CANONICAL_FAMILIES.includes(id))) throw new Error("invalid phenomenon family configuration");
  return true;
}

function createState({ existing_locations = [], migrated_conservatively = false } = {}) {
  const value = { version:VERSION, config_version:config.version, evaluated_locations:[...new Set(existing_locations.filter((item) => item?.id).map((item) => item.id))], eligibility_history:[], last_instantiated_evaluation:null, fixture_ids:[], conditions:{}, incidents:{}, recent_errors:[] };
  if (migrated_conservatively) value.migrated_conservatively = true;
  return value;
}

function currentState() {
  return createState();
}

function normalizeState(value) {
  const state = value ?? createState();
  if (!plainObject(state)) invalidState("state must be a plain object");
  if (state.version == null) state.version = VERSION;
  if (state.version !== VERSION) throw new Error("unsupported Q4 phenomenon ecology state");
  state.config_version ??= config.version;
  state.evaluated_locations ??= [];
  state.eligibility_history ??= [];
  state.last_instantiated_evaluation ??= null;
  state.fixture_ids ??= [];
  state.conditions ??= {};
  state.incidents ??= {};
  state.recent_errors ??= [];
  return state;
}

function state(world) {
  history.assertWorld(world);
  const value = world.q4_phenomenon_ecology;
  if (value == null) return createState();
  if (!plainObject(value) || value.version !== VERSION || value.config_version !== config.version) invalidState("unsupported version or container shape");
  if (!Array.isArray(value.evaluated_locations) || !value.evaluated_locations.every((item) => typeof item === "string" && item.length > 0)) invalidState("evaluated_locations must contain location ids");
  if (!Array.isArray(value.eligibility_history) || !Array.isArray(value.fixture_ids) || !value.fixture_ids.every((item) => typeof item === "string") || !plainObject(value.conditions) || !plainObject(value.incidents) || !Array.isArray(value.recent_errors)) invalidState("current collections are malformed");
  if (value.last_instantiated_evaluation !== null && !plainObject(value.last_instantiated_evaluation)) invalidState("last_instantiated_evaluation is malformed");
  if (Object.hasOwn(value, "migrated_conservatively") && typeof value.migrated_conservatively !== "boolean") invalidState("migration marker is malformed");
  return value;
}

function ensureState(world) {
  history.assertWorld(world);
  world.phenomena ??= {};
  world.q4_phenomenon_ecology = normalizeState(world.q4_phenomenon_ecology);
  return world.q4_phenomenon_ecology;
}

function migrate(world, { existing_locations = null } = {}) {
  const legacy = world.q4_phenomenon_ecology;
  if (legacy?.version === VERSION) return state(world);
  if (legacy != null && (!plainObject(legacy) || !Object.hasOwn(legacy, "conditions") || !plainObject(legacy.conditions))) invalidState("legacy shape is malformed or ambiguous");
  if (legacy != null && Object.keys(legacy).some((key) => !["conditions", "evaluated_locations"].includes(key))) invalidState("legacy shape contains unrecognized fields");
  if (legacy != null && Object.hasOwn(legacy, "evaluated_locations") && (!Array.isArray(legacy.evaluated_locations) || !legacy.evaluated_locations.every((item) => typeof item === "string" && item.length > 0))) invalidState("legacy evaluated_locations is malformed");
  const value = createState({ migrated_conservatively:true });
  if (legacy != null) value.conditions = clone(legacy.conditions);
  if (legacy?.evaluated_locations) value.evaluated_locations = [...new Set(legacy.evaluated_locations)];
  else {
    const geography = existing_locations ?? spatialRuntime.canonicalDefinition(world.q4_geography, require("../data/worldpacks/clear-q4/spatial.json")).locations;
    // Existing geography is grandfathered as ordinary. Migration never invents
    // prior population, sightings, aliases, or incidents.
    value.evaluated_locations = [...new Set(geography.filter((item) => item?.id).map((item) => item.id))];
  }
  world.q4_phenomenon_ecology = value;
  return state(world);
}

function records(world) { history.assertWorld(world); return Object.values(world.phenomena ?? {}).filter((item) => item?.record_version === RECORD_VERSION); }
function record(world, id) { const item = world?.phenomena?.[id]; return item?.record_version === RECORD_VERSION ? item : null; }
function append(item, type, payload = {}, at = 0) { const entry = { sequence:item.history.length + 1, type, at, ...clone(payload) }; item.history.push(entry); item.last_known_state = { location_id:item.location_id, current_state:item.current_state, at }; return entry; }
function regionFor(location) { return location?.generation?.region_id ?? `depth-band-${Math.floor(Number(location?.generation?.depth ?? 0) / 4)}`; }
function locationDepth(location) { return Number(location?.generation?.depth ?? 0); }
function familyConfig(family) { return config.production.families.find((item) => item.id === family) ?? null; }
function familyCount(world, family) { return records(world).filter((item) => item.canonical_family === family && item.resolution_state !== "resolved").length; }
function regionCount(world, region) { return records(world).filter((item) => item.region_id === region && item.resolution_state !== "resolved").length; }
function totalCount(world) { return records(world).filter((item) => item.generation.mode === "production" && item.resolution_state !== "resolved").length; }

function deterministicProfile(world, locationId) {
  const ids = Object.keys(STILL_PROFILES);
  return ids[parseInt(digest([world.seed, config.version, "still-life-profile", locationId]).slice(0, 8), 16) % ids.length];
}

function baseRecord(world, { family, location_id, region_id, provenance, generation, profile_id = null, current_state = null, state_data = null }) {
  const id = stableId(world, family, location_id, provenance);
  const entity = ENTITY_FAMILIES.has(family);
  const profile = family === "STILL_LIFE" ? clone(STILL_PROFILES[profile_id ?? deterministicProfile(world, location_id)]) : family === "BACTERIA" ? { morphology:{ scale:"hulking", structure:"elongated stick-figure-like", colors:["red", "black"] }, movement_speed:2, perception:["visual-local", "acoustic-near"], mimicry:"acquired-human-speech", contact:["capture", "environmental-slam"] } : null;
  return {
    record_version:RECORD_VERSION, id, world_id:world.world_id, canonical_family:family, record_kind:entity ? "entity" : "phenomenon", location_id, region_id,
    activation_state:"active", existence_state:"instantiated", persistence_behavior:entity ? "persistent-entity" : (family === "ACOUSTIC_ANOMALY" ? "transient-event" : "persistent-until-resolved"),
    generation:clone(generation), provenance, visibility_rules:{ visible_range:"same-location", acoustic_range:["ACOUSTIC_ANOMALY", "BACTERIA"].includes(family) ? 1 : 0, requires_observation:true },
    environmental_dependencies:[], behavior_profile_id:family === "STILL_LIFE" ? (profile_id ?? deterministicProfile(world, location_id)) : family === "BACTERIA" ? "BACTERIA_CANONICAL" : null,
    behavior_profile:profile, current_state:current_state ?? (family === "STILL_LIFE" ? "SEATED_QUIET" : family === "BACTERIA" ? "DORMANT" : "ACTIVE"), state_data:clone(state_data ?? {}),
    observer_designations:{}, institutional_designation:null, aliases:[], evidence_ids:[], incident_ids:[], observation_history:[], interaction_history:[], movement_history:[], acoustic_history:[],
    last_known_state:null, resolution_state:"continuing", history:[]
  };
}

function instantiate(world, spec) {
  validateConfig(); const ecology = ensureState(world);
  if (!CANONICAL_FAMILIES.includes(spec.family)) return { ok:false, code:"PHENOMENON_FAMILY_INVALID" };
  const topology = spec.definition ?? spatialRuntime.canonicalDefinition(spec.spatial ?? world.q4_geography, require("../data/worldpacks/clear-q4/spatial.json"));
  const location = topology.locations.find((item) => item.id === spec.location_id);
  if (!location) return { ok:false, code:"PHENOMENON_LOCATION_UNKNOWN" };
  const provenance = spec.provenance ?? `${spec.generation?.mode ?? "production"}:${spec.location_id}`;
  const candidate = baseRecord(world, { ...spec, region_id:spec.region_id ?? regionFor(location), provenance, generation:spec.generation ?? { mode:"production", config_version:config.version } });
  if (world.phenomena[candidate.id]) return { ok:true, idempotent:true, phenomenon:clone(world.phenomena[candidate.id]) };
  if (candidate.generation.mode === "production") {
    const family = familyConfig(candidate.canonical_family);
    const entityCount = records(world).filter((item) => item.record_kind === "entity" && item.generation.mode === "production" && item.resolution_state !== "resolved").length;
    if (totalCount(world) >= config.production.world_cap) return { ok:false, code:"PHENOMENON_WORLD_CAP_REACHED" };
    if (regionCount(world, candidate.region_id) >= config.production.region_cap) return { ok:false, code:"PHENOMENON_REGION_CAP_REACHED" };
    if (family && familyCount(world, candidate.canonical_family) >= family.world_cap) return { ok:false, code:"PHENOMENON_FAMILY_CAP_REACHED" };
    if (candidate.record_kind === "entity" && entityCount >= config.production.entity_world_cap) return { ok:false, code:"PHENOMENON_ENTITY_CAP_REACHED" };
  }
  world.phenomena[candidate.id] = candidate;
  append(candidate, "instantiated", { provenance, location_id:spec.location_id }, spec.at ?? 0);
  if (candidate.generation.mode === "controlled-test-fixture") ecology.fixture_ids.push(candidate.id);
  history.event(world, spec.run_id ?? null, "q4.phenomenon.instantiated", { phenomenon_id:candidate.id, canonical_family:candidate.canonical_family, location_id:candidate.location_id, generation_mode:candidate.generation.mode }, "canonical-phenomenon-authority");
  return { ok:true, idempotent:false, phenomenon:clone(candidate) };
}

function instantiateFixture(world, spec, { control } = {}) {
  if (control !== FIXTURE_TOKEN) return { ok:false, code:"CONTROLLED_FIXTURE_DISABLED" };
  return instantiate(world, { ...spec, provenance:spec.provenance ?? `controlled-fixture:${spec.fixture_id ?? spec.family}:${spec.location_id}`, generation:{ mode:"controlled-test-fixture", fixture_id:spec.fixture_id ?? null, config_version:config.version } });
}

function eligibleFamily(world, location, evaluationIndex) {
  const depth = locationDepth(location);
  if (!location.generation || depth < config.production.minimum_generated_depth) return null;
  if (totalCount(world) >= config.production.world_cap) return null;
  const ecology = state(world);
  if (ecology.last_instantiated_evaluation != null && evaluationIndex - ecology.last_instantiated_evaluation < config.production.cooldown_location_evaluations) return null;
  const candidates = config.production.families.filter((item) => depth >= item.minimum_depth && familyCount(world, item.id) < item.world_cap && (!item.entity || records(world).filter((record) => record.record_kind === "entity" && record.generation.mode === "production").length < config.production.entity_world_cap));
  if (!candidates.length) return null;
  const roll = parseInt(digest([world.seed, config.version, "phenomenon-eligibility", location.id]).slice(0, 12), 16) % config.production.roll_denominator;
  let cursor = 0;
  for (const item of candidates) { cursor += item.weight; if (roll < cursor) return item.id; }
  return null;
}

function materializeEligible(world, { spatial = null, definition = null, at = 0 } = {}) {
  const ecology = ensureState(world); const topology = definition ?? spatialRuntime.canonicalDefinition(spatial ?? world.q4_geography, require("../data/worldpacks/clear-q4/spatial.json")); const created = [];
  const fresh = topology.locations.filter((location) => !ecology.evaluated_locations.includes(location.id)).sort((a,b) => a.id.localeCompare(b.id));
  for (const location of fresh) {
    ecology.evaluated_locations.push(location.id); const evaluationIndex = ecology.eligibility_history.length;
    const region = regionFor(location); let family = regionCount(world, region) >= config.production.region_cap ? null : eligibleFamily(world, location, evaluationIndex);
    if (family) { const result = instantiate(world, { family, location_id:location.id, region_id:region, spatial:spatial ?? world.q4_geography, definition:topology, at, provenance:`production:${config.version}:${location.id}`, generation:{ mode:"production", config_version:config.version, evaluation_index:evaluationIndex, world_seed_domain:"q4-phenomenon-eligibility" } }); if (result.ok && !result.idempotent) { created.push(result.phenomenon); ecology.last_instantiated_evaluation = evaluationIndex; } else family = null; }
    ecology.eligibility_history.push({ location_id:location.id, region_id:region, depth:locationDepth(location), result:family ? "instantiated" : "ordinary", phenomenon_id:created.at(-1)?.location_id === location.id ? created.at(-1).id : null });
  }
  return { ok:true, evaluated:fresh.length, created:clone(created), production_count:totalCount(world) };
}

function neighbors(topology, locationId, spatial = null) {
  return topology.connections.filter((edge) => !spatial?.blocked_paths?.[edge.id] && edge.lock_state !== "blocked" && (edge.from === locationId || (edge.bidirectional && edge.to === locationId))).map((edge) => ({ edge, location_id:edge.from === locationId ? edge.to : edge.from })).sort((a,b) => a.edge.id.localeCompare(b.edge.id));
}
function distance(topology, from, to, spatial = null) {
  if (from === to) return 0; const queue = [{ id:from, distance:0 }]; const seen = new Set([from]);
  while (queue.length) { const current = queue.shift(); for (const next of neighbors(topology, current.id, spatial)) { if (seen.has(next.location_id)) continue; if (next.location_id === to) return current.distance + 1; seen.add(next.location_id); queue.push({ id:next.location_id, distance:current.distance + 1 }); } }
  return Infinity;
}
function routeStep(topology, from, to, spatial = null) { return neighbors(topology, from, spatial).map((next) => ({ ...next, remaining:distance(topology, next.location_id, to, spatial) })).sort((a,b) => a.remaining - b.remaining || a.edge.id.localeCompare(b.edge.id))[0] ?? null; }
function move(item, to, edge, at, cause) { const from = item.location_id; item.location_id = to; item.movement_history.push({ from, to, connection_id:edge.id, at, cause }); append(item, "moved", { from, to, connection_id:edge.id, cause }, at); }

function visible(item, context) {
  if (item.activation_state !== "active" || item.location_id !== context.location_id) return false;
  if (context.visibility === "limited" && !context.has_field_light && item.record_kind === "entity" && item.current_state !== "VOCALIZING") return false;
  return true;
}
function designation(item) {
  if (item.canonical_family === "STILL_LIFE") {
    if (["FLEEING", "APPROACHING", "AGGRESSIVE_CONTACT"].includes(item.current_state)) return "UNIDENTIFIED MOBILE ENTITY";
    if (["VOCALIZING", "SCREAMING"].includes(item.current_state)) return "DISTRESSED HUMANOID FORM";
  }
  return config.observer_designations[item.canonical_family] ?? "UNIDENTIFIED CONDITION";
}
function observedProperties(item) {
  if (item.canonical_family === "BACTERIA") return ["hulking scale", "elongated stick-figure-like structure", "red-and-black coloration", ...(item.current_state === "PURSUING" ? ["rapid movement"] : [])];
  if (item.canonical_family === "STILL_LIFE") return [item.behavior_profile?.breathing ? "visible breathing" : "no visible breathing", item.current_state.toLowerCase().replace(/_/g, " ")];
  return [designation(item).toLowerCase()];
}
function safeProjection(item, observer) {
  const observation = item.observer_designations[observer]; if (!observation) return null;
  const knownAlias = item.aliases.find((alias) => alias.known_by.includes(observer));
  return { observation_ref:observation.observation_ref, designation:knownAlias?.value ?? observation.designation, formal_designation:observation.designation, description:observation.description, observed_properties:clone(observation.observed_properties), current_visible_state:observation.current_visible_state, alias:knownAlias?.value ?? null, evidence_ids:item.evidence_ids.filter((id) => observation.evidence_ids?.includes(id)) };
}
function observe(world, { run = null, observer, location_id, co_observers = [], has_field_light = false, visibility = null } = {}) {
  const env = run?.spatial?.environment ? environment.observation(run.spatial.environment, location_id, { has_field_light }) : null; const effectiveVisibility = visibility ?? env?.visibility ?? "normal"; const at = now(run); const seen = [];
  for (const item of records(world).filter((entry) => visible(entry, { location_id, visibility:effectiveVisibility, has_field_light }))) {
    for (const witness of [observer, ...co_observers]) {
      const prior = item.observer_designations[witness]; const value = { observation_ref:prior?.observation_ref ?? `observation-${digest([item.id, witness]).slice(0, 16)}`, designation:designation(item), description:designation(item).toLowerCase(), observed_properties:observedProperties(item), current_visible_state:item.current_state, first_observed_at:prior?.first_observed_at ?? at, last_observed_at:at, location_id, evidence_ids:prior?.evidence_ids ?? [], provenance:"direct-observation" };
      item.observer_designations[witness] = value; item.observation_history.push({ observer:witness, at, location_id, designation:value.designation, properties:clone(value.observed_properties) });
    }
    append(item, "observed", { observers:[observer, ...co_observers], location_id }, at); seen.push(safeProjection(item, observer));
  }
  return { version:"yellow-beast-q4-phenomenon-observation@v1", observations:seen.filter(Boolean) };
}
function projection(world, { observer, location_id } = {}) { return records(world).filter((item) => item.location_id === location_id && item.observer_designations[observer]).map((item) => safeProjection(item, observer)); }
function resolveObservedTarget(world, { observer, location_id, target } = {}) { const query = String(target ?? "").toLowerCase(); return records(world).find((item) => item.location_id === location_id && item.observer_designations[observer] && [item.observer_designations[observer].designation, ...item.aliases.filter((alias) => alias.known_by.includes(observer)).map((alias) => alias.value)].some((name) => query.includes(String(name).toLowerCase()))) ?? null; }

function coinAlias(world, id, { alias, originator, informed_observers = [], at = 0, provenance = "encounter-local-speech" } = {}) {
  const item = record(world, id); const value = String(alias ?? "").trim().slice(0, 80);
  if (!item || !value || !item.observer_designations[originator]) return { ok:false, code:"ALIAS_PROVENANCE_INVALID" };
  const known = [...new Set([originator, ...informed_observers.filter((observer) => item.observer_designations[observer])])]; const existing = item.aliases.find((entry) => entry.value.toLowerCase() === value.toLowerCase());
  if (existing) { existing.known_by = [...new Set([...existing.known_by, ...known])]; return { ok:true, idempotent:true, alias:clone(existing) }; }
  const entry = { id:`alias-${digest([item.id, value, originator]).slice(0, 16)}`, value, originator, coined_at:at, provenance, known_by:known, institutionalized:false };
  item.aliases.push(entry); append(item, "alias-coined", { alias_id:entry.id, originator, known_by:known }, at); return { ok:true, alias:clone(entry) };
}

function deliverReport(world, id, { observer, message_id, summary = null, include_alias = false, at = 0 } = {}) {
  const item = record(world, id); const observation = item?.observer_designations?.[observer]; if (!item || !observation || !message_id) return { ok:false, code:"PHENOMENON_REPORT_INVALID" };
  const alias = include_alias ? item.aliases.find((entry) => entry.known_by.includes(observer)) : null;
  item.institutional_designation = { designation:observation.designation, summary:String(summary ?? observation.description).slice(0, 240), source_observer:observer, message_id, received_at:at, alias:alias?.value ?? null };
  if (alias) { alias.known_by = [...new Set([...alias.known_by, "Standard"])]; alias.institutionalized = false; }
  const ecology = ensureState(world); const conditionId = `phenomenon-report:${item.id}`; ecology.conditions[conditionId] = { id:conditionId, type:"reported-phenomenon", phenomenon_id:item.id, designation:observation.designation, location_id:observation.location_id, status:"unresolved", institutional_available:true, message_id, reported_at:at };
  append(item, "reported", { observer, message_id, designation:observation.designation, alias:alias?.value ?? null }, at); return { ok:true, condition:clone(ecology.conditions[conditionId]), institutional_designation:clone(item.institutional_designation) };
}
function assignmentConditions(world) { return Object.values(state(world).conditions).filter((item) => item.status === "unresolved" && item.institutional_available).map(({ phenomenon_id, ...item }) => clone(item)); }
function resolveCondition(world, conditionId, { work_order_id = null } = {}) { const condition=ensureState(world).conditions[conditionId];if(!condition)return{ok:false,code:"PHENOMENON_CONDITION_UNKNOWN"};condition.status="resolved";condition.resolved_by=work_order_id;return{ok:true,condition:clone(condition)}; }

function linkEvidence(world, id, { observer, evidence_id } = {}) { const item = record(world, id); const evidence = world?.q4_evidence_archive?.records?.[evidence_id]; if (!item || !item.observer_designations[observer] || !evidence) return { ok:false, code:"PHENOMENON_EVIDENCE_INVALID" }; if (!item.evidence_ids.includes(evidence_id)) item.evidence_ids.push(evidence_id); const observation = item.observer_designations[observer]; if (!observation.evidence_ids.includes(evidence_id)) observation.evidence_ids.push(evidence_id); append(item, "evidence-linked", { observer, evidence_id }, evidence.timestamp?.interval ?? 0); return { ok:true }; }
function establishEvidenceInconsistency(world, id, { evidence_a, evidence_b, basis = "canonical recorded discrepancy" } = {}) { const item = record(world, id); if (!item || item.canonical_family !== "EVIDENCE_INCONSISTENCY") return { ok:false, code:"EVIDENCE_INCONSISTENCY_INVALID" }; const result = evidenceAuthority.contradict(world, { left:evidence_a, right:evidence_b, claim:basis, source:`phenomenon:${id}` }); if (result.ok) { for (const evidenceId of [evidence_a,evidence_b]) if (!item.evidence_ids.includes(evidenceId)) item.evidence_ids.push(evidenceId); append(item, "evidence-inconsistency-established", { evidence_a,evidence_b, contradiction_id:result.contradiction?.id }, 0); } return result; }

function applySpatialState(world, id, { spatial, definition, effect, at = 0 } = {}) { const item = record(world,id); if (!item || !["SPATIAL_INCONSISTENCY","TRANSIENT_ARCHITECTURE"].includes(item.canonical_family)) return { ok:false, code:"PHENOMENON_SPATIAL_INVALID" }; const result = spatialRuntime.applyPhenomenonState(spatial, definition, { phenomenon_id:id, family:item.canonical_family, location_id:item.location_id, ...effect, at }); if (result.ok) { item.state_data.spatial_effect = clone(result.effect); append(item, "spatial-state-applied", { effect:result.effect }, at); } return result; }
function displaceObject(world, id, { object_state, definition, spatial, object_id, to_location, at = 0 } = {}) { const item = record(world,id); if (!item || item.canonical_family !== "OBJECT_DISPLACEMENT") return { ok:false, code:"PHENOMENON_OBJECT_INVALID" }; const allowed=spatialRuntime.canonicalDefinition(spatial??world.q4_geography,require("../data/worldpacks/clear-q4/spatial.json")).locations.map((location)=>location.id); const result = objectRuntime.relocate(object_state, definition, { object_id, to_location, allowed_locations:allowed, cause:`phenomenon:${id}`, at }); if (result.ok) { item.state_data.object_displacement = { object_id, from_location:result.from_location, to_location }; append(item,"object-displaced",item.state_data.object_displacement,at); } return result; }
function applyEnvironmentalDiscontinuity(world,id,{environment_state,patch,at=0}={}) { const item=record(world,id); if(!item||item.canonical_family!=="ENVIRONMENTAL_DISCONTINUITY") return {ok:false,code:"PHENOMENON_ENVIRONMENT_INVALID"}; const result=environment.setPhenomenonOverride(environment_state,item.location_id,id,patch,{at,source:`phenomenon:${id}`}); if(result.ok){item.state_data.environment_override=clone(patch);append(item,"environment-discontinuity-applied",{patch},at);} return result; }
function emitAcousticAnomaly(world,run,id,{observers=[],description="an unexplained sound"}={}) { const item=record(world,id);if(!item||item.canonical_family!=="ACOUSTIC_ANOMALY")return{ok:false,code:"ACOUSTIC_ANOMALY_UNKNOWN"};const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const at=now(run);const heard_by=observers.filter((observer)=>{const location=run.spatial.personnel_locations[observer];return location&&distance(topology,item.location_id,location,run.spatial)<=1&&!(environment.current(run.spatial.environment,location)?.acoustic==="masked"&&location!==item.location_id);});const acoustic={id:`acoustic-${digest([id,at,item.acoustic_history.length]).slice(0,16)}`,source_state:item.state_data.source_state??"unresolved",location_id:item.location_id,affected_location_ids:[item.location_id,...neighbors(topology,item.location_id,run.spatial).map((next)=>next.location_id)],description:String(description).slice(0,160),heard_by,at};item.acoustic_history.push(acoustic);item.state_data.last_acoustic_event=acoustic.id;append(item,"acoustic-event",{acoustic_event_id:acoustic.id,heard_by},at);return{ok:true,event:{id:acoustic.id,description:acoustic.description,source_attribution:"uncertain",heard_by,at}}; }

function perceiveStimulus(item, run, stimulus) { const same = stimulus.actor_location === item.location_id; if (stimulus.kind === "physical-interference") return same; if (stimulus.kind === "approach") return same && item.behavior_profile.perception.includes("visual-near"); if (stimulus.kind === "sound") return same && item.behavior_profile.perception.includes("acoustic-local"); return false; }
function stillLifeStimulus(world, run, id, stimulus = {}) {
  const item=record(world,id); if(!item||item.canonical_family!=="STILL_LIFE") return {ok:false,code:"STILL_LIFE_UNKNOWN"}; const at=now(run); if(!perceiveStimulus(item,run,stimulus)){append(item,"stimulus-unperceived",{kind:stimulus.kind},at);return {ok:true,perceived:false,changed:false,state:item.current_state};}
  const response=stimulus.kind==="physical-interference"?item.behavior_profile.physical_interference_response:item.behavior_profile.approach_response; let changed=false;
  if(response==="none"||response==="minimal") append(item,"stimulus-no-material-response",{kind:stimulus.kind,response},at);
  else if(response==="vocalize"||response==="fear"){item.current_state="VOCALIZING";changed=true;item.acoustic_history.push({type:"distressed-vocalization",at,location_id:item.location_id});}
  else if(response==="flee"){item.current_state="FLEEING";const topology=spatialRuntime.canonicalDefinition(run.spatial, require("../data/worldpacks/clear-q4/spatial.json"));const next=neighbors(topology,item.location_id,run.spatial)[0];if(next)move(item,next.location_id,next.edge,at,"profile-directed-flight");changed=true;}
  else if(response==="approach"){item.current_state="APPROACHING";changed=true;}
  else if(response==="light-interaction"){const current=environment.current(run.spatial.environment,item.location_id);const to=current?.lighting==="dark"?"dim":"dark";const result=environment.mutateLocation(run.spatial.environment,item.location_id,{lighting:to},{at,source:`entity:${id}:lamp-interaction`});if(result.ok){item.current_state="LIGHT_INTERACTION";item.state_data.last_environment_event=result.event.id;changed=true;}}
  else if(response==="hazard-seeking"){item.current_state="HAZARD_SEEKING";const topology=spatialRuntime.canonicalDefinition(run.spatial, require("../data/worldpacks/clear-q4/spatial.json"));const target=stimulus.hazard_location_id;const next=target?routeStep(topology,item.location_id,target,run.spatial):neighbors(topology,item.location_id,run.spatial)[0];if(next)move(item,next.location_id,next.edge,at,"self-directed-hazard-movement");if(target&&item.location_id===target){item.current_state="ENTERED_HAZARD";item.state_data.hazard_location_id=target;}changed=true;}
  if(changed)append(item,"still-life-response",{kind:stimulus.kind,response,state:item.current_state},at); return {ok:true,perceived:true,changed,state:item.current_state,location_id:item.location_id};
}

function recordSpeech(world,run,{speaker,text,location_id}={}) { const phrase=String(text??"").trim().slice(0,240); if(!phrase)return[]; const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const at=now(run);const acquired=[];for(const item of records(world).filter((entry)=>entry.canonical_family==="BACTERIA"&&distance(topology,entry.location_id,location_id,run.spatial)<=1)){const acoustic=environment.current(run.spatial.environment,item.location_id)?.acoustic;if(acoustic==="masked"&&item.location_id!==location_id)continue;item.state_data.acquired_phrases??=[];const phraseId=`phrase-${digest([item.id,speaker,phrase,at]).slice(0,16)}`;if(!item.state_data.acquired_phrases.some((entry)=>entry.id===phraseId))item.state_data.acquired_phrases.push({id:phraseId,speaker,text:phrase,heard_at:at,location_id});append(item,"speech-acquired",{phrase_id:phraseId,speaker,location_id},at);acquired.push(phraseId);}return acquired; }
function bacteriaMimic(world,run,id,{observers=[]}={}) { const item=record(world,id);if(!item||item.canonical_family!=="BACTERIA")return{ok:false,code:"BACTERIA_UNKNOWN"};const phrases=item.state_data.acquired_phrases??[];if(!phrases.length)return{ok:false,code:"MIMICRY_NO_ACQUIRED_SPEECH"};const at=now(run);const phrase=phrases[parseInt(digest([item.id,"mimic",item.acoustic_history.length]).slice(0,8),16)%phrases.length];const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const heardBy=observers.filter((observer)=>{const location=run.spatial.personnel_locations[observer];return location&&distance(topology,item.location_id,location,run.spatial)<=1&&!(environment.current(run.spatial.environment,location)?.acoustic==="masked"&&location!==item.location_id);});const event={id:`acoustic-${digest([item.id,phrase.id,at,item.acoustic_history.length]).slice(0,16)}`,source_id:item.id,source_type:"canonical-entity",phrase_id:phrase.id,text:phrase.text,location_id:item.location_id,heard_by:heardBy,at};item.acoustic_history.push(event);append(item,"mimicry",{acoustic_event_id:event.id,phrase_id:phrase.id,heard_by:heardBy},at);return{ok:true,event:{id:event.id,text:event.text,source_attribution:"uncertain",heard_by:heardBy,at}}; }
function acquireBacteria(world,run,id,{target_id,signal="visual"}={}) { const item=record(world,id);if(!item||item.canonical_family!=="BACTERIA")return{ok:false,code:"BACTERIA_UNKNOWN"};const targetLocation=run.spatial.personnel_locations[target_id];if(!targetLocation)return{ok:false,code:"BACTERIA_TARGET_UNKNOWN"};const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const range=signal==="visual"?0:1;if(distance(topology,item.location_id,targetLocation,run.spatial)>range)return{ok:false,code:"BACTERIA_TARGET_UNPERCEIVED"};if(signal==="acoustic"&&environment.current(run.spatial.environment,item.location_id)?.acoustic==="masked"&&item.location_id!==targetLocation)return{ok:false,code:"BACTERIA_TARGET_MASKED"};item.current_state="ACQUIRED";item.state_data.target={personnel_id:target_id,last_perceived_location:targetLocation,signal,acquired_at:now(run)};append(item,"target-acquired",item.state_data.target,now(run));return{ok:true}; }
function bacteriaPursue(world,run,id) { const item=record(world,id);if(!item||item.canonical_family!=="BACTERIA")return{ok:false,code:"BACTERIA_UNKNOWN"};const target=item.state_data.target;if(!target)return{ok:false,code:"BACTERIA_NO_TARGET"};const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const actual=run.spatial.personnel_locations[target.personnel_id];if(actual&&distance(topology,item.location_id,actual,run.spatial)<=1)target.last_perceived_location=actual;item.current_state="PURSUING";const moves=[];for(let step=0;step<item.behavior_profile.movement_speed;step++){if(item.location_id===target.last_perceived_location)break;const next=routeStep(topology,item.location_id,target.last_perceived_location,run.spatial);if(!next||!Number.isFinite(next.remaining))break;move(item,next.location_id,next.edge,now(run),"high-speed-pursuit");moves.push(next.edge.id);}if(actual===item.location_id)return bacteriaCapture(world,run,id,{target_id:target.personnel_id,moves});append(item,"pursuit-advanced",{moves,target_last_perceived_location:target.last_perceived_location},now(run));return{ok:true,state:item.current_state,moves,location_id:item.location_id,captured:false}; }
function bacteriaCapture(world,run,id,{target_id,moves=[]}={}) { const item=record(world,id);const targetLocation=run.spatial.personnel_locations[target_id];if(!item||item.canonical_family!=="BACTERIA"||targetLocation!==item.location_id)return{ok:false,code:"BACTERIA_CAPTURE_PROXIMITY_INVALID"};item.current_state="CAPTURED_PERSONNEL";item.state_data.capture={personnel_id:target_id,location_id:item.location_id,captured_at:now(run),restrained:true};run.expedition.phenomenon_contact??={captures:{},history:[]};run.expedition.phenomenon_contact.captures[target_id]={phenomenon_id:id,location_id:item.location_id,state:"restrained",at:now(run)};run.expedition.phenomenon_contact.history.push({type:"capture",personnel_id:target_id,location_id:item.location_id,at:now(run)});append(item,"personnel-captured",{personnel_id:target_id,location_id:item.location_id,moves},now(run));return{ok:true,state:item.current_state,moves,location_id:item.location_id,captured:true,target_id}; }
function isCaptured(world,personnelId) { return records(world).some((item)=>item.canonical_family==="BACTERIA"&&item.state_data.capture?.personnel_id===personnelId&&item.state_data.capture.restrained); }
function bacteriaSlam(world,run,id,{surface_id=null,witnesses=[]}={}) { const item=record(world,id);const capture=item?.state_data?.capture;if(!item||item.canonical_family!=="BACTERIA"||!capture?.restrained)return{ok:false,code:"BACTERIA_SLAM_CAPTURE_REQUIRED"};const topology=spatialRuntime.canonicalDefinition(run.spatial,require("../data/worldpacks/clear-q4/spatial.json"));const location=topology.locations.find((entry)=>entry.id===item.location_id);if(!location)return{ok:false,code:"BACTERIA_SLAM_SURFACE_UNAVAILABLE"};const surface=surface_id??location.landmarks?.[0]?.name??`${location.type} structural surface`;const member=run.expedition.team.members.find((entry)=>(entry.personnel_id??entry.id)===capture.personnel_id);const next=String(member?.condition).toLowerCase()==="serious injury"?"incapacitated":"serious injury";const consequence=consequenceRuntime.apply(run,{source:`entity-physical-action:${id}`,classification:"phenomenon-contact",effects:[{kind:"personnel-condition",target:capture.personnel_id,condition:next,status:"unavailable",reason:`captured personnel impacted ${surface}`}],observable_to:witnesses.filter((observer)=>run.spatial.personnel_locations[observer]===item.location_id),public_summary:"A captured worker was driven into a nearby structural surface."});if(!consequence.ok)return consequence;const incidentId=`incident-${digest([id,capture.personnel_id,surface,now(run),item.incident_ids.length]).slice(0,16)}`;const incident={id:incidentId,type:"entity-environment-impact",phenomenon_id:id,personnel_id:capture.personnel_id,location_id:item.location_id,surface,consequence_id:consequence.consequence.id,witnesses:consequence.consequence.observable_to,at:now(run)};ensureState(world).incidents[incidentId]=incident;item.incident_ids.push(incidentId);item.current_state="RESTRAINING";append(item,"environmental-slam",incident,now(run));return{ok:true,incident:clone(incident),consequence:consequence.consequence}; }

function advance(world,run,{action="WAIT"}={}) { const updates=[];for(const item of records(world)){if(item.canonical_family==="BACTERIA"&&["ACQUIRED","PURSUING"].includes(item.current_state)){const result=bacteriaPursue(world,run,item.id);if(result.ok)updates.push({phenomenon_id:item.id,type:"bacteria-pursuit",result});}else if(item.canonical_family==="STILL_LIFE"&&item.current_state==="APPROACHING"&&item.behavior_profile.aggression==="contact"){const target=run.session.startup.player.observer_id;const targetLocation=run.spatial.personnel_locations[target];if(targetLocation===item.location_id){const consequence=consequenceRuntime.apply(run,{source:`still-life-contact:${item.id}`,classification:"phenomenon-contact",effects:[{kind:"personnel-condition",target,condition:"minor injury",status:"active",reason:"physical contact with an unidentified form"}],observable_to:Object.entries(run.spatial.personnel_locations).filter(([,loc])=>loc===item.location_id).map(([id])=>id),public_summary:"Physical contact with an unidentified form caused a personnel injury."});if(consequence.ok){item.current_state="AGGRESSIVE_CONTACT";append(item,"aggressive-contact",{consequence_id:consequence.consequence.id},now(run));updates.push({phenomenon_id:item.id,type:"still-life-contact"});}}}}return updates; }

function diagnostics(world,{developer=false}={}) { const items=records(world);const safe={version:VERSION,config_version:config.version,recent_errors:clone(state(world).recent_errors.slice(-5))};if(!developer)return safe;return{...safe,instantiated_count:items.length,counts_by_family:Object.fromEntries(CANONICAL_FAMILIES.map((family)=>[family,items.filter((item)=>item.canonical_family===family).length])),production_count:items.filter((item)=>item.generation.mode==="production").length,fixture_count:items.filter((item)=>item.generation.mode==="controlled-test-fixture").length,evaluated_location_count:state(world).evaluated_locations.length,deterministic_test_seed:"pass-16b-controlled",controlled_fixture_status:"token-gated"}; }

module.exports = { VERSION, RECORD_VERSION, FIXTURE_TOKEN, CANONICAL_FAMILIES, STILL_PROFILES, config, validateConfig, createState, currentState, state, ensureState, migrate, records, record, materializeEligible, instantiate, instantiateFixture, observe, projection, resolveObservedTarget, coinAlias, deliverReport, assignmentConditions, resolveCondition, linkEvidence, establishEvidenceInconsistency, applySpatialState, displaceObject, applyEnvironmentalDiscontinuity, emitAcousticAnomaly, stillLifeStimulus, recordSpeech, bacteriaMimic, acquireBacteria, bacteriaPursue, bacteriaCapture, bacteriaSlam, isCaptured, advance, diagnostics, distance };
