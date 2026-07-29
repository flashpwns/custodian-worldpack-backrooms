"use strict";
const { data, read, stable } = require("./intake-lib");
const { claims, primary } = data();
const records = read("records/recovered-records.json").records;
const reports = read("records/derived-reports.json").reports;
const ids = (items) => items.map(({ id }) => id).sort();
const recordsClaim = ({ topic }) => topic === "recovered-records" || topic === "institutional-interpretation";
process.stdout.write(stable({
  newly_reviewed_sources: primary.filter(({ source_ref }) => ["backrooms-report", "backrooms-damage-control"].includes(source_ref)).map(({ source_ref }) => source_ref).sort(),
  newly_directly_verified_sources: primary.filter(({ source_ref, directly_checked }) => directly_checked && ["backrooms-report", "backrooms-damage-control"].includes(source_ref)).map(({ source_ref }) => source_ref).sort(),
  recovered_evidence_records: ids(records),
  access_histories: records.flatMap(({ id, access_history }) => access_history.map(({ id: access_id, actor }) => ({ record_id: id, access_id, actor }))).sort((a, b) => a.access_id.localeCompare(b.access_id)),
  review_histories: records.flatMap(({ id, review_history }) => review_history.map(({ id: review_id, actor }) => ({ record_id: id, review_id, actor }))).sort((a, b) => a.review_id.localeCompare(b.review_id)),
  derived_reports: ids(reports),
  institutional_assertions: ids(claims.filter(({ topic }) => topic === "institutional-interpretation")),
  unresolved_provenance: ids(claims.filter((claim) => claim.review_state === "needs-context" && recordsClaim(claim))),
  rejected_generalizations: ids(claims.filter((claim) => claim.review_state === "rejected" && recordsClaim(claim))),
  admitted_claims: ids(claims.filter((claim) => claim.review_state === "admitted" && recordsClaim(claim))),
  remaining_pack_original_assumptions: ids(claims.filter((claim) => claim.evidence_type === "pack-original" && recordsClaim(claim)))
}));
