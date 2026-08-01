YELLOW BEAST PASS 10
Release Candidate, Kane Fidelity, First External Beta

This is the final planned development pass for the current Yellow Beast / Custodian cycle.

Do not treat this as another architecture milestone. Omnipass 7–9 already delivered the complete simulation, institutional, logistics, worldpack, mission, persistence, and packaging foundation.

Pass 10 must turn that foundation into the first coherent, polished, accessible, replayable, distributable Yellow Beast beta.

The objective is not “more systems.”

The objective is:

A first-time Windows player can launch Yellow Beast without repository knowledge or an API key, understand the interface, complete a credible Clear-Q4 field operation, experience persistent consequences, save and resume safely, export a useful tester report, and immediately understand why this game could only exist inside the Kane Pixels Backrooms interpretation that inspired it.

This pass has broad implementation authority. Redesign weak surfaces rather than preserving them. Do not stop merely because an improvement crosses several files. Do not ask permission for safe in-scope redesigns. Stop only for a concrete safety, authentication, ancestry, validation, or merge blocker.

Work efficiently. Keep updates limited to material findings, implemented slices, regression results, release gates, and blockers. Do not spend the pass narrating obvious repository exploration.

Current repository truth

Begin by establishing and recording the following:

Repository: flashpwns/custodian-worldpack-backrooms
Target branch: main
Omnipass 7–9 merged through PR #42
Expected merge commit in main: b81165b3c99562b30ff3cdd73d84e5c6c04865ad
Current product version before Pass 10: 0.13.0-alpha
Existing complete operation: clear-q4
Existing full automated baseline: 357 tests
Existing renderer acceptances:
playable spine
structured interactions
mission state
operational dynamics
Omnipass 7–9
Existing packaged Windows alpha and packaged offline smoke
Existing hosted Windows and macOS packaging
Existing save compatibility through Yellow Beast save v9
Existing deterministic worldpack validation, preview, trace, test, and fixture-pack workflows

Use the github:yeet workflow for the complete handoff.

Create a clean branch from the verified origin/main state:

agent/pass-10-release-candidate

Before modifying code:

Read all repository instructions and applicable skill files.
Read:
START-HERE.md
docs/GAME_READINESS_AUDIT.md
docs/PLAYABLE_GAME_ROADMAP.md
all current acceptance documentation
worldpack authoring guides
the project rulebook and simulation lifecycle material
the admitted canon and intake records
Confirm clean ancestry and a clean working tree.
Run the complete existing baseline exactly once.
Record baseline package paths, startup time, package size, save format, and known warnings.
Distinguish pre-existing failures from Pass 10 regressions.

Do not weaken tests merely to obtain green output.

Product release target

Promote Yellow Beast from alpha to the first beta release.

Preferred version:

0.14.0-beta.1

Use another SemVer-compatible beta identifier only if the repository already enforces a different release convention.

Update all relevant:

package metadata
desktop title and app information
visible Alpha/Beta labels
package names
diagnostic reports
acceptance metadata
START-HERE instructions
release notes
save metadata where appropriate
generated artifact names

The complete mode should be presented as:

Async: Clear-Q4 — PLAYABLE BETA

Experimental modes must be clearly identified as experimental and visually secondary. A first-time player should not accidentally enter an incomplete mode and conclude that it represents the finished beta.

Governing creative principle

Do not make Yellow Beast constantly exciting.

Make it constantly credible.

Kane fidelity is not established by yellow wallpaper, VHS overlays, an ASYNC logo, cryptic prose, frequent entities, or theatrical horror cues.

The defining fantasy is:

A serious institution has attempted to operationalize a place fundamentally incompatible with complete human knowledge.

Every Pass 10 decision must preserve:

mundane operational credibility
institutional competence without omniscience
observer-limited knowledge
environmental independence
architectural ambiguity
procedural personnel
restrained presentation
delayed and incomplete information
human residue without explanatory certainty
consequences that exist before they are narrated
documentary observation rather than authored spectacle

