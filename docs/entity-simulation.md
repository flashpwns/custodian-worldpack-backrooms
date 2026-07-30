# Entity simulation foundation

`yellow-beast-entity-simulation@v1` keeps objective entities, hazards, encounters, and traces in the shared `yellow-beast-world-history@v1` world. Observer projections are separate, versioned, and omit stable world IDs, hidden awareness, behavior state, rule selection, and undiscovered locations.

Entity definitions are capability-deny-by-default. The `validation-mover` is a pack-original test fixture used to verify deterministic topology movement; it is not a canon entity. Still Life currently has only scenario-local, stationary physical presence because the authority ledger admits no movement, perception, interaction, harm, or motive rule.

Hazard outcomes are explicit qualitative rules. They can change a route, consume configured equipment in a later extension, interrupt objectives, or mark an actor incapacitated/failed. Significant results append world-history events and therefore remain available for later incident reporting, evidence, recovery, containment, objective, and route-risk systems without creating a second truth store.
