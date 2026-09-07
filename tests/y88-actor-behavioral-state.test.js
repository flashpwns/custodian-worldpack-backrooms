"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { advanceActorState, scheduleDecisions } = require("../tools/decision-scheduler.js");

const VERSION_PREFIX = "yellow-beast-decision-scheduler@";

function minimalRun(workerTask = { type: "investigate", state: "active", target: "utility-room" }) {
  const playerId = "player-001";
  return {
    session: { startup: { player: { observer_id: playerId } } },
    spatial: {
      player_location: "staging-area",
      personnel_locations: { "player-001": "staging-area", "worker-01": "utility-room" },
      last_confirmed_personnel_positions: {},
      team_behavior: { "worker-01": "follow" },
      hazards: {},
      discovered_connections: {}
    },
    expedition: {
      clock: { interval: 10, elapsed: 10 },
      team: {
        members: [
          {
            personnel_id: playerId,
            first_name: "Player",
            display_name: "Player",
            role: "field-researcher",
            status: "active",
            condition: "normal",
            health: "uninjured",
            stress: 0,
            fatigue: 0
          },
          {
            personnel_id: "worker-01",
            first_name: "Alex",
            display_name: "Alex Vance",
            role: "documentation specialist",
            status: "active",
            condition: "normal",
            health: "uninjured",
            stress: 0,
            fatigue: 0,
            attention_focus: "surroundings",
            behavioral_state: "routine",
            task_progress: { step: 0, total_steps: 1, percent: 100 },
            queued_tasks: [],
            persistent_memory: [],
            decision_history: [],
            current_task: workerTask,
            current_intent: "perform assigned task"
          }
        ]
      },
      team_runtime: { version: "yellow-beast-team-runtime@v1", orders: [], decision_history: [], observer_knowledge: {}, revision: 0 },
      messages: [],
      equipment: {}
    }
  };
}

