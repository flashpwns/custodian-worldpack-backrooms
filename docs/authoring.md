# Canon-safe authoring

Yellow Beast authoring follows one direction: **source → locator/passage →
normalized claim → authority → runtime admission → observer-safe presentation**.
No UI string, scenario, generated instance, report, or story thread is a source
of canon authority. `npm run authoring-report` and `npm run dev -- author
validate` read this existing chain; they do not write worlds or content files.

## Categories and ownership

| Category | Owner | Required support | Runtime rule |
| --- | --- | --- | --- |
| Canon-supported distinctive | `canon/`, claim, runtime trace | source, locator, admitted claim | narrow claimed delivery only |
| Pack-original distinctive | claim marked `pack-original` | explicit pack-authoring locator and rationale | visible as invented glue |
| Generic procedural | domain registry | mundane bounded classification | no fake citation; never distinctive lore |
| Unknown/untraced | report/validation | no admission | cannot become runtime content |

This preserves canon gravity: Kane Pixels canon establishes boundaries;
procedural variation stays inside them; conservative pack-original glue fills
only necessary gaps; player history supplies world-specific facts.

## Entry points

`npm run dev -- author source|claim|human|environment|phenomenon|scenario|asset`
prints a deterministic, intentionally incomplete template. Templates contain
TODOs, grant no authority, and never write a file. `author inspect <kind>`
previews one. `author validate` runs cross-reference validation. These helpers
create structure, not facts.

Source registry records belong in `canon/source-registry.json`; intake records
belong in `intake/records/`; normalized claims belong in `canon/claims/` and
must follow [claim schema](../canon/claim-schema.json). Use the existing
`register-source`, `create-claim-stub`, `link-claims`, and `promote-review`
tools for their narrow workflows. A source is never automatically authoritative:
community, wiki, fan, production, and secondary material retain their existing
provenance boundary until a separately valid claim is reviewed.

For a canon-supported runtime entry, first add an admitted claim with source and
locator, then add the trace in `data/runtime-traceability.json` or the relevant
domain registry. For explicit pack-original glue, use a `pack-original` claim,
`pack-authoring` extraction locator, and a bounded rationale. For generic
procedural content, use an explicit mundane `generic-procedural` classification;
do not use it to hide distinctive lore.

## Domain guidance

Humans: roles are reusable; identities are singular. Current ASYNC staff are
procedural role occupants. A named canon character requires admitted identity,
role, and temporal/context support; a named template must not respawn after
death. See [character continuity](character-continuity.md) and
[human world](human-world.md).

Environment: author feature families and procedural bounds, not generated region
or space IDs. Record source locality, permitted variation, and observer-safe
labels in `tools/environment-world.js`; generated instances and later mutations
belong to world history. A source-local observation is not a universal rule.

Phenomena: `data/phenomenon-definitions.json` requires every capability to be
explicit. Use `SUPPORTED`, `UNSUPPORTED`, or `UNKNOWN / NOT ADMITTED` semantics;
blank never means true. Still Life stays stationary, non-perceiving,
non-communicating, non-harmful, and non-pursuing. See [phenomena world](phenomena-world.md).

Scenarios establish starting conditions, resources, roles, and legitimate
observer knowledge through separate scenario/profile data. They do not redefine
objective architecture or script story outcomes. Story threads are recognizers
in `tools/story-threads.js`, always derived/noncanonical; never author an
advance, mandatory beat, or forced ending.

Presentation: canonical fact belongs in runtime/history; observer-safe fact in
mode projection; player label and copy belong in experience/renderer code.
Never make a UI string authoritative. Keep internal IDs developer-only. Lost
does not receive institutional labels, formal objectives, map certainty, or
hidden taxonomy; Beck receives reports and institutional uncertainty; Q4 receives
operationally communicated facts; Nullzone retains personal evidence and
hypotheses rather than engine classifications.

Assets: register intentional paths only in the repository's existing explicit
manifest/allowlist workflow and run `npm run validate-assets`. `author asset
--path assets/...` is a path preview only: it refuses wildcards, traversal, and
external paths. It never blanket-allowlists files.

## Schema/content index

| Content | Schema/registry | Validator/report |
| --- | --- | --- |
| Source | `canon/source-registry-schema.json` | `validate-assets`, intake validators |
| Claim | `canon/claim-schema.json`, `canon/claims/` | `author validate`, canon runtime report |
| Runtime admission | `data/runtime-traceability.json` and domain registries | canon runtime report |
| Humans/roles | `tools/human-world.js`, world history | human-world, character-continuity reports |
| Environment | `tools/environment-world.js` | environment-world report |
| Phenomena/entities | `data/phenomenon-definitions.json`, `data/entity-definitions.json` | phenomena report |
| Scenario/profile | `scenarios/`, `profiles/` | contracts, mode reports |
| Presentation | `tools/*-experience.js`, `desktop/renderer/` | UX and mode reports |

## Good and bad patterns

Good: a local fixture claim has an admitted source/locator and an environment
feature declares `source-local` scope. Good: a mundane plain ceiling is explicit
`generic-procedural` fill. Good: a field-researcher role is reused while each
procedural person has a distinct persistent identity.

Bad: “Still Life can chase the player.” Bad: a named researcher template
respawns. Bad: a wiki statement becomes objective truth. Bad: a player label is
used as canonical identity. Bad: a story thread contains a predetermined ending.

Run `npm run authoring-report`, the relevant domain report, and full validation
before commit. Pass 5 concerns runtime profiling, not authoring policy.
