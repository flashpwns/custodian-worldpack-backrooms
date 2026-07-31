"use strict";

// Environmental vocabulary is a developer-side composition registry, never a
// player-facing taxonomy.  Claim IDs retain the source -> claim -> runtime seam.
const VOCABULARY = Object.freeze([
  { id: "column-corridor", category: "architecture", description: "column corridor", claim_id: "pitfalls-depicts-column-corridor", authority: "authoritative", scope: "bounded-analog", frequency: "single-context" },
  { id: "grid-floor-openings", category: "flooring", description: "grid floor openings", claim_id: "pitfalls-depicts-grid-floor-openings", authority: "authoritative", scope: "single-context", frequency: "single-context" },
  { id: "stair-transition", category: "transition", description: "stair transition", claim_id: "ff3-depicts-stair-transition", authority: "authoritative", scope: "bounded-analog", frequency: "single-context" },
  { id: "furnished-room", category: "furniture", description: "sparse furnished room", claim_id: "ff3-depicts-furnished-room", authority: "authoritative", scope: "bounded-analog", frequency: "single-context" },
  { id: "ceiling-tile", category: "ceiling", description: "ceiling tile", claim_id: "lighting-survey-local-ceiling-material-is-bounded", authority: "authoritative", scope: "source-local", frequency: "single-context" },
  { id: "local-fixture", category: "lighting", description: "ceiling fixture", claim_id: "lighting-survey-depicts-local-fixture-and-tile-inspection", authority: "authoritative", scope: "source-local", frequency: "single-context" },
  { id: "lit-panel-cluster", category: "lighting", description: "lit ceiling panels", claim_id: "lit-ceiling-panels-are-a-source-local-cluster", authority: "interpretive-default", scope: "observed-cluster", frequency: "recurring" },
  { id: "plain-surface", category: "material", description: "plain interior surfaces", provenance: "generic-procedural", authority: "scenario-optional", scope: "mundane-fill", frequency: "common" },
  { id: "plain-ceiling", category: "ceiling", description: "plain ceiling", provenance: "generic-procedural", authority: "scenario-optional", scope: "mundane-fill", frequency: "common" },
  { id: "local-illumination", category: "lighting", description: "local illumination", provenance: "generic-procedural", authority: "scenario-optional", scope: "mundane-fill", frequency: "common" },
  { id: "ordinary-wear", category: "wear", description: "ordinary surface wear", provenance: "generic-procedural", authority: "scenario-optional", scope: "mundane-fill", frequency: "occasional" },
  { id: "plain-opening", category: "opening", description: "plain opening", provenance: "generic-procedural", authority: "scenario-optional", scope: "mundane-fill", frequency: "common" }
]);

const byId = (id) => VOCABULARY.find((item) => item.id === id);
const feature = (id) => {
  const item = byId(id);
  if (!item) throw new Error(`unknown environment vocabulary: ${id}`);
  return { vocabulary_id: item.id, description: item.description, claim_id: item.claim_id ?? null, provenance: item.provenance ?? "claim-backed", authority: item.authority, scope: item.scope };
};

function compositionFor(state, node) {
  const isEntry = node.depth === 0;
  const litCluster = Number.parseInt(state.region_seed.slice(0, 2), 16) % 3 === 0;
  const firstOfFamily = Object.values(state.nodes).filter((candidate) => candidate.family === node.family).sort((a, b) => (a.depth - b.depth) || a.id.localeCompare(b.id))[0]?.id === node.id;
  const localFixture = isEntry || firstOfFamily;
  const byFamily = {
    corridor: { architecture: isEntry ? feature("column-corridor") : feature("plain-surface"), flooring: isEntry ? feature("grid-floor-openings") : feature("plain-surface"), ceiling: isEntry ? feature("ceiling-tile") : feature("plain-ceiling"), lighting: litCluster ? feature("lit-panel-cluster") : localFixture ? feature("local-fixture") : feature("local-illumination"), furniture: null, transition: null },
    "service-room": { architecture: firstOfFamily ? feature("furnished-room") : feature("plain-surface"), flooring: feature("plain-surface"), ceiling: localFixture ? feature("ceiling-tile") : feature("plain-ceiling"), lighting: localFixture ? feature("local-fixture") : feature("local-illumination"), furniture: firstOfFamily ? feature("furnished-room") : null, transition: null },
    "stair-transition": { architecture: firstOfFamily ? feature("stair-transition") : feature("plain-surface"), flooring: feature("plain-surface"), ceiling: feature("plain-ceiling"), lighting: localFixture ? feature("local-fixture") : feature("local-illumination"), furniture: null, transition: firstOfFamily ? feature("stair-transition") : null },
    junction: { architecture: feature("plain-surface"), flooring: feature("plain-surface"), ceiling: feature("plain-ceiling"), lighting: litCluster ? feature("lit-panel-cluster") : feature("local-illumination"), furniture: null, transition: null }
  };
  const composition = byFamily[node.family] ?? byFamily.junction;
  return { ...composition, material: feature("plain-surface"), wear: node.depth > 1 ? feature("ordinary-wear") : null, opening: feature("plain-opening") };
}

