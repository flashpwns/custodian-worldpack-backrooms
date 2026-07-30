# Yellow Beast Playable Alpha Tutorial

This developer alpha uses **Async: Clear-Q4**. Its stable internal profile ID is `field-researcher`; saves use that ID, never the display title.

```sh
npm ci
npm run play -- --profile field-researcher --seed yb12-certification
npm run play -- --profile field-researcher --seed yb12-certification --action LOOK --save .saves/clear-q4.json
npm run play -- --resume .saves/clear-q4.json --action MOVE --save .saves/clear-q4.json
npm run play -- --resume .saves/clear-q4.json --action LOOK --save .saves/clear-q4.json
```

The second LOOK lists aliases such as `fixture-1`.

```sh
npm run play -- --resume .saves/clear-q4.json --action INSPECT --target fixture-1 --save .saves/clear-q4.json
npm run play -- --resume .saves/clear-q4.json --action USE --save .saves/clear-q4.json
```

The run becomes `completed` after the declared traversal, successful public inspection, and successful field interaction. LOOK/status remain read-only; further mutating actions are rejected. RECORD, COMMUNICATE, and WAIT are intentionally unavailable in this alpha.

Custodian's LOOK and INSPECT queries remain read-only. Yellow Beast therefore persists the scenario-local inspection acknowledgement in its versioned save alongside Custodian's public export; it is deterministic across the save/resume comparison and is not a substitute for hidden Custodian state.
