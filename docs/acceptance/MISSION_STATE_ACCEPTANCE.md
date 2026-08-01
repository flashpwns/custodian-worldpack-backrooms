# Mission State and Condition-Driven Objectives Acceptance

Status: implemented; final repository validation recorded below

Date: 2026-08-01

Artifacts: [ten-frame renderer evidence](MISSION_STATE_ACCEPTANCE.html) and [machine-readable state evidence](MISSION_STATE_EVIDENCE.json)

## Accepted player loop

The deterministic runner uses the production `DesktopService`, registered Clear-Q4 worldpack, action resolver, persistence path, observer-safe projection, and renderer. It creates and confirms a player record, reviews the briefing, selects optional marker equipment, completes the radio procedure, enters the Utility Room, performs an equipment-dependent test, captures two object-specific records, establishes the authored survey conditions, reports evidence and completes the scheduled check-in, moves away and returns, secures the return marker, begins return, closes at the declared Threshold-side location, reviews the derived result, shuts the service down, reconstructs it, and reopens the exact final record.

All fourteen generated checks pass. The ten renderer frames show briefing objectives, a radio-derived update, active/optional/blocked objectives, evidence progress, optional evidence, reporting/check-in progress, route/readiness, return in progress, derived debrief, and the post-restart record.

## Architecture and ownership

`tools/mission-runtime.js` is a generic engine. It contains no Clear-Q4 object, location, personnel, or prose. `canon/operational-mission-schema.json` defines the data contract. `data/worldpacks/clear-q4/mission.json` owns assignment intent and conditions. The registered pack points to that mission record. `data/worldpacks/minimal-mission` proves that a second mission can validate and evaluate without importing Clear-Q4 logic.

`expedition.mission_state` is the sole serialized mission authority. It owns objective initialization, lifecycle, blockers, objective and mission transition history, evaluation revision, return state/readiness, migration provenance, and the immutable final result. The old `expedition.objectives` property is a non-enumerable compatibility getter over `mission_state.objectives`, not duplicate state. Object, evidence, spatial, equipment, personnel, radio, and time runtimes retain ownership of their own facts; mission conditions only read them.

## Objective lifecycle and transition rules

The bounded states are `inactive`, `blocked`, `active`, `satisfied`, `failed`, `waived`, and `abandoned`.

- Inactive means activation conditions are not true.
- Blocked means the objective is relevant but a declared dependency or known operating condition prevents progress.
- Active means it can advance.
- Satisfied means its authored satisfaction condition is true.
- Failed means its declared failure became true under the objective's recovery rules.
- Waived means an explicit authored waiver permits continuation.
- Abandoned means return, abort, or closure ended unresolved work.

Default transitions allow inactive/blocked/active movement into relevant nonterminal states. Satisfied is terminal unless the objective is live/reversible. Failed is terminal unless recoverable. Waived and abandoned are terminal. Authored transition tables may narrow behavior but validation rejects incoherent transitions. Clear-Q4 exercises sticky radio/evidence/survey progress, a recoverable route, an irrecoverable check-in, dependency blocking, an explicit communication-loss waiver, and abort abandonment.

## Condition language

Conditions are structured JSON data with `all`, `any`, and `not`; arbitrary JavaScript or expressions are rejected. Leaf sources are:

- object existence, known property, state, mutation, and completed interaction;
- evidence existence, validity, type/source/fingerprint, custody, reporting, count, distinct count, and capture time;
- location discovery/visit/current/return, route traversal/availability, connection verification, and unresolved exits;
- equipment assignment, custody/access, condition, depletion/loss/storage/transfer, and consumables;
- personnel life/activity/condition, separation/proximity/return/accountability, and assigned-equipment retention/loss;
- radio check, delivery, report, evidence reporting, check-in completion/miss, acknowledgment, availability, and closure delivery;
- operational interval, deadline state, and action-before/after thresholds;
- objective dependencies/counts/groups plus mission phase/lifecycle/return/abort/closure state.

Validation resolves worldpack object, location, connection, equipment, personnel-role, and objective references. It rejects duplicate mission/objective IDs, missing or circular dependencies, unknown references, invalid operators/types/transitions/initial states, impossible required activation, unknown outcome references, and ambiguous completion/abort/return policies.

## Atomic evaluation

Evaluation reads a snapshot, repeatedly resolves objective conditions until dependencies converge, derives blockers and return state, validates every proposed transition, then commits the batch. A failed evaluation or commit cannot leave a partial objective mutation. Re-evaluation against unchanged state does not increment the revision or append history. Every real objective transition receives one history entry and one canonical expedition event.

