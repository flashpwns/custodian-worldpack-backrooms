# Yellow Beast 1.0 Vision-Centric Campaign

**Authority status:** Historical Phase 01B adversarial evidence. It does not define current product law or campaign scope. Its unresolved authority conflicts were adjudicated in Phase 01C and reconciled by V01; use `docs/YELLOW_BEAST_CURRENT_BASELINE.md` and `docs/YELLOW_BEAST_VISION_PASS_MAP.md` for current orientation.

## Phase 01B — Independent Reconciliation Challenge

**Mode:** read-only adversarial review
**Implementation authority:** none
**Baseline:** `agent/pass-10-release-candidate` at `33017ea0c3ff4184f472f736619c6620c4a8578b`
**Review date:** 2026-08-11
**Challenged artifact:** `docs/VISION_RECONCILIATION_LEDGER.md`

This document is a challenge to Phase 01A, not a replacement implementation plan. It records source, runtime, and test evidence. No production source or test was changed during this review.

## 1. Executive adversarial verdict

The Phase 01A macro-conclusion survives: this repository is a substantial deterministic field-operations prototype, not the continuously living workplace described by the current Gameplay Constitution. The action-coupled clock, collapsed preparation flow, bounded between-operation button, shallow personnel, absent facility life, incomplete career model, and silent/panel-driven renderer are all real.

The ledger is not ratifiable unchanged. It is directionally strong but materially overconfident in several `COMPLETE` and `KEEP` classifications, imprecise about the reproduced long-world failure, and missing two lifecycle/persistence defects more serious than the failure it did report.

The most important corrections are:

1. **The long-world torture failure is real, but Phase 01A overstates what it proves.** The reproduced mismatch is a one-time schema-normalization/migration difference: `q4_evidence_archive` is inserted and `q4_phenomenon_ecology: null` is replaced with a conservative default. A second and third save/reload are equivalent. No event loss, event reorder, random drift, or accumulating causal divergence was reproduced. Exact first-load equivalence is broken; long-world canonical history corruption was not established.
2. **A separate personnel persistence defect was missed.** `persistSession` can mutate `world.characters[*].condition` and emit `q4.personnel.condition.changed`, but `world-history.loadWorld` rebuilds the character index from `character.*` events and ignores that Q4 event. A direct reproduction changed a character from `minor injury` before save to `normal` after reload while retaining the ignored event. This is duplicated authority and genuine state loss.
3. **Retirement is not immutable through every service path.** A fatal fixture retired a world, then `restoreBackup({confirmed:true})` restored the previous active canonical save, after which `resumeSession` succeeded. This conflicts with Doctrine and contradicts the stronger meaning implied by the retirement tests. The ordinary renderer currently creates no Restore button, so this is an exposed service/preload invariant failure and an unreachable UI handler—not an implemented constitutional reload choice.
4. **Provider safety is overclaimed.** The natural-language provider receives an `authority_context` assembled from up to 48,000 characters of the full Simulation Doctrine plus worldpack/domain documents. That payload contains internal terms including “Still Life” and “Bacteria.” Provider clarification text is returned to the renderer without terminology validation. A hostile deterministic provider reproduced a player-facing clarification, “Do you mean the Still Life?” Canonical writes remain locally bounded, but observer knowledge and output terminology do not.
5. **Several `COMPLETE` claims need narrowing or downgrading.** R07 STANDARD is `PARTIAL` under the living Constitution; R15 institutional non-omniscience is `PARTIAL`; R38 observer-safe terminology is `BROKEN` on the optional provider path; R39 provider/interpreter authority is `PARTIAL`. R05 speech authorship, R12 bounded persistent geography, R19 mission freedom, and R43 current Windows packaged launch remain supportable only at their stated narrow scopes.
6. **Personnel is not merely an additive extension.** The stable world character, the per-run team member, generated tendencies/qualifications, and several histories do not have a single replay-safe owner. Richer memories, relationships, emotion, motives, promotions, discipline, leadership, and offline behavior would multiply this split. Owner consolidation and migration are prerequisites; “extend the schema” is too generous.
7. **Rare production phenomenon creation already works.** Deterministic seed searches and ordinary spatial expansion/materialization produced both a Still Life-family record and a Bacteria-family record without developer fixture controls. Phase 01A was too pessimistic about creation reachability, but correct that the meaningful initiating behavior remains fixture-dominant and canon admission is unresolved.
8. **The official verification gate is demonstrably false-green.** `npm test` ran 69 of 101 `.test.js` files and exited 0 while the omitted `y33-long-world-torture.test.js` failed. Three report tools print internal verdict fields without making failure control process exit status. Test names and historical pass summaries are therefore insufficient evidence.

The architectural consequence is deeper than “add a scheduler.” Domain algorithms are reusable, but the current top-level transaction model reconciles and mutates canonical truth during autosave, while sessions and the world duplicate geography, personnel, institution, equipment, and phenomenon state. Calling these authorities from a continuous/offline scheduler before ownership and replay are reconciled would create more competing truth sources.

## 2. Phase 01A claims independently confirmed

The following claims survived source tracing and targeted execution. “Confirmed” here does not expand their scope.