The simulation resolves first.

Presentation remains final.

1. Kane fidelity and lore-provenance audit

Perform a complete fidelity audit against the actual repository corpus.

Inspect:

admitted canon records
intake records and their review states
existing source claims
project rulebook
simulation lifecycle rules
current Clear-Q4 worldpack content
current institutional prose
current environmental descriptions
current audio and visual treatment
current hazard behavior
current teammate behavior
current debrief and follow-up behavior

Create:

docs/KANE_FIDELITY_AUDIT.md
docs/acceptance/KANE_FIDELITY_ACCEPTANCE.md
docs/acceptance/KANE_FIDELITY_EVIDENCE.json
docs/acceptance/KANE_FIDELITY_ACCEPTANCE.html

Classify every significant creative element as one of:

directly source-supported
bounded extrapolation
original connective tissue
unsupported

Record:

source or provenance
confidence
why the extrapolation is bounded
player-facing implementation
risk of tonal drift
required correction, if any

Remove or rewrite unsupported elements that falsely present themselves as canonical.

Original connective tissue is allowed and necessary, but it must not masquerade as a confirmed lore fact.

Maintain the project’s unofficial fan-project disclaimer. Do not import copyrighted film audio, music, video, imagery, logos, or extracted assets that are not already lawfully part of the repository.

Fidelity categories

Audit all of the following:

Architecture

Target:

mundane construction
physically legible materials
subtly incorrect arrangement
spaces that appear functional before they appear frightening
routes that exist for plausible architectural reasons
spatial relationships that are not arranged around dramatic pacing

Reject:

arbitrary horror mazes
decorative “liminal” clutter
doors locked only to create puzzles
rooms whose only function is to contain an encounter
geometry that performs for the player
Institution

Target:

competent procedure
incomplete information
conservative decisions
documentation and accountability
believable delays
bounded resource allocation
institutional memory derived from available evidence

Reject:

omniscient Standard
cartoon villainy
deliberate stupidity used to force drama
instant responses
unexplained mission knowledge
exposition delivered as institutional dialogue
Personnel

Target:

ordinary workers
credible assigned roles
bounded autonomy
professional communication
individual uncertainty
behavior shaped by location, custody, contact, qualification, and prior events

Reject:

action heroes
lore dispensers
constant quips
excessive emotional narration
teammates waiting motionless for player commands
fixed personality scripts detached from state
Complex

Target:

independent operation
partial observability
architecture and systems continuing beyond the player
phenomena not triggered merely by player proximity
uncertainty surviving the debrief

Reject:

dungeon logic
encounter queues
dramatic escalation because the player is bored
objective truth exposed through interface copy
Threat

Target:

rare
consequential
often indirect
ambiguous until legitimately observed
compatible with a compelling routine run in which no entity appears

Reject:

enemy waves
boss logic
encounter quotas
danger music
frequent chase sequences
threats used as the sole source of interest
Information

Target:

true
observed
recognized
recorded
reported
delivered
believed
confirmed
presented

These states must remain distinct.

Reject:

omniscient map information
hidden teammate status
exact hazard truth before detection
Standard’s private rationale in normal player UI
“correct route” indicators
lore encyclopedias that explain unresolved events
Failure

Target:

material consequences
procedural consequences
personnel consequences
institutional consequences
recoverable and irrecoverable distinctions
outcomes that persist beyond a death or restart screen

Reject:

generic “you died”
instant reload as the only consequence
scripted debrief text detached from final state
Narrative

Target:

story produced by evidence, absence, custody, communication, timing, behavior, and aftermath

Reject:

scripted plot rails
monologues
lore dumps
forced cinematic escalation
2. First-run onboarding

A new user must be able to play without reading the repository.

Design a restrained, diegetic onboarding path that does not expose developer truth.

