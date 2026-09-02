# Playability Map Reconnaissance

**Scope:** reconnaissance-only; no runtime or source implementation changes made by this pass.
**Evidence basis:** static tracing of the current Electron desktop path, Clear-Q4 runtime, provider adapters, focused tests, package scripts, and the current baseline documents.

## PLAYABILITY PATH

| Stage | UI | Handler | Runtime/Service | State | Persistence | Tests | Status |
|---|---|---|---|---|---|---|---|
| Application launch | `desktop/renderer/index.html`, `renderer.js#boot` | `boot`, `home` | `desktop/main.js#createWindow`, `registerHandlers`; `DesktopService` | app metadata, settings, current renderer context | app metadata/settings under service app-data root; logs under `logs` | `tests/y26-desktop.test.js`, `tests/y57-desktop-prerequisite-repair.test.js` | WIRED |
| New World | `renderer.js#newWorld` | form submit -> `yellowBeast.createWorld` | `DesktopService#createWorld`, `world-history#createWorld` | `world.world_id`, metadata `worlds`, `first_run_complete`, `last_world_id` | `worlds/<world_id>.json`, `desktop-worlds.json` | `y26`, `y47`, `y48`, `y49` | PARTIALLY WIRED |
| Load World | `renderer.js#home`, `selectWorld` | `selectWorld` -> `loadWorld`, then mode selection | `DesktopService#loadWorld`, `getWorld`, `loadWorldFile` | safe world summary and retired/ready status | primary world plus `.previous-good`; recovery status | `y26`, `y67`, `y68` | WIRED |
| Player identity | `renderer.js#personnelCreation`, `personnelConfirmation` | `createQ4Personnel`, `confirmQ4Personnel` | `q4-personnel#createPlayer`, `safePerson`; `history.character` | `world.q4_operations.controlled_player`, character status/condition, personnel confirmation | canonical world save; world history events/character records | `y47-q4-player-identity`, `y48-q4-prefield-flow`, `y60-personnel-continuity` | WIRED |
| Briefing | `surfaces.js#operationalPreField` | `startSession` / `resumeSession` -> `play` | `DesktopService#startSession`, `projectionFor`; `q4-experience#presentation` | `entry.phase=BRIEFING`, mission/order/team/equipment projection | coordinated world/session pair | `y47`, `y48`, `y49` | WIRED |
| Staging | `surfaces.js#operationalPreField` | structured `READY` through `renderer.js#submitTurn` | `DesktopService#submitAction`; `q4-experience#nextPhase`; `run-bootstrap#setSpatialPhase`; logistics | `phase=STAGING`, `run.spatial.player_location=equipment-staging`, optional stores, authorizations | `persistSession` after accepted action | `y38`, `y48`, `y49` | WIRED |
| Threshold approach | same preparation surface | `PROCEED`, then `APPROACH` | `submitAction` -> phase transition and spatial movement | `FACILITY_TRANSIT`, then `THRESHOLD`; route history and location | session/world persistence pair | `y47`, `y48`, `y49` | WIRED |
| Threshold room | same preparation surface | `READY` from `THRESHOLD` | `q4-experience#nextPhase` authorizes radio procedure | `phase=STANDARD_RADIO_CHECK`, radio authorization, still outside Complex | `persistSession` | `y48`, `y49` | WIRED |
| Cross Threshold | preparation surface button `CROSS` | `renderer.js#submitTurn` -> `DesktopService#submitAction` | `q4-experience#nextPhase`; canonical crossing in `run-bootstrap`/spatial runtime; then `projectionFor` | `phase=FIELD_OPERATION`, `threshold-crossing` and `entry-to-utility` route events, `threshold-side-entry`, `utility-room`, team locations | `persistSession` and pair commit | `y48` specifically proves pre-cross radio gate and one crossing; `y49` covers spine/reload | PARTIALLY WIRED |
| Field operation | `surfaces.js#operationalField` | `submitTurn`, object-action listeners, structured action form | `DesktopService#submitAction`, `resolveQ4Attempt`, `run-bootstrap#act`; spatial/object/mission/hazard/logistics runtimes | `run.expedition`, `run.spatial`, mission state, equipment custody, evidence, clock, hazards | action save through `persistSession`; canonical world/session pair | `y36`-`y45`, `y50`-`y65`, `y71`-`y73` | WIRED BUT BROADLY INCOMPLETE |
| Player input | natural ACTION dock and structured controls | `submitTurn`; `submitNatural`; `submitAction` | object/spatial interpreters, `executePlayerTurn`, `executeLivingTurn`, `resolveQ4Attempt` | canonical mutation only after resolver; renderer draft is presentation state | accepted actions persist; rejected attempts may record interaction state | `y27`, `y36`, `y50`, `y71`, `y73` | PARTIALLY WIRED |
| STANDARD / LOCAL routing | `surfaces.js#communicationLanes`, unified `q4-comms-form` | communication submit -> `submitQ4Communication`; natural named-worker text -> `submitQ4LocalIntent` | `communication-runtime`, `q4-radio`, `q4-local-intent`, `q4-standard-operator`, `personnel-continuity`, `team-runtime` | messages/delivery, radio check, local orders, operator contact, survey knowledge | `persistSession`; delivered Standard reports reconcile into world institutional records | `y36`, `y41`, `y61`, `y73` | PARTIALLY WIRED |
| NPC/model interpretation | field presentation plus timeline/team panels | local reactions are generated after canonical delivery; living turn provider presents NPC output | `q4-personnel-continuity#reactionContext/react/presentReaction`; `ai-interpreter-boundary`; `ai-living-turn` | personnel decision/reaction history, delivered messages, observable events | continuity and interaction records persist; provider prose does not | `y60`, `y61`, `y71`, `y73` | PARTIALLY WIRED |
| Movement / world interaction | field observation, object actions, map | `submitAction` / natural object-spatial routing | `spatial-runtime`, `object-runtime`, `run-bootstrap#act`, `consequence-resolution` | player location, route history, observed objects, object state, mission/evidence | world/session persistence after accepted operation | `y39`, `y40`, `y50`, `y56`, `y64` | WIRED BUT INCOMPLETE |
| Retreat / continue | `surfaces.js#operationalField` return controls; debrief | `RETURN`, `ABORT`, `COMPLETE_RETURN`, `ADVANCE_OPERATIONS` | `q4-experience#nextPhase`, `q4-trajectories#contain`, mission/outcome/career runtimes | `RETURN`, `DEBRIEF`, completed lifecycle, outcome, personnel/equipment accountability | `persistSession`; `q4-career-loop#process` on advance | `y39`, `y41`, `y51`, `y52`, `y59`, `y66` | WIRED |
| Consequences | warnings, team condition, resolution band/debrief | action resolution and outcome handling | hazards, trajectories, `consequence-runtime`, `q4-outcome-authority`, `q4-continuity` | injuries, missing/dead, lost gear, route conditions, objective states | world history and session pair; terminal retirement path exists | `y40`, `y52`, `y65`, `y66`, `y67` | PARTIALLY WIRED |
| Return | return-mode field surface and review surface | `RETURN` then completion transition | `q4-experience#nextPhase`, return readiness and debrief projections | `phase=RETURN/DEBRIEF`, returned personnel/material, review | `persistSession` and world reconciliation | `y41`, `y51`, `y59`, `y66` | WIRED |
| Reporting | debrief archive, communications, institutional panels | Standard report via `submitQ4Communication`; review via projection | `institutional-runtime`, `q4-evidence-authority`, `q4-continuity`, `q4-career-loop` | delivered/missed messages, evidence reporting/custody, institutional claims, follow-up | canonical world history plus `q4_evidence_archive`, career state | `y61`, `y62`, `y64`, `y68` | PARTIALLY WIRED |
| Save / reload | library, leave session, resume path | `saveWorld`, `persistSession`, `resumeSession`, `getGameplayProjection` | coordinated persistence pair, `world-history`, `restoreSession`, `loadPersistencePair` | session envelope v7, run v9, world v1, pair marker | app-data `worlds` and `saves`, backups, metadata | `y22`, `y26`, `y44`, `y49`, `y57`, `y67`, `y68` | PARTIALLY WIRED / KNOWN FAILURES |

