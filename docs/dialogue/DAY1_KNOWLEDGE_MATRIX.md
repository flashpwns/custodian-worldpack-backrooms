# Day-1 Coworker Knowledge Matrix (current playable slice only)

Scope: the Clear-Q4 Day-1 opener, from assignment through the Maxwell briefing, `LOCAL_INTRODUCTIONS`, and the canonical states that follow it (staging, the post-crossing radio check). It is not a lore encyclopedia.

- Implementation: `tools/canonical-knowledge.js` (`knowledgeFor`, `queryKnowledge`, `heardPropositions`, `reportedSpeech`, `custodyHistory`, `baselineKnowledge`, `briefingKnowledge`, `procedureState`).
- Tests: `tests/ed29-day1-knowledge-convergence.test.js`.

Every grant records `concept`, `key`, `proposition`, `facet`, `authority_class`, `source_ref`, `grant_basis`, `epistemic_mode`, `valid_scope` and `commit_sensitive`. Many also record `entity_id`, `speaker_id`, `reported`, `activated_at` and `supports`. **No source → no grant.**

Three separate questions are asked of every fact:

1. Is it true in project canon?
2. Does this character know it, and how (provenance)?
3. May it be said on this turn? Only the response plan decides this. Knowledge alone never licenses speech, and the validator's contribution ceiling rejects any fact the turn did not authorize.

## Canon ratification

**Decision (project owner, 2026-09-25).** The Maxwell briefing used by the playable Day-1 opener is canonical Day-1 authored material.

**Audit against higher authority.** The delivered beats are the greeting, intro, mission statement, schedule, roster call and dismissal. None contradicts any of the following:

- the Simulation Doctrine;
- Gameplay Constitution §3, step 7: "Personnel brief the player on their randomly selected first assignment";
- Gameplay Constitution §3, step 8: "The player enters staging";
- `canon/SOURCE_POLICY.md`: the briefing is pack-authored Yellow Beast material. It is not Kane canon and needs no claim admission. Ratifying it admits no external canon;
- the Reference Expedition Specimen Brief §A: a boring, legible work order.

**Reconciliation (metadata only; the authored scene is unchanged).**

- `personnel_briefing.authority_status` changed from `legacy_unreconciled_briefing_material` to `ratified-day1-authored-canon`.
- `personnel_briefing.authority_provenance` is `cq4-day1-locked-design-law`, the same law as the mission record.
- `mission().authority.briefing_status` is `ratified-day1-authored-canon`, so the mission record and the briefing now agree.
- Saves that still carry the legacy label are relabeled when they are instantiated. No dialogue is rewritten.

**Not ratified.** `briefing_authority.threshold_sendoff` ("Proceed with a radio check upstairs, and they'll clear you. Nothing you haven't done before…") is never delivered at runtime. It conflicts with two things:

1. **Crossing order.** The owner's field procedure and the runtime opener (`q4-experience.nextPhase`: `CROSS` → `STANDARD_RADIO_CHECK`) put the radio check *after* crossing. The sendoff, `mission.procedures[1-2]` and `reporting.check_ins[0]` put it *before* crossing. This conflict is recorded and left unresolved in this pass; no text was changed.
2. **"Nothing you haven't done before"** contradicts a first assignment (Gameplay Constitution §2–3).

## Source authority classes used

| Class | Meaning |
|---|---|
| **OWNER-RATIFIED THIS PASS** (`L1_owner_ratified_day1_canon`) | The baseline induction, the baseline field-procedure *form*, the ASYNC sentence, Maxwell's identity and authority, startup-material semantics, and the minimal verbal-recall and layout-record definitions. |
| **EXISTING PROJECT AUTHORITY** (`L1_project_authority` / `L2_authored_current_slice`) | The Gameplay Constitution (§6 LOCAL/STANDARD); the worldpack `cq4-day1-opener.json` (`operational_window`, `assigned_manifest`, `guidance`, `mission.procedures`); `tools/q4-equipment.js` (camera and light capabilities); `canon-lexicon.js` (the Threshold is a fixed transition). |
| **BRIEFING-GRANTED** (`L2`, `epistemic_mode: briefing`) | A delivered Maxwell beat, granted only to the listeners of that beat. |
| **RUNTIME-DERIVED** (`canonical_runtime_event`) | Attendance, presence, custody observations, where the team stands, and heard lines together with the plans that authorized them. |
| **PLAYER CLAIM** (`epistemic_mode: player_claim`) | Something the player said. It is remembered as the player's claim and never becomes a grant. |
| **REFERENCE ONLY** | Kane Pixels material. Nothing from it was used or promoted. |

## BASELINE INDUCTION

Holders: every member of the current CQ4 Day-1 expedition, from assignment onward, before the briefing. Source class: owner-ratified this pass. None of these is commit-sensitive.

