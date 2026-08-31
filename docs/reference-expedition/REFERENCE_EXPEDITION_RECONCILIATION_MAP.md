# Reference Expedition — KEEP / SIMPLIFY / FREEZE / BURN Reconciliation Map

**Repository snapshot:** `reference-expedition/foundation` at `77c7729086460d7d5adbef97a7deaf1f22a9ac1d`  
**V03 checkpoint:** `c60f362a05773eee925f71083430c06590d35e30`  
**Reconciliation date:** 2026-08-30  
**Mode:** Read-only; no repository files modified  
**Authority effect:** Analysis and sequencing guidance only; this map does not authorize implementation or deletion.

## Executive finding

The repository contains a technically playable Clear-Q4 operation and substantial reusable foundations for deterministic action resolution, geography, equipment, communications, evidence, return, and debrief. It does **not** yet satisfy the Reference Expedition.

The decisive gaps are not feature breadth. They are:

- uncertified V03 persistence;
- save-time mutation and overlapping canonical ownership;
- no implemented reference discrepancy;
- compressed and largely ceremonial deployment;
- personnel state split between world and run;
- no successful compound coworker-plus-player action;
- unreliable human LOCAL behavior;
- shallow and divided evidence-to-belief processing;
- conflicting checkpoint/recovery/lifecycle behavior;
- no current production-artifact or human UI proof.

The correct posture is selective preservation. Proven domain semantics should remain. Broad content systems, phenomena, audio, alternate modes, campaign progression, and later-game expansion must stop receiving investment until the specimen passes.

## Authority and evidence basis

The governing order used here is:

1. `SIMULATION_DOCTRINE.md`
2. `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md`
3. `canon/SOURCE_POLICY.md` and admitted claim records
4. `YELLOW_BEAST_RECONSTRUCTION_AUTHORITY.md`
5. `docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md`
6. `docs/YELLOW_BEAST_CURRENT_BASELINE.md`
7. `docs/YELLOW_BEAST_VISION_PASS_MAP.md`
8. current-pass authority and `docs/IMPLEMENTATION_STATE.md`
9. `docs/reference-expedition/REFERENCE_EXPEDITION_INVARIANTS.md`
10. `docs/reference-expedition/REFERENCE_EXPEDITION_SPECIMEN_BRIEF.md`

The Reference Expedition documents narrow a milestone proof. They do not admit Kane canon, authorize later passes, or override simulation law.

### Invariant shorthand

- **I1:** Work before horror
- **I2:** One bounded discrepancy; no encounter obligation
- **I3:** Persistent four-person human team
- **I4:** Deterministic world; generative performance only
- **I5:** Natural agency without player theft or machinery friction
- **I6:** Evidence as the observation-to-institution bridge
- **I7:** Truth, belief, report, and consequence remain separate
- **I8:** Comparable runs with controlled deterministic variance

### Disposition meanings

- **KEEP:** Preserve the demonstrated authority or semantics; repair only defects needed by the specimen.
- **SIMPLIFY:** Retain a narrow useful core while removing or bypassing unnecessary machinery.
- **FREEZE:** Make no further investment until the specimen passes.
- **BURN:** Candidate for a later proven migration/removal pass. No immediate deletion is authorized.

## Committed, historical, and uncertified state

- The V03 implementation is now **committed** at `c60f362`. The subsequent commits only ratify and register the Reference Expedition documents.
- There are no uncommitted tracked source changes. The two untracked files, `SOL-COMEBACK-STATUS.txt` and `repo-spring-clean-20260818-011447.txt`, are historical status captures from commit `250c4c5`; they are not current implementation authority.
- `tests/v03-persistence-foundation.js` is also committed at `c60f362`. Historical text describing it as untracked is stale.
- V03 remains **uncertified**:
  - it is named `v03-persistence-foundation.js`, not `*.test.js`;
  - it is absent from `verification/test-manifest.json`;
  - it has no governed hash or tier in `verification/verification-authority.json`;
  - the verification authority still registers `YB-V03-CANONICAL-EQUIVALENCE` as an open known defect;
  - the Vision Pass Map and Implementation State still describe V02 as active and V03 as prohibited or awaiting certification.
- A fresh `npm test` run at this repository state passed **401/401 assertions**, with inventory reporting **99 included, 4 quarantined, 0 retired**. This proves the governed aggregate gate, not the V03 exit gate or the Reference Expedition.
- A direct V03 test attempt produced 9 passing in-memory tests and 19 filesystem tests blocked by the read-only environment’s `EPERM` restriction. That result is neither a product failure nor certification.
- Existing packaged evidence applies to the older artifact stamped from `33017ea…`, not the V03 checkpoint or current HEAD.
- No current human playtest proves a 35–60 minute production-UI expedition, three contrasting runs, or the specimen break-scoring matrix.

---

## Reconciliation map

### 1. Canon and scenario admission

- **Canonical owner:** `canon/SOURCE_POLICY.md`, admitted claim records, and the scenario admission records.
- **Implementation evidence:** `canon/claims/foundation.json` admits Threshold Baseline as pack-original; `canon/claims/transitions.json` limits return-path claims; canon aggregate tests passed in the fresh run.
- **Ordinary production reachability:** Indirect. Admission shapes worldpack validation and terminology but is not a normal player surface.
- **Invariants served:** I2, I4, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** The source/claim/admission separation is sound. The exact overlapping-corridor discrepancy has not been declared as a bounded pack-original specimen fact.
- **Dependency or conflict:** Must not be presented as a universal Complex law or Kane-primary fact.
- **Minimum production-UI proof:** The discrepancy appears only through concrete measurements and prior records, never through an “anomaly” label or asserted mechanism.
- **Tests trustworthy:** Yes for admission boundaries; no test currently proves the specimen discrepancy or its player-facing language.

