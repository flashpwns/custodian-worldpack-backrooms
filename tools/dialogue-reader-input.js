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

const isWord = (t) => /^[A-Za-z@]/.test(t.text);
const low = (s) => String(s ?? "").toLowerCase();

/** Person-name vocabulary: present coworkers (labelled), other known persons (absent) and the player. */
function nameVocabulary({ present, entities, player }) {
  const vocab = new Map();
  const add = (word, ref) => { const w = low(word).replace(/[^a-z'-]/g, ""); if (w.length >= 3 && w !== "dr" && !vocab.has(w)) vocab.set(w, ref); };
  present.forEach((p, i) => { for (const n of [p.name, ...(p.names ?? [])]) for (const w of String(n ?? "").split(/\s+/)) add(w, { kind: "present", person: `p${i + 1}`, id: p.id }); });
  for (const w of (player?.names ?? []).flatMap((n) => String(n).split(/\s+/))) add(w, { kind: "player", id: player.id });
  for (const e of entities.filter((x) => x.kind === "person" && !x.is_player && !present.some((p) => p.id === x.id))) for (const w of (e.names ?? [e.label]).flatMap((n) => String(n).split(/\s+/))) add(w, { kind: "absent", id: e.id });
  return vocab;
}

/** Referent candidates (places and items), salient first; opaque labels r1..rN. */
function referentCandidates(entities, salientIds, lineIds) {
  const pool = entities.filter((e) => e.kind === "equipment" || e.kind === "location" || (e.kind === "entity" && PLACE_ENTITY_IDS.has(e.id)));
  const rank = (e) => (salientIds.includes(e.id) ? 0 : lineIds.includes(e.id) ? 1 : 2);
  return [...pool].sort((a, b) => rank(a) - rank(b) || pool.indexOf(a) - pool.indexOf(b)).slice(0, MAX_REFERENTS).map((e, i) => ({ label: `r${i + 1}`, id: e.id, kind: e.kind === "equipment" ? "item" : "place", name: e.label }));
}

/** Character offset (in the normalized line) -> token index. */
function tokenAt(tokens, offset) { const i = tokens.findIndex((t) => offset >= t.start && offset < t.end); return i; }

function buildReaderInput({ raw, chip_target_id = null, present = [], player = null, entities = [], snapshot = null, ledger = null, discourse = null, window = REQUEST_WINDOW } = {}) {
  const line = String(raw ?? "");
  const vocab = nameVocabulary({ present, entities, player });
  const normalized = normalizeUtterance(line, { names: [...vocab.keys()] });
  const tokens = normalized.tokens.map((t, i) => ({ i, text: t.text, start: t.raw_start, end: t.raw_end, n_start: t.start, n_end: t.end }));
  const words = tokens.filter(isWord);
  const bindings = { people: {}, names: {}, entities: {}, requests: {}, inbound: {}, options: {}, referents: {}, anchors: {}, activity: {} };

  // People: present coworkers only, opaque labels in canonical (team) order.
  const people = present.map((p, i) => { bindings.people[`p${i + 1}`] = p.id; return { label: `p${i + 1}`, name: p.name, present: true, eligible: true }; });
  const labelOf = (id) => { const i = present.findIndex((p) => p.id === id); return i >= 0 ? `p${i + 1}` : null; };
  const labels = (ids) => (ids ?? []).map(labelOf).filter(Boolean);

  // ── surface features (code, paraphrase-invariant; no decisions) ──
  const nameSpans = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const ref = isWord(tokens[k]) ? vocab.get(low(tokens[k].text)) : null;
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
      standalone: words.every((w) => w.i >= k && w.i <= end)
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
    const options = (pendingInbound.options ?? []).map((o, i) => { bindings.options[`o${i + 1}`] = o; return { label: `o${i + 1}`, text: typeof o === "string" ? o : String(o?.label ?? o?.id ?? "") }; });
    return { label: "i1", from: labelOf(pendingInbound.from ?? pendingInbound.speaker_id), kind: pendingInbound.kind ?? null, facet: pendingInbound.predicate ?? null, answer_shape: pendingInbound.answer_shape ?? null, options, options_source: options.length ? "ledger" : "none" };
  })() : null;
  const justAnswered = snapshot?.just_answered_inbound ?? null;
  const justAnsweredView = justAnswered ? (() => { bindings.inbound.i0 = justAnswered.event_id ?? null; return { label: "i0", from: labelOf(justAnswered.from ?? justAnswered.speaker_id) }; })() : null;
  const activity = snapshot?.activity ? { label: "v1", kind: snapshot.activity.kind, facet: snapshot.activity.template?.predicate ?? null, done: labels(snapshot.activity.completed), remaining: labels((snapshot.activity.eligible ?? []).filter((id) => !(snapshot.activity.completed ?? []).includes(id))) } : null;
  if (activity) bindings.activity = { v1: snapshot.activity.activity_id ?? null };

  // Salience: the player's own words and the replies' REQUIRED facts (never optional facts, never wording).
  const replies = discourse?.last_turn?.responses ?? [];
  const requiredText = replies.flatMap((r) => r.facts?.required ?? []).map((f) => (typeof f.value === "string" ? f.value : JSON.stringify(f.value ?? ""))).join(" ");
  const salienceText = [snapshot?.last_request?.request_text ?? "", discourse?.last_turn?.player_text ?? "", requiredText].join(" ");
  const salientMentions = canonicalKnowledge.resolveEntityMentions(salienceText, entities).filter((e) => e.kind !== "person");
  const salientIds = [...new Set([snapshot?.last_request?.args?.place_id, snapshot?.last_request?.args?.item_id, ...salientMentions.map((e) => e.id)].filter(Boolean))];
  const referents = referentCandidates(entities, salientIds, lineMentions.map((m) => m.id));
  for (const r of referents) bindings.referents[r.label] = r.id;
  const refLabel = (id) => referents.find((r) => r.id === id)?.label ?? null;
  for (const span of entitySpans) span.candidate = refLabel(bindings.entities[span.label]);
  const activePlaceId = snapshot?.last_request?.args?.place_id ?? salientIds.find((id) => referents.find((r) => r.id === id)?.kind === "place") ?? null;

  // Surface anchors: which request each spoken sentence answered (ledger metadata); their TEXT is heard wording.
  const anchors = [];
  const heardAnchors = [];
  for (const a of snapshot?.surface_anchors ?? []) (a.spans ?? []).forEach((span, j) => {
    const label = `a${anchors.length + 1}`;
    bindings.anchors[label] = { event_id: a.event_id ?? null, span: j };
    anchors.push({ label, speaker: labelOf(a.speaker_id), request: requestLabel(span.request_id), facet: span.predicate ?? null });
    heardAnchors.push({ anchor: label, text: String(span.text ?? "").slice(0, 200) });
  });

  const input = {
    version: READER_INPUT_VERSION,
    line: { raw: line, normalized: normalized.repaired, tokens: tokens.map(({ i, text, start, end }) => ({ i, text, start, end })) },
    features,
    chip_target: chip_target_id ? labelOf(chip_target_id) : null,
    people,
    referent_candidates: referents.map(({ label, kind, name }) => ({ label, kind, name })),
    conversation: {
      last_responders: labels(snapshot?.active_speaker?.speaker_ids ?? (snapshot?.active_speaker?.speaker_id ? [snapshot.active_speaker.speaker_id] : [])),
      last_speakers: [...new Set(labels(replies.map((r) => r.speaker_id)))],
      requests: requestView,
      pending_requests: requestView.filter((r) => ["OPEN", "PARTIALLY_SATISFIED"].includes(r.state)).map((r) => r.label),
      inbound,
      just_answered_inbound: justAnsweredView,
      activity,
      salient_entities: salientIds.map(refLabel).filter(Boolean),
      active_place: activePlaceId ? refLabel(activePlaceId) : null,
      surface_anchors: anchors,
      freshness: { exchange_fresh: Boolean(discourse?.last_turn), requests_in_window: requestView.length, anchors_fresh: anchors.length > 0 },
      previous_player_line: discourse?.last_turn?.player_text ? String(discourse.last_turn.player_text).slice(0, 200) : null,
      salience_source: SALIENCE_SOURCE
    },
    // Presentation-dependent: words a wording provider chose. A reader may use them only to recognise an echo
    // or a comment on what was said; canonical routing never depends on them except through a surface anchor.
    heard: {
      presentation_dependent: true,
      lines: replies.map((r) => ({ speaker: labelOf(r.speaker_id), text: String(r.text ?? "").slice(0, 200) })).filter((l) => l.speaker && l.text),
      anchors: heardAnchors
    }
  };
  return { input, bindings };
}

module.exports = { READER_INPUT_VERSION, SALIENCE_SOURCE, REQUEST_WINDOW, buildReaderInput, nameVocabulary };
