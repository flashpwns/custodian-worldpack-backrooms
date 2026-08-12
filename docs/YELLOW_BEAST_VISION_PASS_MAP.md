# Yellow Beast Vision Pass Map

**Phase:** Human-ratified vision-centric campaign; V01 complete; V02 active
**Evidence date:** 2026-08-12
**Baseline:** [`YELLOW_BEAST_CURRENT_BASELINE.md`](YELLOW_BEAST_CURRENT_BASELINE.md)
**Status:** Authoritative current implementation campaign; V01 checkpoint approved; V02 authorized; V03 and later remain prohibited pending their dependencies and gates
**Campaign size:** 23 implementation passes

## Campaign doctrine

This campaign orders work by dependency and risk, not by historical pass number or prior completion claims. It targets the complete Gameplay Constitution: a persistent 1990s ASYNC workplace and exploration simulation in which Custodian owns truth, the interpreter presents observer-safe projections, and the world has deterministic institutional life beyond one expedition.

The campaign keeps the repository playable whenever reasonably possible. A temporary adapter, dual-read, or compatibility field must have an owner, removal condition, and named retirement pass when introduced. It may never become an unnamed second canonical authority.

The five state concepts below remain distinct throughout the campaign:

1. **Canonical persistence:** durable history and current canonical world truth.
2. **Crash recovery:** invisible transactional recovery after process or infrastructure failure, with no arbitrary rollback choice.
3. **Session state:** ephemeral runtime and presentation state that may be reconstructed.
4. **Player checkpoint state:** the sanctioned boundary the player may deliberately save or restore.
5. **Metagame reload:** deliberate abandonment of a failed expedition branch and restoration of the sanctioned pre-expedition checkpoint; it is not in-world time travel.

## Dependency spine

`authority` → `verification truth` → `persistence and ownership trust` → `knowledge boundaries` → `canonical time` → `deterministic scheduling` → `continuous world` → `personnel/career/institution` → `ASYNC/onboarding` → `expedition loop` → `content breadth` → `long-horizon succession` → `presentation` → `portable release`

Neighboring presentation work may proceed only when it does not claim or mutate unsettled canonical ownership. No continuous, offline, personnel, or multi-career expansion may bypass the persistence gates.

## Planned human checkpoints

| Pass | Campaign boundary requiring human ratification |
|---|---|
| V01 | Authority amendments and constitutional cleanup |
| V05 | Reconciliation and foundation trust |
| V11 | Deterministic living-world kernel |
| V13 | Personnel, career, and institutional simulation |
| V15 | ASYNC and onboarding experience |
| V17 | Expedition gameplay loop |
| V19 | Long-horizon offline and multi-career persistence |
| V23 | Release-candidate integration and certification |

Checkpoint approval authorizes only the next approved campaign segment. A failed checkpoint returns work to the lowest owning authority; it does not authorize a renderer-side workaround.

## Model strategy

GPT-5.6 Sol is reserved for constitutional work, canonical persistence and ownership, scheduler architecture, cross-system integration, adversarial audit, and release certification. Luna is appropriate once ownership contracts are settled and a pass is mechanically bounded. Reasoning recommendations are pass-specific below and may be increased if repository evidence uncovers wider coupling.

---

## V01 — Authority Amendments and Constitutional Cleanup

**TYPE:** FOUNDATION
**PLANNED CHECKPOINT:** **YES.** This is a planned human checkpoint and the legal gate for all implementation.

**WHY THIS EXISTS:** Before V01, the ratified same-world career, checkpoint reload, and offline-progression decisions directly conflicted with Doctrine or Charter language. V01 reconciles that split before any runtime implementation.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A world that survives an employee's death, sanctioned pre-expedition reload, new careers in the same history, and deterministic elapsed-time institutional progression.

**WHAT SYSTEM IT CHANGES:** Product authority documents and their precedence/amendment record only; it defines lifecycle, time, persistence, checkpoint, and observer-boundary ownership.

**WHAT IT MUST NOT BREAK:** Custodian canonical authority, observer integrity, deterministic causality, generated-text non-authority, historical entity identity, or existing save readability.

**DEPENDENCIES:** Phase 01C human ratification.

**IMPLEMENTATION SCOPE:** Deliberately amend or supersede Doctrine §§2.9 and 19.13–19.17/Laws XL–XLI and conflicting Charter rules; codify the five-state distinction above; define bounded deterministic wall-clock eligibility; protect gameplay opportunities from systematic offline consumption; record exact supersessions and terminology.

**OUT OF SCOPE:** Runtime changes, save migrations, scheduler implementation, provider repair, canon admission, UI, or content.

**ACCEPTANCE CRITERIA:** No active authority simultaneously requires world retirement and same-world succession; elapsed time is an explicit bounded exception, not an implied wall-clock mutation; checkpoint abandonment is distinguished from canonical continuation; each amendment has human-ratified text and a traceable change record.

**AUTOMATED VALIDATION:** Authority/registry and contract-reference tests pass; document link and contradiction scans pass; no runtime or schema diff is introduced.

**NATIVE / MANUAL VALIDATION:** Owner performs line-by-line ratification of the amendment and confirms the five state concepts and offline opportunity guardrail. Desktop behavior is expected to remain unchanged.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt to find silent reinterpretation, ambiguous rollback authority, nondeterministic wall-clock permission, or weakened observer boundaries.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** None immediately; it removes the constitutional trap that would otherwise invalidate later player-facing work.

**EXIT GATE:** Human ratifies one internally consistent authority set; repository behavior is unchanged; V02 may then establish executable truth.

---

## V02 — Test Truth and Verification Gate

**TYPE:** REPAIR
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** `npm test` covers only 69 of 101 discovered test files, known long-world equivalence fails, and the report tool exits successfully while reporting failure.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Future improvements can be trusted not to silently destroy launchability, saves, controls, or canonical behavior.

**WHAT SYSTEM IT CHANGES:** Test discovery, suite manifests, failure exit semantics, test taxonomy, packaged/native verification reporting, and CI-facing commands.

**WHAT IT MUST NOT BREAK:** Existing unit tests, packaged verification, native first-run verification, offline operation, or distinction between automated and human evidence.

**DEPENDENCIES:** V01.

**IMPLEMENTATION SCOPE:** Inventory every test; explicitly include, quarantine with reason/owner/expiry, or retire each; make report failure produce failure status; define fast/aggregate/long-world/native/manual tiers; preserve known defects as failing or quarantined evidence until fixed.

**OUT OF SCOPE:** Fixing persistence, simulation, provider, or UX defects exposed by the tests.

**ACCEPTANCE CRITERIA:** Discovered inventory equals included plus explicitly quarantined/retired inventory; no test is silently omitted; machine exit status matches report status; baseline commands report known failures honestly; verification types are not collapsed into “tests passing.”

**AUTOMATED VALIDATION:** Meta-tests compare filesystem inventory to manifests; intentionally failing fixtures verify nonzero exits; aggregate and long-world commands run in CI-compatible mode.

**NATIVE / MANUAL VALIDATION:** Run packaged verification and native first-run create/reopen once to confirm the new harness reports them distinctly.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must try to find omitted tests, swallowed failures, environment-dependent passes, and claims unsupported by command exit status.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Mostly invisible foundation work; fewer regressions reach the player.

