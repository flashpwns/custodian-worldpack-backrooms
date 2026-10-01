# Dialogue reader: Phase 2 preregistration

**Status:** written 2026-09-30 at Step 0; **amended at Step 0.1** (2026-09-30, owner instruction after the Sonnet 5.5
Step-0 audit) **before** any gold label, teacher, local-model or calibration score exists, so no measurement is
invalidated. Step 0.1 changes are marked "(0.1)".

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
| ReaderInput | `yellow-beast-reader-input@v3` (B7 salience incl. the indirect request-arg filter; hidden option labels; observer lexicon) (0.1) |
| ReaderFrame | `yellow-beast-reader-frame@v2` (+ `conclude`, `withdraw:v1`, `referent.nominated`) |
| Resolver | `yellow-beast-resolve-turn@v3` |
| Lexicon | `yellow-beast-reader-lexicon@v2` (fuzzy guard) (0.1) |
| Render | `yellow-beast-reader-render@v2`; system digest `8c727a29…` pinned in `ed33a`; one semantic contract shared by the wire, the JSON control and the label guide (0.1) |
| Wire | `yellow-beast-reader-wire@v1`; table digest `b18ac02f…` pinned in `ed33a` |

A change to any of them is a new contract version. Scores from different contract versions are never pooled.

## 2. Arms

| Arm | What | Runs now |
| --- | --- | --- |
| **A. L0** | legacy reader v0 frames, through the same decode → V0–V3 → `resolveTurn` pipeline | yes |
| **D. Teacher** | a strong hosted reasoning-class model of a **non-Claude family recorded in the labelling registry before labelling** (recommendation; chosen by the owner, not in code), **development only**, with the provider's deterministic or closest-supported decoding: temperature only where the model accepts it, an explicit output budget and reasoning effort / budget, all recorded per request (0.1). It receives **only** `renderReaderPrompt(input)` (system + user) and returns the same closed wire contract. No transcript, world state, private state, repository or canon. Never in production. | after Step 0 |
| **C. E4B** | the pinned local runtime (llama.cpp b11146) and model (Gemma 4 E4B Q4_K_M, `yellow-beast-local-v1.gguf`, SHA-256 `85a896a0…ab87`). Compact render, compact wire, per-input GBNF grammar, temperature 0, raw top-10 logprobs | **only after the teacher clears §3** |
| skipped | verbose-JSON E4B; a discriminative classifier; LoRA / distillation | explored only if the teacher clears the task **and** C misses the non-inferiority requirement |

Every teacher and E4B artifact records:

- provider, model and version; model hash and quantization (local);
- the render, wire and schema digests;
- what was transmitted (the hosted transport records byte counts, the system / user SHA-256 and the decoding
  parameters).

## 3. Teacher ceiling experiment (runs BEFORE any E4B prompt work)

- **Data (0.1):** the frozen development teacher sample `docs/acceptance/reader-phase2/teacher-dev-sample.json`
  (pinned in `ed33b`), fixed before any teacher is chosen or run:
  - unit: a **distinct frozen render**; selection: a **census** of every headline-eligible distinct render (inclusion
    probability 1 in every stratum), 474 renders: j15 132, rare state 108, scripted state 102, ED-30 dev 99, human
    trace 19, ED-30 novel 14;
  - excluded (diagnostic only): the 78 renders of context-dependent ED-30 probes replayed without their context;
  - gold: **ADJUDICATED_GOLD only** (label guide §5); at least **300** valid adjudicated renders or the run does not
    start; a render the adjudicator declares unlabelable is excluded with its written reason (recorded as an
    `ADJUDICATED_GOLD` row with `gold_outcome: "UNLABELABLE"` and `unlabelable_reason`; never gold) (0.1B);
  - estimator: the **unweighted** proportion over headline renders (each render once; no stratum is up-weighted, so a
    stratum weighs its share of distinct renders; the Step-0 weights are withdrawn from the headline);
  - interval: Wilson 95% reported; the **cluster bootstrap** 95% (2,000 reps, seed 7, resampling fixtures) is the one
    interpreted; unweighted per-stratum proportions with Wilson intervals are always reported, strata < 60 renders
    never interpreted alone;
  - transport: failures retried under the preregistered policy (3 retries at 2 / 4 / 8 s, transient failures only);
    more than 2% voids after retries -- `transport_unavailable`, provider voids (truncation / max tokens, refusal /
    content filter; never retried) and missing readings -- voids the run (not scored; repeated in full) (0.1B);
  - hosted runs need an explicit output-token budget and durable per-request receipts established before the first
    request (0.1B);
  - one run over the whole sample, no interim looks.
