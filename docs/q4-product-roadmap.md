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

## Three-channel foundation

Clear-Q4 now exposes three interaction lanes over the existing canonical
expedition timeline. `ACTION` remains the dominant physical/environmental
lane; `LOCAL` handles nearby dialogue; and `STANDARD` handles reachable radio
communication. Each attempt is recorded in a shared interaction envelope with
channel, grounding, eligibility, delivery, time cost, canonical effects, and
observer-safe knowledge/presentation. The lanes have separate histories, but
they do not create separate simulations or a realtime scheduler.

Communication advances only a small deterministic communication interval and
does not erase the current physical scene, phase, or location. A successful
Standard transmission records what the player reported as reported
institutional knowledge; it does not turn the report into objective world
truth. Local conversation remains local unless existing world rules explicitly
carry information onward.

Clear-Q4 now staffs persistent procedural personnel records with stable first
and last names, roles, clearance, condition, assignment history, and coarse
observer-safe contact status. Canonical death remains irreversible; a later
Q4 staffing pass may fill the role only with a different identity. The player
view receives contact and condition categories, not hidden position or health
telemetry.

## Future requirements (recorded, not implemented here)

### Interaction channels

- `ACTION`: physical and environmental attempts.
- `LOCAL`: dialogue with physically present personnel.
- `STANDARD`: radio dialogue with ASYNC/Threshold Control.

The remaining work is to deepen these channels without forcing dialogue to
consume physical locomotion/action opportunities merely because both are
expressed through the same player input surface.

### Remaining personnel work

The identity/status foundation exists. Future Q4 work may deepen personnel
records and dialogue without adding biographies, relationships, or advanced
NPC cognition.

### Equipment foundation and remaining work

Clear-Q4 now uses persistent physical item records with period-compatible
labels, holders, locations, operational states, required/optional loadouts,
staging readiness, and canonical handoff/loss behavior. Player presentation
uses operational descriptions rather than videogame-style “charges”. Full
mission generation and historical assignment continuity remain future work.

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
