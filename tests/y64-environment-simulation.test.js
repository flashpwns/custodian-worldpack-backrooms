"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const history = require("../tools/world-history");
const bootstrap = require("../tools/run-bootstrap");
const environment = require("../tools/q4-environment");
const communications = require("../tools/communication-runtime");
const assignments = require("../tools/q4-assignment-engine");
const evidence = require("../tools/q4-evidence-authority");
const media = require("../tools/q4-evidence-media");

function fixture(seed = "environment") {
  const world = history.createWorld({ seed });
  const started = bootstrap.startRun({ profile:"field-researcher", seed:`${seed}-run`, scenario:"procedural-survey", world, spatial_worldpack:"clear-q4" });
  assert.equal(started.ok, true); return { world, run:started.run };
}
function radio(run, text = "Report relay power loss") {
  return communications.queueRadio(run, bootstrap.dynamicsDefinitionFor(run.spatial_pack_id), { sender:run.session.startup.player.observer_id, text, environment_condition_ids:["environment-power:relay-circuit"] });
}

test("power cascades through canonical lighting and communications without informing Standard", () => {
  const { run } = fixture("power-cascade"); const env = run.spatial.environment;
  assert.equal(environment.current(env, "relay-alcove").lighting, "intermittent");
  environment.mutatePower(env, "relay-circuit", "unavailable", { at:3, source:"test" });
  assert.equal(environment.current(env, "relay-alcove").lighting, "dark"); assert.equal(environment.coverage(env, "relay-alcove"), "unavailable");
  run.spatial.player_location = "relay-alcove"; run.spatial.personnel_locations[run.session.startup.player.observer_id] = "relay-alcove";
  const queued = radio(run); const cycle = bootstrap.resolveOperationalCycle(run, "COMMUNICATE", 1, "test");
  assert.equal(run.expedition.messages.find((item) => item.id === queued.message.id).state, "failed");
  assert.equal(env.conditions["environment-power:relay-circuit"].institutional_available, false); assert.ok(cycle.public_updates.some((item) => item.kind === "scheduled-event"));
  const snapshot = bootstrap.saveRun(run); const resumed = bootstrap.resumeRun(snapshot, { world:run._world, spatial_worldpack:"clear-q4" }); assert.equal(resumed.ok, true);
  assert.equal(environment.current(resumed.run.spatial.environment, "relay-alcove").lighting, "dark");
});

test("restoration preserves environment history and unrelated local conditions", () => {
  const { run } = fixture("restoration"); const env = run.spatial.environment;
  const prior = environment.current(env, "records-annex"); environment.mutatePower(env, "relay-circuit", "unavailable", { at:2, source:"test" }); const count = env.history.length;
  environment.mutatePower(env, "relay-circuit", "normal", { at:4, source:"service" });
  assert.equal(environment.current(env, "relay-alcove").lighting, "intermittent"); assert.deepEqual(environment.current(env, "records-annex"), prior); assert.ok(env.history.length > count);
});

test("blocked routes retain topology, become reportable work only after delivery, and persist", () => {
  const { world, run } = fixture("structural"); const connection = "utility-to-passage";
  environment.blockRoute(run.spatial, connection, { at:2, source:"test" });
  assert.ok(bootstrap.topologyFor(run).connections.some((item) => item.id === connection));
  assert.equal(bootstrap.act(run, "MOVE", connection).ok, false);
  const condition = run.spatial.environment.conditions[`environment-route:${connection}`]; assert.equal(assignments.deriveConditions(world).some((item) => item.source_condition.institutional_fact?.condition_id === condition.id), false);
  environment.report(run.spatial.environment, [condition.id], { message_id:"delivered-test", at:3 }); world.q4_geography = require("../tools/spatial-runtime").canonicalSnapshot(run.spatial);
  assert.ok(assignments.deriveConditions(world).some((item) => item.source_condition.institutional_fact?.condition_id === condition.id));
  const restored = bootstrap.resumeRun(bootstrap.saveRun(run), { world, spatial_worldpack:"clear-q4" }); assert.ok(restored.run.spatial.blocked_paths[connection]);
});

test("lighting affects observation without exposing new facts and field light mitigates it", () => {
  const { run } = fixture("observation"); const env = run.spatial.environment;
  environment.mutatePower(env, "relay-circuit", "unavailable", { at:2, source:"test" });
  assert.equal(environment.observation(env, "relay-alcove", { has_field_light:false }).visibility, "limited");
  assert.equal(environment.observation(env, "relay-alcove", { has_field_light:true }).visibility, "field-light-assisted");
  assert.equal(Object.hasOwn(environment.observation(env, "relay-alcove"), "hidden_entities"), false);
});

test("evidence fixes observed environmental capture context while later mutations remain current-only", () => {
  const { world, run } = fixture("evidence-context"); const env = run.spatial.environment;
  environment.mutatePower(env, "relay-circuit", "unavailable", { at:2, source:"test" }); run.spatial.player_location = "relay-alcove";
  const item = { id:"environment-photo", type:"photograph", source_location:"relay-alcove", source_location_name:"Relay Alcove", creator:run.session.startup.player.observer_id, captured_at:{ interval:2 }, environmental_conditions:environment.captureContext(env, "relay-alcove"), target_observation:"relay fixture", visible_objects:["relay fixture"] };
  const record = evidence.capture(world, run, item); environment.mutatePower(env, "relay-circuit", "normal", { at:3, source:"service" });
  assert.equal(record.environmental_conditions.lighting, "dark"); assert.equal(media.validateSpec(record).environment.lighting, "dark"); assert.equal(environment.current(env, "relay-alcove").lighting, "intermittent");
});

test("environment initialization is deterministic, observer-safe, and migrates old canonical geography conservatively", () => {
  const one = fixture("same").run.spatial.environment; const two = fixture("same").run.spatial.environment;
  assert.deepEqual(one.locations, two.locations); assert.equal(environment.current(one, "records-annex").communications, "weak");
  const legacy = fixture("legacy").run; delete legacy.spatial.environment; const resumed = bootstrap.resumeRun(bootstrap.saveRun(legacy), { spatial_worldpack:"clear-q4" });
  assert.equal(environment.current(resumed.run.spatial.environment, "utility-room").structural, "stable");
});
