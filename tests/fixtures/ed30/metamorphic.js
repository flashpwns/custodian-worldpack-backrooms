"use strict";

// ED-30 J5 meaning-preserving transformations. Each takes an utterance and returns a variant (or null when
// the transformation does not apply). The labels of a variant must equal the labels of the original.

const N = require("../../../tools/dialogue-normalize");
const NAMES = ["Giselle", "Malcolm", "Tonya"];
const QUESTION_LEAD = /^(?:(?:[A-Z][a-z]+),\s*)?(?:who|what|where|when|why|how|which|is|are|was|were|do|does|did|have|has|can|could|will|would|should)\b/i;
const CONTRACTIONS = [[/\bwhat's\b/gi, "what is"], [/\bhow's\b/gi, "how is"], [/\bwho's\b/gi, "who is"], [/\bwhere's\b/gi, "where is"], [/\bit's\b/gi, "it is"], [/\byou're\b/gi, "you are"], [/\bwe're\b/gi, "we are"], [/\bI'm\b/g, "I am"], [/\byou've\b/gi, "you have"], [/\bthat's\b/gi, "that is"], [/\bdon't\b/gi, "do not"], [/\bisn't\b/gi, "is not"]];
const TYPO_OF = Object.entries(N.COMMON_TYPOS ?? {}).reduce((acc, [typo, word]) => { (acc[word] ??= []).push(typo); return acc; }, {});
const lowerFirst = (text) => (/^(?:I\b|I'|Giselle|Malcolm|Tonya|Maxwell|ASYNC)/.test(text) ? text : text[0].toLowerCase() + text.slice(1));

const TRANSFORMS = {
  lowercase: (t) => t.toLowerCase(),
  no_final_punctuation: (t) => (QUESTION_LEAD.test(t) || !/\?\s*$/.test(t) ? t.replace(/[?.!]+\s*$/, "") : null),
  // Contraction apostrophes only ("what time's departure" -> "what times departure" is a different phrase).
  no_apostrophes: (t) => { const out = t.replace(/\b(i|you|we|they|he|she|it|what|who|where|how|that|there|let|don|doesn|isn|aren|wasn|weren|can|won|didn|haven|hasn|couldn|wouldn|shouldn)'(?=[a-z])/gi, "$1"); return out === t ? null : out; },
  // "So Tonya?" is a continuation ("and Tonya?"), not an attention call: "So" is kept off bare names.
  marker: (t, pick) => { const list = /^[A-Z][a-z]+\?$/.test(t) ? ["Okay,", "Um,", "Alright,", "Well,"] : ["So", "Okay,", "Um,", "Alright,", "Well,"]; return `${list[pick % list.length]} ${lowerFirst(t)}`; },
  politeness: (t, pick) => (/\?\s*$/.test(t) ? `${["Sorry, but", "Quick question:", "Just wondering,"][pick % 3]} ${lowerFirst(t)}` : null),
  vocative_to_end: (t) => {
    const m = t.match(/^(Giselle|Malcolm|Tonya),\s+(.+?)([?.!]?)$/);
    return m ? `${m[2][0].toUpperCase()}${m[2].slice(1)}, ${m[1]}${m[3]}` : null;
  },
  expand_contractions: (t) => { let out = t; for (const [re, full] of CONTRACTIONS) out = out.replace(re, (w) => (w[0] === w[0].toUpperCase() ? full[0].toUpperCase() + full.slice(1) : full)); return out === t ? null : out; },
  typo: (t, pick) => {
    const words = t.split(/(\s+)/);
    const candidates = words.map((w, i) => [w, i]).filter(([w]) => TYPO_OF[w.toLowerCase().replace(/[^a-z]/g, "")] && /^[a-z]+[?.!,]?$/i.test(w));
    if (!candidates.length) return null;
    const [w, i] = candidates[pick % candidates.length];
    const bare = w.replace(/[^a-zA-Z]/g, "");
    const typos = TYPO_OF[bare.toLowerCase()];
    words[i] = w.replace(bare, typos[pick % typos.length]);
    return words.join("");
  }
};

module.exports = { TRANSFORMS, NAMES };
