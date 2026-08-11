# Yellow Beast / Custodian Full-Suite Audit

Date: 2026-08-11  
Repository: `C:\Users\jroch\custodian-worldpack-backrooms`  
Branch: `agent/pass-10-release-candidate`  
Audited commit: `33017ea0c3ff4184f472f736619c6620c4a8578b`  
Version: `0.14.0-beta.1`  
Audit mode: read-only inspection plus isolated test/build/package execution; no feature implementation

## Executive verdict

**Classification: B — interactive vertical slice. It is not a playable alpha.**

There is a real, substantial end-to-end Clear-Q4 runtime beneath the repository. A production-service trace can create a persistent world, create and confirm named personnel, receive an assignment, deploy, perform a STANDARD radio check, enter the Utility Room, inspect and move, issue structured actions, communicate, request an abort, physically retrace the route, close the operation, receive a debrief, persist/reload, and advance to a new assignment. That is more than a framework or a collection of disconnected systems.

It is not a playable alpha because the audited Windows package cannot currently expose a usable renderer on this machine, the official test command conceals a failing long-world persistence check and omits the latest test generations, the major human gates have never been accepted, ordinary LOCAL dialogue can return blank text, natural action does not approach the expressiveness promised by the charter, active entity behavior and player death are reached only through developer controls, audio is an unused beep stub, and several settings/onboarding surfaces are ceremonial or ineffective.

The sharpest summary is:

> The repository contains a playable-spine-shaped simulation, but the release artifact and player experience do not yet prove a dependable game.

No further horizontal expansion should begin until the minimum vertical slice and the human gates at the end of this report pass.

## Scope, authority, and limitations

The audit treated `SIMULATION_DOCTRINE.md` as highest authority, following `AGENTS.md`, then used the 1.0 Design Charter, 1.0 Implementation Roadmap, campaign/worldpack records, implementation handoffs, source, persisted contracts, renderer code, tests, generated reports, and runtime behavior as progressively lower evidence.

This matters because the project’s own authority is unambiguous:

- The player must understand meaningful affordances and be able to answer what they can observe, where they can go, what they can interact with, who they can talk to, what they carry, what they are responsible for, what the assignment requires, and what changed after the last action (`docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md:1400`).
- Natural input is explicitly expected eventually to resolve a compound instruction such as having Miller photograph a fixture while the player checks behind a wall (`docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md:1425`).
- Automated testing is necessary but explicitly insufficient (`docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md:1757`).
- Human validation must cover launch through resume, including strange inputs, deliberately bad decisions, sequencing attacks, and long-lived worlds (`docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md:1765`).
- A pass is complete only when both repository evidence and a human playthrough prove it (`docs/YELLOW_BEAST_1.0_IMPLEMENTATION_ROADMAP.md:1491`, `:1509`).
- Pass 10B specifically requires a human to complete successful, degraded, and controlled-abort operations using only the release UI (`docs/YELLOW_BEAST_1.0_IMPLEMENTATION_ROADMAP.md:250`).

The package could not be visually played because its renderer process crashed on launch in the audited environment. The experience audit therefore has two evidence tiers:

1. Direct package/runtime evidence: build output, packaged verification, direct executable launch, and the existing native-input Electron smoke harness.
2. A fresh isolated profile driven through `DesktopService`, the exact production persistence/simulation facade used by the Electron renderer, with `desktop/renderer/surfaces.js` used to inspect rendered content. This proves runtime behavior but does **not** substitute for a human DOM/window playthrough.

That limitation is itself a P0 release finding, not a reason to award playability credit.

# Audit 1 — Repository / implementation

## Ground truth

- Git was clean before and after the audit.
- Branch and HEAD exactly matched the requested target.
- Package metadata labels the build `0.14.0-beta.1` and still describes the application internally as alpha (`desktop/service.js:112`).
- README states `Q4 BETA NOT AUTHORIZED` and human acceptance pending (`README.md:39`).
- `docs/IMPLEMENTATION_STATE.md` calls many passes “Completed,” but repeatedly records `PENDING HUMAN VALIDATION`; Recovery Prompt 1 explicitly says it repaired no Settings, provider, dialogue, radio, ACTION, exploration, map, presentation, onboarding, interpreter, or later-game behavior (`docs/IMPLEMENTATION_STATE.md:234-247`).
- Prompt 18 and later campaign work have not started (`docs/IMPLEMENTATION_STATE.md:236`).

## Actual player-path trace

The production path is:

