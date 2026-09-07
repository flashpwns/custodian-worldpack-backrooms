"use strict";

// Canonical World Ledger Interface.
// Enforces the core architectural rule: Exactly ONE complete representation
// of reality. Every AI context is a deliberately lossy observer-specific projection.
const clone = (value) => structuredClone(value);

const VERSION = "yellow-beast-canonical-world-ledger@v2";

function normalizePersonnelId(run, id) {
  if (!id) return null;
  const members = run.expedition?.team?.members ?? [];
  const direct = members.find((m) => (m.personnel_id ?? m.id) === id);
  if (direct) return direct.personnel_id ?? direct.id;
  const prefixed = members.find((m) => (m.personnel_id ?? m.id) === `personnel-${id}`);
  if (prefixed) return prefixed.personnel_id ?? prefixed.id;
  const stripped = id.startsWith("personnel-") ? members.find((m) => (m.personnel_id ?? m.id) === id.slice(10)) : null;
  if (stripped) return stripped.personnel_id ?? stripped.id;
  return id;
}

function getPlayerLocation(run) {
  return run.spatial?.player_location ?? null;
}

function getCoworkerLocation(run, memberId) {
  if (!memberId) return null;
  const norm = normalizePersonnelId(run, memberId);
  return run.spatial?.personnel_locations?.[norm] ?? run.spatial?.personnel_locations?.[memberId] ?? null;
}

function getPersonnelLocations(run) {
  return clone(run.spatial?.personnel_locations ?? {});
}

function getPersonnelLocation(run, memberId) {
  if (!memberId) return null;
  const norm = normalizePersonnelId(run, memberId);
  const locations = run.spatial?.personnel_locations ?? {};
  return locations[norm] ?? locations[memberId] ?? null;
}

function getEquipment(run, equipmentId) {
  if (!equipmentId) return null;
  return run.expedition?.equipment?.[equipmentId] ? clone(run.expedition.equipment[equipmentId]) : null;
}

function getEquipmentHolder(run, equipmentId) {
  if (!equipmentId) return null;
  return run.expedition?.equipment?.[equipmentId]?.holder ?? null;
}

function getEquipmentHeldBy(run, memberId) {
  if (!memberId) return [];
  const norm = normalizePersonnelId(run, memberId);
  return Object.entries(run.expedition?.equipment ?? {})
    .filter(([, item]) => item.holder === norm || item.holder === memberId)
    .map(([id, item]) => ({ id, ...clone(item) }));
}

function getObjectState(run, objectId) {
  if (!objectId) return null;
  return run.object_state?.objects?.[objectId] ? clone(run.object_state.objects[objectId]) : null;
}

function getEvidence(run, evidenceId) {
  if (!evidenceId) return null;
  const match = (run.expedition?.evidence ?? []).find((entry) => entry.id === evidenceId);
  return match ? clone(match) : null;
}

function getEvidenceProvenance(run, evidenceId) {
  const match = getEvidence(run, evidenceId);
  if (!match) return null;
  return {
    id: match.id,
    creator: match.creator ?? null,
    operator: match.operator ?? null,
    capturing_observer: match.capturing_observer ?? null,
    custodian: match.custodian ?? null,
    captured_at: clone(match.captured_at ?? { interval: match.interval ?? null }),
    method: match.method ?? null,
    device: match.device ?? null
  };
}

function getObserverMember(run, observerId) {
  if (!observerId) return null;
  const norm = normalizePersonnelId(run, observerId);
  return (run.expedition?.team?.members ?? []).find((m) => (m.personnel_id ?? m.id) === norm || (m.personnel_id ?? m.id) === observerId) ?? null;
}

function getObserverObservations(run, observerId) {
  const member = getObserverMember(run, observerId);
  if (!member) return [];
  return (member.known_information ?? []).filter((item) => item.source === "direct-observation");
}

function getObserverReportedKnowledge(run, observerId) {
  const member = getObserverMember(run, observerId);
  if (!member) return [];
  return (member.known_information ?? []).filter((item) => item.source && item.source !== "direct-observation");
}

