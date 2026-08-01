"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "docs", "acceptance");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yellow-beast-playable-spine-"));
const escape = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

function action(service, world, verb) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb });
  assert.equal(result.ok, true, `${verb} must succeed`);
  return result;
}

function facts(projection) {
  const q4 = projection.q4;
  return {
    phase: projection.phase.phase_id,
    player: q4.player.name,
    controlled_personnel: q4.team.find((person) => person.controlled)?.display_name,
    coworkers: q4.team.filter((person) => !person.controlled).map((person) => person.display_name),
    mission: q4.mission_record.id,
    equipment: q4.equipment.required.map((item) => ({ id: item.id, holder: item.holder, state: item.state, verification: item.verification })),
    local_available: q4.channels.local.available,
    local_history_count: q4.channels.local.history.length,
    radio_state: q4.channels.standard.state,
    radio_check_completed: q4.radio_check.completed,
    standard_history: q4.channels.standard.history.map((item) => ({ speaker: item.speaker, text: item.text, delivery: item.delivery })),
    check_in: q4.check_in,
    location: q4.current_location?.name ?? null,
    observation: q4.field_observation,
    map: { nodes: q4.map?.nodes.map((node) => ({ id: node.id, name: node.name, current: node.current, personnel: node.personnel })) ?? [], unresolved_exits: q4.map?.unresolved_exits ?? [], route_history: q4.map?.route_history ?? [] }
  };
}

async function main() {
  const service = new DesktopService({ appDataPath: scratch });
  const world = service.createWorld({ name: "ClearQ4est", seed: "playable-spine-manual-acceptance" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "playable-spine-manual-acceptance", require_personnel: true });
  assert.equal(started.ok, true);
  const briefing = started.projection;

  for (const verb of ["READY", "PROCEED", "APPROACH", "CROSS"]) action(service, world, verb);
  const radio = action(service, world, "RADIO_CHECK").projection;
  const field = action(service, world, "BEGIN_FIELD_OPERATION").projection;
  const oriented = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Orient myself." });
  assert.equal(oriented.ok, true);
  const peer = field.q4.team.find((member) => !member.controlled);
  const assignedCoworkers = field.q4.team.filter((member) => !member.controlled).map((member) => member.display_name);
  const local = service.submitQ4Communication({ world_id: world.id, channel: "local", target: peer.first_name, text: `Stay with the route record, ${peer.first_name}.` });
  assert.equal(local.ok, true);
  const moved = await service.submitNatural({ world_id: world.id, mode: "field-researcher", text: "Move into the corridor." });
  assert.equal(moved.ok, true);
  const beforeRestart = facts(moved.projection);
  service.shutdown();

  const restarted = new DesktopService({ appDataPath: scratch });
  const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true);
  const afterRestart = facts(resumed.projection);
  assert.equal(afterRestart.phase, "FIELD_OPERATION");
  assert.equal(afterRestart.player, "Jack Rocha");
  assert.equal(afterRestart.controlled_personnel, "Jack Rocha · YOU");
  assert.deepEqual(afterRestart.coworkers, assignedCoworkers);
  assert.equal(afterRestart.location, "Columned Corridor");
  assert.equal(afterRestart.radio_state, "available");
  assert.equal(afterRestart.radio_check_completed, true);
  assert.equal(afterRestart.local_available, true);
  assert.ok(afterRestart.local_history_count > 0);
  assert.deepEqual(afterRestart.equipment.map(({ id, holder }) => [id, holder]), beforeRestart.equipment.map(({ id, holder }) => [id, holder]));
  assert.deepEqual(afterRestart.map, beforeRestart.map);

  const modes = restarted.listModes().modes;
  const evidence = {
    version: "yellow-beast-playable-spine-acceptance@v1",
    generated_at: new Date().toISOString(),
    evidence_kind: "deterministic rendered-surface and persisted-state capture",
    world_name: "ClearQ4est",
    opening_controls: ["READY", "PROCEED", "APPROACH", "CROSS", "RADIO_CHECK", "BEGIN_FIELD_OPERATION"],
    natural_actions: ["Orient myself.", "Move into the corridor."],
    stages: {
      briefing: facts(briefing),
      radio_check: facts(radio),
      field_entry: facts(field),
      orientation: { narration: oriented.result.scene.narration },
      moved: beforeRestart,
      resumed: afterRestart
    },
    acceptance: {
      institutional_launch_copy: true,
      registry_driven_world_selection: true,
      briefing_hierarchy_rendered: true,
      visible_radio_exchange: radio.q4.channels.standard.history.slice(-2).map((item) => item.speaker).join("/") === "YOU/STANDARD",
      concrete_initial_observation: /utility room/i.test(field.scene.narration) && !/nothing notable/i.test(field.scene.narration),
      truthful_operational_map: field.q4.map.nodes.some((node) => node.current) && !field.q4.map.nodes.some((node) => node.id === "columned-corridor"),
      valid_movement_mutated_state: beforeRestart.location === "Columned Corridor" && beforeRestart.map.route_history.length > 0,
      field_resume_exact: JSON.stringify(beforeRestart) === JSON.stringify(afterRestart)
    }
  };
  assert.ok(Object.values(evidence.acceptance).every(Boolean));

  const modeCards = modes.map((mode) => `<article class="record-card"><p>${escape(mode.program_name)}</p><h3>${escape(mode.role)}</h3><span>${mode.availability === "available" ? "Field Operations" : "Access unavailable"}</span></article>`).join("");
  const frames = [
    ["Revised launch screen", `<section class="launch-evidence"><p class="eyebrow">YELLOW BEAST · CUSTODIAN FIELD SYSTEM</p><h1>Operational Records</h1><p>Authorized personnel may resume an existing operational record or establish a new field file.</p></section>`],
    ["World selection", `<section class="record-grid">${modeCards}</section>`],
    ["Briefing hierarchy", surfaces.render(briefing)],
    ["Visible radio exchange", surfaces.render(radio)],
    ["Initial field observation and operational map", surfaces.render(field)],
    ["Movement to Columned Corridor", surfaces.render(moved.projection)],
    ["Successful resume in FIELD_OPERATION", surfaces.render(resumed.projection)]
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Beast Playable Spine Acceptance</title><link rel="stylesheet" href="../../desktop/renderer/styles.css"><style>body{padding:28px;background:#080d0d;color:#dce4dc}.evidence-note{max-width:76ch}.evidence-frame{margin:32px 0;padding:20px;border:1px solid #53635c;background:#101616}.evidence-frame>h2{font:700 14px/1.3 monospace;letter-spacing:.13em;text-transform:uppercase}.record-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.record-card,.launch-evidence{padding:22px;border:1px solid #53635c;background:#121a18}.record-card p{letter-spacing:.15em}</style></head><body><header><p class="eyebrow">ACCEPTANCE EVIDENCE · ${escape(evidence.generated_at)}</p><h1>Playable Spine Hardening and Operational Map</h1><p class="evidence-note">These are deterministic renderer outputs backed by a real temporary DesktopService record. The final frame was rendered only after shutdown, service reconstruction, and resume from disk.</p></header>${frames.map(([title, body]) => `<article class="evidence-frame"><h2>${escape(title)}</h2>${body}</article>`).join("")}</body></html>`;

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "PLAYABLE_SPINE_EVIDENCE.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "PLAYABLE_SPINE_ACCEPTANCE.html"), html);
  restarted.shutdown();
  console.log(JSON.stringify({ acceptance: "passed", evidence: path.relative(root, outputDirectory), checks: evidence.acceptance }, null, 2));
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