1. Electron main process creates a sandboxed, context-isolated `BrowserWindow`; preload exposes an allowlisted service API.
2. Renderer opens the world library.
3. New-world form writes a world record. Despite the button label “Establish and begin,” it returns to the library (`desktop/renderer/renderer.js:53-55`). The selected program radio is not passed to `createWorld`; it is presently ceremonial because only Clear-Q4 is available.
4. Player reopens the world, chooses Clear-Q4, creates and confirms personnel, and starts or resumes `field-researcher`.
5. The new session starts in `BRIEFING` with assignment, team, inventory, objectives, and a `DEPLOY` action.
6. `DEPLOY` collapses STAGING, FACILITY_TRANSIT, and THRESHOLD into a direct transition to `STANDARD_RADIO_CHECK` (`desktop/service.js:266`, `:484-516`). Those phases exist in state/history but are not meaningfully played in the current route.
7. A free-text STANDARD message completes the radio check. `BEGIN_FIELD_OPERATION` enters the Utility Room.
8. Structured actions and bounded natural input resolve against spatial/object/mission authorities. Movement, object work, evidence, orders, field time, environment, communications, and return state can mutate and autosave.
9. `RETURN` or `ABORT` starts a return procedure. The player must physically retrace a usable route and satisfy accountability before `COMPLETE_RETURN` can close the operation.
10. `DEBRIEF` records outcomes and continuity. `ADVANCE_OPERATIONS` produces the next assignment.

That spine is real. The problem is what is compressed, hidden, blank, fixture-only, unreliable, or unverified around it.

## Implementation matrix

Status definitions:

- **PLAYER-REACHABLE + FUNCTIONAL**: wired into the production renderer/service route and performs its core state change. This does not override the global packaged-launch failure.
- **WIRED BUT INCOMPLETE**: reachable or invoked, but materially fails its claimed player-facing purpose.
- **IMPLEMENTED BUT UNREACHABLE**: substantive code exists but ordinary release UI cannot reach it.
- **PLACEHOLDER/STUB**: skeletal behavior or presentation stands in for the claimed system.
- **DEAD/DUPLICATED**: obsolete, shadowed, or competing implementation remains.
- **MISSING**: no substantive implementation found.

