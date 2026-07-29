# Complex physical grammar and architectural observation

YB-6 records what a source visibly establishes at a local place and time. It
does not explain why the Complex has a feature, generate new rooms, or create a
global map.

An observation such as “a corridor contains square columns” may be
authoritative when directly checked. “The Complex generates commercial
architecture” is an interpretation and is not admitted. Claims about intention,
memory, intelligence, infinity, or generation mechanism are outside this pack.

## Data layers

- `architecture/environments.json` holds source-local feature observations.
- `architecture/local-topology.json` holds only observed connections between
  those records. It distinguishes a local path from unknown continuation.
- `architecture/grammar.json` groups repeat observations as bounded patterns;
  it cannot become a universal law.
- `architecture/production-references.json` links production context only as
  `reference-only`, never as geography.

The feature vocabulary separates structure, surfaces, lighting, object
placement, functional context, visibility, and uncertainty. In particular,
isolated, embedded, duplicated, deformed, and unresolved object relationships
are different observations—not explanations such as “clipping.”

## Worked example

The direct *Pitfalls* locator `pitfalls-column-corridor` creates the local
`pitfalls-column-corridor` observation and the admitted
`pitfalls-depicts-column-corridor` claim. Together with other independently
observed interiors, it supports the strongly-implied, source-local
`lit-ceiling-panels-observed-cluster` grammar rule. A scenario may use the
individual verified observation; it may not convert the grammar rule into a
global map or universal generation behavior.

## Authoring checklist

1. Use a directly checked official locator for authoritative observations.
2. Keep each location local to a source context; record unknown continuation.
3. Include visibility and uncertainty instead of inventing dimensions.
4. State visible object placement, not a hidden mechanism or semantic intent.
5. Mark production material `reference-only`.
6. Label any simulation-only connection `pack-original`.
7. Reject claims that a repeated motif is universal.

Run `npm run architecture-report` for the deterministic dataset summary.
