"use strict";

// Reader Phase 1 -- the SHADOW RUNNER (seam level; developer-gated in the service).
//
//   runShadow({ receipt, input, bindings, snapshot, ledger, present, canonical }) -> shadow record (frozen) | null
//
// For one LOCAL turn it takes the reader's frame and its V0-V3 verdict (already in the receipt), cuts the OPAQUE
// request_text of every validated act from its token span (a presentation string; the resolver and the assembly
// carry it and never read it), and runs the Phase-1 shadow pipeline on CLONED, deeply FROZEN inputs:
//
//   verdict -> disposition -> resolveTurn (shadow) -> dialogue-response-policy -> dialogue-frame-assembly
//
// Nothing here writes canonical state, and nothing downstream consumes the result: production stays the
// authority. The record lives only in the in-memory developer receipt store.
//
// It also owns the READER-STATE player claim (owner ruling 3): the facet / polarity / subject a validated reading
// gave the player's statement, kept in memory by the seam and offered to the next ReaderInput as `c1` while it
// is fresh. Freshness is decided from canonical state (the latest player interaction and the ledger), never from
// persisted legacy clause predicates.

const RF = require("./dialogue-reader-frame");
const { resolveTurn } = require("./dialogue-resolve-turn");
const { assembleFrame } = require("./dialogue-frame-assembly");

const SHADOW_VERSION = "yellow-beast-reader-shadow@v1";

const deepFreeze = (v) => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };
const frozenClone = (v) => deepFreeze(v == null ? v : structuredClone(v));

/** The words of each act's validated token span, as an opaque presentation string (never interpreted). */
function opaqueRequestTexts(frame, input) {
  const tokens = input?.line?.tokens ?? [];
  const line = String(input?.line?.raw ?? "");
  return (frame?.acts ?? []).map((act) => {
    const [a, b] = Array.isArray(act?.span) ? act.span : [null, null];
    if (!Number.isInteger(a) || !Number.isInteger(b) || !tokens[a] || !tokens[b]) return null;
    return line.slice(tokens[a].start, tokens[b].end);
  });
}

/** Runs the shadow pipeline for one turn. Returns null when there is nothing to resolve (no receipt). */
function runShadow({ receipt, input, bindings, snapshot, ledger, present, canonical = {} }) {
  if (!receipt || !input || !bindings) return null;
  const started = process.hrtime.bigint();
  const frame = frozenClone(receipt.frame ?? null);
  const verdict = frozenClone(receipt.frame ? receipt.verdict : null);
  const args = {
    frame,
    state: frozenClone({ snapshot: snapshot ?? null, ledger: ledger ?? { requests: [] } }),
    present: frozenClone((present ?? []).map((p) => ({ id: p.id }))),
    options: { verdict, input: frozenClone(input), bindings: frozenClone(bindings), opaque: deepFreeze({ request_texts: opaqueRequestTexts(frame, input) }), canonical: frozenClone(canonical) }
  };
  const resolution = resolveTurn(args.frame, args.state, args.present, args.options);
  const assembled = assembleFrame({ resolution, canonical: args.options.canonical });
  return deepFreeze({
    version: SHADOW_VERSION,
    reader: receipt.reader?.id ?? null,
    disposition: resolution.disposition,
    resolution: { ...resolution },
    frame: assembled,
    consumed: false,
    elapsed_ms: Number(process.hrtime.bigint() - started) / 1e6
  });
}

/**
 * The player's claim a validated reading establishes: the primary act is a statement whose facet (the claim) is
 * a registry facet and was not rejected. Subject ids through the bindings (the speaker when unstated).
 */
function claimFromReading(receipt, bindings, { player_id = null, request_id = null } = {}) {
  const frame = receipt?.frame;
  const disposition = RF.dispositionOf(receipt?.verdict ?? null);
  if (!frame?.acts?.length || ![RF.DISPOSITIONS.ACCEPT, RF.DISPOSITIONS.REJECT_FIELDS].includes(disposition)) return null;
  const rank = { statement: 1 };
  const acts = frame.acts.map((a, i) => ({ a, i }));
  const primary = acts.filter(({ a }) => !["social_acknowledgment", "thanks", "aside"].includes(a.speech_act)).at(-1) ?? null;
  if (!primary || !rank[primary.a.speech_act] || ["NONE_ASKING", "NOT_APPLICABLE"].includes(primary.a.facet)) return null;
  if ((receipt.verdict?.rejected_fields ?? []).includes(`acts[${primary.i}].facet`)) return null;
  const subjectIds = primary.a.subject?.kind === "named" ? (primary.a.subject.names ?? []).map((l) => bindings?.names?.[l]).filter(Boolean) : player_id ? [player_id] : [];
  return { facet: primary.a.facet, polarity: primary.a.polarity ?? "positive", subject_ids: subjectIds, request_id };
}

/**
 * Freshness of a reader-state claim against canonical state: fresh only while the claim's line is the latest player
 * interaction and it opened no request. Returns the claim with its state, or null.
 */
function claimState(claim, { interactions = [], ledger = null } = {}) {
  if (!claim?.facet) return null;
  const latest = [...interactions].reverse().find((i) => i?.submission_id && String(i.channel ?? "").toLowerCase() === "local") ?? null;
  const opened = (ledger?.requests ?? []).some((r) => r.submission_id && r.submission_id === claim.request_id);
  const fresh = Boolean(latest && latest.submission_id === claim.request_id && !opened);
  return { ...claim, state: fresh ? "fresh" : "stale" };
}

module.exports = { SHADOW_VERSION, runShadow, opaqueRequestTexts, claimFromReading, claimState, frozenClone, deepFreeze };
