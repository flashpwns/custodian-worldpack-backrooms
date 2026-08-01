"use strict";

const crypto = require("node:crypto");
const communications = require("./communication-runtime");

const VERSION = "yellow-beast-team-runtime@v1";
const ORDER_STATES = Object.freeze(["accepted", "delayed", "clarification-requested", "refused", "unheard", "attempting", "failed", "completed"]);
const TASKS = new Set(["follow", "hold", "investigate", "operate", "wait", "move-to", "return", "restore-contact", "assist", "communicate-local", "transmit-radio", "abandon"]);
const clone = (value) => structuredClone(value);

function playerId(run) { return run.session?.startup?.player?.observer_id ?? null; }
function memberId(member) { return member.personnel_id ?? member.id; }
function display(member) { return member.display_name ?? ([member.first_name, member.last_name].filter(Boolean).join(" ") || "Assigned teammate"); }
function location(run, id) { return run.spatial?.personnel_locations?.[id] ?? null; }

function ensure(run) {
  const expedition = run.expedition; if (!expedition) return null;
  expedition.team_runtime ??= { version: VERSION, orders: [], decision_history: [], observer_knowledge: {}, revision: 0 };
  const runtime = expedition.team_runtime; runtime.version ??= VERSION; runtime.orders ??= []; runtime.decision_history ??= []; runtime.observer_knowledge ??= {}; runtime.revision ??= 0;
  const player = playerId(run); runtime.observer_knowledge[player] ??= {};
  for (const member of expedition.team?.members ?? []) {
    const id = memberId(member);
    member.health ??= "uninjured";
    member.condition ??= member.observed_condition === "appears-normal" ? "normal" : member.observed_condition ?? "normal";
    member.operational_pressure = Number.isFinite(member.operational_pressure) ? member.operational_pressure : 0;
    member.current_task ??= id === player ? { type: "player-directed", state: "active", target: null } : { type: "follow", state: "active", target: player };
    member.current_intent ??= id === player ? "player-directed" : "maintain team contact";
    member.assigned_equipment ??= Object.entries(expedition.equipment ?? {}).filter(([, item]) => item.assigned_to === id || item.holder === id).map(([key]) => key);
    member.known_information ??= [];
    member.last_communication ??= null;
    member.orders_received ??= [];
    member.decision_history ??= [];
    member.movement_history ??= [];
    member.mission_authority ??= id === player ? "controlled field authority" : "assigned operational authority";
    member.last_known_status ??= { location: location(run, id), condition: member.condition, health: member.health, at: run.expedition.clock?.interval ?? 0, source: "assignment" };
    runtime.observer_knowledge[player][id] ??= clone(member.last_known_status);
  }
  observe(run);
  return runtime;
}

function observe(run) {
  const runtime = run.expedition?.team_runtime; if (!runtime || !run.spatial) return;
  const player = playerId(run); const playerLocation = location(run, player); const knowledge = runtime.observer_knowledge[player] ??= {};
  for (const member of run.expedition.team.members) {
    const id = memberId(member); const actual = location(run, id); if (id === player || (actual && actual === playerLocation)) {
      const record = { location: actual, condition: member.condition, health: member.health, status: member.status, at: run.expedition.clock.interval, source: "direct-observation" };
      knowledge[id] = record; member.last_known_status = clone(record); run.spatial.last_confirmed_personnel_positions[id] = { location: actual, at: run.expedition.clock.interval, source: "visual" }; member.last_contact = "visually confirmed now"; member.contact_category = id === player ? "SELF" : "LOCAL";
    } else if (id !== player) { member.contact_category = "CONTACT LOST"; member.last_contact = `last confirmed at interval ${knowledge[id]?.at ?? "unknown"}`; }
  }
}

