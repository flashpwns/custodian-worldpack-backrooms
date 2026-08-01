# Roadmap to a Complete Playable Yellow Beast Game

This roadmap turns the readiness audit into ordered deliverables. Work lanes are named explicitly:

- **Framework:** reusable Custodian/runtime contracts and persistence.
- **Simulation:** rules that mutate canonical state and produce consequences.
- **Clear-Q4 content:** worldpack-owned locations, objects, procedures, encounters, and prose.
- **Interface:** player-facing hierarchy, controls, feedback, and accessibility.
- **Authoring tools:** validation, preview, diagnostics, and content-scale support.

Milestones 1 through 3 are delivered. The bounded operational slices of Milestones 5 through 7 were delivered together by Operational Dynamics. Milestone 4 remains the highest-priority next milestone because its general inventory/container work is intentionally broader than the custody, damage, drop, and recovery behavior required by Operational Dynamics.

## 1. Persistent spatial foundation — delivered

- **Player-facing capability:** Enter the Complex, receive a concrete location observation, open a non-omniscient Operational Map, move by visible controls or natural language, keep the team together, and resume the same field state.
- **Engine capability:** Generic worldpack graph, discovery, proximity, movement, team following, equipment-location synchronization, observation, timing, map projection, and save migration.
- **Worldpack capability:** Registered programs plus authored locations/connections/environment/landmarks/layout hints/discovery/locks/hazards/markers.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface.
- **Required tests:** Hidden undiscovered nodes; valid/invalid movement; generic second pack; identity/team/equipment/radio/timer/map persistence; opening integration flow.
- **Completion criteria:** The deterministic acceptance artifact reports all checks true and restart reproduces exact captured field/map facts.
- **Dependencies:** Existing session, world history, personnel, equipment, phase, and desktop storage layers.
- **Risks:** Legacy procedural topology and new authored topology could diverge; migration must remain the compatibility boundary.

## 2. Structured observation and interaction — delivered

- **Player-facing capability:** Inspect and manipulate meaningful fixtures, doors, surfaces, containers, markers, documents, and environmental features; re-observation reflects what changed.
- **Engine capability:** Generic worldpack affordances with preconditions, capability/equipment requirements, time costs, canonical effects, observer knowledge, public failures, and durable interaction events.
- **Worldpack capability:** Clear-Q4 authors stable object IDs, natural synonyms, observation facets, affordances, state variants, and result prose for the current locations.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface, Authoring tools.
- **Required tests:** Preconditions/effects; ambiguous and invalid target responses; raw-ID leak prevention; changed-object observation; route lock change; save/reload; minimal non-Q4 fixture.
- **Completion criteria:** At least three distinct actions in the utility/corridor/passage area alter persistent state and create new informed choices; no action claims success without a mutation or explicit informational result.
- **Dependencies:** Milestone 1 spatial IDs and observation layer.
- **Risks:** Free-form breadth can exceed authored rules; keep natural input as a selector over declared affordances and require explicit clarification when ambiguous.
- **Delivered slice:** Four Clear-Q4 objects demonstrate inspection, testing, photography, marking, opening/closing, securing, recording, knowledge-gated affordances, equipment use, evidence, condition predicates, persistence, and observer-safe re-observation.
- **Acceptance:** The 12-test focused suite and eight-frame restart artifact cover the complete milestone loop while retaining the 83-test playable-spine gate.

## 3. Mission state and condition-driven objectives — delivered

- **Player-facing capability:** Review required and optional work, understand grounded blockers and recent changes, advance objectives through actual field conditions, begin a physical return, close or abort, and receive clean, degraded, failed, optional-enhanced, or controlled-abort debriefs.
- **Engine capability:** One generic runtime validates structured boolean conditions, evaluates authoritative object/evidence/spatial/equipment/personnel/communication/time/mission state without mutation, converges dependencies, atomically commits legal transitions, derives return readiness and outcomes, and projects observer-safe explanations.
- **Worldpack capability:** Clear-Q4 authors intent, objective behavior, dependencies, activation/satisfaction/failure/blocking/waiver conditions, return/completion/abort policies, outcome rules, public language, migrations, and institutional hooks in `mission.json`.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface, Authoring tools.
- **Required tests:** Mission schema and second pack; every condition source; atomicity/idempotence; lifecycle behaviors; knowledge boundaries; Clear-Q4 integration; clean/degraded/failed/aborted/optional outcomes; legacy and restart persistence.
- **Completion criteria:** No production objective or outcome is set by a matching button or verb; RETURN begins rather than completes; the final record survives a full service restart exactly.
- **Dependencies:** Milestones 1–2 and existing equipment, radio, time, and personnel state.
- **Risks:** Public progress can leak hidden facts if authored language is not scoped; projection therefore omits predicate paths, internal references, and unknown personnel details.
- **Delivered slice:** Nine Clear-Q4 objectives cover radio contact, field entry, Utility Room conditions, evidence capture/reporting, route verification, scheduled check-in, accountability, and an optional second record. A minimal second worldpack proves the generic boundary.
- **Acceptance:** The 13-test focused suite and ten-frame renderer-backed artifact cover briefing through post-restart final record while retaining both prior milestone gates.

