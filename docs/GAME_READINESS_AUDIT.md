# Yellow Beast / Custodian Game-Readiness Audit

Status: post-Operational Dynamics combined milestone

Audit date: 2026-08-01

Acceptance evidence: [`acceptance/OPERATIONAL_DYNAMICS_ACCEPTANCE.html`](acceptance/OPERATIONAL_DYNAMICS_ACCEPTANCE.html), [`acceptance/OPERATIONAL_DYNAMICS_EVIDENCE.json`](acceptance/OPERATIONAL_DYNAMICS_EVIDENCE.json), [`acceptance/OPERATIONAL_DYNAMICS_ACCEPTANCE.md`](acceptance/OPERATIONAL_DYNAMICS_ACCEPTANCE.md), and the retained prior milestone evidence

## Executive finding

Yellow Beast now supports an honest, persistent operational mission loop:

> Receive an assignment -> advance one simulation clock -> release scheduled events -> communicate through real channel conditions -> direct a generated team -> encounter and recover from authored hazards -> update condition-driven objectives -> return or abort -> receive a derived outcome -> resume the exact final record after restart.

Clear-Q4 now adds a deterministic operational cycle around the mission runtime: one clock and event queue, delayed communications and acknowledgments, generated three-to-five-person staffing, independent teammate movement and grounded orders, last-known filtering, a worldpack-authored structural hazard, atomic persistent consequences, recovery, and recovered-complication debriefs. The largest remaining blockers are the comprehensive field inventory/container loop, deeper institutional response, broader authored content, and release accessibility certification.

## Current architecture and source of truth

The live desktop path is `desktop/main.js` → `desktop/preload.js` → `desktop/service.js` → shared runtime tools → observer-safe projection → `desktop/renderer`. `DesktopService` owns storage orchestration and public errors. `run-bootstrap.js` owns the active field run, save envelope, action execution, and compatibility normalization. `world-history.js` owns canonical cross-run facts. Mode phase transitions remain in `mode-phases.js`.

The operational spatial split is now explicit:

- The generic engine is `tools/spatial-runtime.js`. It validates definitions, migrates dynamic state, derives proximity and visible routes, resolves movement, discovers space, follows team behavior, synchronizes equipment positions, projects maps, and composes observations.
- The authoring contract is `canon/operational-spatial-schema.json`.
- Program registration is `data/worldpacks/registry.json`.
- Clear-Q4 topology and descriptions are `data/worldpacks/clear-q4/spatial.json`.
- The generic interaction engine is `tools/object-runtime.js`; the authoring contract is `canon/operational-interaction-schema.json`; Clear-Q4 content is `data/worldpacks/clear-q4/interactions.json`.
- The generic mission engine is `tools/mission-runtime.js`; the authoring contract is `canon/operational-mission-schema.json`; Clear-Q4 mission intent and conditions are `data/worldpacks/clear-q4/mission.json`. A minimal second mission pack proves the engine has no Clear-Q4 names or logic.
- The generic operational coordinator is `tools/operational-cycle.js`. It sequences `operational-time.js`, `communication-runtime.js`, `team-runtime.js`, `hazard-runtime.js`, and `consequence-runtime.js`, then invokes mission evaluation. Definitions live in each pack's `dynamics.json` and validate against `canon/operational-dynamics-schema.json`.
- `data/personnel-name-pools.json` and `personnel-generation.js` provide deterministic three-to-five-person staffing for new worlds; established legacy identities migrate without renaming.
- `expedition.mission_state` is the sole objective/mission authority. It stores lifecycle, objective states and histories, blockers, evaluation revision, mission transition history, return readiness, migration provenance, and the immutable final result. The old `expedition.objectives` surface is a non-serialized compatibility getter over that state.
- Dynamic mission, operational, spatial, and object state is persisted in `yellow-beast-save@v8` inside `yellow-beast-session@6`; explicit migrations retain prior identities, objectives, evidence, check-ins, messages, routes, positions, equipment, radio, and time.
- `q4-experience.js` projects observer-safe mission explanations shared by the renderer; it exposes names, state labels, grounded summaries, reasonable known next requirements, blockers, recent transitions, and return readiness without raw conditions or internal IDs.

The opening transition is now:

