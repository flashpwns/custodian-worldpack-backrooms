"use strict";

// Reader Phase 2 -- STEP 0.1 (experiment / scoring contract, before any gold label; shadow-only):
//   the frozen system text == the label guide's field definitions (conventions A-D), wire and JSON share one semantic
//   contract; gold must pass the frozen contract (ACCEPT / EXPECTED_CLARIFY), duplicate ids rejected, label states and
//   labeller independence; scoring never credits INVALID output and separates transport failure; distinct-render
//   grouping and deterministic stratified sampling; the hosted transport, the egress gate and mandatory receipts; the
//   B7 indirect request-arg filter; hidden option labels; fuzzy false positives; the fence rule; exact power.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RF = require("../tools/dialogue-reader-frame");
const RI = require("../tools/dialogue-reader-input");
const LX = require("../tools/dialogue-reader-lexicon");
const R = require("../tools/dialogue-reader-render");
const W = require("../tools/dialogue-reader-wire");
const A = require("../tools/dialogue-reader-async");
const RP = require("../tools/dialogue-reader-replay");
const L = require("../tools/dialogue-reader-labels");
const P = require("../tools/dialogue-reader-power");
const E = require("../tools/dialogue-eval");

const ROOT = path.join(__dirname, "..");
const sc = E.scene();
const [GISELLE, MALCOLM, TONYA] = sc.present.map((p) => p.id);
const player = sc.entities.find((e) => e.is_player);
const PLAYER = { id: player.id, names: player.names };
const DUFFLE = "q4-startup-materials-duffle-01";

function state() {
  const requests = [{ request_id: "req-2", predicate: "item.contents", targets: [TONYA], state: "SATISFIED", slots: { shared: { state: "SATISFIED", responder_id: TONYA } }, args: { item_id: DUFFLE }, turns_since: 0 }];
  const snapshot = { active_speaker: { speaker_id: TONYA, speaker_ids: [TONYA] }, last_request: { request_id: "req-2", predicate: "item.contents", request_text: "Tonya, what's in the duffle?", args: { item_id: DUFFLE } }, pending_requests: [], activity: null, surface_anchors: [], pending_inbound_request: null, just_answered_inbound: null };
  return { ledger: { requests }, snapshot };
}
/** A captured-shape development item built from a scripted state. */
function item(raw, { id = "t#garbage#1", stratum = "j15", fixture = "t", snapshot: extra = {}, discourse = null, entities = sc.entities } = {}) {
  const { ledger, snapshot } = state();
  const snap = { ...snapshot, ...extra };
  const built = RI.buildReaderInput({ raw, present: sc.present, player: PLAYER, entities, snapshot: snap, ledger, discourse });
  return { id, stratum, fixture, provider: "garbage", request_id: id, text: raw, target: null, context_dependent: false, context_available: true, input: built.input, bindings: built.bindings, context: { snapshot: snap, ledger, present: sc.present.map((p) => ({ id: p.id })), canonical: {} }, l0: { frame: null }, production: null };
}
const group = (it) => RP.renderGroups([it])[0];
const label = (g, wire, extra = {}) => ({ id: g.id, render_digest: g.render_digest, label_state: "ADJUDICATED_GOLD", gold_outcome: "ACCEPT", gold_wire: wire, adjudicator: { kind: "human", id: "owner" }, primary: { labeler: { kind: "human", id: "owner" }, gold_wire: wire, committed_at: "2026-10-01T10:00:00Z" }, reviews: [], ...extra });

