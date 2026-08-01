"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const bootstrap = require("../tools/run-bootstrap");
const logistics = require("../tools/logistics-runtime");
const institution = require("../tools/institutional-runtime");
const operationalTime = require("../tools/operational-time");
const consequences = require("../tools/consequence-runtime");
const hazards = require("../tools/hazard-runtime");
const authoring = require("../tools/worldpack-authoring");
const presentation = require("../tools/scene-presentation");
const surfaces = require("../desktop/renderer/surfaces");

const root = path.resolve(__dirname, "..");
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const logisticsDefinition = read("data/worldpacks/clear-q4/logistics.json");
const institutionDefinition = read("data/worldpacks/clear-q4/institution.json");
const dynamicsDefinition = read("data/worldpacks/clear-q4/dynamics.json");
const missionDefinition = read("data/worldpacks/clear-q4/mission.json");
const operationDefinition = read("data/worldpacks/clear-q4/operation.json");

function fixture(t, seed = "omnipass") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-omnipass-"));
  const service = new DesktopService({ appDataPath, developerMode: true, logger() {} });
  const world = service.createWorld({ name: "Omnipass test", seed: `${seed}-world` }).world;
  const started = service.startSession({ world_id: world.id, mode: "field-researcher", seed });
  assert.equal(started.ok, true);
  t.after(() => { service.shutdown(); fs.rmSync(appDataPath, { recursive: true, force: true }); });
  return { appDataPath, service, world, projection: started.projection };
}

function action(service, world, verb, target = null) {
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: verb, target });
  assert.equal(result.ok, true, `${verb}: ${result.error?.message ?? result.error?.code ?? "rejected"}`);
  return result;
}

function runContext(run) {
  const player = run.session.startup.player.observer_id;
  return { player, actor: player, team: run.expedition.team.members, spatial: run.spatial, location: run.spatial.player_location, at: run.expedition.clock.interval, restrictions: [] };
}

test("Clear-Q4, the minimal pack, and the independent fixture validate as generic complete operations", () => {
  for (const pack of ["clear-q4", "minimal-mission", "authoring-fixture"]) {
    const result = authoring.validate(pack);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.ok(result.counts.locations >= 2);
    assert.ok(result.counts.containers >= 1);
    assert.ok(result.counts.institutional_rules >= 1);
  }
  assert.equal(authoring.load("authoring-fixture").records.operation.worldpack_id, "authoring-fixture");
});

test("authoring create, preview, trace, and focused test are deterministic and reject a broken pack with source paths", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "yb-authoring-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const pack = path.join(temporary, "fixture-copy");
  assert.equal(authoring.create(pack, "fixture-copy").valid, true);
  const preview = authoring.preview(pack);
  assert.equal(preview.valid, true);
  assert.match(preview.html, /DEVELOPER PREVIEW .* INTERNAL TRUTH/);
  assert.match(preview.html, /Map graph/);
  const first = authoring.diagnostic(pack, "stable-seed");
  const repeated = authoring.diagnostic(pack, "stable-seed");
  assert.deepEqual(repeated, first);
  assert.equal(authoring.test(pack, "stable-seed").passed, true);
  const spatialFile = path.join(pack, "spatial.json");
  const spatial = JSON.parse(fs.readFileSync(spatialFile, "utf8"));
  spatial.connections = [];
  fs.writeFileSync(spatialFile, `${JSON.stringify(spatial, null, 2)}\n`);
  const broken = authoring.validate(pack);
  assert.equal(broken.valid, false);
  assert.ok(broken.errors.some((item) => item.code === "UNREACHABLE_LOCATION" && item.file.endsWith("spatial.json") && item.path));
  assert.ok(broken.errors.some((item) => item.code === "IMPOSSIBLE_RETURN_ROUTE"));
});

test("Standard accepts only institutionally available information and silence only after a missed expectation", () => {
  const world = {};
  const expedition = { id: "institution-boundary", clock: { interval: 0 }, team: { members: [{ personnel_id: "field-operator" }] }, messages: [{ id: "failed-report", sender: "field-operator", intended_recipient: "Standard", state: "failed", purpose: "routine-report", text: "Unreceived condition report." }], communications: { check_ins: [] } };
  const run = { _world: world, expedition };
  assert.deepEqual(institution.ingestDeliveredCommunications(run, institutionDefinition), []);
  assert.equal(institution.ensure(world, institutionDefinition).confirmed_knowledge.length, 0);
  assert.throws(() => institution.ingest(world, expedition, institutionDefinition, { type: "normal-report", state: "queued", summary: "Not delivered.", provenance: { kind: "communication", id: "queued-report" } }), /undelivered/);
  assert.throws(() => institution.ingest(world, expedition, institutionDefinition, { type: "silence", state: "overdue", summary: "Not yet missed.", provenance: { kind: "missed-expectation", id: "overdue-report" } }), /missed expectation/);
  const accepted = institution.ingest(world, expedition, institutionDefinition, { type: "normal-report", purpose: "routine-report", state: "delivered", quality: "claim", summary: "Delivered status report.", provenance: { kind: "communication", id: "delivered-report" } });
  assert.equal(accepted.accepted, true);
  assert.equal(world.institutional_response.uncertain_claims.length, 1);
  assert.equal(world.institutional_response.confirmed_knowledge.length, 0, "an uncorroborated field claim is not silently promoted to confirmed truth");
});

