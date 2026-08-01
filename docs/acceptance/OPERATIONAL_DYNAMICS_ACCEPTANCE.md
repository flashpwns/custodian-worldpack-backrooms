# Operational Dynamics Acceptance

Status: implemented; final repository validation recorded below

Date: 2026-08-01

Artifacts: [renderer-backed evidence](OPERATIONAL_DYNAMICS_ACCEPTANCE.html) and [machine-readable evidence](OPERATIONAL_DYNAMICS_EVIDENCE.json)

## Accepted operational loop

The deterministic runner uses the production `DesktopService`, Clear-Q4 worldpack, shared action resolver, observer-safe projection, renderer, and disk persistence. It generates a bounded team, enters the field, advances one operational clock, releases a scheduled check-in, records evidence, accepts an independent-movement order, and loses contact with the moving teammate. The player sees only the teammate's last-known normal condition while authoritative state records a remote injury.

The player reaches the teammate, observes the structural hazard and injury, receives a grounded delay on another movement order, assists the teammate, recovers dropped equipment, and mitigates the hazard. A combined evidence/check-in report enters an authored interference zone, remains delayed past the reporting window, is recorded as missed, later delivers, and recovers the mission objective without erasing missed-window history. The team regroups, performs an equipment-dependent test, verifies the return route, closes the mission, and receives a `recovered-complication` debrief.

The runner then shuts down, reconstructs the service, and compares authoritative and observer-safe records exactly. A second seed produces different coworkers and resumes the same identities after restart.

## Architecture and ownership

`tools/operational-cycle.js` advances the single clock, releases due events, resolves communications, teammate decisions, hazards, atomic consequences, equipment/spatial custody, and finally condition-driven mission state. Presentation consumes the already-resolved state and cannot trigger events.

- `operational-time.js` owns the clock, persistent queue, cancellation, repetition, due resolution, and history.
- `communication-runtime.js` owns message delivery and check-in state.
- `team-runtime.js` owns orders, tasks, decisions, movement, and observer last-known records.
- `hazard-runtime.js` owns activation, detection, exposure, mitigation, and recorded outcomes.
- `consequence-runtime.js` validates complete proposals and atomically commits personnel, equipment, route, delay, and evidence effects.
- `mission-runtime.js` reads these systems without owning or duplicating them.

Definitions live in each pack's `dynamics.json` and validate against `canon/operational-dynamics-schema.json`. The minimal second worldpack proves the runtime has no Clear-Q4 names or executable predicates.

## Time and communications

`expedition.operational.clock` is authoritative; the legacy clock field references that same object. Action costs are authored with validated defaults. Scheduled events retain stable ID, type, interval, source, target, payload, visibility, status, resolution history, recurrence, and cancellation reason. Resolution is idempotent at a fixed interval.

LOCAL requires actual speaking range and records actual recipients. Field-radio messages progress through composed, queued, transmitting/delayed, delivered, acknowledged, failed, or expired. Standard delivery and acknowledgment are scheduled events. Evidence becomes available to Standard only on delivery. Check-ins progress through scheduled, approaching, due, transmitting, overdue, missed, completed, or waived.

## Personnel, orders, and knowledge

The validated name pools contain more than 500 unique first and last names. Seeded generation creates one player plus two to four coworkers, avoids duplicate full names and the player's name, assigns required operational roles, and persists identities permanently. Existing saves retain established names; new production runs do not select or depend on Alex or Nora.

The bounded team model supports follow, hold, wait, investigate, equipment operation, known-route movement, return/contact restoration, teammate assistance, LOCAL reporting, field-radio transmission, and task abandonment. Orders may be accepted, delayed, clarification-requested, refused, unheard, attempted, failed, or completed. Movement uses known adjacent connections. Refusal and delay use condition, route, equipment, risk, or current-task facts rather than random friction.

When contact is lost, the public team and map surfaces expose only last confirmed location, condition, contact interval, task uncertainty, and last-confirmed custody. Remote true state remains hidden until observation or communication establishes it.

## Hazards, consequences, and recovery

Clear-Q4 authors a loose overhead service bracket in the columned corridor. It activates from declared time/state conditions, exposes a coworker only when that coworker is actually present, causes persistent injury and a dropped instrument, and remains hidden from a separated player. Assistance stabilizes the coworker, recovery restores equipment custody, and the route-marker kit mitigates the bracket. Exposure and chosen outcomes persist, so restart cannot reroll them.

Consequence proposals are cloned and fully validated before commit. Invalid proposals change nothing. Death, missing status, destroyed equipment, and permanent route loss are supported as irreversible authored outcomes, but the Clear-Q4 slice uses a legible recoverable injury rather than arbitrary death.

## UI, persistence, and migration

The scene-first renderer adds compact operational time, check-in meaning, communication delivery/acknowledgment, team contact/task/condition/custody, detected warnings, recovery controls, immediate updates, and derived consequences. Text and symbols supplement color; keyboard support, text scaling, reduced motion, screen-reader labels, responsive layout, and focus order remain intact. No hidden hazard, remote condition, raw severity, random roll, predicate, or internal personnel ID is rendered.

The run envelope is `yellow-beast-save@v8`; the desktop envelope is `yellow-beast-session@6`. Explicit migrations initialize operational records without renaming established personnel or resetting mission, object, evidence, equipment, radio, check-in, route, position, or time state. Unknown versions are rejected rather than reset.

Acceptance compares clock, events, messages, check-ins, identities, tasks, decisions, movement, last-known knowledge, hazards, exposures, consequences, recovery, equipment, routes, evidence, mission histories/readiness/result, and observer-safe projection across shutdown/restart.

## Validation and limitations

- Focused operational-dynamics suite: passed (17 tests).
- Renderer-backed acceptance: passed (15 checks and 12 frames).
- Second-seed determinism and variation: passed.
- Prior playable-spine, structured-interaction, and mission-state suites: passed.
- Asset/contract validation, desktop build, alpha artifact, and full repository suite: passed.

The team policy deliberately stops at adjacent known-route decisions. Clear-Q4 has one compact recoverable hazard and one interference zone. Standard schedules delivery and acknowledgment but not long-term strategy. Equipment supports this milestone's custody, drop, damage, and recovery paths; comprehensive take/stow/container UX remains deferred.

The highest-priority next milestone is the general field inventory and custody loop, followed by deeper institutional response.
