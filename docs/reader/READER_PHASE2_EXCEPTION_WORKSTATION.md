# Reader Phase 2 exception workstation

Launch from the repository:

```sh
node tools/dialogue-reader-labeling-workstation.js --exceptions --open
```

The loopback-only UI uses the audited Easy interface. The queue now contains exactly 10 entries: 9 Full Easy ordinary judgments and 1 separate contract-policy decision. Scope is verified against `summary.json`, `final-annotations.jsonl`, and both validation outputs in `.agent-notes/reader-phase2-blind-model-run-2026-10-05T02-27-43-090Z/`. The 412 earlier machine-valid rows and 52 mechanically valid Opus candidates remain parked as model provenance, not human gold. No model answers or validator-derived semantic batch hints appear in the queue; ordinary forms begin blank and require full HUMAN_PRIMARY judgments.

At the scope cutover, all 14 existing saved events concerned `rg-00d773c28a1704af`, outside this final scope. They remain byte-preserved in the ledger and do not affect navigation, restore, or progress. Progress counts only current in-scope human labels and policy decisions; earlier out-of-scope events cannot create phantom progress. New in-scope choices resume normally. No migration event is needed.

1–9 then A–Z choose the visible options. Enter advances an answered question or submits the final preview and goes to the next unresolved item. Backspace returns to the previous question. Alt+J/K change items; Alt+Z undoes an explicit choice; Alt+E edits your own saved judgment. Native dropdowns support Tab and arrow keys. Batch buttons allow direct navigation. New items have no semantic selections. Held keys cannot act on a newly displayed question. “Park saved choices” preserves difficult work without inventing a valid label.

Each explicit choice is saved atomically in `.agent-notes/reader-phase2-labeling/exception-work/human-exception-choices.jsonl`. These entries are human work in progress, not labels or gold. Reload restores only your own saved choices. Undo/edit preserves event history; it changes a committed primary only after an explicit resubmission. A validated primary submission uses the existing workstation writer to save HUMAN_PRIMARY in `labels.jsonl`; existing rows remain preserved. Prior primaries have a durable preimage in the choice ledger before replacement and the existing workstation journal afterward. Stale revisions fail closed.

The policy item asks whether spoken Tonya address should remain separate from Malcolm delivery (Convention B), or delivery should control address (requiring a future contract amendment). Recording a decision creates no label and does not itself implement a policy. Jack’s saved `spoken_address_separate` decision was explicitly implemented on 2026-10-05: the validator accepts evidenced spoken Tonya address distinct from Malcolm delivery, and the resolver preserves chip routing with a conflict diagnostic. The historical policy ledger stays unchanged. Deferral of other decisions remains pending. See `../dialogue/DIALOGUE_CLOSURE_STATUS.md` for current provenance and readiness.

For scratch-only usability work:

```sh
node tools/dialogue-reader-labeling-workstation.js --exceptions --scratch --port 47476
```

Scratch mode copies only the frozen worksheet/input pack into a temporary directory and labels the synthetic actor `synthetic-usability`. It never writes real Jack labels.

Scope follow-up validation: 70 focused tests passed across ed33c, ed33d, ed33e, ed33i (8 exception tests). Existing protection tests now assert byte preservation of pre-existing human files instead of assuming those files do not exist. Synthetic browser testing exercised keyboard selection, reload/resume, primary submit/next, blank Enter protection, edit/undo and isolated policy deferral. Historical local/repair/recovery evidence archives matched 33 source files byte for byte.

Contraction follow-up: fresh ReaderInput recognizes `you’re`, `you’ve`, `you’ll`, and `you’d` (including normalized missing-apostrophe forms). V2 also recognizes these explicit contractions within each act’s token span in older frozen packs, without rewriting those packs or inferring address from interface delivery. Both previously blocked Complex questions now pass the full frozen validator. At that contraction-fix handoff the Tonya/Malcolm policy was still recorded only; the contraction fix itself did not implement it or enable Reader cutover. The separately authorized 2026-10-05 implementation is described above and in the current dialogue closure status.
