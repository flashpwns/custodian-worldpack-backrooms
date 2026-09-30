# Dialogue reader: Phase 2 gold label guide

**Status:** written 2026-09-30, **before** any teacher, local model or calibration score exists. Changing a
definition after a set is opened is an owner decision, recorded with its reason, and applies only to sets not yet
opened.

**Authority.** Subordinate to `SIMULATION_DOCTRINE.md`, the Gameplay Constitution, the owner rulings recorded in
`READER_PHASE1.md` §1 and the held-out protocol. A label is a statement about **language**, never about who should
answer. Who answers is the resolver's (`dialogue-resolve-turn.js`), so a labeler never writes it.

## 1. What a labeler sees

A labeler sees **exactly the frozen model-facing render** of the item:

```
node tools/dialogue-reader-labels.js --worksheet <capture.json> --out <worksheet.jsonl>
```

This is `renderReaderPrompt(input).user`, the same text the teacher and the local model receive, plus the static
contract in `renderReaderPrompt(input).system`.

A labeler does **not** see:

- the transcript beyond what the render carries;
- canonical ids or world state;
- private or personhood state;
- any legacy reading or any arm's output;
- another labeler's labels, before adjudication.

A label whose `render_digest` no longer matches the frozen item is refused (`render_changed_since_labelling`).

## 2. What a labeler writes

One ReaderFrame per item, written in the compact wire format (`dialogue-reader-wire.js`), one JSONL row per item:

```
{ "id": "<item id>", "labeler": "<who>", "render_digest": "<from worksheet>", "gold_wire": "ask contents @n1 new f=wh r=e1>r1" }
```

Every label must decode (V0) against its item (`validateLabels`). A label that fails V0 is rejected at authoring
time, never silently repaired.

## 3. Field definitions

Labels always use the labels the item supplies (`n`, `e`, `r`, `q`, `i`, `a`, `o`, `v1`, `c1`, `s0`/`s1`).

| Field | Label | Rule |
| --- | --- | --- |
| speech act | `greet bye intro ack thanks call state sarcasm ask request repair more answer aside` | What the clause **does**. `more` is an elliptical follow-up ("and you?", "who else?"). `answer` only answers the pending coworker question `i1`. A wh-led line read as a remark is `sarcasm`/`state` only when the render gives no asking reading; if in doubt, label the asking reading and add `ab=force` (owner ruling 5 fails closed). |
| address op + names | `-`, `@n1`, `@n1+n2`, `all`, `others`, `except@n1`, `you` | **Language-level** only: who the words are said to. A name that is talked **about** is not an address (`nr=n2:men`). "We all…" is subject `us`, address `-` (owner ruling 1). The chip ("player chose to speak to") is not re-labelled: write the address the words carry. |
| facet | a wire facet code, `?` or `-` | What the act **asks** (or, on a statement, **claims**). `?` means it asks, but nothing in the table fits. `-` means it asks nothing. An ellipsis inherits nothing on the wire: write `?` and the relation to what it continues. |
| relation + target | `new`, `cont:T`, `fix:T`, `back:T`, `nudge:T`, `reply:i1`, `drop:T`, `end:v1`/`end` | The antecedent the **words** relate to, by its label. A marker ("so", "anyway") alone never makes a continuation (owner ruling 2). `end` concludes: `end:v1` while an activity round is open, plain `end` when nothing is open. The resolver decides any closure. |
| repair kind | `rk=who/what/topic/when/unanswered/mine` | Applies only when the act repairs something. |
| referent | `r=rN`, `r=eK>rN`, `r=there`, `r=inside`, `r=unsure`, `r=none`, `nom=a-b` | The thing the act is about. Use `there`/`inside` for a place pointed at without naming it. Use `nom=` for a thing named in words no label fits. `unsure` means the words are genuinely unclear. |
| subject | `s=you/me/us/group/named:nK/none` | Whom a person-facet act is about, **when it is not simply the addressee**. |
| inbound answer | `ia=ans/unsure/refuse/counter[:oK/yes/no/…]` | Only while `i1` is pending. |
| respondent mode | `m=each/any/all` | Only when the words **say** who should answer ("each of you", "anyone"). |
| abstention | `ab=field+field` | Label an abstention **when the render cannot settle the field**, not when the labeler is unsure of the guide. |

**Diagnostic only** (labelled, reported, never gated unless evidence later changes that):

- question form (`f=`);
- temporal (`t=`);
- polarity (`pol=`);
- name roles beyond the default (`nr=`);
- requested action (`do=`);
- self-introduction span (`si=`);
- echo (`echo=`).

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

A field with **fewer than 60 applicable items** in a set is reported, **never acceptance-gated**
(`MIN_APPLICABLE_FOR_GATE`).

## 5. Labelers, double labelling and adjudication

- **Human review:**
  - **≥ 200 difficult items** are double-labelled per set. "Difficult" means rare strata, ellipsis,
    repairs, inbound answers, multi-act lines, and any L0 clarification.
  - One of the two labels on each of these items is human.
  - Disagreements are adjudicated by the human, who records a reason.
- **Resolved-outcome review:** about **100** items' `resolveTurn(gold)` outcomes are reviewed independently against
  doctrine and owner rulings. A doctrinal miss is a resolver defect: it is fixed and specified in the gold resolver
  spec before any reader number is interpreted.
- **LLM labelers** must not share the primary model family of the strong teacher (§6 of the preregistration). A
  label produced by the teacher's family is not gold for the teacher.
- **Agreement** is reported per field:
  - raw agreement;
  - Cohen's κ;
  - **PABAK**, the prevalence-adjusted bias-adjusted κ, where a skewed prevalence makes κ misleading.

  The tool is `dialogue-reader-labels.js --agreement`. A gated field needs κ ≥ 0.80 where prevalence makes κ
  interpretable. Otherwise PABAK is reported alongside it and the owner decides.
- **Label-noise ceiling:** the adjudicated agreement per field is reported with every score. No arm is expected to
  exceed it.

## 6. What changes a label definition

Stop interpretation and fix the definitions first, before any prompt or model change, when either of these holds:

- teacher misses cluster in a low-agreement field;
- the two labelers disagree systematically on a class.

The procedure:

1. Record the change here (dated).
2. Relabel the affected dev items.
3. Never relabel a calibration or sealed item after it is opened.
