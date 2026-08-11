"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService, MODES } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");

function fixture({ secure = false } = {}) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-desktop-")); const credentials = secure ? new (require("../desktop/credentials").CredentialStore)({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`safe:${value}`), decryptString: (value) => value.toString().slice(5) }, file: path.join(root, "credentials", "openai.bin") }) : undefined; return { root, service: new DesktopService({ appDataPath: root, credentials }) }; }
test("desktop service supports offline first-run world and field lifecycle", () => {
  const { root, service } = fixture();
  assert.equal(service.getAppInfo().app.first_run_complete, false);
  const created = service.createWorld({ name: "Test World", seed: "desktop-test" }); assert.equal(created.ok, true);
  assert.equal(service.listWorlds().worlds.length, 1); assert.equal(service.listModes().modes.length, 4);
  const started = service.startSession({ world_id: created.world.id, mode: "field-researcher", seed: "field-test" }); assert.equal(started.ok, true); assert.equal(started.projection.gameplay.version, "yellow-beast-gameplay-projection@v1");
  const action = service.submitAction({ world_id: created.world.id, mode: "field-researcher", action: "LOOK" }); assert.equal(action.ok, true);
  assert.equal(service.saveWorld({ world_id: created.world.id }).ok, true);
  const resumed = new DesktopService({ appDataPath: root }).resumeSession({ world_id: created.world.id, mode: "field-researcher" }); assert.equal(resumed.ok, true); assert.equal(resumed.projection.world.id, created.world.id);
});
test("desktop world metadata, settings, export/import, and deletion stay isolated", () => {
  const { root, service } = fixture(); const one = service.createWorld({ name: "One", seed: "one" }); const two = service.createWorld({ name: "Two", seed: "two" });
  assert.notEqual(one.world.id, two.world.id); assert.equal(service.updateSettings({ settings: { theme: "dark", provider: "offline" } }).settings.theme, "dark");
  const exportFile = path.join(root, "one.yellow-beast.json"); assert.equal(service.exportWorld({ world_id: one.world.id, destination: exportFile }).ok, true);
  assert.equal(service.importWorld({ source: exportFile }).ok, false, "identity conflicts are rejected");
  assert.equal(service.deleteWorld({ world_id: one.world.id }).ok, false, "confirmation is required"); assert.equal(service.deleteWorld({ world_id: one.world.id, confirmed: true }).ok, true);
  assert.equal(service.listWorlds().worlds.length, 1); assert.equal(service.loadWorld({ world_id: two.world.id }).ok, true);
});
test("desktop service exposes only allowlisted modes and canonical action results", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Actions", seed: "actions" }).world;
  assert.deepEqual(MODES.map(({ id }) => id), ["field-researcher", "lost", "async-command", "local-anomaly"]);
  const started = service.startSession({ world_id: world.id, mode: "lost", seed: "lost" }); assert.equal(started.ok, true);
  const unavailable = service.submitAction({ world_id: world.id, mode: "lost", action: "ARBITRARY_FILESYSTEM" }); assert.equal(unavailable.ok, false); assert.equal(unavailable.error.code, "ACTION_UNAVAILABLE");
  assert.equal(service.getInstitutionProjection({ world_id: world.id }).ok, true);
});
test("mode-specific surfaces render only their safe desktop projections", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Surfaces", seed: "surfaces" }).world;
  for (const mode of MODES.map(({ id }) => id)) {
    const started = service.startSession({ world_id: world.id, mode, seed: `${mode}-seed` }); assert.equal(started.ok, true, mode);
    const html = surfaces.render(started.projection); assert.match(html, mode === "field-researcher" ? /q4-preparation-surface/ : new RegExp(`surface-${mode === "async-command" ? "beck" : mode === "local-anomaly" ? "nullzone" : mode}`));
    assert.doesNotMatch(html, /<pre>/, `${mode} never renders a raw JSON dump`);
  }
  const lostProjection = service.getGameplayProjection({ world_id: world.id, mode: "lost" }).projection;
  const lostHtml = surfaces.render(lostProjection); assert.doesNotMatch(lostHtml, /Task tray|Institutional timeline|research|personnel/i, "Lost receives no institutional workstation data");
  const nullzoneProjection = service.getGameplayProjection({ world_id: world.id, mode: "local-anomaly" }).projection;
  assert.doesNotMatch(surfaces.render(nullzoneProjection), /Task tray|Institutional timeline|personnel/i, "Nullzone receives no Beck data");
  assert.deepEqual(Object.keys(surfaces.CAPABILITIES).sort(), MODES.map(({ id }) => id).sort());
});
test("safe action targets travel from projection to canonical runtime without command parsing", () => {
  const { service } = fixture(); const world = service.createWorld({ name: "Action targets", seed: "targets" }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "targets" }); const move = started.projection.available_actions.find((item) => item.type === "MOVE");
  assert.ok(move.targets.length > 0); const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: move.type, target: move.targets[0].ref }); assert.equal(result.ok, true);
  assert.equal(result.projection.version, "yellow-beast-desktop-projection@v1");
});
test("one desktop world retains canonical state while every mode uses an offline structured action", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Shared desktop world", seed: "shared" }).world;
  const field = service.startSession({ world_id: world.id, mode: "field-researcher", seed: "field" }); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" }).ok, true);
  const beck = service.startSession({ world_id: world.id, mode: "async-command", seed: "beck" }); assert.equal(service.submitAction({ world_id: world.id, mode: "async-command", action: "ADVANCE" }).ok, true);
  const civilian = service.startSession({ world_id: world.id, mode: "local-anomaly", seed: "civilian" }); assert.equal(service.submitAction({ world_id: world.id, mode: "local-anomaly", action: "DISCOVER" }).ok, true);
  const stranded = service.startSession({ world_id: world.id, mode: "lost", seed: "lost" }); assert.equal(service.submitAction({ world_id: world.id, mode: "lost", action: "STRAND" }).ok, true);
  assert.equal(field.projection.world.id, beck.projection.world.id); assert.equal(beck.projection.world.id, civilian.projection.world.id); assert.equal(civilian.projection.world.id, stranded.projection.world.id);
  const reopened = new DesktopService({ appDataPath: root }); assert.equal(reopened.loadWorld({ world_id: world.id }).ok, true); assert.equal(reopened.listWorlds().worlds.length, 1);
});
test("autosave retains one accepted action and previous-good recovery restores a damaged latest world", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Recovery", seed: "recovery" }).world;
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "recovery" }); assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" }).ok, true);
  const file = path.join(root, "worlds", `${world.id}.json`); const saved = fs.readFileSync(file, "utf8"); assert.ok(fs.existsSync(`${file}.previous-good`));
  fs.writeFileSync(file, "{ damaged"); const recovered = service.loadWorld({ world_id: world.id }); assert.equal(recovered.ok, true); assert.equal(recovered.recovery.recovered, true); assert.equal(fs.readFileSync(file, "utf8"), "{ damaged"); assert.equal(service.restoreBackup({ world_id: world.id, confirmed: true }).ok, true);
  assert.equal(service.loadWorld({ world_id: world.id }).ok, true); assert.notEqual(fs.readFileSync(file, "utf8"), "{ damaged"); assert.ok(saved.includes(world.id));
});
test("future saves and malformed imports fail safely without overwriting a world", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Versions", seed: "versions" }).world; const file = path.join(root, "worlds", `${world.id}.json`); const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, JSON.stringify({ version: "yellow-beast-world-history@future", world_id: world.id })); assert.equal(service.loadWorld({ world_id: world.id }).error.code, "WORLD_VERSION_UNSUPPORTED"); fs.writeFileSync(file, original);
  const malformed = path.join(root, "bad.yellow-beast.json"); fs.writeFileSync(malformed, JSON.stringify({ hello: "world" })); assert.equal(service.importWorld({ source: malformed }).ok, false); assert.equal(service.loadWorld({ world_id: world.id }).ok, true);
});
test("OpenAI credentials are host-only and excluded from exported worlds and diagnostics", () => {
  const { root, service } = fixture({ secure: true }); const secret = "sk-test-secret-never-export"; const world = service.createWorld({ name: "Secrets", seed: "secrets" }).world;
  assert.equal(service.configureOpenAI({ api_key: secret, model: "test-model" }).ok, true); assert.equal(service.getSettings().provider.openai.configured, true); assert.doesNotMatch(JSON.stringify(service.getSettings()), new RegExp(secret));
  const exported = path.join(root, "export.yellow-beast.json"); assert.equal(service.exportWorld({ world_id: world.id, destination: exported }).ok, true); assert.doesNotMatch(fs.readFileSync(exported, "utf8"), new RegExp(secret)); assert.doesNotMatch(JSON.stringify(service.getDiagnostics().diagnostics), new RegExp(secret));
  assert.equal(service.removeOpenAIKey().ok, true); assert.equal(service.getProviderStatus().provider.openai.configured, false);
});
test("provider selection is global presentation state and leaves canonical structured actions unchanged", () => {
  const { service } = fixture({ secure: true }); const world = service.createWorld({ name: "Provider independence", seed: "provider" }).world;
  service.startSession({ world_id: world.id, mode: "field-researcher", seed: "provider" }); const before = service.loadWorld({ world_id: world.id }).summary;
  assert.equal(service.configureOpenAI({ api_key: "sk-provider-test" }).ok, true); assert.equal(service.getProviderStatus().provider.selected, "openai"); assert.equal(service.updateSettings({ settings: { provider: "offline", input_mode: "structured" } }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "LOOK" }).ok, true); const after = service.loadWorld({ world_id: world.id }).summary;
  assert.equal(before.world_id, after.world_id); assert.equal(service.getProviderStatus().provider.selected, "offline"); assert.equal(service.testProvider().ok, true);
});
test("first-run world creation permits a blank name with an institutional fallback", () => {
  const { service } = fixture(); const created = service.createWorld({ name: "   ", seed: "pass10a-fallback" });
  assert.equal(created.ok, true); assert.equal(created.world.name, "Untitled field file"); assert.equal(service.listWorlds().first_run_complete, true); assert.equal(service.loadWorld({ world_id: created.world.id }).ok, true);
});
test("first-run canonical path creates personnel, confirms it, and reaches the Clear-Q4 briefing offline", () => {
  const { service } = fixture(); const created = service.createWorld({ name: "Offline career", seed: "pass10a-path" });
  assert.equal(created.ok, true); assert.equal(service.getProviderStatus().provider.offline, true); assert.equal(service.getQ4PersonnelStatus({ world_id: created.world.id }).required, true);
  const personnel = service.createQ4Personnel({ world_id: created.world.id, first_name: "Jack", last_name: "Rocha" }); assert.equal(personnel.ok, true);
  assert.equal(service.getQ4PersonnelStatus({ world_id: created.world.id }).confirmation_required, true); assert.equal(service.confirmQ4Personnel({ world_id: created.world.id }).ok, true);
  const started = service.startSession({ world_id: created.world.id, mode: "field-researcher", require_personnel: true, seed: "pass10a-path" });
  assert.equal(started.ok, true); assert.equal(started.projection.phase.phase_id, "BRIEFING"); assert.match(started.projection.q4.briefing, /survey assignment/i);
  const restored = new DesktopService({ appDataPath: service.paths.root }).getQ4PersonnelStatus({ world_id: created.world.id }); assert.equal(restored.player.display_name, "Jack Rocha"); assert.equal(restored.confirmation_required, false);
});
test("first-run renderer keeps Clear-Q4 selected and exposes recoverable keyboard forms", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /mode\.id === "field-researcher"/); assert.match(renderer, /placeholder="Optional/); assert.doesNotMatch(renderer, /name=\\"name\\" required/); assert.match(renderer, /nameInput\?\.focus\(\)/); assert.match(renderer, /personnel record could not be saved/); assert.match(renderer, /current\.world = result\.world; await home\(\)/); assert.match(renderer, /action\.startsWith\("mode:"\)\) enterMode\(action\.slice\(5\)\)/); assert.doesNotMatch(renderer, /action\.startsWith\("mode:"\)\) enterMode\(action\.slice\(6\)\)/);
});

