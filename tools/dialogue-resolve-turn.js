"use strict";

// Reader Phase 0 -- the PURE RESOLUTION SEAM: resolveTurn(readerFrame, dialogueState, presentActors).
//
// CONTRACT (the boundary Phase 1 will fill; nothing here reads player language):
//   input   a VALIDATED ReaderFrame v1 (linguistic interpretation only), the canonical dialogue state (DIS
//           snapshot + ledger) and the present actors. Plus the ReaderInput bindings (label -> id), which are
//           code's own mapping.
//   output  the effective acts the rest of the pipeline already consumes (dialogue-turn analyzeTurn's
//           `effective` / `primary` shape), so finalizeFrame, openTurnRequests and the planner are unchanged.
//
//   It will OWN (deterministic policy, never the reader's):
//     address-op resolution to ids (NAMED / ALL / OTHERS / EXCEPT / SECOND_PERSON / NONE -> ids; chip wins)
//     responder priority (owner decision 2026-09-27 #1: explicit > repair target > antecedent owner >
//       activity > knower > rotation), inheritance vs rotation, "who has answered" (ledger answered_by UNION
//       activity completed -- one function)
//     response cardinality (registry default_cardinality x respondent_mode x address op)
//     temporal defaults (registry default_temporal / temporal_support) when the line expressed none
//     request open / reopen / withdraw (ledger operations chosen from relation + target)
//     inbound-answer routing (answer -> the asker; counter-question; own-answer repair)
//     remark / sarcasm silence (owner decision 2026-09-27 #2) as a function of speech act + address
//
// PHASE 0: only the wrapper exists. It REQUIRES the legacy analysis and returns it unchanged
// (source "legacy_passthrough"), recording what the frame-driven resolver would have been given. Nothing is
// deleted; no output changes. A frame-driven resolveTurn is Phase 1, gated by the characterization snapshot.

const RESOLVE_TURN_VERSION = "yellow-beast-resolve-turn@v0-passthrough";

/** The fields a Phase-1 resolver will own, each with the current legacy owner(s) it replaces. */
const RESOLVER_OWNERSHIP = Object.freeze({
  address_resolution: ["dialogue-turn.resolveAddressee", "dialogue-interpretation.parseAddressees", "dialogue-discourse.resolveAddressCorrection", "dialogue-discourse.resolveRecipientScope", "dialogue-interpretation.inferLocalRecipientType", "dialogue-turn.addressFromTurn", "desktop/service.js advisory addressee_text_span rescue"],
  responder_priority: ["dialogue-turn.resolveAddressee (inheritance)", "dialogue-turn.analyzeTurn (answer_owner / antecedent_owner / activity_remaining)", "dialogue-interpretation.resolveResponseOwners"],
  rotation: ["dialogue-turn.ownersByCardinality", "dialogue-interpretation.resolveResponseOwners (spokesperson)"],
  cardinality: ["dialogue-turn.cardinalityFor"],
  temporal_defaults: ["dialogue-turn.analyzeTurn (cue temporal)", "dialogue-turn.applyAdvisory (facet modal temporal)"],
  request_lifecycle: ["dialogue-state.openTurnRequests (unchanged; fed by the resolver's effective acts)"],
  inbound_answer_routing: ["dialogue-turn.analyzeTurn (inboundAnswer / REPLY_* / open_question_answer)"],
  remark_silence: ["dialogue-turn.cardinalityFor", "dialogue-interpretation.resolveResponseOwners (REMARK_ACTS, SOCIAL_UNTARGETED_PATTERNS)"]
});

/**
 * Phase-0 wrapper. Throws without a legacy analysis (there is no frame-driven resolver yet); otherwise returns
 * the legacy effective acts untouched, plus a record of the frame it was handed.
 */
function resolveTurn(readerFrame, dialogueState, presentActors = [], { legacy = null } = {}) {
  if (!legacy?.analysis) throw Object.assign(new Error("resolveTurn: frame-driven resolution is Phase 1; Phase 0 requires the legacy analysis"), { code: "RESOLVER_NOT_IMPLEMENTED" });
  const analysis = legacy.analysis;
  return Object.freeze({
    version: RESOLVE_TURN_VERSION,
    source: "legacy_passthrough",
    analysis, // the SAME object: callers keep using it; identity is asserted by tests
    effective: analysis.effective,
    primary: analysis.primary,
    handed: Object.freeze({ frame_acts: readerFrame?.acts?.length ?? 0, present: presentActors.length, has_dis: Boolean(dialogueState) })
  });
}

module.exports = { RESOLVE_TURN_VERSION, RESOLVER_OWNERSHIP, resolveTurn };
