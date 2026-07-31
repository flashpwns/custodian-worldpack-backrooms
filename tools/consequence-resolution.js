"use strict";
const { applySessionEffects } = require("custodian");
const VERSION = "yellow-beast-consequence-result@v1";
const safe = (result) => ({ version: VERSION, accepted: result.status !== "REJECTED", duplicate: Boolean(result.duplicate), canonical_event_ids: result.canonical_event_refs, attempted_steps: result.effect_results.map((x) => x.effect_id), completed_steps: result.applied_effects, failed_steps: result.failed_effects, interrupted_steps: result.skipped_effects, partial_steps: result.status === "PARTIAL" ? result.applied_effects : [], time_advanced: result.time_after - result.time_before, observer_safe_summary: result.status === "APPLIED" ? "The attempt leaves the current situation as observed." : result.status === "PARTIAL" ? "Only part of the attempt changes what is observable here." : "Nothing observable changes here." });
function effectsFor(plan, { actor_ref } = {}) {
  return plan.steps.flatMap((step) => {
    if (!step.possible) return [];
    const text = step.attempted_behavior.toLowerCase();
    const common = { id: step.id, ...(step.dependencies.length ? { depends_on: step.dependencies } : {}) };
    if (/\bwait\b/.test(text)) return [{ ...common, type: "TIME_BEAT", ticks: 1 }];
    if (/communicat|tell|ask|radio|say|lie/.test(text)) return [{ ...common, type: "COMMUNICATION_EVENT", sender_ref: actor_ref, recipients: [], channel: "direct", content: { kind: "freeform-attempt", step: step.id, attempted: step.attempted_behavior } }];
    // A plan deliberately does not invent target identities or outcomes.  Until a
    // setting-specific resolver can name a safe generic primitive, retain the
    // completed attempt as a canonical append-only environmental event.
    return [{ ...common, type: "APPEND_EVENT", event_type: "yellow-beast.freeform-attempt", payload: { step: step.id, capabilities: step.capability_requirements, attempt: step.attempted_behavior } }];
  });
}
function rejected(plan, summary) { return { version: VERSION, accepted: false, duplicate: false, canonical_event_ids: [], attempted_steps: [], completed_steps: [], failed_steps: plan.steps.filter((x) => !x.possible).map((x) => x.id), interrupted_steps: [], partial_steps: [], time_advanced: 0, observer_safe_summary: summary || "Nothing observable changes here." }; }
function resolveConsequences({ run, plan, request_id }) {
  const actor_ref = run.session.startup.player.actor_id ?? `yb-actor-${run.session.startup.player.observer_id}`;
  const effects = effectsFor(plan, { actor_ref });
  if (!effects.length) return { run, result: rejected(plan, plan.steps.find((x) => !x.possible)?.reason_if_impossible ?? "That attempt cannot proceed.") };
  const request = { version: "custodian-effect-request@v1", request_id, actor_ref, observer_ref: run.session.startup.player.observer_id, effects, metadata: { yellow_beast_intent: plan.intent.provenance.request_id ?? request_id } };
  const outcome = applySessionEffects({ session: run.session, request });
  if (outcome.ok) run.session = outcome.session;
  return { run, result: outcome.ok ? safe(outcome.result) : rejected(plan, "That attempt could not be resolved.") };
}
module.exports = { VERSION, effectsFor, resolveConsequences };
