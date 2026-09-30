# Dialogue reader: Phase 2 preregistration

**Status:** written 2026-09-30 at Step 0, **before** any teacher, local-model or calibration score counts.

**Scope and supersession.**

- This document supersedes the Phase-0.5 draft (`READER_BAKEOFF_PREREGISTRATION.md`) for everything Phase 2
  measures. That draft stays as provenance.
- Thresholds here are the owner's Phase-2 instruction (2026-09-30), applied through the Sonnet 5.5 Phase-2
  architecture review.
- After this file is committed, changing a gate, an arm or a metric is an owner decision, recorded with its reason. It
  applies only to sets not yet opened. A gate is **never** redefined to let a model pass.

**Authority.**

- Subordinate to `SIMULATION_DOCTRINE.md` (7.5, 7.26, 7.27, 14.35, 14.36, 17.26, 17.32), the Gameplay Constitution,
  the label guide (`READER_PHASE2_LABEL_GUIDE.md`), the data protocol (`READER_PHASE2_DATA_PROTOCOL.md`) and the
  held-out protocol.
- It authorizes **no** production cutover.
- Live-model measurements are supporting and non-authoritative. None is a CI requirement.

## 1. Frozen contract (Step 0)

Every score artifact carries these identities (`dialogue-reader-replay.js contractIdentity`), plus the model
identity:

| Item | Identity |
| --- | --- |
| ReaderInput | `yellow-beast-reader-input@v2` (B7 salience; observer lexicon) |
| ReaderFrame | `yellow-beast-reader-frame@v2` (+ `conclude`, `withdraw:v1`, `referent.nominated`) |
| Resolver | `yellow-beast-resolve-turn@v3` |
| Lexicon | `yellow-beast-reader-lexicon@v1` |
| Render | `yellow-beast-reader-render@v1`; system digest pinned in `ed33a` |
| Wire | `yellow-beast-reader-wire@v1`; table digest pinned in `ed33a` |

A change to any of them is a new contract version. Scores from different contract versions are never pooled.

## 2. Arms

