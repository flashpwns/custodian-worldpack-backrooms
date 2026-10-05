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
const WORLD_EVENTS = new Map();

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
  const bus = run?.expedition?.presentation_bus;
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
  timestamp = null,
  id: explicitId = null,
  ...extra
} = {}) {
  const bus = ensure(run);
  if (!bus) return null;

  const cleanedText = canonLinter.enforceCanonText(text);
  const interval = run.expedition.clock?.interval ?? 0;
  const id = explicitId ?? (type === EVENT_TYPES.DIALOGUE ? `dlg-${bus.events.length + 1}-${crypto.randomBytes(4).toString("hex")}` : `pevt-${bus.events.length + 1}-${crypto.randomBytes(4).toString("hex")}`);

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
    timestamp: timestamp ?? Date.now(),
    ...extra
  };

  bus.events.push(event);
  bus.revision += 1;

  if (chunk_id) trackPresented(run, chunk_id);
  if (cleanedText && cleanedText.length > 20) trackPresented(run, cleanedText);

  // Backward-compatible mirror
  run.expedition.presentation_events.push(clone(event));
  if (type === EVENT_TYPES.DIALOGUE || type === EVENT_TYPES.INTERPRETATION) {
    run.expedition.dialogue_bus.push(clone(event));
    if (type === EVENT_TYPES.DIALOGUE) {
      run.expedition.dialogue_history ??= [];
      const alreadyPresent = run.expedition.dialogue_history.some((e) => e.id === event.id);
      if (!alreadyPresent) {
        const canonicalDlg = createDialogueEvent({
          id: event.id,
          submission_id: event.submission_id,
          speaker_id: event.speaker_id,
          speaker_name: event.speaker ?? event.speaker_name,
          speaker_title: event.speaker_title,
          recipient_type: event.recipient_type,
          recipient_id: event.recipient_id,
          recipient_name: event.recipient_name ?? event.recipient,
          listeners: event.listeners,
          channel: event.channel ?? channel,
          text: cleanedText,
          kind: event.kind ?? "speech",
          source: event.source ?? source,
          timestamp: event.timestamp ?? timestamp,
          interval: event.interval ?? interval,
          delivery: event.delivery ?? "delivered"
        });
        run.expedition.dialogue_history.push(canonicalDlg);
      }
    }
  }

  const worldId = run?.world_id ?? run?._world?.world_id;
  if (worldId) {
    let list = WORLD_EVENTS.get(worldId);
    if (!list) {
      list = [];
      WORLD_EVENTS.set(worldId, list);
    }
    list.push(clone(event));
  }

  return clone(event);
}

/**
 * Drains new unconsumed presentation events since last cursor.
 */
function drain(run) {
  const bus = run?.expedition?.presentation_bus;
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
  const bus = run?.expedition?.presentation_bus;
  if (!bus) return [];
  return bus.events
    .filter((e) => !type || e.type === type)
    .filter((e) => !source || e.source === source)
    .filter((e) => !speaker || e.speaker === speaker)
    .filter((e) => since_interval === null || e.interval >= since_interval)
    .map(clone);
}

/**
 * Inspect all recorded events for a world or run.
 */
function inspectEvents(target) {
  if (!target) return [];
  if (typeof target === "string") return (WORLD_EVENTS.get(target) ?? []).map(clone);
  if (target?.expedition) return getEvents(target);
  return [];
}

/**
 * Flushes pending unconsumed events by advancing the cursor to the end of events.
 */
function flush(run) {
  const bus = run?.expedition?.presentation_bus;
  if (!bus) return;
  bus.cursor = bus.events.length;
}

/**
 * Returns presentation events that have not yet been delivered to the renderer.
 * Read-only: does not mutate the event queue. Cursor is advanced in-memory only.
 */
function consumePending(run) {
  const bus = run?.expedition?.presentation_bus;
  if (!bus) return [];
  const cursor = bus.cursor ?? 0;
  const pending = bus.events.slice(cursor, cursor + 50);
  bus.cursor = cursor + pending.length;
  return pending.map((evt) => ({ ...evt }));
}

const RECIPIENT_TYPES = ["direct", "group", "broadcast", "none"];

/**
 * Canonical presentation-safe dialogue event contract.
 * Separates immutable canonical event data from presentation/DOM state.
 * Eliminates recipient ambiguity through explicit recipient_type.
 */
function createDialogueEvent({
  id = null,
  submission_id = null,
  speaker_id = null,
  speaker_name = "YOU",
  speaker_title = null,
  recipient_type = null,
  recipient_id = null,
  recipient_name = null,
  listeners = [],
  channel = "LOCAL",
  text = "",
  kind = "speech", // "speech" | "radio" | "institutional_record" | "system"
  source = SOURCES.DETERMINISTIC,
  timestamp = null,
  interval = 0,
  delivery = "delivered"
} = {}) {
  const normChannel = String(channel ?? "LOCAL").toUpperCase();

  let resolvedType = recipient_type;
  if (!resolvedType || !RECIPIENT_TYPES.includes(resolvedType)) {
    if (recipient_id === "@table" || ["table", "team", "all", "everyone", "group"].includes(String(recipient_name ?? "").toLowerCase())) {
      resolvedType = "group";
    } else if (recipient_id || recipient_name) {
      resolvedType = "direct";
    } else if (normChannel === "FACILITY BROADCAST" || normChannel === "STANDARD") {
      resolvedType = "broadcast";
    } else {
      resolvedType = "none";
    }
  }

  return {
    id: id || `dlg-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    submission_id: submission_id ?? null,
    speaker_id: speaker_id ?? null,
    speaker_name: String(speaker_name ?? "Record"),
    speaker_title: speaker_title ?? null,
    recipient_type: resolvedType,
    recipient_id: recipient_id ?? (resolvedType === "group" ? "@table" : null),
    recipient_name: recipient_name ?? (resolvedType === "group" ? "Assembly Table" : null),
    listeners: Array.isArray(listeners) ? [...listeners] : [],
    channel: normChannel,
    text: canonLinter.enforceCanonText(String(text ?? "")),
    kind: ["speech", "radio", "institutional_record", "system"].includes(kind) ? kind : "speech",
    source: SOURCES[source] ? source : SOURCES.DETERMINISTIC,
    timestamp: timestamp ?? Date.now(),
    interval: Number(interval) || 0,
    delivery: ["delivered", "heard", "not-delivered", "transferred", "not-applicable"].includes(delivery) ? delivery : "delivered"
  };
}

module.exports = {
  VERSION,
  SOURCES,
  EVENT_TYPES,
  RECIPIENT_TYPES,
  ensure,
  hasPresented,
  trackPresented,
  emit,
  createDialogueEvent,
  drain,
  flush,
  getEvents,
  inspectEvents,
  consumePending
};
