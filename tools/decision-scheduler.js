"use strict";

const crypto = require("node:crypto");
const teamRuntime = require("./team-runtime");
const canonicalLedger = require("./canonical-world-ledger");

const VERSION = "yellow-beast-decision-scheduler@v1";

const TRIGGERS = Object.freeze({
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_BLOCKED: "TASK_BLOCKED",
  CLARIFICATION_NEED: "CLARIFICATION_NEED",
  LOST_CONTACT: "LOST_CONTACT",
  NEW_PERCEPT: "NEW_PERCEPT",
  UNUSUAL_SOUND: "UNUSUAL_SOUND",
  EQUIPMENT_ISSUE: "EQUIPMENT_ISSUE",
  HAZARD_DETECTED: "HAZARD_DETECTED",
  RADIO_TRANSMISSION: "RADIO_TRANSMISSION",
  COWORKER_REQUEST: "COWORKER_REQUEST",
  BLOCKED_ROUTE: "BLOCKED_ROUTE",
  PROLONGED_IDLE: "PROLONGED_IDLE",
  REMEMBERED_COMMITMENT: "REMEMBERED_COMMITMENT"
});

const TRIGGER_PRIORITIES = Object.freeze({
  [TRIGGERS.HAZARD_DETECTED]: 10,
  [TRIGGERS.EQUIPMENT_ISSUE]: 9,
  [TRIGGERS.TASK_BLOCKED]: 8,
  [TRIGGERS.LOST_CONTACT]: 7,
  [TRIGGERS.CLARIFICATION_NEED]: 6,
  [TRIGGERS.RADIO_TRANSMISSION]: 5,
  [TRIGGERS.COWORKER_REQUEST]: 5,
  [TRIGGERS.TASK_COMPLETED]: 4,
  [TRIGGERS.NEW_PERCEPT]: 4,
  [TRIGGERS.UNUSUAL_SOUND]: 3,
  [TRIGGERS.BLOCKED_ROUTE]: 3,
  [TRIGGERS.REMEMBERED_COMMITMENT]: 2,
  [TRIGGERS.PROLONGED_IDLE]: 1
});

const clone = (val) => structuredClone(val);

function playerId(run) {
  return run.session?.startup?.player?.observer_id ?? null;
}

function memberId(member) {
  return member.personnel_id ?? member.id;
}

function location(run, id) {
  if (id === playerId(run) || id === "player") return run.spatial?.player_location ?? run.spatial?.personnel_locations?.[id] ?? null;
  return run.spatial?.personnel_locations?.[id] ?? null;
}

/**
 * Deterministically detects decision opportunities for all active coworkers.
 * Never polls an AI model; derives opportunities strictly from canonical simulation state.
 */