// ─── 1. system text == label guide; wire and JSON share one semantic contract ─────────────────────────
test("The frozen system text states every labelling convention, and the label guide embeds it verbatim", () => {
  const guide = fs.readFileSync(path.join(ROOT, "docs", "reader", "READER_PHASE2_LABEL_GUIDE.md"), "utf8");
  const semantic = R.semanticLines(R.SPELL.wire);
  assert.ok(R.SYSTEM_TEXT.startsWith(semantic.join("\n")), "the system text begins with the semantic contract");
  for (const line of semantic) assert.ok(guide.includes(line), `label guide is missing the frozen line: ${line.slice(0, 80)}`);
  for (const convention of ["CONVENTION A (follow-up / ellipsis facet)", "CONVENTION B (chip)", "CONVENTION C (inclusive group)", "CONVENTION D (relation antecedent)"]) assert.ok(R.SYSTEM_TEXT.includes(convention), convention);
  assert.ok(!/provisional gold/i.test(guide), "\"provisional gold\" is undefined and removed");
  assert.equal(R.RENDER_VERSION, "yellow-beast-reader-render@v2");
});
test("Wire and minimal-JSON arms: identical semantic instructions and byte-identical user render; only the output representation differs", () => {
  const neutral = { speech: (v) => `<speech:${v}>`, facet_none: "<facet:NONE_ASKING>", facet_na: "<facet:NOT_APPLICABLE>", address: Object.fromEntries(RF.ADDRESS_OPS.map((o) => [o, `<address:${o}>`])), relation: (k, t) => `<relation:${k}:${t ?? ""}>`, tag: (f, v) => `<${f}:${v}>`, tags: (f, vs) => `<${f}:${vs.join("|")}>`, value: (f, v) => `<${f}=${v}>`, referent: (v) => `<referent:${v}>`, option: (v) => `<option:${v}>` };
  const template = R.semanticLines(neutral);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = (line) => new RegExp(`^${line.split(/<[^<>]+>/).map(esc).join("(.+?)")}$`);
  const wire = R.semanticLines(R.SPELL.wire);
  const json = R.semanticLines(R.SPELL.json);
  assert.equal(wire.length, template.length);
  assert.equal(json.length, template.length);
  template.forEach((line, i) => { assert.match(wire[i], pattern(line), `wire line ${i}`); assert.match(json[i], pattern(line), `json line ${i}`); });
  const gloss = (text) => text.split("FACET CODES:\n")[1].split("\n").map((l) => l.replace(/^\S+ = /, ""));
  assert.deepEqual(gloss(R.SYSTEM_TEXT), gloss(R.SYSTEM_TEXT_JSON), "identical facet glosses");
  const input = item("Tonya, what's in the duffle?").input;
  assert.equal(R.renderReaderPrompt(input).user, R.renderReaderPrompt(input, { output: "json" }).user, "byte-identical user render");
});
test("Fences are invalid output, identically, for the wire and for minimal JSON", () => {
  const input = item("Tonya, what's in the duffle?").input;
  for (const text of ["```ask contents @n1 new```", "```\nask contents @n1 new\n```"]) assert.deepEqual(W.decodeWire(text, input).errors.map((e) => e.code), ["output_fenced"]);
  for (const text of ["```json\n{\"acts\":[]}\n```", "```{\"acts\":[]}```"]) assert.deepEqual(W.decodeJsonFrame(text, input).errors.map((e) => e.code), ["output_fenced"]);
});

