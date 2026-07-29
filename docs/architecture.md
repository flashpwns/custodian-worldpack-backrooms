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
