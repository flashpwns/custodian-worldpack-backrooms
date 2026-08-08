"use strict";

// Generic worldpack-driven spatial behavior. This module owns no Clear-Q4
// topology or names: callers supply a validated declarative spatial record.
const VERSION = "yellow-beast-spatial-state@v1";
const DEFINITION_VERSION = "yellow-beast-spatial-worldpack@v1";
const CANONICAL_VERSION = "yellow-beast-spatial-canonical@v1";
const geography = require("./procedural-geography");
const clone = (value) => structuredClone(value);

function canonicalDefinition(state, definition) {
  if (definition?._canonical_generation_view) return definition;
  return { ...definition, _canonical_generation_view: true, locations: [...definition.locations, ...(state?.generated_locations ?? [])], connections: [...definition.connections, ...(state?.generated_connections ?? [])] };
}

function index(definition) {
  validateDefinition(definition);
  return {
    locations: Object.fromEntries(definition.locations.map((item) => [item.id, item])),
    connections: Object.fromEntries(definition.connections.map((item) => [item.id, item]))
  };
}

function validateDefinition(definition) {
  if (!definition || definition.version !== DEFINITION_VERSION || !definition.worldpack_id) throw new Error("unsupported spatial worldpack");
  const locationIds = new Set((definition.locations ?? []).map((item) => item.id));
  if (!locationIds.has(definition.initial_location) || !locationIds.has(definition.field_entry_location)) throw new Error("spatial entry location does not resolve");
  if (locationIds.size !== definition.locations.length) throw new Error("duplicate spatial location id");
  const connectionIds = new Set();
  for (const connection of definition.connections ?? []) {
    if (!connection.id || connectionIds.has(connection.id) || !locationIds.has(connection.from) || !locationIds.has(connection.to)) throw new Error("invalid spatial connection");
    connectionIds.add(connection.id);
  }
  return true;
}

function discoverLocation(state, definition, id, status = "confirmed", source = "direct-observation") {
  const locations = index(definition).locations;
  if (!locations[id]) return false;
  state.discovered_locations[id] ??= { status, source, first_observed_at: state.time ?? 0 };
  if (status === "confirmed") state.discovered_locations[id].status = "confirmed";
  if (!state.visited_locations.includes(id)) state.visited_locations.push(id);
  return true;
}

function orientedConnection(connection, current) {
  if (connection.from === current) return { connection, from: connection.from, to: connection.to, direction: connection.direction, transition: connection.transition };
  if (connection.bidirectional && connection.to === current) return { connection, from: connection.to, to: connection.from, direction: connection.reverse_direction ?? "back", transition: connection.reverse_transition ?? `The team returns along the ${connection.relationship ?? "confirmed route"}.` };
  return null;
}

function connectionsFrom(definition, current) {
  return definition.connections.map((connection) => orientedConnection(connection, current)).filter(Boolean);
}

function observeConnections(state, definition, current) {
  for (const oriented of connectionsFrom(definition, current)) {
    if (!["visible", "institutional"].includes(oriented.connection.visibility)) continue;
    state.discovered_connections[oriented.connection.id] ??= { status: "observed", source: oriented.connection.visibility === "institutional" ? "institutional-record" : "direct-observation", first_observed_at: state.time ?? 0 };
  }
}

function createState(definition, { player, personnel = [], equipment = [], phase = "BRIEFING", world_seed = null } = {}) {
  validateDefinition(definition);
  const location = definition.phase_locations?.[phase] ?? definition.initial_location;
  const state = {
    version: VERSION,
    worldpack_id: definition.worldpack_id,
    player_location: location,
    personnel_locations: {},
    equipment_locations: {},
    discovered_locations: {},
    discovered_connections: {},
    visited_locations: [],
    route_history: [],
    blocked_paths: {},
    environment_changes: {},
    generated_locations: [],
    generated_connections: [],
    generation: geography.initialState(definition, world_seed),
    route_markers: [],
    last_confirmed_personnel_positions: {},
    team_behavior: {},
    authorizations: { "threshold-authorized": false, "radio-check-complete": false, "route-surveyed": false },
    time: 0
  };
  for (const id of [player, ...personnel].filter(Boolean)) {
    state.personnel_locations[id] = location;
    state.last_confirmed_personnel_positions[id] = { location, status: "confirmed", at: 0 };
    if (id !== player) state.team_behavior[id] = "follow";
  }
  for (const item of equipment) if (item?.id) state.equipment_locations[item.id] = location;
  discoverLocation(state, definition, location, "confirmed", "present");
  observeConnections(state, definition, location);
  return state;
}

