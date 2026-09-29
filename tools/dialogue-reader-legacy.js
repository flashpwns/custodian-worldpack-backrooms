"use strict";

// Reader Phase 0 -- the LEGACY ADAPTER: frameFromLegacy() expresses what the current parser (Tier 1, plus any
// accepted Tier-2 reading already applied by the service) decided about a turn as a ReaderFrame v1, and says
// exactly where that is impossible or lossy. It never changes the current behaviour: it only reads the
// finished analysis and frame.
//
// Every mismatch is classified (ReaderFrame is NOT widened to encode legacy policy):
//   reader-schema gap       the line carries meaning the ReaderFrame cannot express
//   resolver-policy concern the legacy decision is responder / routing POLICY made inside the reader layer
//                           (or from a raw-text signal outside the frame); a resolver must own it
//   legacy-only artifact    the legacy parser rewrote or dropped something no reader should reproduce
//   needs-owner-decision    the convention itself is contested (owner decides which reading is right)
// Raw-text dependencies the legacy decision relied on are tallied separately (they are not mismatches).

const registry = require("./dialogue-registry");
const RF = require("./dialogue-reader-frame");

const LEGACY_ADAPTER_VERSION = "yellow-beast-reader-legacy-adapter@v1";
const CLASSES = Object.freeze(["reader-schema gap", "resolver-policy concern", "legacy-only artifact", "needs-owner-decision"]);
const ASKING = new Set(["question", "request", "elliptical_continuation", "repair", "attention_call"]);

// Legacy addressee sources whose target is DERIVED from the ledger / DIS (reproducible by a resolver from the
// frame's relation + target), versus sources that depend on a raw-text signal the frame does not carry.
const DIS_DERIVED_SOURCES = new Set(["repaired_request", "activity_remaining", "answer_owner", "pending_request", "open_question_answer", "inbound_asker", "answer_repair", "person_set_continuation", "repair_asker", "active_speaker"]);
const RAW_TEXT_SOURCES = Object.freeze({
  antecedent_owner: "isFollowUp: FOLLOW_UP_FRAGMENT / FOLLOW_UP_ANAPHOR regex + salient_names (reply facts incl. OPTIONAL facts)",
  surface_anchor: "echoOf: echo-token overlap with the spoken reply (heard wording)"
});
const RAW_TEXT_FACET_SOURCES = Object.freeze({
  item_role: "itemRole: ITEM_ROLES clause regex table",
  discourse_followup: "fragment tables (ELABORATE_TIME / TEMPORAL / who-else / what-for) over the raw fragment",
  inbound_counter: "REPLY_COUNTER_WHY regex",
  surface_anchor: "echo tokens against heard wording"
});
// Speech-act rewrites the legacy layer performs AFTER reading the clause (parsed act -> effective act).
const REWRITES = Object.freeze({
  "attention_call>elliptical_continuation": ["resolver-policy concern", "a bare name after someone answered is turned into a re-ask by ledger policy"],
  "repair>social_acknowledgment": ["resolver-policy concern", "a vacuous target repair (same person already answered) is downgraded by ledger policy"],
  "repair>statement": ["legacy-only artifact", "a referent repair whose thing does not resolve is re-read as a statement"],
  "statement>answer": ["resolver-policy concern", "answer-hood decided in the resolution layer with REPLY_* regexes and the inbound shape"],
  "social_acknowledgment>answer": ["resolver-policy concern", "yes/no reply word list decides answer-hood"],
  "question>answer": ["resolver-policy concern", "inbound answer shape re-reads a question as an answer"],
  "request>answer": ["resolver-policy concern", "inbound answer shape re-reads a request as an answer"],
  "statement>question": ["legacy-only artifact", "an echo of reply wording (surface anchor) or a declarative candidate is re-read as a question"],
  "social_acknowledgment>question": ["legacy-only artifact", "an echo of reply wording is re-read as a question"],
  "statement>elliptical_continuation": ["legacy-only artifact", "a bare 'the X?' fragment is re-read as a continuation"],
  "question>elliptical_continuation": ["legacy-only artifact", "a bare 'the X?' fragment is re-read as a continuation"],
  "statement>repair": ["legacy-only artifact", "self-repair of an answer"],
  "repair>answer": ["resolver-policy concern", "a self-repair of the player's own answer is routed by inbound policy"]
});
// Legacy discourse functions (buildSemanticFrame routes) that name a specific ask with no registry facet.
const FN_WITHOUT_FACET_OK = new Set(["greet", "introduce_self", "acknowledge", "joke_or_sarcasm", "social_observation", "warn", "express_uncertainty", "make_statement", "make_request", "attend", "close_topic", "ask_factual", "ambiguous_reference", "compound"]);
const ACTION_FAMILY = Object.freeze({ transfer_item: "TRANSFER", hold_position: "STAY", follow: "FOLLOW", move: "MOVE", inspect: "INVESTIGATE", report: "REPORT" });
const CLARIFY_SLOT_TO_ABSTAIN = Object.freeze({ person: "address", topic: "relation", referent: "referent", location: "referent", answer: "inbound_answer" });
const REPAIR_KIND = Object.freeze({ target: "addressee", target_group: "addressee", exclude: "addressee", other_one: "addressee", unanswered: "unanswered", facet: "facet", facet_purpose: "facet", temporal: "temporal", referent: "referent" });
const REPLY_KIND = Object.freeze({ answer: "answer", uncertainty: "uncertainty", refusal: "refusal", counter_question: "counter_question", answer_repair: "answer" });
const OPTION_WORD = Object.freeze({ yes: "YES", no: "NO", both: "BOTH", either: "EITHER", neither: "NEITHER", none: "NONE_OF_OFFERED" });

