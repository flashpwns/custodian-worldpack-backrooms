"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DesktopService, MODES } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const qol = require("../desktop/renderer/qol");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-stranger-"));
  return { root, service: new DesktopService({ appDataPath: root }) };
}
(async () => {
const { root, service } = fixture();
const launch = { first_run_complete: service.getAppInfo().app.first_run_complete, worlds: service.listWorlds().worlds.length };
const modeChoices = service.listModes().modes.map(({ id, label, description }) => ({ id, label, description }));
const created = service.createWorld({ name: "A Stranger's First World", seed: "yb33-stranger" });
const field = service.startSession({ world_id: created.world.id, mode: "field-researcher", seed: "yb33-stranger-field" });
const naturalResult = await service.submitNatural({ world_id: created.world.id, mode: "field-researcher", text: "look around" });
const projection = service.getGameplayProjection({ world_id: created.world.id, mode: "field-researcher" }).projection;
const recap = qol.recap(projection);
const saved = service.saveWorld({ world_id: created.world.id });
const resumedService = new DesktopService({ appDataPath: root });
const resumed = resumedService.resumeSession({ world_id: created.world.id, mode: "field-researcher" });
const settings = service.updateSettings({ settings: { theme: "high-contrast", text_scale: "extra-large", reduced_motion: true, guided_introductions: true } });
const providerFailure = service.updateSettings({ settings: { provider: "openai" } });
const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
const allModes = MODES.map(({ id }) => {
  const started = service.startSession({ world_id: created.world.id, mode: id, seed: `yb33-${id}` });
  const html = started.ok ? surfaces.render(started.projection) : "";
  return { id, started: started.ok, safe_surface: !/<pre>|STORY THREAD|MYSTERY ID|region-[a-f0-9]+/i.test(html), has_natural_input: started.ok && /data-testid="natural-primary"/.test(renderer) };
});
const report = {
  version: "yellow-beast-stranger-flow@v1",
  launch,
  world_creation: { ok: created.ok, world_name: created.world?.name ?? null },
  mode_choices: { count: modeChoices.length, choices: modeChoices.map(({ label, description }) => ({ label, description })), all_described: modeChoices.every((choice) => choice.label && choice.description) },
  guided_introduction: { phase_enabled: field.ok && field.projection.phase.tutorial_context.enabled, player_surface: /data-testid="guided-introduction"/.test(renderer), mode_specific: /Clear-Q4|Beck's Desk|Nullzone|Lost/.test(renderer) },
  natural_language: { offline: true, accepted: Boolean(naturalResult?.ok), result_understandable: Boolean(naturalResult?.result?.scene?.narration || naturalResult?.result?.summary) },
  contextual_information: { recap_title: recap.title, sections: recap.sections.map((section) => section.heading), what_do_i_know: /What do I know\?/.test(renderer) },
  save_resume: { saved: saved.ok, resumed: resumed.ok, same_world: resumed.ok && resumed.projection.world.id === created.world.id, no_advance: resumed.ok && resumed.projection.world.id === created.world.id },
  offline_provider_failure: { safe_error: providerFailure.ok === false, can_continue_offline: service.getProviderStatus().provider.offline },
  settings_accessibility: { saved: settings.ok, high_contrast: settings.settings?.theme === "high-contrast", maximum_text_size: settings.settings?.text_scale === "extra-large", reduced_motion: settings.settings?.reduced_motion === true },
  mode_flows: allModes,
  player_boundary: { no_debug_console_by_default: service.getAppInfo().app.developer_mode === false, no_opaque_ids_in_surfaces: allModes.every((mode) => mode.safe_surface) },
  passed: launch.first_run_complete === false && launch.worlds === 0 && created.ok && field.ok && field.projection.phase.tutorial_context.enabled && naturalResult?.ok === true && naturalResult.result.scene?.narration && saved.ok && resumed.ok && settings.ok && providerFailure.ok === false && allModes.every((mode) => mode.started && mode.safe_surface && mode.has_natural_input)
};
if (root) fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
})();
