"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const evidence = require("../tools/q4-evidence-authority");
const media = require("../tools/q4-evidence-media");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+ZK6iVwAAAABJRU5ErkJggg==", "base64");
function item(id = "CQ4-MEDIA-01", overrides = {}) { return { id, type:"photographic-record", creator:"operator", custodian:"operator", source_object:"fixture", source_location:"utility-room", source_location_name:"Utility Room", capture_event:"object.evidence.captured", method:"35mm photograph", device_id:"camera-04", device:"CAM-04", captured_at:{ interval:4 }, visible_objects:["fluorescent fixture"], target_observation:"active intact fixture", lighting:"dim fluorescent lighting", provenance:"worldpack-authored-object-interaction", available_to_player:true, available_to_standard:false, ...overrides }; }
function setup({ providers = {}, seed = "evidence-media" } = {}) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-evidence-media-")); const service = new DesktopService({ appDataPath:root, evidenceMediaProviders:providers }); const created = service.createWorld({ name:"Evidence media", seed }).world; const world = service.getWorld(created.id); history.instantiateCharacter(world, { run_id:"setup", identity:"operator", display_name:"Operator", role:"field researcher", authority:"test" }); const run = { run_id:"run-media", session:{ startup:{ player:{ observer_id:"operator" } } }, expedition:{ mission:{ id:"CQ4-MEDIA" }, clock:{ interval:4 }, evidence:[] } }; const record = evidence.capture(world, run, item()); service.saveCanonical(world); return { root, service, world_id:created.id, record }; }
function semantic(record) { const copy = structuredClone(record); delete copy.render_status; delete copy.render_presentation; return copy; }

test("authoritative photographic evidence renders through observer-safe request and reload reuses its artifact", async () => {
  let requests = 0; let received;
  const provider = { render: async (request) => { requests++; received = request; return { mime_type:"image/png", bytes:PNG, model:"test-image-v1" }; } };
  const { root, service, world_id, record } = setup({ providers:{ local:provider } });
  service.updateSettings({ settings:{ visual_adapter:"comfyui", visual_rendering:true } });
  const before = semantic(record); const result = await service.renderEvidence({ world_id, evidence_id:record.id });
  assert.equal(result.ok, true); assert.equal(result.result.success, true); assert.match(received.prompt, /Utility Room/); assert.match(received.prompt, /fluorescent fixture/); assert.doesNotMatch(JSON.stringify(received), /hidden|person visible/i);
  const rendered = service.getWorld(world_id).q4_evidence_archive.records[record.id]; assert.deepEqual(semantic(rendered), before); assert.equal(rendered.render_presentation.status, "ready"); assert.ok(media.artifactAvailable(service.paths.media, rendered.render_presentation.artifact));
  const restored = new DesktopService({ appDataPath:root, evidenceMediaProviders:{ local:provider } }); const resumed = await restored.renderEvidence({ world_id, evidence_id:record.id }); assert.equal(resumed.result.success, true); assert.equal(resumed.result.presentation.status, "ready"); assert.equal(requests, 1); assert.deepEqual(semantic(restored.getWorld(world_id).q4_evidence_archive.records[record.id]), before);
});

test("provider inventions and canonical contradictions cannot write evidence truth", async () => {
  const requests = []; const provider = { render: async (request) => { requests.push(request); return { mime_type:"image/png", bytes:PNG, caption:"person visible in hallway", claims:["person visible in hallway"] }; } };
  const { service, world_id, record } = setup({ providers:{ local:provider }, seed:"invention" }); const world = service.getWorld(world_id); const run = { run_id:"run-two", session:{ startup:{ player:{ observer_id:"operator" } } }, expedition:{ mission:{ id:"CQ4-MEDIA" }, clock:{ interval:5 }, evidence:[] } }; const second = evidence.capture(world, run, item("CQ4-MEDIA-02", { visible_objects:["service sign"], target_observation:"scuffed sign" })); evidence.contradict(world, { left:record.id, right:second.id, claim:"recorded fixture condition", source:"canonical comparison" }); service.saveCanonical(world); service.updateSettings({ settings:{ visual_adapter:"comfyui" } });
  const initial = semantic(service.getWorld(world_id).q4_evidence_archive.records[record.id]); await service.renderEvidence({ world_id, evidence_id:record.id }); await service.renderEvidence({ world_id, evidence_id:second.id }); const archive = evidence.archive(service.getWorld(world_id)); assert.deepEqual(semantic(archive.records.find((entry) => entry.id === record.id)), initial); assert.doesNotMatch(JSON.stringify(archive.records), /person visible in hallway/i); assert.equal(archive.contradictions[0].claim, "recorded fixture condition"); assert.equal(requests.length, 2); assert.doesNotMatch(requests[0].prompt, /service sign/); assert.doesNotMatch(requests[1].prompt, /fluorescent fixture/);
});

