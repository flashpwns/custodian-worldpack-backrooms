# Dialogue reader: Phase 0 (seam construction)

**Current authority (2026-10-05):** this document preserves the historical pass. See [Dialogue closure status](../dialogue/DIALOGUE_CLOSURE_STATUS.md). Jack's recorded `spoken_address_separate` policy now accepts spoken Tonya address independently of Malcolm chip delivery; the chip still controls routing and the shadow records `chip_vs_vocative`. Historical chip-rejection descriptions below are superseded by that owner decision. Reader remains shadow-only.

**Baseline:** `9e51842` on `opener-human-green-2026-09-19`.

**Scope:** architecture seams only.
- No player-facing, routing, Tier-1, advisory, renderer or runtime-flag change.
- No cutover.
- The spent corpora are untouched.
- **Correction (Phase 0.5):** an earlier version of this document said `verification/*` was untouched. That
  was true of the Phase-0 implementation, but not of the Phase-0 **finish**:
  - `tests/ed31a-reader-phase0.test.js` was registered in `verification/verification-authority.json` and
    `verification/test-manifest.json`, with owner approval, per `docs/VERIFICATION_GOVERNANCE.md` §6.
  - Phase 0.5 adds further governed entries (see `docs/reader/READER_PHASE0_5.md` §2).
- No new blind corpus.

**Authority:** the adjudicated architecture review of 2026-09-28, under `SIMULATION_DOCTRINE.md`
(7.5, 7.26, 7.27, 14.35, 14.36, 17.26, 17.32) and the Gameplay Constitution. This document authorizes
nothing beyond Phase 0.

## 1. What exists after Phase 0

```
raw line + chip ─► ReaderInput builder (pure, observer-safe) ──► reader seam ──► V0–V3 ──► receipt (dev trace)
                     tools/dialogue-reader-input.js               │                       (in memory; never persisted;
                                                                  ├ legacy reader v0       never consumed)
                                                                  │  (frameFromLegacy)
                                                                  └ scripted oracle (tests / gold eval)
                         resolveTurn(frame, DIS, present) ── Phase-0 legacy passthrough (identity)
production path: UNCHANGED (Tier 1 → gate → Tier 2 → overlays → finalizeFrame → ledger → planner → wording)
```

| Module | Role |
| --- | --- |
| `tools/dialogue-reader-frame.js` | ReaderFrame v1 contract, decoding-schema builder, validators V0–V3 |
| `tools/dialogue-reader-input.js` | ReaderInput v1 builder: `{ input, bindings }` (bindings stay with code) |
| `tools/dialogue-reader-legacy.js` | `frameFromLegacy`: the current parser's decisions as a ReaderFrame, with every mismatch classified |
| `tools/dialogue-reader.js` | reader interface, legacy reader v0, scripted oracle, receipts, receipt store |
| `tools/dialogue-resolve-turn.js` | the `resolveTurn` contract; Phase-0 legacy passthrough |
| `desktop/service.js` | additive seam: `dialogueReader` constructor option, `buildReaderSeamInput`, `recordReaderSeam`, `readerReceipts`, and the receipt in the developer trace |
| `tools/dialogue-characterize.js` | characterization of current production behaviour (the equivalence authority) |
| `tools/dialogue-reader-coverage.js` | legacy-adapter coverage over the deterministic fixtures |
| `tools/dialogue-gold-eval.js` | gold-DIS evaluator over the shipped service with an oracle reader |
| `tools/dialogue-reader-spike.js` | runtime spike: isolated llama-server processes only |

## 2. ReaderFrame v1 (`yellow-beast-reader-frame@v1`)

The reader expresses **linguistic interpretation only**:
- every reference is a label the ReaderInput supplied;
- `additionalProperties: false` at every level;
- at most 3 acts.

