# Dialogue reader: Phase 1 (shadow-only resolver)

**Baseline:** `ea12efb` (Phase 0.5) on `opener-human-green-2026-09-19`.

**Scope (owner instruction, 2026-09-29):** SHADOW-ONLY resolver work.
- No player-facing change, no model reader, no cutover, no planner rewrite, no UI / renderer change.
- No sealed or blind corpus; spent corpora untouched.
- No B2 / B6 / B7 / B8 implementation. Production dialogue modules (`dialogue-turn`, `dialogue-interpretation`,
  `dialogue-discourse`, `dialogue-acts`, `dialogue-state`, planner, fallback, claims / personhood / validation,
  provider flags, order channel, personnel continuity) are unchanged.

**Production is unchanged.** Evidence:
- the pinned v2 characterization authority replays **identical** (221 sessions, 471 turns) with the shadow ON;
- shadow ON vs OFF is deep-equal on the whole run, the world and every saved file, live and after a cold reload,
  on **426 / 426** sessions (every characterized fixture under every wording provider it uses);
- the full repository failing set is unchanged against the pinned baseline (§10).

## 1. Owner rulings applied

| # | Ruling | Where |
| --- | --- | --- |
| 1 | "We all going?": `subject = group_inclusive`, `address = NONE` unless there is address language; resolver policy decides who answers | adapter (already Phase 0.5); resolver records `subject:group_inclusive_no_address`; policy chooses (knower, else rotation) |
| 2 | "So…", "Anyway…", "but…" are not continuations because of the marker: continuation / topic return only with a compatible canonical antecedent, else `new` | adapter (`relation_without_antecedent` → `new`); resolver inherits an addressee only from an antecedent the reader NAMED |
| 3 | "Tonya, have you?": a reader-state label `c1` for the player's previous claim, with deterministic eligibility; no persisted legacy clause predicates as authority | ReaderInput `conversation.player_claim`; V0 label, V1 `unknown_claim`, V3 eligibility; seam claim state (§5) |
| 4 | Chip vs vocative: production stays chip-wins; the shadow records the conflict | resolver: a rejection only for `contradicts_chip_target` keeps the chip and records `chip_vs_vocative` |
| 5 | Wh-led sarcasm / asking-looking remark: fail closed | V2 `non_asking_reading_with_asking_features` → CLARIFY → one clarifier |

## 2. Architecture

```
production turn (unchanged) ──► owners decided ──► recordReaderShadow (developer-gated, try/catch)
                                                     │  cloned + deep-frozen inputs; nothing flows back
ReaderFrame + V0–V3 verdict ─► disposition ─► resolveTurn (shadow) ─► response policy ─► frame assembly
   (reader seam, Phase 0)      ACCEPT/CLARIFY/    pure, no text        pure, table        pure, no text
                               REJECT_FIELDS/
                               INVALID
                                                     └─► in-memory receipt (`record.shadow`) — never in the
                                                         trace view, never persisted, never consumed
```

| Module | Role |
| --- | --- |
| `tools/dialogue-resolve-turn.js` (v2) | `resolveTurn(frame, {snapshot, ledger}, present, {verdict, input, bindings, opaque, canonical})`. Production still calls the legacy passthrough (identity). The shadow mode consumes the verdict and owns address-op → ids (chip wins), subject / third party / quoted speaker / mentions, relation / repair / continuation targets (`qN`, `i0`/`i1`, `sN`, `v1`, `aN`, `c1`), temporal defaults, deictic place defaults, activity-round ownership, inbound-answer routing, vacuous repairs, cardinality, clarification, and the request / activity / inbound **lifecycle intent** |
| `tools/dialogue-response-policy.js` | the table-driven responder policy (§3) |
| `tools/dialogue-frame-assembly.js` | the pure planner-frame assembly (§4) |
| `tools/dialogue-reader-shadow.js` | seam-level runner: opaque `request_text` from each validated act span, cloned / frozen inputs, reader-state claims and their freshness |
| `desktop/service.js` (additive) | `readerShadow` option (default: developer mode), `readerClaims`, `readerClaimFor`, `recordReaderShadow` after owners are decided; `production_routing` record (owners, responders, recipients, listeners, address record, canonical candidate flags) |
| `tools/dialogue-shadow-compare.js`, `tools/dialogue-shadow-causes.js` | the four-level comparator and the evidence-based cause rules (§6) |
| `tools/dialogue-shadow-inertness.js` | shadow ON vs OFF whole-state comparison, live and after cold reload (§8) |
| `tools/dialogue-gold-eval.js` (v3) | the gold resolver spec runner (§7) |