| Major subsystem | Classification | Ground-truth evidence |
|---|---|---|
| Windows launch / Electron shell | **WIRED BUT INCOMPLETE** | Build succeeds, but packaged renderer verification crashes its GPU subprocess and exits nonzero. Direct standard and `--disable-gpu` launches exposed no usable window in this environment. |
| World library, create/load/rename/export/import/delete | **PLAYER-REACHABLE + FUNCTIONAL** | Renderer and service APIs are wired; isolated native first-run smoke covers naming/opening. Creation returns to library instead of beginning despite its label. |
| World selection during creation | **PLACEHOLDER/STUB** | Program radios render, but the selected `experience` is never passed to world creation; only Clear-Q4 is enabled anyway (`renderer.js:52-55`). |
| Player identity / personnel record | **PLAYER-REACHABLE + FUNCTIONAL** | Fresh trace created and confirmed Jack Rocha; record survived service restart. |
| Clear-Q4 assignment generation | **PLAYER-REACHABLE + FUNCTIONAL** | `CQ4-WO-0001` and then `CQ4-WO-0002` were generated with objectives, risks, team, and institutional follow-up. |
| Briefing | **PLAYER-REACHABLE + FUNCTIONAL** | Assignment, team, responsibilities, and `DEPLOY` are projected. It is information-dense but operationally legible. |
| Staging / Facility transit / Threshold | **WIRED BUT INCOMPLETE** | Phase authorities and old verbs exist, but current sessions intentionally expose one `DEPLOY` jump directly to radio check. Facility life, preparation, and crossing are state labels, not experienced spaces/actions. |
| Guided onboarding | **IMPLEMENTED BUT UNREACHABLE** for pre-field guidance; **WIRED BUT INCOMPLETE** overall | `guidedIntroduction` returns empty for Clear-Q4 unless phase is FIELD_OPERATION/RETURN/DEBRIEF, while the same function defines BRIEFING/STAGING/TRANSIT/THRESHOLD guidance that can therefore never render (`renderer.js:106-109`). |
| Equipment / logistics / custody | **PLAYER-REACHABLE + FUNCTIONAL** at authority level; **WIRED BUT INCOMPLETE** experientially | Persistent holders, containers, charges, condition, transfer/use/recovery are present. The current fresh path skips meaningful staging and can reject return-marker securing because the correct supplies are not accessible, without first teaching the dependency. |
| Mission/objective state | **PLAYER-REACHABLE + FUNCTIONAL** | Required/optional objectives, blockers, return readiness, outcomes, and transition history are computed and displayed. |
| Authored spatial navigation | **PLAYER-REACHABLE + FUNCTIONAL** | Fresh trace moved Utility Room → Columned Corridor → Utility Room → Threshold using displayed route targets; invalid north-wall movement was rejected without mutation. |
| Procedural geography / persistent Survey Frontier | **PLAYER-REACHABLE + FUNCTIONAL** at runtime; **WIRED BUT INCOMPLETE** as a demonstrated game loop | `EXPAND`, discovered topology, map, persistent generation IDs, bounds, and migrations exist and recent tests pass. The fresh operation experienced only authored starting topology; no human evidence proves procedural depth is understandable or fun. |
| Legacy procedural generator | **DEAD/DUPLICATED** | Field bootstrap can initialize both `run.spatial` and legacy `run.procedural`; action code prefers `run.spatial`, leaving serialized duplicate geography state and a second movement branch (`tools/run-bootstrap.js:465-483`). |
| Structured ACTION | **PLAYER-REACHABLE + FUNCTIONAL** | Available verbs/targets are projected and authoritative object/movement/mission mutations occur. Controls are numerous and some invalid choices remain visible. |
| Natural ACTION / offline interpreter | **WIRED BUT INCOMPLETE** | Simple “Move west” works and invalid movement is safely rejected. The charter-style compound instruction was rejected as `INTERACTION_TARGET_UNAVAILABLE`; no decomposition into worker action + player action occurred. |
| Optional OpenAI provider | **WIRED BUT INCOMPLETE / NOT END-TO-END VERIFIED** | Credential isolation and provider selection exist. Network/model play was intentionally not exercised; offline completeness remains available. Input-mode selection does not materially change the always-present natural/structured UI. |
| LOCAL communications | **WIRED BUT INCOMPLETE** | Delivery/proximity/history are authoritative, but an ordinary question returned exactly two spaces. A supplied recipient was ignored and the message broadcast to all nearby participating coworkers, which a test explicitly enshrines (`tests/y62-pass17-human-gate.test.js:32`). |
| STANDARD communications | **PLAYER-REACHABLE + FUNCTIONAL** as a report channel; **WIRED BUT INCOMPLETE** as conversation | Radio readiness, delivery, delay, check-ins, acknowledgments, and claim-vs-truth separation exist. Arbitrary claims are recorded without becoming truth, correctly. Responses are mostly deterministic acknowledgments rather than an operator relationship. |
| NPC orders / task state | **PLAYER-REACHABLE + FUNCTIONAL** structurally; **WIRED BUT INCOMPLETE** experientially | Hold/investigate/follow targets and task progression exist. The fresh trace did not produce convincing independent speech or character decision-making. |
| Coworker continuity | **PLAYER-REACHABLE + FUNCTIONAL** in records; **WIRED BUT INCOMPLETE** as character experience | Shared assignments, conditions, absences, equipment, and history persist. All fallback personnel portraits in the trace used the same `unknown-person` asset identity, actively undermining recognition. |
| Environment / hazards | **PLAYER-REACHABLE + FUNCTIONAL** in state; **WIRED BUT INCOMPLETE** in causality | Lighting, communications, structure, moisture, acoustics, blocked routes, operational events, injury, assist/mitigate actions exist. A teammate injury appeared during a very short abort trace, but cause-and-effect was not clear in the primary scene. |
| Phenomenon materialization / observation | **PLAYER-REACHABLE + FUNCTIONAL** only for eligibility/passive observation | World persistence calls `materializeEligible`; observation/designation/evidence paths exist. Rarity means the fresh run did not encounter one. |
| Active Still Life / Bacteria behavior | **IMPLEMENTED BUT UNREACHABLE** in ordinary play | Stimulus, acquire, mimic, pursue, capture, and slam functions exist, but production searches found their initiating calls in developer-only `controlQ4PhenomenonFixture` (`desktop/service.js:117-130`). Ordinary advance only continues entities already put into active states. |
| Evidence/archive/custody | **PLAYER-REACHABLE + FUNCTIONAL** | Object-specific capture, metadata, storage, contradiction, reporting, world archive, and persistence exist; focused current tests pass. |
| Evidence imagery / visual identity | **WIRED BUT INCOMPLETE** | Presentation-safe render requests, fallback/ComfyUI/hosted adapters, and status exist. Runtime assets contain only app/logo icons; default experience is procedural glyph/fallback presentation, including identical coworker fallback portraits. |
| Return, debrief, next assignment | **PLAYER-REACHABLE + FUNCTIONAL** for controlled abort | Fresh trace completed a controlled abort, received a grounded summary and consequence, then advanced to a second assignment. Success/degraded completion remain automation-proven but not human release-UI-proven. |
| Death / terminal retirement | **IMPLEMENTED BUT UNREACHABLE** in ordinary play | Outcome authority, archive, lifecycle retirement, and tests exist. The only discovered direct fatal path is `action === "fatal"` inside developer-only fixture control (`desktop/service.js:127`). Bacteria slam escalates only to serious injury/incapacitation. |
| Save/reload/backup/migration | **WIRED BUT INCOMPLETE** | Atomic writes, previous-good backups, schema checks, import guards, and short-run exact resume tests are strong. The 2,650-turn torture report is deterministic but `save_reload_equivalent: false`. |
| Settings / accessibility | **WIRED BUT INCOMPLETE** | Theme, scale, reduced motion, guidance, provider, and media controls render. Service settings for audio, reduced sensory, and reopen-last-world are absent from the UI/effective boot path. Refresh-view compares `worldId` to `mode`, so it never applies the fetched projection (`renderer.js:190`). |
| Audio feedback / ambience | **PLACEHOLDER/STUB** | `audio.js` defines four ~80 ms oscillator beeps, but no runtime call configures or plays `YBAudio`. No audio assets exist. Audio service settings/sliders have no player-facing implementation. |
| LOST, Beck’s Desk, Nullzone | **IMPLEMENTED BUT UNREACHABLE** | Service runtimes and tests exist, but registry marks all three unavailable and renderer hard-blocks every mode other than `field-researcher` (`registry.json:28,38,48`; `renderer.js:88-90`). |
| Developer diagnostics / controlled fixtures | **IMPLEMENTED BUT UNREACHABLE** by design | Gated behind developer mode. Useful for authority verification, but cannot be credited as normal game content. |
| Renderer presentation code | **DEAD/DUPLICATED** risk | Two `compactLayout` declarations are adjacent; the second silently overwrites the first (`renderer.js:115-116`). `surfaces.js` retains legacy communication/prefield/field render paths alongside current operational field rendering. |
| Automated validation | **WIRED BUT INCOMPLETE** | Large suite and many focused authorities are strong. The default command omits current tests and treats report JSON as success even when `passed` is false. “Human gate” tests call the service directly. |