| Ledger claim | Independent verdict | Direct evidence | Qualification |
|---|---|---|---|
| R01 — current game is a persistent field-operations prototype, not a living workplace | `PARTIAL`, confirmed | `desktop/service.js`, `tools/run-bootstrap.js`, `tools/operational-cycle.js`, renderer surfaces | Sophisticated state is present, but almost all change waits for an explicit call. |
| R03 — no independent production scheduler | `MISSING`, confirmed | `tools/operational-time.js`; calls to `operationalCycle.resolve`; repository search for timers | Timers found in boot, smoke, provider timeout, and evidence rendering are not canonical scheduling. |
| R05 — player-authored speech is separate from ACTION | `COMPLETE` at the narrow authorship boundary | `submitQ4Communication`, rejection of generic ACTION communication, rendered LOCAL/STANDARD composers, y61 coverage | LOCAL recipient semantics have a separate defect; that does not rewrite player speech. |
| R12 — bounded persistent procedural geography | `COMPLETE` at current bounded scope | `tools/spatial-runtime.js`, `tools/survey-frontier.js`, `world.q4_geography`, y56 focused pass | Preserve generator/projection semantics, not the duplicated `run.spatial`/world/legacy owner topology. |
| R19 — objectives do not impose invisible movement walls | `COMPLETE` at current mission scope | spatial actions and mission runtime permit deviation, return, and abort | Career consequences remain absent, as Phase 01A stated. |
| R26 — between-operation processing is bounded and player-triggered | `CONFLICTING`, confirmed | `ADVANCE_OPERATIONS`; `tools/q4-career-loop.js` explicitly calls itself a shift processor, not background simulation | No close/reopen elapsed-time reconciliation or hidden real-time advancement was found. |
| R27/R37 — lifecycle authorities conflict | `CONFLICTING`, confirmed and strengthened | Doctrine §19; Design Charter; Gameplay Constitution; `q4-outcome-authority`; `selectSuccessor`; session guards | The backup path adds a missed contradiction; see sections 6 and 10. |
| R31 — Kane-canon closure is not evidenced | `UNVERIFIED`, confirmed | 18 source-registry entries, only 2 verified-primary records, explicit input gaps and warnings | `runtime_authority_complete: true` is a tracking assertion, not substantive source proof. |
| R36 — accepted field activity autosaves | `CONFLICTING`, confirmed | all action/communication/logistics/handoff persistence call sites; UI autosave copy; y26 | Current runtime encodes the opposite of the Constitution’s declared field save boundary. |
| R40 — renderer remains dense, panel/menu driven, with broken refresh | `PARTIAL`, confirmed | `desktop/renderer/renderer.js`, `surfaces.js` | The refresh guard compares a world ID with a mode ID and discards a valid result. |
| R41 — backend settings exceed UI settings | `BROKEN`, confirmed | `DEFAULT_SETTINGS`, settings form and submit object, y54/y57 | Audio, reduced sensory, reopen-last-world, small text, and light theme are not ordinary controls. |
| R42 — audio is effectively absent | `MISSING`, confirmed | `audio.js` is loaded but `YBAudio` is never invoked; package excludes `docs/**/*` | Four oscillator definitions are an uncalled stub; referenced MP3s are documentation inputs, not packaged runtime assets. |
| R43 — packaged/native launch viability | `COMPLETE` for the current exact Windows artifact | `npm run desktop:verify`; `verify-first-run-artifact.js` | External machines, signing, portability, human use, and the prior same-HEAD GPU failure remain unverified/environment-sensitive. |
| R44 — official verification is untrustworthy | `BROKEN`, confirmed | 101 total files, 69 aggregate members, 32 omissions; omitted y33 fails; report exit behavior | No explicit exclusion registry explains the omissions. |

The mission-freedom, geography, speech-authorship, evidence provenance, equipment custody, channel-state, and packaged-profile-isolation implementations are real capabilities. Their existence does not imply that the current player experience satisfies the living-workplace Constitution.

## 3. Phase 01A claims downgraded

Each row identifies the exact ledger claim, the contradicting evidence, the corrected classification, and the architectural consequence.

| Exact Phase 01A claim/classification | Why it fails the challenge | Corrected classification | Architectural consequence |
|---|---|---|---|
| **R07 — “STANDARD is bounded, fallible institutional communication” — `COMPLETE`** | The queued/transmitting/delayed/delivered/acknowledged/failed channel machine is real and ordinary-player reachable. However, progress is action-coupled, institutional decisions live in a separate runtime, operator continuity is a shallow contact counter, and the living Constitution’s ongoing fallible workplace communications are not present. Direct tests establish channel transitions, not continuous institutional cognition or a broad response repertoire. | `PARTIAL` overall; the channel-delivery sub-contract is `COMPLETE` | Preserve the channel state machine, but do not preserve its current scheduling and multi-store ownership as the complete STANDARD authority. |
| **R15 — “Institutional knowledge provenance and non-omniscience” — `COMPLETE`; “Raw objective truth is not passed to Standard or provider context.”** | Delivered-message provenance and confirmed/uncertain distinction are real for STANDARD. The provider statement is false: `ai-adapter.executeNatural` adds the registry’s `authority_context`; `authority-registry.assemble` includes a 48,000-character Doctrine slice plus domain documents. The observed payload was about 131,312 characters and contained internal phenomenon names. Institution-related state is also split among `world.knowledge.institutional.records`, `world.institutional_response`, Q4 knowledge, operator contacts, survey frontier data, and evidence/report records. | `PARTIAL` | Keep provenance rules; repair provider disclosure and consolidate institutional ownership before continuous/offline processing. |
| **R22 — persistent relationships/memories/etc. — `PARTIAL` with treatment `EXTEND`** | The existing state is mostly operational logs, bounded salience, hash-derived tendencies, role-derived qualifications, and capped shared/reaction histories. It has no relationship, emotional, fear, preference, motive, promotion, discipline, or retirement model. More importantly, a reproduced Q4 personnel condition does not replay after reload. | `SCAFFOLDED`, with a `BROKEN` replay seam | A migration and single canonical personnel owner are required before the foundation is safely extensible. |
| **R38 — “Observer-safe terminology and canonical identity separation” — `COMPLETE`** | Structured phenomenon projections generally use safe aliases. The optional natural-input path can expose forbidden terms in provider clarification because the provider receives internal authority documents and `validateIntent` schema-checks the clarification but does not terminology-check it. `player-turn` returns it directly and the renderer displays it. A mock reproduced “Do you mean the Still Life?” | `BROKEN` for provider-assisted play; `COMPLETE` only for the structured phenomenon projection sub-path | Provider input minimization and validation/fallback must cover every player-facing string class, including clarification—not only scene narration. |
| **R39 — “Provider/interpreter is bounded presentation, never simulation authority” — `COMPLETE`** | The no-canonical-write portion survives: canonical action resolution and scene validation remain local. The broader boundary does not: the context is not observer-minimal and provider clarification bypasses terminology/grounding validation. “Never simulation authority” is true for writes but incomplete for knowledge and player-facing assertions. | `PARTIAL` | Preserve local canonical resolution and deterministic fallback; repair or replace context assembly and validate all candidate output paths. |
| **Section 5.1 — “World history and canonical authority separation” should remain authoritative** | `persistSession` mutates several canonical indexes directly and appends only some corresponding events. `loadWorld` rebuilds some indexes from events but not Q4 personnel condition events. Save validation migrates a temporary object and then discards that migrated object. World and session copies are reconciled at save. This is not a clean authority separation. | `CONFLICTING` as an architectural whole; individual IDs/events remain valuable | Preserve event identity and useful records, but the replay/owner/consolidation layer requires replacement or substantial repair before it can host a living scheduler. |
| **Section 5.2 — observer-safe projection is safe to preserve as a whole** | Public projection modules are valuable, but the provider registry overlays internal documents after the observer-safe context is built. Q4 team projection also strips stable personnel identity before the renderer attempts to use it. | `PARTIAL` | Preserve individual public projections only after auditing every consumer and overlay; do not designate the whole existing pipeline authoritative. |
| **Section 5.12 — atomic save/recovery design should be preserved, subject only to long-world defect** | Previous-good recovery is useful, but `restoreBackup` has no retirement guard. The fatal-save sequence leaves an active predeath world as previous-good, and restoring it revives the world. The save operation also performs canonical reconciliation and phenomenon materialization, so “save” is not merely an atomic serializer. | `PARTIAL` with a `BROKEN` lifecycle invariant | Preserve isolated-profile and damaged-primary recovery concepts; separate validation/recovery from canonical advancement and legislated checkpoint/rewind behavior. |

