"use strict";

// Deterministic fallback WORDING for LOCAL dialogue. Consumes only the semantic
// frame and the response plan (its authorized facts and style hints) and
// returns text. It runs strictly AFTER response owners are resolved and must
// never influence eligibility, owner count or recipient scope: nothing in
// discourse/owner code imports this module.
//
// Returns null when this module has no plan-aware wording for the function;
// the caller then keeps its pre-existing wording. Model failure changes style
// richness, never semantics. Wording is ordinary speech: short, plain and
// semantically exact ("I don't know", never "nothing is established").

const fact = (plan, key) => plan?.required_facts?.find((f) => f.key === key)?.value ?? null;
const optionalFact = (plan, key) => plan?.optional_facts?.find((f) => f.key === key)?.value ?? null;
const sentence = (value) => String(value ?? "").trim().replace(/[.!?\s]+$/, "");
const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");
const lowerFirst = (text) => text.replace(/^([A-Z])(?=[a-z])/, (m) => m.toLowerCase());
const upperFirst = (text) => text.replace(/^([a-z])/, (m) => m.toUpperCase());
const lowerList = (items) => items.map((item) => String(item).toLowerCase()).join(" and ");

const JOKE_BY_EXPRESSION = {
  "dryly observant": "Reassuring, isn't it.",
  "quietly friendly": "Ha. Fair enough.",
  "carefully polite": "I suppose that's one way to put it.",
  "plain-spoken": "Yeah.",
  "wry under pressure": "Sure. Very comforting."
};
const JOKE_BY_TEMPERAMENT = {
  "brief and direct": "Ha.",
  "measured and reflective": "Hm. Well.",
  "warm but guarded": "Ha. Maybe.",
  "talkative when uneasy": "Ha, right? Ha.",
  "deadpan": "Wonderful."
};
const CHECK_IN_BY_TEMPERAMENT = {
  "brief and direct": "I'm fine.",
  "measured and reflective": "Managing, thanks.",
  "warm but guarded": "I'm all right.",
  "talkative when uneasy": "Could be better, could be worse.",
  "deadpan": "Can't complain."
};

const GREET_BY_EXPRESSION = { "dryly observant": "Hey.", "quietly friendly": "Hi there.", "carefully polite": "Good morning.", "plain-spoken": "Hey.", "wry under pressure": "Well, hello." };
const GREET_ALTERNATES = ["Hello.", "Morning.", "Hi."];
const INTRODUCE_BY_EXPRESSION = { "dryly observant": "Good to meet you, I think.", "quietly friendly": "Good to meet you.", "carefully polite": "Pleasure to meet you.", "plain-spoken": "Good to meet you.", "wry under pressure": "Well, nice to meet you." };
const INTRODUCE_ALTERNATES = ["Nice to meet you.", "Glad to meet you."];
const ACK_BY_TEMPERAMENT = { "brief and direct": "Got it.", "measured and reflective": "Understood.", "warm but guarded": "Okay.", "talkative when uneasy": "Sounds good.", "deadpan": "Noted." };
const ACK_ALTERNATES = ["Understood.", "Okay.", "Noted."];
const OBSERVATION_BY_TEMPERAMENT = { "brief and direct": "I'm fine.", "measured and reflective": "Managing, thanks.", "warm but guarded": "I'm all right.", "talkative when uneasy": "Could be better, could be worse.", "deadpan": "Can't complain." };

const HEARD_BY_TEMPERAMENT = { "brief and direct": "Heard you.", "measured and reflective": "Yes, I heard you.", "warm but guarded": "I heard you.", "talkative when uneasy": "Yeah, I heard you, I did.", "deadpan": "Loud and clear." };
const HEARD_ALTERNATES = ["Yeah, I heard you.", "I heard you.", "Loud and clear."];

// Same-turn coordination: prefer a variant an earlier owner did not just use.
const variant = (primary, alternates, prior = []) => [primary, ...alternates].find((line) => !prior.includes(line)) ?? primary;

function renderKnownAnswer(known) {
  if (!known) return null;
  if (known.kind === "recalled-player-statement") return `I remember what you told me: “${sentence(known.text)}”.`;
  if (known.kind === "recalled-own-reply") return `I replied: “${sentence(known.text)}”.`;
  if (known.kind === "own-report") {
    const clauses = [];
    if (known.checked_location) clauses.push(`I checked the ${known.checked_location}.`);
    else if (known.inspected_target) clauses.push(`I inspected ${known.inspected_target}.`);
    if (known.condition_reason) clauses.push(`I was ${sentence(known.condition_reason)}.`);
    if (known.condition) clauses.push(`My current condition is ${known.condition}.`);
    return clauses.length ? clauses.join(" ") : null;
  }
  return null;
}

