"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const cq4Day1Opener = require("./cq4-day1-opener");

async function measure() {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-perf-measure-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "procedural-survey"
  });

  const memStart = process.memoryUsage();
  const t0 = performance.now();

  const world = service.createWorld({ name: "Perf Measurement World", seed: "perf-seed-1994" }).world;
  service.createQ4Personnel({ world_id: world.id, first_name: "Tessa", last_name: "Gray" });
  service.confirmQ4Personnel({ world_id: world.id });
  service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });

  const tInit = performance.now();
  const initLatencyMs = tInit - t0;

  // Onboard Operation 1
  const tColdStart = performance.now();
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  const tColdEnd = performance.now();
  const coldTurnLatencyMs = tColdEnd - tColdStart;

  service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for outside the Threshold. Radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

  // Measure warm action latencies across 20 turns
  const warmLatencies = [];
  for (let i = 0; i < 20; i++) {
    const tStart = performance.now();
    if (i % 2 === 0) {
      service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
    } else {
      service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
    }
    const tEnd = performance.now();
    warmLatencies.push(tEnd - tStart);
  }

  const memAfter20Turns = process.memoryUsage();

  // Helper to onboard an active session into field operation
  function onboardOperation(opNum) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitQ4Communication({
      world_id: world.id,
      channel: "standard",
      text: `Standard, Clear-Q4 team accounted for outside Threshold in operation ${opNum}. Radio check.`
    });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });
  }

  // Helper to close an active field operation canonically into DEBRIEF
  async function closeOperationCanonically() {
    const retRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    assert.equal(retRes.ok, true, "RETURN action must succeed");

    const moveRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    assert.equal(moveRes.ok, true, "MOVE to threshold-side-entry must succeed");

    // Allow in-flight delayed messages to deliver before closure
    while ((service.session(world.id, "field-researcher").run.expedition.messages ?? []).some(m => ["queued", "transmitting", "delayed"].includes(m.state))) {
      service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
    }

    const compRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(compRes.ok, true, "COMPLETE_RETURN action must succeed");

    const currentEntry = service.session(world.id, "field-researcher");
    if (currentEntry.phase.phase_id === "REPORT") {
      const repRes = await service.submitNatural({
        world_id: world.id,
        mode: "field-researcher",
        text: "The team returned accounted for. Routine survey completed."
      });
      assert.equal(repRes.ok, true, "Written report submission must succeed");
    }

    const closedEntry = service.session(world.id, "field-researcher");
    assert.equal(closedEntry.run.lifecycle, "completed", "Run lifecycle must be completed");
    assert.equal(closedEntry.phase.phase_id, "DEBRIEF", "Phase must be DEBRIEF");
    return closedEntry;
  }

  // Multi-operation tracking across 3 real sequential operations
  const operations = [];
  const worldFilePath = service.worldFile(world.id);
  const sessionFilePath = service.sessionFile(world.id, "field-researcher");

  // Close Operation 1
  const op1Closed = await closeOperationCanonically();
  const op1Stats = {
    operation: 1,
    run_id: op1Closed.run.run_id,
    mission_id: op1Closed.run.expedition?.mission?.id,
    lifecycle: op1Closed.run.lifecycle,
    phase: op1Closed.phase.phase_id,
    world_size_bytes: fs.statSync(worldFilePath).size,
    session_size_bytes: fs.statSync(sessionFilePath).size,
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 100) / 100,
    history_events: op1Closed.run.expedition?.history?.length ?? 0
  };
  operations.push(op1Stats);

  // Advance to Operation 2
  // Assert every prerequisite
  assert.equal(op1Closed.kind, "bootstrap", "Prerequisite: entry.kind === bootstrap");
  assert.equal(op1Closed.run.lifecycle, "completed", "Prerequisite: run.lifecycle === completed");
  assert.equal(op1Closed.phase?.phase_id, "DEBRIEF", "Prerequisite: phase === DEBRIEF");
  assert.equal(cq4Day1Opener.isOpener(op1Closed.run?.scenario), false, "Prerequisite: not opener scenario");

  const adv1Res = service.advanceQ4Operations({ world_id: world.id });
  assert.equal(adv1Res.ok, true, "advanceQ4Operations must succeed from Op 1 to Op 2");
  assert.equal(adv1Res.result?.outcome, "operations-advanced");

  const op2Entry = service.session(world.id, "field-researcher");
  assert.notEqual(op2Entry.run.run_id, op1Closed.run.run_id, "Op 2 must have a newly generated run ID");

  // Run Op 2 in field
  onboardOperation(2);
  for (let i = 0; i < 5; i++) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
  }
  const op2Closed = await closeOperationCanonically();
  const op2Stats = {
    operation: 2,
    run_id: op2Closed.run.run_id,
    mission_id: op2Closed.run.expedition?.mission?.id,
    lifecycle: op2Closed.run.lifecycle,
    phase: op2Closed.phase.phase_id,
    world_size_bytes: fs.statSync(worldFilePath).size,
    session_size_bytes: fs.statSync(sessionFilePath).size,
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 100) / 100,
    history_events: op2Closed.run.expedition?.history?.length ?? 0
  };
  operations.push(op2Stats);

  // Advance to Operation 3
  // Assert every prerequisite
  assert.equal(op2Closed.kind, "bootstrap");
  assert.equal(op2Closed.run.lifecycle, "completed");
  assert.equal(op2Closed.phase?.phase_id, "DEBRIEF");
  assert.equal(cq4Day1Opener.isOpener(op2Closed.run?.scenario), false);

  const adv2Res = service.advanceQ4Operations({ world_id: world.id });
  assert.equal(adv2Res.ok, true, "advanceQ4Operations must succeed from Op 2 to Op 3");
  assert.equal(adv2Res.result?.outcome, "operations-advanced");

  const op3Entry = service.session(world.id, "field-researcher");
  assert.notEqual(op3Entry.run.run_id, op2Closed.run.run_id, "Op 3 must have a newly generated run ID");

  // Run Op 3 in field
  onboardOperation(3);
  for (let i = 0; i < 5; i++) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
  }
  const op3Closed = await closeOperationCanonically();
  const op3Stats = {
    operation: 3,
    run_id: op3Closed.run.run_id,
    mission_id: op3Closed.run.expedition?.mission?.id,
    lifecycle: op3Closed.run.lifecycle,
    phase: op3Closed.phase.phase_id,
    world_size_bytes: fs.statSync(worldFilePath).size,
    session_size_bytes: fs.statSync(sessionFilePath).size,
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 100) / 100,
    history_events: op3Closed.run.expedition?.history?.length ?? 0
  };
  operations.push(op3Stats);

  // Advance to Operation 4
  assert.equal(op3Closed.kind, "bootstrap");
  assert.equal(op3Closed.run.lifecycle, "completed");
  assert.equal(op3Closed.phase?.phase_id, "DEBRIEF");
  assert.equal(cq4Day1Opener.isOpener(op3Closed.run?.scenario), false);

  const adv3Res = service.advanceQ4Operations({ world_id: world.id });
  assert.equal(adv3Res.ok, true, "advanceQ4Operations must succeed from Op 3 to Op 4");
  assert.equal(adv3Res.result?.outcome, "operations-advanced");

  const op4Entry = service.session(world.id, "field-researcher");
  assert.notEqual(op4Entry.run.run_id, op3Closed.run.run_id, "Op 4 must have a newly generated run ID");

  // Run Op 4 in field
  onboardOperation(4);
  for (let i = 0; i < 5; i++) {
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" });
  }
  const op4Closed = await closeOperationCanonically();
  const op4Stats = {
    operation: 4,
    run_id: op4Closed.run.run_id,
    mission_id: op4Closed.run.expedition?.mission?.id,
    lifecycle: op4Closed.run.lifecycle,
    phase: op4Closed.phase.phase_id,
    world_size_bytes: fs.statSync(worldFilePath).size,
    session_size_bytes: fs.statSync(sessionFilePath).size,
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024) * 100) / 100,
    history_events: op4Closed.run.expedition?.history?.length ?? 0
  };
  operations.push(op4Stats);

  // Explicit Garbage Collection measurement (if exposed)
  const memBeforeExplicitGC = process.memoryUsage();
  if (typeof global.gc === "function") {
    global.gc();
  }
  const memAfterExplicitGC = process.memoryUsage();

  service.shutdown();
  fs.rmSync(appDataPath, { recursive: true, force: true });

  function percentile(arr, p) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return Math.round(sorted[idx] * 100) / 100;
  }

  const avgWarmLatency = warmLatencies.reduce((a, b) => a + b, 0) / warmLatencies.length;
  const minWarmLatency = Math.min(...warmLatencies);
  const maxWarmLatency = Math.max(...warmLatencies);

  const results = {
    latency: {
      session_initialization_ms: Math.round(initLatencyMs * 100) / 100,
      cold_turn_latency_ms: Math.round(coldTurnLatencyMs * 100) / 100,
      warm_turn_latency_ms: {
        average: Math.round(avgWarmLatency * 100) / 100,
        min: Math.round(minWarmLatency * 100) / 100,
        p50: percentile(warmLatencies, 0.50),
        p90: percentile(warmLatencies, 0.90),
        p95: percentile(warmLatencies, 0.95),
        max: Math.round(maxWarmLatency * 100) / 100
      }
    },
    operations_progression: operations,
    storage_analysis: {
      world_growth: {
        op1_bytes: operations[0].world_size_bytes,
        op2_bytes: operations[1].world_size_bytes,
        op3_bytes: operations[2].world_size_bytes,
        op4_bytes: operations[3].world_size_bytes,
        delta_op1_to_op2_bytes: operations[1].world_size_bytes - operations[0].world_size_bytes,
        delta_op2_to_op3_bytes: operations[2].world_size_bytes - operations[1].world_size_bytes,
        delta_op3_to_op4_bytes: operations[3].world_size_bytes - operations[2].world_size_bytes,
        explanation: "Expected linear history growth: world.json accumulates completed mission records, institutional debriefs, and personnel continuity ledgers."
      },
      session_working_set: {
        op1_bytes: operations[0].session_size_bytes,
        op2_bytes: operations[1].session_size_bytes,
        op3_bytes: operations[2].session_size_bytes,
        op4_bytes: operations[3].session_size_bytes,
        explanation: "Session working set bounds memory to current active expedition state plus worldpack references."
      }
    },
    memory_analysis: {
      initial_heap_used_mb: Math.round(memStart.heapUsed / (1024 * 1024) * 100) / 100,
      after_20_turns_heap_used_mb: Math.round(memAfter20Turns.heapUsed / (1024 * 1024) * 100) / 100,
      pre_gc_peak_heap_mb: Math.round(memBeforeExplicitGC.heapUsed / (1024 * 1024) * 100) / 100,
      post_gc_retained_heap_mb: Math.round(memAfterExplicitGC.heapUsed / (1024 * 1024) * 100) / 100,
      rss_mb: Math.round(memAfterExplicitGC.rss / (1024 * 1024) * 100) / 100,
      gc_reclaimed_mb: Math.round((memBeforeExplicitGC.heapUsed - memAfterExplicitGC.heapUsed) / (1024 * 1024) * 100) / 100,
      leak_assessment: "Bounded observation only: this run records one post-GC retained-heap sample after four operations. A longer repeated soak is required to accept or reject a memory-leak claim."
    }
  };

  console.log(JSON.stringify(results, null, 2));
  return results;
}

if (require.main === module) {
  measure().then(() => process.exit(0)).catch((err) => {
    console.error("Measurement failure:", err);
    process.exit(1);
  });
}

module.exports = { measure };
