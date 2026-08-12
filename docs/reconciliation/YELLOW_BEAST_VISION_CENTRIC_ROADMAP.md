# YELLOW BEAST 1.0 — VISION-CENTRIC DEVELOPMENT ROADMAP

**Authority status:** Ratified product-direction and phase-level planning history. It is not the current pass sequence. `docs/YELLOW_BEAST_VISION_PASS_MAP.md` supersedes this document for implementation order and scope; `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md` governs the player promise.

## Operating Principle

From this point forward, passes exist because the playable experience requires them.

The game does not exist to complete the passes.

The campaign begins by reconciling repository reality, the Gameplay Constitution, existing doctrine, audits, implementation history, UI/audio authorities, canon authorities, and current tests into one authoritative baseline. Implementation follows player-experience dependencies rather than historical pass numbering.

The core operating cycle is:

**AUDIT → CHALLENGE → RECONCILE → HUMAN RATIFY → IMPLEMENT → HUMAN PLAYTEST**

Each phase ends in a human-playable checkpoint.

---

# PHASE 0 — VISION RECONCILIATION

## Goal

Make the repository understand what game it is building.

No feature implementation occurs during this phase.

Reconcile:

- current repository reality;
- SIMULATION_DOCTRINE.md;
- AGENTS.md and current repository instructions;
- original Yellow Beast 1.0 design material;
- prior implementation roadmaps;
- both major audits and surviving audit artifacts;
- the current Gameplay Constitution / Player Promise;
- current UI and audio authorities;
- Kane / ASYNC world authorities;
- completed-pass claims versus actual implementation;
- automated tests;
- native Electron tests;
- human-test complaints and regressions;
- deterministic persistence status;
- known recovery work.

Produce an evidence-backed Vision Reconciliation Ledger.

Every meaningful requirement should map to:

**VISION REQUIREMENT → CURRENT SUPPORT → EVIDENCE → GAP → SEVERITY → DEPENDENCIES → RECOMMENDED WORK**

Classify existing systems as:

- KEEP
- REPAIR
- EXTEND
- REPLACE
- OBSOLETE
- NOT IMPLEMENTED

Historical pass numbering is context, not authority.

## Checkpoint 0 — Ratified Baseline

Do not proceed until repository truth is known.

No implementation work should depend on remembered pass claims.

---

# PHASE 1 — BUILD THE COCKPIT

## Goal

Build the actual interface through which the player experiences Yellow Beast before investing further in simulation depth.

### 1A — UI Specification

Human-led design work.

Define the expedition cockpit, including:

- procedural map;
- interpreter / perception panel;
- ACTION input;
- LOCAL / STANDARD communications;
- team display;
- inventory / loadout;
- evidence;
- expedition clock;
- outside / Complex temporal information;
- pause state;
- signal states;
- alerts;
- expansion / collapse behavior;
- keyboard interactions;
- information hierarchy;
- failure and degraded states.

Visual design authority comes from human sketches, reference material, existing UI authorities, and explicit behavior specifications.

Implementation agents do not receive redesign authority.

### 1B — Functional Cockpit Shell

Implement the cockpit using synthetic or fixture state where necessary.

Prove:

- layout;
- resizing;
- scrolling;
- keyboard control;
- ACTION submission;
- channel switching;
- map interaction;
- message flow;
- information density;
- settings;
- accessibility;
- long-session readability.

### 1C — ASYNC Facility Shell

Build the spatially represented clickable institutional grammar.

Potential areas include:

- Personnel;
- Briefing;
- Staging;
- Documents;
- Biopsy;
- Threshold;
- other appropriate departments.

Deep simulation is not required yet.

The goal is to stop ASYNC from feeling like disconnected menus.

## Checkpoint 1 — The Cockpit

Boot Yellow Beast using synthetic expedition state.

Ask:

**If all backend simulation were already working, would this interface be comfortable and compelling for fifty hours of play?**

If no, fix it now.

---

# PHASE 2 — THE LIVING TURN

## Goal

Implement the actual gameplay heartbeat:

**perception → world continues → communications / equipment / evidence → ACTION → Custodian resolution → updated perception**

Yellow Beast is not conventionally turn-based.

### 2A — Simulation Clock

Separate:

- real calendar time;
- ASYNC institutional time;
- Complex elapsed time;
- player ACTION resolution.

The world clock does not wait for the player.

The ACTION resolver does.

### 2B — ACTION Intent

Natural-language player actions become attempts.

Interpreter extraction should identify appropriate information such as:

- actor;
- intended action;
- target;
- method;
- relevant qualifiers.

Custodian determines feasibility and result.

Player wording never grants success.

### 2C — Concurrent NPC Intents

LOCAL requests to coworkers create NPC intents rather than player-controlled actions.

Example:

> “Nora, photograph that.”

creates an autonomous Nora intent.

Nora may:

- comply;
- refuse;
- hesitate;
- misunderstand;
- delay;
- partially comply;
- do something else.

NPC activity can overlap player activity.

### 2D — Pause / Idle / Autonomy

Provide explicit pause/resume behavior.

When simulation is running and the player is sufficiently idle, the player character may perform safe mundane autonomous behaviors.

Direct user input immediately restores player control.

Idle autonomy must not make major irreversible choices on the player's behalf.

### 2E — Perception

Interpreter output:

- uses second person;
- remains grounded in player perspective;
- does not invent player thoughts or emotions;
- provides strong spatial grounding;
- reveals only reasonably perceptible information.

## Checkpoint 2 — The Room Test

Place the player and multiple coworkers in one sufficiently complicated environment.

Spend substantial time attempting ordinary, ambiguous, strange, concurrent, impossible, and idle behavior.

Test:

- throwing objects;
- moving furniture;
- asking coworkers to act while the player acts;
- LOCAL;
- STANDARD;
- dropping equipment;
- impossible actions;
- ambiguous actions;
- doing nothing.

The room should feel like people occupying a place.

---

# PHASE 3 — PEOPLE, NOT NPCS

## Goal

Make expedition personnel persistent people rather than interchangeable dialogue generators.

### Hidden Personnel Model

Support hidden traits such as:

- competencies;
- authority;
- personality;
- memory;
- relationships;
- knowledge;
- fears;
- preferences;
- career state;
- emotional state.

These are never exposed as conventional RPG statistics.

### Player Character Creation

Support:

- first name;
- last name;
- male or female;
- height;
- weight;
- prose work-history description.

The prose work history is silently translated into hidden competencies.

### Relationship Memory

Personnel remember meaningful experiences:

- what happened;
- what they witnessed;
- what they were told;
- who did what;
- how the player treated them;
- previous expeditions;
- institutional events.

Friendship, distrust, respect, resentment, and attachment emerge behaviorally.

### Authority

Expedition leadership matters.

Human control of the player character does not grant command authority.

### Personnel Careers

NPCs may:

- improve;
- fail;
- be evaluated;
- receive promotion;
- change assignment;
- request things;
- refuse things;
- become injured;
- disappear;
- die;
- leave ASYNC.

## Checkpoint 3 — Do I Care About Nora?

Run repeated expeditions with recurring personnel.

Acceptance question:

**Would the player actually care if this person failed to return?**

If the answer is no, personnel simulation is not yet adequate.

---

# PHASE 4 — ASYNC IS A PLACE

## Goal

Turn bureaucracy, institutional knowledge, progression, and facility life into gameplay.

### Assignment Engine

Begin with mission grammars / templates driven by actual world state.

Possible assignment families:

- survey;
- map;
- document;
- verify;
- retrieve;
- investigate;
- re-establish contact;
- escort;
- sample;
- recover.

Custodian selects objectives based on institutional needs.

Over time, mission generation may become more generative, but institutional causality must remain intact.

### Evidence System

Implement the pipeline:

**observation → verbal report → requested corroboration → evidence collection → return / loss → institutional record → confidence → future consequences**

Evidence may include:

- photographs;
- recordings;
- measurements;
- samples;
- witnesses;
- physical objects;
- video.

### Knowledge Provenance

ASYNC distinguishes confidence states such as:

- known;
- supported;
- probable;
- speculative;
- disputed;
- unknown.

ASYNC is not omniscient.

### Performance Evaluation

Each expedition produces an ASYNC-style evaluation.

Avoid visible conventional XP.

Career progression exists beneath the surface and is experienced through bureaucracy.

### Equipment Approval