These downgrades do not erase working subsystems. They prevent a correct sub-contract from being promoted into a false claim about the complete production path.

## 4. Phase 01A claims upgraded

Phase 01A was also too harsh or too broad in three places.

### 4.1 R35 long-world persistence: narrower failure than reported

Phase 01A classified deterministic save/reload as globally `BROKEN` and said “a long-lived world can diverge across serialization.” The exact equivalence assertion is broken, but the reproduction does not prove ongoing simulation divergence.

The first load changes only migration/default shape:

- missing `q4_evidence_archive` is built from existing evidence;
- `q4_phenomenon_ecology: null` becomes a conservative state whose existing locations are ordinary and which records `migrated_conservatively: true`;
- JSON naturally removes `undefined` properties, but those did not create an additional semantic comparison difference after JSON normalization.

The event count and sequence remained unchanged. Pre-save versus first load was unequal; first-to-second and second-to-third save/load were equal. The report remained `deterministic: true`, `save_reload_equivalent: false`, `passed: false`.

**Corrected classification:** `PARTIAL`, with **exact first-load equivalence `BROKEN`**. It is critical because migration and persistence contracts are foundational, not because this evidence demonstrates causal-history corruption. A different, independently reproduced personnel replay defect is the stronger state-loss finding.

### 4.2 R29/R30 production creation reachability

Phase 01A correctly called active behavior fixture-dominant, but ordinary production can instantiate both families. A deterministic seed search found:

- seed `reach-33089`: Still Life-family eligibility at expansion ordinal 11, roll 106;
- seed `reach-1223820`: Bacteria-family eligibility at expansion ordinal 12, roll 109.

Normal `spatial.expand` followed by production `materializeEligible` created persistent records for both without `controlQ4PhenomenonFixture`. LOOK can observe them, ordinary speech can be learned by an existing Bacteria record, and the operational cycle advances already-active behavior.

What remains missing is ordinary initiation: no normal player/runtime path calls the Still Life stimulus operation, Bacteria target acquisition, mimic start, slam, spatial contradiction application, object displacement, or acoustic emission. Production creation is therefore `PARTIAL`, while active encounters remain `SCAFFOLDED`/`CONFLICTING` and source admission remains unresolved.

### 4.3 Current artifact viability

R43 was not merely inherited from Phase 01A. The exact current artifact independently passed packaged offline smoke, renderer interaction, native first-run create/reopen, commit match, test-profile cleanup, and production-profile hash preservation. This supports `COMPLETE` only for current automated Windows launch viability. It does not upgrade portability, signing, stranger use, or human interaction gates.

## 5. Misclassified preservation/replacement recommendations

| Phase 01A recommendation | Challenge result | Corrected treatment |
|---|---|---|
| Preserve world history/canonical authority separation | Persistent IDs, events, and retirement records are valuable, but direct indexes and event replay disagree; save performs domain work. | Preserve data semantics selectively; **replace/repair ownership and replay orchestration**. |
| Preserve provider/interpreter contract | Local resolution, schema validation, and deterministic fallback are valuable. Authority-context assembly and clarification output violate observer minimization. | **Split treatment:** keep local no-write authority; replace/repair provider input/output boundary. |
| Preserve STANDARD/communication state machine | Channel delivery semantics are useful. Operator, institutional knowledge, evidence ingestion, and decisions are split and action-scheduled. | Keep channel transition core; **consolidate owners and scheduler integration**. |
| Preserve institutional cognition | Confirmed/uncertain provenance is valuable. Multiple overlapping stores can diverge under continuous/offline mutation. | Preserve concepts and record provenance; **do not freeze current storage topology**. |
| Preserve persistent geography | Generator, frontier, and observer survey behavior are useful. `run.procedural`, `run.spatial`, and `world.q4_geography` coexist; generic ingestion still promotes legacy procedural regions. | Keep deterministic generation/projection rules; **replace duplicated authority/migration topology**. |
| Extend NPC/personnel foundation | Current tendencies and histories are too shallow, and condition replay is broken. Run members and world characters duplicate state. | **Migrate/consolidate before extension**; some generated tendency/qualification helpers may remain. |
| Preserve atomic save/recovery subject to long-world fix | Recovery can undo retirement, and persistence performs canonical side effects. | Keep damaged-file preservation and profile isolation; **separate recovery, serialization, canonical commit, and any legislated checkpoint semantics**. |
| Replace action-coupled top-level cycle with continuous scheduler | Direction is correct, but “replace the top-level loop” understates coupling. Domain state is in session and world, then reconciled on save. | Replacement boundary must include **authority consolidation and transaction semantics**, not only timer introduction. |
| Extend phenomenon state machines into production | Creation is already production-reachable; initiation is not. Behavior also conflicts with admitted canon data. | Preserve no behavior as product truth until authority is reconciled; retain code only as **diagnostic/contested implementation evidence**. |
| Preserve immutable retirement | Doctrine supports it, but current recovery service does not enforce it and the current Constitution contradicts it. | Record as an **unresolved authority conflict plus a runtime invariant defect**; do not call current implementation complete. |

This is not an implementation roadmap. It states which Phase 01A preservation assumptions are unsafe as baseline facts.

## 6. Missed architectural conflicts

### 6.1 Save is also a canonical reconciliation processor