The first launch should clearly support:

Launch
Create or resume a world
Select Async: Clear-Q4 — PLAYABLE BETA
Create or confirm generated personnel
Read the assignment
Configure the loadout
Proceed to the Threshold
Enter the operation
Understand the immediate objective
Act
Return or abort
Review the debrief
Continue into follow-up

Requirements:

The primary playable path is immediately visible.
Experimental modes are secondary and clearly labeled.
Every phase explains its immediate purpose in concise operational language.
The player can inspect additional help without being forced through long tutorials.
Onboarding may be dismissed and reopened.
Onboarding completion persists.
Contextual help must never expose hidden state.
Unavailable actions must state the grounded requirement.
Empty states must explain what the player can do next.
Errors must suggest a recovery path.
Startup, loading, saving, provider, and offline states must be understandable.
The player must be told that OpenAI presentation is optional.
The offline interpreter must remain the default legal-action path.
A user must never need an API key to complete Clear-Q4.

Add an accessible in-game field manual containing:

controls
movement
observation
team orders
radio reporting
evidence
inventory and containers
save and resume
return and abort
tester report export
troubleshooting

Do not turn the field manual into a lore encyclopedia.

3. Scene-first interface cleanup

Preserve the authority boundary:

simulation truth
→ observer-safe projection
→ renderer

The renderer must not own world, mission, inventory, institutional, hazard, or personnel truth.

Audit every phase at:

1280×720
1366×768
1920×1080
150% Windows display scaling
200% browser/application zoom where supported

Refine the interface hierarchy so the player sees, in order:

current place or phase
current observation
immediate operational priority
available meaningful actions
critical team or communication state
supporting inventory, map, evidence, and institutional records

Do not present every system with equal visual weight.

Inventory UX

The current inventory system is authoritative and complete. Pass 10 should make it pleasant.

Requirements:

prioritize the two or three most relevant legal actions
preserve the complete keyboard-accessible list fallback
group equipment by custody or operational relevance where useful
avoid showing a wall of disabled buttons
preserve unavailable reasons
make holder, container, location, condition, charge, quantity, and loadout status readable
make container contents and capacity understandable
make transfer, storage, recovery, and reconciliation feel like one coherent system
preserve atomic transaction semantics
never imply access to distant or last-known items
clearly distinguish current knowledge from last-confirmed custody
Institutional UX

Standard’s visible posture must feel like an operational record, not a reputation meter.

Avoid gamified labels, morality bars, approval points, or hidden numerical scores.

Show only institutionally defensible public state:

delivered instruction
current restriction
acknowledged report
available follow-up
public staffing or equipment consequence
review status when legitimately communicated

Private rationale remains developer-only.

Interface language

Audit player-facing copy for:

excessive verbosity
generic AI prose
repeated explanations
developer terminology
internal IDs
predicate language
absolute claims unsupported by observation
dramatic horror writing
modern casual language inconsistent with the project tone

Rewrite toward concise, period-compatible, operational language.

4. Accessibility certification pass

Perform a comprehensive accessibility review rather than adding scattered ARIA labels.

Support:

complete keyboard-only play
logical tab order
visible focus
predictable focus restoration after rerender
no keyboard traps
screen-reader-readable labels
heading hierarchy
form labels
meaningful button names
announcement of important state changes
reduced motion
sufficient contrast
no color-only meaning
application zoom and text scaling
minimum practical target size
disabled-control explanations
captions or textual equivalents for meaningful audio
independent master, interface, ambience, and voice volume controls if audio exists
full mute
persistent accessibility preferences

Create automated and renderer-backed acceptance for:

keyboard-only completion of a representative operation path
focus order
disabled-action explanation
reduced-motion mode
high zoom
accessible naming
no critical color-only state

Document limitations honestly. Do not claim formal third-party certification unless one actually occurs.

5. Audiovisual and atmospheric polish

