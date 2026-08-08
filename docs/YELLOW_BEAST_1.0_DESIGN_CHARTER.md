YELLOW BEAST 1.0 DESIGN CHARTER
Internal Product Definition and Final Feature Envelope

Status: Pre-pass planning charter
Current public baseline: 0.13.0-alpha, Omnipass 7–9 / PR #42 / b81165b
Current local development branch: agent/pass-10-release-candidate

This charter defines what Yellow Beast 1.0 is supposed to be before the remaining work is decomposed into implementation passes.

It is intentionally not a pass plan, backlog, or technical implementation order.

It is the destination.

The original roadmap already establishes a mature simulation foundation across spatial topology, movement, observation, missions, time, communications, personnel, hazards, logistics, institutional response, persistence, AI boundaries, and worldpack authoring. The remaining development should compose and extend that architecture into the complete player experience described below rather than replace proven authorities without cause.

1. PRODUCT THESIS

Yellow Beast 1.0 is:

A polished, self-contained institutional field simulation built on Custodian, centered on people attempting to make routine work out of an environment that fundamentally refuses to become routine.

It is not a Backrooms roguelike.

It is not a chatbot wearing an ASYNC costume.

It is not a horror game whose primary loop is waiting for a monster to appear.

It is a persistent simulation of:

institutional procedure
field work
personnel
geography
evidence
incomplete information
equipment
consequences
bureaucracy
uncertainty
discovery
survival
memory

The player is not told what the story is.

They are given a job.

The story is what happens while they try to perform it.

2. GOVERNING CREATIVE PRINCIPLE
Do not make Yellow Beast constantly exciting.
Make it constantly credible.

The simulation does not owe the player stimulation every thirty seconds.

There may be:

no anomaly
no monster
no radio message
no dramatic development
no music
no revelation

Sometimes the assignment is simply:

Do the survey.

That silence is not empty content.

It establishes the normal conditions against which something extraordinary becomes extraordinary.

3. THE 1.0 SCOPE ENDS HERE

A defined ending to scope is itself a requirement.

The following are not required for Yellow Beast 1.0:

multiplayer
combat systems
Steam Workshop
cloud saves
mobile
infinite procedural Complex generation
unrestricted autonomous NPC minds
dozens of phenomenon types
giant scripted campaigns
cinematic cutscenes
VR
live-service systems
elaborate character customization
Steam release itself
graphical 3D exploration

The absence of these features is not incompleteness.

They are deliberately outside the 1.0 product definition.

4. THE 1.0 FANTASY IN ONE PLAY SESSION

A new player downloads Yellow Beast.

They launch it.

They create an ASYNC personnel record:

JACK ROCHA

ASYNC assigns them to Clear-Q4.

Three strangers are listed beside them.

They read an extremely boring work order.

They receive equipment.

They cross the Threshold.

For twenty minutes, nothing extraordinary happens.

They inspect rooms.

They complain to a coworker.

They miss a radio check.

They photograph a damaged fixture.

They find an old survey mark.

They hear something.

Maybe it means nothing.

Later, a corridor appears inconsistent with the prior survey record.

They report it.

The transmission fails.

A coworker wants to return.

The player decides to continue.

Eventually the team returns to the Facility.

Standard does not know about the corridor because the transmission never arrived.

The camera returns.

The photograph does.

The debrief records:

UNCONFIRMED SPATIAL DISCREPANCY

Later:

WORK ORDER CQ4-119
Reverify western service route following unresolved field report.

Same world.

Different assignment.

Perhaps a different team.

The old marker is still there.

And someone who was present last time is not.

That is Yellow Beast.

5. THE WORLD IS NOT A SAVE SLOT

A Yellow Beast world represents the history of that installation and the player's career within it.

During the life of a world, state persists.

If the player:

leaves equipment
damages equipment
marks a wall
photographs something
discovers a route
blocks a route
opens a container
loses an instrument
reports an event
fails to report an event
isolates a circuit
discovers a connection
encounters a phenomenon
loses a coworker
causes Standard to restrict an area
abandons an operation

then that fact continues to exist.

The player should eventually know parts of the world because they personally made them history.

6. WORLD LIFE AND PLAYER DEATH

A world continues until the controlled player character dies or is permanently lost.

Player death is not a reload point.

It is the end of that active world.

The world becomes an immutable retired record available from the title interface as a museum of that playthrough.

A retired world may expose:

total assignments
career duration
explored regions
personnel encountered
casualties
missing personnel
evidence recovered
equipment lost
institutional outcomes
significant reports
final assignment
final known player status
maps
photographs
notable records

The player then begins a new world with a new personnel identity.

There is no resurrection.

There is no rewind.

There is no “continue from checkpoint” after confirmed player death.

Legacy Personnel Archive

Former player characters from retired worlds may remain searchable from later worlds through a Legacy Personnel Archive.

This is a meta-level historical feature only.

A new world does not inherit the old world's simulation state, geography, equipment, institutional decisions, or consequences.

But searching personnel archives may surface records such as:

ROCHA, JACK
FIELD STATUS: UNRETURNED
ARCHIVED PERSONNEL RECORD

This allows a player's accumulated Yellow Beast history to become a museum of careers without weakening the finality of death.

7. THE SURVEY FRONTIER

The Survey Frontier is a first-class progression system.

The Threshold remains fixed.

The frontier moves.

The Complex is not regenerated from scratch every operation.

Instead, each world gradually reveals a bounded but expandable persistent geography.

Early assignments occur near established areas.

Later assignments may travel through known territory into increasingly remote, poorly documented, or newly discovered regions.

Generated geography becomes permanent once instantiated.

A generated room is not “this run's room.”

It is now that room.

The world may classify geography differently depending on who knows what.

Possible operational states include:

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

The Survey Frontier therefore exists simultaneously through several epistemic layers:

Objective geography

What actually exists.

Player-known geography

What the controlled worker has personally observed.

Team-known geography

What current personnel legitimately know.

Institutional geography

What Standard currently believes.

Historical geography

What prior survey records claim existed.

These layers may disagree.

A player may know a corridor exists while Standard's map does not.

A historical map may show a route that no longer exists.

A coworker may know something the player does not.

The map is contested knowledge, not omniscient UI.

8. BOUNDED PROCEDURAL COMPLEX EXPANSION

Yellow Beast 1.0 may procedurally generate Complex geography, but it does not generate an infinite dungeon.

The intended model is:

bounded persistent procedural expansion

Procedural systems may create:

rooms
corridors
junctions
elevation changes
service passages
dead ends
repeating structures
environmental states
structural peculiarities
mundane features
occasional contradictions

Once generated, they become canonical world state.

Procedural generation should emphasize:

incredible breadth with a mundane exterior

The majority of generated architecture should be boring enough to be credible.

9. FACILITY-SIDE SPATIAL RITUAL

The Facility is not a menu.

It is the diegetic operating system through which the player performs institutional functions.

Major Facility-side contexts should include:

Lower Offices

Primary assignment and briefing area.

Used for:

work orders
personnel records
prior mission material
assignment history
institutional notices
debrief records
Hazmat / Equipment Room

Operational staging area.

Used for:

suit preparation
loadout
equipment custody
specialty equipment
containers
team readiness
Maintenance Wing

The operational infrastructure surrounding Project KV31.

Used to contextualize:

power
machinery
Facility operations
Threshold support infrastructure
institutional activity
KV31 Control / Observation Room

The operational eye overlooking the Threshold Chamber.

Used for:

Standard communications
Threshold status
entry-team monitoring
final readiness
alternate worldpack perspectives
Threshold Chamber

The physical and conceptual hinge of Yellow Beast.

The player sees it when entering and leaving the Complex.

The Threshold should always open into the established Complex-side entry region.

As the Survey Frontier expands, expeditions become longer because assignments take place progressively farther from this fixed point.

Biomedical Laboratory

Used for recovered biological or anomalous material when applicable.

May contain:

returned samples
pathology records
recovered biological evidence
historical Facility records
analysis results
prior personnel cases
10. THE PLAYER-FACING SPATIAL RITUAL

A normal field operation should feel like a shift at work.

OUTBOUND

Lower Offices
Assignment and briefing

↓

Equipment / Hazmat
Personnel, loadout, custody, preparation

↓

Maintenance / KV31 access
Transition toward operations

↓

Control / Observation
Standard contact and Threshold readiness

↓

Threshold Chamber
Final accountability and crossing

↓

COMPLEX
RETURN

Threshold Chamber

↓

Return processing / Hazmat

↓

Evidence / Biomedical / Records where applicable

↓

Lower Offices / Debrief

↓

Institutional archive

↓

Next assignment

These should not feel like disconnected game menus.

They should feel like different rooms and institutional surfaces used for different purposes.

