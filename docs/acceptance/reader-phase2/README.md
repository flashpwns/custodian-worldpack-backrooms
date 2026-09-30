# Reader Phase 2: acceptance artifacts

Design and results are in `docs/reader/READER_PHASE2.md`.

| File | What | Governed by |
| --- | --- | --- |
| `token-distribution.json` | Model-facing dynamic-token distribution over every replayed development ReaderInput. Uses the pinned tokenizer (Gemma 4 E4B Q4_K_M via llama.cpp b11146 `/tokenize`), plus wire cost and early-branch uniqueness. G1: p90 245 ≤ 300. | SHA-256 pinned in `tests/ed33a-reader-phase2-step0.test.js` |
| `dev-manifest.json` | The frozen development set: 927 replayed turns (535 distinct renders), each with its stratum and the SHA-256 of exactly what a reader sees (`render_digest`). | SHA-256 pinned in `tests/ed33b-reader-phase2-replay-full.test.js`, which recaptures and re-checks every digest |
| `power.json` | Power calculations behind the sealed-set statistical policy (`node tools/dialogue-reader-power.js`). | report |

**Regenerate** (a governance change: the pins must be updated with the artifact):

```
node tools/dialogue-reader-replay.js --capture <tmp>/capture.json
node tools/dialogue-reader-replay.js --tokens <tmp>/capture.json --out docs/acceptance/reader-phase2/token-distribution.json
node tools/dialogue-reader-replay.js --manifest <tmp>/capture.json --out docs/acceptance/reader-phase2/dev-manifest.json
node tools/dialogue-reader-power.js > docs/acceptance/reader-phase2/power.json
```

**Live-model scores** (teacher, E4B) are supporting and non-authoritative:

- each is written with its contract, model and render identities (`--run … --out`);
- none is a CI requirement;
- none exists yet (see `READER_PHASE2.md` §11).
