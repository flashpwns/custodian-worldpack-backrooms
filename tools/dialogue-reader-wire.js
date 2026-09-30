"use strict";

// Reader Phase 2 -- the COMPACT WIRE FORMAT: transport only. The ReaderFrame (dialogue-reader-frame.js) stays the
// semantic contract; the wire is how a model reader spells one with few tokens.
//
//   encodeWire(frame, input)  -> text
//   decodeWire(text, input)   -> { ok, frame, errors }   (errors are V0: a malformed wire is not a reading)
//
// One act per segment, segments joined by " ; " (at most MAX_ACTS). Each act is a fixed positional CORE
//
//   <speech_act> <facet> <address> <relation>[:<target>]
//
// followed by TAGGED EXTRAS, present only when non-default: key=value, each key at most once. Every reference is an
// opaque label the ReaderInput supplied (n1, e1, r1, q1, i1, a1, o1, v1, c1, s0); a canonical id never appears.
// Label existence is NOT checked here -- an illegal candidate decodes and fails downstream validation (V1).
//
// Spans: a single act covers the whole line (elided). In a multi-act line every act after the first carries
// at=<first token>; an act ends where the next begins (the last act at the line's end). sp=<a>-<b> gives an
// explicit span whenever that default would be wrong.
//
// Codes are short, single words chosen so each routing enum's first model token differs (measured with the pinned
// tokenizer in tools/dialogue-reader-tokens.js). The facet-code table is versioned with the wire.

const crypto = require("node:crypto");
const RF = require("./dialogue-reader-frame");
const registry = require("./dialogue-registry");

const WIRE_VERSION = "yellow-beast-reader-wire@v1";

const SPEECH = Object.freeze({ greeting: "greet", farewell: "bye", self_introduction: "intro", social_acknowledgment: "ack", thanks: "thanks", attention_call: "call", statement: "state", sarcasm: "sarcasm", question: "ask", request: "request", repair: "repair", elliptical_continuation: "more", answer: "answer", aside: "aside" });
const RELATION = Object.freeze({ new: "new", continuation: "cont", repair: "fix", topic_return: "back", attention: "nudge", answer: "reply", withdraw: "drop", conclude: "end" });
const ADDRESS = Object.freeze({ NONE: "-", ALL: "all", OTHERS: "others", SECOND_PERSON: "you" }); // NAMED -> @n1+n2, EXCEPT -> except@n1
const QFORM = Object.freeze({ wh: "wh", yes_no: "yn", choice: "choice", declarative: "decl", indirect: "indirect", tag: "tag", count: "count" }); // none elided
const POLARITY = Object.freeze({ negative: "neg", inverted: "inv" }); // positive elided
const TEMPORAL = Object.freeze({ now: "now", today: "today", earlier: "earlier", ever: "ever", historical: "past" }); // unspecified elided
const MODE = Object.freeze({ each: "each", any: "any", all: "all" }); // unspecified elided
const REPAIR = Object.freeze({ addressee: "who", referent: "what", facet: "topic", temporal: "when", unanswered: "unanswered", own_answer: "mine" });
const ROLE = Object.freeze({ vocative: "voc", mention: "men", answer_to_inbound: "ans", greeting_target: "greet", repair_target: "fix" });
const REF_SPECIAL = Object.freeze({ NONE: "none", AMBIGUOUS: "unsure", DEIXIS_THERE: "there", DEIXIS_INSIDE: "inside" });
const INBOUND_KIND = Object.freeze({ answer: "ans", uncertainty: "unsure", refusal: "refuse", counter_question: "counter", none: "none" });
const OPTION_SPECIAL = Object.freeze({ YES: "yes", NO: "no", BOTH: "both", NEITHER: "neither", EITHER: "either", NONE_OF_OFFERED: "noneof" });
const SUBJECT = Object.freeze({ addressee: "you", speaker: "me", named: "named", group: "group", group_inclusive: "us", none: "none" });
const ACTION = Object.freeze(Object.fromEntries(RF.ACTION_FAMILIES.map((f) => [f, f.toLowerCase()])));
const ABSTAIN = Object.freeze({ force: "force", address: "address", facet: "facet", relation: "relation", referent: "referent", subject: "subject", temporal: "time", inbound_answer: "answer" });

