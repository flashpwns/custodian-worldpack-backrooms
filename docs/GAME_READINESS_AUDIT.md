# Yellow Beast / Custodian Game-Readiness Audit

Status: post-Omnipass 7–9 implementation

Audit date: 2026-08-01

Evidence: [Omnipass acceptance](acceptance/OMNIPASS_7_9_ACCEPTANCE.md), [renderer artifact](acceptance/OMNIPASS_7_9_ACCEPTANCE.html), [machine record](acceptance/OMNIPASS_7_9_EVIDENCE.json), and retained prior acceptance records.

## Executive finding

Yellow Beast now contains a complete, condition-driven Clear-Q4 operation and reusable worldpack foundation. A new world receives deterministic generated staffing, an institutional briefing, loadout and container planning, a multi-route field operation, delayed communications, bounded teammate autonomy, two distinct hazard families, atomic consequences and recovery, state-derived return/debrief, persistent Standard review, and a real follow-up assignment. Full shutdown and restart preserve the authoritative record exactly.

The simulation remains structured-first. UI controls and optional AI prose select or describe legal actions; they do not decide mission, world, logistics, hazard, personnel, route, communication, or institutional truth.

Pass 10 is still required for release readiness: replayability tuning, pacing/balance, onboarding refinement, comprehensive accessibility review, final audiovisual/interface polish, performance profiling, installer/update polish, external beta testing, triage, and release documentation.

## Authoritative ownership

- `spatial-runtime.js` owns discovered topology, positions, routes, traversal, proximity, and observer-safe map state.
- `object-runtime.js` owns interactable state, knowledge, affordances, mutations, and object-specific evidence.
- `mission-runtime.js` owns objective/mission lifecycle, atomic condition evaluation, return readiness, and final results.
- `operational-cycle.js` sequences the single clock, scheduled events, communications, teammate decisions, hazards, consequences, logistics synchronization, and mission evaluation.
- `logistics-runtime.js` owns item, custody, capacity, equipment condition, containers, transactional mutations, loadout readiness, and reconciliation. The renderer owns no inventory state.
- `institutional-runtime.js` owns Standard’s confirmed knowledge, uncertainty, decisions, operational dimensions, restrictions, unavailable-person records, history, and follow-up assignments. It consumes only delivered or returned records and never owns hidden field truth.
- `world-history.js` and `DesktopService` own canonical world/session storage and explicit migration orchestration.
- Worldpacks own spatial, interaction, mission, dynamics, logistics, institutional, complete-operation, and deterministic fallback presentation data.

The active save contracts are `yellow-beast-save@v9` inside desktop session envelope version 7. Older supported saves migrate through explicit steps. Unknown versions are rejected rather than reset.

## Capability assessment

| Area | Status | Evidence |
|---|---|---|
| Spatial and objects | Functional | Thirteen purposeful Clear-Q4 locations, fourteen connections, alternate return, persistent object mutations, observer-safe discovery |
| Mission state | Functional | Declarative conditions, dependencies, bounded lifecycle, atomic transitions, return/abort, seven outcome families |
| Operational dynamics | Functional | One clock/event queue, delayed communications, check-ins, generated teams, orders, hazards, atomic consequences, recovery |
| Institutional response | Functional foundation | Provenance-bound knowledge, uncertainty, delayed decisions, nine persistent dimensions, restrictions, staffing/equipment consequences, follow-ups |
| Inventory and containers | Functional | Carry/equip/use/consume/replenish/transfer/store/retrieve/drop/lose/abandon/recover/verify/reconcile; capacity and bounded nesting |
| Loadout | Functional | Required and optional capabilities, holder/container assignment, restrictions, capacity, waiver/degraded deployment rules |
| Player UI | Functional foundation | Scene-first inventory, quick contextual actions plus complete list parity, Standard posture, last-known state, grounded unavailable reasons |
| Worldpack authoring | Functional foundation | Create, validate, preview, trace, and focused test commands; Clear-Q4, minimal pack, and independent fixture proof |
| Clear-Q4 content | Complete operation | Briefing through follow-up, branching investigation, structural/electrical hazards, escalation, recovery, alternate return, evidence and accountability |
| Persistence | Functional | World, mission, institution, staffing, messages, hazards, consequences, items, containers, evidence, routes, outcomes, and histories survive exact restart |
| AI boundary | Functional | Observer-safe presentation packet, entity/fact guard, deterministic fallback; generated wording cannot mutate or invent truth |
| Accessibility | Functional baseline, Pass 10 review pending | Keyboard/list parity, semantic labels, text scaling, reduced motion, responsive layout, non-color status cues |
| Packaging | Functional baseline | Desktop, alpha, Windows zip, offline packaged smoke, and macOS/Windows hosted workflows retained |

