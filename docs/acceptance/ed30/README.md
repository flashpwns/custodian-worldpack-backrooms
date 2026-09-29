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

## Third held-out corpus: end-to-end evaluation (2026-09-28)

- **Corpus:** `heldout3-corpus-2026-09-28.spent.jsonl`, 334 items, SHA-256 `eb0b30d45850760e485cfa969c904bfbe8ad67456488ba9aaa6adbe39dcd4dc6`.
  - Written blind by a fresh subagent after the implementation was frozen and verified. It had no access to the repository, the earlier corpora, parser output or test fixtures.
  - The author was cut off by a usage limit after 267 lines and was resumed to finish. It disclosed one breach of its rules: a single `sed` on its own `part2.jsonl` to fix three `question_form` labels. That is a label edit inside the corpus; it involves no access to the software.
  - Hashed at 2026-09-28T04:34:10Z. **Measured exactly once**, scoring Tier 1 and the full production pipeline in the same run. Results: `heldout3-run.json`. **It is spent.**

| Measure | Tier 1 only | Full production pipeline |
| --- | --- | --- |
| Speech act | 82.3 | 82.3 |
| Addressee | 85.0 | 85.0 |
| Predicate | 61.4 | 67.4 |
| Relation | 90.1 | 90.1 |
| Cardinality | 76.6 | 77.2 |
| Temporal scope | 88.3 | 88.3 |
| Question form | 76.3 | 76.3 |
| **Whole turn correct** (release-gate fields) | 46.7 | 51.2 |
| Clarify rate | 18.0 | 10.8 |
| Confident-wrong | 29.6 | 31.1 |
| Tier-2 invocation | — | 30.8% (103 turns) |
| Tier-2 accepted / rejected | — | 82 / 21 (79.6% accepted; 11 low confidence, 10 timeouts) |
| Advisory latency p50 / p90 | — | 4,180 / 7,106 ms |
| Turn latency p50 / p90 (interpretation) | — | 1 / 4,287 ms |

**The gates are not met.** Diagnosis (after the measurement; nothing was tuned against it):

1. **The gate never saw most failures.** 119 of the 178 full-pipeline failures never reached Tier 2, because the completeness gate judged them complete. The largest group is 32 unpunctuated chat questions that Tier 1 reads as statements ("yall doin ok", "we all going in together or what", "ok and this Threshold thing, what is that", "since when"). The gate only fires for lines Tier 1 already calls questions, so statement-vs-question is decided by Tier 1 alone.
2. **Accepted readings that did not help.** 32 wrong predicates had an accepted Tier-2 reading ("whats the deal today", "where we headed"). The reading either named no facet or was dropped by the plausibility check. The saved run cannot separate the two without querying the model on corpus lines again, which would be a second measurement.
3. **Follow-ups that are not word echoes.** 23 addressee misses: "since when" unpunctuated, "and you?" after a reply, and corrective repairs ("no the flashlight lol", "ugh no, whats IN it", "no like ever").
4. **Tier-2 timeouts:** 10 readings hit the 8 s limit (advisory p90 is 7.1 s).

## Fourth held-out corpus: ED-30G (2026-09-28)

- **Corpus:** `heldout4-corpus-2026-09-28.spent.jsonl`, 325 items, SHA-256 `264c6307c2f10dec6e9b7ba46b507e03cde32a9f059ca234259795cce42f709f`.
  - Written by a fresh subagent after the ED-30G implementation and verification were frozen. Its only readable input was the brief (`heldout4-authoring-brief.txt`), which quotes none of the test phrasings.
  - Hashed at 2026-09-28T09:54:41Z. **Measured exactly once**, Tier 1 and full pipeline in the same run (`heldout4-run.json`). **It is spent.**

| Measure | Gate | Tier 1 only | Full production pipeline |
| --- | --- | --- | --- |
| Speech act | ≥ 95 | 78.2 | 78.5 |
| Addressee | ≥ 98 | 81.8 | 81.8 |
| Predicate / facet | ≥ 95 | 56.3 | 67.4 |
| Relation | ≥ 95 | 85.8 | 85.8 |
| Cardinality | — | 72.6 | 76.6 |
| Temporal scope | — | 84.3 | 84.3 |
| Question form | — | 76.6 | 76.6 |
| **Whole turn correct** | — | 38.8 | 46.2 |
| Clarification rate | ≤ 8 | 23.4 | 11.1 |
| Confident-wrong | ≤ 1 | 31.7 | 34.5 |
| Tier-2 invocation | — | — | 32.6% (106) |
| Tier-2 decoded / schema-valid / semantically complete / accepted | — | — | 106 / 83 / 71 / 71 (67.0% accepted) |
| Tier-2 rejections | — | — | low confidence 23, contradictory speech act 6, missing facet 5, wh-incompatible facet 1 |
| Timeout rate | — | — | 0% |
| Advisory latency p50 / p90 | — | — | 4,336 / 4,459 ms |

