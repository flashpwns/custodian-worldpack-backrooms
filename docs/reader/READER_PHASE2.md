# Dialogue reader: Phase 2 (shadow-only model-reader measurement)

**Baseline:** `64177a0` (Phase 1 + ruling C1) on `opener-human-green-2026-09-19`.

**Governing review:** the Sonnet 5.5 Phase-2 architecture review, as operationalised by the owner's Phase-2 instruction
of 2026-09-30. The review text itself is not in the repository; this pass follows the instruction's 25 items.

**Scope:** SHADOW-ONLY. None of the following happens in this pass:

- a production reader cutover;
- canonical mutation from a model reader;
- a planner rewrite, or a UI / renderer change;
- legacy parser tuning;
- a sealed set, or use of the spent ED-30 held-outs;
- a force push, a merge of main, or a reset / stash.

**Status: STEP 0.1B GREEN (independent audit); teacher-ceiling pre-labelling unblock applied (§14), awaiting independent check.** *(Earlier status: STEP 0.1 COMPLETE, awaiting the Sonnet re-audit.)* The Step-0 claim "ready for the teacher ceiling" was
withdrawn: the independent Sonnet 5.5 audit of Step 0 returned **NOT READY FOR TEACHER CEILING** (blockers in the
experiment / scoring contract). Step 0.1 (§12) fixes them before any gold label exists. The teacher ceiling (§11) has
not run; no gold label, teacher score, E4B accuracy, calibration or sealed item exists.

## 1. Owner decisions applied

| Decision | Applied as |
| --- | --- |
| **B7 salience** (approved for ReaderInput / Phase-2 data) | ReaderInput v2. **Canonical** salience comes from the player's own words (the last request text, the previous player line) and canonical interaction state (active request arguments, the active place, the pending coworker question's options). **Heard** salience comes only from delivered coworker wording, resolved against the observer-visible lexicon, in `heard.salient_entities`. It may license a reference and never creates a fact. **No plan fact**, required or optional, is salient. Production `withSalience` is unchanged. |
| **C1 persistence** | deferred to Phase 3; after a reload, `c1` is absent and a claim-dependent turn is an expected abstain / unsupported |
| **B2 offline contract** | deferred to Phase 3 |
| **B8 clarification UX** | no renderer work. Every clarification is classified and recorded as `LINGUISTIC_AMBIGUITY` or `READER_UNCERTAINTY` (`dialogue-reader-async.js clarificationKind`) |
| **Hosted teacher** | development-only transport (`hostedChatTransport`). It sends exactly the frozen render and the closed contract, records provider / model / what was transmitted, and is never used in production |
| **B7 indirect request-arg salience** (Step 0.1 ruling) | ReaderInput v3. A canonical request argument is shown as the active place or an anaphora candidate only when **observer-grounded**: the player's own words in the recent exchange (their lines, the canonical request texts) name it, or it is an observer-visible option of the pending coworker question. Something only heard stays a heard candidate. Arguments production inferred through `place_basis = salient_topic`, an anaphoric item, an advisory candidate or the "inside" default, with no such grounding, are omitted from the reader view (recorded code-side in `bindings.salience_filter`). Production and canonical state are unchanged |
| **Hidden option labels** (Step 0.1 ruling) | a pending coworker-question option naming an entity the observer cannot see is shown opaquely (its label `oN` with no text), exactly like an id-only option; the canonical binding stays code-side; spoken option wording reaches the reader only through the heard channel |

## 2. Step 0: what changed

