"use strict";

const crypto = require("node:crypto");
const operationalTime = require("./operational-time");
const dynamicsRuntime = require("./operational-dynamics");

const VERSION = "yellow-beast-communications@v1";
const MESSAGE_STATES = Object.freeze(["composed", "queued", "transmitting", "delayed", "delivered", "acknowledged", "failed", "expired"]);
const CHECK_IN_STATES = Object.freeze(["scheduled", "approaching", "due", "transmitting", "completed", "overdue", "missed", "waived"]);
const clone = (value) => structuredClone(value);

function ensure(expedition) {
  operationalTime.ensure(expedition);
  expedition.communications ??= { version: VERSION, check_ins: [], last_successful_contact: null, history: [] };
  expedition.communications.version ??= VERSION;
  expedition.communications.check_ins ??= [];
  expedition.communications.history ??= [];
  expedition.messages ??= [];
  for (const message of expedition.messages) {
    message.state ??= message.delivery_status === "delivered" ? "delivered" : message.delivery_status === "failed" || message.delivery_status === "unavailable" ? "failed" : message.delivery_status === "delayed" ? "delayed" : "queued";
    message.history ??= [{ sequence: 1, from: null, to: message.state, at: message.interval ?? expedition.clock.interval, reason: "migrated communication record" }];
    message.sent_at ??= message.interval ?? 0;
    message.intended_recipients ??= message.intended_recipient ? [message.intended_recipient] : [];
    message.actual_recipients ??= message.state === "delivered" || message.state === "acknowledged" ? [...message.intended_recipients] : [];
  }
  return expedition.communications;
}

function identifier(expedition, parts) { return `message-${crypto.createHash("sha256").update(JSON.stringify([expedition.id, expedition.messages.length + 1, ...parts])).digest("hex").slice(0, 18)}`; }
function deliveryStatus(state) { return ["delivered", "acknowledged"].includes(state) ? "delivered" : state; }
function transition(expedition, message, to, reason, at = expedition.clock.interval) {
  if (!MESSAGE_STATES.includes(to)) throw new Error(`unsupported message state: ${to}`);
  if (message.state === to) return false;
  const terminal = new Set(["acknowledged", "failed", "expired"]);
  if (terminal.has(message.state)) return false;
  const from = message.state; message.state = to; message.delivery_status = deliveryStatus(to);
  if (["delivered", "acknowledged"].includes(to)) { message.delivered_at ??= at; message.actual_recipients = [...message.intended_recipients]; }
  if (to === "acknowledged") message.acknowledged_at = at;
  message.history.push({ sequence: message.history.length + 1, from, to, at, reason });
  ensure(expedition).history.push({ sequence: expedition.communications.history.length + 1, kind: "message-transition", message_id: message.id, from, to, at, reason });
  return true;
}

function createMessage(expedition, spec) {
  ensure(expedition); const at = expedition.clock.interval;
  const message = {
    id: spec.id ?? identifier(expedition, [spec.sender, spec.recipient, spec.channel, spec.purpose, at]),
    sender: spec.sender,
    intended_recipient: spec.recipient,
    intended_recipients: Array.isArray(spec.recipients) ? [...spec.recipients] : [spec.recipient],
    actual_recipients: [],
    channel: spec.channel,
    purpose: spec.purpose ?? "routine-report",
    text: String(spec.text ?? "").slice(0, 2000),
    state: "composed",
    delivery_status: "composed",
    sent_at: at,
    interval: at,
    delivered_at: null,
    acknowledged_at: null,
    interference: spec.interference ? clone(spec.interference) : null,
    failure_reason: null,
    evidence_ids: [...(spec.evidence_ids ?? [])],
    provenance: spec.provenance ?? "authoritative-communication-runtime",
    history: [{ sequence: 1, from: null, to: "composed", at, reason: "message composed" }]
  };
  expedition.messages.push(message); return message;
}

function local(expedition, { sender, recipients, text, purpose = "local-conversation", eligible, failure_reason = null }) {
  const intended = recipients.map((entry) => typeof entry === "string" ? entry : entry.id);
  const message = createMessage(expedition, { sender, recipient: intended[0] ?? "team", recipients: intended, channel: "LOCAL", purpose, text });
  transition(expedition, message, eligible ? "delivered" : "failed", eligible ? "heard within legitimate speaking range" : failure_reason ?? "outside legitimate speaking range");
  if (!eligible) message.failure_reason = failure_reason ?? "The intended recipient could not hear the message.";
  if (eligible) expedition.communications.last_successful_contact = { channel: "LOCAL", recipients: intended, at: expedition.clock.interval };
  return { ok: eligible, message, reason: eligible ? "The local message is heard." : message.failure_reason };
}