/** Character span -> [first token, last token] of the ReaderInput token list. */
function tokenSpan(charSpan, tokens) {
  if (!Array.isArray(charSpan) || !tokens?.length) return null;
  const [s, e] = charSpan;
  const inside = tokens.filter((t) => t.start >= s && t.end <= e);
  if (!inside.length) return null;
  return [inside[0].i, inside.at(-1).i];
}

/**
 * @param analysis  dialogueTurn.analyzeTurn output (after any accepted advisory was applied)
 * @param readerInput  { input, bindings } from dialogue-reader-input.buildReaderInput
 * @param options.frame  the finalized legacy semantic frame (dialogueTurn.finalizeFrame output), if available
 * @returns { frame, conversion: { version, exact, notes[], raw_text_dependencies[] } }
 */
function frameFromLegacy(analysisIn, readerInput, { frame: legacyFrame = null, primary: usedPrimary = null } = {}) {
  // Express what production DECIDED: when the service replaced the analysis primary (an address correction),
  // the replacement is the legacy decision for that act.
  const analysis = usedPrimary && analysisIn?.primary && usedPrimary !== analysisIn.primary ? { ...analysisIn, effective: (analysisIn.effective ?? []).map((x) => (x === analysisIn.primary ? usedPrimary : x)), primary: usedPrimary } : analysisIn;
  const { input, bindings } = readerInput;
  const notes = [];
  const rawDeps = [];
  const note = (act, field, cls, code, detail = null) => notes.push({ act, field, class: cls, code, ...(detail ? { detail } : {}) });
  const dep = (act, where, what) => rawDeps.push({ act, where, what });
  const tokens = input.line.tokens;
  const idOfName = (label) => bindings.names[label] ?? null;
  const nameSpansFor = (ids, span) => input.features.name_spans.filter((n) => ids.includes(idOfName(n.label)) && (!span || (n.tokens[0] >= span[0] && n.tokens[1] <= span[1])));
  const requestLabel = (id) => (id ? Object.entries(bindings.requests).find(([, v]) => v === id)?.[0] ?? null : null);
  const referentLabel = (id) => (id ? Object.entries(bindings.referents).find(([, v]) => v === id)?.[0] ?? null : null);
  const personLabel = (id) => Object.entries(bindings.people).find(([, v]) => v === id)?.[0] ?? null;
  // The latest sentence a person was heard to say (a surface anchor): what "why?" / "what do you mean?" question.
  const lastHeardFrom = (label) => (label ? input.heard.anchors.filter((x) => x.speaker === label).at(-1)?.label ?? null : null);

  const effective = analysis?.effective ?? [];
  // Social framing clauses ride along as their own acts when there is room (they are readable, not policy).
  const socialActs = (analysis?.acts ?? []).filter((a) => ["social_acknowledgment", "thanks"].includes(a.speech_act) && !effective.some((e) => e.act === a));
  const ordered = [...effective.map((e) => ({ e, act: e.act })), ...socialActs.map((a) => ({ e: null, act: a }))].sort((x, y) => (x.act?.span?.[0] ?? 0) - (y.act?.span?.[0] ?? 0));
  if (ordered.length > RF.MAX_ACTS) note(null, "acts", "reader-schema gap", "more_than_max_acts", { count: ordered.length });
  const kept = ordered.slice(-RF.MAX_ACTS);
  if (!kept.length) return { frame: null, conversion: { version: LEGACY_ADAPTER_VERSION, exact: false, notes: [{ act: null, field: "acts", class: "legacy-only artifact", code: "no_legacy_act" }], raw_text_dependencies: [] } };

  const acts = [];
  let previousEnd = -1;
  kept.forEach(({ e, act: clause }, i) => {
    const rawBase = e ?? { speech_act: clause.speech_act, question_form: clause.question_form, relation: "new", addressee: null, args: {}, predicate: null };
    // The primary act's arguments are completed by finalizeFrame (third-party subject, others): read them there.
    const base = e && e === analysis?.primary && legacyFrame?.turn?.args ? { ...rawBase, args: { ...(rawBase.args ?? {}), ...legacyFrame.turn.args } } : rawBase;
    const clauseAct = clause ?? {};
    let span = tokenSpan(clauseAct.span, tokens);
    if (!span) { note(i, "span", "legacy-only artifact", "span_not_on_tokens"); span = [Math.max(previousEnd + 1, 0), Math.max(previousEnd + 1, 0)]; }
    if (span[0] <= previousEnd) { note(i, "span", "legacy-only artifact", "overlapping_clause_spans"); span = [previousEnd + 1, Math.max(previousEnd + 1, span[1])]; }
    // No token left for this act (legacy produced more clauses than the line has room for): drop it, noted.
    if (span[0] > tokens.length - 1) { note(i, "span", "legacy-only artifact", "act_without_tokens"); return; }
    span = [span[0], Math.min(span[1], tokens.length - 1)];
    previousEnd = span[1];
    const out = { span };

    // speech act (and the legacy post-reading rewrites)
    let speech = base.speech_act;
    if (!RF.SPEECH_ACTS.includes(speech)) { note(i, "speech_act", "reader-schema gap", "unknown_speech_act", { value: speech }); speech = "statement"; }
    out.speech_act = speech;
    const rewrite = clauseAct.speech_act && clauseAct.speech_act !== base.speech_act ? `${clauseAct.speech_act}>${base.speech_act}` : null;
    if (rewrite) { const [cls, why] = REWRITES[rewrite] ?? ["legacy-only artifact", "speech act rewritten after the clause was read"]; note(i, "speech_act", cls, `rewrite:${rewrite}`, why); }
    out.question_form = RF.QUESTION_FORMS.includes(base.question_form) ? base.question_form : base.question_form == null ? "none" : (note(i, "question_form", "reader-schema gap", "unknown_question_form", { value: base.question_form }), "none");

    // facet (registry predicate; the finalized frame's reconciled predicate is the legacy's final word)
    const isPrimary = e && e === analysis?.primary;
    const predicate = (isPrimary && legacyFrame?.predicate !== undefined ? legacyFrame.predicate : null) ?? base.predicate ?? null;
    if (predicate && registry.get(predicate)) out.facet = predicate;
    else {
      out.facet = ASKING.has(speech) && speech !== "attention_call" ? "NONE_ASKING" : "NOT_APPLICABLE";
      const fn = isPrimary ? legacyFrame?.discourse_function ?? null : null;
      if (fn && !FN_WITHOUT_FACET_OK.has(fn)) note(i, "facet", "reader-schema gap", "legacy_route_without_registry_facet", { fn });
    }
    if (speech === "statement" && isPrimary && legacyFrame?.player_claim) note(i, "facet", "legacy-only artifact", "player_claim_not_typed_by_legacy", "legacy records a claim without a registry facet; ReaderFrame can carry facet+polarity on a statement");
    const facetSource = base.facet_source ?? null;
    if (RAW_TEXT_FACET_SOURCES[facetSource]) dep(i, `facet_source:${facetSource}`, RAW_TEXT_FACET_SOURCES[facetSource]);

    out.polarity = base.args?.question_inverted ? "inverted" : (clauseAct.polarity === "negative" || base.polarity === "negative") ? "negative" : "positive";

    // name roles over code-supplied name spans in this act
    const spansHere = input.features.name_spans.filter((n) => n.tokens[0] >= span[0] && n.tokens[1] <= span[1]);
    const vocIds = (clauseAct.vocatives ?? []).map((v) => v.id).filter(Boolean);
    const mentionIds = (clauseAct.mentions ?? []).map((m) => m.id).filter(Boolean);
    const answerPerson = speech === "answer" && base.args?.answer_option && Object.values(bindings.names).includes(base.args.answer_option) ? base.args.answer_option : null;
    out.name_roles = spansHere.map((n) => {
      const id = idOfName(n.label);
      if (answerPerson && id === answerPerson) return { name: n.label, role: "answer_to_inbound" };
      if (vocIds.includes(id)) return { name: n.label, role: ["greeting", "farewell"].includes(speech) ? "greeting_target" : "vocative" };
      if (mentionIds.includes(id) || n.refers_to !== "present_person") return { name: n.label, role: "mention" };
      note(i, "name_roles", "legacy-only artifact", "name_span_without_legacy_role", { name: n.text });
      return { name: n.label, role: "mention" };
    });
    // An addressee repair names its intended addressee as a mention ("No, I was asking Malcolm"): repair_target.
    const repairTargetIds = (base.addressee?.source === "legacy_correction" || (base.addressee?.source === "repair" && base.repair?.kind === "target")) ? (base.addressee.ids ?? []) : [];
    if (repairTargetIds.length) out.name_roles = out.name_roles.map((r) => (repairTargetIds.includes(idOfName(r.name)) && r.role === "mention" ? { name: r.name, role: "repair_target" } : r));
    const vocSpans = out.name_roles.filter((r) => ["vocative", "greeting_target", "repair_target"].includes(r.role)).map((r) => r.name);

    // language-level address operation (never the legacy responder decision)
    const a = base.addressee ?? null;
    const q = clauseAct.quantifier?.kind ?? a?.quantifier ?? null;
    const address = { op: "NONE", names: [], relative_to: null, count: null };
    let mode = "unspecified";
    if (a?.source === "chip") address.op = vocSpans.length ? "NAMED" : "NONE";
    if (vocSpans.length && (!a || ["vocative", "vocative_not_present", "repair", "legacy_correction", "chip"].includes(a.source) || (clauseAct.vocatives ?? []).length)) { address.op = "NAMED"; address.names = vocSpans; }
    else if (base.repair?.kind === "target" && clauseAct.repair?.kind === "other_one") { address.op = "OTHERS"; address.relative_to = base.relation_target ? requestLabel(base.relation_target) : null; }
    else if (q === "except") { address.op = "EXCEPT"; address.names = input.features.name_spans.filter((n) => n.tokens[0] >= span[0] && n.tokens[1] <= span[1] && String(clauseAct.quantifier?.name ?? "").toLowerCase() === n.text.toLowerCase()).map((n) => n.label); }
    else if (q === "just") { const only = nameSpansFor(a?.ids ?? [], span).map((n) => n.label); address.op = only.length ? "NAMED" : "NONE"; address.names = only; }
    else if (q === "rest") { address.op = "OTHERS"; address.relative_to = null; }
    else if (q === "two" || q === "three") { address.op = a?.kind === "group" ? "ALL" : "OTHERS"; address.count = q === "two" ? 2 : 3; }
    else if (["all", "each", "any", "everyone", "everybody", "both", "whole"].includes(q)) { address.op = "ALL"; mode = q === "each" ? "each" : q === "any" ? "any" : "all"; }
    else if (q === "we_all" || q === "we" || a?.source === "collective") { address.op = "NONE"; note(i, "address", "needs-owner-decision", "collective_subject_routed_as_group_address", "legacy maps a subject quantifier ('we all', 'are we') to a group address; ReaderFrame reads it as subject group_inclusive, address NONE"); }
    else if (a?.second_person || a?.source === "active_speaker" || a?.source === "active_speakers_several") address.op = input.features.second_person.some((t) => t >= span[0] && t <= span[1]) ? "SECOND_PERSON" : "NONE";
    else if (a?.source === "repair" && a.kind === "group") address.op = "ALL";
    if (a?.source && RAW_TEXT_SOURCES[a.source]) { dep(i, `addressee:${a.source}`, RAW_TEXT_SOURCES[a.source]); note(i, "address", "resolver-policy concern", `inherited_via_raw_text:${a.source}`, RAW_TEXT_SOURCES[a.source]); }
    else if (a?.source && DIS_DERIVED_SOURCES.has(a.source) && address.op === "NONE" && (a.ids ?? []).length) out._resolver_derived_address = a.source;
    if (a?.source === "vocative_not_present") note(i, "address", "resolver-policy concern", "absent_vocative", "legacy addresses an absent person by name; V2 clarifies");
    out.address = address;

    // relation + target
    const relation = { kind: RF.RELATIONS.includes(base.relation) ? base.relation : (note(i, "relation", "reader-schema gap", "unknown_relation", { value: base.relation }), "new"), target: null };
    if (base.relation_target) {
      relation.target = requestLabel(base.relation_target);
      if (!relation.target) note(i, "relation", "reader-schema gap", "antecedent_outside_input_window", "the legacy antecedent is older than the ReaderInput request window");
    } else if (relation.kind === "answer" || (base.args?.reply_kind === "counter_question" && input.conversation.inbound)) relation.target = input.conversation.inbound?.label ?? null;
    // The player's own just-given answer, repaired ("I mean, the camera"): the inbound question just answered.
    else if (base.args?.reply_kind === "answer_repair" && input.conversation.just_answered_inbound) relation.target = input.conversation.just_answered_inbound.label;
    // An earlier act of the SAME line -- a question, or the player's own claim ("I've been in the Complex
    // before. Have you, Giselle?") -- is the antecedent.
    else if (relation.kind === "continuation" && i > 0 && acts[i - 1] && (ASKING.has(acts[i - 1].speech_act) || acts[i - 1].speech_act === "statement")) relation.target = `s${i - 1}`;
    else if (relation.kind === "continuation" && input.conversation.activity && (base.activity || a?.source === "activity_remaining" || (predicate && predicate === input.conversation.activity.facet && clauseAct.speech_act === "attention_call"))) relation.target = input.conversation.activity.label;
    else if (["continuation", "repair"].includes(relation.kind) && (a?.ids ?? []).length === 1 && lastHeardFrom(personLabel(a.ids[0]))) relation.target = lastHeardFrom(personLabel(a.ids[0]));
    else if (["continuation", "repair", "topic_return"].includes(relation.kind) && !base.clarify) {
      const inherited = a?.source === "active_speaker" || a?.source === "answer_owner" || a?.source === "antecedent_owner" || a?.source === "surface_anchor";
      note(i, "relation", inherited ? "resolver-policy concern" : "legacy-only artifact", "relation_without_antecedent", inherited ? "the continuation is established by addressee inheritance, not by a request antecedent" : null);
    }
    out.relation = relation;
    const repairKind = base.repair?.kind ? REPAIR_KIND[base.repair.kind] ?? null : base.args?.reply_kind === "answer_repair" ? "own_answer" : base.addressee?.source === "legacy_correction" ? "addressee" : null;
    out.repair_kind = relation.kind === "repair" || base.args?.reply_kind === "answer_repair" ? repairKind : null;

    // referent (pronoun / deictic choice, or a named thing)
    const refId = base.args?.item_id ?? base.args?.place_id ?? null;
    if (refId) {
      const candidate = referentLabel(refId);
      const spanHere = input.features.entity_spans.find((s) => bindings.entities[s.label] === refId && s.tokens[0] >= span[0] && s.tokens[1] <= span[1]) ?? null;
      // "going in" / "inside" -> the Complex is owner decision #4's canonical DEFAULT (resolver policy), not a
      // referent the line names or the conversation made salient.
      if (!candidate && base.args?.place_basis === "domain_default_inside") note(i, "referent", "resolver-policy concern", "deictic_default_place", "owner decision #4: 'going in' / 'inside' default to the Complex");
      // A place legacy took from its salience (which reads OPTIONAL facts): not in the required-facts ReaderInput (B7).
      else if (!candidate && base.args?.place_basis === "salient_topic") note(i, "referent", "needs-owner-decision", "salient_place_from_legacy_salience", "B7: legacy salience includes optional (possibly unspoken) facts");
      else if (!candidate) note(i, "referent", "reader-schema gap", "referent_not_in_candidates", { id_kind: base.args?.item_id ? "item" : "place" });
      out.referent = { span: spanHere?.label ?? null, candidate: candidate ?? "NONE" };
      if (!spanHere && base.args?.place_basis && !["named", "deixis_active_place"].includes(base.args.place_basis)) out._referent_basis = base.args.place_basis;
    } else out.referent = null;

    // temporal: only what the line expressed; defaults are the resolver's
    // The time the LINE sets: legacy's effective scope for a fresh act or a temporal follow-up (the cue's
    // time frame, "before?", "ever?"); an inherited scope is the resolver's to carry.
    const expressed = base.relation === "new" || base.args?.followup || base.repair?.kind === "temporal" ? (base.temporal_scope ?? clauseAct.temporal_scope ?? null) : (clauseAct.temporal_scope ?? null);
    out.temporal = RF.TEMPORALS.includes(expressed) ? expressed : "unspecified";
    if (!expressed && base.temporal_scope && base.args?.followup) note(i, "temporal", "resolver-policy concern", "temporal_from_fragment_table", "the follow-up table decided the time frame from the raw fragment");
    out.respondent_mode = mode;

    // inbound answer
    const replyKind = base.args?.reply_kind ?? null;
    // (reply_kind is also inherited with a repaired request's args: only THIS act's answer counts.)
    const counterQuestion = replyKind === "counter_question" && relation.kind === "continuation" && Boolean(input.conversation.inbound);
    if (speech === "answer" || counterQuestion) {
      const opt = base.args?.answer_option ?? null;
      let option = null;
      if (opt != null) {
        option = OPTION_WORD[String(opt).toLowerCase()] ?? Object.entries(bindings.options).find(([, v]) => v === opt)?.[0] ?? null;
        if (!option && personLabel(opt)) option = null;
        if (!option && !answerPerson) note(i, "inbound_answer", "reader-schema gap", "answer_option_without_canonical_option_id", "B6: coworker questions carry no canonical option ids");
      }
      out.inbound_answer = { kind: REPLY_KIND[replyKind] ?? "answer", option };
    } else out.inbound_answer = null;

    // subject
    const third = base.args?.third_party_subject ?? null;
    const subjectIds = base.args?.subject_ids ?? (third ? [third] : []);
    if (subjectIds.length) {
      const spans = nameSpansFor(subjectIds, null).map((n) => n.label);
      out.subject = { kind: "named", names: spans };
      if (!spans.length) note(i, "subject", "reader-schema gap", "subject_without_name_span", "a pronoun subject ('she', 'he') has no name span to point at");
    } else if (q === "we_all" || q === "we" || a?.source === "collective") out.subject = { kind: "group_inclusive", names: [] };
    else if (out.facet !== "NONE_ASKING" && out.facet !== "NOT_APPLICABLE" && registry.get(out.facet)?.domain === "person") out.subject = { kind: "addressee", names: [] };
    else out.subject = null;

    // self-introduction open-text span (the player's own name, if the line has one)
    if (speech === "self_introduction") {
      const own = input.features.name_spans.find((n) => n.refers_to === "player" && n.tokens[0] >= span[0] && n.tokens[1] <= span[1]);
      out.self_intro = own ? { span: [...own.tokens] } : null;
      if (!own) note(i, "self_intro", "legacy-only artifact", "legacy_does_not_extract_introduced_name", "SELF_INTRO is a test, not an extraction");
    } else out.self_intro = null;

    // echo / surface-anchor choice
    if (a?.source === "surface_anchor" && base.args?.echo?.event_id) {
      const anchor = input.heard.anchors.find((x) => bindings.anchors[x.label]?.event_id === base.args.echo.event_id && (x.text ?? "").toLowerCase().includes(String(base.args.echo.matched ?? "").toLowerCase())) ?? input.heard.anchors.find((x) => bindings.anchors[x.label]?.event_id === base.args.echo.event_id);
      out.echo = anchor ? { anchor: anchor.label } : null;
      if (!anchor) note(i, "echo", "reader-schema gap", "echo_anchor_not_in_input");
    } else out.echo = null;

    // requested action (hand-off intent only)
    const requested = isPrimary ? legacyFrame?.requested_action ?? null : null;
    out.requested_action = requested ? { family: ACTION_FAMILY[requested.kind ?? requested.action] ?? "OTHER", object: referentLabel(requested.object_id ?? requested.item_id ?? null) } : null;

    // abstention: a legacy clarification is the reader's "I can't tell" on that slot
    const abstain = new Set();
    if (base.clarify?.slot && CLARIFY_SLOT_TO_ABSTAIN[base.clarify.slot]) abstain.add(CLARIFY_SLOT_TO_ABSTAIN[base.clarify.slot]);
    // (Tier 1's internal force uncertainty is not an abstention: legacy declines only by clarifying.)
    out.abstain = [...abstain];
    acts.push(out);
  });

  // Strip adapter-internal annotations into the conversion record.
  const resolverDerived = acts.map((x, i) => (x._resolver_derived_address ? { act: i, source: x._resolver_derived_address } : null)).filter(Boolean);
  const referentBasis = acts.map((x, i) => (x._referent_basis ? { act: i, basis: x._referent_basis } : null)).filter(Boolean);
  for (const x of acts) { delete x._resolver_derived_address; delete x._referent_basis; }
  const frame = { version: RF.READER_FRAME_VERSION, acts };
  return {
    frame,
    conversion: {
      version: LEGACY_ADAPTER_VERSION,
      exact: notes.length === 0,
      notes,
      raw_text_dependencies: rawDeps,
      resolver_derived_addressees: resolverDerived,
      referent_bases: referentBasis
    }
  };
}

module.exports = { LEGACY_ADAPTER_VERSION, CLASSES, frameFromLegacy, tokenSpan };
