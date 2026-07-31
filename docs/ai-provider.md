# AI provider boundary

YB-13 ships with the deterministic offline mock provider used by tests and `npm run play -- --natural "..."`. No network provider or credentials are required.

Providers expose `interpret({ player_text, context })`. Intent responses are strict `yellow-beast-intent@v1` non-canonical proposals with decomposable steps, unresolved references, uncertainty, and optional observer-safe clarification candidates. Yellow Beast validates every field before any future grounding or action is considered.

The context contains only profile title, scenario, lifecycle, safe location, available verbs, visible aliases, resources, and public reason. It never contains a session, projection, opaque Custodian target reference, hidden actor, or other observer state.

Compound actions run one at a time. Yellow Beast refreshes LOOK/status and revalidates aliases before each next step. Provider output, narration, timestamps, and model identity are noncanonical: saves retain only the deterministic Yellow Beast wrapper plus Custodian export. Replay depends on accepted actions, never prose.

OpenAI is the optional production provider. It uses the official Node SDK and Responses API with `store: false` and strict JSON Schema output; the default low-cost model is `gpt-5.6-luna`, overridable with `YELLOW_BEAST_AI_MODEL`. Set `OPENAI_API_KEY` in the operating-system environment (macOS: launch from a shell with `export OPENAI_API_KEY=...`; Windows PowerShell: `$env:OPENAI_API_KEY='...'`). Requests can incur provider charges. Missing/invalid credentials, network failure, timeouts, rate limits, malformed output, and narration failure execute no unvalidated action and fall back to structured commands plus deterministic narration. Keys are never stored in saves, config, logs, or the artifact.