### 2. Verification governance

- **Canonical owner:** `verification/verification-authority.json`, with `verification/test-manifest.json` as the execution manifest.
- **Implementation evidence:** `verification/TIERS.md`; `tools/verification-inventory.js`; `tools/verification-runner.js`; fresh aggregate result of 401 passes.
- **Ordinary production reachability:** No; release and development evidence only.
- **Invariants served:** All, especially I4 and the acceptance boundary.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** V02 successfully prevents silent omission and false-green report semantics, but V03 and Reference Expedition acceptance are outside its governed set.
- **Dependency or conflict:** V03 cannot become a trusted dependency until its tests are registered and the known defect is formally resolved.
- **Minimum production-UI proof:** A governed production-UI acceptance command must identify the exact build, profile, seed, route, and human gates.
- **Tests trustworthy:** The aggregate is trustworthy for its declared membership only.

### 3. Canonical world identity and append-only history

- **Canonical owner:** `tools/world-history.js`.
- **Implementation evidence:** `createWorld` initializes stable world state at `tools/world-history.js:107`; canonical events receive stable sequence and provenance at `:109`; current-world validation and migration are at `:175–202`.
- **Ordinary production reachability:** Yes. Every world creation, action commit, report, and expedition closure uses it.
- **Invariants served:** I3, I4, I6, I7, I8.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Stable identities and structured events are essential and broadly demonstrated. Event history is not yet the single replay owner for all personnel, institutional, and geography state.
- **Dependency or conflict:** Depends on certified normalization and removal of save-time authority duplication.
- **Minimum production-UI proof:** Stable world, event, person, evidence, and route identities remain unchanged across complete run/reopen cycles.
- **Tests trustworthy:** Aggregate tests support event and identity semantics; long-horizon replay ownership remains uncertified.

### 4. V03 canonical normalization and strict serialization

- **Canonical owner:** `tools/world-history.js`, with file commit authority in `DesktopService`.
- **Implementation evidence:** strict canonical JSON/event normalization at `tools/world-history.js:47`; `normalizeWorld`, `saveWorld`, and `loadWorld` at `:202–204`; V03 tests at `tests/v03-persistence-foundation.js`.
- **Ordinary production reachability:** Yes, on every current world load and save.
- **Invariants served:** I3, I4, I6, I7, I8.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** The committed implementation directly addresses first-load shape drift and lossy serialization, but its exit criteria are not governed or certified.
- **Dependency or conflict:** Active verification authority still records canonical equivalence as an open V03 defect.
- **Minimum production-UI proof:** Before, during, and after-operation reopen produces exact canonical equivalence without new events, observations, defaults, or knowledge.
- **Tests trustworthy:** No certification claim is justified. The dedicated file is outside the manifest.

### 5. Paired world/session transaction

- **Canonical owner:** `desktop/service.js`.
- **Implementation evidence:** staged paired commit and rollback at `desktop/service.js:231–252`; every gameplay mutation reaches `persistSession` at `:273`.
- **Ordinary production reachability:** Yes. Structured actions, natural actions, communications, logistics, and shutdown all commit through it.
- **Invariants served:** I3, I4, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Coordinated world/session atomicity is valuable and directly aligned with trustworthy persistence.
- **Dependency or conflict:** The transaction encloses save-time simulation work, so atomic I/O does not yet imply correct canonical ownership.
- **Minimum production-UI proof:** Injected interruption at every stage preserves one auditable world/session boundary and never produces half-applied field consequences.
- **Tests trustworthy:** V03 failure-injection coverage exists but is uncertified; historical atomic-save tests do not prove the new paired transaction.

### 6. Save-time reconciliation and mutation

- **Canonical owner:** Currently ambiguous between world history, run state, and `DesktopService`.
- **Implementation evidence:** `reconcileSessionCandidate` at `desktop/service.js:253–263` synchronizes equipment, trajectories, environment history, geography, phenomena, objects, personnel, communications, evidence, and Survey Frontier during save.
- **Ordinary production reachability:** Yes, after virtually every successful player operation.
- **Invariants served:** Intended to serve I3, I4, I6, I7; currently threatens them.
- **Status:** **conflicting**
- **Disposition:** **SIMPLIFY**
- **Reason:** Serialization still decides or copies canonical truth across multiple domains. Saving can therefore remain a cause instead of a neutral commit.
- **Dependency or conflict:** Conflicts with Doctrine Laws III, XXXV–XXXVII and V03 transaction separation.
- **Minimum production-UI proof:** Producing a projection, saving, closing, or reopening creates no new phenomenon, knowledge, personnel consequence, or institutional record.
- **Tests trustworthy:** Read-purity unit tests are useful; no governed production composition proof exists.

### 7. Manual previous-good restore

