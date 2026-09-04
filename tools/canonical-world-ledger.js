"use strict";

// Canonical World Ledger Interface.
// Enforces the core architectural rule: Exactly ONE complete representation
// of reality. Every AI context is a deliberately lossy observer-specific projection.
const clone = (value) => structuredClone(value);

const VERSION = "yellow-beast-canonical-world-ledger@v1";

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
  return {
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
      provenance: getEvidenceProvenance(run, e.id)
    }))
  };
}

function recordCausalTransition(run, {
  kind,
  actor,
  target = null,
  prior_state = null,
  resulting_state = null,
  interval = run.expedition?.clock?.interval ?? 0,
  cause_action_id = null,
  cause_attempt_id = null,
  details = null
}) {
  run.causal_ledger ??= [];
  const entry = {
    sequence: run.causal_ledger.length + 1,
    kind,
    actor,
    target,
    prior_state: clone(prior_state),
    resulting_state: clone(resulting_state),
    interval,
    cause_action_id,
    cause_attempt_id,
    details: details ? clone(details) : null,
    recorded_at: Date.now()
  };
  run.causal_ledger.push(entry);
  return entry;
}

function validateInvariants(run) {
  const violations = [];

  // 1. One unique equipment item has at most one holder
  for (const [eqId, eq] of Object.entries(run.expedition?.equipment ?? {})) {
    if (eq.holder && typeof eq.holder !== "string") {
      violations.push({ invariant: 1, message: `Equipment ${eqId} holder is not a string: ${eq.holder}` });
    }
  }

  // 2. One personnel entity has one canonical current location
  const locations = run.spatial?.personnel_locations ?? {};
  for (const member of run.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (!locations[id]) {
      violations.push({ invariant: 2, message: `Personnel ${id} has no canonical location in run.spatial.personnel_locations` });
    }
  }

  // 3. Personnel location references existing geography
  if (run.spatial_pack_id) {
    try {
      const bootstrap = require("./run-bootstrap");
      const topology = bootstrap.topologyFor(run);
      const locationIds = new Set(topology.locations.map((loc) => loc.id));
      for (const [personId, locId] of Object.entries(locations)) {
        if (!locationIds.has(locId)) {
          violations.push({ invariant: 3, message: `Personnel ${personId} location ${locId} not found in topology` });
        }
      }
    } catch {
      // ignore topology resolution if unavailable
    }
  }

  // 4. Photographic evidence has a valid capturing observer
  for (const ev of run.expedition?.evidence ?? []) {
    if (ev.type?.includes("photo") && !ev.capturing_observer) {
      violations.push({ invariant: 5, message: `Photographic evidence ${ev.id} lacks capturing_observer` });
    }
  }

  // 5. Direct knowledge has direct-observation provenance
  for (const member of run.expedition?.team?.members ?? []) {
    const direct = (member.known_information ?? []).filter((i) => ["coordinated-inspection", "location-investigated"].includes(i.kind));
    for (const item of direct) {
      if (item.source !== "direct-observation") {
        violations.push({ invariant: 6, message: `Direct observation ${item.kind} for ${member.personnel_id} lacks direct-observation source: ${item.source}` });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  VERSION,
  normalizePersonnelId,
  getPlayerLocation,
  getCoworkerLocation,
  getPersonnelLocations,
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
  validateInvariants
};
