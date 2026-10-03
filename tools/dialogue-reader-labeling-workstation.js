#!/usr/bin/env node
"use strict";

// Reader Phase 2 -- HUMAN PRIMARY LABELING WORKSTATION (docs/reader/READER_PHASE2_LABELING_WORKSTATION.md).
// Developer tooling only: a LOCAL, loopback-only, dependency-free instrument that lets the human primary labeler write
// HUMAN_PRIMARY rows for the frozen 474-render census without hand-editing JSONL.
//
// It NEVER infers, suggests, prefills, ranks, repairs or reveals a semantic answer. The human owns every judgment.
//
// BLINDNESS BOUNDARY (enforced by construction, not by promise):
//   * The serving process loads exactly three things: the BLANK worksheet (dialogue-reader-labels.js worksheet(): the
//     frozen system text + exactly the user render a reader sees), an INPUT PACK (the observer-safe ReaderInput of each
//     frozen render, needed only for V0 syntax / V1-V2 legality checks of the human's own wire, and bound to the
//     worksheet by render digest), and the human's own label file.
//   * The answer-bearing CAPTURE (legacy reader frame l0, production routing, context snapshot, bindings, canonical
//     state) is touched ONLY by `--prepare` (which writes the blank worksheet + input pack and then discards it) and by
//     `--validate-full` (the post-commit, resolver-level validation through the existing dialogue-reader-labels.js
//     validator). Neither runs in the serving process, and the capture is never written to the labeling directory.
//   * Commit-time feedback is limited to V0 (syntax / structure), V1 (legal labels) and V2 (surface contradiction) of
//     the human's OWN wire against the observer-safe input, plus schema completeness. Nothing about what the resolver
//     would do (V3 discourse clarification, ACCEPT-resolves, EXPECTED_CLARIFY slot match) is shown while labeling; that
//     is post-commit information, exactly like the model review (READER_PHASE2_LABEL_GUIDE.md §5).
//   * Local only: binds 127.0.0.1 / ::1 / localhost (anything else is refused), validates Host + Origin, a per-run
//     token, a strict CSP (no external script, style, font, image or connection), and the CLI installs an egress guard
//     that makes every outbound fetch / http(s) / socket / dns call throw. No model, no telemetry, no CDN.
//
//   node tools/dialogue-reader-labeling-workstation.js --prepare            (once: capture -> blank worksheet + input pack)
//   node tools/dialogue-reader-labeling-workstation.js                      (serve; prints the localhost address)
//   node tools/dialogue-reader-labeling-workstation.js --validate           (whole-file, observer-safe, offline)
//   node tools/dialogue-reader-labeling-workstation.js --validate-full      (existing validator; regenerates the capture)

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const W = require("./dialogue-reader-wire");
const RF = require("./dialogue-reader-frame");
const { renderReaderPrompt, SYSTEM_DIGEST, SYSTEM_TEXT, RENDER_VERSION } = require("./dialogue-reader-render");
const L = require("./dialogue-reader-labels"); // the existing schema / validator authority (label states, outcomes, slots, fields)
const RP = require("./dialogue-reader-replay"); // renderGroups / teacher sample / primaryAct (no capture is loaded at require time)

const ROOT = path.join(__dirname, "..");
const WORKSTATION_VERSION = "yellow-beast-reader-labeling-workstation@v1";
const DEFAULT_DIR = path.join(ROOT, ".agent-notes", "reader-phase2-labeling");
const FILES = Object.freeze({ worksheet: "worksheet.jsonl", pack: "input-pack.json", labels: "labels.jsonl", journal: "journal.jsonl", receipt: "prepare-receipt.json", lock: ".workstation.lock" });
// A human primary has exactly two outcomes. UNLABELABLE is an adjudicator-only determination (dialogue-reader-labels.js:
// accepted only as ADJUDICATED_GOLD); the workstation never offers, accepts, stores or reclassifies it.
const OUTCOMES = Object.freeze([L.GOLD_OUTCOMES.ACCEPT, L.GOLD_OUTCOMES.EXPECTED_CLARIFY]);
const DEFAULT_LABELER = "jack";
const DEFAULT_PORT = 47474;
const MAX_BODY = 64 * 1024;
const MAX_WIRE = 2000;
const MAX_TEXT = 4000;
const MAX_NOTES = 4000;
const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost", "::1", "[::1]"]);
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// ─── atomic / durable local I/O ──────────────────────────────────────────────────────────────────────
function fsyncDir(dir) { try { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* directory fsync is best effort (not supported on every platform) */ } }
/** Write-temp + fsync + rename + fsync(dir): the file is always either the old content or the complete new content. */
function atomicWrite(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  fsyncDir(dir);
}
function appendDurable(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, "a", 0o600);
  try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
function readJsonlStrict(file, what) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").map((l, i) => [l.trim(), i + 1]).filter(([l]) => l && !l.startsWith("//")).map(([l, n]) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`${what}: line ${n} is not valid JSON (${e.message}); refusing to continue so no label is dropped`); }
  });
}

// ─── the egress guard (CLI only): every outbound path throws ───────────────────────────────────────
function installEgressGuard(g = globalThis) {
  const net = require("node:net"); const tls = require("node:tls"); const dns = require("node:dns"); const dgram = require("node:dgram"); const https = require("node:https");
  const deny = (what) => function denied() { throw new Error(`labeling workstation: outbound ${what} is disabled (local-only instrument)`); };
  g.fetch = deny("fetch");
  http.request = deny("http.request"); http.get = deny("http.get"); https.request = deny("https.request"); https.get = deny("https.get");
  net.connect = deny("net.connect"); net.createConnection = deny("net.createConnection"); net.Socket.prototype.connect = deny("socket.connect");
  tls.connect = deny("tls.connect"); dgram.createSocket = deny("dgram");
  // Node resolves an IP literal through dns.lookup when listening; only a real hostname lookup is outbound.
  const lookup = dns.lookup;
  dns.lookup = function guardedLookup(host, ...rest) { if (net.isIP(String(host ?? ""))) return lookup.call(dns, host, ...rest); throw new Error("labeling workstation: outbound dns.lookup is disabled (local-only instrument)"); };
  for (const fn of ["resolve", "resolve4", "resolve6", "resolveAny"]) dns[fn] = deny(`dns.${fn}`);
  return true;
}

// ─── loopback-only binding ───────────────────────────────────────────────────────────────────────────
function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.includes(String(host))) throw new Error(`refusing to bind "${host}": the workstation is loopback-only (127.0.0.1, ::1 or localhost)`);
  return host === "localhost" ? "127.0.0.1" : host.replace(/^\[|\]$/g, "");
}
const isLoopbackAddress = (a) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";

// ─── the git-ignore guard for the active label path ──────────────────────────────────────────────────
function insideRepo(file) { const rel = path.relative(ROOT, path.resolve(file)); return !rel.startsWith("..") && !path.isAbsolute(rel); }
/** true when `file` is outside the repository or git ignores it. Never true for a tracked-by-default path. */
function isIgnoredOrOutsideRepo(file) {
  if (!insideRepo(file)) return true;
  try { execFileSync("git", ["check-ignore", "-q", "--", path.resolve(file)], { cwd: ROOT, stdio: "ignore" }); return true; } catch { return false; }
}