- **Canonical owner:** Current implementation: `DesktopService`; product authority: Gameplay Constitution checkpoint and metagame-reload rules.
- **Implementation evidence:** arbitrary confirmed copy-back at `desktop/service.js:216`; renderer exposes “Restore the previous save” at `desktop/renderer/renderer.js:190`.
- **Ordinary production reachability:** Yes, from the world library.
- **Invariants served:** None safely in its current form.
- **Status:** **broken**
- **Disposition:** **BURN**
- **Reason:** It is an arbitrary player-visible rollback, not crash recovery or the sanctioned pre-expedition checkpoint, and can reverse terminal lifecycle state.
- **Dependency or conflict:** Conflicts with the five-state persistence model and ratified checkpoint boundaries.
- **Minimum production-UI proof:** The generic restore control is absent; only sanctioned checkpoint abandonment is selectable, while crash recovery remains invisible and monotonic.
- **Tests trustworthy:** Existing restore tests prove old behavior, not constitutional compliance.

### 8. Player checkpoint, session recovery, and metagame reload separation

- **Canonical owner:** Gameplay Constitution; no complete runtime owner exists.
- **Implementation evidence:** session envelopes and previous-good files exist at `desktop/service.js:221–252`; no distinct player-checkpoint object or metagame branch record exists.
- **Ordinary production reachability:** Session resume is reachable; sanctioned checkpoint semantics are not.
- **Invariants served:** I4 and acceptance item 9.
- **Status:** **missing**
- **Disposition:** **SIMPLIFY**
- **Reason:** The specimen needs trustworthy reopen behavior, not a broad save system. The five concepts remain conflated in runtime and UI.
- **Dependency or conflict:** Depends on certified V03 and personnel replay; must not expand into arbitrary mid-expedition loading.
- **Minimum production-UI proof:** Facility/pre-entry checkpoint, invisible active-session recovery, and branch abandonment are visibly and transactionally distinct.
- **Tests trustworthy:** No existing test proves the ratified five-state contract.

### 9. Assignment causality and work-order generation

- **Canonical owner:** `tools/q4-assignment-engine.js` plus the Clear-Q4 institutional/worldpack records.
- **Implementation evidence:** condition derivation, deterministic selection, issue, resolve, and projection exported at `tools/q4-assignment-engine.js:150`; ordinary startup invokes `issue` at `tools/run-bootstrap.js:168`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I1, I4, I7, I8.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Work orders can arise from recorded conditions and institutional knowledge. Current selection is broader than the fixed specimen and does not guarantee its exact operation.
- **Dependency or conflict:** Needs a bounded reference operation without replacing the general assignment engine.
- **Minimum production-UI proof:** The same reference seed always produces the declared survey assignment, team responsibilities, prior record, reporting requirements, and return conditions.
- **Tests trustworthy:** Governed assignment tests support module behavior; production specimen selection is unproved.

### 10. Reference operation and controlled variance package

- **Canonical owner:** A bounded pack-original Reference Expedition configuration should own it; no current implementation does.
- **Implementation evidence:** Current Clear-Q4 worldpack defines a Utility Room survey and broad procedural operation; staffing permits 3–5 people at `data/worldpacks/clear-q4/dynamics.json:11–15`.
- **Ordinary production reachability:** No exact reference package exists.
- **Invariants served:** I1–I8.
- **Status:** **missing**
- **Disposition:** **SIMPLIFY**
- **Reason:** The specimen needs one fixed route, one discrepancy, one four-person team, one no-variance seed, and a very small variance package—not new mission breadth.
- **Dependency or conflict:** Must remain pack-original, bounded, and non-universal.
- **Minimum production-UI proof:** Three runs preserve mission, route, discrepancy, and checks while varying only the permitted workplace details.
- **Tests trustworthy:** None.

### 11. Briefing presentation

- **Canonical owner:** Mission/work-order projection in `tools/q4-experience.js`; renderer is presentation only.
- **Implementation evidence:** the production briefing surface renders assignment, team, equipment, reporting, and prior record in `desktop/renderer/surfaces.js:90–106`.
- **Ordinary production reachability:** Yes, immediately after starting Clear-Q4.
- **Invariants served:** I1, I3, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** The briefing is legible and work-oriented, but it is attached to a compressed preparation path and not the fixed specimen.
- **Dependency or conflict:** Depends on the reference work order and exact team/loadout.
- **Minimum production-UI proof:** A stranger can explain the job, roles, known route, uncertain prior fact, evidence obligation, and return rule before deployment.
- **Tests trustworthy:** Renderer and module tests prove content presence, not comprehension or tone.

### 12. Equipment identity, custody, and staging decisions

- **Canonical owner:** `tools/logistics-runtime.js`, `tools/q4-equipment.js`, and Clear-Q4 logistics definitions.
- **Implementation evidence:** required/optional equipment and custody projection at `tools/q4-equipment.js:114`; optional-store retrieval at `desktop/service.js:543–553`; physical handoff at `:528–541`; renderer controls at `desktop/renderer/renderer.js:138–140`.
- **Ordinary production reachability:** Equipment and custody are reachable. Optional-store selection requires `STAGING`, which ordinary new sessions skip.
- **Invariants served:** I1, I3, I5, I6.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Identity, custody, condition, containers, and transactions are strong. The required meaningful preparation decision is not reliably reachable in the ordinary flow.
- **Dependency or conflict:** Blocked by collapsed deployment.
- **Minimum production-UI proof:** The player can accept, add, or reassign one relevant item; the resulting capability limitation persists and affects field work.
- **Tests trustworthy:** Logistics contracts are useful; they do not prove ordinary staging reachability.

### 13. Deployment phases and Threshold ritual

