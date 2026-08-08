YELLOW BEAST 1.0 IMPLEMENTATION ROADMAP
Dependency-Ordered Development Plan from 0.13.0-alpha to 1.0.0

Status: Draft for implementation planning
Source of authority: Yellow Beast 1.0 Design Charter
Current public baseline: 0.13.0-alpha, Omnipass 7–9 / PR #42 / b81165b
Current development line: agent/pass-10-release-candidate

1. PURPOSE

The Design Charter defines what Yellow Beast 1.0 is.

This roadmap defines how the existing project reaches it.

The roadmap does not replace or reinterpret the Charter. Its job is to translate the Charter into an implementation order that:

respects existing simulation authorities,
avoids unnecessary rewrites,
produces a playable build after every meaningful development pass,
prioritizes human-facing playability before expansion,
prevents feature work from outrunning validation,
preserves offline completeness,
and terminates in a testable, releasable 1.0.0.

The governing implementation rule is:

Build prerequisites before dependents, prove each layer through play, and never bury a broken human-facing loop beneath additional systems.

2. CURRENT BASELINE

Passes 1–9 established the existing simulation foundation.

Current major capabilities include:

persistent world state
authoritative spatial topology
movement and proximity
observation and discovery
interactable objects and affordances
mission lifecycle
operational clock
scheduled events
delayed communications
personnel generation
team orders
bounded teammate autonomy
separation and last-known state
hazards and consequences
inventory
containers
custody
evidence foundations
loadouts
institutional memory
Standard response
follow-up foundations
save and resume
save migration
observer-safe AI boundaries
worldpack schemas
worldpack authoring CLI
one complete condition-driven Clear-Q4 operation

These authorities are considered existing infrastructure, not provisional prototypes.

They should only be replaced or substantially rewritten if testing proves a structural defect.

3. DEVELOPMENT PHILOSOPHY

Every remaining pass must satisfy five rules.

3.1 Every pass ends in a playable build

No milestone may exist solely as invisible backend progress once player-facing development resumes.

At the end of every pass:

relevant automated tests pass,
a desktop build succeeds,
the affected player path can be manually exercised,
save/reload behavior is checked where applicable,
known limitations are recorded.
3.2 Human testing begins immediately

Automated acceptance does not establish playability.

Starting with Pass 10, development uses the loop:

IMPLEMENT
↓
AUTOMATED ACCEPTANCE
↓
BUILD
↓
HUMAN PLAYTHROUGH
↓
SCREEN RECORDING
↓
DEFECT LIST
↓
PATCH
↓
REGRESSION TEST
↓
REPLAY
3.3 Custodian remains authoritative

New presentation systems, AI providers, image generation, Facility interfaces, and audiovisual systems must consume authoritative state.

They may not become parallel sources of world truth.

3.4 No later system excuses an earlier broken loop

If world creation is broken, procedural geography waits.

If staging is confusing, phenomena wait.

If saving is unreliable, audiovisual polish waits.

The player-facing spine always has priority.

3.5 Scope remains frozen

No new 1.0 feature family should be added merely because development discovers something interesting.

New ideas are evaluated against the Design Charter and either:

integrated into an already-defined requirement,
designated post-1.0,
or rejected.
4. DEVELOPMENT PHASES

Development from the current alpha to 1.0 is divided into six phases.

PHASE I
Make the existing game genuinely playable

Pass 10

PHASE II
Build the persistent career and world-progression loop

Passes 11–13

PHASE III
Deepen people, evidence, environment, and consequence

Passes 14–16

PHASE IV
Complete presentation, providers, and framework portability

Passes 17–18

PHASE V
Human beta and hardening

Pass 19

PHASE VI
Release candidate and 1.0

Pass 20

PASS 10
HUMAN PLAYABILITY AND BETA FOUNDATION

Pass 10 finishes the transformation of the existing systemic Clear-Q4 operation into something a human can reliably play.

It should be implemented in slices rather than as one enormous agent task.

PASS 10A
First-Run Playability
Goal

