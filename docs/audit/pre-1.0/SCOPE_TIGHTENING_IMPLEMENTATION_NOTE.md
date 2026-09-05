# Scope-tightening implementation note

Date: 2026-09-05

Candidate: `/Users/jacktr/Developer/yellow-beast`

Branch: `integration/pre-1.0-reconciliation`

This note records the corrective implementation pass applied after the pre-1.0 reconciliation audit. It is an evidence record for this candidate checkout; it does not replace external review of the verification authority or certify a release.

## Corrective scope

- Ordinary desktop launch now selects the authored Reference Expedition. The default expedition is one controlled player and three coworkers. The procedural survey remains available through the explicit `--procedural-survey` flag.
- Natural-language interpretation now resolves only observer-visible, currently available actions. It does not choose an arbitrary route or item when a noun is ambiguous, does not treat `go check that` as movement, rejects unsupported left/right movement without authored facing state, and uses the recorded previous exit for backtracking.
- Transfer and handoff interpretation exposes only local equipment and explicit custody direction. Giving an item the player does not hold, or receiving an item the player already holds, is rejected without mutation.
- Natural actions carry a caller request ID. A repeated ID and identical fingerprint returns the recorded result, a reused ID with different text is rejected, and a different command cannot race an in-flight command for the same world. Canonical dispatch and session persistence occur before asynchronous presentation; failed persistence rolls back the world, run, phase, and receipt so a deliberate retry is possible.
- Q4 phase transitions and closure handling are shared by structured and natural actions. Local communication records the actual recipient names rather than a synthetic team label.
- Renderer settings persist the provider model in the same settings transaction and initialize it in the inserted form. The native smoke now rejects covered controls, ignores controls inside closed details, and handles sticky settings headers and compact action controls.
- Desktop packaging selects the host platform and architecture, disables publishing unless explicitly requested, resolves verifier paths from the actual artifact, and removes temporary build metadata after packaging. Asset validation admits the governed runtime tools explicitly.
- The dependency lock refresh removes the current `npm audit` findings for `@xmldom/xmldom`, `fast-uri`, and `js-yaml`.

## Validation evidence

All commands were run in the candidate checkout on 2026-09-05:

- `npm test`: 540 tests passed, 0 failed; aggregate reports passed.
- `npm run test:long-world`: 169 tests passed, 0 failed; the long-world report declared `passed: true`.
- `npm run test:native`: inventory passed; the packaged desktop smoke, settings regression, and first-run regression all passed.
- `npm run validate-assets`: passed.
- `node tools/verification-inventory.js`: 0 errors, 0 warnings; 113 included, 4 quarantined, 0 retired.
- `npm audit --json`: 0 vulnerabilities.
- `npm run desktop:build`: Mac arm64 application and zip produced successfully. The artifact is unsigned because the available local Developer ID certificates are expired.
- Focused transaction coverage: `tests/y83-natural-command-transactions.test.js`, together with the adjacent living-turn and projection coverage, passed 38 tests.

The local `verification/test-manifest.json` and `verification/verification-authority.json` were updated to account for the new transaction test and corrected executable hashes. Those authority edits are current-checkout evidence and still require the project’s external review path before any release claim.

## Remaining boundaries

The unsigned Mac artifact does not establish notarized distribution readiness. No hosted provider credential was configured, so live provider or hosted-AI behavior remains outside this pass. Human full-expedition acceptance, audio perceptual review, and cross-account artifact verification remain separate gates. The pinned Custodian dependency still has a lock metadata version discrepancy (installed package metadata versus the lock’s declared version); its resolved commit remains unchanged.
