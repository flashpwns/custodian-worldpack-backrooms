#!/usr/bin/env node
"use strict";
// Separate on-device machine assistance. No human/gold writer and no hosted transport.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const RP = require("./dialogue-reader-replay");
const WS = require("./dialogue-reader-labeling-workstation");
const R = require("./dialogue-reader-render");
const { llamaTransport } = require("./dialogue-reader-async");
const runtime = require("./dialogue-reader-runtime");
const { candidate, classify } = require("./dialogue-reader-machine-labeling");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const save = (f, obj) => fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n", { flag: "wx" });
const append = (f, obj) => { const fd = fs.openSync(f, "a"); try { fs.writeSync(fd, JSON.stringify(obj) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
const command = (bin, args) => { try { return execFileSync(bin, args, { encoding: "utf8" }).trim(); } catch { return null; } };
function resources() {
  const vm = command("/usr/bin/vm_stat", []);
  const swap = command("/usr/sbin/sysctl", ["vm.swapusage"]);
  return { at: new Date().toISOString(), pressure_level: Number(command("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"])), swap_used_mb: Number(swap?.match(/used = ([\d.]+)M/)?.[1]), vm_stat: vm, swap };
}
function ollamaTransport({ model, options, fetchImpl = fetch }) {
  return async ({ system, user, signal }) => {
    const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false, think: false, keep_alive: "10m", options };
    const response = await fetchImpl("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) throw Object.assign(new Error("Ollama HTTP " + response.status), { code: "HTTP_" + response.status });
    const reply = await response.json();
    if (!reply.done || reply.done_reason === "length") throw Object.assign(new Error("Local output truncated"), { code: "LOCAL_TRUNCATED" });
    return { text: reply.message?.content ?? "", model: reply.model, usage: { prompt_tokens: reply.prompt_eval_count, completion_tokens: reply.eval_count, load_ms: reply.load_duration / 1e6, prompt_ms: reply.prompt_eval_duration / 1e6, generation_ms: reply.eval_duration / 1e6 }, response_status: response.status, transmitted: { endpoint_host: "127.0.0.1:11434", system_sha256: sha(system), user_sha256: sha(user), options, think: false, local_only: true } };
  };
}
function selectPilot(groups) {
  const sorted = [...groups].sort((a, b) => a.id.localeCompare(b.id));
  const chosen = [];
  const categories = [
    ["pending_coworker_question", (i) => Boolean(i.conversation.inbound)],
    ["prior_requests", (i) => i.conversation.requests.length > 0 && !i.conversation.inbound],
    ["referent_candidates", (i) => i.referent_candidates.length > 1],
    ["long_line", (i) => i.line.tokens.length >= 12],
    ["short_context_free", (i) => i.line.tokens.length <= 6 && !i.conversation.inbound && !i.conversation.requests.length]
  ];
  for (const [kind, predicate] of categories) {
    const g = sorted.find((g) => !chosen.some((c) => c.group.id === g.id) && predicate(g.item.input));
    if (g) chosen.push({ kind, group: g });
  }
  for (const g of sorted) if (chosen.length < 5 && !chosen.some((c) => c.group.id === g.id)) chosen.push({ kind: "additional_frozen_item", group: g });
  return chosen;
}
async function main() {
  const start = Date.now();
  const source = WS.DEFAULT_DIR;
  const out = path.join(source, "machine-run-local-" + new Date().toISOString().replace(/[:.]/g, "-"));
  const ws = WS.loadWorkstation({ dir: source });
  if (ws.items.length !== 474 || ws.items.some((i) => i.integrity.length)) throw new Error("Frozen input integrity failure");
  const protectedFiles = ["worksheet.jsonl", "input-pack.json", "labels.jsonl", "journal.jsonl", "prepare-receipt.json", ...["READER_PHASE2_LABELING_REGISTRY.json", "READER_PHASE2_LABEL_GUIDE.md", "READER_PHASE2_PREREGISTRATION.md", "READER_PHASE2_DATA_PROTOCOL.md"].map((f) => "../../docs/reader/" + f)];
  const historyFiles = fs.readdirSync(source).filter((f) => f.startsWith("machine-run-")).flatMap((d) => fs.readdirSync(path.join(source, d)).filter((f) => fs.statSync(path.join(source, d, f)).isFile()).map((f) => d + "/" + f));
  const hashes = Object.fromEntries([...protectedFiles, ...historyFiles].map((f) => [f, sha(fs.readFileSync(path.join(source, f)))]));
  const tags = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
  const qwen = tags.models.find((m) => m.name === "qwen3.5:9b");
  const gemma = runtime.pinIdentity();
  const profiles = [];
  if (qwen) profiles.push({ model: qwen.name, family: qwen.details.family, runtime: "Ollama", runtime_version: (await (await fetch("http://127.0.0.1:11434/api/version")).json()).version, model_digest: qwen.digest, quantization: qwen.details.quantization_level, model_bytes: qwen.size, provider: "local-ollama", local_execution: true });
  if (gemma.present && gemma.bytes_ok) profiles.push({ model: gemma.model, family: "gemma", runtime: "llama.cpp", runtime_version: gemma.runtime, model_digest: gemma.model_sha256, quantization: gemma.quantization, provider: "local-llama.cpp", local_execution: true });
  if (!profiles.length) throw new Error("No suitable installed local model");
  fs.mkdirSync(out);
  const hardware = { model: "MacBook Pro", chip: command("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]), model_identifier: command("/usr/sbin/sysctl", ["-n", "hw.model"]), memory_bytes: Number(command("/usr/sbin/sysctl", ["-n", "hw.memsize"])), cores: Number(command("/usr/sbin/sysctl", ["-n", "hw.ncpu"])) };
  const options = { temperature: 0, seed: 474, top_k: 1, top_p: 1, num_ctx: 4096, num_predict: 384, repeat_penalty: 1 };
  const settings = { concurrency: 1, timeout_ms: 90000, max_tokens: 384, output: "wire", ollama: options, maximum_projected_full_run_minutes: 120, pilot_policy: "5/5 parsed; at least 4/5 mechanically valid; no critical pressure or >768MB added swap; then full census, retain semantic exceptions", semantic_retry: false, formatting_retries: 0 };
  save(path.join(out, "plan.json"), { created_at: new Date().toISOString(), hardware, installed_profiles: profiles, settings, source_hashes: hashes, population: 474, observer_inputs: "Frozen system + user only; grammar when supported", system_digest: R.SYSTEM_DIGEST, gold_rows_created: 0, governance_override: "Owner-authorized separate local machine route; frozen OpenAI teacher unchanged" });
  console.log(JSON.stringify({ output: out, hardware, profiles, settings }));
  console.log("Regenerating frozen resolver context locally; no capture will be persisted.");
  const { census } = WS.frozenCensus(await RP.captureCorpus());
  const groups = census.map((g) => ({ ...g, item: { input: g.item.input, bindings: g.item.bindings, context: g.item.context, stratum: g.item.stratum } }));
  const frozen = new Map(ws.items.map((i) => [i.id, i.render_digest]));
  if (groups.some((g) => frozen.get(g.id) !== g.render_digest)) throw new Error("Frozen capture drift");
  const pilots = selectPilot(groups);
  save(path.join(out, "pilot-selection.json"), pilots.map((p) => ({ id: p.group.id, kind: p.kind, render_digest: p.group.render_digest })));
  const routeResults = []; const acceptedRoutes = [];
  for (const profile of profiles) {
    const role = acceptedRoutes.length ? "reviewer" : "teacher";
    const identity = { ...profile, role, governance: "MACHINE_ONLY_NOT_HUMAN_GOLD" };
    const prefix = role + "-" + profile.family;
    const rows = new Map(); let server = null; let failure = null; let pilotReport = null;
    const routeStart = Date.now(); const baseline = resources();
    append(path.join(out, prefix + "-resources.jsonl"), baseline);
    try {
      let transport;
      if (profile.runtime === "Ollama") transport = ollamaTransport({ model: profile.model, options });
      else { server = await runtime.startServer(["--ctx-size", "4096", "--cache-ram", "0", "--no-webui", "--parallel", "1", "--n-gpu-layers", "99"]); transport = llamaTransport({ endpoint: server.endpoint, model: "yellow-beast-local", fetchImpl: fetch }); }
      let consecutiveFailures = 0;
      const onItem = (row) => {
        const group = groups.find((g) => g.id === row.id);
        let c;
        try { c = candidate(group, row, identity); } catch (e) { c = { id: group.id, render_digest: group.render_digest, provenance: "MACHINE_CANDIDATE", identity, wire: row.raw_wire ?? null, valid: false, problem: "validator_exception", detail: e.message, confidence: null, created_at: new Date().toISOString() }; }
        c.latency_ms = row.latency_ms; c.parse_success = row.receipt?.decode?.ok === true; c.runtime_usage = row.receipt?.transport?.usage ?? null;
        rows.set(c.id, c); append(path.join(out, prefix + "-candidates.jsonl"), c);
        append(path.join(out, prefix + "-receipts.jsonl"), { id: c.id, render_digest: c.render_digest, identity, status: row.status, reason: row.reason, latency_ms: row.latency_ms, usage: c.runtime_usage, output_digest: c.wire == null ? null : sha(c.wire), system_digest: R.SYSTEM_DIGEST, local_execution: true });
        consecutiveFailures = c.parse_success ? 0 : consecutiveFailures + 1;
        if (rows.size % 10 === 0 || rows.size <= 5) { const snapshot = resources(); append(path.join(out, prefix + "-resources.jsonl"), snapshot); if (snapshot.pressure_level >= 4 || snapshot.swap_used_mb - baseline.swap_used_mb > 768) throw new Error("Resource guard: pressure/swap exceeded conservative bound"); }
        console.log(prefix + " " + rows.size + "/474 " + (c.valid ? c.outcome : c.problem) + " " + c.latency_ms + "ms");
        if (consecutiveFailures >= 5) throw new Error("Repeated malformed/unavailable output; route stopped");
      };
      const cfg = { id: role, provider: profile.provider, family: profile.family, model: profile.model, transport, grammar: profile.runtime !== "Ollama", temperature: 0, max_tokens: 384, timeout_ms: 90000 };
      const armOptions = { concurrency: 1, retry: { max_retries: 0, backoff_ms: [] }, onItem };
      await RP.modelArm(pilots.map((p) => p.group), cfg, armOptions);
      const pilotRows = [...rows.values()]; const mean = pilotRows.reduce((n, c) => n + c.latency_ms, 0) / 5;
      const projected = mean * 474 / 60000;
      const after = resources();
      const passed = pilotRows.filter((c) => c.parse_success).length === 5 && pilotRows.filter((c) => c.valid).length >= 4 && projected <= 120 && after.pressure_level < 4 && after.swap_used_mb - baseline.swap_used_mb <= 768;
      pilotReport = { identity, rows: pilotRows.map((c) => ({ id: c.id, parse_success: c.parse_success, valid: c.valid, problem: c.problem, latency_ms: c.latency_ms, runtime_usage: c.runtime_usage })), parse_success: pilotRows.filter((c) => c.parse_success).length, validator_success: pilotRows.filter((c) => c.valid).length, mean_ms: mean, projected_full_minutes: projected, elapsed_ms: Date.now() - routeStart, server_load_ms: server?.load_ms ?? null, baseline, after, passed };
      save(path.join(out, prefix + "-pilot.json"), pilotReport);
      if (!passed) throw new Error("Five-item pilot failed structural/resource/runtime criteria");
      console.log(prefix + " pilot passed; projected " + projected.toFixed(1) + " minutes. Continuing corpus.");
      acceptedRoutes.push({ identity, rows });
      await RP.modelArm(groups.filter((g) => !rows.has(g.id)), cfg, armOptions);
    } catch (e) { failure = e.message; console.log(prefix + " stopped: " + failure); }
    finally {
      if (server) await server.stop();
      if (profile.runtime === "Ollama") await fetch("http://127.0.0.1:11434/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: profile.model, keep_alive: 0 }) }).catch(() => {});
    }
    routeResults.push({ identity, attempted: rows.size, generated: [...rows.values()].filter((c) => c.wire != null).length, mechanically_valid: [...rows.values()].filter((c) => c.valid).length, malformed: [...rows.values()].filter((c) => c.wire != null && !c.parse_success).length, failed: [...rows.values()].filter((c) => !c.valid).length, pending: 474 - rows.size, elapsed_ms: Date.now() - routeStart, pilot: pilotReport, failure });
  }
  acceptedRoutes.sort((a, b) => b.rows.size - a.rows.size);
  const teacher = acceptedRoutes[0]; const reviewer = acceptedRoutes[1]; const counts = {};
  for (const g of groups) {
    const t = teacher?.rows.get(g.id); const r = reviewer?.rows.get(g.id);
    const status = !t ? "PENDING" : !t.valid ? "INVALID" : t.outcome === "EXPECTED_CLARIFY" ? "UNCERTAIN" : !r ? "VALID_MACHINE_TEACHER_UNREVIEWED" : classify(t, r);
    counts[status] = (counts[status] ?? 0) + 1;
    const row = { id: g.id, render_digest: g.render_digest, provenance: "LOCAL_MACHINE_ONLY", review_status: status, teacher: t ?? null, reviewer: r ?? null, human_gold: false, confidence: null };
    append(path.join(out, "labels.jsonl"), row);
    if (!["MODEL_CONSENSUS", "VALID_MACHINE_TEACHER_UNREVIEWED"].includes(status)) append(path.join(out, "exceptions.jsonl"), row);
  }
  for (const [f, h] of Object.entries(hashes)) if (sha(fs.readFileSync(path.join(source, f))) !== h) throw new Error("Protected artifact changed: " + f);
  const summary = { hardware, population: 474, total_elapsed_ms: Date.now() - start, routes: routeResults, counts, teacher: teacher?.identity ?? null, reviewer: reviewer?.identity ?? null, gold_rows_created: 0, protected_files_verified: Object.keys(hashes).length, frozen_files_unchanged: true, previous_provider_attempts_unchanged: true, status: teacher?.rows.size === 474 ? "COMPLETED_LOCAL_MACHINE_PASS" : teacher ? "PARTIAL_LOCAL_MACHINE_PASS" : "LOCAL_PILOTS_FAILED" };
  save(path.join(out, "summary.json"), summary);
  console.log(JSON.stringify({ output: out, status: summary.status, counts }));
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { ollamaTransport, selectPilot, resources };
