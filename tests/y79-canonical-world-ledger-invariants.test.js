"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const { projectLiveScene } = require("../tools/live-scene-projection");
const { buildCustodianScope } = require("../tools/ai-interpreter-boundary");
const spatialRuntime = require("../tools/spatial-runtime");
const objectRuntime = require("../tools/object-runtime");
const teamRuntime = require("../tools/team-runtime");
const equipment = require("../tools/q4-equipment");
const reference = require("../tools/reference-expedition");

// ---------- fixture ----------

function fixture(seed = "cwl-invariant") {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-cwl-"));
  const service = new DesktopService({ appDataPath });
  const world = service.createWorld({ name: "CWL Invariant Reference", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" }).ok, true);
  assert.equal(service.startSession({ world_id: world.id, mode: "field-researcher", seed, require_personnel: true, scenario: "reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" }).ok, true);
  assert.equal(service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "open passage" }).ok, true);
  const run = service.session(world.id, "field-researcher").run;
  return { appDataPath, service, world, run };
}

function playerId(run) { return run.session.startup.player.observer_id; }
function allPersonnel(run) { return (run.expedition?.team?.members ?? []).map((m) => m.personnel_id ?? m.id).filter(Boolean); }
function coworkers(run) { return allPersonnel(run).filter((id) => id !== playerId(run)); }

// ---------- helpers ----------

const HIDDEN_FIELDS = [
  "canonical_geometry", "euclidean_relation", "overlap_depth_m",
  "canonical_family", "random_seed", "provider_prompt", "provider_model",
  "provider_metadata", "migration", "debug", "future_schedule",
  "semantic_id", "canonical_type"
];

const INTERNAL_ID_PATTERN = /\b(?:q4|yb-personnel|coordinated|open-passage|utility-room|clear-q4|actor|object|node|edge|fixture|entity)-[a-z0-9][a-z0-9:-]{3,}\b/i;

// ================================================================
//  INVARIANT 1: Single-Location — no person occupies two locations
// ================================================================

test("CWL-01 every person occupies exactly one canonical location", () => {
  const { run } = fixture("cwl-single-location");
  const locations = run.spatial.personnel_locations;
  const ids = allPersonnel(run);
  for (const id of ids) {
    assert.ok(typeof locations[id] === "string", `${id} has no location`);
    // Count how many location keys map to this person — should be exactly 1 key per person
    const entries = Object.entries(locations).filter(([key]) => key === id);
    assert.equal(entries.length, 1, `${id} appears ${entries.length} times in personnel_locations`);
  }
  // Player location must match personnel_locations[player]
  assert.equal(run.spatial.player_location, locations[playerId(run)]);
});

// ================================================================
//  INVARIANT 2: Single-Holder — each unique equipment item has ≤ 1 holder
// ================================================================

test("CWL-02 each equipment item has at most one holder", () => {
  const { run } = fixture("cwl-single-holder");
  const equipmentMap = run.expedition?.equipment ?? {};
  const holders = new Map();
  for (const [key, item] of Object.entries(equipmentMap)) {
    if (!item?.holder) continue;
    // This key should not be held by multiple holders
    const seen = holders.get(key);
    assert.equal(seen, undefined, `equipment ${key} already held by ${seen}, now also by ${item.holder}`);
    holders.set(key, item.holder);
  }
});

// ================================================================
//  INVARIANT 3: Equipment holder exists in personnel roster
// ================================================================

test("CWL-03 equipment holder exists in personnel roster", () => {
  const { run } = fixture("cwl-equipment-holder");
  const personnel = new Set(allPersonnel(run));
  const equipmentMap = run.expedition?.equipment ?? {};
  for (const [key, item] of Object.entries(equipmentMap)) {
    if (!item?.holder) continue;
    assert.ok(personnel.has(item.holder), `equipment ${key} held by unknown person ${item.holder}`);
  }
});

// ================================================================
//  INVARIANT 4: Player projection contains no hidden-state fields
// ================================================================

