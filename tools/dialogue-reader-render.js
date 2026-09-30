"use strict";

// Reader Phase 2 -- the MODEL-FACING RENDER: renderReaderPrompt(readerInput) -> { version, system, user, digests }.
//
// Pure and versioned. The full ReaderInput stays code-side (validators, resolver and receipts use it); a model reader
// -- local or the development-only hosted teacher -- receives exactly this render and nothing else:
//
//   system  STATIC (identical for every turn; a cacheable prefix): the reader's task, the closed contract and the
//           compact wire format (dialogue-reader-wire.js), the facet-code table.
//   user    DYNAMIC: the line with token indices, the labelled closed vocabularies, the canonical conversation state
//           and -- marked apart -- what coworkers were heard to say.
//
// Omitted as implementation noise (docs/reader/READER_PHASE2.md §5): character offsets, the normalized line when it
// equals the raw one, the punctuation summary, word count, freshness constants, salience-source labels, per-person
// present / eligible flags, the presentation_dependent flag, anchor_count, heard lines already carried by the heard
// anchors, and the derived wh / second-person / quantifier / deictic token classes (no ablation has shown value yet).
// Required semantic context is never dropped to save tokens.

const crypto = require("node:crypto");
const registry = require("./dialogue-registry");
const W = require("./dialogue-reader-wire");
const RF = require("./dialogue-reader-frame");

const RENDER_VERSION = "yellow-beast-reader-render@v2";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

const EXTRA_GUIDE = Object.freeze({
  "conversation.claim_check": "is that really so / are you sure",
  "conversation.meaning_of": "what did someone mean / what does a word mean",
  "conversation.basis_of": "what makes someone say that / how do they know",
  "conversation.explanation": "why (asks the reason for what was said or asked)",
  "conversation.reported_speech": "what someone said",
  "conversation.response_event": "whether / how someone answered",
  "conversation.repetition": "say that again"
});

// ─── the frozen SYSTEM text (render v2, Reader Phase 2 Step 0.1) ─────────────────────────────────────
// ONE representation-neutral SEMANTIC CONTRACT (semanticLines) is spelled twice: in the compact wire (the reader's
// output) and in minimal JSON (the development wire-vs-JSON control). The two system texts are built from the same
// template, so every gloss, convention and field meaning is word-for-word identical; only the spelling of values and
// the output-format lines differ. The same semantic lines are the gold labeller's field definitions
// (docs/reader/READER_PHASE2_LABEL_GUIDE.md §3 embeds them verbatim; ed33c enforces it). Changing a word changes the
// system digest (recorded in every receipt and pinned in ed33a).
const T = W.WIRE_TABLES;
const WIRE_TAG = Object.freeze({ question_form: "f", polarity: "pol", temporal: "t", respondent_mode: "m", referent: "r", nominated: "nom", subject: "s", inbound_answer: "ia", repair_kind: "rk", name_roles: "nr", echo: "echo", self_intro: "si", requested_action: "do", abstain: "ab", span: "sp", at: "at", relative_to: "rel", count: "n" });
const WIRE_TAG_TABLE = Object.freeze({ question_form: T.QFORM, polarity: T.POLARITY, temporal: T.TEMPORAL, respondent_mode: T.MODE, subject: T.SUBJECT, inbound_answer: T.INBOUND_KIND, repair_kind: T.REPAIR, name_roles: T.ROLE, requested_action: T.ACTION, abstain: T.ABSTAIN });
const JSON_PATH = Object.freeze({ inbound_answer: "inbound_answer.kind", subject: "subject.kind", requested_action: "requested_action.family", self_intro: "self_intro.span", echo: "echo.anchor", relative_to: "address.relative_to", count: "address.count", nominated: "referent.nominated", name_roles: "name_roles[].role" });
const SPELL = Object.freeze({
  wire: Object.freeze({
    speech: (v) => T.SPEECH[v],
    facet_none: "?", facet_na: "-",
    address: { NONE: "-", NAMED: "@n1 (several: @n1+n2)", ALL: "all", OTHERS: "others", EXCEPT: "except@n1", SECOND_PERSON: "you" },
    relation: (kind, target) => `${T.RELATION[kind]}${target ? `:${target}` : ""}`,
    tag: (field, value) => `${WIRE_TAG[field]}=${WIRE_TAG_TABLE[field]?.[value] ?? value}`,
    value: (field, v) => WIRE_TAG_TABLE[field]?.[v] ?? v,
    tags: (field, values) => `${WIRE_TAG[field]}=${values.map((v) => WIRE_TAG_TABLE[field]?.[v] ?? v).join("|")}`,
    referent: (v) => `${WIRE_TAG.referent}=${T.REF_SPECIAL[v] ?? v}`,
    option: (v) => T.OPTION_SPECIAL[v] ?? v
  }),
  json: Object.freeze({
    speech: (v) => v,
    facet_none: "NONE_ASKING", facet_na: "NOT_APPLICABLE",
    address: { NONE: "address.op=NONE", NAMED: "address.op=NAMED address.names=[n1] (several: [n1,n2])", ALL: "address.op=ALL", OTHERS: "address.op=OTHERS", EXCEPT: "address.op=EXCEPT address.names=[n1]", SECOND_PERSON: "address.op=SECOND_PERSON" },
    relation: (kind, target) => `relation.kind=${kind}${target ? ` relation.target=${target}` : ""}`,
    value: (field, v) => v,
    tags: (field, values) => `${JSON_PATH[field] ?? field}=${values.join("|")}`,
    tag: (field, value) => `${JSON_PATH[field] ?? field}=${value}`,
    referent: (v) => `referent.candidate=${v}`,
    option: (v) => v
  })
});

