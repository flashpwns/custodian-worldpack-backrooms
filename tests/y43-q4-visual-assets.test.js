"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const visuals = require("../tools/q4-visuals");
const adapters = require("../tools/q4-render-adapters");

function fixture(seed = "visual-assets") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-visual-")) });
  const world = service.createWorld({ name: "Visual Q4", seed }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  assert.equal(started.ok, true);
  return { service, world, projection: started.projection };
}

test("visual registry and state atlas cover ordinary Q4 records with permitted provenance", () => {
  const report = visuals.registryReport();
  assert.ok(report.assets.length >= 8);
  assert.ok(report.assets.every((asset) => asset.rights.includes("permitted") && asset.checksum));
  for (const status of visuals.STATUS) assert.ok(visuals.personnelVisual({ identity: "p", status }).state_asset);
  for (const state of ["operational", "assigned", "carried", "in-use", "intermittent", "damaged", "depleted", "abandoned", "missing", "unknown-condition"]) assert.ok(visuals.equipmentVisual({ type: "field-radio", state }).state_asset);
  for (const type of visuals.MEDIA) assert.ok(visuals.mediaVisual({ type }).asset_id);
  for (const state of visuals.RADIO) assert.ok(visuals.radioVisual(state).asset_id);
  for (const state of visuals.MAP) assert.ok(visuals.mapVisual(state).asset_id);
  for (const type of visuals.DOCUMENTS) assert.ok(visuals.documentVisual(type).asset_id);
});

test("personnel portraits are deterministic archival records and do not encode condition", () => {
  const a = visuals.portrait({ identity: "yb-field-peer-observer", status: "active" });
  const b = visuals.portrait({ identity: "yb-field-peer-observer", status: "deceased" });
  assert.equal(a.asset_id, b.asset_id);
  assert.equal(a.archival, true);
  assert.equal(a.live_condition, false);
  assert.equal(visuals.personnelVisual({ identity: "peer", status: "deceased" }).active, false);
  assert.equal(visuals.personnelVisual({ identity: "peer", status: "missing" }).historical, true);
});

test("capture render specs are structured, observer-safe, and cannot create world effects", () => {
  const spec = visuals.renderSpec({ id: "field-note-1", mission_id: "mission-1", target_observation: "visible corridor", visible_objects: ["survey marker"], device: "recording-device" });
  assert.equal(spec.evidence_id, "field-note-1");
  assert.ok(spec.source_fact_digest);
  assert.doesNotMatch(JSON.stringify(spec), /hidden_trajectory|future escalation|make it scary/i);
  assert.throws(() => visuals.renderSpec({ id: "bad", visible_scene: "hidden_trajectory active" }), /hidden state/);
});

test("offline fallback creates evidence presentation immediately and ComfyUI remains optional", () => {
  const spec = visuals.renderSpec({ id: "field-note-2", target_observation: "observed junction" });
  const queued = adapters.queue(spec, { enabled: false, adapter: "fallback" });
  assert.equal(queued.job.status, "fallback-ready");
  assert.equal(queued.job.result.provenance, "local-deterministic-fallback");
  assert.equal(adapters.health({ enabled: true, adapter: "comfyui" }).status, "not-checked");
  assert.equal(adapters.complete(queued.job).status, "failed");
});

test("recording creates canonical evidence before any optional render and survives reopen", () => {
  const { service, world } = fixture("evidence-record");
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  const recorded = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RECORD" });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.projection.q4.evidence.length, 1);
  assert.ok(recorded.projection.q4.evidence[0].render);
  assert.match(recorded.projection.q4.evidence[0].render.status, /fallback|queued/);
  const reopened = new DesktopService({ appDataPath: service.paths.root }).getGameplayProjection({ world_id: world.id, mode: "field-researcher" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.projection.q4.evidence[0].id, recorded.projection.q4.evidence[0].id);
  assert.equal(reopened.projection.q4.evidence[0].render.job_id ?? reopened.projection.q4.evidence[0].render.id, recorded.projection.q4.evidence[0].render.job_id ?? recorded.projection.q4.evidence[0].render.id);
});

test("visual settings are persisted without exposing credentials or changing canonical state", () => {
  const { service, world } = fixture("visual-settings");
  const saved = service.updateSettings({ settings: { visual_rendering: false, visual_adapter: "comfyui", visual_quality: "documentary", automatic_evidence_rendering: false, retry_failed_renders: true } });
  assert.equal(saved.ok, true);
  assert.equal(service.getSettings().settings.visual_adapter, "comfyui");
  assert.equal(service.getProviderStatus().provider.local_provider.supported, true);
  assert.equal(Object.hasOwn(service.getSettings().settings, "api_key"), false);
  assert.equal(service.loadWorld({ world_id: world.id }).ok, true);
});
