"use strict";

const { renderKnownAnswer } = require("./dialogue-fallback");

// The ONE wording contract for LOCAL coworker dialogue, shared by the local and
// hosted providers. It restates, for the language layer, what the deterministic
// pipeline already decided; nothing here grants the model any authority.
//
// HARD MODEL-INPUT BOUNDARY. This module is the model-facing renderer. It may
// consume ONLY: the observer-safe capsule (packet.context_capsule, compiled by
// observer-context-compiler.compileObserverDialogueContext), the authorized
// contribution, and the bounded style/output rules below. It requires no
// canonical module, never receives a run/world/expedition, and cannot add,
// infer or look up a fact: whatever the capsule omits, the model never sees.
// Missing context is fixed in the compiler, never here.

const LOCAL_DIALOGUE_WORDING_LINES = Object.freeze([
  "You are wording an already-authorized contribution by a coworker who is physically present in the same place as the person you are talking to. YOU ARE that coworker (see ACTOR): a real person physically present in this place. You are not an assistant, guide, support agent or chatbot (nor a narrator, game master, help desk or mission interface). Speak only as yourself.",
  "You receive CONTEXT (what you safely know and perceive about the situation) and an AUTHORIZED CONTRIBUTION (what you may communicate now). Context only informs wording; the authorized contribution controls meaning. If they appear to conflict, follow the authorized contribution. Never mention something just because it appears in context.",
  "You do NOT decide who speaks, who was addressed, what happened, what is known, which facts are true, or what the speaker's purpose is. authorized_contribution is the ONLY semantic authority: state only its required_facts (and optional_facts if natural), honor forbidden_claims and expected_response_shape, and follow its purpose.",
  "Use style_hints and characterization.style only for tone, never as facts. Keep it natural and brief: usually one short sentence, at most two.",
  "Speak like a coworker, not a service: never offer help or assistance ('How can I help?', 'Is there anything I can help with?', 'What can I do for you?'). A greeting is just a greeting; do not ask a question back.",
  "If the contribution is a repair (clarify_previous / request_repetition), restate or say again YOUR OWN antecedent line in your own words; do not answer a new question and do not say you did not understand.",
  "If there is no authorized fact for a question, say plainly that you don't know or 'not that I know of'. Never ask the question back, and never repeat the player's words back as your answer.",
  "If the contribution asks you to clarify an unresolved reference, ask ONE short question about which thing they mean.",
  "Do not invent biography, prior experience, motives, urgency, implications, certainty, hidden facts, events, observations, relationships or actions. Do not dump mission context, offer unrelated help, speak for other people, or add anything beyond the contribution. Never call them 'the player'. Do not narrate their actions or quote them.",
  "Register: a greeting is a brief friendly greeting in your own words; an introduction is met with a brief acknowledgment of meeting them; sarcasm gets a short dry aside of your own; with no known fact you say plainly that you don't know; an unresolved reference gets one short question about which thing; a repair restates your own earlier line; being asked whether you heard them gets a plain confirmation. Vary your wording naturally: never reuse stock phrases just because they appear in these instructions.",
  "Never reply with their own words, and never ask the player a question unless the contribution requires a clarification.",
  "Return semantic_claims as an empty array."
]);

/**
 * Compact, plain-language rendering of the SAME authorized_contribution the
 * packet carries, for small local models that drown in a raw JSON packet and
 * simply echo the player. It adds no information and no authority: every line is
 * a projection of packet fields, and validation still runs against the plan.
 */
const j = (v) => JSON.stringify(v);
const spoken = (v) => String(v ?? "").replace(/_/g, " ");
const speakerLabel = (turn) => `${String(turn.speaker ?? "Someone").toUpperCase()}${turn.is_self ? " (you)" : ""}`;

const EPISTEMIC_LEAD = Object.freeze({
  perceived_now: "You see this right now",
  observed_earlier: "You noticed this earlier (it may have changed since)",
  told: "Someone told you",
  recorded: "On record",
  self: "About you"
});

/** Baseline voice as plain English (language behaviour only; never facts, biography or current mood). */
function renderVoice(style = {}) {
  const bits = [];
  if (style.social_expression) bits.push(`You are ${style.social_expression}.`);
  if (style.conversational_temperament) bits.push(`In conversation you are ${style.conversational_temperament}.`);
  const habits = [style.social_tendency, style.behavioral_disposition].filter(Boolean);
  if (habits.length) bits.push(`Tendencies: ${habits.join("; ")}.`);
  return bits.length ? bits.join(" ") : null;
}

