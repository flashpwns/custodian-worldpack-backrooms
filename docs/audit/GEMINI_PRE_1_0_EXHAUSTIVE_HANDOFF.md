# Gemini handoff: Yellow Beast pre-1.0 reconciliation and agency repair

This document is a self-contained execution handoff. Assume the receiving Gemini agent has no access to the prior conversation, terminal history, live UI session, or unstated architectural intent.

## 0. Executive directive

Yellow Beast has a real, persistent, observer-safe Reference Expedition vertical slice. It is not release-ready. The first corrective priority is now unambiguous:

> Make the AI do what the player actually said. Every explicit player and coworker clause must be accounted for before canonical mutation. Execute all valid clauses atomically, or return a truthful clarification/rejection without changing the world. Never silently reduce a compound instruction to one convenient action.

Do not begin broad feature development, visual redesign, additional phenomena, new modes, or prose polish. First repair the agency boundary, then the personnel regression and LOCAL presentation truth, then restore verification and package truth.

No push is authorized. Do not rewrite history. Do not discard, clean, reset, stage, or alter either source worktree. Work only in the integration worktree unless this handoff explicitly instructs a read-only comparison.

## 1. Canonical starting point

- Product repository: `https://github.com/flashpwns/custodian-worldpack-backrooms.git`
- Git common directory: `/Users/jacktr/Developer/custodian-worldpack-backrooms/.git`
- Authoritative worktree: `/Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit`
- Authoritative branch: `integration/pre-1.0-reconciliation`
- Audit base commit: `876fa95841b60b824e5c7529a831469fe2813e2b`
- Current handoff commit: the commit containing this file; verify with `git rev-parse HEAD`
- Product version at audit: `0.14.0-beta.1`
- Remote policy: inspect if needed, but do not fetch merely to refresh and do not push

Start with:

```bash
cd /Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit
git status --short --branch
git rev-parse HEAD
git worktree list --porcelain
npm ls custodian openai electron electron-builder --depth=0
```

Expected starting state: the integration branch is clean. If it is not clean, stop and inspect without deleting anything. Do not assume unexpected changes are yours.

## 2. Preserved repository topology

### Sol source worktree

- Path: `/Users/jacktr/Developer/custodian-worldpack-backrooms`
- Branch: `reference-expedition/foundation`
- Frozen HEAD: `173edc060f5e5a3d530f4bdb1683f1fd67b0299a`
- Upstream at audit: `origin/reference-expedition/foundation`, ahead by seven commits
- State at audit: intentionally dirty
- Staged paths:
  - `desktop/renderer-smoke.js`
  - `desktop/renderer/audio.js`
  - `desktop/renderer/index.html`
  - `desktop/renderer/renderer.js`
  - `desktop/renderer/styles.css`
  - `desktop/renderer/surfaces.js`
  - `tests/y75-ui-audio-spec-compliance.test.js`
- Also unstaged:
  - `desktop/renderer/renderer.js`
  - `desktop/renderer/surfaces.js`
  - `tests/y75-ui-audio-spec-compliance.test.js`
- Audit disposition: preserved, non-canonical evidence source

### Gemini source worktree

- Path: `/Users/jacktr/Developer/custodian-worldpack-backrooms-gemini`
- Branch: `gemini/aeot-presentation`
- Frozen HEAD: `890300ff4eb04de44b32e6463941a51a4fe6cef2`
- State at audit freeze: clean
- Audit disposition: source baseline admitted into integration, but not release-certified

### Integration worktree

- Path: `/Users/jacktr/Developer/custodian-worldpack-backrooms-pre-1.0-audit`
- Branch: `integration/pre-1.0-reconciliation`
- Created from Gemini `890300f`
- Has an independent `npm ci` install; this matters because Gemini's ignored dependencies were cross-linked
- Audit disposition: only worktree authorized for corrective implementation

### Backup refs

- `backup/pre-audit-sol-head-20260904` -> `173edc0`
- `backup/pre-audit-gemini-head-20260904` -> `890300f`
- `backup/pre-audit-sol-dirty-20260904` -> `8a44efa`

The dirty snapshot was created with `git stash create`; it did not change the Sol index or working tree. There were no stashes and no active merge, rebase, or cherry-pick states at freeze.

## 3. Branch reconciliation already decided

The Sol/Gemini merge base is `37be7a1d21c6fa35a493e27544a5b2a465f8b75f`.

