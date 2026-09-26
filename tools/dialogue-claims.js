"use strict";

// Candidate-line claim extraction and semantic answer validation (ED-30 H1-H5).
//
// The contribution ceiling used to see only operational TERMS; it could not tell that "Tonya's doing
// alright too." is a claim about another person's private state. This module extracts PROPOSITIONS from a
// candidate NPC line -- (subject, predicate family, polarity, temporal scope, hedge, reported?) -- using the
// Semantic Registry's claim lexicon, and checks them:
//
//   H2 grounding       a self-claim in a personal predicate must be licensed by the plan (and match its
//                      value); no precision beyond the registry's granularity (counts, exact tenure)
//   H3 entity ceiling  no canonical person/place/item the plan, the player's words or this turn's earlier
//                      accepted lines do not already involve
//   H4 private state   another person's SELF_PRIVATE / SELF_HISTORY facts only as an attributed report the
//                      plan licenses (never "Tonya's fine too", "She's new, like me")
//   H5 responsiveness  a grounded line must still ANSWER the open slot per the registry answer contract;
//                      an answer to a neighbouring facet is NONRESPONSIVE
//
// Deterministic and bounded: regular lexicons over clauses, never a model.

const registry = require("./dialogue-registry");
const { expandContractions } = require("./dialogue-normalize");

