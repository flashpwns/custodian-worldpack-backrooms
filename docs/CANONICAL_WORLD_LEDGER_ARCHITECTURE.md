# Canonical World Ledger & Observer Shell Architecture

## 1. Executive Doctrine & Epistemic Hierarchy

**There is exactly ONE complete representation of reality.**
**The Canonical World Ledger is a query and validation interface to this reality, NOT a duplicate or shadow state.**
**Every AI context is a deliberately lossy, observer-specific projection derived from that reality.**

The runtime formalizes this fundamental epistemic distinction:

```text
CANONICAL FACT
    != DIRECT OBSERVATION
    != COMMUNICATED CLAIM
    != OBSERVER BELIEF / KNOWLEDGE RECORD
    != STANDARD RECEIVED CLAIM
    != INSTITUTIONAL ASSESSMENT
    != PLAYER REPORT CLAIM
    != SURFACE PROSE
```

These categories must never collapse merely because they express similar subject matter:
- Being told something does not turn it into canonical truth.
- Standard receiving an ungrounded report does not make the report true in the physical world.
- Surface narrative realize phrasing may vary freely without altering semantic observer knowledge or canonical state.

```text
CANONICAL REALITY (Run / Worldpack State)
    ↓
CANONICAL WORLD LEDGER INTERFACE (Deterministic Causal Provenance & Invariant Gates)
    ↓ (projection filter by observer identity & visibility boundaries)
OBSERVER / KNOWLEDGE PROJECTION (Direct vs Reported Provenance Chains)
    ↓ (purpose-specific boundary filter)
PLAYER INTERPRETER SHELL  or  COWORKER MINI-SHELL  or  STANDARD OPERATOR SHELL
    ↓ (structured semantic proposal validation)
SEMANTIC CLAIM VALIDATION (`validateSemanticClaims`)
    ↓ (secondary regex & metadata defense)
SURFACE PROSE REALIZATION & VALIDATION (`validateLocalDialogue`)
    ↓ (institutional styling & register)
EXPEDITION COCKPIT / PLAYER INTERFACE
```

---

## 2. Reference Expedition Staffing & Identity Invariant

Reference Expedition fixtures (`clear-q4/reference-expedition.json`) adhere strictly to the 4-person staffing model:

```text
TOTAL EXPEDITION PERSONNEL = 4
    ├── 1 Controlled Player: Matthew Murphy (Survey Lead / Field Researcher, contact_category: "SELF")
    └── 3 Autonomous Coworkers:
            ├── Santiago Stokes (Survey Technician, contact_category: "LOCAL")
            ├── Beverly Bell (Documentation Specialist, contact_category: "LOCAL")
            └── Autumn Tucker (Route Specialist, contact_category: "LOCAL")
```

### Identity Invariant:
- `controlled_player_id` must NEVER alias any coworker ID.
- `validateInvariants` mechanically enforces that exactly one roster member matches the player ID, and any coworker aliasing the player ID triggers `PLAYER_COWORKER_IDENTITY_ALIASED` (`status: "FAIL"`).

---

## 3. Reality Ownership Map (26 Authoritative Categories)

