"use strict";
const { data, read, stable } = require("./intake-lib");
const { claims, primary } = data();
const environments = read("architecture/environments.json").environments;
const topology = read("architecture/local-topology.json").connections;
const grammar = read("architecture/grammar.json").rules;
const production = read("architecture/production-references.json").references;
const ids = (items) => items.map(({ id }) => id).sort();
const architectural = ({ topic }) => topic === "architectural-observation" || topic === "architectural-grammar" || topic === "production-material";
const features = environments.flatMap(({ observed_features }) => observed_features.map(({ kind }) => kind)).sort();
process.stdout.write(stable({
  directly_verified_architectural_sources: primary.filter(({ source_ref }) => ["backrooms-pitfalls", "backrooms-found-footage-3"].includes(source_ref)).map(({ source_ref }) => source_ref).sort(),
  environment_records: ids(environments), physical_feature_counts: Object.fromEntries([...new Set(features)].map((kind) => [kind, features.filter((item) => item === kind).length])),
  topology_connections: ids(topology), uncertain_geometry: ids(environments.filter(({ uncertainties }) => uncertainties.length > 0)),
  object_placement_classifications: environments.flatMap(({ id, objects }) => objects.map(({ placement }) => ({ environment_id: id, placement }))),
  production_only_references: ids(production), grammar_patterns: ids(grammar),
  admitted_architectural_claims: ids(claims.filter((claim) => architectural(claim) && claim.review_state === "admitted")),
  interpretive_default_claims: ids(claims.filter(({ simulation_authority }) => simulation_authority === "interpretive-default")),
  rejected_overgeneralizations: ids(claims.filter((claim) => architectural(claim) && claim.review_state === "rejected")),
  remaining_pack_original_topology: []
}));