A fresh player can go from executable launch to assignment briefing without external explanation.

Implement
reliable application launch
first-run flow
world naming
automatic-name fallback
personnel creation
personnel confirmation
Clear-Q4 selected prominently
experimental modes secondary
offline mode clearly available
no API-key requirement
diegetic first-run orientation
predictable focus
keyboard submission
meaningful error states
recovery from failed world creation
correct save creation
Acceptance gate

A fresh installation must support:

LAUNCH
→ WORLD CREATION
→ PERSONNEL CREATION
→ PERSONNEL CONFIRMATION
→ CLEAR-Q4 BRIEFING

without terminal intervention.

Human evidence

Continuous recording from launch to briefing.

PASS 10B
Full Human Clear-Q4 Spine
Goal

The complete existing Clear-Q4 operation becomes manually playable.

Required path
BRIEFING
↓
STAGING
↓
LOADOUT
↓
FACILITY TRANSIT
↓
CONTROL / READINESS
↓
THRESHOLD
↓
RADIO CHECK
↓
FIELD OPERATION
↓
INVESTIGATION
↓
COMMUNICATION
↓
HAZARD / CONSEQUENCE
↓
RETURN OR ABORT
↓
RECONCILIATION
↓
DEBRIEF
↓
FOLLOW-UP
Focus
eliminate dead ends
expose meaningful actions
improve action grouping
remove hidden requirements
ensure all phase transitions are understandable
make equipment manipulation understandable
make LOCAL and STANDARD distinct
ensure mission state is readable
make return conditions legible
ensure outcome and aftermath are understandable
remove ceremonial Continue-style interaction wherever possible
Acceptance gate

A human completes at least:

one successful operation,
one degraded operation,
one controlled abort,

using only the released UI.

PASS 10C
Persistence, Recovery, and Diagnostics
Goal

The game becomes trustworthy.

Implement and validate

Save/restart from:

briefing
staging
Threshold
field operation
separation
pending Standard communication
hazard state
dropped equipment
return
reconciliation
debrief
follow-up

Also test:

forced process termination
interrupted save
damaged current save
previous-good recovery
migrations
unsupported versions
unusual Windows paths
unusual usernames
Add

EXPORT DIAGNOSTIC RECORD

Including sanitized:

version
platform
world ID / seed
phase
save schema
recent public actions
provider status
errors
useful logs
safe renderer state
Acceptance gate

No tested shutdown condition silently destroys canonical progress.

PASS 10D
Accessibility, Interface Certification, and Beta Identity
Goal

The existing operation becomes comfortable enough for repeat use.

Validate
keyboard-only operation
focus restoration
tab order
screen-reader semantics
live regions
scalable text
1280×720
1366×768
1920×1080
Windows 150% scaling
large text
high contrast
reduced motion
reduced sensory mode
non-color state cues
clear empty states
persistent/reopenable help
structured-action parity
Product identity

Transition branding from alpha toward:

Yellow Beast · PLAYABLE BETA

Pass 10 exit gate

A stranger can reliably:

launch → create → prepare → enter → operate → return → debrief → save → resume

The project is now ready for deeper 1.0 systems.

PASS 11
FACILITY-SIDE SPATIAL EXPERIENCE
Purpose

Turn the Facility from disconnected menus into the player's diegetic operating system.

The Facility becomes the stable ritual surrounding every operation.

Core Facility contexts

Implement player-facing representations of:

Lower Offices
work orders
briefing
personnel records
prior reports
institutional notices
debrief access
Hazmat / Equipment Room
loadout
equipment custody
personnel readiness
containers
specialist equipment
Maintenance Wing
Facility transition
infrastructure context
power / KV31 operational state
institutional activity
KV31 Control / Observation
Standard
Threshold condition
radio readiness
team accountability
operational status
Threshold Chamber
final outbound accountability
Threshold state
crossing
return
inbound accountability
Biomedical / Evidence Area
returned evidence
biological material
photographic material
analysis records
archival cases where available
Navigation doctrine