const CLAIMS_VERSION = "yellow-beast-dialogue-claims@v1";
const CODES = Object.freeze({ PRIVATE: "LOCAL_PRESENTATION_THIRD_PARTY_PRIVATE_STATE", NONRESPONSIVE: "LOCAL_PRESENTATION_NONRESPONSIVE", PRECISION: "LOCAL_PRESENTATION_MANUFACTURED_PRECISION", UNLICENSED_SELF: "LOCAL_PRESENTATION_UNLICENSED_SELF_CLAIM", ENTITY: "LOCAL_PRESENTATION_ENTITY_CEILING", CONTRADICTION: "LOCAL_PRESENTATION_CLAIM_CONTRADICTION" });
const reject = (code, reason) => ({ ok: false, code, reason });
const escapeRe = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PERSONAL = new Set([registry.EPISTEMIC.SELF_PRIVATE, registry.EPISTEMIC.SELF_HISTORY]);
const FILLER = /^(?:(?:not really|not quite|not exactly|yeah|yes|yep|yup|no|nope|nah|well|honestly|so|oh|um|uh|hm+|right|sure|okay|ok|actually|nope|mm|ha|haha|heh|and|but|though|also|plus)[,.!]?\s+)+/i;
const NEGATION = /\b(?:not|never|no|nope|nah|n't|haven't|hasn't|isn't|wasn't|aren't|don't|didn't|won't|cannot|can't|neither|nor|none|nothing)\b/i;
const REPORT_VERB = /\b(?:said|says|told|mentioned|reckoned|was saying|said so|according to)\b/i;
const HEDGE = /\b(?:think|guess|probably|maybe|might|seems?|looks like|i'd say|as far as i know|apparently|i believe)\b/i;
const ECHO = /^(?:same(?: here)?|me too|me neither|me as well|likewise|ditto|same for me|same with me|so am i|so do i|neither am i|neither have i|so have i)\b/i;

// Families beyond registry lexicons that still make a clause a PERSONAL claim.
const EXTRA_LEXICON = Object.freeze({
  "person.wellbeing": [/\b(?:seems?|looks?|sounds?)\s+(?:\w+\s+)?(?:fine|okay|ok|alright|all right|good|well|great|nervous|tired|new|experienced|scared|calm|happy|upset|worried|ready|keen|excited)\b/i, /\bholding (?:it together|up)\b/i, /\b(?:hasn'?t|has not|didn'?t|did not) complain(?:ed)?\b/i, /^(?:both|all)\s+(?:\w+\s+)?(?:fine|good|okay|well|alright|all right|nervous|tired)\b/i, /\b(?:terrified|petrified|freaked out|bored|miserable|thrilled)\b/i, /\b(?:doing|feeling|holding up)\b/i, /\b(?:is|are|am|'s|'re)\s+(?:(?:all|both|just|pretty|really|totally|perfectly|doing|feeling)\s+)*(?:fine|okay|alright|all right|good|well|great|ok)\b/i, /\bnot (?:too |so )?bad\b/i, /\bhanging in\b/i],
  "person.intent": [/\b(?:wants?|hopes?|wishes?|plans?|intends?) to\b/i],
  "person.opinion": [/\b(?:likes|loves|hates|dislikes|enjoys)\b/i],
  "person.memory": [/\b(?:remembers?|forgot|forgets)\b|(?<!verbal )\brecalls?\b/i]
});
const EXTRA_EPISTEMIC = Object.freeze({ "person.intent": "SELF_PRIVATE", "person.opinion": "SELF_PRIVATE", "person.memory": "SELF_PRIVATE" });

function familiesOf(clause, inverted = null) {
  // A name's "'s" before a predicate is "is"/"has" ("Tonya's new" -> "tonya is new").
  const text = expandContractions(String(clause).toLowerCase())
    .replace(/\b([a-z]+)'s\s+(been|got|done|gone|had|seen|met|worked)\b/g, "$1 has $2")
    .replace(/\b([a-z]+)'s\s+(?=(?:new|doing|fine|okay|ok|alright|nervous|excited|tired|scared|worried|here|not|also|too|just|still|probably|a|an|the|going|coming|feeling|never|looking)\b)/g, "$1 is ");
  const out = [];
  for (const entry of registry.all()) {
    if (!PERSONAL.has(entry.epistemic_class)) continue;
    const hits = entry.lexicon.filter((lex) => lex.pattern.test(text));
    if (!hits.length) continue;
    out.push(entry.id);
    if (inverted && hits.every((lex) => lex.invert)) inverted.add(entry.id);
  }
  for (const [family, patterns] of Object.entries(EXTRA_LEXICON)) if (!out.includes(family) && patterns.some((p) => p.test(text))) out.push(family);
  return out;
}
const epistemicOf = (family) => registry.get(family)?.epistemic_class ?? EXTRA_EPISTEMIC[family] ?? null;

/** Splits a line into claim clauses: sentences, then coordinated clauses with their own subject. */
function claimClauses(speech) {
  const sentences = String(speech ?? "").replace(/[‘’]/g, "'").split(/(?<=[.!?;])\s+|\s*;\s*|\s+—\s+|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const sentence of sentences) {
    // "Not too bad myself, and Tonya's doing alright too" -> two clauses (the second has its own subject).
    const parts = sentence.split(/,?\s+(?:and|but|while|though|although|plus)\s+(?=(?:i|i'm|i've|you|you're|we|we're|he|she|they|he's|she's|they're|[A-Z][a-z]+(?:'s)?)\b)|,\s+(?=(?:he|she|they|he's|she's|they're|[A-Z][a-z]+'s|[A-Z][a-z]+ (?:is|was|has|seems|looks|feels))\b)/);
    for (const part of parts) if (part.trim()) out.push(part.trim());
  }
  return out;
}

/**
 * H1: propositions of one candidate line. `people` = [{ id, name, names }] (present coworkers and other
 * canonical persons); `speaker_id` / `speaker_name` identify self.
 */
function extractPropositions(speech, { people = [], speaker_id = null, speaker_name = null, player_names = [] } = {}) {
  const out = [];
  const nameIndex = [];
  for (const p of people) for (const n of [p.name, ...(p.names ?? [])].filter(Boolean)) nameIndex.push({ n: String(n), id: p.id });
  nameIndex.sort((a, b) => b.n.length - a.n.length);
  for (const clause of claimClauses(speech)) {
    const body = clause.replace(FILLER, "").trim();
    const lower = expandContractions(body.toLowerCase());
    let subject = null;
    let subject_id = null;
    if (ECHO.test(lower)) { out.push({ clause, subject: "echo_self", subject_id: speaker_id, families: [], polarity: /neither|me neither/.test(lower) ? "negative" : "positive", reported: false, hedged: false }); continue; }
    const named = nameIndex.find(({ n }) => new RegExp(`^${escapeRe(n)}(?:'s\\b|\\s+(?!,)[a-z])`, "i").test(body)) ?? nameIndex.find(({ n }) => new RegExp(`\\b(?:and|but|so|while)\\s+${escapeRe(n)}(?:'s|\\s+(?:is|was|has|seems|looks))\\b`, "i").test(body));
    // A possessor names the subject of a personal-history noun ("It's Giselle's first day").
    const possessor = body.match(/\b([A-Z][a-z]+)'s (?:first|own|last|nerves|feelings?|history|experience)\b/)?.[1] ?? null;
    const possessorPerson = possessor ? nameIndex.find(({ n }) => n.toLowerCase() === possessor.toLowerCase()) : null;
    if (possessor && !(possessorPerson && possessorPerson.id === speaker_id) && !(speaker_name && possessor.toLowerCase() === String(speaker_name).toLowerCase())) { subject = "third_party"; subject_id = possessorPerson?.id ?? null; }
    else if (/^(?:i|i'm|i am|i've|i have|i'd|i was|i'll|me|my|myself|mine)\b/i.test(body) || /\bmy (?:first|own|job|role|day|time)\b/i.test(body) || /\bmyself\b/i.test(body)) subject = "self";
    else if (named && new RegExp(`^${escapeRe(named.n)}\\s+and\\s+(?:i|me)\\b`, "i").test(body) && /\b(?:met|meet|know|knew|worked together)\b/i.test(body)) subject = "self"; // "Tonya and I just met" (joint acquaintance)
    else if (named && named.id === speaker_id) subject = "self_by_name";
    else if (named) { subject = "third_party"; subject_id = named.id; }
    else if (/^(?!(?:It|That|This|There|Here|Not|Nobody|Everyone|Everybody|Someone|Somebody|Nothing|What|Who|Where|When|Why|How|Yes|No|Yeah|Sure|Honestly|Well|Just|Only|Maybe|Probably|Definitely|Today|First|Never|Always|Pretty|Really|Same|Like|All|Both|Each|Neither|None|Mine|Our|The|A|An)\b)[A-Z][a-z]+(?:'s\b|\s+(?:is|was|has|had|seems|looks|feels|sounds|wants|hopes|thinks|remembers|knows|likes|hates|loves|said|says|told|isn't|hasn't|doesn't|didn't|wasn't|does|did|will|would|can|could|should|might|must|also|too|really|probably|definitely|just|never|already)\b)/.test(body)) subject = "third_party";
    else if (/^(?:you|you're|you've|your|you'll)\b/i.test(body)) subject = "addressee";
    else if (/^(?:we|we're|we've|we'd|us|both|all of us|both of us|none of us|neither of us|everyone|everybody|the (?:others|rest of us|rest|team|two of them|other two)|all three of us|the three of us|each of us)\b/i.test(body)) subject = "group";
    else if (/^(?:he|she|they|he's|she's|they're|his|her|their|him|them)\b/i.test(body)) subject = "third_unresolved";
    else if (speaker_name && new RegExp(`^${escapeRe(speaker_name)}\\b`, "i").test(body)) subject = "self";
    else subject = "implicit_self"; // "Not too bad." / "Doing fine." / "First day, yes."
    const inverted = new Set();
    const families = familiesOf(body, inverted);
    const negated = NEGATION.test(lower);
    // "First time for me." asserts NO prior experience; "Not my first time." asserts some.
    const polarity = families.length && families.every((f) => inverted.has(f)) ? (negated ? "positive" : "negative") : (negated ? "negative" : "positive");
    out.push({ clause, body, subject, subject_id, families, polarity, reported: REPORT_VERB.test(lower), hedged: HEDGE.test(lower) });
  }
  return out;
}

/** Plan-licensed propositions: statements and structured answers the contribution carries. */
function licenseOf(contribution) {
  const facts = [...(contribution?.required_facts ?? []), ...(contribution?.optional_facts ?? [])];
  const predicateAnswers = facts.filter((f) => f.key === "predicate_answer").map((f) => f.value);
  const reportedAbout = new Set();
  const ownQuotes = [];
  const reportedStatements = [];
  for (const f of facts) {
    if (f.key === "reported_speech") for (const c of f.value?.claims ?? []) if (c.speaker_id) reportedAbout.add(c.speaker_id);
    if (f.key === "reported_speech") for (const c of f.value?.claims ?? []) if (c.epistemic === "own_speech" && typeof c.quote === "string") ownQuotes.push(c.quote);
    // What was heard is licensed only as the report it is ("Tonya said she was doing all right").
    if (f.key === "reported_speech") for (const c of f.value?.claims ?? []) if (c.reported && c.speaker_name) reportedStatements.push(`${c.speaker_name} said ${c.reported}`);
    if (f.key === "predicate_answer" && f.value?.answer?.reported && f.value.answer.speaker_id) reportedAbout.add(f.value.answer.speaker_id);
  }
  const statements = [];
  for (const f of facts) {
    if (Array.isArray(f.value?.statements)) statements.push(...f.value.statements);
    if (typeof f.value === "string") statements.push(f.value);
    if (f.value?.text) statements.push(f.value.text);
    // Repair: the preceding lines the speaker may repeat verbatim.
    if (Array.isArray(f.value)) for (const v of f.value) if (typeof v?.text === "string") statements.push(v.text);
  }
  statements.push(...ownQuotes, ...reportedStatements);
  const selfState = facts.find((f) => f.key === "self_state")?.value ?? null;
  const personalFamiliesLicensed = new Set(predicateAnswers.filter((a) => !a.answer?.reported && !a.answer?.third_party).map((a) => a.predicate));
  // A self-state answered from the recorded dimensions ("Earlier? I was a little nervous.") licenses the same
  // self-state families a check-in does.
  if (selfState || predicateAnswers.some((a) => a.answer?.dimensions && !a.answer?.reported)) for (const id of ["person.wellbeing", "person.nervousness", "person.anticipation", "person.fatigue"]) personalFamiliesLicensed.add(id);
  if (facts.some((f) => f.key === "prior_expedition_experience")) personalFamiliesLicensed.add("person.expedition_experience");
  if (facts.some((f) => ["name", "role", "current_assignment"].includes(f.key))) personalFamiliesLicensed.add("person.self_description");
  return { facts, predicateAnswers, reportedAbout, statements, selfState, personalFamiliesLicensed };
}

const coverage = (a, b) => {
  const words = (t) => [...new Set(String(t).toLowerCase().match(/[a-z']{3,}/g) ?? [])];
  const x = words(a);
  if (!x.length) return 0;
  const y = new Set(words(b));
  return x.filter((w) => y.has(w)).length / x.length;
};

/**
 * H4 + H2 over a candidate line. Returns { ok } or a rejection. `prior` = this turn's already-accepted
 * lines (for "Same here" echoes); `people` resolve third-party subjects.
 */
// Two wordings say the same thing only with the same polarity ("said they'd been in" vs "said they'd never
// been in" share every content word) -- review N1.
const negated = (text) => NEGATION.test(expandContractions(String(text ?? "").toLowerCase()));
// ...and with the same PERSON: "Maxwell said I'm on observation" (the speaker) is not "Maxwell said he's on
// observation" (Maxwell) -- final J15 finding.
const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b/i;
const samePerson = (a, b) => FIRST_PERSON.test(String(a)) === FIRST_PERSON.test(String(b));
const sameClaim = (a, b, ab = 0.7, ba = 0.6) => coverage(a, b) >= ab && coverage(b, a) >= ba && negated(a) === negated(b) && samePerson(a, b);
// A joined report ("X said A, and that B, and that C"): every sub-claim must be one heard statement, same polarity.
// A report may re-voice pronouns and tense ("she was" -> "they were"); its content words must not change.
const reportNorm = (text) => String(text).replace(/\b(?:mentioned|told me|told us|says|was saying)\b/gi, "said").replace(/\b(?:being|that)\b/gi, " ").replace(/\b(?:she|he|they|them|her|him|their|his)\b/gi, "x").replace(/\b(?:was|were|is|are|'s|'re)\b/gi, "be").replace(/\b(?:she's|he's|they're)\b/gi, "x be");
function reportCovered(clause, heard) {
  heard = heard.map(reportNorm);
  const parts = String(clause).split(/,?\s+and that\s+|,\s+and\s+(?=[a-z]+\s+(?:said|told)\b)/i).map((x) => reportNorm(x).trim()).filter(Boolean);
  const subject = reportNorm(String(clause).match(/^(.*?\b(?:said|says|told me|told us|mentioned))\s+/i)?.[1] ?? "");
  return parts.every((part, i) => heard.some((st) => {
    const full = i === 0 ? part : `${subject} ${part}`;
    return coverage(full, st) >= 0.8 && negated(full) === negated(st) && samePerson(part, st.replace(/^.*?\bsaid\b/i, ""));
  }));
}
function validatePersonalClaims(speech, contribution, { people = [], speaker_id = null, speaker_name = null, prior = [] } = {}) {
  const license = licenseOf(contribution);
  // A verbatim quotation of a licensed line ('I said, "Honestly, a little nervous."') re-asserts nothing
  // new: it is removed before extraction. An unlicensed quotation stays and is checked like any claim.
  const quoted = String(speech ?? "").replace(/[“”]/g, '"').replace(/(?:^|(?<=[.!?"]\s))[^".!?]*\bsaid,?\s*"([^"]+)"\s*/g, (whole, inner) => (license.statements.some((s) => coverage(inner, s) >= 0.9 && coverage(s, inner) >= 0.9) ? "" : whole));
  // "According to Tonya, X" is the report "Tonya said X".
  const props = extractPropositions(quoted.replace(/\b[Aa]ccording to ([A-Z][a-z]+),\s*/g, "$1 said "), { people, speaker_id, speaker_name });
  // Answering about ONESELF (or about someone as a heard report): another person named in the line may appear
  // only in a licensed statement, a licensed report, or "you'd have to ask them" -- never as an aside about
  // how they are ("I'm fine, and so is Tonya", "Tonya seems okay", "though I think so") (review F5).
  const personalPlan = ["check_in", "invite_self_description", "ask_personal_experience"].includes(contribution?.discourse_function) || license.predicateAnswers.some((a) => /^person\./.test(a.predicate ?? ""));
  if (personalPlan) {
    for (const other of people.filter((x) => x.id !== speaker_id)) {
      const names = [other.name, ...(other.names ?? [])].filter(Boolean);
      if (!names.length) continue;
      const nameRe = new RegExp(`\\b(?:${names.map(escapeRe).join("|")})\\b`, "i");
      for (const sentence of String(quoted).split(/(?<=[.!?])\s+/).filter((x) => nameRe.test(x))) {
        const bare = sentence.replace(/^(?:no idea|couldn'?t tell you|i couldn'?t tell you|i don'?t know|not sure|no),?\s*/i, "").trim();
        if (/^(?:but |so )?(?:you'?d|you would|you'll|you will|you might|better|you should) (?:have to |need to |want to )?ask\s+\w+[.!]?$/i.test(bare)) continue;
        if (license.statements.some((st) => sameClaim(sentence, st))) continue;
        // Legitimate deflections and addresses (review N7): "Ask Tonya.", "Tonya would know.", "Why don't you ask
        // Tonya?", "..., Tonya." as a vocative, a line about meeting them when that is the question, and a report
        // by them that carries exactly what was heard.
        if (/\b(?:ask|asking)\s+\w+(?:\s+(?:herself|himself|themselves|themself|directly|yourself))?\s*[.!?]?$/i.test(bare) && !/\b(?:think|probably|pretty sure|guess|bet|reckon|so)\b/i.test(bare.replace(nameRe, ""))) continue;
        if (/^\w+\s+(?:would|might|should|could)\s+know\s*[.!]?$/i.test(bare)) continue;
        if (new RegExp(`,\\s*(?:${names.map(escapeRe).join("|")})\\s*[.!?]*$`, "i").test(sentence) && !/\b(?:too|as well|also|either)\b/i.test(sentence)) continue;
        if (license.predicateAnswers.some((a) => a.predicate === "person.familiarity") && /\b(?:met|meet|know|knew)\b/i.test(sentence)) continue;
        const heardReports = license.statements.filter((st) => REPORT_VERB.test(st));
        if (heardReports.length && new RegExp(`(?:\\b(?:${names.map(escapeRe).join("|")})\\s+(?:said|says|told|mentioned|was saying)|according to (?:${names.map(escapeRe).join("|")}))\\b`, "i").test(sentence) && coverage(sentence.replace(/^according to \w+,?\s*/i, ""), heardReports.join(" ")) >= 0.5 && negated(sentence) === heardReports.some(negated)) continue;
        return reject(CODES.PRIVATE, `says something about ${names[0]} this turn does not license ("${sentence.trim()}")`);
      }
    }
  }
  for (const p of props) {
    const personal = p.families.filter((f) => PERSONAL.has(epistemicOf(f)));
    if (p.subject === "echo_self") {
      // "Same here" claims the echoed proposition about oneself: only true when one's own value matches.
      const echoed = prior.flatMap((line) => extractPropositions(line, { people }).filter((x) => x.families.length)).at(-1) ?? null;
      const mine = license.predicateAnswers.find((a) => echoed?.families.includes(a.predicate)) ?? license.predicateAnswers[0] ?? null;
      if (!echoed && !mine && !license.selfState) return reject(CODES.UNLICENSED_SELF, `"${p.clause}" echoes a claim about oneself the plan does not supply`);
      if (echoed && mine && ["yes", "no"].includes(mine.value) && (echoed.polarity === "negative") !== (mine.value === "no")) return reject(CODES.CONTRADICTION, `"${p.clause}" echoes a claim that is not true of the speaker`);
      // "Same here." after "I'm terrified.": the echoed feeling must be the speaker's own canonical state.
      if (echoed && !mine && license.selfState && echoed.families.some((f) => ["person.nervousness", "person.fatigue", "person.anticipation", "person.wellbeing"].includes(f))) {
        const affect = (license.selfState.affect ?? []).join(" ");
        const nervousEcho = echoed.families.includes("person.nervousness") && echoed.polarity !== "negative";
        if (nervousEcho && !/nervous|tense|stress|anxious/i.test(affect)) return reject(CODES.CONTRADICTION, `"${p.clause}" echoes a feeling the speaker does not have`);
        if (/\b(?:terrified|petrified|freaked|miserable|thrilled|bored)\b/i.test(prior.at(-1) ?? "")) return reject(CODES.UNLICENSED_SELF, `"${p.clause}" echoes a feeling beyond the speaker's canonical state`);
      }
      continue;
    }
    // A person never talks about themselves in the third person ("Tonya's doing alright" said by Tonya).
    if (p.subject === "self_by_name") return reject("LOCAL_PRESENTATION_SHAPE_VIOLATION", `the speaker refers to themselves by name ("${p.clause}")`);
    if (!personal.length) continue;
    // A clause is "the licensed statement" only when it matches it both ways (a report that drops "said"
    // and turns into a present-tense fact is not the report).
    const licensedStatement = license.statements.some((s) => sameClaim(p.body ?? p.clause, s, 0.8, 0.7) && (!REPORT_VERB.test(s) || p.reported));
    // "We met today" answering "do you two know each other?": acquaintance is joint -- it includes the speaker.
    if (p.subject === "group" && /^(?:we|we've|we have|us)\b/i.test(expandContractions((p.body ?? p.clause).toLowerCase())) && personal.every((f) => f === "person.familiarity") && license.predicateAnswers.some((a) => a.predicate === "person.familiarity")) p.subject = "self";
    if (["third_party", "third_unresolved", "group", "addressee"].includes(p.subject)) {
      if (licensedStatement) continue;
      // A report is a report only when the reported person is the one saying it ("Tonya said..."), and it may
      // carry only what was heard: content is compared with the licensed report (review F5).
      const who = p.subject_id ? people.find((x) => x.id === p.subject_id) : null;
      const saidBy = who ? new RegExp(`\\b(?:${[who.name, ...(who.names ?? [])].filter(Boolean).map(escapeRe).join("|")}|she|he|they)\\s+(?:said|says|told|mentioned|was saying)\\b|\\baccording to (?:${[who.name, ...(who.names ?? [])].filter(Boolean).map(escapeRe).join("|")})\\b`, "i").test(p.clause) : /\b(?:she|he|they|[A-Z][a-z]+)\s+(?:said|says|told|mentioned)\b/.test(p.clause);
      // A joined report ("X said A, and that B, and that C") is judged against everything heard together.
      const heardContent = reportCovered(p.body ?? p.clause, license.statements.filter((st) => REPORT_VERB.test(st)));
      const reportOk = p.reported && saidBy && heardContent && (p.subject_id ? license.reportedAbout.has(p.subject_id) : license.reportedAbout.size > 0);
      if (!reportOk) return reject(CODES.PRIVATE, `states ${p.subject === "addressee" ? "the player's" : p.subject === "group" ? "other people's" : "another person's"} ${personal[0].replace(/^person\./, "")} ("${p.clause}"); only that person may, or an attributed report the plan licenses`);
      continue;
    }
    // Self claims: licensed families only, and consistent with the licensed value. Opinion/memory idioms
    // about oneself ("can't think of", "don't recall") are hedges, not personal-history claims.
    const unlicensed = personal.filter((f) => registry.get(f) && !(["person.intent"].includes(f) && p.polarity === "negative") && !license.personalFamiliesLicensed.has(f) && !(f === "person.async_tenure" && license.personalFamiliesLicensed.has("person.first_day_at_async")) && !(f === "person.first_day_at_async" && [...license.personalFamiliesLicensed].some((x) => /experience|tenure/.test(x))) && !(f === "person.expedition_experience" && license.personalFamiliesLicensed.has("person.complex_experience")) && !(f === "person.complex_experience" && license.personalFamiliesLicensed.has("person.expedition_experience")));
    if (unlicensed.length && !licensedStatement && p.subject === "self") return reject(CODES.UNLICENSED_SELF, `claims ${unlicensed[0].replace(/^person\./, "")} about the speaker that this turn does not supply ("${p.clause}")`);
    for (const answer of license.predicateAnswers) {
      if (!personal.includes(answer.predicate) || !["yes", "no"].includes(answer.value) || p.hedged) continue;
      const saysNo = p.polarity === "negative";
      if (saysNo !== (answer.value === "no") && !licensedStatement) return reject(CODES.CONTRADICTION, `"${p.clause}" contradicts the speaker's own ${answer.predicate.replace(/^person\./, "")} (${answer.value})`);
    }
  }
  return { ok: true, propositions: props };
}

// H2: precision beyond the registry's granularity (E8).
const COUNT_CLAIM = /\b(?:(?:plenty|lots|loads|multiple|countless|a bunch|a number) of times|(?:many|multiple|several|countless|a few|a couple of) (?:times|occasions|runs|trips)|more times than i can count|once|twice|thrice|\d+\s*(?:times|expeditions?|trips?|runs?|missions?)|(?:a couple|a few|several|many|two|three|four|five|six|seven|eight|nine|ten|dozens? of|a dozen|a handful of|numerous) (?:times|expeditions|trips|runs|missions|crossings))\b/i;
const EXACT_TENURE = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple of|a dozen)\s+(?:days?|weeks?|months?|years?)\b|\b(?:about|around|nearly|almost|over|just over|under|roughly)?\s*an? (?:day|week|month|year)(?: and a half)?\b|\ba (?:year|month|week) and a half\b|\bsince (?:spring|summer|fall|autumn|winter|the \w+|january|february|march|april|may|june|july|august|september|october|november|december|\d{4}|last (?:year|month|spring|summer|fall|autumn|winter))\b/i;
function validatePrecision(speech, contribution) {
  const answers = licenseOf(contribution).predicateAnswers;
  const s = String(speech);
  if (COUNT_CLAIM.test(s) && !answers.some((a) => a.answer?.count != null)) return reject(CODES.PRECISION, `adds a count canon does not store: "${s.match(COUNT_CLAIM)[0]}"`);
  const exact = s.match(EXACT_TENURE);
  if (exact && !/\b(?:first|today)\b/i.test(exact[0])) {
    const stated = licenseOf(contribution).statements.join(" ").toLowerCase();
    if (!stated.includes(exact[0].toLowerCase())) return reject(CODES.PRECISION, `states a tenure/time precision canon does not store: "${exact[0]}"`);
  }
  // E8: no manufactured backstory -- WHEN or HOW one's history happened ("it was a long time ago", "back when I
  // was at...", "last year") is not in any profile band; only the plan's own statements may say it.
  const stated = licenseOf(contribution).statements.join(" ").toLowerCase();
  const anchor = s.match(BACKSTORY_ANCHOR);
  if (anchor && !stated.includes(anchor[0].toLowerCase())) return reject(CODES.PRECISION, `adds backstory canon does not store: "${anchor[0]}"`);
  // Relatives, prior postings, losses: invented biography (the same class the ceiling calls a forbidden claim).
  const event = s.match(BACKSTORY_EVENT);
  if (event && !stated.includes(event[0].toLowerCase())) return reject("LOCAL_PRESENTATION_FORBIDDEN_CLAIM", `invents biography canon does not store: "${event[0]}"`);
  return { ok: true };
}
// Invented personal history: relatives, prior postings, losses and near-death events (never in a profile band).
const BACKSTORY_EVENT = /\bmy (?:sister|brother|mother|mom|mum|dad|father|parents|wife|husband|partner|kids?|son|daughter|family|cousin|uncle|aunt|friend|old team|last team|old unit|old job|last job)\b|\b(?:we|i) lost (?:two|three|a|my|some|people|someone)\b|\blost (?:a|my) (?:partner|brother|sister|friend|colleague|teammate)\b|\bwhere i lost\b|\bnearly (?:didn'?t|did not|died|lost)\b|\b(?:didn'?t|did not) come back\b|\bsaw things\b|\btransferred (?:from|in from|over from)\b|\bgot me (?:the|this) job\b|\bon my (?:old|last|previous) (?:team|crew|run|crossing|expedition)\b/i;
const BACKSTORY_ANCHOR = /\b(?:(?:a )?long time ago|(?:a few |some |many |several |two |three )?(?:years|months|weeks) ago|a while (?:back|ago)|last (?:year|month|week|time|summer|winter|spring|fall)|back (?:in|when|then)|when i was (?:younger|a kid|at|in|with)|years back|ages ago|the (?:last|first) time i (?:was|went))\b/i;

/**
 * H3: the authorized entity ceiling. Canonical people/places/items named in the line must already be
 * involved by the plan, the player's words, or an earlier accepted line this turn. `entities` is the
 * canonical entity index; self and the player are always allowed.
 */
function validateEntityCeiling(speech, contribution, { entities = [], player_text = "", speaker_id = null, resolveMentions = null, prior = [] } = {}) {
  if (!resolveMentions) return { ok: true };
  const mentions = resolveMentions(speech, entities).filter((e) => !e.is_player && e.id !== speaker_id && ["person", "location", "entity", "equipment", "institution"].includes(e.kind));
  if (!mentions.length) return { ok: true };
  const allowed = JSON.stringify([contribution?.required_facts, contribution?.optional_facts, contribution?.antecedent, contribution?.referents, contribution?.resumed_question, prior]).toLowerCase();
  const said = String(player_text ?? "").toLowerCase();
  const involved = new Set(resolveMentions(`${allowed} ${said}`, entities).map((e) => e.id));
  for (const m of mentions) {
    if (involved.has(m.id)) continue;
    if (allowed.includes(String(m.matched ?? m.label).toLowerCase())) continue;
    return reject(CODES.ENTITY, `brings in ${m.label}, which this turn does not involve`);
  }
  return { ok: true };
}

// ─── H5: answer responsiveness (registry answer contracts) ───────────────────────────────────────────────
const YES = /^(?:yes|yeah|yep|yup|sure(?!\s+(?:is|was|looks|seems|feels|sounds)\b)|of course|definitely|absolutely|it is|i have|i am|i do|correct|that's right|right)\b/i;
const NO = /^(?:no|nope|nah|not (?:really|at all|yet|me)|never|i have not|i haven't|i'm not|i am not|it's not|it is not|not my)\b/i;
const LACK = /\b(?:don'?t know|do not know|no idea|not sure|can'?t say|couldn'?t say|nobody(?:'s| has)? (?:said|told)|no one(?:'s| has)? (?:said|told)|haven'?t been told|hasn'?t been (?:said|decided|settled)|not been (?:said|decided)|wasn'?t told|weren'?t told|have to ask|you'?d have to ask|ask (?:her|him|them)|not established|nothing's been said|hasn'?t come up|not that i (?:can think of|know of|recall|remember)|couldn'?t tell you|can'?t think of)\b/i;
const PLACE_WORDS = /\b(?:outpost a|outpost|bermuda|equipment staging|staging|the complex|complex|threshold|kv31|briefing room)\b/i;
const PARTICIPANT_WORDS = /\b(?:all of us|everyone|everybody|we all|all four|all three|the whole team|together|each of us|every one of us|both of you|you too|all going|all coming|we're all|we are all|split(?:ting)? up|separately)\b/i;
// A time answer names a clock time or a schedule word -- a bare number ("about 2 kilometers") is not one.
const TIME_WORDS = /\b(?:\d{1,2}:\d{2}(?:\s*(?:a\.?m\.?|p\.?m\.?))?|\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|o'?clock)|noon|midday|midnight|(?:ten|eleven|twelve|one|two|three|four|five|six|seven|eight|nine) o'?clock|cutoff|departure|deadline)(?![a-z])/i;
const ROUTE_WORDS = /\b(?:tape|route|follow|arrows?|way|path)\b/i;
const TENURE_WORDS = Object.freeze({ first_day: /\b(?:first day|today|new|just started)\b/i, weeks: /\bweeks?\b/i, months: /\bmonths?\b/i, years: /\byears?\b|\ba long time\b|\ba while\b/i });

/**
 * The yes/no a line gives ABOUT THE PREDICATE (not about the question's wording): its own content wins over a
 * leading "yes"/"no"; a bare "yes"/"no" to an inverted question ("Is this your first time?") is flipped;
 * "I have no idea" is no answer at all (review F2/F8).
 */
function polarityOf(speech, predicate, props, { inverted = false } = {}) {
  const lead = String(speech).trim().replace(/^(?:well|honestly|so|oh|um|hm+|ha),?\s+/i, "");
  if (LACK.test(lead.split(/[.!?]/)[0] ?? lead)) return null;
  const own = props.find((p) => ["self", "implicit_self"].includes(p.subject) && p.families.includes(predicate));
  if (own) return own.polarity === "negative" ? "no" : "yes";
  const flip = (v) => (inverted ? (v === "yes" ? "no" : "yes") : v);
  if (NO.test(lead)) return flip("no");
  if (YES.test(lead)) return flip("yes");
  const other = props.find((p) => ["self", "implicit_self"].includes(p.subject) && p.families.length);
  if (other) return other.polarity === "negative" ? "no" : "yes";
  return null;
}

/**
 * H5: does the line answer the slot? Checks the registry contract for the plan's predicate. A grounded
 * line that answers a neighbouring facet (objective for destination, definition for experience, next step
 * for participants) is NONRESPONSIVE.
 */
function validateResponsiveness(speech, contribution, { people = [], speaker_id = null, speaker_name = null } = {}) {
  const answer = (contribution?.required_facts ?? []).find((f) => f.key === "predicate_answer")?.value ?? null;
  if (!answer || contribution?.may_ask_clarifying_question) return { ok: true };
  const entry = registry.get(answer.predicate);
  const kind = entry?.answer_contract?.kind ?? null;
  const s = String(speech);
  // Not knowing is not a guess: no "probably not" / "pretty sure it isn't" after the "I don't know" (review N6).
  if (["unknown", "not_established"].includes(answer.value) && (/\b(?:probably|pretty sure|i(?:'d| would) (?:say|guess)|i guess|i bet|i reckon|likely|i doubt|i suspect|chances are)\b/i.test(s) || s.split(/(?<=[.!?])\s+/).some((sn) => /^(?:yes|yeah|yep|no|nope|nah)\b(?!\s+idea)/i.test(sn.trim()) && !/^no,?\s+(?:idea|clue)\b/i.test(sn.trim())))) return reject(CODES.NONRESPONSIVE, "guesses where the speaker does not know");
  if (["unknown", "not_established"].includes(answer.value)) return LACK.test(s) || /\b(?:nobody|no one|haven'?t heard|didn'?t hear)\b/i.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, `the answer is ${answer.value === "unknown" ? "not known to the speaker" : "not established"}; the line must say so`);
  if (answer.answer?.reported) return REPORT_VERB.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "a report of what someone said must be attributed");
  const props = extractPropositions(s, { people, speaker_id, speaker_name });
  switch (kind) {
    case "self_polarity": {
      const said = polarityOf(s, answer.predicate, props, { inverted: Boolean(answer.inverted) });
      // A leading yes/no that disagrees with the line's own content ("No, this is my first expedition." to "Is
      // it your first expedition?") tells the listener two opposite things.
      const lead = s.trim().replace(/^(?:well|honestly|so|oh|um|hm+|ha),?\s+/i, "");
      const leadSays = NO.test(lead) ? "no" : YES.test(lead) && !LACK.test(lead.split(/[.!?]/)[0] ?? lead) ? "yes" : null;
      const leadAbout = leadSays && answer.inverted ? (leadSays === "yes" ? "no" : "yes") : leadSays;
      if (leadAbout && said && leadAbout !== said) return reject(CODES.CONTRADICTION, "the yes/no contradicts the rest of the answer");
      if (!said) return reject(CODES.NONRESPONSIVE, `does not answer ${answer.predicate} (yes/no about the speaker)`);
      if (["yes", "no"].includes(answer.value) && said !== answer.value) return reject(CODES.CONTRADICTION, `answers ${said} where the speaker's ${answer.predicate} is ${answer.value}`);
      return { ok: true };
    }
    case "self_value": {
      const band = answer.answer?.band;
      if (band && TENURE_WORDS[band] && !TENURE_WORDS[band].test(s)) return reject(CODES.NONRESPONSIVE, `does not state the speaker's ${answer.predicate} (${band})`);
      return { ok: true };
    }
    case "place": return PLACE_WORDS.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "a destination question needs a place (or an honest not-established)");
    case "participants":
      // A yes to "are we splitting up?" asserts a split nobody established.
      if ((answer.asks_split || /\bsplit/i.test(String(answer.alternatives ?? ""))) && /^\s*(?:yes|yeah|yep|sure|we are|we will)\b/i.test(s)) return reject(CODES.CONTRADICTION, "affirms a split nobody established");
      return PARTICIPANT_WORDS.test(s) || /\b(?:yes|yeah|yep)\b/i.test(s) && /\b(?:all|every|together|us)\b/i.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "a who's-going question needs the participant set (or an honest not-established)");
    case "time": return TIME_WORDS.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "a timing question needs a time (or an honest not-established)");
    case "route": return ROUTE_WORDS.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "a how-do-we-get-there question needs the route form (or an honest not-established)");
    case "access": return /\b(?:yes|yeah|yep|no|nope|we(?:'re| are) (?:going|assigned|headed)|assigned to|go(?:ing)? in|allowed)\b/i.test(s) ? { ok: true } : reject(CODES.NONRESPONSIVE, "an access question needs whether we go in (or an honest not-established)");
    default: return { ok: true };
  }
}

/** All H1-H5 checks for one candidate. */
function validateClaims(speech, contribution, opts = {}) {
  const personal = validatePersonalClaims(speech, contribution, opts);
  if (!personal.ok) return personal;
  const precision = validatePrecision(speech, contribution);
  if (!precision.ok) return precision;
  const ceiling = validateEntityCeiling(speech, contribution, opts);
  if (!ceiling.ok) return ceiling;
  return validateResponsiveness(speech, contribution, opts);
}

module.exports = { CLAIMS_VERSION, CODES, extractPropositions, claimClauses, familiesOf, licenseOf, validatePersonalClaims, validatePrecision, validateEntityCeiling, validateResponsiveness, validateClaims, polarityOf, LACK };
