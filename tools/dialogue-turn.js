"use strict";

// Stages E-I of the LOCAL turn pipeline (ED-30): completeness gate, reconciliation, resolution of
// addressees / deixis / temporal scope / ellipsis antecedents, and the discourse relation of each act
// (new, continuation, repair, return, attention, answer).
//
//   parseActs (language)  +  DIS snapshot (canonical conversation state)  ->  EFFECTIVE ACTS
//
// An effective act is what the player's turn asks, in terms code can plan: the request text to frame, the
// registry predicate and facet, the canonical addressee set, the response cardinality, the temporal scope
// and arguments, and -- for repairs, ellipsis, attention calls and activity turns -- the prior request it
// operates on. Language is never world: this module resolves words against the supplied present people,
// canonical entities and the ledger, and it fails closed (clarify) instead of guessing.

const registry = require("./dialogue-registry");
const acts = require("./dialogue-acts");
const canonicalKnowledge = require("./canonical-knowledge");
const dialogueState = require("./dialogue-state");
const { normalizeUtterance } = require("./dialogue-normalize");

const TURN_VERSION = "yellow-beast-dialogue-turn@v1";
const SOCIAL = new Set(["social_acknowledgment", "thanks"]);
// Predicates whose "you" is each addressee's own (self) answer.
const SELF_CARDINALITY = new Set(["each_self", "each_self_concise"]);
// Place words that point at the Complex when nothing else is salient ("Have you been inside?").
const INSIDE_DEIXIS = /\b(?:inside|in there|down there|go in|going in|been in|through|across)\b/i;
const THERE_DEIXIS = /\b(?:there|that place)\b/i;

/** Present people as the language layer needs them: { id, name, names }. */
function peopleIndex(members = []) {
  return members.map((m) => ({ id: m.id, name: m.name, names: [...new Set([m.name, ...(m.names ?? [])].filter(Boolean))] }));
}

function placeOf(text, entities, dis, { apposition = null } = {}) {
  const source = [apposition, text].filter(Boolean).join(" ");
  const named = canonicalKnowledge.resolveEntityMentions(source, entities).find((e) => ["entity", "location"].includes(e.kind) && ["complex", "outpost-a", "threshold", "equipment-staging", "async-briefing-room", "threshold-room", "standard"].includes(e.id));
  if (named) return { place_id: named.id, basis: apposition ? "apposition" : "named" };
  if (THERE_DEIXIS.test(text) || INSIDE_DEIXIS.test(text)) {
    const salient = dis?.salient_place ?? null;
    if (salient) return { place_id: salient, basis: "salient_topic" };
    // "Going in" / "inside" at this table is the Complex; anything said as "there" ("in there", "down
    // there") needs an active place (owner decision 2026-09-27).
    if (INSIDE_DEIXIS.test(text) && !THERE_DEIXIS.test(text)) return { place_id: "complex", basis: "domain_default_inside" };
    return { place_id: null, basis: "unresolved_deixis" };
  }
  return null;
}

// Positive evidence that a line STATES something (ED-30I): a finite verb or a first-person claim.
const { STATEMENT_EVIDENCE } = acts;

