"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const authoring = require("./worldpack-authoring");
const missionRuntime = require("./mission-runtime");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "acceptance");
const artifactDirectory = path.join(outputDirectory, "artifacts");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-omnipass-"));
const escape = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const missionDefinition = read("data/worldpacks/clear-q4/mission.json");

function action(service, world, verb, targetValue = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target: targetValue });
  assert.equal(result.ok, true, `${verb} ${targetValue ?? ""} must succeed: ${result.error?.message ?? result.error?.code ?? "unknown failure"}`);
  return result;
}

function target(projection, verb, label = "") {
  const record = projection.available_actions.find((entry) => entry.type === verb);
  const selected = record?.targets?.find((entry) => String(entry.label).toLowerCase().includes(label.toLowerCase()));
  assert.ok(selected, `${verb} target containing '${label}' must be available`);
  if (verb === "MOVE" && label) return label;
  return selected.ref;
}

function logistics(service, world, actionName, itemId = null, extra = {}) {
  const result = service.submitQ4Logistics({ world_id: world.id, action: actionName, item_id: itemId, ...extra });
  assert.equal(result.ok, true, `${actionName} ${itemId ?? extra.container_id ?? ""} must succeed: ${result.error?.message ?? result.error?.code ?? "unknown failure"}`);
  return result;
}

function safeFacts(projection) {
  const q4 = projection.q4;
  return {
    phase: projection.phase.phase_id,
    interval: q4.operational_clock.interval,
    location: q4.current_location?.name ?? null,
    mission: { lifecycle: q4.mission_progress.lifecycle, required: q4.mission_progress.required_objectives.map(({ name, state, summary }) => ({ name, state, summary })), optional: q4.mission_progress.optional_objectives.map(({ name, state, summary }) => ({ name, state, summary })), return_readiness: q4.mission_progress.return_readiness, result: q4.mission_progress.result },
    team: q4.team.map(({ display_name, role, contact_state, current_or_last_known_location, condition, current_task, assigned_equipment }) => ({ display_name, role, contact_state, current_or_last_known_location, condition, current_task, assigned_equipment })),
    inventory: { items: q4.inventory.items.map(({ label, condition, holder, container, location, equipped, charges, quantity, accessibility, loadout_status }) => ({ label, condition, holder, container, location, equipped, charges, quantity, accessibility, loadout_status })), containers: q4.inventory.containers.map(({ name, holder, location, open, lost, contents, used, capacity }) => ({ name, holder, location, open, lost, contents, used, capacity })), loadout: q4.inventory.loadout },
    communications: q4.communications,
    hazards: q4.hazards,
    evidence: q4.evidence,
    institution: q4.institution,
    review: q4.review
  };
}

function canonicalFacts(entry, world) {
  const run = entry.run; return structuredClone({
    clock: run.expedition.clock,
    scheduled_events: run.expedition.operational.events,
    event_history: run.expedition.operational.event_history,
    messages: run.expedition.messages,
    check_ins: run.expedition.communications.check_ins,
    team: run.expedition.team,
    team_runtime: run.expedition.team_runtime,
    logistics: run.expedition.logistics,
    hazards: run.expedition.hazards,
    consequences: run.expedition.operational.consequences,
    object_state: run.object_state,
    evidence: run.expedition.evidence,
    spatial: run.spatial,
    mission_state: run.expedition.mission_state,
    result: run.expedition.result,
    institution: world.institutional_response,
    continuity: world.q4_operations
  });
}

