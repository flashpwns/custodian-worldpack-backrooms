# YB-33 stranger test

`npm run stranger-flow-report` is the deterministic automated stranger flow.
It starts with an empty application, creates one named world, enters a
mode-specific experience, follows the Guided Introduction, submits a natural
language observation offline, checks the result and `What do I know?` recap,
saves and resumes, exercises provider failure and accessibility preferences,
and confirms all four mode surfaces remain player-facing.

## Manual beta checklist

1. Launch the packaged app with no existing application data. Confirm the
   World Library explains what a world is and offers Create world without a
   terminal, repository, or developer vocabulary.
2. Create a named world. Confirm each starting experience explains its play
   style, the selected experience opens directly, and Guided Introduction is
   visible when enabled.
3. Follow the introduction, type a natural-language attempt, and confirm the
   result appears in the scene with a clear status. Hide the introduction and
   confirm it does not change the world.
4. Open `What do I know?` and verify it explains only the current experience's
   context. Leave, reopen, and confirm the world and mode resume without
   advancing time or restoring a pending request.
5. In Settings, try Offline / Structured, high contrast, Extra large text,
   reduced motion, and Guided Introductions. Confirm each preference is named,
   saved, and reversible. With language assistance unavailable, confirm the
   app explains that offline play remains available.
6. Repeat mode entry for Clear-Q4, Beck's Desk, Nullzone, and Lost. Confirm
   the surfaces feel distinct, natural input remains primary, and no IDs,
   debug panels, hidden taxonomy, or implementation terms appear.

The checklist deliberately tests comprehension and recovery, not simulation
internals. Any blocked step is a public-beta defect until it is explained in
the player surface or made unnecessary.
