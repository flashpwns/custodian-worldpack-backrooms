"use strict";

// Bounded utterance interpretation for LOCAL coworker dialogue.
//
// This module is the ONLY place that classifies player speech for the purpose
// of dialogue routing. Its output is deterministic for the clear cases and
// resolves to "ambiguous" when confidence is insufficient. It does NOT mutate
// world state and holds no persistent references.
//
// Architecture invariant:
//   CODE determines the conversational situation.
//   The AI provider only wordsmiths the already-authorized response.

const INTERPRETATION_VERSION = "yellow-beast-dialogue-interpretation@v2";

// ─── Allowlisted speech acts ────────────────────────────────────────────────
const SPEECH_ACTS = Object.freeze([
  "factual_question",   // "What happens if we're not back by one?"
  "personal_question",  // "Have you been in there before?"
  "social_observation", // "You look nervous." / "This seems safe."
  "statement",          // declarative, informational, no response required
  "introduction",       // "I'm Jack." / "My name is Eleanor."
  "greeting",           // "Hey." / "Good morning."
  "acknowledgment",     // "Got it." / "Understood."
  "joke_or_sarcasm",    // "Well this seems incredibly safe."
  "request",            // "Can you hand me the spectrometer?"
  "warning",            // "Look out." / "Careful with that."
  "uncertainty",        // "I'm not sure what we're doing."
  "group_question",     // "@table — does anyone know the route?"
  "ambiguous"           // fallback when confidence is insufficient
]);

// ─── Topic hints — broad operational categories ───────────────────────────
// Used to drive relevance filtering. Not exhaustive.
const TOPICS = Object.freeze([
  "time_or_schedule",   // cutoff, noon, departure, clock
  "route_or_navigation",// tape, path, outpost, corridor, passage
  "equipment",          // camera, spectrometer, duffle, radio, flashlight
  "team_or_roster",     // who is here, coworker names, team size
  "mission_objective",  // outpost A, duffle, startup
  "personal_experience",// first time, before, nervous, claustrophobic
  "relationship",       // get along, trust, worried about
  "safety_or_risk",     // danger, hazard, warning, careful
  "location_or_space",  // room, threshold, kv31, facility
  "social",             // general social / phatic
  "unknown"
]);

// ─── Deterministic pattern tables ──────────────────────────────────────────
const SARCASM_PATTERNS = [
  /\b(?:incredibly|totally|definitely|obviously|surely|really)\s+(?:safe|fine|great|wonderful|fantastic|perfect|clear)\b/i,
  /\bwhat could (?:go wrong|possibly go wrong)\b/i,
  /\bno (?:problem|issue|concern)\s+(?:at all|whatsoever)\b/i,
  /\bsounds?\s+(?:totally|completely|absolutely)\s+(?:normal|fine|safe|good)\b/i
];

// A greeting may carry a trailing group/plain vocative ("Goodmorning, y'all").
const GREETING_VOCATIVE = "(?:y'?all|you all|everyone|everybody|all|guys|gang|folks|team|crew|there|friends)";
const GREETING_HEAD = "(?:hey|hi|hello|hiya|good ?(?:morning|afternoon|evening|day)|morning|howdy|yo|greetings)";
const GREETING_PATTERNS = new RegExp(`^${GREETING_HEAD}(?:[\\s,!.-]+${GREETING_VOCATIVE})?[\\s!.,?]*$`, "i");

const INTRODUCTION_PATTERNS = /\b(?:I'?m|My name is|Call me|I am|You can call me)\s+[A-Z][A-Za-z'-]*/;

const ACKNOWLEDGMENT_PATTERNS = /^(?:got it|understood|copy|roger|alright|all right|okay|ok|sure|noted|good to know|thanks|thank you|appreciate it)[\s!.,]*$/i;