`BRIEFING --READY--> STAGING --PROCEED--> FACILITY_TRANSIT --APPROACH--> THRESHOLD --CROSS--> STANDARD_RADIO_CHECK --RADIO_CHECK--> STANDARD_RADIO_CHECK --BEGIN_FIELD_OPERATION--> FIELD_OPERATION`

The deliberate two-step radio phase prevents a procedural exchange from being skipped or hidden by a phase transition.

## Capability assessment

Status meanings: **Functional** is in the live loop and persisted; **Partial** has a usable slice but lacks required depth; **Cosmetic** appears in presentation without enough simulation authority; **Isolated** exists elsewhere in the framework but is not integrated into live Clear-Q4; **Missing** has no adequate implementation.

| Area | Status | Current evidence | Game-readiness judgment |
|---|---|---|---|
| Spatial navigation | Functional foundation | Worldpack graph, discovery, natural movement, invalid-route responses, map, team movement, persistence | Ready to support more authored space; vertical/conditional routes need content and rule depth |
| Player agency | Functional slice | Movement plus inspection, testing, photography, marking, opening/closing, securing, recording, equipment use, LOCAL/Standard communication, wait, and return/abort | The interaction loop is real but deliberately limited to a compact authored slice |
| Action resolution | Functional foundation | Worldpack affordances, visibility/knowledge gates, requirements, proximity, equipment access, mutations, time, evidence, natural parsing, ambiguity, and grounded rejection | Ready for additional content; not a full adventure-game verb system |
| World-state mutation | Functional foundation | One authoritative `object_state` feeds observation, affordances, evidence, objectives, interaction history, renderer, and persistence | Generic container/custody and route-lock mutations remain deferred |
| NPC agency | Functional operational slice | Generated coworkers observe known state, accept/delay/refuse grounded orders, move independently through valid routes, assist, investigate, follow, hold, and preserve decision history | Broader task repertoires and relationship consequences can follow; GRA-04 resolved for this slice |
| Personnel relationships | Partial | Persistent identity, assignments, status, succession, relationship history consumed by cognition | Relationship changes are not exposed as a live consequence loop; can follow team simulation |
| Equipment and inventory | Partial | Ownership, holder, condition, charges, handoff, canonical continuity, spatial position, verification semantics | No general take/drop/recover/container loop in live field play; blocker GRA-05 |
| Mission objectives | Functional foundation | Generic validated condition language, bounded lifecycle, dependencies, sticky/live/recoverable/irrecoverable rules, atomic transitions, histories, safe projection, and Clear-Q4 conversion | Ready for broader mission content; GRA-02 resolved |
| Communication systems | Functional operational slice | Authoritative LOCAL range plus persistent queued/transmitting/delayed/delivered/acknowledged/failed/expired radio messages and scheduled Standard replies | Richer institutional policy remains future scope |
| Time | Functional operational slice | One persisted operational clock advances once per action and releases due, delayed, repeating, cancelled, completed, or missed scheduled events | Longer-running authored processes can extend the same queue |
| Check-ins | Functional operational slice | Scheduled/approaching/due/transmitting/completed/overdue/missed/waived semantics derive from delivery and deadline state | Richer escalation remains future institutional scope |
| Hazards | Functional operational slice | Validated worldpack hazards activate from authoritative conditions, expose only detected warning signs, progress through time, and resolve deterministic exposure | The Clear-Q4 slice intentionally contains one bounded structural hazard; GRA-03 resolved for this slice |
| Uncertainty | Partial | Discovery hides unseen nodes; unresolved exits and reported/last-known categories exist; hidden trajectories are observer-gated | Information provenance needs more in-game acquisition paths |
| Incomplete information | Functional foundation | Map is non-omniscient; equipment and personnel have visual/radio/last-known semantics | Documents, teammate reports, and Standard survey imports are not yet authored |
| Consequences | Functional operational slice | Atomic personnel, equipment, route, delay, separation, and mission effects persist with cascade and recovery histories | Broader content variation remains future scope; GRA-03 resolved for this slice |
| Failure states | Functional foundation | Controlled abort, missed-check-in degradation, equipment-loss degradation, optional outcomes, unreconciled missing-person failure, hazard-driven degradation, and structured final results | More authored causes can reuse the same condition-driven outcome model |
| Injury/personnel loss | Functional operational slice | Minor through fatal states are modeled; the live slice applies a condition-driven minor injury with assistance, last-known filtering, and persistence | Serious/permanent outcomes remain rare and are not used arbitrarily |
| Standard oversight | Partial | Assignment, authorization, evidence reporting, check-in/closure delivery, and outcome hooks for lateness or omission | No policy engine queries, redirects, warns, or handles contradictory reports; blocker GRA-06 |
| Institutional response | Isolated/partial | Beck's Desk, institutional records, reviews, knowledge, operations time | Not causally closed with the Clear-Q4 field loop; blocker GRA-06 |
| Persistent world state | Functional foundation | Atomic writes; canonical mission/history/result, spatial, object, evidence, equipment, messages, scheduled events, team decisions/knowledge/locations, hazards, consequences, radio, and time state; v1-v6 session and v1-v8 run restore | Broader schema migration fixtures should continue as systems evolve |
| Save and resume | Functional | FIELD_OPERATION identity, mission, coworkers, gear, LOCAL history, radio, timer, location, discovery, and route history survive reconstruction | Meets this milestone's acceptance |
| Replayability | Partial | Seeded missions, bounded hidden trajectories, cross-run history, follow-up generation | Clear-Q4 spatial state/content is fixed and the complete scenario is absent; blocker GRA-08 |
| Worldpack authoring | Partial | Registration, formal spatial/interaction/mission schemas, strict reference/dependency/transition validation, generic minimal-pack tests, and Clear-Q4 data boundaries | No author-facing preview or migration CLI; blocker GRA-07 |
| Content scalability | Functional foundation | Shared runtimes consume arbitrary locations, connections, objects, aliases, affordances, predicates, prose, and mutations | Author tooling and larger-pack diagnostics remain; blocker GRA-07 |
| UI hierarchy | Functional foundation | Compact required/optional objectives, blockers, recent updates, return readiness, derived debrief, restrained map, and immediate update feedback | Dense larger missions still need usability evaluation |
| Accessibility | Partial | Existing text scaling/reduced motion/sensory settings; map has textual route and legend equivalents | Map keyboard/focus/screen-reader verification and contrast audit remain; blocker GRA-09 |
| Debugging and validation | Partial | Developer inspection, asset/contracts tests, deterministic acceptance artifact, generic-pack boundary test | No spatial event trace/author preview in the developer console; blocker GRA-10 |
| Automated tests | Strong foundation | Playable-spine, interaction, mission, and 17-test Operational Dynamics gates plus renderer-backed end-to-end acceptance covering schema, scheduling, communication, team decisions, hazards, atomic consequences, outcomes, migration, and restart | Broader authored hazard content remains deliberately deferred |
| Telemetry/development diagnostics | Partial | Local logs and report scripts exist; no external telemetry is required | Add opt-in/local diagnostics for action rejection and content coverage; blocker GRA-10 |
| Narrative presentation | Functional foundation | Structured spatial/object observations, condition-specific inspection/result prose, contextual object controls, ambiguity/rejection copy, and raw-state leak tests | Authored breadth remains intentionally small |
| Determinism vs controlled variation | Partial | Seeded mission/trajectory systems and deterministic save continuation | Variation policy is not formalized per worldpack; blocker GRA-08 |