### Sol-only commits

```text
f6631b3 feat: preserve hosted provider provenance and AEOT cockpit
c867c16 feat: separate Reference Expedition report authority
e1b483d fix: normalize packaged ASAR entry paths
63c33f4 feat: expose canonical facility operation events
173edc0 fix: migrate threshold operation authority
```

### Gemini-only commits after the merge base

```text
5aaabd1 AEOT copy, vocabulary, interface audio hooks
4997464 mechanical STANDARD/LOCAL selector
c083f7d cold-blue AEOT palette
37a167e operational visual hierarchy
ddb8dde multipurpose Spatial / Visual Display
9fe3386 audio sequencing and spec assertions
04a6b8e PROCEED/report/debrief presentation
b79ece4 living observation/comms/provider-failure presentation
e7bcc4f canonical facility operation events
d7da20d Threshold authority migration
c43f40a AEOT cockpit chassis repair
d70b5ad hosted provider transport generalization
c1ae0ff automatic provider fallback
bec8fb7 mocked provider failover tests
d76855b stale startup/settings removal
85fbab6 interaction-path consolidation
3ecb4d1 cleanup/navigation invariant tests
dfc24bf inference-provenance UI removal
890300f minimum living-world substrate
```

### Adjudication

- Sol `63c33f4` and Gemini `e7bcc4f` are exact patch duplicates. Patch ID: `6a553da81401e44613cfaa67381c0f408b0d9ed2`.
- Sol `173edc0` and Gemini `d7da20d` are exact patch duplicates. Patch ID: `4ea599b977c1c8c2b5346aebf64d20f003c60ab5`.
- Sol `e1b483d` ASAR separator normalization is already present semantically in Gemini.
- Sol `c867c16` report/evidence/institution separation is present semantically in Gemini and exercised by y69/y78.
- Sol `f6631b3` is not safe to cherry-pick wholesale. Its newer Custodian host-adapter/build-provenance changes may be useful, but its provider rewrite would remove Gemini's broader tested provider pool and automatic fallback path.
- Sol dirty UI/audio work is experimental/superseded until reviewed clause by clause. It contains a meaningful correction toward canonical facility-event-driven audio, but also overlaps heavily with Gemini y75-y77 presentation work.

Do not merge either source branch into integration. Admit a small change only after semantic comparison against current integration code and the authority map.

## 4. Mandatory reading order

Read only the relevant portions needed for the current repair, but preserve this authority order:

1. `SIMULATION_DOCTRINE.md`
2. `docs/reconciliation/YELLOW_BEAST_GAMEPLAY_CONSTITUTION.md`
3. `canon/SOURCE_POLICY.md` and only relevant admitted claims
4. `YELLOW_BEAST_RECONSTRUCTION_AUTHORITY.md`
5. `docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md`
6. `docs/YELLOW_BEAST_CURRENT_BASELINE.md`
7. `docs/YELLOW_BEAST_VISION_PASS_MAP.md`
8. `docs/IMPLEMENTATION_STATE.md`
9. `docs/reference-expedition/REFERENCE_EXPEDITION_INVARIANTS.md`
10. `docs/reference-expedition/REFERENCE_EXPEDITION_SPECIMEN_BRIEF.md`
11. The six pre-1.0 audit documents in `docs/audit/`

For this first repair, begin specifically with:

```text
docs/audit/PRE_1_0_CLOSURE_LEDGER.md
docs/audit/PRE_1_0_AUTHORITY_MAP.md
docs/audit/PRE_1_0_FEATURE_AUDIT.md
tools/ai-living-provider.js
tools/ai-interpreter-boundary.js
tools/ai-living-turn.js
tools/live-scene-projection.js
desktop/service.js
tests/y70-coordinated-execution.test.js
tests/y71-ai-interpreter-boundary.test.js
tests/y73-ai-living-turn.test.js
tests/y78-reference-expedition-living-world.test.js
```

Do not recursively rewrite or reorganize the repository before the focused behavior is fixed.

## 5. Non-negotiable authority model

The pipeline is:

```text
player's exact submitted language
  -> observer-safe interpretation context
  -> noncanonical typed proposal
  -> complete-clause and reference validation
  -> canonical Custodian resolution
  -> committed world/session history
  -> observer-safe projection
  -> optional generated presentation
  -> presentation validation or deterministic fallback
  -> renderer
```

Rules:

1. Code owns canonical truth and hard constraints.
2. AI proposes intent, NPC language/actions, environmental microevents, and presentation only through bounded schemas.
3. A model never receives the raw canonical world or hidden geometry.
4. A model never mutates state directly.
5. Custodian/deterministic runtime decides what is possible and commits the consequence.
6. Narration failure after a committed action does not undo, repeat, or replace that action.
7. The player’s exact input must be retained for audit/provenance.
8. Never invent player speech, thought, emotion, realization, choice, or action.
9. Never convert an unobserved canonical fact into player or institutional knowledge.
10. NPC speech must be authorized by location, contact, knowledge, condition, and continuity.
11. Environmental description should lead with material observation. Institutional interpretation must remain labeled belief/report, not direct perception.
12. A partial interpretation is not a successful interpretation unless every omitted clause is explicitly disclosed and the product policy authorizes partial commit. Current recommendation is atomic validation for coordinated intervals.

## 6. Current authoritative domain owners

| Domain | Owner |
|---|---|
| World identity/history | `tools/world-history.js` |
| Run/session envelope | `tools/run-bootstrap.js` |
| Physical geography | `tools/spatial-runtime.js` plus worldpack spatial definitions |
| Objects/interactions | `tools/object-runtime.js` plus interaction definitions |
| Mission/closure | `tools/mission-runtime.js`, `tools/q4-continuity.js` |
| Operational time/events | `tools/operational-time.js`, `tools/operational-cycle.js` |
| Personnel identity/status | `tools/q4-personnel.js`, `tools/consequence-runtime.js`, `tools/q4-personnel-continuity.js` |
| Coworker orders/tasks | `tools/team-runtime.js` after validated dispatch |
| Equipment/custody | `tools/logistics-runtime.js`, `tools/q4-equipment.js` |
| Environment/hazards | `tools/q4-environment.js`, `tools/hazard-runtime.js` |
| Evidence | `tools/q4-evidence-authority.js` |
| Communications | `tools/communication-runtime.js`, `tools/q4-radio.js` |
| Standard/institution knowledge | `tools/institutional-runtime.js`, `tools/q4-standard-operator.js` |
| Phenomena | `tools/q4-phenomenon-ecology.js` |
| Intent boundary | proposal in `tools/ai-interpreter-boundary.js`; canonical dispatch remains Custodian/runtime |
| Scene narration | `tools/ai-living-turn.js`, `tools/scene-presentation.js` validation/fallback |
| LOCAL prose | personnel continuity authorizes; `tools/ai-local-dialogue.js` validates presentation |
| Provider selection/health | `tools/ai-provider-pool.js`; credentials remain host-only |
| Persistence transaction | `DesktopService.commitPersistencePair`; domain semantics remain in their modules |
| Verification governance | `verification/verification-authority.json` plus external human-approved Git baseline |

`desktop/service.js` is a coordinator, not permission to redefine domain semantics. It is already large and high-risk; avoid moving more authority into it.

## 7. What currently works

The following is real behavior, not only code presence:

- First-run field file and personnel creation.
- Clear-Q4 assignment briefing, staging, facility transit, radio check, explicit Threshold crossing, and field entry.
- Four-person authored Reference Expedition party:
  - Matthew Murphy: controlled Survey Lead
  - Santiago Stokes: Survey Technician
  - Beverly Bell: Documentation Specialist
  - Autumn Tucker: Route Specialist
- Persistent geography, bidirectional movement, route history, objects, object conditions, and evidence.
- Observer-specific location and knowledge projection.
- Coworker hold/follow/delegation for covered cases.
- Equipment custody, proximity, transfer/handoff, and capability constraints.
- STANDARD radio records and institution knowledge separation.
- Evidence, player written report, and institutional assessment remain distinct.
- Provider failure retains committed canonical state and returns a safe fallback.
- Live source Electron UI can reach FIELD_OPERATION.
- Live save/reload retained T+5, Utility Room, fixture inspection, team state, objective, radio history, and zero evidence.
- y78 completes an automated 18-step Reference Expedition through report and institutional assessment.
- y33 currently passes 2,650 canonical turns, 2,544 events, eight save/reload cycles, 48 desktop turns, and six restart cycles.

These working systems must not be regressed while fixing language fidelity.

## 8. Highest-priority reproduced player-agency failure

### Exact live input

```text
I inspect the fluorescent fixture while Beverly photographs it.
```

### Context

