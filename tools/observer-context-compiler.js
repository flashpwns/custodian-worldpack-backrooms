"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");
const affordanceService = require("./affordance-service");

const VERSION = "yellow-beast-observer-context-compiler@v1";

function formatTime(interval = 0) {
  const totalSeconds = interval * 60; // 1 interval = 1 minute
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function compileObserverContext(run, observerId = null, currentInput = "", options = {}) {
  const playerId = run.session?.startup?.player?.observer_id ?? "player";
  const obs = observerId ?? playerId;
  const perceived = perceptionService.perceive(run, obs);

  // Perception formatting
  const visibleList = [];
  for (const v of perceived.visible) {
    const dist = v.distance_m ? `${v.distance_m}m` : "";
    const dir = v.direction ? v.direction : "";
    visibleList.push(`${v.name} ${dist} ${dir}`.replace(/\s+/g, " ").trim());
  }

  const audibleList = perceived.audible.map((a) => a.source);

  // Team status
  const team = {};
  for (const member of run.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (id === obs) continue;
    const nameKey = (member.first_name ?? member.display_name ?? id).toLowerCase();
    const isPresent = perceptionService.sameRoom(obs, id, run);
    const held = canonicalLedger.getEquipmentHeldBy(run, id).map((e) => e.label ?? e.id);
    const task = canonicalLedger.getCoworkerTask(run, id);
    const emotionalState = canonicalLedger.getCoworkerEmotionalState(run, id);
    const emotionalSummary = canonicalLedger.formatCoworkerEmotionalSummary(emotionalState);

    team[nameKey] = {
      id,
      present: isPresent,
      holding: held,
      task: task ? `${task.task} ${task.target ?? ""}`.trim() : null,
      state: emotionalSummary
    };
  }

  // Recent causal events (last 3 relevant events)
  const recentEvents = [];
  const ledger = run.causal_ledger ?? [];
  for (const entry of ledger.slice(-4)) {
    if (entry.kind === "location_entered") {
      recentEvents.push(`${entry.actor} entered ${entry.target}`);
    } else if (entry.kind === "task_assigned") {
      recentEvents.push(`${entry.actor} assigned to ${entry.details?.task} ${entry.target ?? ""}`.trim());
    } else if (entry.kind === "equipment_transfer") {
      recentEvents.push(`${entry.details?.item} given to ${entry.target}`);
    } else if (entry.kind === "observation_made") {
      recentEvents.push(`${entry.actor} observed ${entry.target}`);
    }
  }

  // Available referents
  const availableReferents = {
    person: Object.values(team).filter((t) => t.present).map((t) => t.id),
    object: perceived.visible.filter((v) => !v.role && !v.name.includes("passage")).map((v) => v.name)
  };

  // Possible actions
  const possibleActions = new Set(["inspect", "speak"]);
  if (perceived.visible.some((v) => v.name.includes("passage"))) possibleActions.add("move");
  const heldItems = canonicalLedger.getEquipmentHeldBy(run, obs);
  if (heldItems.length > 0) {
    possibleActions.add("give");
    if (heldItems.some((i) => i.capability?.includes("photo") || /camera/i.test(i.id))) possibleActions.add("photograph");
    if (heldItems.some((i) => i.capability?.includes("measurement") || /instrument/i.test(i.id))) possibleActions.add("test");
  }
  if (Object.values(team).some((t) => t.present)) {
    possibleActions.add("order_follow");
    possibleActions.add("order_hold");
    possibleActions.add("assign_task");
  }

  // Conversational memory
  const recentMessages = (run.expedition?.messages ?? [])
    .filter((m) => m.state === "delivered")
    .slice(-2)
    .map((m) => `${m.sender.toUpperCase()}: "${m.text}"`);

  const packet = {
    version: VERSION,
    observer: obs === playerId ? "player" : obs,
    location: perceived.location_id,
    time: formatTime(run.expedition?.clock?.interval ?? 0),
    perception: {
      visible: visibleList,
      audible: audibleList
    },
    team,
    recent_events: recentEvents.slice(-3),
    conversational_memory: recentMessages,
    available_referents: availableReferents,
    possible_actions: Array.from(possibleActions)
  };

  return Object.freeze(packet);
}

module.exports = {
  VERSION,
  compileObserverContext
};
