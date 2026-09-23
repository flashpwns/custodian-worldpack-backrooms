"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const YBSurfaces = require("../desktop/renderer/surfaces");

function setup(seed, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-y111-"));
  const service = new DesktopService({ appDataPath:root, defaultQ4Scenario:"day1-opener", ...options });
  const created = service.createWorld({ name:"Y111 Dialogue Pass", seed });
  const worldId = created.world.id;
  service.createQ4Personnel({ world_id:worldId, first_name:"Eleanor", last_name:"Vance" });
  service.confirmQ4Personnel({ world_id:worldId });
  service.startSession({ world_id:worldId, mode:"field-researcher", scenario:"day1-opener" });
  service.submitAction({ world_id:worldId, mode:"field-researcher", action:"ATTEND_BRIEFING" });
  const concluded = service.submitAction({ world_id:worldId, mode:"field-researcher", action:"CONCLUDE_BRIEFING" });
  const session = service.session(worldId, "field-researcher");
  const playerId = session.run.session.startup.player.observer_id;
  const coworkers = session.run.expedition.team.members.filter((member) => (member.personnel_id ?? member.id) !== playerId);
  return { root, service, worldId, session, playerId, coworkers, projection:concluded.projection };
}

function newEvents(session, before) {
  return session.run.expedition.dialogue_history.slice(before);
}

test("y111 — Assembly Table keeps ordinary LOCAL dialogue in the right comms rail and exposes no group-routing control", () => {
  const state = setup("y111-right-rail");
  try {
    const html = YBSurfaces.briefingWorkstation(state.projection);
    assert.match(html, /briefing-workstation introductions-active/);
    assert.ok(html.indexOf("<main class=\"eti-center briefing-center\"") < html.indexOf("<aside class=\"eti-comms"), "Center content must precede the separate right comms rail");
    assert.doesNotMatch(html, /Table Group|All Present|value="@table"/);
    assert.match(html, /Obvious group address is resolved from your words/);
    assert.doesNotMatch(html, /dialogue_wordsmith_trace|raw_candidate|wordsmith_packet/);

    const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
    assert.match(css, /briefing-workstation\.introductions-active\{display:grid;grid-template-columns:/);
    assert.match(css, /briefing-workstation\.introductions-active>\.eti-comms\{grid-column:2;grid-row:1\}/);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — deterministic direct, group, untargeted, silence, and ambiguous response policy", async () => {
  const state = setup("y111-policy");
  try {
    const { service, worldId, session, playerId, coworkers } = state;
    const coworkerIds = coworkers.map((member) => member.personnel_id ?? member.id);

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[0].first_name, text:"Are you ready?" });
    let events = newEvents(session, before);
    assert.equal(events.length, 2);
    assert.equal(events[0].speaker_id, playerId);
    assert.equal(events[1].speaker_id, coworkerIds[0]);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone." });
    events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "group");
    assert.deepEqual(events.slice(1).map((event) => event.speaker_id), coworkerIds);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"How's everyone doing?" });
    events = newEvents(session, before);
    assert.deepEqual(events.slice(1).map((event) => event.speaker_id), coworkerIds);

    const equipmentHolders = new Set(Object.values(session.run.expedition.equipment).map((item) => item.holder));
    const informedCoworkers = coworkerIds.filter((id) => equipmentHolders.has(id));
    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Anybody know what we're carrying?" });
    events = newEvents(session, before);
    assert.deepEqual(events.slice(1).map((event) => event.speaker_id), informedCoworkers);
    assert.ok(events.slice(1).every((event) => /I've got/i.test(event.text)));

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Fuck, I'm tired." });
    events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "none");
    assert.equal(events.length, 2, "A beat-scoped social remark may receive exactly one deterministic response");

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"The paint is beige." });
    events = newEvents(session, before);
    assert.equal(events.length, 1, "A random untargeted statement may receive nobody");

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone, can somebody do the thing over there?" });
    events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "group");
    assert.equal(events.length, 2);
    assert.match(events[1].text, /what exactly/i);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — silence still commits zero dialogue events", () => {
  const state = setup("y111-silence");
  try {
    const before = state.session.run.expedition.dialogue_history.length;
    const result = state.service.submitAction({ world_id:state.worldId, mode:"field-researcher", action:"READY" });
    assert.equal(result.ok, true);
    assert.equal(state.session.run.expedition.dialogue_history.length, before);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — direct and group model wordsmith traces prove provider, packets, candidates, fallback state, and ordered committed IDs", async () => {
  const provider = {
    name:"trace-wordsmith",
    model:"trace-v1",
    async presentLocal(packet) {
      return {
        version:"yellow-beast-local-dialogue-candidate@v1",
        observer_id:packet.speaker.observer_id,
        speech:packet.player_speech_act.speech_act === "greeting" ? "Morning." : "Ready."
      };
    }
  };
  const state = setup("y111-trace", { developerMode:true, localDialogueProvider:provider });
  try {
    const { service, worldId, session, coworkers, playerId } = state;
    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[0].first_name, text:"Are you ready?", request_id:"trace-direct" });
    let events = newEvents(session, before);
    assert.deepEqual(events.map((event) => event.speaker_id), [playerId, coworkers[0].personnel_id]);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone.", request_id:"trace-group" });
    events = newEvents(session, before);
    assert.deepEqual(events.map((event) => event.speaker_id), [playerId, ...coworkers.map((member) => member.personnel_id)]);

    const traceResult = service.getDialogueWordsmithTrace({ limit:10 });
    assert.equal(traceResult.ok, true);
    const direct = traceResult.traces.find((trace) => trace.request_id === "trace-direct");
    const group = traceResult.traces.find((trace) => trace.request_id === "trace-group");
    assert.equal(direct.provider_used, "trace-wordsmith");
    assert.equal(direct.wordsmiths.length, 1);
    assert.equal(direct.wordsmiths[0].fallback_used, false);
    assert.equal(direct.wordsmiths[0].raw_candidate.speech, "Ready.");
    assert.equal(direct.wordsmiths[0].wordsmith_packet.speaker.observer_id, coworkers[0].personnel_id);
    assert.equal(direct.committed_event_ids.length, 1);
    assert.equal(direct.canonical_commit_order[0], direct.player_event_id);
    assert.deepEqual(direct.canonical_commit_order.slice(1), direct.committed_event_ids);

    assert.equal(group.provider_used, "trace-wordsmith");
    assert.deepEqual(group.deterministic_responders.map((item) => item.speaker_id), coworkers.map((member) => member.personnel_id));
    assert.equal(group.wordsmiths.length, 3);
    assert.ok(group.wordsmiths.every((item) => item.fallback_used === false && item.raw_candidate.speech === "Morning."));
    assert.deepEqual(group.wordsmiths.map((item) => item.committed_event_id), group.committed_event_ids);
    assert.equal(group.canonical_commit_order[0], group.player_event_id);
    assert.deepEqual(group.canonical_commit_order.slice(1), group.committed_event_ids);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