/** Live human context: only what the compiler established. Absence is stated only when the compiler proved it. */
function renderHumanContext(human) {
  if (!human) return null;
  const bits = [];
  if (human.affect?.length) bits.push(`Right now you are ${human.affect.join(" and ")}. Let that colour how you say it, without changing what you say.`);
  for (const circumstance of human.circumstances ?? []) bits.push(circumstance);
  if (human.relationship) bits.push(human.relationship);
  if (human.ordinary) bits.push("Nothing supplied here establishes anger, fear, urgency or distress; this is an ordinary conversation.");
  return bits.length ? bits.join(" ") : null;
}

/** CONTEXT sections: a compact projection of the observer-safe capsule, nothing more. */
function renderContextSections(capsule) {
  const out = {};
  const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");
  const lower = (text) => String(text).replace(/^./, (ch) => ch.toLowerCase());

  const actor = capsule.actor ?? {};
  const actorBits = [actor.assignment ? `You are ${lower(actor.assignment)}.` : null, actor.activity ? `You are ${lower(actor.activity)}.` : null].filter(Boolean);
  out.who = `You are ${actor.name ?? "a coworker"}${actor.role ? `, ${article(actor.role)} ${lower(actor.role)}` : ""}. ${actorBits.join(" ")}`.trim();
  out.voice = renderVoice(actor.style);

  const scene = capsule.scene ?? {};
  const people = (capsule.present_people ?? []).map((p) => p.name).filter(Boolean);
  const hasPlayer = (capsule.present_people ?? []).some((p) => p.is_player);
  const c = capsule.conversation ?? {};
  const where = [
    scene.location_name ? `You are in the ${scene.location_name}${scene.phase ? ` (${scene.phase})` : ""}.` : (scene.phase ? `Current phase: ${scene.phase}.` : null),
    people.length ? `With you: ${people.join(", ")}.` : null,
    hasPlayer ? "PLAYER is the person you are talking to: say \"you\" to them, never \"them\" or \"PLAYER\"." : null,
    capsule.current_utterance ? (c.recipient_scope === "you" ? "PLAYER is speaking to you directly." : c.recipient_scope === "group" ? "PLAYER is speaking to the whole group." : "PLAYER spoke aloud to the room, to no one in particular.") : null,
    c.current_topic ? `Topic: ${spoken(c.current_topic)}${c.previous_topic && c.previous_topic !== c.current_topic ? ` (before: ${spoken(c.previous_topic)})` : ""}.` : null,
    c.introductions_occurred ? "Introductions have already happened." : null
  ].filter(Boolean);
  out.where = where.join(" ") || null;
  out.human = renderHumanContext(capsule.human_context);

  // The repair/asked-about line is annotated in place when it is already among the heard turns,
  // so it is stated once and still dominates the broader topic.
  const target = capsule.repair_target ?? null;
  const targetMark = target ? (target.kind === "player_line_asked_about" ? "  <- the line you are being asked whether you heard (you did)" : "  <- THE LINE IN QUESTION") : "";
  const heard = capsule.heard_turns ?? [];
  const heardHasTarget = target ? heard.some((turn) => turn.text === target.text) : false;
  const convo = heard.map((turn) => `${speakerLabel(turn)}: ${j(turn.text)}${target && turn.text === target.text ? targetMark : ""}`);
  if (target && !heardHasTarget) convo.push(`${String(target.speaker ?? "Someone").toUpperCase()}${target.is_self ? " (you)" : ""}: ${j(target.text)}${targetMark}`);
  out.recent = convo.length ? convo.join("\n") : null;
  out.known = (capsule.known_state ?? []).length ? capsule.known_state.map((item) => `- ${EPISTEMIC_LEAD[item.epistemic] ?? "Known"}: ${item.text}`).join("\n") : null;
  return out;
}

