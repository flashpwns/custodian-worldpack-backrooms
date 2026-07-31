"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const qol = require("../desktop/renderer/qol");
const { DesktopService } = require("../desktop/service");
const report = require("../tools/qol-report.js");
require("./y30-accessibility.test.js");

function projection(mode, extra = {}) { return { world:{ id:"world-visible", name:"Visible world" }, mode:{ id:mode }, scene:{ narration:"A room with two chairs.", inventory:[{ text:"field light" }] }, gameplay:{ timeline:[{ description:"A visible observation." }], objectives:[{ target:"Return by the marked door" }] }, surface:{ ...extra } }; }
test("mode-specific recap uses observer-safe material and never hidden fate or taxonomy", () => {
  void report;
  const field = qol.recap(projection("field-researcher", { view:{ location:{ alias:"Marked doorway" } }, expedition:{ objectives:{ return:{ state:"known" } }, hidden_character_status:"dead" }, hidden_phenomenon:"Still Life" }));
  const fieldText = JSON.stringify(field); assert.match(fieldText, /Marked doorway|Return/); assert.doesNotMatch(fieldText, /dead|Still Life|hidden/i);
  const nullzone = qol.recap(projection("local-anomaly", { investigation:{ unresolved:["missing researcher"] }, base:{ archived_artifacts:[{ type:"photograph" }] }, hidden_character_status:"dead", hidden_taxonomy:"Still Life" }));
  assert.match(JSON.stringify(nullzone), /missing researcher|Photograph/i); assert.doesNotMatch(JSON.stringify(nullzone), /dead|Still Life|hidden/i);
});
test("Lost recap remains sparse personal memory without map, institution, or unseen people", () => {
  const lost = qol.recap(projection("lost", { surroundings:{ landmark:{ description:"room with two chairs" }, location:{ alias:"region-123" } }, status:{ light_charge:2, carried:["field-light"] }, known_routes:{ spaces:[{ alias:"two chairs" }] }, institution:{ reports:["hidden report"] }, hidden_people:["someone"] }));
  const text = JSON.stringify(lost); assert.match(text, /room with two chairs/); assert.doesNotMatch(text, /region-123|institution|report|someone|objective/i);
});
test("Beck and Nullzone filtering only visits already supplied observer records", () => {
  const beck = qol.recap(projection("async-command", { tasks:[{ summary:"Known matter" }], inbox:[{ type:"Known report" }], hidden_reports:[{ type:"Do not index" }] }));
  const items = beck.sections.flatMap((section) => section.items); assert.deepEqual(qol.filter(items, "known"), ["Known matter", "Known report"]); assert.deepEqual(qol.filter(items, "do not index"), []);
  const nullzone = qol.recap(projection("local-anomaly", { investigation:{ unresolved:["compare photo"] }, base:{ archived_artifacts:[{ type:"note" }] }, hidden_evidence:["other observer"] }));
  assert.deepEqual(qol.filter(nullzone.sections.flatMap((section) => section.items), "other observer"), []);
});
test("history is bounded and mode-specific rather than a raw lifetime log", () => {
  const long = projection("field-researcher"); long.gameplay.timeline = Array.from({ length:40 }, (_, index) => ({ description:`Visible event ${index}` }));
  assert.equal(qol.history(long).length, 6);
  const lost = projection("lost", { run_notes:Array.from({ length:10 }, (_, index) => `Memory ${index}`) }); assert.equal(qol.history(lost).length, 4);
});
test("drafts, pins, and panel state are scoped presentation metadata", () => {
  const metadata = new qol.PresentationMetadata(); const one = { worldId:"one", mode:"local-anomaly" }; const two = { worldId:"two", mode:"local-anomaly" }; const otherMode = { worldId:"one", mode:"lost" };
  metadata.setDraft(one, "unfinished note"); metadata.setPanel(one, "recap"); assert.equal(metadata.draft(two), ""); assert.equal(metadata.draft(otherMode), ""); assert.equal(metadata.panel(one), "recap");
  assert.equal(metadata.togglePin(one, "photo"), true); assert.equal(metadata.pinned(two, "photo"), false); metadata.clearDraft(one); assert.equal(metadata.draft(one), "");
});
test("presentation refresh and recap derivation do not advance a world or replay a turn", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-qol-")); const service = new DesktopService({ appDataPath:root }); const world = service.createWorld({ name:"QoL", seed:"qol" }).world;
  service.startSession({ world_id:world.id, mode:"field-researcher", seed:"qol" }); const before = service.loadWorld({ world_id:world.id }).summary;
  const first = service.getGameplayProjection({ world_id:world.id, mode:"field-researcher" }); const second = service.getGameplayProjection({ world_id:world.id, mode:"field-researcher" });
  assert.ok(first.ok && second.ok); assert.deepEqual(service.loadWorld({ world_id:world.id }).summary, before);
});
test("renderer QoL controls preserve natural input priority and keyboard safety", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  assert.match(renderer, /What do I know\?/); assert.match(renderer, /refresh-view/); assert.match(renderer, /event.target.matches\("input, textarea, select, button"\)/);
  assert.match(renderer, /\$\{natural\}\$\{recapMarkup\(projection\)\}/);
  assert.doesNotMatch(renderer, /STORY THREAD|\bQUEST\b|MYSTERY ID/);
});