// ─── the render view (display-only parse of the AUTHORIZED render_user text) ─────────────────────────
const VIEW_RULES = Object.freeze([
  [/^line: /, "line", "line", "Player line"],
  [/^read as: /, "line", "read_as", "Read as"],
  [/^tokens: /, "line", "tokens", "Tokens (index:text)"],
  [/^people: /, "people", "people", "People present"],
  [/^player chose to speak to: /, "people", "chip", "Player chose to speak to (interface chip)"],
  [/^names typed: /, "typed", "names_typed", "Names typed"],
  [/^things typed: /, "typed", "things_typed", "Things typed"],
  [/^things: /, "scene", "things", "Things that may be referred to"],
  [/^place in talk: /, "scene", "place", "Place in talk"],
  [/^"it\/that\/there" may be: /, "scene", "anaphora", "\"it / that / there\" may be"],
  [/^talking with: /, "scene", "talking_with", "Talking with"],
  [/^q\d+: /, "discourse", "request", "Earlier request"],
  [/^i1: /, "discourse", "inbound", "Coworker question waiting (i1)"],
  [/^i0: /, "discourse", "inbound_done", "Coworker question just answered (i0)"],
  [/^v1: /, "discourse", "activity", "Activity round (v1)"],
  [/^c1: /, "discourse", "claim", "Player's previous claim (c1)"],
  [/^player's previous line: /, "discourse", "previous_line", "Player's previous line"],
  [/^heard /, "heard", "heard", "Heard"]
]);
const GROUP_ORDER = Object.freeze(["line", "people", "typed", "scene", "discourse", "heard", "other"]);
const GROUP_TITLE = Object.freeze({ line: "What the player said", people: "People", typed: "Typed in the line", scene: "Things in play", discourse: "Conversation state", heard: "Heard coworker lines", other: "Other" });
/** Splits render_user into labelled lines. Display only: the raw text is always sent alongside. */
function viewOfRender(renderUser) {
  const out = [];
  for (const raw of String(renderUser).split("\n")) {
    const rule = VIEW_RULES.find(([re]) => re.test(raw));
    if (!rule) { out.push({ group: "other", key: "other", title: "Other", text: raw }); continue; }
    const [re, group, key, title] = rule;
    const text = key === "heard" ? raw.replace(/^heard /, "") : raw.replace(re, "");
    const entry = { group, key, title: key === "request" ? `Earlier request ${raw.slice(0, raw.indexOf(":"))}` : title, text };
    if (key === "tokens") entry.tokens = [...text.matchAll(/(\d+):(\S*)/g)].map((m) => ({ i: Number(m[1]), text: m[2] }));
    out.push(entry);
  }
  return out;
}

// ─── the static grammar reference (generic; never derived from an item) ──────────────────────────────
function grammarReference() {
  return {
    note: "Syntax only. Every example is invented and unrelated to any item; labels (n1, q1, r1...) depend on the item you are reading. This reference never contains a suggested wire.",
    shape: "ACT [ ; ACT ... ]   (at most " + RF.MAX_ACTS + " acts, joined by \" ; \")   ACT = SPEECH FACET ADDRESS RELATION [key=value ...]",
    speech_acts: Object.entries(W.SPEECH).map(([meaning, code]) => ({ code, meaning })),
    facets: { special: Object.entries(W.FACET_SPECIAL_CODES).map(([meaning, code]) => ({ code, meaning })), table: "see \"Field definitions\" (the frozen system text, FACET CODES)" },
    address: [{ code: "-", meaning: "nobody named" }, { code: "@n1", meaning: "said to that typed name (several: @n1+n2)" }, { code: "except@n1", meaning: "everyone but" }, ...Object.entries(W.ADDRESS).filter(([k]) => k !== "NONE").map(([meaning, code]) => ({ code, meaning: meaning.toLowerCase().replace(/_/g, " ") }))],
    relation: Object.entries(W.RELATION).map(([meaning, code]) => ({ code: code === "new" ? "new" : code === "end" ? "end:v1 | end" : `${code}:T`, meaning: meaning.replace(/_/g, " ") })),
    tags: W.TAGS.map((tag) => ({ tag, form: ({ at: "at=<token index>", sp: "sp=<first>-<last>", f: "f=<question form>", pol: "pol=<polarity>", nr: "nr=n1:<role>[+n2:<role>]", rel: "rel=q1", n: "n=<count>", rk: "rk=<repair kind>", r: "r=<label> | r=e1>r1", nom: "nom=<first>-<last>", t: "t=<time>", m: "m=<mode>", ia: "ia=<kind>[:<option>]", s: "s=<kind>[:n1+n2]", si: "si=<first>-<last>", echo: "echo=a1", do: "do=<family>[:r1]", ab: "ab=<field>[+<field>]" })[tag] ?? `${tag}=<value>` })),
    examples: [
      { wire: "greet - @n1 new", note: "invented: a greeting said to a typed name" },
      { wire: "ack - - new ; ask ? you new at=3", note: "invented: two acts; the second starts at token 3" },
      { wire: "more ? - cont:q1", note: "invented: a continuation of an earlier request label" }
    ],
    rules: ["One line, plain ASCII, no code fence, no quotes, no comments.", "A relation target must be a label that appears in the render.", "Optional fields only when true; defaults are omitted."]
  };
}

// ─── the EASY form reference (static; plain-English wording of the frozen field definitions) ─────────
// Display text only. Every key is a code that already exists in the frozen wire tables (a test fails if a table value has no
// entry here or an entry has no table value). Nothing here depends on an item, and no value is ever preselected or ranked.
const EASY_SPEECH = Object.freeze({
  greet: { label: "Greeting someone", group: "Being social", example: "\u201cHowdy, neighbour!\u201d" },
  bye: { label: "Saying goodbye", group: "Being social", example: "\u201cHave a good weekend.\u201d" },
  intro: { label: "Introducing themself", group: "Being social", example: "\u201cI\u2019m the new hire.\u201d" },
  ack: { label: "Acknowledging / saying okay", group: "Being social", example: "\u201cAlright, noted.\u201d" },
  thanks: { label: "Thanking someone", group: "Being social", example: "\u201cMuch appreciated.\u201d" },
  call: { label: "Getting someone's attention", group: "Being social", example: "\u201cExcuse me!\u201d" },
  state: { label: "Stating or claiming something", group: "Saying something", example: "\u201cThe printer is out of paper.\u201d" },
  sarcasm: { label: "A sarcastic remark", group: "Saying something", example: "\u201cOh wonderful, more paperwork.\u201d" },
  aside: { label: "Something not said to the table", group: "Saying something", example: "" },
  ask: { label: "Asking a question", group: "Asking", example: "\u201cWhat time is it?\u201d" },
  request: { label: "Asking someone to do something", group: "Asking", example: "\u201cCould you open that?\u201d" },
  repair: { label: "Fixing something the player said earlier", group: "Following up", example: "\u201cCorrection: make that Friday.\u201d" },
  more: { label: "A short follow-up", group: "Following up", example: "\u201cAlso on weekends?\u201d" },
  answer: { label: "Answering the coworker question that is waiting (only when one is)", group: "Following up", example: "" }
});
// Relation (frozen RELATION + CONVENTION D): a relation target is a supplied label that THE WORDS THEMSELVES continue, repair, return to,
// press or answer; topical similarity or a discourse marker alone is never a relation.
const EASY_RELATION = Object.freeze({ new: { label: "No \u2014 the words do not point back to anything earlier", target: "none" }, cont: { label: "The words continue something said earlier", target: "required" }, fix: { label: "The words correct something said earlier", target: "required" }, back: { label: "The words go back to an earlier topic", target: "required" }, nudge: { label: "The words press a question nobody has answered yet", target: "required" }, reply: { label: "The words answer the coworker question that is waiting", target: "required" }, drop: { label: "The words take back something said earlier", target: "required" }, end: { label: "The words wrap up the activity round that is open", target: "optional" } });
// Address (frozen ADDRESS + CONVENTIONS B and C): address language in the player's words only. The interface delivery choice is not
// address; a name only talked about is not address; "everyone" only when the words are said to everyone.
const EASY_ADDRESS = Object.freeze({ none: "Nobody \u2014 the words do not address anyone", named: "A person the words name and speak to (not just talk about)", all: "Everyone \u2014 the words are said to everyone (\u201ceveryone\u201d, \u201cyou all\u201d)", others: "The rest \u2014 the words are said to the others", except: "Everyone except a person the words name", you: "An unnamed \u201cyou\u201d \u2014 the words speak to \u201cyou\u201d without a name" });
const EASY_FACET_GROUP = Object.freeze({ person: "About a person", mission: "About the group's mission", procedure: "About what to do", transition: "About going along", item: "About an item", place: "About a place", institution: "About the company", conversation: "About the conversation itself" });
// One plain-English question per step; the Reader term is only a secondary annotation (`term`). {part} becomes "this line" / "this part".
const EASY_QUESTIONS = Object.freeze({
  ecfield: { q: "What is unclear about this line?", term: "abstention field" },
  ecslot: { q: "If a coworker had to ask a question, what would they need to ask?", term: "clarification slot" },
  ecpart: { q: "Which part of the line is it unclear in?", term: "act" },
  start: { q: "Where does this part start?", term: "span" },
  speech: { q: "What is the player doing with {part}?", term: "speech act" },
  facet: { q: "What are they asking about, or claiming?", term: "facet" },
  relyes: { q: "Do the player's words point back to something said earlier?", term: "relation", hint: "Choose Yes only when the words themselves point back to it, not just because it is about the same topic." },
  addr: { q: "Do the player's words directly address anyone?", term: "address", hint: "Use only the player's words here. The interface delivery choice does not decide this answer, and a name the player only talks about is not addressed." },
  rel: { q: "Do the player's words point back to something said earlier?", term: "relation", hint: "Choose Yes only when the words themselves point back to it, not just because it is about the same topic." },
  preview: { q: "Check your answers", term: "" },
  qform: { q: "What kind of question is it?", term: "question form" },
  pol: { q: "Is it worded negatively, or turned around?", term: "polarity" },
  time: { q: "Does it point to a particular time?", term: "temporal" },
  respm: { q: "Do the words say who should answer?", term: "respondent mode" },
  refc: { q: "Is there a particular thing or place they mean?", term: "referent" },
  subj: { q: "If it is about a person, who is it about? (when that is not simply the person the words address)", term: "subject" },
  ia: { q: "Is it answering the question a coworker is waiting on?", term: "inbound answer" },
  rk: { q: "If it fixes something said earlier, what is being fixed?", term: "repair kind" },
  ab: { q: "Does the line itself leave anything genuinely open?", term: "abstain" },
  extra: { q: "Any other field? (raw key=value)", term: "raw" }
});
const EASY_OPTIONAL = Object.freeze({
  qform: { label: "What kind of question", values: { wh: "A who / what / where / when / why question", yn: "A yes/no question", choice: "A choice between options", decl: "A statement asked as a question", indirect: "An indirect question", tag: "A tag question (\"..., right?\")", count: "A how-many question" } },
  pol: { label: "Negative or inverted wording", values: { neg: "Negative", inv: "Inverted" } },
  time: { label: "The time the line sets", values: { now: "Now", today: "Today", earlier: "Earlier", ever: "Ever", past: "In the past" } },
  respm: { label: "Who should answer (only when the words say it)", values: { each: "Each of them", any: "Any one of them", all: "All of them" } },
  refc: { label: "The thing the player means", special: { unsure: "The words are genuinely unclear about which", there: "A place pointed at without naming it (\"there\")", inside: "A place pointed at as \"inside\"", none: "No particular thing" } },
  subj: { label: "Whom a statement about a person is about (only when it is not simply the person the words address)", values: { you: "The person the words address", me: "The player", named: "The people named in the line", group: "A group", us: "The player's own group (\"we all\")", none: "No one" } },
  ia: { label: "How the line answers the waiting coworker question (only while one waits)", values: { ans: "Gives an answer", unsure: "Says they are not sure", refuse: "Refuses", counter: "Asks something back" }, options: { yes: "Yes", no: "No", both: "Both", neither: "Neither", either: "Either", noneof: "None of the offered options" } },
  rk: { label: "What a repair fixes", values: { who: "Who was meant (the person the words addressed)", what: "What thing was meant", topic: "What was asked about", when: "The time", unanswered: "An unanswered question", mine: "The player's own earlier answer" } }
});
// Accurate under the frozen definitions: the abstention fields are the Reader's own fields (system text, OPTIONAL FIELDS ab=); discourse_state is the
// guide's "underdetermined discourse state". The five slots are the resolver's clarification slots (dialogue-resolve-turn.js): the kind of clarifying question.
const EASY_UNCLEAR = Object.freeze({
  force: "What the player is doing (asking, telling, requesting...)",
  address: "Whom the player's words address",
  facet: "What they are asking about or claiming",
  relation: "Which earlier thing the words point back to",
  referent: "Which person or thing they mean",
  subject: "Who a statement about a person is about",
  temporal: "What time they mean",
  inbound_answer: "How this answers the coworker's waiting question",
  discourse_state: "Which part of the conversation they are responding to"
});
const EASY_SLOT = Object.freeze({ person: "Which person?", referent: "Which thing?", location: "Which place?", topic: "What about? (the topic, or which earlier item it follows on from)", answer: "What answer? (to the waiting coworker question)" });
const EASY_ABSTAIN_CODE = Object.freeze({ force: "force", address: "address", facet: "facet", relation: "relation", referent: "referent", subject: "subject", temporal: "time", inbound_answer: "answer" });
function easyReference() {
  const facets = Object.entries(W.FACET_CODES).map(([id, code]) => ({ id, code, group: id.split(".")[0] }));
  return {
    note: "Display wording only. Every value is a code that already exists in the frozen wire tables; this reference suggests nothing, ranks nothing and never depends on an item.",
    speech: Object.values(W.SPEECH).map((code) => ({ code, label: EASY_SPEECH[code].label, group: EASY_SPEECH[code].group, example: EASY_SPEECH[code].example })),
    facets, facet_groups: EASY_FACET_GROUP, facet_special: [{ code: W.FACET_SPECIAL_CODES.NONE_ASKING, label: "It asks, but its words name no topic in the list" }, { code: W.FACET_SPECIAL_CODES.NOT_APPLICABLE, label: "It asks nothing" }],
    address: Object.entries(EASY_ADDRESS).map(([kind, label]) => ({ kind, label })),
    relation: Object.values(W.RELATION).map((code) => ({ code, label: EASY_RELATION[code].label, target: EASY_RELATION[code].target })),
    questions: EASY_QUESTIONS, optional: EASY_OPTIONAL, unclear: EASY_UNCLEAR, slot: EASY_SLOT, abstain_code: EASY_ABSTAIN_CODE
  };
}

// ─── draft validation (commit-time, observer-safe) ───────────────────────────────────────────────────
const clean = (s, max) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const V0_MESSAGE = Object.freeze({
  wire_empty: "The wire is empty.", wire_not_text: "The wire must be text.", wire_illegal_character: "Plain single-line ASCII only (no tabs, newlines or non-ASCII).", output_fenced: "Remove the code fence.",
  wire_too_many_acts: `At most ${RF.MAX_ACTS} acts.`, wire_empty_field: "Two spaces in a row (an empty field).", wire_short_core: "Each act needs SPEECH FACET ADDRESS RELATION.",
  wire_unknown_speech_act: "Unknown speech-act code.", wire_unknown_facet_code: "Unknown facet code.", wire_unknown_address: "Unknown address.", wire_bad_name_label: "Names must be labels like n1.",
  wire_unknown_relation: "Unknown relation code.", wire_bad_relation: "Relation is KIND or KIND:TARGET.", wire_bad_relation_target: "Relation target must be a label.", wire_bad_tag: "Optional fields are key=value.",
  wire_unknown_tag: "Unknown optional field.", wire_duplicate_tag: "A field is given twice.", wire_empty_tag_value: "A field has no value."
});
const describe = (e) => ({ layer: e.layer, code: e.code, act: e.act ?? null, field: e.field ?? null, ...(e.value !== undefined ? { value: String(e.value) } : {}), message: V0_MESSAGE[e.code] ?? e.message ?? e.code.replace(/_/g, " ") });
const problem = (code, message, extra = {}) => ({ layer: "FORM", code, act: null, field: null, message, ...extra });

/**
 * Checks ONE human draft against ONE frozen render's observer-safe input. No resolver, no context, no hidden state:
 * schema completeness + V0 (decodeWire) + V1/V2 (RF.validateReaderFrame) + the EXPECTED_CLARIFY field-expressed rule.
 * Returns { ok, problems, row } where `row` is the normalized label payload when ok.
 */
function checkDraft(input, draft) {
  const problems = [];
  const outcome = draft?.outcome;
  if (outcome === L.UNLABELABLE) return { ok: false, problems: [problem("unlabelable_not_primary", "UNLABELABLE is an adjudicator-only determination; a human primary chooses ACCEPT or EXPECTED_CLARIFY. Record any concern in your notes.")], row: null };
  if (!OUTCOMES.includes(outcome)) return { ok: false, problems: [problem("outcome_not_chosen", "Choose ACCEPT or EXPECTED_CLARIFY. No outcome is ever selected for you.")], row: null };
  const wire = typeof draft.wire === "string" ? draft.wire.trim() : "";
  const note = clean(draft.notes, MAX_NOTES);
  const base = { gold_outcome: outcome, gold_wire: null, expected_clarify: null, notes: note || null };
  if (clean(draft.unlabelable_reason, 1)) problems.push(problem("reason_not_allowed", "An unlabelable reason is not part of a human primary label."));
  if (outcome === L.GOLD_OUTCOMES.ACCEPT && draft.expected_clarify && (draft.expected_clarify.field || draft.expected_clarify.slot || draft.expected_clarify.note)) problems.push(problem("expected_clarify_not_allowed", "Expected-clarify fields belong only to EXPECTED_CLARIFY."));
  if (!wire) problems.push(problem("wire_empty", "Write the wire yourself; it is never prefilled."));
  if (wire.length > MAX_WIRE) problems.push(problem("wire_too_long", `The wire is longer than ${MAX_WIRE} characters.`));
  let frame = null;
  if (wire && wire.length <= MAX_WIRE) {
    const decoded = W.decodeWire(wire, input);
    if (!decoded.ok) problems.push(...decoded.errors.map(describe));
    else {
      frame = decoded.frame;
      const verdict = RF.validateReaderFrame(frame, input);
      const layers = Object.values(verdict.layers ?? {});
      const v0 = verdict.layers?.V0 && verdict.layers.V0.ok === false ? (verdict.layers.V0.errors ?? []) : [];
      const legal = layers.flatMap((l) => l.errors ?? []).filter((e) => e.layer === "V1" || e.layer === "V2");
      // V3 (discourse clarification) is deliberately NOT shown while labelling: it is resolver-adjacent post-commit information.
      problems.push(...[...v0, ...legal].map((e) => describe({ layer: e.layer ?? "V0", code: e.code, act: e.act, field: e.field })));
    }
  }
  if (outcome === L.GOLD_OUTCOMES.EXPECTED_CLARIFY) {
    const ef = draft.expected_clarify ?? {};
    if (!L.CLARIFY_FIELDS.includes(ef.field)) problems.push(problem("expected_clarify_field_missing", `Choose the ambiguous field (${L.CLARIFY_FIELDS.join(", ")}). It is never preselected.`));
    if (!L.CLARIFY_SLOTS.includes(ef.slot)) problems.push(problem("expected_clarify_slot_missing", `Choose the clarification slot (${L.CLARIFY_SLOTS.join(", ")}). It is never preselected.`));
    if (frame && L.CLARIFY_FIELDS.includes(ef.field) && !problems.length) {
      const act = RP.primaryAct(frame);
      const expressed = ef.field === "discourse_state" || (act?.abstain ?? []).includes(ef.field) || (ef.field === "referent" && act?.referent?.candidate === "AMBIGUOUS");
      if (!expressed) problems.push(problem("expected_clarify_field_not_expressed", "Your wire must express the ambiguity you declare (ab=<field>, or r=unsure for referent)."));
    }
    if (problems.length) return { ok: false, problems, row: null };
    const expected = { field: ef.field, slot: ef.slot };
    const efNote = clean(ef.note, MAX_TEXT);
    if (efNote) expected.note = efNote;
    return { ok: true, problems: [], row: { ...base, gold_wire: wire, expected_clarify: expected } };
  }
  return { ok: !problems.length, problems, row: problems.length ? null : { ...base, gold_wire: wire } };
}

// ─── the workstation core ────────────────────────────────────────────────────────────────────────────
class WorkstationError extends Error { constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; } }

/**
 * Loads the blank worksheet + input pack + the human's label file and fails CLOSED on any identity drift.
 * `dir` holds worksheet.jsonl, input-pack.json, labels.jsonl and journal.jsonl. Nothing here reads a capture.
 */
function loadWorkstation({ dir = DEFAULT_DIR, labeler = DEFAULT_LABELER, clock = () => new Date().toISOString(), registry = L.loadRegistry() } = {}) {
  const humans = registry?.human?.primary_labelers ?? [];
  if (!humans.includes(labeler)) throw new Error(`labeler "${labeler}" is not a recorded human primary labeler (${JSON.stringify(humans)}; docs/reader/READER_PHASE2_LABELING_REGISTRY.json)`);
  const file = (k) => path.join(dir, FILES[k]);
  if (!fs.existsSync(file("worksheet")) || !fs.existsSync(file("pack"))) throw new Error(`no prepared worksheet in ${dir}; run: node tools/dialogue-reader-labeling-workstation.js --prepare`);
  const rows = readJsonlStrict(file("worksheet"), "worksheet");
  const header = rows[0];
  if (header?.kind !== "worksheet_header") throw new Error("worksheet: the first row is not the worksheet header");
  if (header.system_digest !== SYSTEM_DIGEST || header.render_version !== RENDER_VERSION || header.labels_version !== L.LABELS_VERSION) throw new Error("worksheet: the frozen render / labels contract changed since the worksheet was prepared (render_changed_since_labelling); refusing to start. Re-prepare only by owner decision");
  const pack = JSON.parse(fs.readFileSync(file("pack"), "utf8"));
  if (pack.system_digest !== SYSTEM_DIGEST) throw new Error("input pack: system digest differs from the frozen render");
  const packById = new Map((pack.items ?? []).map((p) => [p.id, p]));
  const items = rows.slice(1).map((r, i) => {
    const prob = [];
    if (r.kind !== "item" || typeof r.id !== "string") prob.push("worksheet_row_malformed");
    if (r.label_state !== L.LABEL_STATES.UNLABELED || r.gold_wire != null || r.gold_outcome != null || r.labeler != null) prob.push("worksheet_row_not_blank");
    if (sha256(`${header.system_digest}\n${r.render_user}`) !== r.render_digest) prob.push("worksheet_render_digest_mismatch");
    const p = packById.get(r.id);
    if (!p) prob.push("input_pack_missing");
    else if (p.render_digest !== r.render_digest || renderReaderPrompt(p.input).render_digest !== r.render_digest) prob.push("input_pack_render_mismatch");
    return { n: i + 1, id: r.id, render_digest: r.render_digest, system_digest: r.system_digest, render_user: r.render_user, input: p?.input ?? null, integrity: prob };
  });
  const byId = new Map(items.map((it) => [it.id, it]));
  if (byId.size !== items.length) throw new Error("worksheet: duplicate item ids");
  const ws = { dir, labeler, clock, registry, header, items, byId, labels: [], labelsById: new Map() };
  loadLabels(ws);
  return ws;
}

/** The file-level refusal carries the authority's own problem code(s), so --validate can report them verbatim. */
class LabelFileError extends Error { constructor(message, problems) { super(message); this.problems = problems; } }
/** Asks the EXISTING validator (dialogue-reader-labels.js validateLabels) about one UNLABELABLE row; its verdict is reported unaltered. */
function authoritativeUnlabelableProblem(ws, row) {
  const it = ws.byId.get(row.id);
  if (!it.input) return "unlabelable_record_invalid";
  const verdict = L.validateLabels([{ id: it.id, render_digest: it.render_digest, item: { input: it.input } }], [row], { states: Object.values(L.LABEL_STATES), registry: ws.registry });
  return verdict.problems[0]?.problem ?? "unlabelable_record_invalid";
}

function loadLabels(ws) {
  const rows = readJsonlStrict(path.join(ws.dir, FILES.labels), "labels");
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r.id !== "string") throw new Error("labels: a row has no id; refusing to continue");
    if (seen.has(r.id)) throw new Error(`labels: duplicate row for ${r.id}; refusing to continue (never last-row-wins)`);
    seen.add(r.id);
    if (!ws.byId.has(r.id)) throw new Error(`labels: ${r.id} is not an item of the frozen worksheet; refusing to continue`);
    if (r.label_state !== L.LABEL_STATES.HUMAN_PRIMARY) throw new Error(`labels: ${r.id} is ${r.label_state}; the workstation handles only HUMAN_PRIMARY rows`);
    if (r.gold_outcome === L.UNLABELABLE) {
      const code = authoritativeUnlabelableProblem(ws, r);
      throw new LabelFileError(`labels: ${r.id} is a HUMAN_PRIMARY UNLABELABLE row; rejected as ${code} (UNLABELABLE is an adjudicator-only determination; a human primary labels ACCEPT or EXPECTED_CLARIFY); refusing to continue`, [{ id: r.id, problem: code }]);
    }
    if (r.labeler?.kind !== "human" || r.labeler?.id !== ws.labeler) throw new Error(`labels: ${r.id} was written by ${JSON.stringify(r.labeler)}, not human/${ws.labeler}; refusing to continue`);
  }
  ws.labels = rows;
  ws.labelsById = new Map(rows.map((r) => [r.id, r]));
}

