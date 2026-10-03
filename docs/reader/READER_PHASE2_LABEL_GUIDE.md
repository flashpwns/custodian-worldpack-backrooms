# Dialogue reader: Phase 2 gold label guide

**Status:** written 2026-09-30 (Step 0); reconciled with the frozen reader contract at **Step 0.1** (2026-09-30), **before**
any gold label, teacher, local-model or calibration score exists. Changing a definition after a set is opened is an owner
decision, recorded with its reason, and applies only to sets not yet opened.

**Authority.** Subordinate to `SIMULATION_DOCTRINE.md`, the Gameplay Constitution, the owner rulings recorded in
`READER_PHASE1.md` §1 and the Phase-2 Step 0.1 rulings (`READER_PHASE2.md` §1), and the held-out protocol. A label is a
statement about **language**, never about who should answer. Who answers is the resolver's (`dialogue-resolve-turn.js`),
so a labeler never writes it.

## 1. What a labeler sees

The labelling unit is a **distinct frozen render** (render digest), not a source row: two providers or two fixtures
that render identically are one linguistic item (`dialogue-reader-replay.js renderGroups`; every occurrence is kept in
the manifest).

```
node tools/dialogue-reader-labels.js --worksheet <capture.json> --out <worksheet.jsonl> [--sample docs/acceptance/reader-phase2/teacher-dev-sample.json]
```

The worksheet's first row is a header carrying the **frozen system text** (`renderReaderPrompt(input).system`, with its
digest); every other row carries exactly the **user render** a reader receives (`renderReaderPrompt(input).user`). The
labeler therefore reads the same contract and the same view as the teacher and the local model.

A labeler does **not** see:

- the transcript beyond what the render carries;
- canonical ids or world state;
- private or personhood state;
- any legacy reading or any arm's output;
- any model suggestion, before the human primary label is committed (§5);
- another labeler's labels, before adjudication.

A label whose `render_digest` no longer matches the frozen item is refused (`render_changed_since_labelling`).

The human primary labeler writes `HUMAN_PRIMARY` rows with the local workstation
(`tools/dialogue-reader-labeling-workstation.js`, `docs/reader/READER_PHASE2_LABELING_WORKSTATION.md`): one frozen render at a
time, no suggestion, no prefill, no hidden state, validated against this guide's schema. Hand-editing JSONL is not required.
A human primary labels only `ACCEPT` or `EXPECTED_CLARIFY`; the workstation offers no other outcome. Only an adjudicator may
declare a render `UNLABELABLE` (an `ADJUDICATED_GOLD` row, as the preregistration and validator already require).
The workstation's default Easy form only serializes the human's explicit selections into this guide's wire; it never chooses a value.
While labeling, the human may use documentation for UI operation, wire grammar and syntax, and the meaning of schema fields, but must
not ask an AI, a model or another person to decide ACCEPT versus EXPECTED_CLARIFY, the intended interpretation, or the correct
addressee, referent, topic or similar (that would break the independence of the human primary).

## 2. What a labeler writes

One JSONL row per distinct render:

```
{ "id": "rg-…", "render_digest": "…", "label_state": "HUMAN_PRIMARY", "labeler": { "kind": "human", "id": "…" },
  "gold_outcome": "ACCEPT", "gold_wire": "ask contents @n1 new f=wh r=e1>r1" }
{ "id": "rg-…", "render_digest": "…", "label_state": "HUMAN_PRIMARY", "labeler": { "kind": "human", "id": "…" },
  "gold_outcome": "EXPECTED_CLARIFY", "gold_wire": "ask contents - new f=wh ab=address",
  "expected_clarify": { "field": "address", "slot": "person", "note": "who is asked is not settled by the words" } }
```

**Gold outcome.** Every row declares one:

| Outcome | The row is kept only if |
| --- | --- |
| `ACCEPT` | the wire decodes, and V0, V1, V2 and V3 all accept the frame, and `resolveTurn` resolves it without a clarification |
| `EXPECTED_CLARIFY` | the wire decodes; it names only legal, current labels (no V1 error) and contradicts nothing on the surface (no V2 error); `expected_clarify.field` names the intended ambiguity (an abstention field, `referent` for `r=unsure`, or `discourse_state` for an underdetermined discourse state) and the frame expresses it; `resolveTurn` clarifies on `expected_clarify.slot` (`person`, `referent`, `location`, `topic` or `answer`) |

A row is **rejected with its reason**, never silently kept or repaired: a V0 failure, a stale or nonexistent relation
target, an illegal candidate, a surface contradiction, an ACCEPT row that clarifies, an EXPECTED_CLARIFY row that
resolves or clarifies on another slot, a missing outcome, a missing render digest (`validateLabels`). A gold frame never
exists merely because it parses.

