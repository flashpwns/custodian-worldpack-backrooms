# ED-30 dialogue dependencies — decision record

Scope: the ED-30 brief section I authorizes tools and libraries that materially improve dialogue. Anything
shipped in the app must be:

- offline;
- permissively licensed;
- pinned;
- deterministic;
- wrapped behind an adapter.

This record lists what was added, what was evaluated and rejected, and the measurements behind each call.

## 1. fast-check 4.10.2 — ADDED (devDependency only, not shipped)

- **Why:** property-based and metamorphic testing (brief sections I4, J5). Tests run with fixed seeds, and
  failures shrink to minimal cases that are then pinned as example tests.
- **License:** MIT. The notice is in `THIRD_PARTY_NOTICES.md` under "Development-only tools".
- **Size:** 1.5 MB in `node_modules`. It is not packaged: the desktop build copies runtime `dependencies`
  only.
- **Pinning:** exact version `4.10.2` in `package.json`, with the lockfile updated.
- **Where it is used:** `tests/ed30d-properties-independence.test.js`, "J5 metamorphic — composed
  transforms".
  - Seed 30005, 600 runs.
  - One or more meaning-preserving transforms are composed over every dev-corpus item: casing,
    punctuation, apostrophes, markers, politeness, vocative position, contractions and common typos.
  - The first run found two real defects, both fixed and pinned:
    - a marker in front of a politeness lead ("So sorry, but how about you two?");
    - a lower-cased "hi, i am jack".
- **Alternatives considered:** hand-rolled random generators. Rejected because they have no shrinking and
  their seeds are not reproducible.

## 2. JavaScript NLP adapter (brief section I2) — NEITHER library adopted

The bake-off ran on the **dev** corpus only (113 labelled items); the held-out set was never touched. The
script ran outside the repository, in the session scratchpad, against:

- compromise 14.17.0 (MIT, 4.0 MB);
- wink-nlp 2.4.0 (MIT, 772 KB) with wink-eng-lite-web-model 1.8.1 (MIT, 3.8 MB).

| Measure (dev corpus) | Hand-built layer (`dialogue-normalize` / `dialogue-acts`) | compromise | wink-nlp + lite model |
| --- | --- | --- | --- |
| Question detection vs gold labels | 100.0% (tuned on this corpus) | 89.4% | 89.4% (tokens + a wh/aux heuristic) |
| Clause-count agreement with the hand segmentation | — | 98.2% | 98.2% |
| Apostrophe-less contractions ("youve", "whats", "were going", "im"…; 10 probes) | 9/10 | 2/10 | not supported (no contraction expansion) |
| Vocative vs mention (8 probes: "Tonya, tell me…" vs "Tell me about Tonya") | 8/8 | 4/8 (`people()` plus a position regex) | not supported (no name/role tagging for this) |
| Latency per utterance, p50 / p90 | 0.053 / 0.165 ms | 0.206 / 0.414 ms | 0.020 / 0.049 ms |
| Load time | 0 (already loaded) | 65 ms | 48 ms |

**Decision: neither.** The distinctions this game depends on are not what general-purpose taggers
provide:

- vocative vs mention;
- typed-without-apostrophe contractions ("were" → "we're", decided by syntax);
- closed-vocabulary name repair;
- registry facets.

Both libraries were clearly worse on the two hardest of these. Their sentence splitting added nothing:
it agreed with the existing segmentation on 98.2% of items, and the 2 disagreements were cases the
segmentation handles deliberately (choice "or…" merges and appositions). Adding either library would
ship 4–5 MB for a signal that Tier 1 already produces better.

The adapter seam stays where it is: `dialogue-acts.parseActs` is the single entry point, so a tagger can
be introduced behind it later if a need appears.

**Honesty note:** the hand-built layer's 100% is on the corpus it was tuned on. The held-out corpus
measurement, reported in the ED-30 final report, is the fair number.

## 3. Closed-vocabulary fuzzy matching (brief section I3) — hand-written, no dependency

`tools/dialogue-normalize.js` implements Damerau–Levenshtein distance in its optimal-string-alignment
form, `editDistance`. Its guards:

- at most 1 edit for words of 5 letters or fewer, 2 for longer words;
- the first letter must match;
- it never repairs an inflection;
- protected canonical words are never repaired.

It matches only against closed vocabularies: present people's names, canonical entity words and registry
cue words. It never fuzzy-matches open text into canon.

Tests: `tests/ed30a-compositional-turns.test.js` ("A normalize…") and the typo transform in J5.

`fastest-levenshtein` was not needed. The guards above are the actual safety mechanism, and they live
in our code either way.

## 4. llama.cpp constrained decoding (brief section I1) — USED (the runtime already bundled)

- **Runtime:** the pinned runtime, llama.cpp b11146 (`tools/local-runtime-pin.json`), compiles the
  OpenAI-compatible `response_format: { type: "json_schema", strict: true }` into a sampling grammar.
- **Tier-2 advisory v2** (`tools/dialogue-advisory-interpreter.js`, `requestAdvisoryV2`):
  - builds a per-scene schema whose facet enum is the registry ids and whose people and referent enums
    are opaque labels (`p1`, `r3`…);
  - the model therefore cannot emit an unknown facet, a real id or free text;
  - Tier-1 validation still re-checks every field and fails closed.
- **Wording:** stays one line per speaker in a JSON object (existing contract), constrained the same
  way.
- **Prompt caching:** the static system prefix is kept byte-stable per task. llama-server reuses the
  slot KV cache for a shared prefix by default. The measured effect is in the ED-30 report
  (Performance).

## Not added

- No Python sidecar.
- No cloud inference.
- No Ollama.
- No telemetry.
- No shipped JavaScript runtime dependency was added by ED-30.
