# AI provider boundary

YB-13 ships with the deterministic offline mock provider used by tests and `npm run play -- --natural "..."`. No network provider or credentials are required.

Providers expose two asynchronous methods: `interpret({ player_text, context })` and `narrate({ envelope, tone })`. Intent responses are strict objects with `kind`, `actions`, and optional observer-safe clarification candidates. Yellow Beast validates every field, verb, and alias against a freshly built safe context before any action is attempted.

The context contains only profile title, scenario, lifecycle, safe location, available verbs, visible aliases, resources, and public reason. It never contains a session, projection, opaque Custodian target reference, hidden actor, or other observer state.

Compound actions run one at a time. Yellow Beast refreshes LOOK/status and revalidates aliases before each next step. Provider output, narration, timestamps, and model identity are noncanonical: saves retain only the deterministic Yellow Beast wrapper plus Custodian export. Replay depends on accepted actions, never prose.

Future providers use environment variables such as the placeholders in `.env.example`. Keep keys out of the repository, logs, and saves. Provider failures, malformed responses, and missing configuration fall back to structured commands and deterministic plain-text narration.
