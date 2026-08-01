# Worldpack Authoring Guide

Yellow Beast worldpacks are declarative JSON. Runtime truth lives in reusable Custodian tools; a pack supplies content and structured rules. Executable predicates are not allowed.

## File set

Each complete pack contains:

- `worldpack.json`: ID, display name, authoring version, and record paths.
- `spatial.json`: locations, connections, entry/return topology, visibility, route requirements.
- `interactions.json`: objects, aliases, knowledge, affordances, requirements, mutations, evidence, hazard hooks.
- `mission.json`: objectives, dependencies, conditions, transitions, return/abort/completion policy, outcomes, public language.
- `dynamics.json`: staffing, action costs, check-ins/events, interference, hazards, consequence sets, team policy.
- `logistics.json`: item definitions/instances, containers, initial custody, loadout requirements and recommendations.
- `institution.json`: initial institutional dimensions, response rules, delays, state changes, follow-up hooks.
- `operation.json`: mission arc, meaningful choices, outcome matrix, observer-safe presentation policy and fallback.

Clear-Q4, `minimal`, and `authoring-fixture` are the reference packs. The fixture deliberately contains no Clear-Q4 imports or IDs.

## Commands

```text
npm run worldpack:create -- path/to/new-pack --id new-pack
npm run worldpack:validate -- path/to/new-pack
npm run worldpack:preview -- path/to/new-pack --output dist/authoring/new-pack.html
npm run worldpack:trace -- path/to/new-pack --seed fixed-seed --output dist/authoring/new-pack-trace.json
npm run worldpack:test -- path/to/new-pack --seed fixed-seed
```

A registered pack ID such as `clear-q4` may replace a path. `create` copies the independent fixture structure, replaces its pack ID, and immediately validates the scaffold. The destination must be empty.

## Validation

The validator reports `code`, source `file`, JSON `path`, and a grounded message. It combines strict schemas with runtime and cross-record checks, including:

- duplicate/unresolved IDs and references
- unreachable locations, undeclared one-way routes, and impossible return
- invalid/circular/never-active objectives and unsafe conditions
- unknown object, location, connection, equipment, role, container, hazard, consequence, outcome, and mission references
- impossible or orphaned loadout items and invalid container layout/capacity/nesting
- hazards without exposure/consequence/mitigation structure
- institutional rules/follow-ups referencing unsupported inputs or outcomes
- outcome families with no matching mission rule
- staffing outside three to five total people
- fixed legacy personnel-name dependencies
- hidden evaluator terms or missing deterministic fallback in presentation
- unsupported fields, arbitrary executable data, and closure deadlocks detectable from authored structure

Schema files are `canon/operational-*-schema.json`, `canon/institutional-response-schema.json`, and `canon/complete-operation-schema.json`. They use `additionalProperties: false` at the authored boundaries.

## Preview and trace

The preview is explicitly marked developer-only and renders the map graph, objective/dependency graph, timeline, staffing range/roles, container capacities, hazard mitigations, Standard response matrix, and outcomes.

The deterministic trace runs a small structured simulation without Electron. It records action/time, due events, communication, teammate transfer decision, initial hazards/consequences, mission candidates, Standard review queue, inventory mutation, authoritative item/container/personnel truth, and an observer-safe projection. Identical pack/seed input must produce the same digest.

Use the developer snapshot in a development-enabled desktop session to inspect the live clock, event queue, mission predicates, teammate locations/decisions, hazards, item custody, container contents, Standard knowledge/queue, observer-safe projection, and candidate outcome. This surface must never be exposed in normal gameplay.

## Authoring rules

Prefer stable kebab-case IDs and player-facing prose without IDs or state paths. Author visible precursors and legitimate detection for risks. Put Clear-Q4 names and prose only in its data files. Keep every required capability available, explicitly waivable, or tied to a reachable recovery. Provide at least one valid return path for every deployable branch. Always run `worldpack:test`, repository contract/asset validation, and a production-service acceptance before registration.
