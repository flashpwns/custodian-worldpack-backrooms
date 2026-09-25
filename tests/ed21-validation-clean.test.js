"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const I = require("../tools/dialogue-interpretation");
const continuity = require("../tools/q4-personnel-continuity");
const { validateLocalDialogue, validateDialogueClaims } = require("../tools/ai-local-dialogue");
const { DesktopService } = require("../desktop/service");

const PLAYER = "p-jack";
const VERSION = "yellow-beast-local-dialogue-candidate@v1";
const EQUIPMENT = {
  cam: { id: "cam", label: "35mm field camera", type: "35mm-camera", holder: "c-nora" },
  radio: { id: "radio", label: "Survey radio", type: "survey-radio", holder: "c-omar" }
};
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", "c-diego": "Diego", [PLAYER]: "you" };
const SELF = {
  // custody_known: the observer authority's grant (the service always supplies it); without it custody is unknown.
  "c-nora": D.buildSelfKnowledge({ person: { first_name: "Nora", role: "field medical doctor" }, names: NAMES, custody_known: { cam: true, radio: true } }),
  "c-omar": D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, names: NAMES, custody_known: { cam: true, radio: true } }),
  "c-diego": D.buildSelfKnowledge({ person: { first_name: "Diego", role: "field technician" }, names: NAMES, custody_known: { cam: true, radio: true } })
};
const RESP = Object.fromEntries(Object.entries(SELF).map(([id, self]) => [id, { self }]));
function contributionFor(text, { recipient_type = "direct", owner = "c-omar", discourse = null } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, interpretation: I.interpretUtterance(text, { isGroup: recipient_type === "group" }), discourse, equipment: EQUIPMENT });
  const [plan] = D.planResponses({ frame, owner_ids: [owner], responders: RESP, names: NAMES });
  return { frame, plan, contribution: D.toAuthorizedContribution(plan, frame, { names: NAMES }) };
}
const verdict = (contribution, speech, extra = {}) => validateLocalDialogue({ speaker: { observer_id: "o1" }, authorized_contribution: contribution }, { version: VERSION, observer_id: "o1", speech, ...extra });
const run = { expedition: { equipment: EQUIPMENT, team: { members: [{ personnel_id: "c-nora", first_name: "Nora" }, { personnel_id: "c-omar", first_name: "Omar" }] } }, session: { startup: { player: { observer_id: PLAYER } } } };
const claims = (speaker, speech) => validateDialogueClaims({ speaker: { observer_id: speaker }, visible_context: { visible_objects: [] } }, { speech }, run);

