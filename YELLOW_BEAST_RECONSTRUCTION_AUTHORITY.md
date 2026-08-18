# YELLOW BEAST RECONSTRUCTION AUTHORITY

## Post-Reconciliation Design Constitution, Player-Experience Target, and Reconstruction Standard

**Version:** 1.0  
**Date:** 2026-08-18  
**Status:** Canonical Yellow Beast reconstruction/design authority  
**Scope:** Yellow Beast product reconstruction after reconciliation, including gameplay, simulation behavior, A-Sync institutional behavior, Complex behavior, dialogue, personnel, evidence, UI, missions, persistence, phenomena, pacing, audiovisual presentation, and acceptance criteria.

---

# 0. AUTHORITY, PURPOSE, AND PRECEDENCE

This document exists to prevent Yellow Beast from ever again being reconstructed as a loose collection of individually plausible features that only approximate the intended experience.

Yellow Beast is one simulated relationship between:

- the Complex,
- A-Sync as an institution,
- A-Sync personnel,
- the player as field team leader,
- equipment and installed infrastructure,
- evidence and institutional knowledge,
- procedure and hierarchy,
- memory and persistence,
- and the incomplete models through which humans try to understand an impossible place.

This document is the **primary Yellow Beast reconstruction/design authority** after reconciliation.

It is the first document a developer, coding agent, auditor, or future maintainer should use when asking:

- What game are we actually rebuilding?
- What must a system accomplish experientially, not merely technically?
- What makes a feature Yellow Beast rather than generic Backrooms gameplay?
- What behaviors are foundational and must survive implementation changes?
- What should be rejected even if it appears exciting, scary, cinematic, or technically impressive?

This document does **not** supersede the repository-wide `SIMULATION_DOCTRINE.md`. The Simulation Doctrine remains the highest normative authority for canonical reality, observer-safe interpretation, information flow, AI limits, uncertainty, and player-facing truth.

This document specializes that Doctrine for Yellow Beast.

The authority order for Yellow Beast reconstruction is therefore:

1. `SIMULATION_DOCTRINE.md` for universal simulation law.
2. Explicit Kane-derived worldpack canon authorities and any later formally adopted canon amendments.
3. **This document, `YELLOW_BEAST_RECONSTRUCTION_AUTHORITY.md`, for Yellow Beast product identity, player experience, system relationships, and reconstruction acceptance.**
4. The August 13, 2026 **Yellow Beast 1.0 — Final Development Campaign and Operating Workflow** for development order, implementation cadence, model/tool roles, and pass sequencing.
5. Reconciliation/audit findings for known defects, remediation obligations, and truth about implementation status.
6. Current technical architecture contracts, verification inventories, pass specifications, and focused implementation plans.
7. Presentation-specific design documents, UI/audio indexes, prompt contracts, and lower-order implementation notes.
8. Generated prose, AI interpretation, and incidental implementation behavior.

Where this document and the August 13 campaign appear to differ, interpret them as addressing different questions:

- **This document says what Yellow Beast must become.**
- **The August 13 campaign says how development proceeds toward it.**

This document is not permission to skip foundation work, verification, persistence gates, reconciliation obligations, or falsifiable pass boundaries.

No discovery in this document is grounds for prematurely implementing exciting features while foundational truth remains unstable.

---

# 1. PRIMARY REFERENCE CORPUS

This authority incorporates lessons extracted from a complete close watch of the Kane Pixels Backrooms series through the current corpus used during reconstruction, including:

1. The Backrooms (Found Footage)
2. Mar11_90_ARCHIVE.tar
3. The Third Test
4. First Contact
5. Missing Persons
6. Autopsy Report
7. Informational Video
8. Motion Detected
9. Prototype
10. Pitfalls
11. Report
12. 9780415263573
13. Presentation
14. _recording014
15. Found Footage #2
16. home_27647.mov
17. Reunion
18. Damage Control
19. Overflow
20. Lighting and Tile Survey
21. Found Footage #3
22. Static Dead End
23. Instancing

The corpus is used here as a **player-experience and world-behavior reference**, not as a list of scenes to reproduce.

Yellow Beast must not become a reenactment machine.

The project should inherit:

- causal relationships,
- institutional behavior,
- information asymmetry,
- dialogue logic,
- environmental logic,
- pacing,
- procedural texture,
- and the relationship between routine and anomaly.

It should not copy recognizable events merely because they are memorable.

---

# 2. THE PRODUCT THESIS

The central Yellow Beast fantasy is not:

> What if I fell into the Backrooms?

The Kane series already demonstrates that civilian experience with extraordinary force.

The Yellow Beast fantasy is:

> **What if the impossible became my job?**

The player is not a random survivor, chosen hero, omniscient investigator, or tactical monster hunter.

The player is a working field team leader inside an institution that has made the impossible operational enough to schedule shifts, issue equipment, create maps, assign missions, classify evidence, discipline personnel, grant access, revise policy, and plan development around it.

The player should feel:

- professionally capable,
- procedurally grounded,
- socially embedded,
- institutionally constrained,
- curious,
- responsible for other human beings,
- and never completely certain that the model guiding the mission is still true.

The target emotional contradiction is:

> **constantly on edge while constantly feeling in control.**

Control comes from:

- procedure,
- preparation,
- team relationships,
- equipment,
- radios,
- maps,
- experience,
- institutional support,
- the known route home,
- and accumulated knowledge.

Unease comes from the fact that every one of those handholds is provisional.

Yellow Beast is strongest when the player can say:

> I know what my job is. I know what the equipment does. I know these people. I know the route. I know what STANDARD expects. I know what happened here last time.

while still being unable to say:

> I know what this place ultimately is.

---

# 3. THE SINGLE MOST IMPORTANT DESIGN PRINCIPLE

**The game must feel like work before it feels like horror.**

If an expedition begins as horror content, the player has no baseline to lose.

If every hallway advertises danger, danger becomes wallpaper.

If every mission guarantees spectacle, spectacle becomes routine.

The player must first learn what a normal day means.

Normal includes:

- staging,
- carrying equipment,
- confirming identities,
- checking radios,
- crossing the Threshold,
- following an established cable or route,
- discussing ordinary work,
- installing or recovering equipment,
- verifying measurements,
- checking map landmarks,
- taking photographs,
- waiting for STANDARD,
- doing nothing remarkable for long stretches,
- returning without a major discovery,
- completing reports,
- and seeing A-Sync absorb the work into tomorrow's plan.

