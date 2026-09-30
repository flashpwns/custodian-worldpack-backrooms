# Reader Phase 0 / 0.5: artifacts and measured results

**Baseline:** `9e51842`; Phase 0 was committed as `e90bff8`. The design is in `docs/reader/READER_PHASE0.md` and
`docs/reader/READER_PHASE0_5.md`. The pre-registration is in `docs/reader/READER_BAKEOFF_PREREGISTRATION.md`,
and the owner rulings in `docs/reader/READER_PHASE0_5_OWNER_RULINGS.md`.

Every number here comes from deterministic fixtures already in the repository: the J15 scripts, the checked-in
transcripts, ED-30 test scenarios, and the dev corpora as context-free probes. **No held-out or blind corpus was
opened or created.**

| Artifact | What | Pinned by |
| --- | --- | --- |
| `characterization.json` | the equivalence authority for Phase 1 (v2, value-level) | `ed31a` SHA-256 pin; `ed31b` full replay |
| `roundtrip.json` | legacy → ReaderFrame → frame-driven resolver → frame assembly, every fixture turn. **Regenerated in Reader Phase 1** with the Phase-1 resolver (verdict-consuming, owner rulings incl. C1 applied): 82.2% behaviour-equivalent / 26.5% exact; the §2 figures below are the Phase-0.5 values. Superseded as a measure by `../reader-phase1/shadow-diff.json` | `ed31a` SHA-256 pin + scenario replay; `ed31b` full replay |
| `legacy-adapter-coverage.json` | how much legacy behaviour ReaderFrame v1 expresses exactly, and why not (regenerated in Phase 1: 89.8%) | regenerable report (not an authority) |
| `baseline-failing-tests.json` | the full-repository failing set at `9e51842` (79 tests) | `ed31a` SHA-256 pin; `tools/compare-failing-tests.js` |
| `runtime-spike.json` | pinned-runtime measurements (non-authoritative; live model) | not in CI |

## 1. Characterization: the equivalence authority (`characterization.json`, v2)

**Tool:** `node tools/dialogue-characterize.js --out|--check <file> [--quick] [--census]`.

**Fixtures:** 221 sessions and **471 turns**:
- 5 J15 scripts and 1 transcript, under fallback and garbage wording;
- **16 Phase-0.5 scenarios** from ED-30 tests (`tests/fixtures/reader-phase0/characterization-scenarios.json`);
- 199 dev-corpus probes, under both wording providers.

The scenarios cover:
- coworker questions through `dialogue-state.recordInboundRequest`, with canonical option ids;
- unanswered requests through `dialogue-state.openRequest`;
- chip targets;
- cold reloads;
- scripted Tier-2 readings (accepted, recovered, rejected);
- activity rounds, repairs and surface anchors.

**Recorded per turn, at value level:**
- the full effective acts from the seam's legacy record: speech act, question form, relation + target,
  reissue, reopen, facet, **facet_source**, addressee kind / ids / quantifier / **source**, cardinality,
  temporal, polarity, **args values**, repair metadata, clarification, **overrides**;
- the turn-level facet attribution, the subject and the responders;
- the ledger mutation: requests opened / changed with **args**, targets, **answered_by**, slots and state;
  inbound added with **shape and options**; **anchor sentences**; activities;