The player does not click:

INVENTORY

They go to staging.

They do not click:

MISSION SELECT

They receive work in the Lower Offices.

Facility navigation itself is meaningful institutional activity.

Acceptance gate

A complete Clear-Q4 run visibly follows:

LOWER OFFICES
→ EQUIPMENT
→ MAINTENANCE / KV31
→ CONTROL
→ THRESHOLD
→ COMPLEX
→ THRESHOLD
→ PROCESSING
→ DEBRIEF / ARCHIVE

without feeling like arbitrary screen transitions.

PASS 12
SURVEY FRONTIER AND PERSISTENT PROCEDURAL COMPLEX
Purpose

Implement Yellow Beast's primary macro-progression system.

The Threshold stays fixed. The frontier moves.

12.1 Survey Frontier authority

Create authoritative state for:

objective geography
player-known geography
team-known geography
institutional geography
historical survey geography

Support operational states including:

UNKNOWN
PARTIALLY OBSERVED
OBSERVED
SURVEYED
REPORTED
UNCONFIRMED
CONFIRMED
RESTRICTED
LOST
INACCESSIBLE
PRIOR RECORD ONLY
12.2 Persistent procedural expansion

Extend existing spatial generation into bounded persistent generation.

Generate:

rooms
corridors
junctions
dead ends
service spaces
elevation changes
repeating architectural structures
structural peculiarities
mundane environmental features

Generated geography becomes canonical.

It must never regenerate merely because another operation starts.

12.3 Fixed entry geography

The Threshold always enters through the established Complex-side operational entry region.

Later operations become longer because their objectives occur farther from the Threshold.

12.4 Mapping

Maps must distinguish between:

what exists,
what the player observed,
what the current team knows,
what Standard has recorded,
what historical surveys claim.

No omniscient minimap.

Acceptance gate

After multiple assignments:

previously generated spaces remain identical,
player and institutional maps may legitimately disagree,
prior markers remain,
route changes persist,
later assignments can occur deeper in the same world.
PASS 13
ASSIGNMENT ENGINE AND CAREER LOOP
Purpose

Transform Clear-Q4 from one complete authored operation into a family of persistent institutional assignments.

Assignment archetypes

Support a reusable pool including:

routine survey
route verification
equipment recovery
instrumentation replacement
photographic documentation
structural assessment
personnel support
failed-team accountability
layout verification
acoustic investigation
lost media recovery
evidence corroboration
route-marker maintenance
communications infrastructure
return-route verification
follow-up investigation

Assignments should be assembled from current world state rather than selected randomly without cause.

Consequence-generated work

World conditions can produce later assignments.

Examples:

UNCONFIRMED REPORT
→ CORROBORATION ASSIGNMENT
LOST EQUIPMENT
→ RECOVERY ASSIGNMENT
ROUTE FAILURE
→ VERIFICATION / REPAIR
MISSING PERSONNEL
→ ACCOUNTABILITY / SEARCH
Operations between operations

Implement bounded offscreen institutional activity.

Allowed examples:

administrative review
equipment servicing
staffing changes
evidence analysis
temporary restriction changes
cache placement
routine route verification
support adjustment
Hard boundary

Background systems may not casually inflict irreversible dramatic personnel consequences.

No arbitrary offscreen deaths.

Acceptance gate

A single world supports a sequence of operations where:

later jobs reference earlier history,
missions arise from actual persistent state,
previous discoveries matter,
world conditions produce work naturally,
the player does not feel the universe reset between assignments.
PASS 14
PERSONNEL CONTINUITY, LOCAL, AND STANDARD
Purpose

Make personnel become meaningful through lived history.

14.1 Persistent coworker identity

Personnel track:

stable identity
role
qualifications
assignment history
equipment custody history
known information
decision tendencies
institutional status
previous injuries
availability
relationships arising through shared work
14.2 Behavioral salience

NPC reactions depend on:

current scene
knowledge
role
personality tendency
perceived significance
task
operational condition
history

NPCs do not comment on everything.

