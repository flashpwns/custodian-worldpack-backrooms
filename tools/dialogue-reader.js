"use strict";

// Reader Phase 0 -- the READER SEAM: the one interface through which a turn's language is read.
//
//   reader.read({ request_id, input, legacy }) -> ReaderFrame v1 (or null)
//
//   input   the observer-safe ReaderInput (dialogue-reader-input.js). A model reader sees ONLY this.
//   legacy  { analysis, frame } -- the current parser's finished result. Only the legacy reader v0 (code, not
//           a model) may use it; it is how the current behaviour is expressed through the new contract.
//
// Phase 0 readers are SYNCHRONOUS and ADVISORY-FREE: the legacy reader v0 (frameFromLegacy) and a scripted
// ORACLE for tests and the gold-DIS evaluator. No live model reader exists yet. Production behaviour is
// unchanged: the service records a receipt of what the reader said and what V0-V3 made of it; nothing
// downstream consumes it until the Phase-1 resolver extraction is reviewed.

const crypto = require("node:crypto");
const RF = require("./dialogue-reader-frame");
const { frameFromLegacy } = require("./dialogue-reader-legacy");
const { READER_INPUT_VERSION } = require("./dialogue-reader-input");

const READER_SEAM_VERSION = "yellow-beast-reader-seam@v1";
const RECEIPT_VERSION = "yellow-beast-reader-receipt@v1";
const MAX_RECEIPTS = 200;

const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** The legacy reader v0: the current parser's decisions, expressed as a ReaderFrame (never a new reading). */
function createLegacyReaderV0() {
  return Object.freeze({
    id: "legacy-v0",
    kind: "legacy",
    version: "yellow-beast-reader-legacy-v0@v1",
    read({ input, bindings, legacy }) {
      if (!legacy?.analysis) return { frame: null, conversion: null };
      return frameFromLegacy(legacy.analysis, { input, bindings }, { frame: legacy.frame ?? null, primary: legacy.primary ?? null });
    }
  });
}

/**
 * A scripted oracle reader (tests / gold-DIS evaluation). `script` maps a request id -- or, as a fallback, the
 * exact raw line -- to a ReaderFrame (or a function (input) -> ReaderFrame). It never sees legacy output.
 */
function createOracleReader(script = {}) {
  const lookup = (key) => (script instanceof Map ? script.get(key) : script[key]);
  const seen = [];
  return Object.freeze({
    id: "oracle",
    kind: "oracle",
    version: "yellow-beast-reader-oracle@v1",
    seen,
    read({ request_id, input }) {
      seen.push({ request_id, input_digest: digest(input) });
      const entry = lookup(request_id) ?? lookup(input?.line?.raw);
      const frame = typeof entry === "function" ? entry(input) : entry ?? null;
      return { frame: frame ? structuredClone(frame) : null, conversion: null };
    }
  });
}

/**
 * One reading through the seam: the reader is called with the input (and, for v0 only, the legacy result),
 * the frame is validated (V0-V3), and a receipt is produced. The receipt pins the input digest, the reader
 * identity and the verdict; it never contains canonical ids (bindings stay with code).
 */
function readTurn(reader, { request_id, input, bindings, legacy = null }) {
  const started = process.hrtime.bigint();
  let output = null;
  let error = null;
  try { output = reader.read({ request_id, input, bindings: reader.kind === "legacy" ? bindings : undefined, legacy: reader.kind === "legacy" ? legacy : undefined }); } catch (e) { error = String(e?.message ?? e); }
  const frame = output?.frame ?? null;
  const verdict = frame ? RF.validateReaderFrame(frame, input) : null;
  return Object.freeze({
    version: RECEIPT_VERSION,
    request_id,
    seam: READER_SEAM_VERSION,
    reader: { id: reader.id, kind: reader.kind, version: reader.version },
    input_version: READER_INPUT_VERSION,
    input_digest: digest(input),
    frame_version: RF.READER_FRAME_VERSION,
    frame,
    conversion: output?.conversion ?? null,
    verdict: verdict ? { ok: verdict.ok, disposition: verdict.disposition, clarify_slots: verdict.clarify_slots, rejected_fields: verdict.rejected_fields, errors: Object.values(verdict.layers).flatMap((l) => l.errors ?? []) } : null,
    error,
    consumed: false, // Phase 0: no downstream consumer; production behaviour is the legacy pipeline
    elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6
  });
}

