# Yellow Beast — Canonical Authority Matrix

**Governing Constitutional Law**:
> **IF CODE CAN DETERMINE SOMETHING WITHOUT AMBIGUITY, THE AI MODEL MUST NOT DETERMINE IT.**
> Simulation owns reality; AI only performs and narrates canonical state. AI never creates canonical state.

---

## 1. Architectural Boundary Pipeline

The simulation boundary is non-negotiable and strictly one-directional:

```
+-------------------------------------------------------------------------+
| CANONICAL SIMULATION STATE                                              |
| (Custodian Core, Ledger, Geography, Actors, Equipment, Consequence)    |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| OBSERVER-SAFE PROJECTION                                                |
| (Stripped of hidden geometry, unobserved phenomena, raw internal IDs)  |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| SIMULATION DOCTRINE & WORLDPACK LEXICON RULES                           |
| (Strict Kane canon lexicon: "KV31 Threshold Room", "KV31 Outpost", etc) |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| BOUNDED GENERATION TASK                                                 |
| (Structured candidate proposal OR post-resolution scene narration)      |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| CANDIDATE OUTPUT                                                        |
| (Noncanonical structured proposal or candidate prose)                  |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| VALIDATION / DETERMINISTIC FALLBACK                                     |
| (Precondition checks, player agency validator, regex forbidden linter)  |
+-------------------------------------------------------------------------+
                                    │
                                    ▼
+-------------------------------------------------------------------------+
| COMMITTED CANONICAL STATE & PLAYER-FACING PRESENTATION                  |
+-------------------------------------------------------------------------+
```

---

## 2. Comprehensive Subsystem Authority Matrix

