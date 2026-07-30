# Procedural generation readiness

**Status: READY WITH WARNINGS.**

Architecture, environment, topology, and anomaly inputs each have a named source basis and a source-local-only rule in `data/procedural-readiness.json`. No observed room form, lighting pattern, discontinuity, return route, or anomaly observation may become a universal Complex rule merely because it was observed locally.

YB-17 implements the bounded `yellow-beast-complex-generator@v1` under these restrictions. Its grammar is in `data/procedural-grammar.json`; generated instances inherit rule authority and materialize in saves. It does not use the unreviewed YouTube corpus as generator input, infer anomaly mechanisms, populate entities from weak context, or generalize observed transitions into stable topology.
