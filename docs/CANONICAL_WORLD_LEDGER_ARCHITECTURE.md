# Canonical World Ledger & Observer Shell Architecture

## 1. Executive Doctrine & Architectural Rule

**There is exactly ONE complete representation of reality.**
**Every AI context is a deliberately lossy, observer-specific projection derived from that reality.**

The model must never receive full world truth merely because the runtime has access to it.

```text
CANONICAL WORLD LEDGER
    ↓ (causal provenance & state mutations)
CAUSAL STATE TRANSITIONS
    ↓ (projection filter by observer identity)
OBSERVER / KNOWLEDGE PROJECTION
    ↓ (purpose-specific boundary filter)
PLAYER INTERPRETER SHELL  or  COWORKER MINI-SHELL
    ↓ (bounded natural language generation)
AI PROPOSAL / PERFORMANCE
    ↓ (mechanic & epistemic validation)
CONSISTENCY VALIDATION
    ↓ (institutional styling & register)
A-SYNC / KANE PRESENTATION
    ↓
EXPEDITION COCKPIT / PLAYER
```

---

## 2. Reality Ownership Map (26 Authoritative Categories)

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
| 15 | **Standard Knowledge** | Delivered messages (`recipient === "Standard"`) | Persisted | Mutated on radio delivery / ack | Standard projection only | `source_message_id`, `world.q4_standard_operator` |
| 16 | **Direct Observations**| `member.known_information` (`direct-observation`) | Persisted | Mutated on personal inspection / presence| Observer packet | `interval_id`, `at`, `target`, `location` |
| 17 | **Reported Knowledge** | `member.known_information` (`local-communication` / `radio`)| Persisted | Mutated on hearing speech / radio | Observer packet (reported) | `message_id`, `sender`, `at` |
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

## 3. Duplicated / Ambiguous Authority Resolutions

1. **Local Communication Target vs Hearers**:
   - *Previous Defect*: `q4Interactions.record` received `targets: recipients.map(...)`, causing the UI chronology to render `YOU → Santiago Stokes` when speaking to the whole room or addressing another teammate.
   - *Authoritative Resolution*: `targets` reflects the intended recipient (`[peer.display_name]` if directly addressed, or `["Local Team"]` if broadcast). The responding coworker is recorded in `response_speaker`.
2. **Speaker vs. Player Scene Projection**:
   - *Previous Defect*: `tools/ai-local-dialogue.js` projected the player's scene when generating prose for coworker responses.
   - *Authoritative Resolution*: Dialogue packets for coworkers project the *speaker's* observer state via `projectObserverState(run, speakerId, "coworker-mini-shell")`.
3. **Hearing vs. Responding**:
   - *Previous Defect*: Every peer in range generated reactions, risking multi-coworker chorus.
   - *Authoritative Resolution*: All in-range peers receive `reported-knowledge` in their canonical `known_information`, but exactly ONE responder is selected based on direct address, equipment custody, task ownership, or role relevance.
4. **Dialogue Claim Validation**:
   - *Previous Defect*: Coworker dialogue candidates were only filtered by negative regex keywords, allowing hallucinations regarding equipment custody or unobserved events.
   - *Authoritative Resolution*: `validateDialogueClaims` validates assertions of equipment custody, physical presence, and direct inspection against the Canonical World Ledger before accepting candidate text.

---

## 4. Canonical Ledger Boundary (`tools/canonical-world-ledger.js`)

The Canonical World Ledger provides the unified programmatic interface for reading reality:

- `getPlayerLocation(run)`: Current location of the controlled player.
- `getCoworkerLocation(run, memberId)`: Authoritative location of any coworker.
- `getEquipmentHolder(run, equipmentId)`: The single personnel ID holding the specified equipment.
- `getObjectState(run, objectId)`: Current state and custom properties of an interactable object.
- `getEvidenceProvenance(run, evidenceId)`: Full custody chain (`creator`, `operator`, `capturing_observer`, `custodian`, `captured_at`).
- `getStandardKnowledge(run)`: Confirmed knowledge delivered to Standard operations desk via radio.
- `getObserverObservations(run, observerId)`: Direct observations personally witnessed by the observer (`source: "direct-observation"`).
- `getObserverReportedKnowledge(run, observerId)`: Facts communicated to the observer (`source: "local-communication"` or `"radio"`).
- `recordCausalTransition(run, transition)`: Records causal provenance linking state transitions to source actions and operational intervals.
- `validateInvariants(run)`: Mechanically verifies the structural invariants of the living world.

---

## 5. Observer Projection Model (`tools/live-scene-projection.js`)

