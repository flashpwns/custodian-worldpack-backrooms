"use strict";

// Stage A of the LOCAL turn pipeline: NORMALIZE (ED-30).
//
// The player's raw line is never altered: it stays the canonical utterance. Normalization produces two
// separate WORKING texts plus a token map back to raw character spans:
//
//   repaired  -- the line with typing damage fixed (missing apostrophes, "were" meaning "we're", slang,
//                repeated punctuation, closed-vocabulary typos in names/cue words). Case is kept so the
//                legacy frame builder (which reads sentence structure) sees an ordinary English line.
//   expanded  -- `repaired`, lowercased, with contractions expanded ("you've" -> "you have"). The
//                Semantic Registry's lexical cues are written against this form.
//
// Typo repair only ever maps onto a CLOSED vocabulary (present people's names, canonical entity names,
// registry cue words) and only when exactly one candidate is nearest. An ambiguous repair is not guessed:
// the token stays as typed and the ambiguity is reported (the completeness gate then clarifies).
// Nothing here consults a model, the world, or who is present beyond the supplied vocabulary.

const NORMALIZE_VERSION = "yellow-beast-dialogue-normalize@v1";

// ─── bounded optimal-string-alignment (Damerau-Levenshtein) distance ─────────────────────────────────
function editDistance(a, b, max = 3) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (Math.abs(s.length - t.length) > max) return max + 1;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) d[i][0] = i;
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[rows - 1][cols - 1];
}

// Missing-apostrophe contractions (unambiguous in conversational input). "its", "id", "wed", "ill", "well",
// "were", "hell" and "shell" are real words and are never touched here ("were" has its own syntactic rule).
const APOSTROPHE = Object.freeze({
  im: "I'm", ive: "I've", youve: "you've", weve: "we've", theyve: "they've", youre: "you're", theyre: "they're",
  youll: "you'll", theyll: "they'll", youd: "you'd", theyd: "they'd", dont: "don't", doesnt: "doesn't",
  didnt: "didn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", havent: "haven't",
  hasnt: "hasn't", hadnt: "hadn't", cant: "can't", couldnt: "couldn't", wouldnt: "wouldn't",
  shouldnt: "shouldn't", wont: "won't", thats: "that's", whats: "what's", wheres: "where's", whos: "who's",
  hows: "how's", theres: "there's", heres: "here's", shes: "she's", hes: "he's", whatre: "what're",
  whered: "where'd", howd: "how'd", yall: "y'all", aint: "ain't", lets: "let's", everyones: "everyone's",
  everybodys: "everybody's", anyones: "anyone's", nobodys: "nobody's", someones: "someone's"
});
// Conversational slang / chat abbreviations -> ordinary words (a phrase may map to several words).
const SLANG = Object.freeze({
  gonna: "going to", wanna: "want to", gotta: "got to", u: "you", ur: "your", ya: "you", yah: "yeah",
  r: "are", pls: "please", plz: "please", thx: "thanks", ty: "thank you", whatcha: "what are you",
  dunno: "don't know", lemme: "let me", gimme: "give me", kinda: "kind of", sorta: "sort of",
  cuz: "because", cos: "because", coz: "because", "'cause": "because", tho: "though", ok: "okay", k: "okay",
  imma: "I'm going to", yup: "yep", nah: "no", ppl: "people", abt: "about", rn: "right now", w: "with",
  q: "question", b4: "before", urself: "yourself", ursel: "yourself", wat: "what", wut: "what", wot: "what", whens: "when's", whys: "why's",
  tmrw: "tomorrow", bc: "because", idk: "I don't know", nvm: "never mind", brb: "be right back"
});
// Frequent keyboard typos of function words (a fixed list: open-text words are never fuzzily "corrected").
const COMMON_TYPOS = Object.freeze({ teh: "the", hte: "the", taht: "that", thta: "that", waht: "what", whta: "what", yuo: "you", yoiu: "you", jsut: "just", adn: "and", abotu: "about", abuot: "about", baout: "about", whre: "where", wehre: "where", tehre: "there", thier: "their", becuase: "because", beacuse: "because", knwo: "know", konw: "know", cna: "can", wiht: "with", yourslef: "yourself", yourelf: "yourself", youself: "yourself", yoruself: "yourself", hwo: "how", hoe: "how", ot: "to", fo: "of", si: "is", ti: "it", aer: "are", evryone: "everyone", everone: "everyone", evreyone: "everyone", anyoen: "anyone", somethign: "something", tomorow: "tomorrow", firts: "first", frist: "first", befor: "before", beofre: "before" });
// Words after which a bare "were" is the contraction "we're" (it cannot be a verb: no subject precedes it).
const WERE_LEAD = new Set(["", "where", "what", "when", "why", "how", "who", "which", "if", "that", "because", "cause", "and", "but", "so", "is", "think", "know", "guess", "hope", "wonder", "whether", "while", "until", "before", "after", "like", "since", "maybe", "okay", "ok", "well", "now", "then", "once", "unless", "though", "sure", "whatever", "wherever", "whenever", "cool", "alright", "right", "yeah", "yes", "no"]);
// ...and what follows it reads as a progressive / predicate of "we are".
const WERE_FOLLOW = /^(?:all|gonna|going|supposed|about|ready|here|there|in|done|good|fine|not|headed|heading|leaving|meant|expected|stuck|late|early|actually|really|just|still|even|both|getting|doing|walking|waiting|looking|working|staying|coming|taking|bringing|carrying|told|allowed|off|on|at|out|almost|nearly|so|pretty|kind|meeting|starting|splitting)$/i;

