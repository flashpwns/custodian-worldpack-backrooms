"use strict";

// Stages B-D of the LOCAL turn pipeline (ED-30): SEGMENT -> DISCOURSE LAYER -> TIER-1 ACT FRAMES.
//
// Pure language analysis over the normalized line. It knows the NAMES of the people present (to tell a
// vocative from a mention) and the Semantic Registry's cues; it knows nothing about the world, who said
// what, or who should answer. Context (active speaker, pending requests, activities) is applied later by
// dialogue-turn.js. Every act is traceable to a clause span of the player's own words.
//
// Vocabulary follows ISO 24617-2 / DIT++ dimensions loosely (task, feedback, turn management, own/partner
// communication management, social obligations) -- as design vocabulary, not a dependency.

const registry = require("./dialogue-registry");
const { normalizeUtterance } = require("./dialogue-normalize");

const ACTS_VERSION = "yellow-beast-dialogue-acts@v1";
const MAX_ACTS = 4;

// ─── discourse markers (secondary: tone/relation, never the main act) ─────────────────────────────────
const MARKERS = ["that's that", "that is that", "so that's that", "that's everyone", "that is everyone", "that's all of us", "that's all of you", "that's it for introductions", "interesting", "okay", "ok", "alright", "all right", "cool", "well", "right", "good to hear", "so", "anyway", "anyways", "actually", "look", "i mean", "wait", "hang on", "hold on", "huh", "oh", "nice", "great", "fair enough", "got it", "sure", "hmm", "hm", "um", "uh", "ah", "yeah", "yes", "no", "nope", "gotcha", "awesome", "perfect", "good", "wow", "ha", "haha", "lol", "sweet", "neat", "understood", "noted", "thanks", "thank you", "and", "but", "also", "then", "now"];
const MARKER_RELATION = Object.freeze({ "that's that": "close_activity", "that is that": "close_activity", "so that's that": "close_activity", "that's everyone": "close_activity", "that is everyone": "close_activity", "that's all of us": "close_activity", "that's all of you": "close_activity", "that's it for introductions": "close_activity", anyway: "topic_return", anyways: "topic_return", actually: "repair", "i mean": "repair", no: "repair", nope: "repair", so: "continuation", wait: "repair", "hang on": "repair", "hold on": "repair" });
const MARKER_ALT = MARKERS.slice().sort((a, b) => b.length - a.length).map((m) => m.replace(/ /g, "\\s+")).join("|");
// "Good" before a time of day is a greeting ("Good morning"), not a marker.
const LEADING_MARKERS = new RegExp(`^(?:(?:${MARKER_ALT})\\b(?!(?<=good)\\s+(?:morning|afternoon|evening|day|night)\\b)[,.!]*\\s*)+`, "i");
// Politeness / hedging leads that frame a question without changing it ("Quick question: ...",
// "Sorry, but ...", "Just wondering, ..."). The wondering forms need their comma or colon, so "I was
// wondering if ..." (an indirect question) is left alone.
const POLITE_LEAD = /^(?:sorry,?\s+but|(?:sorry|quick question|just (?:a )?quick question|just wondering|i was wondering|i'?m wondering|(?:just )?out of curiosity|just curious|real quick|excuse me|forgive me|pardon me|if i may|if you don'?t mind)\s*[,:])\s*(?=\S)/i;
const ONLY_MARKERS = new RegExp(`^(?:(?:${MARKER_ALT}|that'?s (?:good|great|nice|cool|fair|interesting)|good to (?:hear|know)|nice to (?:hear|know)|glad to hear(?: it)?|sounds good|makes sense|fair enough|got it|i see|no worries|same|me too|nice to meet you(?: all| both| two)?|pleasure|likewise)\\b[\\s,.!]*)+$`, "i");

