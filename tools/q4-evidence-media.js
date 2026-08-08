"use strict";

// Presentation-only evidence media pipeline.  This module is intentionally
// unable to create evidence or write semantic evidence fields: it consumes a
// pre-existing record, stores an optional visual artifact, then returns a
// narrow render_presentation patch for q4-evidence-authority to apply.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const VERSION = "yellow-beast-q4-evidence-media@v1";
const PIPELINE_VERSION = "yellow-beast-evidence-render-pipeline@v1";
const ELIGIBLE_TYPES = new Set(["photographic-record", "photograph", "recovered-photographic-media", "film-frame", "scanned-visual-record"]);
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const FORBIDDEN = /hidden(?:_|\s+)trajectory|latent(?:_|\s+)condition|unrevealed|objective hidden|future state|standard-only|developer|narrator|make it scary/i;
const MIME_MAGIC = Object.freeze({
  "image/png": (bytes) => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/webp": (bytes) => bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
});
const EXTENSIONS = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const safeText = (value, label) => {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > 500 || FORBIDDEN.test(value)) throw Object.assign(new Error(`${label} is not observer-safe render data`), { code: "RENDER_SPEC_UNSAFE" });
  return value;
};

function eligible(record) { return Boolean(record?.render_spec && ELIGIBLE_TYPES.has(String(record.type ?? "").toLowerCase())); }
function requestId(record, revision = 1) { return `render-${digest([record.id, record.render_spec?.version, PIPELINE_VERSION, revision]).slice(0, 24)}`; }
function seedFor(request_id) { return parseInt(digest(request_id).slice(0, 8), 16) >>> 0; }

function validateSpec(record) {
  if (!eligible(record)) throw Object.assign(new Error("evidence is not eligible for visual rendering"), { code: "RENDER_INELIGIBLE" });
  const spec = record.render_spec;
  if (spec.version !== "yellow-beast-q4-evidence-render-spec@v1" || spec.source !== "canonical-evidence-record" || !spec.facts || typeof spec.facts !== "object") throw Object.assign(new Error("evidence render specification is invalid"), { code: "RENDER_SPEC_INVALID" });
  const facts = spec.facts;
  const visible_subjects = Array.isArray(facts.visible_subjects) ? facts.visible_subjects.map((item) => safeText(String(item), "visible subject")) : [];
  const validated = {
    evidence_id: record.id,
    evidence_type: safeText(String(facts.evidence_type ?? record.type), "evidence type"),
    location: safeText(facts.location, "location"),
    device: safeText(facts.device, "device"),
    captured_at: facts.captured_at && typeof facts.captured_at === "object" ? clone(facts.captured_at) : null,
    visible_subjects,
    observation: safeText(facts.observation, "observation"),
    lighting: safeText(facts.lighting, "lighting"),
    framing: safeText(facts.framing, "framing")
  };
  if (FORBIDDEN.test(JSON.stringify(validated))) throw Object.assign(new Error("render specification contains prohibited hidden state"), { code: "RENDER_SPEC_UNSAFE" });
  return Object.freeze(validated);
}

function requestFromSpec(spec, { request_id, seed, quality = "documentary" } = {}) {
  const details = [
    spec.location && `Location: ${spec.location}.`,
    spec.device && `Camera/equipment: ${spec.device}.`,
    spec.lighting && `Lighting: ${spec.lighting}.`,
    spec.framing && `Framing: ${spec.framing}.`,
    spec.visible_subjects.length && `Visible subjects: ${spec.visible_subjects.join(", ")}.`,
    spec.observation && `Recorded observation: ${spec.observation}.`
  ].filter(Boolean);
  return Object.freeze({ version: VERSION, pipeline_version: PIPELINE_VERSION, request_id, evidence_id: spec.evidence_id, seed, quality, prompt: ["Institutional documentary evidence photograph.", ...details].join(" "), render_spec: clone(spec) });
}

function normalizeArtifact(response) {
  if (!response || typeof response !== "object") throw Object.assign(new Error("provider returned no artifact"), { code: "RENDER_RESPONSE_INVALID" });
  const mime_type = response.mime_type;
  let bytes = response.bytes;
  if (typeof response.data_base64 === "string") bytes = Buffer.from(response.data_base64, "base64");
  if (typeof response.data_url === "string") {
    const match = response.data_url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw Object.assign(new Error("provider returned an unsupported data URL"), { code: "RENDER_RESPONSE_INVALID" });
    bytes = Buffer.from(match[2], "base64");
    if (mime_type && mime_type !== match[1]) throw Object.assign(new Error("provider media type mismatch"), { code: "RENDER_RESPONSE_INVALID" });
    return normalizeArtifact({ ...response, mime_type: match[1], bytes });
  }
  if (!MIME_MAGIC[mime_type] || !Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES || !MIME_MAGIC[mime_type](bytes)) throw Object.assign(new Error("provider returned invalid image data"), { code: "RENDER_ARTIFACT_INVALID" });
  return { mime_type, bytes, model: typeof response.model === "string" ? response.model.slice(0, 160) : null, provider_version: typeof response.provider_version === "string" ? response.provider_version.slice(0, 160) : null };
}