function evaluateOpportunities(run, spatialDefinition = {}, world = null) {
  if (!run?.expedition?.team?.members) return [];
  teamRuntime.ensure(run);
  const player = playerId(run);
  const playerLoc = location(run, player);
  const interval = run.expedition.clock?.interval ?? 0;
  const opportunities = [];

  for (const member of run.expedition.team.members) {
    const id = memberId(member);
    if (id === player || ["dead", "missing", "incapacitated"].includes(String(member.status).toLowerCase())) {
      continue;
    }

    const memberLoc = location(run, id);
    const task = member.current_task;

    // 1. HAZARD_DETECTED: Hazard in current or adjacent room
    const currentHazards = (run.spatial?.hazards ?? {})[memberLoc] || [];
    if (currentHazards.length > 0) {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.HAZARD_DETECTED}-${interval}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.HAZARD_DETECTED,
        priority: TRIGGER_PRIORITIES[TRIGGERS.HAZARD_DETECTED],
        reason: `Hazard detected at current location ${memberLoc}.`,
        confidence: 1.0,
        suggested_action: "report-hazard-or-withdraw",
        location: memberLoc,
        at: interval
      });
    }

    // 2. EQUIPMENT_ISSUE: Check held equipment for depletion or damage
    const held = canonicalLedger.getEquipmentHeldBy(run, id);
    for (const item of held) {
      if (item.state === "damaged" || item.state === "depleted" || (item.charges !== undefined && item.charges <= 0)) {
        opportunities.push({
          id: `opp-${id}-${TRIGGERS.EQUIPMENT_ISSUE}-${item.id}-${interval}`,
          member_id: id,
          member_name: member.first_name ?? member.display_name,
          trigger: TRIGGERS.EQUIPMENT_ISSUE,
          priority: TRIGGER_PRIORITIES[TRIGGERS.EQUIPMENT_ISSUE],
          reason: `Held equipment ${item.label || item.id} is degraded or depleted.`,
          confidence: 1.0,
          suggested_action: "report-equipment-issue",
          target_equipment: item.id,
          location: memberLoc,
          at: interval
        });
      }
    }

    // 3. TASK_BLOCKED: Check if current active movement or task is blocked
    if (task && task.state === "failed") {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.TASK_BLOCKED}-${interval}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.TASK_BLOCKED,
        priority: TRIGGER_PRIORITIES[TRIGGERS.TASK_BLOCKED],
        reason: `Current task ${task.type} failed or route blocked.`,
        confidence: 1.0,
        suggested_action: "revert-to-hold-or-clarify",
        location: memberLoc,
        at: interval
      });
    }

    // 4. LOST_CONTACT: Following but separated without direct observation
    if (task && ["follow", "maintain team contact"].includes(task.type || member.current_intent)) {
      if (memberLoc && playerLoc && memberLoc !== playerLoc) {
        opportunities.push({
          id: `opp-${id}-${TRIGGERS.LOST_CONTACT}-${interval}`,
          member_id: id,
          member_name: member.first_name ?? member.display_name,
          trigger: TRIGGERS.LOST_CONTACT,
          priority: TRIGGER_PRIORITIES[TRIGGERS.LOST_CONTACT],
          reason: `Visual contact lost with player (coworker at ${memberLoc}, player at ${playerLoc}).`,
          confidence: 0.9,
          suggested_action: "restore-contact",
          location: memberLoc,
          at: interval
        });
      }
    }

    // 5. CLARIFICATION_NEED: Unclear or ambiguous order received
    const lastOrder = (run.expedition.team_runtime?.orders ?? [])
      .filter((o) => o.recipient === id)
      .slice(-1)[0];
    if (lastOrder && lastOrder.state === "clarification-requested") {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.CLARIFICATION_NEED}-${lastOrder.id}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.CLARIFICATION_NEED,
        priority: TRIGGER_PRIORITIES[TRIGGERS.CLARIFICATION_NEED],
        reason: `Order ${lastOrder.type} requires procedural clarification.`,
        confidence: 1.0,
        suggested_action: "request-clarification",
        location: memberLoc,
        at: interval
      });
    }

    // 6. RADIO_TRANSMISSION: Recent radio transmission requiring acknowledgment
    const recentRadio = (run.expedition.messages ?? [])
      .filter((m) => m.channel === "FIELD_RADIO" && m.state === "delivered" && m.delivered_at === interval && m.sender !== id)
      .slice(-1)[0];
    if (recentRadio) {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.RADIO_TRANSMISSION}-${recentRadio.id}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.RADIO_TRANSMISSION,
        priority: TRIGGER_PRIORITIES[TRIGGERS.RADIO_TRANSMISSION],
        reason: `Incoming radio transmission from ${recentRadio.sender}.`,
        confidence: 1.0,
        suggested_action: "acknowledge-radio",
        message_id: recentRadio.id,
        location: memberLoc,
        at: interval
      });
    }

    // 7. TASK_COMPLETED: Current task completed, queued tasks available or need idle stance
    if (task && task.state === "completed") {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.TASK_COMPLETED}-${interval}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.TASK_COMPLETED,
        priority: TRIGGER_PRIORITIES[TRIGGERS.TASK_COMPLETED],
        reason: `Completed task ${task.type}; ready for next assignment.`,
        confidence: 1.0,
        suggested_action: member.queued_tasks?.length ? "advance-queued-task" : "hold-or-follow",
        location: memberLoc,
        at: interval
      });
    }

    // 8. REMEMBERED_COMMITMENT: Persistent memory item scheduled for now
    for (const mem of member.persistent_memory ?? []) {
      if (mem.due_interval !== undefined && mem.due_interval <= interval && !mem.fulfilled) {
        opportunities.push({
          id: `opp-${id}-${TRIGGERS.REMEMBERED_COMMITMENT}-${mem.id || interval}`,
          member_id: id,
          member_name: member.first_name ?? member.display_name,
          trigger: TRIGGERS.REMEMBERED_COMMITMENT,
          priority: TRIGGER_PRIORITIES[TRIGGERS.REMEMBERED_COMMITMENT],
          reason: `Remembered operational commitment: ${mem.summary || mem.kind}`,
          confidence: 0.85,
          suggested_action: mem.suggested_action || "execute-commitment",
          location: memberLoc,
          at: interval
        });
      }
    }

    // 9. PROLONGED_IDLE: Idle for multiple intervals
    const lastAction = member.decision_history?.slice(-1)[0];
    const idleDuration = lastAction ? interval - (lastAction.at ?? interval) : 0;
    if (idleDuration >= 3 && (!task || task.type === "wait")) {
      opportunities.push({
        id: `opp-${id}-${TRIGGERS.PROLONGED_IDLE}-${interval}`,
        member_id: id,
        member_name: member.first_name ?? member.display_name,
        trigger: TRIGGERS.PROLONGED_IDLE,
        priority: TRIGGER_PRIORITIES[TRIGGERS.PROLONGED_IDLE],
        reason: `Idle in place for ${idleDuration} operational intervals.`,
        confidence: 0.7,
        suggested_action: "check-surroundings-or-follow",
        location: memberLoc,
        at: interval
      });
    }
  }

  // Sort descending by priority
  return opportunities.sort((a, b) => b.priority - a.priority);
}