// ─── 2. gold validation ───────────────────────────────────────────────────────────────────────────────
test("Gold must pass the frozen contract: ACCEPT = decode + V0-V3 accept and resolve; EXPECTED_CLARIFY = legal frame that clarifies on the declared slot", () => {
  const g = group(item("Tonya, what's in the duffle?"));
  const ok = (rows) => L.validateLabels([g], rows);
  assert.deepEqual(Object.keys(ok([label(g, "ask contents @n1 new f=wh r=e1>r1")]).gold), [g.id], "a contract-valid ACCEPT label");
  const problem = (wire, extra = {}) => ok([label(g, wire, extra)]).problems[0]?.problem;
  assert.equal(problem("ask contents @n1"), "label_fails_V0", "malformed wire");
  assert.equal(problem("ask contents @n9 new"), "label_fails_V1", "an illegal candidate (unknown name label)");
  assert.equal(problem("ask contents @n1 new r=r99"), "label_fails_V1", "a nonexistent referent");
  assert.equal(problem("more ? @n1 cont:q9"), "label_fails_V1", "a stale / nonexistent relation target");
  assert.equal(problem("ask contents all new f=wh r=e1>r1"), "label_fails_V2", "a surface contradiction (ALL without evidence) is never gold");
  assert.equal(problem("ask contents @n1 new ab=address"), "accept_label_resolves_to_clarify", "an ACCEPT label whose reading clarifies (abstention)");
  const done = group(item("Okay, that's that."));
  assert.equal(L.validateLabels([done], [label(done, "ack - - end:q1")]).problems[0]?.problem, "accept_label_not_accepted_by_V3", "an ACCEPT label V3 does not accept (conclude of a request)");
  assert.equal(problem("ask contents @n1 new", { gold_outcome: undefined }), "gold_outcome_missing_or_unknown");
  const clar = (wire, expected) => ok([label(g, wire, { gold_outcome: "EXPECTED_CLARIFY", expected_clarify: expected })]);
  assert.deepEqual(Object.keys(clar("ask contents - new f=wh ab=address", { field: "address", slot: "person", note: "who is asked is unsettled" }).gold), [g.id], "a valid EXPECTED_CLARIFY label");
  assert.equal(clar("ask contents - new f=wh ab=address", { field: "address", slot: "referent" }).problems[0].problem, "expected_clarify_slot_mismatch");
  assert.equal(clar("ask contents - new f=wh ab=address", null).problems[0].problem, "expected_clarify_unspecified");
  assert.equal(clar("ask contents @n1 new f=wh r=e1>r1", { field: "address", slot: "person" }).problems[0].problem, "expected_clarify_label_resolves");
  assert.equal(clar("ask contents - new f=wh ab=address", { field: "referent", slot: "person" }).problems[0].problem, "expected_clarify_field_not_expressed");
});
test("Duplicate label ids are rejected (every row), render drift is refused, and only ADJUDICATED_GOLD is headline gold", () => {
  const g = group(item("Tonya, what's in the duffle?"));
  const a = label(g, "ask contents @n1 new f=wh r=e1>r1");
  const dup = L.validateLabels([g], [a, { ...a, gold_wire: "ask holder @n1 new f=wh r=e1>r1" }]);
  assert.deepEqual([Object.keys(dup.gold).length, dup.problems.map((p) => p.problem)], [0, ["duplicate_label_id", "duplicate_label_id"]], "never last-row-wins");
  assert.equal(L.validateLabels([g], [{ ...a, render_digest: "0".repeat(64) }]).problems[0].problem, "render_changed_since_labelling");
  assert.equal(L.validateLabels([g], [{ ...a, render_digest: undefined }]).problems[0].problem, "render_digest_missing");
  assert.equal(L.validateLabels([g], [{ ...a, label_state: "UNLABELED" }]).problems[0].problem, "label_state_missing_or_unlabeled");
  const primary = { ...a, label_state: "HUMAN_PRIMARY", labeler: { kind: "human", id: "owner" } };
  assert.deepEqual(Object.keys(L.validateLabels([g], [primary]).gold), [], "a HUMAN_PRIMARY row is valid but is not headline gold");
  assert.deepEqual(Object.keys(L.validateLabels([g], [primary], { states: ["HUMAN_PRIMARY"] }).gold), [g.id], "diagnostic states only on request");
});
test("Labeller independence: human primary and adjudication; reviews only after the primary is committed; the teacher family never labels", () => {
  const g = group(item("Tonya, what's in the duffle?"));
  const reg = { teacher: { family: "family-t" }, automated_reviewer: { family: "claude" } };
  const a = label(g, "ask contents @n1 new f=wh r=e1>r1");
  const check = (l, registry = reg) => L.independenceProblems(l, registry);
  assert.deepEqual(check(a), []);
  assert.deepEqual(check({ ...a, reviews: [{ labeler: { kind: "model", family: "claude", id: "claude-x" }, created_at: "2026-10-01T11:00:00Z" }] }), [], "a review after the primary commit");
  assert.ok(check({ ...a, reviews: [{ labeler: { kind: "model", family: "claude", id: "claude-x" }, created_at: "2026-10-01T09:00:00Z" }] }).includes("review_visible_before_primary_committed"));
  assert.ok(check({ ...a, reviews: [{ labeler: { kind: "model", family: "family-t", id: "t" }, created_at: "2026-10-01T11:00:00Z" }] }).includes("review_family_equals_teacher_family"));
  assert.ok(check({ ...a, adjudicator: { kind: "model", id: "x" } }).includes("adjudicator_not_human"));
  assert.ok(check({ ...a, label_state: "HUMAN_PRIMARY", labeler: { kind: "model", family: "claude", id: "x" } }).includes("primary_label_not_human"));
  assert.ok(check({ ...a, label_state: "MODEL_ASSISTED_REVIEW", labeler: { kind: "model", family: "claude", id: "x" } }, { teacher: { family: null }, automated_reviewer: { family: null } }).includes("families_not_recorded_before_labelling"));
  assert.ok(check({ ...a, source: "teacher" }).includes("teacher_output_is_never_gold"));
  const validated = L.validateLabels([g], [{ ...a, reviews: [{ labeler: { kind: "model", family: "claude", id: "c" }, created_at: "2026-10-01T11:00:00Z" }] }], { registry: reg });
  assert.deepEqual(L.excludeSelfLabelled(validated.gold, "claude").excluded, [g.id], "an arm never scores against gold its own family touched");
  const registry = L.loadRegistry();
  assert.equal(registry.teacher.family, null, "no teacher family is chosen in code");
});