function presentFallback({ frame, plan = null, prior = [] } = {}) {
  const fn = frame?.discourse_function;
  const style = plan?.style_hints ?? {};

  switch (fn) {
    case "invite_self_description":
    case "ask_role_or_assignment": {
      const name = fact(plan, "name");
      const role = fact(plan, "role");
      const assignment = fact(plan, "current_assignment");
      const held = optionalFact(plan, "held_equipment");
      if (fn === "ask_role_or_assignment" && !role && !assignment) return "Nothing specific right now.";
      if (!name && !role && !assignment) return null;
      const parts = [];
      if (fn === "invite_self_description" && name) parts.push(`I'm ${name}${role ? `, ${article(role)} ${sentence(role)}` : ""}.`);
      else if (role) parts.push(`I'm ${article(role)} ${sentence(role)}.`);
      if (assignment) parts.push(`I'm ${lowerFirst(sentence(assignment))}.`);
      else if (held?.length) parts.push(`I'm carrying the ${lowerList(held)}.`);
      return parts.join(" ");
    }
    case "ask_item_ownership": {
      const holder = fact(plan, "item_holder");
      if (holder) {
        if (holder.holder_is_self) return `I've got the ${String(holder.label).toLowerCase()}.`;
        if (holder.holder_name === "you") return `You've got the ${String(holder.label).toLowerCase()}.`;
        // Custody this speaker has no way to know is unknown, not "not mine".
        if (holder.holder_known === false) return `I don't know who has the ${String(holder.label).toLowerCase()}.`;
        if (holder.holder_name) return `The ${String(holder.label).toLowerCase()} is with ${holder.holder_name}.`;
        return `I don't have the ${String(holder.label).toLowerCase()}.`;
      }
      // Unresolved item: the state is "which item?", never "I definitely lack it".
      return "Which thing do you mean?";
    }
    case "ask_personal_experience": {
      if (frame.requested_content === "background") {
        const trade = (plan?.required_facts ?? []).find((f) => f.key === "identity_fact" && f.value?.education_or_trade)?.value.education_or_trade;
        return trade ? `My background is ${sentence(trade)}.` : "I'd rather not get into that.";
      }
      const recalled = renderKnownAnswer(fact(plan, "known_answer"));
      if (recalled) return recalled;
      const experience = fact(plan, "prior_expedition_experience");
      // Nothing established is "not that I know of", never a claim of no experience.
      return experience ? `${upperFirst(sentence(experience))}.` : "Not that I know of.";
    }
    case "joke_or_sarcasm":
      return JOKE_BY_EXPRESSION[style.social_expression] ?? JOKE_BY_TEMPERAMENT[style.conversational_temperament] ?? "Ha.";
    case "check_in":
      return CHECK_IN_BY_TEMPERAMENT[style.conversational_temperament] ?? "Doing all right.";
    case "challenge": {
      const facts = (plan?.required_facts ?? []).filter((f) => f.key === "known_fact");
      return facts.length ? `${upperFirst(sentence(facts[0].value.text))}.` : "I'm only going by what I know.";
    }
    case "ask_factual": {
      const recalled = renderKnownAnswer(fact(plan, "known_answer"));
      if (recalled) return recalled;
      const known = (plan?.required_facts ?? []).filter((f) => f.key === "known_fact");
      if (known.length) return known.slice(0, 2).map((f) => `${upperFirst(sentence(f.value.text))}.`).join(" ");
      const holder = fact(plan, "item_holder");
      if (holder?.holder_is_self) return `I've got the ${String(holder.label).toLowerCase()}.`;
      const held = fact(plan, "held_equipment");
      if (held?.length) return `I've got ${lowerList(held)}.`;
      // An equipment referent that did not resolve is a clarification, never ignorance.
      if ((frame.referents ?? []).some((r) => r.type === "equipment" && !r.resolved)) return "Which thing do you mean?";
      // A wh-question with nothing authorized is an honest "don't know"; a
      // yes/no question with nothing authorized makes no claim either way.
      if (frame.addressee_state) return "Yeah, I think so.";
      return frame.question_form === "yes_no" ? "Not that I know of." : "I don't know.";
    }
    case "clarify_previous":
    case "request_repetition": {
      const ante = frame.antecedent ?? {};
      if (!ante.resolved) return "Sorry, what are you asking me to go back over?";
      const responses = fact(plan, "antecedent_responses") ?? [];
      const own = responses.filter((r) => r.is_self).slice(-1)[0] ?? null;
      const other = responses.slice(-1)[0] ?? null;
      // Repair targets the immediately preceding heard line, not the old topic.
      const lead = fn === "clarify_previous" ? "I just said," : "I said,";
      if (own) return `${lead} "${sentence(own.text)}."`;
      if (other) return `${other.speaker_name ?? "Someone"} said, "${sentence(other.text)}."`;
      const said = fact(plan, "antecedent_player_text");
      return said ? `You said, "${sentence(said)}."` : "Sorry, what are you asking me to go back over?";
    }
    case "ambiguous_reference":
      return "Sorry, which thing do you mean?";
    case "ask_heard_confirmation": {
      if (!frame.antecedent?.resolved) return "Sorry, hear what?";
      const heard = fact(plan, "heard_confirmation");
      if (heard && heard.heard === false) return "Sorry, I didn't catch that.";
      return variant(HEARD_BY_TEMPERAMENT[style.conversational_temperament] ?? "Yeah, I heard you.", HEARD_ALTERNATES, prior);
    }
    case "greet":
      return variant(GREET_BY_EXPRESSION[style.social_expression] ?? "Hello.", GREET_ALTERNATES, prior);
    case "introduce_self":
      return variant(INTRODUCE_BY_EXPRESSION[style.social_expression] ?? "Good to meet you.", INTRODUCE_ALTERNATES, prior);
    case "acknowledge":
      return variant(ACK_BY_TEMPERAMENT[style.conversational_temperament] ?? "Understood.", ACK_ALTERNATES, prior);
    case "social_observation":
      return OBSERVATION_BY_TEMPERAMENT[style.conversational_temperament] ?? "Fair enough.";
    case "warn":
      return "Understood. I'll be careful.";
    case "express_uncertainty":
      return "Noted. Not knowing yet is fair.";
    case "close_topic":
      return "All right.";
    case "make_statement": {
      const recalled = renderKnownAnswer(fact(plan, "known_answer"));
      return recalled ?? variant(ACK_BY_TEMPERAMENT[style.conversational_temperament] ?? "Understood.", ACK_ALTERNATES, prior);
    }
    case "make_request": {
      const holder = fact(plan, "item_holder");
      const unresolved = (frame.referents ?? []).some((r) => r.type === "equipment" && !r.resolved);
      if (unresolved) return "Which thing do you mean?";
      if (!holder) return "I'm not sure that's mine to hand over.";
      const label = String(holder.label).toLowerCase();
      if (holder.holder_is_self) return `The ${label} is still with me until we do a proper handoff.`;
      if (holder.holder_name === "you") return `You already have the ${label}.`;
      if (holder.holder_name) return `${holder.holder_name} has the ${label}. That would have to happen in person.`;
      return "I'm not sure that's mine to hand over.";
    }
    default:
      return null;
  }
}

