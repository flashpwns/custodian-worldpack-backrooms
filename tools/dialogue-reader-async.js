"use strict";

// Reader Phase 2 -- the ASYNC MODEL-READER PATH (offline replay harness; optional developer live shadow).
//
//   readTurnAsync({ input, bindings, rendered?, request_id?, context? }, readerConfig) -> Promise<receipt>
//
// NEVER on the synchronous canonical path: production reads turns through the legacy reader v0 (dialogue-reader.js,
// unchanged). This path renders the observer-safe ReaderInput (dialogue-reader-render.js), asks a TRANSPORT for wire
// text, and runs
//
//   wire text -> decodeWire (V0) -> nominated-span lookup (code) -> validateReaderFrame (V0-V3)
//             -> resolveTurn (shadow; only when a canonical context is supplied) -> receipt
//
// It never throws: an exception, timeout, hang or dead server yields an INERT reader-unavailable receipt. The receipt
// holds no chain-of-thought (none is requested) and no canonical id beyond the code-side resolution record.
//
// A transport is async ({ system, user, grammar, logprobs, top_logprobs, max_tokens, signal }) ->
// { text, logprobs?, model?, usage?, transmitted? }. Built-ins: llamaTransport (the pinned local runtime),
// hostedChatTransport (DEVELOPMENT-ONLY teacher ceiling: OpenAI-compatible chat or Anthropic Messages), and
// scriptedTransport (tests, fault injection, gold replay).

const crypto = require("node:crypto");
const RF = require("./dialogue-reader-frame");
const W = require("./dialogue-reader-wire");
const { renderReaderPrompt } = require("./dialogue-reader-render");
const { applyNominatedLookup } = require("./dialogue-reader-lexicon");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { opaqueRequestTexts, deepFreeze } = require("./dialogue-reader-shadow");
const { READER_INPUT_VERSION } = require("./dialogue-reader-input");

const ASYNC_READER_VERSION = "yellow-beast-reader-async@v1";
const ASYNC_RECEIPT_VERSION = "yellow-beast-reader-async-receipt@v1";
const DEFAULT_TIMEOUT_MS = 5000;
const sha = (v) => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

// Owner item B8 (recorded, not presented): WHY a reading clarifies. LINGUISTIC_AMBIGUITY -- the line / discourse
// state is genuinely underdetermined (a human would ask too). READER_UNCERTAINTY -- the reader abstained, chose an
// illegal or unsupported value, or claimed something the surface does not show.
const LINGUISTIC_CODES = new Set(["deixis_without_antecedent", "addressee_ambiguous", "ellipsis_target_unresolved", "ellipsis_no_antecedent", "repair_no_target", "no_utterance_antecedent", "quantifier_mismatch", "others_resolves_to_nobody", "except_resolves_to_nobody", "others_count_mismatch", "claim_antecedent_not_eligible", "antecedent_not_eligible", "addressee_not_present", "standalone_name_as_mention", "name_answer_shape_mismatch", "no_antecedent", "second_person_with_nobody_present", "unanswered_repair_of_closed_request", "withdraw_of_closed_request", "attention_to_closed_request"]);
function clarificationKind(resolution) {
  if (!resolution || resolution.outcome !== "clarify") return null;
  const reason = String(resolution.clarification?.reason ?? "");
  const code = reason.replace(/^validator:/, "").replace(/^rejected:[a-z_]+:/, "");
  if (reason === "reader_abstained" || reason.startsWith("rejected:")) return "READER_UNCERTAINTY";
  if (LINGUISTIC_CODES.has(code)) return "LINGUISTIC_AMBIGUITY";
  return "READER_UNCERTAINTY";
}

/** Per-act abstentions and referent uncertainty the reader itself expressed (never self-reported confidence). */
function abstentionsOf(frame) {
  return (frame?.acts ?? []).map((a, i) => ({ act: i, fields: [...(a.abstain ?? [])], referent_unsure: a.referent?.candidate === "AMBIGUOUS" })).filter((x) => x.fields.length || x.referent_unsure);
}