Past performance and standing influence additional equipment requests.

Higher standing may eventually support privileges such as personnel requests.

### Facility Life

Departments possess state.

Rooms may occasionally be unavailable.

Personnel and institutional activity continue without direct player involvement.

Documents accumulate.

## Checkpoint 4 — The Internship

Play multiple shifts where nothing supernatural is required to occur.

Working for ASYNC itself should remain engaging.

---

# PHASE 5 — MAKE THE COMPLEX HORRIBLY ALIVE

## Goal

Connect procedural geography, phenomena, unreliable reality, and Kane-canon constraints to the completed gameplay loop.

### Geography 2.0

Reconcile existing deterministic procedural geography with:

- modular topology;
- persistent discovery;
- player maps;
- ASYNC maps;
- geographic mutation;
- conflicting surveys;
- missing and new connections;
- traversal compression;
- travel time;
- route knowledge.

### Kane Negative-Space Generation

Generate freely only where canon leaves room.

Never overwrite established Kane Parsons facts.

Never casually explain unresolved canonical mysteries.

Never degrade the world into generic community Backrooms lore.

### Environmental Phenomena

Use restrained occurrence scheduling.

**Nothing happens** must always remain a valid outcome.

Do not schedule horror merely because the player has gone too long without spectacle.

### Still Life

Implement a broad variable phenomenon family rather than a standard enemy archetype.

Possible manifestations may:

- appear almost human;
- remain motionless;
- breathe;
- scream;
- show fear;
- flee;
- attack;
- move rapidly;
- become partially embedded in architecture;
- interact with environmental features;
- react inconsistently to stimuli.

Player-facing text does not automatically name the canonical phenomenon.

### Bacteria

Implement separately.

Potential encounter characteristics include:

- humanoid / stick-like form;
- red and dark flesh-like appearance;
- vocal mimicry;
- repeated phrases without natural tonal change;
- extreme movement;
- scratching;
- screeching;
- pursuit;
- encounters where the entity is never visually observed.

### Perceptual Contradiction

Separate:

- hidden simulation state;
- character perception;
- institutional records;
- evidence;
- map belief.

The Complex may contradict human observation without Custodian becoming incoherent.

## Checkpoint 5 — The Couch

Recreate an ordinary successful expedition:

- player and two coworkers enter;
- assigned layout documentation in a recently discovered branch;
- team reaches a gymnasium-sized room containing one couch;
- everyone blinks;
- the couch has moved;
- STANDARD is informed;
- documentation is requested;
- the event does not repeat;
- strange sounds remain outside assignment scope;
- everyone returns safely.

If this is compelling, Yellow Beast's core experience is working.

---

# PHASE 6 — PERSISTENCE BECOMES HISTORY

## Goal

Make the persistent world produce recognizable history across sessions, careers, and offline time.

### Deterministic Save / Reload

Deterministic persistence failures receive zero tolerance.

A restored world must preserve canonical state correctly.

Tests may not be weakened to hide persistence defects.

### Save Boundaries

Inside ASYNC facilities:

- manual saving is allowed.

Before Complex entry:

- save.

During Complex expedition:

- no save.

After return:

- save.

Death may offer a pre-expedition reload as a metagame convenience outside simulation canon.

### Calendar

New worlds begin in 1991.

Outside the Complex, world chronology advances with real elapsed time.

Complex time remains separate and potentially nonlinear.

### Offline Simulation

While the player is absent:

- expeditions may occur;
- institutional knowledge may change;
- personnel may change roles;
- personnel may disappear or die;
- management may change;
- funding may change;
- ASYNC may evolve.

Offline simulation generates history and consequences.

It must not simply complete all interesting gameplay for the absent player.

### Missing Personnel

Missing is not dead.

Persist missing people inside the Complex.

Future outcomes may include:

- living discovery;
- extreme aging;
- corpse;
- skeleton with identifying material;
- remains affected by Hay Bacillus;
- other canon-compatible states.

### Multi-Career Worlds

Player death does not necessarily end the world.

A successor employee may begin a new career inside the same institutional history.

A previous player character may potentially remain discoverable inside the Complex.

## Checkpoint 6 — Leave It Alone

Save and quit.

Return after real elapsed time.

The world should have changed.