| Arm | What | Runs now |
| --- | --- | --- |
| **A. L0** | legacy reader v0 frames, through the same decode → V0–V3 → `resolveTurn` pipeline | yes |
| **D. Teacher** | a strong hosted model, **development only**, temperature 0 (or the provider's closest deterministic setting). It receives **only** `renderReaderPrompt(input)` (system + user) and returns the same closed wire contract. No transcript, world state, private state, repository or canon. Never in production. | after Step 0 |
| **C. E4B** | the pinned local runtime (llama.cpp b11146) and model (Gemma 4 E4B Q4_K_M, `yellow-beast-local-v1.gguf`, SHA-256 `85a896a0…ab87`). Compact render, compact wire, per-input GBNF grammar, temperature 0, raw top-10 logprobs | **only after the teacher clears §3** |
| skipped | verbose-JSON E4B; a discriminative classifier; LoRA / distillation | explored only if the teacher clears the task **and** C misses the non-inferiority requirement |

Every teacher and E4B artifact records:

- provider, model and version; model hash and quantization (local);
- the render, wire and schema digests;
- what was transmitted (the hosted transport records byte counts, the system / user SHA-256 and the decoding
  parameters).

## 3. Teacher ceiling experiment (runs BEFORE any E4B prompt work)

- **Data:** n ≥ 300 development turns (distinct renders). Score against adjudicated gold where available,
  otherwise against provisional gold. Report which.
- **Stop rule:**
  - if the resolved-outcome accuracy is **< 80%** or speech-act accuracy is **< 85%**: STOP;
  - do not tune E4B;
  - diagnose the taxonomy, the input or the labels. Misses clustered in low-agreement fields mean fixing the label
    definitions first. A systematic miss on a high-agreement class calls for a diagnostic-only ReaderInput / context
    ablation.
- **Pass (G2):** proceed to E4B.

## 4. Teacher wire-vs-JSON check

- About 100 development items go through the **same** teacher twice:
  - (A) the compact wire;
  - (B) minimal JSON (`renderReaderPrompt(input, { output: "json" })`, `decodeJsonFrame`).
- Both use the same semantic contract and the same user render.
- If the resolved-outcome gap is **≤ 2 points**, keep the wire. If it is larger, diagnose the codec or the prompt's
  readability before continuing.
- The verbose pretty-JSON runtime is not revived by default.

## 5. Gates

Accuracies are scored on each field's applicable items (label guide §4). The primary metric is
**`resolveTurn(arm frame)` vs `resolveTurn(gold frame)`** on the resolved-outcome signature
(`dialogue-reader-replay.js outcomeSignature`). The signature compares:

- outcome;
- primary speech act;
- facet / claim;
- relation and canonical target;
- addressees, responders, recipients;
- cardinality and silence;
- clarification slot;
- temporal scope;
- bound arguments;
- quoted speaker;
- request / activity / inbound lifecycle intent.

Production legacy behaviour is **not** gold. It is a secondary diagnostic only.

| Gate | Requirement |
| --- | --- |
| **G1 codec** | 100% semantic encode / decode round trip; model-facing dynamic tokens p90 ≤ 300 (pinned tokenizer) |
| **G2 teacher** | speech act ≥ 93%, address op ≥ 92%, relation ≥ 90%, facet ≥ 88%, subject ≥ 90%, referent ≥ 92%, inbound answer ≥ 92% (where applicable and n ≥ 60); resolved-outcome ≥ 90%; κ ≥ 0.80 where prevalence makes κ interpretable |
| **G3 local** | for each routing field with n_applicable ≥ 100: one-sided 95% upper bound of (teacher − E4B) ≤ 6 points (paired); at matched coverage, E4B false-confident beats L0 on fresh calibration data |
| **G4 calibration** | false-confident ≤ 3% at ≥ 88% accepted coverage |
| **G5 latency** | reader p50 ≤ 2.0 s and p90 ≤ 3.0 s over ≥ 200 representative turns **under wording contention**; the bootstrap upper bound of p90 meets the SLO; live model shadow: production p90 delta ≤ 0.15 s |
| **G6 inertness** | 100% canonical deep equality, including async fault injection |
| **G7 invariants** | expanded gold resolver spec 100%; characterization unchanged; the full repository suite adds no failures |

**False-confident** means a turn ACCEPTED (not INVALID, not CLARIFY) whose resolved-outcome signature differs from
gold.

**Coverage** is the fraction of turns ACCEPTED.

## 6. Statistical policy (family error), with power

The power table is `node tools/dialogue-reader-power.js` (committed output: `docs/acceptance/reader-phase2/power.json`).
All tests are one-sided, normal approximation, α = 0.05.

| Gate (scenario) | n needed |
| --- | --- |
| G4 false-confident ≤ 3%, true FC 1.5%, 90% power | 847 accepted ≈ **963 turns** at 88% coverage |
| G4 false-confident ≤ 3%, true FC 1.0%, 90% power | 417 accepted ≈ 474 turns |
| G4 false-confident, **Bonferroni over 10 gates** (α 0.005), true FC 1.5% | 1,575 accepted ≈ **1,790 turns** |
| G4 coverage ≥ 88%, true coverage 92%, 90% power | 487 |
| resolved-outcome non-inferiority (teacher − E4B < 6 points), true diff 2 points, discordance 12% | 641 |
| G3 per-field non-inferiority, no correction, 80% power | 308 **applicable** per field |
| G3 per-field, Bonferroni over 7 routing fields, 80% power | 540 **applicable** per field; a rare field at 8–10% prevalence needs ≈ 5,000–7,000 turns |

**Why not option A.** A large family of simultaneous per-field gates under Bonferroni makes the sealed set
underpowered by construction. The rare routing fields would need thousands of turns to be gated at all.

**Recommendation: option B.** The formal sealed gate family is a small **conjunctive** set. Every gate must pass, so
it is an intersection–union test: the probability of a false pass is ≤ α **without** a multiplicity correction.
Per-gate power is set high so the joint power stays useful.

1. **false-confident** (resolved outcome, whole turn): upper 95% bound ≤ 3% at the frozen calibration threshold;
2. **coverage**: lower 95% bound ≥ 88% at that threshold;
3. **resolved-outcome non-inferiority** to the teacher, paired, margin 6 points (dev-measured teacher; the sealed set
   measures E4B, with the teacher's development number as the reference);
4. **latency**: bootstrap upper bound of reader p90 ≤ 3.0 s under contention.

Individual routing fields are **diagnostic**. They are reported with Wilson intervals and κ / PABAK, never gated on the
sealed set. A rare field may be reported only when it has ≥ 60 applicable items.

**Sealed size:** **n = 1,000 turns**. This is driven by the false-confident gate at a realistic true FC ≈ 1.5%, not by
multiplicity. The rare-state quota comes on top, so that reported fields reach 60 applicable items. If the owner
prefers option A, the sealed n must be ≥ 1,800, and the rare fields still cannot be gated.

## 7. Accept / clarify rule (Stage 1: no probability thresholds)

- **INVALID:** V0 fails (wire decode or schema).
- **CLARIFY:** V1 / V2 / V3 requires clarification, **or** the model explicitly abstains on a routing-critical
  field (`ab=`), or `r=unsure`.
- **Candidate ACCEPT:** otherwise.

Every clarification is classified and recorded (B8, no renderer work):

- `LINGUISTIC_AMBIGUITY`: the discourse state itself is underdetermined, for example deixis without an antecedent,
  several active speakers, an unresolved ellipsis, or a set address that resolves to nobody;
- `READER_UNCERTAINTY`: the reader abstained, chose an illegal or unsupported value, or claimed something the
  surface does not show.

Stage 1 measures reader agreement and abstention with no probability threshold.

**Later calibration** fits per-field margin thresholds on the FROZEN calibration set only, targeting the G4 operating
point. Self-reported confidence is never used.

## 8. Logprobs (captured now, calibrated later)

- **Captured:** llama.cpp `top_logprobs` (10 per token) are kept raw in every E4B receipt.
- **Pre-grammar nature:** at temperature 0 under a grammar, llama.cpp reports the alternatives **before** the grammar
  mask. Grammar-illegal tokens appear in the list; the smoke check saw `SPE` above `greet`. `post_sampling_probs` is
  empty at T = 0 (Phase-0 spike).
- **Offline derivation** (`dialogue-reader-async.js wireFieldMargins`): at the **first token** of each positional core
  field (speech act, facet, address, relation), code splits the alternatives into grammar-legal (a prefix of a legal
  code) and illegal, renormalizes the legal mass, and records the top-two margin, the legal mass and the illegal count.
- **Conditional later fields:** tokens after a field's first token, and tagged extras, are conditional on earlier
  choices. They are not scored as independent margins.
- **Shared prefixes:** the wire codes were chosen so every routing enum's first token is unique under the pinned
  tokenizer. The shared-prefix list is empty for the speech act (14 codes), relation (8), address (4) and facet (47)
  (`token-distribution.json early_branch`). Name and label alternatives (`@n1` vs `@n2`) share the `@` / letter
  prefix: they are conditional, not first-token decisions.
- **No runtime probability policy** exists or may be added before calibration.

## 9. Latency ladder

1. token distribution only, no model: **done**; `token-distribution.json`, p90 247 dynamic tokens;
2. ≥ 200 offline replay turns, idle: after E4B is allowed (post-teacher);
3. ≥ 200 turns under wording contention;
4. a dedicated slot / parallel configuration (spike config B: `--parallel 2`), recorded as a measurement-only flag set;
5. only if needed: speculative state prefill while typing.

Production server flags are **not** changed to make a benchmark pass. Any runtime flag change requires separate
review.

## 10. Live developer shadow (last; only if the offline experiments are healthy)

The seam exists and is fault-tested (`DesktopService` option `modelShadow`, `ed33a`). Its properties:

- developer mode AND an explicit reader are required;
- it runs after the canonical commit and the wording;
- it is async, with one in flight; a busy shadow drops the turn;
- 5 s hard timeout;
- results go to a separate in-memory `modelShadowReceipts` store only.

It is never consumed, persisted, in the dialogue history, in the wording packet or in the trace view.

It has **not** been run against a live model in this pass.

## 11. Not done in Phase 2

- no production reader cutover;
- no canonical mutation from any model reader;
- no planner rewrite and no UI change;
- no legacy parser tuning;
- no sealed set;
- no use of spent ED-30 held-outs;
- the teacher never runs in production;
- the teacher is not a labeler for itself.
