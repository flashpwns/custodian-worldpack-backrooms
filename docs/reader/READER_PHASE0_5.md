# Dialogue reader: Phase 0.5 (making Phase 0 trustworthy)

**Baseline:** `e90bff8` (Phase 0) on `opener-human-green-2026-09-19`.

**Scope:**
- No Phase 1, no cutover, no player-facing / routing / Tier-1 / advisory / renderer / runtime-flag / planner /
  dialogue-state API change.
- No new corpus.
- No tuning of the legacy parser.
- Spent corpora untouched.

**Authority:** the Phase-0 architecture review, under `SIMULATION_DOCTRINE.md` and the Gameplay Constitution.

**Production behaviour is unchanged.** Evidence:
- the committed v1 characterizer re-run against the v1 authority with every Phase-0.5 seam change in place:
  identical;
- the seam-inertness tests;
- the full-repository failing set compared mechanically with the committed baseline.

## 1. What changed, and why

| Area | Change | Why |
| --- | --- | --- |
| Seam (`desktop/service.js`, additive) | The seam also records a **value-level legacy record** (`legacyRecord`: facet_source, overrides, args, repair, reopen, the primary the service actually finalized) and code-side context (bindings, the pre-turn ledger clone, the present actors, the pre-finalize frame, completeness). The developer trace shows `traceView`, never the context. Injectable `readerInputBuilder` and `readerReceiptLimit` | characterization at value level; the round trip and the gold resolver leg need the real DIS; inertness tests |
| ReaderFrame | name role **`repair_target`** (with NAMED only on an addressee repair); relation targets `v1` (activity) and `aN` (heard sentence) from Phase 0 | the round trip found that corrections name their addressee as a mention |
| ReaderInput | surface anchors moved to **`heard`** (their count and shape are provider-dependent); referent candidates **observer-safe by construction** (salient, anaphoric set, named in the line incl. a named task's items; never the canonical index); **`anaphora_candidates`**; salience from **string-valued required facts only**; option ids mapped to labels (**never an id**); possessive name spans; proper-name vocabulary only | observer-safety findings (§4) |
| Validators (seam only) | ALL / OTHERS / EXCEPT / SECOND_PERSON need surface evidence; respondent mode must be expressed and compatible with the address; referents must be licensed; a line with asking features never silently becomes a remark / aside | review gaps (§3) |
| `resolveTurn` | a **frame-driven** mode (measurement only) beside the production legacy passthrough | the round trip and the resolver spec need a resolver that consumes frames |
| Adapter | expresses the primary production **used**; legacy's effective temporal scope; `repair_target` for corrections; OTHERS for "the other one"; antecedents for counter-questions (`i1`), own-answer repairs (`i0`), activity re-asks (`v1`), same-line claims (`s0`); abstention only from a legacy clarification; deictic default and legacy-salience places classified | fidelity: "express what production decided" |
| Tools | `dialogue-characterize` v2 (scenarios, value-level, census); `dialogue-reader-roundtrip`; `dialogue-gold-eval` v2; `compare-failing-tests` | §2–§6 |

## 2. Characterization authority and governance

- **Pinned authorities.** `docs/acceptance/reader-phase0/characterization.json` (v2),
  `roundtrip.json` and `baseline-failing-tests.json` are pinned by SHA-256 constants in
  `tests/ed31a-reader-phase0.test.js`. That file is hash-governed in `verification/verification-authority.json`.
  Regenerating an artifact fails `ed31a` until the pin is updated, and updating the pin changes `ed31a`'s
  hash, which fails the inventory until the authority's `test_hashes` entry is updated. **Drift is therefore
  a two-step, reviewable governance change, never a silent refresh.**
- **Deterministic checks in the verification flow:**
  - aggregate tier (`ed31a`): the pins, plus a replay of the 16 scenario sessions (characterization and round
    trip) against the pinned artifacts;
  - long-world tier (`tests/ed31b-reader-characterization-full.test.js`, newly registered): the full
    characterization and the full round trip.
- **Governance changes in this pass** (per `docs/VERIFICATION_GOVERNANCE.md` §6):
  - `test_hashes["tests/ed31a-reader-phase0.test.js"]` updated;
  - `ed31b` added to `required_tests["long-world"]`, `test_hashes` and the manifest (`included`,
    `long-world`).

  Nothing else in `verification/*` changed.
- **Baseline failing set.** `baseline-failing-tests.json` lists the 79 tests failing at `9e51842` (74 mapped
  to their file; 5 parameterized names). `tools/compare-failing-tests.js <run output>` reports new failures
  (exit 1) and fixed ones.

## 3. Validator changes (seam only; legacy production output untouched)

| Check | Rule |
| --- | --- |
| ALL | needs a room-wide word in the act: all, everyone, everybody, both, guys, team, y'all, anyone, anybody, any, someone, somebody, each, every, yourselves, folks (possessives count) |
| OTHERS | needs rest / others / other / else, or "you two / three" |
| EXCEPT | needs except / besides / excluding / apart, or "but / not" right before the excluded name, **and** a named exclusion |
| SECOND_PERSON | needs a second-person token in the act |
| respondent mode | must be expressed (each / every / all / any / someone / …); `each` or `all` with a single NAMED addressee contradicts the address |
| referent | the candidate must be licensed: an entity span in the act, a thing the line names (basis `line`), a salient entity, the active place, or the anaphoric set |
| non-asking | statement / aside / sarcasm / social acknowledgment on an act with "?" or a leading wh-word clarifies, unless the reader explicitly abstained on force |

On legacy frames the new checks fire only where legacy itself proceeded on something debatable: 11
question-form cases, 1 chip conflict and 1 wh-led sarcasm. All are in the owner rulings (C).

## 4. ReaderInput safety (tested on real service state)

`ed31a` builds ReaderInputs from **real** sessions and checks:
- no canonical person or request id;
- no private-state keys;
- **no unspoken optional-fact value** from the previous turn's real plans, unless it was actually heard (the
  run produces real optional facts, so the check is not vacuous);