/**
 * OFFLINE field margins from raw token logprobs (Phase-2 capture only; no runtime policy uses them). llama.cpp's
 * top_logprobs are PRE-grammar: alternatives the grammar forbids appear in the list. At the FIRST token of each
 * positional core field (speech act, facet, address, relation) the alternatives are split into grammar-legal ones
 * (a prefix of a legal code for that field) and illegal ones; the legal ones are renormalized and the margin is the
 * top-two difference. Later tokens of a field are conditional on the first and are not scored here.
 */
const CORE_FIELDS = ["speech_act", "facet", "address", "relation"];
function wireFieldMargins(logprobs) {
  if (!Array.isArray(logprobs) || !logprobs.length) return null;
  const legal = {
    speech_act: Object.values(W.SPEECH),
    facet: Object.values({ ...W.FACET_CODES, ...W.FACET_SPECIAL_CODES }),
    address: [...Object.values(W.ADDRESS), "@", "except@"],
    relation: Object.values(W.RELATION)
  };
  const out = [];
  let text = "";
  let act = 0;
  for (const entry of logprobs) {
    const token = String(entry.token ?? "");
    // Where the token's first visible character lands: the text so far plus the token's own leading spaces.
    const prefix = text + (/^\s*/.exec(token)?.[0] ?? "");
    text += token;
    if (!token.trim()) continue;
    const startsField = prefix === "" || prefix.endsWith(" ");
    const segments = prefix.split(" ; ");
    act = segments.length - 1;
    const position = segments.at(-1).split(" ").length - 1;
    const field = CORE_FIELDS[position];
    if (!startsField || !field) continue;
    const isLegal = (tok) => { const t = String(tok ?? "").replace(/^\s+/, ""); return t.length > 0 && legal[field].some((code) => code.startsWith(t) || t.startsWith(code)); };
    const alts = (entry.top_logprobs ?? []).map((a) => ({ token: a.token, p: Math.exp(a.logprob), legal: isLegal(a.token) }));
    const legalAlts = alts.filter((a) => a.legal).sort((x, y) => y.p - x.p);
    const mass = legalAlts.reduce((sum, a) => sum + a.p, 0);
    const norm = legalAlts.map((a) => ({ token: a.token, p: mass ? a.p / mass : null }));
    out.push({ act, field, chosen: entry.token, chosen_legal: isLegal(entry.token), legal_alternatives: norm.length, illegal_in_top: alts.filter((a) => !a.legal).length, legal_mass_in_top: Math.round(mass * 1e4) / 1e4, renormalized_margin: norm.length >= 2 ? Math.round((norm[0].p - norm[1].p) * 1e4) / 1e4 : norm.length === 1 ? 1 : null });
  }
  return out;
}

function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve({ __timeout: true }); }, ms); });
  const work = Promise.resolve().then(() => promiseFactory(controller.signal)).then((value) => ({ value }), (error) => ({ error }));
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One asynchronous model reading. `context` ({ snapshot, ledger, present, canonical }) is the captured canonical
 * pre-turn state; with it the receipt also carries the shadow resolution (resolveTurn under the verdict).
 */
