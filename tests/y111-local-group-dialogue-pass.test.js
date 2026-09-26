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
    assert.match(events[1].text, /which thing do you mean/i);
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
  let greetN = 0;
  const provider = {
    name:"trace-wordsmith",
    model:"trace-v1",
    async presentLocal(packet) {
      return {
        version:"yellow-beast-local-dialogue-candidate@v1",
        observer_id:packet.speaker.observer_id,
        speech:packet.player_speech_act.speech_act === "greeting" ? ["Morning.", "Hey.", "Hello."][greetN++ % 3] : "Ready."
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
    assert.ok(group.wordsmiths.every((item) => item.fallback_used === false && ["Morning.", "Hey.", "Hello."].includes(item.raw_candidate.speech)));
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
  let recentN = 0;
  const provider = {
    name:"trace-recent",
    model:"trace-recent-v1",
    async presentLocal(packet) {
      return {
        version:"yellow-beast-local-dialogue-candidate@v1",
        observer_id:packet.speaker.observer_id,
        speech:["Morning.", "Hey.", "Hello."][recentN++ % 3]
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
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[0].first_name, text:"Alright, thanks.", request_id:"k-direct" });
    newEvents(session, before);

    const traceResult = service.getDialogueWordsmithTrace({ limit:10 });
    const direct = traceResult.traces.find((trace) => trace.request_id === "k-direct");
    // ED-2: history is no longer a top-level bag; the exchange-continuing tail
    // (last two committed rows) reaches the model only inside the contribution.
    const packet = direct.wordsmiths[0].wordsmith_packet;
    assert.deepEqual(packet.speaker.recent_dialogue, []);
    const priorResponseTexts = packet.authorized_contribution.recent_context.filter((item) => item.response).map((item) => item.response);
    assert.deepEqual(priorResponseTexts, ["Hey.", "Hello."], "the last two committed responders of the prior group turn, in canonical order");
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

// ─── Live-path repair regression: conversational clarification must not leak
// the old task-oriented "Which part do you need me to check?" fallback, and
// unresolved ambiguous references must not fabricate shared experience. Both
// go through service.submitQ4Communication -- the same production path
// Electron calls -- not a simplified mock of the interpretation layer alone.
test("y111 — Live-path repair B: direct 'Can you repeat that?' gets conversational clarification, not the old task fallback", async () => {
  const state = setup("y111-livepath-repeat");
  try {
    const { service, worldId, session, coworkers } = state;
    const before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[0].first_name, text:"Can you repeat that?" });
    const events = newEvents(session, before);
    assert.equal(events.length, 2);
    assert.equal(events[0].recipient_type, "direct");
    assert.equal(events[1].speaker_id, coworkers[0].personnel_id ?? coworkers[0].id);
    assert.doesNotMatch(events[1].text, /which part do you need me to check/i);
    assert.doesNotMatch(events[1].text, /what exactly are you asking me to verify/i);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Live-path repair D: an unresolved ambiguous reference asks for clarification instead of inventing shared experience", async () => {
  const state = setup("y111-livepath-ambiguous-ref");
  try {
    const { service, worldId, session, coworkers } = state;
    const before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", target:coworkers[1].first_name, text:"You know the thing by the thing?" });
    const events = newEvents(session, before);
    assert.equal(events.length, 2);
    assert.doesNotMatch(events[1].text, /first time for me too/i);
    assert.doesNotMatch(events[1].text, /nothing i can confirm/i);
    assert.match(events[1].text, /which thing do you mean/i);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

test("y111 — Live-path repair C: an equipment-ownership question naming a specific item resolves to its actual canonical holder, not team order", async () => {
  const state = setup("y111-livepath-ownership");
  try {
    const { service, worldId, session, coworkers } = state;
    const equipment = session.run.expedition.equipment;
    const spectrometerHolderId = equipment["mass-spectrometer"].holder;
    const holder = coworkers.find((m) => (m.personnel_id ?? m.id) === spectrometerHolderId);
    assert.ok(holder, "a coworker must hold the mass spectrometer in this scenario");

    const before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Who has the mass spectrometer?" });
    const events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "none");
    assert.equal(events.length, 2, "only the actual holder answers an item-specific ownership question");
    assert.equal(events[1].speaker_id, spectrometerHolderId, "the responder must be the canonical holder, not whoever is first in team order");
    assert.match(events[1].text, /mass spectrometer/i);
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});

// ─── Case A verification pass: "group scope lost -> collapses to direct
// Angelica" vs "group scope preserved, one clarifier authorized to answer"
// are different claims. This asserts the former never happens, without
// asserting a specific responder count -- the accepted deterministic policy
// for an ambiguous group reaction may authorize exactly one clarifier, and
// that is not itself a bug. Checks BOTH the canonical dialogue_history event
// (what presentation-bus emits/renders) and the interaction_history row
// (what q4-interactions projects) so a divergence between the two -- scope
// preserved in one but not the other -- cannot hide.
test("y111 — Case A: 'Hello, everyone.' then untargeted 'What?' preserves GROUP scope in both dialogue event and interaction row, never becomes direct-to-YOU", async () => {
  const state = setup("y111-case-a-verify");
  try {
    const { service, worldId, session, coworkers } = state;
    const coworkerIds = coworkers.map((m) => m.personnel_id ?? m.id);

    let before = session.run.expedition.dialogue_history.length;
    await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"Hello, everyone." });
    let events = newEvents(session, before);
    assert.equal(events[0].recipient_type, "group");
    assert.ok(events.slice(1).length > 0, "the group greeting must draw at least one reply to establish prior scope");

    const beforeIhCount = session.run.expedition.interaction_history.length;
    before = session.run.expedition.dialogue_history.length;
    const res = await service.submitQ4Communication({ world_id:worldId, channel:"local", text:"What?" });
    assert.equal(res.ok, true);
    events = newEvents(session, before);

    // 1. Canonical dialogue_history (presentation-bus / renderer source of truth)
    const playerEvt = events[0];
    assert.equal(playerEvt.recipient_type, "group", "player follow-up must stay group-scoped, not collapse to none/direct");
    assert.notEqual(playerEvt.recipient_type, "direct");

    const replies = events.slice(1);
    assert.ok(replies.length >= 1, "the accepted ambiguous-in-group policy must still authorize at least one clarifier");
    for (const reply of replies) {
      assert.equal(reply.recipient_type, "group", "coworker reply metadata must stay group-scoped");
      assert.notEqual(reply.recipient_type, "direct", "a group-scoped reply must never be recorded as recipient_type 'direct'");
      assert.notEqual(reply.recipient_name, "YOU", "a group-scoped reply must never render as if addressed directly to the player");
      assert.ok(coworkerIds.includes(reply.speaker_id), "the responder must be one of the originally-eligible group participants, not an invented actor");
    }

    // 2. interaction_history / q4-interactions projected row (separate data path)
    const newInteractions = session.run.expedition.interaction_history.slice(beforeIhCount);
    assert.equal(newInteractions.length, 1, "one interaction row is committed per player turn");
    assert.equal(newInteractions[0].recipient_type, "group", "the interaction row must carry the same group scope as the dialogue event, not diverge from it");
    assert.notEqual(newInteractions[0].recipient_type, "direct");
  } finally {
    fs.rmSync(state.root, { recursive:true, force:true });
  }
});
