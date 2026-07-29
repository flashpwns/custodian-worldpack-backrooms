"use strict";
const { data, read, stable } = require("./intake-lib");
const { claims, primary } = data();
const evidence = read("operations/evidence-objects.json").evidence;
const communication = read("operations/communication-records.json").records;
const operations = claims.filter((claim) => ["communication", "evidence-handling", "observer-local-communication"].includes(claim.topic));
const ids = (items) => items.map(({ id }) => id).sort();
process.stdout.write(stable({
  newly_reviewed_sources: primary.filter(({ source_ref }) => source_ref === "backrooms-motion-detected").map(({ source_ref }) => source_ref),
  newly_directly_verified_sources: primary.filter(({ source_ref, directly_checked }) => source_ref === "backrooms-motion-detected" && directly_checked).map(({ source_ref }) => source_ref),
  communication_claims: ids(operations.filter(({ topic }) => topic.includes("communication"))),
  evidence_handling_claims: ids(operations.filter(({ topic }) => topic === "evidence-handling")),
  authoritative_admissions: ids(operations.filter(({ review_state, simulation_authority }) => review_state === "admitted" && simulation_authority === "authoritative")),
  observer_local_claims: ids(operations.filter(({ topic }) => topic === "observer-local-communication")),
  institutional_assertions: ids(claims.filter(({ canon_status }) => canon_status === "character-belief")),
  rejected_generalizations: ids(operations.filter(({ review_state }) => review_state === "rejected")),
  unresolved_questions: ids(operations.filter(({ review_state }) => review_state === "needs-context")),
  evidence_objects: ids(evidence),
  communication_records: ids(communication),
  remaining_pack_original_communication_assumptions: ids(operations.filter(({ evidence_type }) => evidence_type === "pack-original"))
}));
