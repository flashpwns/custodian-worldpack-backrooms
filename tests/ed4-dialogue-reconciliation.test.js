"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const D = require("../tools/dialogue-discourse");
const F = require("../tools/dialogue-fallback");
const I = require("../tools/dialogue-interpretation");
const { validateLocalDialogue } = require("../tools/ai-local-dialogue");
const { renderContributionTask, LOCAL_DIALOGUE_WORDING_TEXT } = require("../tools/dialogue-prompt-contract");

const PLAYER = "p-jack";
const VERSION = "yellow-beast-local-dialogue-candidate@v1";
const NAMES = { "c-nora": "Nora", "c-omar": "Omar", [PLAYER]: "you" };
const EQUIPMENT = { cam: { id: "cam", label: "35mm field camera", type: "35mm-camera", holder: PLAYER } };
const RESP = { "c-nora": { self: D.buildSelfKnowledge({ person: { first_name: "Nora", role: "field medical doctor" }, names: NAMES }) }, "c-omar": { self: D.buildSelfKnowledge({ person: { first_name: "Omar", role: "survey technician" }, names: NAMES }) } };

const discourseAfter = (playerText, lines, recipient_type = "group") => D.deriveDiscourseState({
  interaction_history: [{ id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: playerText, recipient_type, recipient_id: null, recipient_ids: ["c-nora", "c-omar"], location_id: "hall" }],
  dialogue_history: lines.map(([id, text]) => ({ submission_id: "s1", speaker_id: id, speaker_name: NAMES[id], kind: "speech", text })),
  player_id: PLAYER, location_id: "hall"
});
function plan(text, { recipient_type = "direct", owner = "c-nora", discourse = null } = {}) {
  const frame = D.buildSemanticFrame({ text, recipient_type, interpretation: I.interpretUtterance(text, { isGroup: recipient_type === "group" }), discourse, equipment: EQUIPMENT });
  const [p] = D.planResponses({ frame, owner_ids: [owner], responders: RESP, names: NAMES });
  return { frame, plan: p, contribution: D.toAuthorizedContribution(p, frame, { names: NAMES }) };
}
const verdict = (contribution, speech, player_text = null) => validateLocalDialogue({ speaker: { observer_id: "o1" }, player_message: { text: player_text }, authorized_contribution: contribution }, { version: VERSION, observer_id: "o1", speech });

test("ED-4 — repair phrases are repair acts that target the immediately preceding heard line", () => {
  const prior = discourseAfter("Mind telling me about the route?", [["c-nora", "I don't know."]]);
  for (const text of ["What do you mean?", "Huh?", "Sorry?", "Come again?", "Wait, what?", "What?", "Can you repeat that?", "What did you say?"]) {
    const frame = D.buildSemanticFrame({ text, recipient_type: "direct", discourse: prior });
    assert.ok(["clarify_previous", "request_repetition"].includes(frame.discourse_function), `${text} -> ${frame.discourse_function}`);
    assert.equal(frame.antecedent.resolved, true, text);
    assert.equal(frame.antecedent.responses.at(-1).text, "I don't know.", "the exact prior line, not the earlier topic");
  }
  const { plan: p, frame } = plan("Huh?", { discourse: prior });
  assert.equal(F.presentFallback({ frame, plan: p }), 'I just said, "I don\'t know."');
  const ask = plan("What do you mean?", { discourse: prior });
  assert.equal(ask.plan.required_facts.find((f) => f.key === "antecedent_responses").value[0].is_self, true);
});