**EXIT GATE:** Every test has explicit status and ownership, failure semantics are trustworthy, and persistence repair can use a reliable gate.

---

## V03 — Canonical Persistence Normalization and Transaction Separation

**TYPE:** ARCHITECTURE / REPAIR
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** First-load migration/default insertion changes canonical equivalence, while `persistSession` conflates history, projections, snapshots, indices, and migration work.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A world that reloads as the same world and can later support long careers, offline advancement, and crash recovery without unexplained state drift.

**WHAT SYSTEM IT CHANGES:** World history, snapshot/replay, migration normalization, save transaction boundaries, projection rebuilds, manifest/version ownership, and equivalence tooling.

**WHAT IT MUST NOT BREAK:** Append-only event history, hash-chain integrity, deterministic action resolution, historical save compatibility, retirement markers, or packaged create/reopen.

**DEPENDENCIES:** V02.

**IMPLEMENTATION SCOPE:** Define canonical versus derived fields; make migration/default normalization idempotent and versioned; separate canonical commit from rebuildable projections and session persistence; establish exact canonical equivalence and crash-safe transaction tests.

**OUT OF SCOPE:** Personnel domain repair beyond preservation tests, player checkpoint UX, offline scheduling, and new gameplay.

**ACCEPTANCE CRITERIA:** Load→save→load without accepted canonical action is equivalence-preserving after one explicit migration; repeated normalization is a no-op; projections can rebuild from canonical authority; interrupted writes recover to an auditable valid boundary; migrations never masquerade as gameplay history.

**AUTOMATED VALIDATION:** Long-world equivalence, repeated migration, legacy fixture, interrupted-transaction, hash-chain, projection-rebuild, and packaged reopen tests all report truthful exits.

**NATIVE / MANUAL VALIDATION:** Create, close, reopen, migrate a copied legacy profile, and inspect history/manifest through the packaged artifact; never mutate the reference fixture.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt to prove dual authority, non-idempotent defaults, partial-write exposure, or false equivalence.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Mostly invisible, but saves stop changing merely because they were opened.

**EXIT GATE:** Canonical equivalence and migration idempotence pass at long-world scale; ownership of every persisted artifact is documented before personnel repair.

---

## V04 — Personnel Ownership and Replay Repair

**TYPE:** REPAIR
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Canonical personnel condition events survive in history but the condition disappears after reload, proving critical state loss at projection/replay ownership.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Coworkers and employees retain injuries, condition, competencies, relationships, assignments, memories, and career consequences across sessions.

**WHAT SYSTEM IT CHANGES:** Personnel event schemas, reducers/rebuilders, roster projections, snapshot contracts, condition lifecycle, and validation fixtures.

**WHAT IT MUST NOT BREAK:** Canonical personnel identity, event history, observer-safe personnel files, existing injury/death semantics, or migration idempotence.

**DEPENDENCIES:** V03.

**IMPLEMENTATION SCOPE:** Assign one canonical owner per personnel attribute; replay all admitted personnel events; validate snapshot/rebuild parity; migrate existing saves without inventing unknowable state; add history-to-roster invariants.

**OUT OF SCOPE:** New deep personnel AI, promotion systems, relationships expansion, multi-career succession, and facility autonomy.

**ACCEPTANCE CRITERIA:** Every canonical personnel attribute round-trips through close/reopen and projection rebuild; condition-change repro retains `minor injury`; missing legacy data is explicitly unknown/defaulted by ratified migration rules, never fabricated as remembered history.

**AUTOMATED VALIDATION:** Per-attribute round trips, event replay, snapshot parity, legacy migration, multi-person roster, injury/death, and long-world personnel invariants.

**NATIVE / MANUAL VALIDATION:** Cause a condition change in a disposable native profile, close/reopen, and verify both canonical inspection and observer-safe UI agree.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt to find attributes written by one subsystem and reconstructed by another, lost events, or presentation state posing as canonical personnel truth.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Personnel consequences finally persist, making coworkers and injuries credible beyond one session.

**EXIT GATE:** Personnel canonical ownership is singular and all current attributes survive rebuild/reload before adding deeper personnel behavior.

---

## V05 — Lifecycle, Backup, Checkpoint, and Recovery Semantics

**TYPE:** ARCHITECTURE / REPAIR
**PLANNED CHECKPOINT:** **YES.** This is the planned reconciliation/foundation-trust checkpoint.

**WHY THIS EXISTS:** Backup restoration can revive a retired world; current persistence paths do not cleanly separate career/world lifecycle, player checkpoint, crash recovery, session state, and canonical persistence.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Predictable death choices, legitimate facility-boundary saves, safe process recovery, and no accidental resurrection or arbitrary expedition rollback.

**WHAT SYSTEM IT CHANGES:** World/career lifecycle state machine, backup validation, checkpoint manifests, recovery journal, save/load commands, profile selection, and native shell integration.

**WHAT IT MUST NOT BREAK:** Canonical history, sanctioned boundaries, historical save readability, V03 equivalence, V04 personnel state, or the ability to recover from a genuine interrupted transaction.

**DEPENDENCIES:** V01, V02, V03, V04.

**IMPLEMENTATION SCOPE:** Implement explicit world and career states; validate restored backups against authoritative retirement/succession policy; define facility/pre-entry/return checkpoint creation; distinguish crash resume from player reload; make failed-branch abandonment explicit and auditable; prevent ordinary mid-expedition player load.

**OUT OF SCOPE:** Full new-career UI, offline progression, deep personnel consequences, or scheduler behavior.

**ACCEPTANCE CRITERIA:** Retired or terminal states cannot be bypassed through backup restore except through an explicitly sanctioned transition; checkpoint reload abandons the branch without in-world time-travel claims; crash recovery offers no arbitrary rollback; save controls exist only at ratified boundaries; each artifact declares its state category.

**AUTOMATED VALIDATION:** Lifecycle transition matrix, malicious/stale backup, fatal-action restore repro, checkpoint-boundary, branch-abandonment, crash-journal, session-reconstruction, and legacy-profile tests.

**NATIVE / MANUAL VALIDATION:** Exercise facility save, pre-entry checkpoint, fatal expedition, sanctioned reload, career termination, backup restore, hard process interruption, and reopen in the packaged app.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt resurrection, arbitrary rollback, checkpoint duplication, crash-recovery abuse, and canonical/session-state confusion.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Save and death behavior becomes coherent even before the full succession presentation exists.

**EXIT GATE:** Human accepts the foundation-trust evidence: truthful verification, canonical equivalence, persistent personnel, and enforceable lifecycle boundaries. No dependent living-world expansion begins without approval.

---

## V06 — Provider Knowledge-Boundary Repair

**TYPE:** REPAIR / ARCHITECTURE
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Provider context includes internal authority text and hostile clarification output can expose internal names such as “Still Life” without an in-world naming event.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Interpreter prose, clarification, NPC speech, records, and UI use only terminology the relevant observer or institution has legitimately learned.

**WHAT SYSTEM IT CHANGES:** Observer-safe projections, provider task envelopes, context minimization, terminology entitlement, output validators, fallbacks, evidence/knowledge records, and provider telemetry.

**WHAT IT MUST NOT BREAK:** Provider non-authority, deterministic canonical action resolution, offline fallback, task-specific generated prose, or internal identity available to Custodian for coherent behavior.

