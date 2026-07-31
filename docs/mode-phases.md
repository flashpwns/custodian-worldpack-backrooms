# Mode phases and guided introductions

`yellow-beast-phase@v1` is application gameflow metadata, not canonical world truth. It persists with a desktop session and references, but never replaces, canonical location, objects, knowledge, communications, or history. Definitions are declarative for Clear-Q4, Beck, Nullzone, and Lost; transitions are validated and guardable.

Guided Introductions default on and affect only contextual, diegetic guidance. Completion and skips are noncanonical. Guidance does not select actions, teleport actors, or complete objectives: player input remains on the YB-27 freeform turn boundary. It works offline. On resume, phase state is restored and guidance is recomputed from legitimate current state.

## YB-28 convergence

All modes use `yellow-beast-phase@v1`, but phase state is application gameflow rather than a second world store. Clear-Q4 uses a guarded linear expedition sequence; Beck uses temporary event-driven contexts; Nullzone cycles through its investigation loop; Lost keeps its minimal internal context out of ordinary player UI. Phase changes do not move actors, objects, evidence, reports, or institutional belief.

| Mode | Primary experience | Observer-safe context | Shared consequence |
| --- | --- | --- | --- |
| Clear-Q4 | Expedition scene, team, radio, equipment | Field observation and delivered orders | Field equipment/evidence and world mutations |
| Beck | Situation, inbox, reports, people/processes | Received institutional records only | Requests, reports, and canonical processes |
| Nullzone | Personal scene, archive, notebook, preparation | Personal evidence and labels only | Recovered or placed physical objects |
| Lost | Scene and freeform input | Immediate perception, carried items, personal landmarks | Persistent markers and abandoned objects |

The intended knowledge bridges are radio, direct speech, a received report, transferred evidence, and a represented institutional process. Shared object identity is never itself a knowledge bridge: a later observer can see an object without learning who placed it, why, or what another observer called the location. `npm run immersive-report` and `tests/y28-immersive-convergence.test.js` exercise these boundaries, guided ON/OFF parity, projection isolation, resume behavior, and offline-safe profiles.

## Clear-Q4 expedition phases

Clear-Q4 uses BRIEFING, STAGING, FACILITY_TRANSIT, THRESHOLD, FIELD_OPERATION, RETURN, and DEBRIEF. Briefing establishes only the declared order, team, equipment, and reporting procedure. Staging and transit provide contextual equipment, radio, and team surfaces. Threshold crossing is guarded by canonical movement; phase metadata never crosses it for the player. Field scenes prioritize environment, team, equipment, radio, and the declared survey. Debrief distinguishes expedition record, player observation, player report, and institutional knowledge.

## Beck's Desk

Beck uses event-capable START_OF_DAY, INBOX_REVIEW, ACTIVE_DESK, INTERRUPTION, DECISION, and FOLLOWUP contexts. Its inbox and situation view derive only from supplied institutional reports and processes. A report is not objective truth; it can be delayed, incomplete, or wrong. Field state reaches Beck only through legitimate reports, communications, or institutional processes.

## Nullzone Exposure

Nullzone cycles HOME, EVIDENCE_REVIEW, PREPARATION, EXCURSION, RETURN, and COMPARISON. Its archive is personal presentation state drawn only from civilian evidence and records. Personal labels and remembered routes stay observer-local and explicitly remembered, never objective topology or institutional knowledge.

## Lost

Lost uses ENTRY, WANDERING, SIGNIFICANT_DISCOVERY, and RECOVERY_OR_CONTINUATION internally, but never exposes phase labels in ordinary player presentation. Its surface is scene-first with compact carried objects and a minimal optional prompt. It intentionally has no institutional context, map, formal objective, or risk meter; uncertainty comes from limited observation, not false narration.
