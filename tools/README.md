# Yellow Beast intake tools

These deterministic tools prepare or validate human-review records; none ingest archives, judge canon, or edit files implicitly.

```sh
node tools/register-source.js intake/records/example.json
node tools/create-claim-stub.js backrooms-first-contact location
node tools/link-claims.js initial-chronology-is-unresolved contradicts fan-chronology-ordering-is-not-admitted
node tools/promote-review.js threshold-baseline-is-pack-original admitted
node tools/check-admission.js scenarios/threshold-baseline-admission.json
node tools/intake-summary.js
node tools/evidence-report.js
node tools/operations-report.js
node tools/records-report.js
node tools/architecture-report.js
node tools/survey-report.js
```

Use outputs as review proposals. Commit a reviewed JSON record only after a human checks source scope, provenance, and authority.