**DEPENDENCIES:** V05.

**IMPLEMENTATION SCOPE:** Replace broad internal-document prompts with minimal task projections; attach observer and terminology entitlements; validate all output fields including clarification labels; reject/quarantine/fallback on leakage; centralize institutional knowledge ownership.

**OUT OF SCOPE:** Admitting disputed phenomenon canon, changing canonical entity behavior, continuous simulation, or content expansion.

**ACCEPTANCE CRITERIA:** Providers never receive unrestricted world state or unnecessary internal nomenclature; adversarial outputs cannot surface unauthorized names in any player/institution-facing channel; identical canonical requests remain semantically deterministic after fallback; every projection records audience and basis.

**AUTOMATED VALIDATION:** Hostile-provider suites across narration, clarification, NPC, evidence, and UI labels; prompt payload snapshots; terminology entitlement matrices; offline/failure/time-out fallback tests.

**NATIVE / MANUAL VALIDATION:** Use a provider test account and offline mode against an unknown phenomenon; inspect visible text and captured sanitized task envelope without exposing secrets.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must try prompt injection, internal-name echoing, cross-observer leakage, evidence overclaim, and fallback divergence.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Unknown things remain genuinely unknown; interpretation feels grounded in what ASYNC and the employee actually know.

**EXIT GATE:** Every provider-facing path consumes an observer-safe bounded projection and every player-facing path enforces terminology entitlement.

---

## V07 — Phenomenon Canon Admission and Behavior Reconciliation

**TYPE:** FOUNDATION / CONTENT AUTHORITY
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Still Life and Bacteria behavior spans code, ordinary production reachability, fixture-dominant demonstrations, and incomplete admitted primary authority. Code presence is not canon proof, and source gaps are not deletion authority.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Phenomena whose behavior is surprising and dangerous without being mislabeled, falsely attributed, or built on unexamined developer assumption.

**WHAT SYSTEM IT CHANGES:** Source registry/admission records, phenomenon capability provenance, production-reachability classification, terminology policy, and content implementation briefs.

**WHAT IT MUST NOT BREAK:** Existing canonical histories, generic encounter terminology, internal entity identity, observer boundaries, or currently admitted source authority.

**DEPENDENCIES:** V01 and V06.

**IMPLEMENTATION SCOPE:** For each disputed behavior record: implemented in code, ordinarily reachable, supported by admitted primary authority, or supported only by intent/extrapolation; obtain human rulings where source admission cannot decide; specify retain/disable/reframe/replace without erasing historical evidence.

**OUT OF SCOPE:** Implementing new behavior, balancing encounters, rewriting ecology, or broad content expansion.

**ACCEPTANCE CRITERIA:** Every Still Life/Bacteria capability has A/B/C/D evidence and a disposition; no code or Constitution claim is labeled Kane-canonical without admitted primary support; unresolved behavior is gated rather than silently promoted or deleted.

**AUTOMATED VALIDATION:** Registry/schema integrity, source-reference resolution, capability-to-authority coverage, production-reachability fixtures, and terminology policy tests.

**NATIVE / MANUAL VALIDATION:** Human authority review of the admission packet and representative generic/learned terminology in production gameplay.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must challenge provenance, ordinary reachability, fixture bias, and any inferred primary-source claim.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Mostly future-facing; it prevents contradictory or falsely authoritative phenomenon behavior from reaching expansion.

**EXIT GATE:** Human-ratified capability registry exists and later content passes have an unambiguous authority envelope.

---

## V08 — Canonical Ownership Consolidation

**TYPE:** ARCHITECTURE
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Action routing, phase, resource views, institutional knowledge, personnel projections, and persistence duties are duplicated across service, renderer, tools, and derived files.

**WHAT PLAYER EXPERIENCE IT ENABLES:** One coherent game state regardless of screen, reload path, provider availability, or which UI control initiated an action.

**WHAT SYSTEM IT CHANGES:** Custodian command boundary, reducers, query/projection APIs, renderer state consumption, worldpack interfaces, service orchestration, and compatibility adapters.

**WHAT IT MUST NOT BREAK:** Proven deterministic resolver semantics, action grammar, current playable route, observer-safe projections, saves, or offline operation.

**DEPENDENCIES:** V05, V06, V07.

**IMPLEMENTATION SCOPE:** Produce and execute an ownership table; preserve algorithms that pass invariants while moving authority to one owner; turn renderer/service duplicates into adapters or queries; give every adapter a removal pass; retire obsolete parallel paths after equivalence proof.

**OUT OF SCOPE:** Canonical time/scheduler implementation, large UI redesign, new personnel depth, or content breadth.

**ACCEPTANCE CRITERIA:** Every canonical datum and transition has exactly one writer/owner; derived projections cannot write back as truth; action initiation paths converge on one contract; temporary dual-read/write has explicit sunset and parity telemetry.

**AUTOMATED VALIDATION:** Ownership lint/invariant tests, route equivalence, renderer no-write tests, save compatibility, projection rebuild, and adapter sunset assertions.

**NATIVE / MANUAL VALIDATION:** Run the same representative action through every exposed native initiation surface and compare canonical events and observer-safe output.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must search for hidden writers, renderer authority, stale projection repair, and permanent compatibility scaffolding.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Limited immediate change; inconsistent panels and divergent action paths are removed at their cause.

**EXIT GATE:** Signed ownership matrix, singular canonical command path, and no unnamed compatibility authority remain before introducing time.

---

## V09 — Canonical Time Model

**TYPE:** ARCHITECTURE
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Standard chronology, real elapsed absence, Complex nonlinear time, session time, deadlines, and causal event ordering need explicit relationships before scheduling can be deterministic.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A 1991 institution that ages while the player is absent, expeditions whose Complex duration can diverge radically, and records that explain when consequences occurred.

**WHAT SYSTEM IT CHANGES:** Canonical clocks, timestamps, elapsed-time eligibility ledger, Complex/Standard mappings, pause policy, save metadata, and observer-facing time projections.

**WHAT IT MUST NOT BREAK:** V01 wall-clock bounds, determinism, historical timestamps, current turn order, player opportunity protection, or save equivalence.

**DEPENDENCIES:** V08.

**IMPLEMENTATION SCOPE:** Define clock domains and conversion boundaries; record monotonic elapsed eligibility without letting the wall clock directly mutate state; model uncertain/nonlinear Complex time; version and migrate time metadata; specify caps and anomaly handling.

**OUT OF SCOPE:** Selecting or resolving scheduled events, personnel behaviors, facility schedules, and full offline simulation.

**ACCEPTANCE CRITERIA:** Equal canonical state, seed, and elapsed eligibility yield equal time inputs; clock rollback/forward and timezone changes cannot corrupt chronology; Complex time never silently overwrites Standard time; every event has deterministic ordering and clock provenance.

**AUTOMATED VALIDATION:** Clock-domain property tests, timezone/DST/rollback/large-gap cases, migration idempotence, save/reload, ordering collision, and nonlinear expedition fixtures.

**NATIVE / MANUAL VALIDATION:** Advance a disposable profile across closure/reopen and manipulated system-time edge cases; verify the UI reports uncertainty rather than false precision.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt nondeterminism through wall-clock reads, timezone changes, clock rollback, overflow, and ambiguous clock ownership.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Time records become coherent; most benefit is an enabling foundation.

