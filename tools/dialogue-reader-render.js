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

const RENDER_VERSION = "yellow-beast-reader-render@v1";
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
const facetGuide = () => { const g = registry.advisoryFacetGuide(); return registry.ids().map((id) => `${W.FACET_CODES[id]} = ${g[id] ?? EXTRA_GUIDE[id] ?? id}`); };

// The static system text. Changing a word changes RENDER_VERSION's system digest (recorded in every receipt).
const CONTRACT_LINES = [
  "You read ONE line a player typed to coworkers at a table and write how it is meant. Language only: never decide who answers, never state facts, never invent people, things or events. Use only the labels given in the input.",
  "Labels: p person present, n name the player typed, e thing the player typed, r thing that may be referred to, q earlier request, i1 coworker question waiting for the player's answer, i0 coworker question just answered, v1 activity round, c1 the player's own previous claim, a sentence a coworker was heard to say, o answer option, s0/s1 an earlier act of this same line.",
  "Answer in a compact code: one act per clause-level act (at most 3), joined by \" ; \". Each act is: SPEECH FACET ADDRESS RELATION, then optional key=value tags.",
  "SPEECH: greet bye intro(introduces self) ack(acknowledges/okay) thanks call(gets attention) state(statement/claim) sarcasm ask(question) request more(elliptical follow-up: \"and you?\", \"who else?\") repair(fixes something the player said) answer(answers i1) aside.",
  "FACET: what the act asks or claims, a code below; ? = asks something but no code fits; - = asks nothing.",
  "ADDRESS: - (nobody named) | @n1 (said to that named person; @n1+n2 several) | all | others (the rest) | except@n1 | you (an unnamed you).",
  "RELATION: new | cont:T (continues T) | fix:T (repairs T) | back:T (returns to T) | nudge:T (presses unanswered T) | reply:i1 (answers the coworker question) | drop:T (withdraws T) | end:v1 (concludes the activity round; plain end if nothing is open). T is a q, i, s, v1, a or c1 label.",
  "Tags (only when true): f=wh|yn|choice|decl|indirect|tag|count question form; pol=neg|inv; t=now|today|earlier|ever|past time the line sets; m=each|any|all who should answer, if said; r=r2 or r=e1>r2 the thing meant (r=there / r=inside for a place pointed at, r=unsure if unclear, r=none); nom=3-4 tokens naming a thing no label fits; s=you|me|us|group|named:n2|none whom the facet is about; ia=ans|unsure|refuse|counter[:o1|yes|no|both|either|neither|noneof] answer to i1; rk=who|what|topic|when|unanswered|mine what a repair fixes; nr=n1:voc+n2:men roles of typed names (voc said to, men mentioned, ans answer, greet, fix new addressee), default @names are voc; rel=q1 and n=2 for others; echo=a1 repeats a heard sentence; si=3-4 the player's own name; do=move|stay|follow|wait|return|report|assist|investigate|transfer|query|other[:r1] an action asked for; ab=force|address|facet|relation|referent|subject|time|answer fields you cannot tell; at=5 first token of every act after the first; sp=3-7 explicit span.",
  "Write only the code line."
];
const SYSTEM_TEXT = [...CONTRACT_LINES, "Facet codes:", ...facetGuide()].join("\n");
const SYSTEM_DIGEST = sha(SYSTEM_TEXT);
// Step 14 (teacher wire-vs-JSON check, development only): the SAME semantic contract and the SAME user render, with
// the answer written as minimal JSON instead of the compact wire. Only the output-format lines differ.
const SYSTEM_TEXT_JSON = [
  ...CONTRACT_LINES.slice(0, 2),
  "Answer with one JSON object {\"acts\":[...]} (at most 3 acts, in line order). Each act has span [first,last] token indices, speech_act, facet, address {op,names}, relation {kind,target}; include any of question_form, polarity, name_roles [{name,role}], repair_kind, referent {span,candidate,nominated}, temporal, respondent_mode, inbound_answer {kind,option}, subject {kind,names}, self_intro {span}, echo {anchor}, requested_action {family,object}, abstain [...] only when not the default.",
  "speech_act: greeting farewell self_introduction social_acknowledgment thanks attention_call statement sarcasm question request repair elliptical_continuation answer aside.",
  "facet: a code below, or NONE_ASKING (asks, nothing fits) / NOT_APPLICABLE (asks nothing). address.op: NAMED ALL OTHERS EXCEPT SECOND_PERSON NONE. relation.kind: new continuation repair topic_return attention answer withdraw conclude (target: a q, i, s, v1, a or c1 label, or null).",
  "Defaults: question_form none, polarity positive, temporal unspecified, respondent_mode unspecified, name_roles = vocative for NAMED names. Other values: question_form wh yes_no choice declarative indirect tag count; polarity negative inverted; temporal now today earlier ever historical; respondent_mode each any all; referent.candidate an r label or NONE AMBIGUOUS DEIXIS_THERE DEIXIS_INSIDE; subject.kind addressee speaker named group group_inclusive none; inbound_answer.kind answer uncertainty refusal counter_question none, option an o label or YES NO BOTH NEITHER EITHER NONE_OF_OFFERED; repair_kind addressee referent facet temporal unanswered own_answer; name role vocative mention answer_to_inbound greeting_target repair_target; abstain force address facet relation referent subject temporal inbound_answer.",
  "Write only the JSON object, no prose."
];
const SYSTEM_TEXT_JSON_FULL = [...SYSTEM_TEXT_JSON, "Facet codes (write the full facet id on the left):", ...registry.ids().map((id) => `${id} = ${registry.advisoryFacetGuide()[id] ?? EXTRA_GUIDE[id] ?? id}`)].join("\n");
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

module.exports = { RENDER_VERSION, SYSTEM_TEXT, SYSTEM_DIGEST, SYSTEM_TEXT_JSON: SYSTEM_TEXT_JSON_FULL, SYSTEM_DIGEST_JSON, renderReaderPrompt, renderUser };