## Blocker register

### GRA-01 — Data-driven observation and interaction (resolved for Milestone 2)

- **Delivered behavior:** Authored affordances validate visibility, knowledge, current state, proximity, and equipment; consume declared resources/time; mutate canonical object state; create condition-specific evidence; evaluate declarative objectives; and produce grounded follow-up observation.
- **Ownership:** `object-runtime.js` is generic, `interactions.json` is worldpack content, `run-bootstrap.js` orchestrates canonical effects, and `q4-experience.js` plus the renderer consume safe projections only.
- **Acceptance evidence:** The deterministic eight-frame artifact demonstrates four visible objects, inspection, a teammate-held instrument test, three distinct persistent mutations, evidence/objective updates, leave/return observation, and exact service restart/resume.
- **Remaining extension:** Containers and general loose-object custody can use the same affordance/mutation contract; the operational slice now consumes it for equipment-dependent mitigation and recovery.

### GRA-02 — Mission progression from world conditions (resolved for Milestone 3)

- **Delivered behavior:** A side-effect-free evaluator reads object knowledge/state/interactions, evidence/custody/reporting, space/routes, equipment, personnel, radio/messages/check-ins, operational time, and mission dependencies. It computes a complete proposal, resolves dependencies to convergence, validates every transition, and commits atomically.
- **Lifecycle:** Objectives are inactive, blocked, active, satisfied, failed, waived, or abandoned. Sticky, live, recoverable, and irrecoverable behavior is explicit. Missions move through briefing, authorized, in progress/return available, returning, and completed/failed/aborted.
- **Return and outcome:** RETURN only requests return. Closure requires the authored return point and accountability state; controlled abort abandons unresolved work. Structured results distinguish required/optional outcomes, personnel, equipment, evidence, communications, return, time, public debrief, and institutional hooks.
- **Acceptance evidence:** Clean, optional-enhanced, degraded, failed, and controlled-abort paths are condition-derived. The final mission state and record survive full shutdown/restart exactly.