11. MISSIONS ARE ASSIGNMENTS, NOT QUESTS

There are no RPG quests.

No:

FIND 3 ANOMALOUS OBJECTS
+500 XP

Assignments should resemble actual work orders:

WORK ORDER CQ4-118
Verify continuity between prior survey markers.
Recover instrumentation if conditions permit.
Report structural deviation before further penetration.

Assignments explain:

what the institution expects
who is assigned
what equipment is authorized
what reporting is required
what conditions justify return or abort

They do not explain the narrative.

12. CLEAR-Q4 IS THE FLAGSHIP GAME MODE

Clear-Q4 is not one predetermined campaign.

It is a persistent family of field operations occurring within the same developing world.

Possible assignment families include:

routine survey
route verification
equipment recovery
instrumentation replacement
photographic documentation
structural assessment
personnel support
failed-team accountability
layout verification
sound-source investigation
lost media recovery
evidence corroboration
route-marker maintenance
communications infrastructure work
return-path verification
follow-up investigation

These are not separate campaigns.

They are institutional reasons to return to the same environment.

Assignments should intersect naturally.

A route discovered during operation 2 may become critical during operation 8.

Equipment abandoned during operation 4 may become the objective of operation 6.

A report from operation 1 may finally be corroborated during operation 12.

13. REAL FOLLOW-UP ASSIGNMENTS

Consequences should generate future work.

A structural discrepancy may produce:

CORROBORATION REQUIRED

Lost equipment may produce:

RECOVERY AUTHORIZATION

Missing personnel may produce:

ACCOUNTABILITY / SEARCH ASSIGNMENT

A failed electrical repair may produce:

SERVICE FOLLOW-UP

The game never says:

YOUR CHOICES MATTER.

The player notices that the next work order exists because of what previously happened.

14. OPERATIONS BETWEEN OPERATIONS

The institution does not cease existing when the player returns to the title screen.

However, background simulation must be strictly bounded to preserve player agency and attachment.

Between assignments, the simulation may resolve believable institutional activity such as:

administrative review
equipment servicing
staffing schedules
routine route verification
temporary restrictions
analysis of submitted evidence
support changes
follow-up authorization
records being confirmed or rejected
equipment being relocated
caches being established
known areas being administratively reclassified
Hard agency boundary

Background operations must not casually inflict irreversible dramatic consequences on important persistent personnel.

In particular, the game should not suddenly report:

Your favorite coworker died during an operation you never saw.

Permanent death, disappearance, severe injury, or equivalent irreversible personnel outcomes should normally require one of:

player-present operations,
a causal chain initiated during player-present operations,
an explicitly understood assignment or risk involving that personnel record.

Offscreen simulation may make coworkers:

unavailable
temporarily reassigned
in training
under review
recovering
assigned elsewhere

But player attachment must not be invalidated by arbitrary background catastrophe.

The world lives without the player.

It does not steal the player's story from them.

15. PERSISTENT PLAYER IDENTITY

The player creates an ASYNC personnel record rather than an RPG avatar.

The record includes:

name
personnel identifier
badge-style representation
assignment history
certifications
qualifications
equipment accountability
incident history
restrictions
institutional notes where appropriate
current availability
current field status

Do not represent the player through abstract RPG statistics such as:

Strength
Sanity
Reputation

Represent meaningful institutional state instead:

FIELD CLEARANCE: Q4
RESPIRATOR FIT: CURRENT
RADIO QUALIFICATION: CURRENT
EQUIPMENT REVIEW: REQUIRED
FIELD STATUS: AVAILABLE

Over time, this record quietly becomes the player's biography.

16. GENERATED COWORKERS BECOME PEOPLE THROUGH CONTINUITY

Entry teams are procedurally staffed.

Coworkers have persistent:

identity
role
qualifications
work history
previous assignments
known information
equipment custody
institutional status
decision tendencies
operational judgment
uncertainty
relationships arising naturally from shared history

They should not rely on massive chatbot personality prompts.

A worker becomes memorable because:

Ellis carried your lamp during the first survey.

Then:

Ellis refused an unsafe route.

Then:

Ellis was assigned again three missions later.

Then:

Ellis missed a check-in.

Character emerges from continuity.

17. NPC PERSONALITY AND REACTION

NPCs should react differently to events according to:

personality tendencies
current knowledge
perceived risk
role
qualifications
history
relationships
current task
confidence
fatigue or condition where relevant
institutional expectations

But NPCs should not react to everything.