// ─── 3. scoring correctness (adversarial) ─────────────────────────────────────────────────────────────
function scoreOne(it, goldWire, armWire, { outcome = "ACCEPT", expected = null, status = null } = {}) {
  const g = group(it);
  const v = L.validateGoldFrame(g.item, goldWire, outcome, expected);
  const gold = v.ok ? { [g.id]: { frame: v.frame, wire: goldWire, outcome, expected_clarify: expected } } : { [g.id]: { frame: null, wire: goldWire, outcome, expected_clarify: expected } };
  let row;
  if (status) row = { id: g.id, status };
  else {
    const d = W.decodeWire(armWire, g.item.input);
    if (!d.ok) row = { id: g.id, status: "invalid", frame: null, verdict: null, resolution: null };
    else { const r = RP.resolveFrame(g.item, d.frame); row = { id: g.id, status: "read", frame: r.frame, verdict: r.verdict, resolution: r.resolution }; }
  }
  return RP.scoreArm([g], [row], gold).rows[0];
}
test("Scoring: INVALID output never earns outcome credit; two different invalid frames are never 'equal'", () => {
  const it = item("Tonya, what's in the duffle?");
  assert.equal(RP.outcomeSignature({ outcome: "invalid", disposition: "INVALID" }), null, "an invalid resolution has no signature");
  assert.deepEqual(RP.compareOutcomes({ outcome: "invalid", disposition: "INVALID" }, { outcome: "invalid", disposition: "INVALID" }), { equal: false, comparable: false, fields: {} }, "two invalid resolutions are not equal");
  const bothInvalid = scoreOne(it, "ask contents @n1", "wonder contents @n1 new");
  assert.deepEqual([bothInvalid.status, bothInvalid.correct], ["gold_invalid", false], "invalid gold is excluded, never compared");
  const r = scoreOne(it, "ask contents @n1 new f=wh r=e1>r1", "ask contents @n1");
  assert.deepEqual([r.status, r.correct, r.outcome_equal, r.scored, Object.values(r.fields).some(Boolean)], ["invalid_output", false, false, true, false], "invalid arm vs valid gold: wrong on every field");
  assert.equal(scoreOne(it, "ask contents @n1 new f=wh r=e1>r1", "{\"acts\":[]}").status, "invalid_output", "malformed wire");
});
test("Scoring: stale antecedents and illegal candidates in the arm reading are never correct; EXPECTED_CLARIFY gold makes an accepting arm false-confident", () => {
  const it = item("and what about the camera?");
  const gold = "more ? - cont:q1 r=e1>r2";
  const good = scoreOne(it, gold, gold);
  assert.equal(good.correct, true, `sanity: ${JSON.stringify(good)}`);
  const stale = scoreOne(it, gold, "more ? - cont:q9 r=e1>r2");
  assert.deepEqual([stale.status, stale.correct, stale.false_confident], ["read", false, false], "a stale antecedent clarifies: not correct");
  const illegal = scoreOne(it, gold, "more ? @n7 cont:q1 r=r99");
  assert.equal(illegal.correct, false, "an illegal candidate is not correct");
  const expected = { field: "address", slot: "person", note: "unsettled" };
  const it2 = item("Tonya, what's in the duffle?");
  const fc = scoreOne(it2, "ask contents - new f=wh ab=address", "ask contents @n1 new f=wh r=e1>r1", { outcome: "EXPECTED_CLARIFY", expected });
  assert.deepEqual([fc.correct, fc.accepted, fc.false_confident], [false, true, true], "valid arm vs expected-clarify gold");
  const right = scoreOne(it2, "ask contents - new f=wh ab=address", "ask contents - new f=wh ab=address", { outcome: "EXPECTED_CLARIFY", expected });
  assert.equal(right.correct, true, "clarifying on the expected slot is correct");
});
test("Scoring: transport failure is reported separately, never as a semantic error; retries follow the preregistered policy", async () => {
  const it = item("Tonya, what's in the duffle?");
  const t = scoreOne(it, "ask contents @n1 new f=wh r=e1>r1", null, { status: "reader_unavailable" });
  assert.deepEqual([t.status, t.scored, t.correct], ["transport_unavailable", false, false]);
  const g = group(it);
  const gold = { [g.id]: { frame: W.decodeWire("ask contents @n1 new f=wh r=e1>r1", it.input).frame, wire: "ask contents @n1 new f=wh r=e1>r1", outcome: "ACCEPT" } };
  const summary = RP.scoreArm([g], [{ id: g.id, status: "reader_unavailable" }], gold).summary;
  assert.deepEqual([summary.n_scored, summary.transport.unavailable, summary.resolved_outcome.pct, summary.resolved_outcome.conservative_pct_transport_as_wrong], [0, 1, null, 0]);
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const run = async (codes) => { let n = 0; const transport = async () => { const c = codes[Math.min(n, codes.length - 1)]; n += 1; if (c === "ok") return { text: "ask contents @n1 new f=wh r=e1>r1" }; throw Object.assign(new Error(c), { code: c }); }; const [row] = await RP.modelArm([g], { transport, timeout_ms: 500 }, { sleep }); return { row, calls: n }; };
  const recovered = await run(["HTTP_429", "HTTP_503", "ok"]);
  assert.deepEqual([recovered.row.status, recovered.row.retry_count, recovered.calls], ["read", 2, 3], "transient failures are retried");
  const exhausted = await run(["HTTP_500"]);
  assert.deepEqual([exhausted.row.status, exhausted.row.retry_count, exhausted.calls], ["reader_unavailable", 3, 4], "3 retries, then transport_unavailable");
  assert.deepEqual(slept.slice(-3), [2000, 4000, 8000], "preregistered backoff");
  const fatal = await run(["HTTP_401"]);
  assert.deepEqual([fatal.row.status, fatal.calls], ["reader_unavailable", 1], "a non-transient failure is not retried");
  const wrong = await (async () => { let n = 0; const [row] = await RP.modelArm([g], { transport: async () => { n += 1; return { text: "garbage" }; } }, { sleep }); return { row, n }; })();
  assert.deepEqual([wrong.row.status, wrong.n], ["invalid", 1], "an undecodable reply is never retried");
});

