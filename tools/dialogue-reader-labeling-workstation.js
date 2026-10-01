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
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:8px 14px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}
header b{font-size:16px}.pill{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:13px;color:var(--dim)}.pill strong{color:var(--text)}
.banner{background:#3a2d12;color:#f6d796;border-bottom:1px solid #6b5420;padding:6px 14px;font-size:13px}
main{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px;padding:14px;max-width:1500px;margin:0 auto}
@media(max-width:980px){main{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card h2{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.sayline{font-size:24px;line-height:1.3;margin:2px 0 6px;word-break:break-word}.meta{color:var(--dim);font:12px var(--mono);word-break:break-all}
.row{display:grid;grid-template-columns:170px 1fr;gap:8px;padding:4px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}.row .k{color:var(--dim);font-size:12px}.row .v{font:13px var(--mono);word-break:break-word;white-space:pre-wrap}
.tok{display:inline-flex;margin:2px 4px 2px 0;border:1px solid var(--line);border-radius:6px;overflow:hidden;font:13px var(--mono)}.tok i{background:var(--panel2);padding:1px 6px;color:var(--accent);font-style:normal}.tok span{padding:1px 7px}
button,select,input,textarea{font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
button{cursor:pointer}button:hover:not(:disabled){border-color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}
button.primary{background:#23407a;border-color:#3b66c4}button.danger{background:#5a2330;border-color:#923a4c}
.outcomes{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px}.outcomes label{display:flex;gap:6px;align-items:center;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);cursor:pointer}.outcomes label.sel{border-color:var(--accent);background:#1e2e4d}
textarea{width:100%;font:15px var(--mono);min-height:84px;resize:vertical}input[type=text]{width:100%}
.hl{font:14px var(--mono);margin:6px 0;padding:6px 8px;border:1px dashed var(--line);border-radius:8px;min-height:30px;word-break:break-word}.hl .sp{color:#ffcf6b}.hl .fc{color:#7fdcbc}.hl .ad{color:#ff9ac1}.hl .rl{color:#8fb7ff}.hl .tg{color:#c3a4ff}.hl .sep{color:var(--dim)}
.probs{margin:6px 0;padding:0;list-style:none}.probs li{border-left:3px solid var(--bad);background:#2b1a1e;padding:4px 8px;margin:4px 0;border-radius:4px;font-size:13px}.probs li.good{border-color:var(--ok);background:#15281d}
.state{display:inline-block;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600}.state.committed{background:#14331f;color:var(--ok)}.state.uncommitted{background:#33290f;color:var(--warn)}.state.blocked{background:#3a1820;color:var(--bad)}.state.draft{background:#1d2c47;color:var(--accent)}
details{margin-top:10px}summary{cursor:pointer;color:var(--dim)}pre{white-space:pre-wrap;font:12px var(--mono);color:var(--dim);margin:6px 0}
table.g{border-collapse:collapse;font-size:13px;margin:4px 0}table.g td{border-top:1px solid var(--line);padding:2px 10px 2px 0;vertical-align:top}table.g td:first-child{font-family:var(--mono);color:var(--accent);white-space:nowrap}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.lab{font-size:12px;color:var(--dim);display:block;margin:8px 0 3px}.ro{background:#1a2230;border:1px solid #2b3a57;border-radius:8px;padding:8px 10px;font:14px var(--mono);white-space:pre-wrap;word-break:break-word}
.msg{font-size:13px;color:var(--dim);margin-top:6px}.hide{display:none}.grow{flex:1}.jumpin{width:130px}.gap{margin-top:14px}textarea.short{min-height:60px}
</style></head><body>
<header><b>Reader Phase 2 · human primary labeling</b>
 <span class="pill">item <strong id="hN">-</strong> / <strong id="hT">-</strong></span>
 <span class="pill">committed <strong id="hC">-</strong></span><span class="pill">remaining <strong id="hR">-</strong></span><span class="pill" id="hB">blocked <strong>0</strong></span>
 <span class="pill">labeler <strong id="hL">-</strong></span>
 <span class="grow"></span>
 <button id="bPrev" title="Alt+J">&larr; Prev</button><button id="bNext" title="Alt+K">Next &rarr;</button><button id="bNextOpen" title="Alt+U">Next uncommitted</button>
 <input id="jump" type="text" placeholder="# or rg-id" class="jumpin"><button id="bJump">Go</button><button id="bValidate">Validate file</button>
</header>
<div class="banner">Label BLIND: do not consult any legacy reader answer, teacher output, model output or review while judging. This tool shows none of them and suggests nothing. Committing here writes a HUMAN_PRIMARY row to the local label file (not a git commit).</div>
<main>
 <section>
  <div class="card"><h2>What the player said</h2><div class="sayline" id="say">-</div><div id="tokens"></div><div class="meta" id="meta"></div>
   <div class="actions"><button id="bCopy">Copy render text</button><span class="msg" id="copyMsg"></span></div></div>
  <div class="card gap"><h2>Observer-safe context (exactly what the worksheet carries)</h2><div id="ctx"></div>
   <details><summary>Raw render text</summary><pre id="raw"></pre></details></div>
 </section>
 <section>
  <div class="card"><h2>Your judgment <span id="stateBadge" class="state uncommitted">uncommitted</span></h2>
   <div id="committedBox" class="hide"></div>
   <div id="form">
    <div class="outcomes" role="radiogroup" aria-label="Outcome">
     <label id="oA"><input type="radio" name="outcome" value="ACCEPT"> A &middot; ACCEPT</label>
     <label id="oB"><input type="radio" name="outcome" value="EXPECTED_CLARIFY"> B &middot; EXPECTED_CLARIFY</label></div>
    <div class="msg" id="outHint">No outcome is selected. Choose one; nothing is preselected.</div>
    <div id="wireBox" class="hide"><label class="lab" for="wire">Wire (you write it; never prefilled)</label><textarea id="wire" aria-label="Wire (you write it; never prefilled)" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" placeholder=""></textarea><div class="hl" id="hl"></div></div>
    <div id="ecBox" class="hide"><span class="lab">Ambiguous field (required)</span><select id="ecField"></select><span class="lab">Clarification slot (required)</span><select id="ecSlot"></select><span class="lab">Note (optional)</span><input id="ecNote" type="text"></div>
    <span class="lab">Your notes (optional; record any concern or uncertainty here)</span><input id="notes" type="text">
    <ul class="probs" id="probs"></ul>
    <div class="actions"><button id="bCommit" class="primary" disabled>Commit primary</button><button id="bCommitNext" class="primary" disabled>Commit &amp; next uncommitted</button><button id="bCancelEdit" class="hide">Cancel edit</button></div>
    <div class="msg" id="actMsg"></div>
   </div>
  </div>
  <div class="card gap"><h2>Reference</h2>
   <details><summary>Wire grammar (static, generic)</summary><div id="grammar"></div></details>
   <details><summary>Field definitions (the frozen system text)</summary><pre id="defs"></pre></details>
   <details><summary>Keyboard</summary><div class="msg">Alt+J prev · Alt+K next · Alt+U next uncommitted · Ctrl/Cmd+Enter commits only when an outcome is chosen and the draft validates. There is no shortcut that chooses an outcome.</div></details>
  </div>
 </section>
</main>
<script nonce="__NONCE__">
"use strict";
const TOKEN=document.querySelector('meta[name=ws-token]').content;
const $=(id)=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(props)){if(k==='class')e.className=v;else e[k]=v;}for(const kid of kids)e.append(kid);return e;};
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'x-ws-token':TOKEN,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json();}catch{}if(!r.ok){const e=new Error(j.message||j.error||String(r.status));e.payload=j;e.status=r.status;throw e;}return j;}
const S={sum:null,item:null,drafts:new Map(),editing:new Set(),check:null,defs:null,checkSeq:0,timer:null};
/*PURE-BEGIN*/
const blank=()=>({outcome:null,wire:'',field:'',slot:'',note:'',notes:''});
// Which draft fields each outcome owns. An explicit outcome change drops every field the new outcome does not own (it never moves, copies or infers content between outcomes).
const LEGAL={ACCEPT:['outcome','wire','notes'],EXPECTED_CLARIFY:['outcome','wire','notes','field','slot','note']};
const retainLegal=(d)=>{const keep=LEGAL[d.outcome]||['outcome'];const b=blank();for(const k of Object.keys(b))if(!keep.includes(k))d[k]=b[k];return d;};
const chooseOutcome=(d,outcome)=>{d.outcome=outcome;return retainLegal(d);};
// What the page sends for validation / commit: only fields the chosen outcome owns, so what the form shows and what is validated cannot disagree.
const collectDraft=(d)=>{const o={outcome:d.outcome,wire:d.wire,notes:d.notes};if(d.outcome==='EXPECTED_CLARIFY')o.expected_clarify={field:d.field,slot:d.slot,note:d.note};return o;};
/*PURE-END*/
const draftOf=()=>{const id=S.item.id;if(!S.drafts.has(id))S.drafts.set(id,blank());return S.drafts.get(id);};
const editing=()=>S.editing.has(S.item.id);
// A form is open only for an uncommitted item, or for a committed / void-label item the human has deliberately chosen to (re)judge.
const isOpen=()=>S.item&&(S.item.status.state==='uncommitted'||editing());
const GROUPS=[['line','What the player said'],['people','People'],['typed','Typed in the line'],['scene','Things in play'],['discourse','Conversation state'],['heard','Heard coworker lines'],['other','Other']];
function renderHeader(){const s=S.sum;$('hT').textContent=s.total;$('hC').textContent=s.committed;$('hR').textContent=s.remaining;$('hL').textContent=s.labeler;$('hB').textContent='blocked '+s.blocked;}
function renderItem(){
 const it=S.item;$('hN').textContent=it.n;
 const line=it.view.find(v=>v.key==='line');$('say').textContent=line?line.text:'';
 const tk=it.view.find(v=>v.key==='tokens');const tw=$('tokens');tw.textContent='';
 if(tk&&tk.tokens)for(const t of tk.tokens)tw.append(el('span',{class:'tok'},el('i',{},String(t.i)),el('span',{},t.text)));
 $('meta').textContent=it.id+'  ·  render '+it.render_digest.slice(0,16);
 const ctx=$('ctx');ctx.textContent='';
 for(const[g,title]of GROUPS){if(g==='line')continue;const rows=it.view.filter(v=>v.group===g);if(!rows.length)continue;ctx.append(el('div',{class:'meta'},title));for(const r of rows)ctx.append(el('div',{class:'row'},el('div',{class:'k'},r.title),el('div',{class:'v'},r.text)));}
 const rd=it.view.find(v=>v.key==='read_as');if(rd){ctx.prepend(el('div',{class:'row'},el('div',{class:'k'},rd.title),el('div',{class:'v'},rd.text)));}
 $('raw').textContent=it.render_user;
 renderJudgment();
}
function startEdit(prefill){const it=S.item;const L=prefill?it.label:null;S.drafts.set(it.id,L?{outcome:L.gold_outcome,wire:L.gold_wire||'',field:L.expected_clarify?L.expected_clarify.field:'',slot:L.expected_clarify?L.expected_clarify.slot:'',note:L.expected_clarify&&L.expected_clarify.note?L.expected_clarify.note:'',notes:L.notes||''}:blank());S.editing.add(it.id);renderJudgment();runCheck();}
function renderJudgment(){
 const it=S.item,st=it.status,d=draftOf(),open=isOpen();
 const badge=$('stateBadge');let cls=st.state,label=st.state;
 if(editing()){cls='draft';label=st.state==='committed'?'editing a committed judgment':'relabeling (the saved label is void)';}
 else if(st.state==='uncommitted'&&(d.outcome||d.wire||d.field||d.slot)){cls='draft';label='draft (not committed)';}
 else if(st.state==='committed')label='committed '+st.committed_at;
 badge.className='state '+cls;badge.textContent=label;
 const cb=$('committedBox');cb.textContent='';cb.className=(st.state==='uncommitted'||editing())?'hide':'';
 if(st.state==='blocked'&&!editing()){
  cb.append(el('div',{class:'ro'},'BLOCKED (fail closed): '+st.reason+'\n\nThis item is NOT counted as labeled.'));
  if(st.committed_at){const b=el('button',{class:'danger'},'Relabel this render…');b.onclick=()=>startEdit(false);cb.append(el('div',{class:'actions'},b));}
 }else if(st.state==='committed'&&!editing()){
  const Lb=it.label;let t='Outcome: '+Lb.gold_outcome;if(Lb.gold_wire)t+='\nWire: '+Lb.gold_wire;
  if(Lb.expected_clarify)t+='\nExpected clarify: field='+Lb.expected_clarify.field+' slot='+Lb.expected_clarify.slot+(Lb.expected_clarify.note?'\nNote: '+Lb.expected_clarify.note:'');
  if(Lb.notes)t+='\nNotes: '+Lb.notes;t+='\nCommitted: '+Lb.committed_at;
  const b=el('button',{class:'danger'},'Edit / recommit…');b.onclick=()=>startEdit(true);cb.append(el('div',{class:'ro'},t),el('div',{class:'actions'},b));
 }
 $('form').className=open?'':'hide';
 for(const r of document.querySelectorAll('input[name=outcome]')){r.checked=d.outcome===r.value;r.disabled=!open;r.parentElement.classList.toggle('sel',d.outcome===r.value);}
 $('outHint').textContent=d.outcome?'':'No outcome is selected. Choose one; nothing is preselected.';
 $('wireBox').className=d.outcome?'':'hide';
 $('ecBox').className=d.outcome==='EXPECTED_CLARIFY'?'':'hide';
 if($('wire').value!==d.wire)$('wire').value=d.wire;
 $('ecField').value=d.field;$('ecSlot').value=d.slot;$('ecNote').value=d.note;$('notes').value=d.notes;
 $('bCancelEdit').className=editing()?'':'hide';
 renderHighlight();renderProblems();
}
function renderHighlight(){const h=$('hl');h.textContent='';const w=draftOf().wire;if(!w){h.append(el('span',{class:'sep'},'(your wire, highlighted as you type)'));return;}
 w.split(' ; ').forEach((seg,i)=>{if(i)h.append(el('span',{class:'sep'},' ; '));seg.split(' ').forEach((f,j)=>{if(j)h.append(' ');const c=['sp','fc','ad','rl'][j]||'tg';h.append(el('span',{class:c},f));});});}
function renderProblems(){const ul=$('probs');ul.textContent='';const d=draftOf();const c=S.check;
 const can=!!(c&&c.ok&&d.outcome&&isOpen());
 if(!d.outcome){ul.append(el('li',{},'Choose an outcome.'));}
 else if(c&&!c.ok){for(const p of c.problems)ul.append(el('li',{},(p.layer+' '+p.code+(p.act!=null?' (act '+(p.act+1)+')':'')+(p.field?' ['+p.field+']':'')+': ')+p.message));}
 else if(c&&c.ok)ul.append(el('li',{class:'good'},'Valid against the observer-safe checks (syntax, legal labels, surface). Resolver-level validation happens after commit.'));
 $('bCommit').disabled=!can;$('bCommitNext').disabled=!can;
}
function collect(){return collectDraft(draftOf());}
async function runCheck(){const it=S.item;const d=draftOf();if(!d.outcome){S.check=null;renderProblems();return;}const seq=++S.checkSeq;try{const c=await api('/api/check',{id:it.id,draft:collect()});if(seq===S.checkSeq&&S.item.id===it.id){S.check=c;renderProblems();}}catch(e){S.check={ok:false,problems:[{layer:'CLIENT',code:'check_failed',message:e.message}]};renderProblems();}}
function schedule(){S.check=null;clearTimeout(S.timer);renderProblems();S.timer=setTimeout(runCheck,180);}
async function load(ref){const q=typeof ref==='number'?'n='+ref:'id='+encodeURIComponent(ref);try{S.item=await api('/api/item?'+q);S.check=null;$('actMsg').textContent='';renderItem();if(isOpen())runCheck();}catch(e){$('actMsg').textContent=e.message;}}
async function refreshSummary(){S.sum=await api('/api/state');renderHeader();}
function nextOpen(from){const o=S.sum.order;for(let k=1;k<=o.length;k++){const x=o[(from-1+k)%o.length];if(x.state!=='committed')return x.n;}return null;}
async function commit(andNext){const it=S.item;const d=draftOf();if(!d.outcome){$('actMsg').textContent='Choose an outcome first.';return;}
 const edit=S.editing.has(it.id);if(edit&&!confirm('Recommit item '+it.n+'? Your previous committed judgment is kept in the journal; this replaces the current label.'))return;
 try{const r=await api('/api/commit',{id:it.id,draft:collect(),explicit:true,replace:edit,previous_committed_at:edit?it.status.committed_at:null});S.drafts.delete(it.id);S.editing.delete(it.id);S.sum=r.summary;renderHeader();$('actMsg').textContent='Committed '+r.committed_at+'.';
  if(andNext){const n=nextOpen(it.n);if(n)return load(n);}await load(it.n);$('actMsg').textContent='Committed '+r.committed_at+'.';}catch(e){const p=e.payload&&e.payload.problems;S.check=p?{ok:false,problems:p}:S.check;renderProblems();$('actMsg').textContent='Not committed: '+e.message;}}
function bind(){
 for(const r of document.querySelectorAll('input[name=outcome]'))r.addEventListener('change',()=>{chooseOutcome(draftOf(),r.value);renderJudgment();schedule();});
 $('wire').addEventListener('input',()=>{draftOf().wire=$('wire').value;renderHighlight();schedule();});
 $('ecField').addEventListener('change',()=>{draftOf().field=$('ecField').value;schedule();});$('ecSlot').addEventListener('change',()=>{draftOf().slot=$('ecSlot').value;schedule();});
 $('ecNote').addEventListener('input',()=>{draftOf().note=$('ecNote').value;schedule();});$('notes').addEventListener('input',()=>{draftOf().notes=$('notes').value;schedule();});
 $('bCommit').onclick=()=>commit(false);$('bCommitNext').onclick=()=>commit(true);
 $('bCancelEdit').onclick=()=>{S.drafts.delete(S.item.id);S.editing.delete(S.item.id);S.check=null;renderJudgment();};
 $('bPrev').onclick=()=>load(Math.max(1,S.item.n-1));$('bNext').onclick=()=>load(Math.min(S.sum.total,S.item.n+1));
 $('bNextOpen').onclick=()=>{const n=nextOpen(S.item.n);if(n)load(n);else $('actMsg').textContent='Every item is committed.';};
 const go=()=>{const v=$('jump').value.trim();if(!v)return;load(/^\d+$/.test(v)?Number(v):v);};$('bJump').onclick=go;$('jump').addEventListener('keydown',(e)=>{if(e.key==='Enter')go();});
 $('bCopy').onclick=async()=>{try{await navigator.clipboard.writeText(S.item.render_user);$('copyMsg').textContent='copied';}catch{$('copyMsg').textContent='copy failed';}setTimeout(()=>$('copyMsg').textContent='',1500);};
 $('bValidate').onclick=async()=>{try{const v=await api('/api/validate');alert('Observer-safe whole-file validation\n\ncommitted '+v.committed+' / '+v.total+'\nproblems '+v.problems.length+(v.problems.length?'\n'+v.problems.slice(0,12).map(p=>'#'+p.n+' '+p.problem).join('\n'):'')+'\n\nResolver-level validation (existing validator): node tools/dialogue-reader-labeling-workstation.js --validate-full');}catch(e){alert(e.message);}};
 document.addEventListener('keydown',(e)=>{if(e.altKey&&e.code==='KeyJ'){e.preventDefault();$('bPrev').click();}else if(e.altKey&&e.code==='KeyK'){e.preventDefault();$('bNext').click();}else if(e.altKey&&e.code==='KeyU'){e.preventDefault();$('bNextOpen').click();}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(!$('bCommit').disabled&&draftOf().outcome)$('bCommit').click();}});
}
async function init(){
 const [defs,gram]=await Promise.all([api('/api/definitions'),api('/api/grammar')]);S.defs=defs;$('defs').textContent=defs.system_text;
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

module.exports = { WORKSTATION_VERSION, DEFAULT_DIR, FILES, OUTCOMES, DEFAULT_LABELER, LOOPBACK_HOSTS, installEgressGuard, assertLoopbackHost, isIgnoredOrOutsideRepo, viewOfRender, grammarReference, checkDraft, WorkstationError, loadWorkstation, itemStatus, summary, itemPayload, check, commit, validateWorkstation, buildInputPack, writePrepared, prepare, validateFull, classifyValidation, runValidate, LabelFileError, frozenCensus, createWorkstationServer, acquireLock, atomicWrite, CLIENT_HTML };