Salience matters.

Some workers may:

comment frequently
become visibly concerned
question decisions
overcommunicate

Others may:

remain quiet
focus entirely on procedure
ignore minor anomalies
react only when operational thresholds are crossed

This variation makes coworkers distinct without turning every movement into dialogue.

18. FAILRP IS FORBIDDEN

FAILRP does not mean NPCs must know everything.

Quite the opposite.

Workers should possess bounded, observer-specific knowledge.

FAILRP means characters must not behave as though they occupy the wrong scene, wrong time, wrong context, or wrong reality.

Forbidden examples include:

discussing field danger while the player is still on the title screen
speaking as though the team crossed the Threshold before entry
knowing about an event they did not observe or receive
reacting to future mission states
describing unavailable geography as though personally visited
acknowledging game mechanics or hidden simulation information

NPCs may be:

wrong
uncertain
mistaken
misinformed
ignorant
skeptical

But they must always understand where they are, what they are doing, and what they legitimately know.

19. LOCAL COMMUNICATION

LOCAL communication should become one of Yellow Beast's signature systems.

The player should be able to communicate naturally:

“Miller, stay here and watch that doorway.”

“Take the camera.”

“Come look at this.”

“Go back to the junction.”

“Did you hear that?”

Custodian resolves:

proximity
hearing
contact
qualifications
available equipment
assigned task
current knowledge
decision tendency
willingness
operational judgment
route availability
hazards
current conditions

The coworker may:

comply
refuse
question
misunderstand
request clarification
delay
lose contact later

The LLM does not decide whether the action happened.

Custodian decides reality.

Presentation makes the result natural.

20. STANDARD MUST FEEL TERRIFYINGLY NORMAL

The person or people behind Standard communications are among the most important characters in Yellow Beast.

They should never behave like a theatrical evil-corporation AI.

Standard behaves like a competent operations desk.

Standard:

receives information
fails to receive information
schedules check-ins
acknowledges reports
asks for clarification
denies requests
approves deviations
redirects resources
adjusts staffing
modifies equipment availability
records failures
remembers incidents
evaluates evidence
imposes restrictions
assigns follow-ups

Sometimes the most disturbing response should simply be:

COPY. CONTINUE ASSIGNED WORK.

Because given what Standard knows, that is the reasonable response.

21. STANDARD PERSONNEL IDENTITY

The voice on the other side should not necessarily remain an anonymous abstract institution forever.

The Standard-side controller or operator may be generated as a persistent personnel identity for the world.

The player should initially know them only through operations.

Following sufficient institutional contact, records, or in-person Facility interaction, their identity may become available naturally.

They remain a worker doing a job, not a narrator.

22. COMMUNICATION LATENCY IS REAL STATE

Communications are not decorative dialogue.

Information movement is simulation.

A fact may pass through:

OCCURRED
↓
OBSERVED
↓
RECOGNIZED
↓
RECORDED
↓
REPORTED
↓
TRANSMISSION ATTEMPTED
↓
DELIVERED
↓
ACKNOWLEDGED
↓
EVALUATED
↓
INSTITUTIONAL RESPONSE

Any link may fail.

Therefore:

Player observed X

does not mean:

Standard knows X.

This distinction must remain visible and mechanically consequential throughout 1.0.

23. EQUIPMENT IS BORINGLY IMPORTANT

Equipment is not loot.

There is no:

Legendary ASYNC Multimeter +7

There are simply things workers need to do their jobs.

Examples:

radios
flashlights
field lamps
cameras
film
batteries
notebooks
evidence sleeves
measurement instruments
respirators
route markers
rope / line
repair equipment
containers
specialty instruments

Equipment tracks meaningful state such as:

custody
location
condition
capacity
charge
quantity
accessibility
authorization
availability

Losing an expensive instrument may sometimes produce a stronger institutional response than witnessing something impossible.

That is intentional.

24. EVIDENCE IS A FIRST-CLASS SYSTEM

Evidence should become deep without becoming flashy.

Evidence records may include:

creator
timestamp
operational time
location
method
equipment
source object
provenance
condition at capture
storage
custody
reporting state
availability to Standard
associated observations
institutional confidence
later analysis
contradictions
derived render metadata

Evidence exists because an action created it.

The renderer does not create simulation truth.

25. PROCEDURAL PHOTOGRAPHIC EVIDENCE

Yellow Beast 1.0 should make deliberate use of trained procedural image generation for evidence.

