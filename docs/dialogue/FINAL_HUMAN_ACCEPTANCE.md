# Jack’s official final Electron dialogue acceptance

**Human test failed on 2026-10-05:** the Assembly Table names/repair exchange failed; engineering repairs now include richer personal replies, ordinary name/role questions, reciprocal conversation and persisted follow-ups. Engineering and packaged verification passed at ca7801d, including durable coworker experience across reassignment. Jack’s retest is still required. Do not treat the earlier automated green run as a human PASS.

Launch from this checkout:

```sh
cd /Users/jacktr/Developer/custodian-worldpack-backrooms
node tools/dialogue-final-human-test.js
```

This opens the ARM64 packaged Yellow Beast app and one local checklist. Test a fresh Day 1 operation as Jack using normal controls and the configured language provider. No smoke flags, injected state, scripted inputs or test profile are used. Do not overwrite an existing operation. No observations are prefilled. Choose PASS, FAIL or NOT TESTED for each row, then save. Failure and untested rows require notes. Receipts are append-only files in the gitignored `.agent-notes/dialogue-final-human-acceptance/`; press Ctrl-C in the terminal after saving. Repeating the command makes a separate run.

The seven ordered steps are:

1. During Maxwell’s briefing, ask **“What is the schedule and cutoff time?”**; finish normally.
2. At the Assembly Table, inspect the team; say **“Hello and goodmorning, everyone.”**, ask **“What're everyone's names?”**, then **“Well yes, but I mean everyone at the table, here.”** Select one coworker and ask **“WHAT ARE YOUR NAMES?”** Clear the selection and say **“I’m Jack.”** in LOCAL. Talk naturally for five turns: ask about them, follow up on something they actually said, and share how you feel. Judge substance and differences between their voices.
3. Select the doctor: **“Have you been inside the Complex before?”** then **“So youve been there before? this, complex?”** Repeat the latter with the field technician selected.
4. Select a coworker: **“You look nervous.”** Clear the recipient: **“Well, this seems incredibly safe.”**
5. Address the group: **“What are you all carrying?”**
6. Say **“You know the thing by the thing?”**; then leave the composer empty and wait without submitting.
7. Watch presentation and ordering throughout; quit normally, reopen and resume to inspect continuity. Ask **“What were we talking about?”** and follow up on something a coworker previously told you. Judge whether it feels like the same conversation.

The checklist records observations without showing frozen Reader candidate wires or expected resolver answers. The two unapproved AI-assisted Complex interpretations remain unapproved. Testing those utterances supplies subjective implementation observations; it does **not** silently approve the frozen candidates or create blind labels. Any later explicit candidate approval must retain its AI-assisted owner-ratification provenance.

## Reviewer criteria (after Jack records his run)

Use the established acceptance law, not improvised expected answers. Maxwell’s current authored briefing handles free-form inquiries through its existing bounded deflection; do not demand a new fact disclosure. Direct personal questions should be grounded in the addressed person’s own knowledge; observations and sarcasm should not produce unrelated equipment instructions. Group carrying questions use code-owned response order and actual holdings. Ambiguity should clarify instead of guessing. Silence creates neither an empty player event nor a fabricated player utterance. The visible roster is exactly player plus three coworkers. Submitted player words precede responder generation and committed replies; normal LOCAL speech remains in the right comms rail. Spoken responses expose no AI/LLM/provider identifiers and cannot create actions or facts. Restart preserves canonical speech order and team membership.

Sources: `tests/y106-physical-maxwell-briefing.test.js`, `tests/ed1-dialogue-discourse.test.js`, `tests/ed24-freeze-invariants.test.js`, `tests/ed25-human-acceptance-dialogue.test.js`, `tests/y109-local-coworker-dialogue-runtime.test.js`, `tests/y111-local-group-dialogue-pass.test.js`, and the Reader shadow inertness suites.

A saved all-PASS receipt means Jack explicitly reported those seven observations. It does not automatically modify implementation state, promote Reader authority, assert independent benchmark gold, or certify broader ordinary play. Failures require engineering follow-up. The authoritative readiness statement is `DIALOGUE_CLOSURE_STATUS.md`.
