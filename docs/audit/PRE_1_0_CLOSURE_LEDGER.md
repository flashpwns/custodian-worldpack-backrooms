# Yellow Beast pre-1.0 closure ledger

This is the finite sequence from the audited integration baseline to a truthful 1.0 candidate. Sizes are relative engineering estimates, not calendar promises.

| ID | Title | Sev | Area | Current -> expected | Evidence / root cause | Files / dependencies | Test needed | Decision? | Size | Owner | Demo | Beta | 1.0 | Stage |
|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|
| YB-C01 | Restore verification truth | P0 | Verification | 97 inventory errors -> portable externally approved green gate | CRLF raw hashes, 26 real drifts, four ungoverned tests | `verification/*`, verifier core, changed tests/tools | Fresh LF/CRLF inventory; aggregate/long/native | External approval | M | Verification | yes | yes | yes | before next playtest |
| YB-C02 | Enforce complete player-intent coverage | P0 | AI/agency | Partial compound action silently succeeds -> every explicit clause executes, fails, or clarifies | Live “inspect while Beverly photographs” retained zero evidence | `ai-living-provider`, interpreter boundary, living turn, service | Reversed-order, arbitrary verb, 2-4 clause property corpus plus live UI | no | M | Gameplay/AI | yes | yes | yes | before next playtest |
| YB-C03 | Repair personnel continuity regressions | P0 | Personnel | y37 LOCAL/death failures -> contact and irreversible status pass | Two behavioral failures on clean install | personnel/status/reconciliation modules | y37 plus save/reload death/contact scenarios | no | M | Simulation | yes | yes | yes | before next playtest |
| YB-C04 | Reconcile LOCAL broadcast/addressee/speaker UI | P1 | Dialogue/UI | Broadcast logged as first coworker while response names another -> truthful broadcast/target and one authorized speaker | Live Beverly message displayed `YOU -> Santiago` | service comms, q4 interactions, renderer surfaces | Native chronology and targeted/broadcast dialogue cases | product copy only | S-M | Gameplay/UI | yes | yes | yes | before next playtest |
| YB-C05 | Make build/verify platform-coherent | P0 | Packaging | build always Windows; verifiers Mac/Windows/x64 disagree -> explicit host/target artifact contract | Official build/verify failure; first-run hardcoded path | build and two verifier tools, package scripts | Mac ARM native; Windows x64/ARM as supported | target platforms | M | Release | yes | yes | yes | before shareable demo |
| YB-C06 | Fix native renderer smoke and test isolation | P1 | Native UI | PROCEED hit-test and packaged timeout -> repeatable fresh-profile smoke | y57 fail; packaged desktop timeout; ignored build-info affects y77 | renderer smoke, profile resolver, build-info lifecycle | source and packaged first-run/settings/resume | no | M | UI/Release | yes | yes | yes | before shareable demo |
| YB-C07 | Remove mixed-checkout dependency behavior | P1 | Build hygiene | ignored symlink possible and lock version stale -> fresh local install is mandatory and metadata exact | Gemini symlink; lock says 1.5 while b373 package says 1.6 | package lock/docs/CI | clean-clone install and dependency commit assertion | Custodian commit | S | Release | yes | yes | yes | before shareable demo |
| YB-C08 | Complete human Reference Expedition matrix | P1 | Playability | automated 18-step pass -> three contrasting human full shifts incl omission/contradiction/report paths | Specimen brief requires it; current live audit stopped at agency defect | game/UI/test protocol | recorded run IDs, saves before/during/after, break scoring | report semantics | M | QA/Design | yes | yes | yes | before beta |
| YB-C09 | Certify live hosted AI | P1 | Providers | mocks only -> bounded real interpretation/dialogue/narration with failure/fallback evidence | No key used; y76 ungoverned | provider pool/transports/settings | credentialed isolated smoke; no-secret diagnostics; provider-off parity | provider/model budget | M | AI/Release | no | yes | yes | before beta |
| YB-C10 | Audio authority and perceptual acceptance | P2 | Audio | source-contract presence -> audible event-correct, optional, accessible mix | Sol/Gemini competing approaches; no listening proof | renderer audio, facility events, settings | native event matrix and reduced-sensory pass | audio direction | M | Presentation | no | no | yes | before 1.0 |
| YB-C11 | Signing, notarization, update/install proof | P1 | Distribution | unsigned zip -> trusted install/upgrade artifacts | Mac builder found no valid signing identity | release configuration/secrets | clean-machine install, upgrade, quarantine behavior | distribution channel | L | Release | yes | yes | yes | before beta |
| YB-C12 | Dependency/security closure | P2 | Supply chain | npm audit: 1 moderate, 2 high -> accepted or remediated | Fresh install audit output | package lock/dependencies | audit triage plus full regressions | risk acceptance | M | Release/Security | no | yes | yes | before 1.0 |
| YB-C13 | Scope-lock 1.0 | P1 | Product | broad doctrine vs narrow specimen -> signed 1.0 boundary | Other modes are implemented but locked; workplace/offline progression incomplete | charter/baseline/pass map | acceptance checklist | yes | S | Director | yes | yes | yes | immediately |
| YB-C14 | Stranger play and accessibility acceptance | P1 | UX | automated checks -> observed first-time human completion | Required by specimen; native settings red | UI and test protocol | keyboard, scale, reduced motion, comprehension, break log | participant criteria | M | QA/UX | no | yes | yes | before beta |

## Exact remaining passes

1. **Agency correctness pass:** C02, C03, C04 with fresh behavioral tests; no presentation expansion.
2. **Verification authority pass:** C01 and C07 under external baseline review.
3. **Native release-path pass:** C05 and C06 on Mac, then supported Windows architecture.
4. **Reference Expedition human proof pass:** C08 with three saved/reloaded paths and explicit break scoring.
5. **Hosted AI proof pass:** C09 across configured provider, missing credential, rate/credit failure, malformed output, and provider switching.
6. **Distribution and safety pass:** C11, C12, C14.
7. **1.0 presentation closure:** C10 plus only the scope admitted by C13.
8. **Release-candidate rerun:** clean clones, authoritative tiers, full live shift, save/reload/corruption recovery, signed packages, and final ledger zero-blocker review.

The repository is safe for scoped corrective development on the integration branch. It is not safe for broad feature development, a shareable demo, beta labeling, or 1.0 release.

The next single highest-value work order is C02: build clause-complete natural-language interpretation so no explicit player or coworker attempt can disappear behind a successful response.

