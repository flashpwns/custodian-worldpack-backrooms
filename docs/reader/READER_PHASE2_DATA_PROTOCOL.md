# Dialogue reader: Phase 2 data protocol

**Status:** 2026-09-30. It prepares the development, calibration and sealed sets. **No sealed set is generated,
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
| Rare state | `tests/fixtures/reader-phase2/rare-state-scenarios.json` | `scripted_rare_state` | inbound answers (≥ 60), chip targets, conclude / withdraw, repairs, activity rounds |

**Still to add** (tagged on arrival; none exist in the repository yet):

- `owner_playtest`: real owner playtest transcripts (local exports only, no telemetry);
- `fresh_multi_author`: fresh multi-author utterances written by independent authors;
- `minimal_pairs`: minimal pairs and metamorphic diagnostics (`tests/fixtures/ed30/minimal-pairs.js` /
  `metamorphic.js`, rendered through the same capture);
- `adversarial`: adversarial items.

**Reporting.** The headline development number is **weighted toward estimated real-play frequency**:

| Stratum | Default weight | Why |
| --- | --- | --- |
| `owner_playtest`, `human_trace` | 3 | closest to real play |
| `j15` | 2 | scripted but conversational |
| `scripted_state` | 1 | real state, scripted |
| `ed30_dev`, `ed30_dev_novel` | 1 | context-free probes |
| `scripted_rare_state` | **reported separately** | coverage, not frequency |
| `minimal_pairs`, `adversarial` | **reported separately** | diagnostic |

The weights are fixed before any teacher score (they are passed to `--run --weights`). Unweighted per-stratum numbers
are always reported next to the weighted headline.

**Size at freeze.**

- 835 replayed turns from the characterized fixtures (444 distinct renders), plus the rare-state stratum.
- Labelling de-duplicates by render digest: two providers that produce the same render are one item.
- The teacher experiment needs **n ≥ 300** development turns. The current distinct renders exceed that.

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
- **Size:** set by the statistical policy (`READER_PHASE2_PREREGISTRATION.md` §6). The recommendation is **n = 1,000**
  turns under a small conjunctive gate family.

## 4. Rare-state scripted stratum

Target: **≥ 60 applicable cases** for each important rare field.

| Field | Current dev coverage (distinct renders) | Rare-state stratum |
| --- | --- | --- |
| inbound answer (pending `i1`) | 18 | **62** (yes / no, choice, person, item, time, free; uncertainty, refusal, counter-question, answer + follow-up) |
| just-answered own-answer repair (`i0`) | 9 | (grows with the inbound turns that follow an answer) |
| chip target | 4 | 2 more; **short of 60**, reported only |
| conclude / withdraw | 5 (legacy "that's that") | 6 more; **short of 60**, reported only |

Fields short of 60 are reported, never gated, until more rare-state items are added.

## 5. Provenance and privacy

- No telemetry. Owner transcripts are local exports, and they are added only by the owner.
- Every item keeps its source file and fixture id (`id = <fixture>#<provider>#<request id>`).
- A development item never moves into calibration or sealed use.