## Tests, build, and package results

Commands were run from the repository root. Results are exact for this audit session.

| Command | Result | What it actually proves |
|---|---|---|
| `git status --short --branch; git rev-parse HEAD; git branch --show-current` | PASS; clean requested branch at `33017ea…` | Correct source target and no repository mutation. |
| `node --check desktop\main.js; node --check desktop\service.js; node --check desktop\renderer\renderer.js; node --check desktop\renderer\surfaces.js; node --check desktop\renderer\audio.js; git diff --check` | PASS | Syntax and whitespace only. It does not prove runtime semantics. |
| `npm test` | PASS, exit 0, ~46.4 s | A large explicit list of historical and selected current service/module tests plus report generation. It does **not** include all test files and does not assert report-level `passed` fields. |
| `npm run desktop:build` | PASS, exit 0, ~69.6 s | Electron packaging completed and emitted `dist\desktop\win-unpacked\Yellow Beast.exe` plus zip. Warnings included default Electron icon on Windows, duplicate `ajv` dependency, and Node `DEP0190`. It does not prove the artifact can render. |
| `npm.cmd run desktop:verify` | **FAIL**, exit 1 | Service-level offline smoke passed; production profile hash remained unchanged. Packaged renderer GPU subprocess repeatedly exited `-1073741515`, then Electron fatally reported “GPU process isn't usable,” process result `2147483651`. Diagnostic test profile was preserved. |
| `node --test tests/*.test.js` | **FAIL**: 495 tests, 489 pass, 6 fail | Broadest actual test-file execution. Fails long-world persistence, actual Electron settings due the same GPU crash, and four stale/contradictory y34/y35 expectations. The stale tests are suite-drift evidence, not all current product regressions. |
| `node tools\yb33-torture-report.js` | Exit 0 but JSON says **`passed: false`**, `deterministic: true`, `canonical_turns: 2650`, `canonical_events: 2544`, `save_reload_equivalent: false` | A real persistence divergence. Because the report process exits 0 and `npm test` only prints it, the official green suite conceals this failure. The dedicated `tests/y33-long-world-torture.test.js` correctly asserts `report.passed === true`, but that test is omitted from `npm test`. |
| `node --test tests/y54-settings-regression.test.js tests/y55-survey-frontier.test.js tests/y56-persistent-procedural-complex.test.js tests/y58-assignment-engine.test.js tests/y59-career-loop.test.js tests/y60-personnel-continuity.test.js tests/y61-local-standard.test.js tests/y62-evidence-archive.test.js tests/y62-pass17-human-gate.test.js tests/y63-evidence-media.test.js tests/y63-pass17-state-machine.test.js tests/y64-environment-simulation.test.js tests/y64-pass17-authority.test.js tests/y65-phenomenon-ecology.test.js tests/y66-outcomes-retirement.test.js tests/y67-recovery-profile.test.js` | PASS: 79/79 | Current subsystem contracts and fixtures. It does not prove a person can play them through the package. |

### Tests that look like playability but are not

