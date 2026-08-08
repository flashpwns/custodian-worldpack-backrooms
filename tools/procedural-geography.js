"use strict";

// Pass 12B canonical geography generator. It prepares a complete candidate;
// spatial-runtime validates and commits it atomically. The persisted candidate,
// never this recipe, is historical authority after commit.
const crypto = require("node:crypto");
const VERSION = "yellow-beast-complex-geography@v1";
const SEED_STRATEGY = "sha256(world-seed|geography-domain|version|request-id)";
const clone = (value) => structuredClone(value);
const digest = (...parts) => crypto.createHash("sha256").update(parts.map(String).join("|")).digest("hex");
const number = (hex, offset = 0) => Number.parseInt(hex.slice(offset, offset + 8), 16) >>> 0;

function configuration(definition) {
  const config = definition.procedural_expansion;
  if (!config || config.version !== VERSION) return null;
  return config;
}

function initialState(definition, worldSeed) {
  const config = configuration(definition);
  return {
    version: VERSION,
    world_seed: String(worldSeed ?? "yellow-beast-world"),
    seed_strategy: SEED_STRATEGY,
    expansion_count: 0,
    generated_location_count: 0,
    generated_connection_count: 0,
    frontiers: (config?.initial_frontiers ?? []).map((item) => ({ ...clone(item), depth: 0, state: "unresolved" })),
    last_request_id: null,
    recent_errors: []
  };
}

function weightedChoice(items, value) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = value % total;
  for (const item of items) { if (cursor < item.weight) return item; cursor -= item.weight; }
  return items[0];
}

function prepare(state, definition, frontierId) {
  const config = configuration(definition);
  if (!config) return { ok: false, code: "GENERATION_NOT_CONFIGURED", reason: "This worldpack has no controlled expansion authority." };
  const frontier = state.generation.frontiers.find((item) => item.id === frontierId && item.state === "unresolved");
  if (!frontier) return { ok: false, code: "FRONTIER_UNAVAILABLE", reason: "No unresolved continuation is available here." };
  if (state.generation.expansion_count >= config.bounds.max_expansions || state.generation.generated_location_count >= config.bounds.max_locations || frontier.depth >= config.bounds.max_depth) return { ok: false, code: "GENERATION_BOUND_REACHED", reason: "The controlled survey boundary has reached its configured limit." };

  const ordinal = state.generation.expansion_count + 1;
  const requestId = `expand:${frontier.id}:${ordinal}:d${frontier.depth + 1}`;
  const hash = digest(state.generation.world_seed, "geography", VERSION, requestId);
  const archetype = weightedChoice(config.archetypes, number(hash, 0));
  const feature = weightedChoice(config.mundane_features, number(hash, 8));
  const locationId = `g-loc-${hash.slice(0, 16)}`;
  const connectionId = `g-route-${hash.slice(16, 32)}`;
  const nextFrontierId = `g-frontier-${hash.slice(32, 48)}`;
  const base = [...definition.locations, ...(state.generated_locations ?? [])].find((item) => item.id === frontier.anchor);
  if (!base) return { ok: false, code: "FRONTIER_ANCHOR_MISSING", reason: "The expansion anchor is no longer canonical." };
  const dx = 85 + (number(hash, 40) % 36);
  const dy = ((number(hash, 48) % 3) - 1) * 55;
  const location = {
    id: locationId,
    name: `${archetype.label} ${String(ordinal).padStart(2, "0")}`,
    type: archetype.type,
    short_description: `${archetype.description} ${feature.description}`,
    coordinates: { x: (base.coordinates?.x ?? 0) + dx, y: (base.coordinates?.y ?? 0) + dy, level: base.coordinates?.level ?? 0 },
    entry_state: "unmapped",
    environment: clone(archetype.environment),
    landmarks: [{ id: `${locationId}-feature`, name: feature.label, aliases: feature.aliases, observation: feature.observation, inspection: feature.inspection }],
    hazards: [],
    tags: ["field", "generated", "mundane", archetype.type],
    generation: { version: VERSION, request_id: requestId, frontier_id: frontier.id, depth: frontier.depth + 1 }
  };
  const connection = {
    id: connectionId, from: frontier.anchor, to: locationId,
    direction: frontier.direction ?? "forward", reverse_direction: "back",
    relationship: archetype.relationship, transition: archetype.transition,
    reverse_transition: "The team retraces the surveyed route.", requirements: [], lock_state: "open",
    hazard_state: "clear", visibility: "visible", discovery: "on-traversal", bidirectional: true,
    aliases: [archetype.label.toLowerCase(), "unresolved continuation", "forward"],
    generation: { version: VERSION, request_id: requestId, frontier_id: frontier.id }
  };
  const nextFrontier = { id: nextFrontierId, anchor: locationId, direction: archetype.next_direction ?? "forward", label: "Unsurveyed continuation", depth: frontier.depth + 1, state: "unresolved", parent_request_id: requestId };
  return { ok: true, request_id: requestId, location, connection, consumed_frontier: frontier.id, next_frontier: nextFrontier };
}

module.exports = { VERSION, SEED_STRATEGY, configuration, initialState, prepare };
