# AI provider boundary

YB-13 ships with the deterministic offline mock provider used by tests and `npm run play -- --natural "..."`. No network provider or credentials are required.

The desktop also supports a fully local generative provider through Ollama. Select **Local model · Ollama** in Settings. The default is `qwen3.5:9b` at `http://127.0.0.1:11434`; both values can be changed in the same screen. The adapter rejects non-loopback addresses, sends no API key, disables remote storage, and requests schema-constrained JSON from Ollama's native `/api/chat` endpoint. Install Ollama, start its local server, and run `ollama pull qwen3.5:9b` once. Model files then remain on the device.

Local generation and deterministic offline play are separate modes. **Offline deterministic** uses no model. **Local model** uses an on-device model for natural-language interpretation, resolved scene prose, and authorized NPC dialogue. If a local interpretation cannot be reached or validated, the turn fails without mutation. If presentation fails after an accepted canonical action, the committed action remains and Yellow Beast uses its deterministic presentation fallback.

Providers expose `interpret({ player_text, context })`. Intent responses are strict `yellow-beast-intent@v1` non-canonical proposals with decomposable steps, unresolved references, uncertainty, and optional observer-safe clarification candidates. Yellow Beast validates every field before any future grounding or action is considered.

The context contains only profile title, scenario, lifecycle, safe location, available verbs, visible aliases, resources, and public reason. It never contains a session, projection, opaque Custodian target reference, hidden actor, or other observer state.

Compound actions run one at a time. Yellow Beast refreshes LOOK/status and revalidates aliases before each next step. Provider output, narration, timestamps, and model identity are noncanonical: saves retain only the deterministic Yellow Beast wrapper plus Custodian export. Replay depends on accepted actions, never prose.

OpenAI is an optional hosted provider. It uses the official Node SDK and Responses API with `store: false` and strict JSON Schema output; the default model is `gpt-5.6-luna`, overridable with `YELLOW_BEAST_AI_MODEL`. Set `OPENAI_API_KEY` in the operating-system environment (macOS: launch from a shell with `export OPENAI_API_KEY=...`; Windows PowerShell: `$env:OPENAI_API_KEY='...'`). Requests can incur provider charges. Missing/invalid credentials, network failure, timeouts, rate limits, malformed output, and narration failure execute no unvalidated action and fall back to structured commands plus deterministic narration. Keys are never stored in saves, config, logs, or the artifact.
