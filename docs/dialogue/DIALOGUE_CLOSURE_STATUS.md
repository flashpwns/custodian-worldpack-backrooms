# Dialogue closure authority — 2026-10-05

This is the current dialogue readiness statement. Earlier implementation-state entries and acceptance artifacts are historical evidence. Jack’s human Electron test has FAILED the Assembly Table introduction/name exchange. His screenshot (2026-10-05 02:24:16) shows group name questions answered with departed Maxwell’s name, no reply to a correction, and repetition of the wrong answer after a direct plural name question. The prior automated run did not cover this failure. The repair now addresses ordinary names, correction, richer character replies and persistent conversation; current verification and packaging are being completed. Jack’s earlier human verdict remains FAILED until he retests.

## Authority and provenance

- **Reader Phase 2 remains shadow-only.** Legacy production interpretation, deterministic preparse, code-owned facts, response ownership and canonical commit order remain authoritative. No Reader cutover or model authority was enabled.
- **Tonya/Malcolm policy implemented:** Jack’s durable `spoken_address_separate` decision keeps Convention B. The Reader validates spoken Tonya address independently of Malcolm delivery. Code retains chip delivery and a `chip_vs_vocative` diagnostic. Delivery does not supply missing linguistic evidence, including across clauses. The original policy event remains unchanged; a policy decision is not a label.
- **Human primary state:** exactly two saved HUMAN_PRIMARY labels, both fully valid under the frozen inputs. The existing journal and labels remain unchanged. One belongs to the present nine-judgment exception queue; the other belongs to the wider frozen corpus. Old drafts, deferral and commit events are retained without inference.
- **Candidate state:** nine AI-assisted candidates pass full validation. Exactly seven have durable owner ratification, stored as OWNER_RATIFIED_AI_ASSISTED_GOLD with no HUMAN_PRIMARY state and explicitly ineligible for independent benchmark gold. Two Complex candidates (`rg-f95fad9ce8faba79`, `rg-fce6af0e2871cec7`) remain unapproved; both use “So youve been there before? this, complex?” in different contexts. The final checklist surfaces that wording with two recipients. A human Electron observation does not automatically ratify either frozen candidate.
- **Ten-item exception queue:** nine language judgments plus the owner policy item. The policy engineering work is done. Seven owner-ratified AI-assisted interpretations remain distinct from blind labels; one of those also has its separately saved human-primary history. Two subjective candidate decisions remain. No machine label, candidate or approval was converted into HUMAN_PRIMARY or ADJUDICATED_GOLD.
- **Model provenance retained:** 412 earlier valid machine rows stay parked; the later blind Opus run remains 61 annotations (52 valid, nine invalid), distinct from the nine repaired AI-assisted candidates. Existing identities, original validation receipts and approval timestamps are retained. Exact model identity absent from an old author record is not invented. No new model labeling, reviewer run or Teacher Ceiling score was generated here.
- **Formal benchmark / cutover:** no independent ADJUDICATED_GOLD benchmark is established. The frozen Teacher Ceiling requires the original 474-render sample, complete adjudication accounting and at least 300 valid independent adjudicated renders before a formal headline score. Teacher/reviewer provenance, subsequent E4B, calibration/sealed acceptance and production cutover remain separate, uncompleted gates. The historical C2 self-state `today`/`now` scope decision also remains deferred for Reader authority; existing strict validation and legacy production scope are preserved. These requirements govern the experiment and future Reader authority; they do **not** prevent Jack testing the currently authoritative dialogue implementation while Reader stays shadow-only. No threshold, frozen experiment, schema/render input or headline eligibility rule was relaxed.
- Historical evidence and frozen artifacts remain byte-identical. New validator receipts/scores identify `yellow-beast-reader-validator@v2-convention-b`; old scores must not be silently pooled with the repaired implementation.

## Current natural conversation repairs

Open introductions now offer stored background, preferences and canonical employment history without forcing every coworker to recite their assignment. The wordsmith receives temperament-specific guidance and may vary sentence structure and length. A true first-day nervous state is accepted rather than discarded by a mismatched secondary check. In a personal exchange a coworker may share their own established state; the player’s feeling never licenses an invented coworker feeling.

Ordinary combined greetings, plural name/role questions, introduction preambles and corrections of the addressed group are resolved before wording. One code-selected coworker may return a personal check-in. Its inbound question is durable, and its asker acknowledges the player’s answer after cold reload. Conversation recall uses the actual heard question; optional personal facts enter structured hearing memory only when spoken. The complete speech history remains available.

These repairs do not establish a one-in-a-million misunderstanding rate or prove Jack finds the voices human. His judgment of conversational substance, variation and continuity remains the final acceptance gate. Unaddressed remarks retain the established silence policy.

## Engineering and verification

The table below currently preserves the previous f873e49 verification evidence; it will be replaced by the stable repair run and current packaged verification before handoff.

