# Yellow Beast product roadmap: Clear-Q4 first

Clear-Q4 is the sole active playable experience until it reaches manual
quality acceptance. The visible roadmap remains ordered as:

1. Clear-Q4 — playable now
2. Lost — Coming Soon
3. Beck's Desk — Coming Soon
4. Nullzone Exposure — Coming Soon

The three later experiences remain implemented for development and regression
coverage, but ordinary player navigation does not enter them. Their simulation
and runtime behavior are unchanged by this product lock.

## Intended Clear-Q4 lifecycle

The canonical product target is:

`BRIEFING → STAGING_AND_EQUIPMENT → THRESHOLD_ROOM → CROSS_THRESHOLD → STANDARD_RADIO_CHECK → COMPLEX_TRAVERSAL → SITE_DISCOVERY → ASSIGNMENT_WORK → X_FACTOR → PLAYER_DECISION → RETURN_OR_FAILURE → MISSION_REVIEW → NEXT_EXPEDITION`

This pass records the target only. It does not add mechanics or force missing
rows to appear complete.

| Product stage | Current runtime mapping | Status | Gap / next focused work |
| --- | --- | --- | --- |
| BRIEFING | `BRIEFING`; operational briefing scene with order, team, equipment, reporting, and readiness | Exists | Continue manual prose/UI acceptance |
| STAGING_AND_EQUIPMENT | `STAGING`; guarded phase transition and equipment/team surface | Partial | Make staging feel materially distinct and operational |
| THRESHOLD_ROOM | `FACILITY_TRANSIT` / `THRESHOLD`; guarded pre-field contexts | Partial | Give the Threshold room a stronger canonical scene and interaction boundary |
| CROSS_THRESHOLD | Guarded `CROSS` plus canonical movement into `FIELD_OPERATION` | Partial | Align naming and presentation with the crossing event |
| STANDARD_RADIO_CHECK | Expedition `COMMUNICATE` and reporting objective | Partial | Make the Standard channel diegetic and distinct from physical action |
| COMPLEX_TRAVERSAL | Procedural movement and observer-safe field scene | Exists | Keep traversal prose natural and acceptance-focused |
| SITE_DISCOVERY | LOOK/INSPECT/RECORD and observer-safe generated site state | Partial | Define site discovery as mission progress without opaque labels |
| ASSIGNMENT_WORK | Bounded survey/evidence objectives and equipment use | Partial | Let the generated mundane assignment define legitimate work |
| X_FACTOR | Existing admitted phenomena/evidence boundaries; no Q4 escalation loop | Missing | Add only through canonical world state, not narrator invention |
| PLAYER_DECISION | Existing return/abort and bounded consequence outcomes | Partial | Present meaningful obey, investigate, leave, or failure decisions |
| RETURN_OR_FAILURE | Expedition `RETURN` / `ABORT`, including degraded outcomes | Exists | Improve continuity into review |
| MISSION_REVIEW | Existing `DEBRIEF` metadata and expedition/report distinctions | Partial | Derive a complete review from recorded history |
| NEXT_EXPEDITION | No diegetic continuation loop in the desktop flow | Missing | Continue from reviewed history without feeling like a level reset |

## Future requirements (recorded, not implemented here)

### Interaction channels

- `ACTION`: physical and environmental attempts.
- `LOCAL`: dialogue with physically present personnel.
- `STANDARD`: radio dialogue with ASYNC/Threshold Control.

These channels must coexist. Dialogue must not consume physical
locomotion/action opportunities merely because both are expressed through the
same player input surface.

### Personnel

Future Q4 personnel need persistent generated first-and-last identities,
roles, applicable clearance/access, and basic condition/status. Dialogue uses
first names. An ordinary NPC should not be presented as generic “Researcher”.

### Equipment

Equipment remains persistent state with player-facing operational
descriptions and status, rather than videogame-style “charges”.

### Mission generation and review

The mundane generated assignment comes first and defines legitimate mission
work. Any hidden anomaly/X-factor exists independently of player recognition;
escalation is canonical/world-state driven, never narrator invention. A player
may notice or miss it, leave early, obey Standard, disobey, investigate, or
fail to return. When logically possible, every concluded run reaches a
history-derived mission review/debrief, and a next expedition continues
diegetically from that review.

### ASYNC interface direction

The eventual interface should feel like institutional ASYNC field software,
not a generic Backrooms dashboard. Candidate surfaces include imagery,
personnel cards, maps, records, mission identifiers, timestamps, equipment
status, radio context, and captured field material. No speculative visual
assets are introduced by this roadmap pass.
