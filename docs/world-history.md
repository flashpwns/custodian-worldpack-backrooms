# World history

`yellow-beast-world-history@v1` is a separate, versioned store above individual Custodian sessions and Yellow Beast run saves. A world has a stable world ID, append-ordered structured events, run records, promoted generated regions, evidence, artifacts/remnants, and separate institutional and civilian knowledge domains.

Runs receive stable world-scoped IDs. Only terminal structured outcomes are promoted: materialized/discovered regions, expedition results, returned evidence, delivered Standard reports, and explicitly created remnants. LOOKs, narration, temporary aliases, and failed probes are not history.

Persistent regions retain generator version, region seed, materialized state, grammar provenance, authority, and first-materialization run. A follow-up run may reuse the region while receiving its own observer discovery ledger and aliases. Unsupported world or generator versions reject safely rather than silently migrating.

Institutional knowledge is created only by delivered Standard reports and archived evidence. Civilian/personal knowledge is a separate domain. Neither is equivalent to objective world history; neither is automatically exposed to AI. Safe summaries return counts only for the requesting profile.

Artifacts/remnants are minimal persistent objects with origin run, region/location identity, custody, recoverability, visibility, and provenance. Their recovery appends a history event; it does not rewrite the leaving event.