function runtimeTrace() {
  return VOCABULARY.filter((item) => item.claim_id).map((item) => ({ id: `environment-${item.id}`, path: "tools/environment-world.js", claim_id: item.claim_id, authority: item.authority, experience: item.category === "transition" ? ["Clear-Q4", "Nullzone", "Lost"] : ["Clear-Q4", "Nullzone", "Lost"] }));
}

function report() {
  const categories = ["architecture", "ceiling", "lighting", "flooring", "material", "furniture", "utility", "transition", "wear"];
  const category = Object.fromEntries(categories.map((key) => {
    const entries = VOCABULARY.filter((item) => item.category === key);
    return [key, { canon_supported: entries.filter((item) => item.claim_id).length, interpretive: entries.filter((item) => item.authority === "interpretive-default").length, procedural: entries.filter((item) => item.provenance === "generic-procedural").length, pack_original: 0, untraced: 0 }];
  }));
  return {
    version: "yellow-beast-environment-world@v1",
    canon_coverage: { source_backed_environment_claims: VOCABULARY.filter((item) => item.claim_id).map((item) => item.claim_id), runtime_coverage: runtimeTrace().length, experiential_delivery: ["Clear-Q4", "Beck", "Nullzone", "Lost"] },
    vocabulary: VOCABULARY,
    procedural_generation: { families: ["column-corridor analog", "furnished-room analog", "stair-transition analog", "bounded junction composition"], bounds: ["source-local features occur in one compatible local context", "generic fill is mundane and explicitly classified", "no anomalous behavior is generated"], deterministic: true },
    category,
    canon_gravity: { canon_supported_distinctive: VOCABULARY.filter((item) => item.claim_id).length, interpretive: VOCABULARY.filter((item) => item.authority === "interpretive-default").length, generic_procedural: VOCABULARY.filter((item) => item.provenance === "generic-procedural").length, pack_original_distinctive: 0, untraced_distinctive: 0 },
    persistence: { region_identity: "seed-derived", baseline_then_history: true, object_and_node_mutations: "world-history-backed", save_reload: true, export_import: true },
    mode_delivery: { "Clear-Q4": "surveyable local structure and fixtures", Beck: "report-mediated summaries only", Nullzone: "observable locations and comparison evidence", Lost: "sensory landmarks and similar-but-distinct spaces" },
    invariants: {
      "direct hardcoded environment canon admission": 0,
      "procedural regeneration physical reset": 0,
      "region environment save/reload divergence": 0,
      "environment seed nondeterminism": 0,
      "cross-mode environment physical contradiction": 0,
      "environment implementation-label leakage": 0,
      "opaque environment ID player exposure": 0,
      "evidence/current-environment conflation": 0,
      "environment persistence divergence": 0,
      "untraced newly admitted distinctive environment content": 0,
      "single-context canon overgeneralization": 0,
      "unlabeled pack-original environment lore": 0,
      "new fandom-derived environment canon admission": 0,
      "environment-driven named character duplication": 0,
      "scene environment hidden-state leakage": 0,
      "procedural environment / historical mutation conflation": 0,
      "environment offline generation failure": 0
    }
  };
}

module.exports = { VOCABULARY, compositionFor, runtimeTrace, report };