## 4. Equipment, custody, and inventory

- **Player-facing capability:** Take, stow, use, deplete, transfer, drop, abandon, recover, and inspect equipment; custody and condition remain truthful across distance and contact types.
- **Engine capability:** Canonical holder/container/location model, access predicates, capability checks, depletion/damage, custody events, recovery, and spatial equipment markers.
- **Worldpack capability:** Clear-Q4 defines usable survey tools, containers, consumables, field-placement rules, and mission-required kit.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface.
- **Required tests:** Handoff/drop/recovery; container access; visual/radio/last-known/missing/damaged/abandoned/transferred/unknown projections; separation; continuity review; persistence.
- **Completion criteria:** Equipment state influences available actions and mission outcomes, and every rendered ownership/condition claim is derivable from canonical custody plus observer knowledge.
- **Dependencies:** Milestone 2 affordances.
- **Risks:** Duplicating equipment between run/world/spatial state; world history must remain canonical and projections must remain derived.

## 5. Operational time and communications — operational slice delivered

- **Player-facing capability:** Plan around due times, channel quality, scheduled Standard contact, delayed/intermittent delivery, acknowledgements, and consequences for missed procedure.
- **Engine capability:** Scheduled event queue, radio transitions/delivery semantics, Standard procedure policy, overdue escalation, queued/intermittent messages, and time costs shared across actions.
- **Worldpack capability:** Clear-Q4 declares check-in windows, call signs, authorization rules, expected response templates, silence/dead-zone conditions, and mission-specific reports.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface.
- **Required tests:** All radio states; on-time/due/overdue; delayed/failed delivery; Standard response; reload at each state; no delivered/unavailable contradiction; deterministic scheduling.
- **Completion criteria:** On-time, late, silent, and intermittent paths are visibly coherent and alter mission review or available choices.
- **Dependencies:** Milestone 3 mission criteria and Milestone 4 radio custody.
- **Risks:** Simulated time and wall-clock time must not mix; all operational scheduling remains based on persisted mission intervals.

## 6. Team simulation and relationships — operational slice delivered

- **Player-facing capability:** Give bounded instructions, negotiate equipment/tasks, split or regroup, wait for delayed personnel, and manage radio-only or lost contact.
- **Engine capability:** Event-driven coworker policies for follow/remain/refuse/delay/report; relationship state; independent positions; last-known updates; no omniscient knowledge.
- **Worldpack capability:** Seeded generated coworkers receive roles, competencies, equipment assignments, procedural constraints, and bounded operational policies; established legacy identities remain unchanged during migration.
- **Lanes:** Simulation, Clear-Q4 content, Interface.
- **Required tests:** Split/rejoin; refusal; delayed arrival; missing/lost contact; radio report; follow behavior; LOCAL/map/equipment consistency; persistence and succession.
- **Completion criteria:** At least one mission decision can change team configuration and materially affect access, risk, or outcome while all proximity-dependent UI remains coherent.
- **Dependencies:** Milestones 2–5.
- **Risks:** General NPC AI would create unverifiable behavior; use small authored policies and deterministic state machines before controlled variation.

## 7. Hazards, injury, and consequences — operational slice delivered

- **Player-facing capability:** Identify or miss hazards, choose precautions, spend equipment/time, suffer recoverable setbacks, assist coworkers, abort, or become stranded.
- **Engine capability:** Hazard exposure/resolution, condition/injury states, equipment damage/loss, separation, route changes, consequence propagation, and failure classification.
- **Worldpack capability:** Clear-Q4 adds a small set of legible hazards and consequence branches tied to existing space, not an unrelated combat system.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface.
- **Required tests:** Known/unknown hazard; safe handling; injury; equipment loss; separation; blocked return; authorized abort; missing/death distinction; restart and cross-run scars.
- **Completion criteria:** The vertical slice has safe, compromised, abort, and failure outcomes produced by informed player choices and persistent simulated consequences.
- **Dependencies:** Milestones 2–6.
- **Risks:** Arbitrary punishment destroys agency; consequences must have observable precursors, bounded uncertainty, and clear causal records.