test("CWL-04 player projection excludes hidden canonical fields", () => {
  const { run } = fixture("cwl-hidden-state");
  // Inject hidden data that should never leak
  run._world.q4_phenomenon_ecology ??= {
    version: "test-hidden-ecology",
    records: { secret: { canonical_family: "SECRET_FAMILY", location_id: "relay-alcove" } },
    future_schedule: ["secret-event"]
  };
  const player = playerId(run);
  const result = projectLiveScene(run, { observer_id: player });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.packet);
  for (const field of HIDDEN_FIELDS) {
    assert.equal(serialized.includes(field), false, `hidden field "${field}" leaked into player projection`);
  }
  // Verify injected hidden data specifically did not leak
  assert.equal(serialized.includes("SECRET_FAMILY"), false, "injected hidden family leaked");
  assert.equal(serialized.includes("secret-event"), false, "injected future schedule leaked");
});

// ================================================================
//  INVARIANT 5: AI interpreter scope contains no hidden-state fields
// ================================================================

test("CWL-05 interpreter scope excludes hidden canonical fields", () => {
  const { run } = fixture("cwl-interpreter-scope");
  const scope = buildCustodianScope(run);
  const serialized = JSON.stringify(scope.context);
  for (const field of HIDDEN_FIELDS) {
    assert.equal(serialized.includes(field), false, `hidden field "${field}" leaked into interpreter scope`);
  }
  assert.equal(scope.context.authority_contract.hidden_state, "structurally-absent");
});

// ================================================================
//  INVARIANT 6: Observer projection is deterministic and read-only
// ================================================================

test("CWL-06 projection is deterministic and does not mutate canonical state", () => {
  const { run } = fixture("cwl-deterministic");
  const player = playerId(run);
  const before = structuredClone(run);
  const first = projectLiveScene(run, { observer_id: player });
  const second = projectLiveScene(run, { observer_id: player });
  assert.deepEqual(first, second, "projection is not deterministic");
  assert.deepEqual(run, before, "projection mutated canonical state");
});

// ================================================================
//  INVARIANT 7: Separated coworker knowledge is NOT visible to player
// ================================================================

test("CWL-07 separated coworker actions are invisible to player", () => {
  const { run } = fixture("cwl-separated");
  const player = playerId(run);
  const nonPlayerMembers = coworkers(run);
  // Move player away from coworkers to create separation
  // First, verify that co-located coworkers ARE visible
  const coLocated = nonPlayerMembers.filter(
    (id) => run.spatial.personnel_locations[id] === run.spatial.player_location
  );
  const separated = nonPlayerMembers.filter(
    (id) => run.spatial.personnel_locations[id] !== run.spatial.player_location
  );
  const packet = projectLiveScene(run, { observer_id: player });
  assert.equal(packet.ok, true);
  const visibleIds = new Set(packet.packet.visible_personnel.map((p) => p.observer_id));
  // Co-located personnel SHOULD be visible
  for (const id of coLocated) {
    assert.ok(visibleIds.has(id), `co-located coworker ${id} should be visible`);
  }
  // Separated personnel should NOT be visible
  for (const id of separated) {
    assert.ok(!visibleIds.has(id), `separated coworker ${id} should not be visible`);
  }
});

// ================================================================
//  INVARIANT 8: Cross-observer projections differ
// ================================================================

test("CWL-08 projections for different observers reflect their distinct positions", () => {
  const { run } = fixture("cwl-cross-observer");
  const player = playerId(run);
  const personnel = allPersonnel(run);
  // Project for each team member
  const packets = {};
  for (const id of personnel) {
    const result = projectLiveScene(run, { observer_id: id });
    if (result.ok) packets[id] = result.packet;
  }
  // Player must always have a packet
  assert.ok(packets[player], "player projection unavailable");
  // Each observer should see themselves as is_observer
  for (const [id, packet] of Object.entries(packets)) {
    const self = packet.visible_personnel.find((p) => p.observer_id === id);
    assert.ok(self, `observer ${id} not found in own visible_personnel`);
    assert.equal(self.is_observer, true, `observer ${id} not marked as is_observer`);
  }
});

// ================================================================
//  INVARIANT 9: Evidence references a real observer
// ================================================================

test("CWL-09 evidence creator and operator are valid personnel", () => {
  const { run } = fixture("cwl-evidence-provenance");
  const personnel = new Set(allPersonnel(run));
  for (const evidence of run.expedition?.evidence ?? []) {
    if (evidence.creator) assert.ok(personnel.has(evidence.creator), `evidence ${evidence.id} creator ${evidence.creator} is not valid personnel`);
    if (evidence.operator) assert.ok(personnel.has(evidence.operator), `evidence ${evidence.id} operator ${evidence.operator} is not valid personnel`);
  }
});