It should nevertheless remain recognizably the same unique world.

---

# PHASE 7 — PRESENTATION, HORROR, AND THE FIRST DAY

## Goal

Integrate final onboarding, audiovisual presentation, death presentation, and tone after underlying gameplay is functional.

### Onboarding

Implement:

**identity → ASYNC letter → liability disclaimer → Promotional Video projector → briefing → staging → equipment requests → personnel files → Threshold room → KV31 → Outpost → steel door closure → full cockpit reveal**

Use authentic supplied assets where available.

Do not generate substitutes for materials the project already possesses.

### Audio

Integrate existing audio authority appropriately, including:

- Threshold behavior;
- post-crossing ambience;
- radio beep;
- quiet noclip crossing cue;
- green crackle;
- red-city wobble;
- camera sounds;
- situational movement;
- restrained easter eggs.

### Death Presentation

No conventional death message.

The expedition UI shuts down like a 1990s CRT.

The player receives no immediate explanatory prose.

ASYNC's falsified public account of the employee's death follows.

Then metagame options are presented.

### Tone

Humor is restrained, dry, institutional, and immersive.

The world rarely announces jokes.

Comedy arises naturally when bureaucracy responds seriously to absurd circumstances.

## Checkpoint 7 — First Career

Start from a fresh world with no developer shortcuts.

Create an employee.

Complete onboarding.

Work assignments.

Enter the Complex.

Return.

Build relationships.

Experience institutional progression.

Eventually experience major failure or death.

Judge the experience as a complete game rather than as isolated systems.

---

# PHASE 8 — RELEASE ENGINEERING

## Goal

Turn the complete experience into a dependable distributable product.

Verify:

- clean Windows installation;
- first launch;
- offline deterministic mode;
- optional provider / AI mode;
- save migration;
- corrupted-save behavior;
- crash recovery;
- accessibility;
- settings;
- performance;
- long-session stability;
- packaging;
- tester report export;
- worldpack / runtime isolation;
- licensing and asset handling;
- documentation;
- fresh-machine installation;
- replayability;
- seeded reproducibility where appropriate;
- automated regression;
- native Electron interaction;
- torture testing.

Worldpack productization and distribution work belongs here or wherever dependency evidence places it, not merely where old pass numbering placed it.

### External Testing

Give the build to people who have not read the project's doctrine.

Do not explain the interface before they use it.

Observe where they become confused.

## Checkpoint 8 — Stranger Test

A new player should be able to:

- understand they are an ASYNC employee;
- understand what they can attempt;
- complete onboarding;
- communicate;
- act;
- explore;
- understand an assignment;
- return;
- understand that the world persisted.

If the developer must stand behind them explaining the design, the UI has failed.

---

# FINAL GATE — YELLOW BEAST 1.0

Release is not determined by historical pass completion.

The final question is:

**Does the game fulfill the Player Promise?**

The release gate should answer YES to all of the following:

1. Can the player attempt meaningful things developers never specifically scripted?
2. Can another simulated person meaningfully surprise the player without the game cheating?
3. Can the player discover something that permanently changes what ASYNC knows?
4. Can an uneventful expedition still feel worthwhile?
5. Can the player return after a long career and recognize a history unique to that world?

Five yeses are required.

Then ship.

---

# DEVELOPMENT OPERATING METHOD

Do not use one enormous forever-context Codex conversation for the campaign.

Each implementation unit receives a focused Pass Packet:

**Goal → Player Experience → Authorities → Current Relevant Files → Allowed Scope → Forbidden Regressions → Acceptance Tests → Human Gate**

After every checkpoint, produce a compact State of Yellow Beast handoff containing:

- repository truth;
- current capabilities;
- known defects;
- deferred work;
- current checkpoint status;
- next approved target.

Use focused context rather than dumping the entire project's archaeological history into every agent session.

Fresh-context independent review should be used where the risk justifies it.

Human ownership remains responsible for:

- architecture;
- scope;
- truth;
- visual taste;
- canon judgment;
- player-experience acceptance;
- checkpoint approval.

AI agents may implement and analyze the vision.

They do not redefine it.

---

# CAMPAIGN MANTRA

**The player can imagine anything. Custodian decides what they can actually get away with.**

**The target is the dream, not the demo.**
