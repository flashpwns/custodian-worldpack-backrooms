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

## Play surfaces

The shared play shell routes by stable mode ID and uses a compact capability map
rather than four separate engines. Shared renderer code handles world identity,
projection refresh, valid safe target choices, canonical result feedback, and
keyboard-accessible action controls. Renderer-local state is limited to display
selection and form state; objectives, inventory, tasks, and world state always
come from a fresh canonical projection.

Beck's Desk presents an institutional task tray, reports, personnel, research,
infrastructure, budget, and an intentionally non-omniscient known-Complex
summary. Clear-Q4 is a field terminal for objectives, surroundings, route
fragments, known risk, team, equipment, communications, and evidence. Nullzone
is organized around a civilian base, personal archive, questions, route memory,
preparation, and current excursion. Lost remains deliberately sparse: immediate
surroundings, remembered route fragments, light, carried items, and only
observer-recognized callbacks.

All panel content is derived from the existing safe gameplay or institution
projections. The renderer cannot infer a callback, reveal a hidden route, or
turn a UI action into a command string. Structured labels and targets are
presentation-only mappings of the bridge contract. Shared typography, spacing,
status, panel, and focus tokens give the four restrained mode identities a
coherent accessible foundation.

## Development

`npm run desktop:dev` launches the Electron host. `npm run desktop:test` tests
the application facade without a GUI. `npm run desktop:build` verifies and
stages the shell inputs; native installer work is intentionally deferred to
Pass 4.

## Next pass

Pass 3 adds provider settings, autosave/recovery UX, polished import/export,
and usability hardening. Pass 4 handles native packaging and fresh-machine
validation. A YB-28 candidate is profiling large timeline/projection composition
before adding richer archived-history views.
