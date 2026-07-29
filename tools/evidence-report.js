"use strict";
const { data, read, stable } = require("./intake-lib");
const { claims, primary } = data();
const admission = read("scenarios/threshold-baseline-admission.json");
const count = (predicate) => claims.filter(predicate).map(({ id }) => id).sort();
const report = {
  sources_reviewed: primary.map(({ source_ref }) => source_ref).sort(),
  sources_directly_verified: primary.filter(({ directly_checked }) => directly_checked).map(({ source_ref }) => source_ref).sort(),
  claims_extracted: count((claim) => claim.review_history.includes("claim-extracted")),
  claims_admitted: count((claim) => claim.review_state === "admitted"),
  claims_rejected: count((claim) => claim.review_state === "rejected"),
  claims_unresolved: count((claim) => claim.review_state === "needs-context"),
  threshold_baseline_dependencies: admission.dependencies.map(({ claim_id, use }) => ({ claim_id, use })).sort((a, b) => a.claim_id.localeCompare(b.claim_id)),
  pack_original_assumptions: count((claim) => claim.evidence_type === "pack-original"),
  relationships: claims.flatMap(({ id, relationships }) => relationships.map(({ relation, claim_id }) => ({ from_claim_id: id, relation, to_claim_id: claim_id }))).sort((a, b) => `${a.from_claim_id}:${a.relation}:${a.to_claim_id}`.localeCompare(`${b.from_claim_id}:${b.relation}:${b.to_claim_id}`))
};
process.stdout.write(stable(report));