- Real Electron renderer
- Normal production service seam
- Reference Expedition
- FIELD_OPERATION in Utility Room
- Matthew, Santiago, Beverly, and Autumn co-present
- Beverly visibly held the 35mm camera
- Fluorescent fixture was visible and offered both Inspect and Photograph controls
- No hosted credential was used; deterministic living-provider fallback was active

### Actual result

- The player inspection committed.
- The fixture's inspected condition persisted.
- Beverly performed no photographic action.
- Evidence remained `0 RETAINED`.
- The UI presented the inspection prose as a successful resolved turn.
- No clarification disclosed that the coworker clause had been omitted.

### Expected result

One of only these outcomes is acceptable:

1. Both the player inspection and Beverly's authorized photograph validate against the same pre-interval scene and commit as one coordinated interval.
2. The whole bundle rejects/clarifies before mutation, naming the unsupported or ambiguous clause in observer-safe language.
3. If director policy explicitly allows partial commits later, the result must enumerate completed, failed, and unattempted clauses before commit and cannot call the whole input resolved. Do not assume this policy is authorized now.

### Root cause already identified

`tools/ai-living-provider.js:40-53` recognizes only a narrow coordinated grammar:

- input contains `while`
- input contains `I`
- input contains `measure`, `measurement`, or `reading`
- it assumes the coworker clause is before `while`
- it assumes the player clause is after `while`
- it chooses the first advertised coworker action and first player action

The reproduced input has the player clause first and asks the coworker to photograph. It misses the special case, then falls through to the single INSPECT branch at lines 88-90. `desktop/service.js:976-986` accepts the resulting resolved living turn and persists it without an independent source-clause coverage check.

This is not merely an offline parser limitation. Hosted model output could make the same omission unless the boundary validates complete coverage.

## 9. Required first implementation pass: YB-C02

### Goal

Enforce clause-complete natural-language interpretation for Reference Expedition living turns.

### Player experience

- Natural language remains the primary field control.
- The player can combine their action with one or more explicit coworker orders/actions.
- The system never pretends an omitted clause occurred.
- Ambiguity produces a concise in-universe clarification with no world mutation.
- Impossible actions produce a truthful rejection with no fabricated attempt.
- Successful coordinated attempts share one authoritative interval and are presented as one coherent resulting moment.

### Allowed scope

- `tools/ai-living-provider.js`
- `tools/ai-interpreter-boundary.js`
- `tools/ai-living-turn.js`
- narrowly required validation helpers
- focused tests y70/y71/y73/y78 or a new focused test file
- the smallest necessary service response change if the boundary needs to expose explicit clause accounting
- documentation/handoff updates after the behavior passes

### Forbidden scope

- New world content, rooms, phenomena, missions, modes, or characters
- Visual redesign
- Broad audio work
- Verification authority hash changes
- Provider-list redesign
- Custodian dependency upgrade
- Packaging repair
- Rewriting player input into a simpler command before validation
- Letting generated prose decide which canonical actions occurred
- Changing tests merely to accept the reproduced partial-success behavior

### Required interpretation contract

The proposal/candidate must retain enough evidence to verify:

- exact source text
- explicit clause identities in source order
- language span or stable source-span bounds for each clause
- actor per clause: player or named visible coworker
- relation: sequence, parallel/coordinated, or condition
- requested action family
- requested target/equipment/reference
- agency classification
- whether the interpreter claims complete coverage
- no overlapping or fabricated source spans
- no explicit source clause absent from the proposal

Do not rely only on a model boolean such as `complete: true`. Recompute coverage deterministically from the submitted structured proposal and source text. Exact natural-language semantic completeness cannot be solved by character coverage alone, but source spans plus explicit clause IDs can prevent silent deletion and support conservative clarification.

### Recommended design direction

1. Segment candidate clauses conservatively around coordination/sequence markers while preserving the exact original input.
2. Require each proposed attempt to cite its exact language span.
3. Validate that every material segmented clause maps to exactly one proposed attempt or an explicit clarification reason.
4. Validate all actors and references against the same immutable observer-safe pre-interval scope.
5. Construct the full canonical candidate only after completeness and scope validation.
6. Dispatch the bundle atomically through existing coordinated execution.
7. Compare the authoritative resolution's completed/failed/partial step identities with the validated clause set.
8. Refuse a `RESOLVED` status if any validated clause disappears.
9. Build presentation only from the authoritative resolution and observer packets.
10. Preserve canonical commit if presentation fails; use deterministic presentation fallback.