The purpose is not random visual spectacle.

The pipeline is:

AUTHORITATIVE SIMULATION
↓
Evidence event exists
↓
Observer-safe evidence description
↓
Render specification
↓
Procedural image generation
↓
Photographic record

The simulation may establish:

A photograph was taken in this location, with this equipment, under these conditions, containing these legitimately observable properties.

Only then does the image renderer produce the artifact.

Never:

The image model generated a creature, therefore a creature existed.

Generated media is presentation of established evidence, never a source of canonical truth.

The goal is for evidence review to resemble examining actual ASYNC case material.

26. EVIDENCE ARCHIVE PRESENTATION

A photographic record might appear as:

PHOTOGRAPHIC RECORD
CQ4-2026-0418-07

OPERATOR: J. Rocha
CAMERA: Unit CAM-04
LOCATION: Utility Survey / West Continuation
TIME: T+01:18:33
CHAIN OF CUSTODY: RETURNED
STANDARD STATUS: REVIEWED
ASSOCIATED REPORT: CQ4-RPT-118

followed by the image.

Evidence may later conflict with:

player memory
another photograph
historical records
Standard's understanding
subsequent observations

Those contradictions must be established by simulation truth, not hallucinated by rendering.

27. ENVIRONMENTAL SIMULATION

The Complex needs persistent mundane environmental state.

Potential systems include:

lighting circuits
local power
equipment hum
air movement
temperature zones
moisture
structural condition
blocked routes
open routes
debris
residual equipment
signage
prior markers
communications coverage
acoustic conditions
vertical discontinuities
pits or drops with unknown depth
machinery
damaged infrastructure

Places should have conditions, not only descriptions.

Systems should affect one another.

For example:

POWER FAILURE
↓
lighting changes
↓
repeater becomes unavailable
↓
communications degrade
↓
navigation becomes more difficult
↓
equipment matters more
↓
Standard still does not automatically know why
28. RARE PHENOMENA

Phenomena should be genuinely rare.

Players should be able to complete several operations with nothing overtly supernatural occurring.

A phenomenon matters because the game has not trained the player to expect one every mission.

Prefer:

An object is somewhere it demonstrably wasn't.

over:

ENTITY ENCOUNTER #6.

Possible 1.0 phenomenon families include:

spatial inconsistency
unexplained object displacement
acoustic events
transient architecture
environmental discontinuity
evidence inconsistency
rare Still-Life-adjacent states
rare Bacteria encounters

Every phenomenon must obey observer and information boundaries.

29. STILL LIFE

Still Life should not function as a spawnable enemy archetype.

Still Life should be:

procedural
persistent
world-bound
extremely rare
environmentally integrated
observer-dependent
capable of becoming evidence
capable of remaining undiscovered indefinitely

A Still Life may continue to exist after the player leaves.

Its state belongs to the world.

It should feel like something the Complex contains, not something the game dispatched for entertainment.

30. BACTERIA

Bacteria may exist in 1.0 as an extremely rare high-risk phenomenon.

It should not create a routine monster loop.

Its presence should be exceptional.

Potential behavior includes:

pursuit
avoidance
loss of contact
acoustic detection
voice mimicry
confusion of human and non-human signals
persistent consequences

Bacteria should be frightening because most operations do not contain it.

Encounter frequency must be protected aggressively.

31. NO SANITY SYSTEM

There is no abstract sanity meter.

Workers do not become percentages.

If personnel experience something severe, consequences emerge through:

communication
behavior
willingness
institutional review
operational fitness
injury
uncertainty
refusal
absence
future assignment status
later records

People are not health bars.

32. PERSONNEL LOSS IS ADMINISTRATIVE HORROR

Personnel loss should be horrifying because the institution must account for it.

A coworker disappears.

No cinematic death scene is required.

The team returns.

Accountability reads:

PERSONNEL RETURN STATUS: 3 / 4

Later:

MILLER, A.
STATUS: UNRETURNED
ACTIVE ASSIGNMENT: CLOSED

On the next operation, someone else may carry Miller's former equipment.

That is enough.

33. COMPLETION AND FAILURE FAMILIES

Yellow Beast 1.0 should support a broader result vocabulary than simple success/failure.

Current and target families:

clean-completion
enhanced-completion
recovered-complication
degraded-completion
controlled-abort
mission-failure
personnel-loss
total-personnel-loss
mission-failure-unrecoverable
mission-failure-recoverable