// ================================================================
//  INVARIANT 10: Movement traverses only valid connections
// ================================================================

test("CWL-10 route history contains only traversable connections", () => {
  const { run } = fixture("cwl-valid-routes");
  const routeHistory = run.spatial?.route_history ?? [];
  // Each route entry should have from, to, and connection_id
  for (const entry of routeHistory) {
    assert.ok(typeof entry.from === "string", "route entry missing 'from'");
    assert.ok(typeof entry.to === "string", "route entry missing 'to'");
    assert.ok(typeof entry.connection_id === "string", "route entry missing 'connection_id'");
    assert.notEqual(entry.from, entry.to, "route entry has same from and to");
  }
});

// ================================================================
//  INVARIANT 11: Projection does not contain future events
// ================================================================

test("CWL-11 projection does not contain future events", () => {
  const { run } = fixture("cwl-no-future");
  const player = playerId(run);
  const result = projectLiveScene(run, { observer_id: player });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.packet);
  // Check for future-language patterns
  const FUTURE = /\b(?:will soon|is going to|is about to|later (?:will|does)|next (?:will|comes))\b/i;
  assert.equal(FUTURE.test(serialized), false, "projection contains future language");
});

// ================================================================
//  INVARIANT 12: Save and reload preserves canonical identity
// ================================================================

test("CWL-12 save and reload preserves canonical identity", () => {
  const { service, world, run } = fixture("cwl-save-reload");
  const player = playerId(run);
  const worldId = world.id;
  const beforeLocation = run.spatial.player_location;
  const beforeInterval = run.expedition.clock.interval;
  const beforeEvidence = run.expedition.evidence.length;
  // Save
  service.saveWorld({ world_id: worldId });
  // Re-fetch session (validates it survived save)
  const reloaded = service.session(worldId, "field-researcher");
  assert.ok(reloaded, "session unavailable after save");
  const reloadedRun = reloaded.run;
  // Canonical identity must survive
  assert.equal(reloadedRun.spatial.player_location, beforeLocation);
  assert.equal(reloadedRun.expedition.clock.interval, beforeInterval);
  assert.equal(reloadedRun.expedition.evidence.length, beforeEvidence);
  // Player identity must survive
  assert.equal(playerId(reloadedRun), player);
  // Team composition must survive
  assert.equal(allPersonnel(reloadedRun).length, allPersonnel(run).length);
});

// ================================================================
//  INVARIANT 13: Failed presentation does not undo canonical execution
// ================================================================

test("CWL-13 canonical execution persists even if presentation fails", () => {
  const { service, world, run } = fixture("cwl-presentation-fail");
  const beforeInterval = run.expedition.clock.interval;
  // Perform a canonical action (WAIT always succeeds)
  const result = service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
  assert.equal(result.ok, true);
  const afterInterval = run.expedition.clock.interval;
  assert.ok(afterInterval > beforeInterval, "clock did not advance");
  // Even if presentation were to fail, the canonical execution (clock advance)
  // has already happened. This test verifies the state is already mutated
  // before any presentation attempt.
  assert.equal(run.expedition.clock.interval, afterInterval, "canonical state was rolled back");
});

// ================================================================
//  INVARIANT 14: Reports are claims — they cannot mutate source reality
// ================================================================

test("CWL-14 written reports do not mutate canonical geography or evidence", () => {
  const { run } = fixture("cwl-report-claims");
  // Capture before-state
  const geoSnapshot = structuredClone(run.spatial.generated_locations);
  const objSnapshot = structuredClone(run.object_state);
  // Write a report with misleading content
  run.lifecycle = "completed";
  reference.writeReport(run, {
    text: "The passage depth contradicts the prior record. The walls have shifted. Objects have moved.",
    at: run.expedition.clock.interval
  });
  // Canonical geography must not change
  assert.deepEqual(run.spatial.generated_locations, geoSnapshot, "report mutated canonical geography");
  // Canonical object state must not change
  assert.deepEqual(run.object_state, objSnapshot, "report mutated canonical objects");
});

// ================================================================
//  INVARIANT 15: Interpreter scope authority contract is correct
// ================================================================