- **Canonical owner:** Phase and spatial traversal authorities; renderer may only portray them.
- **Implementation evidence:** `q4.nextPhase` maps `BRIEFING + DEPLOY` directly to radio check at `tools/q4-experience.js:197–206`; `desktop/service.js:560–580` preserves a legacy chain but new sessions use `DEPLOY`; operational UI exposes that compressed decision at `desktop/renderer/surfaces.js:90–106`.
- **Ordinary production reachability:** Yes, but compressed.
- **Invariants served:** I1, I3, I5.
- **Status:** **broken**
- **Disposition:** **BURN**
- **Reason:** The `DEPLOY` shortcut collapses staging, controlled transit, accountability, and perceptible crossing. It also strands staging-only controls.
- **Dependency or conflict:** Conflicts directly with I1, the Specimen Brief, and the Gameplay Constitution’s first-operation ritual.
- **Minimum production-UI proof:** Visible accountability, one preparation choice, player-authored radio procedure, and a perceptible Threshold crossing before field controls appear.
- **Tests trustworthy:** Phase-guard tests prove transitions, not that ordinary production presents the required ritual.

### 14. Objective geography and persistent topology

- **Canonical owner:** `tools/spatial-runtime.js`, with persisted snapshot in `world.q4_geography`.
- **Implementation evidence:** canonical definition, movement, projection, expansion, markers, and snapshots exported at `tools/spatial-runtime.js:457`; world validation consumes canonical topology at `tools/world-history.js:184`.
- **Ordinary production reachability:** Yes through movement, inspection, maps, and revisits.
- **Invariants served:** I1, I2, I4, I7, I8.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Persistent bounded geography and stable traversal are core specimen assets. Long-horizon ownership remains split between run and world snapshots.
- **Dependency or conflict:** Must be certified under V03 and must not regenerate the discrepancy.
- **Minimum production-UI proof:** The same route and discrepancy survive all contrasting runs and reopen points without leaking unobserved topology.
- **Tests trustworthy:** Strong module coverage exists; current production long-world equivalence remains uncertified.

### 15. Survey Frontier and observer-bound maps

- **Canonical owner:** `tools/survey-frontier.js` for knowledge; spatial runtime for objective topology.
- **Implementation evidence:** separate create, observe, traverse, share, report, personal map, and Standard map functions exported at `tools/survey-frontier.js:88`; UI uses observer-safe layout records.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I2, I4, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Objective geography and observer/institutional map knowledge are correctly separated. Save-time copying and institutional overlap remain risks.
- **Dependency or conflict:** Depends on one geography owner and delivered-report-only Standard updates.
- **Minimum production-UI proof:** Player, coworker, and Standard views visibly diverge after an undelivered discovery and reconcile only through legitimate transfer.
- **Tests trustworthy:** Survey contracts are useful; the modified long-world tests were not part of the fresh aggregate execution.

### 16. Reference overlapping-corridor discrepancy

- **Canonical owner:** Missing bounded scenario authority.
- **Implementation evidence:** No production code or worldpack record defines a passage whose measured depth overlaps a previously surveyed parallel corridor. Existing “discrepancy” language belongs to generic trajectories, phenomena, reports, and mission families.
- **Ordinary production reachability:** No.
- **Invariants served:** I2, I6, I7, I8.
- **Status:** **missing**
- **Disposition:** **SIMPLIFY**
- **Reason:** This is the specimen’s central controlled fact. Generic spatial inconsistency or phenomenon machinery is not a substitute.
- **Dependency or conflict:** Must exist before deployment, remain mundane in local appearance, and never reveal a cause.
- **Minimum production-UI proof:** Measurement plus prior-record comparison reveals the contradiction; photography alone is insufficient; ignoring it leaves institutional knowledge unchanged.
- **Tests trustworthy:** None.

### 17. Structured and natural ACTION resolution

- **Canonical owner:** `tools/run-bootstrap.js`, object/spatial runtimes, and bounded consequence authorities.
- **Implementation evidence:** canonical action resolution at `tools/run-bootstrap.js:461–514`; UI structured controls at `desktop/renderer/renderer.js:128–135`; natural routing at `desktop/service.js:702–741`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I4, I5, I6.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Supported movement, inspection, object interaction, recording, and fallback are safe. Broad attempts, durations, partial results, and compound action execution remain narrow.
- **Dependency or conflict:** Provider plans still resolve through limited production affordances.
- **Minimum production-UI proof:** Investigate, measure, photograph, note, flag, ignore, continue, and retreat all work without internal IDs or invented success.
- **Tests trustworthy:** Good for supported actions and non-authority; insufficient for the full specimen action vocabulary.

### 18. Compound coworker-plus-player instruction

- **Canonical owner:** No complete owner; pieces exist in local intent, team runtime, spatial/object resolution, and operational time.
- **Implementation evidence:** named-worker natural language is diverted entirely to `submitQ4LocalIntent` at `desktop/service.js:702–713`; local intent can issue several coworker actions at `:398–440`, but it does not concurrently execute a player measurement or inspection.
- **Ordinary production reachability:** The coworker-order half is indirectly reachable through ACTION text; the compound contract is not.
- **Invariants served:** I3, I5.
- **Status:** **missing**
- **Disposition:** **SIMPLIFY**
- **Reason:** One bounded compound form is required. A general planner or autonomous-mind system is unnecessary.
- **Dependency or conflict:** Needs deterministic duration/order and must preserve player authorship.
- **Minimum production-UI proof:** “Nora, photograph the fixture while I check the wall measurement” produces two separately owned, partially fail-able attempts.
- **Tests trustworthy:** Existing multi-step and LOCAL tests do not prove simultaneous production execution.