- hidden entities (the spectrometer, Threshold Approach, Lower-Level Transition) are never candidates;
- an absent person (Maxwell) is a name-span feature, never a present label.

Synthetic tests add:
- a nested structured required value never makes an entity salient;
- string and structured option ids become names or labels, and unknown id-like strings become nothing.

A real-state test shows the canonical `conversation` section identical under two wordings, while `heard`
(anchors: count, split, words) differs; two spoken sentences give two anchors, each mapped to its request.

## 5. Round trip, gold evaluator, inventory

- **Round trip:** 471 turns, **87.0% behaviour-equivalent**, 7.9% exact. See
  `docs/acceptance/reader-phase0/README.md` §2.
- **Gold evaluator:** real DIS, present actors and bindings; checkpoints on requests, answered_by,
  activities, anchors, inbound, active speaker and salience; `incomplete_state_verification`; resolver spec
  7/7 on the self-test.
- **Raw-text inventory:** `docs/reader/READER_RAW_TEXT_INVENTORY.md`, **35 sites** in 9 classes, including
  the canonical-state writes decided from raw words (B1–B5: keyword-driven attitude changes, shared-history
  flags, radio purpose).
- **Owner rulings:** `docs/reader/READER_PHASE0_5_OWNER_RULINGS.md`.

## 6. Unresolved owner decisions (kept unresolved in code)

The recommendations below are for the owner, not decisions.

- **B2: offline contract.** Keep legacy reader v0 permanently as the offline / reader-unavailable reader
  behind V0–V3 and the same resolver, plus structured affordances (address chips) as the fallback when V0–V3
  clarifies. Phase 1 makes this possible without deleting Tier 1.
- **B6: canonical option ids.** The planner should declare `answer_shape` and `options` (canonical ids) on
  every plan that asks the player a choice. The ledger already stores them (`recordInboundRequest`), and the
  ReaderInput already maps them to opaque labels (tested). No planner change is made here.
- **B7: salience.** Recommend: required facts only (provider-independent), with an optional fact counting
  only when the validator records it as expressed. The Phase-0.5 ReaderInput already uses required facts
  (string values only). Production `withSalience` still reads optional facts; the round trip shows 1 turn
  whose place came from it.
- **B8: reader uncertainty.** Recommend an interface-level affordance (address chips / "did you mean …?"
  choices) for **reader** uncertainty (V2 / V3 clarify on evidence or antecedents), and in-character
  clarification only for genuine linguistic ambiguity (Doctrine 7.26). The chip-versus-vocative conflict
  (rulings C3) is the first concrete case.
- **Also for the owner:**
  - the collective subject convention ("we all going?", rulings A);
  - the 4 relation-without-antecedent cases (rulings B);
  - the V1 strictness cases (rulings C);
  - the keyword-driven canonical writes (inventory B1–B5).