Prefer extending the existing typed boundary over adding a parallel parser or a second execution path.

### Required test matrix

At minimum, add behavioral tests for:

1. `Beverly photographs the fixture while I inspect it.`
2. `I inspect the fixture while Beverly photographs it.`
3. `I inspect the fixture and Beverly photographs it.`
4. `While I inspect the fixture, Beverly photographs it.`
5. Named coworker by first name, full name, and unique role.
6. Two valid simultaneous actions commit one interval.
7. Reversed clause order produces equivalent authoritative intent, not necessarily identical prose.
8. Coworker-held required equipment succeeds only for that coworker.
9. Player cannot use coworker-held equipment implicitly.
10. Absent coworker causes clarification/rejection before any player clause commits.
11. Ambiguous coworker causes clarification with safe options and zero mutation.
12. Hidden/unobserved target is unavailable even if its internal ID is guessed.
13. One valid plus one impossible clause causes atomic no-mutation.
14. One valid plus one unsupported verb causes clarification/no-mutation.
15. Three-clause sequence retains order.
16. Mixed sequence and parallel relation is either supported exactly or clarified before mutation.
17. Conditional instruction is either represented faithfully or clarified; condition text cannot be dropped.
18. Malformed hosted structured output fails closed.
19. Hosted output with missing clause fails complete-coverage validation.
20. Hosted output with invented extra clause fails validation.
21. Provider failure retains zero mutation before dispatch.
22. Presentation failure after successful coordinated dispatch retains exactly one canonical interval.
23. Save/reload preserves both coordinated effects and provenance.
24. Renderer displays a truthful combined outcome.
25. No generated player speech, thought, realization, emotion, or unsubmitted action.

The exact live regression sentence must become a permanent test.

### Focused verification sequence

Run in this order:

```bash
node --test tests/y70-coordinated-execution.test.js
node --test tests/y71-ai-interpreter-boundary.test.js
node --test tests/y73-ai-living-turn.test.js
node --test tests/y78-reference-expedition-living-world.test.js
node --test tests/y33-long-world-torture.test.js
node tools/yb33-torture-report.js
npm run conformance
git diff --check
```

Also run the new clause-completeness test explicitly. Do not treat `npm test` as the behavior gate until verification authority is repaired; still run it and report its known inventory failure unchanged.

### Human gate for C02

Launch a fresh isolated source UI without touching production data:

```bash
./node_modules/.bin/electron desktop/main.js \
  --reference-expedition \
  --user-data-dir=/private/tmp/yb-gemini-agency-gate
```

Create a new field file, create Matthew Murphy, proceed through briefing/staging/radio/Threshold, and submit the exact regression sentence. Verify visually and in the saved record that both actions occurred in one interval, evidence exists under Beverly's operation/provenance, and no hidden/canonical wording leaked.

Then quit, relaunch with the same isolated data directory, and verify the result persists exactly.

Do not delete the diagnostic profile if the gate fails. Report its path. Do not use the user's normal Electron profile.

### Definition of done for C02

C02 is complete only when:

- every required test above passes;
- the exact live sentence passes through the real renderer;
- save/reload preserves both effects;
- provider/presentation failure cannot undo or duplicate the canonical interval;
- no old single-action, movement, handoff, hidden-reference, or agency-boundary test regresses;
- changed files and new authority are documented;
- the result is committed locally on the integration branch;
- no push occurs.

## 10. Second reproduced dialogue/presentation defect: YB-C04

### Exact live LOCAL message

```text
Beverly, hold the camera ready and tell me what you can see around the fixture.
```

### Actual presentation

- The UI contract said LOCAL was heard by all nearby participating personnel.
- The canonical no-target communication path broadcast to Santiago, Beverly, and Autumn.
- The response selector noticed Beverly's name and selected Beverly's response.
- The chronology displayed the interaction as `YOU -> Santiago Stokes` because renderer presentation reduced the targets list to its first entry.
- The response text itself began with `Beverly:` and the surrounding UI added identity again, creating confused speaker attribution.

### Relevant code

