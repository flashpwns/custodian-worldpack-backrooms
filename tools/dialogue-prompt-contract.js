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

// Compact system prompt for plan-carrying LOCAL dialogue (the production path). Turn-specific rules
// travel only with the turn that needs them (renderContributionTask); nothing here repeats them, and
// no field names of the internal packet appear (the model sees rendered sections, not JSON).
const LOCAL_DIALOGUE_SYSTEM_LINES = Object.freeze([
  "You speak as one coworker in a workplace conversation. Who speaks, what happened, what you know and what you may say were decided before you speak; you only choose the words.",
  "You are a real person in the room, not an assistant, narrator, guide or help desk. Never offer help or services.",
  "WHAT YOU ARE ALLOWED TO SAY controls meaning: say those facts and nothing beyond them. The other sections only orient you; never mention something just because it appears there.",
  "Never invent facts, events, observations, experience, biography, feelings, motives, urgency, plans, promises or actions, and never speak for other people. Your voice and current state may colour how you say it, never what you say.",
  "Talk to the person as \"you\". Do not repeat, quote or echo their words unless you are asked to say something again.",
  "Sound like ordinary speech in your own voice: plain, brief, natural. Vary your wording; never copy phrases from these instructions.",
  "Reply with exactly one JSON object and nothing else."
]);
const LOCAL_DIALOGUE_SYSTEM_TEXT = LOCAL_DIALOGUE_SYSTEM_LINES.join("\n");

// Turn-specific constraints worth stating in words (the rest of COMMON_FORBIDDEN is already the
// system prompt's general rule, so repeating it per turn only adds tokens).
const FORBIDDEN_WORDING = Object.freeze({
  unrequested_mission_briefing: "bring up mission details nobody asked about",
  unrelated_task_offer: "offer to do tasks",
  new_factual_claims: "add anything new beyond that line",
  unrequested_interpretation: "interpret what they meant",
  invented_urgency: "add urgency",
  acceptance_or_commitment: "agree to, accept, promise or refuse it",
  unsupported_sensory_claims: "describe sounds, smells or sensations you were not given",
  invented_anomaly_properties: "say what it is, what caused it or whether it is dangerous"
});

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
    hasPlayer ? "PLAYER is the person talking with you. Speak to them directly; never call them \"PLAYER\", and do not use \"you\" as if it were their name." : null,
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

