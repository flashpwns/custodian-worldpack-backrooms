# Playable Spine Manual Acceptance

Run: 2026-07-31 with `npm run acceptance:playable-spine` against a new temporary desktop application-data record named `ClearQ4est`.

The acceptance runner uses the same `DesktopService`, persistence envelope, projections, and surface renderer as the desktop application. It shuts the service down completely, constructs a new service instance over the saved files, resumes from disk, compares pre/post restart field facts, and writes deterministic rendered-surface captures. The captures are the requested equivalent evidence in place of bitmap screenshots.

| Step | Result | Evidence |
|---|---|---|
| Create `ClearQ4est`; create and confirm Jack Rocha | Pass | Briefing capture identifies Jack Rocha as the controlled player |
| Enter briefing | Pass | Assignment, immediate objective, and next required action dominate; support records are collapsible |
| Continue to staging | Pass | `READY` accepted |
| Approach threshold | Pass | `PROCEED` and `APPROACH` accepted |
| Enter threshold room / cross | Pass | `CROSS` accepted and radio moves to establishing |
| Perform radio check | Pass | `RADIO_CHECK` remains in `STANDARD_RADIO_CHECK` and records visible YOU/STANDARD messages |
| Enter field operation | Pass | Separate `BEGIN_FIELD_OPERATION` control accepted only after acknowledgement |
| Receive utility-room observation | Pass | Concrete fluorescent fixture, floor, team, and visible route prose; no placeholder text |
| Open Operational Map | Pass | Utility Room current; team present; discovered-only nodes; unresolved observed exits visible |
| Orient yourself | Pass | Natural structured observation; no raw IDs or serialized database labels |
| Move through a valid exit | Pass | Natural `Move into the corridor.` changes location to Columned Corridor, advances time, moves team, keeps LOCAL available, and updates discovery/history/map |
| Close completely | Pass | `shutdown()` flushes atomic world/session saves |
| Reopen and resume | Pass | New service instance resumes `FIELD_OPERATION`; player/YOU, coworkers, mission, equipment custody, LOCAL history, radio check/state, timer, Columned Corridor, route history, and discovered map equal the pre-close capture |

Artifacts:

- [`PLAYABLE_SPINE_ACCEPTANCE.html`](PLAYABLE_SPINE_ACCEPTANCE.html) — revised launch, world selection, briefing, radio, field/map, movement, and resumed renderer captures.
- [`PLAYABLE_SPINE_EVIDENCE.json`](PLAYABLE_SPINE_EVIDENCE.json) — machine-readable persisted state and acceptance booleans.