// Facts whose truth depends on CURRENT canonical state (who holds what, what one is doing now).
const COMMIT_SENSITIVE_FACTS = new Set(["item_holder", "held_equipment", "current_assignment", "current_activity"]);

/**
 * Deterministic wording used when a model candidate was validated against a
 * projection that went stale before commit. Same frame, same purpose, same owner:
 * only the commit-sensitive facts are withheld, so no stale value can be asserted.
 */
function presentStaleSafeFallback({ frame, plan = null, prior = [] } = {}) {
  const fn = frame?.discourse_function;
  if (fn === "ask_item_ownership" || fn === "make_request" || (fn === "ask_factual" && (frame.referents ?? []).some((r) => r.type === "equipment" && r.resolved))) return "I'm not sure right now.";
  const stripped = plan ? { ...plan, required_facts: (plan.required_facts ?? []).filter((f) => !COMMIT_SENSITIVE_FACTS.has(f.key)), optional_facts: (plan.optional_facts ?? []).filter((f) => !COMMIT_SENSITIVE_FACTS.has(f.key)) } : null;
  return presentFallback({ frame, plan: stripped, prior });
}

/**
 * Fallback for an autonomous observation report, from the SAME plan the model
 * was given. Says only what the authorized observation supports: that the
 * speaker noticed the named subject (or that something needs attention).
 */
const REPORT_LINES = Object.freeze({
  hazard_warning: ["Hold up. I've spotted {subject}.", "Hold up. Something's not right here."],
  equipment_problem: ["Something's off with {subject}.", "Something here needs a look."],
  anomaly_notice: ["I noticed {subject}.", "I noticed something over here."],
  personnel_condition: [null, "Something about one of us needs a look."],
  assignment_blocker: ["{Subject} is in my way.", "Something is in my way here."],
  assignment_finding: ["I found {subject}.", "I found something."]
});
const FIXED_LINES = Object.freeze({
  hazard_warning: "Hold up. Something's off at {subject}.",
  equipment_problem: "Something's off at {subject}.",
  anomaly_notice: "I've got eyes on {subject}.",
  personnel_condition: "Something about one of us needs a look.",
  assignment_blocker: "{Subject} is in my way.",
  assignment_finding: "I'm at {subject} now."
});
function presentReportFallback({ contribution } = {}) {
  const obs = contribution?.required_facts?.find((f) => f.key === "observation")?.value;
  if (!obs) return null;
  const [withSubject, generic] = REPORT_LINES[contribution.report_purpose] ?? REPORT_LINES.anomaly_notice;
  // A fixed transition (the Threshold) is never "found", carried or used: it is where you are, or what you are looking at.
  if (obs.entity_class === "fixed_transition" && obs.subject_phrase) {
    const at = FIXED_LINES[contribution.report_purpose] ?? FIXED_LINES.anomaly_notice;
    return at.replace("{subject}", obs.subject_phrase).replace("{Subject}", upperFirst(obs.subject_phrase));
  }
  const subject = obs.subject_phrase ? obs.subject_phrase : (obs.subject ? `the ${String(obs.subject).toLowerCase()}` : null);
  if (subject && withSubject) return withSubject.replace("{subject}", subject).replace("{Subject}", upperFirst(subject));
  return generic;
}

module.exports = { presentFallback, presentStaleSafeFallback, presentReportFallback, renderKnownAnswer, COMMIT_SENSITIVE_FACTS };
