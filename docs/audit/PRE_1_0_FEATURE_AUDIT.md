# Yellow Beast pre-1.0 feature and completeness audit

Status terms: **implemented** means behavior was exercised; **partial** means a real path exists but a required case or gate failed; **present-only** means code/UI/spec presence was found without sufficient behavioral proof; **missing** means the required capability is not yet delivered.

| System | Status | Evidence | Release judgment |
|---|---|---|---|
| First-run record/personnel/briefing/staging/Threshold flow | Implemented with native-smoke inconsistency | Live source UI reached field operation; y48/y78 paths pass. Native renderer smoke reports PROCEED not hit-testable | Fix/retire contradictory smoke before demo |
| Persistent Reference Expedition geography and objects | Implemented | y78 8/8; live Utility Room state restored after app restart | Keep as canonical spine |
| Evidence/report/belief separation | Implemented in automated specimen | y69/y78 cover evidence, written claim, and institutional assessment | Still needs three contrasting human runs |
| Coworker location, hold/follow, custody | Implemented for scripted cases | y70/y78 behavior tests pass | General language coverage remains partial |
| Natural-language player action | Partial, P0 for next playtest | Live input “I inspect ... while Beverly photographs it” committed only inspection and presented success | Require all-clause accounting and clarification on omission |
| AI environmental narration | Partial but structurally sound | Live observation was material, observer-safe, in-universe; y73 rejects hidden geometry and invented player action | No live hosted-model quality/cost/latency evidence |
| Coworker dialogue | Partial, P1 | Live named Beverly message was broadcast to all, UI logged `YOU -> Santiago`, while response copy named Beverly | Unify broadcast/addressee/speaker presentation and test actual UI record |
| Provider fallback and switching | Implemented under mocks | y76 passes 16 focused cases in direct suite | Test is ungoverned; no credentialed live request during audit |
| Save/reload and atomic recovery | Implemented for audited path | Live restart restored T+5, Utility Room, fixture inspection, team, objective, radio history, and zero photographs; y33 passed 2,650 turns and eight reloads | y37 death/contact regressions still block global continuity claim |
| Personnel continuity | Partial / regressed | y37 fails LOCAL contact eligibility and confirmed-death succession | Must repair before next playtest involving personnel consequence |
| Full shift through report/debrief | Automated only | y78 completes an 18-step trace to institutional assessment | Live UI audit stopped after reproducing agency defect; human full-shift proof remains missing |
| Offline play | Implemented | Live audit ran without hosted credentials; y33 reports 48 successful desktop actions and fallback safety | Offline interpreter fidelity is too narrow |
| Audio architecture | Present-only / partial | y75 source-contract tests; Sol dirty pass contains competing work | No audible end-to-end acceptance or event-authority audit completed |
| Accessibility/preferences | Mostly implemented | broad behavioral/source tests pass | Native settings smoke fails; must verify on packaged app |
| macOS package | Partial | direct `electron-builder --mac` produced ARM64 zip | Unsigned; official build command does not build Mac; packaged smoke timed out |
| Windows package | Partial | official build produced Windows ARM64 zip | First-run verifier expects `win-unpacked` (not `win-arm64-unpacked`); not executed on Windows |
| Release verification | Broken | `npm test` exits at 97 inventory errors | P0 release blocker |
| Test-profile isolation | Partial | y67 fails precedence of overlap versus missing-marker validation | Repair to make production-data safety proof unambiguous |
| Beck/Lost/Nullzone | Implemented in shared-engine tests but product-locked | many direct tests pass; live UI labels them access unavailable | Post-Reference-Expedition unless 1.0 scope says otherwise |
| Multi-career/full persistent workplace/offline progression | Missing relative to broad vision | Current baseline and specimen explicitly narrow scope | Director must confirm 1.0 boundary |
| Stranger playtest and break scoring | Missing | No fresh human stranger evidence in this audit | Required before shareable demo/beta |

## Adversarial findings

- The deterministic living interpreter contains a special case for `while` plus measurement and assumes the coworker clause precedes the player clause. Other explicit parallel clauses fall through to the first matching single action.
- A successful partial interpretation has no explicit clause-coverage check. The presentation therefore conceals loss of player intent.
- LOCAL without a `target` is canonically broadcast to all eligible peers. The renderer reduces the target list to its first member in the chronology, even when the response selector correctly favors a different named person in the message.
- `DesktopService` is the convergence point for interpretation, canonical dispatch, presentation, persistence, and UI projection. The boundaries exist as modules, but orchestration-level regression risk is high.
- The ignored generated `desktop/build-info.json` affects a test that claims startup hygiene, making the test order/worktree history significant.
- The source repository contains 752 tracked files and 104 governed included tests plus four ungoverned tests. Breadth is not the missing ingredient; closure and trustworthy gates are.

## Missing proof, not assumed absence

No live hosted-provider request was made because no credential was supplied or exposed. No Windows execution, signing/notarization, installer upgrade, corrupted live-save recovery, three-run human report comparison, or stranger usability session was certified. These remain explicit evidence gaps rather than inferred failures.

