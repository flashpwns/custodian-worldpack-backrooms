"use strict";

// Reader Phase 1 -- the TABLE-DRIVEN RESPONSE POLICY (pure; SHADOW only).
//
// Who is addressed, who answers, who hears, how many voices, and whether silence is a valid outcome -- decided
// from canonical, structured inputs only:
//
//   decideResponse({ act, address, owners, present, candidates, cardinality }) ->
//     { addressees, responders, recipients, listeners, cardinality, response_required, silence, owner_basis, reasons }
//
//   act          the resolved act's structured reading: speech_act, facet, claim_facet, relation, reply_kind, address_op,
//                respondent_mode, third_party_subject, quoted_speaker (a reported-speech facet's speaker),
//                assignment_question (the facet asks what a task / item is for), outcome ("resolved" | "clarify"),
//                vacuous (a repair that changes nothing)
//   address      the resolved addressee set { kind, ids, source } (language-level address op already mapped to
//                canonical ids by resolveTurn; the chip already applied)
//   owners       canonical antecedent owners resolveTurn found: { explicit, repair_target, antecedent_owner,
//                activity_target, inbound_asker, item_holder } (id lists; item_holder from canonical custody)
//   present      the eligible present listeners (canonical team order)
//   candidates   canonical per-listener flags { [id]: { knows_fully, has_relevant_knowledge, last_spoke_seq } } or
//                null when none were computed for this facet (the policy then never invents a knower)
//   cardinality  the registry cardinality for the act (resolveTurn computes it with dialogue-turn.cardinalityFor)
//
// It never sees the player's words (no text field is an input), never calls a model and never mutates anything.
// Production's resolveResponseOwners is NOT changed in Phase 1; this module is the shadow authority the
// comparator measures against it.
//
// OWNER PRIORITY (ratified 2026-09-27 #1, unchanged): explicit target > repair target > semantic antecedent owner
// > active activity target > knowledgeable eligible responder > fairness rotation.

const POLICY_VERSION = "yellow-beast-response-policy@v1";

const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);
const REMARK = new Set(["statement", "sarcasm", "aside", "social_acknowledgment", "thanks"]);
const SOCIAL_OPENING = new Set(["greeting", "farewell", "self_introduction"]);
const EACH = new Set(["each_self", "each_self_concise", "each_ack"]);
const ONE = new Set(["one_spokesperson", "one_knower"]);

/**
 * The response table: speech-act class -> whether a response is required, whether silence is a valid outcome,
 * and the voice rule applied to the owner chain. Rows are data; the owner chain below is the only procedure.
 */
const RESPONSE_TABLE = Object.freeze({
  // A question / request / repair / continuation / attention call is never left in silence.
  asking: Object.freeze({ response_required: true, silence_valid: false, voices: "by_cardinality" }),
  // The reader could not settle the reading (validator clarify / rejected routing field): ONE voice asks.
  clarify: Object.freeze({ response_required: true, silence_valid: false, voices: "one_clarifier" }),
  // The player answered a coworker's question: nothing is asked (cardinality none); the line is put to the asker,
  // whose next turn -- not a response owner -- carries the conversation on.
  answer: Object.freeze({ response_required: false, silence_valid: true, voices: "none" }),
  // The player introducing themself: each present teammate may acknowledge ONCE, briefly (a narrow social policy
  // -- not "every group statement gets everyone").
  self_introduction: Object.freeze({ response_required: true, silence_valid: false, voices: "each_present" }),
  // Greeting / farewell: each addressed person acknowledges once; put to nobody in particular, one voice.
  social_opening: Object.freeze({ response_required: true, silence_valid: false, voices: "each_addressed_or_one" }),
  // A claim the player makes (a statement the reader gave a claim facet) is acknowledged by ONE listener -- never
  // confirmed, never a chorus; put to the whole group it needs no answer (legacy "player claim" rule, read from the
  // reader's claim facet instead of a regex).
  claim: Object.freeze({ response_required: false, silence_valid: true, voices: "one_acknowledger" }),
  // Owner decision (2026-09-27) #2: a remark, sarcasm, aside or acknowledgment requires no response; addressed to
  // someone by name, that person answers.
  remark: Object.freeze({ response_required: false, silence_valid: true, voices: "addressee_only" })
});

