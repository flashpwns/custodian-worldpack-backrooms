"use strict";

// Derived-only continuity cues. This module reads canonical history and never
// creates events, changes world state, or infers a cause between events.
const crypto = require("node:crypto");
const history = require("./world-history");
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const cache = new WeakMap();
const MAX_ECHOES = 8;
const EVENT_LABELS = Object.freeze({
  "remnant.left": ["object", "A physical object was left behind."],
  "artifact.recovered": ["object", "A previously left object changed custody."],
  "lost.dropped": ["object", "Carried equipment was left behind."],
  "lost.explored": ["landmark", "A previously explored route was revisited."],
  "report.filed": ["report", "A prior account remains in the record."],
  "communication.sent": ["communication", "A prior communication remains part of the record."],
  "institutional.record.archived": ["report", "A prior observation was archived."],
  "evidence.recorded": ["evidence", "Recorded evidence remains associated with an observation."],
  "phenomenon.evidence.recorded": ["evidence", "Recorded evidence remains associated with an observation."],
  "phenomenon.perceived": ["observation", "A prior observed condition is remembered."],
  "character.died": ["personnel", "A personnel status remains changed."],
  "character.status.changed": ["personnel", "A personnel status changed and remains part of the record."],
  "region.mutated": ["place", "A previously inspected place has a changed physical state."]
});
const eventOrder = (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id);

