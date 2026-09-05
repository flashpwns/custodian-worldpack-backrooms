# Canonical World Ledger Architecture

> Repository-grounded architectural reconnaissance.
> Branch: `claude/canonical-world-ledger`
> Base: `173edc0` (`reference-expedition/foundation`)
> Date: 2026-09-04

---

## 1. Current Reality Ownership Map

The canonical world is not stored in one object. It is distributed across two
persistence layers (world-file, session-file) and approximately fifteen runtime
modules. The following traces actual code paths, not filenames.

### 1.1 World Identity

| Aspect | Authority | File | Persisted | Observer-safe |
|--------|-----------|------|-----------|---------------|
| World ID / seed | `world.world_id`, `world.seed` | `tools/world-history.js` (`createWorld`) | world file | privileged |
| Run identity | `world.runs[]`, `run.run_id` | `tools/world-history.js` (`beginRun`) | world file | privileged |
| Session | `run.session` | `tools/run-bootstrap.js` | session file | partially (projected) |
| Profile | `run.profile_id` | `tools/run-bootstrap.js` | session file | observer-safe |

### 1.2 Geography / Spatial State

| Aspect | Authority | File | Persisted | Observer-safe |
|--------|-----------|------|-----------|---------------|
| Authored locations | `data/worldpacks/{id}/spatial.json` | on disk | definition file | privileged |
| Generated locations | `run.spatial.generated_locations` | `tools/spatial-runtime.js` | session file | privileged |
| Generated connections | `run.spatial.generated_connections` | `tools/spatial-runtime.js` | session file | privileged |
| Player location | `run.spatial.player_location` | `tools/spatial-runtime.js` | session file | observer-safe |
| Personnel locations | `run.spatial.personnel_locations` | `tools/spatial-runtime.js` | session file | **privileged** (projected by `team-runtime.project()`) |
| Equipment locations | `run.spatial.equipment_locations` | `tools/spatial-runtime.js` | session file | observer-safe |
| Discovered locations | `run.spatial.discovered_locations` | `tools/spatial-runtime.js` | session file | observer-safe |
| Discovered connections | `run.spatial.discovered_connections` | `tools/spatial-runtime.js` | session file | observer-safe |
| Route history | `run.spatial.route_history` | `tools/spatial-runtime.js` | session file | observer-safe |
| Environment state | `run.spatial.environment` | `tools/q4-environment.js` | session file | privileged (projected) |
| Phenomenon connections | `run.spatial.phenomenon_connections` | `tools/spatial-runtime.js` | session file | privileged |
| World regions | `world.regions` | `tools/world-history.js` | world file | privileged |
| Canonical geography snapshot | `spatial-runtime.canonicalSnapshot()` | `tools/spatial-runtime.js` | via world ingestion | privileged |

### 1.3 Personnel State

| Aspect | Authority | File | Persisted | Observer-safe |
|--------|-----------|------|-----------|---------------|
| Team roster | `run.expedition.team.members` | `tools/expedition.js` | session file | projected via `team-runtime.project()` |
| Personnel generation | `q4Personnel.staffQ4()` | `tools/q4-personnel.js` | world file (characters) | privileged |
| Health / condition | `member.health`, `member.condition` | `tools/team-runtime.js` | session file | projected |
| Current task | `member.current_task` | `tools/team-runtime.js` | session file | projected for LOCAL only |
| Known information | `member.known_information` | `tools/team-runtime.js` | session file | **per-observer** |
| Observer knowledge | `team_runtime.observer_knowledge[player]` | `tools/team-runtime.js` | session file | per-observer |
| Personnel continuity | `world.characters`, personality/traits | `tools/q4-personnel-continuity.js` | world file | privileged |
| Movement history | `member.movement_history` | `tools/team-runtime.js` | session file | privileged |

### 1.4 Objects / Equipment

| Aspect | Authority | File | Persisted | Observer-safe |
|--------|-----------|------|-----------|---------------|
| Interactive objects (state) | `run.object_state.objects[id]` | `tools/object-runtime.js` | session file | per-observer knowledge gates |
| Object knowledge | `objectState.knowledge[observer]` | `tools/object-runtime.js` | session file | per-observer |
| Object interaction history | `objectState.interaction_history` | `tools/object-runtime.js` | session file | privileged |
| Expedition equipment | `run.expedition.equipment` | `tools/q4-equipment.js` | session file | observer-safe for held items |
| Logistics (containers) | `run.expedition.logistics` | `tools/logistics-runtime.js` | session file | observer-safe for accessible |
| Equipment sync | `spatialRuntime.syncEquipment()` | `tools/spatial-runtime.js` | transient | N/A |