function rowOf(act) {
  if (act?.outcome === "clarify") return ["clarify", RESPONSE_TABLE.clarify];
  if (act?.speech_act === "answer") return ["answer", RESPONSE_TABLE.answer];
  if (ASKING.has(act?.speech_act)) return ["asking", RESPONSE_TABLE.asking];
  if (act?.speech_act === "self_introduction") return ["self_introduction", RESPONSE_TABLE.self_introduction];
  if (SOCIAL_OPENING.has(act?.speech_act)) return ["social_opening", RESPONSE_TABLE.social_opening];
  if (act?.speech_act === "statement" && act?.claim_facet) return ["claim", RESPONSE_TABLE.claim];
  return ["remark", RESPONSE_TABLE.remark];
}

/** Fairness rotation: the one who spoke least recently (canonical dialogue history), ties in team order. */
function rotation(ids, candidates) {
  if (!ids.length) return null;
  const seq = (id) => (Number.isFinite(candidates?.[id]?.last_spoke_seq) ? candidates[id].last_spoke_seq : -1);
  return ids.reduce((best, id) => (seq(id) < seq(best) ? id : best), ids[0]);
}
/** The knowledgeable eligible responders: full knowers, else partial knowers; never invented. */
function knowers(ids, candidates) {
  if (!candidates) return [];
  const full = ids.filter((id) => candidates[id]?.knows_fully);
  return full.length ? full : ids.filter((id) => candidates[id]?.has_relevant_knowledge);
}

/**
 * One voice among `pool` by the ratified owner chain. Returns { id, basis }. Levels whose owner is not in the
 * pool are skipped (an owner who cannot hear the line never answers it).
 */
function oneVoice(pool, { owners = {}, candidates = null, subject = null, preferOwner = false }) {
  const within = (ids) => (ids ?? []).filter((id) => pool.includes(id));
  const chain = [
    ["explicit_target", within(owners.explicit)],
    ["repair_target", within(owners.repair_target)],
    ["antecedent_owner", within(owners.antecedent_owner)],
    ["activity_target", within(owners.activity_target)]
  ];
  for (const [basis, ids] of chain) if (ids.length === 1) return { id: ids[0], basis };
  // A question about a named person is best answered by that person when they are among those asked.
  if (subject && pool.includes(subject)) return { id: subject, basis: "subject_self" };
  // The canonical holder of the item asked about knows where it is / who has it.
  const holder = within(owners.item_holder);
  if (holder.length === 1) return { id: holder[0], basis: "item_holder" };
  // The one whose assignment it is answers -- unless they do not know and someone else does.
  if (preferOwner && candidates) {
    const owner = pool.find((id) => candidates[id]?.owns_entity) ?? null;
    const fullKnowers = pool.filter((id) => candidates[id]?.knows_fully);
    if (owner && (candidates[owner].knows_fully || !fullKnowers.length)) return { id: owner, basis: "assignment_owner" };
  }
  const known = knowers(pool, candidates);
  if (known.length) return { id: rotation(known, candidates), basis: "knowledgeable_responder" };
  const id = rotation(pool, candidates);
  return id ? { id, basis: "fairness_rotation" } : { id: null, basis: "nobody_eligible" };
}

