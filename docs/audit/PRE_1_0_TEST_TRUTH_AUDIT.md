# Yellow Beast pre-1.0 test truth audit

## Results from the independent integration install

| Command | Result | What it proves |
|---|---|---|
| `npm ci` | PASS; 287 packages | Reproducible install at the lock's Custodian commit, independent of Sol's `node_modules` |
| `npm run conformance` | PASS; 10 checks | Worldpack/kernel conformance only |
| `npm test` | FAIL before aggregate execution; 97 inventory errors | The official release gate is red and cannot support any green aggregate claim |
| `node --test --test-reporter=dot tests/*.test.js` | 642 tests; 8 failures, 634 passes | Broad ungated behavior snapshot, not an authoritative release result |
| `node --test tests/y78-reference-expedition-living-world.test.js` | PASS 8/8 | Automated living-world and 18-step Reference Expedition service trace |
| `node --test tests/y33-long-world-torture.test.js` | PASS 1/1 | Current long-world behavioral test passes despite stale quarantine |
| `node tools/yb33-torture-report.js` | `passed: true`, exit 0 | 2,650 turns, 2,544 events, eight save/reloads, 48 desktop turns, six restarts |
| source Electron UI audit | Partial success plus two agency defects | Actual renderer and production service seam, not packaged execution |
| `npm run desktop:build` | Builds Windows ARM64 zip | Build mechanism works, but command is not host-aware |
| `npm run desktop:verify` after official build | FAIL: missing packaged executable/archive | Verifier searches Mac artifact while build created Windows artifact |
| direct `electron-builder --mac` | PASS build | ARM64 Mac zip can be produced; unsigned and not official chain |
| `npm run desktop:verify` after Mac build | FAIL after timeout (`status: null`) | Packaged desktop smoke did not complete |

## Why inventory reports 97 errors

The errors are not one undifferentiated mass:

- 63 governed files match the approved hash only after LF is converted to CRLF. The authority was anchored from Windows raw bytes while the verifier hashes checkout bytes, so a normal macOS LF checkout fails. This defect existed at the `e57ceea` authority anchor itself.
- 28 protected files match raw bytes.
- 26 protected files differ beyond line endings; these include legitimately changed tests/build tools whose authority was not externally updated.
- Four tests (y75-y78) have neither required-test authority nor manifest entries.
- The six reported executable mismatches include packaging/report tools changed after the anchor.

`verification/TIERS.md` correctly says ordinary implementation work may not rewrite authority without explicit external review. Therefore this audit records the problem but does not manufacture new approved hashes.

## Eight ungated failures

| Failure group | Classification |
|---|---|
| y34 first-scene expectation (1) | Explicitly quarantined stale UI expectation |
| y35 mode labels/disabled markup (2) | Explicitly quarantined stale product-focus expectations |
| y37 LOCAL contact and death succession (2) | Real personnel continuity regression |
| y57 actual Electron renderer PROCEED hit test (1) | Real native/UI harness disagreement; y75's source-string hit-test assertion gave false confidence |
| y67 test profile overlap (1) | Safety-test logic/ordering defect |
| y68 real repository inventory (1) | Real governance/inventory failure |

The clean integration checkout does not fail y77 startup hygiene until a build writes the ignored `desktop/build-info.json`. Gemini did fail it because a previous build had left that file behind. This is a test isolation/order defect.

## False-confidence patterns

- y75 and much of y77 prove that strings, selectors, tokens, or code fragments exist. They do not prove rendering, hit testing, audio playback, or correct runtime routing.
- y78's “natural action coverage” uses supported phrases and does not assert that every explicit clause is executed or clarified. The live compound instruction exposed this gap.
- y76 validates providers under mocks. It does not certify a live hosted response, billing state, latency, model behavior, or credential storage on this Mac.
- y33 was still governed as a known failing defect even though both the test and report now pass. Stale quarantine metadata hid progress and made tier truth inaccurate.
- Direct `node --test tests/*.test.js` includes quarantined/manual/native tests but bypasses the governing runner. It is useful diagnostic evidence only.
- The Gemini `node_modules` symlink meant earlier passing results used another worktree's dependency installation. Only the integration rerun counts as reproducible evidence.
- `npm run conformance` covers the small canonical-kernel pack contract, not the desktop game, provider, UI, Reference Expedition, or release package.

## Required governance repair

An externally approved verification-baseline pass must define line-ending-normalized content identity (or Git-blob identity), review every genuinely changed protected file, admit or reject y75-y78, remove the resolved y33 defect quarantine if accepted, and rerun aggregate/long-world/native tiers from a fresh checkout on both target platforms. Until then, no aggregate count should be represented as release certification.

