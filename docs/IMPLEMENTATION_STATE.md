# Yellow Beast Implementation State

## ED-30 Compositional Conversation, Dialogue Information State & Personhood Convergence — 2026-09-26

- **Architecture: one turn pipeline.** Every LOCAL line now goes through the same staged pipeline, with the legacy frame builder kept as input:

  | Stage | Module | What it does |
  | --- | --- | --- |
  | Normalize | `tools/dialogue-normalize.js` | Repairs apostrophes, chat slang and common typos; closed-vocabulary name repair; "were" → "we're" decided by syntax. The raw line is preserved. |
  | Segment and acts | `tools/dialogue-acts.js` | Clauses, markers, politeness leads/tails, vocatives vs mentions, speech acts, indirect-question unwrapping, unpunctuated chat questions. |
  | Analyze | `tools/dialogue-turn.js` | Addressees, relation (repair / ellipsis / attention / answer), completeness gate, reconciliation with the legacy frame, `finalizeFrame`. |
  | Resolve | `tools/dialogue-resolvers.js` | Answers registry predicates from canonical state. |
  | Plan | existing planner | Builds the response plan. |
  | Validate | `tools/dialogue-claims.js` (H1–H5) plus the existing validators | Checks every candidate line. |
  | Commit | ledger (`tools/dialogue-state.js`) | Records what was answered. |

  - **Semantic Registry** (`tools/dialogue-registry.js`): one declarative table of predicates and facets. Parser, planner, validator, resolver and tests all read it; J14 proves that a new facet is data plus one resolver.
  - **Dialogue Information State** (`run.expedition.dialogue_state`): the request ledger, activities, repairs, acquaintance, and a bounded learning-hook log that holds references only.
  - **Personhood** (`tools/dialogue-personhood.js`, `data/worldpacks/clear-q4/personhood-constraints.json`): archetype-constrained profiles, self-state dimensions and history.
  - **C6 seams, defined but not built** (`tools/dialogue-agents.js`): speaker agenda (always empty), belief view, and a need/goal read that returns "not established".
- **Laws enforced in code.**
  - **Third-party state.** Another person's private state or history is only ever an attributed report of what was heard, with matching content and polarity, or "you'd have to ask them".
  - **Satisfaction.** A social reply never satisfies a question.
  - **Inverted and count questions.** Inverted questions ("Is this your first time?") and count questions are answered correctly.
  - **Tier 2 fills only real gaps.** The Tier-2 advisory (v2, constrained JSON schema) may fill only gaps that Tier 1 reports, and only from spans the player actually typed.
  - **Provider independence.** Tested by semantic digest across fallback, garbage, throwing, scripted and leaky providers.
- **Owner decisions made fail-closed and recorded for review:**
  - Veteran-doctor prior Complex/expedition experience: a generated "some" band, overridable in data.
  - Acquaintance is complete when every coworker has introduced themself, or when the player closes the round.
  - "There" defaults to the Complex only for experience questions, and only once the conversation has an anchor.
  - Coworker gender is not established. Lines use names or "they"; he/she for a coworker is rejected.
  - The wording for a place history the profile does not settle is "I couldn't say for sure."
- **Tooling:**
  - `npm run dialogue:repl` (the production service from a terminal);
  - `dialogue:replay` (JSONL transcript regression);
  - `dialogue:eval` (corpus scorer);
  - `dialogue:fuzz` (seeded invariant fuzzer);
  - developer-only `getDialogueTurnTrace` / `exportDialogueTranscript`.

  Docs: `docs/dialogue/TRANSCRIPT_REGRESSION.md` and `docs/decisions/ed30-dialogue-dependencies.md`. Added fast-check as a devDependency only. Neither NLP library was adopted: the bake-off numbers are in the decision record.
- **Tests:**
  - `tests/ed30a`–`ed30d`: J4 trace, stage goldens, J5 metamorphic (fast-check), J6 minimal pairs, J7/J8 matrices, J9–J11, J12 personhood, J13 fuzzer, J14 plug-in, J16 independence, J17 cold reload, M1 trace, I6 transcripts.
  - All findings from the independent reviews (A7) are pinned as tests.
  - Existing ed tests were updated only where they encoded the older plan shape: ed2, ed5, ed15, ed16, ed26, ed29.
- **Measured (ED-30 report has the full tables):**
  - **Dev corpus:** 143 items, 100% on every field.
  - **Held-out corpus** (338 items, SHA-256 e3a1e6f9…; blind-authored, measured twice as the brief allows).

    | Run | Speech act | Addressee | Predicate | Relation | Cardinality | Temporal | Question form | Clarify rate | Confident-wrong |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | Run 1 | 77.5 | 60.1 | 56.8 | 75.1 | 68.9 | 87.9 | 78.1 | 25.7 | 39.6 |
    | Run 2 (after class fixes on dev) | 93.5 | 64.2 | 83.1 | 86.4 | 78.4 | 94.4 | 81.4 | 12.7 | 35.5 |
    | Run 2, convention-mapped | 93.5 | 85.2 (92.9 incl. rotation-policy items) | 83.1 | 86.4 | 84.9 | 94.4 | 81.4 | 12.7 | 14.8 |

    Convention mapping means "untargeted" counted as "group" for an unaddressed room question, and "each_self_concise" counted as "each_self". **The L2 held-out gates are NOT met.**
  - **Metamorphic:** 1,752 single-transform variants plus fast-check composed transforms (seed 30005), 0 failures.
  - **Fuzz:** 3,000 turns across three providers, 0 invariant violations.
  - **Real model** (Gemma 4 E4B, pinned llama.cpp): five scripted sessions, 149 turns. 0 semantic mismatches against the reviewed deterministic run, 0 accepted private-state claims, 0 accepted nonresponsive lines, 0 dropped questions.
  - **Independent reviews:** two rounds. All blocking findings fixed and pinned.
  - **Full suite, per file:** 175 files, 1,419 tests, 1,342 pass, 77 fail. The baseline was 171 files, 1,361 tests, 1,284 pass, 77 fail, and the 77 failing tests are the identical pre-existing set. The verification inventory is back to its 57 pre-existing errors; ED-30 added none.
  - **Performance:** Tier 1 costs 0.21 / 0.35 ms (p50/p90). Per-turn persistence cost grows with conversation length because the whole save is cloned and hashed on every persist. This is pre-existing and flagged for a separate incremental-persistence pass.