function hasObserverObserved(run, observerId, target) {
  const observations = getObserverObservations(run, observerId);
  const normalized = String(target ?? "").toLowerCase().trim();
  return observations.some((item) => {
    const itemTarget = String(item.target ?? "").toLowerCase().trim();
    return itemTarget === normalized || (normalized.length > 3 && itemTarget.includes(normalized));
  });
}

function getStandardKnowledge(run) {
  const messages = (run.expedition?.messages ?? []).filter((m) =>
    m.intended_recipient === "Standard" && ["delivered", "acknowledged"].includes(m.state)
  );
  const evidence = (run.expedition?.evidence ?? []).filter((e) => e.reported_to_standard === true);

  const receivedClaims = messages.map((m) => {
    const evidentiarySupport = (m.evidence_ids ?? []).map((id) => getEvidenceProvenance(run, id)).filter(Boolean);
    const hasEvidence = evidentiarySupport.length > 0;
    return {
      claim_id: `claim-${m.id}`,
      source_observer: m.sender,
      source_message_id: m.id,
      received_at_interval: m.delivered_at ?? m.sent_at ?? run.expedition?.clock?.interval ?? 0,
      semantic_claim: {
        text: m.text,
        purpose: m.purpose ?? "routine-report"
      },
      evidentiary_support: evidentiarySupport,
      status: hasEvidence ? "supported" : "unverified"
    };
  });

  return {
    received_claims: receivedClaims,
    received_transmissions: messages.map((m) => ({
      message_id: m.id,
      sender: m.sender,
      text: m.text,
      purpose: m.purpose,
      delivered_at: m.delivered_at,
      evidence_ids: [...(m.evidence_ids ?? [])]
    })),
    reported_evidence: evidence.map((e) => ({
      evidence_id: e.id,
      type: e.type,
      measurement: e.measurement ?? null
    }))
  };
}

function recordCausalTransition(run, {
  kind = null,
  actor = null,
  target = null,
  prior_state = null,
  resulting_state = null,
  interval = null,
  cause_action_id = null,
  cause_attempt_id = null,
  details = null
} = {}) {
  run.causal_ledger = run.causal_ledger ?? [];
  const entry = {
    index: run.causal_ledger.length,
    kind: kind ?? null,
    actor: actor ?? null,
    target: target ?? null,
    prior_state: prior_state ? clone(prior_state) : null,
    resulting_state: resulting_state ? clone(resulting_state) : null,
    interval: interval ?? run.expedition?.clock?.interval ?? 0,
    cause_action_id: cause_action_id ?? null,
    cause_attempt_id: cause_attempt_id ?? null,
    details: details ? clone(details) : null
  };
  run.causal_ledger.push(entry);
  return entry;
}

function createDirectObservation({
  target,
  location,
  interval,
  observation_event_id = null,
  interval_id = null,
  observation = null
}) {
  return {
    kind: "direct-observation",
    source: "direct-observation",
    target,
    location,
    at: interval,
    observation_event_id: observation_event_id ?? interval_id ?? `obs-${target}-${interval}`,
    interval_id: interval_id ?? observation_event_id ?? `obs-${target}-${interval}`,
    observation,
    is_direct_witness: true
  };
}

function createReportedKnowledge({
  proposition,
  source_observer_id,
  source_message_id,
  interval,
  origin_observer_id = null,
  via_observer_id = null
}) {
  return {
    kind: "reported-knowledge",
    source: "local-communication",
    proposition,
    text: proposition,
    source_observer_id,
    sender: source_observer_id,
    source_message_id,
    message_id: source_message_id,
    at: interval,
    origin_observer_id: origin_observer_id ?? source_observer_id,
    via_observer_id: via_observer_id ?? (origin_observer_id && origin_observer_id !== source_observer_id ? source_observer_id : null),
    is_direct_witness: false
  };
}