### GRA-03 — Hazards, consequences, and recoverable failure (resolved for Operational Dynamics)

- **Delivered behavior:** Validated authored hazards activate and expose targets only from world conditions. A single atomic consequence transaction can injure or separate personnel, drop/damage equipment, block routes, advance delay, and feed mission evaluation without narration-owned truth.
- **Recovery:** Clear-Q4 demonstrates last-known uncertainty, a minor injury, dropped equipment, assistance, recovery, mitigation, missed contact, and a derived recovered-complication outcome. Chosen deterministic effects and histories survive restart without reroll.
- **Acceptance evidence:** The operational acceptance captures detection, exposure, hidden remote truth, observer-safe reunion, assistance, equipment recovery, mitigation, and final consequence hooks.
- **Dependencies:** GRA-01 and GRA-02; team and inventory state.
- **Priority:** P0 for a complete scenario, after interaction/objective foundations.
- **Acceptance evidence:** Automated and manual paths demonstrate safe handling, compromised continuation, authorized abort, and personnel/equipment consequence persistence.

### GRA-04 — Team agency and separation (resolved for Operational Dynamics)

- **Delivered behavior:** New worlds deterministically generate two to four coworkers from validated 500-plus first/last-name pools. Their stable identities, roles, knowledge, intent, tasks, orders, decisions, movement, condition, custody, and last-known status persist without reroll.
- **Decision model:** Grounded orders can be accepted, delayed, refused, or unheard according to contact, route, condition, equipment, task, authority, and risk. Independent movement follows known graph edges and synchronizes proximity, LOCAL eligibility, equipment, hazards, mission state, and last-known information.
- **Compatibility:** Existing saves retain established identities, including legacy Alex or Nora records; new runs contain no name-based production assumptions.
- **Dependencies:** GRA-01 affordances and GRA-03 consequences.
- **Priority:** P1.
- **Acceptance evidence:** A scripted split/rejoin and a loss-of-contact branch produce consistent LOCAL, radio, map, equipment, and persistence states.

### GRA-05 — Field inventory and custody loop

- **Current behavior:** Equipment is assigned, carried, usable, transferable, condition-aware, and preserved in continuity records.
- **Desired behavior:** Players can take, stow, drop, abandon, recover, transfer, damage, deplete, and locate equipment through spatially grounded actions.
- **Likely subsystem:** `q4-equipment.js`, spatial runtime, interaction resolver, evidence/continuity UI.
- **Implementation direction:** Make holder/container/location canonical; derive access from proximity and containers; add explicit custody events and observation verification.
- **Dependencies:** GRA-01 object interactions.
- **Priority:** P1.
- **Acceptance evidence:** A handoff/drop/separation/recovery sequence persists and renders visual, radio-confirmed, last-known, abandoned, damaged, and unknown states correctly.

### GRA-06 — Operational time and communications (operational slice resolved)

- **Delivered behavior:** One authoritative clock advances all active systems. A persistent idempotent event queue releases scheduled checks, radio delivery attempts, acknowledgments, hazard changes, teammate decisions, and consequences because their interval is due—not because a screen opened.
- **Communications:** LOCAL delivery uses actual speaking range. Field-radio envelopes retain sent, delivery, acknowledgment, failure, interference, and last-contact state. Standard acknowledgments are scheduled, and interference can delay a check-in beyond its deadline before late recovery.
- **Remaining institutional work:** Standard's bounded reply scheduler and outcome hooks are complete for this slice; policy-driven querying, redirects, warnings, and long-term follow-up remain Milestone 8.
- **Dependencies:** GRA-02 objective evaluator and GRA-03 consequences.
- **Priority:** P1.
- **Acceptance evidence:** On-time, overdue, intermittent-link, and omitted-report paths yield distinct histories, UI state, and institutional reviews.

