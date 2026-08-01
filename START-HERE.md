# START HERE — Yellow Beast Alpha

Launch **Yellow Beast.command** on macOS or **Yellow Beast.bat** on Windows. The recommended mode is **Async: Clear-Q4 — PLAYABLE ALPHA**.

Use natural actions such as `Inspect the fluorescent fixture`, `Test the light`, `Photograph the scuffs`, `Mark this route`, or `Open the panel`. Structured `LOOK`, `MOVE`, `INSPECT`, `TEST`, `PHOTOGRAPH`, `MARK`, `OPEN`, `CLOSE`, `RECORD`, `USE`, `SAVE`, and `QUIT` controls are also available when context permits. The bundled **Offline Interpreter** selects only currently visible authored actions and works without a network connection or API key.

OpenAI mode is optional. Set `OPENAI_API_KEY`, then set `YELLOW_BEAST_AI_PROVIDER=openai` (and optionally `YELLOW_BEAST_AI_MODEL=gpt-5.6-luna`) in your operating-system environment before launching. It may incur provider charges and falls back to the Offline Interpreter if unavailable. Never put a key in a save or inside the app folder.

Saves, configuration, and launcher logs live outside the app:

- macOS: `~/Library/Application Support/Yellow Beast/`
- Windows: `%APPDATA%\Yellow Beast\`

To resume, relaunch Yellow Beast and accept the **Resume saved Async: Clear-Q4 run?** prompt. Current alpha limits: only Async: Clear-Q4 is fully playable; other modes are experimental; the authored interaction content is a compact Utility Room/threshold slice rather than a complete scenario. If startup fails, check `logs/launcher.log` in the application-data folder. This is an unofficial fan project, not affiliated with Kane Pixels.