// ─── Acceptance A/C: deterministic group-greeting fallback is social and differentiated ──
test("y111 — Acceptance A: 'Hello, everyone.' group greeting fallback is not three identical 'Ready when you are.' lines", async () => {
  const state = setup("y111-accept-a");
  try {
    const { service, worldId, session, coworkerIds } = { ...state, coworkerIds: state.coworkers.map((m) => m.personnel_id ?? m.id) };
    const before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hello, everyone." });
    const events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "group");
    const replies = events.slice(1);
    assert.deepEqual(replies.map((e) => e.speaker_id), coworkerIds);
    for (const reply of replies) {
      assert.doesNotMatch(reply.text, /ready when you are/i);
      assert.doesNotMatch(reply.text, /awaiting orders/i);
      assert.doesNotMatch(reply.text, /what do you need/i);
    }
    const texts = new Set(replies.map((e) => e.text));
    assert.ok(texts.size > 1, "a beat-scoped group greeting must not collapse every teammate onto one identical fallback line");
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

// ─── Acceptance D/E/I/J: recipient-scope continuity precedence ──────────────
test("y111 — Acceptance D: untargeted 'What?' after a GROUP turn inherits group scope, never collapses to one coworker addressed directly", async () => {
  const state = setup("y111-accept-d");
  try {
    const { service, worldId, session, coworkers } = state;
    const coworkerIds = coworkers.map((m) => m.personnel_id ?? m.id);

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone." });
    let events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "group");

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"What?" });
    events = newEvents(session, before);
    const playerEvt = events[0];
    assert.equal(playerEvt.recipient_type, "group", "a bare follow-up after a group turn must inherit GROUP scope, not collapse to 'none'/'direct'");

    for (const reply of events.slice(1)) {
      assert.equal(reply.recipient_type, "group", "the responder's reply must not be rendered as if the player addressed them directly");
      assert.notEqual(reply.recipient_name, "YOU", "must not render as a direct address ('-> YOU') merely because one coworker responded");
      // Whoever answers must still be one of the originally-eligible group participants
      assert.ok(coworkerIds.includes(reply.speaker_id));
    }
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Acceptance E: untargeted 'What?' after a DIRECT turn to one teammate preserves that teammate as the addressee", async () => {
  const state = setup("y111-accept-e");
  try {
    const { service, worldId, session, coworkers } = state;
    const coworkerA = coworkers[0];

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkerA.first_name, text:"Are you ready?" });
    let events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "direct");
    assert.equal(events[0].recipient_id, coworkerA.personnel_id ?? coworkerA.id);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"What?" });
    events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "direct", "a bare follow-up after a direct turn may preserve the DIRECT addressee");
    assert.equal(events[0].recipient_id, coworkerA.personnel_id ?? coworkerA.id);
    assert.equal(events.length, 2, "the preserved addressee, and only them, may respond");
    assert.equal(events[1].speaker_id, coworkerA.personnel_id ?? coworkerA.id);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Acceptance F: a fresh standalone 'What?' with no prior exchange stays ambiguous and untargeted", async () => {
  const state = setup("y111-accept-f");
  try {
    const { service, worldId, session } = state;
    const before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"What?" });
    const events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "none");
    for (const reply of events.slice(1)) {
      assert.notEqual(reply.recipient_name, "YOU");
    }
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Acceptance I: an explicit named addressee overrides inherited group scope", async () => {
  const state = setup("y111-accept-i");
  try {
    const { service, worldId, session, coworkers } = state;
    const coworkerB = coworkers[1];

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone." });
    newEvents(session, before);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:`${coworkerB.first_name}, what?` });
    const events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "direct");
    assert.equal(events[0].recipient_id, coworkerB.personnel_id ?? coworkerB.id, "an explicit named addressee must override any inherited group scope");
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Acceptance J: an explicit UI-selected target overrides inherited group scope", async () => {
  const state = setup("y111-accept-j");
  try {
    const { service, worldId, session, coworkers } = state;
    const coworkerC = coworkers[2];

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone." });
    newEvents(session, before);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkerC.first_name, text:"What?" });
    const events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "direct");
    assert.equal(events[0].recipient_id, coworkerC.personnel_id ?? coworkerC.id, "an explicit UI-selected target must override any inherited group scope");
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