Silence is a valid response.

14.3 FAILRP enforcement

Add explicit runtime/test boundaries preventing:

wrong-phase dialogue
future-state knowledge
hidden-state leakage
offscreen omniscience
title/menu field dialogue
false location awareness

NPCs may be incorrect.

They may not be contextually impossible.

14.4 LOCAL communication

Expand natural language team communication.

Support meaningful requests such as:

stay
follow
observe
inspect
photograph
carry
transfer
return
report
assist
wait
investigate
clarify

Custodian resolves legality and consequences.

AI may interpret language but not determine truth.

14.5 Persistent Standard operator

Generate a Standard-side personnel identity for each world.

Initially experienced through communications.

Identity may become discoverable through legitimate Facility contact or records.

Standard remains a worker, never a narrator.

Acceptance gate

After several missions, a human tester should naturally recognize individual coworkers because of shared history rather than exposition.

PASS 15
EVIDENCE, RECORDS, AND PROCEDURAL MEDIA
Purpose

Turn evidence into one of Yellow Beast's primary reward and memory systems.

15.1 Evidence authority expansion

Evidence records should support:

creator
time
location
method
equipment
provenance
source
custody
condition
associated observation
reporting status
Standard availability
institutional confidence
analysis
contradictions
render specification
15.2 Evidence archive

Create a proper institutional record viewer for:

photographs
recovered objects
reports
communications
survey records
personnel-linked evidence
unresolved material

The archive is the lore system.

15.3 Procedural photographic renderer

Introduce a presentation-only image pipeline:

CANONICAL EVENT
↓
OBSERVER-SAFE EVIDENCE RECORD
↓
RENDER SPEC
↓
IMAGE PROVIDER
↓
ARCHIVAL PHOTOGRAPH

Support:

deterministic fallback
local renderer integration
optional hosted rendering

Never permit image output to mutate canonical state.

15.4 Evidence contradiction

Allow simulation-authored discrepancies between:

historical record
player observation
later observation
photograph
institutional interpretation

The discrepancy must exist before rendering.

Acceptance gate

A player completes several missions and accumulates a visually inspectable archive whose contents accurately reflect their world's actual history.

PASS 16
ENVIRONMENT, PHENOMENA, MORTALITY, AND CONSEQUENCE
Purpose

Make the Complex capable of producing rare extraordinary events without becoming an encounter treadmill.

16.1 Environmental state

Add persistent state for selected environmental domains:

power
lighting
communication coverage
air movement
temperature
moisture
structural condition
debris
acoustic condition
residual equipment
machinery
signage
markers
vertical hazards

Systems should interact.

16.2 Rare phenomenon ecology

Implement bounded phenomenon families such as:

spatial inconsistency
object displacement
acoustic anomaly
transient architecture
environmental discontinuity
evidence inconsistency

Frequency must remain low.

Multiple completely mundane operations are expected.

16.3 Still Life

Still Life should be:

persistent
procedural
world-bound
rare
environmentally located
discoverable or missable
evidentiary where legitimately observed

It is not a standard enemy encounter.

16.4 Bacteria

Implement Bacteria only as a very rare high-risk condition.

Potential supported behaviors:

pursuit
avoidance
acoustic tracking
voice mimicry
communication confusion
personnel separation
persistent consequences

Do not turn it into routine combat.

There is no combat system.

16.5 Expanded outcome families

Complete all ten target result families:

clean-completion
enhanced-completion
recovered-complication
degraded-completion
controlled-abort
mission-failure
personnel-loss
total-personnel-loss
mission-failure-recoverable
mission-failure-unrecoverable
16.6 Player mortality and world retirement

Implement final controlled-player death.

On confirmed death or permanent loss:

active world becomes immutable,
no checkpoint reload is permitted,
world enters retired archive,
final records are preserved,
career statistics are generated,
personnel status is finalized.
16.7 Legacy Personnel Archive

Retired player identities become searchable from later careers without transferring old-world simulation state.

Acceptance gate

