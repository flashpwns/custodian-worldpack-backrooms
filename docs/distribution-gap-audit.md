# Distribution gap audit

YB-15 prepares reviewed self-contained portable artifacts with a bundled Node runtime, resolved Custodian 1.5.0 dependency, offline structured commands, the clearly labelled Offline Interpreter, and an optional OpenAI adapter. No network or API key is needed to play Async: Clear-Q4.

## Blocks private/test downloadable alpha

Nothing identified. macOS is built and smoke-tested locally on the host architecture; GitHub Actions builds and smoke-tests the Windows artifact. Artifacts remain unsigned.

## Blocks public alpha

Nothing architectural remains once the reviewed macOS and Windows artifacts are attached to the authorized prerelease. Windows execution is covered by a native GitHub Actions smoke test; macOS is smoke-tested locally on its host architecture. Gatekeeper and SmartScreen guidance remains a support concern, not a block to an unsigned alpha.

## Blocks polished signed release

- macOS code signing and notarization; Windows code signing.
- Installer/auto-update polish, richer launcher UX, and a stable per-user save migration UI.
- Better real-provider onboarding, secure key storage, cost/rate-limit UX, and consent.
- More playable scenarios and deferred verbs.

## Nice-to-have

- Desktop UI, graphical presentation, AI narration beyond the offline mock, npm distribution, and platform-native installers.
