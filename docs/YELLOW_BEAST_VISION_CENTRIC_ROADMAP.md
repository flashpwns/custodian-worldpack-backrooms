# Yellow Beast: Road to 1.0, Rebased

I would structure the new campaign into **eight phases**, each ending in a human-playable checkpoint.

And importantly, **Checkpoint means you and I stop, boot the damn game, and judge whether it feels right before proceeding.**

## Phase 0: Vision Reconciliation

**Goal:** make the repository understand what game it is building.

No features.

We conduct a fresh read-only audit against:

- current repository reality
- `SIMULATION_DOCTRINE.md`
- current AGENTS/instructions
- original 1.0 design material
- both game/readiness audits
- the Gameplay Constitution / Player Promise we just established
- existing UI/audio authorities
- Kane/ASYNC world authorities
- completed-pass claims versus actual implementation
- current automated/native tests
- the RA-01B deterministic persistence issue if it remains unresolved
- known human-test complaints
- all remaining roadmap material

Output becomes a **Vision Reconciliation Ledger**.

Every important requirement receives something like:

`VISION REQUIREMENT → CURRENT SUPPORT → EVIDENCE → GAP → SEVERITY → DEPENDENCIES → RECOMMENDED WORK`

And we classify existing systems:

**KEEP / REPAIR / EXTEND / REPLACE / OBSOLETE / NOT IMPLEMENTED**

This is also where Prompt 18 through Prompt 21 officially stop being authoritative.

### Checkpoint 0: Ratified Baseline

We do not proceed until we know exactly what exists.

No more building on remembered pass numbers.

---

# Phase 1: Build the Cockpit

This is where our previous roadmap was backwards.

Before adding more simulation depth, **we need the actual interface through which the player experiences that simulation.**

### 1A. UI specification

This is **our work**, not Codex's imagination.

You sketch the expedition cockpit.

We define:

- map
- interpreter/perception panel
- ACTION input
- LOCAL/STANDARD communications
- team display
- inventory/loadout
- evidence
- expedition clock
- outside/Complex temporal indicators
- pause state
- signal states
- alerts
- expansion/collapse behavior
- keyboard interactions
- information hierarchy

And all meaningful states.

We turn that into a proper UI behavior authority.

### 1B. Functional shell

Codex implements the UI **without redesign authority**.

Initially it can use synthetic state.

We prove:

- layout
- resizing
- scrolling
- keyboard control
- ACTION submission
- channel switching
- map interaction
- message flow
- information density
- accessibility
- settings
- readable long sessions

### 1C. ASYNC facility shell

Build the spatial clickable facility grammar:

**Personnel / Briefing / Staging / Documents / Biopsy / Threshold / other appropriate departments**

Not everything needs deep simulation yet.

But navigating ASYNC must stop feeling like unrelated menus.

### Checkpoint 1: **The Cockpit**

You boot Yellow Beast and navigate fake/sample expedition data.

We ask:

> **If all the backend magic were already working, would I want to play the game through this interface for fifty hours?**

If no, **we fix it now.**

Not after another 500 tests.

---

# Phase 2: The Living Turn

This is probably the single most important engineering phase.

We implement the actual gameplay heartbeat we discovered today:

**perception → world continues → communication/inventory/evidence → ACTION → Custodian resolves → perception**

### 2A. Simulation clock

Separate:

- real calendar time
- ASYNC institutional time
- Complex elapsed time
- player ACTION resolution

No more accidental assumption that "turn" means "world frozen."

### 2B. ACTION intent

Natural-language player actions become **attempts**.

The interpreter extracts:

- actor
- intended action
- target
- method
- relevant qualifiers

Custodian decides feasibility and result.

The language model **never grants success merely because the player wrote it.**

### 2C. Concurrent NPC intents

Solve the LOCAL issue formally.

> “Nora, photograph that.”

creates an NPC intent.

It does not become the player's ACTION.

Nora may respond, refuse, delay, misunderstand, comply, or do something else.

Her activity proceeds concurrently.

### 2D. Pause/idle/autonomy

Spacebar pause/resume.

Player inactivity gradually allows their character to perform safe mundane autonomous behavior.

Mouse/input restores direct control.

Idle autonomy never makes enormous irreversible choices on the player's behalf.

### 2E. Perception

Second person.

Player perspective.

No authored emotions.

Extremely strong spatial grounding.

Only perceptible information.

### Checkpoint 2: **The Room Test**

Forget expeditions.

Put Jack, Nora and Bennett in **one sufficiently complicated test environment**.

Spend thirty minutes doing stupid things.

Throw a glove.

Move furniture.

Ask Nora to inspect something while you walk elsewhere.

Stand idle.

Talk over LOCAL.

Call STANDARD.

Drop equipment.

Try impossible actions.

Try ambiguous actions.

Try nothing.

If this one room doesn't feel like **people occupying a place**, we don't proceed.