- `desktop/service.js:679` accepts an explicit `target`, but the current renderer LOCAL submission did not supply one.
- `desktop/service.js:689-701` broadcasts to all local peers when `peer` is null.
- `desktop/service.js:706-710` chooses a named response speaker from message text.
- `desktop/service.js:712` stores every broadcast recipient as the interaction targets.
- `desktop/service.js:720` supplies the chosen authorized speaker to hosted/local dialogue presentation.
- Inspect `desktop/renderer/surfaces.js` and renderer chronology formatting for the first-target collapse.

### Required disposition

Do not quietly turn broadcast LOCAL into private telepathy. Decide and implement one truthful model:

- broadcast plus a visibly identified primary respondent; or
- explicit addressee UI plus broadcast audibility as separate facts; or
- director-approved targeted conversation semantics.

Until the director answers, the smallest safe repair is to label no-target messages as nearby-team broadcast and separately label Beverly as the respondent. Do not show `YOU -> Santiago` for a three-recipient broadcast.

Do C04 after or alongside C02 only if the changes remain focused. It must not distract from complete action-clause accounting.

## 11. Personnel regression: YB-C03

On the clean independent integration install, these tests fail:

```text
tests/y37-q4-personnel.test.js
  LOCAL uses the named person and follows coarse contact eligibility
  confirmed death is permanent, non-local, and staffed by a different identity later
```

Treat them as real behavioral failures until proven stale by doctrine and human adjudication. Do not rewrite them merely to obtain green. Inspect the current observer-status/contact classification, world-character reconciliation in `DesktopService.reconcileSessionCandidate`, irreversible consequence ownership, and successor selection.

This blocks a trustworthy personnel-heavy playtest and is P0 in the current ledger.

## 12. Test truth state

### Independent-install commands already run

```text
npm ci                                                   PASS
npm run conformance                                      PASS, 10 checks
npm test                                                 FAIL, 97 inventory errors before aggregate
node --test --test-reporter=dot tests/*.test.js           642 total, 634 pass, 8 fail
node --test tests/y78-reference-expedition-living-world.test.js
                                                         PASS 8/8
node --test tests/y33-long-world-torture.test.js           PASS 1/1
node tools/yb33-torture-report.js                         passed:true, exit 0
```

### Eight ungated failures

1. y34 stale quarantined first-scene expectation.
2. y35 stale quarantined program-label expectation.
3. y35 stale quarantined disabled-markup expectation.
4. y37 named-person/contact behavior regression.
5. y37 permanent-death/succession regression.
6. y57 native Electron renderer reports PROCEED not hit-testable.
7. y67 test-profile overlap validation reports missing marker before expected production-overlap rejection.
8. y68 real inventory consistency failure.

In the Gemini worktree only, y77 startup hygiene also failed because a previous build left ignored `desktop/build-info.json`. It passed in the clean integration checkout before any build. The test is order/worktree-history sensitive.

### Why inventory has 97 errors

- 63 governed files match their approved hashes only if LF is converted to CRLF.
- 28 protected files match raw bytes.
- 26 differ beyond line endings and require actual review.
- y75, y76, y77, and y78 are present on disk but absent from both required-test authority and manifest.
- Six protected executable/report/build tools have changed since authority anchoring.
- The line-ending defect existed at the original `e57ceea` authority anchor: the authority hashes were Windows raw-byte hashes while the repository blobs/checkouts are normalized.

Do not update `verification/verification-authority.json`, its protected hashes, or verifier core during ordinary implementation. `verification/TIERS.md` requires explicit external review against an approved Git baseline.

### Tests that gave false confidence

- y75 and much of y77 inspect source strings/selectors/tokens. They do not prove actual rendering, hit testing, or audible output.
- y78 covers a successful phrase set but does not assert complete accounting of arbitrary explicit clauses.
- y76 is mocked provider evidence, not a live hosted-provider certification.
- y33 remains governed as a known defect although it now passes; stale quarantine obscures current truth.
- `npm run conformance` covers a small kernel/worldpack contract, not the desktop product.
- A raw `node --test tests/*.test.js` sweep bypasses tier governance and mixes manual/native/quarantined tests. It is diagnostic only.

## 13. Dependency/source-of-truth hazard

The Gemini source worktree had:

```text
node_modules -> /Users/jacktr/Developer/custodian-worldpack-backrooms/node_modules
```

Therefore its initial tests and packages used Sol's dependency installation. `npm ls` marked Custodian invalid there. The integration worktree ran an independent `npm ci` and reproduced the same core feature passes and eight failures, so the findings are not artifacts of the link. However, only integration evidence is reproducible evidence.