test("provider failure, invalid output, offline mode, and retry preserve evidence and expose fallback", async () => {
  let calls = 0; const provider = { render: async () => { calls++; if (calls === 1) throw Object.assign(new Error("timeout"), { code:"RENDER_TIMEOUT" }); return { mime_type:"image/png", bytes:Buffer.from("corrupt") }; } };
  const { service, world_id, record } = setup({ providers:{ local:provider }, seed:"failure" }); service.updateSettings({ settings:{ visual_adapter:"comfyui" } }); const truth = semantic(record);
  let result = await service.renderEvidence({ world_id, evidence_id:record.id }); assert.equal(result.result.success, false); let stored = service.getWorld(world_id).q4_evidence_archive.records[record.id]; assert.equal(stored.render_status, "failed"); assert.deepEqual(semantic(stored), truth);
  result = await service.renderEvidence({ world_id, evidence_id:record.id, retry:true }); assert.equal(result.result.success, false); stored = service.getWorld(world_id).q4_evidence_archive.records[record.id]; assert.equal(stored.render_presentation.request_revision, 2); assert.equal(stored.render_presentation.last_error.code, "RENDER_ARTIFACT_INVALID");
  service.updateSettings({ settings:{ visual_rendering:false } }); result = await service.renderEvidence({ world_id, evidence_id:record.id, retry:true }); assert.equal(result.result.success, false); stored = service.getWorld(world_id).q4_evidence_archive.records[record.id]; assert.equal(stored.render_status, "fallback"); assert.deepEqual(semantic(stored), truth); assert.equal(calls, 2);
  const timed = new media.EvidenceMediaRenderer({ media_root:service.paths.media, timeout_ms:5, providers:{ local:{ render:() => new Promise(() => {}) } } }); const timeout = await timed.render({ world_id, record:stored, settings:{ visual_adapter:"comfyui" }, onPresentation:() => {} }); assert.equal(timeout.code, "RENDER_TIMEOUT");
});

test("duplicate render requests are suppressed and missing stored media degrades to archive fallback", async () => {
  let calls = 0; const provider = { render: async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 15)); return { mime_type:"image/png", bytes:PNG }; } };
  const { service, world_id, record } = setup({ providers:{ local:provider }, seed:"duplicate" }); service.updateSettings({ settings:{ visual_adapter:"comfyui" } }); const [left, right] = await Promise.all([service.renderEvidence({ world_id, evidence_id:record.id }), service.renderEvidence({ world_id, evidence_id:record.id })]); assert.equal(left.result.success, true); assert.equal(right.result.success, true); assert.equal(calls, 1);
  const stored = service.getWorld(world_id).q4_evidence_archive.records[record.id]; fs.unlinkSync(path.join(service.paths.media, stored.render_presentation.artifact.relative_path)); service.startSession({ world_id, mode:"field-researcher", seed:"duplicate" }); const projection = service.getGameplayProjection({ world_id, mode:"field-researcher" }).projection; const projected = projection.q4.archive.records.find((entry) => entry.id === record.id); assert.equal(projected.render_presentation.artifact_available, false); assert.equal(projected.render_presentation.status, "unavailable"); const html = surfaces.render({ ...projection, phase:{ phase_id:"DEBRIEF" } }); assert.match(html, /Unavailable/); assert.deepEqual(semantic(service.getWorld(world_id).q4_evidence_archive.records[record.id]), semantic(record));
});

test("render specification validation rejects hidden context before any provider call", () => {
  const record = { id:"CQ4-HIDDEN", type:"photographic-record", render_spec:{ version:"yellow-beast-q4-evidence-render-spec@v1", source:"canonical-evidence-record", facts:{ evidence_type:"photographic-record", location:"Utility Room", visible_subjects:[], observation:"hidden trajectory", lighting:"dim fluorescent lighting", framing:"field record" } } };
  assert.throws(() => media.validateSpec(record), { code:"RENDER_SPEC_UNSAFE" });
});