function legacyLocation(definition, legacyAlias, phase) {
  const normalized = String(legacyAlias ?? "").toLowerCase();
  const direct = definition.locations.find((item) => item.name.toLowerCase() === normalized || item.id === normalized);
  if (direct) return direct.id;
  const family = [
    [/utility|service room/, "service-room"],
    [/column|corridor/, "corridor"],
    [/stair|lower/, "vertical-transition"],
    [/passage/, "passage"],
    [/level 2|junction/, "unresolved-zone"]
  ].find(([pattern]) => pattern.test(normalized));
  return definition.locations.find((item) => item.type === family?.[1])?.id ?? definition.phase_locations?.[phase] ?? (phase === "FIELD_OPERATION" ? definition.field_entry_location : definition.initial_location);
}

function migrate(state, definition, { player, personnel = [], equipment = [], phase = "BRIEFING", legacy_location = null, world_seed = null } = {}) {
  if (state?.version === CANONICAL_VERSION) {
    const next = createState(definition, { player, personnel, equipment, phase, world_seed: state.generation?.world_seed });
    next.generated_locations = clone(state.generated_locations ?? []);
    next.generated_connections = clone(state.generated_connections ?? []);
    next.generation = clone(state.generation ?? next.generation);
    next.route_markers = clone(state.route_markers ?? []);
    next.environment_changes = clone(state.environment_changes ?? {});
    next.blocked_paths = clone(state.blocked_paths ?? {});
    const errors = validateState(next, definition);
    if (errors.length) throw Object.assign(new Error(`invalid canonical geography snapshot: ${errors.join(",")}`), { code: "CANONICAL_GEOGRAPHY_INVALID" });
    return next;
  }
  if (state?.version === VERSION && state.worldpack_id === definition.worldpack_id) {
    state.personnel_locations ??= {};
    state.equipment_locations ??= {};
    state.discovered_locations ??= {};
    state.discovered_connections ??= {};
    state.visited_locations ??= [];
    state.route_history ??= [];
    state.blocked_paths ??= {};
    state.environment_changes ??= {};
    state.generated_locations ??= [];
    state.generated_connections ??= [];
    state.generation ??= geography.initialState(definition, world_seed);
    state.route_markers ??= [];
    state.last_confirmed_personnel_positions ??= {};
    state.team_behavior ??= {};
    state.authorizations ??= {};
    state.time ??= 0;
    return state;
  }
  const next = createState(definition, { player, personnel, equipment, phase });
  const location = legacyLocation(definition, legacy_location, phase);
  moveTeamTo(next, definition, location, { player, personnel, source: "save-migration", recordRoute: false });
  next.migrated_from = state?.version ?? "procedural-location";
  return next;
}

function moveTeamTo(state, definition, location, { player, personnel = [], source = "phase", recordRoute = false, connection_id = null } = {}) {
  definition = canonicalDefinition(state, definition);
  const locations = index(definition).locations;
  if (!locations[location]) throw new Error(`unknown spatial location: ${location}`);
  const prior = state.player_location;
  state.player_location = location;
  if (player) state.personnel_locations[player] = location;
  for (const id of personnel.filter(Boolean)) if (state.team_behavior[id] !== "independent" && state.team_behavior[id] !== "remain") state.personnel_locations[id] = location;
  for (const id of [player, ...personnel].filter(Boolean)) if (state.personnel_locations[id] === location) state.last_confirmed_personnel_positions[id] = { location, status: "confirmed", at: state.time ?? 0 };
  discoverLocation(state, definition, location, "confirmed", source);
  observeConnections(state, definition, location);
  if (recordRoute && prior && prior !== location) state.route_history.push({ sequence: state.route_history.length + 1, from: prior, to: location, connection_id, at: state.time ?? 0 });
  for (const [equipmentId, equipmentLocation] of Object.entries(state.equipment_locations)) if (equipmentLocation === prior) state.equipment_locations[equipmentId] = location;
  return state;
}

