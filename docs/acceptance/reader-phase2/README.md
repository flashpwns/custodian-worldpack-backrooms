# Reader Phase 2: acceptance artifacts

Design and results are in `docs/reader/READER_PHASE2.md` (Step 0.1: §12).

| File | What | Governed by |
| --- | --- | --- |
| `token-distribution.json` | Model-facing dynamic-token distribution over every replayed development ReaderInput (render v2), by class: context-free, discourse-bearing, real scenario, human trace. Pinned tokenizer (Gemma 4 E4B Q4_K_M via llama.cpp b11146 `/tokenize`), plus wire cost and early-branch uniqueness. G1: discourse-bearing p90 263 ≤ 300 and human-trace p90 292 ≤ 300 (p99 / max reported). | SHA-256 pinned in `tests/ed33a-reader-phase2-step0.test.js` |
| `dev-manifest.json` | The frozen development set: 944 replayed turns with stratum, context tags and the SHA-256 of exactly what a reader sees (`render_digest`); the 552 distinct-render groups with every occurrence; the distinctness counts and their definitions. | SHA-256 pinned in `tests/ed33b-reader-phase2-replay-full.test.js`, which recaptures and re-checks every digest, group and count |
| `teacher-dev-sample.json` | The PREREGISTERED development teacher sample: a census of the 474 headline-eligible distinct renders, with its estimator, interval, label-loss, transport and stop rules; context-missing probe renders listed as diagnostic only. Frozen before any label or teacher choice. | SHA-256 pinned in `ed33b` (and reproduced from the capture) |
| `rare-state-shapes.json` | Machine counts of coworker-question turns by shape (`--shapes`). | reproduced from the capture in `ed33b` |
| `power.json` | Power calculations behind the sealed-set statistical policy (`node tools/dialogue-reader-power.js`): normal approximations and exact binomial power / the sealed-size rule. | report |

**Regenerate** (a governance change: the pins must be updated with the artifact):

```
node tools/dialogue-reader-replay.js --capture <tmp>/capture.json
node tools/dialogue-reader-replay.js --tokens <tmp>/capture.json --out docs/acceptance/reader-phase2/token-distribution.json
node tools/dialogue-reader-replay.js --manifest <tmp>/capture.json --out docs/acceptance/reader-phase2/dev-manifest.json
node tools/dialogue-reader-replay.js --teacher-sample <tmp>/capture.json --out docs/acceptance/reader-phase2/teacher-dev-sample.json
node tools/dialogue-reader-replay.js --shapes <tmp>/capture.json > docs/acceptance/reader-phase2/rare-state-shapes.json
node tools/dialogue-reader-power.js > docs/acceptance/reader-phase2/power.json
```

**Live-model scores** (teacher, E4B) are supporting and non-authoritative:

- each is written with its contract, model and render identities (`--run … --out`);
- none is a CI requirement;
- none exists yet (see `READER_PHASE2.md` §11).