**Cross Threshold finding:** the current production path requires `THRESHOLD -> READY -> STANDARD_RADIO_CHECK -> Standard acknowledged -> CROSS -> FIELD_OPERATION`. The old/legacy path can map `CROSS` to radio readiness, but ordinary production creates `phase.legacy_flow=false`. The current failure is therefore most likely in the live action/phase resolver or downstream transition, not in the renderer label alone. `y48` is the cheapest discriminating regression path.

## AI PATH

### Hosted configuration to invocation

1. Settings UI in `desktop/renderer/renderer.js#settings` submits `configureOpenAI` and optional model text.
2. IPC is allowlisted by `desktop/preload.js`; `desktop/main.js#registerHandlers` forwards the call.
3. `DesktopService#configureOpenAI` stores the key through `desktop/credentials.js#CredentialStore#set` using Electron `safeStorage` when available; the key is not put in JSON settings, saves, or logs. Do not retrieve the value.
4. `DesktopService#updateSettings` permits `provider: "openai"` only when credentials are configured. `openai_model` is persisted in desktop settings.
5. `DesktopService#submitNatural` reads provider selection and the credential, constructs `createOpenAIProvider({ apiKey, model, timeout: 15000 })`, and selects either the standard adapter path or the reference-expedition living-turn path.
6. `tools/ai-openai-provider.js#createOpenAIProvider` constructs the OpenAI SDK client and calls `sdk.responses.create({ model, store:false, instructions, input: JSON.stringify(payload), text: { format } })`.
7. The response must contain `output_text`; it is parsed as JSON and validated against the strict intent or living-presentation schema.

