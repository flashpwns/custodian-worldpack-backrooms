"use strict";
const crypto = require("node:crypto"); const fs = require("node:fs"); const path = require("node:path");
const VERSION = "yellow-beast-world-history@v1";
const CURRENT_SHAPE_VERSION = "yellow-beast-canonical-world-shape@v1";
const STORAGE_MIGRATION_ID = "yellow-beast-storage-migration@v1-to-canonical-shape-v1";
const MAX_CANONICAL_ARRAY_LENGTH = 1_000_000;
const CHARACTER_STATUSES = new Set(["active", "unavailable", "missing", "unknown", "retired", "removed", "dead"]);
const CHARACTER_CONDITIONS = new Set(["normal", "uninjured", "minor injury", "serious injury", "incapacitated", "missing", "dead", "stabilized minor injury", "recovering", "deceased"]);
const clone = (value) => structuredClone(value); const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function canonicalValueError(code, path, reason) { return Object.assign(new Error(`invalid canonical value at ${path}: ${reason}`), { code }); }
function isArrayIndexKey(key) {
  if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF && String(index) === key;
}
function assertCanonicalJsonValue(value, { code = "CANONICAL_JSON_INVALID", path = "$", stack = new Set() } = {}) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value) || Object.is(value, -0)) throw canonicalValueError(code, path, "number is not losslessly JSON-representable"); return value; }
  if (typeof value !== "object") throw canonicalValueError(code, path, `${typeof value} is not supported`);
  if (stack.has(value)) throw canonicalValueError(code, path, "cyclic reference is not supported");
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw canonicalValueError(code, path, "custom array instances are not supported");
      if (Object.getOwnPropertySymbols(value).length) throw canonicalValueError(code, path, "symbol properties are not supported");
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.configurable || lengthDescriptor.writable !== true || !("value" in lengthDescriptor) || lengthDescriptor.value !== value.length) throw canonicalValueError(code, `${path}.length`, "invalid array length descriptor");
      if (value.length > MAX_CANONICAL_ARRAY_LENGTH) throw canonicalValueError(code, `${path}.length`, "array exceeds the canonical serialization limit");
      for (const key of Object.getOwnPropertyNames(value)) if (key !== "length" && !isArrayIndexKey(key)) throw canonicalValueError(code, `${path}.${key}`, "array properties outside valid indexed values are not supported");
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw canonicalValueError(code, `${path}[${index}]`, "sparse array slots are not supported");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || descriptor.writable !== true || descriptor.configurable !== true || !("value" in descriptor)) throw canonicalValueError(code, `${path}[${index}]`, "nonstandard array value descriptors are not supported");
        assertCanonicalJsonValue(descriptor.value, { code, path:`${path}[${index}]`, stack });
      }
      return value;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) throw canonicalValueError(code, path, "only plain objects are supported");
    if (Object.getOwnPropertySymbols(value).length) throw canonicalValueError(code, path, "symbol properties are not supported");
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.writable !== true || descriptor.configurable !== true || !("value" in descriptor)) throw canonicalValueError(code, `${path}.${key}`, "nonstandard properties and accessors are not supported");
      assertCanonicalJsonValue(descriptor.value, { code, path:`${path}.${key}`, stack });
    }
    return value;
  } finally { stack.delete(value); }
}
function canonicalJson(value, { code = "CANONICAL_JSON_INVALID" } = {}) { assertCanonicalJsonValue(value, { code }); return JSON.parse(JSON.stringify(value)); }
function canonicalEventPayload(value) {
  const stack = new Set();
  function visit(item, path, undefinedRule = "reject") {
    if (item === undefined) {
      if (undefinedRule === "omit") return undefined;
      if (undefinedRule === "null") return null;
      throw canonicalValueError("CANONICAL_JSON_INVALID", path, "undefined is supported only as an omitted object property or null array slot");
    }
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? (Object.is(item, -0) ? 0 : item) : null;
    if (typeof item !== "object") throw canonicalValueError("CANONICAL_JSON_INVALID", path, `${typeof item} is not supported`);
    if (stack.has(item)) throw canonicalValueError("CANONICAL_JSON_INVALID", path, "cyclic reference is not supported");
    stack.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) throw canonicalValueError("CANONICAL_JSON_INVALID", path, "custom array instances are not supported");
        if (Object.getOwnPropertySymbols(item).length) throw canonicalValueError("CANONICAL_JSON_INVALID", path, "symbol properties are not supported");
        const lengthDescriptor = Object.getOwnPropertyDescriptor(item, "length");
        if (!lengthDescriptor || lengthDescriptor.enumerable || lengthDescriptor.configurable || lengthDescriptor.writable !== true || !("value" in lengthDescriptor) || lengthDescriptor.value !== item.length) throw canonicalValueError("CANONICAL_JSON_INVALID", `${path}.length`, "invalid array length descriptor");
        if (item.length > MAX_CANONICAL_ARRAY_LENGTH) throw canonicalValueError("CANONICAL_JSON_INVALID", `${path}.length`, "array exceeds the canonical serialization limit");
        for (const key of Object.getOwnPropertyNames(item)) if (key !== "length" && !isArrayIndexKey(key)) throw canonicalValueError("CANONICAL_JSON_INVALID", `${path}.${key}`, "array properties outside valid indexed values are not supported");
        const result = [];
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.hasOwn(item, index)) { result.push(null); continue; }
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor?.enumerable || descriptor.writable !== true || descriptor.configurable !== true || !("value" in descriptor)) throw canonicalValueError("CANONICAL_JSON_INVALID", `${path}[${index}]`, "nonstandard array value descriptors are not supported");
          result.push(visit(descriptor.value, `${path}[${index}]`, "null"));
        }
        return result;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw canonicalValueError("CANONICAL_JSON_INVALID", path, "only plain objects are supported");
      if (Object.getOwnPropertySymbols(item).length) throw canonicalValueError("CANONICAL_JSON_INVALID", path, "symbol properties are not supported");
      const result = {};
      for (const key of Object.getOwnPropertyNames(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || descriptor.writable !== true || descriptor.configurable !== true || !("value" in descriptor)) throw canonicalValueError("CANONICAL_JSON_INVALID", `${path}.${key}`, "nonstandard properties and accessors are not supported");
        const normalized = visit(descriptor.value, `${path}.${key}`, "omit");
        if (normalized !== undefined) Object.defineProperty(result, key, { value:normalized, enumerable:true, writable:true, configurable:true });
      }
      return result;
    } finally { stack.delete(item); }
  }
  return visit(value, "$payload");
}
const GENERATOR_V1 = "yellow-beast-complex-generator@v1";
const GENERATOR_V2 = "yellow-beast-complex-generator@v2";
const SUPPORTED_GENERATORS = new Set([GENERATOR_V1, GENERATOR_V2]);
function generatorVersion(region) {
  const version = region?.generator_version ?? (region?.state?.version === GENERATOR_V1 ? GENERATOR_V1 : null);
  if (!SUPPORTED_GENERATORS.has(version)) throw Object.assign(new Error(`unsupported generator version: ${version ?? "missing"}`), { code: "GENERATOR_VERSION_UNSUPPORTED" });
  return version;
}
function assertRegion(region) {
  const version = generatorVersion(region);
  if (!region?.id || !region?.region_seed || !region?.state?.nodes || !region?.state?.edges) throw Object.assign(new Error("invalid persistent region"), { code: "REGION_STATE_INVALID" });
  for (const edge of Object.values(region.state.edges)) if (!region.state.nodes[edge.from] || (edge.to && !region.state.nodes[edge.to])) throw Object.assign(new Error("persistent edge references missing node"), { code: "REGION_GRAPH_INVALID" });
  if (version === GENERATOR_V2 && region.state.version !== GENERATOR_V2) throw Object.assign(new Error("v2 region state/version mismatch"), { code: "REGION_VERSION_MISMATCH" });
  return version;
}
function createWorld({ id = null, seed = "yellow-beast-world" } = {}) { const world_id = id ?? `world-${digest(["world", seed]).slice(0, 12)}`; return { version: VERSION, canonical_shape_version:CURRENT_SHAPE_VERSION, storage_migrations:[], world_id, seed, next_run: 1, event_sequence: 0, runs: {}, regions: {}, evidence: {}, artifacts: {}, characters: {}, phenomena: {}, q4_phenomenon_ecology:require("./q4-phenomenon-ecology").currentState(), q4_evidence_archive:require("./q4-evidence-authority").createState(), q4_career_state:require("./q4-career-loop").createState(), q4_missions: {}, q4_reviews: {}, q4_scars: {}, q4_knowledge: {}, q4_geography: null, q4_survey_frontier: null, q4_object_state: null, q4_operations: { institutional_time: 0, last_review: null }, q4_lifecycle:{ version:"yellow-beast-q4-outcome-authority@v1", status:"ACTIVE", immutable_write_rejections:0, final_incident:null, retirement_transaction:null }, q4_legacy_personnel:{}, events: [], knowledge: { institutional: { records: {} }, civilian: { records: {} } } }; }
function assertWorld(world) { if (!world || world.version !== VERSION || !world.world_id) throw Object.assign(new Error("unsupported world history"), { code: "WORLD_VERSION_UNSUPPORTED" }); return world; }
function event(world, run_id, type, payload, authority = "pack-original-world-history") { const material = canonicalEventPayload(payload); const sequence = ++world.event_sequence; const id = `history-${digest([world.world_id, sequence, run_id, type, material]).slice(0, 16)}`; const record = { id, world_id: world.world_id, run_id, sequence, type, payload: material, authority, provenance: "yellow-beast-structured-result" }; world.events.push(record); return record; }
function beginRun(world, { profile, scenario, seed }) { assertWorld(world); const ordinal = world.next_run++; const run_id = `run-${digest([world.world_id, ordinal, profile, scenario, seed]).slice(0, 16)}`; world.runs[run_id] = { id: run_id, world_id: world.world_id, ordinal, profile, scenario, seed, status: "active", history_ingested: false }; event(world, run_id, "run.started", { profile, scenario, seed }); return run_id; }
function regionId(state) { return `region-${digest([state.version, state.region_seed]).slice(0, 16)}`; }
function promoteRegion(world, run_id, state) { if (!state) return null; if (!SUPPORTED_GENERATORS.has(state.version)) throw Object.assign(new Error("unsupported generator version"), { code: "GENERATOR_VERSION_UNSUPPORTED" }); const id = regionId(state); const existing = world.regions[id]; if (existing && (existing.generator_version !== state.version || existing.region_seed !== state.region_seed)) throw Object.assign(new Error("conflicting region materialization"), { code: "REGION_CONFLICT" }); if (!existing) { world.regions[id] = { id, generator_version: state.version, region_seed: state.region_seed, first_materialized_by: run_id, baseline_state: clone(state), state: clone(state), discovery: [], provenance: { grammar_rule_ids: Object.values(state.nodes).map((node) => node.grammar_rule_id).sort(), authorities: [...new Set(Object.values(state.nodes).map((node) => node.authority))] } }; event(world, run_id, "region.materialized", { region_id: id, generator_version: state.version }); }
  const region = world.regions[id]; const observer = Object.keys(state.discovery)[0]; const discovered = state.discovery[observer]?.spaces ?? []; for (const space_id of discovered) if (!region.discovery.some((entry) => entry.run_id === run_id && entry.space_id === space_id)) { region.discovery.push({ run_id, space_id, domain: "observer-local" }); event(world, run_id, "region.discovered", { region_id: id, space_id }, "scenario-optional"); } return id; }