### 1.5 Simulation Time

| Aspect | Authority | File | Persisted |
|--------|-----------|------|-----------|
| Expedition clock | `run.expedition.clock.interval` | `tools/q4-time.js` | session file |
| Operational events | `run.expedition.clock.timeline` | `tools/operational-time.js` | session file |
| Institutional time | `world.q4_operations.institutional_time` | `tools/institutional-runtime.js` | world file |
| Spatial time | `run.spatial.time` | `tools/spatial-runtime.js` | session file |

### 1.6 Tasks / Mission

| Aspect | Authority | File | Persisted |
|--------|-----------|------|-----------|
| Mission state | `run.expedition.mission_state` | `tools/mission-runtime.js` | session file |
| Objectives | `mission_state.objectives` | `tools/mission-runtime.js` | session file |
| Mission definition | `data/worldpacks/{id}/mission.json` | on disk | definition file |
| Assignment engine | `world.q4_missions` | `tools/q4-assignment-engine.js` | world file |

### 1.7 Communications

| Aspect | Authority | File | Persisted |
|--------|-----------|------|-----------|
| Messages | `run.expedition.messages` | `tools/communication-runtime.js` | session file |
| Check-ins | `run.expedition.communications.check_ins` | `tools/communication-runtime.js` | session file |
| Radio state | `run.expedition.radio` | `tools/q4-radio.js` | session file |

### 1.8 Evidence / Knowledge / Institutional

| Aspect | Authority | File | Persisted |
|--------|-----------|------|-----------|
| Field evidence | `run.expedition.evidence` | `tools/expedition.js` | session file |
| Evidence archive | `world.q4_evidence_archive` | `tools/q4-evidence-authority.js` | world file |
| Survey frontier | `run.survey_frontier` | `tools/survey-frontier.js` | session file |
| Institutional state | `world.institutional_response` | `tools/institutional-runtime.js` | world file |
| Phenomenon ecology | `world.q4_phenomenon_ecology` | `tools/q4-phenomenon-ecology.js` | world file |
| Career state | `world.q4_career_state` | `tools/q4-continuity.js` | world file |
| Report claims | `world.institutional_response.uncertain_claims` | `tools/institutional-runtime.js` | world file |

### 1.9 Hidden Truth

Hidden truth is **not stored in a separate object**. It is structurally encoded
within the canonical state (e.g., `canonical_geometry.current_passage.depth_m`
versus `prior_record.recorded_passage_depth_m`) and **projected away** by
observer-safe projection functions. The system achieves hiddenness through
*absence from projection*, not through a separate "secrets" store.

Developer-only diagnostics expose hidden truth via
`phenomenonEcology.diagnostics(world, { developer: true })` in
`desktop/service.js` (`getDeveloperSnapshot`).

---

## 2. Duplicated / Ambiguous Authority

### 2.1 Geography Duplication

**Risk: `world.regions[id].state` vs `run.spatial`**

The world file stores canonical generated geography in `world.regions`, while
the active session stores the working copy in `run.spatial`. On session
completion, `history.ingestRun()` copies the canonical geography snapshot back
to the world. This is **intentional** (long-lived world vs. ephemeral session)
but creates a window where the two can diverge.

**Mitigation already in place**: `spatialRuntime.canonicalSnapshot()` produces
a versioned snapshot; `world-history.js` validates it on ingestion.

**Risk level**: LOW. The separation is architecturally sound.

### 2.2 Evidence Duplication

**Risk: `run.expedition.evidence` vs `world.q4_evidence_archive`**

Evidence lives in both the session and the world. The session owns
in-progress evidence; `q4-evidence-authority.capture()` copies it to the
world archive. Both are authoritative in their scope.

**Risk level**: LOW. The archive is a superset.

### 2.3 Equipment State Sync

**Risk: `run.expedition.equipment` vs `run.spatial.equipment_locations` vs `run.expedition.logistics`**

Equipment state is maintained in three places:
1. `expedition.equipment` — holder, charges, state
2. `spatial.equipment_locations` — position by location
3. `expedition.logistics` — container/staging model

