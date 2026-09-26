"use strict";

// Shared ED-30 test harness: the REAL production service (DesktopService) on a Day-1 opener run, with the
// human trace's scene names (Giselle = first-day observer, Malcolm = intern courier, Tonya = veteran
// doctor). Nothing here stubs interpretation, planning, validation or commit.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DesktopService } = require("../../../desktop/service");
const { createLocalModelProvider } = require("../../../tools/ai-local-model-provider");

const SCENE_NAMES = ["Giselle", "Malcolm", "Tonya"];

function setup(seed, provider = null, { brief = true, rename = true, offline = false, root = null } = {}) {
  const dir = root ?? fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed30-"));
  const service = new DesktopService({ appDataPath: dir, defaultQ4Scenario: "day1-opener", developerMode: true, ...(provider ? { localDialogueProvider: provider } : {}) });
  if (offline) service.updateSettings({ provider: "offline" });
  const logs = [];
  service.log = (line) => logs.push(String(line));
  const worldId = service.createWorld({ name: "ED30", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Jack", last_name: "Tester" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  const state = { root: dir, service, worldId, logs, counter: 0 };
  Object.defineProperty(state, "run", { get: () => service.session(worldId, "field-researcher").run, configurable: true });
  state.playerId = state.run.session.startup.player.observer_id;
  const team = () => state.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== state.playerId);
  if (rename) {
    const world = service.getWorld(worldId);
    team().forEach((m, i) => {
      const id = m.personnel_id ?? m.id;
      m.first_name = SCENE_NAMES[i];
      m.display_name = `${SCENE_NAMES[i]} ${m.last_name}`;
      for (const w of [world, state.run._world]) { const c = w?.characters?.[id]; if (c) { c.first_name = SCENE_NAMES[i]; c.display_name = `${SCENE_NAMES[i]} ${c.last_name}`; } }
    });
    service.persistSession(world, "field-researcher", service.session(worldId, "field-researcher"));
  }
  state.ids = team().map((m) => m.personnel_id ?? m.id);
  state.names = team().map((m) => m.first_name);
  state.id = (name) => state.ids[state.names.indexOf(name)];
  state.brief = () => {
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
    for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
    service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  };
  if (brief) state.brief();
  return state;
}
const cleanup = (state) => { try { state.service.shutdown?.(); } catch {} fs.rmSync(state.root, { recursive: true, force: true }); };

async function turn(state, text, extra = {}) {
  const id = extra.request_id ?? `t-${++state.counter}`;
  state.logs.length = 0;
  const result = await state.service.submitQ4Communication({ world_id: state.worldId, channel: "local", text, request_id: id, ...extra });
  const run = state.run;
  const contexts = run.expedition.communication_receipts.find((r) => r.id === id)?.response_contexts ?? [];
  const interaction = run.expedition.interaction_history.find((i) => i.submission_id === id) ?? null;
  const spoken = run.expedition.dialogue_history.filter((e) => e.submission_id === id && e.speaker_id !== state.playerId);
  const traceLine = state.logs.find((line) => line.startsWith("[YB:DISCOURSE_TRACE]"));
  const nameOf = (sid) => state.names[state.ids.indexOf(sid)] ?? sid;
  return {
    id, result, contexts, interaction,
    frame: contexts[0]?.semantic_frame ?? null,
    fn: contexts[0]?.semantic_frame?.discourse_function ?? null,
    predicate: contexts[0]?.semantic_frame?.predicate ?? interaction?.turn?.primary?.predicate ?? null,
    owners: contexts.map((c) => c.target_worker_id),
    ownerNames: contexts.map((c) => nameOf(c.target_worker_id)),
    plan: (who) => (contexts.find((c) => c.target_worker_id === who) ?? contexts[0])?.response_plan ?? null,
    spoken,
    lines: spoken.map((e) => `${e.speaker_name}: ${e.text}`),
    speakers: spoken.map((e) => e.speaker_name),
    turnRecord: interaction?.turn ?? null,
    trace: traceLine ? JSON.parse(traceLine.slice("[YB:DISCOURSE_TRACE] ".length)) : null
  };
}

/** A local-model provider whose HTTP layer is scripted (the real provider code runs). */
function scriptedLocal(responder) {
  const fetchImpl = (url, options) => Promise.resolve(responder(JSON.parse(options.body))).then((out) => {
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => ({ id: "t", choices: [{ message: { content: out && typeof out === "object" && "raw" in out ? out.raw : JSON.stringify({ speech: out }) } }] }) };
  });
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:8734", fetchImpl, timeout: 300 });
  return { name: "local", model: real.model, presentLocal: (packet) => real.presentLocal(packet), interpretDialogue: (input) => real.interpretDialogue(input) };
}
const garbage = () => scriptedLocal(() => ({ raw: "{bad" }));
const throwing = () => scriptedLocal(() => new Error("provider crashed"));
/** A wording provider that always tries the worst leak: another person's private state. */
const leaky = () => scriptedLocal((body) => (/classify the LANGUAGE/.test(body.messages[0].content) ? { raw: "{}" } : "Not too bad myself. Tonya's doing alright too."));

const KEEP_PLAN = (plan) => (plan ? { fn: plan.discourse_function, required: (plan.required_facts ?? []).map((f) => [f.key, f.key === "predicate_answer" ? { predicate: f.value.predicate, value: f.value.value } : f.value]), clarify: Boolean(plan.may_ask_clarifying_question) } : null);
/**
 * Provider-independent semantic digest of a run's dialogue: per turn, the resolved address, predicate,
 * function, owners, cardinality, plans (facts, not wording) and the ledger's request states.
 */
function semanticDigest(run) {
  const turns = (run.expedition.communication_receipts ?? []).map((r) => {
    const interaction = run.expedition.interaction_history.find((i) => i.submission_id === r.id) ?? null;
    return {
      text: r.text,
      address: interaction?.address ? { scope: interaction.address.scope, ids: interaction.address.addressee_ids } : null,
      turn: interaction?.turn?.primary ? { predicate: interaction.turn.primary.predicate, relation: interaction.turn.primary.relation, cardinality: interaction.turn.primary.cardinality, clarify: interaction.turn.primary.clarify } : null,
      contexts: (r.response_contexts ?? []).map((c) => ({ who: c.target_worker_id, fn: c.semantic_frame?.discourse_function ?? null, predicate: c.semantic_frame?.predicate ?? null, cardinality: c.semantic_frame?.turn?.cardinality ?? null, plan: KEEP_PLAN(c.response_plan), request: c.request_id ?? null }))
    };
  });
  const ledger = (run.expedition.dialogue_state?.requests ?? []).map((r) => ({ id: r.request_id, predicate: r.predicate, state: r.state, slots: Object.fromEntries(Object.entries(r.slots).map(([k, v]) => [k, v.state])) }));
  const acquaintance = run.expedition.dialogue_state?.acquaintance ?? null;
  const json = JSON.stringify({ turns, ledger, acquaintance: acquaintance ? { complete: acquaintance.complete_at != null, by: acquaintance.completed_by ?? null } : null });
  return { digest: crypto.createHash("sha256").update(json).digest("hex").slice(0, 16), json };
}

module.exports = { SCENE_NAMES, setup, cleanup, turn, scriptedLocal, garbage, throwing, leaky, semanticDigest };
