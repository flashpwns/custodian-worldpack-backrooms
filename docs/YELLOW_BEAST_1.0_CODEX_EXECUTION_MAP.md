# YELLOW BEAST 1.0 — CODEX EXECUTION MAP
## Single-Weekly-Allotment Optimization Plan

**HISTORICAL STATUS:** Superseded as execution authority by `docs/YELLOW_BEAST_VISION_PASS_MAP.md`. Retained only as planning provenance. Its prompt count, pass order, model budget, completion assumptions, death/retirement rule, and checkpoint rule do not govern current work.

**Status:** FINAL PLANNING MAP FOR PROMPT CONSTRUCTION
**Prepared:** 2026-08-06
**Source documents:** Yellow Beast 1.0 Design Charter + Yellow Beast 1.0 Implementation Roadmap
**Starting public baseline:** `0.13.0-alpha` / Omnipass 7–9 / PR #42 / `b81165b`
**Starting local branch:** `agent/pass-10-release-candidate`

---

# 0. PURPOSE

This document is the execution companion to the Design Charter and Implementation Roadmap.

The Charter decides **what Yellow Beast 1.0 is**.

The Implementation Roadmap decides **the dependency order of construction**.

This file decides:

- how many primary Codex prompts are planned,
- which model each prompt should use,
- which reasoning level each prompt should use,
- where expensive reasoning is justified,
- where it is prohibited,
- how tests should escalate,
- where human validation occurs,
- how much repair reserve is allowed,
- and how to maximize the probability of completing construction within one weekly Codex allotment.

The target is intentionally aggressive:

> **Attempt the complete Yellow Beast 1.0 construction campaign within one weekly Codex usage allotment without sacrificing architectural correctness, human validation, or release gates.**

This is an optimization target, **not a guarantee**. Actual Codex consumption is token-based and depends on repository reads, cached input, generated output, reasoning, testing, and repair work. The account's `/status` / Usage panel remains authoritative for remaining allowance.

---

# 1. OFFICIAL PRIMARY PROMPT COUNT

## 21 PRIMARY CODEX PROMPTS

This is the frozen planned construction count from current state to 1.0.

The number does not include small repair prompts that become necessary because human testing finds a defect.

### Repair reserve

- **0–4 repair prompts:** ideal
- **5–6 repair prompts:** acceptable
- **7+ repair prompts:** stop and re-evaluate prompt quality / architecture before continuing

A primary implementation prompt must instruct Codex to reproduce, implement, test, repair its own discovered failures, commit, and report. It should **not** stop after planning or after the first failed test.

---

# 2. CURRENT CODEX COST MODEL

OpenAI's current Codex token-based rate card lists:

| Model | Input / 1M | Cached Input / 1M | Output / 1M | Relative Cost |
|---|---:|---:|---:|---:|
| GPT-5.6 Luna | 25 credits | 2.5 credits | 150 credits | **1.0×** |
| GPT-5.6 Terra | 62.5 credits | 6.25 credits | 375 credits | **2.5× Luna** |
| GPT-5.6 Sol | 125 credits | 12.5 credits | 750 credits | **5.0× Luna** |

Because these ratios are identical across input, cached input, and output, they are useful for planning even when exact task token counts are unknown.

**Important:** reasoning level can increase generated reasoning/output and therefore cost, but OpenAI does not publish a fixed multiplier for Medium vs High. This roadmap therefore treats reasoning level as a **token-risk constraint**, not a precise price multiplier.

Sources verified 2026-08-06:
- OpenAI Help Center, Codex rate card
- OpenAI Help Center, GPT-5.6 availability in Codex

---

# 3. MODEL DOCTRINE

## GPT-5.6 Luna

Use when the problem is bounded, mechanically specified, primarily renderer/UI/QoL work, documentation or presentation work, test harness work, polish/accessibility work, or a narrow repair with a known root cause.

**Default reasoning:** Medium

Avoid High unless unexpected nontrivial state or migration reasoning appears.

## GPT-5.6 Terra