### Interpreter and NPC/model chains

- Standard natural input: `submitNatural -> executePlayerTurn -> ai-adapter#interpret -> provider.interpret -> validateIntent -> intent-grounding -> capability-planning -> resolveQ4Attempt / resolveModeAttempt -> canonical mutation -> scene presentation`.
- Reference living path: `submitNatural -> createOpenAIProvider.interpretLiving -> ai-living-turn#executeLivingTurn -> ai-interpreter-boundary#interpretPlayerLanguage -> dispatchCandidate -> Custodian resolution -> projectLiveScene -> provider.presentLiving -> validatePresentation -> deterministic fallback if invalid/failing`.
- Offline Q4 path: `submitNatural -> createMockProvider` in the standard path, or `createLivingProvider` in the living path. Structured controls bypass provider inference. Deterministic scene fallback is in `scene-presentation#fallbackNarration`, while living-turn fallback is `ai-living-turn#fallbackPresentation`.
- NPC responses do not establish state. Local responses use `q4-personnel-continuity#react` and `presentReaction` after delivery/decision state; hosted presentation can only describe a resolved packet.

**Static reachability verdict:** hosted inference is statically reachable when OpenAI is configured and the relevant natural-language path is selected. The code does not prove that a hosted request was made during gameplay. `recordInterpretationProvenance` records provider name/model and `getInterpretationProvenance` is developer-only, but the ordinary UI does not expose a definitive network invocation trace. `testProvider` only verifies configuration and explicitly says connection is tested when natural input is chosen. Runtime evidence is required before claiming hosted inference works.

## UI IMPLEMENTATION MAP

- **Shell/layout: REUSE.** `desktop/renderer/renderer.js#play`, `asyncHeader`, `compactOperationsRail`, `desktop/renderer/styles.css`, `desktop/renderer/index.html`.
- **Navigation/world library: REUSE, ADAPT.** `renderer.js#home`, `newWorld`, `selectWorld`; creation currently returns to the library and the selected program is not passed into `createWorld`.
- **Map: REUSE, ADAPT.** `surfaces.js#layoutMap` and `layoutMap`/`operationalMap`; projections come from `q4-experience`, `survey-frontier`, and `spatial-runtime`.
- **Mission/briefing: REUSE, ADAPT.** `surfaces.js#operationalPreField`, `q4-experience#presentation`, `DesktopService#briefingScene`.
- **Evidence/artifacts: REUSE, ADAPT.** `surfaces.js#reviewSurface`, inventory/evidence panels; `q4-evidence-authority`, `q4-evidence-media`, and `DesktopService#renderEvidence` remain authorities.
- **Personnel: REUSE, ADAPT.** `compactOperationsRail`, preparation team panel, field team panel, `q4-personnel` projections; portrait identity is known to be incomplete.
- **STANDARD/LOCAL input: REUSE, ADAPT.** `surfaces.js#communicationLanes`, `renderer.js` communication form wiring, service routing. Target selection is not currently forwarded by the unified renderer form.
- **Status/permissions: REUSE.** phase guidance, action availability, channel state, radio authorization, loadout restrictions, and `availableFor`.
- **Settings: REUSE, ADAPT.** `renderer.js#settings`, `DesktopService#getSettings/updateSettings/configureOpenAI`; several service settings are not fully represented in ordinary controls.
- **Model configuration: REUSE, ADAPT.** existing OpenAI credential/model controls and provider status are present; hosted invocation proof/diagnostics need a later implementation pass.
- **Reactive access controls: REUSE, ADAPT.** `interaction.js#RequestGate`, `submitTurn`, phase-derived `available_actions`; refresh handling has a known invalid comparison.
- **Missing:** a complete approved new interface as a distinct, fully validated information architecture; the current renderer is a dense panel-driven Clear-Q4 surface and the baseline lists the broader ASYNC/onboarding/cockpit experience as missing.

## HIGH-RISK BOUNDARIES

