# Reader Phase 2: human primary labeling workstation

**Status:** audited workstation frozen at `22f6653`; Easy labeling UI (presentation only) awaiting independent audit (2026-10-01). **Tool:** `tools/dialogue-reader-labeling-workstation.js`.
**Tests:** `tests/ed33d-reader-phase2-labeling-workstation.test.js` (the audited workstation), `tests/ed33e-reader-phase2-easy-labeling-ui.test.js` (the Easy UI).

**Authority.** Subordinate to `SIMULATION_DOCTRINE.md`, the Gameplay Constitution, `READER_PHASE2.md`,
`READER_PHASE2_LABEL_GUIDE.md` (the label schema, states and independence rules, unchanged) and
`READER_PHASE2_LABELING_REGISTRY.json` (the human primary labeler is `jack`). The workstation adds **no** label format,
**no** state and **no** taxonomy: it writes `HUMAN_PRIMARY` rows in the existing schema and takes the legal outcomes,
clarification slots and fields from `dialogue-reader-labels.js`.

> **The human judgment must be made without consulting any model or legacy answer.** The workstation shows none, and
> suggests nothing. Do not look at the legacy reader output, the teacher, a model review or a previous labeling run's
> output while labeling. The point of a blind primary is that nothing but the language and the authorized context
> informs it.

## 1. What it is

A local, loopback-only, dependency-free browser instrument that shows **one frozen render at a time** (474 in the
census), lets the human choose an outcome, author the wire by hand, and commit a `HUMAN_PRIMARY` row. It never infers,
suggests, recommends, prefills, ranks, repairs or reveals a semantic answer.

## 2. Usage

```
node tools/dialogue-reader-labeling-workstation.js --prepare      # once; several minutes (offline replay of the frozen fixtures)
node tools/dialogue-reader-labeling-workstation.js                # serve; prints the localhost address
```

`--prepare` replays the frozen development fixtures through the production service with mock providers (no network, no
model), selects the 474 frozen census renders (checked against the pinned `teacher-dev-sample.json` SHA-256 and the
`dev-manifest.json` turn / render counts), and writes the **blank** worksheet and the observer-safe input pack. The
answer-bearing capture is held in memory only and is discarded; it is never written. `--prepare` refuses to overwrite an
existing worksheet, and refuses outright when labels exist.

The serve command prints the address (default `http://127.0.0.1:47474/`; `--port N`, `--port 0` for a free port). Open
it in a browser. Stop with `Ctrl+C`. A second workstation on the same directory is refused (lock file).

| | |
| --- | --- |
| Active directory | `.agent-notes/reader-phase2-labeling/` (gitignored; `--dir` overrides, but a tracked repository path is refused) |
| `worksheet.jsonl` | the **blank** worksheet (`dialogue-reader-labels.js worksheet()`: frozen system text + exactly the user render) |
| `input-pack.json` | the observer-safe `ReaderInput` of each render, bound to the worksheet by render digest (validation authority only) |
| `labels.jsonl` | **the human's active `HUMAN_PRIMARY` labels** (one row per render; the only file the tool writes while labeling) |
| `journal.jsonl` | append-only audit of every commit and recommit (a recommit keeps the replaced row) |
| `prepare-receipt.json` | counts and SHA-256 of the blank worksheet and input pack |
| Resume | automatic: on start the labels file is reloaded, each row is re-bound to its frozen render digest and re-validated; the first uncommitted item opens |
| Validate (offline) | `node tools/dialogue-reader-labeling-workstation.js --validate` (also the "Validate file" button): schema, digest binding, V0 + V1 + V2 |
| Validate (full) | `node tools/dialogue-reader-labeling-workstation.js --validate-full [--detail]`: the **existing** `validateLabels` (V0-V3 + `resolveTurn`) over the frozen census; regenerates the capture in memory (several minutes) |