These are synchronized by `spatialRuntime.syncEquipment()` and
`logisticsRuntime.syncSpatial()`, called explicitly in `run-bootstrap.js`.

**Risk level**: MEDIUM. If sync is missed, equipment can teleport or duplicate.
The sync calls are scattered through `run-bootstrap.js` rather than being an
invariant of state mutation.

### 2.4 Time Authority

**Risk: `run.spatial.time` vs `run.expedition.clock.interval`**

Two clocks exist: `spatial.time` (incremented by `spatial-runtime.move()`) and
`expedition.clock.interval` (incremented by `operational-time.advance()`).
They serve different purposes but are not formally reconciled.

**Risk level**: MEDIUM. A movement that advances spatial time but skips
operational time (or vice versa) could produce inconsistency.

### 2.5 Personnel Knowledge

**Risk: `member.known_information` vs `team_runtime.observer_knowledge` vs `survey_frontier.personnel`**

Observer knowledge is tracked in three places:
1. `member.known_information` — per-member fact list
2. `team_runtime.observer_knowledge[observer][subject]` — player's knowledge of each team member
3. `survey_frontier.personnel[observer].locations` — spatial knowledge

These are **complementary** but there is no unified query.

**Risk level**: MEDIUM. Projection functions must consult all three.

---

## 3. Proposed Canonical World Ledger Boundary

### 3.1 Assessment

The existing architecture **already implements the canonical world ledger
concept** — but under two names:

- **`world`** — the long-lived canonical world file
- **`run`** — the active session containing the current expedition

Together, `world + run` constitute the complete canonical state. The split
is justified: `world` persists across expeditions; `run` is the working
state of the current expedition.

### 3.2 Recommendation

**Do NOT create a new unified object.** The existing split is architecturally
sound and well-established.

Instead, codify the existing convention:

```
CANONICAL WORLD LEDGER = world + run

Every canonical question must resolve to exactly one of:
  world.{path}     — durable cross-expedition truth
  run.{path}       — current expedition truth
  definition.{path} — authored worldpack truth (immutable)
```

### 3.3 Missing: Canonical Query API

There is no single function that answers canonical questions. Code that needs
to answer "Where is Matthew?" must know which sub-object to query:
`run.spatial.personnel_locations[matthew_id]`.

**Proposal**: A thin `canonical-query.js` that provides canonical answers
without exposing internal structure:

```javascript
world.query.personnelLocation(id)  // -> location_id
world.query.equipmentHolder(id)    // -> personnel_id | null
world.query.observerKnows(observer, fact) // -> boolean
```

This is NOT a god-object. It is a read-only query boundary that delegates
to existing modules.

---

## 4. Causal Event Model

### 4.1 What Exists

The repository already has substantial event/history infrastructure:

1. **`world.events`** — Append-only world event log with `id`, `sequence`,
   `type`, `payload`, `authority`, `provenance`
   (managed by `world-history.js:event()`)

2. **`run.expedition.history`** — Per-expedition event log
   (managed by `expedition.js:event()`)

3. **`run.spatial.route_history`** — Movement provenance with `from`, `to`,
   `connection_id`, `at`

4. **`member.movement_history`** — Per-member movement records

5. **`member.decision_history`** — Per-member decision records
   (managed by `team-runtime.js:decide()`)

6. **`objectState.interaction_history`** — Per-object interaction records

7. **`communication.history`** — Message state transitions

### 4.2 Assessment

The system already provides **causal provenance** for:
- ✅ Personnel movement (route_history, movement_history)
- ✅ Object interactions (interaction_history with state_before/state_after)
- ✅ Equipment use (charges, evidence created)
- ✅ Communications (message lifecycle with history)
- ✅ Evidence capture (provenance field)
- ✅ Consequences (consequence-runtime records)
- ✅ Mission objective transitions (mission.objective.transitioned events)

### 4.3 What Is Missing

- **No unified event ID namespace**: Events in `world.events`,
  `expedition.history`, and per-object histories use separate sequences.

- **No causal parent links**: Events do not reference the event(s) that
  caused them. A movement event does not link to the player action that
  triggered it.

- **No replay/reconstruction from events**: Events are append-only records,
  not the source of truth. State is directly mutated, then events are recorded
  as provenance. This is simpler than event sourcing but means events alone
  cannot reconstruct state.

### 4.4 Recommendation

**Do not implement full event sourcing.** The current approach (direct mutation
+ event recording) is pragmatically correct for this system.