function validateInvariants(run) {
  const violations = [];
  const unverifiable = [];

  // 1. One unique equipment item has at most one holder string
  const validPersonnelIds = new Set((run.expedition?.team?.members ?? []).map((m) => m.personnel_id ?? m.id));
  for (const [eqId, eq] of Object.entries(run.expedition?.equipment ?? {})) {
    if (eq.holder) {
      if (typeof eq.holder !== "string") {
        violations.push({ invariant: 1, code: "EQUIPMENT_HOLDER_NOT_STRING", message: `Equipment ${eqId} holder is not a string: ${eq.holder}` });
      } else if (!validPersonnelIds.has(eq.holder)) {
        violations.push({ invariant: 1, code: "EQUIPMENT_HOLDER_UNKNOWN", message: `Equipment ${eqId} holder ${eq.holder} not in team roster` });
      }
    }
  }

  // 2. One personnel entity has one canonical current location
  const locations = run.spatial?.personnel_locations ?? {};
  for (const member of run.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (!locations[id]) {
      violations.push({ invariant: 2, code: "PERSONNEL_LOCATION_MISSING", message: `Personnel ${id} has no canonical location in run.spatial.personnel_locations` });
    }
  }

  // 3. Personnel location references existing geography
  if (!run.spatial_pack_id) {
    unverifiable.push({ invariant: 3, code: "TOPOLOGY_UNAVAILABLE", reason: "spatial_pack_id is missing from run; topology cannot be resolved" });
  } else {
    try {
      const bootstrap = require("./run-bootstrap");
      const topology = bootstrap.topologyFor(run);
      if (!topology || !Array.isArray(topology.locations)) {
        unverifiable.push({ invariant: 3, code: "TOPOLOGY_RESOLUTION_FAILED", reason: "Topology resolution returned no valid location list" });
      } else {
        const locationIds = new Set(topology.locations.map((loc) => loc.id));
        for (const [personId, locId] of Object.entries(locations)) {
          if (!locationIds.has(locId)) {
            violations.push({ invariant: 3, code: "PERSONNEL_LOCATION_INVALID", message: `Personnel ${personId} location ${locId} not found in topology` });
          }
        }
      }
    } catch (error) {
      unverifiable.push({ invariant: 3, code: "TOPOLOGY_EXCEPTION", reason: `Topology resolution threw an exception: ${error.message}` });
    }
  }

  // 4. Controlled player ID must never accidentally alias a coworker ID
  const playerId = run.session?.startup?.player?.observer_id;
  if (playerId) {
    const matching = (run.expedition?.team?.members ?? []).filter((m) => (m.personnel_id ?? m.id) === playerId);
    if (matching.length > 1) {
      violations.push({ invariant: 4, code: "PLAYER_COWORKER_IDENTITY_ALIASED", message: `Controlled player ${playerId} aliases coworker (multiple members match player ID)` });
    }
    for (const m of run.expedition?.team?.members ?? []) {
      if ((m.personnel_id ?? m.id) === playerId && (m.contact_category === "LOCAL" || m.mission_authority === "assigned operational authority")) {
        violations.push({ invariant: 4, code: "PLAYER_COWORKER_IDENTITY_ALIASED", message: `Coworker ${m.first_name} ${m.last_name} aliases player ID ${playerId}` });
      }
    }
  }

  // 5. Photographic evidence has a valid capturing observer
  for (const ev of run.expedition?.evidence ?? []) {
    if (ev.type?.includes("photo")) {
      if (!ev.capturing_observer) {
        violations.push({ invariant: 5, code: "PHOTO_EVIDENCE_LACKS_OBSERVER", message: `Photographic evidence ${ev.id} lacks capturing_observer` });
      } else if (!validPersonnelIds.has(ev.capturing_observer)) {
        violations.push({ invariant: 5, code: "PHOTO_EVIDENCE_OBSERVER_UNKNOWN", message: `Photographic evidence ${ev.id} capturing_observer ${ev.capturing_observer} not in team roster` });
      }
    }
  }

  // 6. Direct knowledge has direct-observation provenance
  for (const member of run.expedition?.team?.members ?? []) {
    const direct = (member.known_information ?? []).filter((i) => ["coordinated-inspection", "location-investigated", "direct-observation"].includes(i.kind));
    for (const item of direct) {
      if (item.source !== "direct-observation") {
        violations.push({ invariant: 6, code: "DIRECT_OBSERVATION_PROVENANCE_INVALID", message: `Direct observation ${item.kind} for ${member.personnel_id ?? member.id} lacks direct-observation source: ${item.source}` });
      }
    }
  }

  // 7. Reported knowledge has communication provenance
  for (const member of run.expedition?.team?.members ?? []) {
    const reported = (member.known_information ?? []).filter((i) => i.kind === "reported-knowledge");
    for (const item of reported) {
      if (item.source === "direct-observation") {
        violations.push({ invariant: 7, code: "REPORTED_KNOWLEDGE_CLAIMS_DIRECT", message: `Reported knowledge for ${member.personnel_id ?? member.id} claims direct-observation source` });
      }
    }
  }

  const ok = violations.length === 0 && unverifiable.length === 0;
  const status = violations.length > 0 ? "FAIL" : (unverifiable.length > 0 ? "UNVERIFIABLE" : "PASS");

  return { ok, status, violations, unverifiable };
}