// The versioned facet-code table (registry id -> wire code). Special values: NONE_ASKING "?", NOT_APPLICABLE "-".
const FACET_CODES = Object.freeze({
  "person.first_day_at_async": "firstday", "person.async_tenure": "tenure", "person.expedition_experience": "expeditions", "person.complex_experience": "beeninside",
  "person.wellbeing": "wellbeing", "person.nervousness": "nervous", "person.anticipation": "looking_forward", "person.fatigue": "tired", "person.self_description": "about_self",
  "person.identity": "identity", "person.role": "role", "person.authority": "authority", "person.presence": "presence", "person.familiarity": "knows_person",
  "person.current_assignment": "assignment", "person.current_activity": "doing_now", "person.opinion": "opinion", "person.intent": "intent",
  "mission.objective": "objective", "mission.destination": "destination", "mission.schedule": "schedule", "mission.route": "route", "mission.participants": "who_goes",
  "procedure.next_incomplete_step": "next_step", "procedure.instruction_history": "instructions", "transition.participants": "together",
  "item.holder": "holder", "item.purpose": "purpose", "item.contents": "contents", "item.destination": "deliver_to", "item.definition": "object",
  "item.location": "whereis", "item.provenance": "provenance", "item.status": "condition",
  "place.definition": "site", "place.access": "access", "place.status": "status",
  "institution.purpose": "company", "conversation.claim_check": "really", "conversation.meaning_of": "meaning", "conversation.basis_of": "basis",
  "conversation.explanation": "why", "conversation.reported_speech": "said", "conversation.response_event": "response", "conversation.repetition": "repeat"
});
const FACET_SPECIAL_CODES = Object.freeze({ NONE_ASKING: "?", NOT_APPLICABLE: "-" });
const TAGS = Object.freeze(["at", "sp", "f", "pol", "nr", "rel", "n", "rk", "r", "nom", "t", "m", "ia", "s", "si", "echo", "do", "ab"]);

const invert = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k])));
const DEC = {
  speech: invert(SPEECH), relation: invert(RELATION), address: invert(ADDRESS), qform: invert(QFORM), polarity: invert(POLARITY), temporal: invert(TEMPORAL), mode: invert(MODE),
  repair: invert(REPAIR), role: invert(ROLE), refSpecial: invert(REF_SPECIAL), inboundKind: invert(INBOUND_KIND), optionSpecial: invert(OPTION_SPECIAL), subject: invert(SUBJECT),
  action: invert(ACTION), abstain: invert(ABSTAIN), facet: invert({ ...FACET_CODES, ...FACET_SPECIAL_CODES })
};
/** The digest pinning every table above (wire version + tables); recorded in receipts and score artifacts. */
const WIRE_TABLES = Object.freeze({ SPEECH, RELATION, ADDRESS, QFORM, POLARITY, TEMPORAL, MODE, REPAIR, ROLE, REF_SPECIAL, INBOUND_KIND, OPTION_SPECIAL, SUBJECT, ACTION, ABSTAIN, FACET_CODES, FACET_SPECIAL_CODES, TAGS });
const WIRE_DIGEST = crypto.createHash("sha256").update(JSON.stringify([WIRE_VERSION, WIRE_TABLES])).digest("hex");

function facetCodeTableComplete() {
  const missing = registry.ids().filter((id) => !FACET_CODES[id]);
  const extra = Object.keys(FACET_CODES).filter((id) => !registry.get(id));
  const codes = Object.values({ ...FACET_CODES, ...FACET_SPECIAL_CODES });
  return { missing, extra, duplicate_codes: codes.filter((c, i) => codes.indexOf(c) !== i) };
}

