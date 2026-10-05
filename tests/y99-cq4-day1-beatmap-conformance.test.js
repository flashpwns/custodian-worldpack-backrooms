"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const cq4Day1Opener = require("../tools/cq4-day1-opener");
const endingView = require("../desktop/renderer/ending");
const vm = require("node:vm");

test('renderer refreshes the persisted terminal projection after return failure and ignores stale worlds', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/renderer/renderer.js'), 'utf8');
  const submitSource = source.slice(source.indexOf('async function submitTurn('), source.indexOf('function applyAcousticScene('));
  for (const changeWorld of [false, true]) {
    let worldId = 'active', shown = 0, fetched = 0;
    const terminal = { catastrophic_ending:{ active:true } };
    const context = { current:{ projection:{} }, requestContext:() => ({ worldId, mode:'field-researcher' }), requestGate:{ begin:() => ({}), isCurrent:() => true, settle:() => true }, disableTurnForms() {}, setFeedback() {}, play() { shown++; }, yellowBeast:{ async getGameplayProjection(input) {
      assert.equal(input.world_id, 'active'); fetched++;
      if (changeWorld) worldId = 'another';
      return { ok:true, projection:terminal };
    } } };
    vm.createContext(context);
    vm.runInContext(submitSource, context);
    await context.submitTurn('structured', async () => ({ ok:false, error:{ code:'THRESHOLD_NONFUNCTIONAL' } }));
    assert.equal(fetched, 1);
    assert.equal(shown, changeWorld ? 0 : 1);
    assert.equal(context.current.projection.catastrophic_ending?.active === true, !changeWorld);
  }
});

test('terminal presentation preserves stage order and completes exactly once on timeline or skip', () => {
  for (const skipAt of [null, 0, 4]) {
    const queued = [], rendered = [];
    let click, completions = 0;
    const element = { set innerHTML(value) { rendered.push(value.match(/data-ending-stage="([^"]+)"/)[1]); }, querySelector() { return { addEventListener(_, fn) { click = fn; }, focus() {} }; } };
    const player = endingView.start({ element, record:{ headline:'Four in Santa Clarita', date:'July 17', location:'Santa Clarita' }, complete:() => completions++, schedule:fn => { queued.push(fn); return queued.length; }, unschedule() {} });
    for (let i = 0; i < 5 && completions === 0; i++) {
      if (i === skipAt) { click(); click(); }
      queued.shift()?.();
    }
    player.finish();
    assert.equal(completions, 1);
    assert.deepEqual(rendered, endingView.stages.slice(0, skipAt === null ? 5 : skipAt + 1).map(stage => stage.id));
  }
  const html = endingView.markup(endingView.stages[4], { headline:'<script>bad</script>', date:'1991', location:'Santa Clarita' });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|data-game-action|MISSION FAILED/);
});

test('canceling terminal playback suppresses stale timers and completion', () => {
  let timer, completions = 0;
  const element = { innerHTML:'', querySelector() { return { addEventListener() {}, focus() {} }; } };
  const player = endingView.start({ element, record:{}, complete:() => completions++, schedule:fn => { timer = fn; return 1; }, unschedule() {} });
  player.cancel(); timer(); player.finish();
  assert.equal(completions, 0);
});

function fixture(seed = "beatmap-conformance") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-beatmap-conf-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario: "day1-opener" });
  const created = service.createWorld({ name: "Beatmap Conformance World", seed });
  assert.equal(created.ok, true);
  return { appDataPath, service, worldId: created.world.id };
}