The worksheet from `--prepare` on this checkout is byte-identical to the independently regenerated one
(`worksheet.jsonl` SHA-256 `e6f2da5a7251434b4a29a6a29b765461d9594f3d9f5f6386e8299a8532ce3e5d`).

## 3. Labeling one item (Easy mode is the default)

The default page is a presentation layer over the audited backend. It changes how the human operates the instrument and
nothing else: the schema, the stored row, the validators, the worksheet, the blindness boundary and the persistence are
exactly those of the raw workstation. **The human answers human questions; the page does deterministic formatting. The page
never answers a semantic question for the human:** it does not read the player's line to choose, suggest, rank or default any
meaning. "Jack selects meaning X, the form writes X in the existing wire syntax" is allowed; "the page decides X is likely"
is forbidden and tested.

Design law: **if Jack has to remember what a Reader term means, the UI has failed.** Every question is plain English; the
technical term is a small secondary annotation under it ("Do the player's words directly address anyone?" with `address` beneath). There is never a
giant form: the flow is *sentence, context picture, one decision, one question at a time, preview, COMMIT & NEXT*.

1. **Player said** (large) and a **context picture**: the people present as plain badges (no badge is outlined or marked; the typed-name matches and the
   interface's delivery target appear as plain text tags; the delivery target reads "Delivered to (interface choice): Tonya · not part of
   the player's words", because it never decides the address), the earlier conversation as chat bubbles (what you asked, the
   coworker question that is waiting, what was heard, your previous line), and the things in play as small tags. It is a
   display-only re-reading of the authorized `render_user` text: person labels are translated through the render's own `people:`
   line (`p3` becomes "Tonya"), facet codes through the frozen system text's own glosses. A label the render does not map stays
   as it is. Nothing is added or recovered. Token indices, render id / digest, the raw encoding, the same context as a plain list
   and the raw render text are under a collapsed **Technical details**.
2. **Your judgment.** Two large choices, neither preselected, plain words first and the formal name secondary:
   - **I understand what the player means** (`ACCEPT`)
   - **Something important is unclear** (`EXPECTED_CLARIFY`)

   A human primary has exactly these two outcomes. Genuine ambiguity is expressed with the existing mechanisms; any concern
   goes in the optional notes. **UNLABELABLE is not a primary outcome:** only an adjudicator may declare a render unlabelable
   (see §6). Changing the judgment clears only the fields the new judgment does not own (switching to ACCEPT clears the
   unclear field, slot and clarification note); it never moves or infers content, never chooses a value for you, and your
   notes stay. A chosen card has the accent border and fill; keyboard focus is a separate dashed grey ring (keyboard only), and
   any focus left on the previous item's cards or questions is released when a new item opens, so a fresh item never looks chosen.