These represent conditions derived from authoritative state, not score grades.

Recoverable failure

The operation failed, but later work may resolve the condition.

Unrecoverable failure

The objective has become permanently impossible, personnel are irretrievably lost, a route or resource has become unusable, or equivalent conditions prevent later repair.

Total personnel loss

No assigned field personnel return.

If this includes the controlled player, the active world ends under the death rules above.

34. INSTITUTIONAL AFTERMATH

Every operation produces consequences beyond a score screen.

Debrief derives from:

what happened
what was observed
what was returned
what was reported
what Standard knows
what equipment returned
what evidence returned
who returned
what remains unresolved
what institutional policy now changes

Consequences may affect:

restrictions
future equipment
staffing
scrutiny
operational confidence
support
route policy
mission authorization
follow-up assignments

The debrief should appear as an institutional document experienced by the player's character.

35. THE ARCHIVE IS THE LORE SYSTEM

Yellow Beast does not need a traditional game codex.

The player builds their own archive through play.

The archive may contain:

assignments
personnel
previous rosters
reports
evidence
photographs
communications
equipment losses
institutional decisions
known geography
unresolved reports
casualty records
follow-up work
historical Facility material

Knowledge is acquired through records.

Some records may conflict.

Some may remain unresolved forever.

There is no encyclopedia entry titled:

ENTITY #12: THE WALLPAPER MAN

The player's lore is the accumulated bureaucracy of their own world.

36. MULTIPLE INSTITUTIONAL INTERFACES

Yellow Beast should feel like an ecosystem of institutional tools rather than one videogame HUD.

Surfaces include:

Records Terminal

World, personnel, historical records.

Briefing Packet

Assignment and operational requirements.

Staging Interface

Personnel, equipment, loadout, custody.

Field Operations Console

Current operation and observer-safe state.

LOCAL

Nearby personnel communication.

STANDARD

Radio / institutional communication.

Evidence Viewer

Media and records.

Debrief

Return, reconciliation, institutional conclusions.

Assignment Board / Follow-Up

Future work.

Different contexts may use different visual language while sharing a coherent institutional design system.

37. DIEGETIC ONBOARDING

Avoid:

Welcome to Yellow Beast! Press this button to continue!

Prefer:

NEW PERSONNEL ORIENTATION
Field operations terminal requires active personnel identification.

The game teaches itself through believable institutional procedure.

However:

Authenticity is never an excuse for bad UX.

Help must remain:

reopenable
accessible
readable
contextual
skippable where appropriate
38. UI COMMANDMENT: NO CEREMONIAL BUTTONS

No click-next gameplay.

Every interaction must do at least one of four things:

change state, request information, navigate institutional space, or communicate an explicit consequence.

Buttons must have understandable purposes.

Avoid endless sequences of:

Continue
Continue
Continue
Continue

Documents are read.

Assignments are acknowledged.

Equipment is issued.

Doors are crossed.

Reports are transmitted.

People are addressed.

Records are opened.

The interface reacts because the player did something.

39. THINGS TO DO

Yellow Beast must satisfy a basic human requirement that simulation architecture alone cannot:

The player must understand what they can meaningfully do.

Every gameplay phase must expose understandable operational affordances.

At any point in field play, the player should be able to answer:

What can I observe?
Where can I go?
What can I interact with?
Who can I talk to?
What am I carrying?
What am I responsible for?
What does my assignment currently require?
What changed because of my last action?

A beginner should not need gaming literacy to begin.

An experienced player should not feel trapped inside tutorial controls.

The structured interface provides clarity.

Natural language provides expressive depth.

A proficient player should eventually be able to type:

“Have Miller photograph the fixture while I check whether the conduit continues behind the wall.”

and have the simulation resolve the actual constituent actions and constraints.

40. PRIMARY CONTEXT PRESENTATION

The player's immediate understanding of the world comes from one coherent presentation stream.

In offline mode, this may be authored/deterministic observer-safe text.

With an AI provider, the same interface may present richer interpretation.

It should feel roughly like:

a choose-your-own-adventure audiobook expressed through institutional text

but backed by an actual simulation.

The presentation describes what the player can legitimately perceive.

It does not write the world.

41. AI IS NOT THE DUNGEON MASTER

Internally, the term Dungeon Master should not define the AI architecture.

A Dungeon Master creates truth.

The AI provider must not.

The correct conceptual boundary is:

Custodian is the Simulation Director.
AI is the Interpreter / Presentation Director.