### 19. Persistent personnel identity and replay

- **Canonical owner:** Conflicting between `world.characters`, per-run team members, continuity records, and consequence events.
- **Implementation evidence:** staffing and identity at `tools/q4-personnel.js:55–99`; world character rebuild at `tools/world-history.js:158–198`; V03 save crossing at `desktop/service.js:253–263`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I3, I4, I7, I8.
- **Status:** **conflicting**
- **Disposition:** **SIMPLIFY**
- **Reason:** Seeded coworkers and repeat staffing exist, but one canonical personnel owner is still absent. Current staffing also varies between three and five instead of fixing four for the specimen.
- **Dependency or conflict:** V04 ownership/replay repair is a hard dependency.
- **Minimum production-UI proof:** Four stable identities retain role, task, equipment, knowledge, condition, memory, and post-operation delta across every reopen.
- **Tests trustworthy:** Personnel module tests are useful; no governed proof closes the dual-owner/reload risk.

### 20. Coworker task scheduling and parallel action

- **Canonical owner:** `tools/team-runtime.js` and deterministic operational-cycle authorities.
- **Implementation evidence:** order states and task operations exported at `tools/team-runtime.js:177`; `submitQ4LocalIntent` issues persistent team orders at `desktop/service.js:420–431`.
- **Ordinary production reachability:** Yes for bounded orders; limited for visible parallel performance.
- **Invariants served:** I3, I5.
- **Status:** **partial**
- **Disposition:** **SIMPLIFY**
- **Reason:** Accept, refuse, delay, clarification, and persistent task state exist. Full concurrent intent, interruption, and coworker action portrayal are incomplete.
- **Dependency or conflict:** Depends on personnel ownership and compound action timing.
- **Minimum production-UI proof:** A coworker task continues while the player acts, completes or fails for a stated cause, and survives reload.
- **Tests trustworthy:** Direct task-state tests are evidence of scaffolding, not human production behavior.

### 21. LOCAL communication and human response

- **Canonical owner:** Communication delivery state plus observer-bounded personnel reaction.
- **Implementation evidence:** ordinary LOCAL submission at `desktop/service.js:443–480`; all nearby coworkers are recipients and their responses are concatenated at `:463–477`; communications UI at `desktop/renderer/surfaces.js:49`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I3, I5, I7.
- **Status:** **broken**
- **Disposition:** **SIMPLIFY**
- **Reason:** Targeted speech is effectively broadcast to all eligible coworkers, every recipient can answer, and prior baseline evidence records blank/silence rendering risk. This fails the specimen’s human standard.
- **Dependency or conflict:** Must preserve hearing and silence while avoiding mandatory chatter.
- **Minimum production-UI proof:** Each coworker can produce a nonblank contextual exchange when appropriate; targeted speech stays targeted; silence is explicitly legible.
- **Tests trustworthy:** No. Existing tests support delivery mechanics but do not establish ordinary human dialogue or the known broadcast regression.

### 22. STANDARD delivery and remote knowledge boundary

- **Canonical owner:** `tools/communication-runtime.js`, `tools/q4-radio.js`, `tools/q4-standard-operator.js`.
- **Implementation evidence:** attempt/delivery/acknowledgment states at `tools/communication-runtime.js:222` and `tools/q4-radio.js:51`; production submission and delayed delivery at `desktop/service.js:482–526`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I1, I4, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Delivery provenance and radio-state separation are strong. STANDARD’s broader cognition, workload, and relationship to the multiple institutional stores remain shallow.
- **Dependency or conflict:** Must read only delivered communications and returned evidence.
- **Minimum production-UI proof:** Undelivered, delayed, and delivered reports produce three visibly distinct Standard knowledge states without field omniscience.
- **Tests trustworthy:** Strong for delivery mechanics; insufficient for full institutional cognition.

### 23. Evidence creation, provenance, custody, and archive

- **Canonical owner:** `tools/q4-evidence-authority.js`.
- **Implementation evidence:** the module explicitly owns identity, provenance, custody, and institutional access at `tools/q4-evidence-authority.js:3–7`; capture, transfer, report, return, contradictions, archive, and validation at `:53–66`.
- **Ordinary production reachability:** Yes through authored object interactions, reports, return synchronization, and debrief archive.
- **Invariants served:** I4, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** This is one of the strongest specimen foundations. Measurement/note/testimony breadth and institutional analysis remain incomplete.
- **Dependency or conflict:** Must preserve evidence even when it is lost, unreported, contradicted, or inaccessible to Standard.
- **Minimum production-UI proof:** Stable measurement, photograph, note/testimony, custody, report linkage, access, and uncertainty survive all three contrasting runs.
- **Tests trustworthy:** Yes for module provenance/custody boundaries; no complete production chain has been demonstrated.

### 24. Evidence-to-belief institutional processing

- **Canonical owner:** Intended owner is `tools/institutional-runtime.js`; current state overlaps world institutional records, Standard operator history, Survey Frontier, evidence, and closure projections.
- **Implementation evidence:** institutional inputs require provenance and reject undelivered communications at `tools/institutional-runtime.js:62–75`; mission closure calls `ingestClosure` at `desktop/service.js:611–616`.
- **Ordinary production reachability:** Yes at closure and through some delivered reports.
- **Invariants served:** I6, I7.
- **Status:** **partial**
- **Disposition:** **SIMPLIFY**
- **Reason:** Rules can create uncertain claims and follow-up work, but no single trusted institutional cognition owner exists and analysis is shallow.
- **Dependency or conflict:** Requires ownership consolidation without introducing a broad institutional simulation pass.
- **Minimum production-UI proof:** Strong, weak, undelivered, omitted, and contradictory records generate appropriately different A-Sync beliefs from the same world truth.
- **Tests trustworthy:** Institutional unit tests are useful; the five required specimen outcomes are unproved.