function failRadio(expedition, { sender, recipient = "Standard", text, purpose = "routine-report", reason }) {
  const message = createMessage(expedition, { sender, recipient, channel: "FIELD_RADIO", purpose, text });
  transition(expedition, message, "failed", reason ?? "The field-radio transmission could not begin.");
  message.failure_reason = reason ?? "The field-radio transmission could not begin.";
  return { ok: false, message, reason: message.failure_reason };
}

function queueRadio(run, definition, { sender, recipient = "Standard", text, purpose = "routine-report", evidence_ids = [], acknowledgment = true, acknowledgment_delay = null }) {
  const expedition = run.expedition; ensure(expedition); const at = expedition.clock.interval;
  const senderLocation = run.spatial?.personnel_locations?.[sender] ?? run.spatial?.player_location;
  const senderMember = expedition.team?.members?.find((member) => (member.personnel_id ?? member.id) === sender);
  const senderConnection = senderMember?.movement_history?.at(-1)?.connection_id ?? (senderLocation === run.spatial?.player_location ? run.spatial?.route_history?.at(-1)?.connection_id : null);
  const zone = dynamicsRuntime.interference(definition, senderLocation, senderConnection);
  const message = createMessage(expedition, { sender, recipient, channel: "FIELD_RADIO", purpose, text, evidence_ids, interference: zone ? { id: zone.id, public_description: zone.public_description, additional_delay: zone.additional_delay } : null });
  transition(expedition, message, "queued", "accepted into the field-radio transmission queue", at);
  if (expedition.radio) { expedition.radio.state = "transmitting"; expedition.radio.last_transition = "message-queued"; }
  operationalTime.schedule(expedition, { id: `transmit-${message.id}`, event_type: "communication.transmit", scheduled_interval: at, source: sender, target: recipient, payload: { message_id: message.id, acknowledgment, acknowledgment_delay }, visibility_policy: "known" });
  return { ok: true, message };
}

function scheduleCheckIns(expedition, definition, { from = null } = {}) {
  ensure(expedition); const base = from ?? expedition.clock.interval;
  for (const authored of definition.communications?.check_ins ?? []) {
    const existing = expedition.communications.check_ins.find((item) => item.id === authored.id);
    if (existing) continue;
    const record = { id: authored.id, label: authored.public_label, scheduled_at: base, due_at: base + authored.due_after, missed_at: base + authored.due_after + authored.miss_after, approaching_within: authored.approaching_within, state: "scheduled", completed_at: null, waived_at: null, message_id: null, history: [{ sequence: 1, from: null, to: "scheduled", at: base, reason: "check-in scheduled" }] };
    expedition.communications.check_ins.push(record);
    operationalTime.schedule(expedition, { id: `check-in-due-${record.id}`, event_type: "check-in.due", scheduled_interval: record.due_at, source: "Standard", target: expedition.id, payload: { check_in_id: record.id }, visibility_policy: "known" });
    operationalTime.schedule(expedition, { id: `check-in-missed-${record.id}`, event_type: "check-in.missed", scheduled_interval: record.missed_at, source: "Standard", target: expedition.id, payload: { check_in_id: record.id }, visibility_policy: "known" });
  }
  updateCheckIns(expedition); return expedition.communications.check_ins;
}

function transitionCheckIn(expedition, checkIn, to, reason) {
  if (!CHECK_IN_STATES.includes(to) || checkIn.state === to) return false;
  const from = checkIn.state; checkIn.state = to;
  checkIn.history.push({ sequence: checkIn.history.length + 1, from, to, at: expedition.clock.interval, reason });
  ensure(expedition).history.push({ sequence: expedition.communications.history.length + 1, kind: "check-in-transition", check_in_id: checkIn.id, from, to, at: expedition.clock.interval, reason });
  return true;
}

function updateLegacyClock(expedition, checkIn) {
  expedition.clock.check_in_due_at = checkIn?.due_at ?? null;
  expedition.clock.check_in_overdue = checkIn?.state === "overdue" || checkIn?.history?.some((entry) => entry.to === "overdue") || false;
  expedition.clock.check_in_missed = checkIn?.state === "missed" || checkIn?.history?.some((entry) => entry.to === "missed") || false;
  expedition.clock.check_in_completed_at = checkIn?.completed_at ?? null;
}

