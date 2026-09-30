"use strict";

// Deterministic observation -> speech scheduling authority. This module
// decides WHETHER, WHO, WHEN, and IN WHAT ORDER an autonomous NPC report may
// be spoken. It never decides WHAT is true (observation-authority.js owns
// that) and it never phrases anything (the AI provider, gated behind
// validateLocalDialogue, owns wording only). Nothing here calls a model.
//
// Queue entries point at feature_id + change_token -- canonical observation
// facts are never copied into the queue (observation_state remains the sole
// authority on what was perceived).

const crypto = require("node:crypto");
const canonicalLedger = require("./canonical-world-ledger");
const communicationRouting = require("./communication-routing");
const presentationBus = require("./presentation-bus");
const q4Interactions = require("./q4-interactions");
let phenomenonEcology = null;
try { phenomenonEcology = require("./q4-phenomenon-ecology"); } catch { phenomenonEcology = null; }

const VERSION = "yellow-beast-speech-queue@v1";

const SPEECH_STATES = Object.freeze(["NOTICE_ONLY", "REMEMBER", "REPORT_WHEN_CONVENIENT", "INTERRUPT_NOW"]);
const QUEUEABLE_STATES = Object.freeze(["REPORT_WHEN_CONVENIENT", "INTERRUPT_NOW"]);

const REPORT_PURPOSES = Object.freeze([
  "hazard_warning",
  "equipment_problem",
  "anomaly_notice",
  "personnel_condition",
  "assignment_blocker",
  "assignment_finding"
]);

// Frozen, code-owned scoring table -- mirrors observation-authority.WEIGHTS'
// discipline. Nothing outside this module may alter these.
const REPORT_WEIGHTS = Object.freeze({
  danger: Object.freeze({
    phenomenon: Object.freeze({ ACTIVE: 30, ESCALATING: 40, DORMANT: 5, default: 15 }),
    personnel: Object.freeze({ incapacitated: 35, missing: 40, dead: 45, default: 8 }),
    object: 8,
    evidence: 6,
    connection: 4,
    landmark: 4,
    default: 0
  }),
  assignment_relevance: 15,
  role_responsibility: 10,
  recognition_confidence: 5,
  novelty: 10,
  INTERRUPT_AT: 55,
  REPORT_AT: 30,
  REMEMBER_AT: 15
});

const PER_OBSERVER_CAP = 3;
const GLOBAL_CAP = 12;
const SPOKEN_CAP = 64;
const TTL = Object.freeze({ INTERRUPT_NOW: 2, REPORT_WHEN_CONVENIENT: 20 });