function recordInstitutional(world, run_id, id, payload) { if (world.knowledge.institutional.records[id]) return; world.knowledge.institutional.records[id] = { id, source_run: run_id, status: "archived-operational", payload: clone(payload) }; event(world, run_id, "institutional.record.archived", { record_id: id }); }
function recordQ4Mission(world, run_id, mission) { assertWorld(world); world.q4_missions ??= {}; if (world.q4_missions[mission.id]) return { ok: true, idempotent: true, mission: clone(world.q4_missions[mission.id]) }; world.q4_missions[mission.id] = clone(mission); event(world, run_id, "q4.mission.assigned", { mission_id: mission.id, family: mission.family, authority: mission.authority }); return { ok: true, idempotent: false, mission: clone(mission) }; }
function updateQ4Mission(world, run_id, mission_id, patch) { assertWorld(world); const mission = world.q4_missions?.[mission_id]; if (!mission) return { ok: false, code: "MISSION_UNKNOWN" }; Object.assign(mission, clone(patch)); event(world, run_id, "q4.mission.updated", { mission_id, status: mission.status }); return { ok: true, mission: clone(mission) }; }
function recordInstitutionalRegionSummary(world, run_id, region_id, summary) { assertWorld(world); if (!world.regions[region_id]) return { ok: false, code: "REGION_UNKNOWN" }; const safe = { observed_architecture: clone(summary.observed_architecture ?? []), landmarks: clone(summary.landmarks ?? []), known_connections: summary.known_connections ?? 0, observed_environment: clone(summary.observed_environment ?? []), unresolved_frontier: summary.unresolved_frontier ?? 0, routes: clone(summary.routes ?? []) }; const id = `institutional-region-summary-${region_id}`; recordInstitutional(world, run_id, id, { region_id, summary: safe }); return { ok: true, record_id: id }; }
function ingestRun(world, run) { assertWorld(world); const run_id = run.run_id; const record = world.runs[run_id]; if (!record) throw Object.assign(new Error("unknown run"), { code: "RUN_UNKNOWN" }); if (record.history_ingested) return { ok: true, idempotent: true, run_id, region_id: record.region_id ?? null }; const region_id = promoteRegion(world, run_id, run.procedural); const expedition = run.expedition?.result; record.status = run.lifecycle; record.region_id = region_id; record.expedition_result = expedition ? clone(expedition) : null; record.history_ingested = true; event(world, run_id, "run.finalized", { lifecycle: run.lifecycle, outcome: expedition?.outcome ?? null, region_id });
  if (expedition) { const expedition_id = `expedition-${digest([world.world_id, run_id, expedition.mission_id]).slice(0, 16)}`; record.expedition_id = expedition_id; event(world, run_id, "expedition.ingested", { expedition_id, outcome: expedition.outcome }); for (const item of expedition.evidence ?? []) { const evidence_id = `evidence-${digest([world.world_id, run_id, item.id]).slice(0, 16)}`; if (!world.evidence[evidence_id]) { world.evidence[evidence_id] = { id: evidence_id, origin_run: run_id, type: item.type, creator: item.creator, custody: [{ holder: item.custodian, event: "created" }], source_location: item.location, provenance: item.provenance, availability: "archived" }; event(world, run_id, "evidence.promoted", { evidence_id, region_id }); } }
    const submitted = (expedition.messages ?? []).some((message) => message.intended_recipient === "Standard" && message.delivery_status === "delivered"); if (submitted) { if (region_id) recordInstitutional(world, run_id, `institutional-region-${region_id}`, { region_id, expedition_id }); for (const evidence_id of Object.keys(world.evidence).filter((id) => world.evidence[id].origin_run === run_id)) recordInstitutional(world, run_id, `institutional-evidence-${evidence_id}`, { evidence_id, expedition_id }); }
  }
  return { ok: true, idempotent: false, run_id, region_id };
}
function leaveRemnant(world, { run_id, region_id, space_id, type = "field-bag", provenance = "pack-original-remnant-fixture" }) { assertWorld(world); const id = `artifact-${digest([world.world_id, run_id, region_id, space_id, type]).slice(0, 16)}`; if (world.artifacts[id]) return { ok: true, idempotent: true, artifact_id: id }; world.artifacts[id] = { id, type, origin_run: run_id, region_id, space_id, state: "at-location", custody: [], recoverable: true, provenance, visibility: "location-local" }; event(world, run_id, "remnant.left", { artifact_id: id, region_id, space_id }); return { ok: true, artifact_id: id, idempotent: false }; }
function visibleArtifacts(world, { region_id, space_id }) { return Object.values(world.artifacts).filter((item) => item.region_id === region_id && item.space_id === space_id && item.state === "at-location" && item.visibility === "location-local").map((item) => ({ id: item.id, type: item.type })); }
function mutationEvents(world, region_id) { return world.events.filter((entry) => entry.type === "region.mutated" && entry.payload.region_id === region_id).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)); }
function applyMutation(state, mutation) { const next = clone(state); if (!next.nodes[mutation.space_id]) throw Object.assign(new Error("mutation target node missing"), { code: "MUTATION_TARGET_MISSING" }); next.mutations ??= []; if (next.mutations.some((entry) => entry.id === mutation.id)) return next;
  if (mutation.target_type === "object") { next.objects ??= {}; const objects = next.objects[mutation.space_id] ?? (next.objects[mutation.space_id] = []); if (mutation.operation === "remove") { const index = objects.findIndex((object) => object.id === mutation.target); if (index < 0) throw Object.assign(new Error("mutation object target missing"), { code: "MUTATION_TARGET_MISSING" }); objects.splice(index, 1); } else if (mutation.operation === "add") { if (!mutation.value?.id) throw Object.assign(new Error("mutation object add missing identity"), { code: "MUTATION_TARGET_MISSING" }); if (!objects.some((object) => object.id === mutation.value.id)) objects.push(clone(mutation.value)); } else throw Object.assign(new Error("unsupported object mutation"), { code: "MUTATION_OPERATION_UNSUPPORTED" });
  } else if (mutation.target_type === "node-property") { next.nodes[mutation.space_id].persistent ??= {}; next.nodes[mutation.space_id].persistent[mutation.target] = clone(mutation.value); } else if (mutation.target_type === "edge") { const edge = next.edges[mutation.target]; if (!edge) throw Object.assign(new Error("mutation edge target missing"), { code: "MUTATION_TARGET_MISSING" }); edge.persistent_state = clone(mutation.value); } else throw Object.assign(new Error("unsupported mutation target"), { code: "MUTATION_TARGET_UNSUPPORTED" });
  next.mutations.push(clone(mutation)); return next;
}
function rebuildRegion(world, region_id) { assertWorld(world); const region = world.regions[region_id]; if (!region) throw Object.assign(new Error("unknown persistent region"), { code: "REGION_UNKNOWN" }); const version = assertRegion(region); if (version !== GENERATOR_V2) return clone(region.state); const baseline = clone(region.baseline_state ?? region.state); if (baseline.version !== GENERATOR_V2) throw Object.assign(new Error("v2 region baseline/version mismatch"), { code: "REGION_VERSION_MISMATCH" }); let state = baseline; for (const entry of mutationEvents(world, region_id)) state = applyMutation(state, entry.payload.mutation); return state; }
function restoreRegion(world, region_id) { const region = world.regions[region_id]; const version = assertRegion(region); const state = version === GENERATOR_V2 ? rebuildRegion(world, region_id) : clone(region.state); return { generator_version: version, state }; }
function mutateRegion(world,{run_id,region_id,space_id,target_type="node-property",target,value,operation="set",provenance="pack-original-v2-mutation",authority="scenario-optional"}) { assertWorld(world); const region=world.regions[region_id]; if(!region || generatorVersion(region)!==GENERATOR_V2) return {ok:false,code:"REGION_VERSION_UNSUPPORTED"}; if (!region.state.nodes[space_id]) return {ok:false,code:"MUTATION_TARGET_MISSING"}; const mutation={id:`history-mutation-${digest([world.world_id,run_id,region_id,space_id,target_type,target,operation,value]).slice(0,16)}`,run_id,space_id,target_type,target,value:clone(value),operation,provenance,authority}; const existing = mutationEvents(world, region_id).find((entry) => entry.payload.mutation.id === mutation.id); if (existing) return {ok:true,idempotent:true,mutation:clone(existing.payload.mutation)}; const candidate = applyMutation(region.state, mutation); const record = event(world,run_id,"region.mutated",{region_id,space_id,target_type,target,operation,value:clone(value),provenance,authority,mutation}); region.state = candidate; return {ok:true,idempotent:false,mutation, event_id:record.id}; }
function recoverArtifact(world, { run_id, artifact_id, holder }) { const item = world.artifacts[artifact_id]; if (!item || item.state !== "at-location") return { ok: false, public_reason: "target unavailable" }; item.state = "recovered"; item.custody.push({ holder, event: "recovered", run_id }); event(world, run_id, "artifact.recovered", { artifact_id, holder }); return { ok: true, artifact: clone(item) }; }
// Character records are canonical world state plus append-only history events.
// The object index is a cacheable current-state view: it can be rebuilt from
// character.* events and is never an observer knowledge ledger or role table.
function characterState(world) { assertWorld(world); if (!world.characters || typeof world.characters !== "object" || Array.isArray(world.characters)) throw Object.assign(new Error("invalid character state"), { code:"CHARACTER_STATE_INVALID" }); return world.characters; }
function ensureCharacterState(world) { assertWorld(world); world.characters ??= {}; if (typeof world.characters !== "object" || Array.isArray(world.characters)) throw Object.assign(new Error("invalid character state"), { code:"CHARACTER_STATE_INVALID" }); return world.characters; }
function character(world, identity) { return characterState(world)[identity] ?? null; }
function canInstantiateCharacter(world, identity) { return !character(world, identity); }
function instantiateCharacter(world, { run_id, identity, display_name, first_name = null, last_name = null, role = null, clearance = null, condition = "normal", current_assignment = null, assignment_history = [], classification = "named-character", provenance = "pack-original-character-fixture", authority = "scenario-optional", source_claim_ids = [] }) {
  if (!identity || !display_name || !canInstantiateCharacter(world, identity)) return { ok: false, code: "CHARACTER_IDENTITY_UNAVAILABLE" };
  const record = { identity, display_name, first_name, last_name, role, clearance, condition, current_assignment, assignment_history: clone(assignment_history), classification, status: "active", provenance, authority, source_claim_ids: clone(source_claim_ids), instantiated_by: run_id, death: null };
  ensureCharacterState(world)[identity] = record; event(world, run_id, "character.instantiated", { identity, display_name, first_name, last_name, role, clearance, condition, current_assignment, assignment_history: clone(assignment_history), classification, provenance, authority, source_claim_ids: clone(source_claim_ids) }, authority);
  return { ok: true, character: clone(record) };
}
function setCharacterStatus(world, { run_id, identity, status, condition = null, reason = null }) {
  const record = character(world, identity); if (!record) return { ok: false, code: "CHARACTER_UNKNOWN" };
  if (record.status === "dead" && status !== "dead") return { ok: false, code: "CHARACTER_DEATH_IRREVERSIBLE" };
  if (!["active", "unavailable", "missing", "unknown", "retired", "removed", "dead"].includes(status)) return { ok: false, code: "CHARACTER_STATUS_INVALID" };
  const nextCondition = condition ?? (["missing", "dead"].includes(status) ? status : null); record.status = status; if (nextCondition != null) record.condition = nextCondition;
  if (status === "dead") { record.death ??= { run_id, reason }; event(world, run_id, "character.died", { identity, condition:record.condition, reason }, record.authority); }
  else event(world, run_id, "character.status.changed", { identity, status, condition:condition ?? null, reason }, record.authority);
  return { ok: true, character: clone(record) };
}
function rebuildCharacters(world) {
  assertWorld(world); const rebuilt = {};
  for (const entry of world.events.filter((item) => item.type.startsWith("character.") || item.type === "q4.personnel.condition.changed").sort((a, b) => a.sequence - b.sequence)) {
    const payload = entry.payload ?? {};
    if (entry.type === "character.instantiated" && !rebuilt[payload.identity]) rebuilt[payload.identity] = { identity: payload.identity, display_name: payload.display_name, first_name: payload.first_name ?? null, last_name: payload.last_name ?? null, role: payload.role ?? null, clearance: payload.clearance ?? null, condition: payload.condition ?? "normal", current_assignment: payload.current_assignment ?? null, assignment_history: clone(payload.assignment_history ?? []), classification: payload.classification, status: "active", provenance: payload.provenance, authority: payload.authority, source_claim_ids: clone(payload.source_claim_ids ?? []), instantiated_by: entry.run_id, death: null };
    if (entry.type === "character.died" && rebuilt[payload.identity]) { rebuilt[payload.identity].status = "dead"; if (payload.condition != null) rebuilt[payload.identity].condition = payload.condition; rebuilt[payload.identity].death = { run_id: entry.run_id, reason: payload.reason ?? null }; }
    if (entry.type === "character.status.changed" && rebuilt[payload.identity] && rebuilt[payload.identity].status !== "dead") { rebuilt[payload.identity].status = payload.status; if (payload.condition != null) rebuilt[payload.identity].condition = payload.condition; }
    if (entry.type === "character.assignment.changed" && rebuilt[payload.identity] && rebuilt[payload.identity].status !== "dead") { rebuilt[payload.identity].current_assignment = payload.assignment ?? null; if (payload.assignment) rebuilt[payload.identity].assignment_history = [...(rebuilt[payload.identity].assignment_history ?? []), clone(payload.assignment)]; }
    if (entry.type === "character.continuity.initialized" && rebuilt[payload.identity]) rebuilt[payload.identity].continuity = clone(payload.continuity);
    if (entry.type === "character.shared-history.recorded") for (const identity of payload.participants ?? []) if (rebuilt[identity]?.continuity && !rebuilt[identity].continuity.shared_history.some((fact) => fact.id === payload.id)) rebuilt[identity].continuity.shared_history.push(clone(payload));
    if (entry.type === "character.equipment-custody.recorded") for (const identity of [payload.from, payload.to].filter(Boolean)) if (rebuilt[identity]?.continuity && !rebuilt[identity].continuity.equipment_custody_history.some((fact) => fact.id === payload.id)) rebuilt[identity].continuity.equipment_custody_history.push(clone(payload));
    if (entry.type === "character.reaction.recorded" && rebuilt[payload.identity]?.continuity && !rebuilt[payload.identity].continuity.reaction_history.some((fact) => fact.reaction?.id === payload.id)) rebuilt[payload.identity].continuity.reaction_history.push(clone(payload.reaction));
    if (entry.type === "q4.personnel.condition.changed" && rebuilt[payload.identity]) { if (rebuilt[payload.identity].status !== "dead") { if (payload.status && CHARACTER_STATUSES.has(payload.status)) rebuilt[payload.identity].status = payload.status; if (payload.condition != null) rebuilt[payload.identity].condition = payload.condition; } }
  }
  return rebuilt;
}
function knownRegions(world, profile) { assertWorld(world); if (profile !== "field-researcher" && profile !== "async-command") return []; return Object.values(world.knowledge.institutional.records).filter((record) => record.id.startsWith("institutional-region-")).map((record) => ({ record_id: record.id, region_id: record.payload.region_id })); }
function summary(world, profile) { assertWorld(world); return { world_id: world.world_id, version: world.version, completed_runs: Object.values(world.runs).filter((run) => run.history_ingested).length, institutional_regions: knownRegions(world, profile).length, archived_expeditions: Object.values(world.runs).filter((run) => run.expedition_id).length }; }
function assertCurrentWorld(world, { validate_regions = true } = {}) {
  assertWorld(world);
  if (world.canonical_shape_version !== CURRENT_SHAPE_VERSION) throw Object.assign(new Error("unsupported canonical world shape"), { code:"WORLD_SHAPE_VERSION_UNSUPPORTED" });
  if (!Array.isArray(world.storage_migrations)) throw Object.assign(new Error("invalid storage migration ledger"), { code:"WORLD_SHAPE_INVALID" });
  for (const key of ["runs","regions","evidence","artifacts","characters","phenomena","q4_career_state","q4_missions","q4_reviews","q4_scars","q4_knowledge","q4_operations","q4_legacy_personnel"]) if (!world[key] || typeof world[key] !== "object" || Array.isArray(world[key])) throw Object.assign(new Error(`invalid current world field: ${key}`), { code:"WORLD_SHAPE_INVALID" });
  for (const key of ["q4_geography","q4_survey_frontier","q4_object_state"]) if (!Object.hasOwn(world, key)) throw Object.assign(new Error(`missing current world field: ${key}`), { code:"WORLD_SHAPE_INVALID" });
  if (!Array.isArray(world.events) || !world.knowledge?.institutional?.records || !world.knowledge?.civilian?.records) throw Object.assign(new Error("invalid current world history collections"), { code:"WORLD_SHAPE_INVALID" });
  if (!world.q4_evidence_archive || !world.q4_phenomenon_ecology) throw Object.assign(new Error("missing current canonical domain state"), { code:"WORLD_SHAPE_INVALID" });
  const evidenceAuthority = require("./q4-evidence-authority"); evidenceAuthority.readState(world); const evidenceValidation = evidenceAuthority.validate(world); if (!evidenceValidation.ok) throw Object.assign(new Error(`invalid current evidence archive: ${evidenceValidation.broken.join(", ")}`), { code:"WORLD_SHAPE_INVALID" }); require("./q4-phenomenon-ecology").state(world); require("./q4-career-loop").read(world);
  for (const [identity, person] of Object.entries(world.characters)) { const condition = person?.condition == null ? null : String(person.condition).toLowerCase(); if (!person || typeof person !== "object" || Array.isArray(person) || person.identity !== identity || !CHARACTER_STATUSES.has(person.status) || condition != null && !CHARACTER_CONDITIONS.has(condition) || person.status === "dead" && !["dead","deceased"].includes(condition) || person.status !== "dead" && ["dead","deceased"].includes(condition)) throw Object.assign(new Error(`invalid current personnel record: ${identity}`), { code:"WORLD_SHAPE_INVALID" }); }
  for (const [index, entry] of world.events.entries()) if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw Object.assign(new Error(`invalid current event record: ${index}`), { code:"WORLD_SHAPE_INVALID" });
  try { require("./q4-standard-operator").read(world); } catch { throw Object.assign(new Error("invalid current Standard operator state"), { code:"WORLD_SHAPE_INVALID" }); }
  if (world.q4_geography != null) { try { const authored = require("../data/worldpacks/clear-q4/spatial.json"); const topology = require("./spatial-runtime").canonicalDefinition(world.q4_geography, authored); require("./q4-environment").validateCurrent(world.q4_geography.environment, authored); require("./survey-frontier").validateCurrent(world.q4_survey_frontier, topology, { player:world.q4_operations?.controlled_player ?? null }); } catch { throw Object.assign(new Error("invalid current Clear-Q4 spatial authority state"), { code:"WORLD_SHAPE_INVALID" }); } }
  try { require("./q4-outcome-authority").readLifecycle(world); } catch { throw Object.assign(new Error("invalid current lifecycle state"), { code:"WORLD_SHAPE_INVALID" }); }
  if (validate_regions) for (const region of Object.values(world.regions)) assertRegion(region);
  return world;
}
function migrateWorld(input) {
  const world = assertWorld(canonicalJson(input));
  if (world.canonical_shape_version != null && world.canonical_shape_version !== CURRENT_SHAPE_VERSION) throw Object.assign(new Error("unsupported canonical world shape"), { code:"WORLD_SHAPE_VERSION_UNSUPPORTED" });
  if (world.canonical_shape_version === CURRENT_SHAPE_VERSION) return assertCurrentWorld(world);
  world.q4_geography ??= null; world.q4_survey_frontier ??= null; world.q4_object_state ??= null;
  world.runs ??= {}; world.regions ??= {}; world.evidence ??= {}; world.artifacts ??= {}; world.characters ??= {}; world.phenomena ??= {}; world.q4_career_state ??= require("./q4-career-loop").createState(); world.q4_missions ??= {}; world.q4_reviews ??= {}; world.q4_scars ??= {}; world.q4_knowledge ??= {}; world.q4_operations ??= { institutional_time:0, last_review:null }; world.events ??= []; world.knowledge ??= { institutional:{ records:{} }, civilian:{ records:{} } }; world.knowledge.institutional ??= { records:{} }; world.knowledge.institutional.records ??= {}; world.knowledge.civilian ??= { records:{} }; world.knowledge.civilian.records ??= {};
  require("./q4-evidence-authority").migrate(world); require("./q4-phenomenon-ecology").migrate(world); require("./q4-outcome-authority").migrate(world);
  const rebuiltCharacters = rebuildCharacters(world); for (const [identity, record] of Object.entries(rebuiltCharacters)) world.characters[identity] ??= record;
  for (const entry of world.events) entry.payload = canonicalEventPayload(entry.payload);
  for (const region of Object.values(world.regions)) { if (!region.generator_version && region.state?.version === GENERATOR_V1) region.generator_version = GENERATOR_V1; assertRegion(region); if (region.generator_version === GENERATOR_V2) region.state = rebuildRegion(world, region.id); }
  world.storage_migrations = [...new Set([...(Array.isArray(world.storage_migrations) ? world.storage_migrations : []), STORAGE_MIGRATION_ID])]; world.canonical_shape_version = CURRENT_SHAPE_VERSION;
  return assertCurrentWorld(world);
}
function normalizeWorld(world) { assertWorld(world); if (world.canonical_shape_version === CURRENT_SHAPE_VERSION) { const normalized = canonicalJson(world, { code:"CANONICAL_WORLD_VALUE_INVALID" }); return assertCurrentWorld(normalized, { validate_regions:false }); } return migrateWorld(world); }
function saveWorld(file, world) { const normalized = normalizeWorld(world); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`); return normalized; }
function loadWorld(file) { const world = assertWorld(JSON.parse(fs.readFileSync(file, "utf8"))); return world.canonical_shape_version === CURRENT_SHAPE_VERSION ? assertCurrentWorld(world) : migrateWorld(world); }
module.exports = { VERSION, CURRENT_SHAPE_VERSION, STORAGE_MIGRATION_ID, GENERATOR_V1, GENERATOR_V2, SUPPORTED_GENERATORS, canonicalJson, canonicalEventPayload, createWorld, assertWorld, assertCurrentWorld, migrateWorld, normalizeWorld, event, beginRun, ingestRun, promoteRegion, regionId, generatorVersion, restoreRegion, rebuildRegion, leaveRemnant, visibleArtifacts, mutateRegion, recoverArtifact, characterState, character, canInstantiateCharacter, instantiateCharacter, setCharacterStatus, rebuildCharacters, recordInstitutional, recordQ4Mission, updateQ4Mission, recordInstitutionalRegionSummary, knownRegions, summary, saveWorld, loadWorld };