| Field | Values | Notes |
| --- | --- | --- |
| `span` | `[first token, last token]` | ordered, non-overlapping, on the ReaderInput token list |
| `speech_act` | greeting, farewell, self_introduction, social_acknowledgment, thanks, attention_call, statement, sarcasm, question, request, repair, elliptical_continuation, answer, **aside** | `aside` = out of scope / not addressed to coworkers |
| `question_form` | wh, yes_no, choice, declarative, indirect, tag, count, none | |
| `facet` | registry id, `NONE_ASKING`, `NOT_APPLICABLE` | on a `statement` the facet is what the player **claims** about (claim facet) |
| `polarity` | positive, negative, inverted | with `facet` on a statement, gives the claim's polarity |
| `name_roles[]` | `{ name: nN, role: vocative / mention / answer_to_inbound / greeting_target / repair_target }` | classifies **code-supplied** name spans only. `repair_target` (Phase 0.5) is the person an addressee repair re-addresses ("No, I was asking Malcolm"); it is allowed with NAMED only when `repair_kind` is `addressee` |
| `address` | `{ op: NAMED / ALL / OTHERS / EXCEPT / SECOND_PERSON / NONE, names: [nN], relative_to: qN, count: 2..6 }` | language-level only; **no** KEEP_RESPONDER / SHARED / ASKER_OF_INBOUND / ANSWERER_OF |
| `relation` | `{ kind: new / continuation / repair / topic_return / attention / answer / withdraw, target }` | target: `qN` request, `i1` / `i0` inbound, `s0` / `s1` an earlier act of this line, `v1` the active activity round, `aN` a heard sentence |
| `repair_kind` | addressee, referent, facet, temporal, unanswered, own_answer | |
| `referent` | `{ span: eN, candidate: rN / NONE / AMBIGUOUS }` | the reader chooses only among code-ranked candidates |
| `temporal` | unspecified, now, today, earlier, ever, historical | only what the line **expressed**; defaults belong to the resolver |
| `respondent_mode` | unspecified, each, any, all | as the player expressed it; **not** cardinality |
| `inbound_answer` | `{ kind: answer / uncertainty / refusal / counter_question / none, option: oN / YES / NO / BOTH / NEITHER / EITHER / NONE_OF_OFFERED }` | |
| `subject` | `{ kind: addressee / speaker / named / group / group_inclusive / none, names: [nN] }` | who the facet is about (≠ the address) |
| `self_intro` | `{ span: [a, b] }` | the introduced name, open text |
| `echo` | `{ anchor: aN }` | which heard sentence is echoed |
| `requested_action` | `{ family: STAY / FOLLOW / WAIT / MOVE / RETURN / REPORT / ASSIST / INVESTIGATE / TRANSFER / QUERY / OTHER, object: rN }` | hand-off intent to the existing `q4-local-intent` path only; never an order |
| `abstain[]` | force, address, facet, relation, referent, subject, temporal, inbound_answer | a first-class "I can't tell" |

**Never emitted:**
- canonical actor ids;
- final responder ids;
- response cardinality;
- responder-policy ops;
- facts, state changes, canonical outcomes, knowledge or hidden state.

A test asserts that the schema and the enums carry none of these.

**Coverage-driven correction.** The first coverage run found 73 legacy continuations whose antecedent is
the **active activity round** ("your turn") or **a heard line** ("why?", "what do you mean?"), not a
ledger request. These are genuine discourse antecedents that the DIS already represents, not legacy
policy. So `relation.target` may name `v1` (the activity) or `aN` (a surface anchor):
- V1 checks that such a label exists;
- V3 allows `v1` only for a continuation and forbids `aN` as a topic return.

## 3. ReaderInput v1 (`yellow-beast-reader-input@v1`)

`buildReaderInput({ raw, chip_target_id, present, player, entities, snapshot, ledger, discourse })`
returns `{ input, bindings }`.

| Section | Contents |
| --- | --- |
| `line` | raw line, normalized line (closed-vocabulary repair only), token list with raw offsets |
| `features` | **code facts, never decisions**:<br>• name spans (label, tokens, present person label / absent person / player, position, comma-delimited, capitalized, standalone)<br>• closed-vocabulary entity spans (with their referent candidate)<br>• wh / second-person / quantifier / deictic token classes<br>• punctuation; word count |
| `chip_target` | the explicit UI target as a person label |
| `people` | present coworkers as `pN` labels, with the names the player uses |
| `referent_candidates` | places and items as `rN`, **observer-safe by construction** (Phase 0.5): only things the conversation made salient, the explicit anaphoric set (`conversation.anaphora_candidates`: what the last requests were about), and things the player's own line names (including the items a named task canonically carries). Never the canonical world index. Each has a `basis` (salient / anaphora / line) |
| `conversation` | • last responders and last speakers<br>• last 4 requests `{ label, facet, targets, answered_by (from ledger slots), state, distance }` and the pending ones<br>• the pending coworker question `{ i1, from, kind, facet, answer_shape, options }` and the one just answered<br>• the active activity `{ v1, kind, facet, done, remaining }`<br>• salient entities, active place and the anaphoric set<br>• freshness; the player's previous line<br>• `salience_source` |
| `heard` | **presentation-dependent**, clearly marked: the coworkers' spoken lines, and the surface anchors `{ aN, speaker, request, facet, text }` with their count. Phase 0.5 moved the anchors here from `conversation`: their number and split depend on the wording provider |

