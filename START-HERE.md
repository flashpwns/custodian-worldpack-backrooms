# START HERE — Yellow Beast Alpha

Launch **Yellow Beast.command** on macOS or **Yellow Beast.bat** on Windows. The recommended mode is **Async: Clear-Q4 — PLAYABLE ALPHA**.

Use structured commands such as `LOOK`, `MOVE`, `INSPECT fixture-1`, `USE`, `SAVE`, and `QUIT`. You can also enter ordinary language; the bundled **Offline Interpreter** converts only currently valid actions and works without a network connection or API key.

OpenAI mode is optional. Set `OPENAI_API_KEY`, then set `YELLOW_BEAST_AI_PROVIDER=openai` (and optionally `YELLOW_BEAST_AI_MODEL=gpt-5.6-luna`) in your operating-system environment before launching. It may incur provider charges and falls back to the Offline Interpreter if unavailable. Never put a key in a save or inside the app folder.

Saves, configuration, and launcher logs live outside the app:

- macOS: `~/Library/Application Support/Yellow Beast/`
- Windows: `%APPDATA%\Yellow Beast\`

To resume, relaunch Yellow Beast and accept the **Resume saved Async: Clear-Q4 run?** prompt. Current alpha limits: only Async: Clear-Q4 is fully playable; other modes are experimental; RECORD, COMMUNICATE, and WAIT are unavailable. If startup fails, check `logs/launcher.log` in the application-data folder. This is an unofficial fan project, not affiliated with Kane Pixels.