**Fail-closed policy (item 8).** Routing-critical fields: speech act, facet, address, relation, name roles, inbound
answer, referent, subject, echo, respondent mode. A rejected routing-critical field, a validator clarification or a
reader abstention makes the act clarify:
- no facet inherited merely because an antecedent has one;
- no arguments carried over or fabricated;
- no default spokesperson: the cardinality is `one_clarifier` (the addressee, else the antecedent owner, else the
  active speaker, else rotation);
- a relation the reader named and that validated is kept (it is the reader's reading, not an inheritance).

Refinements (`temporal`, `requested_action`) are neutralized and recorded. INVALID (no frame / V0 failure) is never
resolved.

**Owner priority** (ratified 2026-09-27 #1) lives in the policy, never in the ReaderFrame: explicit target > repair
target > semantic antecedent owner > active activity target > knowledgeable eligible responder > fairness rotation.
Knowledge flags are production's canonical per-listener flags, used only when they were computed for the same facet
(otherwise none, and `knowledge_flags_unavailable_for_facet` is recorded).

## 3. Response policy (`dialogue-response-policy.js`)

Inputs: the resolved act (speech act, facet, claim facet, relation, reply kind, third-party subject, quoted speaker,
assignment question, outcome, vacuous), the resolved address, the canonical owners (explicit, repair target,
antecedent owner, activity target, inbound asker, active speaker, item holder), the present listeners and the
canonical flags (`knows_fully`, `has_relevant_knowledge`, `last_spoke_seq`, `owns_entity`). No text field exists in
its input.

| Row | Response required | Silence valid | Voices |
| --- | --- | --- | --- |
| asking | yes | no | by cardinality: `each_*` to a group → each addressee; otherwise one voice by the owner chain |
| clarify | yes | no | one clarifier |
| answer | no | yes | none (the line is put to the asker; their next turn is not a response owner) |
| self_introduction | yes | no | each present listener, once |
| social_opening (greeting / farewell) | yes | no | each addressed person; to nobody in particular, one voice |
| claim (statement with a claim facet) | no | yes | one acknowledger; to the whole group, silence |
| remark (statement / sarcasm / aside / acknowledgment) | no | yes | only a person addressed by name (owner decision #2) |

Within the knowledgeable tier: the named subject answers for themselves when among those asked; the canonical item
holder answers item-ownership questions; the assignment owner answers "what is it for" unless they do not know and
someone else does. A quoted speaker ("What did Tonya say?") is not the reporter when someone else heard it.

Output: `addressees`, `responders`, `recipients`, `listeners`, `cardinality`, `response_required`, `silence`,
`silence_valid`, `owner_basis`, `reasons`. Production's `resolveResponseOwners` is not modified.

## 4. Frame assembly (`dialogue-frame-assembly.js`)

Builds the planner-facing frame (finalizeFrame's outer shape: `discourse_function`, `predicate`,
`requested_content`, `expected_response_shape`, `expected_slot`, `referents`, `knowledge_query`,
`self_state_query`, `unresolved_reference`, `turn`) from the shadow resolution and canonical context only (entity
kinds / labels, item custody). It applies finalizeFrame's routing rules without words: answers, clarification,
attention, vacuous repair, registry route, third-party and past-state re-routing, unresolved knowledge entities. An
asking act with no registry facet clarifies (no route exists without reading words). The response-shape table is
the planner's own static `EXPECTED_SHAPES`.

It does not regex text, infer a facet / addressee / relation from text, use `legacyRoute`, call
`resolveEntityMentions` or `buildSemanticFrame`, or call a model. **Fence:** `ed32a` checks all three modules
statically (with negative controls) and at runtime (the line, tokens, heard channel, name-span text and referent
names are replaced by throwing accessors; `request_text` is an object whose conversion throws; the resolution must
be identical and carry `request_text` by identity).

## 5. request_text and the player's previous claim

**request_text (item 6).** The shadow cuts each validated act's span from the ReaderInput tokens as an opaque
presentation string (`opaqueRequestTexts`); resolver and assembly carry it and never read it. Request identity is
canonical:
- a re-ask / repair re-opens the named request when its predicate matches (target + predicate), whatever the words;
- a duplicate is the same canonical question (predicate, item, place, subject, temporal) already answered by the
  chosen responder;
- staleness follows `ABANDON_AFTER_TURNS` without touching the ledger.

Production's ledger is not changed. Measured: `request_text` differs from legacy on 258 / 471 turns and is the only
difference on 193 of the 317 fully equivalent turns. Production's text-keyed identity (inventory G4) is the cause of 2
lifecycle mismatches.

**Player claim (item 4, ruling 3).**
- *Reader state:* after each validated reading, a primary statement act with a registry claim facet (ACCEPT, or
  REJECT_FIELDS without a facet rejection) is kept in seam memory as `{facet, polarity, subject_ids, request_id}`.
- *Canonical freshness:* the claim is `fresh` only while its line is the latest LOCAL player interaction and it
  opened no ledger request.
- *ReaderInput:* `conversation.player_claim = {label: "c1", facet, polarity, subject (labels), state}`; the binding
  stays with code.
- *Validation:* V1 `unknown_claim`; V3 `claim_antecedent_only_continues`, `claim_antecedent_not_eligible`,
  `claim_antecedent_not_askable`.
- *Resolution:* the resolver inherits the facet (`facet_source: player_claim`).
- *Persisted legacy clause predicates* (`dialogue-state.lastPlayerClaim`) are not read.
- *The legacy reader v0* now gives a statement its claim facet from its live reading of the clause.
- *Limitation:* seam memory does not survive a cold reload; after a reload `c1` is absent and the reading fails
  closed. Persisting reader state needs a dialogue-state schema change (Phase 2 or later, owner decision).

## 6. Comparator and results (`docs/acceptance/reader-phase1/shadow-diff.json`, pinned)

The comparator uses production as the authority and compares four levels. Every mismatch gets reason codes from
evidence-based cause rules (`dialogue-shadow-causes.js`). Each rule has a class, an evidence test and the fields it
may explain; nothing is bucketed by default.

**Dispositions (legacy reader v0 frames):**

| ACCEPT | CLARIFY | REJECT_FIELDS | INVALID |
| --- | --- | --- | --- |
| 422 | 37 | 12 | 0 |

**Equivalence (471 turns; `request_text` excluded):**

| Level | Equal | % |
| --- | --- | --- |
| A. ACT (speech act, facet, third-party subject, relation kind / target / reissue / reopen, temporal, repair) | 454 | 96.4 |
| B. ROUTING (addressees, responders, recipients, listeners, cardinality, silence) | 372 | 79.0 |
| C. LIFECYCLE (request intent / target / predicate / targets, abandons, activity, inbound) | 444 | 94.3 |
| D. FRAME (planner frame fields, entity binding, routing args) | 333 | 70.7 |
| all four | **317** | **67.3** |
| ACT and ROUTING | 368 | 78.1 |

The 154 non-equivalent turns by cause class (a turn may carry several):

| Classes | Turns |
| --- | --- |
| FENCED_RAW_TEXT | 68 |
| OWNER_APPROVED | 58 |
| FENCED_RAW_TEXT + OWNER_APPROVED | 7 |
| FENCED_LEGACY + FENCED_RAW_TEXT | 7 |
| FENCED_LEGACY | 5 |
| FENCED_RAW_TEXT + PENDING_OWNER | 5 |
| PENDING_OWNER | 2 |
| OWNER_APPROVED + PENDING_OWNER | 1 |
| FENCED_LEGACY + FENCED_RAW_TEXT + OWNER_APPROVED | 1 |
| UNCLASSIFIED | **0** |

**Classified divergence list (turns per cause):**

| Class | Cause | Turns |
| --- | --- | --- |
| OWNER_APPROVED | item 8: one clarifier, no inherited predicate / addressee / args (both sides clarify) | 51 |
| OWNER_APPROVED | ruling 1: group_inclusive, no group address | 10 |
| OWNER_APPROVED | ruling 2: marker-led line is new | 3 |
| OWNER_APPROVED | ruling 5: wh-led sarcasm fails closed | 1 |
| OWNER_APPROVED | decision #1: knower / rotation over legacy's first-eligible listener (item holder absent) | 2 |
| FENCED_RAW_TEXT | D1/D2: discourse function from the second reader (`interpretUtterance` / `buildSemanticFrame` LP.* regexes) | 26 |
| FENCED_RAW_TEXT | C11/C12: facet or temporal from fragment / item-role regex tables | 14 |
| FENCED_RAW_TEXT | D2 half B: entity from `resolveEntityMentions` over text, not a referent candidate | 12 |
| FENCED_RAW_TEXT | C14/C15: Tier-1 completeness / clarify-over-guess over the clause words | 9 |
| FENCED_RAW_TEXT | C5/C6: an answer keeps the raw-text address parse (no recipient) | 8 |
| FENCED_RAW_TEXT | C5/C6: `parseAddressees` / `inferLocalRecipientType` overlay set the recipients | 7 |
| FENCED_RAW_TEXT | D2: the frame builder's own clarification (antecedent / ambiguity regexes) | 6 |
| FENCED_RAW_TEXT | G6: `closes_activity` regex ("that's that") | 6 |
| FENCED_RAW_TEXT | D2/C1: legacy "player claim" acknowledgment by regex | 3 |
| FENCED_RAW_TEXT | G4: request identity by `request_text` | 2 |
| FENCED_RAW_TEXT | C7: `resolveRecipientScope` word-overlap inheritance | 2 |
| FENCED_RAW_TEXT | C4: address-correction overlay | 1 |
| FENCED_RAW_TEXT | C8/C10: `isFollowUp` / echo inheritance | 1 |
| FENCED_RAW_TEXT | D4: accepted Tier-2 advisory re-typed the act | 1 |
| FENCED_RAW_TEXT | B7: legacy salience from optional facts | 1 |
| FENCED_LEGACY | finalizeFrame's answer frame drops the answer option / reply kind | 7 |
| FENCED_LEGACY | legacy labels an elliptical continuation `wh` by default ("Tonya, have you?", "And Tonya?", "…Have you, Giselle?") | 3 |
| FENCED_LEGACY | own-answer repair acknowledged only because its address record is direct | 1 |
| FENCED_LEGACY | legacy decided a clarification with no owner to ask it | 1 |
| FENCED_LEGACY | a reply kind inherited with a repaired request's arguments | 1 |
| PENDING_OWNER | ruling C1 (not decided): V1 form check on follow-ups / echoes ("cargo?", "when was that" ×2, "who else", "Not today. Ever.") | 5 |
| PENDING_OWNER | ruling C1 (not decided): registry `question_forms` too strict ("Will all of us … or are we splitting up?", "Is Staging far?", "Are we leaving soon?") | 3 |

**PENDING_OWNER turns (8): the Phase-1 blockers.**
- Owner decision C1 decides them (see `READER_PHASE0_5_OWNER_RULINGS.md` §C1):
  - validator exemption of echoes and non-`new` relations from the question-form check;
  - metadata-only registry fixes: `choice` on `transition.participants`; `yes_no` on `mission.schedule`;
    `yes_no` on `mission.route`, or a distance facet.
- These are **proposed, not applied**. Until the owner decides, the shadow fails closed on these turns where
  production answered.

**Chip conflicts recorded (ruling 4):** 1 turn.

**Raw-text dependencies still preventing equivalence:** every FENCED_RAW_TEXT row above. None is migrated in Phase 1
(§9).

## 7. Gold resolver spec suite (`tests/fixtures/reader-phase1/gold-resolver-spec.jsonl`)

- **Size:** 36 items. The gold is doctrine / owner rulings, never legacy output.
- **State:** every prefix builds its canonical state through the real service and checkpoints verify it (requests,
  activity, anchors, inbound, active speaker, and the reader-state claim). Item-level checkpoints cover fresh
  conversations.
- **Result:** **36 / 36 = 100%**. 0 prefix_invalid, 0 incomplete_state_verification.

Coverage:
- address: explicit named question; untargeted shared question; group subject with no address; "and you";
  "who else"; "the rest of you"; repair target;
- continuation: prior-player-claim continuation, fresh and stale; activity round, named and remaining;
- inbound: yes/no; choice; person; item; uncertainty; refusal; counter-question;
- anchors and places: echo / surface anchor; deictic place with and without an antecedent; the inside default;
- time: temporal follow-up;
- dispositions: clarification (abstention); rejected routing field; invalid frame;
- silence: silence-valid remark;
- owner rulings: chip vs vocative (ruling 4); wh-led sarcasm (ruling 5); marker-led new (ruling 2);
- subject minimal pairs: third party addressed / untargeted, addressee, mention kept;
- lifecycle: duplicate request; unanswered re-ask in other words (canonical identity).

## 8. Inertness, provider independence, cold reload

`tools/dialogue-shadow-inertness.js` runs every characterized session twice, with the shadow OFF and ON, under every
provider the characterization uses (fallback, garbage, scripted advisory).

**Compared, deep:**
- the whole run: dialogue ledger, dialogue / interaction history, activities, inbound, anchors, knowledge,
  personnel continuity, trust / rapport, shared history incl. `geography_shared`, custody, progression;
- the world;
- every saved file, parsed.

**When:** at the end of the session, and again after a cold reload.

**Normalized** (nondeterministic, verified shadow-OFF vs shadow-OFF):
- ISO timestamps;
- epoch milliseconds;
- the random suffix of presentation event ids;
- derived SHA-256 digests (their content is compared directly);
- `*_ms` / `*latency` durations;
- the temp root.

**Result:** **426 / 426 sessions equal**, including 2 sessions with mid-session cold reloads (3 reloads). This is
also the provider-independence evidence for the shadow: nothing it computes reaches canonical state under any
provider. Deterministic replay and J16 provider independence remain in the full suite (§10).

## 9. Raw-text authority fence

**Phase 1's resolver owns dialogue-interpretation-derived routing, in the SHADOW only.**

**It does NOT yet own** (production raw-text authorities, unchanged):
- personnel-continuity keyword writes (B1–B3);
- `geography_shared` (B4);
- radio / order / mission text routers (B5, E1, E2, G2);
- report-delivery keyword classification (G1);
- canonical-knowledge player-claim propagation (G3);
- the `localIntent` / order channel (E1);
- the B-class writes.

The inventory adds sites G1–G6 (`READER_RAW_TEXT_INVENTORY.md` §G).

## 10. Verification and governance

- **Suites:**
  - `tests/ed32a-reader-phase1-shadow.test.js` (aggregate): the contract, fence, policy, fail closed, subject,
    rulings 2 / 4 / 5, claim, request_text, wiring, the gold suite, scenario inertness, the pinned artifact and the
    scenario replay;
  - `tests/ed32b-reader-phase1-shadow-full.test.js` (long-world): the full comparator replay and full inertness.
- **Pins:**
  - `SHADOW_DIFF_SHA256` in `ed32a`;
  - `ROUNDTRIP_SHA256` in `ed31a`: the round trip was regenerated because the adapter now applies rulings 2 / 3 and
    deixis, and the resolver consumes the verdict. It now measures **80.0% behaviour-equivalent / 26.1% exact**. It
    is a Phase-0.5 coarse measure, superseded by the comparator.
- **Governance:** `ed31a` hash updated; `ed32a` registered (aggregate) and `ed32b` registered (long-world) in
  `verification/verification-authority.json` and `test-manifest.json`, per `docs/VERIFICATION_GOVERNANCE.md` §6.
- **Reports (not authorities):** `legacy-adapter-coverage.json` regenerated (89.8% exact).
- **Full suite** (`node --test tests/*.test.js`): 1,514 tests, 1,435 pass, 79 fail.
  - Against `baseline-failing-tests.json`: unchanged 79, **new 0**, fixed 0.
  - `ed31b` and `ed32b` passed within the run.
  - J16 / provider-independence / transcript-replay tests are green.
  - Inventory: only the 57 pre-existing errors; none for `ed31` / `ed32`.