test("ED-2.1 A/B — item holder short forms are accepted for the canonical holder", () => {
  const { contribution } = contributionFor("Who has the field camera?", { owner: "c-omar" });
  for (const speech of ["Nora's got the camera.", "Nora.", "Nora does.", "It's with Nora.", "Nora has the camera."]) assert.equal(verdict(contribution, speech).ok, true, speech);
  assert.equal(verdict(contribution, "Omar has the camera.").ok, false);
  assert.equal(verdict(contribution, "Not Nora.").ok, false);
  assert.equal(verdict(contribution, "I've got the camera.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
});

test("ED-2.1 C/D — self-description without I/my; faithful repetition paraphrase", () => {
  const { contribution } = contributionFor("Tell me about yourself.", { owner: "c-diego" });
  assert.equal(verdict(contribution, "Name's Diego, field technician.").ok, true);
  assert.notEqual(verdict(contribution, "Name's Diego, field technician. Grew up in Ohio, nursing degree.").ok, true, "unsupported biography still rejected");

  const discourse = D.deriveDiscourseState({
    interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Introduce yourself.", recipient_type: "direct", recipient_id: "c-diego", recipient_ids: ["c-diego"], location_id: "hall" }],
    dialogue_history: [{ submission_id: "s1", speaker_id: "c-diego", speaker_name: "Diego", kind: "speech", text: "I'm Diego, field technician." }],
    player_id: PLAYER, location_id: "hall"
  });
  for (const text of ["What?", "Can you repeat that?"]) {
    const c = contributionFor(text, { owner: "c-diego", discourse }).contribution;
    assert.equal(verdict(c, "I was just introducing myself.").ok, true, text);
    assert.equal(verdict(c, "The outpost is north and the cutoff is at one, plus the exit is sealed.").ok, false, "ungrounded content still rejected");
  }
});

test("ED-2.1 E/F/G — negated first-person phrases are not custody claims; multi-claim spans are independent", () => {
  for (const speech of ["I've no idea where the camera is.", "I've never touched the camera.", "I don't have the camera, Nora does.", "The camera isn't with me."]) {
    assert.equal(claims("c-omar", speech).ok, true, speech);
  }
  const playerHolds = { ...run, expedition: { ...run.expedition, equipment: { ...EQUIPMENT, cam: { ...EQUIPMENT.cam, holder: PLAYER } } } };
  assert.equal(validateDialogueClaims({ speaker: { observer_id: "c-omar" }, visible_context: { visible_objects: [] } }, { speech: "Not me, I've got the radio; the camera's with you." }, playerHolds).ok, true);
  assert.equal(claims("c-omar", "I've got the radio and the camera's with Nora.").ok, true);
  assert.equal(claims("c-omar", "I've got the radio and the camera's with Omar.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(claims("c-omar", "I've got the camera and the radio's with Nora.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  assert.equal(claims("c-omar", "I've got the camera.").code, "LOCAL_PRESENTATION_CLAIM_CONTRADICTION");
  // plan-side holder check shares the same guards
  const { contribution } = contributionFor("Who has the field camera?", { owner: "c-omar" });
  assert.equal(verdict(contribution, "I've never touched the camera; Nora has it.").ok, true);
  assert.equal(verdict(contribution, "I've no idea where the camera is, Nora does.").ok, true);
});

test("ED-2.1 H — plan-carrying packets ignore the legacy semantic_claim system", () => {
  const { contribution } = contributionFor("Who has the field camera?", { owner: "c-omar" });
  const realistic = [{ type: "equipment-possession", text: "Nora has the camera", subject: "c-omar", object: "cam", location_id: null, target: null, proposition: null }, { type: "location", text: "there is", subject: null, object: null, location_id: "nowhere", target: null, proposition: null }];
  const result = verdict(contribution, "There's a camera and Nora has it.", { semantic_claims: realistic }, { _run: run });
  assert.equal(result.ok, true);
  assert.deepEqual(result.candidate.semantic_claims, []);
  // no plan: the legacy system still runs
  assert.equal(validateLocalDialogue({ speaker: { observer_id: "o1" } }, { version: VERSION, observer_id: "o1", speech: "There is a door behind us.", semantic_claims: [] }, run).code, "LOCAL_PRESENTATION_CLAIM_UNSUPPORTED");
});

test("ED-2.1 I/J — 'What did you say to Kirk?' is not a recalled-reply query; '@Nora can you repeat that?' parses", () => {
  const person = { continuity: { dialogue_memories: [{ player_text: "hello", response: "hi", text: "hi" }] } };
  const r = { expedition: { team: { members: [{ personnel_id: "c-nora", first_name: "Nora" }] } }, session: { startup: { player: { observer_id: PLAYER } } } };
  const world = { characters: { "c-nora": person } };
  assert.equal(continuity.resolveKnownAnswer(r, "c-nora", "What did you say to Kirk?", world), null);
  assert.equal(continuity.resolveKnownAnswer(r, "c-nora", "What did you say about the camera?", world), null);
  const known = (name) => ["nora", "omar"].includes(name.toLowerCase());
  const parsed = I.parseNamedAddress("@Nora can you repeat that?", { explicit_target: "Nora", is_known: known });
  assert.equal(parsed.residual_text, "can you repeat that?");
  assert.equal(parsed.address_type, "direct");
  assert.equal(I.parseNamedAddress("@Nora can you repeat that?", { is_known: known }).residual_text, "can you repeat that?");
  assert.equal(I.parseNamedAddress("@Nora Vasquez, what?", { explicit_target: "Nora Vasquez" }).residual_text, "what?");
  assert.equal(I.parseNamedAddress("Omar, what?", { explicit_target: "Nora" }).residual_text, "Omar, what?");
  const frame = D.buildSemanticFrame({ text: parsed.residual_text, recipient_type: "direct" });
  assert.equal(frame.discourse_function, "request_repetition");
  assert.equal(D.KNOWN_ANSWER_FUNCTIONS.includes("request_repetition"), false, "known answers are consumed only by functions whose plan reads them");
});

test("ED-2.1 fallback parity — unresolved items and missing antecedents ask for clarification", () => {
  const { frame, plan } = contributionFor("Who was assigned the oxygen tank?");
  assert.equal(F.presentFallback({ frame, plan }), "Which thing do you mean?");
  const noAnte = contributionFor("Can you repeat that?", { owner: "c-nora" });
  const text = F.presentFallback({ frame: noAnte.frame, plan: noAnte.plan });
  assert.match(text, /\?$/);
  const factual = contributionFor("Where is the oxygen tank?", { owner: "c-nora" });
  assert.match(F.presentFallback({ frame: factual.frame, plan: factual.plan }) ?? "?", /\?$|know|confirm/);
});

async function service(provider, seed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-ed21-"));
  const svc = new DesktopService({ appDataPath: root, defaultQ4Scenario: "day1-opener", developerMode: true, localDialogueProvider: provider });
  const worldId = svc.createWorld({ name: "ED21", seed }).world.id;
  svc.createQ4Personnel({ world_id: worldId, first_name: "Eleanor", last_name: "Vance" });
  svc.confirmQ4Personnel({ world_id: worldId });
  svc.startSession({ world_id: worldId, mode: "field-researcher", scenario: "day1-opener" });
  svc.submitAction({ world_id: worldId, mode: "field-researcher", action: "ATTEND_BRIEFING" });
  // Deliver every briefing beat before concluding, as the Electron flow does (knowledge comes from what was said).
  for (let beat = 0; beat < 3; beat += 1) svc.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONTINUE_BRIEFING" });
  svc.submitAction({ world_id: worldId, mode: "field-researcher", action: "CONCLUDE_BRIEFING" });
  svc.log = () => {};
  return { root, svc, worldId, session: svc.session(worldId, "field-researcher") };
}

test("ED-2.1 K/L — accepted candidate commits without legacy rejection; rejected candidate falls back from the same plan", async () => {
  const packets = [];
  const lines = ["Morning.", "Hey.", "Hello."]; let n = 0;
  const accepting = { name: "ed21-accept", model: "v1", async presentLocal(packet) { packets.push(packet); return { version: VERSION, observer_id: packet.speaker.observer_id, speech: lines[n++ % lines.length], semantic_claims: [{ type: "equipment-possession", text: "Morning", subject: "x", object: "y", location_id: null, target: null, proposition: null }] }; } };
  const rejecting = { name: "ed21-reject", model: "v1", async presentLocal(packet) { return { version: VERSION, observer_id: packet.speaker.observer_id, speech: "I grew up in a small town in Ohio and studied nursing." }; } };
  const a = await service(accepting, "ed21-k");
  const b = await service(rejecting, "ed21-l");
  const c = await service(null, "ed21-l");
  try {
    const go = async (s, text) => { const before = s.session.run.expedition.dialogue_history.length; await s.svc.submitQ4Communication({ world_id: s.worldId, channel: "local", text }); return s.session.run.expedition.dialogue_history.slice(before).filter((e) => e.kind === "speech" && e.speaker_id !== s.session.run.session.startup.player.observer_id).map((e) => e.text); };
    const accepted = await go(a, "Hello, everyone.");
    assert.ok(accepted.length > 0);
    assert.deepEqual(accepted, lines.slice(0, accepted.length), "model wording committed in owner order (distinct lines)");
    const fellBack = await go(b, "Mind telling me a bit about yourselves?");
    const baseline = await go(c, "Mind telling me a bit about yourselves?");
    assert.deepEqual(fellBack, baseline, "rejection uses the same-plan fallback");
  } finally { for (const s of [a, b, c]) fs.rmSync(s.root, { recursive: true, force: true }); }
});