Only after the game has established reliable routine does a deviation become powerful.

A corridor being missing is frightening because it was there before.

A radio call is frightening because radio calls normally work.

A teammate going silent is frightening because their voice is familiar.

A camera showing something unusual matters because most camera events are boring.

A map contradiction matters because the map is usually useful.

A denied evidence screen matters because access normally exists.

Routine is not filler.

Routine is the stored energy that anomaly spends.

---

# 4. REALITY MUST PRECEDE NARRATIVE

Yellow Beast must never resolve reality through prose.

The order is:

1. World state exists.
2. Systems determine what actually happens.
3. Observers and sensors perceive only what they legitimately can.
4. Evidence may or may not be created.
5. Communication may or may not transmit successfully.
6. People interpret what they know.
7. A-Sync updates institutional belief if evidence reaches it and is accepted.
8. Presentation systems describe only that legitimate state.

No interpreter, AI model, dialogue generator, narrator, UI convenience layer, or dramatic scene should decide the underlying event.

Yellow Beast must support disagreement without collapsing into contradiction.

The player, Nora, Alex, a camera, STANDARD, Biomedical, and the A-Sync map may all possess different legitimate slices of the same event.

This is not a bug.

It is one of the game's central sources of drama.

---

# 5. THE KNOWLEDGE MODEL

The Kane corpus repeatedly demonstrates that horror often emerges from disagreement between different versions of reality.

Yellow Beast therefore needs a strong conceptual separation between the following layers.

## 5.1 World truth

What objectively exists and happened.

Examples:

- the corridor exists or does not,
- a teammate was injured,
- a sample has a specific composition,
- a camera changed orientation,
- a person crossed a boundary,
- a radio transmission occurred,
- a phenomenon was present,
- an installed cable physically occupies a route.

World truth is canonical simulation state.

It is not automatically known by any person.

## 5.2 Observed truth

What a legitimate observer perceived.

Jack may see something Nora did not.

Nora may hear something Jack did not.

A person may misidentify what they observed without the underlying observation becoming false.

## 5.3 Recorded truth

What instrumentation captured.

A camera may capture movement.

A microphone may capture sound.

A meter may record temperature, radiation, magnetic behavior, pressure, or another measurable quantity.

Sensors should report **observables**, not metaphysical conclusions.

A motion detector reports motion.

It does not report “entity.”

A temperature probe reports temperature.

It does not report “anomaly.”

Recorded truth may be incomplete, noisy, corrupted, misleading, or uninterpreted.

## 5.4 Analytical interpretation

Evidence is processed by people or systems with specific expertise.

A field team may recover a light fixture.

Materials analysis may notice dimensional irregularity.

Electrical may identify impossible supply behavior.

Records may identify a manufacturer.

Different departments can produce different, simultaneously valid findings.

## 5.5 Institutional truth

What A-Sync currently accepts as the best operational model.

Institutional truth may be:

- correct,
- incomplete,
- provisional,
- stale,
- disputed,
- compartmentalized,
- sanitized,
- or deliberately deceptive.

Institutional truth is what produces maps, restrictions, classifications, briefings, mission objectives, safety rules, and management decisions.

## 5.6 Institutional intent

What A-Sync is trying to make true.

Examples:

- establish a safe route,
- extend surveillance,
- survey a sector,
- stabilize access,
- prepare industrial use,
- recover missing equipment,
- investigate a hazard,
- determine whether a space is suitable for development.

Institutional intent generates work.

## 5.7 Player knowledge

What the human player remembers or infers.

This layer is especially powerful because the game cannot fully control it.

The player may know a doorway used to exist even if A-Sync's map says otherwise.

The player may remember that a coworker never uses a particular phrase.

The player may recognize an object the institution considers mundane.

Yellow Beast should trust the player's memory and pattern recognition instead of constantly confirming anomalies with UI banners.

---

# 6. THE CORE GAME LOOP

The deepest Yellow Beast loop is not a quest loop.

It is an **institutional epistemology loop**.

The canonical loop is:

1. A-Sync holds a current institutional model of the Complex.
2. That model produces institutional goals.
3. Goals produce assignments.
4. The player stages with personnel and equipment.
5. The team enters actual Complex geography.
6. Reality may confirm or contradict the institutional model.
7. People and instruments observe different portions of what occurs.
8. The player makes leadership decisions under incomplete information.
9. Evidence is recovered, lost, damaged, or never produced.
10. The team returns, aborts, becomes separated, or suffers consequences.
11. Reports, samples, imagery, telemetry, and personnel testimony enter institutional processing.
12. A-Sync interprets the evidence.
13. The institutional model changes or resists change.
14. Maps, restrictions, standing, equipment access, staffing, infrastructure, terminology, and future missions change.
15. The player returns to work inside a world that remembers the previous operation.

Then the loop repeats.

The most important emergent stories occur in the gap between:

> **what A-Sync expected**

and

> **what reality actually did.**

---

# 7. A-SYNC: THE INSTITUTIONAL MODEL

A-Sync must not be written as a generic evil corporation.

Its power comes from being credible.

A-Sync is an organization attempting to turn impossible space into administrable territory.

It has:

- researchers,
- engineers,
- field personnel,
- management,
- operations staff,
- security,
- analysts,
- medical and technical specialists,
- legacy systems,
- historical projects,
- incomplete records,
- overlapping responsibilities,
- and internal disagreements.

The institution's core behavior is:

> discover → measure → classify → write procedure → build infrastructure → deploy → encounter failure → investigate → revise.

This cycle creates local competence without global mastery.

A-Sync can become extremely good at operating inside conditions it still does not fundamentally understand.

That contradiction is foundational.

## 7.1 A-Sync should believe in its own work

Most employees should not behave like cultists, secret villains, or horror characters.

They are at work.

They may believe the project is valuable.

They may be excited by discoveries.

They may trust management.

They may distrust management.

They may become cynical while still remaining excellent employees.

They may disagree without abandoning the institution.

## 7.2 Institutional danger does not require malice

A dangerous instruction can result from:

- stale information,
- incomplete telemetry,
- schedule pressure,
- scientific opportunity,
- equipment already committed,
- established abort criteria not yet being met,
- a different understanding of risk,
- management expectations,
- or genuine belief that continuation is safer than improvisation.

This is stronger than constant intentional sacrifice.

## 7.3 A-Sync knowledge is horizontally compartmentalized