// ─── 4 / 5 / 6. distinct renders, stratified sampling, the teacher sample ─────────────────────────────
test("Render de-duplication: identical renders are one item with every occurrence kept; counts by definition", () => {
  const a = item("Tonya, what's in the duffle?", { id: "j15/x#fallback#char-t1", fixture: "j15/x" });
  const b = { ...a, id: "j15/x#garbage#char-t1", provider: "garbage" };
  const c = { ...item("Malcolm, what's in the duffle?", { id: "scenario/y#garbage#char-t2", stratum: "scripted_state", fixture: "scenario/y" }) };
  const d = { ...item("what's in the duffle?", { id: "dev-corpus.jsonl#d9#fallback#char-t1", stratum: "ed30_dev", fixture: "dev-corpus.jsonl#d9" }), context_dependent: true, context_available: false };
  const groups = RP.renderGroups([c, b, a, d]);
  assert.equal(groups.length, 3);
  const ab = groups.find((g) => g.occurrences.length === 2);
  assert.deepEqual(ab.occurrences.map((o) => o.id), [a.id, b.id], "all occurrences, stable order");
  assert.equal(ab.item.id, a.id, "the representative is the first occurrence");
  assert.equal(groups.find((g) => g.primary_stratum === "ed30_dev").context_missing, true);
  const counts = RP.corpusCounts([a, b, c, d]);
  assert.deepEqual([counts.source_rows, counts.distinct_player_turns, counts.distinct_texts, counts.distinct_renders, counts.headline_eligible_renders], [4, 3, 3, 3, 2]);
});
test("Sampling: --limit is a deterministic proportional stratified sample, never the first N rows", () => {
  const groups = [];
  for (const [stratum, n] of [["j15", 40], ["human_trace", 5], ["scripted_state", 30], ["ed30_dev", 25]]) for (let i = 0; i < n; i += 1) groups.push({ id: `${stratum}-${i}`, render_digest: require("node:crypto").createHash("sha256").update(`${stratum}${i}`).digest("hex"), primary_stratum: stratum });
  const s = RP.stratifiedSample(groups, 20);
  assert.equal(s.length, 20);
  const by = {};
  for (const g of s) by[g.primary_stratum] = (by[g.primary_stratum] ?? 0) + 1;
  assert.deepEqual(by, { human_trace: 1, j15: 8, scripted_state: 6, ed30_dev: 5 });
  assert.deepEqual(RP.stratifiedSample([...groups].reverse(), 20).map((g) => g.id).sort(), s.map((g) => g.id).sort(), "independent of capture order");
  assert.notDeepEqual(s.map((g) => g.id), groups.slice(0, 20).map((g) => g.id));
});
test("The preregistered teacher sample is frozen: census of headline-eligible distinct renders, >= 300, several strata", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "acceptance", "reader-phase2", "teacher-dev-sample.json"), "utf8"));
  assert.equal(doc.version, RP.TEACHER_SAMPLE_PLAN.version);
  assert.deepEqual(doc.contract, RP.contractIdentity(), "frozen under the current contract");
  assert.ok(doc.headline_renders >= 300, `${doc.headline_renders}`);
  assert.equal(doc.headline.length, doc.headline_renders);
  assert.equal(new Set(doc.headline.map((h) => h.render_digest)).size, doc.headline.length, "distinct render digests");
  assert.ok(Object.keys(doc.by_stratum).length >= 4);
  assert.ok(doc.diagnostic_only.every((d) => d.reason === "context_dependent_probe_without_context"));
  for (const k of ["estimator", "interval", "stop_rule", "transport_rule", "label_loss_rule"]) assert.ok(doc[k], k);
});

test("Doctrine review sample oversamples renders whose gold facet differs from the legacy facet, reported apart", () => {
  const mk = (i, legacy, goldFacet) => { const g = group(item(`line ${i}?`, { id: `j15/r#g#${i}` })); g.item.l0 = { frame: { acts: [{ speech_act: "question", facet: legacy }] } }; return [g, { frame: { acts: [{ speech_act: "question", facet: goldFacet }] } }]; };
  const pairs = [...Array.from({ length: 5 }, (_, i) => mk(i, "item.holder", "item.contents")), ...Array.from({ length: 20 }, (_, i) => mk(100 + i, "item.holder", "item.holder"))];
  const s = RP.doctrineReviewSample(pairs.map((p) => p[0]), Object.fromEntries(pairs.map(([g, f]) => [g.id, f])), { size: 10, cap: 60 });
  assert.equal(s.facet_differs.length, 5, "every facet-differs render is taken");
  assert.equal(s.others.length, 5);
  assert.ok(s.facet_differs.every((r) => r.gold_facet !== r.legacy_facet) && s.others.every((r) => r.gold_facet === r.legacy_facet));
});

