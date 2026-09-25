"use strict";

// ED-24 — dialogue freeze invariants. Every assertion here protects a boundary the dialogue engine
// must hold before it is frozen: code decides meaning; the model (or fallback) only words it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const D = require("../tools/dialogue-discourse");
const I = require("../tools/dialogue-interpretation");
const F = require("../tools/dialogue-fallback");
const V = require("../tools/dialogue-validation");
const ledger = require("../tools/canonical-world-ledger");
const bridge = require("../tools/observer-context-compiler");
const spatialEvents = require("../tools/spatial-event-contract");
const communicationRouting = require("../tools/communication-routing");
const { renderContributionTask, LOCAL_DIALOGUE_SYSTEM_TEXT } = require("../tools/dialogue-prompt-contract");
const { createLocalModelProvider, LOCAL_DIALOGUE_MAX_TOKENS } = require("../tools/ai-local-model-provider");
const { createHostedProvider } = require("../tools/ai-hosted-transport");
const { validateLocalDialogue, buildObservationReportPacket } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const VERSION = "yellow-beast-local-dialogue-candidate@v1";
const INTERNAL_ID = /yb-personnel|q4-player|q4-standard|\brun-[0-9a-f]{6}|\bworld-[0-9a-f]{6}|\bitem-[0-9a-f]{6}|q4-[a-z]+-[a-z0-9-]+-\d\d/;
const PACKET_FIELD = /authorized_contribution|context_capsule|required_facts|optional_facts|forbidden_claims|expected_response_shape|_internal|provenance|fingerprint|speaker_shell|reaction_context/;

// ─── harness ─────────────────────────────────────────────────────────────────
function setup(seed, provider = null, { offline = false, concurrency = undefined } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed24-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}), ...(concurrency ? { dialogueWordingConcurrency: concurrency } : {}) });
  if (offline) service.updateSettings({ provider: "offline" });
  const worldId = service.createWorld({ name: "ED24", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  const logs = [];
  service.log = (line) => logs.push(String(line));
  const state = { root, service, worldId, logs };
  Object.defineProperty(state, "run", { get: () => service.session(worldId, "field-researcher").run });
  state.playerId = state.run.session.startup.player.observer_id;
  state.coworkers = state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  state.ids = state.coworkers.map((m) => m.personnel_id ?? m.id);
  return state;
}
const cleanup = (state) => fs.rmSync(state.root, { recursive: true, force: true });
const say = (state, text, extra = {}) => Promise.resolve(state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, ...extra }));
const spokenSince = (state, before) => state.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== state.playerId);

/** A REAL createLocalModelProvider whose fetch records the exact HTTP body it would send. */
function recordingLocal(responder) {
  const bodies = []; const packets = [];
  const fetchImpl = (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return Promise.resolve(responder(body, options)).then((out) => {
      if (out instanceof Error) throw out;
      const content = out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ version: VERSION, observer_id: "self", speech: out, semantic_claims: [] });
      return { ok: true, status: 200, json: async () => ({ id: "t", choices: [{ message: { content } }] }) };
    });
  };
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:8734", fetchImpl, timeout: 300 });
  const provider = { name: "local", model: real.model, async presentLocal(packet) { packets.push(packet); return real.presentLocal(packet); } };
  return { provider, bodies, packets };
}
const userOf = (body) => body.messages.find((m) => m.role === "user").content;

// Pure fixtures for plan/fallback/validator checks.
const PLAYER = "p-jack";
const EQUIPMENT = { cam: { id: "cam", label: "35mm field camera", holder: PLAYER }, radio: { id: "radio", label: "Survey radio", holder: "c-nora" } };
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", [PLAYER]: "you" };
const selfOf = (extra = {}) => D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, names: NAMES, custody_known: { cam: true, radio: true }, self_state: ledger.describeSelfState({}), ...extra });
function planFor(text, { owner = "c-omar", recipient_type = "direct", discourse = null, self = selfOf(), selection = null, anchors = null } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, discourse, equipment: EQUIPMENT, spatial_selection: selection, temporal_anchors: anchors, now: 5 });
  const [plan] = D.planResponses({ frame, owner_ids: [owner], responders: { [owner]: { self } }, names: NAMES });
  return { frame, plan, contribution: D.toAuthorizedContribution(plan, frame, { names: NAMES }) };
}
const verdict = (contribution, speech, player_text = null) => V.validateContribution(contribution, speech, { player_text });

// ─── 1. semantic frame: readiness is the only momentary state a "yes" may assert ─────────────
test("frame — past perception, presence, plans and feelings are never 'addressee readiness'", () => {
  const fn = (t) => D.buildSemanticFrame({ text: t, equipment: EQUIPMENT });
  for (const t of ["Did you see anything earlier?", "Did you hear that?", "Were you here earlier?", "Are you coming?", "Are you tired?", "Did you check the room before we crossed?"]) assert.equal(fn(t).addressee_state, false, t);
  for (const t of ["Are you ready?", "All set?"]) assert.equal(fn(t).addressee_state, true, t);
  for (const t of ["You okay?", "You good?", "Are you tired?", "How are you holding up?"]) assert.equal(fn(t).discourse_function, "check_in", t);
  assert.equal(fn("You look nervous.").discourse_function, "social_observation");
  assert.equal(fn("You look nervous.").about_addressee, true);
  for (const t of ["Wait here.", "Come with me.", "Tell Maxwell.", "Let's head out soon."]) assert.equal(fn(t).discourse_function, "make_request", t);
  assert.equal(fn("Wait here.").request_kind, "order");
  assert.equal(fn("Take the camera.").request_kind, "handoff");
  assert.equal(fn("Is the camera here?").discourse_function, "ask_item_ownership");
  assert.equal(fn("Have you seen the camera?").discourse_function, "ask_item_ownership");
  assert.equal(fn("Don't touch that.").discourse_function, "warn", "a warning stays a warning");
});

