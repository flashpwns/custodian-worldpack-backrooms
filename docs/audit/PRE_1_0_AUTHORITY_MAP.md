# Yellow Beast pre-1.0 authority map

The ordering is: canonical world and operation state -> deterministic resolution -> institutional/observer projections -> AI presentation -> renderer. Generated language is never allowed to become world truth. This map applies the Simulation Doctrine, Gameplay Constitution, source policy, Reconstruction Authority, Design Charter, and Reference Expedition invariants.

| Domain | Canonical owner | Projection / presentation | Persistence owner | Current conflict or risk |
|---|---|---|---|---|
| World identity and history | `tools/world-history.js` | `desktop/service.js`, mode surfaces | `DesktopService.commitPersistencePair` | `DesktopService` remains a very large orchestration and reconciliation authority |
| Run/session envelope | `tools/run-bootstrap.js` | `desktop/service.js` | `run-bootstrap.saveRun/resumeRun`, coordinated world/session pair | Multiple compatibility views and reconciliation steps make ownership hard to reason about |
| Physical geography | `tools/spatial-runtime.js`, worldpack spatial definitions | `tools/live-scene-projection.js`, map surface | run spatial state plus `world.q4_geography` snapshot | Legacy procedural geography modules coexist; use only via versioned bootstrap selection |
| Objects and interactions | `tools/object-runtime.js`, interaction definitions | live scene and renderer interactables | run object state plus `world.q4_object_state` | No second writer found, but service performs synchronization |
| Mission state and closure | `tools/mission-runtime.js`, `tools/q4-continuity.js` | Q4 experience and debrief/report surfaces | world mission records plus session state | Reference report, evidence, and institutional findings must remain three records |
| Operational time/events | `tools/operational-time.js`, `tools/operational-cycle.js` | clock and event projections | session/run | Phase transitions and physical facility events previously competed; canonical facility events are the admitted authority |
| Personnel identity/status | `tools/q4-personnel.js`, `tools/consequence-runtime.js`, `tools/q4-personnel-continuity.js` | team/live-scene projections | world characters reconciled from run | Two y37 behavioral failures show contact/death continuity is not currently trustworthy |
| Coworker tasks/orders | `tools/team-runtime.js` after validated dispatch | live scene and LOCAL presentation | run team state | Natural language can silently omit an explicit coworker attempt |
| Equipment/custody | `tools/logistics-runtime.js`, `tools/q4-equipment.js` | equipment projection | run logistics synchronized into world | Correctly blocks remote use in focused tests; mixed dependency install previously weakened build evidence |
| Environment/hazards | `tools/q4-environment.js`, `tools/hazard-runtime.js` | observer-safe environment description | world/run histories | Presentation must remain material and uncertain; no hidden phenomenon cueing |
| Evidence | `tools/q4-evidence-authority.js` | archive/media adapters | world evidence records | Optional render output is noncanonical; report path is implemented but full human specimen evidence is incomplete |
| Communications | `tools/communication-runtime.js`, `tools/q4-radio.js` | `q4Interactions`, renderer comms rail | expedition messages/history | LOCAL is a broadcast when no explicit target is supplied; renderer labels the broadcast as if sent to the first coworker |
| Institution/Standard knowledge | `tools/institutional-runtime.js`, `tools/q4-standard-operator.js` | institutional projection | world institutional records | Must learn only delivered reports/evidence, not player observation |
| Phenomena | `tools/q4-phenomenon-ecology.js` | observer-safe aliases and observations | world phenomenon state/history | Implemented families exceed the Reference Expedition's minimum proof; keep out of the next agency repair pass |
| Natural-language interpretation | `tools/ai-interpreter-boundary.js` proposes; Custodian dispatch resolves | provider pool / deterministic living provider | interpretation provenance only; proposal is noncanonical | Offline provider recognizes only a narrow hard-coded coordinated pattern and accepted a partial interpretation as full success |
| Scene narration | `tools/ai-living-turn.js`, `tools/scene-presentation.js` validation/fallback | renderer observation record | not canonical | Strong boundary tests; no live hosted call was certified during this audit |
| LOCAL dialogue prose | continuity authorizes speaker; `tools/ai-local-dialogue.js` validates wording | provider pool or deterministic fallback | only authorized interaction presentation | Addressee/speaker/broadcast labels diverge in the live UI |
| Provider choice/health | `tools/ai-provider-pool.js`, host-only credentials | settings and diagnostics | settings/credential store, never world state | Gemini implementation is broader than Sol's direct-provider rewrite; no real credentials were used |
| Renderer | `desktop/renderer/*` consumes safe projections | Electron DOM/audio | presentation preferences only | Several y75/y77 tests inspect source strings rather than actual hit testing; native smoke contradicts their green claim |
| Verification governance | `verification/verification-authority.json` plus external approved Git baseline | inventory/runner reports | repository | Authority hashes are raw-byte/line-ending sensitive and baseline was nonportable; four new tests are ungoverned |
| Packaging | `tools/build-desktop.js`, `package.json` builder config | packaged Electron | generated build record | Build hardcodes Windows; verifiers disagree on platform and architecture |

## Adjudications

1. `DesktopService` may coordinate persistence, but may not become an alternate owner of mission, personnel, environment, or evidence semantics.
2. `ai-living-provider` and hosted providers may return candidate intent and candidate prose only. A candidate that does not cover every explicit clause must clarify or reject, never report complete success.
3. Facility phase presentation follows canonical facility operation events. Audio and animation cannot advance or imply canonical state.
4. Reference Expedition is the pre-1.0 proof specimen. Broader modes and phenomenon systems remain parked unless needed to protect shared authority.
5. Verification governance must be repaired through explicit external review; this audit does not self-approve new hashes.

