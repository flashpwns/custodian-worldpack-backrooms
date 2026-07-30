# Entity and hazard simulation

YB-23 adds `yellow-beast-entity-simulation@v1` to the shared
`yellow-beast-world-history@v1` world. Entities, hazards, encounters, and
traces are objective persistent records in that world; they are not a second
truth store and do not imply universal observer knowledge.

## Authority and definitions

Definitions in `data/entity-definitions.json` deny every capability that they
do not explicitly list. A behavior rule states its source state, trigger,
destination, perception/topology requirements, authority, provenance, and
deterministic priority. The resolver has no AI callback and uses no ambient
randomness.

`validation-mover` is a clearly pack-original, validation-only fixture. It
exists solely to prove generic perception, state transition, edge traversal,
and trace behavior. It is not a Kane canon entity, is not a normal scenario
entry, and its capabilities cannot transfer to other definitions.

## Still Life boundary

`data/still-life-behavior-authority.json` is the controlling ledger. Current
admitted scope is an explicit scenario-local physical-presence fixture with
stationary persistence. Appearance, locomotion, perception, pursuit,
hostility, harm, environmental interaction, assimilation, communication,
motive, reproduction, and generic spawn rules remain prohibited or not
admitted. This sparseness is intentional canon fidelity, not an unfinished
horror-monster implementation.

## Perception, encounters, and movement

Objective presence is distinct from local perception. An observer can see an
entity or warning while an entity has not detected the observer; an entity's
own detection state remains private. Encounters are canonical records with
bounded `RETREAT`, `WAIT`, `OBSERVE`, `AVOID`, and `CONTINUE` responses.
Movement requires an explicit edge-traversal capability and a real traversable
YB-22 edge. Significant state changes, movement, traces, encounters, and
hazard effects append shared world-history events.

## Hazards and failure hooks

Hazards are separate from entities and declare their own permitted qualitative
consequences. Current foundation supports route unavailability and bounded
incapacitation/run-failure hooks. It deliberately does not create combat,
health points, or speculative physics. Later systems can attach evidence
valuation, research, containment, recovery, route-risk, objectives, and
institutional incident chains to these persistent event-backed results.

## Safe UI contract

`yellow-beast-entity-projection@v1` is a serializable, side-effect-free local
projection for a future desktop UI. It contains only visible entity
descriptions, perceived traces, local hazard warnings, public encounter state,
and allowed responses. It excludes raw entity/hazard IDs, hidden locations or
awareness, internal behavior state/rules, hidden topology, and other
observers' knowledge.

## Cross-mode knowledge

Physical entity and hazard state is shared across Clear-Q4, Nullzone Exposure,
Lost, and Beck's Desk. Knowledge is not: field information reaches Beck only
through an accepted institutional report; civilian and Lost observations stay
private unless explicitly transferred. Save/reload retains objective identity
and effects without rerolling placement or behavior.