The knowledge structure should not be modeled only as “higher clearance knows everything.”

Field personnel know conditions Biomedical does not.

Biomedical knows sample behavior Field does not.

Engineering knows equipment history STANDARD does not.

STANDARD may have remote telemetry the team cannot see.

Management may know strategic goals others do not.

The player can legitimately know more than a senior employee about one specific event and less about another.

## 7.4 Institutional momentum matters

Once A-Sync has invested in infrastructure, personnel, public promises, internal plans, and future development, it acquires momentum.

The organization may continue after frightening discoveries because stopping has costs and because previous successes appear to justify continued work.

That momentum should be visible without reducing the institution to villainy.

---

# 8. STANDARD

STANDARD is not a narrator.

STANDARD is not an omniscient AI.

STANDARD is remote institutional authority acting from legitimate but incomplete institutional knowledge.

STANDARD should primarily handle:

- authorization,
- status,
- check-ins,
- mission direction,
- routing,
- telemetry,
- requests,
- procedural confirmation,
- escalation,
- institutional response,
- and controlled information access.

STANDARD should not constantly interpret phenomena for the player.

STANDARD may be wrong because the accepted institutional model is stale.

STANDARD may be correct about something the team doubts.

STANDARD may know something the team does not.

STANDARD may fail to know something physically obvious to the field team.

This is the foundation of meaningful field-command conflict.

The player is team leader.

STANDARD controls institutional authorization.

The player controls actual human bodies in the field.

When STANDARD says continue and the team expresses hesitation, the decision becomes meaningful because both sides have real authority over different things.

---

# 9. LOCAL AND DIALOGUE

Yellow Beast dialogue must never be generated by asking for a generic “Kane Pixels style.”

There is no single Kane voice.

The correct speech output depends on:

- who is speaking,
- who they are speaking to,
- why they are speaking now,
- what they legitimately know,
- what they want another person to do or understand,
- their institutional role,
- their relationship to the listener,
- their operational context,
- and their stress state.

## 9.1 Dialogue exists to alter shared state

People speak because they want someone to:

- look,
- move,
- stop,
- wait,
- answer,
- confirm,
- help,
- carry something,
- report something,
- remember something,
- leave,
- or understand a relevant fact.

Casual conversation exists because humans are social, but it should not become constant exposition.

## 9.2 Shared context allows short speech

Coworkers looking at the same problem do not need to describe the entire problem to each other.

They may use:

- fragments,
- pronouns,
- shorthand,
- incomplete sentences,
- one-word objections,
- repeated names,
- silence,
- abandoned thoughts,
- or context-dependent references.

AI dialogue becomes artificial when every line is self-contained prose.

## 9.3 Speech registers

Yellow Beast should preserve distinct registers.

### Civilian / untrained

Immediate sensory reality, simple questions, calls for help, improvised testing, emotional self-regulation.

### Public / executive institutional

Polished, complete, benefit-oriented, strategic, quantitative, controlled.

### Technical operations

Measurements, warnings, concise commands, deviations, confirmation, equipment state.

### Field personnel

Shared-context shorthand, task coordination, jokes, practical observations, hesitation, interpersonal cues.

### Specialist analysis

Measurement-driven, comparative, precise where expertise applies, uncertain where it does not.

### Internal escalation

Professional procedure at first, increasingly fragmented as implications become clear.

### Incident review / damage control

Retrospective, careful, causally framed, sensitive to organizational consequence and ambiguity.

### Management / briefing

Clear about known procedures and expectations; not artificially cryptic.

## 9.4 Stress changes speech

Routine:

- shorthand,
- banter,
- procedural terminology.

Uncertainty:

- checking,
- comparison,
- “wait,”
- incomplete description.

Concern:

- names,
- shorter phrases,
- repeated confirmation.

Acute danger:

- imperatives,
- repetition,
- basic concrete language,
- degraded technical precision.

Panic:

- human survival language.

A professional does not stop being the same person under stress, but their available speech bandwidth changes.

## 9.5 Silence is valid

LOCAL should not generate dialogue merely because nobody has spoken recently.

Three people can walk for several minutes without producing “content.”

Silence belongs to the world.

## 9.6 The player never speaks without player input

The player character's words must never be invented for conversational convenience.

The simulation may describe player actions that were legitimately chosen or resolved.

It may not fabricate player dialogue.

This is especially important in emotionally charged or leadership scenes.

---

# 10. PERSONNEL ARE PEOPLE, NOT COMPANION ARCHETYPES

Generic coworkers are a fundamental Yellow Beast failure.

Recurring personnel are required because history itself is gameplay.

NPC identity should emerge primarily from:

- consistent operational tendencies,
- relationships,
- memory,
- competence,
- habits,
- role knowledge,
- risk tolerance,
- stress behavior,
- communication style,
- and accumulated shared experience.

A character should not be reduced to a visible adjective bundle such as “witty, cautious, loyal.”

Instead, identity should become obvious through behavior.

Examples:

- always checks radio twice,
- hates crossing unknown floor structures,
- volunteers to carry certain equipment,
- trusts STANDARD more than the player does,
- always requests another measurement,
- jokes during routine work but becomes silent under real fear,
- dislikes leaving people behind,
- overpacks,
- underestimates risk,
- remembers specific past mistakes,
- has a preferred colleague,
- avoids a place after a previous incident.

## 10.1 Experience changes future behavior

Loss, injury, failure, discovery, conflict, and success should alter later decisions and dialogue.

A teammate who witnessed a disappearance should not behave identically on the next unverified branch.

A person who nearly died in a pit should remember pits.

A person who believes management lied should carry that distrust into later institutional conversations.

These changes should emerge in behavior rather than visible meters.

## 10.2 Absence must be real

If a recurring coworker is:

- injured,
- missing,
- dead,
- on leave,
- suspended,
- reassigned,
- or unavailable,

someone else may need to perform their job.

The workplace should continue around absence.

A missing person should create a hole in team function, dialogue, and routine.

## 10.3 Recognition is a gameplay resource

Persistent characters allow the simulation to weaponize recognition.

A familiar name, voice, habit, badge, equipment assignment, or impossible reappearance can become an event without dramatic UI.

The richer the player's history with a person, the less exposition is necessary later.

---

# 11. THE COMPLEX

The Complex is not a sequence of “levels.”

It is persistent impossible terrain.

It may present recognizable architectural categories, but those categories should not automatically become clean videogame biomes.

The player's experience should be geographic:

- routes,
- branches,
- landmarks,
- installed infrastructure,
- remembered spaces,
- uncertain boundaries,
- and locally useful maps.

## 11.1 Architecture implies function without guaranteeing function

A room can resemble:

- an office,
- kitchen,
- house,
- warehouse,
- street,
- pool,
- institutional corridor,
- industrial utility area,
- or another ordinary human environment,

while lacking the real-world systems that would make that environment function normally.

A stairway can exist without a sensible destination.

A window can exist without a valid exterior.

A light can exist without a conventional power relationship.

A door can be recognizable while its dimensions are wrong.

This is stronger than arbitrary surrealism.

## 11.2 Semantic wrongness is more important than spectacle

Many of the strongest phenomena are ordinary things with one impossible relationship.

Examples of good anomaly grammar:

- familiar object in impossible provenance,
- correct manufacturer with impossible dimensions,
- familiar room with incorrect adjacency,
- ordinary furniture embedded incorrectly,
- recognizable architecture lacking functional context,
- two observers hearing each other while occupying incompatible geometry,
- known route physically absent,
- installed infrastructure appearing where records say none exists,
- ordinary object recognized by a coworker from personal life,
- exterior-like space that does not behave like exterior space.

## 11.3 Recognition can be frightening

The Complex should not only frighten through unfamiliarity.

Sometimes it should be too familiar.

A person recognizing a chair, lamp, wallpaper pattern, portrait, manufacturer, domestic layout, or other mundane detail can create horror without any explicit hostile event.

This must be used sparingly.

It should never become a predictable “memory room” gimmick.

## 11.4 Do not over-explain the mechanism

Correspondence is not explanation.

The fact that the Complex resembles real human spaces does not license a complete metaphysical answer.

The simulation may support repeated patterns without declaring a universal mechanism to the player.

Unknowns should be allowed to remain unknown.

---

# 12. GEOGRAPHY, MAPS, AND PERSISTENCE

Persistence is not backend plumbing.

Persistence is part of the horror language.

If the player is expected to notice that something changed, the game must first be trustworthy enough to remember what existed before.

The map is not God's map.

It is **A-Sync's current institutional model of geography**.

Therefore the map may be:

- incomplete,
- delayed,
- outdated,
- disputed,
- restricted,
- or wrong.

But it must normally be useful.

If the map is constantly wrong, contradictions stop mattering.

## 12.1 Persisted geography creates occupational memory

The player should develop statements such as:

- “that's the corridor where we installed the relay,”
- “Nora marked that wall,”
- “we already surveyed this branch,”
- “that cable should turn left here,”
- “this room did not have a door yesterday.”

This is the terrain becoming a workplace.

## 12.2 Human infrastructure should persist

A-Sync occupation leaves scars:

- cables,
- markers,
- cameras,
- warning tape,
- temporary lights,
- platforms,
- railings,
- signs,
- equipment cases,
- ladders,
- barriers,
- relays,
- handwritten notes,
- repair work,
- recovered or abandoned instruments.

This infrastructure creates history.

It may itself become evidence when it appears somewhere impossible or no longer matches records.

## 12.3 The institution must persist too

Persistence is not only Complex state.

A-Sync should remember and react.

If an incident caused:

- a route restriction,
- new equipment,
- medical leave,
- a construction project,
- a revised map,
- new safety protocol,
- altered evidence access,
- a personnel reassignment,
- or a changed classification,

those consequences should exist later.

Yellow Beast therefore contains two persistent histories:

1. **what the Complex did**, and
2. **what A-Sync did in response.**

---

# 13. MISSIONS AND EXPEDITIONS

A mission is what A-Sync thinks needs to happen.

An expedition is what actually happens.

These are not the same thing.

A-Sync may assign:

- verify camera failure,
- extend survey line,
- replace relay,
- recover equipment,
- document room dimensions,
- collect a sample,
- inspect installed infrastructure,
- validate a mapped route,
- transport instrumentation,
- confirm a prior observation,
- establish a safe crossing,
- or perform routine maintenance.

The simulation may produce:

- nothing extraordinary,
- a discrepancy,
- interpersonal conflict,
- equipment failure,
- new geography,
- unexpected evidence,
- a civilian artifact,
- a communication problem,
- a personnel injury,
- a phenomenon,
- a hostile encounter,
- or a contradiction that nobody can explain.

The assignment should not secretly be an authored horror quest disguised as maintenance.

The strongest emergent stories occur when ordinary work collides with unscheduled reality.

## 13.1 Uneventful missions are valid

A mission that produces:

- complete survey,
- stable readings,
- intact personnel,
- successful equipment installation,
- no major anomaly,
- and a safe return

is not a failed content roll.

It establishes baseline, geography, competence, trust, team history, and future setup.

## 13.2 Curiosity, duty, and loyalty drive exploration

The player should not require glowing objective arrows to enter dangerous places.

Motivation can come from:

- curiosity,
- professional responsibility,
- coworker safety,
- evidence,
- a human voice,
- equipment ownership,
- map inconsistency,
- physical traces,
- or mission responsibility.

Dangerous choices should often be reasonable choices made with incomplete information.

---

# 14. STAGING, THRESHOLD, AND DEPLOYMENT RITUAL

Deployment ritual must not be collapsed into a loading screen.

The progression:

> briefing → staging → equipment → team → radio check → Threshold → field

is psychologically important.

The player needs to feel the boundary between institutional reality and the Complex.

Staging provides:

- final human normalcy,
- equipment preparation,
- team presence,
- institutional architecture,
- procedural confidence,
- and the sense of leaving safety.

The Threshold should remain meaningful even after many expeditions.

Familiarity should transform the crossing from miracle into routine without making it emotionally irrelevant.

This is one of the core occupational transformations:

> humanity builds an extraordinary machine, then eventually someone complains about carrying the tripod through it.

Yellow Beast lives in that transformation.

---

# 15. EQUIPMENT

Equipment is not loot.

Equipment is institutional capability made physical.

It should communicate:

- A-Sync's current understanding,
- trust in the player,
- historical engineering lineage,
- project maturity,
- risk tolerance,
- and practical limitations.

Higher standing may provide:

- better camera systems,
- improved radios,
- more reliable instruments,
- specialized sample handling,
- protective gear,
- better mapping tools,
- additional personnel support,
- or authority to request specialized equipment.

This should not become a conventional +15% stat ladder.

## 15.1 Equipment should have history

A-Sync should accumulate:

- old models,
- replacement parts,
- legacy connectors,
- retired equipment,
- revised procedures,
- field modifications,
- familiar malfunction patterns,
- and employees with preferences.

Technology should feel developed over time, not spawned perfectly for the player.

## 15.2 Installed equipment can create later gameplay

A camera installed today may produce evidence tomorrow.

A relay may later fail.

A route marker may later be found somewhere impossible.

A boring maintenance assignment can therefore become narratively important retroactively.

This supports offscreen continuity.

## 15.3 Weapons, if present, are authorization events

A firearm should not be a progression reward.

It should signify that A-Sync has decided the risk profile justifies issuing lethal capability.

That institutional decision should carry more meaning than raw firepower.

---

# 16. EVIDENCE

Evidence is not a collectible codex token.

Evidence is the material by which a human institution tries to turn experience into knowledge.

Evidence can include:

- photographs,
- video,
- audio,
- measurements,
- physical samples,
- recovered objects,
- equipment state,
- maps,
- logs,
- testimony,
- environmental traces,
- personnel injury,
- or absence.

## 16.1 Evidence begins before meaning

The player may recover something without knowing why it matters.

The most powerful post-expedition reveal may be:

> the ordinary object you recovered three days ago is impossible in a way nobody noticed in the field.

## 16.2 Analysis takes time

Evidence should sometimes move through institutional processing after the expedition.

Possible states include:

- received,
- queued,
- under analysis,
- preliminary result,
- reclassified,
- inconclusive,
- restricted,
- superseded,
- contaminated,
- or unavailable to the player.

This creates post-mission continuity and retroactive understanding.

## 16.3 Evidence quality matters without gamifying every action

A person can witness something without documenting it well.

The player may return with:

- testimony only,
- partial imagery,
- damaged equipment,
- corroborating teammate memory,
- a sample but no exact location,
- a measurement without context.

The event still happened.

A-Sync's confidence in the event may differ.

## 16.4 Mundane evidence can be most powerful

A wallet, receipt, equipment serial number, domestic object, manufacturer stamp, vehicle, shoe, badge, or common appliance can become extraordinary because its provenance is impossible.

Do not equate horror evidence with glowing supernatural artifacts.

---

# 17. POST-EXPEDITION INSTITUTIONAL METABOLISM

An expedition does not end when the player crosses the Threshold home.

The institution continues to consume the expedition.

After return:

- samples move to labs,
- footage is reviewed,
- maps are updated,
- personnel are interviewed,
- injuries affect staffing,
- equipment is inspected,
- reports are compared,
- management may revise access,
- sectors may be restricted,
- construction may begin,
- briefings may change,
- future missions may be generated,
- rumors may spread,
- employees may react socially,
- and official summaries may differ from the player's memory.

A-Sync's reaction should sometimes become visible before anyone explains it.

Examples:

- new cases outside staging,
- a taped-off corridor,
- unfamiliar specialists present,
- altered personnel roster,
- changed map marking,
- evidence access suspended,
- mandatory briefing,
- new safety notice,
- route physically modified.

The world should visibly metabolize important events.

---

# 18. STANDING, TRUST, AND ACCESS

Standing is the player's relationship with A-Sync.

It should not primarily be a social-number minigame.

Standing determines what the institution is willing to entrust to the player.

This may affect:

- equipment quality,
- equipment variety,
- mission sensitivity,
- evidence access,
- map access,
- personnel options,
- debrief tone,
- administrative latitude,
- interpretation of disobedience,
- and institutional patience after failure.

Low standing can legitimately restrict evidence or artifact interfaces.

This is not merely a locked menu.

It means:

> A-Sync has decided you are not entitled to this version of reality.

That is both a gameplay consequence and an institutional statement.

Standing should react to:

- mission compliance,
- leadership outcomes,
- evidence quality,
- equipment loss,
- personnel safety,
- insubordination,
- false reporting,
- justified aborts,
- successful initiative,
- and institutional politics where appropriate.

A-Sync should not always interpret the player's choices fairly.

But it should interpret them according to understandable organizational logic.

---

# 19. UI

The UI is not a retro horror skin.

The UI is A-Sync's attempt to make the impossible administrable.

The intended 1.0 direction is a professional internal 1990s-era suite with map-like and departmental interfaces.

The target is:

- professional,
- utilitarian,
- slightly dated,
- readable,
- institutional,
- reactive,
- permissioned,
- and diegetically meaningful.

Avoid:

- constant VHS static,
- decorative glitch spam,
- hacker-terminal cosplay,
- gratuitous redactions,
- spooky fonts,
- fake corruption used only for mood,
- or interfaces that appear broken merely to seem uncanny.

Most systems should work.

That is what allows a rare failure, restriction, contradiction, or altered record to matter.

## 19.1 Screens represent lenses, not objective truth

The map shows A-Sync's map.

The evidence screen shows accessible institutional evidence.

The personnel screen shows institutional personnel status.

The briefing shows the accepted operational model.

The archive shows what the player is allowed to retrieve.

The post-report screen shows institutional interpretation of the completed operation.

None of these are God's view.

## 19.2 UI should react to history

After major events:

- routes may become restricted,
- personnel statuses may change,
- evidence may become unavailable,
- terminology may change,
- mandatory messages may appear,
- map annotations may update,
- standing may affect options,
- previously stable screens may expose new institutional categories.

The interface should feel like a living administrative system around a persistent world.

---

# 20. AUDIO AND PRESENTATION

Yellow Beast should derive tension from physical and occupational sound before musical horror cues.

Important sound categories include:

- fluorescent buzz,
- ventilation,
- footwear,
- clothing and suit movement,
- equipment handling,
- distant human work,
- radio beeps,
- static,
- cable movement,
- room-specific ambience,
- mechanical systems,
- Threshold infrastructure,
- and meaningful silence.

The environment should not constantly play “scary ambience.”

A sound becomes information when the player understands the baseline.

A strange noise in a space with constant noise may be less important than sudden silence.

A teammate's voice disappearing may be more frightening than an aggressive music sting.

The approved audio directives should continue to support this philosophy, including Threshold-specific sound, radio feedback, room ambience, and restrained anomaly-specific treatment.

---

# 21. PHENOMENA AND ANOMALY DESIGN

A phenomenon should not be designed primarily as a content event.

It should be designed as a change in relationships between otherwise understandable facts.

The strongest anomalies often involve:

- familiar things in impossible places,
- legitimate observations that cannot both be true under ordinary geometry,
- ordinary materials behaving incorrectly,
- infrastructure appearing with impossible provenance,
- communication across incompatible spaces,
- map contradictions,
- incorrect adjacency,
- measurements that violate expected physical relationships,
- or architecture that is semantically recognizable but physically wrong.

## 21.1 One impossible parameter is often enough

Do not overdecorate anomalies.

A completely ordinary light fixture with one impossible dimensional relationship can be stronger than a visually spectacular magical object.

A normal room with one wrong door can be stronger than a maze of surreal geometry.

## 21.2 Unknown should remain a valid state

A-Sync should not instantly classify every event.

Possible long-term states include:

- observed once,
- unresolved,
- disputed,
- correlated but unexplained,
- provisionally classified,
- operationally understood but causally unknown.

The game does not owe the player a complete metaphysical explanation for every recurring pattern.

## 21.3 Do not translate color or aesthetics into simplistic mechanics

Recurring visual motifs such as specific colors, lighting conditions, or architectural styles should not automatically become player-readable elemental classes.

Mystery dies when every visual cue maps cleanly to a status taxonomy.

---

# 22. ENTITIES AND HOSTILE LIFE

Hostile life is part of the world, not the purpose of the world.

The Kane corpus repeatedly demonstrates that creatures dominate cultural memory far more than actual runtime.

Yellow Beast should preserve that restraint.

An expedition does not require an entity encounter to become meaningful.

Entity behavior should emerge from canonical simulation rules and legitimate sensory information.

Do not create:

- monster spawn tables merely to guarantee action,
- fixed “entity rooms,”
- predictable chase quotas,
- or game loops where every unfamiliar region implies combat.

The threat of life matters more when the player can spend many operations without direct contact.

Hostile contact should alter future institutional behavior when evidence is sufficient.

---

# 23. FAILURE, ABORT, AND CONSEQUENCE

Failure should often produce continued history rather than a reload screen.

Examples:

- wrong equipment choice,
- abandoned objective,
- insufficient evidence,
- premature return,
- justified abort,
- unjustified abort,
- lost equipment,
- damaged camera,
- missed observation,
- team separation,
- conflict with STANDARD,
- personnel injury,
- route confusion,
- incomplete reporting.

These outcomes can affect:

- standing,
- trust,
- future equipment,
- personnel relationships,
- evidence confidence,
- mission assignment,
- map certainty,
- institutional reaction,
- staffing,
- and long-term history.

The simulation should reserve hard terminal failure for outcomes that genuinely terminate play, such as player death or world retirement where constitutionally appropriate.

---

# 24. PLAYER LEADERSHIP

The player is always the field team leader.

Leadership must matter mechanically and socially.

The player may face situations where:

- STANDARD says continue,
- a teammate recommends abort,
- evidence is ambiguous,
- a route is uncertain,
- a person is missing,
- equipment is failing,
- or the assignment no longer matches field reality.

The meaningful choice is not a dialogue wheel labeled GOOD / BAD.

It is command responsibility.

The player's decision affects real simulated people with memory.

A teammate who was ignored during a dangerous mission may remember that.

A teammate whose caution saved the team may gain confidence in speaking up later.

A-Sync may reward or punish a decision differently from the people who survived it.

This creates productive tension between:

- institutional loyalty,
- professional judgment,
- team loyalty,
- curiosity,
- and self-preservation.

---

# 25. HOPE INFRASTRUCTURE

The Kane corpus repeatedly shows that practical systems are also emotional handholds.

In Yellow Beast, the following are more than mechanics:

- radio,
- cable,
- teammate voice,
- map,
- route marker,
- Threshold,
- STANDARD,
- functioning equipment,
- known geography,
- institutional procedure.

They represent connection to ordinary reality.

Because these systems normally work, their loss is inherently dramatic.

Do not sabotage them constantly.

A radio that is always creepy is not comforting enough to lose.

A map that is always unreliable cannot betray expectation.

A teammate who never develops recognizable behavior cannot become frightening through silence.

Hope must be established before it can be threatened.

---

# 26. TIME, HISTORY, AND INSTITUTIONAL ARCHAEOLOGY

A-Sync should feel older than the player's campaign.

The project has history.

That history can appear through:

- old machines,
- archived terminology,
- legacy forms,
- retired procedures,
- equipment versions,
- previous project names,
- warnings nobody currently remembers writing,
- infrastructure built by earlier teams,
- obsolete classifications,
- and employees referencing events the player did not witness.

The player should not feel like reality started when the save file was created.

The campaign is one period in a larger institution.

Similarly, the institution must continue operating when the player is elsewhere.

Other teams work.

Labs analyze.

Management decides.

Cameras record.

Construction progresses.

Personnel take leave.

The Complex remains a place rather than a stage that loads only around Jack.

---

# 27. CANON DISCIPLINE

Yellow Beast must remain Kane-derived without becoming fandom-derived.

Every important world rule should distinguish:

- **confirmed observation,**
- **strong inference,**
- **working institutional hypothesis,**
- and **unestablished speculation.**

Do not promote popular fan interpretation to canon merely because it is repeated frequently.

If a film shows a human-like sound, the safe statement may be:

> human-like vocalization observed.

It may not justify:

> all entities intentionally mimic recorded human voices.

If two objects resemble one another, similarity is not automatically identity.

If a green visual event recurs, recurrence is not automatically a complete mechanic.

If architecture resembles a real home, correspondence is not automatically proof of memory extraction.

Canon authority should remain conservative enough that later Kane material can clarify or overturn inferences without breaking the game.

---

# 28. ANTI-TRANSLATION RULES

Yellow Beast must not become Kane-event cosplay.

Do not implement features merely because they appeared memorably in a film.

Specifically avoid treating the corpus as a checklist requiring:

- a Pitfalls mission,
- a red-city biome,
- a Still Life spawn table,
- a fixed Bacteria chase,
- a Peter Tench reenactment,
- a memory-house mechanic,
- a guaranteed mysterious car,
- Null Zone random events copied literally,
- constant VHS corruption,
- a spooky archive screen,
- repetitive redactions,
- or scripted replicas of known canon expeditions.

Translate the **causal conditions** that made those moments work:

- reliable baseline,
- institutional expectation,
- persistent geography,
- human history,
- incomplete knowledge,
- task-driven dialogue,
- evidence,
- and reality contradicting a trusted model.

The simulation should create new Yellow Beast stories that feel native to Kane's world without needing to reproduce Kane's scenes.

