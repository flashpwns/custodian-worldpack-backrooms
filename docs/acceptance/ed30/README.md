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