// ─── canonical (defaults filled) frame: what "semantic round trip" compares ──────────────────────────
const ACT_DEFAULTS = Object.freeze({ name_roles: [], question_form: "none", polarity: "positive", repair_kind: null, referent: null, temporal: "unspecified", respondent_mode: "unspecified", inbound_answer: null, subject: null, self_intro: null, echo: null, requested_action: null, abstain: [] });
function canonicalAct(a) {
  const act = { ...ACT_DEFAULTS, ...a };
  const out = {
    span: [...act.span], speech_act: act.speech_act, question_form: act.question_form, facet: act.facet, polarity: act.polarity,
    name_roles: (act.name_roles ?? []).map((r) => ({ name: r.name, role: r.role })),
    address: { op: act.address?.op ?? "NONE", names: [...(act.address?.names ?? [])], relative_to: act.address?.relative_to ?? null, count: act.address?.count ?? null },
    relation: { kind: act.relation?.kind ?? "new", target: act.relation?.target ?? null },
    repair_kind: act.repair_kind ?? null,
    referent: act.referent ? { span: act.referent.span ?? null, candidate: act.referent.candidate ?? null, ...(act.referent.nominated ? { nominated: [...act.referent.nominated] } : {}) } : null,
    temporal: act.temporal, respondent_mode: act.respondent_mode,
    inbound_answer: act.inbound_answer ? { kind: act.inbound_answer.kind, option: act.inbound_answer.option ?? null } : null,
    subject: act.subject ? { kind: act.subject.kind, names: [...(act.subject.names ?? [])] } : null,
    self_intro: act.self_intro ? { span: [...act.self_intro.span] } : null,
    echo: act.echo ? { anchor: act.echo.anchor ?? null } : null,
    requested_action: act.requested_action ? { family: act.requested_action.family, object: act.requested_action.object ?? null } : null,
    abstain: [...(act.abstain ?? [])]
  };
  return out;
}
function canonicalFrame(frame) { return { version: frame?.version ?? RF.READER_FRAME_VERSION, acts: (frame?.acts ?? []).map(canonicalAct) }; }

