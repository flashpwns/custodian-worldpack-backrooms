"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const surveyFrontier = require("../tools/survey-frontier");
const spatialRuntime = require("../tools/spatial-runtime");
const surfaces = require("../desktop/renderer/surfaces");
const bootstrap = require("../tools/run-bootstrap");

test("y95 — prior direct observation stays historical instead of becoming current-run traversal", () => {
  const definition = {
    locations: [{ id:"old-room", name:"Old Room", type:"room", coordinates:{ x:0, y:0 } }],
    connections: []
  };
  const knowledge = {
    locations: { "old-room": { state:"OBSERVED", provenance:[{ source:"direct-observation", direct:true, at:2 }] } },
    connections: {}
  };
  const projected = surveyFrontier.map({ personnel:{ observer:knowledge }, standard:{ locations:{}, connections:{} }, historical:{ claims:[] } }, definition, "observer", { visited_locations:[] });
  assert.equal(projected.nodes[0].visited, true, "Historical direct observation remains part of personnel knowledge");
  assert.equal(projected.nodes[0].visited_this_expedition, false, "Historical observation must not imply traversal in a new run");
});

test("y95 — Map Knowledge Provenance Contract: Movement, Revisit, Inherited Knowledge, and Cold Restart", () => {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-map-provenance-"));
  let service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "procedural-survey"
  });

  const world = service.createWorld({ name: "Map Provenance Test World", seed: "provenance-test-seed" }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Devon", last_name: "Vance" }).ok, true);
  assert.equal(service.confirmQ4Personnel({ world_id: world.id }).ok, true);

  const started = service.startSession({ world_id: world.id, mode: "field-researcher", require_personnel: true });
  assert.equal(started.ok, true);

  // Advance through prefield to field operation
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true); // to Staging
  assert.equal(service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" }).ok, true); // to Threshold Approach
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" }).ok, true); // to Threshold Room
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" }).ok, true); // to STANDARD_RADIO_CHECK
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for outside the Threshold. Radio check." }).ok, true);
  const crossed = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }); // into Utility Room
  assert.equal(crossed.ok, true);

  let entry = service.session(world.id, "field-researcher");
  let run = entry.run;
  const playerId = run.session.startup.player.observer_id;

  // Inject an inherited ASYNC knowledge location without direct observation/traversal
  const inheritedLocId = "relay-alcove";
  const pRecord = run.survey_frontier.personnel[playerId];
  pRecord.locations[inheritedLocId] = {
    state: "PARTIALLY_OBSERVED",
    provenance: [{ source: "legacy-spatial-record", at: 0, direct: false }]
  };

  // 1. Initial State Check (Utility Room)
  let proj = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  let mapNodes = proj.q4.map.nodes;
  let utilityNode = mapNodes.find((n) => n.id === "utility-room");
  let inheritedNode = mapNodes.find((n) => n.id === inheritedLocId);

  assert.ok(utilityNode, "Utility room node must exist in map");
  assert.ok(inheritedNode, "Inherited relay alcove node must exist in map");

  assert.equal(utilityNode.current, true, "Utility room must be current");
  assert.equal(utilityNode.visited, true, "Utility room must be visited");
  assert.equal(utilityNode.visited_this_expedition, true, "Utility room visited_this_expedition must be true");

  assert.equal(inheritedNode.current, false, "Inherited node must NOT be current");
  assert.equal(inheritedNode.visited, false, "Inherited node must NOT be marked visited");
  assert.equal(inheritedNode.visited_this_expedition, false, "Inherited node visited_this_expedition must be false");

  // Render HTML surface and inspect CSS classes
  let html = surfaces.render(proj);
  assert.match(html, /operational-node map-current-node node-observed-now[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Utility Room<\/text>/, "Current location must have map-current-node node-observed-now (Green)");
  assert.match(html, /operational-node map-async-node node-inherited-async[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Relay Alcove<\/text>/, "Unvisited inherited location must have map-async-node node-inherited-async (Light Blue)");

  // 2. Actual Movement: Move from Utility Room to Columned Corridor
  const moveRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "WEST — Columned Corridor" });
  assert.equal(moveRes.ok, true, `Move should succeed: ${moveRes.result?.public_reason}`);

  proj = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  mapNodes = proj.q4.map.nodes;
  utilityNode = mapNodes.find((n) => n.id === "utility-room");
  let corridorNode = mapNodes.find((n) => n.id === "columned-corridor");
  inheritedNode = mapNodes.find((n) => n.id === inheritedLocId);

  // Utility Room is now vacated (visited this expedition, but not current)
  assert.equal(utilityNode.current, false, "Utility room is no longer current after moving");
  assert.equal(utilityNode.visited, true, "Utility room must remain visited");
  assert.equal(utilityNode.visited_this_expedition, true, "Utility room must remain visited_this_expedition");

  // Columned Corridor is now current and visited
  assert.equal(corridorNode.current, true, "Columned corridor must now be current");
  assert.equal(corridorNode.visited, true, "Columned corridor must now be visited");
  assert.equal(corridorNode.visited_this_expedition, true, "Columned corridor must now be visited_this_expedition");

  // Inherited Relay Alcove remains unvisited
  assert.equal(inheritedNode.current, false);
  assert.equal(inheritedNode.visited, false);

  // Check HTML classes after move
  html = surfaces.render(proj);
  assert.match(html, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Utility Room<\/text>/, "Vacated Utility Room must now have map-visited-node node-visited-expedition (Cream)");
  assert.match(html, /operational-node map-current-node node-observed-now[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Columned Corridor<\/text>/, "Current Columned Corridor must have map-current-node node-observed-now (Green)");
  assert.match(html, /operational-node map-async-node node-inherited-async[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Relay Alcove<\/text>/, "Unvisited Relay Alcove remains Light Blue");

  // 3. Move into the previously inherited location: Relay Alcove
  const moveRes2 = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "WEST — Relay Alcove" });
  assert.equal(moveRes2.ok, true, `Move to Relay Alcove should succeed: ${moveRes2.result?.public_reason}`);

  // Inject another unvisited inherited location: "service-bypass"
  run = service.session(world.id, "field-researcher").run;
  run.survey_frontier.personnel[playerId].locations["service-bypass"] = {
    state: "PARTIALLY_OBSERVED",
    provenance: [{ source: "legacy-spatial-record", at: 0, direct: false }]
  };

  proj = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  mapNodes = proj.q4.map.nodes;
  utilityNode = mapNodes.find((n) => n.id === "utility-room");
  corridorNode = mapNodes.find((n) => n.id === "columned-corridor");
  let alcoveNode = mapNodes.find((n) => n.id === "relay-alcove");
  let bypassNode = mapNodes.find((n) => n.id === "service-bypass");

  assert.equal(utilityNode.current, false);
  assert.equal(utilityNode.visited, true);
  assert.equal(corridorNode.current, false);
  assert.equal(corridorNode.visited, true);
  assert.equal(alcoveNode.current, true, "Relay Alcove is now current");
  assert.equal(alcoveNode.visited, true, "Relay Alcove has now been visited directly");
  assert.equal(alcoveNode.visited_this_expedition, true);
  assert.equal(bypassNode.current, false);
  assert.equal(bypassNode.visited, false, "Service Bypass is unvisited inherited");

  html = surfaces.render(proj);
  assert.match(html, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Utility Room<\/text>/, "Utility Room is visited (Cream)");
  assert.match(html, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Columned Corridor<\/text>/, "Columned Corridor is visited (Cream)");
  assert.match(html, /operational-node map-current-node node-observed-now[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Relay Alcove<\/text>/, "Relay Alcove is current (Green)");
  assert.match(html, /operational-node map-async-node node-inherited-async[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Service Bypass<\/text>/, "Service Bypass is unvisited inherited (Light Blue)");

  // 4. Revisit: Move back to Columned Corridor
  const moveBackRes = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "EAST — Columned Corridor" });
  assert.equal(moveBackRes.ok, true, `Move back should succeed: ${moveBackRes.result?.public_reason}`);

  proj = service.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  mapNodes = proj.q4.map.nodes;
  corridorNode = mapNodes.find((n) => n.id === "columned-corridor");
  alcoveNode = mapNodes.find((n) => n.id === "relay-alcove");
  bypassNode = mapNodes.find((n) => n.id === "service-bypass");

  assert.equal(corridorNode.current, true, "Revisited Columned Corridor must be current again");
  assert.equal(corridorNode.visited, true);
  assert.equal(alcoveNode.current, false, "Relay Alcove is now vacated");
  assert.equal(alcoveNode.visited, true, "Relay Alcove must remain visited (Cream)");
  assert.equal(bypassNode.visited, false, "Service Bypass remains unvisited (Light Blue)");

  html = surfaces.render(proj);
  assert.match(html, /operational-node map-current-node node-observed-now[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Columned Corridor<\/text>/, "Revisited Corridor is Green");
  assert.match(html, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Relay Alcove<\/text>/, "Vacated Relay Alcove is Cream");
  assert.match(html, /operational-node map-async-node node-inherited-async[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Service Bypass<\/text>/, "Service Bypass remains Light Blue");

  // 5. Cold-Boot Restart Persistence
  service.shutdown();

  let reopenedService = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "procedural-survey"
  });

  const resumed = reopenedService.resumeSession({ world_id: world.id, mode: "field-researcher" });
  assert.equal(resumed.ok, true, "Session must resume cleanly from cold disk store");

  const restoredProj = reopenedService.getGameplayProjection({ world_id: world.id, mode: "field-researcher" }).projection;
  const restoredMapNodes = restoredProj.q4.map.nodes;

  const resUtility = restoredMapNodes.find((n) => n.id === "utility-room");
  const resCorridor = restoredMapNodes.find((n) => n.id === "columned-corridor");
  const resAlcove = restoredMapNodes.find((n) => n.id === "relay-alcove");
  const resBypass = restoredMapNodes.find((n) => n.id === "service-bypass");

  assert.equal(resUtility.current, false, "Utility Room not current after restart");
  assert.equal(resUtility.visited, true, "Utility Room visited status survived restart");
  assert.equal(resUtility.visited_this_expedition, true);

  assert.equal(resCorridor.current, true, "Columned Corridor current status survived restart");
  assert.equal(resCorridor.visited, true);
  assert.equal(resCorridor.visited_this_expedition, true);

  assert.equal(resAlcove.current, false, "Relay Alcove not current after restart");
  assert.equal(resAlcove.visited, true, "Relay Alcove visited status survived restart");
  assert.equal(resAlcove.visited_this_expedition, true);

  assert.equal(resBypass.current, false);
  assert.equal(resBypass.visited, false, "Unvisited inherited node remains unvisited after restart");
  assert.equal(resBypass.visited_this_expedition, false);

  const restoredHtml = surfaces.render(restoredProj);
  assert.match(restoredHtml, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Utility Room<\/text>/, "Restart: Utility Room is Cream");
  assert.match(restoredHtml, /operational-node map-visited-node node-visited-expedition[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Relay Alcove<\/text>/, "Restart: Relay Alcove is Cream");
  assert.match(restoredHtml, /operational-node map-current-node node-observed-now[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Columned Corridor<\/text>/, "Restart: Columned Corridor is Green");
  assert.match(restoredHtml, /operational-node map-async-node node-inherited-async[^>]*>[^<]*<circle[^>]*><\/circle><text[^>]*>Service Bypass<\/text>/, "Restart: Bypass is Light Blue");

  reopenedService.shutdown();
  fs.rmSync(appDataPath, { recursive: true, force: true });
});
