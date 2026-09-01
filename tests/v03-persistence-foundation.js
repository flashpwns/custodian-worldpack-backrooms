"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const evidence = require("../tools/q4-evidence-authority");
const ecology = require("../tools/q4-phenomenon-ecology");
const spatial = require("../tools/spatial-runtime");
const outcomes = require("../tools/q4-outcome-authority");
const inspection = require("../tools/dev-inspection");
const threads = require("../tools/story-threads");
const bootstrap = require("../tools/run-bootstrap");
const career = require("../tools/q4-career-loop");
const q4 = require("../tools/q4-experience");
const consequences = require("../tools/consequence-runtime");
const standard = require("../tools/q4-standard-operator");
const survey = require("../tools/survey-frontier");
const desk = require("../tools/becks-desk");
const { DesktopService } = require("../desktop/service");

function temporary(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yellow-beast-v03-${name}-`));
  t.after(() => fs.rmSync(root, { recursive:true, force:false }));
  return root;
}
function legacy(seed) {
  const world = history.createWorld({ seed });
  delete world.canonical_shape_version;
  delete world.storage_migrations;
  return world;
}
function saveLoad(file, world) { history.saveWorld(file, world); return history.loadWorld(file); }
function deepHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function legacyEvidence(seed, overrides = {}) {
  const world = legacy(seed); delete world.q4_evidence_archive;
  history.instantiateCharacter(world, { run_id:"legacy-setup", identity:"observer", display_name:"Observer", role:"field researcher", authority:"legacy-record" });
  world.evidence["legacy-evidence"] = { id:"legacy-evidence", type:"photograph", creator:"observer", origin_run:"run-old", availability:"observer-held", custody:[{ holder:"observer", event:"created" }], provenance:"preserved-legacy-capture", available_to_player:true, ...overrides };
  return world;
}

test("fresh canonical shape is identical through first and repeated reloads", (t) => {
  const root = temporary(t, "reload"); const firstFile = path.join(root, "first.json"); const secondFile = path.join(root, "second.json");
  const created = history.createWorld({ seed:"v03-fresh" }); const before = structuredClone(created);
  const committed = history.saveWorld(firstFile, created); const first = history.loadWorld(firstFile);
  assert.deepEqual(committed, before); assert.deepEqual(first, before);
  const recommitted = history.saveWorld(secondFile, first); const second = history.loadWorld(secondFile);
  assert.deepEqual(recommitted, first); assert.deepEqual(second, first);
  assert.equal(fs.readFileSync(firstFile, "utf8"), fs.readFileSync(secondFile, "utf8"));
});

test("multiple deterministic current worlds remain byte-stable across repeated commits", (t) => {
  const root = temporary(t, "multi-seed-reload");
  for (const seed of ["v03-seed-alpha", "v03-seed-beta", "v03-seed-gamma", "v03-seed-delta"]) {
    const firstFile = path.join(root, `${seed}-first.json`); const secondFile = path.join(root, `${seed}-second.json`); const world = history.createWorld({ seed });
    world.q4_scars.seed_marker = seed; world.q4_knowledge[seed] = { observer_knowledge:[], institutional_knowledge:[] };
    const first = saveLoad(firstFile, world); const second = saveLoad(secondFile, first); assert.deepEqual(first, world); assert.deepEqual(second, first); assert.equal(fs.readFileSync(firstFile, "utf8"), fs.readFileSync(secondFile, "utf8"));
  }
});

test("ecology current, missing, null, and legacy forms migrate deterministically", () => {
  const current = legacy("v03-ecology-current"); const currentBefore = structuredClone(current.q4_phenomenon_ecology);
  const currentResult = history.migrateWorld(current);
  assert.deepEqual(currentResult.q4_phenomenon_ecology, currentBefore);
  assert.equal(currentResult.q4_phenomenon_ecology.migrated_conservatively, undefined);
  for (const form of ["missing", "null"]) {
    const input = legacy(`v03-ecology-${form}`); if (form === "missing") delete input.q4_phenomenon_ecology; else input.q4_phenomenon_ecology = null;
    const one = history.migrateWorld(input); const two = history.migrateWorld(input);
    assert.deepEqual(one, two); assert.equal(one.q4_phenomenon_ecology.migrated_conservatively, true);
    const existingLocations = spatial.canonicalDefinition(null, require("../data/worldpacks/clear-q4/spatial.json")).locations.map((item) => item.id);
    assert.deepEqual(one.q4_phenomenon_ecology.evaluated_locations, existingLocations);
    assert.deepEqual(one.phenomena, {});
  }
  const old = legacy("v03-ecology-legacy"); old.q4_phenomenon_ecology = { conditions:{ legacy:{ id:"legacy", status:"unresolved" } } };
  const migrated = history.migrateWorld(old);
  assert.equal(migrated.q4_phenomenon_ecology.migrated_conservatively, true);
  assert.deepEqual(migrated.q4_phenomenon_ecology.conditions, old.q4_phenomenon_ecology.conditions);
  assert.deepEqual(migrated.phenomena, {});
});

test("evidence archive current, missing, null, and well-formed legacy forms migrate validly and deterministically", (t) => {
  const root = temporary(t, "evidence-migration"); const firstFile = path.join(root, "first.json"); const secondFile = path.join(root, "second.json");
  const current = legacy("v03-evidence-current"); const currentBefore = structuredClone(current.q4_evidence_archive);
  assert.deepEqual(history.migrateWorld(current).q4_evidence_archive, currentBefore);
  for (const form of ["missing", "null"]) {
    const input = legacy(`v03-evidence-${form}`); if (form === "missing") delete input.q4_evidence_archive; else input.q4_evidence_archive = null;
    const one = history.migrateWorld(input); const two = history.migrateWorld(input);
    assert.deepEqual(one, two); assert.deepEqual(one.q4_evidence_archive, evidence.createState());
  }
  const old = legacyEvidence("v03-evidence-legacy"); const migrated = history.migrateWorld(old);
  assert.deepEqual(Object.keys(migrated.evidence), ["legacy-evidence"]);
  assert.deepEqual(Object.keys(migrated.q4_evidence_archive.records), ["legacy-evidence"]);
  assert.deepEqual(evidence.validate(migrated), { ok:true, broken:[] });
  const first = saveLoad(firstFile, migrated); const second = saveLoad(secondFile, first);
  assert.deepEqual(first, migrated); assert.deepEqual(second, first); assert.equal(fs.readFileSync(firstFile, "utf8"), fs.readFileSync(secondFile, "utf8"));
});

test("malformed legacy evidence is rejected without invented facts", () => {
  const partial = legacy("v03-evidence-partial"); partial.q4_evidence_archive = { records:{ retained:{ id:"retained", creator:"observer", provenance:{ source:"legacy" }, contradictions:[], player_access:true, standard_available:false } } };
  assert.throws(() => history.migrateWorld(partial), { code:"EVIDENCE_ARCHIVE_INVALID" });
  const missingCustody = legacyEvidence("v03-evidence-no-custody"); delete missingCustody.evidence["legacy-evidence"].custody;
  assert.throws(() => history.migrateWorld(missingCustody), { code:"EVIDENCE_ARCHIVE_INVALID" });
  const missingCreator = legacyEvidence("v03-evidence-no-creator"); delete missingCreator.evidence["legacy-evidence"].creator;
  assert.throws(() => history.migrateWorld(missingCreator), { code:"EVIDENCE_ARCHIVE_INVALID" });
  const missingProvenance = legacyEvidence("v03-evidence-no-provenance"); delete missingProvenance.evidence["legacy-evidence"].provenance;
  assert.throws(() => history.migrateWorld(missingProvenance), { code:"EVIDENCE_ARCHIVE_INVALID" });
  const malformedContradictions = history.migrateWorld(legacyEvidence("v03-evidence-bad-conflicts")); delete malformedContradictions.canonical_shape_version; delete malformedContradictions.storage_migrations; malformedContradictions.q4_evidence_archive.records["legacy-evidence"].contradictions = {};
  assert.throws(() => history.migrateWorld(malformedContradictions), { code:"EVIDENCE_ARCHIVE_INVALID" });
  const malformedAccess = history.migrateWorld(legacyEvidence("v03-evidence-bad-access")); delete malformedAccess.canonical_shape_version; delete malformedAccess.storage_migrations; malformedAccess.q4_evidence_archive.records["legacy-evidence"].player_access = "yes";
  assert.throws(() => history.migrateWorld(malformedAccess), { code:"EVIDENCE_ARCHIVE_INVALID" });
});

test("authorized legacy migration is explicit, conservative, and stable after one commit", (t) => {
  const root = temporary(t, "legacy"); const firstFile = path.join(root, "migrated.json"); const secondFile = path.join(root, "stable.json");
  const old = legacy("v03-legacy-stability"); delete old.q4_phenomenon_ecology; delete old.q4_evidence_archive;
  old.characters.worker = { identity:"worker", display_name:"Worker", status:"active" };
  old.phenomena.preexisting = { id:"preexisting", record_version:"legacy-phenomenon" };
  old.equipment = { kit:{ id:"kit", holder:"worker" } }; old.q4_knowledge.retained = { known_by:["worker"] };
  const gameplayBefore = { characters:structuredClone(old.characters), regions:structuredClone(old.regions), evidence:structuredClone(old.evidence), phenomena:structuredClone(old.phenomena), equipment:structuredClone(old.equipment), knowledge:structuredClone(old.knowledge), q4_knowledge:structuredClone(old.q4_knowledge), events:structuredClone(old.events) };
  const migrated = history.migrateWorld(old);
  assert.equal(migrated.canonical_shape_version, history.CURRENT_SHAPE_VERSION);
  assert.deepEqual(migrated.storage_migrations, [history.STORAGE_MIGRATION_ID]);
  for (const [key, value] of Object.entries(gameplayBefore)) assert.deepEqual(migrated[key], value);
  assert.equal(old.canonical_shape_version, undefined);
  const first = saveLoad(firstFile, migrated); const second = saveLoad(secondFile, first);
  assert.deepEqual(first, migrated); assert.deepEqual(second, first);
});

test("event payloads enter canonical history in their stable JSON representation", (t) => {
  const root = temporary(t, "payload"); const file = path.join(root, "world.json"); const world = history.createWorld({ seed:"v03-payload" });
  const sparse = []; sparse.length = 2; sparse[1] = undefined;
  const record = history.event(world, "run-payload", "payload.recorded", { retained:null, omitted:undefined, nested:{ omitted:undefined, value:4, nan:NaN }, list:[undefined, null, 2, Infinity, -Infinity], sparse, negativeZero:-0 });
  assert.deepEqual(record.payload, { retained:null, nested:{ value:4, nan:null }, list:[null, null, 2, null, null], sparse:[null, null], negativeZero:0 });
  const loaded = saveLoad(file, world); assert.deepEqual(loaded.events.at(-1), record); assert.deepEqual(loaded, world);
  class Custom { constructor() { this.value = 1; } }
  const cyclic = {}; cyclic.self = cyclic;
  const unsupported = [new Map([["value", 1]]), new Set([1]), /value/, new Date("2020-01-01T00:00:00.000Z"), new Custom(), () => 1, Symbol("value"), 1n, cyclic, undefined];
  for (const value of unsupported) {
    const beforeSequence = world.event_sequence; const beforeCount = world.events.length;
    assert.throws(() => history.event(world, "run-payload", "payload.invalid", value), { code:"CANONICAL_JSON_INVALID" });
    assert.equal(world.event_sequence, beforeSequence); assert.equal(world.events.length, beforeCount);
  }
  const functionProperty = { retained:true, unsupported:() => true };
  const symbolProperty = { retained:true }; symbolProperty[Symbol("hidden")] = 1;
  for (const value of [functionProperty, symbolProperty]) { const before = structuredClone(world); assert.throws(() => history.event(world, "run-payload", "payload.invalid", value), { code:"CANONICAL_JSON_INVALID" }); assert.deepEqual(world, before); }
});

test("current-world save rejects lossy values before touching primary or previous-good", (t) => {
  const root = temporary(t, "strict-save"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Strict save", seed:"v03-strict-save" });
  const committed = service.getWorld(created.world.id); committed.q4_scars.previous_good = true; service.saveCanonical(committed);
  const file = service.worldFile(created.world.id); const backup = service.backupFile(created.world.id); const primaryBefore = fs.readFileSync(file); const backupBefore = fs.readFileSync(backup);
  class Unsupported { constructor() { this.value = 1; } }
  const cycle = {}; cycle.self = cycle; const sparse = []; sparse.length = 2; sparse[1] = "retained";
  const cases = [Infinity, NaN, -Infinity, undefined, () => true, Symbol("value"), 1n, new Map([["value", 1]]), new Set([1]), /value/, new Date("2020-01-01T00:00:00.000Z"), new Unsupported(), sparse, cycle, { nested:[{ value:new Map() }] }];
  for (const value of cases) {
    const current = service.getWorld(created.world.id); const sequence = current.event_sequence; current.q4_scars.lossy = value;
    assert.throws(() => service.saveCanonical(current), { code:"CANONICAL_WORLD_VALUE_INVALID" });
    assert.equal(current.q4_scars.lossy, value); assert.equal(current.event_sequence, sequence);
    assert.equal(fs.readFileSync(file).equals(primaryBefore), true); assert.equal(fs.readFileSync(backup).equals(backupBefore), true);
    assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false);
  }
});

test("summary, projection, archive, and inspection reads leave canonical state byte-equivalent", () => {
  const world = history.createWorld({ seed:"v03-read-only" }); const before = structuredClone(world); const beforeJson = JSON.stringify(world); const beforeHash = deepHash(world);
  history.summary(world, "field-researcher"); evidence.archive(world, { observer:"player" }); evidence.validate(world);
  ecology.state(world); ecology.records(world); ecology.projection(world, { observer:"nobody", location_id:"nowhere" }); ecology.diagnostics(world, { developer:true });
  outcomes.archive(world); threads.derive(world); threads.observerView(world, threads.derive(world), "field-researcher"); inspection.snapshot(world); inspection.recentHistory(world);
  assert.deepEqual(world, before); assert.equal(JSON.stringify(world), beforeJson); assert.equal(deepHash(world), beforeHash);
  const incomplete = history.createWorld({ seed:"v03-read-only-incomplete" }); delete incomplete.q4_evidence_archive; delete incomplete.q4_phenomenon_ecology; const incompleteBefore = structuredClone(incomplete);
  evidence.archive(incomplete); ecology.state(incomplete); ecology.projection(incomplete, { observer:"nobody", location_id:"nowhere" }); ecology.diagnostics(incomplete); inspection.snapshot(incomplete);
  assert.deepEqual(incomplete, incompleteBefore);
  const malformedLifecycle = history.createWorld({ seed:"v03-read-only-lifecycle" }); delete malformedLifecycle.q4_lifecycle; const malformedBefore = structuredClone(malformedLifecycle); const malformedJson = JSON.stringify(malformedLifecycle); const malformedHash = deepHash(malformedLifecycle);
  assert.throws(() => outcomes.archive(malformedLifecycle), { code:"Q4_LIFECYCLE_INVALID" }); assert.throws(() => outcomes.isRetired(malformedLifecycle), { code:"Q4_LIFECYCLE_INVALID" });
  assert.deepEqual(malformedLifecycle, malformedBefore); assert.equal(JSON.stringify(malformedLifecycle), malformedJson); assert.equal(deepHash(malformedLifecycle), malformedHash);
  const malformedCharacters = history.createWorld({ seed:"v03-read-only-characters" }); delete malformedCharacters.characters; const charactersBefore = structuredClone(malformedCharacters); const charactersHash = deepHash(malformedCharacters);
  assert.throws(() => history.character(malformedCharacters, "missing"), { code:"CHARACTER_STATE_INVALID" }); assert.deepEqual(malformedCharacters, charactersBefore); assert.equal(deepHash(malformedCharacters), charactersHash);
});

test("atomic save retains previous-good recovery and preserves the damaged primary", (t) => {
  const root = temporary(t, "recovery"); const service = new DesktopService({ appDataPath:root });
  const created = service.createWorld({ name:"V03 recovery", seed:"v03-recovery" }); assert.equal(created.ok, true);
  const current = service.getWorld(created.world.id); current.q4_scars.after_first_save = true; service.saveCanonical(current);
  const file = service.worldFile(created.world.id); const backup = service.backupFile(created.world.id);
  assert.equal(fs.existsSync(backup), true); fs.writeFileSync(file, "{ damaged");
  const recovered = service.getWorld(created.world.id); assert.equal(recovered.q4_scars.after_first_save, undefined);
  assert.equal(fs.readFileSync(file, "utf8"), "{ damaged"); assert.equal(service.recoveryStatus(created.world.id).source, "previous-good-world");
  assert.equal(service.restoreBackup({ world_id:created.world.id, confirmed:true }).ok, true); history.loadWorld(file); service.shutdown();
});

test("array own properties use actual JavaScript array-index semantics", (t) => {
  const root = temporary(t, "array-indexes"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Array indexes", seed:"v03-array-indexes" });
  const file = service.worldFile(created.world.id); const baseline = fs.readFileSync(file);
  for (const key of ["4294967295", "-1", "01", "arbitrary"]) {
    const world = service.getWorld(created.world.id); const value = []; Object.defineProperty(value, key, { value:"CANONICAL-VALUE", enumerable:true, writable:true, configurable:true }); world.q4_scars.value = value;
    assert.throws(() => service.saveCanonical(world), { code:"CANONICAL_WORLD_VALUE_INVALID" }); assert.equal(fs.readFileSync(file).equals(baseline), true);
  }
  const maximumIndex = []; maximumIndex[4294967294] = "CANONICAL-VALUE";
  assert.equal(maximumIndex.length, 4294967295); assert.throws(() => history.canonicalJson(maximumIndex), { code:"CANONICAL_JSON_INVALID" });
  assert.deepEqual(history.canonicalJson(["zero"]), ["zero"]);
  for (const key of ["4294967295", "-1", "01", "arbitrary"]) { const value = []; Object.defineProperty(value, key, { value:true, enumerable:true }); assert.throws(() => history.canonicalEventPayload(value), { code:"CANONICAL_JSON_INVALID" }); }
});

test("event object normalization preserves proto-named data and rejects behavior atomically", () => {
  const world = history.createWorld({ seed:"v03-event-prototype" }); const payload = Object.create(null);
  Object.defineProperty(payload, "__proto__", { value:{ retained:true }, enumerable:true, writable:true, configurable:true }); payload.keep = true; payload.drop = undefined;
  const record = history.event(world, "run", "prototype.recorded", payload);
  assert.equal(Object.getPrototypeOf(record.payload), Object.prototype); assert.equal(Object.hasOwn(record.payload, "__proto__"), true); assert.deepEqual(record.payload.__proto__, { retained:true }); assert.equal(Object.hasOwn(record.payload, "drop"), false);
  let invoked = 0; const getter = {}; Object.defineProperty(getter, "value", { enumerable:true, get() { invoked += 1; return 1; } });
  const unusual = Object.create({ inherited:true }); unusual.own = true;
  const frozen = {}; Object.defineProperty(frozen, "value", { value:1, enumerable:true, writable:false, configurable:false });
  for (const value of [getter, unusual, frozen]) { const before = structuredClone(world); assert.throws(() => history.event(world, "run", "invalid", value), { code:"CANONICAL_JSON_INVALID" }); assert.equal(invoked, 0); assert.deepEqual(world, before); }
});

test("current session restoration is byte-stable and creates no observations", (t) => {
  const root = temporary(t, "session-idempotence"); let service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Session stability", seed:"v03-session-stability" });
  assert.equal(service.createQ4Personnel({ world_id:created.world.id, first_name:"Ada", last_name:"Vale" }).ok, true); assert.equal(service.confirmQ4Personnel({ world_id:created.world.id }).ok, true);
  assert.equal(service.startSession({ world_id:created.world.id, mode:"field-researcher", seed:"v03-session-stability", require_personnel:true }).ok, true); service.shutdown();
  const sessionFile = service.sessionFile(created.world.id, "field-researcher"); const worldFile = service.worldFile(created.world.id); const sessionBefore = fs.readFileSync(sessionFile); const worldBefore = fs.readFileSync(worldFile); const parsed = JSON.parse(sessionBefore);
  const provenanceCount = (save) => Object.values(save.payload.survey_frontier.personnel).flatMap((person) => [...Object.values(person.locations), ...Object.values(person.connections)]).reduce((sum, item) => sum + (item.provenance?.length ?? 0), 0);
  const countBefore = provenanceCount(parsed); const eventsBefore = parsed.payload.expedition.operational.events.length; const discoveryBefore = deepHash(parsed.payload.survey_frontier);
  for (let cycle = 0; cycle < 3; cycle += 1) { service = new DesktopService({ appDataPath:root }); assert.equal(service.resumeSession({ world_id:created.world.id, mode:"field-researcher" }).ok, true); service.shutdown(); const next = JSON.parse(fs.readFileSync(sessionFile)); assert.equal(provenanceCount(next), countBefore); assert.equal(next.payload.expedition.operational.events.length, eventsBefore); assert.equal(deepHash(next.payload.survey_frontier), discoveryBefore); assert.equal(fs.readFileSync(sessionFile).equals(sessionBefore), true); assert.equal(fs.readFileSync(worldFile).equals(worldBefore), true); }
});

test("active current Clear-Q4 environment is required at save and restore boundaries", (t) => {
  const root = temporary(t, "required-environment"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Required environment", seed:"v03-required-environment" });
  assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-required-environment" }).ok, true);
  const entry = service.session(created.world.id, mode); assert.equal(entry.run.spatial.environment.version, "yellow-beast-q4-environment@v1");
  service.persistSession(service.getWorld(created.world.id), mode, entry);
  const sessionFile = service.sessionFile(created.world.id, mode); const sessionBackup = service.sessionBackupFile(created.world.id, mode); const worldFile = service.worldFile(created.world.id); const worldBackup = service.backupFile(created.world.id);
  assert.equal(fs.existsSync(sessionBackup), true); assert.equal(fs.existsSync(worldBackup), true);
  const artifactsBefore = [sessionFile, sessionBackup, worldFile, worldBackup].map((file) => fs.readFileSync(file)); const world = service.getWorld(created.world.id); const worldBefore = deepHash(world); const surveyBefore = deepHash(entry.run.survey_frontier); const eventCountBefore = world.events.length;
  delete entry.run.spatial.environment; const malformedRunBefore = deepHash(entry.run);
  assert.throws(() => bootstrap.saveRun(entry.run), { code:"RUN_STATE_INVALID" });
  assert.throws(() => service.persistSession(world, mode, entry), { code:"RUN_STATE_INVALID" });
  assert.equal(deepHash(entry.run), malformedRunBefore); assert.equal(deepHash(entry.run.survey_frontier), surveyBefore); assert.equal(deepHash(world), worldBefore); assert.equal(world.events.length, eventCountBefore);
  for (const [index, file] of [sessionFile, sessionBackup, worldFile, worldBackup].entries()) assert.equal(fs.readFileSync(file).equals(artifactsBefore[index]), true);
  assert.equal(fs.readdirSync(path.dirname(sessionFile)).some((name) => name.endsWith(".tmp")), false);

  const malformed = JSON.parse(fs.readFileSync(sessionFile)); delete malformed.payload.spatial.environment; const malformedBefore = deepHash(malformed); assert.deepEqual(bootstrap.resumeRun(malformed.payload), { ok:false, error:{ code:"RUN_STATE_INVALID" } }); assert.equal(deepHash(malformed), malformedBefore);
  fs.writeFileSync(sessionFile, `${JSON.stringify(malformed, null, 2)}\n`); const damagedPrimary = fs.readFileSync(sessionFile); const validPrevious = fs.readFileSync(sessionBackup); const worldBytes = fs.readFileSync(worldFile);
  const recovering = new DesktopService({ appDataPath:root }); const recovered = recovering.resumeSession({ world_id:created.world.id, mode }); assert.equal(recovered.ok, true); assert.equal(recovered.recovery.session.source, "previous-good-session"); assert.equal(recovering.session(created.world.id, mode).run.spatial.environment.version, "yellow-beast-q4-environment@v1");
  assert.equal(fs.readFileSync(sessionFile).equals(damagedPrimary), true); assert.equal(fs.readFileSync(sessionBackup).equals(validPrevious), true); assert.equal(fs.readFileSync(worldFile).equals(worldBytes), true);

  fs.writeFileSync(sessionBackup, damagedPrimary); const bothDamaged = [fs.readFileSync(sessionFile), fs.readFileSync(sessionBackup), fs.readFileSync(worldFile)]; const rejecting = new DesktopService({ appDataPath:root }); const rejected = rejecting.resumeSession({ world_id:created.world.id, mode }); assert.equal(rejected.ok, false); assert.equal(rejected.error.code, "SESSION_SAVE_DAMAGED"); assert.equal(rejecting.session(created.world.id, mode), null);
  for (const [index, file] of [sessionFile, sessionBackup, worldFile].entries()) assert.equal(fs.readFileSync(file).equals(bothDamaged[index]), true);
});

test("active current Clear-Q4 requires its exact world-owned Standard operator", (t) => {
  const root = temporary(t, "required-standard"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Required Standard", seed:"v03-required-standard" });
  assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-required-standard" }).ok, true); const entry = service.session(created.world.id, mode); const world = service.getWorld(created.world.id); const operator = structuredClone(world.q4_standard_operator); assert.equal(operator.version, standard.VERSION);
  assert.equal(world.events.filter((event) => event.type === "character.instantiated" && event.payload.identity === operator.identity).length, 1);
  assert.equal(standard.recordContact(world, entry.run, { id:"v03-standard-contact", intended_recipient:"Standard", purpose:"check-in", state:"delivered", delivered_at:0 }).ok, true); service.persistSession(world, mode, entry);
  const committed = service.getWorld(created.world.id); const authorityBefore = structuredClone({ standard:committed.q4_standard_operator, character:committed.characters[operator.identity], knowledge:committed.knowledge, q4_knowledge:committed.q4_knowledge }); const eventCountBefore = committed.events.length; const characterCountBefore = Object.keys(committed.characters).length;
  const restarted = new DesktopService({ appDataPath:root }); assert.equal(restarted.resumeSession({ world_id:created.world.id, mode }).ok, true); const restored = restarted.getWorld(created.world.id); assert.deepEqual({ standard:restored.q4_standard_operator, character:restored.characters[operator.identity], knowledge:restored.knowledge, q4_knowledge:restored.q4_knowledge }, authorityBefore); assert.equal(restored.events.length, eventCountBefore); assert.equal(Object.keys(restored.characters).length, characterCountBefore);

  const worldFile = restarted.worldFile(created.world.id); const worldBackup = restarted.backupFile(created.world.id); const sessionFile = restarted.sessionFile(created.world.id, mode); const sessionBackup = restarted.sessionBackupFile(created.world.id, mode); delete restored.q4_standard_operator; const malformedWorld = deepHash(restored); const runBefore = deepHash(restarted.session(created.world.id, mode).run); const preflightArtifacts = [worldFile, worldBackup, sessionFile, sessionBackup].map((file) => fs.readFileSync(file));
  assert.throws(() => restarted.persistSession(restored, mode, restarted.session(created.world.id, mode)), { code:"SESSION_WORLD_STATE_INVALID" }); assert.equal(deepHash(restored), malformedWorld); assert.equal(deepHash(restarted.session(created.world.id, mode).run), runBefore); for (const [index, file] of [worldFile, worldBackup, sessionFile, sessionBackup].entries()) assert.equal(fs.readFileSync(file).equals(preflightArtifacts[index]), true);
  restarted.saveCanonical(restored); const rejectedArtifacts = [worldFile, worldBackup, sessionFile, sessionBackup].map((file) => fs.readFileSync(file)); const malformedWorldBefore = deepHash(restarted.getWorld(created.world.id));
  const rejecting = new DesktopService({ appDataPath:root }); const rejected = rejecting.resumeSession({ world_id:created.world.id, mode }); assert.equal(rejected.ok, false); assert.equal(rejected.error.code, "SESSION_SAVE_DAMAGED"); const stillMalformed = rejecting.getWorld(created.world.id); assert.equal(stillMalformed.q4_standard_operator, undefined); assert.equal(deepHash(stillMalformed), malformedWorldBefore); assert.equal(stillMalformed.events.length, eventCountBefore); assert.equal(Object.keys(stillMalformed.characters).length, characterCountBefore);
  for (const [index, file] of [worldFile, worldBackup, sessionFile, sessionBackup].entries()) assert.equal(fs.readFileSync(file).equals(rejectedArtifacts[index]), true);
  assert.equal(rejecting.restoreBackup({ world_id:created.world.id, confirmed:true }).ok, true); const recovered = new DesktopService({ appDataPath:root }); assert.equal(recovered.resumeSession({ world_id:created.world.id, mode }).ok, true); assert.deepEqual(recovered.getWorld(created.world.id).q4_standard_operator, authorityBefore.standard);
});

test("Q4 presentation and career projection are pure for present and missing career state", (t) => {
  const root = temporary(t, "presentation-purity"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Presentation purity", seed:"v03-presentation-purity" });
  service.createQ4Personnel({ world_id:created.world.id, first_name:"Ira", last_name:"North" }); service.confirmQ4Personnel({ world_id:created.world.id }); service.startSession({ world_id:created.world.id, mode:"field-researcher", seed:"v03-presentation-purity", require_personnel:true });
  const entry = service.session(created.world.id, "field-researcher"); const valid = service.getWorld(created.world.id); const validBefore = deepHash(valid); const runBefore = deepHash(bootstrap.saveRun(entry.run)); career.projection(valid); q4.presentation(entry.run, entry.phase, null, valid); assert.equal(deepHash(valid), validBefore); assert.equal(deepHash(bootstrap.saveRun(entry.run)), runBefore);
  const missing = structuredClone(valid); delete missing.q4_career_state; const missingBefore = deepHash(missing); assert.throws(() => career.projection(missing), { code:"Q4_CAREER_STATE_INVALID" }); assert.throws(() => q4.presentation(entry.run, entry.phase, null, missing), { code:"Q4_CAREER_STATE_INVALID" }); assert.equal(deepHash(missing), missingBefore); assert.equal(deepHash(bootstrap.saveRun(entry.run)), runBefore);
});

test("consequence personnel status is canonical, atomic, and reload-equivalent", () => {
  const run = bootstrap.startRun({ profile:"field-researcher", seed:"v03-consequence-status", spatial_worldpack:"clear-q4" }).run; const target = run.expedition.team.members.find((member) => (member.personnel_id ?? member.id) !== run.session.startup.player.observer_id).personnel_id;
  const before = structuredClone(bootstrap.saveRun(run)); const rejected = consequences.apply(run, { source:"invalid-status", effects:[{ kind:"personnel-condition", target, condition:"minor injury", status:"CONTACT LOST" }] });
  assert.deepEqual(rejected, { ok:false, code:"CONSEQUENCE_PERSONNEL_STATUS_INVALID" }); assert.deepEqual(bootstrap.saveRun(run), before);
  assert.equal(consequences.apply(run, { source:"valid-status", effects:[{ kind:"personnel-condition", target, condition:"serious injury", status:"unavailable" }] }).ok, true);
  const saved = bootstrap.saveRun(run); const restored = bootstrap.resumeRun(saved); assert.equal(restored.ok, true); assert.deepEqual(bootstrap.saveRun(restored.run), saved); assert.equal(restored.run.expedition.team.members.find((member) => member.personnel_id === target).status, "unavailable");
});

test("ecology migration rejects malformed and ambiguous legacy containers without invention", () => {
  const malformed = [[], {}, { evaluated_locations:[] }, { conditions:[] }, { conditions:{}, evaluated_locations:"all" }, { conditions:{}, evaluated_locations:[null] }];
  for (const value of malformed) { const world = legacy("v03-ecology-malformed"); world.q4_phenomenon_ecology = value; const before = structuredClone(world); assert.throws(() => history.migrateWorld(world), { code:"Q4_ECOLOGY_INVALID" }); assert.deepEqual(world, before); }
  const accepted = legacy("v03-ecology-accepted"); accepted.q4_phenomenon_ecology = { conditions:{ recorded:{ id:"recorded", status:"unresolved" } }, evaluated_locations:["utility-room"] }; const migrated = history.migrateWorld(accepted); assert.equal(ecology.state(migrated), migrated.q4_phenomenon_ecology); assert.deepEqual(migrated.q4_phenomenon_ecology.evaluated_locations, ["utility-room"]); assert.deepEqual(migrated.phenomena, {});
});

test("legacy evidence requires explicit access, custody, and provenance", () => {
  const variants = [
    (record) => { delete record.available_to_player; },
    (record) => { record.custody = []; },
    (record) => { delete record.provenance; },
    (record) => { record.creator = record.custody.at(-1).holder; delete record.available_to_player; },
    (record) => { record.provenance = ""; }
  ];
  for (const change of variants) { const world = legacyEvidence("v03-evidence-adversarial"); change(world.evidence["legacy-evidence"]); const before = structuredClone(world); assert.throws(() => history.migrateWorld(world), { code:"EVIDENCE_ARCHIVE_INVALID" }); assert.deepEqual(world, before); }
});

test("failed canonical transaction preserves exact primary, backup, and artifacts", (t) => {
  const root = temporary(t, "transaction-failures"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Transactional", seed:"v03-transactional" }); const seeded = service.getWorld(created.world.id); seeded.q4_scars.seeded = true; service.saveCanonical(seeded);
  const file = service.worldFile(created.world.id); const backup = service.backupFile(created.world.id);
  const attempt = (stage, install) => { const primaryBefore = fs.readFileSync(file); const backupBefore = fs.readFileSync(backup); const world = service.getWorld(created.world.id); world.q4_scars[stage] = true; const restore = install(file, backup); try { assert.throws(() => service.saveCanonical(world)); } finally { restore(); } assert.equal(fs.readFileSync(file).equals(primaryBefore), true); assert.equal(fs.readFileSync(backup).equals(backupBefore), true); assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false); };
  attempt("temp-write", () => { const original = fs.writeFileSync; fs.writeFileSync = (target, ...args) => { if (String(target).endsWith(".tmp")) throw Object.assign(new Error("injected temp write"), { code:"INJECTED_TEMP_WRITE" }); return original(target, ...args); }; return () => { fs.writeFileSync = original; }; });
  attempt("backup-copy", () => { const original = fs.copyFileSync; fs.copyFileSync = (source, target, ...args) => { if (String(target).endsWith(".previous-good." + process.pid + ".tmp")) throw Object.assign(new Error("injected backup copy"), { code:"INJECTED_BACKUP_COPY" }); return original(source, target, ...args); }; return () => { fs.copyFileSync = original; }; });
  attempt("primary-rename", (primary) => { const original = fs.renameSync; fs.renameSync = (source, target) => { if (target === primary && String(source).endsWith(".tmp") && !String(source).includes("previous-good")) throw Object.assign(new Error("injected primary rename"), { code:"INJECTED_PRIMARY_RENAME" }); return original(source, target); }; return () => { fs.renameSync = original; }; });
  attempt("backup-rename", (primary, prior) => { const original = fs.renameSync; fs.renameSync = (source, target) => { if (target === prior) throw Object.assign(new Error("injected backup rename"), { code:"INJECTED_BACKUP_RENAME" }); return original(source, target); }; return () => { fs.renameSync = original; }; });
});

test("failed session transaction preserves exact primary, backup, and artifacts", (t) => {
  const root = temporary(t, "session-transaction"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Session transaction", seed:"v03-session-transaction" }); service.startSession({ world_id:created.world.id, mode:"field-researcher", seed:"v03-session-transaction" }); service.shutdown();
  const mode = "field-researcher"; const file = service.sessionFile(created.world.id, mode); const backup = service.sessionBackupFile(created.world.id, mode); assert.equal(fs.existsSync(backup), true);
  const attempt = (stage, candidate, install) => { const primaryBefore = fs.readFileSync(file); const backupBefore = fs.readFileSync(backup); const restore = install(file, backup); try { assert.throws(() => service.saveSession(created.world.id, mode, candidate)); } finally { restore(); } assert.equal(fs.readFileSync(file).equals(primaryBefore), true); assert.equal(fs.readFileSync(backup).equals(backupBefore), true); assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false); };
  const candidate = JSON.parse(fs.readFileSync(file)); candidate.legacy_flow = !candidate.legacy_flow;
  attempt("validation", { ...candidate, schema:"unsupported" }, () => () => {});
  attempt("backup-copy", candidate, () => { const original = fs.copyFileSync; fs.copyFileSync = (source, target, ...args) => { if (String(target).endsWith(".previous-good." + process.pid + ".tmp")) throw new Error("injected session backup copy"); return original(source, target, ...args); }; return () => { fs.copyFileSync = original; }; });
  attempt("primary-rename", candidate, (primary) => { const original = fs.renameSync; fs.renameSync = (source, target) => { if (target === primary && !String(source).includes("previous-good")) throw new Error("injected session primary rename"); return original(source, target); }; return () => { fs.renameSync = original; }; });
  attempt("backup-rename", candidate, (primary, prior) => { const original = fs.renameSync; fs.renameSync = (source, target) => { if (target === prior) throw new Error("injected session backup rename"); return original(source, target); }; return () => { fs.renameSync = original; }; });
});

test("nested current environment and Survey Frontier state fail closed without repair", (t) => {
  const root = temporary(t, "nested-current"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Nested current", seed:"v03-nested-current" }); assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-nested-current" }).ok, true); service.shutdown();
  const world = service.getWorld(created.world.id); const entry = service.session(created.world.id, mode); const files = [service.worldFile(created.world.id), service.backupFile(created.world.id), service.sessionFile(created.world.id, mode), service.sessionBackupFile(created.world.id, mode)];
  const attempt = (corrupt) => { const artifacts = files.map((file) => fs.readFileSync(file)); const worldBefore = deepHash(world); corrupt(entry.run); const malformedBefore = deepHash(entry.run); assert.throws(() => service.persistSession(world, mode, entry), { code:"RUN_STATE_INVALID" }); assert.equal(deepHash(entry.run), malformedBefore); assert.equal(deepHash(world), worldBefore); files.forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true)); };
  attempt((run) => { run.spatial.environment.locations = {}; });
  const restored = service.restoreSession(world, mode, JSON.parse(fs.readFileSync(files[2]))); assert.ok(restored); Object.assign(entry, restored);
  const player = entry.run.session.startup.player.observer_id; attempt((run) => { delete run.survey_frontier.personnel[player]; });
  const definition = bootstrap.topologyFor(entry.run); const before = deepHash(entry.run.survey_frontier); assert.deepEqual(survey.map(entry.run.survey_frontier, definition, player), { version:"yellow-beast-survey-frontier-map@v1", nodes:[], edges:[], historical_claims:entry.run.survey_frontier.historical.claims.map((claim) => ({ id:claim.id,label:claim.label,status:"PRIOR_RECORD_ONLY",claim_state:claim.state ?? "UNCONFIRMED" })), current_location:null }); assert.equal(deepHash(entry.run.survey_frontier), before);
});

test("current session JSON grammar rejects lossy runtime values atomically", (t) => {
  const root = temporary(t, "session-json-grammar"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Session grammar", seed:"v03-session-grammar" }); assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-session-grammar" }).ok, true); service.shutdown();
  const file = service.sessionFile(created.world.id, mode); const backup = service.sessionBackupFile(created.world.id, mode); const base = JSON.parse(fs.readFileSync(file));
  const sparse = []; sparse.length = 1; const exotic = []; exotic.extra = true; class Custom { constructor() { this.value = 1; } }
  const cycle = {}; cycle.self = cycle; const values = [undefined, NaN, Infinity, -Infinity, () => 1, Symbol("x"), 1n, new Map([["x",1]]), new Set([1]), /x/, new Date(0), new Custom(), cycle, sparse, exotic, Object.create(null)];
  for (const value of values) { const primary = fs.readFileSync(file); const previous = fs.readFileSync(backup); const candidate = structuredClone(base); candidate.payload.interpretation_state = value; assert.throws(() => service.saveSession(created.world.id, mode, candidate), { code:"SESSION_VALUE_INVALID" }); assert.equal(fs.readFileSync(file).equals(primary), true); assert.equal(fs.readFileSync(backup).equals(previous), true); assert.equal(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false); }
});

test("current world requires career state and a declared lifecycle enum", (t) => {
  const root = temporary(t, "world-structure"); const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"World structure", seed:"v03-world-structure" }); const file = service.worldFile(created.world.id); const backup = service.backupFile(created.world.id);
  for (const corrupt of [(world) => { delete world.q4_career_state; }, (world) => { world.q4_lifecycle.status = "BANANA"; }]) { const world = service.getWorld(created.world.id); corrupt(world); const caller = deepHash(world); const primary = fs.readFileSync(file); const previous = fs.existsSync(backup) ? fs.readFileSync(backup) : null; assert.throws(() => service.saveCanonical(world), { code:"WORLD_SHAPE_INVALID" }); assert.equal(deepHash(world), caller); assert.equal(fs.readFileSync(file).equals(primary), true); if (previous) assert.equal(fs.readFileSync(backup).equals(previous), true); }
});

test("Beck and Survey Frontier projections are deep-hash pure", () => {
  const world = history.createWorld({ seed:"v03-read-purity-direct" }); const before = deepHash(world); const projected = desk.projection(world); assert.equal(projected.personnel.length > 0, true); assert.equal(deepHash(world), before); assert.equal(world.management, undefined);
  const run = bootstrap.startRun({ profile:"field-researcher", seed:"v03-survey-read-purity", spatial_worldpack:"clear-q4" }).run; const definition = bootstrap.topologyFor(run); const player = run.session.startup.player.observer_id; delete run.survey_frontier.personnel[player]; const frontierBefore = deepHash(run.survey_frontier); survey.known(run.survey_frontier, player, "threshold-room"); survey.map(run.survey_frontier, definition, player); survey.frontier(run.survey_frontier, definition, player); survey.standardMap(run.survey_frontier, definition); assert.equal(deepHash(run.survey_frontier), frontierBefore); assert.equal(run.survey_frontier.personnel[player], undefined);
});

test("session personnel crossing validates canonical combinations before mutation", (t) => {
  const root = temporary(t, "personnel-boundary"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Personnel boundary", seed:"v03-personnel-boundary" }); assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-personnel-boundary" }).ok, true); const world = service.getWorld(created.world.id); const entry = service.session(created.world.id, mode); const member = entry.run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) !== entry.run.session.startup.player.observer_id); const person = history.character(world, member.personnel_id); const files = [service.worldFile(created.world.id), service.backupFile(created.world.id), service.sessionFile(created.world.id, mode), service.sessionBackupFile(created.world.id, mode)];
  member.condition = "serious injury"; member.health = "serious injury"; member.status = "unavailable"; service.persistSession(world, mode, entry); assert.equal(history.character(world, member.personnel_id).status, "unavailable"); assert.equal(history.character(world, member.personnel_id).condition, "serious injury");
  for (const [status,condition] of [["dead","normal"],["BANANA","normal"],["active","serious injury"]]) { const artifacts = files.map((file) => fs.readFileSync(file)); const canonicalBefore = deepHash(world); const eventsBefore = world.events.length; const currentMember = entry.run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) === member.personnel_id); currentMember.status = status; currentMember.condition = condition; const callerBefore = deepHash(entry); assert.throws(() => service.persistSession(world, mode, entry)); assert.equal(deepHash(entry), callerBefore); assert.equal(deepHash(world), canonicalBefore); assert.equal(world.events.length, eventsBefore); files.forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true)); }
});

test("legacy evidence ambiguity is rejected without consuming the input", () => {
  const changes = [(item) => { item.contradictions = ["legacy-conflict"]; }, (item) => { item.holder = "Standard"; }, (item) => { item.access = "player"; }, (item) => { item.available_to_standard = true; }, (item) => { item.provenance_source = "different-source"; }];
  for (const change of changes) { const world = legacyEvidence("v03-evidence-ambiguity"); change(world.evidence["legacy-evidence"]); const before = structuredClone(world); assert.throws(() => history.migrateWorld(world), { code:"EVIDENCE_ARCHIVE_INVALID" }); assert.deepEqual(world, before); assert.equal(world.q4_evidence_archive, undefined); }
});

test("coordinated world and session commit rolls back every injected filesystem stage", (t) => {
  const root = temporary(t, "pair-transaction"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Pair transaction", seed:"v03-pair-transaction" }); assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-pair-transaction" }).ok, true); service.shutdown();
  const worldFile = service.worldFile(created.world.id); const sessionFile = service.sessionFile(created.world.id, mode); const worldBackup = service.backupFile(created.world.id); const sessionBackup = service.sessionBackupFile(created.world.id, mode); const files = [worldFile,sessionFile,worldBackup,sessionBackup];
  const attempt = (stage, install) => { const world = service.getWorld(created.world.id); const loaded = service.loadSession(world, mode); assert.equal(loaded.ok, true); const entry = loaded.entry; world.q4_scars[stage] = true; entry.run.interpretation_state = { stage }; const callerWorld = deepHash(world); const callerEntry = deepHash(entry); const artifacts = files.map((file) => fs.readFileSync(file)); const restore = install(); try { assert.throws(() => service.persistSession(world, mode, entry)); } finally { restore(); } assert.equal(deepHash(world), callerWorld); assert.equal(deepHash(entry), callerEntry); files.forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true)); assert.equal([...fs.readdirSync(path.dirname(worldFile)),...fs.readdirSync(path.dirname(sessionFile))].some((name) => name.endsWith(".tmp")), false); };
  const failWrite = (fragment) => () => { const original = fs.writeFileSync; fs.writeFileSync = (target,...args) => { if (String(target).includes(fragment)) throw new Error(`injected ${fragment}`); return original(target,...args); }; return () => { fs.writeFileSync = original; }; };
  const failCopy = (fragment) => () => { const original = fs.copyFileSync; fs.copyFileSync = (source,target,...args) => { if (String(target).includes(fragment)) throw new Error(`injected ${fragment}`); return original(source,target,...args); }; return () => { fs.copyFileSync = original; }; };
  const failRename = (targetFile) => () => { const original = fs.renameSync; let fired = false; fs.renameSync = (source,target) => { if (!fired && target === targetFile) { fired = true; throw new Error(`injected rename ${path.basename(targetFile)}`); } return original(source,target); }; return () => { fs.renameSync = original; }; };
  attempt("world-temp", failWrite("pair-world.tmp")); attempt("session-temp", failWrite("pair-session.tmp")); attempt("world-backup", failCopy(`${path.basename(worldBackup)}.`)); attempt("session-backup", failCopy(`${path.basename(sessionBackup)}.`)); attempt("first-primary", failRename(worldFile)); attempt("second-primary", failRename(sessionFile)); attempt("world-backup-update", failRename(worldBackup)); attempt("session-backup-update", failRename(sessionBackup));
});

function injuredPersistencePair(t, name) {
  const root = temporary(t, name); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name, seed:name });
  assert.equal(service.startSession({ world_id:created.world.id, mode, seed:name }).ok, true);
  const world = service.getWorld(created.world.id); const entry = service.session(created.world.id, mode); const player = entry.run.session.startup.player.observer_id; const member = entry.run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) !== player); const identity = member.personnel_id ?? member.id;
  member.condition = "serious injury"; member.health = "serious injury"; member.status = "unavailable"; service.persistSession(world, mode, entry);
  const files = { world:service.worldFile(created.world.id), session:service.sessionFile(created.world.id, mode), worldBackup:service.backupFile(created.world.id), sessionBackup:service.sessionBackupFile(created.world.id, mode) };
  assert.equal(JSON.parse(fs.readFileSync(files.world)).characters[identity].status, "unavailable"); assert.equal(JSON.parse(fs.readFileSync(files.worldBackup)).characters[identity].status, "active");
  return { root, mode, service, worldId:created.world.id, identity, files };
}

test("session-side recovery adopts only the coordinated previous-good pair", (t) => {
  const fixture = injuredPersistencePair(t, "v03-session-pair-recovery"); const before = Object.values(fixture.files).map((file) => fs.readFileSync(file)); fs.writeFileSync(fixture.files.session, "{ damaged current session"); const damaged = fs.readFileSync(fixture.files.session); const recovering = new DesktopService({ appDataPath:fixture.root }); const resumed = recovering.resumeSession({ world_id:fixture.worldId, mode:fixture.mode });
  assert.equal(resumed.ok, true); assert.equal(resumed.recovery.coordinated_pair, true); assert.equal(resumed.recovery.world.source, "previous-good-world"); assert.equal(resumed.recovery.session.source, "previous-good-session");
  const recoveredWorld = recovering.getWorld(fixture.worldId); const recoveredMember = recovering.session(fixture.worldId, fixture.mode).run.expedition.team.members.find((item) => (item.personnel_id ?? item.id) === fixture.identity);
  assert.equal(recoveredWorld.characters[fixture.identity].status, "active"); assert.equal(recoveredMember.status, "active"); assert.notEqual(recoveredWorld.characters[fixture.identity].status, JSON.parse(before[0]).characters[fixture.identity].status);
  assert.equal(fs.readFileSync(fixture.files.session).equals(damaged), true); assert.equal(fs.readFileSync(fixture.files.world).equals(before[0]), true); assert.equal(fs.readFileSync(fixture.files.worldBackup).equals(before[2]), true); assert.equal(fs.readFileSync(fixture.files.sessionBackup).equals(before[3]), true);
});

test("automatic coordinated recovery followed by shutdown cannot erase a committed injury", (t) => {
  const fixture = injuredPersistencePair(t, "v03-recovery-shutdown"); fs.writeFileSync(fixture.files.session, "{ damaged current session"); const artifacts = Object.values(fixture.files).map((file) => fs.readFileSync(file)); const primary = JSON.parse(artifacts[0]); const events = primary.events.length; const recovering = new DesktopService({ appDataPath:fixture.root }); assert.equal(recovering.resumeSession({ world_id:fixture.worldId, mode:fixture.mode }).ok, true); recovering.shutdown();
  Object.values(fixture.files).forEach((file, index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true)); const after = JSON.parse(fs.readFileSync(fixture.files.world)); assert.equal(after.characters[fixture.identity].status, "unavailable"); assert.equal(after.characters[fixture.identity].condition, "serious injury"); assert.equal(after.events.length, events);
});

test("automatic coordinated recovery rejects mutation before changing recovered caller state", (t) => {
  const fixture = injuredPersistencePair(t, "v03-recovery-read-only"); fs.writeFileSync(fixture.files.session, "{ damaged current session"); const recovering = new DesktopService({ appDataPath:fixture.root }); assert.equal(recovering.resumeSession({ world_id:fixture.worldId, mode:fixture.mode }).ok, true);
  const beforeWorld = JSON.stringify(recovering.getWorld(fixture.worldId)); const beforeSession = JSON.stringify(recovering.session(fixture.worldId, fixture.mode)); const artifacts = Object.values(fixture.files).map((file) => fs.readFileSync(file)); const rejected = recovering.submitAction({ world_id:fixture.worldId, mode:fixture.mode, action:"READY" });
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, "PERSISTENCE_RECOVERY_READ_ONLY"); assert.equal(JSON.stringify(recovering.getWorld(fixture.worldId)), beforeWorld); assert.equal(JSON.stringify(recovering.session(fixture.worldId, fixture.mode)), beforeSession); Object.values(fixture.files).forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true));
});

test("explicit previous-good restoration replaces a compatible world and session together", (t) => {
  const fixture = injuredPersistencePair(t, "v03-explicit-pair-restore"); const restored = fixture.service.restoreBackup({ world_id:fixture.worldId, confirmed:true }); assert.equal(restored.ok, true); const world = JSON.parse(fs.readFileSync(fixture.files.world)); const session = JSON.parse(fs.readFileSync(fixture.files.session)); const member = session.payload.expedition.team.members.find((item) => (item.personnel_id ?? item.id) === fixture.identity);
  assert.equal(world.characters[fixture.identity].status, "active"); assert.equal(member.status, "active"); assert.equal(world.persistence_pairs[fixture.mode].id, session.persistence_pair.id);
});

test("incompatible explicit recovery rejects without changing any canonical artifact", (t) => {
  const fixture = injuredPersistencePair(t, "v03-explicit-pair-reject"); fs.writeFileSync(fixture.files.sessionBackup, "{ damaged previous session"); const artifacts = Object.values(fixture.files).map((file) => fs.readFileSync(file)); const restored = fixture.service.restoreBackup({ world_id:fixture.worldId, confirmed:true }); assert.equal(restored.ok, false); assert.equal(restored.error.code, "BACKUP_PAIR_INCOMPATIBLE"); Object.values(fixture.files).forEach((file, index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true));
});

test("reproduced malformed current structures are rejected before persistence", (t) => {
  const root = temporary(t, "v03-reproduced-current-validation"); const mode = "field-researcher"; const service = new DesktopService({ appDataPath:root }); const created = service.createWorld({ name:"Current validation", seed:"v03-current-validation" }); assert.equal(service.startSession({ world_id:created.world.id, mode, seed:"v03-current-validation" }).ok, true); service.shutdown();
  const files = [service.worldFile(created.world.id), service.sessionFile(created.world.id, mode), service.backupFile(created.world.id), service.sessionBackupFile(created.world.id, mode)];
  const rejectWorld = (corrupt) => { const artifacts = files.map((file) => fs.readFileSync(file)); const world = service.getWorld(created.world.id); corrupt(world); assert.throws(() => service.saveCanonical(world)); files.forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true)); };
  rejectWorld((world) => { Object.values(world.characters)[0].status = "BANANA"; });
  rejectWorld((world) => { const person = Object.values(world.characters)[0]; person.status = "dead"; person.condition = "normal"; });
  rejectWorld((world) => { world.q4_standard_operator.contacts = {}; world.q4_standard_operator.revealed = "yes"; });
  rejectWorld((world) => { world.q4_career_state.operation_history = [null]; world.q4_career_state.cycles.bad = null; });
  rejectWorld((world) => { world.q4_geography.environment.history = [null]; world.q4_geography.environment.conditions.bad = null; });
  rejectWorld((world) => { world.q4_phenomenon_ecology.conditions.bad = null; });
  rejectWorld((world) => { world.events.push(null); });
  const world = service.getWorld(created.world.id); const loaded = service.loadSession(world, mode); assert.equal(loaded.ok, true); loaded.entry.run.lifecycle = "BANANA"; const artifacts = files.map((file) => fs.readFileSync(file)); assert.throws(() => service.persistSession(world, mode, loaded.entry), { code:"RUN_STATE_INVALID" }); files.forEach((file,index) => assert.equal(fs.readFileSync(file).equals(artifacts[index]), true));
});