---

# 29. IMPLEMENTATION IMPLICATIONS

This document is design authority, not a low-level architecture specification. However, several implementation consequences are unavoidable.

## 29.1 Persistence must be trustworthy

The system must be able to distinguish an intended world change from serialization failure.

If a corridor changes, the player must trust that the game remembers what it was before.

If personnel status changes, the game must not produce false anomalies through migration or missing fields.

If institutional knowledge changes, it must have traceable cause.

This validates the current focus on persistence, verification, save/reload equivalence, migration safety, read purity, and structural validation before feature expansion.

## 29.2 Provenance matters

Important state should preserve where knowledge came from where practical:

- observation,
- testimony,
- sensor,
- evidence item,
- lab report,
- institutional decision,
- prior map revision,
- personnel record.

The game should be able to answer not only “what does A-Sync believe?” but “why does A-Sync believe it?” where the design requires that distinction.

## 29.3 NPC state cannot be cosmetic

Personnel memory, status, availability, role, relationship, and operational tendency must influence future behavior.

If an NPC remembers an event only in prose but behaves identically, the system has not actually modeled continuity.

## 29.4 Mission generation needs institutional cause

Every mission should be explainable by current institutional intent and accepted knowledge.

A mission that exists only because “the player needs content” violates the model.

## 29.5 Phenomena need baseline and observability

A phenomenon should define:

- what world truth changes,
- who can observe it,
- what instruments can record,
- what evidence can survive,
- what A-Sync can legitimately infer,
- and what future consequences may follow.

## 29.6 UI must consume state, not invent it

The interface should reflect maps, personnel records, standing, evidence access, and institutional knowledge.

It should not manufacture dramatic contradictions unsupported by simulation state.

---

# 30. RECONSTRUCTION PRIORITIES

This section describes conceptual priority, not permission to violate the August 13 development campaign sequence.

When reconstructing post-reconciliation, protect the following dependency order in spirit:

## Foundation

- deterministic world truth,
- save/reload integrity,
- personnel state integrity,
- evidence state integrity,
- institutional knowledge integrity,
- observer-safe presentation boundaries,
- verification that cannot false-green known failures.

## Governance

- authority separation,
- who can change state,
- who can know state,
- STANDARD information boundaries,
- LOCAL information boundaries,
- player speech authority,
- institutional state transitions.

## Persistent occupational world

- stable geography,
- installed infrastructure,
- personnel continuity,
- mission-to-consequence memory,
- institution reacting over time.

## Core expedition behavior

- briefing,
- staging,
- threshold ritual,
- route following,
- field leadership,
- equipment interaction,
- evidence collection,
- return/abort,
- debrief.

## Knowledge metabolism

- analysis,
- institutional updates,
- maps,
- evidence access,
- standing,
- future mission generation.

## Expressive maturity

- natural dialogue,
- deeper NPC behavioral continuity,
- richer phenomenon ecology,
- audiovisual nuance,
- reactive professional UI,
- offscreen institutional activity,
- campaign-scale emergent history.

The approved UI target should be implemented when the foundation and player-facing stage are ready to support it, not prematurely during sensitive persistence repair.

---

# 31. ACCEPTANCE TESTS FOR EVERY FUTURE FEATURE

A feature should not be accepted merely because it functions.

Ask:

## 31.1 Institutional cause

Why does this system, mission, screen, or interaction exist in A-Sync?

If the answer is only “because games have this,” reject or redesign it.

## 31.2 Reality authority

What system determines the underlying truth?

If generated prose or UI can create reality, reject it.

## 31.3 Knowledge legitimacy

Who knows this information, and how did they learn it?

If everyone knows everything automatically, reject it.

## 31.4 Persistence

Will yesterday matter tomorrow?

If the system creates meaningful state that disappears after a scene, investigate whether that is intentional.

## 31.5 Baseline

What normal state does this feature establish or rely on?

If an anomaly has no trusted baseline to violate, its effect will be weaker.

## 31.6 Human consequence

How does this affect personnel, relationships, staffing, trust, or institutional response?

If major events leave humans unchanged, the world is not alive enough.

## 31.7 Dialogue purpose

Why is this person speaking now?

If the line exists mainly to explain lore to the player, rewrite it.

## 31.8 UI truth

Is the interface showing institutional knowledge or omniscient game state?

If it leaks God's view without explicit justification, reject it.

## 31.9 Kane compatibility

Does the feature preserve the causal grammar of Kane's world without copying a recognizable scene for its own sake?

If it feels like fandom reenactment, redesign it.

## 31.10 Work-before-horror

Does the surrounding experience feel like a real operation before it asks the player to experience fear?

If not, the feature is probably too eager.

---

# 32. RED-FLAG FAILURE PATTERNS

The following are strong indicators Yellow Beast is drifting away from its target:

- NPCs constantly narrate atmosphere.
- Every expedition contains a major anomaly.
- STANDARD knows what the player sees without telemetry.
- Maps function as omniscient minimaps.
- Entities exist mainly to create action beats.
- Dialogue is uniformly eloquent.
- Coworkers forget prior missions.
- Player dialogue is invented.
- Mission failures disappear after debrief.
- Personnel injury does not alter staffing.
- Evidence becomes an instant codex unlock.
- All scientific analysis immediately produces true explanations.
- A-Sync behaves like a unified evil mind.
- UI glitches constantly for atmosphere.
- Standing is only a number and does not affect trust/access.
- Equipment is conventional RPG power progression.
- Architecture is organized into explicit fandom-like levels.
- Phenomena are explained through clean elemental categories.
- The Complex changes arbitrarily because procedural generation forgot state.
- A scary event occurs without any prior baseline that makes it meaningfully strange.
- The player is treated as metaphysical center of all offscreen activity.
- Every discovery exists because the player was scheduled to discover it.

Any cluster of these patterns should trigger design review before horizontal expansion continues.

---

# 33. WHAT “REACTIVE” ACTUALLY MEANS

Reactive Yellow Beast does not mean every action produces flashy feedback.

It means the world absorbs causality.

Examples:

- A mission failure changes future trust.
- An injured coworker is absent later.
- A discovered hazard changes route authorization.
- Installed infrastructure remains installed.
- A recovered sample produces a lab result later.
- A disputed report causes internal tension.
- A team loss changes survivor behavior.
- A major anomaly changes briefing language.
- Ignoring assignments may restrict evidence access.
- A-Sync construction changes a previously dangerous location.
- An official report may sanitize an event the player remembers differently.
- A new classification appears only after enough evidence exists.

