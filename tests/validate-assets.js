"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const registry = read("canon/source-registry.json");
const claims = read("canon/claims/foundation.json").claims;
const intake = read("intake/records/representative-sources.json");
const admission = read("scenarios/threshold-baseline-admission.json");
const manifest = read("manifest.json");
const scenario = read("scenario.json");
const scenarioCopy = read("scenarios/threshold-baseline.json");
const sourceIds = new Set(registry.sources.map((source) => source.id));
const claimIds = new Set(claims.map((claim) => claim.id));
const reviewStates = new Set(["unreviewed", "triaged", "source-verified", "claim-extracted", "canon-reviewed", "admitted", "rejected", "superseded", "needs-context"]);
const relations = new Set(["supports", "contradicts", "qualifies", "supersedes", "contextualizes", "duplicates", "derived-from"]);
assert.equal(registry.version, "source-registry/v1");
assert.ok(registry.sources.length >= 10 && registry.sources.length <= 20);
assert.equal(manifest.id, "yellow-beast");
assert.equal(manifest.version, "0.1.0-alpha");
assert.equal(manifest.kernel_compatibility, "canonical-kernel@v1");
assert.deepEqual(scenario, scenarioCopy);
for (const source of registry.sources) {
  assert.match(source.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(source.source_type && source.project_scope && source.source_locator);
}
for (const record of intake.records) {
  assert.ok(sourceIds.has(record.source_ref), `${record.id} references a known source`);
  assert.ok(reviewStates.has(record.review_state), `${record.id} has a review state`);
  assert.equal(record.raw_reference.external_only, true, `${record.id} leaves raw material external`);
  assert.ok(["confirmed", "probable", "unresolved", "unrelated"].includes(record.project_identification.relationship));
  assert.ok(["backrooms", "film", "another-kane-project", "personal-test", "community-work", "unknown"].includes(record.project_identification.project));
  for (const relationship of record.source_relationships) assert.ok(sourceIds.has(relationship.source_ref), `${record.id} source relationship resolves`);
}
for (const claim of claims) {
  assert.match(claim.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(["authoritative", "interpretive-default", "scenario-optional", "experimental", "reference-only", "prohibited"].includes(claim.simulation_authority));
  assert.ok(reviewStates.has(claim.review_state), `${claim.id} has a review state`);
  assert.ok(claim.extraction.locator && claim.extraction.summary, `${claim.id} preserves a non-verbatim extraction record`);
  for (const ref of claim.source_refs) assert.ok(sourceIds.has(ref), `${claim.id} references ${ref}`);
  for (const relationship of claim.relationships) {
    assert.ok(relations.has(relationship.relation), `${claim.id} uses a known relation`);
    assert.ok(claimIds.has(relationship.claim_id), `${claim.id} relationship resolves`);
  }
}
for (const dependency of admission.dependencies) {
  const claim = claims.find((candidate) => candidate.id === dependency.claim_id);
  assert.ok(claim, `${dependency.claim_id} is an existing scenario dependency`);
  if (dependency.use === "authoritative-world-state") {
    assert.equal(claim.review_state, "admitted", `${dependency.claim_id} is admitted`);
    assert.equal(claim.simulation_authority, "authoritative", `${dependency.claim_id} has authoritative scenario authority`);
  }
  assert.notEqual(claim.simulation_authority, "prohibited", `${dependency.claim_id} is not prohibited`);
  assert.notEqual(claim.review_state, "rejected", `${dependency.claim_id} is not rejected`);
}
for (const relative of ["README.md", "canon/SOURCE_POLICY.md", "canon/source-registry-schema.json", "canon/source-intake-schema.json", "canon/claim-schema.json", "canon/scenario-admission-schema.json", "docs/canon-model.md", "docs/architecture.md", "docs/roadmap.md", "docs/intake-workflow.md", "intake/README.md", "intake/records/representative-sources.json", "scenarios/threshold-baseline-admission.json", "tools/README.md", "world/locations.json", "world/connections.json", "world/conditions.json", "world/resources.json", "world/observation-capabilities.json"]) assert.ok(fs.existsSync(path.join(root, relative)));
const scripts = ["tests/validate-assets.js", "tests/validate-contracts.js", "tests/intake-model.test.js", "tests/run-conformance.js", "tools/intake-lib.js", "tools/register-source.js", "tools/create-claim-stub.js", "tools/link-claims.js", "tools/promote-review.js", "tools/check-admission.js", "tools/intake-summary.js"];
for (const relative of scripts) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.doesNotMatch(content, /custodian\/(runtime|state|tools)/, `${relative} uses only public Custodian imports`);
}
const packFiles = fs.readdirSync(root, { recursive: true }).filter((entry) => entry.endsWith(".js") && !entry.startsWith("node_modules/"));
assert.deepEqual(packFiles.sort(), scripts.sort(), "Yellow Beast contains no executable world-pack logic");
console.log("validated Yellow Beast canon intake assets and baseline manifest");
