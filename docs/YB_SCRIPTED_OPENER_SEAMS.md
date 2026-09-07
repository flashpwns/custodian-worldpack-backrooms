# Yellow Beast — Scripted Opening Mission Integration Seams

**Document Status**: Authoritative Integration Contract  
**Purpose**: Define the exact architectural and simulation seams for the incoming scripted opening mission (Clear-Q4 Opener) authored by the project owner.  
**Governing Rule**: The opening mission author does not need to reverse-engineer runtime machinery. All state boundaries, hook points, procedural stages, and handoffs to emergent simulation are documented here.

---

## 1. Architectural Boundary Principle

The scripted opening mission operates under the Custodian Simulation Doctrine:
1. **Simulation Owns Reality**: Scripted narrative beats, player decisions, and coworker behaviors are grounded in deterministic state machines.
2. **AI Never Decides Truth**: Any living/AI provider functions purely as an observer-safe presentation compiler. If deterministic code can evaluate a condition, the AI model must not evaluate it.
3. **Observer Integrity**: Coworkers only perceive and recall what they directly witness or receive via communication. No omniscient information leakage occurs between player, team members, and Standard.

---

## 2. Starting State & Personnel Configuration

### 2.1 Default World & Personnel
- **Mode**: `field-researcher` (`clear-q4`).
- **Scenario**: `reference-expedition`.
- **Default Player**:
  - Observer ID: `run.session.startup.player.observer_id`
  - Personnel ID: `q4-player-*` (e.g. Matthew Murphy)
  - Authority: `"controlled field authority"`
- **Assigned Coworkers**:
  - **Santiago Stokes**: Route specialist (`["route-marking", "hazard-assessment", "pacing"]`). Holds initial baseline route records.
  - **Beverly Bell**: Documentation specialist (`["photography", "logging", "sample-collection"]`). Suitable custody recipient for 35mm field camera (`recording-device`).
  - **Autumn Tucker**: Survey technician (`["instrumentation", "measurement", "radio-operation"]`).

### 2.2 Initial Equipment Allocation
- Equipment registry: `run.expedition.equipment`
  - `recording-device` (35mm field camera, model `Argus C3 / Field Spec`, initial holder: `personnel-beverly-bell` or reassignable during STAGING)
  - `survey-instrument` (qualitative optical surveyor, assigned to survey technician)
  - `field-light` (battery field lamp, operational)
  - `field-radio` (Clear-Q4 multichannel transmitter, held by player or assigned specialist)
- Custody mutations occur exclusively via `service.submitQ4Handoff({ world_id, item_id, target })`.

---

## 3. Onboarding & Procedure Phase Pipeline

The opening mission transitions through explicit procedural phases managed by `data/procedures/onboarding-procedures.json` and `tools/q4-phase.js`:

```
[ BRIEFING ]
     │ (Deliberate readiness: "READY", "We're good", "Lets do it")
     ▼
[ STAGING ] ─── (Equipment custody reassignment permitted)
     │ (Deliberate transit confirmation: "PROCEED", "Go ahead")
     ▼
[ FACILITY_TRANSIT ]
     │ (Deliberate approach: "APPROACH", "Move to threshold")
     ▼
[ THRESHOLD ]
     │ (Deliberate ready signal: "READY")
     ▼
[ STANDARD_RADIO_CHECK ]
     │ (Deliberate radio transmission: "Radio check Standard.")
     ▼
[ FIELD_OPERATION ] (Emergent simulation active)
```

### 3.1 Negation & Hesitation Seams
- Semantic commands like `"Not yet"`, `"Wait, I need a second"`, `"Hold on, not ready"`, `"I refuse"` are trapped by `tools/interpretive-director.js` and `desktop/service.js`.
- They return `{ ok: true, result: { executed: false, clarification_required: true } }` and **never** advance the procedure phase.
- Positive aliases admitted: `"ready"`, `"proceed"`, `"we're good"`, `"go ahead"`, `"lets do it"`, `"open it"`, `"send us through"`.

### 3.2 Equipment Check Seam (Staging)
- During `STAGING`, the player can inspect staging tables, reassign equipment (`submitQ4Handoff`), and review manifests.
- If required equipment is missing upon `PROCEED`, an operational deviation (`"proceeded-with-required-equipment-unavailable"`) is recorded in `run.expedition.deviations`.

---

## 4. Threshold Ceremony Seam

