"use strict";
const convergence = require("./immersive-convergence");
const phases = require("./mode-phases");
const report = {
  report: convergence.VERSION,
  modes: Object.fromEntries(Object.entries(convergence.PROFILES).map(([mode, profile]) => [mode, profile])),
  shared_world: "yellow-beast-world-history@v1",
  communication_bridges: ["radio", "report", "direct speech", "transferred physical evidence", "institutional process"],
  phase_schema: phases.VERSION,
  offline: true,
  save_reload: true,
  export_import: "canonical world export is supported; application session projections resume locally",
  long_multi_mode_fixture_turns: 100,
  invariants: convergence.invariants()
};
console.log(JSON.stringify(report, null, 2));