**Do add**: A `cause` field to critical events (movement, equipment use,
evidence capture) linking back to the player action or team decision that
triggered them. This enables debugging and contradiction detection without
requiring architectural refactoring.

---

## 5. Observer Knowledge Model

### 5.1 Current Implementation

Observer projection is already implemented across several modules:

| Function | File | Purpose |
|----------|------|---------|
| `spatialRuntime.project()` | `tools/spatial-runtime.js:324` | Map projection — only discovered locations/connections |
| `spatialRuntime.visibleExits()` | `tools/spatial-runtime.js:218` | Available exits from current location |
| `teamRuntime.project()` | `tools/team-runtime.js:169` | Personnel projection — LOCAL vs CONTACT LOST |
| `objectRuntime.projectLocation()` | `tools/object-runtime.js:265` | Visible objects with per-observer knowledge |
| `objectRuntime.knowledgeFor()` | `tools/object-runtime.js:147` | Per-observer object knowledge |
| `live-scene-projection.projectLiveScene()` | `tools/live-scene-projection.js:216` | **Complete** observer-specific scene |
| `ai-interpreter-boundary.buildCustodianScope()` | `tools/ai-interpreter-boundary.js:85` | Action context for AI interpreter |
| `survey-frontier.observe()` | `tools/survey-frontier.js` | Per-observer spatial knowledge |

### 5.2 Assessment

**The observer projection model is already architecturally sophisticated.**
Key properties:

- ✅ `projectLiveScene()` produces observer-specific packets
- ✅ Personnel visibility is gated on co-location
- ✅ Object knowledge tracks `observed`, `inspected`, and per-property reveals
- ✅ Equipment visibility is gated on holder/custody
- ✅ Hidden truth is excluded by structural absence
- ✅ Deep-freeze ensures read-only projections
- ✅ Clone-on-entry prevents mutation during projection

### 5.3 What Is Missing

- **No unified `PROJECT(world, observer, context)` function** that produces
  the complete observer shell. `projectLiveScene()` is close but is
  presentation-oriented, not a general-purpose query.

- **No explicit "unknown remains unknown" enforcement** — absence of
  knowledge is implemented correctly but there are no tests that verify
  a specific observer CANNOT learn something through projection.

- **No cross-observer knowledge comparison** — it is not easy to ask
  "Does Matthew know about object X while Beverly does not?"

---

## 6. Player Interpreter Shell

### 6.1 Current Implementation

`buildCustodianScope()` in `tools/ai-interpreter-boundary.js:85` constructs
the player interpreter shell. It includes:

**Included** (correct):
- ✅ Current phase and lifecycle
- ✅ Observer location (alias only)
- ✅ Visible targets (from `look()`)
- ✅ Local coworkers (label + role, filtered by co-location)
- ✅ Available equipment (filtered by holder + usable state)
- ✅ Available action sinks (typed, with valid targets)
- ✅ Authority contract (`hidden_state: "structurally-absent"`)
- ✅ Coordinated action context (Reference Expedition)

**Excluded** (correct):
- ✅ Unseen geography
- ✅ Offscreen coworker actions
- ✅ Hidden truth
- ✅ Standard-private knowledge
- ✅ Undiscovered objects
- ✅ Future events
- ✅ Secret canonical classifications

### 6.2 Assessment

**The player interpreter shell is well-implemented.** The
`buildCustodianScope()` function already achieves the target described in the
prompt. The scope is deep-frozen and digest-stamped, ensuring stale
interpretations are rejected on dispatch.

---

## 7. Coworker Mini-Shells

### 7.1 Current Implementation

Coworker dialogue context is built in
`tools/ai-local-dialogue.js:buildLocalDialoguePacket()`:

**Currently includes**:
- Speaker identity (name, role, condition)
- Current visible action
- Held equipment
- Shared observation history (from `personnelContinuity`)
- Authorized response intent (acknowledge, ask bounded follow-up, etc.)
- Recent delivered messages in the conversation
- Authority contract (no fact invention, no action invention)

### 7.2 Assessment

The coworker mini-shell is **functional but incomplete** relative to the ideal
described in the prompt:

**Missing**:
- ❌ Coworker's known geography (what routes they've seen)
- ❌ Coworker's known institutional instructions
- ❌ Coworker's remembered events (beyond shared history)
- ❌ Explicit negative constraints ("things this person cannot know")
- ❌ Current location description from coworker's perspective

