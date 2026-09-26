"use strict";

// Seams for the living-NPC future (ED-30 C6). Defined, fail-closed, contract-tested -- NOT built.
//
//   1. Speaker agenda input   planner-facing structured intents an NPC might pursue in conversation
//                             (ask something, mention a concern, steer topic). Today: always empty. A non-empty
//                             agenda can only surface propositions the speaker is already licensed to say.
//   2. Belief store interface per-actor propositions with provenance, confidence and time, over the existing
//                             knowledge grants, heard propositions and attributed player claims. Revision: DEFERRED.
//   3. Need/goal read         the speaker's canonical current concern. Today: not_established, and questions
//                             about it are answered honestly as such.
//   4. Learning hook          dialogue-state.recordLearning (emitted at commit for every listener).

const canonicalKnowledge = require("./canonical-knowledge");

const AGENTS_VERSION = "yellow-beast-dialogue-agents@v0-seams";
const AGENDA_KINDS = Object.freeze(["ask", "mention", "steer_topic"]);

/** 1. The speaker's conversational agenda. No agenda system exists yet: always empty (fail closed). */
function speakerAgenda(/* run, actorId */) { return Object.freeze([]); }

/**
 * Filters agenda items down to what this turn may carry: an item is admitted only when the proposition it
 * would voice is one of the speaker's own knowledge grants (by key); anything else is dropped and reported.
 * Admitted items become OPTIONAL plan facts, never required ones, never new truth.
 */
function admitAgenda(run, actorId, agenda = []) {
  const grants = new Map(canonicalKnowledge.knowledgeFor(run, actorId).map((g) => [g.key, g]));
  const admitted = [];
  const dropped = [];
  for (const item of agenda ?? []) {
    if (!item || !AGENDA_KINDS.includes(item.kind)) { dropped.push({ item, reason: "unsupported_kind" }); continue; }
    const grant = item.proposition_key ? grants.get(item.proposition_key) : null;
    if (!grant) { dropped.push({ item, reason: "unlicensed_proposition" }); continue; }
    admitted.push({ key: "agenda_mention", value: { kind: item.kind, statement: grant.proposition, provenance: grant.epistemic_mode, source_ref: grant.source_ref } });
  }
  return { admitted, dropped };
}

/**
 * 2. The belief store: what this actor holds, each with provenance, confidence and time. A read-only view
 * over canonical knowledge (grants), heard reports and attributed player claims -- never a second store.
 */
function beliefsOf(run, actorId) {
  const out = [];
  for (const g of canonicalKnowledge.knowledgeFor(run, actorId)) out.push({ proposition: g.proposition, key: g.key, concept: g.concept, provenance: g.epistemic_mode, confidence: g.epistemic_mode === "heard" ? "reported" : "held", at: g.activated_at ?? null, source_ref: g.source_ref });
  for (const p of canonicalKnowledge.heardPropositions(run, actorId).filter((x) => x.epistemic_mode === "player_claim")) out.push({ proposition: p.text, key: "player_claim", concept: "player_claim", provenance: "player_claim", confidence: "unverified", at: p.at ?? null, source_ref: p.source_ref });
  return out;
}
/** Belief revision is not implemented: callers must not assume it (DEFERRED, fails closed). */
function reviseBelief() { const error = new Error("belief revision is DEFERRED (ED-30 C6)"); error.code = "BELIEF_REVISION_DEFERRED"; throw error; }

/** 3. The speaker's canonical current concern / need / goal. No goal state exists yet: not_established. */
function currentConcern(/* run, actorId */) { return Object.freeze({ status: "not_established", reason: "need_goal_state_not_modelled" }); }

module.exports = { AGENTS_VERSION, AGENDA_KINDS, speakerAgenda, admitAgenda, beliefsOf, reviseBelief, currentConcern };