Polish the existing interface rather than transforming Yellow Beast into an unrelated graphical game.

Visual goals:

institutional workstation credibility
restrained ASYNC-adjacent design language
consistent spacing
durable typography
readable density
clear paper, terminal, instrument, and status metaphors
subtle environmental distinction between controlled space and the Complex
no ornamental glitch spam
no fake VHS filter over every surface
no excessive animation
no “haunted computer” clichés

Fix the known Windows default-icon warning.

Ensure correct icons appear in:

executable
taskbar
title bar
packaged archive
installer, if produced
shortcuts, if produced

Audio may be added or refined only when it improves operational presence.

Audio principles:

original or properly licensed assets only
fluorescent, electrical, mechanical, radio, ventilation, distant structural, and room-tone emphasis
silence is allowed
long quiet intervals are allowed
no constant horror drone
no danger stinger revealing hidden state
no entity theme
no copyrighted Kane soundtrack or extracted film audio
audio cannot communicate knowledge unavailable to the player
meaningful sounds require accessible text equivalents where necessary
user can mute everything

The target is not “scary audio.”

The target is architecture behaving like an instrument.

6. Replayability, pacing, and balance

Do not add random content merely to inflate variation.

Measure the current operation before tuning it.

Create an automated deterministic replay harness that runs multiple strategies across at least 30 seeds, including:

cautious completion
direct required-objective completion
optional-evidence pursuit
strict check-in protection
specialist separation
team cohesion
hazard mitigation
hazard avoidance
equipment recovery
deliberate equipment abandonment
controlled abort
degraded return
failed operation
personnel-loss probe where safely available through deterministic test state
shutdown and restart during escalation
shutdown and restart before debrief
follow-up mission generation

Record:

action count
operational interval count
phase duration
time to first meaningful choice
time to first field observation
check-in timing
route selected
equipment consumed
evidence captured and reported
consequence count
outcome
follow-up produced
restart equivalence
impossible or deadlocked states
dominant strategy frequency

Tune only where evidence identifies a problem.

Goals:

routine runs remain absorbing without mandatory escalation
optional work presents a real cost
communication windows are understandable
no single loadout dominates every route
no required item becomes a false choice
alternate return is useful but not universally superior
hazard mitigation rewards preparation without becoming a key-and-lock puzzle
recovery decisions cost time or risk
controlled abort is legitimate, not a disguised failure button
all seven outcome families remain reachable through condition-driven paths
no outcome is selected by a presentation button alone

Do not introduce hidden rubber-banding.

Do not manipulate the world merely because the player is progressing too quickly or slowly.

7. Reliability, persistence, and recovery

Treat save integrity as release-critical.

Verify exact persistence of:

world history
run identity
mission
phase
spatial state
discovered routes
object state
operational time
event queue
communication delivery
check-ins
teammate state
teammate location
teammate task
equipment
containers
custody
evidence
hazards
consequences
institutional knowledge
institutional decisions
restrictions
follow-up assignments
final outcome
onboarding and settings

Requirements:

preserve compatibility with every supported historical save version
reject unsupported future versions clearly
never silently reset a save
use atomic writes
preserve or improve backups
recover safely from interrupted writes
distinguish repairable corruption from unrecoverable corruption
allow export of broken-world data
preserve user data during beta upgrade
preserve user data when replacing the portable build
document application-data location
test unusual Windows paths and spaces
test restart from every major Clear-Q4 phase
test restart after institutional closure
ensure closure remains idempotent
ensure follow-ups cannot duplicate through repeated load or debrief

Add corruption and interruption tests without damaging actual user data.

8. Performance profiling

Profile rather than guessing.

Measure:

cold launch
warm launch
create world
resume world
projection generation
ordinary action latency
inventory action latency
mission evaluation
save
load
debrief generation
tester report export
memory use during a complete operation
save file growth
acceptance artifact generation
packaged offline launch
package size

