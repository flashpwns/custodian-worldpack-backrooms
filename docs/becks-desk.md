# Async: Beck's Desk

Beck’s Desk is a terminal-first management projection over `yellow-beast-world-history@v1`, not a second management database. Persistent management materialization lives at `world.management`; every meaningful change appends a `management.*` world-history event.

The Beck-safe projection includes institutional reports, known regions, roster availability, teams, operations, resource counts, budget, evidence-gated research, physical-infrastructure projects, and a derived actionable task queue. It excludes raw events, objective field state, unseen topology, civilian records, and unreported observations. See [institutional simulation](institutional-simulation.md) for process, research, infrastructure, and projection rules.

The bounded Operations Trial supports field researchers, engineers, doctors, researchers, and operations staff; multiple teams; allocation; dispatch; recall requests; deterministic time; delayed reports; abstract budget; research priorities; recovery; and a persistent pack-original survey outpost. Recall is an issued order, never a guaranteed action.

Use the terminal launcher against a persistent world:

```sh
node tools/launcher.js --management --world operations-trial --management-action REVIEW
node tools/launcher.js --management --world operations-trial --management-action TEAM --id clear-q4 --members personnel-field-1,personnel-engineer-1
node tools/launcher.js --management --world operations-trial --management-action ALLOCATE --team clear-q4 --resource radio
node tools/launcher.js --management --world operations-trial --management-action ADVANCE
```

The management action surface is `REVIEW`, `TEAM`, `ALLOCATE`, `DISPATCH`, `RECALL`, `PRIORITIZE`, `BUILD`, and `ADVANCE`. `DISPATCH` and `BUILD` require an institutionally known persistent region ID; the projection exposes only safe known-region summaries, so a field report must establish that knowledge first.

Future field-run linkage is stable through operation ID, world ID, target persistent region ID, and originating management events. A later field run may carry that operation ID and return an expedition result to it. Full tactical team AI and final UI remain out of scope.