function connected(definition, from, to) { return (definition.connections ?? []).find((edge) => edge.lock_state !== "blocked" && ((edge.from === from && edge.to === to) || (edge.bidirectional && edge.to === from && edge.from === to))); }
function knownDestination(run, definition, from, target) {
  const locations = Object.fromEntries((definition.locations ?? []).map((entry) => [entry.id, entry]));
  const query = String(target ?? "").toLowerCase();
  const declaredEdge = (definition.connections ?? []).find((edge) => edge.id === target && ((edge.from === from) || (edge.bidirectional && edge.to === from)));
  const edgeDestination = declaredEdge ? (declaredEdge.from === from ? declaredEdge.to : declaredEdge.from) : null;
  const candidate = edgeDestination ? locations[edgeDestination] : Object.values(locations).find((entry) => entry.id === target || entry.name.toLowerCase() === query || (entry.aliases ?? []).some((alias) => alias.toLowerCase() === query));
  if (!candidate) return null;
  const edge = declaredEdge ?? connected(definition, from, candidate.id); if (!edge || run.spatial.blocked_paths?.[edge.id]) return null;
  if (!run.spatial.discovered_connections?.[edge.id] && !["institutional", "visible"].includes(edge.visibility)) return null;
  return { location: candidate, edge };
}

function orderId(run, recipient, type, target) { return `order-${crypto.createHash("sha256").update(JSON.stringify([run.expedition.id, run.expedition.team_runtime.orders.length + 1, recipient, type, target, run.expedition.clock.interval])).digest("hex").slice(0, 18)}`; }
function issueOrder(run, spatialDefinition, { recipient, type, target = null, channel = "LOCAL" }) {
  const runtime = ensure(run); const player = playerId(run); const member = run.expedition.team.members.find((entry) => memberId(entry) === recipient && recipient !== player);
  const order = { id: orderId(run, recipient, type, target), issuer: player, recipient, type, target, channel, issued_at: run.expedition.clock.interval, state: null, reason: null, history: [] };
  function resolve(state, reason) { order.state = state; order.reason = reason; order.history.push({ sequence: 1, from: null, to: state, at: run.expedition.clock.interval, reason }); runtime.orders.push(order); if (member) member.orders_received.push(order.id); return { ok: true, order: clone(order), public_reason: `${member ? display(member) : "The intended teammate"}: ${reason}` }; }
  if (!member) return resolve("unheard", "The order has no available recipient.");
  if (channel === "LOCAL" && location(run, player) !== location(run, recipient)) return resolve("unheard", "No local contact is confirmed; the order was not heard.");
  if (!TASKS.has(type)) return resolve("clarification-requested", "The requested task is not clear enough to act on.");
  if (["dead", "missing", "incapacitated"].includes(String(member.status).toLowerCase()) || member.health === "incapacitated") return resolve("refused", "I cannot accept that task in my current condition.");
  if (["investigate", "move-to", "return"].includes(type) && /injur|wound/i.test(String(member.condition))) return resolve("delayed", "I need field assistance before I can safely take another movement task.");
  if (member.current_task?.state === "active" && !["follow", "wait"].includes(member.current_task.type) && type !== "assist") return resolve("delayed", `I am still completing ${member.current_task.type}; I will not leave it unfinished.`);
  if (["investigate", "move-to", "return"].includes(type)) {
    const destination = knownDestination(run, spatialDefinition, location(run, recipient), target);
    if (!destination) return resolve("refused", "No known, available route supports that movement.");
    member.current_task = { type, state: "pending", target: destination.location.id, connection_id: destination.edge.id, order_id: order.id };
    member.current_intent = type === "return" ? "return toward the declared safe location" : "move toward the declared task location";
    run.spatial.team_behavior[recipient] = "independent";
    return resolve("accepted", `Understood. I will move toward ${destination.location.name}.`);
  }
  if (type === "operate") {
    const item = run.expedition.equipment?.[target];
    if (!item || item.holder !== recipient || !["operational", "serviceable", "usable"].includes(String(item.state).toLowerCase())) return resolve("refused", "I do not have operational access to the required equipment.");
    member.current_task = { type, state: "pending", target, order_id: order.id }; member.current_intent = "operate assigned equipment"; return resolve("accepted", "Understood. I will operate the assigned equipment.");
  }
  if (type === "assist") { member.current_task = { type, state: "pending", target, order_id: order.id }; member.current_intent = "assist an injured teammate"; return resolve("accepted", "Understood. I will assist if I can reach them safely."); }
  if (type === "communicate-local") { member.current_task = { type, state: "pending", target: target ?? player, order_id: order.id }; member.current_intent = "communicate within confirmed speaking range"; return resolve("accepted", "Understood. I will report locally."); }
  if (type === "transmit-radio") {
    const radio = Object.entries(run.expedition.equipment ?? {}).find(([, item]) => item.holder === recipient && /radio/i.test(`${item.id ?? ""} ${item.label ?? ""}`) && ["operational", "serviceable", "usable"].includes(String(item.state).toLowerCase()) && Number(item.charges ?? 1) > 0);
    if (!radio) return resolve("refused", "I do not have operational access to a field radio.");
    member.current_task = { type, state: "pending", target: target ?? "Standard", equipment_id: radio[0], order_id: order.id }; member.current_intent = "transmit an operational report"; return resolve("accepted", "Understood. I will transmit when the radio queue is available.");
  }
  if (type === "hold" || type === "wait") { member.current_task = { type, state: "active", target: location(run, recipient), order_id: order.id }; member.current_intent = "hold the current position"; run.spatial.team_behavior[recipient] = "remain"; return resolve("accepted", "Understood. I will hold this position."); }
  if (type === "follow" || type === "restore-contact") { member.current_task = { type, state: "active", target: player, order_id: order.id }; member.current_intent = "restore and maintain team contact"; run.spatial.team_behavior[recipient] = "follow"; return resolve("accepted", "Understood. I will restore contact and follow."); }
  member.current_task = { type: "abandon", state: "completed", target, order_id: order.id }; member.current_intent = "leave an impossible task"; return resolve("accepted", "The prior task is abandoned under the current instruction.");
}

