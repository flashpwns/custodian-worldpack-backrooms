# Distribution gap audit

The playable alpha is developer-downloadable through Node and `npm run play`; saves are portable JSON envelopes under `.saves/` by default when requested.

## Critical

- End-user installation still requires Node, npm, and a GitHub-backed Custodian dependency.
- No signed standalone macOS/Windows executable or one-click launcher exists.
- A network AI provider is not packaged or configured; the offline structured and deterministic mock modes remain the playable fallback.

## Important

- Package a stable CLI entry point and choose an OS-appropriate per-user save directory.
- Publish/version Custodian and Yellow Beast packaging rather than relying on a Git commit dependency.
- Add end-user error/recovery UX for corrupt or incompatible saves.
- Future AI providers need explicit configuration, secret storage outside saves, consent, and offline structured-command fallback.
- Provider/model selection, API-key onboarding, rate-limit/cost messaging, timeout recovery, and packaged-environment secret handling need end-user design.

## Nice-to-have

- npm distribution, executable bundling, macOS notarization, Windows signing, and a desktop UI path.
- Graphical presentation and optional AI narration after the structured command interface remains usable offline.
