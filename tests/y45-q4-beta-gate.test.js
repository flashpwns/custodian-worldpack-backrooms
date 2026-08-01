"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const matrix = require("../docs/q4-beta-caveat-matrix.json");
const betaReport = require("../tools/q4-beta-report");

test("Pass 10 caveat matrix classifies every release-gate item exactly once", () => {
  assert.ok(matrix.items.length >= 12);
  for (const item of matrix.items) assert.ok(matrix.classifications.includes(item.beta_classification), item.identifier);
  assert.equal(new Set(matrix.items.map((item) => item.identifier)).size, matrix.items.length);
  const icon = matrix.items.find((item) => item.identifier === "app-icon-source");
  assert.equal(icon.beta_classification, "A. BETA BLOCKER");
  assert.match(icon.description, /not present/i);
});

test("Q4 session schema is versioned, backward-compatible, and report export is observer-safe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-beta-"));
  const service = new DesktopService({ appDataPath: root });
  const world = service.createWorld({ name: "Beta gate", seed: "beta-gate" }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "beta-gate" });
  assert.equal(started.ok, true);
  const save = JSON.parse(fs.readFileSync(path.join(root, "saves", `${world.id}-field-researcher.json`), "utf8"));
  assert.equal(save.version, 2);
  assert.equal(save.schema, "yellow-beast-session@2");
  assert.equal(service.getDiagnostics().diagnostics.save_schema_version, "yellow-beast-session@2");
  const report = service.exportTesterReport({ world_id: world.id, mode: "field-researcher", note: "offline gate" });
  assert.equal(report.ok, true);
  assert.equal(report.report.provider_status, "offline");
  assert.doesNotMatch(JSON.stringify(report.report), /hidden_trajectory|trajectory identifier|api_key|secret/i);
  assert.ok(fs.existsSync(report.file));
  const reopened = new DesktopService({ appDataPath: root }).resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.projection.q4.mission_record.id, started.projection.q4.mission_record.id);
});

test("Pass 10 settings accept reduced sensory and bounded audio controls", () => {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-settings-")) });
  const updated = service.updateSettings({ settings: { reduced_sensory: true, audio_muted: true, audio_master: 0 } });
  assert.equal(updated.ok, true);
  assert.equal(updated.settings.reduced_sensory, true);
  assert.equal(service.updateSettings({ settings: { audio_master: 2 } }).ok, false);
});

test("requested application icon source is explicit, never silently substituted", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "..", "ASYNC_Logo.webp")), false);
  assert.equal(matrix.items.find((item) => item.identifier === "app-icon-source").decision.includes("do not fabricate"), true);
  assert.equal(betaReport.report({ world: { id: "w" } }).save_schema_version, "yellow-beast-session@2");
});
