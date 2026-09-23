"use strict";

// Pass 9C-3 — the Opus closure recheck found that an autonomous observation
// row (source: "autonomous-observation", text: null, presentation.result:
// "heard") rendered a fake quoted "heard" line, then the real speech again
// with a wrong "-> YOU" direct-address suffix. This is a pure rendering
// fix in desktop/renderer/surfaces.js; no data shape or service behavior
// changed.

const assert = require("node:assert/strict");
const test = require("node:test");

const YBSurfaces = require("../desktop/renderer/surfaces");

function baseProjection(localHistory) {
  return {
    q4: {
      channels: {
        local: { available: true, targets: ["Dana"], history: localHistory },
        standard: { available: true, state_label: "READY", history: [] },
        team_status: []
      }
    },
    phase: { phase_id: "FIELD_OPERATION" }
  };
}

const autonomousRow = {
  id: "q4-interaction-1",
  source: "autonomous-observation",
  channel: "LOCAL",
  speaker: "Dana",
  speaker_id: "npc-dana",
  targets: [],
  text: null,
  result: "heard",
  delivery: "heard",
  responses: [{ order: 0, speaker_id: "npc-dana", speaker_name: "Dana", text: "Found something odd with the case." }],
  at: 5
};

const playerRow = {
  id: "q4-interaction-2",
  channel: "LOCAL",
  speaker: "You",
  targets: ["Dana"],
  text: "How does the radio work?",
  result: "heard",
  response: "Radio is charged and ready.",
  response_speaker: "Dana",
  at: 6
};

const directCoworkerRow = {
  id: "q4-interaction-3",
  channel: "LOCAL",
  speaker: "Dana",
  targets: [],
  text: "Heads up, the corridor light is out.",
  result: "heard",
  at: 7
};

const groupRow = {
  id: "q4-interaction-4",
  channel: "LOCAL",
  speaker: "You",
  recipient_type: "group",
  targets: ["Assembly Table"],
  text: "Everyone ready?",
  result: "heard",
  responses: [{ order: 0, speaker_id: "npc-a", speaker_name: "Alex", text: "Ready." }],
  at: 8
};

for (const [name, render] of [["communicationConsole", YBSurfaces.communicationConsole], ["communicationLanes", YBSurfaces.communicationLanes]]) {
  test(`A (${name}): autonomous observation row renders the real speech once, no quoted "heard", no "-> YOU"`, () => {
    const html = render(baseProjection([autonomousRow]));
    assert.ok(html.includes("Found something odd with the case."), "the actual report text must be rendered");
    assert.ok(!/heard/i.test(html.replace(/badge-heard|data-channel="local"|delivery/gi, "")) || !html.includes("“heard”"), "no synthesized quoted \"heard\" utterance");
    assert.ok(!html.includes("“heard”"));
    assert.ok(!html.includes("→ YOU"), "an autonomous report must not get a direct-address arrow");
    // Exactly one occurrence of the report text -- not once as a fake main
    // line and again as a response row.
    const occurrences = html.split("Found something odd with the case.").length - 1;
    assert.equal(occurrences, 1);
  });

  test(`B (${name}): normal player-originated LOCAL interaction is unchanged`, () => {
    const html = render(baseProjection([playerRow]));
    assert.ok(html.includes("How does the radio work?"));
    assert.ok(html.includes("Radio is charged and ready."));
  });

  test(`C (${name}): direct coworker-initiated LOCAL line is unchanged`, () => {
    const html = render(baseProjection([directCoworkerRow]));
    assert.ok(html.includes("Heads up, the corridor light is out."));
  });

  test(`D (${name}): group dialogue rendering is unchanged`, () => {
    const html = render(baseProjection([groupRow]));
    assert.ok(html.includes("Everyone ready?"));
    assert.ok(html.includes("Ready."));
  });
}
