"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const grammar = JSON.parse(fs.readFileSync(path.join(root, "data/procedural-grammar.json"), "utf8"));
const VERSION = grammar.version;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clone = (value) => structuredClone(value);
const choices = ["corridor-analog", "junction-composition", "service-room-analog", "stair-transition-analog"];
const rule = (id) => grammar.rules.find((entry) => entry.id === id);
const pick = (seed, values) => values[Number.parseInt(hash(seed).slice(0, 8), 16) % values.length];
const short = (value) => hash(value).slice(0, 7);
function safeAlias(node) { const names = { corridor: "corridor", junction: "junction", "service-room": "utility-room", "stair-transition": "stairwell", staging: "survey-boundary" }; return `${names[node.family] ?? "space"}-${short(node.id)}`; }
function makeNode(state, lineage, ruleId, depth) {
  const source = rule(ruleId); if (!source || source.generalization === "prohibited") throw new Error("invalid generator rule");
  const id = `space-${short([state.region_seed, lineage, ruleId])}`;
  if (state.nodes[id]) return state.nodes[id];
  const node = { id, seed_lineage: lineage, grammar_rule_id: ruleId, family: source.family, authority: source.authority, pack_original: source.pack_original, depth, environment: { lighting_rule_id: "lit-fixture-local-analog", material_rule_id: "worn-material-composition" }, features: [{ id: `feature-${short([id, "fixture"])}`, kind: "fixture", authority: "authoritative-local-analog" }, { id: `feature-${short([id, "surface"])}`, kind: "surface", authority: "scenario-optional" }], discovered_by: [], alias: safeAlias({ id, family: source.family }) };
  state.nodes[id] = node; return node;
}
function initialize({ seed, observer }) {
  const state = { version: VERSION, region_seed: hash(["region", seed]), max_nodes: 6, nodes: {}, edges: {}, frontier: [], discovery: { [observer]: { spaces: [], edges: [], features: [] } }, current: {}, materialized: true };
  const start = makeNode(state, "entry", "corridor-analog", 0); state.current[observer] = start.id; discover(state, observer, start.id); addFrontier(state, start.id, "entry-forward"); return state;
}
function discover(state, observer, nodeId) { const known = state.discovery[observer] ?? (state.discovery[observer] = { spaces: [], edges: [], features: [] }); if (!known.spaces.includes(nodeId)) known.spaces.push(nodeId); const node = state.nodes[nodeId]; if (node && !node.discovered_by.includes(observer)) node.discovered_by.push(observer); }
function addFrontier(state, from, lineage) { if (Object.keys(state.nodes).length >= state.max_nodes) return null; const id = `edge-${short([state.region_seed, from, lineage])}`; if (state.edges[id]) return state.edges[id]; const edge = { id, from, to: null, type: "unknown-opening", grammar_rule_id: "unknown-frontier-opening", authority: "scenario-optional", traversable: true, destination_state: "unknown", lineage }; state.edges[id] = edge; state.frontier.push(id); return edge; }
function visible(state, observer) { const current = state.current[observer]; const node = state.nodes[current]; const known = state.discovery[observer] ?? { spaces: [], edges: [], features: [] }; const exits = Object.values(state.edges).filter((edge) => edge.from === current).map((edge) => ({ alias: `passage-${short(edge.id)}`, edge_id: edge.id, destination_known: edge.to ? known.spaces.includes(edge.to) : false })); return { location: { alias: node.alias, family: node.family, lighting: "local fixture illumination", authority: node.authority }, features: node.features.map((feature) => ({ alias: `${feature.kind}-${short(feature.id)}`, kind: feature.kind })), exits }; }
function resolveAlias(state, observer, alias) { const view = visible(state, observer); const exit = view.exits.find((entry) => entry.alias === alias); if (exit) return { type: "edge", id: exit.edge_id }; const feature = state.nodes[state.current[observer]].features.find((entry) => `${entry.kind}-${short(entry.id)}` === alias); if (feature) return { type: "feature", id: feature.id }; return null; }
function move(state, observer, alias) { const ref = resolveAlias(state, observer, alias); if (!ref || ref.type !== "edge") return { ok: false, public_reason: "target unavailable" }; const edge = state.edges[ref.id]; let destination = edge.to && state.nodes[edge.to]; if (!destination) { if (Object.keys(state.nodes).length >= state.max_nodes) return { ok: false, public_reason: "route unavailable" }; const selected = pick([state.region_seed, edge.lineage], choices); destination = makeNode(state, edge.lineage, selected, state.nodes[edge.from].depth + 1); edge.to = destination.id; edge.destination_state = "materialized"; state.frontier = state.frontier.filter((id) => id !== edge.id); addFrontier(state, destination.id, `${edge.lineage}:forward`); if (destination.family === "junction") addFrontier(state, destination.id, `${edge.lineage}:branch`); }
  state.current[observer] = destination.id; discover(state, observer, destination.id); const known = state.discovery[observer]; if (!known.edges.includes(edge.id)) known.edges.push(edge.id); return { ok: true, public_reason: null, view: visible(state, observer) };
}
function inspect(state, observer, alias) { const ref = resolveAlias(state, observer, alias); if (!ref || ref.type !== "feature") return { ok: false, public_reason: "target unavailable" }; const node = state.nodes[state.current[observer]]; const feature = node.features.find((entry) => entry.id === ref.id); const known = state.discovery[observer]; if (!known.features.includes(feature.id)) known.features.push(feature.id); return { ok: true, detail: { alias, kind: feature.kind, location: node.alias, authority: feature.authority } }; }
function map(state, observer) { const known = state.discovery[observer] ?? { spaces: [], edges: [] }; return { spaces: known.spaces.map((id) => ({ alias: state.nodes[id].alias, family: state.nodes[id].family })), connections: known.edges.map((id) => { const edge = state.edges[id]; return { from: state.nodes[edge.from].alias, to: edge.to && known.spaces.includes(edge.to) ? state.nodes[edge.to].alias : "unknown" }; }), unknown_exits: visible(state, observer).exits.filter((entry) => !entry.destination_known).map(({ alias }) => alias) }; }
function validate(state) { const errors = []; if (state.version !== VERSION) errors.push("GENERATOR_VERSION_UNSUPPORTED"); for (const node of Object.values(state.nodes)) { const entry = rule(node.grammar_rule_id); if (!entry || !node.authority || entry.generalization === "prohibited") errors.push(`INVALID_NODE:${node.id}`); } for (const edge of Object.values(state.edges)) { if (!state.nodes[edge.from] || (edge.to && !state.nodes[edge.to])) errors.push(`ORPHAN_EDGE:${edge.id}`); } return errors; }
module.exports = { VERSION, grammar, initialize, visible, resolveAlias, move, inspect, map, validate, clone };