Precedence is activation, dependency, waiver, failure, blocking, then satisfaction. This makes conflicting rules deterministic while allowing a worldpack to state, for example, that a communication outage waives a missed check-in before the ordinary missed-window failure is applied.

## Clear-Q4 conversion

Nine authored objectives now replace the legacy five-objective map and early object predicates:

1. establish radio contact from the persisted check/acknowledgment state;
2. enter the declared survey area from actual traversal;
3. establish Utility Room conditions from declared object knowledge plus a valid feature interaction;
4. capture mission evidence from object-specific valid records;
5. report field evidence through delivered Standard communication;
6. verify the return route from traversal plus the secured marker state;
7. maintain the scheduled check-in, including failed or communication-waived outcomes;
8. return with accountability from request, location, personnel, and reconciled equipment/evidence outcomes;
9. optionally document a second distinct object condition.

The optional objective changes a clean debrief to `clean-completion-with-optional` but never blocks required completion. A missed check-in yields `degraded-completion`; an unreconciled missing-person return can yield `mission-failure`; controlled abort yields `controlled-abort` and abandons unresolved work.

## Return, abort, and mission closure

RETURN validates the authored route and records a return request. It does not finalize the run or enter debrief. The player remains in a return phase until the declared return point and accountability requirements permit closure. Closure records a Standard message when the radio is operational, or uses the authored communication-unavailable alternative. The final result is created once and is stable afterward.

ABORT remains available until closure. It preserves the entire world, atomically applies the declared unresolved-objective policy, and activates return accountability. It is distinct from catastrophic mission failure. A missing-person failure, equipment loss, missed check-in, unreported evidence, route compromise, optional success, and evidence quality remain structured outcome facts/hooks rather than fixed prose.

The final result contains mission/final state/classification, required satisfied/failed/waived/abandoned lists, optional outcomes, named objective outcomes, personnel and equipment outcomes, evidence counts/quality, communication and return outcomes, operational time, public debrief, institutional consequence hooks, and evaluation revision.

## Observer-safe UI and accessibility

The mission panel groups required and optional objectives, current blockers, recent updates, and return readiness. Each row uses a symbol, visible text label, state word, and screen-reader label; state is never color-only. Details disclose recent public transitions. Responsive layout, text scaling, reduced motion, focus order, and the existing keyboard controls remain intact.

Projection suppresses next requirements for inactive objectives, chooses separate public language for dependency versus operating-condition blockers, removes internal return-location IDs from the public result, and never exposes raw objective/object IDs, predicate paths, serialized conditions, undiscovered route requirements, or unknown personnel facts.

## Persistence and migration

Mission definitions and state are independently versioned. The run envelope is `yellow-beast-save@v8`; the desktop session is `yellow-beast-session@6`. Restore explicitly accepts earlier envelopes, initializes missing registered state, maps `survey`, `evidence`, `check_in`, `return_decision`, and `route_verification` into current objective IDs, retains satisfied progress/history, and reevaluates from the preserved spatial/object/evidence/equipment/personnel/radio/time facts. Unknown versions do not silently reset.

Focused tests compare partial blocked state and complete final state across shutdown/restart. The acceptance compares mission/objective/history/result, object state, evidence, equipment, personnel, map/spatial state, radio/messages, and operational clock exactly.

## Validation record

- Focused mission-state suite: passed (13/13).
- Mission-state acceptance: passed (14/14 checks; ten renderer frames).
- Focused playable-spine suite: passed.
- Focused structured-interaction suite: passed.
- Asset and mission-data validation: passed.
- Desktop build: passed; mission runtime/schema and both mission packs are required build inputs.
- Full repository suite: passed after the milestone implementation.

## Known limitations and next milestone

Clear-Q4 still has a compact authored topology and no live hazard that naturally injures or separates personnel; the failure branch is covered through authoritative-state integration tests until that content exists. Standard records reports and closure but does not yet run a rich response policy. Equipment state is authoritative and affects missions, but take/drop/stow/recover/container actions remain incomplete. Long-term institutional behavior consumes stable hooks but is intentionally deferred.

The highest-priority next milestone is the general equipment, custody, and container loop. It should make loss, abandonment, recovery, handoff, depletion, and storage player-driven so the mission runtime's existing equipment/accountability/debrief consequences arise from a complete field interaction loop before hazards and team autonomy expand.