- **Absent by construction:**
  - canonical ids;
  - optional (authorized but possibly unspoken) facts;
  - personhood, private or self state;
  - knowledge records;
  - model prompt internals.
- **Salience** comes from the player's own words plus the replies' **required** facts (`salience_source =
  "player_words+required_facts"`). Production's `withSalience` still reads optional facts. That conflict
  is recorded (B7), not resolved.
- **Observer-safety tests** (`tests/ed31a-reader-phase0.test.js`):
  - no canonical id appears in the serialized input;
  - an optional-fact marker never reaches it;
  - optional facts never make an entity salient, while required facts do (positive control);
  - no private-state or prompt keys;
  - spoken wording only in `heard`.

## 4. Validators (pure; no calibration, logprob or agreement gating in Phase 0)

| Layer | Checks | On failure |
| --- | --- | --- |
| **V0** schema | closed enums; ≤ 3 acts; ordered, non-overlapping, in-range spans; no unknown keys at any level; label shapes | the frame is rejected |
| **V1** candidates | every label is in the input's lists (names, entities, requests, inbound, referents, anchors, options, activity); facet in registry; question form ↔ facet; the act's own wh-word ↔ facet (`whCompatible`); temporal ↔ `temporal_support`; referent kind ↔ facet slots; no same-turn forward reference; an asking act needs a facet unless abstaining | the field is rejected |
| **V2** surface | chip target wins; NAMED needs a name span; names only on NAMED / EXCEPT; addressed spans must be people; an absent person → clarify (person); a NAMED name must be a vocative or greeting target; a standalone name is never a mention (clarify); `answer_to_inbound` needs an inbound question, and a person-shaped one for a bare name | clarify or reject the field |
| **V3** discourse | `answer` needs a pending inbound; continuation / repair / topic_return need an eligible antecedent (not superseded or abandoned); an unanswered repair needs an open request; topic_return ≠ the current request; withdraw targets open state; EXCEPT / OTHERS resolve to non-empty sets, and `count` matches; SECOND_PERSON needs someone present | clarify, with the slot |

The verdict never repairs a frame. Dispositions are `accept`, `reject` (V0), `reject_fields` and
`clarify`.

## 5. Reader seam and resolution seam

- **Reader seam** (`DesktopService`):
  - `new DesktopService({ dialogueReader })`, defaulting to the legacy reader v0.
  - For every LOCAL turn, the ReaderInput is built from the **pre-turn** canonical state, right after the
    DIS snapshot and before analysis.
  - After `finalizeFrame`, the reader is called and the frame is validated. `resolveTurn` is called as an
    identity passthrough.
  - The receipt is stored in `readerReceipts` (bounded, in memory) and exposed in the developer trace
    (`getDialogueTurnTrace().trace.reader`).
  - Failures are logged, never raised. Nothing is persisted, and nothing downstream reads the receipt.
  - With an injected oracle, the legacy v0 frame is recorded alongside it.
- **Receipt** (`yellow-beast-reader-receipt@v1`): the request id; the reader's id, kind and version; the
  input version and digest; the frame; the conversion notes (v0 only); the verdict (disposition, clarify
  slots, rejected fields, errors); `consumed: false`; and the elapsed time.
