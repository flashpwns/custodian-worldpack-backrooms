#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const RP = require("./dialogue-reader-replay");
const WS = require("./dialogue-reader-labeling-workstation");
const W = require("./dialogue-reader-wire");
const RF = require("./dialogue-reader-frame");
const R = require("./dialogue-reader-render");
const RT = require("./dialogue-reader-runtime");
const { llamaTransport, readTurnAsync } = require("./dialogue-reader-async");
const { candidate } = require("./dialogue-reader-machine-labeling");
const { resources } = require("./dialogue-reader-local-labeling");
const ORIGINAL = "machine-run-local-2026-10-03T09-43-41-513Z";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const jsonl = (f) => fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const save = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n", { flag: "wx" });
const append = (f, o) => { const fd = fs.openSync(f, "a"); try { fs.writeSync(fd, JSON.stringify(o) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
function observerErrors(input, wire) {
  const d = W.decodeWire(wire, input);
  if (!d.ok) return d.errors;
  const v = RF.validateReaderFrame(d.frame, input);
  return ["V0", "V1", "V2"].flatMap((layer) => v.layers[layer]?.errors ?? []);
}
function repairRender(input, original, prior = null) {
  const frozen = R.renderReaderPrompt(input);
  const feedback = {
    task: "Repair your original machine-teacher output. Return only a corrected Reader wire label satisfying the frozen contract and grammar. Decide interpretation from the frozen observer input only. Mechanical diagnostics identify rejected fields; they do not supply correct interpretations. Do not invent missing facts or guess to obtain acceptance. If the words are underdetermined, use the contract's legal abstentions. No explanation or code fences.",
    original_machine_output: original.wire,
    exact_observer_mechanical_errors: observerErrors(input, original.wire),
    ...(prior ? { previous_repair_output: prior.wire, previous_repair_observer_errors: observerErrors(input, prior.wire) } : {})
  };
  const user = frozen.user + "\n\nLOCAL MACHINE REPAIR TASK\n" + JSON.stringify(feedback);
  return { ...frozen, user, user_digest: sha(user), render_digest: sha(frozen.system_digest + "\n" + user), frozen_render_digest: frozen.render_digest, feedback };
}
function walk(dir) { return fs.readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; }); }
async function main() {
  const started = Date.now(); const base = WS.DEFAULT_DIR; const originalDir = path.join(base, ORIGINAL);
  const ws = WS.loadWorkstation({ dir: base });
  const originals = jsonl(path.join(originalDir, "teacher-gemma-candidates.jsonl"));
  const invalid = originals.filter((r) => !r.valid);
  if (originals.length !== 474 || invalid.length !== 122 || originals.filter((r) => r.valid).length !== 352) throw new Error("Original population differs from authorized repair scope");
  const out = path.join(base, "machine-run-repair-" + new Date().toISOString().replace(/[:.]/g, "-"));
  const protect = walk(base).concat(["READER_PHASE2_LABELING_REGISTRY.json", "READER_PHASE2_LABEL_GUIDE.md", "READER_PHASE2_PREREGISTRATION.md", "READER_PHASE2_DATA_PROTOCOL.md"].map((f) => path.resolve(__dirname, "../docs/reader", f)));
  const hashes = Object.fromEntries(protect.map((f) => [f, sha(fs.readFileSync(f))]));
  const pin = RT.pinIdentity(); if (!pin.present || !pin.bytes_ok) throw new Error("Installed Gemma runtime/model unavailable");
  const identity = { role: "machine_teacher_repair", provider: "local-llama.cpp", runtime: "llama.cpp", runtime_version: pin.runtime, model: pin.model, model_digest: pin.model_sha256, quantization: pin.quantization, local_execution: true, human_gold: false };
  fs.mkdirSync(out);
  save(path.join(out, "plan.json"), { created_at: new Date().toISOString(), identity, original_dir: originalDir, population: 474, repair_inputs: 122, valid_originals_preserved: 352, max_repair_attempts_per_item: 2, retry_rule: "Second repair only if first remains V0/V1/V2 invalid; no resolver/semantic retry", feedback_authority: "Only raw output and exact diagnostics computed using observer-safe ReaderInput; never resolver/context/bindings/human labels", settings: { temperature: 0, top_k: 1, top_p: 1, context_tokens: 4096, max_output_tokens: 384, grammar: true, concurrency: 1, thinking: false }, protected_hashes: hashes });
  console.log(JSON.stringify({ output: out, identity, repair_inputs: 122 }));
  const byId = new Map(ws.items.map((i) => [i.id, i]));
  for (const r of originals) if (byId.get(r.id)?.render_digest !== r.render_digest) throw new Error("Original digest binding failure");
  for (const r of invalid) append(path.join(out, "repair-inputs.jsonl"), { id: r.id, render_digest: r.render_digest, original_wire: r.wire, observer_errors: observerErrors(byId.get(r.id).input, r.wire) });
  console.log("Regenerating frozen context for local validation only; model sees observer data and diagnostics only.");
  const { census } = WS.frozenCensus(await RP.captureCorpus());
  const groups = new Map(census.map((g) => [g.id, g]));
  if (originals.some((r) => groups.get(r.id)?.render_digest !== r.render_digest)) throw new Error("Replay drift");
  const baseline = resources(); append(path.join(out, "resources.jsonl"), baseline);
  const latest = new Map(); const attempts = []; let failure = null; let server = null;
  try {
    server = await RT.startServer(["--ctx-size", "4096", "--cache-ram", "0", "--no-webui", "--parallel", "1", "--n-gpu-layers", "99"]);
    const transport = llamaTransport({ endpoint: server.endpoint, model: "yellow-beast-local" });
    for (const original of invalid) {
      const group = groups.get(original.id); let prior = null;
      for (let number = 1; number <= 2; number++) {
        const render = repairRender(group.item.input, original, prior);
        // Account for template overhead; never truncate frozen input or diagnostics.
        const tokens = (await RT.tokenize(server.endpoint, render.system + "\n" + render.user)).length;
        if (tokens + 384 + 96 > 4096) throw new Error("Repair prompt exceeds bounded context; refusing truncation");
        const receipt = await readTurnAsync({ input: group.item.input, bindings: group.item.bindings, request_id: original.id + "#repair" + number, context: group.item.context, rendered: render }, { id: "repair", provider: identity.provider, model: identity.model, grammar: true, output: "wire", max_tokens: 384, temperature: 0, timeout_ms: 90000, transport });
        const c = candidate(group, { status: receipt.status, raw_wire: receipt.raw_wire, reason: receipt.reason, receipt }, identity);
        const errors = observerErrors(group.item.input, c.wire);
        const result = { ...c, provenance: "LOCAL_MACHINE_REPAIR", repair_attempt: number, original_attempt_dir: originalDir, original_output_digest: sha(original.wire ?? ""), repair_prompt_digest: render.render_digest, frozen_render_digest: original.render_digest, observer_errors: errors, parse_success: W.decodeWire(c.wire, group.item.input).ok, latency_ms: receipt.latency_ms };
        attempts.push(result); latest.set(original.id, result);
        append(path.join(out, "repair-attempts.jsonl"), result);
        append(path.join(out, "repair-receipts.jsonl"), { id: original.id, repair_attempt: number, identity, status: receipt.status, reason: receipt.reason, error: receipt.error, prompt_tokens: tokens, latency_ms: receipt.latency_ms, usage: receipt.transport?.usage, frozen_render_digest: original.render_digest, actual_system_digest: render.system_digest, actual_user_digest: render.user_digest, output_digest: sha(c.wire ?? ""), feedback_digest: sha(JSON.stringify(render.feedback)), local_execution: true });
        console.log(latest.size + "/122 attempt=" + number + " " + (c.valid ? c.outcome : c.problem));
        if (c.valid || !errors.length || receipt.status === "reader_unavailable") break;
        prior = result;
      }
      if (latest.size % 10 === 0) { const now = resources(); append(path.join(out, "resources.jsonl"), now); if (now.pressure_level >= 4 || now.swap_used_mb - baseline.swap_used_mb > 768) throw new Error("Resource guard stopped repair route"); }
    }
  } catch (e) { failure = e.message; }
  finally { if (server) await server.stop(); }
  const outcomes = {}; const exceptions = {}; let preserved = 0; let finalValid = 0;
  for (const original of originals) {
    const repaired = original.valid ? null : latest.get(original.id);
    const chosen = original.valid ? original : repaired ?? original;
    if (original.valid) preserved++;
    if (chosen.valid) { finalValid++; outcomes[chosen.outcome] = (outcomes[chosen.outcome] ?? 0) + 1; }
    const status = chosen.valid ? chosen.outcome === "EXPECTED_CLARIFY" ? "EXPECTED_CLARIFY" : "VALID_MACHINE_ACCEPT_UNREVIEWED" : repaired ? "STILL_INVALID" : "PENDING_REPAIR";
    const row = { id: original.id, render_digest: original.render_digest, provenance: "LOCAL_MACHINE_ONLY", selected_attempt: original.valid ? "ORIGINAL_VALID_UNCHANGED" : repaired ? "REPAIR_" + repaired.repair_attempt : "ORIGINAL_INVALID", candidate: chosen, human_gold: false, review_status: status };
    append(path.join(out, "final-labels.jsonl"), row);
    if (status !== "VALID_MACHINE_ACCEPT_UNREVIEWED") { const reason = chosen.valid ? "EXPECTED_CLARIFY" : chosen.problem; exceptions[reason] = (exceptions[reason] ?? 0) + 1; append(path.join(out, "exceptions.jsonl"), row); }
  }
  const changed = Object.keys(hashes).filter((f) => sha(fs.readFileSync(f)) !== hashes[f]);
  const summary = { identity, repair_inputs: invalid.length, first_repair_valid: attempts.filter((r) => r.repair_attempt === 1 && r.valid).length, second_repair_attempted: attempts.filter((r) => r.repair_attempt === 2).length, second_repair_valid: attempts.filter((r) => r.repair_attempt === 2 && r.valid).length, still_invalid: [...latest.values()].filter((r) => !r.valid).length, pending_repair: invalid.length - latest.size, malformed_before: invalid.filter((r) => !r.parse_success).length, malformed_after: [...latest.values()].filter((r) => !r.parse_success).length, final_mechanically_valid: finalValid, population: 474, outcomes, exception_categories: exceptions, elapsed_ms: Date.now() - started, original_valid_preserved: preserved, protected_files_verified: protect.length, protected_files_changed: changed, original_attempts_preserved: changed.length === 0, gold_rows_created: 0, failure };
  save(path.join(out, "summary.json"), summary); console.log(JSON.stringify({ output: out, ...summary }));
  if (changed.length || failure) process.exitCode = 1;
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { observerErrors, repairRender };