All observer contexts are generated through `projectObserverState(run, observerId, purpose)`:

### A. Player Interpreter Shell (`purpose: "player-interpreter"`)
- Contains only:
  - Known location ID and display name.
  - Visible environment conditions (lighting, acoustic, surface moisture).
  - Visible objects in the player's immediate location.
  - Visible/audible coworkers in the player's location.
  - Player-held equipment and visible interaction affordances.
  - Recent observable events in the player's location.
  - Observer knowledge (direct observations and reported knowledge).
- Structurally excludes:
  - Unvisited nodes in topology graph.
  - Objects in other rooms.
  - Offscreen coworker events.
  - Private Standard logs.
  - Authored internal IDs.

### B. Coworker Mini-Shell (`purpose: "coworker-mini-shell"`)
- Compact observer context:
  - **Identity**: stable ID, full name, role.
  - **Physical**: current location, nearby coworkers, visible objects, held equipment.
  - **Operational**: current assigned task, task history.
  - **Knowledge**: direct observations, reported knowledge, mission records, explicit negative constraints.
  - **Conversation**: recent utterances heard by this coworker.

### C. Standard Operator Shell (`purpose: "standard-operator"`)
- Institutional operations desk context:
  - Confirmed radio transmissions delivered and acknowledged.
  - Reported evidence cataloged by the field team.
  - Mission baseline parameters.
  - Excludes un-transmitted field observations and local team conversation.

---

## 6. Hearing vs. Responding Architecture

Local communication follows a four-stage pipeline:

```text
1. LOCAL UTTERANCE
       ↓
2. DETERMINE ELIGIBLE HEARERS (in-range peers)
       ↓
3. UPDATE HEARD / REPORTED KNOWLEDGE (all hearers receive reported-knowledge in known_information)
       ↓
4. SELECT AUTHORIZED RESPONDER (direct address > equipment holder > task owner > role relevance)
       ↓
5. GENERATE SINGLE RESPONSE (or silence)
```

Hearing does not imply speaking. Silence is valid.

---

## 7. AI Claim Consistency Validation (`tools/ai-local-dialogue.js`)

Candidate coworker dialogue must pass semantic claim validation against the Canonical World Ledger:

1. **Equipment Custody Claims**:
   - Phrases asserting custody ("I have the camera", "my camera", "in my custody") must match `getEquipmentHolder(run, equipmentId) === speakerId`.
   - Contradictions reject with `LOCAL_PRESENTATION_CLAIM_CONTRADICTION`.
2. **Direct Observation Claims**:
   - Phrases asserting direct inspection ("I saw the fixture", "I inspected the mark") require that the speaker either has a matching `direct-observation` in `known_information` or the target is currently visible in their location.
3. **Reported Event Claims**:
   - Referencing past events or outcomes requires either direct observation or prior `reported-knowledge`.
4. **Zero Mutation Guarantee**:
   - Dialogue validation is a pure read-only function that never mutates canonical run state.

---

## 8. Presentation Separation: Canonical Fact vs. Kane Prose

Simulation state records mechanical, objective facts:
```javascript
// Canonical simulation fact:
{ target: "fluorescent-fixture", condition: "photographed", charges: 2 }
```

Approved semantic fact:
```javascript
// Observer-known semantic fact:
{ target: "utility fluorescent fixture", observation: "photographed by Beverly Bell" }
```

A-Sync / Kane surface prose:
```text
// Presentation prose:
"Beverly adjusts the optical focus on the photographic unit and captures the fixture seam."
```

Flavor vocabulary, narrative tone, and atmospheric descriptions belong strictly to the presentation layer and never enter simulation state variables.

---

## 9. Save / Reload Reconstruction

1. All reality lives in the persisted session file (`run`).
2. Reloading a session reconstructs the exact same Canonical World Ledger.
3. Calling `projectObserverState` on restored state produces deeply equal projections to the pre-save state.
4. Altering presentation narration in the transcript does not alter reconstructed canonical state or observer shells.

---

## 10. Integration Surfaces

- **Interpreter**: `tools/ai-interpreter-boundary.js` receives `player-interpreter` shell.
- **Living Turn**: `tools/ai-living-turn.js` resolves atomic coordinated actions and calls `canonicalLedger.recordCausalTransition`.
- **Dialogue**: `tools/ai-local-dialogue.js` projects speaker mini-shell and validates semantic claims.
- **Service**: `desktop/service.js` enforces hearing vs responding and records truthful interaction targets.
- **Renderer**: `desktop/renderer/surfaces.js` renders truthful communication targets and response speakers.