The lockfile records Custodian version 1.5.0 resolved at `b3738da433c78ee4bdb341114933b36a379bd6a4`; that commit's own `package.json` says 1.6.0. The commit identity is currently stronger than the stale lock metadata. Do not upgrade to Sol's later `0713ad7` implicitly. Dependency selection is a director/release decision.

## 14. Packaging truth

### Official command behavior

`npm run desktop:build` invokes `tools/build-desktop.js`, which hardcodes:

```text
electron-builder --win
```

On the audit Mac it produced:

```text
dist/desktop/Yellow Beast-0.14.0-beta.1-arm64-win.zip
dist/desktop/win-arm64-unpacked/Yellow Beast.exe
```

Then `npm run desktop:verify` used `process.platform === "darwin"` and searched for a Mac application/archive, failing with:

```text
AssertionError: missing packaged executable or application archive
```

`tools/verify-first-run-artifact.js` separately hardcodes:

```text
dist/desktop/win-unpacked/Yellow Beast.exe
dist/desktop/win-unpacked/resources/app.asar
```

That does not match the Windows ARM64 output directory.

### Direct Mac build diagnostic

`./node_modules/.bin/electron-builder --mac` produced an ARM64 Mac zip, but:

- no valid Developer ID signing identity was available;
- the packaged desktop smoke timed out with `status: null` after preserving its test profile;
- source native y57 separately reported `[data-game-action="PROCEED"]` not hit-testable, even though a direct accessibility click in the visible live audit advanced successfully.

Do not call packaging certified. The builder can produce archives, but the official build/verify chain is internally contradictory.

Packaging is YB-C05/YB-C06 and comes after the agency/personnel repair and verification-baseline decision.

## 15. Live audit trace

The visible source UI was launched with an isolated Chromium data directory:

```bash
./node_modules/.bin/electron desktop/main.js \
  --reference-expedition \
  --user-data-dir=/private/tmp/yb-live-audit-visible
```

Observed flow:

1. Operational Records loaded at v0.14.0-beta.1 / source commit 890300f.
2. Created field file `Pre-1.0 Live Audit`.
3. Clear-Q4 was authorized; Lost, Beck's Desk, and Nullzone were visible but unavailable.
4. Created Matthew Murphy personnel record.
5. Continued to CQ4-REFERENCE-001 briefing.
6. Team/equipment appeared correctly.
7. Advanced through staging and facility approach.
8. Sent STANDARD: `Standard, field team assembled at Threshold Room. Requesting link check.`
9. Standard acknowledgment was received and radio charge decremented.
10. Crossed Threshold explicitly.
11. Utility Room rendered observer-safe field map, fixture, scuffs, and service panel.
12. Submitted the compound fixture/Beverly instruction and reproduced silent clause loss.
13. Quit Electron normally.
14. Relaunched with the same isolated directory.
15. Opened the field file and resumed at T+5 in Utility Room.
16. Fixture inspection remained; photograph/evidence remained absent; team/objective/radio history were intact.
17. Sent the Beverly LOCAL message and reproduced broadcast/respondent chronology confusion.
18. Quit normally.

The environmental observation itself was strong: material, local, uncertain, and free of hidden geometry or developer vocabulary. Preserve that presentation quality while repairing action fidelity.

## 16. Remaining finite closure queue

Work in this order unless Jack explicitly redirects:

1. **YB-C02 — P0 agency correctness:** complete-clause natural-language validation and atomic coordinated execution.
2. **YB-C03 — P0 personnel continuity:** contact and irreversible-death/succession regressions.
3. **YB-C04 — P1 LOCAL truth:** broadcast/addressee/respondent chronology and dialogue identity.
4. **YB-C01/YB-C07 — P0/P1 verification and dependency truth:** external authority review, portable hashes, y75-y78 disposition, clean-install assertions.
5. **YB-C05/YB-C06 — P0/P1 native release path:** coherent Mac/Windows target contract, smoke reliability, build-info isolation.
6. **YB-C08 — P1 human Reference Expedition:** three contrasting full shifts, saves before/during/after, report/omission/contradiction outcomes, break scoring.
7. **YB-C09 — P1 hosted AI proof:** real credentialed isolated interpretation/dialogue/narration plus credit/rate/malformed/failover evidence without secret exposure.
8. **YB-C11/YB-C12/YB-C14 — distribution/security/stranger acceptance.**
9. **YB-C10 — P2 audio authority and perceptual acceptance.**
10. **Final release-candidate rerun** from clean target-platform clones with signed artifacts and zero blockers.

