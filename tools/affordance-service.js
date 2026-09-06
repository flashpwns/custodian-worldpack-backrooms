"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const perceptionService = require("./perception-service");

const VERSION = "yellow-beast-affordance-service@v1";

function getEntityAffordances(entityId, actorId, run) {
  if (!entityId || !run) return { object: entityId, affordances: [], blocked: [] };
  const id = String(entityId).trim();
  const affordances = [];
  const blocked = [];

  // Check if entity is equipment
  const eq = canonicalLedger.getEquipment(run, id);
  if (eq) {
    const holder = eq.holder;
    if (holder === actorId) {
      affordances.push("give", "inspect", "use");
      if (eq.capability === "photographic documentation" || /camera|record/i.test(id)) affordances.push("take_photo", "photograph");
      if (eq.capability === "qualitative measurement" || /instrument|meter/i.test(id)) affordances.push("test", "measure");
    } else if (holder) {
      affordances.push("inspect", "ask_for");
      blocked.push({ action: "use", reason: "held_by_another" });
      blocked.push({ action: "give", reason: "not_held" });
    } else {
      affordances.push("pick_up", "inspect");
    }
    return { object: id, affordances, blocked };
  }

  // Check if entity is coworker
  const coworker = canonicalLedger.getObserverMember(run, id);
  if (coworker && (coworker.personnel_id ?? coworker.id) !== actorId) {
    affordances.push("speak", "give", "order_follow", "order_hold", "inspect");
    return { object: id, affordances, blocked };
  }

  // Check if entity is exit
  const topology = perceptionService.resolveEntityLocation(run, actorId);
  if (perceptionService.reachable(actorId, id, run)) {
    affordances.push("walk_through", "move", "inspect");
  } else {
    affordances.push("inspect");
    blocked.push({ action: "walk_through", reason: "unreachable_or_blocked" });
  }

  // Generic object
  if (!affordances.includes("inspect")) affordances.push("inspect");

  return { object: id, affordances, blocked };
}

function validatePreconditions({ actor, action, target = null, equipment = null }, run) {
  const normAction = String(action ?? "").toUpperCase();
  const actorLoc = perceptionService.resolveEntityLocation(run, actor);
  if (!actorLoc) {
    return { valid: false, reason: "actor_not_found", alternatives: [] };
  }

  if (normAction === "MOVE") {
    if (!target) return { valid: false, reason: "target_exit_required", alternatives: [] };
    const canReach = perceptionService.reachable(actor, target, run);
    if (!canReach) {
      return { valid: false, reason: "exit_unreachable_or_blocked", alternatives: ["inspect(route)"] };
    }
    return { valid: true };
  }

  if (normAction === "INSPECT" || normAction === "LOOK") {
    if (target && !perceptionService.canSee(actor, target, run)) {
      return { valid: false, reason: "target_not_visible", alternatives: ["orient", "use(light)"] };
    }
    return { valid: true };
  }

  if (normAction === "TRANSFER" || normAction === "HANDOFF" || normAction === "GIVE") {
    if (!equipment) return { valid: false, reason: "equipment_not_specified", alternatives: [] };
    const holder = canonicalLedger.getEquipmentHolder(run, equipment);
    if (holder !== actor) {
      return { valid: false, reason: "equipment_not_held", alternatives: [`pick_up(${equipment})`] };
    }
    if (!target) return { valid: false, reason: "recipient_required", alternatives: [] };
    if (!perceptionService.sameRoom(actor, target, run)) {
      return { valid: false, reason: "recipient_out_of_reach", alternatives: ["regroup", "move_to_recipient"] };
    }
    return { valid: true };
  }

  if (normAction === "PHOTOGRAPH") {
    const items = canonicalLedger.getEquipmentHeldBy(run, actor);
    const camera = items.find((item) => item.id === "recording-device" || item.capability === "photographic documentation");
    if (!camera) {
      return {
        valid: false,
        reason: "camera_not_held",
        alternatives: ["ask_coworker_to_photograph", "request_camera"]
      };
    }
    if (target && !perceptionService.canSee(actor, target, run)) {
      return { valid: false, reason: "target_not_visible", alternatives: ["approach_target", "use(light)"] };
    }
    return { valid: true };
  }

  if (normAction === "TEST" || (normAction === "USE" && (!equipment || equipment.includes("instrument")))) {
    const items = canonicalLedger.getEquipmentHeldBy(run, actor);
    const inst = items.find((item) => item.id === "survey-instrument" || item.capability === "qualitative measurement");
    if (!inst) {
      return {
        valid: false,
        reason: "instrument_not_held",
        alternatives: ["ask_coworker_to_test", "request_instrument"]
      };
    }
    return { valid: true };
  }

  if (normAction.startsWith("ORDER_")) {
    if (!target) return { valid: false, reason: "order_target_coworker_required", alternatives: [] };
    if (!perceptionService.canHear(target, actor, run)) {
      return { valid: false, reason: "coworker_cannot_hear_order", alternatives: ["use(radio)", "approach_coworker"] };
    }
    return { valid: true };
  }

  return { valid: true };
}

module.exports = {
  VERSION,
  getEntityAffordances,
  validatePreconditions
};