// ─── 9 / 10 / 11. hosted transport, egress consent, receipts ───────────────────────────────────────────
test("Hosted transport: configurable budget / temperature / reasoning; temperature never forced; only final text kept", async () => {
  const { input } = item("Tonya, what's in the duffle?");
  const rendered = R.renderReaderPrompt(input);
  let sent = null;
  const ok = (body) => async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => body }; };
  const oa = A.hostedChatTransport({ baseURL: "https://example.invalid/v1", apiKey: "k", model: "m", fetchImpl: ok({ choices: [{ message: { content: "ask contents @n1 new" } }] }), maxOutputTokens: 2000, reasoningEffort: "high", maxTokensParam: "max_completion_tokens" });
  await oa({ system: rendered.system, user: rendered.user, max_tokens: 96 });
  assert.deepEqual(Object.keys(sent.body).sort(), ["max_completion_tokens", "messages", "model", "reasoning_effort"], "no temperature unless configured");
  assert.equal(sent.body.max_completion_tokens, 2000);
  await A.hostedChatTransport({ baseURL: "https://example.invalid/v1", apiKey: "k", model: "m", fetchImpl: ok({ choices: [{ message: { content: "x" } }] }), temperature: 0 })({ system: "s", user: "u", max_tokens: 96 });
  assert.equal(sent.body.temperature, 0, "temperature when configured");
  const an = A.hostedChatTransport({ api: "anthropic-messages", apiKey: "k", model: "m", fetchImpl: ok({ content: [{ type: "thinking", thinking: "SECRET REASONING" }, { type: "text", text: "ask contents @n1 new" }] }), reasoningBudgetTokens: 4000, temperature: 0 });
  const out = await an({ system: rendered.system, user: rendered.user, max_tokens: 96 });
  assert.deepEqual([sent.body.thinking, "temperature" in sent.body], [{ type: "enabled", budget_tokens: 4000 }, false], "extended thinking: temperature is not sent");
  assert.equal(out.text, "ask contents @n1 new");
  assert.ok(!JSON.stringify(out).includes("SECRET REASONING"), "provider chain-of-thought is never kept");
  assert.equal(out.response_status, 200);
});
test("Hosted egress: refused without --confirm-egress; human trace excluded by default; receipts mandatory; the plan is disclosed", () => {
  const units = [{ ...group(item("Tonya, what's in the duffle?", { id: "j15/a#g#1" })) }, { ...group(item("Malcolm, what's in the duffle?", { id: "j15/4-human-trace.txt#g#1", stratum: "human_trace", fixture: "j15/4-human-trace.txt" })) }];
  const base = { provider: "p", baseURL: "https://api.example.invalid/v1", model: "m", family: "f", receipts: "r.jsonl" };
  const refused = RP.egressPlan(units, base);
  assert.equal(refused.ok, false);
  assert.match(refused.refusal, /--confirm-egress/);
  const plan = RP.egressPlan(units, { ...base, confirm: true });
  assert.equal(plan.ok, true);
  assert.deepEqual([plan.units.length, plan.summary.human_trace_included, plan.summary.human_trace_excluded], [1, false, 1], "human trace excluded by default");
  for (const k of ["provider", "endpoint_host", "model", "renders", "strata", "human_trace_included", "bytes_estimated", "tokens_estimated", "retention_training"]) assert.ok(k in plan.summary, k);
  assert.equal(plan.summary.endpoint_host, "api.example.invalid");
  assert.equal(RP.egressPlan(units, { ...base, confirm: true, includeHumanTrace: true }).units.length, 2, "a second explicit flag includes it");
  assert.match(RP.egressPlan(units, { ...base, confirm: true, receipts: null }).refusal, /receipts/);
});
test("Hosted receipts: every request records digests, provider, host, model, parameters, bytes, status, retries, latency and output digest", async () => {
  const it = item("Tonya, what's in the duffle?");
  const g = group(it);
  let n = 0;
  const transport = A.hostedChatTransport({ baseURL: "https://api.example.invalid/v1", apiKey: "k", model: "m", fetchImpl: async () => { n += 1; return n === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ model: "m-2026", choices: [{ message: { content: "ask contents @n1 new f=wh r=e1>r1" } }] }) }; } });
  const [row] = await RP.modelArm([g], { provider: "p", model: "m", transport }, { sleep: async () => {} });
  const receipt = RP.hostedReceipt(row, g.item);
  for (const k of ["render_digest", "system_digest", "provider", "endpoint_host", "model", "params", "request_bytes", "system_sha256", "user_sha256", "response_status", "retry_count", "latency_ms", "output_digest"]) assert.ok(receipt[k] != null, k);
  assert.deepEqual([receipt.retry_count, receipt.response_status, receipt.endpoint_host], [1, 200, "api.example.invalid"]);
  assert.equal(receipt.tries[0].error, "HTTP_503");
});