/** The representation-neutral semantic contract, spelled with `sp` (SPELL.wire | SPELL.json). */
function semanticLines(sp) {
  const S = sp.speech;
  const R = sp.relation;
  const tg = sp.tag;
  return [
    "TASK. You read ONE line a player typed to coworkers at a table and write how it is meant. Language only: never decide who answers, never state facts, never invent people, things or events. Use only the labels given in the input.",
    "LABELS. p person present, n name the player typed, e thing the player typed, r thing that may be referred to, q earlier request, i1 coworker question waiting for the player's answer, i0 coworker question just answered, v1 activity round, c1 the player's own previous claim, a sentence a coworker was heard to say, o answer option, s0/s1 an earlier act of this same line.",
    "ACTS. One act per clause-level act the line performs (at most 3), in line order.",
    `SPEECH ACT (what the clause does): ${S("greeting")} greets; ${S("farewell")} says goodbye; ${S("self_introduction")} introduces self; ${S("social_acknowledgment")} acknowledges / okay; ${S("thanks")} thanks; ${S("attention_call")} gets attention; ${S("statement")} states or claims; ${S("sarcasm")} a sarcastic remark; ${S("question")} asks; ${S("request")} asks someone to do something; ${S("repair")} fixes something the player said; ${S("elliptical_continuation")} an elliptical follow-up ("and you?", "who else?"); ${S("answer")} answers the waiting coworker question i1 (only then); ${S("aside")} not said to the table. A wh-led line is a remark (${S("statement")} / ${S("sarcasm")}) only when no asking reading is available; when in doubt write the asking reading and abstain on force.`,
    `FACET: what the act asks (or, on a statement, claims), one facet code below. ${sp.facet_none} = it asks, but its words name no facet in the table. ${sp.facet_na} = it asks nothing.`,
    `ADDRESS (address language in the words only: whom the words are said to): ${sp.address.NONE} nobody named | ${sp.address.NAMED} said to that named person | ${sp.address.ALL} everyone | ${sp.address.OTHERS} the rest (${tg("relative_to", "q1")} and ${tg("count", "2")} when said) | ${sp.address.EXCEPT} everyone but | ${sp.address.SECOND_PERSON} an unnamed you. A name talked ABOUT is not an address: give it the mention role.`,
    `RELATION (the antecedent the words relate to, by its label T, a q, i, s, v1, a or c1 label): ${R("new")} | ${R("continuation", "T")} continues T | ${R("repair", "T")} repairs T | ${R("topic_return", "T")} returns to T | ${R("attention", "T")} presses unanswered T | ${R("answer", "i1")} answers the coworker question | ${R("withdraw", "T")} withdraws T | ${R("conclude", "v1")} concludes the open activity round (${R("conclude")} when nothing is open). Code, never you, decides any closure or who answers.`,
    `OPTIONAL FIELDS (only when true; defaults are omitted): ${sp.tags("question_form", RF.QUESTION_FORMS.filter((f) => f !== "none"))} question form; ${sp.tags("polarity", ["negative", "inverted"])}; ${sp.tags("temporal", RF.TEMPORALS.filter((t) => t !== "unspecified"))} the time the line sets; ${sp.tags("respondent_mode", ["each", "any", "all"])} who should answer, only when the words say it ("each of you", "anyone"); ${sp.referent("r2")} the thing meant (${sp.referent("DEIXIS_THERE")} / ${sp.referent("DEIXIS_INSIDE")} a place pointed at without naming it, ${sp.referent("AMBIGUOUS")} the words are genuinely unclear, ${sp.referent("NONE")}); ${tg("nominated", "3-4")} tokens naming a thing no label fits; ${sp.tags("subject", RF.SUBJECT_KINDS)} whom a person facet is about, only when it is not simply the addressee (named: with the n labels); ${sp.tags("inbound_answer", RF.INBOUND_KINDS.filter((k) => k !== "none"))} with an option o1|${RF.INBOUND_OPTION_SPECIAL.map(sp.option).join("|")}, the answer to i1, only while i1 waits; ${sp.tags("repair_kind", RF.REPAIR_KINDS)} what a repair fixes; ${sp.tags("name_roles", RF.NAME_ROLES)} roles of typed names (a name in the address defaults to ${sp.value("name_roles", "vocative")}, on a greeting or farewell to ${sp.value("name_roles", "greeting_target")}); ${tg("echo", "a1")} repeats a heard sentence; ${tg("self_intro", "3-4")} the player's own name; ${sp.tags("requested_action", RF.ACTION_FAMILIES)} an action asked for (with its r label); ${sp.tags("abstain", RF.ABSTAIN_FIELDS)} fields the line itself cannot settle; ${tg("span", "3-7")} an explicit token span.`,
    `CONVENTION A (follow-up / ellipsis facet). When an act only continues, re-asks, presses or points back at an earlier question (an elliptical follow-up, a bare "when?", "who else?", "and you?") and its words do not themselves express a facet, write ${sp.facet_none} with the relation to what it continues: the facet is inherited from that target by code. Do not repeat or invent the target's facet. Write a facet code only when the words express one, a new facet or the same one restated in full.`,
    `CONVENTION B (chip). "player chose to speak to" is where the player's message is delivered, set by the interface. It is not address language. Address records only what the words themselves say: with no vocative, name or address phrase in the line, write ${sp.address.NONE} even when a person was chosen.`,
    `CONVENTION C (inclusive group). "We all ...", "are we all ...", "all of us" put the speaker's group in the SUBJECT (${tg("subject", "group_inclusive")}); they are not address language. Write ${sp.address.ALL} only when the words are said to everyone ("everyone", "you all", "guys", "all of you").`,
    `CONVENTION D (relation antecedent). A relation target is a supplied label that the words themselves continue, repair, return to, press or answer. A discourse marker ("so", "anyway", "okay") alone never makes a continuation. Never choose an antecedent only because it is about something similar: with no antecedent the words point back to, the relation is ${R("new")}.`,
    `ABSTAIN when the line and the input together cannot settle a field (not when you are merely unsure of these rules).`
  ];
}
const OUTPUT_LINES = Object.freeze({
  wire: [
    "OUTPUT: one line of compact code. Acts joined by \" ; \". Each act: SPEECH FACET ADDRESS RELATION, then optional key=value fields separated by spaces; every act after the first adds at=<its first token index>. Several names or fields are joined by +. A referent the player typed as a thing carries its span: r=e1>r2. A value with its label: ia=ans:o1, s=named:n2, do=move:r1, nr=n1:voc+n2:men.",
    "Write only the code line: no quotes, no code fence, no explanation."
  ],
  json: [
    "OUTPUT: one JSON object {\"acts\":[...]}, acts in line order. Each act has span [first,last] token indices and speech_act, facet, address {op,names}, relation {kind,target}; add any optional field only when not the default. A dotted name a.b=v above means the key path {\"a\":{\"b\":v}}; token spans are [first,last]; lists are JSON arrays. A referent the player typed as a thing carries its span: referent {span:\"e1\",candidate:\"r2\"}. A value with its label: inbound_answer {kind,option}, subject {kind,names}, requested_action {family,object}, name_roles [{name,role}].",
    "Write only the JSON object: no code fence, no explanation."
  ]
});
const glossOf = (id) => registry.advisoryFacetGuide()[id] ?? EXTRA_GUIDE[id] ?? id;
/** The system text for one output representation. */
function systemText(output = "wire", spell = null) {
  // `spell` exists only for governance drift tests (a mutated spelling must change the pinned digest).
  const sp = spell ?? (output === "json" ? SPELL.json : SPELL.wire);
  const key = output === "json" ? (id) => id : (id) => W.FACET_CODES[id];
  return [...semanticLines(sp), ...OUTPUT_LINES[output === "json" ? "json" : "wire"], "FACET CODES:", ...registry.ids().map((id) => `${key(id)} = ${glossOf(id)}`)].join("\n");
}
const SYSTEM_TEXT = systemText("wire");
const SYSTEM_DIGEST = sha(SYSTEM_TEXT);
// Development wire-vs-JSON control (Step 0.1): the SAME semantic contract and the SAME user render; only the output
// representation (value spellings and the output lines) differs.
const SYSTEM_TEXT_JSON_FULL = systemText("json");
const SYSTEM_DIGEST_JSON = sha(SYSTEM_TEXT_JSON_FULL);

