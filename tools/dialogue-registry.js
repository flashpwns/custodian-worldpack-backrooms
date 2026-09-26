"use strict";

// THE SEMANTIC REGISTRY (ED-30): one declarative table of the propositions a player can ask about.
//
// Parser (Tier 1 cues, Tier 2 facet enum), planner (resolver, cardinality, routing), validator (epistemic
// ownership, answer contracts, neighbours, private-state lexicon) and tests all read THIS table. Adding a
// lore facet later is: one entry here + one resolver in dialogue-resolvers.js. Nothing in this file is a
// fact about the world; entries describe QUESTIONS and who may answer them.
//
// Entry fields:
//   id                  "<domain>.<facet>"
//   domain              person | place | item | mission | procedure | transition | institution | conversation
//   slots               argument slots and their entity kinds
//   question_forms      forms the predicate is asked in (wh, yes_no, choice, count)
//   resolver            name of the deterministic resolver (dialogue-resolvers.js) or null when a legacy
//                       discourse function answers it (see route)
//   route               { fn, concept?, facet? } -- the discourse function that plans the answer.
//                       "ask_predicate" = the registry resolver path.
//   epistemic_class     SELF_PRIVATE | SELF_HISTORY | OBSERVABLE | INSTITUTIONAL | REPORTED | RECORDED |
//                       CONVERSATIONAL -- who may assert it about whom (validator H4)
//   default_cardinality each_self | each_self_concise | one_knower | one_spokesperson | each_ack | none
//   temporal_support    the temporal scopes the predicate distinguishes
//   granularity         the precision canon stores (validator H2: no manufactured precision)
//   answer_contract     what a responsive answer must contain (validator H5)
//   neighbors           facets commonly confused with this one (H5 + minimal-pair tests)
//   cues                Tier-1 lexical cues over the EXPANDED clause (lowercase, contractions expanded):
//                       { re, form?, polarity?, temporal? }
//   blockers            patterns that veto every cue of this entry
//   lexicon             H1 private-state / claim lexicon: patterns that make an NPC clause a proposition
//                       of this predicate (subject resolved separately)
//   priority            cue precedence (higher wins when several entries match one clause)

const REGISTRY_VERSION = "yellow-beast-semantic-registry@v1";

const EPISTEMIC = Object.freeze({ SELF_PRIVATE: "SELF_PRIVATE", SELF_HISTORY: "SELF_HISTORY", OBSERVABLE: "OBSERVABLE", INSTITUTIONAL: "INSTITUTIONAL", REPORTED: "REPORTED", RECORDED: "RECORDED", CONVERSATIONAL: "CONVERSATIONAL" });
const CARDINALITY = Object.freeze({ EACH_SELF: "each_self", EACH_SELF_CONCISE: "each_self_concise", ONE_KNOWER: "one_knower", ONE_SPOKESPERSON: "one_spokesperson", EACH_ACK: "each_ack", NONE: "none" });
const ANSWER_VALUES = Object.freeze(["yes", "no", "unknown", "partial", "value", "not_established"]);

// Shared fragments (expanded text: "you have", "we are", "do not").
const YOU = "(?:you|you all|you two|you three|you guys|y'all|you both|both of you|all of you|any of you|either of you|each of you|the rest of you|the others|everyone|everybody|anyone|anybody|[a-z]+)(?: (?:here|else|at all|all|both|guys))?";
const re = (source) => source; // cues are stored as regex SOURCE strings (data), compiled once below