**EXIT GATE:** Clock domains, eligibility, ordering, migration, and observer projection are deterministic and ratified before scheduler code can resolve events.

---

## V10 — Deterministic Scheduler Kernel

**TYPE:** ARCHITECTURE
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Continuous simulation requires Custodian-owned event eligibility and resolution, not random timers or UI loops mutating canonical state.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Coworkers, expeditions, deadlines, and environmental changes can occur independently while remaining reproducible and auditable.

**WHAT SYSTEM IT CHANGES:** Scheduler queue/agenda, deterministic seeds, tie-breaking, event eligibility, command/event transactions, budgets, deferral, and replay diagnostics.

**WHAT IT MUST NOT BREAK:** Player action determinism, canonical ownership, append-only history, time-domain rules, crash safety, or opportunity-protection policy.

**DEPENDENCIES:** V09.

**IMPLEMENTATION SCOPE:** Build a pure deterministic scheduling kernel; define stable ordering, seeded resolution, event budgets, idempotent catch-up batches, conflict arbitration, and auditable reasons; expose commands without attaching full gameplay systems yet.

**OUT OF SCOPE:** Rich personnel/facility content, real-time UI animation, offline career outcomes, and broad phenomenon scheduling.

**ACCEPTANCE CRITERIA:** Same state/seed/eligibility produces byte-equivalent canonical event sequences; batch size and process restart do not alter outcomes; no host timer writes canonical state; conflicts resolve by documented stable rules; opportunity-requiring events can be reserved/deferred.

**AUTOMATED VALIDATION:** Property/fuzz tests for replay, batch partition, restart, tie-breaking, budget exhaustion, deferral, conflict, hash-chain, and long-world performance.

**NATIVE / MANUAL VALIDATION:** Developer diagnostic view or logs demonstrate why representative events became eligible, deferred, and resolved; no player-facing polish required.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must try to produce nondeterminism via insertion order, concurrency, process restart, batching, timer cadence, and seed consumption.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Mostly invisible kernel work; it makes a trustworthy living world possible.

**EXIT GATE:** Scheduler determinism survives adversarial long-world and restart testing and cannot bypass the canonical command boundary.

---

## V11 — Continuous Runtime and Concurrent Intent

**TYPE:** ARCHITECTURE / GAMEPLAY
**PLANNED CHECKPOINT:** **YES.** This is the planned deterministic living-world-kernel checkpoint.

**WHY THIS EXISTS:** The current world advances principally when the player submits accepted actions; the vision requires surroundings to continue without converting UI timers into authority.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Pausing, observing, acting under ongoing conditions, concurrent NPC/environmental intent, and deterministic catch-up after absence.

**WHAT SYSTEM IT CHANGES:** Runtime simulation pump, pause/resume, intent collection, scheduler integration, turn/action transaction boundaries, session restoration, and observer update stream.

**WHAT IT MUST NOT BREAK:** ACTION remains a primary player verb; no ordinary mid-expedition save/load; UI is observer only; scheduler replay; crash recovery; provider non-authority.

**DEPENDENCIES:** V10.

**IMPLEMENTATION SCOPE:** Advance eligible canonical slices under Custodian; combine player, NPC, institution, and environment intents under deterministic arbitration; define pause/idle semantics and backpressure; update projections after commit; preserve a playable compatibility route with a named retirement point.

**OUT OF SCOPE:** Deep NPC personalities, full facility simulation, broad content, audio, and final cockpit redesign.

**ACCEPTANCE CRITERIA:** Meaningful canonical events can resolve without a player ACTION; pause prevents eligible progression as ratified; unpause/catch-up is deterministic; concurrent intent never depends on render frame/provider timing; the player can still inspect and act coherently.

**AUTOMATED VALIDATION:** Continuous/paused/idle sequences, concurrent-intent ordering, frame-rate independence, provider latency, restart/catch-up equivalence, and long-run performance.

**NATIVE / MANUAL VALIDATION:** Human plays, waits, pauses, resumes, disconnects/reopens, and submits actions while events develop; inspect that changes are understandable and controls remain responsive.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt frame/timer authority, race conditions, pause leaks, action starvation, and gameplay-opportunity consumption.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The world visibly stops waiting for button presses and begins to feel inhabited while remaining deterministic.

**EXIT GATE:** Human ratifies the living-world kernel after deterministic replay, pause, concurrent-intent, performance, and native play evidence.

---

## V12 — Deep Personnel Simulation

**TYPE:** GAMEPLAY / ARCHITECTURE
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Persistent personnel currently have narrow/scaffolded behavior; the workplace promise requires canonical competencies, condition, memory, relationships, assignments, intent, and consequences.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Coworkers remember events, develop, suffer, collaborate, disagree, disappear, and act for reasons rooted in their own history and knowledge.

**WHAT SYSTEM IT CHANGES:** Personnel aggregates, memory/knowledge provenance, competencies, relationships, condition and injury, assignment/intent scheduling, career records, and observer-safe personnel projections.

**WHAT IT MUST NOT BREAK:** V04 persistence ownership, individual observer boundaries, deterministic scheduler, entity identity, historical records, or provider non-authority.

**DEPENDENCIES:** V11.

**IMPLEMENTATION SCOPE:** Add bounded canonical personnel attributes and event reducers; schedule needs/intents and relationship consequences; distinguish fact, belief, memory, rumor, and institutional record; expose explainable personnel-file projections.

**OUT OF SCOPE:** Promotions/discipline/funding policy, full ASYNC navigation, onboarding, multi-career succession, and prose as decision authority.

**ACCEPTANCE CRITERIA:** Personnel decisions derive from canonical state and observer-limited knowledge; attributes persist/replay; two personnel may legitimately hold different beliefs; injuries and assignments affect capability; generated dialogue cannot create memories or relationships.

**AUTOMATED VALIDATION:** Longitudinal personnel fixtures, knowledge divergence, relationship/competency/condition reducers, scheduler replay, save/reload, provider-failure parity, and long-world invariants.

**NATIVE / MANUAL VALIDATION:** Observe a small team across multiple shifts/expeditions and reopen; verify files, behavior, and dialogue remain causally consistent without revealing internal state.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must falsify memory provenance, observer isolation, persistence, scheduler determinism, and the boundary between prose and canonical decision.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Coworkers become persistent people rather than temporary roster rows and scripted responders.

**EXIT GATE:** Personnel state and behavior are persistent, deterministic, observer-safe, and deep enough to support institutional careers.

---

## V13 — Career and Institutional Progression

**TYPE:** GAMEPLAY / ARCHITECTURE
**PLANNED CHECKPOINT:** **YES.** This is the planned personnel/career-simulation checkpoint.

**WHY THIS EXISTS:** The vision requires jobs, evaluations, promotions, discipline, staffing, management, policy, funding, and consequences across employee careers in one world.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Performance matters after return; careers rise or end; ASYNC changes leadership and policy; former employees remain part of institutional history.

**WHAT SYSTEM IT CHANGES:** Career state machine, evaluation, HR/legal records, roles/competencies, staffing, management, policy/funding decisions, institutional event scheduler, and history projections.

**WHAT IT MUST NOT BREAK:** World-versus-career lifecycle separation, personnel identity/history, knowledge boundaries, checkpoint semantics, deterministic scheduling, or player-opportunity guardrails.