async function readTurnAsync({ input, bindings, rendered = null, request_id = null, context = null } = {}, readerConfig = {}) {
  const started = nowMs();
  const cfg = { timeout_ms: DEFAULT_TIMEOUT_MS, grammar: false, logprobs: false, top_logprobs: 0, max_tokens: 96, ...readerConfig };
  const render = rendered ?? renderReaderPrompt(input, { output: cfg.output === "json" ? "json" : "wire" });
  const grammar = cfg.grammar && cfg.output !== "json" ? W.wireGrammar(input) : null;
  const base = {
    version: ASYNC_RECEIPT_VERSION, reader_path: ASYNC_READER_VERSION, request_id,
    input_version: input?.version ?? READER_INPUT_VERSION, input_digest: sha(input ?? null),
    render_version: render.version, render_digest: render.render_digest, system_digest: render.system_digest, user_digest: render.user_digest,
    wire_version: W.WIRE_VERSION, wire_digest: W.WIRE_DIGEST, grammar_digest: grammar ? sha(grammar) : null, frame_version: RF.READER_FRAME_VERSION,
    reader: { id: cfg.id ?? null, provider: cfg.provider ?? null, model: cfg.model ?? null, model_hash: cfg.model_hash ?? null, quantization: cfg.quantization ?? null, temperature: cfg.temperature ?? 0, output: cfg.output === "json" ? "json" : "wire" },
    consumed: false
  };
  const finish = (fields) => deepFreeze({ ...base, ...fields, latency_ms: Math.round((nowMs() - started) * 10) / 10 });
  if (typeof cfg.transport !== "function") return finish({ status: "reader_unavailable", reason: "no_transport", raw_wire: null, decode: null, verdict: null, frame: null });
  const out = await withTimeout((signal) => cfg.transport({ system: render.system, user: render.user, grammar, logprobs: cfg.logprobs, top_logprobs: cfg.top_logprobs, max_tokens: cfg.max_tokens, signal, request_id }), cfg.timeout_ms);
  if (out.__timeout) return finish({ status: "reader_unavailable", reason: "timeout", raw_wire: null, decode: null, verdict: null, frame: null });
  if (out.error) return finish({ status: "reader_unavailable", reason: "error", error: String(out.error?.code ?? out.error?.message ?? out.error).slice(0, 200), raw_wire: null, decode: null, verdict: null, frame: null });
  const reply = out.value ?? {};
  const raw = typeof reply === "string" ? reply : reply.text;
  const transport = typeof reply === "object" && reply ? { model: reply.model ?? null, usage: reply.usage ?? null, transmitted: reply.transmitted ?? null } : null;
  const logprobs = typeof reply === "object" && reply ? reply.logprobs ?? null : null;
  const decoded = cfg.output === "json" ? W.decodeJsonFrame(raw, input) : W.decodeWire(raw, input);
  if (!decoded.ok) return finish({ status: "invalid", reason: "wire_decode", raw_wire: typeof raw === "string" ? raw.slice(0, 2000) : null, decode: { ok: false, errors: decoded.errors }, verdict: null, frame: null, disposition: RF.DISPOSITIONS.INVALID, logprobs, transport });
  // Code-side bounded lookup for spans the reader nominated (observer-visible lexicon only).
  const looked = applyNominatedLookup(decoded.frame, input, bindings);
  const verdict = RF.validateReaderFrame(looked.frame, looked.input);
  const disposition = RF.dispositionOf(verdict);
  let resolution = null;
  if (context) {
    try {
      resolution = resolveTurn(looked.frame, { snapshot: context.snapshot ?? null, ledger: context.ledger ?? { requests: [] } }, context.present ?? [], { verdict, input: looked.input, bindings: looked.bindings, opaque: { request_texts: opaqueRequestTexts(looked.frame, looked.input) }, canonical: context.canonical ?? {} });
    } catch (error) { resolution = { error: String(error?.message ?? error).slice(0, 200) }; }
  }
  return finish({
    status: "read", reason: null, raw_wire: raw, decode: { ok: true, errors: [] },
    frame: looked.frame, nominated_lookups: looked.lookups,
    verdict: { ok: verdict.ok, disposition: verdict.disposition, clarify_slots: verdict.clarify_slots, rejected_fields: verdict.rejected_fields, errors: Object.values(verdict.layers).flatMap((l) => l.errors ?? []), form_gate_exemptions: [...(verdict.form_gate_exemptions ?? [])] },
    disposition, abstentions: abstentionsOf(looked.frame),
    resolution, clarification_kind: resolution && !resolution.error ? clarificationKind(resolution) : null,
    logprobs, field_margins: cfg.output === "json" ? null : wireFieldMargins(logprobs), transport
  });
}