Establish realistic documented budgets based on the current desktop architecture and development hardware.

Investigate:

repeated full-state cloning
repeated migrations during projections
nested inventory projection work
excessive rerenders
duplicated schema loads
repeated filesystem reads
unbounded history projections
large acceptance payloads entering production code
listeners added repeatedly after rerender
long synchronous work on the renderer thread

Optimize only with equivalence tests.

No performance optimization may weaken persistence, determinism, observer safety, or transaction atomicity.

Create:

docs/PERFORMANCE_PROFILE.md
docs/acceptance/PASS_10_PERFORMANCE_EVIDENCE.json
9. Windows and macOS beta packaging

The resulting beta must be launchable by a normal tester.

Windows

Produce and verify:

packaged x64 application
portable ZIP
unpacked executable for development smoke
installer where the existing Electron tooling supports it safely
correct application icon
version metadata
clean launch without Node or repository dependencies
offline interpreter operation
save and resume
tester-report export
uninstall or replacement without deleting user worlds by default

Preferred artifacts:

dist/desktop/Yellow Beast-0.14.0-beta.1-win.zip
dist/desktop/win-unpacked/Yellow Beast.exe

Produce an installer only if it can be verified. Do not fabricate code signing or trusted-publisher status. If no trusted signing certificate exists, document Windows SmartScreen behavior honestly.

macOS

Produce and verify the existing supported beta package.

Do not allow a macOS-only packaging problem to invalidate a proven Windows build silently. Report each platform separately, while preserving required hosted-check policy.

Updating

Do not bolt on a fake auto-updater.

Either:

implement a complete, tested, secure updater, or
document a manual beta update process that preserves %APPDATA%\Yellow Beast\

The second option is acceptable for Beta 1.

Generate checksums for final distributable archives.

10. Privacy, security, and offline behavior

Yellow Beast must remain local-first.

Requirements:

no telemetry
no analytics
no network request by default
OpenAI provider remains opt-in
API credentials never enter saves, tester reports, screenshots, HTML acceptance, logs, or Git history
logs sanitize secrets and sensitive environment values
tester reports exclude raw API keys and unnecessary personal paths
worldpack paths remain traversal-safe
imported worldpacks remain schema validated
rendered authored text remains escaped
AI-generated presentation remains validated against safe fact references
malformed AI output falls back deterministically
provider failure cannot corrupt or block simulation state
offline play remains complete
deleting or removing the provider restores deterministic fallback cleanly

Review dependency and package security without performing unrelated broad upgrades that destabilize the release.

11. Tester-report and beta feedback workflow

The existing tester-report capability must become useful to an external player.

A player should be able to export one sanitized bundle containing:

Yellow Beast version
platform
package type
world/run identifiers safe for debugging
current mode and phase
recent public interaction history
relevant error codes
renderer console errors
launcher log excerpt
save/schema versions
provider status without secrets
acceptance of offline fallback
deterministic reproduction seed where safe
description field supplied by the tester
optional screenshot attachment only when explicitly selected
clear privacy disclosure

Create:

docs/BETA_TESTER_GUIDE.md
docs/BETA_BUG_REPORT_TEMPLATE.md
docs/BETA_KNOWN_ISSUES.md
docs/TROUBLESHOOTING_WINDOWS.md
docs/UPGRADE_AND_DATA_SAFETY.md

Do not claim that external human testing occurred unless actual human test records exist.

Pass 10 must prepare and validate the external beta workflow. Jack’s first playthrough begins the real human beta.

12. Required Kane playtest tapes

Create renderer-backed, machine-readable evidence for six canonical playtest profiles.

