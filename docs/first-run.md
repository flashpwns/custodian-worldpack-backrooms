# Yellow Beast Playable Alpha Tutorial

The first developer playable loop uses **Async: Clear-Q4** (stable profile ID
`field-researcher`) and only Custodian public APIs.

```sh
node tools/play.js --profile field-researcher --seed demo --action MOVE --save .saves/clear-q4.json
node tools/play.js --resume .saves/clear-q4.json --action USE
```

`MOVE` traverses the declared controlled route; `USE` operates the declared
field interaction. The output includes the stable profile ID, player-safe
resources, and currently permitted declared actions. Saves contain Custodian's
public export envelope and retain stable profile IDs. LOOK/INSPECT/RECORD and
COMMUNICATE are intentionally unavailable until their existing declared rules
can be exposed without inventing observation or communication behavior.
