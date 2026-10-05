# Reader bake-off and acceptance: pre-registration

**Status:** Phase 0.5 revision (2026-09-29), replacing the Phase-0 draft. It incorporates the architecture
review's thresholds; §10 lists every change. Written **before** any new reader exists. Nothing here has been
run on any set it defines. The owner ratifies it (or amends it) before Phase 2 opens. After ratification,
changing a threshold, an arm or a metric is an owner decision, recorded with its reason, and it applies only
to a set not yet opened.

**Authority.** This plan is subordinate to `SIMULATION_DOCTRINE.md` (7.5, 7.26, 7.27, 14.35, 14.36, 17.26,
17.32), the Gameplay Constitution, and the held-out protocol (spent sets are never reopened; a blind set is
hashed before any change it measures and is measured once). It authorizes no implementation.

## 1. Arms

| Arm | What it is | Where it may run |
| --- | --- | --- |
| **L0: legacy reader v0** | `frameFromLegacy` over the current Tier-1 (+ accepted Tier-2) pipeline, via the reader seam | everywhere (the reference) |
| **E4B: pinned local reader** | the pinned runtime (llama.cpp b11146) and model (Gemma 4 E4B Q4_K_M, `yellow-beast-local-v1.gguf`), reading **only** the ReaderInput, grammar-constrained to ReaderFrame v1, at T=0 | dev, calibration and sealed sets; the only model arm that may ever ship |
| **T: strong-model teacher** | a strong hosted model, same ReaderInput and schema | **development time only**: dev set and ceiling estimate. Never calibration, never sealed, never shipped, never in the game's request path |
| **D: small trained / discriminative** (optional, later) | a closed-field classifier or LoRA distilled from teacher and gold labels | dev and calibration; a sealed-set arm only if the owner approves a new shipped artifact (licence, pin, size) |

Every arm reads the same ReaderInput through the same seam and produces a ReaderFrame v1 validated by the same
V0–V3. No arm sees canonical ids, optional (unspoken) facts, personhood state or knowledge records.

## 2. Metrics (each reported separately, never blended into one headline)

- **Reader, per field**, against gold frames:
  - speech act;
  - language-level address op (and its name spans);
  - facet;
  - relation (kind **and** target);
  - subject;
  - referent;
  - inbound-answer interpretation (kind and option);
  - abstention.

  An abstention on a field is scored as **abstained**, not as wrong. It feeds unnecessary clarification and
  coverage. Question form and temporal expression are reported but are **not** routing gates.
- **Resolver, from gold frames:** `resolveTurn(gold frame, gold DIS)` against gold resolution. This is a
  **spec suite**: the target is **100%**, and every miss is a resolver defect fixed before any reader
  measurement is interpreted. The Phase-0.5 harness self-test runs this leg at 7/7.
- **Behaviour, end to end through the shipped service:**
  - the responder set;
  - task success (the right facet asked of the right people, or an appropriate clarification);
  - **false confident interpretation**: acted on, and wrong on any routing field;
  - **unnecessary clarification**: clarified although gold says the line was clear;
  - silence where gold expects a response;
  - request lifecycle and inbound routing.
- **Latency on the target machine** (Apple M3, 16 GB): the reader alone, p50 and p90, and the whole-turn
  **delta** over the legacy baseline's p90.
- **Cost-weighted outcome:** wrong answer > silent miss of a real question > unneeded clarification. The
  default weights are 5 / 3 / 1, pending owner decision. Weights are fixed before any set is opened.

## 3. Gates, viability and stop-loss (fixed before measurement)

**Confidence bounds.** A gate passes only on its 95% confidence bound (Wilson): the **lower** bound for
accuracies and the **upper** bound for error rates. Never the point estimate.

**Teacher ceiling** (arm T, dev set), point estimates. If the teacher cannot reach these, the taxonomy or the
labels are the problem: stop and revise ReaderFrame or the labeling guide. Never tune a reader against a
ceiling the labels cannot support.