function artifactPath(media_root, world_id, artifact_id, mime_type) {
  if (!/^[a-z0-9_-]+$/i.test(world_id) || !/^[a-z0-9_-]+$/i.test(artifact_id)) throw new Error("unsafe media artifact identity");
  return path.join(media_root, world_id, `${artifact_id}.${EXTENSIONS[mime_type]}`);
}
function writeArtifact({ media_root, world_id, artifact_id, artifact }) {
  const file = artifactPath(media_root, world_id, artifact_id, artifact.mime_type); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, artifact.bytes); fs.renameSync(temporary, file);
  return { id: artifact_id, relative_path: path.relative(media_root, file).replace(/\\/g, "/"), mime_type: artifact.mime_type, checksum: digest(artifact.bytes), bytes: artifact.bytes.length };
}
function artifactAvailable(media_root, reference) {
  if (!reference?.relative_path || !/^[a-z0-9_./-]+$/i.test(reference.relative_path)) return false;
  const root = path.resolve(media_root); const file = path.resolve(media_root, reference.relative_path); if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return false;
  try { return reference.checksum === digest(fs.readFileSync(file)); } catch { return false; }
}
function fallback(record, reason = "rendering unavailable") { return { kind: "metadata-fallback", label: "Generated visual presentation unavailable", reason, alt: `${record.type ?? "Evidence record"} ${record.id}. Canonical metadata remains available.` }; }

class EvidenceMediaRenderer {
  constructor({ media_root, providers = {}, clock = () => new Date().toISOString(), timeout_ms = 15000 } = {}) { this.media_root = media_root; this.providers = providers; this.clock = clock; this.timeout_ms = timeout_ms; this.inflight = new Map(); }
  provider(mode) { return mode === "local" ? this.providers.local : mode === "hosted" ? this.providers.hosted : null; }
  status(settings = {}) { const mode = settings.visual_rendering === false ? "disabled" : ({ comfyui:"local", hosted:"hosted" }[settings.visual_adapter] ?? "offline"); const provider = this.provider(mode); return { pipeline_version: PIPELINE_VERSION, selected: mode, available: mode === "offline" || mode === "disabled" ? true : Boolean(provider), local: { available:Boolean(this.providers.local), selected:mode === "local" }, hosted: { available:Boolean(this.providers.hosted), selected:mode === "hosted" }, fallback:"available" }; }
  async render({ world_id, record, settings = {}, retry = false, onPresentation } = {}) {
    const current = record?.render_presentation;
    if (current?.status === "ready" && artifactAvailable(this.media_root, current.artifact)) return { ok:true, reused:true, presentation:clone(current) };
    if (!eligible(record)) return { ok:false, code:"RENDER_INELIGIBLE", fallback:fallback(record, "record is metadata-only") };
    const revision = current?.request_id ? Number(current.request_revision ?? 1) + (retry ? 1 : 0) : 1;
    const id = requestId(record, revision);
    if (this.inflight.has(id)) return this.inflight.get(id);
    const task = this.#render({ world_id, record, settings, retry, revision, request_id:id, onPresentation }).finally(() => this.inflight.delete(id)); this.inflight.set(id, task); return task;
  }
  async #render({ world_id, record, settings, revision, request_id, onPresentation }) {
    let spec; try { spec = validateSpec(record); } catch (error) { return this.#failure(record, request_id, revision, error, onPresentation); }
    const mode = this.status(settings).selected;
    if (mode === "disabled" || mode === "offline") return this.#failure(record, request_id, revision, Object.assign(new Error(mode === "disabled" ? "evidence rendering disabled" : "offline fallback selected"), { code:"RENDER_FALLBACK" }), onPresentation, "fallback");
    const provider = this.provider(mode); if (!provider?.render) return this.#failure(record, request_id, revision, Object.assign(new Error(`${mode} evidence renderer is unavailable`), { code:"RENDER_PROVIDER_UNAVAILABLE" }), onPresentation);
    const seed = seedFor(request_id); const request = requestFromSpec(spec, { request_id, seed, quality:settings.visual_quality });
    onPresentation?.({ status:"rendering", request_id, request_revision:revision, pipeline_version:PIPELINE_VERSION, provider:mode, seed, attempted_at:this.clock(), attempts:[...(record.render_presentation?.attempts ?? []), { request_id, status:"rendering", at:this.clock() }] });
    try {
      const response = await this.callProvider(provider, request); const artifact = normalizeArtifact(response); const artifact_id = `artifact-${digest([world_id, request_id, artifact.bytes]).slice(0, 24)}`; const stored = writeArtifact({ media_root:this.media_root, world_id, artifact_id, artifact });
      const presentation = { status:"ready", request_id, request_revision:revision, pipeline_version:PIPELINE_VERSION, provider:mode, provider_model:artifact.model, provider_version:artifact.provider_version, seed, generated_at:this.clock(), artifact:stored, attempts:[...(record.render_presentation?.attempts ?? []), { request_id, status:"ready", at:this.clock(), provider:mode }], last_error:null };
      onPresentation?.(presentation); return { ok:true, presentation:clone(presentation), request:clone(request) };
    } catch (error) { return this.#failure(record, request_id, revision, error, onPresentation); }
  }
  async callProvider(provider, request) { let timer; try { return await Promise.race([Promise.resolve().then(() => provider.render(request)), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("evidence renderer timed out"), { code:"RENDER_TIMEOUT" })), this.timeout_ms); })]); } finally { clearTimeout(timer); } }
  #failure(record, request_id, revision, error, onPresentation, status = "failed") { const code = error?.code ?? "RENDER_PROVIDER_FAILED"; const message = String(error?.message ?? "evidence rendering failed").slice(0, 300); const presentation = { status, request_id, request_revision:revision, pipeline_version:PIPELINE_VERSION, provider:null, attempted_at:this.clock(), artifact:null, attempts:[...(record.render_presentation?.attempts ?? []), { request_id, status, at:this.clock(), code }], last_error:{ code, message } }; onPresentation?.(presentation); return { ok:false, code, presentation:clone(presentation), fallback:fallback(record, message) }; }
}

module.exports = { VERSION, PIPELINE_VERSION, ELIGIBLE_TYPES, eligible, requestId, seedFor, validateSpec, requestFromSpec, normalizeArtifact, artifactAvailable, fallback, EvidenceMediaRenderer };