test("institutional responses are scheduled, resolve once through the shared event queue, and persist provenance", () => {
  const world = {};
  const expedition = { id: "institution-events", clock: { interval: 0 }, team: { members: [{ personnel_id: "field-operator" }] }, messages: [], communications: { check_ins: [] } };
  const run = { _world: world, expedition };
  const accepted = institution.ingest(world, expedition, institutionDefinition, { type: "normal-report", purpose: "routine-report", state: "delivered", quality: "recorded", summary: "Recorded status delivered.", provenance: { kind: "communication", id: "event-report" } });
  assert.equal(accepted.scheduled.length, 1);
  assert.equal(world.institutional_response.decisions.length, 0);
  assert.equal(operationalTime.resolveDue(expedition, (event) => institution.handleEvent(run, institutionDefinition, event)).length, 0);
  operationalTime.advance(expedition, 1, "test-action");
  const resolved = operationalTime.resolveDue(expedition, (event) => institution.handleEvent(run, institutionDefinition, event));
  assert.equal(resolved.length, 1);
  assert.equal(world.institutional_response.decisions.length, 1);
  assert.equal(world.institutional_response.transition_history[0].triggering_evidence.id, "event-report");
  assert.equal(operationalTime.resolveDue(expedition, (event) => institution.handleEvent(run, institutionDefinition, event)).length, 0);
  assert.equal(expedition.messages.at(-1).state, "delivered");
});

test("institutional dimensions, restrictions, confirmed unavailability, and follow-ups survive closure", () => {
  const world = {};
  const run = { run_id: "closure-run", expedition: { clock: { interval: 17 }, mission_state: { final_result: { mission_id: "clear-q4-field-survey", classification: "personnel-loss" } } } };
  const review = { mission_id: "clear-q4-field-survey", outcome: "personnel-loss", public_debrief_summary: "The return record confirms a personnel loss.", personnel: [{ identity: "personnel-unavailable", display_name: "Assigned specialist", status: "deceased" }], equipment: [{ id: "survey-instrument", label: "Survey instrument", status: "missing" }], containers: [], evidence: [], evidence_outcome: { retained: 0, reported: 0 } };
  const result = institution.ingestClosure(world, institutionDefinition, run, review);
  assert.equal(result.accepted, true);
  assert.ok(world.institutional_response.unavailable_personnel.includes("personnel-unavailable"));
  assert.ok(world.institutional_response.follow_up_assignments.some((item) => item.id === "q4-accountability-review"));
  institution.advance(world, institutionDefinition, 1);
  assert.equal(world.institutional_response.dimensions.staffing_posture, "reinforced");
  assert.ok(world.institutional_response.input_history.some((item) => item.type === "equipment-loss"));
  const persisted = structuredClone(world.institutional_response);
  assert.deepEqual(institution.ensure({ institutional_response: structuredClone(persisted) }, institutionDefinition), persisted);
});

test("logistics performs the complete custody loop transactionally without duplication", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "logistics-loop", spatial_worldpack: "clear-q4" }).run;
  bootstrap.setSpatialPhase(run, "STAGING");
  const context = runContext(run); const player = context.player; const coworker = context.team.find((member) => member.personnel_id !== player).personnel_id;
  const execute = (action, item_id, extra = {}) => logistics.transact(run.expedition, logisticsDefinition, { action, item_id, actor: player, ...extra }, { ...context, at: run.expedition.clock.interval });
  assert.equal(execute("INSPECT", "field-light").ok, true);
  assert.equal(execute("EQUIP", "field-light").ok, true);
  assert.equal(execute("USE", "field-light").ok, true);
  assert.equal(execute("UNEQUIP", "field-light").ok, true);
  assert.equal(execute("STORE", "field-light", { target_container: "field-case" }).ok, true);
  assert.equal(execute("RETRIEVE", "field-light").ok, true);
  assert.equal(execute("HAND_OVER", "field-light", { target_holder: coworker }).ok, true);
  assert.equal(execute("RECEIVE", "field-light", { target_holder: coworker }).ok, true);
  assert.equal(execute("DROP", "field-light").ok, true);
  assert.equal(execute("RECOVER", "field-light").ok, true);
  assert.equal(execute("VERIFY", "field-light").ok, true);
  assert.equal(execute("RECONCILE", "field-light").ok, true);
  assert.equal(execute("RETRIEVE", "evidence-sleeves").ok, true);
  const beforeSupply = run.expedition.logistics.items["evidence-sleeves"].charges;
  assert.equal(execute("CONSUME", "evidence-sleeves").ok, true);
  assert.equal(run.expedition.logistics.items["evidence-sleeves"].charges, beforeSupply - 1);
  const instances = Object.values(run.expedition.logistics.items).map((item) => item.instance_id);
  assert.equal(new Set(instances).size, instances.length);
  assert.equal(logistics.validateState(run.expedition.logistics), true);
});