// Structured Task Management
function getCoworkerTask(run, memberId) {
  const member = getObserverMember(run, memberId);
  if (!member?.task) return null;
  const t = clone(member.task);
  t.action = t.action ?? t.task?.toUpperCase() ?? null;
  return t;
}

function setCoworkerTask(run, memberId, taskArg, targetArg = null, options = {}) {
  const member = getObserverMember(run, memberId);
  if (!member) return null;
  const norm = normalizePersonnelId(run, memberId);

  let task, target, status, assigned_by, equipment, priority;
  if (typeof taskArg === "object" && taskArg !== null) {
    task = taskArg.task ?? taskArg.action;
    target = taskArg.target ?? null;
    status = taskArg.status ?? "assigned";
    assigned_by = taskArg.assigned_by ?? "player";
    equipment = taskArg.equipment ?? null;
    priority = taskArg.priority ?? 1;
  } else {
    task = taskArg;
    target = targetArg;
    status = options?.status ?? "assigned";
    assigned_by = options?.assigned_by ?? "player";
    equipment = options?.equipment ?? null;
    priority = options?.priority ?? 1;
  }

  const taskObj = {
    id: `task-${norm}-${task}-${Date.now()}`,
    actor: norm,
    task: String(task).toLowerCase(),
    action: String(task).toUpperCase(),
    target: target ? String(target) : null,
    status: String(status).toLowerCase(),
    progress: 0.0,
    priority: Number(priority ?? 1),
    assigned_by: String(assigned_by),
    assigned_at: run.expedition?.clock?.interval ?? 0,
    equipment: equipment ? String(equipment) : null
  };
  const priorTask = member.task ? clone(member.task) : null;
  member.task = taskObj;
  member.task_history ??= [];
  member.task_history.push(clone(taskObj));

  recordCausalTransition(run, {
    kind: "task_assigned",
    actor: norm,
    target: taskObj.target,
    prior_state: priorTask,
    resulting_state: taskObj,
    details: { task: taskObj.task, assigned_by: taskObj.assigned_by, equipment: taskObj.equipment }
  });

  return clone(taskObj);
}

function progressCoworkerTask(run, memberId, statusArg, details = null) {
  const member = getObserverMember(run, memberId);
  if (!member || !member.task) return null;
  const norm = normalizePersonnelId(run, memberId);
  const priorStatus = member.task.status;

  if (typeof statusArg === "object" && statusArg !== null) {
    if (statusArg.status) member.task.status = String(statusArg.status).toLowerCase();
    if (statusArg.progress !== undefined) member.task.progress = Number(statusArg.progress);
  } else {
    member.task.status = String(statusArg).toLowerCase();
    if (details?.progress !== undefined) member.task.progress = Number(details.progress);
  }
  member.task.updated_at = run.expedition?.clock?.interval ?? 0;

  recordCausalTransition(run, {
    kind: "task_progressed",
    actor: norm,
    target: member.task.target,
    prior_state: { status: priorStatus },
    resulting_state: { status: member.task.status, progress: member.task.progress },
    details: { task: member.task.task, ...(details ?? {}) }
  });

  return clone(member.task);
}