The initial 67 verification-inventory errors were repaired without dropping tests or changing verifier core, existing quarantine/tier authority or required reports. The four existing quarantines remain: V03 world-save equivalence (`y33`), historical UI expectations (`y34`, `y35`) and native settings display (`y54`). Reported tier totals cover the included authority set; this dialogue test readiness is not broader release certification. See `../../verification/DIALOGUE_INVENTORY_RECONCILIATION.md` for the classifications and reviewed expectation changes.

A rejected substantive introduction containing an invented rationale gets one bounded rewording with the same owner, canonical facts and contribution plan. Both candidates face the validators; neither commits before acceptance, and a second failure uses the same-plan fallback. This preserves valid personal content without making employment dates imply motives or competence. Exact stored preference and trade assertions also accept bounded conversational phrasing (including a hedged preference), with whole-clause matching that rejects added claims. A licensed reciprocal wellbeing question may include both its verb and current-time wording; it still cannot ask an unrelated question.

Returning coworkers now inherit a durable personnel dialogue profile archived at the canonical assignment boundary. Their own direct Complex-side field observations can advance previously absent expedition/Complex experience to “some”; hearsay, roster membership and another person’s observations cannot. Completed shared operations establish working familiarity. Cold world reload and later reassignment retain profile identity, temperament, memories and earned experience. Institutional operation counters do not prove elapsed calendar time, so this does not fabricate tenure, mature skills, or a new personality.

Runtime repairs prevent a failed input’s follow-up drain from creating an empty canonical queue, isolate frozen coworker task projections from mutable canonical tasks, and keep LOCAL fallback speech free of provider diagnostics. Older LOCAL test callers now await actual responder completion. Frozen evaluation files remain unchanged. The current engineering regression applies twelve exact, hash-pinned scenario amendments plus a separately sealed full-corpus edition (136 changed characterization turns, six round-trip diagnostics and four shadow rows); every unlisted historical field stays enforced. The frozen experiment is reproduced from its last verified immutable source, while a separate 944-occurrence current-service replay enforces the revised engineering edition. This is not a Teacher Ceiling amendment, benchmark gold or cutover evidence. See `../acceptance/dialogue-natural-conversation/README.md`.

| Gate | Result |
| --- | --- |
| Inventory / verifier core | Zero inventory errors or warnings; protected core integrity passes |
| `npm run test:meta` | 33/33 tests pass |
| `npm run test:fast` | 143/143 tests pass |
| Focused runtime repair suites | 40/40 tests pass |
| Focused Reader / dialogue / governance | 158/158 plus 35/35 tests pass |
| Focused long-world fixture repairs | 55/55 tests pass |
| `npm test` canonical aggregate | 1,449/1,449 tests pass; zero failures, cancellations or skips; corpus-context-closure, stranger-flow and replayability reports pass |
| `npm run test:long-world` | 198/198 tests pass; long-world-torture report passes |
| `npm run test:native` | 1/1 real Electron renderer test passes; all three required native commands execute successfully |
| macOS ARM64 `npm run desktop:build` | Successful source build, including settings and first-run rebuilds; no Developer ID signing/notarization (embedded Electron executable is ad hoc signed) |
| Packaged source vs checkout / commit | Key Reader/dialogue source is byte-identical. The final handoff rebuild binds the package to committed HEAD; the launch preflight refuses stale HEAD or source bytes |
| Jack’s official Electron dialogue acceptance | **FAILED — Assembly Table names and repair; other steps not established by this screenshot** |

Native verification is automated evidence, not Jack’s observation or an ordinary-play certificate. It uses isolated profiles and asserts production-profile preservation. The checklist launch uses the normal packaged application with no injected state. Its preflight requires the current source revision (allowing only subsequent documentation-only commits) and byte-identical key dialogue source, then captures package/source provenance alongside Jack’s explicit observations.

## Remaining human work

After engineering verification and the current rebuild, Jack must repeat human acceptance, including the failed name exchange, a natural five-turn conversation with distinctive voices, and follow-ups after reopening. His subjective judgment on the two Complex interpretations is surfaced in step 3. No result is preselected or signed on his behalf. Future independent benchmark creation and Reader cutover remain explicitly uncompleted and out of current implementation authority.

```sh
cd /Users/jacktr/Developer/custodian-worldpack-backrooms
node tools/dialogue-final-human-test.js
```

The launch command opens the packaged ARM64 app and one local PASS/FAIL/NOT TESTED checklist. Follow `FINAL_HUMAN_ACCEPTANCE.md`: Maxwell cutoff inquiry; introduction / team inspection; direct-experience and two Complex questions; nervous observation / sarcasm; group carrying; ambiguity / silence; presentation order and cold-resume continuity. Receipts are local gitignored observations, never Reader labels or benchmark gold.
