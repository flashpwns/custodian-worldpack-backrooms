"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const registry = read("canon/source-registry.json");
const claims = read("canon/claims/foundation.json").claims;
const manifest = read("manifest.json");
const scenario = read("scenario.json");
const scenarioCopy = read("scenarios/threshold-baseline.json");
const sourceIds = new Set(registry.sources.map((source) => source.id));
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
for (const claim of claims) {
  assert.match(claim.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(["authoritative", "interpretive-default", "scenario-optional", "experimental", "reference-only", "prohibited"].includes(claim.simulation_authority));
  for (const ref of claim.source_refs) assert.ok(sourceIds.has(ref), `${claim.id} references ${ref}`);
}
for (const relative of ["README.md", "canon/SOURCE_POLICY.md", "canon/source-registry-schema.json", "canon/claim-schema.json", "docs/canon-model.md", "docs/architecture.md", "docs/roadmap.md", "intake/README.md", "world/locations.json", "world/connections.json", "world/conditions.json", "world/resources.json", "world/observation-capabilities.json"]) assert.ok(fs.existsSync(path.join(root, relative)));
const scripts = ["tests/validate-assets.js", "tests/run-conformance.js"];
for (const relative of scripts) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.doesNotMatch(content, /custodian\/(runtime|state|tools)/, `${relative} uses only public Custodian imports`);
}
const packFiles = fs.readdirSync(root, { recursive: true }).filter((entry) => entry.endsWith(".js") && !entry.startsWith("node_modules/"));
assert.deepEqual(packFiles.sort(), scripts.sort(), "Yellow Beast contains no executable world-pack logic");
console.log("validated Yellow Beast canon assets and baseline manifest");
