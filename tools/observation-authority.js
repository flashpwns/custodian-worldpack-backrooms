"use strict";

// Deterministic perception/observation authority. This module is the sole
// authority for what a given observer has ever perceived, noticed, or
// recognized. It owns run.observation_state exclusively, writes only the
// calling observer's own bucket, and never copies canonical world truth into
// that bucket -- only ids, digests, and intervals. Nothing here imports or
// calls any dialogue/model/provider code, and nothing here decides existence,
// visibility, notice, recognition, or knowledge on behalf of that layer --
// this module is upstream of it.
//
// Modeled directly on survey-frontier.js's shape discipline (per-observer
// buckets, provenance arrays, a validateCurrent hook) but scoped to
// perception rather than epistemic map knowledge.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const spatialRuntime = require("./spatial-runtime");
const q4Environment = require("./q4-environment");
const phenomenonEcology = require("./q4-phenomenon-ecology");
const canonicalLedger = require("./canonical-world-ledger");

const VERSION = "yellow-beast-observation-state@v1";
const VALID_STATES = Object.freeze(["VISIBLE", "NOTICED", "RECOGNIZED", "INSPECTED"]);
const VALID_KINDS = Object.freeze(["landmark", "object", "connection", "phenomenon", "personnel", "evidence"]);
const PROVENANCE_CAP = 6;
const DEFAULT_THRESHOLD = 20;
const ROOT = path.join(__dirname, "..");

// Frozen, code-owned salience weight table. Nothing outside this module may
// alter these -- salienceFor is a pure function of canonical state only.
const WEIGHTS = Object.freeze({
  proximity: Object.freeze({ SAME_ROOM: 12, REMOTE: 0, UNKNOWN: 0 }),
  prominence: Object.freeze({ landmark: 6, object: 5, connection: 3, phenomenon: 9, personnel: 7, evidence: 4 }),
  novelty_bonus: 8,
  anomaly_base: 10,
  anomaly_active_bonus: 5,
  task_idle_bonus: 3,
  task_busy_penalty: -2,
  role_relevance_bonus: 3
});

const clone = (value) => structuredClone(value);
const record = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

// ---------------------------------------------------------------------------
// Lifecycle: create / migrate / validateCurrent
// ---------------------------------------------------------------------------

function create({ worldpack_id = null } = {}) {
  return { version: VERSION, worldpack_id, observers: {} };
}

function migrate(observationState) {
  if (!record(observationState)) return create({ worldpack_id: null });
  if (observationState.version !== VERSION) return create({ worldpack_id: observationState.worldpack_id ?? null });
  observationState.observers ??= {};
  for (const bucket of Object.values(observationState.observers)) {
    if (!record(bucket)) continue;
    bucket.features ??= {};
  }
  return observationState;
}