// Structured Emotional / Behavioral State
const DEFAULT_EMOTIONAL_STATE = Object.freeze({
  stress: 0.25,
  trust_player: 0.75,
  fatigue: 0.15,
  curiosity: 0.70,
  urgency: 0.20
});

function clamp01(v) {
  return Math.max(0.0, Math.min(1.0, Math.round(Number(v) * 100) / 100));
}

function getCoworkerEmotionalState(run, memberId) {
  const member = getObserverMember(run, memberId);
  if (!member) return null;
  member.emotional_state ??= { ...DEFAULT_EMOTIONAL_STATE };
  return clone(member.emotional_state);
}

function updateCoworkerEmotionalState(run, memberId, updates = {}) {
  const member = getObserverMember(run, memberId);
  if (!member) return null;
  member.emotional_state ??= { ...DEFAULT_EMOTIONAL_STATE };
  for (const [key, val] of Object.entries(updates)) {
    if (key in DEFAULT_EMOTIONAL_STATE && typeof val === "number") {
      member.emotional_state[key] = clamp01(val);
    }
  }
  return clone(member.emotional_state);
}

function formatCoworkerEmotionalSummary(emotionalState) {
  if (!emotionalState) return "calm, attentive";
  const parts = [];
  const { stress = 0.25, curiosity = 0.7, trust_player = 0.75, urgency = 0.2 } = emotionalState;
  if (stress > 0.6) parts.push("stressed");
  else if (stress > 0.35) parts.push("mildly stressed");
  else parts.push("calm");

  if (curiosity > 0.6) parts.push("highly curious");
  else if (curiosity > 0.35) parts.push("observant");

  if (trust_player > 0.6) parts.push("trusts the player");
  else if (trust_player < 0.4) parts.push("hesitant");

  if (urgency > 0.6) parts.push("high urgency");
  else if (urgency < 0.3) parts.push("low urgency");

  return parts.join(", ");
}

// Causal Event Helpers
function recordEquipmentTransfer(run, { from, to, item, interval = null, cause_action_id = null }) {
  return recordCausalTransition(run, {
    kind: "equipment_transfer",
    actor: from,
    target: to,
    resulting_state: { holder: to, item },
    interval,
    cause_action_id,
    details: { item, from, to }
  });
}

function recordLocationEntered(run, { actor, location, prior_location = null, interval = null }) {
  return recordCausalTransition(run, {
    kind: "location_entered",
    actor,
    target: location,
    prior_state: prior_location ? { location: prior_location } : null,
    resulting_state: { location },
    interval,
    details: { actor, location, prior_location }
  });
}

function recordObservationMade(run, { observer, target, location, interval = null, observation = null }) {
  return recordCausalTransition(run, {
    kind: "observation_made",
    actor: observer,
    target,
    resulting_state: { target, location, observation },
    interval,
    details: { observer, target, location, observation }
  });
}

function recordRadioTransmission(run, { channel, sender, recipients = [], listeners = [], text = null, interval = null }) {
  return recordCausalTransition(run, {
    kind: "radio_transmission",
    actor: sender,
    target: recipients.join(","),
    resulting_state: { channel, sender, recipients, listeners, text },
    interval,
    details: { channel, sender, recipients, listeners, text }
  });
}

module.exports = {
  VERSION,
  normalizePersonnelId,
  getPlayerLocation,
  getCoworkerLocation,
  getPersonnelLocations,
  getPersonnelLocation,
  getEquipment,
  getEquipmentHolder,
  getEquipmentHeldBy,
  getObjectState,
  getEvidence,
  getEvidenceProvenance,
  getObserverMember,
  getObserverObservations,
  getObserverReportedKnowledge,
  hasObserverObserved,
  getStandardKnowledge,
  recordCausalTransition,
  createDirectObservation,
  createReportedKnowledge,
  validateInvariants,
  getCoworkerTask,
  setCoworkerTask,
  progressCoworkerTask,
  getCoworkerEmotionalState,
  updateCoworkerEmotionalState,
  formatCoworkerEmotionalSummary,
  recordEquipmentTransfer,
  recordLocationEntered,
  recordObservationMade,
  recordRadioTransmission
};

