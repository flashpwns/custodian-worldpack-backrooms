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

/**
 * Safe quotation of an earlier line (presentation only; the quoted content is never rewritten): one
 * outer pair of double quotes, inner double quotes become single quotes, a line already wrapped in quotes
 * is not wrapped twice, and the line's own closing punctuation stays inside the quotes (no `."."`).
 *   quoteLine('I said, "Hey."') -> '"I said, \'Hey.\'"'
 */
function quoteLine(text) {
  let inner = String(text ?? "").replace(/\s+/g, " ").trim();
  // Unwrap one existing outer pair so it is not doubled.
  const wrapped = inner.match(/^["“”](.*)["“”]$/);
  if (wrapped && !/["“”]/.test(wrapped[1])) inner = wrapped[1].trim();
  inner = inner.replace(/["“”]/g, "'");
  if (!inner) return '""';
  const closed = /[.!?…]['’]?$/.test(inner) ? inner : `${inner}.`;
  return `"${closed}"`;
}
/** "<lead> "<line>"" with correct terminal punctuation (the quote already ends the sentence). */
const saidLine = (lead, text) => `${lead} ${quoteLine(text)}`;

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
// Ordinary canonical self-state only: none of these asserts a mood the simulation does not hold.
const CHECK_IN_BY_TEMPERAMENT = {
  "brief and direct": "I'm fine.",
  "measured and reflective": "Managing, thanks.",
  "warm but guarded": "I'm all right.",
  "talkative when uneasy": "Doing all right, thanks.",
  "deadpan": "Can't complain."
};
// Canonically moved self-state, worded plainly (the affect system decided it; wording only says it).
const AFFECT_WORDING = Object.freeze({ tired: "tired", tense: "a bit on edge", nervous: "a little nervous", pressed: "feeling the clock" });
function affectKeys(affect = []) {
  const keys = [];
  for (const item of affect) {
    if (/tired/i.test(item)) keys.push("tired");
    else if (/tense|stress/i.test(item)) keys.push("tense");
    else if (/nervous/i.test(item)) keys.push("nervous");
    else if (/pressed|time/i.test(item)) keys.push("pressed");
  }
  return [...new Set(keys)];
}
/** Answer about oneself from the plan's canonical self_state; null when the plan carries none. */
function presentSelfState(selfState, style = {}) {
  if (!selfState) return null;
  const keys = affectKeys(selfState.affect);
  if (selfState.state === "affected" && keys.length) {
    const order = ["tired", "tense", "nervous", "pressed"].filter((key) => keys.includes(key));
    const said = order.map((key) => AFFECT_WORDING[key]);
    const list = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0];
    return `Honestly, ${list}.`;
  }
  return CHECK_IN_BY_TEMPERAMENT[style.conversational_temperament] ?? "Doing all right.";
}

// A question about one feeling, answered from canonical state. "not_especially": an ordinary state holds
// no elevated feeling either way -- a stance, never "I don't know" (a speaker has access to themselves).
const NOT_ESPECIALLY_LINES = ["Not especially. I feel all right about it.", "Can't say I feel much either way.", "Not really. Just feeling normal about it.", "Not especially, no."];
const YES_AFFECT_LINES = Object.freeze({ tired: "Yeah, a bit tired, honestly.", tense: "A little on edge, yes.", nervous: "Yeah, a little nervous, honestly." });
function presentSelfStateAnswer(answer, selfState, style = {}, prior = []) {
  if (!answer) return null;
  if (answer.answer === "yes") return (answer.asked === "tense" && affectKeys(selfState?.affect).includes("nervous") && !affectKeys(selfState?.affect).includes("tense") ? YES_AFFECT_LINES.nervous : YES_AFFECT_LINES[answer.asked]) ?? presentSelfState(selfState, style);
  // Asked about one feeling while canonically feeling another: say no to the one asked, then the real one.
  if (answer.answer === "affected_instead" && answer.asked === "tired") return `Not tired, no. ${presentSelfState(selfState, style)}`;
  if (answer.answer === "affected_instead" || answer.answer === "affected") return presentSelfState(selfState, style);
  if (answer.answer === "not_especially") return variant(NOT_ESPECIALLY_LINES[0], NOT_ESPECIALLY_LINES.slice(1), prior);
  return variant(CHECK_IN_BY_TEMPERAMENT[style.conversational_temperament] ?? "Doing all right.", Object.values(CHECK_IN_BY_TEMPERAMENT), prior);
}

// "Why?" about one's own previous line: says only the basis that line was authorized with.
function presentExplanation(basis, style = {}) {
  if (!basis) return "Sorry, what do you mean?";
  switch (basis.kind) {
    case "self_state":
      if (basis.state === "affected" && (basis.affect ?? []).length) return `${presentSelfState({ state: "affected", affect: basis.affect }, style).replace(/^Honestly, /, "").replace(/^./, (c) => c.toUpperCase())} That's all.`;
      return "Just how I feel right now. Nothing out of the ordinary.";
    case "no_known_fact":
      if (basis.uncertainty === "not_told") return "Because nobody's told me.";
      if (basis.uncertainty === "no_established_personal_history") return "I just can't think of a time I have.";
      if (basis.uncertainty === "no_established_opinion") return "I just haven't formed a view on it.";
      return basis.past_perception || basis.uncertainty === "did_not_perceive" ? "I just didn't notice anything." : "I just don't have anything to go on.";
    case "observation":
      return "I saw it myself.";
    case "clarification":
      return "I wasn't sure what you meant.";
    case "briefing_instruction":
      return `That's what we were told at ${basis.source ?? "the briefing"}.`;
    case "custody":
      if (basis.holder_is_self) return "Because it's with me.";
      if (basis.holder_known === false) return "I just don't know who has it.";
      if (basis.known_by === "briefing") return "Maxwell said so at the briefing.";
      if (basis.known_by === "seen") return "I can see it from here.";
      if (basis.known_by === "seen_earlier") return "That's where I last saw it.";
      return "That's where it is, as far as I know.";
    case "known_information": {
      const p = basis.provenance ?? [];
      const said = p.includes("briefing") ? "We were told at the briefing." : p.includes("observed") ? "I saw it myself." : p.includes("heard") && basis.heard_from?.length ? `${[].concat(basis.heard_from).join(" and ")} said so.` : p.includes("self") ? "That's my own assignment." : p.includes("baseline_field_procedure") ? "That's basic field training." : p.includes("baseline_induction") ? "That's the basic orientation everyone assigned here gets." : "That's just what I know about it.";
      return basis.partial ? `${said} Nobody's said anything about the rest.` : said;
    }
    case "custody_history":
      if (!basis.holder_name) return "I just don't know who had it before.";
      return basis.basis === "briefing" ? "Maxwell said so at the briefing." : `I saw it with ${basis.holder_is_self ? "me" : basis.holder_name} earlier.`;
    case "heard_report":
      return basis.speakers?.length ? `I heard ${basis.speakers.join(" and ")} say it.` : "I heard it said.";
    case "assignment":
      return "That's my assignment.";
    case "heard":
      return basis.heard ? "I heard you say it." : "I just didn't catch it.";
    case "restatement":
      return "I'm only repeating what was said.";
    case "request_policy":
      return basis.disposition === "requires_structured_handoff" ? "Things only change hands through a proper handoff." : "I'm just saying I heard you.";
    case "predicate_answer": {
      const p = basis.provenance ?? [];
      if (["unknown", "not_established"].includes(basis.value)) return /^person\.(?:complex|expedition)/.test(basis.predicate ?? "") ? "I just can't think of a time I have." : basis.value === "unknown" ? "I just haven't been told." : "Nobody's said anything about it.";
      if (p.includes("self")) return /complex|expedition/.test(basis.predicate ?? "") ? "That's just my own history." : /first_day|tenure/.test(basis.predicate ?? "") ? "That's just how long I've been here." : "That's just me.";
      if (p.includes("briefing")) return "That's what we were told at the briefing.";
      if (p.includes("heard")) return "That's what I heard said.";
      if (basis.value === "unknown") return "I just haven't been told.";
      if (basis.value === "not_established") return "Nobody's said anything about it.";
      return "That's just what I know about it.";
    }
    case "not_own_line":
      return basis.speaker_name ? `You'd have to ask ${basis.speaker_name}.` : "That wasn't me.";
    case "social":
      return basis.discourse_function === "joke_or_sarcasm" ? "Just joking." : "No particular reason.";
    default:
      return "I just meant what I said.";
  }
}

// A clarification asks for exactly the kind of answer its open question expects (the plan's slot).
const CLARIFY_BY_SLOT = Object.freeze({ temporal: "Sorry, when do you mean?", location: "Sorry, where do you mean?", person: "Sorry, who do you mean?", referent: "Sorry, which thing do you mean?", spatial_selection: "Sorry, which one do you mean?", reason: "Sorry, why do you say that?", yes_no: "Sorry, do you mean yes or no?", topic: "Sorry, what do you mean?" });
const clarifyFor = (plan, fallback = "Sorry, what do you mean?") => CLARIFY_BY_SLOT[plan?.expected_slot] ?? fallback;

/** What one's own earlier line meant, from the fact its words came from (never the words themselves). */
function presentMeaning(meaning, style = {}) {
  if (!meaning) return null;
  if (!meaning.own) return meaning.speaker_name === "you" ? "That's what you said. I can't tell you what you meant by it." : `You'd have to ask ${meaning.speaker_name ?? "them"} what they meant.`;
  const fact = meaning.meaning ?? null;
  if (fact) {
    const semantics = fact.semantics ?? null;
    switch (fact.key) {
      case "current_assignment":
        if (semantics?.task_type === "follow") return `I just mean I'm ${semantics.phrase}: ${semantics.gloss}.`;
        if (semantics?.source === "assigned_task") return `It's the task I was assigned: ${sentence(semantics.phrase)}. That's all there is to it.`;
        return `That's my assignment: ${sentence(fact.value)}.`;
      case "role": return `That's my role. I'm ${article(String(fact.value))} ${sentence(String(fact.value).toLowerCase())}.`;
      case "name": return "That's just my name.";
      case "item_holder": return presentExplanation({ kind: "custody", ...fact.value }, style);
      case "known_fact": return `Just that ${lowerFirst(sentence(fact.value?.text ?? ""))}.`;
      case "current_procedure": return presentExplanation({ kind: "briefing_instruction", ...fact.value }, style);
      case "self_state": case "self_state_answer": return "Just how I feel right now. Nothing more to it.";
      default: return "I only meant what I said.";
    }
  }
  // The quoted words were only how the line was put: what it meant is what it was said on.
  if (meaning.basis?.kind === "social" && meaning.basis.discourse_function === "greet") return "Just saying hello.";
  if (meaning.basis?.kind === "social" && meaning.basis.discourse_function === "introduce_self") return "Just that it's good to meet you.";
  if (meaning.basis && meaning.basis.kind !== "unavailable") return presentExplanation(meaning.basis, style);
  return "I only meant what I said.";
}

/** A recent exchange, accounted for with only what the speaker perceived; no motive is ever supplied. */
function presentConversationEvent(event) {
  if (!event) return null;
  if (event.responded) return event.own_reply ? `I did answer. ${saidLine("I said,", event.own_reply)}` : "I did answer you.";
  if (event.reason === "did_not_hear") return "Sorry, I didn't hear you then.";
  if (event.reason === "another_answered" && event.others_responded?.length) return `${event.others_responded.join(" and ")} answered you then.`;
  return "You're right, I didn't answer. Sorry about that.";
}

const GREET_BY_EXPRESSION = { "dryly observant": "Hey.", "quietly friendly": "Hi there.", "carefully polite": "Good morning.", "plain-spoken": "Hey.", "wry under pressure": "Well, hello." };
const GREET_ALTERNATES = ["Hello.", "Morning.", "Hi."];
const INTRODUCE_BY_EXPRESSION = { "dryly observant": "Good to meet you, I think.", "quietly friendly": "Good to meet you.", "carefully polite": "Pleasure to meet you.", "plain-spoken": "Good to meet you.", "wry under pressure": "Well, nice to meet you." };
const INTRODUCE_ALTERNATES = ["Nice to meet you.", "Glad to meet you."];
const ACK_BY_TEMPERAMENT = { "brief and direct": "Got it.", "measured and reflective": "Understood.", "warm but guarded": "Okay.", "talkative when uneasy": "Sounds good.", "deadpan": "Noted." };
const ACK_ALTERNATES = ["Understood.", "Okay.", "Noted."];
// A reaction to a remark that is not about the speaker: no state, no agreement that something was seen.
const OBSERVATION_BY_TEMPERAMENT = { "brief and direct": "Fair enough.", "measured and reflective": "Hm. Maybe so.", "warm but guarded": "Could be.", "talkative when uneasy": "Hm. Fair enough.", "deadpan": "Noted." };
// Acknowledging an order/request that conversation does not perform: heard, neither accepted nor refused.
const HEARD_REQUEST_LINES = ["Heard you.", "I hear you.", "Heard."];

const HEARD_BY_TEMPERAMENT = { "brief and direct": "Heard you.", "measured and reflective": "Yes, I heard you.", "warm but guarded": "I heard you.", "talkative when uneasy": "Yeah, I heard you, I did.", "deadpan": "Loud and clear." };
const HEARD_ALTERNATES = ["Yeah, I heard you.", "I heard you.", "Loud and clear."];

// Same-turn coordination: prefer a variant an earlier owner did not just use.
const variant = (primary, alternates, prior = []) => [primary, ...alternates].find((line) => !prior.includes(line)) ?? primary;

function renderKnownAnswer(known) {
  if (!known) return null;
  if (known.kind === "recalled-player-statement") return saidLine("I remember what you told me:", known.text);
  if (known.kind === "recalled-own-reply") return saidLine("I replied:", known.text);
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

// What a partially known answer leaves out, said plainly (never a guess at it).
const GAP_WORDING = Object.freeze({
  purpose_and_contents: "What's in them, or what they're actually for beyond that, nobody's told me.",
  purpose: "What it's actually for beyond that, nobody's told me.",
  contents: "What's actually in them, nobody's told me.",
  origin: "Where it came from or why it's there, nobody's told me.",
  history: "Beyond that, I don't know anything about the company.",
  mechanism: "How it actually works, nobody's told me.",
  command: "Beyond that, I don't know who's in charge.",
  acquaintance: "That's all I know of him.",
  current_state: "What state it's in right now, I don't know."
});
function presentPartial(known, gap) {
  const statements = (known.statements ?? []).slice(0, 2);
  if (gap.concept === "person_relation") return `Only from the briefing. ${statements.find((x) => /authority|briefing/i.test(x)) ?? statements[0]}`;
  const gapLine = GAP_WORDING[gap.missing] ?? "Beyond that, nobody's told me.";
  return `${statements.join(" ")} ${gapLine}`.trim();
}
/** What someone said, attributed; a player's claim is quoted back as theirs, never endorsed. */
function presentReported(reported) {
  const claims = reported.claims ?? [];
  if (!claims.length) return "I didn't hear that.";
  // One sentence per speaker; a player's claim is quoted back as theirs.
  const bySpeaker = [];
  for (const c of claims) {
    const key = c.epistemic === "player_claim" ? "you" : (c.speaker_name ?? "Someone");
    const entry = bySpeaker.find((e) => e.key === key) ?? (bySpeaker.push({ key, items: [] }), bySpeaker.at(-1));
    entry.items.push(c);
  }
  const lines = bySpeaker.map((e) => (e.key === "you"
    ? e.items.slice(-2).map((c) => saidLine("You said,", c.quote)).join(" ")
    // One's own words are quoted back as they were said, never re-narrated in the third person.
    : e.key === "I" && e.items.some((c) => c.quote)
      ? e.items.filter((c) => c.quote).slice(-2).map((c, i) => saidLine(i ? "I also said," : "I said,", c.quote)).join(" ")
    : `${e.key} said ${e.items.slice(0, 3).map((c) => sentence(c.reported)).join(", and that ")}.`));
  if (lines.length === 2 && bySpeaker.every((e) => e.key !== "you")) return `${lines[0].replace(/\.$/, "")}, but ${lines[1]}`;
  return lines.slice(-2).join(" ");
}

// ─── Semantic Registry answers (ED-30): worded ONLY from the resolver result the plan carries ───────────
const TENURE_LINE = Object.freeze({ weeks: "I've been with ASYNC a few weeks", months: "I've been with ASYNC a few months", years: "I've been with ASYNC for years" });
function presentPredicateAnswer(answer, { prior = [] } = {}) {
  if (!answer) return null;
  const a = answer.answer ?? {};
  if (answer.predicate === "conversation.claim_check") return variant("I couldn't tell you either way.", ["No idea, honestly. I couldn't say either way.", "I couldn't say either way."], prior);
  if (answer.value === "unknown" && a.third_party) { const who = a.subject_name ?? "them"; return variant(`I couldn't tell you. You'd have to ask ${who}.`, [`No idea, honestly. You'd have to ask ${who}.`, `I don't know. You'd have to ask ${who}.`], prior); }
  if (answer.value === "unknown") return a.third_party ? variant("I couldn't tell you. You'd have to ask them.", ["No idea, honestly. You'd have to ask them.", "I don't know. You'd have to ask them."], prior) : variant("No idea, honestly.", ["I don't know.", "Couldn't tell you."], prior);
  if (answer.value === "not_established") {
    if (answer.predicate === "person.intent") return "Couldn't tell you. Nothing in particular.";
    // One's own history that canon does not settle: an honest hedge, never an invented yes or no.
    if (a.count_asked) return variant("I couldn't say how many, exactly.", ["Couldn't tell you how many, honestly.", "I couldn't say exactly how many."], prior);
    // A place the profile does not settle ("Have you been to Outpost A?"): no lean either way.
    if (a.place && !["complex", "threshold"].includes(a.place)) return variant("I couldn't say for sure.", ["Couldn't say for sure, honestly.", "I'm not sure, honestly."], prior);
    if (/^person\.(?:complex|expedition)_experience$/.test(answer.predicate)) return "Not that I can think of.";
    return variant("Nobody's said.", ["Nobody's said anything about that.", "That hasn't come up."], prior);
  }
  if (a.reported) return `${upperFirst(sentence(answer.statements?.[0] ?? "That's what I heard"))}.`;
  switch (answer.predicate) {
    case "person.first_day_at_async":
      if (answer.value === "yes") return variant("Yeah, it's my first day.", ["It is, yeah. First day.", "Yes, first day for me."], prior);
      return `No, ${TENURE_LINE[a.band] ?? "I've been here a while"}.`;
    case "person.async_tenure":
      return a.band === "first_day" ? "Today's my first day." : `${upperFirst(TENURE_LINE[a.band] ?? "A while")}.`;
    case "person.expedition_experience":
      // "Is this your first expedition?" asks it inverted: yes = none before.
      if (answer.inverted) return answer.value === "no" ? variant("Yes, it's my first expedition.", ["Yes, first one for me.", "It is, yeah. My first."], prior) : variant("No, I've been on expeditions before.", ["No, not my first.", "No, I've done this before."], prior);
      return answer.value === "no" ? variant("No, this is my first expedition.", ["No, first one for me.", "Not before, no. This is my first."], prior) : variant("Yes, I've been on expeditions before.", ["I have, yeah.", "Yes, I've done this before."], prior);
    case "person.complex_experience":
      if (answer.inverted && !(a.place && !["complex", "threshold"].includes(a.place))) return answer.value === "no" ? variant("Yes, it's my first time going in.", ["Yes, first time for me. I've never been in.", "It is, yeah. I've never been in the Complex."], prior) : variant("No, I've been in before.", ["No, not my first time. I've been in before.", "No, I've been in the Complex before."], prior);
      if (a.place && !["complex", "threshold"].includes(a.place)) return answer.value === "no" ? "No. I've never been in the Complex at all." : "Not that I can think of.";
      return answer.value === "no" ? variant("No, never. I've never been in the Complex.", ["No, I've never been in.", "Never, no. I haven't been in the Complex."], prior) : variant("Yes, I've been in before.", ["I have, yes. I've been in before.", "Yeah, I've been in the Complex before."], prior);
    case "person.wellbeing":
    case "person.nervousness":
    case "person.anticipation":
    case "person.fatigue": {
      // A self-state answered from the recorded dimensions (a past state in the past tense).
      const d = a.dimensions ?? null;
      if (!d) return null;
      const nervous = ["elevated", "high"].includes(d.nervousness);
      const phrase = answer.predicate === "person.fatigue" ? (["high", "elevated"].includes(d.fatigue) ? "pretty tired" : nervous ? "not tired, just a little nervous" : "not tired")
        : answer.predicate === "person.anticipation" ? (nervous ? "more nervous than excited" : "not especially excited, but all right")
          : answer.predicate === "person.nervousness" ? (nervous ? "a little nervous" : "not especially nervous")
            : (nervous ? "a little nervous" : /fine|good|ok/.test(String(d.wellbeing)) ? "fine" : "not great");
      if (a.temporal === "earlier") return /^not /.test(phrase) ? `Earlier, I wasn't ${phrase.slice(4)}.` : `Earlier, I was ${phrase}.`;
      return `${upperFirst(phrase)}.`;
    }
    case "person.familiarity":
      // Two people answering "do you two know each other?" never say the identical line.
      return answer.value === "no" ? variant(`No, ${lowerFirst(sentence(answer.statements?.[0] ?? "we only met today"))}.`, ["No, we'd never met before today.", "Same here. We only just met."], prior) : `Yes, ${lowerFirst(sentence(answer.statements?.[0] ?? "we know each other"))}.`;
    case "place.access":
      return `Yes. ${upperFirst(sentence(answer.statements?.[0] ?? "We're going in"))}.`;
    case "transition.participants":
    case "mission.participants": {
      const said = sentence(answer.statements?.[0] ?? "");
      // "Are we splitting up?" / "together or splitting up?": nobody has said anything about splitting; the
      // canonical answer is who was sent (never a bare "yes" to a split question).
      if (answer.asks_split || a.asks_split) return /\btogether\b/i.test(String(answer.alternatives ?? "")) || (answer.alternatives ?? []).length ? `Together, as far as I know. Nobody's said anything about splitting up. ${said}.` : `Nobody's said anything about splitting up. ${said}.`;
      if (/\bsplit/i.test(String(answer.alternatives ?? ""))) return `Together, as far as I know. ${said}.`;
      // To a negative question, no bare "yes": say what is so.
      if (answer.negated) return answer.value === "yes" ? `As far as I know, we're all going. ${said}.` : `${said}.`;
      if (a.subject_ids?.length) return `As far as I know, yes. ${said}.`;
      // A "who" question gets the answer itself, never a "yes".
      if (answer.question_form === "wh") return `${said}.`;
      return answer.value === "yes" ? `Yes, as far as I know. ${said}.` : `${said}.`;
    }
    default:
      return (answer.statements ?? []).length ? (answer.statements ?? []).slice(0, 2).map((x) => `${upperFirst(sentence(x))}.`).join(" ") : null;
  }
}

// After "Like I said," a sentence's first word is lowercased unless it is a name or the pronoun I.
const PROPER_OPENERS = new Set(["Maxwell", "ASYNC", "Async", "Outpost", "Equipment", "Complex", "Threshold", "Bermuda", "Kirk", "Beck"]);
function keepsCapital(line, plan) {
  const first = String(line).match(/^[A-Za-z][A-Za-z'’-]*/)?.[0] ?? "";
  const bare = first.replace(/['’].*$/, "");
  if (bare === "I" || /^[A-Z]{2,}$/.test(bare)) return true;
  if (PROPER_OPENERS.has(bare)) return true;
  // A proper noun of this plan's facts: a whole name value ("Tonya") or capitalised mid-sentence.
  const blob = JSON.stringify([plan?.required_facts ?? [], plan?.optional_facts ?? []]);
  return new RegExp(`"${bare}"|[a-z,] ${bare}\\b`).test(blob);
}

function presentFallback({ frame, plan = null, prior = [] } = {}) {
  // One line answering several acts: each part worded from its own frame and plan, in order.
  if (plan?.discourse_function === "compound") return plan.parts.map((part) => presentFallback({ frame: part.frame, plan: part.plan, prior })).filter(Boolean).join(" ") || null;
  const line = presentFallbackLine({ frame, plan, prior });
  // Asked again right after answering the same thing: "Like I said, ..." (never a duplicate introduction).
  // (Only a common sentence opener is lowercased after "Like I said," -- never a name.)
  if (line && optionalFact(plan, "repeat_of_own_answer") && !plan?.may_ask_clarifying_question && !/^like i said/i.test(line)) return `Like I said, ${keepsCapital(line, plan) ? line : lowerFirst(line)}`;
  return line;
}
function presentFallbackLine({ frame, plan = null, prior = [] } = {}) {
  const fn = frame?.discourse_function;
  const style = plan?.style_hints ?? {};

  // Knowledge answers: exactly the granted statements (provenance kept in the plan), or a truthful unknown.
  // PARTIAL knowledge says both what is known and that the asked detail is not.
  const known = fact(plan, "known_concept");
  if (known && !plan?.may_ask_clarifying_question) {
    const gap = fact(plan, "knowledge_gap");
    const said = (known.statements ?? []).slice(0, 2).join(" ");
    if (gap) return presentPartial(known, gap);
    const onlyBriefing = known.concept === "institution_purpose" && (known.provenance ?? []).every((p) => p === "briefing");
    const limit = known.limit ? ` ${/\b(?:him|her)\b/.test(known.limit) ? "Beyond that, I don't know much about him." : "That's about all I know."}` : "";
    return `${onlyBriefing ? "All I know is what we were told. " : ""}${said}${limit}`;
  }
  const reported = fact(plan, "reported_speech");
  if (reported && !plan?.may_ask_clarifying_question) return presentReported(reported);
  if (fn === "ask_reported_speech") {
    if (plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, who do you mean?");
    const u = fact(plan, "uncertainty");
    const who = u?.speaker_name === "you" ? "you" : (u?.speaker_name ?? "them");
    // Nothing heard from them at all vs nothing on this topic.
    // On a topic, the speaker can only say what they hold -- never that the person did not say it.
    if (u?.kind === "report_topic_not_held" || u?.kind === "not_heard_on_topic") return `I couldn't tell you what ${who} said about that.`;
    return u?.kind === "not_heard_on_topic" ? `I didn't hear ${who} say anything about that.` : `I didn't hear ${who} say anything.`;
  }
  if (fn === "ask_current_action" && fact(plan, "current_action")) {
    const activity = fact(plan, "current_action").activity;
    return activity ? `I'm ${lowerFirst(sentence(activity))}.` : "Nothing in particular right now.";
  }
  if (["ask_institution_purpose", "ask_mission_objective", "ask_person_identity", "ask_assignment_purpose", "ask_entity_definition", "ask_location_purpose", "ask_current_action"].includes(fn) || (fn === "ask_role_or_assignment" && fact(plan, "uncertainty"))) {
    if (plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, which do you mean?");
    const kind = fact(plan, "uncertainty")?.kind;
    if (kind === "unknown_person") return "I don't know who that is.";
    if (kind === "current_state_unknown") return "I don't know what state it's in right now.";
    return "Nobody's told me that.";
  }
  if (fn === "ask_predicate") {
    if (plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, what do you mean?");
    return presentPredicateAnswer(fact(plan, "predicate_answer"), { prior, names: plan?.names ?? null }) ?? "I couldn't say.";
  }
  if (fn === "attend") return variant("Yes?", ["Yeah?", "Mm?"], prior);
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
      const past = fact(plan, "item_holder_history");
      if (past) {
        const label = String(past.label ?? "it").toLowerCase();
        if (!past.holder_name) return `I don't know who had the ${label} before.`;
        const who = past.holder_is_self ? "me" : past.holder_name;
        return `${past.when === "at the briefing" ? "At the briefing" : "Earlier"}, the ${label} was with ${who}.`;
      }
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
      // Nothing established is "not that I can think of", never a claim of no experience.
      return experience ? `${upperFirst(sentence(experience))}.` : "Not that I can think of.";
    }
    case "joke_or_sarcasm":
      return JOKE_BY_EXPRESSION[style.social_expression] ?? JOKE_BY_TEMPERAMENT[style.conversational_temperament] ?? "Ha.";
    case "check_in": {
      if (fact(plan, "self_state_answer")) return presentSelfStateAnswer(fact(plan, "self_state_answer"), fact(plan, "self_state"), style, prior);
      const said = presentSelfState(fact(plan, "self_state"), style) ?? (CHECK_IN_BY_TEMPERAMENT[style.conversational_temperament] ?? "Doing all right.");
      // Several people answering for themselves never chorus the same sentence (F14).
      return prior.includes(said) ? variant(said, fact(plan, "self_state")?.state === "affected" ? [said.replace(/^Honestly, /, "").replace(/^./, (c) => c.toUpperCase())] : ["Doing all right, thanks.", "Can't complain.", "I'm fine.", "All right, thanks."], prior) : said;
    }
    case "ask_next_step": {
      const procedure = fact(plan, "current_procedure");
      const notTold = fact(plan, "uncertainty");
      if (notTold?.kind === "next_step_not_told") return `Right now it's ${sentence(notTold.current_step)}. Nobody's said what comes after that.`;
      // No canonical procedure this speaker knows: ask what "next" means, never guess a plan.
      if (!procedure?.next_step) return "Sorry, next for what?";
      const steps = procedure.current_step ? `${sentence(procedure.current_step)}, then ${sentence(procedure.next_step)}` : sentence(procedure.next_step);
      // Asked about the whole day: only what was actually said is known -- never an invented schedule.
      if (procedure.scope === "day") return `For today, all we've been told is to ${steps}.`;
      return `We ${steps}.`;
    }
    case "ask_opinion":
      return variant("No real opinion on it yet.", ["Hard to say yet.", "Haven't really formed a view.", "Couldn't say yet."], prior);
    case "ask_meaning":
      if (plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, which part do you mean?");
      return presentMeaning(fact(plan, "utterance_meaning"), style) ?? "Sorry, which part do you mean?";
    case "ask_response_event":
      if (plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, when do you mean?");
      return presentConversationEvent(fact(plan, "conversation_event")) ?? "Sorry, when do you mean?";
    case "ask_explanation":
      if (!frame.antecedent?.resolved) return "Sorry, what do you mean?";
      // A bare "When?"/"Where?" after a line that had nothing behind it: nothing more is known either.
      if (frame.explanation_aspect && fact(plan, "explanation_basis")?.kind === "no_known_fact") return "I don't know that either.";
      return presentExplanation(fact(plan, "explanation_basis"), style);
    case "challenge": {
      const facts = (plan?.required_facts ?? []).filter((f) => f.key === "known_fact");
      return facts.length ? `${upperFirst(sentence(facts[0].value.text))}.` : "I'm only going by what I know.";
    }
    case "ask_factual": {
      if (plan?.may_ask_clarifying_question && !(plan?.required_facts ?? []).length) return clarifyFor(plan, "Sorry, what do you mean?");
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
      // A time the simulation cannot anchor (and no fact answers) is asked about, never guessed.
      if (frame.temporal_reference && !frame.temporal_reference.resolved && plan?.may_ask_clarifying_question) return clarifyFor(plan, "Sorry, when do you mean?");
      // A wh-question with nothing authorized is an honest "don't know"; a
      // yes/no question with nothing authorized makes no claim either way.
      if (frame.addressee_state) return "Yeah, I think so.";
      if (frame.past_perception) return "Not that I noticed.";
      if (fact(plan, "uncertainty")?.kind === "not_told") return "Nobody's told me.";
      return frame.question_form === "yes_no" ? "I couldn't say." : "I don't know.";
    }
    case "clarify_previous":
    case "request_repetition": {
      const ante = frame.antecedent ?? {};
      if (optionalFact(plan, "reclarify")) return "Sorry, I wasn't sure what you meant. What are you asking?";
      if (!ante.resolved) return "Sorry, what are you asking me to go back over?";
      const responses = fact(plan, "antecedent_responses") ?? [];
      const own = responses.filter((r) => r.is_self).slice(-1)[0] ?? null;
      const other = responses.slice(-1)[0] ?? null;
      // Repair targets the immediately preceding heard line, not the old topic.
      const lead = fn === "clarify_previous" ? "I just said," : "I said,";
      if (own) return saidLine(lead, own.text);
      if (other) return saidLine(`${other.speaker_name ?? "Someone"} said,`, other.text);
      const said = fact(plan, "antecedent_player_text");
      return said ? saidLine("You said,", said) : "Sorry, what are you asking me to go back over?";
    }
    case "ambiguous_reference": {
      if (frame.turn?.clarify_reason === "misunderstood") return "Sorry, I must have misunderstood. What were you asking?";
      const spatial = (frame.referents ?? []).find((r) => r.type === "spatial" && !r.resolved && r.noun && !["thing", "one"].includes(r.noun));
      if (spatial) return `Sorry, which ${spatial.noun} do you mean?`;
      if ((frame.referents ?? []).some((r) => r.reason === "no_antecedent")) return "Sorry, what are you asking about?";
      if (frame.temporal_reference && !frame.temporal_reference.resolved) return "Sorry, when do you mean?";
      return clarifyFor(plan, "Sorry, which thing do you mean?");
    }
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
      // "I was speaking to Tonya." after Tonya already answered: she confirms it was her, nothing more.
      if (frame?.turn?.repair?.vacuous) return variant("Right, that was me.", ["Yeah, that was me."], prior);
      return variant(ACK_BY_TEMPERAMENT[style.conversational_temperament] ?? "Understood.", ACK_ALTERNATES, prior);
    case "social_observation":
      // About the speaker: the canonical self-state answers it; without that fact no state is claimed.
      if (frame.about_addressee && fact(plan, "self_state")) return presentSelfState(fact(plan, "self_state"), style);
      return OBSERVATION_BY_TEMPERAMENT[style.conversational_temperament] ?? "Fair enough.";
    case "warn":
      // A heard warning is acknowledged; no promise of future conduct is invented.
      return variant(ACK_BY_TEMPERAMENT[style.conversational_temperament] ?? "Got it.", ["Got it.", "Heard."], prior);
    case "express_uncertainty":
      return "Fair enough.";
    case "close_topic":
      return "All right.";
    case "make_statement": {
      // The player's answer to one's own "Why?" is heard as their claim, acknowledged, never confirmed.
      if (fact(plan, "stated_reason")) return variant("Okay, fair enough.", ["All right, got it.", "Okay."], prior);
      // A claim about the world is theirs: heard, not endorsed.
      if (fact(plan, "player_claim")) return variant("Huh. If you say so.", ["Huh. Okay.", "Hm. All right."], prior);
      const recalled = renderKnownAnswer(fact(plan, "known_answer"));
      return recalled ?? variant(ACK_BY_TEMPERAMENT[style.conversational_temperament] ?? "Understood.", ACK_ALTERNATES, prior);
    }
    case "make_request": {
      const holder = fact(plan, "item_holder");
      const disposition = fact(plan, "request_disposition");
      const unresolved = (frame.referents ?? []).some((r) => r.type === "equipment" && !r.resolved);
      if (unresolved) return "Which thing do you mean?";
      // Orders and general requests: conversation performs nothing, so the reply only acknowledges.
      if (disposition && disposition.kind !== "handoff") return variant(HEARD_REQUEST_LINES[0], HEARD_REQUEST_LINES.slice(1), prior);
      if (!holder) return "I'm not sure who has that.";
      const label = String(holder.label).toLowerCase();
      if (holder.holder_is_self) return `The ${label} is still with me until we do a proper handoff.`;
      if (holder.holder_name === "you") return `Handing over the ${label} would take a proper handoff.`;
      if (holder.holder_known === false) return `I'm not sure who has the ${label}.`;
      if (holder.holder_name) return `${holder.holder_name} has the ${label}. That would have to happen in person.`;
      return "I'm not sure who has that.";
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

module.exports = { presentPredicateAnswer, quoteLine, presentPartial, presentReported, presentMeaning, presentConversationEvent, CLARIFY_BY_SLOT, presentFallback, presentStaleSafeFallback, presentReportFallback, presentSelfState, presentSelfStateAnswer, presentExplanation, renderKnownAnswer, COMMIT_SENSITIVE_FACTS };