**These are Gemini-active surfaces** (`ai-local-dialogue.js` is imported by
`desktop/service.js` which Gemini owns). Document rather than edit.

---

## 8. Response-Selection Model

### 8.1 Current Implementation

Response selection occurs in `desktop/service.js:submitQ4CommunicationCanonical`:

1. `communicationRuntime.local()` delivers the message to all local peers
2. `personnelContinuity.react()` computes a reaction for **every** local peer
3. If the player explicitly targeted someone (`peer`), their reaction is selected
4. Otherwise, the first coworker with an authorized reaction is chosen

### 8.2 Assessment

**Hearing and responding are already distinct** — this is correctly implemented.

`communicationRuntime.local()` updates `last_communication` for all local
peers (hearing). Response selection is separate and deterministic.

**Not yet implemented**: Multiple simultaneous responses (e.g., Matthew responds
verbally while Beverly performs a visible action). The system currently selects
ONE speaker.

**This is a Gemini-active surface** (`desktop/service.js`). Document only.

---

## 9. AI Semantic Proposal / Validation Boundary

### 9.1 Current Implementation

The system already implements a sophisticated validation pipeline:

#### Interpretation Validation (`ai-interpreter-boundary.js`)
- Proposal shape validation
- Agency verification (player language must contain the action)
- Reference resolution against observer-safe targets
- Stale-scope rejection (digest comparison)
- Validated candidates tracked via `WeakSet`

#### Presentation Validation (`ai-living-turn.js:validatePresentation`)
- Schema validation
- **FORBIDDEN_METADATA** regex (rejects internal IDs, canonical geometry)
- **FORBIDDEN_INTERNAL_ID** regex (rejects system identifiers)
- **FUTURE_LANGUAGE** regex (rejects predictive statements)
- **CONCLUSION_LANGUAGE** check (rejects unestablished conclusions)
- Number validation (all numbers must appear in the observer packet)
- Protected noun validation (all nouns must appear in the source packet)
- NPC speech validation (speech must match delivered messages)
- NPC action validation (actions must match observable events)
- Player agency check (no invented player speech or actions)
- Proper name validation (all names must be observer-known)
- Private observer knowledge check (no attributing knowledge without message)

#### Dialogue Validation (`ai-local-dialogue.js:validateLocalDialogue`)
- Schema validation
- Invented player speech rejection
- Forbidden metadata check

### 9.2 Assessment

**The AI validation boundary is exceptionally strong.** It implements most of
what the prompt describes as desired.

**Missing**:
- ❌ Machine-checkable semantic claims alongside surface text (the prompt's
  `claims: [{ type: "observed", subject: "door_12", predicate: "moved" }]`
  concept). The current system validates surface text against canonical state
  rather than requiring structured claims.
- ❌ Equipment history validation (e.g., "I left the camera at the junction"
  could be checked against equipment provenance but isn't — it's caught by
  the noun/personnel validation instead)

**Recommendation**: The surface-text validation approach is pragmatically
superior to requiring structured semantic claims from the LLM. The LLM already
returns structured output (JSON schemas via OpenAI Structured Outputs). Adding
a parallel claim structure would increase complexity without proportional gain.

The existing validation catches the **same class of errors** through different
means (regex + source-packet comparison vs. formal claim checking).

---

## 10. Kane / A-Sync Presentation Boundary

### 10.1 Current Implementation

Presentation doctrine is enforced through:

1. **Deterministic fallback** (`fallbackPresentation()` in `ai-living-turn.js`)
   — produces Kane-appropriate institutional language without AI

2. **Provider packet** (`buildProviderPacket()`) — the AI receives only
   observer-safe facts and the `authority_contract` explicitly forbids
   canonical mutation and speech invention

3. **Validation** — `validatePresentation()` rejects output that introduces
   unknown terminology or unobserved facts

4. **Test enforcement** — `FORBIDDEN_METADATA`, `FORBIDDEN_INTERNAL_ID` regex
   patterns prevent system internals from leaking into prose

### 10.2 Assessment

The presentation boundary exists but is implicit rather than a declared layer.
Presentation doctrine lives in:
- `SIMULATION_DOCTRINE.md` (principles)
- `YELLOW_BEAST_RECONSTRUCTION_AUTHORITY.md` (tone)
- Scattered prompt templates in `ai-openai-provider.js`

