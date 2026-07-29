"use strict";
const { data, stable } = require("./intake-lib");
const [sourceRef, topic = "unclassified"] = process.argv.slice(2);
if (!sourceRef) throw new Error("usage: node tools/create-claim-stub.js <source-ref> [topic]");
if (!data().sourceIds.has(sourceRef)) throw new Error("UNKNOWN_SOURCE");
process.stdout.write(stable({ id: `${sourceRef}-claim-stub`, topic, claim: "Human reviewer must supply a normalized paraphrase.", source_refs: [sourceRef], review_state: "claim-extracted", extraction: { method: "paraphrase", locator: `source:${sourceRef}`, summary: "Stub only; no canon judgment performed." } }));
