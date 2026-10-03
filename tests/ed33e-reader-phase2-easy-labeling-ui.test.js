"use strict";

// Reader Phase 2 -- EASY LABELING UI (the default interface of tools/dialogue-reader-labeling-workstation.js).
// PRESENTATION / ERGONOMICS ONLY. The page may translate the already-authorized observer-safe render into plain English
// and deterministically SERIALIZE the human's explicit selections into the existing wire syntax. It may never examine the
// player's line to choose, suggest, rank or default any meaning. These tests use SYNTHETIC items and temporary directories
// only: no real item is labeled, no model runs and no network request is made.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const RI = require("../tools/dialogue-reader-input");
const R = require("../tools/dialogue-reader-render");
const RP = require("../tools/dialogue-reader-replay");
const W = require("../tools/dialogue-reader-wire");
const RF = require("../tools/dialogue-reader-frame");
const L = require("../tools/dialogue-reader-labels");
const E = require("../tools/dialogue-eval");
const WS = require("../tools/dialogue-reader-labeling-workstation");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "tools", "dialogue-reader-labeling-workstation.js");
const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const DUFFLE = "q4-startup-materials-duffle-01";
const SENTINELS = Object.freeze(["SENTINEL_LEGACY_WIRE", "SENTINEL_PRODUCTION_FACET", "SENTINEL_CANONICAL_STATE", "SENTINEL_BINDING_ID", "SENTINEL_CONTEXT_PERSON", "SENTINEL_TEACHER_OUTPUT"]);

function convState({ anchors = [] } = {}) {
  const requests = [{ request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: DUFFLE }, turns_since: 0 }];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-2", predicate: "item.contents", request_text: "Tonya, what's in the duffle?", args: { item_id: DUFFLE } }, pending_requests: [], activity: null, surface_anchors: anchors, pending_inbound_request: null, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
