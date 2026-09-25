# Day-1 Coworker Knowledge Matrix (current playable slice only)

Scope: the Clear-Q4 Day-1 opener from the Maxwell briefing through `LOCAL_INTRODUCTIONS`. It does not cover anything past that point, and it is not a lore encyclopedia. The implementation is `tools/canonical-knowledge.js` (`knowledgeFor`, `queryKnowledge`, `briefedCustody`, `CANON_NOT_GRANTED`). Every grant records `concept`, `proposition`, `authority_class`, `source_ref`, `grant_basis`, `epistemic_mode` and `valid_scope`. **No source → no grant.**

Three separate questions are asked of every fact:

1. Is it true in project canon?
2. Does this character know it?
3. May it be said on this turn? The response plan decides this; knowledge alone never licenses speech.

## Authority classes used

| Class | Sources used | Treated as |
|---|---|---|
| L1 project authority | `SIMULATION_DOCTRINE.md` §7.5, §7.26–7.28 (interpretation law); `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md` §3 (onboarding, the player's), §STANDARD | Law and product truth. Onboarding (§3) is the **player's**, so it grants coworkers nothing. |
| L2 authored current slice | `data/worldpacks/clear-q4/cq4-day1-opener.json`: `briefing_authority.dialogue.*`, `staffing.coworker_archetypes`, `operational_window`, `assigned_manifest`, `mission`; `tools/canon-lexicon.js` (`CANONICAL_LOCATIONS`, `CANONICAL_ENTITIES`) | Truth for the slice. It becomes **knowledge** only through a canonical delivery event or the actor's own record. |
| Canonical runtime event | `personnel_briefing.exchange_history` (delivered beats, `beat_key`, `listeners`); `dialogue_history` + receipts (heard lines and the plans that licensed them); equipment holders | What actually happened, and to whom. |
| L3 reference | Kane Pixels reference material | **Not used.** Nothing reference-only was promoted. |
| L4 implementation | `authority_status: "legacy_unreconciled_briefing_material"` (a runtime label); `facts_communicated.team_size`; the runtime-authored schedule line text; `PRIMARY_TASK_PHRASES` | Evidence only. Where one conflicts with L2, L2 wins (see drift below). |

**Open ratification point:** the runtime labels the Maxwell briefing `legacy_unreconciled_briefing_material`. The same commit marks the mission record `cq4-day1-locked-design-law`. This matrix treats the authored briefing dialogue as L2; the owner should confirm that.

## Structured facts (all granted to a coworker only as listed below)

| Fact | Exact source | Canon status |
|---|---|---|
| Maxwell: "My name is Dr. Kirk Maxwell. You can call me Kirk." | `briefing_authority.dialogue.intro` | L2, spoken |
| Maxwell gave the assignment briefing | the delivered briefing event (attended) | runtime event |
| "Today's assignment is straightforward. Delivery and introductory reconnaissance." | `briefing_authority.dialogue.mission_statement` | L2, spoken |
| Departure 10:00 AM, return 12:00 noon, cutoff 1:00 PM | `operational_window` (values) + the delivered schedule beat (L4-authored line text) | L2 values, spoken |
| Roster: coworker2 has custody of the startup material scheduled for Outpost A, Bermuda branch; the player is on camera; coworker3 is on the layout record; coworker1 is on observation and verbal recall | `briefing_authority.dialogue.roster_call` (a template parsed by slot, never prose) | L2, spoken |
| Briefed custody: duffle → coworker2, 35mm field camera → player, layout record → coworker3 | `roster_call` ∩ `assigned_manifest.default_assignments` | L2, spoken |
| Get acquainted, then report to Equipment Staging | `briefing_authority.dialogue.dismissal` | L2, spoken |
| Own role / assignment | `staffing.coworker_archetypes[slot].role` / `primary_task` | L2, self |

## Day-1 knowledge matrix (the normal Electron flow: every beat delivered, all three coworkers present)

The three coworkers are **C1**, field researcher (verbal recall); **C2**, field technician (material delivery); and **C3**, field medical doctor (layout compilation).

| Concept | Canon? | C1 | C2 | C3 | Mode | Active from |
|---|---|---|---|---|---|---|
| Own name / role | YES | knows | knows | knows | self | run start |
| Own assignment | YES | "handling observation and verbal recall" | "delivering the startup materials" | "compiling the layout record" | self | run start |
| Own held equipment | YES | spectrometer | duffle | layout record | self | while held |
| Maxwell's identity (name, "call me Kirk") | YES | knows | knows | knows | briefing | intro beat delivered |
| Maxwell gave the briefing | YES | knows | knows | knows | observed | intro beat delivered |
| Maxwell's title / authority ("Chief Expedition Briefing Authority") | YES (L2 record) | **no** | **no** | **no** | — | shown in the UI only, never spoken |
| Today's objective ("delivery and introductory reconnaissance") | YES | knows | knows | knows | briefing | mission_statement delivered |
| Deployment / return / cutoff times | YES | knows | knows | knows | briefing | schedule beat delivered |
| Teammates' assignments | YES | knows | knows | knows | briefing | roster_call delivered |
| Teammates' roles (field technician, …) | YES | only by report | only by report | only by report | heard | when heard in the teammate's self-description |
| Team composition (names) | YES | knows | knows | knows | briefing | roster_call delivered |
| Startup material is scheduled for Outpost A, Bermuda branch | YES | knows | knows | knows | briefing | roster_call delivered |
| What Outpost A is (beyond that) | YES (mission record) | **no** | **no** | **no** | — | not briefed |
| Current step / next destination: get acquainted → Equipment Staging | YES | knows | knows | knows | briefing | dismissal delivered; valid while at `LOCAL_INTRODUCTIONS` in the briefing room |
| 35mm field camera is with the player | YES | knows | knows | knows | briefing | roster_call delivered |
| Field light holder; spectrometer holder (others') | YES | no | no | no | — | not briefed; only self or observed |
| Carry capacity (2 per person) | YES (`hard_capacity_per_person`) | **no** | **no** | **no** | — | not briefed |
| The Threshold / Standard / the Complex | YES (lexicon, constitution) | **no** | **no** | **no** | — | not delivered to coworkers at this stage |
| LOCAL / STANDARD communication terminology | YES | no | no | no | — | not briefed |
| Radio check / crossing procedure | YES (`threshold_sendoff`, `mission.procedures`) | no | no | no | — | not yet delivered (the sendoff comes at the Threshold) |
| Return / debrief procedure | YES (`mission.procedures`) | no | no | no | — | not briefed |
| What ASYNC is / does | UNSPECIFIED as structured canon (L1 prose only) | no | no | no | — | missing structured canon |

**Compartmentalization.** A coworker who is not in the briefing room when a beat is delivered gets none of that beat. A briefing concluded early grants only the beats actually delivered. A teammate's role heard in conversation is known only by report (`heard`). These cases are covered by tests in `tests/ed28-semantic-knowledge.test.js`.

## Canon present but not granted (true, but these characters don't know it yet)

These are listed in `CANON_NOT_GRANTED`:

- the Threshold, Standard, the Complex;
- the KV31 Threshold Room and the Threshold Approach;
- the mission procedures (radio check, crossing, guidance tape, delivery, return, Control Room verification);
- carry capacity;
- Maxwell's title;
- Outpost A beyond "the startup material is scheduled for it".

## Reference material not promoted

No Kane Pixels reference material was used or promoted. No external lore was consulted.

## Unsupported gaps (the repository cannot answer these without more authored canon)

- What ASYNC is and does, as an institution, at the level of employee knowledge.
- What the verbal recall, layout record and startup material are *for*, beyond "scheduled for Outpost A".
- Any coworker biography, tenure, prior expeditions, opinions or relationships.
- What the Complex, the Threshold and Standard are, as knowledge a Day-1 coworker holds at introductions.

## Drift fixed

`PRIMARY_TASK_PHRASES["verbal-recall"]` said "keeping the verbal record". The authored roster call says "observation and verbal recall", so the phrase is now "handling observation and verbal recall" (L4 → L2). The coworker roles and the other two tasks match the worldpack; no other drift was found.