// Frequent English words that closed-vocabulary typo repair must never "correct" (the vocabulary is tiny,
// so this list only needs to cover words within edit distance of names and cue words).
const PROTECTED_WORDS = new Set("a about above after again all also am an and any anyone are around as ask at be been before being both but by call came can come coming could day did do does doing done down each else even ever every everyone for from get go going gone good got had has have having he her here hers him his how i if in inside into is it its just know last let like local long look made make many may me mean meant met might more morning most much must my new next no nor not now of off on once one only or other our out over own place ready right said same say see seen she should so some still such take team tell than that the their them then there these they thing think this those though time to today told tone too took under up us very vocal want was way we well went were what when where which while who why will with work would yes yet you your yours".split(" "));

// A word may end in ONE digit ("b4", "2nite"-style chat forms are then mapped by SLANG); numbers stand alone.
const WORD = /@?[A-Za-z][A-Za-z'’]*(?:\d(?!\d))?|\d+(?::\d+)?|[^\sA-Za-z\d]/g;

/** Contractions expanded for the registry's lexical cues (lowercase input). Possessive "'s" is kept. */
const EXPAND = [
  [/\bi'm\b/g, "i am"], [/\byou're\b/g, "you are"], [/\bwe're\b/g, "we are"], [/\bthey're\b/g, "they are"],
  [/\bwhat're\b/g, "what are"], [/\bi've\b/g, "i have"], [/\byou've\b/g, "you have"], [/\bwe've\b/g, "we have"],
  [/\bthey've\b/g, "they have"], [/\bi'll\b/g, "i will"], [/\byou'll\b/g, "you will"], [/\bwe'll\b/g, "we will"],
  [/\bthey'll\b/g, "they will"], [/\bi'd\b/g, "i would"], [/\byou'd\b/g, "you would"], [/\bwe'd\b/g, "we would"],
  [/\bthey'd\b/g, "they would"], [/\bcan't\b/g, "can not"], [/\bwon't\b/g, "will not"], [/\bain't\b/g, "is not"],
  [/\b(\w+)n't\b/g, "$1 not"], [/\blet's\b/g, "let us"], [/\by'all\b/g, "you all"],
  [/\b(it|that|what|where|when|why|who|how|there|here|she|he|everyone|everybody|anyone|nobody|someone|this)'s\b/g, "$1 is"],
  [/\b(where|how|who|what)'d\b/g, "$1 did"]
];

function expandContractions(lower) {
  let out = lower.replace(/[’‘]/g, "'");
  for (const [pattern, replacement] of EXPAND) out = out.replace(pattern, replacement);
  return out;
}

/**
 * A name's "'s" followed by a predicate is "is"/"has" ("Tonya's doing alright" -> "tonya is doing
 * alright", "Tonya's been in" -> "tonya has been in"); otherwise it stays possessive ("Tonya's job").
 */
function expandNameClitics(text, names = []) {
  let out = text;
  for (const name of names) {
    const n = String(name).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b(${n})'s\\s+(been|got)\\b`, "g"), "$1 has $2");
    out = out.replace(new RegExp(`\\b(${n})'s\\s+(?=(?:\\w+ing|new|fine|okay|ok|alright|all right|good|here|there|not|also|too|still|just|probably|ready|nervous|excited|tired|scared|worried|a|an|the|with|on|in|from|from|first)\\b)`, "g"), "$1 is ");
  }
  return out;
}

/**
 * Normalize one player line.
 * @param {string} raw the canonical player line (never modified)
 * @param {{ vocabulary?: string[], names?: string[] }} opts closed vocabulary for typo repair
 * @returns {{ version, raw, repaired, expanded, tokens, repairs, ambiguous_repairs }}
 */
function normalizeUtterance(raw, { vocabulary = [], names = [], protect = [] } = {}) {
  const source = String(raw ?? "");
  const vocab = [...new Set([...(names ?? []), ...(vocabulary ?? [])].map((v) => String(v).toLowerCase()).filter((v) => v.length >= 4))];
  // Words that are themselves canonical vocabulary (item nouns, place words) are never "repaired".
  const protectedWords = new Set([...vocab, ...(protect ?? []).map((v) => String(v).toLowerCase())]);
  const nameSet = new Set((names ?? []).map((n) => String(n).toLowerCase()));
  const repairs = [];
  const ambiguous = [];
  const tokens = [];
  for (const match of source.matchAll(WORD)) tokens.push({ raw: match[0], start: match.index, end: match.index + match[0].length });

  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    let text = tok.raw.replace(/’/g, "'");
    const lower = text.toLowerCase();
    const prevWord = (() => { for (let k = out.length - 1; k >= 0; k -= 1) { if (/^[A-Za-z]/.test(out[k].text)) return out[k].text.toLowerCase(); if (/[.?!,;:]/.test(out[k].text)) return ""; } return ""; })();
    const next = tokens[i + 1]?.raw?.toLowerCase() ?? "";
    // Repeated punctuation collapses ("??" -> "?", "!!!" -> "!", "...." -> "...").
    if (/^[?!]$/.test(text) && out.length && out.at(-1).text === text && out.at(-1).raw_end === tok.start) { out.at(-1).raw_end = tok.end; continue; }
    if (APOSTROPHE[lower]) {
      let fixed = APOSTROPHE[lower];
      // "lets" is "let's" only as a suggestion ("lets go"), not "he lets us".
      if (lower === "lets" && prevWord && !["okay", "ok", "alright", "so", "well", "then", "now", "and"].includes(prevWord)) fixed = text;
      // "hes"/"shes" only before a predicate; "wont" only before a verb-ish word.
      if (fixed !== text) { repairs.push({ kind: "apostrophe", from: text, to: fixed, at: tok.start }); text = /^[A-Z]/.test(text) && !/^I/.test(fixed) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed; }
    } else if (lower === "were" && WERE_LEAD.has(prevWord) && WERE_FOLLOW.test(next)) {
      // "where were going" / "whatever it is were actually supposed to do": no subject precedes "were".
      repairs.push({ kind: "were_to_we_are", from: text, to: "we're", at: tok.start });
      text = /^W/.test(text) ? "We're" : "we're";
    } else if (/s$/.test(lower) && !nameSet.has(lower) && nameSet.has(lower.slice(0, -1)) && lower.length > 3) {
      // A known name typed with a bare possessive "s" ("tonyas first day") is that name's possessive.
      const name = lower.slice(0, -1);
      const fixed = `${name.charAt(0).toUpperCase()}${name.slice(1)}'s`;
      repairs.push({ kind: "name_possessive", from: text, to: fixed, at: tok.start });
      text = fixed;
    } else if (COMMON_TYPOS[lower]) {
      repairs.push({ kind: "common_typo", from: text, to: COMMON_TYPOS[lower], at: tok.start });
      text = /^[A-Z]/.test(text) ? COMMON_TYPOS[lower].charAt(0).toUpperCase() + COMMON_TYPOS[lower].slice(1) : COMMON_TYPOS[lower];
    } else if (SLANG[lower] && !(lower === "u" && /^[.:]/.test(next)) && !(lower === "w" && next !== "" && /^[/]/.test(next))) {
      // "ok" is ordinary; everything else is expanded to plain words.
      if (lower !== "ok" && lower !== "k") repairs.push({ kind: "slang", from: text, to: SLANG[lower], at: tok.start });
      text = SLANG[lower];
    } else if (/^[A-Za-z]{4,}$/.test(text) && !PROTECTED_WORDS.has(lower) && vocab.length && !protectedWords.has(lower) && !protectedWords.has(lower.replace(/(?:es|s|ed|ing)$/, ""))) {
      // Closed-vocabulary typo repair: nearest single candidate within 1 edit (<= 5 letters) or 2 edits,
      // and never across a different first letter ("camera" is not a typo of "Tamara").
      const limit = lower.length <= 5 ? 1 : 2;
      let best = Infinity;
      let hits = [];
      for (const word of vocab) {
        // An inflection of a word ("lights" / "light") is that word, not a typo of another.
        if (Math.abs(word.length - lower.length) > limit || word[0] !== lower[0] || lower.startsWith(word) || word.startsWith(lower)) continue;
        // A well-formed English inflection ("staying", "carried", "slowly") is a real word, not a typo of a
        // canonical term ("staging"); only NAMES are repaired across such a shape (review N5).
        if (!nameSet.has(word) && /(?:ing|ed|ly|ies)$/.test(lower)) continue;
        const dist = editDistance(lower, word, limit);
        if (dist > limit) continue;
        if (dist < best) { best = dist; hits = [word]; } else if (dist === best) hits.push(word);
      }
      if (hits.length === 1) {
        const word = hits[0];
        const cased = nameSet.has(word) || /^[A-Z]/.test(text) ? word.charAt(0).toUpperCase() + word.slice(1) : word;
        repairs.push({ kind: "closed_vocabulary", from: text, to: cased, at: tok.start, distance: best });
        text = cased;
      } else if (hits.length > 1) {
        ambiguous.push({ token: text, at: tok.start, candidates: hits.slice(0, 4) });
      }
    }
    out.push({ text, raw_start: tok.start, raw_end: tok.end, raw: tok.raw });
  }
  // A known name typed in lowercase is still that name ("tonya tell me" -> "Tonya tell me").
  for (const item of out) if (nameSet.has(item.text.toLowerCase()) && /^[a-z]/.test(item.text)) item.text = item.text.charAt(0).toUpperCase() + item.text.slice(1);

  // Re-join: no space before closing punctuation / after opening quotes.
  // Straight double quotes alternate open/close: an opening quote takes a space before it and none after.
  let repaired = "";
  let quoteOpen = false;
  for (const [index, item] of out.entries()) {
    const prev = out[index - 1];
    const isQuote = item.text === '"';
    const opening = isQuote && !quoteOpen;
    const prevOpening = prev && prev.opening_quote;
    const glue = !prev ? "" : opening ? " " : prevOpening || /^[.,?!;:)”’]$/.test(item.text) || (isQuote && !opening) || /^['’]/.test(item.text) || /^[“(]$/.test(prev.text) ? "" : " ";
    if (isQuote) { item.opening_quote = opening; quoteOpen = !quoteOpen; }
    item.start = repaired.length + glue.length;
    repaired += glue + item.text;
    item.end = repaired.length;
  }
  repaired = repaired.replace(/\.{4,}/g, "...").trim();
  const lower = repaired.toLowerCase();
  const expanded = expandNameClitics(expandContractions(lower), names ?? []);
  return Object.freeze({
    version: NORMALIZE_VERSION,
    raw: source,
    repaired,
    expanded,
    tokens: out.map((item) => Object.freeze({ text: item.text, start: item.start, end: item.end, raw_start: item.raw_start, raw_end: item.raw_end })),
    repairs: Object.freeze(repairs),
    ambiguous_repairs: Object.freeze(ambiguous)
  });
}

/** Maps a span of the REPAIRED text back onto the raw line (for traces and advisory span validation). */
function rawSpanOf(normalized, start, end) {
  const covered = (normalized?.tokens ?? []).filter((t) => t.end > start && t.start < end);
  if (!covered.length) return null;
  return { start: covered[0].raw_start, end: covered.at(-1).raw_end, text: normalized.raw.slice(covered[0].raw_start, covered.at(-1).raw_end) };
}

/** Does `span` occur in the player's own line (raw or repaired), case-insensitively? */
function spanInUtterance(span, normalized) {
  const s = String(span ?? "").trim().toLowerCase();
  if (!s) return false;
  const raw = String(normalized?.raw ?? "").toLowerCase().replace(/[’‘]/g, "'");
  const repaired = String(normalized?.repaired ?? "").toLowerCase();
  return raw.includes(s) || repaired.includes(s) || String(normalized?.expanded ?? "").includes(s);
}

module.exports = { COMMON_TYPOS, NORMALIZE_VERSION, normalizeUtterance, expandContractions, expandNameClitics, editDistance, rawSpanOf, spanInUtterance, APOSTROPHE, SLANG };