Tape A: Routine survey
no forced anomaly
no mandatory casualty
no theatrical escalation
operation remains engaging through procedure, architecture, equipment, people, and uncertainty
clean or enhanced completion
Tape B: Communication failure
missed or delayed check-in
no Standard response before institutional receipt
uncertainty preserved
late delivery does not erase the missed window
debrief reflects actual communication history
Tape C: Equipment complication
item transferred
container used
resource consumed
equipment dropped or disabled
recovery or abandonment decision
custody and reconciliation remain exact
Tape D: Separation
qualified teammate receives a bounded task
contact changes according to location and communications
UI shows only last-known information when appropriate
no hidden teammate condition leaks
restoration or accountable withdrawal occurs
Tape E: Alternate return
primary path becomes undesirable or unavailable through resolved conditions
alternate return is discovered or verified
route use affects evidence, time, equipment, or reporting
return and debrief remain state-derived
Tape F: Institutional aftermath
completed, degraded, failed, aborted, or personnel-loss outcome
Standard receives only returned or delivered information
staffing, equipment, scrutiny, support, or follow-up changes persist
a new assignment reflects actual prior history
shutdown and restart preserve the complete record

For every tape, record:

screenshots
observer-safe projection
internal developer trace
action timeline
radio timeline
teammate timeline
equipment and container timeline
evidence provenance
hazard timeline
institutional knowledge timeline
final debrief
follow-up state
restart digest
Kane fidelity rubric

The developer trace and player screenshots must remain clearly separated.

13. Anti-Kane defect blacklist

Treat the following as release defects unless explicitly justified and documented:

frequent entity encounters
mandatory chase sequences
horror stingers that reveal danger
constant ominous music
lore monologues
exposition-heavy teammates
humorous or cute procedural banter
cartoonishly hostile management
omniscient Standard
glowing loot
rarity tiers
quest arrows revealing unknown routes
minimap truth beyond discovered space
unexplained locked doors used as puzzle gates
arbitrary inventory restrictions
puzzles existing only as puzzles
progression triggered only by button presses
escalation triggered solely by elapsed dramatic timing
scripted debriefs
hidden truth in tooltips
“correct choice” coloring
generic VHS overlays
fake glitches
unsupported canon claims
imported copyrighted audiovisual material
repeated use of the words “anomaly,” “entity,” “liminal,” or “Backrooms” as a substitute for description
player-facing developer IDs
active Alex or Nora dependencies outside explicit historical compatibility fixtures
14. Acceptance and regression matrix

All existing tests and acceptance paths must remain green.

At minimum run:

npm test
npm run acceptance:playable-spine
npm run acceptance:structured-interaction
npm run acceptance:mission-state
npm run acceptance:operational-dynamics
npm run acceptance:omnipass
npm run validate-contracts
npm run validate-assets
npm run worldpack:validate -- clear-q4
npm run worldpack:validate -- minimal-mission
npm run worldpack:validate -- authoring-fixture
npm run worldpack:test -- clear-q4
npm run desktop:build
npm run build:alpha
npm run verify:alpha
npm run desktop:package
npm run desktop:verify

Add focused Pass 10 suites for:

first-run onboarding
beta mode labeling
Kane-fidelity leak rejection
lore provenance records
keyboard-only representative play
focus restoration
reduced motion
zoom and narrow viewport
audio mute and preferences, if audio is present
replay strategy matrix
performance budgets
save interruption
corrupted-save recovery
upgrade from supported saves
beta package metadata
Windows icon and executable metadata
portable ZIP contents
installer behavior, if an installer is produced
offline launch
opt-in OpenAI presentation
AI validation and deterministic fallback
tester report sanitization
absence of telemetry
absence of secrets
clean production console
exact restart during every operation phase
all seven outcome families
follow-up assignment persistence
developer truth separation

Create the final integrated release acceptance:

docs/acceptance/PASS_10_RELEASE_ACCEPTANCE.md
docs/acceptance/PASS_10_RELEASE_ACCEPTANCE.html
docs/acceptance/PASS_10_RELEASE_EVIDENCE.json

The integrated acceptance must launch the packaged app, not only invoke internal modules.