function validateCurrent(observationState) {
  const errors = [];
  if (!record(observationState) || observationState.version !== VERSION || !record(observationState.observers)) {
    return { ok: false, errors: ["OBSERVATION_STATE_MALFORMED"] };
  }
  for (const [observerId, bucket] of Object.entries(observationState.observers)) {
    if (!record(bucket) || !record(bucket.features)) { errors.push(`observers.${observerId} is malformed`); continue; }
    for (const [featureId, entry] of Object.entries(bucket.features)) {
      const kind = String(featureId).split(":")[0];
      if (!VALID_KINDS.includes(kind)) errors.push(`observers.${observerId}.features.${featureId} has an unknown feature kind`);
      if (!record(entry) || !VALID_STATES.includes(entry.state) || !Array.isArray(entry.provenance)) {
        errors.push(`observers.${observerId}.features.${featureId} is malformed`);
        continue;
      }
      if (typeof entry.seen_change_token !== "string") errors.push(`observers.${observerId}.features.${featureId}.seen_change_token is malformed`);
      if (!Number.isInteger(entry.salience_at_notice)) errors.push(`observers.${observerId}.features.${featureId}.salience_at_notice is malformed`);
      if (entry.recognition !== null && (!record(entry.recognition) || (entry.recognition.qualification !== null && typeof entry.recognition.qualification !== "string"))) {
        errors.push(`observers.${observerId}.features.${featureId}.recognition is malformed`);
      }
      for (const provenance of entry.provenance) {
        if (!record(provenance) || typeof provenance.source !== "string" || !Object.hasOwn(provenance, "at") || typeof provenance.direct !== "boolean") {
          errors.push(`observers.${observerId}.features.${featureId} provenance is malformed`);
        }
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Canonical read helpers (read-only; never mutate run/world)
// ---------------------------------------------------------------------------

// Minimal, self-contained read of the worldpack's spatial definition. This
// deliberately does not import run-bootstrap.js -- it reimplements only the
// narrow file read that module also performs, against the same JSON shape.
// Tests may bypass file I/O entirely by setting run._observationDefinition.
function definitionFor(run) {
  if (run?._observationDefinition) return run._observationDefinition;
  const packId = run?.spatial_pack_id;
  if (typeof packId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(packId)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, `data/worldpacks/${packId}/spatial.json`), "utf8"));
  } catch {
    return null;
  }
}

function canonicalTopology(run) {
  const definition = definitionFor(run);
  if (!definition) return null;
  try {
    return spatialRuntime.canonicalDefinition(run?.spatial ?? {}, definition);
  } catch {
    return null;
  }
}

function locationOf(run, personId) {
  if (!personId) return null;
  const playerId = run?.session?.startup?.player?.observer_id ?? null;
  if (personId === playerId || personId === "player") return run?.spatial?.player_location ?? null;
  return run?.spatial?.personnel_locations?.[personId] ?? null;
}

function findMember(run, observerId) {
  return (run?.expedition?.team?.members ?? []).find((member) => (member.personnel_id ?? member.id) === observerId) ?? null;
}

function safeGetCoworkerTask(run, observerId) {
  try { return canonicalLedger.getCoworkerTask(run, observerId); } catch { return null; }
}

function phenomenonRecord(world, canonicalId) {
  if (!world) return null;
  try { return phenomenonEcology.records(world).find((item) => item.id === canonicalId) ?? null; } catch { return null; }
}

function makeFeature(kind, canonicalId, canonicalSlice, extra = {}) {
  const featureId = `${kind}:${canonicalId}`;
  return { featureId, kind, canonicalId, change_token: digest(canonicalSlice), ...extra };
}

// ---------------------------------------------------------------------------
// enumerateFeatures
// ---------------------------------------------------------------------------

function enumerateFeatures(run, world, locationId) {
  const topology = canonicalTopology(run);
  const features = [];

  if (topology) {
    const location = (topology.locations ?? []).find((item) => item.id === locationId);
    for (const landmark of location?.landmarks ?? []) {
      if (!landmark?.id) continue;
      features.push(makeFeature("landmark", landmark.id, landmark, { location_id: locationId }));
    }
    for (const connection of topology.connections ?? []) {
      if (connection.from !== locationId && !(connection.bidirectional && connection.to === locationId)) continue;
      features.push(makeFeature("connection", connection.id, connection, { from: connection.from, to: connection.to }));
    }
  }

  for (const [id, object] of Object.entries(run?.object_state?.objects ?? {})) {
    if (object?.location !== locationId) continue;
    features.push(makeFeature("object", id, object, { location_id: locationId }));
  }

  // Same defensive shape as phenomenonRecord() below: a caller may pass a
  // world value that does not conform to world-history's canonical shape
  // (e.g. an ad hoc fixture object). That is not this module's concern to
  // validate -- it simply yields no phenomenon features for that call.
  if (world) {
    let records = [];
    try { records = phenomenonEcology.records(world); } catch { records = []; }
    for (const item of records) {
      if (item.location_id !== locationId) continue;
      const slice = { canonical_family: item.canonical_family, current_state: item.current_state, recognition_requirement: item.recognition_requirement ?? null };
      features.push(makeFeature("phenomenon", item.id, slice, { location_id: locationId, canonical_family: item.canonical_family, current_state: item.current_state, recognition_requirement: item.recognition_requirement ?? null }));
    }
  }

  for (const member of run?.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (locationOf(run, id) !== locationId) continue;
    const slice = { role: member.role ?? null, condition: member.condition ?? null, status: member.status ?? null };
    features.push(makeFeature("personnel", id, slice, { location_id: locationId }));
  }

  features.sort((a, b) => a.featureId.localeCompare(b.featureId));
  return features;
}

// ---------------------------------------------------------------------------
// visibilityFor
// ---------------------------------------------------------------------------

function hasLightSource(run, locationId) {
  const equipment = run?.expedition?.equipment ?? {};
  for (const item of Object.values(equipment)) {
    if (!item || item.state === "depleted") continue;
    const isLight = item.id === "field-light" || item.capability === "illumination";
    if (!isLight) continue;
    if (locationOf(run, item.holder) === locationId) return true;
  }
  return false;
}

// Lighting gate via the dynamic per-location state (q4-environment.current),
// never the static location.environment field -- that field is stale versus
// the persisted, mutable environment snapshot spatial-runtime itself reads.
function lightingAllows(run, locationId) {
  const env = run?.spatial?.environment;
  if (!env) return true; // no tracked environment: the factor can't be represented, so omit it
  const values = q4Environment.current(env, locationId);
  if (!values) return true;
  if (values.lighting !== "dark") return true;
  return hasLightSource(run, locationId);
}

function visibilityFor(run, world, observerId, featureId) {
  const kind = String(featureId).split(":")[0];
  const canonicalId = String(featureId).slice(kind.length + 1);
  const obsLoc = locationOf(run, observerId);
  if (!obsLoc) return false;

  if (kind === "connection") {
    const topology = canonicalTopology(run);
    const connection = topology?.connections?.find((item) => item.id === canonicalId);
    if (!connection) return false;
    const atEndpoint = connection.from === obsLoc || (connection.bidirectional && connection.to === obsLoc);
    if (!atEndpoint) return false;
    if (!["visible", "institutional"].includes(connection.visibility)) return false;
    return lightingAllows(run, obsLoc);
  }

  let featureLocation = null;
  if (kind === "landmark") {
    const topology = canonicalTopology(run);
    const location = topology?.locations?.find((item) => (item.landmarks ?? []).some((lm) => lm.id === canonicalId));
    featureLocation = location?.id ?? null;
  } else if (kind === "object") {
    featureLocation = run?.object_state?.objects?.[canonicalId]?.location ?? null;
  } else if (kind === "phenomenon") {
    featureLocation = phenomenonRecord(world, canonicalId)?.location_id ?? null;
  } else if (kind === "personnel") {
    featureLocation = locationOf(run, canonicalId);
  } else {
    return false; // evidence and unknown kinds: no visibility source wired this pass
  }

  if (!featureLocation || featureLocation !== obsLoc) return false;
  return lightingAllows(run, obsLoc);
}

// ---------------------------------------------------------------------------
// salienceFor
// ---------------------------------------------------------------------------

function proximityTier(run, observerId, feature) {
  const obsLoc = locationOf(run, observerId);
  if (feature.kind === "personnel") {
    const relationship = spatialRuntime.proximity(run?.spatial ?? {}, observerId, feature.canonicalId);
    if (relationship.category === "LOCAL") return "SAME_ROOM";
    if (relationship.category === "SEPARATED") return "REMOTE";
    return "UNKNOWN";
  }
  if (feature.kind === "connection") return (feature.from === obsLoc || feature.to === obsLoc) ? "SAME_ROOM" : "REMOTE";
  return feature.location_id && feature.location_id === obsLoc ? "SAME_ROOM" : "REMOTE";
}

function salienceFor(run, world, observerId, featureId, feature) {
  let total = 0;
  total += WEIGHTS.proximity[proximityTier(run, observerId, feature)] ?? 0;
  total += WEIGHTS.prominence[feature.kind] ?? 0;

  const existing = run?.observation_state?.observers?.[observerId]?.features?.[featureId] ?? null;
  if (!existing || existing.seen_change_token !== feature.change_token) total += WEIGHTS.novelty_bonus;

  if (feature.kind === "phenomenon") {
    total += WEIGHTS.anomaly_base;
    if (feature.current_state && feature.current_state !== "DORMANT") total += WEIGHTS.anomaly_active_bonus;
  }

  const task = safeGetCoworkerTask(run, observerId);
  total += task ? WEIGHTS.task_busy_penalty : WEIGHTS.task_idle_bonus;

  const member = findMember(run, observerId);
  if (feature.recognition_requirement && member?.qualifications?.includes(feature.recognition_requirement)) total += WEIGHTS.role_relevance_bonus;

  return total;
}

// ---------------------------------------------------------------------------
// resolveNotice
// ---------------------------------------------------------------------------

function resolveNotice(run, observerId, featureId, salience, threshold, context = {}) {
  if (!Number.isFinite(salience) || !Number.isFinite(threshold)) return false;
  if (salience >= threshold) return true;
  if (salience < threshold - 1) return false;
  // Ambiguous +-1 band: resolve via a pure digest of identifying context, never Math.random / wall-clock.
  const interval = context.interval ?? run?.expedition?.clock?.interval ?? 0;
  const changeToken = context.change_token ?? "";
  const hash = digest([run?.seed ?? null, run?.run_id ?? null, observerId, featureId, changeToken, interval]);
  const normalized = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return normalized >= 0.5;
}

// ---------------------------------------------------------------------------
// recognize
// ---------------------------------------------------------------------------

function recognize(run, world, observerId, featureId, feature) {
  const requirement = feature?.recognition_requirement ?? null;
  if (!requirement) return { recognized: true, qualification: null };
  const member = findMember(run, observerId);
  const qualifications = member?.qualifications ?? [];
  if (qualifications.includes(requirement)) return { recognized: true, qualification: requirement };
  return { recognized: false, qualification: null };
}

// ---------------------------------------------------------------------------
// observe (the sole write path)
// ---------------------------------------------------------------------------

function capProvenance(entries) {
  return entries.length > PROVENANCE_CAP ? entries.slice(entries.length - PROVENANCE_CAP) : entries;
}

function observe(run, world, observerId, locationId, { interval = run?.expedition?.clock?.interval ?? 0, threshold = DEFAULT_THRESHOLD } = {}) {
  run.observation_state = migrate(run.observation_state);
  if (run.observation_state.worldpack_id == null) run.observation_state.worldpack_id = run.worldpack_id ?? run.world_id ?? null;
  const bucket = (run.observation_state.observers[observerId] ??= { features: {} });

  const features = enumerateFeatures(run, world, locationId);
  for (const feature of features) {
    if (!visibilityFor(run, world, observerId, feature.featureId)) continue;

    const salience = salienceFor(run, world, observerId, feature.featureId, feature);
    const existing = bucket.features[feature.featureId] ?? null;
    const noticed = resolveNotice(run, observerId, feature.featureId, salience, threshold, { change_token: feature.change_token, interval });

    if (!noticed) continue; // visible-but-unnoticed: no write (existing entries are left untouched)

    let state = existing && VALID_STATES.indexOf(existing.state) >= VALID_STATES.indexOf("NOTICED") ? existing.state : "NOTICED";
    let recognition = existing?.recognition ?? null;
    if (!recognition) {
      const outcome = recognize(run, world, observerId, feature.featureId, feature);
      if (outcome.recognized) { recognition = { qualification: outcome.qualification, at: interval }; state = "RECOGNIZED"; }
    }

    const provenanceEntry = { source: "direct-observation", at: interval, direct: true };
    if (existing) {
      existing.last_at = interval;
      existing.seen_change_token = feature.change_token;
      existing.state = state;
      existing.recognition = recognition;
      existing.provenance = capProvenance([...existing.provenance, provenanceEntry]);
    } else {
      bucket.features[feature.featureId] = {
        state,
        first_at: interval,
        last_at: interval,
        seen_change_token: feature.change_token,
        salience_at_notice: salience,
        recognition,
        provenance: [provenanceEntry]
      };
    }
  }
  return run.observation_state;
}

// ---------------------------------------------------------------------------
// Read projections
// ---------------------------------------------------------------------------

function stateOf(run, observerId, featureId) {
  return run?.observation_state?.observers?.[observerId]?.features?.[featureId]?.state ?? "unseen";
}

// world is an optional third argument (beyond the documented two-arg
// contract) used only to recompute current visibility for "present"; when
// omitted, present conservatively reports false rather than guessing.
function projectFor(run, observerId, world = null) {
  const bucket = run?.observation_state?.observers?.[observerId];
  if (!bucket) return [];
  return Object.keys(bucket.features).sort().map((featureId) => {
    const entry = bucket.features[featureId];
    const present = world ? visibilityFor(run, world, observerId, featureId) : false;
    return { featureId, state: entry.state, present };
  });
}

module.exports = {
  VERSION,
  create,
  migrate,
  validateCurrent,
  enumerateFeatures,
  visibilityFor,
  salienceFor,
  resolveNotice,
  recognize,
  observe,
  stateOf,
  projectFor
};
