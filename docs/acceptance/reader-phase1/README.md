# Reader Phase 1: artifacts

| Artifact | What | Pinned by |
| --- | --- | --- |
| `shadow-diff.json` | per turn (471): the shadow's disposition and outcome; ACT / ROUTING / LIFECYCLE / FRAME mismatches against production, each with evidence-based reason codes; `request_text` tracked separately; the summary (levels, dispositions, causes, cause classes, turn classes) | `tests/ed32a-reader-phase1-shadow.test.js` SHA-256 pin + scenario replay; `tests/ed32b-reader-phase1-shadow-full.test.js` full replay |

- **Regenerate:** `node tools/dialogue-shadow-compare.js --out docs/acceptance/reader-phase1/shadow-diff.json`. This
  is a governance change: update the pin in `ed32a`, then `ed32a`'s hash in `verification/verification-authority.json`.
- **Design and results:** `docs/reader/READER_PHASE1.md`.
- **Gold resolver spec suite:** `tests/fixtures/reader-phase1/gold-resolver-spec.jsonl` (36 items, 100%).
- **Inertness:** `node tools/dialogue-shadow-inertness.js` (426 / 426 sessions equal).

No held-out or blind corpus was opened or created.