| Field | Ceiling target |
| --- | --- |
| speech act | ≥ 93% |
| address op | ≥ 92% |
| relation (kind + target) | ≥ 90% |
| facet | ≥ 88% |
| subject | ≥ 90% |
| referent | ≥ 92% |
| inbound answer | ≥ 92% |

**E4B viability** (dev + calibration). Both conditions must hold:
1. E4B is within **6 points** of the teacher on **every** routing field.
2. E4B is **better than L0 on false confident interpretation**.

Otherwise do not proceed to cutover. Either the owner decides on arm D, or L0 stays primary with V0–V3 plus
agreement gating.

**Calibration.** False confident interpretation must be ≤ 3% at ≥ 88% coverage, with per-field margin
thresholds fit on the calibration set only. If no threshold achieves this, the arm fails regardless of
accuracy.

**Sealed acceptance** (E4B arm; bounds as above):

| Gate | Threshold |
| --- | --- |
| Resolver spec suite on gold frames | 100% (no exceptions) |
| False confident interpretation (whole turn, routing fields) | upper bound ≤ 3% |
| Unnecessary clarification | upper bound ≤ 10% |
| Speech act / address op / relation accuracy | lower bound ≥ 93% |
| Facet accuracy | lower bound ≥ 90% |
| Subject / referent / inbound-answer accuracy | lower bound ≥ 92% |
| Reader latency | p50 ≤ 2.0 s, p90 ≤ 3.0 s, over ≥ 200 turns on the target M3 16 GB |
| Whole-turn latency | p90 ≤ legacy baseline p90 + 2.5 s |

**Multiple gates.** Several simultaneous gates inflate the chance that a truly failing reader passes one by
luck, or that a truly passing reader fails one. Before the sealed set is opened, the owner ratifies **one**
family-error policy:
- (a) a Bonferroni-style correction: each bound at 1 − 0.05/k for k gates; or
- (b) the stated per-gate 95% bounds, with the documented acceptance that the family-wise error is higher.

The default is (a).

## 4. Gold-DIS construction

- An item is a **scripted prefix plus a target line**. The prefix is played through the real service
  (`tools/dialogue-gold-eval.js`): say, chip target, coworker question via
  `dialogue-state.recordInboundRequest`, unanswered request via `dialogue-state.openRequest`, cold reload. The
  DIS is exactly what the product builds.
- **Checkpoints** assert that canonical state: requests (predicate, targets, state, answered_by), the active
  activity (kind, done), surface anchors (speaker, words), the pending inbound question (from, shape, option
  count), and the active speaker. Target-time checks cover salience, the active place and inbound options.
- A prefix that fails a checkpoint makes the item `prefix_invalid`. A gold frame whose relation, answer or
  set-valued address rests on state no checkpoint verified is `incomplete_state_verification`. Neither is
  scored. Context is never rebuilt by re-parsing prose.
- Gold frames use symbolic references (`@Name`, `req:<facet>`, `anchor:<speaker>`, `activity`, `inbound`,
  `ref:<name>`, `opt:<option>`). Every gold frame must pass V0–V3 against its own input, or the item is
  rejected at authoring time.

## 5. Labeling protocol

- **What labelers see.** Exactly what the reader sees: the rendered ReaderInput (`--show-input`), including
  the heard channel. They do not see prose context, the transcript, canonical ids or any arm's output.
- **What they label.** A ReaderFrame (language-level address op, not responder ids) and, separately, the
  expected resolution and behaviour.
- **Independent labelers.** Two LLM labelers from different model families, plus a human labeler.
  - The **double-labeled subset** (two independent labels per item, one of them human) is **≥ 200** items in
    every set, and **all** sealed-set routing fields.
  - No labeler sees another's labels before adjudication.
- **Agreement.** Cohen's κ is reported per field, and every **gated** field needs **κ ≥ 0.80**. A field below
  that is not used as a gate: it is redefined or dropped, by owner decision. Disagreements are adjudicated by
  the human labeler, with a reason.
