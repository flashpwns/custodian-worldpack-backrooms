# Raw player-language reads outside the reader boundary (Phase 0.5 inventory)

**Scope.** Every code path that reads the player's typed words — by regex, word lists or word overlap —
outside the single reader boundary (ReaderInput feature extraction → reader → ReaderFrame). Line numbers
are at the Phase-0.5 commit. **Nothing here is migrated in Phase 0.5.** The seam's own feature extraction
is listed first for completeness.

**Classification.**

| Class | Meaning |
| --- | --- |
| **F** | legitimate feature extraction (paraphrase-invariant surface facts; no decision) |
| **P** | legitimate presentation or validation use (checks candidate wording; decides no routing) |
| **M** | interpretation that must migrate to the reader |
| **R** | resolver-policy violation (routing or ownership decided from words) |
| **C** | planner or canonical-state violation (words change canonical state or planner input directly) |
| **Mem** | memory / retrieval exception (selects context for wording only) |
| **Old** | old-save recovery |
| **Ch** | separate action-request channel |
| **Dead** | dead legacy |

## A. The reader seam itself

| # | Site | Reads | Class |
| --- | --- | --- | --- |
| A1 | `dialogue-reader-input.js` `nameVocabulary` / name spans / entity spans / wh, second-person, quantifier and deictic classes / punctuation | tokens against closed vocabularies | **F** |
| A2 | `dialogue-normalize.js` `normalizeUtterance` | closed-vocabulary name repair, contractions | **F** |

## B. Canonical-state writes decided from raw words (most serious)

| # | Site | Reads | Effect | Class |
| --- | --- | --- | --- | --- |
| B1 | `desktop/service.js:2636` `isDisclosure` regex (`i prefer`, `call me`, `nervous`, `tight spaces`, …) → `:2685` `personnelContinuity.recordAttitudeChange` (trust +8, rapport +10) | raw message | **canonical personnel attitudes mutated by keyword** | **C** |
| B2 | `desktop/service.js:2631` `isWarning` regex (`look out`, `careful`, `stop`, …) → `:2694` `recordAttitudeChange` (trust +4, rapport +2); also `importance` / `risk` in the reaction context | raw message | canonical attitudes mutated; reaction salience | **C** |
| B3 | `desktop/service.js:2629` `request` regex (`hand\|pass\|give\|bring\|transfer`) and `:2630` `isQuestion` regex → reaction context (`novelty_key`, `operational_importance`, `is_question`) → `personnelContinuity.react` | raw message | canonical reaction history and categories | **C** |
| B4 | `desktop/service.js:2892` `geography_shared: /\b(route\|corridor\|passage\|location\|map\|survey\|where)\b/` → `recordSharedHistory` (persisted) | raw message | a persisted shared-history flag set by keyword | **C** |
| B5 | `desktop/service.js:3124–3127` radio channel: `checkInReport`, `purpose` (deviation / emergency / assistance / return / …), `geographyReport`, `environmentConditionIds` regexes → `communicationRuntime.queueRadio` | raw radio text | canonical radio message purpose, geography report, environment conditions | **C** (STANDARD channel, separate from LOCAL dialogue) |

## C. Routing and ownership decided from raw words

| # | Site | Reads | Effect | Class |
| --- | --- | --- | --- | --- |
| C1 | `dialogue-interpretation.js:769` `resolveResponseOwners`: l.780 legacy act/topic; l.893 `/everyone\|everybody\|you all\|all of you/`; l.898/909 `REMARK_ACTS`; l.913 `SOCIAL_UNTARGETED_PATTERNS` (l.596) | legacy speech act + regexes | owners, including owner decision #2's silence | **R** |
| C2 | `desktop/service.js:2733` `equipmentKnowledgeQuestion` regex (`carry\|holding\|gear\|kit\|manifest\|…`) | raw message | which responder is equipment-relevant | **R** |
| C3 | `desktop/service.js:2409` `mentionedAsSubject` (v1 advisory `addressee_text_span` rescue): `\b<name>\s+(said\|says\|told\|has\|…)\b\|<name>'s` | raw message | whether a Tier-2 span becomes the addressee | **R** |
| C4 | `desktop/service.js:2363` `resolveAddressCorrection({ text })` (legacy correction overlay; replaces the analysis primary: the round trip's `legacy-overlay` class) | raw message | addressee | **R** / **M** |
| C5 | `desktop/service.js:1616, 2319, 2376` `parseAddressees` | raw message | address overlay | **M** |
| C6 | `desktop/service.js:2415` `inferLocalRecipientType(utterance)` | raw message | recipient scope | **M** |
| C7 | `desktop/service.js:2564` → `dialogue-discourse.js:488` `resolveRecipientScope`: l.496 `matchOpenQuestionSlot(raw)`; l.505 `LP.question_like`; l.507 word overlap with `anchorTerms` (reply facts **incl. optional**) | raw message | scope inheritance | **R** |
| C8 | `dialogue-turn.js:238` `resolveAddressee`: l.275 second-person regex; l.223 `isFollowUp` (`FOLLOW_UP_FRAGMENT` / `FOLLOW_UP_ANAPHOR` / `DUMMY_IT`, l.220–222) + `salient_names` (optional facts) | clause body | `antecedent_owner` / `active_speaker` inheritance | **R** (the resolution half of analyzeTurn) |
| C9 | `dialogue-turn.js:95` `inboundAnswer`; l.53–56 `REPLY_UNCERTAIN` / `REFUSAL` / `COUNTER_WHY` / `SELF_REPAIR`; l.104 `STATEMENT_EVIDENCE` | clause body | inbound answer kind and routing to the asker | **M** (reader `inbound_answer`) + **R** |
| C10 | `dialogue-turn.js:190` `echoOf` (`ECHO_TAIL` / `ECHO_LEAD`, l.188–189) | clause body vs heard wording | `surface_anchor` routing | **M** (reader `echo`) |
| C11 | `dialogue-turn.js:730–760` fragment tables (`ELABORATE_TIME`, `TEMPORAL`, who-else, what-for) | raw fragment | facet, temporal, addressee (`answer_owner`, `person_set_continuation`) | **M** + **R** |
| C12 | `dialogue-turn.js:148` `itemRole` (`ITEM_ROLES`, l.71) | clause | item facet and `item_id` | **M** (reader facet + referent) |
| C13 | `dialogue-turn.js:34` `placeOf` (`INSIDE_DEIXIS` / `THERE_DEIXIS`, l.26–27) | clause | `place_id`, `place_basis`, deixis clarification | **M** (reader referent) + **R** |
| C14 | `dialogue-turn.js:842` `completenessWithFrame` l.871 `STATEMENT_EVIDENCE` over the clause | clause | clarification (the Tier-1 gate) | **M** (retires with the gate) |
| C15 | `dialogue-turn.js:996` `finalizeFrame`: l.1006 `legacyRoute` regex on `request_text` (`happened\|did\|was\|…`); l.1022 `requestLower` positions of named persons; l.1032 second-person regex on `act.body_expanded` for `thirdParty` | the act's words | subject, cardinality, route, clarify-over-guess (the round trip's `frame-assembly-text` class) | **R** (frame assembly must take the subject from the frame) |
| C16 | `desktop/service.js:2652` intra-turn pronoun regex `/\b(?:he\|him\|…\|there)\b/` over the utterance | raw message | which discourse the frame builder sees | **R** |

