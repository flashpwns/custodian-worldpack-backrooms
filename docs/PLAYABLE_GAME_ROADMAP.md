# Roadmap to a Complete Playable Yellow Beast Game

Status: implementation passes 1–9 delivered; Pass 10 remains.

## Delivered foundation

1. Persistent spatial foundation: authoritative worldpack topology, discovery, movement, proximity, map, and exact resume.
2. Structured observation and interaction: persistent objects, observer knowledge, affordances, equipment requirements, mutations, evidence, and contextual controls.
3. Condition-driven mission state: declarative predicates, objective dependencies/lifecycles, atomic transitions, return/abort, outcomes, projection, and migration.
4. Comprehensive logistics: authoritative item/custody/container state, loadout validation, atomic inventory actions, reconciliation, contextual actions, and full-list UI.
5. Time and communications: one operational clock, scheduled queue, delayed/failed/acknowledged messages, Standard delivery, and truthful check-ins.
6. Team simulation: generated teams of three to five, deterministic roles, bounded independent decisions, orders, separation, last-known state, assistance, and persistence.
7. Hazards and consequences: worldpack-authored detection/exposure/mitigation, atomic personnel/equipment/route/time effects, recoverable and irreversible outcomes.
8. Institutional response: observer-bounded Standard knowledge, uncertainty, delayed response decisions, support/scrutiny/resource/staffing/restriction dimensions, cross-mission continuity, and follow-ups.
9. Worldpack authoring and complete Clear-Q4: reusable schemas; create/validate/preview/trace/test CLI; generic fixture; complete branching operation with alternate return, two hazards, escalation, reconciliation, seven outcome families, and institutional follow-up.

Each delivered layer has focused tests and renderer-backed, machine-readable acceptance evidence under `docs/acceptance/`.

## Pass 10 — Final release readiness

Pass 10 is the highest-priority next milestone. It should not change truth ownership unless testing exposes a focused defect.

### Replayability, pacing, and balance

- Run broad seed/path matrices across all seven Clear-Q4 outcome families.
- Tune time costs, check-in windows, radio delays, loadout capacity, hazard precursors, mitigation cost, and Standard response cadence.
- Verify the enhanced/recovered/degraded/abort/failure branches are understandable and neither trivial nor arbitrary.
- Exercise the follow-up assignment with prior scrutiny, equipment restrictions, and unavailable-person staffing state.

### Onboarding and interface polish

- Refine first-world creation, personnel confirmation, briefing, staging/loadout, contextual inventory, mission updates, return reconciliation, and follow-up discovery.
- Improve action grouping, empty/error states, focus restoration, controller order, and small-window behavior.
- Add final audio/visual feedback without allowing presentation to assert unresolved truth.

### Accessibility certification

- Complete keyboard-only and controller-equivalent playthroughs.
- Audit screen-reader labels/order/live regions, zoom/text scaling, contrast, non-color cues, reduced motion, reduced sensory mode, and input timing.
- Verify radial/contextual controls retain full list parity and never require precision pointing.

### Performance and durability

- Profile long operational histories, event queues, institution records, inventory histories, map rendering, and save sizes.
- Stress repeated shutdown/restart, migration fixtures, damaged-save recovery, and deterministic replay.
- Keep developer truth separated from gameplay and make diagnostic export useful for beta reports.

### Distribution and beta

- Polish Windows/macOS installers, update behavior, signing/notarization path, offline first launch, and uninstall/data-retention guidance.
- Run hosted Windows/macOS packaging on the release candidate.
- Conduct external beta testing, triage defects, document known issues, and produce release/user documentation.

## Release gate

The release candidate is ready only when all focused and historical suites, every acceptance, contract/asset/worldpack validation, desktop and alpha builds, packaged offline smoke, and hosted platform checks pass; the accessibility checklist has no critical gap; no in-scope P0/P1 defect remains; and every final debrief/institutional response remains grounded in authoritative state.