### GRA-07 — Worldpack authoring validation and preview

- **Current behavior:** Spatial JSON has a schema and runtime validation, but authors must hand-edit data and discover errors through tests/runtime.
- **Desired behavior:** Authors can validate IDs, topology, reverse routes, discovery leaks, unreachable content, prose fields, affordances, objectives, and migration compatibility before play.
- **Likely subsystem:** `authoring.js`, schema validators, a new worldpack lint/preview report.
- **Implementation direction:** Create a CLI validator and observer-view snapshot generator; add fixtures for a second small pack and malformed packs.
- **Dependencies:** GRA-01/GRA-02 schemas must settle enough to validate.
- **Priority:** P1 for content scale.
- **Acceptance evidence:** CI rejects dangling routes, duplicate IDs, omniscient map leaks, missing prose, impossible criteria, and incompatible schema versions with actionable messages.

### GRA-08 — Replayability and controlled variation policy

- **Current behavior:** Missions and hidden trajectories are seeded; spatial content and its primary route are fixed.
- **Desired behavior:** Each worldpack declares what is fixed, selected, generated, or varied, with deterministic continuation and legible consequences.
- **Likely subsystem:** Mission generator, worldpack registry/spatial authoring, run identity, replayability reports.
- **Implementation direction:** Add declared variation slots and seed provenance; do not randomize topology merely for novelty.
- **Dependencies:** Complete Clear-Q4 scenario and authoring validator.
- **Priority:** P2; safe to wait until the core scenario works.
- **Acceptance evidence:** Multiple seeds produce bounded, testable variation while identical saves resume exactly and required narrative beats remain reachable.

### GRA-09 — Map and field accessibility certification

- **Current behavior:** The map has textual route/legend information and respects global reduced-motion/text settings, but focused assistive-technology testing has not been completed.
- **Desired behavior:** All map knowledge and controls are keyboard reachable, focus-visible, screen-reader coherent, scalable, and contrast compliant.
- **Likely subsystem:** Renderer surfaces/styles, accessibility helpers, manual acceptance.
- **Implementation direction:** Add semantic map summaries, focus management, high-contrast checks, and keyboard-only automation/manual evidence.
- **Dependencies:** Stable field/map layout.
- **Priority:** P1 before public scenario completion.
- **Acceptance evidence:** Keyboard-only and screen-reader checklist passes at supported text scales with no information exclusive to SVG position/color.

### GRA-10 — Spatial/content diagnostics

- **Current behavior:** Developer reports and inspection exist, but route resolution, discovery reasons, objective evaluation, and narration inputs are not shown as one trace.
- **Desired behavior:** Local development diagnostics explain which known connection/action matched, guards/effects, time cost, discovery source, and projected observer facts.
- **Likely subsystem:** Developer inspection/console, spatial runtime events, authoring reports.
- **Implementation direction:** Add a developer-only structured turn trace and worldpack coverage report; keep it out of production UI.
- **Dependencies:** GRA-01/GRA-02 event formats.
- **Priority:** P2, but pull forward when content authoring accelerates.
- **Acceptance evidence:** A developer can diagnose a rejected movement or objective transition from one redacted trace without opening a save file.

### GRA-11 — Complete Clear-Q4 scenario content (bounded vertical slice delivered)

- **Delivered behavior:** Clear-Q4 now has an authored briefing, generated team, equipment staging, radio check, field entry, investigation/evidence work, scheduled communication, optional work, independent teammate movement, separation, hazard complication, recovery/mitigation, route verification, physical return/abort, condition-derived debrief, and exact post-restart record.
- **Bounded scope:** The existing topology remains compact and the Level 2 boundary stays legitimately unresolved. Clean, optional-enhanced, recovered, degraded, failed, and controlled-abort classifications use world and mission state rather than scripted prose.
- **Remaining content work:** Later milestones can add alternate authored complications and institutional follow-up without replacing the delivered causal loop.
- **Dependencies:** GRA-01 through GRA-06; GRA-09 before release.
- **Priority:** P0 outcome, delivered incrementally after the underlying systems.
- **Acceptance evidence:** A first-time player can complete, partially complete, abort, or fail the assignment through informed decisions, then resume a changed persistent world.

## Defect root causes repaired in this milestone

