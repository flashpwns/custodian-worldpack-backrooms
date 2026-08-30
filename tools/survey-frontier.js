"use strict";

// Epistemic spatial authority. Objective topology stays in spatial-runtime;
// this module records only who legitimately knows claims about that topology.
const VERSION = "yellow-beast-survey-frontier@v1";
const clone = (value) => structuredClone(value);
const direct = (at, source = "direct-observation") => ({ state: "OBSERVED", provenance: [{ source, at, direct: true }] });
const add = (bucket, id, entry) => { const prior = bucket[id]; if (!prior) { bucket[id] = entry; return; } prior.provenance ??= []; prior.provenance.push(...(entry.provenance ?? [])); if (prior.state === "PARTIALLY_OBSERVED" && entry.state === "OBSERVED") prior.state = entry.state; };

function person(state, id) { state.personnel[id] ??= { locations: {}, connections: {} }; return state.personnel[id]; }
function readPerson(state, id) { return state?.personnel?.[id] ?? null; }
function validateCurrent(state, definition, { player, personnel = [] } = {}) {
  const fail = (reason) => { throw Object.assign(new Error(`invalid current Survey Frontier: ${reason}`), { code:"RUN_STATE_INVALID" }); };
  const record = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const validStates = new Set(["OBSERVED", "PARTIALLY_OBSERVED", "SURVEYED", "REPORTED", "CONFIRMED"]);
  const validateBucket = (bucket, validIds, label) => {
    if (!record(bucket)) fail(`${label} is malformed`);
    for (const [id, claim] of Object.entries(bucket)) {
      if (!validIds.has(id) || !record(claim) || !validStates.has(claim.state) || !Array.isArray(claim.provenance)) fail(`${label}.${id} is malformed`);
      for (const provenance of claim.provenance) if (!record(provenance) || typeof provenance.source !== "string" || !Object.hasOwn(provenance, "at") || typeof provenance.direct !== "boolean") fail(`${label}.${id} provenance is malformed`);
    }
  };
  if (!record(state) || state.version !== VERSION || state.worldpack_id !== definition?.worldpack_id || !record(state.personnel) || !record(state.standard) || !record(state.historical) || !Array.isArray(state.historical.claims)) fail("authority containers are missing or malformed");
  const locationIds = new Set((definition.locations ?? []).map((item) => item.id)); const connectionIds = new Set((definition.connections ?? []).map((item) => item.id));
  for (const [id, knowledge] of Object.entries(state.personnel)) { if (!record(knowledge)) fail(`observer ${id} is malformed`); validateBucket(knowledge.locations, locationIds, `personnel.${id}.locations`); validateBucket(knowledge.connections, connectionIds, `personnel.${id}.connections`); }
  for (const id of [player, ...personnel].filter(Boolean)) {
    const knowledge = readPerson(state, id); if (!record(knowledge)) fail(`required observer ${id} is missing`);
    validateBucket(knowledge.locations, locationIds, `personnel.${id}.locations`); validateBucket(knowledge.connections, connectionIds, `personnel.${id}.connections`);
  }
  validateBucket(state.standard.locations, locationIds, "standard.locations"); validateBucket(state.standard.connections, connectionIds, "standard.connections");
  for (const claim of state.historical.claims) if (!record(claim) || typeof claim.id !== "string" || typeof claim.label !== "string") fail("historical claim is malformed");
  return state;
}
function historical(definition) { return clone(definition.historical_survey_claims ?? []); }
function create(definition, { player, personnel = [], spatial = null, at = 0 } = {}) {
  const state = { version: VERSION, worldpack_id: definition.worldpack_id, personnel: {}, standard: { locations: {}, connections: {} }, historical: { claims: historical(definition) } };
  const legacy = Object.keys(spatial?.discovered_locations ?? {});
  for (const id of [player, ...personnel].filter(Boolean)) person(state, id);
  // Conservative migration seed: only a persisted discovery is evidence of player knowledge.
  for (const location of legacy) add(person(state, player).locations, location, { state: "OBSERVED", provenance: [{ source: "legacy-spatial-record", at, direct: false }] });
  return state;
}
function migrate(value, definition, context = {}) {
  if (value?.version === VERSION && value.worldpack_id === definition.worldpack_id) {
    value.personnel ??= {}; value.standard ??= { locations: {}, connections: {} }; value.standard.locations ??= {}; value.standard.connections ??= {}; value.historical ??= { claims: historical(definition) }; value.historical.claims ??= historical(definition);
    for (const id of [context.player, ...(context.personnel ?? [])].filter(Boolean)) person(value, id);
    return value;
  }
  return create(definition, context);
}
function observe(state, definition, observer, locationId, { at = 0, co_present = [] } = {}) {
  const location = definition.locations.find((item) => item.id === locationId); if (!location) return false;
  for (const id of [observer, ...co_present].filter(Boolean)) {
    const knowledge = person(state, id); add(knowledge.locations, locationId, direct(at));
    for (const connection of definition.connections.filter((item) => item.from === locationId || item.to === locationId)) add(knowledge.connections, connection.id, { state: "PARTIALLY_OBSERVED", provenance: [{ source: "direct-observation", at, direct: true }] });
  }
  return true;
}
function traverse(state, definition, observer, connectionId, from, to, { at = 0, co_present = [] } = {}) {
  const connection = definition.connections.find((item) => item.id === connectionId); if (!connection) return false;
  for (const id of [observer, ...co_present].filter(Boolean)) { const knowledge = person(state, id); add(knowledge.locations, from, direct(at)); add(knowledge.locations, to, direct(at)); add(knowledge.connections, connectionId, { state: "SURVEYED", provenance: [{ source: "traversal", at, direct: true }] }); }
  return true;
}
function share(state, from, to, { at = 0, source = "teammate-communication" } = {}) {
  const sender = person(state, from); const recipient = person(state, to);
  for (const [id, value] of Object.entries(sender.locations)) add(recipient.locations, id, { state: "PARTIALLY_OBSERVED", provenance: [{ source, from, at, direct: false }] });
  for (const [id, value] of Object.entries(sender.connections)) add(recipient.connections, id, { state: "PARTIALLY_OBSERVED", provenance: [{ source, from, at, direct: false }] });
}
function report(state, observer, { at = 0, message_id = null } = {}) {
  const knowledge = person(state, observer);
  for (const [id, value] of Object.entries(knowledge.locations)) add(state.standard.locations, id, { state: state.standard.locations[id] ? "CONFIRMED" : "REPORTED", provenance: [{ source: "delivered-radio-report", observer, message_id, at, direct: false }] });
  for (const [id, value] of Object.entries(knowledge.connections)) add(state.standard.connections, id, { state: state.standard.connections[id] ? "CONFIRMED" : "REPORTED", provenance: [{ source: "delivered-radio-report", observer, message_id, at, direct: false }] });
}
function known(state, observer, id, kind = "locations") { return Boolean(readPerson(state, observer)?.[kind]?.[id]); }
function projectMap(state, definition, knowledge, current_location = null) {
  knowledge ??= { locations:{}, connections:{} }; const locations = Object.fromEntries(definition.locations.map((item) => [item.id, item])); const connections = Object.fromEntries(definition.connections.map((item) => [item.id, item]));
  const nodes = Object.entries(knowledge.locations).map(([id, item]) => ({ id, name: locations[id]?.name ?? "Recorded location", type: locations[id]?.type ?? "recorded-location", coordinates: clone(locations[id]?.coordinates ?? null), status: item.state, current: id === current_location, provenance: item.provenance.at(-1)?.source ?? "record" }));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Object.entries(knowledge.connections).map(([id, item]) => { const connection = connections[id]; if (!connection) return null; const from = nodeIds.has(connection.from) ? connection.from : nodeIds.has(connection.to) ? connection.to : null; if (!from) return null; const to = nodeIds.has(connection.from) && nodeIds.has(connection.to) ? (from === connection.from ? connection.to : connection.from) : null; return { id, from, to, status: item.state, label: connection.relationship }; }).filter(Boolean);
  const claims = (state.historical?.claims ?? []).map((claim) => ({ id: claim.id, label: claim.label, status: "PRIOR_RECORD_ONLY", claim_state: claim.state ?? "UNCONFIRMED" }));
  return { version: "yellow-beast-survey-frontier-map@v1", nodes, edges, historical_claims: claims, current_location: nodeIds.has(current_location) ? current_location : null };
}
function map(state, definition, observer, { current_location = null } = {}) {
  return projectMap(state, definition, readPerson(state, observer), current_location);
}
function standardMap(state, definition) { return projectMap(state, definition, state.standard); }
function frontier(state, definition, observer) { const knowledge = readPerson(state, observer) ?? { locations:{}, connections:{} }; return Object.keys(knowledge.locations).flatMap((location) => definition.connections.filter((connection) => connection.from === location || connection.to === location).filter((connection) => !knowledge.connections[connection.id] || knowledge.connections[connection.id].state !== "SURVEYED").map((connection) => ({ location, route: connection.relationship, state: knowledge.connections[connection.id]?.state ?? "UNKNOWN" }))); }
module.exports = { VERSION, create, migrate, validateCurrent, observe, traverse, share, report, known, map, standardMap, frontier };
