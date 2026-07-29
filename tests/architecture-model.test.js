"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { data, admission, read } = require("../tools/intake-lib");
const environments = read("architecture/environments.json").environments;
const topology = read("architecture/local-topology.json").connections;
const grammar = read("architecture/grammar.json").rules[0];
test("architecture records remain source-bounded local observations", () => {
  const { locatorById } = data(); const ids = new Set(environments.map(({ id }) => id));
  for (const item of environments) assert.ok(item.locator_refs.every((id) => locatorById.get(id)?.source.directly_checked));
  for (const edge of topology) assert.ok(ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
});
test("negative architectural inputs cannot become canonical geometry", () => {
  const { claimById } = data();
  assert.deepEqual(admission({ use: "authoritative-world-state" }, claimById.get("complex-architecture-is-not-a-universal-commercial-law")), { ok: false, code: "PROHIBITED_CLAIM" });
  assert.equal(grammar.authority, "strongly-implied");
  assert.ok(environments.find(({ id }) => id === "ff3-windowlike-opening").uncertainties.length > 0);
  assert.equal(read("architecture/production-references.json").references[0].simulation_authority, "reference-only");
});