function updateOrder(runtime, member, state, reason, at) {
  const order = runtime.orders.find((entry) => entry.id === member.current_task?.order_id); if (!order || order.state === state) return;
  const from = order.state; order.state = state; order.reason = reason; order.history.push({ sequence: order.history.length + 1, from, to: state, at, reason });
}

function decide(run, spatialDefinition, dynamics = null) {
  const runtime = ensure(run); const player = playerId(run); const decisions = [];
  for (const member of run.expedition.team.members) {
    const id = memberId(member); if (id === player || member.status !== "active") continue;
    const task = member.current_task ?? { type: "follow", state: "active", target: player };
    let decision = { member_id: id, at: run.expedition.clock.interval, task: task.type, action: "wait", result: "continued-current-task", reason: "No independent action was required." };
    if (["investigate", "move-to", "return"].includes(task.type) && ["pending", "active"].includes(task.state)) {
      const route = knownDestination(run, spatialDefinition, location(run, id), task.target);
      if (!route) { task.state = "failed"; decision = { ...decision, action: "attempt-move", result: "failed", reason: "The declared route is no longer known and available." }; updateOrder(runtime, member, "failed", decision.reason, run.expedition.clock.interval); }
      else {
        const from = location(run, id); run.spatial.personnel_locations[id] = route.location.id;
        member.movement_history.push({ sequence: member.movement_history.length + 1, from, to: route.location.id, connection_id: route.edge.id, at: run.expedition.clock.interval, source: "deterministic-team-decision" });
        task.state = "completed"; member.current_intent = "hold after completing the assigned movement"; run.spatial.team_behavior[id] = "remain";
        if (task.type === "investigate") member.known_information.push({ kind: "location-investigated", location: route.location.id, at: run.expedition.clock.interval, source: "direct-observation" });
        decision = { ...decision, action: "move", from, to: route.location.id, connection_id: route.edge.id, result: "completed", reason: `Moved through the known ${route.edge.relationship ?? "route"}.` };
        updateOrder(runtime, member, "completed", decision.reason, run.expedition.clock.interval);
        const observerLocation = location(run, player); if (from === observerLocation) { const known = { location: route.location.id, condition: member.condition, health: member.health, status: member.status, at: run.expedition.clock.interval, source: "observed-departure" }; runtime.observer_knowledge[player][id] = known; member.last_known_status = clone(known); run.spatial.last_confirmed_personnel_positions[id] = { location: route.location.id, at: run.expedition.clock.interval, source: "observed-departure" }; }
      }
    } else if (task.type === "operate" && task.state === "pending") { task.state = "completed"; decision = { ...decision, action: "operate-equipment", result: "completed", reason: "The assigned equipment procedure was completed." }; updateOrder(runtime, member, "completed", decision.reason, run.expedition.clock.interval); }
    else if (task.type === "assist" && task.state === "pending") {
      const target = run.expedition.team.members.find((entry) => memberId(entry) === task.target);
      if (!target || location(run, id) !== location(run, task.target)) { task.state = "failed"; decision = { ...decision, action: "assist", result: "failed", reason: "The injured teammate is not within confirmed reach." }; updateOrder(runtime, member, "failed", decision.reason, run.expedition.clock.interval); }
      else if (!/injur|wound/i.test(String(target.condition)) && target.health === "uninjured") { task.state = "completed"; decision = { ...decision, action: "assist", result: "completed", reason: "No continuing field injury required assistance." }; updateOrder(runtime, member, "completed", decision.reason, run.expedition.clock.interval); }
      else { target.condition = "stabilized minor injury"; target.health = "minor injury"; target.observed_condition = "stabilized minor injury"; task.state = "completed"; decision = { ...decision, action: "assist", result: "completed", reason: `${display(target)} was stabilized in place.` }; updateOrder(runtime, member, "completed", decision.reason, run.expedition.clock.interval); }
    } else if (task.type === "communicate-local" && task.state === "pending") {
      const recipient = task.target ?? player; const eligible = location(run, id) === location(run, recipient);
      const sent = communications.local(run.expedition, { sender: id, recipients: [recipient], text: "Operational status reported.", purpose: "team-status", eligible, failure_reason: "The intended recipient is outside confirmed speaking range." });
      member.last_communication = { message_id: sent.message.id, channel: "LOCAL", at: run.expedition.clock.interval, state: sent.message.state }; task.state = sent.ok ? "completed" : "failed"; decision = { ...decision, action: "communicate-local", result: task.state, reason: sent.reason }; updateOrder(runtime, member, task.state, decision.reason, run.expedition.clock.interval);
    } else if (task.type === "transmit-radio" && task.state === "pending") {
      const radio = run.expedition.equipment?.[task.equipment_id];
      if (!dynamics || !radio || radio.holder !== id || !["operational", "serviceable", "usable"].includes(String(radio.state).toLowerCase()) || Number(radio.charges ?? 1) <= 0) { task.state = "failed"; decision = { ...decision, action: "transmit-radio", result: "failed", reason: "Operational radio access was unavailable when transmission was attempted." }; updateOrder(runtime, member, "failed", decision.reason, run.expedition.clock.interval); }
      else { radio.charges = Number(radio.charges ?? 1) - 1; const queued = communications.queueRadio(run, dynamics, { sender: id, recipient: task.target ?? "Standard", text: "Teammate operational status report.", purpose: "team-status" }); member.last_communication = { message_id: queued.message.id, channel: "FIELD_RADIO", at: run.expedition.clock.interval, state: queued.message.state }; task.state = "completed"; decision = { ...decision, action: "transmit-radio", result: "queued", reason: "The teammate report entered the field-radio queue." }; updateOrder(runtime, member, "completed", decision.reason, run.expedition.clock.interval); }
    } else if (["follow", "restore-contact"].includes(task.type)) {
      const from = location(run, id); const destination = location(run, player);
      const following = task.type === "restore-contact" || String(run.spatial.team_behavior[id] ?? "follow").startsWith("follow");
      if (!following) decision.reason = "Held the independently assigned position.";
      else if (from === destination) decision.reason = "Maintained contact with the player.";
      else {
        const route = knownDestination(run, spatialDefinition, from, destination);
        if (!route) decision.reason = "Contact could not be restored without a known adjacent move.";
        else { run.spatial.personnel_locations[id] = route.location.id; member.movement_history.push({ sequence: member.movement_history.length + 1, from, to: route.location.id, connection_id: route.edge.id, at: run.expedition.clock.interval, source: "restore-contact-decision" }); decision = { ...decision, action: "move", from, to: route.location.id, connection_id: route.edge.id, result: "completed", reason: "Moved through a known route to restore confirmed contact." }; }
      }
    }
    member.decision_history.push({ sequence: member.decision_history.length + 1, ...clone(decision) });
    runtime.decision_history.push({ sequence: runtime.decision_history.length + 1, ...clone(decision) }); decisions.push(decision);
  }
  runtime.revision += 1; observe(run); return decisions;
}