### 25. Return, controlled abort, closure, and debrief

- **Canonical owner:** Mission runtime, logistics/evidence reconciliation, continuity, and outcome authorities.
- **Implementation evidence:** return/abort handling and closure ingestion at `desktop/service.js:607–626`; debrief renders assignment, personnel, equipment, evidence, communications, and institution at `desktop/renderer/surfaces.js:74–81`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I1, I3, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** A bounded complete operation, controlled abort, accountability, and debrief exist. The current debrief does not yet prove the exact truth/observation/evidence/report/belief separation required by the specimen.
- **Dependency or conflict:** Depends on fixed discrepancy, personnel replay, and institutional belief repair.
- **Minimum production-UI proof:** Investigate/document, report/return early, and ignore/omit runs end with legibly different team and A-Sync outcomes.
- **Tests trustworthy:** Existing completion tests prove technical closure, not contrasting production-UI causality.

### 26. Offline deterministic fallback and provider non-authority

- **Canonical owner:** Canonical action authorities; provider is language-only.
- **Implementation evidence:** `submitNatural` selects deterministic fallback when offline at `desktop/service.js:734–741`; action consequences still resolve through `resolveQ4Attempt`; provider-independent aggregate tests passed.
- **Ordinary production reachability:** Yes; offline is the default.
- **Invariants served:** I4, I5.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** Offline completion and provider non-write authority are strong. Provider clarification/output terminology validation remains historically broken.
- **Dependency or conflict:** The specimen does not need provider enrichment; provider switching must not alter canonical state.
- **Minimum production-UI proof:** Provider-off and provider-switch runs produce byte-equivalent canonical reality and available outcomes.
- **Tests trustworthy:** Good for no-write/fallback contracts; no current full-run provider-switch equivalence proof exists.

### 27. Provider enrichment and broad natural-language expansion

- **Canonical owner:** None; it is optional presentation.
- **Implementation evidence:** OpenAI adapter and authority-context overlay remain available, while the Baseline records internal terminology leakage.
- **Ordinary production reachability:** Optional when configured.
- **Invariants served:** At most I5; currently risks I4 and I7.
- **Status:** **broken**
- **Disposition:** **FREEZE**
- **Reason:** The specimen can and must pass offline. Further provider expansion would add risk without closing a specimen dependency.
- **Dependency or conflict:** V06 knowledge-boundary repair remains prerequisite to renewed work.
- **Minimum production-UI proof:** No internal family name, hidden state, invented player speech, or unavailable affordance appears under adversarial provider output.
- **Tests trustworthy:** Existing provider tests prove adapter structure, not terminology safety.

### 28. Environment and ordinary equipment friction

- **Canonical owner:** `tools/q4-environment.js`, operational dynamics, equipment and hazard authorities.
- **Implementation evidence:** environment state and observations exported at `tools/q4-environment.js:67`; current worldpack includes deterministic radio shadow, loose bracket, and relay fault.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I1, I4, I5.
- **Status:** **partial**
- **Disposition:** **FREEZE**
- **Reason:** The existing environment can support mundane work, but the reference operation requires tightly controlled, non-mandatory friction and no mandatory injury.
- **Dependency or conflict:** Reference seed must suppress or explicitly bound current hazard consequences.
- **Minimum production-UI proof:** At most one permitted annoyance occurs with visible cause and legible options; no injury is required.
- **Tests trustworthy:** Environment contracts are useful; specimen threat-envelope compliance is unproved.

### 29. Phenomena and entities

- **Canonical owner:** Internal phenomenon ecology, subject to independent source admission.
- **Implementation evidence:** `tools/q4-phenomenon-ecology.js:294`; ordinary save reconciliation calls `materializeEligible` at `desktop/service.js:258`; developer fixtures expose deeper behavior at `:158–171`.
- **Ordinary production reachability:** Rare materialization is production-reachable; most meaningful behavior is fixture-dominant.
- **Invariants served:** None required by the specimen; can violate I2.
- **Status:** **conflicting**
- **Disposition:** **FREEZE**
- **Reason:** The specimen explicitly excludes entities and new phenomenon work. Automatic materialization during save is also an authority smell.
- **Dependency or conflict:** Named behavior remains incompletely admitted, and an encounter would contaminate the controlled proof.
- **Minimum production-UI proof:** The reference seed completes repeatedly with no entity or phenomenon materialization.
- **Tests trustworthy:** Tests prove records and fixtures, not specimen suitability or canon admission.

### 30. Production UI and accessibility shell

- **Canonical owner:** Renderer consumes observer-safe projections; it owns no simulation truth.
- **Implementation evidence:** ACTION, communications, mission, team, inventory, layout, evidence, and return surfaces are wired in `desktop/renderer/renderer.js:120–141`; theme, text scale, reduced motion, and guidance controls at `:181`.
- **Ordinary production reachability:** Yes.
- **Invariants served:** I1, I5, I6, I7.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** One coherent operations shell exists, but comprehension, screen-reader quality, long-session comfort, and machine-friction acceptance lack human proof.
- **Dependency or conflict:** Duplicate/stale renderer functions and the compressed deployment path reduce trust.
- **Minimum production-UI proof:** A stranger completes the reference run without internal IDs, incantations, unexplained errors, or tester intervention.
- **Tests trustworthy:** DOM and interaction tests are useful; human usability evidence is absent.

