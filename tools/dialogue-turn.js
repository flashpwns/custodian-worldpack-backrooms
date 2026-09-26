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
    if (INSIDE_DEIXIS.test(text) || /\bin there\b/i.test(text)) return { place_id: "complex", basis: "domain_default_inside" };
    return { place_id: null, basis: "unresolved_deixis" };
  }
  return null;
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

/** The request an elliptical line inherits: the active activity's template, else the most recent request. */
function antecedentOf(act, dis) {
  if (["turn", "same_question"].includes(act.ellipsis?.kind) && dis?.activity) return { from: "activity", request: { predicate: dis.activity.template.predicate, fn: dis.activity.template.fn, request_text: dis.activity.template.request_text, targets: [...dis.activity.completed], answered_by: [...dis.activity.completed], request_id: null, args: null }, activity: dis.activity };
  // "Tonya, have you?" right after the player's own claim about her: the claim's question, asked of her.
  if (act.ellipsis?.aux && dis?.last_player_claim?.predicate && CANONICAL_QUESTION[dis.last_player_claim.predicate]) return { from: "player_claim", request: { predicate: dis.last_player_claim.predicate, fn: null, request_text: CANONICAL_QUESTION[dis.last_player_claim.predicate], targets: [], answered_by: [], request_id: null, args: null, temporal: registry.get(dis.last_player_claim.predicate)?.default_temporal ?? null } };
  // A meta question ("Why?", "What do you mean?") is about one reply; "What about Tonya?" after it carries the
  // substantive question before it.
  if (dis?.last_request?.request_text && String(dis.last_request.predicate ?? "").startsWith("conversation.") && dis?.last_substantive_request?.request_text && ["how_about", "turn", "same_question"].includes(act.ellipsis?.kind)) return { from: "last_substantive_request", request: dis.last_substantive_request };
  if (dis?.last_request?.request_text) return { from: "last_request", request: dis.last_request };
  if (dis?.activity) return { from: "activity", request: { predicate: dis.activity.template.predicate, fn: dis.activity.template.fn, request_text: dis.activity.template.request_text, targets: [...dis.activity.completed], answered_by: [...dis.activity.completed], request_id: null, args: null }, activity: dis.activity };
  return null;
}