/** A captured-shape development item with answer-bearing sentinels in every code-side field. */
function item(raw, id, { previous = null, heard = null } = {}) {
  const anchors = heard ? [{ event_id: "ev-1", speaker_id: TONYA, spans: [{ text: heard, request_id: "req-2", predicate: "item.contents" }] }] : [];
  const { ledger, snapshot } = convState({ anchors });
  const discourse = previous ? { last_turn: { player_text: previous, responses: [] } } : null;
  const built = RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities: sc.entities, snapshot, ledger, discourse });
  return {
    id, stratum: "j15", fixture: "t", provider: "garbage", request_id: id, text: raw, target: null, context_dependent: false, context_available: true,
    input: built.input, bindings: { ...built.bindings, sentinel: "SENTINEL_BINDING_ID" },
    context: { snapshot, ledger, present: sc.present.map((p) => ({ id: p.id })), canonical: { secret: "SENTINEL_CANONICAL_STATE", person: "SENTINEL_CONTEXT_PERSON" } },
    names: { x: "SENTINEL_CONTEXT_PERSON" }, l0: { frame: { legacy_wire: "SENTINEL_LEGACY_WIRE" }, conversion_exact: true }, production: { responders: ["SENTINEL_PRODUCTION_FACET"], facet: "SENTINEL_PRODUCTION_FACET" }, teacher: "SENTINEL_TEACHER_OUTPUT"
  };
}
const renderOf = (it) => R.renderReaderPrompt(it.input).user;
const groupsOf = (lines) => RP.renderGroups(lines.map((l, i) => item(l, `t#garbage#${i + 1}`)));
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "reader-easy-ui-test-"));
const prepared = (gs) => { const dir = tmpdir(); WS.writePrepared({ dir, groups: gs }); return dir; };
const openWs = (dir) => { let n = 0; return WS.loadWorkstation({ dir, clock: () => `2026-10-01T10:00:0${(n += 1)}.000Z` }); };
const labelsOf = (dir) => (fs.existsSync(path.join(dir, WS.FILES.labels)) ? fs.readFileSync(path.join(dir, WS.FILES.labels), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ─── the page's pure logic, exactly as shipped (the PURE block of the client script) ─────────────────
const HTML = WS.CLIENT_HTML;
const PURE = HTML.slice(HTML.indexOf("/*PURE-BEGIN*/"), HTML.indexOf("/*PURE-END*/"));
const UI = new Function(`${PURE}; return { blankAct, blankEasy, blank, retainLegal, chooseOutcome, missingEasy, serializeEasy, serializeAct, collectDraft, effectiveWire, enterRaw, canReturnToEasy, returnToEasy, parseRender, facetGlosses, humanRows, describeLabel, targetLabels, ABCODE, ecPartIndex, effectiveAb, stepsOf, stepDone, firstOpenStep, summaryLines, answerText, pictureOf, releaseStaleFocus };`)();
const GLOSS = UI.facetGlosses(R.SYSTEM_TEXT);
const outer = (name, text) => { const i = text.indexOf(name); assert.ok(i >= 0, `${name} exists in the page`); return i; };
/** The source text of one top-level function / const of the client script. */
function clientFn(name) {
  const js = HTML.slice(HTML.indexOf("<script nonce"));
  const start = js.search(new RegExp(`(?:async )?function ${name}\\(|const ${name}=`));
  assert.ok(start >= 0, `client defines ${name}`);
  const rest = js.slice(start);
  const next = rest.slice(10).search(/\n(?:async function |function |const |\/\*PURE)/);
  return next < 0 ? rest : rest.slice(0, next + 10);
}
/** A draft with the human's explicit Easy selections (what the human would click). */
function pick(outcome, act = {}, extra = {}) {
  const d = UI.blank();
  UI.chooseOutcome(d, outcome);
  Object.assign(d.easy.acts[0], act);
  Object.assign(d, extra);
  return d;
}
const ASK = { speech: "ask", facet: "contents", addr: "named", names: ["n1"], rel: "new" };

// ─── A-C: the default page hides the machinery ───────────────────────────────────────────────────────
function detailsBlock(id) {
  const open = HTML.indexOf(`<details`, HTML.lastIndexOf("\n", HTML.indexOf(`id="${id}"`)));
  const startTag = HTML.slice(HTML.lastIndexOf("<details", HTML.indexOf(`id="${id}"`)), HTML.indexOf(">", HTML.indexOf(`id="${id}"`)) + 1);
  const from = HTML.indexOf(startTag);
  assert.ok(from >= 0 && open >= 0, `${id} is a <details> block`);
  // matching close: details nest, so count
  let depth = 0; let i = from;
  const re = /<details\b|<\/details>/g; re.lastIndex = from;
  for (let m = re.exec(HTML); m; m = re.exec(HTML)) { depth += m[0] === "</details>" ? -1 : 1; if (depth === 0) { i = m.index + m[0].length; break; } }
  return { startTag, text: HTML.slice(from, i), from, to: i };
}
test("A. Token indices live only inside the collapsed Technical details; the default page shows none", () => {
  const tech = detailsBlock("techBox");
  assert.ok(!/\bopen\b/.test(tech.startTag), "Technical details is collapsed by default");
  assert.ok(tech.text.includes('id="tokens"') && tech.text.includes('id="meta"') && tech.text.includes('id="raw"'), "tokens, render id/digest and raw render text are kept (collapsed)");
  const outsideTech = HTML.slice(0, tech.from) + HTML.slice(tech.to);
  assert.ok(!outsideTech.includes('id="tokens"') && !outsideTech.includes('id="raw"') && !outsideTech.includes('id="meta"') && !outsideTech.includes('id="ctx"'));
  // the plain-English context never prints token indices, p/n/e/r labels as the subject of a row, or the raw encoding
  const it = item("Ask Tonya.", "t#1");
  const rows = UI.humanRows(UI.parseRender(renderOf(it)), GLOSS);
  assert.ok(rows.length >= 4);
  for (const r of rows) assert.ok(!/\b\d+:\S/.test(r.text), `no index:text token pairs in a context row: ${r.text}`);
  assert.ok(!rows.some((r) => /^tokens?$/i.test(r.title)));
});
test("B. The raw wire editor is inside the collapsed Advanced / Raw labeling section, not the default page", () => {
  const adv = detailsBlock("advanced");
  assert.ok(!/\bopen\b/.test(adv.startTag), "Advanced is collapsed by default");
  assert.match(adv.text, /Advanced \/ Raw labeling/);
  assert.ok(adv.text.includes('<textarea id="wire"'), "the audited raw wire editor is available");
  const outside = HTML.slice(0, adv.from) + HTML.slice(adv.to);
  assert.ok(!outside.includes('<textarea id="wire"') && !outside.includes('id="hl"'), "no raw wire editor outside Advanced");
  assert.ok(adv.text.includes('id="rawBox" class="hide"'), "the raw editor is hidden until the human chooses to use it for the item");
});
test("C. The raw ambiguity enum is not on the default page; the Easy form offers readable descriptions with the machine name secondary", () => {
  const adv = detailsBlock("advanced");
  const outside = HTML.slice(0, adv.from) + HTML.slice(adv.to);
  assert.ok(!outside.includes('id="ecField"') && !outside.includes('id="ecSlot"'), "the raw field / slot selects live only in Advanced");
  const ref = WS.easyReference();
  for (const f of L.CLARIFY_FIELDS) { assert.ok(typeof ref.unclear[f] === "string" && ref.unclear[f].length > 12 && ref.unclear[f] !== f, `${f} has a readable description`); }
  for (const s of L.CLARIFY_SLOTS) assert.ok(typeof ref.slot[s] === "string" && ref.slot[s] !== s);
  assert.deepEqual(Object.keys(ref.unclear), L.CLARIFY_FIELDS, "exactly the existing fields, in the existing order");
  assert.deepEqual(Object.keys(ref.slot), L.CLARIFY_SLOTS, "exactly the existing slots");
  assert.match(clientFn("stepControls"), /\{v:f,t:E\.unclear\[f\],s:f\}/, "title = readable text, machine value secondary");
  assert.match(clientFn("stepControls"), /\{v:k,t:E\.slot\[k\],s:k\}/);
  // nothing is preselected: the chip groups are driven by the (empty) draft
  assert.deepEqual([UI.blank().field, UI.blank().slot], ["", ""]);
});

// ─── D, E: the utterance is prominent; context is readable and adds nothing ─────────────────────────
test("D. The current utterance is the first and largest thing on the page", () => {
  assert.ok(outer('id="say"', HTML) < outer('id="know"', HTML) && outer('id="say"', HTML) < outer('id="form"', HTML));
  const size = Number(/\.sayline\{font-size:(\d+)px/.exec(HTML)[1]);
  assert.ok(size >= 28, `utterance font ${size}px`);
  const others = [...HTML.slice(0, HTML.indexOf("</style>")).matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n !== size);
  assert.ok(Math.max(...others) < size, "nothing on the page is larger than the utterance");
  assert.match(HTML, /<h2>Player said<\/h2><div class="sayline" id="say">/);
});
test("E. Context is plain English wherever the render itself carries the mapping, and unmapped identifiers stay as they are", () => {
  // The owner's examples, as renders: labels translate through the render's own "people:" line only.
  const render = [
    "line: Morning team.", "tokens: 0:Morning 1:team.", "people: p1 Giselle, p2 Malcolm, p3 Tonya", "player chose to speak to: p3",
    "names typed: n1 \"Tonya\"@2=p3, n2 \"Dana\"@3=not here", "things typed: e1 \"the duffle\"@4=item-x, e2 \"stuff\"@5 unclear",
    "things: r1 \"the duffle\" item mentioned; r2 \"the Complex\" place last asked about", "place in talk: the Complex", "\"it/that/there\" may be: r1 r2", "talking with: p3",
    "q1: asked contents to p3; answered by p3 (latest)", "i1: p3 asked the player (expeditions), wants yes no", "v1: round expeditions; done p1+p2; left p3",
    "c1: the player said NOT tired about p3 (open)", "player's previous line: \"Hi team.\"", "heard a1 p3 re q1: \"Morning.\""
  ].join("\n");
  const P = UI.parseRender(render);
  assert.deepEqual(P.other, [], "every line of the render is understood");
  const rows = UI.humanRows(P, GLOSS);
  const text = rows.map((r) => `${r.title}: ${r.text}`).join("\n");
  assert.match(text, /People present: Giselle, Malcolm, Tonya/);
  assert.match(text, /A coworker is waiting for your answer: Tonya asked you about: been on an expedition before \(expeditions\)\. They want: yes no/);
  assert.match(text, /You previously said: “Hi team\.”/);
  assert.match(text, /Heard: Tonya said “Morning\.” \(about request q1\)/);
  assert.match(text, /Earlier request: You asked what is inside an item \(contents\), of Tonya; answered by Tonya/);
  assert.match(text, /Name typed in the line: “Tonya” at word 3, matching Tonya/);
  assert.match(text, /a person who is not present/);
  assert.match(text, /Activity round: been on an expedition before \(expeditions\)\. Done: Giselle, Malcolm\. Left: Tonya/);
  assert.match(text, /You said NOT tired \(tired\) about Tonya/);
  assert.match(text, /Currently talking with: Tonya/);
  assert.doesNotMatch(text, /\bp[123]\b(?!\))/, "no raw person label survives where the render maps it");
  // a label the render does not map is retained, never guessed
  const odd = UI.humanRows(UI.parseRender("line: x\npeople: p1 Giselle\ntalking with: p9\nq1: asked mystery to p9; open"), GLOSS).map((r) => r.text).join("|");
  assert.match(odd, /p9/);
  assert.match(odd, /mystery/);
  // real renders from the production renderer parse completely and say nothing the render does not
  const variants = [item("Ask Tonya.", "a"), item("Tell Malcolm!", "b", { previous: "Hi team.", heard: "Morning." }), item("what's in it?", "c", { previous: "Hello.", heard: "It holds startup materials." })];
  for (const v of variants) {
    const user = renderOf(v);
    const parsed = UI.parseRender(user);
    assert.deepEqual(parsed.other, [], `unparsed render line in: ${user}`);
    assert.equal(parsed.line, v.text);
    const shown = UI.humanRows(parsed, GLOSS).map((r) => `${r.title} ${r.text}`).join(" ").toLowerCase();
    const allowed = new Set([...user.toLowerCase().match(/[a-z0-9']+/g), ...R.SYSTEM_TEXT.toLowerCase().match(/[a-z0-9']+/g)]);
    // the fixed vocabulary of the translation templates (function words only; no content word)
    const TEMPLATE = new Set(("people present chosen in the interface where message is delivered name typed line at word matching thing unclear which possessive things that may be referred to place being talked about it there mean currently talking with earlier request you asked of answered by most recent a coworker waiting for your answer asked about they want options just question activity round done left nobody your claim said not someone previously heard about and or an is not who whom nothing something list ask").split(" "));
    const extra = [...new Set(shown.match(/[a-z0-9']+/g))].filter((w) => !allowed.has(w) && !TEMPLATE.has(w));
    assert.deepEqual(extra, [], `the plain-English context introduced words absent from the authorized render: ${extra.join(", ")}`);
  }
  // the translation reads only the render text and the (static) frozen system gloss table
  assert.ok(!/legacy|production|canonical|bindings|teacher/i.test(clientFn("humanRows") + clientFn("parseRender")));
});

// ─── F, G: two judgments, nothing preselected ────────────────────────────────────────────────────────
test("F. Exactly two primary judgment choices, in plain words with the formal name secondary", () => {
  const radios = [...HTML.matchAll(/<input type="radio" name="outcome" value="([^"]+)">(.*?)<\/label>/g)];
  assert.deepEqual(radios.map((m) => m[1]), ["ACCEPT", "EXPECTED_CLARIFY"]);
  assert.match(radios[0][2], /I understand what the player means.*ACCEPT/);
  assert.match(radios[1][2], /Something important is unclear.*EXPECTED_CLARIFY/);
  assert.ok(!/UNLABELABLE/.test(HTML));
  assert.ok(!/>\s*YES\b|>\s*NO\b/.test(HTML.slice(HTML.indexOf('class="choices"'), HTML.indexOf('id="outHint"'))), "no bare YES/NO that could be read as answering the player's sentence");
});
test("G. Neither judgment is preselected, in the page source or in a fresh draft", () => {
  for (const r of HTML.matchAll(/<input type="radio"[^>]*>/g)) assert.ok(!/\bchecked\b/.test(r[0]));
  assert.equal(UI.blank().outcome, null);
  assert.match(HTML, /No outcome is selected\. Choose one; nothing is preselected\./);
  assert.equal(UI.missingEasy(UI.blank())[0], "your judgment");
});

// ─── H, I, J: the builder is a form that serializes explicit selections ───────────────────────────────
test("H. No Easy semantic value is ever preselected: every fresh act field is empty and every required choice is reported missing", () => {
  const a = UI.blankAct();
  for (const [k, v] of Object.entries(a)) assert.ok(v === "" || (Array.isArray(v) && v.length === 0), `${k} starts empty`);
  assert.equal(UI.blank().easy.acts.length, 1);
  assert.deepEqual(UI.missingEasy(pick("ACCEPT")), ["what the player is doing", "what it asks about or claims", "whom the words address", "whether the words point back to earlier talk"]);
  assert.deepEqual(UI.missingEasy(pick("EXPECTED_CLARIFY")).slice(-2), ["what is unclear", "what kind of clarification"]);
  // the builder never assigns a value on its own: no radio is checked / select value set from anything but the draft
  const build = ["stepControls", "detailsControls", "previewControls", "chipGroup", "selectBox", "checkList"].map(clientFn).join("\n");
  assert.ok(!/checked=true|\.checked=!0|selected=true|\.value='[^']+'|\.value="[^"]+"/.test(build), "no control is given a value except from the draft");
  assert.match(clientFn("chipGroup"), /r\.checked=cur===o\.v/);
  assert.match(clientFn("selectBox"), /s\.value=cur/);
  // the label lists are static or read from the render's own labels, never ranked: the facet order is the frozen table's order
  assert.deepEqual(WS.easyReference().facets.map((f) => f.id), Object.keys(W.FACET_CODES));
});
test("I. The generated wire is empty until Jack has made every required choice", () => {
  const d = pick("ACCEPT");
  assert.equal(UI.serializeEasy(d).wire, "");
  for (const partial of [{ speech: "ask" }, { speech: "ask", facet: "contents" }, { speech: "ask", facet: "contents", addr: "none" }, { speech: "ask", facet: "contents", addr: "named", rel: "new" }, { speech: "ask", facet: "contents", addr: "none", rel: "cont" }]) {
    const p = pick("ACCEPT", partial);
    assert.equal(UI.serializeEasy(p).wire, "", `still incomplete: ${JSON.stringify(partial)}`);
    assert.ok(UI.serializeEasy(p).missing.length > 0);
  }
  assert.equal(UI.serializeEasy(pick("ACCEPT", ASK)).wire, "ask contents @n1 new");
  // clarify: the wire exists only once the unclear field and slot are chosen too
  assert.equal(UI.serializeEasy(pick("EXPECTED_CLARIFY", ASK)).wire, "");
  assert.equal(UI.serializeEasy(pick("EXPECTED_CLARIFY", ASK, { field: "address" })).wire, "");
  assert.equal(UI.serializeEasy(pick("EXPECTED_CLARIFY", ASK, { field: "address", slot: "person" })).wire, "ask contents @n1 new ab=address");
  // a collected draft carries an empty wire (so the server refuses it) until then
  assert.equal(UI.collectDraft(pick("ACCEPT")).wire, "");
});
test("J. The generated wire is a deterministic function of the explicit selections, in the existing grammar", () => {
  const cases = [
    [{ speech: "greet", facet: "-", addr: "all", rel: "new" }, "greet - all new"],
    [{ speech: "ack", facet: "-", addr: "none", rel: "end", target: "none" }, "ack - - end"],
    [{ speech: "ack", facet: "-", addr: "none", rel: "end", target: "v1" }, "ack - - end:v1"],
    [{ speech: "ask", facet: "contents", addr: "named", names: ["n1"], rel: "new", qform: "wh", refc: "r1", refspan: "e1" }, "ask contents @n1 new f=wh r=e1>r1"],
    [{ speech: "ask", facet: "?", addr: "you", rel: "cont", target: "q1", time: "now", respm: "any" }, "ask ? you cont:q1 t=now m=any"],
    [{ speech: "answer", facet: "expeditions", addr: "none", rel: "reply", target: "i1", ia: "ans", iaopt: "yes" }, "answer expeditions - reply:i1 ia=ans:yes"],
    [{ speech: "state", facet: "tired", addr: "except", names: ["n2", "n1"], rel: "new", subj: "named", subjnames: ["n2", "n1"], pol: "neg" }, "state tired except@n1+n2 new pol=neg s=named:n1+n2"],
    [{ speech: "repair", facet: "contents", addr: "none", rel: "fix", target: "q1", rk: "what", refc: "unsure" }, "repair contents - fix:q1 rk=what r=unsure"],
    [{ speech: "ask", facet: "contents", addr: "none", rel: "new", ab: ["temporal", "force"], extra: " sp=0-1  n=2 " }, "ask contents - new ab=force+time sp=0-1 n=2"]
  ];
  for (const [sel, wire] of cases) {
    const d = pick("ACCEPT", sel);
    assert.equal(UI.serializeEasy(d).wire, wire);
    assert.equal(UI.serializeEasy(JSON.parse(JSON.stringify(d))).wire, wire, "a pure function of the selections");
    const dec = W.decodeWire(wire, item("Ask Tonya.", "x").input);
    assert.equal(dec.ok, true, `the existing parser decodes ${wire}: ${JSON.stringify(dec.errors)}`);
  }
  // order of clicking never matters; two parts get "at=" from the human's explicit start word
  const d = pick("ACCEPT", { speech: "greet", facet: "-", addr: "all", rel: "new" });
  d.easy.acts.push({ ...UI.blankAct(), speech: "ask", facet: "contents", addr: "none", rel: "new", start: "1" });
  assert.equal(UI.serializeEasy(d).wire, "greet - all new ; ask contents - new at=1");
  assert.equal(W.decodeWire(UI.serializeEasy(d).wire, item("Hello. Ask.", "y").input).ok, true);
  d.easy.acts[1].start = "";
  assert.equal(UI.serializeEasy(d).wire, "", "a second part needs its explicit start word");
  // the clarification field is attached to the part the human chose, only when the field is a wire field
  const ec = pick("EXPECTED_CLARIFY", ASK, { field: "referent", slot: "referent" });
  assert.equal(UI.serializeEasy(ec).wire, "ask contents @n1 new ab=referent");
  assert.equal(UI.serializeEasy(pick("EXPECTED_CLARIFY", ASK, { field: "discourse_state", slot: "topic" })).wire, "ask contents @n1 new", "discourse_state is not a wire field: nothing is added");
  const two = pick("EXPECTED_CLARIFY", ASK, { field: "address", slot: "person" });
  two.easy.acts.push({ ...UI.blankAct(), speech: "ack", facet: "-", addr: "none", rel: "new", start: "3" });
  assert.ok(UI.missingEasy(two).includes("which part it is unclear in"), "with several parts the human must say which part");
  two.ecPart = "1";
  assert.equal(UI.serializeEasy(two).wire, "ask contents @n1 new ; ack - - new at=3 ab=address");
  // every wire code the form can emit is a code of the frozen tables
  const ref = WS.easyReference();
  assert.deepEqual(ref.speech.map((s) => s.code).sort(), Object.values(W.SPEECH).sort());
  assert.deepEqual(ref.relation.map((r) => r.code).sort(), Object.values(W.RELATION).sort());
  assert.deepEqual(ref.facets.map((f) => f.code).sort(), Object.values(W.FACET_CODES).sort());
  assert.deepEqual(ref.facet_special.map((f) => f.code).sort(), Object.values(W.FACET_SPECIAL_CODES).sort());
  assert.deepEqual(ref.address.map((a) => a.kind).sort(), ["all", "except", "named", "none", "others", "you"]);
  const keys = (obj) => Object.keys(obj).sort();
  const O = ref.optional; const T = W.WIRE_TABLES;
  assert.deepEqual(keys(O.qform.values), Object.values(T.QFORM).sort());
  assert.deepEqual(keys(O.pol.values), Object.values(T.POLARITY).sort());
  assert.deepEqual(keys(O.time.values), Object.values(T.TEMPORAL).sort());
  assert.deepEqual(keys(O.respm.values), Object.values(T.MODE).sort());
  assert.deepEqual(keys(O.subj.values), Object.values(T.SUBJECT).sort());
  assert.deepEqual(keys(O.ia.values), Object.values(T.INBOUND_KIND).filter((v) => v !== "none").sort());
  assert.deepEqual(keys(O.ia.options), Object.values(T.OPTION_SPECIAL).sort());
  assert.deepEqual(keys(O.rk.values), Object.values(T.REPAIR).sort());
  assert.deepEqual(keys(O.refc.special), Object.values(T.REF_SPECIAL).sort());
  assert.deepEqual(UI.ABCODE, ref.abstain_code);
  assert.deepEqual(Object.values(ref.abstain_code).sort(), Object.values(T.ABSTAIN).sort());
});

// ─── K-M: the adversarial anti-suggestion tests ───────────────────────────────────────────────────────
test("K. No sentence parsing or heuristic recommendation influences the Easy form (source-level and behavioural)", () => {
  // the serializer and the draft logic take no render input at all
  for (const name of ["serializeEasy", "serializeAct", "missingEasy", "effectiveAb", "ecPartIndex", "collectDraft", "effectiveWire", "chooseOutcome", "retainLegal", "blank", "blankAct", "enterRaw", "canReturnToEasy", "returnToEasy", "stepsOf", "stepDone", "firstOpenStep"]) {
    const src = clientFn(name);
    assert.ok(!/\bP\b\s*[.[]|render_user|S\.item|S\.P|\.line\b|\.prev\b|\.readAs|\.heard|\.text\b|toLowerCase|\.match\(|\.test\(|\.search\(|new RegExp|includes\(\s*['"][a-z]/.test(src.replace(/\.test\(\s*String\(l\)\)/g, "")), `${name} must not read the player's line or any render field`);
  }
  assert.equal(UI.serializeEasy.length, 1, "serializeEasy takes exactly the draft");
  // the builder UI reads the render only to LIST labels / names / words as options; it never reads the line, the previous line or heard text to choose anything
  const builder = ["stepControls", "detailsControls", "previewControls", "renderEasy"].map(clientFn).join("\n");
  assert.ok(!/P\.line|P\.prev|P\.readAs|\.heard\b|render_user|\.text\.(?:match|test|toLowerCase|indexOf|includes)|toLowerCase|similar|score|rank|sort\(|likely|recommend|suggest|default|guess|heuristic/i.test(builder), "no inference, ranking, scoring or recommendation vocabulary in the builder");
  // the only sort in the pure block orders typed-name LABELS numerically for a canonical wire
  assert.deepEqual([...PURE.matchAll(/\.sort\(/g)].length, 1);
  assert.match(clientFn("sortLabels"), /labelNum\(x\)-labelNum\(y\)/);
});
test("L. Holding the human's Easy selections constant, changing the utterance, names, verbs, punctuation, pronouns, previous line or heard line never changes the generated wire or any selection", () => {
  const selections = { speech: "request", facet: "contents", addr: "none", rel: "new" };
  const lines = [["Ask Tonya.", {}], ["Ask Malcolm.", {}], ["Tell Tonya.", {}], ["Tell Malcolm.", {}], ["Ask Tonya", {}], ["Ask Tonya?", {}], ["ask tonya!!", {}], ["Ask him.", {}], ["Ask her about it?", { previous: "Ask Malcolm." }], ["Tell Tonya.", { previous: "Tell Malcolm.", heard: "Ask Giselle." }], ["Hello everyone.", { heard: "Tonya, ask Malcolm." }], ["what's in it?", {}], ["Tonya, what's in the duffle?", { previous: "Ask Tonya." }]];
  const wires = new Set(); const renders = new Set();
  for (const [line, extra] of lines) {
    const it = item(line, `t#${line}`, extra);
    renders.add(renderOf(it));
    const d = pick("ACCEPT", selections); // the human holds the same form selections for every item
    const before = JSON.stringify(d);
    UI.parseRender(renderOf(it)); // the page reads the render for display...
    UI.humanRows(UI.parseRender(renderOf(it)), GLOSS);
    assert.equal(JSON.stringify(d), before, "...and no selection moves");
    wires.add(UI.serializeEasy(d).wire);
    assert.deepEqual(UI.missingEasy(UI.blank()).length, 1, "a fresh draft is still blank for every item");
  }
  assert.ok(renders.size >= lines.length - 2, "the renders really differ (names, verbs, punctuation, previous and heard lines)");
  assert.deepEqual([...wires], ["request contents - new"], "one wire for every utterance");
  // an explicitly selected typed name is the one legitimate dependence: the human picks a label the render itself lists
  const names = (line) => UI.parseRender(renderOf(item(line, "n"))).names.map((n) => `${n.label}:${n.text}`);
  assert.notDeepEqual(names("Ask Tonya."), names("Ask Malcolm."), "the page lists different observer-safe names for different lines");
  assert.equal(UI.serializeEasy(pick("ACCEPT", { ...selections, addr: "named", names: ["n1"] })).wire, "request contents @n1 new", "...but choosing it is Jack's act; the wire carries only the label he clicked");
  // an item whose line literally contains the name still starts with nothing chosen
  assert.equal(UI.blank().easy.acts[0].addr, "");
  assert.equal(UI.blank().easy.acts[0].names.length, 0);
});
test("M. No prior human label, similarity or previous item influences the builder", () => {
  const gs = groupsOf(["Ask Tonya.", "Tell Malcolm.", "Hello everyone."]);
  const dir = prepared(gs);
  const ws = openWs(dir);
  const refBefore = JSON.stringify(WS.easyReference());
  const second = gs[1];
  const payloadBefore = JSON.stringify(WS.itemPayload(ws, second.id));
  WS.commit(ws, gs[0].id, { outcome: "ACCEPT", wire: "request contents - new" }, { explicit: true });
  assert.equal(JSON.stringify(WS.easyReference()), refBefore, "committing a label changes nothing in the Easy reference");
  assert.equal(JSON.stringify(WS.itemPayload(ws, second.id)), payloadBefore, "another item's payload is unchanged by a committed label");
  assert.equal(JSON.stringify(UI.blank()), JSON.stringify(UI.blank()));
  assert.ok(!/drafts|labels|committed|previous|history|localStorage|similar/i.test(["blank", "blankAct", "blankEasy"].map(clientFn).join("\n")), "a fresh draft is built from nothing");
  // the item payload never carries a label for an uncommitted item, so there is nothing for the form to copy
  assert.equal(WS.itemPayload(ws, second.id).label, null);
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(HTML));
  // loading an item discards nothing and prefills nothing: the draft map is only written by explicit actions
  assert.match(clientFn("draftOf"), /S\.drafts\.set\(id,blank\(\)\)/);
});


// ─── progressive disclosure: sentence -> context picture -> one decision -> one question -> next question -> preview ─────
test("PD1. The Easy form asks ONE question at a time, in a fixed order that depends only on the draft", () => {
  assert.ok(!HTML.includes('id="acts"') && !HTML.includes('id="bAddAct"'), "no all-at-once form container on the page");
  assert.ok(HTML.includes('id="stepCard"') && HTML.includes('id="answers"'));
  const blankAccept = pick("ACCEPT");
  assert.deepEqual(UI.stepsOf(blankAccept), ["speech:0", "facet:0", "addr:0", "rel:0", "preview"]);
  assert.deepEqual(UI.stepsOf(pick("EXPECTED_CLARIFY")), ["ecfield", "ecslot", "speech:0", "facet:0", "addr:0", "rel:0", "preview"]);
  assert.equal(UI.firstOpenStep(blankAccept), "speech:0", "the first question is the first unanswered one");
  assert.equal(UI.firstOpenStep(pick("EXPECTED_CLARIFY")), "ecfield");
  const part2 = pick("ACCEPT", ASK);
  part2.easy.acts.push({ ...UI.blankAct() });
  assert.deepEqual(UI.stepsOf(part2).slice(4), ["start:1", "speech:1", "facet:1", "addr:1", "rel:1", "preview"]);
  const ecMulti = pick("EXPECTED_CLARIFY", ASK, { field: "address" });
  ecMulti.easy.acts.push({ ...UI.blankAct() });
  assert.ok(UI.stepsOf(ecMulti).includes("ecpart") && !UI.stepsOf(pick("EXPECTED_CLARIFY", ASK, { field: "discourse_state" })).includes("ecpart"));
  // answering moves forward; the sequence never reads the render
  assert.equal(UI.firstOpenStep(pick("ACCEPT", { speech: "ask" })), "facet:0");
  assert.equal(UI.firstOpenStep(pick("ACCEPT", { speech: "ask", facet: "contents", addr: "named" })), "addr:0", "a named address still needs the name chosen");
  assert.equal(UI.firstOpenStep(pick("ACCEPT", ASK)), "preview", "optional details are never a required question");
  // a step is done exactly when its required choices are made, and the preview is reachable exactly when nothing is missing
  const drafts = [pick("ACCEPT"), pick("ACCEPT", { speech: "ask" }), pick("ACCEPT", ASK), pick("ACCEPT", { ...ASK, rel: "cont" }), pick("ACCEPT", { ...ASK, rel: "cont", target: "q1" }), pick("EXPECTED_CLARIFY", ASK), pick("EXPECTED_CLARIFY", ASK, { field: "address", slot: "person" }), ecMulti, part2];
  for (const d of drafts) {
    const steps = UI.stepsOf(d);
    const allDone = steps.filter((x) => x !== "preview").every((x) => UI.stepDone(d, x));
    assert.equal(allDone, UI.missingEasy(d).length === 0, `missing list and step completion agree for ${JSON.stringify(d.easy.acts.map((a) => a.speech))}`);
    assert.equal(UI.stepDone(d, "preview"), UI.missingEasy(d).length === 0);
  }
  // the sequence and the readers of it never look at the player's line
  for (const name of ["stepsOf", "stepDone", "firstOpenStep"]) assert.ok(!/\bP\b|render_user|\.line\b|\.text\b/.test(clientFn(name)), name);
  // the page shows exactly one question card, pins the step it shows, and answers advance by one question
  assert.match(clientFn("renderEasy"), /S\.step\.set\(S\.item\.id,cur\)/);
  assert.equal([...clientFn("renderEasy").matchAll(/class:'qtext'/g)].length, 1, "one question text per render");
  assert.match(clientFn("stepControls"), /advance\(\)/);
  assert.match(clientFn("advance"), /Math\.min\(steps\.length-1,i\+1\)/);
});
test("PD2. The question is plain English; the Reader term is only a secondary annotation, and every Easy answer reads as a person would say it", () => {
  const Q = WS.easyReference().questions;
  const JARGON = /\b(speech act|facet|address|relation|abstain|abstention|referent|temporal|polarity|inbound|respondent|span|slot|act|enum)\b/i;
  for (const [k, v] of Object.entries(Q)) {
    assert.ok(typeof v.q === "string" && v.q.length > 6, k);
    // "address" is allowed only as the plain verb about the player's words ("the words address ..."), never as the Reader term
    const q = v.q.replace(/\bwords (?:directly )?address\b/g, "words speak");
    assert.ok(!JARGON.test(q), `the question for ${k} must not use Reader vocabulary: ${v.q}`);
    if (k !== "preview") assert.ok(v.term && v.term !== v.q, `${k} carries the technical term as an annotation`);
  }
  assert.equal(Q.addr.q, "Do the player's words directly address anyone?");
  assert.equal(Q.addr.term, "address");
  assert.equal(Q.speech.q, "What is the player doing with {part}?");
  // the term is rendered smaller, dimmer and after the question
  assert.match(HTML, /\.qtext\{font-size:22px/);
  assert.match(HTML, /\.term\{font:12px var\(--mono\);color:var\(--dim\)/);
  const render = clientFn("renderEasy");
  assert.ok(render.indexOf("class:'qtext'") < render.indexOf("class:'term'"));
  // option and summary text never leaks wire notation as the thing a person reads
  const d = pick("EXPECTED_CLARIFY", { ...ASK, qform: "wh", refc: "r1", refspan: "e1", ab: ["force"] }, { field: "address", slot: "person" });
  const P = UI.parseRender(renderOf(item("Ask Tonya.", "s")));
  const lines = UI.summaryLines(d, WS.easyReference(), P, GLOSS);
  const text = lines.map((l) => `${l.title} ${l.text}`).join("\n");
  assert.ok(lines.length >= 7);
  assert.doesNotMatch(text, /@n\d|\bab=|\bf=|\br=e\d|\bn1\b|=>|\bnew\b.*\bcont\b/);
  assert.match(text, /Addressed by name in the words: “Tonya”/);
  assert.match(text, /Something important is unclear/);
  const ref = WS.easyReference();
  for (const s of ref.speech) assert.ok(s.label !== s.code && /[a-z]{4}/.test(s.label), `${s.code} has a readable label`);
  for (const r of ref.relation) assert.ok(r.label.length > 15, r.code);
});
test("PD3. The context is a picture: people, the earlier conversation as bubbles, and things in play, drawn only from the authorized render", () => {
  const render = ["line: Morning team.", "tokens: 0:Morning 1:team.", "people: p1 Giselle, p2 Malcolm, p3 Tonya", "player chose to speak to: p3", "names typed: n1 \"Tonya\"@2=p3", "things: r1 \"the duffle\" item mentioned", "place in talk: the Complex", "talking with: p3", "q1: asked contents to p3; answered by p3 (latest)", "i1: p3 asked the player (expeditions), wants yes no", "player's previous line: \"Hi team.\"", "heard a1 p3 re q1: \"Morning.\""].join("\n");
  const pic = UI.pictureOf(UI.parseRender(render), GLOSS);
  assert.deepEqual(pic.people.map((p) => p.name), ["Giselle", "Malcolm", "Tonya"]);
  // person badges are plain: no flag, class, outline or dash marks any person (the facts are plain text, below)
  for (const person of pic.people) assert.deepEqual(Object.keys(person).sort(), ["label", "name", "talking"], "a badge carries no highlight flag");
  assert.ok(!/\.person\.(?:named|deliv)|\.named\b|\.deliv\b|dashed\s*=|outlined\s*=/.test(HTML.slice(0, HTML.indexOf("</style>")) + clientFn("renderItem")), "no outline / dash style or legend for badges");
  assert.match(clientFn("renderItem"), /el\('span',\{class:'person'\}/, "a badge's only class is 'person'");
  const tagText = (kind) => pic.tags.filter((t) => t.kind === kind).map((t) => t.text);
  assert.deepEqual(tagText("Name typed"), ["\u201cTonya\u201d (word 3), matching Tonya"], "the typed-name match is retained as text");
  assert.deepEqual(tagText("Delivered to (interface choice)"), ["Tonya \u00b7 not part of the player\u2019s words"], "the delivery target is retained as text, and says it is not the player's words");
  const bubble = (who, re) => pic.bubbles.find((b) => b.who === who && re.test(b.text));
  assert.ok(bubble("Tonya", /Morning\./) && bubble("Tonya", /Morning\./).side === "them");
  assert.ok(bubble("You", /Hi team\./) && bubble("You", /Hi team\./).side === "you");
  assert.ok(bubble("Tonya", /asked you about: been on an expedition before/), "the waiting question is a bubble from Tonya");
  assert.ok(bubble("You", /asked what is inside an item/));
  assert.ok(pic.tags.some((t) => t.kind === "Name typed") && pic.tags.some((t) => t.kind === "Place" && t.text === "the Complex"));
  // nothing else: every word the picture shows is in the render, the frozen system glosses, or the fixed template vocabulary
  const shown = [...pic.people.map((p) => p.name), ...pic.bubbles.flatMap((b) => [b.who, b.text, b.note]), ...pic.tags.flatMap((t) => [t.kind, t.text])].join(" ").toLowerCase();
  const allowed = new Set([...render.toLowerCase().match(/[a-z0-9']+/g), ...R.SYSTEM_TEXT.toLowerCase().match(/[a-z0-9']+/g)]);
  const TEMPLATE = new Set("you asked of answered by most recent just answered s question said not about someone waiting for your answer wants options previous line round done left nobody a coworker name typed word thing could be meant place it that may mean other matching delivered to interface choice not part of the player words".split(" "));
  const extra = [...new Set(shown.match(/[a-z0-9']+/g))].filter((w) => !allowed.has(w) && !TEMPLATE.has(w));
  assert.deepEqual(extra, [], `the picture introduced words absent from the authorized render: ${extra.join(", ")}`);
  // the picture is built from the parsed render only: no legacy / hidden field name anywhere in its code
  assert.ok(!/legacy|production|canonical|bindings|teacher/i.test(clientFn("pictureOf")));
  // and for real renders every line is understood, so nothing falls into an unexplained "Other"
  for (const [line, extra2] of [["Ask Tonya.", {}], ["Tell Malcolm!", { previous: "Hi team.", heard: "Morning." }]]) assert.deepEqual(UI.pictureOf(UI.parseRender(renderOf(item(line, "z", extra2))), GLOSS).tags.filter((t) => t.kind === "Other"), []);
});
test("PD4. The preview shows the human's own answers in plain words; the wire stays secondary and collapsed", () => {
  assert.match(HTML, /<details id="genBox" class="hide"><summary>Generated Reader wire<\/summary>/, "the wire preview is collapsed and hidden until the preview step");
  assert.match(clientFn("renderEasy"), /\$\('genBox'\)\.className=cur==='preview'\?'':'hide'/);
  const d = pick("ACCEPT", ASK);
  const lines = UI.summaryLines(d, WS.easyReference(), UI.parseRender(renderOf(item("Ask Tonya.", "p"))), GLOSS);
  assert.deepEqual(lines.map((l) => l.title), ["Your judgment", "The player is", "Asking about / claiming", "The words address", "The words point back to"]);
  assert.ok(!lines.some((l) => /ask contents|@n1/.test(l.text)), "the wire is not the preview");
  // an incomplete form previews only what was answered, and never fills a gap
  const partial = UI.summaryLines(pick("ACCEPT", { speech: "ask" }), WS.easyReference(), UI.parseRender(renderOf(item("Ask Tonya.", "q"))), GLOSS);
  assert.deepEqual(partial.map((l) => l.title), ["Your judgment", "The player is"]);
  // answered questions are echoed as small pills that jump back; unanswered ones are never invented
  assert.equal(UI.answerText(pick("ACCEPT", { speech: "ask" }), "facet:0", WS.easyReference(), UI.parseRender("line: x"), GLOSS), "");
  assert.match(UI.answerText(pick("ACCEPT", { speech: "ask" }), "speech:0", WS.easyReference(), UI.parseRender("line: x"), GLOSS), /Asking a question/);
});

// ─── "make it easy": fewer, simpler decisions ────────────────────────────────────────────────────────
test("PD5. Each question is small: grouped speech acts with generic examples, a two-level topic picker, and a plain yes/no before any relation detail", () => {
  const ref = WS.easyReference();
  // speech acts: grouped headings, short readable labels, invented generic examples that never come from an item
  const groups = [...new Set(ref.speech.map((s) => s.group))];
  assert.deepEqual(groups, ["Being social", "Saying something", "Asking", "Following up"]);
  assert.ok(ref.speech.filter((s) => s.example).length >= 10);
  const lineTexts = groupsOf(["Ask Tonya.", "Tell Malcolm.", "Hello everyone.", "Okay, that's that.", "Tonya, what's in the duffle?"]).map((g) => g.item.text.toLowerCase().replace(/[^a-z' ]/g, ""));
  for (const s of ref.speech) for (const t of lineTexts) assert.ok(!s.example.toLowerCase().replace(/[^a-z' ]/g, "").includes(t) || !s.example, `an example must not be an item's text: ${s.example}`);
  assert.match(clientFn("stepControls"), /Examples are invented and generic; they are not about this line\./);
  // the examples for "ack" and "more" are synthetic and equal no frozen player line (the old "Okay." / "And you?" / "How about you?" matched or nearly matched real lines; R2-H checks near-collisions)
  assert.equal(ref.speech.find((x) => x.code === "ack").example, "\u201cAlright, noted.\u201d");
  assert.equal(ref.speech.find((x) => x.code === "more").example, "\u201cAlso on weekends?\u201d");
  const norm = (t) => t.toLowerCase().replace(/[\u201c\u201d]/g, "").replace(/[^a-z' ]/g, "").replace(/\s+/g, " ").trim();
  const frozenSheet = path.join(WS.DEFAULT_DIR, WS.FILES.worksheet); // the local, gitignored blank worksheet (474 frozen lines) when present
  if (fs.existsSync(frozenSheet)) {
    const frozenRows = fs.readFileSync(frozenSheet, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "item");
    assert.equal(frozenRows.length, 474, "the frozen worksheet has its 474 lines");
    const frozen = new Set(frozenRows.map((r) => norm((/^line: (.*)$/m.exec(r.render_user) || [])[1] || "")));
    for (const x of ref.speech) if (x.example) assert.ok(!frozen.has(norm(x.example)), `example ${x.example} must not equal a frozen player line`);
  }
  // topic: families first, then only that family's items, never one long dropdown
  const fams = {}; for (const f of ref.facets) (fams[f.group] = fams[f.group] || []).push(f.code);
  assert.ok(Object.keys(fams).length >= 6 && Math.max(...Object.values(fams).map((a) => a.length)) <= 20, "no topic family is a wall of choices");
  const facetStep = clientFn("stepControls");
  assert.match(facetStep, /chipGroup\('facetgroup'\+i/);
  assert.match(facetStep, /chipGroup\('facet'\+i,byGroup\[grp\]/);
  assert.ok(!/selectBox\(groups,a\.facet/.test(facetStep), "the 48-item dropdown is gone");
  // relation: a plain yes/no first; the eight kinds appear only after "yes"
  assert.match(facetStep, /chipGroup\('relyes'\+i,\[\{v:'no'[^\]]*\},\{v:'yes'[^\]]*\}\]/);
  assert.match(facetStep, /if\(yes\)\{/);
  assert.match(ref.relation.find((r) => r.code === "new").label, /^No /);
  for (const r of ref.relation.filter((x) => x.code !== "new")) assert.match(r.label, /^The words /, `${r.code} reads as a sentence about the player's words`);
  // the optional extras live in the final check (collapsed), not as another question on every item
  assert.ok(!UI.stepsOf(pick("ACCEPT")).some((x) => x.startsWith("more")));
  assert.match(clientFn("previewControls"), /Add a detail \(optional \\u2014 most lines need none\)/);
  assert.match(clientFn("previewControls"), /class:'extras'/);
  // and the common path is short: four questions plus the check
  assert.equal(UI.stepsOf(pick("ACCEPT")).length, 5);
  // the ambiguity descriptions stay short and plain
  for (const t of Object.values(ref.unclear)) assert.ok(t.length <= 70, t);
});

// ─── the earlier-conversation candidate order is pinned to the documented structure ─────────────────────
test("PD6. Earlier-item candidates keep the documented structural order: earlier requests, i1, i0, v1, c1, heard sentences, then earlier parts of this line; reversed, sorted, ranked or otherwise reordered lists fail", () => {
  const head = ["line: x", "tokens: 0:x", "people: p1 Giselle, p2 Malcolm, p3 Tonya"];
  // within a category the order is the RENDER's own listing order: q2 is listed before q1, a2 before a1 (deliberately not sorted)
  const Q = ["q2: asked holder to p2; open", "q1: asked contents to p3; answered by p3 (latest)"];
  const I1 = "i1: p3 asked the player (expeditions), wants yes no";
  const I0 = "i0: the player just answered p3";
  const V1 = "v1: round expeditions; done p1+p2; left p3";
  const C1 = "c1: the player said NOT tired about p3 (open)";
  const A = ["heard a2 p3 re q1: \"Two.\"", "heard a1 p2: \"One.\""];
  const build = (lines) => UI.parseRender([...head, ...lines].join("\n"));
  const EXPECTED = ["q2", "q1", "i1", "i0", "v1", "c1", "a2", "a1"];
  // the documented order, whatever order the render's lines (or categories) are written in
  const arrangements = [[...Q, I1, I0, V1, C1, ...A], [...A, C1, V1, I0, I1, ...Q], [C1, A[0], Q[0], V1, I1, A[1], Q[1], I0], [I0, ...A, ...Q, C1, I1, V1]];
  for (const lines of arrangements) assert.deepEqual(UI.targetLabels(build(lines), 0), EXPECTED, `structural order for: ${lines.join(" / ")}`);
  assert.deepEqual(UI.targetLabels(build(arrangements[0]), 2), [...EXPECTED, "s0", "s1"], "earlier parts of the same line come last, in part order");
  assert.deepEqual(UI.targetLabels(build(arrangements[0]), 1), [...EXPECTED, "s0"]);
  // within a category: the render's own listing order, never numeric / alphabetical / latest-first
  assert.deepEqual(UI.targetLabels(build([Q[1], Q[0]]), 0), ["q1", "q2"], "q's follow the render listing (q1 listed first here)");
  assert.deepEqual(UI.targetLabels(build(Q), 0), ["q2", "q1"]);
  assert.deepEqual(UI.targetLabels(build([A[1], A[0]]), 0), ["a1", "a2"]);
  // an absent category is skipped; the rest keep their order
  assert.deepEqual(UI.targetLabels(build([...A, C1, ...Q]), 0), ["q2", "q1", "c1", "a2", "a1"]);
  assert.deepEqual(UI.targetLabels(build([]), 0), []);
  // the order depends on structure only: changing what the items say, who said it, the facets and the states changes nothing
  const reworded = [Q[0].replace("holder", "purpose").replace("open", "answered by p1"), Q[1].replace("contents", "route").replace("(latest)", ""), "i1: p1 asked the player (route), wants a choice", "i0: the player just answered p2", "v1: round route; done p3; left p1+p2", "c1: the player said tired about p1 (closed)", "heard a2 p1: \"Zebra.\"", "heard a1 p3 re q2: \"Apple.\""];
  assert.deepEqual(UI.targetLabels(build(reworded), 0), EXPECTED, "content, speakers and states never reorder the list");
  // real renders from the production renderer: the same structure
  assert.deepEqual(UI.targetLabels(UI.parseRender(renderOf(item("Ask Tonya.", "o1"))), 0), ["q1"]);
  assert.deepEqual(UI.targetLabels(UI.parseRender(renderOf(item("Tell Malcolm!", "o2", { previous: "Hi team.", heard: "Morning." }))), 0), ["q1", "a1"]);
  // the pin can fail: every plausible re-ordering differs from it
  const alt = { reversed: [...EXPECTED].reverse(), sorted: [...EXPECTED].sort(), "heard first": ["a2", "a1", "q2", "q1", "i1", "i0", "v1", "c1"], "latest/numeric first": ["q1", "q2", "i1", "i0", "v1", "c1", "a1", "a2"], "waiting question first": ["i1", "q2", "q1", "i0", "v1", "c1", "a2", "a1"] };
  for (const [name, order] of Object.entries(alt)) assert.notDeepEqual(order, EXPECTED, `${name} must differ from the pinned order`);
  // the source cannot reorder, rank or filter on the way to the page
  const fn = clientFn("targetLabels");
  assert.ok(!/\.sort\(|\.reverse\(|\.filter\(|\.slice\(|\.splice\(|localeCompare|Math\.random|\.indexOf\(|reduce\(/.test(fn), "targetLabels only appends in the documented order");
  const opts = clientFn("targetOptions");
  assert.match(opts, /targetLabels\(P,i\)\.map\(/);
  assert.ok(!/\.sort\(|\.reverse\(|\.filter\(|\.slice\(|\.splice\(/.test(opts), "targetOptions preserves the order");
  const controls = clientFn("stepControls");
  assert.equal([...controls.matchAll(/opts\.unshift\(/g)].length, 1, "the only reordering is the explicit 'Nothing is open' choice added first for an optional-target relation");
  assert.match(controls, /if\(rel\.target==='optional'\)opts\.unshift\(\{v:'none',t:'Nothing is open \(no target\)'\}\)/);
});

// ─── RED repair 2: words-only address and relation, no carried highlight, no display-code seeding, no near-colliding examples ─────
/** Top-level client definitions, so a test can say which function a piece of source lives in. */
function clientChunks() {
  const js = HTML.slice(HTML.indexOf("<script nonce"));
  const starts = [...js.matchAll(/\n(?:async function |function |const )([A-Za-z_$][\w$]*)/g)].map((m) => ({ name: m[1], i: m.index }));
  const owner = (i) => { let n = "(top level)"; for (const s of starts) if (s.i <= i) n = s.name; return n; };
  return { js, owner };
}
const EASY_TEXT = () => JSON.stringify(WS.easyReference()) + HTML;
test("R2-A. Address asks about the player's WORDS only (frozen ADDRESS + Conventions B and C), in plain English", () => {
  const ref = WS.easyReference();
  const Q = ref.questions;
  assert.equal(Q.addr.q, "Do the player's words directly address anyone?");
  assert.match(Q.addr.hint, /^Use only the player's words here\. The interface delivery choice does not decide this answer/);
  assert.match(Q.addr.hint, /a name the player only talks about is not addressed/);
  const A = Object.fromEntries(ref.address.map((x) => [x.kind, x.label]));
  assert.deepEqual(Object.keys(A), ["none", "named", "all", "others", "except", "you"], "exactly the frozen address kinds, in order");
  assert.equal(A.none, "Nobody — the words do not address anyone", "'-' means nobody is addressed in the words, not 'no one in particular'");
  assert.match(A.named, /the words name and speak to \(not just talk about\)/, "a name talked ABOUT is not an address");
  assert.match(A.all, /the words are said to everyone/, "Convention C: all only when the words are said to everyone");
  // Convention C: an inclusive group ("we all", "all of us") is a SUBJECT, never sufficient for address = all
  const INCLUSIVE = /\bwe\b|\bus\b|we all|all of us/i;
  assert.ok(!INCLUSIVE.test(A.all), "the 'everyone' choice must not offer 'we all' / 'all of us' as address language");
  for (const [k, v] of Object.entries(A)) assert.ok(!/we all|all of us/i.test(v), `${k}: no address choice treats an inclusive group as address`);
  assert.match(ref.optional.subj.values.us, /we all/, "'we all' belongs to the subject (s=us)");
  assert.match(A.you, /the words speak to “you” without a name/);
  for (const [k, v] of Object.entries(A)) assert.match(v, /words/, `${k} is about the words`);
  assert.equal(ref.unclear.address, "Whom the player's words address");
  assert.match(Q.subj.q, /the person the words address/);
  assert.equal(ref.optional.subj.values.you, "The person the words address");
  // the old conversational wording is gone from every Easy string, the page and the preview
  assert.ok(!/speaking to|no one in particular|who is addressed|Said to \(choose|'Said to'|Someone named in the line/i.test(EASY_TEXT()), "no 'who are they speaking to' wording anywhere");
  // the step shows the reminder under the question
  assert.match(clientFn("questionOf"), /hint:q\.hint\|\|''/);
  assert.match(clientFn("renderEasy"), /if\(qi\.hint\)card\.append\(el\('div',\{class:'hint'\},qi\.hint\)\)/);
  // the wire for each kind is unchanged
  const wire = (addr, names = []) => UI.serializeEasy(pick("ACCEPT", { speech: "ask", facet: "contents", addr, names, rel: "new" })).wire.split(" ")[2];
  assert.deepEqual([wire("none"), wire("named", ["n1"]), wire("all"), wire("others"), wire("except", ["n1"]), wire("you")], ["-", "@n1", "all", "others", "except@n1", "you"]);
});
test("R2-B. The interface delivery chip cannot set, default or visually imply the Reader address", () => {
  const head = ["line: Where is it?", "tokens: 0:Where 1:is 2:it 3:?", "people: p1 Giselle, p2 Malcolm, p3 Tonya"];
  const withChip = (who) => UI.parseRender([...head, ...(who ? [`player chose to speak to: ${who}`] : []), "talking with: p3"].join("\n"));
  const renders = [withChip(null), withChip("p3"), withChip("p1")];
  // a fresh draft is blank whatever the chip; the same explicit selections give the same wire whatever the chip
  for (const P of renders) {
    const d = UI.blank();
    UI.pictureOf(P, GLOSS); UI.humanRows(P, GLOSS); UI.targetLabels(P, 0);
    assert.equal(JSON.stringify(d), JSON.stringify(UI.blank()));
    for (const addr of ["none", "you", "all"]) assert.equal(UI.serializeEasy(pick("ACCEPT", { speech: "ask", facet: "-", addr, rel: "new" })).wire, `ask - ${addr === "none" ? "-" : addr} new`);
  }
  // person badges never change with the chip (no outline, no class, no flag)
  assert.deepEqual(UI.pictureOf(renders[1], GLOSS).people, UI.pictureOf(renders[0], GLOSS).people);
  assert.deepEqual(UI.pictureOf(renders[2], GLOSS).people, UI.pictureOf(renders[0], GLOSS).people);
  // the chip is plain text that says it is not the player's words; its wording never says address / said to / speaking to
  const tag = UI.pictureOf(renders[1], GLOSS).tags.find((t) => /interface/.test(t.kind));
  assert.deepEqual(tag, { kind: "Delivered to (interface choice)", text: "Tonya · not part of the player’s words" });
  const row = UI.humanRows(renders[1], GLOSS).find((r) => /interface/.test(r.title));
  assert.deepEqual(row, { title: "Delivered to (interface choice)", text: "Tonya · not part of the player’s words" });
  assert.ok(!/address|said to|speaking/i.test(tag.kind + tag.text + row.title + row.text));
  // only the render parser and the two display lists ever read the chip; the address step, the serializer and the draft never do
  const { js, owner } = clientChunks();
  assert.deepEqual([...new Set([...js.matchAll(/\bP\.chip\b/g)].map((m) => owner(m.index)))].sort(), ["humanRows", "parseRender", "pictureOf"]);
  assert.ok(!/\.chip\b/.test(clientFn("stepControls").replace(/chipGroup/g, "")), "the address step never reads the chip");
});
test("R2-C. Relation asks whether the player's WORDS point back (frozen RELATION + Convention D), not whether something is related", () => {
  const ref = WS.easyReference();
  const Q = ref.questions;
  for (const k of ["relyes", "rel"]) {
    assert.equal(Q[k].q, "Do the player's words point back to something said earlier?");
    assert.equal(Q[k].hint, "Choose Yes only when the words themselves point back to it, not just because it is about the same topic.");
  }
  assert.equal(ref.relation.find((r) => r.code === "new").label, "No — the words do not point back to anything earlier");
  for (const r of ref.relation.filter((x) => x.code !== "new")) assert.match(r.label, /^The words /, r.code);
  // Convention D: no relation choice is defined by topical similarity; "back" is the words returning to an earlier item
  const SIMILARITY = /same topic|similar|related|relates|in common|about the same|connected|resembl|on the same|alike/i;
  for (const r of ref.relation) assert.ok(!SIMILARITY.test(r.label), `${r.code} must not be defined by similarity`);
  assert.match(ref.relation.find((r) => r.code === "back").label, /^The words go back to /, "back: the words themselves return to it");
  assert.equal(ref.unclear.relation, "Which earlier thing the words point back to");
  const controls = clientFn("stepControls");
  assert.match(controls, /\{v:'yes',t:'Yes \\u2014 the words point back to something earlier'\}/);
  assert.match(controls, /'How do the words point back\?'/);
  assert.ok(!/connected to|connects to|How does it connect|Connects to earlier talk/i.test(EASY_TEXT()), "no 'is it connected' wording anywhere");
  // the relation kinds and their wire are unchanged
  assert.deepEqual(ref.relation.map((r) => r.code), Object.values(W.RELATION));
  assert.equal(UI.serializeEasy(pick("ACCEPT", { speech: "more", facet: "?", addr: "none", rel: "cont", target: "q1" })).wire, "more ? - cont:q1");
});
test("R2-D. Relation stays unset whatever the history: pending questions, heard lines on the same topic, a previous line, a latest request", () => {
  const head = ["tokens: 0:x", "people: p1 Giselle, p2 Malcolm, p3 Tonya"];
  const histories = [
    ["line: What's in the duffle?", "q1: asked contents to p3; answered by p3 (latest)", "heard a1 p3 re q1: \"Rope, mostly.\""],
    ["line: Yes.", "i1: p2 asked the player (expeditions), wants yes no"],
    ["line: And the crate?", "player's previous line: \"What's in the duffle?\"", "q1: asked contents to p3; open (latest)"],
    ["line: Hello.", "v1: round expeditions; done p1; left p2+p3", "c1: the player said tired about p3 (open)"],
    ["line: Hello."]
  ];
  for (const h of histories) {
    const P = UI.parseRender([h[0], ...head, ...h.slice(1)].join("\n"));
    const d = UI.blank(); UI.chooseOutcome(d, "ACCEPT");
    const before = JSON.stringify(d);
    UI.targetLabels(P, 0); UI.pictureOf(P, GLOSS); UI.humanRows(P, GLOSS);
    assert.equal(JSON.stringify(d), before, "reading the history moves nothing");
    assert.deepEqual([d.easy.acts[0].rel, d.easy.acts[0].target], ["", ""]);
    assert.equal(UI.stepDone(d, "rel:0"), false);
    assert.ok(UI.missingEasy(d).includes("whether the words point back to earlier talk"));
  }
  // the yes/no shows a choice only from the draft or the human's own click on this item
  assert.match(clientFn("stepControls"), /const yes=a\.rel!==''&&a\.rel!=='new'\|\|S\.relYes\.has\(rkey\);/);
  assert.match(clientFn("stepControls"), /const rkey=S\.item\.id\+'\|'\+i;/);
  // the UI state that decides which yes/no or topic family LOOKS chosen changes only inside the human's own click handler
  const { js } = clientChunks();
  assert.equal((js.match(/S\.relYes\.add\(/g) || []).length, 1, "'Yes' is remembered in exactly one place");
  assert.match(js, /chipGroup\('relyes'\+i,\[[^\]]*\],cur,\(v\)=>\{if\(v==='no'\)\{a\.rel='new';a\.target='';S\.relYes\.delete\(rkey\);changed\(\);advance\(\);\}else\{if\(a\.rel==='new'\)\{a\.rel='';a\.target='';\}S\.relYes\.add\(rkey\);changed\(\);\}\}/, "...and that place is the yes/no click handler");
  assert.equal((js.match(/S\.facetGroup\.set\(/g) || []).length, 1, "a topic family is remembered in exactly one place");
  assert.match(js, /chipGroup\('facetgroup'\+i,[^;]*,grp,\(v\)=>\{S\.facetGroup\.set\(fkey,v\);changed\(\);\}\)\);/, "...and that place is the family click handler");
});
/** Render the shipped topic step (the page's own el / chipGroup / stepControls) into a tiny fake DOM and report what looks chosen. */
function topicStep(P, { remembered = [], facet = "" } = {}) {
  class Node { constructor(tag) { this.tagName = tag; this.children = []; this.className = ""; } append(...k) { this.children.push(...k); } setAttribute(k, v) { this[k] = v; } addEventListener() {} }
  const S = { easy: WS.easyReference(), P, G: GLOSS, item: { id: "fresh-item" }, facetGroup: new Map(remembered), relYes: new Set(), detailOpen: new Set(), step: new Map() };
  const src = ["el", "chipGroup", "stepControls"].map(clientFn).join("\n");
  const stepControls = new Function("document", "S", "changed", "advance", "ABCODE", `${src}\nreturn stepControls;`)({ createElement: (t) => new Node(t) }, S, () => {}, () => {}, UI.ABCODE);
  const d = UI.blank(); UI.chooseOutcome(d, "ACCEPT"); d.easy.acts[0].speech = "ask"; d.easy.acts[0].facet = facet;
  const inputs = []; const selected = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.tagName === "input") inputs.push(n); if (n.tagName === "label" && / sel\b/.test(n.className)) selected.push(n); for (const k of n.children || []) walk(k); };
  walk(stepControls(d, "facet:0"));
  const family = inputs.filter((i) => i.name === "facetgroup0");
  return { families: family.length, familyChecked: family.filter((i) => i.checked).map((i) => i.value), topics: inputs.filter((i) => i.name === "facet0").length, selected: selected.length };
}
test("R2-J. A fresh topic step has no topic family selected, whatever the conversation history", () => {
  const head = ["tokens: 0:x", "people: p1 Giselle, p2 Malcolm, p3 Tonya"];
  const histories = [
    ["line: What's in it?"],
    ["line: What's in the duffle?", "q1: asked contents to p3; answered by p3 (latest)", "heard a1 p3 re q1: \"Rope, mostly.\""],
    ["line: Yes.", "i1: p2 asked the player (expeditions), wants yes no"],
    ["line: And the crate?", "player's previous line: \"What's in the duffle?\"", "q2: asked holder to p2; open", "q1: asked contents to p3; open (latest)"],
    ["line: Hello.", "v1: round expeditions; done p1; left p2+p3", "c1: the player said tired about p3 (open)"]
  ];
  for (const h of histories) {
    const r = topicStep(UI.parseRender([h[0], ...head, ...h.slice(1)].join("\n")));
    assert.ok(r.families >= 6, "the family choices are offered");
    assert.deepEqual(r.familyChecked, [], `no topic family is preselected (${h.length - 1} history line(s))`);
    assert.equal(r.selected, 0, "nothing on the topic step looks chosen");
    assert.equal(r.topics, 0, "no family's topic list is opened for the human");
  }
  // real renders from the production renderer, with a latest request and heard lines about a topic
  for (const it of [item("What's in the duffle?", "f1"), item("And that one?", "f2", { previous: "What's in the duffle?", heard: "Rope, mostly." })]) assert.deepEqual(topicStep(UI.parseRender(renderOf(it))).familyChecked, []);
  // positive controls: the probe does see a family that the human chose (click) or that follows from the human's own topic
  const P = UI.parseRender(["line: x", ...head].join("\n"));
  const clicked = topicStep(P, { remembered: [["fresh-item|0", "item"]] });
  assert.deepEqual(clicked.familyChecked, ["item"]);
  assert.ok(clicked.topics > 0 && clicked.selected === 1);
  assert.deepEqual(topicStep(P, { facet: "contents" }).familyChecked, ["item"], "the family of the human's own chosen topic");
  // and a family remembered for ANOTHER item never shows on this one
  assert.deepEqual(topicStep(P, { remembered: [["other-item|0", "item"]] }).familyChecked, []);
  // source pin: the shown family is the human's topic, else the human's click on this item, else nothing
  const src = clientFn("stepControls");
  assert.match(src, /const ownGroup=\(\(\)=>\{for\(const g of Object\.keys\(byGroup\)\)if\(byGroup\[g\]\.some\(\(x\)=>x\.v===a\.facet\)\)return g;return '';\}\)\(\);/);
  assert.match(src, /const fkey=S\.item\.id\+'\|'\+i;const grp=ownGroup\|\|S\.facetGroup\.get\(fkey\)\|\|'';/);
});
test("R2-E. A fresh item never looks chosen: no outcome is selected, focus from the previous item is released, and focus never looks like selection", () => {
  const css = HTML.slice(HTML.indexOf("<style"), HTML.indexOf("</style>"));
  // selected = accent border + fill; keyboard focus = a dashed, dim, offset ring shown only for keyboard focus (never :focus-within, never accent)
  assert.match(css, /\.choice\.sel\{border-color:var\(--accent\);background:#1e2e4d\}/);
  assert.match(css, /\.choice:has\(input:focus-visible\)\{outline:2px dashed var\(--dim\);outline-offset:3px\}/);
  assert.match(css, /\.chip\.sel\{border-color:var\(--accent\);background:#1e2e4d\}/);
  assert.match(css, /\.chip:has\(input:focus-visible\)\{outline:2px dashed var\(--dim\);outline-offset:2px\}/);
  assert.ok(!/(?:\.choice|\.chip)[^{}]*:focus[^{}]*\{[^}]*var\(--accent\)/.test(css), "no focus rule uses the selected accent");
  assert.ok(!/\.choice:focus-within|\.chip:focus-within/.test(css), "the old focus-within ring is gone");
  // stale focus on an outcome radio (or on an Easy control) is released before a new item is drawn
  const blurred = [];
  const node = (props) => ({ ...props, blur() { blurred.push(props.id); } });
  const box = { contains: (x) => !!x && x.inEasy === true };
  const page = (active) => ({ activeElement: active, getElementById: (id) => (id === "easyBox" ? box : null) });
  assert.equal(UI.releaseStaleFocus(page(node({ id: "radio-accept", name: "outcome", value: "ACCEPT" }))), true);
  assert.equal(UI.releaseStaleFocus(page(node({ id: "radio-clarify", name: "outcome", value: "EXPECTED_CLARIFY" }))), true);
  assert.equal(UI.releaseStaleFocus(page(node({ id: "easy-chip", name: "speech0", inEasy: true }))), true);
  assert.equal(UI.releaseStaleFocus(page(node({ id: "next-button", name: "" }))), false, "focus on a navigation button is left alone");
  assert.equal(UI.releaseStaleFocus(page(null)), false);
  assert.deepEqual(blurred, ["radio-accept", "radio-clarify", "easy-chip"]);
  // every item load goes through renderItem, whose FIRST act is releasing the stale focus
  assert.match(clientFn("renderItem"), /^function renderItem\(\)\{\n releaseStaleFocus\(document\);\n/);
  assert.match(clientFn("load"), /S\.item=await api\('\/api\/item\?'\+q\);S\.check=null;\$\('actMsg'\)\.textContent='';renderItem\(\);/);
  // the cards' checked / selected state comes only from THIS item's draft, which starts blank
  const judge = clientFn("renderJudgment");
  assert.match(judge, /const it=S\.item,st=it\.status,d=draftOf\(\),open=isOpen\(\);/);
  assert.match(judge, /r\.checked=d\.outcome===r\.value;r\.disabled=!open;r\.parentElement\.classList\.toggle\('sel',d\.outcome===r\.value\);/);
  assert.match(clientFn("draftOf"), /if\(!S\.drafts\.has\(id\)\)S\.drafts\.set\(id,blank\(\)\)/);
  // the cross-item sequence: item A answered ACCEPT, item B fresh -> nothing on B is chosen
  const drafts = new Map();
  const draftFor = (id) => { if (!drafts.has(id)) drafts.set(id, UI.blank()); return drafts.get(id); };
  UI.chooseOutcome(draftFor("A"), "ACCEPT");
  const b = draftFor("B");
  assert.deepEqual(["ACCEPT", "EXPECTED_CLARIFY"].map((o) => b.outcome === o), [false, false]);
  assert.equal(UI.collectDraft(b).wire, "");
});
test("R2-F/G. Display, navigation and render code can never seed a semantic draft value (a '? -> ask' heuristic fails here)", () => {
  const { js, owner } = clientChunks();
  const FIELDS = "speech|facet|addr|names|rel|target|start|qform|pol|time|respm|refc|refspan|subj|subjnames|ia|iaopt|rk|ab|extra|outcome|field|slot|ecPart|mode|wire";
  // where a semantic draft field may be written: explicit human controls, the explicit outcome / mode switches, the explicit saved-label edit
  const ALLOWED = new Set(["chooseOutcome", "enterRaw", "returnToEasy", "startEdit", "stepControls", "detailClear", "detailsControls", "bind"]);
  const writes = [...js.matchAll(new RegExp(`([\\w$\\])]+)\\s*\\.\\s*(${FIELDS})\\s*=(?!=)`, "g"))].map((m) => ({ obj: m[1], field: m[2], fn: owner(m.index) }));
  assert.ok(writes.length > 20, "the scan sees the real writes");
  const stray = writes.filter((w) => !ALLOWED.has(w.fn) && !(w.fn === "parseRender" && w.obj === "P"));
  assert.deepEqual(stray, [], `semantic draft writes outside explicit human interaction: ${JSON.stringify(stray)}`);
  // bracket writes, Object.assign, drafts created outside the known paths, pushes onto chosen lists, outcome changes
  assert.deepEqual([...js.matchAll(new RegExp(`\\[\\s*['"](?:${FIELDS})['"]\\s*\\]\\s*=(?!=)`, "g"))].map((m) => owner(m.index)), []);
  assert.deepEqual([...new Set([...js.matchAll(/Object\.assign\(/g)].map((m) => owner(m.index)))], ["stepControls"]);
  assert.match(clientFn("stepControls"), /Object\.assign\(\{\},E\.facet_groups,\{other:'Something else'\}\)/, "the only Object.assign builds display names");
  assert.deepEqual([...new Set([...js.matchAll(/S\.drafts\.set\(/g)].map((m) => owner(m.index)))].sort(), ["draftOf", "startEdit"]);
  assert.deepEqual([...new Set([...js.matchAll(/\.(?:names|subjnames|ab|acts)\.push\(/g)].map((m) => owner(m.index)))], ["previewControls"]);
  assert.deepEqual([...new Set([...js.matchAll(/\bchooseOutcome\(/g)].map((m) => owner(m.index)))], ["bind"], "only the outcome radio handler changes the outcome");
  // the player's line is read for display only: printed once, read nowhere else outside the parser
  assert.deepEqual([...js.matchAll(/\.line\b/g)].map((m) => owner(m.index)).filter((f) => f !== "parseRender"), ["renderItem"]);
  assert.match(clientFn("renderItem"), /\$\('say'\)\.textContent=S\.P\.line;/);
  // and display / navigation code inspects no text at all
  for (const name of ["renderItem", "renderJudgment", "load", "draftOf", "init", "renderProblems", "runCheck", "schedule", "goStep", "advance", "back", "currentStep", "refreshSummary"]) {
    assert.ok(!/\.test\(|\.match\(|\.search\(|new RegExp|toLowerCase|\.endsWith\(|\.startsWith\(|\.indexOf\(\s*['"]/.test(clientFn(name)), `${name} inspects no text`);
  }
});
/** A conservative, mechanical near-collision check between two short texts. Both are normalized (case, quotes, punctuation) and every
 * word is reduced by simple morphology (a few irregular forms such as meant -> mean, then -ing / -ed / -es / -s), so inflected variants
 * compare equal. Returns the rule that fired, or null. It never returns either text. */
const NC_IRREGULAR = Object.freeze({ meant: "mean", said: "say", thought: "think", went: "go", got: "get", did: "do", made: "make", told: "tell", knew: "know", was: "be", were: "be", is: "be", are: "be", am: "be", been: "be", has: "have", had: "have", thanks: "thank", thx: "thank" });
const ncWord = (t) => { if (NC_IRREGULAR[t]) return NC_IRREGULAR[t]; for (const sfx of ["ing", "ed", "es", "s"]) if (t.length > sfx.length + 2 && t.endsWith(sfx)) return t.slice(0, -sfx.length); return t; };
const ncWords = (s) => String(s).toLowerCase().replace(/[‘’“”'"`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(ncWord);
function nearCollision(a, b) {
  const x = ncWords(a); const y = ncWords(b);
  if (!x.length || !y.length) return null;
  const starts = (p, q) => q.length <= p.length && q.every((t, i) => p[i] === t);
  const ends = (p, q) => q.length <= p.length && q.every((t, i) => p[p.length - q.length + i] === t);
  const inside = (p, q) => { for (let i = 0; i + q.length <= p.length; i += 1) if (q.every((t, j) => p[i + j] === t)) return true; return false; };
  const shared = (p, q) => { let k = 0; while (k < p.length && k < q.length && p[k] === q[k]) k += 1; return k; };
  if (x.join(" ") === y.join(" ")) return "normalized exact match";
  // prefix / suffix containment in both directions, for any length (a one-word example included)
  if (starts(y, x)) return "example is a prefix of the line";
  if (starts(x, y)) return "line is a prefix of the example";
  if (ends(y, x)) return "example is a suffix of the line";
  if (ends(x, y)) return "line is a suffix of the example";
  // containment anywhere: a phrase of two or more words, or a single word inside a text of at most three words
  if ((x.length >= 2 || y.length <= 3) && inside(y, x)) return "example appears inside the line";
  if ((y.length >= 2 || x.length <= 3) && inside(x, y)) return "line appears inside the example";
  if (shared(x, y) >= 3) return "shared opening of three or more words";
  if (shared([...x].reverse(), [...y].reverse()) >= 3) return "shared ending of three or more words";
  const X = new Set(x); const Y = new Set(y); let both = 0; for (const t of X) if (Y.has(t)) both += 1;
  if (both / new Set([...X, ...Y]).size >= 0.5) return "high word overlap";
  return null;
}
const FROZEN_WORKSHEET_SHA256 = "e6f2da5a7251434b4a29a6a29b765461d9594f3d9f5f6386e8299a8532ce3e5d";
const EXAMPLES = Object.freeze({ greet: "Howdy, neighbour!", bye: "Have a good weekend.", intro: "I’m the new hire.", ack: "Alright, noted.", thanks: "Much appreciated.", call: "Excuse me!", state: "The printer is out of paper.", sarcasm: "Oh wonderful, more paperwork.", ask: "What time is it?", request: "Could you open that?", repair: "Correction: make that Friday.", more: "Also on weekends?" });
test("R2-H/I. Speech-act examples are static and never collide or nearly collide with a frozen headline line", (t) => {
  const ref = WS.easyReference();
  const shown = Object.fromEntries(ref.speech.filter((s) => s.example).map((s) => [s.code, s.example.replace(/^“|”$/g, "")]));
  assert.deepEqual(shown, { ...EXAMPLES }, "the examples are exactly the pinned synthetic set");
  assert.equal(JSON.stringify(WS.easyReference().speech), JSON.stringify(ref.speech), "static: every reference built is identical");
  // the old examples that matched or nearly matched frozen lines are gone
  const RETIRED = ["Hi!", "See you later.", "Hey!", "It’s heavy.", "Oh, great.", "No, I meant the other one.", "How about you?", "Thanks.", "Sorry, I meant Thursday, not Tuesday.", "And the blue one?"];
  for (const old of RETIRED) assert.ok(!Object.values(shown).includes(old), `old example ${old} is gone`);
  // the checker itself fires (synthetic pairs only)
  assert.equal(nearCollision("Oh, swell.", "Oh swell, a broken kettle."), "example is a prefix of the line");
  assert.equal(nearCollision("Yo!", "yo"), "normalized exact match");
  assert.equal(nearCollision("Nope, the green kettle.", "Nope."), "line is a prefix of the example");
  assert.equal(nearCollision("What about lunch?", "Fine. What about lunch, Sam?"), "example appears inside the line");
  assert.equal(nearCollision("Bye now, see ya.", "see ya"), "line is a suffix of the example");
  assert.equal(nearCollision("Fine, see ya now.", "see ya"), "line appears inside the example");
  assert.equal(nearCollision("See ya later.", "See ya all later"), "high word overlap");
  assert.equal(nearCollision("Have a good weekend.", "Where is the kettle?"), null);
  // one-word examples: prefix and suffix containment in both directions, and a single word inside a very short text
  assert.equal(nearCollision("Cheers.", "Cheers, Sam, that was kind."), "example is a prefix of the line");
  assert.equal(nearCollision("Cheers.", "Well then, cheers"), "example is a suffix of the line");
  assert.equal(nearCollision("Fine, cheers!", "Cheers"), "line is a suffix of the example");
  assert.equal(nearCollision("Cheers.", "oh cheers mate"), "example appears inside the line");
  // simple morphological variants compare equal (meant / mean, -ing / -ed / -s)
  assert.equal(nearCollision("Oops, I meant Wednesday, sorry.", "oops, I mean Sam"), "shared opening of three or more words");
  assert.equal(nearCollision("Okay, we waited.", "okay, we wait"), "normalized exact match");
  assert.equal(nearCollision("Mugs!", "mug"), "normalized exact match");
  assert.equal(nearCollision("We fixed the mugs.", "We are fixing the mug"), "shared ending of three or more words");
  // against the 474 frozen headline lines: the local, gitignored blank worksheet, pinned by its SHA-256. Messages never print a frozen line.
  const sheet = path.join(WS.DEFAULT_DIR, WS.FILES.worksheet);
  if (!fs.existsSync(sheet)) { t.skip("the local frozen worksheet is absent: the check against the 474 lines runs where labeling happens"); return; }
  const text = fs.readFileSync(sheet, "utf8");
  assert.equal(crypto.createHash("sha256").update(text).digest("hex"), FROZEN_WORKSHEET_SHA256, "the blank frozen worksheet is the pinned one");
  const rows = text.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.kind === "item");
  assert.equal(rows.length, 474);
  const lines = rows.map((r) => (/^line: (.*)$/m.exec(r.render_user) || [])[1] || "");
  assert.equal(lines.filter(Boolean).length, 474);
  for (const [code, ex] of Object.entries(shown)) {
    const hits = lines.map((l) => nearCollision(ex, l)).filter(Boolean);
    assert.equal(hits.length, 0, `the example for ${code} (${ex}) collides with ${hits.length} frozen line(s): ${[...new Set(hits)].join(", ")}`);
  }
  // the strengthened check would have caught the retired one-word and inflected examples (counts only; no frozen text is printed)
  for (const old of ["Thanks.", "Sorry, I meant Thursday, not Tuesday."]) assert.ok(lines.some((l) => nearCollision(old, l)), `the retired example ${old} is caught by the strengthened check`);
});

// ─── N: no model / API / network ─────────────────────────────────────────────────────────────────────
function request(port, method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...headers } }, (res) => { let text = ""; res.on("data", (c) => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, text })); });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
test("N. The Easy UI reaches no model or network: one same-origin API helper, a static reference endpoint, no hosted transport", async () => {
  assert.deepEqual([...HTML.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1]), ["path"]);
  assert.ok(!/https?:\/\/|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(|<link\b|<img\b|<iframe\b|<script[^>]*\bsrc=|@import|url\(/i.test(HTML));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(HTML), "all text is inserted as text");
  const code = fs.readFileSync(SRC, "utf8");
  assert.ok(!/ai-hosted-transport|ai-openai|ai-local|ai-living|ai-provider|hostedArm|modelArm|localModel|process\.env|api\.openai|anthropic\.com/i.test(code));
  const gs = groupsOf(["Ask Tonya.", "Tell Malcolm."]);
  const dir = prepared(gs);
  const srv = WS.createWorkstationServer(openWs(dir), { host: "127.0.0.1", port: 0 });
  const realFetch = globalThis.fetch; const fetchCalls = [];
  globalThis.fetch = (...a) => { fetchCalls.push(a); throw new Error("no outbound fetch"); };
  const started = await srv.listen();
  try {
    const auth = { "x-ws-token": started.token };
    assert.equal((await request(started.port, "GET", "/api/easy")).status, 403, "the reference needs the per-run token like every API");
    const easy = await request(started.port, "GET", "/api/easy", { headers: auth });
    assert.equal(easy.status, 200);
    assert.equal(easy.text, JSON.stringify(WS.easyReference()), "the Easy reference is the static module value");
    for (const s of SENTINELS) assert.ok(!easy.text.includes(s));
    for (const g of gs) assert.ok(!easy.text.includes(g.item.text), "no item text in the static reference");
    assert.equal(fetchCalls.length, 0);
  } finally { globalThis.fetch = realFetch; await new Promise((r) => srv.server.close(r)); }
});

// ─── O: the audited Raw workflow is intact, and mode switches never alter anything silently ──────────
test("O. Advanced / Raw labeling remains available; switching modes is explicit and never reverse-engineers a wire", () => {
  const adv = detailsBlock("advanced").text;
  for (const id of ["wire", "hl", "ecField", "ecSlot", "ecNote", "bToRaw", "bToEasy"]) assert.ok(adv.includes(`id="${id}"`), `${id} is in Advanced`);
  // Easy -> Raw: the raw wire becomes the deterministic serialization (or stays empty when the form is incomplete)
  const d = pick("ACCEPT", ASK);
  UI.enterRaw(d);
  assert.deepEqual([d.mode, d.wire], ["raw", "ask contents @n1 new"]);
  assert.equal(UI.effectiveWire(d), "ask contents @n1 new");
  assert.equal(UI.canReturnToEasy(d), true, "an unedited serialization can return to Easy without loss");
  assert.equal(UI.returnToEasy(d), true);
  assert.deepEqual([d.mode, d.wire, d.easy.acts[0].speech], ["easy", "", "ask"], "the Easy selections are kept");
  const incomplete = UI.enterRaw(pick("ACCEPT", { speech: "ask" }));
  assert.equal(incomplete.wire, "", "an incomplete form populates nothing");
  // Raw -> Easy: a hand-edited wire is never read back; it needs an explicit discard
  const edited = UI.enterRaw(pick("ACCEPT", ASK));
  edited.wire = "ask contents @n1 new f=wh";
  assert.equal(UI.canReturnToEasy(edited), false);
  assert.equal(UI.returnToEasy(edited), false, "refused without an explicit discard");
  assert.equal(edited.mode, "raw");
  assert.equal(edited.wire, "ask contents @n1 new f=wh", "the raw text is untouched by the refusal");
  assert.equal(UI.returnToEasy(edited, { discard: true }), true);
  assert.deepEqual([edited.mode, edited.wire], ["easy", ""]);
  assert.equal(edited.easy.acts[0].qform, "", "nothing was reconstructed from the raw text");
  assert.match(HTML, /cannot read a hand-written wire back into choices/);
  // editing a saved label opens Raw (its wire cannot be read back) or a blank Easy form; neither alters the saved row
  assert.match(clientFn("startEdit"), /d\.mode='raw'/);
  assert.match(HTML, /Re-label in the Easy form \(starts blank\)/);
});

// ─── P, Q: the stored output is exactly what the audited workstation stores ──────────────────────────
test("P. An Easy-built commit is a valid HUMAN_PRIMARY row that passes the EXISTING validator", () => {
  const gs = groupsOf(["Tonya, what's in the duffle?", "Okay, that's that."]);
  const duffle = gs.find((g) => g.item.text.startsWith("Tonya"));
  const dir = prepared(gs);
  const ws = openWs(dir);
  const d = pick("ACCEPT", { speech: "ask", facet: "contents", addr: "named", names: ["n1"], rel: "new", qform: "wh", refc: "r1", refspan: "e1" });
  const payload = UI.collectDraft(d);
  assert.equal(payload.wire, "ask contents @n1 new f=wh r=e1>r1");
  assert.deepEqual(Object.keys(payload).sort(), ["notes", "outcome", "wire"], "an ACCEPT payload carries no clarify state");
  assert.equal(WS.check(ws, duffle.id, payload).ok, true);
  WS.commit(ws, duffle.id, payload, { explicit: true });
  const [row] = labelsOf(dir);
  assert.equal(row.label_state, "HUMAN_PRIMARY");
  assert.deepEqual(row.labeler, { kind: "human", id: "jack" });
  assert.deepEqual(Object.keys(row).sort(), ["committed_at", "expected_clarify", "gold_outcome", "gold_wire", "id", "label_state", "labeler", "notes", "render_digest", "system_digest"]);
  assert.deepEqual(L.independenceProblems(row, L.loadRegistry()), []);
  const full = L.validateLabels(gs, [row], { states: Object.values(L.LABEL_STATES), registry: L.loadRegistry() });
  assert.deepEqual(full.problems, [], "the existing validator (V0-V3 + resolveTurn) accepts the Easy-built row");
  assert.deepEqual(Object.keys(full.gold), [duffle.id]);
  assert.deepEqual(WS.runValidate({ dir }).exitCode, 0);
});
test("Q. Easy and Raw produce byte-identical stored rows for the same wire (ACCEPT and EXPECTED_CLARIFY)", () => {
  const gs = groupsOf(["Tonya, what's in the duffle?", "Okay, that's that."]);
  const g1 = gs.find((g) => g.item.text.startsWith("Tonya"));
  const g2 = gs.find((g) => g.item.text.startsWith("Okay"));
  const stored = (build) => { const dir = prepared(gs); const ws = openWs(dir); build(ws); return labelsOf(dir); };
  const easyAccept = pick("ACCEPT", { speech: "ask", facet: "contents", addr: "named", names: ["n1"], rel: "new", qform: "wh", refc: "r1", refspan: "e1" }, { notes: "n" });
  const easyClarify = pick("EXPECTED_CLARIFY", { speech: "ack", facet: "-", addr: "none", rel: "new" }, { field: "force", slot: "answer", note: "unsettled", notes: "" });
  const viaEasy = stored((ws) => { WS.commit(ws, g1.id, UI.collectDraft(easyAccept), { explicit: true }); WS.commit(ws, g2.id, UI.collectDraft(easyClarify), { explicit: true }); });
  const viaRaw = stored((ws) => {
    WS.commit(ws, g1.id, { outcome: "ACCEPT", wire: "ask contents @n1 new f=wh r=e1>r1", notes: "n" }, { explicit: true });
    WS.commit(ws, g2.id, { outcome: "EXPECTED_CLARIFY", wire: "ack - - new ab=force", expected_clarify: { field: "force", slot: "answer", note: "unsettled" }, notes: "" }, { explicit: true });
  });
  assert.equal(JSON.stringify(viaEasy), JSON.stringify(viaRaw), "byte-for-byte the same rows (the same clock, the same schema)");
  assert.equal(viaEasy[1].expected_clarify.field, "force");
  assert.deepEqual(Object.keys(viaEasy[1]).sort(), Object.keys(viaEasy[0]).sort());
});

// ─── blindness / contamination re-run for the presentation change ────────────────────────────────────
test("The Easy UI exposes no more observer-safe information than the audited Raw UI, and nothing answer-bearing", async () => {
  const gs = groupsOf(["Ask Tonya.", "Tell Malcolm.", "Hello everyone."]);
  const dir = prepared(gs);
  const ws = openWs(dir);
  const sheet = fs.readFileSync(path.join(dir, WS.FILES.worksheet), "utf8");
  // everything the Easy context shows derives from render_user (a pure function of that text)
  for (const it of ws.items) {
    const payload = WS.itemPayload(ws, it.n);
    const rows = UI.humanRows(UI.parseRender(payload.render_user), GLOSS);
    const shown = rows.map((r) => r.text).join(" ");
    for (const s of SENTINELS) assert.ok(!shown.includes(s) && !payload.render_user.includes(s));
    for (const id of [GISELLE, MALCOLM, TONYA, PLAYER.id]) assert.ok(!shown.includes(id), `canonical person id ${id} never shown`);
    assert.ok(!/yb-personnel-|SENTINEL/.test(shown));
    assert.ok(!/legacy|teacher|resolver|resolves|clarif|gold|review|model/i.test(shown), "no legacy / resolver / teacher / review / model vocabulary in the context");
  }
  assert.ok(!SENTINELS.some((s) => sheet.includes(s)));
  // the page and every API payload (now including /api/easy) stay free of code-side fields
  const srv = WS.createWorkstationServer(ws, { host: "127.0.0.1", port: 0 });
  const started = await srv.listen();
  try {
    const auth = { "x-ws-token": started.token };
    let wire = (await request(started.port, "GET", "/")).text;
    for (const p of ["/api/state", "/api/definitions", "/api/grammar", "/api/easy", "/api/validate"]) wire += (await request(started.port, "GET", p, { headers: auth })).text;
    for (const o of JSON.parse((await request(started.port, "GET", "/api/state", { headers: auth })).text).order) wire += (await request(started.port, "GET", `/api/item?n=${o.n}`, { headers: auth })).text;
    for (const s of SENTINELS) assert.ok(!wire.includes(s), `${s} reached the client`);
    assert.ok(!/MODEL_ASSISTED_REVIEW|ADJUDICATED_GOLD|UNLABELABLE/.test(wire));
    assert.ok(!/<(input|select|button)[^>]*(suggest|recommend|autocomplete="on"|list=)/i.test(HTML) && !/datalist/i.test(HTML));
  } finally { await new Promise((r) => srv.server.close(r)); }
  assert.equal(fs.existsSync(path.join(WS.DEFAULT_DIR, WS.FILES.labels)), false, "no real label file");
  assert.equal(fs.existsSync(path.join(WS.DEFAULT_DIR, WS.FILES.journal)), false, "no real journal");
});
test("Help, documentation boundary and responsive layout are present in the page", () => {
  assert.match(HTML, /id="bHelp"[^>]*>What am I doing\?<\/button>/);
  const help = HTML.slice(HTML.indexOf('id="helpModal"'), HTML.indexOf("</main>") > 0 ? HTML.indexOf("<main>") : undefined);
  assert.match(help, /decide what the player's line means, using only the information shown on this page/);
  assert.match(help, /I understand what the player means/);
  assert.match(help, /Something important is unclear/);
  assert.match(help, /Do not consult legacy answers, teacher answers, model answers or any outside interpretation help/);
  assert.match(help, /whether the meaning can be established from this observer-safe information/);
  assert.match(help, /how the form works, the wire syntax, and what a field means/);
  assert.match(help, /Do not ask an AI, a model or another person to decide ACCEPT versus EXPECTED_CLARIFY/);
  assert.match(HTML, /Optional notes \/ uncertainty/);
  assert.match(HTML, /Use this for concerns you want preserved for later adjudication\./);
  assert.match(HTML, /COMMIT &amp; NEXT/);
  assert.match(HTML, /class="sticky"/, "the commit controls stay reachable");
  assert.match(HTML, /@media\(max-width:900px\)\{main\{grid-template-columns:1fr\}\}/);
  assert.match(HTML, /\.hide\{display:none!important\}/, "a hidden modal / section can never be re-shown by another rule");
  // whole-file validation and jumping live under Tools; --validate-full is never offered by the page
  const tools = detailsBlock("tools").text;
  assert.ok(tools.includes('id="bValidate"') && tools.includes('id="jump"'));
  assert.ok(!/validate-full/.test(HTML));
  assert.match(HTML, /<span>Item <b id="hN">-<\/b> of <b id="hT">-<\/b><\/span><span class="pill"><strong id="hC">-<\/strong> completed<\/span><span class="pill"><strong id="hR">-<\/strong> remaining<\/span>/);
  assert.match(HTML, /id="bNextOpen"/);
  assert.ok(!/\b(?:correct|score|well done|great|good job)\b/i.test(HTML.slice(HTML.indexOf("<main>"), HTML.indexOf("<script"))), "no praise, score or correctness language");
});