| # | Reality Category | Authoritative Owner | Persisted / Ephemeral | Mutated / Derived | AI Visibility | Provenance Reference |
|---|---|---|---|---|---|---|
| 1 | **Player Location** | `run.spatial.player_location` | Persisted | Mutated via `spatialRuntime.move` | Visible in `player-interpreter` | `run.spatial.route_history` |
| 2 | **Coworker Locations** | `run.spatial.personnel_locations[memberId]` | Persisted | Mutated via `teamRuntime` | Co-located observers only | `member.task_history` / move events |
| 3 | **Geography / Topology** | `data/worldpacks/clear-q4/spatial.json` + `run.spatial` | Persisted (discovered) | Authored static + runtime discovery | Only discovered nodes visible | `run.survey_frontier` |
| 4 | **Object Identity** | `data/worldpacks/clear-q4/interactions.json` | Persisted (static) | Static definition catalog | Co-located observers only | Pack definitions |
| 5 | **Object Physical State** | `run.object_state.objects[id]` | Persisted | Mutated via `objectRuntime.interact` | `visible_objects` in scene | `interaction_history` & coordinated outcomes |
| 6 | **Equipment Identity** | `data/worldpacks/clear-q4/logistics.json` | Persisted (static) | Static equipment catalog | Holder or co-located observers | Pack definitions |
| 7 | **Equipment Holder** | `run.expedition.equipment[id].holder` | Persisted | Mutated via `q4Equipment.transfer` | Holder or co-located observers | Transfer event log |
| 8 | **Evidence** | `run.expedition.evidence[]` | Persisted | Appended on capture | Filtered by `evidenceVisibleTo` | `creator`, `operator`, `capturing_observer`, `custodian` |
| 9 | **Measurements** | `run.expedition.evidence` (`measurement`) | Persisted | Captured via instrument use | Filtered by visibility | `method`, `device`, `interval` |
| 10 | **Photographs** | `run.expedition.evidence` (photo type) | Persisted | Captured via camera use | Filtered by visibility | `operator`, `capturing_observer`, `custodian` |
| 11 | **Current Tasks** | `run.expedition.team.members[].task` | Persisted | Mutated via player order | Coworker shell & roster | `member.task_history` |
| 12 | **Simulation Time** | `run.expedition.clock.interval` | Persisted | Mutated via `resolveOperationalCycle` | Clock header | Coordinated interval records |
| 13 | **Local Utterances** | `run.expedition.messages` (`LOCAL`) | Persisted | Appended via `communicationRuntime.local`| Sender & in-range hearers | Message ID, interval, recipients |
| 14 | **Radio Transmissions** | `run.expedition.messages` (`FIELD_RADIO`) | Persisted | Appended via `queueRadio` | Radio holder & Standard | Message ID, queue state, delivery |
| 15 | **Standard Knowledge** | Delivered messages (`recipient === "Standard"`) | Persisted | Mutated on radio delivery / ack | Standard projection only | `received_claims` with unverified/supported status |
| 16 | **Direct Observations**| `member.known_information` (`direct-observation`) | Persisted | Mutated on personal inspection / presence| Observer packet | `is_direct_witness: true`, `target`, `location`, `at` |
| 17 | **Reported Knowledge** | `member.known_information` (`reported-knowledge`)| Persisted | Mutated on hearing speech / radio | Observer packet (reported) | `is_direct_witness: false`, `origin_observer_id`, `via_observer_id` |
| 18 | **Coworker Knowledge** | Each coworker's `known_information` | Persisted | Mutated on coworker action / hearing | Coworker mini-shell only | Source tag & timestamp |
| 19 | **Player Knowledge** | Player `known_information` + player survey | Persisted | Mutated on player action / hearing | Player interpreter shell & UI | Source tag & timestamp |
| 20 | **Route History** | `run.spatial.route_history` | Persisted | Mutated on movement | Trajectory breadcrumbs | `from`, `to`, `at`, `connection_id` |
| 21 | **Return State** | `run.expedition.mission_state.phase === "RETURN"`| Persisted | Mutated on return trigger | Mission status header | Return request authorization |
| 22 | **Facility State** | `run.expedition.mission_state` + `run.spatial.environment`| Persisted | Mutated on operational cycles | Cockpit status panel | Operational cycle sequence |
| 23 | **Threshold State** | `run.spatial.environment` + `phase_locations.THRESHOLD` | Persisted | Mutated on approach / crossing | Visible environment conditions | Crossing event in history |
| 24 | **Report Claims** | `run.expedition.result.report_claims` | Persisted | Authored on report compilation | Debrief screen | Supporting evidence IDs |
| 25 | **Hidden Truth** | Authored worldpack files (`data/worldpacks/clear-q4/`) | Persisted (static) | Never mutated at runtime | **STRUCTURALLY FORBIDDEN / ABSENT** | Worldpack files |
| 26 | **Persistence & Reload**| JSON session files on disk (`desktop/service.js`)| Persisted | Written after canonical action | Restored state | Session version & event log |

---

## 4. Canonical Ledger Boundary (`tools/canonical-world-ledger.js`)

The Canonical World Ledger provides the unified programmatic query, validation, and causal provenance interface over authoritative state:

