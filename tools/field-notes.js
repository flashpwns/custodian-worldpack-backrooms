"use strict";

const canonicalLedger = require("./canonical-world-ledger");
const presentationBus = require("./presentation-bus");

const VERSION = "yellow-beast-field-notes@v1";

function generateFieldNote(type, details = {}, interval = 0) {
  const author = details.author ?? details.observer ?? details.actor ?? details.sender ?? "Standard";
  return {
    id: `note-${type.toLowerCase()}-${interval}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    author,
    interval,
    timestamp: new Date().toISOString(),
    details,
    text: details.text ?? `Operational note: ${type}`
  };
}

function processCausalEventsForFieldNotes(run) {
  run.expedition ??= {};
  run.expedition.field_notes ??= [];
  const existingNoteIds = new Set(run.expedition.field_notes.map((n) => n.id));

  const ledger = run.causal_ledger ?? [];
  const newNotes = [];

  for (const entry of ledger) {
    if (entry.details?.note_generated) continue;

    if (entry.kind === "location_entered") {
      const visited = run.spatial?.visited_locations ?? [];
      const isFirstVisit = visited.filter((loc) => loc === entry.target).length <= 1;
      if (isFirstVisit) {
        const note = generateFieldNote("ENTERED_NEW_REGION", {
          actor: entry.actor,
          location: entry.target,
          text: `Entered ${entry.target}.`
        }, entry.interval);
        newNotes.push(note);
      }
    } else if (entry.kind === "observation_made" || entry.kind === "coordinated-inspection") {
      const note = generateFieldNote("FIRST_OBSERVATION", {
        observer: entry.actor,
        target: entry.target,
        text: `Observed ${entry.target} at interval ${entry.interval}.`
      }, entry.interval);
      newNotes.push(note);
    } else if (entry.kind === "equipment_transfer") {
      const note = generateFieldNote("EQUIPMENT_TRANSFER", {
        item: entry.details?.item,
        from: entry.actor,
        to: entry.target,
        text: `Transferred ${entry.details?.item} from ${entry.actor} to ${entry.target}.`
      }, entry.interval);
      newNotes.push(note);
    } else if (entry.kind === "radio_transmission") {
      const unreached = (entry.details?.listeners ?? []).filter((l) => !l.heard);
      if (unreached.length > 0) {
        const note = generateFieldNote("RADIO_LOSS", {
          sender: entry.actor,
          unreached: unreached.map((l) => l.id),
          text: `Radio transmission from ${entry.actor} unreached by: ${unreached.map((l) => l.id).join(", ")}.`
        }, entry.interval);
        newNotes.push(note);
      }
    }

    entry.details ??= {};
    entry.details.note_generated = true;
  }

  // Check team separation
  const locations = Object.values(run.spatial?.personnel_locations ?? {});
  const uniqueLocs = new Set(locations);
  if (uniqueLocs.size > 1) {
    const lastNote = run.expedition.field_notes.at(-1);
    if (lastNote?.type !== "TEAM_SEPARATION" || lastNote.interval !== (run.expedition?.clock?.interval ?? 0)) {
      newNotes.push(generateFieldNote("TEAM_SEPARATION", {
        unique_locations: Array.from(uniqueLocs),
        text: "Field personnel are currently separated across multiple locations."
      }, run.expedition?.clock?.interval ?? 0));
    }
  }

  for (const n of newNotes) {
    run.expedition.field_notes.push(n);
    presentationBus.emit(run, {
      type: presentationBus.EVENT_TYPES.FIELD_NOTES,
      source: presentationBus.SOURCES.DETERMINISTIC,
      speaker: n.author,
      text: n.text,
      metadata: { note_id: n.id, note_type: n.type }
    });
  }

  return newNotes;
}

function getFieldNotes(run) {
  return structuredClone(run.expedition?.field_notes ?? []);
}

module.exports = {
  VERSION,
  generateFieldNote,
  processCausalEventsForFieldNotes,
  getFieldNotes
};