- `tests/y26-desktop.test.js` instantiates `DesktopService`, calls methods directly, and can start Clear-Q4 without traversing the actual UI. It proves persistence/API contracts.
- `tests/y49-playable-spine-map.test.js` mostly uses direct service calls and some renderer-source regex assertions. Its helper still drives the historical READY → PROCEED → APPROACH → CROSS sequence even though new release sessions expose only DEPLOY.
- `tests/y62-pass17-human-gate.test.js` is named “human gate” but constructs the service directly (`:11-16`). It proves no human interaction.
- `tests/y63-pass17-state-machine.test.js` is a service state-machine regression, not a packaged playthrough.
- `desktop/first-run-smoke.js` uses real Electron input, but stops when the personnel-creation surface appears (`:86-119`). It does not create personnel or play the game.
- `desktop/renderer-smoke.js` uses real Electron input through field entry, but its LOCAL assertion only verifies that the player’s nonce is echoed in the timeline (`:43`), not that any coworker gives a meaningful response. Its natural-action assertion submits a move and waits; it does not assert a meaningful consequence (`:44`).
- Acceptance scripts can generate detailed evidence while still being scripted fixtures. Several report commands serialize `passed: false` without returning a failure exit code.

## Critical implementation blockers

### P0

1. **No certifiable Windows release artifact on the audited environment.** The service smoke passes inside the package, but the renderer GPU process dies before a playable window. Root cause is not established; `-1073741515` is consistent with a missing subprocess dependency, but that remains a diagnosis hypothesis.
2. **Long-world persistence is not equivalent across save/reload.** The official test command masks this. A persistent-world game cannot advance while its stress authority reports divergence.
3. **There is no valid human acceptance history.** The project’s own definition makes the claimed completed passes incomplete until successful, degraded, and controlled-abort operations are completed through the release UI.

### P1 architectural/game blockers

1. Active phenomenon and fatal outcome systems depend on developer controls, so normal play cannot prove the promised danger/consequence loop.
2. LOCAL can be technically delivered but experientially empty. Blank dialogue is a direct playable-spine failure.
3. Natural input is a bounded synonym router, not the compound action/constraint interface promised by the charter.
4. The pre-field experience is compressed into `DEPLOY`; staging, equipment preparation, Facility transit, and Threshold passage are not meaningful play.
5. Settings and presentation authorities have drifted: unused audio/reopen/reduced-sensory settings, an always-present mixed input UI, and a broken refresh comparison.
6. A 131,848-byte one-line-heavy `desktop/service.js`, a 55,610-byte renderer, and a 54,126-byte surfaces module concentrate too many authorities and make shadowed paths difficult to detect.

## Dead code, duplication, and false completion

- Duplicate `compactLayout` functions; one is dead by JavaScript function hoisting/override.
- `legacyCommunicationLanes` and multiple older surface families remain beside current operational surfaces.
- Both canonical spatial state and legacy procedural state can coexist in the same Clear-Q4 run/save.
- Three world modes are extensively implemented and tested but intentionally blocked from production UI. They are horizontal investment with zero current player reachability.
- Audio settings and `YBAudio` exist without any call site; this is scaffolding, not sound design.
- Pre-field guidance copy exists for phases that the guidance guard suppresses.
- `reopen_last_world` is persisted but boot always opens the library.
- The new-world program choice is rendered but not consumed.
- The renderer refresh result is fetched but discarded because it compares a world ID against a mode ID.
- “Playable spine,” “human gate,” and “desktop” test names overstate their evidence tier.
- `npm test` is green while omitting y33–y66 generations except manually selected scripts and while printing a failed torture report as success.

## Concrete playable-spine gap list

1. A packaged app that reliably opens a visible window on supported Windows machines.
2. A true first-run release-UI recording from empty profile through debrief and relaunch.
3. Honest “Establish” versus “Establish and begin” flow, with the selected program actually consumed or removed.
4. Player-understandable preparation: personnel, required equipment, optional supplies, route, risks, and departure decision.
5. An experienced Threshold crossing rather than a phase-history jump.
6. LOCAL dialogue that always yields meaningful, character-consistent feedback when delivery succeeds.
7. Natural input that can decompose at least one compound coworker + player instruction, or UI/copy that honestly narrows its promise.
8. One ordinary, non-fixture phenomenon encounter whose state advances from player/environment stimuli.
9. One legitimate production route to serious injury and one to death/retirement, both with understandable causal feedback.
10. A successful operation, a degraded operation, and an abort through release UI.
11. Exact persistence across relaunch for both one operation and a long-lived multi-operation world.
12. Real interface/radio/ambient audio or removal of audio claims/settings until implemented.

# Audit 2 — Game / experience

## Packaged fresh-player attempt

The package was launched in a marked, isolated temporary profile. No Yellow Beast `BrowserWindow` became available. A second attempt with GPU disabled also exposed no usable window. `desktop:verify` then reproduced the concrete GPU-process failure above. Consequently there is no honest screenshot-based or mouse-driven full playthrough to award.

The fallback fresh-player trace used a new isolated profile at `C:\Users\jroch\AppData\Local\Temp\yb-audit-player-aa44yN`. It used the production service and renderer surfaces, not developer fixtures.

## What the player can actually do, stage by stage