Reactivity is persistent consequence, not particle effects.

---

# 34. WHAT “ALIVE” ACTUALLY MEANS

A living world does not require constant autonomous spectacle.

Yellow Beast feels alive when:

- people remember,
- people are absent for reasons,
- other departments act,
- evidence continues moving,
- equipment persists,
- routes retain history,
- institutional decisions appear later,
- teammates develop habits,
- the Complex remains geographically meaningful,
- offscreen sensors can capture events,
- and the player can encounter consequences they did not personally create.

Life is continuity plus causality.

---

# 35. WHAT “KANE-LIKE” ACTUALLY MEANS

Do not use “Kane-like” as shorthand in implementation prompts without translating it into operational criteria.

The term should mean some combination of:

- mundane professional context,
- human-scale behavior,
- information arriving through a specific medium,
- no omniscient narrator,
- incomplete interpretation,
- restrained explanation,
- ordinary architecture used without normal context,
- procedure preceding failure,
- credible institutional behavior,
- long stretches where nothing spectacular happens,
- concise dialogue driven by task and shared context,
- anomaly emerging as contradiction rather than decoration,
- and consequences that become institutional history.

If a developer cannot say which of those principles they are implementing, “make it more Kane” is not a valid task specification.

---

# 36. THE YELLOW BEAST EXPERIENCE AT MATURITY

A mature Yellow Beast session should allow experiences like the following without requiring a hand-authored cinematic script:

The player receives a routine maintenance assignment.

The team stages with familiar coworkers.

Someone complains about a piece of equipment they have used before.

The team crosses the Threshold and follows an established route.

Nothing unusual happens for a long time.

A previously installed camera is found facing the wrong direction.

There are no obvious footprints or signs of physical movement.

The camera's event buffer shows normal team traffic followed by an unexplained transition.

STANDARD instructs recovery and continuation because current institutional records contain no confirmed hazard.

One teammate wants to abort.

Another thinks the assignment can still be completed.

The player decides.

Whatever happens next changes:

- personnel memory,
- evidence,
- institutional belief,
- standing,
- route status,
- and tomorrow's work.

No monster is required.

No scripted scare is required.

The game becomes frightening because all involved systems agree that something which should be ordinary is not.

This is the Yellow Beast target.

---

# 37. THE DEEPEST PRODUCT INSIGHT

Yellow Beast is not a pile of systems.

Persistence, personnel, dialogue, assignments, evidence, standing, UI, STANDARD, geography, equipment, phenomena, and post-mission consequences are different organs of the same simulation.

Their common function is:

> **model the changing relationship between an institution, its employees, and a reality that is only partially legible.**

A mission exists because A-Sync believes something.

Dialogue happens because a human needs another human to know or do something.

Evidence exists because perception is incomplete.

The map exists because A-Sync attempts to remember geography.

Persistence exists because yesterday must matter.

Standing exists because institutions distribute trust.

Equipment exists because trust and knowledge become physical capability.

UI exists because institutions turn reality into administrable information.

NPC memory exists because organizations are made of human beings.

Phenomena matter because they disrupt relationships the player has learned to trust.

When those systems are implemented independently without this relationship, Yellow Beast becomes generic.

When they are implemented as one causal organism, the intended experience emerges naturally.

---

# 38. COMPACT CONSTITUTIONAL SUMMARY

If every other Yellow Beast design note vanished, reconstruct from these statements:

1. **The game must feel like work before it feels like horror.**
2. **Reality is resolved by simulation before it is described by prose.**
3. **The Complex is persistent terrain, not an encounter playlist.**
4. **A-Sync acts from a useful but incomplete institutional model.**
5. **A-Sync's model generates missions; actual reality determines expeditions.**
6. **No observer, sensor, department, or interface is automatically omniscient.**
7. **Sensors report observables, not meanings.**
8. **Evidence is not knowledge until it is interpreted.**
9. **Institutional conclusions can be provisional, stale, disputed, wrong, or restricted.**
10. **Whatever A-Sync concludes should affect future procedure, maps, staffing, access, infrastructure, and missions.**
11. **NPCs require persistent history because recognition, trust, absence, and changed behavior are gameplay.**
12. **Dialogue follows immediate need, knowledge, relationship, role, shared context, and stress.**
13. **Silence is valid. The player never speaks without player input.**
14. **Equipment is institutional capability, not loot progression.**
15. **Maps show A-Sync's understanding, not objective reality.**
16. **UI is administrative infrastructure for the impossible, not spooky decoration.**
17. **Standing represents institutional trust and therefore changes capability and access.**
18. **Routine missions and uneventful expeditions are necessary baseline-building content.**
19. **Ordinary objects with one impossible relationship are often stronger than spectacular anomalies.**
20. **Recognition can be horror.**
21. **A-Sync infrastructure represents local control, never mastery.**
22. **Post-expedition institutional metabolism is part of the expedition.**
23. **Failure should usually create history rather than erase it.**
24. **The institution and Complex continue existing when Jack is elsewhere.**
25. **Never copy Kane events merely because they are memorable; reproduce the causal grammar that made them believable.**
26. **Canon, inference, hypothesis, and speculation must remain distinct.**
27. **The player is a field leader responsible for real persistent people.**
28. **Hope lives in radios, routes, coworkers, maps, procedure, equipment, and the Threshold. Do not cheapen those systems through constant failure.**
29. **If a system does not connect causally to the rest of Yellow Beast, it is probably not finished.**
30. **If an expedition does not feel like work before it feels like horror, something is wrong.**

---

# 39. FINAL RECONSTRUCTION MANDATE

Do not rebuild Yellow Beast by asking:

> What feature comes next?

Ask:

> What truthful relationship must the simulation be capable of supporting next?

Then make one falsifiable claim at a time.

Verify it.

Preserve it.

Only then add the next relationship.

The player-facing masterpiece comes from accumulated trustworthy systems, not from a large quantity of authored spectacle.

Yellow Beast succeeds when the player develops a life inside A-Sync's attempt to domesticate the impossible, learns the procedures well enough to trust them, cares about the people standing beside them, understands the route well enough to remember it, and then notices one small thing that should not be possible.

The simulation must be trustworthy enough that the player does not ask:

> Is this a bug?

They ask:

> **Was that like that yesterday?**

That question is the reconstruction target.