**DEPENDENCIES:** V12.

**IMPLEMENTATION SCOPE:** Implement career entry/active/leave/missing/deceased/terminated states; deterministic evaluation and advancement; institutional changes with causal records; historical former-personnel representation; hooks for later succession UI.

**OUT OF SCOPE:** Full facility navigation, final onboarding presentation, complete multi-career selection, long-horizon offline tuning, and broad expedition content.

**ACCEPTANCE CRITERIA:** Career outcomes follow recorded causes; former employees remain addressable historical entities; institutional changes persist and affect future eligible decisions; player absence does not systematically consume signature opportunities; no policy prose directly mutates truth.

**AUTOMATED VALIDATION:** Multi-career lifecycle fixtures, evaluation/promotion/discipline, staffing/management/funding events, opportunity reservation, replay/reload, and long-world institutional invariants.

**NATIVE / MANUAL VALIDATION:** Play several short career arcs in disposable profiles and inspect evaluations, files, history, and institutional changes for legibility and fairness.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt identity reuse, causeless outcomes, history erasure, opportunity theft, lifecycle bypass, and institutional omniscience.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The player now has a consequential job and coworkers with careers inside an institution that changes.

**EXIT GATE:** Human ratifies personnel depth, career causality, institutional change, former-employee continuity, and opportunity protection.

---

## V14 — ASYNC Facility Simulation and Intermission

**TYPE:** GAMEPLAY
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** ASYNC is currently closer to staged phase surfaces than a freely navigable workplace with schedules, services, people, and inter-expedition decisions.

**WHAT PLAYER EXPERIENCE IT ENABLES:** The player can move through ASYNC, review files, meet coworkers, request equipment, train, handle career matters, and prepare without clicking a linear phase ladder.

**WHAT SYSTEM IT CHANGES:** Standard-side facility geography, access/adjacency, schedules, services, room occupancy, interaction commands, facility event scheduling, and navigation projections.

**WHAT IT MUST NOT BREAK:** Standard/Complex separation, canonical time, personnel schedules, save boundaries within ASYNC, keyboard/accessibility contracts, or existing briefing/loadout functionality.

**DEPENDENCIES:** V13.

**IMPLEMENTATION SCOPE:** Create a compact but systemic ASYNC facility; support player-directed navigation and interactions; connect personnel schedules, briefings, legal/HR, equipment, training, records, staging, and return/debrief to canonical services.

**OUT OF SCOPE:** Final first-run cinematic treatment, complete visual art polish, broad facility content, expedition cockpit, and audio integration.

**ACCEPTANCE CRITERIA:** Required activities are reachable through geography and player choice rather than scripted phase buttons; room/service state is canonical; personnel presence follows schedules; saving works only at sanctioned facility boundaries; critical path remains discoverable.

**AUTOMATED VALIDATION:** Facility graph reachability, access rules, schedule/occupancy replay, service commands, save-boundary enforcement, focus/keyboard, and no-dead-end critical-path tests.

**NATIVE / MANUAL VALIDATION:** Navigate the whole facility by mouse and keyboard, complete a pre/post-expedition intermission, close/reopen, and verify spatial and temporal continuity.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must look for disguised phase buttons, teleport-only progression, facility UI authority, inaccessible services, and schedule incoherence.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** ASYNC becomes a workplace the player inhabits between expeditions.

**EXIT GATE:** A complete facility intermission can be played nonlinearly with canonical navigation, schedules, services, and sanctioned saves.

---

## V15 — First Five Minutes and Employee Onboarding

**TYPE:** UI/UX / GAMEPLAY
**PLANNED CHECKPOINT:** **YES.** This is the planned ASYNC/onboarding-experience checkpoint.

**WHY THIS EXISTS:** Native first-run creation works, but the intended semi-interactive employee introduction, hiring/legal context, training/promotion presentation, and returning-player skip flow do not yet form the product opening.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A new player understands they are an ASYNC employee in 1991 before facing the Complex; a returning player can start a new employee in the same world without replaying every presentation.

**WHAT SYSTEM IT CHANGES:** First-run flow, employee creation, career-start commands, onboarding state, legal/training/promotional presentation, skip entitlement, accessibility, and facility handoff.

**WHAT IT MUST NOT BREAK:** Native profile creation/reopen, same-world historical continuity, new-world 1991 start, observer-safe information, ASYNC navigation, or explicit career identity.

**DEPENDENCIES:** V14.

**IMPLEMENTATION SCOPE:** Build the semi-interactive introduction through employee creation, hiring/legal material, training/promotional context, first briefing, personnel-file orientation, and facility control handoff; implement appropriate returning-player skip without skipping canonical career initialization.

**OUT OF SCOPE:** Expedition cockpit, broad content, final audio mix, release polish, and automated resolution of later careers.

**ACCEPTANCE CRITERIA:** First-time and returning flows both create valid careers; the player can explain role, risks, controls, and next action; skipping presentation never skips canonical initialization; the flow is resumable only at sanctioned boundaries and accessible without a mouse.

**AUTOMATED VALIDATION:** New-world/returning-career/skip/resume state machines, profile reopen, year initialization, focus/keyboard/scaling, content entitlement, and malformed-profile recovery.

**NATIVE / MANUAL VALIDATION:** Fresh-profile usability sessions with first-time and returning participants; packaged Windows test for keyboard, scaling, readability, skip, close/reopen, and time-to-independent-control.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt to get lost, skip required canonical creation, receive forbidden knowledge, or encounter a linear phase façade after handoff.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The game acquires a comprehensible, atmospheric opening and a credible workplace identity.

**EXIT GATE:** Human ratifies the first-five-minutes experience and freely navigable ASYNC handoff for both first and later careers.

---

## V16 — Expedition Cockpit and Core ACTION Experience

**TYPE:** UI/UX / GAMEPLAY
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** The existing deterministic ACTION slice is valuable, but its renderer has duplicated surfaces and does not yet express the full expedition cockpit around a continuous world.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Briefing, assigned/requestable equipment, staging, Threshold approach, crossing, Outpost closure, then a focused cockpit for description, communication, inventory, evidence, status, and free ACTION submission.

**WHAT SYSTEM IT CHANGES:** Expedition state projections, cockpit information architecture, ACTION/clarification interaction, communication/evidence/inventory controls, transition reveal, focus, and accessibility.

**WHAT IT MUST NOT BREAK:** Custodian action authority, observer-safe descriptions, continuous runtime, pause policy, no ordinary mid-expedition saves, existing deterministic resolver semantics, or fallback operation.

**DEPENDENCIES:** V15 and V11.

**IMPLEMENTATION SCOPE:** Consolidate cockpit surfaces; preserve ACTION as primary verb; expose canonical affordances without enumerating all possibility; integrate clarification, equipment, comms, evidence, status, NPC intents, and deterministic updates; retire named legacy duplicates.

**OUT OF SCOPE:** Broad geography/phenomena, final audio, long-horizon succession, and release art polish.

**ACCEPTANCE CRITERIA:** A player reaches the full cockpit through the intended diegetic sequence; all controls issue bounded commands or queries; the UI updates from projections; unknown/uncertain states remain honest; keyboard/focus/scaling work; no duplicate canonical route remains.