| Fact (proposition) | Project truth source | Epistemic form |
|---|---|---|
| ASYNC organizes and supports controlled research, documentation, logistics and expedition operations related to the Complex (this exact sentence, bounded). | Owner §4 | `baseline_induction` |
| We work for ASYNC; they assigned us to this expedition. | Owner §2 | `baseline_induction` |
| The Complex is the environment our expedition operates in. | Owner §2 | `baseline_induction`; a definition, not state |
| The Threshold is the fixed crossing between Standard and the Complex; it is part of the facility and not carried. | Owner §2; lexicon `threshold` (`fixed_transition`, not portable) | `baseline_induction`; a definition, not state |
| Standard is the ASYNC side of the crossing, the ordinary world. | Owner §2; Constitution §6 | `baseline_induction` |
| STANDARD communication is the A-Sync link between Standard and the team in the Complex. | Owner §2; Constitution §6 | `baseline_induction` |
| LOCAL is talking with the team in person. | Owner §2; Constitution §6 | `baseline_induction` |
| We're assigned to an expedition into the Complex. | Owner §2 | `baseline_induction` |
| Dr. Kirk Maxwell (identity only). | Owner §5 | `baseline_induction` |
| He's the Standard-side authority responsible for our assignment briefing (role and authority). | Owner §5 | `baseline_induction` |

Not granted by the baseline:

- "You can call me Kirk". It activates only with the intro beat.
- Friendship, shared history, rank or a medical specialty for Maxwell.
- Science, engineering, history, anomaly knowledge, biographies, topology or current state.

## BASELINE FIELD PROCEDURE

Holders: every Day-1 expedition member, from assignment. This is procedural *form* only: never today's holder, route, destination, timing or deployment state.

| Fact | Project truth source | Form |
|---|---|---|
| Right after crossing, a radio check with Standard, held at least two seconds before the crossing counts | Owner §3; `q4-experience.nextPhase` (opener order); `service.completeQ4CheckInHold` (≥ 2000 ms) | `baseline_field_procedure` (see the ordering conflict above) |
| Return: back to the Threshold, verify the return with Control Room surveillance, cross back to Standard | `mission.procedures[5]`, with today's deadline removed | `baseline_field_procedure` |
| At most two issued items per person | `assigned_manifest.hard_capacity_per_person`; `logistics-runtime` item count | `baseline_field_procedure` |
| Follow the neon-green guidance tape; the reverse arrows lead back | worldpack `guidance` (form only; "toward Outpost A" is mission knowledge) | `baseline_field_procedure` |
| The 35mm field camera is for photographic documentation | `q4-equipment` `DEFINITIONS["field-camera"].capability` | `baseline_field_procedure` |
| The field light is for illumination | `q4-equipment` `DEFINITIONS["field-light"].capability` | `baseline_field_procedure` |
| Observation and verbal recall means recording and preserving the expedition's field observations and verbal recall | Owner §7; roster wording; `mission().reporting.evidence` | `baseline_field_procedure` |
| The layout record is the expedition's record of the layout it observes and explores | Owner §7; the layout-record item's "layout documentation" capability; `reporting.evidence` | `baseline_field_procedure` |

**Not established (reported, not invented):** a green-tape *return-marker* procedure. The route-marker kit exists as equipment, but no project authority defines a marker procedure.

## MAXWELL BRIEFING

Holders: only the listeners of each delivered beat. `exchange_history[].listeners` and `at_interval` are stamped at delivery. Speaker: `dr-kirk-maxwell`. Source class: briefing-granted (L2). A partial briefing grants only the beats that were delivered; a flag such as `briefing_started` or `briefing_concluded` grants nothing on its own.

| Beat | Propositions (grant keys) | Epistemic form | Commit-sensitive |
|---|---|---|---|
| intro | "call me Kirk" (`maxwell_address_form`); he gave the briefing (`maxwell_gave_briefing`, observed); this is where he briefed us (`briefing_room_observed`, observed) | briefing / observed | no |
| mission_statement | today's assignment is delivery and introductory reconnaissance | briefing | no |
| schedule | departure 10:00 AM, return by 12:00 noon, cutoff 1:00 PM (L2 values; L4 line text) | briefing | no |
| roster_call | each teammate's assignment; the startup materials are going to Outpost A, Bermuda branch (`startup_material_destination`); who is delivering them; briefed custody | briefing | the custody snapshot is historical |
| dismissal | what Maxwell told us to do (`dismissal_instruction`, historical); the current procedure while introductions are open (below); Equipment Staging is where we report | briefing | the current procedure is |

## SELF KNOWLEDGE

| Fact | Source | Form | Commit-sensitive |
|---|---|---|---|
| Own role | `staffing.coworker_archetypes[].role` | self | no |
| Own assignment (phrase and its meaning) | roster slot + `primary_task` | self | no |
| Own held equipment | `equipment.*.holder` | self | yes (while held) |
| "I'm right here" | own location | self | yes |
| Own earlier lines ("What did you say?") | the plan that authorized that line | `own_speech` (never "heard myself") | no |