function assist(run, target) {
  ensure(run); const player = playerId(run); const member = run.expedition.team.members.find((entry) => memberId(entry) === target && target !== player);
  if (!member) return { ok: false, code: "PERSONNEL_UNKNOWN", reason: "That teammate is not part of the assigned field team." };
  if (location(run, player) !== location(run, target)) return { ok: false, code: "PERSONNEL_OUT_OF_RANGE", reason: "Reach the teammate before attempting assistance." };
  if (!/injur|wound/i.test(String(member.condition)) && member.health === "uninjured") return { ok: false, code: "ASSISTANCE_NOT_REQUIRED", reason: "No current injury requiring field assistance is observed." };
  const before = member.condition; member.condition = "stabilized minor injury"; member.health = "minor injury"; member.observed_condition = "stabilized minor injury"; member.current_task = { type: "wait", state: "active", target: location(run, target) }; member.current_intent = "recover after field assistance";
  member.decision_history.push({ sequence: member.decision_history.length + 1, at: run.expedition.clock.interval, task: "recovery", action: "receive-assistance", result: "completed", reason: "The minor injury was stabilized." }); observe(run);
  const consequence = [...(run.expedition.operational?.consequences ?? [])].reverse().find((record) => !record.recovery && record.effects?.some((effect) => effect.kind === "personnel-condition" && effect.target === target));
  if (consequence) consequence.recovery = { kind: "personnel-stabilized", actor: player, target, at: run.expedition.clock.interval };
  return { ok: true, public_reason: `${display(member)} is stabilized and remains able to return.`, before, after: member.condition };
}

