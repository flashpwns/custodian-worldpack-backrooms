# Reader Phase 0: artifacts and measured results

**Baseline:** `9e51842`. The design is in `docs/reader/READER_PHASE0.md`; the pre-registration is in
`docs/reader/READER_BAKEOFF_PREREGISTRATION.md`. Every number here comes from the deterministic fixtures
already in the repository: the J15 scripts, the checked-in transcripts and the dev corpora as
context-free probes. **No held-out or blind corpus was opened or created.**

## 1. Characterization: the equivalence authority for Phase 1 (`characterization.json`)

- **Tool:** `node tools/dialogue-characterize.js --out|--check <file> [--quick]`.
- **Fixtures:** 205 sessions and 364 turns, each run under two wording providers (deterministic fallback,
  and malformed "garbage", which also exercises the Tier-2 attempt path).
  - 5 J15 scripts (149 turns);
  - 1 transcript (16 turns);
  - 199 dev-corpus items as single-turn probes (`context_dependent_item` marks items whose authored context
    is not rebuilt).
- **Recorded per turn:**
  - the effective act (speech act, question form, relation and target, predicate, facet source,
    addressee kind / names / quantifier / source, cardinality, temporal, clarify reason);
  - the selected responders, the facet and the relation;
  - the **ledger mutation** (requests opened or changed, with state, targets, answered-by and slots;
    repairs; inbound; learning and anchor counts; activities; acquaintance);
  - the clarification decision;
  - the **planner input shape** (each responder's semantic frame: function, predicate, referents, knowledge
    query, turn fields, and the key set by digest with its legend);
  - the plan shape (function, required and optional fact keys, clarify, `asks_player`, expected slot);
  - Tier-2 state;
  - a digest of the spoken lines. Wording is never stored.
- **Captured at unmodified `9e51842`** (the service change was stashed): digest `d04436b953531e46`.
- **With the Phase-0 seam in place:** `--check` reports **identical** (205 sessions, 364 turns, both
  providers). `tests/ed31a` re-checks the J15 chain session on every run.

## 2. Legacy adapter coverage (`legacy-adapter-coverage.json`)

**Tool:** `node tools/dialogue-reader-coverage.js --out <file>`. It uses the same fixtures, driven through
the production service; every turn's reader-seam receipt comes from the legacy reader v0.

| Measure | Value |
| --- | --- |
| Turns / frames / acts | 364 / 364 / 396 |
| **Expressible exactly** | **337 / 364 = 92.6%** (J15 scripts 87.9%, transcript 87.5%, probes 96.5%) |
| Validator disposition of the legacy frames | accept 315, clarify 40, reject_fields 9 |
| Validator findings on legacy frames | V3 no_antecedent 42, V1 question_form_incompatible 5, V1 temporal_unsupported 4, V3 others_count_mismatch 3 |
| Validator findings vs the legacy decision | V3 no_antecedent 42 = 35 where legacy also declined (clarified / abstained) + 7 where legacy proceeded (the 7 `relation_without_antecedent` legacy artifacts below); V1 question_form 5 and V1 temporal 4, legacy proceeded; V3 others_count 3, legacy also declined |
| `resolveTurn` passthrough identity | true on every turn |

Mismatches by class (turns / notes):

