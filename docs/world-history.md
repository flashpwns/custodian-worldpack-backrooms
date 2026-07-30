# World history

`yellow-beast-world-history@v1` is a separate, versioned store above individual Custodian sessions and Yellow Beast run saves. A world has a stable world ID, append-ordered structured events, run records, promoted generated regions, evidence, artifacts/remnants, and separate institutional and civilian knowledge domains.

Runs receive stable world-scoped IDs. Only terminal structured outcomes are promoted: materialized/discovered regions, expedition results, returned evidence, delivered Standard reports, and explicitly created remnants. LOOKs, narration, temporary aliases, and failed probes are not history.

Persistent regions retain generator version, region seed, materialized state, grammar provenance, authority, and first-materialization run. A follow-up run may reuse the region while receiving its own observer discovery ledger and aliases. Unsupported world or generator versions reject safely rather than silently migrating.

Institutional knowledge is created only by delivered Standard reports and archived evidence. Civilian/personal knowledge is a separate domain. Neither is equivalent to objective world history; neither is automatically exposed to AI. Safe summaries return counts only for the requesting profile.

Artifacts/remnants are minimal persistent objects with origin run, region/location identity, custody, recoverability, visibility, and provenance. Their recovery appends a history event; it does not rewrite the leaving event.

For generator v2 regions, world history also records append-only `region.mutated` events. Each event identifies the originating run, region, node, target type/identity, operation, resulting value, provenance, and authority. A v2 region stores an immutable materialized baseline alongside its current materialization; rebuild applies ordered mutation events to that baseline. Duplicate event ingestion is idempotent. V2-only mutation events are rejected for v1 regions, preserving v1 semantics.

Institutional processes are materialized in `world.management` and append
`institution.*` events for process creation, communication/review, research,
recovery, and infrastructure. Research retains only reviewed report inputs and
changes institutional capability state. Infrastructure completion additionally
uses the same v2 mutation stream to install a physical shared-world object;
rebuilding the region therefore preserves it without a management-only copy.

Gameplay callbacks are observer-scoped `gameplay.callback_recognized` events
that link to existing history-backed artifacts, reviewed reports, objectives,
or completed infrastructure. They do not duplicate physical state or broaden
knowledge domains: public callback projections retain only a safe description,
recognition level, and region reference. The internal origin exists solely for
deterministic provenance and rebuild validation.