/** Status of one item against its stored label: "uncommitted" | "committed" | "blocked" (never "committed" unless it re-validates). */
function itemStatus(ws, it) {
  const row = ws.labelsById.get(it.id) ?? null;
  if (it.integrity.length) return { state: "blocked", reason: `worksheet or input pack drift: ${it.integrity.join(", ")}`, label: null };
  if (!row) return { state: "uncommitted", reason: null, label: null };
  const reasons = [];
  if (row.render_digest !== it.render_digest) reasons.push("render_changed_since_labelling");
  if (!row.committed_at || Number.isNaN(Date.parse(row.committed_at))) reasons.push("committed_at_missing");
  if (L.independenceProblems(row, ws.registry).length) reasons.push("independence_violation");
  if (!reasons.length) {
    const c = checkDraft(it.input, { outcome: row.gold_outcome, wire: row.gold_wire ?? "", expected_clarify: row.expected_clarify, unlabelable_reason: row.unlabelable_reason, notes: row.notes });
    if (!c.ok) reasons.push(...c.problems.map((p) => p.code));
  }
  if (reasons.length) return { state: "blocked", reason: `the saved label is not valid for this render (${[...new Set(reasons)].join(", ")}); it is NOT counted as labeled`, label: null, stale_committed_at: row.committed_at ?? null };
  return { state: "committed", reason: null, committed_at: row.committed_at, label: { gold_outcome: row.gold_outcome, gold_wire: row.gold_wire ?? null, expected_clarify: row.expected_clarify ?? null, notes: row.notes ?? null, committed_at: row.committed_at } };
}

function summary(ws) {
  const order = ws.items.map((it) => ({ n: it.n, id: it.id, state: itemStatus(ws, it).state }));
  const committed = order.filter((o) => o.state === "committed").length;
  return { version: WORKSTATION_VERSION, labeler: ws.labeler, total: ws.items.length, committed, remaining: ws.items.length - committed, blocked: order.filter((o) => o.state === "blocked").length, order };
}

/** The ONLY item payload a client ever receives: authorized worksheet fields + the human's own saved label. */
function itemPayload(ws, ref) {
  const key = typeof ref === "string" ? ref.trim() : ref;
  const it = typeof key === "number" ? ws.items[key - 1] : ws.byId.get(key) ?? (String(key).length >= 5 ? ws.items.find((x) => x.id.startsWith(String(key))) : null) ?? null;
  if (!it) throw new WorkstationError(404, "unknown_item", "No such render in the frozen worksheet.");
  const st = itemStatus(ws, it);
  return { n: it.n, total: ws.items.length, id: it.id, render_digest: it.render_digest, render_user: it.render_user, view: viewOfRender(it.render_user), status: { state: st.state, reason: st.reason, committed_at: st.committed_at ?? st.stale_committed_at ?? null }, label: st.label };
}

function mustItem(ws, id) {
  const it = ws.byId.get(id);
  if (!it) throw new WorkstationError(404, "unknown_item", "No such render in the frozen worksheet.");
  return it;
}
function check(ws, id, draft) {
  const it = mustItem(ws, id);
  if (it.integrity.length) return { ok: false, problems: [problem("render_drift", `Blocked (fail closed): ${it.integrity.join(", ")}`)], row: null };
  const c = checkDraft(it.input, draft);
  return { ok: c.ok, problems: c.problems };
}

/**
 * Commits ONE HUMAN_PRIMARY label. Requires an explicit human action (`explicit: true`), an explicit outcome, a passing
 * draft check and -- for an item that already has a committed judgment -- an explicit `replace` naming the committed_at
 * being replaced. The previous row is preserved in the journal. Nothing is written unless everything validates.
 */
function commit(ws, id, draft, { explicit = false, replace = false, previous_committed_at = null } = {}) {
  if (explicit !== true) throw new WorkstationError(400, "not_explicit", "A label is committed only by an explicit human action.");
  const it = mustItem(ws, id);
  if (it.integrity.length) throw new WorkstationError(409, "render_drift", `Blocked (fail closed): ${it.integrity.join(", ")}`);
  const existing = ws.labelsById.get(id) ?? null;
  if (existing && !replace) throw new WorkstationError(409, "already_committed", "This render already has a committed judgment. Use Edit / recommit to change it deliberately.", { committed_at: existing.committed_at ?? null });
  if (existing && replace && existing.committed_at !== previous_committed_at) throw new WorkstationError(409, "stale_edit_target", "The committed judgment changed since you opened it; reload before recommitting.");
  if (!existing && replace) throw new WorkstationError(409, "nothing_to_replace", "There is no committed judgment to replace.");
  const c = checkDraft(it.input, draft);
  if (!c.ok) throw new WorkstationError(422, "invalid_draft", "The draft is not a valid HUMAN_PRIMARY label.", { problems: c.problems });
  const committed_at = ws.clock();
  const row = { id: it.id, render_digest: it.render_digest, system_digest: it.system_digest, label_state: L.LABEL_STATES.HUMAN_PRIMARY, labeler: { kind: "human", id: ws.labeler }, ...c.row, committed_at };
  const independence = L.independenceProblems(row, ws.registry);
  if (independence.length) throw new WorkstationError(422, "independence_violation", `Rejected by the existing independence rules: ${independence.join(", ")}`);
  const next = existing ? ws.labels.map((r) => (r.id === id ? row : r)) : [...ws.labels, row];
  atomicWrite(path.join(ws.dir, FILES.labels), jsonl(next));
  ws.labels = next;
  ws.labelsById = new Map(next.map((r) => [r.id, r]));
  appendDurable(path.join(ws.dir, FILES.journal), `${JSON.stringify({ event: existing ? "recommit" : "commit", id, render_digest: it.render_digest, labeler: ws.labeler, committed_at, row_sha256: sha256(JSON.stringify(row)), ...(existing ? { previous_row: existing } : {}) })}\n`);
  return { id, committed_at, status: itemStatus(ws, it), summary: summary(ws) };
}

/** Whole-file validation that needs only the blank worksheet + input pack (offline, observer-safe). */
function validateWorkstation(ws) {
  const problems = [];
  let committed = 0;
  for (const it of ws.items) {
    const st = itemStatus(ws, it);
    if (st.state === "committed") committed += 1;
    else if (st.state === "blocked") problems.push({ id: it.id, n: it.n, problem: st.reason });
  }
  const outcomes = {};
  for (const r of ws.labels) outcomes[r.gold_outcome] = (outcomes[r.gold_outcome] ?? 0) + 1;
  return { scope: "observer-safe (V0 + V1 + V2 + schema + digest binding). Resolver-level validation: --validate-full", total: ws.items.length, committed, remaining: ws.items.length - committed, outcomes, problems };
}

// ─── --prepare / --validate-full (the ONLY paths that touch the answer-bearing capture) ─────────────
const readCaptureItems = async (captureFile, log) => (captureFile ? JSON.parse(fs.readFileSync(captureFile, "utf8")).items : RP.captureCorpus({ log }));
/** The frozen 474-render census as render groups, verified against the pinned sample and the dev manifest. */
function frozenCensus(items) {
  const sampleText = fs.readFileSync(RP.TEACHER_SAMPLE_FILE, "utf8");
  if (sha256(sampleText) !== RP.TEACHER_SAMPLE_SHA256) throw new Error("teacher-dev-sample.json no longer matches its pinned SHA-256; refusing");
  const sample = JSON.parse(sampleText);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "acceptance", "reader-phase2", "dev-manifest.json"), "utf8"));
  const groups = RP.renderGroups(items);
  if (items.length !== manifest.turns || groups.length !== manifest.distinct_renders) throw new Error(`capture drifted from the frozen manifest (${items.length} turns / ${groups.length} renders; expected ${manifest.turns} / ${manifest.distinct_renders})`);
  const ids = new Set(sample.headline.map((h) => h.id));
  const census = groups.filter((g) => ids.has(g.id));
  if (census.length !== sample.headline_renders || census.length !== ids.size) throw new Error(`census drifted (${census.length} renders; the sample freezes ${sample.headline_renders})`);
  return { groups, census, sample, manifest };
}
/** The observer-safe input pack: the ReaderInput of each frozen render (and nothing else of the item), bound by render digest. */
function buildInputPack(groups) {
  return { kind: "labeling_input_pack", version: WORKSTATION_VERSION, system_digest: SYSTEM_DIGEST, items: groups.map((g) => ({ id: g.id, render_digest: g.render_digest, input: g.item.input })) };
}
/** Writes the BLANK worksheet + input pack for already-selected render groups (the only fields of a group that are read: id, digest, input). */
function writePrepared({ dir, groups, extra = {} }) {
  const worksheetText = jsonl(L.worksheet(groups));
  const packText = JSON.stringify(buildInputPack(groups));
  atomicWrite(path.join(dir, FILES.worksheet), worksheetText);
  atomicWrite(path.join(dir, FILES.pack), packText);
  const receipt = { version: WORKSTATION_VERSION, prepared_at: new Date().toISOString(), renders: groups.length, system_digest: SYSTEM_DIGEST, render_version: RENDER_VERSION, ...extra, worksheet_sha256: sha256(worksheetText), input_pack_sha256: sha256(packText), note: "blank worksheet + observer-safe ReaderInput only; the capture (legacy frames, routing, context, bindings) was not written" };
  atomicWrite(path.join(dir, FILES.receipt), `${JSON.stringify(receipt, null, 1)}\n`);
  return receipt;
}
/** Writes the BLANK worksheet and the observer-safe input pack, then discards the capture. Never overwrites silently. */
async function prepare({ dir = DEFAULT_DIR, captureFile = null, force = false, log = () => {} } = {}) {
  if (!isIgnoredOrOutsideRepo(path.join(dir, FILES.labels))) throw new Error(`refusing: ${dir} is a tracked repository path; active human labels must live in a gitignored path (default .agent-notes/reader-phase2-labeling/)`);
  const labelsFile = path.join(dir, FILES.labels);
  const hasLabels = fs.existsSync(labelsFile) && fs.readFileSync(labelsFile, "utf8").trim().length > 0;
  const exists = fs.existsSync(path.join(dir, FILES.worksheet));
  if (exists && !force) throw new Error(`a worksheet already exists in ${dir}; nothing was changed (use --force only when no labels exist)`);
  if (exists && hasLabels) throw new Error("refusing to replace the worksheet: committed labels exist (their render digests would no longer be provable)");
  const items = await readCaptureItems(captureFile, log);
  const { census, sample } = frozenCensus(items);
  return writePrepared({ dir, groups: census, extra: { teacher_sample_sha256: RP.TEACHER_SAMPLE_SHA256, sample_headline_renders: sample.headline_renders } });
}
/**
 * POST-COMMIT, resolver-level validation through the EXISTING validator (dialogue-reader-labels.js validateLabels). The
 * capture exists only inside this call. Problem details are stripped unless `detail` (they can describe resolver
 * behaviour). Every verdict of the existing validator is reported as it is: nothing is reclassified, so a HUMAN_PRIMARY
 * UNLABELABLE row is an `unlabelable_record_invalid` problem and a non-zero exit.
 */
async function validateFull({ dir = DEFAULT_DIR, captureFile = null, detail = false, log = () => {} } = {}) {
  const items = await readCaptureItems(captureFile, log);
  const { census } = frozenCensus(items);
  const labels = readJsonlStrict(path.join(dir, FILES.labels), "labels");
  const result = L.validateLabels(census, labels, { states: Object.values(L.LABEL_STATES), registry: L.loadRegistry() });
  return { scope: "existing validator (V0-V3 + resolveTurn) over the frozen census", total: census.length, rows: labels.length, ...classifyValidation(result, { detail }) };
}
/** Reads the existing validator's result without altering any verdict; it only strips resolver-describing detail by default. */
function classifyValidation(result, { detail = false } = {}) {
  return { valid_primary_rows: Object.keys(result.gold).length, problems: result.problems.map((p) => (detail ? p : { id: p.id, problem: p.problem })) };
}
/** Offline whole-file validation (the CLI's --validate). A file the loader refuses is reported with the authority's own problem code, never suppressed. */
function runValidate({ dir = DEFAULT_DIR, labeler = DEFAULT_LABELER, registry } = {}) {
  let ws;
  try { ws = loadWorkstation({ dir, labeler, ...(registry ? { registry } : {}) }); } catch (e) {
    if (e instanceof LabelFileError) return { report: { scope: "label file refused by the existing authority", valid: false, message: e.message, problems: e.problems }, exitCode: 1 };
    throw e;
  }
  const report = validateWorkstation(ws);
  return { report, exitCode: report.problems.length ? 1 : 0 };
}

// ─── the HTTP server ─────────────────────────────────────────────────────────────────────────────────
function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, FILES.lock);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 }); return () => { try { if (fs.readFileSync(lock, "utf8") === String(process.pid)) fs.unlinkSync(lock); } catch { /* already gone */ } }; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(fs.readFileSync(lock, "utf8"));
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      if (alive && pid !== process.pid) throw new Error(`another workstation (pid ${pid}) is already using ${dir}`);
      fs.unlinkSync(lock);
    }
  }
  throw new Error("could not acquire the workstation lock");
}

function pageHtml({ nonce, token }) {
  return CLIENT_HTML.replace(/__NONCE__/g, nonce).replace("__TOKEN__", token);
}

function createWorkstationServer(ws, { host = "127.0.0.1", port = DEFAULT_PORT } = {}) {
  const bindHost = assertLoopbackHost(host);
  const token = crypto.randomBytes(24).toString("hex");
  let boundPort = port;
  const staticGrammar = JSON.stringify(grammarReference());
  const staticEasy = JSON.stringify(easyReference());
  const definitions = JSON.stringify({ system_digest: ws.header.system_digest, render_version: ws.header.render_version, system_text: ws.header.system_text, outcomes: OUTCOMES, clarify_fields: L.CLARIFY_FIELDS, clarify_slots: L.CLARIFY_SLOTS });
  const send = (res, status, body, type = "application/json; charset=utf-8", extra = {}) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", ...extra });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const hostOk = (req) => { const h = String(req.headers.host ?? ""); const name = h.replace(/:\d+$/, "").replace(/^\[|\]$/g, ""); return LOOPBACK_HOSTS.includes(name) && (!/:\d+$/.test(h) || h.endsWith(`:${boundPort}`)); };
  const originOk = (req) => { const o = req.headers.origin; if (!o) return true; try { const u = new URL(o); return u.protocol === "http:" && LOOPBACK_HOSTS.includes(u.hostname.replace(/^\[|\]$/g, "")) && Number(u.port) === boundPort; } catch { return false; } };
  const server = http.createServer((req, res) => {
    try {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return send(res, 403, { error: "loopback_only" });
      if (!hostOk(req) || !originOk(req)) return send(res, 403, { error: "bad_host_or_origin" });
      const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = crypto.randomBytes(16).toString("base64");
        return send(res, 200, pageHtml({ nonce, token }), "text/html; charset=utf-8", { "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'` });
      }
      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "not_found" });
      if (req.headers["x-ws-token"] !== token) return send(res, 403, { error: "bad_token" });
      const respond = (fn) => { try { send(res, 200, fn()); } catch (e) { fail(res, e); } };
      if (req.method === "GET") {
        if (url.pathname === "/api/state") return respond(() => summary(ws));
        if (url.pathname === "/api/item") return respond(() => itemPayload(ws, url.searchParams.get("n") ? Number(url.searchParams.get("n")) : url.searchParams.get("id") ?? ""));
        if (url.pathname === "/api/grammar") return send(res, 200, staticGrammar);
        if (url.pathname === "/api/definitions") return send(res, 200, definitions);
        if (url.pathname === "/api/easy") return send(res, 200, staticEasy);
        if (url.pathname === "/api/validate") return respond(() => validateWorkstation(ws));
        return send(res, 404, { error: "not_found" });
      }
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: "json_only" });
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
      req.on("end", () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return send(res, 400, { error: "bad_json" }); }
        try {
          if (url.pathname === "/api/check") return send(res, 200, check(ws, String(body.id ?? ""), body.draft ?? {}));
          if (url.pathname === "/api/commit") return send(res, 200, commit(ws, String(body.id ?? ""), body.draft ?? {}, { explicit: body.explicit === true, replace: body.replace === true, previous_committed_at: body.previous_committed_at ?? null }));
          return send(res, 404, { error: "not_found" });
        } catch (e) { fail(res, e); }
      });
    } catch (e) { fail(res, e); }
  });
  const fail = (res, e) => (e instanceof WorkstationError ? send(res, e.status, { error: e.code, message: e.message, ...e.extra }) : send(res, 500, { error: "internal", message: String(e.message ?? e) }));
  const listen = () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, bindHost, () => { boundPort = server.address().port; resolve({ server, url: `http://${bindHost.includes(":") ? `[${bindHost}]` : bindHost}:${boundPort}/`, port: boundPort, host: bindHost, token }); }); });
  return { server, listen, token };
}