test("ED-4 — a repair of a repair points at the original line and only the responder's own line", () => {
  const turns = D.deriveDiscourseState({
    interaction_history: [
      { id: "i1", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s1", player_text: "Hey everyone.", recipient_type: "group", recipient_ids: ["c-nora", "c-omar"], location_id: "hall" },
      { id: "i2", channel: "local", speaker_id: PLAYER, source: "player", delivery: "heard", submission_id: "s2", player_text: "Huh?", recipient_type: "group", recipient_ids: ["c-nora", "c-omar"], location_id: "hall" }
    ],
    dialogue_history: [
      { submission_id: "s1", speaker_id: "c-nora", speaker_name: "Nora", kind: "speech", text: "Morning." },
      { submission_id: "s1", speaker_id: "c-omar", speaker_name: "Omar", kind: "speech", text: "Hey." },
      { submission_id: "s2", speaker_id: "c-nora", speaker_name: "Nora", kind: "speech", text: 'I just said, "Morning."' }
    ],
    player_id: PLAYER, location_id: "hall"
  });
  const { plan: p, frame } = plan("Huh?", { recipient_type: "group", discourse: turns });
  assert.equal(frame.antecedent.responses[0].text, "Morning.");
  const facts = p.required_facts.find((f) => f.key === "antecedent_responses").value;
  assert.deepEqual(facts.map((f) => f.text), ["Morning."], "own line only, not every speaker's");
  assert.equal(F.presentFallback({ frame, plan: p }), 'I just said, "Morning."');
});

test("ED-4 — greetings with vocatives and nonsense are classified deterministically", () => {
  for (const text of ["Goodmorning, y'all", "Good morning, y'all.", "Morning, everyone", "Hey y'all"]) assert.equal(D.buildSemanticFrame({ text, recipient_type: "group" }).discourse_function, "greet", text);
  assert.equal(D.buildSemanticFrame({ text: "Blorp?", recipient_type: "none" }).discourse_function, "ambiguous_reference");
  assert.equal(D.buildSemanticFrame({ text: "Ready?", recipient_type: "direct" }).discourse_function, "ask_factual");
});

test("ED-4 — assistant persona, echo, counter-questions, invention and player-meta are rejected; ordinary wording is accepted", () => {
  const greet = plan("Good morning, y'all.", { recipient_type: "group" }).contribution;
  assert.equal(verdict(greet, "Morning.").ok, true);
  assert.equal(verdict(greet, "Good morning, everyone. Is there anything I can help with today?").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(greet, "Hey. How can I help you?").code, "LOCAL_PRESENTATION_FORBIDDEN_CLAIM");
  assert.equal(verdict(greet, "Morning. I see you've got some work to do today.").ok, false, "invented content beyond a greeting");
  const exp = plan("Have you been there before?").contribution;
  assert.equal(verdict(exp, "Not that I know of.").ok, true);
  assert.equal(verdict(exp, "I don't know.").ok, true);
  assert.equal(verdict(exp, "I've been here before, but not the way you think.").ok, false);
  assert.equal(verdict(exp, "I've never seen the room before.").ok, false, "absolute claims need an authorized fact");
  assert.equal(verdict(exp, "Have you been there before?", "Have you been there before?").ok, false, "echo");
  const unresolved = plan("You know the thing by the thing?", { recipient_type: "none" }).contribution;
  assert.equal(verdict(unresolved, "Which thing do you mean?").ok, true);
  assert.equal(verdict(unresolved, "You know the thing by the thing?", "You know the thing by the thing?").ok, false);
  const joke = plan("Well, this seems incredibly safe.", { recipient_type: "none" }).contribution;
  assert.equal(verdict(joke, "Yeah. Real comforting.").ok, true);
  assert.equal(verdict(joke, "The player's words are a bit too safe for my taste.").ok, false);
});

test("ED-4 — repair must restate the speaker's own line; fresh answers and 'I don't understand' are rejected", () => {
  const prior = discourseAfter("Hey everyone.", [["c-nora", "Good morning, glad everyone made it."]]);
  const c = plan("What do you mean?", { discourse: prior, recipient_type: "group" }).contribution;
  assert.equal(verdict(c, "I said good morning, glad everyone made it.").ok, true);
  assert.equal(verdict(c, "Just saying good morning.").ok, true);
  assert.equal(verdict(c, "I'm confused about what you want.").ok, false);
  assert.equal(verdict(c, "The outpost is north of here.").ok, false);
});

test("ED-4 — same-turn accepted wording is not repeated verbatim by a later responder", () => {
  const greet = { ...plan("Hey everyone.", { recipient_type: "group" }).contribution, same_turn_prior_responses: [{ speaker_name: "Nora", text: "Morning." }] };
  assert.equal(verdict(greet, "Morning.").ok, false);
  assert.equal(verdict(greet, "Hey.").ok, true);
});

test("ED-4 — the model task is a projection of the contribution only, framed as a coworker, not an assistant", () => {
  const c = plan("Who has the field camera?", { recipient_type: "none", owner: "c-nora" }).contribution;
  const text = renderContributionTask({ speaker: { observer_id: "o1", known_identity: "Nora" }, player_message: { text: "Who has the field camera?" }, authorized_contribution: c });
  assert.match(text, /You are Nora, a coworker/);
  assert.match(text, /item_holder: the 35mm field camera is with/);
  assert.doesNotMatch(text, /\bthe player\b|yb-personnel|q4-player|c-nora/i);
  assert.match(LOCAL_DIALOGUE_WORDING_TEXT, /not an assistant/);
});

test("ED-4 — humane fallback wording preserves semantics without database phrasing", () => {
  const fb = (t, o = {}) => { const p = plan(t, o); return F.presentFallback({ frame: p.frame, plan: p.plan }); };
  assert.equal(fb("Where is the exit?"), "I don't know.");
  assert.equal(fb("Have you been there before?"), "Not that I know of.");
  assert.equal(fb("You know the thing by the thing?", { recipient_type: "none" }), "Sorry, which thing do you mean?");
  assert.equal(fb("Who has the field camera?", { owner: "c-nora" }), "You've got the 35mm field camera.");
  for (const t of ["Where is the exit?", "Have you been there before?", "Can you repeat that?", "Huh?"]) assert.doesNotMatch(fb(t), /established|confirmed|information|records?\b/i, t);
});

test("ED-4 — ownership: untargeted greetings/introductions get one responder; a non-present holder is named by a listener", () => {
  const cands = ["c-nora", "c-omar"].map((id) => ({ id, response_eligible: true }));
  const owners = (text, frame, recipient_type = "none") => I.resolveResponseOwners({ recipient_type, interpretation: I.interpretUtterance(text), player_text: text, candidates: cands, frame });
  assert.deepEqual(owners("I'm Jack.", D.buildSemanticFrame({ text: "I'm Jack.", recipient_type: "none" })), ["c-nora"]);
  assert.deepEqual(owners("Hey.", D.buildSemanticFrame({ text: "Hey.", recipient_type: "none" })), ["c-nora"]);
  const camera = D.buildSemanticFrame({ text: "Who has the field camera?", recipient_type: "none", equipment: EQUIPMENT });
  assert.deepEqual(owners("Who has the field camera?", camera), ["c-nora"], "holder is the player, so one listener answers");
  assert.equal(D.frameObligatesResponse(camera, "c-nora", { recipient_type: "none", holder_present: false }), true);
  assert.equal(D.frameObligatesResponse(camera, "c-nora", { recipient_type: "none", holder_present: true }), false);
});
