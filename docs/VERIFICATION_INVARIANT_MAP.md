# Verification Invariant Map: Canonical World Ledger & Observer Shell

## Overview

This document records the architectural invariant mapping between the Canonical World Ledger (CWL) specifications and the active verification suites in Yellow Beast, specifically covering:
- Invariants CWL-01 through CWL-20 (reconciling Opus findings with the C03B/C04 architectural foundation)
- Resolution of the 7 key architectural audit questions
- Four-person staffing model invariance

---

## CWL-01 through CWL-20 Invariant Mapping

| Invariant ID | Title & Contract Description | Primary Verification Suite & Test Location | Status |
|---|---|---|---|
| **CWL-01** | **Single Location**: Every person occupies exactly one canonical location. No person can exist in two places simultaneously. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 11), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 1, Test 3) | **VERIFIED** |
| **CWL-02** | **Single Holder**: Each unique equipment item has at most one holder at any point in simulation time. | [`canonical-world-ledger.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tools/canonical-world-ledger.js) (`validateInvariants`), [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 11, Test 13) | **VERIFIED** |
| **CWL-03** | **Holder in Roster**: Any entity holding equipment must be an assigned member of the active personnel roster. | [`canonical-world-ledger.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tools/canonical-world-ledger.js) (`validateInvariants`), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 1, Test 9) | **VERIFIED** |
| **CWL-04** | **Player Projection Excludes Hidden Fields**: Canonical geometry, unvisited nodes, hidden graph data, and random seeds never leak into the player projection. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 3, Test 4), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 15, Test 16) | **VERIFIED** |
| **CWL-05** | **AI Interpreter Scope Excludes Hidden State**: The context supplied to AI providers structurally omits unobserved facts, hidden parameters, and developer fields. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 3), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 16) | **VERIFIED** |
| **CWL-06** | **Deterministic Read-Only Projection**: Computing an observer projection is pure and idempotent; it never alters or mutates canonical world state. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 3), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 19) | **VERIFIED** |
| **CWL-07** | **Separated Coworker Invisible**: Actions or states of separated coworkers in other rooms cannot be seen or known directly by the player. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 4, Test 5), [`y82-reference-expedition-vertical-blockers.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y82-reference-expedition-vertical-blockers.test.js) (Test 2) | **VERIFIED** |
| **CWL-08** | **Observer Isolation**: Cross-observer projections differ according to each observer's exact physical position and local perspective. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 5), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 17) | **VERIFIED** |
| **CWL-09** | **Evidence Provenance**: Evidence records attribute creator, custodian, and capturing observer to valid personnel present at the event. | [`canonical-world-ledger.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tools/canonical-world-ledger.js) (`validateInvariants`), [`y79-clause-completeness-coordinated.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y79-clause-completeness-coordinated.test.js) (Test 1), [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 1) | **VERIFIED** |
| **CWL-10** | **Route Connection Validity**: Route history records contain valid transitions (`from` != `to`) traversing defined, traversable connections. | [`y82-reference-expedition-vertical-blockers.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y82-reference-expedition-vertical-blockers.test.js) (Test 4: CWL-10) | **VERIFIED** |
| **CWL-11** | **No Future Events in Projection**: Observer projections never contain future predictive language or uncommitted events. | [`y82-reference-expedition-vertical-blockers.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y82-reference-expedition-vertical-blockers.test.js) (Test 5: CWL-11) | **VERIFIED** |
| **CWL-12** | **Save/Reload Canonical Identity**: Persistence cycles preserve exact canonical identity, clock intervals, evidence, and observer locations. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 16, Test 17), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 20) | **VERIFIED** |
| **CWL-13** | **Presentation Failure Atomicity**: Canonical execution commits atomically; presentation/narration failure does not roll back committed world effects. | [`y79-clause-completeness-coordinated.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y79-clause-completeness-coordinated.test.js) (Test 22), [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 20) | **VERIFIED** |
| **CWL-14** | **Reports Are Claims, Not Reality**: Field reports and communications are subjective claims and cannot mutate canonical topology or object state. | [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 4), [`y82-reference-expedition-vertical-blockers.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y82-reference-expedition-vertical-blockers.test.js) (Test 6: CWL-14) | **VERIFIED** |
| **CWL-15** | **Authority Contract Bound**: Interpreter scope authority contracts declare interpretation as candidate-only and canonical resolution as Custodian-only. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 3) | **VERIFIED** |
| **CWL-16** | **Interpreter Scope Immutability**: The context objects passed to language providers are deeply frozen and resist runtime tampering. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 3), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 19) | **VERIFIED** |
| **CWL-17** | **Spatial State Invariant Validation**: Spatial state consistently validates against authored topology definitions with zero dangling references. | [`y82-reference-expedition-vertical-blockers.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y82-reference-expedition-vertical-blockers.test.js) (Test 7: CWL-17) | **VERIFIED** |
| **CWL-18** | **Equipment Custody Visibility**: Equipment items are visible only to the holder or observers co-located in the same room. | [`canonical-world-ledger.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tools/canonical-world-ledger.js) (`buildObserverProjection`), [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 11, Test 12) | **VERIFIED** |
| **CWL-19** | **Stale Interpretation Scope Rejection**: Stale digest scopes are rejected upon dispatch if canonical state advanced during provider latency. | [`y79-clause-completeness-coordinated.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y79-clause-completeness-coordinated.test.js) (Test 21) | **VERIFIED** |
| **CWL-20** | **Co-Location Required for Local Interaction**: Teammate dialogue, physical inspection, and handoffs strictly require physical co-location. | [`y80-canonical-ledger-observer-shell.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y80-canonical-ledger-observer-shell.test.js) (Test 8, Test 9), [`y81-canonical-ledger-epistemic-hardening.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y81-canonical-ledger-epistemic-hardening.test.js) (Test 6, Test 7), [`y37-q4-personnel.test.js`](file:///Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit/tests/y37-q4-personnel.test.js) (Test 3, Test 4) | **VERIFIED** |

---

## The 7 Architectural Audit Questions & Resolution Status

### Question 1: Equipment Authority
- **Issue**: Ambiguity regarding whether equipment custody lives on the entity, in inventory, or in a separate authority store.
- **Resolution**: Single canonical authority is established in `run.expedition.equipment[id].holder`. Equipment custody mutations occur strictly through canonical handoff actions (`TRANSFER`) or coordinated execution. Projections derive held equipment dynamically based on `item.holder === observer_id`.

### Question 2: Dual Clocks
- **Issue**: Potential divergence between the simulation engine step clock and the presentation/UI display timestamp.
- **Resolution**: `run.expedition.clock.interval` is the authoritative, discrete, monotonic simulation clock for all causal state transitions and event logging. UI display clocks and transcript timestamps are presentation-layer derivatives that format elapsed interval time into human-readable duration without holding state authority.

### Question 3: Event Identifiers
- **Issue**: Collision risks across multi-turn session event IDs.
- **Resolution**: Event IDs utilize structured deterministic keying (`q4-event-${interval}-${seq}`) combined with monotonic sequence tracking, eliminating duplicate keys across runs and restarts.

### Question 4: Causal Parent Links
- **Issue**: Tracking provenance of multi-clause and coordinated player turn effects.
- **Resolution**: Causal transition entries recorded in the ledger link directly to `cause_action_id` and `cause_attempt_id`. Secondary effects and coworker follow-throughs retain exact source-span attribution linking them back to the original clause.

### Question 5: Projection Completeness & Epistemic Boundaries
- **Issue**: Risk of leaking hidden worldpack metadata, unvisited rooms, or peer knowledge into observer contexts.
- **Resolution**: Validated at both the structural object level and serialized provider envelope level. The projection engine explicitly strips hidden fields (`canonical_geometry`, `future_schedule`, unvisited nodes, internal entity IDs) and enforces negative constraints.

### Question 6: Save/Reload Equivalence
- **Issue**: Whether serializing and deserializing session state mutates or resets observer knowledge chains.
- **Resolution**: Proven invariant in tests `y80` (Tests 16–18) and `y81` (Test 20). Knowledge provenance chains (direct observation vs reported claim), physical positions, and equipment custody round-trip through JSON persistence with 100% semantic and structural equivalence.

### Question 7: Region Regeneration & Procedural Frontiers
- **Issue**: Handling authored reference zones versus dynamic procedural generation.
- **Resolution**: Authored zones (Reference Expedition threshold, utility room, open passage, relay alcove) maintain immutable topological anchors. The survey frontier and procedural expansions operate downstream of the authored baseline without mutating authored coordinates.

---

## Personnel Staffing Model Invariance

The Reference Expedition strictly adheres to a four-person staffing model:
- **1 Controlled Player Observer**: Matthew Murphy (`matthew-murphy`, `contact_category: "SELF"`, `mission_authority: "controlled field authority"`)
- **3 Assigned Coworkers**:
  1. Santiago Stokes (`personnel-santiago-stokes`, `contact_category: "LOCAL"`)
  2. Beverly Bell (`personnel-beverly-bell`, `contact_category: "LOCAL"`)
  3. Autumn Tucker (`personnel-autumn-tucker`, `contact_category: "LOCAL"`)
- **Total Personnel**: Exactly 4.

Identity aliasing between player and coworkers is explicitly forbidden and enforced by `canonicalLedger.validateInvariants` (`PLAYER_COWORKER_IDENTITY_ALIASED`).
