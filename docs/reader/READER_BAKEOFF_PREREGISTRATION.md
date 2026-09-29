# Reader bake-off and acceptance: pre-registration

**Status:** Phase 0. This plan is written **before** any new reader exists. Nothing here has been run on
any set it defines. The owner ratifies it (or amends it) before Phase 2 opens. After ratification,
changing a threshold, an arm or a metric is an owner decision, recorded with its reason, and it applies
only to a set not yet opened.

**Authority.** This plan is subordinate to `SIMULATION_DOCTRINE.md` (7.5, 7.26, 7.27, 14.35, 14.36,
17.26, 17.32), the Gameplay Constitution, and the held-out protocol (spent sets are never reopened; a
blind set is hashed before any change it measures and is measured once). It authorizes no
implementation.

## 1. Arms

| Arm | What it is | Where it may run |
| --- | --- | --- |
| **L0: legacy reader v0** | `frameFromLegacy` over the current Tier-1 (+ accepted Tier-2) pipeline, via the reader seam | everywhere (the reference) |
| **E4B: pinned local reader** | the pinned runtime (llama.cpp b11146) and model (Gemma 4 E4B Q4_K_M, `yellow-beast-local-v1.gguf`), reading **only** the ReaderInput, grammar-constrained to the ReaderFrame v1 schema, at T=0 | dev, calibration and sealed sets; the only model arm that may ever ship |
| **T: strong-model teacher** | a strong hosted model, same ReaderInput and schema | **development time only**: dev set and ceiling estimate. Never calibration, never sealed, never shipped, never in the game's request path |
| **D: small trained / discriminative** (optional, later) | a closed-field classifier or LoRA distilled from teacher and gold labels | dev and calibration; a sealed-set arm only if the owner approves a new shipped artifact (licence, pin, size) |

Every arm reads the same ReaderInput through the same seam and produces a ReaderFrame v1 validated by
the same V0–V3. No arm sees canonical ids, optional (unspoken) facts, personhood state or knowledge
records.

## 2. Metrics (each reported separately, never blended into one headline)

**Reader, per field**, against gold frames: speech act; language-level address op (and its name spans);
facet; relation (kind and target); subject; referent; inbound-answer interpretation (kind and option);
abstention.
- An abstention on a field is scored as **abstained**, not as wrong. It feeds unnecessary clarification
  and coverage.
- Question form and temporal expression are reported but are **not** routing gates.

**Resolver**, from gold frames. `resolveTurn(gold frame, gold DIS)` compared with gold behaviour. This is
a **spec suite**: the target is **100%**, and every miss is a resolver defect fixed before any reader
measurement is interpreted.

**Behaviour**, end to end through the shipped service:
- the responder set;
- task success (the right facet asked of the right people, or an appropriate clarification);
- **false confident interpretation**: acted on, and wrong on any routing field;
- **unnecessary clarification**: clarified although gold says the line was clear;
- silence where gold expects a response (a missed question).

**Latency** on the target machine (Apple M3, 16 GB): the reader alone, p50 and p90, and the whole turn,
p50 and p90. Measured with the production server flags unless the owner has ratified a flag change.

**Cost-weighted outcome.** The cost order is: wrong answer > silent miss of a real question > unneeded
clarification. The default weights are 5 / 3 / 1, pending owner decision. Weights are fixed before any set
is opened.

## 3. Gates and stop-loss (fixed before measurement)

A gate passes only on the **upper 95% confidence bound** (Wilson), never the point estimate.

| Gate (sealed set, E4B arm) | Threshold |
| --- | --- |
| Resolver spec suite on gold frames | 100% (no exceptions) |
| False confident interpretation (whole turn, routing fields) | upper bound ≤ 3% |
| Speech act / address op / facet / relation: accuracy on turns the reader did not abstain on | each ≥ 95% lower bound, or the field falls back to legacy under agreement gating |
| Unnecessary clarification | upper bound ≤ 12% (≤ 8% is the product target) |
| Reader latency p90 on target hardware | ≤ 2.5 s |
| Whole-turn latency p90 | ≤ 5 s |

**Stop-loss** (decided on the dev and calibration sets; the sealed set is never used to decide it):
1. **Teacher ceiling first.** If arm T cannot reach ≥ 90% on speech act, address op and relation, and
   ≥ 85% on facet, on the dev set, the taxonomy or the labels are the problem, not the model. Stop and
   revise ReaderFrame or the labeling guide. Do not tune a reader against a ceiling the labels cannot
   support.