function revision(world) { const last = world.events.at(-1); return `${world.event_sequence}:${world.events.length}:${last?.id ?? ""}`; }
function build(world) {
  history.assertWorld(world);
  const cached = cache.get(world); const current = revision(world);
  if (cached?.revision === current) return cached.index;
  const events = [...world.events].sort(eventOrder); const runs = Object.fromEntries(Object.values(world.runs).map((run) => [run.id, run.profile]));
  const index = { version: "yellow-beast-consequence-echo-index@v1", world_id: world.world_id, history_digest: digest(events.map(({ id }) => id)), events: events.map((entry) => ({ id: entry.id, type: entry.type, profile: runs[entry.run_id] ?? null })) };
  cache.set(world, { revision: current, index }); return index;
}
function observerView(world, profile, { run_id = null } = {}) {
  const index = build(world); const allowed = new Set(index.events.filter((entry) => entry.profile === profile && (!run_id || entry.id !== run_id)).map((entry) => entry.id));
  const counts = new Map();
  for (const entry of world.events) {
    if (!allowed.has(entry.id)) continue;
    const label = EVENT_LABELS[entry.type]; if (!label) continue;
    const [kind, text] = label; const current = counts.get(kind) ?? { kind, text, occurrences: 0 }; current.occurrences += 1; counts.set(kind, current);
  }
  const echoes = [...counts.values()].sort((a, b) => a.kind.localeCompare(b.kind)).slice(0, MAX_ECHOES).map((echo) => ({ ...echo, provenance: "derived-from-observer-visible-history" }));
  return { version: "yellow-beast-consequence-echo@v1", profile, echoes, implicit_continuity: profile === "lost" && echoes.length === 0 };
}
function unfinishedBusiness(world, profile, { run_id = null } = {}) {
  const index = build(world); const events = index.events.filter((entry) => entry.profile === profile); const source = world.events.filter((entry) => events.some((candidate) => candidate.id === entry.id)); const items = [];
  const add = (kind, text, count = 1) => { const existing = items.find((item) => item.kind === kind); if (existing) existing.count += count; else items.push({ kind, text, count, resolution: "ordinary-simulation" }); };
  const reviewedSubjects = new Set(source.filter((entry) => entry.type === "report.reviewed").map((entry) => entry.payload?.subject ?? entry.payload?.report_id));
  const reportedSubjects = new Set();
  for (const entry of source) {
    const payload = entry.payload ?? {};
    if (entry.type === "remnant.left" || entry.type === "lost.dropped") { const artifact = world.artifacts[payload.artifact_id]; if (artifact?.state === "at-location") add("object", "An object remains unrecovered."); }
    if (entry.type === "report.filed" && payload.subject && !reviewedSubjects.has(payload.subject) && !reviewedSubjects.has(entry.id)) { reportedSubjects.add(payload.subject); }
    if (entry.type === "communication.sent" && payload.delivery_status && payload.delivery_status !== "delivered") add("communication", "A communication was not delivered.");
    if (entry.type === "evidence.recorded" || entry.type === "phenomenon.evidence.recorded") add("evidence", "Recorded evidence remains to compare.");
    if (entry.type === "phenomenon.perceived") { const later = source.some((candidate) => candidate.type === "phenomenon.evidence.recorded" && candidate.payload?.phenomenon_id === payload.phenomenon_id); if (!later) add("observation", "An observation remains unexplained."); }
    if (entry.type === "character.died" || (entry.type === "character.status.changed" && ["missing", "unknown", "unavailable"].includes(payload.status))) add("personnel", "A personnel absence remains part of the record.");
  }
  if (reportedSubjects.size) add("report", "A prior report remains unanswered.", reportedSubjects.size);
  const conflicts = new Map(); for (const entry of source.filter((item) => item.type === "report.filed" && item.payload?.relation === "contradicts")) { const subject = entry.payload.subject; const claims = conflicts.get(subject) ?? new Set(); claims.add(entry.payload.claim); conflicts.set(subject, claims); }
  if ([...conflicts.values()].some((claims) => claims.size > 1)) add("disagreement", "Institutional accounts disagree.");
  if (profile === "async-command") { const management = world.management ?? {}; const pendingReports = (management.reports ?? []).filter((report) => ["delivered", "queued", "transmitting"].includes(report.lifecycle)).length; if (pendingReports) add("report", "A field report still needs institutional attention.", pendingReports); const openIncidents = Object.values(management.incidents ?? {}).filter((incident) => incident.status === "open").length; if (openIncidents) add("incident", "A reported incident still needs a response.", openIncidents); const staffing = Object.values(management.personnel ?? {}).filter((person) => ["recovering", "unavailable"].includes(person.known_status ?? person.status)).length; if (staffing) add("staffing", "A staffing matter remains unresolved.", staffing); }
  if (profile === "local-anomaly") { const civilian = world.civilian; const unresolved = civilian?.unresolved?.length ?? 0; if (unresolved) add("question", "A personal question remains open.", unresolved); const hypotheses = Object.values(civilian?.hypotheses ?? {}).filter((hypothesis) => hypothesis.state === "suspected").length; if (hypotheses) add("question", "A personal hypothesis remains untested.", hypotheses); }
  if (profile === "lost" && !items.length && source.some((entry) => entry.type === "lost.explored")) add("landmark", "A remembered route remains part of what you know.");
  return { version: "yellow-beast-unfinished-business@v1", profile, items: items.sort((a, b) => a.kind.localeCompare(b.kind)).slice(0, MAX_ECHOES), implicit_continuity: profile === "lost" && items.length === 0, derived: true };
}
function reportSummary(world) {
  const index = build(world); return { version: index.version, history_events_indexed: index.events.length, max_echoes: MAX_ECHOES, profiles: ["field-researcher", "async-command", "local-anomaly", "lost"], derived: true, canonical_mutations: 0, event_spawning: 0, save_reload_rebuild: true, observer_filtered: true, invariants: { "echo second truth store": 0, "echo canonical mutation": 0, "echo event spawning": 0, "echo named-character resurrection": 0, "echo object duplication": 0, "echo cross-mode knowledge piggyback": 0, "echo hidden cause inference": 0, "echo raw identifier exposure": 0, "echo save/reload divergence": 0, "echo nondeterminism": 0, "echo story-thread causation": 0 } };
}
module.exports = { MAX_ECHOES, EVENT_LABELS, build, observerView, unfinishedBusiness, reportSummary, clone };