It must prove:

fresh launch
new world
generated personnel
briefing
staging
loadout change
field entry
branch choice
object interaction
evidence capture
report transmission
delayed Standard response
team order
inventory transaction
container transaction
hazard
consequence
recovery or abandonment
alternate route
return or abort
reconciliation
state-derived debrief
institutional consequence
follow-up assignment
shutdown
packaged relaunch
exact resume
tester report export
offline completion

No “passed” result may be produced from skipped steps.

15. Documentation and release materials

Update:

START-HERE.md
docs/GAME_READINESS_AUDIT.md
docs/PLAYABLE_GAME_ROADMAP.md
docs/authoring/WORLDPACK_AUTHORING_GUIDE.md
docs/authoring/INSTITUTIONAL_RESPONSE_GUIDE.md
docs/authoring/INVENTORY_AND_CONTAINERS_GUIDE.md

Create or finalize:

docs/KANE_FIDELITY_AUDIT.md
docs/PERFORMANCE_PROFILE.md
docs/BETA_TESTER_GUIDE.md
docs/BETA_BUG_REPORT_TEMPLATE.md
docs/BETA_KNOWN_ISSUES.md
docs/TROUBLESHOOTING_WINDOWS.md
docs/UPGRADE_AND_DATA_SAFETY.md
docs/RELEASE_NOTES_0.14.0-beta.1.md
docs/acceptance/KANE_FIDELITY_ACCEPTANCE.md
docs/acceptance/PASS_10_RELEASE_ACCEPTANCE.md

START-HERE must give a normal Windows user exact instructions to:

launch the portable beta
launch the installed beta, if produced
choose Clear-Q4
play offline
enable optional OpenAI presentation
locate saves and logs
resume a run
export a tester report
update without losing data
report a problem

Release notes must distinguish:

completed features
known limitations
experimental modes
local-first behavior
optional AI behavior
unsigned-build or SmartScreen status
save compatibility
fan-project status
what Beta 1 is intended to test
16. Implementation authority

You may:

redesign any weak renderer surface
reorganize onboarding
revise player-facing copy
add settings required by accessibility or audio
add original or properly licensed audiovisual assets
add performance instrumentation
optimize runtime paths
revise package configuration
add a verified Windows installer
fix icons and metadata
add beta-report infrastructure
revise acceptance generators
add replay harnesses
add migrations
bump save or session versions with explicit backward migration
update obsolete tests
remove dead compatibility code when proven safe
isolate historical compatibility code
revise Clear-Q4 pacing and numbers
add bounded source-supported environmental presentation
repair packaging and hosted CI defects caused by Pass 10
refactor aggressively where authority boundaries remain preserved

Do not preserve weak architecture because an old test encoded it.

Do not introduce a new major game system unless it is required to make the existing complete operation usable, accessible, reliable, or faithful.

This is not the pass for:

multiplayer
3D rendering
procedural infinite world generation
unrestricted NPC psychology
a new campaign
a new entity taxonomy
combat
Steam integration
cloud saves
telemetry
a content marketplace
a fake updater
mobile support
17. Non-negotiable rules
No institutional omniscience.
No response to an undelivered report.
No hidden casualty knowledge.
No AI-generated simulation truth.
No player-facing developer truth.
No renderer-owned canonical state.
No teleporting equipment or containers.
No partial transaction commits.
No duplicate items.
No unlimited recursive containers.
No mission completion from presentation alone.
No escalation solely for dramatic timing.
No scripted debrief detached from final state.
No active fixed-name dependency.
No fixed team-size assumption outside three to five including the player.
No silent save reset.
No destruction of user data during upgrade.
No network traffic by default.
No telemetry.
No secrets in logs or reports.
No copyrighted film or soundtrack extraction.
No accessibility theater.
No weakened regression assertions.
No disabled test used to claim completion.
No placeholder release documentation.
No “beta ready” claim without packaged-app launch evidence.
No external-testing claim without human evidence.
No release artifact from a dirty or unmerged tree.
No merge while required checks are failing.
No prerelease publication while required package checks are failing.
18. Completion criteria