2. **E4B viability.** If arm E4B trails arm L0 on false confident interpretation, or cannot reach
   reader p90 ≤ 3 s with any owner-acceptable server configuration, do not proceed to cutover. Either
   the owner decides to pursue arm D, or the legacy reader stays primary with V0–V3 plus agreement
   gating.
3. **Calibration.** If no per-field margin threshold on the calibration set yields ≤ 3% false confident
   interpretation at ≥ 70% coverage, the arm fails regardless of accuracy.

## 4. Gold-DIS construction

- An item is a **scripted prefix plus a target line**. The prefix is played through the real service
  (`tools/dialogue-gold-eval.js`), so the DIS is exactly what the product builds:
  - ledger requests, answered-by, activities, inbound coworker questions, surface anchors;
  - **checkpoints** assert that canonical state after the prefix.
- A prefix that does not produce its checkpoints makes the item `prefix_invalid`. It is never scored, and
  the author repairs it. Discourse context is never rebuilt by re-parsing prose.
- Prefix wording uses the deterministic fallback. Items that depend on heard wording (echo, "what do you
  mean") state the heard line in the item so every arm sees the same words.
- Gold frames use symbolic references (`@Name`, `req:<facet>`, `ref:<name>`, `inbound`), which the
  evaluator resolves to the target turn's own labels. Every gold frame must pass V0–V3 against its own
  input, or the item is rejected at authoring time.

## 5. Labeling protocol

- Labelers see **exactly what the reader sees**: the rendered ReaderInput (`--show-input`), including
  the heard channel. They do not see prose context, the transcript, canonical ids or any arm's output.
- They label a ReaderFrame (language-level address op, not responder ids) and, separately, the expected
  behaviour.
- **Multiple independent labelers:**
  - two LLM labelers from different model families;
  - plus one human labeler on at least 25% of every set, and on 100% of the sealed set's routing fields;
  - no labeler sees another's labels before adjudication.
- **Agreement:** Cohen's κ per field is reported. A field with κ < 0.7 is not used as a gate; it is
  redefined or dropped, with an owner decision. Disagreements are adjudicated by the human labeler, who
  records the reason.
- **Label-noise ceiling:** the adjudicated agreement rate per field is reported with every result. No arm
  is expected to exceed it.

## 6. Sets

| Set | Purpose | Use |
| --- | --- | --- |
| **Dev** | taxonomy, prompt and schema development; teacher ceiling | open, reusable |
| **Calibration** | per-field margin thresholds; agreement-gate thresholds | frozen once built; used only to set thresholds; never for prompt or schema changes |
| **Sealed acceptance** | the go/no-go measurement for one reader architecture version | hash-committed before measurement; opened **once**; spent afterwards (the same discipline as the ED-30 corpora) |

- **Sources:**
  - real owner playtest transcripts (local exports, no telemetry);
  - multiple authors and personas;
  - minimal pairs.
- The six spent ED-30 corpora are **diagnostic only**. Using them as training data or calibration data is
  an owner decision, because that permanently disqualifies them from any evaluative role, and they carry
  no DIS.
- **Sizes:**
  - sealed ≥ 400 target turns (so a 3% false-confident bound is attainable with a handful of errors; a 1%
    bound needs ≥ 300 with zero errors);
  - calibration ≥ 300;
  - dev unbounded.

## 7. Calibration protocol

- **Per-field margin.** For each routing field (speech act, address op, facet, relation), the margin is
  computed by code from token log-probabilities, renormalized over the grammar-legal continuations at the
  field's first discriminating token (feasibility: see the runtime spike).
- **Thresholds** are fit on the calibration set only, by minimising false confident interpretation
  subject to coverage.
- **Pinning.** Thresholds are pinned to the reader's identity: model hash, quantization, runtime build,
  schema hash and prompt hash. Any change to one of these invalidates them.
- **Agreement gating** (during migration): proceed when the reader agrees with L0 on the routing fields
  or its margin clears the threshold. Otherwise clarify, at interface level if the owner's B8 decision
  allows.

## 8. Risk–coverage evaluation

- For each routing field and for the whole turn, report the risk–coverage curve: error rate among
  accepted turns against the fraction of turns accepted, sweeping the margin threshold.
- Report the operating point chosen on the calibration set, and its realised risk and coverage on the
  sealed set.
- Report the same curves for L0, with Tier-1 completeness as its only "confidence", so the comparison
  is like for like.

## 9. What is explicitly not done

- No sealed set is created, hashed or opened in Phase 0.
- No new blind corpus.
- No tuning of the legacy parser.
- No threshold is fit on any spent corpus.
- The strong-model teacher never runs in the game's request path.
