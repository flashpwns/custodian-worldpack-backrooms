"use strict";

// Pack-original deterministic integration fixtures. They compose existing world,
// institution, civilian, and Lost systems; they are not runtime canon claims.
const history = require("./world-history");
const v2 = require("./procedural-complex-v2");
const lost = require("./lost");
const nullzone = require("./nullzone-exposure");
const desk = require("./becks-desk");
const gameplay = require("./gameplay");

function convergenceFixture() {
  const world = history.createWorld({ seed: "yb25-the-bag-the-survey-the-outpost" });
  const seedRun = history.beginRun(world, { profile: "field-researcher", scenario: "yb25-convergence", seed: "region" });
  const region = v2.materialize(v2.initialize({ seed: "yb25-convergence-region", observer: "yb-lost-player", policy: "moderate" }));
  const region_id = history.promoteRegion(world, seedRun, region); const space_id = region.current["yb-lost-player"];

  // Lost failure leaves a genuine history-backed object in the shared region.
  const lostRun = lost.start(world, "the-bag", { region_id }); world.regions[region_id].state.current["yb-lost-player"] = space_id;
  lost.strand(world, lostRun); const remnant_id = Object.values(world.artifacts).find((item) => item.origin_run === lostRun.run_id)?.id;

  // A Clear-Q4 observer reaches the same space and recovers only what is local.
  const clearRun = history.beginRun(world, { profile: "field-researcher", scenario: "yb25-bag-survey", seed: "clear" });
  const shared = world.regions[region_id].state; shared.discovery["yb-field-player"] = { spaces: [space_id], edges: [], features: [], landmarks: [], objects: [] }; shared.current["yb-field-player"] = space_id;
  const fieldLocal = v2.observe(shared, "yb-field-player", "field-researcher");
  const recovered = history.recoverArtifact(world, { run_id: clearRun, artifact_id: remnant_id, holder: "yb-field-player" });
  const recoveryCallback = gameplay.registerCallback(world, { run_id: clearRun, mode: "clear-q4", origin: { kind: "artifact", id: remnant_id }, physical_target: { kind: "artifact" }, description: "A previously abandoned bag is present at the surveyed location.", recognition: "unrecognized", region_ref: "known-survey-region", observed: true });
  const recoveryObjective = gameplay.createObjective(world, { run_id: clearRun, mode: "clear-q4", type: "record-recovered-bag", classification: "secondary", origin: { kind: "artifact", id: remnant_id }, target: "locally recovered bag", known_information: { physical_observation: true }, reward: { unlock: "route-knowledge", summary: "Recovered field context supports a follow-up survey." } });
  gameplay.resolveObjective(world, { run_id: clearRun, objective_id: recoveryObjective.objective.id, outcome: "completed", follow_up: { type: "review-recovered-bag" } });
  history.recordInstitutionalRegionSummary(world, clearRun, region_id, v2.scopedSummary(shared, "yb-field-player", "field-researcher"));

  // The report itself, not Lost's private history, is the Beck knowledge path.
  const beckRun = history.beginRun(world, { profile: "async-command", scenario: "yb25-convergence-response", seed: "beck" });
  desk.createTeam(world, beckRun, { id: "team-survey", members: ["personnel-field-1"] }); desk.allocate(world, beckRun, { team_id: "team-survey", resource: "radio" });
  const operation = desk.dispatch(world, beckRun, { id: "op-recovered-bag", team_id: "team-survey", region_id, objective: "review recovered field object" }).operation;
  desk.advance(world, beckRun); desk.applyFieldConsequence(world, beckRun, { operation_id: operation.id, summary: "A recovered local object warrants a bounded institutional review." });
  for (let index = 0; index < 4; index += 1) desk.advance(world, beckRun);
  const report = desk.state(world).reports.find((item) => item.lifecycle === "delivered" && item.facts.incident); desk.reviewReport(world, beckRun, report.id);
  const beckObjective = gameplay.createObjective(world, { run_id: beckRun, mode: "beck", type: "act-on-recovered-field-object", origin: { kind: "report", id: report.id }, target: "reviewed field report", known_information: { reviewed_report: true }, reward: { unlock: "safer-preparation", summary: "Institutional observation supports safer preparation." } });
  gameplay.resolveObjective(world, { run_id: beckRun, objective_id: beckObjective.objective.id, outcome: "completed" });

  // Beck's response creates one real v2 mutation, not a civilian-specific prop.
  desk.createTeam(world, beckRun, { id: "team-engineering", members: ["personnel-engineer-1"] });
  const candidate = desk.registerInfrastructureCandidate(world, beckRun, { region_id, space_id }); desk.approveInfrastructure(world, beckRun, { candidate_id: candidate.candidate.id, team_id: "team-engineering" }); desk.advance(world, beckRun); desk.advance(world, beckRun);
  const project = Object.values(desk.state(world).infrastructure).find((item) => item.status === "completed");

  // Nullzone sees only the installed object's local physical presentation.
  const civilianRun = history.beginRun(world, { profile: "local-anomaly", scenario: "yb25-outpost-observation", seed: "nullzone" });
  nullzone.prepare(world, civilianRun, ["field-light"], region_id); nullzone.enter(world, civilianRun); shared.current["yb-local-player"] = space_id;
  const civilianLocal = nullzone.observeRegion(world);
  const civilianCallback = gameplay.registerCallback(world, { run_id: civilianRun, mode: "nullzone", origin: { kind: "infrastructure", id: project.id }, physical_target: { kind: "object" }, description: "A fixed survey marker is visible in the local space.", recognition: "unrecognized", region_ref: "known-access-route", observed: true });
  gameplay.sessionSummary(world, { run_id: clearRun, mode: "clear-q4" }); gameplay.sessionSummary(world, { run_id: beckRun, mode: "beck" }); gameplay.sessionSummary(world, { run_id: civilianRun, mode: "nullzone" });
  return { world, region_id, space_id, lostRun, clearRun, beckRun, civilianRun, remnant_id, report_id: report.id, project_id: project.id, fieldLocal, civilianLocal, recoveryCallback, civilianCallback, recovered };
}

module.exports = { convergenceFixture };