## 8. Institutional response and continuity

- **Player-facing capability:** Receive Standard direction, warnings, authorization, review, follow-up assignments, and consequences based on what was reported and what returned.
- **Engine capability:** Causal closure between field events, institutional knowledge, Beck's Desk operations, review policy, follow-up generation, and world-history continuity.
- **Worldpack capability:** Clear-Q4 defines oversight thresholds, review language, recovery/follow-up hooks, and what Standard legitimately knows.
- **Lanes:** Framework, Simulation, Clear-Q4 content, Interface.
- **Required tests:** Reported versus unreported knowledge; contradictory report handling; late/unsafe conduct; evidence return; personnel/equipment loss; follow-up mission; cross-mode observer boundaries.
- **Completion criteria:** Different field conduct produces distinct legitimate institutional responses and future assignments without leaking hidden facts.
- **Dependencies:** Milestones 4–7.
- **Risks:** Institutional narration can assert truth beyond evidence; every response must cite canonical records or be labeled assessment/report.

## 9. Worldpack authoring and diagnostics

- **Player-facing capability:** Indirect—more reliable content with fewer dead ends, leaks, and contradictory descriptions.
- **Engine capability:** Versioned schemas and migrations for spatial data, objects, affordances, objectives, hazards, NPC policies, schedules, and markers.
- **Worldpack capability:** CLI lint, topology/observer preview, reachability and content-coverage reports, fixture generation, and migration checks.
- **Lanes:** Framework, Authoring tools.
- **Required tests:** Duplicate/dangling IDs; impossible routes/criteria; discovery leaks; missing prose/synonyms; schema compatibility; malformed pack failures; second-pack conformance.
- **Completion criteria:** CI validates a complete pack and produces actionable observer-view snapshots without launching the desktop app.
- **Dependencies:** Stable schemas from Milestones 2–8.
- **Risks:** Waiting too long makes content migration expensive; introduce validation alongside each schema, then consolidate here.

## 10. Complete Clear-Q4 scenario

- **Player-facing capability:** Play a coherent assignment from briefing through investigation, complication, decision, consequence, return/debrief, and changed-world follow-up.
- **Engine capability:** Integrate all prior systems into one causal loop and close every reachable production path.
- **Worldpack capability:** Finish only the topology/content required for the scenario; keep Level 2 and unknown areas unresolved unless gameplay requires them.
- **Lanes:** Clear-Q4 content, Simulation, Interface, Authoring tools; framework changes only for proven gaps.
- **Required tests:** Golden critical path; alternative/partial/abort/failure paths; save at phase and branch boundaries; no placeholder/raw/debug copy; accessibility; long-run continuity; packaged-build smoke.
- **Completion criteria:** A first-time player can make repeated informed choices, achieve or fail a mission for understandable reasons, return to a persistent changed world, and begin a legitimate follow-up.
- **Dependencies:** Milestones 2–9.
- **Risks:** Content may hide architecture gaps; every new exception must be challenged as either generic engine behavior or explicit worldpack data.

## 11. Replayability, accessibility, and release polish

- **Player-facing capability:** Replay bounded variants, use fully accessible controls, understand outcomes, and trust saves and performance over long worlds.
- **Engine capability:** Declared variation slots, seed provenance, deterministic continuation, performance budgets, recovery diagnostics, and release-grade migrations.
- **Worldpack capability:** Curated mission/complication variations and follow-ups that reuse systems without randomizing away authored causality.
- **Lanes:** Framework, Clear-Q4 content, Interface, Authoring tools.
- **Required tests:** Multi-seed bounds; same-seed determinism; keyboard/screen-reader/high-contrast/text-scale acceptance; long-world torture; corrupted-save recovery; packaged Windows/macOS verification.
- **Completion criteria:** Release checklist passes with no P0/P1 defects, supported accessibility paths, reproducible builds, and documented save compatibility.
- **Dependencies:** Complete scenario and authoring validation.
- **Risks:** Cosmetic expansion can obscure unresolved simulation defects; only polish behavior after the causal loop is stable.

## Immediate next slice

Start Milestone 4 over the existing object, mission, and operational runtimes: generalize take, stow, place, drop, handoff, recover, and container behavior around one canonical holder/container/location model. Exercise it with a bounded Clear-Q4 loose-object or equipment-case sequence so custody, depletion, recovery, evidence, mission degradation, and restart behavior remain causally aligned with the already-delivered hazard and team-consequence slice.