Custodian owns:

world truth
missions
personnel
consequences
hazards
movement
geography
evidence
equipment
communications
institutional knowledge

AI may:

interpret natural-language intent
select among legal observer-safe actions
phrase narration
vary wording
create richer presentation
render authorized evidence media

AI cannot:

invent an encounter
kill someone
move a worker
create evidence truth
complete an objective
alter geography
decide what Standard knows
change canonical state outside authorized simulation actions

This boundary is sacred.

42. PROVIDER MODEL

Yellow Beast 1.0 should ideally support three interchangeable presentation/interpreter modes:

Offline Deterministic

Always available.

No external service required.

Local AI

Optional.

Private local model where technically reliable.

OpenAI

Optional hosted interpretation/presentation.

A player must never be required to possess an API key to play the complete game.

43. STRONG OFFLINE MODE

Offline Yellow Beast includes:

all core simulation systems
world creation
missions
field actions
communications
personnel
hazards
consequences
evidence
saves
debriefs
deterministic narration
full Clear-Q4 play

Online or local AI enhances presentation.

It does not unlock the actual game.

44. AUDIOVISUAL IDENTITY

Yellow Beast should not merely imitate a generic “Backrooms aesthetic.”

It needs a recognizable Yellow Beast / ASYNC institutional identity.

Visual language may draw from:

industrial workstations
faded institutional plastics
paper records
photographic evidence
instruments
technical interfaces
restrained CRT/phosphor ideas
ASYNC-inspired industrial typography
amber/green operational status hierarchy
very limited animation
fixed Facility imagery
contextual room imagery
evidence media

The interface should feel as though it fell out of the world.

45. SOUND DESIGN

Sound should primarily establish machinery, architecture, procedure, and distance.

Core palette:

ballast hum
relays
printer mechanisms
paper feed
ventilation
room tone
radio compression
electrical buzz
equipment movement
footsteps when appropriate
distant machinery
Threshold machinery
environmental acoustic differences

Avoid:

constant music
horror stingers
scare chords
theatrical monster cues
Design principle

Architecture behaves like an instrument.

Silence remains part of the soundscape.

46. AUDIOVISUAL REFERENCE POLICY

For internal development, Kane Pixels material may serve as direct artistic and technical reference for:

sound character
space
visual composition
Facility design
terminology
interface flavor
equipment
environmental rhythm

Project ownership and distribution decisions should follow the permissions and rights basis already established separately by the project owner.

The design charter does not need to relitigate those permissions during ordinary implementation.

47. HUMAN-FACING ACCESSIBILITY AND QoL

Accessibility is a launch feature, not a post-release patch.

1.0 should support a wide range of players without compromising institutional presentation.

Targets include:

keyboard-only operation
predictable focus
scalable text
high contrast
reduced motion
reduced sensory options
non-color status cues
readable hierarchy
small-window support
Windows scaling
Mac scaling
clear error states
recoverable navigation
structured-action parity
natural-language alternatives
persistent help
understandable empty states

The interface should be pleasurable enough for repeated play.

48. SAVE SAFETY

Save behavior must be boringly reliable.

The game should preserve:

world state
personnel
equipment
missions
communications
evidence
geography
hazards
Standard knowledge
institutional state
follow-ups
generated rooms
player history

Normal application shutdown, restart, or interruption must not silently erase canonical progress.

Supported older save versions should migrate explicitly.

Unknown formats should fail safely instead of resetting.

49. TESTER / DIAGNOSTIC EXPORT

Yellow Beast should include:

EXPORT DIAGNOSTIC RECORD

The export is sanitized and contains enough information to reproduce failures without exposing unnecessary secrets.

Possible contents:

application version
platform
world/run seed
current phase
recent public actions
errors
save schema
provider status
relevant logs
configuration
renderer state where safe

This converts:

“It broke in a hallway”

into something useful.

50. WORLDPACKS MUST ACTUALLY SHIP AS A SYSTEM

Custodian must not remain an internal miracle that only Yellow Beast understands.

1.0 worldpack support should include:

documented format
schemas
validator
previewer
deterministic trace
focused test runner
useful errors
example content
independent fixture pack
starter template
authoring documentation

Someone should eventually be capable of building:

another institution
another environment
another operation

without editing Custodian itself.

Yellow Beast therefore serves simultaneously as:

a complete game,
the flagship Custodian implementation,
proof that the framework is reusable.
51. SECOND AUTHORED PROOF