// ─── 12. B7 indirect request-arg salience ─────────────────────────────────────────────────────────────
test("B7 indirect: an unspoken REQUIRED fact that production turned into a request arg never reaches the reader as salience", () => {
  const discourse = { turns: [{ player_text: "Can you even go in there?" }], last_turn: { player_text: "Can you even go in there?", responses: [{ speaker_id: GISELLE, text: "Not yet. Soon, I think.", facts: { required: [{ key: "next_step", value: "report to Equipment Staging" }] } }] } };
  const snapshot = { last_request: { request_id: "req-9", predicate: "place.access", request_text: "Can you even go in there?", args: { place_id: "equipment-staging", place_basis: "salient_topic" } }, last_substantive_request: { request_id: "req-9", predicate: "place.access", request_text: "Can you even go in there?", args: { place_id: "equipment-staging", place_basis: "salient_topic" } } };
  const { input, bindings } = item("what's it like there?", { snapshot, discourse });
  const user = R.renderReaderPrompt(input).user;
  assert.ok(!/place in talk/.test(user), user);
  assert.ok(!/Equipment Staging|staging/i.test(user), `unspoken place leaked:\n${user}`);
  assert.equal(input.conversation.active_place, null);
  assert.deepEqual(bindings.salience_filter.omitted.map((o) => [o.arg, o.id, o.basis]), [["place_id", "equipment-staging", "salient_topic"]], "recorded code-side only");
  // The same arg when the PLAYER said it: grounded.
  const said = item("what's it like there?", { snapshot, discourse: { ...discourse, turns: [{ player_text: "Should we head to Equipment Staging?" }, ...discourse.turns] } });
  assert.match(R.renderReaderPrompt(said.input).user, /place in talk: r\d/);
  assert.equal(said.bindings.referents[said.input.conversation.active_place], "equipment-staging");
  // HEARD in delivered wording: a heard candidate only, never the canonical active place.
  const heard = item("what's it like there?", { snapshot, discourse: { ...discourse, last_turn: { ...discourse.last_turn, responses: [{ speaker_id: GISELLE, text: "We report to Equipment Staging next." }] } } });
  assert.equal(heard.input.conversation.active_place, null);
  assert.ok(heard.input.referent_candidates.some((r) => r.basis === "heard" && /Staging/i.test(r.name)));
});
test("B7 indirect: an anaphoric item arg resolved only through an unspoken plan fact is omitted; a player-named one stays", () => {
  const snapshot = { last_request: { request_id: "req-5", predicate: "item.status", request_text: "is it heavy?", args: { item_id: "q4-field-light-01", item_anaphoric: true } }, last_substantive_request: null };
  const discourse = { turns: [{ player_text: "is it heavy?" }], last_turn: { player_text: "is it heavy?", responses: [{ speaker_id: TONYA, text: "Not really.", facts: { optional: [{ key: "held_equipment", value: "Battery field lamp" }] } }] } };
  const { input, bindings } = item("who packed it?", { snapshot, discourse });
  assert.ok(!/lamp|flashlight|torch/i.test(JSON.stringify(input)), "never reaches the reader");
  assert.deepEqual(bindings.salience_filter.omitted.map((o) => [o.id, o.basis]), [["q4-field-light-01", "anaphoric"]]);
  const named = item("who packed it?", { snapshot: { last_request: { ...snapshot.last_request, request_text: "is the lamp heavy?", args: { item_id: "q4-field-light-01" } } }, discourse: { turns: [{ player_text: "is the lamp heavy?" }], last_turn: { player_text: "is the lamp heavy?", responses: [] } } });
  assert.ok(named.input.conversation.anaphora_candidates.length === 1);
});