- **Headline binding (0.1B, enforced in code by `dialogue-reader-replay.js headlineVerdict`):** a score artifact is
  `headline: true` only when the sample file is byte-identical to the pinned frozen file (SHA-256 `26f0ba7b…`, also
  pinned in `ed33b`), carries the current contract identity, holds the 474-render census and regenerates exactly from
  the scored capture; the run scored exactly that population (no `--limit`, stratum filter, human-trace exclusion,
  diagnostic label states or JSON control); every render has valid `ADJUDICATED_GOLD` or a recorded `UNLABELABLE`,
  with at least 300 valid; and voids are ≤ 2%. Otherwise the artifact records `headline: false` with the reasons.
- **Stop rule:**
  - if the resolved-outcome accuracy (point estimate over the headline sample, §3 estimator) is **< 80%** or primary
    speech-act accuracy is **< 85%**: STOP;
  - do not tune E4B;
  - diagnose the taxonomy, the input or the labels. Misses clustered in low-agreement fields mean fixing the label
    definitions first. A systematic miss on a high-agreement class calls for a diagnostic-only ReaderInput / context
    ablation.
- **Pass (G2):** proceed to E4B.

## 4. Teacher wire-vs-JSON check

- About 100 development items go through the **same** teacher twice. The exact 100 renders are pinned in `docs/acceptance/reader-phase2/json-control-selection.json` (deterministic stratified draw from the 474 census, owner-accepted 2026-10-01; READER_PHASE2.md §14):
  - (A) the compact wire;
  - (B) minimal JSON (`renderReaderPrompt(input, { output: "json" })`, `decodeJsonFrame`).
- Both use the same semantic contract and the byte-identical user render (0.1): both system texts are generated from
  one template (`semanticLines`), so speech-act glosses, address and relation semantics, facet glosses and every
  field's meaning are word-for-word identical; only value spellings and the output lines differ. Fences are invalid
  output for both (`output_fenced`), never stripped.
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
| **G1 codec** | 100% semantic encode / decode round trip; model-facing dynamic tokens (pinned tokenizer) **discourse-bearing p90 ≤ 300 and human-trace p90 ≤ 300**, p99 and max reported as guardrails; context-free probes reported separately and never used to dilute the gate; context is never cut to pass (0.1) |
| **G2 teacher** (development) | speech act ≥ 93%, address op ≥ 92%, relation ≥ 90%, facet ≥ 88%, subject ≥ 90%, referent ≥ 92%, inbound answer ≥ 92% (where applicable and n ≥ 60); resolved-outcome ≥ 90%; κ ≥ 0.80 where prevalence makes κ interpretable |
| **G3 local** (development) | for each routing field with n_applicable ≥ 100: one-sided 95% upper bound of (teacher − E4B) ≤ 6 points (paired); at matched coverage, E4B false-confident beats L0 on fresh calibration data |
| **G4 calibration** | false-confident ≤ 3% at ≥ 88% accepted coverage |
| **G5 latency** | reader p50 ≤ 2.0 s and p90 ≤ 3.0 s over ≥ 200 representative turns **under wording contention**; the bootstrap upper bound of p90 meets the SLO; live model shadow: production p90 delta ≤ 0.15 s |
| **G6 inertness** | 100% canonical deep equality, including async fault injection |
| **G7 invariants** | expanded gold resolver spec 100%; characterization unchanged; the full repository suite adds no failures |

**Per-field gates vs diagnostic fields (0.1 reconciliation).** Per-field thresholds are **development** gates (G2 on the
teacher run, G3 on the development E4B run) and apply only to the routing fields with n_applicable ≥ 60 (G2) / ≥ 100
(G3). On the **sealed** set every per-field number is diagnostic (§6). The label guide's diagnostic-only fields
(question form, temporal, polarity, name roles, requested action, self-introduction, echo) are never gated anywhere.

**False-confident** means a turn ACCEPTED (not INVALID, not CLARIFY) whose resolved-outcome signature differs from
gold, or that is ACCEPTED where gold is EXPECTED_CLARIFY (0.1). INVALID output is never outcome-equal; transport
failures are reported separately, never as semantic errors (0.1).

**Coverage** is the fraction of turns ACCEPTED.

## 6. Statistical policy (family error), with power

The power table is `node tools/dialogue-reader-power.js` (committed output: `docs/acceptance/reader-phase2/power.json`).
All tests are one-sided, α = 0.05.

**(0.1) Withdrawn:** the Step-0 conclusion "sealed n = 1,000 is enough". It rested on a normal approximation at a
true false-confident rate of 1.5%. The exact bound check (Sonnet 5.5 audit; reproduced by `power.json`):