| Subsystem / Domain | Code Authority (Deterministic Simulation) | AI Model Scope (Language Assistance / Performance) | Failure / Ambiguity Fallback | Governing Files |
| :--- | :--- | :--- | :--- | :--- |
| **1. World Ontology & Simulation Truth** | Owns 100% of objective reality, event history, timestamps, causality, and world lifecycle. | Zero authority. Cannot create, delete, or alter any world fact. | Deterministic world state persists without model consultation. | `tools/canonical-world-ledger.js`, `tools/world-history.js` |
| **2. Spatial Topology & Geography** | Owns nodes, connections, lock states, coordinates, traversal, and procedural generation seeds. | Zero authority. Cannot hallucinate rooms, doors, or shortcuts. | Player movement is validated against topology definition; invalid targets rejected. | `tools/spatial-runtime.js`, `tools/spatial-pack.js` |
| **3. Personnel Identity & Core State** | Exactly 4 field slots. Owns qualifications, stress, fatigue, health, condition, and assignments. | Performs persona and voice within established emotional and behavioral bounds. | Defaults to deterministic profile and routine behavior state. | `tools/team-runtime.js`, `tools/q4-personnel.js` |
| **4. Coworker Autonomy & Decisions** | Deterministically evaluates 13 triggers (hazards, equipment, lost contact, etc.). | May perform the dialogue for an ambiguous or social response if triggered. | If model fails or is unneeded, coworker executes deterministic routine task. | `tools/decision-scheduler.js`, `tools/team-runtime.js` |
| **5. Natural Command Parsing** | Maps player text to canonical semantic verbs (MOVE, INSPECT, PHOTOGRAPH, etc.). | May map ambiguous natural phrasing to structured candidate proposal. | If ambiguous or model down, falls back to regex parser or asks clarification question. | `tools/capability-planning.js`, `tools/ai-interpreter-boundary.js` |
| **6. Universal Affordances & Preconditions** | Evaluates 14 entity properties (portable, inspectable, openable, etc.) to gate actions. | Proposes noncanonical intents matching visible nouns. | Preconditions fail closed in code; unfulfilled preconditions reject candidate. | `tools/affordance-service.js` |
| **7. Physical Limits & Proximity** | Determines line of sight, speaking range, interaction reach, and containment. | Cannot override physical impossibility (e.g. speaking to separated coworker). | Out-of-range actions fail deterministically in code with clear reason. | `tools/spatial-runtime.js`, `tools/communication-runtime.js` |
| **8. Equipment Custody & State** | Owns item holder, battery charge, durability, operational state, and inventory. | Cannot invent equipment, grant items, or perform unheld item operations. | Code rejects operation if holder !== actor or charges <= 0. | `tools/q4-equipment.js`, `tools/logistics-runtime.js` |
| **9. Radio & Communications** | Evaluates RF propagation, link quality, channel availability, and battery consumption. | Generates conversational flavor for Standard dispatcher or coworker chatter. | Radio check or transmission succeeds/fails purely on deterministic RF state. | `tools/q4-radio.js`, `tools/q4-standard-operator.js` |
| **10. Evidence Archive & Provenance** | Creates immutable evidence IDs, timestamps, operator, custody graph, and camera angle. | Generates textual description of photograph if model is configured. | Fallback text generated from observation metadata; evidence ID is code-owned. | `tools/q4-evidence-authority.js` |
| **11. Consequence Propagation** | Cascades physical events (power loss -> darkness -> sensor disruption -> hazard). | Zero authority. Consequences are calculated deterministically by rules. | Rule engine resolves all effects; unhandled effects log warning without crash. | `tools/consequence-runtime.js` |
| **12. Institutional Work Generation** | Automatically derives missions, reports, and investigations from historical events. | Zero authority over mission requirements or pass criteria. | Generated work follows strict institutional schemas and priority queues. | `tools/institutional-runtime.js` |
| **13. Hidden Phenomena & Anomalies** | Owns ecology, invisible entities, movement patterns, and trigger thresholds. | Receives only observer-safe sensory clues (e.g. "metallic clicking"). | Phenomenon never leaks internal state or true identity to prompt context. | `tools/phenomenon-ecology.js` |
| **14. Environmental Simulation** | Owns temperature, humidity, lighting, air quality, and physical structural decay. | Reads current environment to adjust sensory narration. | Environment conditions deterministically degrade equipment and vision. | `tools/environment-simulation.js` |
| **15. Acoustic Scene Orchestration** | Directs 7 audio buses and 35 conceptual hooks based on location and phase. | Zero authority. Audio triggers are 100% deterministic code events. | Soundscape loops and one-shots transition based on canonical location/events. | `tools/acoustic-director.js` |
| **16. Presentation Event Bus** | Tags all events with exact source (`AUTHORED_CANON`, `DETERMINISTIC`, `AI`, etc.). | Consumes presentation queue; cannot inject unobserved events. | Deduplication engine suppresses repetitive narration deterministically. | `tools/presentation-bus.js` |
| **17. UI Projection Adapters** | Filters raw world state into observer-safe views (team, equipment, map, notes). | Zero authority over UI data binding or renderer state. | Strips raw IDs and hidden locations before data reaches renderer. | `tools/q4-experience.js`, `tools/live-scene-projection.js` |
| **18. Persistence & Transactions** | Enforces atomic commit pairs and transactional rollback on save failure. | Zero authority over persistence, serialization, or disk writes. | On write failure, rolls back in-memory state with 0 drift. | `desktop/service.js`, `tools/canonical-world-ledger.js` |

---

## 3. The 10 Invariants of Delegation

1. **Reality Precedes Narration**: Code resolves and mutates state *before* the presentation provider is invoked.
2. **Narration Cannot Retract Mutation**: If narration generation fails, the committed action remains durable; a deterministic fallback scene is displayed.
3. **No Unobserved Omniscience**: Coworker dialogue and player observations are strictly bounded to their individual knowledge stores and sensory ranges.
4. **No Hallucinated Player Agency**: AI narration cannot invent player speech, unprompted player actions, interior thoughts, or emotional epiphanies.
5. **Canon Vocabulary Supremacy**: Strict Kane Backrooms terminology (`KV31 Threshold Room`, `KV31 Outpost`, `A-Sync`) outranks loose model synonyms.
6. **Prioritized Negation**: Prefield negation (`I am not ready.`, `Not yet.`) unconditionally suppresses procedure advancement regardless of positive keyword presence.
7. **Zero In-Memory Drift**: When a persistence failpoint occurs, the in-memory run and world state immediately revert to their pre-turn snapshots.
8. **Deterministic Opportunity Detection**: Coworker decision opportunities are triggered by simulation events, never by periodic model polling.
9. **Observer ID Anonymization**: Internal entity identifiers (`actor-123`, `node-utility`) are stripped from observer projections to prevent LLM prompt leaks.
10. **Offline Completeness**: Every core gameplay loop (Briefing, Staging, Transit, Threshold, Crossing, Survey, Return, Report) must function 100% with all AI providers disabled.
