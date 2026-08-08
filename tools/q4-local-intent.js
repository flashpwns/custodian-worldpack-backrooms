"use strict";

// Bounded, offline LOCAL interpreter. It proposes only known order families;
// it never receives write access to a world or resolves an action.
const VERSION = "yellow-beast-q4-local-intent@v1";
const ACTIONS = new Set(["STAY", "FOLLOW", "MOVE", "WAIT", "RETURN", "REPORT", "ASSIST", "INVESTIGATE", "TRANSFER", "QUERY", "CLARIFY"]);
const clone = (value) => structuredClone(value);

function normalize(value) { return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " "); }
function nameMatches(member, text) {
  const names = [member.personnel_id, member.first_name, member.last_name, member.display_name, member.role].filter(Boolean).map(normalize);
  const candidate = normalize(text); return names.some((name) => name && (candidate === name || candidate.includes(name)));
}
function resolveRecipient(text, local = []) {
  const matches = local.filter((member) => nameMatches(member, text));
  if (matches.length === 1) return { ok: true, recipient: matches[0] };
  if (matches.length > 1) return { ok: false, code: "LOCAL_RECIPIENT_AMBIGUOUS", clarification: "Which nearby worker do you mean?" };
  if (local.length === 1) return { ok: true, recipient: local[0] };
  return { ok: false, code: local.length ? "LOCAL_RECIPIENT_REQUIRED" : "LOCAL_RECIPIENT_UNAVAILABLE", clarification: local.length ? "Name one nearby worker." : "No assigned worker is within speaking range." };
}
function equipment(text, inventory = []) {
  const source = normalize(text);
  const matches = inventory.filter((item) => [item.id, item.instance_id, item.label, item.display_name, item.type].filter(Boolean).some((name) => { const label = normalize(name); return source.includes(label) || label.split(" ").some((term) => term.length > 3 && source.includes(term)); }));
  if (matches.length === 1) return { ok: true, item: matches[0] };
  return { ok: false, code: matches.length > 1 ? "LOCAL_EQUIPMENT_AMBIGUOUS" : "LOCAL_EQUIPMENT_UNKNOWN", clarification: matches.length > 1 ? "Which available item do you mean?" : "Name an issued item that is currently available." };
}
function actionFor(segment) {
  const text = normalize(segment);
  if (/\b(stay|hold|watch)\b/.test(text)) return { type: "STAY" };
  if (/\bfollow\b/.test(text)) return { type: "FOLLOW" };
  if (/\b(wait)\b/.test(text)) return { type: "WAIT", deferred: /\buntil we (return|come back)\b/.test(text) ? { kind: "TEAM_RETURN" } : null };
  if (/\b(return|regroup|come back)\b/.test(text)) return { type: "RETURN" };
  if (/\b(go|move|head)\b/.test(text)) return { type: "MOVE" };
  if (/\b(check|investigate|look at|come look)\b/.test(text)) return { type: "INVESTIGATE" };
  if (/\b(report|tell me|status)\b/.test(text)) return { type: "REPORT" };
  if (/\b(help|assist)\b/.test(text)) return { type: "ASSIST" };
  if (/\b(take|give|carry|pass|transfer)\b/.test(text)) return { type: "TRANSFER" };
  if (/\b(did you|do you|can you hear|what did)\b/.test(text)) return { type: "QUERY" };
  return null;
}
function locationReference(text, locations = []) {
  const matches = locations.filter((location) => [location.id, location.name, ...(location.aliases ?? [])].filter(Boolean).some((name) => normalize(text).includes(normalize(name))));
  if (matches.length === 1) return { ok: true, location: matches[0] };
  if (/\b(last marker|marker)\b/.test(normalize(text))) return { ok: false, code: "LOCAL_LOCATION_UNSUPPORTED", clarification: "Use a named, currently known destination." };
  return { ok: false, code: matches.length > 1 ? "LOCAL_LOCATION_AMBIGUOUS" : "LOCAL_LOCATION_REQUIRED", clarification: matches.length > 1 ? "Which known destination do you mean?" : "Name a known destination." };
}
function parse(text, { local = [], inventory = [], locations = [], request_id = null } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, code: "LOCAL_EMPTY", clarification: "State a nearby worker and an operational request." };
  const recipient = resolveRecipient(text, local); if (!recipient.ok) return recipient;
  const parts = text.split(/\b(?:then|and|while)\b/i).map((part) => part.trim()).filter(Boolean);
  const actions = [];
  for (let index = 0; index < parts.length; index += 1) {
    const action = actionFor(parts[index]);
    if (!action) return { ok: false, code: "LOCAL_ACTION_UNSUPPORTED", clarification: "I can only formalize supported nearby-worker orders. Try stay, follow, wait, go, return, report, assist, investigate, or transfer." };
    if (action.type === "TRANSFER") { const resolved = equipment(parts[index], inventory); if (!resolved.ok) return resolved; action.equipment_id = resolved.item.id ?? resolved.item.instance_id; }
    if (["MOVE", "RETURN", "INVESTIGATE"].includes(action.type) && /\b(to|at|through|back)\b/.test(normalize(parts[index]))) {
      const resolved = locationReference(parts[index], locations); if (!resolved.ok && action.type !== "RETURN") return resolved; if (resolved.ok) action.location_id = resolved.location.id;
    }
    actions.push({ id: `local-step-${index + 1}`, relation: index === 0 ? "sequence" : /\bwhile\b/i.test(text) ? "parallel" : "sequence", ...action });
  }
  return { ok: true, proposal: { version: VERSION, noncanonical: true, request_id: request_id ?? null, recipient: recipient.recipient.personnel_id ?? recipient.recipient.id, actions, raw_input: text } };
}
function validateProposal(value, context) {
  if (!value || value.version !== VERSION || value.noncanonical !== true || !ACTIONS.has(value.actions?.[0]?.type) || !Array.isArray(value.actions) || value.actions.length > 4) return { ok: false, code: "LOCAL_PROPOSAL_INVALID" };
  const recipient = (context.local ?? []).find((member) => (member.personnel_id ?? member.id) === value.recipient); if (!recipient) return { ok: false, code: "LOCAL_RECIPIENT_UNAVAILABLE" };
  for (const action of value.actions) {
    if (!ACTIONS.has(action.type) || !["sequence", "parallel"].includes(action.relation)) return { ok: false, code: "LOCAL_ACTION_INVALID" };
    if (action.equipment_id && !(context.inventory ?? []).some((item) => item.id === action.equipment_id || item.instance_id === action.equipment_id)) return { ok: false, code: "LOCAL_EQUIPMENT_INVALID" };
    if (action.location_id && !(context.locations ?? []).some((location) => location.id === action.location_id)) return { ok: false, code: "LOCAL_LOCATION_INVALID" };
  }
  return { ok: true, proposal: clone(value), recipient };
}
module.exports = { VERSION, ACTIONS, parse, validateProposal, resolveRecipient, locationReference };