function updateCheckIns(expedition) {
  ensure(expedition); const now = expedition.clock.interval;
  for (const checkIn of expedition.communications.check_ins) {
    if (["completed", "waived"].includes(checkIn.state)) continue;
    const message = expedition.messages.find((item) => (item.check_in_id === checkIn.id || item.purpose === "scheduled-check-in") && !["failed", "expired"].includes(item.state));
    if (now >= checkIn.missed_at) transitionCheckIn(expedition, checkIn, "missed", "the declared reporting window closed without delivery");
    else if (message && ["queued", "transmitting", "delayed"].includes(message.state)) { checkIn.message_id = message.id; transitionCheckIn(expedition, checkIn, now > checkIn.due_at ? "overdue" : "transmitting", now > checkIn.due_at ? "the field-status report remains unconfirmed after its due interval" : "a field-status report is in the delivery queue"); }
    else if (now > checkIn.due_at) transitionCheckIn(expedition, checkIn, "overdue", "the scheduled report is overdue but the late-report window remains open");
    else if (now === checkIn.due_at) transitionCheckIn(expedition, checkIn, "due", "the scheduled field report is due");
    else if (checkIn.due_at - now <= checkIn.approaching_within) transitionCheckIn(expedition, checkIn, "approaching", "the scheduled field report is approaching");
  }
  updateLegacyClock(expedition, expedition.communications.check_ins[0]);
  if (expedition.clock.check_in_missed && !expedition.deviations?.includes("missed-declared-check-in")) expedition.deviations?.push("missed-declared-check-in");
  return expedition.communications.check_ins;
}

function completeCheckIn(expedition, message) {
  const checkIn = ensure(expedition).check_ins.find((item) => item.id === message.check_in_id) ?? expedition.communications.check_ins[0];
  if (!checkIn || ["completed", "waived"].includes(checkIn.state)) return checkIn;
  const late = expedition.clock.interval > checkIn.due_at;
  checkIn.completed_at = expedition.clock.interval; checkIn.message_id = message.id;
  transitionCheckIn(expedition, checkIn, "completed", late ? "Standard received the field report after its due interval" : "Standard received the scheduled field report");
  updateLegacyClock(expedition, checkIn); return checkIn;
}

function handleEvent(run, definition, event) {
  const expedition = run.expedition; ensure(expedition); const message = event.payload?.message_id ? expedition.messages.find((entry) => entry.id === event.payload.message_id) : null;
  if (event.event_type === "communication.transmit") {
    if (!message || !["queued", "composed"].includes(message.state)) return { status: "cancelled", reason: "message no longer queued" };
    const zone = message.interference;
    transition(expedition, message, zone ? "delayed" : "transmitting", zone ? zone.public_description : "field-radio transmission begun");
    if (expedition.radio) { expedition.radio.state = zone ? "intermittent" : "transmitting"; expedition.radio.last_transition = zone ? "transmission-delayed-by-interference" : "outbound-transmission"; }
    const baseDelay = Number(definition.communications?.standard_delivery_delay ?? 1); const delay = baseDelay + Number(zone?.additional_delay ?? 0);
    operationalTime.schedule(expedition, { id: `deliver-${message.id}`, event_type: "communication.deliver", scheduled_interval: message.sent_at + delay, source: message.sender, target: message.intended_recipient, payload: { message_id: message.id, acknowledgment: event.payload.acknowledgment, acknowledgment_delay: event.payload.acknowledgment_delay }, visibility_policy: "known" });
    return { status: "completed", reason: zone ? "transmission entered an interference delay" : "transmission started", result: { message_id: message.id, state: message.state } };
  }
  if (event.event_type === "communication.deliver") {
    if (!message || ["failed", "expired", "acknowledged"].includes(message.state)) return { status: "cancelled", reason: "message is no longer deliverable" };
    transition(expedition, message, "delivered", "the intended recipient received the radio message");
    if (expedition.radio) { expedition.radio.state = event.payload.acknowledgment === false ? "available" : "awaiting-response"; expedition.radio.last_transition = "transmission-delivered"; expedition.radio.last_delivery = { status: "delivered", interval: expedition.clock.interval }; }
    expedition.communications.last_successful_contact = { channel: "FIELD_RADIO", recipient: message.intended_recipient, at: expedition.clock.interval };
    for (const id of message.evidence_ids) { const evidence = expedition.evidence?.find((item) => item.id === id); if (evidence) { evidence.available_to_standard = true; evidence.reporting_state = "reported-to-standard"; } }
    if (message.check_in_id || message.purpose === "scheduled-check-in") completeCheckIn(expedition, message);
    if (event.payload.acknowledgment !== false) {
      const delay = event.payload.acknowledgment_delay ?? definition.communications?.standard_acknowledgment_delay ?? 1;
      operationalTime.schedule(expedition, { id: `acknowledge-${message.id}`, event_type: "communication.acknowledge", scheduled_interval: expedition.clock.interval + delay, source: message.intended_recipient, target: message.sender, payload: { message_id: message.id }, visibility_policy: "known" });
    }
    return { status: "completed", reason: "message delivered", result: { message_id: message.id, state: message.state } };
  }
  if (event.event_type === "communication.acknowledge") {
    if (!message || !["delivered"].includes(message.state)) return { status: "cancelled", reason: "delivered message unavailable for acknowledgment" };
    transition(expedition, message, "acknowledged", "Standard acknowledged the delivered message");
    if (expedition.radio) { expedition.radio.state = "available"; expedition.radio.last_transition = "standard-acknowledgment-received"; }
    if (message.purpose === "radio-check") {
      expedition.radio ??= {}; expedition.radio.check_completed = true; expedition.radio.authorized = true; expedition.radio.state = "available"; expedition.radio.last_transition = "scheduled-standard-acknowledgment";
      scheduleCheckIns(expedition, definition, { from: expedition.clock.interval });
    }
    return { status: "completed", reason: "message acknowledged", result: { message_id: message.id, state: message.state } };
  }
  if (event.event_type === "check-in.due" || event.event_type === "check-in.missed") { updateCheckIns(expedition); return { status: "completed", reason: event.event_type === "check-in.due" ? "check-in reached its due interval" : "check-in reporting window evaluated" }; }
  return null;
}