### 31. Audio

- **Canonical owner:** No authoritative runtime audio system exists.
- **Implementation evidence:** `desktop/renderer/audio.js` creates short oscillators; it is loaded by `index.html` but no production call site invokes `YBAudio.play`.
- **Ordinary production reachability:** No meaningful audio path.
- **Invariants served:** None required for specimen acceptance.
- **Status:** **obsolete**
- **Disposition:** **BURN**
- **Reason:** The stub is neither causal audio nor needed by the specimen.
- **Dependency or conflict:** Elaborate audio is explicitly excluded from the specimen.
- **Minimum production-UI proof:** None for this milestone.
- **Tests trustworthy:** No.

### 32. Locked alternate modes and legacy worldpack breadth

- **Canonical owner:** Historical worldpack/tooling architecture only.
- **Implementation evidence:** LOST, Beck’s Desk, and Nullzone remain registered but unavailable in `data/worldpacks/registry.json`; renderer blocks all non-Clear-Q4 entry at `desktop/renderer/renderer.js:90`.
- **Ordinary production reachability:** No.
- **Invariants served:** None.
- **Status:** **obsolete**
- **Disposition:** **BURN**
- **Reason:** They consume verification and migration surface while contributing nothing to the specimen.
- **Dependency or conflict:** Removal requires a later save/tooling migration proof.
- **Minimum production-UI proof:** None; they should not appear as specimen dependencies or release evidence.
- **Tests trustworthy:** Their tests may preserve historical behavior but are not Yellow Beast production evidence.

### 33. Duplicate renderer and legacy phase surfaces

- **Canonical owner:** None; presentation duplication only.
- **Implementation evidence:** duplicate `compactLayout` declarations at `desktop/renderer/renderer.js:115–116`; unused legacy `preField`/`field` surfaces at `desktop/renderer/surfaces.js:73–89`, while production uses `operationalField` at `:114–124`.
- **Ordinary production reachability:** The later duplicate shadows the first; legacy surface functions are not selected.
- **Invariants served:** None.
- **Status:** **obsolete**
- **Disposition:** **BURN**
- **Reason:** They create false implementation evidence and make UI tests easier to satisfy against unreachable markup.
- **Dependency or conflict:** Removal must first prove no package smoke, stale test, or compatibility consumer imports them.
- **Minimum production-UI proof:** Production rendering remains unchanged after a later controlled removal pass.
- **Tests trustworthy:** Tests matching unreachable strings are not production evidence.

### 34. Career, offline progression, succession, and death presentation

- **Canonical owner:** Gameplay Constitution; runtime split among career, personnel, outcome, and lifecycle modules.
- **Implementation evidence:** bounded explicit `ADVANCE_OPERATIONS` at `desktop/service.js:379–388`; player death still retires the world through `persistTerminalRetirement`; same-world successor helper exists but is dormant.
- **Ordinary production reachability:** Limited career advancement is reachable; ratified offline progression and succession are not.
- **Invariants served:** Outside the specimen.
- **Status:** **conflicting**
- **Disposition:** **FREEZE**
- **Reason:** These are later campaign systems and currently conflict with ratified lifecycle authority.
- **Dependency or conflict:** Require V05, canonical time, scheduler, personnel, and long-horizon passes.
- **Minimum production-UI proof:** None for the Reference Expedition.
- **Tests trustworthy:** Existing lifecycle tests prove obsolete whole-world-retirement behavior, not the ratified model.

### 35. Build, packaging, and current production artifact

- **Canonical owner:** Build scripts and native verification authority.
- **Implementation evidence:** build/package scripts exist and the aggregate passed; prior packaged evidence is stamped from `33017ea…`.
- **Ordinary production reachability:** Source is launchable through development; no certified current V03/HEAD artifact is evidenced.
- **Invariants served:** Acceptance boundary for all invariants.
- **Status:** **partial**
- **Disposition:** **KEEP**
- **Reason:** The build pipeline is necessary, but an old artifact cannot certify current persistence or specimen behavior.
- **Dependency or conflict:** Requires V03-governed source certification before native proof is meaningful.
- **Minimum production-UI proof:** Package current HEAD in an isolated profile and complete all reference runs offline without touching the production profile.
- **Tests trustworthy:** Aggregate packaging contracts are trustworthy for their scope; historical native evidence is stale for current HEAD.

### 36. Break scoring and human acceptance

- **Canonical owner:** Reference Expedition acceptance boundary; no implementation owner exists.
- **Implementation evidence:** No active production harness records agency, knowledge, continuity, tone, institutional, human, and friction breaks.
- **Ordinary production reachability:** No.
- **Invariants served:** All.
- **Status:** **missing**
- **Disposition:** **SIMPLIFY**
- **Reason:** The specimen needs a small, explicit review record, not a broad analytics or telemetry system.
- **Dependency or conflict:** Must remain external or presentation-only and cannot mutate the world.
- **Minimum production-UI proof:** Three contrasting runs and at least one stranger playtest receive complete break classifications with reproducible build/seed/profile provenance.
- **Tests trustworthy:** None.