// Replies to a coworker's question (ED-30H).
const REPLY_UNCERTAIN = /^(?:(?:um+|uh+|hm+|honestly|well|so)[,.]?\s+)*(?:i\s+)?(?:do not know|don't know|dont know|dunno|no idea|not sure|idk|beats me|no clue|couldn'?t (?:tell you|say)|can'?t (?:say|remember)|hard to say|who knows)\b/;
const REPLY_REFUSAL = /\b(?:rather not|would rather not|'d rather not|not telling|none of your business|not saying|don'?t want to (?:say|talk|get into)|pass on that|skip that|no comment|not gonna say|mind your own)\b|^pass\b/;
const REPLY_COUNTER_WHY = /^(?:(?:and|but|so|wait)[,.]?\s+)*why(?:\s+(?:do you|you|would you|are you))?(?:\s+(?:ask|asking|want to know|wanna know|need to know))?\s*[?!.]*$/;
const REPLY_SELF_REPAIR = /^(?:(?:wait|sorry|actually|oh|no)[,.]?\s+)*(?:i mean|i meant|correction|scratch that|no wait|let me rephrase)\b/;

// ─── item question roles (ED-30H) ─────────────────────────────────────────────────────────────────────────
// About a THING, the clause's structure decides what is asked -- not which words happen to be in it:
//   what + copula + noun            -> definition   ("what is the layout record")
//   what + noun + for / used for    -> purpose      ("what's the layout record for")
//   what + do/does + noun + do      -> purpose      ("what does the spectrometer do")
//   why + carrying/bringing/needing -> purpose      ("why are we bringing the radio")
//   who + has/got/carries, whose    -> holder
//   where + is (now)                -> location
//   where + come from / from        -> provenance
//   what's in / inside              -> contents
//   where + going / headed          -> destination
// Order matters: the more specific relation is tested first.
const LEAD = "^(?:(?:so|and|but|ok|okay|wait|um+|uh+|hey|well|like|yo|oh)[,.]?\\s+)*";
const ITEM_ROLES = [
  ["item.provenance", new RegExp(`\\bwhere (?:did|does|do|'d)\\b[\\s\\S]*\\bcome from\\b|\\bwhere(?:'s| is| was| are| were)\\b[\\s\\S]*\\bfrom\\s*[?.!]*$|\\bwho (?:gave|brought|sent|packed|issued|supplied|made)\\b|\\bwhere (?:did|do) (?:we|you|they) get\\b`, "i")],
  ["item.destination", /\bwhere (?:is|are|'s|was) (?:it|that|this|those|these|the [\w -]+?) (?:going|headed|heading|being taken|off to)\b|\bwhere (?:is|are) (?:it|that|this|the [\w -]+?) supposed to go\b/i],
  ["item.purpose", /\b(?:for|used for|good for|needed for|meant for)\s*[?.!]*$|\bwhat(?:'s| is) the (?:point|purpose) of\b|\bwhat (?:do|does|did|will|would|can) (?:it|that|this|those|these|the [\w -]+?) (?:even |actually |really )?do\b|\bwhy (?:are|do|did|should|would|must|is|have) (?:we|you|i|they|someone|anyone|he|she) (?:\w+ )?(?:bring|bringing|carry|carrying|take|taking|need|needing|have|having|haul|hauling|lug|lugging|pack|packing|got)\b|\bhow (?:do|does|would|will) (?:we|you|i) use\b|\bwhat (?:do|does|would) (?:we|you) (?:use|need) (?:it|that|this|the [\w -]+?) for\b/i],
  ["item.contents", /\bwhat(?:'s| is| are|s)? (?:in|inside|packed in|in there)\b|\bwhat does [\s\S]* (?:contain|hold|have in it)\b|\bwhat(?:'s| is| got) packed\b/i],
  ["item.holder", /\bwho(?:'s| is| has|'s got| got| took| grabbed| carries| carrying| holds| holding| has got)\b|\bwhose\b|\bwhich (?:one of )?(?:you|u|y'?all)\b[\s\S]*\b(?:has|got|carry|carrying|holding)\b/i],
  ["item.location", new RegExp(`${LEAD}where(?:'s| is| are| did (?:\\w+ )?(?:put|leave|stash)| can i find| would i find|s)\\b`, "i")],
  ["item.definition", new RegExp(`${LEAD}what(?:'s| is| are| exactly is|s)\\s+(?:a |an |the |that |this |these |those |our |your )?[\\w -]+?\\s*[?.!]*$|${LEAD}what kind of\\b`, "i")]
];

/**
 * A short reply read against the answer SHAPE of a coworker's pending question to the player (ED-30I). Returns
 * null when the reply is not an answer form (a question, a clause with its own verb, a long line); otherwise
 * { shape, kind: answer | uncertainty | refusal, option, compatible }. The option is a semantic id: a canonical
 * item or person id, or one of yes / no / none / both / either for choice and yes/no questions. An answer the
 * question could not take (an item to "who...?", something not offered in an either/or) is incompatible and is
 * clarified, never guessed. The player's answer is their reply, not world truth.
 */
/** The reply is only a person's name (the vocative IS the answer, not an address). */
function personOfAnswer(act, people) {
  const t = String(act.text ?? "").toLowerCase().replace(/[.!,?]+/g, " ").replace(/\b(?:i guess|i think|probably|maybe|prolly)\b/g, " ").trim();
  return people.some((p) => (p.names ?? [p.name]).some((n) => String(n).toLowerCase() === t));
}

function inboundAnswer(act, inbound, { people = [], entities = [] } = {}) {
  if (!inbound || inbound.kind === "attention" || !inbound.answer_shape) return null;
  const raw = String((personOfAnswer(act, people) ? act.text : null) || act.body_semantic || act.body_expanded || act.body || act.text || "").toLowerCase();
  // A question back ("why?", "you?", "how come") is a counter-question, not an answer.
  if (/\?\s*$/.test(String(act.text ?? "")) || /^(?:(?:and|but|so|ok|okay)\s+)?(?:why|how come|what|who|where|when|which|how)\b/.test(raw.trim())) return null;
  const t = raw.replace(/[.!,]+/g, " ").replace(/\b(?:i guess|i think|i suppose|probably|maybe|prolly|i'd say|id say|for sure|definitely|please|thanks|then)\b/g, " ").replace(/\s+/g, " ").trim();
  const shape = inbound.answer_shape;
  if (REPLY_UNCERTAIN.test(t) || /^(?:not sure|unsure|no idea|idk)$/.test(t)) return { shape, kind: "uncertainty", option: null, compatible: true };
  if (REPLY_REFUSAL.test(t)) return { shape, kind: "refusal", option: null, compatible: true };
  if (!t || t.split(" ").length > 4 || acts.STATEMENT_EVIDENCE.test(t)) return null;
  const equipment = Object.fromEntries(entities.filter((x) => x.kind === "equipment").map((x) => [x.id, { id: x.id, label: x.label ?? x.names?.[0] ?? x.id, type: x.names?.find((n) => /-/.test(n)) ?? null }]));
  const itemOf = (text) => require("./dialogue-discourse").resolveEquipmentReferent(text, equipment)?.item?.id ?? null;
  const personOf = (text) => { const hit = people.filter((p) => (p.names ?? [p.name]).some((n) => new RegExp(`\\b${String(n).toLowerCase()}\\b`).test(text))); return hit.length === 1 ? hit[0].id : null; };
  const selfOf = (text) => /^(?:me|myself|i do|i will|i am|me i guess)$/.test(text) ? "player" : null;
  const item = itemOf(t); const person = personOf(t) ?? selfOf(t);
  const yesNo = /^(?:yes|yeah|yep|yup|yea|sure|of course|definitely|kind of|kinda|sort of|a bit|a little|once|twice)\b/.test(t) ? "yes" : /^(?:no|nope|nah|naw|not really|never)\b/.test(t) ? "no" : null;
  if (shape === "choice") {
    // Offered options are canonical ids (from a plan) or, offline, words resolved to ids where possible.
    const byId = (o) => (entities.some((x) => x.id === o) || people.some((p) => p.id === o) ? o : null);
    const labelOf = (id) => String(entities.find((x) => x.id === id)?.label ?? entities.find((x) => x.id === id)?.names?.[0] ?? people.find((p) => p.id === id)?.name ?? id).toLowerCase();
    const options = (inbound.options ?? []).map((o) => (byId(o) ? { text: labelOf(o), id: o } : { text: String(o).toLowerCase(), id: itemOf(String(o)) ?? personOf(String(o).toLowerCase()) ?? `option:${String(o).toLowerCase()}` }));
    if (/^(?:neither|none|neither one|neither of them|none of them)$/.test(t)) return { shape, kind: "answer", option: "none", compatible: true };
    if (/^(?:both|both of them|both please)$/.test(t)) return { shape, kind: "answer", option: "both", compatible: true };
    if (/^(?:either|either one|whichever|either is fine|don't care|dont care|doesn't matter|doesnt matter)$/.test(t)) return { shape, kind: "answer", option: "either", compatible: true };
    const ordinal = /\b(?:first|former)\b/.test(t) ? 0 : /\b(?:second|latter|last)\b/.test(t) && options.length === 2 ? 1 : null;
    if (ordinal != null && options[ordinal]) return { shape, kind: "answer", option: options[ordinal].id, compatible: true };
    const hits = options.filter((o) => (item && o.id === item) || (person && o.id === person) || new RegExp(`(?:^|\\s)${o.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(t));
    if (hits.length === 1) return { shape, kind: "answer", option: hits[0].id, compatible: true };
    return { shape, kind: "answer", option: null, compatible: false, reason: hits.length > 1 ? "answer_ambiguous_option" : "answer_not_offered" };
  }
  if (shape === "person") {
    if (person) return { shape, kind: "answer", option: person, compatible: true };
    if (item) return { shape, kind: "answer", option: null, compatible: false, reason: "answer_shape_mismatch" };
    return { shape, kind: "answer", option: null, compatible: true };
  }
  if (shape === "item") {
    if (item) return { shape, kind: "answer", option: item, compatible: true };
    if (person && !selfOf(t)) return { shape, kind: "answer", option: null, compatible: false, reason: "answer_shape_mismatch" };
    return { shape, kind: "answer", option: null, compatible: true };
  }
  if (shape === "yes_no") {
    // A bare name to a yes/no question is not an answer form (it addresses someone).
    if (personOf(t) && t.split(" ").length === 1) return null;
    return { shape, kind: "answer", option: yesNo, compatible: true };
  }
  if (shape === "place" || shape === "time") {
    if (person && t.split(" ").length === 1) return null;
    return { shape, kind: "answer", option: null, compatible: true };
  }
  return { shape, kind: "answer", option: yesNo, compatible: true };
}

/** The item a clause is about (named, or "it/that" with exactly one item in play) and what is asked of it. */
function itemRole(text, entities = [], dis = null) {
  // Hedges carry no relation ("what's ACTUALLY in it") -- the same stripping facet detection applies.
  const t = registry.stripHedges(String(text ?? "").toLowerCase());
  const named = canonicalKnowledge.resolveEntityMentions(t, entities).filter((m) => m.kind === "equipment");
  const uniqueNamed = [...new Map(named.map((m) => [m.id, m])).values()];
  let item = uniqueNamed.length === 1 ? uniqueNamed[0] : null;
  // The one canonical item resolver (label sub-phrases, unique only): "the layout record" names the
  // "Manifestation layout record" even where the knowledge index maps the phrase to its task.
  if (!item && !uniqueNamed.length) {
    const equipment = Object.fromEntries(entities.filter((x) => x.kind === "equipment").map((x) => [x.id, { id: x.id, label: x.label ?? x.names?.[0] ?? x.id, type: x.names?.find((n) => /-/.test(n)) ?? null }]));
    const found = require("./dialogue-discourse").resolveEquipmentReferent?.(t, equipment);
    if (found?.status === "unique") {
      // The phrase actually used: the longest tail of the label present in the line ("layout record").
      const words = String(found.item.label).toLowerCase().split(/\s+/);
      const used = [...Array(words.length).keys()].map((k) => words.slice(k).join(" ")).find((suffix) => t.includes(suffix)) ?? words.at(-1);
      item = { id: found.item.id, kind: "equipment", matched: used };
    }
  }
  if (!item && !uniqueNamed.length && /\b(?:it|that|this|those|these|them)\b/.test(t)) {
    const salient = (dis?.salient_entities ?? []).filter((id) => entities.some((x) => x.id === id && x.kind === "equipment"));
    if (salient.length === 1) item = { id: salient[0], kind: "equipment", anaphoric: true };
  }
  if (!item) return null;
  let role = ITEM_ROLES.find(([, re]) => re.test(t))?.[0] ?? null;
  // "What is X" asks what X IS only when the item phrase itself ends the clause ("what's the deal with the
  // camera" is not a definition question).
  if (role === "item.definition") {
    const phrase = String(item.matched ?? "").toLowerCase();
    const stripped = t.replace(/[?.!\s]+$/, "");
    if (!item.anaphoric && phrase && !new RegExp(`^(?:(?:a|an|the|that|this|these|those|our|your|my)\\s+)?(?:[a-z0-9-]+\\s+){0,2}?${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(stripped.replace(/^.*?\bwhat(?:'s| is| are| exactly is|s)\s+/, ""))) role = null;
  }
  return role ? { predicate: role, item_id: item.id, anaphoric: Boolean(item.anaphoric) } : null;
}

// ─── echo follow-ups (surface anchors) ────────────────────────────────────────────────────────────────
// "Sealed how?" / "Terrified of what?" / "harder how" / "the Bermuda branch?": a short line that repeats a
// word or phrase the last reply actually used. The spoken words only LOCATE the reply's anchored request
// (dialogue-state surface anchors); the answer comes from that request's canonical resolver, never from the
// words. Several speakers matching is ambiguous: no echo.
// A trailing tag ("..., huh", "..., right") checks the echoed words back like a "?" would.
const ECHO_TAIL = /\s*\b(?:how|what|why|where|when|who|exactly|so|of what|about what|for what|with what|like what|in what way|how so|how come|meaning|huh|right|yeah|eh)\s*$/i;
const ECHO_LEAD = /^(?:(?:wait|so|and|but|oh|huh|hm+|really|seriously|sorry)[,.!]?\s+)+/i;
function echoOf(act, dis, { phraseOnly = false } = {}) {
  const anchors = dis?.surface_anchors ?? [];
  if (!anchors.length || act.vocatives?.length || act.mentions?.length) return null;
  const body = String(act.body_expanded ?? act.body ?? act.text ?? "").trim();
  const words = body.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  const core = body.toLowerCase().replace(/[?!.,;:"]+/g, " ").replace(/\s+/g, " ").trim().replace(ECHO_LEAD, "").replace(ECHO_TAIL, "").trim();
  if (!core) return null;
  const tokens = dialogueState.echoTokens(core);
  // Person-shift neutral: the player says back "you" what the speaker said as "me" ("nobody's told you?").
  const persons = (t) => t.replace(/\b(?:you|me|i|your|my|yours|mine|yourself|myself)\b/g, "P");
  const phrase = persons(core.replace(/^(?:the|a|an)\s+/, ""));
  const hits = [];
  for (const anchor of anchors) for (const span of anchor.spans) {
    // Compared in the same expanded form as the player's line ("we've" = "we have").
    const spanText = persons(normalizeUtterance(span.text).expanded.toLowerCase().replace(/[?!.,;:"]+/g, " ").replace(/\s+/g, " "));
    const phraseHit = phrase.split(" ").length >= 2 && ` ${spanText} `.includes(` ${phrase} `);
    const tokenHit = !phraseOnly && tokens.length && tokens.some((t) => span.tokens.includes(t));
    if (phraseHit || tokenHit) hits.push({ anchor, span, matched: phraseHit ? core.replace(/^(?:the|a|an)\s+/, "") : tokens.find((t) => span.tokens.includes(t)) });
  }
  const speakers = new Set(hits.map((h) => h.anchor.speaker_id));
  if (speakers.size !== 1) return null;
  const hit = hits.at(-1);
  return { speaker_id: hit.anchor.speaker_id, event_id: hit.anchor.event_id, span: hit.span, matched: hit.matched };
}

// A follow-up picks up the last reply: an anaphor ("What's in it?", "Is that far?", "Who gave them that?"),
// a fragment that only questions the reply ("Since when?", "How far?", "Which one?"), or a thing that reply
// named. Dummy "it" ("What time is it?", "Is it just me?") and a complementizer "that" ("Did Maxwell say
// that we...") are not anaphors.
const FOLLOW_UP_ANAPHOR = /\b(?:it|its|those|them)\b|\bthat\b(?!\s+(?:we|you|i|he|she|they|it|there)\b)/i;
const DUMMY_IT = /\b(?:what time is it|is it just (?:me|us)|it'?s (?:time|going to be|gonna be|my|our|a)\b|is it (?:ok(?:ay)?|fine|alright|all right) (?:if|to)|it seems|it looks like|make it)\b/gi;
const FOLLOW_UP_FRAGMENT = /^(?:(?:and|so|but|okay|ok|wait|huh|oh|hm+)[,.!]?\s+)?(?:since when|how come|what for|like what|such as|how so|which one|how long|how far|how many|how much|who else|where exactly|when exactly|why not|in what way|for what|from where|with who(?:m)?|how do you know that)\b/i;
function isFollowUp(act, dis) {
  if (!["question", "request"].includes(act.speech_act)) return false;
  const text = String(act.body_expanded ?? act.body ?? "").replace(DUMMY_IT, " ");
  const answeredBySpeaker = (dis?.last_request?.answered_by ?? []).includes(dis?.active_speaker?.speaker_id);
  const names = dis?.salient_names ?? [];
  const namesReply = names.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  if (namesReply) return true;
  if (!answeredBySpeaker) return false;
  return FOLLOW_UP_FRAGMENT.test(text.trim()) || FOLLOW_UP_ANAPHOR.test(text);
}

/**
 * Resolves who a (non-repair) act addresses: explicit vocatives, quantifiers, "we all", an inherited
 * second person (the active speaker) or nobody in particular. Never a name merely mentioned.
 */
function resolveAddressee(act, { present = [], dis = null, explicit_target_id = null } = {}) {
  const presentIds = present.map((p) => p.id);
  const vocIds = act.vocatives.map((v) => v.id).filter((id) => id && presentIds.includes(id));
  if (explicit_target_id && presentIds.includes(explicit_target_id)) return { kind: "explicit", ids: [explicit_target_id], quantifier: null, source: "chip" };
  const q = act.quantifier;
  if (vocIds.length) {
    if (q?.kind === "two" && vocIds.length !== 2) return { kind: "subset", ids: vocIds, quantifier: q.kind, source: "vocative", mismatch: true };
    return { kind: vocIds.length > 1 ? "subset" : "explicit", ids: vocIds, quantifier: q?.kind ?? null, source: "vocative" };
  }
  if (act.vocatives.length && !vocIds.length) return { kind: "explicit", ids: [], quantifier: null, source: "vocative_not_present", absent: act.vocatives.map((v) => v.name) };
  const answered = dis?.last_request?.answered_by ?? [];
  if (q) {
    if (q.kind === "except") {
      const excluded = present.find((p) => p.names.some((n) => n.toLowerCase() === String(q.name).toLowerCase()))?.id ?? null;
      return { kind: "subset", ids: presentIds.filter((id) => id !== excluded), quantifier: "except", source: "quantifier" };
    }
    if (q.kind === "just") {
      const only = present.find((p) => p.names.some((n) => n.toLowerCase() === String(q.name).toLowerCase()))?.id ?? null;
      if (only) return { kind: "explicit", ids: [only], quantifier: "just", source: "quantifier" };
      return { kind: "untargeted", ids: [], quantifier: null, source: "none" }; // "just now", "just me"
    }
    if (q.kind === "rest") {
      const others = presentIds.filter((id) => !answered.includes(id) && id !== dis?.active_speaker?.speaker_id);
      return others.length ? { kind: "subset", ids: others, quantifier: "rest", source: "quantifier" } : { kind: "group", ids: presentIds, quantifier: "rest", source: "quantifier", mismatch: true };
    }
    if (q.kind === "two") {
      if (presentIds.length === 2) return { kind: "group", ids: presentIds, quantifier: "two", source: "quantifier" };
      const others = presentIds.filter((id) => !answered.includes(id) && id !== dis?.active_speaker?.speaker_id);
      if (others.length === 2) return { kind: "subset", ids: others, quantifier: "two", source: "quantifier_context" };
      return { kind: "subset", ids: [], quantifier: "two", source: "quantifier", mismatch: true };
    }
    if (q.kind === "three" && presentIds.length !== 3) return { kind: "group", ids: presentIds, quantifier: "three", source: "quantifier", mismatch: presentIds.length !== 3 };
    return { kind: "group", ids: presentIds, quantifier: q.kind, source: "quantifier" };
  }
  if (act.we_all) return { kind: "group", ids: presentIds, quantifier: "we_all", source: "collective" };
  // A second-person line that continues the conversation ("So you've been there before?") is for the one
  // who just spoke to the player.
  const secondPerson = /\b(?:you|your|yourself)\b/i.test(act.body_expanded.replace(/(?<!\b(?:do|did|does|would|how do|how did)\s)\byou know\b|\b(?:thank you|if you ask me|you never know)\b/g, " "));
  const speaker = dis?.active_speaker?.speaker_id ?? null;
  // A collective "we" question about who goes where is put to the table.
  if (/^(?:(?:do|will|should|are|can|shall|would) we|we)\b/i.test(act.body_expanded) && (act.predicate_candidates ?? []).some((c) => /participants/.test(c.id))) return { kind: "group", ids: presentIds, quantifier: "we", source: "collective" };
  if (secondPerson && speaker && presentIds.includes(speaker)) return { kind: "inherited", ids: [speaker], quantifier: null, source: "active_speaker" };
  // Follow-ups that only make sense against the last reply ("Why?", "Huh?", "Excited?", "What is there?")
  // stay with the one who gave it.
  const subjectless = !secondPerson && !act.mentions.length && !/\b(?:we|us|i|me|my|he|she|they|him|her|them)\b/i.test(act.body_expanded);
  const personFragment = subjectless && (act.predicate_candidates ?? []).some((c) => /^person\./.test(c.id)) && act.body_expanded.split(/\s+/).length <= 4;
  const deixisToSpeaker = /\bthere\b/i.test(act.body_expanded) && dis?.salient_place;
  if (speaker && presentIds.includes(speaker) && (act.bare_wh || act.reflex || personFragment || deixisToSpeaker)) return { kind: "inherited", ids: [speaker], quantifier: null, source: "active_speaker" };
  // Owner decision (2026-09-27): a genuine semantic follow-up inherits its responder from the immediately
  // relevant exchange -- it picks up what that one speaker just said (an anaphor, or a thing their reply
  // named) -- and is never rotated for fairness. A fresh shared question stays untargeted (rotation).
  if (!secondPerson && speaker && presentIds.includes(speaker) && (dis?.active_speaker?.speaker_ids?.length ?? 1) <= 1 && isFollowUp(act, dis)) return { kind: "inherited", ids: [speaker], quantifier: null, source: "antecedent_owner" };
  if (secondPerson && (dis?.active_speaker?.speaker_ids?.length ?? 0) > 1) return { kind: "inherited", ids: [], quantifier: null, source: "active_speakers_several", ambiguous: dis.active_speaker.speaker_ids.filter((id) => presentIds.includes(id)) };
  return { kind: "untargeted", ids: [], quantifier: null, source: "none", second_person: secondPerson };
}

// The plain question a person predicate asks, for ellipsis over a claim ("have you?").
const CANONICAL_QUESTION = Object.freeze({
  "person.complex_experience": "Have you been in the Complex before?",
  "person.expedition_experience": "Have you been on an expedition before?",
  "person.first_day_at_async": "Is it your first day?",
  "person.async_tenure": "How long have you been with ASYNC?",
  "person.nervousness": "Are you nervous?",
  "person.fatigue": "Are you tired?",
  "person.anticipation": "Are you excited?",
  "person.wellbeing": "How are you?",
  "person.familiarity": "Do you know each other?"
});

// A question ABOUT the conversation itself (what a reply meant, why, say again, what someone said): by registry
// facet, or -- for a legacy-routed request with no facet -- by its discourse function.
const META_FNS = new Set(["clarify_previous", "ask_meaning", "ask_explanation", "request_repetition", "ask_heard_confirmation", "ask_response_event", "challenge"]);
const isMetaRequest = (r) => String(r?.predicate ?? "").startsWith("conversation.") || (!r?.predicate && META_FNS.has(r?.fn));

/** The request an elliptical line inherits: the active activity's template, else the most recent request. */
function antecedentOf(act, dis) {
  if (["turn", "same_question"].includes(act.ellipsis?.kind) && dis?.activity) return { from: "activity", request: { predicate: dis.activity.template.predicate, fn: dis.activity.template.fn, request_text: dis.activity.template.request_text, targets: [...dis.activity.completed], answered_by: [...dis.activity.completed], request_id: null, args: null }, activity: dis.activity };
  // "Tonya, have you?" right after the player's own claim about her: the claim's question, asked of her.
  if (act.ellipsis?.aux && dis?.last_player_claim?.predicate && CANONICAL_QUESTION[dis.last_player_claim.predicate]) return { from: "player_claim", request: { predicate: dis.last_player_claim.predicate, fn: null, request_text: CANONICAL_QUESTION[dis.last_player_claim.predicate], targets: [], answered_by: [], request_id: null, args: null, temporal: registry.get(dis.last_player_claim.predicate)?.default_temporal ?? null } };
  // A meta question ("Why?", "What do you mean?") is about one reply; "What about Tonya?" after it carries the
  // substantive question before it.
  if (dis?.last_request?.request_text && isMetaRequest(dis.last_request) && dis?.last_substantive_request?.request_text && ["how_about", "turn", "same_question"].includes(act.ellipsis?.kind)) return { from: "last_substantive_request", request: dis.last_substantive_request };
  if (dis?.last_request?.request_text) return { from: "last_request", request: dis.last_request };
  if (dis?.activity) return { from: "activity", request: { predicate: dis.activity.template.predicate, fn: dis.activity.template.fn, request_text: dis.activity.template.request_text, targets: [...dis.activity.completed], answered_by: [...dis.activity.completed], request_id: null, args: null }, activity: dis.activity };
  return null;
}

function cardinalityFor(predicate, addressee, act) {
  const entry = predicate ? registry.get(predicate) : null;
  let card = entry?.default_cardinality ?? null;
  if (!card) {
    if (["greeting", "self_introduction", "farewell"].includes(act.speech_act)) return addressee.kind === "explicit" || addressee.kind === "inherited" ? "each_ack" : "each_ack";
    // Owner decision (2026-09-27): a remark or sarcasm asks nothing and requires no response; silence is a
    // normal outcome (the deterministic social policy may still pick one short acknowledgment).
    // An answer to a coworker's question requires no response of its own either (an acknowledgment may come).
    if (SOCIAL.has(act.speech_act) || ["statement", "sarcasm"].includes(act.speech_act) || (act.speech_act === "answer" && act.args?.inbound_kind !== "clarification")) return "none";
    return "one_spokesperson";
  }
  if (card === "one_spokesperson" && addressee.quantifier === "any") card = "one_knower";
  if (card === "one_knower" && addressee.kind === "explicit") card = "one_spokesperson";
  return card;
}

// The act a turn is mainly about: the last question/request/repair/continuation/attention call, else the
// last greeting/introduction, else the last statement.
const RANK = Object.freeze({ question: 3, request: 3, repair: 3, elliptical_continuation: 3, attention_call: 3, self_introduction: 2, greeting: 2, farewell: 2, sarcasm: 1, statement: 1, social_acknowledgment: 0, thanks: 0 });
function primaryOf(effective) {
  let best = null;
  for (const e of effective) if (!best || (RANK[e.speech_act] ?? 1) >= (RANK[best.speech_act] ?? 1)) best = e;
  return best;
}

/**
 * Analyze one player line against the conversation state. Returns the effective acts (primary first),
 * the completeness verdict, and a trace. Pure.
 *
 * @param {object} input
 *   raw               the player's line (never modified)
 *   present           [{ id, name, names }] coworkers who can hear the line
 *   entities          canonical entity index (reference needs no presence)
 *   dis               dialogue-state snapshot (+ salient_place)
 *   explicit_target_id UI-selected recipient, if any
 */
function analyzeTurn({ raw, present = [], entities = [], dis = null, explicit_target_id = null, vocabulary = [] } = {}) {
  const people = peopleIndex(present);
  // Repair targets: people's names and distinctive canonical place/entity names (6+ letters). Every canonical
  // word (item nouns included) is protected from being "repaired" into something else.
  const words = (kinds) => entities.filter((e) => kinds.includes(e.kind)).flatMap((e) => e.names ?? []).flatMap((n) => String(n).split(/\s+/));
  const entityVocab = words(["entity", "location", "person", "institution", "equipment"]).filter((n) => /^[a-z]{6,}$/.test(n));
  const protect = words(["entity", "location", "person", "institution", "equipment", "procedure", "task"]).filter((n) => /^[a-z]{3,}$/.test(n));
  const parsed = acts.parseActs(raw, { people, vocabulary: [...new Set([...vocabulary, ...entityVocab])], protect });
  const substantive = parsed.acts.filter((a) => !SOCIAL.has(a.speech_act));
  const closes = parsed.acts.some((a) => a.closes_activity);
  const effective = [];
  const missing = [];
  const presentIds = people.map((p) => p.id);
  let turnPlace = null;

  for (const original of (substantive.length ? substantive : parsed.acts.slice(0, 1))) {
    // "I mean for the day" names no canonical thing: it is the legacy self-repair fragment of the last
    // question, not a referent repair (the legacy frame narrows the question with it).
    // ("The other bag" is a real correction whose thing is ambiguous: it stays a repair and is clarified.)
    const unresolvedReferent = original.speech_act === "repair" && original.repair?.kind === "referent" && !/^(?:the|that)\s+other\b/i.test(original.repair.referent ?? "") && !placeOf(original.repair.referent ?? "", entities, null)?.place_id && !canonicalKnowledge.resolveEntityMentions(original.repair.referent ?? "", entities).length;
    let act = unresolvedReferent ? { ...original, speech_act: "statement", repair: null, body: original.body || original.text } : original;
    // A short reply to a coworker's question is read against that question's answer shape first ("not sure",
    // "the first one", "Tonya", "flashlight"): an answer, not a repair, a vocative or a topic ellipsis.
    const pendingInbound = dis?.pending_inbound_request ?? null;
    const shaped = substantive.length <= 1 && pendingInbound && presentIds.includes(pendingInbound.from) && !(act.vocatives ?? []).some((v) => v.id !== pendingInbound.from && !personOfAnswer(act, people)) ? inboundAnswer(act, pendingInbound, { people, entities }) : null;
    // Only a reply the shape actually decides is re-read (an offered option, a name or item the question takes,
    // "not sure", a refusal, or a fragment the question cannot take); anything else keeps its own reading.
    if (shaped && (shaped.option || shaped.kind !== "answer" || (!shaped.compatible && ["statement", "social_acknowledgment"].includes(act.speech_act)))) act = { ...act, speech_act: "statement", repair: null, ellipsis: null, vocatives: [], question_form: null, inbound_answer: shaped, body: act.body || act.text };
    // A repair-lead marker ("I mean ...", "No, ...") stays in the text the legacy frame reads: it is the
    // self-repair cue of the previous question.
    // The text the legacy frame reads: chat noise removed when the normalization record says so (raw kept on the act).
    const bodyText = act.normalization?.removed?.length && act.body_semantic ? act.body_semantic : (act.body || act.text);
    const e = { act, speech_act: act.speech_act, question_form: act.question_form, relation: "new", relation_target: null, request_text: act.marker_relation === "repair" && act.speech_act === "statement" ? act.text : bodyText, predicate: null, facet_source: null, addressee: null, cardinality: null, temporal_scope: null, polarity: act.polarity, alternatives: act.alternatives, args: {}, reissue_of: null, repair: null, clarify: null, overrides: [] };
    const top = act.predicate_candidates[0] ?? null;
    // "Is this your first time going in?" asks the predicate inverted: a yes means NO experience. Carried in the
    // args so a repair or ellipsis re-asking the same question keeps it (review F2).
    // A continuation marker ("So", "And") continues only an exchange that exists; opening the conversation it
    // is just a lead-in.
    if (act.marker_relation === "continuation" && (dis?.last_request || dis?.active_speaker || dis?.activity)) e.relation = "continuation";
    if (act.marker_relation === "topic_return") e.relation = "topic_return";

    if (act.speech_act === "repair") {
      e.relation = "repair";
      const last = dis?.last_request ?? null;
      const pending = dis?.pending_requests?.at(-1) ?? null;
      if (act.repair.kind === "target_group") {
        // "I meant all of you" / "that was for the whole table": the same question, asked of everyone present.
        e.repair = { kind: "target" };
        if (!last) { e.clarify = { reason: "repair_no_target", slot: "topic" }; missing.push("repair_no_target"); }
        else {
          e.addressee = { kind: "group", ids: [...presentIds], quantifier: "all", source: "repair" };
          e.relation_target = last.request_id; e.reissue_of = last.request_id; e.request_text = last.request_text; e.predicate = last.predicate; e.fn_hint = last.fn;
          e.args = last.args ? { ...last.args } : {}; e.temporal_scope = last.temporal; e.question_form = null; e.reissued_form = last.question_form;
        }
      } else if (act.repair.kind === "target" || act.repair.kind === "exclude" || act.repair.kind === "other_one") {
        e.repair = { kind: "target" };
        if (!last) { e.clarify = { reason: "repair_no_target", slot: "topic" }; missing.push("repair_no_target"); }
        else {
          const named = act.repair.name ? people.find((p) => p.names.some((n) => n.toLowerCase() === act.repair.name.toLowerCase())) : null;
          // "Not you, Tonya.": the name spoken with the exclusion is the intended target.
          let target = named?.id ?? (act.repair.kind === "exclude" ? act.vocatives.map((v) => v.id).find((id) => id && presentIds.includes(id)) ?? null : null);
          if (!target && act.repair.kind === "exclude") {
            const excluded = /^you$/i.test(act.repair.exclude ?? "") ? (dis?.active_speaker?.speaker_id ?? null) : people.find((p) => p.names.some((n) => n.toLowerCase() === String(act.repair.exclude).toLowerCase()))?.id ?? null;
            // The one the question was put to, when someone else answered it ("Malcolm, what's in the duffle?" ...
            // Giselle answers ... "I didn't ask you, Giselle").
            const askedOthers = (last.targets ?? []).filter((id) => id !== excluded && presentIds.includes(id));
            const pool = (askedOthers.length ? askedOthers : presentIds).filter((id) => id !== excluded && (askedOthers.length === 1 || !(last.answered_by ?? []).includes(id)));
            target = pool.length === 1 ? pool[0] : null;
          }
          if (!target && act.repair.kind === "other_one") {
            const pool = last.targets.length === 2 ? last.targets.filter((id) => !(last.answered_by ?? []).includes(id)) : [];
            target = pool.length === 1 ? pool[0] : null;
          }
          if (!target || !presentIds.includes(target)) { e.clarify = { reason: "repair_target_unresolved", slot: "person" }; missing.push("repair_target_unresolved"); e.addressee = { kind: "inherited", ids: (last.answered_by ?? []).filter((id) => presentIds.includes(id)).slice(0, 1), quantifier: null, source: "repair_asker" }; }
          else {
            const vacuous = last.targets.length === 1 && last.targets[0] === target && (last.answered_by ?? []).includes(target);
            e.addressee = { kind: "explicit", ids: [target], quantifier: null, source: "repair" };
            e.relation_target = last.request_id;
            if (vacuous) { e.repair.vacuous = true; e.speech_act = "social_acknowledgment"; e.request_text = null; e.predicate = null; }
            else { e.reissue_of = last.request_id; e.request_text = last.request_text; e.predicate = last.predicate; e.fn_hint = last.fn; e.args = last.args ? { ...last.args } : {}; e.temporal_scope = last.temporal; e.question_form = null; e.reissued_form = last.question_form; }
          }
        }
      } else if (act.repair.kind === "unanswered") {
        e.repair = { kind: "unanswered" };
        const embeddedPredicate = act.predicate_candidates[0]?.id ?? null;
        const target = (embeddedPredicate && [pending, last].find((r) => r && r.predicate === embeddedPredicate)) || pending || last;
        if (!target) {
          if (act.repair.embedded) { e.request_text = act.repair.embedded; e.predicate = embeddedPredicate; e.relation = "new"; }
          else { e.clarify = { reason: "repair_no_target", slot: "topic" }; missing.push("repair_no_target"); }
        } else {
          e.relation_target = target.request_id;
          e.reissue_of = target.request_id;
          // "I mean what does it do": a NEW wh-question the ledger's request does not match is its own question
          // -- its facet is not the old one's by default (Tier 2 reads it, or it is clarified). "I asked if we
          // were all going" re-issues the request as it was.
          const newWh = Boolean(act.repair.embedded) && !embeddedPredicate && /^(?:who|what|where|when|why|how|which|whose)\b/i.test(act.repair.embedded);
          e.predicate = newWh ? null : (embeddedPredicate ?? target.predicate);
          e.request_text = newWh || (embeddedPredicate && embeddedPredicate !== target.predicate) ? act.repair.embedded : target.request_text;
          e.fn_hint = newWh || (embeddedPredicate && embeddedPredicate !== target.predicate) ? null : target.fn;
          e.args = target.args ? { ...target.args } : {};
          e.temporal_scope = target.temporal;
          e.question_form = null; e.reissued_form = target.question_form;
          const targets = target.targets.filter((id) => presentIds.includes(id));
          // "That isn't really an answer": the one whose reply it was answers again.
          const replied = (target.answered_by ?? []).filter((id) => presentIds.includes(id));
          e.addressee = act.repair.not_an_answer && replied.length === 1 ? { kind: "inherited", ids: replied, quantifier: null, source: "repaired_request" }
            : targets.length ? { kind: targets.length > 1 ? "subset" : "explicit", ids: targets, quantifier: null, source: "repaired_request" } : { kind: "group", ids: presentIds, quantifier: null, source: "repaired_request" };
          e.reopen = true;
        }
      } else {
        // Facet / temporal / referent repair of the previous request: same target, same question, one part changed.
        e.repair = { kind: act.repair.kind };
        if (!last) { e.clarify = { reason: "repair_no_target", slot: "topic" }; missing.push("repair_no_target"); }
        else {
          e.relation_target = last.request_id;
          e.reissue_of = last.request_id;
          e.predicate = last.predicate;
          e.fn_hint = last.fn;
          e.request_text = last.request_text;
          e.args = last.args ? { ...last.args } : {};
          e.temporal_scope = last.temporal;
          e.question_form = null; e.reissued_form = last.question_form;
          const answered = (last.answered_by ?? []).filter((id) => presentIds.includes(id));
          const targets = last.targets.filter((id) => presentIds.includes(id));
          e.addressee = targets.length ? { kind: targets.length > 1 ? "subset" : "explicit", ids: targets, quantifier: null, source: "repaired_request" } : answered.length ? { kind: "inherited", ids: answered.slice(0, 1), quantifier: null, source: "repaired_request" } : { kind: "untargeted", ids: [], quantifier: null, source: "none" };
          if (act.repair.kind === "temporal") e.temporal_scope = /ever|before|general|at all/i.test(act.repair.want ?? "") ? "ever" : /today|now/i.test(act.repair.want ?? "") ? "today" : "earlier";
          if (act.repair.kind === "facet" && act.repair.want) {
            e.request_text = String(last.request_text).replace(new RegExp(`\\b${act.repair.not ?? "(?:why|where|when|who|how|what)"}\\b`, "i"), act.repair.want);
            const reparsed = registry.detectPredicates(acts.clauseAct({ text: e.request_text, start: 0, end: e.request_text.length }, { people }).body_expanded)[0] ?? null;
            e.predicate = reparsed?.id ?? null;
            e.fn_hint = null;
          }
          if (act.repair.kind === "referent") {
            const place = placeOf(act.repair.referent, entities, null);
            const entity = canonicalKnowledge.resolveEntityMentions(act.repair.referent, entities)[0] ?? null;
            const lastEntry = last.predicate ? registry.get(last.predicate) : null;
            if (place?.place_id && lastEntry?.domain === "person" && /experience|first_day|tenure/.test(last.predicate)) {
              // "Have you done this before?" -> "I meant the Complex.": the same person, asked about that place.
              e.predicate = "person.complex_experience"; e.fn_hint = null; e.args = { ...e.args, place_id: place.place_id }; e.temporal_scope = "ever";
              e.overrides.push({ field: "predicate", from: last.predicate, to: e.predicate, reason: "referent_repair_place" });
            } else if (entity && lastEntry?.domain === "item" && entity.kind !== "equipment") {
              // "Who has the camera?" -> "I meant the Complex.": the repaired referent cannot fill the question's
              // slot (a place is not held). Ask, never answer the old question again.
              e.clarify = { reason: "referent_repair_mismatch", slot: "topic" }; missing.push("referent_repair_mismatch");
            } else if (entity) {
              const before = canonicalKnowledge.resolveEntityMentions(last.request_text, entities).find((x) => x.kind === entity.kind) ?? null;
              // The original phrase keeps its own article ("the camera" -> "the lamp", never "the the lamp").
              const bare = String(act.repair.referent).replace(/^(?:the|that|this|my|your)\s+/i, "");
              e.request_text = before ? String(last.request_text).replace(new RegExp(before.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), bare) : `${String(last.request_text).replace(/[?.!\s]+$/, "")} -- ${act.repair.referent}?`;
              if (place?.place_id) e.args = { ...e.args, place_id: place.place_id };
              // The repaired thing replaces the old one in the structured frame too, not only in the words.
              if (entity.kind === "equipment" && e.args?.item_id) e.args = { ...e.args, item_id: entity.id };
            } else { e.clarify = { reason: "referent_repair_unresolved", slot: "referent" }; missing.push("referent_repair_unresolved"); }
          }
          if (act.repair.kind === "facet_purpose") { e.predicate = "item.purpose"; e.fn_hint = null; e.request_text = "What are they for?"; }
        }
      }
    } else if (act.speech_act === "elliptical_continuation") {
      e.relation = "continuation";
      // An earlier question in the SAME line is the nearest antecedent ("Giselle, are you nervous? Malcolm, what
      // about you?").
      let prevInTurn = [...effective].reverse().find((x) => ["question", "request"].includes(x.speech_act) && x.predicate && x.request_text);
      // "I've never been in the Complex. Have you, Malcolm?" / "First day for me. How about everyone else?": the
      // player's own statement just before carries the question (a person predicate asked back).
      if (!prevInTurn) {
        const stated = [...effective].reverse().find((x) => x.speech_act === "statement" && CANONICAL_QUESTION[x.act?.predicate_candidates?.[0]?.id]);
        if (stated) { const id = stated.act.predicate_candidates[0].id; prevInTurn = { predicate: id, fn_hint: null, request_text: CANONICAL_QUESTION[id], addressee: { ids: [] }, args: null, temporal_scope: stated.act.predicate_candidates[0].temporal ?? registry.get(id)?.default_temporal ?? null }; }
      }
      const ante = prevInTurn && act.ellipsis?.kind !== "topic" ? { from: "same_turn", request: { predicate: prevInTurn.predicate, fn: prevInTurn.fn_hint ?? null, request_text: prevInTurn.request_text, targets: [...(prevInTurn.addressee?.ids ?? [])], answered_by: [], request_id: null, args: prevInTurn.args ? { ...prevInTurn.args } : null, temporal: prevInTurn.temporal_scope ?? null } } : antecedentOf(act, dis);
      e.addressee = resolveAddressee(act, { present: people, dis, explicit_target_id });
      e.question_form = act.question_form;
      if (!ante || act.ellipsis?.kind === "topic") {
        const timeWord = String(act.ellipsis?.topic_text ?? "").toLowerCase().trim();
        const TEMPORAL_TOPIC = { earlier: "earlier", before: "earlier", "this morning": "earlier", yesterday: "earlier", now: "now", today: "today", "right now": "now" };
        if (act.ellipsis?.kind === "topic" && TEMPORAL_TOPIC[timeWord] && dis?.last_request?.request_text && dis.last_request.predicate) {
          // "What about earlier?" -- the same question, same person, another time (a temporal repair).
          const last = dis.last_request;
          e.predicate = last.predicate; e.fn_hint = last.fn; e.request_text = last.request_text; e.args = last.args ? { ...last.args } : {};
          e.temporal_scope = TEMPORAL_TOPIC[timeWord]; e.relation_target = last.request_id;
          const targets = (last.targets ?? []).filter((id) => presentIds.includes(id));
          e.addressee = targets.length === 1 ? { kind: "explicit", ids: targets, quantifier: null, source: "repaired_request" } : resolveAddressee(act, { present: people, dis, explicit_target_id });
        } else if (act.ellipsis?.kind === "topic" && dis?.last_request?.request_text) {
          // "What about the camera?": the last request, about the newly named thing.
          const last = dis.last_request;
          const named = canonicalKnowledge.resolveEntityMentions(act.ellipsis.topic_text, entities)[0] ?? null;
          const priorMentions = named ? canonicalKnowledge.resolveEntityMentions(last.request_text, entities) : [];
          // Places and place-like entities ("the Threshold" -> "Outpost A") substitute for one another.
          const PLACE_KINDS = ["location", "entity"];
          const ITEM_KINDS = ["equipment", "task"];
          const family = (k) => (PLACE_KINDS.includes(k) ? PLACE_KINDS : ITEM_KINDS.includes(k) ? ITEM_KINDS : [k]);
          const before = named ? (priorMentions.find((x) => x.kind === named.kind) ?? priorMentions.find((x) => family(named.kind).includes(x.kind)) ?? null) : null;
          if (named && before) {
            e.request_text = String(last.request_text).replace(new RegExp(before.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), act.ellipsis.topic_text); e.predicate = last.predicate; e.reissue_of = null; e.relation_target = last.request_id;
            // The same question about another thing continues the exchange with the one who answered it
            // (owner decision 2026-09-27: follow-ups inherit, they are not rotated).
            const answered = (last.answered_by ?? []).filter((id) => presentIds.includes(id));
            if (e.addressee.kind === "untargeted" && answered.length === 1) e.addressee = { kind: "inherited", ids: answered, quantifier: null, source: "antecedent_owner" };
          }
          else { e.clarify = { reason: "ellipsis_no_antecedent", slot: "topic" }; missing.push("ellipsis_no_antecedent"); }
        } else { e.clarify = { reason: "ellipsis_no_antecedent", slot: "topic" }; missing.push("ellipsis_no_antecedent"); }
      } else {
        const ante_request = act.ellipsis?.kind === "sequence" && !["procedure.next_incomplete_step", "mission.route", "procedure.instruction_history"].includes(ante.request.predicate)
          // "then what?" after something that is not a step: the next step.
          ? { ...ante.request, predicate: "procedure.next_incomplete_step", fn: "ask_next_step", request_text: "What's next?", args: null }
          : ante.request;
        e.predicate = ante_request.predicate;
        e.fn_hint = ante_request.fn;
        e.request_text = ante_request.request_text;
        e.args = ante_request.args ? { ...ante_request.args } : {};
        if (ante_request.predicate === "person.familiarity" && (ante_request.targets ?? []).length > 1 && !e.args.asked_among) e.args.asked_among = [...ante_request.targets];
        e.temporal_scope = ante_request.temporal ?? null;
        e.relation_target = ante_request.request_id;
        e.activity = ante.activity ? { activity_id: ante.activity.activity_id, kind: ante.activity.kind } : null;
        let addressee = resolveAddressee(act, { present: people, dis, explicit_target_id });
        // "then what?" / "not even a little?": continue with the one who just answered.
        const answerer = (ante_request.answered_by ?? []).filter((id) => presentIds.includes(id)).at(-1) ?? dis?.active_speaker?.speaker_id ?? null;
        if (["sequence", "same_question"].includes(act.ellipsis?.kind) && !act.vocatives.length && answerer && presentIds.includes(answerer) && !dis?.activity) addressee = { kind: "inherited", ids: [answerer], quantifier: null, source: "active_speaker" };
        else if (addressee.kind === "untargeted" || addressee.kind === "inherited") {
          // "And you?" / "Your turn." with nobody named: the one uncompleted person in the activity, if unique.
          const done = new Set([...(ante_request.answered_by ?? []), ...(ante.activity?.completed ?? [])]);
          const remaining = presentIds.filter((id) => !done.has(id));
          addressee = remaining.length === 1 ? { kind: "inherited", ids: remaining, quantifier: null, source: "activity_remaining" } : { kind: "inherited", ids: [], quantifier: null, source: "ellipsis_unresolved", ambiguous: remaining };
        }
        e.addressee = addressee;
        if (!addressee.ids.length) { e.clarify = { reason: "ellipsis_target_unresolved", slot: "person" }; missing.push("ellipsis_target_unresolved"); }
        // A question ABOUT one person's reply ("Why?", "What do you mean?") does not carry to people who did
        // not give that reply: "you two?" after "Why?" is asked, never silently dropped.
        else if (isMetaRequest({ predicate: e.predicate, fn: ante_request.fn }) && !(ante_request.targets ?? []).some((id) => addressee.ids.includes(id))) { e.clarify = { reason: "ellipsis_meta_not_transferable", slot: "topic" }; missing.push("ellipsis_meta_not_transferable"); }
        if (addressee.mismatch) { e.clarify = { reason: "quantifier_mismatch", slot: "person" }; missing.push("quantifier_mismatch"); }
      }
    } else if (act.speech_act === "attention_call") {
      e.relation = "attention";
      const pending = dis?.pending_requests?.at(-1) ?? null;
      const vocIds = act.vocatives.map((v) => v.id).filter((id) => presentIds.includes(id));
      if (pending) {
        e.relation_target = pending.request_id;
        e.reissue_of = pending.request_id;
        e.reopen = true;
        e.predicate = pending.predicate;
        e.fn_hint = pending.fn;
        e.request_text = pending.request_text;
        e.args = pending.args ? { ...pending.args } : {};
        e.temporal_scope = pending.temporal;
        e.question_form = null; e.reissued_form = pending.question_form;
        const openTargets = pending.targets.filter((id) => presentIds.includes(id) && pending.slots?.[id] !== "SATISFIED");
        const q = act.quantifier?.kind ?? (/^(?:anyone|anybody)\b/i.test(act.body_expanded) ? "any" : null);
        e.addressee = q === "any" ? { kind: "group", ids: openTargets.length ? openTargets : presentIds, quantifier: "any", source: "pending_request" } : vocIds.length ? { kind: vocIds.length > 1 ? "subset" : "explicit", ids: vocIds, quantifier: null, source: "vocative" } : openTargets.length ? { kind: openTargets.length > 1 ? "subset" : "explicit", ids: openTargets, quantifier: null, source: "pending_request" } : { kind: "group", ids: presentIds, quantifier: null, source: "pending_request" };
      } else if (vocIds.length && (dis?.activity || (dis?.last_request?.predicate && !String(dis.last_request.predicate).startsWith("conversation.") && vocIds.every((id) => !(dis.last_request.answered_by ?? []).includes(id)) && (dis.last_request.answered_by ?? []).length))) {
        // "Tonya?" right after someone else answered (or during a round): the same question, now to her.
        const last = dis.activity ? { predicate: dis.activity.template.predicate, fn: dis.activity.template.fn, request_text: dis.activity.template.request_text, args: null, temporal: null, request_id: null, question_form: null } : dis.last_request;
        e.speech_act = "elliptical_continuation"; e.relation = "continuation"; e.relation_target = last.request_id ?? null;
        e.predicate = last.predicate; e.fn_hint = last.fn; e.request_text = last.request_text; e.args = last.args ? { ...last.args } : {};
        e.temporal_scope = last.temporal ?? null; e.question_form = "wh";
        e.addressee = { kind: vocIds.length > 1 ? "subset" : "explicit", ids: vocIds, quantifier: null, source: "vocative" };
      } else {
        e.request_text = null;
        e.addressee = vocIds.length ? { kind: "explicit", ids: vocIds, quantifier: null, source: "vocative" } : { kind: "untargeted", ids: [], quantifier: null, source: "room_attention" };
      }
    } else {
      // Ordinary question / request / statement / social act.
      e.addressee = resolveAddressee(act, { present: people, dis, explicit_target_id });
      // Bidirectional adjacency (ED-30H): a coworker asked the PLAYER something. The player's next turn is read
      // against that expectation -- an answer, "I don't know", a refusal, a counter-question, or a topic
      // shift -- and is addressed to the one who asked. A "Yes?" attention reply expects the player's request,
      // not an answer.
      const inbound = dis?.pending_inbound_request ?? null;
      const asker = inbound?.from ?? dis?.active_speaker?.speaker_id ?? null;
      const expecting = inbound ? inbound.kind !== "attention" : Boolean(dis?.npc_question);
      const replyText = String(act.body_expanded ?? act.body ?? act.text ?? "").toLowerCase().trim();
      const otherNamed = act.vocatives.some((v) => v.id !== asker);
      if (expecting && asker && presentIds.includes(asker) && !otherNamed) {
        const kind = REPLY_UNCERTAIN.test(replyText) ? "uncertainty" : REPLY_REFUSAL.test(replyText) ? "refusal" : null;
        // A filler ("good to hear") answers nothing; a yes/no-type reply answers a coworker's yes/no question.
        // "When I greeted them." to "when do you mean?": the subordinate-clause form ANSWERS the pending question.
        if (act.force?.cue === "subordinate_clause_or_question") { act.speech_act = "statement"; e.speech_act = "statement"; e.question_form = null; }
        const yesNoReply = act.speech_act === "social_acknowledgment" && inbound?.kind === "question" && /^(?:yes|yeah|yep|yup|yea|no|nope|nah|naw|sure|of course|definitely|not really|kind of|kinda|sort of|maybe|a bit|a little|once|twice|never)\b/.test(String(act.text ?? "").toLowerCase().trim());
        const shaped = act.inbound_answer ?? null;
        if (act.speech_act === "statement" || yesNoReply || kind || shaped) {
          e.addressee = { kind: "inherited", ids: [asker], quantifier: null, source: "open_question_answer" }; e.relation = "answer"; e.speech_act = "answer";
          e.args = { ...(e.args ?? {}), reply_kind: shaped?.kind ?? kind ?? "answer", inbound_kind: inbound?.kind ?? "question", ...(inbound?.predicate ? { answers_predicate: inbound.predicate } : {}), ...(inbound?.answer_shape ? { answer_shape: inbound.answer_shape } : {}), ...(shaped?.option ? { answer_option: shaped.option } : {}) };
          // An answer the pending question could not take is clarified, never guessed.
          if (shaped && !shaped.compatible) { e.clarify = { reason: shaped.reason ?? "answer_incompatible", slot: "answer" }; missing.push(shaped.reason ?? "answer_incompatible"); }
        } else if (["question", "request"].includes(act.speech_act) && !act.vocatives.length) {
          // "why do you ask?" asks the asker's reason; any other unaddressed question goes back to the asker.
          if (REPLY_COUNTER_WHY.test(replyText)) e.counter_why = true;
          // Unaddressed, it goes back to the one who asked (over any active-speaker guess).
          if (!(e.addressee?.ids ?? []).length || ["active_speaker", "antecedent_owner"].includes(e.addressee?.source)) e.addressee = { kind: "inherited", ids: [asker], quantifier: null, source: "inbound_asker" };
          e.relation = "continuation"; e.args = { ...(e.args ?? {}), reply_kind: "counter_question" };
        }
      } else if (!expecting && dis?.just_answered_inbound && ["statement", "repair"].includes(act.speech_act) && REPLY_SELF_REPAIR.test(String(act.text ?? "").toLowerCase()) && presentIds.includes(dis.just_answered_inbound.from)) {
        // "I mean, once" right after answering: the player repairs their OWN answer, to the same asker.
        e.speech_act = "answer"; e.relation = "repair"; e.predicate = null; e.repair = null;
        e.addressee = { kind: "inherited", ids: [dis.just_answered_inbound.from], quantifier: null, source: "answer_repair" };
        e.args = { ...(e.args ?? {}), reply_kind: "answer_repair" };
      }
      // A statement ("First day.", "I'm nervous.") is the player's own claim, not a question about anyone:
      // it takes no registry predicate unless context makes it a declarative question.
      const asks = ["question", "request"].includes(act.speech_act) || (act.declarative_candidate && dis?.active_speaker?.speaker_id);
      e.predicate = asks ? (top?.id ?? null) : null;
      // "Is this your first time going in?" asks the predicate inverted: a yes means NO experience. Carried in
      // the args so a repair or ellipsis re-asking the same question keeps it (review F2).
      if (e.predicate && top?.polarity === "inverted") e.args = { ...(e.args ?? {}), question_inverted: true };
      // "Are we not going together?": a negative question -- a bare yes/no would be ambiguous (review F11).
      if (e.predicate && act.polarity === "negative" && ["yes_no", "declarative"].includes(act.question_form)) e.args = { ...(e.args ?? {}), question_negated: true };
      // "How many times?" asks a count, not a yes/no; bare, it counts the experience just asked about (review N3).
      if (e.predicate && top?.form === "count") {
        const last = dis?.last_request ?? null;
        const EXPERIENCE = ["person.complex_experience", "person.expedition_experience"];
        if (/^(?:and |so |okay,? )?how many(?: times)?\s*[?.!]*$/i.test(act.body_expanded ?? act.body ?? "") && EXPERIENCE.includes(last?.predicate)) {
          e.predicate = last.predicate; e.args = { ...(last.args ?? {}) };
          const targets = (last.targets ?? []).filter((id) => presentIds.includes(id));
          if (targets.length === 1 && !(e.addressee?.ids ?? []).length) e.addressee = { kind: "inherited", ids: targets, quantifier: null, source: "active_speaker" };
          e.relation = "continuation"; e.relation_target = last.request_id;
        }
        e.args = { ...(e.args ?? {}), count_asked: true };
      }
      e.facet_source = e.predicate ? "tier1_registry" : null;
      // An imperative's frame reads the whole clause ("Wait here.", not the marker-stripped "here.").
      if (act.force?.cue === "imperative") e.request_text = act.text;
      // Replies to a coworker's question: an answer opens no request of its own; "why do you ask?" asks the
      // asker's reason.
      if (e.speech_act === "answer") { e.predicate = null; e.facet_source = null; }
      if (e.counter_why) { e.predicate = "conversation.explanation"; e.facet_source = "inbound_counter"; delete e.counter_why; }
      // About a thing, the clause's own structure decides the facet (definition / purpose / holder / location /
      // provenance / contents / destination), over any weaker word-level reading.
      if (["question", "request"].includes(act.speech_act)) {
        const role = itemRole(act.body_semantic ?? act.body_expanded ?? act.body ?? "", entities, dis);
        if (role && (!e.predicate || String(e.predicate).startsWith("item.") || String(e.predicate).startsWith("place.") || e.predicate === "institution.purpose")) {
          e.predicate = role.predicate; e.facet_source = "item_role"; e.args = { ...(e.args ?? {}), item_id: role.item_id, ...(role.anaphoric ? { item_anaphoric: true } : {}) };
        }
      }
      // An echo of the last reply's own words re-asks the request that reply answered, of its speaker, as a
      // request to say more (only when Tier 1 found no facet, or the line is a bare fragment).
      const echoForm = ["question", "request"].includes(act.speech_act) || (act.speech_act === "statement" && ECHO_TAIL.test(String(act.body_expanded ?? act.body ?? "").replace(/[?!.]+$/, "")));
      // The echo SHAPE. A full question of more than three words is never an echo, even if it shares a
      // word ("Who has the case?"). A bare fragment ("sealed??") or a word questioned by a trailing wh
      // ("Sealed how?", "Terrified of what?") may echo one word; anything longer must repeat a phrase of the
      // reply verbatim ("once we've all met?").
      const echoBody = String(act.body_expanded ?? act.body ?? "").replace(/[?!.\s]+$/, "").replace(/^(?:(?:and|so|but|wait|oh|ok|okay)[,]?\s+)+/i, "");
      // Counted in the words the player TYPED ("Nobody's told you?" is three words, not four expanded ones).
      const echoWords = String(act.body ?? act.text ?? "").replace(/[?!.\s]+$/, "").replace(/^(?:(?:and|so|but|wait|oh|ok|okay)[,]?\s+)+/i, "").split(/\s+/).filter(Boolean).length;
      // A line OPENING with a wh-word is an ordinary question ("What recall?" asks what a term meant -- the
      // meaning anchor answers it); an echo questions a word by trailing wh or none at all.
      const fullQuestion = /^(?:who|whom|whose|what|where|when|why|how|which)\b/i.test(echoBody) || (echoWords > 3 && /^(?:is|are|was|were|do|does|did|can|could|will|would|have|has)\b/i.test(echoBody));
      const wordEcho = echoWords <= 3 || /\b(?:how|what|why|where|when|who|so|exactly|meaning)$/i.test(echoBody);
      const echo = echoForm && !fullQuestion && presentIds.length ? echoOf(act, dis, { phraseOnly: !wordEcho }) : null;
      if (echo && presentIds.includes(echo.speaker_id)) {
        const span = echo.span;
        e.speech_act = "question";
        // "Sealed how?" asks wh; "sealed??" / "the Bermuda branch?" checks the word back (yes/no).
        e.question_form = /\b(?:how|what|why|where|when|who|meaning)\s*$/i.test(String(act.body_expanded ?? act.body ?? "").replace(/[?!.\s]+$/, "")) ? "wh" : "yes_no";
        e.predicate = span.predicate ?? "conversation.explanation";
        e.facet_source = "surface_anchor";
        if (span.request_text) e.request_text = span.request_text;
        e.args = { ...(span.args ?? {}), echo: { matched: echo.matched, event_id: echo.event_id } };
        e.temporal_scope = span.temporal ?? null;
        e.relation = "continuation"; e.relation_target = span.request_id ?? null;
        e.addressee = { kind: "inherited", ids: [echo.speaker_id], quantifier: null, source: "surface_anchor" };
      }
      // Temporal / degree / reason fragments ask more about the answer just given: "since when?", "how long?",
      // "before?", "ever?", "still?" keep its facet (and target); "what for?", "how come?" ask for its reason.
      // Only a UNIQUE answered antecedent in the ledger licenses this; otherwise nothing is inherited.
      const fragment = String(act.body_semantic ?? act.body_expanded ?? act.body ?? "").toLowerCase().replace(/^(?:(?:and|so|but|ok|okay|wait|oh|hm+|really)[,.]?\s+)+/, "").replace(/[?!.\s]+$/, "");
      const last = dis?.last_substantive_request ?? dis?.last_request ?? null;
      const answeredBy = (last?.answered_by ?? []).filter((id) => presentIds.includes(id));
      if (!e.predicate && !act.vocatives.length && last?.predicate && !String(last.predicate).startsWith("conversation.") && answeredBy.length === 1) {
        // "when was that" / "when did that happen": the same proposition, asked about its time (earlier).
        // "when was that" asks the TIME of the proposition just answered (an elaboration, same temporal frame);
        // "before?" asks the same predicate at an earlier time, in the scope the predicate supports.
        const ELABORATE_TIME = new Set(["when was that", "when was this", "when did that happen", "when did that happen then", "when", "when was it"]);
        const TEMPORAL = { "since when": null, "how long": null, "how long ago": null, "how long now": null, "for how long": null, "how many times": null, "how often": null, "since": null, "until when": null, before: "ever", "before that": "ever", ever: "ever", "and before": "ever", "and before that": "ever", "what about before": "ever", "in general": "ever", "at all": "ever", earlier: "earlier", still: "now", yet: "now", already: "now" };
        if (ELABORATE_TIME.has(fragment)) {
          e.speech_act = "question"; e.question_form = "wh"; e.predicate = last.predicate; e.fn_hint = last.fn ?? null; e.request_text = last.request_text; e.args = { ...(last.args ?? {}), followup: { kind: "temporal_elaboration", word: fragment }, time_asked: true };
          e.temporal_scope = last.temporal ?? null; e.relation = "continuation"; e.relation_target = last.request_id ?? null; e.facet_source = "discourse_followup";
          e.addressee = { kind: "inherited", ids: answeredBy, quantifier: null, source: "answer_owner" };
        } else if (fragment in TEMPORAL) {
          const support = registry.get(last.predicate)?.temporal_support ?? null;
          let scope = TEMPORAL[fragment];
          // "before?" of a present state ("how are you?") is earlier; of a history ("been in?") it is ever.
          if (scope && support && !support.includes(scope)) scope = scope === "ever" && support.includes("earlier") ? "earlier" : scope === "earlier" && support.includes("ever") ? "ever" : scope;
          e.speech_act = "question"; e.predicate = last.predicate; e.fn_hint = last.fn ?? null; e.request_text = last.request_text; e.args = { ...(last.args ?? {}), followup: { kind: "temporal", word: fragment } };
          e.temporal_scope = scope ?? last.temporal ?? null; e.relation = "continuation"; e.relation_target = last.request_id ?? null; e.facet_source = "discourse_followup";
          e.addressee = { kind: "inherited", ids: answeredBy, quantifier: null, source: "answer_owner" };
        }
      }
      // "who else" / "anyone else": the same question, to the people who have not answered it (self facets),
      // or its answer extended (shared facets) -- from the answered frame, never a new topic.
      if (!e.predicate && !act.vocatives.length && /^(?:and |so |ok |okay )?(?:who else|anyone else|anybody else|what about the others|the rest of you|who else is)\b/.test(fragment) && last?.predicate && !String(last.predicate).startsWith("conversation.")) {
        const entry = registry.get(last.predicate);
        const others = presentIds.filter((id) => !(last.answered_by ?? []).includes(id));
        e.speech_act = "question"; e.question_form = "wh"; e.predicate = last.predicate; e.fn_hint = last.fn ?? null; e.request_text = last.request_text; e.args = { ...(last.args ?? {}), followup: { kind: "person_set", word: fragment } };
        e.temporal_scope = last.temporal ?? null; e.relation = "continuation"; e.relation_target = last.request_id ?? null; e.facet_source = "discourse_followup";
        if (SELF_CARDINALITY.has(entry?.default_cardinality) && others.length) e.addressee = { kind: others.length > 1 ? "subset" : "inherited", ids: others, quantifier: "rest", source: "person_set_continuation" };
        else if (answeredBy.length === 1) e.addressee = { kind: "inherited", ids: answeredBy, quantifier: null, source: "answer_owner" };
      }
      if (!e.predicate && ["what for", "for what", "how come", "why not", "why so", "how so"].includes(fragment) && dis?.active_speaker?.speaker_id && presentIds.includes(dis.active_speaker.speaker_id)) {
        e.predicate = "conversation.explanation"; e.relation = "continuation"; e.facet_source = "discourse_followup";
        if (!(e.addressee?.ids ?? []).length) e.addressee = { kind: "inherited", ids: [dis.active_speaker.speaker_id], quantifier: null, source: "active_speaker" };
      }
      // A bare wh-fragment ("which one", "where") with nothing before it to ask about: clarify, never guess.
      // "the lamp?" right after "who has the camera?": the same question about another thing of the same kind,
      // to the one who answered -- only with no coworker question pending (then it would be an answer).
      if (!e.predicate && !act.vocatives.length && !dis?.pending_inbound_request && /^(?:the|that|this|my|your)\s+[a-z][\w -]{1,30}$/.test(fragment) && last?.request_text && last?.predicate) {
        const named = canonicalKnowledge.resolveEntityMentions(fragment, entities)[0] ?? null;
        const before = named ? canonicalKnowledge.resolveEntityMentions(last.request_text, entities).find((x) => x.kind === named.kind && x.id !== named.id) : null;
        if (named && before) {
          e.speech_act = "elliptical_continuation"; e.question_form = "wh"; e.predicate = last.predicate; e.fn_hint = last.fn ?? null;
          e.request_text = String(last.request_text).replace(new RegExp(before.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), fragment.replace(/^(?:the|that|this|my|your)\s+/, ""));
          e.args = { ...(last.args ?? {}), ...(named.kind === "equipment" ? { item_id: named.id } : {}) }; e.relation = "continuation"; e.relation_target = last.request_id ?? null; e.facet_source = "discourse_followup";
          if (answeredBy.length === 1) e.addressee = { kind: "inherited", ids: answeredBy, quantifier: null, source: "answer_owner" };
        }
      }
      // "which one?" with nothing offered to choose from: which thing is meant cannot be read from the state.
      if (!e.predicate && !e.clarify && !act.vocatives.length && !dis?.pending_inbound_request && /^which(?: one| ones)?$/.test(fragment)) { e.clarify = { reason: "which_unresolved", slot: "referent" }; missing.push("which_unresolved"); }
      const shortWh = /^(?:who|what|where|when|why|how|which)\b/i.test(fragment) && fragment.split(/\s+/).length <= 2;
      if ((act.bare_wh || shortWh) && !e.predicate && !act.vocatives.length && !dis?.active_speaker?.speaker_id && !dis?.last_request && !dis?.pending_inbound_request) { e.clarify = { reason: "fragment_no_antecedent", slot: "topic" }; missing.push("fragment_no_antecedent"); }
      if (act.bare_wh) e.relation = "continuation";
      if (act.declarative_candidate && dis?.active_speaker?.speaker_id && e.predicate) { e.question_form = "declarative"; e.speech_act = "question"; }
      if (e.addressee.kind === "inherited" && e.relation === "new") e.relation = "continuation";
      if (e.addressee.mismatch) { e.clarify = { reason: "quantifier_mismatch", slot: "person" }; missing.push("quantifier_mismatch"); }
      if (e.addressee.absent) e.absent_addressees = e.addressee.absent;
      // Several people just answered and "you" names none of them: the legacy active-thread rule keeps the
      // set (a reflex, a check-in to the group); nothing is guessed here.
      if (act.question_form === "choice" && !act.alternatives?.length) missing.push("choice_alternatives_lost");
    }
    // Temporal scope: an explicit "ever"/"earlier" in the clause wins; otherwise the cue's scope.
    const cueTemporal = top?.temporal ?? null;
    if (!e.temporal_scope && !["greeting", "self_introduction", "farewell", "statement", "sarcasm", "social_acknowledgment", "thanks"].includes(e.speech_act)) e.temporal_scope = ["ever", "earlier"].includes(act.temporal_scope) ? act.temporal_scope : (cueTemporal ?? act.temporal_scope ?? null);
    // Arguments the predicate's slots need.
    const entry = e.predicate ? registry.get(e.predicate) : null;
    if (entry?.slots?.place && !e.args.place_id) {
      // A place named earlier in the same line is the active antecedent ("What about Outpost A? Been there?").
      const place = placeOf(e.request_text ?? act.body, entities, turnPlace ? { ...(dis ?? {}), salient_place: turnPlace } : dis, { apposition: act.apposition });
      if (place?.place_id) e.args.place_id = place.place_id;
      // Owner decision (2026-09-27): "there" resolves only to a place the exchange made active (placeOf's
      // salient place); with none, it is clarified -- never defaulted to the Complex.
      else if (place?.basis === "unresolved_deixis") { e.clarify = { reason: "deixis_unresolved", slot: "location" }; missing.push("deixis_unresolved"); }
      if (place) e.args.place_basis = place.basis;
    }
    if (e.predicate === "transition.participants" || e.predicate === "mission.participants") {
      const named = act.mentions.map((m) => m.id).filter(Boolean);
      if (named.length) e.args.subject_ids = named;
      if (/\bsplit|separate/i.test(act.body_expanded)) e.args.asks_split = true;
    }
    if (e.predicate === "person.familiarity") {
      const named = act.mentions.map((m) => m.id).filter(Boolean);
      const other = canonicalKnowledge.resolveEntityMentions(act.body, entities).find((x) => x.kind === "person" && !x.is_player && !(e.addressee?.ids ?? []).includes(x.id)) ?? null;
      if (named.length === 1) e.args.other_id = named[0];
      else if (other) { e.args.other_id = other.id; e.args.other_non_present = Boolean(other.non_present); }
      else if (/\beach other|one another|together\b/i.test(act.body_expanded)) e.args.mutual = true;
    }
    e.cardinality = e.addressee ? cardinalityFor(e.predicate, e.addressee, e) : "none";
    if (e.repair?.vacuous) e.cardinality = "each_ack";
    // Completeness: an interrogative line that produced no predicate is only complete if the legacy frame
    // types it (checked by the caller with the frame); ambiguous closed-vocabulary repairs never are.
    if (parsed.normalized.ambiguous_repairs.length) missing.push("ambiguous_name_repair");
    effective.push(e);
    const named = placeOf(act.body || act.text || "", entities, null);
    if (named?.place_id && named.basis === "named") turnPlace = named.place_id;
  }
  if (parsed.dropped.length) missing.push("acts_dropped");
  // Social framing clauses that ride along with a substantive act ("Good to hear!") need no reply.
  const social = parsed.acts.filter((a) => SOCIAL.has(a.speech_act)).map((a) => ({ speech_act: a.speech_act, text: a.text, closes_activity: Boolean(a.closes_activity) }));
  return Object.freeze({
    version: TURN_VERSION,
    normalized: parsed.normalized,
    clauses: parsed.clauses,
    acts: parsed.acts,
    effective,
    primary: primaryOf(effective),
    social,
    closes_activity: closes,
    completeness: { complete: missing.length === 0, missing: [...new Set(missing)] },
    dropped: parsed.dropped
  });
}

/**
 * Completeness gate (D14), with the legacy frame in hand: Tier 1 may skip Tier 2 only when the turn is
 * COMPLETE, not merely confident.
 */
function completenessWithFrame(analysis, frame, effective = analysis?.primary) {
  const missing = [...(analysis?.completeness?.missing ?? [])];
  const e = effective;
  if (e && !e.clarify) {
    // A bare attention call ("Giselle?") or a repair/ellipsis carried by the ledger asks no new facet.
    // (An imperative is an action request -- the legacy request / order handling owns it; it asks no facet.)
    const interrogative = (["question", "request"].includes(e.speech_act) || /\?\s*$/.test(e.act?.text ?? "")) && !(e.speech_act === "attention_call" && !e.request_text) && e.act?.force?.cue !== "imperative";
    // A resolved referent says WHICH thing a factual question is about, not WHAT about it is asked ("what's
    // inside that bag"): with no facet, Tier 2 still gets its one bounded reading (the legacy reading stands
    // if it cannot help).
    const generic = !frame || (frame.discourse_function === "ask_factual" && !frame.addressee_state && !frame.past_perception) || (frame.discourse_function === "make_statement" && !frame.addressee_state && !frame.past_perception && !(frame.referents ?? []).some((r) => r.resolved)) || (frame.discourse_function === "ambiguous_reference" && frame.tier1_generic);
    // A factual question whose THING resolved (the legacy entity-anchored reading can still answer it) is a
    // different gap from one Tier 1 did not understand at all: only the latter fails closed to a clarification.
    const anchored = frame?.discourse_function === "ask_factual" && (frame.referents ?? []).some((r) => r.resolved);
    if (interrogative && !e.predicate && generic) missing.push(anchored ? "facet_unresolved_referent" : "facet_unresolved");
    // Tier 1 not sure whether the line asks at all: that uncertainty alone earns the bounded reading -- unless
    // the conversation settled it (an answer to the coworker's pending question).
    const filled = new Set(e.advisory_filled ?? []);
    // The legacy reading's own specific route (a meaning / explanation / repetition / knowledge question) is
    // itself evidence of what is asked and of who answers.
    const legacyRoute = Boolean(frame) && !(["ask_factual", "make_statement", "ambiguous_reference"].includes(frame.discourse_function) && (frame.tier1_generic || frame.discourse_function !== "ask_factual"));
    // An echo of the coworker's own words (a located surface anchor) is positive evidence the line checks back.
    if (e.act?.force?.confidence === "uncertain" && e.speech_act !== "answer" && !filled.has("force") && e.facet_source !== "surface_anchor") missing.push("force_uncertain");
    if (e.act?.vocatives?.length && !(e.addressee?.ids ?? []).length && !e.absent_addressees) missing.push("name_unresolved");
    if (e.addressee?.second_person && e.relation !== "new" && !(e.addressee?.ids ?? []).length) missing.push("second_person_no_target");
    // ── ED-30I: POSITIVE evidence, not the absence of problems ──
    const semantic = String(e.act?.body_semantic ?? e.act?.body_expanded ?? e.act?.text ?? "").trim();
    const words = semantic.replace(/[?!.,]/g, " ").trim().split(/\s+/).filter(Boolean).length;
    // A statement needs statement evidence: a finite verb, a first-person claim, a report, or a social formula.
    if (e.speech_act === "statement" && !filled.has("force") && e.act?.force?.cue === "declarative" && !STATEMENT_EVIDENCE.test(semantic) && words <= 6) missing.push("force_uncertain");
    // A facet chosen among competing, equally-ranked readings is weak.
    const cands = e.act?.predicate_candidates ?? [];
    if (ASKING.has(e.speech_act) && e.predicate && !filled.has("facet") && cands.length >= 2 && cands[0].id !== cands[1].id && String(cands[0].id).split(".")[0] !== String(cands[1].id).split(".")[0] && registry.get(cands[0].id)?.priority === registry.get(cands[1].id)?.priority && !/item_role|discourse_followup|surface_anchor|inbound_counter|tier2_advisory/.test(e.facet_source ?? "")) missing.push("facet_weak");
    // An untargeted short or anaphoric question has no evidence of being a fresh shared question.
    // (A room-wide attention call, or a question with its own shared facet, is legitimately untargeted.)
    if (ASKING.has(e.speech_act) && e.speech_act !== "attention_call" && e.act?.force?.cue !== "imperative" && e.addressee?.kind === "untargeted" && !e.predicate && !legacyRoute && !filled.has("addressee") && (words <= 2 || /\b(?:it|that|this|those|them|there|then)\b/.test(semantic))) missing.push("addressee_no_evidence");
    // Inheritance with no unique person is not evidence.
    if (e.addressee?.kind === "inherited" && !(e.addressee.ids ?? []).length && !e.clarify && !legacyRoute) missing.push("addressee_ambiguous");
    // A short fragment that resolved to nothing in the conversation.
    if (e.act?.force?.cue === "fragment" && !e.predicate && !legacyRoute && e.relation === "new" && e.speech_act !== "answer" && !filled.has("fragment")) missing.push("fragment_unresolved");
  }
  const unique = [...new Set(missing)];
  return { complete: unique.length === 0, missing: unique };
}

/**
 * Reconciliation (D16): the legacy frame answers WHICH entity; the registry predicate says WHAT is asked
 * about it. The predicate's route overrides the legacy discourse function only when the two disagree and
 * the legacy function is not structurally stronger (a quotation, a reported-speech or conversational-event
 * question, a resolved custody question). Every override is traced with its reason.
 */
const STRUCTURAL_KEEP = new Set(["ask_meaning", "ask_reported_speech", "ask_response_event", "clarify_previous", "request_repetition", "ask_heard_confirmation", "ask_explanation", "make_request"]);
function reconcile(frame, effective) {
  const predicate = effective?.predicate ?? null;
  const out = { predicate, route: null, override: null, keep_legacy: true };
  if (!frame) return out;
  const legacyPredicate = registry.predicateForFrame(frame);
  if (!predicate) return { ...out, predicate: legacyPredicate };
  const entry = registry.get(predicate);
  if (!entry) return { ...out, predicate: legacyPredicate };
  const fn = frame.discourse_function;
  if (STRUCTURAL_KEEP.has(fn) && fn !== "make_request") return { ...out, predicate: legacyPredicate ?? predicate, override: { kept: fn, over: predicate, reason: "structural_legacy_function" } };
  if (fn === "make_request" && entry.id !== "person.self_description") return { ...out, predicate: legacyPredicate ?? predicate, override: { kept: fn, over: predicate, reason: "structural_legacy_function" } };
  // A more specific item facet (where it goes, what it's for, what's in it, its state) beats the legacy custody guess.
  if (fn === "ask_item_ownership" && (frame.referents ?? []).some((r) => r.type === "equipment" && r.resolved) && entry.domain !== "person" && !["item.destination", "item.purpose", "item.contents", "item.status", "item.location", "item.provenance", "item.definition"].includes(entry.id)) return { ...out, predicate: "item.holder" };
  if (legacyPredicate === predicate) return { ...out, predicate };
  // Person familiarity with someone who is not at the table (Maxwell) keeps the knowledge path.
  if (predicate === "person.familiarity" && effective.args?.other_non_present) return { ...out, predicate: "person.familiarity", route: { fn: "ask_person_identity", concept: "person_relation" }, override: { from: fn, to: "ask_person_identity", reason: "familiarity_with_non_present_person" }, keep_legacy: fn === "ask_person_identity" };
  return { ...out, predicate, route: entry.route, override: { from: fn, to: entry.route.fn, legacy_predicate: legacyPredicate, reason: `registry_facet:${predicate}` }, keep_legacy: false };
}

// ─── bridge to the production service (pure helpers) ───────────────────────────────────────────────────

/**
 * Adds the salient PLACE (for "there") to a DIS snapshot: the place argument of the most recent request,
 * else the place/entity the last knowledge question was about. Canonical ids only.
 */
function withSalience(snapshot, discourse = null, entities = []) {
  let place = snapshot?.last_request?.args?.place_id ?? null;
  if (!place) {
    const key = discourse?.last_turn?.knowledge_key ?? null;
    const entity = key ? entities.find((e) => ["complex", "outpost-a", "equipment-staging", "threshold", "threshold-room", "async-briefing-room"].includes(e.id) && key.endsWith(`:${e.id}`)) : null;
    place = entity?.id ?? null;
  }
  if (!place) {
    // A place the last replies' authorized facts introduced ("...report to Equipment Staging").
    const facts = (discourse?.last_turn?.responses ?? []).flatMap((r) => [...(r.facts?.required ?? []), ...(r.facts?.optional ?? [])]);
    const text = facts.map((f) => (typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? ""))).join(" ");
    // Only places one can go ("there") count; "Standard-side" or "LOCAL" are not somewhere to have been.
    const found = canonicalKnowledge.resolveEntityMentions(text, entities).find((e) => ["complex", "outpost-a", "equipment-staging", "threshold", "threshold-room", "async-briefing-room"].includes(e.id));
    place = found?.id ?? null;
  }
  // What the immediately relevant exchange talked about: the last request and the AUTHORIZED facts of the
  // replies to it -- never their wording, which differs by provider (semantics must not). A follow-up that
  // picks one of these up belongs to the one who answered.
  const replies = discourse?.last_turn?.responses ?? [];
  const replyFacts = replies.flatMap((r) => [...(r.facts?.required ?? []), ...(r.facts?.optional ?? [])]).map((f) => (typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? ""))).join(" ");
  const exchangeText = [snapshot?.last_request?.request_text ?? "", discourse?.last_turn?.player_text ?? "", replyFacts].join(" ");
  const mentioned = canonicalKnowledge.resolveEntityMentions(exchangeText, entities).filter((e) => e.kind !== "person" && !e.is_player);
  // Owner decision (2026-09-27): "there" is a place only when the exchange actually made one active -- the
  // player's own previous question counts ("Nervous about going into the Complex?" -> "Been there before?").
  if (!place) place = mentioned.find((e) => ["complex", "outpost-a", "equipment-staging", "threshold", "threshold-room", "async-briefing-room"].includes(e.id))?.id ?? null;
  // The names the REPLY itself used (not the player's own words): picking one up is a follow-up to its speaker.
  const replyNamed = canonicalKnowledge.resolveEntityMentions(replyFacts, entities).filter((e) => e.kind !== "person" && !e.is_player);
  const inbound = snapshot?.pending_inbound_request ?? null;
  const npcQuestion = snapshot?.npc_question != null ? Boolean(snapshot.npc_question) : inbound ? inbound.kind !== "attention" : Boolean(discourse?.pending_question);
  return Object.freeze({ ...(snapshot ?? {}), salient_place: place, salient_entities: [...new Set(mentioned.map((e) => e.id))], salient_names: [...new Set(replyNamed.map((e) => e.matched).filter((n) => n && n.length >= 3))], npc_question: npcQuestion });
}

/**
 * The canonical address a turn's primary act establishes, in the service's address shape, or null when
 * the legacy parse should stand (untargeted room speech with nothing re-issued).
 */
function addressFromTurn(primary, legacy, people = []) {
  if (!primary) return null;
  // An answer to a coworker's open question, and a name the advisory reading recovered, keep the
  // established resolution (open-question askers; advisory span).
  if (primary.relation === "answer" || legacy?.source === "advisory") return null;
  const ids = primary.addressee?.ids ?? [];
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? null;
  const residual = primary.request_text ?? legacy?.residual_text ?? "";
  // A legacy parse that already found exactly this address keeps its own form (greeting, trailing vocative...).
  const same = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
  if (legacy && ["direct", "subset", "group"].includes(legacy.address_type) && same(legacy.addressee_ids ?? [], ids) && (!primary.request_text || primary.request_text === legacy.residual_text || primary.relation === "new")) return primary.request_text && primary.request_text !== legacy.residual_text && (primary.act?.markers?.length || primary.act?.indirect) ? { ...legacy, residual_text: primary.request_text } : null;
  const VOCATIVE_FORM = { leading: "leading_vocative", greeting: "greeting", trailing: "trailing_vocative", trailing_bare: "trailing_vocative", apposition: "apposition_vocative", ellipsis: "ellipsis", preceding_clause: "leading_vocative", bare: "bare_vocative" };
  const vocForm = VOCATIVE_FORM[primary.act?.vocatives?.[0]?.form] ?? "vocative";
  const form = primary.relation === "repair" && primary.repair?.kind === "target" ? "correction" : primary.addressee?.kind === "inherited" ? "inherited" : primary.relation === "new" ? (primary.addressee?.source === "active_speaker" ? "inherited" : primary.addressee?.source === "quantifier" || primary.addressee?.source === "quantifier_context" ? "quantifier" : vocForm) : primary.relation;
  const base = { ...(legacy ?? {}), residual_text: residual, source: "turn", address_form: form };
  if (primary.addressee?.kind === "group" && ids.length) return { ...base, address_type: "group", explicit_target_id: null, explicit_target_name: "everyone", addressee_ids: [...ids] };
  if (ids.length > 1) return { ...base, address_type: "subset", explicit_target_id: null, explicit_target_name: null, addressee_ids: [...ids], addressee_names: ids.map(nameOf) };
  if (ids.length === 1) return { ...base, address_type: "direct", explicit_target_id: ids[0], explicit_target_name: nameOf(ids[0]), addressee_ids: [ids[0]], addressee_names: [nameOf(ids[0])] };
  // Nobody addressed: keep the legacy scope, but frame only the act's own clause (markers/other clauses out).
  if (primary.request_text && legacy && legacy.address_type === "none" && primary.request_text !== legacy.residual_text) return { ...legacy, residual_text: primary.request_text };
  // An indirect question is framed as the direct question it embeds.
  if (primary.act?.indirect && primary.request_text) return { ...(legacy ?? { address_type: "none", addressee_ids: [] }), residual_text: primary.request_text, source: "turn" };
  return null;
}

/** Argument slots for one responder's resolver call. */
function argsFor(frame, responderId) {
  const args = { ...(frame?.turn?.args ?? {}) };
  const entry = frame?.predicate ? registry.get(frame.predicate) : null;
  if (entry?.domain === "person") args.subject_id = args.third_party_subject ?? responderId;
  // "Do you two know each other?" is asked AMONG a set of people; carried to one of them ("your turn,
  // Tonya") it is still about that set, not about nobody.
  if (entry?.id === "person.familiarity" && !args.other_id) { const among = (frame?.turn?.addressee_ids ?? []).length > 1 ? frame.turn.addressee_ids : (args.asked_among ?? frame?.turn?.addressee_ids ?? []); args.others = among.filter((id) => id !== responderId); }
  return args;
}

/**
 * The frame the planner receives: the legacy frame (entities, referents, antecedents) with the registry
 * facet reconciled onto it (D16), the effective act's relation/cardinality/arguments attached, and a
 * clarification when the act could not be resolved (fail closed, never a guess).
 */
function finalizeFrame(frame, primary, rec, { completeness = null, entities = [] } = {}) {
  if (!frame) return frame;
  // The player ANSWERED a coworker's question: nothing is asked; the words are their answer, heard by the asker
  // (a clarification answer instead resumes the player's own question -- the legacy resumed_question path).
  if (primary?.speech_act === "answer" && primary?.args?.inbound_kind === "question") return Object.freeze({ ...frame, discourse_function: "make_statement", predicate: null, requested_content: null, knowledge_query: null, referents: [], turn: { ...(frame.turn ?? {}), speech_act: "answer", relation: "answer", cardinality: "none", reply_kind: primary.args.reply_kind ?? "answer", addressee_ids: [...(primary.addressee?.ids ?? [])] } });
  // Fail closed (ED-30G): a question Tier 1 did not understand and no complete Tier-2 reading filled is never
  // answered as a generic question -- it is clarified.
  // (Only when the legacy reading has no route of its own either: a known-answer or temporal question the
  // legacy frame understands keeps it.)
  // (Equipment-topic questions are answered from canonical custody -- "anybody know what we're carrying?".)
  const legacyRoute = Boolean(frame.knowledge_query || frame.past_perception || frame.addressee_state || frame.topic === "equipment" || (frame.referents ?? []).some((r) => r.resolved)
    || (frame.temporal_reference && /\b(?:happened|did|was|were|went|said|saw|heard|told|earlier|ago|yesterday|last (?:time|night|week))\b/i.test(String(primary?.request_text ?? primary?.act?.body ?? ""))));
  if (!primary?.clarify && ASKING.has(primary?.speech_act) && !primary?.predicate && (completeness?.missing ?? []).includes("facet_unresolved") && (!legacyRoute || ["make_statement", "social_observation", "acknowledge"].includes(frame.discourse_function))) primary = { ...primary, clarify: { reason: "facet_unresolved", slot: "topic" } };
  // Clarify over guess (ED-30I): a competing facet, an unevidenced or ambiguous addressee, an unresolved
  // fragment, an uncertain reading while a coworker's question is pending, or a question-like uncertainty
  // that no complete reading settled -- never a best guess.
  const unsettled = (completeness?.missing ?? []).find((m) => ["facet_weak", "addressee_ambiguous", "addressee_no_evidence", "fragment_unresolved", "context_uncertain"].includes(m)) ?? ((completeness?.missing ?? []).includes("force_uncertain") && QUESTION_LIKE_CUES.has(primary?.act?.force?.cue) ? "force_uncertain" : null);
  if (!primary?.clarify && primary && unsettled) primary = { ...primary, clarify: { reason: unsettled, slot: "topic" } };
  const predicate = rec?.predicate ?? registry.predicateForFrame(frame);
  const entry = predicate ? registry.get(predicate) : null;
  // A named third person is the SUBJECT only in a fresh question/request, and never someone being addressed
  // ("I was speaking to Tonya" names the addressee of a repaired question).
  const addresseeIds = primary?.addressee?.ids ?? [];
  // Persons named in the question, present or not (the canonical person index: "Is Maxwell nervous?"). A
  // question about someone else is never answered as a question about the responder (review F1).
  // In the order they are named ("Does Tonya know Malcolm?": Tonya is the subject, Malcolm the other).
  const requestLower = String(primary?.request_text ?? primary?.act?.body ?? "").toLowerCase();
  const at = (text) => { const i = text ? requestLower.indexOf(String(text).toLowerCase()) : -1; return i < 0 ? Infinity : i; };
  const namedPersons = ["question", "request"].includes(primary?.speech_act) ? [
    ...(primary?.act?.mentions ?? []).map((m) => ({ id: m.id, pos: at(m.name) })),
    ...canonicalKnowledge.resolveEntityMentions(primary?.request_text ?? "", entities).filter((x) => x.kind === "person").map((x) => ({ id: x.id, pos: at(x.matched) }))
  ].sort((a, b) => a.pos - b.pos).map((x) => x.id) : [];
  // Only people ADDRESSED by name are not the subject; a quantifier group ("does anyone know if Tonya...")
  // still leaves Tonya as the one asked about.
  const addressedByName = primary?.addressee?.kind === "group" ? (primary?.act?.vocatives ?? []).map((v) => v.id) : addresseeIds;
  const mentionIds = [...new Set(namedPersons)].filter((id) => id && !addressedByName.includes(id));
  const thirdParty = entry?.domain === "person" && mentionIds.length && !/\b(?:you|your|yourself|yourselves)\b/i.test(primary?.act?.body_expanded ?? "") ? mentionIds[0] : null;
  // Cardinality and default temporal scope follow the FINAL predicate (a legacy-typed question included).
  // A question ABOUT a named third person ("How is Tonya?") gets one answer: hers if she can hear it,
  // otherwise the addressee's (a report of what she said, or honestly not knowing) -- never a round of
  // everyone describing themselves.
  const cardinality = primary ? (primary.repair?.vacuous ? "each_ack" : thirdParty ? "one_spokesperson" : (primary.addressee ? cardinalityFor(predicate, primary.addressee, primary) : primary.cardinality)) : null;
  const temporal = primary?.temporal_scope ?? (entry?.default_temporal ?? null);
  const turn = primary ? {
    relation: primary.relation, relation_target: primary.relation_target, reissue_of: primary.reissue_of, repair: primary.repair ?? null,
    speech_act: primary.speech_act, cardinality, temporal_scope: temporal, alternatives: primary.alternatives ?? null,
    args: { ...(primary.args ?? {}), ...(thirdParty ? { third_party_subject: thirdParty } : {}), ...(thirdParty && predicate === "person.familiarity" ? { other_id: mentionIds.find((id) => id !== thirdParty) ?? (primary.args?.other_id !== thirdParty ? primary.args?.other_id ?? null : null) } : {}) }, addressee_kind: primary.addressee?.kind ?? null, addressee_ids: [...(primary.addressee?.ids ?? [])],
    quantifier: primary.addressee?.quantifier ?? null, clarify_reason: primary.clarify?.reason ?? null, request_text: primary.request_text ?? null, completeness: completeness ?? null, overrides: [...(primary.overrides ?? []), ...(rec?.override ? [rec.override] : [])], facet_source: primary.facet_source ?? null
  } : null;
  const common = { predicate: predicate ?? null, answer_contract: entry?.answer_contract ?? null, turn };
  if (primary?.clarify) return Object.freeze({ ...frame, ...common, discourse_function: "ambiguous_reference", unresolved_reference: true, expected_slot: primary.clarify.slot ?? "topic", expected_response_shape: "clarification_request", requested_content: null, literal_question: false });
  if (primary?.speech_act === "attention_call" && !primary.request_text) return Object.freeze({ ...frame, ...common, predicate: null, discourse_function: "attend", unresolved_reference: false, requested_content: null, expected_response_shape: "brief_attention_response", knowledge_query: null, literal_question: false });
  if (primary?.repair?.vacuous) return Object.freeze({ ...frame, ...common, predicate: null, discourse_function: "acknowledge", unresolved_reference: false, requested_content: null, expected_response_shape: "brief_acknowledgment", knowledge_query: null });
  let route = rec?.route && !rec.keep_legacy ? rec.route : null;
  // The legacy check-in is always about the responder; a third-person state question goes through the
  // predicate path, whose resolver knows whose state it is (and who may say it).
  if (thirdParty && route?.fn === "check_in") route = { fn: "ask_predicate" };
  // "How were you feeling earlier?" asks about a past state: the predicate path answers from the recorded
  // history (the legacy check-in only knows how the speaker feels now).
  if ((route?.fn === "check_in" || (!route && frame.discourse_function === "check_in" && entry?.route?.fn === "check_in")) && temporal === "earlier") route = { fn: "ask_predicate" };
  // Tier 1 read a QUESTION the legacy frame took for a remark (typed without "?": "is the soup warm"): it is
  // asked, so it gets an answer or a clarification -- never the silence a remark may get.
  if (!route && ["question", "request"].includes(primary?.speech_act) && ["make_statement", "social_observation", "acknowledge", null, undefined].includes(frame.discourse_function) && !frame.player_claim) {
    return Object.freeze({ ...frame, ...common, discourse_function: "ask_factual", literal_question: true, tier1_generic: true, unresolved_reference: false, expected_response_shape: "brief_answer_or_unknown" });
  }
  if (!route) return Object.freeze({ ...frame, ...common });
  const clean = { unresolved_reference: false, literal_question: true, resumed_question: frame.resumed_question ?? null };
  switch (route.fn) {
    case "ask_predicate":
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_predicate", knowledge_query: null, semantic_intent: predicate, requested_content: "predicate_answer", expected_response_shape: "brief_predicate_answer", expected_slot: "topic" });
    case "check_in":
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "check_in", knowledge_query: null, requested_content: null, expected_response_shape: "short_social_acknowledgment", self_state_query: { asked: route.self_state, polarity: primary?.question_form === "wh" ? "open" : "yes_no" }, addressee_state: false });
    case "invite_self_description":
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "invite_self_description", knowledge_query: null, requested_content: "self_description", expected_response_shape: "brief_grounded_self_description" });
    case "ask_next_step":
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_next_step", knowledge_query: null, requested_content: "current_procedure", expected_response_shape: "brief_procedure_answer", procedure_scope: frame.procedure_scope ?? "current" });
    case "ask_mission_objective":
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_mission_objective", knowledge_query: { concept: "mission_objective", entity: null }, semantic_intent: "mission_objective", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer" });
    case "ask_person_identity": {
      const other = primary?.args?.other_id ?? mentionIds[0] ?? null;
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_person_identity", knowledge_query: { concept: route.concept, entity: other ? { id: other, kind: "person", label: frame.knowledge_query?.entity?.label ?? null, non_present: true } : (frame.knowledge_query?.entity ?? null) }, semantic_intent: route.concept, requested_content: "known_concept", expected_response_shape: "brief_grounded_answer" });
    }
    case "ask_assignment_purpose": {
      // What a task/item is for, or where it goes / what is in it: the thing named in the act.
      const thing = frame.knowledge_query?.entity ?? canonicalKnowledge.resolveEntityMentions(primary?.request_text ?? "", entities).find((x) => ["task", "equipment"].includes(x.kind)) ?? null;
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_assignment_purpose", knowledge_query: { concept: "assignment_purpose", entity: thing ? { id: thing.id, kind: thing.kind, label: thing.label } : null, ...(route.facet ? { facet: route.facet } : {}) }, semantic_intent: "assignment_purpose", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer", unresolved_reference: !thing });
    }
    case "ask_entity_definition": {
      const placeId = primary?.args?.place_id ?? null;
      const item = !frame.knowledge_query?.entity && !placeId && predicate === "item.status" ? canonicalKnowledge.resolveEntityMentions(primary?.request_text ?? "", entities).find((x) => x.kind === "equipment") ?? null : null;
      const entity = frame.knowledge_query?.entity ?? (item ? { id: item.id, kind: item.kind, label: item.label } : null) ?? (placeId ? { id: placeId, kind: ["outpost-a", "equipment-staging", "async-briefing-room", "threshold-room"].includes(placeId) ? "location" : "entity", label: placeId } : null);
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_entity_definition", knowledge_query: { concept: route.concept ?? "entity_definition", entity }, semantic_intent: route.concept ?? "entity_definition", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer", unresolved_reference: !entity });
    }
    case "ask_current_action":
      if (frame.discourse_function === "ask_current_action") return Object.freeze({ ...frame, ...common });
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_current_action", knowledge_query: { concept: "current_action", entity: thirdParty ? { id: thirdParty, kind: "person", label: null } : null, subject: thirdParty ? "other" : "addressee" }, semantic_intent: "current_action", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer" });
    case "ask_institution_purpose": {
      if (frame.discourse_function === "ask_institution_purpose") return Object.freeze({ ...frame, ...common });
      const inst = entities.find((x) => x.kind === "institution") ?? null;
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_institution_purpose", knowledge_query: { concept: "institution_purpose", entity: inst ? { id: inst.id, kind: inst.kind, label: inst.label } : null }, semantic_intent: "institution_purpose", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer" });
    }
    case "ask_opinion":
      // Another person's opinion is theirs: the predicate path answers it (a report or "ask them").
      if (thirdParty) return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_predicate", knowledge_query: null, semantic_intent: predicate, requested_content: "predicate_answer", expected_response_shape: "brief_predicate_answer", expected_slot: "topic" });
      if (frame.discourse_function === "ask_opinion") return Object.freeze({ ...frame, ...common });
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_opinion", knowledge_query: null, requested_content: "own_opinion", expected_response_shape: "brief_opinion_stance" });
    case "ask_item_ownership":
      // "Who is carrying the camera?": the item's holder, whatever function the legacy reading guessed.
      // "You've got the startup materials?": a task's cargo -- its custody is who delivers it.
      if (!(frame.referents ?? []).some((r) => r.type === "equipment" && r.resolved) && frame.discourse_function !== "ask_item_ownership") {
        const task = canonicalKnowledge.resolveEntityMentions(primary?.request_text ?? "", entities).find((x) => x.kind === "task") ?? null;
        if (task) return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_assignment_purpose", knowledge_query: { concept: "assignment_purpose", entity: { id: task.id, kind: task.kind, label: task.label }, facet: "custody" }, semantic_intent: "assignment_purpose", requested_content: "known_concept", expected_response_shape: "brief_grounded_answer" });
      }
      if (frame.discourse_function === "ask_item_ownership" || !(frame.referents ?? []).some((r) => r.type === "equipment" && r.resolved)) return Object.freeze({ ...frame, ...common });
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_item_ownership", knowledge_query: null, requested_content: "item_holder", expected_response_shape: "canonical_holder_answer" });
    case "ask_role_or_assignment": {
      // "What do you do?": the addressee's own role; "What does Tonya do?": that person's (a third party).
      if (frame.discourse_function === "ask_role_or_assignment") return Object.freeze({ ...frame, ...common });
      const other = thirdParty ?? null;
      return Object.freeze({ ...frame, ...common, ...clean, discourse_function: "ask_role_or_assignment", knowledge_query: other ? { concept: "person_role", entity: { id: other, kind: "person", label: null }, subject: "other" } : { concept: "role_or_assignment", entity: null, subject: "addressee" }, requested_content: "role_and_assignment", expected_response_shape: "brief_role_statement" });
    }
    default:
      return Object.freeze({ ...frame, ...common });
  }
}

/** Owners for a registry-predicate / attention frame, by response cardinality (F2). Deterministic. */
function ownersByCardinality({ frame, recipient_type, eligible = [], spokesperson }) {
  if (!eligible.length) return [];
  const card = frame?.turn?.cardinality ?? "one_spokesperson";
  const fn = frame?.discourse_function;
  const knowers = eligible.filter((c) => c.knows_fully).length ? eligible.filter((c) => c.knows_fully) : eligible.filter((c) => c.has_relevant_knowledge);
  if (fn === "attend") return [(spokesperson(eligible) ?? eligible[0]).id];
  // About a named third person: they answer for themselves when they are among those asked.
  const subject = frame?.turn?.args?.third_party_subject ?? null;
  if (subject && eligible.some((c) => c.id === subject)) return [subject];
  if (["each_self", "each_self_concise", "each_ack"].includes(card)) {
    if (recipient_type === "group") return eligible.map((c) => c.id);
    return [(eligible.find((c) => (frame?.turn?.addressee_ids ?? []).includes(c.id)) ?? spokesperson(eligible) ?? eligible[0]).id];
  }
  if (card === "none") return [];
  // one_knower / one_spokesperson: one voice; knowledge beats rotation.
  return [(spokesperson(knowers) ?? spokesperson(eligible) ?? eligible[0]).id];
}

/**
 * "How is Tonya?" answered by Tonya herself is her own check-in: once the owner is exactly the named
 * subject, a third-person self-state question becomes that person's check-in (same predicate and
 * temporal scope). Anyone else keeps the third-party predicate path (report or honest not-knowing).
 */
function subjectCheckIn(frame, ownerIds = []) {
  const subject = frame?.turn?.args?.third_party_subject ?? null;
  const route = frame?.predicate ? registry.get(frame.predicate)?.route : null;
  if (!subject || frame.discourse_function !== "ask_predicate" || route?.fn !== "check_in" || ownerIds.length !== 1 || ownerIds[0] !== subject) return frame;
  const { third_party_subject, ...args } = frame.turn.args;
  return Object.freeze({ ...frame, discourse_function: "check_in", requested_content: null, expected_response_shape: "short_social_acknowledgment", self_state_query: { asked: route.self_state, polarity: frame.question_form === "wh" ? "open" : "yes_no" }, addressee_state: false, turn: { ...frame.turn, args, answered_by_subject: subject } });
}

/**
 * Stage G reconciliation of an accepted v2 advisory reading (D16): it may only FILL what Tier 1 left
 * incomplete -- a missing facet, a missing addressee, a missing place -- never overwrite a resolved one.
 * Every id comes from code's own candidate map; overrides are traced.
 */
/**
 * Code's plausibility check of a Tier-2 facet against the player's own words (Tier 2 classifies; code
 * validates): the facet must be askable with the line's wh-word, and a line that names an item but no
 * person is not a question about a person's attributes. An implausible facet is not filled (-> clarify).
 */
function advisoryFacetPlausible(facet, e, entities = []) {
  const text = String(e?.act?.body_expanded ?? e?.request_text ?? "").toLowerCase();
  const wh = e?.question_form === "wh" ? (text.replace(/^(?:(?:so|and|but|ok|okay|well|wait|hey)[,]?\s+)+/, "").match(/^(who|whose|what|where|when|why|how|which)\b/)?.[1] ?? null) : null;
  if (!registry.whCompatible(facet, wh)) return { ok: false, reason: "facet_wh_incompatible" };
  const mentions = canonicalKnowledge.resolveEntityMentions(text, entities);
  const namesItem = mentions.some((m) => m.kind === "equipment");
  const namesPerson = mentions.some((m) => m.kind === "person") || (e?.act?.vocatives ?? []).length > 0 || /\b(?:you|your|yourself)\b/.test(text);
  if (namesItem && !namesPerson && String(facet).startsWith("person.")) return { ok: false, reason: "facet_item_named" };
  // Tier 1 found a canonical item in the line and nothing else it could be about: a reading about a person's
  // history or the mission contradicts that evidence (a material Tier-1/Tier-2 disagreement -> clarify).
  const namesPlace = mentions.some((m) => ["location", "entity", "institution"].includes(m.kind));
  if (namesItem && !namesPlace && !/^(?:item|conversation)\./.test(String(facet)) && !mentions.some((m) => m.kind === "person")) return { ok: false, reason: "facet_contradicts_item" };
  return { ok: true };
}

// Reasons a reading never got past decoding / schema validation (fail closed; Tier 1 or a clarification).
const UNDECODED = new Set(["timeout", "provider_error", "advisory_unavailable", "malformed", "malformed_act", "malformed_confidence"]);
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
// Force cues that suggest the line ASKS (an unsettled one is clarified rather than taken as a remark).
const QUESTION_LIKE_CUES = new Set(["colloquial_declarative", "fragment", "unpunctuated_second_person", "question_mark_only"]);
/**
 * The explicit states of one Tier-2 reading against the gaps Tier 1 reported (ED-30G):
 *   decoded                 a JSON object came back in time
 *   schema_valid            every field is from the offered sets and the player's own words, confidence ok
 *   semantically_complete   it FILLS what was missing: a valid, plausible registry facet where a facet was
 *                           needed, a speech act where force was uncertain, a named addressee where a name
 *                           did not resolve -- with no field contradicting what Tier 1 is sure of
 *   accepted                = semantically complete. Anything less is NOT understanding: Tier 1 stands, or the
 *                           turn is clarified.
 */
/**
 * Deterministic compatibility of a FRAGMENT reading with the conversation (ED-30H): a short line may inherit
 * a facet only when exactly one antecedent in the DIS carries a compatible one.
 */
function fragmentAntecedents(dis) {
  const out = [];
  const last = dis?.last_substantive_request ?? dis?.last_request ?? null;
  if (last?.predicate) out.push({ source: "last_request", predicate: last.predicate, responders: last.answered_by ?? [] });
  for (const p of dis?.pending_requests ?? []) if (p?.predicate && !out.some((o) => o.predicate === p.predicate)) out.push({ source: "pending_request", predicate: p.predicate, responders: p.targets ?? [] });
  if (dis?.pending_inbound_request?.predicate) out.push({ source: "inbound", predicate: dis.pending_inbound_request.predicate, responders: [dis.pending_inbound_request.from] });
  if (dis?.activity?.template?.predicate) out.push({ source: "activity", predicate: dis.activity.template.predicate, responders: [] });
  return out;
}
function isFragmentTurn(e) { return e?.act?.force?.cue === "fragment" || String(e?.act?.body ?? e?.act?.text ?? "").replace(/[?!.]+$/, "").trim().split(/\s+/).filter(Boolean).length <= 3; }

function assessAdvisory(advice, analysis, { entities = [], dis = null } = {}) {
  const e = analysis?.primary ?? null;
  const decoded = Boolean(advice) && !UNDECODED.has(advice.reason);
  const schemaValid = Boolean(advice?.accepted) && advice?.version === "yellow-beast-dialogue-advisory@v2" && Array.isArray(advice.acts) && advice.acts.length > 0;
  // The facet-recovery record travels with the state (first-pass facet or NONE; the one second pass, if any).
  const recovery = advice && typeof advice === "object" && "facet_first_pass" in advice ? { facet_first_pass: advice.facet_first_pass ?? null, second_pass: advice.second_pass ? { ...advice.second_pass } : null } : {};
  const state = (complete, reason) => Object.freeze({ decoded, schema_valid: schemaValid, semantically_complete: complete, accepted: complete, reason, ...recovery });
  if (!advice) return state(false, "not_requested");
  if (!decoded) return state(false, advice.reason ?? "undecoded");
  if (!schemaValid) return state(false, advice.reason ?? "schema_invalid");
  if (!e) return state(false, "no_turn");
  const act = advice.acts.at(-1);
  const gaps = new Set(Array.isArray(advice.tier1_missing) ? advice.tier1_missing : []);
  const forceUncertain = gaps.has("force_uncertain") || gaps.has("fragment_unresolved") || gaps.has("context_uncertain");
  // What the reading says the line IS, where Tier 1 was not sure; where Tier 1 was sure, it must agree.
  const readsAsking = ASKING.has(act.speech_act);
  if (!forceUncertain && ASKING.has(e.speech_act) && !readsAsking && e.act?.force?.confidence === "certain") return state(false, "contradictory_speech_act");
  const willAsk = forceUncertain ? readsAsking : ASKING.has(e.speech_act);
  const needsFacet = willAsk && !e.predicate && (gaps.has("facet_unresolved") || gaps.has("facet_unresolved_referent") || forceUncertain);
  if (needsFacet) {
    if (!act.facet) return state(false, "missing_facet");
    if (!registry.get(act.facet)) return state(false, "invalid_facet");
    const plausible = advisoryFacetPlausible(act.facet, e, entities);
    if (!plausible.ok) return state(false, `incompatible_facet:${plausible.reason}`);
  }
  if ((gaps.has("name_unresolved") || gaps.has("second_person_no_target")) && !act.addressee_id && !["all", "each", "any"].includes(act.quantifier)) return state(false, "unresolved_addressee");
  // A weak Tier-1 facet may only be settled by choosing one of the competing candidates.
  if (gaps.has("facet_weak") && act.facet && !(e.act?.predicate_candidates ?? []).some((x) => x.id === act.facet)) return state(false, "incompatible_facet:not_a_candidate");
  // A fragment read as continuing the conversation must fit exactly ONE antecedent.
  if (dis && isFragmentTurn(e) && ["continuation", "repair", "answer"].includes(act.discourse_relation) && act.facet && !String(act.facet).startsWith("conversation.") && !e.predicate) {
    const compatible = fragmentAntecedents(dis).filter((a) => a.predicate === act.facet || (registry.get(a.predicate)?.neighbors ?? []).includes(act.facet));
    if (!compatible.length) return state(false, "no_compatible_antecedent");
    if (new Set(compatible.map((a) => a.predicate)).size > 1) return state(false, "ambiguous_antecedent");
  }
  if (act.discourse_relation === "repair" && !["repair"].includes(e.speech_act) && !e.relation_target && !analysis?.dis_has_request) { /* a repair of nothing is not filled by the reading */ }
  return state(true, "complete");
}

function applyAdvisory(analysis, advice, { present = [], entities = [], dis = null } = {}) {
  if (!analysis?.primary) return analysis;
  const assessment = assessAdvisory(advice, analysis, { entities, dis });
  if (!assessment.accepted) return Object.freeze({ ...analysis, advisory: { applied: false, state: assessment } });
  const e = { ...analysis.primary, overrides: [...(analysis.primary.overrides ?? [])] };
  const act = advice.acts.at(-1);
  const presentIds = present.map((p) => p.id);
  // With the Tier-1 gaps known, a reading fills ONLY those gaps (an untargeted question is not missing an
  // addressee; a question the legacy frame typed is not missing a facet).
  const gaps = Array.isArray(advice.tier1_missing) ? new Set(advice.tier1_missing) : null;
  const may = (...reasons) => !gaps || reasons.some((r) => gaps.has(r));
  // Where Tier 1 could not tell whether the line asks, the (complete) reading says: asked, or a remark.
  if (gaps?.has("force_uncertain") || gaps?.has("fragment_unresolved")) {
    // A stretched or chat-form social act the reading recognises ("catch y'all at staging").
    if (["greeting", "farewell", "thanks", "self_introduction", "social_acknowledgment"].includes(act.speech_act) && !ASKING.has(e.speech_act)) { e.speech_act = act.speech_act; e.predicate = null; e.overrides.push({ field: "speech_act", to: act.speech_act, reason: "advisory_resolved_force" }); }
    if (ASKING.has(act.speech_act) && !ASKING.has(e.speech_act)) { e.speech_act = act.speech_act === "request" ? "request" : "question"; e.question_form = e.question_form ?? "declarative"; e.overrides.push({ field: "speech_act", to: e.speech_act, reason: "advisory_resolved_force" }); }
    else if (!ASKING.has(act.speech_act) && ASKING.has(e.speech_act)) { e.speech_act = act.speech_act === "sarcasm" ? "sarcasm" : "statement"; e.question_form = null; e.predicate = null; e.overrides.push({ field: "speech_act", to: e.speech_act, reason: "advisory_resolved_force" }); }
  }
  if (!may("facet_unresolved", "facet_unresolved_referent", "force_uncertain", "context_uncertain", "facet_weak", "fragment_unresolved", "name_unresolved", "second_person_no_target")) return Object.freeze({ ...analysis, advisory: { applied: false, state: assessment } });
  // A weak facet settled by the reading (one of Tier 1's own competing candidates).
  if (gaps?.has("facet_weak") && act.facet && (e.act?.predicate_candidates ?? []).some((x) => x.id === act.facet) && e.predicate !== act.facet) { e.overrides.push({ field: "predicate", from: e.predicate, to: act.facet, reason: "advisory_settled_weak_facet" }); e.predicate = act.facet; e.facet_source = "tier2_advisory"; }
  // A statement made while a coworker's question is pending: the reading says whether it answers it.
  if (gaps?.has("context_uncertain") && act.speech_act === "answer" && dis?.pending_inbound_request?.from && presentIds.includes(dis.pending_inbound_request.from)) { e.speech_act = "answer"; e.relation = "answer"; e.predicate = null; e.addressee = { kind: "inherited", ids: [dis.pending_inbound_request.from], quantifier: null, source: "open_question_answer" }; }
  const plausible = act.facet ? advisoryFacetPlausible(act.facet, e, entities) : { ok: false };
  if (act.facet && !plausible.ok) e.overrides.push({ field: "predicate", to: act.facet, reason: `advisory_rejected_${plausible.reason}` });
  if (!e.predicate && ASKING.has(e.speech_act) && act.facet && registry.get(act.facet) && plausible.ok && may("facet_unresolved", "facet_unresolved_referent", "force_uncertain")) {
    e.predicate = act.facet; e.facet_source = "tier2_advisory"; e.overrides.push({ field: "predicate", to: act.facet, reason: "advisory_filled_missing_facet" });
    // The facet's canonical time frame (what its plain phrasing asks: "How are you?" -> now), unless the
    // line itself said one.
    const entry = registry.get(act.facet);
    if (!e.temporal_scope) {
      // The most common time frame of the facet's own phrasings (none counts too): wellbeing -> now.
      const counts = new Map();
      for (const cue of entry.cues ?? []) counts.set(cue.temporal ?? null, (counts.get(cue.temporal ?? null) ?? 0) + 1);
      const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      e.temporal_scope = entry.default_temporal ?? modal;
    }
  }
  if (!(e.addressee?.ids ?? []).length && act.addressee_id && presentIds.includes(act.addressee_id) && may("name_unresolved", "second_person_no_target")) { e.addressee = { kind: "explicit", ids: [act.addressee_id], quantifier: null, source: "advisory_candidate" }; e.overrides.push({ field: "addressee", to: act.addressee_id, reason: "advisory_filled_missing_addressee" }); }
  if (!(e.addressee?.ids ?? []).length && ["all", "each", "any"].includes(act.quantifier) && e.predicate && may("name_unresolved", "second_person_no_target")) { e.addressee = { kind: "group", ids: presentIds, quantifier: act.quantifier === "any" ? "any" : "all", source: "advisory_quantifier" }; }
  const entry = e.predicate ? registry.get(e.predicate) : null;
  if (entry?.slots?.place && !e.args?.place_id && act.referent_id && may("place_unresolved", "deixis_unresolved")) e.args = { ...(e.args ?? {}), place_id: act.referent_id, place_basis: "advisory_candidate" };
  if (e.clarify && e.predicate && (e.addressee?.ids ?? []).length && !["quantifier_mismatch", "repair_target_unresolved", "misunderstood", "referent_repair_mismatch", "ellipsis_meta_not_transferable"].includes(e.clarify.reason)) { e.overrides.push({ field: "clarify", from: e.clarify.reason, reason: "advisory_completed" }); e.clarify = null; }
  if (e.addressee) e.cardinality = cardinalityFor(e.predicate, e.addressee, e);
  // What a complete reading settled (the contract then has positive evidence for those fields).
  e.advisory_filled = [...new Set([...(e.advisory_filled ?? []), "force", "fragment", "context", ...(e.predicate ? ["facet"] : []), ...((e.addressee?.ids ?? []).length || act.speech_act === "statement" ? ["addressee"] : [])])];
  const effective = [...analysis.effective.slice(0, -1), e];
  return Object.freeze({ ...analysis, effective, primary: e, advisory: { applied: true, acts: advice.acts.length, state: assessment } });
}

/**
 * The Tier-2 gate (D14): Tier 1 may skip the bounded advisory only when the turn is COMPLETE, not merely
 * confident. Returns whether a reading is needed and, if so, the v2 request (surface text, opaque candidate
 * labels, registry facets with their glosses -- never ids or facts). The production service and the
 * end-to-end evaluator both call this, so the measured path is the shipped path.
 */
/**
 * The Tier-1 completeness / confidence contract (ED-30H). "Tier 1 produced a frame" is not "Tier 1 is
 * semantically complete": every field a substantive turn needs is checked and the verdict says WHY.
 *   speech act   certain / likely / uncertain force
 *   facet        resolved (and by what), weak (competing facets), or unresolved
 *   addressee    resolved, untargeted (legitimately), or unresolved
 *   relation     resolved, or an ellipsis / repair with no antecedent
 *   referent     every named thing resolved
 *   fragment     a short line that resolved to nothing in the conversation
 * Tier 2 is required only for gaps it can fill (force, facet, a name); an unresolved referent or antecedent is
 * clarified by code, never guessed.
 */
function tier1Contract(analysis, frame, completeness = null, { dis = null } = {}) {
  const e = analysis?.primary ?? null;
  const c = completeness ?? completenessWithFrame(analysis, frame, e);
  const reasons = [];
  const push = (field, status, why) => reasons.push({ field, status, why });
  const force = e?.act?.force ?? null;
  push("speech_act", force?.confidence === "uncertain" && e?.speech_act !== "answer" ? "uncertain" : "resolved", `${e?.speech_act ?? "none"}:${force?.cue ?? "n/a"}`);
  const asking = ["question", "request", "elliptical_continuation", "repair", "attention_call"].includes(e?.speech_act);
  const cands = e?.act?.predicate_candidates ?? [];
  const competing = cands.length >= 2 && new Set(cands.slice(0, 2).map((x) => String(x.id).split(".")[0])).size === 2 && registry.get(cands[0].id)?.priority === registry.get(cands[1].id)?.priority && !e?.facet_source?.match(/item_role|discourse_followup|surface_anchor|inbound_counter/);
  if (!asking) push("facet", "not_needed", e?.speech_act ?? "none");
  else if (e?.predicate) push("facet", competing ? "weak" : "resolved", competing ? `competing:${cands.slice(0, 2).map((x) => x.id).join("|")}` : `${e.predicate}:${e.facet_source ?? "legacy"}`);
  else if ((c.missing ?? []).includes("facet_unresolved_referent")) push("facet", "unresolved", "facet_unresolved_referent");
  else if ((c.missing ?? []).includes("facet_unresolved")) push("facet", "unresolved", "facet_unresolved");
  // Positive evidence only: a legacy route counts when it names a specific function, never the generic
  // "ask something" / "unclear reference" fallbacks.
  else if (["ambiguous_reference", "ask_factual"].includes(frame?.discourse_function) && e?.speech_act !== "attention_call") push("facet", "unresolved", `no_positive_evidence:${frame.discourse_function}`);
  else push("facet", "resolved", `legacy:${frame?.discourse_function ?? "none"}`);
  const ids = e?.addressee?.ids ?? [];
  if ((c.missing ?? []).some((m) => ["name_unresolved", "second_person_no_target", "ellipsis_target_unresolved", "repair_target_unresolved"].includes(m))) push("addressee", "unresolved", c.missing.find((m) => /name|target/.test(m)));
  else push("addressee", "resolved", ids.length ? `${e?.addressee?.kind}:${e?.addressee?.source}` : "untargeted");
  if ((c.missing ?? []).some((m) => /no_antecedent|repair_no_target|meta_not_transferable/.test(m))) push("relation", "unresolved", c.missing.find((m) => /antecedent|no_target|transferable/.test(m)));
  else push("relation", "resolved", e?.relation ?? "new");
  if ((frame?.referents ?? []).some((r) => r.resolved === false) || e?.clarify?.reason?.startsWith("referent")) push("referent", "unresolved", e?.clarify?.reason ?? "referent_unresolved");
  if (force?.cue === "fragment" && !e?.predicate && e?.relation === "new" && e?.speech_act !== "answer") push("fragment", "unresolved", "fragment_without_antecedent");
  if (dis?.pending_inbound_request && dis.pending_inbound_request.kind !== "attention" && e?.speech_act === "statement") push("context", "uncertain", "statement_while_question_pending");
  const tier2For = reasons.filter((r) => ["uncertain", "weak"].includes(r.status) || (r.status === "unresolved" && ["facet", "addressee", "fragment"].includes(r.field)));
  const blocking = reasons.filter((r) => r.status !== "resolved" && r.status !== "not_needed");
  return Object.freeze({
    tier1_frame: { speech_act: e?.speech_act ?? null, predicate: e?.predicate ?? null, fn: frame?.discourse_function ?? null, addressee: ids, relation: e?.relation ?? null },
    tier1_complete: blocking.length === 0,
    tier1_confidence_reasons: reasons,
    tier2_required: tier2For.length > 0,
    tier2_reason: tier2For.length ? tier2For.map((r) => `${r.field}:${r.status}:${r.why}`).join("; ") : null,
    missing: [...new Set([...(c.missing ?? []), ...tier2For.filter((r) => ["facet:weak", "context:uncertain", "fragment:unresolved"].includes(`${r.field}:${r.status}`)).map((r) => `${r.field}_${r.status}`)])]
  });
}

function advisoryGate({ message, analysis, frame, completeness, present = [], entities = [], recent = [], dis = null }) {
  const contract = tier1Contract(analysis, frame, completeness, { dis });
  const needed = contract.tier2_required;
  if (!needed) return { needed: false, v2: null, contract };
  const candidates = advisoryCandidates(present, entities);
  // Whether this turn REQUIRES a facet from the reading (facet unresolved / weak, an unresolved fragment, or
  // question-like uncertainty): then the facet is the primary output and one recovery pass is allowed.
  const e = analysis?.primary ?? null;
  const needsFacet = (contract.missing ?? []).some((m) => ["facet_unresolved", "facet_unresolved_referent", "facet_weak", "fragment_unresolved"].includes(m)) || ((contract.missing ?? []).includes("force_uncertain") && QUESTION_LIKE_CUES.has(e?.act?.force?.cue));
  return { needed: true, contract, v2: { needs_facet: needsFacet, utterance: message, repaired: analysis?.normalized?.repaired ?? null, recent, people: candidates.people, referents: candidates.referents, facets: candidates.facets, facet_guide: registry.advisoryFacetGuide(), context: advisoryContext(analysis, dis, candidates) } };
}

/**
 * The compact, structured conversation state a fragment needs to be read (ED-30H): facets and opaque person
 * labels only -- never transcript prose, never facts. "since when" means something only against the
 * question just answered.
 */
function advisoryContext(analysis, dis, candidates) {
  const label = (id) => candidates.people.find((p) => p.id === id)?.label ?? null;
  const last = dis?.last_substantive_request ?? dis?.last_request ?? null;
  const pending = dis?.pending_requests?.at(-1) ?? null;
  const inbound = dis?.pending_inbound_request ?? null;
  const ctx = {
    last_question: last?.predicate ? { facet: last.predicate, answered_by: (last.answered_by ?? []).map(label).filter(Boolean) } : null,
    pending_player_question: pending?.predicate ? { facet: pending.predicate } : null,
    coworker_asked_player: inbound && inbound.kind !== "attention" ? { by: label(inbound.from), facet: inbound.predicate ?? null } : null,
    activity: dis?.activity?.kind ?? null
  };
  return Object.values(ctx).some(Boolean) ? ctx : null;
}

/** Scene candidates for the advisory (opaque labels -> ids; code owns the mapping). */
function advisoryCandidates(present = [], entities = []) {
  const people = present.map((p, i) => ({ label: `p${i + 1}`, id: p.id, name: p.name, names: p.names ?? [p.name] }));
  const places = entities.filter((e) => ["entity", "location"].includes(e.kind) && ["complex", "outpost-a", "threshold", "equipment-staging", "standard"].includes(e.id));
  const items = entities.filter((e) => e.kind === "equipment");
  const referents = [...places, ...items].slice(0, 12).map((e, i) => ({ label: `r${i + 1}`, id: e.id, name: e.label }));
  return { people, referents, facets: registry.advisoryFacets() };
}

/** A bounded, serializable record of the analysis for the interaction and the dev trace. */
function turnRecord(analysis, { frame = null, request_ids = [], completeness = null, contract = null } = {}) {
  if (!analysis) return null;
  const e = analysis.primary;
  return {
    version: TURN_VERSION,
    raw: analysis.normalized.raw,
    normalized: analysis.normalized.repaired,
    repairs_applied: analysis.normalized.repairs.map((r) => `${r.kind}:${r.from}>${r.to}`),
    clauses: analysis.acts.map((a) => ({ text: a.text, speech_act: a.speech_act, question_form: a.question_form, markers: a.markers, vocatives: a.vocatives.map((v) => v.id ?? v.name), mentions: a.mentions.map((m) => m.id ?? m.name), predicate_candidates: a.predicate_candidates.map((c) => c.id), repair: a.repair?.kind ?? null, ellipsis: a.ellipsis?.kind ?? null, quantifier: a.quantifier?.kind ?? null, temporal: a.temporal_scope ?? null, polarity: a.polarity ?? null, indirect: a.indirect ? a.indirect.wrapper : null, chat_normalization: a.normalization ? { semantic: a.normalization.semantic, removed: a.normalization.removed.map((r) => ({ kind: r.kind, text: r.text })) } : null })),
    primary: e ? { speech_act: e.speech_act, question_form: e.question_form, relation: e.relation, relation_target: e.relation_target, reissue_of: e.reissue_of, predicate: frame?.predicate ?? e.predicate, request_text: e.request_text, addressee: e.addressee ? { kind: e.addressee.kind, ids: [...e.addressee.ids], quantifier: e.addressee.quantifier, source: e.addressee.source } : null, cardinality: e.cardinality, temporal_scope: e.temporal_scope, alternatives: e.alternatives, args: e.args, clarify: e.clarify, repair: e.repair ?? null } : null,
    extra_acts: analysis.effective.slice(0, -1).map((x) => ({ speech_act: x.speech_act, predicate: x.predicate, request_text: x.request_text })),
    closes_activity: analysis.closes_activity,
    completeness: completeness ?? analysis.completeness,
    advisory_state: analysis.advisory?.state ? { ...analysis.advisory.state } : null,
    // The Tier-1 completeness contract (developer trace): why Tier 1 was, or was not, sufficient.
    ...(contract ? { tier1_frame: { ...contract.tier1_frame, addressee: [...contract.tier1_frame.addressee] }, tier1_complete: contract.tier1_complete, tier1_confidence_reasons: contract.tier1_confidence_reasons.map((r) => ({ ...r })), tier2_required: contract.tier2_required, tier2_reason: contract.tier2_reason } : {}),
    request_ids: [...request_ids],
    dropped: [...analysis.dropped]
  };
}

module.exports = { advisoryContext, fragmentAntecedents, tier1Contract, itemRole, assessAdvisory, advisoryGate, advisoryFacetPlausible, TURN_VERSION, analyzeTurn, completenessWithFrame, reconcile, resolveAddressee, peopleIndex, placeOf, cardinalityFor, STRUCTURAL_KEEP, withSalience, addressFromTurn, argsFor, finalizeFrame, subjectCheckIn, ownersByCardinality, turnRecord, applyAdvisory, advisoryCandidates };
