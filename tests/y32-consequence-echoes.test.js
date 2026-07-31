"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const history = require("../tools/world-history");
const convergence = require("../tools/canon-convergence");
const echoes = require("../tools/consequence-echoes");

test("consequence echoes derive from the 150-turn canonical history without mutation", () => {
  const fixture = convergence.fixture("yb32-echo-test"); const before = JSON.stringify(fixture.world); const field = echoes.observerView(fixture.world, "field-researcher"); const beck = echoes.observerView(fixture.world, "async-command"); const nullzone = echoes.observerView(fixture.world, "local-anomaly");
  assert.ok(field.echoes.some((echo) => echo.kind === "object")); assert.ok(beck.echoes.some((echo) => echo.kind === "report")); assert.ok(nullzone.echoes.some((echo) => echo.kind === "evidence")); assert.notDeepEqual(field.echoes, beck.echoes); assert.equal(fixture.world.characters["convergence-researcher"].status, "dead"); assert.equal(JSON.stringify(fixture.world), before); assert.equal(fixture.world.events.length > 0, true);
});

test("echo derivation survives save/reload and never resurrects or duplicates objects", () => {
  const fixture = convergence.fixture("yb32-echo-reload"); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yb32-echo-reload-")), "world.json"); const expected = echoes.observerView(fixture.world, "local-anomaly"); history.saveWorld(file, fixture.world); const restored = history.loadWorld(file); assert.deepEqual(echoes.observerView(restored, "local-anomaly"), expected); assert.equal(Object.keys(restored.artifacts).filter((id) => id === fixture.recorder_id).length, 1); assert.equal(restored.characters["convergence-researcher"].status, "dead");
});

test("long repeated echo reads remain bounded, deterministic, and event-free", () => {
  const fixture = convergence.fixture("yb32-echo-long"); const before = fixture.world.events.length; const first = echoes.observerView(fixture.world, "lost"); for (let turn = 0; turn < 150; turn += 1) assert.deepEqual(echoes.observerView(fixture.world, turn % 2 ? "lost" : "async-command").echoes.length <= echoes.MAX_ECHOES, true); const second = echoes.observerView(fixture.world, "lost"); assert.deepEqual(first, second); assert.equal(fixture.world.events.length, before); assert.equal(fixture.world.characters["convergence-researcher"].status, "dead");
});

test("echo output contains no raw identifiers or hidden causes", () => {
  const fixture = convergence.fixture("yb32-echo-safe"); const output = JSON.stringify(["field-researcher", "async-command", "local-anomaly", "lost"].map((profile) => echoes.observerView(fixture.world, profile))); assert.doesNotMatch(output, /(?:history|artifact|phenomenon|character|region|run)-[a-f0-9]{8,}/i); assert.doesNotMatch(output, /because|culprit|motive|secretly|will happen/i); assert.doesNotMatch(output, /convergence-researcher|door-convergence/i);
});
