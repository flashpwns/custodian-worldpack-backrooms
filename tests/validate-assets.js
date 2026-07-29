"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const registry = read("canon/source-registry.json");
const claims = [...read("canon/claims/foundation.json").claims, ...read("canon/claims/operations.json").claims, ...read("canon/claims/recovered-records.json").claims, ...read("canon/claims/architecture.json").claims, ...read("canon/claims/environmental-survey.json").claims, ...read("canon/claims/anomalies.json").claims];
const intake = read("intake/records/representative-sources.json");
const admission = read("scenarios/threshold-baseline-admission.json");
const verifiedPrimary = [...read("canon/verified-primary-sources.json").sources, ...read("canon/verified-expedition-sources.json").sources, ...read("canon/verified-recovered-record-sources.json").sources, ...read("canon/verified-architecture-sources.json").sources, ...read("canon/verified-survey-sources.json").sources, ...read("canon/verified-anomaly-sources.json").sources];
const evidenceObjects = read("operations/evidence-objects.json").evidence;
const communicationRecords = read("operations/communication-records.json").records;
const recoveredRecords = read("records/recovered-records.json").records;
const derivedReports = read("records/derived-reports.json").reports;
const recordFixture = read("records/record-review-smoke-test.json");
const environmentalConditions = read("environment/conditions.json").conditions;
const surveyObservations = read("environment/surveys.json").observations;
const sourceLocalEnvironments = read("environment/source-local-environments.json").environments;
const anomalyObservations = read("anomalies/observations.json").observations;
const anomalyInteractions = read("anomalies/interactions.json").interactions;
const anomalyChronology = read("anomalies/chronology.json").relationships;
const anomalyTerms = read("anomalies/terminology.json").terms;
const manifest = read("manifest.json");
const scenario = read("scenario.json");
const scenarioCopy = read("scenarios/threshold-baseline.json");
const sourceIds = new Set(registry.sources.map((source) => source.id));
const claimIds = new Set(claims.map((claim) => claim.id));
const reviewStates = new Set(["unreviewed", "triaged", "source-verified", "claim-extracted", "canon-reviewed", "admitted", "rejected", "superseded", "needs-context"]);
const relations = new Set(["supports", "contradicts", "qualifies", "supersedes", "contextualizes", "duplicates", "derived-from"]);
const locatorById = new Map(verifiedPrimary.flatMap((source) => source.locators.map((locator) => [locator.id, { locator, source }])));
const observerIds = new Set(scenario.observers.map(({ id }) => id));
const ruleIds = new Set(manifest.execution_rules.map(({ id }) => id));
const scheduledIds = new Set(scenario.scheduled_events.map(({ id }) => id));
const evidenceIds = new Set(evidenceObjects.map(({ id }) => id));
const recoveredRecordIds = new Set(recoveredRecords.map(({ id }) => id));
const environmentIds = new Set([...read("architecture/environments.json").environments.map(({ id }) => id), ...sourceLocalEnvironments.map(({ id }) => id)]);
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
  assert.ok(claim.review_history.includes(claim.review_state), `${claim.id} history reaches its current state`);
  assert.ok(claim.extraction.locator && claim.extraction.summary, `${claim.id} preserves a non-verbatim extraction record`);
  for (const ref of claim.source_refs) assert.ok(sourceIds.has(ref), `${claim.id} references ${ref}`);
  for (const relationship of claim.relationships) {
    assert.ok(relations.has(relationship.relation), `${claim.id} uses a known relation`);
    assert.ok(claimIds.has(relationship.claim_id), `${claim.id} relationship resolves`);
  }
  for (const locatorRef of claim.locator_refs) {
    const resolved = locatorById.get(locatorRef);
    assert.ok(resolved, `${claim.id} locator ${locatorRef} resolves`);
    assert.ok(claim.source_refs.includes(resolved.source.source_ref), `${claim.id} locator source is declared`);
  }
  if (claim.simulation_authority === "authoritative" && claim.evidence_type !== "pack-original") {
    assert.equal(claim.review_state, "admitted", `${claim.id} authoritative primary claim is admitted`);
    assert.ok(claim.locator_refs.length > 0, `${claim.id} has a verified locator`);
    for (const locatorRef of claim.locator_refs) assert.equal(locatorById.get(locatorRef).source.directly_checked, true, `${claim.id} uses a directly checked source`);
  }
}
for (const source of verifiedPrimary) {
  assert.ok(sourceIds.has(source.source_ref), `${source.id} references a known source`);
  assert.equal(source.directly_checked, true, `${source.id} is directly checked`);
  assert.equal(source.transcript_assisted, false, `${source.id} did not rely on a transcript`);
  for (const locator of source.locators) assert.match(locator.start, /^\d{2}:\d{2}:\d{2}$/);
}
for (const evidence of evidenceObjects) {
  assert.ok(observerIds.has(evidence.creator), `${evidence.id} creator resolves`);
  assert.ok(observerIds.has(evidence.current_custodian), `${evidence.id} custodian resolves`);
  assert.ok(evidence.creation_ref.kind !== "execution-rule" || ruleIds.has(evidence.creation_ref.id), `${evidence.id} creation rule resolves`);
  for (const transfer of evidence.transfer_history) {
    assert.ok(observerIds.has(transfer.from) && observerIds.has(transfer.to), `${evidence.id} transfer actors resolve`);
    assert.ok(scheduledIds.has(transfer.record_ref), `${evidence.id} transfer record resolves`);
  }
  for (const claimRef of evidence.claim_refs) assert.ok(claimIds.has(claimRef), `${evidence.id} claim resolves`);
}
for (const record of communicationRecords) {
  assert.ok(scheduledIds.has(record.source_event), `${record.id} source event resolves`);
  assert.ok(observerIds.has(record.sender), `${record.id} sender resolves`);
  for (const recipient of [...record.intended_recipients, ...record.actual_recipients, ...record.recipient_access]) assert.ok(observerIds.has(recipient), `${record.id} recipient resolves`);
  assert.deepEqual(record.actual_recipients, record.recipient_access, `${record.id} models receipt explicitly, not universal delivery`);
  for (const claimRef of record.claim_refs) assert.ok(claimIds.has(claimRef), `${record.id} claim resolves`);
}
for (const record of recoveredRecords) {
  assert.ok(evidenceIds.has(record.origin_evidence_id), `${record.id} origin resolves`);
  assert.ok(observerIds.has(record.creator), `${record.id} creator resolves`);
  assert.ok(observerIds.has(record.recovery.recovering_actor), `${record.id} recovering actor resolves`);
  assert.ok(observerIds.has(record.current_custodian), `${record.id} custodian resolves`);
  assert.ok(recordFixture.recovery_events.includes(record.recovery.record_ref), `${record.id} recovery is explicit`);
  for (const access of record.access_history) assert.ok(observerIds.has(access.actor) && recordFixture.access_events.includes(access.record_ref), `${record.id} access is explicit`);
  for (const review of record.review_history) {
    assert.ok(observerIds.has(review.actor) && recordFixture.review_events.includes(review.record_ref), `${record.id} review is explicit`);
    for (const claimRef of review.claim_refs) assert.ok(claimIds.has(claimRef), `${record.id} review claim resolves`);
  }
  for (const reportRef of record.derived_report_refs) assert.ok(derivedReports.some(({ id }) => id === reportRef), `${record.id} report resolves`);
}
for (const report of derivedReports) {
  for (const input of report.evidence_inputs) assert.ok(recoveredRecordIds.has(input), `${report.id} evidence input resolves`);
  for (const claimRef of report.claims_asserted) assert.ok(claimIds.has(claimRef), `${report.id} asserted claim resolves`);
  assert.notEqual(report.simulation_authority, "authoritative", `${report.id} report is not objective truth`);
  assert.notEqual(report.classification, "descriptive", `${report.id} remains an interpretation boundary`);
  assert.ok(recordFixture.report_events.includes(report.creation_ref), `${report.id} creation is explicit`);
}
for (const environment of sourceLocalEnvironments) {
  assert.ok(environment.source_refs.every((ref) => sourceIds.has(ref)), `${environment.id} source resolves`);
  assert.ok(environment.locator_refs.every((ref) => locatorById.has(ref)), `${environment.id} locator resolves`);
}
for (const condition of environmentalConditions) {
  assert.ok(environmentIds.has(condition.target_environment), `${condition.id} environment resolves`);
  assert.ok(condition.source_refs.every((ref) => sourceIds.has(ref)), `${condition.id} source resolves`);
  for (const locatorRef of condition.locator_refs) {
    const resolved = locatorById.get(locatorRef);
    assert.ok(resolved, `${condition.id} locator resolves`);
    assert.ok(condition.source_refs.includes(resolved.source.source_ref), `${condition.id} locator source is declared`);
    if (condition.simulation_authority === "authoritative") assert.equal(resolved.source.directly_checked, true, `${condition.id} uses directly checked evidence`);
  }
}
for (const survey of surveyObservations) {
  assert.ok(environmentIds.has(survey.target_environment), `${survey.id} environment resolves`);
  assert.ok(survey.source_refs.every((ref) => sourceIds.has(ref)), `${survey.id} source resolves`);
  assert.ok(!survey.unit || survey.reported_value !== undefined, `${survey.id} does not carry a unit without a value`);
  for (const locatorRef of survey.locator_refs) assert.ok(locatorById.has(locatorRef), `${survey.id} locator resolves`);
}
const anomalyIds = new Set(anomalyObservations.map(({ id }) => id));
for (const observation of anomalyObservations) {
  assert.ok(environmentIds.has(observation.environment_ref), `${observation.id} environment resolves`);
  assert.ok(observation.source_refs.every((ref) => sourceIds.has(ref)), `${observation.id} source resolves`);
  for (const locatorRef of observation.locator_refs) {
    const resolved = locatorById.get(locatorRef);
    assert.ok(resolved && resolved.source.directly_checked, `${observation.id} uses directly checked locator`);
  }
  assert.notEqual(observation.boundary_state, "exact", `${observation.id} does not turn a marking into exact geometry`);
}
for (const interaction of anomalyInteractions) {
  assert.ok(anomalyIds.has(interaction.anomaly_ref), `${interaction.id} anomaly resolves`);
  assert.ok(interaction.source_refs.every((ref) => sourceIds.has(ref)), `${interaction.id} source resolves`);
  assert.doesNotMatch(interaction.end_state, /destination is known/i, `${interaction.id} does not invent a destination`);
}
for (const relationship of anomalyChronology) {
  assert.ok(anomalyIds.has(relationship.from) && anomalyIds.has(relationship.to), `${relationship.id} chronology resolves`);
  assert.equal(relationship.causal_authority, "observed-sequence", `${relationship.id} is not a causal shortcut`);
}
assert.ok(anomalyTerms.every(({ classification }) => ["pack-neutral-technical-vocabulary", "community-shorthand"].includes(classification)), "anomaly terminology uses controlled classifications");
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
for (const relative of ["README.md", "canon/SOURCE_POLICY.md", "canon/source-registry-schema.json", "canon/source-intake-schema.json", "canon/claim-schema.json", "canon/scenario-admission-schema.json", "canon/verified-primary-source-schema.json", "canon/verified-primary-sources.json", "canon/verified-expedition-sources.json", "canon/verified-recovered-record-sources.json", "canon/verified-architecture-sources.json", "canon/verified-survey-sources.json", "canon/verified-anomaly-sources.json", "canon/evidence-object-schema.json", "canon/communication-record-schema.json", "canon/recovered-record-schema.json", "canon/derived-report-schema.json", "canon/environment-observation-schema.json", "canon/local-topology-schema.json", "canon/architecture-grammar-schema.json", "canon/production-reference-schema.json", "canon/environmental-condition-schema.json", "canon/survey-observation-schema.json", "canon/anomaly-observation-schema.json", "canon/anomaly-interaction-schema.json", "canon/claims/environmental-survey.json", "canon/claims/anomalies.json", "docs/canon-model.md", "docs/architecture.md", "docs/roadmap.md", "docs/intake-workflow.md", "docs/primary-source-verification.md", "docs/operations-evidence.md", "docs/recovered-records.md", "docs/complex-physical-grammar.md", "docs/environmental-survey.md", "docs/spatial-anomalies.md", "intake/README.md", "intake/records/representative-sources.json", "operations/evidence-objects.json", "operations/communication-records.json", "records/recovered-records.json", "records/derived-reports.json", "records/record-review-smoke-test.json", "architecture/environments.json", "architecture/local-topology.json", "architecture/grammar.json", "architecture/production-references.json", "environment/conditions.json", "environment/surveys.json", "environment/source-local-environments.json", "anomalies/observations.json", "anomalies/interactions.json", "anomalies/chronology.json", "anomalies/terminology.json", "scenarios/threshold-baseline-admission.json", "tools/README.md", "world/locations.json", "world/connections.json", "world/conditions.json", "world/resources.json", "world/observation-capabilities.json"]) assert.ok(fs.existsSync(path.join(root, relative)));
const scripts = ["tests/validate-assets.js", "tests/validate-contracts.js", "tests/intake-model.test.js", "tests/operations-model.test.js", "tests/recovered-records.test.js", "tests/architecture-model.test.js", "tests/survey-model.test.js", "tests/anomaly-model.test.js", "tests/run-conformance.js", "tools/intake-lib.js", "tools/register-source.js", "tools/create-claim-stub.js", "tools/link-claims.js", "tools/promote-review.js", "tools/check-admission.js", "tools/intake-summary.js", "tools/evidence-report.js", "tools/operations-report.js", "tools/records-report.js", "tools/architecture-report.js", "tools/survey-report.js", "tools/anomaly-report.js"];
for (const relative of scripts) {
  const content = fs.readFileSync(path.join(root, relative), "utf8");
  assert.doesNotMatch(content, /custodian\/(runtime|state|tools)/, `${relative} uses only public Custodian imports`);
}
const packFiles = fs.readdirSync(root, { recursive: true }).filter((entry) => entry.endsWith(".js") && !entry.startsWith("node_modules/"));
assert.deepEqual(packFiles.sort(), scripts.sort(), "Yellow Beast contains no executable world-pack logic");
const prohibitedRawMedia = fs.readdirSync(root, { recursive: true }).filter((entry) => /\.(mp4|mov|webm|mkv|jpg|jpeg|png|gif|webp|mp3|wav|pdf)$/i.test(entry));
assert.deepEqual(prohibitedRawMedia, [], "Yellow Beast contains no copied raw source media or archives");
console.log("validated Yellow Beast canon intake assets and baseline manifest");
