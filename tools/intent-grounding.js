"use strict";
const GROUNDED_INTENT_VERSION = "yellow-beast-grounded-intent@v1";
const SOURCES = new Set(["visible", "inventory", "memory", "discourse", "role", "phenomenon", "self"]);
const CATEGORIES = new Set(["entity", "location", "person", "inventory", "phenomenon", "self"]);
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const normalize = (value) => String(value ?? "").toLowerCase().replace(/\b(the|a|an|my|that|this)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const words = (value) => normalize(value).split(" ").filter(Boolean);
function safeCandidate(value) { return plain(value) && typeof value.ref === "string" && typeof value.label === "string" && CATEGORIES.has(value.category) && SOURCES.has(value.source) && (value.aliases === undefined || Array.isArray(value.aliases) && value.aliases.every((alias) => typeof alias === "string")) && (value.attributes === undefined || Array.isArray(value.attributes) && value.attributes.every((attribute) => typeof attribute === "string")); }
function validateGroundingContext(context) { return plain(context) && typeof context.version === "string" && Array.isArray(context.candidates) && context.candidates.every(safeCandidate); }
function candidatesFor(reference, context, discourse) {
  const query = normalize(reference.text); const queryWords = words(query);
  if (/^(it|him|her|them|they|this|that|these|those)$/.test(query)) {
    const recent = discourse.referents.filter((item) => item.category === reference.scope || (query === "it" && ["entity", "inventory", "location", "phenomenon"].includes(item.category)) || (/(him|her|them|they)/.test(query) && item.category === "person"));
    return recent.length ? recent.map((item) => ({ ...item, source: "discourse" })) : [];
  }
  if (/^(whatever|thing)\b|made that sound|behind the wall/.test(query)) return [];
  return context.candidates.filter((candidate) => {
    if (reference.scope !== "entity" && candidate.category !== reference.scope) return false;
    const haystack = [candidate.label, ...(candidate.aliases ?? []), ...(candidate.attributes ?? [])].map(normalize).join(" ");
    return queryWords.length > 0 && queryWords.every((word) => haystack.includes(word));
  });
}
function clarification(ambiguous) { const labels = ambiguous.candidates.map(({ label }) => label); return { reference_id: ambiguous.reference_id, question: `Which ${ambiguous.text.replace(/^the\s+/i, "")} do you mean?`, candidate_labels: labels, reason: "multiple observer-safe candidates" }; }
function groundReference(reference, reference_id, context, discourse) {
  const candidates = candidatesFor(reference, context, discourse);
  if (candidates.length === 1) { const candidate = candidates[0]; return { kind: "grounded", value: { reference_id, text: reference.text, canonical_ref: candidate.ref, safe_label: candidate.label, source: candidate.source, category: candidate.category, match: candidate.source === "discourse" ? "contextual" : "strong" } }; }
  if (candidates.length > 1) return { kind: "ambiguous", value: { reference_id, text: reference.text, candidates: candidates.map(({ label, category, source }) => ({ label, category, source })) } };
  return { kind: "unresolved", value: { reference_id, text: reference.text, category: reference.scope, reason: /whatever|thing|made that sound|behind the wall/i.test(reference.text) ? "conceptual unknown cause" : "no observer-safe match" } };
}
function allReferences(intent) {
  const output = [];
  for (const key of ["referenced_entities", "referenced_locations", "referenced_people", "referenced_inventory"]) for (const [index, reference] of intent[key].entries()) output.push({ reference, reference_id: `${key}[${index}]` });
  for (const step of intent.steps) for (const [index, reference] of step.references.entries()) output.push({ reference, reference_id: `${step.id}.references[${index}]` });
  return output;
}
function groundIntent(intent, context, discourse = { referents: [] }) {
  if (!plain(intent) || intent.version !== "yellow-beast-intent@v1" || intent.status !== "proposal") throw new Error("intent must be a validated freeform proposal");
  if (!validateGroundingContext(context)) throw new Error("grounding requires an observer-safe candidate context");
  const state = { referents: Array.isArray(discourse.referents) ? discourse.referents.slice(-8).filter(safeCandidate) : [] };
  const grounded_references = []; const unresolved_references = []; const ambiguous_references = []; const reference_candidates = [];
  for (const { reference, reference_id } of allReferences(intent)) {
    const result = groundReference(reference, reference_id, context, state);
    if (result.kind === "grounded") { grounded_references.push(result.value); state.referents.push({ ref: result.value.canonical_ref, label: result.value.safe_label, category: result.value.category, source: result.value.source }); state.referents = state.referents.slice(-8); }
    else if (result.kind === "ambiguous") { ambiguous_references.push(result.value); reference_candidates.push(...result.value.candidates.map((candidate) => ({ reference_id, ...candidate }))); }
    else unresolved_references.push(result.value);
  }
  const clarifications = ambiguous_references.map(clarification);
  return { version: GROUNDED_INTENT_VERSION, noncanonical: true, intent, observer_context_version: context.version, grounded_references, unresolved_references, ambiguous_references, reference_candidates, grounding_notes: ["Grounding identifies observer-safe referents only; it does not determine reachability, permission, success, or consequence."], clarification_required: clarifications.length > 0 || intent.clarification_required, clarification: clarifications[0] ?? intent.clarification ?? null, discourse: { referents: state.referents } };
}
module.exports = { GROUNDED_INTENT_VERSION, validateGroundingContext, groundIntent };
