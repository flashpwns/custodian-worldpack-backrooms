# Owner rulings needed before Phase 1 (from the Phase-0.5 round trip)

**Status:** prepared for owner approval. **Nothing here is decided or implemented.** Production behaviour
is unchanged. Each ruling lists:
- the exact fixture cases (from `docs/acceptance/reader-phase0/roundtrip.json` and
  `legacy-adapter-coverage.json`);
- what production does now;
- what the ReaderFrame-based pipeline would do;
- a recommendation.

The characterization authority pins the current behaviour; Phase 1 changes it only where a ruling below
says so.

## A. "we all going?": collective subject versus group address

**Cases** (10 turns):

| Fixture | Line |
| --- | --- |
| `j15/1-terse.txt` | we all going |
| `j15/2-verbose.txt` | Will all of us be going to Equipment Staging together, or are we splitting up? |
| `j15/3-chaotic.txt` | Are we all going? |
| `j15/4-human-trace.txt` | Alright cool. Are we all going together? |
| `transcripts/human-trace-f1-f12.jsonl` | Alright cool. Are we all going together? |
| `scenario/ed30d-j16` | Are we all going together? |
| `scenario/rounds-and-repairs` | Are we all going together? |
| `dev-corpus.jsonl#d080` | Alright cool. Are we all going together? |
| `dev-corpus.jsonl#d083` | Do we split up at staging? |
| `dev-corpus.jsonl#d110` | are we all going in together |

**Now (legacy).** `resolveAddressee` treats the subject quantifier ("we all", "are we", "all of us") as an
**address**:
- addressee `{ kind: group, ids: [all present], quantifier: we_all | we, source: collective }`;
- facet `transition.participants`, cardinality `one_spokesperson`: one person answers, chosen among the
  group;
- the request is opened with every present coworker as a target.

**ReaderFrame reading.** `subject: group_inclusive` (the player plus the team is who the question is
**about**) and `address: NONE` (no one was addressed). The frame-driven resolver then treats the line as
untargeted: `one_spokesperson` by the deterministic rotation / knower policy, and the request has no
per-person targets.

**Difference the player can see.** One coworker answers either way. What changes:
- which coworker is chosen (spokesperson among targets, versus the untargeted rotation);
- the ledger's `targets` / `address.scope` (`group` versus `untargeted`).

In the round trip this is the only difference on all 10 turns (`addressee` group → []).

**Recommendation (default):**
- `subject = group_inclusive`;
- `address = NONE` unless the line contains actual address language ("you all", "everyone", a vocative);
- responder selection stays deterministic resolver policy (owner decision 2026-09-27 #1: knower, else
  rotation).

**Owner decides:** adopt the default, or keep "collective = group address" as policy (the resolver would then
map `subject: group_inclusive` + `address: NONE` to a group address, so it remains policy rather than
reading).

## B. The relation-without-antecedent cases (Phase 0 counted 7 notes; they fall on 6 turns)

At Phase 0, "Malcolm, I hope you don't mind me asking, but are you nervous at all?" carried **two** notes, one
for each of its two acts. After the Phase-0.5 adapter fix, its second act links to its first (`s0`) and only
the hedge act keeps the note. The final Phase-0.5 artifacts show **4 turns / 4 notes**: #1–#4 below.

| # | Fixture | Line | Legacy decision | Classification | Recommendation |
| --- | --- | --- | --- | --- | --- |
| 1 | `j15/2-verbose.txt` | Malcolm, I hope you don't mind me asking, but are you nervous at all? | the marker "but" makes both acts `continuation` with no antecedent; answered as a fresh `check_in` to Malcolm | **legacy quirk: marker-led continuation.** The hedge is politeness; the question is fresh | read `relation: new`. No behaviour change: legacy answers it as fresh already |
| 2 | `j15/2-verbose.txt` | So where do we go next, if you don't mind me asking? | "So" makes it a `continuation` with no antecedent; answered as a fresh `ask_next_step` | **intended hedge continuation.** "So" continues the conversation's topic, not a request | read `relation: new`; the topic continuity is not a routing antecedent |
| 3 | `j15/3-chaotic.txt` | Tonya, have you? | ellipsis over the player's **own claim in the previous turn** (`dis.last_player_claim`: "I've been in the Complex before") → `person.complex_experience` to Tonya | **real missing antecedent support.** ReaderFrame cannot name "the player's own last claim" | add a relation target for it (a `c1` label from the DIS `last_player_claim`). This is a schema extension for owner approval |
| 4 | `j15/3-chaotic.txt` | Anyway, where are we going? | the marker "Anyway" makes it a `topic_return` with no target; answered as a fresh destination question | **legacy quirk: marker-led topic return.** "Anyway" is a topic change, not a return to a named topic | read `relation: new` |
| 5 | `scenario/ed30i-inbound` | I mean, the camera | own-answer repair of the choice just answered | **not a legacy case.** It was an adapter ordering bug, fixed in Phase 0.5: the frame now targets `i0` (the question just answered) | none |
| 6 | `dev-corpus.jsonl#d128` | I've been in the Complex before. Have you, Giselle? | ellipsis over the player's claim **in the same line** | **not a legacy case.** It is expressible as `relation.target: s0` (the earlier act of the same line), and the adapter now maps it | none |