// ─── Acceptance K: recent dialogue reflects all committed group responses ───
test("y111 — Acceptance K: recent_dialogue in a later wordsmith packet includes all committed group responses in canonical order", async () => {
  const provider = {
    name:"trace-recent",
    model:"trace-recent-v1",
    async presentLocal(packet) {
      return {
        version:"yellow-beast-local-dialogue-candidate@v1",
        observer_id:packet.speaker.observer_id,
        speech:"Morning."
      };
    }
  };
  const state = setup("y111-accept-k", { developerMode:true, localDialogueProvider:provider });
  try {
    const { service, worldId, session, coworkers } = state;
    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hey everyone.", request_id:"k-group" });
    newEvents(session, before);

    before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[0].first_name, text:"Are you ready?", request_id:"k-direct" });
    newEvents(session, before);

    const traceResult = service.getDialogueWordsmithTrace({ limit:10 });
    const direct = traceResult.traces.find((trace) => trace.request_id === "k-direct");
    const recent = direct.wordsmiths[0].wordsmith_packet.speaker.recent_dialogue;
    const priorResponseTexts = recent.filter((item) => item.response).map((item) => item.response);
    assert.equal(priorResponseTexts.length, coworkers.length, "recent dialogue must carry every committed responder from the prior group turn, not just the first");
    assert.deepEqual(priorResponseTexts, coworkers.map(() => "Morning."));
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});