## Root defects repaired

1. Standard’s knowledge had been represented mostly by communication/history side effects, without one authority for uncertainty, policy posture, delayed decisions, or cross-mission consequences. The institutional runtime now consumes only admissible records with provenance.
2. Equipment had overlapping catalog, expedition, spatial, and renderer assumptions. Logistics now has one normalized authority; legacy expedition equipment is a derived compatibility facade.
3. Item actions were individually mutable and container semantics were absent. Every logistics operation now validates a cloned transaction and commits all custody, quantity, container, history, mission, and institutional inputs together.
4. Worldpack creation required manual knowledge of separate runtimes. Reusable schemas and one CLI now scaffold, validate cross-references, preview graphs/matrices, trace deterministic simulations, and test packs without Electron.
5. Clear-Q4 was a bounded demonstration. It now has a coherent arc, meaningful branches, a secondary evidence site, communications shadow, equipment cache, alternate route, escalation, reconciliation, institutional consequence, and follow-up.
6. During integrated acceptance, scheduled Standard state was found to resolve against the session’s prior world object while canonical persistence used a newly loaded object. Save orchestration now reconciles the higher institutional revision before binding and saving the canonical world.

## Knowledge and presentation safety

Standard learns only from delivered/acknowledged messages, missed declared expectations, returned evidence, personnel testimony, equipment/container reconciliation, closure records, and prior confirmed records. Failed transmissions, remote injuries, hidden hazards, unreported deviations, private observations, and undiscovered route changes remain unknown. A response may treat a report as uncertain but cannot promote it to hidden truth.

Normal UI projections omit internal IDs, condition paths, hidden locations, private rationale, hazard severity values, and developer truth. The developer snapshot and generated author preview are explicitly developer-only.

## Legacy identity audit

New worldpack content and production presentation contain no fixed Alex or Nora dependency. Generated coworkers use stable seeded IDs and persist permanently. Remaining name occurrences are deliberately isolated:

- `tools/q4-personnel.js` and `tools/q4-equipment.js`: legacy identity/custody compatibility maps used only when historical IDs lack persisted modern identity fields.
- `tests/y52-operational-dynamics.test.js`: the positive migration fixture proves established historical identities are not renamed.
- `tests/y28-q4.test.js`, `tests/y52-operational-dynamics.test.js`, and `tools/operational-dynamics-acceptance.js`: negative fresh-run guards prove generated rosters do not select the legacy pair.
- `tests/y49-playable-spine-map.test.js`, `tests/y50-structured-interactions.test.js`, `tests/y51-mission-state.test.js`, `tests/y53-omnipass.test.js`, and `tools/worldpack-authoring.js`: source/content guards reject fixed-name dependencies in generic runtimes and new worldpacks.
- Documentation occurrences describe this audit boundary only.

No compatibility occurrence is used to staff or narrate a new run.

## Current limitations and Pass 10 boundary

The authored campaign foundation provides one complete operation and one concrete follow-up hook, not an endless campaign generator. Team autonomy stays bounded to operational tasks and known-route decisions. Containers permit one nested level rather than arbitrary recursion. Standard uses declarative response policy, not unconstrained institutional AI. Clear-Q4 supports two substantial hazard families but not combat or broad procedural hazard generation.

Pass 10 should prioritize player-facing tuning and certification over another architecture rewrite: run broad replay sessions, tune action cost/check-in/hazard pacing, refine first-run staging and error recovery, perform full keyboard/controller/screen-reader/contrast review, profile long worlds and renderer surfaces, polish feedback and installers, run external beta, and close release defects.