- **Label-noise ceiling.** The adjudicated agreement rate per field is reported with every result. No arm is
  expected to exceed it.

## 6. Sets

| Set | Purpose | Use |
| --- | --- | --- |
| **Dev** | taxonomy, prompt and schema development; teacher ceiling | open, reusable |
| **Calibration** | per-field margin thresholds; agreement-gate thresholds | frozen once built; only for thresholds; never for prompt or schema changes |
| **Sealed acceptance** | the go/no-go measurement for one reader architecture version | hash-committed before measurement; opened **once**; spent afterwards |

- **Sources:** real owner playtest transcripts (local exports, no telemetry), multiple authors and personas,
  and minimal pairs.
- **Spent corpora.** The six spent ED-30 corpora are **diagnostic only**; any training or calibration use is
  an owner decision.
- **Sizes:** sealed ≥ 400 target turns, calibration ≥ 300, dev unbounded.

## 7. Calibration protocol

- **Per-field margin** is computed by code from token log-probabilities, **renormalized over the
  grammar-legal continuations** at the field's first discriminating token. The runtime spike confirmed that
  llama.cpp's `top_logprobs` are pre-grammar at T=0, and that `post_sampling_probs` is empty at T=0.
- **Thresholds** are fit on the calibration set only, minimising false confident interpretation subject to
  coverage.
- **Pinning.** Thresholds are pinned to the reader identity: model hash, quantization, runtime build, schema
  hash and prompt hash. A change to any of these invalidates them.
- **Agreement gating during migration:** proceed when the reader agrees with L0 on the routing fields or its
  margin clears the threshold; otherwise clarify, at interface level if the owner's B8 decision allows.

## 8. Risk–coverage evaluation

- For each routing field and for the whole turn, report the risk–coverage curve: error among accepted turns
  against the fraction accepted, sweeping the margin threshold.
- Report the operating point chosen on the calibration set, and its realised risk and coverage on the sealed
  set.
- Report L0 alongside, with Tier-1 completeness as its only confidence.

## 9. What is explicitly not done

- No sealed set is created, hashed or opened in Phase 0 or 0.5.
- No new blind corpus.
- No tuning of the legacy parser.
- No threshold is fit on any spent corpus.
- The strong-model teacher never runs in the game's request path.
- Live-model measurements are supporting and non-authoritative; deterministic CI never needs a live model.

## 10. Changes from the Phase-0 draft (for review)

| Item | Phase 0 | Phase 0.5 |
| --- | --- | --- |
| Double-labeled subset | ≥ 25% human, 100% of sealed routing fields | **≥ 200 items** per set, plus 100% of sealed routing fields |
| κ gate | ≥ 0.70 | **≥ 0.80** on every gated field |
| Teacher ceiling | speech act / address / relation ≥ 90, facet ≥ 85 | **93 / 92 / 90 (kind+target) / 88**, plus subject 90, referent 92, inbound 92 |
| E4B viability | not worse than L0 on false-confident; p90 ≤ 3 s | **within 6 points of teacher on every routing field** and **better than L0** on false-confident |
| Calibration | ≤ 3% false-confident at ≥ 70% coverage | **≤ 3% at ≥ 88% coverage** |
| Unnecessary clarification | upper bound ≤ 12% | **≤ 10%** |
| Per-field sealed accuracy | ≥ 95% lower bound (4 fields) | **93 / 93 / 93 / 90 / 92 / 92 / 92** lower bounds (speech act, address, relation, facet, subject, referent, inbound) |
| Reader latency | p90 ≤ 2.5 s | **p50 ≤ 2.0 s, p90 ≤ 3.0 s, ≥ 200 turns on M3 16 GB** |
| Whole-turn latency | absolute p90 ≤ 5 s | **baseline p90 + ≤ 2.5 s**. The absolute 5 s gate was invalid: the legacy baseline itself exceeds it in some scripts |
| Multiple gates | not addressed | **family-error policy required (§3)** |