**AUTOMATED VALIDATION:** End-to-end staging/crossing/reveal, ACTION/clarification, comms, inventory, evidence, concurrent updates, renderer no-write, focus/keyboard/scaling, and provider fallback tests.

**NATIVE / MANUAL VALIDATION:** Packaged play across the full transition and several actions under live, failed, slow, and offline provider conditions; assess comprehension and workload.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must seek renderer authority, hidden phase-button progression, knowledge leakage, dead controls, duplicate surfaces, and action loss during concurrent events.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The Complex becomes a coherent exploration workstation instead of a collection of staged panels.

**EXIT GATE:** The cockpit supports the primary expedition verbs and continuous updates through one authoritative command/projection boundary.

---

## V17 — Complete Expedition, Return, and Consequence Loop

**TYPE:** INTEGRATION / GAMEPLAY
**PLANNED CHECKPOINT:** **YES.** This is the planned expedition-gameplay-loop checkpoint.

**WHY THIS EXISTS:** Individual subsystems exist, but the constitutional loop must work end to end: preparation, crossing, exploration, evidence, logistics, return/failure/death, evaluation, and ASYNC continuation.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A full expedition with meaningful choices and consequences that feed the employee career and persistent institution.

**WHAT SYSTEM IT CHANGES:** Cross-boundary expedition lifecycle, mission objectives, equipment/logistics, evidence custody, return/debrief, injury/death consequences, evaluation hooks, checkpoint branch handling, and facility re-entry.

**WHAT IT MUST NOT BREAK:** Lifecycle semantics, personnel persistence, scheduler determinism, opportunity protection, knowledge provenance, or observer-safe provider boundaries.

**DEPENDENCIES:** V16 and V13.

**IMPLEMENTATION SCOPE:** Integrate representative expedition paths and outcomes; make evidence/logistics consequential; resolve successful/failed return and death; feed canonical evaluation, personnel, and institutional records; return surviving careers to free ASYNC intermission.

**OUT OF SCOPE:** Maximum geography/content breadth, long-horizon offline careers, final audio/presentation, portability, and release tuning.

**ACCEPTANCE CRITERIA:** At least one ordinary-production path demonstrates every constitutional loop segment; multiple valid player-directed approaches exist; outcomes persist into files, coworkers, evaluation, and future availability; death offers only ratified choices; the world remains usable under same-world succession rules.

**AUTOMATED VALIDATION:** End-to-end success/failure/death scenarios, evidence chain, logistics handoff, return/debrief, checkpoint abandonment, evaluation, facility re-entry, save/reload, provider parity, and deterministic replay.

**NATIVE / MANUAL VALIDATION:** Multiple blind packaged playthroughs, including survival, failed return, death/reload, and death/new-career preparation; inspect comprehensibility and causal continuity.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt sequence breaks, consequence loss, save abuse, evidence duplication, causeless evaluation, and scripted-button reduction.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Yellow Beast gains its complete repeatable job–expedition–consequence–intermission loop.

**EXIT GATE:** Human ratifies the full expedition loop as player-directed, persistent, deterministic, understandable, and constitutionally faithful.

---

## V18 — Geography, Evidence, and Phenomenon Expansion

**TYPE:** CONTENT / GAMEPLAY
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Current environments and outcome systems demonstrate a narrow Clear-Q4 slice; rare meaningful phenomenon behavior is reachable but much initiating behavior remains fixture-dominant.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Repeated expeditions discover a larger, changing Complex with uncertain routes, evidence work, hazards, ecologies, and canonically admitted phenomena.

**WHAT SYSTEM IT CHANGES:** Worldpack geography data, environmental state, ecology/phenomenon capability modules, encounter eligibility, evidence generation/custody, institutional discovery, and content validation.

**WHAT IT MUST NOT BREAK:** V07 authority dispositions, generic-before-learned terminology, deterministic scheduling, observer knowledge, canonical identity, expedition performance, or existing save migrations.

**DEPENDENCIES:** V07 and V17.

**IMPLEMENTATION SCOPE:** Add production-reachable geography, environmental affordances, evidence, and admitted phenomenon behaviors in bounded slices; connect discoveries to institutional knowledge; ensure rare materialization is supported by ordinary initiating chains, not only fixtures.

**OUT OF SCOPE:** Unadmitted extrapolation, prose-created mechanics, maximum content volume, audio mix, and release certification.

**ACCEPTANCE CRITERIA:** New behavior has authority provenance and ordinary production reachability; encounter labels respect knowledge history; evidence changes legitimate institutional understanding; routes and hazards persist; deterministic seeds reproduce canonical outcomes without making all observations certain.

**AUTOMATED VALIDATION:** Production reachability, seeded encounter, geography invariant, evidence provenance/custody, terminology entitlement, migration, performance, and long-run distribution tests.

**NATIVE / MANUAL VALIDATION:** Blind expedition sessions across old and new areas; reviewers assess discoverability, repetition, uncertainty, and whether encounter knowledge was earned.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must challenge canon provenance, fixture dominance, unreachable content, leaked names, scripted sequences, and evidence overclaim.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The Complex gains breadth, replayability, and institutionally meaningful discovery.

**EXIT GATE:** Representative content families are canon-authorized, ordinarily reachable, persistent, observer-safe, and integrated into the repeatable expedition loop.

---

## V19 — Long-Horizon Offline Progression and Multi-Career Succession

**TYPE:** ARCHITECTURE / GAMEPLAY
**PLANNED CHECKPOINT:** **YES.** This is the planned long-horizon-persistence checkpoint.

**WHY THIS EXISTS:** The ratified vision requires real elapsed absence to advance deterministic institutional history and employee death to permit a new career in the same evolving world.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Return after days or months to plausible changes; begin another employee in the same 1991-origin world; encounter records, remains, missing coworkers, aged survivors, and consequences of prior careers when canonically justified.

**WHAT SYSTEM IT CHANGES:** Offline catch-up policy, scheduler budgets, opportunity reservation, long-horizon personnel/institution events, world/career selection, former-employee consequences, checkpoint reload/new-career presentation, compaction and migration.

**WHAT IT MUST NOT BREAK:** Deterministic replay, gameplay-opportunity protection, lifecycle/checkpoint distinctions, personnel identity, canonical chronology, save equivalence, or no arbitrary rollback.

**DEPENDENCIES:** V18, V13, V10, and V05.

**IMPLEMENTATION SCOPE:** Resolve bounded elapsed-time batches; surface summaries with provenance; model autonomous expeditions and institutional history; preserve reserved player opportunities; implement same-world new-career entry and historical former-personnel consequences; harden years-scale storage and replay.

**OUT OF SCOPE:** Nondeterministic background mutation, guaranteed dramatic outcomes, arbitrary time travel, final audio polish, portability, and release marketing.

**ACCEPTANCE CRITERIA:** Same pre-absence state/seed/elapsed duration produces the same history regardless of process cadence; catch-up is bounded and resumable; important player-facing opportunities meet ratified reservation rules; former employees remain distinct historical entities; reload and new career are explicit separate choices; multi-year reopen is equivalent.

**AUTOMATED VALIDATION:** Hours-to-decades property runs, batch/restart/cadence equivalence, opportunity-reservation metrics, autonomous expedition, succession identity, former-personnel outcomes, compaction, migration, and malicious clock tests.

