#!/usr/bin/env node
"use strict";

// Development-only machine candidates. Never writes to the human workstation or gold registry.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const RP = require("./dialogue-reader-replay");
const WS = require("./dialogue-reader-labeling-workstation");
const L = require("./dialogue-reader-labels");
const W = require("./dialogue-reader-wire");
const R = require("./dialogue-reader-render");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const append = (p, v) => { const fd = fs.openSync(p, "a"); try { fs.writeSync(fd, JSON.stringify(v) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };

function candidate(group, row, identity) {
  const base = { id: group.id, render_digest: group.render_digest, provenance: "MACHINE_CANDIDATE", identity, response_model: row.receipt?.transport?.model ?? null, created_at: new Date().toISOString(), wire: row.raw_wire ?? null, confidence: null, confidence_basis: "Frozen wire prompt supplies no calibrated confidence", transport_status: row.status };
  if (row.status !== "read") return { ...base, valid: false, problem: row.reason ?? row.status };
  const decoded = W.decodeWire(row.raw_wire, group.item.input);
  if (!decoded.ok) return { ...base, valid: false, problem: "label_fails_V0" };
  const resolved = RP.resolveFrame(group.item, decoded.frame);
  const outcome = resolved.resolution?.outcome === "resolved" ? "ACCEPT" : "EXPECTED_CLARIFY";
  const act = RP.primaryAct(resolved.frame);
  const fields = [...(act?.abstain ?? []), ...(act?.referent?.candidate === "AMBIGUOUS" ? ["referent"] : []), "discourse_state"];
  let validation; let expected = null;
  if (outcome === "ACCEPT") validation = L.validateGoldFrame(group.item, row.raw_wire, outcome);
  else for (const field of fields) {
    expected = { field, slot: resolved.resolution?.clarification?.slot, note: "Machine ambiguity candidate; requires review" };
    validation = L.validateGoldFrame(group.item, row.raw_wire, outcome, expected);
    if (validation.ok) break;
  }
  return { ...base, outcome, expected_clarify: outcome === "EXPECTED_CLARIFY" ? expected : null, valid: Boolean(validation?.ok), problem: validation?.problem ?? null, detail: validation?.detail ?? null, semantic_wire: validation?.ok ? W.encodeWire(validation.frame, group.item.input) : null };
}

function classify(teacher, reviewer) {
  if (!teacher || !reviewer) return "AWAITING_PROVIDER";
  if ([teacher, reviewer].some((c) => c.transport_status === "reader_unavailable")) return "AWAITING_PROVIDER";
  if (!teacher.valid || !reviewer.valid) return "INVALID_OR_UNAVAILABLE";
  if (teacher.outcome !== reviewer.outcome || teacher.semantic_wire !== reviewer.semantic_wire) return "DISAGREEMENT";
  if (teacher.outcome === "EXPECTED_CLARIFY") return "AGREED_UNCERTAIN";
  return "MODEL_CONSENSUS";
}

async function main(argv = process.argv.slice(2), { apiKeys = null } = {}) {
  const arg = (k) => argv[argv.indexOf(k) + 1];
  const has = (k) => argv.includes(k);
  const source = path.resolve(arg("--dir") && has("--dir") ? arg("--dir") : WS.DEFAULT_DIR);
  const out = path.resolve(has("--out") ? arg("--out") : path.join(source, "machine-run-" + new Date().toISOString().replace(/[:.]/g, "-")));
  if (out === source || out.startsWith(source + path.sep) && !path.basename(out).startsWith("machine-run-")) throw new Error("Use a separate machine-run directory");
  const ws = WS.loadWorkstation({ dir: source });
  if (ws.items.length !== 474 || ws.items.some((i) => i.integrity.length)) throw new Error("Frozen workstation integrity failure");
  const receipt = JSON.parse(fs.readFileSync(path.join(source, "prepare-receipt.json")));
  const protectedFiles = ["worksheet.jsonl", "input-pack.json", "labels.jsonl", "journal.jsonl", ...["READER_PHASE2_LABELING_REGISTRY.json", "READER_PHASE2_LABEL_GUIDE.md", "READER_PHASE2_PREREGISTRATION.md", "READER_PHASE2_DATA_PROTOCOL.md"].map((f) => "../../docs/reader/" + f), "../../docs/acceptance/reader-phase2/teacher-dev-sample.json", "../../docs/acceptance/reader-phase2/dev-manifest.json"];
  const hashes = Object.fromEntries(protectedFiles.map((f) => [f, sha(fs.readFileSync(path.join(source, f)))]));
  if (hashes["worksheet.jsonl"] !== receipt.worksheet_sha256 || hashes["input-pack.json"] !== receipt.input_pack_sha256) throw new Error("Frozen preparation hashes changed");
  const registry = L.loadRegistry();
  const teacher = { role: "teacher", family: registry.teacher.family, provider: has("--openrouter") ? "openrouter" : registry.teacher.provider, model: (has("--openrouter") ? "openai/" : "") + registry.teacher.model, registry_identity: registry.teacher, provider_override: has("--openrouter") ? "Owner-approved machine-only OpenRouter route; frozen registry unchanged" : null };
  const reviewer = { role: "reviewer", family: registry.automated_reviewer.family, provider: has("--openrouter") ? "openrouter" : registry.automated_reviewer.provider, model: has("--reviewer-model") ? arg("--reviewer-model") : registry.automated_reviewer.model, registry_identity: registry.automated_reviewer, provider_override: has("--openrouter") ? "Owner-approved machine-only OpenRouter route; frozen registry unchanged" : null };
  const budget = has("--max-output-tokens") ? Number(arg("--max-output-tokens")) : 8192;
  if (!Number.isInteger(budget) || budget <= 0) throw new Error("Invalid output budget");
  const identities = [teacher, reviewer];
  const keys = apiKeys ?? (has("--openrouter") ? [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY] : [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY]);
  if (has("--run") && (!keys[0] || (!has("--teacher-only") && (!keys[1] || !reviewer.model)) || !has("--confirm-egress"))) throw new Error("Run requires provider access, --reviewer-model (unless --teacher-only), and --confirm-egress; keys are never saved");
  if (reviewer.family === teacher.family) throw new Error("Reviewer must be independent of teacher family");
  const plan = { version: "reader-machine-candidates@v1", created_at: new Date().toISOString(), source, source_hashes: hashes, population: 474, teacher, reviewer, max_output_tokens: budget, status: has("--run") ? "RUNNING" : "BLOCKED_PROVIDER_ACCESS", gold_rows_created: 0, human_trace_requested: has("--include-human-trace"), transmitted: "Frozen system + user renders only", privacy: "OpenAI store:false enforced; provider retention/training unknown; no reasoning text retained", semantics: "Separate machine assistance; no frozen experiment changes, human primary, adjudicated gold or teacher-ceiling scoring" };
  if (has("--resume")) {
    const old = JSON.parse(fs.readFileSync(path.join(out, "plan.json")));
    for (const k of ["source", "source_hashes", "teacher", "reviewer", "max_output_tokens", "human_trace_requested"])
      if (JSON.stringify(old[k]) !== JSON.stringify(plan[k])) throw new Error("Resume configuration drift: " + k);
  } else {
    fs.mkdirSync(out, { recursive: false });
    write(path.join(out, "plan.json"), plan);
  }
  console.log(JSON.stringify({ output: out, population: 474, status: plan.status, teacher, reviewer, budget }));
  const machines = [new Map(), new Map()];
  const sample = JSON.parse(fs.readFileSync(RP.TEACHER_SAMPLE_FILE));
  if (sha(fs.readFileSync(RP.TEACHER_SAMPLE_FILE)) !== RP.TEACHER_SAMPLE_SHA256) throw new Error("Frozen sample changed");
  const ids = new Set(sample.headline.map((x) => x.id));
  if (ids.size !== 474 || ws.items.some((x) => !ids.has(x.id))) throw new Error("Worksheet differs from frozen census");
  let runFailure = null;
  if (has("--run")) try {
    console.log("Regenerating frozen development context locally for V0–V3/resolver validation; capture will not be saved.");
    const captured = await RP.captureCorpus();
    const { census } = WS.frozenCensus(captured);
    const groups = census.map((g) => ({ ...g, item: { input: g.item.input, bindings: g.item.bindings, context: g.item.context, stratum: g.item.stratum } }));
    const byId = new Map(ws.items.map((i) => [i.id, i]));
    if (groups.some((g) => g.render_digest !== byId.get(g.id)?.render_digest)) throw new Error("Regenerated corpus differs from worksheet");
    const runs = [];
    const pilotGroups = RP.stratifiedSample(groups, 3, { seed: 4742026 });
    for (let n = 0; n < (has("--teacher-only") ? 1 : 2); n++) {
      const identity = identities[n];
      const api = has("--openrouter") ? "openai-chat" : n ? "anthropic-messages" : "openai-chat";
      const baseURL = has("--openrouter") ? "https://openrouter.ai/api/v1" : n ? "https://api.anthropic.com" : "https://api.openai.com/v1";
      const candidatesFile = path.join(out, identity.role + "-candidates.jsonl");
      if (has("--resume") && fs.existsSync(candidatesFile)) {
        for (const line of fs.readFileSync(candidatesFile, "utf8").split("\n").filter(Boolean)) {
          const c = JSON.parse(line);
          const g = groups.find((x) => x.id === c.id);
          if (!g || g.render_digest !== c.render_digest || machines[n].has(c.id) || JSON.stringify(c.identity) !== JSON.stringify(identity)) throw new Error("Invalid resume candidate binding");
          const checked = candidate(g, { status: c.transport_status, raw_wire: c.wire, reason: c.problem }, identity);
          machines[n].set(c.id, { ...checked, created_at: c.created_at });
        }
      }
      const receipts = path.join(out, identity.role + "-receipts-" + Date.now() + ".jsonl");
      const params = { max_output_tokens: budget };
      const egress = RP.egressPlan(groups, { api, baseURL, ...identity, params, confirm: true, includeHumanTrace: has("--include-human-trace"), receipts });
      console.log(JSON.stringify(egress.summary));
      if (!egress.ok) throw new Error(egress.refusal);
      const onItem = (row) => {
        const g = groups.find((x) => x.id === row.id);
        const c = candidate(g, row, identity);
        machines[n].set(c.id, c);
        append(candidatesFile, c);
        console.log(identity.role + " " + machines[n].size + "/" + egress.units.length + " " + (c.valid ? c.outcome : c.problem));
      };
      const config = { api, baseURL, apiKey: keys[n], ...identity, maxOutputTokens: budget, maxTokensParam: n ? undefined : "max_completion_tokens", reasoningEffort: n ? null : "high", concurrency: 2, onItem };
      const pending = egress.units.filter((g) => !machines[n].has(g.id));
      const selected = pilotGroups.filter((g) => egress.units.some((u) => u.id === g.id));
      const pilotPending = selected.filter((g) => !machines[n].has(g.id));
      if (pilotPending.length) await RP.hostedArm(pilotPending, { ...config, concurrency: 1, receipts: receipts.replace(".jsonl", "-pilot.jsonl") });
      const checks = selected.map((g) => ({ id: g.id, valid: machines[n].get(g.id)?.valid === true, problem: machines[n].get(g.id)?.problem ?? null }));
      write(path.join(out, identity.role + "-pilot-validation-" + Date.now() + ".json"), { identity, checks, passed: checks.length > 0 && checks.every((c) => c.valid) });
      if (!checks.length || checks.some((c) => !c.valid)) throw new Error(identity.role + " pilot did not produce mechanically valid structured labels; stopped before census fan-out.");
      runs.push({ n, config, receipts, units: egress.units });
    }
    console.log("Both model pilots passed; continuing full frozen corpus.");
    for (const run of runs) await RP.hostedArm(run.units.filter((g) => !machines[run.n].has(g.id)), { ...run.config, receipts: run.receipts });
  } catch (error) { runFailure = error.message; }
  const counts = {};
  // Recomputed reports live in a fresh directory so resume never duplicates or overwrites earlier evidence.
  const reports = has("--resume") ? path.join(out, "report-" + Date.now()) : out;
  if (reports !== out) fs.mkdirSync(reports);
  for (const it of ws.items) {
    const t = machines[0].get(it.id); const r = machines[1].get(it.id);
    const status = classify(t, r);
    counts[status] = (counts[status] ?? 0) + 1;
    const row = { id: it.id, render_digest: it.render_digest, provenance: status === "MODEL_CONSENSUS" ? status : "MACHINE_CANDIDATE", review_status: status, confidence: null, confidence_basis: status === "MODEL_CONSENSUS" ? "Independent full-wire agreement and mechanical validity; not a calibrated probability" : "Unavailable or requires review", teacher: t ?? null, reviewer: r ?? null, human_gold: false };
    append(path.join(reports, "status.jsonl"), row);
    if (status === "MODEL_CONSENSUS") append(path.join(reports, "agreements.jsonl"), row);
    else if (status === "AWAITING_PROVIDER") append(path.join(reports, "pending-provider.jsonl"), row);
    else append(path.join(reports, "exceptions.jsonl"), row);
  }
  for (const [f, hash] of Object.entries(hashes)) if (sha(fs.readFileSync(path.join(source, f))) !== hash) throw new Error("Human workstation changed during run: " + f);
  const perModel = machines.map((m, n) => { const rows = [...m.values()]; return { role: identities[n].role, attempted: rows.length, generated: rows.filter((c) => typeof c.wire === "string").length, valid: rows.filter((c) => c.valid).length, failed: rows.filter((c) => !c.valid).length, pending: 474 - rows.length }; });
  write(path.join(reports, "summary.json"), { population: 474, counts, per_model: perModel, teacher_candidates: machines[0].size, reviewer_candidates: machines[1].size, failure: runFailure, gold_rows_created: 0, frozen_files_unchanged: true, status: runFailure ? "BLOCKED_PROVIDER_RUN" : has("--run") ? "COMPLETED_MACHINE_PASS" : "BLOCKED_PROVIDER_ACCESS" });
  console.log(JSON.stringify(counts));
  if (runFailure) throw new Error(runFailure);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { candidate, classify, main };
