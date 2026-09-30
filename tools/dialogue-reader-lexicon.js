"use strict";

// Reader Phase 2 -- the OBSERVER-SAFE READER LEXICON and the bounded, deterministic candidate pipeline.
//
// A reader may only ever be shown entities the observer (the player) can legally know. This module builds that
// closed vocabulary from the canonical entity index and binds the player's own words to it:
//
//   1. exact     the entity's own observer-visible label ("Battery field lamp", "the Complex")
//   2. alias     an authored alias (canonical-knowledge alias tables, plus the reader aliases below)
//   3. fuzzy     one token, Damerau-Levenshtein <= 1 (length 4-6) or <= 2 (length >= 7), unique nearest only
//   4. nominated a span the READER nominated gets ONE looser code-side lookup: edit distance <= 2 on the
//                whole phrase or its head token, or a deterministic plural stem -- observer-visible lexicon only,
//                unique only (lookupNominated)
//
// Never: the world index dumped to a reader, a model-created entity, phonetic matching, a non-unique fuzzy
// candidate. Ordering is stable: basis rank -> score (edit distance) -> canonical id.
//
// FUZZY GUARD (Reader Phase 2 Step 0.1): a correctly spelled ordinary English word is not a typo. Stage 3 never
// fuzzy-binds a token that is, or inflects (-s / -es), a dictionary word listed in the frozen guard list
// (tools/data/reader-fuzzy-guard.json: the public-domain web2 word list restricted to words that would otherwise
// fuzzy-bind to this worldpack's single-token names; regenerate with tools/dialogue-reader-fuzzy-guard.js). Authored
// exact labels and aliases are untouched, and genuine misspellings ("camra", "flashlght", "spctrmeter") still bind.
//
// NOT observer-visible (excluded before any matching, so a hidden entity typed by the player is indistinguishable
// from a word that names nothing): `world_only` people (canonical characters the player has not been introduced
// to) unless code lists them in `observer_known_ids`, and any entry marked `observer_hidden` / `hidden`.

const { editDistance, PROTECTED_WORDS } = require("./dialogue-normalize");

const LEXICON_VERSION = "yellow-beast-reader-lexicon@v2";
const BASIS_RANK = Object.freeze({ exact: 0, alias: 1, fuzzy: 2, nominated: 3 });
// Authored reader aliases (interpretation only, by equipment type): everyday words a player uses for a canonical
// item. Reviewed like the canonical-knowledge alias tables; never spoken by coworkers.
const READER_ALIASES = Object.freeze({
  "startup-materials-duffle": ["bag", "the bag", "duffel", "duffel bag", "duffle bag", "startup bag"],
  "battery-lamp": ["field lamp", "battery lamp"],
  "field-camera": ["35mm"],
  "mass-spectrometer": ["mass spec", "spectrometer"]
});
const REFERENT_PLACE_IDS = new Set(["complex", "threshold", "outpost-a"]);
// Words that are never fuzzy-matched (function words, very common verbs / nouns near canonical vocabulary).
const FUZZY_STOP = new Set([...PROTECTED_WORDS, "came", "case", "cart", "last", "lame", "camp", "damp", "lump", "limp", "late", "rope", "tape", "take", "make", "cope", "code", "core", "more", "store", "stage", "stages", "record", "records"]);
const STEM = (w) => w.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
const FUZZY_GUARD_FILE = require("node:path").join(__dirname, "data", "reader-fuzzy-guard.json");
const FUZZY_GUARD = (() => { try { return new Set(JSON.parse(require("node:fs").readFileSync(FUZZY_GUARD_FILE, "utf8")).words); } catch { return new Set(); } })();
/** Is `w` (lower case) a dictionary word, or a regular -s / -es inflection of one, that the guard protects? */
function fuzzyGuarded(w, guard = FUZZY_GUARD) { return guard.has(w) || (/s$/.test(w) && guard.has(w.slice(0, -1))) || (/es$/.test(w) && guard.has(w.slice(0, -2))); }
/** May this token be fuzzy-matched at all (before the guard)? */
const fuzzyEligible = (w) => Boolean(w) && w.length >= 4 && /^[a-z]+$/.test(w) && !FUZZY_STOP.has(w) && !/(?:ing|ed|ly)$/.test(w);
/** Single-token lexicon forms stage 3 may fuzzy-match. */
const singleForms = (lexicon) => nameForms(lexicon).filter((f) => f.tokens.length === 1 && f.tokens[0].length >= 4 && /^[a-z]/.test(f.tokens[0]));
/** Fuzzy hits of one word against single-token forms (no guard): Damerau <= 1 at length 4-6, <= 2 at >= 7. */
function fuzzyHits(w, single) {
  const limit = w.length >= 7 ? 2 : 1;
  const hits = [];
  for (const f of single) {
    const name = f.tokens[0];
    if (Math.abs(name.length - w.length) > limit || name[0] !== w[0]) continue;
    const d = editDistance(w, name, limit);
    if (d <= limit) hits.push({ id: f.entry.id, kind: f.entry.kind, referent: f.entry.referent, basis: "fuzzy", score: d });
  }
  return hits;
}