const ENTRIES = [
  // ── PERSON: history (SELF_HISTORY) ──────────────────────────────────────────────────────────────────
  {
    id: "person.first_day_at_async", domain: "person", slots: { subject: "person" }, question_forms: ["yes_no", "choice"],
    resolver: "profile_first_day", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["today"], granularity: "boolean",
    answer_contract: { kind: "self_polarity" }, neighbors: ["person.async_tenure", "person.complex_experience", "person.self_description"],
    priority: 60,
    cues: [
      { re: re("\\bfirst day\\b"), form: "yes_no", temporal: "today" },
      { re: re("\\b(?:is|are|am)\\s+(?:you|anyone|anybody|everyone|everybody|any of you|you all|you two|both of you|[a-z]+)\\s+(?:else\\s+)?(?:also |all |even |still )?new(?: here| to (?:async|the company|this|this job|the job))?\\b"), form: "yes_no" },
      { re: re("^(?:so |and )?(?:you|you all|y'all|you guys|you two)\\s+(?:all |also |both )?new(?: here)?\\b"), form: "yes_no" },
      { re: re("\\bnew (?:here|to async|at async|to the company|hires?)\\b"), form: "yes_no" },
      { re: re("\\bfirst time (?:here|at async|with async|working (?:here|for async|at async))\\b"), form: "yes_no", temporal: "today" },
      { re: re("\\b(?:just|only) (?:started|joined|got hired|been hired)\\b|\\bstart(?:ed|ing)? (?:here )?today\\b"), form: "yes_no", temporal: "today" }
    ],
    lexicon: ["\\bfirst day\\b", "\\bnew (?:here|to (?:async|the company|this))\\b", "\\b(?:just|only) (?:started|joined)\\b", "\\bstarted today\\b", "\\b(?:is|am|are) new\\b"]
  },
  {
    id: "person.async_tenure", domain: "person", slots: { subject: "person" }, question_forms: ["wh", "yes_no"],
    resolver: "profile_tenure", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["ever", "now"], granularity: "band:first_day|weeks|months|years",
    answer_contract: { kind: "self_value" }, neighbors: ["person.first_day_at_async", "person.expedition_experience"],
    priority: 58,
    cues: [
      { re: re("^(?:so )?(?:you|you have|you've) (?:been|worked) (?:here|with async|at async|for async)(?: (?:for )?(?:years|a while|ages|a long time|months|weeks|long))\\b"), form: "yes_no" },
      { re: re("\\bhow long (?:have|has) " + YOU + " (?:been|worked|working)\\b"), form: "wh" },
      { re: re("\\b(?:have|has) " + YOU + " (?:worked|been working) (?:here|at async|for async|with async|for the company|at the company)(?: before| long| a while)?\\b"), form: "yes_no", polarity: "negative_family" },
      { re: re("\\b(?:been|worked) (?:here|with async|at async|for async|with the company|at the company|for the company) (?:long|a while|for a while|before)\\b"), form: "yes_no" },
      { re: re("\\bhow long (?:have|has) (?:you|he|she|they|[a-z]+) been (?:with|at|here|around)\\b"), form: "wh" }
    ],
    lexicon: ["\\b(?:been|worked|working) (?:here|with async|at async|for async|with the company|at the company|for the company)\\b", "\\b(?:a few |several |many |two |three |\\d+ )?(?:weeks|months|years) (?:now|here|with)\\b"]
  },
  {
    id: "person.expedition_experience", default_temporal: "ever", domain: "person", slots: { subject: "person" }, question_forms: ["yes_no", "wh", "count"],
    resolver: "profile_expedition_experience", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF_CONCISE, temporal_support: ["ever"], granularity: "band:none|some|many",
    answer_contract: { kind: "self_polarity" }, neighbors: ["person.complex_experience", "person.first_day_at_async", "mission.objective"],
    priority: 55,
    cues: [
      { re: re("\\b(?:been on|gone on|done|went on) (?:an? |any |one of these |many |a lot of )?(?:expeditions?|missions?|trips?|runs?|one of these(?: before)?)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\b(?:done|did) (?:this|one of these|anything like this|something like this|this kind of thing) (?:before|already|ever)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\bever done (?:this|one of these|anything like this)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\bfirst (?:expedition|mission|trip|run)\\b"), form: "yes_no", temporal: "ever", polarity: "inverted" },
      { re: re("\\bhow many (?:expeditions|missions|trips|times)\\b(?![^?]*\\b(?:inside|in there|the complex)\\b)"), form: "count", temporal: "ever" }
    ],
    lexicon: ["\\b(?:been on|done|gone on) (?:an? |any |one of these )?(?:expeditions?|missions?|trips?)\\b", "\\bdone (?:this|one of these)\\b", "!\\bfirst (?:expedition|mission|trip|one)\\b"]
  },
  {
    id: "person.complex_experience", default_temporal: "ever", domain: "person", slots: { subject: "person", place: "place" }, question_forms: ["yes_no", "count"],
    resolver: "profile_place_experience", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF_CONCISE, temporal_support: ["ever", "today"], granularity: "band:none|some|many",
    answer_contract: { kind: "self_polarity" }, neighbors: ["place.definition", "person.expedition_experience", "mission.destination"],
    priority: 62,
    cues: [
      { re: re("\\bbeen (?:past|beyond|through|across|into|inside) (?:the )?(?:threshold|complex)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\b(?:have|has|had) " + YOU + " (?:ever |already |actually |personally |never |not )?(?:been|gone|went) (?:in|into|inside|in there|down there|over there|there|through|across|over|to the complex|to outpost a|to the outpost)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\b(?:you|you all|y'all|you guys|you two|anyone|anybody) (?:have |has )?(?:ever |already |actually )?(?:been|gone) (?:in|into|inside|in there|down there|there|through|across|to the complex)(?: before| already| yet)?\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\bbeen (?:in|inside|in there|down there|there|through|to) (?:the complex|there|before)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\bever been (?:in|inside|there|to|through|down)\\b"), form: "yes_no", temporal: "ever" },
      { re: re("\\bfirst time (?:going |being )?(?:in|inside|in there|into the complex|in the complex|through|through the threshold|down there|going in)\\b"), form: "yes_no", temporal: "ever", polarity: "inverted" },
      { re: re("\\bhow many times (?:have|has) (?:you|anyone|[a-z]+) been (?:in|inside|there)\\b"), form: "count", temporal: "ever" }
    ],
    blockers: ["\\bwhat (?:is|are) (?:in )?there\\b"],
    lexicon: ["\\b(?:been|gone|went) (?:in|into|inside|in there|down there|through|across)\\b", "\\bnever been\\b", "\\bbeen there\\b", "!\\bfirst time\\b", "\\bbeen (?:in|to) the complex\\b"]
  },
  // ── PERSON: private state (SELF_PRIVATE) ─────────────────────────────────────────────────────────────
  {
    id: "person.wellbeing", domain: "person", slots: { subject: "person" }, question_forms: ["wh", "yes_no"],
    resolver: "self_state", route: { fn: "check_in", self_state: "wellbeing" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now", "earlier"], granularity: "band:fine|affected",
    answer_contract: { kind: "self_state" }, neighbors: ["person.anticipation", "person.current_activity"],
    priority: 50,
    cues: [
      { re: re("\\bhow (?:are|is|am) (?:you|everyone|everybody|you all|y'all|you guys|you two|you three|both of you|all of you|the rest of you|[a-z]+) (?:doing|holding up|feeling|going|keeping)\\b"), form: "wh", temporal: "now" },
      { re: re("^(?:so |and |well )?how are (?:you|y'all|you all|you guys|you two)\\b(?! (?:going to|supposed|planning|getting there|related))"), form: "wh", temporal: "now" },
      { re: re("\\bhow (?:is|has) (?:it|everything|your (?:morning|day)) (?:going|been)\\b|\\bhow (?:have|has) (?:you|everyone) been\\b|\\bhow you (?:doing|holding up)\\b"), form: "wh", temporal: "now" },
      { re: re("^(?:are |is )?(?:you|everyone|everybody|y'all|you all|you guys|you two)\\s+(?:doing\\s+)?(?:okay|alright|all right|good|fine|holding up|hanging in(?: there)?)(?:\\s+(?:there|now|still|today|this morning))?\\s*\\??$"), form: "yes_no", temporal: "now" },
      { re: re("\\bhow do you feel\\b(?! about)|\\bhow are you feeling\\b(?! about)"), form: "wh", temporal: "now" },
      // Third person, bare: "How is Tonya?" / "Is Malcolm okay?" (a name, not "it"/"that"/an institution).
      { re: re("^(?:so |and |well )?how(?:'s| is| has) (?!(?:it|that|this|everything|things|work|async|the|your|my|our|their|his|her)\\b)[a-z]+(?: been| today| now| this morning)?\\s*\\??$"), form: "wh", temporal: "now" },
      { re: re("^(?:and |so )?is (?!(?:it|that|this|everything|there)\\b)[a-z]+\\s+(?:doing\\s+)?(?:okay|alright|all right|fine|holding up)(?:\\s+(?:there|now|still|today))?\\s*\\??$"), form: "yes_no", temporal: "now" }
    ],
    lexicon: ["\\b(?:doing|feeling|holding up|keeping)\\s+(?:\\w+\\s+)?(?:fine|well|good|okay|alright|all right|great|ok|not bad|all right)\\b", "\\b(?:is|am|are|was) (?:fine|okay|alright|all right|good|well|great|not bad)\\b", "\\bnot (?:too |so )?bad\\b", "\\bcan not complain\\b", "\\b(?:is|are|am) managing\\b", "\\bdoing all right\\b", "\\bdoing alright\\b"]
  },
  {
    id: "person.nervousness", domain: "person", slots: { subject: "person" }, question_forms: ["yes_no", "wh"],
    resolver: "self_state", route: { fn: "check_in", self_state: "tense" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now", "earlier"], granularity: "band:low|elevated",
    answer_contract: { kind: "self_state" }, neighbors: ["person.anticipation", "person.wellbeing"],
    priority: 52,
    cues: [
      { re: re("\\b(?:nervous|anxious|worried|scared|afraid|uneasy|on edge|freaked out|jittery|tense|frightened|stressed)\\b"), form: "yes_no", temporal: "now" }
    ],
    blockers: ["\\bi (?:am|am so|feel|get)\\b[^?]*\\b(?:nervous|anxious|worried|scared|afraid)\\b", "\\bmakes me\\b"],
    lexicon: ["\\b(?:nervous|anxious|worried|scared|afraid|uneasy|on edge|jittery|tense|frightened|stressed|calm|relaxed)\\b"]
  },
  {
    id: "person.anticipation", domain: "person", slots: { subject: "person", about: "mission" }, question_forms: ["yes_no", "wh"],
    resolver: "self_state", route: { fn: "check_in", self_state: "positive" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "band:low|neutral|elevated",
    answer_contract: { kind: "self_state" }, neighbors: ["person.nervousness", "mission.objective"],
    priority: 52,
    cues: [
      { re: re("\\b(?:looking forward|excited|eager|pumped|psyched|stoked|thrilled|can not wait|cannot wait|dreading)\\b"), form: "yes_no", temporal: "now" },
      { re: re("\\bhow do you (?:all |guys )?feel about (?:today|this|the (?:expedition|mission|trip|assignment)|going in)\\b"), form: "wh", temporal: "now" }
    ],
    blockers: ["\\bi (?:am|am so|feel)\\b[^?]*\\b(?:excited|looking forward)\\b"],
    lexicon: ["\\b(?:excited|looking forward|eager|pumped|psyched|stoked|thrilled|can not wait|dreading)\\b"]
  },
  {
    id: "person.fatigue", domain: "person", slots: { subject: "person" }, question_forms: ["yes_no"],
    resolver: "self_state", route: { fn: "check_in", self_state: "tired" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now", "earlier"], granularity: "band:low|elevated",
    answer_contract: { kind: "self_state" }, neighbors: ["person.wellbeing"],
    priority: 52,
    cues: [{ re: re("\\b(?:tired|exhausted|sleepy|worn out|wiped|beat)\\b"), form: "yes_no", temporal: "now" }],
    blockers: ["\\bi (?:am|am so|feel|get)\\b[^?]*\\b(?:tired|exhausted|sleepy)\\b"],
    lexicon: ["\\b(?:tired|exhausted|sleepy|worn out|wiped|rested|fatigued)\\b"]
  },
  // ── PERSON: identity, role, relations (mostly answered by existing discourse functions) ──────────────
  {
    id: "person.self_description", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "invite_self_description" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "record",
    answer_contract: { kind: "self_description" }, neighbors: ["person.role", "person.first_day_at_async"],
    priority: 45,
    cues: [
      { re: re("\\b(?:tell|telling|share|say|talk)\\b[^.?!]*\\babout (?:yourself|yourselves|you)\\b"), form: "wh" },
      { re: re("\\bintroduc\\w* (?:yourself|yourselves)\\b"), form: "wh" },
      { re: re("\\bwho are you(?: all| guys| folks| two)?\\b(?! talking| asking)"), form: "wh" },
      { re: re("\\b(?:what is|what's) your (?:story|deal|background story)\\b"), form: "wh" },
      { re: re("\\b(?:like|love|want) to (?:hear|know) (?:more )?about (?:you|yourself)\\b"), form: "wh" }
    ],
    lexicon: []
  },
  {
    id: "person.identity", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_person_identity", concept: "person_identity" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record",
    answer_contract: { kind: "known_concept" }, neighbors: ["person.role", "person.authority"], priority: 42,
    // "Tell me about Malcolm." (a named third person or a pronoun; never "yourself", a place or a thing).
    cues: [
      { re: re("\\b(?:what'?s|what is|what are) (?:your|everybody(?:'?s| is)|everyone(?:'?s| is)|y'?all'?s|you all'?s) names?\\b"), form: "wh" },{ re: re("\\btell (?:me|us) (?:a bit |a little |something |more )?about (?!(?:yourself|yourselves|you|the|this|that|it|what|how|why|where|when|today|our|your|my)\\b)[a-z]+\\b"), form: "wh" }], lexicon: []
  },
  {
    id: "person.role", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_role_or_assignment" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "record",
    answer_contract: { kind: "role" }, neighbors: ["person.identity", "person.self_description"], priority: 20, cues: [
      { re: re("^(?:so |and |okay |ok )?what (?:do|does) (?:everybody|everyone|you all|you guys|each of you|you two|y'?all) (?:actually )?do(?: (?:around )?here| on this (?:team|expedition|trip))?\\s*\\??$"), form: "wh" },], lexicon: []
  },
  {
    id: "person.authority", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_person_identity", concept: "person_authority" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record",
    answer_contract: { kind: "known_concept" }, neighbors: ["person.identity", "person.role"], priority: 20, cues: [
      { re: re("\\bwho(?:'s| is) (?:leading|running|in charge|the boss|our boss|in command|our lead|the lead)\\b"), form: "wh" },
      { re: re("\\b(?:maxwell|kirk|he|she)(?:'s| is) (?:our|the) (?:boss|lead|leader|supervisor|manager)\\b"), form: "yes_no" },], lexicon: []
  },
  {
    id: "person.presence", domain: "person", slots: { subject: "person" }, question_forms: ["yes_no", "wh"],
    resolver: null, route: { fn: "ask_person_identity", concept: "person_presence" }, epistemic_class: EPISTEMIC.OBSERVABLE,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "earlier"], granularity: "observation",
    answer_contract: { kind: "known_concept" }, neighbors: ["transition.participants", "person.identity"], priority: 20, cues: [
      { re: re("\\bis (?:maxwell|kirk|dr\\.? maxwell|(?!(?:from|it|that|this|there|the|a|an|everything|anything|something|nothing)\\b)[a-z]+) (?:still )?(?:in the building|around|nearby|still here|here)\\b"), form: "yes_no" },
      { re: re("^(?:is )?(?:everyone|everybody) (?:here|present)\\s*\\??$"), form: "yes_no" },], lexicon: []
  },
  {
    id: "person.familiarity", domain: "person", slots: { subject: "person", other: "person" }, question_forms: ["yes_no"],
    resolver: "profile_familiarity", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_HISTORY,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["ever", "now"], granularity: "band:just_met|acquainted|colleagues",
    answer_contract: { kind: "self_polarity" }, neighbors: ["person.identity", "person.role"],
    priority: 40,
    cues: [
      { re: re("\\b(?:do|does|did) (?:you|any of you|either of you|you all|you two) (?:actually |already )?know (?:dr\\.? )?(?:maxwell|kirk|[a-z]+)\\b"), form: "yes_no" },
      { re: re("\\bwho (?:here )?(?:has|had) (?:met|known|worked with)\\b|\\byou (?:must|probably|might) know\\b"), form: "yes_no" },
      { re: re("\\b(?:do|did) (?:you|you all|you two|you guys|any of you) (?:already |actually |all )?know (?:each other|one another|him|her|them|[a-z]+)\\b"), form: "yes_no" },
      { re: re("\\bhave (?:you|you all|you two|any of you) (?:ever )?(?:met|worked with|worked together|known) (?:each other|one another|him|her|them|before|[a-z]+)\\b"), form: "yes_no" },
      { re: re("\\bknown each other\\b|\\bworked together before\\b|\\bmet (?:before|each other)\\b"), form: "yes_no" },
      // About two other people: "Does Tonya know Maxwell?" (answered as a third-party question).
      { re: re("^(?:so |and )?(?:does|did) (?!(?:anyone|anybody|everyone|someone)\\b)[a-z]+ (?:already |actually )?know (?:each other|[a-z]+)\\s*\\??$"), form: "yes_no" },
      // Chat, aux dropped: "you two know each other", "tonya u know malcolm".
      { re: re("^(?:so |and )?(?:you|you two|you guys|you all|y'all) (?:already |actually |all )?know (?:each other|one another|him|her|them|[a-z]+)\\s*\\??$"), form: "yes_no" }
    ],
    // Meeting today means NOT already acquainted (an inverted cue); having met before means acquainted.
    lexicon: ["!\\b(?:just|only) met\\b", "!\\bmet (?:him|her|them|each other)? ?(?:today|this morning)\\b", "\\bmet (?:him|her|them|each other) before\\b", "\\bknows? (?:him|her|them|each other|maxwell|kirk)\\b", "\\bworked (?:with|together)\\b", "\\bstrangers\\b"]
  },
  {
    id: "person.current_assignment", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_role_or_assignment" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "record",
    answer_contract: { kind: "role" }, neighbors: ["person.current_activity", "item.purpose"], priority: 20,
    cues: [
      { re: re("\\bwhat (?:are|is) (?:you|you all|you two|you guys) (?:on|working on) (?:today|this (?:trip|expedition|morning))?\\b"), form: "wh" },
      { re: re("\\bwhat (?:are|is) (?:you|you two|you all|you guys) working on\\b"), form: "wh" },
      { re: re("\\b(?:you'?re|you are) on (?:the )?(?:layout|layout record|observation|recall|verbal recall|camera|materials|delivery|the materials)\\b"), form: "yes_no" },
      // "What do you do?" (asked of a coworker): their job here -- not "what do we do now".
      { re: re("^(?:so |and |okay |ok )?what (?:do|does) you (?:actually |even |exactly )?do(?: (?:here|for (?:a living|work|async)|exactly|again|on (?:this|the) (?:expedition|trip|team)))?\\s*\\??$"), form: "wh" }
    ],
    blockers: ["\\bwhat (?:do|does) (?:we|us|i) (?:actually |even )?do\\b"], lexicon: []
  },
  {
    id: "person.current_activity", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_current_action" }, epistemic_class: EPISTEMIC.OBSERVABLE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "observation",
    answer_contract: { kind: "known_concept" }, neighbors: ["person.current_assignment"], priority: 20, cues: [
      { re: re("\\bwhat (?:are|is) (?:you|everyone|everybody|you all|you guys|y'?all) (?:doing|up to)(?: over there| right now| now| at the moment)?\\b"), form: "wh" },], lexicon: []
  },
  {
    id: "person.opinion", domain: "person", slots: { subject: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_opinion" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "stance",
    answer_contract: { kind: "stance" }, neighbors: ["person.anticipation"], priority: 20, cues: [
      { re: re("\\bwhat (?:do|does) (?:you|[a-z]+) think (?:about|of)\\b"), form: "wh" },],
    lexicon: ["\\b(?:i|he|she|they|we|you)\\s+(?:really\\s+|kind of\\s+|do\\s+|do not\\s+)?(?:like|love|hate|dislike|enjoy)\\b", "\\b(?:likes|loves|hates|dislikes|enjoys)\\b"]
  },
  {
    id: "person.intent", domain: "person", slots: { subject: "person" }, question_forms: ["wh", "yes_no"],
    resolver: "profile_intent", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.SELF_PRIVATE,
    default_cardinality: CARDINALITY.EACH_SELF, temporal_support: ["now"], granularity: "not_modelled",
    answer_contract: { kind: "self_value" }, neighbors: ["person.opinion"],
    priority: 30,
    cues: [
      { re: re("\\bwhat (?:do|does) (?:you|he|she|they) (?:want|need|hope)\\b|\\bwhat is on your mind\\b|\\bwhat are you (?:hoping|worried) (?:for|about)\\b"), form: "wh" }
    ],
    lexicon: ["\\b(?:wants?|hopes?|wishes?) to\\b", "\\b(?:planning|intends?|intending) to\\b", "\\bremembers?\\b", "(?<!verbal )\\brecalls?\\b(?! (?:duty|task|work|assignment))"]
  },
  // ── MISSION ──────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "mission.objective", domain: "mission", slots: {}, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_mission_objective", concept: "mission_objective" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["today", "now"], granularity: "briefing",
    answer_contract: { kind: "known_concept", facet: "objective" }, neighbors: ["mission.destination", "procedure.next_incomplete_step", "institution.purpose"],
    priority: 30,
    cues: [
      { re: re("\\bwhat (?:are|is) we (?:actually |even |really )?(?:doing|supposed to (?:be )?do(?:ing)?|here to do|going to do)(?: (?:here|today|in there|out there|there))?\\b(?! next)"), form: "wh" },
      { re: re("\\bwhat is (?:the|our|today's|this) (?:mission|objective|goal|assignment|job)\\b(?! for)"), form: "wh" },
      { re: re("\\bwhy are we going\\b"), form: "wh" },
      { re: re("\\bwhat is (?:the |our )?(?:actual |real |main |whole |overall )?(?:purpose|point|goal|objective|aim) of (?:the |this |our |today's )?(?:expedition|mission|trip|assignment|operation)\\b"), form: "wh" }
    ],
    blockers: ["\\bnext\\b", "\\bwhat are you (?:doing|up to)\\b"],
    lexicon: []
  },
  {
    id: "mission.destination", domain: "mission", slots: {}, question_forms: ["wh", "yes_no"],
    resolver: "mission_destination", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "today", "earlier"], granularity: "briefing",
    answer_contract: { kind: "place" }, neighbors: ["mission.objective", "procedure.next_incomplete_step", "item.destination"],
    priority: 57,
    cues: [
      // Past progressive: "Where were we going?" asks for the destination as it was (historical frame).
      { re: re("\\bwhere (?:were|was) (?:we|the team|everyone|you all|y'all|you guys) (?:all )?(?:actually |even |really )?(?:going|headed|heading|off to|being sent)\\b"), form: "wh", temporal: "earlier" },
      { re: re("\\bwhere (?:are|is) (?:we|the team|the expedition|everyone|you all|y'all|you guys) (?:all )?(?:actually |even |really )?(?:going|headed|heading|off to|being sent|going to go|going to end up)\\b"), form: "wh" },
      { re: re("\\bwhere we are (?:actually |even |all )?(?:going|headed|heading|being sent)\\b"), form: "wh" },
      { re: re("^(?:so |and |okay |alright )?where to\\b"), form: "wh" },
      { re: re("\\bwhere (?:are|do|will) (?:they|async|maxwell) (?:sending|send|taking|want) us\\b"), form: "wh" },
      { re: re("\\b(?:what|where) is (?:the|our) (?:destination|end point|endpoint)\\b|\\bour destination\\b"), form: "wh" },
      { re: re("\\bwhere (?:is|are) (?:the |this |our )?(?:expedition|mission|trip) (?:going|headed|taking us|to)\\b"), form: "wh" },
      { re: re("\\bwhere (?:are|were) we (?:actually )?supposed to be going\\b|\\bwhere we are supposed to be going\\b"), form: "wh" }
    ],
    blockers: ["\\b(?:next|now|after this|after that|from here|first|right now)\\b", "\\bwhy\\b"],
    lexicon: []
  },
  {
    id: "mission.schedule", domain: "mission", slots: {}, question_forms: ["wh"],
    resolver: "mission_schedule", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["today"], granularity: "briefing:clock_time",
    answer_contract: { kind: "time" }, neighbors: ["procedure.next_incomplete_step", "mission.destination"],
    priority: 44,
    cues: [
      { re: re("\\bare we (?:leaving|heading out|going|starting|moving) (?:soon|now|yet|any time soon)\\b"), form: "yes_no" },
      { re: re("\\bhow long (?:is|will|does) (?:this|it|the (?:trip|expedition|mission|run|delivery)) (?:supposed to |going to )?(?:take|last)\\b"), form: "wh" },
      { re: re("\\bwhen (?:are|do|will|should|can) we (?:(?:supposed|meant|going|planning|scheduled|expected) to )?(?:leave|go|head out|depart|start|get going|go in|set out|get moving|head in|cross|be back|need to be back|have to be back)\\b"), form: "wh" },
      { re: re("\\bwhat time (?:do|are|will|is|should)\\b|\\bwhat time(?:'s| is) (?:departure|the cutoff|the deadline|it|we)\\b|\\bwhat time(?:'s| is) departure\\b"), form: "wh" },
      { re: re("\\bwhen is (?:the )?(?:cutoff|deadline|departure|return)\\b|\\bhow long (?:do|will) we have\\b|\\bwhen are we (?:going|heading|leaving)\\b"), form: "wh" }
    ],
    lexicon: []
  },
  {
    id: "mission.route", domain: "mission", slots: {}, question_forms: ["wh"],
    resolver: "mission_route", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "procedure_form",
    answer_contract: { kind: "route" }, neighbors: ["mission.destination"],
    priority: 44,
    cues: [
      { re: re("\\bwhere (?:is|are) (?:the )?(?:threshold|complex|outpost a|equipment staging|staging)\\b[^?]*\\bfrom here\\b"), form: "wh" },
      { re: re("\\bhow (?:do (?:we|i|you)|to|can (?:we|i)|would (?:we|i)|are we|will we) (?:get|getting|go|going|find|reach)(?: to| there)\\b"), form: "wh" },
      { re: re("\\bhow are we getting there\\b|\\bhow far (?:is|away)\\b|\\bis (?:the |it )?(?:[a-z]+ )?far\\b"), form: "wh" },
      { re: re("\\bhow (?:do|will|are|would) we (?:get|going to get|find our way|find) (?:there|to (?:the )?(?:outpost|complex|staging|equipment staging))\\b"), form: "wh" },
      { re: re("\\bwhich way (?:do|are|is)\\b|\\bwhat is the route\\b|\\bhow do we find (?:it|the outpost|our way)\\b"), form: "wh" }
    ],
    lexicon: []
  },
  {
    id: "mission.participants", domain: "mission", slots: { place: "place" }, question_forms: ["yes_no", "wh"],
    resolver: "transition_participants", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "today"], granularity: "briefing",
    answer_contract: { kind: "participants" }, neighbors: ["procedure.next_incomplete_step", "mission.destination"], priority: 10, cues: [
      { re: re("\\bwho(?:'s| is| else is)? (?:else )?(?:going to be (?:at|there)|meeting us|waiting for us|at outpost a)\\b"), form: "wh" },], lexicon: []
  },
  // ── PROCEDURE / TRANSITION ─────────────────────────────────────────────────────────────────────────────
  {
    id: "procedure.next_incomplete_step", domain: "procedure", slots: {}, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_next_step" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "procedure",
    answer_contract: { kind: "next_step" }, neighbors: ["mission.destination", "transition.participants", "procedure.instruction_history"],
    priority: 50,
    cues: [
      { re: re("\\bnow what\\b|\\bwhat (?:are|do) we (?:supposed to |need to )?(?:grab|get|pick up|collect|take) (?:here|now)\\b|\\bdo we (?:head|go) (?:to )?(?:staging|equipment staging)(?: now)?\\b"), form: "wh" },
      { re: re("\\bwhere (?:do|should|shall|will|are|am|can) (?:we|i) (?:supposed to |meant to |going to |expected to )?(?:go|head|report|be going|be heading|go to|head to|head over)(?: to)?(?:\\s+(?:next|now|after this|from here|after that|first))?\\b"), form: "wh" },
      { re: re("\\bwhere (?:are|is) (?:we|everyone) (?:going|headed|heading) (?:next|now|after this|from here|after that)\\b"), form: "wh" },
      { re: re("\\bwhat (?:happens|is happening) (?:next|now|after this|after that)\\b|\\bwhat is (?:the )?next (?:step|thing|stop)\\b|\\bwhat is next\\b|\\bwhat now\\b|\\bwhat do we do (?:next|now|after this|from here)\\b|\\bwhat is after this\\b|\\bwhat is the plan\\b|\\bnext step\\b"), form: "wh" },
      { re: re("\\bwhat (?:should|do|are|must|am) (?:we|i) (?:supposed to |meant to |expected to )?(?:be )?(?:doing|do) (?:right now|now|at the moment|for now|until then|in the meantime|meanwhile)\\b"), form: "wh" }
    ],
    lexicon: []
  },
  {
    id: "procedure.instruction_history", default_temporal: "earlier", domain: "procedure", slots: { speaker: "person" }, question_forms: ["wh"],
    resolver: null, route: { fn: "ask_reported_speech", concept: "reported_speech", topic_concept: "current_procedure" }, epistemic_class: EPISTEMIC.REPORTED,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier", "historical"], granularity: "briefing",
    answer_contract: { kind: "reported" }, neighbors: ["procedure.next_incomplete_step"], priority: 20, cues: [], lexicon: []
  },
  {
    id: "transition.participants", domain: "transition", slots: { place: "place" }, question_forms: ["yes_no", "wh"],
    resolver: "transition_participants", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "today"], granularity: "briefing",
    answer_contract: { kind: "participants" }, neighbors: ["procedure.next_incomplete_step", "mission.destination", "person.presence"],
    priority: 59,
    cues: [
      { re: re("\\b(?:just|only) (?:the )?(?:four|three|five) of us\\b|\\b(?:more people|anyone else|anybody else) coming\\b"), form: "yes_no" },
      { re: re("^(?:[a-z]+ )?(?:you|u) (?:coming|going)(?: with us| too| along)?\\s*\\??$"), form: "yes_no" },
      { re: re("\\b(?:are|is|were) (?:we|we all|all of us|everyone|everybody|the whole team|the team|you|you all|you two|you three|y'all|you guys|both of you) (?:all |both )?(?:going|coming|heading|headed|going in|going over|going there|coming along|coming too|coming with)(?:[^?]*\\btogether\\b)?"), form: "yes_no" },
      { re: re("\\b(?:do|will|should) (?:we|we all|all of us|everyone) (?:all )?(?:go|head|travel|move|go in|report)[^?]*\\btogether\\b"), form: "yes_no" },
      { re: re("\\bwho (?:all )?is (?:going|coming|heading)(?: (?:there|in|over|with (?:us|me)|along))?\\b|\\bwho (?:all )?(?:goes|comes)\\b"), form: "wh" },
      { re: re("\\b(?:do|will|should|are) we (?:split|split up|separate|go separately|go our separate ways)\\b|\\bsplit(?:ting)? up\\b"), form: "yes_no" },
      { re: re("\\bis (?!(?:it|that|this|everything|things|anything|something)\\b)(?:[a-z]+) (?:going|coming)(?: (?:too|with (?:us|me)|along|there|in))?\\b"), form: "yes_no" },
      // Chat, aux dropped: "we all going", "everyone coming".
      { re: re("^(?:so |and |okay |ok )?(?:we|we all|all of us|everyone|everybody|you all|you guys|y'all|you two) (?:all |both )?(?:going|coming|heading|headed)(?: (?:there|together|too|along|in|with us))?\\s*\\??$"), form: "yes_no" },
      // "Who's going to Outpost A?" -- who goes there (not "who is going to do X").
      { re: re("\\bwho (?:all )?(?:is|are) (?:going|heading|headed) to (?:the |outpost|equipment|staging|there)"), form: "wh" },
      { re: re("\\bare you (?:coming|going) (?:with (?:me|us)|too|along)\\b"), form: "yes_no" },
      { re: re("\\b(?:we|we all|all of us|everyone|everybody) (?:are|were|will be|would be|is) (?:all )?(?:going|coming|heading|headed|travelling|traveling)[^?]*\\btogether\\b"), form: "yes_no" },
      { re: re("\\b(?:if|whether) (?:we|we all|all of us|everyone) (?:are|were|will be|would be|is) (?:all )?(?:going|coming|heading|headed)\\b"), form: "yes_no" },
      { re: re("\\b(?:going|heading|go|head) (?:there |in |over |in there )?together\\b"), form: "yes_no" }
    ],
    blockers: ["\\bwhere\\b", "\\bwhat\\b", "\\bwhy\\b", "\\bhow are\\b", "\\bgoing to (?:be|do|have|need|say|tell)\\b", "\\bcoming from\\b", "\\bwho is (?:going|coming) to (?:be|do|have|need|say|tell|get|make|take|carry|bring|lead|run)\\b"],
    lexicon: []
  },
  // ── ITEM / PLACE / INSTITUTION (answered by existing knowledge functions) ───────────────────────────
  { id: "item.holder", domain: "item", slots: { item: "equipment" }, question_forms: ["wh", "yes_no"], resolver: null, route: { fn: "ask_item_ownership" }, epistemic_class: EPISTEMIC.OBSERVABLE, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "earlier"], granularity: "custody", answer_contract: { kind: "holder" }, neighbors: ["item.purpose", "item.destination"], priority: 20, cues: [
      { re: re("\\b(?:you'?ve|you have|you|he'?s|she'?s|they'?ve|[a-z]+'?s|[a-z]+ has) got (?:the |that |this )?(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b"), form: "yes_no" },
      { re: re("\\b(?:does|do|did)\\s+(?:anyone|anybody|someone|somebody|you|any of you|either of you)\\s+have\\s+(?:the|that|this|a|an)\\s+(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b"), form: "yes_no" },
      { re: re("\\bwhose\\s+(?:[a-z]+\\s+)?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b|\\bwhose (?:is (?:this|that|it))\\b"), form: "wh" },
      { re: re("\\bis (?:the |that |this )?(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment) (?:mine|yours|his|hers|theirs|[a-z]+'?s)\\b"), form: "yes_no" },
      { re: re("\\b(?:the one|who'?s the one|who is the one) (?:with|carrying|holding) the\\b"), form: "wh" },
      { re: re("\\b(?:am i|are you|is [a-z]+) (?:carrying|holding|bringing|in charge of|responsible for) (?:the |that )?(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b"), form: "yes_no" },
      { re: re("\\b(?:everybody|everyone|you all|all of you|you guys|y'?all) (?:got|have) (?:their|your) (?:gear|stuff|equipment|kit|things|lights|lamps)\\b"), form: "yes_no" },], lexicon: [] },
  { id: "item.purpose", domain: "item", slots: { item: "equipment" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_assignment_purpose", concept: "assignment_purpose" }, epistemic_class: EPISTEMIC.INSTITUTIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record", answer_contract: { kind: "known_concept", facet: "purpose" }, neighbors: ["item.destination", "item.holder"], priority: 20, cues: [
      { re: re("\\bwhat(?:'?s| is) the deal with (?:the |that |this )?(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b"), form: "wh" },
      { re: re("\\bwhat (?:does|do) (?:the |that |this )(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment) (?:actually |even )?do\\b"), form: "wh" },
      { re: re("\\bwhy (?:are|do) we (?:bringing|taking|carrying|need) (?:the |a |an |this |that )?(?:[a-z]+ )?(?:camera|duffle|duffel|materials|startup materials|lamp|light|field light|flashlight|torch|spectrometer|mass spectrometer|layout record|record|bag|gear|kit|stuff|equipment)\\b"), form: "wh" },], lexicon: [] },
  { id: "item.contents", domain: "item", slots: { item: "equipment" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_assignment_purpose", concept: "assignment_purpose", facet: "contents" }, epistemic_class: EPISTEMIC.INSTITUTIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record", answer_contract: { kind: "known_concept", facet: "contents" }, neighbors: ["item.purpose"], priority: 20, cues: [], lexicon: [] },
  { id: "item.destination", domain: "item", slots: { item: "equipment" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_assignment_purpose", concept: "assignment_purpose", facet: "destination" }, epistemic_class: EPISTEMIC.INSTITUTIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "briefing", answer_contract: { kind: "known_concept", facet: "destination" }, neighbors: ["item.purpose", "mission.destination"], priority: 48,
    // "Where are the materials going?" / "...where the startup materials are going" (a thing's destination, not ours).
    cues: [
      // "Where are we delivering the materials?" / "Where do we take the duffle?"
      { re: re("\\bwhere (?:are|do|will|should) (?:we|you|you all|you guys|i) (?:delivering|taking|bringing|dropping|sending|deliver|take|bring|drop|send) (?:the |those |these |our |that |this )?(?:[a-z]+ ){0,2}(?:materials|duffle|supplies|cargo|bag|stuff)\\b"), form: "wh" },{ re: re("\\bwhere (?:are |is |do |does )?(?:the |those |these |our |that |this )(?:[a-z]+ ){0,2}(?:materials|duffle|supplies|cargo|bag|record|camera|stuff)(?: are| is)? (?:going|headed|heading|being (?:delivered|taken|sent)|supposed to go|end(?:ing)? up|go)\\b"), form: "wh" }], lexicon: [] },
  { id: "place.definition", domain: "place", slots: { place: "place" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_entity_definition", concept: "entity_definition" }, epistemic_class: EPISTEMIC.INSTITUTIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record", answer_contract: { kind: "known_concept", facet: "definition" }, neighbors: ["person.complex_experience", "place.status"], priority: 30,
    // "What is there?" / "What's in there?" about the place just talked about (the place slot resolves the deixis).
    blockers: ["\\b(?:camera|duffle|duffel|spectrometer|lamp|flashlight|torch|record|materials|bag|gear)\\b"], cues: [
      { re: re("\\bis (?:the )?(?:threshold|complex|outpost a|equipment staging) (?:a|an|like a|more like)\\b"), form: "yes_no" },
      { re: re("\\bwhat do (?:we|you) (?:even |actually )?know about (?:the )?(?:threshold|complex|outpost a|equipment staging)\\b"), form: "wh" },{ re: re("^(?:so |and )?what (?:is|is it like|will we find) (?:in |over |down )?there\\b"), form: "wh" }], lexicon: [] },
  {
    id: "place.access", domain: "place", slots: { place: "place" }, question_forms: ["yes_no"],
    resolver: "place_access", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.INSTITUTIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now", "today"], granularity: "assignment",
    answer_contract: { kind: "access" }, neighbors: ["place.definition", "person.complex_experience"], priority: 46,
    cues: [
      { re: re("\\b(?:can|could|are) (?:you|we|people|anyone|anybody) (?:even |actually |really |allowed to |supposed to )*(?:go|get|walk|step) (?:in|into|inside|in there|through|down there|over there)\\b"), form: "yes_no" },
      { re: re("\\b(?:are|is) (?:we|you|anyone|people) (?:even )?allowed (?:in|inside|in there|to go in)\\b"), form: "yes_no" }
    ],
    lexicon: []
  },
  { id: "place.status", domain: "place", slots: { place: "place" }, question_forms: ["yes_no", "wh"], resolver: null, route: { fn: "ask_entity_definition", concept: "entity_state" }, epistemic_class: EPISTEMIC.OBSERVABLE, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "observation", answer_contract: { kind: "known_concept", facet: "current_state" }, neighbors: ["place.definition"], priority: 20,
    cues: [
      { re: re("\\b(?:is|are|was) (?:the |it |that |this )?(?:complex|threshold|outpost a|equipment staging|it|there|in there|that place|the place) (?:actually |really |even |very |too )?(?:dangerous|safe|risky|scary|hazardous|deadly)\\b"), form: "yes_no" },
      { re: re("\\bhow (?:dangerous|safe|risky|bad|scary) is (?:it|the complex|the threshold|in there|that place|outpost a)\\b"), form: "wh" }
    ], lexicon: [] },
  {
    // "Is the camera broken?" -- an item's current condition: observable, never inferred from a claim.
    id: "item.status", domain: "item", slots: { item: "equipment" }, question_forms: ["yes_no", "wh"], resolver: null, route: { fn: "ask_entity_definition", concept: "entity_state" }, epistemic_class: EPISTEMIC.OBSERVABLE,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "observation", answer_contract: { kind: "known_concept", facet: "current_state" }, neighbors: ["item.holder", "item.purpose"], priority: 30,
    cues: [
      { re: re("\\b(?:is|are|was) (?:the |my |your |his |her |that |this )?(?:[a-z0-9]+ ){0,2}(?:camera|duffle|duffel|bag|radio|flashlight|torch|light|lamp|kit|materials|equipment|gear|recorder|battery|batteries) (?:still )?(?:broken|working|damaged|charged|dead|functional|busted|okay|ok|fine)\\b"), form: "yes_no" },
      { re: re("\\bdoes (?:the |my |your |that |this )?(?:[a-z0-9]+ ){0,2}(?:camera|radio|flashlight|torch|light|lamp|recorder) (?:still )?work\\b"), form: "yes_no" }
    ], lexicon: []
  },
  { id: "institution.purpose", domain: "institution", slots: {}, question_forms: ["wh"], resolver: null, route: { fn: "ask_institution_purpose", concept: "institution_purpose" }, epistemic_class: EPISTEMIC.INSTITUTIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["now"], granularity: "record", answer_contract: { kind: "known_concept", facet: "purpose" }, neighbors: ["mission.objective"], priority: 20, cues: [
      { re: re("\\bwhat (?:is|are) (?:async|they) (?:trying to|going to|here to|supposed to) do\\b|\\bwhy does async\\b"), form: "wh" },], lexicon: [] },
  // ── CONVERSATION (answered by existing conversational functions) ─────────────────────────────────────
  {
    // "Is that true?" about a line just said: an unverified claim is never confirmed from language alone.
    id: "conversation.claim_check", domain: "conversation", slots: { anchor: "utterance" }, question_forms: ["yes_no"], resolver: "claim_check", route: { fn: "ask_predicate" }, epistemic_class: EPISTEMIC.CONVERSATIONAL,
    default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "stance", answer_contract: { kind: "self_polarity" }, neighbors: ["conversation.basis_of", "conversation.explanation"], priority: 70,
    cues: [{ re: re("^(?:and |so |but |wait,? )?(?:is|was) (?:that|this|it) (?:really |actually )?(?:true|right|correct|so)\\s*\\??$|^(?:is that|was that) (?:true|right)\\b"), form: "yes_no" }], lexicon: []
  },
  { id: "conversation.meaning_of", default_temporal: "earlier", domain: "conversation", slots: { anchor: "utterance" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_meaning" }, epistemic_class: EPISTEMIC.CONVERSATIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "anchor", answer_contract: { kind: "conversational" }, neighbors: ["conversation.basis_of"], priority: 20, cues: [], lexicon: [] },
  { id: "conversation.basis_of", domain: "conversation", slots: { anchor: "utterance" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_explanation" }, epistemic_class: EPISTEMIC.CONVERSATIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "provenance", answer_contract: { kind: "conversational" }, neighbors: ["conversation.meaning_of"], priority: 20, cues: [], lexicon: [] },
  { id: "conversation.explanation", domain: "conversation", slots: { anchor: "utterance" }, question_forms: ["wh"], resolver: null, route: { fn: "ask_explanation" }, epistemic_class: EPISTEMIC.CONVERSATIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "provenance", answer_contract: { kind: "conversational" }, neighbors: ["conversation.basis_of"], priority: 20, cues: [], lexicon: [] },
  { id: "conversation.reported_speech", default_temporal: "earlier", domain: "conversation", slots: { speaker: "person" }, question_forms: ["wh", "yes_no"], resolver: null, route: { fn: "ask_reported_speech" }, epistemic_class: EPISTEMIC.REPORTED, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "report", answer_contract: { kind: "reported" }, neighbors: ["procedure.instruction_history"], priority: 20, cues: [], lexicon: [] },
  { id: "conversation.response_event", domain: "conversation", slots: {}, question_forms: ["wh"], resolver: null, route: { fn: "ask_response_event" }, epistemic_class: EPISTEMIC.CONVERSATIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "event", answer_contract: { kind: "conversational" }, neighbors: [], priority: 20, cues: [], lexicon: [] },
  { id: "conversation.repetition", domain: "conversation", slots: {}, question_forms: ["wh"], resolver: null, route: { fn: "request_repetition" }, epistemic_class: EPISTEMIC.CONVERSATIONAL, default_cardinality: CARDINALITY.ONE_SPOKESPERSON, temporal_support: ["earlier"], granularity: "utterance", answer_contract: { kind: "conversational" }, neighbors: [], priority: 20, cues: [], lexicon: [] }
];

// ─── compiled registry (entries may be added at runtime: registerPredicate) ─────────────────────────
const compiled = new Map();
function compile(entry) {
  const cues = (entry.cues ?? []).map((cue) => Object.freeze({ ...cue, pattern: new RegExp(cue.re, "i") }));
  const blockers = (entry.blockers ?? []).map((source) => new RegExp(source, "i"));
  // A lexicon source prefixed with "!" asserts the NEGATIVE of the predicate ("first time" = no prior experience).
  const lexicon = (entry.lexicon ?? []).map((source) => Object.freeze({ pattern: new RegExp(String(source).replace(/^!/, ""), "i"), invert: String(source).startsWith("!") }));
  return Object.freeze({ ...entry, cues: Object.freeze(cues), blockers: Object.freeze(blockers), lexicon: Object.freeze(lexicon) });
}
function validateEntry(entry) {
  const required = ["id", "domain", "question_forms", "route", "epistemic_class", "default_cardinality", "temporal_support", "granularity", "answer_contract", "neighbors"];
  for (const key of required) if (entry?.[key] === undefined) throw new Error(`registry entry ${entry?.id ?? "?"} lacks ${key}`);
  if (!/^[a-z_]+\.[a-z_]+$/.test(entry.id)) throw new Error(`registry id must be <domain>.<facet>: ${entry.id}`);
  if (!Object.values(EPISTEMIC).includes(entry.epistemic_class)) throw new Error(`unknown epistemic class for ${entry.id}`);
  if (!Object.values(CARDINALITY).includes(entry.default_cardinality)) throw new Error(`unknown cardinality for ${entry.id}`);
  if (entry.route.fn === "ask_predicate" && !entry.resolver) throw new Error(`${entry.id} routes to the resolver path but names no resolver`);
  return true;
}
for (const entry of ENTRIES) { validateEntry(entry); compiled.set(entry.id, compile(entry)); }

/** Adds (or replaces) a predicate: a lore facet is data plus a resolver (see dialogue-resolvers.registerResolver). */
function registerPredicate(entry) {
  validateEntry(entry);
  compiled.set(entry.id, compile(entry));
  return compiled.get(entry.id);
}
function unregisterPredicate(id) { return compiled.delete(id); }
function get(id) { return compiled.get(id) ?? null; }
function all() { return [...compiled.values()]; }
function ids() { return [...compiled.keys()]; }

/**
 * Tier-1 predicate cues over one EXPANDED clause. Returns candidate matches ordered by priority (then
 * earliest match). Each: { id, entry, form, temporal, polarity, span:[start,end], cue_index }.
 */
function detectPredicates(expandedClause) {
  // Filler adverbs carry no facet ("who exactly is maxwell" asks who maxwell is).
  const text = String(expandedClause ?? "").toLowerCase().replace(/\b(?:exactly|precisely|basically)\s+/g, "");
  const out = [];
  for (const entry of compiled.values()) {
    if (!entry.cues.length) continue;
    if (entry.blockers.some((b) => b.test(text))) continue;
    for (const [index, cue] of entry.cues.entries()) {
      const match = text.match(cue.pattern);
      if (!match) continue;
      out.push({ id: entry.id, entry, form: cue.form ?? null, temporal: cue.temporal ?? null, polarity: cue.polarity ?? null, span: [match.index, match.index + match[0].length], cue_index: index });
      break;
    }
  }
  return out.sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.span[0] - b.span[0]);
}

/** The registry id a legacy discourse function (+ knowledge concept/facet) answers, for ledger/contracts. */
function predicateForFrame(frame) {
  if (!frame) return null;
  if (frame.predicate) return frame.predicate;
  const fn = frame.discourse_function;
  const kq = frame.knowledge_query ?? {};
  switch (fn) {
    case "invite_self_description": return "person.self_description";
    case "ask_role_or_assignment": return kq.subject === "other" ? "person.role" : "person.current_assignment";
    case "ask_person_identity": return kq.concept === "person_authority" ? "person.authority" : kq.concept === "person_presence" ? "person.presence" : kq.concept === "person_relation" ? "person.familiarity" : kq.concept === "person_role" ? "person.role" : "person.identity";
    case "ask_current_action": return "person.current_activity";
    case "ask_opinion": return "person.opinion";
    case "check_in": { const asked = frame.self_state_query?.asked; return asked === "tense" ? "person.nervousness" : asked === "tired" ? "person.fatigue" : asked === "positive" ? "person.anticipation" : "person.wellbeing"; }
    case "ask_mission_objective": return "mission.objective";
    case "ask_next_step": return "procedure.next_incomplete_step";
    case "ask_item_ownership": return "item.holder";
    case "ask_assignment_purpose": return kq.facet === "destination" ? "item.destination" : kq.facet === "contents" ? "item.contents" : kq.facet === "custody" ? "item.holder" : "item.purpose";
    case "ask_entity_definition": return kq.concept === "entity_state" ? "place.status" : "place.definition";
    case "ask_institution_purpose": return "institution.purpose";
    case "ask_meaning": return "conversation.meaning_of";
    case "ask_explanation": return "conversation.explanation";
    case "ask_reported_speech": return kq.topic_concept === "current_procedure" ? "procedure.instruction_history" : "conversation.reported_speech";
    case "ask_response_event": return "conversation.response_event";
    case "request_repetition": return "conversation.repetition";
    default: return null;
  }
}

/** Predicates whose facets may be offered to the Tier-2 advisory (bounded enum). */
function advisoryFacets() {
  return all().filter((entry) => entry.domain !== "conversation").map((entry) => entry.id).sort();
}

module.exports = { REGISTRY_VERSION, EPISTEMIC, CARDINALITY, ANSWER_VALUES, ENTRIES, registerPredicate, unregisterPredicate, get, all, ids, detectPredicates, predicateForFrame, advisoryFacets, validateEntry };
