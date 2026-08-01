"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const evidence = require("../tools/q4-evidence");

function fixture(seed = "async-interface") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-interface-")) });
  const world = service.createWorld({ name: "ASYNC interface", seed }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  assert.equal(started.ok, true);
  return { service, world, projection: started.projection };
}

test("boot and title/access surfaces identify the unofficial ASYNC field system", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../desktop/renderer/index.html"), "utf8");
  assert.match(renderer, /data-testid=.*async-boot/);
  assert.match(renderer, /Skip initialization/);
  assert.match(renderer, /YB_TEST_BYPASS_BOOT|bypass-boot/);
  assert.match(renderer, /ASYNC · FIELD OPERATIONS SYSTEM/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("Clear-Q4 retains the fixed operational information order", () => {
  const { projection } = fixture();
  const html = surfaces.render(projection);
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  assert.match(renderer, /async-system-header/);
  assert.match(renderer, /async-operations-layout/);
  assert.match(renderer, /compactLayout/);
  assert.match(html, /local-comms/);
  assert.match(html, /standard-comms/);
  assert.match(css, /grid-template-columns:220px minmax\(0,1fr\) 230px/);
  assert.match(css, /operations-shell[^}]*overflow:hidden/);
  assert.ok(projection.q4.mission_record.id);
  assert.match(projection.q4.operational_time, /^T\+/);
  assert.ok(projection.q4.player.name);
  assert.ok(projection.q4.team.length);
  assert.ok(projection.q4.equipment.required.length);
});

test("briefing, equipment, radio, personnel, and map surfaces remain observer-safe", () => {
  const { service, world, projection } = fixture("interface-surfaces");
  const html = surfaces.render(projection);
  assert.match(html, /Assignment/);
  assert.match(html, /Required field kit/);
  assert.match(html, /TEAM STATUS|Assigned team/);
  assert.match(html, /LOCAL COMMS/);
  assert.match(html, /STANDARD/);
  assert.doesNotMatch(html, /charges|durability|rarity|HP/);
  assert.doesNotMatch(JSON.stringify(projection), /hidden_trajectory|latent_condition|X_FACTOR|ESCALATION LEVEL/i);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true);
  const staging = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(staging.phase.phase_id, "STAGING");
  assert.match(surfaces.render(staging), /FIELD KIT|Required field kit/);
});

test("layout projection preserves observation distinctions without hidden state", () => {
  const { service, world } = fixture("interface-map");
  for (const action of ["READY", "PROCEED", "APPROACH", "CROSS"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.ok(projection.q4.layout.observed_spaces.length);
  assert.ok(projection.q4.layout.unknown_continuations.length);
  assert.equal(Object.hasOwn(projection.q4.layout, "hidden_trajectory"), false);
  assert.doesNotMatch(JSON.stringify(projection.q4.layout), /unseen|exact position|trajectory|latent/i);
});

test("evidence adapter is local, deterministic, provenance-bearing, and generation-independent", () => {
  const facts = evidence.observerSafeCaptureFacts({ visible_scene: "a lit field location", device: "manual 35mm camera", media: "film" });
  const fallback = evidence.fallbackCapture(facts);
  const request = evidence.generationRequest(facts);
  assert.equal(fallback.status, "fallback");
  assert.equal(request.status, "not-requested");
  assert.equal(request.fallback.provenance, "local-deterministic-fallback");
  assert.throws(() => evidence.observerSafeCaptureFacts({ visible_scene: "hidden trajectory escalation" }), /hidden state/);
  assert.throws(() => evidence.generationRequest({ visible_scene: "unrevealed symptoms" }), /hidden state/);
});

test("visual asset registry contains only explicit local permitted assets", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/visual-asset-provenance.json"), "utf8"));
  assert.ok(registry.assets.length >= 4);
  assert.ok(registry.assets.every((asset) => asset.rights_status.includes("permitted")));
  assert.deepEqual(registry.prohibited.sort(), ["downloaded video stills", "scraped canon frames", "unlicensed logos", "remote visual assets"].sort());
});
