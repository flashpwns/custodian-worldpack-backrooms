# Reader Phase 2 exception workstation

Launch from the repository:

```sh
node tools/dialogue-reader-labeling-workstation.js --exceptions --open
```

The loopback-only UI uses the audited Easy interface. Its deterministic queue has 62 items: Address 20, Speech force / clause split 19, Relation 8, Facet / referent 2, Full Easy 12, Contract policy 1. The authoritative scope is the 412-valid / 62-invalid recovery snapshot; cold Llama results do not change that scope. No generation takes place. The three hypothetical encoding corrections stay unresolved.

The frozen label guide does not authorize mixed-provenance field labels. Thus 61 items require complete blind HUMAN_PRIMARY judgments, starting with the batch's disputed dimension, plus one separate policy decision. No machine meaning is copied into the form. Estimate at least 367 core selections; allow roughly 450–650 selections plus 61 submissions as facet groups, additional parts and optional details require further choices. This is a selection estimate, not a guarantee of how quickly interpretation will take.

1–9 then A–Z choose the visible options. Enter advances an answered question or submits the final preview and goes to the next unresolved item. Backspace returns to the previous question. Alt+J/K change items; Alt+Z undoes an explicit choice; Alt+E edits your own saved judgment. Native dropdowns support Tab and arrow keys. Batch buttons allow direct navigation. New items have no semantic selections. Held keys cannot act on a newly displayed question. “Park saved choices” preserves difficult work without inventing a valid label.

Each explicit choice is saved atomically in `.agent-notes/reader-phase2-labeling/exception-work/human-exception-choices.jsonl`. These entries are human work in progress, not labels or gold. Reload restores only your own saved choices. Undo/edit preserves event history; it changes a committed primary only after an explicit resubmission. A validated primary submission uses the existing workstation writer to save HUMAN_PRIMARY in `labels.jsonl`; existing rows remain preserved. Prior primaries have a durable preimage in the choice ledger before replacement and the existing workstation journal afterward. Stale revisions fail closed.

The policy item asks whether spoken Tonya address should remain separate from Malcolm delivery (Convention B), or delivery should control address (requiring a future contract amendment). Recording the decision creates no label and changes no validator or frozen contract. Deferral remains pending. This policy still needs an explicitly authorized implementation change afterward.

For scratch-only usability work:

```sh
node tools/dialogue-reader-labeling-workstation.js --exceptions --scratch --port 47476
```

Scratch mode copies only the frozen worksheet/input pack into a temporary directory and labels the synthetic actor `synthetic-usability`. It never writes real Jack labels.

Validation: 103 focused tests passed across ed33c, ed33d, ed33e, ed33i. Existing protection tests now assert byte preservation of pre-existing human files instead of assuming those files do not exist. Synthetic browser testing exercised keyboard selection, reload/resume, primary submit/next, blank Enter protection, edit/undo and isolated policy deferral. Historical local/repair/recovery evidence archives matched 33 source files byte for byte. No commit or push.