test("damaged sessions resume a verified previous-good record without overwriting the damaged primary", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Session recovery", seed: "session-recovery" }).world;
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed: "session-recovery" }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true);
  const file = path.join(root, "saves", `${world.id}-field-researcher.json`); assert.ok(fs.existsSync(`${file}.previous-good`)); fs.writeFileSync(file, "{ interrupted");
  const restarted = new DesktopService({ appDataPath: root }); const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); assert.equal(resumed.recovery.session.recovered, true); assert.equal(resumed.projection.phase.phase_id, "BRIEFING"); assert.equal(fs.readFileSync(file, "utf8"), "{ interrupted");
  assert.equal(restarted.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true);
});

test("unsupported or unrecoverable session records fail safely and remain intact", () => {
  const { root, service } = fixture(); const world = service.createWorld({ name: "Session safety", seed: "session-safety" }).world;
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed: "session-safety" }).ok, true);
  const file = path.join(root, "saves", `${world.id}-field-researcher.json`); fs.writeFileSync(file, "{ truncated");
  const damaged = new DesktopService({ appDataPath: root }).resumeSession({ world_id: world.id, mode: "field-researcher" }); assert.equal(damaged.ok, false); assert.equal(damaged.error.code, "SESSION_SAVE_DAMAGED"); assert.equal(fs.readFileSync(file, "utf8"), "{ truncated");
  const future = JSON.stringify({ version: 99, schema: "yellow-beast-session@future", mode: "field-researcher", kind: "bootstrap", payload: {} }); fs.writeFileSync(file, future);
  const unsupported = new DesktopService({ appDataPath: root }).resumeSession({ world_id: world.id, mode: "field-researcher" }); assert.equal(unsupported.ok, false); assert.equal(unsupported.error.code, "SESSION_VERSION_UNSUPPORTED"); assert.equal(fs.readFileSync(file, "utf8"), future);
});

test("diagnostic export is JSON, records safe recovery context, and redacts credentials", () => {
  const { root, service } = fixture({ secure: true }); const secret = "sk-diagnostic-secret"; const world = service.createWorld({ name: "Diagnostic record", seed: "diagnostic" }).world;
  assert.equal(service.configureOpenAI({ api_key: secret, model: "test-model" }).ok, true); assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed: "diagnostic" }).ok, true);
  const exported = service.exportTesterReport({ world_id: world.id, note: "relaunch reproduction" }); assert.equal(exported.ok, true); const report = JSON.parse(fs.readFileSync(exported.file, "utf8"));
  assert.equal(report.version, "yellow-beast-diagnostic-record@1"); assert.equal(report.world_seed, "diagnostic"); assert.equal(report.save_schema_version, "yellow-beast-session@7"); assert.equal(report.provider_status.configured, true); assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8"); assert.match(renderer, /Export diagnostic record/); assert.match(renderer, /exportTesterReport/);
});
