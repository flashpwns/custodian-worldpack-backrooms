# Architecture

Yellow Beast is a declarative consumer of Custodian's public world-pack boundary.
The root `manifest.json` and `scenario.json` are the conformance inputs. The
`world/` files are human-reviewable catalogues of the same deliberately minimal
baseline declarations; they are not a second runtime or a loader.

Custodian currently accepts root `manifest.json` and root `scenario.json` for
local conformance. `scenarios/threshold-baseline.json` is an identical
authoring-visible scenario record retained for the repository structure and is
checked for equality by the asset validation test.

Custodian owns canonical history, ordering, execution, replay, objective
projection, and observer-local state. Yellow Beast owns declared initial content,
source provenance, claim classifications, capabilities, and scenario selection.
No pack code imports reducers, invokes the Director, applies effects, or mutates
state directly.

The public conformance test uses two ticks: both surveyors acquire a bounded
visual perception of an objective signal, the alpha surveyor traverses the
declared controlled route, a private radio message remains an objective
communication fact, and a later baseline measurement creates evidence. Export
and restore then rebuild the same session. These are pack-original smoke-test
facts, not a claim of broad setting mechanics.

## Developer architecture closure

YB-31 developer inspection is one derived service in
`tools/dev-inspection.js`. DesktopService, the CLI, and reports consume its
observer-safe snapshot, bounded recent history, subject selection, and fixed
observer profile list. Read-only commands cannot resolve consequences or write
saves; `reproduce` and isolated `fixture` commands are explicitly
`SIMULATION_DRIVING` and use normal runtime paths in fresh worlds.

Story threads remain a derived recognition layer over canonical history. Their
WeakMap cache is world-scoped, reconstructible, not serialized, and invalidated
by canonical history revision. Canonical state remains authoritative across
save/load and observer views. The source → claim → authority → runtime →
experience chain remains explicit; freeform interpretation remains primary,
character death remains irreversible, object identity remains singular, and
phenomenon/Still Life capabilities remain restrictive. Developer snapshots are
only exposed behind explicit developer mode and never enter player projections.
