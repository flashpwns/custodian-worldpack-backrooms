"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const history = require("./world-history");
const convergence = require("./canon-convergence");
const echoes = require("./consequence-echoes");
function report() {
  const fixture = convergence.fixture("yb32-echoes"); const before = JSON.stringify(fixture.world); const profiles = ["field-researcher", "async-command", "local-anomaly", "lost"];
  const views = Object.fromEntries(profiles.map((profile) => [profile, echoes.observerView(fixture.world, profile)]));
  for (let turn = 0; turn < 150; turn += 1) echoes.observerView(fixture.world, profiles[turn % profiles.length]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb32-echoes-")), "world.json"); history.saveWorld(file, fixture.world); const restored = history.loadWorld(file);
  return { version: "yellow-beast-consequence-echo-report@v1", fixture_turns: fixture.turns, canonical_events: fixture.world.events.length, indexed_events: echoes.build(fixture.world).events.length, profiles: Object.fromEntries(Object.entries(views).map(([profile, view]) => [profile, { echo_kinds: view.echoes.map(({ kind }) => kind), echo_count: view.echoes.length, implicit_continuity: view.implicit_continuity }])), save_reload_equivalent: JSON.stringify(echoes.observerView(restored, "local-anomaly")) === JSON.stringify(echoes.observerView(fixture.world, "local-anomaly")), read_only: JSON.stringify(fixture.world) === before, continuity: { one_recorder_identity: Object.keys(fixture.world.artifacts).filter((id) => id === fixture.recorder_id).length, dead_character_status: fixture.world.characters["convergence-researcher"].status, object_recovery_events: fixture.world.events.filter((event) => event.type === "artifact.recovered").length }, safety: echoes.reportSummary(fixture.world).invariants };
}
console.log(JSON.stringify(report(), null, 2));