Pass 10 is complete only when:

Clear-Q4 remains a complete condition-driven operation.
A new player can launch and understand the game without repository knowledge.
The Windows packaged beta launches offline.
The primary playable mode is unmistakable.
Onboarding is concise, persistent, dismissible, and recoverable.
The interface has a coherent hierarchy.
The game is keyboard playable.
Accessibility preferences persist.
Renderer surfaces contain no hidden truth.
Kane fidelity has a documented provenance audit.
Unsupported pseudo-canon has been removed or clearly classified.
Routine play remains compelling without forced threat.
Replay harnesses find no deadlock or dominant mandatory strategy.
All seven outcome families remain reachable.
Save and restart remain exact.
Supported older saves migrate safely.
Corruption and interrupted writes fail safely.
Tester reports are useful and sanitized.
No network request occurs by default.
Optional AI presentation cannot modify truth.
Performance is measured and documented.
Windows packaging has correct icon and metadata.
Portable beta update preserves %APPDATA%\Yellow Beast\.
Every existing suite remains green.
Every new Pass 10 suite is green.
Renderer-backed Kane and release acceptances pass.
Desktop, alpha, package, offline smoke, and hosted CI pass.
The working tree is clean.
The PR is merged.
Final beta artifacts and checksums exist.
Exact launch instructions are reported.
No in-scope release-readiness blocker remains.
19. Repository handoff and beta release

After implementation:

Run the complete local verification matrix.
Review the complete diff.
Run security, secret, path, and developer-truth audits.
Stage intentionally.
Commit with a clear release-readiness message.
Push the branch.
Open a ready-for-review PR.
Monitor every required hosted check.
Repair safe in-scope defects.
Rerun affected local and hosted checks.
Merge automatically when every required check passes.
Confirm the feature commit is an ancestor of origin/main.
Restore the local checkout to clean current main.
Delete the merged feature branch locally and remotely.
Create tag:
v0.14.0-beta.1
Create a GitHub prerelease only after:
the tag points to merged main
hosted validation passes
hosted Windows packaging passes
hosted macOS packaging passes
final artifact checksums are recorded
release notes are complete

Attach verified beta artifacts where permissions and repository release policy allow.

If prerelease publication is blocked by permissions or repository policy, do not fabricate success. Leave the merged code, verified local artifacts, tag-ready state, and exact publication commands.

Stop before merge or release only for:

merge conflict
failed validation that cannot safely be repaired
ambiguous ancestry
authentication failure
missing required packaging capability
concrete security or data-loss risk
another condition making automatic merge or prerelease publication unsafe
20. Final response requirements

At completion, report:

Beta version.
Merge PR and merge commit.
Release tag and prerelease status.
Kane fidelity changes.
Lore provenance audit result.
Onboarding changes.
Interface changes.
Accessibility results.
Audiovisual changes.
Replayability and pacing findings.
Performance measurements.
Persistence and migration results.
Security and privacy results.
Tester-report workflow.
Windows package artifacts.
macOS package artifacts.
Checksums.
Exact Windows executable path.
Exact portable ZIP path.
Installer path, if produced.
Exact Windows launch command.
Save and log locations.
Existing test result.
New Pass 10 test result.
Every acceptance result.
Desktop and alpha verification.
Packaged offline smoke.
Hosted validation.
Hosted Windows packaging.
Hosted macOS packaging.
Working-tree state.
Remaining known limitations.
Any part not honestly completed.

End with a concise statement answering:

Can Jack close Codex now, launch the Windows beta, and complete a real Clear-Q4 operation without an API key?

Do not stop at analysis.

Do not stop after producing recommendations.

Implement, verify, package, merge, and deliver the beta.