function setPhase(state, definition, phase, context = {}) {
  const location = definition.phase_locations?.[phase];
  if (!location) return state;
  if (phase === "STANDARD_RADIO_CHECK") state.authorizations["threshold-authorized"] = true;
  return moveTeamTo(state, definition, location, { ...context, source: `phase:${phase.toLowerCase()}`, recordRoute: phase === "STANDARD_RADIO_CHECK", connection_id: phase === "STANDARD_RADIO_CHECK" ? "threshold-crossing" : null });
}

function enterField(state, definition, context = {}) {
  state.authorizations["radio-check-complete"] = true;
  return moveTeamTo(state, definition, definition.field_entry_location, { ...context, source: "field-entry", recordRoute: true, connection_id: "entry-to-utility" });
}

function currentLocation(state, definition) { return index(canonicalDefinition(state, definition)).locations[state.player_location] ?? null; }

function proximity(state, observer, subject) {
  const observerLocation = state?.personnel_locations?.[observer] ?? (observer ? null : state?.player_location);
  const subjectLocation = state?.personnel_locations?.[subject] ?? null;
  if (!observerLocation || !subjectLocation) return { category: "UNKNOWN", speaking_range: false, same_location: false, observer_location: observerLocation, subject_location: subjectLocation };
  if (observerLocation === subjectLocation) return { category: "LOCAL", speaking_range: true, same_location: true, observer_location: observerLocation, subject_location: subjectLocation };
  return { category: "SEPARATED", speaking_range: false, same_location: false, observer_location: observerLocation, subject_location: subjectLocation };
}

function syncEquipment(state, expedition) {
  for (const item of Object.values(expedition?.equipment ?? {})) {
    if (!item?.id) continue;
    if (["missing", "abandoned"].includes(item.state) && state.equipment_locations[item.id]) continue;
    state.equipment_locations[item.id] = state.personnel_locations[item.holder] ?? state.equipment_locations[item.id] ?? state.player_location;
  }
  return state;
}

function aliasesFor(oriented, locations) {
  const destination = locations[oriented.to];
  return [...new Set([
    oriented.direction,
    oriented.connection.relationship,
    destination?.name,
    destination?.type,
    ...(oriented.connection.aliases ?? [])
  ].filter(Boolean).map((item) => String(item).toLowerCase()))];
}

function visibleExits(state, definition) {
  definition = canonicalDefinition(state, definition);
  const { locations } = index(definition);
  const exits = connectionsFrom(definition, state.player_location)
    .filter((oriented) => ["visible", "institutional"].includes(oriented.connection.visibility) || state.discovered_connections[oriented.connection.id])
    .map((oriented) => {
      const destination = locations[oriented.to];
      const destinationKnown = Boolean(state.discovered_locations[oriented.to]);
      const blocked = oriented.connection.lock_state === "blocked" || Boolean(state.blocked_paths[oriented.connection.id]);
      return {
        ref: oriented.connection.id,
        alias: !destinationKnown && destination.generation ? `${oriented.direction} toward an unresolved continuation` : `${oriented.direction} toward ${destination.name}`,
        label: `${oriented.direction.toUpperCase()} — ${destination.name}`,
        direction: oriented.direction,
        relationship: oriented.connection.relationship,
        destination: destinationKnown ? destination.name : null,
        destination_id: destinationKnown ? destination.id : null,
        destination_known: destinationKnown,
        status: blocked ? "blocked" : destinationKnown ? "confirmed" : "unresolved",
        hazard: oriented.connection.hazard_state,
        aliases: aliasesFor(oriented, locations)
      };
    });
  for (const exit of exits) {
    const connection = index(definition).connections[exit.ref]; const destination = connection ? (connection.from === state.player_location ? connection.to : connection.from) : null;
    if (!exit.destination_known && index(definition).locations[destination]?.generation) exit.label = `${exit.direction.toUpperCase()} — unresolved continuation`;
  }
  for (const frontier of availableFrontiers(state)) exits.push({ ref: frontier.id, alias: frontier.label, label: `${frontier.direction.toUpperCase()} — ${frontier.label}`, direction: frontier.direction, relationship: "unresolved continuation", destination: null, destination_id: null, destination_known: false, status: "unresolved", hazard: "unknown", aliases: [frontier.label.toLowerCase(), "unresolved continuation", frontier.direction] });
  return exits;
}