function decideResponse({ act = {}, address = null, owners = {}, present = [], candidates = null, cardinality = null } = {}) {
  const reasons = [];
  const presentIds = [...present];
  const addressees = (address?.ids ?? []).filter((id) => presentIds.includes(id));
  const [rowName, row] = rowOf(act);
  reasons.push(`row:${rowName}`);
  let card = rowName === "clarify" ? "one_clarifier" : rowName === "answer" ? "none" : act.vacuous ? "each_ack" : cardinality ?? (rowName === "asking" ? "one_spokesperson" : rowName === "social_opening" ? "each_ack" : "none");
  if (rowName === "clarify") reasons.push("clarify:no_default_spokesperson");
  // The pool that may answer: the addressees when the line addressed someone; otherwise everyone who heard it.
  // A quoted speaker ("What did Tonya say?") is not the one who reports it when someone else heard it.
  const quoted = act.quoted_speaker ?? null;
  const basePool = addressees.length ? addressees : presentIds;
  const pool = quoted && basePool.some((id) => id !== quoted) ? basePool.filter((id) => id !== quoted) : basePool;
  if (pool !== basePool) reasons.push("quoted_speaker_excluded");
  const subject = act.third_party_subject ?? null;
  const preferOwner = Boolean(act.assignment_question);
  let responders = [];
  let basis = null;

  if (row.voices === "one_clarifier") {
    // The one the player was talking to asks: an explicit addressee, else the antecedent owner, else rotation.
    const voice = oneVoice(pool, { owners: { explicit: addressees.length === 1 ? addressees : [], antecedent_owner: (owners.antecedent_owner ?? []).length ? owners.antecedent_owner : owners.active_speaker }, candidates: null });
    responders = voice.id ? [voice.id] : [];
    basis = voice.basis;
  } else if (row.voices === "none") {
    responders = [];
    basis = rowName === "answer" ? "answer_to_asker_no_response_owner" : "no_response";
  } else if (row.voices === "each_present") {
    responders = [...presentIds];
    basis = "each_present_acknowledges";
  } else if (row.voices === "one_acknowledger") {
    const group = address?.kind === "group";
    const named = addressees.length && !group ? [addressees[0]] : [];
    const v = group ? { id: null, basis: "claim_to_group_silence" } : named.length ? { id: named[0], basis: "explicit_target" } : oneVoice(presentIds, { owners: {}, candidates: null });
    responders = v.id ? [v.id] : [];
    basis = v.basis;
  } else if (row.voices === "addressee_only") {
    // A remark is answered only by someone it was addressed to by name (or the chip); the room stays silent.
    const named = address && ["explicit", "subset"].includes(address.kind) && ["vocative", "chip", "repair", "legacy_correction"].includes(address.source) ? addressees : [];
    responders = named.length ? [named[0]] : [];
    basis = named.length ? "explicit_target" : "remark_silence";
  } else if (row.voices === "each_addressed_or_one") {
    const group = address?.kind === "group" || (address?.kind === "subset" && addressees.length > 1);
    responders = group ? [...addressees] : addressees.length ? [addressees[0]] : (() => { const v = oneVoice(presentIds, { owners, candidates: null }); return v.id ? [v.id] : []; })();
    basis = group ? "each_addressed" : addressees.length ? "explicit_target" : "fairness_rotation";
  } else if (EACH.has(card)) {
    // Each addressed person answers for themselves when a group was addressed; otherwise one voice.
    const group = address?.kind === "group" || addressees.length > 1;
    if (subject && pool.includes(subject)) { responders = [subject]; basis = "subject_self"; }
    else if (group) { responders = [...addressees]; basis = "each_addressed"; }
    else { const v = oneVoice(pool, { owners: { ...owners, explicit: addressees }, candidates, subject, preferOwner }); responders = v.id ? [v.id] : []; basis = v.basis; }
  } else if (card === "none") {
    responders = [];
    basis = "cardinality_none";
  } else {
    // one_spokesperson / one_knower: one voice by the owner chain (explicit > repair > antecedent > activity >
    // knower > rotation).
    const v = oneVoice(pool, { owners: { ...owners, explicit: addressees.length === 1 ? addressees : owners.explicit }, candidates, subject, preferOwner });
    responders = v.id ? [v.id] : [];
    basis = v.basis;
    if (!ONE.has(card)) reasons.push(`cardinality_defaulted:${card}`);
  }
  reasons.push(`basis:${basis}`);
  const silence = responders.length === 0;
  if (silence && !row.silence_valid) reasons.push("silence_invalid_nobody_eligible");
  return Object.freeze({
    version: POLICY_VERSION,
    addressees,
    responders,
    // Who the line was put to (the address), and who heard it (everyone present).
    recipients: addressees,
    listeners: presentIds,
    cardinality: card,
    response_required: row.response_required,
    silence,
    silence_valid: row.silence_valid,
    owner_basis: basis,
    reasons
  });
}

module.exports = { POLICY_VERSION, RESPONSE_TABLE, decideResponse, oneVoice, rotation, knowers };