// ─── social acts ───────────────────────────────────────────────────────────────────────────────────────
const GREETING = /^(?:hey|hi|hello|hiya|howdy|yo|greetings|good ?(?:morning|afternoon|evening|day)|morning|evening|hey there|hi there|hello there)\b/i;
const FAREWELL = /^(?:bye|goodbye|good bye|see you|see ya|see y'?all|later|catch (?:you|ya|y'?all)(?: guys)? later|take care|so long|until next time)\b/i;
const THANKS = /^(?:thanks|thank you|thank ya|thx|cheers|appreciate it|much appreciated)\b/i;
const SELF_INTRO = /\b(?:[Ii]'?m|[Ii] am|[Mm]y name is|[Mm]y name'?s|[Cc]all me|[Yy]ou can call me)\s+(?:[A-Z][A-Za-z'-]*\b(?!\s+(?:too|also))|your (?:new )?(?:expedition lead|lead|team lead|camera operator|teammate|coworker)|the new (?:guy|girl|one|hire|lead|camera operator))/;
// Calls for attention without a "?" ("Earth to Malcolm", "You there?", "Is anybody listening?", "Did you hear
// me?", "Can I get everyone's attention?", "Hey, over here, everybody.") -- a pending question is re-opened.
const ATTENTION_PHRASES = /^(?:earth to \w+|(?:are )?you there|(?:is )?(?:anyone|anybody|somebody|someone) (?:there|home|listening|awake)|(?:are )?you (?:listening|awake|with me)|(?:is )?(?:anyone|anybody) (?:else )?(?:here|around)|did (?:you|anyone|anybody|y'?all|you guys) (?:hear|catch) me|can (?:you|anyone|anybody) hear me|hello\W*(?:anyone|anybody) home|(?:can|could|may) i (?:get|have) (?:everyone'?s|everybody'?s|your(?: all'?s)?|y'?all'?s) attention(?: (?:real quick|for a (?:sec|second|moment)|please))?|(?:hey,?\s+)?over here(?:,?\s+(?:everybody|everyone|guys|folks|people))?|(?:anyone|anybody) knows?)[\s?!.]*$/i;
const ATTENTION_WORDS = /^(?:hello+|hey+|hi+|anyone|anybody|guys|you guys|y'?all|um+|uh+|ahem|excuse me|earth to (?:\w+)|helloo+|yo+|folks|everyone|everybody|people)[\s?!.,]*\?[\s?!]*$|^(?:\.{2,}|…)\s*\?*$|^\?+$/i;
const SARCASM = [
  /^(?:oh\s+)?(?:great|fantastic|wonderful|perfect|lovely|brilliant|awesome|fabulous|terrific)\b[,.!]+\s+(?:a|an|the|just|i'?m|we'?re|so|now)\b/i,
  /\bjust what i (?:always )?(?:wanted|needed)\b/i,
  /^love how\b/i,
  /\bliving the dream\b/i,
  /\bcan'?t wait to\b[\s\S]*\b(?:nobody|no one|won'?t|mystery|dark|scary|unknown)\b/i,
  /\b(?:very|super|so|real|totally)\s+(?:reassuring|comforting|clear|helpful|informative)\b/i,
  /\btotally not (?:suspicious|weird|creepy|ominous|sketchy)\b/i,
  /^(?:mostly|probably|hopefully)\.\s*(?:love|great|cool|nice)\s+(?:that|it)\b/i,
  /\bdoesn'?t even (?:turn on|work)\b[\s\S]*$|^(?:fantastic|great|perfect|wonderful),?\s+the\b/i,
  /\b(?:incredibly|totally|definitely|obviously|surely|really|super|so|very)\s+(?:safe|fine|great|wonderful|fantastic|perfect|clear|reassuring|comforting|normal|relaxing)\b/i,
  /\bwhat could (?:possibly )?go wrong\b/i,
  /\bno (?:problem|issue|concern)s?\s+(?:at all|whatsoever)\b/i,
  /\bsounds?\s+(?:totally|completely|absolutely)\s+(?:normal|fine|safe|good)\b/i,
  /\b(?:yeah|oh),? (?:right|sure)\b.*\b(?:safe|fine|great)\b/i,
  /\bthis (?:seems|looks|sounds|feels) (?:incredibly|totally|super|very|so|perfectly|completely) (?:safe|fine|normal|reassuring)\b/i
];

// ─── meta-conversational repair (partner communication management) ────────────────────────────────────
const TARGET_REPAIR = [
  /^(?:no,?\s+|nope,?\s+|sorry,?\s+|oh,?\s+|wait,?\s+|um+,?\s+|actually,?\s+)?i\s+(?:was|am|'m)\s+(?:speaking|talking|asking|referring)\s+(?:to|at)\s+(?<name>[A-Za-z][A-Za-z'-]+)(?:\s*,?\s*not\s+(?:you|[A-Za-z]+))?\s*(?:[.!?]*\s*)$/i,
  /^(?:no,?\s+|nope,?\s+|sorry,?\s+|oh,?\s+|wait,?\s+)?i\s+(?:asked|meant|said|wanted|was asking|was asking for|am asking|'m asking|was talking to)\s*,?\s+(?<name>[A-Za-z][A-Za-z'-]+)(?:\s*,?\s*not\s+(?:you|[A-Za-z]+))?\s*[.!?]*\s*$/i,
  /^(?:that|this|it|the question)(?:\s+one)?\s+(?:was|is)\s+(?:meant\s+)?(?:for|to)\s+(?<name>[A-Za-z][A-Za-z'-]+)\s*[.!?]*$/i,
  /^i\s+(?:wasn'?t|was not|am not|'m not)\s+(?:asking|talking to|speaking to)\s+(?<exclude>you|[A-Za-z][A-Za-z'-]+)\s*[.!?]*$/i,
  /^(?:no,?\s+)?not\s+(?<exclude>you|[A-Za-z][A-Za-z'-]+)\s*[,.]?\s*(?<name>[A-Za-z][A-Za-z'-]+)?\s*[.!?]*$/i,
  /^(?:no,?\s+|nope,?\s+)?(?:i meant |i was asking )?the other (?:one|person)\s*[.!?]*$/i,
  // "I meant to ask Malcolm that." / "That was for Malcolm." -- the same question, meant for someone else.
  /^(?:wait,?\s+|sorry,?\s+|oh,?\s+)*i\s+(?:meant to ask|wanted to ask|was trying to ask|should have asked)\s+(?<name>[A-Za-z][A-Za-z'-]+)(?:\s+(?:that|this|it))?\s*[.!?]*$/i,
  // "I wasn't asking you, I was asking Tonya." (exclusion + the intended target in one line)
  /^i\s+(?:wasn'?t|was not|am not|'m not)\s+(?:asking|talking to|speaking to)\s+(?<exclude>you|[A-Za-z][A-Za-z'-]+)\s*[,;.]?\s*(?:i\s+(?:was|am|'m)\s+(?:asking|talking to|speaking to)|i\s+meant|i\s+asked)\s+(?<name>[A-Za-z][A-Za-z'-]+)\s*[.!?]*$/i,
  // The whole group was meant ("I meant all of you", "that was for the whole table", "everyone, not just X").
  /^i\s+(?:meant|was asking|asked|was talking to|was speaking to|meant to ask)\s+(?<group>all of you|all three of you|you all|y'?all|everyone|everybody|the whole (?:table|group|team)|both of you|you both|you two|the group|the rest of you|all three)(?:\s*,?\s*not just\s+(?<exclude>[A-Za-z][A-Za-z'-]+))?\s*[.!?]*$/i,
  /^(?:that|this|it|the question)(?:\s+one)?\s+(?:was|is)\s+(?:meant\s+)?for\s+(?<group>everyone|everybody|all of you|the whole (?:table|group|team)|the group|both of you|you both|all three of you)\s*[.!?]*$/i,
  // "Tonya too." / "Tonya too, I asked you both." -- the one who has not answered yet.
  /^(?<name>[A-Za-z][A-Za-z'-]+)\s+too\s*[,.]?\s*(?:i\s+asked\s+(?:you\s+both|both of you|you two|everyone|all of you))?\s*[.!?]*$/i,
  // "I didn't ask you, Giselle." (the one who answered is excluded; the one asked is meant)
  /^i\s+(?:didn'?t|did not)\s+ask\s+(?<exclude>you|[A-Za-z][A-Za-z'-]+)\s*,?\s*(?:[A-Za-z][A-Za-z'-]+)?\s*[.!?]*$/i,
  // "Malcolm, I meant." / "I meant you, Malcolm, not Tonya."
  /^(?<name>[A-Za-z][A-Za-z'-]+)\s*,?\s+i\s+meant\s*[.!?]*$/i,
  /^i\s+meant\s+you\s*,?\s*(?<name>[A-Za-z][A-Za-z'-]+)\s*,?\s*(?:not\s+(?<exclude2>you|[A-Za-z][A-Za-z'-]+))?\s*[.!?]*$/i
];
// Repair fillers around the core ("Scratch that, I meant Tonya", "Oops, wrong person.", "... actually").
const REPAIR_LEAD = /^(?:(?:scratch that|oops|whoops|my bad|wrong person|hold on|hang on|wait|sorry|no|nope|actually|um+|uh|ok|okay|glad to hear(?: it)?|thanks|cool|right|good|great)[,.!]*\s+(?:but\s+)?)+/i;
const REPAIR_TAIL = /\s*,?\s*\b(?:actually|though|btw|by the way|then|please)\s*([.!?]*)$/i;
function repairSources(...texts) {
  const out = [];
  for (const text of texts) {
    const t = String(text ?? "").trim();
    if (!t) continue;
    out.push(t);
    const core = t.replace(REPAIR_LEAD, "").replace(REPAIR_TAIL, "$1").trim();
    if (core && core !== t) out.push(core);
    // Hedging adverbs inside the repair ("I was actually asking all of you").
    const plain = (core || t).replace(/\b(?:actually|really|just|only)\s+/gi, "").trim();
    if (plain && !out.includes(plain)) out.push(plain);
  }
  return [...new Set(out)];
}
const UNANSWERED_REPAIR = [
  /^(?:no,?\s+|um+,?\s+|well,?\s+|but\s+)?i\s+(?:asked|was asking|am asking|'m asking|just asked)\s+(?<embedded>(?:if|whether|what|where|who|when|why|how|which|about)\b[\s\S]*?)\s*[.!?]*$/i,
  /^(?:that'?s|that is)\s+not\s+what\s+i\s+(?:asked|meant|was asking)\b[\s\S]*$/i,
  /^(?:you|nobody|no one)\s+(?:didn'?t|did not|never|hasn'?t|has not)\s+(?:answer(?:ed)?|respond(?:ed)?\s+to|reply\s+to)(?:\s+(?:me|my question|that|the question))?\s*[.!?]*$/i,
  /^(?:that|this)\s+(?:didn'?t|did not|doesn'?t|does not)\s+answer\s+(?:my|the)\s+question\s*[.!?]*$/i,
  /^(?:(?:can|could|would)\s+(?:someone|anyone|you)\s+)?(?:please\s+)?answer\s+(?:me|the question|my question)\s*[.!?]*$/i,
  /^my question was\s+(?<embedded>[\s\S]+?)\s*[.!?]*$/i,
  /^(?:that'?s|that is|this is|that isn'?t|this isn'?t)\s+(?:not\s+)?(?:really\s+)?(?:an?\s+)?answer\b[\s\S]*$/i,
  // "I mean like how long have you worked here" / "I meant are YOU nervous": the question, re-asked.
  /^i\s+mean(?:t)?\s+(?:like\s+)?(?!(?:where|when|why|who|how|what)\s*,?\s*not\b)(?<embedded>(?:how|what|where|when|who|why|which|are|is|am|do|does|did|have|has|can|could|will|were|was)\b\s+\S[\s\S]*?)\s*[.!?]*$/i,
  // "I know where it is, I asked who has it."
  /^i\s+(?:know|get|heard)\s+[^,]+,\s*(?:but\s+)?i\s+(?:asked|was asking|am asking)\s+(?<embedded>(?:if|whether|what|where|who|when|why|how|which)\b[\s\S]*?)\s*[.!?]*$/i
];
// "I meant where, not why." / "Not today. Ever." / "No, before that." / "I meant the Complex."
const FACET_REPAIR = [
  /^(?:no,?\s+)?(?:i\s+meant\s+|i\s+asked\s+)?(?<want>where|when|why|who|how|what)\s*,?\s*not\s+(?<not>where|when|why|who|how|what)\b/i,
  /^(?:no,?\s+)?not\s+(?<not>today|now|ever|earlier|before)\s*[.!,]+\s*(?<want>today|now|ever|earlier|before|in general)\s*[.!?]*$/i,
  /^(?:no,?\s+)?(?:i meant\s+)?(?<want>ever|before that|earlier|in general|at all)\s*[.!?]*$/i,
  /^(?:no,?\s+|nope,?\s+)?i\s+(?:meant|mean|was asking about|was talking about)\s+(?<referent>(?:the\s+)?[A-Za-z][\w -]{1,40}?)\s*[.!?]*$/i,
  /^(?:no,?\s+)?what\s+(?:are|is)\s+(?:they|it|those|that)\s+for\b/i
];
// Elliptical continuation: the predicate comes from the antecedent request / activity.
const ELLIPSIS = [
  /^(?:and|so|well|okay|ok|alright)?,?\s*(?:how|what)\s+about\s+(?<who>you(?:\s+(?:two|three|all|guys|both))?|y'?all|both of you|all of you|the (?:rest of you|others|other two|other one)|everyone else|(?:the|that|this|my|your)\s+[a-z][\w -]{1,30}?(?=\s*(?:too|as well)?\s*[?.!]*$)|[A-Za-z][A-Za-z'-]+(?:\s*(?:,|and|&)\s*[A-Za-z][A-Za-z'-]+)*)\b[\s\S]*$/i,
  /^(?:and|so)\s+(?<who>you(?:\s+(?:two|three|all|guys|both))?|y'?all|[A-Za-z][A-Za-z'-]+)\s*[?!.]*$/i,
  /^(?:(?<name1>[A-Za-z][A-Za-z'-]+)\s*,?\s*)?(?:(?:it'?s|its)\s+)?your\s+turn\b(?:\s*,?\s*(?<name2>[A-Za-z][A-Za-z'-]+))?\s*[.!?]*$/i,
  /^(?:(?<name1>[A-Za-z][A-Za-z'-]+)\s*,?\s*)?(?:you'?re\s+up|you\s+are\s+up|you\s+next|now\s+you|over to you|same\s+(?:question|for you|goes for you)|and\s+you)(?:\s*,?\s*(?<name2>[A-Za-z][A-Za-z'-]+))?\s*[.!?]*$/i,
  /^(?<who>you\s+(?:two|three|all|guys|both)|y'?all|the (?:rest of you|others))\s*(?:too|as well)?\s*\?+$/i,
  /^(?:and\s+)?(?<who>you)\s*\?*$/i,
  // Round-taking: "You first, Tonya", "Giselle, you wanna start", "Malcolm, bring us home", "Who's next?"
  /^(?:(?<name1>[A-Za-z][A-Za-z'-]+)\s*,?\s*)?(?:you (?:wanna|want to) (?:start|go first|kick (?:us|it) off|go next|go)|bring us home|you'?re (?:last|next)|you first|your go|go ahead|take it away|kick (?:us|it) off|start us off|you start)(?:\s*,?\s*(?<name2>[A-Za-z][A-Za-z'-]+))?\s*[.!?]*$/i,
  /^(?:so\s+|okay,?\s+|ok,?\s+)?who(?:'s| is| wants to go| goes)\s+(?:next|last)\s*\??$/i,
  /^(?:and\s+)?(?<who>the (?:last (?:of us|one|person)|remaining (?:one|two)|other (?:one|two)))\s*\??$/i,
  // A thing, continued: "And the radio?", "the radio too?"
  /^(?:and|also)\s+(?<who>(?:the|that|this|my|your)\s+[a-z][\w -]{1,30}?)\s*(?:too|as well)?\s*[?.!]*$/i,
  /^(?<who>(?:the|that|this|my|your)\s+[a-z][\w -]{1,30}?)\s+(?:too|as well)\s*[?.!]*$/i,
  // Sequence: "then what?", "and after that?"
  /^(?:and\s+|so\s+)?(?:then\s+(?:what|where|after that|what after that)|after that|what after that|what then)\s*[?.!]*$/i,
  // Challenge of the last answer, same person: "not even a little?", "you sure?"
  /^(?:not\s+even\s+(?:a\s+)?(?:little|bit|tiny bit)(?:\s+\w+)?|you sure|are you sure)\s*\?+$/i,
  // Auxiliary-only ellipsis: "Have you?", "Did you?", "Are you?", "And have you, Tonya?"
  /^(?:and\s+|so\s+|well\s+)?(?:have|has|did|do|does|are|is|were|was|will|would|can|could)\s+(?<who>you(?:\s+(?:two|guys|all|both))?)(?:\s+too)?\s*\?*$/i
];
// Politeness tails and parentheticals ("..., if you don't mind me asking?", "And Tonya, if you don't mind,
// what about you?") frame a question without changing it (D13).
const POLITE_TAIL = /,?\s*\b(?:if (?:you|u) (?:don'?t|do not) mind(?: me asking)?|if i may(?: ask)?|if (?:that'?s|it'?s|that is|it is) (?:okay|ok|alright|all right)(?: with you)?|if you could|by any chance|out of interest|out of curiosity|please)\b(?=\s*(?:[,?.!]|$))/gi;
function stripPoliteTails(text) {
  const out = String(text).replace(POLITE_TAIL, "").replace(/\s+([,?.!])/g, "$1").replace(/,\s*,/g, ",").replace(/^\s*,\s*/, "").trim();
  return out || String(text);
}
const UNPUNCTUATED = (text) => !/[.!?…]\s*$/.test(String(text).trim());
const GREETING_INTRO_LOWER = /\bi(?:'?m| am)\s+(?!(?:fine|good|okay|ok|well|great|here|back|new|nervous|tired|excited|ready|sorry|glad|happy|alright|doing|so|not|just|the|a|an|your|also|too|very|really|pretty|feeling|going|looking|all|in|on|at)\b)[a-z][a-z'-]+\s*(?:[,.!]|$|and\b)/i;
const BARE_WH = /^(?:why|when|where|who|how|how come|which|what for|how so)\s*[?!.]*$/i;

// ─── questions ─────────────────────────────────────────────────────────────────────────────────────────
const WH = /^(?:who|whom|whose|what|where|when|why|how|which)\b/i;
const YES_NO = /^(?:are|is|am|do|does|did|can|could|will|would|have|has|had|should|shall|was|were|may|might|must|ain'?t|isn'?t|aren'?t|don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|won'?t|wouldn'?t|couldn'?t|shouldn'?t)\b/i;
const TAG = /,\s*(?:right|yeah|no|huh|eh|isn'?t it|aren'?t you|aren'?t we|don'?t you|didn'?t you|haven'?t you|is it|are you|correct)\s*\?\s*$/i;
const INDIRECT = /^(?:i\s+(?:wonder|wondered|was wondering|am wondering|'m wondering|'d love to know|would love to know|'d like to know|would like to know|want to know|wanna know|need to know)|any idea|anyone know|anybody know|does anyone know|do you know|do you happen to know|i'?m curious|curious)\b/i;
const REQUEST = /^(?:(?:can|could|would|will)\s+(?:you|y'?all|you all|you guys|someone|anyone|one of you)\b(?!\s+(?:even|actually|really)\s+(?:go|get|do|come|be))|please\b|(?:would|do)\s+you\s+mind\b|mind\s+(?:telling|sharing|introducing|explaining|giving)\b|tell\s+(?:me|us)\b|introduce\b|give\s+(?:me|him|her|them|us)\b|let'?s\b|go ahead\b|share\b|describe\b|explain\b|say\b|(?:i\s+would|i'?d)\s+(?:love|like)\s+to\s+(?:hear|learn)\b|(?:hand|pass|take|bring|grab|wait|stay|come|follow|check|show|help)\b(?!\s+(?:is|was|are)\b))/i;
const ABILITY = /^(?:can|could)\s+(?:you|we|anyone)\s+(?:even|actually|really|still|ever)?\s*(?:go|get|come|enter|leave|cross|walk|carry|see|hear|breathe|survive|be)\b/i;

// ─── quantifiers / group address (D8) ─────────────────────────────────────────────────────────────────
const QUANTIFIERS = [
  ["except", /\b(?:everyone|everybody|all of you|you all)\s+(?:except|but|besides|other than)\s+(?<name>[A-Za-z][A-Za-z'-]+)\b/i],
  ["rest", /\b(?:the rest of you|the others|the other two|the other one|everyone else|you other two)\b/i],
  ["two", /\b(?:you two|both of you|you both|either of you|neither of you)\b/i],
  ["three", /\b(?:you three|all three of you)\b/i],
  ["any", /\b(?:anyone|anybody|any of you|does anyone|do any of you|whoever knows|somebody|someone)\b/i],
  ["all", /\b(?:everyone|everybody|you all|y'?all|all of you|you guys|you folks|guys|team|each of you|every one of you|you lot|yourselves)\b/i],
  ["just", /\bjust\s+(?<name>[A-Za-z][A-Za-z'-]+)\b/i]
];
const WE_ALL = /\b(?:we all|all of us|we both|both of us|the whole team|all together|together)\b/i;

// ─── temporal scope (D11) ─────────────────────────────────────────────────────────────────────────────
const TEMPORAL = [
  ["ever", /\b(?:ever|before|already|previously|in the past|last time|before today)\b/i],
  ["today", /\b(?:today|this morning|first day)\b/i],
  ["earlier", /\b(?:earlier|just now|a (?:minute|moment|second|while) ago|back then|before that)\b/i],
  ["now", /\b(?:now|right now|currently|at the moment|still|anymore|yet|this morning)\b/i]
];

const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits the repaired line into clauses (sentences, then "?"-final fragments). Spans index `repaired`. */
function segment(repaired) {
  // Title abbreviations ("Dr. Maxwell") do not end a sentence: their dot is masked while splitting.
  const ABBR = /\b(Dr|Mr|Mrs|Ms|St|Sgt|Lt|Capt|Prof)\.(?=\s+[A-Z])/g;
  const text = String(repaired ?? "").replace(ABBR, "$1\u2024");
  const out = [];
  const re = /[^.?!…]+(?:[.?!…]+|$)/g;
  for (const m of text.matchAll(re)) {
    const piece = m[0].replace(/\u2024/g, ".");
    if (!piece.trim()) continue;
    const lead = piece.length - piece.trimStart().length;
    out.push({ text: piece.trim(), start: m.index + lead, end: m.index + piece.trimEnd().length });
  }
  // Coordinated questions are separate acts: "Who is Maxwell and what does he do?", "Is this your first
  // day, and have you been in there before?" (the second conjunct starts its own question).
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const piece = out[i];
    const m = piece.text.match(/^((?:[A-Za-z][\w'-]*,?\s+|(?:so|okay|ok|and|well|also)\s+)?(?:who|what|where|when|why|how|which|is|are|do|does|did|have|has|can|could|will|would)\b[^?]*?),?\s+(?:and|but)\s+((?:who|what|where|when|why|how|which|is|are|do|does|did|have|has|can|could|will|would)\s+(?:is|are|was|were|do|does|did|you|we|he|she|they|it|has|have|the|anyone)\b[\s\S]*)$/i);
    if (!m) continue;
    const firstEnd = piece.start + m[1].length;
    out.splice(i, 1, { text: `${m[1].trim()}?`, start: piece.start, end: firstEnd }, { text: m[2].trim(), start: piece.end - m[2].length, end: piece.end, coordinated: true });
  }
  // "Or just myself." / "or just mine?" continuing a question is one choice question with its alternative.
  for (let i = out.length - 1; i > 0; i -= 1) {
    if (/^(?:or\b|or,)/i.test(out[i].text) && /\?\s*$|\bor\b/.test(out[i - 1].text)) {
      out[i - 1] = { text: `${out[i - 1].text.replace(/[.?!]+$/, "")} ${out[i].text}`, start: out[i - 1].start, end: out[i].end, merged_alternative: true };
      out.splice(i, 1);
    }
  }
  // "So you've been there before? This Complex?": a noun-phrase fragment after a question elaborates it.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const words = out[i].text.replace(/[?!.,]/g, " ").trim().split(/\s+/);
    if (/\?\s*$/.test(out[i - 1].text) && /\?\s*$/.test(out[i].text) && words.length <= 4 && /^(?:this|that|the|in|to|at|inside)\b/i.test(out[i].text)) {
      out[i - 1] = { text: `${out[i - 1].text.replace(/\?+\s*$/, "")}, ${out[i].text.replace(/^,\s*/, "")}`, start: out[i - 1].start, end: out[i].end, apposition: out[i].text.replace(/[?!.,]/g, "").trim() };
      out.splice(i, 1);
    }
  }
  return out;
}

/** Leading discourse markers of a clause, and the clause without them. */
function stripMarkers(text) {
  let source = String(text).trim();
  const markers = [];
  // Markers and politeness leads interleave ("So, sorry, but ..."): strip both to a fixed point.
  for (let progressed = true; progressed;) {
    progressed = false;
    const polite = source.match(POLITE_LEAD);
    if (polite) { markers.push(polite[0].replace(/[,:\s]+$/, "").toLowerCase()); source = source.slice(polite[0].length); progressed = true; continue; }
    const match = source.match(LEADING_MARKERS);
    // A marker run that is the whole clause stays the clause's words (an acknowledgment).
    if (match && match[0].length) { markers.push(...match[0].toLowerCase().split(/[,.!]+|\s{2,}/).map((m) => m.trim()).filter(Boolean)); source = source.slice(match[0].length); progressed = true; }
  }
  if (!markers.length) return { markers: [], rest: String(text).trim() };
  let rest = source.trim();
  if (/^[\s?!.,…]*$/.test(rest)) rest = "";
  // A marker-only clause keeps its words (it IS the act: an acknowledgment).
  return rest ? { markers, rest } : { markers, rest: "" };
}

// Tokens after which a clause-final name (no comma) is a VOCATIVE rather than an object/complement.
const VOCATIVE_PRECEDERS = /(?:doing|going|feeling|holding up|up|today|now|morning|there|too|yet|then|yourself|again|either|already|first|right|ready|okay|ok|alright|fine|coming|here|this morning|at all|really|though|honestly|please|you|mate|guys)$/i;
const MENTION_VERBS = /\b(?:see|saw|seen|ask|asked|asking|meant|meaning|tell|told|about|with|to|for|from|and|or|than|like|by|of|is|was|are|were|meet|met|know|knew|call|called|help|find|found|where|where'?s|who|who'?s|get|got|give|gave|hand|pass|bring|take|took|heard|hear|trust|follow|let|make|made)$/i;

/**
 * Vocatives of one clause, by position and syntax (never by the mere presence of a name):
 *   leading "Tonya, ...", "Tonya tell me ..." (followed by an addressed clause), greeting + name,
 *   trailing ", Tonya?" and clause-final "...this morning Giselle?", appositive name list after a
 *   second-person group ("you two, Malcolm, and Tonya"), and a bare "Tonya?".
 * Returns { vocatives:[{name, id, form}], residual, mentions:[{name,id}] }.
 */
function findVocatives(clause, people = []) {
  let text = String(clause ?? "").trim();
  const index = new Map();
  for (const p of people) for (const n of p.names ?? [p.name]) if (n) index.set(String(n).toLowerCase(), p.id ?? null);
  const names = [...index.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  if (!names.length) return { vocatives: [], residual: text, mentions: [] };
  const NAME = `(?:${names.join("|")})`;
  const LIST = `${NAME}(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${NAME})*`;
  const vocatives = [];
  const take = (listText, form) => {
    for (const item of listText.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\s*/i).map((s) => s.trim()).filter(Boolean)) {
      const id = index.get(item.toLowerCase());
      if (id !== undefined && !vocatives.some((v) => v.name.toLowerCase() === item.toLowerCase())) vocatives.push({ name: item, id, form });
    }
  };
  const ADDRESSED = /^(?:tell|give|hand|pass|take|come|look|help|check|wait|stay|show|let|please|what|who|where|when|why|how|which|can|could|would|will|do|did|are|is|have|were|you|your|introduce|say|share|any|have|mind|go|it'?s|its|same|and|so|quick|real quick)\b/i;
  let m;
  // Standalone "Tonya?" / "Tonya!" / "Tonya and Malcolm?"
  if ((m = text.match(new RegExp(`^(?:(hey|hi|hello|oi|yo)\\s*,?\\s*)?(${LIST})\\s*([?!.]*)$`, "i")))) {
    // "Tonya?" / "Hey Tonya?" call for attention; "Hey Tonya" / "Hi Malcolm!" greet that person.
    if (m[1] && !m[3].includes("?")) { take(m[2], "greeting"); return { vocatives, residual: m[1], mentions: [] }; }
    take(m[2], "bare"); return { vocatives, residual: "", mentions: [] };
  }
  // Greeting + names ("Good morning, Tonya", "Hey Malcolm, ...").
  if ((m = text.match(new RegExp(`^((?:hey|hi|hello|hiya|howdy|yo|good ?(?:morning|afternoon|evening)|morning)(?:\\s+there)?)[\\s,]+(${LIST})\\b\\s*[,.!?:;-]*\\s*([\\s\\S]*)$`, "i")))) {
    take(m[2], "greeting");
    text = m[3].trim() ? m[3].trim() : m[1];
    if (/^(?:hey|oi|yo)$/i.test(m[1]) && m[3].trim()) text = m[3].trim();
  }
  // Leading vocative list with a delimiter, or no delimiter before an addressed clause.
  if ((m = text.match(new RegExp(`^(${LIST})\\s*[,:]\\s*([\\s\\S]*\\S[\\s\\S]*)$`, "i"))) && !/^(?:and|&)\b/i.test(m[2]) && !/^(?:i|me|myself)\b/i.test(m[2])) { take(m[1], "leading"); text = m[2].trim(); }
  // ("giselle is it tonya's first day": an inverted question after the name is addressed to her; "Tonya is
  // nervous" is about her.)
  else if ((m = text.match(new RegExp(`^(${NAME})\\s+([\\s\\S]*\\S[\\s\\S]*)$`, "i"))) && ADDRESSED.test(m[2]) && (!/^(?:is|was|has|had|will|would|did|does|and|or|said|told)\b/i.test(m[2]) || /^(?:is|was|has|will|would|did|does)\s+(?:it|this|that|there|anyone|anybody|everyone|everybody|you|he|she|they|we)\b/i.test(m[2]))) { take(m[1], "leading"); text = m[2].trim(); }
  // Parenthetical vocative inside a second-person question: "Is this your first day at ASYNC, Tonya, or have
  // you been here a while?"
  if ((m = text.match(new RegExp(`^([\\s\\S]*?\\b(?:you|your|yourself)\\b[^,]*?)\\s*,\\s*(${NAME})\\s*,\\s*((?:or|and|but|so)\\b(?!\\s+${LIST}\\s*[?!.]*$)[\\s\\S]*)$`, "i")))) { take(m[2], "trailing"); text = `${m[1]} ${m[3]}`.trim(); }
  // Appositive list after a second-person group: "How about you two, Malcolm, and Tonya?"
  if ((m = text.match(new RegExp(`^([\\s\\S]*?\\b(?:you two|you three|you both|both of you|you all|you guys|y'?all|all of you|you))\\s*,\\s*(${LIST})\\s*([?!.]*)\\s*$`, "i")))) { take(m[2], "apposition"); text = `${m[1]}${m[3]}`.trim(); }
  // Trailing vocative after a comma: "..., Tonya?"
  else if ((m = text.match(new RegExp(`^([\\s\\S]*?[^\\s,])\\s*,\\s*(${LIST})\\s*([?!.]*)\\s*$`, "i")))) { take(m[2], "trailing"); text = `${m[1]}${m[3]}`.trim(); }
  // Clause-final name with no comma, after a complete second-person clause: "How are you doing this morning Giselle?"
  else if ((m = text.match(new RegExp(`^([\\s\\S]*?\\b(\\w+))\\s+(${NAME})\\s*([?!.]*)\\s*$`, "i"))) && (/\b(?:you|your|yourself)\b/i.test(m[1]) || /^(?:excited|nervous|tired|scared|worried|ready|okay|ok|alright|all right|good|new|same|same question|same q|your turn|and you|you)$/i.test(m[1].trim())) && !MENTION_VERBS.test(m[2])) { take(m[3], "trailing_bare"); text = `${m[1]}${m[4]}`.trim(); }
  // Everything else a name appears in is a mention (subject/object of the clause), never an address.
  const mentions = [];
  for (const [name, id] of index) if (new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(text) && !vocatives.some((v) => v.name.toLowerCase() === name)) mentions.push({ name, id });
  return { vocatives, residual: text, mentions };
}

function questionForm(text, expanded) {
  const t = String(text).trim();
  if (TAG.test(t)) return "tag";
  if (INDIRECT.test(expanded)) return "indirect";
  if (/\bor\b[^?]*\?|\bor (?:just|only)\b/i.test(t) && (YES_NO.test(t) || WH.test(t) || /\?/.test(t))) return "choice";
  if (WH.test(t)) return "wh";
  if (YES_NO.test(t)) return "yes_no";
  if (/\?\s*$/.test(t)) return "declarative";
  return null;
}

function quantifierOf(expanded) {
  for (const [kind, pattern] of QUANTIFIERS) {
    const match = String(expanded).match(pattern);
    if (match) return { kind, text: match[0], name: match.groups?.name ?? null };
  }
  return null;
}
function temporalOf(expanded) {
  const hits = TEMPORAL.filter(([, pattern]) => pattern.test(expanded)).map(([scope]) => scope);
  if (!hits.length) return null;
  // "first day ... today" is today; "ever/before" dominates "now" for experience; explicit "earlier" wins over "now".
  return hits.includes("today") ? "today" : hits[0];
}

// ─── indirect questions (D13) ──────────────────────────────────────────────────────────────────────────
// A question wrapped in politeness ("Could someone remind me what Maxwell told us to do?", "Would anyone
// happen to know where we're headed?", "Is it alright if I ask whether any of you are tired?") IS the
// embedded question. The wrapper is removed and the embedded clause put back into direct-question order.
const INDIRECT_WRAPPERS = [
  /^(?:any of you|either of you|anyone here|anybody here|any of y'?all) (?:know|knows|remember)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:not (?:gonna|going to) lie,?\s+)?(?:i (?:have )?no (?:clue|idea)|no (?:clue|idea)|i'?m not sure|not sure|i (?:do not|don'?t) (?:even |really )?know|i dunno|dunno)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:someone|somebody|anyone|anybody|please|you)\s+tell (?:me|us)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:did |does )?(?:anyone|anybody|you|someone) (?:catch|hear|get|remember)\s+(?!what (?:i|we) (?:just )?(?:said|asked|told)\b)(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:(?:anyone|anybody|someone|somebody) (?:want|wanna|care) to|would (?:someone|anyone|you) (?:like|care) to) (?:tell|explain to|remind) (?:me|us)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:i'?d|i would) (?:love|like) to (?:hear|know|find out)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:(?:it )?would be (?:nice|good|great) to know|good to know|(?:i'?m |just )?curious)\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^i\s+(?:was wondering|wonder|wondered)\s+if\s+(?:anyone|anybody|you|someone)\s+knows?\s+(?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:please )?(?:tell|remind|let) (?:me|us)(?: know)?(?: again)?(?:,)? (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:could|would|can|will) (?:you|someone|anyone|somebody|one of you|any of you|you all|you guys)(?: please)?(?: just)? (?:tell|remind|let) (?:me|us)(?: know)?(?: again)? (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:would|do|does|did) (?:you|anyone|anybody|someone|somebody|any of you|either of you|you all|you guys)(?: (?:happen to|by any chance|actually))? know (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:would|do) you mind (?:telling|reminding|letting) (?:me|us)(?: know)? (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:i (?:was wondering|am wondering|wonder|wondered|would like to know|would love to know|want to know|am curious)|i'm curious|just curious|any idea|does anyone know|does anybody know|anyone know|anybody know) (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/,
  /^(?:is it (?:alright|all right|okay|ok|fine) if i ask|may i ask|can i ask|could i ask|mind if i ask)(?: you(?: all)?)? (?<q>(?:what|where|who|when|why|how|which|whether|if)\b.+)$/
];
const AUX_WORDS = "is|are|was|were|am|will|would|can|could|should|has|have|had|do|does|did";
const PAST_LEMMA = { told: "tell", said: "say", went: "go", meant: "mean", did: "do", gave: "give", asked: "ask", wanted: "want", needed: "need", planned: "plan", sent: "send", assigned: "assign", brought: "bring" };
function directQuestion(embedded) {
  // Filler adverbs carry no facet ("where exactly we're headed" asks where we're headed).
  const q = String(embedded).replace(/[?.!\s]+$/, "").replace(/\b(?:exactly|actually|really|precisely|roughly|basically)\b\s*/g, "").replace(/\s+/g, " ").trim();
  const aux = new Set(AUX_WORDS.split("|"));
  const isPast = (w) => Boolean(PAST_LEMMA[w]) || (/^[a-z]{3,}ed$/.test(w) && !["need", "red", "bed"].includes(w));
  const rebuild = (lead, words) => {
    // The first auxiliary / past verb after the subject marks the clause's verb.
    for (let i = 1; i < Math.min(words.length, 6); i += 1) {
      // "what the spectrometer does" -> "what does the spectrometer do"
      if (["do", "does", "did"].includes(words[i]) && i === words.length - 1) return [lead, words[i], ...words.slice(0, i), "do"].filter(Boolean).join(" ");
      if (aux.has(words[i])) return [lead, words[i], ...words.slice(0, i), ...words.slice(i + 1)].filter(Boolean).join(" ");
      if (isPast(words[i])) return [lead, "did", ...words.slice(0, i), PAST_LEMMA[words[i]] ?? words[i].replace(/ed$/, ""), ...words.slice(i + 1)].filter(Boolean).join(" ");
    }
    return null;
  };
  const yn = q.match(/^(?:whether|if) (?<tail>.+)$/);
  if (yn) return rebuild("", yn.groups.tail.split(" ")) ?? yn.groups.tail;
  const wh = q.match(/^(?<wh>how (?:long|many|much|often|far)|which \w+|what (?:time|kind of \w+|sort of \w+)|what|where|who|when|why|how)\b\s*(?<tail>.*)$/);
  if (!wh) return q;
  const words = wh.groups.tail.split(" ").filter(Boolean);
  // "who is carrying the camera" / "who has the camera": already direct order.
  if (!words.length || aux.has(words[0]) || isPast(words[0]) || /s$/.test(words[0]) && !/ss$/.test(words[0]) && words.length > 1 && !aux.has(words[1])) return q;
  // Present tense with no auxiliary ("when we leave"): do-support for a plural/second-person subject.
  return rebuild(wh.groups.wh, words) ?? (/^(?:we|you|they|i)$/.test(words[0]) && words.length > 1 ? `${wh.groups.wh} do ${words.join(" ")}` : q);
}
function unwrapIndirect(expanded) {
  const text = String(expanded ?? "").toLowerCase().replace(/[?.!\s]+$/, "").trim();
  for (const pattern of INDIRECT_WRAPPERS) {
    const m = text.match(pattern);
    if (m?.groups?.q) return { wrapper: text.slice(0, text.length - m.groups.q.length).trim(), embedded: m.groups.q, direct: directQuestion(m.groups.q) };
  }
  return null;
}

/**
 * Classifies one clause into an act (without context). Returns a partial act frame.
 */
function clauseAct(clause, { people = [] } = {}) {
  // "@Nora what?" / "@Nora, what?": an @mention is a vocative (the name, without the sigil).
  const cleanText = String(clause.text).replace(/(^|\s)@\s?(?=[A-Za-z])/g, "$1");
  // "Now what?" / "and then what" are questions in their own right, not a marker before a bare "what".
  const stripped = stripMarkers(stripPoliteTails(cleanText));
  // "(Um,) now what?": "now" is not just a marker here -- the line asks what happens now.
  const { markers, rest } = stripped.markers.some((m) => /\bnow$/i.test(m)) && /^what\s*[?.!]*$/i.test(stripped.rest) ? { markers: stripped.markers, rest: "What now?" } : stripped;
  const raw = rest || clause.text;
  const voc = findVocatives(raw, people);
  // Filler adverbs in a question carry no facet ("Who exactly is Maxwell?" asks who Maxwell is).
  const body = (/\?\s*$|^(?:who|what|where|when|why|how|which)\b/i.test(voc.residual) ? voc.residual.replace(/\s+\b(?:exactly|precisely)\b/gi, "") : voc.residual)
    // "What did you mean (by that)?" asks what the line means, as "What do you mean?" does.
    .replace(/^what did you mean\b/i, "What do you mean");
  const bodyExpanded = normalizeUtterance(body).expanded;
  const act = {
    span: [clause.start, clause.end],
    text: clause.text,
    body,
    body_expanded: bodyExpanded,
    markers,
    marker_relation: markers.map((m) => MARKER_RELATION[m.replace(/\s+/g, " ")]).find(Boolean) ?? null,
    closes_activity: markers.some((m) => /\bthat(?:'s| is) (?:that|everyone|all of (?:us|you)|it for introductions)\b/i.test(m)),
    vocatives: voc.vocatives,
    mentions: voc.mentions,
    speech_act: null,
    question_form: null,
    repair: null,
    ellipsis: null,
    attention: false,
    quantifier: quantifierOf(bodyExpanded),
    we_all: WE_ALL.test(bodyExpanded),
    temporal_scope: temporalOf(bodyExpanded),
    alternatives: null,
    predicate_candidates: [],
    polarity: /\b(?:not|never|no)\b/.test(bodyExpanded) && !/^(?:no|not)\b/.test(bodyExpanded) ? "negative" : "positive",
    apposition: clause.apposition ?? null,
    coordinated: Boolean(clause.coordinated)
  };
  const trimmed = body.replace(/[\s]+/g, " ").trim();
  // "Have you and Tonya been in?": Tonya is asked too (a coordinated subject with "you").
  for (const m of body.matchAll(/\byou and ([A-Za-z][A-Za-z'-]+)\b/gi)) {
    const person = people.find((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === m[1].toLowerCase()));
    if (person && !act.vocatives.some((v) => v.id === person.id)) { act.vocatives.push({ name: person.name, id: person.id, form: "you_and" }); act.mentions = act.mentions.filter((x) => x.id !== person.id); }
  }
  // "Can I ask you something?" asks for attention before the question itself.
  if (/^(?:can|could|may) i ask (?:you )?(?:something|a question|you something)(?: real quick| quickly)?\s*[?.!]*$/i.test(trimmed)) { act.speech_act = "attention_call"; act.attention = true; return act; }
  // "I think that's everyone introduced now." closes the introductions round like "that's that".
  if (/^(?:i think |i guess |okay,? |so,? |well,? |right,? )?that(?:'s| is) (?:everyone|everybody|all of us|all of you)(?: (?:introduced|done|then|now|here))*\s*[.!]*$/i.test(trimmed)) { act.closes_activity = true; act.speech_act = "social_acknowledgment"; return act; }
  // Marker-only / social clauses. A lone marker ASKED ("Huh?", "Sorry?", "Right?") is a reflex follow-up
  // on the preceding exchange (the legacy frame reads it as a clarification request), never an acknowledgment.
  if (!trimmed && !voc.vocatives.length && /\?\s*$/.test(clause.text)) { act.speech_act = "question"; act.question_form = "wh"; act.body = clause.text.trim(); act.body_expanded = normalizeUtterance(act.body).expanded; act.reflex = true; return act; }
  if (!trimmed && !voc.vocatives.length) { act.speech_act = markers.some((m) => /^(?:thanks|thank you)$/.test(m)) ? "thanks" : "social_acknowledgment"; return act; }
  // "And Tonya?" / "So, Malcolm?": a name after a continuation marker carries the last question to them.
  if (!trimmed && voc.vocatives.length && markers.some((m) => /^(?:and|so|also|then)$/i.test(m)) && (/\?\s*$/.test(clause.text) || UNPUNCTUATED(clause.text))) { act.speech_act = "elliptical_continuation"; act.ellipsis = { kind: "how_about", who: voc.vocatives.map((v) => v.name).join(", ") }; act.question_form = "wh"; return act; }
  // "Thanks Malcolm" / "thanks man": thanks (to that person), not a call for attention.
  const thanked = markers.some((m) => /\b(?:thanks|thank you)$/i.test(m));
  if (thanked && (!trimmed || /^(?:man|mate|dude|guys|all|everyone|everybody|so much|a lot|again|buddy|folks|y'?all|pal|friend)[.!]*$/i.test(trimmed))) { act.speech_act = "thanks"; return act; }
  if (!trimmed && voc.vocatives.length) { act.speech_act = "attention_call"; act.attention = true; return act; }
  if (ATTENTION_WORDS.test(trimmed) || ATTENTION_PHRASES.test(trimmed) || ATTENTION_PHRASES.test(String(raw).trim())) {
    // "Earth to Malcolm": the name is who is being called.
    const earth = String(raw).match(/^earth to ([A-Za-z][A-Za-z'-]+)/i)?.[1];
    const person = earth ? people.find((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === earth.toLowerCase())) : null;
    if (person && !act.vocatives.some((v) => v.id === person.id)) { act.vocatives.push({ name: person.name, id: person.id, form: "attention" }); act.mentions = act.mentions.filter((m) => m.id !== person.id); }
    act.speech_act = "attention_call"; act.attention = true; return act;
  }
  if (ONLY_MARKERS.test(trimmed)) { act.speech_act = /\b(?:thanks|thank you)\b/i.test(trimmed) ? "thanks" : "social_acknowledgment"; return act; }
  const repairTexts = repairSources(trimmed, raw);
  for (const [index, pattern] of TARGET_REPAIR.entries()) {
    const match = repairTexts.map((t) => t.match(pattern)).find(Boolean);
    if (!match) continue;
    const name = match.groups?.name ?? null;
    const exclude = match.groups?.exclude ?? match.groups?.exclude2 ?? null;
    if (match.groups?.group) { act.speech_act = "repair"; act.repair = { kind: "target_group", name: null, exclude: null, group: match.groups.group }; return act; }
    // "I didn't ask you, Giselle": the name spoken with the "you" is the one excluded.
    if (/^you$/i.test(exclude ?? "") && !name && act.vocatives.length === 1) { act.speech_act = "repair"; act.repair = { kind: "exclude", name: null, exclude: act.vocatives[0].name }; act.vocatives = []; return act; }
    // "I asked Tonya." is a target repair only when it names a known person; "I asked about X" is not.
    if (name && !people.some((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === name.toLowerCase())) && index !== 5) continue;
    act.speech_act = "repair";
    act.repair = { kind: index === 5 ? "other_one" : exclude && !name ? "exclude" : "target", name, exclude };
    return act;
  }
  for (const pattern of UNANSWERED_REPAIR) {
    const match = repairTexts.map((t) => t.match(pattern)).find(Boolean);
    if (!match) continue;
    act.speech_act = "repair";
    // "I asked where it's going, not what's in it": the contrast tail is not part of the question.
    act.repair = { kind: "unanswered", embedded: match.groups?.embedded ? match.groups.embedded.replace(/,?\s+not\s+[\s\S]*$/i, "").trim() : null, ...(/\b(?:not|isn'?t)\s+(?:really\s+)?(?:an?\s+)?answer\b/i.test(repairTexts.join(" ")) ? { not_an_answer: true } : {}) };
    if (act.repair.embedded) {
      const embeddedExpanded = normalizeUtterance(act.repair.embedded).expanded;
      act.predicate_candidates = registry.detectPredicates(embeddedExpanded).map((d) => ({ id: d.id, form: d.form, temporal: d.temporal, polarity: d.polarity }));
    }
    return act;
  }
  for (const [index, pattern] of FACET_REPAIR.entries()) {
    // "I meant the Threshold, not the Complex": the contrast tail names what was NOT meant.
    const match = repairTexts.flatMap((t) => [t, t.replace(/,\s*not\s+(?:the\s+)?[\w' -]+([.!?]*)$/i, "$1")]).map((t) => t.match(pattern)).find(Boolean);
    if (!match) continue;
    const referent = match.groups?.referent ?? null;
    // "I mean it." / "I meant that." are not facet repairs.
    if (index === 3 && (!referent || /^(?:it|that|this|so|well|what|you)$/i.test(referent.trim()))) continue;
    act.speech_act = "repair";
    act.repair = { kind: index === 0 ? "facet" : index <= 2 ? "temporal" : index === 3 ? "referent" : "facet_purpose", want: match.groups?.want ?? null, not: match.groups?.not ?? null, referent };
    return act;
  }
  // "and the radio" / "also the lamp": a thing, continued (topic ellipsis) -- the marker carried the "and".
  if (markers.some((m) => /\b(?:and|also)$/i.test(m)) && /^(?:the|that|this|my|your)\s+[a-z][\w -]{1,30}?\s*(?:too|as well)?\s*[?.!]*$/i.test(trimmed)) { act.ellipsis = { kind: "topic", who: null, topic_text: trimmed.replace(/\s*(?:too|as well)?\s*[?.!]*$/i, "") }; act.speech_act = "elliptical_continuation"; act.question_form = "wh"; return act; }
  for (const pattern of ELLIPSIS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    // "What about the camera?" names a thing, not a person: a topic ellipsis (resolved later).
    const who = match.groups?.who ?? null;
    const named = [match.groups?.name1, match.groups?.name2].filter(Boolean);
    for (const name of named) {
      const person = people.find((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === name.toLowerCase()));
      if (person && !act.vocatives.some((v) => v.id === person.id)) act.vocatives.push({ name, id: person.id, form: "ellipsis" });
    }
    // A thing named after "and"/"too" is a topic ellipsis ("And the radio?"), not a person.
    if (who && /^(?:the|that|this|my|your)\s+/i.test(who) && !/^the (?:rest|others|other|last|remaining)\b/i.test(who)) { act.ellipsis = { kind: "topic", who: null, topic_text: who }; act.speech_act = "elliptical_continuation"; act.question_form = "wh"; return act; }
    if (who && !/^you|^y'?all|^both|^all|^the |^everyone/i.test(who)) {
      const listed = who.split(/\s*(?:,|and|&)\s*/i).map((s) => s.trim()).filter(Boolean);
      const persons = listed.map((name) => people.find((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === name.toLowerCase()))).filter(Boolean);
      if (persons.length === listed.length) { for (const p of persons) if (!act.vocatives.some((v) => v.id === p.id)) act.vocatives.push({ name: p.name, id: p.id, form: "ellipsis" }); }
      else { act.ellipsis = { kind: "topic", who: null, topic_text: who }; act.speech_act = "elliptical_continuation"; act.question_form = "wh"; return act; }
    }
    const kind = /^(?:and\s+|so\s+)?(?:then\b|after that|what after that|what then)/i.test(trimmed) ? "sequence"
      : /^(?:not\s+even|you sure|are you sure)/i.test(trimmed) ? "same_question"
        : /turn|you'?re up|you are up|next|now you|over to you|first|start|bring us home|last|go ahead|take it away|kick/i.test(trimmed) ? "turn" : /same/i.test(trimmed) ? "same_question" : "how_about";
    act.ellipsis = { kind, who, ...(pattern === ELLIPSIS.at(-1) ? { aux: true } : {}) };
    act.speech_act = "elliptical_continuation";
    act.question_form = /\?/.test(trimmed) ? "wh" : null;
    return act;
  }
  if (BARE_WH.test(trimmed)) { act.speech_act = "question"; act.question_form = "wh"; act.bare_wh = trimmed.replace(/[?!.\s]+$/, "").toLowerCase(); return act; }
  const unmarked = String(clause.text).trim().replace(/^(?:(?:so|okay|ok|um+|uh+|well|alright|right|and)[,.]?\s+)+/i, "");
  if (SARCASM.some((p) => p.test(trimmed) || p.test(String(clause.text).trim()) || p.test(unmarked))) { act.speech_act = "sarcasm"; return act; }
  if (FAREWELL.test(trimmed) && !/\?/.test(trimmed)) { act.speech_act = "farewell"; return act; }
  if (THANKS.test(trimmed) && trimmed.split(/\s+/).length <= 5) { act.speech_act = "thanks"; return act; }
  if (GREETING.test(trimmed) && /\?\s*$/.test(trimmed) && trimmed.replace(/[^A-Za-z ]/g, "").trim().split(/\s+/).length <= 2) { act.speech_act = "attention_call"; act.attention = true; return act; }
  if (GREETING.test(trimmed) && !/\?/.test(trimmed) && !/\b(?:how|what|where|who|can|could|tell)\b/i.test(trimmed.replace(GREETING, ""))) {
    // With a greeting, a lower-cased "hi, i'm jack" is still an introduction (a state word is not a name).
    act.speech_act = SELF_INTRO.test(trimmed) || GREETING_INTRO_LOWER.test(trimmed) ? "self_introduction" : "greeting";
    // "Morning all" / "Hi guys": the group is greeted.
    if (!act.quantifier && /\b(?:all|everyone|everybody|guys|folks|team|y'?all|gang|crew|people)\s*[!.]*$/i.test(trimmed)) act.quantifier = { kind: "all", text: "all", name: null };
    return act;
  }
  if (SELF_INTRO.test(trimmed) && !/\?\s*$/.test(trimmed)) { act.speech_act = "self_introduction"; return act; }
  // An indirect question is classified as the question it embeds (the wrapper is politeness).
  // (Also against the whole clause: a wrapper may begin with a word the marker pass took, "No clue where...")
  const indirect = unwrapIndirect(bodyExpanded) ?? (voc.vocatives.length ? null : unwrapIndirect(normalizeUtterance(clause.text).expanded));
  if (indirect) {
    act.indirect = indirect;
    const direct = `${indirect.direct.charAt(0).toUpperCase()}${indirect.direct.slice(1)}?`;
    act.body = direct;
    act.body_expanded = normalizeUtterance(direct).expanded;
    act.predicate_candidates = registry.detectPredicates(act.body_expanded).map((d) => ({ id: d.id, form: d.form, temporal: d.temporal, polarity: d.polarity }));
    act.speech_act = "question";
    act.question_form = "indirect";
    act.quantifier = act.quantifier ?? quantifierOf(act.body_expanded);
    act.temporal_scope = act.temporal_scope ?? temporalOf(act.body_expanded);
    return act;
  }
  act.predicate_candidates = registry.detectPredicates(bodyExpanded).map((d) => ({ id: d.id, form: d.form, temporal: d.temporal, polarity: d.polarity }));
  const form = questionForm(trimmed, bodyExpanded);
  if (ABILITY.test(bodyExpanded)) { act.speech_act = "question"; act.question_form = "yes_no"; act.ability = true; }
  else if (REQUEST.test(bodyExpanded) && !/^(?:can|could|will|would) (?:you|we) (?:even|actually|really) /i.test(bodyExpanded) && (form !== "wh" || /^(?:tell|introduce|say|share|describe|explain)/i.test(bodyExpanded))) { act.speech_act = "request"; act.question_form = form === "tag" ? null : null; }
  else if (form) { act.speech_act = "question"; act.question_form = form; }
  else act.speech_act = "statement";
  if (form === "choice") {
    const alt = trimmed.match(/\bor\s+(?:just\s+|only\s+)?([^?.!]+)[?.!]*$/i)?.[1]?.trim() ?? null;
    const selfAlt = alt && /^(?:me|myself|mine|i|just me|me alone)$/i.test(alt.replace(/^just\s+/i, "")) ? "player_only" : alt;
    act.alternatives = [act.quantifier?.kind === "all" ? "everyone" : "first", selfAlt].filter(Boolean);
  }
  // A declarative about the addressee right after it could only be a question in context ("You've been there before.").
  act.declarative_candidate = !form && /^(?:so\s+)?(?:you|you have|you are|you were|you had)\b/i.test(bodyExpanded);
  // Chat-style question with no "?": an aux-dropped second-person predicate spoken TO someone ("you done
  // this before malcolm", "you nervous tonya") is a declarative question.
  if (act.speech_act === "statement" && act.declarative_candidate && act.predicate_candidates.length && (voc.vocatives.length || /^(?:so\s+)?you\s+(?!are\b|have\b|were\b|had\b|know\b|see\b|said\b)\w+/i.test(bodyExpanded))) { act.speech_act = "question"; act.question_form = "declarative"; }
  // Typed with no punctuation at all, a line that asks a registry question and is not the speaker talking
  // about themselves, reporting someone, or asserting something of a named third person is a question:
  // "first day for everyone", "we all going", "anyone been on an expedition b4", "excited malcolm".
  if (act.speech_act === "statement" && UNPUNCTUATED(clause.text) && act.predicate_candidates.length
    && !/^(?:i|i'm|i am|i've|i have|i was|i'd|i will|my|me|mine|myself)\b/i.test(bodyExpanded) && !/\b(?:me|myself|my)\b/i.test(bodyExpanded)
    && !/\b(?:said|says|told|mentioned|heard)\b/i.test(bodyExpanded)
    && !(/^(?:he|she|they|he's|she's|they're)\b/i.test(bodyExpanded) || (!voc.vocatives.length && people.some((p) => (p.names ?? [p.name]).some((n) => new RegExp(`^${escapeRe(String(n))}(?:'s)?\\b`, "i").test(body)))))) { act.speech_act = "question"; act.question_form = YES_NO.test(bodyExpanded) ? "yes_no" : WH.test(bodyExpanded) ? "wh" : "declarative"; act.unpunctuated = true; }
  return act;
}

/**
 * Stages B-D for one line: normalize -> segment -> per-clause acts (context-free). Social/marker clauses are
 * kept (they carry relation information) but only substantive acts are counted toward MAX_ACTS.
 */
function parseActs(raw, { people = [], vocabulary = [], protect = [] } = {}) {
  const names = people.flatMap((p) => p.names ?? [p.name]).filter(Boolean);
  const normalized = normalizeUtterance(raw, { names, vocabulary, protect });
  const clauses = segment(normalized.repaired);
  const acts = [];
  const dropped = [];
  for (const clause of clauses) {
    const act = clauseAct(clause, { people });
    const substantive = !["social_acknowledgment", "thanks"].includes(act.speech_act);
    if (substantive && acts.filter((a) => !["social_acknowledgment", "thanks"].includes(a.speech_act)).length >= MAX_ACTS) { dropped.push(clause.text); continue; }
    acts.push(act);
  }
  // A coordinated second question inherits the first one's addressee ("Tonya, is it your first day, and
  // have you been in there before?").
  for (let i = 1; i < acts.length; i += 1) if (acts[i].coordinated && !acts[i].vocatives.length && acts[i - 1].vocatives.length) acts[i].vocatives = acts[i - 1].vocatives.map((v) => ({ ...v, form: "coordinated" }));
  // "Giselle? Malcolm?": consecutive bare-name calls are one call to both.
  for (let i = acts.length - 1; i > 0; i -= 1) {
    const a = acts[i - 1], b = acts[i];
    if (a.speech_act === "attention_call" && b.speech_act === "attention_call" && a.vocatives.length && b.vocatives.length && !a.body && !b.body) { a.vocatives = [...a.vocatives, ...b.vocatives.filter((v) => !a.vocatives.some((x) => x.id === v.id))]; a.text = `${a.text} ${b.text}`; acts.splice(i, 1); }
  }
  // A vocative-only clause ("Tonya.") followed by a clause addresses that clause ("Tonya. What do you do?").
  for (let i = 0; i < acts.length - 1; i += 1) {
    if (acts[i].speech_act === "attention_call" && acts[i].vocatives.length && !acts[i].body && !acts[i + 1].vocatives.length) {
      acts[i + 1].vocatives = acts[i].vocatives.map((v) => ({ ...v, form: "preceding_clause" }));
      acts[i].absorbed = true;
    }
  }
  return { version: ACTS_VERSION, normalized, clauses, acts: acts.filter((a) => !a.absorbed), dropped };
}

module.exports = { unwrapIndirect, directQuestion, ACTS_VERSION, MAX_ACTS, parseActs, segment, stripMarkers, findVocatives, questionForm, quantifierOf, temporalOf, clauseAct, MARKERS, TARGET_REPAIR, UNANSWERED_REPAIR, FACET_REPAIR, ELLIPSIS };