function requirementFailure(oriented, state) {
  if (oriented.connection.lock_state === "blocked" || state.blocked_paths[oriented.connection.id]) return "The route is recorded as blocked.";
  const missing = (oriented.connection.requirements ?? []).find((requirement) => state.authorizations[requirement] !== true);
  return missing ? `The route is not authorized from the current operational state.` : null;
}

function resolveMovement(state, definition, target) {
  definition = canonicalDefinition(state, definition);
  const query = String(target ?? "").trim().toLowerCase().replace(/[.!?]+$/, "");
  const available = connectionsFrom(definition, state.player_location).filter((oriented) => ["visible", "institutional"].includes(oriented.connection.visibility) || state.discovered_connections[oriented.connection.id]);
  const exact = available.filter((oriented) => oriented.connection.id.toLowerCase() === query || aliasesFor(oriented, index(definition).locations).some((alias) => query === alias));
  const candidates = exact.length ? exact : available.filter((oriented) => {
    const known = ["visible", "institutional"].includes(oriented.connection.visibility) || state.discovered_connections[oriented.connection.id];
    if (!known) return false;
    return aliasesFor(oriented, index(definition).locations).some((alias) => query.includes(alias));
  });
  if (candidates.length === 1) return { ok: true, oriented: candidates[0] };
  if (candidates.length > 1) return { ok: false, code: "MOVEMENT_AMBIGUOUS", reason: "More than one confirmed route matches that direction. Name the passage or destination." };
  const location = currentLocation(state, definition);
  const direction = query.match(/\b(north|south|east|west|up|down|forward|back)\b/i)?.[1];
  return { ok: false, code: "ROUTE_UNCONFIRMED", reason: direction ? `No confirmed route leads ${direction.toLowerCase()} from the ${location?.name.toLowerCase() ?? "current location"}.` : `No confirmed route matches that instruction from the ${location?.name.toLowerCase() ?? "current location"}.` };
}

function move(state, definition, target, context = {}) {
  definition = canonicalDefinition(state, definition);
  const resolved = resolveMovement(state, definition, target);
  if (!resolved.ok) return resolved;
  const failure = requirementFailure(resolved.oriented, state);
  if (failure) return { ok: false, code: "ROUTE_BLOCKED", reason: failure };
  const { oriented } = resolved;
  state.discovered_connections[oriented.connection.id] = { status: "confirmed", source: "traversal", first_observed_at: state.discovered_connections[oriented.connection.id]?.first_observed_at ?? state.time ?? 0, confirmed_at: state.time ?? 0 };
  state.time = (state.time ?? 0) + 1;
  moveTeamTo(state, definition, oriented.to, { ...context, source: "traversal", recordRoute: true, connection_id: oriented.connection.id });
  const location = currentLocation(state, definition);
  const nearby = (context.personnel_records ?? []).filter((person) => (person.id ?? person.personnel_id) !== context.player && state.personnel_locations[person.id ?? person.personnel_id] === state.player_location).map((person) => person.first_name ?? person.display_name).filter(Boolean);
  const objects = typeof context.observe_objects === "function" ? context.observe_objects(oriented.to) : [];
  const observation = locationObservation(state, definition, { mode: "arrival", nearby, objects });
  return { ok: true, from: oriented.from, to: oriented.to, connection_id: oriented.connection.id, narration: `${oriented.transition} ${observation}`.trim(), time_cost: 1 };
}