/**
 * The VALUE-LEVEL record of what the legacy pipeline decided for one turn: every effective act with its facet
 * source, addressee source, args, overrides, repair metadata and clarification. This is the characterization
 * and round-trip view of production behaviour (the stored turn record drops facet_source and overrides). It is
 * never given to a reader and never persisted.
 */
function legacyActRecord(e) {
  if (!e) return null;
  return {
    speech_act: e.speech_act ?? null, question_form: e.question_form ?? null, relation: e.relation ?? null,
    relation_target: e.relation_target ?? null, reissue_of: e.reissue_of ?? null, reopen: Boolean(e.reopen),
    predicate: e.predicate ?? null, facet_source: e.facet_source ?? null,
    fn_hint: e.fn_hint ?? null, request_text: e.request_text ?? null,
    addressee: e.addressee ? { kind: e.addressee.kind ?? null, ids: [...(e.addressee.ids ?? [])], quantifier: e.addressee.quantifier ?? null, source: e.addressee.source ?? null, ...(e.addressee.second_person ? { second_person: true } : {}), ...(e.addressee.mismatch ? { mismatch: true } : {}), ...(e.addressee.absent ? { absent: [...e.addressee.absent] } : {}) } : null,
    cardinality: e.cardinality ?? null, temporal_scope: e.temporal_scope ?? null, polarity: e.polarity ?? e.act?.polarity ?? null,
    args: e.args ? structuredClone(e.args) : {}, repair: e.repair ? structuredClone(e.repair) : null,
    clarify: e.clarify ? { reason: e.clarify.reason ?? null, slot: e.clarify.slot ?? null } : null,
    overrides: (e.overrides ?? []).map((o) => ({ ...o })), advisory_filled: [...(e.advisory_filled ?? [])],
    activity: e.activity ? { ...e.activity } : null, alternatives: e.alternatives ?? null,
    clause_speech_act: e.act?.speech_act ?? null
  };
}
function legacyRecord(legacy) {
  const analysis = legacy?.analysis ?? null;
  if (!analysis) return null;
  return {
    effective: (analysis.effective ?? []).map(legacyActRecord),
    primary_index: (analysis.effective ?? []).indexOf(analysis.primary),
    // The primary act the service actually finalized (an address correction may have replaced it).
    primary_used: legacyActRecord(legacy.primary ?? analysis.primary),
    social: (analysis.social ?? []).map((x) => ({ speech_act: x.speech_act })),
    completeness: analysis.completeness ? { complete: analysis.completeness.complete, missing: [...analysis.completeness.missing] } : null,
    advisory: analysis.advisory?.state ? { applied: Boolean(analysis.advisory.applied), accepted: Boolean(analysis.advisory.state.accepted), reason: analysis.advisory.state.reason ?? null } : null
  };
}
/** What the developer trace shows of a seam record: never the code-side context (bindings carry canonical ids). */
function traceView(record) {
  if (!record) return null;
  // Never shown: the code-side context (bindings carry canonical ids), production's routing record and the
  // Phase-1 shadow resolution (developer memory for the harnesses only; no renderer / UI exposure).
  const { context, shadow, production_routing, ...visible } = record;
  return visible;
}

/** A bounded in-memory receipt store (developer trace only; never persisted in Phase 0). */
function createReceiptStore(limit = MAX_RECEIPTS) {
  if (!Number.isInteger(limit) || limit < 1) limit = MAX_RECEIPTS;
  const map = new Map();
  return Object.freeze({
    put(requestId, record) { map.set(requestId, record); while (map.size > limit) map.delete(map.keys().next().value); },
    get(requestId) { return map.get(requestId) ?? null; },
    all() { return [...map.values()]; },
    size() { return map.size; }
  });
}

module.exports = { READER_SEAM_VERSION, RECEIPT_VERSION, MAX_RECEIPTS, createLegacyReaderV0, createOracleReader, readTurn, createReceiptStore, legacyActRecord, legacyRecord, traceView, digest };
