"use strict";

// Descriptive run identity only. This module does not seed hidden branches,
// alter capabilities, or write canonical history.
const unique = (values) => [...new Set(values.filter(Boolean))];
const publicResource = (item) => item?.id ?? item;

function environment(run) {
  const state = run.procedural ?? run.state;
  if (!state) return { realization: "declared-threshold-baseline", starting_space_family: null, lighting: null, surface: null, landmark: null, visible_object_kinds: [], unknown_frontiers: 0 };
  const observer = run.session?.startup?.player?.observer_id ?? "yb-lost-player";
  const node = state.nodes?.[state.current?.[observer]];
  const local = node?.environment ?? {};
  const landmark = state.landmarks?.[node?.id];
  const objects = state.objects?.[node?.id] ?? [];
  return { realization: state.version, starting_space_family: node?.family ?? null, lighting: local.lighting?.state ?? state.region_traits?.lighting_tendency ?? null, surface: local.material?.state ?? state.region_traits?.surface_tendency ?? null, landmark: landmark?.description ?? null, visible_object_kinds: unique(objects.map((item) => item.kind)).sort(), unknown_frontiers: Object.values(state.edges ?? {}).filter((edge) => !edge.to).length };
}

function operational(run) {
  const startup = run.session?.startup ?? { knowledge: run.knowledge ?? [], resources: (run.carried ?? []).map((id) => ({ id })), permissions: run.permissions ?? [] };
  const profile = run.profile_id ?? run.profile;
  const questions = profile === "lost"
    ? ["Which nearby route is actually known?", "Can a safe return be established?"]
    : profile === "local-anomaly"
      ? ["What does the localized condition allow me to observe?", "Which explanation remains unresolved?"]
      : profile === "async-command"
        ? ["Which field account is ready for institutional review?", "Which staffing or resource constraint needs attention?"]
        : ["Which declared feature can be documented first?", "What remains unknown beyond the controlled route?"];
  return { profile, scenario: run.scenario, knowledge: unique((startup.knowledge ?? []).map((item) => item.reference ?? item)).sort(), resources: unique((startup.resources ?? []).map(publicResource)).sort(), permissions: unique((startup.permissions ?? []).map((item) => item.permission ?? item)).sort(), initial_questions: questions };
}

function describe(run) {
  const environmentView = environment(run);
  const operationalView = operational(run);
  const events = (run._world?.events ?? run.world?.events ?? []).filter((event) => !run.run_id || event.run_id === run.run_id);
  const history = { recorded_events: events.length, continuity: events.length ? "history-in-progress" : "new-start" };
  return { version: "yellow-beast-run-identity@v1", derived: true, environment: environmentView, operational: operationalView, history, provenance: "derived-from-seed-observer-safe-starting-conditions-and-run-history" };
}

function reportRuns(runs) { return runs.map((run) => ({ profile: run.profile_id, seed: run.seed, identity: describe(run) })); }
module.exports = { describe, reportRuns };