**Duplicate ids** in a label file are rejected: every row with that id, never "last row wins".

## 3. Field definitions (the frozen system text)

The field definitions and representation conventions **are** the frozen reader system text. They are reproduced here
verbatim (the wire spelling) and `tests/ed33c-reader-phase2-step01.test.js` fails if this block and
`dialogue-reader-render.js semanticLines` ever differ. A labeler applies exactly what the teacher is told; nothing in
this guide adds a convention the model-facing contract does not state.

    TASK. You read ONE line a player typed to coworkers at a table and write how it is meant. Language only: never decide who answers, never state facts, never invent people, things or events. Use only the labels given in the input.

    LABELS. p person present, n name the player typed, e thing the player typed, r thing that may be referred to, q earlier request, i1 coworker question waiting for the player's answer, i0 coworker question just answered, v1 activity round, c1 the player's own previous claim, a sentence a coworker was heard to say, o answer option, s0/s1 an earlier act of this same line.

    ACTS. One act per clause-level act the line performs (at most 3), in line order.

    SPEECH ACT (what the clause does): greet greets; bye says goodbye; intro introduces self; ack acknowledges / okay; thanks thanks; call gets attention; state states or claims; sarcasm a sarcastic remark; ask asks; request asks someone to do something; repair fixes something the player said; more an elliptical follow-up ("and you?", "who else?"); answer answers the waiting coworker question i1 (only then); aside not said to the table. A wh-led line is a remark (state / sarcasm) only when no asking reading is available; when in doubt write the asking reading and abstain on force.

    FACET: what the act asks (or, on a statement, claims), one facet code below. ? = it asks, but its words name no facet in the table. - = it asks nothing.

    ADDRESS (address language in the words only: whom the words are said to): - nobody named | @n1 (several: @n1+n2) said to that named person | all everyone | others the rest (rel=q1 and n=2 when said) | except@n1 everyone but | you an unnamed you. A name talked ABOUT is not an address: give it the mention role.

    RELATION (the antecedent the words relate to, by its label T, a q, i, s, v1, a or c1 label): new | cont:T continues T | fix:T repairs T | back:T returns to T | nudge:T presses unanswered T | reply:i1 answers the coworker question | drop:T withdraws T | end:v1 concludes the open activity round (end when nothing is open). Code, never you, decides any closure or who answers.

    OPTIONAL FIELDS (only when true; defaults are omitted): f=wh|yn|choice|decl|indirect|tag|count question form; pol=neg|inv; t=now|today|earlier|ever|past the time the line sets; m=each|any|all who should answer, only when the words say it ("each of you", "anyone"); r=r2 the thing meant (r=there / r=inside a place pointed at without naming it, r=unsure the words are genuinely unclear, r=none); nom=3-4 tokens naming a thing no label fits; s=you|me|named|group|us|none whom a person facet is about, only when it is not simply the addressee (named: with the n labels); ia=ans|unsure|refuse|counter with an option o1|yes|no|both|neither|either|noneof, the answer to i1, only while i1 waits; rk=who|what|topic|when|unanswered|mine what a repair fixes; nr=voc|men|ans|greet|fix roles of typed names (a name in the address defaults to voc, on a greeting or farewell to greet); echo=a1 repeats a heard sentence; si=3-4 the player's own name; do=stay|follow|wait|move|return|report|assist|investigate|transfer|query|other an action asked for (with its r label); ab=force|address|facet|relation|referent|subject|time|answer fields the line itself cannot settle; sp=3-7 an explicit token span.

    CONVENTION A (follow-up / ellipsis facet). When an act only continues, re-asks, presses or points back at an earlier question (an elliptical follow-up, a bare "when?", "who else?", "and you?") and its words do not themselves express a facet, write ? with the relation to what it continues: the facet is inherited from that target by code. Do not repeat or invent the target's facet. Write a facet code only when the words express one, a new facet or the same one restated in full.

    CONVENTION B (chip). "player chose to speak to" is where the player's message is delivered, set by the interface. It is not address language. Address records only what the words themselves say: with no vocative, name or address phrase in the line, write - even when a person was chosen.

    CONVENTION C (inclusive group). "We all ...", "are we all ...", "all of us" put the speaker's group in the SUBJECT (s=us); they are not address language. Write all only when the words are said to everyone ("everyone", "you all", "guys", "all of you").

    CONVENTION D (relation antecedent). A relation target is a supplied label that the words themselves continue, repair, return to, press or answer. A discourse marker ("so", "anyway", "okay") alone never makes a continuation. Never choose an antecedent only because it is about something similar: with no antecedent the words point back to, the relation is new.

    ABSTAIN when the line and the input together cannot settle a field (not when you are merely unsure of these rules).

