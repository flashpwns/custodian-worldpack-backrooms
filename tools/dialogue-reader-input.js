"use strict";

// Reader Phase 0 -- the ReaderInput v1 builder: the ONLY view of a turn a language reader may receive.
//
// Pure: it reads the raw line, the closed vocabularies (present people, canonical entity names) and the
// canonical dialogue state (the DIS snapshot, the request ledger, the derived discourse state) and returns
//   { input, bindings }
// `input` is observer-safe: what the player typed, code-produced surface FEATURES (spans and token classes,
// never decisions), opaque labels for people / requests / referents / anchors, and conversation metadata the
// player took part in. `bindings` maps every label back to canonical ids; it stays with code and is never
// serialized to a reader.
//
// Deliberately absent: canonical ids, facts a reply was merely AUTHORIZED to say (required OR optional plan facts),
// anyone's private or personhood state, knowledge records, entities the observer does not know (world-only
// people, hidden entries: see dialogue-reader-lexicon.js), and any model prompt text (dialogue-reader-render.js
// renders the model-facing view from this object). Wording a coworker actually spoke is presentation-dependent
// (it differs by wording provider) and travels only in the separately marked `heard` channel.
//
// SALIENCE (owner decision B7, approved for Reader Phase 2 -- ReaderInput v2 only; production withSalience is
// unchanged):
//   canonical  the player's own words (the last canonical request text, the previous player line) and canonical
//              interaction state (the active request's arguments, the active place, the pending coworker
//              question's options). Identical under every wording provider.
//   heard      entities actually named in DELIVERED coworker wording, resolved against the observer-visible
//              lexicon. Provider-dependent; it may license a conversational reference; it never creates a fact.
//   A plan fact -- required or optional -- is never salient merely because the wording plan authorized it.
//
// B7 INDIRECT REQUEST-ARG SALIENCE (owner ruling, Reader Phase 2 Step 0.1; ReaderInput v3): a canonical request
// argument (the last / last substantive request's item or place) is NOT automatically conversational. Production may
// have filled it from its own salience (dialogue-turn withSalience: place_basis "salient_topic", an anaphoric item,
// an advisory candidate, the "inside" domain default) -- which reads the replies' REQUIRED and OPTIONAL plan facts,
// spoken or not. The reader-facing projection therefore shows such an argument as the active place or an anaphora
// candidate only when OBSERVER-GROUNDED: the player's own words in the recent exchange (their lines, the canonical
// request texts) name it, or it is an observer-visible option of the pending coworker question. A thing only HEARD in
// delivered wording stays in the heard channel (a heard candidate), never the canonical one. Anything provenance cannot
// ground is omitted from the reader view (recorded code-side in bindings.salience_filter); canonical production state
// is untouched.

const { normalizeUtterance } = require("./dialogue-normalize");
const canonicalKnowledge = require("./canonical-knowledge");
const lexiconTools = require("./dialogue-reader-lexicon");

const READER_INPUT_VERSION = "yellow-beast-reader-input@v3";
const SALIENCE_SOURCE = "player_words+canonical_state";
const REQUEST_WINDOW = 4;
const MAX_REFERENTS = 24;
const PLACE_ENTITY_IDS = new Set(["complex", "threshold", "outpost-a"]);

const WH = new Set(["who", "whom", "whose", "what", "where", "when", "why", "how", "which"]);
const SECOND_PERSON = new Set(["you", "your", "yours", "yourself", "yourselves", "u", "ya", "yall", "y'all", "ur", "you're", "you've", "you'll", "you'd"]);
const QUANTIFIERS = new Set(["all", "everyone", "everybody", "both", "rest", "others", "other", "anyone", "anybody", "each", "except", "two", "three", "just", "only", "whole", "else", "guys", "team"]);
const DEICTICS = new Set(["it", "its", "that", "this", "those", "these", "there", "them"]);
// Place deixis (Reader Phase 1): closed-vocabulary tokens a deictic place reference is made with -- "there" /
// "that place" (needs an active place) and the entry words "inside" / "in" / "into" / "through" / "across".
// A feature, never a decision: the reader says whether the act refers to a place this way.
const PLACE_DEIXIS = Object.freeze({ there: "there", inside: "inside", in: "inside", into: "inside", through: "inside", across: "inside" });

