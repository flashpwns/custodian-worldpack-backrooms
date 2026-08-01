# Structured Observation and Interaction Acceptance

Status: implemented; final repository validation recorded below

Date: 2026-08-01

Acceptance artifacts: [rendered eight-frame evidence](STRUCTURED_INTERACTION_ACCEPTANCE.html) and [observer-safe/state check record](STRUCTURED_INTERACTION_EVIDENCE.json)

## Accepted player loop

The acceptance runner creates a new Clear-Q4 operator, selects a route-marker kit, completes staging and the visible Standard radio check, and enters the Utility Room. It then uses the same `DesktopService` and renderer projection as the packaged application to:

1. observe at least three authored objects;
2. inspect the fluorescent fixture and reveal condition-specific information;
3. use the assigned survey technician's nearby instrument through an explicitly authored team-use rule;
4. consume one instrument use, tag the fixture, create evidence, and satisfy condition-derived survey/evidence objectives;
5. inspect and mark the scuffed floor;
6. inspect and open the service panel;
7. leave for the Columned Corridor and return;
8. observe all three altered conditions in natural prose;
9. shut the service down, reconstruct it from disk, resume, and compare canonical and observer-safe state exactly.

All ten generated acceptance checks are true. The HTML contains eight renderer frames for initial observation, inspection, available action, successful mutation, evidence/objective change, additional object changes, return observation, and post-restart resume.

## Interaction schema and worldpack boundary

`canon/operational-interaction-schema.json` defines versioned worldpack records for objects, visible and hidden properties, affordances, requirements, tool requirements, state mutations, observation/inspection variants, evidence, hazard hooks, and persistence policy. `tools/object-runtime.js` implements only the generic vocabulary and contains no Clear-Q4 object or location names. Mission predicates were deliberately removed from this schema after Milestone 3 consolidated them in the separate mission worldpack/runtime.

Clear-Q4 content remains in `data/worldpacks/clear-q4/interactions.json`. Registration is declared in `data/worldpacks/registry.json`. Runtime validation rejects duplicate object IDs, unresolved spatial locations, invalid affordances, invalid state paths, and unresolved objective references. A minimal second-pack fixture proves registration without Clear-Q4 assumptions.

The bounded core affordances are `inspect`, `use`, `activate`, `deactivate`, `open`, `close`, `move`, `take`, `place`, `mark`, `photograph`, `record`, `test`, `repair`, `damage`, `secure`, and `release`. A worldpack exposes only the subset it authors. Unsupported actions produce authored or generic in-world failures and never expose verb matching.

## Authoritative state and mutation rules

`run.object_state` is the single persistent authority for each authored object's current location, condition, open/active/intact/marked/moved flags, holder/container, custom state, observer knowledge, interaction history, and evidence links. Location narration, visible affordances, evidence capture, objective predicates, and renderer cards are projections of that state; the renderer stores no simulation condition.

Resolution order is target visibility, ambiguity, authored affordance, knowledge/state prerequisites, spatial proximity, equipment access and condition, deterministic mutation, equipment consumption, operational time, evidence creation, objective evaluation, narration, and persistence. Validation is completed before mutation. Repeated state changes and redundant evidence return grounded failures without consuming equipment, advancing time, or altering state.

Inspection is informational: it may reveal only declared properties and record observer knowledge. It does not silently execute a separate affordance or complete evidence/interaction objectives.

## Clear-Q4 authored slice

- Fluorescent fixture: inspect; test with a nearby teammate-held survey instrument; photograph with the nearby camera; persist the survey tag and tested condition; reject hand movement of the fixed fixture.
- Scuffed floor: inspect the difference between ordinary wear and an authored marker; photograph condition-specific evidence; place a persistent numbered route marker using selected marker supplies.
- Service panel: inspect the latch; open and close it; retain condition-specific open/closed observation; reject repeated open/close actions.
- Threshold return marker: inspect, secure with marker supplies, or photograph/record it; derive optional return-route verification from its actual secured/verified state.

## Mission integration

The generic mission evaluator now consumes object state, known properties, interactions, and evidence through `data/worldpacks/clear-q4/mission.json`. Satisfied state is sticky where authored and each real transition is recorded once with authoritative-condition provenance. The object runtime, renderer, parser, and matching action names do not complete objectives.

The slice proves that inspection can reveal information while evidence and route objectives remain pending, evidence completion requires a valid evidence record, route verification requires actual return-marker state, and repeated actions cannot duplicate progress.

## Equipment integration

Tool requirements resolve against the existing custody, condition, charge, and spatial proximity state. Player-held gear is usable. Teammate-held gear is usable only when the affordance explicitly declares team use and that teammate is active in the same location; the holder never changes implicitly. Missing, separated, damaged, and depleted items block before mutation. Declared consumable use decrements the actual item's charges and appends equipment use history.

The test action deliberately uses the generated survey technician's instrument while it remains in that coworker's custody. The route-marker action uses the player's selected optional kit. Both states persist across restart.

## Evidence lifecycle

Evidence is created only by a declared evidence-producing affordance applied to a specific object condition. Its stable ID is derived from the object, evidence type, and selected condition snapshot. Each record retains source object, source location and public location name, capturing observer, device and method, object condition, operational interval, player/Standard availability, reporting state, storage description, provenance, render job, and validity.

An identical capture is rejected as redundant. Capturing the same object after a relevant condition change creates a distinct stable record. Standard receives evidence availability only through a delivered report that explicitly refers to evidence or its subject. Evidence and render metadata survive movement and restart.

## Persistence and migration

The current run envelope is `yellow-beast-save@v8`; the desktop session envelope is `yellow-beast-session@6`. Loading earlier supported runs/sessions preserves field position, discovery, route history, team, equipment, radio, timer, mission, and map state, then deterministically initializes missing registered state. Existing object-state records are normalized by the versioned object migration.

The integration test and acceptance runner compare object condition, interaction history, evidence, objective state, equipment, current location, map discovery/history, team, radio, and operational clock before shutdown and after full reconstruction.

## Validation record

- Focused playable-spine suite: passed (83/83).
- Focused structured-interaction suite: passed (12 tests).
- Full repository suite: passed, including asset/contract validation, 219 core tests, both focused suites, all deterministic reports, and conformance.
- Desktop build: passed; `dist/desktop-shell-manifest.json` regenerated.
- Playable-spine acceptance: passed (8/8 checks) and the retained artifact was regenerated.
- Structured-interaction acceptance: passed (10/10 checks; eight renderer frames).

## Known limitations and deferred scope

- The generic vocabulary includes custody/container verbs, but a complete take/drop/stow/recover/container loop is Milestone 3.
- Only the compact Utility Room and threshold marker interaction slice is authored; the map is intentionally not expanded.
- The former interaction predicate proof has been replaced by the completed generic mission runtime; see `MISSION_STATE_ACCEPTANCE.md`.
- Hazard hooks are validated and carried by the schema, but active hazard resolution, injury, blocked routes, failure branches, and broad Standard policy belong to later milestones.
- Nearby team use is an explicit authored collaboration, not general autonomous coworker behavior.

## Next milestone

Milestone 4 should consolidate field inventory and custody over the object and mission authorities: take, stow, place, drop, handoff, recover, and container interactions, with truthful proximity, equipment locations, mission degradation, evidence, and exact restart behavior.