- **`resolveTurn(readerFrame, dialogueState, presentActors)`**, from Phase 1, will own:
  - address-op → ids, with the chip winning;
  - responder priority (owner decision #1);
  - inheritance and rotation;
  - one "who has answered" function (ledger `answered_by` ∪ activity completed);
  - cardinality;
  - temporal defaults;
  - request open / reopen / withdraw;
  - inbound-answer routing;
  - remark silence (owner decision #2).

  Phase 0 requires the legacy analysis and returns it unchanged (`source: "legacy_passthrough"`); tests
  assert identity. `RESOLVER_OWNERSHIP` maps each responsibility to the legacy functions it replaces.

## 6. Raw-text dependency inventory (downstream of the reader boundary; **not migrated** in Phase 0)

Line numbers are at the Phase-0 commit. "Raw text" means player words read by regex or word overlap
**outside** the single reader.

| # | Site | What reads raw language | Effect | Phase |
| --- | --- | --- | --- | --- |
| 1 | `dialogue-interpretation.js:769` `resolveResponseOwners`: l.780 act from `interpretUtterance`; l.893 `/everyone\|everybody\|you all\|all of you/` on `player_text`; l.898/909 `REMARK_ACTS` from the legacy act; l.913 `SOCIAL_UNTARGETED_PATTERNS.test(text)` | legacy speech act and topic, plus regexes over the raw line | **owner / cardinality**, including owner decision #2's silence | 1 (re-express on reader speech act and address op) |
| 2 | `service.js:2624` `interpretDialogueUtterance(utterance)` | legacy speech-act / topic reader | feeds owners (#1) and `buildSemanticFrame` | 1 |
| 3 | `service.js:1627, 2638, 2641, 2827` `buildSemanticFrame({ text })` | a full second reader (see §7) | planner input | 1–3 (split, §7) |
| 4 | `service.js:2225, 2242` legacy-receipt recovery: `buildSemanticFrame(stripNamedAddress(recorded.text))`, `interpretDialogueUtterance(...)` | re-reads an **earlier** turn's raw text | old saves only | keep as the legacy-save path; never call a model on reload |
| 5 | `service.js:1616, 2319, 2376` `parseAddressees` | address reader #1 | addressee overlay | 1 |
| 6 | `service.js:2363` `resolveAddressCorrection({ text })` | correction reader | addressee overlay | 1 |
| 7 | `service.js:2415` `inferLocalRecipientType(utterance)` | recipient-type reader | scope | 1 |
| 8 | `service.js:2564` / `dialogue-discourse.js:488` `resolveRecipientScope`: l.496 `matchOpenQuestionSlot(raw)`; l.505 `LP.question_like.test(raw)`; l.507 word overlap with `anchorTerms` (reply facts **incl. optional**) | scope inheritance from words | addressee inheritance | 1 |
| 9 | `dialogue-turn.js:223` `isFollowUp` + `salient_names` (`withSalience` l.919–948, from reply facts **incl. optional**) | fragment / anaphor regexes plus name overlap | `antecedent_owner` inheritance | 1 |
| 10 | `dialogue-turn.js:95` `inboundAnswer`, l.53–56 `REPLY_*` | answer-hood from regexes | inbound routing | 1 (reader `inbound_answer`) |
| 11 | `dialogue-turn.js:148` `itemRole` (`ITEM_ROLES`) | item facet from a clause regex | facet (25 fixture turns) | reader facet |
| 12 | `dialogue-turn.js:190` `echoOf` | echo-token overlap with heard wording | surface-anchor routing | reader `echo` / `relation → aN` |
| 13 | `dialogue-turn.js` fragment tables (`ELABORATE_TIME`, `TEMPORAL`, who-else, what-for) | temporal / person-set follow-ups from raw fragments | facet, temporal, addressee | reader relation plus resolver |
| 14 | `dialogue-advisory-interpreter.js:274` "Recent lines (words only)" | coworker wording in the Tier-2 prompt | Tier-2 reading | retired with Tier 2 |
| 15 | `dialogue-discourse.js:1236` `anchorCandidates` | optional-fact values offered as anchor labels | v1 advisory | retired with Tier 2; B7 |
| 16 | `ai-local-dialogue.js:89` `interpretUtterance` fallback; l.126 memory `queryText: player_text` | legacy reader (fallback) and word-overlap memory retrieval | wording context only | **declared presentation-only exception**, or migrate to reader keys |
| 17 | `q4-personnel-continuity.js:216–230` token overlap; l.501 hard-coded `/call me\|prefer\|name\|casey\|…/` | memory selection by raw words | wording context only | declared presentation-only exception; the hard-coded name is a defect to raise |
| 18 | `dialogue-validation.js:288, 301, 317, 325, 327` | candidate wording checked against the player's words (restatement / echo) | validation of wording | **legitimate surface validation**; whitelist it in the single-reader invariant |
| 19 | `dialogue-eval.js:112` `npc_question && statement → answer` | harness-only reading rule | the old evaluator only | retired with `dialogue-eval.js` |

The legacy-adapter coverage run confirms which of these fired on the fixtures (§8).

## 7. `buildSemanticFrame` responsibility split (documented; no code change in Phase 0)

`tools/dialogue-discourse.js:1290–1616` does two jobs at once.

**A. Language reading** (becomes ReaderFrame fields; must leave this function):
1. **Discourse-marker and topic-return stripping** (`LP.discourse_marker`, `LP.topic_return`,
   `LP.topic_return_generic`) → `relation: topic_return`.
2. **Open-question slot matching** of the raw fragment (`matchOpenQuestionSlot`) → `relation: answer` /
   `inbound_answer`, `repair_kind`.
3. **The discourse-function cascade** over about 25 `LP.*` regexes (meaning, response event, explanation,
   bare reaction, repetition, heard confirmation, opinion, personal experience, mission objective, next
   step, knowledge intent, check-in, ambiguous reference, ownership, invite self-description, background,
   role, close topic, challenge, handoff, order imperative), then `interpretUtterance`'s speech-act switch
   → `speech_act` + `facet`.
4. **The custody-question / item-anaphor / deictic cues** (`LP.custody_predicate`, `LP.item_anaphor`,
   `LP.deictic_object`, `LP.bare_demonstrative`) → `referent` (span or candidate).
5. **Repair-fragment detection** (`LP.self_repair_lead`, `LP.repair_fragment`, `LP.repair_lead`) →
   `relation: repair`.
6. **Temporal expression detection** (`LP.temporal_reference`) → `temporal`.
7. **Surface flags:** `question_form` (leading-word regex), `addressee_state`, `past_perception`,
   `about_addressee`, `request_kind`, `asks_institutional_info`, `explanation_aspect`, `procedure_scope`,
   `custody_time`, `player_affect`, the `player_claim` test, `ambiguous_place`, and `requestedAction`'s
   verb table → `question_form`, `facet`, `temporal`, `requested_action`, a claim facet on a statement.
8. The Tier-2 `applyAdvice` re-typing of a generic reading.

**B. Canonical frame assembly** (stays; becomes the resolver's and planner's frame builder, fed by the
validated ReaderFrame):
1. Equipment resolution against canonical custody (`resolveEquipmentReferent`), holder lookup, and the
   ambiguous / no-match referent records.
2. Anaphor antecedents from the canonical discourse state (`discourse.last_item_referent`), and
   clarification-answer resumption (`resumed_question`, `openQuestionRef`).
3. Spatial selection resolution (`resolveSpatialSelection`) from the deterministic selection only.
4. Temporal resolution against canonical anchors (`resolveTemporalReference`); the conversation-event
   reference (`responseEventReference`) from the event log.
5. The knowledge query and entity resolution (`semanticKnowledgeIntent`'s entity part, `withRelated`), the
   utterance reference (`resolveUtteranceReference`) and the antecedent (`resolveAntecedent`), plus
   `expected_slot` (`clarificationSlot`).
6. Frame shape for the planner: `requested_content`, `expected_response_shape`, `target_scope`,
   `scope_inherited`, and the unresolved-reference and 7.26 degrade-to-clarification rules.

**Plan (no planner rewrite).**
- **Phase 1:** a `frameAssembler(readerFrame, DIS, canonical)` wraps half B, with half A inputs supplied
  by `frameFromLegacy` fields. Equivalence is judged by the characterization snapshot.
- **Phase 3–5:** half A is removed only after the reader cutover for each field.

## 8. Legacy adapter coverage

See `docs/acceptance/reader-phase0/README.md` and `legacy-adapter-coverage.json`.

**Correction (Phase 0.5): class counts versus non-exact turns.** The Phase-0 report gave 4 / 5 / 11 / 8
turns per class, which sum to **28**, but only **27** turns were non-exact. The class counts are per class,
and one turn carried notes of two classes:
- the turn is **"Giselle?"** (`j15/3-chaotic.txt`);
- its notes are `resolver-policy concern: rewrite:attention_call>elliptical_continuation` (a bare name after
  someone answered is turned into a re-ask by ledger policy) **and** `legacy-only artifact:
  relation_without_antecedent` (the continuation it became names no request antecedent).

This was reconstructed by re-running the Phase-0 tools at `e90bff8` (read-only export). The coverage report
now prints `non_exact_turns`, `class_turn_sum` and every `multi_class_turns` entry, so the overlap is visible
rather than implied.

## 9. Gold-DIS evaluator design

See `tools/dialogue-gold-eval.js` (header) and `READER_BAKEOFF_PREREGISTRATION.md` §4. In summary:
- The DIS is built by **scripted prefixes through the real service**, with canonical **checkpoints**.
  Failing items are `prefix_invalid` and never scored; there is no prose re-parsing.
- The shipped composition is measured, with an **oracle reader** injected through the seam.
- Three separate measurements:
  - **reader** (per field, legacy v0 vs gold);
  - **resolver** (spec suite on gold frames: reported `not_implemented (Phase 1)`, plus the conditional
    proxy);
  - **behaviour** (responders, facet, clarification, silence, read from what production committed).
- `tests/fixtures/reader-phase0/gold-harness-selftest.jsonl` has five hand-written items that exercise the
  mechanics. It is **not** an evaluation corpus.

## 10. Owner decisions pending

See `docs/IMPLEMENTATION_STATE.md` (Reader Phase 0 entry): B2, B6, B7, B8, the Phase-5 verification-
authority change, and the renderer staying untouched.