**Default Yellow Beast implementation model.**

Use when the work spans several established authorities, needs meaningful code reasoning, changes persistence or state transitions, implements a new but well-specified subsystem, changes personnel/evidence/assignment behavior, or requires substantial integration without inventing a new top-level architecture.

**Default reasoning:** Medium

Use High for migrations, persistence, epistemic boundaries, mission generation, personnel cognition, complex cross-system invariants, mortality, and release audits.

## GPT-5.6 Sol

Sol is **architectural ammunition**.

Use only where an incorrect conceptual implementation would contaminate later passes.

Approved 1.0 construction uses:

1. persistent procedural geography,
2. phenomenon ecology,
3. second-worldpack genericity proof.

**Default reasoning:** High

**Extra High:** prohibited by default. It may only be used after a concrete blocker proves High inadequate.

---

# 4. REASONING DOCTRINE

## MEDIUM

Use when the implementation path is already prescribed.

> Understand the local architecture, implement the requested slice, test it, and stop.

## HIGH

Use when the task requires reasoning over multiple canonical authorities, state ownership, save migrations, observer knowledge, persistent generation, irreversible consequences, generic architecture, or release-wide auditing.

## EXTRA HIGH

Not part of the planned 1.0 campaign.

Escalate only for a demonstrated architectural blocker that survives a properly scoped High-reasoning attempt.

---

# 5. FINAL PRIMARY PASS MAP

| # | Roadmap Work | Model | Reasoning | Cost Class | Human Gate |
|---:|---|---|---|---|---|
| **01** | Pass 10A — First-Run Playability | **Luna** | **Medium** | Low | Launch → briefing recording |
| **02** | Pass 10B — Full Human Clear-Q4 Spine | **Terra** | **Medium** | Moderate | Full operation |
| **03** | Pass 10C — Persistence / Recovery / Diagnostics | **Terra** | **High** | High | Kill/relaunch/resume tests |
| **04** | Pass 10D — Accessibility / Interface / Beta Identity | **Luna** | **Medium** | Low | Keyboard + scaling |
| **05** | Pass 11 — Facility-Side Spatial Experience | **Luna** | **Medium** | Low | Facility ritual playthrough |
| **06** | Pass 12A — Survey Frontier Authority | **Terra** | **High** | High | Knowledge-layer verification |
| **07** | Pass 12B — Persistent Procedural Complex | **Sol** | **High** | Very High | Multi-op geography persistence |
| **08** | Pass 13A — Assignment Engine | **Terra** | **High** | High | State-derived assignment chain |
| **09** | Pass 13B — Career Loop / Ops Between Ops | **Terra** | **Medium** | Moderate | Multi-operation career |
| **10** | Pass 14A — Personnel Continuity / Salience / FAILRP | **Terra** | **High** | High | Repeat-roster human test |
| **11** | Pass 14B — LOCAL + Persistent STANDARD Operator | **Terra** | **High** | High | Natural-language team test |
| **12** | Pass 15A — Evidence Authority + Archive | **Terra** | **Medium** | Moderate | Multi-mission archive |
| **13** | Pass 15B — Procedural Evidence Media Pipeline | **Terra** | **High** | High | Truth-safe media test |
| **14** | Pass 16A — Environmental Simulation | **Terra** | **High** | High | Cross-system environment test |
| **15** | Pass 16B — Phenomena / Still Life / Bacteria | **Sol** | **High** | Very High | Rarity + observer-bound test |
| **16** | Pass 16C — Outcomes / Mortality / World Retirement | **Terra** | **High** | High | Player-death archive test |
| **17** | Pass 17 — Presentation / Providers / Audiovisual Identity | **Luna** | **Medium** | Low | Offline/no-audio/no-AI parity |
| **18** | Pass 18 — Worldpack Productization + Standard-Side Proof | **Sol** | **High** | Very High | 2nd worldpack acceptance |
| **19** | Pass 19A — Human Beta Triage / Defect Omnibus | **Terra** | **Medium** | Moderate | Tester-zero + fresh-user batch |
| **20** | Pass 19B — Replayability / Balance / Performance Hardening | **Luna** | **Medium** | Low | Long-world stress + tuning |
| **21** | Pass 20 — Release Candidate / Certification / Packaging | **Terra** | **High** | High | RC → 1.0 release gate |