Death is mechanically final, archival state is immutable, and a new world can reference former player personnel historically without inheriting that world's canonical state.

PASS 17
PRESENTATION, AI PROVIDERS, AND AUDIOVISUAL IDENTITY
Purpose

Turn a feature-complete simulation into the Yellow Beast experience.

17.1 Unified context presentation

Provide one coherent observer-safe primary context stream.

Offline and AI-enhanced outputs appear through the same presentation surface.

17.2 Provider architecture

Target three modes:

Offline deterministic

Required and complete.

Local AI

Optional.

OpenAI

Optional.

Provider failure may reduce presentation richness.

It may never prevent gameplay.

17.3 Natural-language interpreter

Support increasingly expressive attempts while preserving legal-action resolution.

Complex statements may be decomposed into proposed simulation actions.

Example:

“Have Miller photograph the fixture while I inspect the conduit.”

The interpreter may identify the intended actions.

Custodian still validates and resolves them.

17.4 Visual identity

Complete:

institutional workstations
paper records
photographic layouts
Facility imagery
instruments
amber/green operational hierarchy
restrained CRT/phosphor influence
ASYNC-derived typography
limited purposeful animation
17.5 Audio system

Implement environmental layers for:

fluorescent systems
ventilation
machinery
relays
radios
Threshold machinery
equipment
room tone
distant Facility activity
Complex acoustic differences

Avoid:

constant music
scare cues
horror stingers
Doctrine

Architecture behaves like an instrument.

Acceptance gate

The game remains entirely playable with sound muted, offline, and without any AI provider.

AI and audiovisual layers enrich experience without becoming gameplay dependencies.

PASS 18
WORLDPACK PRODUCTIZATION AND SECOND AUTHORED PROOF
Purpose

Prove that Custodian is a reusable framework rather than a Clear-Q4-specific engine.

18.1 Worldpack authoring completion

Ship:

documented schemas
starter template
validator
previewer
deterministic trace
test runner
diagnostics
example worldpack
independent fixture
authoring guide
18.2 Second authored experience

Create one small worldpack or operational perspective unrelated to normal field-player Clear-Q4 flow.

Recommended:

STANDARD-SIDE KV31 OPERATION

Player operates from the Control / Observation Room while supervising a field team.

Test:

reversed observer boundaries
incomplete information
delayed communications
team decisions
remote events
Standard knowledge
authorization
institutional response
worldpack portability

Target duration:

20–30 minutes.

Acceptance gate

Custodian runs the second experience without Clear-Q4-specific runtime hacks.

Any generic behavior required by both experiences belongs in Custodian or generic Yellow Beast runtime, not duplicated into scenario code.

PASS 19
EXTERNAL BETA AND HUMAN HARDENING
Purpose

Stop constructing systems.

Start attacking the product.

No major new feature families after Pass 19 begins.

19A
Internal Beta / Tester Zero

Run repeated personal worlds.

Minimum target:

10+ fresh careers
multiple seeds
every major mission archetype
multiple coworker combinations
multiple outcome families
player death
coworker loss
deep Survey Frontier
long-lived world
evidence accumulation
save interruption
offline play
AI-enhanced play

Deliberately attempt:

bad preparation
equipment abandonment
ignored reports
missed check-ins
excessive caution
reckless penetration
team separation
refusal to return
early abort
unusual natural language
process termination
19B
Closed External Beta

Target a modest group of new players.

The important characteristic is:

They have not watched us build it.

Measure:

install success
first-run success
world creation
personnel creation
comprehension
time to first meaningful action
mission comprehension
UI confusion
dead ends
accessibility problems
crashes
save integrity
incorrect assumptions
perceived NPC credibility
understanding of Standard
whether players recognize persistent consequences
19C
Replayability and Balance

Tune:

mission frequency
mission selection
travel length
hazard rate
phenomenon rarity
Bacteria rarity
Still Life rarity
communications timing
Standard cadence
coworker behavior
equipment availability
casualty likelihood
follow-up frequency
Survey Frontier expansion rate
mundane-event density