// ─── transports ──────────────────────────────────────────────────────────────────────────────────────
/** Scripted transport: a function (request) -> text | { text } | Promise, or a map request_id -> text. */
function scriptedTransport(script) {
  return async (req) => {
    const entry = typeof script === "function" ? await script(req) : script instanceof Map ? script.get(req.request_id) : script?.[req.request_id];
    return typeof entry === "string" ? { text: entry } : entry ?? { text: "" };
  };
}

/**
 * The pinned local llama.cpp runtime (OpenAI-compatible chat endpoint). Temperature 0, the per-input GBNF grammar,
 * raw token logprobs (PRE-grammar top alternatives as llama.cpp reports them; see READER_PHASE2.md §17).
 */
function llamaTransport({ endpoint, model = null, slot = null, fetchImpl = fetch } = {}) {
  return async ({ system, user, grammar, logprobs, top_logprobs, max_tokens, signal }) => {
    const body = {
      ...(model ? { model } : {}),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0, top_p: 1, top_k: 1, max_tokens, stream: false, cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
      ...(grammar ? { grammar } : {}),
      ...(logprobs ? { logprobs: true, top_logprobs: Math.max(1, top_logprobs || 10) } : {}),
      ...(slot != null ? { id_slot: slot } : {})
    };
    const r = await fetchImpl(`${endpoint}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!r.ok) throw Object.assign(new Error(`llama http ${r.status}`), { code: `HTTP_${r.status}` });
    const json = await r.json();
    const choice = json.choices?.[0] ?? {};
    return { text: String(choice.message?.content ?? "").trim(), logprobs: choice.logprobs?.content ?? null, model: json.model ?? model, usage: json.usage ?? null, timings: json.timings ?? null };
  };
}

/**
 * DEVELOPMENT-ONLY hosted teacher (never production). Sends EXACTLY the render (system + user) and the decoding
 * parameters; `transmitted` records what left the machine (byte counts and digests, plus the parameters).
 *   api: "openai-chat" (OpenAI-compatible /chat/completions) | "anthropic-messages"
 */
function hostedChatTransport({ api = "openai-chat", baseURL, apiKey, model, fetchImpl = fetch, logprobs: wantLogprobs = true } = {}) {
  if (!apiKey) throw Object.assign(new Error("hosted teacher: no API key"), { code: "AUTH_MISSING" });
  return async ({ system, user, max_tokens, signal }) => {
    let url; let headers; let body;
    if (api === "anthropic-messages") {
      url = `${baseURL ?? "https://api.anthropic.com"}/v1/messages`;
      headers = { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      body = { model, system, messages: [{ role: "user", content: user }], max_tokens: Math.max(64, max_tokens), temperature: 0 };
    } else {
      url = `${baseURL}/chat/completions`;
      headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
      body = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0, max_tokens: Math.max(64, max_tokens), ...(wantLogprobs ? { logprobs: true, top_logprobs: 5 } : {}) };
    }
    const payload = JSON.stringify(body);
    const transmitted = { api, url, model, bytes: Buffer.byteLength(payload), system_sha256: sha(system), user_sha256: sha(user), params: Object.fromEntries(Object.entries(body).filter(([k]) => !["messages", "system"].includes(k))) };
    const r = await fetchImpl(url, { method: "POST", headers, body: payload, signal });
    if (!r.ok) throw Object.assign(new Error(`hosted http ${r.status}`), { code: `HTTP_${r.status}` });
    const json = await r.json();
    const text = api === "anthropic-messages" ? (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("") : json.choices?.[0]?.message?.content ?? "";
    return { text: String(text).trim(), logprobs: api === "anthropic-messages" ? null : json.choices?.[0]?.logprobs?.content ?? null, model: json.model ?? model, usage: json.usage ?? null, transmitted };
  };
}

module.exports = { wireFieldMargins, ASYNC_READER_VERSION, ASYNC_RECEIPT_VERSION, DEFAULT_TIMEOUT_MS, LINGUISTIC_CODES, readTurnAsync, scriptedTransport, llamaTransport, hostedChatTransport, clarificationKind, abstentionsOf };