**Every gate fails.** Remaining general failure classes (diagnosed after the measurement; nothing was tuned against it):

1. **Utterance force is still over-confident on statements.** 133 of 199 full-pipeline failures never reached Tier 2, including 46 lines Tier 1 was sure were statements. Examples: echo plus wh commentary ("short hauls how short"), a wh-word late in the line without a comma, social acts in chat form (greetings, farewells, "btw" introductions), and corrections whose thing does not resolve. The completeness gate trusts Tier 1's certainty, so these never get the bounded reading.
2. **The legacy "what is X" reading takes item questions.** In 35 questions the older frame builder's entity-definition route answered an item-purpose, contents or holder question, so the gate saw a complete turn.
3. **Discourse follow-ups with commentary, and answers to a coworker's question.** 23 addressee misses ("X, really", "the first hallway, seriously", answering "kinda?" to a coworker's question).
4. **Tier-2 low-confidence declines on short fragments.** 19 readings; they fail closed, so these lines were clarified or kept their Tier-1 reading.

## Fifth held-out corpus: ED-30H (2026-09-29)

- **Corpus:** `heldout5-corpus-2026-09-28.spent.jsonl`, 330 items, SHA-256 `914ffc1e527eb2166de2fa8d14013b00b49df2046ddff34b79c0c4c32fd0e982`.
  - Written by a fresh subagent after the ED-30H implementation and verification were frozen. Its only readable input was `heldout5-authoring-brief.txt`.
  - Hashed at 2026-09-29T00:00:48Z. **Measured exactly once**, Tier 1 and full pipeline in the same run (`heldout5-run.json`). **Spent.**

| Measure | Gate | Tier 1 only | Full production pipeline |
| --- | --- | --- | --- |
| Speech act | ≥ 95 | 79.7 | 80.6 |
| Addressee | ≥ 98 | 82.7 | 82.7 |
| Predicate / facet | ≥ 95 | 60.6 | 66.7 |
| Relation | ≥ 95 | 85.8 | 85.8 |
| Cardinality | — | 74.2 | 76.4 |
| Temporal scope | — | 87.9 | 87.6 |
| Question form | — | 77.3 | 77.3 |
| **Whole turn correct** | — | 42.1 | 46.1 |
| Clarification rate | ≤ 8 | 19.4 | 13.0 |
| Confident-wrong | ≤ 1 | 31.2 | 32.4 |
| Tier-2 invocation | — | — | 25.8% (85) |
| Decoded / schema-valid / semantically complete / accepted | — | — | 85 / 83 / 52 / 52 (61.2% accepted) |
| Tier-2 rejections | — | — | missing facet 24, contradictory speech act 3, no compatible antecedent 3, low confidence 2, wh-incompatible 1 |
| Timeout rate | — | — | 0% |
| Advisory latency p50 / p90 | — | — | 4,274 / 4,422 ms |

**Failure-class breakdown** (199 full-pipeline failures; criteria fixed before the measurement, `heldout5-failure-classes.json`):

| Class | Failures | Share |
| --- | --- | --- |
| Never reached Tier 2 | 128 | 64.3% |
| Definition / purpose confusion | 2 | 1.0% |
| Discourse-link failure | 46 | 23.1% |
| Short-fragment low confidence | 1 | 0.5% |

**Every gate fails.** Remaining general classes:

1. **Tier-1 over-confidence** is still the dominant class. Examples:
   - trailing chat particles and typos defeat the clause-role and force analysis ("… for tho", "actualy");
   - 19 unpunctuated questions are still read with confidence as statements;
   - 31 failures differ only in secondary fields (question form, temporal scope, clarify flag).
2. **Tier-2 readings that name no facet.** 24 readings; they fail closed to clarifications, which raises the clarification rate.
3. **Discourse links.** Reason / temporal / "who else" follow-ups whose reading has no facet, and fragment answers to a coworker's choice question.