// ─── the client (static page; no external asset of any kind; item data arrives only through /api/item) ─
const CLIENT_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="ws-token" content="__TOKEN__"><title>Reader Phase 2 labeling</title>
<style nonce="__NONCE__">
:root{--bg:#14161a;--panel:#1c1f25;--panel2:#23272f;--line:#30343d;--text:#e6e8ec;--dim:#98a0ad;--accent:#6aa6ff;--ok:#5fcf8a;--warn:#f0b34a;--bad:#ff6b6b;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:6px 14px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.prog{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.prog b{font-size:18px}.pill{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:14px;color:var(--dim)}.pill strong{color:var(--text)}
.banner{background:#3a2d12;color:#f6d796;border-bottom:1px solid #6b5420;padding:4px 14px;font-size:13px}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;padding:14px;max-width:1700px;margin:0 auto;align-items:start}
@media(max-width:900px){main{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}.card h2{margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.sayline{font-size:30px;line-height:1.25;margin:2px 0 4px;word-break:break-word}.meta{color:var(--dim);font:12px var(--mono);word-break:break-all}
.know .row{display:grid;grid-template-columns:200px 1fr;gap:8px;padding:5px 0;border-top:1px solid var(--line)}.know .row:first-child{border-top:0}.know .k{color:var(--dim);font-size:13px}
@media(max-width:1180px){.know .row{grid-template-columns:1fr;gap:0}}
.row{display:grid;grid-template-columns:170px 1fr;gap:8px;padding:4px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}.row .k{color:var(--dim);font-size:12px}.row .v{font:13px var(--mono);word-break:break-word;white-space:pre-wrap}
.know .row .v{font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
.tok{display:inline-flex;margin:2px 4px 2px 0;border:1px solid var(--line);border-radius:6px;overflow:hidden;font:13px var(--mono)}.tok i{background:var(--panel2);padding:1px 6px;color:var(--accent);font-style:normal}.tok span{padding:1px 7px}
button,select,input,textarea{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
button{cursor:pointer}button:hover:not(:disabled){border-color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}
button.primary{background:#23407a;border-color:#3b66c4}button.danger{background:#5a2330;border-color:#923a4c}button.big{font-size:19px;font-weight:600;padding:12px 22px}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:2px 0 8px}@media(max-width:560px){.choices{grid-template-columns:1fr}}
.choice{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:2px solid var(--line);border-radius:12px;background:var(--panel2);cursor:pointer;position:relative}.choice input{position:absolute;opacity:0;pointer-events:none}.choice .big{font-size:18px;font-weight:600;line-height:1.25}.choice .small{font:12px var(--mono);color:var(--dim)}.choice.sel{border-color:var(--accent);background:#1e2e4d}.choice:has(input:focus-visible){outline:2px dashed var(--dim);outline-offset:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}.chip{position:relative;display:inline-flex;flex-direction:column;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);cursor:pointer;max-width:100%}.chip input{position:absolute;opacity:0;pointer-events:none}.chip .t{font-size:15px}.chip .s{font:11px var(--mono);color:var(--dim)}.chip.sel{border-color:var(--accent);background:#1e2e4d}.chip.off{opacity:.45;cursor:not-allowed}.chip:has(input:focus-visible){outline:2px dashed var(--dim);outline-offset:2px}
.stack .chip{display:flex;width:100%}
textarea{width:100%;font:15px var(--mono);min-height:84px;resize:vertical}input[type=text]{width:100%}select{max-width:100%}
.hl{font:14px var(--mono);margin:6px 0;padding:6px 8px;border:1px dashed var(--line);border-radius:8px;min-height:30px;word-break:break-word}.hl .sp{color:#ffcf6b}.hl .fc{color:#7fdcbc}.hl .ad{color:#ff9ac1}.hl .rl{color:#8fb7ff}.hl .tg{color:#c3a4ff}.hl .sep{color:var(--dim)}
.probs{margin:6px 0;padding:0;list-style:none}.probs li{border-left:3px solid var(--bad);background:#2b1a1e;padding:4px 8px;margin:4px 0;border-radius:4px;font-size:14px}.probs li.good{border-color:var(--ok);background:#15281d}.probs li.todo{border-color:var(--warn);background:#2b2412}
.state{display:inline-block;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600;text-transform:none;letter-spacing:0}.state.committed{background:#14331f;color:var(--ok)}.state.uncommitted{background:#33290f;color:var(--warn)}.state.blocked{background:#3a1820;color:var(--bad)}.state.draft{background:#1d2c47;color:var(--accent)}
details{margin-top:10px}summary{cursor:pointer;color:var(--dim)}pre{white-space:pre-wrap;font:12px var(--mono);color:var(--dim);margin:6px 0}
table.g{border-collapse:collapse;font-size:13px;margin:4px 0}table.g td{border-top:1px solid var(--line);padding:2px 10px 2px 0;vertical-align:top}table.g td:first-child{font-family:var(--mono);color:var(--accent);white-space:nowrap}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.lab{font-size:13px;color:var(--dim);display:block;margin:10px 0 3px}.lab.dim{opacity:.8}.q{font-size:15px;font-weight:600;margin:12px 0 2px;display:block}.ro{background:#1a2230;border:1px solid #2b3a57;border-radius:8px;padding:8px 10px;font:14px var(--mono);white-space:pre-wrap;word-break:break-word}
.msg{font-size:13px;color:var(--dim);margin-top:4px}.hide{display:none!important}.grow{flex:1}.jumpin{width:130px}.gap{margin-top:14px}
.act{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0;background:#191c22}.act h3{margin:0;font-size:14px;color:var(--accent);display:flex;gap:10px;align-items:center}
.checks label{display:flex;gap:8px;align-items:center;padding:3px 0;cursor:pointer}.checks input{width:auto}
.sticky{position:sticky;bottom:0;background:linear-gradient(to top,var(--panel) 80%,transparent);padding-top:10px;margin-top:8px}
.sticky .actions{margin-top:0}
.toolsbox{position:absolute;right:14px;top:100%;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;display:flex;gap:8px;flex-wrap:wrap;z-index:10;min-width:280px}
header details{margin:0;position:relative}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:20;display:flex;align-items:center;justify-content:center;padding:16px}.modal .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;max-width:640px;max-height:90vh;overflow:auto;padding:16px 20px}.modal h2{margin:0 0 8px;font-size:18px;text-transform:none;letter-spacing:0;color:var(--text)}
.toast{font-size:14px;color:var(--ok);margin-left:6px}
.people{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 6px}.person{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border:2px solid transparent;border-radius:999px;background:var(--panel2)}.person .av{width:26px;height:26px;border-radius:50%;background:#2d3b57;color:#cfe0ff;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:13px;font-weight:700}
.sub{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:12px 0 4px}.bubbles{display:flex;flex-direction:column;gap:6px}.bubble{max-width:92%;padding:6px 10px;border-radius:12px;background:var(--panel2);font-size:15px;line-height:1.35;word-break:break-word}.bubble b{display:block;font-size:12px;color:var(--dim);font-weight:600}.bubble.you{align-self:flex-end;background:#1e2e4d;border-bottom-right-radius:3px}.bubble.them{align-self:flex-start;border-bottom-left-radius:3px}.bubble .bn{display:block;font-size:12px;color:var(--dim)}
.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{display:inline-flex;gap:6px;border:1px solid var(--line);border-radius:8px;padding:2px 8px;background:#191c22;font-size:14px}.tag i{font-style:normal;color:var(--dim);font-size:12px}
.answers{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.pill2{border-radius:999px;font-size:13px;padding:2px 10px;background:#14331f;border-color:#265c3a;color:#bfe9cc}
.stepcard{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#191c22;margin-top:6px}.stephead{font-size:12px;color:var(--dim);letter-spacing:.04em}.qtext{font-size:22px;font-weight:600;line-height:1.25;margin:4px 0 0}.term{font:12px var(--mono);color:var(--dim);margin:0 0 8px}.hint{font-size:14px;color:var(--warn);margin:0 0 8px}.stepnav{display:flex;gap:8px;justify-content:space-between;margin-top:12px}
.detail{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0}.dhead{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.dq{font-weight:600}.dhead .x{margin-left:auto;font-size:12px;padding:2px 8px}.addd{font-size:13px;text-align:left;padding:4px 10px}
.summary{display:flex;flex-direction:column;gap:2px}.srow{display:grid;grid-template-columns:190px 1fr;gap:8px;padding:5px 0;border-top:1px solid var(--line)}.srow:first-child{border-top:0}.srow .k{color:var(--dim);font-size:13px}.srow .v{font-size:16px}@media(max-width:560px){.srow{grid-template-columns:1fr;gap:0}}

</style></head><body>
<header>
 <div class="prog"><span>Item <b id="hN">-</b> of <b id="hT">-</b></span><span class="pill"><strong id="hC">-</strong> completed</span><span class="pill"><strong id="hR">-</strong> remaining</span><span class="pill hide" id="hB">blocked 0</span></div>
 <div class="actions" style="margin:0"><button id="bPrev" title="Alt+J">&larr; Previous</button><button id="bNext" title="Alt+K">Next &rarr;</button><button id="bNextOpen" title="Alt+U">Next uncommitted</button></div>
 <span class="grow"></span>
 <button id="bHelp" aria-haspopup="dialog">What am I doing?</button>
 <details id="tools"><summary>Tools</summary><div class="toolsbox"><span class="pill">labeler <strong id="hL">-</strong></span><input id="jump" type="text" placeholder="# or rg-id" class="jumpin" aria-label="Jump to item number or render id"><button id="bJump">Go</button><button id="bValidate">Validate file</button></div></details>
</header>
<div class="banner">Label BLIND: do not consult any legacy reader answer, teacher output, model output or review while judging. This tool shows none of them and suggests nothing. Saving writes a HUMAN_PRIMARY row to the local label file (not a git commit).</div>
<div class="modal hide" id="helpModal" role="dialog" aria-modal="true" aria-labelledby="helpTitle"><div class="box">
 <h2 id="helpTitle">What am I doing?</h2>
 <p>Your job is to decide what the player's line means, using only the information shown on this page.</p>
 <p>Choose one:</p>
 <ul><li><b>I understand what the player means</b>: the line and the context are enough to settle the meaning.</li><li><b>Something important is unclear</b>: they are not enough, and a coworker would need to ask.</li></ul>
 <p>Then record your interpretation by answering the questions. The form only writes down the choices you make; it never chooses for you.</p>
 <p>Do not consult legacy answers, teacher answers, model answers or any outside interpretation help. The system is measuring whether the meaning can be established from this observer-safe information.</p>
 <p class="msg">You may use help or documentation for how the form works, the wire syntax, and what a field means. Do not ask an AI, a model or another person to decide ACCEPT versus EXPECTED_CLARIFY, the intended interpretation, or the correct addressee, referent, topic or similar.</p>
 <div class="actions"><button id="bHelpClose" class="primary">Close</button></div>
</div></div>
<main>
 <section>
  <div class="card"><h2>Player said</h2><div class="sayline" id="say">-</div><div class="msg hide" id="readAs"></div></div>
  <div class="card"><h2>What you know</h2><div class="know" id="know"></div></div>
  <details class="card" id="techBox"><summary>Technical details</summary>
   <div class="meta" id="meta"></div><div id="tokens"></div>
   <div id="ctxList"></div>
   <div class="actions"><button id="bCopy">Copy render text</button><span class="msg" id="copyMsg"></span></div>
   <div id="ctx"></div>
   <details><summary>Raw render text</summary><pre id="raw"></pre></details>
  </details>
 </section>
 <section>
  <div class="card"><h2>Your judgment <span id="stateBadge" class="state uncommitted">uncommitted</span></h2>
   <div id="committedBox" class="hide"></div>
   <div id="form">
    <div class="choices" role="radiogroup" aria-label="Your judgment">
     <label class="choice" id="oA"><input type="radio" name="outcome" value="ACCEPT"><span class="big">I understand what the player means</span><span class="small">ACCEPT</span></label>
     <label class="choice" id="oB"><input type="radio" name="outcome" value="EXPECTED_CLARIFY"><span class="big">Something important is unclear</span><span class="small">EXPECTED_CLARIFY</span></label></div>
    <div class="msg" id="outHint">No outcome is selected. Choose one; nothing is preselected.</div>
    <div id="easyBox" class="hide">
     <div id="answers" class="answers"></div>
     <div id="stepCard" class="stepcard"></div>
     <details id="genBox" class="hide"><summary>Generated Reader wire</summary><div class="hl" id="genHl"></div><div class="msg" id="genState"></div></details>
    </div>
    <span class="lab dim">Optional notes / uncertainty</span><input id="notes" type="text" aria-label="Optional notes / uncertainty">
    <div class="msg">Use this for concerns you want preserved for later adjudication.</div>
    <ul class="probs" id="probs"></ul>
    <div class="sticky"><div class="actions"><button id="bCommitNext" class="primary big" disabled>COMMIT &amp; NEXT</button><button id="bCommit" class="primary" disabled>COMMIT</button><button id="bCancelEdit" class="hide">Cancel edit</button><span class="toast" id="saved" role="status"></span></div>
    <div class="msg" id="actMsg"></div></div>
    <details id="advanced"><summary>Advanced / Raw labeling</summary>
     <div class="msg">The raw wire editor is the original audited workflow, for cases where the Easy form is not enough. Switching never changes a saved label.</div>
     <div class="actions"><button id="bToRaw">Use the raw editor for this item</button><button id="bToEasy" class="hide">Return to the Easy form</button></div>
     <div class="msg" id="modeMsg"></div>
     <div id="rawBox" class="hide">
      <div id="wireBox"><label class="lab" for="wire">Wire (you write it; never prefilled)</label><textarea id="wire" aria-label="Wire (you write it; never prefilled)" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder=""></textarea><div class="hl" id="hl"></div></div>
      <div id="ecBox" class="hide"><span class="lab">Ambiguous field (required)</span><select id="ecField" aria-label="Ambiguous field"></select><span class="lab">Clarification slot (required)</span><select id="ecSlot" aria-label="Clarification slot"></select><span class="lab">Note (optional)</span><input id="ecNote" type="text" aria-label="Clarification note"></div>
     </div>
    </details>
   </div>
  </div>
  <div class="card"><h2>Reference</h2>
   <details><summary>Wire grammar (static, generic)</summary><div id="grammar"></div></details>
   <details><summary>Field definitions (the frozen system text)</summary><pre id="defs"></pre></details>
   <details><summary>Keyboard</summary><div class="msg">Alt+J previous · Alt+K next · Alt+U next uncommitted · Ctrl/Cmd+Enter saves only when an outcome is chosen and the draft validates. There is no shortcut that chooses an outcome.</div></details>
  </div>
 </section>
</main>
<script nonce="__NONCE__">
"use strict";
const TOKEN=document.querySelector('meta[name=ws-token]').content;
const $=(id)=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='class')e.className=v;else e[k]=v;}for(const kid of kids)e.append(kid);return e;};
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'x-ws-token':TOKEN,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json();}catch{}if(!r.ok){const e=new Error(j.message||j.error||String(r.status));e.payload=j;e.status=r.status;throw e;}return j;}
/*PURE-BEGIN*/
// ---- the draft -------------------------------------------------------------------------------------------------
// An Easy act is a FORM: every semantic value is a code Jack picks. Empty string = not chosen. Nothing here is ever filled by the page.
const blankAct=()=>({speech:'',facet:'',addr:'',names:[],rel:'',target:'',start:'',qform:'',pol:'',time:'',respm:'',refc:'',refspan:'',subj:'',subjnames:[],ia:'',iaopt:'',rk:'',ab:[],extra:''});
const blankEasy=()=>({acts:[blankAct()]});
const blank=()=>({outcome:null,wire:'',field:'',slot:'',note:'',notes:'',mode:'easy',ecPart:'',easy:blankEasy()});
// Which draft fields each outcome owns. An explicit outcome change drops every field the new outcome does not own (it never moves, copies or infers content between outcomes).
const CLARIFY_ONLY=['field','slot','note','ecPart'];
const LEGAL={ACCEPT:['outcome','wire','notes','mode','easy'],EXPECTED_CLARIFY:['outcome','wire','notes','mode','easy','field','slot','note','ecPart']};
const retainLegal=(d)=>{const keep=LEGAL[d.outcome]||['outcome'];const b=blank();for(const k of Object.keys(b))if(!keep.includes(k))d[k]=b[k];return d;};
const chooseOutcome=(d,outcome)=>{d.outcome=outcome;return retainLegal(d);};
// ---- deterministic serialization of the human's explicit selections into the EXISTING wire syntax ---------------
const ABCODE={force:'force',address:'address',facet:'facet',relation:'relation',referent:'referent',subject:'subject',temporal:'time',inbound_answer:'answer'};
const ABORDER=['force','address','facet','relation','referent','subject','temporal','inbound_answer'];
const NEEDS_TARGET=['cont','fix','back','nudge','reply','drop'];
const labelNum=(l)=>Number(String(l).replace(/\D/g,''))||0;
const sortLabels=(a)=>[...a].sort((x,y)=>labelNum(x)-labelNum(y));
// The clarify field the ambiguity form attaches to a part of the wire (only fields the wire can spell; discourse_state is not a wire field).
const ecPartIndex=(d)=>(d.outcome==='EXPECTED_CLARIFY'&&ABCODE[d.field]&&d.easy.acts.length===1)?0:(d.outcome==='EXPECTED_CLARIFY'&&ABCODE[d.field]&&d.ecPart!==''?Number(d.ecPart):-1);
const effectiveAb=(d,i)=>{const a=d.easy.acts[i];const set=new Set(a.ab);if(ecPartIndex(d)===i)set.add(d.field);return ABORDER.filter((f)=>set.has(f));};
function missingEasy(d){
 const m=[];const multi=d.easy.acts.length>1;
 if(!d.outcome){m.push('your judgment');return m;}
 d.easy.acts.forEach((a,i)=>{
  const p=multi?'Part '+(i+1)+': ':'';
  if(!a.speech)m.push(p+'what the player is doing');
  if(!a.facet)m.push(p+'what it asks about or claims');
  if(!a.addr)m.push(p+'whom the words address');else if((a.addr==='named'||a.addr==='except')&&!a.names.length)m.push(p+'which typed name');
  if(!a.rel)m.push(p+'whether the words point back to earlier talk');else if(NEEDS_TARGET.includes(a.rel)&&!a.target)m.push(p+'which earlier item');else if(a.rel==='end'&&!a.target)m.push(p+'which round (or none)');
  if(i>0&&a.start==='')m.push(p+'where this part starts');
  if(a.subj==='named'&&!a.subjnames.length)m.push(p+'which typed names the statement is about');
  if(a.iaopt&&!a.ia)m.push(p+'the kind of answer');
  if(a.refspan&&!a.refc)m.push(p+'the thing meant');
 });
 if(d.outcome==='EXPECTED_CLARIFY'){
  if(!d.field)m.push('what is unclear');
  if(!d.slot)m.push('what kind of clarification');
  if(d.field&&ABCODE[d.field]&&multi&&d.ecPart==='')m.push('which part it is unclear in');
 }
 return m;
}
function serializeAct(a,i,d){
 const addr=a.addr==='none'?'-':a.addr==='named'?'@'+sortLabels(a.names).join('+'):a.addr==='except'?'except@'+sortLabels(a.names).join('+'):a.addr;
 const rel=a.rel+(a.target&&a.target!=='none'?':'+a.target:'');
 const out=[a.speech,a.facet,addr,rel];
 if(i>0)out.push('at='+a.start);
 if(a.qform)out.push('f='+a.qform);
 if(a.pol)out.push('pol='+a.pol);
 if(a.rk)out.push('rk='+a.rk);
 if(a.refc)out.push('r='+(a.refspan?a.refspan+'>':'')+a.refc);
 if(a.time)out.push('t='+a.time);
 if(a.respm)out.push('m='+a.respm);
 if(a.ia)out.push('ia='+a.ia+(a.iaopt?':'+a.iaopt:''));
 if(a.subj)out.push('s='+a.subj+(a.subj==='named'?':'+sortLabels(a.subjnames).join('+'):''));
 const ab=effectiveAb(d,i);if(ab.length)out.push('ab='+ab.map((f)=>ABCODE[f]).join('+'));
 for(const x of String(a.extra||'').trim().split(/\s+/))if(x)out.push(x);
 return out.join(' ');
}
// The wire is a pure function of the explicit selections; it is empty until every required choice has been made.
function serializeEasy(d){const missing=missingEasy(d);return{wire:missing.length?'':d.easy.acts.map((a,i)=>serializeAct(a,i,d)).join(' ; '),missing};}
const effectiveWire=(d)=>(d.mode==='raw'?d.wire:serializeEasy(d).wire);
// What the page sends for validation / commit: only fields the chosen outcome owns, so what the form shows and what is validated cannot disagree.
const collectDraft=(d)=>{const o={outcome:d.outcome,wire:effectiveWire(d),notes:d.notes};if(d.outcome==='EXPECTED_CLARIFY')o.expected_clarify={field:d.field,slot:d.slot,note:d.note};return o;};
// Easy -> Raw copies the deterministic serialization; Raw -> Easy never reverse-engineers a hand-written wire (it needs an explicit discard).
const enterRaw=(d)=>{const s=serializeEasy(d).wire;d.mode='raw';d.wire=s;return d;};
const canReturnToEasy=(d)=>{const w=d.wire.trim();return w===''||w===serializeEasy(d).wire;};
const returnToEasy=(d,{discard=false}={})=>{if(!canReturnToEasy(d)&&!discard)return false;d.mode='easy';d.wire='';return true;};
// ---- plain-English context: a display-only re-reading of the AUTHORIZED render text; nothing is added or recovered ----
const jq=(s)=>{try{return JSON.parse(s);}catch(e){return String(s);}};
const QS='"(?:[^"\\\\]|\\\\.)*"';
function parseRender(text){
 const P={line:'',readAs:'',tokens:[],people:[],chip:'',names:[],typed:[],things:[],place:'',anaphora:[],talking:[],requests:[],inbound:null,answered:null,activity:null,claim:null,prev:'',heard:[],other:[]};
 for(const raw of String(text).split('\n')){
  let m;
  if(raw.indexOf('line: ')===0){P.line=raw.slice(6);continue;}
  if(raw.indexOf('read as: ')===0){P.readAs=raw.slice(9);continue;}
  if(raw.indexOf('tokens: ')===0){P.tokens=[...raw.slice(8).matchAll(/(\d+):(\S*)/g)].map((x)=>({i:Number(x[1]),text:x[2]}));continue;}
  if(raw.indexOf('people: ')===0){P.people=raw.slice(8).split(', ').map((x)=>{const mm=/^(p\d+) (.*)$/.exec(x);return mm?{label:mm[1],name:mm[2]}:null;}).filter(Boolean);continue;}
  if(raw.indexOf('player chose to speak to: ')===0){P.chip=raw.slice(26);continue;}
  if(raw.indexOf('names typed: ')===0){P.names=[...raw.slice(13).matchAll(new RegExp('(n\\d+) ('+QS+')@(\\d+)(?:=(the player|not here|[^\\s,]+))?( possessive)?','g'))].map((x)=>({label:x[1],text:jq(x[2]),token:Number(x[3]),ref:x[4]||'',possessive:!!x[5]}));continue;}
  if(raw.indexOf('things typed: ')===0){P.typed=[...raw.slice(14).matchAll(new RegExp('(e\\d+) ('+QS+')@(\\d+)(?:=([^\\s,]+)| (unclear)| \\(([^)]*)\\))?','g'))].map((x)=>({label:x[1],text:jq(x[2]),token:Number(x[3]),id:x[4]||'',unclear:!!x[5],kind:x[6]||''}));continue;}
  if(raw.indexOf('things: ')===0){P.things=[...raw.slice(8).matchAll(new RegExp('(r\\d+) ('+QS+') (\\S+) (.+?)(?:; (?=r\\d+ )|$)','g'))].map((x)=>({label:x[1],name:jq(x[2]),kind:x[3],basis:x[4]}));continue;}
  if(raw.indexOf('place in talk: ')===0){P.place=raw.slice(15);continue;}
  if(raw.indexOf('"it/that/there" may be: ')===0){P.anaphora=raw.slice(24).split(' ').filter(Boolean);continue;}
  if(raw.indexOf('talking with: ')===0){P.talking=raw.slice(14).split(' ').filter(Boolean);continue;}
  if((m=/^(q\d+): asked (\S+)(?: to ([^;]+))?; (.*?)(?: by (\S+))?( \(latest\))?$/.exec(raw))){P.requests.push({label:m[1],facet:m[2],to:m[3]||'',state:m[4],by:m[5]||'',latest:!!m[6]});continue;}
  if((m=/^i1: (.+?) asked the player(?: \((\S+)\))?(?:, wants (.+?))?(?:, options (.*))?$/.exec(raw))){P.inbound={from:m[1],facet:m[2]||'',shape:m[3]||'',options:m[4]?[...m[4].matchAll(new RegExp('(o\\d+) ('+QS+')','g'))].map((x)=>({label:x[1],text:jq(x[2])})):[]};continue;}
  if((m=/^i0: the player just answered (.*)$/.exec(raw))){P.answered={from:m[1]};continue;}
  if((m=/^v1: round (\S+); done (\S+); left (\S+)$/.exec(raw))){P.activity={facet:m[1],done:m[2],left:m[3]};continue;}
  if((m=/^c1: the player said (NOT )?(\S+) about (\S+) \((.*)\)$/.exec(raw))){P.claim={not:!!m[1],facet:m[2],about:m[3],state:m[4]};continue;}
  if(raw.indexOf("player's previous line: ")===0){P.prev=jq(raw.slice(24));continue;}
  if((m=new RegExp('^heard (a\\d+) (\\S+)(?: re (q\\d+))?: ('+QS+')$').exec(raw))){P.heard.push({label:m[1],speaker:m[2],re:m[3]||'',text:jq(m[4])});continue;}
  if((m=new RegExp('^heard (\\S+): ('+QS+')$').exec(raw))){P.heard.push({label:'',speaker:m[1],re:'',text:jq(m[2])});continue;}
  P.other.push(raw);
 }
 return P;
}
function facetGlosses(systemText){const out={};const i=String(systemText).indexOf('FACET CODES:');if(i<0)return out;for(const l of String(systemText).slice(i).split('\n').slice(1)){const m=/^(\S+) = (.*)$/.exec(l);if(m)out[m[1]]=m[2];}return out;}
const personName=(P,l)=>{const p=P.people.find((x)=>x.label===l);return p?p.name:l;};
const personList=(P,s)=>String(s).split('+').map((x)=>x==='the player'?'you':personName(P,x)).join(', ');
const thingName=(P,l)=>{const t=P.things.find((x)=>x.label===l);return t?t.name:l;};
const facetText=(G,c)=>c==='?'?'something not in the topic list':c==='-'?'nothing':(G[c]?G[c]+' ('+c+')':c);
const quote=(s)=>'“'+s+'”';
// [{title,text}] in render order. Identifiers that cannot be translated from the render itself stay as they are.
function humanRows(P,G){
 const rows=[];const add=(title,text)=>rows.push({title,text});
 if(P.people.length)add('People present',P.people.map((p)=>p.name).join(', '));
 if(P.chip)add('Delivered to (interface choice)',personName(P,P.chip)+' · not part of the player’s words');
 for(const n of P.names){const ref=n.ref==='the player'?'the player (you)':n.ref==='not here'?'a person who is not present':n.ref?personName(P,n.ref):'';add('Name typed in the line',quote(n.text)+' at word '+(n.token+1)+(ref?', matching '+ref:'')+(n.possessive?' (possessive)':''));}
 for(const t of P.typed)add('Thing typed in the line',quote(t.text)+' at word '+(t.token+1)+(t.id?', matching '+t.id:t.unclear?', unclear which thing':t.kind?' ('+t.kind+')':''));
 if(P.things.length)add('Things that may be referred to',P.things.map((r)=>r.name+' ('+r.kind+', '+r.basis+')').join('; '));
 if(P.place)add('Place being talked about',P.place);
 if(P.anaphora.length)add('“it”, “that” or “there” may mean',P.anaphora.map((l)=>thingName(P,l)).join(', '));
 if(P.talking.length)add('Currently talking with',P.talking.map((l)=>personName(P,l)).join(', '));
 for(const r of P.requests)add('Earlier request','You asked '+facetText(G,r.facet)+(r.to?', of '+personList(P,r.to):'')+'; '+r.state+(r.by?' by '+personList(P,r.by):'')+(r.latest?' (most recent)':'')+'  ['+r.label+']');
 if(P.inbound){const ib=P.inbound;add('A coworker is waiting for your answer',(ib.from==='a coworker'?'A coworker':personName(P,ib.from))+' asked you'+(ib.facet?' about: '+facetText(G,ib.facet):' a question')+(ib.shape?'. They want: '+ib.shape:'')+(ib.options.length?'. Options: '+ib.options.map((o)=>o.label+' '+quote(o.text)).join(', '):'')+'  [i1]');}
 if(P.answered)add('You just answered',(P.answered.from==='a coworker'?'a coworker':personName(P,P.answered.from))+'’s question  [i0]');
 if(P.activity)add('Activity round',facetText(G,P.activity.facet)+'. Done: '+(P.activity.done==='none'?'nobody':personList(P,P.activity.done))+'. Left: '+(P.activity.left==='none'?'nobody':personList(P,P.activity.left))+'  [v1]');
 if(P.claim)add('Your earlier claim','You said '+(P.claim.not?'NOT ':'')+facetText(G,P.claim.facet)+' about '+(P.claim.about==='someone'?'someone':personList(P,P.claim.about))+' ('+P.claim.state+')  [c1]');
 if(P.prev)add('You previously said',quote(P.prev));
 for(const h of P.heard)add('Heard',(h.speaker==='?'?'Someone':personName(P,h.speaker))+' said '+quote(h.text)+(h.re?' (about request '+h.re+')':'')+(h.label?'  ['+h.label+']':''));
 for(const o of P.other)add('Other',o);
 return rows;
}
// A short plain description of a label (for choosing an earlier item); label kept secondary.
function describeLabel(P,G,l){
 let m;
 if(/^q\d+$/.test(l)){const r=P.requests.find((x)=>x.label===l);return r?'Earlier request: asked '+facetText(G,r.facet)+(r.to?', of '+personList(P,r.to):''):'Earlier request';}
 if(l==='i1')return 'The coworker question that is waiting'+(P.inbound&&P.inbound.from!=='a coworker'?' (from '+personName(P,P.inbound.from)+')':'');
 if(l==='i0')return 'The coworker question you just answered';
 if(l==='v1')return 'The open activity round'+(P.activity?': '+facetText(G,P.activity.facet):'');
 if(l==='c1')return 'Your earlier claim';
 if(/^a\d+$/.test(l)){const h=P.heard.find((x)=>x.label===l);return h?'Heard: '+(h.speaker==='?'?'someone':personName(P,h.speaker))+' said '+quote(h.text):'A heard sentence';}
 if((m=/^s(\d)$/.exec(l)))return 'An earlier part of this same line (Part '+(Number(m[1])+1)+')';
 return l;
}
// The labels this render offers as relation targets, in render order (mechanical listing; nothing is ranked or filtered by meaning).
function targetLabels(P,partIndex){
 const out=[];for(const r of P.requests)out.push(r.label);
 if(P.inbound)out.push('i1');if(P.answered)out.push('i0');if(P.activity)out.push('v1');if(P.claim)out.push('c1');
 for(const h of P.heard)if(h.label)out.push(h.label);
 for(let k=0;k<partIndex;k++)out.push('s'+k);
 return out;
}
// ---- the question sequence: a pure function of the draft (never of the player's line) -----------------------------
function stepsOf(d){
 const steps=[];
 if(d.outcome==='EXPECTED_CLARIFY')steps.push('ecfield','ecslot');
 d.easy.acts.forEach((a,i)=>{if(i>0)steps.push('start:'+i);steps.push('speech:'+i,'facet:'+i,'addr:'+i,'rel:'+i);});
 if(d.outcome==='EXPECTED_CLARIFY'&&ABCODE[d.field]&&d.easy.acts.length>1)steps.push('ecpart');
 steps.push('preview');
 return steps;
}
function stepDone(d,id){
 const kind=id.split(':')[0];const i=Number(id.split(':')[1]||0);const a=d.easy.acts[i];
 switch(kind){
  case 'ecfield':return !!d.field;
  case 'ecslot':return !!d.slot;
  case 'ecpart':return d.ecPart!=='';
  case 'start':return a.start!=='';
  case 'speech':return !!a.speech;
  case 'facet':return !!a.facet;
  case 'addr':return !!a.addr&&((a.addr!=='named'&&a.addr!=='except')||a.names.length>0);
  case 'rel':return !!a.rel&&(!NEEDS_TARGET.includes(a.rel)||!!a.target)&&(a.rel!=='end'||!!a.target);
  case 'preview':return missingEasy(d).length===0;
  default:return false;
 }
}
const firstOpenStep=(d)=>{const steps=stepsOf(d);for(const s of steps)if(!stepDone(d,s)&&s!=='preview')return s;return 'preview';};
// ---- plain-English echoes of the human's own answers (display only; the wire is never shown here) ----------------
const clip=(t,n)=>t.length>n?t.slice(0,n-1)+'…':t;
const namesText=(P,labels)=>sortLabels(labels).map((l)=>{const n=P.names.find((x)=>x.label===l);return n?quote(n.text):l;}).join(', ');
function addrText(a,E,P){const k=E.address.find((x)=>x.kind===a.addr);if(!k)return '';return a.addr==='named'?'Addressed by name in the words: '+namesText(P,a.names):a.addr==='except'?'Everyone except '+namesText(P,a.names):k.label;}
function relText(a,E,P,G){const r=E.relation.find((x)=>x.code===a.rel);if(!r)return '';return r.label+(a.target&&a.target!=='none'?' — '+describeLabel(P,G,a.target):'');}
function facetLabel(c,E,G){const sf=E.facet_special.find((x)=>x.code===c);return sf?sf.label:(G[c]||c);}
function answerText(d,id,E,P,G){
 const kind=id.split(':')[0];const i=Number(id.split(':')[1]||0);const a=d.easy.acts[i];
 switch(kind){
  case 'ecfield':return clip(E.unclear[d.field]||'',44);
  case 'ecslot':return clip(E.slot[d.slot]||'',44);
  case 'ecpart':return 'Unclear in part '+(Number(d.ecPart)+1);
  case 'start':return 'Starts at word '+(Number(a.start)+1);
  case 'speech':{const s=E.speech.find((x)=>x.code===a.speech);return s?clip(s.label,44):'';}
  case 'facet':return clip(facetLabel(a.facet,E,G),44);
  case 'addr':return clip(addrText(a,E,P),44);
  case 'rel':{const r=E.relation.find((x)=>x.code===a.rel);return r?clip(r.label.replace(/ \(.*$/,''),44):'';}
  default:return '';
 }
}
function summaryLines(d,E,P,G){
 const out=[];const multi=d.easy.acts.length>1;const O=E.optional;
 out.push({title:'Your judgment',text:d.outcome==='EXPECTED_CLARIFY'?'Something important is unclear':'I understand what the player means'});
 if(d.outcome==='EXPECTED_CLARIFY'){if(d.field)out.push({title:'What is unclear',text:E.unclear[d.field]});if(d.slot)out.push({title:'A coworker would ask',text:E.slot[d.slot]});}
 d.easy.acts.forEach((a,i)=>{
  const p=multi?'Part '+(i+1)+' · ':'';const add=(t,x)=>{if(x)out.push({title:p+t,text:x});};
  if(i>0&&a.start!=='')add('Starts at','word '+(Number(a.start)+1));
  const sp=E.speech.find((x)=>x.code===a.speech);add('The player is',sp&&sp.label);
  add('Asking about / claiming',a.facet&&facetLabel(a.facet,E,G));
  add('The words address',a.addr&&addrText(a,E,P));
  add('The words point back to',a.rel&&relText(a,E,P,G));
  add('Kind of question',a.qform&&O.qform.values[a.qform]);
  add('Wording',a.pol&&O.pol.values[a.pol]);
  add('Time',a.time&&O.time.values[a.time]);
  add('Who should answer',a.respm&&O.respm.values[a.respm]);
  if(a.refc){const t=P.things.find((x)=>x.label===a.refc);add('Thing or place meant',(t?t.name:(O.refc.special[a.refc]||a.refc))+(a.refspan?' (typed by the player)':''));}
  if(a.subj)add('About',(O.subj.values[a.subj]||a.subj)+(a.subj==='named'&&a.subjnames.length?': '+namesText(P,a.subjnames):''));
  if(a.ia)add('Answers the waiting question',(O.ia.values[a.ia]||a.ia)+(a.iaopt?' ('+(O.ia.options[a.iaopt]||a.iaopt)+')':''));
  add('Fixing',a.rk&&O.rk.values[a.rk]);
  const ab=ABORDER.filter((f)=>a.ab.includes(f));if(ab.length)add('Left open by the line',ab.map((f)=>E.unclear[f]).join('; '));
  add('Other fields (raw)',a.extra.trim());
 });
 return out;
}
// ---- the context picture: people, the earlier conversation as bubbles, things in play (display of the authorized render only) ----
function pictureOf(P,G){
 const people=P.people.map((p)=>({label:p.label,name:p.name,talking:P.talking.includes(p.label)}));
 const bubbles=[];const who=(l)=>(l==='a coworker'||l==='?')?'A coworker':personName(P,l);
 for(const r of P.requests)bubbles.push({side:'you',who:'You',text:'asked '+facetText(G,r.facet)+(r.to?', of '+personList(P,r.to):''),note:r.state+(r.by?' by '+personList(P,r.by):'')+(r.latest?' · most recent':'')});
 if(P.inbound){const ib=P.inbound;bubbles.push({side:'them',who:who(ib.from),text:'asked you'+(ib.facet?' about: '+facetText(G,ib.facet):' a question')+(ib.options.length?'. Options: '+ib.options.map((o)=>quote(o.text)).join(', '):''),note:'waiting for your answer'+(ib.shape?' · wants '+ib.shape:'')});}
 if(P.answered)bubbles.push({side:'you',who:'You',text:'just answered '+who(P.answered.from)+'’s question',note:''});
 if(P.activity)bubbles.push({side:'them',who:'Round',text:facetText(G,P.activity.facet),note:'done: '+(P.activity.done==='none'?'nobody':personList(P,P.activity.done))+' · left: '+(P.activity.left==='none'?'nobody':personList(P,P.activity.left))});
 if(P.claim)bubbles.push({side:'you',who:'You',text:'said '+(P.claim.not?'NOT ':'')+facetText(G,P.claim.facet)+' about '+(P.claim.about==='someone'?'someone':personList(P,P.claim.about)),note:P.claim.state});
 if(P.prev)bubbles.push({side:'you',who:'You',text:quote(P.prev),note:'previous line'});
 for(const h of P.heard)bubbles.push({side:'them',who:who(h.speaker),text:quote(h.text),note:h.re?'about request '+h.re:''});
 const tags=[];
 for(const n of P.names){const m=n.ref==='the player'?'the player (you)':n.ref==='not here'?'a person who is not present':n.ref?personName(P,n.ref):'';tags.push({kind:'Name typed',text:quote(n.text)+' (word '+(n.token+1)+')'+(m?', matching '+m:'')});}
 if(P.chip)tags.push({kind:'Delivered to (interface choice)',text:personName(P,P.chip)+' · not part of the player’s words'});
 for(const t of P.typed)tags.push({kind:'Thing typed',text:quote(t.text)+' (word '+(t.token+1)+')'});
 for(const t of P.things)tags.push({kind:'Could be meant',text:t.name+' · '+t.kind});
 if(P.place)tags.push({kind:'Place',text:P.place});
 if(P.anaphora.length)tags.push({kind:'“it” / “that” may mean',text:P.anaphora.map((l)=>thingName(P,l)).join(', ')});
 for(const o of P.other)tags.push({kind:'Other',text:o});
 return{people,bubbles,tags};
}
// Focus left on an outcome radio or an Easy control belongs to the PREVIOUS item; it is released before a new item is drawn.
function releaseStaleFocus(page){const a=page&&page.activeElement;if(!a||typeof a.blur!=='function')return false;const box=page.getElementById?page.getElementById('easyBox'):null;if(a.name==='outcome'||(box&&typeof box.contains==='function'&&box.contains(a))){a.blur();return true;}return false;}
/*PURE-END*/
const S={sum:null,item:null,drafts:new Map(),editing:new Set(),check:null,defs:null,easy:null,P:null,G:{},checkSeq:0,timer:null,toastTimer:null,step:new Map(),detailOpen:new Set(),facetGroup:new Map(),relYes:new Set()};
const draftOf=()=>{const id=S.item.id;if(!S.drafts.has(id))S.drafts.set(id,blank());return S.drafts.get(id);};
const editing=()=>S.editing.has(S.item.id);
// A form is open only for an uncommitted item, or for a committed / void-label item the human has deliberately chosen to (re)judge.
const isOpen=()=>S.item&&(S.item.status.state==='uncommitted'||editing());
const GROUPS=[['line','What the player said'],['people','People'],['typed','Typed in the line'],['scene','Things in play'],['discourse','Conversation state'],['heard','Heard coworker lines'],['other','Other']];
function renderHeader(){const s=S.sum;$('hT').textContent=s.total;$('hC').textContent=s.committed;$('hR').textContent=s.remaining;$('hL').textContent=s.labeler;const b=$('hB');b.textContent='blocked '+s.blocked;b.className=s.blocked?'pill':'pill hide';}
function renderItem(){
 releaseStaleFocus(document);
 const it=S.item;$('hN').textContent=it.n;
 S.P=parseRender(it.render_user);
 $('say').textContent=S.P.line;
 const ra=$('readAs');ra.textContent=S.P.readAs?'Read as: '+S.P.readAs:'';ra.className=S.P.readAs?'msg':'msg hide';
 const know=$('know');know.textContent='';
 const pic=pictureOf(S.P,S.G);
 if(pic.people.length){const row=el('div',{class:'people'});for(const p of pic.people)row.append(el('span',{class:'person'},el('i',{class:'av'},p.name.slice(0,1).toUpperCase()),el('span',{},p.name)));know.append(row);}
 if(pic.bubbles.length){know.append(el('div',{class:'sub'},'Earlier'));const bw=el('div',{class:'bubbles'});for(const b of pic.bubbles)bw.append(el('div',{class:'bubble '+b.side},el('b',{},b.who),el('span',{class:'bt'},b.text),b.note?el('span',{class:'bn'},b.note):''));know.append(bw);}
 if(pic.tags.length){know.append(el('div',{class:'sub'},'In play'));const tw2=el('div',{class:'tags'});for(const t of pic.tags)tw2.append(el('span',{class:'tag'},el('i',{},t.kind),el('span',{},t.text)));know.append(tw2);}
 if(!pic.people.length&&!pic.bubbles.length&&!pic.tags.length)know.append(el('div',{class:'msg'},'Nothing else is shown for this line.'));
 const cl=$('ctxList');cl.textContent='';cl.append(el('div',{class:'meta'},'Context as a plain list'));for(const r of humanRows(S.P,S.G))cl.append(el('div',{class:'row'},el('div',{class:'k'},r.title),el('div',{class:'v'},r.text)));
 const tk=it.view.find(v=>v.key==='tokens');const tw=$('tokens');tw.textContent='';
 if(tk&&tk.tokens)for(const t of tk.tokens)tw.append(el('span',{class:'tok'},el('i',{},String(t.i)),el('span',{},t.text)));
 $('meta').textContent=it.id+'  ·  render '+it.render_digest.slice(0,16)+(S.defs?'  ·  system '+S.defs.system_digest.slice(0,16):'');
 const ctx=$('ctx');ctx.textContent='';
 ctx.append(el('div',{class:'meta'},'Observer-safe context (raw encoding)'));
 for(const[g,title]of GROUPS){if(g==='line')continue;const rr=it.view.filter(v=>v.group===g);if(!rr.length)continue;for(const r of rr)ctx.append(el('div',{class:'row'},el('div',{class:'k'},r.title),el('div',{class:'v'},r.text)));}
 const rd=it.view.find(v=>v.key==='read_as');if(rd)ctx.prepend(el('div',{class:'row'},el('div',{class:'k'},rd.title),el('div',{class:'v'},rd.text)));
 $('raw').textContent=it.render_user;
 $('saved').textContent='';
 renderJudgment();
}
function startEdit(mode){const it=S.item;const L=mode==='raw'?it.label:null;const d=blank();if(L){d.outcome=L.gold_outcome;d.wire=L.gold_wire||'';d.field=L.expected_clarify?L.expected_clarify.field:'';d.slot=L.expected_clarify?L.expected_clarify.slot:'';d.note=L.expected_clarify&&L.expected_clarify.note?L.expected_clarify.note:'';d.notes=L.notes||'';d.mode='raw';}S.drafts.set(it.id,d);S.editing.add(it.id);renderJudgment();runCheck();}
function renderJudgment(){
 const it=S.item,st=it.status,d=draftOf(),open=isOpen();
 const badge=$('stateBadge');let cls=st.state,label=st.state;
 if(editing()){cls='draft';label=st.state==='committed'?'editing a saved judgment':'relabeling (the saved label is void)';}
 else if(st.state==='uncommitted'&&(d.outcome||d.wire||d.field||d.slot||effectiveWire(d))){cls='draft';label='draft (not saved)';}
 else if(st.state==='committed')label='saved '+st.committed_at;
 badge.className='state '+cls;badge.textContent=label;
 const cb=$('committedBox');cb.textContent='';cb.className=(st.state==='uncommitted'||editing())?'hide':'';
 if(st.state==='blocked'&&!editing()){
  cb.append(el('div',{class:'ro'},'BLOCKED (fail closed): '+st.reason+'\n\nThis item is NOT counted as labeled.'));
  if(st.committed_at){const b=el('button',{class:'danger'},'Relabel this render…');b.onclick=()=>startEdit('easy');cb.append(el('div',{class:'actions'},b));}
 }else if(st.state==='committed'&&!editing()){
  const Lb=it.label;let t='Judgment: '+(Lb.gold_outcome==='ACCEPT'?'I understand what the player means (ACCEPT)':'Something important is unclear (EXPECTED_CLARIFY)');
  if(Lb.expected_clarify){const f=S.easy&&S.easy.unclear[Lb.expected_clarify.field];const sl=S.easy&&S.easy.slot[Lb.expected_clarify.slot];t+='\nUnclear: '+(f?f+' ('+Lb.expected_clarify.field+')':Lb.expected_clarify.field)+'\nClarification: '+(sl?sl+' ('+Lb.expected_clarify.slot+')':Lb.expected_clarify.slot)+(Lb.expected_clarify.note?'\nNote: '+Lb.expected_clarify.note:'');}
  if(Lb.gold_wire)t+='\nWire: '+Lb.gold_wire;
  if(Lb.notes)t+='\nNotes: '+Lb.notes;t+='\nSaved: '+Lb.committed_at;
  const b=el('button',{class:'danger'},'Edit / recommit (raw wire)…');b.onclick=()=>startEdit('raw');
  const b2=el('button',{class:'danger'},'Re-label in the Easy form (starts blank)…');b2.onclick=()=>startEdit('easy');
  cb.append(el('div',{class:'ro'},t),el('div',{class:'actions'},b,b2),el('div',{class:'msg'},'The Easy form cannot read a saved wire back into choices, so editing a saved wire opens the raw editor. Nothing changes until you save again.'));
 }
 $('form').className=open?'':'hide';
 for(const r of document.querySelectorAll('input[name=outcome]')){r.checked=d.outcome===r.value;r.disabled=!open;r.parentElement.classList.toggle('sel',d.outcome===r.value);}
 $('outHint').textContent=d.outcome?'':'No outcome is selected. Choose one; nothing is preselected.';
 const easy=d.mode==='easy';
 $('easyBox').className=(d.outcome&&easy)?'':'hide';
 $('rawBox').className=(!easy)?'':'hide';
 $('wireBox').className=(!easy&&d.outcome)?'':'hide';
 $('ecBox').className=(!easy&&d.outcome==='EXPECTED_CLARIFY')?'':'hide';
 $('bToRaw').className=easy?'':'hide';$('bToEasy').className=easy?'hide':'';
 $('modeMsg').textContent=easy?'':'Raw editor in use. Returning to the Easy form never reads a hand-written wire back into choices.';
 if(!easy)$('advanced').open=true;
 if($('wire').value!==d.wire)$('wire').value=d.wire;
 $('ecField').value=d.field;$('ecSlot').value=d.slot;$('ecNote').value=d.note;$('notes').value=d.notes;
 $('bCancelEdit').className=editing()?'':'hide';
 if(d.outcome&&easy&&open)renderEasy();
 renderHighlight();renderProblems();
}
// ---- the Easy form ---------------------------------------------------------------------------------------------
function chipGroup(name,opts,cur,onPick,cls){
 const w=el('div',{class:'chips'+(cls?' '+cls:''),role:'radiogroup'});
 for(const o of opts){const lab=el('label',{class:'chip'+(cur===o.v?' sel':'')+(o.off?' off':'')});const r=el('input',{type:'radio',name:name,value:o.v});r.checked=cur===o.v;r.disabled=!!o.off;r.addEventListener('change',()=>onPick(o.v));lab.append(r,el('span',{class:'t'},o.t));if(o.s)lab.append(el('span',{class:'s'},o.s));w.append(lab);}
 return w;
}
function selectBox(opts,cur,onPick,firstText,label){
 const s=el('select',{});s.setAttribute('aria-label',label||firstText);
 s.append(el('option',{value:''},firstText));
 for(const o of opts){if(o.group){const g=el('optgroup',{label:o.group});for(const x of o.items)g.append(el('option',{value:x.v},x.t));s.append(g);}else s.append(el('option',{value:o.v},o.t));}
 s.value=cur;s.addEventListener('change',()=>onPick(s.value));return s;
}
function checkList(opts,cur,onChange){
 const w=el('div',{class:'checks'});
 for(const o of opts){const lab=el('label',{});const c=el('input',{type:'checkbox'});c.checked=cur.includes(o.v)||!!o.forced;c.disabled=!!o.forced;c.addEventListener('change',()=>onChange(o.v,c.checked));lab.append(c,el('span',{},o.t));w.append(lab);}
 return w;
}
function focusKey(e){if(!e||!e.getAttribute)return '';return e.name?'n:'+e.name+'|'+e.value:(e.getAttribute('aria-label')?'a:'+e.getAttribute('aria-label'):'');}
// Re-render the current question after the human changed something (focus is kept), then re-validate.
function changed(){const key=focusKey(document.activeElement);renderEasy();if(key){for(const e of $('easyBox').querySelectorAll('input,select,button')){if(focusKey(e)===key){e.focus();break;}}}renderHighlight();schedule();}
// ---- one question at a time -----------------------------------------------------------------------------------
const stepOf=()=>S.step.get(S.item.id)||'';
function currentStep(d){const steps=stepsOf(d);const s=stepOf();return steps.includes(s)?s:firstOpenStep(d);}
function goStep(id){S.step.set(S.item.id,id);renderEasy();window.scrollTo({top:0});}
function advance(){const d=draftOf();const steps=stepsOf(d);const i=steps.indexOf(currentStep(d));goStep(steps[Math.min(steps.length-1,i+1)]);}
function back(){const d=draftOf();const steps=stepsOf(d);const i=steps.indexOf(currentStep(d));goStep(steps[Math.max(0,i-1)]);}
const partWord=(d)=>d.easy.acts.length>1?'this part':'this line';
function questionOf(d,id){
 const Q=S.easy.questions;const kind=id.split(':')[0];const i=Number(id.split(':')[1]||0);
 const q=Q[kind]||{q:id,term:''};
 return{q:(q.q||'').replace('{part}',partWord(d)),term:q.term,hint:q.hint||''};
}
function targetOptions(i){const P=S.P,G=S.G;return targetLabels(P,i).map((l)=>({v:l,t:describeLabel(P,G,l)+'  ('+l+')'}));}
// One control for one question. Nothing is preselected; the draft decides what is checked.
function stepControls(d,id){
 const E=S.easy,P=S.P,G=S.G;const kind=id.split(':')[0];const i=Number(id.split(':')[1]||0);const a=d.easy.acts[i];const box=el('div',{});
 if(kind==='ecfield'){box.append(chipGroup('unclear',E.defsOrder.map((f)=>({v:f,t:E.unclear[f],s:f})),d.field,(v)=>{d.field=v;if(!ABCODE[v])d.ecPart='';changed();advance();},'stack'));}
 else if(kind==='ecslot'){box.append(chipGroup('slot',Object.keys(E.slot).map((k)=>({v:k,t:E.slot[k],s:k})),d.slot,(v)=>{d.slot=v;changed();advance();},'stack'));
  box.append(el('span',{class:'lab dim'},'Note about the clarification (optional)'));const n=el('input',{type:'text'});n.setAttribute('aria-label','Note about the clarification');n.value=d.note;n.addEventListener('input',()=>{d.note=n.value;schedule();});box.append(n);}
 else if(kind==='ecpart'){box.append(chipGroup('ecpart',d.easy.acts.map((x,k)=>({v:String(k),t:'Part '+(k+1)})),d.ecPart,(v)=>{d.ecPart=v;changed();advance();}));}
 else if(kind==='start'){box.append(selectBox(P.tokens.map((t)=>({v:String(t.i),t:quote(t.text)+' (word '+(t.i+1)+')'})),a.start,(v)=>{a.start=v;changed();if(v!=='')advance();},'— choose —','Where this part starts'));}
 else if(kind==='speech'){
  const groups=[];for(const s of E.speech){if(!groups.includes(s.group))groups.push(s.group);}
  box.append(el('div',{class:'msg'},'Examples are invented and generic; they are not about this line.'));
  for(const g of groups){box.append(el('div',{class:'sub'},g),chipGroup('speech'+i,E.speech.filter((s)=>s.group===g).map((s)=>({v:s.code,t:s.label,s:(s.example?'e.g. '+s.example+'  \u00b7  ':'')+s.code})),a.speech,(v)=>{a.speech=v;changed();advance();}));}
 }
 else if(kind==='facet'){
  const byGroup={};for(const f of E.facets){(byGroup[f.group]=byGroup[f.group]||[]).push({v:f.code,t:G[f.code]||f.code,s:f.code});}
  byGroup.other=E.facet_special.map((x)=>({v:x.code,t:x.label,s:x.code}));
  const names=Object.assign({},E.facet_groups,{other:'Something else'});
  const ownGroup=(()=>{for(const g of Object.keys(byGroup))if(byGroup[g].some((x)=>x.v===a.facet))return g;return '';})();
  const fkey=S.item.id+'|'+i;const grp=ownGroup||S.facetGroup.get(fkey)||'';
  box.append(el('div',{class:'msg'},'First pick the kind of thing, then the exact one.'));
  box.append(chipGroup('facetgroup'+i,Object.keys(byGroup).map((g)=>({v:g,t:names[g]||g})),grp,(v)=>{S.facetGroup.set(fkey,v);changed();}));
  if(grp)box.append(el('div',{class:'sub'},names[grp]||grp),chipGroup('facet'+i,byGroup[grp],a.facet,(v)=>{a.facet=v;changed();advance();}));
 }
 else if(kind==='addr'){
  const typed=P.names;
  box.append(el('div',{class:'msg'},typed.length?'If you choose “A person the words name and speak to”, the names typed in the line are listed. You decide whether the words speak to them.':'No name is typed in this line.'));
  box.append(chipGroup('addr'+i,E.address.map((x)=>({v:x.kind,t:x.label,s:x.kind==='none'?'-':x.kind==='named'?'@name':x.kind==='except'?'except@name':x.kind,off:(x.kind==='named'||x.kind==='except')&&!typed.length})),a.addr,(v)=>{a.addr=v;if(v!=='named'&&v!=='except')a.names=[];changed();if(v!=='named'&&v!=='except')advance();},'stack'));
  if(a.addr==='named'||a.addr==='except'){box.append(el('span',{class:'lab'},a.addr==='named'?'The words speak to (choose every name that applies):':'Everyone except (choose every name that applies):'),checkList(typed.map((n)=>({v:n.label,t:quote(n.text)+' at word '+(n.token+1)+(n.ref&&n.ref!=='the player'&&n.ref!=='not here'?' → '+personName(P,n.ref):'')+'  ('+n.label+')'})),a.names,(v,on)=>{a.names=on?[...new Set([...a.names,v])]:a.names.filter((x)=>x!==v);changed();}));}
 }
 else if(kind==='rel'){
  const targets=targetLabels(P,i);const rkey=S.item.id+'|'+i;
  const yes=a.rel!==''&&a.rel!=='new'||S.relYes.has(rkey);
  const cur=a.rel==='new'?'no':yes?'yes':'';
  box.append(chipGroup('relyes'+i,[{v:'no',t:E.relation.find((x)=>x.code==='new').label},{v:'yes',t:'Yes \u2014 the words point back to something earlier'}],cur,(v)=>{if(v==='no'){a.rel='new';a.target='';S.relYes.delete(rkey);changed();advance();}else{if(a.rel==='new'){a.rel='';a.target='';}S.relYes.add(rkey);changed();}},'stack'));
  if(yes){
   box.append(el('div',{class:'sub'},'How do the words point back?'),chipGroup('rel'+i,E.relation.filter((x)=>x.code!=='new').map((x)=>({v:x.code,t:x.label,s:x.code,off:x.target==='required'&&!targets.length})),a.rel,(v)=>{a.rel=v;a.target='';changed();},'stack'));
   const rel=E.relation.find((x)=>x.code===a.rel);
   if(rel&&rel.target!=='none'){
    const opts=targetOptions(i);if(rel.target==='optional')opts.unshift({v:'none',t:'Nothing is open (no target)'});
    box.append(el('span',{class:'lab'},rel.target==='optional'?'Which activity round (or none)?':'Which earlier item?'),selectBox(opts,a.target,(v)=>{a.target=v;changed();if(v)advance();},'\u2014 choose \u2014','Which earlier item'));
   }
  }
 }
 else if(kind==='preview'){box.append(previewControls(d));}
 return box;
}
// Optional details: each is its own small question, shown only when the human adds it.
const DETAIL_KEYS=['qform','pol','time','respm','refc','subj','ia','rk','ab','extra'];
const detailSet=(a,k)=>k==='refc'?!!(a.refc||a.refspan):k==='subj'?!!(a.subj||a.subjnames.length):k==='ia'?!!(a.ia||a.iaopt):k==='ab'?a.ab.length>0:k==='extra'?!!a.extra.trim():!!a[k];
function detailClear(a,k){if(k==='refc'){a.refc='';a.refspan='';}else if(k==='subj'){a.subj='';a.subjnames=[];}else if(k==='ia'){a.ia='';a.iaopt='';}else if(k==='ab')a.ab=[];else a[k]='';}
function detailsControls(d,i,a){
 const E=S.easy,P=S.P,O=E.optional,Q=E.questions;const box=el('div',{});
 const open=(k)=>detailSet(a,k)||S.detailOpen.has(S.item.id+'|'+i+'|'+k);
 const vals=(o)=>Object.entries(o).map(([k,t])=>({v:k,t:t+'  ('+k+')'}));
 const auto=ecPartIndex(d)===i?d.field:'';
 const ctl={
  qform:()=>selectBox(vals(O.qform.values),a.qform,(v)=>{a.qform=v;changed();},'— not set —',Q.qform.q),
  pol:()=>selectBox(vals(O.pol.values),a.pol,(v)=>{a.pol=v;changed();},'— not set —',Q.pol.q),
  time:()=>selectBox(vals(O.time.values),a.time,(v)=>{a.time=v;changed();},'— not set —',Q.time.q),
  respm:()=>selectBox(vals(O.respm.values),a.respm,(v)=>{a.respm=v;changed();},'— not set —',Q.respm.q),
  refc:()=>{const w=el('div',{});w.append(selectBox(P.things.map((r)=>({v:r.label,t:r.name+' ('+r.kind+')  ('+r.label+')'})).concat(vals(O.refc.special)),a.refc,(v)=>{a.refc=v;changed();},'— not set —',Q.refc.q));
   if(P.typed.length){w.append(el('span',{class:'lab'},'The thing the player typed for it (optional)'),selectBox(P.typed.map((t)=>({v:t.label,t:quote(t.text)+' at word '+(t.token+1)+'  ('+t.label+')'})),a.refspan,(v)=>{a.refspan=v;changed();},'— not set —','Typed thing'));}return w;},
  subj:()=>{const w=el('div',{});w.append(selectBox(vals(O.subj.values),a.subj,(v)=>{a.subj=v;if(v!=='named')a.subjnames=[];changed();},'— not set —',Q.subj.q));
   if(a.subj==='named'){if(P.names.length)w.append(checkList(P.names.map((n)=>({v:n.label,t:quote(n.text)+'  ('+n.label+')'})),a.subjnames,(v,on)=>{a.subjnames=on?[...new Set([...a.subjnames,v])]:a.subjnames.filter((x)=>x!==v);changed();}));else w.append(el('div',{class:'msg'},'No name is typed in this line.'));}return w;},
  ia:()=>{const w=el('div',{});w.append(selectBox(vals(O.ia.values),a.ia,(v)=>{a.ia=v;if(!v)a.iaopt='';changed();},'— not set —',Q.ia.q));
   if(a.ia){w.append(el('span',{class:'lab'},'Which option (optional)'),selectBox(((P.inbound&&P.inbound.options)||[]).map((o)=>({v:o.label,t:quote(o.text)+'  ('+o.label+')'})).concat(vals(O.ia.options)),a.iaopt,(v)=>{a.iaopt=v;changed();},'— not set —','Which option'));}return w;},
  rk:()=>selectBox(vals(O.rk.values),a.rk,(v)=>{a.rk=v;changed();},'— not set —',Q.rk.q),
  ab:()=>checkList(ABORDER.map((f)=>({v:f,t:E.unclear[f]+'  ('+f+')'+(f===auto?' — set by your answer to “What is unclear?”':''),forced:f===auto})),a.ab,(v,on)=>{a.ab=on?[...new Set([...a.ab,v])]:a.ab.filter((x)=>x!==v);changed();}),
  extra:()=>{const ex=el('input',{type:'text',placeholder:'e.g. rel=q1 n=2'});ex.setAttribute('aria-label','Other fields, raw key=value');ex.value=a.extra;ex.addEventListener('input',()=>{a.extra=ex.value;renderHighlight();schedule();});return ex;}
 };
 const shown=DETAIL_KEYS.filter((k)=>open(k));
  for(const k of shown){
  const row=el('div',{class:'detail'});
  const head=el('div',{class:'dhead'},el('span',{class:'dq'},Q[k].q),el('span',{class:'term'},Q[k].term));
  const rm=el('button',{class:'x'},'Remove');rm.onclick=()=>{detailClear(a,k);S.detailOpen.delete(S.item.id+'|'+i+'|'+k);changed();};head.append(rm);
  row.append(head,ctl[k]());box.append(row);
 }
 const adders=DETAIL_KEYS.filter((k)=>!open(k));
 if(adders.length){box.append(el('span',{class:'lab'},shown.length?'Add another detail:':'Add a detail (optional):'));const w=el('div',{class:'chips'});for(const k of adders){const b=el('button',{class:'addd'},'+ '+Q[k].q);b.onclick=()=>{S.detailOpen.add(S.item.id+'|'+i+'|'+k);changed();};w.append(b);}box.append(w);}
 return box;
}
// The preview: the human's own answers in plain words (the wire stays secondary and collapsed).
function previewControls(d){
 const E=S.easy;const box=el('div',{});const miss=missingEasy(d);
 const lines=summaryLines(d,E,S.P,S.G);
 const ul=el('div',{class:'summary'});for(const l of lines)ul.append(el('div',{class:'srow'},el('span',{class:'k'},l.title),el('span',{class:'v'},l.text)));
 box.append(ul);
 if(d.easy.acts.length<3){const add=el('button',{},'+ Add another part of the line');add.onclick=()=>{d.easy.acts.push(blankAct());S.step.set(S.item.id,'start:'+(d.easy.acts.length-1));changed();};box.append(el('div',{class:'actions'},add));}
 if(miss.length)box.append(el('div',{class:'msg'},'Still to answer: '+miss.join('; ')+'.'));
 const anySet=d.easy.acts.some((a)=>DETAIL_KEYS.some((k)=>detailSet(a,k)));
 const ex=el('details',{class:'extras'});ex.open=anySet||S.detailOpen.has(S.item.id+'|extras');ex.addEventListener('toggle',()=>{if(ex.open)S.detailOpen.add(S.item.id+'|extras');else S.detailOpen.delete(S.item.id+'|extras');});
 ex.append(el('summary',{},'Add a detail (optional \u2014 most lines need none)'));
 d.easy.acts.forEach((a,i)=>{if(d.easy.acts.length>1)ex.append(el('div',{class:'sub'},'Part '+(i+1)));ex.append(detailsControls(d,i,a));});
 box.append(ex);
 return box;
}
function renderEasy(){
 const d=draftOf();const E=S.easy;
 const steps=stepsOf(d);const cur=currentStep(d);const idx=steps.indexOf(cur);S.step.set(S.item.id,cur);
 // answers so far: small pills, each jumps back to its question
 const ans=$('answers');ans.textContent='';
 for(const s of steps){if(s===cur||s==='preview'||!stepDone(d,s))continue;const t=answerText(d,s,E,S.P,S.G);if(!t)continue;const b=el('button',{class:'pill2'},t);b.onclick=()=>goStep(s);ans.append(b);}
 const card=$('stepCard');card.textContent='';
 const qi=questionOf(d,cur);
 const kind=cur.split(':')[0];const partNo=Number(cur.split(':')[1]||0);
 card.append(el('div',{class:'stephead'},'Question '+(idx+1)+' of '+steps.length+(d.easy.acts.length>1&&/^(start|speech|facet|addr|rel)$/.test(kind)?'  ·  Part '+(partNo+1):'')));
 card.append(el('div',{class:'qtext'},qi.q));
 if(qi.term)card.append(el('div',{class:'term'},qi.term));
 if(qi.hint)card.append(el('div',{class:'hint'},qi.hint));
 card.append(stepControls(d,cur));
 const nav=el('div',{class:'stepnav'});
 const bk=el('button',{},'← Back');bk.disabled=idx<=0;bk.onclick=back;nav.append(bk);
 if(cur!=='preview'){const nx=el('button',{class:'primary'},'Next →');nx.disabled=!stepDone(d,cur);nx.onclick=advance;nav.append(nx);}
 card.append(nav);
 $('genBox').className=cur==='preview'?'':'hide';
 renderGen();
}
function renderGen(){
 const d=draftOf();const g=$('genHl');g.textContent='';const s=serializeEasy(d);
 if(!s.wire){g.append(el('span',{class:'sep'},'(empty until you answer every required question)'));$('genState').textContent='';return;}
 g.append(...highlightNodes(s.wire));
 $('genState').textContent=S.check?(S.check.ok?'Valid against the observer-safe checks.':'Not valid yet (see the list above).'):'Checking…';
}
function highlightNodes(w){const out=[];w.split(' ; ').forEach((seg,i)=>{if(i)out.push(el('span',{class:'sep'},' ; '));seg.split(' ').forEach((f,j)=>{if(j)out.push(' ');const c=['sp','fc','ad','rl'][j]||'tg';out.push(el('span',{class:c},f));});});return out;}
function renderHighlight(){const h=$('hl');h.textContent='';const w=draftOf().wire;if(!w){h.append(el('span',{class:'sep'},'(your wire, highlighted as you type)'));return;}h.append(...highlightNodes(w));}
function renderProblems(){const ul=$('probs');ul.textContent='';const d=draftOf();const c=S.check;
 let can=false;
 if(!d.outcome){ul.append(el('li',{},'Choose your judgment above.'));}
 else if(d.mode==='easy'){
  const miss=missingEasy(d);
  if(miss.length){ul.append(el('li',{class:'todo'},'Still to choose: '+miss.join('; ')+'.'));}
  else if(c&&!c.ok){for(const p of c.problems)ul.append(el('li',{},(p.layer+' '+p.code+(p.act!=null?' (act '+(p.act+1)+')':'')+(p.field?' ['+p.field+']':'')+': ')+p.message));}
  else if(c&&c.ok){ul.append(el('li',{class:'good'},'Ready to save. (Resolver-level validation happens after saving.)'));can=isOpen();}
 }else{
  if(c&&!c.ok){for(const p of c.problems)ul.append(el('li',{},(p.layer+' '+p.code+(p.act!=null?' (act '+(p.act+1)+')':'')+(p.field?' ['+p.field+']':'')+': ')+p.message));}
  else if(c&&c.ok){ul.append(el('li',{class:'good'},'Valid against the observer-safe checks (syntax, legal labels, surface). Resolver-level validation happens after commit.'));can=isOpen();}
 }
 $('bCommit').disabled=!can;$('bCommitNext').disabled=!can;
 if(d.mode==='easy'&&d.outcome)renderGen();
}
function collect(){return collectDraft(draftOf());}
async function runCheck(){const it=S.item;const d=draftOf();if(!d.outcome){S.check=null;renderProblems();return;}
 if(d.mode==='easy'&&missingEasy(d).length){S.check=null;renderProblems();return;}
 const seq=++S.checkSeq;try{const c=await api('/api/check',{id:it.id,draft:collect()});if(seq===S.checkSeq&&S.item.id===it.id){S.check=c;renderProblems();}}catch(e){S.check={ok:false,problems:[{layer:'CLIENT',code:'check_failed',message:e.message}]};renderProblems();}}
function schedule(){S.check=null;clearTimeout(S.timer);renderProblems();S.timer=setTimeout(runCheck,180);}
async function load(ref){const q=typeof ref==='number'?'n='+ref:'id='+encodeURIComponent(ref);try{S.item=await api('/api/item?'+q);S.check=null;$('actMsg').textContent='';renderItem();if(isOpen())runCheck();}catch(e){$('actMsg').textContent=e.message;}}
async function refreshSummary(){S.sum=await api('/api/state');renderHeader();}
function nextOpen(from){const o=S.sum.order;for(let k=1;k<=o.length;k++){const x=o[(from-1+k)%o.length];if(x.state!=='committed')return x.n;}return null;}
function toast(t){$('saved').textContent=t;clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>{$('saved').textContent='';},2500);}
async function commit(andNext){const it=S.item;const d=draftOf();if(!d.outcome){$('actMsg').textContent='Choose your judgment first.';return;}
 const edit=S.editing.has(it.id);if(edit&&!confirm('Save item '+it.n+' again? Your previous saved judgment is kept in the journal; this replaces the current label.'))return;
 try{const r=await api('/api/commit',{id:it.id,draft:collect(),explicit:true,replace:edit,previous_committed_at:edit?it.status.committed_at:null});S.drafts.delete(it.id);S.editing.delete(it.id);S.sum=r.summary;renderHeader();
  if(andNext){const n=nextOpen(it.n);if(n){await load(n);toast('Saved.');return;}}await load(it.n);toast('Saved.');}catch(e){const p=e.payload&&e.payload.problems;S.check=p?{ok:false,problems:p}:S.check;renderProblems();$('actMsg').textContent='Not saved: '+e.message;}}
function bind(){
 for(const r of document.querySelectorAll('input[name=outcome]'))r.addEventListener('change',()=>{chooseOutcome(draftOf(),r.value);renderJudgment();schedule();});
 $('wire').addEventListener('input',()=>{draftOf().wire=$('wire').value;renderHighlight();schedule();});
 $('ecField').addEventListener('change',()=>{draftOf().field=$('ecField').value;schedule();});$('ecSlot').addEventListener('change',()=>{draftOf().slot=$('ecSlot').value;schedule();});
 $('ecNote').addEventListener('input',()=>{draftOf().note=$('ecNote').value;schedule();});$('notes').addEventListener('input',()=>{draftOf().notes=$('notes').value;schedule();});
 $('bToRaw').onclick=()=>{enterRaw(draftOf());renderJudgment();schedule();};
 $('bToEasy').onclick=()=>{const d=draftOf();if(!canReturnToEasy(d)){if(!confirm('The Easy form cannot read a hand-written wire back into choices. Discard the raw wire and return to the Easy form? (Your Easy selections are kept; the saved label is never touched.)'))return;returnToEasy(d,{discard:true});}else returnToEasy(d);renderJudgment();schedule();};
 $('bCommit').onclick=()=>commit(false);$('bCommitNext').onclick=()=>commit(true);
 $('bCancelEdit').onclick=()=>{S.drafts.delete(S.item.id);S.editing.delete(S.item.id);S.check=null;renderJudgment();};
 $('bPrev').onclick=()=>load(Math.max(1,S.item.n-1));$('bNext').onclick=()=>load(Math.min(S.sum.total,S.item.n+1));
 $('bNextOpen').onclick=()=>{const n=nextOpen(S.item.n);if(n)load(n);else $('actMsg').textContent='Every item is saved.';};
 const go=()=>{const v=$('jump').value.trim();if(!v)return;load(/^\d+$/.test(v)?Number(v):v);};$('bJump').onclick=go;$('jump').addEventListener('keydown',(e)=>{if(e.key==='Enter')go();});
 $('bCopy').onclick=async()=>{try{await navigator.clipboard.writeText(S.item.render_user);$('copyMsg').textContent='copied';}catch{$('copyMsg').textContent='copy failed';}setTimeout(()=>$('copyMsg').textContent='',1500);};
 $('bValidate').onclick=async()=>{try{const v=await api('/api/validate');alert('Observer-safe whole-file validation\n\nsaved '+v.committed+' / '+v.total+'\nproblems '+v.problems.length+(v.problems.length?'\n'+v.problems.slice(0,12).map(p=>'#'+p.n+' '+p.problem).join('\n'):''));}catch(e){alert(e.message);}};
 $('bHelp').onclick=()=>{$('helpModal').className='modal';$('bHelpClose').focus();};$('bHelpClose').onclick=()=>{$('helpModal').className='modal hide';$('bHelp').focus();};
 document.addEventListener('keydown',(e)=>{if(e.altKey&&e.code==='KeyJ'){e.preventDefault();$('bPrev').click();}else if(e.altKey&&e.code==='KeyK'){e.preventDefault();$('bNext').click();}else if(e.altKey&&e.code==='KeyU'){e.preventDefault();$('bNextOpen').click();}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(!$('bCommit').disabled&&draftOf().outcome)$('bCommit').click();}});
 window.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('helpModal').classList.contains('hide'))$('bHelpClose').click();});
}
async function init(){
 const [defs,gram,easy]=await Promise.all([api('/api/definitions'),api('/api/grammar'),api('/api/easy')]);S.defs=defs;S.easy=easy;S.easy.defsOrder=defs.clarify_fields;S.G=facetGlosses(defs.system_text);$('defs').textContent=defs.system_text;
 const fill=(sel,list)=>{sel.append(el('option',{value:''},'— choose —'));for(const v of list)sel.append(el('option',{value:v},v));};fill($('ecField'),defs.clarify_fields);fill($('ecSlot'),defs.clarify_slots);
 const g=$('grammar');g.append(el('div',{class:'msg'},gram.note),el('pre',{},gram.shape));
 const tbl=(title,rows)=>{g.append(el('div',{class:'meta'},title));const t=el('table',{class:'g'});for(const r of rows)t.append(el('tr',{},el('td',{},r.code||r.tag),el('td',{},r.meaning||r.form)));g.append(t);};
 tbl('Speech acts',gram.speech_acts);tbl('Special facets',gram.facets.special);g.append(el('div',{class:'msg'},'Facet table: '+gram.facets.table));tbl('Address',gram.address);tbl('Relation',gram.relation);tbl('Optional fields',gram.tags);
 g.append(el('div',{class:'meta'},'Invented syntax examples'));for(const x of gram.examples)g.append(el('pre',{},x.wire+'    # '+x.note));for(const r of gram.rules)g.append(el('div',{class:'msg'},'• '+r));
 bind();await refreshSummary();const first=S.sum.order.find(o=>o.state!=='committed');await load(first?first.n:1);
}
init().catch((e)=>{document.body.append(el('pre',{},'workstation failed to start: '+e.message));});
</script></body></html>
`;

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  installEgressGuard();
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
  const dir = path.resolve(arg("--dir", DEFAULT_DIR));
  const labeler = arg("--labeler", DEFAULT_LABELER);
  const log = (l) => process.stderr.write(`${typeof l === "string" ? l : JSON.stringify(l)}\n`);
  if (flag("--prepare")) {
    log("preparing the blank worksheet (replays the frozen development fixtures offline; this takes several minutes)...");
    const receipt = await prepare({ dir, captureFile: arg("--capture-file"), force: flag("--force"), log: () => {} });
    console.log(JSON.stringify(receipt, null, 1));
    return;
  }
  if (flag("--validate-full")) {
    log("running the existing validator over your labels (regenerates the answer-bearing capture in memory; several minutes)...");
    const r = await validateFull({ dir, captureFile: arg("--capture-file"), detail: flag("--detail"), log: () => {} });
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.problems.length ? 1 : 0);
  }
  if (!isIgnoredOrOutsideRepo(path.join(dir, FILES.labels))) { console.error(`refusing: ${dir} is a tracked repository path; active human labels must live in a gitignored path`); process.exit(2); }
  if (flag("--validate")) {
    const { report, exitCode } = runValidate({ dir, labeler });
    console.log(JSON.stringify(report, null, 1));
    process.exit(exitCode);
  }
  const ws = loadWorkstation({ dir, labeler });
  const release = acquireLock(dir);
  const { server, listen } = createWorkstationServer(ws, { host: arg("--host", "127.0.0.1"), port: Number(arg("--port", DEFAULT_PORT)) });
  const started = await listen();
  const s = summary(ws);
  console.log(`Reader Phase 2 labeling workstation (labeler: ${labeler})\n  open:    ${started.url}\n  labels:  ${path.join(dir, FILES.labels)}\n  progress: ${s.committed} / ${s.total} committed, ${s.remaining} remaining\n  stop:    Ctrl+C\nLabel blind: consult no legacy, teacher or model answer while judging.`);
  const stop = () => { release(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("exit", release);
}
if (require.main === module) main().catch((e) => { console.error(e.message ?? e); process.exit(1); });

module.exports = { WORKSTATION_VERSION, DEFAULT_DIR, FILES, OUTCOMES, DEFAULT_LABELER, LOOPBACK_HOSTS, installEgressGuard, assertLoopbackHost, isIgnoredOrOutsideRepo, viewOfRender, grammarReference, easyReference, checkDraft, WorkstationError, loadWorkstation, itemStatus, summary, itemPayload, check, commit, validateWorkstation, buildInputPack, writePrepared, prepare, validateFull, classifyValidation, runValidate, LabelFileError, frozenCensus, createWorkstationServer, acquireLock, atomicWrite, CLIENT_HTML };