// ─── 13. hidden option labels ─────────────────────────────────────────────────────────────────────────
test("Pending coworker-question options that name a HIDDEN person, item or place are opaque to the reader; the binding stays code-side", () => {
  const hidden = [
    { id: "yb-world-rhodes-9f1", kind: "person", label: "Eleanor Rhodes", names: ["eleanor", "rhodes"], world_only: true },
    { id: "q4-sealed-specimen-canister-01", kind: "equipment", label: "Sealed specimen canister", names: ["canister"], observer_hidden: true },
    { id: "sublevel-vault", kind: "location", label: "Sublevel Vault", names: ["vault"], hidden: true }
  ];
  const entities = [...sc.entities, ...hidden];
  const inbound = { event_id: "ev-q", speaker_id: GISELLE, kind: "question", answer_shape: "choice", options: [...hidden.map((h) => h.id), DUFFLE] };
  const { input, bindings } = item("the first one", { entities, snapshot: { pending_inbound_request: inbound } });
  const user = R.renderReaderPrompt(input).user;
  for (const leak of ["Eleanor", "Rhodes", "canister", "specimen", "Vault", "yb-world", "q4-sealed", "sublevel"]) assert.ok(!user.includes(leak) && !JSON.stringify(input).includes(leak), `leaked ${leak}`);
  assert.deepEqual(input.conversation.inbound.options.map((o) => o.text), [null, null, null, "Startup materials duffle"]);
  assert.deepEqual(Object.values(bindings.options), inbound.options, "canonical option bindings stay code-side");
  const objectOption = RI.optionText({ id: "q4-sealed-specimen-canister-01", label: "the canister" }, entities, (e) => LX.observerVisible(e));
  assert.equal(objectOption, null, "an object option naming a hidden entity is opaque too");
});

// ─── 14. fuzzy false positives ────────────────────────────────────────────────────────────────────────
test("Fuzzy matching: ordinary English words never bind; genuine misspellings still do; authored aliases untouched", () => {
  const lex = LX.observerLexicon(sc.entities);
  const bind = (line) => { const t = [...line.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*|[^\sA-Za-z0-9]/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length })); return LX.bindLine(t, lex, { raw: line }); };
  for (const w of ["complete", "touch", "portable", "lamb", "note", "deliver", "delivers", "lambs"]) assert.deepEqual(bind(`the ${w}`).filter((s) => s.basis === "fuzzy"), [], `${w} must not fuzzy-bind`);
  assert.equal(bind("the camra")[0].bound, "item-b2b47214d72b45d159");
  assert.equal(bind("the flashlght")[0].bound, "q4-field-light-01");
  assert.equal(bind("the spctrmeter")[0].bound, "item-61d51797cf8afcee0d");
  assert.deepEqual(bind("the notes").map((s) => [s.basis, s.bound]), [["alias", "task:verbal-recall"]], "authored alias");
  assert.equal(LX.LEXICON_VERSION, "yellow-beast-reader-lexicon@v2");
  const guard = JSON.parse(fs.readFileSync(LX.FUZZY_GUARD_FILE, "utf8"));
  const G = require("../tools/dialogue-reader-fuzzy-guard");
  assert.deepEqual(guard.lexicon_forms, G.computeGuard("", G.referenceLexicon()).forms, "the guard was computed against the current lexicon forms");
  if (fs.existsSync(G.DEFAULT_DICT) && require("node:crypto").createHash("sha256").update(fs.readFileSync(G.DEFAULT_DICT)).digest("hex") === guard.source.sha256) assert.deepEqual(G.computeGuard(fs.readFileSync(G.DEFAULT_DICT, "utf8"), G.referenceLexicon()).words, guard.words, "the frozen guard is reproducible");
});

// ─── 15 / 18. rare-state shapes; statistics ───────────────────────────────────────────────────────────
test("Rare-state shape counts are machine counts over pending-question turns; own-answer corrections over just-answered turns", () => {
  const mk = (tag, shape, i0 = false) => ({ stratum: "scripted_rare_state", coverage_tag: tag, input: { conversation: { inbound: i0 ? null : { answer_shape: shape }, just_answered_inbound: i0 ? { label: "i0" } : null } } });
  const counts = RP.shapeCounts([mk("answer", "yes_no"), mk("answer", "free_short_answer"), mk("refusal", "time"), mk(null, "person"), mk("own_answer_correction", null, true)]);
  const r = counts.scripted_rare_state;
  assert.deepEqual([r.pending_coworker_question_turns, r.authored_replies, r.shapes.yes_no, r.shapes.free_short, r.shapes.refusal, r.shapes.not_an_answer, r.shapes.own_answer_correction], [4, 3, 1, 1, 1, 1, 1]);
});
test("Exact binomial power of the false-confident gate and the sealed size rule", () => {
  const p = (t) => P.exactPowerBelow(880, 0.03, t).power;
  assert.ok(p(0.01) > 0.99 && p(0.015) > 0.85 && p(0.015) < 0.92 && p(0.02) > 0.45 && p(0.02) < 0.58 && p(0.025) < 0.22, JSON.stringify([p(0.01), p(0.015), p(0.02), p(0.025)]));
  assert.equal(P.sealedSizeFC({ deff: 1 }).total, 1800, "~1,800 turns: 80% power at a true FC of 2%");
  assert.ok(P.sealedSizeFC({ deff: P.designEffect(10, 0.02) }).total > 1800, "clustering raises the size");
});