The Threshold crossing is an accountable institutional boundary:
1. **Approach & Visual Framing**: Authored chunks in `data/interpretation/authored-chunks.json` frame the airlock threshold: *"Threshold boundary framing: The pressure hatch stands recessed in concrete..."*
2. **Radio Check Requirement**:
   - `STANDARD_RADIO_CHECK` requires explicit player transmission to channel `"standard"` (`submitQ4Communication`).
   - Standard validates signal quality and sets `q4Radio.ensure(run.expedition).check_completed = true`.
3. **Acoustic Transition**:
   - `desktop/service.js` and `tools/acoustic-director.js` apply acoustic scene profiles (`ambient_loop: "facility_ambient"` -> `"complex_sub_bass"`).
4. **Crossing Action**:
   - Action: `CROSS`.
   - Executes `bootstrap.crossThreshold(run, { require_radio_check: true })`.
   - Transitions `entry.phase` to `FIELD_OPERATION`.
   - Places player and team into `run.spatial` at `utility-room`.

---

## 5. Authored Beats & Presentation Event Bus

### 5.1 Event Bus Architecture
- Authority: `tools/presentation-bus.js`.
- All narrative beats, coworker remarks, acoustic cues, and procedural interpretations emit structured events into the bus:
  ```javascript
  presentationBus.emit(run, {
    type: presentationBus.EVENT_TYPES.NARRATIVE_BEAT, // or INTERPRETATION, COWORKER_DIALOGUE, WARNING
    source: presentationBus.SOURCES.AUTHORED,
    speaker: "Santiago Stokes",
    text: "Draft feels colder through this duct than the baseline readings suggested."
  });
  ```
- Events are consumed atomically during desktop renderer polling via `presentationBus.consumePending(run)`.

### 5.2 Dialogue Variants & Local Intent
- When player addresses coworkers in field via `submitQ4Communication({ channel: "local", target: "Santiago", text: "..." })` or `submitQ4LocalIntent`:
  - `tools/communication-routing.js` checks proximity (`run.spatial.personnel_locations`).
  - If coworkers are co-present, dialogue is delivered locally without radio latency.
  - Coworker responses draw strictly from `member.known_information` and current behavioral state.

---

## 6. Emergent Field Simulation Handoff

Once inside `FIELD_OPERATION`, authored rails gracefully yield to the deterministic autonomous simulation engines:

| Engine | File | Responsibility |
|---|---|---|
| **Spatial Runtime** | `tools/spatial-runtime.js` | Topology, room connections, movement traversal, dark zones, route marking. |
| **Logistics Runtime** | `tools/logistics-runtime.js` | Equipment custody, wear, battery state, weight/capacity. |
| **Decision Scheduler** | `tools/decision-scheduler.js` | Coworker autonomous decisions (triggers: `HAZARD_DETECTED`, `EQUIPMENT_ISSUE`, `LOST_CONTACT`, etc.). |
| **Actor Behavioral State** | `tools/decision-scheduler.js` | Deterministic advancement of `fatigue`, `stress`, `attention_focus`, `behavioral_state`, `task_progress`. |
| **Operational Time** | `tools/operational-time.js` | Event scheduling, action intervals, communication delays, check-in deadlines. |
| **Canonical Ledger** | `tools/canonical-world-ledger.js` | Epistemic truth, observer-specific knowledge, standard operator desk knowledge. |
| **Field Notes** | `tools/field-notes.js` | Automatic extraction of causal events into structured operational field notes. |

---

## 7. Persistence & Save Guarantees

- **Save Contract**: `yellow-beast-save@v9` inside desktop session envelope version 7.
- **Transactional Commit**: Every action committed through `DesktopService` commits the world history pair (`commitPersistencePair`) and atomic session snapshot.
- **Cold Boot Continuity**:
  - Full shutdown and reload preserves all `member.known_information`, `member.attention_focus`, `run.expedition.equipment` custody, and `run.expedition.messages`.
  - The scripted opener author can safely rely on multi-session persistence across any game pause or exit.

---

## 8. Opener Author Checklist

- [x] Onboarding procedures accept natural language readiness and hesitation forms.
- [x] Staging supports camera custody handoff to player or coworker.
- [x] Threshold ceremony enforces Standard radio check before physical entry.
- [x] Presentation bus routes all narrative events to the frontend renderer.
- [x] Autonomous decision scheduler ticks automatically after every player field turn.
- [x] Coworkers observe epistemic boundaries: they report only what they witnessed.
- [x] 30-turn continuous regression suite (`tests/y90-expedition-script-30turn.test.js`) verifies the entire pipeline.
