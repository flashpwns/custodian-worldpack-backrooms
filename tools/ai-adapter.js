"use strict";

// Intent interpretation is deliberately separate from grounding and simulation.
// Nothing in this module imports or calls a Custodian mutation API.
const INTENT_VERSION = "yellow-beast-intent@v1";
const STEP_RELATIONS = new Set(["sequence", "parallel"]);
const REFERENCE_SCOPES = new Set(["entity", "location", "person", "inventory", "phenomenon"]);
const REFERENCE_STATES = new Set(["unresolved", "contextual"]);

function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function only(value, keys) { return plain(value) && Object.keys(value).every((key) => keys.has(key)); }
function strings(value) { return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0); }
function reference(value) { return only(value, new Set(["text", "scope", "resolution"])) && typeof value.text === "string" && value.text.length > 0 && REFERENCE_SCOPES.has(value.scope) && REFERENCE_STATES.has(value.resolution); }
function references(value) { return Array.isArray(value) && value.every(reference); }
function textObjects(value, allowed) { return Array.isArray(value) && value.every((item) => only(item, allowed)); }
function bad(raw_input, provider, code, message) {
  return {
    version: INTENT_VERSION, status: "interpretation_error", noncanonical: true, raw_input,
    actor: null, goals: [], steps: [], methods: [], referenced_entities: [], referenced_locations: [], referenced_people: [], referenced_inventory: [], conditions: [], preferences: [], social_intent: [], communication_content: [], temporal_order: [], uncertainties: [code], assumptions: [], clarification_required: false, clarification: null,
    provenance: { provider, request_id: null, schema_version: INTENT_VERSION }, error: { code, message }
  };
}
function buildSafeContext(run) {
  // `status` is a public observer projection. Do not add sessions, topology, or aliases with hidden refs here.
  const { status } = require("./run-bootstrap");
  const current = status(run);
  return {
    version: "yellow-beast-interpretation-context@v1",
    profile_title: current.profile_title,
    scenario: current.scenario,
    lifecycle: current.lifecycle,
    observer_location: current.view.location,
    visible_reference_labels: current.view.targets.map(({ alias }) => alias),
    known_resource_labels: current.known_resources.map((item) => item.id ?? item),
    public_reason: current.view.public_reason,
    grounding: { version: "yellow-beast-observer-grounding-context@v1", candidates: [
      ...current.view.targets.map(({ alias }) => ({ ref: alias, label: alias, category: "entity", source: "visible", aliases: [alias], attributes: [] })),
      ...current.known_resources.map((item) => ({ ref: item.id ?? item, label: item.label ?? item.id ?? item, category: "inventory", source: "inventory", aliases: [], attributes: [] }))
    ] }
  };
}
function validateIntent(value, { raw_input, provider = "unknown", request_id = null } = {}) {
  if (typeof raw_input !== "string") return bad("", provider, "RAW_INPUT_INVALID", "Player input must be text.");
  const allowed = new Set(["version", "status", "noncanonical", "actor", "goals", "steps", "methods", "referenced_entities", "referenced_locations", "referenced_people", "referenced_inventory", "conditions", "preferences", "social_intent", "communication_content", "temporal_order", "uncertainties", "assumptions", "clarification_required", "clarification"]);
  if (!only(value, allowed) || value.version !== INTENT_VERSION || value.status !== "proposal" || value.noncanonical !== true) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned an invalid intent proposal.");
  const required = ["actor", "goals", "steps", "methods", "referenced_entities", "referenced_locations", "referenced_people", "referenced_inventory", "conditions", "preferences", "social_intent", "communication_content", "temporal_order", "uncertainties", "assumptions", "clarification_required", "clarification"];
  if (required.some((key) => !(key in value)) || !(value.actor === null || typeof value.actor === "string") || !strings(value.goals) || !strings(value.methods) || !references(value.referenced_entities) || !references(value.referenced_locations) || !references(value.referenced_people) || !references(value.referenced_inventory) || !strings(value.preferences) || !strings(value.uncertainties) || !strings(value.assumptions) || typeof value.clarification_required !== "boolean") return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid intent fields.");
  if (!Array.isArray(value.steps) || value.steps.length > 16 || !value.steps.every((step, index) => only(step, new Set(["id", "relation", "attempt", "goals", "methods", "references", "constraints", "uncertain"])) && step.id === `step-${index + 1}` && STEP_RELATIONS.has(step.relation) && typeof step.attempt === "string" && strings(step.goals) && strings(step.methods) && references(step.references) && strings(step.constraints) && typeof step.uncertain === "boolean")) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid intent steps.");
  if (!textObjects(value.conditions, new Set(["when", "then_steps", "otherwise_steps"])) || !value.conditions.every((item) => typeof item.when === "string" && strings(item.then_steps) && strings(item.otherwise_steps))) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid conditions.");
  if (!textObjects(value.social_intent, new Set(["kind", "addressee", "tone", "deceptive_intent"])) || !value.social_intent.every((item) => typeof item.kind === "string" && (item.addressee === null || typeof item.addressee === "string") && (item.tone === null || typeof item.tone === "string") && typeof item.deceptive_intent === "boolean")) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid social intent.");
  if (!textObjects(value.communication_content, new Set(["kind", "content", "addressee"])) || !value.communication_content.every((item) => typeof item.kind === "string" && typeof item.content === "string" && (item.addressee === null || typeof item.addressee === "string"))) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid communication content.");
  if (!textObjects(value.temporal_order, new Set(["before", "after"])) || !value.temporal_order.every((item) => typeof item.before === "string" && typeof item.after === "string")) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned invalid temporal ordering.");
  if (value.clarification_required) {
    if (!only(value.clarification, new Set(["question", "candidate_reference_labels"])) || typeof value.clarification.question !== "string" || !strings(value.clarification.candidate_reference_labels)) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned an unsafe clarification.");
  } else if (value.clarification !== null) return bad(raw_input, provider, "MALFORMED_INTERPRETATION", "The interpreter returned an invalid clarification.");
  return { ...value, raw_input, provenance: { provider, request_id, schema_version: INTENT_VERSION } };
}
async function interpret(provider, player_text, context, { request_id = null } = {}) {
  const providerName = provider?.name ?? "unavailable";
  if (typeof player_text === "string" && player_text.length > 4000) return bad(player_text.slice(0, 4000), providerName, "INPUT_TOO_LONG", "That description is too long to resolve safely.");
  if (typeof player_text !== "string" || !player_text.trim() || !provider?.interpret) return bad(typeof player_text === "string" ? player_text : "", providerName, "INTERPRETER_UNAVAILABLE", "Intent interpretation is unavailable.");
  try { return validateIntent(await provider.interpret({ player_text, context }), { raw_input: player_text, provider: providerName, request_id }); }
  catch { return bad(player_text, providerName, "INTERPRETER_FAILED", "Intent interpretation failed safely."); }
}
function legacyActionToIntent({ verb, target_alias = null, actor = null, raw_input = null, request_id = null }) {
  const text = raw_input ?? `${verb}${target_alias ? ` ${target_alias}` : ""}`;
  const ref = target_alias ? [{ text: target_alias, scope: "entity", resolution: "contextual" }] : [];
  return validateIntent({ version: INTENT_VERSION, status: "proposal", noncanonical: true, actor, goals: [`perform legacy structured ${String(verb).toLowerCase()} input`], steps: [{ id: "step-1", relation: "sequence", attempt: text, goals: [`perform ${String(verb).toLowerCase()}`], methods: [], references: ref, constraints: [], uncertain: true }], methods: [], referenced_entities: ref, referenced_locations: [], referenced_people: [], referenced_inventory: [], conditions: [], preferences: [], social_intent: [], communication_content: [], temporal_order: [], uncertainties: ["legacy structured input still requires later grounding and resolution"], assumptions: [], clarification_required: false, clarification: null }, { raw_input: text, provider: "legacy-structured-adapter", request_id });
}
// Compatibility name retained for callers. Interpretation and grounding remain
// noncanonical; a ready resolution plan is applied through Custodian below.
async function executeNatural({ run, provider, player_text, request_id = null, context: suppliedContext = null, consequenceResolver = null }) {
  const context = suppliedContext ?? buildSafeContext(run);
  const intent = await interpret(provider, player_text, context, { request_id });
  const { groundIntent } = require("./intent-grounding");
  const grounded_intent = intent.status === "proposal" ? groundIntent(intent, context.grounding) : null;
  const { planResolution } = require("./capability-planning");
  const resolution_plan = grounded_intent ? planResolution(grounded_intent) : null;
  const { resolveConsequences } = require("./consequence-resolution");
  const resolver = consequenceResolver ?? resolveConsequences;
  const consequence = resolution_plan && !resolution_plan.clarification_required ? resolver({ run, plan: resolution_plan, request_id: request_id ?? `natural-${run.session.id}-${intent.raw_input}` }) : null;
  return { run, context, intent, grounded_intent, resolution_plan, consequence, steps: [], narration: null, executed: Boolean(consequence?.result.accepted) };
}
module.exports = { INTENT_VERSION, buildSafeContext, validateIntent, interpret, legacyActionToIntent, executeNatural };