- the active activity and active speaker, the pending inbound request;
- the planner-input **values** (each responder's semantic frame) and the plans;
- the canonical event sequence;
- a provider-independent **semantic digest** and a **persistence digest**.

Wording is recorded only as a digest. Timing is never recorded. Canonical ids are normalized, including
the `dlg-<ms>-…` event ids, which embed a wall-clock timestamp.

**Branch coverage, before (v1, 364 turns) and after (v2, 471 turns):**

| | v1 (Phase 0) | v2 (Phase 0.5) |
| --- | --- | --- |
| speech act `answer` / relation `answer` | absent | present |
| addressee sources | 12 | **23**: + activity_remaining, answer_owner, answer_repair, chip, ellipsis_unresolved, legacy_correction, open_question_answer, pending_request, person_set_continuation, repair_asker, surface_anchor |
| facet sources | none recorded (null) | **10**: tier1_registry, item_role, discourse_followup, surface_anchor, tier2_advisory, inbound_counter, inherited_request, inherited_activity, legacy_frame, legacy_other |
| clarify reasons | 5 | 8 |
| request lifecycle | SATISFIED, SUPERSEDED, CLARIFYING, ANSWERED_* | + **OPEN→SATISFIED** (reopen), **OPEN→ABANDONED** |
| chip turns / cold reloads / coworker questions / reopen acts | 0 / 0 / 0 / – | 4 / 3 / 9 / 16 |
| Tier 2 | unavailable / provider error only | + **accepted:complete**, rejected:facet_contradicts_item |
| withdraw | – | no legacy path exists; not characterizable |

**Integrity.**
- Before v2 replaced v1, the committed v1 checker was re-run against the v1 authority with the Phase-0.5 seam
  in place: **identical**. Phase-0.5 seam changes did not change production.
- v2 file SHA-256 is `cae21415…` (pinned in `ed31a`); its session digest is `ccd30325e20580a4`.

## 2. Round trip (`roundtrip.json`)

**Tool:** `node tools/dialogue-reader-roundtrip.js --out <file>`. For each of 471 turns:
1. legacy analysis → `frameFromLegacy`;
2. then the **frame-driven** `resolveTurn(frame, the real pre-turn DIS + ledger, the real present actors,
   input + bindings)`;
3. then `finalizeFrame` over the **real** pre-finalize semantic frame;

and the result is compared with what production decided.

| Measure | Value |
| --- | --- |
| Turns evaluated | 471 / 471 (0 resolver errors) |
| **Exact round trip** (every effective-act field, args and overrides included) | **37 / 471 = 7.9%** |
| **Behaviour-equivalent** (discourse function, predicate, speech act, addressees, cardinality, temporal, clarify, relation target, reissue, routing args) | **410 / 471 = 87.0%** (a coarse Phase-0.5 measure; **not readiness**, see the correction below) |

Turns per class (a turn can carry several):

| Class | Turns | Meaning |
| --- | --- | --- |
| schema-loss | 415 | information the frame cannot carry: the request's own words (406), fragment subtype, time_asked, place basis, echo span, overrides. Almost all behaviour-neutral |
| resolver-policy | 138 | the frame-driven resolver's policy differs (addressee source / inheritance, cardinality, temporal default, relation target) |
| validator-only | 31 | the frame fails V0–V3 but the round trip preserves behaviour |
| frame-assembly-text | 22 | `finalizeFrame` reads the act's words and clause (subjects, legacy route, clarify-over-guess) |
| legacy-quirk | 12 | legacy-only artifacts (adapter notes) |
| owner-decision | 11 | contested conventions (see the rulings) |
| legacy-overlay | 1 | the service's address-correction overlay decided the turn |

The 61 behaviour-different turns by class combination.

**Correction (Phase 1):** an earlier version listed these combinations with `schema-loss` silently removed; it
appears on 58 of the 61 turns. With every class shown:

| Classes | Turns |
| --- | --- |
| resolver-policy + schema-loss | 22 |
| frame-assembly-text + schema-loss | 10 |
| owner-decision + schema-loss | 9 |
| frame-assembly-text + resolver-policy + schema-loss | 7 |
| legacy-quirk + resolver-policy + schema-loss | 4 |
| resolver-policy (only) | 3 |
| frame-assembly-text + legacy-quirk + resolver-policy + schema-loss | 3 |
| frame-assembly-text + owner-decision + resolver-policy + schema-loss | 2 |
| legacy-overlay + resolver-policy | 1 |

The classes are not causes: "resolver-policy" and "schema-loss" each name a kind of difference, not why it
happened. Phase 1 replaces them with evidence-based cause codes (`docs/reader/READER_PHASE1.md` §6).

Every one is listed in `roundtrip.json` (`unresolved`).

**Correction (Phase 1): the 87.0% is not readiness.** It compares a behaviour subset and hides the request's own
words. Under the reviewed comparison:
- **strict semantic equivalence = 328 / 471 = 69.6%**;
- **exact excluding `request_text` = 304 / 471 = 64.5%**.

The Phase-1 shadow comparator supersedes both: **327 / 471 = 69.4%** equal at all four levels (act, routing,
lifecycle, planner frame; `request_text` excluded), with every remaining difference classified by cause. The
regenerated round trip (Phase-1 resolver, verdict-consuming, owner rulings applied) measures 82.2% on its own coarse
behaviour subset. That figure is kept only as a regression pin.

**Reading.** Exact expressibility (below) is **not** migration readiness. 13% of fixture turns do not survive
the round trip with the same behaviour, and 7.9% survive with every field intact. The largest movable pieces
are:
1. frame assembly reading raw words;
2. the owner rulings;
3. inheritance and cardinality policy that legacy decides in the reading layer.

## 3. Legacy adapter coverage (`legacy-adapter-coverage.json`)

| Measure | Value |
| --- | --- |
| Turns / frames | 471 / 471 |
| **Expressible exactly** | **422 / 471 = 89.6%** (scripts 87.9%, transcript 87.5%, scenarios 83.2%, probes 94.5%) |
| Validator disposition of legacy frames | accept 419, clarify 40, reject_fields 12, reject 0 |
| Non-exact turns / sum of class turn counts | 49 / 52: 3 turns carry two classes, each listed in `multi_class_turns` |

**Classes (turns):**
- reader-schema gap: 7;
- resolver-policy concern: 22;
- legacy-only artifact: 12;
- needs-owner-decision: 11.

**Validator findings versus the legacy decision** (declined-with-legacy / legacy-proceeded):

| Finding | Declined with legacy | Legacy proceeded |
| --- | --- | --- |
| V3 no_antecedent | 35 | 4 |
| V1 question_form_incompatible | 0 | 11 |
| V2 contradicts_chip_target | 0 | 1 |
| V2 non_asking_reading_with_asking_features | 0 | 1 |
| V3 others_count_mismatch | 3 | 0 |

**Phase-0 numbers corrected.** The 92.6% on 364 turns counted 4 / 5 / 11 / 8 turns per class over 27 non-exact
turns. One turn ("Giselle?", `j15/3-chaotic`) carried both a resolver-policy note and a legacy-only note. See
`READER_PHASE0.md` §8.

## 4. Gold-DIS evaluator (`tools/dialogue-gold-eval.js`, v2)

On the harness self-test (`tests/fixtures/reader-phase0/gold-harness-selftest.jsonl`: 9 mechanics items,
**not** a corpus):
- 7 scored;
- 1 `prefix_invalid` (by design);
- 1 `incomplete_state_verification` (by design);
- every gold frame passes V0–V3;
- **resolver-on-gold-frame 7/7 (100%)**, with the real DIS, real present actors and real bindings;
- end-to-end behaviour 6/6.

These show the harness works; they are not accuracy evidence.

## 5. Runtime spike (`runtime-spike.json`, `tools/dialogue-reader-spike.js`): non-authoritative

**Setup.** Apple M3 16 GB; llama.cpp b11146; `yellow-beast-local-v1.gguf`. Isolated servers; **production flags
unchanged**. Config A = production flags; B = `--parallel 2`; C = `--cache-ram 1024`.

| Measure | A | B | C |
| --- | --- | --- | --- |
| Current Tier-2 prompt tokens p50 / p90 | 866 / 893 | same | same |
| Tier-2 replay latency p50 / p90 | 4,631 / 4,752 ms | 4,275 / 4,580 | 4,256 / 4,590 |
| Draft reader prompt tokens p50 (ReaderInput JSON alone) | 1,617 (913) | same | same |
| Reader prefix reuse interleaved with wording (cache_n p50) | 694 | 694 | 694 |
| Full-frame latency p50 (cap 320: **cap-bound**) | 16,134 ms | 15,580 | 15,494 |
| 3-field compact latency p50 (cap 48) | 5,084 ms | 5,066 | 4,996 |
| Server RSS | 5,210 MB | 5,348 MB | 6,206 MB |

**Conclusions (updated in Phase 0.5, following the review):**
1. **The 16 s figure is cap-bound.** Every full-frame call hit the 320-token cap. With the cap raised, a
   minimal frame stopped naturally at 226 tokens. The **natural pretty-printed full frame is about 12.5 s**
   (the reviewer's estimate from about 25 tok/s decode plus about 900 prefill tokens at about 270 tok/s; one
   diagnostic call measured 14.4 s including an uncached 1,465-token prompt).
2. **Most of the latency is a representation / prompt artifact:**
   - pretty-printed JSON (38% of the characters are whitespace);
   - a ~900-token ReaderInput re-evaluated on every call, including the token list.
3. **The preferred next experiment:** a compact custom GBNF grammar (no whitespace), short enum codes and
   omitted nulls, plus a compact ReaderInput (no token list; people and referent candidates in the cached
   prefix).
4. **p50 ≤ 2 s is plausible but unproven. p90 ≤ 3 s is borderline and unproven.**
5. **An absolute whole-turn p90 ≤ 5 s gate is invalid.** The legacy baseline already exceeds it in some J15
   scripts (`2-verbose` p90 5,675 ms; `4-human-trace` p90 5,274 ms, in `docs/acceptance/ed30/j15-scores.jsonl`).
   The pre-registration now uses the reader's p50 ≤ 2.0 s / p90 ≤ 3.0 s, and a whole-turn delta of ≤ 2.5 s over
   the baseline p90.
6. **Flags.** The reader's static prefix survives interleaving under the **production** flags, so more slots or
   a host cache buy nothing, and C costs about 1 GB more RSS.
7. **Logprobs.** They are available but **pre-grammar**: the top alternative at the speech-act position was an
   illegal token. Legal-token renormalization works (margin 0.68). `post_sampling_probs` is empty at T=0.

## 6. Verification

- **Phase-0.5 aggregate suite** `tests/ed31a-reader-phase0.test.js`: **21/21**. It covers:
  - the contract and V0–V3, including the evidence, licensing and non-asking gaps;
  - ReaderInput safety from synthetic **and real service** state;
  - the adapter;
  - the seam and oracle;
  - the resolver spec;
  - **inertness**: throwing / malformed reader, throwing input builder, receipt overflow, developer mode off,
    cold reload, provider variation;
  - the gold evaluator;
  - the **pinned** characterization, round-trip and baseline-failure artifacts, plus the scenario replay.
- **Long-world** `tests/ed31b-reader-characterization-full.test.js`: the full characterization and the full
  round trip against the pinned artifacts.
- **Governance:**
  - `ed31a` hash updated;
  - `ed31b` registered (long-world) in `verification/verification-authority.json` and `test-manifest.json`,
    per `docs/VERIFICATION_GOVERNANCE.md` §6;
  - inventory 57 errors (the pre-existing baseline), none for `ed31a` / `ed31b`;
  - core integrity OK.
- **Full repository** (`node --test tests/*.test.js`): 1,497 tests, 1,418 pass, 79 fail.
  `tools/compare-failing-tests.js` against `baseline-failing-tests.json`: unchanged 79, **new 0**, fixed 0.
  `ed31b` passed within that run.
