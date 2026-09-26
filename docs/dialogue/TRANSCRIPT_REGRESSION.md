# Dialogue tools: REPL, transcripts, replay (ED-30)

These are developer tools. They drive the **real production dialogue service** (`desktop/service.js`)
headlessly. Nothing in them stubs interpretation, planning, validation or commit; only the wording
provider can be swapped. None of them ship any player-facing surface.

## Talk to the coworkers from a terminal

```bash
npm run dialogue:repl -- --trace
```

Options:

- `--provider fallback|real|garbage|throwing` (default `fallback`).
  - `real` launches the pinned llama.cpp runtime with the bundled model, using the same arguments the
    in-app appliance uses.
  - `--endpoint http://127.0.0.1:PORT` reuses a runtime that is already running.
- `--seed S`
- `--names Giselle,Malcolm,Tonya` renames the coworkers in slot order.
- `--no-brief` stays before Maxwell's briefing.
- `--save <app-data folder> --world <world id>` resumes an existing save, for example a copy of your
  Electron profile.
- `--script file.txt` runs non-interactively, one line per turn.

Commands inside the REPL:

| Command | What it does |
| --- | --- |
| `:trace on\|off\|full` | Show a one-line frame summary per turn, hide it, or print the full developer trace. |
| `:why` | Print the full developer trace of the last turn. |
| `:state` | Print the dialogue information state: requests, activity, active speaker, acquaintance. |
| `:brief` | Run Maxwell's briefing. |
| `:action NAME` | Submit a structured action. |
| `:export file.jsonl` | Save the conversation as a replayable transcript. |
| `:quit` | Leave the REPL. |

## Turn a bad playthrough into a failing test (one step)

1. **Export the conversation.**
   - In the Electron app, start with `YELLOW_BEAST_DEVELOPER_MODE=1`, then call this from DevTools:
     `await yellowBeast.exportDialogueTranscript({ world_id })`. It writes a JSONL file to the app's
     `logs/dialogue-transcripts/` folder and returns its path.
   - In the REPL, use `:export file.jsonl`.
2. **Mark what should have happened.** Every turn carries:
   - `observed`: what the engine did;
   - `expect`: a copy of `observed`;
   - `trace`: the developer trace.

   In the turn that went wrong, edit `expect` to the intended behaviour. Examples: `owners` → `["Tonya"]`,
   `predicate` → `"person.complex_experience"`, `clarify` → `true`. You can also add wording guards:
   - `"forbid": ["Tonya'?s doing"]`: no NPC line may match these;
   - `"lines": [{ "speaker": "Tonya", "match": "never", "not": "years" }]`: checks on one speaker's lines.

   Expectations are frame fields, never exact wording, so the same file holds for any provider.
3. **Drop the file into `tests/fixtures/ed30/transcripts/`.** The ED-30 suite replays every transcript
   there (`tests/ed30d-properties-independence.test.js`, "I6 transcript regressions"). The edited turn
   fails until the engine behaves as expected.

To replay one transcript by hand:

```bash
npm run dialogue:replay -- tests/fixtures/ed30/transcripts/human-trace-f1-f12.jsonl
```

- `--provider garbage` replays with broken wording. The result must be the same, because semantics do
  not depend on the wording provider.
- `--update` re-baselines every `expect` to the current behaviour. Review the diff before committing it.

### What a replay reproduces

The transcript header records:

- the world seed;
- the scenario;
- the player's name;
- the coworkers' names and generated profiles.

A replay creates a fresh world from that seed and renames the coworkers to match. Before each turn it
reaches the recorded opener beat with the same structured actions: `LOCAL_INTRODUCTIONS` is reached by
running the briefing. A turn recorded at a beat the replay cannot reach is reported as `SKIP` and never
passes silently.

## Other tools

- `npm run dialogue:eval -- tests/fixtures/ed30/dev-corpus.jsonl [--failures] [--json]` scores a
  labelled corpus: speech act, addressee, predicate, relation, cardinality, temporal scope, clarify rate
  and confident-wrong rate.
- `npm run dialogue:fuzz -- [--seed N] [--sessions N] [--turns N] [--provider garbage|fallback|leaky]`
  runs seeded random-walk conversations through the service and checks the J13 invariants after every
  turn.
  - The invariants: no third-party private state, contract-valid lines, no dropped questions, ledger
    consistency, append-only player lines, no world mutation from talk, procedure only by rule.
  - It reports the seed, session and turn of any violation so the case can be pinned as a test.