---

# Phase 3: People, Not NPCs

Now we make the coworkers worthy of the simulation.

### Hidden personnel model

Competencies, authority, personality, memory, relationships, knowledge, fears, preferences, career state.

**None displayed as RPG statistics.**

Player creation gains:

name, sex, height, weight, work-history prose.

That prose silently generates hidden competencies.

### Relationship memory

Personnel remember:

- what happened
- who did what
- what they witnessed
- what they were told
- how the player treated them
- previous expeditions
- institutional events

Friendship, distrust, resentment and respect emerge behaviorally.

### Authority

Expedition leadership actually matters.

You cannot puppet somebody because they're displayed in your team panel.

### Careers

NPCs can:

- improve
- fail
- be evaluated
- receive promotion
- change assignment
- request things
- refuse things
- become injured
- disappear
- die
- leave ASYNC

### Checkpoint 3: **Do I Care About Nora?**

Run repeated synthetic expeditions with the same team.

If Nora still feels interchangeable with `NPC_004`, this phase fails.

The acceptance criterion is almost offensively human:

> **Would Jack actually give a shit if this person didn't come home?**

---

# Phase 4: ASYNC Is a Place

Now bureaucracy becomes gameplay.

### Assignment engine

We start conservatively.

Don't ask an LLM to hallucinate entire missions ex nihilo.

Build **mission grammars/templates backed by world state**:

- survey
- map
- document
- verify
- retrieve
- investigate
- re-establish contact
- escort
- sample
- recover

Custodian selects objectives based upon **actual institutional needs**.

Later those grammars can become increasingly generative.

### Evidence system

This becomes a major simulation pipeline:

**observation → report → requested corroboration → evidence collection → return/loss → institutional record → confidence → future consequences**

Evidence types can include photos, recordings, samples, measurements, witnesses and physical objects.

### Knowledge provenance

ASYNC distinguishes:

**known / supported / probable / speculative / disputed / unknown**

No omniscience.

### Performance evaluation

After expeditions, ASYNC generates institutional reports.

Not:

> +400 XP

but:

> Personnel completed assigned survey without material deviation. Documentation quality acceptable.

Career standing exists underneath.

The player experiences it through treatment.

### Equipment approval

Past performance affects requests.

Higher standing eventually permits personnel requests and other privileges.

### Facility life

Rooms can be unavailable.

Departments have state.

People are doing things that don't involve you.

Documents accumulate.

### Checkpoint 4: **The Internship**

Play several shifts where absolutely nothing supernatural needs to happen.

If **working at ASYNC itself** isn't interesting, we're missing half the game.

---

# Phase 5: Make the Complex Horribly Alive

Only **now** would I unleash the really expensive procedural/anomalous systems.

Because now they have gameplay to affect.

### Geography 2.0

Preserve the deterministic procedural work we've already earned, but reconcile it with:

- modular room topology
- persistent discovery
- player maps
- ASYNC maps
- geographic mutation
- conflicting surveys
- missing/new connections
- traversal compression
- travel time
- route knowledge

### Kane-negative-space generation

Every generated environment passes the rule:

> **Invent within what Kane has not established. Never overwrite what Kane has.**

No Wiki Backrooms soup.

### Environmental phenomena

We need a restrained occurrence scheduler.

Critically:

**NOTHING** must be a valid result.

The simulation cannot constantly roll:

`spooky_event = true`

because the player hasn't screamed recently.

### Still Life

Variable phenomenon family.

No MMO enemy template.

No automatic player-facing canonical name.

Potential behavior remains broad and disturbing.

### Bacteria

Distinct simulation model.

Mimicry.

Sound.

Distance.

Pursuit.

Potentially never seen.

### Perceptual contradiction

Separate:

- underlying simulation state
- character perception
- institutional records
- evidence
- map belief

This permits the Complex to be **wrong without Custodian becoming incoherent**.

### Checkpoint 5: **The Couch**

Recreate your ordinary example.

Monroe, Bennett and Steven.

Survey Ottawa / Room 14A.

Huge room.

One couch.

Everyone blinks.

Couch moved.

Report it.

Record it.

Nothing else happens.

Strange noises remain somewhere beyond assignment scope.

Everybody comes home.

If that expedition is genuinely compelling, **we've got Yellow Beast.**

---

# Phase 6: Persistence Becomes History

This is where Custodian earns its name.

### Deterministic save/reload

RA-01B gets zero tolerance.

The same pre-save world must restore to the same canonical state.

No test weakening.

No "close enough."

### Save boundaries

ASYNC: save freely.

Complex entry: save.

Complex expedition: **no saving.**

Return: save.

Death: optional reload to pre-expedition state exists outside simulation canon.

### Real-world passage

World begins in 1991.

Offline elapsed real time advances institutional chronology.

### Offline simulation

Other people continue living.

Assignments happen.