test("frame — spatial deixis is resolved only by a deterministic selection, else clarified", () => {
  const unresolved = D.buildSemanticFrame({ text: "Is that door open?", equipment: EQUIPMENT });
  assert.equal(unresolved.discourse_function, "ambiguous_reference");
  assert.deepEqual(unresolved.referents.map((r) => [r.type, r.resolved, r.noun]), [["spatial", false, "door"]]);
  const selection = { entity_id: "connection:staging-door", kind: "door", label: "Staging door" };
  const resolved = D.buildSemanticFrame({ text: "Is that door open?", equipment: EQUIPMENT, spatial_selection: selection });
  assert.equal(resolved.discourse_function, "ask_factual");
  assert.deepEqual(resolved.referents.map((r) => [r.type, r.resolved, r.label, r.source]), [["spatial", true, "Staging door", "spatial_selection"]]);
  const mismatched = D.buildSemanticFrame({ text: "Is that door open?", equipment: EQUIPMENT, spatial_selection: { entity_id: "object:crate", kind: "object", label: "Supply crate" } });
  assert.equal(mismatched.discourse_function, "ambiguous_reference", "a selection of the wrong kind never resolves the noun");
  assert.equal(D.buildSemanticFrame({ text: "What's that?", equipment: EQUIPMENT }).discourse_function, "ambiguous_reference");
  assert.equal(D.buildSemanticFrame({ text: "Is that right?", equipment: EQUIPMENT }).discourse_function, "ask_factual", "discourse 'that' is not spatial deixis");
});

test("frame — temporal references resolve against canonical anchors or stay unresolved", () => {
  const t = (text, anchors = null) => D.resolveTemporalReference({ text, anchors, now: 9 });
  assert.equal(t("Did you see anything earlier?").resolved, true);
  assert.deepEqual(t("Did you see anything earlier?").window, { from: 0, to: 9 });
  assert.equal(t("What did Maxwell say after the briefing?").resolved, false);
  const anchored = t("What did Maxwell say after the briefing?", { briefing: { interval: 2 } });
  assert.deepEqual([anchored.resolved, anchored.anchor, anchored.window.from, anchored.window.to], [true, "briefing", 2, 9]);
  assert.equal(t("What happened before Maxwell left?", { briefing: { interval: 2 } }).resolved, false, "an anchor that is not canonical is never guessed");
  assert.equal(t("What happened last time?").resolved, false);
  assert.equal(t("Where is the camera?"), null);
  // an unresolved time forces a clarification only when no fact answers the question
  const unanswered = planFor("What did you check before Maxwell left?");
  assert.equal(unanswered.plan.may_ask_clarifying_question, true);
  assert.equal(F.presentFallback({ frame: unanswered.frame, plan: unanswered.plan }), "Sorry, when do you mean?");
  const answered = planFor("What did you check before Maxwell left?", { self: selfOf({ known_answer: { kind: "own-report", checked_location: "utility room" } }) });
  assert.equal(answered.plan.may_ask_clarifying_question, false);
  assert.equal(F.presentFallback({ frame: answered.frame, plan: answered.plan }), "I checked the utility room.");
});

