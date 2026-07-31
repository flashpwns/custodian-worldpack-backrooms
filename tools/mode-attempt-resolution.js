"use strict";

// Resolve a grounded plan against the active mode's affordances.  This is an
// affordance walk, not a phrase-to-verb adapter: every plan step is evaluated,
// and a compound attempt can produce a partial result.
function targetFor(step, plan, affordance) {
  const refs = plan.grounded_intent?.grounded_references?.filter((item) => item.reference_id.startsWith(`${step.id}.`)) ?? [];
  return affordance.targets?.find((target) => refs.some((ref) => target.ref === ref.canonical_ref || target.label === ref.safe_label))?.ref
    ?? (affordance.target_required ? affordance.targets?.[0]?.ref ?? null : null);
}

function actionFor(step, available) {
  const capabilities = new Set(step.capability_requirements ?? []);
  const byCapability = [
    ["locomotion", "MOVE"],
    ["wait", "WAIT"],
    ["record", "DISCOVER"],
    ["communicate", "ADVANCE"],
    ["observe", "REVIEW_REPORT"]
  ];
  return byCapability.map(([, type]) => available.find((item) => item.type === type)).find((item) => item && [...capabilities].some((capability) => byCapability.some(([name, type]) => name === capability && type === item.type))) ?? null;
}

function rejected(plan, summary = "Nothing observable changes here.") {
  return { version: "yellow-beast-mode-attempt@v1", result: { accepted: false, duplicate: false, canonical_event_ids: [], attempted_steps: plan.steps.map((step) => step.id), completed_steps: [], failed_steps: plan.steps.map((step) => step.id), interrupted_steps: [], partial_steps: [], time_advanced: 0, observer_safe_summary: summary } };
}

function resolveModeAttempt({ service, world_id, mode, plan, available }) {
  if (plan.clarification_required) return rejected(plan, "The attempt needs a more specific observer-safe reference.");
  const completed_steps = [], failed_steps = [], canonical_event_ids = [];
  for (const step of plan.steps) {
    if (!step.possible) { failed_steps.push(step.id); continue; }
    const affordance = actionFor(step, available);
    if (!affordance) { failed_steps.push(step.id); continue; }
    const outcome = service.submitAction({ world_id, mode, action: affordance.type, target: targetFor(step, plan, affordance) });
    if (outcome.ok) { completed_steps.push(step.id); canonical_event_ids.push(...(outcome.result?.canonical_event_ids ?? [])); }
    else failed_steps.push(step.id);
  }
  const accepted = completed_steps.length > 0;
  return { version: "yellow-beast-mode-attempt@v1", result: { accepted, duplicate: false, canonical_event_ids, attempted_steps: plan.steps.map((step) => step.id), completed_steps, failed_steps, interrupted_steps: [], partial_steps: accepted && failed_steps.length ? completed_steps : [], time_advanced: 0, observer_safe_summary: !accepted ? "Nothing observable changes here." : failed_steps.length ? "Only part of the attempt changes what is observable here." : "The attempted behaviors are resolved against the current situation." } };
}

module.exports = { resolveModeAttempt };
