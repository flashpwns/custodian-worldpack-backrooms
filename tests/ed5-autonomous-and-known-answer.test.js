"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const { validateLocalDialogue } = require("../tools/ai-local-dialogue");
const { renderContributionTask } = require("../tools/dialogue-prompt-contract");
const { DesktopService } = require("../desktop/service");

const VERSION = "yellow-beast-local-dialogue-candidate@v1";
const report = (purpose, canonical_id = "utility-room") => D.buildAutonomousContribution({ kind: "landmark", canonical_id, state: "RECOGNIZED", purpose, identity_substrate: { social_expression: "dryly observant", region: "Ohio" } });
const verdict = (contribution, speech) => validateLocalDialogue({ speaker: { observer_id: "o1" }, authorized_contribution: contribution }, { version: VERSION, observer_id: "o1", speech });

test("ED-5 — autonomous plan is the same contribution shape: one authorized observation, style only, no facts leaked", () => {
  const c = report("assignment_finding");
  for (const key of ["discourse_function", "purpose", "expected_response_shape", "required_facts", "optional_facts", "forbidden_claims", "style_hints", "same_turn_prior_responses", "may_ask_clarifying_question"]) assert.ok(key in c, key);
  assert.equal(c.discourse_function, "report_observation");
  assert.deepEqual(c.required_facts.map((f) => f.key), ["observation"]);
  assert.deepEqual(c.required_facts[0].value, { subject: "utility room" }, "no scheduler bookkeeping is model-visible");
  assert.equal(c.report_purpose, "assignment_finding");
  assert.equal(c.required_facts[0].value.subject, "utility room");
  assert.deepEqual(c.style_hints, { social_expression: "dryly observant" });
  assert.ok(c.forbidden_claims.includes("unsupported_sensory_claims"));
  assert.equal(report("hazard_warning", "yb-personnel-be4c94c51ed443a93e50").required_facts[0].value.subject, null, "internal ids never become a subject");
});

test("ED-5 — autonomous validation accepts grounded reports and rejects invention, assistant voice, questions and other speakers", () => {
  const c = report("assignment_finding");
  assert.equal(verdict(c, "Found the utility room.").ok, true);
  assert.equal(verdict(c, "I've got eyes on the utility room.").ok, true);
  assert.equal(verdict(c, "The utility room is humming and it smells like smoke.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(c, "Found the utility room. It's definitely dangerous.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(c, "Found the utility room. How can I help you today?").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(c, "We're all seeing the utility room.").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(c, "Found the utility room, want me to check it?").ok, false);
  assert.equal(verdict(c, "Found it. Behind the wall is a hidden passage.").ok, false);
  assert.equal(verdict(report("hazard_warning"), "Careful, the utility room looks dangerous.").ok, true, "the purpose authorizes a hazard property");
});

test("ED-5 — autonomous fallback comes from the same plan and invents nothing", () => {
  assert.equal(F.presentReportFallback({ contribution: report("assignment_finding") }), "I found the utility room.");
  assert.equal(F.presentReportFallback({ contribution: report("hazard_warning") }), "Hold up. I've spotted the utility room.");
  assert.equal(F.presentReportFallback({ contribution: report("equipment_problem") }), "Something's off with the utility room.");
  assert.equal(F.presentReportFallback({ contribution: report("personnel_condition", "yb-personnel-1234567890abcdef") }), "Something about one of us needs a look.");
  for (const purpose of ["hazard_warning", "equipment_problem", "anomaly_notice", "personnel_condition", "assignment_blocker", "assignment_finding"]) {
    const text = F.presentReportFallback({ contribution: report(purpose) });
    assert.equal(verdict(report(purpose), text).ok, true, `fallback for ${purpose} passes its own validator: ${text}`);
  }
  const task = renderContributionTask({ speaker: { observer_id: "o1", known_identity: "Keith" }, authorized_contribution: report("anomaly_notice") });
  assert.match(task, /Nobody spoke to you/);
  assert.doesNotMatch(task, /person you are talking to just said/);
});

test("ED-5 — sarcasm is answered socially, never literally or as advice", () => {
  const frame = D.buildSemanticFrame({ text: "Well, this seems incredibly safe.", recipient_type: "none" });
  const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "A" } }) } }, names: {} });
  const c = D.toAuthorizedContribution(plan, frame, {});
  for (const ok of ["Yeah, reassuring.", "Very comforting.", "Sure looks that way."]) assert.equal(verdict(c, ok).ok, true, ok);
  for (const bad of ["It looks pretty safe to me.", "Let's stay focused.", "Safety protocols are in place.", "It seems fine, honestly."]) assert.equal(verdict(c, bad).ok, false, bad);
  assert.match(renderContributionTask({ speaker: { observer_id: "o", known_identity: "A" }, player_message: { text: "x" }, authorized_contribution: c }), /joke or sarcasm, not a literal claim/);
});