1. **Crossing gate:** `q4-experience#nextPhase` requires radio acknowledgment before `CROSS` reaches `FIELD_OPERATION`; `y48` proves the intended contract.
2. **Renderer refresh guard:** `renderer.js` refresh compares `requestContext().worldId === context.mode`, so a valid refresh result is normally discarded.
3. **Communication target loss:** `renderer.js` submits `target: null` from the unified communications form; `DesktopService#submitQ4Communication` then selects all eligible local peers, matching the known broadcast defect.
4. **Provider/fallback identity:** `submitNatural` chooses OpenAI, mock, or living providers; the ordinary UI reports broad success/fallback text, while definitive invocation provenance is developer-only.
5. **Provider knowledge boundary:** `ai-adapter#executeNatural` assembles authority context; current baseline records provider terminology leakage through internal authority context.
6. **Canonical versus renderer state:** renderer keeps `current.projection`, drafts, panels, and request state; only service projections and canonical runtimes should decide mission/inventory/world truth.
7. **Persistence reconciliation:** `persistSession` combines serialization, reconciliation, equipment/personnel/institution updates, geography snapshotting, and pair commit; baseline marks this as conflicting ownership.
8. **Personnel replay:** `reconcileSessionCandidate` can emit condition changes, but baseline records condition loss on reload when replay rebuilds from incompatible character events.
9. **Recovery versus lifecycle:** `restoreBackup` can restore previous-good world/session artifacts; baseline records retirement immutability can be defeated by backup restoration.
10. **Model prose versus action:** `executeLivingTurn` and `executePlayerTurn` validate proposals before dispatch, but generated prose remains presentation-only and must never be treated as proof of canonical mutation.

## FOCUSED TEST COMMANDS

- Launch/bootstrap and desktop IPC: `npm run desktop:test`
- Native packaged launch/settings/reopen: `npm run desktop:first-run-regression` and `npm run desktop:settings-regression`
- Player identity and pre-field/Cross Threshold: `node --test tests/y47-q4-player-identity.test.js tests/y48-q4-prefield-flow.test.js tests/y49-playable-spine-map.test.js`
- Field actions, movement, mission, consequences: `node --test tests/y39-q4-missions.test.js tests/y40-q4-trajectories.test.js tests/y50-structured-interactions.test.js tests/y51-mission-state.test.js tests/y52-operational-dynamics.test.js`
- LOCAL/STANDARD: `node --test tests/y36-q4-channels.test.js tests/y61-local-standard.test.js`
- Hosted provider adapter/configuration: `node --test tests/y15-openai-provider.test.js tests/y34-beta-hotfix.test.js`
- Living-turn/model boundary: `node --test tests/y71-ai-interpreter-boundary.test.js tests/y73-ai-living-turn.test.js`
- Persistence/reload/recovery: `node --test tests/y44-q4-replayability.test.js tests/y67-recovery-profile.test.js tests/y68-long-world-known-failures.test.js`
- Personnel and outcomes: `node --test tests/y60-personnel-continuity.test.js tests/y66-outcomes-retirement.test.js`
- UI/runtime integration: `node --test tests/y42-q4-async-interface.test.js tests/y46-q4-console-acceptance.test.js tests/y54-settings-regression.test.js tests/y57-desktop-prerequisite-repair.test.js`

Do not interpret the package's aggregate `npm test` result as complete coverage: the current baseline records omitted tests and a known failing long-world path under the verification campaign.

## NEXT IMPLEMENTATION TARGETS

1. Establish runtime evidence and truthful diagnostics for the hosted-vs-fallback inference path.
2. Repair the Cross Threshold action path using `y48` as the narrow regression gate.
3. Repair renderer refresh and communication target forwarding so visible controls affect the intended downstream request.
4. Separate or stabilize persistence/reconciliation ownership before expanding lifecycle or multi-career behavior.
5. Repair personnel replay/state round-trip before adding deeper NPC autonomy.

These are reconnaissance findings only; they were not implemented here.

## GIT STATUS

This pass made no source-code changes. At report time, the worktree already contained these modified/untracked implementation files:

- Modified: `desktop/main.js`, `desktop/renderer/renderer.js`, `desktop/renderer/surfaces.js`, `desktop/service.js`, `tools/ai-interpreter-boundary.js`, `tools/ai-openai-provider.js`
- Untracked: `tests/y73-ai-living-turn.test.js`, `tools/ai-living-provider.js`, `tools/ai-living-turn.js`

The only file created by this reconnaissance pass is this report: `docs/PLAYABILITY_MAP_RECONNAISSANCE.md`.