**Not yet implemented**: A formal terminology authority that maps canonical
classifications to permitted surface language (e.g.,
`structural_discontinuity` → "A narrow discontinuity is visible along the
lower wall seam").

---

## 11. Save / Load Reconstruction Model

### 11.1 Current Implementation

#### Save Path
1. `desktop/service.js` writes `world.json` + `session.json` atomically
2. Write-rename pattern (`.tmp` → final)
3. Backup before overwrite (`.previous-good.tmp`)
4. Persistence pair stamp (cryptographic hash linking world + session)
5. `world-history.js:saveWorld()` serializes the canonical world
6. Session serialized via `run-bootstrap.js`

#### Load Path
1. `desktop/service.js:getWorld()` → `world-history.js:loadWorld()`
2. `migrateWorld()` applies schema migrations
3. **V2 Regions**: Regenerated from `baseline_state` + event mutations
4. **Characters**: Rebuilt from event sequence
5. Session restored via `run-bootstrap.js:normalizeRun()`

### 11.2 Reconstruction Risks

| Risk | Severity | Status |
|------|----------|--------|
| Region state regenerated from events | MEDIUM | By design — deterministic |
| Character state rebuilt from events | MEDIUM | By design — deterministic |
| Object state restored directly | LOW | No regeneration needed |
| Equipment sync required on load | LOW | `normalizeRun()` calls sync |
| AI context divergence after reload | MEDIUM | No integration test exists |
| Phenomenon ecology state preserved | LOW | Direct persistence |

### 11.3 Assessment

**Save/load is architecturally sound.** The persistence pair stamp and atomic
write-rename pattern provide crash recovery. The main risks are:

1. **Logic changes between versions** could cause regenerated regions/characters
   to drift from their pre-save state (migration risk, not a bug)

2. **AI context is not saved** — the LLM's conversation history is lost on
   reload. This is correct (AI context is ephemeral) but means the model
   loses conversational continuity.

3. **No test verifies** that save/reload produces equivalent observer shells.

---

## 12. Invariants

### 12.1 Currently Enforced (Runtime)

| Invariant | Where |
|-----------|-------|
| Spatial state validates against definition | `spatialRuntime.validateState()` |
| Object state validates against definition | `objectRuntime.validateState()` |
| Environment validates against definition | `q4-environment.validateCurrent()` |
| Survey frontier validates | `surveyFrontier.validateCurrent()` |
| Canonical JSON structure assertions | `world-history.js:assertCurrentWorld()` |
| Mission definition validates against spatial/objects | `missionRuntime.validateDefinition()` |
| Logistics definition validates | `logisticsRuntime.validateDefinition()` |
| Institutional definition validates | `institutionalRuntime.validateDefinition()` |
| Run version enforced | `normalizeRun()` |

### 12.2 Currently Enforced (Tests)

| Invariant | Test |
|-----------|------|
| Player projection excludes hidden truth | `y72-live-scene-projection.test.js` |
| Presentation rejects invented player speech | `y73-ai-living-turn.test.js` |
| Presentation rejects unknown personnel | `y73-ai-living-turn.test.js` |
| Presentation rejects undelivered speech | `y73-ai-living-turn.test.js` |
| Presentation rejects future language | `y73-ai-living-turn.test.js` |
| Interpretation cannot mutate canonical state | `y73-ai-living-turn.test.js` |
| Stale interpretation is rejected | `y71-ai-interpreter-boundary.test.js` |
| Unvalidated candidate is rejected | `y71-ai-interpreter-boundary.test.js` |
| Save/load byte stability | `y22-persistence.test.js` |
| Provider failover | `y76-provider-autoselect-fallback.test.js` |

### 12.3 Missing Invariants (Recommended)

| # | Invariant | Priority | Type |
|---|-----------|----------|------|
| 1 | One person cannot occupy two canonical locations | HIGH | runtime + test |
| 2 | One unique equipment item has at most one holder | HIGH | runtime + test |
| 3 | Evidence references existing source | MEDIUM | test |
| 4 | Observer knowledge references valid observation | MEDIUM | test |
| 5 | Standard knowledge has transmission provenance | MEDIUM | test |
| 6 | Coworker observation requires plausible presence | MEDIUM | test |
| 7 | Task actor exists | HIGH | runtime |
| 8 | Movement traverses valid connection | HIGH | runtime (already partial) |
| 9 | Player projection contains no hidden-state fields | HIGH | test |
| 10 | AI shell contains no fields outside observer authority | HIGH | test |
| 11 | Executed action IDs are unique | MEDIUM | runtime |
| 12 | Save/reload preserves canonical identity | HIGH | test |
| 13 | Report claims cannot mutate source reality | HIGH | test |
| 14 | Hearing and responding remain distinct operations | MEDIUM | test |
| 15 | Multiple hearers do not produce multiple replies | MEDIUM | test |
| 16 | Failed presentation does not undo canonical execution | HIGH | test (exists) |
| 17 | Provider retry cannot duplicate action execution | HIGH | test |

---

## 13. Gemini Integration Seams

### 13.1 Files Gemini Actively Owns

```
desktop/service.js
desktop/main.js
desktop/preload.js
desktop/renderer-smoke.js
desktop/renderer/audio.js
desktop/renderer/index.html
desktop/renderer/renderer.js
desktop/renderer/styles.css
desktop/renderer/surfaces.js
desktop/credentials.js
desktop/build-info.js
tools/ai-openai-provider.js
tools/ai-hosted-transport.js
tools/ai-provider-pool.js
tools/ai-interpreter-boundary.js  (shared)
tools/ai-living-provider.js       (shared)
tools/custodian-ai-host-adapter.js
tools/personnel-generation.js
tools/q4-experience.js
tools/q4-beta-report.js
tools/run-bootstrap.js             (shared)
tools/spatial-runtime.js           (shared)
tools/team-runtime.js              (shared)
tools/build-desktop.js
tools/write-build-info.js
data/worldpacks/clear-q4/reference-expedition.json
tests/y73-ai-living-turn.test.js   (shared)
tests/y75-ui-audio-spec-compliance.test.js
tests/y76-provider-autoselect-fallback.test.js
tests/y77-cleanup-adjudication-invariants.test.js
tests/y78-reference-expedition-living-world.test.js
```

### 13.2 Required Integration Points

When Gemini's work merges, these integration points must be verified:

| Seam | Claude Surface | Gemini Surface | Contract |
|------|---------------|----------------|----------|
| Observer projection | New invariant tests | `projectLiveScene`, `buildCustodianScope` | Projection must exclude hidden truth |
| Equipment consistency | New invariant tests | `q4-equipment`, `logistics-runtime` | Single holder per unique item |
| Personnel location | New invariant tests | `team-runtime`, `spatial-runtime` | Single location per person |
| Coworker shell enrichment | Architecture doc | `ai-local-dialogue`, `service.js` | Shell should include known geography |
| Response selection | Architecture doc | `service.js` | Hearing ≠ Responding |
| Presentation validation | New invariant tests | `ai-living-turn.js` | No hidden state leakage |

### 13.3 Recommended Gemini Changes (Do Not Edit Directly)

#### In `tools/ai-local-dialogue.js` (`buildLocalDialoguePacket`)

**Current**: Speaker context includes identity, role, condition, held equipment,
shared history, authorized response.

**Desired**: Add `known_geography` (discovered locations from
`survey_frontier.personnel[speaker_id]`) and `negative_constraints` (explicit
list of topics the speaker cannot legitimately know about).

#### In `desktop/service.js` (`submitQ4CommunicationCanonical`)

**Current**: Selects one speaker from local peers.

**Desired**: Support multiple simultaneous responses (primary speech +
secondary visible action) when `personnelContinuity.react()` returns multiple
authorized reactions with different types.

---

## 14. Sol Audit Questions

1. **Equipment sync invariant**: Should `syncEquipment()` be called as a
   post-condition of every state mutation, or is the current explicit-call
   pattern acceptable?

2. **Dual clock reconciliation**: Should `spatial.time` and
   `expedition.clock.interval` be formally reconciled, or is their current
   independent existence justified?

3. **Event ID namespace**: Should all events (world, expedition, per-object)
   share a single monotonic sequence for cross-referencing?

4. **Causal parent links**: Is the cost of adding `cause` fields to events
   justified by the debugging/provenance benefit?

5. **Projection completeness**: Should `projectLiveScene()` be extended to
   serve as the universal observer query (replacing the need for
   `canonical-query.js`), or should they remain separate?

6. **Save/reload equivalence test**: What is the acceptance criterion for
   "equivalent observer shells" after reload? Byte-identical? Structurally
   equivalent? Semantically equivalent?

7. **Region regeneration stability**: How is cross-version determinism
   guaranteed for `applyMutation` and `rebuildCharacters` when the code
   changes between saves?

---

## 15. Migration / Compatibility Risks

1. **New invariant checks on existing saves**: Adding runtime invariants
   (single-holder, single-location) could reject currently-valid saves that
   violate the invariant due to historical bugs. Must be test-only initially.

2. **Event `cause` field addition**: Adding causal links to events is
   backwards-compatible (new field, defaulting to null).

3. **Canonical query API**: New module, no migration risk.

4. **Invariant tests**: Pure additions, no risk.

---

## 16. Implementation Order

### Phase 1: Invariant Tests (Claude-owned, no collision)

1. Create `tests/y79-canonical-world-ledger-invariants.test.js`
2. Implement the 20 tests specified in the prompt
3. Run against existing fixtures

### Phase 2: Canonical Query Utilities (Claude-owned, new module)

1. Create `tools/canonical-query.js` — read-only query boundary
2. Test independently

### Phase 3: Integration Documentation

1. This architecture document (DONE)
2. Gemini integration seam specifications (DONE)
3. Sol audit questions (DONE)

### Phase 4: Post-Merge Integration

After Gemini's work merges:
1. Verify invariant tests pass against Gemini's changes
2. Implement coworker shell enrichment
3. Implement response selection extensions
4. Add causal event links

---

## Five-Layer Model Mapping

```
LAYER 1: CANONICAL WORLD LEDGER
  world + run + definition files
  Owners: world-history.js, run-bootstrap.js, spatial-runtime.js,
          object-runtime.js, team-runtime.js, expedition.js,
          q4-equipment.js, logistics-runtime.js, mission-runtime.js,
          communication-runtime.js, q4-environment.js,
          q4-phenomenon-ecology.js, institutional-runtime.js

LAYER 2: CAUSAL EVENT / TRANSITION ENGINE
  world.events, expedition.history, route_history, movement_history,
  decision_history, interaction_history, communication.history
  Owners: world-history.js:event(), expedition.js:event(),
          team-runtime.js:decide(), object-runtime.js:interact(),
          communication-runtime.js:transition()

LAYER 3: OBSERVER / KNOWLEDGE PROJECTION
  projectLiveScene(), buildCustodianScope(), teamRuntime.project(),
  spatialRuntime.project(), objectRuntime.projectLocation(),
  surveyFrontier.observe()
  Owners: live-scene-projection.js, ai-interpreter-boundary.js,
          team-runtime.js, spatial-runtime.js, object-runtime.js,
          survey-frontier.js

LAYER 4: AI INTERPRETATION + CHARACTER PERFORMANCE
  interpretPlayerLanguage(), createLivingProvider(),
  createOpenAIProvider(), ai-local-dialogue
  Owners: ai-interpreter-boundary.js, ai-living-provider.js,
          ai-openai-provider.js, ai-local-dialogue.js

LAYER 5: A-SYNC / KANE PRESENTATION
  validatePresentation(), fallbackPresentation(),
  renderer.js, surfaces.js
  Owners: ai-living-turn.js, desktop/renderer/
```

### Turn Execution Flow (Actual)

```
PLAYER INPUT (natural language)
    ↓
buildCustodianScope(run)         [LAYER 3: observer projection]
    ↓
interpreter.interpret(context)    [LAYER 4: AI interpretation]
    ↓
proposalShape() validation        [LAYER 3: boundary check]
    ↓
agencySupported() check           [LAYER 3: agency validation]
    ↓
validateAndResolve()              [LAYER 3: reference resolution]
    ↓
dispatchCandidate(run, candidate) [LAYER 1: canonical execution]
    ↓
buildCustodianScope(run) again    [LAYER 3: stale check]
    ↓
bootstrap.act() or
  bootstrap.resolveCoordinatedAttempts()  [LAYER 1: exactly-once execution]
    ↓
resolveOperationalCycle()         [LAYER 2: events recorded]
    ↓
projectLiveScene(run, observer)   [LAYER 3: all-observer projection]
    ↓
buildProviderPacket()             [LAYER 3→5: presentation context]
    ↓
presentation_provider.present()   [LAYER 4: AI presentation]
    ↓
validatePresentation()            [LAYER 5: validation]
    ↓
fallbackPresentation() if failed  [LAYER 5: deterministic fallback]
    ↓
PLAYER-FACING OUTPUT
```

This matches the prompt's desired turn flow almost exactly. The architecture
is already well-aligned with the five-layer model.
