"use strict";

const crypto = require("node:crypto");
const canonLinter = require("./canon-linter");

const VERSION = "yellow-beast-presentation-bus@v1";

const SOURCES = Object.freeze({
  AUTHORED_CANON: "AUTHORED_CANON",
  AUTHORED_VARIANT: "AUTHORED_VARIANT",
  DETERMINISTIC: "DETERMINISTIC",
  AI_INTERPRETATION: "AI_INTERPRETATION",
  AI_PERFORMANCE: "AI_PERFORMANCE",
  SYSTEM: "SYSTEM"
});

const EVENT_TYPES = Object.freeze({
  INTERPRETATION: "interpretation",
  DIALOGUE: "dialogue",
  RADIO: "radio",
  FIELD_NOTES: "field_notes",
  PERSONNEL_STATUS: "personnel_status",
  EQUIPMENT_STATUS: "equipment_status",
  SPATIAL_UPDATE: "spatial_update",
  WARNING: "warning",
  INSTITUTIONAL_MESSAGE: "institutional_message",
  AUDIO_CUE: "audio_cue"
});

const clone = (v) => structuredClone(v);

function ensure(run) {
  if (!run?.expedition) return null;
  run.expedition.presentation_bus ??= {
    version: VERSION,
    events: [],
    presented_keys: {},
    cursor: 0,
    revision: 0
  };
  run.expedition.presentation_events ??= [];
  run.expedition.dialogue_bus ??= [];
  return run.expedition.presentation_bus;
}

function normalizeKey(str) {
  return String(str ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Checks if a specific text snippet, chunk_id, or beat has already been presented.
 */
function hasPresented(run, keyOrText) {
  const bus = ensure(run);
  if (!bus || !keyOrText) return false;
  const k = normalizeKey(keyOrText);
  return bus.presented_keys[k] !== undefined;
}

/**
 * Marks a snippet or chunk_id as already presented.
 */
function trackPresented(run, keyOrText) {
  const bus = ensure(run);
  if (!bus || !keyOrText) return;
  const k = normalizeKey(keyOrText);
  bus.presented_keys[k] = (run.expedition.clock?.interval ?? 0);
  bus.revision += 1;
}

/**
 * Emits a structured presentation event to the unified bus.
 */
function emit(run, {
  type = EVENT_TYPES.INTERPRETATION,
  source = SOURCES.DETERMINISTIC,
  speaker = null,
  recipient = null,
  channel = "LOCAL",
  text = "",
  chunk_id = null,
  metadata = null,
  timestamp = null
} = {}) {
  const bus = ensure(run);
  if (!bus) return null;

  const cleanedText = canonLinter.enforceCanonText(text);
  const interval = run.expedition.clock?.interval ?? 0;
  const id = `pevt-${bus.events.length + 1}-${crypto.randomBytes(4).toString("hex")}`;

  const event = {
    id,
    type,
    source: SOURCES[source] ? source : SOURCES.DETERMINISTIC,
    speaker: speaker ?? null,
    recipient: recipient ?? null,
    channel,
    text: cleanedText,
    chunk_id: chunk_id ?? null,
    metadata: metadata ? clone(metadata) : null,
    interval,
    timestamp: timestamp ?? Date.now()
  };

  bus.events.push(event);
  bus.revision += 1;

  if (chunk_id) trackPresented(run, chunk_id);
  if (cleanedText && cleanedText.length > 20) trackPresented(run, cleanedText);

  // Backward-compatible mirror
  run.expedition.presentation_events.push(clone(event));
  if (type === EVENT_TYPES.DIALOGUE || type === EVENT_TYPES.INTERPRETATION) {
    run.expedition.dialogue_bus.push(clone(event));
  }

  return clone(event);
}

/**
 * Drains new unconsumed presentation events since last cursor.
 */
function drain(run) {
  const bus = ensure(run);
  if (!bus) return [];
  const start = bus.cursor;
  const newEvents = bus.events.slice(start);
  bus.cursor = bus.events.length;
  return newEvents.map(clone);
}

/**
 * Retrieves past events with optional filtering.
 */
function getEvents(run, { type = null, source = null, speaker = null, since_interval = null } = {}) {
  const bus = ensure(run);
  if (!bus) return [];
  return bus.events
    .filter((e) => !type || e.type === type)
    .filter((e) => !source || e.source === source)
    .filter((e) => !speaker || e.speaker === speaker)
    .filter((e) => since_interval === null || e.interval >= since_interval)
    .map(clone);
}

/**
 * Flushes pending unconsumed events by advancing the cursor to the end of events.
 */
function flush(run) {
  const bus = ensure(run);
  if (!bus) return;
  bus.cursor = bus.events.length;
}

/**
 * Returns presentation events that have not yet been delivered to the renderer.
 * Read-only: does not mutate the event queue. Cursor is advanced in-memory only.
 */
function consumePending(run) {
  const bus = ensure(run);
  if (!bus) return [];
  const cursor = bus.cursor ?? 0;
  const pending = bus.events.slice(cursor, cursor + 50);
  bus.cursor = cursor + pending.length;
  return pending.map((evt) => ({ ...evt }));
}

module.exports = {
  VERSION,
  SOURCES,
  EVENT_TYPES,
  ensure,
  hasPresented,
  trackPresented,
  emit,
  drain,
  flush,
  getEvents,
  consumePending
};
