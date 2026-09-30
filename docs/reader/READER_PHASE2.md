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

**Status: STEP 0 COMPLETE.** The teacher ceiling (§11) has not run. It is blocked on a hosted-teacher credential and
gold labels.

## 1. Owner decisions applied

| Decision | Applied as |
| --- | --- |
| **B7 salience** (approved for ReaderInput / Phase-2 data) | ReaderInput v2. **Canonical** salience comes from the player's own words (the last request text, the previous player line) and canonical interaction state (active request arguments, the active place, the pending coworker question's options). **Heard** salience comes only from delivered coworker wording, resolved against the observer-visible lexicon, in `heard.salient_entities`. It may license a reference and never creates a fact. **No plan fact**, required or optional, is salient. Production `withSalience` is unchanged. |
| **C1 persistence** | deferred to Phase 3; after a reload, `c1` is absent and a claim-dependent turn is an expected abstain / unsupported |
| **B2 offline contract** | deferred to Phase 3 |
| **B8 clarification UX** | no renderer work. Every clarification is classified and recorded as `LINGUISTIC_AMBIGUITY` or `READER_UNCERTAINTY` (`dialogue-reader-async.js clarificationKind`) |
| **Hosted teacher** | development-only transport (`hostedChatTransport`). It sends exactly the frozen render and the closed contract, records provider / model / what was transmitted, and is never used in production |

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
| 11 / 12. Data and labels | `READER_PHASE2_DATA_PROTOCOL.md`, `READER_PHASE2_LABEL_GUIDE.md`, `dialogue-reader-labels.js`, `tests/fixtures/reader-phase2/rare-state-scenarios.json` | strata, weights, calibration and sealed protocol; labelling rules; κ / PABAK agreement; a rare-state stratum (62 inbound answers) |
| 22. Statistics | `READER_PHASE2_PREREGISTRATION.md` §6, `dialogue-reader-power.js` | option B recommended: a conjunctive IUT family of 4 gates, sealed n = 1,000 |

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

**Token distribution** (`docs/acceptance/reader-phase2/token-distribution.json`; pinned tokenizer: Gemma 4 E4B
Q4_K_M, `85a896a0…`, llama.cpp b11146; 927 replayed turns, 535 distinct renders):

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
- **Hosted teacher transport:** the request body is exactly `[system, user]` of the frozen render, at temperature
  0, with no canonical id. `transmitted` records the URL, model, byte count, the SHA-256 of system and user, and the
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

## 11. Teacher ceiling, wire-vs-JSON, E4B: NOT RUN (blocked)

1. **Hosted-teacher credential.**
   - No hosted API key is available in this environment (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
     `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are unset). No teacher provider or model is chosen.
   - The run is turnkey:
     `node tools/dialogue-reader-replay.js --run <capture> --labels <gold.jsonl> --arm hosted --api openai-chat|anthropic-messages --base-url … --model … --key-env <VAR> --out <score.json>`.
     Add `--output json` for the wire-vs-JSON check.
2. **Gold labels.**
   - No development item has a gold frame yet. The ≥ 300-item teacher run needs labels written from the frozen
     render (label guide).
   - It also needs the ≥ 200 human double-labelled and adjudicated items.
   - The LLM labeler must not share the teacher's model family. The teacher's family therefore has to be chosen
     before LLM labelling starts.
3. **Order.** E4B (arm C) runs **only after** the teacher clears §3 of the preregistration. The latency ladder
   beyond the token distribution, the calibration and the live developer shadow wait for it.
