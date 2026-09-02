"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const qol = require("../desktop/renderer/qol");

const RENDERER = fs.readFileSync(path.join(__dirname, "..", "desktop", "renderer", "renderer.js"), "utf8");
const FORBIDDEN_PLAYER_DATA = /(?:world|region|run|history|actor|object|phenomenon|thread)-[a-f0-9]{8,}/i;
const PHRASES = {
  "field-researcher": "I listen for changes in the passage.",
  lost: "I keep watch over the door.",
  "async-command": "I review the reports on my desk.",
  "local-anomaly": "I move further into the corridor.",
};
const FIELD_NATURAL_PHASES = ["FIELD_OPERATION", "RETURN", "DEBRIEF"];

async function report() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-stranger-flow-"));
  const service = new DesktopService({ appDataPath: root });
  const launch = service.getAppInfo().app;
  const launchWorlds = service.listWorlds().worlds.length;
  const providerStatus = service.getProviderStatus().provider;
  const modeRegistry = service.listModes().modes;
  const modeChoices = modeRegistry.map((mode) => ({ id: mode.id, label: mode.program_name ?? mode.label, description: mode.description }));

  const world = service.createWorld({ name: "Stranger Flow", seed: "stranger-flow" });
  const worldCreated = world.ok;
  const worldId = world.world.id;

  service.createQ4Personnel({ world_id: worldId, first_name: "Sam", last_name: "Walker" });
  const started = service.startSession({ world_id: worldId, mode: "field-researcher", require_personnel: true });
  const briefingPhase = started.projection.phase.phase_id;
  const guidedEnabled = started.projection.phase.tutorial_context.enabled === true;
  const guidedMarkup = RENDERER.includes('data-testid="guided-introduction"');
  const guidedModeSpecific = ["Current instruction", "Channel guidance", "Desk instruction", "Investigation instruction", "Field instruction"].every((text) => RENDERER.includes(text));

  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) service.submitAction({ world_id: worldId, mode: "field-researcher", action });
  service.submitQ4Communication({ world_id: worldId, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." });
  const fieldEntry = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "CROSS" });
  const fieldPhase = fieldEntry.projection.phase.phase_id;

  const naturalResult = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: PHRASES["field-researcher"] });
  const recap = qol.recap(fieldEntry.projection);

  const saved = service.saveWorld({ world_id: worldId });
  const resumed = service.resumeSession({ world_id: worldId, mode: "field-researcher" });

  const settingsResult = service.updateSettings({ settings: { theme: "high-contrast", text_scale: "extra-large", reduced_motion: true } });
  const providerFailure = service.updateSettings({ settings: { provider: "openai" } });
  const offlineResult = await service.submitNatural({ world_id: worldId, mode: "field-researcher", text: "look around" });

  const modeFlows = [];
  for (const mode of modeRegistry) {
    let projection = null;
    let natural = null;
    if (mode.id === "field-researcher") {
      projection = fieldEntry.projection;
      natural = naturalResult;
    } else {
      const entry = service.startSession({ world_id: worldId, mode: mode.id, seed: `stranger-flow-${mode.id}` });
      projection = entry.projection;
      natural = await service.submitNatural({ world_id: worldId, mode: mode.id, text: PHRASES[mode.id] });
    }
    const html = surfaces.render(projection);
    const naturalDockOffered = mode.id !== "field-researcher" || FIELD_NATURAL_PHASES.includes(projection.phase?.phase_id);
    const naturalDockMarkup = RENDERER.includes('data-testid="natural-primary"');
    modeFlows.push({
      mode: mode.id,
      phase: projection.phase?.phase_id ?? null,
      safe_surface: !FORBIDDEN_PLAYER_DATA.test(html),
      natural_accepted: natural.ok === true,
      has_natural_input: natural.ok === true && naturalDockOffered && naturalDockMarkup,
    });
  }

  const reportData = {
    version: "yellow-beast-stranger-flow-report@v1",
    launch: { first_run_complete: launch.first_run_complete === true, worlds: launchWorlds },
    world_creation: { ok: worldCreated, world_name: world.world.name },
    mode_choices: { count: modeChoices.length, choices: modeChoices, all_described: modeChoices.every((mode) => mode.description && mode.description.length > 0) },
    guided_introduction: { phase_enabled: guidedEnabled, player_surface: guidedEnabled && guidedMarkup, mode_specific: guidedModeSpecific },
    natural_language: { offline: providerStatus.offline === true, accepted: naturalResult.ok === true, result_understandable: Boolean(naturalResult.result?.scene?.narration) },
    contextual_information: { recap_title: recap.title, sections: recap.sections.length, what_do_i_know: RENDERER.includes("What do I know?") },
    save_resume: { saved: saved.ok === true, resumed: resumed.ok === true, same_world: resumed.ok && resumed.projection.world.id === worldId, no_advance: resumed.ok && resumed.projection.phase.phase_id === fieldPhase },
    offline_provider_failure: { safe_error: providerFailure.ok === false, can_continue_offline: service.getProviderStatus().provider.offline === true, continues_offline: offlineResult.ok === true },
    settings_accessibility: { saved: settingsResult.ok === true, high_contrast: settingsResult.settings?.theme === "high-contrast", maximum_text_size: settingsResult.settings?.text_scale === "extra-large", reduced_motion: settingsResult.settings?.reduced_motion === true },
    mode_flows: modeFlows,
    player_boundary: { no_debug_console_by_default: launch.developer_mode !== true && RENDERER.includes("current.developer"), no_opaque_ids_in_surfaces: modeFlows.every((flow) => flow.safe_surface) },
    briefing_phase: briefingPhase,
    field_phase: fieldPhase,
    passed: worldCreated && modeChoices.length === 4 && modeChoices.every((mode) => mode.description && mode.description.length > 0) && guidedEnabled && guidedMarkup && naturalResult.ok === true && recap.sections.length > 0 && saved.ok === true && resumed.ok === true && resumed.projection.world.id === worldId && resumed.projection.phase.phase_id === fieldPhase && providerFailure.ok === false && service.getProviderStatus().provider.offline === true && offlineResult.ok === true && settingsResult.ok === true && settingsResult.settings?.text_scale === "extra-large" && modeFlows.every((flow) => flow.safe_surface && flow.has_natural_input) && launch.first_run_complete !== true,
  };
  fs.rmSync(root, { recursive: true, force: true });
  return reportData;
}

if (require.main === module) {
  report().then((value) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    process.exit(value.passed ? 0 : 1);
  }).catch((error) => {
    process.stderr.write(`stranger-flow-report failed: ${error.stack}\n`);
    process.exit(2);
  });
}

module.exports = { report };
