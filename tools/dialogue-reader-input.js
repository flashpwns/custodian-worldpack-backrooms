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
// Deliberately absent: canonical ids, facts a reply was merely AUTHORIZED to say (optional facts), anyone's
// private or personhood state, knowledge records, and any model prompt text. Wording a coworker actually
// spoke is presentation-dependent (it differs by wording provider) and travels only in the separately marked
// `heard` channel.
//
// SALIENCE SOURCE (owner decision B7 pending, see docs/IMPLEMENTATION_STATE.md): salient entities here come
// from the player's own words and the replies' REQUIRED facts only. Production's `withSalience`
// (dialogue-turn.js) also reads OPTIONAL facts; that conflict is recorded, not resolved, in Phase 0.

const { normalizeUtterance } = require("./dialogue-normalize");
const canonicalKnowledge = require("./canonical-knowledge");

const READER_INPUT_VERSION = "yellow-beast-reader-input@v1";
const SALIENCE_SOURCE = "player_words+required_facts";
const REQUEST_WINDOW = 4;
const MAX_REFERENTS = 24;
const PLACE_ENTITY_IDS = new Set(["complex", "threshold", "outpost-a"]);

const WH = new Set(["who", "whom", "whose", "what", "where", "when", "why", "how", "which"]);
const SECOND_PERSON = new Set(["you", "your", "yours", "yourself", "yourselves", "u", "ya", "yall", "y'all", "ur"]);
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
function nameVocabulary({ present, entities, player }) {
  const vocab = new Map();
  // Name words only: function words and titles inside multi-word names ("the Control desk", "Dr. Kirk Maxwell")
  // are never name spans.
  const add = (word, ref) => { const w = low(word).replace(/[^a-z'-]/g, ""); if (w.length >= 3 && !NAME_STOP.has(w) && !vocab.has(w)) vocab.set(w, ref); };
  present.forEach((p, i) => { for (const n of [p.name, ...(p.names ?? [])]) for (const w of String(n ?? "").split(/\s+/)) add(w, { kind: "present", person: `p${i + 1}`, id: p.id }); });
  for (const w of (player?.names ?? []).flatMap((n) => String(n).split(/\s+/))) add(w, { kind: "player", id: player.id });
  // Known people who are not present: proper-name words of the canonical label ("Dr. Kirk Maxwell" -> Kirk,
  // Maxwell) and single-word canonical names -- never the words of a descriptive name phrase.
  for (const e of entities.filter((x) => x.kind === "person" && !x.is_player && !present.some((p) => p.id === x.id))) {
    const words = [...String(e.label ?? "").split(/\s+/).filter((w) => /^[A-Z][a-z]/.test(w)), ...(e.names ?? []).filter((n) => !/\s/.test(String(n).trim()))];
    for (const w of words) add(w, { kind: "absent", id: e.id });
  }
  return vocab;
}

const isReferentKind = (e) => e && (e.kind === "equipment" || e.kind === "location" || (e.kind === "entity" && PLACE_ENTITY_IDS.has(e.id)));
/**
 * Referent candidates (places and items) -- OBSERVER-SAFE by construction, never the canonical world index:
 * only things the conversation made salient, the explicit anaphoric set (what the last requests were about,
 * the active place), and things the player's own line names. Opaque labels r1..rN, salient first.
 */
function referentCandidates(entities, { salientIds = [], anaphoraIds = [], lineIds = [] } = {}) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const ordered = [...new Set([...salientIds, ...anaphoraIds, ...lineIds])].map((id) => byId.get(id)).filter(isReferentKind);
  return ordered.slice(0, MAX_REFERENTS).map((e, i) => ({ label: `r${i + 1}`, id: e.id, kind: e.kind === "equipment" ? "item" : "place", name: e.label, basis: salientIds.includes(e.id) ? "salient" : anaphoraIds.includes(e.id) ? "anaphora" : "line" }));
}
/** Text a coworker-question option may show a reader: an entity's name, an object's label -- never an id. */
const ID_LIKE = /^[a-z0-9]+(?:[-:][a-z0-9]+)+$/i;
function optionText(option, entities) {
  if (typeof option === "string") {
    const entity = entities.find((e) => e.id === option);
    if (entity) return entity.label ?? null;
    return ID_LIKE.test(option) ? null : option;
  }
  if (option && typeof option === "object") return typeof option.label === "string" ? option.label : null;
  return null;
}
/** Salience text from REQUIRED facts: string values (and string lists) only -- a structured value is not
 * scanned wholesale, so an unrelated nested name never becomes salient. */
function requiredFactText(facts) {
  return (facts ?? []).flatMap((f) => (typeof f?.value === "string" ? [f.value] : Array.isArray(f?.value) ? f.value.filter((v) => typeof v === "string") : [])).join(" ");
}

/** Character offset (in the normalized line) -> token index. */
function tokenAt(tokens, offset) { const i = tokens.findIndex((t) => offset >= t.start && offset < t.end); return i; }

/**
 * @param claim  Reader Phase 1 (owner ruling 3): the player's previous claim as READER STATE -- the facet /
 *               polarity / subject a validated reading of the player's previous line gave its statement act, and
 *               whether it is still fresh ({ facet, polarity, subject_ids, state }). Never the persisted legacy
 *               clause predicates. Absent (null) when no reader state exists (e.g. after a cold reload).
 */
function buildReaderInput({ raw, chip_target_id = null, present = [], player = null, entities = [], snapshot = null, ledger = null, discourse = null, claim = null, window = REQUEST_WINDOW } = {}) {
  const line = String(raw ?? "");
  const vocab = nameVocabulary({ present, entities, player });
  const normalized = normalizeUtterance(line, { names: [...vocab.keys()] });
  const tokens = normalized.tokens.map((t, i) => ({ i, text: t.text, start: t.raw_start, end: t.raw_end, n_start: t.start, n_end: t.end }));
  const words = tokens.filter(isWord);
  const bindings = { people: {}, names: {}, entities: {}, requests: {}, inbound: {}, options: {}, referents: {}, anchors: {}, activity: {}, claims: {} };

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
  const lineMentions = canonicalKnowledge.resolveEntityMentions(normalized.repaired, entities).filter((e) => e.kind !== "person");
  const entitySpans = [];
  const lowerNorm = low(normalized.repaired);
  for (const m of lineMentions) {
    const at = lowerNorm.indexOf(low(m.matched));
    if (at < 0) continue;
    const a = tokenAt(normalized.tokens, at);
    const b = tokenAt(normalized.tokens, at + String(m.matched).length - 1);
    if (a < 0 || b < 0) continue;
    const label = `e${entitySpans.length + 1}`;
    bindings.entities[label] = m.id;
    entitySpans.push({ label, tokens: [a, b], text: line.slice(tokens[a].start, tokens[b].end), kind: m.kind === "equipment" ? "item" : ["location", "entity"].includes(m.kind) ? "place" : m.kind, candidate: null });
  }
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
    const options = (pendingInbound.options ?? []).map((o, i) => { bindings.options[`o${i + 1}`] = o; return { label: `o${i + 1}`, text: optionText(o, entities) }; });
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

  // Salience: the player's own words and the replies' REQUIRED facts (never optional facts, never wording).
  const replies = discourse?.last_turn?.responses ?? [];
  const requiredText = replies.map((r) => requiredFactText(r.facts?.required)).join(" ");
  const salienceText = [snapshot?.last_request?.request_text ?? "", discourse?.last_turn?.player_text ?? "", requiredText].join(" ");
  const salientMentions = canonicalKnowledge.resolveEntityMentions(salienceText, entities).filter((e) => e.kind !== "person");
  const salientIds = [...new Set(salientMentions.map((e) => e.id))];
  // The explicit anaphoric / deictic set: what the most recent requests were about (canonical args), and the
  // active place. "it", "that", "there" may choose only among these (or salient / named things).
  const anaphoraIds = [...new Set([snapshot?.last_request?.args?.item_id, snapshot?.last_request?.args?.place_id, snapshot?.last_substantive_request?.args?.item_id, snapshot?.last_substantive_request?.args?.place_id].filter(Boolean))];
  // Items a named TASK canonically carries ("the startup materials" -> its duffle): canonical association of
  // something the player's own line named (canonical-knowledge TASK_ITEMS), never a guess.
  const taskItems = lineMentions.filter((m) => m.kind === "task").flatMap((m) => {
    const pattern = canonicalKnowledge.TASK_ITEMS?.[String(m.id).replace(/^task:/, "")] ?? null;
    return pattern ? entities.filter((e) => e.kind === "equipment" && (pattern.test(e.id) || pattern.test(String(e.label ?? "")))).map((e) => e.id) : [];
  });
  const referents = referentCandidates(entities, { salientIds, anaphoraIds, lineIds: [...lineMentions.map((m) => m.id), ...taskItems] });
  for (const r of referents) bindings.referents[r.label] = r.id;
  const refLabel = (id) => referents.find((r) => r.id === id)?.label ?? null;
  for (const span of entitySpans) span.candidate = refLabel(bindings.entities[span.label]);
  const activePlaceId = snapshot?.last_request?.args?.place_id ?? salientIds.find((id) => referents.find((r) => r.id === id)?.kind === "place") ?? null;

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
      salient_entities: salientIds.map(refLabel).filter(Boolean),
      active_place: activePlaceId ? refLabel(activePlaceId) : null,
      anaphora_candidates: anaphoraIds.map(refLabel).filter(Boolean),
      freshness: { exchange_fresh: Boolean(discourse?.last_turn), requests_in_window: requestView.length },
      previous_player_line: discourse?.last_turn?.player_text ? String(discourse.last_turn.player_text).slice(0, 200) : null,
      salience_source: SALIENCE_SOURCE
    },
    // Presentation-dependent (differs by wording provider): the words coworkers chose, and the surface anchors
    // cut from them (their count and shape included). A reader may use these only to recognise an echo or a
    // comment on what was said; they are kept apart from the canonical conversation state above.
    heard: {
      presentation_dependent: true,
      lines: replies.map((r) => ({ speaker: labelOf(r.speaker_id), text: String(r.text ?? "").slice(0, 200) })).filter((l) => l.speaker && l.text),
      anchors: heardAnchors,
      anchor_count: heardAnchors.length
    }
  };
  return { input, bindings };
}

module.exports = { READER_INPUT_VERSION, SALIENCE_SOURCE, REQUEST_WINDOW, PLACE_DEIXIS, buildReaderInput, nameVocabulary, referentCandidates, optionText, requiredFactText };