### Queries & Provenance:
- `getPlayerLocation(run)`: Current location of the controlled player.
- `getCoworkerLocation(run, memberId)`: Authoritative location of any coworker.
- `getPersonnelLocation(run, memberId)`: Authoritative location for any personnel ID.
- `getEquipmentHolder(run, equipmentId)`: The single personnel ID holding the specified equipment.
- `getObjectState(run, objectId)`: Current state and custom properties of an interactable object.
- `getEvidenceProvenance(run, evidenceId)`: Full custody chain (`creator`, `operator`, `capturing_observer`, `custodian`, `captured_at`).
- `getStandardKnowledge(run)`: Received claims delivered to Standard operations desk via radio (`status: "unverified" | "supported"`).
- `getObserverObservations(run, observerId)`: Direct observations personally witnessed by the observer (`source: "direct-observation"`, `is_direct_witness: true`).
- `getObserverReportedKnowledge(run, observerId)`: Facts communicated to the observer (`source: "local-communication"`, `is_direct_witness: false`, preserving origin and via hops).

### Deterministic Causal Provenance:
- `recordCausalTransition(run, transition)`: Records causal transition entries into `run.causal_ledger`. Completely deterministic: stamps operational cycle interval and cause IDs, omitting non-deterministic wall-clock timestamps (`Date.now()`). Default values are strictly `null` (never `undefined`).
- `causal_ledger` is historical audit provenance only; it is NEVER an alternate current-state authority. Current physical and spatial reality is authoritatively governed by `run.spatial`, `run.object_state`, and `run.expedition.equipment`.

### Honest Invariant Verification:
- `validateInvariants(run)`: Returns `{ ok, status: "PASS" | "FAIL" | "UNVERIFIABLE", violations, unverifiable }`.
- If topology cannot be resolved or `spatial_pack_id` is missing, returns `status: "UNVERIFIABLE"` (`ok: false`) rather than silently passing.

---

## 5. Knowledge Provenance Contract & Provenance Chains

Every observer-known factual item has explicit epistemic provenance:

```javascript
// 1. DIRECT OBSERVATION:
{
  kind: "direct-observation",
  source: "direct-observation",
  target: "wall-seam",
  location: "utility-room",
  at: 1,
  observation: "horizontal seam displaced by 4mm",
  is_direct_witness: true
}

// 2. REPORTED KNOWLEDGE (Local Communication):
{
  kind: "reported-knowledge",
  source: "local-communication",
  proposition: "wall-seam displaced by 4mm",
  source_observer_id: "personnel-beverly-bell",
  origin_observer_id: "personnel-santiago-stokes",
  via_observer_id: "personnel-beverly-bell",
  at: 3,
  is_direct_witness: false
}
```

### Transmission Rule:
- When Observer A (Santiago) observes X and tells B (Beverly), and B tells C (Matthew):
  - Santiago has `is_direct_witness: true`.
  - Beverly has `is_direct_witness: false`, `origin_observer_id: Santiago`, `via_observer_id: null`.
  - Matthew has `is_direct_witness: false`, `origin_observer_id: Santiago`, `via_observer_id: Beverly`.
- Receiving communication NEVER upgrades an observer to direct witness.

---

## 6. Structured Semantic Claim Validation (`tools/ai-local-dialogue.js`)

AI dialogue candidates propose structured semantic claims before surface realizations are accepted:

```javascript
{
  version: "yellow-beast-local-dialogue-candidate@v1",
  observer_id: "personnel-santiago-stokes",
  speech: "The survey instrument is secured in my pack.",
  semantic_claims: [
    { type: "equipment-possession", subject: "personnel-santiago-stokes", object: "survey-instrument" }
  ]
}
```

### Fact Classes Checked by `validateSemanticClaims`:
1. `equipment-possession`: Subject must match `getEquipmentHolder(run, object)`. Contradiction returns `SEMANTIC_CLAIM_EQUIPMENT_MISMATCH`.
2. `location`: Subject must match `getPersonnelLocation(run, subject)`. Contradiction returns `SEMANTIC_CLAIM_LOCATION_MISMATCH`.
3. `direct-observation`: Observer must have direct observation provenance or the target must be visible in the live scene. Contradiction returns `SEMANTIC_CLAIM_UNOBSERVED_TARGET`.
4. `reported-claim`: Observer must have reported knowledge provenance matching the proposition. Contradiction returns `SEMANTIC_CLAIM_UNREPORTED_TARGET`.
5. `measurement`: Observer must have verified measurement evidence. Contradiction returns `SEMANTIC_CLAIM_UNVERIFIED_MEASUREMENT`.

Secondary regex checks (`validateDialogueClaims`) remain active as an additional defense-in-depth safety net.

---

## 7. Observer-Safe Handle Doctrine & Negative Constraints