function waiveCheckIn(expedition, id, reason) {
  const checkIn = ensure(expedition).check_ins.find((entry) => entry.id === id); if (!checkIn || checkIn.state === "completed") return { ok: false, code: "CHECK_IN_NOT_WAIVABLE" };
  checkIn.waived_at = expedition.clock.interval; transitionCheckIn(expedition, checkIn, "waived", reason ?? "communication conditions authorized a waiver"); updateLegacyClock(expedition, checkIn); return { ok: true, check_in: checkIn };
}

function project(expedition) {
  const runtime = expedition.communications ?? { check_ins: [], last_successful_contact: null };
  const personnel = new Map((expedition.team?.members ?? []).map((member) => [member.personnel_id ?? member.id, member]));
  const controlledId = expedition.team?.members?.[0] ? (expedition.team.members[0].personnel_id ?? expedition.team.members[0].id) : null;
  const participant = (id) => { if (id === "Standard") return "Standard"; const member = personnel.get(id); return member ? (id === controlledId ? "You" : member.display_name ?? [member.first_name, member.last_name].filter(Boolean).join(" ")) : id; };
  return {
    version: VERSION,
    check_ins: runtime.check_ins.map((item) => ({ id: item.id, label: item.label, state: item.state, state_label: item.state.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), due_at: item.due_at, completed_at: item.completed_at, summary: item.state === "approaching" ? `Due in ${item.due_at - expedition.clock.interval} interval.` : item.state === "due" ? "The field report is due now." : item.state === "transmitting" ? "A report is transmitting; delivery is not yet confirmed." : item.state === "overdue" ? "The report is overdue, but a late transmission may still be received." : item.state === "missed" ? "The reporting window closed without delivery." : item.state === "completed" ? "Standard received the field report." : item.state === "waived" ? "Communication conditions authorized a waiver." : `Due at operational interval ${item.due_at}.` })),
    messages: (expedition.messages ?? []).map((message) => ({ id: message.id, sender: participant(message.sender), recipient: participant(message.intended_recipient), channel: message.channel, purpose: message.purpose, sent_at: message.sent_at, state: message.state, state_label: message.state.replace(/\b\w/g, (letter) => letter.toUpperCase()), delivered_at: message.delivered_at, acknowledged_at: message.acknowledged_at, known_reason: message.failure_reason ?? message.interference?.public_description ?? null })),
    last_successful_contact: clone(runtime.last_successful_contact)
  };
}

module.exports = { VERSION, MESSAGE_STATES, CHECK_IN_STATES, ensure, transition, createMessage, local, failRadio, queueRadio, scheduleCheckIns, updateCheckIns, completeCheckIn, handleEvent, waiveCheckIn, project };
