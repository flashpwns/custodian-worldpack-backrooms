# Development workflow

YB-31 Pass 1 establishes developer tooling as read-only inspection over the
existing Yellow Beast world and observer APIs. It is never a save format,
canonical authority, or player path.

## Everyday commands

- `npm run dev:check` — fast local guard: asset validation, focused YB-30/YB-31
  tests, desktop service tests, and whitespace check.
- `npm run validate` — full regression (`npm test`) plus desktop staging build.
- `npm run reports` — grouped canon, world, mode, player, and developer reports.
- `node --test tests/y31-dev-workflow.test.js` — one test file. Milestone
  families use `tests/y29-*.test.js`, `tests/y30-*.test.js`, and onward.
- `npm run <name>-report` — run one report directly.

CI currently requires asset validation and conformance everywhere; the package
workflow additionally builds native archives when desktop/tools/package inputs
change. Native packaging is not an inner-loop check: use `npm run
desktop:package -- --mac zip` or `--win zip` for distribution work.

## Reproduction and inspection

Use a seed with the normal API path, for example `node tools/play.js --profile
field-researcher --seed <seed> --natural <text>`. Record the commit, world
seed, mode, observer, phase, recent player actions, provider/offline state,
and a save/export when reporting a failure.

`tools/dev-inspection.js` has two derived helpers for developer code and the
future console: `snapshot(world)` separates **objective** world inspection from
the four filtered **observer views**; `intentTrace(...)` stops after context,
interpretation, grounding, and planning. Neither writes a world, executes a
consequence, accepts a provider secret, or creates a save. The deterministic
150-turn, all-mode fixture is `tools/canon-convergence.js#fixture(seed)`.

Provider diagnosis may record configured/offline status, safe-context size,
fallback reason, validation result, and stale-response discard. Never log an
access key, raw credentials, or a player-facing hidden-state dump.

## Authoring map

| Change | Primary locations |
| --- | --- |
| Source / intake | `canon/source-registry.json`, `intake/records/`, `tools/register-source.js` |
| Claim / review | `canon/claims/`, schemas in `canon/`, `create-claim-stub`, `link-claims`, `promote-review` |
| Runtime authority | `data/runtime-traceability.json`, `tools/*-world.js` |
| Scenario / profiles | `scenarios/`, `profiles/` |
| Player presentation | `tools/*-experience.js`, `scene-presentation.js`, `desktop/renderer/` |
| Regression invariant | focused test plus the relevant `*-report.js` |

`tests/validate-assets.js` is an intentionally strict executable inventory.
When adding an intentional script, register it in its explicit `scripts` list;
do not weaken or bypass the inventory.

## YB-31 queue

Pass 2 builds a developer console from the separated snapshot; Pass 3 adds
focused commands, trace bundles, and report consistency; Pass 4 improves
authoring ergonomics; Pass 5 profiles long-world/render/save hotspots; Pass 6
cleans up only seams proven by those passes.

Pass 2 is now available locally with `YELLOW_BEAST_DEVELOPER_MODE=1 npm run
desktop:dev`. See [developer console](developer-console.md). It is read-only;
Pass 3 adds [developer commands](developer-commands.md): `npm run dev -- help`
lists explicitly classified read-only inspection/report commands and isolated
simulation-driving reproduction/fixture commands. Both console and CLI consume
the same derived inspection service.

Pass 4 adds the [canon-safe authoring map](authoring.md). `npm run authoring-report`
and `npm run dev -- author validate` check existing source, claim, authority,
runtime, domain, and asset boundaries without authoring a world or content fact.