const STATE = Object.freeze({ OPEN: "open", PARTIALLY_SATISFIED: "partly answered", SATISFIED: "answered", ANSWERED_UNKNOWN: "answered: doesn't know", ANSWERED_NOT_ESTABLISHED: "answered: not established", CLARIFYING: "clarifying", ABANDONED: "dropped", SUPERSEDED: "replaced", CLOSED: "closed" });
const facetCode = (f) => (f ? W.FACET_CODES[f] ?? f : null);
const q = (s) => JSON.stringify(String(s ?? ""));

/** The dynamic, model-facing view of ONE turn (pure). */
function renderUser(input) {
  const L = [];
  const conv = input.conversation ?? {};
  const people = input.people ?? [];
  const name = (label) => people.find((p) => p.label === label)?.name ?? label;
  L.push(`line: ${input.line.raw}`);
  if (input.line.normalized && input.line.normalized !== input.line.raw && input.line.normalized.toLowerCase() !== input.line.raw.toLowerCase().trim()) L.push(`read as: ${input.line.normalized}`);
  L.push(`tokens: ${(input.line.tokens ?? []).map((t) => `${t.i}:${t.text}`).join(" ")}`);
  L.push(`people: ${people.map((p) => `${p.label} ${p.name}`).join(", ")}`);
  if (input.chip_target) L.push(`player chose to speak to: ${input.chip_target}`);
  const names = input.features?.name_spans ?? [];
  if (names.length) L.push(`names typed: ${names.map((n) => `${n.label} ${q(n.text)}@${n.tokens[0]}${n.person ? `=${n.person}` : n.refers_to === "player" ? "=the player" : n.non_present_person ? "=not here" : ""}${n.possessive ? " possessive" : ""}`).join(", ")}`);
  const ents = input.features?.entity_spans ?? [];
  if (ents.length) L.push(`things typed: ${ents.map((e) => `${e.label} ${q(e.player_literal)}@${e.tokens[0]}${e.canonical_candidate ? `=${e.canonical_candidate}` : e.ambiguous ? " unclear" : ` (${e.kind})`}`).join(", ")}`);
  const refs = input.referent_candidates ?? [];
  const BASIS = { salient: "mentioned", anaphora: "last asked about", line: "typed", inbound: "offered", heard: "heard", nominated: "typed" };
  if (refs.length) L.push(`things: ${refs.map((r) => `${r.label} ${q(r.name)} ${r.kind} ${BASIS[r.basis] ?? r.basis}`).join("; ")}`);
  if (conv.active_place) L.push(`place in talk: ${conv.active_place}`);
  if ((conv.anaphora_candidates ?? []).length) L.push(`"it/that/there" may be: ${conv.anaphora_candidates.join(" ")}`);
  if ((conv.last_responders ?? []).length) L.push(`talking with: ${conv.last_responders.map((l) => `${l}`).join(" ")}`);
  for (const r of conv.requests ?? []) L.push(`${r.label}: asked ${facetCode(r.facet) ?? "?"}${r.targets.length ? ` to ${r.targets.join("+")}` : ""}; ${STATE[r.state] ?? String(r.state).toLowerCase()}${r.answered_by.length ? ` by ${r.answered_by.join("+")}` : ""}${r.distance === 0 ? " (latest)" : ""}`);
  if (conv.inbound) {
    const ib = conv.inbound;
    L.push(`i1: ${ib.from ?? "a coworker"} asked the player${ib.facet ? ` (${facetCode(ib.facet)})` : ""}${ib.answer_shape ? `, wants ${ib.answer_shape.replace(/_/g, " ")}` : ""}${ib.options?.length ? `, options ${ib.options.map((o) => `${o.label} ${q(o.text ?? "?")}`).join(" ")}` : ""}`);
  }
  if (conv.just_answered_inbound) L.push(`i0: the player just answered ${conv.just_answered_inbound.from ?? "a coworker"}`);
  if (conv.activity) { const a = conv.activity; L.push(`v1: round ${facetCode(a.facet) ?? a.kind}; done ${a.done.join("+") || "none"}; left ${a.remaining.join("+") || "none"}`); }
  if (conv.player_claim) { const c = conv.player_claim; L.push(`c1: the player said ${c.polarity === "negative" ? "NOT " : ""}${facetCode(c.facet)} about ${c.subject.join("+") || "someone"} (${c.state})`); }
  if (conv.previous_player_line) L.push(`player's previous line: ${q(conv.previous_player_line)}`);
  // Heard (presentation-dependent): the anchors carry the heard sentences; lines only when no anchor exists.
  const heard = input.heard ?? {};
  const anchors = heard.anchors ?? [];
  if (anchors.length) for (const a of anchors) L.push(`heard ${a.label} ${a.speaker ?? "?"}${a.request ? ` re ${a.request}` : ""}: ${q(a.text)}`);
  else for (const l of heard.lines ?? []) L.push(`heard ${l.speaker}: ${q(l.text)}`);
  return L.join("\n");
}

/** renderReaderPrompt(readerInput): the ONLY thing a model reader receives. `output: "json"` (development-only wire-vs-
 * JSON check) swaps the output-format section of the system text; the user render is byte-identical. */
function renderReaderPrompt(input, { output = "wire" } = {}) {
  const user = renderUser(input);
  const json = output === "json";
  const system = json ? SYSTEM_TEXT_JSON_FULL : SYSTEM_TEXT;
  const systemDigest = json ? SYSTEM_DIGEST_JSON : SYSTEM_DIGEST;
  return Object.freeze({ version: RENDER_VERSION, output: json ? "json" : "wire", wire_version: W.WIRE_VERSION, wire_digest: W.WIRE_DIGEST, system, system_digest: systemDigest, user, user_digest: sha(user), render_digest: sha(`${systemDigest}\n${user}`) });
}

module.exports = { RENDER_VERSION, SYSTEM_TEXT, SYSTEM_DIGEST, SYSTEM_TEXT_JSON: SYSTEM_TEXT_JSON_FULL, SYSTEM_DIGEST_JSON, SPELL, semanticLines, systemText, OUTPUT_LINES, renderReaderPrompt, renderUser };
