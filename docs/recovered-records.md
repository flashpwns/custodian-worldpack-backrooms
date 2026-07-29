# Recovered records and post-expedition review

YB-5 adds declarative review metadata, not an ASYNC archive system. A record is
not automatically complete, accessible, reviewed, understood, or true because
it exists or an institution later writes about it.

## Required separation

`records/recovered-records.json` records these independently:

1. an objective evidence object and its original creator;
2. a declared recovery reference, location, and recovering actor;
3. each actor's explicit access history;
4. each actor's explicit review history;
5. a separately derived report.

`records/derived-reports.json` then records an author's classification, inputs,
asserted claims, omissions, intended access, and simulation authority. A report
is never an objective reducer input merely because its author is an institution.
Access does not imply review; review does not imply agreement; neither implies
objective truth.

## Bounded primary evidence

YB-5 directly checked the official uploads *Backrooms - Report* and *Backrooms
- Damage Control*. The latter visibly presents a surveillance-style recorded
view. That supports only the narrow claim that a recorded view is presented. It
does not establish who recovered, accessed, reviewed, retained, or understood
the material, nor that it is complete. *Report* is retained as verified
operational context and deliberately supplies no recovered-record admission.

The `record-review-smoke-test` is visibly `pack-original`: it proves the data
model and validation boundary, not a universal in-fiction procedure. Its
partial-provenance record leads to a low-confidence, reference-only
institutional assertion. This is intentional.

## Worked review path

1. A verified locator in `verified-recovered-record-sources.json` records the
   narrow visible source fact.
2. `damage-control-presents-recorded-surveillance-view` is admitted only for
   that observation.
3. `damage-control-view-does-not-establish-review-or-completeness` stays
   `needs-context`; it cannot become an authoritative scenario dependency.
4. The smoke-test record declares an explicit recovery, access, and review
   event reference against the existing Threshold Baseline measurement.
5. `threshold-baseline-review-summary` references that record, but its
   institutional assertion remains `reference-only`.

## Reviewer checklist

1. Directly check the source and retain a stable locator, not copied media.
2. Record recovery, access, review, and report creation as separate facts.
3. Require valid origin evidence, actors, event references, and report inputs.
4. Mark integrity, completeness, gaps, and provenance independently.
5. Link reports to evidence without allowing them to rewrite it.
6. Reject a single recovered view as proof of universal custody or archives.
7. Label every simulation convenience `pack-original`.

Run `npm run records-report` for a deterministic summary. Custodian currently
persists the underlying canonical evidence through export/restore; this pack's
additional recovered-record metadata is declarative review material and does
not alter kernel persistence or replay.