function cardinalityFor(predicate, addressee, act) {
  const entry = predicate ? registry.get(predicate) : null;
  let card = entry?.default_cardinality ?? null;
  if (!card) {
    if (["greeting", "self_introduction", "farewell"].includes(act.speech_act)) return addressee.kind === "explicit" || addressee.kind === "inherited" ? "each_ack" : "each_ack";
    if (SOCIAL.has(act.speech_act)) return "none";
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
  const entityVocab = words(["entity", "location", "person", "institution"]).filter((n) => /^[a-z]{6,}$/.test(n));
  const protect = words(["entity", "location", "person", "institution", "equipment", "procedure", "task"]).filter((n) => /^[a-z]{3,}$/.test(n));
  const parsed = acts.parseActs(raw, { people, vocabulary: [...new Set([...vocabulary, ...entityVocab])], protect });
  const substantive = parsed.acts.filter((a) => !SOCIAL.has(a.speech_act));
  const closes = parsed.acts.some((a) => a.closes_activity);
  const effective = [];
  const missing = [];
  const presentIds = people.map((p) => p.id);

  for (const original of (substantive.length ? substantive : parsed.acts.slice(0, 1))) {
    // "I mean for the day" names no canonical thing: it is the legacy self-repair fragment of the last
    // question, not a referent repair (the legacy frame narrows the question with it).
    const unresolvedReferent = original.speech_act === "repair" && original.repair?.kind === "referent" && !placeOf(original.repair.referent ?? "", entities, null)?.place_id && !canonicalKnowledge.resolveEntityMentions(original.repair.referent ?? "", entities).length;
    const act = unresolvedReferent ? { ...original, speech_act: "statement", repair: null, body: original.body || original.text } : original;
    // A repair-lead marker ("I mean ...", "No, ...") stays in the text the legacy frame reads: it is the
    // self-repair cue of the previous question.
    const e = { act, speech_act: act.speech_act, question_form: act.question_form, relation: "new", relation_target: null, request_text: act.marker_relation === "repair" && act.speech_act === "statement" ? act.text : (act.body || act.text), predicate: null, facet_source: null, addressee: null, cardinality: null, temporal_scope: null, polarity: act.polarity, alternatives: act.alternatives, args: {}, reissue_of: null, repair: null, clarify: null, overrides: [] };
    const top = act.predicate_candidates[0] ?? null;
    // "Is this your first time going in?" asks the predicate inverted: a yes means NO experience. Carried in the
    // args so a repair or ellipsis re-asking the same question keeps it (review F2).
    if (act.marker_relation === "continuation") e.relation = "continuation";
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
          e.predicate = embeddedPredicate ?? target.predicate;
          e.request_text = embeddedPredicate && embeddedPredicate !== target.predicate ? act.repair.embedded : target.request_text;
          e.fn_hint = embeddedPredicate && embeddedPredicate !== target.predicate ? null : target.fn;
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
              e.request_text = before ? String(last.request_text).replace(new RegExp(before.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), act.repair.referent) : `${String(last.request_text).replace(/[?.!\s]+$/, "")} -- ${act.repair.referent}?`;
              if (place?.place_id) e.args = { ...e.args, place_id: place.place_id };
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
          if (named && before) { e.request_text = String(last.request_text).replace(new RegExp(before.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), act.ellipsis.topic_text); e.predicate = last.predicate; e.reissue_of = null; e.relation_target = last.request_id; }
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
        else if (String(e.predicate ?? "").startsWith("conversation.") && !(ante_request.targets ?? []).some((id) => addressee.ids.includes(id))) { e.clarify = { reason: "ellipsis_meta_not_transferable", slot: "topic" }; missing.push("ellipsis_meta_not_transferable"); }
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
      // The coworker just asked the player something: a fragment/statement is the ANSWER, for the asker.
      const asker = dis?.active_speaker?.speaker_id ?? null;
      if (dis?.npc_question && act.speech_act === "statement" && !act.vocatives.length && asker && presentIds.includes(asker)) { e.addressee = { kind: "inherited", ids: [asker], quantifier: null, source: "open_question_answer" }; e.relation = "answer"; e.speech_act = "answer"; }
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
      const place = placeOf(e.request_text ?? act.body, entities, dis, { apposition: act.apposition });
      if (place?.place_id) e.args.place_id = place.place_id;
      else if (place?.basis === "unresolved_deixis" && e.predicate === "person.complex_experience" && (dis?.last_request || dis?.salient_place || dis?.active_speaker)) {
        // "Have you been there before?" mid-conversation with no other place salient: at this table "there" is
        // where the expedition goes (the Complex). As the very first thing said, nothing anchors it: clarify
        // (review F10). Any other predicate with an unresolved "there" is clarified.
        e.args.place_id = "complex"; place.basis = "domain_default_there";
      } else if (place?.basis === "unresolved_deixis") { e.clarify = { reason: "deixis_unresolved", slot: "location" }; missing.push("deixis_unresolved"); }
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
    const interrogative = (["question", "request"].includes(e.speech_act) || /\?\s*$/.test(e.act?.text ?? "")) && !(e.speech_act === "attention_call" && !e.request_text);
    const generic = !frame || (["make_statement", "ask_factual"].includes(frame.discourse_function) && !frame.addressee_state && !frame.past_perception && !(frame.referents ?? []).some((r) => r.resolved)) || (frame.discourse_function === "ambiguous_reference" && frame.tier1_generic);
    if (interrogative && !e.predicate && generic) missing.push("facet_unresolved");
    if (e.act?.vocatives?.length && !(e.addressee?.ids ?? []).length && !e.absent_addressees) missing.push("name_unresolved");
    if (e.addressee?.second_person && e.relation !== "new" && !(e.addressee?.ids ?? []).length) missing.push("second_person_no_target");
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
  if (fn === "ask_item_ownership" && (frame.referents ?? []).some((r) => r.type === "equipment" && r.resolved) && entry.domain !== "person" && !["item.destination", "item.purpose", "item.contents", "item.status"].includes(entry.id)) return { ...out, predicate: "item.holder" };
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
  return Object.freeze({ ...(snapshot ?? {}), salient_place: place, npc_question: Boolean(snapshot?.npc_question ?? discourse?.pending_question) });
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
  if (entry?.id === "person.familiarity" && !args.other_id) args.others = (frame?.turn?.addressee_ids ?? []).filter((id) => id !== responderId);
  return args;
}

/**
 * The frame the planner receives: the legacy frame (entities, referents, antecedents) with the registry
 * facet reconciled onto it (D16), the effective act's relation/cardinality/arguments attached, and a
 * clarification when the act could not be resolved (fail closed, never a guess).
 */
function finalizeFrame(frame, primary, rec, { completeness = null, entities = [] } = {}) {
  if (!frame) return frame;
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
function applyAdvisory(analysis, advice, { present = [] } = {}) {
  if (!analysis?.primary || !advice?.accepted || advice.version !== "yellow-beast-dialogue-advisory@v2") return analysis;
  const e = { ...analysis.primary, overrides: [...(analysis.primary.overrides ?? [])] };
  const act = advice.acts.at(-1);
  const presentIds = present.map((p) => p.id);
  // With the Tier-1 gaps known, a reading fills ONLY those gaps (an untargeted question is not missing an
  // addressee; a question the legacy frame typed is not missing a facet).
  const gaps = Array.isArray(advice.tier1_missing) ? new Set(advice.tier1_missing) : null;
  const may = (...reasons) => !gaps || reasons.some((r) => gaps.has(r));
  if (!may("facet_unresolved", "name_unresolved", "second_person_no_target")) return analysis;
  if (!e.predicate && act.facet && registry.get(act.facet) && may("facet_unresolved")) { e.predicate = act.facet; e.facet_source = "tier2_advisory"; e.overrides.push({ field: "predicate", to: act.facet, reason: "advisory_filled_missing_facet" }); }
  if (!(e.addressee?.ids ?? []).length && act.addressee_id && presentIds.includes(act.addressee_id) && may("name_unresolved", "second_person_no_target")) { e.addressee = { kind: "explicit", ids: [act.addressee_id], quantifier: null, source: "advisory_candidate" }; e.overrides.push({ field: "addressee", to: act.addressee_id, reason: "advisory_filled_missing_addressee" }); }
  if (!(e.addressee?.ids ?? []).length && ["all", "each", "any"].includes(act.quantifier) && e.predicate && may("name_unresolved", "second_person_no_target")) { e.addressee = { kind: "group", ids: presentIds, quantifier: act.quantifier === "any" ? "any" : "all", source: "advisory_quantifier" }; }
  const entry = e.predicate ? registry.get(e.predicate) : null;
  if (entry?.slots?.place && !e.args?.place_id && act.referent_id && may("place_unresolved", "deixis_unresolved")) e.args = { ...(e.args ?? {}), place_id: act.referent_id, place_basis: "advisory_candidate" };
  if (e.clarify && e.predicate && (e.addressee?.ids ?? []).length && !["quantifier_mismatch", "repair_target_unresolved", "misunderstood", "referent_repair_mismatch", "ellipsis_meta_not_transferable"].includes(e.clarify.reason)) { e.overrides.push({ field: "clarify", from: e.clarify.reason, reason: "advisory_completed" }); e.clarify = null; }
  if (e.addressee) e.cardinality = cardinalityFor(e.predicate, e.addressee, e);
  const effective = [...analysis.effective.slice(0, -1), e];
  return Object.freeze({ ...analysis, effective, primary: e, advisory: { applied: true, acts: advice.acts.length } });
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
function turnRecord(analysis, { frame = null, request_ids = [], completeness = null } = {}) {
  if (!analysis) return null;
  const e = analysis.primary;
  return {
    version: TURN_VERSION,
    normalized: analysis.normalized.repaired,
    repairs_applied: analysis.normalized.repairs.map((r) => `${r.kind}:${r.from}>${r.to}`),
    clauses: analysis.acts.map((a) => ({ text: a.text, speech_act: a.speech_act, question_form: a.question_form, markers: a.markers, vocatives: a.vocatives.map((v) => v.id ?? v.name), mentions: a.mentions.map((m) => m.id ?? m.name), predicate_candidates: a.predicate_candidates.map((c) => c.id), repair: a.repair?.kind ?? null, ellipsis: a.ellipsis?.kind ?? null, quantifier: a.quantifier?.kind ?? null, temporal: a.temporal_scope ?? null, polarity: a.polarity ?? null, indirect: a.indirect ? a.indirect.wrapper : null })),
    primary: e ? { speech_act: e.speech_act, question_form: e.question_form, relation: e.relation, relation_target: e.relation_target, reissue_of: e.reissue_of, predicate: frame?.predicate ?? e.predicate, request_text: e.request_text, addressee: e.addressee ? { kind: e.addressee.kind, ids: [...e.addressee.ids], quantifier: e.addressee.quantifier, source: e.addressee.source } : null, cardinality: e.cardinality, temporal_scope: e.temporal_scope, alternatives: e.alternatives, args: e.args, clarify: e.clarify, repair: e.repair ?? null } : null,
    extra_acts: analysis.effective.slice(0, -1).map((x) => ({ speech_act: x.speech_act, predicate: x.predicate, request_text: x.request_text })),
    closes_activity: analysis.closes_activity,
    completeness: completeness ?? analysis.completeness,
    request_ids: [...request_ids],
    dropped: [...analysis.dropped]
  };
}

module.exports = { TURN_VERSION, analyzeTurn, completenessWithFrame, reconcile, resolveAddressee, peopleIndex, placeOf, cardinalityFor, STRUCTURAL_KEEP, withSalience, addressFromTurn, argsFor, finalizeFrame, subjectCheckIn, ownersByCardinality, turnRecord, applyAdvisory, advisoryCandidates };