**NATIVE / MANUAL VALIDATION:** Disposable profiles with controlled elapsed intervals; packaged death→reload and death→new-career flows; human review of return summaries, opportunity fairness, history legibility, and performance.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must attempt cadence nondeterminism, gameplay consumption, identity collision, resurrection, runaway catch-up, history loss, and metagame/in-world time confusion.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The persistent-world promise becomes literal across absences and multiple employee careers.

**EXIT GATE:** Human ratifies deterministic long-horizon equivalence, opportunity protection, same-world succession, former-employee continuity, and acceptable native catch-up behavior.

---

## V20 — Causal Audio, Death Presentation, and Visual Integration

**TYPE:** INTEGRATION / UI/UX
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Current audio is a stub and presentation layers do not yet deliver the authored causal sound, death, return, and workplace atmosphere described by the UI/audio authorities.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Readable environmental cues, communications, institutional ambience, transition weight, and truthful death/return presentation without spectacle overriding reality.

**WHAT SYSTEM IT CHANGES:** Semantic audio events, mixer/buses, accessibility equivalents, transition/death/return surfaces, animation and presentation adapters, settings, and asset packaging.

**WHAT IT MUST NOT BREAK:** Simulation authority, observer uncertainty, gameplay cues, provider fallback, performance, pause/accessibility rules, or lifecycle choices.

**DEPENDENCIES:** V19 and V17.

**IMPLEMENTATION SCOPE:** Wire canonical/observer-safe semantic events to authored audio and visual presentation; implement settings, captions/visual equivalents, death and career-choice presentation, transition polish, and failure-tolerant asset loading; retire the oscillator stub.

**OUT OF SCOPE:** New mechanics, canon rulings, scheduler changes, broad content, and release certification.

**ACCEPTANCE CRITERIA:** Audio/visuals respond to semantic events and never mutate truth; important audio cues have accessible equivalents; death options match lifecycle state exactly; missing/disabled audio does not change outcomes; no cue reveals unauthorized knowledge.

**AUTOMATED VALIDATION:** Semantic-event mapping, no-authority guards, asset manifest, missing-asset fallback, settings persistence, caption/equivalent coverage, lifecycle presentation, and performance tests.

**NATIVE / MANUAL VALIDATION:** Headphones/speakers, mute, reduced-motion, keyboard, scaling, low-resource packaged sessions, and human audio/presentation review across onboarding, facility, expedition, return, and death.

**FRESH-CONTEXT INDEPENDENT REVIEW:** NO. Focused audio/UI reviewers work against settled semantic contracts; V23 provides adversarial integration review.

**RECOMMENDED MODEL:** Luna
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The complete loop gains atmosphere, legibility, accessibility, and emotional weight grounded in canonical events.

**EXIT GATE:** Presentation is semantically driven, accessible, failure-tolerant, performant, and cannot contradict lifecycle or observer truth.

---

## V21 — Worldpack Portability and Standard-Side Proof

**TYPE:** ARCHITECTURE / INTEGRATION
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Yellow Beast depends on worldpack/core separation that is promising but not yet proven under a second pack and full Standard-side institutional use.

**WHAT PLAYER EXPERIENCE IT ENABLES:** Confidence that future worlds and content do not require forking Custodian, while Yellow Beast remains a coherent institution rather than hard-coded Clear-Q4 behavior.

**WHAT SYSTEM IT CHANGES:** Worldpack manifests, capability/authority registries, data-driven UI vocabulary, pack loading, migration namespaces, source bundles, packaging, and a minimal portability fixture.

**WHAT IT MUST NOT BREAK:** Yellow Beast saves, constitutional semantics, offline packaging, provider boundaries, canonical ownership, or performance.

**DEPENDENCIES:** V20 and V08.

**IMPLEMENTATION SCOPE:** Remove remaining Yellow-Beast-specific core assumptions; prove contracts with a minimal second worldpack/fixture; verify Standard-side geography/institution data is pack-owned; version pack migrations and assets; document unsupported extension boundaries.

**OUT OF SCOPE:** Building a second complete game, generic plugin marketplace, new Yellow Beast mechanics, and release marketing.

**ACCEPTANCE CRITERIA:** The portability fixture launches and exercises core contracts without core edits; Yellow Beast loads identically through the same interfaces; pack-specific canon/terminology/assets cannot bleed; migrations are namespaced and deterministic.

**AUTOMATED VALIDATION:** Dual-pack contract, leakage scan, manifest/schema, migration namespace, packaging, offline launch, action/provider boundary, and Yellow Beast regression suites.

**NATIVE / MANUAL VALIDATION:** Launch both packaged fixture and Yellow Beast profiles, switch only through sanctioned profile/worldpack flows, and inspect isolation and diagnostics.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must identify hidden hard-coding, cross-pack state/source leakage, core ownership drift, and a fixture too weak to prove portability.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Little direct Yellow Beast change; it protects future content growth and validates the claimed architecture.

**EXIT GATE:** A second pack proves the same bounded core contracts and Yellow Beast remains regression-equivalent and isolated.

---

## V22 — External Playtest, Accessibility, Balance, and Performance

**TYPE:** INTEGRATION
**PLANNED CHECKPOINT:** NO.

**WHY THIS EXISTS:** Automated correctness cannot establish comprehension, pacing, opportunity fairness, accessibility, workload, or whether the game feels like a job in a living institution.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A learnable, fair, legible, performant complete experience whose depth does not become opaque or exhausting.

**WHAT SYSTEM IT CHANGES:** Tuning data, tutorials/copy, affordance and accessibility polish, scheduler budgets, opportunity thresholds, performance budgets, diagnostics, and defect triage—not canonical authority.

**WHAT IT MUST NOT BREAK:** Determinism, canon, persistence, observer uncertainty, player-directed action, full vision scope, or worldpack isolation.

**DEPENDENCIES:** V21.

**IMPLEMENTATION SCOPE:** Run structured external sessions across first run, facility, expedition, absence, death/reload, and new career; fix bounded usability/accessibility/performance defects; tune using reproducible data; classify rather than hide architectural failures.

**OUT OF SCOPE:** Shrinking the Constitution to meet a date, inventing new major systems, nondeterministic adaptive mutation, and release certification.

**ACCEPTANCE CRITERIA:** Predefined comprehension, completion, accessibility, opportunity-retention, stability, and performance thresholds are met across supported hardware and play patterns; critical findings are fixed or explicitly block release; tuning remains deterministic.

**AUTOMATED VALIDATION:** Full suite, accessibility/static checks, performance and memory soak, scheduler/opportunity metrics, save stress, asset/offline packaging, and regression telemetry checks.

**NATIVE / MANUAL VALIDATION:** External blind playtests and accessibility review on packaged Windows builds, including keyboard-only, scaling, reduced motion, mute/captions, long absence, and multi-career flows.

**FRESH-CONTEXT INDEPENDENT REVIEW:** NO. Independent participants supply the fresh context; V23 separately audits the evidence and release claim.

**RECOMMENDED MODEL:** Luna
**REASONING LEVEL:** high

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** The complete game becomes clearer, fairer, more accessible, and stable without losing systemic depth.

**EXIT GATE:** All release-blocking usability, accessibility, balance, opportunity, and performance criteria have evidence-backed disposition.

---

