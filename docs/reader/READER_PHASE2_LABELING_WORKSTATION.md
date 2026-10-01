# Reader Phase 2: human primary labeling workstation

**Status:** implementation; RED repair (human primary has two outcomes only) applied, awaiting independent re-audit (2026-10-01). **Tool:** `tools/dialogue-reader-labeling-workstation.js`.
**Tests:** `tests/ed33d-reader-phase2-labeling-workstation.test.js`.

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

## 3. Labeling one item

1. **Read** the player line and the context. Everything shown is in the worksheet's `render_user`, parsed for display
   only; the raw text, with a copy button, is under "Raw render text".
2. **Choose an outcome.** None is preselected. There is no keyboard shortcut for choosing an outcome.
   - **A. ACCEPT:** write the wire yourself in the empty box. Syntax and structure are checked as you type (V0 parser
     errors; V1 legal labels; V2 surface contradictions).
   - **B. EXPECTED_CLARIFY:** write the wire, then choose the ambiguous **field** and the clarification **slot** from the
     existing taxonomy (`CLARIFY_FIELDS`, `CLARIFY_SLOTS`); neither is preselected. The note is optional. The wire must
     itself express the ambiguity you declare (`ab=<field>`, or `r=unsure` for referent).

   A human primary has exactly these two outcomes. Choose your best supported ACCEPT or EXPECTED_CLARIFY reading. Genuine
   ambiguity is expressed with the existing mechanisms (`ab=<field>` or `r=unsure` in the wire, and an EXPECTED_CLARIFY
   when you judge the render should clarify); any concern or uncertainty goes in your notes. **UNLABELABLE is not a primary
   outcome:** only an adjudicator may declare a render unlabelable (see §6).
   - Changing the outcome clears only the fields the new outcome does not own (switching to ACCEPT clears the ambiguous
     field, slot and clarification note); it never moves or infers content, never chooses a value for you, and your wire
     and notes stay. What the form shows is exactly what is validated and committed.
3. **Commit primary** (or "Commit & next uncommitted"). The commit button is disabled until an outcome is chosen and the
   draft validates. "Commit" writes the `HUMAN_PRIMARY` row to the local label file; it is **not** a git commit.
4. A committed item shows its judgment read-only. Changing it takes the explicit **Edit / recommit…** action and a
   confirmation; the new row has its own `committed_at` and the replaced row is preserved in `journal.jsonl`.

Navigation: Prev / Next / Next uncommitted, jump to a number or a `rg-` id, and Alt+J / Alt+K / Alt+U. `Ctrl/Cmd+Enter`
commits only when an outcome is chosen and the draft validates. Drafts are held in browser memory only (nothing is stored
in the browser).

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