test("y99 — action duration table deterministically advances simulation_time from 10:00 AM", () => {
  const f = fixture("action-duration-table");
  try {
    const started = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    // Initial simulation time is 10:00 AM
    assert.equal(started.projection.q4.simulation_time, "10:00 AM");

    // Canonical action duration verification
    const d = cq4Day1Opener.ACTION_DURATIONS_SECONDS;
    assert.equal(d.WALK, 30);
    assert.equal(d.RUN, 15);
    assert.equal(d.PHOTOGRAPH, 60);
    assert.equal(d.READY_EQUIPMENT, 30);
    assert.equal(d.EXAMINE_QUICK, 60);
    assert.equal(d.EXAMINE_STANDARD, 180);
    assert.equal(d.DOCUMENT_DETAILED, 300);
    assert.equal(d.RADIO_CHECK, 15);
    assert.equal(d.CONVERSATION_BRIEF, 10);
    assert.equal(d.CONVERSATION_NORMAL, 30);
    assert.equal(d.CONVERSATION_EXTENDED, 120);
    assert.equal(d.WAIT, 60);
    assert.equal(d.REST, 600);

    const entry = f.service.session(f.worldId, "field-researcher");
    const run = entry.run;

    // advanceSimulationTime granular accumulation
    const t1 = cq4Day1Opener.advanceSimulationTime(run, 30);
    assert.equal(t1.simulation_time, "10:00 AM"); // 30s elapsed is still 10:00 AM
    assert.equal(run.expedition.day1_opener.simulation_time_precise, "10:00:30 AM");

    const t2 = cq4Day1Opener.advanceSimulationTime(run, 60);
    assert.equal(t2.simulation_time, "10:01 AM");
    assert.equal(run.expedition.day1_opener.simulation_time_precise, "10:01:30 AM");

    // Complete broadcast to enter personnel briefing beat
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "COMPLETE_BROADCAST" });

    // Local dialogue during BRIEFING advances simulation time
    const commRes = f.service.submitQ4CommunicationCanonical({
      world_id: f.worldId,
      channel: "local",
      text: "Testing our departure timing with the team."
    });
    assert.equal(commRes.ok, true);
    assert.ok(commRes.projection.q4.simulation_time.includes("AM"));

    // Phase transition READY advances time
    const readyRes = f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });
    assert.equal(readyRes.ok, true);
    assert.ok(entry.run.expedition.day1_opener.elapsed_seconds > 90);
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("y99 — post-1:00 PM operational cutoff triggers STANDARD_UNAVAILABLE on radio attempts", () => {
  const f = fixture("cutoff-radio-dead");
  try {
    const started = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    const entry = f.service.session(f.worldId, "field-researcher");

    // Advance through briefing, staging, transit to standard radio check
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "COMPLETE_BROADCAST" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "PROCEED" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "APPROACH" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });

    // Now in STANDARD_RADIO_CHECK; advance time past cutoff (1:00 PM is 10,800s elapsed)
    cq4Day1Opener.advanceSimulationTime(entry.run, 11000);
    assert.equal(cq4Day1Opener.isCutoffExceeded(entry.run), true);
    assert.equal(entry.run.expedition.day1_opener.cutoff_exceeded, true);

    // Radio transmission must fail closed with STANDARD_UNAVAILABLE
    const radioRes = f.service.submitQ4CommunicationCanonical({
      world_id: f.worldId,
      channel: "standard",
      text: "Standard, this is Clear-Q4, radio check."
    });
    assert.equal(radioRes.ok, false);
    assert.equal(radioRes.error?.code, "STANDARD_UNAVAILABLE");
    assert.match(radioRes.error?.message, /operational cutoff exceeded/i);
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("y99 — attempting return after 1:00 PM triggers THRESHOLD_NONFUNCTIONAL and catastrophic ending", () => {
  const f = fixture("catastrophic-collapse");
  try {
    const started = f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });
    assert.equal(started.ok, true);

    const entry = f.service.session(f.worldId, "field-researcher");

    // Advance to FIELD_OPERATION
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "COMPLETE_BROADCAST" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "PROCEED" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "APPROACH" });
    f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "READY" });

    // Radio check
    f.service.submitQ4CommunicationCanonical({
      world_id: f.worldId,
      channel: "standard",
      text: "Standard, this is Clear-Q4, radio check."
    });

    // Cross into field operation
    const crossRes = f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "CROSS" });
    assert.equal(crossRes.ok, true);
    assert.equal(entry.phase.phase_id, "FIELD_OPERATION");

    // Set player location to utility-room for return
    entry.run.spatial.player_location = "utility-room";

    // Request return
    const returnReq = f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "RETURN" });
    assert.equal(returnReq.ok, true);

    // Simulate clock exceeding 1:00 PM (10,800 seconds / 3 hours)
    cq4Day1Opener.advanceSimulationTime(entry.run, 11000);
    assert.equal(cq4Day1Opener.isCutoffExceeded(entry.run), true);

    // Attempt COMPLETE_RETURN
    const returnRes = f.service.submitAction({ world_id: f.worldId, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(returnRes.ok, false);
    assert.equal(returnRes.error?.code, "THRESHOLD_NONFUNCTIONAL");

    // Check catastrophic ending state
    const opener = entry.run.expedition.day1_opener;
    assert.ok(opener.catastrophic_ending);
    assert.equal(opener.catastrophic_ending.active, true);
    assert.equal(opener.catastrophic_ending.stage, "terminal");
    assert.equal(opener.catastrophic_ending.asset_id, "ending.catastrophic.newspaper");
    assert.equal(opener.catastrophic_ending.headline, "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA");
    assert.equal(opener.catastrophic_ending.date, "JULY 17, 1991");
    assert.equal(opener.catastrophic_ending.location, "Santa Clarita, California");
    assert.equal(opener.catastrophic_ending.casualties, 4);

    // Coworkers are panicked
    const playerId = entry.run.session.startup.player.observer_id;
    for (const member of entry.run.expedition.team.members) {
      if (member.identity !== playerId) {
        assert.equal(member.behavioral_state, "panicked");
        assert.equal(member.stress, 10);
      }
    }

    // World terminal outcome recorded
    const world = f.service.getWorld(f.worldId);
    assert.equal(world.q4_operations.terminal_outcome.outcome, "catastrophic-failure");
    assert.equal(world.q4_operations.terminal_outcome.asset_id, "ending.catastrophic.newspaper");

    // Projection has catastrophic ending and demo termination
    const proj = f.service.getGameplayProjection({ world_id: f.worldId, mode: "field-researcher" }).projection;
    assert.ok(proj.catastrophic_ending);
    assert.equal(proj.catastrophic_ending.headline, "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA");
    assert.ok(proj.demo_termination);
    assert.equal(proj.demo_termination.status_text, "NO FURTHER ASSIGNMENTS AVAILABLE");
    assert.equal(proj.demo_termination.catastrophic, true);
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test("y99 — cold restart preserves catastrophic ending state without corruption", () => {
  const f = fixture("catastrophic-restart");
  try {
    f.service.startSession({ world_id: f.worldId, mode: "field-researcher", scenario: "day1-opener" });

    // Directly trigger catastrophic ending via DesktopService
    const trigRes = f.service.triggerCatastrophicEnding({ world_id: f.worldId });
    assert.equal(trigRes.ok, true);
    assert.equal(trigRes.result.catastrophic_ending.asset_id, "ending.catastrophic.newspaper");

    // Simulate cold restart
    f.service.shutdown();
    const reopened = new DesktopService({ appDataPath: f.appDataPath, defaultQ4Scenario: "day1-opener" });

    // Resume session
    const resumed = reopened.resumeSession({ world_id: f.worldId, mode: "field-researcher" });
    assert.equal(resumed.ok, true);

    const proj = resumed.projection;
    assert.ok(proj.catastrophic_ending);
    assert.equal(proj.catastrophic_ending.headline, "TRAFFIC COLLISION CLAIMS FOUR IN SANTA CLARITA");
    assert.equal(proj.catastrophic_ending.stage, "terminal");
    assert.ok(proj.demo_termination);
    assert.equal(proj.demo_termination.status_text, "NO FURTHER ASSIGNMENTS AVAILABLE");
    assert.equal(proj.demo_termination.catastrophic, true);

    // Verify advancing operations is locked
    const adv = reopened.advanceQ4Operations({ world_id: f.worldId });
    assert.equal(adv.ok, false);
    assert.equal(adv.error?.code, "NO_FURTHER_ASSIGNMENTS");
    assert.equal(adv.error?.message, "NO FURTHER ASSIGNMENTS AVAILABLE");

    // Verify world terminal outcome is intact
    const afterWorld = reopened.getWorld(f.worldId);
    assert.equal(afterWorld.q4_operations.terminal_outcome.outcome, "catastrophic-failure");
  } finally {
    fs.rmSync(f.appDataPath, { recursive: true, force: true });
  }
});

test('y99 — precise Day One clock controls cutoff rather than legacy turn count', () => {
  const run = { scenario: 'day1-opener', expedition: { clock: { interval: 30 }, day1_opener: { elapsed_seconds: 1200, operational_cutoff_seconds: 10800 } } };
  assert.equal(cq4Day1Opener.isCutoffExceeded(run), false, '10:20 AM cannot trigger the post-1 PM ending');
  cq4Day1Opener.advanceSimulationTime(run, 9600);
  assert.equal(cq4Day1Opener.isCutoffExceeded(run), false, 'exactly 1 PM remains within the return boundary');
  cq4Day1Opener.advanceSimulationTime(run, 1);
  assert.equal(cq4Day1Opener.isCutoffExceeded(run), true);
  assert.equal(cq4Day1Opener.getActionDuration('PHOTOGRAPH'), 60);
});

test('y99 — late report uses the recorded return time, not turn count or time spent writing', () => {
  const run = { expedition: { clock: { interval: 99 }, day1_opener: { delivery_completed: true, return_surveillance_verified: true, elapsed_seconds: 10000, returned_elapsed_seconds: 7100 } } };
  assert.equal(cq4Day1Opener.assessInstitutionalRecord({ run }).basis.is_late, false);
  run.expedition.clock.interval = 1;
  run.expedition.day1_opener.returned_elapsed_seconds = 7201;
  assert.equal(cq4Day1Opener.assessInstitutionalRecord({ run }).basis.is_late, true);
});