describe("y88 — Actor behavioral state advancement (R4 repair verification)", () => {
  it("advanceActorState is exported from decision-scheduler", () => {
    assert.equal(typeof advanceActorState, "function", "advanceActorState must be a function");
  });

  it("fatigue accumulates for active non-wait task (investigate)", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.fatigue = 0;
    advanceActorState(run);
    assert.ok(member.fatigue > 0, `fatigue should increase for investigate task, got ${member.fatigue}`);
    assert.ok(member.fatigue <= 10, `fatigue should not exceed cap of 10, got ${member.fatigue}`);
  });

  it("fatigue recovers during wait task", () => {
    const run = minimalRun({ type: "wait", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.fatigue = 5;
    advanceActorState(run);
    assert.ok(member.fatigue < 5, `fatigue should decrease during wait, got ${member.fatigue}`);
    assert.ok(member.fatigue >= 0, `fatigue should not go below 0, got ${member.fatigue}`);
  });

  it("fatigue does not go negative during recovery", () => {
    const run = minimalRun({ type: "hold", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.fatigue = 0.2;
    advanceActorState(run);
    assert.ok(member.fatigue >= 0, `fatigue must not go negative, got ${member.fatigue}`);
  });

  it("stress decays from elevated state", () => {
    const run = minimalRun({ type: "hold", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 8;
    advanceActorState(run);
    assert.ok(member.stress < 8, `stress should decay, got ${member.stress}`);
    assert.ok(member.stress >= 0, `stress must not go below 0, got ${member.stress}`);
  });

  it("stress does not go below zero during decay", () => {
    const run = minimalRun({ type: "hold", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 0.2;
    advanceActorState(run);
    assert.ok(member.stress >= 0, `stress floor must be 0, got ${member.stress}`);
  });

  it("attention_focus: investigate → assigned-objective", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    advanceActorState(run);
    assert.equal(member.attention_focus, "assigned-objective",
      `investigate should set assigned-objective, got ${member.attention_focus}`);
  });

  it("attention_focus: move-to → route", () => {
    const run = minimalRun({ type: "move-to", state: "active", target: "open-passage" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    advanceActorState(run);
    assert.equal(member.attention_focus, "route",
      `move-to should set route, got ${member.attention_focus}`);
  });

  it("attention_focus: hold → surroundings", () => {
    const run = minimalRun({ type: "hold", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.attention_focus = "assigned-objective";
    advanceActorState(run);
    assert.equal(member.attention_focus, "surroundings",
      `hold should reset to surroundings, got ${member.attention_focus}`);
  });

  it("behavioral_state → cautious when stress+fatigue ≥ 8", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 3;
    member.fatigue = 6; // total 9 before advance; after: fatigue→7, total→10 ≥ 8
    member.behavioral_state = "routine";
    advanceActorState(run);
    assert.equal(member.behavioral_state, "cautious",
      `total ≥ 8 should yield cautious, got ${member.behavioral_state}`);
  });

  it("behavioral_state → impeded when stress+fatigue ≥ 15", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 8;
    member.fatigue = 8; // total 16 before advance ≥ 15
    member.behavioral_state = "routine";
    advanceActorState(run);
    assert.equal(member.behavioral_state, "impeded",
      `total ≥ 15 should yield impeded, got ${member.behavioral_state}`);
  });

  it("behavioral_state recovers routine when cautious and total < 4", () => {
    const run = minimalRun({ type: "wait", state: "active", target: null });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 1;   // decays to 0.5
    member.fatigue = 1;  // recovers to 0.5
    member.behavioral_state = "cautious";
    advanceActorState(run);
    // total after = ~1 < 4 → recovers to routine
    assert.equal(member.behavioral_state, "routine",
      `low stress+fatigue from cautious should recover to routine, got ${member.behavioral_state}`);
  });

  it("task_progress → 100% for completed task", () => {
    const run = minimalRun({ type: "investigate", state: "completed", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    advanceActorState(run);
    assert.equal(member.task_progress.percent, 100,
      `completed task should show 100% progress, got ${member.task_progress.percent}`);
  });

  it("player member is never mutated by advanceActorState", () => {
    const run = minimalRun();
    const playerMember = run.expedition.team.members.find(m => m.personnel_id === "player-001");
    playerMember.stress = 0;
    playerMember.fatigue = 0;
    advanceActorState(run);
    assert.equal(playerMember.stress, 0, "player stress must not be mutated");
    assert.equal(playerMember.fatigue, 0, "player fatigue must not be mutated");
  });

  it("incapacitated members are skipped", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.status = "incapacitated";
    member.fatigue = 0;
    advanceActorState(run);
    assert.equal(member.fatigue, 0, "incapacitated member fatigue must not be updated");
  });

  it("scheduleDecisions integrates advanceActorState — fatigue advances through full call", () => {
    const run = minimalRun({ type: "investigate", state: "active", target: "utility-room" });
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.fatigue = 0;
    const result = scheduleDecisions(run, {}, null);
    assert.ok(result.version.startsWith(VERSION_PREFIX),
      `version prefix expected: ${VERSION_PREFIX}, got ${result.version}`);
    assert.ok(member.fatigue > 0,
      `scheduleDecisions must advance fatigue via advanceActorState; got ${member.fatigue}`);
  });

  it("hazard trigger elevates stress and sets behavioral_state=cautious, attention_focus=hazard", () => {
    const run = minimalRun({ type: "hold", state: "active", target: null });
    run.spatial.hazards = { "utility-room": [{ id: "hazard-01", type: "unidentified" }] };
    const member = run.expedition.team.members.find(m => m.personnel_id === "worker-01");
    member.stress = 0;
    scheduleDecisions(run, {}, null);
    assert.ok(member.stress > 0,
      `hazard detection should increase stress; got ${member.stress}`);
    assert.equal(member.behavioral_state, "cautious",
      `hazard detection should set cautious; got ${member.behavioral_state}`);
    assert.equal(member.attention_focus, "hazard",
      `hazard detection should set attention_focus=hazard; got ${member.attention_focus}`);
  });
});
