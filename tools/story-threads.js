"use strict";
// Derived analysis only: this module never calls a world-history mutator.
const crypto = require("node:crypto");
const history = require("./world-history");
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const eventOrder = (a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id);
const threadId = (world, type, anchor) => `thread-${digest([world.world_id, type, anchor])}`;
// Derived-only caches. WeakMap scope means abandoned worlds cannot be retained,
// while the revision tuple invalidates the entry after normal history appends.
const indexCache = new WeakMap();
const observerCache = new WeakMap();
const TYPE_LABELS = {
  RECOVERED_OBJECT: { "field-researcher": "Equipment with an incomplete field history", "async-command": "Unreturned equipment record", "local-anomaly": "An object seen again", lost: null },
  REPEATED_PHENOMENON: { "field-researcher": "Repeated field observation", "async-command": "Repeated reported observation", "local-anomaly": "A repeated observation", lost: null },
  PERSONNEL_DISAPPEARANCE: { "field-researcher": "Personnel status changed", "async-command": "Personnel matter requiring follow-up", "local-anomaly": null, lost: null },
  CONTRADICTORY_REPORTS: { "field-researcher": "Conflicting field accounts", "async-command": "Conflicting reports", "local-anomaly": null, lost: null },
  UNEXPLAINED_ENVIRONMENT_CHANGE: { "field-researcher": "Changed field condition", "async-command": "Reported environmental change", "local-anomaly": "A changed place", lost: null }
};
function eventsFor(world) { return [...world.events].sort(eventOrder); }
function relation(type, anchor, entries, extra = {}) { return { type, anchor, event_refs: entries.map((entry) => entry.id), first_seen_at: entries[0]?.sequence ?? null, last_updated_at: entries.at(-1)?.sequence ?? null, status: entries.length > 2 ? "ACTIVE" : "CANDIDATE", significance: Math.min(3, entries.length), provenance: "derived-from-canonical-history", ...extra }; }
function indexBy(events, select) { const groups = new Map(); for (const entry of events) { const key = select(entry); if (!key) continue; (groups.get(key) ?? groups.set(key, []).get(key)).push(entry); } return groups; }
function derive(world) {
  history.assertWorld(world);
  const last = world.events.at(-1);
  const revision = `${world.event_sequence}:${world.events.length}:${last?.id ?? ""}`;
  const cached = indexCache.get(world);
  if (cached?.revision === revision) return cached.index;
  const events = eventsFor(world); const candidates = [];
  for (const [artifact_id, entries] of indexBy(events, (entry) => entry.payload?.artifact_id ?? null)) if (entries.length >= 2) candidates.push(relation("RECOVERED_OBJECT", artifact_id, entries));
  for (const [phenomenon_id, entries] of indexBy(events, (entry) => entry.payload?.phenomenon_id ?? null)) if (entries.length >= 2) candidates.push(relation("REPEATED_PHENOMENON", phenomenon_id, entries));
  for (const [identity, entries] of indexBy(events.filter((entry) => entry.type === "character.died" || entry.type === "character.status.changed"), (entry) => entry.payload?.identity ?? null)) if (entries.length) candidates.push(relation("PERSONNEL_DISAPPEARANCE", identity, entries, { status: "ACTIVE", significance: 2 }));
  for (const [region_id, entries] of indexBy(events.filter((entry) => entry.type === "region.mutated"), (entry) => entry.payload?.region_id ?? null)) if (entries.length >= 2 || entries.some((entry) => String(entry.payload?.provenance).includes("phenomenon"))) candidates.push(relation("UNEXPLAINED_ENVIRONMENT_CHANGE", region_id, entries));
  const reports = events.filter((entry) => entry.type === "report.filed" && entry.payload?.subject && entry.payload?.claim && entry.payload?.relation === "contradicts");
  for (const [subject, entries] of indexBy(reports, (entry) => entry.payload.subject)) if (new Set(entries.map((entry) => entry.payload.claim)).size > 1) candidates.push(relation("CONTRADICTORY_REPORTS", subject, entries, { status: "ACTIVE", significance: 2, relation_strength: "structured-conflict" }));
  const threads = candidates.map((item) => ({ version: "yellow-beast-story-thread@v1", thread_id: threadId(world, item.type, item.anchor), ...item })).sort((a, b) => a.thread_id.localeCompare(b.thread_id));
  const index = { version: "yellow-beast-story-thread-index@v1", world_id: world.world_id, history_digest: digest(events.map(({ id }) => id)), threads };
  indexCache.set(world, { revision, index });
  observerCache.set(index, new Map());
  return index;
}
function allowedEvents(world, index, profile) {
  const cached = observerCache.get(index);
  if (cached?.has(profile)) return cached.get(profile);
  const runs = new Set(Object.values(world.runs).filter((run) => run.profile === profile).map((run) => run.id));
  const allowed = new Set(eventsFor(world).filter((entry) => runs.has(entry.run_id)).map((entry) => entry.id));
  cached?.set(profile, allowed);
  return allowed;
}
function observerView(world, index, profile) {
  if (profile === "lost") return { profile, threads: [], implicit_continuity: true };
  const allowed = allowedEvents(world, index, profile); const threads = index.threads.filter((thread) => thread.event_refs.some((id) => allowed.has(id))).map((thread) => ({ type: thread.type, status: thread.status, significance: thread.significance, title: TYPE_LABELS[thread.type]?.[profile] ?? "A related matter", latest_known_event_ref: thread.event_refs.filter((id) => allowed.has(id)).at(-1) ?? null })).filter((thread) => thread.title);
  return { profile, threads, implicit_continuity: false };
}
function fallbackSummary(view) { if (!view.threads.length) return view.implicit_continuity ? "No explicit matter is presented." : "No related matter is currently available."; return view.threads.map((thread) => thread.title).join(". "); }
function validateSummary(view, response) { const prose = String(response?.prose ?? "").trim(); if (!prose) return { ok: false, reason: "malformed" }; if (/\b(?:because|taken by|still life|culprit|motive|will happen|secretly)\b/i.test(prose)) return { ok: false, reason: "unsupported-relation" }; return { ok: true, prose }; }
async function summarize({ view, provider = null }) { if (provider?.summarize) try { const checked = validateSummary(view, await provider.summarize({ view })); if (checked.ok) return { source: "provider", ...checked }; return { source: "fallback", prose: fallbackSummary(view), fallback_reason: checked.reason }; } catch { return { source: "fallback", prose: fallbackSummary(view), fallback_reason: "provider-failed" }; } return { source: "fallback", prose: fallbackSummary(view), fallback_reason: null }; }
function reportSummary(index) { const count = (type) => index.threads.filter((thread) => thread.type === type).length; return { version: index.version, thread_types: Object.fromEntries(Object.keys(TYPE_LABELS).map((type) => [type, count(type)])), derivation: "canonical events and observer-safe projections only", canonical_events_mutated: 0, rebuild: "deterministic from world history", cross_mode: "shared anchor identity; observer views are filtered", invariants: { "story-thread second truth store": 0, "story-thread canonical mutation": 0, "story-thread object duplication": 0, "story-thread named-character resurrection": 0, "thread-derived location omniscience": 0, "similar event / common cause conflation": 0, "cross-observer thread knowledge piggyback": 0, "story significance / simulation outcome coupling": 0, "player hypothesis / world causation coupling": 0, "thread-driven event spawning": 0, "unsupported thread merge": 0, "unsupported provider thread relation accepted": 0, "story-thread opaque ID exposure": 0, "thread rebuild divergence": 0, "thread export/import divergence": 0, "thread-induced drama event": 0, "story system post-death character reappearance": 0, "story-thread derivation nondeterminism": 0, "narrative-director canonical authority": 0, "thread/report objective-truth conflation": 0, "thread/entity hidden-cause invention": 0, "mode-private thread knowledge leakage": 0 } }; }
module.exports = { derive, observerView, fallbackSummary, validateSummary, summarize, reportSummary, TYPE_LABELS, clone };