function article(value) { return /^(uni([^nmd]|$)|use|utility)/i.test(value) ? "a" : /^[aeiou]/i.test(value) ? "an" : "a"; }
function exitSentence(exit) {
  const name = exit.label.replace(/^[^—]+—\s*/, "").toLowerCase();
  if (exit.status === "blocked") return `${article(name)[0].toUpperCase()}${article(name).slice(1)} ${name} lies ${exit.direction}, but the route is blocked.`;
  const verb = /corridor/.test(name) ? "continues" : /passage|transition|route|entry/.test(name) ? "leads" : "lies";
  return `${article(name)[0].toUpperCase()}${article(name).slice(1)} ${name} ${verb} ${exit.direction}.`;
}

function locationObservation(state, definition, { mode = "orient", nearby = [], objects = [] } = {}) {
  definition = canonicalDefinition(state, definition);
  const location = currentLocation(state, definition);
  if (!location) return "The team's present location is not confirmed.";
  const lower = location.name.toLowerCase();
  const lighting = location.environment?.lighting;
  const lead = mode === "entry" ? `The team enters the ${lower}${lighting ? ` under ${lighting}` : ""}.` : mode === "arrival" ? `You arrive in the ${lower}. ${location.short_description}` : `You take stock of the ${lower}.`;
  const landmarks = (location.landmarks ?? []).map((item) => item.observation).filter(Boolean);
  const exits = visibleExits(state, definition).map(exitSentence);
  const names = nearby.length > 2 ? `${nearby.slice(0, -1).join(", ")}, and ${nearby.at(-1)}` : nearby.join(" and ");
  const people = nearby.length ? `${names} ${nearby.length > 1 ? "remain" : "remains"} within speaking range.` : "";
  return [lead, ...landmarks, ...objects, ...exits, people].filter(Boolean).join(" ");
}

function inspect(state, definition, target) {
  definition = canonicalDefinition(state, definition);
  const location = currentLocation(state, definition);
  const query = String(target ?? "").toLowerCase();
  if (!location) return { ok: false, reason: "The current location cannot be inspected." };
  if (!query || /room|area|around|orient|location/.test(query)) return { ok: true, narration: locationObservation(state, definition) };
  const matches = (location.landmarks ?? []).filter((item) => [item.id, item.name, ...(item.aliases ?? [])].some((alias) => query === String(alias).toLowerCase() || query.includes(String(alias).toLowerCase())));
  if (matches.length === 1) return { ok: true, narration: matches[0].inspection ?? matches[0].observation };
  const exit = visibleExits(state, definition).find((item) => item.aliases.some((alias) => query.includes(alias)));
  if (exit) return { ok: true, narration: `${exitSentence(exit)} ${exit.hazard && exit.hazard !== "clear" ? `Its recorded route condition is ${exit.hazard}.` : "No obstruction is visible from here."}` };
  return { ok: false, reason: `Nothing matching that description is visible in the ${location.name.toLowerCase()}.` };
}