function outcomeProbes() {
  const objectives = Object.fromEntries(missionDefinition.mission.objectives.map((item) => [item.id, "satisfied"]));
  const contextFor = (family) => {
    const members = [{ personnel_id: "operator", status: "active", condition: "normal" }, { personnel_id: "specialist", status: family === "personnel-loss" ? "dead" : "active", condition: family === "degraded-completion" ? "minor injury" : "normal" }];
    const equipment = { issued: { assigned_to: "specialist", holder: family === "degraded-completion" ? null : "specialist", state: family === "degraded-completion" ? "lost" : "operational" } };
    const evidence = [{ id: "record", custodian: "operator", custody_state: "retained", available_to_player: true }];
    const consequences = family === "recovered-complication" ? [{ classification: "temporary-complication", recovery: { at: 4 } }] : [];
    return { run: { session: { startup: { player: { observer_id: "operator" } } }, spatial: { player_location: "return", personnel_locations: { operator: "return", specialist: "return" } }, expedition: { team: { members }, equipment, evidence, communications: { check_ins: [{ state: "completed", history: family === "recovered-complication" ? [{ to: "missed" }, { to: "completed" }] : [] }] }, operational: { consequences }, clock: { interval: 12 } } }, mission_state: { lifecycle: "completed", return: { abort_requested: family === "controlled-abort", requested: true, route_available: true } } };
  };
  const scenarios = {
    "clean-completion": { optional: "abandoned" },
    "enhanced-completion": { optional: "satisfied" },
    "recovered-complication": { optional: "abandoned" },
    "degraded-completion": { optional: "abandoned", failed: "capture-field-evidence" },
    "controlled-abort": { optional: "abandoned" },
    "mission-failure": { optional: "abandoned", failed: "return-accountability" },
    "personnel-loss": { optional: "abandoned" }
  };
  return Object.entries(scenarios).map(([expected, setup]) => {
    const snapshot = { ...objectives, "additional-condition-record": setup.optional }; if (setup.failed) snapshot[setup.failed] = "failed";
    const context = contextFor(expected); const ordered = [...missionDefinition.mission.outcome_rules].sort((a, b) => b.priority - a.priority); const matched = ordered.find((rule) => missionRuntime.evaluateCondition(rule.when, context, snapshot));
    assert.equal(matched.classification, expected, `deterministic outcome probe must select ${expected}`);
    return { expected, selected_rule: matched.id, classification: matched.classification, objective_snapshot: snapshot, facts: { abort_requested: context.mission_state.return.abort_requested, personnel: context.run.expedition.team.members.map(({ status, condition }) => ({ status, condition })), equipment: context.run.expedition.equipment.issued.state, recovered_consequence: context.run.expedition.operational.consequences.some((item) => item.recovery) } };
  });
}

function authoringEvidence() {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const validation = authoring.validate("clear-q4"); assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const preview = authoring.writePreview("clear-q4", path.join(artifactDirectory, "OMNIPASS_CLEAR_Q4_PREVIEW.html")); assert.equal(preview.valid, true);
  const trace = authoring.trace("clear-q4", "omnipass-authoring-trace", path.join(artifactDirectory, "OMNIPASS_CLEAR_Q4_TRACE.json")); assert.equal(trace.version, "yellow-beast-worldpack-trace@v1");
  const fixtureTrace = authoring.trace("authoring-fixture", "omnipass-fixture-trace", path.join(artifactDirectory, "OMNIPASS_FIXTURE_TRACE.json")); assert.equal(fixtureTrace.version, "yellow-beast-worldpack-trace@v1");
  assert.equal(authoring.test("authoring-fixture", "omnipass-fixture-trace").passed, true);
  const brokenDirectory = path.join(scratch, "broken-pack"); assert.equal(authoring.create(brokenDirectory, "broken-pack").valid, true); const file = path.join(brokenDirectory, "spatial.json"); const spatial = JSON.parse(fs.readFileSync(file, "utf8")); spatial.connections = []; fs.writeFileSync(file, `${JSON.stringify(spatial, null, 2)}\n`); const broken = authoring.validate(brokenDirectory); assert.equal(broken.valid, false); fs.writeFileSync(path.join(artifactDirectory, "OMNIPASS_BROKEN_PACK_VALIDATION.json"), `${JSON.stringify(broken, null, 2)}\n`);
  return { validation, preview: path.relative(root, preview.output), trace: path.relative(root, path.join(artifactDirectory, "OMNIPASS_CLEAR_Q4_TRACE.json")), fixture_trace: path.relative(root, path.join(artifactDirectory, "OMNIPASS_FIXTURE_TRACE.json")), broken_pack_rejected: broken.errors.map(({ code, path: errorPath }) => ({ code, path: errorPath })) };
}