---

# 6. MODEL MIX AND PRICE WEIGHT

Primary prompt allocation:

- **Luna:** 5 prompts
- **Terra:** 13 prompts
- **Sol:** 3 prompts
- **Total:** 21 prompts

Using model price ratios alone, assuming identical token volume:

- Luna: `5 × 1 = 5`
- Terra: `13 × 2.5 = 32.5`
- Sol: `3 × 5 = 15`

**Total normalized model-price weight: 52.5 Luna-equivalent units.**

An all-Sol 21-prompt campaign would be:

`21 × 5 = 105 Luna-equivalent units`

Therefore the planned routing has a **50% lower model-price weighting than all-Sol** before differences in actual token volume, cache use, reasoning, tests, or repairs.

---

# 7. SINGLE-WEEK ALLOTMENT RULES

## RULE 1 — No blind repository archaeology

Every prompt receives an explicit starting file list.

> Begin with the listed files. Do not recursively inventory the repository unless a concrete dependency or failing test requires it.

Never ask Codex to “explore the repo and figure this out.”

## RULE 2 — Read only relevant Charter / Roadmap sections

Do not paste the full Design Charter into every prompt.

Each task cites only the relevant sections.

## RULE 3 — Maintain one compact handoff file

Maintain:

`docs/IMPLEMENTATION_STATE.md`

It contains only:

- current completed pass,
- branch,
- latest commit,
- active save schema,
- authorities introduced or changed,
- relevant migrations,
- accepted human gate,
- known blockers,
- next-pass prerequisite files.

Every prompt updates it. Every next prompt reads it first.

## RULE 4 — Tests escalate

Default sequence:

```text
focused unit tests
↓
focused integration tests
↓
affected acceptance
↓
desktop build
↓
manual launch gate
```

Do **not** run the entire repository suite after every prompt.

### Full-suite checkpoints

1. completion of Pass 10,
2. completion of Pass 12,
3. completion of Pass 16,
4. completion of Pass 18,
5. Pass 20 release candidate.

## RULE 5 — Codex repairs its own discovered failures

Unless a failure demonstrates contradictory requirements, unsafe ancestry, ambiguous authority, an unrecoverable environment problem, or a real external blocker:

> diagnose → repair → rerun → accept → commit.

## RULE 6 — Concise commentary

Every prompt instructs:

> Keep routine commentary concise. Spend tokens on repository work, tests, and evidence. Do not repeatedly restate the task or narrate ordinary file inspection.

## RULE 7 — Compact final response

Codex returns only:

```text
STATUS
COMMIT
FILES
TESTS
BUILD
MANUAL GATE
SAVE/MIGRATION IMPACT
BLOCKERS
NEXT
```

## RULE 8 — One coherent architecture area per session

Restart Codex at clean committed boundaries when context becomes large.

Use `docs/IMPLEMENTATION_STATE.md` instead of conversational archaeology.

## RULE 9 — Human debugging happens outside Codex first

```text
SCREEN RECORD
↓
CHATGPT ANALYSIS
↓
SURGICAL CODEX REPAIR PROMPT
```

## RULE 10 — Sol cannot be used for convenience

Planned Sol prompts are exactly:

- **07** — persistent procedural geography
- **15** — phenomenon ecology
- **18** — second-worldpack genericity proof

Additional Sol use requires a concrete architectural reason.

---

# 8. PROMPT CONSTRUCTION TEMPLATE

Every primary prompt should contain, in this order:

1. **Operating context** — branch, expected commit, push/merge limits.
2. **Read budget** — exact initial files and document sections.
3. **Existing authorities** — modules that own relevant truth.
4. **Pass scope** — exact features to implement.
5. **Explicit exclusions** — later-pass work that must not be pulled forward.
6. **Acceptance criteria** — observable behavior.
7. **Required tests** — focused first.
8. **Regression escalation** — affected acceptance/build/full-suite checkpoint.
9. **Persistence/migration rule** — whether schema changes are allowed/expected.
10. **Human gate** — exact screen-recorded action sequence.
11. **Commit requirement** — one coherent local commit.
12. **Implementation handoff** — update `docs/IMPLEMENTATION_STATE.md`.
13. **Final response constraint** — compact status format.

---

# 9. PASS-BY-PASS EXECUTION CONSTRAINTS

## PROMPT 01 — PASS 10A — Luna / Medium
**Objective:** Make the player able to clock in.

Read narrowly: renderer world creation, preload bridge, DesktopService world creation, personnel flow, worldpack registry, first-run tests, Pass 10 relevant docs.

Do not redesign simulation authorities, procedural generation, or content.

**Full suite:** NO

**Human gate:** `fresh launch → name world → create personnel → confirm → Clear-Q4 briefing`

## PROMPT 02 — PASS 10B — Terra / Medium
**Objective:** Make existing Clear-Q4 manually finishable.

Prioritize phase projection, structured actions, staging, Threshold, LOCAL/STANDARD, mission return, reconciliation, debrief, follow-up.

**Full suite:** NO

**Human gate:** one complete human operation.

## PROMPT 03 — PASS 10C — Terra / High
**Objective:** Trustworthy persistence and diagnostics.

High is justified by canonical state, save reconstruction, migrations, and crash recovery.

**Full suite:** NO unless persistence changes unexpectedly affect broad contracts.

**Human gate:** save/kill/relaunch at multiple major phases.

## PROMPT 04 — PASS 10D — Luna / Medium
**Objective:** Beta-worthy first operation UX.

**Full suite:** YES — CHECKPOINT 1

**Human gate:** keyboard-only full operation + scaling check.

**Target checkpoint:** `0.14.0-beta.1`

## PROMPT 05 — PASS 11 — Luna / Medium
**Objective:** Facility becomes spatial UI.

No new world truth. Facility surfaces consume existing authoritative state.

**Full suite:** NO

**Human gate:** complete outbound and return spatial ritual.

## PROMPT 06 — PASS 12A — Terra / High
**Objective:** First-class Survey Frontier / epistemic geography.

Must preserve objective truth, player knowledge, team knowledge, Standard knowledge, and historical record distinctions.

**Full suite:** NO

**Human gate:** show legitimate player-map / Standard-map disagreement.

## PROMPT 07 — PASS 12B — Sol / High
**Objective:** Bounded persistent procedural Complex expansion.

Must prove stable generation, canonical persistence, deterministic seed behavior, no per-mission regeneration, fixed Threshold entry, expanding frontier, and migrations where required.

**Full suite:** YES — CHECKPOINT 2

**Human gate:** multiple operations revisit identical generated geography and penetrate farther.

## PROMPT 08 — PASS 13A — Terra / High
**Objective:** State-derived assignment engine.

Assignments arise from authoritative state and archetype constraints, never generic random quests.

**Full suite:** NO

**Human gate:** several materially different assignments from distinct world histories.

## PROMPT 09 — PASS 13B — Terra / Medium
**Objective:** Career loop + bounded operations between operations.

Hard rule: background activity cannot casually kill or permanently remove valued personnel offscreen.

**Full suite:** NO

**Human gate:** several operations where history creates later work.

## PROMPT 10 — PASS 14A — Terra / High
**Objective:** Personnel continuity, salience, FAILRP prevention.

Distinguish ignorance from FAILRP, personality from random chatter, and salience from constant reaction.

**Full suite:** NO

**Human gate:** repeat coworker across operations and verify contextual continuity.

## PROMPT 11 — PASS 14B — Terra / High
**Objective:** LOCAL natural-language actions + persistent Standard operator.

Natural language proposes actions. Custodian resolves actions.

**Full suite:** NO

**Human gate:** compound natural-language coworker instructions with truthful resolution.