function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function record(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function create() {
  return { version: VERSION, seq: 0, entries: [], spoken: {} };
}

function migrate(queue) {
  if (!record(queue) || queue.version !== VERSION) return create();
  queue.entries = Array.isArray(queue.entries) ? queue.entries : [];
  queue.spoken = record(queue.spoken) ? queue.spoken : {};
  queue.seq = Number.isInteger(queue.seq) ? queue.seq : 0;
  return queue;
}

function ensureQueue(run) {
  run.expedition ??= {};
  run.expedition.speech_queue = migrate(run.expedition.speech_queue);
  return run.expedition.speech_queue;
}

function validateCurrent(queue) {
  const errors = [];
  if (!record(queue) || queue.version !== VERSION || !Array.isArray(queue.entries) || !record(queue.spoken)) {
    return { ok: false, errors: ["SPEECH_QUEUE_MALFORMED"] };
  }
  if (!Number.isInteger(queue.seq)) errors.push("speech_queue.seq is malformed");
  for (const entry of queue.entries) {
    if (!record(entry)) { errors.push("speech_queue entry is malformed"); continue; }
    if (!QUEUEABLE_STATES.includes(entry.disposition)) errors.push(`speech_queue entry ${entry.id} has an invalid disposition`);
    if (typeof entry.feature_id !== "string" || typeof entry.observer_id !== "string") errors.push(`speech_queue entry ${entry.id} is missing feature_id/observer_id`);
    if (!Number.isInteger(entry.seq)) errors.push(`speech_queue entry ${entry.id} has an invalid seq`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Scoring / classification (pure)
// ---------------------------------------------------------------------------

function kindOf(featureId) { return String(featureId).split(":")[0]; }
function canonicalIdOf(featureId) { const kind = kindOf(featureId); return String(featureId).slice(kind.length + 1); }

function dangerScore(run, world, featureId) {
  const kind = kindOf(featureId);
  const canonicalId = canonicalIdOf(featureId);
  if (kind === "phenomenon") {
    let state = "default";
    if (world && phenomenonEcology) {
      try {
        const found = (phenomenonEcology.records(world) ?? []).find((item) => item.id === canonicalId);
        if (found?.current_state) state = found.current_state;
      } catch { /* world shape not conformant -- no danger signal available */ }
    }
    return REPORT_WEIGHTS.danger.phenomenon[state] ?? REPORT_WEIGHTS.danger.phenomenon.default;
  }
  if (kind === "personnel") {
    const member = canonicalLedger.getObserverMember(run, canonicalId);
    const status = String(member?.status ?? "default").toLowerCase();
    return REPORT_WEIGHTS.danger.personnel[status] ?? REPORT_WEIGHTS.danger.personnel.default;
  }
  return REPORT_WEIGHTS.danger[kind] ?? REPORT_WEIGHTS.danger.default;
}

function assignmentRelevance(run, observerId, canonicalId) {
  let task = null;
  try { task = canonicalLedger.getCoworkerTask(run, observerId); } catch { task = null; }
  if (!task?.target) return 0;
  const target = String(task.target);
  return target === canonicalId || target.includes(canonicalId) ? REPORT_WEIGHTS.assignment_relevance : 0;
}

function isSuppressed(run, observerId, featureId, changeToken) {
  const queue = run.expedition?.speech_queue ?? null;
  if (!queue) return false;
  if (queue.spoken[`${observerId}|${featureId}`]?.change_token === changeToken) return true;
  for (const [key, entry] of Object.entries(queue.spoken)) {
    if (key.endsWith(`|${featureId}`) && entry.change_token === changeToken) return true;
  }
  return queue.entries.some((e) => e.feature_id === featureId && e.change_token === changeToken);
}

// Returns a numeric score, or null when the delta is not report-eligible at
// all (unrecognized, or already suppressed for this exact change_token).
function scoreReport(run, world, observerId, deltaEntry) {
  if (!deltaEntry || deltaEntry.new_state !== "RECOGNIZED") return null;
  if (!deltaEntry.recognition) return null; // NOTICED-but-unrecognized: cannot report what cannot be named
  if (isSuppressed(run, observerId, deltaEntry.feature_id, deltaEntry.change_token)) return null;

  const canonicalId = canonicalIdOf(deltaEntry.feature_id);
  let score = dangerScore(run, world, deltaEntry.feature_id);
  score += assignmentRelevance(run, observerId, canonicalId);
  if (deltaEntry.recognition.qualification) score += REPORT_WEIGHTS.role_responsibility;
  if (deltaEntry.prior_state === undefined || deltaEntry.prior_state === null) score += REPORT_WEIGHTS.novelty;
  score += REPORT_WEIGHTS.recognition_confidence;
  return score;
}

function classifyReport(run, world, observerId, deltaEntry) {
  const score = scoreReport(run, world, observerId, deltaEntry);
  if (score === null) return "NOTICE_ONLY";
  const kind = kindOf(deltaEntry.feature_id);
  if (score >= REPORT_WEIGHTS.INTERRUPT_AT && ["phenomenon", "personnel"].includes(kind)) return "INTERRUPT_NOW";
  if (score >= REPORT_WEIGHTS.REPORT_AT) return "REPORT_WHEN_CONVENIENT";
  if (score >= REPORT_WEIGHTS.REMEMBER_AT) return "REMEMBER";
  return "NOTICE_ONLY";
}

function purposeFor(world, featureId) {
  const kind = kindOf(featureId);
  if (kind === "phenomenon") {
    let state = null;
    if (world && phenomenonEcology) {
      try { state = (phenomenonEcology.records(world) ?? []).find((item) => item.id === canonicalIdOf(featureId))?.current_state ?? null; } catch { state = null; }
    }
    return state && state !== "DORMANT" ? "hazard_warning" : "anomaly_notice";
  }
  if (kind === "personnel") return "personnel_condition";
  if (kind === "object" || kind === "evidence") return "equipment_problem";
  return "assignment_finding";
}

function qualificationFor(run, observerId, featureId) {
  return run.observation_state?.observers?.[observerId]?.features?.[featureId]?.recognition?.qualification ?? null;
}

// Candidates MUST already be filtered to observers whose classification for
// this feature_id is >= REPORT_WHEN_CONVENIENT. Returns at most two owners,
// primary by score (ties broken by canonical team order), with a second
// owner only for a materially distinct qualification.
function selectReportOwners(run, world, candidateIds, featureId, scoresByObserver = {}) {
  if (!candidateIds.length) return [];
  const teamOrder = (run.expedition?.team?.members ?? []).map((m) => m.personnel_id ?? m.id);
  const ordered = [...candidateIds].sort((a, b) => {
    const diff = (scoresByObserver[b] ?? 0) - (scoresByObserver[a] ?? 0);
    if (diff !== 0) return diff;
    return teamOrder.indexOf(a) - teamOrder.indexOf(b);
  });
  const primary = ordered[0];
  const owners = [primary];
  const primaryQualification = qualificationFor(run, primary, featureId);
  for (const candidateId of ordered.slice(1)) {
    const qualification = qualificationFor(run, candidateId, featureId);
    if (qualification && qualification !== primaryQualification) { owners.push(candidateId); break; }
  }
  return owners.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Queue mutation
// ---------------------------------------------------------------------------

function dropLowest(queue, predicate) {
  const candidates = queue.entries.filter(predicate);
  if (!candidates.length) return;
  candidates.sort((a, b) => (a.priority - b.priority) || (b.created_at_interval - a.created_at_interval));
  const dropId = candidates[0].id;
  queue.entries = queue.entries.filter((e) => e.id !== dropId);
}

function pruneSpoken(queue) {
  const keys = Object.keys(queue.spoken);
  if (keys.length <= SPOKEN_CAP) return;
  const sorted = keys.sort((a, b) => (queue.spoken[a].at ?? 0) - (queue.spoken[b].at ?? 0));
  for (const key of sorted.slice(0, keys.length - SPOKEN_CAP)) delete queue.spoken[key];
}

function enqueueReport(run, { observer_id, feature_id, change_token, disposition, purpose, priority = 0, required_listener_ids = [], interval = run.expedition?.clock?.interval ?? 0 }) {
  if (!QUEUEABLE_STATES.includes(disposition)) return null;
  const queue = ensureQueue(run);
  if (queue.spoken[`${observer_id}|${feature_id}`]?.change_token === change_token) return null;
  if (queue.entries.some((e) => e.observer_id === observer_id && e.feature_id === feature_id && e.change_token === change_token)) return null;

  const seq = queue.seq++;
  const id = digest([run.run_id ?? null, observer_id, feature_id, change_token, seq]).slice(0, 18);
  const entry = {
    id,
    seq,
    observer_id,
    feature_id,
    change_token,
    disposition,
    priority,
    purpose,
    audience: { channel: "LOCAL", required_listener_ids: [...required_listener_ids] },
    created_at_interval: interval,
    expires_at_interval: interval + TTL[disposition],
    attempts: 0,
    state: "queued"
  };
  queue.entries.push(entry);

  if (queue.entries.filter((e) => e.observer_id === observer_id).length > PER_OBSERVER_CAP) dropLowest(queue, (e) => e.observer_id === observer_id);
  if (queue.entries.length > GLOBAL_CAP) dropLowest(queue, () => true);
  pruneSpoken(queue);
  return entry;
}

// Groups this tick's per-observer observation deltas by feature_id, scores
// and classifies each independently, then applies deterministic ownership.
// Called from the same locations run-bootstrap.js already records the
// player's own observation from -- never a new scan or timer.
function processObservationDeltas(run, world, locationId, deltasByObserver, { interval = run.expedition?.clock?.interval ?? 0 } = {}) {
  const byFeature = new Map();
  for (const [observerId, deltas] of Object.entries(deltasByObserver ?? {})) {
    for (const delta of deltas) {
      const score = scoreReport(run, world, observerId, delta);
      if (score === null) continue;
      const disposition = classifyReport(run, world, observerId, delta);
      if (disposition === "NOTICE_ONLY") continue;
      const key = `${delta.feature_id}|${delta.change_token}`;
      const bucket = byFeature.get(key) ?? { delta, candidates: [] };
      bucket.candidates.push({ observerId, disposition, score });
      byFeature.set(key, bucket);
    }
  }
  const enqueued = [];
  for (const { delta, candidates } of byFeature.values()) {
    const reportWorthy = candidates.filter((c) => c.disposition !== "REMEMBER");
    if (!reportWorthy.length) continue;
    const scores = Object.fromEntries(reportWorthy.map((c) => [c.observerId, c.score]));
    const owners = selectReportOwners(run, world, reportWorthy.map((c) => c.observerId), delta.feature_id, scores);
    for (const observerId of owners) {
      const candidate = reportWorthy.find((c) => c.observerId === observerId);
      const entry = enqueueReport(run, {
        observer_id: observerId,
        feature_id: delta.feature_id,
        change_token: delta.change_token,
        disposition: candidate.disposition,
        purpose: purposeFor(world, delta.feature_id),
        priority: candidate.score,
        interval
      });
      if (entry) enqueued.push(entry);
    }
  }
  return enqueued;
}

// ---------------------------------------------------------------------------
// Drain
// ---------------------------------------------------------------------------

function orderEntries(entries) {
  return [...entries].sort((a, b) => (b.priority - a.priority) || (a.created_at_interval - b.created_at_interval) || (a.seq - b.seq));
}

function pruneExpired(run) {
  const queue = run.expedition?.speech_queue;
  if (!queue) return;
  const interval = run.expedition.clock?.interval ?? 0;
  queue.entries = queue.entries.filter((e) => e.expires_at_interval >= interval);
}

// Called once on resume, before the first drain.
function pruneOnResume(run) {
  const queue = run.expedition?.speech_queue;
  if (!queue) return;
  const activeIds = new Set((run.expedition?.team?.members ?? []).map((m) => m.personnel_id ?? m.id));
  const interval = run.expedition.clock?.interval ?? 0;
  queue.entries = queue.entries.filter((e) =>
    activeIds.has(e.observer_id) &&
    Boolean(run.observation_state?.observers?.[e.observer_id]?.features?.[e.feature_id]) &&
    e.expires_at_interval >= interval
  );
  for (const entry of queue.entries) entry.attempts = 0;
}

function isSpeakerAvailable(run, observerId) {
  const member = canonicalLedger.getObserverMember(run, observerId);
  if (!member) return false;
  return !["dead", "missing", "incapacitated"].includes(String(member.status ?? "").toLowerCase());
}

function hasListener(run, observerId) {
  const routing = communicationRouting.determineListeners({ run, channel: "LOCAL", sender: observerId, recipients: [] });
  return routing.listeners.some((l) => l.heard);
}

function dialogueHistoryHasSubmission(run, submissionId) {
  return (run.expedition?.dialogue_history ?? []).some((e) => e.submission_id === submissionId);
}

function removeEntry(run, entryId) {
  const queue = ensureQueue(run);
  queue.entries = queue.entries.filter((e) => e.id !== entryId);
}

function markSpoken(run, entry) {
  const queue = ensureQueue(run);
  queue.spoken[`${entry.observer_id}|${entry.feature_id}`] = { change_token: entry.change_token, at: run.expedition.clock?.interval ?? 0 };
  pruneSpoken(queue);
}

// Re-validates entries in priority order, resolving supersession/expiry/
// unavailability as it goes, and returns the first entry that is currently
// drainable (or null). No-listener entries are skipped (left queued, TTL
// still running) rather than treated as failures.
function nextEligible(run, world) {
  ensureQueue(run);
  pruneExpired(run);
  const queue = run.expedition.speech_queue;
  for (const entry of orderEntries(queue.entries)) {
    const obsEntry = run.observation_state?.observers?.[entry.observer_id]?.features?.[entry.feature_id];
    if (!obsEntry || obsEntry.seen_change_token !== entry.change_token) {
      removeEntry(run, entry.id);
      if (obsEntry) {
        const reDelta = { feature_id: entry.feature_id, prior_state: null, new_state: obsEntry.state, change_token: obsEntry.seen_change_token, recognition: obsEntry.recognition };
        const score = scoreReport(run, world, entry.observer_id, reDelta);
        const disposition = classifyReport(run, world, entry.observer_id, reDelta);
        if (score !== null && QUEUEABLE_STATES.includes(disposition)) {
          enqueueReport(run, { observer_id: entry.observer_id, feature_id: entry.feature_id, change_token: obsEntry.seen_change_token, disposition, purpose: purposeFor(world, entry.feature_id), priority: score, interval: run.expedition.clock?.interval ?? 0 });
        }
      }
      continue;
    }
    if (!isSpeakerAvailable(run, entry.observer_id)) { removeEntry(run, entry.id); continue; }
    if (dialogueHistoryHasSubmission(run, entry.id)) { removeEntry(run, entry.id); continue; }
    if (!hasListener(run, entry.observer_id)) continue;
    return entry;
  }
  return null;
}

function commitReport(run, entry, speechText, { source = presentationBus.SOURCES.AI_PERFORMANCE } = {}) {
  if (dialogueHistoryHasSubmission(run, entry.id)) { removeEntry(run, entry.id); return null; }
  const routing = communicationRouting.routeAndDeliver({ run, channel: "LOCAL", sender: entry.observer_id, recipients: [], text: speechText, purpose: "observation-report" });
  const listeners = routing.routing.listeners.filter((l) => l.heard).map((l) => l.id);
  if (!listeners.length) return null; // race since eligibility check: stays queued, TTL still runs

  const member = canonicalLedger.getObserverMember(run, entry.observer_id);
  const dialogueEvent = presentationBus.createDialogueEvent({
    submission_id: entry.id,
    speaker_id: entry.observer_id,
    speaker_name: member?.first_name ?? member?.display_name ?? "Teammate",
    speaker_title: member?.role ?? null,
    recipient_type: "broadcast",
    listeners,
    channel: "LOCAL",
    text: speechText,
    kind: "speech",
    source,
    interval: run.expedition.clock?.interval ?? 0,
    delivery: "delivered"
  });
  run.expedition.dialogue_history ??= [];
  run.expedition.dialogue_history.push(dialogueEvent);
  presentationBus.emit(run, dialogueEvent);

  // S1: the visible LOCAL rail renders expedition.interaction_history, not
  // dialogue_history/presentation-bus. Without this, a canonically heard
  // report would never appear on screen. Only written when the player is
  // actually among the heard listeners -- a report the player didn't hear
  // must not appear in their own rail.
  const playerId = run.session?.startup?.player?.observer_id ?? null;
  if (playerId && listeners.includes(playerId)) {
    q4Interactions.record(run.expedition, {
      channel: "local",
      source: "autonomous-observation",
      speaker: member?.first_name ?? member?.display_name ?? "Teammate",
      speaker_id: entry.observer_id,
      recipient_type: "broadcast",
      listeners,
      player_text: null,
      attempted_behavior: "report an observation",
      eligibility: "eligible",
      delivery: "heard",
      presentation: { result: "heard", response: speechText },
      response_speaker: member?.first_name ?? member?.display_name ?? "Teammate",
      response_speaker_id: entry.observer_id,
      responses: [{ order: 0, speaker_id: entry.observer_id, speaker_name: member?.first_name ?? member?.display_name ?? "Teammate", text: speechText, source: source === presentationBus.SOURCES.AI_PERFORMANCE ? "ai-performance" : "deterministic" }],
      response_listeners: listeners,
      location_id: run.spatial?.personnel_locations?.[entry.observer_id] ?? null,
      submission_id: entry.id
    });
  }

  markSpoken(run, entry);
  removeEntry(run, entry.id);
  return dialogueEvent;
}

// speak(entry, run) -> Promise<string|null>. The scheduler decides
// eligibility, ordering, and interruption; speak() may only phrase the
// already-authorized report (or fail). A missing speak() leaves eligible
// entries queued rather than inventing fallback speech.
//
// canCommit() -> boolean is re-checked AFTER speak() resolves and BEFORE any
// commit side effect (routing, knowledge, dialogue event, suppression
// marker). transactionContext is an AsyncLocalStorage marker, not a lock, so
// a player turn can start and finish entirely during the provider's await;
// canCommit() is the caller's authority on whether the world is still safe
// to commit into. A false result is a postponement, never a failure: no
// attempt increment, no removal, the entry is left exactly as it was.
async function drainSpeechQueue(run, world, { max = 1, communicationTurnInflight = false, speak = null, canCommit = null } = {}) {
  if (communicationTurnInflight) return { drained: [] };
  const drained = [];
  for (let i = 0; i < max; i++) {
    const entry = nextEligible(run, world);
    if (!entry) break;
    if (!speak) break;
    let speechText = null;
    try { speechText = await speak(entry, run); } catch { speechText = null; }
    if (canCommit && !canCommit()) break; // postponement: world became busy during the provider await
    if (!speechText) {
      entry.attempts = (entry.attempts ?? 0) + 1;
      if (entry.attempts >= 2) removeEntry(run, entry.id); // exhaustion -> silence, never a canned fallback
      break;
    }
    const committed = commitReport(run, entry, speechText);
    if (committed) drained.push(committed);
  }
  return { drained };
}

module.exports = {
  VERSION,
  SPEECH_STATES,
  REPORT_PURPOSES,
  REPORT_WEIGHTS,
  create,
  migrate,
  validateCurrent,
  ensureQueue,
  classifyReport,
  scoreReport,
  selectReportOwners,
  enqueueReport,
  processObservationDeltas,
  pruneExpired,
  pruneOnResume,
  nextEligible,
  drainSpeechQueue,
  commitReport,
  removeEntry,
  markSpoken
};