Do not allow later items to pull scope into the first pass.

## 17. Director questions that engineering must not guess

1. Is 1.0 the complete Clear-Q4 Reference Expedition slice with other modes parked, or must other modes ship playable?
2. Does Kane-focused mean internal style guidance only, or may player-facing text explicitly invoke Kane Parsons/Kane Pixels provenance?
3. May verification authority be re-anchored after human review, admitting y75-y78 and removing y33 quarantine?
4. Which Custodian commit is approved for 1.0: `b3738da`, `0713ad7`, or another reviewed ref?
5. Must compound turns be atomic, or can explicitly disclosed partial commits exist?
6. Is LOCAL a broadcast, an addressed channel, or broadcast audibility plus a primary addressee?
7. How characterful must deterministic offline dialogue be?
8. What exact balance of material observation versus labeled institutional interpretation defines the environmental voice?
9. Which Mac and Windows architectures block 1.0?
10. What distribution channel and signing/notarization standard is required?
11. Which hosted providers and usage-limit behavior are supported product surface?
12. Are y34/y35 expectations permanently obsolete or should Coming Soon behavior/copy return?
13. Who qualifies as the stranger tester and what break threshold is acceptable?
14. Which three report outcomes are mandatory for Reference Expedition acceptance?
15. Is audible presentation a 1.0 blocker, and should audio follow only canonical events?

Do not block C02 waiting for these except question 5 if implementation would otherwise introduce partial commits. The conservative default is atomic validation and no mutation.

## 18. Commit and reporting discipline

For every corrective pass:

1. Recheck branch, HEAD, and status.
2. Inspect only the starting files and concrete dependencies.
3. Add the failing test first or reproduce the failure in a focused harness.
4. Implement the smallest authoritative repair.
5. Run focused unit tests.
6. Run focused integration tests.
7. Run y78, y33, the y33 report, conformance, and `git diff --check` when relevant.
8. Run `npm test` and report the inventory failure honestly until governance is approved.
9. Exercise the real renderer for player-visible changes.
10. Verify save/reload.
11. Review the diff for accidental authority duplication, debug language, hidden-state exposure, and player-agency invention.
12. Update `docs/IMPLEMENTATION_STATE.md` only with current evidence; do not overwrite historical sections.
13. Update this handoff or create the next compact handoff with:
    - scope completed
    - authorities changed
    - files changed
    - save/migration impact
    - focused tests
    - historical regressions
    - renderer/manual evidence
    - known defects/deferred features
    - exact launch instructions
    - local commit hash
    - next prerequisites
14. Commit locally with a narrow message.
15. Do not push.

Never report “100%,” “fully playable,” “certified,” or “release-ready” from focused passing tests while the official gate, human specimen, or package gate remains red.

## 19. Required final response from Gemini after C02

Return exactly these facts, with no vague readiness language:

1. Worktree, branch, and before/after commit hashes.
2. Root cause of silent clause loss.
3. Exact new completeness invariant.
4. Canonical authority changed, if any.
5. Every file changed and why.
6. Save-schema or migration impact.
7. Exact focused commands and pass/fail counts.
8. `npm test` result, including unchanged known inventory errors.
9. Exact renderer launch command.
10. Result of the verbatim regression sentence.
11. Canonical interval/evidence/coworker provenance observed.
12. Save/reload result.
13. Provider-failure/presentation-failure result.
14. Any remaining language shapes that clarify rather than execute.
15. Regressions or blockers discovered.
16. Whether C02 is complete by this document's definition.
17. Next single work item.
18. Confirmation that no push, reset, source-worktree mutation, or history rewrite occurred.

## 20. Source audit artifacts

- `docs/audit/PRE_1_0_REPOSITORY_RECONCILIATION.md`
- `docs/audit/PRE_1_0_AUTHORITY_MAP.md`
- `docs/audit/PRE_1_0_FEATURE_AUDIT.md`
- `docs/audit/PRE_1_0_TEST_TRUTH_AUDIT.md`
- `docs/audit/PRE_1_0_CLOSURE_LEDGER.md`
- `docs/audit/PRE_1_0_DIRECTOR_QUESTIONS.md`

Those documents are evidence and constraints, not permission to spend the next pass writing more planning documents. The next deliverable is a tested agency repair.