## V23 — Release-Candidate Integration and Certification

**TYPE:** RELEASE
**PLANNED CHECKPOINT:** **YES.** This is the final planned release-candidate integration checkpoint.

**WHY THIS EXISTS:** The release claim must be independently falsified across authority, simulation, persistence, knowledge, native behavior, packaging, and human experience rather than inferred from accumulated pass labels.

**WHAT PLAYER EXPERIENCE IT ENABLES:** A trustworthy Yellow Beast 1.0 release delivering the complete persistent ASYNC workplace and exploration promise.

**WHAT SYSTEM IT CHANGES:** Release gates, packaging provenance, version/migration freeze, diagnostics/privacy review, documentation, known-issue disposition, and only defects necessary to satisfy certification.

**WHAT IT MUST NOT BREAK:** Every prior exit gate, offline launch, save compatibility, determinism, accessibility, worldpack isolation, or the authority hierarchy.

**DEPENDENCIES:** V22 and every unresolved earlier exit gate.

**IMPLEMENTATION SCOPE:** Freeze candidate; run the truthful full matrix; adversarially audit constitutional coverage and ownership; validate clean-machine packaging, upgrades, long worlds, recovery, absence, succession, provider failure, and manual journeys; fix blockers at owning authority and repeat affected gates.

**OUT OF SCOPE:** Unplanned features, scope reduction disguised as defect disposition, new authority amendments without returning to human legislation, and historical completion credit.

**ACCEPTANCE CRITERIA:** No silent test omission or known failing required gate; all Constitution requirements have executable or human evidence; clean installs/upgrades/offline runs work; long-world equivalence and opportunity policy pass; manual full-loop and accessibility sign-offs are recorded; release artifact provenance matches source.

**AUTOMATED VALIDATION:** Complete discovered suite, long-world/years-scale stress, deterministic replay, migration/upgrade, crash/backup/checkpoint, provider adversarial, accessibility, performance, dual-pack, package provenance, and clean-machine smoke.

**NATIVE / MANUAL VALIDATION:** Independent clean-machine Windows certification plus owner playthroughs of first career, expedition outcomes, absence, death/reload, death/new career, former-personnel consequence, and full ASYNC intermission.

**FRESH-CONTEXT INDEPENDENT REVIEW:** **YES.** The reviewer must try to disprove the 1.0 claim, locate skipped evidence or duplicate authority, and reproduce every previously known critical defect.

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

**EXPECTED PLAYER-VISIBLE IMPROVEMENT:** Release-grade reliability and confidence; only blocker fixes should visibly change the locked candidate.

**EXIT GATE:** Human release authority accepts the independent certification packet and exact artifact. Only then may Yellow Beast 1.0 be declared complete.

---

## Exact recommended scope for the first implementation pass only

### Objective

Execute **V01 — Authority Amendments and Constitutional Cleanup**: turn the Phase 01C ratified product decisions into one explicit, internally consistent authority set before any runtime implementation begins.

### Files and systems likely involved

- `SIMULATION_DOCTRINE.md`: deliberate amendments to wall-clock eligibility and world/career death and succession rules, recorded under the Doctrine's amendment mechanism.
- `docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md`: conform conflicting retirement, save, career, and time language to the amendments.
- `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md`: make the five state concepts and ratified opportunity-protection rule explicit where needed.
- `docs/IMPLEMENTATION_STATE.md`: record the ratified amendment and the still-unimplemented runtime gap.
- `AGENTS.md` and authority/registry metadata or hashes only if needed to keep precedence and integrity references accurate.
- The Phase 01C baseline/pass map only for narrowly necessary cross-reference corrections after ratification.

No runtime system is authorized to change in V01.

### Defects addressed

- Pre-V01 Doctrine-wide retirement after player death conflicted with same-world employee succession.
- Pre-V01 Charter retirement/save language conflicted with sanctioned pre-expedition metagame reload and ASYNC save boundaries.
- Pre-V01 wall-clock language lacked the explicit bounded deterministic specialization required for ratified offline progression.
- Before V01, canonical persistence, crash recovery, session state, checkpoint state, and metagame reload lacked one authoritative shared definition.
- Before V01, the offline opportunity-preservation obligation was not yet an enforceable constitutional constraint.

### Explicit non-goals

- No code, schema, save, migration, backup, scheduler, provider, UI, audio, or content change.
- No repair of long-world equivalence, personnel reload, retired-world restore, or provider terminology leakage.
- No canon admission ruling for Still Life or Bacteria behavior.
- No implementation prompt or speculative design for later passes.
- No removal of historical documents; they remain history and are relabeled only if needed for precedence clarity.

### Tests required

- Authority registry/integrity and documentation contract tests relevant to changed files.
- Link/reference validation for all amended section citations.
- A contradiction scan proving no active sentence still mandates world retirement after every player death or treats sanctioned checkpoint restore as in-world rollback.
- A terminology scan proving the five state concepts are used consistently.
- `git diff --check` and a file-scope assertion proving no runtime or schema file changed.
- The current aggregate test command may be run as a no-behavior-change regression check, but V01 may not claim repository-wide test trust before V02.

Known V02-owned omissions and the long-world failure remain documented; V01 must not hide or reclassify them.

### Native / manual checks

- Project owner performs line-by-line human ratification of each amendment and supersession.
- A fresh-context reviewer attempts to find ambiguous resurrection, rollback, wall-clock mutation, observer leakage, or weakened canonical persistence.
- No native gameplay behavior should change. A packaged smoke is optional evidence of non-impact, not a substitute for textual ratification.

### Expected repository state afterward

- One ratified constitutional authority set explicitly permits same-world new careers, sanctioned pre-expedition branch abandonment, bounded deterministic elapsed-time eligibility, and gameplay-opportunity protection.
- The five persistence/recovery/session/checkpoint/reload concepts have distinct authoritative definitions.
- `docs/IMPLEMENTATION_STATE.md` states that current runtime behavior still conflicts until later repair passes.
- No runtime, schema, save version, content behavior, or packaged behavior has changed.
- V02 is authorized only after the V01 checkpoint is approved.

### Recommended model and reasoning

**RECOMMENDED MODEL:** GPT-5.6 Sol
**REASONING LEVEL:** xhigh

### Planned checkpoint

**YES.** V01 is a planned human checkpoint because it changes the project's constitutional authority; implementation must pause for explicit ratification afterward.

### Exact exit criteria

V01 is complete only when all of the following are true:

1. The owner explicitly ratifies the exact amendment text.
2. Doctrine and Charter no longer conflict with the ratified death, succession, checkpoint, or offline-time decisions.
3. Every superseded rule is identified; none is silently reinterpreted.
4. Canonical persistence, crash recovery, session state, player checkpoint, and metagame reload are separately defined.
5. Deterministic elapsed-time eligibility cannot be read as permission for uncontrolled wall-clock mutation.
6. Offline opportunity protection is an explicit scheduler constraint.
7. Observer boundaries and Custodian canonical authority are unchanged or strengthened.
8. Authority integrity/link checks and diff hygiene pass.
9. The diff contains documentation/authority metadata only and makes no gameplay implementation change.
10. `docs/IMPLEMENTATION_STATE.md` records both the ratified rule and the outstanding runtime reconciliation work.

Failure of any item keeps the checkpoint open and blocks V02.