function project(state, definition, { personnel = [], mission_markers = [] } = {}) {
  definition = canonicalDefinition(state, definition);
  const { locations, connections } = index(definition);
  const nodes = Object.entries(state.discovered_locations).map(([id, knowledge]) => {
    const location = locations[id];
    const knownLocation = (person) => person.known_location ?? state.last_confirmed_personnel_positions[person.id]?.location ?? state.personnel_locations[person.id];
    const present = personnel.filter((person) => (person.confirmed_current ?? state.personnel_locations[person.id] === state.player_location) && knownLocation(person) === id).map((person) => ({ id: person.id, name: person.name, status: "present" }));
    const lastKnown = personnel.filter((person) => !(person.confirmed_current ?? state.personnel_locations[person.id] === state.player_location) && knownLocation(person) === id).map((person) => ({ id: person.id, name: person.name, status: "last-known" }));
    return { id, name: location.name, type: location.type, status: knowledge.status, current: id === state.player_location, coordinates: clone(location.coordinates), personnel: [...present, ...lastKnown], hazards: clone(location.hazards ?? []), mission_markers: [...mission_markers, ...(state.route_markers ?? [])].filter((marker) => marker.location === id).map(clone) };
  });
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = Object.entries(state.discovered_connections).map(([id, knowledge]) => {
    const connection = connections[id];
    if (!connection || (!nodeIds.has(connection.from) && !nodeIds.has(connection.to))) return null;
    const bothKnown = nodeIds.has(connection.from) && nodeIds.has(connection.to);
    return { id, from: nodeIds.has(connection.from) ? connection.from : connection.to, to: bothKnown ? connection.to : null, status: bothKnown && knowledge.status === "confirmed" ? "confirmed" : "observed", direction: connection.direction, relationship: connection.relationship, hazard: connection.hazard_state, blocked: connection.lock_state === "blocked" || Boolean(state.blocked_paths[id]) };
  }).filter(Boolean);
  return {
    version: "yellow-beast-operational-map@v1",
    worldpack_id: state.worldpack_id,
    current_location: state.player_location,
    nodes,
    edges,
    unresolved_exits: visibleExits(state, definition).filter((item) => !item.destination_known).map((item) => ({ ref: item.ref, label: item.label, direction: item.direction, status: item.status, hazard: item.hazard })),
    route_history: state.route_history.map(clone),
    legend: [
      { code: "YOU", meaning: "current player location" },
      { code: "TEAM", meaning: "visually confirmed personnel" },
      { code: "LAST", meaning: "last confirmed personnel position" },
      { code: "?", meaning: "observed unresolved route" },
      { code: "!", meaning: "known blocked or hazardous route" }
    ]
  };
}

function interpret(state, definition, text, { personnel = [] } = {}) {
  const phrase = String(text ?? "").trim().toLowerCase();
  if (!phrase) return { kind: "invalid", reason: "State an observation or movement before acting." };
  const person = personnel.find((item) => phrase.includes(String(item.first_name ?? item.name ?? "").toLowerCase()));
  if (person && /\b(check|look|speak|ask|where|follow)\b/.test(phrase)) return { kind: /follow/.test(phrase) ? "follow" : "person", person };
  if (/\b(go|move|head|enter|return|walk|proceed|continue|follow)\b/.test(phrase) || /^(north|south|east|west|up|down|back|forward)\b/.test(phrase)) return { kind: "move", target: phrase };
  if (/\b(look|orient|inspect|examine|check|observe|survey|take stock)\b/.test(phrase)) return { kind: "inspect", target: phrase };
  return { kind: "invalid", reason: `That instruction does not identify a visible route, person, or feature.` };
}

function validateState(state, definition) {
  const errors = [];
  definition = canonicalDefinition(state, definition);
  const { locations, connections } = index(definition);
  if (state.version !== VERSION || state.worldpack_id !== definition.worldpack_id) errors.push("SPATIAL_VERSION_UNSUPPORTED");
  if (!locations[state.player_location]) errors.push("PLAYER_LOCATION_UNKNOWN");
  for (const id of Object.keys(state.discovered_locations ?? {})) if (!locations[id]) errors.push(`DISCOVERED_LOCATION_UNKNOWN:${id}`);
  for (const id of Object.keys(state.discovered_connections ?? {})) if (!connections[id]) errors.push(`DISCOVERED_CONNECTION_UNKNOWN:${id}`);
  const authoredLocations = new Set(definition.locations.slice(0, definition.locations.length - (state.generated_locations?.length ?? 0)).map((item) => item.id));
  const authoredConnections = new Set(definition.connections.slice(0, definition.connections.length - (state.generated_connections?.length ?? 0)).map((item) => item.id));
  for (const item of state.generated_locations ?? []) if (authoredLocations.has(item.id)) errors.push(`GENERATED_LOCATION_COLLISION:${item.id}`);
  for (const item of state.generated_connections ?? []) if (authoredConnections.has(item.id)) errors.push(`GENERATED_CONNECTION_COLLISION:${item.id}`);
  return errors;
}

