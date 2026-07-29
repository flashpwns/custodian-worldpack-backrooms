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
for (const claim of [...read("canon/claims/foundation.json").claims, ...read("canon/claims/operations.json").claims]) validate("https://yellowbeast.dev/schemas/claim/v3", claim, `claim ${claim.id}`);
for (const source of read("canon/verified-primary-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const source of read("canon/verified-expedition-sources.json").sources) validate("https://yellowbeast.dev/schemas/verified-primary-source/v1", source, `verified source ${source.id}`);
for (const evidence of read("operations/evidence-objects.json").evidence) validate("https://yellowbeast.dev/schemas/evidence-object/v1", evidence, `evidence ${evidence.id}`);
for (const record of read("operations/communication-records.json").records) validate("https://yellowbeast.dev/schemas/communication-record/v1", record, `communication ${record.id}`);
validate("https://yellowbeast.dev/schemas/scenario-admission/v1", read("scenarios/threshold-baseline-admission.json"), "Threshold Baseline admission");
console.log("validated Yellow Beast intake and admission contracts");
