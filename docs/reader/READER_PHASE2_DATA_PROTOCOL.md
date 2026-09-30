# Dialogue reader: Phase 2 data protocol

**Status:** 2026-09-30; amended at Step 0.1 (same day, before any label). It prepares the development, calibration and
sealed sets. **No sealed set is generated,
hashed or opened in Phase 2.** The calibration set is not opened in this pass.

**Authority.** The held-out protocol governs these sets:

- a spent corpus is never reopened;
- a blind set is authored independently;
- a blind set is hashed before any change it measures;
- a blind set is measured once.

The six spent ED-30 blind corpora (`.agent-notes/heldout*`) are **not** development data. They are never read by any
Phase-2 tool.

## 1. Development set (open, reusable)

**Built by:** `node tools/dialogue-reader-replay.js --capture <file>`. It captures every LOCAL turn of every
development fixture through the real service, and the frozen manifest pins each turn's render digest
(`docs/acceptance/reader-phase2/dev-manifest.json`, checked by `ed33b`).

| Stratum | Source | Tag | Nature |
| --- | --- | --- | --- |
| J15 scripts | `tests/fixtures/ed30/j15/{1,2,3,5}` | `j15` | scripted multi-turn sessions (terse, verbose, chaotic, chain) |
| Human trace | `j15/4-human-trace.txt`, `tests/fixtures/ed30/transcripts/human-trace-f1-f12.jsonl` | `human_trace` | a real owner play trace |
| Scripted state | the Phase-0.5 characterization scenarios | `scripted_state` | ED-30 test scenarios: chips, coworker questions, Tier-2, cold reloads |
| ED-30 DEV corpora | `dev-corpus.jsonl`, `dev-h.jsonl` (context-free single-turn probes) | `ed30_dev` | development probes only, **never** the spent blind held-outs |
| ED-30 novel DEV | `dev-novel.jsonl` | `ed30_dev_novel` | novel-phrasing development probes |
| Rare state | `tests/fixtures/reader-phase2/rare-state-scenarios.json` | `scripted_rare_state` | coworker-question turns (72 pending; exact shapes in §4), own-answer corrections, chip targets, conclude / withdraw, repairs, activity rounds |

**Still to add** (tagged on arrival; none exist in the repository yet):

- `owner_playtest`: real owner playtest transcripts (local exports only, no telemetry);
- `fresh_multi_author`: fresh multi-author utterances written by independent authors;
- `minimal_pairs`: minimal pairs and metamorphic diagnostics (`tests/fixtures/ed30/minimal-pairs.js` /
  `metamorphic.js`, rendered through the same capture);
- `adversarial`: adversarial items.

**Unit (0.1).** The measurement and labelling unit is the **distinct frozen render** (render digest):
`dialogue-reader-replay.js renderGroups` de-duplicates source rows (two wording providers, a repeated scenario line,
the two copies of the human trace) and keeps the mapping render → every occurrence (source row, stratum, fixture) in
`dev-manifest.json`. A render in several strata takes the first of human trace, j15, scripted state, rare state, ED-30
novel, ED-30 dev as its primary stratum.

**Context-dependent probes (0.1).** 81 ED-30 development probes are authored with prior conversational context
(`last_npc_line`, `last_player_line`, `active_speaker`, `active_activity`, `pending_unanswered_request`) that the replay
does not rebuild. Every capture row carries `context_dependent` and `context_available`; such probes (162 rows, 78
renders) are **diagnostic only**, never headline.

**Reporting (0.1).** The headline development number is the **unweighted** proportion over the preregistered teacher
sample (a census of the headline-eligible distinct renders; preregistration §3), each render counted once. Unweighted
per-stratum numbers with Wilson intervals are always reported next to it. The Step-0 frequency weights (human trace 3,
j15 2, the rest 1) are withdrawn from the headline: with 19 distinct human-trace renders a weight of 3 let a tiny
stratum dominate. They may be reported as a labelled secondary view (`--weights`), never as the headline.

**Size at Step 0.1** (`docs/acceptance/reader-phase2/dev-manifest.json`; definitions recorded in it):

| | Step 0 capture | Step 0.1 capture |
| --- | --- | --- |
| source rows | 927 | 944 |
| distinct player turns (fixture, typed text, chip) | 558 | 575 |
| distinct player-turn positions | 563 | 580 |
| distinct texts (trimmed, lower case) | 456 | 470 |
| distinct renders | 535 | 552 |
| headline-eligible renders | | 474 |