| Item | Module | Notes |
| --- | --- | --- |
| 1. Salience | `dialogue-reader-input.js` (v2) | canonical vs heard split. Heard candidates are appended **after** canonical ones, so canonical labels are identical under every wording provider. `salience_source: player_words+canonical_state` |
| 2. Hidden entities | `dialogue-reader-lexicon.js observerVisible`, `nameVocabulary` | World-only people (unless code lists them in `observer_known_ids`) and `observer_hidden` / `hidden` entries are not vocabulary. A hidden name typed by the player produces a ReaderInput **deep-equal** to a word that names nobody. Entity spans carry `player_literal` and a `canonical_candidate` that is only set when a legal, unique binding exists. The real world-only "Control" desk operator is now excluded by default |
| 3. Alias / typo candidates | `dialogue-reader-lexicon.js` | (1) exact observer-visible label, (2) authored alias (canonical-knowledge tables plus `READER_ALIASES`), (3) token fuzzy match: Damerau ≤ 1 at length 4–6, ≤ 2 at ≥ 7, unique nearest entity only, same first letter, never across stop words or inflections, (4) one looser lookup for a **reader-nominated** span (`referent.nominated`): edit ≤ 2 or plural stem, unique, observer-visible, applied code-side before validation. Ordering is basis rank → score → canonical id. A line-named thing is shown with the player's literal words |
| 4. `conclude` | `dialogue-reader-frame.js` (v2), `dialogue-resolve-turn.js` (v3), `dialogue-reader-legacy.js` (v2) | Relation `conclude` may target only the active activity `v1` (or nothing); `withdraw` may target `v1`. V3 checks target and eligibility. The resolver derives `activity.intent = close` only for an ACTIVE activity. With nothing open it is a social no-op. No model-owned activity field exists. The legacy adapter expresses legacy's "that's that" as `conclude`, splitting the marker off an asking clause |
| 5. Render | `dialogue-reader-render.js` (`renderReaderPrompt`) | static system prefix (1,168 tokens, cacheable) plus a compact dynamic view. Noise omitted (§5) |
| 6. Wire | `dialogue-reader-wire.js` | positional core `SPEECH FACET ADDRESS RELATION[:T]`, default-elided tags, `;` between acts, a versioned facet-code table. Also a GBNF grammar per input, and a minimal-JSON decoder for the wire-vs-JSON check |
| 7. Async reader | `dialogue-reader-async.js readTurnAsync` | wire → `decodeWire` → nominated lookup → V0–V3 → `resolveTurn` → receipt. Never throws; exceptions, timeouts, hangs and dead servers give inert `reader_unavailable` receipts. Transports: pinned llama.cpp, hosted (dev only), scripted |
| 8. Replay harness | `dialogue-reader-replay.js` | capture, arms (L0 / local / hosted), the resolved-outcome signature, field agreement, strata weights, bootstrap latency, the token distribution, the dev manifest |
| 9. Receipts | `readTurnAsync` | input / render / wire / grammar digests and versions; reader identity (model hash, quantization); raw wire; decode status; verdict; frame; abstentions; clarification kind; raw logprobs; derived field margins; resolution; latency; timeout / error reason. No chain-of-thought is requested or stored. `consumed: false` |
| 10. Fault inertness | `desktop/service.js modelShadow` (opt-in, developer-only) | runs after commit and wording, never awaited, one in flight, busy drop, 5 s hard timeout, in-memory receipts only |
| 11 / 12. Data and labels | `READER_PHASE2_DATA_PROTOCOL.md`, `READER_PHASE2_LABEL_GUIDE.md`, `dialogue-reader-labels.js`, `tests/fixtures/reader-phase2/rare-state-scenarios.json` | strata, calibration and sealed protocol; labelling rules; κ / PABAK agreement; a rare-state stratum (Step 0: 64 pending-coworker-question turns, 62 of them authored replies; Step 0.1 counts in §12) |
| 22. Statistics | `READER_PHASE2_PREREGISTRATION.md` §6, `dialogue-reader-power.js` | Step 0 recommended a conjunctive gate family with sealed n = 1,000; **Step 0.1 replaced the fixed n by a sample-size rule** (§12) |

## 3. Salience (B7) evidence (`ed33a`)

- A required plan fact that was authorized but not spoken is absent from the whole ReaderInput. So is an optional
  one.
- A delivered fact appears only as a **heard** candidate (basis `heard`, shown with the words heard). It is licensed
  for reference and never enters `conversation.salient_entities`.
- On real service state, with the same turn under two wordings, `conversation` and the canonical candidates are
  deep-equal, while `heard` differs.
- The builder mutates nothing: every argument is deep-frozen. No `facts`, `knowledge`, `grants` or `propositions`
  key appears.

## 4. Hidden entities and candidates (`ed33a`)

| Case | Result |
| --- | --- |
| hidden world-only person "Eleanor Rhodes", typed "rhodes" | no name span, render leaks neither "Eleanor", the id nor "not here"; the input is deep-equal to the no-such-person input |
| the same person with `observer_known_ids` | binds (`absent_person`) |
| hidden item "canister" | no span, and no fuzzy match ("canistr") |
| `bag`, `duffel bag` | the duffle (alias; the item wins over the delivery task) |
| `case` | unresolved |
| `camra`, `camrea` | camera (fuzzy, 1 edit) |
| `cxmxra` | none (2 edits at length 6) |
| `flashlght` | lamp (1); `spctrmeter` → spectrometer (2 edits, length 10) |
| `rooe` with Rope / Robe | ambiguous, no candidate; candidate order `q-robe`, `q-rope` |
| nominated `lampzz` | lamp, via the code-side lookup; a new candidate with basis `nominated` on a copy of the input |