test("container access, capacity, loss, recovery, and rollback are authoritative", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "container-loop", spatial_worldpack: "clear-q4" }).run;
  bootstrap.setSpatialPhase(run, "STAGING"); const context = runContext(run); const player = context.player;
  const item = (action, item_id, extra = {}) => logistics.transact(run.expedition, logisticsDefinition, { action, item_id, actor: player, ...extra }, context);
  const container = (action, container_id) => logistics.transactContainer(run.expedition, logisticsDefinition, { action, container_id, actor: player }, context);
  assert.equal(container("CLOSE_CONTAINER", "field-case").ok, true);
  const snapshot = structuredClone(run.expedition.logistics);
  const inaccessible = item("STORE", "field-light", { target_container: "field-case" });
  assert.equal(inaccessible.ok, false);
  assert.equal(inaccessible.code, "CONTAINER_INACCESSIBLE");
  assert.deepEqual(run.expedition.logistics, snapshot, "a rejected transaction commits no partial custody mutation");
  assert.equal(container("OPEN_CONTAINER", "field-case").ok, true);
  assert.equal(item("STORE", "field-light", { target_container: "field-case" }).ok, true);
  assert.equal(container("LOSE_CONTAINER", "field-case").ok, true);
  assert.equal(run.expedition.logistics.items["field-light"].condition, "lost");
  assert.equal(container("RECOVER_CONTAINER", "field-case").ok, true);
  assert.equal(run.expedition.logistics.items["field-light"].condition, "operational");
  const invalid = structuredClone(logisticsDefinition); invalid.containers.push({ id: "nested-a", display_name: "A", kind: "field-case", capacity: 2, allowed_categories: ["*"], parent_container: "field-case" }, { id: "nested-b", display_name: "B", kind: "field-case", capacity: 2, allowed_categories: ["*"], parent_container: "nested-a" });
  assert.throws(() => logistics.validateDefinition(invalid), /nesting exceeds one level/);
});

test("logistics state, histories, containers, and institutional state survive exact save and resume", () => {
  const world = {};
  const started = bootstrap.startRun({ profile: "field-researcher", seed: "omnipass-persistence", spatial_worldpack: "clear-q4" });
  const run = started.run; run._world = world; institution.ensure(world, institutionDefinition); bootstrap.setSpatialPhase(run, "STAGING"); const context = runContext(run);
  assert.equal(logistics.transact(run.expedition, logisticsDefinition, { action: "DROP", item_id: "field-light", actor: context.player }, context).ok, true);
  institution.ingest(world, run.expedition, institutionDefinition, { type: "equipment-loss", state: "confirmed", summary: "Returned issue record confirms a loss.", provenance: { kind: "recovered-equipment-record", id: "persistent-loss" } });
  const before = { logistics: structuredClone(run.expedition.logistics), institution: structuredClone(world.institutional_response) };
  const resumed = bootstrap.resumeRun(bootstrap.saveRun(run), { world, spatial_worldpack: "clear-q4", phase: "STAGING" });
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.run.expedition.logistics, before.logistics);
  assert.deepEqual(world.institutional_response, before.institution);
  assert.equal(bootstrap.resumeRun({ ...bootstrap.saveRun(run), version: "yellow-beast-save@v999" }, { world }).error.code, "SAVE_VERSION_UNSUPPORTED");
});