## D. Language reading that must migrate to the reader

| # | Site | Reads | Class |
| --- | --- | --- | --- |
| D1 | `desktop/service.js:2624` → `dialogue-interpretation.js:646` `interpretUtterance` | legacy speech act and topic reader (feeds C1 and `buildSemanticFrame`) | **M** |
| D2 | `desktop/service.js:1627, 2638, 2641, 2827` `buildSemanticFrame({ text })` | about 25 `LP.*` regexes (see `READER_PHASE0.md` §7, half A) | **M** (half A); half B stays |
| D3 | `dialogue-turn.js:361` `analyzeTurn` / `dialogue-acts.parseActs` (the Tier-1 reader) | cue regex towers, force, vocatives, quantifiers, repairs, ellipsis | **M** (becomes legacy reader v0 / offline, B2) |
| D4 | `dialogue-advisory-interpreter.js:274` "Recent lines (words only)" in the Tier-2 prompt; `dialogue-discourse.js:1236` `anchorCandidates` (optional-fact labels) | coworker wording / unspoken facts to a model | **M** (retires with Tier 2; B7) |

## E. Separate action-request channel

| # | Site | Reads | Class |
| --- | --- | --- | --- |
| E1 | `desktop/service.js:1506` `localIntent.parse` (`tools/q4-local-intent.js:47`) → `validateProposal` → `teamRuntime.issueOrder` | raw order text | **Ch**. A bounded order channel with its own validator; ReaderFrame `requested_action` only hands off to it |
| E2 | `desktop/service.js:4163–4165` free-text router: `namesWorker` + `localPhrase` regex → `submitQ4LocalIntent`; the `COMPLETE_RETURN` keyword (l.4160) | raw text | **Ch** / **R**. A keyword decides which channel a line enters |

## F. Memory / retrieval, presentation / validation, old saves

| # | Site | Reads | Class |
| --- | --- | --- | --- |
| F1 | `ai-local-dialogue.js:126` memory `queryText: player_text`; `q4-personnel-continuity.js:216–230` token overlap | selects memories for the wording packet | **Mem** |
| F2 | `q4-personnel-continuity.js:501` `/call me\|prefer\|name\|casey\|tight spaces\|nervous/` | selects a recalled player statement (a hard-coded name "casey": a defect to raise) | **Mem** (defect) |
| F3 | `ai-local-dialogue.js:89` `interpretUtterance` fallback (legacy callers without a supplied interpretation) | legacy packet path | **Mem** / **Dead** for plan-carrying packets |
| F4 | `dialogue-validation.js:288, 301, 317, 325, 327` | candidate wording checked against the player's words (restatement, echo, verbatim repeat) | **P** |
| F5 | `desktop/service.js:2225, 2242` legacy-receipt recovery (`buildSemanticFrame(stripNamedAddress(recorded.text))`, `interpretDialogueUtterance`) | an earlier turn's raw text, only for receipts written before frame snapshots existed | **Old**. Never call a model on reload |
| F6 | `dialogue-eval.js:112` `npc_question && statement → answer` | a harness-only reading rule in the old evaluator | **Dead** (superseded by `dialogue-gold-eval.js`) |

## What the round trip showed

- **C15 (`finalizeFrame` text reads) is the only raw-text dependency the Phase-0.5 round trip could not
  route around.** Turns whose resolved act matches production but whose planner frame does not are
  classified `frame-assembly-text`.
- **C4 (address-correction overlay)** shows up as `legacy-overlay`.
- **The B class is out of the dialogue reader's scope**, but it violates "AI/language may present canonical
  state, not create it" and "no keyword matching over speech" (Doctrine 4.10 / 7.19 comments in the code
  itself). It needs an owner decision on whether disclosures and warnings become reader outputs (a claim /
  warning act) validated before any attitude change.