## PROMPT 12 — PASS 15A — Terra / Medium
**Objective:** Evidence authority + archive experience.

Do not implement visual generation yet beyond render-safe schema/spec where required.

**Full suite:** NO

**Human gate:** multi-mission evidence archive with provenance and custody.

## PROMPT 13 — PASS 15B — Terra / High
**Objective:** Procedural evidence media pipeline.

Absolute invariant:

> generated media presents truth; generated media never creates truth.

Provider failure must degrade gracefully.

**Full suite:** NO

**Human gate:** authoritative photograph → render → archive → reload.

## PROMPT 14 — PASS 16A — Terra / High
**Objective:** Persistent environmental state and cross-system consequences.

Implement selected gameplay-relevant environmental domains, not a giant simulation rewrite.

**Full suite:** NO

**Human gate:** one environmental cause legitimately changes several downstream systems.

## PROMPT 15 — PASS 16B — Sol / High
**Objective:** Rare phenomenon ecology, Still Life, Bacteria.

Hard constraints: rarity, persistence, no encounter treadmill, no combat, observer boundaries, no omniscient UI, mundane runs remain normal.

**Full suite:** NO

**Human gate:** seeded rarity matrix + controlled encounter proof.

## PROMPT 16 — PASS 16C — Terra / High
**Objective:** Expanded outcomes, mortality, world retirement, legacy personnel.

Player death is final. Retired worlds are immutable. New worlds do not inherit prior canonical simulation state.

**Full suite:** YES — CHECKPOINT 3

**Human gate:** die → retired archive → new career → search old personnel record.

## PROMPT 17 — PASS 17 — Luna / Medium
**Objective:** Presentation, provider UX, audiovisual identity.

Target offline deterministic, local provider where reliable, OpenAI provider, visual/audio identity, muted/offline equivalence.

Provider problems may never weaken offline play.

**Full suite:** NO

**Human gate:** same operation playable offline, AI-enhanced, and muted.

## PROMPT 18 — PASS 18 — Sol / High
**Objective:** Productize worldpacks and prove genericity through a Standard-side authored experience.

Generic fixes belong in generic architecture. Scenario-specific content remains in the worldpack.

**Full suite:** YES — CHECKPOINT 4

**Human gate:** 20–30 minute Standard-side scenario.

## PROMPT 19 — PASS 19A — Terra / Medium
**Objective:** Human beta triage omnibus.

Input is a pre-triaged defect ledger created outside Codex. Bundle defects by shared root cause. No new feature families.

**Full suite:** NO unless fixes touch contracts.

**Human gate:** repeat failed beta paths.

## PROMPT 20 — PASS 19B — Luna / Medium
**Objective:** Replayability, balance, pacing, and performance hardening.

Prefer data/config tuning, profiling, targeted optimization, deterministic seed matrices. Avoid architectural rewrites.

**Full suite:** NO, but run dedicated long-world/stress suites.

**Human gate:** long-lived world + representative seed matrix.

## PROMPT 21 — PASS 20 — Terra / High
**Objective:** Release candidate certification and 1.0 packaging.

No new features.

Audit all historical tests, acceptances, migrations, offline mode, both worldpacks, accessibility, packaging, diagnostics, release docs, known issues, and save contracts.

**Full suite:** YES — CHECKPOINT 5

**Human gate:** clean-machine-style release playthrough from launch through save/relaunch.

**Release target:** `1.0.0` only if every gate passes.

---

# 10. REPAIR PROMPT ROUTING

| Defect Type | Default Model | Reasoning |
|---|---|---|
| Renderer/layout/focus/copy | Luna | Medium |
| Accessibility/UI navigation | Luna | Medium |
| Test harness / docs | Luna | Medium |
| Known localized runtime bug | Terra | Medium |
| Persistence / migration bug | Terra | High |
| Knowledge-boundary leak | Terra | High |
| Assignment/personnel behavior | Terra | Medium–High |
| Procedural geography invariant | Sol only if Terra cannot safely fix | High |
| Phenomenon truth/persistence invariant | Sol only if Terra cannot safely fix | High |
| Release-wide unexplained regression | Terra first | High |