async function main() {
  const service = new DesktopService({ appDataPath: scratch, developerMode: true, logger() {} });
  const world = service.createWorld({ name: "Clear-Q4 Omnipass", seed: "omnipass-world" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Taylor", last_name: "Morgan" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "omnipass-primary", require_personnel: true }); assert.equal(started.ok, true);
  const briefing = started.projection; const roster = briefing.q4.team.map((item) => item.display_name);
  assert.ok(roster.length >= 3 && roster.length <= 5);

  let projection = action(service, world, "READY").projection; const staging = projection;
  logistics(service, world, "STORE", "field-light", { target_container: "field-case" });
  const stored = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  for (const itemId of ["route-marker-kit", "evidence-sleeves", "field-notebook"]) { const selected = service.selectQ4OptionalStore({ world_id: world.id, item_id: itemId }); assert.equal(selected.ok, true, `${itemId}: ${selected.error?.message ?? selected.error?.code ?? "selection failed"}`); }
  const coworker = service.session(world.id, "field-researcher").run.expedition.team.members.slice(1)[0].personnel_id;
  logistics(service, world, "EQUIP", "evidence-sleeves");
  logistics(service, world, "CONSUME", "evidence-sleeves");
  logistics(service, world, "HAND_OVER", "field-notebook", { target_holder: coworker });
  projection = logistics(service, world, "RETRIEVE", "field-light").projection; const loadoutConfigured = projection;

  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"]) projection = action(service, world, verb).projection;
  for (const [verb, object] of [["INSPECT", "fluorescent fixture"], ["TEST", "fluorescent fixture"], ["INSPECT", "scuffed floor"], ["PHOTOGRAPH", "scuffed floor"], ["MARK", "scuffed floor"], ["INSPECT", "service panel"]]) projection = action(service, world, verb, object).projection;
  const initialEvidence = projection;

  const acceptedOrder = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", "Columned Corridor")); projection = acceptedOrder.projection; assert.equal(acceptedOrder.result.outcome, "accepted"); const separated = projection; assert.ok(projection.q4.team.some((item) => item.contact_state === "CONTACT LOST"));
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Columned Corridor")).projection; const structuralHazard = projection; const injured = projection.q4.team.find((item) => /injur/i.test(item.condition)); assert.ok(injured);
  const delayedOrder = action(service, world, "ORDER_INVESTIGATE", target(projection, "ORDER_INVESTIGATE", injured.display_name.split(" ")[0])); assert.equal(delayedOrder.result.outcome, "delayed"); projection = delayedOrder.projection;
  projection = action(service, world, "ASSIST", target(projection, "ASSIST", injured.display_name.split(" ")[0])).projection;
  const recoverTarget = target(projection, "RECOVER"); projection = action(service, world, "RECOVER", recoverTarget).projection;
  projection = action(service, world, "MITIGATE", target(projection, "MITIGATE", "structural")).projection;
  projection = action(service, world, "ORDER_FOLLOW", target(projection, "ORDER_FOLLOW", injured.display_name.split(" ")[0])).projection; const recoveredStructural = projection;

  const shadowReport = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Scheduled status report: fixture and scuff evidence retained; teammate injury stabilized and dropped equipment recovered." }); assert.equal(shadowReport.ok, true); assert.equal(shadowReport.result.outcome, "delayed"); const delayedReport = shadowReport.projection; projection = delayedReport;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Utility Room")).projection;
  let guard = 0; while (projection.q4.communications.check_ins[0].state !== "completed" && guard < 24) { projection = action(service, world, "WAIT").projection; guard += 1; } assert.ok(guard < 24);
  const deviation = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Request authorization for a bounded relay deviation supported by the recorded fixture evidence." }); assert.equal(deviation.ok, true, deviation.error?.message ?? deviation.error?.code); projection = deviation.projection;
  projection = action(service, world, "WAIT").projection; projection = action(service, world, "WAIT").projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Columned Corridor")).projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Relay Alcove")).projection; const electricalHazard = projection; assert.ok(projection.q4.hazards.some((item) => item.category === "electrical"));
  projection = action(service, world, "INSPECT", "relay service unit").projection;
  projection = logistics(service, world, "OPEN_CONTAINER", null, { container_id: "relay-cache" }).projection;
  projection = logistics(service, world, "RETRIEVE", "spare-battery").projection;
  projection = action(service, world, "REPAIR", "relay service unit").projection; const relayRecovered = projection;
  assert.equal(service.session(world.id, "field-researcher").run.spatial.blocked_paths["corridor-to-relay"], undefined);

  projection = action(service, world, "MOVE", target(projection, "MOVE", "Service Bypass")).projection;
  projection = action(service, world, "MOVE", "Records Annex").projection;
  projection = action(service, world, "INSPECT", "record fragment").projection;
  projection = action(service, world, "RECORD", "record fragment").projection;
  projection = action(service, world, "TAKE", "record fragment").projection; const containedEvidence = projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Service Bypass")).projection;
  projection = action(service, world, "INSPECT", "bypass guide line").projection;
  projection = action(service, world, "MARK", "bypass guide line").projection;
  projection = action(service, world, "MOVE", target(projection, "MOVE", "Threshold-Side Entry")).projection; const alternateReturn = projection;
  projection = action(service, world, "INSPECT", "return marker").projection;
  projection = action(service, world, "SECURE", "return marker").projection; const returnReady = projection; assert.equal(projection.q4.mission_progress.return_readiness.ready, true);
  projection = action(service, world, "RETURN").projection; const returning = projection;
  projection = action(service, world, "COMPLETE_RETURN").projection; const debrief = projection; assert.equal(projection.phase.phase_id, "DEBRIEF");
  assert.ok(projection.q4.institution.follow_up_assignments.length >= 1);

  const beforeRestartSafe = safeFacts(debrief); const beforeRestartCanonical = canonicalFacts(service.session(world.id, "field-researcher"), service.getWorld(world.id));
  service.shutdown(); const restarted = new DesktopService({ appDataPath: scratch, developerMode: true, logger() {} }); const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" }); assert.equal(resumed.ok, true);
  const afterRestartSafe = safeFacts(resumed.projection); const afterRestartCanonical = canonicalFacts(restarted.session(world.id, "field-researcher"), restarted.getWorld(world.id)); assert.deepEqual(afterRestartSafe, beforeRestartSafe); assert.deepEqual(afterRestartCanonical, beforeRestartCanonical);
  const developerBundle = restarted.getDeveloperSnapshot({ world_id: world.id, mode: "field-researcher" }); assert.equal(developerBundle.ok, true); assert.equal(developerBundle.active.simulation_truth.developer_only, true);

  const secondWorld = restarted.createWorld({ name: "Clear-Q4 Second Seed", seed: "omnipass-second-world" }).world; assert.equal(restarted.createQ4Personnel({ world_id: secondWorld.id, first_name: "Jordan", last_name: "Lee" }).ok, true); assert.equal(restarted.confirmQ4Personnel({ world_id: secondWorld.id }).ok, true); const second = restarted.startSession({ world_id: secondWorld.id, mode: "field-researcher", seed: "omnipass-secondary", require_personnel: true }); assert.equal(second.ok, true); const secondRoster = second.projection.q4.team.map((item) => item.display_name); assert.notDeepEqual(secondRoster.slice(1), roster.slice(1));

  const outcomes = outcomeProbes(); const authored = authoringEvidence();
  const checks = {
    generated_team_and_institutional_briefing: roster.length >= 3 && roster.length <= 5 && Boolean(briefing.q4.institution),
    authoritative_loadout_store_retrieve_transfer_consume: stored.q4.inventory.items.some((item) => item.label === "Battery field lamp" && item.container === "Field equipment case") && loadoutConfigured.q4.inventory.items.some((item) => item.label === "Field notebook" && item.holder !== roster[0]) && loadoutConfigured.q4.inventory.items.some((item) => item.label === "Sealable evidence sleeves" && item.equipped && item.charges === 3),
    evidence_and_container_custody: containedEvidence.q4.evidence.some((item) => item.storage === "evidence-case"),
    delayed_report_and_delayed_standard_response: delayedReport.q4.communications.messages.some((item) => item.state === "delayed") && beforeRestartCanonical.institution.decisions.some((item) => ["authorize-deviation", "deny-deviation"].includes(item.decision)),
    accepted_and_delayed_order: acceptedOrder.result.outcome === "accepted" && delayedOrder.result.outcome === "delayed",
    separation_uses_last_known_projection: separated.q4.team.some((item) => item.contact_state === "CONTACT LOST"),
    two_distinct_hazard_families: structuralHazard.q4.hazards.some((item) => item.category === "structural") && electricalHazard.q4.hazards.some((item) => item.category === "electrical"),
    recoverable_consequences_and_partial_relay_recovery: beforeRestartCanonical.consequences.some((item) => item.recovery) && relayRecovered.q4.hazards.some((item) => item.category === "electrical" && item.state === "mitigated") && beforeRestartCanonical.logistics.items["survey-instrument"].condition === "disabled",
    alternate_route_used: beforeRestartCanonical.spatial.route_history.some((item) => item.connection_id === "bypass-to-entry"),
    return_and_debrief_are_state_derived: returning.phase.phase_id === "RETURN" && debrief.q4.review?.outcome === debrief.q4.mission_progress.result?.classification,
    reconciliation_and_follow_up: beforeRestartCanonical.logistics.reconciliation_history.length > 0 && debrief.q4.institution.follow_up_assignments.length > 0,
    exact_shutdown_restart: JSON.stringify(beforeRestartSafe) === JSON.stringify(afterRestartSafe) && JSON.stringify(beforeRestartCanonical) === JSON.stringify(afterRestartCanonical),
    second_seed_differs_deterministically: JSON.stringify(secondRoster.slice(1)) !== JSON.stringify(roster.slice(1)),
    every_outcome_family_deterministically_selected: outcomes.length === 7 && outcomes.every((item) => item.expected === item.classification),
    authoring_workflow_proved: authored.validation.valid && authored.broken_pack_rejected.length > 0
  };
  assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));

  const record = { version: "yellow-beast-omnipass-7-9-acceptance@v1", generated_at: new Date().toISOString(), evidence_kind: "deterministic renderer-backed, authoring-backed, and persisted authoritative-state capture", seed: "omnipass-primary", roster, second_seed: "omnipass-secondary", second_roster: secondRoster, stages: { briefing: safeFacts(briefing), staging_inventory: safeFacts(staging), loadout_configured: safeFacts(loadoutConfigured), initial_evidence: safeFacts(initialEvidence), accepted_order_and_separation: safeFacts(separated), structural_hazard: safeFacts(structuralHazard), recovered_structural_complication: safeFacts(recoveredStructural), delayed_report: safeFacts(delayedReport), electrical_hazard: safeFacts(electricalHazard), relay_recovery: safeFacts(relayRecovered), contained_secondary_evidence: safeFacts(containedEvidence), alternate_return: safeFacts(alternateReturn), return_readiness: safeFacts(returnReady), derived_debrief: beforeRestartSafe, post_restart_record: afterRestartSafe }, outcome_probes: outcomes, authoring: authored, checks };
  const frames = [["Institutional briefing and generated personnel", briefing], ["Staging inventory", staging], ["Configured loadout and custody", loadoutConfigured], ["Accepted order and last-known status", separated], ["Structural hazard", structuralHazard], ["Recoverable consequence", recoveredStructural], ["Delayed radio report", delayedReport], ["Electrical hazard", electricalHazard], ["Relay recovery with persistent equipment degradation", relayRecovered], ["Contained secondary evidence", containedEvidence], ["Alternate return route", alternateReturn], ["Return readiness", returnReady], ["Condition-derived debrief and institutional follow-up", debrief], ["Successful post-restart operation record", resumed.projection]];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Beast Omnipass 7-9 Acceptance</title><link rel="stylesheet" href="../../desktop/renderer/styles.css"><style>body{padding:28px;background:#080d0d;color:#dce4dc}.evidence-note{max-width:84ch}.evidence-frame{margin:32px 0;padding:20px;border:1px solid #53635c;background:#101616}.evidence-frame>h2{font:700 14px/1.3 monospace;letter-spacing:.13em;text-transform:uppercase}</style></head><body><header><p class="eyebrow">ACCEPTANCE EVIDENCE - ${escape(record.generated_at)}</p><h1>Institutional Response, Field Logistics, Authoring, and Complete Clear-Q4</h1><p class="evidence-note">Every gameplay frame is generated from the observer-safe desktop projection after deterministic resolution. Developer truth is stored only in the separate machine-readable diagnostic artifact. The final frame follows full shutdown and disk-backed resume.</p></header>${frames.map(([title, projectionValue]) => `<article class="evidence-frame"><h2>${escape(title)}</h2>${surfaces.render(projectionValue)}</article>`).join("")}</body></html>`;
  fs.mkdirSync(outputDirectory, { recursive: true }); fs.writeFileSync(path.join(outputDirectory, "OMNIPASS_7_9_EVIDENCE.json"), `${JSON.stringify(record, null, 2)}\n`); fs.writeFileSync(path.join(outputDirectory, "OMNIPASS_7_9_ACCEPTANCE.html"), html); fs.writeFileSync(path.join(artifactDirectory, "OMNIPASS_DEVELOPER_DIAGNOSTIC.json"), `${JSON.stringify(developerBundle, null, 2)}\n`);
  restarted.shutdown(); console.log(JSON.stringify({ acceptance: "passed", evidence: path.relative(root, outputDirectory), checks }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
