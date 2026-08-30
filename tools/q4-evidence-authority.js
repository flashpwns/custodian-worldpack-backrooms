"use strict";

// Canonical Clear-Q4 evidence history.  This module owns record identity,
// provenance, custody and institutional access; renderers only consume its
// observer-safe render_spec.
const crypto = require("node:crypto");
const VERSION = "yellow-beast-q4-evidence-authority@v1";
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function invalid(reason) { throw Object.assign(new Error(`invalid Q4 evidence authority: ${reason}`), { code:"EVIDENCE_ARCHIVE_INVALID" }); }
function objectRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

function createState() {
  return { version: VERSION, records: {}, contradictions: {} };
}
function normalizeState(value) {
  const state = value ?? createState();
  if (state.version == null) state.version = VERSION;
  if (state.version !== VERSION) throw new Error("unsupported Q4 evidence authority");
  state.records ??= {};
  state.contradictions ??= {};
  if (!objectRecord(state.records) || !objectRecord(state.contradictions)) invalid("records and contradictions must be objects");
  return state;
}
function ensure(world) {
  world.q4_evidence_archive = normalizeState(world.q4_evidence_archive);
  return world.q4_evidence_archive;
}
function readState(world) {
  const state = world?.q4_evidence_archive;
  if (state == null) return createState();
  if (state.version !== VERSION || !objectRecord(state.records) || !objectRecord(state.contradictions)) invalid("unsupported version or container shape");
  for (const [id, record] of Object.entries(state.records)) {
    if (!objectRecord(record) || record.id !== id || typeof record.creator !== "string" || !record.creator.trim()) invalid(`record ${id} has no preserved creator`);
    if (!objectRecord(record.custody) || typeof record.custody.state !== "string" || !Object.hasOwn(record.custody, "holder") || (record.custody.holder !== null && typeof record.custody.holder !== "string") || !Array.isArray(record.custody.history)) invalid(`record ${id} has invalid custody`);
    if (!objectRecord(record.provenance) || typeof record.provenance.source !== "string" || !record.provenance.source.trim()) invalid(`record ${id} has no preserved provenance`);
    if (!Array.isArray(record.contradictions) || !record.contradictions.every((entry) => typeof entry === "string")) invalid(`record ${id} has invalid contradiction references`);
    if (typeof record.player_access !== "boolean" || typeof record.standard_available !== "boolean") invalid(`record ${id} has invalid access state`);
  }
  for (const [id, contradiction] of Object.entries(state.contradictions)) {
    if (!objectRecord(contradiction) || contradiction.id !== id || !Array.isArray(contradiction.records) || contradiction.records.length < 2 || !contradiction.records.every((recordId) => typeof recordId === "string") || typeof contradiction.state !== "string") invalid(`contradiction ${id} is malformed`);
  }
  return state;
}
function renderSpec(item) {
  const facts = { evidence_type: item.type, location: item.source_location_name ?? item.location ?? null, device: item.device ?? null, captured_at: clone(item.captured_at ?? { interval: item.interval ?? null }), visible_subjects: clone(item.visible_objects ?? []), observation: item.target_observation ?? item.condition_summary ?? null, lighting: item.environmental_conditions?.lighting ?? item.lighting ?? "unrecorded", environment:clone(item.environmental_conditions ?? null), framing: item.camera_angle ?? "field record" };
  if (/hidden(?:_|\s+)trajectory|latent(?:_|\s+)condition|unrevealed|objective hidden/i.test(JSON.stringify(facts))) throw new Error("hidden state is not valid evidence render input");
  return { version: "yellow-beast-q4-evidence-render-spec@v1", source: "canonical-evidence-record", facts, status: "not-rendered" };
}
function presentation(record) { return record.render_presentation ?? { status: record.render_status ?? "not-rendered", pipeline_version: null, artifact: null, attempts: [], last_error: null }; }
function capture(world, run, item) {
  const state = ensure(world); const id = item.id || `CQ4-E-${digest([world.world_id, run.run_id, item.type, item.source_object, item.captured_at ?? item.interval]).slice(0, 16).toUpperCase()}`;
  if (state.records[id]) return clone(state.records[id]);
  const record = { version: VERSION, id, type: item.type ?? "written-field-record", creator: item.creator ?? run.session?.startup?.player?.observer_id ?? "unknown", operation_id: item.mission_id ?? run.expedition?.mission?.id ?? null, run_id: run.run_id, timestamp: clone(item.captured_at ?? { interval: item.interval ?? 0 }), location: item.source_location ?? item.location ?? null, location_name: item.source_location_name ?? null, method: item.method ?? "unrecorded", equipment: { id: item.device_id ?? null, label: item.device ?? null }, source: { object_id: item.source_object ?? null, observation: item.target_observation ?? null, phenomenon_observation_ref:item.phenomenon_observation_ref ?? null }, provenance: { authority_event: item.capture_event ?? "evidence.recorded", creator: item.creator ?? null, conditions: clone(item.object_condition ?? null), environment:clone(item.environmental_conditions ?? null), source: item.provenance ?? "legacy/unrecorded" }, condition: item.condition_summary ?? "unrecorded", environmental_conditions:clone(item.environmental_conditions ?? null), storage: item.storage ?? "unknown", custody: { state: "carried", holder: item.custodian ?? item.creator ?? null, history: [{ state: "created", holder: item.custodian ?? item.creator ?? null, at: clone(item.captured_at ?? { interval: item.interval ?? 0 }) }] }, reporting_state: item.reporting_state ?? "unreported", standard_available: item.available_to_standard === true, institutional_confidence: "pending-review", analysis_state: "not-submitted", linked_reports: [], linked_personnel: [...new Set([item.creator, item.custodian].filter(Boolean))], contradictions: [], render_spec: renderSpec(item), render_status: "not-rendered", render_presentation: { status:"not-rendered", pipeline_version:null, artifact:null, attempts:[], last_error:null }, player_access: item.available_to_player !== false };
  state.records[id] = record; item.id = id; return clone(record);
}
function transfer(world, id, { state, holder = null, storage = null, at = null } = {}) { const record = ensure(world).records[id]; if (!record) return { ok:false, code:"EVIDENCE_UNKNOWN" }; record.custody.state = state; record.custody.holder = holder; if (storage) record.storage = storage; record.custody.history.push({ state, holder, at: clone(at) }); return { ok:true, record:clone(record) }; }
function report(world, id, messageId) { const record = ensure(world).records[id]; if (!record) return { ok:false, code:"EVIDENCE_UNKNOWN" }; record.reporting_state = "delivered"; record.linked_reports = [...new Set([...record.linked_reports, messageId])]; return { ok:true, record:clone(record) }; }
function returnToStandard(world, id, at = null) { const record = ensure(world).records[id]; if (!record) return { ok:false, code:"EVIDENCE_UNKNOWN" }; transfer(world, id, { state:"archived", holder:"Standard", storage:"Facility archive", at }); record.standard_available = true; record.reporting_state = record.reporting_state === "unreported" ? "submitted-on-return" : record.reporting_state; record.analysis_state = "pending-analysis"; return { ok:true, record:clone(record) }; }
// The only renderer-authorized mutation.  It rejects any attempt to attach
// semantic facts, captions, provider claims, or arbitrary record fields.
function setPresentation(world, id, next = {}) { const record = ensure(world).records[id]; if (!record) return { ok:false, code:"EVIDENCE_UNKNOWN" }; const allowed = ["status", "request_id", "request_revision", "pipeline_version", "provider", "provider_model", "provider_version", "seed", "attempted_at", "generated_at", "artifact", "attempts", "last_error"]; if (Object.keys(next).some((key) => !allowed.includes(key))) return { ok:false, code:"EVIDENCE_PRESENTATION_INVALID" }; const result = { ...presentation(record), ...clone(next) }; if (!/[a-z-]+/.test(String(result.status ?? ""))) return { ok:false, code:"EVIDENCE_PRESENTATION_INVALID" }; record.render_presentation = result; record.render_status = result.status; return { ok:true, record:clone(record) }; }
function contradict(world, { left, right, claim, source, state = "unresolved" }) { const records = ensure(world).records; if (!records[left] || !records[right]) return { ok:false, code:"CONTRADICTION_TARGET_UNKNOWN" }; const id = `conflict-${digest([left, right, claim, source]).slice(0,16)}`; if (!ensure(world).contradictions[id]) ensure(world).contradictions[id] = { id, records:[left,right], claim, source, state }; for (const target of [left,right]) if (!records[target].contradictions.includes(id)) records[target].contradictions.push(id); return { ok:true, contradiction:clone(ensure(world).contradictions[id]) }; }
function synchronizeReturn(world, run, returned) { for (const item of run.expedition?.evidence ?? []) { const record = capture(world, run, item); if (returned && item.available_to_player !== false) returnToStandard(world, record.id, { interval: run.expedition.clock?.interval ?? 0 }); } }
function archive(world, { observer = "player", filter = {} } = {}) { const state = readState(world); const eligible = Object.values(state.records).filter((record) => observer === "standard" ? record.standard_available : record.player_access).filter((record) => !filter.type || record.type === filter.type).filter((record) => !filter.unresolved || record.institutional_confidence === "pending-review" || record.contradictions.length || !record.standard_available).sort((a,b) => (a.timestamp?.interval ?? 0) - (b.timestamp?.interval ?? 0) || a.id.localeCompare(b.id)); return { version: VERSION, records: eligible.map(clone), contradictions: Object.values(state.contradictions).filter((entry) => entry.records.every((id) => eligible.some((record) => record.id === id))).map(clone) }; }
function validate(world) { const state = readState(world); const broken = []; for (const record of Object.values(state.records)) { if (record.custody.holder && record.custody.holder !== "Standard" && !world.characters?.[record.custody.holder] && record.custody.holder !== record.creator) broken.push(record.id); for (const id of record.contradictions) if (!state.contradictions[id]) broken.push(`${record.id}:${id}`); } for (const contradiction of Object.values(state.contradictions)) for (const id of contradiction.records) if (!state.records[id]) broken.push(`${contradiction.id}:${id}`); return { ok: broken.length === 0, broken:[...new Set(broken)] }; }
function migrateLegacyRecord(item, key) {
  if (!objectRecord(item) || typeof item.id !== "string" || !item.id || item.id !== key) invalid(`legacy record ${key} has invalid identity`);
  if (typeof item.creator !== "string" || !item.creator.trim()) invalid(`legacy record ${key} has no creator`);
  if (!Array.isArray(item.custody) || item.custody.length === 0) invalid(`legacy record ${key} has no custody history`);
  for (const [index, entry] of item.custody.entries()) if (!objectRecord(entry) || !Object.hasOwn(entry, "holder") || (entry.holder !== null && typeof entry.holder !== "string")) invalid(`legacy record ${key} has malformed custody entry ${index}`);
  if (typeof item.provenance !== "string" || !item.provenance.trim()) invalid(`legacy record ${key} has no provenance`);
  if (typeof item.availability !== "string" || !item.availability.trim()) invalid(`legacy record ${key} has no availability state`);
  if (!["observer-held", "archived", "lost", "destroyed", "unknown"].includes(item.availability)) invalid(`legacy record ${key} has unsupported availability semantics`);
  if (typeof item.available_to_player !== "boolean") invalid(`legacy record ${key} has no explicit player access state`);
  const lastCustody = item.custody.at(-1) ?? null;
  const holder = lastCustody?.holder ?? null;
  if (Array.isArray(item.contradictions) && item.contradictions.length) invalid(`legacy record ${key} has ambiguous contradiction references`);
  if (Object.hasOwn(item, "holder") && item.holder !== holder) invalid(`legacy record ${key} has conflicting custody holder`);
  if (Object.hasOwn(item, "access") || Object.hasOwn(item, "standard_available") || Object.hasOwn(item, "player_access") && item.player_access !== item.available_to_player || Object.hasOwn(item, "available_to_standard") && item.available_to_standard !== (item.availability === "archived")) invalid(`legacy record ${key} has conflicting or ambiguous access fields`);
  for (const field of ["provenance_source", "source_provenance", "provenance_detail"]) if (Object.hasOwn(item, field)) invalid(`legacy record ${key} has duplicate provenance fields`);
  return { version:VERSION, id:item.id, type:item.type ?? "legacy-record", creator:item.creator, operation_id:item.origin_run ?? null, run_id:item.origin_run ?? null, timestamp:{ interval:null }, location:item.source_location ?? null, location_name:null, method:"unknown / legacy record", equipment:{id:null,label:null}, source:{object_id:null,observation:null}, provenance:{authority_event:"legacy-record",creator:item.creator,conditions:null,source:item.provenance}, condition:"unknown / legacy record", storage:"unknown / legacy record", custody:{state:item.availability,holder,history:clone(item.custody)}, reporting_state:"unknown / legacy record", standard_available:item.availability === "archived", institutional_confidence:"pending-review", analysis_state:"unknown", linked_reports:[], linked_personnel:[item.creator], contradictions:[], render_spec:null, render_status:"not-rendered", render_presentation:{ status:"not-rendered", pipeline_version:null, artifact:null, attempts:[], last_error:null }, player_access:item.available_to_player };
}
function migrate(world) {
  const state = ensure(world);
  for (const record of Object.values(state.records)) { record.version ??= VERSION; record.render_status ??= "not-rendered"; record.render_presentation ??= { status:record.render_status, pipeline_version:null, artifact:null, attempts:[], last_error:null }; }
  for (const [key, item] of Object.entries(world.evidence ?? {})) if (!state.records[key]) state.records[key] = migrateLegacyRecord(item, key);
  readState(world);
  const result = validate(world); if (!result.ok) invalid(`broken migrated records: ${result.broken.join(", ")}`);
  return state;
}
module.exports = { VERSION, createState, ensure, readState, migrate, capture, transfer, report, returnToStandard, setPresentation, presentation, contradict, synchronizeReturn, archive, validate, renderSpec };
