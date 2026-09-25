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
const BIOGRAPHY = /\b(?:grew up|hometown|i live|live with|lives with|born (?:in|and)|my (?:family|wife|husband|kids?|children|parents?|mother|father|brother|sister|dog|cat)|graduated|degree|college|university|high school|used to (?:work|live)|back home|i(?:'m| am) from|where i'?m from|years of experience|i(?:'ve| have) been (?:doing|working) (?:this|here))\b/gi;
const FUTURE_KNOWLEDGE = /\b(?:you(?:'ll| will) (?:find|regret|die)|(?:it|this|that) (?:will|is going to) (?:go wrong|fail|end badly|happen)|something (?:bad )?(?:is going to|will) happen|i know how this ends)\b/i;
const STATE_MUTATION = /\b(?:here you go|here(?:'s| is) (?:the|your)|i(?:'ve| have) (?:just )?(?:handed|given|passed|moved|opened|closed|taken|dropped)|i (?:just )?(?:handed|gave|passed|opened|closed|took|moved)\b)/i;
const SPEAKING_FOR_OTHERS = /\b(?:we(?:'re| are) all|all of us|we all|everyone(?:'s| is| feels| here)|the others (?:are|feel|think))\b/i;
const TASK_OFFER = /\b(?:let'?s (?:get|stay|keep|move|focus)|ready when you are|what do you need|anything you need|need me to|do you want me to|want me to|shall we|awaiting (?:orders|instructions)|which part do you need)\b/i;
const MISSION_TERMS = /\b(?:outpost|cutoff|duffle|manifest|route|guidance tape|briefing|objective|deadline|startup materials)\b/gi;
// Generic service-assistant framing is never a coworker's voice.
const ASSISTANT_PERSONA = /\b(?:how (?:can|may|could|might) i (?:help|assist|be of (?:service|assistance|help))|what can i do for you|(?:is|was) there (?:anything|something) (?:i|else i) (?:can|could) (?:help|do|assist)|anything (?:else )?(?:i|that i) (?:can|could) (?:help|assist)(?: you)? with|(?:can|may|could) i (?:help|assist) you|(?:i(?:'m| am) )?(?:here|happy|glad|ready) to (?:help|assist)(?: you)?|let me know if you need (?:anything|any help|something)|at your service|how may i serve)\b/i;
// An honest, non-absolute statement that nothing is known ("not that I know of").
const LACK_SAFE = /\b(?:don'?t know|do not know|no idea|no clue|not sure|can'?t say|couldn'?t say|can'?t tell you|couldn'?t tell you|not that i (?:know|recall|remember|noticed|saw|heard)|didn'?t (?:notice|see|catch) anything|don'?t (?:recall|remember)|nothing (?:on|about) that|nothing to (?:add|say|tell)|haven'?t (?:heard|been told)|(?:nobody|no one)(?:'s| has) told me|not that i can think of|can'?t think of|i wouldn'?t know|unsure|not certain|i'?d rather not)\b/i;
const ABSOLUTE_EXPERIENCE_CLAIM = /\b(?:never|no experience|first time|haven'?t been|have not been|been (?:here|there|in|down)|seen (?:this|the|it) before|done this)\b/i;
// Functions whose reply is a plain answer/reaction, not a question back.
const NO_COUNTER_QUESTION = new Set(["report_observation", "greet", "introduce_self", "acknowledge", "close_topic", "joke_or_sarcasm", "social_observation", "warn", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience", "ask_factual", "request_repetition", "clarify_previous", "ask_heard_confirmation", "check_in", "make_request", "ask_explanation", "ask_next_step", "ask_opinion", "ask_meaning", "ask_response_event"]);
const CLARIFY_CUE = /\b(?:(?:what|which|where|when|who)\b[^?]*\b(?:referring|referencing|talking about)|mean|which|what (?:do|are|exactly|thing|part|item)|sorry|pardon|huh|not sure what|didn'?t (?:catch|follow|get)|come again|say again)\b/i;
const MAX_WORDS = Object.freeze({ report_observation: 22, greet: 6, introduce_self: 10, acknowledge: 9, close_topic: 9, joke_or_sarcasm: 10, social_observation: 10, check_in: 14, warn: 14, express_uncertainty: 16, ask_heard_confirmation: 16, ask_explanation: 24, ask_next_step: 24, ask_opinion: 14, ask_meaning: 30, ask_response_event: 22 });
// A motive, feeling or excuse for not answering: never canonical unless the plan supplies it.
const SILENCE_MOTIVE = /\b(?:because|i thought|i didn'?t (?:realize|realise|think|know (?:you|it|that))|didn'?t (?:realize|realise)|wasn'?t sure (?:you|if|whether|it)|i figured|i assumed|i was (?:busy|distracted|nervous|thinking|focused|waiting|preoccupied|shy|tired|lost|listening|in the middle)|didn'?t want|wasn'?t (?:paying|listening)|zoned out|lost in thought|(?:you )?(?:weren'?t|were not) talking to me|didn'?t know (?:it was|you were|you meant)|thought you (?:were|meant)|not my place|didn'?t catch (?:that|it) was)\b/i;
// An assignment phrase read as lodging/living arrangements ("staying with" as "living with").
const LODGING_READING = /\b(?:live|lives|living|lodg\w*|room(?:ing|mate)?s?|sleep\w*|stay(?:ing)? at|house|home|apartment|flat|share (?:a|the) (?:room|place))\b/i;
const META_PLAYER = /\b(?:the|this) player\b|\bplayer'?s (?:words|line|message|text)\b/i;
// The capsule labels the person spoken to "PLAYER"; that label is orientation, never speech -- in any case,
// whether shouted, used as a name ("Morning, Player.") or as an address ("Hey player"). Ordinary uses
// such as "team player" are not the label.
const PLAYER_LABEL = /\bPLAYER\b|\S\s+Player\b/;
const PLAYER_ADDRESS = /,\s*player\b|^\s*player\s*[,!.?]|\b(?:hey|hi|hello|morning|evening|thanks|sorry|okay|yes|no)[,!]?\s+player\b/i;
// A purpose/motive clause the plan never supplied ("...to make sure everything was accounted for",
// "staying with the lead to monitor health conditions").
const INVENTED_RATIONALE = /\b(?:to make sure|to ensure|in order to|so (?:that )?(?:we|i|they|it)\b|because\b|to see (?:if|whether)|to (?:verify|confirm|double-check|monitor|keep (?:an eye|track|watch)|watch over|look after|support|assist|protect|document)\b)/i;
// A course of action nobody authorized ("We should check with the leader.", "Let's move when we're ready.").
const INVENTED_DIRECTIVE = /\b(?:we should|we(?:'ll| will)? (?:need|have) to|we(?:'d| had) better|you should|you(?:'d| had) better|let'?s|check with|ask (?:the|your|our) (?:lead|leader|boss|supervisor)|talk to (?:the|your|our))\b/i;
// An assessment of the situation the plan does not supply ("Everything's good here.").
const SITUATION_ASSESSMENT = /\b(?:everything(?:'s| is| seems| looks)|it(?:'s| is) all|things(?:'re| are)) (?:good|fine|okay|ok|alright|all right|under control|normal|safe|quiet|clear|going (?:well|fine|smoothly)|on track)\b|\b(?:all|everything)(?:'s| is)? on track\b/i;
// An invented duty or purpose for being present ("I'm here to keep everyone safe.").
const INVENTED_DUTY = /\b(?:here to|my job(?:'s| is) to|i(?:'m| am) (?:supposed|meant) to|keep(?:ing)? (?:everyone|everybody|us|you|the team) safe)\b/i;
// Items a coworker may name as someone's custody; used to keep custody talk inside the plan.
const CUSTODY_ITEM_WORDS = /\b(?:camera|radio|transceiver|lamp|light|worklight|duffle|bag|spectrometer|instrument|recorder|record|kit|markers?)\b/gi;
// "you" used as if it were a name ("Good morning, you.", "What are you talking about, you?").
const VOCATIVE_YOU = /,\s*you\s*[.!?]*\s*$|,\s*you\s*[.!?]\s+\S/i;
const SENSORY_INVENTION = /\b(?:smell\w*|hear|heard|hearing|sound\w*|glow\w*|hum|humming|hums|moving|moves|breath\w*|whisper\w*|voices?|bleed\w*|scream\w*|shadows?|vibrat\w*|pulsing|pulses|cold|warm|hot|dying|dead|blood|flicker\w*|buzz\w*|watching|following)\b/i;
// Agreeing that a sarcastic remark is true takes it literally.
const SARCASM_AGREES = /\b(?:you'?re (?:not wrong|right|correct)|not wrong about|that'?s (?:true|right|correct|a relief)|(?:i )?agree(?:d)?|absolutely|indeed|good point|fair point)\b/i;
// A reaction that supplies no fact must not narrate events, history or experience of its own.
// A reaction that supplies no fact must not invent what the speaker is currently doing or waiting for.
const INVENTED_ACTIVITY = /\b(?:just|still|currently|busy)\s+(?:waiting|trying|working|checking|charging|getting|making|keeping|looking|going|doing|bringing|carrying|grabbing|packing|sorting|setting|finishing|heading|preparing|organizing|recording|writing|logging)\b|\bwaiting (?:for|on)\b|\btrying to\b|\bi(?:'m| am) (?:keeping|recording|noting|writing|logging|taking) (?:a |the )?(?:note|record|track|down|it|that|this)\b|\b(?:keeping|making) (?:a |the )?(?:verbal )?(?:record|note) of (?:that|it|this)\b/i;
const INVENTED_HISTORY = /\bi(?:'ve| have) (?:seen|been|done|worked|had)\b|\bi was\b|\bagain\b|\b(?:last|that) (?:time|week|year|day)\b|\bused to\b|\bi remember\b|\bever\b|\b(?:didn'?t|did not|haven'?t|barely|hardly) (?:sleep|slept|rest(?:ed)?|eat(?:en)?)\b|\b(?:no|little|not much) sleep\b/i;
// Words of the internal plan/packet that must never surface as speech (any function).
const PERCEPTION_CLAIM = /\bi (?:saw|noticed|spotted|smelled|glimpsed|caught sight of)\b|\bi heard (?:something|some|a |noises?|sounds?|voices?)\b|\bi(?:'ve| have) (?:seen|noticed|spotted)\b/i;
// Affirming a claim ("Yeah, it is.", "That's right.", "Makes sense.") -- never for a player's world claim.
const PLAYER_CLAIM_ENDORSEMENT = /^\s*(?:yes|yeah|yep|yup|right|true|exactly|correct|indeed|definitely|of course|sure)\b|\b(?:that'?s (?:right|true|correct)|makes sense|i know|it (?:is|really is)|sure is|good to know|interesting,? (?:so|then))\b/i;
// Saying what is NOT known alongside a partial answer.
const PARTIAL_LACK = /\b(?:(?:nobody|no one)(?:'s| has) (?:told|said|mentioned)|haven'?t been told|not been told|don'?t know|do not know|no idea|not sure|beyond that|that'?s (?:all|about all) (?:i know|i've got|we were told)|all i know|only (?:know|from)|couldn'?t (?:say|tell)|can'?t (?:say|tell)|wasn'?t told|weren'?t told|didn'?t say|never said|no one said|nobody said)\b/i;
const PLAN_VOCAB = /\b(?:disposition|authorized|contribution|self[_ ]state|antecedent|required facts?|item[_ ]holder|heard[_ ]confirmation|known[_ ]answer)\b/i;
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
const COMMITMENT_CLAIM = /\b(?:i'?ll|i will|i(?:'m| am) going to|i can do that|let me (?:go|get|check|handle|take|grab|do)|^\s*on it\b|will do\b|you got it|sure thing|consider it done|i promise|count on me|give me (?:a |one )?(?:sec|second|minute|moment)|right away|on my way|coming right up|no problem|i(?:'m| am) on it)\b/i;
// A request/order that conversation does not perform is acknowledged, never accepted or complied with.
const REQUEST_ACCEPTANCE = /^\s*(?:sure|okay|ok|yes|yeah|yep|yup|alright|all right|of course|absolutely|you bet|roger|copy(?: that)?|understood|will do|sounds good|got it|fine|certainly)\b|\b(?:sounds good|good idea|let'?s|i'?m with you|right behind you|we(?:'ll| will| can)|will wait|i(?:'ll| will) wait)\b/i;
// Words that state a feeling or strain; a check-in may state one only when canonical self-state holds it.
const SELF_STATE_CLAIM = /\b(?:tired|exhausted|worn(?: out)?|wiped|drained|beat|stress\w*|tense|on edge|nervous|anxious|worried|scared|afraid|uneasy|rough|could be better|not great|been better|not (?:so|too) good|hanging in)\b/i;
const SELF_STATE_SYNONYMS = Object.freeze({ tired: /\b(?:tired|exhausted|worn|wiped|drained|beat|fatigue\w*)\b/i, tense: /\b(?:tense|stress\w*|on edge|uneasy|nervous|anxious|keyed up)\b/i, pressed: /\b(?:clock|time|rush\w*|hurr\w*|pressed)\b/i });
const opener = (text) => words(text).slice(0, 2).join(" ");
const OPENER_FUNCTIONS = new Set(["greet", "introduce_self", "acknowledge", "check_in", "joke_or_sarcasm", "social_observation"]);
const REPAIR_FUNCTIONS = new Set(["clarify_previous", "request_repetition"]);
// A feeling asserted about oneself that canonical affect never establishes (positive arousal) -- negated
// mentions ("not especially excited") are stances, not claims.
const POSITIVE_AFFECT_CLAIM = /\b(?:excited|thrilled|pumped|psyched|stoked|eager|can'?t wait|looking forward)\b/i;
const NEGATED_FEELING = /\b(?:not|n't|no|never|hardly)\b(?:\s+(?:especially|really|particularly|that|too|very|all that|much|at all|feeling|feel))*\s+(?:\w+\s+)?(?=\w)/gi;
const withoutNegatedFeelings = (speech) => String(speech).replace(new RegExp(`${NEGATED_FEELING.source}(?:excited|thrilled|pumped|psyched|stoked|eager|nervous|anxious|worried|scared|afraid|tense|uneasy|stressed|on edge|tired|exhausted)\\b`, "gi"), " ");
// How an explanation voices each kind of basis. Voicing a DIFFERENT kind than the recorded one is an
// invented reason ("I saw it myself" when the speaker merely had nothing to go on).
const BASIS_VOICES = Object.freeze({
  observation: /\b(?:i saw|i noticed|i spotted|saw it (?:myself|with my own)|seen it myself)\b/i,
  briefing_instruction: /\b(?:briefing|maxwell|kirk|we were told|they told us|instruct\w*)\b/i,
  no_known_fact: /\b(?:(?:nobody|no one)(?:'s| has) told|nothing to go on|can'?t think of a time)\b/i,
  self_state: /\b(?:how i feel|i(?:'m| am) feeling|i feel (?:like|that|exactly|fine|all right|normal)|my (?:mood|feelings?))\b/i,
  custody: /\b(?:it'?s with (?:me|you)|(?:you|i)(?:'ve| have) got it|has it|holding it)\b/i
});
// Words any explanation may use without adding a reason of its own.
const EXPLANATION_FRAME_WORDS = Object.freeze(["said", "say", "saying", "because", "just", "mean", "meant", "meaning", "feel", "feeling", "right", "now", "really", "honestly", "nothing", "ordinary", "normal", "particular", "particularly", "especially", "either", "way", "much", "reason", "that", "what", "think", "time", "know", "idea", "anything", "sure", "clear", "told", "nobody", "one", "haven't", "hasn't", "don't", "didn't", "can't", "couldn't", "wasn't", "notice", "noticed", "see", "saw", "tell", "catch", "follow", "asking", "asked", "view", "opinion", "formed", "yet", "fine", "okay", "alright", "all", "well", "good", "much", "going", "genuinely", "simply", "exactly", "moment", "put", "answer", "answered", "question"]);
// "I don't know" about one's own feelings: a speaker has access to themselves.
// ("Can't say I feel much either way" is the idiom for a stance, not a denial.)
const SELF_ACCESS_DENIAL = /\b(?:don'?t know|do not know|no idea|not sure|no clue)\b|\b(?:can'?t|couldn'?t) say\b(?!\s+(?:that\s+)?i\b)/i;
// Ways of saying "I have nothing to go on" (the basis of an honest no-fact answer).
const NO_BASIS = /\b(?:nothing to go on|can'?t think of|haven'?t (?:formed|thought|decided)|don'?t have (?:anything|much|any)|haven'?t (?:got|heard|been told|seen)|no(?:body|\s+one)(?:'s| has) (?:told|said|mentioned)|not been told|don'?t know (?:anything|much)|didn'?t (?:notice|see|catch)|nothing (?:about|on) (?:it|that)|no idea|no information|don'?t know)\b/i;
const SOCIAL_NO_TASK = new Set(["report_observation", "greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "check_in", "close_topic", "clarify_previous", "request_repetition", "ambiguous_reference", "invite_self_description", "ask_role_or_assignment", "ask_item_ownership", "ask_personal_experience"]);
const OTHERS_APPLY = new Set(["report_observation", "check_in", "invite_self_description", "ask_role_or_assignment", "ask_personal_experience", "greet", "introduce_self"]);

// ─── authorized contribution = hard output ceiling ──────────────────────────────────────────────
// Operational subject matter (assignments, equipment, places, schedule, procedure, people of the
// operation). Each such term in speech must be licensed by the plan (required/optional facts, the line in
// question, same-turn accepted lines) or by the player's own words -- what the speaker KNOWS is not what
// this turn authorizes them to SAY.
const OPERATIONAL_TERMS = /\b(?:cameras?|photo\w*|radios?|transceiver|lamps?|flashlights?|worklights?|duffle|bags?|materials?|startup|spectrometer|layout|records?|recording|recall|verbal|observations?|deliver(?:y|ing|ed|ies)?|reconnaissance|recon|outposts?|bermuda|staging|threshold|complex|standard|kv31|briefing|briefed|manifest|cutoff|deadline|noon|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\d{1,2}:\d{2}|tape|routes?|procedures?|protocols?|missions?|objectives?|assignments?|maxwell|kirk|async|equipment|gear|expedition(?! lead)|survey\w*|compil\w*|courier|layouts?|deploy\w*|departure|depart\w*|(?:at|by|before|until) (?:ten|eleven|twelve|one|two|three)(?: o'?clock)?)\b/gi;
// A first-person report of what one is doing ("Just compiling the layout record.", "Focused on the materials.").
const ACTIVITY_CLAIM = /\b(?:i(?:'m| am)|we(?:'re| are)|just|currently|busy|still)\s+(?:\w+ly\s+)?(\w{3,}ing)\b|\bfocused on\b/gi;
const SAFE_ACTIVITY = new Set(["doing", "feeling", "getting", "going", "saying", "asking", "hanging", "managing", "holding", "kidding", "joking", "wondering", "being", "meaning", "thinking", "glad", "morning", "nothing", "something", "anything", "everything"]);
const licensedTerm = (term, blob, playerText) => {
  const t = term.toLowerCase().replace(/s$/, "");
  const stem = t.length > 5 ? t.slice(0, 5) : t;
  return blob.includes(stem) || String(playerText ?? "").toLowerCase().includes(stem);
};
/** Every operational claim (term or first-person activity) a candidate makes, licensed or not (trace). */
function operationalClaims(speech) {
  return [...new Set([...String(speech).matchAll(OPERATIONAL_TERMS)].map((m) => m[0].toLowerCase()).concat([...String(speech).matchAll(ACTIVITY_CLAIM)].filter((m) => !SAFE_ACTIVITY.has((m[1] ?? "").toLowerCase())).map((m) => m[0].toLowerCase())))];
}
/** Operational claims in speech the plan does not license (empty when every claim is licensed). */
function unlicensedClaims(speech, contribution, playerText = null) {
  const blob = JSON.stringify([contribution?.required_facts, contribution?.optional_facts, contribution?.antecedent, contribution?.referents, contribution?.same_turn_prior_responses, contribution?.resumed_question]).toLowerCase();
  const out = [];
  for (const match of String(speech).matchAll(OPERATIONAL_TERMS)) if (!licensedTerm(match[0], blob, playerText)) out.push(match[0]);
  for (const match of String(speech).matchAll(ACTIVITY_CLAIM)) {
    const verb = (match[1] ?? "focused").toLowerCase();
    if (SAFE_ACTIVITY.has(verb)) continue;
    if (!licensedTerm(verb, blob, playerText)) out.push(match[0]);
  }
  return [...new Set(out)];
}
// Asking something the plan did not authorize: a real question (not a tag like "right?"), with or without
// a question mark ("Is there a specific procedure I should follow" is a question).
const TAG_QUESTION = /^(?:\w+[,.]?\s+)?(?:right|huh|eh|yeah|no|isn'?t it|aren'?t we|don'?t you think)\?$|,\s*(?:right|huh|eh|isn'?t it|aren'?t we|don'?t you think)\?$/i;
const INTERROGATIVE_START = /^(?:(?:so|and|but|well|also|hey),?\s+)?(?:is there|are there|is it|are we|should i|shall i|shall we|do you want|would you like|can i|could i|may i|do you need|what (?:should|do|can|would)|which|where (?:should|do)|how (?:should|do|can)|is anyone|does anyone)\b/i;
function asksQuestion(speech) {
  const parts = String(speech).split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  if (/\b(?:i was wondering (?:if|whether)|let me know (?:if|whether)|any idea (?:if|whether|what|how))\b/i.test(speech)) return true;
  return parts.some((part) => (part.endsWith("?") && !TAG_QUESTION.test(part)) || INTERROGATIVE_START.test(part));
}

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
// Canonical terminology in NPC speech: the Threshold is never a "portal", a "gate device" or a handheld
// thing. (The player's own synonyms are understood by interpretation; coworkers keep institutional terms.)
const NON_CANONICAL_TERMS = /\bportals?\b|\bgate\s+device\b|\bhandheld\s+threshold\b|\bthreshold\s+(?:device|gadget|unit)\b|\bdimensional\s+(?:gate|door|rift)\b|\bthe\s+backrooms\b/i;
function validateOntology(rawSpeech) {
  const speech = String(rawSpeech ?? "");
  if (NON_CANONICAL_TERMS.test(speech)) return reject(CODES.FORBIDDEN, `non-canonical terminology: "${speech.match(NON_CANONICAL_TERMS)[0]}"`);
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
function validateContribution(contribution, rawSpeech, { player_text = null, speaker_name = null } = {}) {
  if (!contribution) return { ok: true };
  // Typographic apostrophes/quotes ("We’ll") are normalized so no rule is bypassed by punctuation style.
  const speech = String(rawSpeech ?? "").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();
  const ontology = validateOntology(speech);
  if (!ontology.ok) return ontology;
  const fn = contribution.discourse_function;
  const forbidden = new Set(contribution.forbidden_claims ?? []);
  const sents = sentences(speech);
  const allowedBlob = JSON.stringify([contribution.required_facts, contribution.optional_facts, contribution.antecedent, contribution.referents, contribution.same_turn_prior_responses]).toLowerCase();

  // Assistant persona: a coworker never offers generic service.
  if (fn !== "make_request" && ASSISTANT_PERSONA.test(speech)) return reject(CODES.FORBIDDEN, "assistant-style service offer");
  if (META_PLAYER.test(speech) || PLAYER_LABEL.test(speech) || PLAYER_ADDRESS.test(speech)) return reject(CODES.FORBIDDEN, "refers to the player as a game construct");
  // The uncertainty descriptor (which kind of not-knowing applies) is not an answering fact.
  const noFacts = !(contribution.required_facts ?? []).some((f) => f.key !== "uncertainty") && !(contribution.optional_facts ?? []).length;
  const explainedBasis = fn === "ask_explanation" ? (requiredValue(contribution, "explanation_basis")[0] ?? null) : null;
  if ((["joke_or_sarcasm", "social_observation", "greet", "introduce_self", "acknowledge", "close_topic", "check_in"].includes(fn) || (noFacts && ["ask_factual", "ask_personal_experience", "challenge", "make_statement", "ambiguous_reference"].includes(fn)) || (explainedBasis && ["self_state", "no_known_fact", "social", "clarification", "unavailable"].includes(explainedBasis.kind))) && INVENTED_HISTORY.test(speech)) return reject(CODES.FORBIDDEN, "narrates history or experience the plan does not supply");
  if ((["joke_or_sarcasm", "social_observation", "greet", "introduce_self", "acknowledge", "close_topic", "check_in"].includes(fn) || (noFacts && fn === "make_statement")) && INVENTED_ACTIVITY.test(speech)) return reject(CODES.FORBIDDEN, "invents what the speaker is doing or waiting for");
  // A social acknowledgment claims no experience of its own ("First day for me too", "I've done this before").
  if (["greet", "introduce_self", "acknowledge"].includes(fn) && (INVENTED_EXPERIENCE.test(speech) || /\b(?:for me too|me too|same here|my first)\b/i.test(speech))) return reject(CODES.FORBIDDEN, "a social acknowledgment claims experience the plan does not supply");
  // A greeting or acknowledgment does not report what the speaker is doing ("Hi. I'm compiling the record.").
  if (["greet", "introduce_self", "acknowledge", "close_topic", "joke_or_sarcasm"].includes(fn) && /\bi(?:'m| am) (?!doing\b|feeling\b|going to\b|getting by\b|not\b)\w+ing\b/i.test(speech)) return reject(CODES.FORBIDDEN, "a social line reports an activity the plan does not supply");
  // The player just answered this speaker's own clarification: the reply may not claim not to follow it.
  if (contribution.resumed_question && !contribution.may_ask_clarifying_question && /\b(?:(?:don'?t|do not) (?:know|understand|get)|not sure|no idea) what you(?:'re| are)? (?:mean|meant|asking|referring|talking)\b|\bwhat do you mean\b/i.test(speech)) return reject(CODES.UNMET, "the player answered the clarification; do not ask or deny it again");
  if (fn !== "report_observation" && fn !== "warn" && COMMITMENT_CLAIM.test(speech)) return reject(CODES.FORBIDDEN, "creates a commitment or instruction the simulation does not hold");
  if (VOCATIVE_YOU.test(speech)) return reject(CODES.SHAPE, "addresses the person as \"you\" as if it were a name");
  // A speaker never addresses themselves by their own name ("Ann, I'm a field technician.").
  const ownName = speaker_name ?? requiredValue(contribution, "name")[0] ?? null;
  if (ownName && new RegExp(`^\\s*${String(ownName).split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,!:]`, "i").test(speech)) return reject(CODES.SHAPE, "addresses themselves by their own name");
  // The player's claim about the world is heard as theirs; a coworker never affirms or restates it as fact.
  if (requiredValue(contribution, "player_claim").length) {
    if (PLAYER_CLAIM_ENDORSEMENT.test(speech)) return reject(CODES.FORBIDDEN, "endorses the player's claim as true");
    if (player_text && coverage(speech, player_text) >= 0.4 && !/\b(?:you said|if you say so|so you say|you think)\b/i.test(speech)) return reject(CODES.FORBIDDEN, "restates the player's claim as fact");
  }
  if (PLAN_VOCAB.test(speech)) return reject(CODES.FORBIDDEN, "internal bookkeeping vocabulary");
  // A first-person perception ("I saw something strange") is an observation claim: only a plan that carries
  // an observation (or custody the speaker saw) licenses one.
  if (fn !== "report_observation" && PERCEPTION_CLAIM.test(speech) && !/observ|"known_by":"seen|"kind":"observation"|own-report/.test(allowedBlob)) return reject(CODES.FORBIDDEN, `claims a perception the plan does not supply: "${speech.match(PERCEPTION_CLAIM)[0]}"`);
  // A suggested course of action is new content unless the plan (or the player's own words) supplied it.
  if (fn !== "report_observation" && fn !== "warn") {
    const directive = speech.match(INVENTED_DIRECTIVE);
    const procedureStated = fn === "ask_next_step" && requiredValue(contribution, "current_procedure").length > 0;
    if (directive && !procedureStated && !allowedBlob.includes(directive[0].toLowerCase()) && !(player_text && player_text.toLowerCase().includes(directive[0].toLowerCase()))) return reject(CODES.FORBIDDEN, `invented suggestion or plan: "${directive[0]}"`);
  }
  if (fn !== "report_observation" && SITUATION_ASSESSMENT.test(speech) && !SITUATION_ASSESSMENT.test(allowedBlob)) return reject(CODES.FORBIDDEN, "asserts a state of the situation the plan does not supply");
  if (INVENTED_DUTY.test(speech) && !allowedBlob.includes(speech.match(INVENTED_DUTY)[0].toLowerCase())) return reject(CODES.FORBIDDEN, `invented duty or purpose: "${speech.match(INVENTED_DUTY)[0]}"`);
  // Custody talk stays inside the plan: naming who holds an item the plan does not mention is an
  // unauthorized fact for this turn, even when it happens to be true.
  for (const marker of claimMarkers(speech)) {
    if (marker.kind !== "possession") continue;
    const parts = regionParts(speech, claimMarkers(speech), claimMarkers(speech).findIndex((m) => m.start === marker.start)) ?? [];
    for (const item of parts.join(" ").match(CUSTODY_ITEM_WORDS) ?? []) {
      if (!allowedBlob.includes(item.toLowerCase().replace(/s$/, ""))) return reject(CODES.FORBIDDEN, `states custody of an item the plan does not mention: "${item}"`);
    }
  }
  // A rationale the authorized facts do not contain is an invented motive.
  if (fn !== "report_observation" && fn !== "make_request" && fn !== "ask_explanation") {
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
    // Echoing a shared stance with an explicit agreement marker ("Not especially either.") is natural;
    // a bare identical opening is a chorus.
    const echoesStance = fn === "check_in" && requiredValue(contribution, "self_state_answer").length > 0 && /\b(?:either|too|same|also|as well)\b/i.test(speech);
    if (OPENER_FUNCTIONS.has(fn) && !echoesStance && opener(prior.text) && opener(prior.text) === opener(speech)) return reject(CODES.SHAPE, "opens exactly like an earlier speaker this turn");
    if (contentWords(speech).length >= 2 && coverage(speech, prior.text) >= 0.85 && coverage(prior.text, speech) >= 0.85 && !["report_observation", "ask_item_ownership", "ask_role_or_assignment", "invite_self_description"].includes(fn)) return reject(CODES.SHAPE, "near-identical to an earlier speaker's line this turn");
  }
  // Response shape: a question is authorized only by a clarification plan. Every other plan answers,
  // reacts or acknowledges; an unrequested question (help-desk "Is there a procedure I should follow?")
  // violates it, question mark or not.
  if (fn !== "report_observation" && fn !== "ambiguous_reference" && !contribution.may_ask_clarifying_question && asksQuestion(speech)) return reject(CODES.SHAPE, NO_COUNTER_QUESTION.has(fn) ? "answers with a question" : "asks a question the plan does not authorize");
  // Contribution ceiling: every operational claim must be licensed by THIS turn's plan.
  if (fn !== "report_observation") {
    const unlicensed = unlicensedClaims(speech, contribution, player_text);
    if (unlicensed.length) return reject(CODES.FORBIDDEN, `states something this turn does not authorize: "${unlicensed.slice(0, 3).join('", "')}"`);
  }

  if (fn === "joke_or_sarcasm") {
    // Agreeing with sarcasm and then asserting a world fact ("Yeah, it's got a good buffer zone").
    if (/^\s*(?:yeah|yes|yep|sure|right|totally|definitely)\b[,.!]?\s+(?:it|there|this place|that)(?:'s| is| has| have)\b/i.test(speech)) return reject(CODES.SHAPE, "takes a sarcastic remark literally and asserts a fact");
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
    if (sents.filter((x) => !x.includes("?")).some((x) => /\bi(?:'m| am) (?!not\b|sorry\b)\w+ing\b/i.test(x))) return reject(CODES.SHAPE, "a clarification asks; it does not report what the speaker is doing");
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

  // A2. Earlier custody: the reply says who had it THEN, never a different (or first-person) holder.
  const pastHolder = requiredValue(contribution, "item_holder_history")[0];
  if (pastHolder?.holder_name) {
    const firstPerson = /\b(?:i had|i was (?:holding|carrying)|i(?:'d| had) (?:it|the)|it was (?:with me|mine)|with me)\b/i.test(speech);
    if (!pastHolder.holder_is_self && firstPerson) return reject(CODES.CONTRADICTION, "claims the speaker had the item earlier; the earlier holder was someone else");
    const holder = pastHolder.holder_is_self ? /\b(?:i|me|mine)\b/i : pastHolder.holder_name === "you" ? /\byou\b/i : new RegExp(`\\b${String(pastHolder.holder_name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!holder.test(speech)) return reject(CODES.UNMET, "does not state who had the item earlier");
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
      if (fn === "ask_role_or_assignment" && (requiredValue(contribution, "known_concept").length || requiredValue(contribution, "uncertainty").length)) {
        const known = requiredValue(contribution, "known_concept")[0];
        if (known ? !(known.statements ?? []).some((text) => coverage(speech, text) >= 0.5) : !LACK_SAFE.test(speech)) return reject(CODES.UNMET, known ? "does not state the known fact" : "nothing is known: say you don't know");
        break;
      }
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
    case "check_in":
    case "social_observation": {
      const self = requiredValue(contribution, "self_state")[0];
      if (!self) break;
      const stance = requiredValue(contribution, "self_state_answer")[0];
      if (stance && SELF_ACCESS_DENIAL.test(speech)) return reject(CODES.UNMET, "a speaker knows their own current state; it is not an unknown fact");
      const asserted = withoutNegatedFeelings(speech);
      if (POSITIVE_AFFECT_CLAIM.test(asserted)) return reject(CODES.FORBIDDEN, "claims a feeling canonical self-state does not hold");
      if (self.state !== "affected") {
        if (SELF_STATE_CLAIM.test(asserted)) return reject(CODES.FORBIDDEN, "states a feeling or strain canonical self-state does not hold");
      } else {
        const keys = (self.affect ?? []).map((a) => (/tired/i.test(a) ? "tired" : /tense|stress/i.test(a) ? "tense" : /pressed|time/i.test(a) ? "pressed" : null)).filter(Boolean);
        if (keys.length && !keys.some((key) => SELF_STATE_SYNONYMS[key].test(speech))) return reject(CODES.UNMET, "does not express the canonical self-state the plan supplies");
      }
      break;
    }
    case "ask_opinion": {
      // No canonical opinion exists: a stance of having none yet, never an invented view.
      if (requiredValue(contribution, "uncertainty")[0]?.kind === "no_established_opinion" && !/\b(?:(?:no|(?:don'?t|do not) have (?:a|an|any)|haven'?t got (?:a|an|any))(?: real| particular| strong)? (?:opinion|view|take|thoughts?)|not sure|don'?t know|hard to say|haven'?t (?:really )?(?:thought|decided|formed)|no idea|couldn'?t say|can'?t say|too early)\b/i.test(speech)) return reject(CODES.UNMET, "no opinion is authorized; the speaker has none yet");
      break;
    }
    case "ask_next_step": {
      const procedure = requiredValue(contribution, "current_procedure")[0];
      if (procedure?.next_step && coverage(speech, procedure.next_step) < 0.5) return reject(CODES.UNMET, "does not state the supplied next step");
      break;
    }
    case "ask_explanation": {
      if (contribution.may_ask_clarifying_question) break;
      const basis = explainedBasis ?? { kind: "unavailable" };
      const asserted = withoutNegatedFeelings(speech);
      if (POSITIVE_AFFECT_CLAIM.test(asserted)) return reject(CODES.FORBIDDEN, "claims a feeling canonical self-state does not hold");
      // Explaining an answer that had no established history: no history of either polarity may appear.
      if (basis.uncertainty === "no_established_personal_history" && /\b(?:i(?:'ve| have)(?: never|n'?t|not)? been|never been|first time|been there|i was there)\b/i.test(speech)) return reject(CODES.FORBIDDEN, "asserts personal history the plan does not hold");
      if (basis.kind === "self_state") {
        if (basis.state !== "affected" && SELF_STATE_CLAIM.test(asserted)) return reject(CODES.FORBIDDEN, "states a feeling or strain canonical self-state does not hold");
        if (/^\W*(?:i\s+)?(?:don'?t know|no idea|not sure|dunno)\W*$/i.test(speech)) return reject(CODES.UNMET, "a speaker knows why they said how they feel");
      } else if (basis.kind === "no_known_fact") {
        if (!NO_BASIS.test(speech)) return reject(CODES.UNMET, "the reason is only that the speaker has nothing to go on");
      } else if (basis.kind === "briefing_instruction") {
        if (!/\b(?:briefing|maxwell|kirk|told|instruct\w*|orders?)\b/i.test(speech)) return reject(CODES.UNMET, "the reason is the briefing instruction");
      } else if (basis.kind === "custody") {
        if (!/\b(?:as far as i know|where it is|with (?:you|me|him|her|them)|(?:has|have|got) it|holding it|assign\w*|saw|see|seen|told|said|briefing)\b/i.test(speech) && coverage(speech, String(basis.label ?? "")) < 0.5) return reject(CODES.UNMET, "the reason is what the speaker knows about where the item is");
        if (basis.known_by === "briefing" && /\b(?:i saw|i see|i noticed|i watched)\b/i.test(speech)) return reject(CODES.CONTRADICTION, "claims to have seen what the speaker only heard at the briefing");
      } else if (basis.kind === "clarification") {
        if (!/\b(?:sure|meant|mean|tell|follow|catch|clear|unclear|understand)\b/i.test(speech)) return reject(CODES.UNMET, "the reason is that the speaker was not sure what was meant");
      }
      for (const [kind, voice] of Object.entries(BASIS_VOICES)) {
        // Custody known FROM the briefing roster is explained by the briefing; custody seen, by seeing.
        if (basis.kind === "custody" && ((kind === "briefing_instruction" && basis.known_by === "briefing") || (kind === "observation" && /^seen/.test(basis.known_by ?? "")))) continue;
        // A knowledge answer is explained by where its known part came from.
        if (basis.kind === "known_information" && ((kind === "briefing_instruction" && (basis.provenance ?? []).includes("briefing")) || (kind === "observation" && (basis.provenance ?? []).includes("observed")) || (kind === "no_known_fact" && basis.partial))) continue;
        if (basis.kind === "custody_history" && ((kind === "briefing_instruction" && basis.basis === "briefing") || (kind === "observation" && basis.basis === "observed"))) continue;
        if (kind !== basis.kind && voice.test(speech) && !(BASIS_VOICES[basis.kind]?.test(speech))) return reject(CODES.FORBIDDEN, `explains a different basis (${kind}) than the recorded one (${basis.kind})`);
      }
      // A reason that is only a feeling, a lack of basis, an unclear question or small talk adds almost no
      // content of its own: new subject matter beyond the basis is an invented reason.
      if (["self_state", "no_known_fact", "clarification", "social", "unavailable"].includes(basis.kind)) {
        const allowedWords = new Set([...contentWords(JSON.stringify(basis)), ...contentWords(allowedBlob), ...EXPLANATION_FRAME_WORDS]);
        const novel = contentWords(speech).filter((w) => ![...allowedWords].some((k) => sameStem(k, w)));
        if (novel.length > 2) return reject(CODES.FORBIDDEN, `invented rationale beyond the basis: "${novel.slice(0, 4).join(" ")}"`);
      }
      // Any other reason (danger, plans, experience) is an invented rationale.
      if (DANGER_EVALUATION.test(speech) && !/danger|safe|risk/i.test(JSON.stringify(basis))) return reject(CODES.FORBIDDEN, "invented rationale: a safety or danger state the basis does not hold");
      break;
    }
    case "ask_institution_purpose":
    case "ask_mission_objective":
    case "ask_person_identity":
    case "ask_assignment_purpose":
    case "ask_entity_definition":
    case "ask_location_purpose":
    case "ask_current_action":
    case "ask_role_or_assignment_known": {
      if (contribution.may_ask_clarifying_question) break;
      const known = requiredValue(contribution, "known_concept")[0];
      const gap = requiredValue(contribution, "knowledge_gap")[0];
      if (known) {
        if (!(known.statements ?? []).some((text) => coverage(speech, text) >= 0.5)) return reject(CODES.UNMET, "does not state the known fact");
        if (gap) {
          // Partial knowledge: the known part AND the bounded unknown; the known part never stands in for
          // the missing one (a destination is not a purpose).
          if (!PARTIAL_LACK.test(speech)) return reject(CODES.UNMET, "partial knowledge: say what is not known as well as what is");
          if (/purpose/.test(String(gap.missing)) && /\b(?:they(?:'re| are)|it(?:'s| is)|those are|that'?s|these are) (?:just |all |basically )?for (?:outpost|the outpost|bermuda|delivery|delivering)\b/i.test(speech)) return reject(CODES.CONTRADICTION, "states the destination as the purpose");
        }
      } else if (fn === "ask_current_action" && requiredValue(contribution, "current_action").length) {
        // Own current activity (or none): nothing more to check here.
      } else if (!LACK_SAFE.test(speech) && !/\b(?:nobody|no one)(?:'s| has) (?:told|said)|haven'?t been told|don'?t know (?:who|what|that)\b/i.test(speech)) return reject(CODES.UNMET, "nothing is known: say you haven't been told / don't know");
      break;
    }
    case "ask_reported_speech": {
      if (contribution.may_ask_clarifying_question) break;
      const reported = requiredValue(contribution, "reported_speech")[0];
      if (!reported) {
        if (!/\b(?:didn'?t|did not|never) (?:hear|catch)\b|\bnot that i (?:heard|recall|remember)\b|\bdon'?t (?:recall|remember)\b/i.test(speech)) return reject(CODES.UNMET, "the speaker did not hear it and must say so");
        break;
      }
      // Attributed, never adopted: the speaker is named (or "you said"), and the reported content appears.
      const claims = reported.claims ?? [];
      const attributed = claims.some((c) => (c.epistemic === "player_claim" ? /\byou (?:said|told|mentioned)\b/i.test(speech) : new RegExp(`\\b${String(c.speaker_name ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(speech) && /\b(?:said|says|told|mentioned|according to)\b/i.test(speech)));
      if (!attributed) return reject(CODES.UNMET, "reported speech must be attributed to whoever said it");
      if (!claims.some((c) => coverage(speech, c.reported ?? c.quote ?? "") >= 0.4)) return reject(CODES.UNMET, "does not report what was said");
      if (claims.some((c) => c.epistemic === "player_claim") && PLAYER_CLAIM_ENDORSEMENT.test(speech)) return reject(CODES.FORBIDDEN, "endorses the player's claim as true");
      break;
    }
    case "ask_meaning": {
      if (contribution.may_ask_clarifying_question) break;
      const meaning = requiredValue(contribution, "utterance_meaning")[0];
      if (!meaning) break;
      if (!meaning.own) {
        // Only the speaker can say what their own words meant: point to them, never interpret for them.
        const named = meaning.speaker_name && meaning.speaker_name !== "you" ? new RegExp(`\\b${String(meaning.speaker_name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(speech) : /\byou (?:said|meant|mean)\b/i.test(speech);
        if (!named && !/\b(?:ask (?:her|him|them)|wasn'?t me|didn'?t say)\b/i.test(speech)) return reject(CODES.UNMET, "someone else's line: say they would have to explain it");
        if (/\b(?:she|he|they) (?:means?|meant)\b/i.test(speech)) return reject(CODES.FORBIDDEN, "interprets someone else's words");
        break;
      }
      const supplied = meaning.meaning ? [JSON.stringify(meaning.meaning.value), meaning.meaning.semantics?.phrase, meaning.meaning.semantics?.gloss].filter(Boolean) : [];
      const gloss = meaning.meaning?.semantics?.gloss ?? null;
      if (supplied.length && !supplied.some((text) => coverage(speech, text) >= 0.5) && !(gloss && coverage(speech, gloss) >= 0.3)) return reject(CODES.UNMET, "does not state the meaning the line was authorized with");
      if (LODGING_READING.test(speech) && !LODGING_READING.test(allowedBlob)) return reject(CODES.FORBIDDEN, "reads an assignment as living or lodging arrangements");
      const allowedWords = new Set([...contentWords(allowedBlob), ...EXPLANATION_FRAME_WORDS, "assigned", "assignment", "task", "role", "job", "given", "basically", "simply", "literally"]);
      const novel = contentWords(speech).filter((w) => ![...allowedWords].some((k) => sameStem(k, w)));
      if (novel.length > 3) return reject(CODES.FORBIDDEN, `adds meaning beyond the line's authorized facts: "${novel.slice(0, 4).join(" ")}"`);
      break;
    }
    case "ask_response_event": {
      if (contribution.may_ask_clarifying_question) break;
      const event = requiredValue(contribution, "conversation_event")[0];
      if (!event) break;
      const motive = speech.match(SILENCE_MOTIVE);
      if (motive && !(event.reason === "did_not_hear" && /catch|hear/i.test(motive[0]))) return reject(CODES.FORBIDDEN, `invented motive for the response: "${motive[0]}"`);
      if (!event.responded && /\bi (?:did|do) (?:answer|respond|reply|say)|\bi (?:answered|responded|replied)\b/i.test(speech)) return reject(CODES.CONTRADICTION, "claims an answer that was never given");
      if (event.responded && !/\b(?:did|answered|said|replied|responded)\b/i.test(speech)) return reject(CODES.UNMET, "the speaker did answer and must say so");
      if (event.heard && /\b(?:didn'?t|did not|couldn'?t|could not) (?:hear|catch)|\bmissed (?:it|that|you)\b/i.test(speech)) return reject(CODES.CONTRADICTION, "denies hearing a line the speaker heard");
      if (event.reason === "did_not_hear" && !/\b(?:didn'?t|did not|couldn'?t|could not) (?:hear|catch)|\bmissed\b/i.test(speech)) return reject(CODES.UNMET, "the speaker did not hear it and must say so");
      if (event.reason === "another_answered" && !(event.others_responded ?? []).some((name) => new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(speech)) && !/\b(?:someone|somebody) else\b/i.test(speech)) return reject(CODES.UNMET, "the knowable reason is that someone else answered");
      const allowedWords = new Set([...contentWords(allowedBlob), ...EXPLANATION_FRAME_WORDS, "answer", "answered", "answering", "respond", "responded", "reply", "replied", "sorry", "right", "hear", "heard", "catch", "caught", "then", "earlier", "missed", "someone", "else", "fair", "apologies", "bad"]);
      const novel = contentWords(speech).filter((w) => ![...allowedWords].some((k) => sameStem(k, w)));
      if (novel.length > 2) return reject(CODES.FORBIDDEN, `invented account of the exchange: "${novel.slice(0, 4).join(" ")}"`);
      break;
    }
    case "make_request": {
      const disposition = requiredValue(contribution, "request_disposition")[0];
      if (disposition && REQUEST_ACCEPTANCE.test(speech)) return reject(CODES.FORBIDDEN, "accepts or complies with a request the simulation has not performed");
      // Conversation never performs the requested action: wording may not report it as done.
      if (disposition?.requested_action && /\b(?:done|all set|it'?s with (?:him|her|them|you|me) now|handed (?:it |that )?over|gave (?:it|him|her|them)|passed (?:it|him|her)|here you go|there you go|took care of it|moved it|i'?m waiting here|staying put)\b/i.test(speech)) return reject(CODES.FORBIDDEN, "reports the requested action as done; it has not happened");
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
      } else if (fn === "ask_factual" && contribution.addressee_state && words(speech).length <= 6 && /^\s*(?:yes|yeah|yep|yup|no|nope|sure|ready|okay|ok|fine|all set|i am|i'm|i think so|not really|kind of|sort of)\b/i.test(speech)) {
        // "Are you ready?" -> "Ready." : the addressee's own momentary READINESS (decided by the
        // semantic frame, the one authority), never a past observation, presence, plan or feeling.
      } else if (fn === "ask_factual" && requiredValue(contribution, "uncertainty")[0]?.kind === "did_not_perceive" && !/\b(?:didn'?t|did not|haven'?t|have not|never) (?:notice|see|hear|catch|spot|smell)|not that i (?:noticed|saw|heard)|nothing\b/i.test(speech)) {
        // One's own perception is self-knowledge: "didn't notice", never an outside-fact "I don't know".
        return reject(CODES.UNMET, "the speaker knows what they perceived: say they did not notice anything");
      } else if (fn === "ask_factual" && !LACK_SAFE.test(speech) && !contribution.may_ask_clarifying_question) {
        return reject(CODES.UNMET, "no fact is authorized; the speaker must say they do not know");
      }
      break;
    }
    default:
      break;
  }
  // Style-only runaway guard: length, not sentence count ("Tense. Tired. Under stress." is three natural
  // fragments of one short answer; the per-function word caps above bound brevity).
  if (contribution.expected_response_shape === "short_social_acknowledgment" && speech.length > 220) return reject(CODES.SHAPE, "short social acknowledgment expected");
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
  push(/\bi(?:'ve| have)(?: still)?(?: got)?\b|\bi(?:'m| am)(?: still)? (?:holding|carrying)\b|\bi (?:still )?(?:hold|carry|took)\b/gi, () => ({ subject: "first", kind: "possession", side: "after" }));
  push(/\b([A-Z][a-z]+)(?:'s (?:holding|carrying|got)|(?: has| have| is holding| is carrying| holds| carries| took))\b/g, (m) => ({ subject: "named", name: m[1], kind: "possession", side: "after" }));
  push(/\b(?:she|he)(?:'s (?:holding|carrying|got)| has| holds| carries| is holding)\b/gi, () => ({ subject: "pronoun", kind: "possession", side: "after" }));
  push(/\byou(?:'ve| have)(?: still)?(?: got)?\b|\byou(?:'re| are)(?: still)? (?:holding|carrying)\b|\byou (?:still )?(?:hold|carry)\b/gi, () => ({ subject: "player", kind: "possession", side: "after" }));
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
  if (META_PLAYER.test(speech) || PLAYER_LABEL.test(speech) || PLAYER_ADDRESS.test(speech)) return reject(CODES.FORBIDDEN, "refers to the player as a game construct");
  return validateOntology(speech);
}

module.exports = { operationalClaims, unlicensedClaims, asksQuestion, validateOntology, validateUniversalWording, CODES, coverage, contentWords, sameStem, validateContribution, validateOwnershipClaims, samePersonnel };