**Result:** 2 legacy quirks (#1 and #4), 1 intended hedge continuation (#2), 1 real schema gap (#3), and 2
harness artifacts, now fixed (#5 and #6).

## C. V1 strictness divergences

### C1. Question form versus facet (`V1:question_form_incompatible`, 11 turns; legacy proceeded on all)

| Line | Legacy form → facet (registry forms) | Classification | Recommendation |
| --- | --- | --- | --- |
| Will all of us be going to Equipment Staging together, or are we splitting up? | choice → `transition.participants` [yes_no, wh] | **registry metadata too strict** | add `choice` to `transition.participants.question_forms` |
| Is Staging far? | yes_no → `mission.route` [wh] | **registry too strict, or the facet is imprecise** (distance, not route) | owner: allow yes_no on `mission.route`, or give distance its own facet |
| Are we leaving soon? | yes_no → `mission.schedule` [wh] | **registry metadata too strict** | add `yes_no` to `mission.schedule` |
| cargo? (echo of the reply's word) | yes_no → `item.contents` [wh] | **new validator too strict** for echoes: an echo checks a word back while re-asking the anchored request | V1: skip the form check for acts with `echo` |
| when was that / who else / Not today. Ever. | wh → `person.complex_experience` / `first_day_at_async` [yes_no, …] | **new validator too strict** for follow-ups: a follow-up asks about the proposition (its time, other people), not the facet directly | V1: apply the form check only to `relation: new` |
| Tonya, have you? / And Tonya? / I've been in the Complex before. Have you, Giselle? | wh → `person.complex_experience` [yes_no, count] | **legacy parser label.** Elliptical continuations get `question_form: wh` (a legacy default), although "have you?" is yes/no | the reader's form is the line's; with the follow-up exemption above, no conflict |

### C2. Temporal support (`V1:temporal_unsupported`)

- **Phase 0 flagged 4 turns** (e.g. "How are you doing this morning Giselle?", "How is everyone feeling this
  morning?"). The adapter then emitted the clause's own time word (`today`), while legacy used the cue's
  `now`. `person.wellbeing.temporal_support` is `[now, earlier]`.
- **Phase 0.5** emits legacy's effective scope, so these no longer fire.
- **The underlying question remains:** if a reader says `today` for "this morning", V1 rejects it.
- **Classification:** owner policy needed. Does "this morning" in a self-state question mean `now` (legacy),
  or should `today` be a supported scope for self-state facets?
- **Recommendation:** keep `[now, earlier]` and have the resolver map an expressed `today` to `now` for
  self-state facets. That is resolver policy, not registry change.

### C3. Remaining V2 divergences (legacy proceeded; new validator asks)

- **"what could possibly go wrong lol"**
  - Legacy: sarcasm, and silence under owner decision #2.
  - V2: a non-asking reading of a wh-led line, so it clarifies.
  - Owner: accept that a wh-led remark is sometimes clarified, or require an explicit `abstain`-free sarcasm
    margin later (Phase 2 calibration).
- **"Tonya, how are you?" sent with the chip on Malcolm**
  - Legacy: the chip wins silently, and Malcolm answers.
  - V2: the reading contradicts the chip, so the field is rejected.
  - Owner: should a vocative that contradicts the UI target clarify ("Did you mean Tonya?"), or should the
    chip always win silently? This interacts with B8.

## D. Round-trip classes the owner should know (not rulings)

- **frame-assembly-text** (24 turns). `finalizeFrame` reads the act's own words and clause for subjects, the
  legacy route and clarify-over-guess. Phase 1 must pass subject and route from the frame. This is an
  architecture task, not a ruling.
- **legacy-overlay** (1 turn: "No, the other one."). The service's `resolveAddressCorrection` overlay decides
  it; its retirement is Phase 1 scope.
- **deictic default place** (3 turns). "going in" / "inside" → the Complex is owner decision #4's canonical
  default. It stays resolver policy (it is not a reader field).
- **salient place from legacy salience** (1 turn). Legacy took the place from its salience, which reads
  optional facts. This is ruling **B7**.
