# ED-30 acceptance artifacts

## J15 real-model sessions

**Setup.** Five scripted conversations, driven through the production `DesktopService` with the pinned local runtime: llama.cpp b11146 with the bundled Gemma 4 E4B Q4_K_M. The script inputs are in `tests/fixtures/ed30/j15/*.txt`.

| Session | Style |
| --- | --- |
| `j15-1-terse` | Terse typist: lowercase, typos, fragments, no punctuation (42 turns). |
| `j15-2-verbose` | Polite and verbose: indirect questions, hedges, multi-clause turns (40 turns). |
| `j15-3-chaotic` | Chaotic: sarcasm, false claims, repairs, attention calls, topic returns, and the How-are-you → Why → Tonya → "done this before" → "I meant the Complex" chain (45 turns). |
| `j15-4-human-trace` | The authoritative human Electron trace, F1–F12, verbatim (16 turns). |
| `j15-5-chain` | The chain on its own (6 turns). |

**What each session has:**

- **`*.real.json`** (real model): the player line and the committed NPC lines. It also has the turn's semantic record (address, speech act, predicate, function, cardinality, temporal scope, clarify, owners, ledger states). For each line it records:
  - the source (model or deterministic fallback);
  - the validator verdict;
  - any rejected candidate and why;
  - the post-hoc private-state and responsiveness checks.
- **`*.deterministic.json`**: the same script with no language model. This is the reviewed reference semantics.

**Scores** (`j15-scores.jsonl`, produced by `.agent-notes/j15-score.js`). Across all five sessions:

- 0 semantic mismatches between the real model and the reviewed deterministic run;
- 0 accepted private-state claims;
- 0 accepted nonresponsive lines;
- 0 dropped questions.

The fallback rate is the share of lines where the model's candidate was rejected and deterministic wording was used instead. Its turn latencies (p50/p90) are in the scores file.

The full developer-trace transcripts (JSONL, about 150 KB per session) are not committed. To regenerate one, run `npm run dialogue:repl -- --provider real --script <file>` and end the script with `:export <file>`.

## Held-out corpus (J2 / L2)

- **Corpus:** `heldout-corpus.spent.jsonl`, 338 items, SHA-256 `e3a1e6f927931e42a3935dea47485857d86b460a1760c89c8029e19d42ba5e71`.
  - It was written blind by a subagent with no access to parser source, and hashed before any parser work.
  - It was measured twice, as the brief allows: `heldout-run1.json`, then `heldout-run2.json` after fixing the underlying classes on the dev corpus.
  - **It is spent.** Do not tune against it: any future measurement needs a fresh blind set.
- **Convention-mapped view:** `heldout-convention-mapped.js` reports the second run alongside the raw numbers, never instead of them.
  - It counts an unaddressed room question labelled "group" as correct when the pipeline records "untargeted".
  - It counts `each_self_concise` as `each_self`.
  - It counts separately the items where the corpus author expected a follow-up to go to the last speaker; the pipeline rotates those per ED-29.

## Second held-out corpus (after the owner decisions of 2026-09-27)

- **Corpus:** `heldout2-corpus-2026-09-27.spent.jsonl`, 341 items, SHA-256 `2b7c89915fac1975395638ea65f72dfbf533748a90d0e42b73d82349462f0de6`.
  - Written blind by a fresh subagent. It had no access to the repository, the first corpus or any parser output. The owner decisions were given to it as labelling policy, along with explicit definitions for the two conventions the first corpus left ambiguous: "group" vs "untargeted", and follow-up routing.
  - Hashed at 2026-09-27T23:57:05Z, before any parser change for the owner decisions (tree clean at `f7f762f`).
  - **Measured exactly once** (2026-09-28T00:35:08Z), after all code changes and checks were final. Results: `heldout2-run.json`. **It is spent.**
- **Instrument:** `tools/dialogue-eval.js`, the same as for the first corpus, which scores Tier 1 only. One change: the internal wording variant `each_self_concise` is scored as `each_self`.

  | Speech act | Addressee | Predicate | Relation | Cardinality | Temporal | Question form | Clarify rate | Confident-wrong |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 84.8 | 85.0 | 62.2 | 85.0 | 81.2 | 88.6 | 73.3 | 21.7 | 24.3 |

- **The L2 gates are not met.** Two failure classes dominate (diagnosed after the measurement; nothing was tuned against it):
  - **No Tier-1 predicate** for 94 of the 129 predicate misses. These are fresh phrasings and typos outside the registry cue table ("so whats the actual job here", "Who else is coming with us?", "ok so where do we reprot after this"). Most of them become unnecessary clarifications (57 over-clarifications). In the game, a line with no facet is sent to the constrained Tier-2 advisory. This instrument does not run Tier 2.
  - **Follow-up fragments that question the reply's own words** ("Sealed how?", "Terrified of what?", "harder how", "even Maxwell?"). These are 26 of the 51 addressee misses. They are not recognised as follow-ups because the rule knows fixed fragments, anaphors and canonical names, not echoes of the reply.