| Class | Turns | Codes (count, examples) |
| --- | --- | --- |
| reader-schema gap | 4 | `legacy_route_without_registry_facet` 2 ("wat do u mean", "why do you wanna know": legacy meta routes with no registry facet); `subject_without_name_span` 2 ("giselle is it tonyas first day": a possessive name form is not a name span; "You didn't answer me.") |
| resolver-policy concern | 5 | `inherited_via_raw_text:antecedent_owner` 2 (reply-fact overlap incl. optional facts); `rewrite:repair>social_acknowledgment` 2 (a vacuous target repair downgraded by ledger policy); `rewrite:attention_call>elliptical_continuation` 1 |
| legacy-only artifact | 11 | `relation_without_antecedent` 7 (legacy "continuation" of a hedge-wrapped fresh question, e.g. "…if you don't mind me asking?", or an ellipsis over the player's own claim); `player_claim_not_typed_by_legacy` 4; `name_span_without_legacy_role` 1 ("I didn't ask you, Giselle") |
| needs-owner-decision | 8 | `collective_subject_routed_as_group_address` 8 ("we all going", "Are we all going?") |

Raw-text dependencies that fired: `itemRole` (25), `antecedent_owner` inheritance (2),
`REPLY_COUNTER_WHY` (1), fragment tables (1). Resolver-derived addressees (reproducible from relation
plus DIS): `repaired_request` 8, `active_speaker` 6, `inbound_asker` 2.

**Coverage-driven schema correction.** The first run (84.9% exact) showed 73 legacy continuations whose
antecedent is the active activity round or a heard line. ReaderFrame `relation.target` now admits `v1`
(the activity) and `aN` (a surface anchor). These are real discourse antecedents already in the DIS, not
legacy policy (see `READER_PHASE0.md` §2).

## 3. Gold-DIS evaluator (`tools/dialogue-gold-eval.js`)

- **Harness self-test** (`tests/fixtures/reader-phase0/gold-harness-selftest.jsonl`: five hand-written
  items that test mechanics; **not** a corpus): 4 scored, 1 `prefix_invalid` (by design); every gold
  frame passes V0–V3.
- **Resolver spec suite:** `not_implemented (Phase 1)`.
- These numbers show the harness works. They are not accuracy evidence.

## 4. Runtime spike (`runtime-spike.json`, `tools/dialogue-reader-spike.js`)

**Setup.**
- Apple M3, 16 GB; llama.cpp b11146; `yellow-beast-local-v1.gguf` (Gemma 4 E4B Q4_K_M).
- Isolated `llama-server` processes on free ports. **Production appliance flags unchanged.**
- 12 turns per configuration, drawn from J15 lines through the real service:
  - production-shaped Tier-2 v2 requests, built by the production functions and provider code (the gate
    fired naturally on **0** of these 60 capture lines);
  - real production wording requests;
  - a **draft** reader prompt: static system text plus facet list, then the ReaderInput as JSON, decoded
    against `readerFrameSchema(input)` at T=0.

| Measure | A: production flags (`--ctx-size 4096 --cache-ram 0`) | B: `--parallel 2 --ctx-size 8192`, reader pinned to slot 1 | C: `--cache-ram 1024` |
| --- | --- | --- | --- |
| Current Tier-2 prompt tokens (p50 / p90) | 866 / 893 | same | same |
| Tier-2 replay latency p50 / p90 | 4,631 / 4,752 ms | 4,275 / 4,580 ms | 4,256 / 4,590 ms |
| Tier-2 prompt tokens actually evaluated (p50) | 28 (prefix cached) | 28 | 28 |
| Tier-2 output tokens (p50) | 99 | 99 | 99 |
| Draft reader prompt tokens (p50 / p90) | 1,617 / 1,684 | same | same |
| of which ReaderInput JSON alone | 913 / 980 | same | same |
| of which static system prefix | 689 | same | same |
| Reader prompt tokens evaluated per call (p50) | 899 (prefix ≈ 700 reused) | 924 | 901 |
| Reader prefix reuse **interleaved with wording** (cache_n p50) | 694 (survives) | 694 | 694 |
| Full-frame latency p50 / p90 (cap 320) | 16,134 / 16,387 ms | 15,580 / 15,890 ms | 15,494 / 15,697 ms |
| 3-field compact latency p50 / p90 (cap 48) | 5,084 / 5,359 ms | 5,066 / 5,266 ms | 4,996 / 5,199 ms |
| Server RSS | 5,210 MB | 5,348 MB | 6,206 MB |

**Output length.** Every full-frame call hit the 320-token cap and every compact call hit the 48-token
cap; only 2 of 12 were valid JSON in each case. A follow-up diagnostic (same runtime, cap raised):
- **A minimal full frame needs about 226 tokens.** It stops naturally and is valid, but the grammar lets
  the model pretty-print, so 38% of the characters are whitespace.
- **The compact 3-field object needs 43 tokens**, valid.

The invalid outputs are an artifact of the spike's caps, not of the model. The cost is real, though:
decode runs at about 25 tokens/s and prefill at about 270 tokens/s on this machine.

**Log-probabilities at T=0 under the JSON-schema grammar.**
- `logprobs` / `top_logprobs` are available. Entries have `id`, `token`, `bytes`, `logprob` and
  `top_logprobs`.
- They are **pre-grammar**: at the `speech_act` value position, the top alternative was the illegal token
  `topic` (log p −0.37), with 5 of the top 8 illegal.
- **Renormalising over the grammar-legal continuations is feasible** and gave a margin of 0.68 (statement
  vs attention…).
- `post_sampling_probs` returns empty alternatives at T=0 (greedy), so it is unusable.
- Asking for logprobs did not change latency meaningfully.

**Conclusions (measurements, not decisions).**
1. **Latency is not viable as drafted.** About 16 s full frame, about 5 s for 3 fields, against a p90
   target of ≤ 2.5 s.
2. **The two drivers are identified:**
   - prefill of the ~900-token ReaderInput on every call (about 3.3 s);
   - the pretty-printed output (about 226 tokens, about 9 s).
3. **Paths to evaluate in Phase 2 (none adopted):**
   - a compact ReaderInput serialization with no token list, and with people / referent candidates moved
     into the cached prefix;
   - omitting null fields;
   - a whitespace-free grammar (a custom GBNF instead of `json_schema`) or short keys;
   - field-wise decoding;
   - a discriminative arm (pre-registration arm D).
4. **The flag variants don't help.** The reader's static prefix survives interleaving with wording under
   the **production flags** (A), so more slots (B) or a host prompt cache (C) change nothing that matters.
   C costs about 1 GB more RSS.
5. **Margin calibration is technically possible** (pre-grammar logprobs plus legal-token
   renormalization). It needs a token → field map, and it is conditional on the earlier greedy fields.

## 5. Verification (this pass)

- `node --check` on every new and changed module.
- `tests/ed31a-reader-phase0.test.js`: 13/13 pass.
- Full repository (`node --test tests/*.test.js`):
  - baseline 1,474 tests, 1,395 pass, 79 fail;
  - after 1,487 tests, 1,408 pass, 79 fail;
  - **the failing set is identical** (0 new, 0 fixed).
- Characterization `--check`: identical.
- Verification governance:
  - `ed31a` is registered, with owner approval, per `docs/VERIFICATION_GOVERNANCE.md` §6 (authority
    `required_tests.aggregate`, manifest entry, `test_hashes`). No other entry changed.
  - Inventory: 57 errors (the pre-existing baseline), none for `ed31a`.
  - `verification-runner --core-check`: integrity OK.
