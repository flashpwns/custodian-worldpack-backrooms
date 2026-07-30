# Distribution gap audit

YB-14 produces self-contained portable app directories with a bundled Node runtime, resolved Custodian 1.5.0 dependency, offline structured commands, and the clearly labelled Offline Interpreter. No network or API key is needed to play Async: Clear-Q4.

## Blocks private/test downloadable alpha

Nothing identified. macOS is built and smoke-tested locally on the host architecture; GitHub Actions builds and smoke-tests the Windows artifact. Artifacts remain unsigned.

## Blocks public unsigned alpha

- Human review and manual upload of the CI-built macOS/Windows artifacts is still required.
- Windows artifact execution has CI smoke coverage, not local Windows gameplay verification.
- Clear Gatekeeper/SmartScreen instructions and support expectations must accompany distribution.

## Blocks polished signed release

- macOS code signing and notarization; Windows code signing.
- Installer/auto-update polish, richer launcher UX, and a stable per-user save migration UI.
- Optional real-provider onboarding, key storage, cost/rate-limit UX, and consent.
- More playable scenarios and deferred verbs.

## Nice-to-have

- Desktop UI, graphical presentation, AI narration beyond the offline mock, npm distribution, and platform-native installers.