3. **One question at a time.** Each question shows only its own choices; answering one moves to the next (Back and clickable
   answer pills let you change any earlier answer). For *I understand what the player means* the questions are:
   1. *What is the player doing with this line?* The 14 speech acts, grouped (Being social, Saying something, Asking, Following
      up), each with an invented, generic example ("Howdy, neighbour!", "Could you open that?") that is identical for every item and
      checked mechanically against near-collisions with the 474 frozen lines (exact, prefix either way, containment, high word overlap).
   2. *What are they asking about, or claiming?* First the kind of thing (a person, the mission, an item, a place, the company,
      the conversation, something else), then only that family's topics, in the frozen glosses; or "asks, but names no listed
      topic" / "asks nothing".
   3. *Do the player's words directly address anyone?* (the frozen address field: address language in the words only.) Nobody (the
      words address no one), a person the words name and speak to (not just talk about), everyone (only when the words are said to
      everyone), the rest, everyone except a person the words name, an unnamed "you". A short reminder says to use only the player's
      words: the interface delivery choice does not decide this answer. Names typed in the line are listed as surface information
      only; clicking one is your semantic act and the page only translates it to its label (`@n1`).
   4. *Do the player's words point back to something said earlier?* (the frozen relation field, Convention D.) A reminder says to
      choose Yes only when the words themselves point back, not just because it is about the same topic. A plain **No** or
      **Yes**; only after **Yes** does it ask *how* (continues,
      corrects, goes back to, presses an unanswered question, answers the waiting coworker question, takes back, wraps up the
      activity round) and *which earlier item* (the items the render itself lists).
   5. **Check your answers**: your answers in plain words, then COMMIT & NEXT. Optional details (question kind, wording, time,
      who should answer, the thing meant, whom a statement is about, the answer to a waiting coworker question, what a repair
      fixes, what the line leaves open, a small raw box for rare fields) are one collapsed "Add a detail (optional)" section
      here, each its own small question shown only when you add it. **Add another part of the line** (up to three acts) is here
      too; a later part needs the word it starts at, chosen by you.

   For **Something important is unclear** two questions come first: *What is unclear about this line?* and *If a coworker had to
   ask a question, what would they need to ask?* (plain descriptions of the existing fields and slots, machine names
   secondary). The chosen field is attached to the part of the wire you choose (`ab=<field>`; `discourse_state` is not a wire
   field, so nothing is added). The wire is always *your explicit selections*, serialized: the **Generated Reader wire**
   (collapsed, shown at the check step) is empty until every required question is answered.
4. **COMMIT & NEXT** (large) or COMMIT. Both are disabled until the existing authoritative checks pass; on success a neutral
   "Saved." appears and the next uncommitted item opens. No score, praise or correctness is ever shown: the workstation
   cannot know.
5. A saved item shows its judgment read-only. **Edit / recommit (raw wire)** opens the raw editor with the saved wire (the
   Easy form cannot read a wire back into choices); **Re-label in the Easy form** starts blank. Nothing changes until you
   save again; the replaced row is preserved in `journal.jsonl`.

**Advanced / Raw labeling** (collapsed) is the original audited workflow: the raw wire editor with highlighting and the raw
field / slot selects. "Use the raw editor for this item" copies the deterministic serialization of your Easy selections
into the raw wire (or leaves it empty if the form is incomplete). Returning to Easy never reverse-engineers a hand-written
wire: if the raw wire differs from the serialization it is refused until you explicitly discard it. A wire written in the
raw editor is stored exactly as before.

**Tools** (top right) holds jump-to-item and whole-file validation. `--validate-full` is a CLI action and is never offered
by the page. **What am I doing?** opens a short help panel.

*Using help while labeling.* For the primary label you may use documentation and help for: how the form works, wire
syntax, and what a schema field means. You must not ask an AI, a model or another person to decide ACCEPT versus
EXPECTED_CLARIFY, the intended interpretation, or the correct addressee, referent, topic or similar: that would break the
independence of the human primary.

Navigation: Previous / Next / Next uncommitted and Alt+J / Alt+K / Alt+U. `Ctrl/Cmd+Enter` saves only when a judgment is
chosen and the draft validates. Drafts are held in browser memory only (nothing is stored in the browser).

## 4. The row it writes

```
{ id, render_digest, system_digest, label_state: "HUMAN_PRIMARY", labeler: { kind: "human", id: "jack" },
  gold_outcome, gold_wire, expected_clarify, notes, committed_at }   // gold_outcome: ACCEPT | EXPECTED_CLARIFY
```

