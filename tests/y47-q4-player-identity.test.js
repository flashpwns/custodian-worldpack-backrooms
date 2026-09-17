"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const surfaces = require("../desktop/renderer/surfaces");
const nameRules = require("../desktop/shared/name-rules");

test('waiver rules accept names without substring false positives and reject invalid fields independently', () => {
  for (const name of ["O'Neil", "Anne-Marie", "Élodie", "A", "Scunthorpe", "Dickson"]) assert.equal(nameRules.valid(name), true, name);
  for (const name of ['', '123', 'Ann!', 'Anne Marie', 'Fuck', 'F-u-c-k', 'Shithead', 'A--B', "A'", 'Abcdefghijklm']) assert.equal(nameRules.valid(name), false, name);
  assert.deepEqual(nameRules.invalidFields({ first_name:'Morgan', last_name:'123' }), ['last_name']);
  assert.deepEqual(nameRules.invalidFields({ first_name:'', last_name:'Fuck' }), ['last_name', 'first_name']);
});

test('direct personnel creation cannot bypass profanity rejection or mutate a rejected record', () => {
  const { service, world:record } = fixture('profanity-boundary');
  const world = service.getWorld(record.id), before = structuredClone(world);
  assert.equal(require('../tools/q4-personnel').createPlayer(world, { first_name:'Fuck', last_name:'Vale' }).code, 'PLAYER_NAME_INVALID');
  assert.deepEqual(world, before);
  service.shutdown();
});

function fixture(seed = "player-identity") {
  const service = new DesktopService({ appDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "yb-q4-player-")) });
  const world = service.createWorld({ name: "Player identity", seed }).world;
  return { service, world };
}
function createAndStart(service, world, first_name = "Jack", last_name = "Rocha", scenario = null) {
  const created = service.createQ4Personnel({ world_id: world.id, first_name, last_name });
  assert.equal(created.ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);
  return service.startSession({ world_id: world.id, mode: "field-researcher", seed: "player-identity", require_personnel: true, ...(scenario ? { scenario } : {}) });
}
function advanceTo(service, world, actions = ["READY", "PROCEED", "APPROACH", "READY", "RADIO_CHECK", "CROSS"]) {
  let result;
  for (const action of actions) {
    if (action === "RADIO_CHECK") {
      result = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." });
      assert.equal(result.ok, true);
    } else result = service.submitAction({ world_id: world.id, mode: "field-researcher", action });
  }
  return result;
}

test("fresh Clear-Q4 requires personnel creation before assignment generation", () => {
  const { service, world } = fixture();
  assert.equal(service.getQ4PersonnelStatus({ world_id: world.id }).required, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true }).error.code, "PERSONNEL_CREATION_REQUIRED");
  assert.equal(Object.keys(service.getWorld(world.id).q4_missions ?? {}).length, 0);
  const started = createAndStart(service, world);
  assert.equal(started.projection.phase.phase_id, "BRIEFING");
  assert.equal(started.projection.q4.player.name, "Jack Rocha");
});

test("player is distinct from a bounded generated coworker roster", () => {
  const { service, world } = fixture(); const started = createAndStart(service, world); const team = started.projection.q4.team;
  assert.ok(team.length >= 3 && team.length <= 5);
  assert.equal(team[0].display_name, "Jack Rocha · YOU");
  assert.equal(new Set(team.slice(1).map((person) => person.display_name)).size, team.length - 1);
  assert.ok(team.slice(1).every((person) => person.display_name && !person.controlled));
  assert.ok(team.every((person) => person.display_name !== "Jack Rocha" || person.controlled));
});

test("created identity persists and equipment holders name the actual people", () => {
  const { service, world } = fixture("identity-persistence"); const started = createAndStart(service, world); const before = started.projection.q4;
  assert.deepEqual(before.q4?.player, undefined);
  const holders = before.equipment.required.map((item) => item.holder);
  assert.equal(holders.filter((holder) => holder === "You").length, 2);
  assert.ok(holders.filter((holder) => holder !== "You").every((holder) => before.team.some((person) => person.display_name === holder)));
  const restarted = new DesktopService({ appDataPath: service.paths.root }); const resumed = restarted.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true); assert.equal(resumed.projection.q4.player.name, "Jack Rocha");
});

