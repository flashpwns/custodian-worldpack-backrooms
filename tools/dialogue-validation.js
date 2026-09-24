"use strict";

// Deterministic semantic validation of a model candidate against the ALREADY
// authorized contribution. No model, no second semantic authority: item
// identity comes from resolveEquipmentReferent, facts and shape come from the
// contribution. Only checks that can be decided reliably are implemented; this
// is not unrestricted natural-language inference.

const { resolveEquipmentReferent } = require("./dialogue-discourse");
const canonLexicon = require("./canon-lexicon");

const CODES = Object.freeze({
  UNMET: "LOCAL_PRESENTATION_CONTRIBUTION_UNMET",
  FORBIDDEN: "LOCAL_PRESENTATION_FORBIDDEN_CLAIM",
  SHAPE: "LOCAL_PRESENTATION_SHAPE_VIOLATION",
  CONTRADICTION: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION"
});
const reject = (code, reason) => ({ ok: false, code, reason });

// ─── bounded lexical comparison ─────────────────────────────────────────────
const STOP = new Set("the and for that this with have has had was were are you your our from they them then than into about just also very what when where which while will would could should there their here been being not but its it's i'm i've i'll can did does one all any out get got let's".split(/\s+/));
// Typographic apostrophes are part of a word, not a separator ("That\u2019s" is one word).
const words = (text) => String(text ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").match(/[a-z0-9']+/g) ?? [];
const contentWords = (text) => [...new Set(words(text).map((w) => w.replace(/'s$/, "")).filter((w) => w.length >= 3 && !STOP.has(w)))];
const sameStem = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
/** Share of the fact's content words the speech expresses (paraphrase-tolerant). */
function coverage(speech, factText) {
  const fact = contentWords(factText);
  if (!fact.length) return 1;
  const spoken = contentWords(speech);
  return fact.filter((w) => spoken.some((x) => sameStem(w, x))).length / fact.length;
}
const sentences = (speech) => String(speech).split(/(?<=[.!?])\s+/).filter((s) => s.trim());

const LACK = /\b(?:don'?t (?:know|have)|do not (?:know|have)|no idea|not sure|can'?t say|couldn'?t say|nothing (?:established|to (?:tell|share|say|add))|nothing (?:on|about) that|haven'?t|never|no (?:record|information|experience)|not certain|unsure|not aware|have no)\b/i;
const INVENTED_EXPERIENCE = /\b(?:first (?:time|day|week|expedition|trip)|i(?:'ve| have) (?:been|done|worked|served|gone)|been (?:in|down|there|here) (?:before|already)|years? (?:of|in|on)|done this before|second time|again this time)\b/i;
const BIOGRAPHY = /\b(?:grew up|hometown|born (?:in|and)|my (?:family|wife|husband|kids?|children|parents?|mother|father|brother|sister|dog|cat)|graduated|degree|college|university|high school|used to (?:work|live)|back home|i(?:'m| am) from|where i'?m from|years of experience|i(?:'ve| have) been (?:doing|working) (?:this|here))\b/gi;
const FUTURE_KNOWLEDGE = /\b(?:you(?:'ll| will) (?:find|regret|die)|(?:it|this|that) (?:will|is going to) (?:go wrong|fail|end badly|happen)|something (?:bad )?(?:is going to|will) happen|i know how this ends)\b/i;
const STATE_MUTATION = /\b(?:here you go|here(?:'s| is) (?:the|your)|i(?:'ve| have) (?:just )?(?:handed|given|passed|moved|opened|closed|taken|dropped)|i (?:just )?(?:handed|gave|passed|opened|closed|took|moved)\b)/i;
const SPEAKING_FOR_OTHERS = /\b(?:we(?:'re| are) all|all of us|we all|everyone(?:'s| is| feels| here)|the others (?:are|feel|think))\b/i;
const TASK_OFFER = /\b(?:let'?s (?:get|stay|keep|move|focus)|ready when you are|what do you need|anything you need|need me to|do you want me to|want me to|shall we|awaiting (?:orders|instructions)|which part do you need)\b/i;
const MISSION_TERMS = /\b(?:outpost|cutoff|duffle|manifest|route|guidance tape|briefing|objective|deadline|startup materials)\b/gi;
// Generic service-assistant framing is never a coworker's voice.
const ASSISTANT_PERSONA = /\b(?:how (?:can|may|could|might) i (?:help|assist|be of (?:service|assistance|help))|what can i do for you|(?:is|was) there (?:anything|something) (?:i|else i) (?:can|could) (?:help|do|assist)|anything (?:else )?(?:i|that i) (?:can|could) (?:help|assist)(?: you)? with|(?:can|may|could) i (?:help|assist) you|(?:i(?:'m| am) )?(?:here|happy|glad|ready) to (?:help|assist)(?: you)?|let me know if you need (?:anything|any help|something)|at your service|how may i serve)\b/i;
// An honest, non-absolute statement that nothing is known ("not that I know of").
const LACK_SAFE = /\b(?:don'?t know|do not know|no idea|no clue|not sure|can'?t say|couldn'?t say|can'?t tell you|couldn'?t tell you|not that i (?:know|recall|remember)|don'?t (?:recall|remember)|nothing (?:on|about) that|nothing to (?:add|say|tell)|haven'?t (?:heard|been told)|i wouldn'?t know|unsure|not certain|i'?d rather not)\b/i;
const ABSOLUTE_EXPERIENCE_CLAIM = /\b(?:never|no experience|first time|haven'?t been|have not been|been (?:here|there|in|down)|seen (?:this|the|it) before|done this)\b/i;
// Functions whose reply is a plain answer/reaction, not a question back.
const NO_COUNTER_QUESTION = new Set(["report_observation", "greet", "introduce_self", "acknowledge", "close_topic", "joke_or_sarcasm", "social_observation", "warn", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience", "ask_factual", "request_repetition", "clarify_previous", "ask_heard_confirmation"]);
const CLARIFY_CUE = /\b(?:(?:what|which)\b[^?]*\b(?:referring|referencing|talking about)|mean|which|what (?:do|are|exactly|thing|part|item)|sorry|pardon|huh|not sure what|didn'?t (?:catch|follow|get)|come again|say again)\b/i;
const MAX_WORDS = Object.freeze({ report_observation: 22, greet: 6, introduce_self: 10, acknowledge: 9, close_topic: 9, joke_or_sarcasm: 10, social_observation: 10, check_in: 14, warn: 14, express_uncertainty: 16, ask_heard_confirmation: 16 });
const META_PLAYER = /\b(?:the|this) player\b|\bplayer'?s (?:words|line|message|text)\b/i;
// The capsule labels the person spoken to "PLAYER"; that label is orientation, never speech.
const PLAYER_LABEL = /\bPLAYER\b/;
// A purpose/motive clause the plan never supplied ("...to make sure everything was accounted for").
const INVENTED_RATIONALE = /\b(?:to make sure|to ensure|in order to|so (?:that )?(?:we|i|they|it)\b|because\b|to see (?:if|whether)|to (?:verify|confirm|double-check)\b)/i;
// A yes/no question about the addressee's own momentary state ("Are you ready?",
// "You okay?") may be answered briefly; questions about knowledge/experience may not.
const isSelfStateAnswer = (question, speech) => Boolean(question)
  && /\byou(?:'re| are)?\b/i.test(question)
  && !/\b(?:know|seen|been|heard|remember|think|tell|any|carry|carrying|have|got|route|outpost)\b/i.test(question)
  && words(speech).length <= 6
  && /^\s*(?:yes|yeah|yep|yup|no|nope|sure|ready|okay|ok|fine|all set|i am|i'm|not really|kind of|sort of)\b/i.test(speech);
const SENSORY_INVENTION = /\b(?:smell\w*|hear|heard|hearing|sound\w*|glow\w*|hum|humming|hums|moving|moves|breath\w*|whisper\w*|voices?|bleed\w*|scream\w*|shadows?|vibrat\w*|pulsing|pulses|cold|warm|hot|dying|dead|blood|flicker\w*|buzz\w*|watching|following)\b/i;
// Agreeing that a sarcastic remark is true takes it literally.
const SARCASM_AGREES = /\b(?:you'?re (?:not wrong|right|correct)|not wrong about|that'?s (?:true|right|correct|a relief)|(?:i )?agree(?:d)?|absolutely|indeed|good point|fair point)\b/i;
// A reaction that supplies no fact must not narrate events, history or experience of its own.
// A reaction that supplies no fact must not invent what the speaker is currently doing or waiting for.
const INVENTED_ACTIVITY = /\b(?:just|still|currently|busy)\s+(?:waiting|trying|working|checking|charging|getting|making|keeping|looking|going|doing)\b|\bwaiting (?:for|on)\b|\btrying to\b/i;
const INVENTED_HISTORY = /\bi(?:'ve| have) (?:seen|been|done|worked|had)\b|\bi was\b|\bagain\b|\b(?:last|that) (?:time|week|year|day)\b|\bused to\b|\bi remember\b|\bever\b/i;
// A wry aside must not itself assert a safety/danger state ("most dangerous thing...", "we'd all die").
const DANGER_EVALUATION = /\b(?:danger\w*|unsafe|deadly|risk\w*|hazard\w*|threat\w*|trap|die|dying|death|hurt|injur\w*|kill\w*|emergency|disaster|catastroph\w*)\b/i;
const SARCASM_LITERAL_AGREEMENT = /\b(?:looks?|seems?|is|are|feels?|sounds?)\s+(?:pretty |really |quite |very |perfectly |totally )?(?:safe|fine|secure|okay|harmless)\b|\bsafety protocols?\b|\bnothing to worry\b/i;
const SARCASM_REDIRECT = /\b(?:let'?s|we should|we need to|stay focused|stay sharp|focus on|keep (?:an eye|calm|focused)|be careful|remember (?:the|our))\b/i;
const ANOMALY_PROPERTY = /\b(?:wrong|dangerous|unsafe|deadly|broken|damaged|leaking|unstable|haunted|cursed|evil|impossible|strange|weird|odd|off|definitely)\b/i;
const ALLOWED_PROPERTY = Object.freeze({ hazard_warning: /^(?:dangerous|unsafe|wrong|off)$/, equipment_problem: /^(?:wrong|broken|damaged|off)$/, anomaly_notice: /^(?:strange|weird|odd|off)$/ });
const INTERNAL_VOCAB = /\b(?:recogni[sz]ed|purpose|disposition|assignment (?:finding|blocker)|observation|feature|landmark|authorized|state)\b/i;
// "Did anyone hear what I just said?": a plain confirmation that the line was heard.
const HEARD_AFFIRM = /\b(?:heard|hear|caught|got (?:it|that)|loud and clear|yes|yeah|yep|yup|i did|sure did)\b/i;
const HEARD_DOUBT = /\b(?:didn'?t|did not|couldn'?t|could not|can'?t|cannot|wasn'?t|no one|nobody|missed|unsure|not sure|if anyone|whether anyone)\b/i;
const INVENTED_URGENCY = /\b(?:urgent\w*|emergency|alarm\w*|panic\w*|hurry|immediately|right away|serious\w*|worried|concerned|important|critical)\b|\b(?:sounded|sounds|seemed|seems)\s+(?:like\s+|a bit\s+|kind of\s+|pretty\s+|really\s+|very\s+)?\w+/i;
const HEARD_COMMITMENT = /\bi(?:'ll| will| can| could| should)\b(?!\s+hear)|\blet me\b|\bon it\b|consider it done|\bwill do\b/i;
// LOCAL wording cannot create an instruction/commitment: orders and promises with consequences go through
// the structured order path (q4-local-intent), never through the wording of a reply.
const COMMITMENT_CLAIM = /\b(?:i'?ll|i will|i(?:'m| am) going to|i can do that|let me (?:go|get|check|handle|take|grab|do)|on it\b|will do\b|you got it|sure thing|consider it done|i promise|count on me)\b/i;
const opener = (text) => words(text).slice(0, 2).join(" ");
const OPENER_FUNCTIONS = new Set(["greet", "introduce_self", "acknowledge", "check_in", "joke_or_sarcasm", "social_observation"]);
const REPAIR_FUNCTIONS = new Set(["clarify_previous", "request_repetition"]);
const SOCIAL_NO_TASK = new Set(["report_observation", "greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "check_in", "close_topic", "clarify_previous", "request_repetition", "ambiguous_reference", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience"]);
const OTHERS_APPLY = new Set(["report_observation", "check_in", "invite_self_description", "ask_role_or_assignment", "ask_personal_experience", "greet", "introduce_self"]);

const RESTATEMENT_FRAME = /\b(?:just (?:saying|said|meant|asking|greeting)|i (?:was|just|said|meant|asked|told|mentioned)|i(?:\u2019|')m (?:saying|just)|what i (?:said|meant)|as i said|like i said|sorry|pardon|introduc\w+|repeat\w*|again)\b/i;
const factValue = (contribution, key) => [...(contribution.required_facts ?? []), ...(contribution.optional_facts ?? [])].filter((f) => f.key === key).map((f) => f.value);
const requiredValue = (contribution, key) => (contribution.required_facts ?? []).filter((f) => f.key === key).map((f) => f.value);

function knownAnswerText(value) {
  if (!value) return "";
  if (value.text) return value.text;
  return [value.checked_location, value.inspected_target, value.condition_reason, value.condition].filter(Boolean).join(" ");
}

// ─── canonical ontology (what a named world entity IS) ──────────────────────
// A non-portable canonical entity (the Threshold: a fixed gate) is never an object: it is not
// found, taken, carried, held, handed over or used like a tool, and no generic substitute noun
// ("apparatus", "device", "machine", "portal") may replace its name.
const OBJECT_VERBS = "(?:pick(?:ed|s|ing)?|grab(?:bed|s|bing)?|took|take|taking|carry|carried|carrying|carries|hold|held|holding|holds|hand(?:ed|ing)?|gave|give|giving|pocket(?:ed)?|brought|bring|found|find|finding|got|has|have|had|using|used|use|uses|lost|dropped|drop)";
function validateOntology(rawSpeech) {
  const speech = String(rawSpeech ?? "");
  for (const entity of Object.values(canonLexicon.CANONICAL_ENTITIES)) {
    if (entity.portable) continue;
    const name = entity.bare_name;
    if (new RegExp(`\\b${name}\\s+(?:apparatus|device|machine|portal|object|item|unit|gadget|equipment)\\b`, "i").test(speech)) return reject(CODES.FORBIDDEN, `${entity.display_name} renamed as a generic object (it is a ${entity.entity_class.replace(/_/g, " ")})`);
    if (new RegExp(`\\b${OBJECT_VERBS}(?:\\s+(?:up|over|out|back))?\\s+(?:the\\s+)?${name}\\b`, "i").test(speech) && !new RegExp(`\\b${OBJECT_VERBS}\\s+(?:the\\s+)?${name}\\s+(?:room|side|approach|entry)\\b`, "i").test(speech)) return reject(CODES.FORBIDDEN, `treats ${entity.display_name} as a portable object or inventory item (${entity.entity_class.replace(/_/g, " ")})`);
  }
  return { ok: true };
}

/**
 * @returns {{ok:true}|{ok:false, code:string, reason:string}}
 */
function validateContribution(contribution, rawSpeech, { player_text = null } = {}) {
  if (!contribution) return { ok: true };
  const speech = String(rawSpeech ?? "").trim();
  const ontology = validateOntology(speech);
  if (!ontology.ok) return ontology;
  const fn = contribution.discourse_function;
  const forbidden = new Set(contribution.forbidden_claims ?? []);
  const sents = sentences(speech);
  const allowedBlob = JSON.stringify([contribution.required_facts, contribution.optional_facts, contribution.antecedent, contribution.referents, contribution.same_turn_prior_responses]).toLowerCase();

  // Assistant persona: a coworker never offers generic service.
  if (fn !== "make_request" && ASSISTANT_PERSONA.test(speech)) return reject(CODES.FORBIDDEN, "assistant-style service offer");
  if (META_PLAYER.test(speech) || PLAYER_LABEL.test(speech)) return reject(CODES.FORBIDDEN, "refers to the player as a game construct");
  if (["joke_or_sarcasm", "social_observation", "greet", "introduce_self", "acknowledge", "close_topic", "check_in"].includes(fn) && INVENTED_HISTORY.test(speech)) return reject(CODES.FORBIDDEN, "narrates history or experience the plan does not supply");
  if (["joke_or_sarcasm", "social_observation", "greet", "introduce_self", "acknowledge", "close_topic", "check_in"].includes(fn) && INVENTED_ACTIVITY.test(speech)) return reject(CODES.FORBIDDEN, "invents what the speaker is doing or waiting for");
  if (fn !== "report_observation" && fn !== "warn" && COMMITMENT_CLAIM.test(speech)) return reject(CODES.FORBIDDEN, "creates a commitment or instruction the simulation does not hold");
  // A rationale the authorized facts do not contain is an invented motive.
  if (fn !== "report_observation" && fn !== "make_request") {
    const why = speech.match(INVENTED_RATIONALE);
    if (why && !allowedBlob.includes(why[0].toLowerCase()) && !(player_text && new RegExp(`\\b${why[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(player_text))) return reject(CODES.FORBIDDEN, `invented rationale: "${why[0]}"`);
  }
  if (MAX_WORDS[fn] && words(speech).length > MAX_WORDS[fn]) return reject(CODES.SHAPE, "a brief social line is expected");
  // Echoing the player's own words back is not an answer or a clarification.
  if (player_text && !REPAIR_FUNCTIONS.has(fn) && contentWords(player_text).length >= 2 && coverage(speech, player_text) >= 0.8 && coverage(player_text, speech) >= 0.6) return reject(CODES.SHAPE, "echoes the player instead of responding");
  const norm = (t) => words(t).join(" ");
  if (player_text && !REPAIR_FUNCTIONS.has(fn) && norm(speech) && norm(speech) === norm(player_text)) return reject(CODES.SHAPE, "repeats the player verbatim");
  // Same-turn coordination: a later responder does not repeat an accepted line.
  for (const prior of contribution.same_turn_prior_responses ?? []) {
    if (!prior?.text) continue;
    if (norm(prior.text) === norm(speech)) return reject(CODES.SHAPE, "repeats an earlier speaker's line this turn");
    if (OPENER_FUNCTIONS.has(fn) && opener(prior.text) && opener(prior.text) === opener(speech)) return reject(CODES.SHAPE, "opens exactly like an earlier speaker this turn");
    if (contentWords(speech).length >= 2 && coverage(speech, prior.text) >= 0.85 && coverage(prior.text, speech) >= 0.85 && !["report_observation", "ask_item_ownership", "ask_role_or_assignment", "invite_self_description"].includes(fn)) return reject(CODES.SHAPE, "near-identical to an earlier speaker's line this turn");
  }
  if (NO_COUNTER_QUESTION.has(fn) && !contribution.may_ask_clarifying_question && speech.includes("?")) return reject(CODES.SHAPE, "answers with a question");

  if (fn === "joke_or_sarcasm") {
    if (SARCASM_LITERAL_AGREEMENT.test(speech) || SARCASM_AGREES.test(speech)) return reject(CODES.SHAPE, "takes a sarcastic remark literally");
    if (DANGER_EVALUATION.test(speech)) return reject(CODES.FORBIDDEN, "asserts a safety or danger state the plan does not supply");
    if (LACK_SAFE.test(speech)) return reject(CODES.SHAPE, "answers a remark as if it were a question");
    if (SARCASM_REDIRECT.test(speech)) return reject(CODES.SHAPE, "turns a social remark into advice");
  }

  // C. Unresolved references: the only acceptable realization is a question.
  if (fn === "ambiguous_reference" || contribution.may_ask_clarifying_question) {
    if (!speech.includes("?")) return reject(CODES.UNMET, "unresolved reference must be answered with a clarification question");
    if (!CLARIFY_CUE.test(speech)) return reject(CODES.UNMET, "clarification must ask what is meant");
    if (sents.length > 2) return reject(CODES.SHAPE, "clarification request must be brief");
  }

  // A. First-person custody claim (negation-aware, per-claim spans) for an item
  // the plan assigns elsewhere. Needs no run: the plan carries the holder.
  const holderFact = requiredValue(contribution, "item_holder")[0];
  if (holderFact && !holderFact.holder_is_self && holderFact.label) {
    const markers = claimMarkers(speech);
    const headNoun = contentWords(holderFact.label).slice(-1)[0] ?? null;
    for (let i = 0; i < markers.length; i += 1) {
      if (markers[i].subject !== "first" || markers[i].kind !== "possession") continue;
      const parts = regionParts(speech, markers, i);
      if (parts && parts.some((part) => coverage(part, holderFact.label) >= 0.5 || (headNoun && contentWords(part).some((w) => sameStem(w, headNoun))))) return reject(CODES.CONTRADICTION, "first-person custody claim for an item the plan assigns elsewhere");
    }
  }

  // B. Forbidden claims that can be decided reliably.
  if (forbidden.has("invented_biography")) {
    for (const match of speech.matchAll(BIOGRAPHY)) {
      if (!words(match[0]).some((w) => w.length >= 4 && allowedBlob.includes(w))) return reject(CODES.FORBIDDEN, `unsupplied biography: "${match[0]}"`);
    }
  }
  if (forbidden.has("future_knowledge") && FUTURE_KNOWLEDGE.test(speech)) return reject(CODES.FORBIDDEN, "future knowledge");
  if (forbidden.has("state_mutation") && STATE_MUTATION.test(speech)) return reject(CODES.FORBIDDEN, "claims a state change");
  if (forbidden.has("speaking_for_other_coworkers") && OTHERS_APPLY.has(fn) && SPEAKING_FOR_OTHERS.test(speech)) return reject(CODES.FORBIDDEN, "speaks for other coworkers");
  if (SOCIAL_NO_TASK.has(fn)) {
    if (forbidden.has("unrelated_task_offer") && TASK_OFFER.test(speech)) return reject(CODES.FORBIDDEN, "unrelated task offer");
    if (forbidden.has("unrequested_mission_briefing")) {
      for (const match of speech.matchAll(MISSION_TERMS)) {
        if (!allowedBlob.includes(match[0].toLowerCase())) return reject(CODES.FORBIDDEN, `unrequested mission content: "${match[0]}"`);
      }
    }
  }

  // D/E. Requested content and response shape.
  switch (fn) {
    case "report_observation": {
      const obs = requiredValue(contribution, "observation")[0] ?? {};
      if (SENSORY_INVENTION.test(speech) && !words(String(obs.subject ?? "")).some((w) => words(speech).includes(w) && SENSORY_INVENTION.test(w))) return reject(CODES.FORBIDDEN, "unsupported sensory or anomaly claim");
      if (INTERNAL_VOCAB.test(speech)) return reject(CODES.FORBIDDEN, "internal bookkeeping vocabulary");
      const allowed = ALLOWED_PROPERTY[contribution.report_purpose];
      for (const w of words(speech)) if (ANOMALY_PROPERTY.test(w) && !(allowed && allowed.test(w))) return reject(CODES.FORBIDDEN, `invented anomaly property: "${w}"`);
      if (obs.subject && coverage(speech, obs.subject) < 0.5 && !/\b(?:something|this|that|it)\b/i.test(speech)) return reject(CODES.UNMET, "does not refer to the authorized observation");
      if (FUTURE_KNOWLEDGE.test(speech) || /\b(?:behind (?:the|that) wall|inside the wall|below us|above us)\b/i.test(speech)) return reject(CODES.FORBIDDEN, "hidden-state claim");
      break;
    }
    case "invite_self_description":
    case "ask_role_or_assignment": {
      if (/\bhere to\b/i.test(speech)) return reject(CODES.FORBIDDEN, "invented purpose for being here");
      const facts = ["name", "role", "current_assignment"].flatMap((key) => requiredValue(contribution, key).map((v) => [key, v]));
      // "Name's Diego, field technician." is self-focused without I / my.
      if (!/\b(?:i|i'm|i am|my|me|myself|name'?s|name is|this is|call me)\b/i.test(speech) && !facts.length) return reject(CODES.UNMET, "self-focused contribution required");
      const nameFact = requiredValue(contribution, "name")[0];
      if (fn === "invite_self_description" && nameFact && coverage(speech, nameFact) < 0.5) return reject(CODES.UNMET, "a self-introduction includes the speaker's name");
      if (facts.length && !facts.some(([, v]) => coverage(speech, v) >= 0.5)) return reject(CODES.UNMET, "does not express the supplied name/role/assignment");
      if (sents.length > 3 || speech.length > 400) return reject(CODES.SHAPE, "self-description must be brief");
      break;
    }
    case "ask_item_ownership": {
      const holder = requiredValue(contribution, "item_holder")[0];
      if (holder) {
        const label = String(holder.label ?? "");
        const namesIt = /\b(?:it|that|this|the)\b/i.test(speech) || coverage(speech, label) >= 0.5;
        let expresses = false;
        if (holder.holder_is_self) expresses = /\b(?:i(?:'ve| have| am| do)|mine|with me|my|me)\b/i.test(speech);
        else if (holder.holder_name === "you") expresses = /\b(?:you(?:'ve| have| are)|yours|with you|(?:the )?expedition lead)\b/i.test(speech);
        else if (holder.holder_name) {
          // Bounded short forms ("Nora.", "Nora does.") need no item label: the
          // requested content and holder are already unambiguous.
          const escaped = String(holder.holder_name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          expresses = new RegExp(`\\b${escaped}\\b`, "i").test(speech) && !new RegExp(`\\b(?:not|isn'?t|doesn'?t|no|never)\\s+(?:with\\s+)?${escaped}\\b`, "i").test(speech);
        } else expresses = LACK.test(speech);
        if (!expresses || (!namesIt && !holder.holder_name)) return reject(CODES.UNMET, "does not state the canonical holder");
      }
      break;
    }
    case "request_repetition":
    case "clarify_previous": {
      const ante = contribution.antecedent;
      if (ante?.resolved) {
        const responses = ante.responses ?? [];
        const last = responses[responses.length - 1]?.text ?? ante.player_text ?? "";
        const best = Math.max(0, ...responses.map((r) => coverage(speech, r.text)), ante.player_text ? coverage(speech, ante.player_text) * 0.8 : 0);
        // Faithful paraphrase: a restatement frame plus few words not already
        // present in the antecedent is grounded even with little lexical overlap.
        const known = new Set(contentWords(`${ante.player_text ?? ""} ${responses.map((r) => r.text).join(" ")}`));
        const frameWords = new Set(["said", "say", "repeat", "sorry", "just", "again", "meant", "mean", "asked", "saying", "was", "pardon", "yes", "sure", "like", "told", "mentioned", "introducing", "introduce", "myself", "wondering", "asking"]);
        const novel = contentWords(speech).filter((w) => !frameWords.has(w) && ![...known].some((k) => sameStem(k, w)));
        const framed = RESTATEMENT_FRAME.test(speech);
        // The speaker's OWN preceding line is the repair target: the reply must
        // restate it (or be a short framed restatement), never a fresh topic answer.
        const antecedentReplies = requiredValue(contribution, "antecedent_responses")[0] ?? [];
        const ownLine = [...antecedentReplies].reverse().find((r) => r.is_self);
        if (ownLine && coverage(speech, ownLine.text) < 0.5 && !(framed && novel.length <= 1)) return reject(CODES.UNMET, "repair must restate the speaker's own preceding line");
        const limit = fn === "request_repetition" ? 3 : 6;
        const grounded = best >= (fn === "request_repetition" ? 0.6 : 0.4) || (framed && novel.length <= Math.min(limit, 2));
        if (!grounded) return reject(CODES.UNMET, fn === "request_repetition" ? "repetition must restate the preceding utterance" : "clarification must address the preceding exchange");
        if (forbidden.has("new_factual_claims") && novel.length > limit) return reject(CODES.FORBIDDEN, "adds new content beyond the antecedent");
      }
      break;
    }
    case "introduce_self": {
      // Meeting someone is acknowledged as such; a bare "Yeah." is not an acknowledgment of an introduction.
      if (/^\s*(?:yeah|yes|yep|yup|sure|okay|ok|mm+|uh-?huh)[.!\s]*$/i.test(speech)) return reject(CODES.UNMET, "an introduction is acknowledged, not answered with a bare affirmation");
      if (!/\b(?:meet|nice|good|glad|pleasure|hey|hi|hello|welcome|morning|afternoon|evening|howdy)\b/i.test(speech)) return reject(CODES.UNMET, "an introduction is met with a greeting or a note that you have met");
      break;
    }
    case "ask_heard_confirmation": {
      if (contribution.may_ask_clarifying_question) break;
      const heard = requiredValue(contribution, "heard_confirmation")[0];
      if (!heard) break;
      if (heard.heard === false) {
        if (!/\b(?:didn'?t|did not|missed|couldn'?t|could not)\b/i.test(speech)) return reject(CODES.UNMET, "the speaker did not hear the line and must say so");
        break;
      }
      if (/\bheard\s+(?:them|him|her)\b/i.test(speech)) return reject(CODES.SHAPE, "talks about the person spoken to in the third person");
      if (HEARD_DOUBT.test(speech)) return reject(CODES.CONTRADICTION, "doubts or denies hearing a line the speaker heard");
      if (!HEARD_AFFIRM.test(speech)) return reject(CODES.UNMET, "does not confirm that the line was heard");
      if (INVENTED_URGENCY.test(speech)) return reject(CODES.FORBIDDEN, "invented urgency or interpretation of what was said");
      if (HEARD_COMMITMENT.test(speech)) return reject(CODES.FORBIDDEN, "commits to an action the plan did not authorize");
      if (sents.length > 2) return reject(CODES.SHAPE, "a brief confirmation is expected");
      break;
    }
    case "ask_personal_experience": {
      const experience = requiredValue(contribution, "prior_expedition_experience")[0];
      const known = requiredValue(contribution, "known_answer")[0];
      const background = requiredValue(contribution, "identity_fact")[0]?.education_or_trade;
      const supplied = experience || knownAnswerText(known) || background || null;
      if (supplied) {
        if (coverage(speech, supplied) < 0.5) return reject(CODES.UNMET, "does not express the supplied fact");
      } else {
        if (!LACK_SAFE.test(speech)) return reject(CODES.UNMET, "no experience fact is authorized; an honest lack of established information is required");
        if (INVENTED_EXPERIENCE.test(speech) || ABSOLUTE_EXPERIENCE_CLAIM.test(speech)) return reject(CODES.FORBIDDEN, "invented or absolute experience claim");
      }
      break;
    }
    case "ask_factual":
    case "challenge": {
      const supplied = [
        ...requiredValue(contribution, "known_fact").map((v) => v.text),
        ...requiredValue(contribution, "known_answer").map(knownAnswerText),
        ...requiredValue(contribution, "held_equipment").map((v) => v.join(" ")),
        ...requiredValue(contribution, "item_holder").map((v) => `${v.label} ${v.holder_name ?? ""}`)
      ].filter(Boolean);
      if (supplied.length) {
        if (!supplied.some((text) => coverage(speech, text) >= 0.5)) return reject(CODES.UNMET, "does not express an authorized fact");
      } else if (fn === "ask_factual" && contribution.question_form === "yes_no" && (contribution.addressee_state || isSelfStateAnswer(player_text, speech)) && words(speech).length <= 6 && /^\s*(?:yes|yeah|yep|yup|no|nope|sure|ready|okay|ok|fine|all set|i am|i'm|i think so|not really|kind of|sort of)\b/i.test(speech)) {
        // "Are you ready?" -> "Ready." : the addressee's own momentary state, no world fact.
      } else if (fn === "ask_factual" && !LACK_SAFE.test(speech) && !contribution.may_ask_clarifying_question) {
        return reject(CODES.UNMET, "no fact is authorized; the speaker must say they do not know");
      }
      break;
    }
    default:
      break;
  }
  if (contribution.expected_response_shape === "short_social_acknowledgment" && (sents.length > 2 || speech.length > 220)) return reject(CODES.SHAPE, "short social acknowledgment expected");
  return { ok: true };
}

// ─── possession / custody claims ────────────────────────────────────────────
const normalizeId = (id) => String(id ?? "");
function samePersonnel(a, b) {
  const x = normalizeId(a);
  const y = normalizeId(b);
  if (!x || !y) return false;
  return x === y || x === `personnel-${y}` || y === `personnel-${x}`;
}
const PRONOUN_LIKE = new Set(["it", "that", "there", "here", "what", "who", "he", "she", "this", "where", "how", "everyone", "someone"]);
const CUT_AT_PREPOSITION = /\b(?:about|regarding|concerning|on|for|to|from|with|in|at|where|who|but|while)\b/i;
const NEGATED_AFTER = /^\s*(?:no|never|not|none|nothing)\b/i;
const NEGATED_BEFORE = /\b(?:not|never|isn'?t|aren'?t|no)\s*$/i;

function claimMarkers(speech) {
  const markers = [];
  const push = (regex, build) => { for (const match of speech.matchAll(regex)) markers.push({ start: match.index, end: match.index + match[0].length, ...build(match) }); };
  push(/\bi(?:'ve| have)(?: got)?\b|\bi(?:'m| am) (?:holding|carrying)\b|\bi (?:hold|carry|took)\b/gi, () => ({ subject: "first", kind: "possession", side: "after" }));
  push(/\b([A-Z][a-z]+)(?:'s (?:holding|carrying|got)|(?: has| have| is holding| is carrying| holds| carries| took))\b/g, (m) => ({ subject: "named", name: m[1], kind: "possession", side: "after" }));
  push(/\b(?:she|he)(?:'s (?:holding|carrying|got)| has| holds| carries| is holding)\b/gi, () => ({ subject: "pronoun", kind: "possession", side: "after" }));
  push(/\byou(?:'ve| have| are holding| hold)\b/gi, () => ({ subject: "player", kind: "possession", side: "after" }));
  push(/\b(?:is |are )?(?:with me|in my (?:hands|custody|bag))\b/gi, () => ({ subject: "first", kind: "possession", side: "before" }));
  // "the camera's with Nora" / "the camera is with you": the item is the LAST noun phrase before the marker.
  push(/(?:'s|\bis|\bare)\s+with\s+(you|[A-Z][a-z]+)\b/g, (m) => ({ ...(m[1].toLowerCase() === "you" ? { subject: "player" } : { subject: "named", name: m[1] }), kind: "possession", side: "before", lastOnly: true }));
  push(/\bi (?:left|dropped|placed|set down)\b/gi, () => ({ subject: "first", kind: "disposal", side: "after" }));
  return markers.sort((a, b) => a.start - b.start);
}

function regionParts(speech, markers, i) {
  const marker = markers[i];
  const sentenceEndAfter = (from) => { const m = speech.slice(from).search(/[.!?;]/); return m === -1 ? speech.length : from + m; };
  const sentenceStartBefore = (from) => { const m = speech.slice(0, from).search(/[^.!?;]*$/); return m === -1 ? 0 : m; };
  let region;
  if (marker.side === "after") {
    const limit = Math.min(sentenceEndAfter(marker.end), markers[i + 1]?.start ?? speech.length);
    region = speech.slice(marker.end, limit);
  } else {
    const floor = Math.max(sentenceStartBefore(marker.start), markers[i - 1]?.end ?? 0);
    region = speech.slice(floor, marker.start);
  }
  // Deterministic negation guards: "I've no idea where…", "I've never touched…",
  // "not with me" are denials/ignorance, never custody claims.
  if (marker.side === "after" && NEGATED_AFTER.test(region)) return null;
  if (marker.side === "before" && NEGATED_BEFORE.test(region)) return null;
    const preposition = region.search(CUT_AT_PREPOSITION);
    const clipped = preposition > 0 ? region.slice(0, preposition) : region;
    let parts = clipped.split(/\band\b|,|&/i);
    // "…the radio and the camera's with Nora": a trailing "<item>'s"/"<item> is"
    // before a cut at "with" is the subject of the NEXT claim, not this one's object.
    if (preposition > 0 && /^\s*with\b/i.test(region.slice(preposition)) && parts.length && /(?:'s|\bis|\bare)\s*$/i.test(parts[parts.length - 1])) parts = parts.slice(0, -1);
    if (markers[i + 1]?.lastOnly && parts.length > 1) parts = parts.slice(0, -1);
    if (marker.lastOnly) parts = parts.slice(-1);
  return parts;
}

/**
 * Validates every custody claim independently. Subject parsing is
 * deterministic (first person / named coworker / you); pronoun subjects are
 * unresolved and skipped. Each item mention is resolved separately through the
 * canonical resolver, so "I've got the radio and Nora has the camera" is two
 * claims.
 */
function validateOwnershipClaims(speech, { run, speakerId }) {
  if (!speech || !run?.expedition) return { ok: true };
  const equipment = run.expedition.equipment ?? {};
  const members = run.expedition.team?.members ?? [];
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  const idForName = (name) => {
    const lower = String(name).toLowerCase();
    const member = members.find((m) => [m.first_name, m.display_name].filter(Boolean).some((n) => String(n).toLowerCase() === lower));
    return member ? (member.personnel_id ?? member.id) : null;
  };
  const markers = claimMarkers(speech);
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const parts = regionParts(speech, markers, i);
    if (!parts) continue;
    let expected = null;
    if (marker.subject === "first") expected = speakerId;
    else if (marker.subject === "player") expected = playerId;
    else if (marker.subject === "named") { if (PRONOUN_LIKE.has(marker.name.toLowerCase())) continue; expected = idForName(marker.name); }
    if (!expected) continue; // unresolved subject: no claim to validate
    for (const part of parts) {
      const resolved = resolveEquipmentReferent(part, equipment, { loose: true });
      if (resolved.status !== "unique") continue;
      const item = resolved.item;
      if (!item.holder) continue;
      if (marker.kind === "possession" && !samePersonnel(item.holder, expected)) {
        return reject(CODES.CONTRADICTION, `${marker.subject} custody claim for ${item.id} contradicts the canonical holder`);
      }
      if (marker.kind === "disposal" && !samePersonnel(item.holder, expected)) {
        return reject(CODES.CONTRADICTION, `${marker.subject} disposal claim for ${item.id} without custody`);
      }
    }
  }
  return { ok: true };
}

/** Wording rules that need no plan: they also guard plan-less (autonomous report) speech. */
function validateUniversalWording(rawSpeech) {
  const speech = String(rawSpeech ?? "");
  if (ASSISTANT_PERSONA.test(speech)) return reject(CODES.FORBIDDEN, "assistant-style service offer");
  if (META_PLAYER.test(speech) || PLAYER_LABEL.test(speech)) return reject(CODES.FORBIDDEN, "refers to the player as a game construct");
  return validateOntology(speech);
}

module.exports = { validateOntology, validateUniversalWording, CODES, coverage, contentWords, sameStem, validateContribution, validateOwnershipClaims, samePersonnel };