test("ED-5 — group variation: later responders may not open like an earlier one or be near-identical", () => {
  const frame = D.buildSemanticFrame({ text: "Good morning, y'all.", recipient_type: "group" });
  const [plan] = D.planResponses({ frame, owner_ids: ["c-a"], responders: { "c-a": { self: D.buildSelfKnowledge({ person: { first_name: "A" } }) } }, names: {} });
  const c = { ...D.toAuthorizedContribution(plan, frame, {}), same_turn_prior_responses: [{ speaker_name: "Keith", text: "Good morning, everyone." }] };
  assert.equal(verdict(c, "Good morning, all.").ok, false, "same opener");
  assert.equal(verdict(c, "Good morning, everyone.").ok, false, "identical");
  assert.equal(verdict(c, "Morning.").ok, true);
  assert.equal(verdict(c, "Hey there.").ok, true);
  const task = renderContributionTask({ speaker: { observer_id: "o", known_identity: "B" }, player_message: { text: "Good morning, y'all." }, authorized_contribution: c });
  assert.match(task, /Do NOT reuse their opening words or sentence shape/);
});

test("ED-5 — self-description may not claim an invented purpose ('I'm here to …')", () => {
  const frame = D.buildSemanticFrame({ text: "Mind telling me a bit about yourselves?", recipient_type: "group" });
  const self = D.buildSelfKnowledge({ person: { first_name: "Keith", role: "field researcher" }, task: { type: "follow", state: "active", target: "p" }, names: { p: "you" }, player_id: "p" });
  const [plan] = D.planResponses({ frame, owner_ids: ["k"], responders: { k: { self } }, names: { p: "you" } });
  const c = D.toAuthorizedContribution(plan, frame, {});
  assert.equal(verdict(c, "I'm Keith, a field researcher. I'm with the expedition lead.").ok, true);
  assert.equal(verdict(c, "I'm Keith, a field researcher. I'm here to stay with the expedition lead.").ok, false);
});

// ── positive known-answer scenario ──────────────────────────────────────────
function setup(seed, provider) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed5-"));
  const service = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, localDialogueProvider: provider });
  const worldId = service.createWorld({ name: "ED5", seed }).world.id;
  service.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  service.confirmQ4Personnel({ world_id: worldId });
  service.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  service.log = () => {};
  return { root, service, worldId, session: service.session(worldId, "field-researcher") };
}

test("ED-5 — positive known answer: only the knower answers; the fact reaches the contribution, the model, and the fallback", async () => {
  const packets = [];
  const provider = { name: "ed5-capture", model: "v1", async presentLocal(packet) { packets.push(packet); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "I checked the utility room." }; } };
  const rejecting = { name: "ed5-reject", model: "v1", async presentLocal(packet) { return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "I saw a strange glowing door and everything was terrifying." }; } };
  const a = setup("ed5-known", provider);
  const b = setup("ed5-known", rejecting);
  try {
    const seed = (state) => {
      const playerId = state.session.run.session.startup.player.observer_id;
      const knower = state.session.run.expedition.team.members.filter((m) => (m.personnel_id ?? m.id) !== playerId)[0];
      knower.known_information = [...(knower.known_information ?? []), { kind: "location-investigated", source: "direct-observation", location: "utility-room", text: "checked the utility room" }];
      return { playerId, knowerId: knower.personnel_id ?? knower.id };
    };
    const A = seed(a);
    const B = seed(b);
    const before = a.session.run.expedition.dialogue_history.length;
    await a.service.submitQ4Communication({ world_id: a.worldId, channel: "local", text: "What happened while we were apart?" });
    const spoken = a.session.run.expedition.dialogue_history.slice(before).filter((e) => e.speaker_id !== A.playerId);
    assert.deepEqual(spoken.map((e) => e.speaker_id), [A.knowerId], "only the relevant knower answers");
    assert.equal(packets.length, 1);
    const known = packets[0].authorized_contribution.required_facts.find((f) => f.key === "known_answer");
    assert.ok(known, "the known answer is a plan fact in the contribution the model receives");
    assert.equal(known.value.kind, "own-report");
    assert.equal(known.value.checked_location, "utility room");
    // ED-30 (L8/H2): "... and I was fine" would add a self-state the plan does not license; the accepted
    // wording states only the known answer.
    assert.equal(spoken[0].text, "I checked the utility room.", "accepted model wording using only that fact");

    const beforeB = b.session.run.expedition.dialogue_history.length;
    await b.service.submitQ4Communication({ world_id: b.worldId, channel: "local", text: "What happened while we were apart?" });
    const fell = b.session.run.expedition.dialogue_history.slice(beforeB).filter((e) => e.speaker_id !== B.playerId);
    assert.deepEqual(fell.map((e) => e.speaker_id), [B.knowerId]);
    assert.match(fell[0].text, /I checked the utility room/, "the fallback renders the SAME fact");
    assert.doesNotMatch(fell[0].text, /glow|terrif/i, "the rejected candidate's invention is discarded");
  } finally { for (const s of [a, b]) fs.rmSync(s.root, { recursive: true, force: true }); }
});
