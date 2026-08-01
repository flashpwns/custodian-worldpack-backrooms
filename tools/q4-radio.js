"use strict";

const VERSION = "yellow-beast-q4-radio@v1";
const STATES = Object.freeze(["unavailable", "establishing", "available", "transmitting", "awaiting-response", "intermittent", "lost", "intentionally-silent"]);

function ensure(expedition) {
  expedition.radio ??= { version: VERSION, state: "unavailable", check_completed: false, authorized: false, last_transition: "expedition-created", last_delivery: null };
  expedition.radio.version ??= VERSION;
  if (!STATES.includes(expedition.radio.state)) expedition.radio.state = expedition.radio.check_completed ? "available" : "unavailable";
  expedition.radio.check_completed = Boolean(expedition.radio.check_completed);
  expedition.radio.authorized = Boolean(expedition.radio.authorized);
  return expedition.radio;
}

function transition(expedition, state, reason) {
  if (!STATES.includes(state)) throw new Error(`unsupported radio state: ${state}`);
  const radio = ensure(expedition);
  radio.state = state;
  radio.last_transition = reason;
  return radio;
}

function authorize(expedition) { const radio = transition(expedition, "establishing", "threshold-crossed"); radio.authorized = true; return radio; }
function completeCheck(expedition) { const radio = transition(expedition, "available", "standard-acknowledged-radio-check"); radio.authorized = true; radio.check_completed = true; radio.last_delivery = { status: "delivered", interval: expedition.clock?.interval ?? 0 }; return radio; }
function startTransmission(expedition) { const radio = ensure(expedition); if (!["available", "intermittent"].includes(radio.state)) return { ok: false, state: radio.state }; transition(expedition, "transmitting", "outbound-transmission"); return { ok: true, radio }; }
function delivered(expedition, { awaiting = false } = {}) { const radio = transition(expedition, awaiting ? "awaiting-response" : "available", awaiting ? "transmission-delivered-awaiting-response" : "transmission-delivered"); radio.last_delivery = { status: "delivered", interval: expedition.clock?.interval ?? 0 }; return radio; }
function failed(expedition, intermittent = false) { return transition(expedition, intermittent ? "intermittent" : "lost", intermittent ? "transmission-not-confirmed" : "link-lost"); }

function available(expedition) { const radio = ensure(expedition); return radio.authorized && radio.check_completed && ["available", "transmitting", "awaiting-response", "intermittent"].includes(radio.state); }
function label(expedition) {
  const radio = ensure(expedition);
  return ({
    unavailable: "LINK UNAVAILABLE",
    establishing: "ESTABLISHING LINK",
    available: "CHANNEL READY",
    transmitting: "TRANSMITTING",
    "awaiting-response": "AWAITING RESPONSE",
    intermittent: "INTERMITTENT — DELIVERY NOT GUARANTEED",
    lost: "LINK LOST",
    "intentionally-silent": "INTENTIONAL RADIO SILENCE"
  })[radio.state];
}

module.exports = { VERSION, STATES, ensure, transition, authorize, completeCheck, startTransmission, delivered, failed, available, label };