`DesktopService.persistSession` does more than serialize. It reconciles institutional revision, points a run at a world, synchronizes equipment and trajectories, appends environmental history, copies Q4 geography, materializes eligible phenomena, copies object state, synchronizes personnel, ingests STANDARD messages into multiple authorities, updates evidence/survey frontier, writes the session, and writes the world.

Consequently, canonical autosave, crash recovery, session snapshot, world-state commit, materialization boundary, and any future metagame checkpoint are presently conflated. A continuous scheduler cannot safely treat save as a neutral persistence call.

### 6.2 Personnel has duplicated canonical candidates

The world character record owns identity, role, clearance, condition/status, assignment, history, and continuity. The per-run team member separately owns health, condition/status, current task/intent, communication and movement histories, known information, equipment, and observer-contact state. `syncPersonnel` reconciles a subset. Rich personnel state would have no unambiguous home, and the replay defect proves the split is already lossy.

### 6.3 Retirement and recovery implement mutually defeating invariants

Outcome authority atomically marks retirement and service entry guards reject retired worlds. The recovery API can replace that canonical file with the active previous-good file. Both behaviors have passing tests in isolation; no test composes them. This is a contradictory lifecycle, not merely an absent succession screen.

### 6.4 Provider write authority is bounded but knowledge authority is not

The pipeline begins with observer-safe state and then appends broad internal authority documents. This contradicts the required projection-first, bounded-generation boundary. A provider that cannot write canonical state can still disclose hidden truth or frame a player choice with an unauthorized canonical name.

### 6.5 Institutional cognition is distributed across overlapping stores

Communication runtime, institutional runtime, Q4 STANDARD operator, evidence authority, survey frontier, and world knowledge records each retain related facts. The split is manageable when only explicit player actions invoke reconciliation. It becomes a duplicated-truth hazard when autonomous people, background decisions, deliveries, evidence analysis, and offline scheduling can update independently.

### 6.6 Current and historical mode contracts coexist in production service code

The UI marks `async-command`, `local-anomaly`, and `lost` unavailable, but `startSession` still accepts them. The packaged smoke deliberately starts and acts in all four modes. Thus “unavailable historical mode” and “required packaged smoke feature” are competing product meanings.

### 6.7 Canonical source admission conflicts with project-internal phenomenon truth

The Doctrine and Design Charter describe Still Life/Bacteria behavior as project reality, while the verified-primary registry admits no entity behavior and `still-life-behavior-authority.json` explicitly prohibits generalizing appearance, movement, perception, pursuit, or harm. The Constitution repeats desired behavior but is not Kane-primary evidence. The repository therefore has internal constitutional authority for code and inadequate external canon provenance for the claimed Kane-faithful product at the same time.

## 7. Missed dead/duplicate machinery

| Pathway | Classification | Evidence and consequence |
|---|---|---|
| `run.spatial` in current Clear-Q4 operations | **ACTIVE PRODUCTION** | Drives ordinary Q4 geography, team locations, actions, and presentation. |
| `world.q4_geography` | **ACTIVE PRODUCTION / DUPLICATED AUTHORITY** | Persistent current topology is copied between run and world during persistence rather than owned by a single live authority. |
| `run.procedural` | **MIGRATION SEAM / DUPLICATED AUTHORITY** | Still serialized and referenced by generic action/scene code. `world-history.ingestRun` promotes legacy procedural regions while current Q4 geography follows a separate path. |
| READY/PROCEED/APPROACH/CROSS prefield sequence | **LEGACY BUT REQUIRED** | Service and tests retain it for older sessions; current renderer offers `DEPLOY`, which collapses the sequence. Some green tests exercise the legacy path rather than the ordinary current UI. |
| `async-command`, `local-anomaly`, `lost` | **UNREACHABLE** from ordinary mode selection; **LEGACY BUT REQUIRED** by service/smoke/tests | Registry/UI lock them, but DesktopService and packaged smoke still execute them. |
| `selectSuccessor` | **UNREACHABLE** | Exists and has isolated coverage, but retired-world guards reject entry and player creation returns the existing controlled record. |
| `controlQ4PhenomenonFixture` and active threat controls | **DEVELOPER FIXTURE** | Useful diagnostic evidence; not ordinary encounter initiation. |
| `restore:` renderer click handler | **UNREACHABLE** in current renderer markup | Preload/service expose restore and the handler exists, but the world library emits no Restore button. It is not a deliberate player lifecycle choice. |
| First of two adjacent `compactLayout` definitions | **OBSOLETE** | The second function declaration replaces the first before use. This is dead renderer source. |
| Q4 visual portrait identity versus renderer team mapping | **DUPLICATED PRESENTATION AUTHORITY** | The service strips `id`/`personnel_id` from safe team entries; the renderer falls back to `portrait-unknown`. A separate visuals module can derive portraits but the active renderer does not consume its stable identity output. |
| Old pass roadmaps/prompts and y34/y35 expectations | **OBSOLETE as current authority; LEGACY BUT REQUIRED as history** | They remain useful provenance but cannot prove the vision-centric product. |

No deletion or cleanup is authorized by this classification.

## 8. Missed player-facing failures

Phase 01A correctly described the renderer as dense and panel-driven, but missed or understated these observable failures:

1. **Every current Q4 teammate portrait can collapse to `portrait-unknown`.** `q4SafeTeam` strips stable IDs, while `surfaces.js` asks for `personnel_id ?? id ?? "unknown"`. This weakens the promised persistent-coworker recognition even when the backend roster is stable.
2. **Targeted LOCAL statements are heard by every local eligible coworker.** The target parser exists, but the successful ordinary statement path records all in-range peers as recipients. This overstates selective address and makes a directed statement a local broadcast.
3. **The known blank/silence presentation remains real.** Joining an all-silent response array can yield whitespace and bypass a meaningful silence fallback.
4. **Refresh is nonfunctional.** The renderer accepts a valid projection only if `requestContext().worldId === context.mode`, normally an impossible comparison.
5. **Settings advertise backend capability that the player cannot control.** Reduced sensory, audio mute/mix, reopen-last-world, small text, and light theme exist in service defaults but are absent from the form and submit transaction. `reopen_last_world` is not consumed elsewhere.
6. **Audio is effectively silent.** The included WebAudio chirp object has no invocation path, and no licensed/admitted runtime audio assets are packaged.
7. **Death, succession, and rewind have no ordinary presentation.** Fatal player outcome is a fixture; successor is unreachable; restore has no generated button; no CRT shutdown, cover story, or legislated choices exist.
8. **Naturally created phenomena are behaviorally shallow.** A rare entity may materialize and be observed, but ordinary play does not initiate the advertised Still Life reactions or Bacteria target/mimic/pursuit/slam chain.
9. **The game remains click-forward.** The renderer exposes explicit action buttons; `DEPLOY` collapses prefield stages; `ADVANCE_OPERATIONS` manually advances the only between-operation processor; coworkers and environment progress only when a later player action pays a cycle cost.
10. **UI tests often prove source structure, not experience.** Several assert selector strings or regexes. Native smoke proves Settings can open/save/reopen, not that an expedition is comprehensible, visually correct, audible, or behaviorally alive.