`committed_at` is minted at the explicit commit (`new Date().toISOString()`, the registry's format) and never earlier. A
row is never `ADJUDICATED_GOLD` or `MODEL_ASSISTED_REVIEW`; nothing is promoted. The label guide, not the workstation,
defines adjudication.

## 5. The blindness boundary

The serving process loads exactly: the blank worksheet, the input pack, and the human's own labels. It does **not**
load, and cannot render, any of: the legacy reader frame, production routing, the pre-turn snapshot or ledger, the
bindings (label to canonical id), canonical state, teacher output, model output or review, test expectations or fixture
answers. The capture is touched only by `--prepare` and `--validate-full`, both explicit CLI actions in their own
process, neither writing the capture to disk.

The input pack holds the observer-safe `ReaderInput` (what the renderer consumes; it is the "minimum grammar / schema
authority needed for validation" because `decodeWire` checks token indices and labels against it). `renderReaderPrompt`
of each pack entry is recomputed and must equal the worksheet's digest, so the pack can neither drift nor carry another
render.

**Commit-time feedback is limited to the human's own wire against observer-safe input:** schema completeness, V0
(syntax), V1 (legal, current labels) and V2 (surface contradiction). Error output carries a layer, a code, an act and a
field, never a clarification slot or disposition. **Resolver-level information is deliberately withheld while labeling**
(V3 discourse clarification, whether an ACCEPT would clarify, whether an EXPECTED_CLARIFY clarifies on the declared
slot): it is post-commit information, the same discipline as the model review. It is available afterwards through
`--validate-full` (details stripped unless `--detail`).

The workstation deliberately refuses to show or compute: a suggested outcome, wire, field, slot or reason; a legacy,
teacher or model answer; a confidence, "likely" answer or similarity to another render; autocomplete from earlier labels;
canonical ids or transcript beyond the worksheet; examples chosen because they resemble the current item. The grammar
reference is static and identical for every item; its examples are invented syntax illustrations.

## 6. Fail-closed behavior and one schema finding

- The worksheet header's system digest must equal the current frozen system digest, or the tool refuses to start
  (`render_changed_since_labelling`).
- Per item, `sha256(system_digest \n render_user)` must equal the worksheet digest and the input pack must render to the
  same digest; otherwise the item is **blocked** and cannot be checked or committed.
- A saved label whose digest differs from its frozen render, or that no longer validates, is **blocked** and **not
  counted as labeled**; it is never displayed as a safe label. Relabeling is an explicit recommit naming the void
  timestamp.
- A labels file with an unreadable row, a duplicate id, an id outside the worksheet, a non-`HUMAN_PRIMARY` state or another
  labeler refuses to load. Nothing is dropped or "last-row-wins".
- Saves are write-temp, `fsync`, atomic rename, `fsync` of the directory; a crash leaves the previous complete file.

**UNLABELABLE is adjudicator-only.** The existing validator (`dialogue-reader-labels.js validateLabels`), the preregistration
(§ label-loss) and the teacher sample's `label_loss_rule` accept an `UNLABELABLE` record only as `ADJUDICATED_GOLD`, declared
by an adjudicator with a written reason. The workstation therefore has no such outcome at any layer: the page has no
control or reason box; `checkDraft` refuses `gold_outcome: "UNLABELABLE"` (`unlabelable_not_primary`) on every route,
including a direct API commit (HTTP 422, nothing written); `loadLabels` refuses to load a file containing a `HUMAN_PRIMARY`
`UNLABELABLE` row, reporting the existing validator's own verdict (`unlabelable_record_invalid`); `--validate` prints that
code and exits 1; and `--validate-full` passes every verdict of the existing validator through unaltered (no pending, warning or
pass state is derived from it). The workstation does not add a third outcome, an abstention state or any adjudication
behaviour.

## 7. Local only

Loopback bind only (`127.0.0.1` / `::1` / `localhost`; any other `--host` is refused); every request must come from a
loopback address with a loopback `Host` (DNS-rebinding defense) and `Origin`, and carry a per-run token; a strict CSP
(`default-src 'none'`, same-origin connections only, a nonce for the one inline script and style) so the page cannot load
an external script, style, font, image or frame. The CLI installs an egress guard: `fetch`, `http(s).request/get`, socket
and TLS connects, UDP and hostname DNS all throw. No model call, telemetry, analytics, CDN or remote font exists.