The objective is not maximum engagement per minute.

The objective is sustainable credibility across hundreds of runs.

19D
Performance and Durability

Profile:

long worlds
large maps
thousands of historical events
evidence archives
images
personnel histories
communications
institutional state
save sizes
load times
renderer performance
memory usage

Stress worlds substantially larger than expected average player use.

Pass 19 exit gate

No known P0 or P1 defect remains.

No major system is still awaiting first human validation.

PASS 20
RELEASE CANDIDATE AND 1.0 CERTIFICATION

No major feature development occurs here.

Pass 20 should be boring.

That is success.

20A
Release Candidate

Target:

0.9.0-rc.1

Freeze:

save contracts
core worldpack contracts
user-facing terminology
major UI layout
mission interfaces
provider interfaces

Only fix defects.

20B
Full Regression

Run:

all historical tests
all acceptance suites
contract validation
asset validation
worldpack validation
complete Clear-Q4 acceptance
second worldpack acceptance
migrations
offline smoke
long-world stress
human release checklist
20C
Accessibility Certification

Complete final:

keyboard-only career
text scaling
screen-reader review
contrast
reduced motion
reduced sensory
focus
window scaling
error recovery

No critical accessibility gap remains.

20D
Distribution

Produce:

Windows build
macOS build
offline package verification
checksums
installation instructions
uninstall/data-retention documentation
save-location documentation
troubleshooting
known issues
diagnostic-export instructions
license/notices
credits

Signing/notarization is used where practical and required for intended distribution.

20E
1.0 Release Gate

Yellow Beast may become:

1.0.0

only when a new user can:

DOWNLOAD
↓
INSTALL
↓
LAUNCH
↓
CREATE PERSONNEL
↓
RECEIVE ASSIGNMENT
↓
PREPARE
↓
CROSS THE THRESHOLD
↓
UNDERSTAND AVAILABLE WORK
↓
OPERATE
↓
COMMUNICATE
↓
SUCCEED / FAIL / ABORT LEGITIMATELY
↓
RETURN
↓
RECONCILE
↓
RECEIVE AFTERMATH
↓
RECEIVE FUTURE WORK
↓
SAVE
↓
QUIT
↓
RELAUNCH
↓
FIND THE WORLD EXACTLY WHERE IT BELONGS

And a veteran can continue the same world until death while encountering persistent geography, people, evidence, institutional memory, and consequences that make individual careers meaningfully different.

5. DEPENDENCY MAP

The implementation order is intentional.

CURRENT PASSES 1–9
Simulation foundation
        │
        ▼
PASS 10
Human playable spine
        │
        ▼
PASS 11
Facility spatial ritual
        │
        ▼
PASS 12
Survey Frontier + procedural persistent geography
        │
        ▼
PASS 13
Assignment / career engine
        │
        ├────────────────────┐
        ▼                    ▼
PASS 14                 PASS 15
Personnel               Evidence
continuity              and media
        │                    │
        └──────────┬─────────┘
                   ▼
               PASS 16
       Environment / phenomena /
          mortality / outcomes
                   │
                   ▼
               PASS 17
          Presentation / AI / AV
                   │
                   ▼
               PASS 18
       Worldpack portability proof
                   │
                   ▼
               PASS 19
             Human beta
                   │
                   ▼
               PASS 20
          RC → YELLOW BEAST 1.0
6. WHY THIS ORDER
Pass 10 comes first because:

There is no value in expanding a game a human cannot reliably enter.

Facility comes before procedural expansion because:

The stable half of the player's ritual should be comprehensible before the unstable half becomes larger.

Survey Frontier comes before assignment generation because:

Missions need persistent geography to reference.

Assignment generation comes before deep personnel continuity because:

Personnel history requires repeated work to create meaningful history.

Personnel and evidence come before rare phenomena because:

Extraordinary events require witnesses and records to matter.

Environment comes before Bacteria / Still Life polish because:

Phenomena need a living world to inhabit.

Core gameplay comes before AI and audiovisual polish because:

Presentation should amplify a complete simulation rather than conceal an incomplete one.

Worldpack proof comes after the flagship systems stabilize because:

Only then do we know what is truly generic.

Beta comes after construction because:

Beta is for finding defects and tuning behavior, not quietly completing half-built core systems.

Release candidate comes last because:

A release candidate should contain almost no exciting engineering.

7. VERSIONING TARGETS

Exact numbering may change, but a useful semantic progression is:

Development state	Suggested version
Existing Omnipass baseline	0.13.0-alpha
Pass 10 playable foundation	0.14.0-beta.1
Facility / Frontier development	0.15.x-beta
Career / Personnel / Evidence	0.16.x-beta
Environment / Phenomena / Mortality	0.17.x-beta
Presentation / Providers	0.18.x-beta
Worldpack proof	0.19.x-beta
External beta hardening	0.8.x-beta or continue 0.19.x
Release candidate	0.9.0-rc.1
Final	1.0.0

Version numbering is less important than acceptance state.

Do not increase versions merely because time passed.

8. FEATURE FREEZE POINTS

Three freezes should occur.

Charter Freeze

Now.

The 1.0 product definition is considered fixed.

Feature Freeze

Beginning of Pass 19.

No new major systems.

Only:

defect repair
tuning
accessibility
performance
UX refinement
content adjustments using existing systems
Contract Freeze

Beginning of Pass 20.

Save contracts, authoring contracts, major UI concepts, and provider interfaces are frozen except where a release blocker demands correction.

9. PLAYABILITY GATES

The roadmap should be measured through increasingly ambitious human proofs.

Gate A

Can I launch it?

Pass 10A.

Gate B

Can I finish one operation?

Pass 10B.

Gate C

Can I trust it?

Pass 10C.

Gate D

Can somebody else understand it?

Pass 10D.

Gate E

Does the Facility feel like a place?

Pass 11.

Gate F

Does the world grow without resetting?

Pass 12.

Gate G

Does history create future work?

Pass 13.

Gate H

Do I care who is assigned with me?

Pass 14.

Gate I

Do my records feel like artifacts of my world?

Pass 15.

Gate J

Can something extraordinary happen without the game becoming a monster treadmill?

Pass 16.

Gate K

Does it feel like Yellow Beast?

Pass 17.

Gate L

Is Custodian actually reusable?

Pass 18.

Gate M

Can humans survive it?

Pass 19.

Gate N

Can we stop touching it and ship it?

Pass 20.

10. DEFINITION OF DONE FOR EVERY PASS

Every implementation pass should produce a handoff containing:

scope completed
authoritative systems changed
files changed
save-contract impact
migration impact
focused tests
historical regressions run
renderer acceptance
manual play path tested
screen-recording evidence where relevant
known defects
deferred features
exact build/launch instructions
commit hash
next-pass prerequisites

A pass is not complete because Codex says:

implemented.

A pass is complete because the repository and a human playthrough prove it.

11. FINAL DEVELOPMENT DOCTRINE

From this roadmap onward:

Design Charter decides what.

Implementation Roadmap decides when.

Custodian decides truth.

Tests prove invariants.

Humans prove playability.

The release gate decides when we're finished.

No pass exists to create motion.

Every pass moves Yellow Beast closer to the one experience already defined:

A person goes to work, enters somewhere they should not be able to enter, performs the job they were assigned, comes back carrying incomplete evidence of what happened, and discovers that the institution has already begun deciding what to do next.

END STATE

The development sequence is therefore:

Pass 10: Make it playable
Pass 11: Make the Facility spatial
Pass 12: Make the Complex grow
Pass 13: Make history generate work
Pass 14: Make personnel become people
Pass 15: Make evidence become memory
Pass 16: Make the world capable of consequence and terror
Pass 17: Make it feel like Yellow Beast
Pass 18: Prove Custodian is bigger than Yellow Beast
Pass 19: Let humans attack it
Pass 20: Stop building and ship it

Then: YELLOW BEAST 1.0.0.