## 5. Render and token distribution

Omitted from the model-facing render:

- character offsets;
- the normalized line when it is identical to the raw one;
- the punctuation summary and word count;
- freshness constants and salience-source labels;
- per-person present / eligible flags;
- `presentation_dependent` and `anchor_count`;
- heard lines already carried by anchors;
- the wh / second-person / quantifier / deictic token classes.

Kept:

- the line and its token indices;
- people and chip;
- names and things typed (the player's literal words and the bound label);
- candidates, with their basis;
- the active place and anaphora;
- requests, with facet code, targets, state and answerers;
- the pending or just-answered coworker question;
- the activity round;
- the player claim `c1`;
- the previous player line;
- heard anchors.

**Token distribution at Step 0** (render v1; pinned tokenizer: Gemma 4 E4B Q4_K_M, `85a896a0…`, llama.cpp b11146; 927
replayed turns, 535 distinct renders). Superseded by the Step 0.1 artifact (render v2, per-class G1; §12):

| | min | p50 | mean | p90 | p95 | max | > 300 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dynamic tokens | 26 | 112 | 132 | **245** | 266 | 333 | 5 |

By stratum (p50 / p90):

| Stratum | p50 | p90 |
| --- | --- | --- |
| j15 | 204 | 265 |
| human trace | 208 | 292 |
| scripted state | 163 | 232 |
| rare state | 117 | 213 |
| ED-30 dev probes (context-free) | 57 | 83 |

- 34.6% of turns fall inside 150–250. The median is below the 150 target because the context-free probes carry
  almost no conversation. No context was padded or cut to hit the target.
- The 5 turns over 300 are late turns of long scripted sessions with four heard anchors.
- The static system prefix is 1,168 tokens.

## 6. Wire format

```
ask contents @n1 new f=wh r=e1>r1                     "Tonya, what's in the camra?"
ack - - end:v1 ; ask next_step - new at=6 f=wh        "Okay, well that's that, where do we head to next?"
```

**Size and codes:**

- legacy frames encode in p50 14 / p90 21 / max 39 tokens;
- every routing enum's first model token is unique: speech act 14 / 14, relation 8 / 8, address 4 / 4, facet
  47 / 47. The seven `item_*` / `place_*` codes that shared a first token were renamed before freezing.

**Round trip (`ed33a`, `ed33b`):**

- **100%** semantic encode / decode on every gold frame: 42 resolver-spec plus 7 harness self-test;
- 100% on every legacy frame of the scenario sessions and of the full 927-turn development capture;
- encoding is canonical: encode(decode(x)) = x.

**Failures:**

- malformed wire fails V0: empty, short core, empty field, unknown speech act / facet / relation / temporal code,
  unknown or duplicate tag, more than 3 acts, missing act start, a non-label name, a canonical id as a referent, code
  fences, newlines;
- a well-formed illegal candidate (`n9`, `r99`) decodes and then fails V1;
- the wire and the grammar never carry a canonical id.

**Pins:** the wire digest and the render system digest are pinned in `ed33a`.

## 7. Async seam and receipts

- **Scripted checks** (`ed33a`):
  - a correct wire resolves;
  - throw, hang, slow (> timeout), malformed, server down and no transport each give an inert receipt with no
    resolution;
  - an `ab=address` abstention clarifies as `READER_UNCERTAINTY`.
- **Hosted teacher transport:** the request body is exactly `[system, user]` of the frozen render, with no canonical
  id. Temperature is sent only when configured (never forced; Step 0.1 §12.6), and the output-token budget must be
  explicit (Step 0.1B). `transmitted` records the URL, model, byte count, the SHA-256 of system and user, and the
  parameters.
- **Local transport:** temperature 0, `top_k` 1, the per-input grammar, top-k logprobs.
- **Local smoke check (engineering only, not a measurement).** Five items through the pinned E4B confirmed:
  - the generated GBNF compiles in llama.cpp b11146;
  - every output decodes;
  - raw logprobs arrive.

  They are **pre-grammar**: an illegal `SPE` token was the top alternative at the speech-act position. No accuracy
  was read or recorded, and no prompt was changed.

## 8. Fault-injection inertness (G6, `ed33a`)

A five-turn session was played with the model shadow OFF, and ON under six readers:

- throw;
- malformed;
- hang (never resolves; 250 ms timeout);
- timeout (reply after 600 ms, 200 ms limit);
- server down;
- a well-formed reply.

**Result:** the run, the world and every saved file are deep-equal to OFF, live and after a cold reload. Every
scheduled reading is accounted for (read, unavailable or dropped busy). Receipts are never in the trace view or the
save.

**A 5-second sleeping reader** does not delay the production turn (the turn completes while the reading still
sleeps). Later turns are dropped while busy. The 5 s hard timeout yields `reader_unavailable`. A duplicate or late
reply never replaces the first receipt.

**Off by default:** the shadow is off unless developer mode **and** a reader with a transport are configured.

## 9. Gold resolver spec (G7)

**42 / 42 = 100%.** Added:

| Item | Result |
| --- | --- |
| r28a | conclude of the active round: close |
| r28b | conclude with nothing active: no-op, silence |
| r28c | conclude targeting a request: CLARIFY |
| r28d | withdraw of the round: close |
| r28e | conclude then question: close + open |
| r28f | conclude while starting another round: supersede, conflict recorded |

## 10. Effect on the Phase-1 shadow comparison (legacy frames; 471 turns)

| Level | Phase 1 (C1) | Phase 2 Step 0 |
| --- | --- | --- |
| ACT | 465 (98.7%) | 465 (98.7%) |
| ROUTING | 382 (81.1%) | 382 (81.1%) |
| LIFECYCLE | 455 (96.6%) | **461 (97.9%)** |
| FRAME | 343 (72.8%) | **345 (73.2%)** |
| all four | 327 (69.4%) | **335 (71.1%)** |
| unclassified / pending | 0 / 0 | 0 / 0 |

**Why lifecycle improved:** the six "that's that" closes are now expressed (`raw_closes_activity` no longer
explains any difference). The comparator also counts `closeActivity` with nothing active as the no-op it is.

**New owner-approved cause:** `owner_B7_heard_not_active_place` (1 turn, 8 fields: "Can you even go in there?"). A place only **heard** ("Outpost A,
Bermuda branch … Equipment Staging") is not the canonical active place, so a bare "there" clarifies instead of
legacy's reply-fact binding.

**Other Phase-1 artifacts:**

- the round trip is 82.4% behaviour-equivalent and 27.4% exact (was 82.2 / 26.5);
- legacy-adapter exact coverage is 89.6%.

## 11. Teacher ceiling, wire-vs-JSON, E4B: NOT RUN

Not run, by instruction (Step 0.1 forbids the teacher, dev labelling, E4B accuracy and calibration / sealed data).
What each still needs:

1. **Families recorded** in `docs/reader/READER_PHASE2_LABELING_REGISTRY.json` (owner decision; recommendation: a
   non-Claude top-tier reasoning teacher, Claude permitted as automated reviewer). Until then hosted runs and
   `MODEL_ASSISTED_REVIEW` labels are refused.
2. **ADJUDICATED_GOLD** for the frozen teacher sample (`docs/acceptance/reader-phase2/teacher-dev-sample.json`, 474
   distinct renders; ≥ 300 valid required), written from the worksheet (label guide).
3. **A credential** in an environment variable, and the run, with explicit egress consent:

   ```
   node tools/dialogue-reader-replay.js --run <capture> --labels <gold.jsonl> --sample docs/acceptance/reader-phase2/teacher-dev-sample.json \
     --arm hosted --api openai-chat|anthropic-messages --base-url … --model … --family <recorded teacher family> --key-env <VAR> \
     --max-output-tokens … [--reasoning-effort … | --reasoning-budget …] [--temperature …] \
     --receipts <receipts.jsonl> --confirm-egress [--include-human-trace] [--retention "<provider setting>"] --out <score.json>
   ```

   Add `--output json` for the wire-vs-JSON control.
4. **Order.** E4B (arm C) runs only after the teacher clears §3 of the preregistration. The latency ladder beyond the
   token distribution, the calibration and the live developer shadow wait for it.

## 12. Step 0.1: experiment / scoring contract fixes (before any label)

**Governing review:** the Sonnet 5.5 independent audit of Step 0 (**NOT READY FOR TEACHER CEILING**: architecture, codec,
observer boundary, async inertness and governance sound; blockers in the experiment / scoring contract), as
operationalised by the owner's Step 0.1 instruction (2026-09-30, 22 items). No teacher, dev labelling, E4B accuracy,
calibration or sealed data was run or created.

### 12.1 Contract changes

| Item | Step 0 | Step 0.1 | Why |
| --- | --- | --- | --- |
| ReaderInput | `@v2` | **`@v3`** | B7 indirect request-arg filter; hidden option labels (the projection's content changed) |
| Lexicon | `@v1` | **`@v2`** | fuzzy guard (ordinary English words never fuzzy-bind) |
| Render | `@v1`, system `c96d6d54…` | **`@v2`, system `8c727a29…`** | one representation-neutral semantic contract with conventions A–D, shared verbatim by the wire system text, the JSON control and the label guide |
| Wire | `@v1`, tables `b18ac02f…` | unchanged | tables unchanged; fenced output is now `output_fenced` (still invalid) for both wire and JSON |
| ReaderFrame / resolver | `@v2` / `@v3` | unchanged | no semantic change needed |
| Replay / labels | `@v1` | `@v2` | distinct-render unit, scoring classes, label states |

Static system prefix: 1,760 tokens (JSON control 2,140), was 1,168.

### 12.2 System prompt and label guide reconciled

`dialogue-reader-render.js semanticLines(spelling)` is the single source. It states the task, the labels, every field
with its meaning, and conventions:

- **A** follow-up / ellipsis: an act that only continues, re-asks, presses or points back at an earlier question and
  whose words express no facet writes the "asks, but names no facet" value with the relation; code inherits the facet;
  a facet is written only when the words express one;
- **B** the chip is where the message is delivered (canonical, code-side), not address language;
- **C** "we all …" is an inclusive-group subject, never `address = all` without address language;
- **D** relation targets are supplied labels the words relate to; a marker alone is never a continuation; no
  antecedent from similarity alone.

The wire system text and the JSON control are both built from it (only value spellings and the output lines differ;
`ed33c` proves both match one template). The label guide §3 embeds the lines verbatim (`ed33c` fails on drift). The
worksheet exports the frozen system text (header row) and each user render.

### 12.3 Gold validation and label states

- `validateLabels`: every row declares `ACCEPT` (decode + V0–V3 accept, resolver resolves) or `EXPECTED_CLARIFY`
  (legal frame, no V1 / V2 error, declared `expected_clarify.field` expressed, resolver clarifies on the declared
  slot). V0 failures, stale / nonexistent targets, illegal candidates, surface contradictions and mismatched outcomes
  are rejected with a reason; duplicate ids are rejected on every row; a missing or changed render digest is refused.
- States `UNLABELED`, `HUMAN_PRIMARY`, `MODEL_ASSISTED_REVIEW`, `ADJUDICATED_GOLD`; only `ADJUDICATED_GOLD` is headline
  gold. "Provisional" gold is retired.
- Independence (registry + code): teacher family ≠ reviewer family; teacher output never gold; an arm never scores on
  gold its own family touched; reviews must post-date the committed human primary; human adjudicates. The families are
  not chosen in code (registry fields are null until the owner records them).

### 12.4 Scoring

- An INVALID resolution has no outcome signature: two invalid readings are never "equal".
- Per row: `transport_unavailable` (no semantic credit, excluded from the semantic denominator, reported, and counted
  wrong in a conservative figure), `invalid_output` (wrong on every field), `read`. With ACCEPT gold a reading is
  correct only if it resolves with an identical signature (accepted-but-different = false-confident); with
  EXPECTED_CLARIFY gold only if it clarifies on the expected slot (an accepting reading is false-confident).
- Gold is re-validated inside `scoreArm`; a gold row no longer valid is `gold_invalid`, excluded, never compared.
- Preregistered retry policy: transient failures (timeout, network, HTTP 408 / 409 / 425 / 429 / 5xx) are retried 3
  times after 2 s / 4 s / 8 s; non-transient ones never; an undecodable reply is never retried.
- Adversarial tests (`ed33c`): two invalid frames, invalid arm vs valid gold, valid arm vs EXPECTED_CLARIFY gold,
  malformed wire, stale antecedent, illegal candidate, transport failure, retries.

### 12.5 De-duplication, sampling and the preregistered teacher sample

The unit is the **distinct frozen render** (`renderGroups`): identical renders are one item, with the render →
occurrences (source rows, strata, fixtures) mapping kept in the manifest. The representative occurrence (first by id)
supplies the code-side context. In 19 of 348 multi-occurrence groups the same frame routes differently across
occurrences; every case is canonical routing only (the two human-trace fixtures use different seeded personnel ids, and
"Who has the camera?" in scenarios where a different person holds it). The language, and therefore the label, is
identical.

| | Step 0 capture (927 rows) | Step 0.1 capture (944 rows) |
| --- | --- | --- |
| source rows | 927 | 944 (+17: the own-answer-correction scenario) |
| distinct player turns (fixture, text, chip) | 558 | 575 |
| distinct player-turn positions | 563 | 580 |
| distinct texts (normalized) | 456 | 470 |
| distinct renders | 535 | 552 |
| headline-eligible renders | — | **474** (78 context-missing probe renders excluded) |

- `--limit` is now a deterministic proportional stratified sample of distinct renders (never the first N rows) and
  is never headline.
- **Context-dependent probes:** 81 ED-30 development probes are authored to need prior conversation and are replayed
  without it (`context_dependent: true`, `context_available: false`; 162 rows, 78 renders). Diagnostic only.
- **Teacher sample (frozen now):** a census of all 474 headline-eligible distinct renders, each counted once:
  j15 132 (27.8%), rare state 108 (22.8%), scripted state 102 (21.5%), ED-30 dev 99 (20.9%), human trace 19 (4.0%),
  ED-30 novel 14 (3.0%). Estimator, cluster-bootstrap interval, label-loss rule, transport-void rule and stop rule are
  preregistered with it (`teacher-dev-sample.json`, preregistration §3). The Step-0 weight 3 on 19 human-trace renders
  is gone from the headline.

### 12.6 Hosted transport, egress consent and receipts

- `hostedChatTransport`: output token budget, optional temperature (never forced), `reasoning_effort` (OpenAI-chat),
  extended-thinking budget (Anthropic; temperature then not sent), `max_tokens` / `max_completion_tokens`, logprobs off by
  default. Only the final text is kept; provider reasoning is never read into a receipt.
- Egress: `--confirm-egress` is required (an API key is never consent); human-trace renders are excluded unless
  `--include-human-trace`; before any request the CLI prints provider, endpoint host, model, family, render count,
  strata, human-trace inclusion, estimated bytes / tokens and the retention / training setting (or "unknown: not
  configured").
- Receipts are mandatory for hosted runs (`--receipts`): per request the render and system digests, provider, endpoint
  host, model, parameters, request bytes, system / user SHA-256, response status, retry count and tries, latency,
  output digest and any transport failure. No chain-of-thought.
- A hosted run is refused unless `--family` equals the teacher family recorded in the registry and differs from the
  reviewer family.

### 12.7 B7 indirect leak and hidden options

- Regression (`ed33c`): an unspoken required fact "report to Equipment Staging" that production turned into
  `place_id = equipment-staging, place_basis = salient_topic` no longer yields `place in talk: Equipment Staging`; the
  same argument is shown when the player said it; when only heard it is a heard candidate, not the active place. An
  anaphoric item resolved only through an unspoken optional fact is omitted.
- On the development capture exactly **2 distinct renders (4 rows) changed**: `j15/3-chaotic` turns 15–16 ("The camera
  is broken, by the way." / "Malcolm, is the camera broken?"), where "Outpost A" had become the active place through
  `salient_topic` after "Can you even go in there?" without the player ever naming it.
- Hidden options: synthetic hidden person, item and place options render with no label text; nothing hidden leaks into
  the input or render; `bindings.options` keeps the canonical ids. No development render changed.

### 12.8 Fuzzy false positives

A frozen guard (`tools/data/reader-fuzzy-guard.json`, 220 words, generated by `tools/dialogue-reader-fuzzy-guard.js`
from the public-domain web2 list, restricted to words that would otherwise fuzzy-bind to this worldpack's 41
single-token names) stops stage 3 for a correctly spelled dictionary word or its -s / -es inflection.

| Word | Step 0 | Step 0.1 |
| --- | --- | --- |
| complete | Complex (fuzzy 2) | unbound |
| touch | lamp via "torch" (fuzzy 1) | unbound |
| portable | Threshold via "portal" (fuzzy 2) | unbound |
| lamb | lamp (fuzzy 1) | unbound |
| note | verbal-recall task via "notes" (fuzzy 1) | unbound |
| deliver | material-delivery task (fuzzy 1) | unbound |
| record | layout record via the **authored alias** "record" / "the record" | **unchanged**: an authored exact alias (canonical-knowledge `names`), which this pass may not alter; flagged for an owner decision |
| camra / flashlght / spctrmeter | camera / lamp / spectrometer | unchanged |

No development render changed (0 of 944 rows).

### 12.9 Rare-state shapes (machine counts)

Step 0 wording "62 inbound answers" was wrong: the rare-state stratum had **64 pending-coworker-question turns**, 62
authored replies and 2 turns that are not answers ("what about the rest of you?", "Okay, that's that." while a question
production raised was pending). Every authored reply now carries a developer coverage tag (never gold), and a new
scenario adds 8 own-answer corrections (just-answered `i0`). Counts (`docs/acceptance/reader-phase2/rare-state-shapes.json`):

| Shape | Step 0 | Step 0.1 |
| --- | --- | --- |
| yes / no | 14 | 16 |
| choice | 10 | 12 |
| person | 6 | 7 |
| time | 4 | 5 |
| item | 4 | 5 |
| free short | 4 | 5 |
| uncertainty | 4 | 4 |
| refusal | 4 | 4 |
| counter-question | 3 | 3 |
| answer + follow-up | 9 | 9 |
| not an answer | 2 | 2 |
| **pending-question turns** | **64** | **72** |
| own-answer correction (`i0`) | 0 | 8 |

No shape reaches 60: each is report-only. The aggregate does not confer per-shape power.

### 12.10 Tokens (G1 by class)

`token-distribution.json` (render v2; pinned tokenizer; 944 turns). The Step-0 audit figures reproduce exactly on the
Step-0 capture with the Step-0 render (context-free 57 / 83; discourse-bearing 198 / 265 / max 333; real scenario
200 / 266 / 333; human trace 208 / 292).

| Class (rule) | n | p50 | p90 | p99 | max | > 300 |
| --- | --- | --- | --- | --- | --- | --- |
| context-free (ED-30 probes) | 398 | 57 | 83 | 127 | 146 | 0 |
| **discourse-bearing** (render carries prior conversation) | 509 | 194 | **263** | 293 | 333 | 5 |
| real scenario (j15, human trace, scripted state) | 437 | 200 | 266 | 312 | 333 | 5 |
| **human trace** | 64 | 208 | **292** | 293 | 293 | 0 |
| all turns (diluted; not the gate) | 944 | 114 | 238 | 293 | 333 | 5 |

**G1 (formal):** discourse-bearing p90 ≤ 300 **and** human-trace p90 ≤ 300, p99 / max reported as guardrails: **pass**
(263, 292). No context was cut or padded.

### 12.11 Statistics

The preregistration no longer states "sealed n = 1,000 is enough". Exact (Clopper-Pearson) power of the
false-confident gate at ~880 accepted: true FC 1.0% → 99.6%, 1.5% → 88.1%, 2.0% → 50.6%, 2.5% → 16.6%. At 1,800 turns
(~1,584 accepted) the power at a true 2.0% is 80.9%. The sealed **gate family** is fixed now, with exact bounds,
clustering by author / prefix through a design effect and explicit rare-state strata; the sealed **N** is chosen by a
pinned rule before the sealed set is generated (preregistration §6).

## 13. Step 0.1B: audit blocker remediation (B1–B4)

The independent Step 0.1 re-audit found four blockers. They are fixed without changing any user render, the frozen
474-render population, ReaderInput / lexicon / frame / resolver semantics, the label contract or the dialogue runtime.
The wire system digest is unchanged (`8c727a29…`); the JSON-control system digest (`c2542a45…`) is now pinned.

| | Finding | Fix |
| --- | --- | --- |
| **B1** | an empty / truncated / refused hosted reply scored as a semantic `invalid_output`; finish / stop reasons not kept; a silent 256-token hosted budget | the output budget is mandatory (refused before egress without it); every reply keeps `finish_reason` / `stop_reason` / usage (never reasoning text); a truncated (`length`, `max_tokens`) or refused (`content_filter`, `refusal`) reply is a `provider_void`, never decoded, never retried, counted with transport voids; a normally completed reply is always decoded, so empty or malformed completed output stays semantic `invalid_output` |
| **B2** | `headline: true` possible for empty, custom, human-trace-excluded or rule-violating runs | `headlineVerdict` binds the headline to the pinned frozen sample (digest, contract identity, 474 ids, regeneration from the capture) and enforces exact population, labels for every render (`ADJUDICATED_GOLD` or a recorded `UNLABELABLE` adjudication), the label-loss rule (≥ 300 valid) and the 2% void rule; `--limit`, stratum filters, diagnostic states, the JSON control and human-trace exclusion are never headline |
| **B3** | receipts written only after the whole hosted run | the receipt file is created exclusively before the first request (fail closed if it cannot be, or already exists); each request's receipt is appended and fsync'd as it completes; a real mid-run process exit leaves receipts 1..N |
| **B4** | the JSON control decoder defaulted required fields, ignored extra top-level keys, passed unknown facets at V0; its system text was unpinned | the JSON must state span, speech act, facet, address op (with names for NAMED / EXCEPT) and relation kind; only `acts` at top level; unknown facets fail V0 (`json_unknown_facet`); fences fail both; `SYSTEM_DIGEST_JSON` is pinned in `ed33a`, and a JSON-only drift (e.g. `ALL` respelled) fails both the digest pin and a decoder-consistency check |

## 14. Teacher-ceiling pre-labelling unblock (2026-10-01; no egress, no label, no teacher output)

Owner decisions applied before human labelling begins. Nothing was transmitted; no label, teacher output, E4B,
calibration or sealed artifact exists. The teacher output budget, timeout and any diagnostic pilot remain **undecided**.

| Item | State |
| --- | --- |
| **Registry** (`READER_PHASE2_LABELING_REGISTRY.json`) | teacher `openai` / `openai` / `gpt-5.6-sol`, recorded by `jack`; automated reviewer family `claude`, provider `anthropic`, **model `null` (intentionally not selected)**, recorded by `jack`; human primary labeler `jack`, adjudicator `jack`. Existing schema only; no field added. `recorded_at` uses the repository's ISO format (`toISOString`) |
| **Governance** | `ed33c` no longer asserts the pre-selection `teacher.family === null`; it pins the recorded identities (exact fields, ISO timestamps, teacher family != reviewer family, no invented keys). A hosted run now also refuses a `--provider` or `--model` that differs from the recorded teacher (`teacherIdentityProblems`), not only `--family` |
| **OpenAI storage** | `hostedChatTransport` always sends `store: false` for `openai-chat` (not configurable, not omittable; a caller-supplied `store` is ignored). Anthropic body unchanged. Every receipt records `provider_storage {api, store_param_sent, store}` read from the **transmitted body**, plus `params.store`; the egress plan prints the policy. A provider that rejects `store:false` returns a non-transient HTTP 4xx: the request fails closed, is never retried, and its receipt still records the evidence. `--retention` stays a record-only label |
| **Request construction (mock only)** | proven for `--api openai-chat --base-url https://api.openai.com/v1 --model gpt-5.6-sol --reasoning-effort high --max-tokens-param max_completion_tokens`: body keys are exactly `max_completion_tokens`, `messages`, `model`, `reasoning_effort`, `store`; `messages` is exactly the frozen system and user render; no `temperature` unless requested; receipts hold digests, provider, model, storage and reasoning **token counts** but never reasoning text or the credential. A tripwire fails any real `fetch` |
| **JSON-control selection** | pinned in `docs/acceptance/reader-phase2/json-control-selection.json` (SHA-256 `fb27ff65…`, `selection_digest` `94e32313…`): 100 distinct renders drawn from the 474 census by `stratifiedSample` (human trace 4, j15 28, scripted 21, rare 23, ED-30 novel 3, ED-30 dev 21). The drawing takes no labels. `--run … --control-subset <file>` verifies the file against the pinned hash and regenerates it from the scored capture before use; **`--limit 100` over labelled groups is not this selection** (an UNLABELABLE record would shift it) and must not be used for the control. Renders in the selection without valid gold are reported (`control_subset.missing_gold`), never replaced |
| **Worksheet** | `.agent-notes/reader-phase2-prep/worksheet-474.jsonl` unchanged and blank (local, untracked) |

Execution (not authorized by this section):

```
node tools/dialogue-reader-replay.js --run <capture> --labels <gold.jsonl> --sample docs/acceptance/reader-phase2/teacher-dev-sample.json \
  --output json --control-subset docs/acceptance/reader-phase2/json-control-selection.json \
  --arm hosted --api openai-chat --provider openai --base-url https://api.openai.com/v1 --model gpt-5.6-sol --family openai \
  --reasoning-effort high --max-tokens-param max_completion_tokens --max-output-tokens <OWNER DECISION> --timeout-ms <OWNER DECISION> \
  --key-env <VAR> --receipts <new file> --confirm-egress --include-human-trace --out <score.json>
```