function project(run) {
  const runtime = run.expedition?.team_runtime ?? { observer_knowledge: {} }; const player = playerId(run); const knowledge = runtime.observer_knowledge?.[player] ?? {}; const playerLocation = location(run, player);
  return run.expedition.team.members.map((member) => {
    const id = memberId(member); const controlled = id === player; const local = controlled || (location(run, id) && location(run, id) === playerLocation); const known = local ? { location: location(run, id), condition: member.condition, health: member.health, status: member.status, at: run.expedition.clock.interval } : knowledge[id] ?? member.last_known_status ?? {};
    return { id, personnel_id: id, display_name: `${display(member)}${controlled ? " · YOU" : ""}`, first_name: member.first_name, last_name: member.last_name, role: `${member.role}${controlled ? " · YOU" : ""}`, clearance: member.clearance ?? null, assignment: member.assignment ?? null, controlled, contact_state: controlled ? "SELF" : local ? "LOCAL" : "CONTACT LOST", contact_category: controlled ? "SELF" : local ? "LOCAL" : "CONTACT LOST", local_eligible: !controlled && local, current_or_last_known_location: known.location ?? null, location: known.location ?? null, condition: known.condition ?? "Unknown", health: known.health ?? "Unknown", injury_state: known.health ?? "Unknown", status: known.status ?? "Unknown", last_contact_interval: known.at ?? null, last_contact: local ? "visually confirmed now" : known.at === undefined ? "No confirmed contact" : `last confirmed at interval ${known.at}`, current_task: local ? member.current_task?.type ?? "wait" : "Unknown while contact is lost", current_intent: local ? member.current_intent : null, assigned_equipment: [...(member.assigned_equipment ?? [])], equipment_verification: local ? "confirmed" : "last confirmed with teammate" };
  });
}

module.exports = { VERSION, ORDER_STATES, TASKS, ensure, observe, issueOrder, decide, assist, project, memberId };