// Which kind of not-knowing a no-fact answer is (decided by the plan); the model words that kind.
const UNCERTAINTY_GUIDE = Object.freeze({
  did_not_perceive: "You did not notice anything like that: say so plainly.",
  no_established_personal_history: "Nothing tells you whether you have or haven't: answer the way a person does who can't think of a time (for example, not that you can think of). Never claim you have, or that you never have.",
  background_not_shared: "You would rather not get into your background: say so politely.",
  not_told: "Nobody has told you that: say so plainly (you haven't been told), without guessing.",
  no_established_opinion: "You have no particular view on it yet: say so briefly; never invent an opinion.",
  procedure_not_known: "You do not know what comes next: say so plainly.",
  no_established_fact: "No fact answers this: say plainly that you don't know, in your own words. Never ask the question back."
});
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
  if (!capsule) {
    // Legacy rendering (no capsule): unchanged surface for callers that predate the bridge.
    how.push(`What kind of turn this is: ${c.discourse_function}.`);
    how.push(`Your task: ${c.purpose}.`);
    if (c.expected_response_shape) how.push(`Shape of your reply: ${String(c.expected_response_shape).replace(/_/g, " ")}.`);
    if (c.requested_content) how.push(`Content requested: ${String(c.requested_content).replace(/_/g, " ")}.`);
  } else how.push(`Your task: ${c.purpose}.`);
  // A remembered/observed answer is shown as the plain statement it means, so a small
  // model states it instead of echoing the question. Same fact, no new authority.
  const showFact = (f) => {
    if (f.key === "known_answer" && renderKnownAnswer(f.value)) return `${f.key} (what you know, say it in your own words): ${j(renderKnownAnswer(f.value))}`;
    if (f.key === "heard_confirmation") return f.value?.heard === false ? "heard_confirmation: you did NOT hear their last line, say so plainly" : "heard_confirmation: you DID hear the line they are asking about; confirm it plainly (you may not doubt or reinterpret it)";
    if (f.key === "name") return `name: your own name is ${j(f.value)}; say it`;
    if (f.key === "role") return `role: you are ${/^[aeiou]/i.test(String(f.value)) ? "an" : "a"} ${String(f.value).toLowerCase()}; say so`;
    if (f.key === "current_assignment") return `current_assignment: you are ${String(f.value).replace(/^./, (ch) => ch.toLowerCase())}; say so in plain words`;
    if (f.key === "self_state_answer") {
      const asked = { positive: "excited or eager", tense: "nervous or tense", tired: "tired", wellbeing: "all right" }[f.value?.asked] ?? "that way";
      if (f.value?.answer === "yes") return `They asked if you feel ${asked}: you do. Say so briefly, for yourself only.`;
      if (f.value?.answer === "not_especially") return `They asked if you feel ${asked}: you don't feel anything special either way right now. Say so briefly ("not especially"), for yourself only. You know how you feel: never say you don't know, and never claim excitement, nerves or worry.`;
      if (f.value?.answer === "affected_instead" || f.value?.answer === "affected") return `They asked how you feel: say plainly what you actually feel (given below), for yourself only.`;
      return "They asked how you are: you are doing all right. Say so briefly, for yourself only.";
    }
    if (f.key === "current_procedure") {
      const steps = `${f.value?.current_step ? `${f.value.current_step}, then ` : ""}${f.value?.next_step}`;
      return f.value?.scope === "day"
        ? `They are asking about the whole day. All you were told (at ${f.value?.source ?? "the briefing"}) is: ${steps}. Say that this is all you've been told for today; do not invent a schedule.`
        : `What comes next (what you all were told at ${f.value?.source ?? "the briefing"}): ${steps}. Say that, briefly; add nothing else about the mission.`;
    }
    if (f.key === "explanation_basis") {
      const b = f.value ?? {};
      const noFactWhy = { did_not_perceive: "you simply did not notice anything", not_told: "nobody has told you", no_established_personal_history: "you can't think of a time you have", no_established_opinion: "you just haven't formed a view on it" }[b.uncertainty] ?? (b.past_perception ? "you simply did not notice anything" : "you simply have nothing to go on");
      const why = {
        self_state: b.state === "affected" ? `it is just how you feel right now (${(b.affect ?? []).join(" and ")})` : "it is just how you feel right now; nothing out of the ordinary",
        no_known_fact: noFactWhy,
        observation: "it is what you saw yourself",
        clarification: "you were not sure what they meant",
        briefing_instruction: `it is what you were all told at ${b.source ?? "the briefing"}`,
        custody: b.holder_is_self ? "the item is with you" : (b.holder_known === false ? "you do not know who has it" : "that is where it is, as far as you know"),
        known_information: "it is what you know about it",
        assignment: "it is your assignment",
        heard: b.heard ? "you heard them say it" : "you did not catch it",
        restatement: "you were only repeating what was said",
        request_policy: b.disposition === "requires_structured_handoff" ? "things only change hands through a proper handoff" : "you were only saying you heard them",
        not_own_line: `you did not say it${b.speaker_name ? `; ${b.speaker_name} did` : ""}`,
        social: "there was no particular reason; it was just conversation"
      }[b.kind] ?? "you just meant what you said";
      return `Why you said your previous line: ${why}. Give exactly that reason, in your own words; no other reason, experience, danger or plan.`;
    }
    if (f.key === "self_state") {
      const affect = (f.value?.affect ?? []).filter((a) => !/guarded/i.test(a));
      return f.value?.state === "affected" && affect.length
        ? `How you are right now: ${affect.join(" and ")}. Say so plainly, for yourself only.`
        : "How you are right now: nothing is wrong. Answer that you are doing all right, for yourself only; do not claim to be tired, stressed or worried.";
    }
    if (f.key === "request_disposition") {
      const wanted = f.value?.requested_action ? ` (they asked for: ${f.value.requested_action.action.replace(/_/g, " ")}${f.value.requested_action.object ? ` of the ${String(f.value.requested_action.object).toLowerCase()}` : ""}${f.value.requested_action.recipient ? ` to ${f.value.requested_action.recipient}` : ""}; it has NOT happened)` : "";
      return (f.value?.kind === "handoff"
        ? "About the request: nothing changes hands just by talking; a handoff only happens as a proper in-person transfer, so do not hand anything over, accept or promise."
        : "About the request: this is not something you do or promise just by talking. Only acknowledge that you heard it, without agreeing, accepting, promising or refusing.") + wanted;
    }
    if (f.key === "item_holder") {
      const item = `the ${String(f.value?.label ?? "item").toLowerCase()}`;
      if (f.value?.holder_known === false) return `item_holder: you do NOT know who has ${item}; say you don't know`;
      if (f.value?.holder_is_self) return `item_holder: you are holding ${item}; say so`;
      if (f.value?.holder_name === "you") return `item_holder: ${item} is with the person you are talking to; say "you've got it" (address them as "you")`;
      if (f.value?.holder_name) return `item_holder: ${item} is with ${f.value.holder_name}; say so`;
    }
    return `${f.key}: ${j(f.value)}`;
  };
  const REPAIR_KEYS = new Set(["antecedent_player_text", "antecedent_responses"]);
  const stance = (c.required_facts ?? []).find((f) => f.key === "self_state_answer")?.value;
  const stanceCovers = stance && ["not_especially", "yes", "fine"].includes(stance.answer);
  const uncertainty = (c.required_facts ?? []).find((f) => f.key === "uncertainty")?.value?.kind ?? null;
  const req = isReport ? [] : (c.required_facts ?? []).filter((f) => !(capsule && REPAIR_KEYS.has(f.key)) && !(stanceCovers && f.key === "self_state") && f.key !== "uncertainty").map(showFact);
  if (isReport) {
    const obs = c.required_facts?.find((f) => f.key === "observation")?.value;
    const subject = obs?.subject;
    const phrase = obs?.subject_phrase ?? (subject ? `the ${subject}` : null);
    if (obs?.entity_class === "fixed_transition") allowed.push(`You are looking at ${phrase}. It is a fixed gate, not an object: never say you found, picked up, carried or used it. Say where you are or what you see, in your own words. Use its name exactly: ${phrase}.`);
    else allowed.push(subject ? `You noticed: ${phrase}. Say so the way a person would, in your own words. Use plain everyday words only; never mention purposes, states, recognition, findings or assignments as terms.` : "You noticed something worth mentioning but there is nothing more specific you may say. Say so in a few plain words.");
  }
  const opt = (c.optional_facts ?? []).map((f) => `${f.key}: ${j(f.value)}`);
  const repairing = capsule && ["clarify_previous", "request_repetition"].includes(c.discourse_function) && c.antecedent?.resolved;
  if (!isReport && !repairing) allowed.push(req.length ? `Facts you must state (and may not go beyond):\n- ${req.join("\n- ")}` : "You have no facts to state. Do not invent any.");
  else if (repairing && req.length) allowed.push(`Facts you must state (and may not go beyond):\n- ${req.join("\n- ")}`);
  if (opt.length) allowed.push(`Facts you may add if natural:\n- ${opt.join("\n- ")}`);
  if (c.antecedent?.resolved && c.antecedent.responses?.length) allowed.push(`The line being repaired/referred to (say it again or clarify it, in your words):\n- ${c.antecedent.responses.map((r) => `${r.speaker_name ?? "someone"}: ${j(r.text)}`).join("\n- ")}`);
  if (c.may_ask_clarifying_question) {
    const noun = (c.referents ?? []).find((r) => r.type === "spatial" && !r.resolved && r.noun && !["thing", "one"].includes(r.noun))?.noun;
    const when = c.temporal_reference && !c.temporal_reference.resolved;
    if (c.discourse_function !== "ask_next_step") how.push(noun ? `You cannot tell which ${noun} they mean. Ask ONE short question about which ${noun}.` : when ? `You cannot tell which time "${c.temporal_reference.expression}" means. Ask ONE short question about when they mean.` : "If the reference is unclear, ask ONE short question about which thing they mean.");
  }
  if (capsule && repairing) how.push("Say your own earlier line again in your own words. Do not answer a new question and do not say you did not understand.");
  if (capsule && c.resumed_question) how.push(`They are answering your question about what they meant. Answer their earlier question now: ${j(c.resumed_question)}`);
  if (c.discourse_function === "ask_next_step" && c.may_ask_clarifying_question) how.push(`Nothing tells you what "next" means here. Ask ONE short question about what they mean.`);
  if (capsule && !isReport && !req.length && ["ask_factual", "ask_personal_experience", "challenge", "ask_opinion"].includes(c.discourse_function) && !c.may_ask_clarifying_question) how.push(c.addressee_state ? "They are asking whether you are ready; a brief yes or no about yourself is fine." : (UNCERTAINTY_GUIDE[uncertainty] ?? (c.past_perception ? UNCERTAINTY_GUIDE.did_not_perceive : UNCERTAINTY_GUIDE.no_established_fact)));
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
  if (!capsule && (c.forbidden_claims ?? []).length) how.push(`Never: ${c.forbidden_claims.map((x) => String(x).replace(/_/g, " ")).join(", ")}.`);
  const specific = capsule ? (c.forbidden_claims ?? []).map((x) => FORBIDDEN_WORDING[x]).filter(Boolean) : [];
  if (specific.length) how.push(`Do not ${[...new Set(specific)].join(", or ")}.`);
  // Plan-carrying packets: the model returns wording only; code owns every identifier and claim.
  const output = capsule
    ? `Reply as ${name ?? "the coworker"} in ${isReport ? "one short spoken sentence" : "one or two short spoken sentences"}. Return JSON: {"speech":"<what you say>"}`
    : `Reply as ${name ?? "the coworker"} in ${isReport ? "one short spoken sentence" : "one or two short spoken sentences"}. Return JSON: {"version":"yellow-beast-local-dialogue-candidate@v1","observer_id":${j(packet.speaker?.observer_id ?? "")},"speech":"<what you say>","semantic_claims":[]}`;

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

module.exports = { renderContributionTask, renderContextSections, renderVoice, renderHumanContext, approximateTokens, LOCAL_DIALOGUE_WORDING_LINES, LOCAL_DIALOGUE_WORDING_TEXT: LOCAL_DIALOGUE_WORDING_LINES.join(" "), LOCAL_DIALOGUE_SYSTEM_LINES, LOCAL_DIALOGUE_SYSTEM_TEXT };