const NAME_STOP = new Set(["the", "and", "for", "dr", "mr", "mrs", "ms", "sir", "doctor", "desk", "team", "you", "your", "all"]);
const isWord = (t) => /^[A-Za-z@]/.test(t.text);
const low = (s) => String(s ?? "").toLowerCase();

/** Person-name vocabulary: present coworkers (labelled), other known persons (absent) and the player. */
function nameVocabulary({ present, entities, player, observer_known_ids = [] }) {
  const vocab = new Map();
  // Name words only: function words and titles inside multi-word names ("the Control desk", "Dr. Kirk Maxwell")
  // are never name spans.
  const add = (word, ref) => { const w = low(word).replace(/[^a-z'-]/g, ""); if (w.length >= 3 && !NAME_STOP.has(w) && !vocab.has(w)) vocab.set(w, ref); };
  present.forEach((p, i) => { for (const n of [p.name, ...(p.names ?? [])]) for (const w of String(n ?? "").split(/\s+/)) add(w, { kind: "present", person: `p${i + 1}`, id: p.id }); });
  for (const w of (player?.names ?? []).flatMap((n) => String(n).split(/\s+/))) add(w, { kind: "player", id: player.id });
  // Known people who are not present: proper-name words of the canonical label ("Dr. Kirk Maxwell" -> Kirk,
  // Maxwell) and single-word canonical names -- never the words of a descriptive name phrase.
  // A person the observer does not know (a world-only character, a hidden entry) is not vocabulary at all: the
  // word stays an ordinary token, exactly as a name that belongs to nobody (Reader Phase 2, hidden-entity rule).
  for (const e of entities.filter((x) => x.kind === "person" && !x.is_player && !present.some((p) => p.id === x.id) && lexiconTools.observerVisible(x, { observer_known_ids }))) {
    const words = [...String(e.label ?? "").split(/\s+/).filter((w) => /^[A-Z][a-z]/.test(w)), ...(e.names ?? []).filter((n) => !/\s/.test(String(n).trim()))];
    for (const w of words) add(w, { kind: "absent", id: e.id });
  }
  return vocab;
}

const isReferentKind = (e) => e && (e.kind === "equipment" || e.kind === "location" || (e.kind === "entity" && PLACE_ENTITY_IDS.has(e.id)));
// Referent-candidate groups, in label order. CANONICAL groups first (their labels are identical under every
// wording provider); the provider-dependent heard group is appended last.
const BASIS_ORDER = Object.freeze(["salient", "anaphora", "line", "inbound", "heard"]);
/**
 * Referent candidates (places and items) -- OBSERVER-SAFE by construction, never the canonical world index:
 * only observer-visible things the conversation made salient (canonical), the explicit anaphoric set (what the
 * last requests were about), things the player's own line names, the pending coworker question's options, and
 * (last) things delivered coworker wording named. Opaque labels r1..rN.
 *
 * `names` gives the text a reader is shown for a candidate: for a thing the player's own line names, the player's
 * literal phrase; for a thing heard, the words heard; otherwise the entity's observer-visible label.
 */
function referentCandidates(entities, { salientIds = [], anaphoraIds = [], lineIds = [], inboundIds = [], heardIds = [], names = {}, visible = null } = {}) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const groups = { salient: salientIds, anaphora: anaphoraIds, line: lineIds, inbound: inboundIds, heard: heardIds };
  const seen = new Set();
  const ordered = [];
  for (const basis of BASIS_ORDER) for (const id of groups[basis]) {
    const e = byId.get(id);
    if (seen.has(id) || !isReferentKind(e) || (visible && !visible(e))) continue;
    seen.add(id);
    ordered.push({ e, basis });
  }
  return ordered.slice(0, MAX_REFERENTS).map(({ e, basis }, i) => ({ label: `r${i + 1}`, id: e.id, kind: e.kind === "equipment" ? "item" : "place", name: names[e.id] ?? e.label, basis }));
}
/**
 * Text a coworker-question option may show a reader: an OBSERVER-VISIBLE entity's name, an object's label -- never an
 * id, and never the canonical label of an entity the observer cannot see (Step 0.1 option visibility). A hidden
 * option keeps its canonical binding code-side (bindings.options) and is shown as an opaque, unnamed option exactly
 * like an id-only one; the words a coworker actually spoke, if any, reach the reader through the heard channel.
 */
const ID_LIKE = /^[a-z0-9]+(?:[-:][a-z0-9]+)+$/i;
function optionText(option, entities, visible = () => true) {
  if (typeof option === "string") {
    const entity = entities.find((e) => e.id === option);
    if (entity) return visible(entity) ? entity.label ?? null : null;
    return ID_LIKE.test(option) ? null : option;
  }
  if (option && typeof option === "object") {
    const ref = option.id ?? option.entity_id ?? null;
    const entity = ref ? entities.find((e) => e.id === ref) : null;
    if (entity && !visible(entity)) return null;
    return typeof option.label === "string" ? option.label : null;
  }
  return null;
}
/** Reader Phase 0 / 0.5 helper, retained for the Phase-0 tests: string values of REQUIRED facts. Reader Phase 2
 * no longer derives salience from plan facts (owner decision B7); this is not called by buildReaderInput. */
function requiredFactText(facts) {
  return (facts ?? []).flatMap((f) => (typeof f?.value === "string" ? [f.value] : Array.isArray(f?.value) ? f.value.filter((v) => typeof v === "string") : [])).join(" ");
}
/** Entity ids a text names, by the observer-visible lexicon (exact / alias / bounded fuzzy; bound spans only). */
function mentionedIds(text, lexicon) {
  const s = String(text ?? "");
  if (!s.trim()) return [];
  const t = normalizeUtterance(s).tokens.map((x) => ({ text: x.text, start: x.raw_start, end: x.raw_end }));
  return lexiconTools.bindLine(t, lexicon, { raw: s }).filter((span) => span.bound).map((span) => span.bound);
}
const taskItemsOf = (taskIds, entities) => taskIds.flatMap((id) => {
  const pattern = canonicalKnowledge.TASK_ITEMS?.[String(id).replace(/^task:/, "")] ?? null;
  return pattern ? entities.filter((e) => e.kind === "equipment" && (pattern.test(e.id) || pattern.test(String(e.label ?? "")))).map((e) => e.id) : [];
});

/**
 * @param claim  Reader Phase 1 (owner ruling 3): the player's previous claim as READER STATE -- the facet /
 *               polarity / subject a validated reading of the player's previous line gave its statement act, and
 *               whether it is still fresh ({ facet, polarity, subject_ids, state }). Never the persisted legacy
 *               clause predicates. Absent (null) when no reader state exists (e.g. after a cold reload).
 * @param observer_known_ids  world-only people code has established the observer knows (default none).
 */
function buildReaderInput({ raw, chip_target_id = null, present = [], player = null, entities = [], snapshot = null, ledger = null, discourse = null, claim = null, window = REQUEST_WINDOW, observer_known_ids = [] } = {}) {
  const line = String(raw ?? "");
  const visibility = { observer_known_ids };
  const visible = (e) => lexiconTools.observerVisible(e, visibility);
  const lexicon = lexiconTools.observerLexicon(entities, visibility);
  const vocab = nameVocabulary({ present, entities, player, observer_known_ids });
  const normalized = normalizeUtterance(line, { names: [...vocab.keys()] });
  const tokens = normalized.tokens.map((t, i) => ({ i, text: t.text, start: t.raw_start, end: t.raw_end, n_start: t.start, n_end: t.end }));
  const words = tokens.filter(isWord);
  const bindings = { people: {}, names: {}, entities: {}, requests: {}, inbound: {}, options: {}, referents: {}, anchors: {}, activity: {}, claims: {}, salience_filter: { omitted: [] }, lexicon };

  // People: present coworkers only, opaque labels in canonical (team) order.
  const people = present.map((p, i) => { bindings.people[`p${i + 1}`] = p.id; return { label: `p${i + 1}`, name: p.name, present: true, eligible: true }; });
  const labelOf = (id) => { const i = present.findIndex((p) => p.id === id); return i >= 0 ? `p${i + 1}` : null; };
  const labels = (ids) => (ids ?? []).map(labelOf).filter(Boolean);

  // ── surface features (code, paraphrase-invariant; no decisions) ──
  const nameSpans = [];
  for (let k = 0; k < tokens.length; k += 1) {
    // A possessive or s-suffixed name ("Tonya's", "tonyas") is still that person's name span (closed vocabulary).
    const word = isWord(tokens[k]) ? low(tokens[k].text) : null;
    const bare = word ? word.replace(/(?:['’]s|s)$/, "") : null;
    const ref = word ? vocab.get(word) ?? (bare && bare !== word ? vocab.get(bare) : null) : null;
    const possessive = Boolean(word && !vocab.get(word) && ref);
    if (!ref) continue;
    let end = k;
    while (end + 1 < tokens.length && isWord(tokens[end + 1]) && vocab.get(low(tokens[end + 1].text))?.id === ref.id) end += 1;
    const firstWord = words[0]?.i === k;
    const lastWord = words.at(-1)?.i === end;
    const label = `n${nameSpans.length + 1}`;
    bindings.names[label] = ref.id;
    nameSpans.push({
      label, tokens: [k, end], text: line.slice(tokens[k].start, tokens[end].end),
      person: ref.kind === "present" ? ref.person : null, refers_to: ref.kind === "player" ? "player" : ref.kind === "absent" ? "absent_person" : "present_person", non_present_person: ref.kind === "absent",
      position: firstWord ? "initial" : lastWord ? "final" : "medial",
      delimited: tokens[k - 1]?.text === "," || tokens[end + 1]?.text === ",",
      capitalized: /^[A-Z]/.test(line.slice(tokens[k].start, tokens[k].end)),
      standalone: words.every((w) => w.i >= k && w.i <= end),
      ...(possessive ? { possessive: true } : {})
    });
    k = end;
  }
  // Entity spans: the player's words bound to the observer-visible lexicon (exact -> alias -> bounded fuzzy). A span
  // keeps the player's LITERAL words; its canonical candidate is set only when code could bind it legally and
  // uniquely (ambiguous -> null). Nothing hidden is ever matched, so a hidden name is just an ordinary word.
  const inName = (a, b) => nameSpans.some((n) => !(b < n.tokens[0] || a > n.tokens[1]));
  const bound = lexiconTools.bindLine(tokens, lexicon, { raw: line }).filter((span) => !inName(span.tokens[0], span.tokens[1]));
  const kindOut = (k) => (k === "equipment" ? "item" : ["location", "entity"].includes(k) ? "place" : k);
  const entitySpans = bound.map((span, i) => {
    const label = `e${i + 1}`;
    bindings.entities[label] = span.bound;
    return { label, tokens: [...span.tokens], player_literal: span.player_literal, kind: kindOut(span.kind), basis: span.basis, canonical_candidate: null, ...(span.ambiguous ? { ambiguous: true } : {}) };
  });
  const lineIds = bound.filter((span) => span.bound).map((span) => span.bound);
  const lineLiteral = Object.fromEntries(bound.filter((span) => span.bound).map((span) => [span.bound, span.player_literal]));
  const classOf = (set) => tokens.filter((t) => isWord(t) && set.has(low(t.text))).map((t) => ({ token: t.i, word: low(t.text) }));
  const trimmed = line.trim();
  const features = {
    name_spans: nameSpans,
    entity_spans: entitySpans,
    wh: classOf(WH),
    second_person: classOf(SECOND_PERSON).map((x) => x.token),
    quantifiers: classOf(QUANTIFIERS),
    deictics: classOf(DEICTICS),
    place_deixis: tokens.filter((t) => isWord(t) && PLACE_DEIXIS[low(t.text)]).map((t) => ({ token: t.i, word: low(t.text), kind: PLACE_DEIXIS[low(t.text)] })),
    punctuation: { question_mark: /\?/.test(line), exclamation: /!/.test(line), terminal: /[?]\s*$/.test(trimmed) ? "?" : /[!]\s*$/.test(trimmed) ? "!" : /[.]\s*$/.test(trimmed) ? "." : "none", commas: (line.match(/,/g) ?? []).length },
    word_count: words.length
  };

  // ── conversation metadata (canonical ledger, labels only) ──
  const requests = (ledger?.requests ?? []).slice(-window);
  const requestView = requests.map((r, i) => {
    const label = `q${i + 1}`;
    bindings.requests[label] = r.request_id;
    // Who has answered: the slots' responders (the ledger's own record; dialogue-state snapshot does the same).
    const answered = Object.values(r.slots ?? {}).filter((slot) => slot?.responder_id).map((slot) => slot.responder_id);
    return { label, facet: r.predicate ?? null, targets: labels(r.targets), answered_by: labels(answered), state: r.state, distance: requests.length - 1 - i };
  });
  const requestLabel = (id) => Object.entries(bindings.requests).find(([, v]) => v === id)?.[0] ?? null;
  const pendingInbound = snapshot?.pending_inbound_request ?? null;
  const inbound = pendingInbound ? (() => {
    bindings.inbound.i1 = pendingInbound.event_id ?? null;
    const options = (pendingInbound.options ?? []).map((o, i) => { bindings.options[`o${i + 1}`] = o; return { label: `o${i + 1}`, text: optionText(o, entities, visible) }; });
    return { label: "i1", from: labelOf(pendingInbound.from ?? pendingInbound.speaker_id), kind: pendingInbound.kind ?? null, facet: pendingInbound.predicate ?? null, answer_shape: pendingInbound.answer_shape ?? null, options, options_source: options.length ? "ledger" : "none" };
  })() : null;
  const justAnswered = snapshot?.just_answered_inbound ?? null;
  const justAnsweredView = justAnswered ? (() => { bindings.inbound.i0 = justAnswered.event_id ?? null; return { label: "i0", from: labelOf(justAnswered.from ?? justAnswered.speaker_id) }; })() : null;
  const activity = snapshot?.activity ? { label: "v1", kind: snapshot.activity.kind, facet: snapshot.activity.template?.predicate ?? null, done: labels(snapshot.activity.completed), remaining: labels((snapshot.activity.eligible ?? []).filter((id) => !(snapshot.activity.completed ?? []).includes(id))) } : null;
  if (activity) bindings.activity = { v1: snapshot.activity.activity_id ?? null };
  // The player's previous claim (reader state; owner ruling 3): facet, polarity, whom it was about, freshness.
  const claimView = claim?.facet ? (() => {
    bindings.claims.c1 = { facet: claim.facet, polarity: claim.polarity ?? "positive", subject_ids: [...(claim.subject_ids ?? [])], state: claim.state ?? "stale" };
    const about = (claim.subject_ids ?? []).map((id) => (player && id === player.id ? "player" : labelOf(id))).filter(Boolean);
    return { label: "c1", facet: claim.facet, polarity: claim.polarity ?? "positive", subject: about, state: claim.state ?? "stale" };
  })() : null;

  // ── salience (owner decision B7) ──
  // CANONICAL: the player's own words and canonical interaction state. Never a plan fact, never wording.
  const playerWords = [snapshot?.last_request?.request_text ?? "", discourse?.last_turn?.player_text ?? ""].join(" \n ");
  const inboundIds = (pendingInbound?.options ?? []).filter((o) => typeof o === "string" && entities.some((e) => e.id === o && visible(e)));
  const salientIds = [...new Set([...mentionedIds(playerWords, lexicon), ...taskItemsOf(mentionedIds(playerWords, lexicon).filter((id) => String(id).startsWith("task:")), entities)])];
  // Observer grounding of request arguments (B7 indirect, Step 0.1): the player's own words across the recent
  // exchange window and the canonical request texts, plus the pending question's visible options.
  const groundingWords = [...(discourse?.turns ?? []).map((t) => t?.player_text ?? ""), discourse?.last_turn?.player_text ?? "", snapshot?.last_request?.request_text ?? "", snapshot?.last_substantive_request?.request_text ?? ""].join(" \n ");
  const groundedMentions = mentionedIds(groundingWords, lexicon);
  const grounded = new Set([...groundedMentions, ...taskItemsOf(groundedMentions.filter((id) => String(id).startsWith("task:")), entities), ...inboundIds]);
  const omittedArgs = [];
  const groundedArg = (request, key) => {
    const id = request?.args?.[key] ?? null;
    if (!id) return null;
    if (grounded.has(id)) return id;
    omittedArgs.push({ request_id: request.request_id ?? null, arg: key, id, basis: key === "place_id" ? request.args.place_basis ?? null : request.args.item_anaphoric ? "anaphoric" : null });
    return null;
  };
  const lastPlace = groundedArg(snapshot?.last_request, "place_id");
  // The explicit anaphoric / deictic set: what the most recent requests were about (canonical args), and the
  // active place -- observer-grounded arguments only. "it", "that", "there" may choose only among these (or salient
  // / named things).
  const anaphoraIds = [...new Set([groundedArg(snapshot?.last_request, "item_id"), lastPlace, groundedArg(snapshot?.last_substantive_request, "item_id"), groundedArg(snapshot?.last_substantive_request, "place_id")].filter(Boolean))];
  bindings.salience_filter = { omitted: omittedArgs.filter((o, i, all) => all.findIndex((x) => x.arg === o.arg && x.id === o.id && x.request_id === o.request_id) === i) };
  // HEARD: things delivered coworker wording named (reply lines and the surface anchors cut from them), resolved
  // against the observer-visible lexicon only. Provider-dependent; kept apart from the canonical salience.
  const replies = discourse?.last_turn?.responses ?? [];
  const heardTexts = [...replies.map((r) => r.text), ...(snapshot?.surface_anchors ?? []).flatMap((a) => (a.spans ?? []).map((span) => span.text))].filter(Boolean);
  const heardSpans = heardTexts.flatMap((text) => lexiconTools.heardMentions(text, lexicon));
  const heardIds = [...new Set(heardSpans.map((span) => span.bound))];
  const heardLiteral = Object.fromEntries(heardSpans.map((span) => [span.bound, span.player_literal]));
  // Items a named TASK canonically carries ("the startup materials" -> its duffle): canonical association of
  // something the player's own line named (canonical-knowledge TASK_ITEMS), never a guess.
  const taskItems = taskItemsOf(lineIds.filter((id) => String(id).startsWith("task:")), entities);
  // A line-named thing is shown with the player's own words; a heard-only thing with the words heard.
  const names = { ...Object.fromEntries(heardIds.filter((id) => !salientIds.includes(id) && !anaphoraIds.includes(id) && !inboundIds.includes(id)).map((id) => [id, heardLiteral[id]])), ...lineLiteral };
  const referents = referentCandidates(entities, { salientIds, anaphoraIds, lineIds: [...lineIds, ...taskItems], inboundIds, heardIds, names, visible });
  for (const r of referents) bindings.referents[r.label] = r.id;
  const refLabel = (id) => referents.find((r) => r.id === id)?.label ?? null;
  for (const span of entitySpans) span.canonical_candidate = refLabel(bindings.entities[span.label]);
  const canonicalSalient = [...salientIds, ...inboundIds];
  const activePlaceId = lastPlace ?? canonicalSalient.find((id) => referents.find((r) => r.id === id)?.kind === "place") ?? null;

  // Surface anchors: sentences a coworker actually SPOKE, mapped to the request that licensed them. Their
  // number, split and words depend on the wording provider, so they live only in the heard channel.
  const heardAnchors = [];
  for (const a of snapshot?.surface_anchors ?? []) (a.spans ?? []).forEach((span, j) => {
    const label = `a${heardAnchors.length + 1}`;
    bindings.anchors[label] = { event_id: a.event_id ?? null, span: j };
    heardAnchors.push({ label, speaker: labelOf(a.speaker_id), request: requestLabel(span.request_id), facet: span.predicate ?? null, text: String(span.text ?? "").slice(0, 200) });
  });

  const input = {
    version: READER_INPUT_VERSION,
    line: { raw: line, normalized: normalized.repaired, tokens: tokens.map(({ i, text, start, end }) => ({ i, text, start, end })) },
    features,
    chip_target: chip_target_id ? labelOf(chip_target_id) : null,
    people,
    referent_candidates: referents.map(({ label, kind, name, basis }) => ({ label, kind, name, basis })),
    conversation: {
      last_responders: labels(snapshot?.active_speaker?.speaker_ids ?? (snapshot?.active_speaker?.speaker_id ? [snapshot.active_speaker.speaker_id] : [])),
      last_speakers: [...new Set(labels(replies.map((r) => r.speaker_id)))],
      requests: requestView,
      pending_requests: requestView.filter((r) => ["OPEN", "PARTIALLY_SATISFIED"].includes(r.state)).map((r) => r.label),
      inbound,
      just_answered_inbound: justAnsweredView,
      activity,
      player_claim: claimView,
      salient_entities: [...new Set(canonicalSalient.map(refLabel).filter(Boolean))],
      active_place: activePlaceId ? refLabel(activePlaceId) : null,
      anaphora_candidates: anaphoraIds.map(refLabel).filter(Boolean),
      freshness: { exchange_fresh: Boolean(discourse?.last_turn), requests_in_window: requestView.length },
      previous_player_line: discourse?.last_turn?.player_text ? String(discourse.last_turn.player_text).slice(0, 200) : null,
      salience_source: SALIENCE_SOURCE
    },
    // Presentation-dependent (differs by wording provider): the words coworkers chose, the surface anchors cut from
    // them (their count and shape included), and the entities that wording named (heard salience). A reader may
    // use these to recognise an echo, a comment on what was said, or a reference to something a coworker named;
    // they are kept apart from the canonical conversation state above and never create a fact.
    heard: {
      presentation_dependent: true,
      lines: replies.map((r) => ({ speaker: labelOf(r.speaker_id), text: String(r.text ?? "").slice(0, 200) })).filter((l) => l.speaker && l.text),
      anchors: heardAnchors,
      anchor_count: heardAnchors.length,
      salient_entities: [...new Set(heardIds.map(refLabel).filter(Boolean))]
    }
  };
  return { input, bindings };
}

module.exports = { READER_INPUT_VERSION, SALIENCE_SOURCE, REQUEST_WINDOW, PLACE_DEIXIS, BASIS_ORDER, buildReaderInput, nameVocabulary, referentCandidates, optionText, requiredFactText, mentionedIds };
