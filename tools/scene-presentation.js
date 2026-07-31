"use strict";

// Presentation is deliberately downstream of the canonical turn.  This module
// accepts only public run projections and consequence summaries and never
// imports a Custodian mutation API.
const crypto = require("node:crypto");
const { status } = require("./run-bootstrap");
const VERSION = "yellow-beast-scene@v1";
const SIGNIFICANCE = new Set(["MICRO", "ROUTINE", "MEANINGFUL", "MAJOR", "CRITICAL"]);
const opaque = /(?:^|\b)(?:actor|object|corridor|fixture|entity|region|space)-[a-f0-9]{4,}\b/i;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
const human = (value, fallback = "the area") => {
  const text = String(value ?? "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return !text || opaque.test(text) ? fallback : text.replace(/\b\w/g, (letter) => letter.toUpperCase());
};
const fact = (id, category, text, required = false, data = {}) => ({ id, category, text, required, ...data });
function significance({ consequence, action, scene_type }) {
  if (scene_type === "orientation" || action === "MOVE") return "MEANINGFUL";
  if (consequence?.result?.partial_steps?.length || consequence?.result?.failed_steps?.length || consequence?.result?.interrupted_steps?.length) return "MEANINGFUL";
  if (consequence?.result?.time_advanced) return "MICRO";
  if (action === "LOOK" || action === "USE") return "MICRO";
  return "ROUTINE";
}
function modeProfile(mode) { return ({
  "field-researcher": "clear-q4",
  "async-command": "beck",
  "local-anomaly": "nullzone",
  lost: "lost"
})[mode] ?? "generic"; }
function safeEnvironment(run, current) {
  const view = current.view ?? {}; const procedural = run.procedural;
  const environment = procedural?.environment ?? procedural?.nodes?.[procedural.current?.[current.player]]?.environment ?? null;
  const details = [];
  if (environment && typeof environment === "object") for (const key of ["architecture", "flooring", "ceiling", "lighting", "furniture", "wear", "transition"]) { const value = environment[key]; const text = typeof value === "string" ? value : value?.state ?? value?.description ?? null; if (typeof text === "string") details.push(human(text, "")); }
  return { location: human(view.location, "the immediate area"), details: details.filter(Boolean), visible: (view.targets ?? []).map(({ alias }) => human(alias, "nearby feature")).filter((label) => !opaque.test(label)) };
}
function buildSafeScene({ run, mode = run.profile_id, input = null, consequence = null, action = null, scene_type = null, previous_scene_id = null } = {}) {
  if (!run?.session) throw new Error("run required");
  const current = status(run); // Public observer projection only; no canonical mutation.
  const environment = safeEnvironment(run, current);
  const type = scene_type ?? (action === "LOOK" ? "observation" : previous_scene_id ? "delta" : "orientation");
  const level = significance({ consequence, action, scene_type: type });
  const facts = [fact("location", "location", environment.location, true), ...environment.details.map((text, index) => fact(`environment-${index + 1}`, "environment", text, type !== "delta")), ...environment.visible.map((text, index) => fact(`visible-${index + 1}`, "visible", text, false))];
  const changes = [];
  if (consequence?.result?.accepted) changes.push(fact("consequence", "change", consequence.result.observer_safe_summary, true, { outcome: consequence.result.partial_steps?.length ? "partial" : "full" }));
  else if (consequence?.result && !consequence.result.accepted) changes.push(fact("consequence", "change", consequence.result.observer_safe_summary, true, { outcome: "failure" }));
  else if (action === "WAIT") changes.push(fact("quiet", "change", "No notable change is apparent.", false));
  const inventory = (current.known_resources ?? []).map((item, index) => fact(`inventory-${index + 1}`, "inventory", human(item, "carried equipment"), false));
  const objective = current.expedition?.objectives?.survey?.state === "active" ? fact("objective", "context", "Continue the declared survey.", false) : null;
  const provenance = { source: "observer-safe-projection", consequence_request: consequence?.result?.canonical_event_ids?.length ? "resolved" : null, input: typeof input === "string" ? "player-supplied" : null };
  const seed = { session: run.session.id, mode, type, previous_scene_id, location: environment.location, input: input ?? null, facts: [...facts, ...changes].map(({ id, text }) => [id, text]) };
  return { version: VERSION, scene_id: `scene-${hash(seed)}`, world_ref: run.world_id ?? null, session_ref: run.session.id, turn_ref: consequence?.result?.canonical_event_ids?.[0] ?? action ?? "orientation", observer_ref: current.player, mode, profile: modeProfile(mode), scene_type: type, significance: SIGNIFICANCE.has(level) ? level : "ROUTINE", location: environment.location, safe_facts: facts, immediate_changes: changes, visible_actors: [], communications: [], sensory_facts: [], inventory, object_state_changes: [], unresolved_facts: [], continuing_conditions: [], context: objective ? [objective] : [], interaction_prompt: "What do you do?", provenance };
}
function fallbackNarration(scene) {
  const sentence = (text) => text.endsWith(".") ? text : `${text}.`;
  const environment = scene.safe_facts.filter((item) => item.category === "environment").map((item) => item.text);
  const visible = scene.safe_facts.filter((item) => item.category === "visible").map((item) => item.text);
  const changes = scene.immediate_changes.map((item) => item.text);
  const parts = [];
  if (scene.scene_type === "orientation" || scene.scene_type === "observation") parts.push(`You are at ${scene.location}.`);
  if (environment.length) parts.push(sentence(environment.join(". ")));
  if (visible.length && scene.scene_type !== "delta") parts.push(`Nearby: ${visible.join(", ")}.`);
  if (changes.length) parts.push(changes.map(sentence).join(" "));
  if (!parts.length) parts.push("Nothing notable changes.");
  if (scene.context.length && scene.scene_type !== "delta") parts.push(scene.context.map((item) => sentence(item.text)).join(" "));
  return parts.join(" ");
}
function validateNarration(scene, response) {
  if (!response || typeof response.prose !== "string" || !response.prose.trim()) return { ok: false, reason: "malformed" };
  const prose = response.prose.trim();
  if (opaque.test(prose) || /\byou (?:feel|are terrified|panic|realize)\b/i.test(prose) || /\b(?:creature|behind you|is afraid)\b/i.test(prose)) return { ok: false, reason: "unsupported-content" };
  const refs = response.referenced_safe_fact_ids ?? [];
  if (!Array.isArray(refs) || refs.some((id) => !scene.safe_facts.concat(scene.immediate_changes, scene.context).some((item) => item.id === id))) return { ok: false, reason: "unknown-fact-reference" };
  return { ok: true, prose, referenced_safe_fact_ids: refs };
}
async function narrateScene({ scene, provider = null } = {}) {
  if (provider?.narrate) try { const checked = validateNarration(scene, await provider.narrate({ scene, profile: scene.profile })); if (checked.ok) return { source: "provider", ...checked }; return { source: "fallback", prose: fallbackNarration(scene), fallback_reason: checked.reason }; } catch { return { source: "fallback", prose: fallbackNarration(scene), fallback_reason: "provider-failed" }; }
  return { source: "fallback", prose: fallbackNarration(scene), fallback_reason: null };
}
module.exports = { VERSION, buildSafeScene, fallbackNarration, validateNarration, narrateScene, modeProfile };