test("LOCAL is delivered to a generated coworker before field entry while Standard remains procedurally gated", () => {
  const { service, world } = fixture("communication-gates"); const started = createAndStart(service, world); const peer = started.projection.q4.team.find((member) => !member.controlled);
  const local = service.submitQ4Communication({ world_id: world.id, channel: "local", target: peer.first_name, text: `Good morning, ${peer.first_name}.` });
  assert.equal(local.ok, true); assert.match(local.result.public_reason, new RegExp(`^${peer.first_name}:`));
  const standard = service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Hello?" });
  assert.equal(standard.ok, false); assert.match(standard.error.message, /not active during briefing/i);
  advanceTo(service, world, ["READY", "PROCEED", "APPROACH"]);
  const threshold = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.equal(threshold.phase.phase_id, "THRESHOLD"); assert.equal(threshold.q4.channels.standard.available, false);
  assert.match(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Hello?" }).error.message, /approach|contact/i);
  const radioReady = advanceTo(service, world, ["READY"]); assert.equal(radioReady.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(radioReady.projection.q4.channels.standard.available, true);
  assert.equal(radioReady.projection.q4.channels.standard.state, "establishing");
  const checked = advanceTo(service, world, ["RADIO_CHECK"]); assert.equal(checked.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
  assert.equal(checked.projection.q4.channels.standard.available, true);
  const field = advanceTo(service, world, ["CROSS"]); assert.equal(field.projection.phase.phase_id, "FIELD_OPERATION");
});

test("phase copy and progression controls identify the destination", () => {
  const { service, world } = fixture("phase-copy"); createAndStart(service, world, "Jack", "Rocha", "day1-opener");
  let projection = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  assert.match(projection.q4.briefing, /speak with the assigned team/i); assert.match(surfaces.render(projection), /PROCEED TO ESD/);
  service.completeBriefingBroadcast({ world_id: world.id });
  for (const [action, phase, copy] of [["READY", "STAGING", /cooperate with the team/i], ["PROCEED", "FACILITY_TRANSIT", /toward the Threshold room/i], ["APPROACH", "THRESHOLD", /begin the Standard radio procedure/i]]) {
    const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action }); assert.equal(result.projection.phase.phase_id, phase); assert.match(result.projection.q4.briefing, copy); projection = result.projection;
  }
  assert.match(surfaces.render(projection), /Begin radio procedure/);
  const radio = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }); assert.match(radio.projection.q4.briefing, /Establish contact with Standard/i); assert.match(surfaces.render(radio.projection), /Compose your own speech or transmission/i);
});

test("renderer exposes creation, confirmation, phase guidance, and direct progression wiring", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /PERSONNEL IDENTITY WAIVER/); assert.match(renderer, /Last name/); assert.match(renderer, /First name/); assert.match(renderer, /personnelNameReview/); assert.match(renderer, /aeotInitialization/); assert.match(renderer, /createQ4Personnel/); assert.match(renderer, /selectedAction/); assert.match(renderer, /Hide guidance/); assert.doesNotMatch(renderer, /You are entering Clear-Q4/);
});

test('personnel entry enforces the beatmap twelve-character boundary without creating rejected records', () => {
  const personnel = require('../tools/q4-personnel');
  for (const field of ['first_name', 'last_name']) {
    const { service, world:record } = fixture(`name-boundary-${field}`);
    const world = service.getWorld(record.id);
    const before = structuredClone(world);
    const names = { first_name:'Morgan', last_name:'Vale', [field]:'Abcdefghijklm' };
    assert.equal(personnel.createPlayer(world, names).code, 'PLAYER_NAME_INVALID');
    assert.deepEqual(world, before, 'Rejected names must not mutate the world');
    const accepted = service.createQ4Personnel({ world_id:record.id, ...names, [field]:'Abcdefghijkl' });
    assert.equal(accepted.ok, true);
    service.shutdown();
  }
});

