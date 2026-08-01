"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

function fixture(seed = "console-acceptance") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-console-")) });
  const world = service.createWorld({ name: "Console acceptance", seed }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" });
  service.confirmQ4Personnel({ world_id: world.id });
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  return { service, world, projection: started.projection };
}

test("Q4 fixed console reserves a bottom communication dock and prevents document scrolling", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  assert.match(renderer, /q4-communications-dock/);
  assert.match(css, /operations-shell\{display:grid;grid-template-rows/);
  assert.match(css, /operations-shell[^}]*overflow:hidden/);
  assert.match(css, /q4-communications-dock \.communication-lanes\{grid-template-columns:repeat\(2/);
  assert.match(renderer, /data-testid="natural-primary"/);
});

test("briefing LOCAL availability agrees with physically present team status", () => {
  const { projection } = fixture();
  const teammate = projection.q4.team[1];
  assert.equal(teammate.contact_category, "LOCAL");
  assert.equal(projection.q4.channels.local.available, true);
  assert.equal(projection.q4.channels.local.target, teammate.first_name);
  assert.equal(projection.q4.channels.local.unavailable_reason, null);
  assert.match(surfaces.render(projection), /LOCAL COMMS/);
  assert.doesNotMatch(surfaces.render(projection), /No personnel are within speaking range/);
});

test("briefing presentation uses institutional prose and hides constitutional labels", () => {
  const { projection } = fixture("briefing-language");
  const html = surfaces.render(projection);
  assert.doesNotMatch(`${projection.scene.narration}\n${html}`, /observer-qualified|objective truth|interpretation|constitutional|MEANINGFUL|engine receipt/i);
  assert.match(html, /Assignment Summary|Current Instructions|Required field kit|Prior Survey Record/);
  assert.match(projection.scene.narration, /Assignment CQ4-/);
});

test("briefing layout contains only prior institutional records, not live field geometry", () => {
  const { projection } = fixture("briefing-map");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.deepEqual(projection.q4.layout.observed_spaces, []);
  assert.deepEqual(projection.q4.layout.observed_connections, []);
  assert.deepEqual(projection.q4.layout.unknown_continuations, []);
  assert.match(renderer, /map\.prior_records/);
  assert.match(renderer, /PRIOR SURVEY RECORD/);
});

test("guidance hide/show is wired to persistent preference and leaves a compact header control", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /data-guidance-dismiss/);
  assert.match(renderer, /guided_introductions:false/);
  assert.match(renderer, /data-guidance-show/);
  assert.match(renderer, /guided_introductions:true/);
  const { service } = fixture("guidance-persistence");
  assert.equal(service.updateSettings({ settings: { guided_introductions: false } }).settings.guided_introductions, false);
  assert.equal(service.getSettings().settings.guided_introductions, false);
});

test("ordinary header uses short mission ID and phase-specific briefing next step", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const { projection } = fixture("header-clarity");
  assert.match(renderer, /shortMissionId/);
  assert.match(renderer, /MISSION \$\{escape\(shortMissionId\(mission\)\)\}/);
  assert.equal(projection.available_actions[0].type, "READY");
  assert.match(surfaces.render(projection), /Review the assignment and assigned team/);
  assert.doesNotMatch(renderer, /MISSION \$\{escape\(mission\.id/);
});