function availableFrontiers(state) { return (state.generation?.frontiers ?? []).filter((item) => item.state === "unresolved" && item.anchor === state.player_location).map(clone); }

function expand(state, definition, frontierId = null) {
  const frontier = frontierId ?? availableFrontiers(state)[0]?.id;
  const candidate = geography.prepare(state, definition, frontier);
  if (!candidate.ok) { state.generation.recent_errors = [...(state.generation.recent_errors ?? []), { code: candidate.code, request: frontier }].slice(-5); return candidate; }
  const staged = clone(state);
  staged.generated_locations.push(candidate.location);
  staged.generated_connections.push(candidate.connection);
  const consumed = staged.generation.frontiers.find((item) => item.id === candidate.consumed_frontier);
  consumed.state = "materialized"; consumed.connection_id = candidate.connection.id; consumed.location_id = candidate.location.id;
  staged.generation.frontiers.push(candidate.next_frontier);
  staged.generation.expansion_count += 1;
  staged.generation.generated_location_count = staged.generated_locations.length;
  staged.generation.generated_connection_count = staged.generated_connections.length;
  staged.generation.last_request_id = candidate.request_id;
  const errors = validateState(staged, definition);
  if (errors.length) { state.generation.recent_errors = [...(state.generation.recent_errors ?? []), { code: "GENERATION_CANDIDATE_INVALID", errors }].slice(-5); return { ok: false, code: "GENERATION_CANDIDATE_INVALID", reason: "The new geography failed canonical validation." }; }
  state.generated_locations = staged.generated_locations; state.generated_connections = staged.generated_connections; state.generation = staged.generation;
  return { ok: true, request_id: candidate.request_id, location: clone(candidate.location), connection: clone(candidate.connection), next_frontier: clone(candidate.next_frontier) };
}

function placeMarker(state, label = "Survey marker") {
  const id = `marker-${state.player_location}-${(state.route_markers?.length ?? 0) + 1}`;
  state.route_markers ??= [];
  if (!state.route_markers.some((item) => item.id === id)) state.route_markers.push({ id, location: state.player_location, label, placed_at: state.time ?? 0, state: "placed" });
  return clone(state.route_markers.find((item) => item.id === id));
}

function canonicalSnapshot(state) {
  return { version: CANONICAL_VERSION, worldpack_id: state.worldpack_id, generated_locations: clone(state.generated_locations ?? []), generated_connections: clone(state.generated_connections ?? []), generation: clone(state.generation), route_markers: clone(state.route_markers ?? []), environment_changes: clone(state.environment_changes ?? {}), blocked_paths: clone(state.blocked_paths ?? {}) };
}

function diagnostics(state) { return { generation_version: state.generation?.version ?? null, seed_strategy: state.generation?.seed_strategy ?? null, generated_location_count: state.generated_locations?.length ?? 0, generated_connection_count: state.generated_connections?.length ?? 0, expansion_count: state.generation?.expansion_count ?? 0, unresolved_frontier_count: (state.generation?.frontiers ?? []).filter((item) => item.state === "unresolved").length, last_request_id: state.generation?.last_request_id ?? null, recent_errors: clone(state.generation?.recent_errors ?? []) }; }

module.exports = { VERSION, DEFINITION_VERSION, CANONICAL_VERSION, validateDefinition, canonicalDefinition, createState, migrate, setPhase, enterField, currentLocation, proximity, syncEquipment, visibleExits, resolveMovement, move, locationObservation, inspect, project, interpret, validateState, availableFrontiers, expand, placeMarker, canonicalSnapshot, diagnostics };
