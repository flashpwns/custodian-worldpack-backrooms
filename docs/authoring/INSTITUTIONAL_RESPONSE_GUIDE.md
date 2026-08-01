# Institutional Response Guide

`institutional-runtime.js` is Standard’s generic persistent response authority. It reads institutionally admissible inputs and produces bounded policy decisions; it never owns or queries hidden mission, world, teammate, hazard, item, evidence, or route truth.

## Knowledge admission

An input needs a stable type, summary, state, facts, and provenance. Communications enter only after actual delivery or acknowledgment. Silence enters only after a declared check-in becomes missed. Closure may admit returned evidence, personnel testimony, equipment/container reconciliation, and the signed mission result. Claims can remain uncertain; reported data is not silently promoted to omniscient truth.

Failed/delayed transmissions, private observations, remote injuries, undiscovered hazards/routes, unreported deviations, and unconfirmed casualty status are excluded.

## Persistent state

The runtime stores confirmed knowledge, uncertain claims, pending reports/decisions, completed decisions, processed provenance, unavailable personnel, restrictions, follow-up assignments, and complete input/transition/review histories. Independent bounded dimensions cover:

- support posture
- scrutiny level
- operational confidence
- information confidence
- resource posture
- staffing posture
- equipment restriction level
- communication concern
- mission-review status

Every change records previous/new value, interval, triggering provenance, player-safe explanation, and private rationale. This is deliberately not one reputation score.

## Rules and delayed decisions

Worldpack rules use structured `all`, `any`, and `not` composition over whitelisted fields such as input type, purpose, state, outcome family, evidence quality, known fact, and count. A match schedules a stable response decision through the shared operational event queue. Resolution applies state changes once and, for an active expedition, creates the delivered Standard communication. Immediate responses require authored delay zero.

Supported decisions cover acknowledgments, clarification/evidence requests, check-in changes, deviation authorization/denial, cautions, return/withdrawal/abort guidance, optional-work restrictions, equipment authorization/restriction/review, evidence handling, staffing changes, oversight, and follow-up creation.

## Cross-mission continuity

Mission closure contributes one structured outcome record plus independently provenance-bound personnel, equipment, container, evidence, and deviation inputs. Confirmed deceased or missing personnel enter the unavailable roster and cannot be selected for a later active team. Follow-up hooks may adjust minimum staffing, recommend capabilities, or restrict optional stores. Clean history can reduce oversight; repeated reporting/equipment defects can increase scrutiny or constraints.

Clear-Q4 proves a real corroboration assignment and an accountability-review path. This is a foundation for later campaigns, not an endless assignment generator.

## Presentation

Player projection includes communicable dimensions, restrictions, known records, uncertainty labels, pending reviews, recent public decisions, and available follow-ups. It omits private rationale, hidden facts, internal IDs, raw rule conditions, and unresolved decision contents. Optional AI prose receives only that safe packet; the deterministic authored response is authoritative fallback.
