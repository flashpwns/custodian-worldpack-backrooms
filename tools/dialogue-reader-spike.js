#!/usr/bin/env node
"use strict";

// Reader Phase 0 -- RUNTIME SPIKE (development only; never production behaviour).
//
// Launches its OWN isolated llama-server processes from the pinned runtime + bundled model, on free ports, one
// configuration at a time. The managed appliance's production flags (tools/managed-inference-appliance.js) are
// NOT changed; alternative flags exist only inside this script's spike processes.
//
// 1. CAPTURE (no model): J15 fixture lines are played through the real service with a capturing provider, so
//    the EXACT request bodies production sends (Tier-2 advisory readings, wording) and the ReaderInputs the
//    reader seam builds are collected.
// 2. MEASURE per server configuration:
//    - token counts: current advisory prompts, proposed ReaderInput prompts, the ReaderFrame decoding schema
//    - static-prefix cache behaviour (prompt tokens actually evaluated per request)
//    - interleaved reader / wording requests: does the reader's prefix survive?
//    - json_schema behaviour (valid JSON, V0 pass rate) for the ReaderFrame schema at temperature 0
//    - top_logprobs availability and shape at temperature 0 under a grammar; legal-token renormalization
//    - latency p50 / p90 for short structured outputs
//
//   node tools/dialogue-reader-spike.js [--out <file.json>] [--configs A,B,C] [--n 12]

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");
const { openSession } = require("./dialogue-session");
const { createLocalModelProvider } = require("./ai-local-model-provider");
const { DEFAULT_MODEL_NAME } = require("./managed-inference-appliance");
const registry = require("./dialogue-registry");
const RF = require("./dialogue-reader-frame");

const ROOT = path.join(__dirname, "..");
const SPIKE_VERSION = "yellow-beast-reader-runtime-spike@v1";
const PRODUCTION_ARGS = ["--ctx-size", "4096", "--cache-ram", "0", "--no-webui"];
const CONFIGS = Object.freeze({
  A: { label: "production flags (--ctx-size 4096 --cache-ram 0)", args: PRODUCTION_ARGS, slots: null },
  B: { label: "spike: 2 slots, reader pinned to slot 1 (--parallel 2 --ctx-size 8192 --cache-ram 0)", args: ["--ctx-size", "8192", "--parallel", "2", "--cache-ram", "0", "--no-webui"], slots: { reader: 1, wording: 0 } },
  C: { label: "spike: host prompt cache on (--ctx-size 4096 --cache-ram 1024)", args: ["--ctx-size", "4096", "--cache-ram", "1024", "--no-webui"], slots: null }
});

const q = (list, p) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (list) => ({ n: list.length, p50: q(list, 0.5), p90: q(list, 0.9), max: list.length ? Math.max(...list) : null });

function freePort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); }); }