Knowledge changes.

Personnel move.

Management can change.

ASYNC itself can evolve.

But the offline simulator produces **history**, not replacement gameplay.

It shouldn't solve every fascinating problem while Jack sleeps.

### Missing personnel

Missing is not dead.

Persist them in the Complex.

Years later:

name tag.

Skeleton.

Hay Bacillus.

Old corpse.

Or:

> “Monroe?”

And Monroe turns around looking seventy.

### Multi-career worlds

Death doesn't necessarily kill the world.

New employee.

Same ASYNC.

Same records.

Same consequences.

Potentially your previous self still somewhere inside.

### Checkpoint 6: **Leave It Alone**

This checkpoint takes actual wall-clock time.

Save.

Quit.

Come back later.

The world must have changed.

But it must still feel like **your world**.

---

# Phase 7: Presentation, Horror and the First Day

Only once the underlying game works do we polish the ceremony around it.

This is where your actual assets become enormously important.

### Onboarding

Build the sequence you described:

**identity → ASYNC letter → liability nightmare → Promotional Video projector → briefing → staging → equipment requests → personnel files → Threshold → KV31 → Outpost → steel door → full UI reveal**

Use the actual ASYNC letter when you provide it.

Use the actual Promotional Video MP4 when you provide it.

Don't generate knockoffs of things we literally possess.

### Audio

Integrate the existing audio authority properly:

- Threshold behavior
- post-crossing ambience
- radio beep
- noclip crossing cue
- green crackle
- red-city wobble
- cameras
- situational movement
- restrained easter eggs

### Death presentation

No:

**YOU DIED**

No exposition.

CRT collapse.

Silence.

ASYNC falsified news story.

Then metagame choices.

### Tone pass

Dry.

Institutional.

Human.

Occasionally funny because the situation is absurd, not because the narrator wants laughs.

### Checkpoint 7: **First Career**

Fresh save.

No developer knowledge.

Create employee.

Work.

Enter Complex.

Complete several assignments.

Return.

Build relationships.

Eventually fuck up catastrophically.

Judge the whole experience.

---

# Phase 8: Release Engineering

**Then** we do what the old Prompt 18/19/20/21 sequence was prematurely trying to reach.

Worldpack productization belongs here or where dependency analysis places it, not because an old pass number says so.

We verify:

- clean Windows installation
- first launch
- offline deterministic mode
- optional AI/provider mode
- save migration
- corrupted-save behavior
- crash recovery
- accessibility
- settings
- performance
- long-session stability
- packaging
- tester report export
- worldpack/runtime isolation
- licensing/assets
- documentation
- fresh-machine installation
- replayability
- seeded reproducibility where appropriate
- automated regression
- native Electron interaction
- torture testing

Then external testers.

And we don't give them a lecture first.

We watch where they become confused.

### Checkpoint 8: **Stranger Test**

Someone who isn't Jack and hasn't read our doctrine gets the build.

Can they:

understand they're an ASYNC employee → understand what they can do → complete onboarding → communicate → act → explore → understand their assignment → return → understand that the world persisted?

If they need us standing behind them explaining the design, **the UI failed.**

---

# Final Gate: Yellow Beast 1.0

The release question stops being:

> Did all 21 prompts execute?

It becomes:

> **Does this fulfill the Player Promise?**

I want five brutal release questions:

**Can I attempt things the developers never specifically scripted?**

**Can another person meaningfully surprise me without the game cheating?**

**Can I discover something that permanently changes what ASYNC knows?**

**Can an uneventful expedition still feel worthwhile?**

**Can I come back after a long career and recognize a history that belongs uniquely to this world?**

Five yeses.

Then we ship.

---

And there's one other change I want from our previous development campaign.

**No more enormous context-stuffed Codex conversations carrying five passes worth of history.**

The qwen incident where a session blew past a 262k context limit was a warning shot. Even with Sol, drowning an agent in accumulated conversation is not the same thing as giving it good context. 

Each implementation unit gets a **Pass Packet**:

`Goal → Player Experience → Authorities → Current Relevant Files → Allowed Scope → Forbidden Regressions → Acceptance Tests → Human Gate`

Codex gets the relevant authority, not our entire archaeological record.

And after every checkpoint we write a compact **State of Yellow Beast** handoff containing repository truth, current capabilities, known defects, deferred work and the next approved target.

That incorporates what was actually useful from the vibe-coding material without letting "vibe coding" mean **yeet increasingly gigantic prompts into Sol and pray to the silicon rectangle**.

So yes:

**Prompt 18 is dead.**

Long live **Yellow Beast 1.0 Vision-Centric Campaign**.

And when we're ready to actually begin tonight, **Phase 0 is first**. We reconcile the two audits, the repository, the old roadmap, the new Gameplay Constitution, and our development-method lessons into one brutally factual ledger before anybody is granted implementation authority.