function renderContributionTask(packet) {
  const c = packet?.authorized_contribution;
  if (!c) return null;
  const capsule = packet.context_capsule ?? null;
  const name = capsule?.actor?.name ?? (typeof packet.speaker?.known_identity === "string" ? packet.speaker.known_identity : (packet.speaker?.known_identity?.name ?? null));
  const isReport = c.discourse_function === "report_observation";
  const utterance = capsule?.current_utterance?.text ?? packet.player_message?.text ?? "";

  const now = [];
  if (!capsule) now.push(`You are ${name ?? "a coworker"}, a coworker standing in the same room as them.`);
  if (isReport) now.push("Nobody spoke to you. You noticed something and are saying it aloud, in a few plain words, to the people near you.");
  else now.push(`The person you are talking to just said (do NOT repeat or quote this): ${j(utterance)}`);

  // how: the shape of this turn. allowed: the facts the turn may state.
  const how = [];
  const allowed = [];
  how.push(`What kind of turn this is: ${c.discourse_function}.`);
  how.push(`Your task: ${c.purpose}.`);
  if (c.expected_response_shape) how.push(`Shape of your reply: ${String(c.expected_response_shape).replace(/_/g, " ")}.`);
  if (c.requested_content) how.push(`Content requested: ${String(c.requested_content).replace(/_/g, " ")}.`);
  // A remembered/observed answer is shown as the plain statement it means, so a small
  // model states it instead of echoing the question. Same fact, no new authority.
  const showFact = (f) => {
    if (f.key === "known_answer" && renderKnownAnswer(f.value)) return `${f.key} (what you know, say it in your own words): ${j(renderKnownAnswer(f.value))}`;
    if (f.key === "heard_confirmation") return f.value?.heard === false ? "heard_confirmation: you did NOT hear their last line, say so plainly" : "heard_confirmation: you DID hear the line they are asking about; confirm it plainly (you may not doubt or reinterpret it)";
    if (f.key === "name") return `name: your own name is ${j(f.value)}; say it`;
    if (f.key === "role") return `role: you are ${/^[aeiou]/i.test(String(f.value)) ? "an" : "a"} ${String(f.value).toLowerCase()}; say so`;
    if (f.key === "current_assignment") return `current_assignment: you are ${String(f.value).replace(/^./, (ch) => ch.toLowerCase())}; say so in plain words`;
    if (f.key === "item_holder") {
      const item = `the ${String(f.value?.label ?? "item").toLowerCase()}`;
      if (f.value?.holder_known === false) return `item_holder: you do NOT know who has ${item}; say you don't know`;
      if (f.value?.holder_is_self) return `item_holder: you are holding ${item}; say so`;
      if (f.value?.holder_name === "you") return `item_holder: ${item} is with the person you are talking to; say "you've got it" (address them as "you")`;
      if (f.value?.holder_name) return `item_holder: ${item} is with ${f.value.holder_name}; say so`;
    }
    return `${f.key}: ${j(f.value)}`;
  };
  const req = isReport ? [] : (c.required_facts ?? []).map(showFact);
  if (isReport) {
    const obs = c.required_facts?.find((f) => f.key === "observation")?.value;
    const subject = obs?.subject;
    const phrase = obs?.subject_phrase ?? (subject ? `the ${subject}` : null);
    if (obs?.entity_class === "fixed_transition") allowed.push(`You are looking at ${phrase}. It is a fixed gate, not an object: never say you found, picked up, carried or used it. Say where you are or what you see, in your own words. Use its name exactly: ${phrase}.`);
    else allowed.push(subject ? `You noticed: ${phrase}. Say so the way a person would, in your own words. Use plain everyday words only; never mention purposes, states, recognition, findings or assignments as terms.` : "You noticed something worth mentioning but there is nothing more specific you may say. Say so in a few plain words.");
  }
  const opt = (c.optional_facts ?? []).map((f) => `${f.key}: ${j(f.value)}`);
  if (!isReport) allowed.push(req.length ? `Facts you must state (and may not go beyond):\n- ${req.join("\n- ")}` : "You have no facts to state. Do not invent any.");
  if (opt.length) allowed.push(`Facts you may add if natural:\n- ${opt.join("\n- ")}`);
  if (c.antecedent?.resolved && c.antecedent.responses?.length) allowed.push(`The line being repaired/referred to (say it again or clarify it, in your words):\n- ${c.antecedent.responses.map((r) => `${r.speaker_name ?? "someone"}: ${j(r.text)}`).join("\n- ")}`);
  if (c.may_ask_clarifying_question) how.push("If the reference is unclear, ask ONE short question about which thing they mean.");
  if ((c.same_turn_prior_responses ?? []).length) how.push(`Others already replied this turn:\n- ${c.same_turn_prior_responses.map((r) => `${r.speaker_name ?? "someone"}: ${j(r.text)}`).join("\n- ")}\nDo NOT reuse their opening words or sentence shape, and do not repeat what they already said; say it your own way.`);
  if (c.discourse_function === "joke_or_sarcasm") how.push("Their remark is a joke or sarcasm, not a literal claim. React with a short wry or dry aside in your own words. Do NOT agree it is really safe, evaluate it literally, give advice, or redirect to work.");
  if (["invite_self_description", "ask_role_or_assignment"].includes(c.discourse_function)) how.push("Say your name/role, and your assignment as what you are doing right now in plain words. Never say you are 'here to' do something.");
  if (c.discourse_function === "greet") how.push("Greet them back in fewer or different words than theirs (a clipped, casual greeting). Do not repeat their exact words, and do not ask a question.");
  if (c.discourse_function === "introduce_self") how.push("Acknowledge that you have met them: greet them or say it is good to meet them. Do not answer with just yes, and do not repeat their words.");
  if (c.discourse_function === "ask_heard_confirmation") how.push("They are asking whether YOU (or anyone) heard THEIR words. Your reply is a short confirmation that you heard them, spoken to them as \"you\" (never \"them\" or \"him\"), such as: I heard you. Do not repeat, quote or summarize what they said, and do not wonder whether anyone heard you or add urgency, meaning or actions.");
  // With a capsule, heard turns are the ONE history surface; without one, the plan's own rows.
  if (!capsule && (c.recent_context ?? []).length) how.push(`Relevant recent exchange: ${j(c.recent_context)}`);
  if (!capsule && (c.relevant_memories ?? []).length) how.push(`Relevant memory: ${j(c.relevant_memories)}`);
  if (!capsule && c.style_hints && Object.keys(c.style_hints).length) how.push(`Tone only (never facts): ${j(c.style_hints)}`);
  if (capsule) how.push("Delivery may carry the voice and current human context above, but never adds a fact, feeling, motive or state they do not establish.");
  if ((c.forbidden_claims ?? []).length) how.push(`Never: ${c.forbidden_claims.map((x) => String(x).replace(/_/g, " ")).join(", ")}.`);
  const output = `Reply as ${name ?? "the coworker"} in ${isReport ? "one short spoken sentence" : "one or two short spoken sentences"}. Return JSON: {"version":"yellow-beast-local-dialogue-candidate@v1","observer_id":${j(packet.speaker?.observer_id ?? "")},"speech":"<what you say>","semantic_claims":[]}`;

  if (!capsule) return [...now, ...how.slice(0, 4), ...allowed, ...how.slice(4), output].join("\n");
  const s = renderContextSections(capsule);
  // The player's line leads the prompt (a 1.5B model otherwise echoes the last quoted line). Where the plan
  // already carries the whole meaning of a question, only the fact that a question was asked is stated;
  // the line itself remains available as a heard turn.
  const planCarriesMeaning = ["ask_item_ownership", "ask_heard_confirmation", "ask_role_or_assignment"].includes(c.discourse_function);
  const lead = planCarriesMeaning && !isReport ? "PLAYER just asked you a question (the facts below say what you may answer)." : now.join(" ");
  const parts = [lead, `WHO YOU ARE:\n${s.who}`];
  if (s.voice) parts.push(`HOW YOU GENERALLY SPEAK:\n${s.voice}`);
  if (s.where) parts.push(`WHERE YOU ARE / WHAT IS HAPPENING:\n${s.where}`);
  if (s.human) parts.push(`CURRENT HUMAN CONTEXT:\n${s.human}`);
  parts.push(`RECENT CONVERSATION (only what you heard):\n${s.recent ?? "(nothing relevant heard recently)"}`);
  if (s.known) parts.push(`WHAT YOU KNOW THAT BEARS ON THIS:\n${s.known}`);
  parts.push(`WHAT YOU ARE ALLOWED TO SAY (this controls meaning):\n${allowed.join("\n")}`);
  parts.push(`HOW TO ANSWER THIS TURN:\n${how.join("\n")}\n${output}`);
  return parts.join("\n\n");
}

/** Rough prompt size for budget checks (characters / 4). */
const approximateTokens = (text) => Math.ceil(String(text ?? "").length / 4);

module.exports = { renderContributionTask, renderContextSections, renderVoice, renderHumanContext, approximateTokens, LOCAL_DIALOGUE_WORDING_LINES, LOCAL_DIALOGUE_WORDING_TEXT: LOCAL_DIALOGUE_WORDING_LINES.join(" ") };
