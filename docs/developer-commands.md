# Developer commands

`npm run dev -- <command>` is the small, explicit YB-31 command surface. It is
for development and test work, never ordinary player use. Run `npm run dev --
help` for concise usage and examples; every new command emits a versioned JSON
shape with `--json` (JSON is also the default for easy capture).

## Read-only commands

`inspect`, `snapshot`, `trace`, `thread-rebuild`, `reports`, `report`, and
`bug-bundle` declare `READ_ONLY`. They derive from `tools/dev-inspection.js`,
never save, do not regenerate a region, and report `State changed: NO` on an
error. `inspect` accepts `world`, `observer`, `actor`, `object`, `region`,
`phenomenon`, and `thread`; it is intentionally bounded. `trace` takes a
freeform phrase through safe context, interpretation, grounding, and planning,
then stops before consequence resolution. Its output distinguishes the primary
freeform path from an offline compatibility fallback.

`compare --subject actor --id <identity>` puts the objective subject beside the
four observer projections for leak debugging. The `character`, `object`,
`region`, `phenomenon`, `thread`, and `event` aliases are concise inspect
targets. `provider` reports standalone offline status and directs context
inspection to `trace`; it never reads or changes provider configuration.

`thread-rebuild` compares two independent derived indices; threads remain
**DERIVED / NONCANONICAL**. `bug-bundle` contains commit/version, seed, selected
subject, bounded event references, and offline/provider mode. It is diagnostic,
non-importable, and deliberately excludes credential values and save payloads.

## Simulation-driving commands

`reproduce` and `fixture` declare `SIMULATION_DRIVING`. They create a fresh,
isolated test world—never target a user save. `reproduce` starts a normal run
and replays `--actions "first phrase|second phrase"` through the same freeform
interpretation and consequence path used by the runtime. It never assigns fields
inside world state. Equal seed, mode, and action sequence yield equivalent output.

`fixtures --list` currently exposes the deterministic 150-turn convergence
fixture. It covers all observer modes, a persistent object, character death,
environment state, phenomena, reports, and derived threads.

## Reports and validation

`reports --list` provides category and purpose for canon, world, mode, UX, and
developer reports. `report --name <npm-report-name>` runs one registered report;
`report --category canon|world|mode|ux|developer|all` runs a group and propagates
any failure. `validate --fast`, `validate --full`, and `validate
--area intent|world|ux` wrap existing validation paths; the fast path does not
package native applications.

The command service and desktop inspector share `tools/dev-inspection.js`; they
do not maintain competing world representations. Commands exit `0` on success
and `2` for usage/runtime/validation errors. Command diagnostics are not written
to canonical history.

Pass 4 will address authoring ergonomics. This command layer intentionally has
no JSON/state editor, eval surface, spawn action, teleport, forced outcome,
knowledge edit, entity behavior invocation, or save import/export format.
