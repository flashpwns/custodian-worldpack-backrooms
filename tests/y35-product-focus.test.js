"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");

function fixture() {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-product-focus-")) });
  return { service, world: service.createWorld({ name: "Product focus", seed: "product-focus" }).world };
}

test("Clear-Q4 is first and playable while the roadmap modes remain visible and locked", () => {
  const { service } = fixture();
  const modes = service.listModes().modes;
  assert.deepEqual(modes.map(({ id }) => id), ["field-researcher", "lost", "async-command", "local-anomaly"]);
  assert.equal(modes.find((mode) => mode.id === "field-researcher").playable, true);
  assert.deepEqual(modes.filter((mode) => mode.id !== "field-researcher").map((mode) => [mode.label, mode.playable, mode.roadmap_status]), [["Lost", false, "Coming Soon"], ["Async: Beck's Desk", false, "Coming Soon"], ["Nullzone Exposure", false, "Coming Soon"]]);
});

test("ordinary player navigation disables roadmap modes without removing their implementations", () => {
  const { service, world } = fixture();
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /value="lost" disabled/);
  assert.match(renderer, /value="async-command" disabled/);
  assert.match(renderer, /value="local-anomaly" disabled/);
  assert.match(renderer, /mode\.playable \? "Enter Clear-Q4" : "Coming Soon"/);
  assert.match(renderer, /mode !== "field-researcher"/);
  for (const mode of ["lost", "async-command", "local-anomaly"]) assert.equal(service.startSession({ world_id: world.id, mode, seed: `implemented-${mode}` }).ok, true, `${mode} remains implemented for development`);
});