/** The name roles a NAMED address implies when nothing else is said (elided on the wire). */
function defaultNameRoles(act) {
  if (act.address?.op !== "NAMED") return [];
  const role = ["greeting", "farewell"].includes(act.speech_act) ? "greeting_target" : "vocative";
  return (act.address.names ?? []).map((name) => ({ name, role }));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const range = (s) => `${s[0]}-${s[1]}`;

// ─── encode ───────────────────────────────────────────────────────────────────────────────────────────
function encodeAct(act, { at = null, span = null }) {
  const a = canonicalAct(act);
  const facet = FACET_SPECIAL_CODES[a.facet] ?? FACET_CODES[a.facet];
  if (!SPEECH[a.speech_act]) throw new Error(`encodeWire: unknown speech_act ${a.speech_act}`);
  if (!facet) throw new Error(`encodeWire: facet without a wire code ${a.facet}`);
  const op = a.address.op;
  const address = op === "NAMED" ? `@${a.address.names.join("+")}` : op === "EXCEPT" ? `except@${a.address.names.join("+")}` : ADDRESS[op];
  if (!address) throw new Error(`encodeWire: unknown address op ${op}`);
  if (op !== "NAMED" && op !== "EXCEPT" && a.address.names.length) throw new Error("encodeWire: names on a non-naming address op");
  if ((op === "NAMED" || op === "EXCEPT") && !a.address.names.length) throw new Error(`encodeWire: ${op} without names`);
  const relation = `${RELATION[a.relation.kind]}${a.relation.target ? `:${a.relation.target}` : ""}`;
  const out = [SPEECH[a.speech_act], facet, address, relation];
  const tag = (k, v) => out.push(`${k}=${v}`);
  if (span) tag("sp", range(span)); else if (at != null) tag("at", at);
  if (a.question_form !== "none") tag("f", QFORM[a.question_form]);
  if (a.polarity !== "positive") tag("pol", POLARITY[a.polarity]);
  if (!same(a.name_roles, defaultNameRoles(a))) tag("nr", a.name_roles.length ? a.name_roles.map((r) => `${r.name}:${ROLE[r.role]}`).join("+") : "-");
  if (a.address.relative_to) tag("rel", a.address.relative_to);
  if (a.address.count != null) tag("n", a.address.count);
  if (a.repair_kind) tag("rk", REPAIR[a.repair_kind]);
  if (a.referent) {
    const cand = a.referent.candidate == null ? "null" : REF_SPECIAL[a.referent.candidate] ?? a.referent.candidate;
    tag("r", a.referent.span ? `${a.referent.span}>${cand}` : cand);
    if (a.referent.nominated) tag("nom", range(a.referent.nominated));
  }
  if (a.temporal !== "unspecified") tag("t", TEMPORAL[a.temporal]);
  if (a.respondent_mode !== "unspecified") tag("m", MODE[a.respondent_mode]);
  if (a.inbound_answer) { const o = a.inbound_answer.option; tag("ia", `${INBOUND_KIND[a.inbound_answer.kind]}${o == null ? "" : `:${OPTION_SPECIAL[o] ?? o}`}`); }
  if (a.subject) tag("s", `${SUBJECT[a.subject.kind]}${a.subject.names.length ? `:${a.subject.names.join("+")}` : ""}`);
  if (a.self_intro) tag("si", range(a.self_intro.span));
  if (a.echo) tag("echo", a.echo.anchor ?? "null");
  if (a.requested_action) tag("do", `${ACTION[a.requested_action.family]}${a.requested_action.object ? `:${a.requested_action.object}` : ""}`);
  if (a.abstain.length) tag("ab", a.abstain.map((f) => ABSTAIN[f]).join("+"));
  return out.join(" ");
}

/** ReaderFrame -> wire text. `input` supplies the token count the span defaults are computed against. */
function encodeWire(frame, input) {
  const acts = frame?.acts ?? [];
  if (!acts.length) throw new Error("encodeWire: a frame needs at least one act");
  const last = (input?.line?.tokens?.length ?? 0) - 1;
  const parts = acts.map((act, i) => {
    const [a, b] = act.span;
    const start = i === 0 ? 0 : a;
    const nextStart = i + 1 < acts.length ? acts[i + 1].span[0] : last + 1;
    const impliedEnd = nextStart - 1;
    const explicit = (i === 0 && a !== 0) || b !== impliedEnd;
    return encodeAct(act, { at: i > 0 && !explicit ? start : null, span: explicit ? [a, b] : null });
  });
  return parts.join(" ; ");
}

// ─── decode ───────────────────────────────────────────────────────────────────────────────────────────
const LABEL_ANY = /^(?:n|e|q|i|r|a|o|p|v|c)\d+$|^s[0-2]$/;
function decodeWire(text, input) {
  const errors = [];
  const fail = (code, detail = {}) => { errors.push(Object.freeze({ layer: "V0", code: `wire_${code}`, ...detail })); };
  if (typeof text !== "string") return { ok: false, frame: null, errors: [{ layer: "V0", code: "wire_not_text" }] };
  const body = text.replace(/\r?\n$/, "").trim();
  if (!body) return { ok: false, frame: null, errors: [{ layer: "V0", code: "wire_empty" }] };
  if (/[\n\r\t]/.test(body) || /[^ -~]/.test(body)) return { ok: false, frame: null, errors: [{ layer: "V0", code: "wire_illegal_character" }] };
  const segments = body.split(" ; ");
  if (segments.length > RF.MAX_ACTS) fail("too_many_acts", { count: segments.length });
  const tokenCount = input?.line?.tokens?.length ?? 0;
  const parsed = segments.map((seg, i) => {
    const fields = seg.split(" ");
    if (fields.some((f) => !f.length)) { fail("empty_field", { act: i }); return null; }
    if (fields.length < 4) { fail("short_core", { act: i }); return null; }
    const [sa, fc, ad, rl, ...rest] = fields;
    const act = { ...structuredClone(ACT_DEFAULTS) };
    act.speech_act = DEC.speech[sa] ?? (fail("unknown_speech_act", { act: i, value: sa }), null);
    act.facet = DEC.facet[fc] ?? (fail("unknown_facet_code", { act: i, value: fc }), null);
    // address
    if (ad.startsWith("except@")) act.address = { op: "EXCEPT", names: ad.slice(7).split("+"), relative_to: null, count: null };
    else if (ad.startsWith("@")) act.address = { op: "NAMED", names: ad.slice(1).split("+"), relative_to: null, count: null };
    else if (DEC.address[ad]) act.address = { op: DEC.address[ad], names: [], relative_to: null, count: null };
    else { fail("unknown_address", { act: i, value: ad }); act.address = { op: "NONE", names: [], relative_to: null, count: null }; }
    if (act.address.names.some((n) => !/^n\d+$/.test(n))) fail("bad_name_label", { act: i });
    // relation
    const [rk, rt, extra] = rl.split(":");
    if (extra !== undefined) fail("bad_relation", { act: i });
    act.relation = { kind: DEC.relation[rk] ?? (fail("unknown_relation", { act: i, value: rk }), "new"), target: rt === undefined ? null : rt };
    if (rt !== undefined && !LABEL_ANY.test(rt)) fail("bad_relation_target", { act: i, value: rt });
    // tags
    const seen = new Set();
    let at = null; let sp = null;
    const spanOf = (v, key) => { const m = /^(\d+)-(\d+)$/.exec(v); if (!m) { fail("bad_span", { act: i, key }); return null; } return [Number(m[1]), Number(m[2])]; };
    let nr = null;
    for (const t of rest) {
      const eq = t.indexOf("=");
      if (eq <= 0) { fail("bad_tag", { act: i, value: t }); continue; }
      const k = t.slice(0, eq);
      const v = t.slice(eq + 1);
      if (!TAGS.includes(k)) { fail("unknown_tag", { act: i, value: k }); continue; }
      if (seen.has(k)) { fail("duplicate_tag", { act: i, value: k }); continue; }
      seen.add(k);
      if (!v.length) { fail("empty_tag_value", { act: i, value: k }); continue; }
      const code = (table, name) => table[v] ?? (fail(`unknown_${name}`, { act: i, value: v }), null);
      switch (k) {
        case "at": if (!/^\d+$/.test(v)) fail("bad_at", { act: i }); else at = Number(v); break;
        case "sp": sp = spanOf(v, "sp"); break;
        case "f": act.question_form = code(DEC.qform, "question_form") ?? "none"; break;
        case "pol": act.polarity = code(DEC.polarity, "polarity") ?? "positive"; break;
        case "nr": nr = v === "-" ? [] : v.split("+").map((x) => { const [name, role, bad] = x.split(":"); if (bad !== undefined || !/^n\d+$/.test(name ?? "") || !DEC.role[role]) { fail("bad_name_role", { act: i, value: x }); return null; } return { name, role: DEC.role[role] }; }).filter(Boolean); break;
        case "rel": if (!/^q\d+$/.test(v)) fail("bad_relative_to", { act: i }); act.address.relative_to = v; break;
        case "n": if (!/^\d+$/.test(v)) fail("bad_count", { act: i }); act.address.count = Number(v); break;
        case "rk": act.repair_kind = code(DEC.repair, "repair_kind"); break;
        case "r": {
          const [spanLabel, cand] = v.includes(">") ? v.split(">") : [null, v];
          if (spanLabel !== null && !/^e\d+$/.test(spanLabel)) fail("bad_referent_span", { act: i });
          const candidate = cand === "null" ? null : DEC.refSpecial[cand] ?? cand;
          if (candidate !== null && !RF.REFERENT_CHOICE_SPECIAL.includes(candidate) && !/^r\d+$/.test(candidate)) fail("bad_referent", { act: i, value: cand });
          act.referent = { span: spanLabel, candidate, ...(act.referent?.nominated ? { nominated: act.referent.nominated } : {}) };
          break;
        }
        case "nom": { const s = spanOf(v, "nom"); if (s) act.referent = { ...(act.referent ?? { span: null, candidate: "NONE" }), nominated: s }; break; }
        case "t": act.temporal = code(DEC.temporal, "temporal") ?? "unspecified"; break;
        case "m": act.respondent_mode = code(DEC.mode, "respondent_mode") ?? "unspecified"; break;
        case "ia": { const [kind, opt, bad] = v.split(":"); if (bad !== undefined) fail("bad_inbound", { act: i }); const option = opt === undefined ? null : DEC.optionSpecial[opt] ?? opt; if (option !== null && !RF.INBOUND_OPTION_SPECIAL.includes(option) && !/^o\d+$/.test(option)) fail("bad_option", { act: i, value: opt }); act.inbound_answer = { kind: DEC.inboundKind[kind] ?? (fail("unknown_inbound_kind", { act: i, value: kind }), "none"), option }; break; }
        case "s": { const [kind, names, bad] = v.split(":"); if (bad !== undefined) fail("bad_subject", { act: i }); const list = names ? names.split("+") : []; if (list.some((n) => !/^n\d+$/.test(n))) fail("bad_subject_name", { act: i }); act.subject = { kind: DEC.subject[kind] ?? (fail("unknown_subject", { act: i, value: kind }), "none"), names: list }; break; }
        case "si": { const s = spanOf(v, "si"); if (s) act.self_intro = { span: s }; break; }
        case "echo": if (v !== "null" && !/^a\d+$/.test(v)) fail("bad_echo", { act: i }); act.echo = { anchor: v === "null" ? null : v }; break;
        case "do": { const [fam, obj, bad] = v.split(":"); if (bad !== undefined) fail("bad_action", { act: i }); if (obj !== undefined && !/^r\d+$/.test(obj)) fail("bad_action_object", { act: i }); act.requested_action = { family: DEC.action[fam] ?? (fail("unknown_action", { act: i, value: fam }), "OTHER"), object: obj ?? null }; break; }
        case "ab": { const list = v.split("+").map((x) => DEC.abstain[x] ?? (fail("unknown_abstain", { act: i, value: x }), null)).filter(Boolean); if (new Set(list).size !== list.length) fail("duplicate_abstain", { act: i }); act.abstain = list; break; }
        default: break;
      }
    }
    act.name_roles = nr ?? defaultNameRoles(act);
    return { act, at, sp };
  });
  if (errors.length || parsed.some((p) => !p)) return { ok: false, frame: null, errors: errors.length ? errors : [{ layer: "V0", code: "wire_malformed" }] };
  // spans
  const starts = parsed.map((p, i) => (p.sp ? p.sp[0] : p.at != null ? p.at : i === 0 ? 0 : null));
  parsed.forEach((p, i) => {
    if (starts[i] === null) { fail("missing_act_start", { act: i }); return; }
    if (i === 0 && p.at != null && p.at !== 0 && !p.sp) fail("first_act_start_not_zero", { act: i });
    const end = p.sp ? p.sp[1] : i + 1 < parsed.length ? (starts[i + 1] ?? 0) - 1 : tokenCount - 1;
    p.act.span = [starts[i], end];
  });
  if (errors.length) return { ok: false, frame: null, errors };
  const frame = { version: RF.READER_FRAME_VERSION, acts: parsed.map((p) => canonicalAct(p.act)) };
  return { ok: true, frame, errors: [] };
}

// ─── grammar (GBNF, per ReaderInput: closed label sets) ─────────────────────────────────────────────────
const gq = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const alt = (list) => (list.length ? list.map(gq).join(" | ") : '"__none__"');
/**
 * The llama.cpp GBNF grammar a constrained local reader decodes against for ONE ReaderInput: every enum closed, every
 * label drawn from the labels this input supplied. It accepts a superset of what V1-V3 accept (e.g. any supplied
 * request label as a target); validation stays the authority.
 */
function wireGrammar(input = {}) {
  const lbl = (list) => (list ?? []).map((x) => x.label);
  const names = lbl(input.features?.name_spans);
  const entities = lbl(input.features?.entity_spans);
  const requests = lbl(input.conversation?.requests);
  const inbound = [input.conversation?.inbound?.label, input.conversation?.just_answered_inbound?.label].filter(Boolean);
  const referents = lbl(input.referent_candidates);
  const anchors = lbl(input.heard?.anchors);
  const options = lbl(input.conversation?.inbound?.options);
  const activity = input.conversation?.activity?.label ? [input.conversation.activity.label] : [];
  const claim = input.conversation?.player_claim?.label ? [input.conversation.player_claim.label] : [];
  const tokenMax = Math.max(0, (input.line?.tokens?.length ?? 1) - 1);
  const idx = Array.from({ length: tokenMax + 1 }, (_, i) => String(i));
  const targets = [...requests, ...inbound, "s0", "s1", ...activity, ...anchors, ...claim];
  const rules = [
    `root ::= act (" ; " act){0,${RF.MAX_ACTS - 1}}`,
    `act ::= speech " " facet " " address " " relation tag*`,
    `speech ::= ${alt(Object.values(SPEECH))}`,
    `facet ::= ${alt(Object.values({ ...FACET_CODES, ...FACET_SPECIAL_CODES }))}`,
    `address ::= ${alt(Object.values(ADDRESS))}${names.length ? ` | "@" names | "except@" names` : ""}`,
    names.length ? `names ::= name ("+" name){0,3}` : null,
    names.length ? `name ::= ${alt(names)}` : null,
    `relation ::= ${alt(Object.values(RELATION))}${targets.length ? ` | (${alt(Object.values(RELATION))}) ":" target` : ""}`,
    targets.length ? `target ::= ${alt(targets)}` : null,
    `idx ::= ${alt(idx)}`,
    `tag ::= " " (${[
      `"at=" idx`, `"sp=" idx "-" idx`, `"f=" (${alt(Object.values(QFORM))})`, `"pol=" (${alt(Object.values(POLARITY))})`,
      names.length ? `"nr=" ("-" | name ":" role ("+" name ":" role){0,5})` : `"nr=-"`,
      requests.length ? `"rel=" (${alt(requests)})` : null, `"n=" ("2" | "3" | "4" | "5" | "6")`, `"rk=" (${alt(Object.values(REPAIR))})`,
      `"r=" ${entities.length ? `((${alt(entities)}) ">")? ` : ""}(${alt([...referents, ...Object.values(REF_SPECIAL)])})`, `"nom=" idx "-" idx`,
      `"t=" (${alt(Object.values(TEMPORAL))})`, `"m=" (${alt(Object.values(MODE))})`,
      `"ia=" (${alt(Object.values(INBOUND_KIND))}) (":" (${alt([...options, ...Object.values(OPTION_SPECIAL)])}))?`,
      `"s=" (${alt(Object.values(SUBJECT))})${names.length ? ` (":" names)?` : ""}`, `"si=" idx "-" idx`,
      anchors.length ? `"echo=" (${alt(anchors)})` : null, `"do=" (${alt(Object.values(ACTION))})${referents.length ? ` (":" (${alt(referents)}))?` : ""}`,
      `"ab=" abst ("+" abst){0,7}`
    ].filter(Boolean).join(" | ")})`,
    names.length ? `role ::= ${alt(Object.values(ROLE))}` : null,
    `abst ::= ${alt(Object.values(ABSTAIN))}`
  ].filter(Boolean);
  return rules.join("\n");
}

/**
 * Step 14 only (development wire-vs-JSON check): a minimal-JSON answer -> ReaderFrame (defaults filled). Malformed
 * JSON, a non-object, unknown keys or a missing core field fail V0 exactly as a malformed wire does.
 */
function decodeJsonFrame(text, input) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? "").trim()); } catch { return { ok: false, frame: null, errors: [{ layer: "V0", code: "json_malformed" }] }; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.acts) || !parsed.acts.length) return { ok: false, frame: null, errors: [{ layer: "V0", code: "json_no_acts" }] };
  const last = (input?.line?.tokens?.length ?? 1) - 1;
  const acts = parsed.acts.map((a, i, all) => ({ span: Array.isArray(a?.span) ? a.span : all.length === 1 ? [0, last] : a?.span, ...a, address: { op: a?.address?.op ?? "NONE", names: a?.address?.names ?? [], relative_to: a?.address?.relative_to ?? null, count: a?.address?.count ?? null }, relation: { kind: a?.relation?.kind ?? "new", target: a?.relation?.target ?? null } }));
  const frame = { version: RF.READER_FRAME_VERSION, acts: acts.map((a) => ({ ...canonicalAct(a), name_roles: a.name_roles ?? defaultNameRoles(a) })) };
  const v0 = RF.validateSchema(frame, input);
  const extra = parsed.acts.flatMap((a) => Object.keys(a ?? {}).filter((k) => !RF.ACT_KEYS.includes(k)));
  if (!v0.ok || extra.length) return { ok: false, frame: null, errors: [...v0.errors, ...(extra.length ? [{ layer: "V0", code: "json_unknown_key", keys: extra }] : [])] };
  return { ok: true, frame, errors: [] };
}

module.exports = { decodeJsonFrame, WIRE_VERSION, WIRE_DIGEST, WIRE_TABLES, FACET_CODES, FACET_SPECIAL_CODES, SPEECH, RELATION, ADDRESS, TAGS, encodeWire, decodeWire, canonicalFrame, canonicalAct, defaultNameRoles, wireGrammar, facetCodeTableComplete };
