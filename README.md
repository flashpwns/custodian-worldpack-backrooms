# Yellow Beast

Yellow Beast is an unofficial, independently maintained declarative world pack
for [Custodian](https://github.com/flashpwns/custodian).
It targets `canonical-kernel@v1` and is currently `0.13.0-alpha`.

It is a simulation-pack foundation, not a transcript archive or a statement of
official canon. Source metadata, claims, and simulation authority are separate:
no source summary, theory, production image, Discord message, or in-fiction
statement silently becomes objective world state.

## Quick start

```sh
npm install
npm run validate-assets
npm run check-admission
npm run evidence-report
npm run conformance
```

## Desktop shell (YB-26 alpha)

The in-progress desktop shell runs without an AI provider and stores worlds in
the platform application-data directory. For development, run:

```sh
npm run desktop:dev
```

`npm run desktop:build` performs the deterministic staging check. Native alpha
archives can be built with `npm run desktop:package -- --mac zip` or
`npm run desktop:package -- --win zip`; verify them with
`npm run desktop:verify`. See [desktop distribution](docs/desktop-distribution.md).

## Canon admission

Research references are not world facts. Yellow Beast records source metadata,
project scope, provenance, normalized claims, review states, conflict links, and
scenario-specific admission separately. Start with the [verified intake workflow](docs/intake-workflow.md).
No raw transcript, film frame, image gallery, or Discord archive belongs here.
The bounded primary-source procedure is documented in [primary-source verification](docs/primary-source-verification.md).
Communication, evidence provenance, custody, and recipient-access limits are documented in [operations evidence boundaries](docs/operations-evidence.md).
Post-expedition recovery, access, review, and derived-report boundaries are documented in [recovered records](docs/recovered-records.md).
Local Complex architecture, topology, visibility, and grammar boundaries are documented in [physical grammar](docs/complex-physical-grammar.md).
Environmental materials, lighting states, and qualitative survey boundaries are documented in [environmental survey](docs/environmental-survey.md).
Localized discontinuities, interaction results, causality limits, and terminology discipline are documented in [spatial anomalies](docs/spatial-anomalies.md).
Corpus inventory and source-local transition boundaries are documented in [corpus and recovery paths](docs/corpus-and-recovery-paths.md).
Player/session configuration boundaries are documented in [Scenario Profiles](docs/scenario-profiles.md).

The small `threshold-baseline` scenario is a constitutional smoke test for a
controlled Threshold-side survey: multiple observers, equipment custody,
traversal, communication context, environmental measurement, evidence, and a
return path. It has no creature encounter, chase, or speculative mechanic.

## Boundaries

Yellow Beast is not affiliated with Kane Parsons, A24, or other rights holders.
It contains original metadata, schemas, citations, and analytical descriptions;
it does not redistribute transcripts, film frames, production artwork, or Discord
archives. See [canon/SOURCE_POLICY.md](canon/SOURCE_POLICY.md).

Custodian remains setting-independent. `npm run conformance` calls the public
`validateWorldPackConformance` API; Yellow Beast does not import private
Custodian modules or execute pack-authored code. The corresponding
`custodian-conformance` binary is tracked by Custodian packaging fix PR #19.
