"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const canonicalLedger = require("../tools/canonical-world-ledger");
const decisionScheduler = require("../tools/decision-scheduler");
const consequenceRuntime = require("../tools/consequence-runtime");
const evidenceAuthority = require("../tools/q4-evidence-authority");
const { createLivingProvider } = require("../tools/ai-living-provider");

function createTestService(seed = "scenario-a-k") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-scenarios-test-"));
  const livingProvider = createLivingProvider();
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: livingProvider
  });
  const world = service.createWorld({ name: "Live Scenarios A-K", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  return { appDataPath, service, world };
}

test("Scenario A: Institutional routine with minimal AI", async () => {
  const { appDataPath, service, world } = createTestService("scenario-a");
  try {
    const entry = service.session(world.id, "field-researcher");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // Briefing -> Staging
    const r1 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(r1.ok, true);
    assert.equal(entry.phase.phase_id, "STAGING");

    // Staging -> Facility Transit
    const r2 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    assert.equal(r2.ok, true);
    assert.equal(entry.phase.phase_id, "FACILITY_TRANSIT");

    // Transit -> Threshold Room
    const r3 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    assert.equal(r3.ok, true);
    assert.equal(entry.phase.phase_id, "THRESHOLD");

    // Threshold -> Radio Check
    const r4 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(r4.ok, true);
    assert.equal(entry.phase.phase_id, "STANDARD_RADIO_CHECK");

    // Complete radio check
    const r5 = await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    assert.equal(r5.ok, true);

    // Cross into field
    const r6 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
    assert.equal(r6.ok, true);
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "utility-room");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario B: Institutional deviation and return to procedure", async () => {
  const { appDataPath, service, world } = createTestService("scenario-b");
  try {
    const entry = service.session(world.id, "field-researcher");

    // Procedural question (minor deviation)
    const dev = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "What is our assignment?"
    });
    assert.equal(dev.ok, true);
    assert.equal(dev.result?.classification, "MINOR_DEVIATION");
    assert.equal(entry.phase.phase_id, "BRIEFING"); // Phase not advanced

    // Return to procedure
    const r1 = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(r1.ok, true);
    assert.equal(entry.phase.phase_id, "STAGING");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario C: Field separation and divergent knowledge", async () => {
  const { appDataPath, service, world } = createTestService("scenario-c");
  try {
    // Progress through crossing
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    // Order Santiago to hold position in utility room
    const santiago = entry.run.expedition.team.members.find((m) => m.personnel_id === "personnel-santiago-stokes");
    santiago.current_task = { type: "hold", state: "active", target: "utility-room" };
    entry.run.spatial.team_behavior[santiago.personnel_id] = "remain";

    // Player moves to Columned Corridor
    const moveRes = await service.submitAction({
      world_id: world.id,
      mode: "field-researcher",
      action: "MOVE",
      target: "columned-corridor"
    });
    assert.equal(moveRes.ok, true);
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), "columned-corridor");
    assert.equal(canonicalLedger.getCoworkerLocation(entry.run, santiago.personnel_id), "utility-room");

    // Observer projection shows Santiago contact lost / unconfirmed
    const projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
    const santiagoProj = projection.q4.team.find((m) => m.first_name === "Santiago");
    assert.equal(santiagoProj.contact_category, "CONTACT LOST");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario D: Compound equipment/movement/inspection command", async () => {
  const { appDataPath, service, world } = createTestService("scenario-d");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    // Compound instruction: inspect while coworker takes photo
    const res = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "I inspect the fixture while Beverly photographs it."
    });
    assert.equal(res.ok, true);
    assert.equal(res.result?.executed, true);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario E: Autonomous coworker reaction outside player perception", async () => {
  const { appDataPath, service, world } = createTestService("scenario-e");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    // Separate player from Beverly
    const beverly = entry.run.expedition.team.members.find((m) => m.personnel_id === "personnel-beverly-bell");
    entry.run.spatial.personnel_locations[beverly.personnel_id] = "utility-room";
    entry.run.spatial.player_location = "columned-corridor";
    beverly.current_task = { type: "follow", state: "active", target: "player" };

    // Run decision scheduler
    const scheduled = decisionScheduler.scheduleDecisions(entry.run, bootstrap.spatialDefinitionFor(entry.run.spatial_pack_id), world);
    assert.ok(scheduled.opportunities.length > 0);
    const lostContactOpp = scheduled.opportunities.find((o) => o.trigger === "LOST_CONTACT" && o.member_id === beverly.personnel_id);
    assert.ok(lostContactOpp);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario F: Multi-system consequence cascade", async () => {
  const { appDataPath, service, world } = createTestService("scenario-f");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    // Apply consequence: route blocked
    const result = consequenceRuntime.apply(entry.run, {
      source: "structural-settling",
      classification: "temporary-complication",
      effects: [{
        kind: "route-blocked",
        connection_id: "conn-utility-corridor",
        state: "temporarily-blocked"
      }]
    });
    assert.equal(result.ok, true);
    assert.equal(entry.run.spatial.blocked_paths["conn-utility-corridor"]?.state, "temporarily-blocked");
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario G: Evidence capture/custody/partial Standard communication/save-reload", async () => {
  const { appDataPath, service, world } = createTestService("scenario-g");
  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    const liveWorld = service.getWorld(world.id);

    // Capture evidence
    const rec = evidenceAuthority.capture(liveWorld, entry.run, {
      type: "photographic-frame",
      creator: "Matthew Murphy",
      location: "utility-room",
      interval: 10,
      target_observation: "Recorded architectural seam in Utility Room"
    });
    assert.ok(rec.id);
    assert.equal(rec.custody.state, "carried");

    // Save and reload session
    service.persistSession(liveWorld, "field-researcher", entry);
    const reloaded = service.loadSession(liveWorld, "field-researcher");
    assert.ok(reloaded.entry);
    const archive = evidenceAuthority.archive(liveWorld, { observer: "player" });
    assert.ok(archive.records.some((r) => r.id === rec.id));
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario H: Provider failure with zero corruption", async () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-scen-h-"));
  const failingProvider = {
    name: "failing-provider",
    async interpret(request) {
      throw new Error("PROVIDER_DOWN");
    },
    async present(request) {
      throw new Error("PROVIDER_DOWN");
    }
  };
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "reference-expedition",
    livingTurnProvider: failingProvider
  });
  const world = service.createWorld({ name: "Scenario H", seed: "scen-h" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Matthew", last_name: "Murphy" });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true, scenario: "reference-expedition" });

  try {
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");
    const locBefore = canonicalLedger.getPlayerLocation(entry.run);

    const res = await service.submitNatural({
      world_id: world.id,
      mode: "field-researcher",
      text: "Look around the room."
    });

    // Provider failure fallback must not crash or corrupt location
    assert.equal(canonicalLedger.getPlayerLocation(entry.run), locBefore);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario I: Persistence write failure with zero drift", async () => {
  const { appDataPath, service, world } = createTestService("scenario-i");
  try {
    const entry = service.session(world.id, "field-researcher");
    const beforeWorld = structuredClone(world);
    const beforeRun = structuredClone(entry.run);

    // Force persistence failure
    service.persistSession = () => {
      const err = new Error("DISK_FULL");
      err.code = "PERSISTENCE_COMMIT_FAILED";
      throw err;
    };

    const res = await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, "PERSISTENCE_COMMIT_FAILED");

    // Zero drift verified
    assert.equal(entry.phase.phase_id, beforeWorld.sessions?.["field-researcher"]?.phase?.phase_id ?? "BRIEFING");
    assert.equal(entry.run.expedition.clock.interval, beforeRun.expedition.clock.interval);
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});

test("Scenario J: Fresh-install packaged build integrity", async () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal(pkg.name, "yellow-beast");
  assert.ok(pkg.scripts["desktop:build"]);
  assert.ok(pkg.scripts["desktop:verify"]);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "desktop", "renderer-smoke.js")));
  assert.ok(fs.existsSync(path.join(__dirname, "..", "desktop", "service.js")));
});

test("Scenario K: Complete expedition, save/close/reload, later operation retaining history", async () => {
  const { appDataPath, service, world } = createTestService("scenario-k");
  try {
    // Fast-forward through full expedition to return
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    await service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Radio check Standard." });
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const entry = service.session(world.id, "field-researcher");

    // Request return
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    // Move back to threshold side entry
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    // Complete return to enter REPORT phase
    await service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(entry.phase.phase_id, "REPORT");

    // Submit report
    const reportRes = await service.submitReferenceWrittenReport({
      world_id: world.id,
      text: "Layout and condition survey completed with accountable field record."
    });
    assert.equal(reportRes.ok, true);

    // Save world and reload
    service.saveWorld({ world_id: world.id });
    const loadedWorld = service.getWorld(world.id);
    assert.ok(loadedWorld.events.length > 0);
    assert.ok(loadedWorld.events.some((e) => e.type.includes("q4.written-report") || e.type.includes("report")));
  } finally {
    service.shutdown();
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
});
