# Verification inventory reconciliation — 2026-10-05

The starting 67 inventory errors prevented aggregate execution. They were metadata drift, not 67 failing tests:

| Classification | Items | Errors | Resolution |
| --- | ---: | ---: | --- |
| Missing test registration in manifest and required authority | 26 | 52 | Include in required aggregate; retain every test |
| Stale approved test hashes | 12 | 12 | Review current committed semantics, refresh approved hashes |
| Stale approved executable hashes | 2 | 2 | Review committed build/desktop verifier changes, refresh hashes |
| Missing script disposition | 1 | 1 | `desktop:local-install` is non-verification developer tooling |

No obsolete path, intentional exclusion or missing source explained these 67 errors. The existing four quarantines, required tiers, native commands, reports and verifier-core hashes stay intact. The owner explicitly authorized repair in this task. Hash refreshes approve the reviewed final source; they do not certify a passing run. Subsequent full execution exposed real failures and obsolete synchronous test callers, which were repaired separately rather than hidden in inventory.

## Newly registered required aggregate tests

- `tests/ed1-dialogue-discourse.test.js`
- `tests/ed15-dialogue-blockers.test.js`
- `tests/ed16-dialogue-closure.test.js`
- `tests/ed2-semantic-enforcement.test.js`
- `tests/ed21-validation-clean.test.js`
- `tests/ed22-context-bridge.test.js`
- `tests/ed23-provider-runtime.test.js`
- `tests/ed24-freeze-invariants.test.js`
- `tests/ed25-human-acceptance-dialogue.test.js`
- `tests/ed26-conversation-semantics.test.js`
- `tests/ed3-local-runtime-dev.test.js`
- `tests/ed33f-reader-machine-labeling.test.js`
- `tests/ed33g-reader-local-labeling.test.js`
- `tests/ed33h-reader-local-repair.test.js`
- `tests/ed33i-reader-exception-workstation.test.js`
- `tests/ed4-dialogue-reconciliation.test.js`
- `tests/ed5-autonomous-and-known-answer.test.js`
- `tests/y166-dialogue-runtime-supervisor.test.js`
- `tests/y167-cinematic-warmup-skip-gate.test.js`
- `tests/y168-observation-authority.test.js`
- `tests/y169-observation-persistence-integration.test.js`
- `tests/y170-speech-scheduler.test.js`
- `tests/y171-autonomous-speech-live.test.js`
- `tests/y172-autonomous-speech-turn-safety.test.js`
- `tests/y173-autonomous-speech-refresh.test.js`
- `tests/y174-autonomous-report-rendering.test.js`

## Starting hash drift

The following are the pre-repair drift records. A baseline commit means that blob matched the previously approved hash; it is not a new test result. Four old hash values had no matching Git blob in the available history; their current tests were reviewed against the committed runtime and acceptance law instead of inventing an earlier audit.

| Path | Prior approved blob found at |
| --- | --- |
| `tests/y75-ui-audio-spec-compliance.test.js` | `629bac4` |
| `tests/y76-provider-autoselect-fallback.test.js` | `e7c1e11` |
| `tests/y91-cq4-day1-opener-core.test.js` | `629bac4` |
| `tests/y97-local-model-provider.test.js` | `629bac4` |
| `tests/y98-opening-beats-1-4.test.js` | `629bac4` |
| `tests/y102-managed-inference-appliance.test.js` | `629bac4` |
| `tests/y108-beat-2-4-convergence-repair.test.js` | No matching blob found |
| `tests/y109-local-coworker-dialogue-runtime.test.js` | No matching blob found |
| `tests/y110-dialogue-interpretation.test.js` | No matching blob found |
| `tests/y111-local-group-dialogue-pass.test.js` | No matching blob found |
| `tests/ed33d-reader-phase2-labeling-workstation.test.js` | `1a3abd9` |
| `tests/ed33e-reader-phase2-easy-labeling-ui.test.js` | `1a3abd9` |
| `tools/build-desktop.js` | `629bac4` |
| `tools/verify-desktop-artifact.js` | `b8be8d7` |

## Repairs revealed by execution

LOCAL responder generation is asynchronous. Older test callers now await its result (including their setup helpers); success, routing, no mutation, persistence and knowledge assertions remain enforced. Test expectations for the startup audio graph reflect the committed `1c3d106` graph, which the connected graph tests also exercise. Default settings select local inference even when it is unavailable; the tester report preserves the selected mode and separately reports offline status. Local provider selection requires the managed appliance’s actual READY status.

`12f0104` removed unrouted scripted delivery dialogue from the decision scheduler. Delivery tests now demand its personnel-status events and explicitly reject the obsolete fabricated dialogue while retaining bag custody, location, mission and delivery assertions. Broadcast knowledge checks examine reported-knowledge records rather than assuming every heterogeneous knowledge record contains text.

Three runtime repairs retain the original authority: draining an absent speech queue cannot create canonical state after a failed input; coworker projection copies tasks before freezing its own snapshot so a subsequent dialogue save can persist mutable canonical tasks; LOCAL fallback public wording consists of committed speech, with provider failure provenance retained in diagnostics.

## Frozen Reader artifacts

The recorded Convention B owner policy changes exactly one historical validator disposition: spoken “Tonya, how are you?” with Malcolm delivery is accepted instead of rejected. `tests/fixtures/reader-owner-policy-overlay.js` asserts the exact old row before applying that one-field expectation change. Frozen characterization, round-trip, shadow-diff, Teacher sample and experiment files remain unchanged and hash-pinned. Every other field, routing result and lifecycle comparison remains exact. Resolver-spec fixture r25 is updated to ACCEPT with its routing unchanged; it is owner-authored specification, not independent benchmark gold. New validation receipts and scores identify `yellow-beast-reader-validator@v2-convention-b`; historical scores must not be pooled across validator implementations without explicit revalidation and retained provenance.

The long-world tier also revealed stale Reference Expedition fixture assumptions. Those callers now await LOCAL completion and explicitly inject their deterministic provider. The renderer retry harness isolates the actual communication submit listener. Group delivery checks use canonical recipient IDs rather than the single “Team” display label. Private-knowledge coverage now seeds a distinct coworker-only observation and checks its exclusion from the player projection. Hosted fixtures obey bounded clarification and opinion contracts; persistence, idempotency, overlapping requests and failure recovery remain exercised. The unresolved recall question still clarifies, exposes no unrestricted history/memory bags, and rejects a model's attempted memory answer rather than treating its own pending input as delivered history.

Packaging writes a temporary `desktop/build-info.json` and removes it in `finally`. An aggregate run overlapping native packaging correctly failed startup hygiene. The overlap left an earlier generated metadata file restored by a build; it was preserved in local verification evidence and moved out of the source path. Final aggregate verification runs after native packaging completes; its hygiene assertion and the build cleanup are unchanged.

Final command totals and desktop evidence are recorded in `../docs/dialogue/DIALOGUE_CLOSURE_STATUS.md`.
