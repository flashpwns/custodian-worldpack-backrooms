"use strict";

// Persistent operations-desk identity. Institutional knowledge remains in the
// institutional runtime; this record provides identity and contact provenance.
const crypto = require("node:crypto");
const history = require("./world-history");
const continuity = require("./q4-personnel-continuity");
const VERSION = "yellow-beast-q4-standard-operator@v1";
const clone = (value) => structuredClone(value);
function identity(world) { return `q4-standard-${crypto.createHash("sha256").update(`${world.world_id}|standard-operator`).digest("hex").slice(0, 18)}`; }
function read(world) {
  history.assertWorld(world); const state = world.q4_standard_operator; if (state == null) return null;
  if (!state || typeof state !== "object" || Array.isArray(state) || state.version !== VERSION || typeof state.identity !== "string" || !state.identity || typeof state.call_sign !== "string" || !state.call_sign || !Array.isArray(state.contacts) || typeof state.revealed !== "boolean") throw Object.assign(new Error("invalid Standard operator state"), { code:"Q4_STANDARD_STATE_INVALID" });
  return state;
}
function ensure(world, run_id = "standard-operator-migration") {
  history.assertWorld(world); world.q4_standard_operator ??= { version: VERSION, identity: identity(world), call_sign: "CONTROL DESK", contacts: [], revealed: false };
  const state = world.q4_standard_operator; if (state.version !== VERSION) throw new Error("unsupported Standard operator state");
  if (!history.character(world, state.identity)) history.instantiateCharacter(world, { run_id, identity: state.identity, display_name: "Control Desk Operator", first_name: "Control", last_name: "Desk", role: "operations desk operator", clearance: "Q4", classification: "q4-standard-operator", provenance: "deterministic-institutional-staffing", authority: "institutional-personnel-record" });
  continuity.ensurePerson(world, run_id, state.identity); state.contacts ??= []; state.call_sign ??= "CONTROL DESK"; state.revealed ??= false;
  return state;
}
function recordContact(world, run, message) {
  const state = ensure(world, run?.run_id); if (!message || !["delivered", "acknowledged"].includes(message.state) || message.intended_recipient !== "Standard") return { ok: false, code: "STANDARD_CONTACT_NOT_DELIVERED" };
  const id = `standard-contact-${message.id}`; if (state.contacts.some((entry) => entry.id === id)) return { ok: true, idempotent: true, id };
  const record = { id, run_id: run.run_id, message_id: message.id, purpose: message.purpose, delivered_at: message.delivered_at, state: message.state };
  state.contacts.push(record); state.revealed = state.contacts.length >= 2;
  history.event(world, run.run_id, "q4.standard.contact.recorded", { operator_id: state.identity, contact: clone(record) }, "q4-standard-operator");
  continuity.recordSharedHistory(world, { run_id: run.run_id, participants: [run.session.startup.player.observer_id, state.identity], kind: "standard-contact", refs: { message_id: message.id, purpose: message.purpose }, at: message.delivered_at ?? run.expedition.clock?.interval ?? 0 });
  return { ok: true, idempotent: false, id };
}
function projection(world) { const state = read(world); if (!state) return { designation: "STANDARD", call_sign: "CONTROL DESK", identity_revealed: false, operator: null, contact_count: 0 }; return { designation: "STANDARD", call_sign: state.call_sign, identity_revealed: state.revealed, operator: state.revealed ? history.character(world, state.identity)?.display_name ?? state.call_sign : null, contact_count: state.contacts.length }; }
function context(world, institutionalProjection = null) { const state = ensure(world); return { version: "yellow-beast-standard-operator-context@v1", operator: projection(world), known_institutional_records: clone(institutionalProjection?.confirmed_knowledge ?? []), pending_reviews: clone(institutionalProjection?.pending_reviews ?? []), recent_decisions: clone(institutionalProjection?.recent_decisions ?? []) }; }
module.exports = { VERSION, read, ensure, recordContact, projection, context };