test("frame — an item pronoun points back to the conversation's last item, or is clarified", () => {
  const discourse = D.deriveDiscourseState({ interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Who has the field camera?", recipient_type: "none", recipient_ids: [], listeners: ["c-omar"], location_id: "hall" }], dialogue_history: [{ submission_id: "s1", speaker_id: "c-omar", speaker_name: "Omar", kind: "speech", text: "You've got it." }], player_id: PLAYER, location_id: "hall", equipment: EQUIPMENT });
  assert.deepEqual(discourse.last_item_referent, { id: "cam", label: "35mm field camera" });
  const frame = D.buildSemanticFrame({ text: "Is it here?", discourse, equipment: EQUIPMENT });
  assert.equal(frame.discourse_function, "ask_item_ownership");
  assert.equal(frame.referents[0].source, "antecedent");
  assert.equal(D.buildSemanticFrame({ text: "Is it here?", equipment: EQUIPMENT }).discourse_function, "ambiguous_reference", "no antecedent: clarify");
});

test("frame — question -> clarification -> answer resumes the ORIGINAL question", () => {
  const discourse = D.deriveDiscourseState({ interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Who has the thing?", recipient_type: "none", recipient_ids: [], listeners: ["c-omar"], location_id: "hall" }], dialogue_history: [{ submission_id: "s1", speaker_id: "c-omar", speaker_name: "Omar", kind: "speech", text: "Which thing do you mean?" }], player_id: PLAYER, location_id: "hall", equipment: EQUIPMENT });
  assert.equal(discourse.pending_question.player_text, "Who has the thing?");
  const frame = D.buildSemanticFrame({ text: "The radio.", discourse, equipment: EQUIPMENT });
  assert.equal(frame.discourse_function, "ask_item_ownership");
  assert.equal(frame.resumed_question.player_text, "Who has the thing?");
  const [plan] = D.planResponses({ frame, owner_ids: ["c-omar"], responders: { "c-omar": { self: selfOf() } }, names: NAMES });
  assert.equal(F.presentFallback({ frame, plan }), "The survey radio is with Nora.");
  assert.equal(D.buildSemanticFrame({ text: "The radio.", equipment: EQUIPMENT }).discourse_function, "make_statement", "without an open question a fragment is just a statement");
});

// ─── 2. fallback = the same plan, in plain words, inventing nothing ─────────────────────────────
test("fallback — says only what the plan authorizes (no invented observation, state or commitment)", () => {
  const fb = (text, opts) => { const p = planFor(text, opts); return F.presentFallback({ frame: p.frame, plan: p.plan }); };
  assert.equal(fb("Did you see anything earlier?"), "Not that I noticed.");
  assert.equal(fb("Is this safe?"), "I couldn't say.", "no 'not that I know of' that implies danger");
  assert.equal(fb("Is that door open?"), "Sorry, which door do you mean?");
  assert.equal(fb("Wait here."), "Heard you.");
  assert.equal(fb("Let's head out soon."), "Heard you.");
  assert.doesNotMatch(fb("Careful with that."), /I'?ll|will/i, "a heard warning promises nothing");
  assert.equal(fb("Are you ready?"), "Yeah, I think so.");
  assert.equal(fb("Is the camera here?"), "You've got the 35mm field camera.");
  // check-ins and remarks about the speaker come from canonical self-state
  const ordinary = fb("How are you holding up?");
  assert.doesNotMatch(ordinary, /tired|stress|worr|could be better/i);
  const tired = selfOf({ self_state: ledger.describeSelfState({ emotional_state: { ...ledger.DEFAULT_EMOTIONAL_STATE, fatigue: 0.8 } }) });
  assert.match(fb("How are you holding up?", { self: tired }), /tired/i);
  assert.match(fb("You look worn out.", { self: tired }), /tired/i);
  const noState = D.planResponses({ frame: D.buildSemanticFrame({ text: "You look nervous." }), owner_ids: ["c-omar"], responders: {}, names: NAMES })[0];
  assert.doesNotMatch(F.presentFallback({ frame: D.buildSemanticFrame({ text: "You look nervous." }), plan: noState }), /all right|fine|nervous/i, "without a self-state fact no state is claimed");
});

// ─── 3. validator: fact authority ──────────────────────────────────────────────────────────────
test("validator — a bare 'yes' cannot assert a perception, presence or feeling; readiness may", () => {
  for (const q of ["Did you hear that?", "Did you see anything earlier?", "Were you here earlier?"]) {
    const { contribution } = planFor(q);
    assert.equal(verdict(contribution, "Yeah.", q).ok, false, q);
  }
  assert.equal(verdict(planFor("Did you see anything earlier?").contribution, "Didn't notice anything.", "Did you see anything earlier?").ok, true);
  assert.equal(verdict(planFor("Are you ready?").contribution, "Ready.", "Are you ready?").ok, true);
});

test("validator — the capsule's PLAYER label is never spoken, in any case or as a name", () => {
  const greet = planFor("Good morning, y'all.").contribution;
  for (const bad of ["Morning, Player.", "Morning Player.", "Hey player.", "PLAYER, morning."]) assert.equal(verdict(greet, bad, "Good morning, y'all.").ok, false, bad);
  assert.equal(verdict(greet, "Morning, everyone.", "Good morning, y'all.").ok, true);
});

test("validator — requests conversation does not perform are acknowledged, never accepted", () => {
  const order = planFor("Wait here.").contribution;
  for (const bad of ["Sure, I'll wait.", "Okay.", "Got it.", "Give me a sec.", "On my way.", "Understood."]) assert.equal(verdict(order, bad, "Wait here.").ok, false, bad);
  for (const good of ["Heard you.", "I hear you."]) assert.equal(verdict(order, good, "Wait here.").ok, true, good);
  const handoff = planFor("Can you hand me the radio?", { owner: "c-nora", self: selfOf({ person: { first_name: "Nora" } }) }).contribution;
  assert.equal(verdict(handoff, "Here you go.").ok, false);
  assert.equal(verdict(handoff, "Sure thing.").ok, false);
});

test("validator — a check-in states exactly the canonical self-state", () => {
  const ordinary = planFor("How are you holding up?").contribution;
  for (const bad of ["Tired.", "Tense. Tired. Under stress.", "Could be better.", "Honestly, a bit on edge."]) assert.equal(verdict(ordinary, bad).ok, false, bad);
  assert.equal(verdict(ordinary, "Holding up, thanks.").ok, true);
  const affected = planFor("How are you holding up?", { self: selfOf({ self_state: ledger.describeSelfState({ emotional_state: { ...ledger.DEFAULT_EMOTIONAL_STATE, stress: 0.7, fatigue: 0.8 } }) }) }).contribution;
  assert.equal(verdict(affected, "Tense. Tired. Under stress.").ok, true, "authorized affect in fragments is fine");
  assert.equal(verdict(affected, "I'm fine.").ok, false, "canonical fatigue/stress is not denied away");
});

// ─── 4. hard model-input boundary: exact HTTP body ──────────────────────────────────────────────
test("boundary — the provider sends ONLY the rendered capsule + contribution under the compact system prompt", async () => {
  const rec = recordingLocal(() => "Hey.");
  const state = setup("ed24-boundary", rec.provider);
  try {
    await say(state, "Good morning, y'all.");
    await say(state, "Who has the field camera?");
    await say(state, "Huh?");
    assert.ok(rec.bodies.length >= 3);
    rec.bodies.forEach((body, i) => {
      const system = body.messages.find((m) => m.role === "system").content;
      const user = userOf(body);
      assert.equal(system, LOCAL_DIALOGUE_SYSTEM_TEXT);
      assert.equal(user, renderContributionTask(rec.packets[i]), "user content is exactly the renderer's output");
      assert.doesNotMatch(system + user, INTERNAL_ID, "no internal identifier reaches the model");
      assert.doesNotMatch(system + user, PACKET_FIELD, "no raw packet structure reaches the model");
      assert.match(user, /Return JSON: \{"speech":"<what you say>"\}$/, "the model produces wording only");
      assert.doesNotMatch(user, /observer_id|semantic_claims/);
      assert.deepEqual(body.response_format.json_schema.schema.required, ["speech"]);
      assert.equal(body.max_tokens, LOCAL_DIALOGUE_MAX_TOKENS);
      assert.equal(body.messages.length, 2);
    });
  } finally { cleanup(state); }
});

test("boundary — the renderer reads nothing outside the capsule and contribution", () => {
  const { contribution } = planFor("Who has the field camera?");
  const capsule = { actor: { name: "Omar", style: {} }, scene: { location_name: "Assembly Table" }, present_people: [{ name: "PLAYER", is_player: true }], conversation: {}, heard_turns: [], repair_target: null, current_utterance: { speaker: "PLAYER", text: "Who has the field camera?" }, human_context: { affect: [], circumstances: [], ordinary: true }, known_state: [] };
  const clean = { speaker: { observer_id: "yb-personnel-SECRET" }, player_message: { text: "Who has the field camera?" }, context_capsule: capsule, authorized_contribution: contribution };
  const poisoned = { ...clean, speaker: { observer_id: "yb-personnel-SECRET", visible_condition: "SECRET-CONDITION", known_identity: "SECRET-NAME" }, visible_context: { location: "SECRET-ROOM" }, speaker_shell: { hidden: "SECRET-SHELL" }, known_facts: [{ text: "SECRET-FACT" }] };
  assert.equal(renderContributionTask(poisoned), renderContributionTask(clean));
  assert.doesNotMatch(renderContributionTask(poisoned), /SECRET/);
  const source = fs.readFileSync(path.join(__dirname, "../tools/dialogue-prompt-contract.js"), "utf8");
  assert.deepEqual([...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]), ["./dialogue-fallback"], "the renderer requires no canonical module");
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /\._run\b|\._capsule\b|\.expedition\b|observation_state|survey_frontier|_world\b/, "no canonical state is reachable from the renderer");
});

test("boundary — the optional hosted provider gets the same rendered text, never the raw packet", async () => {
  const sent = [];
  const client = { chat: { completions: { create: async (body) => { sent.push(body); return { id: "h", choices: [{ message: { content: JSON.stringify({ version: VERSION, observer_id: "self", speech: "Hey.", semantic_claims: [] }) } }] }; } } } };
  const hosted = createHostedProvider({ providerId: "groq", client, apiKey: "test", model: "m" });
  const packets = [];
  const state = setup("ed24-hosted", { name: "hosted", model: "m", async presentLocal(p) { packets.push(p); return hosted.presentLocal(p); } });
  try {
    await say(state, "Good morning, y'all.");
    assert.ok(sent.length > 0);
    sent.forEach((body, i) => {
      assert.equal(body.messages[0].content, LOCAL_DIALOGUE_SYSTEM_TEXT);
      assert.equal(body.messages[1].content, renderContributionTask(packets[i]));
      assert.doesNotMatch(body.messages[1].content, PACKET_FIELD);
    });
  } finally { cleanup(state); }
});

// ─── 5. provider independence (freeze invariant) ────────────────────────────────────────────────
const FREEZE_TURNS = [
  { text: "Good morning, y'all." },
  { text: "hello, my name is elder price. buy apple stock RFN" },
  { text: "did anyone hear what I just said?" },
  { text: "Mind telling me a bit about yourselves?" },
  { text: "Huh?" },
  { text: "Who has the field camera?" },
  { text: "Who has the thing?" },
  { text: "The camera." },
  { text: "Is that door open?" },
  { text: "Did you see anything earlier?" },
  { text: "How's everyone doing?" },
  { text: "Well, this seems incredibly safe." },
  { text: "Let's head out soon." },
  { text: "Have you been there before?" },
  { text: "I'm Jack." }
];
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Replaces the TEXT of prior coworker lines quoted inside a plan (visible wording) with a marker. */
function spokenNormalized(value, key = null) {
  if (Array.isArray(value)) return value.map((item) => spokenNormalized(item, key));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = (k === "text" && ["responses", "antecedent_responses", "value"].includes(key) && value.speaker_name !== undefined) ? "<spoken>" : spokenNormalized(v, k === "value" && Array.isArray(v) ? "antecedent_responses" : k);
  return out;
}
function semanticState(state) {
  const run = state.run;
  const world = state.service.getWorld(state.worldId);
  const members = run.expedition.team.members;
  const playerId = state.playerId;
  return {
    dialogue: run.expedition.dialogue_history.map((e) => ({ speaker: e.speaker_id, submission: e.submission_id, recipient: [e.recipient_type, e.recipient_id], listeners: [...(e.listeners ?? [])].sort(), channel: e.channel, kind: e.kind, delivery: e.delivery })),
    interactions: run.expedition.interaction_history.map((i) => ({ owners: (i.response_owners ?? []).map((o) => [o.order, o.speaker_id]), recipient: [i.recipient_type, i.recipient_id], listeners: [...(i.listeners ?? [])].sort(), effects: i.canonical_effects ?? null, delivery: i.delivery })),
    // Repair plans quote the exact prior line (visible wording, which may differ by provider); its
    // speaker, position and resolution are semantic and must not.
    plans: (run.expedition.communication_receipts ?? []).map((r) => (r.response_contexts ?? []).map((c) => spokenNormalized({ who: c.target_worker_id, frame: c.semantic_frame, plan: c.response_plan, contribution: c.authorized_contribution }))),
    knowledge: members.map((m) => (m.known_information ?? []).map((k) => [k.kind, k.sender ?? k.source_observer_id ?? null, k.at ?? null, (k.sender ?? k.source_observer_id) === playerId || !(k.sender ?? k.source_observer_id) ? (k.text ?? k.proposition ?? k.target ?? k.equipment_id ?? null) : "<spoken>"])),
    custody: Object.fromEntries(Object.entries(run.expedition.equipment).map(([k, v]) => [k, v.holder])),
    attitudes: Object.fromEntries(Object.entries(world.characters).map(([k, c]) => [k, c.continuity?.attitudes ?? null])),
    memories: Object.fromEntries(Object.entries(world.characters).map(([k, c]) => [k, (c.continuity?.dialogue_memories ?? []).map((m) => [m.player_text, m.response == null ? null : "<spoken>", m.sender ?? null])])),
    affect: members.map((m) => m.emotional_state ?? null),
    survey: run.survey_frontier ?? null,
    queue: run.expedition.speech_queue ?? null,
    phase: state.service.session(state.worldId, "field-researcher").phase?.phase_id ?? null
  };
}
async function runFreeze(provider, { offline = false, concurrency = undefined } = {}) {
  const state = setup("ed24-freeze", provider, { offline, concurrency });
  try {
    const wording = [];
    for (const [i, turn] of FREEZE_TURNS.entries()) {
      const before = state.run.expedition.dialogue_history.length;
      await say(state, turn.text, { request_id: `freeze-${i}` });
      wording.push(spokenSince(state, before).map((e) => e.text));
    }
    return { semantic: semanticState(state), wording };
  } finally { cleanup(state); }
}
function scriptedStyle(variant) {
  return (body) => {
    const u = userOf(body);
    const pick = (a, b) => (variant ? b : a);
    if (/heard_confirmation: you DID/.test(u)) return pick("Yeah, I heard you.", "Heard you fine.");
    if (/is with the person you are talking to/.test(u)) return pick("You've got it.", "That's with you.");
    const holder = u.match(/item_holder: the .+? is with (\w+); say so/);
    if (holder) return pick(`${holder[1]} has it.`, `It's with ${holder[1]}.`);
    if (/self_state: nothing is wrong/.test(u)) return pick("Doing all right.", "Not bad, thanks.");
    if (/request_disposition/.test(u)) return pick("I hear you.", "Heard.");
    if (/Ask ONE short question/.test(u)) return pick("Which one do you mean?", "Sorry, which one?");
    if (/didn't notice anything/.test(u)) return pick("Didn't notice anything.", "Not that I noticed.");
    const name = u.match(/name: your own name is "(\w+)"/);
    if (name) return pick(`I'm ${name[1]}.`, `Name's ${name[1]}.`);
    if (/Say your own earlier line again/.test(u)) return pick("I was just saying who I am.", "Just introducing myself.");
    if (/joke or sarcasm/.test(u)) return pick("Oh, absolutely.", "Sure it is.");
    if (/met them/.test(u)) return pick("Nice to meet you.", "Good to meet you.");
    if (/don't know/.test(u)) return pick("No idea, sorry.", "Couldn't tell you.");
    return pick("Morning.", "Hey there.");
  };
}
test("freeze invariant — five providers, identical canonical semantics; only wording may differ", async () => {
  const good = recordingLocal(scriptedStyle(false));
  const variant = recordingLocal(scriptedStyle(true));
  const garbage = recordingLocal(() => ({ raw: "{not json <<<" }));
  // A provider that never answers: the request times out (AbortError) exactly like a hung server.
  const hung = recordingLocal((body, options) => new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
  const runs = {
    selected: await runFreeze(good.provider),
    baseline_variant: await runFreeze(variant.provider),
    fallback_only: await runFreeze(null, { offline: true }),
    garbage: await runFreeze(garbage.provider),
    timeout: await runFreeze(hung.provider)
  };
  const reference = digest(runs.fallback_only.semantic);
  for (const [name, result] of Object.entries(runs)) {
    if (digest(result.semantic) !== reference) {
      for (const key of Object.keys(result.semantic)) if (digest(result.semantic[key]) !== digest(runs.fallback_only.semantic[key])) {
        if (process.env.ED24_DUMP) fs.writeFileSync(`/tmp/ed24-${name}-${key}.json`, JSON.stringify({ got: result.semantic[key], want: runs.fallback_only.semantic[key] }, null, 1));
        assert.deepEqual(result.semantic[key], runs.fallback_only.semantic[key], `${name}: ${key} differs from fallback-only`);
      }
    }
    assert.equal(digest(result.semantic), reference, `${name} changed canonical semantics`);
  }
  assert.ok(good.bodies.length > 0 && garbage.bodies.length > 0 && hung.bodies.length > 0, "every model-backed run actually called its provider");
  assert.notDeepEqual(runs.selected.wording, runs.fallback_only.wording, "wording may (and here does) differ");
  assert.deepEqual(runs.garbage.wording, runs.fallback_only.wording, "a failed provider is worded by the same-plan fallback");
  assert.deepEqual(runs.timeout.wording, runs.fallback_only.wording);
});

// ─── 6. observer leakage matrix ─────────────────────────────────────────────────────────────────
function compileFor(state, speakerId, text, { run = state.run } = {}) {
  const frame = D.buildSemanticFrame({ text, equipment: run.expedition.equipment });
  const names = Object.fromEntries([...run.expedition.team.members.map((m) => [m.personnel_id ?? m.id, m.first_name]), [state.playerId, "you"]]);
  const custody_known = Object.fromEntries(frame.referents.filter((r) => r.type === "equipment" && r.resolved).map((r) => [r.id, bridge.resolveCustodyKnowledge(run, speakerId, r.id).known]));
  const self = D.buildSelfKnowledge({ member: ledger.getObserverMember(run, speakerId), names, equipment: run.expedition.equipment, player_id: state.playerId, custody_known, self_state: ledger.describeSelfState(ledger.getObserverMember(run, speakerId)) });
  const [plan] = D.planResponses({ frame, owner_ids: [speakerId], responders: { [speakerId]: { self } }, names });
  const contribution = D.toAuthorizedContribution(plan, frame, { names });
  const capsule = bridge.compileObserverDialogueContext({ run, speakerId, semanticFrame: frame, responsePlan: plan, contribution, utterance: text, phaseId: "BRIEFING", purpose: "response" });
  return { capsule, contribution, plan, frame, blob: JSON.stringify(capsule) + JSON.stringify(contribution) };
}

test("leakage A/I — a private observation reaches only its observer's context", () => {
  const state = setup("ed24-leak-a");
  try {
    const [a, b] = state.ids;
    ledger.getObserverMember(state.run, a).known_information.push({ kind: "direct-observation", source: "direct-observation", target: "scorched ceiling panel", at: 0 });
    const q = "Did anyone notice the scorched ceiling panel?";
    const known = (id) => JSON.stringify(compileFor(state, id, q).capsule.known_state);
    assert.match(known(a), /scorched ceiling panel/);
    assert.doesNotMatch(known(b), /scorched/, "B heard the question, but holds no observation of it");
    assert.equal(compileFor(state, a, q).capsule.known_state.find((k) => /scorched/.test(k.text)).epistemic, "observed_earlier");
  } finally { cleanup(state); }
});

test("leakage B/C/D — told is a report; out-of-room misses it; arriving later grants nothing", () => {
  const state = setup("ed24-leak-bcd");
  try {
    const run = state.run;
    const [a, b, c] = state.ids;
    const room = run.spatial.personnel_locations[a];
    run.spatial.personnel_locations[c] = "equipment-staging"; // C is elsewhere
    communicationRouting.routeAndDeliver({ run, channel: "LOCAL", sender: a, recipients: [], text: "The staging lockers are jammed shut.", purpose: "observation-report" });
    const q = "Anything about the staging lockers?";
    const bCtx = compileFor(state, b, q);
    const told = bCtx.capsule.known_state.find((k) => /lockers/.test(k.text));
    assert.ok(told, "B heard A");
    assert.equal(told.epistemic, "told", "B holds it as a report, not an observation");
    assert.match(told.text, /told you/);
    assert.doesNotMatch(compileFor(state, c, q).blob, /jammed/, "C was out of the room");
    run.spatial.personnel_locations[c] = room; // C arrives afterwards
    assert.doesNotMatch(compileFor(state, c, q).blob, /jammed/, "presence later does not grant missed speech");
  } finally { cleanup(state); }
});

test("leakage E/F — unseen custody change stays unknown; a canonical witnessed handoff is learned", () => {
  const state = setup("ed24-leak-ef");
  try {
    const run = state.run;
    const [a, b, c] = state.ids;
    const [key, item] = Object.entries(run.expedition.equipment).find(([, v]) => v.holder === a);
    const label = item.label.toLowerCase();
    item.holder = b;
    item.history.push({ event: "handed-over", holder: b, at: 1 });
    const q = `Who has the ${label}?`;
    const cCtx = compileFor(state, c, q);
    assert.equal(cCtx.contribution.required_facts.find((f) => f.key === "item_holder").value.holder_known, false, "E: C did not see it change hands");
    assert.match(F.presentFallback({ frame: cCtx.frame, plan: cCtx.plan }), /don't know who has/);
    const rejected = spatialEvents.recordWitnessedHandoff(run, { type: "handoff_witnessed", at: 1, observer_id: c, equipment_id: item.id, from_id: a, to_id: a });
    assert.equal(rejected.code, "HANDOFF_NOT_CANONICAL", "a runtime cannot assert a handoff that did not happen");
    assert.equal(spatialEvents.recordWitnessedHandoff(run, { type: "handoff_witnessed", at: 1, observer_id: c, equipment_id: item.id, from_id: a, to_id: b }).ok, true);
    const fact = compileFor(state, c, q).contribution.required_facts.find((f) => f.key === "item_holder").value;
    assert.equal(fact.holder_name, ledger.getObserverMember(run, b).first_name, "F: witnessed -> known");
    assert.ok(key);
  } finally { cleanup(state); }
});

test("leakage G/H — the player's map never flows by keyword; only a granted record appears", async () => {
  const state = setup("ed24-leak-gh");
  try {
    const run = state.run;
    const survey = run.survey_frontier;
    const [a, b] = state.ids;
    survey.personnel[a] ??= { locations: {}, connections: {} };
    survey.personnel[a].locations["records-annex"] = { state: "OBSERVED", provenance: [{ source: "direct", at: 0, direct: true }] };
    const beforePlayer = JSON.stringify(state.run.survey_frontier.personnel[state.playerId]);
    const beforeB = JSON.stringify(state.run.survey_frontier.personnel[b] ?? null);
    await say(state, "Where is the route to the records annex?");
    assert.equal(JSON.stringify(state.run.survey_frontier.personnel[state.playerId]), beforePlayer, "G: asking 'where' copies nobody's map");
    assert.equal(JSON.stringify(state.run.survey_frontier.personnel[b] ?? null), beforeB);
    const r = state.run;
    r.expedition.mission.prior_history ??= [];
    r.expedition.mission.prior_history.push({ id: "rec-annex", kind: "prior-record", text: "The records annex holds the survey slots." }, { id: "rec-secret", kind: "prior-record", text: "The relay alcove floods in spring." });
    ledger.getObserverMember(r, a).known_information.push({ kind: "prior-record-access", record_id: "rec-annex", at: 0 });
    const ctx = compileFor(state, a, "What do you know about the records annex?");
    assert.match(ctx.blob, /records annex holds the survey slots/, "H: the granted record appears");
    assert.doesNotMatch(ctx.blob, /relay alcove floods/, "an ungranted record never does");
    assert.doesNotMatch(compileFor(state, b, "What do you know about the records annex?").blob, /survey slots/, "a coworker without the grant sees nothing");
  } finally { cleanup(state); }
});

test("leakage J — a hidden world-state change reaches no context", () => {
  const state = setup("ed24-leak-j");
  try {
    const run = state.run;
    const world = state.service.getWorld(state.worldId);
    world.phenomena ??= {};
    world.phenomena["phen-hidden"] = { record_version: require("../tools/q4-phenomenon-ecology").RECORD_VERSION, id: "phen-hidden", location_id: run.spatial.player_location, canonical_family: "STILL_LIFE", current_state: "DORMANT", recognition_requirement: "instrumentation" };
    const before = state.ids.map((id) => compileFor(state, id, "Anything strange in here?").blob);
    world.phenomena["phen-hidden"].current_state = "ESCALATING";
    const after = state.ids.map((id) => compileFor(state, id, "Anything strange in here?").blob);
    assert.deepEqual(after, before, "rebuilding a capsule re-evaluates authority; it does not expose the change");
    for (const blob of after) assert.doesNotMatch(blob, /phen-hidden|ESCALATING|DORMANT|STILL_LIFE|current_state/);
  } finally { cleanup(state); }
});

test("disclosure — a keyword about the world writes no relationship; a first-person disclosure does", async () => {
  const state = setup("ed24-disclosure");
  try {
    const target = state.coworkers[0];
    const attitudes = () => JSON.stringify(Object.values(state.service.getWorld(state.worldId).characters[target.personnel_id ?? target.id].continuity?.attitudes ?? {}).map((a) => a.attributions ?? []));
    const before = attitudes();
    await say(state, "It's dark in here.", { target: target.first_name });
    const afterRemark = attitudes();
    assert.doesNotMatch(afterRemark, /shared working preferences/, "'dark' about the room discloses nothing about the player");
    assert.ok(before !== null);
    await say(state, "I get nervous in the dark.", { target: target.first_name });
    assert.match(attitudes(), /shared working preferences/, "a first-person disclosure is attributed");
  } finally { cleanup(state); }
});

// ─── 7. production path: references, cold reload, stale state, order ────────────────────────────
test("production — clarification answers resume the question; 'it' follows the antecedent", async () => {
  const rec = recordingLocal(() => ({ raw: "{bad" }));
  const state = setup("ed24-resume", rec.provider);
  try {
    let before = state.run.expedition.dialogue_history.length;
    await say(state, "Who has the thing?");
    assert.match(spokenSince(state, before)[0].text, /which thing/i);
    before = state.run.expedition.dialogue_history.length;
    await say(state, "The camera.");
    assert.match(spokenSince(state, before)[0].text, /You've got the .*camera/);
    assert.equal(rec.packets.at(-1).authorized_contribution.resumed_question, "Who has the thing?");
    assert.match(userOf(rec.bodies.at(-1)), /Answer their earlier question now: "Who has the thing\?"/);
    before = state.run.expedition.dialogue_history.length;
    await say(state, "Is it here?");
    assert.match(spokenSince(state, before)[0].text, /You've got the .*camera/);
  } finally { cleanup(state); }
});

test("production — cold reload reconstructs heard speech, repair targets and open questions", async () => {
  const rec = recordingLocal(() => ({ raw: "{bad" }));
  const state = setup("ed24-reload", rec.provider);
  try {
    await say(state, "Mind telling me a bit about yourselves?", { request_id: "reload-1" });
    const firstLine = state.run.expedition.dialogue_history.filter((e) => e.submission_id === "reload-1" && e.speaker_id !== state.playerId)[0];
    state.service.shutdown?.();
    const rec2 = recordingLocal(() => ({ raw: "{bad" }));
    const service2 = new DesktopService({ appDataPath: state.root, localDialogueProvider: rec2.provider, developerMode: true });
    assert.equal(service2.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    const run2 = () => service2.session(state.worldId, "field-researcher").run;
    let before = run2().expedition.dialogue_history.length;
    await service2.submitQ4Communication({ world_id: state.worldId, channel: "local", text: "Huh?" });
    const capsule = rec2.packets.at(-1).context_capsule;
    assert.equal(capsule.repair_target.text, firstLine.text, "the repair target is the pre-restart line");
    const preRestart = state.run.expedition.dialogue_history.filter((e) => e.submission_id === "reload-1" && e.speaker_id !== state.playerId).map((e) => e.text);
    assert.ok(capsule.heard_turns.length > 0 && capsule.heard_turns.every((t) => preRestart.includes(t.text)), "pre-restart speech is heard history after restart (the repair target itself travels once, as repair_target)");
    assert.match(run2().expedition.dialogue_history.slice(before).find((e) => e.speaker_id !== state.playerId).text, new RegExp(firstLine.text.split(",")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // an open question survives a restart too
    await service2.submitQ4Communication({ world_id: state.worldId, channel: "local", text: "Who has the thing?" });
    service2.shutdown?.();
    const service3 = new DesktopService({ appDataPath: state.root, localDialogueProvider: recordingLocal(() => ({ raw: "{bad" })).provider });
    assert.equal(service3.resumeSession({ world_id: state.worldId, mode: "field-researcher" }).ok, true);
    const run3 = () => service3.session(state.worldId, "field-researcher").run;
    before = run3().expedition.dialogue_history.length;
    await service3.submitQ4Communication({ world_id: state.worldId, channel: "local", text: "The camera." });
    assert.match(run3().expedition.dialogue_history.slice(before).find((e) => e.speaker_id !== state.playerId).text, /You've got the .*camera/, "the open question survived the restart");
  } finally { cleanup(state); }
});

test("production — state that changes during generation is revalidated before commit", async () => {
  let state = null;
  const provider = { name: "local", model: "m", async presentLocal(packet) {
    // canonical custody changes while the provider is 'thinking'
    const item = Object.values(state.run.expedition.equipment).find((v) => v.holder === state.playerId && /camera/i.test(v.label));
    item.holder = state.ids[1]; item.history.push({ event: "handed-over", holder: state.ids[1], at: 0 });
    return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "You've got the camera." };
  } };
  state = setup("ed24-stale", provider);
  try {
    const before = state.run.expedition.dialogue_history.length;
    await say(state, "Who has the field camera?");
    const spoken = spokenSince(state, before);
    assert.equal(spoken.length, 1, "the turn itself is unchanged");
    assert.doesNotMatch(spoken[0].text, /You've got/, "the stale custody claim was never committed");
    assert.ok(state.logs.some((l) => /pre-commit revalidation rejected candidate/.test(l)));
    const receipt = state.run.expedition.communication_receipts.at(-1);
    assert.doesNotMatch(`${receipt.public_reason} ${receipt.scene?.narration ?? ""}`, /You've got/, "no stale claim survives into narration or the receipt");
  } finally { cleanup(state); }
});

test("production — canonical speech order never follows generation completion order", async () => {
  const delays = [60, 5, 30];
  let calls = 0;
  const provider = { name: "local", model: "m", async presentLocal(packet) { const d = delays[calls++ % 3]; await new Promise((r) => setTimeout(r, d)); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: ["Morning.", "Hey there.", "Hi."][calls - 1] ?? "Hello." }; } };
  const state = setup("ed24-order", provider);
  try {
    const before = state.run.expedition.dialogue_history.length;
    await say(state, "Good morning, y'all.", { request_id: "order-1" });
    const owners = state.run.expedition.interaction_history.at(-1).response_owners.map((o) => o.speaker_id);
    assert.deepEqual(spokenSince(state, before).map((e) => e.speaker_id), owners, "commit order == deterministic owner order");
  } finally { cleanup(state); }
});

test("concurrency — concurrent wording never changes owners, order or canonical semantics", async () => {
  // Completion order is adversarial: the LAST owner finishes first.
  let calls = 0;
  const delays = [70, 35, 5];
  const provider = { name: "local", model: "m", async presentLocal(packet) { const d = delays[calls++ % 3]; await new Promise((r) => setTimeout(r, d)); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "Morning." }; } };
  const state = setup("ed24-conc", provider, { concurrency: 3 });
  try {
    const before = state.run.expedition.dialogue_history.length;
    await say(state, "Good morning, y'all.", { request_id: "conc-1" });
    const owners = state.run.expedition.interaction_history.at(-1).response_owners.map((o) => o.speaker_id);
    const spoken = spokenSince(state, before);
    assert.deepEqual(spoken.map((e) => e.speaker_id), owners, "commit order == canonical owner order, not completion order");
    assert.equal(new Set(spoken.map((e) => e.text)).size, spoken.length, "an identical same-turn line is re-worded or falls back, never repeated");
  } finally { cleanup(state); }
  const serial = await runFreeze(recordingLocal(scriptedStyle(false)).provider);
  const concurrent = await runFreeze(recordingLocal(scriptedStyle(false)).provider, { concurrency: 3 });
  assert.equal(digest(concurrent.semantic), digest(serial.semantic), "concurrent wording is canonically identical to serial wording");
});

test("production — retries are idempotent (same id replays; a reused id with new text is refused)", async () => {
  const state = setup("ed24-idem", recordingLocal(() => "Hey.").provider);
  try {
    const target = state.coworkers[0].first_name;
    const input = { target, text: "I get nervous around loud machinery.", request_id: "idem-1" };
    await say(state, input.text, input);
    const n = state.run.expedition.dialogue_history.length;
    const trust = JSON.stringify(state.service.getWorld(state.worldId).characters[state.ids[0]].continuity.attitudes);
    const replay = await say(state, input.text, input);
    assert.equal(replay.ok, true);
    assert.equal(state.run.expedition.dialogue_history.length, n, "no duplicate speech");
    assert.equal(JSON.stringify(state.service.getWorld(state.worldId).characters[state.ids[0]].continuity.attitudes), trust, "no duplicate attitude change");
    const reused = await say(state, "Something else.", { target, request_id: "idem-1" });
    assert.equal(reused.error?.code, "REQUEST_ID_REUSED");
  } finally { cleanup(state); }
});

// ─── 8. future spatial runtime + affect writer contracts ────────────────────────────────────────
test("spatial contract — renderer state and unknown events are rejected; a selection resolves deixis", () => {
  assert.equal(spatialEvents.validateSpatialEvent({ type: "actor_entered_room", at: 3, actor_id: "a", location_id: "utility-room" }).ok, true);
  assert.equal(spatialEvents.validateSpatialEvent({ type: "actor_entered_room", at: 3, actor_id: "a", location_id: "utility-room", position: [1, 2, 3] }).code, "SPATIAL_EVENT_RENDERER_STATE");
  assert.equal(spatialEvents.validateSpatialEvent({ type: "teleported", at: 3 }).code, "SPATIAL_EVENT_TYPE_UNKNOWN");
  assert.equal(spatialEvents.validateSpatialEvent({ type: "object_visible", at: "now", observer_id: "a", object_id: "o", location_id: "l" }).code, "SPATIAL_EVENT_TIME_INVALID");
  assert.equal(spatialEvents.validateSpatialEvent({ type: "object_visible", at: 1, observer_id: "a", object_id: "o" }).code, "SPATIAL_EVENT_FIELD_MISSING");
  const selection = spatialEvents.toSpatialSelection({ type: "spatial_reference_selected", at: 4, observer_id: "p", entity_id: "connection:staging-door", entity_kind: "door", label: "Staging door" });
  const frame = D.buildSemanticFrame({ text: "Is that door open?", spatial_selection: selection });
  assert.equal(frame.referents[0].resolved, true);
  assert.equal(spatialEvents.toSpatialSelection({ type: "object_visible", at: 1, observer_id: "a", object_id: "o", location_id: "l" }), null);
});

test("affect writer — only a sourced canonical event moves affect; dialogue then expresses it", () => {
  const state = setup("ed24-affect");
  try {
    const run = state.run;
    const id = state.ids[0];
    assert.equal(ledger.applyAffectEvent(run, id, { kind: "physical_exertion" }).code, "AFFECT_EVENT_SOURCE_REQUIRED");
    assert.equal(ledger.applyAffectEvent(run, id, { kind: "feels_sad_because_model_said_so", source: "x" }).code, "AFFECT_EVENT_UNKNOWN");
    assert.equal(ledger.describeSelfState(ledger.getObserverMember(run, id)).state, "ordinary");
    assert.equal(ledger.applyAffectEvent(run, id, { kind: "physical_exertion", source: "test:long-carry", at: 3 }).ok, true);
    assert.deepEqual(ledger.describeSelfState(ledger.getObserverMember(run, id)).affect, ["tired"]);
    const ctx = compileFor(state, id, "How are you holding up?");
    assert.deepEqual(ctx.capsule.human_context.affect, ["tired"]);
    assert.equal(ctx.contribution.required_facts.find((f) => f.key === "self_state").value.state, "affected");
    assert.match(F.presentFallback({ frame: ctx.frame, plan: ctx.plan }), /tired/i);
  } finally { cleanup(state); }
});

// ─── 9. autonomous speech converges on the same bridge ──────────────────────────────────────────
test("autonomous — reports are compiled by the same bridge and fail closed without a plan", () => {
  const src = fs.readFileSync(path.join(__dirname, "../tools/ai-local-dialogue.js"), "utf8");
  assert.equal((src.match(/compileObserverDialogueContext\(/g) ?? []).length, 2, "player and autonomous packets both call the one compiler");
  assert.equal(typeof buildObservationReportPacket, "function");
  const service = fs.readFileSync(path.join(__dirname, "../desktop/service.js"), "utf8");
  assert.match(service, /no authorized contribution/);
  assert.match(service, /DIALOGUE_PLAN_REQUIRED/);
  assert.doesNotMatch(service, /surveyFrontier\.share\(/, "no keyword-driven map transfer remains");
  assert.equal(typeof validateLocalDialogue, "function");
  assert.ok(I.LANGUAGE_PATTERNS.temporal_anchors.briefing instanceof RegExp, "linguistic patterns live in the interpretation module");
});

// ─── 10. provider failure and recovery ──────────────────────────────────────────────────────────
test("recovery — a crashed runtime is respawned once; a healthy one is never killed; stale cooldown clears", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed24-recovery-"));
  const service = new DesktopService({ appDataPath: root, developerMode: true });
  const calls = { respawn: 0, retry: 0, reset: [] };
  let healthy = true;
  service.inferenceAppliance.healthcheck = async () => ({ ok: healthy });
  service.inferenceAppliance.respawn = async () => { calls.respawn += 1; service.inferenceAppliance.state = "READY"; return { ok: true }; };
  service.dialogueRuntime.retry = async () => { calls.retry += 1; return { ready: true }; };
  service.providerPool.resetHealth = (id) => calls.reset.push(id);
  const settle = async () => { while (service.dialogueRepairInFlight) await service.dialogueRepairInFlight; };
  try {
    // A request-level failure while the daemon still answers: keep it, re-check, clear the stale cooldown.
    service.inferenceAppliance.state = "READY";
    service.requestDialogueRuntimeRestart({ state: "degraded" });
    service.requestDialogueRuntimeRestart({ state: "degraded" });
    await settle();
    assert.deepEqual([calls.respawn, calls.retry, calls.reset], [0, 1, ["local"]]);
    // The daemon died: exactly one respawn however many turns ask for it.
    service.inferenceAppliance.state = "REPAIR_REQUIRED";
    healthy = false;
    service.requestDialogueRuntimeRestart({ code: null });
    service.requestDialogueRuntimeRestart({ state: "degraded" });
    await settle();
    assert.deepEqual([calls.respawn, calls.retry], [1, 2]);
    // Retries exhausted over a daemon whose health endpoint still answers: respawn it.
    healthy = true;
    service.requestDialogueRuntimeRestart({ state: "failed" });
    await settle();
    assert.equal(calls.respawn, 2);
    // A runtime that cannot come back is retried a bounded number of times, then left to the fallback.
    service.dialogueRestartBackoffMs = 1;
    service.inferenceAppliance.respawn = async () => { calls.respawn += 1; service.inferenceAppliance.state = "REPAIR_REQUIRED"; return { ok: false }; };
    service.dialogueRuntime.retry = async () => { calls.retry += 1; return { ready: false }; };
    service.requestDialogueRuntimeRestart({ state: "failed" });
    for (let i = 0; i < 50; i++) { await settle(); await new Promise((resolve) => setTimeout(resolve, 5)); }
    assert.equal(calls.respawn, 2 + 3, "three unrecovered restarts, then none");
    assert.equal(service.dialogueRestartFailures, 3);
    // Never while shutting down.
    service.dialogueRestartFailures = 0;
    service.shuttingDown = true;
    service.requestDialogueRuntimeRestart({ state: "failed" });
    await settle();
    assert.equal(calls.respawn, 5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
