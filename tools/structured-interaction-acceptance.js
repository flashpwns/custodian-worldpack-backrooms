"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "acceptance");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-structured-interaction-"));
const escape = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb} ${target ?? ""} must succeed: ${result.error?.message ?? "unknown failure"}`);
  return result;
}

function renderedResult(result) {
  return surfaces.render({ ...result.projection, scene: result.result?.scene ?? result.projection.scene });
}

function safeFacts(projection) {
  const q4 = projection.q4;
  return {
    phase: projection.phase.phase_id,
    location: q4.current_location?.name ?? null,
    observation: q4.field_observation,
    interactables: q4.interactables.map((object) => ({ name: object.name, condition: object.condition, known_properties: object.known_properties, actions: object.actions.map((item) => ({ action: item.action, label: item.label, available: item.available })) })),
    objectives: q4.objectives.map((objective) => ({ label: objective.label, state: objective.state, required: objective.required })),
    evidence: q4.evidence.map((item) => ({ id: item.id, type: item.type, source: item.source, condition: item.condition, observer: item.observer, device: item.device, location: item.location, time: item.time, reporting_state: item.reporting_state })),
    equipment: q4.equipment.required.map((item) => ({ label: item.label, holder: item.holder, state: item.state, verification: item.verification, remaining: item.consumable?.remaining })),
    operational_time: q4.operational_time,
    check_in: q4.check_in,
    team: q4.team.map((member) => ({ name: member.display_name, location: member.location, contact: member.contact_category })),
    local_available: q4.channels.local.available,
    radio: { state: q4.channels.standard.state, check_completed: q4.radio_check.completed, history_count: q4.channels.standard.history.length },
    map: { current_location: q4.map.current_location, nodes: q4.map.nodes.map((node) => ({ name: node.name, current: node.current, personnel: node.personnel })), route_history: q4.map.route_history }
  };
}

function canonicalFacts(entry) {
  return {
    object_state: structuredClone(entry.run.object_state),
    evidence: structuredClone(entry.run.expedition.evidence),
    objectives: structuredClone(entry.run.expedition.objectives),
    equipment: structuredClone(entry.run.expedition.equipment),
    spatial: structuredClone(entry.run.spatial),
    clock: structuredClone(entry.run.expedition.clock),
    radio: structuredClone(entry.run.expedition.radio),
    team: structuredClone(entry.run.expedition.team)
  };
}

async function main() {
  const service = new DesktopService({ appDataPath: scratch });
  const world = service.createWorld({ name: "ClearQ4Interact", seed: "structured-interaction-manual-acceptance" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed: "structured-interaction-manual-acceptance", require_personnel: true }).ok, true);
  action(service, world, "READY");
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  for (const verb of ["PROCEED", "APPROACH", "CROSS", "RADIO_CHECK"]) action(service, world, verb);
  const fieldEntry = action(service, world, "BEGIN_FIELD_OPERATION");

  const inspectedFixture = action(service, world, "INSPECT", "fluorescent fixture");
  const testedFixture = action(service, world, "TEST", "fluorescent fixture");
  action(service, world, "INSPECT", "scuffed floor");
  const markedFloor = action(service, world, "MARK", "scuffed floor");
  action(service, world, "INSPECT", "service panel");
  const openedPanel = action(service, world, "OPEN", "service panel");
  const movedAway = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move into the corridor." });
  assert.equal(movedAway.ok, true);
  const returned = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Return east to the utility room." });
  assert.equal(returned.ok, true);

  const entry = service.session(world.id, "field-researcher");
  const beforeRestartSafe = safeFacts(returned.projection);
  const beforeRestartCanonical = canonicalFacts(entry);
  service.shutdown();

  const restarted = new DesktopService({ appDataPath: scratch });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const afterRestartSafe = safeFacts(resumed.projection);
  const afterRestartCanonical = canonicalFacts(restarted.session(world.id, "field-researcher"));

  const fixtureState = beforeRestartCanonical.object_state.objects["utility-fluorescent-fixture"];
  const floorState = beforeRestartCanonical.object_state.objects["utility-route-surface"];
  const panelState = beforeRestartCanonical.object_state.objects["utility-service-panel"];
  const instrument = beforeRestartCanonical.equipment["survey-instrument"];
  const evidence = beforeRestartCanonical.evidence[0];
  const acceptance = {
    three_utility_interactables_visible: fieldEntry.projection.q4.interactables.length >= 3,
    inspection_reveals_condition_specific_information: inspectedFixture.projection.q4.interactables.find((object) => object.name === "fluorescent fixture")?.known_properties.some((text) => /stable/i.test(text)) === true,
    contextual_tool_action_available: inspectedFixture.projection.q4.interactables.find((object) => object.name === "fluorescent fixture")?.actions.some((item) => item.action === "TEST" && item.available) === true,
    equipment_dependent_mutation: fixtureState.custom.tested === true && instrument.holder !== entry.run.session.startup.player.observer_id && instrument.used === 1,
    valid_evidence_created: Boolean(evidence?.source_object === "utility-fluorescent-fixture" && evidence.source_location === "utility-room" && evidence.device_id === instrument.id && evidence.valid),
    objective_from_world_condition: beforeRestartCanonical.objectives["capture-field-evidence"].state === "satisfied" && beforeRestartCanonical.objectives["capture-field-evidence"].history.some((item) => item.source === "authoritative-condition-evaluation"),
    three_distinct_mutations: fixtureState.custom.survey_tagged === true && floorState.marked === true && panelState.open === true,
    return_observation_reflects_changes: /tagged in the survey record/i.test(returned.projection.q4.field_observation) && /route marker you placed/i.test(returned.projection.q4.field_observation) && /panel stands open/i.test(returned.projection.q4.field_observation),
    full_restart_exact: JSON.stringify(beforeRestartCanonical) === JSON.stringify(afterRestartCanonical),
    observer_safe_restart_projection: JSON.stringify(beforeRestartSafe) === JSON.stringify(afterRestartSafe)
  };
  assert.ok(Object.values(acceptance).every(Boolean));

  const stages = {
    initial_object_observation: safeFacts(fieldEntry.projection),
    inspection_result: safeFacts(inspectedFixture.projection),
    successful_state_mutation: safeFacts(testedFixture.projection),
    route_marker_placed: safeFacts(markedFloor.projection),
    panel_opened: safeFacts(openedPanel.projection),
    moved_away: safeFacts(movedAway.projection),
    returned_to_changed_room: beforeRestartSafe,
    post_restart_resume: afterRestartSafe
  };
  const record = {
    version: "yellow-beast-structured-interaction-acceptance@v1",
    generated_at: new Date().toISOString(),
    evidence_kind: "deterministic rendered-surface and persisted-state capture",
    actions: ["INSPECT fluorescent fixture", "TEST fluorescent fixture", "INSPECT scuffed floor", "MARK scuffed floor", "INSPECT service panel", "OPEN service panel", "MOVE west", "MOVE east", "shutdown", "resume"],
    stages,
    acceptance
  };

  const frames = [
    ["Initial object observation", surfaces.render(fieldEntry.projection)],
    ["Condition-specific inspection", renderedResult(inspectedFixture)],
    ["Available equipment-dependent interaction", surfaces.render(inspectedFixture.projection)],
    ["Successful fixture mutation", renderedResult(testedFixture)],
    ["Evidence creation and objective update", surfaces.render(testedFixture.projection)],
    ["Additional persistent object mutations", `${renderedResult(markedFloor)}${renderedResult(openedPanel)}`],
    ["Object state after leaving and returning", surfaces.render(returned.projection)],
    ["Successful post-restart resume", surfaces.render(resumed.projection)]
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Beast Structured Interaction Acceptance</title><link rel="stylesheet" href="../../desktop/renderer/styles.css"><style>body{padding:28px;background:#080d0d;color:#dce4dc}.evidence-note{max-width:78ch}.evidence-frame{margin:32px 0;padding:20px;border:1px solid #53635c;background:#101616}.evidence-frame>h2{font:700 14px/1.3 monospace;letter-spacing:.13em;text-transform:uppercase}</style></head><body><header><p class="eyebrow">ACCEPTANCE EVIDENCE · ${escape(record.generated_at)}</p><h1>Structured Observation and Interaction</h1><p class="evidence-note">Every frame is rendered from the same observer-safe projection used by the desktop application. The final frame was produced only after service shutdown, reconstruction, and resume from the persisted session.</p></header>${frames.map(([title, body]) => `<article class="evidence-frame"><h2>${escape(title)}</h2>${body}</article>`).join("")}</body></html>`;

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "STRUCTURED_INTERACTION_EVIDENCE.json"), `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "STRUCTURED_INTERACTION_ACCEPTANCE.html"), html);
  restarted.shutdown();
  console.log(JSON.stringify({ acceptance: "passed", evidence: path.relative(root, outputDirectory), checks: acceptance }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
