# Yellow Beast desktop application (YB-26)

## Pass 1 architecture

YB-26 uses Electron for the desktop shell. Yellow Beast is already a Node.js
runtime with deterministic file-backed worlds, so Electron adds a mature macOS/
Windows host without a second simulation runtime. Tauri was rejected for this
alpha because it would require a Rust host and a new cross-language bridge;
wrapping the existing CLI in a browser was rejected because it would preserve a
terminal-shaped product boundary.

The host process owns application lifecycle, app-data storage, logging, and the
application service facade. The renderer is presentation-only. It has context
isolation, sandboxing, no Node integration, and no shell or arbitrary filesystem
access. `desktop/preload.js` exposes only explicit asynchronous operations.

The facade in `desktop/service.js` adapts public Yellow Beast runtime APIs for
world management, session lifecycle, safe projections, and structured actions.
It does not create a second simulation or let renderer state become canonical.

## Storage and lifecycle

Canonical worlds retain the runtime's JSON format and are stored below the
platform app-data location (`Application Support` on macOS and `AppData` on
Windows). Desktop-facing friendly names, first-run state, and UI settings live
in separate application metadata files. A friendly name never changes canonical
world identity. API keys are not stored by Pass 1.

First run defaults to Offline / Structured play. The launcher supports creating,
loading, deleting with confirmation, and service-level export/import validation.
Sessions are saved through canonical world/run serializers on actions, transitions,
and clean shutdown. Existing runtime world files load through `world-history`;
the desktop layer does not silently migrate or discard them.

## Contracts

The renderer consumes `yellow-beast-gameplay-projection@v1`,
`yellow-beast-institution-projection@v1`, safe world metadata, and an
allowlisted structured action contract. It never imports private simulation
state. Canonical runtime responses always replace the display after an action.

## Development

`npm run desktop:dev` launches the Electron host. `npm run desktop:test` tests
the application facade without a GUI. `npm run desktop:build` verifies and
stages the shell inputs; native installer work is intentionally deferred to
Pass 4.

## Next pass

Pass 2 replaces the generic safe-projection viewer with separate Beck's Desk,
Clear-Q4, Nullzone Exposure, and Lost surfaces. Pass 3 adds provider settings,
autosave/recovery UX, and polished import/export. Pass 4 handles native
packaging and fresh-machine validation.