| Stage | Actual capability | Experiential finding |
|---|---|---|
| Library / creation | Create one persistent named record; only Clear-Q4 is authorized | Clear enough, but “Establish and begin” returns to the library. Program selection is ceremonial. |
| Personnel | Enter first/last name, confirm identity | Functional and legible. Portrait presentation is generic fallback. |
| Briefing | Read assignment `CQ4-WO-0001`, roster, objectives, equipment; choose DEPLOY | The first substantial information surface exists. It is dense but coherent. Off-path pre-field movement is rejected. |
| Staging/transit/Threshold | Press DEPLOY | The game jumps to Threshold-side radio check. No meaningful preparation, Facility navigation, coworker interaction, or crossing occurs. |
| STANDARD radio | Type arbitrary message; receive acknowledgment; unlock field | Operationally clear. The channel behaves like a protocol form, not a person. Empty input is rejected. |
| Field entry | Arrive in Utility Room with visible fixture, scuffs, panel, routes, team, environment, objectives | This is the strongest game-like moment. The player has a place, responsibilities, uncertain exits, objects, people, and a return route. |
| Structured interaction | LOOK, inspect/move/use/photograph/communicate/wait/return/abort/order/mark using projected targets | Core authoritative actions work. The number of controls and hidden dependencies increase cognitive load. |
| Navigation | “Move west” reaches Columned Corridor; exact east target returns; invalid north-wall move is rejected | Basic spatial agency is real. “MOVE back” from the corridor was rejected as `ROUTE_UNCONFIRMED` while the exact east route worked, exposing brittle phrasing/target semantics. |
| LOCAL | Ask Wilfred what he makes of the conduit | Delivery succeeded, broadcast to all nearby coworkers despite the target, and the coworker response was exactly two spaces. This is technically present and experientially absent. |
| Authored ACTION | “Wedge the door … have Wilfred photograph … while I inspect …” | Rejected with `INTERACTION_TARGET_UNAVAILABLE`; no constituent action or partial resolution. This is the precise boundary of the state-machine interface. |
| STANDARD off-happy path | Report that the entire sector is mapped and completely safe | Accepted as a player claim without rewriting truth. That separation is correct doctrine. Feedback does not provide a rich operator response. |
| Danger / consequence | Move, wait/communicate, then abort | A teammate injury and assist/mitigate affordances emerged in a short run. The debrief preserved the injury, but the causal event was not prominent in the primary narrative. No entity encounter occurred. |
| Return / abort | ABORT changes phase to RETURN; retrace corridor → Utility Room → Threshold; inspect marker; COMPLETE_RETURN | A genuinely physical return exists. However COMPLETE_RETURN is displayed even when reconciliation is incomplete and initially fails with `RETURN_RECONCILIATION_INCOMPLETE`; the UI does not foreground the unmet requirement. |
| Debrief / continuation | Receive controlled-abort outcome, institutional consequence, then ADVANCE_OPERATIONS | Functional. A second assignment `CQ4-WO-0002` is generated and coworkers/history persist. |
| Relaunch/resume | Shutdown/reopen service and resume exact phase/location | Short-run persistence worked. The packaged window did not, and long-world canonical equivalence failed. |

## Where it stops feeling like a playable simulation

There are three distinct breaks:

1. **At DEPLOY.** Briefing, staging, Facility transit, Threshold preparation, and crossing collapse into a phase jump. The player stops being a worker moving through an institution and becomes an operator advancing a state machine.
2. **At the first LOCAL question.** A successfully delivered question produces blank dialogue. Coworkers cease to feel like characters at the exact moment the player tries to treat one as a person.
3. **At the first compound authored action.** The charter-level worker/player instruction is rejected wholesale. The player learns that ordinary language is accepted only when it maps cleanly to the bounded verb/target table.

The Utility Room itself briefly feels like a vertical slice: it has place, equipment, objectives, people, uncertain routes, and consequences. The feeling does not survive exploratory social or compound physical input.

## Game-dimension grades