async function startServer(args) {
  const binary = path.join(ROOT, "vendor", "llama", "llama-server");
  const model = path.join(ROOT, "vendor", "model", "yellow-beast-local-v1.gguf");
  if (!fs.existsSync(binary) || !fs.existsSync(model)) throw new Error("pinned runtime/model not present under vendor/");
  const port = await freePort();
  const child = spawn(binary, ["--model", model, "--alias", DEFAULT_MODEL_NAME, "--host", "127.0.0.1", "--port", String(port), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; if (log.length > 200000) log = log.slice(-100000); });
  child.stderr.on("data", (d) => { log += d; if (log.length > 200000) log = log.slice(-100000); });
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`llama-server exited (${child.exitCode}): ${log.slice(-800)}`);
    try { const r = await fetch(`${endpoint}/health`); if (r.ok) break; } catch {}
    if (Date.now() - started > 240000) { child.kill("SIGKILL"); throw new Error("llama-server not ready"); }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { endpoint, pid: child.pid, load_ms: Date.now() - started, log: () => log, stop: () => new Promise((resolve) => { if (child.exitCode != null) return resolve(); child.once("exit", resolve); child.kill("SIGTERM"); setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000); }) };
}
const post = async (endpoint, route, body) => { const r = await fetch(`${endpoint}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text }; };
const rssMb = (pid) => { try { return Math.round(Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024); } catch { return null; } };

// ── 1. capture ──────────────────────────────────────────────────────────────────────────────────────
async function capture({ scripts = ["1-terse.txt", "3-chaotic.txt"], maxLines = 30 } = {}) {
  const bodies = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    // Malformed replies: advisory fails closed (Tier 1 stands), wording falls back -- production semantics.
    return { ok: true, status: 200, json: async () => ({ id: "cap", choices: [{ message: { content: "{bad" } }] }) };
  };
  const real = createLocalModelProvider({ endpoint: "http://127.0.0.1:9", fetchImpl, timeout: 300 });
  const provider = { name: "local", model: real.model, presentLocal: (p) => real.presentLocal(p), interpretDialogue: (i) => real.interpretDialogue(i) };
  const inputs = [];
  for (const script of scripts) {
    const lines = fs.readFileSync(path.join(ROOT, "tests", "fixtures", "ed30", "j15", script), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith(":")).slice(0, maxLines);
    // Opened like the ED-30 "garbage" sessions (a local provider is configured), then the capturing provider is
    // swapped in: every advisory and wording request production makes is recorded verbatim.
    const session = await openSession({ provider: "garbage", seed: `spike-${script}`, names: ["Giselle", "Malcolm", "Tonya"] });
    session.service.localDialogueProvider = provider;
    try {
      let i = 0;
      for (const text of lines) {
        const id = `sp-${++i}`;
        await session.service.submitQ4Communication({ world_id: session.worldId, channel: "local", text, request_id: id });
        const record = session.service.readerReceipts.get(id);
        if (record?.input) inputs.push(record.input);
      }
    } finally { await session.close(); }
  }
  const kind = (b) => b.response_format?.json_schema?.name ?? "unknown";
  const natural = bodies.filter((b) => /advisory|facet/.test(kind(b))).length;
  // The gate fired on few of these lines (Tier 1 judged them complete). To measure the CURRENT Tier-2 prompt on
  // the same lines, production-shaped v2 requests are built by the production functions and sent through the
  // production provider code (captured, never answered).
  const dialogueTurn = require("./dialogue-turn");
  const advisory = require("./dialogue-advisory-interpreter");
  const scene = require("./dialogue-eval").scene();
  const cands = dialogueTurn.advisoryCandidates(scene.present, scene.entities);
  const before = bodies.length;
  for (const input of inputs) {
    const user = advisory.buildAdvisoryV2Prompt({ utterance: input.line.raw, recent: input.heard.lines.map((l) => l.text), people: cands.people, referents: cands.referents, facets: cands.facets, facet_guide: registry.advisoryFacetGuide(), context: null, needs_facet: true });
    try { await provider.interpretDialogue({ system: advisory.ADVISORY_V2_SYSTEM_TEXT, user, schema: advisory.advisoryV2Schema({ facets: cands.facets, people: cands.people, referents: cands.referents }) }); } catch {}
  }
  const synthesized = bodies.slice(before);
  const wording = bodies.slice(0, before).filter((b) => !/advisory|facet/.test(kind(b)));
  return { advisory: synthesized, natural_advisory_invocations: natural, wording, inputs, kinds: [...new Set(bodies.map(kind))] };
}

// ── the draft reader prompt (spike-only: static prefix first, the turn last) ──────────────────────────
const FACET_GUIDE = registry.advisoryFacetGuide();
const READER_SYSTEM = [
  "You read ONE line a player typed to coworkers and return a ReaderFrame: linguistic interpretation only.",
  "Never decide who answers, never name ids, never state facts. Use only labels given in the input (n = name span, e = entity span, q = earlier request, i = coworker question, r = referent, a = heard sentence, o = option, p = person).",
  "speech_act: what the clause does. address.op: NAMED (a name span said to someone), ALL, OTHERS (the rest / the others), EXCEPT, SECOND_PERSON (an unnamed 'you'), NONE.",
  "relation: new | continuation (of q or s0) | repair | topic_return | attention | answer (to i1) | withdraw. abstain: list any field you cannot tell.",
  `facet: one of the registry ids, NONE_ASKING (asks but nothing fits), NOT_APPLICABLE (asks nothing).\nFacets:\n${registry.ids().map((id) => `- ${id}${FACET_GUIDE[id] ? `: ${FACET_GUIDE[id]}` : ""}`).join("\n")}`
].join("\n");
const readerRequest = (input, { logprobs = false, slot = null, compact = false } = {}) => {
  const schema = RF.readerFrameSchema(input);
  const small = compact ? { type: "object", additionalProperties: false, required: ["speech_act", "op", "facet"], properties: { speech_act: schema.properties.acts.items.properties.speech_act, op: schema.properties.acts.items.properties.address.properties.op, facet: schema.properties.acts.items.properties.facet } } : schema;
  return {
    model: DEFAULT_MODEL_NAME,
    messages: [{ role: "system", content: READER_SYSTEM }, { role: "user", content: JSON.stringify(input) }],
    response_format: { type: "json_schema", json_schema: { name: compact ? "reader_frame_compact" : "reader_frame", strict: true, schema: small } },
    stream: false, temperature: 0, top_p: 1, max_tokens: compact ? 48 : 320,
    chat_template_kwargs: { enable_thinking: false },
    ...(logprobs ? { logprobs: true, top_logprobs: 8 } : {}),
    ...(slot != null ? { id_slot: slot } : {})
  };
};

async function tokens(endpoint, messages) {
  const tpl = await post(endpoint, "/apply-template", { messages });
  const prompt = tpl.json?.prompt ?? messages.map((m) => m.content).join("\n");
  const tok = await post(endpoint, "/tokenize", { content: prompt });
  return tok.json?.tokens?.length ?? null;
}
async function timed(endpoint, body) {
  const t = Date.now();
  const r = await post(endpoint, "/v1/chat/completions", body);
  const ms = Date.now() - t;
  const timings = r.json?.timings ?? {};
  return { ms, status: r.status, content: r.json?.choices?.[0]?.message?.content ?? null, logprobs: r.json?.choices?.[0]?.logprobs ?? null, prompt_n: timings.prompt_n ?? null, cache_n: timings.cache_n ?? null, predicted_n: timings.predicted_n ?? null, prompt_ms: timings.prompt_ms ?? null, predicted_ms: timings.predicted_ms ?? null, error: r.status !== 200 ? r.text.slice(0, 300) : null };
}

/** Where the speech_act value is decided, and what the top alternatives there are (legal vs grammar-illegal). */
function logprobShape(result) {
  const content = result.logprobs?.content ?? null;
  if (!Array.isArray(content) || !content.length) return { available: false };
  let text = "";
  let at = -1;
  for (let i = 0; i < content.length; i += 1) { text += content[i].token; if (at < 0 && /"speech_act"\s*:\s*"$/.test(text)) { at = i + 1; break; } }
  const entry = at >= 0 ? content[at] : null;
  const alts = entry?.top_logprobs ?? [];
  const legal = (tok) => RF.SPEECH_ACTS.some((s) => s.startsWith(String(tok).replace(/^"/, "")) && String(tok).replace(/^"/, "").length > 0);
  const legalAlts = alts.filter((a) => legal(a.token));
  const norm = (list) => { const z = list.reduce((s, a) => s + Math.exp(a.logprob), 0); return list.map((a) => ({ token: a.token, p: z ? Math.exp(a.logprob) / z : null })); };
  const renorm = norm(legalAlts);
  return {
    available: true,
    tokens: content.length,
    entry_keys: Object.keys(content[0] ?? {}),
    speech_act_position: at,
    chosen: entry?.token ?? null,
    top: alts.map((a) => ({ token: a.token, logprob: Math.round(a.logprob * 1000) / 1000, legal: legal(a.token) })),
    illegal_in_top: alts.filter((a) => !legal(a.token)).length,
    renormalized_margin: renorm.length >= 2 ? Math.round((renorm[0].p - renorm[1].p) * 1000) / 1000 : renorm.length === 1 ? 1 : null
  };
}

async function measureConfig(key, cap, { n = 12 } = {}) {
  const cfg = CONFIGS[key];
  const server = await startServer(cfg.args);
  const out = { config: key, label: cfg.label, args: cfg.args, load_ms: server.load_ms };
  try {
    const inputs = cap.inputs.slice(0, n);
    const slot = (role) => (cfg.slots ? cfg.slots[role] : null);
    // token counts
    out.tokens = {
      advisory_prompt: stats(await Promise.all(cap.advisory.slice(0, n).map((b) => tokens(server.endpoint, b.messages)))),
      reader_prompt: stats(await Promise.all(inputs.map((input) => tokens(server.endpoint, readerRequest(input).messages)))),
      reader_input_only: stats(await Promise.all(inputs.map(async (input) => (await post(server.endpoint, "/tokenize", { content: JSON.stringify(input) })).json?.tokens?.length ?? null))),
      reader_system_prefix: (await post(server.endpoint, "/tokenize", { content: READER_SYSTEM })).json?.tokens?.length ?? null,
      reader_schema_json_chars: stats(inputs.map((input) => JSON.stringify(RF.readerFrameSchema(input)).length)),
      wording_prompt: stats(await Promise.all(cap.wording.slice(0, n).map((b) => tokens(server.endpoint, b.messages))))
    };
    // warm-up (first request pays graph setup)
    await timed(server.endpoint, readerRequest(inputs[0], { slot: slot("reader") }));
    // current advisory replay (production bodies, production sampling)
    const adv = [];
    for (const body of cap.advisory.slice(0, n)) adv.push(await timed(server.endpoint, { ...body, ...(slot("reader") != null ? { id_slot: slot("reader") } : {}) }));
    out.advisory_replay = { latency_ms: stats(adv.map((r) => r.ms)), prompt_n: stats(adv.map((r) => r.prompt_n).filter((x) => x != null)), predicted_n: stats(adv.map((r) => r.predicted_n).filter((x) => x != null)), errors: adv.filter((r) => r.error).length };
    // reader draft, back to back (static-prefix reuse)
    const seq = [];
    for (const input of inputs) seq.push(await timed(server.endpoint, readerRequest(input, { slot: slot("reader") })));
    const v0 = seq.map((r) => { try { return RF.validateSchema(JSON.parse(r.content), inputs[seq.indexOf(r)]).ok; } catch { return false; } });
    out.reader_back_to_back = { latency_ms: stats(seq.map((r) => r.ms)), prompt_n: stats(seq.map((r) => r.prompt_n).filter((x) => x != null)), cache_n: stats(seq.map((r) => r.cache_n).filter((x) => x != null)), predicted_n: stats(seq.map((r) => r.predicted_n).filter((x) => x != null)), json_valid: seq.filter((r) => { try { JSON.parse(r.content); return true; } catch { return false; } }).length, v0_valid: v0.filter(Boolean).length, n: seq.length, errors: seq.filter((r) => r.error).map((r) => r.error).slice(0, 2) };
    // interleaved: a production wording request before every reader request
    const inter = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const wording = cap.wording[i % Math.max(1, cap.wording.length)];
      if (wording) await timed(server.endpoint, { ...wording, ...(slot("wording") != null ? { id_slot: slot("wording") } : {}) });
      inter.push(await timed(server.endpoint, readerRequest(inputs[i], { slot: slot("reader") })));
    }
    out.reader_interleaved = { latency_ms: stats(inter.map((r) => r.ms)), prompt_n: stats(inter.map((r) => r.prompt_n).filter((x) => x != null)), cache_n: stats(inter.map((r) => r.cache_n).filter((x) => x != null)) };
    // short structured output (3 closed fields)
    const short = [];
    for (const input of inputs) short.push(await timed(server.endpoint, readerRequest(input, { compact: true, slot: slot("reader") })));
    out.reader_compact_3_fields = { latency_ms: stats(short.map((r) => r.ms)), predicted_n: stats(short.map((r) => r.predicted_n).filter((x) => x != null)), json_valid: short.filter((r) => { try { JSON.parse(r.content); return true; } catch { return false; } }).length, n: short.length };
    // logprobs at T=0 under the grammar (default, and post-sampling)
    const lp = await timed(server.endpoint, readerRequest(inputs[1] ?? inputs[0], { logprobs: true, slot: slot("reader") }));
    const lpPost = await timed(server.endpoint, { ...readerRequest(inputs[1] ?? inputs[0], { logprobs: true, slot: slot("reader") }), post_sampling_probs: true });
    out.logprobs = { default: logprobShape(lp), post_sampling_probs: logprobShape(lpPost), latency_ms_with_logprobs: lp.ms };
    out.server_rss_mb = rssMb(server.pid);
  } finally { await server.stop(); }
  return out;
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
  const configs = (arg("--configs") ?? "A,B,C").split(",").filter((k) => CONFIGS[k]);
  const n = Number(arg("--n") ?? 12);
  const cap = await capture();
  process.stderr.write(`captured ${cap.advisory.length} advisory, ${cap.wording.length} wording bodies, ${cap.inputs.length} reader inputs (${cap.kinds.join(", ")})\n`);
  const result = { version: SPIKE_VERSION, measured_at: new Date().toISOString(), hardware: (() => { try { return { cpu: execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"]).toString().trim(), mem_gb: Math.round(Number(execFileSync("sysctl", ["-n", "hw.memsize"]).toString()) / 2 ** 30) }; } catch { return null; } })(), runtime_pin: require("./local-runtime-pin.json").llama_cpp.tag, model: require("./local-runtime-pin.json").model.internal_filename, captured: { advisory_bodies_production_shaped: cap.advisory.length, natural_gate_invocations_on_capture_lines: cap.natural_advisory_invocations, wording_bodies: cap.wording.length, reader_inputs: cap.inputs.length }, n, configs: [] };
  for (const key of configs) { process.stderr.write(`config ${key}...\n`); result.configs.push(await measureConfig(key, cap, { n })); }
  const out = arg("--out");
  if (out) fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  console.log(JSON.stringify(result, null, 1));
}

if (require.main === module) main().catch((error) => { console.error(error.stack ?? error.message); process.exit(1); });

module.exports = { SPIKE_VERSION, CONFIGS, READER_SYSTEM, readerRequest, logprobShape, capture };