The facet codes and their glosses follow in the system text (worksheet header). Conventions A–D are the owner's Step 0.1
alignment: A (follow-up / ellipsis facet), B (the chip is canonical code-side targeting, not address language),
C (an inclusive group is a subject, not `address = all`) and D (relation targets are supplied discourse labels the words
relate to, never an antecedent chosen for similarity).

**Diagnostic only** (labelled and reported, never gated anywhere): question form (`f=`), temporal (`t=`), polarity
(`pol=`), name roles beyond the default (`nr=`), requested action (`do=`), self-introduction span (`si=`), echo (`echo=`).

## 4. Applicability (what each field is scored on)

The scoring code is `dialogue-reader-replay.js fieldAgreement`. Agreement uses the same rules
(`dialogue-reader-labels.js applicable`).

| Field | Applicable when |
| --- | --- |
| speech act, address, facet, relation, abstention | always (primary act) |
| repair kind | gold (or either labeler) has a repair kind or a repair relation |
| referent | gold (or either labeler) names a referent |
| subject | gold (or either labeler) has a non-addressee subject |
| inbound answer | a coworker question `i1` is pending in the render |
| respondent mode | gold (or either labeler) expresses a mode |

A routing field with **fewer than 60 applicable items** in a set is reported, **never acceptance-gated**
(`MIN_APPLICABLE_FOR_GATE`).

## 5. Label states, labelers and adjudication

| State | Meaning |
| --- | --- |
| `UNLABELED` | a worksheet row nobody has labelled |
| `HUMAN_PRIMARY` | the first-pass label, written **blind** by a human (`labeler.kind = human`), committed with a timestamp |
| `MODEL_ASSISTED_REVIEW` | an independent model may flag disagreement **after** the human primary is committed (`labeler.kind = model`, with its family). It never counts as gold |
| `ADJUDICATED_GOLD` | the final label, adjudicated by a human (`adjudicator.kind = human`). It records the committed primary (`primary.labeler`, `primary.committed_at`) and every review (`reviews[]`, each `created_at` later than the primary's commit) |

**Only `ADJUDICATED_GOLD` counts for headline teacher scoring.** The Step-0 term for unadjudicated gold is retired: it had no
defined status. A label is in exactly one of the four states above.

**Independence** (`docs/reader/READER_PHASE2_LABELING_REGISTRY.json`, enforced by `validateLabels` and the replay CLI):

- the teacher's model family differs from the automated review-labeler's family;
- teacher output never produces gold;
- an evaluated arm is never the label source of its own evaluation (gold touched by the arm's family is excluded from
  that arm's score);
- automated suggestions are hidden from the human primary labeler until the primary label is committed; a review
  created earlier invalidates the adjudicated row;
- the families are recorded in the registry **before** labelling begins. Recommendation (not chosen in code): teacher
  a non-Claude top-tier reasoning model, because Claude authored much of the prompt, fixtures and review material;
  automated reviewer Claude family permitted; the human is primary labeler and adjudication authority.

**Human review:**

- **≥ 200 difficult items** are double-labelled per set: rare strata, ellipsis, repairs, inbound answers, multi-act
  lines, and any L0 clarification. One of the two labels on each is human. Disagreements are adjudicated by the human,
  who records a reason.
- **Resolved-outcome review:** about **100** items' `resolveTurn(gold)` outcomes are reviewed independently against
  doctrine and owner rulings (data protocol §6). The sample **oversamples items whose gold facet differs from the legacy
  facet**, because the captured knowledge flags were generated for production's facet and knower selection may be
  under-specified there; those items are reported separately. A doctrinal miss is a resolver or measurement defect: it
  is fixed and specified in the gold resolver spec before any teacher headline score is interpreted.
- **Agreement** is reported per field: raw agreement, Cohen's κ, and **PABAK** where a skewed prevalence makes κ
  misleading (`dialogue-reader-labels.js --agreement`). A gated field needs κ ≥ 0.80 where prevalence makes κ
  interpretable; otherwise PABAK is reported alongside and the owner decides.
- **Label-noise ceiling:** the adjudicated agreement per field is reported with every score. No arm is expected to
  exceed it.

## 6. What changes a label definition

Stop interpretation and fix the definitions first, before any prompt or model change, when either of these holds:

- teacher misses cluster in a low-agreement field;
- the two labelers disagree systematically on a class.

The procedure:

1. Change the frozen system text (`dialogue-reader-render.js semanticLines`) and this guide together, with a new render
   version (the ed33c reconciliation test enforces it). Record the change here (dated).
2. Relabel the affected development items (their render digests change, so old labels are refused).
3. Never relabel a calibration or sealed item after it is opened.