/**
 * Schedules and executes autonomous coworker decisions deterministically.
 * Updates actor state, records decisions, and returns scheduled events.
 */
function scheduleDecisions(run, spatialDefinition = {}, world = null) {
  const opportunities = evaluateOpportunities(run, spatialDefinition, world);
  const scheduled = [];
  const interval = run.expedition?.clock?.interval ?? 0;

  for (const opp of opportunities) {
    const member = run.expedition.team.members.find((m) => memberId(m) === opp.member_id);
    if (!member) continue;

    // Handle high-priority autonomous responses
    let decision = null;

    if (opp.trigger === TRIGGERS.LOST_CONTACT && opp.suggested_action === "restore-contact") {
      member.current_task = { type: "restore-contact", state: "active", target: playerId(run) };
      member.current_intent = "restore contact with expedition lead";
      decision = {
        member_id: opp.member_id,
        trigger: opp.trigger,
        action: "restore-contact",
        reason: opp.reason,
        at: interval,
        result: "initiated"
      };
    } else if (opp.trigger === TRIGGERS.TASK_COMPLETED && opp.suggested_action === "advance-queued-task") {
      const next = member.queued_tasks.shift();
      member.current_task = { ...next, state: "active" };
      member.current_intent = `perform queued task: ${next.type}`;
      decision = {
        member_id: opp.member_id,
        trigger: opp.trigger,
        action: "advance-queued-task",
        task: next.type,
        reason: opp.reason,
        at: interval,
        result: "activated"
      };
    } else if (opp.trigger === TRIGGERS.TASK_BLOCKED) {
      member.current_task = { type: "hold", state: "active", target: location(run, opp.member_id) };
      member.current_intent = "hold position after task failure";
      decision = {
        member_id: opp.member_id,
        trigger: opp.trigger,
        action: "hold",
        reason: opp.reason,
        at: interval,
        result: "reverted"
      };
    } else if (opp.trigger === TRIGGERS.HAZARD_DETECTED) {
      member.behavioral_state = "cautious";
      member.stress = Math.min(10, (member.stress ?? 0) + 2);
      decision = {
        member_id: opp.member_id,
        trigger: opp.trigger,
        action: "hazard-alert",
        reason: opp.reason,
        at: interval,
        result: "alerted"
      };
    } else if (opp.trigger === TRIGGERS.EQUIPMENT_ISSUE) {
      member.behavioral_state = "impeded";
      decision = {
        member_id: opp.member_id,
        trigger: opp.trigger,
        action: "note-equipment-issue",
        reason: opp.reason,
        at: interval,
        result: "recorded"
      };
    }

    if (decision) {
      member.decision_history ??= [];
      member.decision_history.push(decision);
      scheduled.push(decision);
    }
  }

  return {
    version: VERSION,
    opportunities,
    scheduled
  };
}

module.exports = {
  VERSION,
  TRIGGERS,
  TRIGGER_PRIORITIES,
  evaluateOpportunities,
  scheduleDecisions
};
