"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const bus = require("../tools/presentation-bus.js");

function minimalRun() {
  return {
    session: { startup: { player: { observer_id: "player-001" } } },
    expedition: { clock: { interval: 0 } }
  };
}

describe("y89 — Presentation bus integration (R2 repair verification)", () => {
  it("bus exports ensure, emit, consumePending, trackPresented, hasPresented", () => {
    assert.equal(typeof bus.ensure, "function", "ensure must be exported");
    assert.equal(typeof bus.emit, "function", "emit must be exported");
    assert.equal(typeof bus.consumePending, "function", "consumePending must be exported");
    assert.equal(typeof bus.trackPresented, "function", "trackPresented must be exported");
    assert.equal(typeof bus.hasPresented, "function", "hasPresented must be exported");
  });

  it("ensure initializes bus state on run", () => {
    const run = minimalRun();
    const result = bus.ensure(run);
    assert.ok(result, "ensure must return bus state");
    assert.ok(Array.isArray(result.events), "bus.events must be an array");
    assert.equal(typeof result.cursor, "number", "bus.cursor must be a number");
  });

  it("emit adds event to bus.events with correct fields", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.emit(run, { type: "narration", speaker: null, channel: "LOCAL", source: "DETERMINISTIC", text: "Test narration." });
    const b = bus.ensure(run);
    assert.equal(b.events.length, 1, "emit must add exactly one event");
    assert.equal(b.events[0].type, "narration", "event type must be narration");
    assert.equal(b.events[0].text, "Test narration.", "event text must match");
    assert.ok(b.events[0].timestamp, "event must have a timestamp");
  });

  it("consumePending returns events since last cursor and does not duplicate", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: "First event." });
    bus.emit(run, { type: "dialogue", source: "PROVIDER", text: "Second event." });
    
    const first = bus.consumePending(run);
    assert.equal(first.length, 2, "first consume should return both events");
    
    const second = bus.consumePending(run);
    assert.equal(second.length, 0, "second consume should return no new events (cursor advanced)");
  });

  it("consumePending does not mutate the bus.events array (read-only view)", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: "Immutable event." });
    
    const pending = bus.consumePending(run);
    const b = bus.ensure(run);
    assert.equal(b.events.length, 1, "bus.events must remain intact after consume");
    assert.equal(pending.length, 1, "consume result must have the event");
  });

  it("consumePending caps at 50 events per call", () => {
    const run = minimalRun();
    bus.ensure(run);
    for (let i = 0; i < 75; i++) {
      bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: `Event ${i}` });
    }
    const pending = bus.consumePending(run);
    assert.ok(pending.length <= 50, `consumePending must cap at 50 events, got ${pending.length}`);
  });

  it("hasPresented returns false before trackPresented called", () => {
    const run = minimalRun();
    bus.ensure(run);
    assert.equal(bus.hasPresented(run, "threshold_crossing_aperture"), false,
      "hasPresented must return false before tracking");
  });

  it("trackPresented + hasPresented roundtrip", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.trackPresented(run, "threshold_crossing_aperture");
    assert.equal(bus.hasPresented(run, "threshold_crossing_aperture"), true,
      "hasPresented must return true after trackPresented");
  });

  it("flush resets pending events but does not delete existing events", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: "Pre-flush event." });
    bus.flush(run);
    const pending = bus.consumePending(run);
    // After flush, cursor is advanced past all events — no new events to return
    assert.equal(pending.length, 0, "flush must advance cursor past all existing events");
  });

  it("emit requires source field — emitted events have source tag", () => {
    const run = minimalRun();
    bus.ensure(run);
    bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: "Tagged event." });
    const b = bus.ensure(run);
    assert.ok(b.events[0].source, "emitted event must have a source field");
    assert.equal(b.events[0].source, "DETERMINISTIC", "source must match emit param");
  });

  it("multiple emit calls in sequence produce ordered events", () => {
    const run = minimalRun();
    bus.ensure(run);
    const texts = ["alpha", "beta", "gamma"];
    for (const t of texts) {
      bus.emit(run, { type: "narration", source: "DETERMINISTIC", text: t });
    }
    const pending = bus.consumePending(run);
    assert.equal(pending.length, 3, "all 3 events must be returned");
    assert.equal(pending[0].text, "alpha", "events must be in insertion order");
    assert.equal(pending[1].text, "beta", "events must be in insertion order");
    assert.equal(pending[2].text, "gamma", "events must be in insertion order");
  });

  it("interpretive-director.emitPresentationEvent routes through presentationBus", () => {
    const interpretiveDirector = require("../tools/interpretive-director.js");
    const run = minimalRun();
    interpretiveDirector.emitPresentationEvent(run, {
      type: "dialogue",
      speaker: "Beverly",
      text: "Testing director route.",
      source: "DETERMINISTIC"
    });
    const pending = bus.consumePending(run);
    assert.equal(pending.length, 1, "bus must receive the event from director");
    assert.equal(pending[0].speaker, "Beverly");
    assert.equal(pending[0].text, "Testing director route.");
  });

  it("field-notes processCausalEventsForFieldNotes routes new notes to presentationBus", () => {
    const fieldNotes = require("../tools/field-notes.js");
    const run = minimalRun();
    run.spatial = { visited_locations: ["loc-1"] };
    run.causal_ledger = [
      { kind: "location_entered", actor: "player", target: "loc-1", interval: 1 }
    ];
    fieldNotes.processCausalEventsForFieldNotes(run);
    const pending = bus.consumePending(run);
    assert.ok(pending.length >= 1, "field notes must emit to presentationBus");
    assert.equal(pending[0].type, "field_notes");
  });

  it("decision-scheduler emits scheduled autonomous decisions to presentationBus", () => {
    const decisionScheduler = require("../tools/decision-scheduler.js");
    const run = minimalRun();
    run.expedition.team = {
      members: [
        { personnel_id: "player-001", role: "lead" },
        {
          personnel_id: "coworker-001",
          first_name: "Beverly",
          display_name: "Beverly",
          current_task: { type: "investigate", state: "completed" },
          queued_tasks: [{ type: "hold", target: "loc-1" }]
        }
      ]
    };
    decisionScheduler.scheduleDecisions(run, {}, null);
    const pending = bus.consumePending(run);
    assert.ok(pending.length >= 1, "decision scheduler must emit event to presentationBus");
    assert.equal(pending[0].type, "personnel_status");
  });
});