---

## 1. Smallest dependency spine for the specimen

1. **Close verification authority around V03.**
   Register the committed V03 tests, resolve their known-defect status, and produce truthful exit semantics.

2. **Certify canonical normalization and paired commits.**
   Prove exact reopen equivalence, read purity, migration idempotence, and interruption recovery.

3. **Establish one minimum personnel replay contract.**
   One owner must preserve identity, role, knowledge, task, custody, condition, memory, and post-run delta for the four specimen participants.

4. **Separate recovery from player checkpoint behavior.**
   Remove the generic previous-save rollback from the specimen path and prove sanctioned persistence boundaries.

5. **Add one bounded Reference Expedition configuration.**
   Fixed route, fixed four-person roles, fixed overlap discrepancy, fixed mission, no-variance seed, and tightly limited variance package.

6. **Replace the collapsed deployment shortcut.**
   Make preparation, accountability, radio, and crossing meaningfully playable.

7. **Complete one compound agency contract and minimum human LOCAL behavior.**
   No generalized autonomous-mind expansion is required.

8. **Complete the evidence-to-belief chain.**
   Observation → evidence → report → delivered institutional input → provisional belief, with omission and contradiction preserved.

9. **Run three contrasting production-UI expeditions offline.**
   Investigate/document; report/return early; ignore/omit.

10. **Package current HEAD and perform human acceptance.**
    Score all required break classes and verify 35–60 minute work-first play.

## 2. Ten highest-risk gaps

1. V03 is committed but outside verification governance and remains uncertified.
2. `persistSession` still performs multi-domain simulation and ownership reconciliation during save.
3. The exact overlapping-corridor discrepancy does not exist.
4. Ordinary production skips meaningful staging and compresses the Threshold ritual into `DEPLOY`.
5. Personnel truth remains split between world characters, run members, continuity state, and events.
6. No compound coworker-plus-player instruction executes both sides.
7. LOCAL broadcasts targeted speech, encourages universal response, and lacks trustworthy human/silence proof.
8. Institutional cognition remains divided among several stores, weakening evidence-to-belief causality.
9. Generic previous-save restore and whole-world death retirement conflict with ratified lifecycle/checkpoint law.
10. No current packaged build or human production-UI run proves the Reference Expedition.

## 3. Systems that must receive zero further investment

Until the Reference Expedition passes:

- Still Life, Bacteria, and all other entity behavior;
- new phenomenon families or broader anomaly ecology;
- broad procedural geography expansion;
- additional mission families;
- long-horizon offline progression;
- same-world succession and career breadth;
- deep facility simulation beyond the specimen’s deployment needs;
- full onboarding cinematics;
- audiovisual polish and the oscillator audio stub;
- evidence-image provider expansion;
- OpenAI/provider enrichment;
- alternate modes: LOST, Beck’s Desk, and Nullzone;
- second-worldpack portability;
- campaign progression, standing, privileges, promotion, and management breadth;
- deep separation, panic, injury, death, or pursuit systems;
- archive breadth beyond the specimen’s returned evidence and debrief;
- renderer polish unrelated to comprehension of the reference operation.

## 4. Unresolved authority conflicts

### Active-document conflicts

1. `docs/YELLOW_BEAST_VISION_PASS_MAP.md` says V02 is active and V03 remains prohibited, while V03 runtime work is committed at `c60f362`.
2. `docs/IMPLEMENTATION_STATE.md` still describes V02 as current and V03 equivalence as an open defect.
3. The Specimen Brief still says “current uncommitted V03 persistence work,” while Git and the Invariants correctly identify it as committed but uncertified.
4. Verification governance does not register the committed V03 test file, yet the repository inventory reports no unexplained tests because the file does not use the governed `*.test.js` naming convention.

### Runtime conflicts with settled authority

5. Generic previous-good restoration conflicts with sanctioned checkpoint and metagame-reload rules.
6. Player death still triggers whole-world retirement, conflicting with same-world career succession authority.
7. Save-time phenomenon materialization and institutional/personnel synchronization conflict with neutral serialization.
8. Per-action autosave presentation still blurs canonical commits, crash recovery, session state, and player saves.
9. World/run personnel, geography, and institutional stores remain competing canonical candidates.
10. Current staffing allows three to five participants, while the bounded specimen requires exactly four.
11. The ordinary `DEPLOY` shortcut conflicts with the milestone’s required staging and Threshold ritual.
12. Named phenomenon behavior remains implemented or fixture-reachable without complete Kane-primary admission; it must remain outside the specimen.

No higher-order authority requires entities, audiovisual expansion, campaign breadth, or broad refactoring for this milestone.

## 5. Recommended first implementation pass

### V03 Certification and Authority Closure

**Objective:** certify or reject the committed `c60f362` persistence checkpoint before any Reference Expedition gameplay work.

**Exact scope:**

- bring `tests/v03-persistence-foundation.js` under verification governance;
- assign it an explicit tier and governed content identity;
- run the complete V03 acceptance set with truthful exit status;
- verify canonical equivalence, normalization idempotence, read purity, paired rollback, legacy migration, and current packaged reopen;
- keep the known V03 defect open unless every exit criterion passes;
- update the current-orientation documents only after certification;
- make no gameplay, UI, personnel-depth, phenomenon, audio, mission-breadth, or provider changes.

**Exit condition:** the repository can truthfully state whether V03 is accepted, with no gap between committed code, verification authority, current-pass authority, and production reopen evidence.