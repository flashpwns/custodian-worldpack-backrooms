"use strict";
const { data, read, stable } = require("./intake-lib");
const intake = read("intake/records/representative-sources.json");
const byState = Object.fromEntries([...new Set(intake.records.map(({ review_state }) => review_state))].sort().map((state) => [state, intake.records.filter((record) => record.review_state === state).length]));
const claimsByState = Object.fromEntries([...new Set(data().claims.map(({ review_state }) => review_state))].sort().map((state) => [state, data().claims.filter((claim) => claim.review_state === state).length]));
process.stdout.write(stable({ intake_records: intake.records.length, intake_by_review_state: byState, claims: data().claims.length, claims_by_review_state: claimsByState }));