The backend is more sophisticated than the experience it produces. That distinction should be explicit in the ratified baseline.

## 9. Test/verification trust assessment

### 9.1 Exact inventory and aggregate membership

Recursive expansion found **101** `.test.js` files. The `npm test` command names **69** files. It omits **32**:

`profile-model.test.js`, `run-bootstrap.test.js`, `y21-lost.test.js`, `y30-accessibility.test.js`, `y31-authoring.test.js`, `y31-dev-commands.test.js`, `y31-dev-console.test.js`, `y31-dev-workflow.test.js`, `y32-consequence-echoes.test.js`, `y32-discovery-density.test.js`, `y32-replayability.test.js`, `y32-unfinished-business.test.js`, `y33-long-world-torture.test.js`, `y33-stranger-flow.test.js`, `y34-beta-hotfix.test.js`, `y35-product-focus.test.js`, `y54-settings-regression.test.js`, `y55-survey-frontier.test.js`, `y56-persistent-procedural-complex.test.js`, `y57-desktop-prerequisite-repair.test.js`, `y58-assignment-engine.test.js`, `y59-career-loop.test.js`, `y60-personnel-continuity.test.js`, `y61-local-standard.test.js`, `y62-evidence-archive.test.js`, `y62-pass17-human-gate.test.js`, `y63-evidence-media.test.js`, `y63-pass17-state-machine.test.js`, `y64-environment-simulation.test.js`, `y64-pass17-authority.test.js`, `y65-phenomenon-ecology.test.js`, and `y66-outcomes-retirement.test.js`.

Some omitted areas have focused scripts, but there is no explicit inclusion/exclusion manifest or status taxonomy. The official aggregate is a hand-maintained historical list. Its omissions include both stale historical tests and the newest vision-era tests, so omission cannot be interpreted as a deliberate “non-authoritative only” policy.

The only normalized duplicate basename found was `y21-lost.test.js`/`y28-lost.test.js`; they are not identical evidence merely because their names overlap. y34/y35 contain superseded product/UI expectations. Locked modes and legacy prefield sequences retain broad coverage despite being unavailable in ordinary current play. Many current tests call domain functions or fixtures directly and therefore do not establish renderer/service reachability.

### 9.2 Commands executed and results

| Command or targeted reproduction | Result |
|---|---|
| `git status --short --branch`; `git rev-parse HEAD` | Baseline matched the known Phase 01A state: known `.gitignore` modification and untracked reconciliation documents only. |
| Recursive PowerShell expansion of `package.json` test arguments against `tests/**/*.test.js` | 101 total, 69 members, 32 omitted. |
| `npm test` | Exit 0; aggregate green; approximately 79.7 seconds. |
| Focused current group: y54, y56, y60, y61, y62 evidence, y63 media, y64 environment, y65 ecology, y66 outcomes | 56/56 subtests passed; exit 0; approximately 7.1 seconds. This establishes direct contracts, not all player reachability. |
| `node --test tests/y33-long-world-torture.test.js` | Exit 1; one failed test; internal report `passed: false`. |
| `node tools/yb33-torture-report.js` | Exit 0 while JSON said `deterministic: true`, `save_reload_equivalent: false`, `passed: false`. |
| Stranger-flow and replayability reports | Exit 0 with true internal verdicts. |
| Static audit of 55 `*report*.js` files | Three report scripts expose a `passed`-style verdict without setting failing exit status: yb33 torture, stranger flow, replayability. |
| `npm run desktop:verify` | Exit 0; exact artifact commit, offline smoke, renderer interaction, isolated profile cleanup, and 72-file production profile preservation passed. |
| `node tools/verify-first-run-artifact.js` | Exit 0; native create/reopen passed and production profile remained unchanged. |
| Inline Node long-world comparison across repeated save/load | First normalization unequal; subsequent rounds equal; no event-count/order change. |
| Inline Node personnel replay reproduction | `minor injury` before save became `normal` after load; ignored `q4.personnel.condition.changed` event remained present. |
| Inline Node fatal-retirement/restore reproduction | `RETIRED` became `ACTIVE` after confirmed backup restore; player status returned to active; session resume succeeded. |
| Inline provider-boundary inspection and hostile clarification reproduction | Authority payload contained internal names; unvalidated “Still Life” clarification reached player-turn output. |
| Deterministic phenomenon seed search plus ordinary expansion/materialization | Production Still Life and Bacteria records created without fixture controls. |
| Repository searches for timers, wall clocks, audio invocation, settings use, restore UI, legacy paths, and state owners | No independent canonical scheduler/offline elapsed reconciliation/audio invocation found; duplicate/dead paths documented above. |

### 9.3 Trust verdict

`npm test` is not a full-suite or release-truth command. A report tool is not a test unless its verdict controls process failure or a caller asserts it. A test named for personnel continuity, phenomenon ecology, retirement, or packaged readiness proves only the assertions and paths it actually exercises. Historical “all green” claims that relied on `npm test` or a report process returning 0 must be treated as `UNVERIFIED` until membership and verdict semantics are stated explicitly.

The targeted current group passing is still useful evidence. It demonstrates that the backend contracts are not imaginary. It does not cure missing aggregation, direct-fixture bias, cross-authority composition gaps, or pending human gates.

### 9.4 Files inspected

Authorities and audits:

- `AGENTS.md` instructions supplied for this repository
- `SIMULATION_DOCTRINE.md`
- `docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md`
- `docs/IMPLEMENTATION_STATE.md`
- `docs/YELLOW_BEAST_1.0_IMPLEMENTATION_ROADMAP.md`
- `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md`
- `docs/reconciliation/YELLOW_BEAST_VISION_CENTRIC_ROADMAP.md`
- `docs/reconciliation/YELLOW_BEAST_FULL_SUITE_AUDIT_2026-08-11.md`
- `docs/VISION_RECONCILIATION_LEDGER.md`
- `docs/GAME_READINESS_AUDIT.md`
- `docs/custodian-gap-audit.md`
- `docs/distribution-gap-audit.md`
- current UI, accessibility, QOL, UI-reference, and audio-usage authorities under `docs/`

Canon/provider contracts and data:

- `canon/SOURCE_POLICY.md`, `source-registry.json`, `verified-primary-sources.json`, `terminology.json`
- `data/context-closure.json`, `context-input-gaps.json`, `procedural-readiness.json`, `procedural-grammar.json`
- `data/still-life-behavior-authority.json`, `entity-definitions.json`, phenomenon and Clear-Q4 worldpack definitions
- `docs/canon-runtime.md`, `docs/ai-interface-contract.md`, provider/interpreter authority documentation

Runtime, renderer, packaging, and verification:

- `package.json`
- `desktop/main.js`, `preload.js`, `service.js`, profile/build/credential helpers
- `desktop/renderer/index.html`, `renderer.js`, `surfaces.js`, `audio.js`, styles
- world history, run bootstrap, operational time/cycle, spatial, survey, mission, communication, institution, STANDARD operator, personnel, equipment/logistics, evidence, environment, phenomenon, outcome, career, assignment, AI adapter/provider/scene, and developer-inspection tools under `tools/`
- desktop artifact, first-run, renderer, alpha, canon, and report verification tools
- all 101 test filenames were inventoried; aggregate/current/persistence/desktop/lifecycle/provider/phenomenon-relevant test bodies were inspected, including y26, y33, y34/y35, y41, y44, y54–y66, and provider/observer families

## 10. Persistence challenge findings

### 10.1 Exact cause of the y33 mismatch

`world-history.createWorld` currently leaves `q4_phenomenon_ecology` null and does not create `q4_evidence_archive`. `loadWorld` migrates both. `DesktopService.saveCanonical` writes the original world to a temporary file, loads the temporary file only to validate it, discards the migrated return value, and renames the unnormalized temporary file into place. Therefore a current newly saved world can remain pre-migration on disk and change shape on first load.

This is deterministic schema/default insertion. It is not ordering divergence, duplicated random authority, transient-state persistence, or a test-only expectation. The test is valid for exact equivalence. Its diagnostic wording should be narrowed so future readers do not infer event/history corruption that was not demonstrated.

### 10.2 Reproduced personnel state loss

`persistSession` can update `world.characters` from the run and emits `q4.personnel.condition.changed`. The world loader’s character rebuild recognizes `character.instantiated`, `character.status.changed`, assignment, and related `character.*` events; it does not replay the Q4 condition event. The direct reproduction retained the Q4 event but restored the derived character condition to its earlier `character.instantiated` value.

Some ordinary action paths call outcome resolution first and emit a replayed `character.status.changed`, which can mask this defect. Communication, logistics, and handoff also run costful cycles and persist; their condition effects can pass through the lossy Q4 seam. The current in-memory/session copy may hide the problem until canonical reload. y60 tests direct personnel functions and does not compose this service-save/world-rebuild path.

**Severity:** critical for future personnel, offline scheduling, and multi-career work. This is actual canonical/derived ownership divergence, unlike the narrower y33 normalization mismatch.

### 10.3 Persistence call trace during field operations

Canonical/session persistence occurs after:

- accepted structured field actions;
- accepted natural actions after local resolution;
- LOCAL and STANDARD communication submissions and later communication state changes;
- logistics operations;
- personnel/equipment handoff;
- operation completion/return and explicit between-operation advancement;
- service shutdown for live sessions.

The UI explicitly tells the player that accepted actions save automatically. This is deliberate existing behavior and directly conflicts with the Constitution’s no-mid-expedition-save rule; it is not merely an incidental save call.

### 10.4 Conflated persistence meanings

The current system does not distinguish the following concepts strongly enough:

- committing authoritative simulation mutations;
- persisting an active session for crash recovery;
- serializing a normalized canonical world snapshot;
- retaining a previous-good technical recovery copy;
- retaining a legislated pre-expedition checkpoint;
- performing a player-visible metagame rewind after death.

These concepts have different authority and irreversibility consequences. Phase 01A correctly called save-boundary replacement necessary, but missed that the existing save function is also a world reconciliation/materialization authority.

### 10.5 Retirement recovery contradiction

The reproduced order was:

1. establish an active world and previous-good save;
2. use the developer fatal outcome, producing a retired current world;
3. call confirmed `restoreBackup`;
4. observe current world status `ACTIVE`, player status `active`, and successful resume.

The reason is structural: terminal retirement saves the retired world after the prior active file has become previous-good; restore validates and copies the backup without consulting retirement history or the current retired state. The ordinary world-library markup has no Restore control, but preload exports the method and the renderer contains a handler. This is neither Doctrine-compliant immutability nor the Constitution’s explicit three-option death flow.

## 11. Canon/phenomenon challenge findings

### A. Behavior present in code

`q4-phenomenon-ecology` contains eight-family materialization, heterogeneous Still Life profiles and stimulus reactions, persistence, movement/vocalization/light/hazard/contact effects, Bacteria speech acquisition, mimicry, target acquisition, pursuit, capture/restraint, and slam/injury operations. Spatial runtime can also represent blocked and transient connections and phenomenon-induced spatial state.

### B. Behavior reachable in normal gameplay

Rare materialization of both named families is normal production behavior and was reproduced through ordinary deterministic expansion. Observation and persistence are reachable. Ordinary speech can be added to an existing Bacteria entity’s learned material. The normal operational cycle can continue an already-active state.

The meaningful triggers are not ordinary-player reachable: Still Life stimulus, Bacteria target acquisition/mimic/slam, spatial-state contradiction, displacement, and acoustic initiation are invoked by developer controls or direct tests. Thus natural existence is real; the advertised encounters are not a complete production loop.

### C. Behavior supported by admitted project authority

The Simulation Doctrine and Design Charter internally describe heterogeneous Still Life and Bacteria behavior. Under the repository’s constitutional hierarchy, that is project authority unless amended. However, the project’s canon-admission machinery says:

- only two primary sources are verified, neither an entity-behavior source;
- the source registry contains metadata and deferred/partial review, not direct admission of these behaviors;
- `still-life-behavior-authority.json` says no admitted Still Life behavior source exists and prohibits movement/perception/pursuit/harm generalization except a stationary explicit fixture;
- `entity-definitions.json` admits only a stationary Still Life fixture;
- `canon-runtime.md` reports no source-backed entity capability;
- procedural readiness is warning-qualified and context inputs remain missing.

Therefore the code is supported by internal Doctrine/Charter declarations but not by a completed Kane-primary evidence chain. The Gameplay Constitution is product intent, not independent Kane-canon proof.

### D. Behavior supported only by historical assumption or developer intent

The detailed profiles, movement, vocalization, pursuit, capture, and slam rules trace to project doctrine/design/implementation intent and developer fixtures rather than admitted primary-source records. Production spawn weights were enabled despite older fixture-only authority data. This makes the current state `CONFLICTING`, not merely `UNVERIFIED`.

No conclusion about which authority should win is made here. Human legislation must distinguish internal project canon, external Kane-primary evidence, and diagnostic fixture behavior.

## 12. Authority conflict inventory

| Authorities/implementation in conflict | Precise conflict | Current status |
|---|---|---|
| Gameplay Constitution/vision roadmap vs Simulation Doctrine §2.9 and bounded offscreen rules | Constitution requires real elapsed outside time and significant offline progression; Doctrine defaults to no real-world mutation without explicit bounded worldpack override. No explicit amendment was found. | `CONFLICTING` |
| Gameplay Constitution/vision roadmap vs Doctrine §19, Design Charter, outcome implementation | Constitution allows pre-expedition reload or same-world successor; Doctrine/Charter/current outcome retire the world and require another world. No explicit amendment was found. | `CONFLICTING` |
| Gameplay Constitution save policy vs runtime/tests/UI | Constitution forbids mid-expedition saves; runtime autosaves accepted field activity and tests assert it. | `CONFLICTING` |
| Doctrine’s immutable retirement vs `restoreBackup` | Doctrine and outcome guards forbid rewind; previous-good restore can revive the retired world. | `BROKEN` implementation invariant under the current Doctrine |
| Doctrine observer/provider boundary vs authority registry and clarification path | Provider gets internal authority text and can return unvalidated internal terminology to the player. | `BROKEN` optional provider boundary |
| Doctrine/Design Charter phenomenon descriptions vs canon admission data | Project constitutional descriptions authorize rich behavior internally; verified-primary/source authority explicitly does not admit it as source-backed Kane behavior. | `CONFLICTING` |
| `context-closure.runtime_authority_complete: true` vs source/verification records | Closure claims completeness while most sources are deferred/partial, inputs are missing, only two primary sources are verified, and entity capability is unadmitted. | `CONFLICTING` metadata semantics |
| Current vision scope vs old implementation roadmap/pass summaries | Historical campaign treats action-driven cycles, bounded shift processing, and older surfaces as completed milestones; current vision requires a different product. | `OBSOLETE` as current scope authority |
| Current mode registry/UI vs service/package smoke | Three modes are presented unavailable but are still accepted and used as packaged viability checks. | `CONFLICTING` product/test ownership |
| Character event authority vs Q4 personnel sync | Loader rebuilds character state from one event vocabulary while persistence writes another unhandled condition event. | `DUPLICATED AUTHORITY` / `BROKEN` replay |
| World geography ingestion vs current Q4 geography | Generic history ingestion promotes legacy `run.procedural`; current production stores `run.spatial` via separate `world.q4_geography` reconciliation. | `DUPLICATED AUTHORITY` |
| y66 retirement implication vs y26 recovery capability | Each isolated suite passes, but composed service behavior permits revival. | `CONFLICTING` test evidence |

This inventory identifies conflicts only. It does not choose an authority or invent an amendment.

## 13. Corrected high-risk unknowns

1. **Authority ratification:** whether the Gameplay Constitution intentionally amends Doctrine on offline elapsed time, death, retirement, rewind, and succession remains unknown. Its current text does not explicitly declare that amendment.
2. **Canon admission:** whether human source review can substantiate the implemented Still Life/Bacteria behaviors, or whether those implementations must remain fixtures/remove production eligibility, is unknown.
3. **Full persistence damage radius:** the personnel reproduction proves one lost field. Other direct-index/event-replay mismatches across institution, geography, equipment, evidence, environment, and outcomes have not been exhaustively state-model checked.
4. **Intended migration semantics:** it is unknown whether new worlds are supposed to be normalized before first save or whether first-load migration is accepted. The current exact-equivalence test says the latter is not accepted, while the writer preserves pre-migration shape.
5. **Continuous scheduler ownership:** existing queues and deterministic state machines may be reusable, but no ratified canonical owner/transaction model says how autonomous and offline events commit without session/world duplication.
6. **Real-provider behavior:** the hostile mock proves the validation gap. No live provider matrix was run, and provider nondeterminism cannot be relied on to avoid hidden-term disclosure.
7. **Production encounter frequency and quality:** deterministic seeds prove reachability, not acceptable real-player frequency, presentation, escape, aftermath, or long-form restraint.
8. **Packaged portability:** current local Windows automation passed, while a prior same-HEAD audit recorded an Electron GPU failure. External machines, signing, antivirus, accessibility, and stranger play remain unverified.
9. **Human-facing comprehension:** selector tests and smoke tests do not answer whether first-time players understand identity, assignment, geography, communication, evidence, consequences, and persistence.
10. **Audio rights and implementation:** documented candidate sources are not packaged assets; licensing/admission and the desired runtime registry remain unverified.
11. **Historical test ownership:** there is no explicit policy distinguishing current contract tests, migration tests, developer fixtures, obsolete assertions, and release gates.
12. **Recovery authority:** it is unknown whether previous-good restore is intended solely for damaged files or as a general manual rewind. The current UI does not expose it, but the public preload API does.

These unknowns are higher-risk than Phase 01A’s wording suggested because several sit at canonical ownership and lifecycle boundaries, not feature breadth alone.

## 14. Corrections required before baseline ratification

These are corrections to the reconciliation baseline, not an implementation roadmap:

1. Change R07 from `COMPLETE` to `PARTIAL`, while preserving a separate statement that channel delivery transitions and provenance are implemented.
2. Change R15 from `COMPLETE` to `PARTIAL`; remove the false claim that raw/internal truth is not passed to provider context.
3. Change R22 from `PARTIAL/EXTEND` to `SCAFFOLDED` with a `BROKEN` replay/ownership seam and migration prerequisite.
4. Change R35 to `PARTIAL` with exact first-normalization equivalence `BROKEN`; record the observed one-time migration cause and avoid claiming history corruption without evidence.
5. Add a separate critical persistence finding for Q4 personnel condition loss on canonical reload.
6. Retain R36 as `CONFLICTING`, but explicitly distinguish canonical commits, session crash recovery, world snapshots, previous-good recovery, semantic checkpoints, and metagame rewind.
7. Add the retirement/backup-restore revival defect to R27/R35/R37 and the authority-conflict inventory. Note its service/preload reachability and absent ordinary Restore button.
8. Change R38 to `BROKEN` for provider-assisted play and R39 to `PARTIAL`; split canonical-write safety from observer-knowledge/output safety.
9. Amend R29/R30 to state that rare production materialization is reachable without fixtures, while initiating/active behavior remains fixture-dominant and canon-conflicting.
10. Qualify preservation of world history, observer projection, institutional cognition, geography, personnel, and save recovery: preserve semantic records/algorithms selectively, not the present duplicated owner topology.
11. Add targeted LOCAL broadcast behavior, unknown teammate portrait identity, and unreachable Restore handler to player-facing/dead-path findings.
12. Preserve R05, R12, R19, and R43 `COMPLETE` only with their narrow scope stated. Do not let those labels imply complete Constitution fulfillment or completed human gates.
13. Record all 32 aggregate omissions and the three non-enforcing report tools; historical green claims must name their command membership and verdict semantics.
14. Mark all pending human, external-machine, audio, canon-review, and long-play gates `UNVERIFIED` regardless of automated selector/smoke results.
15. Replace “extend the action loop with a scheduler” implications with the more accurate baseline fact: continuous/offline work first depends on resolving canonical ownership, replay, and commit boundaries.

## SUPPORTED LEDGER CLAIMS

- The repository is a credible deterministic field-operations prototype, not the promised living workplace.
- Canonical time, team decisions, environment, institution, communications, and phenomenon advancement are coupled to player/service calls; there is no independent production scheduler.
- Current between-operation progression is bounded, deterministic, and explicitly player-triggered, not elapsed-time offline simulation.
- Player-authored LOCAL/STANDARD text is separated from ACTION and preserved as player speech.
- Current bounded procedural geography, observer survey state, evidence provenance, equipment custody, mission deviation, and communication delivery states are substantive implementations.
- Autosave during field operations directly conflicts with the Gameplay Constitution.
- Doctrine/Constitution conflict on death, retirement, succession, rewind, and offline elapsed time requires human legislation.
- The renderer is panel/click driven; refresh, settings completeness, audio, facility life, onboarding, and human acceptance remain deficient.
- `npm test` omits 32 of 101 test files and cannot represent current full-suite truth.
- Current exact Windows packaged artifact automation passes in isolated profiles.

## DISPUTED LEDGER CLAIMS

- R07 is not `COMPLETE` under the living-workplace STANDARD requirement; only its channel transition/provenance core is complete.
- R15 is not `COMPLETE`: provider context receives internal authority text, and institutional ownership is distributed.
- R22 is not a safely extensible `PARTIAL` personnel system; it is scaffolding with a proven replay defect and duplicated owners.
- R35’s exact-equivalence failure is real, but its reproduced cause is one-time migration/default insertion, not demonstrated long-world history corruption.
- R38 is not `COMPLETE`: provider clarification can expose hidden canonical terminology.
- R39 is not wholly `COMPLETE`: canonical writes are bounded, but provider knowledge and some candidate output are not observer-safe.
- “World history and canonical authority separation,” “observer-safe projection,” and “atomic save/recovery” cannot be preserved wholesale as currently structured.
- Phenomenon creation is not confined to fixtures; rare normal production materialization exists, though active behavior initiation remains fixture-dominant.

## MISSED RISKS

- Q4 personnel condition can be lost on canonical reload because its event vocabulary is not replayed.
- Previous-good restore can revive a Doctrine-retired world and resume play.
- Save performs canonical reconciliation and phenomenon materialization, conflating persistence with simulation authority.
- Provider authority context contains hidden entity terminology, and clarification text bypasses grounding/terminology validation.
- Stable teammate identity is stripped before portrait rendering, producing `portrait-unknown` and weakening visible continuity.
- Targeted LOCAL speech is effectively broadcast to all eligible local peers.
- STANDARD, institution, evidence, operator, geography, and personnel state have overlapping owners that will become dangerous under autonomous/offline scheduling.
- Locked historical modes and legacy prefield/geography paths remain production-service and package-smoke dependencies.
- Current retirement and recovery tests prove incompatible isolated behaviors and miss their composition.
- Canon closure metadata overstates substantive primary-source completion.

## MISSED CAPABILITIES

- Rare Still Life-family and Bacteria-family records can materialize through ordinary production expansion without developer fixture controls.
- After first migration normalization, repeated save/load was stable in the reproduced long-world case.
- No event count or ordering loss was reproduced by y33; the failure is narrower than a general deterministic-history collapse.
- The STANDARD delivery/provenance sub-contract, local canonical provider resolution, persistent Q4 geography, mission freedom, and speech authorship are stronger than a blanket “scaffolding” characterization.
- The exact current packaged Windows artifact and native first-run/reopen path independently passed isolated verification.

## RECOMMENDED CORRECTIONS

- Ratify Phase 01A only after applying the 15 baseline corrections in section 14.
- Split broad `COMPLETE` labels into tested sub-contracts and whole-product requirements.
- Record the personnel replay and retirement-restore defects as critical baseline facts.
- Narrow the y33 diagnosis to first-load normalization while retaining its failing contract status.
- Treat provider write authority and provider observer safety as separate classifications.
- Treat production phenomenon existence, production behavior initiation, internal project authority, and verified Kane-primary support as four separate questions.
- Qualify all `KEEP` decisions at the level of reusable semantics/algorithms; do not preserve duplicated state ownership by implication.
- Require verification claims to state exact test membership, process-exit semantics, production reachability, fixture involvement, and pending human gates.
- Do not begin continuous/offline/multi-career implementation on the assumption that current save, personnel, institutional, or geography ownership is already authoritative.
