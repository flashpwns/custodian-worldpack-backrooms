# Procedural Complex

YB-17 adds a bounded session-local generator, `yellow-beast-complex-generator@v1`. It has four distinct layers: source observations, explicit generator grammar, materialized generated nodes/edges, and observer discovery. A generated corridor is a Yellow Beast simulation instance, not a claim that a matching canonical corridor exists globally.

Rules in `data/procedural-grammar.json` declare their source basis, authority, scope, confidence, generalization permission, constraints, and pack-original status. Generated nodes inherit that authority exactly. Source-local analogs may be used narrowly; bounded compositions are visibly scenario-optional; prohibited rules are never generated.

The generator derives a region seed from the run seed and derives each materialized space and edge from stable lineage. Nodes and frontier edges are materialized in the save wrapper, rather than regenerated on restore. This preserves aliases, discovery order, and compatibility when later generator versions exist. A mismatched generator version rejects restore safely.

Topology is a graph, not a global Euclidean map. Frontier edges expose a visible passage but keep their destination unknown until traversal. Discovery is observer-scoped: LOOK, INSPECT, map records, AI context, and evidence use only the current visible node, features, exits, and discovered graph.

The initial bounded families are corridor, junction, service room, and stair transition. Lighting and materials use narrow analog or explicitly pack-original composition. Discontinuity evidence remains source-local and prohibited from generated teleportation in v1.

This design can later use a larger frontier for Lost, revisit a materialized region for Nullzone Exposure, and export discovered maps/reports to Beck's Desk. It does not create a canonical global Complex map, streaming infinite world, cross-run persistence, entities, or random hazards.

## Generator v2 and compatibility

YB-22 adds `yellow-beast-complex-generator@v2` for new rich regions. Generator v1 is frozen: an existing v1 region keeps its own version, materialized topology, and v1 semantics. It is never silently migrated, reinterpreted, or given v2 traits, landmarks, objects, or mutation rules.

A world may contain v1 and v2 regions. Restore dispatches from each persistent region's explicit `generator_version`; unsupported versions reject safely. V2 uses a materialized baseline plus its append-only world-history mutations, so a later implementation change does not reroll a previously explored region.

V2 rules are explicit, authority-traceable, and bounded. They define architectural families, region tendencies, frontier policies, local environment, landmarks, and mundane object placement. Traits are Yellow Beast world-instance simulation properties, not canonical laws or player-visible metadata. Mission, moderate, and deep frontier policies are implementation limits for different forms of play, not claims about the Complex.

Observed topology, landmarks, environmental conditions, and objects remain observer-scoped. The UI and AI see only visible local descriptions, discovered route aliases, and valid action targets—not seeds, weights, raw IDs, hidden topology, or undiscovered materialization.