By primary stratum (rows / distinct renders / headline-eligible): j15 266 / 132 / 132; human trace 64 / 19 / 19;
scripted state 107 / 102 / 102; ED-30 dev 354 / 169 / 99; ED-30 novel 44 / 22 / 14; rare state 109 / 108 / 108. (The
Step-0 text's "835 replayed turns (444 distinct renders)" was stale: the Step-0 capture had 927 rows.)

## 2. Calibration set (fresh, independent, frozen)

- **Size:** ≥ 300 turns initially.
- **Independence:**
  - fresh utterances written by authors who have not seen the development items, the prompt or the wire;
  - multiple authors and personas;
  - played through scripted canonical prefixes, exactly as the gold evaluator builds state.
- **Freeze:** the manifest (render digests) is hashed and committed **before** it is opened.
- **Use:** only for per-field margin thresholds and the accept / clarify operating point. **No prompt, render, wire or
  schema change after it is opened.** If one is needed, the set is spent and a new one is built.
- **Labels:** double labelled on all routing-critical fields (label guide §5).

## 3. Sealed acceptance set (preregistration only in Phase 2)

- **Not generated, not opened** in Phase 2.
- **Source protocol:**
  - written blind by independent authors (no repository, prompt, wire or development-item access);
  - stratified like the development headline weights;
  - with a rare-state quota so that each routing field reported has ≥ 60 applicable items.
- **Hash:** the SHA-256 of the item file is committed before any reader, render or resolver change it will measure.
- **Measured once**, then spent.
- **Size:** set by the pinned sample-size rule (`READER_PHASE2_PREREGISTRATION.md` §6.2) **before** the set is
  generated: exact power ≥ 80% for the false-confident gate at a planning true FC of 2%, with the author / prefix design
  effect (≈ 1,800 turns with no clustering; more with it). The Step-0 "n = 1,000" recommendation is withdrawn.

## 4. Rare-state scripted stratum

Target: **≥ 60 applicable cases** for each important rare field. Every authored reply to a coworker question carries a
developer coverage tag (`reply`: answer / uncertainty / refusal / counter_question / answer_follow_up /
own_answer_correction), used only for machine counts, never as gold. Counts are machine counts over the capture
(`node tools/dialogue-reader-replay.js --shapes`; `docs/acceptance/reader-phase2/rare-state-shapes.json`, pinned by
`ed33b`):

| Shape (pending coworker question `i1` unless noted) | Rare-state turns |
| --- | --- |
| yes / no answer | 16 |
| choice answer | 12 |
| person answer | 7 |
| time answer | 5 |
| item answer | 5 |
| free short answer | 5 |
| uncertainty | 4 |
| refusal | 4 |
| counter-question | 3 |
| answer + follow-up | 9 |
| not an answer (a line said while a question was pending) | 2 |
| **all pending-question turns** | **72** (Step 0: 64, of which 62 authored replies) |
| own-answer correction (just-answered `i0`) | 8 (Step 0: 0) |

Other strata add 22 pending-question turns (j15 8, scripted state 14; untagged).

**No shape has 60 cases.** The aggregate count of pending-question turns does not give per-shape statistical power:
every shape is reported, never gated.

| Other rare field | Development coverage |
| --- | --- |
| chip target | short of 60, reported only |
| conclude / withdraw | short of 60, reported only |

## 5. Provenance and privacy

- No telemetry. Owner transcripts are local exports, and they are added only by the owner.
- Every item keeps its source file and fixture id (`id = <fixture>#<provider>#<request id>`).
- A development item never moves into calibration or sealed use.

## 6. Resolved-outcome doctrine review sample (0.1)

The independent ~100-item human review of `resolveTurn(gold)` outcomes (label guide §5) is drawn **after** adjudication
and **before** any teacher headline score is interpreted:

- the capture's knowledge flags were generated for production's (legacy) facet; where the gold facet differs, knower
  selection may be under-specified;
- the review therefore **oversamples items whose gold primary facet differs from the legacy (L0) primary facet**: all
  of them up to 60, the rest of the ~100 a stratified sample of the others (`dialogue-reader-replay.js
  doctrineReviewSample`, deterministic);
- the two groups are reported separately;
- a defect found there (resolver or measurement) is fixed and added to the gold resolver spec before the teacher
  headline is scored.

## 7. Hosted egress (0.1)

Hosted teacher runs send actual player text. They require `--confirm-egress`; human-trace renders are excluded unless
`--include-human-trace` is also given; the CLI prints the provider, endpoint host, model, render count, strata,
human-trace inclusion, estimated bytes / tokens and the retention / training setting before sending anything; receipts
are mandatory. Consent is never inferred from the presence of an API key.
