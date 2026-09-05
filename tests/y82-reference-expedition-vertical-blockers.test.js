"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DesktopService } = require("../desktop/service");
const { createLivingProvider } = require("../tools/ai-living-provider");
const surfaces = require("../desktop/renderer/surfaces");

function fieldFixture(seed) {
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-reference-vertical-"));
  const service = new DesktopService({ appDataPath, defaultQ4Scenario:"reference-expedition", livingTurnProvider:createLivingProvider() });
  const world = service.createWorld({ name:"Reference vertical blocker", seed }).world;
  assert.equal(service.createQ4Personnel({ world_id:world.id, first_name:"Matthew", last_name:"Murphy" }).ok, true);
  assert.equal(service.startSession({ world_id:world.id, mode:"field-researcher", seed, require_personnel:true, scenario:"reference-expedition" }).ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action }).ok, true);
  assert.equal(service.submitQ4Communication({ world_id:world.id, channel:"standard", text:"Standard, Reference team. Four accounted for. Radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"CROSS" }).ok, true);
  return { service, world, run:service.session(world.id, "field-researcher").run };
}

test("wrong-room generic survey use is unavailable and cannot consume the Reference instrument", () => {
  const { service, world, run } = fieldFixture("wrong-room-survey-guard");
  const before = structuredClone({ clock:run.expedition.clock, instrument:run.expedition.equipment["survey-instrument"], evidence:run.expedition.evidence });
  assert.equal(service.getAvailableActions({ world_id:world.id, mode:"field-researcher" }).actions.some((action) => action.type === "USE"), false);

  const rejected = service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "REFERENCE_MEASUREMENT_UNAVAILABLE");
  assert.deepEqual({ clock:run.expedition.clock, instrument:run.expedition.equipment["survey-instrument"], evidence:run.expedition.evidence }, before);

  assert.equal(service.submitAction({ world_id:world.id, mode:"field-researcher", action:"MOVE", target:"open-passage" }).ok, true);
  assert.equal(service.getAvailableActions({ world_id:world.id, mode:"field-researcher" }).actions.some((action) => action.type === "USE"), true);
  const measured = service.submitAction({ world_id:world.id, mode:"field-researcher", action:"USE", target:"survey-instrument" });
  assert.equal(measured.ok, true);
  assert.ok(run.expedition.evidence.some((item) => item.type === "passage-depth-measurement" && item.measurement?.value === 18));
});

test("LOCAL retrospective answers remain bounded to the addressed coworker's own record", () => {
  const { service, world, run } = fieldFixture("bounded-retrospective-answer");
  const beverly = run.expedition.team.members.find((member) => member.first_name === "Beverly");
  const santiago = run.expedition.team.members.find((member) => member.first_name === "Santiago");
  beverly.known_information.push({ kind:"location-investigated", location:"columned-corridor", at:6, source:"direct-observation" });
  beverly.condition = "minor injury";
  beverly.condition_history = [{ sequence:1, condition:"minor injury", status:"active", at:6, reason:"struck by a loose service bracket" }];

  const answer = service.submitQ4Communication({ world_id:world.id, channel:"local", target:"Beverly", text:"Beverly, what happened while we were apart?" });
  assert.equal(answer.ok, true);
  assert.match(answer.result.public_reason, /^Beverly: I checked the columned corridor\./);
  assert.match(answer.result.public_reason, /loose service bracket/);
  assert.match(answer.result.public_reason, /minor injury/);
  const rendered = surfaces.render(answer.projection);
  assert.doesNotMatch(rendered, /Beverly Bell:<\/span>[^]*“Beverly:/);

  const other = service.submitQ4Communication({ world_id:world.id, channel:"local", target:"Santiago", text:"Santiago, what happened while we were apart?" });
  assert.equal(other.ok, true);
  assert.match(other.result.public_reason, /^Santiago:/);
  assert.doesNotMatch(other.result.public_reason, /columned corridor|loose service bracket|minor injury/i);
  assert.equal(santiago.known_information.some((item) => item.kind === "location-investigated"), false);
});

test("transfers use public names and coordinated presentation includes both attempts", async () => {
  const { service, world } = fieldFixture("public-coordinated-presentation");
  const transferred = service.submitAction({ world_id:world.id, mode:"field-researcher", action:"TRANSFER", target:"field-light|personnel-autumn-tucker" });
  assert.equal(transferred.ok, true);
  assert.equal(transferred.result.public_reason, "Battery field lamp transferred from You to Autumn Tucker.");
  assert.doesNotMatch(transferred.result.public_reason, /q4-player|personnel-/);

  const coordinated = await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:"Beverly photographs the fluorescent fixture while I inspect the service panel." });
  assert.equal(coordinated.ok, true);
  assert.equal(coordinated.result.turn_status, "RESOLVED");
  assert.match(coordinated.result.summary, /You inspect service panel\./);
  assert.match(coordinated.result.summary, /Beverly Bell photographs fluorescent fixture\./);
});