test("mixed-case personnel identity survives filing and persistence unchanged and locks world renaming", () => {
  const { service, world } = fixture("mixed-case-identity");
  assert.equal(world.name, "Player identity");

  // Initial uncommenced world can be renamed
  const renamedInitial = service.renameWorld({ world_id: world.id, name: "Initial Research Draft" });
  assert.equal(renamedInitial.ok, true);
  assert.equal(renamedInitial.world.name, "Initial Research Draft");
  assert.equal(renamedInitial.world.has_filed_personnel, false);

  // File mixed-case personnel identity
  const created = service.createQ4Personnel({ world_id: world.id, first_name: "Jack", last_name: "Rocha" });
  assert.equal(created.ok, true);
  assert.equal(created.player.first_name, "Jack");
  assert.equal(created.player.last_name, "Rocha");
  assert.equal(created.player.display_name, "Jack Rocha");

  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);

  // Once confirmed, world label derives deterministically from personnel identity
  const listed = service.listWorlds().worlds.find((w) => w.id === world.id);
  assert.equal(listed.name, "Jack Rocha");
  assert.equal(listed.has_filed_personnel, true);

  const loaded = service.loadWorld({ world_id: world.id }).world;
  assert.equal(loaded.name, "Jack Rocha");
  assert.equal(loaded.has_filed_personnel, true);

  // World renaming is locked once personnel identity is filed
  const renameAttempt = service.renameWorld({ world_id: world.id, name: "Renamed File" });
  assert.equal(renameAttempt.ok, false);
  assert.equal(renameAttempt.error.code, "PERSONNEL_RECORD_LOCKED");

  // Re-open service from disk to verify persistence
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const restoredStatus = restarted.getQ4PersonnelStatus({ world_id: world.id });
  assert.equal(restoredStatus.player.first_name, "Jack");
  assert.equal(restoredStatus.player.last_name, "Rocha");
  assert.equal(restoredStatus.player.display_name, "Jack Rocha");

  const restoredWorld = restarted.loadWorld({ world_id: world.id }).world;
  assert.equal(restoredWorld.name, "Jack Rocha");
  assert.equal(restoredWorld.has_filed_personnel, true);

  // An uncommenced world before personnel registration can still be renamed
  const uncommenced = restarted.createWorld({ name: "Untitled field file", seed: "uncommenced-test" }).world;
  assert.equal(uncommenced.name, "Untitled field file");
  assert.equal(uncommenced.has_filed_personnel, false);
  const renamed = restarted.renameWorld({ world_id: uncommenced.id, name: "Alpha Assignment" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.world.name, "Alpha Assignment");
  assert.equal(renamed.world.has_filed_personnel, false);
  restarted.shutdown();
});

test("deliberately irregular capitalization survives filing, persistence, world listing, and reload unchanged", () => {
  const { service, world } = fixture("irregular-capitalization");
  const first_name = "jAcK";
  const last_name = "rOcHa";

  const created = service.createQ4Personnel({ world_id: world.id, first_name, last_name });
  assert.equal(created.ok, true);
  assert.equal(created.player.first_name, "jAcK");
  assert.equal(created.player.last_name, "rOcHa");
  assert.equal(created.player.display_name, "jAcK rOcHa");

  const confirmed = service.confirmQ4Personnel({ world_id: world.id });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.player.first_name, "jAcK");
  assert.equal(confirmed.player.last_name, "rOcHa");
  assert.equal(confirmed.player.display_name, "jAcK rOcHa");

  // World listing derives exact display name
  const listed = service.listWorlds().worlds.find((w) => w.id === world.id);
  assert.equal(listed.name, "jAcK rOcHa");
  assert.equal(listed.has_filed_personnel, true);

  // Reload from disk to verify persistence
  service.shutdown();
  const restarted = new DesktopService({ appDataPath: service.paths.root });
  const restoredStatus = restarted.getQ4PersonnelStatus({ world_id: world.id });
  assert.equal(restoredStatus.player.first_name, "jAcK");
  assert.equal(restoredStatus.player.last_name, "rOcHa");
  assert.equal(restoredStatus.player.display_name, "jAcK rOcHa");

  const restoredWorld = restarted.loadWorld({ world_id: world.id }).world;
  assert.equal(restoredWorld.name, "jAcK rOcHa");
  assert.equal(restoredWorld.has_filed_personnel, true);

  // Session start also preserves exact identity
  const started = restarted.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  assert.equal(started.ok, true);
  assert.equal(started.projection.q4.player.first_name, "jAcK");
  assert.equal(started.projection.q4.player.name, "jAcK rOcHa");
  assert.equal(started.projection.q4.team[0].first_name, "jAcK");
  assert.equal(started.projection.q4.team[0].last_name, "rOcHa");
  assert.equal(started.projection.q4.team[0].display_name, "jAcK rOcHa · YOU");

  // Waiver input and review do not force uppercase presentation
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  assert.doesNotMatch(css, /\.bracket-unified-line input\s*\{[^}]*text-transform:\s*uppercase/);
  assert.doesNotMatch(css, /\.review-name\s*\{[^}]*text-transform:\s*uppercase/);

  restarted.shutdown();
});