| Dimension | Grade | Assessment |
|---|---:|---|
| Launch/install reliability | **F** | Package could not expose a renderer on the audited Windows environment. |
| Onboarding | **D+** | Identity and briefing are legible; creation loops back, pre-field guidance is suppressed, and preparation/crossing are skipped. |
| Comprehension / information flow | **C** | Mission/objectives/map/status are detailed, but the interface is dense and return/equipment dependencies can be hidden. |
| Agency | **D+** | Structured choices and movement are real; authored intent collapses outside a narrow grammar. |
| Pacing | **D** | One-click deployment removes useful buildup, while dense field panels and procedural requirements slow action without producing drama. |
| Objectives / mission clarity | **C+** | Objective state and blockers are unusually concrete. Some requirements are discoverable only after rejection. |
| Navigation / exploration | **C** | Spatial movement, map, unknown exits, persistent expansion, and route return exist. Natural target language is brittle and procedural depth lacks human proof. |
| STANDARD | **C** | Distinct, authoritative, persistent, and doctrine-correct; conversationally mechanical. |
| LOCAL | **F** in the audited interaction | Delivery exists, but blank response and broadcast semantics erase social meaning. |
| ACTION / interpreter | **D+** | Safe simple movement and object verbs; no credible compound agency. |
| NPC autonomy / characterization | **D** | Persistent records and task states, but little convincing self-directed character behavior in ordinary play. |
| Environment / simulation reactivity | **C-** | Conditions, hazards, operational time, injuries, and route state interact. Causality is not consistently legible. |
| Procedural geography as experienced | **C-** | System is present and persistent; the audited slice remained in authored topology and did not prove experiential variety. |
| Danger / uncertainty | **D** | Uncertainty and incidental injury exist; signature active encounters and terminal risk are not ordinarily reachable. |
| Consequences / debrief | **C** | Abort, injury, accountability, institutional history, debrief, and follow-up persist. Major outcome families remain fixture/test-heavy. |
| Failure/death/retirement | **F** as normal gameplay | Controlled abort works. Death/retirement authority is implemented but no normal fatal path was found. |
| Persistence | **C-** | Strong short-run design and recovery; long-world equivalence fails. |
| Replayability | **D+** | Seeds, assignments, teams, geography, and continuity vary; meaningful interaction variety has not caught up. |
| UI ergonomics / accessibility | **C-** | Clear institutional styling and rich status; dense surfaces, broken refresh, suppressed guidance, and incomplete settings. |
| Audio feedback | **F** | No connected audio experience. |
| ASYNC/lore authenticity | **B-** in writing, **C-** in play | Terminology, observer boundaries, bureaucracy, field procedure, and reports are strong. Collapsed phases and blank/canned people make the institution feel simulated as data rather than inhabited. |
| Overall playability | **D+** | A substantial interactive slice exists, but the distributable and lived loop are not alpha-ready. |

## Experience gaps by priority

### P0 — blocks any “playable alpha” claim

1. Make the packaged release reliably open and render on a clean supported Windows environment; capture the full native-input run.
2. Fix and explain the 2,650-turn save/reload divergence; make the torture report fail the command when `passed` is false.
3. Put all current test files and report assertions behind one authoritative release command.
4. Complete the three required human release-UI outcomes: successful, degraded, and controlled abort, including quit/relaunch/resume.

### P1 — required for a convincing vertical slice

1. Guarantee meaningful LOCAL response or explicit non-response; never render successful speech as blank whitespace.
2. Make one coworker recognizably individual through portrait/identity, speech, memory, task choice, and continuity.
3. Support one compound worker + player instruction end-to-end, including partial failure and constraint feedback.
4. Turn preparation and Threshold entry into meaningful choices/actions, or explicitly narrow the design instead of pretending the phases are played.
5. Wire one active phenomenon encounter into ordinary eligibility/stimulus/advance without developer fixtures.
6. Wire legitimate injury → incapacity → death/retirement possibilities into normal causal play and verify observer-safe presentation.
7. Make return readiness and reconciliation blockers visible before presenting COMPLETE_RETURN.
8. Connect real audio layers and controls, or remove audio settings/claims until the system exists.
9. Give each coworker a distinct deterministic fallback portrait.

### P2 — quality and maintainability

1. Remove duplicate/shadowed renderer functions and legacy surface paths.
2. Eliminate or formally migrate the duplicate legacy procedural state.
3. Split the service/renderer monoliths along authority boundaries.
4. Fix refresh-view comparison, reopen-last-world, reduced-sensory/audio settings, and input-mode semantics.
5. Make world creation either begin immediately or rename the action honestly; consume or remove the program selector.
6. Configure the Windows icon and clear packaging warnings.
7. Retire stale y34/y35 tests or explicitly scope them as historical fixtures.

# Final synthesis and remediation roadmap

## Minimum vertical slice before any horizontal expansion

The minimum acceptable slice is one complete Clear-Q4 workday, not one more subsystem:

1. Clean packaged launch on a new Windows profile.
2. Create and name a world; create and confirm personnel.
3. Understand assignment, coworkers, required kit, known route, risks, and return conditions without external explanation.
4. Perform at least one meaningful staging/equipment decision.
5. Experience Facility transit and the Threshold as a legible transition with accountability and radio procedure.
6. Enter a persistent field location with at least two possible routes and one unresolved frontier.
7. Perform meaningful object work and retain evidence.
8. Have a nonblank LOCAL exchange with an identifiable coworker.
9. Give a compound instruction that assigns a coworker action while the player performs another action; resolve constraints honestly.
10. Make a STANDARD report whose claim remains separate from truth and receives a contextual operator response.
11. Trigger one ordinary environment or phenomenon complication without developer controls.
12. Produce a consequence the player can causally understand.
13. Complete one success, one degraded result, and one controlled abort across three runs.
14. Physically return, receive grounded debrief/follow-up work, quit, relaunch, and resume exact persistent state.
15. Repeat enough operations to cross the long-world save/reload gate.