Never automatically use the same expensive model that implemented the feature. Root cause determines model choice.

---

# 11. USAGE CHECKPOINTS

Use `/status` / Usage as the live budget instrument.

Record remaining allowance after prompts:

- **01**
- **04**
- **07**
- **11**
- **16**
- **18**
- **20**

If usage is burning faster than forecast:

1. do **not** remove acceptance gates,
2. reduce agent exploration,
3. reduce final narration,
4. increase Luna use for bounded work,
5. consolidate only repairs sharing a root cause,
6. reduce nonessential audiovisual breadth before core correctness,
7. never sacrifice save integrity, observer boundaries, or playability.

---

# 12. SINGLE-WEEK SPEEDRUN PRIORITY ORDER

## Tier 1 — Cannot cut
- Pass 10
- Survey Frontier correctness
- procedural geography persistence
- assignment loop
- personnel continuity
- evidence truth
- mortality/save correctness
- offline completeness
- release regression

## Tier 2 — Can reduce breadth, not remove
- Facility presentation depth
- environmental breadth
- procedural evidence rendering providers
- audiovisual richness
- phenomenon variety
- second-worldpack content length

## Tier 3 — Can receive less ornamentation
- extra sound variations
- extra Facility image variants
- decorative transitions
- nonessential animation
- additional assignment flavor text
- archive ornamentation

This is never permission to falsely label an incomplete build `1.0.0`.

---

# 13. DEFINITION OF A SUCCESSFUL ONE-ALLOTMENT RUN

The speedrun succeeds only if:

1. all 21 primary scopes are implemented or legitimately collapsed because later work proves them unnecessary,
2. every required full-suite checkpoint passes,
3. required human gates are performed,
4. no P0/P1 defect remains,
5. save integrity is proven,
6. offline gameplay remains complete,
7. flagship field play and genericity proof both work,
8. Pass 20 certification passes,
9. the final build satisfies the 1.0 Design Charter.

Using the whole allowance is not success.

**Shipping a trustworthy 1.0 is success.**

---

# 14. RESET-DAY EXECUTION ORDER

At reset:

```text
1. Open repo
2. Confirm branch + worktree + latest commit
3. Open Codex
4. Run /status
5. Record starting allowance
6. Select Luna / Medium
7. Submit Prompt 01 — Pass 10A
8. Let Codex reproduce → implement → test → repair → commit
9. Launch build
10. Screen-record human gate
11. Analyze recording outside Codex
12. Repair only if necessary
13. Proceed to Prompt 02
```

Do not submit Prompt 02 merely because Prompt 01 produced a commit.

Submit Prompt 02 because **Prompt 01 passed its human gate**.

---

# 15. CAMPAIGN SUMMARY

**Planned primary prompts:** 21
**Planned Sol prompts:** 3
**Luna prompts:** 5
**Terra prompts:** 13
**Full-suite checkpoints:** 5
**Repair reserve:** 0–6 prompts
**Default reasoning:** Medium
**Extra High:** Not planned

High reasoning is reserved for persistence, epistemic state, procedural geography, assignment architecture, personnel cognition, evidence rendering boundaries, environment coupling, phenomena, mortality, genericity proof, and release certification.

---

# 16. FINAL EXECUTION DOCTRINE

> **ChatGPT plans. Codex builds. Custodian decides truth. Tests prove invariants. Jack proves playability.**

Every token spent should move the repository toward an acceptance gate.

Every expensive model invocation must have an architectural reason.

Every prompt must arrive already knowing:

- what it is changing,
- where to begin,
- what it must not touch,
- how completion is proven,
- and when to stop.

The objective is not to make Codex think about Yellow Beast for a week.

The objective is to make Codex **build Yellow Beast 1.0 before the meter hits zero.**

---

# END
**YELLOW BEAST 1.0 — CODEX EXECUTION MAP**
**Frozen for prompt construction**