- **Design decisions needed from the owner.** Each is recorded here and implemented fail-closed until decided.
  1. **Follow-up routing.** Untargeted follow-ups currently rotate to the least-recently-spoken knower (ED-29 fairness). The blind corpus author expected them to go to the person who just spoke, and 26 held-out items differ on this alone.
  2. **Acknowledging remarks.** Should ordinary remarks and sarcasm get one short acknowledgment (current behaviour) or silence (the blind author's reading)?
  3. **Veteran doctor's history.** The prior Complex/expedition experience band is currently "some".
  4. **"There".** Should "there" default to the Complex once the conversation has an anchor?
  5. **Coworker genders.** None are established; lines use names or "they".
- **Not in scope.** The known raw-media provenance failure was not touched. Dialogue is not declared frozen.

## Day-1 Canon Ratification + Knowledge Completion + Dialogue Convergence Pass — 2026-09-25

- **Owner decisions applied (this pass).**
  - The playable Maxwell briefing is ratified Day-1 authored canon. Its label changed from `legacy_unreconciled_briefing_material` to `ratified-day1-authored-canon`, under the mission record's own `cq4-day1-locked-design-law`, and the mission record now says so too.
  - Baseline induction and baseline field procedure were granted to every CQ4 Day-1 expedition member.
  - Also granted: the one-sentence ASYNC description, Maxwell's identity and authority, the startup-material semantics (destination is not purpose), and minimal definitions of verbal recall and the layout record.
  - Full record: `docs/dialogue/DAY1_KNOWLEDGE_MATRIX.md`.
- **Conflict recorded, not resolved (doctrine rule 3).** The crossing radio check's timing disagrees across sources.
  - After crossing: the owner's field-procedure wording and the runtime opener (`CROSS` → `STANDARD_RADIO_CHECK`, ≥ 2 s hold).
  - Before crossing: `mission.procedures[1-2]`, `reporting.check_ins[0]` and the undelivered `briefing_authority.threshold_sendoff`.
  - The sendoff is therefore not ratified, and no text was changed.
  - Not established anywhere: a green-tape return-marker procedure.
- **Knowledge (tools/canonical-knowledge.js).**
  - Provenance classes: `baseline_induction`, `baseline_field_procedure`, `briefing`, `self`, `observed`, `heard`, `remembered`, `own_speech`, plus attributed `player_claim`.
  - Grants carry a facet. Queries return `known`, `partial` (the asked facet is missing: `missing_requested_detail`) or an unknown with its internal class.
  - HEARD knowledge is general. It comes from the plan that authorized each line (the wording is never re-parsed) and reaches only that line's listeners. It keeps its reporting chain ("Daisy said Maxwell said"). It is merged as a `supports` entry when the listener already knows the fact.
  - Player claims are remembered and counted, and are never promoted.
  - Other additions: current vs historical custody, presence, where the team stands, and a current procedure recomputed from canonical state.
  - Briefing beats stamp `at_interval`; a partial briefing grants only the delivered beats.
- **Interpretation and planning.**
  - Identity, role, authority, relation and presence are distinct concepts. So are definition and current state, and so are the origin, mechanism, contents, destination, custody and history facets.
  - Reported speech: "What did Clint say…?", "Didn't Maxwell say noon?", "Who said…?", "What did I say…?", and one's own speech.
  - Current action and location purpose are recognized.
  - "That doctor" resolves only by event salience; otherwise the reply asks which doctor.
  - Address corrections ("No, I meant Brady.", "Not Daisy.", "The other one.") re-ask the question of the intended person and never change facts.
  - Self-introductions get one short acknowledgment from each teammate.
  - Untargeted shared questions go to the least-recently-spoken knower. This is derived from `dialogue_history`, so it is reload-stable, and knowledge always beats rotation.
- **Tier 2.**
  - Optional `addressee_text_span`: a verbatim span, resolved by code to a single present coworker. A subject mention or a duplicate name fails closed.
  - Optional `anchor_candidate`: a closed choice among the previous line's authorized facts.
  - Six new intents.
  - An accepted reading is the interpretation of the player's line, never knowledge.
- **Validator.**
  - Partial answers must state the unknown part, and a destination may never stand in for a purpose.
  - Reported speech must be attributed.
  - Player claims are never affirmed.
  - Rejected outright: the non-canonical terms "portal", "gate device" and "the backrooms"; social acknowledgments that claim experience; unlicensed schedule or deployment terms and perception claims; and a speaker addressing themselves by name (seen in the real Gemma run).
- **Fallback.** Quotation is safe: one outer pair of double quotes, no doubled terminal punctuation.
- **Tests.**
  - New `tests/ed29-day1-knowledge-convergence.test.js`.
  - ed1, ed4, ed22 and ed28 were updated where they encoded the pre-ratification policy or the older plan shape. Each update is justified in the pass report.
  - ed27, ed28 and ed29 were registered in the verification inventory through the documented mechanism (new entries only).
- **Tier 2 latency.**
  - The static intent menu moved into the system prefix, so the runtime's prefix cache reuses it. The model is asked for compact one-line JSON.
  - Warm advisory calls: median 1.86 s, p90 2.28 s (12-line benchmark on real Gemma 4 E4B), down from 3.48 s / 4.27 s. The first call after a cache miss takes about 3.0 s.
  - At most one advisory call per player turn, and none when Tier 1 typed the line.
- **Real model.**
  - Gemma 4 E4B ran the owner's 20-turn sequence plus 12 natural variants through the production service.
  - The deterministic semantics differ only where advisory interpretation is allowed to change understanding (V2 and the resulting spokesperson rotation).
  - Two real-model wording defects were fixed as validator rules and are covered by ed29 regressions: self-address by name, and moving earlier custody onto the speaker.
- **Not in scope.** The known raw-media provenance failure in CI `validate` (`desktop/assets/audio/*.mp3`) is a separate governance issue and was not touched.

## Semantic Interpretation + Canonical Knowledge Convergence Pass — 2026-09-25

- **Evidence**: Jack's unscripted Electron run.
  - Paraphrases fell to generic `ask_factual` with uncertainty ("What do we actually do around here?", "what is your specific job, then, daisy?", "Where are we supposed to go next?", "Who is that Kirk guy anyway?").
  - The no-comma vocative "Brady tell me…" was room speech.
  - A follow-up on Clint's line went to Daisy.
  - "What recording?" had no antecedent.
  - Self-state answers leaked assignments ("Just compiling the layout record.").
  - A social statement produced a help-desk question.
- **Diagnosis**: interpretation depended on narrow phrases; coworkers held no granted knowledge at all (the delivered briefing reached no one); the validator treated knowable facts as sayable; and questions were checked only for listed functions.
- **Knowledge (source-backed, compartmentalized)**:
  - `tools/canonical-knowledge.js` projects each actor's grants from canonical state only: self, briefing beats they were present for, observed attendance, heard self-descriptions.
  - Each grant carries its authority class, source, basis, epistemic mode and scope.
  - The briefing now stamps `beat_key` + `listeners` on every delivered line (`tools/cq4-day1-opener.js`).
  - Definitions granted on mention are removed from reply context unless granted. The Threshold, Standard and the Complex are canon not yet granted to Day-1 coworkers, so the answer is a truthful "not told".
  - In the opener, custody without observation is known only where the roster call stated it.
  - Matrix and authority classes: `docs/dialogue/DAY1_KNOWLEDGE_MATRIX.md`.
- **Interpretation**:
  - Tier 1 recognizes question TYPES structurally over semantic classes: role, institution purpose, mission objective, next step, person identity, assignment purpose, entity definition. The entity is resolved by code against a canonical index that includes non-present entities; reference needs no presence, knowledge does.
  - No-comma vocatives are recognized.
  - Tier 2 (`tools/dialogue-advisory-interpreter.js`) runs one bounded advisory reading per player turn, and only when Tier 1 left the line generic. It returns a strict allowlisted schema (intent, referent span, confidence), is validated (spans must be the player's own words; confidence ≥ 0.6), uses the same pinned local model, and is persisted on the interaction (never re-requested on reload).
  - Without accepted advice, a generic question naming a canonical entity is clarified (doctrine 7.26); it never becomes "I don't know".
- **Threads/anchors**:
  - A question about a term the previous speaker's AUTHORIZED facts introduced stays with that speaker.
  - "What recording?" resolves to the fact that licensed the line (task aliases are language, not facts).
- **Output ceiling**:
  - Every operational term and every first-person activity claim in a candidate must be licensed by that turn's plan or by the player's words.
  - Any question without a clarification plan is rejected, with or without "?".
  - The capsule offers the speaker's assignment only on turns that authorize it. On real Gemma, operational volunteering on social turns fell from 4/8 to 0/8.
- **Drift fixed**: the `verbal-recall` phrase is now "handling observation and verbal recall", per the authored roster call.
- **Harnesses**: the ed test setups now deliver every briefing beat before concluding, as the Electron flow does.
- **Verification**:
  - `tests/ed28-semantic-knowledge.test.js` 10/10. ed1–ed27 pass; ed16, ed22 and ed27 expectations were updated to the sourced rules.
  - Real Gemma 4 E4B and fallback-only share semantic digest `029dd3fae2fa6a9b` on the 17-turn human sequence.
  - Advisory: 7/7 accepted on generic paraphrases, about 2.7 s each.

## Conversational Pragmatics Convergence Pass — 2026-09-24

- **Evidence**: Jack's human Electron trace on HEAD `7459f35`. Five failures, all in deterministic pragmatics; provider, presentation and Ava's own reply path worked.
  - A quoted phrase of Elizabeth's line ("staying with") was planned as an unknown fact.
  - "Hello Ava and Josephine" addressed nobody.
  - After a direct exchange with Ava, "Why wouldn't you say anything…" went to someone else.
  - That question was treated as a generic factual question.
  - "just now, when I said hello ava and josephine…" dropped the open "when do you mean?".
- **Root causes**:
  - The address parser knew one leading vocative only; greeting+name, name lists and trailing vocatives were untargeted.
  - Scope inheritance covered only reflexes ("What?").
  - Open questions carried no expected answer shape, so only item names or repair phrases resumed them.
  - No discourse function referred to earlier wording or to conversational events.
  - Bare group nouns ("table", "all", "team") counted as group address anywhere.
- **Fixed (general mechanisms)**:
  - **Addressee sets.** `parseAddressees` resolves direct, subset and group address from sentence structure: leading vocatives, greetings, trailing vocatives and @mentions. A mentioned name is not an address. The interaction record carries a canonical `address` (`scope`, `addressee_ids`, `form`, `source`, `utterance`). A named set is answered only by its members: greetings and individual questions (including readiness) by each, shared facts by one spokesperson.
  - **Active thread.** `resolveRecipientScope` applies, in order: explicit address or group language, then an answer to an open question (goes to its asker), then reflexes, discourse-dependent lines and second-person lines (continue the preceding direct/subset/group exchange), then room speech. A report, a location change or staleness ends the thread. It is derived from persisted history, so it survives a cold reload.
  - **Earlier wording.** `ask_meaning` resolves quotations and prior lines, in order: exact quote, named speaker, addressee, latest line. Only lines the player heard or said are searched. A quoted span maps onto the authorized fact the line was planned with (receipt plan facts plus structured `fact_semantics`). Several matching facts are clarified; none means the words were only wording, so the line's basis answers. Another person's line is referred back to them, and only a responder who heard that line receives its text.
  - **Open questions as typed slots.** The plan records `expected_slot` (`temporal`, `location`, `spatial_selection`, `referent`, `person`, `reason`, `yes_no`, `topic`). The value is persisted in the receipt basis. `matchOpenQuestionSlot` reads a fragment as the answer before any fresh interpretation:
    - Temporal answers are anchored canonically and resume the question.
    - Location answers replace the unresolved place.
    - Reason answers are recorded as a `player_claim`.
  - **Conversational events and silence.** The derived event log (12 exchanges) records address, listeners, owners, responders and a per-listener SIMULATION silence basis: `not_a_listener`, `response_policy_selected_other`, `not_selected_no_response`, `room_speech_no_response` or `reply_not_delivered` (the last is a failure, not canonical silence). `ask_response_event` resolves the exchange named (event descriptions, quotes, "until I addressed you directly") or the responder's latest unanswered one. Speech gets only a character-knowable reason: `did_not_hear`, `another_answered` or none. Motives, excuses and false "I did answer" are rejected. Talk about the conversation is never itself a candidate event.
  - **Assignment semantics (Part 7).** The canonical source was underdefined, not Gemma: the team runtime's default posture (`follow` the lead, intent "maintain team contact", no order) was presented as the current assignment, "staying with the expedition lead". That hid the archetype's `primary_task` and read as lodging. Now an ordered task wins, then the assigned task, then the default posture. Follow is worded "following you" / "following <name>", with a gloss from the canonical intent. Lodging readings are rejected.
  - **Trace.** `[YB:DISCOURSE_TRACE].pragmatics` shows explicit and inherited addressees, the active thread, the open question and slot, the slot answer, the prior utterance and quoted span, the conversational event, and per-plan basis, slot and silence basis. `[YB:COMMIT_TRACE]` adds the open question's slot and the thread.
  - **Validator.** Silence motives, lodging readings and interpreting someone else's words are rejected. So are invented activities in greetings and bare statements, re-clarifying an answered clarification, and activity reports inside a clarification. "Where are you referring to?" counts as a clarification.
  - **Renderer.** The LOCAL rail shows "→ Ava, Josephine" for a named set, not "→ Assembly Table".
- **Verification**:
  - `tests/ed27-conversational-pragmatics.test.js` passes 15/15, covering A–L, silence semantics and the trace.
  - ed1–ed26 all pass. ed16 was updated for the corrected assignment phrase.
  - Full per-file run (all 174 test files, this tree vs an untouched HEAD snapshot): 1244 pass / 80 fail vs 1229 / 80. The +15 are ed27; no test newly fails. `validate-assets` fails identically in both trees at the known raw-media provenance assertion.
  - Real models: on the production path, Gemma 4 E4B and fallback-only share semantic digest `0c5f3d6963f44386` over the ed27 L sequence. In the human sequence Gemma worded 10 of 18 lines; every rejection was a real violation (invented motives for silence, counter-questions, invented activities).
- **Not changed**: the raw-media provenance `validate` rule. ed27 is unregistered in the protected verification authority, like ed1–ed26.

## Human-Conversation Semantics Convergence Pass — 2026-09-24

- **Starting point**: HEAD `256a0d7`, which already fixed Jack's reproduction; that reproduction ran on the code before it. A fresh trace of the current production path found the remaining gaps below.
- **Fixed (deterministic; no new model authority)**:
  - **False recall.** Listeners who merely heard a line recalled it as their own reply ("I replied: …" from three people). `resolveKnownAnswer` now uses only the worker's own recorded replies.
  - **Unspecific narrowing.** "You know the thing by the thing?" → "I mean the camera." now resumes as a question about the named item. Spatial and temporal fragments ("By the table.", "After the briefing.") also narrow an open clarification.
  - **Explanations.** "What are you basing that on?", "What do you mean by that?", "Why not?" and bare "Where?"/"When?" are explanation requests on the prior line. An explanation may voice only its recorded basis; the validator rejects a different basis, invented reasons, and history of either polarity.
  - **Topic stack.** Discourse markers ("Anyway, …") no longer block classification. A derived topic stack in `deriveDiscourseState` supports "back to what we were talking about" and survives a cold reload.
  - **Group policy.** Everyone answers group greetings and group questions whose answer is individual (own feelings, experience, opinion, role, including "any/each of you"). One spokesperson answers shared facts and procedure. One listener answers untargeted remarks and requests. Only the addressee answers a direct question.
  - **Kinds of not-knowing.** The plan now distinguishes `did_not_perceive`, `not_told`, `no_established_personal_history`, `no_established_opinion`, `procedure_not_known`, `no_established_fact`, `referent_unclear` and `time_unclear`. The model words the kind; it never picks it. The new `ask_opinion` answers only from canonical opinion, currently always "no view yet".
  - **Temporal references.** Maxwell's departure is recorded canonically (`personnel_briefing.concluded_at_interval`). "When you said that" anchors to the prior exchange and "today"/"for the day" to the operation. Future events ("when we get back") and unrecorded anchors are clarified.
  - **Requested actions.** A request produces structured intent `{action, object, recipient, actor_id, status: not_executed, reason: no_action_authority}` on the canonical interaction record, internal and not projected. Nothing executes. Wording may not accept the request or report it done.
  - **Spatial selections.** `resolveSpatialReferenceSelection` checks a renderer selection against canonical spatial state (observer placement, perceivable entity, anchor, relation target, candidate set, staleness). The service now validates selections before they resolve deixis; previously it trusted them.
  - **Stale explanations.** A custody explanation registers that custody as whole-turn commit-sensitive.
  - **Traces.** `[YB:COMMIT_TRACE]` adds event ids, provider, per-line source, basis, estimated prompt tokens, validator reason, revalidation and the discourse state after the turn. `[YB:SPATIAL_TRACE]` records rejected selections.
  - **Validator.** Typographic apostrophes are normalized (Qwen's "We’ll" bypassed rules). A bare "On it" no longer false-matches inside "opinion on it". Sarcasm answered with agreement plus a world fact is rejected. Own perception is "didn't notice", never "I don't know".
  - **Presentation.** Model-worded communication turns carried the committed "Name: line" as result narration, which `renderer.js` played into `#interaction-feedback` outside the LOCAL transcript. That is the stray "Sydney: I don't know." line. Communication turns that committed dialogue no longer echo it.
- **Verification**:
  - `tests/ed26-conversation-semantics.test.js` passes 15/15: stateful branching, bounded properties, provider independence (fallback, malformed, throwing, wording), cold reload, stale state, temporal, uncertainty, action and spatial contracts, trace, sequences A–F, real-model findings and presentation.
  - Full per-file run: 1229 pass / 80 fail across 33 files. Every failure is identical on the audit base, so nothing is newly failing.
  - Real models on the production path: fallback-only, Gemma 4 E4B and Qwen3-4B share semantic digest `0c6582df6118f576` over 17 turns.
- **Not changed**: the raw-media provenance `validate` rule (owner decision; no media or policy edits). The ed24–ed26 suites are unregistered in the protected verification authority, like ed1–ed23.

## Human-Acceptance Dialogue Reproduction Repair — 2026-09-24

- **Evidence**: Jack's first natural Electron conversation after the freeze audit, with developer traces from `~/Library/Application Support/Electron/yellow-beast/logs/desktop.log`. In that run Gemma produced exactly what each plan authorized and the validator accepted it, so every defect was in deterministic planning.
- **Fixed (general mechanisms, no phrase special-casing)**:
  - **Questions about a listener's own feeling** ("Are you all excited?", "Nervous?", "You seem tense, everything alright?") are now `check_in` with a `self_state_query`. The plan adds `self_state_answer`, the stance canonical affect gives. An ordinary state is "not especially", never "I don't know". Invented affect and self-access denial are rejected.
  - **"Why?" / "What makes you say that?" / "How come?"** is now `ask_explanation`. The reason is the recorded basis of the speaker's own previous line, reconstructed via `responseBasisFromPlan` from that turn's persisted communication receipt; it survives a cold reload. Invented rationale is rejected.
  - **"What's next?"** is now `ask_next_step`. It is answered from canonical authority only: the concluded briefing, the `LOCAL_INTRODUCTIONS` beat, the speaker's location, and the room's `known_destination` in the canon lexicon. With no such authority it is clarified. UI text is never consulted.
  - **Repair fragments** ("I mean for the day", "No, the other one") now narrow the open clarification, or the player's just-answered question when explicitly self-repaired, by re-framing it. An unresolved repair clarifies again.
  - **Group policy**: everyone answers a group greeting and a group question about their own feelings. One speaker answers shared-knowledge or task questions. One answers untargeted remarks. Only the addressee answers a direct question.
  - **Dev traces**: with `YELLOW_BEAST_DEVELOPER_MODE=1` the `[YB:...]` traces also go to the terminal. They now carry the request id, listeners, the antecedent's recorded basis, and a `[YB:COMMIT_TRACE]`.
- **Verification**:
  - `tests/ed25-human-acceptance-dialogue.test.js`: 11/11.
  - Full per-file run: 1214 pass / 80 fail across 33 files. Every failing test fails identically on the audit base, so nothing is newly failing.
  - The real pinned model (Gemma 4 E4B) is semantically correct on the exact human sequence and on the generalization cases.
- **Not changed**: the turn-feedback strip renders `result.public_reason` (a "Speaker: line" string) when a result has no `scene.narration`. That is the likely source of the one-off stray "Sydney: I don't know." line. It is not reproduced, so presentation is unchanged.

## Final Dialogue Engine Audit, Model Ascension & Freeze-Readiness Pass — 2026-09-24

- **Source truth**: branch `opener-human-green-2026-09-19`; audit base `1c3d106`. CI repairs landed separately during the pass (`800c77d`, `63e1d40`, `df6d107`, `acde934`, `446d044`). Scope: the LOCAL dialogue engine only. The facility map, Maxwell briefing, equipment staging, threshold flow, audio, UI styling, cinematics and Godot were not changed.
- **Authority (now enforced end to end)**: interpretation → semantic frame → response owners → response plan → authorized contribution → observer-safe capsule → model *or* same-plan fallback → validation → pre-commit revalidation → commit → persist. The provider receives only the rendered capsule and contribution, under a compact system prompt, and must return `{"speech": ...}` through a JSON schema. The service fails closed (`DIALOGUE_PLAN_REQUIRED`) for any packet without a contribution and capsule, including autonomous reports.
- **Proven defects fixed**:
  - Custody answers are fail-closed: a holder is stated only when that listener's knowledge authority grants it.
  - Check-ins and remarks about the speaker come from canonical self-state (`describeSelfState`). Affect moves only through sourced `applyAffectEvent`, and reading emotional state no longer writes it.
  - Anaphora, fragment resumption of an open question, and noun-aware clarification are handled. Spatial deixis needs a canonical selection (`tools/spatial-event-contract.js`). Temporal references resolve against recorded anchors (briefing, crossing) or are clarified.
  - Requests and orders are heard, never accepted. `request_disposition` records `order_routing: not_routed`.
  - Map knowledge no longer transfers on keywords like "where" or "route", and a disclosure requires the first person.
  - Pre-commit revalidation also covers fallback text, and all-fallback public reasons are built from committed lines.
  - Validator holes closed: invented directives, situation assessments, duties, rationale, history, custody outside the plan, request acceptance, "you" as a vocative, and the PLAYER label in any case or as a name.
  - Runtime:
    - `--cache-ram 0`: the default 8 GiB host prompt cache inflated the footprint.
    - `--ctx-size 4096`.
    - Stale daemons are reaped.
    - Crash-while-ready triggers an immediate respawn on the verified install.
    - A healthy daemon is never killed for a request-level failure, and the pool's stale local cooldown clears once the supervisor is ready.
    - Unrecoverable restarts are bounded at 3.
- **Prompt**: mean prompt tokens fell from 1274 to 621 (real tokenizer). Completion tokens fell from 42 to 16 on the 4B, and nothing hits the generation ceiling.
- **Model ascension**: memory budget ≤ 6.0 GB peak RSS for the dialogue server on a 16 GB machine. Production path, ctx 4096, 6 samples, 168 generations each:

  | Model | Accept | Invented | Peak RSS | Latency mean / p90 | Group turn |
  |---|---|---|---|---|---|
  | Qwen3-4B | 66.1% | 15 | 3.18 GB | 1.86 / 2.23 s | 5.9 s |
  | Gemma 4 E4B | 82.7% | 5 | 5.17 GB | 2.63 / 3.35 s | 8.4 s |
  | Qwen3-8B | 78.6% | 9 | 5.59 GB | 3.28 / 4.03 s | 10.2 s |

  - Qwen3.5-9B was worse (63.1% accept, 10 inventions).
  - Qwen3-14B fails both budget and latency (6.2 s per line, 18.6 s groups).
  - **Selected: Gemma 4 E4B Q4_K_M** (Apache-2.0; `tools/local-runtime-pin.json`, `docs/licenses/Gemma-4-Apache-2.0.txt`).
  - Wording stays serial (`DIALOGUE_WORDING_CONCURRENCY = 1`): parallel slots halve tokens/s, and the group-turn gain did not justify the contention.
  - Final confirmation on the final code: Gemma 4 E4B at 82.7% accept, 4 inventions, 0 echo, 0 malformed, peak RSS 5.37 GB, latency 2.54 / 3.27 s, group turn 8.1 s, no ceiling hits, 12/12 autonomous reports model-worded. On the 21-turn human-like sequence, 18 of 21 turns were model-worded; every rejection was a real violation (a counter-question, a situation assessment, a same-turn duplicate opening).
- **Freeze invariant (real models)**: fallback-only, Gemma 4 E4B and Qwen3-4B produce the identical canonical-semantics digest over a 15-turn production sequence. This covers the dialogue records, interactions, plans, knowledge, custody, attitudes, memories, affect, survey state and speech queue.
- **Crash recovery** (SIGKILL of the live daemon; time to the first model candidate): 38.5 s, 8 respawns and 27 fallback turns before; 5.6 s, 1 respawn and 2 fallback turns after. No orphan server either way.
- **Verification**: Every `tests/*.test.js` file was run in this tree and in the untouched audit-base snapshot. Now: 1203 pass / 80 fail across 33 files. Baseline: 1172 / 81 across 34 files. **No test newly fails**, `tests/ed24-freeze-invariants.test.js` passes 30/30, and one baseline failure (y57 Electron settings) now passes. The focused dialogue/runtime suites (ed1-ed24, y102, y108-y111, y166-y174, y97, y76, y78) show zero new failures. `node --check` and `git diff --check` are clean. `npm test` cannot run its aggregate while the inventory is inconsistent: the runner short-circuits and then crashes while formatting. It behaves identically at the audit base. The inventory has 53 errors versus 51 at baseline; the only additions are ed24 lacking a manifest entry and required-test authority, the same state as ed1-ed23. The renderer smoke (`--reference-expedition`) passes locally. `npm run desktop:build` produced a 5.16 GB arm64 zip with Gemma staged and its SHA matching the pin. `npm run desktop:verify` then passed the offline smoke, the packaged renderer interaction, and the packaged runtime: READY on loopback on a 16 GiB machine, model matching the pin, 0 orphan processes. One earlier verify run hit a one-off blank renderer during the renderer smoke and did not reproduce on the same build. On hardware below the on-device floor (the 7 GB GitHub macOS runner), the runtime smoke now reports `hardware-below-floor` instead of claiming READY.
- **Known, not changed (owner decisions or pre-existing)**:
  - The CI `validate` raw-media provenance assertion (~35 runtime media without provenance records).
  - The verification inventory was already inconsistent before this pass (protected-hash and manifest entries for the ed*/y166+ suites).
  - Packaged size: the model alone is 4.98 GB, well above GitHub's 2 GiB release-asset limit, so a distribution channel is an owner decision.
  - The `--day1-opener` renderer smoke (not run in CI) stops at the facility-broadcast presentation. Before the settings-v8 fix it failed even earlier.
  - Pre-existing test failures are unchanged by this pass: 80 tests across 33 files, all failing with identical names on the audit base. In the dialogue and runtime area they are y73 (26), y36 (2), y37 (1), y108 (1, audio high-pass), y97 (1, pool candidates), y76 (1, hosted interpretation), y78 (2; the test reads a Promise synchronously, and its semantics pass when awaited). The same failing test names appear on the audit base.

## Assembly Table LOCAL Dialogue Presentation & Group Response Pass — 2026-09-21

- Normal Assembly Table dialogue remains in the right-side communications rail; the center column remains map/reconstruction space, apart from the existing authored Maxwell presentation.
- The player-facing `@table` group route was removed. Natural-language interpretation now classifies obvious group greetings and questions while preserving direct coworker selection as an optional explicit address.
- Deterministic dialogue policy now owns ordered `response_owners[]`: greetings and social check-ins can receive all-present replies, established-knowledge questions select only knowledgeable coworkers, warnings can be heard without forcing replies, and ambiguous group speech selects one clarification owner.
- Untargeted LOCAL speech now has a beat-scoped deterministic response policy: social remarks may receive a bounded reaction, arbitrary statements may receive none, and silence still commits no dialogue events.
- Multi-responder turns commit the player event first and each responder event afterward in deterministic order. Presentation consumes that same committed order. Model generation remains wordsmith-only and runs once per authorized responder.
- Development-only traces record the provider, deterministic responder order, sanitized wordsmith inputs, raw candidates, fallback/model decisions, and committed event IDs without exposing those details in the player-facing UI.
- Focused verification: dialogue policy/runtime plus the existing living-world LOCAL regression (`y78`, `y109`, `y110`, `y111`) passed 59/59. Authoritative `npm test` passed 839/839 with inventory consistency and all required reports green.

## Beat 2.4 Reusable Dialogue Runtime & LOCAL Coworker Proof — 2026-09-20

- **Source Truth**:
  - Branch: `opener-human-green-2026-09-19`
  - Base Commit: `9161525b3bad83f69afdc0c0238783915b0e6b11`
  - Status: Working tree modifications preserved, uncommitted, strictly scoped to dialogue runtime completion and proof.
- **Corrected Roadmap Readiness Assessment**:
  - **LOCAL vs STANDARD Channels**: **READY**. Channel separation enforced across simulation and presentation. LOCAL uses acoustic room propagation with distance limits and recipient targeting; STANDARD uses radio transceivers with acknowledgment states and battery consumption.
  - **Dialogue Transcript & History**: **READY**. Unified chronological `dialogue_history` backed by presentation bus envelopes, surviving cold boot restoration and renderer remounts without duplication.
  - **Interruptions, Sequencing & Pacing**: **READY**. Progressive typewriter delivery (`YBDialoguePlayer`) supports instant skip-to-complete on first user action without advancing beats; canonical simulation state commits synchronously before UI typing timers.
  - **Dialogue Persistence**: **READY**. Canonical dialogue events stored in `run.expedition.dialogue_history` survive full serialize-to-disk and deserialize cold restarts.
  - **Multi-Character Conversations**: **READY for Deterministic Local Targeting** (Direct, Group, and Untargeted routing verified across 3 table coworkers); **PARTIALLY READY for Autonomous Multi-Turn Unscripted Exchanges** (requires local LLM routing for unscripted emergent peer conversations).
  - **Natural-Language Input & Free-form Queries**: **PARTIALLY READY**. Fully wired and verified for Dr. Kirk Maxwell briefing and deterministic coworker targeting; model-assisted routing for unscripted queries verified with fail-safe fallback, awaiting full local appliance deployment.
- **Dialogue Runtime & Targeting Semantics**:
  - **Direct Address**: Only the addressed coworker responds; other coworkers hear acoustically if in range, but never become primary responders.
  - **Group Address (`@table` / `@team`)**: Addressed to the group; designated spokesperson/equipment holder responds on behalf of the group; all present peers hear.
  - **Untargeted Room Speech**: Spoken aloud to the room (`recipient_type = "none"`); all peers hear acoustically, but nobody answers (`"You speak aloud to the room. Nobody at the table responds."`). Creates exactly one dialogue event (player only).
  - **Silence Path**: Player can proceed to Equipment Staging without speaking; creates exactly zero dialogue events.
  - **Validation & Boundary Guards**: Physically absent targets (`LOCAL_TARGET_UNAVAILABLE`), unknown targets (`TARGET_NOT_FOUND`), channel mismatches (`INTRO_CHANNEL_UNAVAILABLE`), and empty/whitespace inputs (`COMMUNICATION_EMPTY`) fail closed without emitting dialogue events.
  - **Fail-Safe Fallback**: Faulty or malformed model candidates fail validation and fall back to deterministic response without corrupting simulation state.
- **Verification Evidence**:
  - Unit test suite: `tests/y109-local-coworker-dialogue-runtime.test.js` (12/12 passing).
  - Repair suite: `tests/y108-beat-2-4-convergence-repair.test.js` (11/11 passing).
  - Verification Gate: `tests/y68-verification-gate.test.js` (32/32 passing).
  - Authoritative Aggregate: `npm test` (800/800 passing, all reports passing, inventory 100% consistent).
  - Native Packaged Verification: `desktop:verify`, `desktop:settings-regression`, `desktop:first-run-regression` all passing cleanly.
  - Live Electron Automated Traversal: `node tools/run-visual-traversal.js` passed, capturing 21 screenshots covering title, video, waiver, AEOT boot, facility schematic, briefing inquiry/skip, and all 5 LOCAL dialogue targeting scenarios plus staging boundary.

## Beat 2.4 Pre-Commit Authority Cleanup & Dialogue Architecture Convergence — 2026-09-20

- **Pre-Commit Authority Cleanup**:
  - **Player-Facing Room Label Neutralization (`desktop/renderer/surfaces.js`, `desktop/renderer/renderer.js`, `tools/cq4-day1-opener.js`)**:
    - Purged invented room designations `ASYNC Briefing Room`, `Briefing Room`, `Lower Briefing Room`, and `KV31 Lower Briefing Room` from all player-facing UI, dialogue headers, and map annotations.
    - Standardized player-facing location headers to neutral physical designations: `ASYNC FACILITY // LOWER LEVEL` (eyebrow) and `Assembly Table` (header). Unlabelled briefing spaces render strictly as geometry (`Controlled Facility Space`).
  - **Paper Audio Foley Purge (`desktop/renderer/audio.js`, `desktop/assets/audio/Interface/`)**:
    - Completely deleted procedural/synthesized paper rustle WAV files (`Paper_Sheet_Enter.wav`, `Paper_Sheet_Exit.wav`) and directory.
    - Procedural fallback for `paper_sheet_enter` and `paper_sheet_exit` executes as an explicit silent no-op. Paper transitions remain silent until authentic recorded foley exists.
  - **Validation Terminology Discipline**:
    - Corrected all automated validation logs and status keys from "human-observed" to "live Electron automated traversal" / "rendered Electron traversal".
    - Reserved human sensory validation exclusively for Jack's manual playthrough.

- **Priority 1 — Facility Map Blueprint Authority Convergence (`desktop/renderer/surfaces.js`, `desktop/renderer/renderer.js`, `tools/cq4-day1-opener.js`)**:
  - Reconciled facility schematic strictly against `/Users/jacktr/Pictures/Screenshots/ASYNC Facility.png` (`Top-down geometry extracted from gm_br_complex • fan reconstruction by schlimbodimblo`):
    - Blueprint is the sole authority for room designations. Corridors and unlabelled briefing spaces render strictly as geometry without invented functional labels or subtitles.
    - Lower Level: Briefing table area and circulation corridor render as pure geometry with `name: ""` and `subtitle: ""` (fallback to neutral `Controlled Facility Space`). Blueprint-exact rooms: `Threshold Chamber` (#1), `Dressing Room` (#2), `Freight Lift` (#9), `Lift` (#10).
    - Middle Level: `Control Room` (#1), `Conference Room` (#2), `Relay Room` (#3/#4), `Medical Lab` (#5/#6), `Freight Lift` (#9), `Lift` (#8). Purged invented prefixes `KV31` and `Telemetry`. All functional subtitles removed.
    - Upper Level: `Server Room` (#1), `Restrooms` (#2/#3), `Maintenance Access` (#4), `Freight Lift` (#5), `Lift` (#6). Purged ungrounded invention `Administrative Offices`. All functional subtitles removed.
    - Upper Section: `Auditorium` (#1), `Lounge Access` (#2), `Lift`. Purged ungrounded invention `Mechanical & Roof Access`. All functional subtitles removed.
  - Fixed Facility Floor Tab Inspection:
    - Scoped floor tab click listener from `[data-facility-floor]` down to `button.facility-floor-button, g.facility-floor-tab` with `e.stopPropagation()`, preventing click events from bubbling up to `<details class="operational-map" data-facility-floor="lower">` and resetting the active floor back to `"lower"`.
    - Passed `options` into `layoutMap(projection, null, options)` across `briefingWorkstation`, `expeditionCockpit`, and prefield layouts so `inspectedFacilityFloor` correctly switches rendered floor layers.

- **Priority 2 & 3 — Progressive Dialogue Player & Dialogue Architecture Audit (`desktop/renderer/dialogue-player.js`, `desktop/renderer/renderer.js`, `desktop/renderer/styles.css`, `tools/presentation-bus.js`)**:
  - Dialogue Architecture Inventory:
    - Formalized canonical dialogue data contract `createDialogueEvent({ channel, speaker, recipient, text, mode, ... })` exported via `tools/presentation-bus.js`.
    - Maintained strict unidirectional authority flow: `CQ4 / World Engine (Canonical Authority)` → `presentationBus / Projection (Observer Boundary)` → `YBDialoguePlayer (Progressive Presentation)`.
  - Reusable `YBDialoguePlayer` supporting progressive letter-by-letter rendering tuned to conversational pace:
    - Base character delay: ~36ms.
    - Punctuation breaths: commas/colons 130ms, em/en dashes 180ms, sentence-ending periods/exclamations/questions 260ms, newlines 200ms.
    - Skip-on-first-action semantics: clicking "CONTINUE LISTENING", clicking turn container, or pressing Space/Enter/Escape while typing immediately snaps the current beat to complete text without advancing the simulation beat. Subsequent action advances to the next beat.
    - Safe detached DOM check (`element.isConnected === false`) cancels ticker and prevents memory leaks if the container unmounts mid-speech.
    - Fast-forward / reduced-motion bypass: instant reveal when `__YB_TEST_FAST_BOOT__`, `__YB_TEST_FAST_FADE__`, `__YB_TEST_FAST_DIALOGUE__`, or `(prefers-reduced-motion: reduce)` is active.
    - Suppressed false-positive failure banner: `renderMessage` in `renderer.js` avoids emitting `"That attempt could not be resolved."` on successful in-scene dialogue queries (`detail.outcome === "briefing-interacted"`).
    - Responsive briefing layout: `.eti-turn-controls > .briefing-action-dock` uses responsive flexbox with wrap, and `.in-person-briefing` / `.briefing-transcript` use `flex: 1 1 auto; min-height: 0;` with subtle blinking caret (`▮`), eliminating text clipping at 1024x768.

- **Priority 4 — LOCAL Introductions UX Audit & Repair (`desktop/renderer/surfaces.js`, `desktop/renderer/renderer.js`, `desktop/renderer/styles.css`)**:
  - Coworker Table Presence: Coworker cards render as seated colleagues at the briefing table. Task label `"follow"` replaced with observational postures (`"Reviewing equipment manifest"`, `"Adjusting radio pack harness"`, `"Seated at table, awaiting staging"`).
  - Direct Recipient Selection: Clicking any coworker card directly selects/deselects them as the comms recipient in the input dock (`[data-testid="q4-comms-target"]`), accompanied by visual highlight (`.selected-target`) and keyboard accessibility.
  - Silence / Proceed Affordance: Clear institutional path to proceed in silence without speaking. The "PROCEED TO EQUIPMENT STAGING" button remains visible and accessible without requiring dialogue interaction.
  - Visual Hierarchy Restraint: Under `.introductions-active`, stage advance button is styled with secondary restraint (`background: #242b35; border-color: #3b4654;`) until the user is ready, keeping focus on coworker presence.

- **Priority 5 — Live Electron Automated Traversal (`desktop/visual-acceptance-smoke.js`, `tools/run-visual-traversal.js`)**:
  - Ran live Electron instance using an isolated test profile (`profiles.createIsolatedTestProfile(...)`).
  - Successfully traversed complete sequence (Steps 1 through 13b):
    1. Title Screen with ASYNC logo & menu music.
    2. July 1991 Date Card (non-interactive video).
    3. Introductory Video (`IntroductoryVideoVotT.mov`) with tested `ESC` skip contract.
    4. Personnel Waiver name entry.
    5. Personnel Confirmation screen.
    6. AEOT Initialization (8s countdown/test bypass).
    7. AEOT Cold Boot (3 stages: Memory Check, Network Handshake, Subsystem Ready).
    8. Facility Schematic inspection across all 4 levels (Lower, Middle, Upper, Upper Section). Blueprint exactness verified.
    9. In-person Maxwell briefing with progressive letter-by-letter rendering.
    10. Mid-typing skip test (snapped text instantly to full, did not advance beat).
    11. Inquiry interaction ("What is our cutoff time?") yielding Dr. Maxwell's in-scene reply ("Departure is scheduled for 10:00 AM... Operational cutoff is 1:00 PM firm.") with clean UI feedback and zero error banners.
    12. Completed Maxwell opening remarks and active CONCLUDE BRIEFING button.
    13. LOCAL Introductions scene with 3 seated coworkers at Assembly Table and PROCEED TO EQUIPMENT STAGING affordance.
    14. Coworker interaction: clicked coworker card to address directly, verified target select synchronization, clicked again to return to neutral.
  - Audio audit: Standard facility strictly silences `complex_hum` and `complex_music`. `facility_ambient` active. Zero audio leaks.
  - Visual integrity verified at both 1440x900 and 1024x768 viewports: zero clipping, collisions, or overlaps. 20 visual artifacts captured.

- **Priority 6 — Verification Suite Health**:
  - Aggregate test suite: 788 / 788 tests passed (100%).
  - Reports passed: `corpus-context-closure`, `stranger-flow`, `replayability`.
  - Packaged desktop regressions: `desktop:verify`, `desktop:settings-regression`, `desktop:first-run-regression` all passed.
  - Verification inventory: consistent (0 errors, 0 warnings).
  - No Git commits or pushes performed. Preserved clean working state for Jack's manual sensory review.


## Paper sound and automatic Maxwell pacing — 2026-09-20

- Added locally synthesized 1.8-second paper-rustle WAVs to the existing paper entry/exit hooks; these are procedural approximations, not recorded Foley. Provenance is beside the assets.
- Maxwell opening remarks advance through the existing CONTINUE_BRIEFING action at a reading pace, without a continue button. Pacing pauses while the question field is focused or contains a draft, while the window is hidden, or while another action resolves. Leaving the surface invalidates its timer.
- Fixed conclusion visibility to use canonical current_beat_index/beats_total fields. Explicit conclusion remains the player's choice after the remarks. Earlier dialogue is collapsed into an expandable history.
- Authored title-video integration, PA music treatment, 1.8-second paper movement, hidden cinematic skip hints, and floor-inspection controls remain in place. Floor inspection is not physical travel.
- No test suites or Electron run performed at user request. Paper timbre and briefing pacing require human listening/observation. No commit or push.


## Authored Cinematic Asset Integration & Reusable ESC Skip Contract — 2026-09-19

- Bounded pass status: **COMPLETED** (Pending Human Electron Observation / Verification).
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Integrated authored assets:
  - `DateCardNewPlayerClip.mov` (22.5s, 1920x1080, H.264/AAC stereo) → `desktop/assets/video/DateCardNewPlayerClip.mov` (Slot: `DATE_CARD_JULY_1991`).
  - `IntroductoryVideoVotT.mov` (208.3s, 1920x1080, H.264/AAC stereo) → `desktop/assets/video/IntroductoryVideoVotT.mov` (Slot: `BRIEFING_INFORMATIONAL_VIDEO`).
  - `CrossingIntoTheComplex.mov` (40.3s, 1920x1080, H.264/AAC stereo) → `desktop/assets/video/CrossingIntoTheComplex.mov` (Slot: `THRESHOLD_CROSSING_ENTRY_4`).
- Core architecture & contracts delivered:
  1. **Hard Cinematic Input Law**:
     - Every non-interactive cinematic is immediately skippable via `ESC`.
     - ESC halts audio and video immediately, unloads media decoder pipeline (`pause()`, `removeAttribute("src")`, `load()`), removes the DOM surface, and invokes the deterministic completion callback `finishCinematic(reason = "ended" | "skipped")`.
     - Capture-phase key handling (`useCapture: true`) with `stopImmediatePropagation()`, `stopPropagation()`, and `preventDefault()` guarantees zero event leakage into newly revealed interactive screens or Electron window handlers.
     - Synchronous event listener deregistration prevents keyboard listeners from outliving the active cinematic.
     - Zero orphaned media elements or background audio streams survive dismissal.
     - Restrained skip affordance: subtle monospace `ESC · SKIP` element placed non-dominantly at bottom right.
  2. **Unified Cinematic Player (`desktop/renderer/cinematic-player.js`)**:
     - UMD module (`YBCinematicPlayer`) providing `playCinematic(options)`, `getActiveCinematic()`, and `skipActiveCinematic()`.
     - Section 24 visual placeholder registry integration with dynamic path resolution (`getResolvedPath`).
     - Safe fast-test support (`__YB_TEST_FAST_DATE_CARD__`, `__YB_TEST_FAST_BRIEFING__`, `__YB_TEST_FAST_CROSSING__`, `__YB_TEST_FAST_FADE__`).
     - Idempotent lifecycle execution: single-completion guard (`finished = true`) eliminates race conditions between natural `ended` events and simultaneous ESC skips.
  3. **Strict Beat 1 Chronology Preserved**:
     `NEW GAME → JULY, 1991 (DateCard) → INTRO VIDEO (VotT) → WAIVER / IDENTITY → PERSONNEL CONFIRMATION → PAPER EXIT → AEOT INITIALIZATION → AEOT COLD BOOT → BRIEFING PENDING`.
  4. **Threshold Crossing Isolation & Acoustic Boundary**:
     - `CrossingIntoTheComplex.mov` is strictly gated to the successful canonical `CROSS` action transition from pre-crossing (`STANDARD_RADIO_CHECK` / `THRESHOLD`) to `FIELD_OPERATION`.
     - Suppressed during application start, prefield, boot, transit, and staging.
     - Complex environmental ambience (`complex_hum`) is held until `finishCinematic` completes (`completeTransition`), ensuring authentic silence / video-track audio during crossing traversal.
- Automated verification:
  - Aggregate test suite: 775 / 775 passed (143 included, 4 quarantined, 0 retired).
  - Fast test suite: 144 / 144 passed.
  - New test registered: `tests/y107-authored-cinematic-assets-and-esc-skip.test.js` (aggregate tier).
  - Verification inventory consistent (`INVENTORY CONSISTENT (0 errors, 0 warnings)`).

## Beat 2: Physical Dr. Kirk Maxwell Briefing & Opener Repair 2.2 — 2026-09-19

- Bounded pass status: **PENDING HUMAN ELECTRON OBSERVATION / VERIFICATION**.
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Player-facing sequence delivered:
  `BRIEFING PENDING → ATTEND BRIEFING → PHYSICAL DR. KIRK MAXWELL BRIEFING → INQUIRY / CONVERSATION → CONCLUDE BRIEFING → LOCAL_INTRODUCTIONS (3 COWORKERS AT TABLE) → PROCEED TO EQUIPMENT STAGING → RM-L02 DRESSING ROOM & EQUIPMENT ISSUE`.
- Core repairs delivered (Failures A through H):
  1. **Failure A — Environmental Ambience Physical State Ownership**:
     - Ambience is strictly owned by physical environment state (`STANDARD` vs `COMPLEX`).
     - Standard facility ambience resolves to authentic silence (`data:audio/wav;base64,...` silent PCM WAV data URI in `DEFAULT_SOUND_MAP`).
     - Complex fluorescent hum (`FF1_Electrical_Buzz_01.mp3`) and music loops are strictly suppressed Standard-side prior to Threshold crossing.
     - In `acoustic-director.js`, `physical_environment` is evaluated; `fluorescent_hum_level` is set to `0.0` in all Standard facility phases including `THRESHOLD` and `STANDARD_RADIO_CHECK`.
  2. **Failure B — Reconciled Facility Map Geometry (`ASYNC Facility.png`)**:
     - Fully reconciled the spatial schematic in `surfaces.js` to match the authentic Lower Level architecture from `ASYNC Facility.png` (`gm_br_complex`):
       - `RM-L05 Briefing Room` (Lower Offices / Briefing)
       - `HALL-L1 Corridor / Service` (Circulation & Machinery)
       - `FREIGHT LIFT` (Levels 1–4 shaft)
       - `RM-L02 Dressing Room` (Hazmat & Equipment Staging)
       - `AIRLOCK` (Interlock transition corridor)
       - `RM-L01 Threshold Chamber` (KV31 / LPMDS Hall)
       - `KV31 CONTROL (LVL 2)` (Observation gallery overlook)
       - `APERTURE` (LPMDS boundary opening)
       - 4-level indicator pills: `LOWER LEVEL (ACTIVE)`, `MIDDLE LEVEL`, `UPPER LEVEL`, `UPPER SECTION`
     - Removed provisional node graph and eliminated all label collisions.
  3. **Failure C — De-gamified Maxwell Briefing Scene**:
     - Purged gamified meta-UI badges (`IN-PERSON BRIEFING`, `Chief Expedition Briefing Authority · Standard Side`, turn badges, and attendance cards/tags).
     - Clean, physical presentation: Dr. Kirk Maxwell seated across the desk in `KV31 Lower Briefing Room` with authentic transcript history.
  4. **Failure D — Purged Player-Facing Backend Language**:
     - Removed `"Action accepted."` fallback in `renderer.js` `renderMessage`.
     - Removed `" Saved."` string in `play(...)`. Persistence occurs silently without leaking implementation details.
  5. **Failure E — Unified Next Action Label**:
     - Removed duplicated concatenation `"PROCEED TO ESD · PROCEED TO EQUIPMENT STAGING"`.
     - Standardized to single clean, diegetic action: `"PROCEED TO EQUIPMENT STAGING"`.
  6. **Failure F — Discrete `LOCAL_INTRODUCTIONS` Beat**:
     - Concluding Maxwell's briefing transitions beat to `LOCAL_INTRODUCTIONS`.
     - Dedicated room view in `briefingWorkstation`: Dr. Maxwell has departed; the three coworkers remain seated at the table (`coworker-presence-card`).
     - Active `communicationConsole` on LOCAL channel for spoken dialogue.
     - Action dock features explicit `"PROCEED TO EQUIPMENT STAGING"` (no automatic advance).
  7. **Failure G — Equipment Staging Progressive Disclosure**:
     - Staging displays physical dressing room / equipment issue: `EQUIPMENT STAGING · RM-L02 Dressing Room & Equipment Issue`.
     - Removed giant unformatted mission dossier banner across the top.
     - Suppressed premature empty evidence rail in prefield/staging (`fieldPhase || evidence.length > 0`).
  8. **Failure H — Clean Diegetic Comms Copy**:
     - Replaced internal `"LOCAL dialogue input is paused during equipment operation."` copy with clean, diegetic feedback: `"Personnel are focused on equipment preparation."`, state `"STANDBY"`, and placeholder `"Communications standby..."`.
- Automated verification:
  - Aggregate test suite: 768 / 768 passed (142 included, 4 quarantined, 0 retired).
  - All targeted tests passed: `y106`, `y104`, `y98`, `y75`, `y47`, `y48`.
  - Verification inventory consistent (`INVENTORY CONSISTENT (0 errors, 0 warnings)`).

## Repair Pass 3.10.1: Menu Music Handoff + AEOT Cold-Boot Visibility — 2026-09-18

- Bounded repair pass status: **COMPLETED** (Main-menu music fade handoff and AEOT cold boot visibility resolved).
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Core repairs delivered:
  1. **Immediate Menu Music Fade on New Game**:
     - Synchronous initiation: `YBAudio.stopMenuMusic(1500)` triggers immediately when the player activates NEW GAME / enters the new-file sequence (`enterMode("field-researcher")`), before the screen fade to black.
     - Linear fade-out from effective gain over 1500ms (< 2 seconds), completing and releasing cleanly well before the date presentation appears.
     - Replaced obsolete/delayed stop hooks at personnel confirmation and initialization with immediate entry fade.
     - Enhanced `YBAudio.diagnostics().menu` with active playback, fading state, fade multiplier, and current volume telemetry.
     - Menu track does not restart or resume during date presentation, introductory video, waiver, confirmation, initialization, or AEOT startup.
  2. **AEOT Cold-Boot Visibility & Sequential Energization**:
     - Staged 3-region sequential power-up:
       1. Top / Header (`.async-system-header`) — initiates at T=0 with `boot_power`.
       2. Central Workstation / Facility Schematic (`.eti-center`) — initiates at T=850ms with `boot_drive`.
       3. Lower Action / Status dock (`.eti-turn-controls`) — initiates at T=1700ms with `boot_relay`.
     - Human-observable calibration: 850ms duration per region in production (~2.55s total) with non-overlapping energizing intervals; accelerated (30ms per region) in automated testing via `.fast-boot`.
     - Early-1990s institutional display stabilization: subtle cathode/phosphor stabilization via `@keyframes eti-region-energize` (bloom to calibrated contrast/brightness) without cyberpunk glitches, fake CRT artifacts, scanline spectacle, or invented text.
     - `BRIEFING PENDING` remains invisible (`.eti-cold-boot-pending`, `pointer-events: none`) and locked until the final region is energized.
     - Entire interface remains non-interactive (`body[data-boot-locked="true"]`, `cursor: wait`) until cold boot completes at T=2550ms.
  3. **Acoustic Discipline**:
     - Removed automatic `ui_select` cue at cold boot completion.
     - Preserved legitimate electrical hooks (`boot_power`, `boot_drive`, `boot_relay`).
     - Strictly zero radio or transmission audio (`radio_chirp`, `radio_tx_chirp`, `radio_rx_cue`).
- Automated verification:
  - Aggregate test suite: 763 / 763 passed (141 included, 4 quarantined, 0 retired).
  - Regression tests added to `tests/y75-ui-audio-spec-compliance.test.js` (menu music fade lifecycle, <2s release) and `tests/y105-authoritative-first-run-chronology.test.js` (sequential cold boot, 850ms calibration, absence of `ui_select`, immediate fade initiation).
  - Packaged verifications passed: `npm run desktop:build`, `npm run desktop:verify`, `npm run desktop:settings-regression`, `npm run desktop:first-run-regression`.
  - Conformance inventory: `INVENTORY CONSISTENT (0 errors, 0 warnings)`.

## Implementation Pass 3.10: Authoritative First-Run Chronology + AEOT Cold Boot — 2026-09-18

- Bounded pass status: **COMPLETED** (Authoritative first-run sequence and AEOT cold boot operational).
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Authoritative first-run chronology enforced:
  `NEW GAME → DATE PRESENTATION → INTRODUCTORY VIDEO → WAIVER / NAME PAPER → PERSONNEL CONFIRMATION → PAPER SLIDE-AWAY → AEOT SYSTEM INITIALIZATION → AEOT UI COLD BOOT → AEOT OPERATIONAL (BRIEFING PENDING) → STOP AT MAXWELL BOUNDARY`.
- Core repairs delivered:
  1. **Date Presentation & Standalone Introductory Video**:
     - Date presentation starts from black, fades `JULY, 1991` in over 5s, fades out over 5s, accepting no skip input, and smoothly transitions into the standalone introductory video (`BRIEFING_INFORMATIONAL_VIDEO`).
     - Standalone introductory video precedes the personnel waiver, grounding the legal acknowledgement in prior exposure to institutional material.
     - Single-world persistence: reopening unconfirmed onboarding resumes from the Date Presentation within the existing world without creating or duplicating worlds.
  2. **Sequential 4-Row AEOT System Initialization**:
     - 4 audited diagnostic subsystem rows (`KV31 CORE LINK`, `OPTICAL BUS RELAYS`, `TOPOLOGY BUFFER`, `TELEMETRY MATRIX`) execute sequentially 0% → 100% (~2.0s per row in production, fast-tracked in automated testing).
     - Subsystems step through discrete state indicators: `WAITING` → `ACTIVE` → `[OK]`.
  3. **Staged AEOT UI Cold Boot**:
     - Workstation mounts directly in KV31 Briefing Office displaying the controlled facility schematic (KV31-B1) on the central display.
     - Sequential energization: Header powers up → Center panel energizes → Action dock activates with `BRIEFING PENDING` (locked/disabled).
     - Synchronized electrical cues (`boot_power`, `boot_drive`, `boot_relay`, `ui_select`); strictly zero radio chirps (`radio_chirp`, `radio_tx_chirp`, `radio_rx_cue`).
     - Removed obsolete post-boot `FACILITY_BROADCAST`, feed timers, and release buttons from workstation runtime.
  4. **Strict Maxwell Boundary Enforcement**:
     - Workstation stops immediately upon achieving operational `BRIEFING PENDING`.
     - In-room Maxwell dialogue, coworker introductions, and transition to Equipment Staging remain strictly suppressed.
- Automated verification:
  - Aggregate test suite: 762 / 762 passed (141 included, 4 quarantined, 0 retired).
  - New test registered: `tests/y105-authoritative-first-run-chronology.test.js` (aggregate tier).
  - Packaged verifications passed: `npm run desktop:build`, `npm run desktop:verify`, `npm run desktop:settings-regression`, `npm run desktop:first-run-regression`.

## Beat 1 Repair Pass 3: Clean ASYNC Workstation Handoff — 2026-09-17

- Bounded pass status: **COMPLETED** (Clean workstation handoff boundary between initialization and facility broadcast).
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Authoritative sequence enforced: `BOOT → FACILITY BROADCAST → MAXWELL BRIEFING/DIALOGUE → LOCAL INTRODUCTIONS → EQUIPMENT STAGING` (Facility broadcast and Maxwell briefing remain strictly separate beats).
- Core repairs delivered:
  1. **Clean Workstation Standby State**:
     - ASYNC boot initialization runs non-interactably until completed.
     - Terminal renders in clean operational standby in the KV31 briefing office with persistent player and exactly 3 coworkers loaded.
     - Facility schematic rendered as central display (`#map-svg-root`, `#map-briefing-room`, `#map-you-marker`); briefing broadcast projector feed suppressed during standby.
     - Facility broadcast, Maxwell dialogue, chirps, and coworker introductions strictly suppressed during standby.
     - Primary action displays disabled `STANDBY` button with explanatory reason. Later-beat objectives and work-orders suppressed (`ASSIGNMENT PENDING`).
  2. **Deterministic Authoritative Broadcast Transition**:
     - Presentation pause timer transitions from standby into `startBriefingBroadcast({ world_id })`.
     - 4 radio chirps and dated briefing card emitted once upon broadcast commencement.
     - CRT feed and projector visuals activate only when `status === "in-progress"`.
  3. **Idempotence & Cold-Boot Persistence**:
     - Completed broadcast state persists across service restarts; completed broadcast never replays on world resume.
- Automated verification:
  - Aggregate test suite: 759 / 759 passed (140 included, 4 quarantined, 0 retired).
  - Fast test suite: 143 / 143 passed.
  - New test registered: `tests/y104-clean-workstation-handoff.test.js` (aggregate tier).
  - Smoke tests passed: `node desktop/first-run-smoke.js`, `node desktop/renderer-smoke.js`, `node tools/verification-inventory.js`.

## Beat 1 Repair Pass 1.3: Title Lockup & Smooth Dismissal — 2026-09-17

- Bounded pass status: **COMPLETED** (Presentation-only title screen correction).
- Visual acceptance status: `UNVERIFIED — REQUIRES HUMAN ELECTRON OBSERVATION`.
- Scope constraints strictly preserved:
  - Preserved verified world-selection/home screen, menu audio (bossa-only), exit confirmation dialog, title two-input gate law (`PRESS ANYTHING` → `PRESS AGAIN TO CONTINUE`), and authentic `ASYNC_Logo.png` asset.
  - No new font files downloaded or introduced.
  - Zero changes to CQ4 prefield flow, date card, waiver, personnel creation, persistence, or simulation layers.
- Core repairs delivered:
  1. **Title Lockup Refinement**:
     - Reduced authoritative ASYNC logo height from `clamp(3.2rem, 8vw, 5.5rem)` to `clamp(2rem, 5vw, 3.5rem)` (~65% scale).
     - Tightened vertical spacing between ASYNC logo and `VOICES OF THE THRESHOLD` to `0.5rem`, locking them into a single coherent visual mark.
     - Moderately reduced main title `h1` size to `clamp(1.8rem, 4.2vw, 3.2rem)` with centered layout, restoring ample horizontal negative space and preventing screen edge crowding.
  2. **Condensed Institutional Sans/Grotesk Typography**:
     - Replaced terminal monospace on `h1` (`VOICES OF THE THRESHOLD`) with authentic archival condensed grotesk font stack: `"Arial Narrow", "Helvetica Neue", "Avenir Next Condensed", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` with `font-stretch: condensed; font-weight: 700; letter-spacing: 0.07em; line-height: 1.15;`.
     - Subtitle (`A Kane Pixels' Backrooms Simulacrum`) and prompt (`PRESS ANYTHING` / `PRESS AGAIN TO CONTINUE`) retain the established monospace font.
  3. **Hardware-Accelerated Smooth Dismissal Wipe**:
     - Diagnosed cause of Electron dismissal jitter: animating `clip-path: inset(...)` forced CPU rasterization and DOM reflow on every main-thread frame while audio and IPC events were dispatching.
     - Replaced with a compositor-driven black shutter overlay (`.title-wipe-shutter`) animated with `transform: translate3d(-100%, 0, 0)` to `translate3d(0, 0, 0)` with `will-change: transform`.
     - Completely offloaded to the GPU compositor thread: zero CPU raster repaints, zero layout reflows, locked 60fps/120fps fluid left-to-right sweep over 450ms.
     - World-selection screen remains unexposed underneath until 450ms completion delay.
- Automated verification:
  - Aggregate test suite: 756 / 756 passed (139 included, 4 quarantined, 0 retired).
  - Focused tests passed: `y103`, `y98`, `y75`, `y42`, `y30`, `y26`, `y77`.

## Living Beatmap Player-Facing Post-Conformance Convergence Checkpoint — 2026-09-15

- Bounded pass status: **CLOSED** for Living Beatmap desktop layout repair, locked Broadcast → Briefing state machine, settings appliance status card, and packaged verification.
- Verified test suite: Governed aggregate **PASS** (137/137 suites, 740/740 tests, 0 failures, 0 warnings); `node tools/verification-inventory.js` **PASS** (included=137, quarantined=4, retired=0, unexplainedOnDisk=0).
- Packaged desktop verification: `npm run desktop:build`, `npm run desktop:verify` (`offline_smoke`, `packaged_renderer_interaction`, `packaged_day1_opener_interaction`), and `npm run desktop:first-run-regression` all pass cleanly with production profiles unchanged.
- Core repairs delivered:
  1. **Communications Panel Vertical Ownership & Layout**: Completely refactored `.eti-comms` from a 5-row CSS grid with 7 children into a flex column with strict layer hierarchy: Header (Mode/State) → Mechanical Switch & Target Address → Timeline (`flex: 1 1 auto; overflow-y: auto`) → Guidance (`.comms-guidance` containing channel explanation & local communication notice) → Composer Form → Status. Eliminated text overlaps, element collisions, and track mismatches.
  2. **Center-Column Content-Responsive Sizing**: Refactored `.eti-center` to a flex column (`display: flex; flex-direction: column; min-height: 0; gap: 7px;`). `.eti-spatial` set to `flex: 1 1 auto; min-height: 220px;`; `.eti-interpretive` set to `flex: 0 1 auto; min-height: 90px; max-height: 52%; overflow-y: auto;`. Stripped duplicate `<details class="operational-map">` from `phaseRecord` to prevent double map/feed rendering and preserve sacred AEOT geometry.
  3. **Locked Canonical Broadcast → Briefing State Machine**: Dr. Kirk Maxwell's briefing presentation renders with live CRT feed and 4 chirps; release control restores facility map schematic and reveals Maxwell's greeting in purple typography (`.comm-maxwell`, `.comm-maxwell-text`); local channel enables coworker introductions; staging progression enables cleanly.
  4. **Settings Appliance UI**: Appliance status card with status pill (`Ready`, `Not Installed`, `Installing`, `Repair Required`, `Unsupported`), strict 127.0.0.1 private loopback isolation notice, and `<details class="advanced-diagnostics" open>` housing diagnostics and configuration parameters without breaking native hit-testing.
  5. **y101 State Machine Regression Test**: Registered in `verification/verification-authority.json` and `verification/test-manifest.json` with matching SHA-256 hash.

## Reference Expedition living-turn integration checkpoint — 2026-09-02

- Recovered boundary: branch `reference-expedition/foundation`, committed checkpoint `dbf8fa7` (`feat: add observer-safe live scene projection`). The interrupted working tree was a coherent continuation of that checkpoint, not disposable debris: it contained the living-turn interpreter/presentation pipeline, hosted-provider seams, LOCAL dialogue presentation, and renderer/playability repairs.
- Bounded pass status: **CLOSED** for Reference Expedition living-turn and packaged player-path integration. This does not accept the complete Reference Expedition specimen or any later 1.0 campaign pass.
- Canonical ordering is enforced as interpreter candidate → canonical resolution → observer-safe live-scene projection → candidate presentation → validation/fallback. Provider code receives bounded packets, cannot mutate the run, and cannot establish geography, observation, evidence, personnel action, speech, or conclusions.
- Natural Reference Expedition attempts now execute through the living-turn boundary. Simple movement and one coordinated coworker-plus-player interval are supported; ambiguity clarifies without mutation; canonical action remains committed if generation fails; invalid prose falls back deterministically.
- LOCAL hosted phrasing is reachable only after canonical delivery and personnel-continuity response authorization. The provider sees a bounded dialogue packet; invalid or unavailable output falls back without retracting delivery. This pass does not change the established nearby-group LOCAL delivery rule or claim targeted-private conversation acceptance.
- Player-path repairs: a new field file advances directly to its one authoritative program selector; Settings captures form values before controls are disabled; stale refresh results are rejected correctly; staged equipment can be taken into accountable player custody; Cross Threshold retains mission updates; rendered equipment handoff controls forward their intended target.
- Verification governance now registers `tests/y69-reference-expedition.test.js` through `tests/y73-ai-living-turn.test.js` as governed long-world tests. Stale pre-field fixtures and acceptance reports were reconciled to the ratified READY → PROCEED → APPROACH → READY → player-authored STANDARD transmission → CROSS sequence.
- Automated evidence: governed aggregate **PASS**, 404/404; inventory **PASS**, 104 included / 4 quarantined / 0 unexplained; focused living-turn tests **PASS**, 26/26; native tier **PASS**.
- Packaged runtime evidence: isolated-profile Electron native input completes creation, personnel creation, briefing/staging/approach, player-authored radio check, Threshold crossing, LOCAL communication, and Reference Expedition natural movement from Utility Room to Open Passage. Create/reopen first-run and Settings persistence also pass. Production-profile snapshots remained byte-for-byte unchanged.
- Hosted OpenAI implementation has strict request schemas, no-store requests, invocation diagnostics, and an opt-in packaged `--hosted-ai-smoke`. No live hosted request was executed at this checkpoint because no isolated configured credential or `OPENAI_API_KEY` environment value was available. Mocked hosted seams and hostile-output fallback are covered; no claim of live-provider availability is made.
- Remaining specimen work: targeted/private LOCAL delivery is still not accepted; evidence-to-report-to-institutional-belief causality and the three contrasting complete production-UI runs remain open; full return/debrief, human break scoring, and stranger play evidence remain open; redundant legacy UI/menu consolidation remains a later dedicated pass.
- Exact next bounded campaign pass: complete the Reference Expedition evidence → report → delivered institutional input → provisional belief chain, preserving omission and contradiction, then prove contrasting investigate/document, report/return-early, and ignore/omit outcomes. Do not begin that pass without authorization.

## Governance amendment — four stale long-world expectations — 2026-08-15

- Approved external baseline: `e57ceead36167e873412a5974a296dfef74d45ed`. This amendment is limited to verification governance and does not certify or modify the independently supplied persistence implementation awaiting final certification.
- Human adjudication replaces one stale expectation in each of `tests/y55-survey-frontier.test.js`, `tests/y61-local-standard.test.js`, `tests/y62-evidence-archive.test.js`, and `tests/y64-environment-simulation.test.js`. The former assertions required restore-time manufacture of current-v9 Survey Frontier state, a current Clear-Q4 Standard operator, incomplete legacy evidence provenance/access, or current-v9 environment state.
- The governed replacement contract is fail-closed: corrupt current-v9 state rejects or uses an already-valid previous-good artifact without creating observations, provenance, environment, personnel, contacts, access, or history. Well-formed legacy evidence remains eligible for conservative migration with its explicit facts preserved.
- Protected status and `long-world` tier membership remain unchanged. `verification/verification-authority.json` changes only the four corresponding governed content hashes. `verification/test-manifest.json`, verifier-core files, runner/inventory semantics, known-defect dispositions, retirements, and tier transitions remain unchanged.

## Current orientation — V02 verification-governance repair — 2026-08-15

- V02 remains limited to executable verification truth. No persistence, gameplay, provider, canon, or player-facing simulation authority changed.
- `verification/verification-authority.json` is the approved mutable governance baseline for exact test identities, test content hashes, required tiers, fast membership, known defects, retirements, authorized tier transitions, explicit dispositions for every package script, verifier-core hashes, and the exact required report/native executable hash set. It is not a cryptographic root of trust; governance changes require explicit external review against an approved Git baseline.
- `verification/test-manifest.json` remains the mutable execution manifest. Inventory rejects coordinated disk/manifest test deletion relative to the approved authority, manifest-only tier migration, unregistered quarantine/retirement, undisposed package scripts, governed test/core content drift, duplicate report executable paths, and missing/extra/mismatched required report/native executable hashes. Test, report, and native subprocesses have bounded fail-closed timeouts.
- Known long-world canonical equivalence remains a truthful V03-owned failure. V02 does not repair or relabel it.
- The independent certification findings that prompted this repair are implementation inputs, not accepted closure. Fresh certification remains required before V02 can be considered complete.

## Current orientation — V01 authority checkpoint — 2026-08-12

- Phase 01C human ratification is complete. `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md` is the current Yellow Beast player/product authority; `docs/YELLOW_BEAST_VISION_PASS_MAP.md` is the current implementation campaign; `docs/YELLOW_BEAST_CURRENT_BASELINE.md` is current implementation truth.
- `SIMULATION_DOCTRINE.md` remains setting-independent Custodian constitutional law. Doctrine v1.1 now leaves career-versus-world lifecycle scope to explicit product/worldpack authority and records the bounded deterministic elapsed-time and five-state persistence contracts. These are not universalized Yellow Beast content rules.
- `canon/SOURCE_POLICY.md` plus reviewed claim/admission records independently govern Kane-canon admission. Desired, implemented, fixture-reachable, production-reachable, and primary-supported phenomenon behavior remain separate classifications.
- V01 is documentation/authority work only and is the active pass. V02 and all later implementation remain unauthorized until the planned V01 human checkpoint is approved.
- No runtime behavior changed in V01. Current whole-world retirement, per-action field autosave, save-time reconciliation, action-driven time, personnel replay loss, backup retirement reversal, and provider terminology leakage remain implementation defects for their assigned later passes.
- The old numbered Implementation Roadmap, Codex Execution Map, reconciliation audits, Recovery Prompt sequence, Pass 10–17 summaries, `PLAYABLE BETA` labels, and green historical suite claims are historical evidence only. They do not determine current product completeness or authorize work.

### Current authority hierarchy

1. Simulation Doctrine — universal reality, causality, persistence, observer, and provider law.
2. Gameplay Constitution — current Yellow Beast player promise and explicit Yellow Beast lifecycle/time/checkpoint specialization.
3. Canon source policy and admitted claims — external Kane-canon authority.
4. Design Charter — product elaboration subordinate to the Gameplay Constitution.
5. Current Baseline — present implementation facts and defects.
6. Vision Pass Map — current campaign order, dependencies, and pass scope.
7. Current pass specification — authority for work allowed now.
8. This file's older entries — historical implementation evidence only.

## Historical implementation ledger

Everything below this heading records prior implementation claims, tests, gates, and handoffs in their historical context. Later current-orientation sections supersede them for present scope and authority.

## Pass 10D — Accessibility, Interface Certification, and Beta Identity

- Completed pass: `10D`; Pass 10 automated exit: `ACCEPTED`.
- Branch: `agent/pass-10-release-candidate`.
- Resulting commit: this Pass 10D commit, subject `feat: certify Pass 10 playable beta interface`.
- Version: `0.14.0-beta.1` — Yellow Beast PLAYABLE BETA.
- Save schema: `yellow-beast-session@7`; supported session versions 1–7 and established run migrations v1–v9. No migration introduced.

## Certified surface

- Existing high contrast, visible focus, native keyboard controls, semantic forms/status, text scales, guided help/recap, reduced motion, structured offline actions, and error/recovery surfaces remain active.
- Reduced-sensory preference is normalized and exposed as a document presentation attribute; it remains presentation-only.
- Runtime-media validation now excludes only `docs/UI Reference Material/` and `docs/Audio Sources/`; runtime/shipping media validation remains active.

## Automated gates

- Focused accessibility/QoL/UX tests: PASS (40).
- Pass 10 persistence, mission, operational, and Clear-Q4 acceptance: PASS.
- Full suite Checkpoint 1: `npm test` PASS.
- Asset and contract validation: PASS.
- Desktop build: `npm run desktop:build` PASS.

## Human certification

- Status: `PENDING HUMAN VALIDATION`.
- Launch: `npm run desktop:dev`.
- Matrix: keyboard-only full operation/resume; 1280×720, 1366×768, 1920×1080 and 150% scaling; high contrast; reduced motion/sensory; reopen guidance; controlled error/recovery.

## Deferred / Pass 11 start

- Deferred: Pass 11 Facility spatial presentation and all later campaign systems.
- Begin Pass 11 with `desktop/renderer/renderer.js`, `desktop/renderer/surfaces.js`, `desktop/renderer/styles.css`, Clear-Q4 phase projections, and Facility/worldpack authority boundaries. Preserve Custodian truth and `yellow-beast-session@7`.

## Pass 11 handoff — Prompt 05 / 21

- Completed pass: `11`; checkpoint: `NO`; next checkpoint: `Prompt 07 / Pass 12B  CHECKPOINT 2`.
- Resulting commit: pending local commit; branch remains `agent/pass-10-release-candidate`; version remains `0.14.0-beta.1`.
- Facility contexts derived from canonical Clear-Q4 phase state: Lower Offices, Hazmat / Equipment, Maintenance Wing, KV31 Control / Observation, Threshold Chamber, Complex, and Biomedical / Evidence when returned material exists.
- Canonical authorities consumed: `tools/q4-experience.js` phase, personnel, equipment, logistics, evidence, radio, and institutional projections. No renderer-owned mission or inventory truth; no save-schema or migration impact.
- Settings regression repaired in `desktop/renderer/renderer.js` with explicit named-control lookup and guarded settings/provider responses. Focused Settings regression: PASS (`tests/y54-settings-regression.test.js`). Desktop service suite: PASS.
- Desktop build: PASS (`npm run desktop:build`); launch: `npm run desktop:dev`. Human gate: `PENDING HUMAN VALIDATION`.
- Known defect: richer room-specific operational panels remain deferred; Survey Frontier, geography/knowledge layers, and procedural Complex work were not started.
- Pass 12A should begin with `desktop/renderer/surfaces.js`, `desktop/renderer/renderer.js`, `tools/q4-experience.js`, and authoritative spatial/worldpack projections.

## Pass 12A handoff — Prompt 06 / 21

- Completed pass: `12A`; checkpoint: `NO`; next checkpoint: `Prompt 07 / Pass 12B  CHECKPOINT 2`.
- Branch: `agent/pass-10-release-candidate`; resulting commit: local `feat: add Survey Frontier knowledge authority`; version: `0.14.0-beta.1`; active session schema: `yellow-beast-session@7`.
- Survey Frontier authority: `tools/survey-frontier.js` stores separate personnel, Standard, and historical geographic knowledge over immutable spatial topology. Player and Standard records are observer-safe derived maps; topology remains in `tools/spatial-runtime.js`.
- Provenance preserves direct observation, traversal, teammate communication, delivered radio reports, and conservative legacy spatial-record migration. Historical claims come from `historical_survey_claims` in the Clear-Q4 spatial worldpack and remain `PRIOR_RECORD_ONLY`.
- `run.survey_frontier` is serialized inside the existing run envelope. Old saves migrate only their persisted player discoveries; no unseen teammate or Standard knowledge is fabricated.
- Focused frontier and affected Clear-Q4 tests: PASS. Desktop build: PASS (`npm run desktop:build`). Human gate: `PENDING HUMAN VALIDATION`.
- Pass 12B must consume `tools/survey-frontier.js` (`migrate`, `observe`, `traverse`, `map`, `standardMap`, `frontier`) alongside `tools/spatial-runtime.js` objective topology and `tools/run-bootstrap.js` serialization. Do not mutate knowledge projections as geography truth.

## Pass 12B handoff — Prompt 07 / 21 — CHECKPOINT 2

- Completed pass: `12B`; branch: `agent/pass-10-release-candidate`; resulting commit: this Pass 12B commit, subject `feat: add persistent procedural Complex expansion`. Version remains `0.14.0-beta.1`.
- `CHECKPOINT 2 AUTOMATED EXIT: ACCEPTED`. Focused persistent-complex acceptance: PASS (7). Multi-operation A/B/C, deterministic topology, bounded/atomic generation, fixed Threshold, marker revisit, save/reload, knowledge boundaries, safe interpretation context, and desktop hierarchy coverage all pass. Full historical suite: `npm test` PASS. Desktop build and artifact smoke: PASS.
- Active schemas remain `yellow-beast-session@7`, `yellow-beast-save@v9`, `yellow-beast-run@v9`, and `yellow-beast-world-history@v1`; no envelope version change. Geography generation version: `yellow-beast-complex-geography@v1`.
- Seed strategy: SHA-256 domain separation over world seed, geography domain, generation version, and stable expansion request ID. Canonical generated results are persisted directly; history is never reconstructed from the recipe.
- Worldpack bounds: 12 expansions, 12 generated locations, depth 12, branching 1. Mundane weighted corridors, utility rooms, junctions, service passages, and ordinary features only. Stable canonical IDs use persisted SHA-256-derived `g-loc-*`, `g-route-*`, and `g-frontier-*` identifiers with authored-collision validation.
- Fixed Threshold: authored `threshold-room` and `threshold-side-entry` remain immutable; every operation still enters the authored `utility-room`. Expansion attaches at the configured Records Annex Survey Frontier and then advances only from the current persisted frontier.
- Persistence/migration: `world.q4_geography` stores a canonical snapshot of generated locations, connections, frontier metadata, route markers, and persistent spatial changes; `world.q4_survey_frontier` and `world.q4_object_state` remain separate. Old worlds initialize these optional fields conservatively without generating or changing authored routes. Fresh operations restore canonical geography into new operational positions.
- Observer integrity repair: status/UI projection no longer appends Survey Frontier provenance. Only legitimate observation, traversal, teammate communication, and delivered reports change geographic knowledge. Generated-but-unobserved destinations remain absent from player and Standard projections.
- Playtest defect repair: the field workstation now separates observation, action, LOCAL, STANDARD, and resolution; action remains persistent while support records are subordinate, and the ordinary surface has no page scroll at 1920×1080 or 2560×1440. The bounded interpreter now receives doctrine ordering, worldpack/assignment authority, personnel and witness context, current observation, recent events, institutional record boundaries, and unresolved intent without hidden topology; candidates still resolve only through canonical object/spatial authorities.
- Human gate: `PENDING HUMAN VALIDATION`. No known automated blocker.
- Pass 13A should consume `tools/run-bootstrap.js` (`topologyFor`, `startRun`, `act`, `saveRun`), `tools/spatial-runtime.js` (`canonicalDefinition`, `availableFrontiers`, `diagnostics`), `tools/survey-frontier.js` observer maps, `tools/q4-experience.js` mission/frontier projections, and `data/worldpacks/clear-q4/spatial.json` procedural configuration. Assignment generation must target canonical locations without treating any observer projection as truth.

## Pass 13A prerequisite repair — Prompt 08 continuation

- Completed bounded prerequisite repair only; Pass 13A assignment generation remains unstarted.
- Desktop build authority: `npm run desktop:build` stamps `desktop/build-info.json` with source version, HEAD commit, and UTC build timestamp, then produces the Windows package. `npm run desktop:verify` reads the packaged archive and rejects version/commit mismatches before its executable smoke test.
- Exact commands: source launch `npm run desktop:dev`; current-HEAD package `npm run desktop:build`; artifact verification `npm run desktop:verify`; verified executable `dist\desktop\win-unpacked\Yellow Beast.exe`.
- Presentation: canonical pre-field phases remain internal but use one preparation surface; LOCAL and STANDARD now share one observer-safe chronological communications surface and composer. The Complex-side map condenses Facility ingress and draws only observed locations, known routes, and unresolved exits.
- Settings: the renderer now creates the Settings surface before querying controls; focus, pointer/keyboard opening, save, close, reopen, and persistence are exercised by Electron renderer smoke coverage.
- Human gate: `PENDING HUMAN VALIDATION`. Capture 1920×1080 screenshots for preparation, field, Settings, and the packaged provenance surface before resuming Pass 13A.
- Pass 13A start remains: `tools/run-bootstrap.js`, `tools/survey-frontier.js`, `tools/spatial-runtime.js`, `tools/q4-experience.js`, `desktop/service.js`, and `data/worldpacks/clear-q4/*`. Do not let renderer projections become assignment authority.

## Pass 13A handoff — Prompt 08 / 21

- Completed pass: `13A`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this Pass 13A commit. Version remains `0.14.0-beta.1`.
- Assignment authority: `tools/q4-assignment-engine.js` derives candidates from persistent world/equipment state, institutional inputs, Standard’s Survey Frontier record, and canonical geography validation. `tools/run-bootstrap.js` issues the work order; the existing mission runtime executes it. No renderer projection is an assignment input.
- Supported work: routine Survey Frontier work at the declared boundary, reported/unconfirmed route corroboration, known equipment recovery, and institutional-record layout verification. Unsupported future archetypes remain configuration boundaries, not hollow work orders.
- Determinism and knowledge: candidates are priority-ranked then SHA-256-selected from a stable selection context. Standard-issued route work reads only Standard’s delivered-report map; canonical topology/equipment is used only for final legality checks. Stale candidates are discarded and reevaluated.
- Persistence/lifecycle: `world.q4_assignment_state` (`yellow-beast-assignment-state@v1`) persists work orders and condition state (`unassigned`, `assigned`, `resolved`). Run saves retain the issued mission record under existing `yellow-beast-save@v9` / `yellow-beast-run@v9`; no save-envelope migration is required. Completed recovery checks actual custody state; unresolved/aborted work becomes eligible again without duplicate active orders.
- Focused coverage: `tests/y58-assignment-engine.test.js` covers routine Threshold work, loss recovery/closure, delivered versus unreported route knowledge, three materially different histories, deterministic selection, stale revalidation, and save/reload. Full suite and desktop package/provenance verification: PASS.
- Human gate: `PENDING HUMAN VALIDATION`. Demonstrate a clean routine work order, a known abandoned-item recovery order, and a delivered-but-unconfirmed route verification order. Verify each cites a real institutional record and that unreported player knowledge produces no Standard order.
- Pass 13B should consume `world.q4_assignment_state`, `tools/q4-assignment-engine.js` (`deriveConditions`, `issue`, `resolve`, `projection`), and persisted institutional closure records for between-operation processing. Do not add renderer-owned career-loop state.


## Pass 14A handoff — Prompt 10 / 21

- Completed pass: `14A`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 14A commit, subject `feat: add persistent personnel continuity and FAILRP guards`. Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`.
- Personnel continuity authority: `tools/q4-personnel-continuity.js` owns deterministic, bounded per-worker tendencies, role-derived qualifications, compact shared operational facts, custody facts, and reaction suppression history. Records remain canonical `world.characters` state, with append-only continuity/shared-history/custody/reaction events replayed by `tools/world-history.js`.
- Shared history: only served-together assignments, delivered LOCAL communication, and actual equipment transfer/custody events are recorded. Persistent staffing prefers established personnel and gives an eligible worker who missed the immediately prior roster a deterministic return opportunity. No relationship score or generated biography exists.
- Knowledge/FAILRP: `reactionContext` creates a worker-specific snapshot from operation/phase, location/contact, assignment/task, held equipment, worker-known event delivery/observation, and relevant shared facts. It excludes objective event payloads, hidden topology, foreign observer knowledge, UI state, and unreceived communications. Field events are impossible outside FIELD_OPERATION/RETURN; unknown, remote, title/menu, or wrong-phase reactions resolve to no reaction.
- Salience/decision: deterministic observer-relative salience uses importance, perceived risk, role relevance, direct involvement, relevant history, communication tendency, novelty key, and persisted repetition suppression. Silence is first-class. `decisionContext`/`decide` resolve compliance, delay, refusal, or unheard outcomes from phase, receipt, availability, qualification, route, equipment, procedure, current task, risk, and persistent caution; presentation only phrases the resolved outcome.
- Migration/save: no envelope version change. Older workers initialize deterministic tendencies/qualifications only; no historical interpersonal event is invented. New continuity events replay across world load; run saves retain Survey Frontier knowledge and persistent world save retains continuity/reaction state.
- Focused tests: PASS — `node --test tests/y37-q4-personnel.test.js tests/y38-q4-equipment.test.js tests/y40-q4-trajectories.test.js tests/y51-mission-state.test.js tests/y52-operational-dynamics.test.js tests/y55-survey-frontier.test.js tests/y58-assignment-engine.test.js tests/y59-career-loop.test.js tests/y60-personnel-continuity.test.js` (67). FAILRP matrix and repeat-roster acceptance: PASS in `tests/y60-personnel-continuity.test.js` (6).
- Desktop build: PASS — `npm run desktop:build`; launch source with `npm run desktop:dev`, packaged executable `dist\\desktop\\win-unpacked\\Yellow Beast.exe`. Human gate: `PENDING HUMAN VALIDATION` — run a shared operation, an absent-worker operation, and a later return; verify selective reaction, retained legitimate geography/history, no missed-operation knowledge, and no wrong phase/location speech.
- Pass 14B must consume `tools/q4-personnel-continuity.js` (`reactionContext`, `salience`, `react`, `decisionContext`, `decide`, `presentReaction`), `tools/q4-personnel.js` (`staffQ4`, `observerStatus`), `tools/team-runtime.js` legal-order authority, `tools/survey-frontier.js` observer knowledge, and `desktop/service.js` delivered LOCAL/Standard boundaries. Do not give LOCAL or Standard natural-language interpretation direct canonical authority.

## Pass 14B handoff — Prompt 11 / 21

- Completed pass: `14B`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 14B commit, subject `feat: expand LOCAL intent and persistent Standard operator`. Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`.
- LOCAL authority: `tools/q4-local-intent.js` is a deterministic, no-write, bounded parser and validator. It proposes only recipient-scoped STAY, FOLLOW, MOVE, WAIT, RETURN, REPORT, ASSIST, INVESTIGATE, TRANSFER, and QUERY requests; `desktop/service.js#submitQ4LocalIntent` supplies only locally eligible workers, player-held equipment, and player-known locations, then calls communications, continuity decision, custody, and `tools/team-runtime.js#issueOrder` for canonical resolution.
- LOCAL safety: ambiguous or unsupported recipient, equipment, destination, or verb returns a clarification with no mutation. Compound input is a bounded sequence/parallel proposal whose elements resolve independently. Offline parsing is complete for this vocabulary; no provider is required or trusted. `validateProposal` rejects unknown action types, foreign personnel, unavailable equipment, and locations absent from the observer-safe context.
- Orders/save: accepted work is the existing structured `team_runtime.orders` plus member `current_task`; a supported deferred `TEAM_RETURN` condition is canonical task metadata. Request IDs in `expedition.local_intent_requests` make actual retries idempotent across save/reload. Existing structured team actions remain the equivalent canonical path.
- Standard operator: `tools/q4-standard-operator.js` creates one deterministic world-scoped operations-desk personnel identity, initialized when Clear-Q4 starts. Projection begins as `STANDARD` / `CONTROL DESK`; full personnel designation is withheld until repeated legitimate contact. It records only delivered/acknowledged Standard messages as bounded institutional contact history and shares no invented prior contact.
- Standard knowledge/latency: existing `tools/communication-runtime.js` and institutional response authority remain the delivery and response source. The operator is recorded only after delivery; failed transmissions add no knowledge or acknowledgment. `tools/q4-experience.js` projects only operator designation/contact state, while `context` accepts only an institutional observer-safe projection.
- Migration: no envelope schema change. Existing worlds receive the deterministic Standard identity on their first Clear-Q4 start and retain it immediately; old messages are not retroactively attributed. Legacy active team orders retain existing canonical fields, and no deferred LOCAL instruction is fabricated.
- Focused tests: PASS — `node --test tests/y37-q4-personnel.test.js tests/y38-q4-equipment.test.js tests/y50-structured-interactions.test.js tests/y51-mission-state.test.js tests/y52-operational-dynamics.test.js tests/y55-survey-frontier.test.js tests/y59-career-loop.test.js tests/y60-personnel-continuity.test.js tests/y61-local-standard.test.js`. LOCAL and Standard acceptance: PASS in `tests/y61-local-standard.test.js` (simple/compound transfer, ambiguity, unknown route, unsafe external proposal, parity/idempotence/reload, delivered-versus-failed Standard contact, persistence).
- Desktop build: PASS — `npm run desktop:build`; source launch `npm run desktop:dev`; packaged executable `dist\\desktop\\win-unpacked\\Yellow Beast.exe`. Human gate: `PENDING HUMAN VALIDATION` — exercise a nearby simple, transfer, movement, question, compound, ambiguous, and unsafe command, then work two operations with Standard while contrasting a delivered report with an undelivered fact.
- Pass 15A should consume `tools/q4-local-intent.js` (`parse`, `validateProposal`), `desktop/service.js#submitQ4LocalIntent`, `tools/team-runtime.js#issueOrder`, `tools/q4-standard-operator.js` (`ensure`, `recordContact`, `projection`, `context`), existing `tools/communication-runtime.js`, and the observer-safe `tools/q4-experience.js` projection. Do not broaden the parser into freeform scripting or grant either presentation/provider code canonical authority.

## Pass 13B handoff — Prompt 09 / 21

- Completed pass: `13B`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 13B commit (`feat: add persistent Clear-Q4 career loop`). Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`.
- Career authority: optional persisted `world.q4_career_state` (`yellow-beast-q4-career@v1`) records closed-operation chronology, completed cycle IDs, and concise institutional updates. Legacy worlds initialize it only when their next real operation closes; no history is invented.
- Between-operation authority: `tools/q4-career-loop.js#process`, called only from the completed Clear-Q4 debrief advance path. Its stable cycle ID derives from world, run, and closed mission; completed IDs make re-entry/reload requests no-ops.
- Deterministic order: reconcile/close operation; resolve existing institutional review; update equipment service; update temporary personnel availability; expose the resulting canonical state to Pass 13A. The processor never issues a mission; `tools/q4-assignment-engine.js` remains the sole work-order issuer.
- Bounded activity: depleted/damaged returned equipment moves into routine service and a later cycle may complete it; missing/abandoned equipment is never restored. One eligible non-player worker may be temporarily assigned to support and returns deterministically; no career processor path writes death, missing, injury, or permanent-removal status. Persistent eligible Q4 records are preferred for a qualified repeat team, with generation retained when mandatory roles cannot be staffed.
- Presentation: `tools/q4-experience.js` projects compact canonical career updates; `desktop/renderer/surfaces.js` renders them as institutional updates. The renderer owns no career state.
- Focused tests: PASS — `node --test tests/y58-assignment-engine.test.js tests/y59-career-loop.test.js tests/y37-q4-personnel.test.js tests/y38-q4-equipment.test.js` (20). Includes processing ordering/idempotence/save-reload, lost equipment, temporary personnel availability, agency-boundary invariant, and 3-operation chronology.
- Multi-operation career acceptance: automated PASS. Desktop build: PASS (`npm run desktop:build`). Human gate: `PENDING HUMAN VALIDATION` — perform three operations, inspect each debrief/next briefing update, verify persistent coworkers/geography/history and that lost gear remains unrecovered until returned.
- Pass 14A starting interfaces: `tools/q4-career-loop.js` (`ensure`, `process`, `projection`, `assertAgencyBoundary`), `tools/q4-personnel.js` (`staffQ4`, persistent character records), `tools/world-history.js` character history, `world.q4_career_state`, and `tools/q4-assignment-engine.js`. Do not alter the cycle’s irreversible-personnel boundary without an explicit Pass 16 authority.
## Pass 15A handoff — Prompt 12 / 21

- Completed pass: `15A`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 15A commit. Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`.
- Evidence authority: `tools/q4-evidence-authority.js` owns persistent `world.q4_evidence_archive` records. Existing event-created IDs are retained; new records are created only at RECORD/object-interaction authority events and carry structured provenance, custody history, reporting state, institutional availability, confidence, links, contradiction IDs, and canonical-fact-only render specs. Render status is independent and remains `not-rendered` in this pass.
- Custody/access: created field evidence is player-accessible and not Standard-accessible. Delivered reports link records without granting artifact possession; return processing moves eligible returned records to `Standard` / `Facility archive`. Lost records remain canonical but absent from Standard projection. Legacy `world.evidence` migrates as `unknown / legacy record` without invented custody.
- Archive: `q4-experience` projects only observer-accessible archive evidence and structured conflicts; the debrief institutional-archive surface presents identifiers, location, custody, Standard availability, reporting state, and conflicts. It is a projection, not a duplicate authority.
- Focused tests: PASS — `node --test tests/y62-evidence-archive.test.js tests/y42-q4-async-interface.test.js tests/y61-local-standard.test.js` (17). Includes capture/provenance/render boundary, custody, Standard availability, hidden-record projection, structured contradiction, and legacy migration. Desktop build: PASS — `npm run desktop:build`. Human gate: `PENDING HUMAN VALIDATION`.
- Pass 15B consumes `tools/q4-evidence-authority.js#archive` record `render_spec` and `render_status`, plus `tools/q4-visuals.js` presentation vocabulary. It must not create/modify evidence truth or use hidden state.

## Pass 15B handoff — Prompt 13 / 21

- Completed pass: `15B`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 15B commit. Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`. Render pipeline: `yellow-beast-evidence-render-pipeline@v1`.
- Media authority: `tools/q4-evidence-media.js` consumes an existing `world.q4_evidence_archive` record only after `validateSpec`; it cannot capture evidence or write semantic fields. `tools/q4-evidence-authority.js#setPresentation` accepts only render presentation metadata (`status`, request/attempt ID, safe provider metadata, artifact reference/checksum, seed, and error). Provider claims/captions are ignored; no image analysis or canonical backpropagation path exists.
- Eligibility/spec: only photographic/recovered-photographic/film-frame/scanned-visual record types with the Pass 15A render-spec shape are eligible. Requests are deterministic from allowed fields only; hidden/future/Standard-only/developer terms are rejected. Captions/alt labels remain canonical metadata-derived.
- Provider/fallback: settings select disabled/offline fallback, optional local injection seam (`comfyui` setting), or optional hosted injection seam. Neither provider is bundled, configured, or required; both report unavailable safely without a registered adapter. The fallback is an explicitly labelled metadata card. Timeout, malformed/corrupt output, and provider errors become presentation failure only.
- Storage/retry: accepted PNG/JPEG/WebP artifacts are hash-validated and stored under managed application-data `media/<world-id>/`, while saves keep references only. Stable request IDs derive from evidence ID/spec/pipeline/revision; service- and renderer-level in-flight maps suppress duplicate calls. Retry adds a presentation attempt/revision and never creates evidence. Missing files project as `unavailable` with a safe rerender control.
- Archive/diagnostics: the observer-safe archive retains metadata, custody, reports, and conflicts as primary content; it displays an artifact when valid or the labelled fallback otherwise. `DesktopService#getDiagnostics` and tester reports export safe pipeline/provider/request/status/error/artifact/seed/model data and redact credentials.
- Migration/save: no envelope version change. Existing/legacy evidence receives `render_presentation` initialized from `render_status`; no historical record auto-renders and no provider/network availability is needed on load.
- Focused tests: PASS — `node --test tests/y62-evidence-archive.test.js tests/y63-evidence-media.test.js tests/y42-q4-async-interface.test.js` (15). Covers canonical-first request, observer-safe request construction, provider invention isolation, provider error/timeout/invalid artifact, offline fallback, retry, duplicate suppression, missing artifact, contradiction isolation, save/reload reuse, and legacy evidence. Desktop build: PASS — `npm run desktop:build`. Truth-safe media acceptance: PASS. Human gate: `PENDING HUMAN VALIDATION`.
- Pass 16A starting interfaces: `tools/q4-evidence-authority.js` canonical render specs and `tools/q4-evidence-media.js` presentation-only boundary; `desktop/service.js#renderEvidence`/`decorateEvidenceMedia`; `desktop/renderer/surfaces.js` archive projection. Environmental simulation may add canonical captured visual facts only through its own authority before evidence capture; it must not consume generated pixels or make evidence/media presentation authoritative.

## Pass 16A handoff — Prompt 14 / 21

- Completed pass: `16A`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C — CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 16A commit. Version remains `0.14.0-beta.1`; active envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`.
- Environment authority: `tools/q4-environment.js` (`yellow-beast-q4-environment@v1`, config `yellow-beast-q4-environment-config@v1`) owns bounded canonical location conditions in `world.q4_geography.environment`, persisted through `tools/spatial-runtime.js#canonicalSnapshot`. It models power, lighting, communications coverage, structural condition, moisture, and acoustic context; current descriptions and UI consume the state rather than define it.
- Dependencies/init: a bounded `relay-circuit` infrastructure dependency supplies local lighting and repeater coverage to the Relay Alcove / Service Bypass vicinity. First materialization uses domain-separated seed data only for generated locations; authored locations receive conservative mundane defaults. Existing snapshots lacking environment state initialize without faults or fabricated history.
- Cross-system behavior: environment reconciliation turns the existing relay hazard into a canonical power loss; power updates lighting and communication coverage, while `tools/communication-runtime.js` remains the message delivery authority. Unavailable coverage fails radio delivery without informing Standard; weak/intermittent coverage delays it. Structural blocks remain spatial topology with `blocked_paths`; environment records their unresolved condition. Field-light capability produces only a visibility mitigation state. Meaningful mutations have compact environment history and are appended once to world history during `desktop/service.js#persistSession`.
- Knowledge/conditions: `tools/q4-experience.js` projects only the current observed location’s conditions, including accessible text in field observation; unobserved location state is not mapped into player projection. A delivered field radio report marks an unresolved condition institutionally available. `tools/q4-assignment-engine.js` consumes that condition to derive bounded route-verification service work; environment never directly creates an order.
- Evidence/render: `tools/run-bootstrap.js` captures observer-visible environmental context at evidence creation; `tools/q4-evidence-authority.js` stores it as canonical capture-time provenance and passes only allowed fields into the Pass 15B render spec. `tools/q4-evidence-media.js` validates/render-requests the capture context only. Generated images remain unable to influence environment or evidence truth.
- Diagnostics/save: `DesktopService#getDiagnostics` identifies the environment authority/config; tester exports include safe current-location/infrastructure/condition diagnostics. No envelope schema bump or network/provider dependency. Current canonical environment, infrastructure state, route modifiers, markers, and history survive save/reload; no automatic reroll occurs.
- Focused tests: PASS — `node --test tests/y64-environment-simulation.test.js tests/y52-operational-dynamics.test.js tests/y58-assignment-engine.test.js tests/y62-evidence-archive.test.js tests/y63-evidence-media.test.js` (37) and `npm run desktop:test` (16). Covers power cascade/restoration, transmission/Standard boundary, structural blockage, lighting mitigation/no hidden facts, capture-time evidence context, deterministic initialization/migration, assignment consumption, and reload. Desktop build/verify: PASS — `npm run desktop:build`, `npm run desktop:verify`. Human gate: `PENDING HUMAN VALIDATION`.
- Pass 16B starting interfaces: `tools/q4-environment.js` (`ensure`, `reconcile`, `mutatePower`, `blockRoute`, `clearRoute`, `observation`, `captureContext`, `assignmentConditions`), `tools/spatial-runtime.js` canonical topology/blocking, `tools/communication-runtime.js` coverage-aware delivery, `tools/q4-evidence-authority.js` capture-time render specs, and `tools/q4-assignment-engine.js` delivered condition consumption. Do not let Pass 16B phenomena alter observer knowledge, create assignments directly, or use rendering as truth.

## Pass 16B handoff - Prompt 15 / 21

- Completed pass: `16B`; checkpoint: `NO`; next checkpoint: `Prompt 16 / Pass 16C - CHECKPOINT 3`. Branch: `agent/pass-10-release-candidate`; resulting commit: this local Pass 16B commit, subject `feat: add rare persistent entity and phenomenon ecology`. Version remains `0.14.0-beta.1`; active schemas remain `yellow-beast-session@7`, `yellow-beast-save@v9`, `yellow-beast-run@v9`, and `yellow-beast-world-history@v1`.
- Authority/version: `tools/q4-phenomenon-ecology.js` is the single Clear-Q4 phenomenon/entity authority (`yellow-beast-q4-phenomenon-ecology@v1`, records `yellow-beast-q4-phenomenon-record@v1`, config `yellow-beast-q4-phenomenon-config@v1`). Instances persist in existing canonical `world.phenomena`; `world.q4_phenomenon_ecology` stores eligibility history, cooldown, conditions, incidents, and diagnostics metadata. The prior stationary-only YB-23 Still Life fixture remains legacy-scoped; Simulation Doctrine governs the Q4 heterogeneous family.
- Doctrine conflict record: pre-Pass-16B `docs/phenomena-world.md`, `docs/entity-simulation.md`, and the YB-23 source-local behavior ledger described only a stationary Still Life fixture. They did not declare a Simulation Doctrine amendment and therefore cannot govern the Q4 family. The documents now explicitly scope that restriction to the legacy fixture; Pass 16B preserves the Doctrine's persistent heterogeneous Still Life authority.
- Rarity/placement: production rolls once per newly generated location using SHA-256 over world seed, config version, and stable location ID; authored and migrated geography is grandfathered ordinary. Roll denominator `1,000,000`; world cap `2`; region cap `1`; entity cap `1`; family cap `1`; four-location cooldown; generated depth minimum `5`; Still Life minimum `8` / weight `3`; Bacteria minimum `11` / weight `1`. No mission-start roll, drought compensation, reroll, or guaranteed encounter.
- Families: spatial inconsistency and transient architecture are persisted overlays through `spatial-runtime.applyPhenomenonState` with fixed Threshold protection; object displacement preserves object identity through `object-runtime.relocate`; acoustic anomaly stores source/timing/affected-region/eligible-hearer events; environmental discontinuity uses explicit environment overrides; evidence inconsistency links existing evidence contradictions. Still Life and Bacteria are persistent canonical entity records.
- Ontology/knowledge: exact internal `STILL_LIFE` / `BACTERIA` controls behavior and is absent from ordinary projection, map, archive, evidence render spec, report, work order, and safe diagnostics. `observe` creates per-observer safe designations only after eligible contact. `coinAlias` persists world-local provenance and informed-observer scope; Standard receives neither designation nor nickname without delivered reporting.
- Still Life: stable instance profile is separate from current state. Profiles cover inert/non-breathing, breathing/passive, vocal/fear, flight, aggression/contact, light interaction, hazard-seeking, and extreme low-reactivity. Reactions require perceived stimuli; legal movement uses canonical edges; lamp changes use `q4-environment.mutateLocation`; physical contact hands qualitative consequences to the existing consequence authority. No profile rerolls on mission, revisit, renderer mount, or load.
- Bacteria: stable state includes hulking elongated red/black visible morphology, acquired-speech provenance, uncertain-source mimic events, local/acoustic target acquisition, speed-two legal route pursuit, capture/restraint, and environmental slamming. Capture blocks impossible free movement. Slams use `consequence-runtime.apply` to produce serious injury then incapacitation; no numeric damage, HP, weapons, loot, combat turns, death, or world retirement.
- Integrations: `run-bootstrap.look/status` performs observer-safe contact and accessible textual projection; co-observation enters Pass 14 salience with repetition suppression. LOCAL/radio speech can be acoustically acquired; only delivered Standard reports establish institutionally available conditions. Evidence links after legitimate capture and remains presentation-independent. `q4-assignment-engine` alone derives follow-up work from delivered unresolved conditions. Environment, spatial, object, communication, personnel, hazard/consequence, evidence, and assignment authorities remain the mutation boundaries.
- Controlled fixtures/diagnostics: `instantiateFixture` requires the private Pass 16B control token; desktop control is additionally gated by `YELLOW_BEAST_DEVELOPER_MODE=1` through `DesktopService#controlQ4PhenomenonFixture` and its explicitly state-changing developer-console panel. It supports explicit family/location/profile and deterministic observe/stimulus/speech/mimic/acquire/pursue/capture/slam/alias actions. Ordinary diagnostics expose version/config/errors only; developer diagnostics expose canonical family counts, fixture status, and deterministic seed.
- Migration: no schema bump. Existing worlds initialize ecology metadata, mark existing geography evaluated/ordinary, preserve all geography/environment/evidence, and receive no population, sightings, aliases, incidents, or institutional knowledge. Instantiated records are stored, not reconstructed from seed, and survive later config changes.
- Automated status: focused phenomenon ecology, rarity, terminology, alias, Still Life, Bacteria, evidence, assignment, salience, environment, serialization, and controlled-desktop tests: `PASS`. Rarity matrix: `PASS` (48 deterministic production worlds; at least 40 entirely mundane; caps asserted). Controlled encounter and terminology acceptance: `PASS`. Desktop build status is recorded after packaging below. Human gate: `PENDING HUMAN VALIDATION`. Known blockers: none.
- Desktop package: `npm run desktop:build` and `npm run desktop:verify` PASS; offline executable smoke PASS. Source launch: `npm run desktop:dev`; packaged launch: `dist\desktop\win-unpacked\Yellow Beast.exe`. Human validation uses normal production configuration for mundane runs and `YELLOW_BEAST_DEVELOPER_MODE=1` plus `controlQ4PhenomenonFixture` for explicit Still Life, Bacteria, and alias cases.
- Pass 16C must consume `tools/q4-phenomenon-ecology.js` (`record`, `isCaptured`, `bacteriaSlam`, incident/capture state), `tools/consequence-runtime.js` qualitative personnel effects, `tools/hazard-runtime.js`, `world.q4_phenomenon_ecology.incidents`, persisted `world.phenomena`, `run.expedition.phenomenon_contact`, `tools/world-history.js`, `tools/q4-personnel-continuity.js`, and `tools/q4-career-loop.js`. Add terminal mortality/world retirement at outcome authority; do not add death to Pass 16B behavior or presentation.

## Pass 16C handoff — Prompt 16 / 21 — CHECKPOINT 3

- Completed pass: `16C`; checkpoint: `CHECKPOINT 3`; resulting commit: this local Pass 16C commit. Version remains `0.14.0-beta.1`; save envelopes remain `yellow-beast-session@7`, `yellow-beast-save@v9`, and `yellow-beast-run@v9`; world-history version is unchanged. Existing worlds migrate conservatively by initializing `world.q4_lifecycle` as `ACTIVE` and an empty `q4_legacy_personnel` index—no casualty, retirement, terminology, or hidden knowledge is inferred.
- Outcome/lifecycle authority: `tools/q4-outcome-authority.js` resolves already-authoritative personnel consequences into persistent `minor injury`, `serious injury`, `incapacitated`, `recovering`, `missing`, and `dead`-compatible personnel status. Death is irreversible; missing remains separate from objective death and final institutional records retain only delivered Standard facts. `q4-continuity` remains the review authority.
- Player terminal handling: player death creates a safe `CONTACT LOST / FINAL ACCOUNTABILITY RECORD`, marks `RETIREMENT_PENDING`, then `DesktopService#persistTerminalRetirement` commits the retired world before writing its terminal session. A crash therefore leaves either a pre-terminal save or an immutable retired world, never ordinary playable continuation after death.
- Retirement/archive: `world.q4_lifecycle.status = RETIRED` is the canonical lifecycle state. Desktop start/resume/action paths reject ordinary play; `getRetiredWorldArchive` exposes read-only reviews/evidence/final record. `q4-career-loop` rejects between-operation processing. `world.q4_legacy_personnel` stores the historical controlled-personnel record, while application metadata maintains a safe legacy archive index. New worlds start from `createWorld` with no legacy state or observer knowledge transfer.
- Ontology/designation: Pass 16B `q4-phenomenon-ecology` remains the canonical identity and designation authority. Exact `STILL_LIFE`/`BACTERIA` family identity controls simulation only; outcomes/final incidents use no canonical names. World-local aliases retain provenance/scope and do not institutionalize automatically or transfer to new worlds.
- Focused acceptance: PASS — `node --test tests/y66-outcomes-retirement.test.js tests/y65-phenomenon-ecology.test.js tests/y59-career-loop.test.js tests/y37-q4-personnel.test.js tests/y51-mission-state.test.js`; includes injury/missing/death persistence, retirement immutability, crash-after-world-commit safety, legacy isolation, and terminology/alias boundary. Full suite: PASS — `npm test`. Desktop build/verify: PASS — `npm run desktop:build`, `npm run desktop:verify`; offline executable smoke PASS. Human gate: `PENDING HUMAN VALIDATION`.
- Checkpoint status: `CHECKPOINT 3 AUTOMATED EXIT: ACCEPTED`. Pass 17 consumes `q4-outcome-authority` (`archive`, `lifecycle`, `isRetired`) and the read-only `DesktopService#getRetiredWorldArchive`; presentation/provider/AV work must not mutate lifecycle, outcomes, entity identity, or observer designations.

## Pass 17 opening intervention — Prompt 17 / 21 — CHECKPOINT 3 HUMAN-GATE FAILURE REPAIR

- Completed scope: opening interaction, player authorship, unified communications, doctrine/provider provenance, settings reachability, and focused Electron-facing acceptance repair. Checkpoint remains `NO`; next checkpoint is `Prompt 18 / Pass 18 — CHECKPOINT 4`.
- Branch: `agent/pass-10-release-candidate`; HEAD remains local-only. Version remains `0.14.0-beta.1`; active session schema remains `yellow-beast-session@7`.
- Player authorship: `submitAction(RADIO_CHECK)` is now rejected with `PLAYER_TRANSMISSION_REQUIRED`; only `submitQ4Communication` with the player's submitted text creates the radio-check message. Standard acknowledgment remains a canonical scheduled response and requires a deliberate interval-resolving action before field entry.
- Unified communications: `desktop/renderer/surfaces.js` renders one chronological communications surface with one composer and LOCAL/STANDARD mode identity. LOCAL defaults to all nearby eligible participating personnel; direct addressing is optional. LOCAL has zero operational interval cost and cannot silently execute a physical action.
- Runtime interpreter audit: `desktop/service.js#submitNatural` selects `deterministic-mock` in offline mode and `openai` only when explicitly configured. The tested Q4 observation/action fast paths are deterministic and do not invoke a provider. `tools/doctrine-runtime.js` loads the live `SIMULATION_DOCTRINE.md`, hashes the complete source, and supplies bounded priority sections plus the source hash to every applicable natural interpretation context. Context order is canonical world/simulation/institution/observation/presentation, with candidate-only provider output and canonical resolution after response. Developer-only `getInterpretationProvenance` and `getDeveloperSnapshot` report request ID, provider/model, doctrine hash, context hash/sections, projection, and canonical resolver; ordinary UI receives none of this hidden context.
- Fallback: no provider or provider failure leaves canonical state safe and returns a visible recoverable error; offline deterministic behavior remains complete.
- Settings: `.settings-surface` now owns its own keyboard/wheel/scrollbar viewport with sticky controls and scroll-padding for focused controls. Existing save/apply, close/reopen, persistence, and Electron service coverage remain active.
- Human gate: `PENDING HUMAN VALIDATION`. Required manual route: type the radio check in STANDARD, verify no generated YOU speech; send two LOCAL messages without interval resolution; perform a deliberate physical ACTION; inspect developer provenance; disable/fail provider; keyboard-tab through Settings at the required sizes/scaling.
- Resulting commit: `29d5143` (`feat: repair Pass 17 opening interaction gate`). Desktop build/verify: PASS — `npm run desktop:build`, `npm run desktop:verify`; offline executable smoke PASS. Packaged doctrine assets verified in `resources/app.asar`.

### KNOWN CANONICAL BEHAVIOR CORRECTIONS

- Still Life: no new renderer behavior was invented. Presentation must continue consuming observer-safe instance state and remain compatible with inert, breathing/passive, vocal/fear, fleeing, aggressive, light-interaction, hazardous self-directed movement, and low-reactivity outcomes. The existing canonical phenomenon authority remains the owner; broad variability requires human fixture validation.
- Bacteria: no new renderer behavior was invented. Presentation must continue consuming observer-safe mimicry, pursuit, capture, and slamming consequence state without combat UI or canonical-name leakage. The existing canonical phenomenon authority remains the owner; human fixture validation remains pending.

### Pass 18 starting files

## Pass 17 reopened repair - packaged input and interpreter authority

- Root cause: the packaged renderer contained a startup `SyntaxError` from duplicate `const message` declarations in the Settings path. The previous verifier used DOM activation and therefore never exercised the failing packaged renderer. `desktop/renderer-smoke.js` now uses Electron `webContents.sendInputEvent` mouse and keyboard dispatch, Chromium hit testing, focus/value checks, and renderer console/process diagnostics. Renderer failures show a recoverable error surface with retry/back navigation.
- Settings lifecycle: `settingsController` owns closed/opening/open/saving/saved/closing states, mounts before querying controls, keeps one mounted surface, restores opener focus, and prevents stranded save/error states. `npm run desktop:settings-regression` builds the packaged executable and runs the native Settings regression through `desktop:verify`.
- Authority registry: `tools/authority-registry.js` explicitly registers constitutional doctrine, design/runtime/provider contracts, Clear-Q4 worldpack records, terminology, personnel, and phenomenon sources with repository paths, classification, scope, required status, byte size, load time, and SHA-256. Required load failure returns visible `AUTHORITY_UNAVAILABLE` recovery rather than generic interpretation.
- Interpreter context: `tools/ai-adapter.js#executeNatural` assembles the final provider request in doctrine, worldpack/domain, canonical state, observer projection, history, exact player submission, and response-contract order. Provider context contains source IDs/hashes and does not expose hidden canonical projections. Desktop provenance records execution mode, provider/model, invocation, response classification, authority source metadata, and ordered sections.
- Verification: native packaged interaction and Settings persistence PASS; `node --test tests/y63-pass17-state-machine.test.js tests/y64-pass17-authority.test.js` PASS; `npm run pass17:authority-test` PASS. Full suite and final packaged build are pending this reopened repair. Do not begin Prompt 18.

- `desktop/service.js`, `tools/doctrine-runtime.js`, `tools/q4-experience.js`, `tools/communication-runtime.js`, `tools/q4-radio.js`, `desktop/renderer/surfaces.js`, `desktop/renderer/renderer.js`, `desktop/renderer/styles.css`, `tests/y61-local-standard.test.js`, and `tests/y62-pass17-human-gate.test.js`.
## Pass 17 human-gate repair — actual state-machine correction

- The rejected 4fd24695 behavior was reproduced and repaired at the production boundaries. Fresh Clear-Q4 sessions expose one preparation surface and one deliberate `DEPLOY` action; briefing/staging/transit/threshold presentation controls no longer advance operational time. A compatibility seam accepts legacy scripted actions only for migration-era records and is not exposed by the production projection.
- Radio authorship now remains player-owned end to end: `submitAction(COMMUNICATE)` and `RADIO_CHECK` reject without player text; the readiness projection selects STANDARD and leaves the shared composer empty; `submitQ4Communication` records only the submitted text as YOU. Communication resolution now distinguishes composed, queued, transmitting, delivered, acknowledged, failed, expired, timeout, cancellation, and retry recovery. Unavailable coverage cannot enter `AWAITING RESPONSE`.
- `operational-cycle` and Q4 interaction records retain a deterministic `submission_id`, connecting phase/objective/time changes to the initiating player submission. LOCAL dialogue includes the submitted statement in offline deterministic responses and keeps zero interval cost.
- Packaged Electron renderer smoke now clicks actual Settings controls, reaches the final control, saves, closes, reopens, and verifies persisted state. `desktop:verify` runs both packaged service and renderer interaction smoke. Focused state-machine coverage is in `tests/y63-pass17-state-machine.test.js` with runtime nonce text.
- Verification: full `npm test` PASS; focused Pass 17/state-machine tests PASS. Packaged build and artifact verification remain the final handoff checks for this repair.

## Pass 17 reopened repair - profile contamination and first-run input gate

- Root cause: the prior packaged smoke launched without an explicit Electron user-data profile. Its visible world-creation loop therefore wrote automated `native-world-*`, `Untitled field file`, and `Packaged smoke` records into the ordinary `%APPDATA%\\yellow-beast\\yellow-beast` profile. It also never asserted an empty first-run world list, so it could not certify the naming surface that a new player actually uses.
- Isolation: packaged smoke, renderer/Settings smoke, and first-run smoke now require an absolute path below the OS temporary directory through `--test-profile`. The executable sets Electron `app.userData` to that path, writes a visible `yellow-beast-test-profile.json` marker, and refuses a normal launch against a marked profile. The verifier hashes the resolved production profile before and after each packaged run and fails on any byte-level change.
- First-run: `desktop/first-run-smoke.js` uses native Electron mouse and keyboard dispatch against a genuinely empty isolated profile. It verifies the visible Create World control, naming surface hit testing/topmost state, focus, runtime nonce input, validation/submission, exactly one persisted world, and first-run personnel surface. Command: `npm run desktop:first-run-regression`.
- Naming diagnosis: no independent naming-surface defect reproduced in the empty packaged profile after isolation; the release failure was contaminated-profile state plus missing first-run coverage. The old smoke began from a non-empty profile and was therefore not evidence for first-run interaction.
- Production data: the ordinary profile was inspected read-only. Automated records remain preserved pending human authorization; no world, save, settings, credential, or profile file was deleted or rewritten by this repair. The safe recovery proposal is to quarantine only the individually resolved automated world/save paths after approval.
- Human gate: `BLOCKED / PENDING HUMAN RETEST`. Interpreter provenance remains automated evidence only until a human can complete clean first-run naming and real packaged input. Do not begin Prompt 18.

## Recovery Prompt 1 - clean-profile packaged world creation

- Scope/status: Recovery Prompt 1 only. Automated acceptance is `PASS`; overall status remains `HUMAN VALIDATION PENDING`. Recovery Prompt 2, Prompt 18, Pass 18, and later campaign work are not started. Starting point was clean `1338d55e75fb0a2b54a773df6bbd0de8fc4791a4` on `agent/pass-10-release-candidate`.
- Ordinary production storage was inspected read-only. Electron `userData` resolves to `C:\Users\jroch\AppData\Roaming\yellow-beast`; application data resolves to `C:\Users\jroch\AppData\Roaming\yellow-beast\yellow-beast`. The application root contains `worlds`, `saves`, `media`, `credentials`, `desktop-worlds.json`, `desktop-settings.json`, and application diagnostics under `logs`; Electron/Chromium cache and browser state remain in the parent `userData` root.
- The four originally reported unexpected worlds are `world-c9997840e813` / `native-world-1786195134290` (`2026-08-08T13:18:54.444Z`), `world-b335147a37d7` / `native-world-1786195203354` (`2026-08-08T13:20:03.493Z`), `world-87c9275746db` / `native-world-1786195277691` (`2026-08-08T13:21:17.844Z`), and `world-cabd3ac569bd` / `native-world-1786195353899` (`2026-08-08T13:22:34.057Z`). Each is an empty canonical world with no characters, runs, events, or saves. Their names and embedded millisecond epochs exactly match the old `desktop/renderer-smoke.js` `native-world-${Date.now()}` automation. At inspection time the metadata index contained 17 worlds, not four, including additional `native-world-*` and `Untitled field file` records. `C:\Users\jroch\AppData\Roaming\yellow-beast\desktop-smoke` also contains the old service-smoke `Packaged smoke` fixture and mode saves.
- Production-profile impact predates this recovery: the old packaged automation used the ordinary profile. It created the automated worlds and set `desktop-worlds.json` first-run/last-world metadata. `desktop-settings.json` also contains the exact automation nonce form `settings-runtime-*`, establishing that renderer smoke modified settings as well as worlds. The credentials file predates the identified August 8 automation and was inspected only by metadata/hash; no credential content was exposed and no evidence showed that the smoke changed it. All pre-existing records remain preserved.
- Naming/opening diagnosis: an empty packaged profile accepted genuine native mouse and keyboard input, so no independent overlay, focus, preload, or text-entry lock was reproduced. The exact production failure on the required visible route was the world-mode action parser: `mode:field-researcher` used `action.slice(6)`, producing `ield-researcher` and preventing the created world from opening. The former first-run smoke called `enterMode` directly after creation and therefore bypassed the visible world-list/mode path. Contaminated production state plus this bypass made the earlier automated pass unreliable.
- Repaired production path: the naming controller prevents duplicate in-flight submission, awaits persistence, closes back to the refreshed world library, and displays the new world once. The deliberate visible world/mode path now parses the `mode:` prefix with `slice(5)` and opens the created world. Canonical identity and persistence remain owned by `DesktopService`; no fixture, direct service creation, synthetic DOM dispatch, or hard-coded test name is used by acceptance.
- Test-profile isolation: `desktop/profile-resolver.js` is the shared authority for application and launcher profile paths. Every automated Electron run receives an explicit unique `mkdtemp` root under the OS temporary directory with a visible `yellow-beast-test-profile.json` marker and random run ID. Resolution rejects an absent/unmarked/non-temporary test root and any equality, descendant, or overlap with the production profile. Separate parallel runs receive separate roots. Exact-root cleanup revalidates the marker, root, run ID, temporary-directory containment, and production separation before removal; failed runs are preserved for diagnosis. All saves, settings, credentials, media, logs, and Electron cache state resolve inside the test `userData` root.
- Packaged first-run regression: `npm run desktop:first-run-regression`. It builds the current checkout, verifies packaged version/commit provenance, snapshots the full ordinary `userData` tree without exposing file contents, launches the actual packaged executable against a new zero-world marked profile, clicks and types with Electron native input, verifies topmost hit testing/focus/exact runtime nonce value, creates exactly one persisted world, opens it through visible controls, quits, starts a second packaged process against the same profile, verifies exactly one matching world, reopens it, and proves the production snapshot unchanged before exact-root cleanup.
- Focused validation: `npm run recovery:first-run-focused` is `PASS` (20 tests); `node --test tests/y67-recovery-profile.test.js` is `PASS` (4 tests); asset validation and diff checks are `PASS`. Full `npm test` is `PASS`. `npm run desktop:build`, the dedicated packaged first-run regression, and `npm run desktop:verify` are `PASS`; both packaged smoke profiles were isolated and the full 121-file production snapshot remained byte-for-byte unchanged.
- Artifact: `dist\desktop\win-unpacked\Yellow Beast.exe`. The final build must be launched normally, without test-profile flags, for Jack's planned ordinary-profile acceptance. The four reported worlds and all other existing production records must remain present; one deliberate human-created world should appear exactly once and persist across relaunch.
- Known unrelated work: no Settings, provider, dialogue, radio, ACTION, exploration, map, presentation, onboarding, interpreter, or later-game behavior was repaired. Electron-builder's default-icon warning and Node's `DEP0190` warning remain non-blocking. One failed, marked diagnostic profile under the OS temporary directory was intentionally preserved; it is outside production and contains no production data.
- Human gate: `HUMAN VALIDATION PENDING`. Do not begin Recovery Prompt 2 or Pass 18 until Jack explicitly accepts the packaged create/open/quit/relaunch/reopen route.

## Historical Phase 01C proposed authority-conflict handoff — 2026-08-12

- Historical status at time of writing: Phase 01C was documentation-only and awaiting human ratification. Phase 01C has since been ratified and V01 has reconciled the listed authority conflicts; the current-orientation section at the top of this file governs.
- The owner-ratified product decision that employee death may end a career while the persistent world remains available for a new employee directly conflicts with the active whole-world retirement requirements in Simulation Doctrine §§19.13–19.17 / Laws XL–XLI and related Design Charter language.
- The sanctioned pre-expedition metagame restore and ASYNC save boundaries require deliberate reconciliation with active retirement/save language. Canonical persistence, invisible crash recovery, ephemeral session state, player checkpoint state, and branch-abandoning metagame reload must be separate authorities.
- Deterministic real-elapsed-time offline progression requires an explicit bounded worldpack exception under the Doctrine's wall-clock rules. It must not authorize uncontrolled timer mutation and must include a scheduler constraint against systematic consumption of meaningful player opportunities.
- Phase 01C does not silently reinterpret or amend those rules. The first proposed implementation pass is a documentation/authority-only human checkpoint to legislate the conflicts before runtime repair. Current world-retirement, persistence, checkpoint, and action-driven time behavior therefore remains historical implementation state, not proof of conformance to the ratified product direction.

## Observer-safe dialogue bridge, internal wording runtime and checkpoint (2026-09-23)

- Semantic route (unchanged authority): canonical state -> observer/knowledge authorities -> `compileObserverDialogueContext` (`tools/observer-context-compiler.js`) -> structured capsule -> `renderContributionTask` (`tools/dialogue-prompt-contract.js`) + `authorized_contribution` -> local model -> semantic validation -> pre-commit revalidation (`revalidateContext`: identity, commit-sensitive staleness, whole-turn cancellation) -> canonical commit. Player replies and autonomous reports both use it. The renderer requires no canonical module.
- Canonical ontology: `tools/canon-lexicon.js` `CANONICAL_ENTITIES` (the Threshold is a fixed transition, non-portable). "threshold apparatus" was removed from player-facing/model-facing strings and is forbidden terminology; internal ids and canon claim files keep it.
- Internal wording runtime: llama.cpp b11146 + Qwen3-4B Q4_K_M (Apache-2.0, Qwen/Qwen3-4B-GGUF@bc640142), pinned with SHA-256 and request options in `tools/local-runtime-pin.json`; replaced Qwen2.5-1.5B after a same-packet benchmark. The application installs it silently on first start (`startDialogueRuntime`), verifies it against the pin with a streaming hash, binds 127.0.0.1 only with the web UI disabled, re-checks the runtime after a crash repair, and falls back to same-plan deterministic wording meanwhile. `tools/stage-runtime-resources.js` stages it into `resources/` for electron-builder; `desktop/runtime-smoke.js` proves the packaged app reaches READY with no orphan process.
- Known baseline, not caused by this pass: `npm test` stops at the verification-inventory gate (already INCONSISTENT at HEAD, 26 errors; new test files are unregistered); 81 tests are red at HEAD and 82 in this tree (y73 legacy-authorization and LOCAL-recall tests now conflict with the ED-2 personal-experience validator, y91 now passes); packaged `renderer-smoke` asserts a settings `local_model` nonce that settings schema v8 no longer stores; y76 #13 and y97 fail at HEAD.