| Defect | Root cause | Repair |
|---|---|---|
| LOCAL contradicted nearby team | UI contact category and communication eligibility used separate phase/contact heuristics | One spatial proximity calculation now drives team status, LOCAL targets, equipment observation, and map personnel markers |
| Coworker gear appeared last-known while present | Equipment projection lacked observer/holder locations and canonical personnel status | Equipment verification now derives visual/radio/last-known/missing/abandoned/unknown state from custody plus proximity |
| Delivered Standard message coexisted with unavailable link | Radio authorization, messages, and header state were independent booleans/copy | Persisted radio state machine now owns eligibility and labels; messages require a permitted transmission state |
| Radio check silently left the phase | One action both recorded the check and transitioned to field play | `RADIO_CHECK` records visible YOU/STANDARD envelopes; a separate guarded `BEGIN_FIELD_OPERATION` advances |
| Empty field narration | Generic delta fallback had no structured location observation | Field entry and observation actions use spatial location, landmarks, environment, exits, personnel, and hazards |
| Database prose leaked into observations | Raw look projection aliases were joined as narration | Reusable spatial narration resolves room, landmark, route, direction, person, and transition prose |
| Duplicate objectives | Mission and procedural objective presentations were concatenated without canonical identity | Stable objective IDs and normalized-label deduplication are applied at the projection source |
| Naked check-in zero | `clock.interval` was presented as if it were a due countdown | Persisted `check_in_due_at` and explicit status selector render scheduled/due/overdue/completed/unscheduled |
| Standard send could crash after evidence | Standard's target string was incorrectly resolved as a named coworker before channel branching | Standard and LOCAL targeting are separated; missing local target state is defensive |
| Early field return route was unconfirmed | Spatial field entry did not initialize continuity's return-route state | Field entry now records the known threshold-side return relationship canonically |
| Object descriptions and mission changes could disagree | Legacy `INSPECT`, `RECORD`, and `USE` paths directly changed objectives/evidence without an authoritative authored object condition | One versioned `object_state` now owns condition, knowledge, history, and evidence links; every player projection derives from it |
| Objective completion described button presses rather than world truth | Live objective effects were attached directly to broad verbs and landmark aliases | Worldpack-authored predicates are evaluated after valid observation/evidence/mutation and transitions are deduplicated |
| Recording could create generic or duplicate evidence | Evidence lacked a condition fingerprint tied to a specific authored object | Stable condition-derived evidence IDs, full capture provenance, and redundant-capture rejection now own the lifecycle |
| Equipment use could be implied without physical access | Legacy generic use did not resolve holder proximity for object-specific work | Requirements use canonical custody and location; nearby coworker use must be explicitly authored and never changes holder silently |
| Mission truth existed in competing fields | Expedition objectives, object predicates, time helpers, continuity return state, service terminal code, and renderer assumptions each owned fragments | `mission_state` is the only serialized mission/objective authority; compatibility views and institutional reviews derive from it |
| Objective evaluation could mutate piecemeal | Direct action branches assigned objective states while resolving unrelated effects | Evaluation is side-effect free, converges a full proposal, validates transitions, and commits the batch only after every check passes |
| RETURN meant instant success | The terminal handler finalized from the button decision and advanced directly to debrief | RETURN requests a route-bound procedure; only authored closure conditions at the return point can create a final result |
| Debrief always reflected the terminal verb | Continuity classified RETURN/ABORT without a complete world-state result | Ordered worldpack outcome rules derive clean, optional, degraded, failed, or controlled-abort results with stable institutional hooks |
| Mission UI could reveal implementation state | Flat objective rows depended on legacy IDs and did not distinguish dependencies from operational blockers | Projection removes IDs/predicates, suppresses premature next requirements, selects grounded blocker language, and groups required/optional/update/readiness information |
| Old saves risked objective reset | Unknown objective shapes were initialized from defaults | Explicit legacy maps retain satisfied survey/evidence/check-in/route progress and preserve every adjacent subsystem while advancing save/session versions |

## What can safely wait

Full combat, general autonomous pathfinding, elaborate psychology, large procedural map generation, cinematic media production, large lore-map expansion, network telemetry, and broad content randomization are not needed for the next playable milestone. The highest-priority next slice is the general equipment/custody/container loop: Operational Dynamics provides the damage, drop, recovery, and teammate-held equipment behavior needed for consequences, while comprehensive take/stow/place/container UX remains deliberately deferred.
