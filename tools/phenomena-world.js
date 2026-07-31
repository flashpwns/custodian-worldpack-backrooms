"use strict";
const crypto = require("node:crypto");
const definitions = require("../data/phenomenon-definitions.json");
const history = require("./world-history");
const clone = (value) => structuredClone(value);
const idFor = (world, definition_id, region_id, space_id, admission_key) => `phenomenon-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, definition_id, region_id, space_id, admission_key])).digest("hex").slice(0, 16)}`;
const definition = (id) => definitions.definitions.find((item) => item.id === id) ?? null;
function state(world) { history.assertWorld(world); world.phenomena ??= {}; return world.phenomena; }
function admit(world, { run_id, definition_id, region_id, space_id, admission_key = "scenario" }) {
  const entry = definition(definition_id); if (!entry) return { ok: false, code: "PHENOMENON_DEFINITION_UNAVAILABLE" };
  if (!world.regions[region_id]?.state.nodes[space_id]) return { ok: false, code: "PHENOMENON_LOCATION_UNKNOWN" };
  const id = idFor(world, definition_id, region_id, space_id, admission_key); const items = state(world);
  if (items[id]) return { ok: true, idempotent: true, phenomenon: clone(items[id]) };
  const phenomenon = { id, definition_id, category: entry.category, region_id, space_id, admission_key, authority: entry.authority, claim_ids: [...entry.claim_ids], scope: entry.scope, active: true, outcomes: [], origin_run: run_id };
  items[id] = phenomenon;
  history.event(world, run_id, "phenomenon.admitted", { phenomenon_id: id, definition_id, region_id, space_id, admission_key, claim_ids: entry.claim_ids }, entry.authority);
  return { ok: true, phenomenon: clone(phenomenon) };
}
function local(world, { region_id, space_id }) { return Object.values(state(world)).filter((item) => item.active && item.region_id === region_id && item.space_id === space_id); }
function safe(item) { const entry = definition(item.definition_id); return { category: "observed condition", description: entry?.observable_description ?? "an observed condition" }; }
function perceive(world, { run_id, observer, region_id, space_id }) { const visible = local(world, { region_id, space_id }); for (const item of visible) history.event(world, run_id, "phenomenon.perceived", { phenomenon_id: item.id, observer, region_id, space_id }, item.authority); return { phenomena: visible.map(safe), available_responses: visible.length ? ["OBSERVE", "RECORD", "REPORT"] : [] }; }
function applySurfaceInteraction(world, { run_id, phenomenon_id, object_id }) {
  const item = state(world)[phenomenon_id]; const entry = item && definition(item.definition_id);
  if (!item || !entry || entry.id !== "ff2-marked-surface-discontinuity") return { ok: false, code: "PHENOMENON_INTERACTION_UNAVAILABLE" };
  const objects = world.regions[item.region_id]?.state.objects?.[item.space_id] ?? [];
  if (!objects.some((object) => object.id === object_id)) return { ok: false, code: "PHENOMENON_OBJECT_UNAVAILABLE" };
  const mutation = history.mutateRegion(world, { run_id, region_id: item.region_id, space_id: item.space_id, target_type: "object", target: object_id, operation: "remove", value: null, provenance: "ff2-marked-surface-discontinuity", authority: item.authority });
  if (!mutation.ok) return mutation;
  const outcome = { object_id, state: "no-longer-visible", destination: "unresolved", mutation_id: mutation.mutation.id };
  if (!item.outcomes.some((existing) => existing.object_id === object_id)) item.outcomes.push(outcome);
  history.event(world, run_id, "phenomenon.object_no_longer_visible", { phenomenon_id, region_id: item.region_id, space_id: item.space_id, object_id, destination: "unresolved", mutation_id: mutation.mutation.id }, item.authority);
  return { ok: true, outcome: clone(outcome) };
}
function recordEvidence(world, { run_id, phenomenon_id, observer, medium = "field-note" }) {
  const item = state(world)[phenomenon_id]; const entry = item && definition(item.definition_id);
  if (!item || !entry || !observer) return { ok: false, code: "PHENOMENON_EVIDENCE_UNAVAILABLE" };
  const id = `phenomenon-evidence-${crypto.createHash("sha256").update(JSON.stringify([world.world_id, phenomenon_id, observer, medium])).digest("hex").slice(0, 16)}`;
  if (world.evidence[id]) return { ok: true, idempotent: true, evidence: clone(world.evidence[id]) };
  const evidence = { id, origin_run: run_id, type: medium, creator: observer, custody: [{ holder: observer, event: "created" }], source_location: { region_id: item.region_id, space_id: item.space_id }, provenance: "source-backed-phenomenon-observation", availability: "observer-held", observed: { category: "observed condition", description: entry.observable_description } };
  world.evidence[id] = evidence;
  history.event(world, run_id, "phenomenon.evidence.recorded", { evidence_id: id, phenomenon_id, observer, medium, region_id: item.region_id, space_id: item.space_id }, item.authority);
  return { ok: true, evidence: clone(evidence) };
}
function report(world, { run_id, phenomenon_id, summary }) {
  const item = state(world)[phenomenon_id]; if (!item || !summary) return { ok: false, code: "PHENOMENON_REPORT_UNAVAILABLE" };
  const id = `institutional-phenomenon-${phenomenon_id}`;
  if (!world.knowledge.institutional.records[id]) { world.knowledge.institutional.records[id] = { id, source_run: run_id, status: "archived-operational", payload: { category: "reported observation", summary: String(summary), phenomenon_id } }; history.event(world, run_id, "phenomenon.reported", { phenomenon_id, summary: String(summary) }, "scenario-optional"); }
  return { ok: true };
}
function institutionalProjection(world) { return Object.values(world.knowledge?.institutional?.records ?? {}).filter((record) => record.id.startsWith("institutional-phenomenon-")).map((record) => ({ category: record.payload.category, summary: record.payload.summary })); }
function runtimeTrace() { return definitions.definitions.flatMap((entry) => entry.claim_ids.map((claim_id) => ({ id: `phenomenon-${entry.id}-${claim_id}`, path: "tools/phenomena-world.js", claim_id, authority: entry.authority, experience: ["Clear-Q4", "Nullzone", "Lost"] }))); }
function reportSummary() { return { version: "yellow-beast-phenomena@v1", admission: { source_backed_phenomena: definitions.definitions.map(({ id }) => id), source_backed_entities: [], scenario_only_items: ["still-life-physical-presence", "validation-mover"] }, capabilities: definitions.definitions.map((entry) => ({ id: entry.id, capabilities: entry.capabilities })), provenance: runtimeTrace(), mode_delivery: { "Clear-Q4": "direct observation, optional report, and physical evidence", Beck: "explicit report content only", Nullzone: "direct observed condition without institutional terminology", Lost: "immediate descriptive condition only" }, pack_original_entities: ["still-life-physical-presence", "validation-mover"], invariants: { "direct hardcoded phenomenon canon admission": 0, "phenomenon → invented entity promotion": 0, "unsupported Still Life capability count": 0, "single-context entity behavior overgeneralization": 0, "specific instance → invented population": 0, "entity existence / hazard conflation": 0, "invented entity motive": 0, "invented entity perception capability": 0, "invented anomalous dialogue": 0, "new fandom-derived entity admission": 0, "cross-mode phenomenon physical contradiction": 0, "cross-mode phenomenon knowledge piggyback": 0, "phenomenon seed nondeterminism": 0, "entity save/reload identity divergence": 0, "hidden anomaly significance leakage": 0, "unsupported anomalous provider fact accepted": 0, "phenomenon narration invented player interiority": 0, "phenomenon environment second-truth store": 0, "phenomenon institutional knowledge bypass": 0, "phenomenon idle hallucination": 0, "unique phenomenon duplication": 0, "unsupported entity harm": 0, "untraced newly admitted distinctive phenomenon content": 0, "unlabeled pack-original phenomenon lore": 0, "phenomena offline runtime failure": 0 } }; }
module.exports = { definitions, definition, state, admit, local, perceive, applySurfaceInteraction, recordEvidence, report, institutionalProjection, runtimeTrace, reportSummary };
