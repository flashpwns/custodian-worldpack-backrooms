# Environmental survey observations

YB-7 records source-local physical observations. It does not model electrical systems, construction mechanisms, environmental generation, or universal Complex rules.

## Observation and measurement

`environment/conditions.json` describes a visible local condition using controlled surface, ceiling, lighting, and material vocabulary. `environment/surveys.json` records an observer's bounded inspection. A record may be a visual description, physical inspection, instrument measurement, stated measurement, derived estimate, or unresolved measurement.

`reported_value` and `unit` are both optional. A unit cannot appear without a value, and no missing measurement receives a default. A stated value remains a stated value; a derived estimate remains an estimate. The current YB-7 records are qualitative only.

## Locality and uncertainty

Lighting states apply to their linked source-local environment only. `dark-continuation` does not establish a hazard, cause, or geometry beyond the observed view. A recognisable ceiling tile is recorded as a visible component; exact composition, dimensions, electrical properties, age, and construction method remain unresolved unless a source directly supplies them.

The `lighting-survey-local-interior` identifier is deliberately source-local. It permits several records to refer to the same inspected view without asserting global coordinates, a reusable room identity, or continued topology. Pitfalls records instead link to bounded YB-6 environment records.

## Worked chain

1. The official *Backrooms - Lighting and Tile Survey* upload is directly checked and registered in `canon/verified-survey-sources.json`.
2. `lighting-survey-fixture-and-tile-inspection` pins the evidence to a timestamp range and a short non-verbatim description.
3. `lighting-survey-local-interior` supplies a bounded local environment reference.
4. `lighting-survey-ceiling-physical-inspection` records visible close inspection without inventing a numeric result.
5. `lighting-survey-depicts-local-fixture-and-tile-inspection` is admitted only for that observed inspection.
6. A scenario may use that narrow claim or condition as a local source-backed fact; it may not derive a grid, universal material standard, hazard, or Complex mechanism.

## Reviewer checklist

- Confirm the source is directly checked and the locator can be found again.
- Record only what is visible, measured, or explicitly stated; preserve method and uncertainty.
- Use `unknown-material` when appearance does not establish composition.
- Link to an existing bounded environment, or create a clearly source-local identifier.
- Keep local illumination distinct from electrical behavior, hazard, and global rules.
- Mark interpretive clusters as non-authoritative and reject overgeneralizations explicitly.

Run `npm run survey-report` for the deterministic survey summary.