Until all fifteen work through the packaged UI, do not expand LOST, Beck, Nullzone, new phenomenon families, new visual adapters, or broader campaign content.

## Remediation order, dependency, and Jack gates

### Phase 0 — Make evidence trustworthy

- Repair packaged renderer launch.
- Replace the hand-curated default test list with an authoritative current suite.
- Make every report command return nonzero when its own `passed` field is false.
- Resolve stale contradictory tests.
- Diagnose and fix long-world save/reload divergence.

**Jack Gate 0:** On a clean machine/profile, Jack launches the exact packaged artifact, sees a window, creates a named world, quits, relaunches, and reopens it. Continuous recording required.

### Phase 1 — Repair the human spine

- Correct world-creation flow and pre-field guidance.
- Make equipment, departure, Threshold, and return dependencies visible.
- Fix blank LOCAL responses and distinct coworker presentation.
- Fix renderer refresh/settings drift.

**Jack Gate 1:** Jack reaches the Utility Room with no external explanation and can state the assignment, route, kit, coworkers, Standard status, risks, and return requirements.

### Phase 2 — Prove meaningful agency

- Implement or honestly scope compound natural action.
- Ensure partial success, clarification, and no-mutation failures are legible.
- Make NPC task behavior and LOCAL replies character-specific and persistent.
- Exercise player lies, ambiguity, weird inputs, unsupported targets, separation, lost equipment, and bad decisions.

**Jack Gate 2:** Jack completes a recorded exploratory run containing at least 20 off-happy-path inputs and one successful compound coworker/player instruction; no blank/canned-success response and no unexplained mutation is accepted.

### Phase 3 — Prove simulation danger and consequences

- Connect ordinary phenomena stimuli to active behavior.
- Connect environmental/entity events to legible injury, incapacity, recovery, death, and retirement authorities.
- Preserve observer limits and aliases through evidence/reports.

**Jack Gate 3:** Without developer mode, Jack encounters one ordinary active phenomenon, experiences or witnesses a serious consequence, and verifies that the debrief, personnel history, equipment custody, evidence, and next assignment all reflect it.

### Phase 4 — Certify the operation loop

- Balance one successful, one degraded, and one abort route.
- Verify mission blockers and return readiness before closure.
- Verify multiple operations and follow-up generation.
- Add connected audio/presentation only where it clarifies existing causal state.

**Jack Gate 4:** Jack completes the roadmap’s three required outcomes using only release UI. Each is recorded from launch through debrief and relaunch.

### Phase 5 — Certify persistence and replayability

- Run multi-operation soak and long-world torture through save/reload cycles.
- Verify distinct seeds, personnel recognition, recovered/lost equipment, geography growth, institution memory, and no observer leakage.
- Run accessibility and reduced-sensory checks.

**Jack Gate 5:** Jack resumes a veteran world after multiple operations and can accurately describe what changed in world terms—not by naming interface widgets. Automated canonical equivalence must also be green.

Only after Gate 5 should horizontal expansion resume.

## Prior “complete” statuses contradicted by evidence

1. **Pass 10D and Passes 11–16C:** implementation handoffs call them completed or automated-accepted while their human validations remain pending. Under roadmap line 1513, they are not complete.
2. **Pass 10B player loop:** its mandatory human successful/degraded/abort UI gate has not been supplied.
3. **Pass 12 procedural world:** runtime authority is substantial, but a duplicate legacy procedural state remains and human procedural-play evidence is absent.
4. **Pass 14B LOCAL/Standard:** delivery authority exists, but the audited LOCAL response was blank; player-facing dialogue is not complete.
5. **Pass 16B phenomenon ecology:** canonical entities are implemented, but active production behavior is not ordinarily initiated; developer fixture success is not normal reachability.
6. **Pass 16C outcomes/retirement:** terminal authority exists, but player death was found only in developer fixture control; game-over playability is unproven.
7. **Pass 17 presentation/human gate:** explicitly reopened and still pending; package verification now fails on the audited environment. Audio and distinct visual identity are not complete.
8. **Recovery Prompt 1:** correctly scoped itself to clean-profile world creation, but its prior automated pass cannot be generalized to settings, dialogue, action, exploration, onboarding, or later game.
9. **`npm test` green status:** contradicted by the omitted y33 long-world test and the report’s own `passed: false`, plus the broad 6-test failure set.
10. **“Playable beta” packaging/version language:** contradicted by README’s own `Q4 BETA NOT AUTHORIZED`, the missing human gates, and the non-rendering audited package.

## Repository preservation

The target repository remained clean at the end of the audit. No source, documentation, save, production profile, or generated repository file was modified. Tests used isolated marked temporary profiles. Failed packaged renderer diagnostics were preserved under the OS temporary directory as designed.