const low = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'");
const words = (s) => low(s).split(/[^a-z0-9'-]+/).filter(Boolean);
const bare = (s) => low(s).replace(/^the\s+/, "").trim();

/** Is this canonical index entry something the observer may be shown? */
function observerVisible(entry, { observer_known_ids = [] } = {}) {
  if (!entry || entry.observer_hidden || entry.hidden) return false;
  if (entry.world_only && !observer_known_ids.includes(entry.id)) return false;
  return true;
}
const isReferentKind = (e) => e && (e.kind === "equipment" || e.kind === "location" || (e.kind === "entity" && REFERENT_PLACE_IDS.has(e.id)));

/**
 * The observer-visible, NON-PERSON lexicon (people are the name vocabulary's). Each entry keeps its exact label
 * forms and its authored aliases apart, so a match records its basis.
 */
function observerLexicon(entities = [], options = {}) {
  const out = [];
  for (const e of entities) {
    if (!e || e.kind === "person" || !observerVisible(e, options)) continue;
    const exact = new Set([low(e.label), bare(e.label)].filter((n) => n.length >= 3));
    const aliases = new Set([...(e.names ?? []).map(low), ...(e.kind === "equipment" ? READER_ALIASES[e.item_type] ?? [] : []), ...(e.kind === "equipment" && e.item_type ? [] : [])].filter((n) => n.length >= 3 && !exact.has(n)));
    out.push(Object.freeze({ id: e.id, kind: e.kind, label: e.label, referent: isReferentKind(e), exact: [...exact], aliases: [...aliases] }));
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** All (name -> entries) forms of a lexicon with their basis, longest name first. */
function nameForms(lexicon) {
  const forms = [];
  for (const entry of lexicon) {
    for (const name of entry.exact) forms.push({ name, tokens: words(name), basis: "exact", entry });
    for (const name of entry.aliases) forms.push({ name, tokens: words(name), basis: "alias", entry });
  }
  return forms.filter((f) => f.tokens.length).sort((a, b) => b.tokens.length - a.tokens.length || BASIS_RANK[a.basis] - BASIS_RANK[b.basis]);
}

const tokenWord = (t) => low(t.text).replace(/['’]s$/, "");
/** Stable candidate order: basis rank -> score -> canonical id. */
function orderCandidates(list) {
  return [...list].sort((a, b) => BASIS_RANK[a.basis] - BASIS_RANK[b.basis] || a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Binds the player's line (its tokens) to the lexicon. Returns spans [{ tokens:[a,b], player_literal, basis, score,
 * candidates:[{id, kind, basis, score}], bound: id|null, ambiguous: bool }] in line order. A span binds only when
 * exactly one REFERENT-kind entry (or, with none, exactly one entry) matches at the best basis and score.
 */
function bindLine(tokens, lexicon, { raw = null } = {}) {
  const wordsAt = tokens.map((t) => (/^[A-Za-z0-9]/.test(t.text) ? tokenWord(t) : null));
  const used = new Array(tokens.length).fill(false);
  const spans = [];
  const literal = (a, b) => (raw != null && tokens[a]?.start != null ? String(raw).slice(tokens[a].start, tokens[b].end) : tokens.slice(a, b + 1).map((t) => t.text).join(" "));
  const push = (a, b, hits) => {
    const best = orderCandidates(hits);
    const top = best[0];
    const tied = best.filter((h) => h.basis === top.basis && h.score === top.score);
    const ids = [...new Set(tied.map((h) => h.id))];
    const referentIds = [...new Set(tied.filter((h) => h.referent).map((h) => h.id))];
    const bound = referentIds.length === 1 ? referentIds[0] : referentIds.length === 0 && ids.length === 1 ? ids[0] : null;
    const kinds = [...new Set(tied.map((h) => h.kind))];
    spans.push({ tokens: [a, b], player_literal: literal(a, b), basis: top.basis, score: top.score, candidates: best.map(({ id, kind, basis, score }) => ({ id, kind, basis, score })), bound, ambiguous: bound === null, kind: bound ? tied.find((h) => h.id === bound).kind : kinds.length === 1 ? kinds[0] : "ambiguous" });
    for (let k = a; k <= b; k += 1) used[k] = true;
  };
  // Stages 1-2: exact label forms and authored aliases (whole-token phrases, longest first). A name is compared in
  // compact form (spaces and hyphens dropped) against consecutive word / number / hyphen tokens, so "kv31",
  // "threshold-side entry" and "Battery field lamp" match however the tokenizer split them -- always on token
  // boundaries.
  const forms = nameForms(lexicon);
  const compact = (s) => low(s).replace(/[\s-]+/g, "");
  const formsByCompact = new Map();
  for (const f of forms) { const key = compact(f.name); if (!formsByCompact.has(key)) formsByCompact.set(key, []); formsByCompact.get(key).push(f); }
  const maxLen = Math.max(0, ...[...formsByCompact.keys()].map((k) => k.length));
  const byStart = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    if (!wordsAt[i]) continue;
    let acc = "";
    for (let j = i; j < tokens.length; j += 1) {
      const piece = wordsAt[j] ?? (tokens[j].text === "-" && j > i ? "" : null);
      if (piece === null) break;
      acc += piece.replace(/-/g, "");
      if (acc.length > maxLen) break;
      if (!wordsAt[j]) continue;
      for (const f of formsByCompact.get(acc) ?? []) {
        const list = byStart.get(i) ?? [];
        list.push({ end: j, hit: { id: f.entry.id, kind: f.entry.kind, referent: f.entry.referent, basis: f.basis, score: 0 } });
        byStart.set(i, list);
      }
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const list = byStart.get(i);
    if (!list || used[i]) continue;
    const longest = Math.max(...list.map((x) => x.end));
    if (used.slice(i, longest + 1).some(Boolean)) continue;
    push(i, longest, list.filter((x) => x.end === longest).map((x) => x.hit));
  }
  // Stage 3: token-level fuzzy match over single-token names (unique nearest entity only).
  const single = singleForms(lexicon);
  for (let i = 0; i < tokens.length; i += 1) {
    const w = wordsAt[i];
    if (used[i] || !fuzzyEligible(w) || fuzzyGuarded(w)) continue;
    if (single.some((f) => f.tokens[0] === w)) continue;
    const hits = fuzzyHits(w, single);
    if (!hits.length) continue;
    const bestScore = Math.min(...hits.map((h) => h.score));
    const nearest = hits.filter((h) => h.score === bestScore);
    push(i, i, nearest);
  }
  return spans.sort((a, b) => a.tokens[0] - b.tokens[0]);
}

/**
 * Stage 4: ONE bounded looser lookup for a span the READER nominated as a referent it could not bind. Observer-
 * visible lexicon only, unique only, never phonetic: edit distance <= 2 on the whole phrase or on its head (last)
 * word, or an exact match after a deterministic plural stem. Returns { id, kind, basis: "nominated", score } or
 * { id: null, reason }.
 */
function lookupNominated(phrase, lexicon) {
  const ws = words(phrase).filter((w) => !["the", "a", "an", "that", "this", "my", "your", "our"].includes(w));
  if (!ws.length) return { id: null, reason: "empty_span" };
  const whole = ws.join(" ");
  const head = ws.at(-1);
  const hits = [];
  for (const entry of lexicon) {
    let best = Infinity;
    for (const name of [...entry.exact, ...entry.aliases]) {
      const n = bare(name);
      if (n === whole || STEM(n) === STEM(whole) || n.split(/\s+/).at(-1) === STEM(head) || STEM(n.split(/\s+/).at(-1)) === STEM(head)) best = Math.min(best, 0);
      else {
        const d = Math.min(editDistance(whole, n, 2), editDistance(head, n.split(/\s+/).at(-1), 2));
        if (d <= 2 && (head.length >= 4 || d === 0)) best = Math.min(best, d);
      }
    }
    if (best <= 2) hits.push({ id: entry.id, kind: entry.kind, referent: entry.referent, basis: "nominated", score: best });
  }
  const referentHits = hits.filter((h) => h.referent);
  if (!referentHits.length) return { id: null, reason: "no_candidate" };
  const bestScore = Math.min(...referentHits.map((h) => h.score));
  const nearest = orderCandidates(referentHits.filter((h) => h.score === bestScore));
  if (nearest.length !== 1) return { id: null, reason: "not_unique", count: nearest.length };
  const { id, kind, basis, score } = nearest[0];
  return { id, kind, basis, score };
}

/** Observer-visible entity references in a delivered coworker line (heard salience; referent kinds only). */
function heardMentions(text, lexicon) {
  const t = [];
  const s = String(text ?? "");
  for (const m of s.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)) t.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  // Heard wording is matched exactly (labels and aliases): a coworker's typo is not the player's to repair.
  return bindLine(t, lexicon, { raw: s }).filter((span) => span.basis !== "fuzzy" && span.bound && lexicon.find((e) => e.id === span.bound)?.referent);
}

/**
 * Before validation: every act whose referent NOMINATES a token span and has no bound candidate (null / NONE /
 * AMBIGUOUS) gets ONE bounded lookup (lookupNominated) over the observer-visible lexicon kept in the code-side
 * bindings. A unique hit binds: an existing candidate's label, or a new candidate (basis "nominated", shown with the
 * player's literal words) added to a COPY of the input and bindings. Pure: the originals are never mutated; the
 * lookups are returned for the receipt. Returns { frame, input, bindings, lookups }.
 */
function applyNominatedLookup(frame, input, bindings) {
  const lookups = [];
  if (!frame?.acts?.some((a) => a?.referent?.nominated)) return { frame, input, bindings, lookups };
  const outFrame = structuredClone(frame);
  const outInput = structuredClone(input);
  const outBindings = { ...bindings, referents: { ...(bindings?.referents ?? {}) } };
  const lexicon = bindings?.lexicon ?? [];
  const tokens = input?.line?.tokens ?? [];
  const raw = String(input?.line?.raw ?? "");
  outFrame.acts.forEach((act, i) => {
    const nominated = act?.referent?.nominated;
    if (!Array.isArray(nominated) || !Number.isInteger(nominated[0]) || !Number.isInteger(nominated[1])) return;
    const [a, b] = nominated;
    if (!tokens[a] || !tokens[b] || b < a) { lookups.push({ act: i, span: nominated, id: null, reason: "span_out_of_range" }); return; }
    const current = act.referent.candidate;
    if (current && !["NONE", "AMBIGUOUS"].includes(current)) { lookups.push({ act: i, span: nominated, id: null, reason: "already_bound" }); return; }
    const phrase = raw.slice(tokens[a].start, tokens[b].end);
    const hit = lookupNominated(phrase, lexicon);
    if (!hit.id) { lookups.push({ act: i, span: nominated, id: null, reason: hit.reason }); return; }
    let label = Object.entries(outBindings.referents).find(([, id]) => id === hit.id)?.[0] ?? null;
    if (!label) {
      label = `r${outInput.referent_candidates.length + 1}`;
      const entry = lexicon.find((e) => e.id === hit.id);
      outInput.referent_candidates.push({ label, kind: entry.kind === "equipment" ? "item" : "place", name: phrase, basis: "nominated" });
      outBindings.referents[label] = hit.id;
    }
    act.referent.candidate = label;
    lookups.push({ act: i, span: nominated, bound_label: label, basis: hit.basis, score: hit.score });
  });
  return { frame: outFrame, input: outInput, bindings: outBindings, lookups };
}

module.exports = { applyNominatedLookup, LEXICON_VERSION, FUZZY_STOP, FUZZY_GUARD, FUZZY_GUARD_FILE, fuzzyGuarded, fuzzyEligible, fuzzyHits, singleForms, nameForms, BASIS_RANK, READER_ALIASES, observerVisible, observerLexicon, bindLine, lookupNominated, heardMentions, orderCandidates, isReferentKind };