Before 1.0, Custodian should power at least one additional small operational experience beyond standard Clear-Q4 field play.

It does not need to be a second campaign.

A strong candidate is a Standard-side operation.

For example:

The player operates from the KV31 Observation / Control Room while communicating directly with a field team entering the Complex.

This could test:

reversed information boundaries
Standard communication
remote personnel
incomplete field observations
delayed information
decision authorization
operational oversight
worldpack reuse

A 20–30 minute experience is sufficient.

Its purpose is architectural proof:

Clear-Q4 field gameplay was not secretly hardcoded into Custodian.

52. HUMAN BETA HISTORY IS REQUIRED

Automated testing is necessary.

It is not sufficient.

Before 1.0, Yellow Beast must survive humans.

Testing should include:

developer playthroughs
fresh-player playthroughs
recorded runs
strange inputs
save/recovery failures
accessibility testing
misunderstanding of UI
unconventional strategies
deliberately bad decisions
attempts to break sequencing
long-lived worlds
repeat veterans

Humans will attempt things no acceptance harness predicted.

That is part of certification.

53. SCREEN-RECORDING TEST WORKFLOW

Human gameplay validation should deliberately use continuous screen recordings.

Useful recordings include:

launch
world creation
personnel creation
briefing
staging
Threshold
field operation
interactions
communications
evidence
return
debrief
save
shutdown
relaunch
resume

Each discovered defect becomes:

HUMAN OBSERVATION
↓
DEFECT
↓
PATCH
↓
FOCUSED REGRESSION TEST
↓
BUILD
↓
REPLAY

Automated and human evidence should reinforce one another.

54. RELEASE PHILOSOPHY

Yellow Beast 1.0 is ready when someone who knows absolutely nothing about Custodian can:

download it
launch it
understand how to create a world
create personnel
receive an assignment
prepare equipment
enter the Complex
understand reasonable actions
communicate with coworkers
communicate with Standard
complete or fail an operation legitimately
experience consequences
return
receive a grounded debrief
discover follow-up work
close the game
return later
find the simulation exactly where it belongs

And after several runs, they can describe what happened in actual Backrooms-world terms rather than explaining UI mechanics.

55. NON-NEGOTIABLE DESIGN COMMANDMENTS

These govern every remaining pass.

1. Constant credibility beats constant excitement.
2. Custodian owns truth.

Presentation never invents canonical state.

3. The Threshold is fixed. The Survey Frontier moves.
4. Generated geography becomes persistent geography.
5. Worlds remember.
6. Death is final.

A player's death retires the world rather than rewinding it.

7. Personnel become characters through history.

Not exposition.

8. NPCs may lack information but may never FAILRP.

They must understand their actual scene and legitimate context.

9. Standard only knows what reached Standard.
10. Equipment is mundane and consequential.
11. Evidence has provenance.
12. Generated evidence media presents truth. It never creates truth.
13. Rare phenomena remain rare.
14. No sanity bars.
15. Personnel loss is treated administratively.
16. Missions are jobs.

Not quests.

17. Consequences generate work.

Not “choice mattered” banners.

18. The archive is the lore system.
19. The Facility is spatial UI.

Not a menu skin.

20. No ceremonial buttons.

Every control changes state, requests information, navigates institutional space, or communicates a consequence.

21. There must always be something meaningful the player understands they can do.
22. Silence is valid gameplay.
23. Background simulation cannot casually steal player agency.
24. Offline play is complete play.
25. Accessibility ships on day one.
26. Do not rewrite proven simulation authorities for cosmetic reasons.
27. No feature belongs in 1.0 merely because it would be cool.

It belongs only if it serves this charter.

56. YELLOW BEAST 1.0, IN ONE SENTENCE

A persistent institutional simulation in which the player works for ASYNC, repeatedly enters a growing and partially understood Complex through the fixed Threshold, builds relationships and records through lived operations, preserves evidence and consequences across a finite mortal career, and slowly participates in an institution trying to impose procedure on something that may never fully submit to it.

END STATE

This document is the 1.0 Design Charter.

It defines what must exist, what must remain true, and what Yellow Beast must feel like.

The next development document should not add more dreams to this one.

It should translate this charter into:

dependencies → systems → passes → acceptance gates → playable builds → beta → 1.0

From this point forward, the question for every proposed feature is:

Does this move Yellow Beast toward the experience defined here?

If yes, it gets placed into the correct pass.

If not, it waits outside the Threshold.