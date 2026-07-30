"use strict";

const { status, act } = require("./run-bootstrap");

const ACTION_KINDS = new Set(["action", "compound", "clarification", "invalid"]);
const VERBS = new Set(["LOOK", "MOVE", "INSPECT", "USE"]);

function hasOnly(object, keys) { return object && typeof object === "object" && !Array.isArray(object) && Object.keys(object).every((key) => keys.has(key)); }
function buildSafeContext(run) {
  const current = status(run);
  return {
    profile_title: current.profile_title,
    scenario: current.scenario,
    lifecycle: current.lifecycle,
    location: current.view.location,
    available_verbs: current.available_verbs,
    aliases: current.view.targets.map(({ alias }) => ({ alias })),
    known_resources: current.known_resources,
    public_reason: current.view.public_reason
  };
}
function invalid(public_reason = "AI interpretation unavailable; use a structured command.") { return { kind: "invalid", actions: [], clarification: null, public_reason }; }
function validateIntent(value, context) {
  if (!hasOnly(value, new Set(["kind", "actions", "clarification", "public_reason"])) || !ACTION_KINDS.has(value.kind) || !Array.isArray(value.actions) || value.actions.length > 4) return invalid("AI response was not a valid intent.");
  const aliases = new Set(context.aliases.map(({ alias }) => alias));
  const actions = [];
  for (const item of value.actions) {
    if (!hasOnly(item, new Set(["verb", "target_alias", "parameters"])) || !VERBS.has(item.verb) || !context.available_verbs.includes(item.verb)) return invalid("That action is not currently available.");
    if (item.verb === "INSPECT" && item.target_alias === undefined) return invalid("That target is unavailable.");
    if (item.target_alias !== undefined && (typeof item.target_alias !== "string" || !aliases.has(item.target_alias))) return invalid("That target is unavailable.");
    if (item.parameters !== undefined && (!hasOnly(item.parameters, new Set()) || Array.isArray(item.parameters))) return invalid("AI response contained invalid action parameters.");
    actions.push({ verb: item.verb, ...(item.target_alias === undefined ? {} : { target_alias: item.target_alias }), parameters: item.parameters ?? {} });
  }
  if ((value.kind === "action" && actions.length !== 1) || (value.kind === "compound" && actions.length < 2) || ((value.kind === "clarification" || value.kind === "invalid") && actions.length !== 0)) return invalid("AI response had an invalid action sequence.");
  if (value.kind === "clarification") {
    const clarification = value.clarification;
    if (!hasOnly(clarification, new Set(["message", "candidates"])) || typeof clarification.message !== "string" || !Array.isArray(clarification.candidates) || clarification.candidates.some((candidate) => !aliases.has(candidate))) return invalid("AI response requested an unsafe clarification.");
  }
  return { kind: value.kind, actions, clarification: value.kind === "clarification" ? value.clarification : null, public_reason: typeof value.public_reason === "string" ? value.public_reason : null };
}
function safeResult(run, verb, outcome) {
  const current = buildSafeContext(run);
  return {
    verb,
    outcome: outcome.ok ? outcome.outcome : "rejected",
    public_reason: outcome.result?.public_reason ?? outcome.error?.code ?? null,
    lifecycle: current.lifecycle,
    location: current.location,
    available_verbs: current.available_verbs,
    aliases: current.aliases
  };
}
function fallbackNarration(envelope) {
  if (envelope.outcome === "succeeded") return `${envelope.verb} succeeded.`;
  return `${envelope.verb} was not completed${envelope.public_reason ? `: ${envelope.public_reason}.` : "."}`;
}
async function narrate(provider, envelope) {
  if (!provider?.narrate) return { source: "fallback", text: fallbackNarration(envelope) };
  try {
    const result = await provider.narrate({ envelope, tone: envelope.profile_title });
    if (!hasOnly(result, new Set(["text"])) || typeof result.text !== "string" || !result.text.trim()) throw new Error("invalid narration");
    return { source: "provider", text: result.text };
  } catch { return { source: "fallback", text: fallbackNarration(envelope) }; }
}
async function interpret(provider, player_text, context) {
  if (typeof player_text !== "string" || !player_text.trim() || !provider?.interpret) return invalid();
  try { return validateIntent(await provider.interpret({ player_text, context }), context); } catch { return invalid(); }
}
async function executeNatural({ run, provider, player_text }) {
  let context = buildSafeContext(run);
  const intent = await interpret(provider, player_text, context);
  if (intent.kind === "clarification" || intent.kind === "invalid") return { run, intent, context, steps: [], narration: await narrate(provider, { verb: "INPUT", outcome: "rejected", public_reason: intent.public_reason, ...context }) };
  const steps = [];
  for (const proposed of intent.actions) {
    context = buildSafeContext(run);
    const validStep = validateIntent({ kind: "action", actions: [proposed], clarification: null }, context);
    if (validStep.kind === "invalid") { steps.push({ proposed, outcome: "rejected", public_reason: validStep.public_reason }); break; }
    const outcome = act(run, proposed.verb, proposed.target_alias);
    const envelope = { ...safeResult(run, proposed.verb, outcome), profile_title: context.profile_title };
    steps.push({ proposed, outcome: envelope.outcome, public_reason: envelope.public_reason, narration: await narrate(provider, envelope) });
    if (envelope.outcome !== "succeeded") break;
  }
  return { run, intent, context: buildSafeContext(run), steps };
}

module.exports = { buildSafeContext, validateIntent, interpret, executeNatural, narrate, fallbackNarration };