### A. Observer-Safe Handles vs. Hidden Canonical Identifiers:
- **Display Name**: Human-readable label presented in the interface (`"Fluorescent Fixture"`, `"Survey Instrument"`).
- **Observer-Safe Handle**: Stable opaque identifier referring to an entity the observer can actually perceive in their current scene (`"recording-device"`, `"survey-instrument"`).
- **Hidden Canonical Identifier**: Internal identifier encoding hidden semantics or offscreen nodes (`"utility-room-02"`, `"open-passage-corridor-03"`, `"anomaly-origin-node-17"`). These are structurally prohibited from model context envelopes.

### B. Negative Constraints & Zero-Leak Guarantee:
Coworker shells contain `knowledge.negative_constraints`. These MUST be authored as category-level behavioral instructions, NEVER lists of hidden room or object IDs:
- **Forbidden (Leaky)**: `"Santiago does not know about utility-room-02."` (Leaks the existence of `utility-room-02`).
- **Required (Category-Level)**:
  - `"Do not claim knowledge of locations not present in this observer shell."`
  - `"Do not claim possession or perception of equipment held by offscreen personnel without prior communication."`
  - `"Do not access or claim awareness of uncommunicated player thoughts or untransmitted Standard logs."`
  - `"Do not assert unobserved events or offscreen phenomena as direct witness."`

Enforced and verified by `validateNegativeConstraintsNoLeaks(constraints, run)`.

---

## 8. Actual AI Envelope Leak Prevention

Model boundaries are rigorously guarded across runtime routes:
1. **Player Natural Interpretation** (`DesktopService.submitNatural` / `executePlayerTurn`):
   - Provider receives `q4InterpretationContext` containing only visible interactables, co-present personnel, and discovered routes.
   - Hidden geometry, offscreen nodes, causal logs, and raw graph definitions are completely absent from the serialized context.
2. **Coworker Local Dialogue** (`DesktopService.submitQ4Communication` / `buildLocalDialoguePacket`):
   - Provider receives speaker mini-shell containing only the speaker's own location, co-present personnel, and personal `known_information`.
   - Other coworkers' private thoughts, diaries, and uncommunicated knowledge are strictly excluded.
3. **Standard Operator Desk** (`getStandardKnowledge` / `projectObserverState`):
   - Standard context receives only delivered radio transmissions and formally reported evidence. Un-transmitted field observations remain invisible to Standard.

---

## 9. Save / Reload Epistemic Continuity

1. All reality lives in the persisted session file (`run`).
2. Reloading a session reconstructs the exact same Canonical World Ledger.
3. Provenance chains (`origin_observer_id`, `via_observer_id`, `is_direct_witness`) persist across save/reload cycles without degradation.
4. Calling `projectObserverState` on restored state produces deeply equal projections to the pre-save state.
5. Altering presentation narration in the transcript does not alter reconstructed canonical state or observer shells.

---

## 10. Integration Matrix & Test Coverage

- **Y70–Y73**: Natural action interpretation, grounding, and capability planning.
- **Y78–Y79**: Facility operations, threshold transit, and expedition protocol.
- **Y80**: Canonical World Ledger & Observer Shell baseline (20/20 PASS).
- **Y81**: Adversarial Epistemic Hardening & Integrity suite (20/20 PASS).
  1. Player ID cannot accidentally alias coworker ID.
  2. Canonical causal records are deterministic.
  3. Invariant checker cannot silently pass unresolved topology.
  4. Standard receives false player claim without world state becoming true.
  5. Coworker receives false player claim as reported claim, not direct fact.
  6. A observes X, tells B, B tells C; provenance remains distinct.
  7. Unobserved coworker cannot truthfully assert X.
  8. Reported coworker may say "X occurred" without asserting direct witness.
  9. Semantic possession claim contradicting ledger fails.
  10. Valid semantic possession claim succeeds.
  11. Semantic location claim contradicting ledger fails.
  12. Semantic direct-observation claim without observation provenance fails.
  13. Approved semantic claim can be surfaced in multiple wording variants.
  14. Wording variants do not change semantic observer knowledge.
  15. Negative constraints leak zero hidden IDs.
  16. Actual player interpreter provider envelope excludes hidden state.
  17. Actual coworker provider envelope excludes other coworkers' private knowledge.
  18. Causal ledger does not become competing current-state authority.
  19. Modifying cloned ledger query result cannot mutate canonical state.
  20. Save/reload preserves knowledge provenance chains.