## HEARD KNOWLEDGE

Canonical proposition → spoken contribution → actual listeners → attributed heard knowledge.

- **Source.** The meaning comes from the plan that **authorized** the line (`communication_receipts[].response_contexts[].response_plan`: `required_facts` + `fact_semantics`). The committed wording is never re-parsed. Rewriting it changes no heard proposition (tested).
- **Holders.** Only the listeners of that `dialogue_history` row.
- **Recorded fields.** Speaker, proposition (`reported` clause), topic entities, source event, listeners, `interval`.
- **Duplicates.** Hearing something the actor already knows adds a `supports` entry to their own grant. It never creates a second truth record.
- **Reporting chains.** When a line relayed the briefing, the listener holds "Daisy said Maxwell said X" (`reported_origin: "Maxwell"`), never "Maxwell said X", unless they heard Maxwell themselves.
- **Player lines.** These are `player_claim`: a surface quotation plus the entities they named. They are recalled only by listeners and are **never** a grant. Repetition is counted (`times`) but never promoted. Questions are not claims.
- **Conflicts.** Conflicting reports from different speakers are all kept, each attributed ("Roy said X, but Heather said Y"). Nothing collapses them.

## CURRENT PROCEDURE

This is recomputed from canonical state on every query. It is never an eternal "next".

| Canonical state | Current / next | Holders |
|---|---|---|
| `beat = LOCAL_INTRODUCTIONS`, briefing concluded, `esd_handoff.status = introductions-open`, listener still in the room | get acquainted → report to Equipment Staging | listeners of the dismissal |
| `esd_handoff.status = equipment-cooperation` | at Equipment Staging; next not told | every member |
| `radio.authorized && !radio.check_completed` | crossed → the radio check with Standard (baseline field procedure) | every member |

The history ("What did Maxwell tell us to do after introductions?") stays available through `dismissal_instruction`.

## OBSERVED / REMEMBERED

| Fact | Source | Form | Commit-sensitive |
|---|---|---|---|
| Custody seen (`custody-observed`) while still true | `canonical-world-ledger.recordCustodyObserved` | observed | yes |
| Custody seen, later superseded | same | remembered: historical questions only; never the current holder | historical |
| Maxwell left after the briefing; he's not here now | briefing conclusion event | observed | current presence: yes |
| Teammates present | `spatial.personnel_locations` | observed | yes |
| Still on the Standard side | own location (a Standard-side facility location) | observed; never inferred from the definition of Standard | yes |

Current custody always comes from canonical state through the observer authority (`resolveCustodyKnowledge`). "Who had it earlier?" uses `custodyHistory` (the briefing snapshot plus the actor's own observations). "How do you know?" names the actual basis: the briefing, seeing it, or holding it.

## PARTIAL KNOWLEDGE

A query returns `status: "partial"` when facts exist but the asked **facet** is not established. The plan then carries `known_concept` + `knowledge_gap`. Fallback, the model prompt and the validator all require the unknown part to be stated; the known part may never stand in for it (a destination is not a purpose).

| Question | Known | Missing facet |
|---|---|---|
| What are the startup materials for? | cargo being delivered to Outpost A, Bermuda branch; who delivers them | `purpose_and_contents` |
| What's inside them? | same | `contents` |
| How does the Threshold work? / What powers it? | the fixed crossing | `mechanism` |
| Why does the Complex exist? / Who built the Threshold? | the definition | `origin` |
| What's the history of ASYNC? | the one sentence | `history` |
| Who's in charge here? | Maxwell's briefing authority | `command` |
| Do you know Maxwell? | identity and role | `acquaintance` |

Answers that are complete but bounded carry `bounded_unknown`, worded "that's about all I know". This covers ASYNC's purpose, Maxwell's identity and the Complex's definition.

## NOT ESTABLISHED (truthful unknowns; nothing invented)

- The contents and deeper purpose of the startup materials.
- The Threshold's mechanism, power and origin.
- Why the Complex exists and who built it.
- ASYNC's history, structure and classified programs.
- Maxwell's rank beyond the briefing, his specialty, and any relationships.
- Outpost A beyond the destination.
- The KV31 Threshold Room and the Threshold Approach, as knowledge.
- The current state of the Threshold.
- A green-tape return-marker procedure.
- Coworker biographies.

Internal classes (developer trace only, never player UI):

- `semantic_reason`: `interpretation_failure`, `knowledge_projection_failure`, `missing_structured_canon`, `legitimate_unknown`, `partial_knowledge`, `reference_ambiguity`, `advisory_unavailable`.
- `unknown_detail`: `legitimate_unknown`, `not_granted_to_actor`, `entity_unknown`, `facet_unknown`.

"I don't know" or "nobody's told me" is spoken only for real character ignorance. A parse failure clarifies instead.