| True FC | Exact power, 1,000 turns (~880 accepted) | Exact power, 1,800 turns (~1,584 accepted) |
| --- | --- | --- |
| 1.0% | 99.6% | 100% |
| 1.5% | 88.1% | 99.3% |
| 2.0% | **50.6%** | **80.9%** |
| 2.5% | 16.6% | 31.6% |

(Rejection when the exact Clopper-Pearson one-sided 95% upper bound ≤ 3%, i.e. P(X ≤ k | n, 0.03) ≤ 0.05; the audit's
figures 99.7 / 89 / 53 / 18 agree within rounding of the method.)

### 6.1 The formal sealed gate FAMILY (fixed now)

A conjunctive family: every gate must pass, so it is an intersection–union test with a false-pass probability ≤ α
without a multiplicity correction.

1. **false-confident** (resolved outcome, whole turn, EXPECTED_CLARIFY counted as in §5): the **exact**
   (Clopper-Pearson) one-sided 95% upper bound ≤ 3% at the frozen calibration threshold, computed on the
   **cluster-adjusted effective sample**: n_eff = n / d̂, k_eff = k / d̂ with the Kish design effect
   d̂ = 1 + (m̄ − 1) ρ̂, clusters = **author / prefix** (the author of a sealed item and its shared scripted prefix),
   m̄ the mean cluster size and ρ̂ the one-way ANOVA intraclass correlation of the FC indicator, floored at 0;
2. **coverage:** the exact one-sided 95% lower bound ≥ 88% on the same cluster-adjusted basis;
3. **resolved-outcome non-inferiority** to the teacher, paired, margin 6 points (the development teacher number is the
   reference), cluster bootstrap by author / prefix;
4. **latency:** bootstrap upper bound of reader p90 ≤ 3.0 s under contention.

**Rare-state strata** are explicit sealed strata with their own quota (the data protocol); each is reported with its
exact interval and never gated unless its applicable count reaches 60. **Per-field** numbers are diagnostic on the
sealed set (Wilson intervals, κ / PABAK).

### 6.2 The sealed sample-size RULE (fixed now; N chosen before the sealed set is generated or opened)

- Planning inputs, recorded with the chosen N **before** the sealed set is written: planning true FC **2.0%**
  (not 1.5%), accepted coverage 88%, α = 0.05, **target exact power ≥ 80%** for gate 1, and a planning design effect
  from the authoring plan (planned items per author / prefix m, planning ICC ρ = 0.02 unless development data justify
  another value in writing).
- N = the smallest total for which the exact power of gate 1 at n_eff = N × 0.88 / d reaches 80%
  (`dialogue-reader-power.js sealedSizeFC`): **1,800** at d = 1; 1,910 at m = 10, ρ = 0.01; 2,070 at m = 10, ρ = 0.02;
  2,420 at m = 20, ρ = 0.02.
- The rare-state quota comes **on top** of N.
- N is not changed after the sealed set is generated; if the realised design effect exceeds the planning one, the
  gate still uses the realised d̂ (never the planning value).
- No sealed set is created in Phase 2 Step 0.1.

### 6.3 Normal-approximation planning table (Step 0; context only)

| Gate (scenario) | n needed |
| --- | --- |
| G4 false-confident ≤ 3%, true FC 1.5%, 90% power | 847 accepted ≈ 963 turns at 88% coverage |
| G4 false-confident ≤ 3%, true FC 1.0%, 90% power | 417 accepted ≈ 474 turns |
| G4 false-confident, Bonferroni over 10 gates (α 0.005), true FC 1.5% | 1,575 accepted ≈ 1,790 turns |
| G4 coverage ≥ 88%, true coverage 92%, 90% power | 487 |
| resolved-outcome non-inferiority (teacher − E4B < 6 points), true diff 2 points, discordance 12% | 641 |
| G3 per-field non-inferiority, no correction, 80% power | 308 applicable per field |
| G3 per-field, Bonferroni over 7 routing fields, 80% power | 540 applicable per field; a rare field at 8–10% prevalence needs ≈ 5,000–7,000 turns |

A large family of simultaneous per-field Bonferroni gates (option A) stays rejected: rare routing fields would need
thousands of turns to be gated at all.

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

1. token distribution only, no model: **done**; `token-distribution.json`. Step 0 (render v1): all-turn p90 245 (the
   Step-0 text's "247" was stale). Step 0.1 (render v2): discourse-bearing p90 263, human-trace p90 292 (G1 by class);
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
- the teacher is not a labeler for itself;
- (0.1) no gold label, teacher run, E4B accuracy run, calibration or sealed item was created at Step 0.1.