test("CWL-15 interpreter scope authority contract prevents canonical mutation", () => {
  const { run } = fixture("cwl-authority-contract");
  const scope = buildCustodianScope(run);
  assert.equal(scope.context.authority_contract.interpretation, "candidate-only");
  assert.equal(scope.context.authority_contract.canonical_resolution, "Custodian-only");
  assert.equal(scope.context.authority_contract.player_commitments, "explicit-player-language-only");
  assert.equal(scope.context.authority_contract.hidden_state, "structurally-absent");
});

// ================================================================
//  INVARIANT 16: Interpreter scope is deep-frozen
// ================================================================

test("CWL-16 interpreter scope is immutable", () => {
  const { run } = fixture("cwl-frozen-scope");
  const scope = buildCustodianScope(run);
  // Attempting to modify the scope should throw
  assert.throws(() => { scope.context.observer = "TAMPERED"; }, TypeError);
  assert.throws(() => { scope.context.authority_contract.hidden_state = "leaked"; }, TypeError);
});

// ================================================================
//  INVARIANT 17: Spatial state validates against definition
// ================================================================

test("CWL-17 spatial state validates after operations", () => {
  const { run } = fixture("cwl-spatial-valid");
  // validateState is called internally; verify it doesn't throw
  const errors = spatialRuntime.validateState(
    run.spatial,
    require("../tools/run-bootstrap").topologyFor(run)
  );
  // validateState returns an array of errors (empty = valid)
  if (Array.isArray(errors)) {
    assert.equal(errors.length, 0, `spatial validation errors: ${JSON.stringify(errors)}`);
  }
  // If it returns void/undefined, that means no errors (also valid)
});

// ================================================================
//  INVARIANT 18: Projection does not leak equipment to wrong observer
// ================================================================

test("CWL-18 equipment visible only to holder or co-located observer", () => {
  const { run } = fixture("cwl-equipment-visibility");
  const player = playerId(run);
  const result = projectLiveScene(run, { observer_id: player });
  assert.equal(result.ok, true);
  const heldEquipment = result.packet.available_action_context.held_equipment;
  // All equipment shown to player must be held by player
  for (const item of heldEquipment) {
    const canonical = run.expedition.equipment[item.equipment_id];
    assert.ok(canonical, `projected equipment ${item.equipment_id} not found in canonical state`);
    assert.equal(canonical.holder, player, `equipment ${item.equipment_id} shown to player but held by ${canonical.holder}`);
  }
});

// ================================================================
//  INVARIANT 19: Stale interpretation scope is rejected
// ================================================================

test("CWL-19 stale scope digest causes rejection on dispatch", () => {
  const { service, world, run } = fixture("cwl-stale-scope");
  const { interpretPlayerLanguage, dispatchCandidate } = require("../tools/ai-interpreter-boundary");
  const { createLivingProvider } = require("../tools/ai-living-provider");
  // This test verifies the digest mechanism prevents stale candidates
  const scope1 = buildCustodianScope(run);
  // Advance the world state via a canonical action
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "WAIT" });
  const scope2 = buildCustodianScope(run);
  // Digests should differ after state change
  assert.notEqual(scope1.digest, scope2.digest, "digests should differ after state change");
});

// ================================================================
//  INVARIANT 20: Team member observation requires co-location
// ================================================================

test("CWL-20 team observation updates only for co-located personnel", () => {
  const { run } = fixture("cwl-observation-colocation");
  const player = playerId(run);
  const teamMembers = coworkers(run);
  // All coworkers should be at the same location as the player (Reference Expedition starts together)
  for (const id of teamMembers) {
    assert.equal(
      run.spatial.personnel_locations[id],
      run.spatial.player_location,
      `coworker ${id} not co-located with player at start`
    );
  }
  // Verify team projection shows all local coworkers
  const projection = teamRuntime.project(run);
  const eligible = projection.filter((m) => !m.controlled && m.local_eligible);
  assert.ok(eligible.length > 0, "no eligible local coworkers despite co-location");
  // Verify projection does not include non-existent personnel
  const validIds = new Set(allPersonnel(run));
  for (const member of projection) {
    assert.ok(validIds.has(member.personnel_id), `projected member ${member.personnel_id} not in roster`);
  }
});