const WARNING_PATTERNS = /\b(?:look out|watch out|careful|be careful|heads up|warning|danger|hazard|stop!|stop that|don't touch)\b/i;

const UNCERTAINTY_PATTERNS = /\b(?:i don'?t know|i'?m not sure|uncertain|unclear|i can'?t tell|no idea|beats me|hard to say)\b/i;

const FACTUAL_QUESTION_PATTERNS = [
  /\bwhat (?:happens?|is the|are the|do we|does|time|if)\b/i,
  /\bwhen (?:do we|should we|is the|does)\b/i,
  /\bhow (?:do we|does|long|far|many)\b/i,
  /\bwhere (?:do we|is|are|should)\b/i,
  /\bwhy (?:do|does|is|are|did)\b/i
];

const PERSONAL_QUESTION_PATTERNS = [
  /\b(?:have you|did you|do you|are you|were you)\b.*\b(?:been|done|seen|worked|know|feel|think|experience)\b/i,
  /\byou (?:been|done|seen|know|feel|ever|worked)\b/i,
  /\bfirst time\b/i,
  /\bhave you (?:ever|been)\b/i
];

const SOCIAL_OBSERVATION_PATTERNS = [
  /\byou (?:look|seem|appear|sound)\b/i,
  /\blooking?\s+(?:good|nervous|worried|tense|calm|ready|pale)\b/i,
  /\b(?:this|that|it) (?:seems?|looks?|feels?|sounds?)\b/i
];

const REQUEST_PATTERNS = /(?:\b(?:can you|could you|would you|please|pass me|hand me|give me|send me|bring me|lend me|help me)\b|^let(?:'s| us)\b)/i;

// Bare conversational reactions -- "What?", "Huh?", "Sorry?" -- are a reflex
// response to the immediately preceding exchange, not a fresh mission
// question. Anchored so a real question sharing the lead word ("What is the
// time?") is unaffected: only the bare word/phrase plus trailing punctuation
// matches.
const BARE_REACTION_PATTERNS = /^(?:what|huh|sorry|pardon|excuse me|eh|hm+|really|come again|say (?:that )?again|what was that|wait,?\s+what|sorry,?\s+what|what do you mean(?: by (?:that|it|this))?|wait,?\s+what do you mean|what does that mean|what(?:'s| is) that supposed to mean|how so|meaning what|you mean\??)[\s?!.]*$/i;

// Conversational repetition/clarification requests -- "Can you repeat that?",
// "Could you say that again?", "I didn't catch that" -- are the same reflex
// clarification as a bare "What?", just phrased as a full sentence. Unlike
// BARE_REACTION_PATTERNS this is not anchored to the whole message, since the
// request is typically wrapped in "can/could you ..." phrasing. Anchored
// narrowly to repetition/hearing language so it never claims a genuine
// factual or task question ("can you check the route again?" stays a request).
const REPETITION_REQUEST_PATTERNS = /\b(?:can|could|would) you (?:repeat|say)(?: that| it)? again\b|\b(?:can|could|would) you (?:repeat|say) (?:that|it|what you (?:just )?said|your (?:last|previous) (?:statement|line|answer))\b|\b(?:repeat|say) (?:what you (?:just )?said|your (?:last|previous) (?:statement|line|answer))\b|\bsay (?:that )?again\b|\bsay again\b|\bone more time\b|\bdidn'?t (?:catch|hear|quite catch|quite hear) (?:that|you)\b|\bcome again\b|\bwhat was that[\s?!.]*$|\bwhat did you (?:just )?say[\s?!.]*$/i;

// ─── Frame-level language cues (single owner of linguistic recognition) ─────
// dialogue-discourse consumes these; it defines no patterns of its own.
const INVITE_SELF_DESCRIPTION_PATTERN = /\b(?:tell|telling|share|sharing|say|talk|describe)\b[^.?!]*\b(?:about\s+)?(?:yourself|yourselves)\b|\bintroduce (?:yourself|yourselves)\b|\bwho are you (?:all|guys|folks)\b/i;
const ITEM_OWNERSHIP_PATTERN = /\b(?:who|which of you)\b[^.?!]*\b(?:assigned|has|have|had|holding|holds|carrying|carries|responsible for|got|took|issued)\b|\bwho(?:'s| is| was) (?:assigned|carrying|holding|responsible)\b/i;
const ITEM_NOUN_PATTERN = /\b(?:kit|gear|equipment|radio|camera|light|duffle|spectrometer|instrument|recorder|device|record|carry|carrying|issued|assigned)\b/i;
const ROLE_OR_ASSIGNMENT_PATTERN = /\bwhat(?:'s| is| are)? (?:your|their) (?:role|job|assignment|task|duty|duties)\b|\bwhat do you (?:do|handle)\b|\bwhat are you (?:doing|working on|assigned to|responsible for)\b|\bwhat(?:'s| is) (?:your )?(?:job|role) here\b/i;
const CLOSE_TOPIC_PATTERN = /^(?:never ?mind|forget (?:it|that)|nothing|it'?s nothing|drop it|that'?s all|that'?s it|no worries|don'?t worry about it)[\s.!]*$/i;
const CHALLENGE_PATTERN = /\b(?:are you sure|that'?s (?:wrong|not right)|you'?re wrong|i don'?t (?:buy|believe)|prove it|doesn'?t (?:add up|make sense))\b/i;
// A check-in asks about the addressee's own condition ("How are you holding up?", "You okay?",
// "Are you tired?"). Its answer is the speaker's canonical self-state, never a guess.
const CHECK_IN_PATTERN = /\bhow(?:'s| is| are) (?:everyone|everybody|you all|all of you|you guys|you doing|you holding up|you feeling)\b|^(?:are |is )?(?:you|everyone|everybody|y'?all|you all|you guys)\s+(?:doing\s+)?(?:okay|ok|alright|all right|good|holding up|tired|exhausted|scared|nervous|worried|stressed|hanging in(?: there)?)(?:\s+(?:there|now|still))?[\s?!.]*$/i;
// Addressee-directed yes/no whose predicate is a MOMENTARY readiness state ("Are you ready?",
// "All set?"). Past perception, presence, plans and affect are never momentary state.
const ADDRESSEE_READINESS_PATTERN = /\b(?:ready|all set|set|good to go|with me)\b/i;
const NOT_MOMENTARY_STATE_PATTERN = /\b(?:did|were|was|earlier|before|yesterday|ago|last|ever|already|see|saw|seen|hear|heard|notice\w*|find|found|check\w*|coming|going|gonna|will|know|been|remember|think|tell|any|carry\w*|have|got|route|outpost|tired|exhausted|scared|afraid|nervous|worried|stressed)\b/i;
// A bare imperative addressed to a coworker ("Wait here.", "Take the camera."). LOCAL wording never
// performs it: the structured order authority does, so its disposition is decided by code.
const ORDER_IMPERATIVE_PATTERN = /^(?:(?:please|hey|okay|ok|alright|right),?\s+)?(?:wait|stay|hold|come|follow|go|head|move|take|grab|bring|carry|check|look at|tell|give|hand|pass|get|keep|help|open|close|photograph|measure|mark|radio|call|stand|sit|watch|stop)\b(?![^.!]*\?)/i;
// Spatial deixis that names a thing only by pointing at it ("that door", "What's this?", "Did you
// hear that?"). Code resolves it from a deterministic selection or it stays unresolved.
const DEICTIC_OBJECT_PATTERN = /\b(?:that|this|those|these)\s+(door(?:way)?|room|thing|one|light|lamp|sound|noise|wall|corridor|hall(?:way)?|passage|opening|stairs?|stairway|box|bag|case|panel|markings?|marks?|sign|hole|pit|vent|machine|console|shape|figure)\b/i;
const BARE_DEMONSTRATIVE_PATTERN = /^(?:what(?:'s| is| was)?|(?:did|can|could|do) you (?:see|hear|notice|smell))\s+(?:that|this)(?:\s+(?:over )?there)?[\s?!.]*$/i;
// An item pronoun in a custody/location predicate ("Who has it?", "Is it here?").
const ITEM_ANAPHOR_PATTERN = /\b(?:who|where)(?:'s| is| has| had)?\b[^.?!]*\bit\b|\b(?:is|was) it (?:here|there|with|on|in)\b|\b(?:have|has|got|seen|see|find|found|carry|carrying|holding|take|took|grab|bring|hand|pass|give)\b[^.?!]*\b(?:it|that one|this one)\b/i;
// A reference to an earlier time or event ("earlier", "before we crossed", "just now").
const TEMPORAL_REFERENCE_PATTERN = /\b(?:earlier|just now|a (?:minute|moment|second|while) ago|last time|this morning|yesterday|today|for the day|when (?:you|he|she|they) said (?:that|it)|(?:before|after|when|while|since|until) (?:we|you|i|he|she|they|the|maxwell|kirk|briefing|crossing)\b[^.?!]*)/i;
// The speaker's own past perception ("Did you see anything?", "Have you noticed...").
const PAST_PERCEPTION_PATTERN = /\b(?:did|have|had) you (?:see|seen|hear|heard|notice|noticed|spot|spotted|catch|smell)\b/i;
// A remark about the addressee's own look or manner ("You look nervous.").
const ABOUT_ADDRESSEE_PATTERN = /\byou(?:'re| are)? (?:look|looking|seem|seeming|sound|sounding|appear)\b/i;
// Question form of the whole utterance (a trailing "?" or a leading question word).
const QUESTION_LIKE_PATTERN = /\?\s*$|^(?:who|what|where|when|why|how|which|are|is|do|does|did|can|could|will|would|have|has|should|was|were)\b/i;
// An item transfer asked for with take/grab ("Take the camera.") -- a handoff once an item resolves.
const TAKE_GRAB_PATTERN = /\b(?:take|grab)\b/i;
// Canonical event anchors a temporal expression may name (resolved against recorded events only).
// A question about the ADDRESSEE'S OWN current feeling ("Are you all excited?", "Nervous?", "You seem
// tense, everything alright?"). The answer is the speaker's canonical self-state, never an outside fact.
// Each affect term maps to the class code compares against that state; readiness ("ready", "all set")
// stays the momentary-state rule above.
const SELF_STATE_AFFECT_TERMS = Object.freeze({
  positive: /\b(?:excited|eager|looking forward|psyched|pumped|thrilled|stoked|happy|glad)\b/i,
  tense: /\b(?:nervous|anxious|worried|scared|afraid|tense|uneasy|stressed|on edge|jittery|freaked(?: out)?)\b/i,
  tired: /\b(?:tired|exhausted|worn out|sleepy|wiped)\b/i,
  wellbeing: /\b(?:okay|ok|alright|all right|feeling|holding up|doing (?:okay|ok|alright|all right|good|fine))\b/i
});
const SELF_STATE_ADDRESSEE_PATTERN = /\b(?:you|y'?all|everyone|everybody|anyone|anybody)\b/i;
// "okay with that" / "all right to carry" ask agreement or permission, not how someone feels.
const SELF_STATE_NOT_FEELING_PATTERN = /\b(?:okay|ok|alright|all right|fine|happy|glad)\s+(?:with|to|about|if)\b|\b(?:is|are) (?:it|that|this|the)\b/i;
function selfStateQuery(raw) {
  const text = String(raw ?? "").trim();
  if (!QUESTION_LIKE_PATTERN.test(text)) return null;
  const leadingAffect = /^(?:so\s+|still\s+)?(?:excited|nervous|tired|scared|worried|okay|ok|alright|all right|ready)\b/i.test(text);
  if (!SELF_STATE_ADDRESSEE_PATTERN.test(text) && !leadingAffect) return null;
  if (SELF_STATE_NOT_FEELING_PATTERN.test(text)) return null;
  for (const affect of ["positive", "tense", "tired", "wellbeing"]) {
    if (SELF_STATE_AFFECT_TERMS[affect].test(text)) return Object.freeze({ asked: affect, polarity: /^(?:how|what)\b/i.test(text) ? "open" : "yes_no" });
  }
  return null;
}
// "What's next?" / "What do we do now?": the CURRENT procedure. Only a canonical procedure context can
// answer it; without one it is a clarification. Never every "next".
const NEXT_STEP_PATTERN = /^(?:so,?\s+|okay,?\s+|ok,?\s+|alright,?\s+|and\s+)?(?:what(?:'s| is)|whats)\s+(?:next|the plan|the next step|our next step|up next|on the agenda)\b|^(?:so,?\s+|okay,?\s+|and\s+)?what (?:now|next)\b|\bwhat (?:do|should|are) we (?:do|doing|supposed to do|supposed to be doing)(?:\s+(?:now|next|today))?[\s?!.]*$|\bwhere (?:do|should) we (?:go|head)(?:\s+(?:now|next))?[\s?!.]*$|\bwhat happens (?:now|next)\b/i;
// "Why?" / "What makes you say that?": asks the reason for the immediately preceding line.
const EXPLANATION_REQUEST_PATTERN = /^(?:but\s+|so\s+|and\s+|oh,?\s+)?(?:why(?: not| is that| do you (?:say|think) (?:that|so)| would you say that| did you say (?:that|so|it))?|why'?s that|how come|what makes you (?:say|think) (?:that|so|it)|how do you know(?: that)?|what do you base that on|what are you basing (?:that|it) on|based on what|what'?s that based on|what do you mean by (?:that|it))(?:,\s*[A-Za-z][\w'-]*)?[\s?!.]*$/i;
// A bare wh-follow-up ("Where?", "When?") asks about the immediately preceding line.
const BARE_WH_FOLLOWUP_PATTERN = /^(?:where|when|who|which one|how)[\s?!.]*$/i;
// Leading discourse markers carry no content ("Anyway, what's next?"); classification sees the rest.
const DISCOURSE_MARKER_PATTERN = /^(?:anyway|anyways|so|okay|ok|alright|all right|well|right|oh|um|uh|also|and|but)\b[,.!]?\s+/i;
// An explicit return to an earlier topic ("Back to the camera, ...", "Anyway, back to what we were saying").
const TOPIC_RETURN_PATTERN = /^(?:(?:going |getting |to get )?back to|as i was saying,?|returning to)\s*/i;
const TOPIC_RETURN_GENERIC_PATTERN = /^(?:what we were (?:talking about|saying)|the (?:earlier|previous|other|first) (?:thing|question|topic)|that|it|before|earlier)[\s?!.,]*$/i;
// "Have you (ever) been...?" / "Have any of you worked...?": the listener's own past experience.
const PERSONAL_EXPERIENCE_PATTERN = /\b(?:have|has|had) (?:you|any of you|each of you|either of you|all of you|you all|you guys|y'?all|anyone|anybody)(?: here)?(?: ever)? (?:been|done|worked|seen|used|gone|tried)\b/i;
// "What do you think?" / "What's your take?": asks the listener's own opinion.
const OPINION_QUESTION_PATTERN = /\bwhat do (?:you|each of you|all of you|you all|you guys|y'?all|any of you) think\b|\bwhat(?:'s| is) your (?:take|opinion|view|read)\b|\bhow do you feel about\b|\bany thoughts\b/i;
// Information only an institution/instruction would supply (schedules, times, who is in charge).
const INSTITUTIONAL_INFO_PATTERN = /\b(?:what time|when (?:do|are|will|should) we|schedule|cutoff|deadline|how long (?:do|will|are|should) we|who(?:'s| is) in charge|departure|leave at)\b/i;
// A fragment that narrows an open clarification ("I mean for the day", "No, the other one").
const REPAIR_FRAGMENT_PATTERN = /^(?:i mean|i meant|no,?\s+(?:i mean|the|that|this|for|after|before)|not that|the other|for (?:the day|today|now)|like,?\s|after\b|before\b|(?:the|that|this|my|your|our)\s|(?:by|near|next to|beside|behind|in front of|under|over by|at|on)\s)/i;
const REPAIR_LEAD_PATTERN = /^(?:i mean|i meant|no,?\s+i mean|no,?|like,?)\s*/i;
// An explicit self-repair of one's own just-answered question ("I mean for the day").
const SELF_REPAIR_LEAD_PATTERN = /^(?:i mean|i meant|no,?\s+i mean(?:t)?)\b/i;
// Canonical events a temporal reference may anchor to. Future gameplay extends this by recording a
// canonical event and adding its phrase here -- never by special-casing dialogue. Most specific first.
const TEMPORAL_ANCHOR_PATTERNS = Object.freeze({
  maxwell_departure: /\b(?:maxwell|kirk|dr\.? maxwell|the doctor) (?:left|leaving|went|departed)\b/i,
  briefing: /\bbriefing\b/i,
  crossing: /\b(?:cross(?:ed|ing)?|threshold|went through|came through)\b/i,
  separation: /\b(?:apart|split up|separated)\b/i
});
// A question about where an item is or who holds it ("Is the camera here?", "Have you seen the radio?").
const CUSTODY_PREDICATE_PATTERN = /\b(?:where|here|with (?:you|me|him|her|them)|who(?:'s| is| has)?|has|have|got|carrying|holding|seen)\b/i;
const BACKGROUND_PATTERN = /\b(?:your (?:background|training|education|trade)|where (?:are|were) you from|what did you (?:study|do) before|where did you (?:train|study)|how did you (?:get into|end up in) (?:this|the field|surveying))\b/i;
const REQUEST_CUE_PATTERN = /\b(?:can|could|would|will) you\b|\bplease\b|\bi need\b|\blet me\b/i;
const HANDOFF_REQUEST_PATTERN = /\b(?:hand|pass|give|bring|transfer)\b/i;
// "Did anyone hear what I just said?" / "Can you hear me?": the player asks whether
// the listeners heard the PLAYER's own words. Deliberately excludes a bare "hear that?"
// (a question about a sound in the world, not about the player's speech).
const HEARD_CONFIRMATION_PATTERN = /\b(?:did|do|does|can|could)\s+(?:anyone|anybody|any\s+of\s+you|everyone|everybody|you(?:\s+(?:guys|all))?|y'?all|someone|somebody|one\s+of\s+you)\s+(?:even\s+|actually\s+|really\s+)?(?:just\s+)?(?:hear|catch|get)\s+(?:what\s+i\s+(?:just\s+)?(?:said|told|say)|me\b|my\s+(?:last|previous)\s+(?:line|statement|message))|\bhear(?:d)?\s+what\s+i\s+(?:just\s+)?(?:said|told)\b|\b(?:you|y'?all|anyone)\s+(?:guys\s+)?hear\s+me\b/i;

// ─── Semantic knowledge intents (Tier 1: structural recognition of question TYPES) ────────────
// Each recognizer is a question form + a predicate class; the entity it is about is resolved by code
// against canonical entities. None of them names an answer. Anything they cannot type confidently is
// left to the bounded advisory interpreter (Tier 2) or to ordinary factual handling.
const LEAD = "^(?:so,?\\s+|and\\s+|but\\s+|well,?\\s*\\.*\\s*|um+,?\\s+|uh+,?\\s+|ok(?:ay)?,?\\s+|alright,?\\s+|hey,?\\s+|ah\\.?\\s+|then,?\\s+)*";
const JOB_NOUN = "(?:job|role|assignment|task|duty|duties|position|responsibilit(?:y|ies)|work|function|part in this|part)";
const POSSESSOR = "(?:your|his|her|their|my|[A-Za-z][a-z]+'s)";
const SEMANTIC_INTENT_PATTERNS = Object.freeze({
  // "What is your (specific) job?", "What do you do (here)?", "What are you supposed to be doing?"
  role_or_assignment: new RegExp(`\\bwhat(?:\\s+exactly)?(?:'s|\\s+is|\\s+are|\\s+was)?\\s+(?:exactly\\s+)?${POSSESSOR}\\s+(?:specific |exact |actual |main |particular |official |own )?${JOB_NOUN}\\b|\\bwhat (?:do|does) (?:you|[A-Z][a-z]+) (?:actually |exactly |even |really |normally |usually )?(?:do|handle|work on)(?:\\s+(?:here|around here|on (?:this|the) team|today|exactly|for (?:work|a living)))?[\\s?!.,]*(?:then|anyway|exactly)?[\\s?!.,]*$|\\bwhat (?:are|is) (?:you|[A-Z][a-z]+) (?:supposed|meant|assigned|scheduled|here) to (?:be )?(?:doing|do|handle|work on)\\b|\\bwhat (?:are|is) (?:you|[A-Z][a-z]+) (?:in charge of|responsible for|assigned to)\\b|\\btell me (?:about|more about) ${POSSESSOR} (?:job|role|work|assignment)\\b`, "i"),
  // "What do we actually do around here?", "What is this place for?", "What does ASYNC do?", "What are we here for?"
  institution_purpose: new RegExp(`\\bwhat(?:'s| is)?(?: it)?(?: that)? (?:(?:do|does) )?(?:we|y'?all|you guys|you all|you people|they|async|a-sync|this (?:place|company|outfit|facility)|the company) (?:actually |really |even |exactly |all |ever )?do\\b(?!\\s+(?:now|next|first|then|after))|\\bwhat(?:'s| is) (?:this place|this company|this outfit|this facility|async|a-sync)(?:\\s+(?:for|about|all about|exactly|anyway))?[\\s?!.]*$|\\bwhat (?:are|am) (?:we|i) (?:(?:even|actually|really) )?(?:here for|doing here)\\b|\\bwhy are we (?:even |all )?here\\b`, "i"),
  // "What are we doing today?", "What's the mission?", "What are we going into the Complex to do today?"
  mission_objective: /\bwhat(?:'s| is| are)? (?:the |our |today's |this )(?:mission|assignment|objective|goal|job today|task today|plan for today)\b|\bwhat (?:are|is) we (?:doing|supposed to (?:be )?do(?:ing)?|here to do) today\b|\bwhat (?:are|is) we (?:going|heading|headed|gonna go) (?:in(?:to)?|to|down) (?:the complex|there|the outpost)\b|\bwhat (?:are|is) we (?:going|gonna) (?:to )?do (?:in |into |down |over )?(?:the complex|there|today)\b|\bwhy are we going (?:in(?:to)?|to|down)\b/i,
  // "Where are we supposed to go next?", "Where are we headed?", "What happens after this?", "What's the next step?"
  next_step: /\bwhere (?:are|do|should|shall|will|am) (?:we|i) (?:supposed to |meant to |going to |gonna |expected to )?(?:go|head|be going|be heading|report)(?: to)?(?:\s+(?:next|now|after this|from here|after that))?\b|\bwhere (?:are we|we're|am i) (?:headed|heading|going|off to)\b|\bwhat happens (?:next|now|after this|after that)\b|\bwhat(?:'s| is) (?:the )?next (?:step|thing|stop)\b|\bwhat(?:'s| is) after this\b|\bwhat do we do (?:next|now|after this|from here)\b|\bwhat now\b/i,
  // "Who is Kirk?", "Who's that Maxwell guy?", "Who was that doctor briefing us?"
  person_identity: new RegExp(`${LEAD}who(?:'s| is| was| were)\\b`, "i"),
  // "What are the startup materials for?", "What are those for?", "Why are you carrying that?"
  assignment_purpose: /\bwhat(?:\s+exactly)?(?:'s|\s+is|\s+are|\s+was|\s+were)\s+(?:exactly\s+|all\s+)?(?:the |that |those |these |this |your |his |her |their |[A-Z][a-z]+'s )?(?:[\w-]+\s+){0,4}?(?:[\w-]+\s+)?for\b[\s?!.]*$|\bwhat (?:do|does|did) (?:you|we|they|[A-Z][a-z]+) need (?:the |that |those |these |this )?(?:[\w-]+\s+){0,3}?for\b|\bwhy (?:are|is|do|does|did) (?:you|we|they|[A-Z][a-z]+) (?:even |still |the one |the one who's )?(?:carrying|delivering|holding|bringing|keeping|recording|doing|compiling|taking|need(?:ing)?|have|got)\b/i,
  // "What is the Threshold?", "What is Standard?", "Where is Equipment Staging?"
  entity_definition: new RegExp(`${LEAD}(?:what(?:'s| is| are)|where(?:'s| is| are)|what exactly is|tell me about)\\s+(?:the |this |that )?[A-Za-z][\\w -]{1,40}?(?:\\s+(?:exactly|anyway|again|then))?[\\s?!.]*$`, "i")
});
// A no-comma leading vocative ("Brady tell me about yourself", "Brady, ..."): the name is followed by an
// addressed clause (imperative, question word, auxiliary + "you"), never by a third-person verb.
const ADDRESSED_CLAUSE = /^(?:tell|give|hand|pass|take|come|look|help|check|wait|stay|show|let|please|what|who|where|when|why|how|which|can you|could you|would you|will you|do you|did you|are you|have you|were you|you)\b/i;

// ─── Conversational pragmatics cues ─────────────────────────────────────────
// Who a prior line is attributed to: "you" (the addressee), "I" (the player), a third-person pronoun or a
// capitalized name. Never resolved here; dialogue-discourse resolves it against heard history.
const SPEAKER_REF = "(you|i|she|he|they|[A-Za-z][a-z'-]+)";
// Quoted or delimited span of earlier wording: "staying with", “staying with”, 'staying with'.
const QUOTED_SPAN_PATTERN = /["“”]\s*([^"“”]+?)\s*["“”]|(?:^|[\s(])'([^']+?)'(?=[\s?!.,)]|$)/;
const PRONOUN_SPAN = /^(?:that|it|this|those|these|(?:that thing |the thing )?(?:what )?(?:you|she|he|they) (?:just )?said(?: earlier| before| just now)?|that thing)$/i;
function quotedSpan(raw) {
  const match = String(raw ?? "").match(QUOTED_SPAN_PATTERN);
  const span = match ? (match[1] ?? match[2]) : null;
  return span ? span.replace(/[?!.,\s]+$/, "").trim() || null : null;
}
const MEANING_FORMS = [
  // "What do you mean by 'staying with'?" / "What did she mean by that?"
  new RegExp(`^(?:so,?\\s+|but\\s+|and\\s+|sorry,?\\s+|wait,?\\s+|okay,?\\s+)?what (?:do|did|does) ${SPEAKER_REF} mean(?:t)?\\s+by\\s+([\\s\\S]+?)[\\s?!.]*$`, "i"),
  // "What did you mean when you said X?"
  new RegExp(`^(?:so,?\\s+|but\\s+|and\\s+|sorry,?\\s+|wait,?\\s+)?what (?:do|did|does) ${SPEAKER_REF} mean(?:t)?,?\\s+when (?:you|i|she|he|they|[A-Za-z][a-z'-]+) (?:said|say|told me|mentioned)(?: that)?,?\\s+([\\s\\S]+?)[\\s?!.]*$`, "i"),
  // "When you said X, what did you mean?"
  new RegExp(`^when ${SPEAKER_REF} (?:said|say|told me|mentioned)(?: that)?,?\\s+([\\s\\S]+?),\\s*what (?:do|did) (?:you|she|he|they|[A-Za-z][a-z'-]+) mean(?:t)?(?: by (?:that|it))?[\\s?!.]*$`, "i"),
  // "What does 'X' mean?" (only with an explicit quotation)
  /^what does\s+(["“'][\s\S]+?["”'])\s+mean[\s?!.]*$/i
];
/**
 * A request for the meaning of earlier wording. Returns { speaker_ref, span } (span null for "that") or
 * null. Only wording that identifies a line (a quotation, a phrase, or a third-person speaker) counts;
 * a bare "What do you mean by that?" stays an explanation request about the preceding line.
 */
function meaningRequest(raw) {
  const text = String(raw ?? "").trim();
  for (const [index, pattern] of MEANING_FORMS.entries()) {
    const match = text.match(pattern);
    if (!match) continue;
    const speakerRef = index === 3 ? "you" : match[1].toLowerCase();
    const rawSpan = index === 3 ? match[1] : match[2];
    const span = quotedSpan(rawSpan) ?? String(rawSpan ?? "").replace(/^["“'\s]+|["”'\s?!.,]+$/g, "").trim();
    const pronoun = !span || PRONOUN_SPAN.test(span);
    // A bare "that/it" about the addressee's own line stays an explanation request ("What do you mean by that?").
    if (pronoun && speakerRef === "you" && (!span || /^(?:that|it|this)$/i.test(span))) return null;
    return Object.freeze({ speaker_ref: speakerRef, span: pronoun ? null : span.slice(0, 200) });
  }
  return null;
}
// "Why didn't you answer me?" / "Why wouldn't you say anything until I addressed you?" / "Why did you
// ignore that?" / "Why did you answer him but not me?" / "Why didn't anyone respond?": a question about a
// recent conversational EVENT (who responded, who stayed silent), never about a line's content.
const RESPONSE_EVENT_PATTERN = /\b(?:why|how come)\b[^?.!]*?\b(?:(?:didn'?t|did not|wouldn'?t|would not|won'?t|will not|weren'?t|was(?:n'?t| not)|haven'?t|hasn'?t|hadn'?t|couldn'?t|could not)\s+(?:you|anyone|anybody|nobody|no one|any of you|either of you|y'?all|you guys|she|he|they|[A-Z][a-z]+)|(?:did|do|are|were|was)\s+(?:you|she|he|they|everyone|everybody|[A-Z][a-z]+)\s+(?:ignor|just ignor)|(?:nobody|no one|none of you)\b)[^?.!]*?\b(?:answer\w*|respond\w*|repl(?:y|ied|ies)|say (?:anything|something|a word|hi|hello|hey)|said (?:anything|something|a word|hi|hello|hey)|talk\w*|speak\w*|acknowledg\w*|greet\w*|ignor\w*|react\w*|responded)\b|\bwhy (?:did|do|are|were) (?:you|she|he|they) (?:ignor\w*|answer\w* (?:him|her|them|[A-Z][a-z]+)(?: but not| and not| instead of) me)\b/i;
// "When I greeted Ava", "when I said hello", "until I addressed you directly": a recent conversational
// event named by what the player did. Groups: the actor, the verb and the remainder (names / quotation).
const EVENT_REFERENCE_PATTERN = /\b(?:when|after|before|until|since) (i|you|we) ((?:first )?(?:said|asked|greeted|told|mentioned|called|spoke|talked|addressed|introduced|introduced myself|said hello|said hi|say|was talking|were talking))\b([^?.!]*)/i;
// Second-person reference to one addressee ("you", "your"), minus fixed expressions that address no one.
const SECOND_PERSON_PATTERN = /\b(?:you|your|yours|yourself)\b/i;
const GENERIC_YOU_PATTERN = /\b(?:you know|you never know|you see|if you ask me|mind you|thank you|you'?d think)\b/gi;
function addressesSecondPerson(raw) {
  return SECOND_PERSON_PATTERN.test(String(raw ?? "").replace(GENERIC_YOU_PATTERN, " "));
}
// Shapes a bare answer to an open question can take (checked against that question's expected slot).
const SLOT_ANSWER_PATTERNS = Object.freeze({
  reason: /^(?:(?:well,?\s+|just\s+)?because|'?cause|cos|cuz|since|so that|so we|in case)\b/i,
  yes_no: /^(?:yes|yeah|yep|yup|no|nope|nah|right|correct|exactly|not really|sort of|kind of|i do|i did|i don'?t|i didn'?t)\b/i,
  location: /^(?:(?:it'?s |it is |it was |over |right |out |up |down |back )?(?:by|near|next to|beside|behind|in front of|under|underneath|over by|at|on|in|inside|outside|across from|past|through|around|toward|towards|against)\s+(?:the|that|this|my|your|our|a|an|his|her|their)\b|(?:over |right |back )?(?:here|there)\b[\s.!?]*$|(?:on |to )?(?:the )?(?:left|right)\b)/i,
  temporal: /^(?:just now|earlier|then|before that|back then|a (?:minute|moment|second|while) ago|at the (?:start|beginning|briefing)|during the briefing|today|this morning|(?:when|after|before|while|until|since)\b)/i
});

// "What recording?" -- a bare noun question (anchored by discourse to a prior line's authorized facts).
// One to three words, a noun phrase only ("What recording?", "Which record?", "What layout record?").
const BARE_NOUN_QUESTION = /^(?:what|which)\s+((?:[a-z-]+\s+){0,2}[a-z-]+)[\s?!.]*$/i;
const NOT_A_NOUN = /\b(?:time|now|next|else|happened|happens|for|is|are|was|were|am|be|do|does|did|about|then|so|if|kind|way|heck|hell|exactly|you|we|they|it|that|this|he|she|i|me|up|going|mean|meant)\b/i;
// "Who was that doctor briefing us?" describes the person by the briefing; "that doctor/guy" alone is a description.
const BRIEFING_PERSON_DESCRIPTION = /\bdoctor\b[^?.!]*\bbrief|\bbrief\w*\b[^?.!]*\bdoctor\b/i;
const PERSON_DESCRIPTION = /\b(?:doctor|guy|man|woman|person|lady|fellow)\b/i;
const WHO_IS_NAME = /\b[Ww]ho(?:'s| is| was)\s+(?:that |this |the )?([A-Z][a-z]+)\b/;

const LANGUAGE_PATTERNS = Object.freeze({
  semantic_intents: SEMANTIC_INTENT_PATTERNS,
  bare_noun_question: BARE_NOUN_QUESTION,
  not_a_noun: NOT_A_NOUN,
  briefing_person_description: BRIEFING_PERSON_DESCRIPTION,
  person_description: PERSON_DESCRIPTION,
  who_is_name: WHO_IS_NAME,
  response_event: RESPONSE_EVENT_PATTERN,
  event_reference: EVENT_REFERENCE_PATTERN,
  slot_answers: SLOT_ANSWER_PATTERNS,
  invite_self_description: INVITE_SELF_DESCRIPTION_PATTERN,
  repetition_request: REPETITION_REQUEST_PATTERNS,
  bare_reaction: BARE_REACTION_PATTERNS,
  ambiguous_reference: null, // assigned below (defined after this block)
  item_ownership: ITEM_OWNERSHIP_PATTERN,
  item_noun: ITEM_NOUN_PATTERN,
  role_or_assignment: ROLE_OR_ASSIGNMENT_PATTERN,
  close_topic: CLOSE_TOPIC_PATTERN,
  challenge: CHALLENGE_PATTERN,
  check_in: CHECK_IN_PATTERN,
  background: BACKGROUND_PATTERN,
  request_cue: REQUEST_CUE_PATTERN,
  handoff_request: HANDOFF_REQUEST_PATTERN,
  heard_confirmation: HEARD_CONFIRMATION_PATTERN,
  addressee_readiness: ADDRESSEE_READINESS_PATTERN,
  not_momentary_state: NOT_MOMENTARY_STATE_PATTERN,
  order_imperative: ORDER_IMPERATIVE_PATTERN,
  deictic_object: DEICTIC_OBJECT_PATTERN,
  bare_demonstrative: BARE_DEMONSTRATIVE_PATTERN,
  item_anaphor: ITEM_ANAPHOR_PATTERN,
  temporal_reference: TEMPORAL_REFERENCE_PATTERN,
  past_perception: PAST_PERCEPTION_PATTERN,
  about_addressee: ABOUT_ADDRESSEE_PATTERN,
  custody_predicate: CUSTODY_PREDICATE_PATTERN,
  question_like: QUESTION_LIKE_PATTERN,
  take_grab: TAKE_GRAB_PATTERN,
  temporal_anchors: TEMPORAL_ANCHOR_PATTERNS,
  next_step: NEXT_STEP_PATTERN,
  explanation_request: EXPLANATION_REQUEST_PATTERN,
  repair_fragment: REPAIR_FRAGMENT_PATTERN,
  repair_lead: REPAIR_LEAD_PATTERN,
  self_repair_lead: SELF_REPAIR_LEAD_PATTERN,
  bare_wh_followup: BARE_WH_FOLLOWUP_PATTERN,
  discourse_marker: DISCOURSE_MARKER_PATTERN,
  topic_return: TOPIC_RETURN_PATTERN,
  topic_return_generic: TOPIC_RETURN_GENERIC_PATTERN,
  opinion_question: OPINION_QUESTION_PATTERN,
  personal_experience: PERSONAL_EXPERIENCE_PATTERN,
  institutional_info: INSTITUTIONAL_INFO_PATTERN,
  self_state_affect_terms: SELF_STATE_AFFECT_TERMS
});

const GROUP_VOCATIVES = Object.freeze(["team", "teammate", "teammates", "all", "everyone", "everybody", "broadcast", "room", "local", "anyone", "crew", "table", "group"]);

/**
 * THE named-address parser. Live interpretation, recipient resolution and
 * prior-turn reconstruction all use it. It never mutates stored text; it
 * returns the residual utterance that interpretation must see.
 *
 * Forms: "Nora, what?"  "Nora: what?"  "@Nora what?"  "@Nora, what?"  and a
 * UI-selected target (explicit_target) with or without a repeated vocative.
 * A vocative naming someone OTHER than the explicit target is not stripped
 * (explicit-target precedence is never weakened).
 *
 * @param {string} text
 * @param {{ explicit_target?: string|null, is_known?: (name:string)=>boolean, resolve_id?: (name:string)=>string|null }} opts
 * @returns {{ explicit_target_id, explicit_target_name, residual_text, address_type, source }}
 */
function parseNamedAddress(text, { explicit_target = null, is_known = () => false, resolve_id = () => null, name_tokens = [] } = {}) {
  const raw = String(text ?? "").trim();
  const chipWords = explicit_target ? String(explicit_target).replace(/^@/, "").toLowerCase().split(/\s+/) : null;
  const targetTokens = chipWords ? [...chipWords, ...name_tokens.map((t) => String(t).toLowerCase())] : [];
  // A bare "@Nora can you…" mention may consume only tokens that belong to the
  // selected target's name; a delimited vocative ("Nora Vance: …") may also carry
  // extra name words because the delimiter already ends the address.
  const acceptable = (name, { delimited = false } = {}) => {
    const words = name.toLowerCase().split(/\s+/);
    if (chipWords) return words.every((w) => targetTokens.includes(w)) || (delimited && chipWords.every((w) => words.includes(w)));
    return GROUP_VOCATIVES.includes(name.toLowerCase()) || is_known(name);
  };
  const done = (name, residual, source) => {
    const group = GROUP_VOCATIVES.includes(String(name).toLowerCase());
    return { explicit_target_id: group ? null : resolve_id(name), explicit_target_name: name, residual_text: residual, address_type: group ? "group" : "direct", source };
  };
  const none = () => (explicit_target
    ? { explicit_target_id: resolve_id(explicit_target), explicit_target_name: explicit_target, residual_text: raw, address_type: GROUP_VOCATIVES.includes(String(explicit_target).toLowerCase()) ? "group" : "direct", source: "chip" }
    : { explicit_target_id: null, explicit_target_name: null, residual_text: raw, address_type: "none", source: "none" });

  const punct = raw.match(/^@?([A-Za-z0-9'-]+(?:\s+[A-Za-z0-9'-]+)?)\s*[,:]\s*([\s\S]+)$/);
  if (punct && acceptable(punct[1].trim(), { delimited: true })) return done(explicit_target ?? punct[1].trim(), punct[2].trim(), explicit_target ? "chip" : "vocative");
  if (raw.startsWith("@")) {
    const tokens = raw.slice(1).trim().split(/\s+/);
    for (const k of [2, 1]) {
      if (tokens.length <= k) continue;
      const name = tokens.slice(0, k).join(" ");
      if (acceptable(name)) return done(explicit_target ?? name, tokens.slice(k).join(" "), explicit_target ? "chip" : "mention");
    }
  }
  return none();
}

// Group terms that may stand in an addressee LIST ("Hey guys", "Ava and everyone, ...").
const LIST_GROUP_TERMS = Object.freeze([...GROUP_VOCATIVES, "guys", "folks", "gang", "y'all", "yall", "you all", "you guys", "you two", "you both", "both of you", "all of you"]);
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * THE addressee-SET parser: who the player's words address, from sentence structure only (vocative
 * position, greeting structure, trailing vocative, @mentions), never from a name merely mentioned
 * ("Ava told me Roy has the camera" addresses no one). `names` lists known personnel names
 * ({ name, id } -- id null for someone who is not a coworker). Returns the legacy parseNamedAddress
 * shape plus the addressed set:
 *   address_type  "direct" | "subset" | "group" | "none"
 *   addressee_ids / addressee_names  in the order the player named them
 *   address_form  "leading_vocative" | "greeting" | "trailing_vocative" | "mention" | "chip" | "none"
 * An explicit (UI-selected) target keeps precedence: a spoken list widens it to a set only when the
 * list itself names that target.
 */
function parseAddressees(text, { explicit_target = null, names = [], is_known = null, resolve_id = null, name_tokens = [] } = {}) {
  const raw = String(text ?? "").trim();
  const index = new Map();
  for (const entry of names ?? []) if (entry?.name) index.set(String(entry.name).toLowerCase(), entry.id ?? null);
  const known = is_known ?? ((name) => index.has(String(name).toLowerCase()));
  const idOf = resolve_id ?? ((name) => index.get(String(name).toLowerCase()) ?? null);
  const legacy = parseNamedAddress(raw, { explicit_target, is_known: known, resolve_id: idOf, name_tokens });
  const withSet = (result, form) => ({ ...result, addressee_ids: result.address_type === "direct" && result.explicit_target_id ? [result.explicit_target_id] : [], addressee_names: result.address_type === "direct" && result.explicit_target_name ? [result.explicit_target_name] : [], address_form: form });

  const alternatives = [...new Set([...index.keys(), ...LIST_GROUP_TERMS])].sort((a, b) => b.length - a.length).map(escapeRe);
  if (!alternatives.length) return withSet(legacy, legacy.source === "none" ? "none" : legacy.source === "chip" ? "chip" : legacy.source === "mention" ? "mention" : "leading_vocative");
  const NAME = `@?(?:${alternatives.join("|")})(?![\\w'])`;
  const LIST = `${NAME}(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${NAME})*`;
  const forms = [
    ["mention", new RegExp(`^(@(?:${alternatives.join("|")})(?![\\w'])(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*|\\s+)@(?:${alternatives.join("|")})(?![\\w']))+)\\s*[,:]?\\s*([\\s\\S]*\\S[\\s\\S]*)$`, "i"), (m) => ({ list: m[1].replace(/\s+@/g, ", @"), residual: m[2].trim() })],
    ["greeting", new RegExp(`^(${GREETING_HEAD})[\\s,]+(${LIST})\\s*(?:[,.!?;:-]+\\s*([\\s\\S]*))?$`, "i"), (m) => ({ list: m[2], residual: (m[3] ?? "").trim() || m[1] })],
    ["leading_vocative", new RegExp(`^(${LIST})\\s*[,:]\\s*([\\s\\S]*\\S[\\s\\S]*)$`, "i"), (m) => ({ list: m[1], residual: m[2].trim() })],
    // "Brady tell me about yourself": no delimiter, but the name is followed by an addressed clause.
    ["leading_vocative", new RegExp(`^(${NAME})\\s+([\\s\\S]*\\S[\\s\\S]*)$`, "i"), (m) => (ADDRESSED_CLAUSE.test(m[2]) ? { list: m[1], residual: m[2].trim() } : { list: "", residual: "" })],
    ["trailing_vocative", new RegExp(`^([\\s\\S]*?[^\\s,])\\s*,\\s*(${LIST})\\s*([?!.]*)\\s*$`, "i"), (m) => ({ list: m[2], residual: `${m[1].trim()}${m[3] ?? ""}` })]
  ];
  let parsed = null;
  for (const [form, pattern, pick] of forms) {
    const match = raw.match(pattern);
    if (!match) continue;
    const { list, residual } = pick(match);
    if (!list) continue;
    const items = list.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\s*/i).map((item) => item.replace(/^@/, "").trim()).filter(Boolean);
    if (!items.length || !items.every((item) => LIST_GROUP_TERMS.includes(item.toLowerCase()) || known(item))) continue;
    parsed = { form, items, residual };
    break;
  }
  if (!parsed) return withSet(legacy, legacy.source === "none" ? "none" : legacy.source === "chip" ? "chip" : legacy.source === "mention" ? "mention" : "leading_vocative");

  const group = parsed.items.some((item) => LIST_GROUP_TERMS.includes(item.toLowerCase()));
  const resolved = [];
  for (const item of parsed.items) {
    if (LIST_GROUP_TERMS.includes(item.toLowerCase())) continue;
    const id = idOf(item);
    if (id && !resolved.some((entry) => entry.id === id)) resolved.push({ id, name: item });
  }
  const chipId = explicit_target ? idOf(String(explicit_target).replace(/^@/, "")) : null;
  if (explicit_target) {
    // The spoken list widens the selected target only when it names that target.
    if (!group && chipId && resolved.length > 1 && resolved.some((entry) => entry.id === chipId)) {
      return { explicit_target_id: null, explicit_target_name: null, residual_text: parsed.residual, address_type: "subset", source: "chip", addressee_ids: resolved.map((e) => e.id), addressee_names: resolved.map((e) => e.name), address_form: parsed.form };
    }
    return withSet(legacy, "chip");
  }
  if (group) return { explicit_target_id: null, explicit_target_name: parsed.items.find((item) => LIST_GROUP_TERMS.includes(item.toLowerCase())), residual_text: parsed.residual, address_type: "group", source: "vocative", addressee_ids: [], addressee_names: [], address_form: parsed.form };
  if (resolved.length > 1) return { explicit_target_id: null, explicit_target_name: null, residual_text: parsed.residual, address_type: "subset", source: "vocative", addressee_ids: resolved.map((e) => e.id), addressee_names: resolved.map((e) => e.name), address_form: parsed.form };
  // One person (or one known name that is not a coworker: the caller reports that person's availability).
  const single = resolved[0] ?? { id: null, name: parsed.items[0] };
  return { explicit_target_id: single.id, explicit_target_name: single.name, residual_text: parsed.residual, address_type: "direct", source: "vocative", addressee_ids: single.id ? [single.id] : [], addressee_names: [single.name], address_form: parsed.form };
}

/** Compatibility wrapper: residual text for an already-resolved explicit target. */
function stripNamedAddress(text, target = null) {
  if (!target) return String(text ?? "").trim();
  return parseNamedAddress(text, { explicit_target: target }).residual_text;
}

// Group address in language. Plural address phrases count anywhere; a bare group NOUN ("table", "team",
// "all", "crew", "folks") counts only as an address: an @mention, a leading/trailing vocative or after a
// greeting -- never as an ordinary word ("By the table.", "Is that all?", "the team is ready").
const GROUP_ADDRESS_PHRASES = /(?:^|\b)(?:everyone|everybody|anybody|anyone|does anyone|you all|all of you|any of you|each of you|either of you|both of you|yourselves|you guys|you folks|y'all)(?:\b|$)/i;
const GROUP_NOUN = "(?:table|team|all|crew|teammates?|folks|group|guys)";
const GROUP_NOUN_ADDRESS = new RegExp(`@${GROUP_NOUN}\\b|^${GROUP_NOUN}\\s*[,:!]|,\\s*${GROUP_NOUN}\\s*[?!.]*\\s*$|^${GREETING_HEAD}[\\s,]+${GROUP_NOUN}\\b`, "i");
const GROUP_ADDRESS_PATTERNS = { test: (text) => GROUP_ADDRESS_PHRASES.test(String(text ?? "")) || GROUP_NOUN_ADDRESS.test(String(text ?? "").trim()) };
const GROUP_GREETING_PATTERNS = new RegExp(`^${GREETING_HEAD}[\\s,!-]+${GREETING_VOCATIVE}[\\s!.,?]*$`, "i");
const AMBIGUOUS_REFERENCE_PATTERNS = /\b(?:the thing|that thing|do the thing|over there|you know what|whatever it is|that stuff)\b/i;
// wire the late-defined pattern into the shared table
const SOCIAL_UNTARGETED_PATTERNS = /\b(?:i(?:'m| am) (?:so )?(?:tired|exhausted|beat)|fuck,? i(?:'m| am) tired|this sucks|long day|long morning)\b/i;

/**
 * Resolves only the player-supplied language signal for LOCAL routing. Physical
 * eligibility and exact personnel identities remain the caller's authority.
 */
function inferLocalRecipientType(text, { explicitTarget = null } = {}) {
  if (explicitTarget) return "direct";
  return GROUP_ADDRESS_PATTERNS.test(String(text ?? "").trim()) ? "group" : "none";
}

// ─── Topic detection ────────────────────────────────────────────────────────
function detectTopic(text) {
  const t = text.toLowerCase();
  if (/\bhow(?:'s| is| are) (?:everyone|everybody|you all|all of you) (?:doing|feeling)\b/.test(t)) return "social";
  if (/\b(?:cutoff|noon|departure|schedule|clock|hours?|time)\b/.test(t) || /1[:\s]?00/.test(t) || /\bby one\b/.test(t) || /\bback by\b/.test(t)) return "time_or_schedule";
  if (/\b(?:tape|route|path|outpost|corridor|passage|arrows?|guidance|direction|where to go)\b/.test(t)) return "route_or_navigation";
  if (/\b(?:camera|spectrometer|survey.?instrument|duffle|radio|flashlight|equipment|gear|kit|bag|manifest|carry|carrying|holding)\b/.test(t)) return "equipment";
  if (/\b(?:team|coworker|teammate|who is|who are|personnel|crew|member|roster)\b/.test(t)) return "team_or_roster";
  if (/\b(?:outpost a?|mission|objective|duffle|startup|what are we doing|the job)\b/.test(t)) return "mission_objective";
  if (/\b(?:been in there|first time|before|experience|nervous|claustrophobic|afraid|worried|prefer)\b/.test(t)) return "personal_experience";
  if (/\b(?:get along|trust|rapport|like|annoying|friendly|awkward)\b/.test(t)) return "relationship";
  if (/\b(?:danger|hazard|risk|careful|safe|unsafe|warning|look out)\b/.test(t)) return "safety_or_risk";
  if (/\b(?:room|threshold|kv31|facility|complex|upstairs|downstairs|here|this place)\b/.test(t)) return "location_or_space";
  if (/\b(?:hey|hi|hello|morning|good to|nice to|pleasure|meet you)\b/.test(t)) return "social";
  return "unknown";
}

// ─── Tone detection (light) ──────────────────────────────────────────────
function detectTone(text, speechAct) {
  if (speechAct === "joke_or_sarcasm") return "sarcastic";
  if (speechAct === "warning") return "urgent";
  if (speechAct === "greeting" || speechAct === "introduction") return "friendly";
  if (speechAct === "uncertainty") return "uncertain";
  if (/[!]{2,}/.test(text)) return "emphatic";
  if (/\bplease\b/i.test(text)) return "polite";
  return "neutral";
}

// ─── Core deterministic parse ────────────────────────────────────────────
/**
 * Deterministically classifies a player utterance for dialogue routing.
 * Returns a bounded interpretation object. Does not mutate any state.
 *
 * @param {string} text - Raw player utterance (pre-trimmed by caller)
 * @param {{ isGroup?: boolean }} opts
 * @returns {{ version, speech_act, topic, tone, literal_question, confidence }}
 */
const UNINTELLIGIBLE_EXEMPT = /^(?:what|where|who|when|why|how|which|is|are|do|does|did|can|could|will|would|have|has|should|was|were|anyone|anybody|ready|okay|ok|right|good|fine|nervous|tired|scared|afraid|alone|safe|clear|done|sure|well|cold|hungry|worried|tense|calm)\b/i;

function interpretUtterance(text, { isGroup = false } = {}) {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return make("ambiguous", "unknown", "neutral", false, 0.0);
  }

  const looksQuestion = raw.endsWith("?") ||
    /^(?:what|where|who|when|why|how|can you|could you|do you|is there|are there|will you|have you|did you|does)\b/i.test(raw);

  const groupAddress = isGroup || GROUP_ADDRESS_PATTERNS.test(raw);

  // Bare reactive follow-ups ("What?", "Huh?", "Sorry?") are conversational
  // clarification, not a factual mission question -- classify them as
  // low-confidence ambiguous before any question/group-question branch can
  // claim them. Recipient scope (who this inherits from) is resolved by the
  // caller, not here; this module only judges the language.
  if (BARE_REACTION_PATTERNS.test(raw) || REPETITION_REQUEST_PATTERNS.test(raw)) {
    return make("ambiguous", "unknown", "uncertain", looksQuestion, 0.4);
  }

  // Unresolved ambiguous reference ("the thing by the thing") is a language
  // property of the utterance itself, independent of whether it was addressed
  // to the group or to one person -- gating this on groupAddress let a
  // direct/untargeted ambiguous reference fall through to unrelated
  // classifiers (e.g. matching PERSONAL_QUESTION_PATTERNS on "you know...")
  // and fabricate an answer instead of asking for clarification.
  if (AMBIGUOUS_REFERENCE_PATTERNS.test(raw)) {
    return make("ambiguous", detectTopic(raw), "uncertain", looksQuestion, 0.72);
  }

  // Sarcasm check before literal question (overrides question classification)
  if (SARCASM_PATTERNS.some((p) => p.test(raw))) {
    return make("joke_or_sarcasm", detectTopic(raw), "sarcastic", false, 0.88);
  }

  // Warning
  if (WARNING_PATTERNS.test(raw)) {
    return make("warning", "safety_or_risk", "urgent", false, 0.95);
  }

  if (groupAddress && GROUP_GREETING_PATTERNS.test(raw)) {
    return make("greeting", "social", "friendly", false, 0.97);
  }

  if (groupAddress && looksQuestion) {
    return make("group_question", detectTopic(raw), "neutral", true, 0.93);
  }

  // Greeting (standalone)
  if (GREETING_PATTERNS.test(raw)) {
    return make("greeting", "social", "friendly", false, 0.97);
  }

  // Introduction
  if (INTRODUCTION_PATTERNS.test(raw) && !looksQuestion) {
    return make("introduction", "social", "friendly", false, 0.92);
  }

  // Acknowledgment (standalone)
  if (ACKNOWLEDGMENT_PATTERNS.test(raw)) {
    return make("acknowledgment", "social", "neutral", false, 0.97);
  }

  // Uncertainty statement
  if (UNCERTAINTY_PATTERNS.test(raw) && !looksQuestion) {
    return make("uncertainty", detectTopic(raw), "uncertain", false, 0.85);
  }

  // Social observation ("you look nervous", "this seems safe")
  if (SOCIAL_OBSERVATION_PATTERNS.some((p) => p.test(raw)) && !looksQuestion) {
    return make("social_observation", detectTopic(raw), "neutral", false, 0.88);
  }

  // Personal question ("have you been in there before?")
  if (looksQuestion && PERSONAL_QUESTION_PATTERNS.some((p) => p.test(raw))) {
    return make("personal_question", detectTopic(raw), "neutral", true, 0.85);
  }

  // Factual question
  if (looksQuestion && FACTUAL_QUESTION_PATTERNS.some((p) => p.test(raw))) {
    return make("factual_question", detectTopic(raw), "neutral", true, 0.82);
  }

  // A one/two-word "question" that names nothing recognizable ("Blorp?") is
  // unintelligible: ask for clarification rather than answer a guessed meaning.
  if (looksQuestion && !UNINTELLIGIBLE_EXEMPT.test(raw) && (raw.match(/[A-Za-z']+/g) ?? []).length <= 2) {
    return make("ambiguous", "unknown", "uncertain", true, 0.45);
  }

  // Generic question not matched above
  if (looksQuestion) {
    return make("factual_question", detectTopic(raw), "neutral", true, 0.65);
  }

  // Request
  if (REQUEST_PATTERNS.test(raw)) {
    return make("request", detectTopic(raw), "polite", false, 0.87);
  }

  // Default: statement (declarative sentence)
  return make("statement", detectTopic(raw), "neutral", false, 0.70);
}

/**
 * Beat-scoped deterministic social response policy. Candidates MUST already be
 * ordered by canonical team order and filtered to personnel who heard the line.
 * The model never participates in this decision.
 */
// Questions whose answer belongs to each listener personally (never a shared fact).
const INDIVIDUAL_ANSWER_FUNCTIONS = new Set(["ask_personal_experience", "ask_opinion", "ask_role_or_assignment"]);
function resolveResponseOwners({ recipient_type, interpretation, player_text, candidates = [], frame = null } = {}) {
  const eligible = candidates.filter((candidate) => candidate?.response_eligible && candidate?.id);
  if (recipient_type === "direct") return eligible.slice(0, 1).map((candidate) => candidate.id);
  if (eligible.length === 0) return [];

  const act = interpretation?.speech_act ?? "ambiguous";
  const topic = interpretation?.topic ?? "unknown";
  const text = String(player_text ?? "");

  // Discourse-function ownership (ED-1). Consumes the deterministic frame; it
  // never widens beyond the already-eligible candidates.
  const fn = frame?.discourse_function ?? null;
  if (fn === "ask_heard_confirmation") {
    // One listener who actually heard the line confirms it; never a chorus.
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  if (fn === "invite_self_description") {
    // Fan-out only for GROUP scope; an untargeted singular "yourself" is
    // answered by one listener, never by everyone.
    return recipient_type === "group" ? eligible.map((candidate) => candidate.id) : eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  if (fn === "ask_item_ownership") {
    // Holder-only when the referent resolves uniquely; an ambiguous or
    // unmatched item has no ownership responder (direct scope is handled above).
    const ref = (frame.referents ?? []).find((item) => item.type === "equipment");
    if (!ref?.resolved || !ref.holder) return [];
    const holder = eligible.filter((candidate) => candidate.id === ref.holder).slice(0, 1);
    // A holder who is not a present coworker (the player, or someone away) is
    // named by one deterministic listener instead of leaving the question unanswered.
    return (holder.length ? holder : eligible.slice(0, 1)).map((candidate) => candidate.id);
  }
  // A question about each listener's OWN feeling asked of the group ("Are you all excited?") has an
  // inherently individual answer: every eligible present listener gets one, like a group greeting.
  // Asked of the room at no one ("Excited?"), one listener answers.
  if (fn === "check_in") return recipient_type === "group" ? eligible.map((candidate) => candidate.id) : eligible.slice(0, 1).map((candidate) => candidate.id);
  // "Ava, Josephine, you ready?": readiness is each addressee's own momentary state.
  if (frame?.addressee_state && recipient_type === "group" && !frame?.resumed_question) return eligible.map((candidate) => candidate.id);
  // "What do you mean by 'X'?" is answered by whoever said the line (their own speech), when they heard it.
  if (fn === "ask_meaning" && frame?.antecedent?.resolved) {
    const speaker = eligible.find((candidate) => (frame.antecedent.responder_ids ?? []).includes(candidate.id));
    return [(speaker ?? eligible[0]).id];
  }
  // Knowledge questions (who someone is, what an assignment is for, what today is about): the person asked
  // about answers for themselves; an assignment/item question goes to the one whose assignment it is;
  // otherwise ONE spokesperson who canonically knows it (never a chorus of the same fact).
  const knowledgeQuestion = ["ask_institution_purpose", "ask_mission_objective", "ask_person_identity", "ask_assignment_purpose", "ask_entity_definition"].includes(fn) || (fn === "ask_role_or_assignment" && frame?.knowledge_query?.subject && frame.knowledge_query.subject !== "addressee");
  if (knowledgeQuestion && !frame?.resumed_question) {
    const about = frame?.knowledge_query?.entity?.id ?? null;
    const selfAnswer = eligible.find((candidate) => candidate.id === about);
    if (selfAnswer && ["ask_person_identity", "ask_role_or_assignment"].includes(fn)) return [selfAnswer.id];
    const owner = fn === "ask_assignment_purpose" ? eligible.find((candidate) => candidate.owns_entity) : null;
    if (owner) return [owner.id];
    return [(eligible.find((candidate) => candidate.has_relevant_knowledge) ?? eligible[0]).id];
  }
  // "Why didn't you (all) answer?": each addressed listener accounts for their own part; asked of the room,
  // one listener answers.
  if (fn === "ask_response_event") return recipient_type === "group" ? eligible.map((candidate) => candidate.id) : eligible.slice(0, 1).map((candidate) => candidate.id);
  // Other questions whose answer is each listener's own (experience, opinion, role) are answered by each
  // listener when the group is addressed; otherwise by one.
  if (INDIVIDUAL_ANSWER_FUNCTIONS.has(fn) && !frame?.resumed_question) return recipient_type === "group" ? eligible.map((candidate) => candidate.id) : [(eligible.find((candidate) => candidate.has_relevant_knowledge) ?? eligible[0]).id];
  // A requested action is acknowledged by the one asked to act (if present and eligible), else one listener.
  if (fn === "make_request" && frame?.requested_action) {
    const actor = eligible.find((candidate) => candidate.id === frame.requested_action.actor_id);
    return [(actor ?? eligible[0]).id];
  }
  // Answering a clarification: the one who asked it answers the now-narrowed question.
  const clarifiers = new Set(frame?.resumed_question?.responder_ids ?? []);
  if (clarifiers.size && fn !== "ask_item_ownership") {
    const clarifier = eligible.find((candidate) => clarifiers.has(candidate.id));
    if (clarifier) return [clarifier.id];
  }
  // "What's next?" is shared procedural knowledge: one speaker who knows it (spokesperson), never a chorus.
  if (fn === "ask_next_step") {
    const knower = eligible.find((candidate) => candidate.has_relevant_knowledge) ?? eligible[0];
    return [knower.id];
  }
  // "Why?" is answered by whoever said the line being questioned (first in canonical order).
  if (fn === "ask_explanation" && !frame?.unresolved_reference) {
    const said = new Set(frame.antecedent?.responder_ids ?? []);
    const speaker = eligible.find((candidate) => said.has(candidate.id));
    return speaker ? [speaker.id] : [];
  }
  if ((fn === "clarify_previous" || fn === "request_repetition") && !frame?.unresolved_reference) {
    // The people who spoke in the preceding exchange own its clarification;
    // the first of them (canonical order) answers. If none remain eligible,
    // the normal scope rules below decide.
    const last = new Set(frame.antecedent?.responder_ids ?? []);
    const prior = eligible.find((candidate) => last.has(candidate.id));
    if (prior) return [prior.id];
  }

  // Deterministic relevance/knowledge preference: when the utterance is a
  // genuine question and a candidate's already-computed known facts / held
  // equipment make them the relevant knower (has_relevant_knowledge, set by
  // the caller from canonical facts -- never guessed here), that candidate
  // owns the response instead of whoever happens to be first in team order.
  // Applies regardless of recipient scope so an untargeted factual question
  // does not default to "first eligible teammate". If nobody has relevant
  // knowledge this has no effect -- the normal scope-specific rules below
  // decide, and no expert is invented.
  if ((act === "factual_question" || act === "group_question") && eligible.some((candidate) => candidate.has_relevant_knowledge)) {
    return eligible.filter((candidate) => candidate.has_relevant_knowledge).map((candidate) => candidate.id);
  }

  if (recipient_type === "group") {
    if (act === "greeting") return eligible.map((candidate) => candidate.id);
    if (act === "group_question" && topic === "social" && /\b(?:everyone|everybody|you all|all of you)\b/i.test(text)) {
      return eligible.map((candidate) => candidate.id);
    }
    if (act === "group_question") return eligible.slice(0, 1).map((candidate) => candidate.id);
    if (act === "joke_or_sarcasm") return eligible.slice(0, 2).map((candidate) => candidate.id);
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }

  if (["warning", "uncertainty", "joke_or_sarcasm", "social_observation", "factual_question", "personal_question", "request", "ambiguous", "greeting", "introduction"].includes(act)) {
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  if (act === "statement" && SOCIAL_UNTARGETED_PATTERNS.test(text)) {
    return eligible.slice(0, 1).map((candidate) => candidate.id);
  }
  return [];
}

const LANGUAGE_PATTERNS_FULL = Object.freeze({ ...LANGUAGE_PATTERNS, ambiguous_reference: AMBIGUOUS_REFERENCE_PATTERNS });

function make(speech_act, topic, tone, literal_question, confidence) {
  return Object.freeze({
    version: INTERPRETATION_VERSION,
    speech_act,
    topic,
    tone,
    literal_question: Boolean(literal_question),
    confidence
  });
}

// ─── Response-purpose resolution ──────────────────────────────────────────
/**
 * Maps a bounded interpretation to a deterministic response purpose.
 * This is the authoritative text that enters the wordsmith packet.
 * The AI model must not decide what kind of response to produce.
 *
 * @param {object} interpretation - from interpretUtterance()
 * @param {string} reactionCategory - from personnelContinuity.react() ("acknowledgment"|"question"|"warning"|"uncertainty")
 * @returns {string} response_purpose
 */
function resolveResponsePurpose(interpretation, reactionCategory) {
  const act = interpretation?.speech_act ?? "ambiguous";
  // Reaction category is an additional signal from the continuity system but
  // the speech act is the primary driver — prevents every question from
  // becoming a FAQ lookup.
  switch (act) {
    case "factual_question":
      // Only offer factual recall for genuinely operational queries
      return "acknowledge the question, then supply the single most relevant established fact from supplied known_facts if one is clearly applicable; otherwise ask for clarification";
    case "personal_question":
      return "answer using only facts from your supplied personal memories and experience; if none apply, say so honestly without inventing";
    case "social_observation":
      return "respond naturally to the social observation; do not convert it into an information exchange";
    case "joke_or_sarcasm":
      return "acknowledge socially — brief wry or dry response; do not treat as literal question or factual request";
    case "introduction":
      return "acknowledge the introduction appropriately; keep it brief and in character";
    case "greeting":
      return "return the greeting naturally and briefly";
    case "acknowledgment":
      return "acknowledge in kind; one short phrase is sufficient";
    case "request":
      // Requests are handled deterministically in the equipment-handoff path;
      // if it reaches wordsmithing it means a social/verbal request.
      return "respond to the request in character — confirm, decline, or ask for clarification based on your supplied context";
    case "warning":
      return "acknowledge the warning with urgency; do not add unrelated facts";
    case "uncertainty":
      return "acknowledge the uncertainty; share your own uncertainty if applicable; do not resolve with invented facts";
    case "statement":
      return "respond conversationally if a response is warranted; one or two sentences; do not convert statement into an interrogation";
    case "group_question":
      return interpretation?.topic === "social"
        ? "answer the social check-in briefly for yourself; do not speak for coworkers or introduce operational facts"
        : "answer only for yourself using supplied known_facts and held equipment; keep the answer brief and do not speak for coworkers";
    case "ambiguous":
    default:
      return "respond to the player's confusion or reaction to the immediately preceding exchange; clarify naturally if possible; do not volunteer unrelated task help or unrequested mission facts";
  }
}

// ─── Relevance filter ──────────────────────────────────────────────────────
/**
 * Selects memories and facts relevant to this utterance and speech act.
 * Conservative: returns fewer items rather than dumping everything.
 *
 * @param {object} interpretation - from interpretUtterance()
 * @param {Array}  memories        - already pre-filtered by retrieveRelevantMemories()
 * @param {Array}  knownFacts      - raw known_information items from member
 * @returns {{ relevant_memories, relevant_facts, forbidden_topics }}
 */
function selectRelevantContext(interpretation, memories = [], knownFacts = []) {
  const act = interpretation?.speech_act ?? "ambiguous";
  const topic = interpretation?.topic ?? "unknown";

  // Topics that are NEVER relevant for social/personal speech acts
  const SOCIAL_FORBIDDEN = new Set([
    "time_or_schedule", "route_or_navigation", "mission_objective"
  ]);
  // Topics always relevant regardless of speech act
  const ALWAYS_RELEVANT = new Set([
    "safety_or_risk"
  ]);

  // Determine which facts to surface
  let relevant_facts = [];
  let forbidden_topics = [];

  if (act === "personal_question") {
    // Personal questions: only personal-experience memories
    relevant_facts = knownFacts.filter((f) => {
      const text = String(f.text ?? "").toLowerCase();
      return /\b(?:been|experience|first|before|nervous|claustrophobic|prefer|afraid|worked)\b/.test(text);
    });
    forbidden_topics = ["time_or_schedule", "route_or_navigation", "team_or_roster", "mission_objective", "equipment"];
  } else if (act === "social_observation" || act === "joke_or_sarcasm" || act === "greeting" || act === "introduction" || act === "acknowledgment") {
    // Pure social — no factual context at all
    relevant_facts = knownFacts.filter((f) => ALWAYS_RELEVANT.has(detectTopic(String(f.text ?? ""))));
    forbidden_topics = [...SOCIAL_FORBIDDEN, "equipment", "team_or_roster"];
  } else if (act === "factual_question" || act === "group_question") {
    if (act === "factual_question" && topic === "unknown") {
      // Topic not detected — cannot meaningfully filter by subject.
      // Pass all available facts so the model can answer from whatever it
      // legitimately knows, rather than suppressing everything because no
      // topic matched. forbidden_topics is empty: no specific topic to protect.
      relevant_facts = knownFacts;
      forbidden_topics = [];
    } else {
      // Recognized topic: filter facts to topic match + always-relevant.
      relevant_facts = knownFacts.filter((f) => {
        const fTopic = detectTopic(String(f.text ?? ""));
        return fTopic === topic || ALWAYS_RELEVANT.has(fTopic);
      });
      forbidden_topics = Object.keys(
        Object.fromEntries(
          TOPICS.filter((t) => t !== topic && !ALWAYS_RELEVANT.has(t) && t !== "unknown").map((t) => [t, 1])
        )
      );
    }
  } else if (act === "statement" || act === "uncertainty") {
    // Statements: only facts directly matching topic
    relevant_facts = knownFacts.filter((f) => {
      const fTopic = detectTopic(String(f.text ?? ""));
      return fTopic === topic || ALWAYS_RELEVANT.has(fTopic);
    });
    forbidden_topics = [...SOCIAL_FORBIDDEN];
  } else {
    // Default: pass recent memories only, no raw facts
    relevant_facts = [];
    forbidden_topics = [];
  }

  // Memories: always use the already-scored set from retrieveRelevantMemories,
  // but additionally suppress social memories for social speech acts.
  const relevant_memories = (act === "social_observation" || act === "joke_or_sarcasm" || act === "greeting")
    ? [] // Social acts need no prior exchange history
    : memories.slice(0, 4); // cap at 4 to prevent context dumping

  return {
    relevant_memories,
    relevant_facts: relevant_facts.slice(0, 6), // hard cap
    forbidden_topics
  };
}

// ─── Maxwell hints (shared doctrine without shared call stack) ────────────
/**
 * Returns interpretation hints for Maxwell briefing Q&A.
 * Used to apply the same speech-act doctrine without routing Maxwell through
 * the coworker communication path.
 */
function buildMaxwellWordsmithHints(playerText) {
  return interpretUtterance(String(playerText ?? "").trim(), { isGroup: false });
}

// ─── Autonomous observation-report purpose resolution ─────────────────────
/**
 * Maps a code-selected, allowlisted report purpose (from speech-scheduler.js)
 * to a wording instruction for the model. The scheduler decides WHETHER and
 * WHY a report happens; this only tells the model HOW to phrase it. Mirrors
 * resolveResponsePurpose's role for player-directed dialogue.
 *
 * @param {string} purpose - one of speech-scheduler's REPORT_PURPOSES
 * @returns {string} wording instruction
 */
const REPORT_PURPOSE_INSTRUCTIONS = Object.freeze({
  hazard_warning: "report the hazard urgently and factually; state only the authorized observation, do not speculate about cause and do not downplay the risk",
  equipment_problem: "report the equipment problem factually and briefly; state only the authorized observation",
  anomaly_notice: "report the anomaly factually and briefly; describe only the authorized observation, no speculation",
  personnel_condition: "report the personnel condition factually and with appropriate concern; state only the authorized observation",
  assignment_blocker: "report the assignment blocker factually; state only the authorized observation",
  assignment_finding: "report the assignment finding briefly and factually; state only the authorized observation"
});

function resolveReportPurpose(purpose) {
  return REPORT_PURPOSE_INSTRUCTIONS[purpose] ?? REPORT_PURPOSE_INSTRUCTIONS.anomaly_notice;
}

module.exports = {
  INTERPRETATION_VERSION,
  SPEECH_ACTS,
  TOPICS,
  BARE_REACTION_PATTERN: BARE_REACTION_PATTERNS,
  selfStateQuery,
  meaningRequest,
  quotedSpan,
  addressesSecondPerson,
  LANGUAGE_PATTERNS: LANGUAGE_PATTERNS_FULL,
  GROUP_VOCATIVES,
  parseNamedAddress,
  parseAddressees,
  stripNamedAddress,
  interpretUtterance,
  detectTopic,
  inferLocalRecipientType,
  resolveResponseOwners,
  resolveResponsePurpose,
  selectRelevantContext,
  buildMaxwellWordsmithHints,
  resolveReportPurpose
};