test("the inventory interface is a keyboard-operable observer projection with contextual and full-list parity", (t) => {
  const { service, world } = fixture(t, "inventory-interface");
  const staging = action(service, world, "READY").projection;
  const html = surfaces.render(staging);
  assert.match(html, /data-testid="full-inventory"/);
  assert.match(html, /role="toolbar"/);
  assert.match(html, /All item actions and unavailable reasons/);
  assert.match(html, /type="button" class="logistics-action/);
  assert.match(html, /aria-label="[^"]+"/);
  assert.match(html, /data-testid="institutional-response"/);
  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.match(visibleText, /Battery field lamp/);
  assert.doesNotMatch(visibleText, /field-light|player-harness|predicate|state path/i);
  assert.ok(staging.q4.inventory.items.every((item) => item.actions.filter((entry) => entry.available).slice(0, 6).length <= 6));
  const snapshot = service.getDeveloperSnapshot({ world_id: world.id, mode: "field-researcher" });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.snapshot.active?.simulation_truth, undefined);
  assert.equal(snapshot.active.simulation_truth.developer_only, true);
  assert.ok(snapshot.active.simulation_truth.item_custody["field-light"]);
});

test("Clear-Q4 has a complete arc, multiple purposeful routes, distinct hazards, and every required outcome family", () => {
  const spatial = read("data/worldpacks/clear-q4/spatial.json");
  const categories = new Set(dynamicsDefinition.hazards.map((item) => item.category));
  assert.ok(spatial.locations.length >= 12);
  assert.ok(spatial.connections.some((item) => item.id === "bypass-to-entry"));
  assert.ok(spatial.connections.some((item) => item.id === "corridor-to-relay"));
  assert.ok(categories.has("structural") && categories.has("electrical"));
  assert.ok(operationDefinition.mission_arc.map((item) => item.id).includes("escalation"));
  assert.ok(operationDefinition.meaningful_choices.length >= 5);
  const required = new Set(["clean-completion", "enhanced-completion", "recovered-complication", "degraded-completion", "controlled-abort", "mission-failure", "personnel-loss"]);
  const authored = new Set(missionDefinition.mission.outcome_rules.map((item) => item.classification));
  assert.deepEqual([...required].filter((item) => !authored.has(item)), []);
  assert.deepEqual([...required].filter((item) => !operationDefinition.outcome_families.some((outcome) => outcome.mission_classification === item)), []);
});

test("authored relay recovery is partial, atomic, and leaves its serious equipment consequence truthful", () => {
  const run = bootstrap.startRun({ profile: "field-researcher", seed: "relay-recovery", spatial_worldpack: "clear-q4" }).run;
  const player = run.session.startup.player.observer_id; run.spatial.personnel_locations[player] = "relay-alcove"; run.spatial.player_location = "relay-alcove";
  const applied = consequences.apply(run, { source: "relay-isolation-fault", effects: [{ kind: "equipment-state", target: "survey-instrument", state: "disabled" }, { kind: "route-blocked", connection_id: "corridor-to-relay", state: "temporarily-blocked" }] });
  assert.equal(applied.ok, true);
  const hook = read("data/worldpacks/clear-q4/interactions.json").objects.find((item) => item.id === "relay-service-unit").hazard_hooks[0];
  const recovered = hazards.applyInteractionHook(run, dynamicsDefinition, hook, "repair", player);
  assert.equal(recovered.ok, true);
  assert.equal(run.spatial.blocked_paths["corridor-to-relay"], undefined);
  assert.equal(run.expedition.logistics.items["survey-instrument"].condition, "disabled");
  assert.ok(run.expedition.operational.consequences.some((record) => record.classification === "recovered-complication"));
});

test("AI-assisted prose is presentation-only and rejected when it invents operational truth", () => {
  const scene = { scene_type: "observation", location: "relay alcove", safe_facts: [{ id: "visible-unit", category: "visible", text: "The visible service unit is quiet." }], immediate_changes: [], context: [] };
  assert.equal(presentation.validateNarration(scene, { prose: "The visible service unit is quiet.", referenced_safe_fact_ids: ["visible-unit"] }).ok, true);
  assert.equal(presentation.validateNarration(scene, { prose: "Standard confirmed delivery and the nonexistent route is safe.", referenced_safe_fact_ids: ["visible-unit"] }).ok, false);
  assert.match(presentation.fallbackNarration(scene), /service unit/i);
});

test("new production worldpack content has no fixed legacy identity or fixed two-coworker assumption", () => {
  for (const pack of ["clear-q4", "minimal-mission", "authoring-fixture"]) {
    const loaded = authoring.load(pack);
    const content = JSON.stringify(loaded.records);
    assert.doesNotMatch(content, /\b(?:Alex|Nora)\b/);
    assert.ok(loaded.records.dynamics.staffing.minimum_total >= 3);
    assert.ok(loaded.records.dynamics.staffing.maximum_total <= 5);
    assert.ok(loaded.records.dynamics.staffing.coworker_roles.length >= 2);
  }
});
