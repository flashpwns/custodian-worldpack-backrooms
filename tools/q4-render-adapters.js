"use strict";

const crypto = require("node:crypto");
const VERSION = "yellow-beast-q4-render-adapters@v1";
const DEFAULTS = Object.freeze({ enabled: false, adapter: "fallback", endpoint: "http://127.0.0.1:8188", workflow: "observer-safe-q4-evidence", output_directory: "evidence-renders", timeout_ms: 3000, retry_limit: 1, quality: "documentary", automatic: true });
const clone = (value) => structuredClone(value);
function config(input = {}) { const next = { ...DEFAULTS, ...input }; if (!["fallback", "comfyui", "hosted"].includes(next.adapter)) next.adapter = "fallback"; if (typeof next.endpoint !== "string" || !/^https?:\/\//.test(next.endpoint)) next.endpoint = DEFAULTS.endpoint; next.enabled = next.enabled === true; next.automatic = next.automatic !== false; next.retry_limit = Math.max(0, Math.min(3, Number(next.retry_limit) || 0)); return next; }
function fallback(spec, reason = "renderer-unavailable") { return { status: "fallback", kind: "schematic-capture", label: "Observer-safe field capture", reason, source_fact_digest: spec.source_fact_digest, asset_id: `fallback-${spec.evidence_id ?? "record"}`, provenance: "local-deterministic-fallback" }; }
function queue(spec, settings = {}) { const cfg = config(settings); const job = { id: `render-${crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16)}`, evidence_id: spec.evidence_id, adapter: cfg.adapter, workflow: cfg.workflow, status: cfg.enabled && cfg.adapter !== "fallback" ? "queued" : "fallback-ready", attempts: 0, source_fact_digest: spec.source_fact_digest, created_at: "simulation-recorded", result: fallback(spec, cfg.enabled ? "queued-for-render" : "renderer-disabled") }; return { config: cfg, job }; }
function health(settings = {}) { const cfg = config(settings); return { adapter: cfg.adapter, enabled: cfg.enabled, status: cfg.adapter === "fallback" || !cfg.enabled ? "offline-fallback-ready" : "not-checked", endpoint: cfg.adapter === "comfyui" ? cfg.endpoint : null, workflow: cfg.workflow }; }
function complete(job, result = null) { if (!job || job.status === "complete") return clone(job); return { ...clone(job), status: result ? "complete" : "failed", result: result ?? fallback(job, "render-failed"), output_checksum: result?.output_checksum ?? null }; }
module.exports = { VERSION, DEFAULTS, config, fallback, queue, health, complete };
