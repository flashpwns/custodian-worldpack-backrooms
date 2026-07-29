"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");
const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const schemas = [
  read("canon/source-registry-schema.json"),
  read("canon/source-intake-schema.json"),
  read("canon/claim-schema.json"),
  read("canon/verified-primary-source-schema.json"),
  read("canon/evidence-object-schema.json"),
  read("canon/recovered-record-schema.json"),
  read("canon/derived-report-schema.json"),
  read("canon/environment-observation-schema.json"), read("canon/local-topology-schema.json"), read("canon/architecture-grammar-schema.json"), read("canon/production-reference-schema.json"), read("canon/environmental-condition-schema.json"), read("canon/survey-observation-schema.json"), read("canon/anomaly-observation-schema.json"), read("canon/anomaly-interaction-schema.json"),
  read("canon/communication-record-schema.json"),
  read("canon/scenario-admission-schema.json")
];
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const schema of schemas) ajv.addSchema(schema);
function validate(schemaId, value, label) {
  const valid = ajv.validate(schemaId, value);
  assert.ok(valid, `${label}: ${ajv.errorsText()}`);
}
validate("https://yellowbeast.dev/schemas/source-registry/v1", read("canon/source-registry.json"), "source registry");
for (const record of read("intake/records/representative-sources.json").records) validate("https://yellowbeast.dev/schemas/source-intake/v1", record, `intake ${record.id}`);
for (const claim of [...read("canon/claims/foundation.json").claims, ...read("canon/claims/operations.json").claims, ...read("canon/claims/recovered-records.json").claims, ...read("canon/claims/architecture.json").claims, ...read("canon/claims/environmental-survey.json").claims, ...read("canon/claims/anomalies.json").claims]) validate("https://yellowbeast.dev/schemas/claim/v3", claim, `claim ${claim.id}`);
for (const source of read("canon/verified-primary-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-expedition-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-recovered-record-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-architecture-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-survey-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-anomaly-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const evidence of read("operations/evidence-objects.json").evidence) validate("https://yellowbeast.dev/schemas/evidence-object/v1", evidence, `evidence ${evidence.id}`);
for (const record of read("operations/communication-records.json").records) validate("https://yellowbeast.dev/schemas/communication-record/v1", record, `communication ${record.id}`);
for (const record of read("records/recovered-records.json").records) validate("https://yellowbeast.dev/schemas/recovered-record/v1", record, `recovered record ${record.id}`);
for (const report of read("records/derived-reports.json").reports) validate("https://yellowbeast.dev/schemas/derived-report/v1", report, `derived report ${report.id}`);
for (const item of read("architecture/environments.json").environments) validate("https://yellowbeast.dev/schemas/environment-observation/v1", item, `environment ${item.id}`);
for (const item of read("architecture/local-topology.json").connections) validate("https://yellowbeast.dev/schemas/local-topology/v1", item, `topology ${item.id}`);
for (const item of read("architecture/grammar.json").rules) validate("https://yellowbeast.dev/schemas/architecture-grammar/v1", item, `grammar ${item.id}`);
for (const item of read("architecture/production-references.json").references) validate("https://yellowbeast.dev/schemas/production-reference/v1", item, `production ${item.id}`);
for (const item of read("environment/conditions.json").conditions) validate("https://yellowbeast.dev/schemas/environmental-condition-observation/v1", item, `condition ${item.id}`);
for (const item of read("environment/surveys.json").observations) validate("https://yellowbeast.dev/schemas/survey-observation/v1", item, `survey ${item.id}`);
for (const item of read("anomalies/observations.json").observations) validate("https://yellowbeast.dev/schemas/anomaly-observation/v1", item, `anomaly ${item.id}`);
for (const item of read("anomalies/interactions.json").interactions) validate("https://yellowbeast.dev/schemas/anomaly-interaction/v1", item, `anomaly interaction ${item.id}`);
validate("https://yellowbeast.dev/schemas/scenario-admission/v1", read("scenarios/threshold-baseline-admission.json"), "Threshold Baseline admission");
console.log("validated Yellow Beast intake and admission contracts");
